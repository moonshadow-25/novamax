import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import * as tar from 'tar';
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
  }

  /**
   * 启动下载（含依赖处理）
   * @param {string} engineId
   * @param {string} version
   * @returns {Object} { tasks: [{ engineId, version }] }
   */
  async startDownloadWithDependencies(engineId, version) {
    const engine = engineManager.getEngine(engineId);
    if (!engine) {
      throw new Error('Engine not found');
    }

    const versionInfo = engine.versions.find(v => v.version === version);
    if (!versionInfo) {
      throw new Error('Version not found');
    }

    // 检查依赖
    const depCheck = engineManager.checkDependencies(engineId, version);
    const tasks = [];

    // 下载缺失的依赖
    for (const missing of depCheck.missing) {
      const depEngine = engineManager.getEngine(missing.id);
      const depVersion = versionInfo.rocm_version || depEngine.versions[0].version;
      const taskId = `${missing.id}::${depVersion}`;

      downloadStateManager.createState(missing.id, depVersion, 'engine');
      tasks.push({ taskId, engineId: missing.id, version: depVersion });
    }

    // 下载主引擎
    const taskId = `${engineId}::${version}`;
    downloadStateManager.createState(engineId, version, 'engine');
    tasks.push({ taskId, engineId, version });

    // 后台执行下载链
    this._runDownloadChain(tasks);

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
  async _runDownloadChain(tasks) {
    for (const taskInfo of tasks) {
      try {
        downloadStateManager.setState(taskInfo.engineId, 'downloading', null, taskInfo.version);
        eventBus.broadcast('download-progress', {
          engineId: taskInfo.engineId,
          status: 'downloading'
        });

        await this._downloadEngine(taskInfo.engineId, taskInfo.version);

        downloadStateManager.setState(taskInfo.engineId, 'completed', null, taskInfo.version);
        downloadStateManager.updateProgress(taskInfo.engineId, 100, 0, taskInfo.version);
        eventBus.broadcast('download-progress', {
          engineId: taskInfo.engineId,
          status: 'completed'
        });
      } catch (error) {
        downloadStateManager.setState(taskInfo.engineId, 'failed', error.message, taskInfo.version);
        eventBus.broadcast('download-progress', {
          engineId: taskInfo.engineId,
          status: 'failed',
          error: error.message
        });
      }
    }
  }

  /**
   * 下载单个引擎
   */
  async _downloadEngine(engineId, version) {
    const engine = engineManager.getEngine(engineId);
    const versionInfo = engine.versions.find(v => v.version === version);

    const downloadDir = path.join(PROJECT_ROOT, 'downloads/engines');
    fs.mkdirSync(downloadDir, { recursive: true });

    const filePath = path.join(downloadDir, path.basename(versionInfo.modelscope_file));

    // 下载
    await this._execDownload(engineId, version, engine.modelscope_repo, versionInfo.modelscope_file, downloadDir);

    // 解压
    const installPath = path.join(PROJECT_ROOT, 'external', engineId, version);
    downloadStateManager.setState(engineId, 'unpacking', null, version);
    eventBus.broadcast('download-progress', { engineId, status: 'unpacking' });
    await this._extract(filePath, installPath);

    // 安装步骤
    if (engine.category === 'app') {
      // App 更新：写 pending 文件，交给守护进程处理
      const PENDING_FILE = path.join(DATA_DIR, 'updates', 'pending');
      fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true });
      fs.writeFileSync(PENDING_FILE, installPath, 'utf8');
      console.log(`[engineDownloader] App update staged at ${installPath}, exiting...`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      setTimeout(() => process.exit(0), 500);
      return;
    }

    // 普通引擎：运行安装脚本（脚本负责写 .installed）
    await this._runInstallScript(engineId, version, installPath);

    // 清理下载文件
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
  _runInstallScript(engineId, version, installPath) {
    const python313 = path.join(PROJECT_ROOT, 'external', 'python313', 'python.exe');
    const pyScript = path.join(PROJECT_ROOT, 'ci', `install_${engineId}.py`);
    const batScript = path.join(PROJECT_ROOT, 'ci', `install_${engineId}.bat`);

    const hasPy = fs.existsSync(pyScript) && fs.existsSync(python313);
    const hasBat = fs.existsSync(batScript);

    if (!hasPy && !hasBat) {
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
      spawnEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    } else {
      console.log(`Running bat install script: ci/install_${engineId}.bat`);
      cmd = 'cmd.exe';
      args = ['/c', batScript];
      spawnEnv = { ...process.env, INSTALL_ROOT: installRoot, ROCM_PATH: rocmPath, PROJECT_ROOT };
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
