import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { MODELS_RUN_DIR } from '../config/constants.js';
import urlConverter from './urlConverter.js';
import downloadStateManager from './downloadStateManager.js';
import eventBus from './eventBus.js';

const TASK_CLEANUP_MS = 5 * 1000; // 5 seconds - 完成/失败后快速清理

/**
 * ComfyUI模型下载服务
 * 下载优先级：
 *   1. HTTP 直接下载 - ModelScope URL
 *   2. HTTP 直接下载 - hf-mirror URL
 *   永远不使用 huggingface.co 直连
 */
class ComfyUIDownloader {
  constructor() {
    this.tasks = new Map();
  }

  /**
   * 异步启动下载，立即返回 taskId
   * @param {Object} modelInfo
   * @param {Function} onComplete - 下载完成/失败时的回调
   * @returns {string} taskId
   */
  startDownload(modelInfo, onComplete = null) {
    const taskId = randomUUID();
    const abortController = new AbortController();

    // 注册到 downloadStateManager 以显示在下载中心
    const stateId = `comfyui_${taskId}`;
    const dsState = downloadStateManager.createState(stateId, modelInfo.filename, 'comfyui');
    dsState.comfyuiTaskId = taskId;
    dsState.displayName = `${modelInfo.filename}`;
    dsState._modelInfo = modelInfo; // 持久化时保留，重启后可重建任务

    this.tasks.set(taskId, {
      taskId,
      filename: modelInfo.filename,
      type: modelInfo.type,
      status: 'pending',
      progress: 0,
      totalBytes: null,
      downloadedBytes: null,
      speed: null,
      source: null,
      path: null,
      error: null,
      // 用于暂停/取消
      _abortController: abortController,
      _modelInfo: modelInfo,
      _onComplete: onComplete,
      _process: null,  // 当前运行的子进程引用
      _stateId: stateId  // 存储 stateId 用于后续更新
    });

    // 后台执行，不 await
    this._runDownload(taskId, modelInfo, onComplete);

    return taskId;
  }

  /**
   * 暂停下载
   */
  pauseDownload(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || (task.status !== 'downloading' && task.status !== 'pending')) {
      return false;
    }
    // 中止当前下载（子进程或 HTTP 请求）
    task._abortController.abort();
    if (task._process) {
      try { task._process.kill('SIGTERM'); } catch {}
      task._process = null;
    }
    task.status = 'paused';
    task.speed = 0;

    // 同步到 downloadStateManager
    downloadStateManager.setState(task._stateId, 'paused', null, task.filename);

