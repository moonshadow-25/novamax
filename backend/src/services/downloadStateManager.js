/**
 * 下载临时状态管理器
 *
 * 职责：
 * - 管理所有下载任务的临时状态（仅在内存中）
 * - 不持久化任何临时数据到数据库
 * - 后端重启时状态自动清空
 * - 支持同一模型的多个量化版本并发下载
 */
import eventBus from './eventBus.js';

class DownloadStateManager {
  constructor() {
    this.states = new Map(); // key: "modelId" or "modelId::quantName" -> state
    this._lastBroadcast = 0;
  }

  /** 构建内部 key */
  _key(modelId, quantName) {
    return quantName ? `${modelId}::${quantName}` : modelId;
  }

  /**
   * 获取下载状态
   */
  getState(modelId, quantName) {
    const state = this.states.get(this._key(modelId, quantName));
    if (!state) return null;
    return {
      status: state.status,
      progress: state.progress,
      error: state.error,
      targetQuantization: state.targetQuantization,
      speed: state.speed,
      startTime: state.startTime
    };
  }

  /**
   * 获取某个模型的所有下载任务（返回数组）
   */
  getStatesByModel(modelId) {
    const result = [];
    for (const [key, state] of this.states.entries()) {
      if (key === modelId || key.startsWith(modelId + '::')) {
        result.push({
          status: state.status,
          progress: state.progress,
          error: state.error,
          targetQuantization: state.targetQuantization,
          speed: state.speed,
          startTime: state.startTime
        });
      }
    }
    return result;
  }

  /**
   * 创建新的下载状态
   * @param {string} id - 模型ID或引擎ID
   * @param {string} targetQuantization - 量化版本（模型）或版本号（引擎）
   * @param {string} type - 下载类型：'model' 或 'engine'
   */
  createState(id, targetQuantization, type = 'model') {
    const state = {
      id,
      modelId: type === 'model' ? id : null, // 兼容旧代码
      engineId: type === 'engine' ? id : null,
      type,
      status: 'downloading',
      progress: 0,
      error: null,
      targetQuantization,
      speed: 0,
      startTime: Date.now(),
      pythonProcess: null,
      controller: null,
      downloadedBytes: 0,
      totalBytes: 0,
      files: []
    };
    this.states.set(this._key(id, targetQuantization), state);
    return state;
  }

  /**
   * 更新下载进度
   */
  updateProgress(modelId, progress, speed = 0, quantName) {
    const state = this.states.get(this._key(modelId, quantName));
    if (state) {
      state.progress = progress;
      state.speed = speed;
      // 限流：最多每 2 秒广播一次进度
      const now = Date.now();
      if (now - this._lastBroadcast >= 2000) {
        this._lastBroadcast = now;
        eventBus.broadcast('download-progress', { modelId });
      }
    }
  }

  /**
   * 更新下载字节数
   */
  updateBytes(modelId, downloadedBytes, totalBytes, quantName) {
    const state = this.states.get(this._key(modelId, quantName));
    if (state) {
      state.downloadedBytes = downloadedBytes;
      if (totalBytes !== undefined) {
        state.totalBytes = totalBytes;
      }
    }
  }

  /**
   * 设置下载状态
   */
  setState(modelId, status, error = null, quantName) {
    const state = this.states.get(this._key(modelId, quantName));
    if (state) {
      state.status = status;
      state.error = error;
      eventBus.broadcast('download-progress', { modelId, status });
    }
  }

  /**
   * 删除单个下载状态
   */
  deleteState(modelId, quantName) {
    this.states.delete(this._key(modelId, quantName));
  }

  /**
   * 删除某个模型的所有下载状态
   */
  deleteAllStates(modelId) {
    for (const key of [...this.states.keys()]) {
      if (key === modelId || key.startsWith(modelId + '::')) {
        this.states.delete(key);
      }
    }
  }

  /**
   * 获取所有下载状态（按 key 映射）
   */
  getAllStates() {
    const result = {};
    for (const [key, state] of this.states.entries()) {
      result[key] = {
        id: state.id,
        modelId: state.modelId,
        engineId: state.engineId,
        type: state.type || 'model', // 兼容旧数据
        status: state.status,
        progress: state.progress,
        error: state.error,
        targetQuantization: state.targetQuantization,
        speed: state.speed,
        startTime: state.startTime,
        downloadedBytes: state.downloadedBytes,
        totalBytes: state.totalBytes
      };
    }
    return result;
  }

  /**
   * 获取完整状态（包含内部字段，用于 downloadService）
   */
  getFullState(modelId, quantName) {
    return this.states.get(this._key(modelId, quantName)) || null;
  }

  /**
   * 设置 Python 进程引用
   */
  setPythonProcess(modelId, process, quantName) {
    const state = this.states.get(this._key(modelId, quantName));
    if (state) {
      state.pythonProcess = process;
    }
  }

  /**
   * 设置 AbortController
   */
  setController(modelId, controller, quantName) {
    const state = this.states.get(this._key(modelId, quantName));
    if (state) {
      state.controller = controller;
    }
  }

  /**
   * 检查下载是否存在
   */
  hasDownload(modelId, quantName) {
    return this.states.has(this._key(modelId, quantName));
  }
}

export default new DownloadStateManager();

