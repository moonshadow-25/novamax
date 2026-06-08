import path from 'path';
import crypto from 'crypto';
import { Worker } from 'worker_threads';
import { normalizeEngineType } from '../../utils/engineTypeHelper.js';
import { discoverEngines } from './discovery.js';

const genId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;

export function getOrCreateEngine(registry, engineType, log, enginesDir, engineWorkerPath, versionOrder, PROJECT_ROOT) {
  const norm = normalizeEngineType(engineType);
  const existing = registry.get(norm);
  if (existing && existing.worker && existing._alive) return existing;

  // 找所有匹配的版本，按 engines.json 顺序选第一个
  const allMatches = discoverEngines(enginesDir).filter(e => normalizeEngineType(e.engineType) === norm);
  let installed;
  if (versionOrder && versionOrder.length > 0) {
    for (const v of versionOrder) {
      installed = allMatches.find(e => e.version === v);
      if (installed) break;
    }
  }
  if (!installed) installed = allMatches[0];
  if (!installed) throw { code: 'ENGINE_UNAVAILABLE', message: `引擎 "${engineType}" 未安装` };

  const prevModelDir = existing?.modelDir || '';

  const worker = new Worker(engineWorkerPath, {
      workerData: {
        engineType,
        adapterPath: installed.adapterPath,
        contract: installed.contract,
        PROJECT_ROOT,
      }
    }
  );

  const pending = new Map();
  const entry = {
    worker, _alive: true, status: 'idle', modelDir: prevModelDir,
    pending, _busy: false, activeTasks: 0, lastActiveTime: Date.now(),
    _initPromise: null, report: {},
  };
  registry.set(norm, entry);

  worker.on('message', (msg) => {
    if (msg.type === 'report') {
      const r = msg.payload;
      const rep = entry.report;
      if (r.health != null) rep.health = r.health;
      if (r.pid != null) rep.pid = r.pid;
      if (r.memory != null) rep.memory = r.memory;
      if (r.runtimeConfig != null) rep.runtimeConfig = r.runtimeConfig;
      if (r.port != null) rep.port = r.port;
      if (r.event === 'ready') { entry.status = 'running'; log.info(`Engine ${engineType} ready, PID=${r.pid}`); }
      if (r.event === 'disposed') { entry.status = 'stopped'; entry._alive = false; }
      if (r.event === 'crashed') { entry.status = 'error'; entry._alive = false; log.error(`Engine ${engineType} crashed: ${r.health?.last_error || 'unknown'}`); }
      return;
    }
    if (msg.type === 'log') {
      log.push(msg.payload.level, msg.payload.message);
      return;
    }
    const cb = entry.pending.get(msg.id);
    if (cb) { entry.pending.delete(msg.id); cb(msg); }
  });

  worker.on('error', (err) => {
    entry.status = 'error';
    entry._alive = false;
    for (const [, cb] of entry.pending) {
      cb({ type: 'error', payload: { code: 'ENGINE_UNAVAILABLE', message: err.message } });
    }
    entry.pending.clear();
  });

  worker.on('exit', () => {
    entry._alive = false;
    if (!entry._intentionalStop) {
      entry.status = 'error';
      for (const [, cb] of entry.pending) {
        cb({ type: 'error', payload: { code: 'ENGINE_UNAVAILABLE', message: '引擎进程意外退出' } });
      }
      entry.pending.clear();
    }
  });

  return entry;
}

export function sendToEngine(entry, type, payload) {
  if (!entry._alive) throw { code: 'ENGINE_UNAVAILABLE', message: '引擎不可用' };

  const id = genId('eng');
  return new Promise((resolve, reject) => {
    entry.pending.set(id, (msg) => {
      if (msg.type === 'result') resolve(msg.payload);
      else reject(msg.payload);
    });
    try {
      entry.worker.postMessage({ id, type, payload });
    } catch (e) {
      entry.pending.delete(id);
      reject({ code: 'ENGINE_UNAVAILABLE', message: e.message });
    }
  });
}

export async function ensureInitialized(registry, engineType, modelDir, log, enginesDir, engineWorkerPath, versionOrder, PROJECT_ROOT) {
  const entry = getOrCreateEngine(registry, engineType, log, enginesDir, engineWorkerPath, versionOrder, PROJECT_ROOT);
  entry.lastActiveTime = Date.now();

  if (entry.status === 'running') return;

  if (entry._initPromise) {
    log.info(`Engine ${engineType} initializing, waiting...`);
    await entry._initPromise;
    return;
  }

  entry.modelDir = modelDir || entry.modelDir;
  log.info(`Auto-initializing engine ${engineType}, modelDir=${entry.modelDir}`);

  entry._initPromise = sendToEngine(entry, 'initialize', {
    modelDir: entry.modelDir,
    deviceId: -1,
    custom: {}
  }).then(() => {
    entry.status = 'running';
    log.info(`Engine ${engineType} initialized`);
  }).catch((e) => {
    entry.status = 'error';
    log.error(`Engine ${engineType} init failed: ${e.message}`);
    throw e;
  }).finally(() => {
    entry._initPromise = null;
  });

  await entry._initPromise;
}

export function disposeEngine(registry, engineType) {
  const norm = normalizeEngineType(engineType);
  const entry = registry.get(norm);
  if (!entry) return;

  entry._intentionalStop = true;
  entry._alive = false;

  // 先发 dispose 消息让 adapter 清理 Python 进程
  try { entry.worker.postMessage({ id: genId('disp'), type: 'dispose', payload: {} }); } catch {}

  // 1 秒后强制清理：terminate Worker + 杀 Python 进程（如果有 PID）
  setTimeout(async () => {
    const pid = entry.report?.pid;
    if (pid) {
      try {
        if (process.platform === 'win32') {
          const { execSync } = await import('child_process');
          execSync('taskkill /F /T /PID ' + pid, { stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {}
    }
    try { entry.worker.terminate(); } catch {}
    registry.delete(norm);
  }, 1000);
}

export function getStatus(registry) {
  let hasStarting = false, hasError = false, anyBusy = false, anyRunning = false;
  const perEngine = {};

  for (const [type, entry] of registry.entries()) {
    if (!entry._alive) { hasError = true; perEngine[type] = { status: 'error' }; continue; }
    if (entry.status === 'error') { hasError = true; perEngine[type] = { status: 'error' }; continue; }
    if ((entry.status === 'idle') && entry._initPromise) { hasStarting = true; perEngine[type] = { status: 'starting' }; continue; }
    if (entry.status !== 'running') continue;

    if (entry.activeTasks > 0) { anyBusy = true; anyRunning = true; perEngine[type] = { status: 'busy' }; continue; }

    const health = entry.report?.health;
    if (health?.status === 'unhealthy') {
      hasError = true;
      perEngine[type] = { status: 'error' };
    } else {
      anyRunning = true;
      perEngine[type] = { status: 'running' };
    }
  }

  const status = hasError ? 'error' : anyBusy ? 'busy' : anyRunning ? 'running' : hasStarting ? 'starting' : 'idle';
  return { running: anyRunning || anyBusy || hasStarting, status, engines: perEngine };
}
