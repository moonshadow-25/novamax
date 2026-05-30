/**
 * ASR Worker Manager — 主线程侧代理。管理 ASR Worker 线程的生命周期。
 */
import { Worker } from 'worker_threads';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import modelManager from '../services/modelManager.js';
import processManager from '../services/processManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const genId = () => crypto.randomUUID().slice(0, 12);
const RECONNECT_DELAY = 3000;

class AsrWorkerManager {
  constructor() {
    this._worker = null;
    this._pending = new Map();
    this._ready = false;
  }

  start() { if (!this._worker) this._spawn(); }

  async stop() {
    if (this._worker) {
      for (const [, { reject }] of this._pending) reject(new Error('ASR Worker 已关闭'));
      this._pending.clear();
      await this._worker.terminate();
      this._worker = null;
      this._ready = false;
    }
  }

  send(type, payload = {}) {
    if (!this._worker || !this._ready) return Promise.reject(new Error('ASR Worker 未就绪'));
    const id = genId();
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._worker.postMessage({ id, type, payload });
    });
  }

  _spawn() {
    const workerPath = path.join(__dirname, 'asrWorker.js');
    this._worker = new Worker(workerPath);

    this._worker.on('message', (msg) => {
      // 引擎状态报告 → 同步模型卡片状态
      if (msg.type === 'statusChange' && msg.payload?.modelId) {
        const { modelId, status, port, pid } = msg.payload;
        if (status === 'running') {
          processManager.processes.set(modelId, { process: { pid }, port, type: 'asr', ready: true, logs: [], lastActivity: Date.now() });
        } else {
          processManager.processes.delete(modelId);
        }
        modelManager.update(modelId, { status });
        return;
      }
      const cb = this._pending.get(msg.id);
      if (!cb) return;
      this._pending.delete(msg.id);
      if (msg.type === 'result') cb.resolve(msg.payload);
      else cb.reject(msg.payload);
    });

    this._worker.on('error', (err) => {
      console.error('[AsrWorkerManager] Worker 错误:', err.message);
      this._ready = false;
      this._rejectAll(new Error(`ASR Worker 错误: ${err.message}`));
      this._worker = null;
      setTimeout(() => this._spawn(), RECONNECT_DELAY);
    });

    this._worker.on('exit', (code) => {
      console.warn(`[AsrWorkerManager] Worker 退出 (code=${code})`);
      this._ready = false;
      this._rejectAll(new Error('ASR Worker 已退出'));
      this._worker = null;
      if (code !== 0) setTimeout(() => this._spawn(), RECONNECT_DELAY);
    });

    this._worker.on('online', () => {
      this._ready = true;
      console.log('[AsrWorkerManager] ASR Worker 已就绪');
    });
  }

  _rejectAll(err) { for (const [, { reject }] of this._pending) reject(err); this._pending.clear(); }
}

export default new AsrWorkerManager();
