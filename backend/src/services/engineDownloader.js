import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import * as tar from 'tar';
import axios from 'axios';
import { PROJECT_ROOT, DATA_DIR } from '../config/constants.js';
import { getPythonPath, getPythonScriptPath } from '../utils/pathHelper.js';
import engineManager from './engineManager.js';
import downloadStateManager from './downloadStateManager.js';
import eventBus from './eventBus.js';
import AdmZip from 'adm-zip';

/**
 * 引擎下载服务
 * 使用统一的 downloadStateManager 管理下载状态
 */
class EngineDownloader {
  constructor() {
    this.pythonPath = getPythonPath();
    this.msScript = getPythonScriptPath('modelscope_downloader.py');
    // _activeEngineDownloads: 记录正在下载的引擎，防止并发下载同一引擎（如 rocm 被多个链同时触发）
    this._activeEngineDownloads = new Map(); // `${engineId}::${version}` → Promise
  }

  /**
   * 启动下载（含依赖处理）
   * @param {string} engineId
   * @param {string} version
   * @returns {Object} { tasks: [{ engineId, version }] }
   */
  async startDownloadWithDependencies(engineId, version, runtimeId = null) {
    const engine = engineManager.getEngine(engineId);
    if (!engine) {
      throw new Error('Engine not found');
    }

    const versionInfo = engineManager.getEngineVersionInfo(engineId, version);
    if (!versionInfo) {
      throw new Error('Version not found');
    }

    // 检查依赖
    const depCheck = engineManager.checkDependencies(engineId, version);
    const tasks = [];

    // 下载缺失的依赖
    for (const missing of depCheck.missing) {
      const depEngine = engineManager.getEngine(missing.id);
      const depVersion = versionInfo.rocm_version || engineManager.getEngineVersions(missing.id)[0]?.version;
      const taskId = `${missing.id}::${depVersion}`;

      // 若该依赖已在另一条链中下载，不重置其状态，仅加入任务等待
      if (!downloadStateManager.hasDownload(missing.id, depVersion)) {
        downloadStateManager.createState(missing.id, depVersion, 'engine');
      }
      tasks.push({ taskId, engineId: missing.id, version: depVersion });
    }

    // 下载主引擎
    const taskId = `${engineId}::${version}`;
    downloadStateManager.createState(engineId, version, 'engine');
    tasks.push({ taskId, engineId, version });

    // 后台执行下载链
    this._runDownloadChain(tasks, runtimeId);

    return { tasks };
  }

  /**
   * 重新安装（不重新下载，只重跑安装脚本）
   */
  async reinstall(engineId, version) {
    const installPath = path.join(PROJECT_ROOT, 'external', engineId, version);
    if (!fs.existsSync(installPath)) {
      throw new Error(`目录不存在: ${installPath}，请重新下载`);
    }

    const taskId = `${engineId}::${version}`;
    downloadStateManager.createState(engineId, version, 'engine');
    downloadStateManager.setState(engineId, 'installing', null, version);
    eventBus.broadcast('download-progress', { engineId, status: 'installing' });

    // 后台执行，不阻塞响应
    (async () => {
      try {
        // 删除旧标记，确保重装
        const marker = path.join(installPath, '.installed');
        if (fs.existsSync(marker)) fs.unlinkSync(marker);

        const hasCiScript = fs.existsSync(path.join(PROJECT_ROOT, 'ci', `install_${engineId}.py`))
          || fs.existsSync(path.join(PROJECT_ROOT, 'ci', `install_${engineId}.bat`));

        await this._runInstallScript(engineId, version, installPath);

        if (!hasCiScript) {
          fs.writeFileSync(marker, JSON.stringify({ installed_at: new Date().toISOString(), engine: engineId }));
        }

        downloadStateManager.setState(engineId, 'completed', null, version);
        downloadStateManager.updateProgress(engineId, 100, 0, version);
        eventBus.broadcast('download-progress', { engineId, status: 'completed' });
        console.log(`Reinstall completed: ${engineId} ${version}`);
      } catch (error) {
        downloadStateManager.setState(engineId, 'failed', error.message, version);
        eventBus.broadcast('download-progress', { engineId, status: 'failed', error: error.message });
        console.error(`Reinstall failed: ${engineId} ${version} - ${error.message}`);
      }
    })();

    return { tasks: [{ taskId, engineId, version }] };
  }