    return true;
  }

  /**
   * 恢复下载
   */
  resumeDownload(taskId) {
    let task = this.tasks.get(taskId);

    // 程序重启后 tasks 为空，尝试从 downloadStateManager 恢复的状态重建任务
    if (!task) {
      const dsState = downloadStateManager.getFullStateByComfyuiTaskId(taskId);
      if (!dsState || !dsState._modelInfo) return false;

      task = {
        taskId,
        filename: dsState.targetQuantization,
        type: dsState._modelInfo.type,
        status: 'paused',
        progress: 0,
        totalBytes: null,
        downloadedBytes: null,
        speed: null,
        source: null,
        path: null,
        error: null,
        _abortController: new AbortController(),
        _modelInfo: dsState._modelInfo,
        _onComplete: null,
        _process: null,
        _stateId: dsState.id
      };
      this.tasks.set(taskId, task);
    }

    if (task.status !== 'paused') return false;
    // 创建新的 AbortController
    task._abortController = new AbortController();
    task.status = 'downloading';

    // 同步到 downloadStateManager
    downloadStateManager.setState(task._stateId, 'downloading', null, task.filename);

    // 重新启动下载（各下载方法内部支持断点续传）
    this._runDownload(taskId, task._modelInfo, task._onComplete);
    return true;
  }

  /**
   * 取消下载
   */
  cancelDownload(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      // 程序重启后 tasks 为空，直接从 downloadStateManager 清理残留状态
      const dsState = downloadStateManager.getFullStateByComfyuiTaskId(taskId);
      if (dsState) {
        downloadStateManager.deleteState(dsState.id, dsState.targetQuantization);
      }
      return true;
    }
    // 中止当前下载
    task._abortController.abort();
    if (task._process) {
      try { task._process.kill('SIGTERM'); } catch {}
      task._process = null;
    }
    task.status = 'cancelled';
    task.speed = 0;
    task.progress = 0;

    // 从 downloadStateManager 删除
    downloadStateManager.deleteState(task._stateId, task.filename);

    // 延迟清理临时文件（等待进程释放文件锁）
    const targetPath = this._getTargetPath(task.type, task.filename, task._modelInfo?.dest || null);
    this._cleanupTempFiles(targetPath);

    // 5秒后清理任务记录
    setTimeout(() => this.tasks.delete(taskId), 5000);
    return true;
  }

  /**
   * 延迟重试清理临时文件（Windows 下进程退出需要时间释放文件锁）
   */
  _cleanupTempFiles(targetPath, retries = 5, delay = 1000) {
    const tempPath = targetPath + '.part';
    let attempt = 0;
    const tryClean = () => {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
          console.log(`  ✓ 已删除临时文件: ${path.basename(tempPath)}`);
        }
      } catch (e) {
        if (attempt < retries - 1) {
          attempt++;
          setTimeout(tryClean, delay);
        } else {
          console.error(`  ✗ 临时文件删除失败: ${path.basename(tempPath)} (${e.code})`);
        }
      }
    };
    // 首次延迟 500ms 等进程退出
    setTimeout(tryClean, 500);
  }

  /**
   * 获取任务状态
   * @param {string} taskId
   * @returns {Object|null}
   */
  getTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      // 程序重启后 tasks 为空，从 downloadStateManager 恢复状态供前端轮询
      const dsState = downloadStateManager.getFullStateByComfyuiTaskId(taskId);
      if (dsState) {
        return {
          taskId,
          filename: dsState.targetQuantization,
          status: 'paused',
          progress: 0,
          totalBytes: null,
          downloadedBytes: null,
          speed: 0,
          _restoredFromDisk: true
        };
      }
      return null;
    }
    // 不暴露内部字段
    const { _abortController, _modelInfo, _onComplete, _process, ...publicTask } = task;
    return publicTask;
  }

  /**
   * 后台执行下载，更新任务状态
   */
  async _runDownload(taskId, modelInfo, onComplete) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'downloading';
    downloadStateManager.setState(task._stateId, 'downloading', null, task.filename);

    try {
      const result = await this.download(modelInfo, (info) => {
        const t = this.tasks.get(taskId);
        if (!t) return;
        t.progress = info.progress;
        if (info.totalBytes != null) t.totalBytes = info.totalBytes;
        if (info.downloadedBytes != null) t.downloadedBytes = info.downloadedBytes;
        if (info.speed != null) t.speed = info.speed;

        // 同步进度到 downloadStateManager
        downloadStateManager.updateProgress(t._stateId, info.progress, info.speed || 0, t.filename);
        downloadStateManager.updateBytes(t._stateId, info.downloadedBytes || 0, info.totalBytes || 0, t.filename);
      }, task._abortController.signal);

      const t = this.tasks.get(taskId);
      if (t) {
        if (result.success) {
          t.status = 'completed';
          t.progress = 100;
          t.source = result.source;
          t.path = result.path;
          downloadStateManager.setState(t._stateId, 'completed', null, t.filename);
        } else if (result.aborted) {
          // 被暂停或取消，不覆盖状态
          return;
        } else {
          t.status = 'failed';
          t.error = result.error;
          downloadStateManager.setState(t._stateId, 'failed', result.error, t.filename);
        }
      }

      if (onComplete && !result.aborted) {
        onComplete(result);
      }
    } catch (error) {
      const t = this.tasks.get(taskId);
      if (t && t.status !== 'paused' && t.status !== 'cancelled') {
        t.status = 'failed';
        t.error = error.message;
        downloadStateManager.setState(t._stateId, 'failed', error.message, t.filename);
        if (onComplete) {
          onComplete({ success: false, error: error.message });
        }
      }
    }

    // 仅在终态时设置自动清理
    const finalTask = this.tasks.get(taskId);
    if (finalTask && (finalTask.status === 'completed' || finalTask.status === 'failed')) {
      setTimeout(() => {
        this.tasks.delete(taskId);
        downloadStateManager.deleteState(finalTask._stateId, finalTask.filename);
      }, TASK_CLEANUP_MS);
    }
  }

  /**
   * 主下载方法 - 按优先级依次尝试
   * @param {Object} modelInfo
   * @param {Function} onProgress - 进度回调 (0-100)
   */
  async download(modelInfo, onProgress = null, abortSignal = null) {
    const targetPath = this._getTargetPath(modelInfo.type, modelInfo.filename, modelInfo.dest || null);

    if (fs.existsSync(targetPath)) {
      console.log(`文件已存在，跳过下载: ${targetPath}`);
      if (onProgress) onProgress({ progress: 100 });
      return { success: true, path: targetPath, cached: true };
    }

    const originalUrl = modelInfo.original_url || modelInfo.download_sources?.original;
    if (!originalUrl) {
      return { success: false, error: '没有可用的下载源' };
    }

    console.log(`\n开始下载: ${modelInfo.filename}`);
    console.log(`原始URL: ${originalUrl}`);

    const checkAborted = () => abortSignal?.aborted;

    // 1. HTTP - ModelScope URL
    if (checkAborted()) return { aborted: true };
    console.log('[1/2] 尝试 HTTP (ModelScope)...');
    const msUrl = this._toModelScopeUrl(originalUrl);
    if (msUrl && await this._downloadWithHTTP(msUrl, targetPath, onProgress, abortSignal)) {
      return { success: true, path: targetPath, source: 'http_modelscope' };
    }

    // 2. HTTP - hf-mirror URL
    if (checkAborted()) return { aborted: true };
    console.log('[2/2] 尝试 HTTP (hf-mirror)...');
    const hfMirrorUrl = this._toHFMirrorUrl(originalUrl);
    if (hfMirrorUrl && await this._downloadWithHTTP(hfMirrorUrl, targetPath, onProgress, abortSignal)) {
      return { success: true, path: targetPath, source: 'http_hf_mirror' };
    }

    if (checkAborted()) return { aborted: true };
    return { success: false, error: '所有下载源都失败' };
  }

  // ────────────────────────────── private ──────────────────────────────

  /**
   * 使用 HTTP 直接下载，带进度/速度回调，支持 Range 断点续传
   */
  async _downloadWithHTTP(url, targetPath, onProgress, abortSignal = null) {
    const tempPath = targetPath + '.part';
    try {
      console.log(`  HTTP 下载: ${url}`);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });

      // 检查是否有未完成的临时文件，支持续传
      let resumeBytes = 0;
      if (fs.existsSync(tempPath)) {
        resumeBytes = fs.statSync(tempPath).size;
        if (resumeBytes > 0) {
          console.log(`  HTTP 断点续传: 已有 ${(resumeBytes / 1024 / 1024).toFixed(1)} MB`);
        }
      }

      const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; NovaMax/1.0)' };
      if (resumeBytes > 0) {
        headers['Range'] = `bytes=${resumeBytes}-`;
      }

      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 30000,
        headers,
        signal: abortSignal || undefined
      });

      // 服务器返回 206 表示支持 Range，否则从头下载
      const isResume = response.status === 206 && resumeBytes > 0;
      if (resumeBytes > 0 && !isResume) {
        console.log('  服务器不支持 Range，从头下载');
        resumeBytes = 0;
      }

      const contentLength = parseInt(response.headers['content-length']) || 0;
      const totalBytes = isResume ? resumeBytes + contentLength : contentLength;
      let downloadedBytes = resumeBytes;
      const startTime = Date.now() - (resumeBytes > 0 ? 1 : 0); // 避免除零
      let lastNotifyTime = 0;

      const writer = fs.createWriteStream(tempPath, { flags: isResume ? 'a' : 'w' });

      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          downloadedBytes += chunk.length;

          if (!onProgress) return;
          const now = Date.now();
          if (now - lastNotifyTime < 500 && downloadedBytes < totalBytes) return;
          lastNotifyTime = now;

          const elapsedSec = (now - startTime) / 1000 || 0.001;
          const speed = Math.round((downloadedBytes - resumeBytes) / elapsedSec);
          const progress = totalBytes > 0 ? Math.floor(downloadedBytes / totalBytes * 100) : 0;

          onProgress({ progress, totalBytes: totalBytes || null, downloadedBytes, speed });
        });

        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      fs.renameSync(tempPath, targetPath);
      console.log(`  ✅ HTTP 下载成功`);
      return true;
    } catch (error) {
      console.log(`  HTTP 下载失败: ${error.message}（.part 文件已保留，下次可续传）`);
      // 不删除临时文件，保留供下次续传
      return false;
    }
  }

  /**
   * 解析 tqdm stderr 行，提取进度/大小/速度
   * tqdm 格式示例：
   *   50%|█████     | 1.00G/2.00G [01:15<01:15, 6.67MB/s]
   *   Downloading model.safetensors: 100%|██| 5.00G/5.00G [02:30, 35.2MB/s]
   */
  /**
   * 获取模型目标路径
   * type 是 ComfyUI 目录名（text_encoders / vae / diffusion_models / checkpoints 等）
   */
  _getTargetPath(type, filename, dest = null) {
    if (dest) return path.join(dest, filename);
    const modelsDir = path.join(MODELS_RUN_DIR, 'comfyui', 'models');
    return path.join(modelsDir, type, filename);
  }

  /**
   * 将 URL 转换为 ModelScope 格式
   */
  _toModelScopeUrl(url) {
    if (!url) return null;
    if (url.includes('modelscope.cn')) return url;
    if (url.includes('huggingface.co')) {
      return url.replace('huggingface.co', 'modelscope.cn/models');
    }
    return null;
  }

  /**
   * 将 URL 转换为 hf-mirror 格式
   * 永远不返回 huggingface.co
   */
  _toHFMirrorUrl(url) {
    if (!url) return null;
    if (url.includes('hf-mirror.com')) return url;
    if (url.includes('huggingface.co')) {
      return url.replace('huggingface.co', 'hf-mirror.com');
    }
    if (url.includes('modelscope.cn/models')) {
      return url.replace('modelscope.cn/models', 'hf-mirror.com');
    }
    return null;
  }

  /**
   * 清理临时目录
   */
  _cleanDir(dir) {
    if (fs.existsSync(dir)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
}

export default new ComfyUIDownloader();
