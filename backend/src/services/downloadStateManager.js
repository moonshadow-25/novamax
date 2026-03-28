/**
 * 下载临时状态管理器
 *
 * 职责：
 * - 管理所有下载任务的内存状态
 * - 将 downloading / paused 状态持久化到 download_state.json
 *   程序崩溃或被关闭后，重启时可从文件恢复为 paused 状态
 * - 支持同一模型的多个量化版本并发下载
 */
import fs from 'fs';
import eventBus from './eventBus.js';
import { DOWNLOAD_STATE_FILE } from '../config/constants.js';

class DownloadStateManager {
  constructor() {
    this.states = new Map(); // key: "modelId" or "modelId::quantName" -> state
    this._lastBroadcast = 0;
    this._load(); // 启动时从磁盘恢复中断的下载
  }

  /** 构建内部 key */
  _key(modelId, quantName) {
    return quantName ? `${modelId}::${quantName}` : modelId;
  }

  /**
   * 将 downloading / paused 状态写入持久化文件
   * 每次状态变更时调用，文件内容始终与内存一致
   */
  _persist() {
    const records = {};
    for (const [key, state] of this.states.entries()) {
      // 引擎不持久化：下载不支持断点续传，重启后直接重头下载即可，不需要恢复暂停状态
      if (state.type === 'engine') continue;
      if (state.status === 'downloading' || state.status === 'paused') {
        records[key] = {
          id: state.id,
          type: state.type || 'model',
          quantName: state.targetQuantization || null,
          startedAt: state.startTime,
          // ComfyUI 专用字段
          displayName: state.displayName || null,
          comfyuiTaskId: state.comfyuiTaskId || null,
          // ComfyUI 下载需要 modelInfo 才能重建任务
          modelInfo: state.type === 'comfyui' ? (state._modelInfo || null) : undefined
        };
      }
    }
    try {
      fs.writeFileSync(DOWNLOAD_STATE_FILE, JSON.stringify(records, null, 2), 'utf-8');
    } catch (e) {
      console.error('[downloadState] 持久化失败:', e.message);
    }
  }

  /**
   * 启动时从持久化文件恢复中断的下载任务（全部标记为 paused）
   */
  _load() {
    if (!fs.existsSync(DOWNLOAD_STATE_FILE)) return;
    try {
      const raw = fs.readFileSync(DOWNLOAD_STATE_FILE, 'utf-8');
      const records = JSON.parse(raw);
      let count = 0;
      for (const [key, record] of Object.entries(records)) {
        const state = {
          id: record.id,
          modelId: record.type === 'model' ? record.id : null,
          engineId: record.type === 'engine' ? record.id : null,
          type: record.type || 'model',
          status: 'paused',          // 程序重启后统一视为暂停
          progress: 0,               // 进度由路由层从 .part 文件重新推算
          error: null,
          targetQuantization: record.quantName || null,
          speed: 0,
          startTime: record.startedAt || Date.now(),
          pythonProcess: null,
          controller: null,
          downloadedBytes: 0,
          totalBytes: 0,
          files: [],
          displayName: record.displayName || null,
          comfyuiTaskId: record.comfyuiTaskId || null,
          _modelInfo: record.modelInfo || null,  // ComfyUI 重建任务所需
          _restoredFromDisk: true    // 标记为磁盘恢复，路由层据此补算进度
        };
        this.states.set(key, state);
        count++;
      }
      if (count > 0) {
        console.log(`[downloadState] 从磁盘恢复 ${count} 个中断的下载任务`);
      }
    } catch (e) {
      console.error('[downloadState] 加载持久化文件失败:', e.message);
    }
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
          startTime: state.startTime,
          _restoredFromDisk: state._restoredFromDisk || false
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
      files: [],
      _restoredFromDisk: false
    };
    this.states.set(this._key(id, targetQuantization), state);
    this._persist();
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
      this._persist();
    }
  }

  /**
   * 删除单个下载状态
   */
  deleteState(modelId, quantName) {
    this.states.delete(this._key(modelId, quantName));
    this._persist();
    eventBus.broadcast('download-progress', { modelId });
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
    this._persist();
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
        totalBytes: state.totalBytes,
        // ComfyUI 扩展字段
        comfyuiTaskId: state.comfyuiTaskId || null,
        displayName: state.displayName || null
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
   * 通过 comfyuiTaskId 查找完整状态（用于程序重启后重建 ComfyUI 任务）
   */
  getFullStateByComfyuiTaskId(taskId) {
    for (const state of this.states.values()) {
      if (state.comfyuiTaskId === taskId) return state;
    }
    return null;
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

