import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { DOWNLOADS_DIR, MODELS_RUN_DIR } from '../config/constants.js';
import modelManager from './modelManager.js';
import presetService from './presetService.js';
import downloadStateManager from './downloadStateManager.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const PYTHON_PATH = path.join(PROJECT_ROOT, 'external/python313/python.exe');
const DOWNLOADER_SCRIPT = path.join(__dirname, 'modelscope_downloader.py');

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
    // 检查是否有活跃下载，但允许暂停状态重新开始
    const existingDownload = downloadStateManager.getFullState(modelId);
    if (existingDownload && existingDownload.status !== 'paused') {
      throw new Error('模型已在下载中');
    }

    // 如果是暂停状态，清理旧的下载状态
    if (existingDownload && existingDownload.status === 'paused') {
      downloadStateManager.deleteState(modelId);
    }

    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    // 如果指定了量化版本，临时设置它（仅用于下载，不影响当前使用的版本）
    let targetQuantization = quantizationName;
    if (!targetQuantization && model.quantizations && model.quantizations.length > 0) {
      targetQuantization = model.selected_quantization;
    }

    // 检查要下载的量化版本是否已下载
    if (model.quantizations && model.quantizations.length > 0) {
      const downloadedQuants = model.downloaded_quantizations || [];

      if (targetQuantization && downloadedQuants.includes(targetQuantization)) {
        throw new Error(`量化版本 ${targetQuantization} 已下载`);
      }
    } else {
      // 没有量化版本，检查整体下载状态
      if (model.downloaded) {
        throw new Error('模型已下载');
      }
    }

    // 创建内存中的下载状态（不持久化到数据库）
    downloadStateManager.createState(modelId, targetQuantization);
    downloadStateManager.setController(modelId, new AbortController());

    // 获取完整的状态对象用于内部方法
    const downloadState = downloadStateManager.getFullState(modelId);

    // 不再保存任何临时字段到数据库

    // 开始下载 - 使用 ModelScope
    this._downloadModelWithModelScope(model, downloadState).catch(error => {
      console.error(`Download failed for ${modelId}:`, error);
      this._handleDownloadError(modelId, error);
    });

    return downloadState;
  }

  /**
   * 暂停下载
   */
  async pauseDownload(modelId) {
    const downloadState = downloadStateManager.getFullState(modelId);
    if (!downloadState) {
      throw new Error('下载任务不存在');
    }

    // 如果有 Python 进程，终止它
    if (downloadState.pythonProcess) {
      try {
        downloadState.pythonProcess.kill('SIGTERM');
        console.log(`已终止 Python 下载进程: ${modelId}`);
      } catch (error) {
        console.error('终止进程失败:', error);
      }
    }

    // 只在内存中标记为暂停，不写数据库
    downloadStateManager.setState(modelId, 'paused');

    return downloadStateManager.getState(modelId);
  }

  /**
   * 恢复下载
   */
  async resumeDownload(modelId) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    let downloadState = downloadStateManager.getFullState(modelId);
    if (!downloadState) {
      // 重新创建下载状态（使用当前的 selected_quantization）
      downloadStateManager.createState(modelId, model.selected_quantization);
      downloadStateManager.setController(modelId, new AbortController());
      downloadState = downloadStateManager.getFullState(modelId);
    } else {
      downloadStateManager.setState(modelId, 'downloading');
      downloadStateManager.setController(modelId, new AbortController());
    }

    // 不写数据库，直接开始下载
    this._downloadModelWithModelScope(model, downloadState).catch(error => {
      console.error(`Resume download failed for ${modelId}:`, error);
      this._handleDownloadError(modelId, error);
    });

    return downloadStateManager.getState(modelId);
  }

  /**
   * 取消下载
   */
  async cancelDownload(modelId) {
    const downloadState = downloadStateManager.getFullState(modelId);

    // 如果下载任务不在内存中（例如后端重启后），直接清理临时文件
    if (!downloadState) {
      console.log(`下载任务不在内存中，清理临时文件: ${modelId}`);

      const model = modelManager.getById(modelId);
      if (model) {
        // 删除下载目录中的临时文件
        const downloadDir = path.join(DOWNLOADS_DIR, model.type, modelId);
        if (fs.existsSync(downloadDir)) {
          try {
            fs.rmSync(downloadDir, { recursive: true, force: true });
            console.log(`已删除下载目录: ${downloadDir}`);
          } catch (error) {
            console.error('删除下载目录失败:', error);
          }
        }

        // 检查是否还有其他已下载的量化版本
        const downloadedQuantizations = model.downloaded_quantizations || [];
        const hasOtherDownloaded = downloadedQuantizations.length > 0;

        // 只更新持久字段
        await modelManager.update(modelId, {
          downloaded: hasOtherDownloaded,
          local_path: hasOtherDownloaded ? model.local_path : null
        });
      }

      return { success: true };
    }

    // 如果有 Python 进程，强制终止它
    if (downloadState.pythonProcess) {
      try {
        // 在 Windows 上使用 taskkill 强制终止进程树
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', downloadState.pythonProcess.pid.toString(), '/T', '/F']);
          console.log(`已强制终止 Python 进程树: ${downloadState.pythonProcess.pid}`);
        } else {
          downloadState.pythonProcess.kill('SIGKILL');
          console.log(`已强制终止 Python 进程: ${modelId}`);
        }
      } catch (error) {
        console.error('终止进程失败:', error);
      }
    }

    // 从内存中删除下载状态
    downloadStateManager.deleteState(modelId);

    // 删除未完成的文件
    const model = modelManager.getById(modelId);
    if (model) {
      const downloadDir = path.join(DOWNLOADS_DIR, model.type, modelId);
      if (fs.existsSync(downloadDir)) {
        try {
          fs.rmSync(downloadDir, { recursive: true, force: true });
          console.log(`已删除下载目录: ${downloadDir}`);
        } catch (error) {
          console.error('删除下载目录失败:', error);
        }
      }

      // 检查是否还有其他已下载的量化版本
      const downloadedQuantizations = model.downloaded_quantizations || [];
      const hasOtherDownloaded = downloadedQuantizations.length > 0;

      // 只更新持久字段
      await modelManager.update(modelId, {
        downloaded: hasOtherDownloaded,
        local_path: hasOtherDownloaded ? model.local_path : null
      });
    }

    return { success: true };
  }

  /**
   * 获取下载状态
   */
  getDownloadStatus(modelId) {
    return downloadStateManager.getState(modelId);
  }

  /**
   * 获取所有下载任务
   */
  getAllDownloads() {
    const allStates = downloadStateManager.getAllStates();
    return Object.values(allStates);
  }

  /**
   * 使用 ModelScope CLI 下载模型
   */
  async _downloadModelWithModelScope(model, downloadState) {
    // 所有量化版本共享同一个模型目录
    const modelDir = path.join(DOWNLOADS_DIR, model.type, model.id);

    // 创建模型目录
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    try {
      console.log(`使用 ModelScope 下载: ${model.modelscope_id || model.id}`);

      // 确定 ModelScope 模型 ID
      const modelscopeId = model.modelscope_id || model.id;

      // 构建下载参数
      const downloadArgs = [
        DOWNLOADER_SCRIPT,
        modelscopeId,
        '--output', modelDir
      ];

      // 从下载状态中获取目标量化版本
      const targetQuantization = downloadState?.targetQuantization || model.selected_quantization;

      // 如果用户选择了特定的量化版本，只下载那个文件
      if (targetQuantization) {
        // 查找对应的量化版本信息
        const quantInfo = model.quantizations?.find(q => q.name === targetQuantization);

        const filesToDownload = [];

        if (quantInfo && quantInfo.filename) {
          // 如果配置了明确的文件名，使用它
          console.log(`使用配置的文件名: ${quantInfo.filename}`);
          filesToDownload.push(quantInfo.filename);
        } else {
          // 否则使用通配符匹配，例如 *Q5_K_M*.gguf
          const quantName = targetQuantization;
          const wildcardPattern = `*${quantName}*.gguf`;
          console.log(`使用通配符匹配: ${wildcardPattern}`);
          filesToDownload.push(wildcardPattern);
        }

        // 添加必要的配置文件（但排除其他 .gguf 文件）
        filesToDownload.push('*.json', 'tokenizer*', '*.txt', 'LICENSE', 'README*');

        downloadArgs.push('--files', ...filesToDownload);
        console.log(`下载文件列表: ${filesToDownload.join(', ')}`);
      } else if (model.files?.model?.name) {
        // 如果有指定模型文件名，只下载该文件
        console.log(`只下载模型文件: ${model.files.model.name}`);
        downloadArgs.push('--files', model.files.model.name);
      }

      // 调用 Python 脚本
      const pythonProcess = spawn(PYTHON_PATH, downloadArgs);

      // 保存进程引用到状态管理器
      downloadStateManager.setPythonProcess(downloadState.modelId, pythonProcess);

      let outputData = '';
      let errorData = '';

      pythonProcess.stdout.on('data', (data) => {
        outputData += data.toString();
        console.log(`ModelScope: ${data.toString().trim()}`);
      });

      pythonProcess.stderr.on('data', (data) => {
        errorData += data.toString();
        const line = data.toString().trim();
        console.error(`ModelScope stderr: ${line}`);

        // 解析进度信息
        // 格式: Downloading [filename]:  50%|█████     | 1.47G/2.93G [00:59<00:56, 27.6MB/s]
        const progressMatch = line.match(/Downloading.*?:\s+(\d+)%.*?\|\s+([\d.]+[KMGT]?)\/([\d.]+[KMGT]?).*?\[.*?,\s*([\d.]+[KMGT]?B\/s)\]/);

        if (progressMatch) {
          const progress = parseInt(progressMatch[1]);
          const downloaded = progressMatch[2];
          const total = progressMatch[3];
          const speed = progressMatch[4];

          // 只更新内存中的进度，不写数据库
          downloadStateManager.updateProgress(downloadState.modelId, progress, speed);

          console.log(`📊 下载进度: ${progress}% (${downloaded}/${total}) @ ${speed}`);

          this.emit('progress', {
            modelId: downloadState.modelId,
            progress: progress,
            speed: speed,
            downloadedBytes: downloaded,
            totalBytes: total
          });
        }
      });

      const exitCode = await new Promise((resolve) => {
        pythonProcess.on('close', resolve);
      });

      // 清理进程引用
      downloadStateManager.setPythonProcess(downloadState.modelId, null);

      // 检查是否被取消（非正常退出码且任务已被删除）
      if (!downloadStateManager.hasDownload(model.id)) {
        console.log(`下载已被取消: ${model.id}`);
        return;
      }

      if (exitCode !== 0) {
        // 检查是否是被暂停（SIGTERM）- 从状态管理器获取最新状态
        const currentState = downloadStateManager.getState(model.id);
        if (currentState?.status === 'paused') {
          console.log(`下载已暂停: ${model.id}`);
          return;
        }
        throw new Error(`ModelScope download failed (exit code ${exitCode}): ${errorData || 'Unknown error'}`);
      }

      // 解析输出的 JSON 结果
      try {
        const result = JSON.parse(outputData.trim().split('\n').pop());
        if (!result.success) {
          throw new Error(result.error || 'Download failed');
        }

        console.log(`✓ ModelScope 下载完成: ${result.model_dir}`);
      } catch (parseError) {
        console.warn('无法解析 ModelScope 输出，但下载可能成功了');
      }

      // 下载完成，更新内存状态
      downloadStateManager.setState(model.id, 'completed');
      downloadStateManager.updateProgress(model.id, 100);

      const targetDir = path.join(MODELS_RUN_DIR, model.type, model.id);

      // 如果目标目录已存在，合并文件而不是删除重建
      if (fs.existsSync(targetDir)) {
        await this._mergeToModelsDir(modelDir, targetDir);
      } else {
        await this._moveToModelsDir(modelDir, targetDir);
      }

      // 扫描下载的文件并记录
      const downloadedFiles = await this._listDownloadedFiles(targetDir);
      const existingFiles = model.downloaded_files || [];

      // 为新下载的文件创建记录
      const newFiles = downloadedFiles.map(filename => {
        const filePath = path.join(targetDir, filename);
        const stats = fs.statSync(filePath);

        // 尝试匹配预设
        let matchedPreset = downloadState?.targetQuantization || null;
        if (model.quantizations && !matchedPreset) {
          const preset = model.quantizations.find(q => {
            if (q.filename && filename === q.filename) return true;
            const pattern = q.filename || `*${q.name}*.gguf`;
            const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
            return regex.test(filename);
          });
          matchedPreset = preset?.name || null;
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

      // 如果没有激活的文件，激活第一个
      if (!mergedFiles.some(f => f.is_active) && mergedFiles.length > 0) {
        mergedFiles[0].is_active = true;
      }

      // 同时更新新旧字段以保持兼容性（使用方法开头定义的 targetQuantization）
      const downloadedQuantizations = model.downloaded_quantizations || [];
      if (targetQuantization && !downloadedQuantizations.includes(targetQuantization)) {
        downloadedQuantizations.push(targetQuantization);
      }

      // 只更新持久字段到数据库
      await modelManager.update(model.id, {
        downloaded: true,
        downloaded_files: mergedFiles,
        downloaded_quantizations: downloadedQuantizations,
        local_path: targetDir
      });

      // 重新生成 INI 预设文件
      await presetService.generatePresetFile(model.type);

      // 5秒后清除已完成的状态
      setTimeout(() => {
        downloadStateManager.deleteState(model.id);
      }, 5000);

      console.log(`✓ 模型 ${model.id} 下载完成并移动到: ${targetDir}`);

    } catch (error) {
      console.error(`ModelScope download error:`, error);
      throw error;
    }
  }

  /**
   * 实际执行下载
   */
  async _downloadModel(model, downloadState) {
    // 所有量化版本共享同一个模型目录
    const modelDir = path.join(DOWNLOADS_DIR, model.type, model.id);

    // 创建模型目录
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
      downloadStateManager.updateBytes(downloadState.modelId, 0, totalBytes);

      // 依次下载每个文件
      for (const file of filesToDownload) {
        await this._downloadFile(file, modelDir, downloadState);
      }

      // 所有文件下载完成，更新内存状态
      downloadStateManager.setState(model.id, 'completed');
      downloadStateManager.updateProgress(model.id, 100);

      // 移动到 models_dir
      const targetDir = path.join(MODELS_RUN_DIR, model.type, model.id);

      // 如果目标目录已存在，合并文件而不是删除重建
      if (fs.existsSync(targetDir)) {
        await this._mergeToModelsDir(modelDir, targetDir);
      } else {
        await this._moveToModelsDir(modelDir, targetDir);
      }

      // 扫描下载的文件并记录
      const downloadedFiles = await this._listDownloadedFiles(targetDir);
      const existingFiles = model.downloaded_files || [];

      // 为新下载的文件创建记录
      const newFiles = downloadedFiles.map(filename => {
        const filePath = path.join(targetDir, filename);
        const stats = fs.statSync(filePath);

        // 尝试匹配预设
        let matchedPreset = downloadState?.targetQuantization || null;
        if (model.quantizations && !matchedPreset) {
          const preset = model.quantizations.find(q => {
            if (q.filename && filename === q.filename) return true;
            const pattern = q.filename || `*${q.name}*.gguf`;
            const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
            return regex.test(filename);
          });
          matchedPreset = preset?.name || null;
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

      // 如果没有激活的文件，激活第一个
      if (!mergedFiles.some(f => f.is_active) && mergedFiles.length > 0) {
        mergedFiles[0].is_active = true;
      }

      // 同时更新新旧字段以保持兼容性
      const downloadedQuantizations = model.downloaded_quantizations || [];
      const targetQuantization = downloadState?.targetQuantization || model.selected_quantization;
      if (targetQuantization && !downloadedQuantizations.includes(targetQuantization)) {
        downloadedQuantizations.push(targetQuantization);
      }

      // 只更新持久字段到数据库
      await modelManager.update(model.id, {
        downloaded: true,
        downloaded_files: mergedFiles,
        downloaded_quantizations: downloadedQuantizations,
        local_path: targetDir
      });

      // 重新生成 INI 预设文件
      await presetService.generatePresetFile(model.type);

      // 5秒后清除已完成的状态
      setTimeout(() => {
        downloadStateManager.deleteState(model.id);
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
    const tempPath = filePath + '.download';

    // 检查已下载的大小
    let downloadedSize = 0;
    if (fs.existsSync(tempPath)) {
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
      downloadStateManager.updateBytes(downloadState.modelId, newBytes, downloadState.totalBytes);

      // 每 500ms 更新一次进度
      const now = Date.now();
      if (now - lastUpdate > 500) {
        const elapsed = (now - lastUpdate) / 1000;
        const bytesInPeriod = newBytes - lastBytes;
        const speed = bytesInPeriod / elapsed; // bytes/sec
        const progress = (newBytes / downloadState.totalBytes) * 100;

        // 只更新内存中的进度，不写数据库
        downloadStateManager.updateProgress(downloadState.modelId, progress, speed);

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
  async _handleDownloadError(modelId, error) {
    // 只在内存中标记错误，不写数据库
    downloadStateManager.setState(modelId, 'failed', error.message);

    this.emit('error', {
      modelId,
      error: error.message
    });
  }
}

export default new DownloadService();
