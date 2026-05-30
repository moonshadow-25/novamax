/**
 * ASR Engine Worker — 管理单个 Python whisper 子进程的生命周期。
 */
import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { engineType, adapterPath, contract, modelId } = workerData;
let adapter = null;
let initPromise = null;

const PID_FILE = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
  'data', 'asr_services', `.engine-pid-${modelId || engineType}`
);

function log(level, message) {
  parentPort.postMessage({ id: '', type: 'log', payload: { timestamp: Date.now(), level, message: `[asr:${modelId || engineType}] ${message}` } });
}

function pushReport(data) {
  parentPort.postMessage({ id: '', type: 'report', payload: { engineType, modelId, ...data } });
}

async function getAdapter() {
  if (adapter) return adapter;
  if (!initPromise) {
    initPromise = (async () => {
      log('info', `Loading adapter from ${adapterPath}`);
      const mod = await import(`file://${adapterPath}`);
      const Cls = mod.default || mod.AsrEngineAdapter;
      adapter = new Cls(contract);
      log('info', 'Adapter loaded');
    })();
  }
  await initPromise;
  return adapter;
}

parentPort.on('message', async (msg) => {
  const { id, type, payload } = msg;
  try {
    const result = await dispatch(type, payload);
    parentPort.postMessage({ id, type: 'result', payload: result !== undefined ? result : {} });
  } catch (e) {
    log('error', e.message);
    parentPort.postMessage({ id, type: 'error', payload: { code: e.code || 'INTERNAL_ERROR', message: e.message } });
  }
});

async function dispatch(type, payload) {
  const a = await getAdapter();
  switch (type) {
    case 'initialize': {
      log('info', `Initializing engine, model=${payload.modelFilePath}`);
      // 连接引擎进程的 stdout/stderr 到 ASR 日志
      a._onStdout = (line) => { line.trim().split('\n').forEach(l => { if (l.trim()) log('info', l.trim()); }); };
      a._onStderr = (line) => { line.trim().split('\n').forEach(l => { if (l.trim()) log('warn', l.trim()); }); };
      await a.initialize({
        modelFilePath: payload.modelFilePath,
        language: payload.language,
        threads: payload.threads,
        enableVad: payload.enableVad,
        vadFilePath: payload.vadFilePath,
        enginePath: payload.enginePath,
      });
      let health, pid, port;
      try { health = await a.health(); } catch { health = { status: 'healthy' }; }
      try { pid = await a.getPid(); } catch { pid = null; }
      try { port = await a.getPort(); } catch { port = null; }
      if (pid) { try { fs.mkdirSync(path.dirname(PID_FILE), { recursive: true }); fs.writeFileSync(PID_FILE, String(pid)); } catch {} }
      pushReport({ event: 'ready', health, pid, port });
      log('info', `Engine ready, PID=${pid}, port=${port}`);
      return { status: 'running', port };
    }

    case 'transcribe': {
      const result = await a.transcribe(payload.audioPath, payload.params || {});
      log('info', 'Transcribe done');
      return result;
    }

    case 'transcribeStream': {
      const onDelta = (delta) => parentPort.postMessage({ id: null, type: 'delta', payload: delta });
      // 通过 payload.requestId 传递 delta 回 Worker
      // 暂用 id 为 null 的方式，Worker 需要自己路由
      return {};
    }

    case 'dispose':
      log('info', 'Disposing engine');
      await a.dispose();
      adapter = null; initPromise = null;
      pushReport({ event: 'disposed' });
      return { status: 'stopped' };

    case 'health': {
      try { return await a.health(); }
      catch { return { status: 'unhealthy' }; }
    }

    default:
      throw { code: 'UNKNOWN_TYPE', message: `Unknown: ${type}` };
  }
}