  /**
   * 执行下载链（依赖 -> 主引擎）
   */
  async _runDownloadChain(tasks, runtimeId = null) {
    for (const taskInfo of tasks) {
      const lockKey = `${taskInfo.engineId}::${taskInfo.version}`;

      // 若另一条链正在下载同一引擎（如 rocm），等待其完成后跳过重复下载
      if (this._activeEngineDownloads.has(lockKey)) {
        console.log(`[engineDownloader] 等待已有下载任务: ${lockKey}`);
        try {
          await this._activeEngineDownloads.get(lockKey);
        } catch (_) {
          // 已有下载失败，当前链也标记失败
          downloadStateManager.setState(taskInfo.engineId, 'failed', '依赖下载失败', taskInfo.version);
          eventBus.broadcast('download-progress', { engineId: taskInfo.engineId, status: 'failed', error: '依赖下载失败' });
          return;
        }
        // 已由其他链下载完成，继续下一个任务
        continue;
      }

      let resolveLock, rejectLock;
      const lockPromise = new Promise((res, rej) => { resolveLock = res; rejectLock = rej; });
      lockPromise.catch(() => {}); // 防止无等待者时 unhandled rejection 导致进程崩溃
      this._activeEngineDownloads.set(lockKey, lockPromise);

      try {
        downloadStateManager.setState(taskInfo.engineId, 'downloading', null, taskInfo.version);
        eventBus.broadcast('download-progress', {
          engineId: taskInfo.engineId,
          status: 'downloading'
        });

        await this._downloadEngine(taskInfo.engineId, taskInfo.version, runtimeId);

        downloadStateManager.setState(taskInfo.engineId, 'completed', null, taskInfo.version);
        downloadStateManager.updateProgress(taskInfo.engineId, 100, 0, taskInfo.version);
        eventBus.broadcast('download-progress', {
          engineId: taskInfo.engineId,
          status: 'completed'
        });
        resolveLock();
      } catch (error) {
        downloadStateManager.setState(taskInfo.engineId, 'failed', error.message, taskInfo.version);
        eventBus.broadcast('download-progress', {
          engineId: taskInfo.engineId,
          status: 'failed',
          error: error.message
        });
        rejectLock(error);
        return; // 依赖下载失败，中止整条链
      } finally {
        this._activeEngineDownloads.delete(lockKey);
      }
    }
  }

