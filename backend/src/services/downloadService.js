import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { DOWNLOADS_DIR, MODELS_RUN_DIR } from '../config/constants.js';
import modelManager from './modelManager.js';
import engineManager from './engineManager.js';
import presetService from './presetService.js';
import downloadStateManager from './downloadStateManager.js';
import { getModelPath } from '../utils/pathHelper.js';
import { isQuantizationIncomplete } from '../utils/fileIntegrity.js';

class DownloadService extends EventEmitter {
  constructor() {
    super();
    // activeDownloads 已被 downloadStateManager 替代
    this.ensureDownloadDir();
  }

  ensureDownloadDir() {
    // 确保下载目录存在
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }
  }

  /**
   * 清理遗留的下载状态（已废弃，保留空方法避免错误）
   * 临时状态现在只存在于内存中，重启后自动清空
   */
  async cleanupStaleDownloads() {
    console.log('✓ 临时下载状态仅保存在内存中，无需清理');
  }

  /**
   * 开始下载模型
   * @param {string} modelId - 模型ID
   * @param {string} quantizationName - 可选：指定要下载的量化版本
   */
  async startDownload(modelId, quantizationName = null) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    // 只处理LLM类型的模型，ComfyUI模型使用comfyuiDownloader
    if (model.type !== 'llm') {
      throw new Error(`此下载服务仅支持LLM模型，${model.type}类型请使用对应的下载服务`);
    }

    // 确定目标量化版本（在检查状态之前确定，用于复合 key）
    let targetQuantization = quantizationName;
    if (!targetQuantization && model.quantizations && model.quantizations.length > 0) {
      targetQuantization = model.selected_quantization;
    }

    // 检查该量化版本是否已有活跃下载（使用复合 key，允许不同量化版本并发）
    const existingDownload = downloadStateManager.getFullState(modelId, targetQuantization);
    if (existingDownload && existingDownload.status !== 'paused') {
      throw new Error('该量化版本已在下载中');
    }

    // 如果是暂停状态，清理旧的下载状态
    if (existingDownload && existingDownload.status === 'paused') {
      downloadStateManager.deleteState(modelId, targetQuantization);
    }

    // 检查要下载的量化版本是否已下载
    if (model.quantizations && model.quantizations.length > 0) {
      const downloadedQuants = model.downloaded_quantizations || [];

      if (targetQuantization && downloadedQuants.includes(targetQuantization)) {
        // 验证文件完整性，防止部分下载后被误判为已完成
        const modelDir = getModelPath(MODELS_RUN_DIR, model);
        const quantInfo = model.quantizations.find(q => q.name === targetQuantization);
        const incomplete = isQuantizationIncomplete(modelDir, quantInfo, model);

        if (incomplete) {
          // 文件不完整，清除已下载记录，允许重新下载
          console.warn(`[download] ${targetQuantization} 文件不完整，清除记录重新下载`);
          const cleanedFiles = (model.downloaded_files || []).filter(
            f => f.matched_preset !== targetQuantization
          );
          const cleanedQuants = downloadedQuants.filter(q => q !== targetQuantization);
          await modelManager.update(modelId, {
            downloaded_files: cleanedFiles,
            downloaded_quantizations: cleanedQuants,
            downloaded: cleanedFiles.some(f => f.is_active) || cleanedQuants.length > 0,
            selected_quantization: targetQuantization
          });
        } else {
          throw new Error(`量化版本 ${targetQuantization} 已下载`);
        }
      }
    } else {
      // 没有量化版本，检查整体下载状态
      if (model.downloaded) {
        throw new Error('模型已下载');
      }
    }

    // 创建内存中的下载状态（不持久化到数据库）
    downloadStateManager.createState(modelId, targetQuantization);
    downloadStateManager.setController(modelId, new AbortController(), targetQuantization);

    // 获取完整的状态对象用于内部方法
    const downloadState = downloadStateManager.getFullState(modelId, targetQuantization);

    // 不再保存任何临时字段到数据库

    // 开始下载 - 使用 ModelScope
    this._downloadModelWithModelScope(model, downloadState).catch(error => {
      console.error(`Download failed for ${modelId}:`, error);
      this._handleDownloadError(modelId, error, targetQuantization);
    });

    return downloadState;
  }

  /**
   * 暂停下载
   */
  async pauseDownload(modelId, quantName) {
    const downloadState = downloadStateManager.getFullState(modelId, quantName);
    if (!downloadState) {
      throw new Error('下载任务不存在');
    }

    // 如果有 Python 进程（hf_downloader 等），终止它
    if (downloadState.pythonProcess) {
      try {
        downloadState.pythonProcess.kill('SIGTERM');
        console.log(`已终止 Python 下载进程: ${modelId}`);
      } catch (error) {
        console.error('终止进程失败:', error);
      }
    }

    // 终止 Node.js HTTP 下载（中止 axios 请求）
    if (downloadState.controller) {
      try {
        downloadState.controller.abort();
      } catch (error) {
        console.error('终止 HTTP 下载失败:', error);
      }
    }

    // 只在内存中标记为暂停，不写数据库
    downloadStateManager.setState(modelId, 'paused', null, quantName);

    return downloadStateManager.getState(modelId, quantName);
  }

  /**
   * 恢复下载
   */
  async resumeDownload(modelId, quantName) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    let downloadState = downloadStateManager.getFullState(modelId, quantName);
    const resolvedQuant = quantName || model.selected_quantization;
    if (!downloadState) {
      downloadStateManager.createState(modelId, resolvedQuant);
      downloadStateManager.setController(modelId, new AbortController(), resolvedQuant);
      downloadState = downloadStateManager.getFullState(modelId, resolvedQuant);
    } else {
      downloadStateManager.setState(modelId, 'downloading', null, resolvedQuant);
      downloadStateManager.setController(modelId, new AbortController(), resolvedQuant);
    }

    this._downloadModelWithModelScope(model, downloadState).catch(error => {
      console.error(`Resume download failed for ${modelId}:`, error);
      this._handleDownloadError(modelId, error, resolvedQuant);
    });

    return downloadStateManager.getState(modelId, resolvedQuant);
  }

  /**
   * 取消下载
   */
  async cancelDownload(modelId, quantName) {
    const downloadState = downloadStateManager.getFullState(modelId, quantName);

    /** 删除目标目录中属于该下载任务的 .part 文件 */
    const _deletePartFiles = (model, qName) => {
      const targetDir = getModelPath(MODELS_RUN_DIR, model);
      if (!fs.existsSync(targetDir)) return;

      const effectiveQuant = qName || downloadState?.targetQuantization;
      const partFiles = fs.readdirSync(targetDir).filter(f => f.endsWith('.part'));

      if (!effectiveQuant || partFiles.length === 0) return;

      // 尝试精确匹配该量化版本的 .gguf.part 文件
      const quantInfo = model.quantizations?.find(q => q.name === effectiveQuant);
      const matchedParts = partFiles.filter(f => {
        const base = f.replace(/\.part$/, '');
        if (quantInfo?.filename) {
          return base.toLowerCase() === quantInfo.filename.toLowerCase();
        }
        // 通配符：文件名包含量化版本名称
        return new RegExp(`${effectiveQuant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(base);
      });

      // 如果没有精确匹配，删除所有 .part 文件（回退策略）
      const toDelete = matchedParts.length > 0 ? matchedParts : partFiles;
      for (const f of toDelete) {
        try {
          fs.unlinkSync(path.join(targetDir, f));
          console.log(`已删除 .part 文件: ${f}`);
        } catch (err) {
          console.warn(`删除 .part 文件失败: ${f}`, err.message);
        }
      }
    };

    // 如果下载任务不在内存中（例如后端重启后），直接清理 .part 文件
    if (!downloadState) {
      console.log(`下载任务不在内存中，清理 .part 文件: ${modelId}`);

      const model = modelManager.getById(modelId);
      if (model) {
        _deletePartFiles(model, quantName);

        const downloadedQuantizations = model.downloaded_quantizations || [];
        const hasOtherDownloaded = downloadedQuantizations.length > 0;

        await modelManager.update(modelId, {
          downloaded: hasOtherDownloaded,
          local_path: hasOtherDownloaded ? model.local_path : null
        });
      }

      return { success: true };
    }

    // 标记为取消中，防止进程退出时误报失败
    downloadStateManager.setState(modelId, 'cancelling', null, quantName);

    // 如果有 Python 进程，强制终止它并等待退出
    if (downloadState.pythonProcess) {
      try {
        const pid = downloadState.pythonProcess.pid;
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', pid.toString(), '/T', '/F']);
          console.log(`已强制终止 Python 进程树: ${pid}`);
        } else {
          downloadState.pythonProcess.kill('SIGKILL');
          console.log(`已强制终止 Python 进程: ${modelId}`);
        }
        // 等待进程完全退出，释放文件句柄
        await new Promise(resolve => {
          const onExit = () => resolve();
          downloadState.pythonProcess.on('exit', onExit);
          downloadState.pythonProcess.on('error', onExit);
          // 超时兜底
          setTimeout(onExit, 3000);
        });
      } catch (error) {
        console.error('终止进程失败:', error);
      }
    }

    // 如果有 axios controller，终止 HTTP 下载
    if (downloadState.controller) {
      try {
        downloadState.controller.abort();
        console.log(`已终止 HTTP 下载: ${modelId}`);
      } catch (error) {
        console.error('终止 HTTP 下载失败:', error);
      }
      // 等待文件句柄释放
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 从内存中删除下载状态
    downloadStateManager.deleteState(modelId, quantName);

    // 删除该量化版本的 .part 文件
    const model = modelManager.getById(modelId);
    if (model) {
      _deletePartFiles(model, quantName || downloadState.targetQuantization);

      const downloadedQuantizations = model.downloaded_quantizations || [];
      const hasOtherDownloaded = downloadedQuantizations.length > 0;

      await modelManager.update(modelId, {
        downloaded: hasOtherDownloaded,
        local_path: hasOtherDownloaded ? model.local_path : null
      });
    }

    return { success: true };
  }

  /**
   * 删除目录（带重试，解决 Windows EPERM 问题）
   */
  async _deleteDir(dir, retries = 5, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`已删除下载目录: ${dir}`);
        return;
      } catch (err) {
        if (i < retries - 1 && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'ENOTEMPTY')) {
          console.warn(`删除下载目录失败，第 ${i + 1} 次重试 (${err.code}): ${dir}`);
          await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
        } else {
          console.error('删除下载目录失败:', err);
          return;
        }
      }
    }
  }

  /**
   * 获取下载状态
   */
  getDownloadStatus(modelId, quantName) {
    return downloadStateManager.getState(modelId, quantName);
  }

  /**
   * 获取所有下载任务（包含模型和引擎）
   */
  getAllDownloads() {
    const allStates = downloadStateManager.getAllStates();
    return Object.values(allStates).map(state => {
      if (state.type === 'engine') {
        // 引擎下载
        const engine = engineManager.getEngine(state.engineId || state.id);
        return {
          ...state,
          modelId: state.engineId || state.id, // 兼容前端
          modelName: engine?.name || state.engineId || state.id,
          type: 'engine'
        };
      } else if (state.type === 'comfyui') {
        // ComfyUI 模型下载
        return {
          ...state,
          modelId: state.id,
          modelName: state.displayName || state.targetQuantization,
          type: 'comfyui',
          comfyuiTaskId: state.comfyuiTaskId
        };
      } else {
        // 模型下载
        const model = modelManager.getById(state.modelId || state.id);
        return {
          ...state,
          modelName: model?.name || state.modelId || state.id,
          type: 'model'
        };
      }
    });
  }

  /**
   * 获取 ModelScope 仓库的文件列表
   */
  async _getModelScopeFileList(modelId, revision = 'master') {
    const resp = await axios.get(
      `https://www.modelscope.cn/api/v1/models/${modelId}/repo/files`,
      { params: { Revision: revision, Recursive: 'true', Root: '' }, timeout: 30000 }
    );
    return (resp.data?.Data?.Files || []).filter(f => !f.IsDir);
  }

  /**
   * 根据模型配置解析出完整的下载文件列表（含直接 URL、size、sha256）
   */
  async _resolveDownloadFiles(model, targetQuantization) {
    const files = [];
    const modelscopeId = model.modelscope_id || model.id;

    const addMmproj = () => {
      if (!model.mmproj_options?.length) return;
      const bf16 = model.mmproj_options.filter(m => /bf16/i.test(m.name));
      const chosen = bf16.length > 0 ? bf16 : [model.mmproj_options[0]];
      for (const m of chosen) {
        if (m.download_url) {
          files.push({ name: m.name, url: m.download_url, size: m.size || 0, sha256: m.sha256 || null });
          console.log(`添加 mmproj 文件: ${m.name}`);
        }
      }
    };

    if (targetQuantization) {
      const quantInfo = model.quantizations?.find(q => q.name === targetQuantization);
      if (quantInfo?.file?.download_url) {
        files.push({ name: quantInfo.file.name, url: quantInfo.file.download_url, size: quantInfo.file.size, sha256: quantInfo.file.sha256 || null });
      }
      addMmproj();
    } else if (model.files?.model?.download_url) {
      files.push({ name: model.files.model.name, url: model.files.model.download_url, size: model.files.model.size, sha256: model.files.model.sha256 || null });
      if (model.files.mmproj?.download_url) {
        files.push({ name: model.files.mmproj.name, url: model.files.mmproj.download_url, size: model.files.mmproj.size, sha256: model.files.mmproj.sha256 || null });
      }
    }

    // 配置文件（*.json, tokenizer*, *.txt, LICENSE, README*）
    const CONFIG_RE = [/\.json$/i, /^tokenizer/i, /\.txt$/i, /^LICENSE$/i, /^README/i];
    try {
      const repoFiles = await this._getModelScopeFileList(modelscopeId);
      for (const f of repoFiles) {
        const filePath = f.Path || f.Name || '';
        const name = path.basename(filePath);
        if (!name || files.some(x => x.name === name)) continue;
        if (CONFIG_RE.some(re => re.test(name))) {
          const url = `https://www.modelscope.cn/api/v1/models/${modelscopeId}/repo?Revision=master&FilePath=${encodeURIComponent(filePath)}`;
          files.push({ name, url, size: f.Size || 0, sha256: null });
        }
      }
    } catch (e) {
      console.warn(`[ModelScope] 配置文件列表获取失败，跳过: ${e.message}`);
    }

    return files;
  }

  /**
   * 流式下载单个文件，支持断点续传。
   * 对全新下载（非续传）同步计算 SHA256，无需下载后再读文件。
   * 对断点续传，返回 wasResumed=true，由调用方决定是否补算 SHA256。
   *
   * @returns {{ sha256: string|null, wasResumed: boolean, skipped: boolean }}
   */
  async _downloadFileStreaming(fileInfo, modelDir, downloadState, onProgress) {
    const finalPath = path.join(modelDir, fileInfo.name);
    const partPath  = finalPath + '.part';

    if (fs.existsSync(finalPath)) {
      console.log(`文件已存在，跳过: ${fileInfo.name}`);
      return { sha256: null, wasResumed: false, skipped: true };
    }

    const resumePos = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    const isFresh   = resumePos === 0;

    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
    if (resumePos > 0) {
      headers['Range'] = `bytes=${resumePos}-`;
      console.log(`断点续传: ${fileInfo.name}, 已下载 ${(resumePos / 1024 / 1024).toFixed(1)} MB`);
    }

    console.log(`开始下载: ${fileInfo.name}${fileInfo.size ? ` (${(fileInfo.size / 1024 / 1024 / 1024).toFixed(2)} GB)` : ''}`);

    const response = await axios({
      method: 'GET',
      url: fileInfo.url,
      headers,
      responseType: 'stream',
      signal: downloadState.controller?.signal,
      timeout: 60000,
      maxRedirects: 10,
    });

    if (response.status === 416) {
      // Range Not Satisfiable：文件已完整
      if (fs.existsSync(partPath)) fs.renameSync(partPath, finalPath);
      console.log(`✓ 文件已完整（416）: ${fileInfo.name}`);
      return { sha256: null, wasResumed: false, skipped: false };
    }

    // 全新下载且有期望 sha256 时，边下边算——零额外读盘开销
    const hash   = (isFresh && fileInfo.sha256) ? crypto.createHash('sha256') : null;
    const writer = fs.createWriteStream(partPath, { flags: resumePos > 0 ? 'a' : 'w' });

    response.data.on('data', (chunk) => {
      if (hash) hash.update(chunk);
      if (onProgress) onProgress(chunk.length);
    });

    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    fs.renameSync(partPath, finalPath);
    console.log(`✓ 下载完成: ${fileInfo.name}`);

    return { sha256: hash ? hash.digest('hex') : null, wasResumed: !isFresh, skipped: false };
  }

  /**
   * 使用 Node.js HTTP 下载模型（替代 Python modelscope_downloader.py）
   * - 边下边算 SHA256，无需下载后再读文件
   * - 直接使用 AbortController 控制暂停/取消，无子进程
   */
  async _downloadModelWithModelScope(model, downloadState) {
    const targetQuantization = downloadState?.targetQuantization || model.selected_quantization;
    const modelDir = getModelPath(MODELS_RUN_DIR, model);

    if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir, { recursive: true });

    try {
      console.log(`下载模型 (Node.js HTTP): ${model.modelscope_id || model.id}`);

      const filesToDownload = await this._resolveDownloadFiles(model, targetQuantization);
      if (filesToDownload.length === 0) throw new Error('没有找到需要下载的文件');
      console.log(`文件列表: ${filesToDownload.map(f => f.name).join(', ')}`);

      const totalBytes = filesToDownload.reduce((s, f) => s + (f.size || 0), 0);
      let globalDownloaded = 0;
      let lastProgressTime  = Date.now();
      let lastProgressBytes = 0;
      downloadStateManager.updateBytes(downloadState.modelId, 0, totalBytes, downloadState.targetQuantization);

      const sha256Map    = {}; // filename → sha256
      const resumedFiles = new Set();

      for (const fileInfo of filesToDownload) {
        // 检查暂停 / 取消
        if (!downloadStateManager.hasDownload(model.id, downloadState.targetQuantization)) {
          console.log(`下载已取消: ${model.id}`); return;
        }
        const curState = downloadStateManager.getState(model.id, downloadState.targetQuantization);
        if (curState?.status === 'paused') {
          console.log(`下载已暂停: ${model.id}`); return;
        }

        const result = await this._downloadFileStreaming(fileInfo, modelDir, downloadState, (chunkSize) => {
          globalDownloaded += chunkSize;
          const now     = Date.now();
          const elapsed = (now - lastProgressTime) / 1000;
          if (elapsed >= 0.5) {
            const speed    = (globalDownloaded - lastProgressBytes) / elapsed;
            const progress = totalBytes > 0 ? Math.min(99, globalDownloaded / totalBytes * 100) : 0;
            downloadStateManager.updateProgress(downloadState.modelId, progress, speed, downloadState.targetQuantization);
            downloadStateManager.updateBytes(downloadState.modelId, globalDownloaded, totalBytes, downloadState.targetQuantization);
            lastProgressTime  = now;
            lastProgressBytes = globalDownloaded;
          }
        });

        // 即时 SHA256 校验
        if (fileInfo.sha256 && result.sha256) {
          if (result.sha256 !== fileInfo.sha256) {
            throw new Error(`SHA256 校验失败: ${fileInfo.name} 期望=${fileInfo.sha256.slice(0, 8)}... 实际=${result.sha256.slice(0, 8)}...`);
          }
          console.log(`✓ SHA256 验证通过: ${fileInfo.name}`);
        }

        if (result.sha256) sha256Map[fileInfo.name] = result.sha256;
        if (result.wasResumed) resumedFiles.add(fileInfo.name);
      }

      if (!downloadStateManager.hasDownload(model.id, downloadState.targetQuantization)) return;

      downloadStateManager.setState(model.id, 'completed', null, downloadState.targetQuantization);
      downloadStateManager.updateProgress(model.id, 100, 0, downloadState.targetQuantization);

      // 扫描 + 构建文件记录（含实时算好的 sha256）
      const downloadedFileNames = await this._listDownloadedFiles(modelDir);
      const existingFiles = model.downloaded_files || [];

      const newFiles = downloadedFileNames.map(filename => {
        const stats = fs.statSync(path.join(modelDir, filename));
        let matchedPreset = null;
        if (model.quantizations) {
          const preset = model.quantizations.find(q => {
            if (q.file?.name === filename) return true;
            if (q.filename && filename === q.filename) return true;
            return new RegExp((q.filename || `*${q.name}*.gguf`).replace(/\*/g, '.*'), 'i').test(filename);
          });
          matchedPreset = preset?.name || null;
        }
        if (!matchedPreset) matchedPreset = downloadState?.targetQuantization || null;

        return { filename, size: stats.size, sha256: sha256Map[filename] || null, downloaded_at: new Date().toISOString(), matched_preset: matchedPreset, is_active: false };
      });

      const mergedFiles = [...existingFiles];
      for (const f of newFiles) {
        const idx = mergedFiles.findIndex(x => x.filename === f.filename);
        if (idx >= 0) mergedFiles[idx] = f; else mergedFiles.push(f);
      }

      let shouldClearSelectedQuantization = false;
      if (model.selected_quantization && !mergedFiles.some(f => f.is_active)) {
        const m = mergedFiles.find(f => f.matched_preset === model.selected_quantization);
        if (m) { m.is_active = true; shouldClearSelectedQuantization = true; }
      }
      if (!mergedFiles.some(f => f.is_active) && mergedFiles.length > 0 && !model.selected_quantization) {
        mergedFiles[0].is_active = true;
      }

      const downloadedQuantizations = model.downloaded_quantizations || [];
      if (targetQuantization && !downloadedQuantizations.includes(targetQuantization)) {
        downloadedQuantizations.push(targetQuantization);
      }

      const updateData = { downloaded: true, downloaded_files: mergedFiles, downloaded_quantizations: downloadedQuantizations, local_path: modelDir };
      if (shouldClearSelectedQuantization) updateData.selected_quantization = null;
      await modelManager.update(model.id, updateData);

      // 断点续传的文件没有流式 SHA256，后台补算
      const resumedNeedVerify = newFiles.filter(f => resumedFiles.has(f.filename) && !f.sha256);
      if (resumedNeedVerify.length > 0) {
        this._verifySHA256InBackground(model.id, resumedNeedVerify, model.quantizations, modelDir)
          .catch(err => console.error('[SHA256] 断点续传补算出错:', err));
      }

      await presetService.generatePresetFile(model.type);
      const doneQuant = downloadState.targetQuantization;
      setTimeout(() => downloadStateManager.deleteState(model.id, doneQuant), 5000);
      console.log(`✓ 模型 ${model.id} 下载完成: ${modelDir}`);

    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        const st = downloadStateManager.getState(model.id, downloadState.targetQuantization);
        console.log(st?.status === 'paused' ? `下载已暂停: ${model.id}` : `下载已取消: ${model.id}`);
        return;
      }
      console.error(`ModelScope 下载出错:`, error);
      throw error;
    }
  }

  /**
   * 实际执行下载
   */
  async _downloadModel(model, downloadState) {
    // 直接使用最终目标目录，无需临时目录
    const modelDir = getModelPath(MODELS_RUN_DIR, model);

    // 确保目标目录存在
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    try {
      // 下载所有文件
      const filesToDownload = [];

      if (model.files?.model) {
        filesToDownload.push({
          name: model.files.model.name,
          url: model.files.model.download_url,
          size: model.files.model.size,
          sha256: model.files.model.sha256
        });
      }

      if (model.files?.mmproj) {
        filesToDownload.push({
          name: model.files.mmproj.name,
          url: model.files.mmproj.download_url,
          size: model.files.mmproj.size,
          sha256: model.files.mmproj.sha256
        });
      }

      // 计算总大小并更新到状态管理器
      const totalBytes = filesToDownload.reduce((sum, f) => sum + f.size, 0);
      downloadStateManager.updateBytes(downloadState.modelId, 0, totalBytes, downloadState.targetQuantization);

      // 依次下载每个文件
      for (const file of filesToDownload) {
        await this._downloadFile(file, modelDir, downloadState);
      }

      // 所有文件下载完成，更新内存状态
      downloadStateManager.setState(model.id, 'completed', null, downloadState.targetQuantization);
      downloadStateManager.updateProgress(model.id, 100, 0, downloadState.targetQuantization);

      // 文件已直接下载到目标目录，无需移动
      const targetDir = modelDir;

      // 扫描下载的文件并记录
      const downloadedFiles = await this._listDownloadedFiles(targetDir);
      const existingFiles = model.downloaded_files || [];

      // 为新下载的文件创建记录
      const newFiles = downloadedFiles.map(filename => {
        const filePath = path.join(targetDir, filename);
        const stats = fs.statSync(filePath);

        // 尝试匹配预设：优先使用文件名正则匹配，回退到 targetQuantization
        let matchedPreset = null;
        if (model.quantizations) {
          const preset = model.quantizations.find(q => {
            if (q.filename && filename === q.filename) return true;
            const pattern = q.filename || `*${q.name}*.gguf`;
            const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
            return regex.test(filename);
          });
          matchedPreset = preset?.name || null;
        }
        if (!matchedPreset) {
          matchedPreset = downloadState?.targetQuantization || null;
        }

        return {
          filename,
          size: stats.size,
          downloaded_at: new Date().toISOString(),
          matched_preset: matchedPreset,
          is_active: false
        };
      });

      // 合并文件列表，去重
      const mergedFiles = [...existingFiles];
      for (const newFile of newFiles) {
        const existingIndex = mergedFiles.findIndex(f => f.filename === newFile.filename);
        if (existingIndex >= 0) {
          // 更新现有文件信息
          mergedFiles[existingIndex] = newFile;
        } else {
          // 添加新文件
          mergedFiles.push(newFile);
        }
      }

      // 下载完成后激活逻辑：
      // 1. 如果下载的文件匹配 selected_quantization，自动激活并清除 selected_quantization
      // 2. 如果没有激活的文件且没有 selected_quantization，激活第一个
      let shouldClearSelectedQuantization = false;
      if (model.selected_quantization && !mergedFiles.some(f => f.is_active)) {
        const matchingFile = mergedFiles.find(f => f.matched_preset === model.selected_quantization);
        if (matchingFile) {
          matchingFile.is_active = true;
          shouldClearSelectedQuantization = true;
        }
      }
      if (!mergedFiles.some(f => f.is_active) && mergedFiles.length > 0 && !model.selected_quantization) {
        mergedFiles[0].is_active = true;
      }

      // 同时更新新旧字段以保持兼容性
      const downloadedQuantizations = model.downloaded_quantizations || [];
      const targetQuantization = downloadState?.targetQuantization || model.selected_quantization;
      if (targetQuantization && !downloadedQuantizations.includes(targetQuantization)) {
        downloadedQuantizations.push(targetQuantization);
      }

      // 只更新持久字段到数据库
      const updateData = {
        downloaded: true,
        downloaded_files: mergedFiles,
        downloaded_quantizations: downloadedQuantizations,
        local_path: targetDir
      };
      if (shouldClearSelectedQuantization) {
        updateData.selected_quantization = null;
      }
      await modelManager.update(model.id, updateData);

      // 重新生成 INI 预设文件
      await presetService.generatePresetFile(model.type);

      // 5秒后清除已完成的状态
      const doneQuantLegacy = downloadState.targetQuantization;
      setTimeout(() => {
        downloadStateManager.deleteState(model.id, doneQuantLegacy);
      }, 5000);

      console.log(`✓ 模型 ${model.id} 下载完成并移动到: ${targetDir}`);

    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        console.log(`下载已暂停: ${model.id}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * 下载单个文件（支持断点续传）
   */
  async _downloadFile(fileInfo, modelDir, downloadState) {
    const filePath = path.join(modelDir, fileInfo.name);
    const tempPath = filePath + '.part';

    // 检查已下载的大小（.part 文件支持断点续传）
    let downloadedSize = 0;
    if (fs.existsSync(tempPath)) {
      // 如果最终文件已存在，跳过
      if (fs.existsSync(filePath)) {
        console.log(`文件已存在，跳过: ${fileInfo.name}`);
        return;
      }
      downloadedSize = fs.statSync(tempPath).size;
      console.log(`断点续传: ${fileInfo.name}, 已下载 ${(downloadedSize / 1024 / 1024).toFixed(2)} MB`);
    }

    // 设置请求头（断点续传）
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    if (downloadedSize > 0 && downloadedSize < fileInfo.size) {
      headers['Range'] = `bytes=${downloadedSize}-`;
    }

    console.log(`开始下载: ${fileInfo.name} (${(fileInfo.size / 1024 / 1024).toFixed(2)} MB)`);

    const response = await axios({
      method: 'GET',
      url: fileInfo.url,
      headers,
      responseType: 'stream',
      signal: downloadState.controller?.signal,  // 使用可选链，避免 controller 为 null
      timeout: 30000
    });

    // 创建写入流
    const writer = fs.createWriteStream(tempPath, {
      flags: downloadedSize > 0 ? 'a' : 'w'
    });

    let lastUpdate = Date.now();
    let lastBytes = downloadState.downloadedBytes;

    // 监听下载进度
    response.data.on('data', (chunk) => {
      // 通过 downloadStateManager 更新字节数
      const newBytes = downloadState.downloadedBytes + chunk.length;
      downloadStateManager.updateBytes(downloadState.modelId, newBytes, downloadState.totalBytes, downloadState.targetQuantization);

      const now = Date.now();
      if (now - lastUpdate > 500) {
        const elapsed = (now - lastUpdate) / 1000;
        const bytesInPeriod = newBytes - lastBytes;
        const speed = bytesInPeriod / elapsed;
        const progress = (newBytes / downloadState.totalBytes) * 100;

        downloadStateManager.updateProgress(downloadState.modelId, progress, speed, downloadState.targetQuantization);

        lastUpdate = now;
        lastBytes = newBytes;

        // 发出进度事件
        this.emit('progress', {
          modelId: downloadState.modelId,
          progress: progress,
          speed: speed,
          downloadedBytes: newBytes,
          totalBytes: downloadState.totalBytes
        });
      }
    });

    // 等待下载完成
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    // 验证 SHA256
    if (fileInfo.sha256) {
      console.log(`验证文件: ${fileInfo.name}`);
      const fileHash = await this._calculateSHA256(tempPath);
      if (fileHash !== fileInfo.sha256) {
        throw new Error(`文件校验失败: ${fileInfo.name}`);
      }
      console.log(`✓ 校验通过: ${fileInfo.name}`);
    }

    // 重命名为正式文件
    fs.renameSync(tempPath, filePath);
    console.log(`✓ 文件下载完成: ${fileInfo.name}`);
  }

  /**
   * 后台异步计算 .gguf 文件的 SHA256，并更新 downloaded_files 记录
   * 计算完成后若与配置期望值不符，记录警告（下次 checkActiveFileIntegrity 会返回 false）
   *
   * @param {string} modelId
   * @param {Array}  files         - 本次下载写入 DB 的 downloaded_files 条目
   * @param {Array}  quantizations - 模型的 quantizations 配置（含期望 sha256）
   * @param {string} modelDir      - .gguf 文件所在目录
   */
  async _verifySHA256InBackground(modelId, files, quantizations, modelDir) {
    const sha256Map = {}; // filename -> sha256 hex string

    for (const fileRec of files) {
      if (!fileRec.filename.endsWith('.gguf')) continue;
      const filePath = path.join(modelDir, fileRec.filename);
      if (!fs.existsSync(filePath)) continue;

      try {
        const sha256 = await this._calculateSHA256(filePath);
        sha256Map[fileRec.filename] = sha256;

        const quantInfo = quantizations?.find(q => q.name === fileRec.matched_preset);
        if (quantInfo?.file?.sha256) {
          if (sha256 !== quantInfo.file.sha256) {
            console.error(`[SHA256] 文件损坏: ${fileRec.filename} 实际=${sha256.slice(0, 8)}... 期望=${quantInfo.file.sha256.slice(0, 8)}...`);
          } else {
            console.log(`[SHA256] 验证通过: ${fileRec.filename}`);
          }
        } else {
          console.log(`[SHA256] 已计算: ${fileRec.filename} = ${sha256.slice(0, 8)}...`);
        }
      } catch (err) {
        console.warn(`[SHA256] 计算失败: ${fileRec.filename}`, err.message);
      }
    }

    if (Object.keys(sha256Map).length === 0) return;

    // 重新读取当前最新 model 数据，避免覆盖并发更新
    const currentModel = modelManager.getById(modelId);
    if (!currentModel) return;

    const updatedFiles = (currentModel.downloaded_files || []).map(f =>
      sha256Map[f.filename] !== undefined ? { ...f, sha256: sha256Map[f.filename] } : f
    );

    await modelManager.update(modelId, { downloaded_files: updatedFiles });
    console.log(`[SHA256] 已写入 ${modelId} 的 sha256 记录`);
  }

  /**
   * 启动时对所有缺少 sha256 的已下载 .gguf 文件补算并写入
   * 处理场景：下载后 Node 崩溃、旧版本未记录 sha256 的历史数据
   */
  async verifyMissingSHA256() {
    const models = modelManager.getAll().filter(m => m.downloaded_files?.length > 0);
    const pending = models.filter(m =>
      m.downloaded_files.some(f => f.filename?.endsWith('.gguf') && !f.sha256) &&
      m.local_path
    );
    if (pending.length === 0) return;

    console.log(`[SHA256] 发现 ${pending.length} 个模型需要补算 sha256，后台处理中...`);
    for (const model of pending) {
      this._verifySHA256InBackground(model.id, model.downloaded_files, model.quantizations, model.local_path)
        .catch(err => console.error(`[SHA256] 补算失败: ${model.id}`, err));
    }
  }

  /**
   * 计算文件 SHA256
   */
  async _calculateSHA256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 列出目录中的所有 .gguf 文件
   */
  async _listDownloadedFiles(dir) {
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = fs.readdirSync(dir);
    return files.filter(f => f.endsWith('.gguf') && !f.startsWith('mmproj'));
  }

  /**
   * 合并下载的文件到已存在的运行时目录（不删除已有文件，扁平化结构）
   */
  async _mergeToModelsDir(sourceDir, targetDir) {
    console.log(`合并并扁平化模型文件: ${sourceDir} -> ${targetDir}`);

    if (!fs.existsSync(sourceDir)) {
      throw new Error(`源目录不存在: ${sourceDir}`);
    }

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 收集源目录中的所有文件
    const allFiles = this._collectFilesRecursive(sourceDir);

    console.log(`  找到 ${allFiles.length} 个文件需要合并`);

    // 将所有文件合并到目标目录的根层级（扁平化）
    for (const file of allFiles) {
      const targetPath = path.join(targetDir, file.name);

      // 如果是同名文件且内容不同，添加后缀
      let finalTargetPath = targetPath;
      let counter = 1;
      while (fs.existsSync(finalTargetPath)) {
        // 检查是否是相同文件（通过大小判断）
        const existingStat = fs.statSync(finalTargetPath);
        const newStat = fs.statSync(file.path);

        if (existingStat.size === newStat.size) {
          // 大小相同，跳过
          console.log(`  ⊙ 跳过已存在: ${file.name}`);
          finalTargetPath = null;
          break;
        }

        // 大小不同，添加后缀
        const ext = path.extname(file.name);
        const base = path.basename(file.name, ext);
        finalTargetPath = path.join(targetDir, `${base}_${counter}${ext}`);
        counter++;
      }

      if (finalTargetPath) {
        // 复制文件
        fs.copyFileSync(file.path, finalTargetPath);
        console.log(`  ✓ ${file.name}`);
      }
    }

    // 删除源目录
    fs.rmSync(sourceDir, { recursive: true, force: true });
    console.log(`✓ 模型文件已合并到运行时目录`);
  }

  /**
   * 递归收集目录中的所有文件
   */
  _collectFilesRecursive(dir, files = []) {
    if (!fs.existsSync(dir)) {
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // 跳过隐藏目录和临时目录
        if (!entry.name.startsWith('.') && !entry.name.startsWith('_')) {
          this._collectFilesRecursive(fullPath, files);
        }
      } else if (entry.isFile() && !entry.name.startsWith('.')) {
        // 只收集非隐藏文件
        files.push({
          name: entry.name,
          path: fullPath
        });
      }
    }

    return files;
  }

  /**
   * 移动下载的文件到运行时目录（扁平化结构）
   */
  async _moveToModelsDir(sourceDir, targetDir) {
    console.log(`移动并扁平化模型文件: ${sourceDir} -> ${targetDir}`);

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 收集源目录中的所有文件
    const allFiles = this._collectFilesRecursive(sourceDir);

    console.log(`  找到 ${allFiles.length} 个文件需要移动`);

    // 将所有文件移动到目标目录的根层级（扁平化）
    for (const file of allFiles) {
      const targetPath = path.join(targetDir, file.name);

      // 如果目标文件已存在，添加后缀避免覆盖
      let finalTargetPath = targetPath;
      let counter = 1;
      while (fs.existsSync(finalTargetPath)) {
        const ext = path.extname(file.name);
        const base = path.basename(file.name, ext);
        finalTargetPath = path.join(targetDir, `${base}_${counter}${ext}`);
        counter++;
      }

      // 复制文件
      fs.copyFileSync(file.path, finalTargetPath);
      console.log(`  ✓ ${file.name}`);
    }

    // 删除源目录
    fs.rmSync(sourceDir, { recursive: true, force: true });
    console.log(`✓ 模型文件已扁平化到运行时目录`);
  }

  /**
   * 处理下载错误
   */
  async _handleDownloadError(modelId, error, quantName) {
    // 如果已被取消或状态已删除，不设置失败状态
    const currentState = downloadStateManager.getState(modelId, quantName);
    if (!currentState || currentState.status === 'cancelling') return;

    downloadStateManager.setState(modelId, 'failed', error.message, quantName);

    // 使用 'download-error' 而非 'error'，避免 EventEmitter 无监听时崩溃进程
    this.emit('download-error', {
      modelId,
      error: error.message
    });
  }
}

export default new DownloadService();
