/**
 * 下载临时状态管理器
 *
 * 职责：
 * - 管理所有下载任务的临时状态（仅在内存中）
 * - 不持久化任何临时数据到数据库
 * - 后端重启时状态自动清空
 */
class DownloadStateManager {
  constructor() {
    this.states = new Map(); // modelId -> state
  }

  /**
   * 获取下载状态
   * @param {string} modelId - 模型ID
   * @returns {object|null} 下载状态对象
   */
  getState(modelId) {
    const state = this.states.get(modelId);
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
   * 创建新的下载状态
   * @param {string} modelId - 模型ID
   * @param {string} targetQuantization - 目标量化版本
   * @returns {object} 下载状态对象
   */
  createState(modelId, targetQuantization) {
    const state = {
      modelId,  // 保存 modelId，方便后续引用
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
    this.states.set(modelId, state);
    return state;
  }

  /**
   * 更新下载进度（只在内存中）
   * @param {string} modelId - 模型ID
   * @param {number} progress - 进度（0-100）
   * @param {number} speed - 下载速度（bytes/sec）
   */
  updateProgress(modelId, progress, speed = 0) {
    const state = this.states.get(modelId);
    if (state) {
      state.progress = progress;
      state.speed = speed;
    }
  }

  /**
   * 更新下载字节数
   * @param {string} modelId - 模型ID
   * @param {number} downloadedBytes - 已下载字节数
   * @param {number} totalBytes - 总字节数
   */
  updateBytes(modelId, downloadedBytes, totalBytes) {
    const state = this.states.get(modelId);
    if (state) {
      state.downloadedBytes = downloadedBytes;
      if (totalBytes !== undefined) {
        state.totalBytes = totalBytes;
      }
    }
  }

  /**
   * 设置下载状态
   * @param {string} modelId - 模型ID
   * @param {string} status - 状态（downloading/paused/completed/failed）
   * @param {string|null} error - 错误信息
   */
  setState(modelId, status, error = null) {
    const state = this.states.get(modelId);
    if (state) {
      state.status = status;
      state.error = error;
    }
  }

  /**
   * 删除下载状态
   * @param {string} modelId - 模型ID
   */
  deleteState(modelId) {
    this.states.delete(modelId);
  }

  /**
   * 获取所有下载状态
   * @returns {object} 所有下载状态的映射
   */
  getAllStates() {
    const result = {};
    for (const [modelId, state] of this.states.entries()) {
      result[modelId] = this.getState(modelId);
    }
    return result;
  }

  /**
   * 获取完整状态（包含内部字段，用于 downloadService）
   * @param {string} modelId - 模型ID
   * @returns {object|null} 完整的状态对象
   */
  getFullState(modelId) {
    return this.states.get(modelId) || null;
  }

  /**
   * 设置 Python 进程引用
   * @param {string} modelId - 模型ID
   * @param {object} process - Python 进程对象
   */
  setPythonProcess(modelId, process) {
    const state = this.states.get(modelId);
    if (state) {
      state.pythonProcess = process;
    }
  }

  /**
   * 设置 AbortController
   * @param {string} modelId - 模型ID
   * @param {AbortController} controller - AbortController 实例
   */
  setController(modelId, controller) {
    const state = this.states.get(modelId);
    if (state) {
      state.controller = controller;
    }
  }

  /**
   * 检查下载是否存在
   * @param {string} modelId - 模型ID
   * @returns {boolean}
   */
  hasDownload(modelId) {
    return this.states.has(modelId);
  }
}

export default new DownloadStateManager();
