/**
 * TTS Task Queue
 *
 * 按引擎类型的 max_concurrency 控制并发。
 * 引擎适配器是同步的一次合成调用，队列负责把 NovaMax 的批量请求
 * 串行化/并行化为对 adapter.synthesize() 的多次调用。
 */
import crypto from 'crypto';

const genId = () => `task-${crypto.randomUUID().slice(0, 12)}`;

class TtsTaskQueue {
  constructor() {
    /** @type {Map<string, QueueItem[]>} engineType -> waiting queue */
    this._queues = new Map();
    /** @type {Map<string, number>} engineType -> current active count */
    this._active = new Map();
  }

  /* ========================================================================
   * 公共 API
   * ======================================================================== */

  /**
   * 提交一批合成请求。
   *
   * @param {object} opts
   * @param {string} opts.engineType
   * @param {number} opts.maxConcurrency
   * @param {Array<{text: string, voice: object, output_format: string, params: object}>} opts.items
   * @param {function} synthesizeFn - (item, index) => Promise<SynthesizeResult>
   * @param {function} [onProgress] - (completed, total) => void
   * @returns {Promise<BatchResult>}
   */
  async enqueue(opts, synthesizeFn, onProgress) {
    const { engineType, maxConcurrency, items } = opts;
    const total = items.length;
    const results = new Array(total);
    const errors = new Array(total);
    let completed = 0;

    return new Promise((resolve) => {
      const queue = this._getQueue(engineType);
      let nextIndex = 0;

      const tryNext = async () => {
        while (nextIndex < total && this._getActive(engineType) < maxConcurrency) {
          const idx = nextIndex++;
          this._incActive(engineType);

          const item = items[idx];
          try {
            results[idx] = await synthesizeFn(item, idx);
          } catch (e) {
            errors[idx] = { index: idx, error: e };
          }

          this._decActive(engineType);
          completed++;
          if (onProgress) onProgress(completed, total);
          tryNext();
        }

        if (completed >= total) {
          resolve({ results, errors: errors.filter(Boolean), total, completed });
        }
      };

      tryNext();
    });
  }

  /** 获取引擎当前的活跃任务数 */
  getActiveCount(engineType) {
    return this._getActive(engineType);
  }

  /* ========================================================================
   * 内部
   * ======================================================================== */

  _getQueue(engineType) {
    if (!this._queues.has(engineType)) this._queues.set(engineType, []);
    return this._queues.get(engineType);
  }

  _getActive(engineType) {
    return this._active.get(engineType) || 0;
  }

  _incActive(engineType) {
    this._active.set(engineType, this._getActive(engineType) + 1);
  }

  _decActive(engineType) {
    this._active.set(engineType, Math.max(0, this._getActive(engineType) - 1));
  }
}

const ttsTaskQueue = new TtsTaskQueue();
export default ttsTaskQueue;
