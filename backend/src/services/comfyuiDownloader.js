import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { PROJECT_ROOT, CACHE_DIR, MODELS_RUN_DIR } from '../config/constants.js';
import urlConverter from './urlConverter.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TASK_CLEANUP_MS = 10 * 60 * 1000; // 10 minutes

/**
 * ComfyUI模型下载服务
 * 下载优先级：
 *   1. ModelScope SDK（modelscope_downloader.py）
 *   2. HuggingFace SDK via hf-mirror（hf_downloader.py）
 *   3. HTTP 直接下载 - ModelScope URL
 *   4. HTTP 直接下载 - hf-mirror URL
 *   永远不使用 huggingface.co 直连
 */
class ComfyUIDownloader {
  constructor() {
    this.pythonPath = path.join(PROJECT_ROOT, 'external', 'python313', 'python.exe');
    this.msScript = path.join(__dirname, 'modelscope_downloader.py');
    this.hfScript = path.join(__dirname, 'hf_downloader.py');
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
      error: null
    });

    // 后台执行，不 await
    this._runDownload(taskId, modelInfo, onComplete);

    return taskId;
  }

  /**
   * 获取任务状态
   * @param {string} taskId
   * @returns {Object|null}
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 后台执行下载，更新任务状态
   */
  async _runDownload(taskId, modelInfo, onComplete) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'downloading';

    try {
      const result = await this.download(modelInfo, (info) => {
        const t = this.tasks.get(taskId);
        if (!t) return;
        t.progress = info.progress;
        if (info.totalBytes != null) t.totalBytes = info.totalBytes;
        if (info.downloadedBytes != null) t.downloadedBytes = info.downloadedBytes;
        if (info.speed != null) t.speed = info.speed;
      });

      const t = this.tasks.get(taskId);
      if (t) {
        if (result.success) {
          t.status = 'completed';
          t.progress = 100;
          t.source = result.source;
          t.path = result.path;
        } else {
          t.status = 'failed';
          t.error = result.error;
        }
      }

      if (onComplete) {
        onComplete(result);
      }
    } catch (error) {
      const t = this.tasks.get(taskId);
      if (t) {
        t.status = 'failed';
        t.error = error.message;
      }
      if (onComplete) {
        onComplete({ success: false, error: error.message });
      }
    }

    // 10分钟后自动清理
    setTimeout(() => {
      this.tasks.delete(taskId);
    }, TASK_CLEANUP_MS);
  }

  /**
   * 主下载方法 - 按优先级依次尝试
   * @param {Object} modelInfo
   * @param {Function} onProgress - 进度回调 (0-100)
   */
  async download(modelInfo, onProgress = null) {
    const targetPath = this._getTargetPath(modelInfo.type, modelInfo.filename);

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

    // 1. ModelScope SDK
    console.log('[1/4] 尝试 ModelScope SDK...');
    if (await this._downloadWithModelScopeSDK(originalUrl, targetPath, onProgress)) {
      return { success: true, path: targetPath, source: 'modelscope_sdk' };
    }

    // 2. HuggingFace SDK via hf-mirror
    console.log('[2/4] 尝试 HuggingFace SDK (hf-mirror)...');
    if (await this._downloadWithHuggingFaceSDK(originalUrl, targetPath, onProgress)) {
      return { success: true, path: targetPath, source: 'hf_mirror_sdk' };
    }

    // 3. HTTP - ModelScope URL
    console.log('[3/4] 尝试 HTTP (ModelScope)...');
    const msUrl = this._toModelScopeUrl(originalUrl);
    if (msUrl && await this._downloadWithHTTP(msUrl, targetPath, onProgress)) {
      return { success: true, path: targetPath, source: 'http_modelscope' };
    }

    // 4. HTTP - hf-mirror URL
    console.log('[4/4] 尝试 HTTP (hf-mirror)...');
    const hfMirrorUrl = this._toHFMirrorUrl(originalUrl);
    if (hfMirrorUrl && await this._downloadWithHTTP(hfMirrorUrl, targetPath, onProgress)) {
      return { success: true, path: targetPath, source: 'http_hf_mirror' };
    }

    return { success: false, error: '所有下载源都失败' };
  }

  // ────────────────────────────── private ──────────────────────────────

  /**
   * 使用 modelscope_downloader.py 下载
   * tempDir 使用确定性路径（从 targetPath 推导），支持断点续传
   */
  async _downloadWithModelScopeSDK(url, targetPath, onProgress) {
    try {
      const repoInfo = urlConverter.parseRepoInfo(url);
      if (!repoInfo) {
        console.log('  无法解析仓库信息，跳过 ModelScope SDK');
        return false;
      }

      const modelId = `${repoInfo.org}/${repoInfo.repo}`;
      const filename = path.basename(repoInfo.filepath || targetPath);

      // 固定的确定性目录，与 LLM 下载保持一致，后端重启后 ModelScope SDK 可续传
      const typeDir = path.basename(path.dirname(targetPath));
      const baseName = path.basename(targetPath, path.extname(targetPath));
      const tempDir = path.join(CACHE_DIR, `ms_${typeDir}_${baseName}`);

      console.log(`  ModelScope 模型: ${modelId}, 文件: ${filename}`);
      console.log(`  续传目录: ${tempDir}`);

      fs.mkdirSync(tempDir, { recursive: true });

      const result = await this._execScript(this.msScript, [
        modelId,
        '--output', tempDir,
        '--files', filename
      ], onProgress, targetPath);

      if (result.success) {
        const found = this._findFileRecursive(tempDir, filename);
        if (found) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.renameSync(found, targetPath);
          // 成功后才清理临时目录，失败/中断时保留供下次续传
          this._cleanDir(tempDir);
          console.log(`  ✅ ModelScope SDK 下载成功`);
          return true;
        }
        console.log('  下载脚本成功但未找到文件');
      } else {
        console.log(`  ModelScope SDK 失败: exit code ${result.code}（临时目录已保留，下次可续传）`);
      }
    } catch (error) {
      console.log(`  ModelScope SDK 异常: ${error.message}（临时目录已保留，下次可续传）`);
    }
    return false;
  }

  /**
   * 使用 hf_downloader.py + hf-mirror 端点下载
   * tempDir 使用确定性路径，支持断点续传
   */
  async _downloadWithHuggingFaceSDK(url, targetPath, onProgress) {
    try {
      const repoInfo = urlConverter.parseRepoInfo(url);
      if (!repoInfo) {
        console.log('  无法解析仓库信息，跳过 HF SDK');
        return false;
      }

      const repoId = `${repoInfo.org}/${repoInfo.repo}`;
      const filepath = repoInfo.filepath;
      const filename = path.basename(filepath || targetPath);

      // 固定的确定性目录，支持续传
      const typeDir = path.basename(path.dirname(targetPath));
      const baseName = path.basename(targetPath, path.extname(targetPath));
      const tempDir = path.join(CACHE_DIR, `hf_${typeDir}_${baseName}`);

      console.log(`  HF 仓库: ${repoId}, 文件路径: ${filepath}`);
      console.log(`  续传目录: ${tempDir}`);

      fs.mkdirSync(tempDir, { recursive: true });

      const args = [
        repoId,
        '--output', tempDir,
        '--endpoint', 'https://hf-mirror.com'
      ];
      if (filepath) {
        args.push('--files', filepath);
      }

      const result = await this._execScript(this.hfScript, args, onProgress, targetPath);

      if (result.success) {
        const found = this._findFileRecursive(tempDir, filename);
        if (found) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.renameSync(found, targetPath);
          // 成功后才清理，失败/中断时保留供续传
          this._cleanDir(tempDir);
          console.log(`  ✅ HF SDK (hf-mirror) 下载成功`);
          return true;
        }
        console.log('  下载脚本成功但未找到文件');
      } else {
        console.log(`  HF SDK 失败: exit code ${result.code}（临时目录已保留，下次可续传）`);
      }
    } catch (error) {
      console.log(`  HF SDK 异常: ${error.message}（临时目录已保留，下次可续传）`);
    }
    return false;
  }

  /**
   * 使用 HTTP 直接下载，带进度/速度回调，支持 Range 断点续传
   */
  async _downloadWithHTTP(url, targetPath, onProgress) {
    const tempPath = targetPath + '.downloading';
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
        headers
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
      console.log(`  HTTP 下载失败: ${error.message}（.downloading 文件已保留，下次可续传）`);
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
  _parseTqdmLine(line) {
    const info = {};

    // 进度百分比
    const pctMatch = line.match(/(\d+)%\|/);
    if (pctMatch) info.progress = parseInt(pctMatch[1], 10);

    // 已下载/总大小，如 "1.00G/2.00G" 或 "500.0M/1.00G"
    const sizeMatch = line.match(/([\d.]+)\s*([KMGT]?i?)B?\s*\/\s*([\d.]+)\s*([KMGT]?i?)B?/);
    if (sizeMatch) {
      info.downloadedBytes = this._parseHumanSize(sizeMatch[1], sizeMatch[2]);
      info.totalBytes = this._parseHumanSize(sizeMatch[3], sizeMatch[4]);
    }

    // 速度，如 "6.67MB/s" 或 "35.2 MB/s"
    const speedMatch = line.match(/([\d.]+)\s*([KMGT]?i?)B\/s/);
    if (speedMatch) {
      info.speed = this._parseHumanSize(speedMatch[1], speedMatch[2]);
    }

    return info;
  }

  /**
   * 解析人类可读的文件大小字符串，返回字节数
   * 支持 K/M/G/T 和 Ki/Mi/Gi/Ti
   */
  _parseHumanSize(value, unit) {
    const n = parseFloat(value);
    if (isNaN(n)) return null;
    const u = unit.toUpperCase().replace('I', '');
    const multipliers = { '': 1, 'K': 1024, 'M': 1024 ** 2, 'G': 1024 ** 3, 'T': 1024 ** 4 };
    return Math.round(n * (multipliers[u] ?? 1));
  }

  /**
   * 执行 Python 脚本，返回 { success, code, stdout, stderr }
   * @param {string} scriptPath
   * @param {string[]} args
   * @param {Function} onProgress - 进度回调 ({ progress, totalBytes, downloadedBytes, speed })
   * @param {string} targetPath - 用于监测磁盘写入速度（可选）
   */
  _execScript(scriptPath, args, onProgress = null, targetPath = null) {
    return new Promise((resolve) => {
      const proc = spawn(this.pythonPath, [scriptPath, ...args], {
        cwd: PROJECT_ROOT
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        const line = data.toString();
        stderr += line;
        if (line.trim()) console.log(' ', line.trim());

        if (onProgress) {
          const info = this._parseTqdmLine(line);
          if (info.progress != null) {
            onProgress({
              progress: info.progress,
              totalBytes: info.totalBytes ?? null,
              downloadedBytes: info.downloadedBytes ?? null,
              speed: info.speed ?? null
            });
          }
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const lastLine = stdout.trim().split('\n').pop();
            const parsed = JSON.parse(lastLine);
            resolve({ success: parsed.success === true, code, stdout, stderr, parsed });
          } catch {
            resolve({ success: true, code, stdout, stderr });
          }
        } else {
          resolve({ success: false, code, stdout, stderr });
        }
      });

      proc.on('error', (error) => {
        resolve({ success: false, code: -1, error: error.message, stdout, stderr });
      });
    });
  }

  /**
   * 获取模型目标路径
   * type 是 ComfyUI 目录名（text_encoders / vae / diffusion_models / checkpoints 等）
   */
  _getTargetPath(type, filename) {
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
   * 在目录中递归查找指定文件名
   */
  _findFileRecursive(dir, filename) {
    if (!fs.existsSync(dir)) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = this._findFileRecursive(full, filename);
          if (found) return found;
        } else if (entry.name === filename) {
          return full;
        }
      }
    } catch {}
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
