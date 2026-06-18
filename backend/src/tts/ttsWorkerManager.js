/**
 * TTS Worker Manager — 主线程侧代理。
 *
 * 管理 TTS Worker 线程的生命周期，提供消息收发接口。
 * 所有 TTS 路由通过此模块与 Worker 通信。
 */
import { Worker } from 'worker_threads';
import path from 'path';
import crypto from 'crypto';
import { PROJECT_ROOT } from '../config/constants.js';

const genId = () => crypto.randomUUID().slice(0, 12);
const RECONNECT_DELAY = 3000;

class TtsWorkerManager {
  constructor() {
    /** @type {Worker|null} */
    this._worker = null;
    /** @type {Map<string, { resolve: Function, reject: Function }>} */
    this._pending = new Map();
    this._ready = false;
    this._restartTimer = null;
    this._stopping = false;
  }

  /* ========================================================================
   * 生命周期
   * ======================================================================== */

  start() {
    this._stopping = false;
    if (this._worker || this._restartTimer) return;
    this._spawn();
  }

  async stop() {
    this._stopping = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this._worker) {
      // 拒绝所有 pending 请求
      for (const [, { reject }] of this._pending) {
        reject(new Error('TTS Worker 已关闭'));
      }
      this._pending.clear();
      await this._worker.terminate();
      this._worker = null;
      this._ready = false;
    }
  }

  /* ========================================================================
   * 消息发送
   * ======================================================================== */

  /**
   * 发送请求到 TTS Worker 并等待响应。
   * @param {string} type
   * @param {object} [payload]
   * @returns {Promise<any>}
   */
  send(type, payload = {}) {
    if (!this._worker || !this._ready) {
      return Promise.reject(new Error('TTS Worker 未就绪'));
    }
    const id = genId();
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._worker.postMessage({ id, type, payload });
    });
  }

  /* ========================================================================
   * 内部
   * ======================================================================== */

  _spawn() {
    if (this._stopping || this._worker) return;

    const workerPath = path.join(PROJECT_ROOT, 'backend', 'src', 'tts', 'ttsWorker.js');
    this._worker = new Worker(workerPath, {
      workerData: { PROJECT_ROOT },
      stdout: true, stderr: true
    });

    if (this._worker.stdout) {
      this._worker.stdout.on('data', chunk => process.stdout.write(chunk));
    }
    if (this._worker.stderr) {
      this._worker.stderr.on('data', chunk => process.stderr.write(chunk));
    }

    this._worker.on('message', (msg) => {
      const cb = this._pending.get(msg.id);
      if (!cb) return;
      this._pending.delete(msg.id);

      if (msg.type === 'result') {
        cb.resolve(msg.payload);
      } else {
        cb.reject(msg.payload);
      }
    });

    this._worker.on('error', (err) => {
      console.error('[TtsWorkerManager] Worker 错误:', err?.stack || err?.message || err);
      this._ready = false;
      this._rejectAll(new Error(`TTS Worker 错误: ${err?.message || 'unknown error'}`));
      this._worker = null;
      this._scheduleRestart();
    });

    this._worker.on('exit', (code) => {
      console.warn(`[TtsWorkerManager] Worker 退出 (code=${code})`);
      this._ready = false;
      this._rejectAll(new Error('TTS Worker 已退出'));
      this._worker = null;
      if (code !== 0) {
        this._scheduleRestart();
      }
    });

    this._worker.on('online', () => {
      this._ready = true;
      console.log('[TtsWorkerManager] TTS Worker 已就绪');
    });
  }

  _scheduleRestart() {
    if (this._stopping || this._restartTimer) {
      return;
    }

    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      this._spawn();
    }, RECONNECT_DELAY);
  }

  _rejectAll(err) {
    for (const [, { reject }] of this._pending) reject(err);
    this._pending.clear();
  }
}

const ttsWorkerManager = new TtsWorkerManager();
export default ttsWorkerManager;
