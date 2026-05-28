/**
 * Engine Worker — 单个 TTS 引擎的生命周期管理。
 *
 * 由 TTS Worker 线程创建。每个实例加载一个 adapter.js 并管理其生命周期。
 * 引擎启动后直接通过 postMessage 将状态推送给 ttsWorker，不走 HTTP。
 *
 * 消息:
 *   请求: { id, type, payload }
 *   响应: { id, type:'result'|'error'|'log', payload }
 */
import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { engineType, adapterPath, contract } = workerData;
let adapter = null;
let initPromise = null;
let runtimeConfig = {};

const PID_FILE = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
  'data', 'tts_services', `.engine-pid-${engineType}`
);

function log(level, message) {
  parentPort.postMessage({
    id: '',
    type: 'log',
    payload: { timestamp: Date.now(), level, message: `[tts:${engineType}] ${message}` }
  });
}

/** 推送引擎状态快照给 ttsWorker */
function pushReport(data) {
  parentPort.postMessage({ id: '', type: 'report', payload: { engineType, ...data } });
}

async function getAdapter() {
  if (adapter) return adapter;
  if (!initPromise) {
    initPromise = (async () => {
      log('info', `Loading adapter from ${adapterPath}`);
      const mod = await import(`file://${adapterPath}`);
      const Cls = mod.default || mod.TtsEngineAdapter;
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
    parentPort.postMessage({
      id, type: 'error',
      payload: { code: e.code || 'INTERNAL_ERROR', message: e.message, retryable: e.retryable !== false }
    });
  }
});

async function dispatch(type, payload) {
  const a = await getAdapter();
  switch (type) {
    case 'initialize': {
      log('info', `Initializing engine, modelDir=${payload.modelDir}`);
      const rc = contract?.runtime_config || {};
      for (const [k, v] of Object.entries(rc)) {
        if (runtimeConfig[k] == null) runtimeConfig[k] = v.default;
      }
      await a.initialize({ modelDir: payload.modelDir || '', deviceId: payload.deviceId ?? -1, custom: payload.custom || {} });

      let health, pid, memory, port;
      try { health = await a.health(); } catch { health = { status: 'healthy', model_loaded: true }; }
      try { pid = await a.getPid(); } catch { pid = null; }
      try { memory = await a.getMemoryInfo(); } catch { memory = null; }
      try { port = await a.getPort(); } catch { port = null; }
      if (pid) { try { fs.writeFileSync(PID_FILE, String(pid)); } catch {} }
      pushReport({ event: 'ready', health, pid, memory, runtimeConfig, port });

      log('info', `Engine ready, PID=${pid}`);
      return { status: 'running', runtime_config: runtimeConfig };
    }
    case 'synthesize': {
      log('info', `Synthesizing: ${(payload.text || '').slice(0, 50)}...`);
      const result = await a.synthesize(payload);
      log('info', `Synthesize done, duration=${result.duration_seconds}s, rtf=${result.rtf}`);
      try {
        const mem = await a.getMemoryInfo();
        pushReport({ event: 'memory', memory: mem });
      } catch {}
      return result;
    }
    case 'clearCache':
      log('info', 'Clearing engine cache');
      await a.clearCache();
      try {
        const mem = await a.getMemoryInfo();
        pushReport({ event: 'memory', memory: mem });
      } catch {}
      log('info', 'Cache cleared');
      return { status: 'cleared' };
    case 'getRuntimeConfig':
      return runtimeConfig;
    case 'setRuntimeConfig': {
      const { key, value } = payload;
      await a.setRuntimeConfig(key, value);
      runtimeConfig[key] = value;
      log('info', `Runtime config: ${key}=${value}`);
      return runtimeConfig;
    }
    case 'dispose':
      log('info', 'Disposing engine');
      await a.dispose();
      adapter = null; initPromise = null;
      pushReport({ event: 'disposed' });
      log('info', 'Engine disposed');
      return { status: 'stopped' };
    default:
      throw { code: 'UNKNOWN_TYPE', message: `Unknown type: ${type}` };
  }
}