  /**
   * 下载单个引擎
   * 支持两种方式：
   *   - download_url：直接 HTTP 下载（测试版）
   *   - modelscope_repo + modelscope_file：ModelScope 下载（正式版）
   */
  async _downloadEngine(engineId, version, runtimeId = null) {
    const engine = engineManager.getEngine(engineId);
    const versionInfo = engineManager.getEngineVersionInfo(engineId, version);

    const downloadDir = path.join(PROJECT_ROOT, 'downloads/engines');
    fs.mkdirSync(downloadDir, { recursive: true });

    // 确定文件名
    const filename = versionInfo.download_url
      ? path.basename(new URL(versionInfo.download_url).pathname)
      : path.basename(versionInfo.modelscope_file);
    const filePath = path.join(downloadDir, filename);

    // 清理上次可能残留的不完整压缩包
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[engineDownloader] Removed stale archive before download: ${filePath}`);
    }

    // 下载
    try {
      if (versionInfo.download_url) {
        await this._execHttpDownload(engineId, version, versionInfo.download_url, filePath);
      } else {
        const repo = versionInfo.modelscope_repo || engine.modelscope_repo;
        await this._execDownload(engineId, version, repo, versionInfo.modelscope_file, downloadDir);
      }
    } catch (err) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[engineDownloader] Cleaned up incomplete archive after download failure: ${filePath}`);
      }
      throw err;
    }

    // 验证文件是否存在且非空
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      throw new Error(`下载失败：文件不存在或大小为0，请重试`);
    }

    // 解压到临时目录
    const tempExtractPath = path.join(PROJECT_ROOT, 'external', engineId, `_temp_${version}`);
    downloadStateManager.setState(engineId, 'unpacking', null, version);
    eventBus.broadcast('download-progress', { engineId, status: 'unpacking' });
    try {
      // 清理可能存在的残留临时目录
      if (fs.existsSync(tempExtractPath)) {
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
      }
      await this._extract(filePath, tempExtractPath);
    } catch (err) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[engineDownloader] Cleaned up archive after extraction failure: ${filePath}`);
      }
      throw err;
    }

    // 确定最终安装目录名：TTS 引擎使用 variant.id，其他引擎使用 version
    let installDirName = version;
    if (engineId === 'tts') {
      const vInfo = engineManager.getEngineVersionInfo(engineId, version);
      installDirName = vInfo?.variant_id || version;
    }
    const installPath = path.join(PROJECT_ROOT, 'external', engineId, installDirName);

    // 如果最终目录已存在（旧版本），先删除
    if (fs.existsSync(installPath)) {
      console.log(`[engineDownloader] 删除旧版本: ${installPath}`);
      fs.rmSync(installPath, { recursive: true, force: true });
    }

    // 重命名临时目录到最终目录
    fs.renameSync(tempExtractPath, installPath);

    // 安装步骤
    if (engine.category === 'app') {
      const updateSource = this._resolveAppUpdateSource(installPath);
      if (!this._isValidAppUpdateSource(updateSource)) {
        throw new Error(`更新包结构无效: ${updateSource}`);
      }
      // App 更新：写 pending 文件，然后自动重启
      const PENDING_FILE = path.join(DATA_DIR, 'updates', 'pending');
      fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true });
      fs.writeFileSync(PENDING_FILE, updateSource, 'utf8');
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      // 通知前端进入重启状态
      downloadStateManager.setState(engineId, 'restarting', null, version);
      eventBus.broadcast('download-progress', { engineId, status: 'restarting' });
      console.log(`[engineDownloader] App update ready, auto-restarting...`);
      // 自动触发重启
      const updateService = (await import('./updateService.js')).default;
      await updateService.applyUpdate();
      return;
    }

    // 普通引擎：运行安装脚本（脚本负责写 .installed）
    await this._runInstallScript(engineId, version, installPath, runtimeId);

    // 安装脚本可能覆盖 .installed，补充 version 字段
    const markerPath = path.join(installPath, '.installed');
    if (fs.existsSync(markerPath) && engineId === 'tts') {
      try {
        const m = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        if (!m.version) {
          m.version = version;
          fs.writeFileSync(markerPath, JSON.stringify(m));
        }
      } catch {}
    }

    // 清理下载文件
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  _resolveUpdateBundleRoot(installPath) {
    // 与 Python 启动器 _resolve_update_source 保持一致的标记文件
    const markers = [
      ['backend', 'dist', 'index.js'],
      ['external', 'node', 'node.exe']
    ];

    const isValidRoot = (root) => markers.every(parts => fs.existsSync(path.join(root, ...parts)));

    if (isValidRoot(installPath)) return installPath;

    let entries = [];
    try {
      entries = fs.readdirSync(installPath, { withFileTypes: true });
    } catch {
      return installPath;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(installPath, entry.name);
      if (isValidRoot(candidate)) return candidate;
    }

    return installPath;
  }

  _isValidAppUpdateSource(sourcePath) {
    return fs.existsSync(path.join(sourcePath, 'backend', 'dist', 'index.js'));
  }

  _resolveAppUpdateSource(installPath) {
    return this._resolveUpdateBundleRoot(installPath);
  }

  /**
   * 执行 Python 下载脚本
   */
  _execDownload(engineId, version, repo, filename, outputDir) {
    return new Promise((resolve, reject) => {
      // 参数格式：model_id --output dir --files filename
      const args = [
        this.msScript,
        repo,
        '--output', outputDir,
        '--files', filename
      ];

      const proc = spawn(this.pythonPath, args, {
        cwd: PROJECT_ROOT,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        const line = data.toString();
        stderr += line;
        console.log(' ', line.trim());

        // 解析进度并更新到 downloadStateManager
        const info = this._parseTqdmLine(line);
        if (info.progress != null) {
          downloadStateManager.updateProgress(engineId, info.progress, info.speed || 0, version);
          if (info.downloadedBytes && info.totalBytes) {
            downloadStateManager.updateBytes(engineId, info.downloadedBytes, info.totalBytes, version);
          }
          eventBus.broadcast('download-progress', { engineId });
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Download failed with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * HTTP 直接下载（测试版 download_url 方式）
   */
  async _execHttpDownload(engineId, version, url, filePath) {
    console.log(`[engineDownloader] HTTP download: ${url}`);
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 0,
    });

    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    let downloadedBytes = 0;

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath);
      response.data.on('error', reject);
      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const progress = Math.floor((downloadedBytes / totalBytes) * 100);
          downloadStateManager.updateProgress(engineId, progress, 0, version);
          downloadStateManager.updateBytes(engineId, downloadedBytes, totalBytes, version);
          eventBus.broadcast('download-progress', { engineId });
        }
      });
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  /**
   * 解压文件，根据扩展名自动选择方式
   */
  async _extract(filePath, targetPath) {
    fs.mkdirSync(targetPath, { recursive: true });
    const name = filePath.toLowerCase();

    if (name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.tar')) {
      console.log(`Extracting tar archive: ${filePath} -> ${targetPath}`);
      await tar.extract({ file: filePath, cwd: targetPath });
    } else if (name.endsWith('.zip')) {
      console.log(`Extracting zip: ${filePath} -> ${targetPath}`);
      const zip = new AdmZip(filePath);
      zip.extractAllTo(targetPath, true);
    } else {
      throw new Error(`不支持的压缩格式: ${path.basename(filePath)}`);
    }

    console.log('Extraction complete');
  }

  /**
   * 运行引擎安装脚本（从 ci/ 目录读取，支持热更新）
   * 优先 .py，回退 .bat；找不到则报错
   */
  _runInstallScript(engineId, version, installPath, runtimeId = null) {
    const python313 = path.join(PROJECT_ROOT, 'external', 'python313', 'python.exe');
    const pyScript = path.join(PROJECT_ROOT, 'ci', `install_${engineId}.py`);
    const batScript = path.join(PROJECT_ROOT, 'ci', `install_${engineId}.bat`);

    const hasPy = fs.existsSync(pyScript) && fs.existsSync(python313);
    const hasBat = fs.existsSync(batScript);

    if (!hasPy && !hasBat) {
      // 无需安装脚本的引擎（如 ffmpeg）：zip 解压后直接可用
      const hasBin = fs.readdirSync(installPath).some(f => f.endsWith('.exe'));
      if (hasBin) {
        console.log(`No install script needed for ${engineId}, marking as installed`);
        const markerPath = path.join(installPath, '.installed');
        // TTS 引擎记录 variant_id 和实际 version
        const markerData = { installed_at: new Date().toISOString(), engine: engineId };
        if (engineId === 'tts') {
          const vInfo = engineManager.getEngineVersionInfo(engineId, version);
          markerData.version = version;
          markerData.variant_id = vInfo?.variant_id || installDirName;
        }
        fs.writeFileSync(markerPath, JSON.stringify(markerData));
        return Promise.resolve();
      }
      return Promise.reject(new Error(`No install script found for ${engineId} in ci/`));
    }

    downloadStateManager.setState(engineId, 'installing', null, version);
    eventBus.broadcast('download-progress', { engineId, status: 'installing' });

    const rocmPath = engineManager.getEnginePath('rocm') || '';
    const installRoot = installPath;

    let cmd, args, spawnEnv;

    if (hasPy) {
      console.log(`Running Python install script: ci/install_${engineId}.py`);
      cmd = python313;
      args = [pyScript, '--install-root', installRoot, '--rocm-path', rocmPath, '--project-root', PROJECT_ROOT];
      if (runtimeId) {
        args.push('--runtime-id', runtimeId);
      }
      spawnEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    } else {
      console.log(`Running bat install script: ci/install_${engineId}.bat`);
      cmd = 'cmd.exe';
      args = ['/c', batScript];
      spawnEnv = { ...process.env, INSTALL_ROOT: installRoot, ROCM_PATH: rocmPath, PROJECT_ROOT };
      if (runtimeId) {
        spawnEnv.NOVAMAX_RUNTIME_ID = runtimeId;
      }
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { cwd: installPath, env: spawnEnv, windowsHide: true });

      proc.stdout.on('data', (data) => console.log(`  [${engineId}] ${data.toString().trim()}`));
      proc.stderr.on('data', (data) => console.error(`  [${engineId}] ${data.toString().trim()}`));

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Install script failed with code ${code}`));
      });
      proc.on('error', (error) => reject(new Error(`Failed to run install script: ${error.message}`)));
    });
  }

  /**
   * 解析 tqdm 进度行
   */
  _parseTqdmLine(line) {
    const info = {};

    // 进度百分比
    const pctMatch = line.match(/(\d+)%\|/);
    if (pctMatch) info.progress = parseInt(pctMatch[1], 10);

    // 已下载/总大小
    const sizeMatch = line.match(/([\d.]+)\s*([KMGT]?i?)B?\s*\/\s*([\d.]+)\s*([KMGT]?i?)B?/);
    if (sizeMatch) {
      info.downloadedBytes = this._parseHumanSize(sizeMatch[1], sizeMatch[2]);
      info.totalBytes = this._parseHumanSize(sizeMatch[3], sizeMatch[4]);
    }

    // 速度
    const speedMatch = line.match(/([\d.]+)\s*([KMGT]?i?)B\/s/);
    if (speedMatch) {
      info.speed = this._parseHumanSize(speedMatch[1], speedMatch[2]);
    }

    return info;
  }

  /**
   * 解析人类可读的文件大小
   */
  _parseHumanSize(value, unit) {
    const n = parseFloat(value);
    if (isNaN(n)) return null;
    const u = unit.toUpperCase().replace('I', '');
    const multipliers = { '': 1, 'K': 1024, 'M': 1024 ** 2, 'G': 1024 ** 3, 'T': 1024 ** 4 };
    return Math.round(n * (multipliers[u] ?? 1));
  }
}

export default new EngineDownloader();
