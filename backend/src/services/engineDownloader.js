import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import * as tar from 'tar';
import AdmZip from 'adm-zip';
import axios from 'axios';
import { PROJECT_ROOT, DATA_DIR } from '../config/constants.js';
import { getPythonPath, getPythonScriptPath } from '../utils/pathHelper.js';
import engineManager from './engineManager.js';
import downloadStateManager from './downloadStateManager.js';
import eventBus from './eventBus.js';

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

    // 父引擎（有 variants）→ 解析到实际 variant engineId
    // 确保 install_${engineId}.py 能找到正确的安装脚本
    let effectiveEngineId = engineId;
    if (engine?.variants && !engine._parentKey && versionInfo.variant_id) {
      effectiveEngineId = versionInfo.variant_id;
    }

    // 检查依赖
    const depCheck = engineManager.checkDependencies(engineId, version);

    // 下载缺失的依赖（跳过空字符串）
    const tasks = [];
    const validMissing = depCheck.missing.filter(d => d.id && d.id.trim());
    for (const missing of validMissing) {
      const depEngine = engineManager.getEngine(missing.id);
      const depVersion = versionInfo.rocm_version || engineManager.getEngineVersions(missing.id)[0]?.version;
      const taskId = `${missing.id}::${depVersion}`;

      // 若该依赖已在另一条链中下载，不重置其状态，仅加入任务等待
      if (!downloadStateManager.hasDownload(missing.id, depVersion)) {
        downloadStateManager.createState(missing.id, depVersion, 'engine');
      }
      tasks.push({ taskId, engineId: missing.id, version: depVersion });
    }

    // 下载主引擎（task 用原始 engineId，effectiveEngineId 仅用于安装脚本查找）
    const taskId = `${engineId}::${version}`;
    downloadStateManager.createState(engineId, version, 'engine');
    tasks.unshift({ taskId, engineId, version, _effectiveEngineId: effectiveEngineId !== engineId ? effectiveEngineId : null });

    // 下载运行时（若有，并行下载）
    let runtimeTask = null;
    if (runtimeId) {
      const runtime = engineManager.getEngineRuntime(effectiveEngineId, runtimeId);
      if (runtime?.modelscope_file) {
        const rtTaskId = `${effectiveEngineId}_runtime_${runtimeId}`;
        downloadStateManager.createState(rtTaskId, null, 'engine');
        const effEng = engineManager.getEngine(effectiveEngineId);
        runtimeTask = { taskId: rtTaskId, engineId: effectiveEngineId, version, isRuntime: true, runtimeFile: runtime.modelscope_file, runtimeRepo: effEng?.modelscope_repo || engine.modelscope_repo };
      }
    }

    // 后台执行下载
    this._runDownloadChain(tasks, runtimeId, runtimeTask);

    return { tasks: runtimeTask ? [...tasks, runtimeTask] : tasks };
  }

  /**
   * 重新安装（不重新下载，只重跑安装脚本）
   */
  async reinstall(engineId, version) {
    // 解析 variant 路径：external/{parentId}/{variantId}/{version}/
    const vInfo = engineManager.getEngineVersionInfo(engineId, version);
    const eng = engineManager.getEngine(engineId);
    let installDir;
    if (vInfo?.variant_id) {
      installDir = path.join(engineId, vInfo.variant_id, version);
    } else if (eng?._parentKey) {
      installDir = path.join(eng._parentKey, engineId, version);
    } else {
      installDir = path.join(engineId, version);
    }
    const installPath = path.join(PROJECT_ROOT, 'external', installDir);
    try {
      await fsp.access(installPath);
    } catch {
      throw new Error(`目录不存在: ${installPath}，请重新下载`);
    }

    const taskId = `${engineId}::${version}`;
    downloadStateManager.createState(engineId, version, 'engine');
    downloadStateManager.setState(engineId, 'installing', null, version);
    eventBus.broadcast('download-progress', { engineId, status: 'installing' });

    // variant 引擎：解析安装脚本 ID
    const installId = vInfo?.variant_id || engineId;

    // 后台执行，不阻塞响应
    (async () => {
      try {
        // 删除旧标记，确保重装
        const marker = path.join(installPath, '.installed');
        await fsp.unlink(marker).catch(() => {});

        const ciPy = path.join(PROJECT_ROOT, 'ci', `install_${installId}.py`);
        const ciBat = path.join(PROJECT_ROOT, 'ci', `install_${installId}.bat`);
        let hasCiScript = true;
        try { await fsp.access(ciPy); } catch {
          try { await fsp.access(ciBat); } catch { hasCiScript = false; }
        }

        await this._runInstallScript(installId, version, installPath);

        if (!hasCiScript) {
          await fsp.writeFile(marker, JSON.stringify({ installed_at: new Date().toISOString(), engine: engineId }));
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
  async _runDownloadChain(tasks, runtimeId = null, runtimeTask = null) {
    // 先下载引擎（不传 runtimeId 避免安装脚本重复下载）
    for (const taskInfo of tasks) {
      await this._runSingleDownload(taskInfo, null);
    }
    // 再下载运行时（引擎已安装完毕，合并不会丢）
    if (runtimeTask) {
      try {
        await this._runSingleDownload(runtimeTask, null);
      } catch (err) {
        downloadStateManager.setState(runtimeTask.taskId, 'failed', err.message, null);
      }
    }
  }

  async _runSingleDownload(taskInfo, runtimeId) {
      const lockKey = `${taskInfo.engineId}::${taskInfo.version}`;

      // 若另一条链正在下载同一引擎（如 rocm），等待其完成后跳过重复下载
      if (this._activeEngineDownloads.has(lockKey)) {
        console.log(`[engineDownloader] 等待已有下载任务: ${lockKey}`);
        try {
          await this._activeEngineDownloads.get(lockKey);
        } catch (_) {
          // 已有下载失败，当前链也标记失败
          const sid = taskInfo.isRuntime ? taskInfo.taskId : taskInfo.engineId;
          const sver = taskInfo.isRuntime ? null : taskInfo.version;
          downloadStateManager.setState(sid, 'failed', '依赖下载失败', sver);
          eventBus.broadcast('download-progress', { engineId: sid, status: 'failed', error: '依赖下载失败' });
          return;
        }
      }

      let resolveLock, rejectLock;
      const lockPromise = new Promise((res, rej) => { resolveLock = res; rejectLock = rej; });
      lockPromise.catch(() => {}); // 防止无等待者时 unhandled rejection 导致进程崩溃
      this._activeEngineDownloads.set(lockKey, lockPromise);

      const stateId = taskInfo.isRuntime ? taskInfo.taskId : taskInfo.engineId;
      const stateVer = taskInfo.isRuntime ? null : taskInfo.version;

      try {
        downloadStateManager.setState(stateId, 'downloading', null, stateVer);
        eventBus.broadcast('download-progress', { engineId: stateId, status: 'downloading' });

        const effId = taskInfo._effectiveEngineId || taskInfo.engineId;
        await this._downloadEngine(taskInfo.engineId, taskInfo.version, runtimeId, taskInfo, effId);

        downloadStateManager.setState(stateId, 'completed', null, stateVer);
        downloadStateManager.updateProgress(stateId, 100, 0, stateVer);
        eventBus.broadcast('download-progress', { engineId: stateId, status: 'completed' });
        resolveLock();
      } catch (error) {
        downloadStateManager.setState(stateId, 'failed', error.message, stateVer);
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

  /**
   * 下载单个引擎
   * 支持两种方式：
   *   - download_url：直接 HTTP 下载（测试版）
   *   - modelscope_repo + modelscope_file：ModelScope 下载（正式版）
   */
  async _downloadEngine(engineId, version, runtimeId = null, taskInfo = {}, installEngineId = null) {
    // engineId: 引擎管理（getEngine, getEngineVersionInfo）用的真实 ID
    // installEngineId: 安装脚本查找用的 ID（可能为 variant ID）
    const installId = installEngineId || engineId;
    // 运行时下载
    if (taskInfo.isRuntime) {
      const downloadDir = path.join(PROJECT_ROOT, 'downloads/engines');
      await fsp.mkdir(downloadDir, { recursive: true });
      const filename = path.basename(taskInfo.runtimeFile);
      const filePath = path.join(downloadDir, filename);
      await fsp.unlink(filePath).catch(() => {});

      const repo = taskInfo.runtimeRepo;
      await this._execDownload(taskInfo.taskId, '', repo, taskInfo.runtimeFile, downloadDir);

      // 解压到临时目录，解包后合并到引擎目录
      const realEngineId = engineId.split('::')[0];
      const eng = engineManager.getEngine(realEngineId);
      const enginePath = engineManager.getEnginePath(realEngineId);
      const installPath = enginePath || (eng?._parentKey
        ? path.join(PROJECT_ROOT, 'external', eng._parentKey, realEngineId, version)
        : path.join(PROJECT_ROOT, 'external', realEngineId, version));
      const tmpExtract = installPath + '___runtime_tmp';
      await fsp.rm(tmpExtract, { recursive: true, force: true }).catch(() => {});
      await fsp.mkdir(tmpExtract, { recursive: true });
      await this._extract(filePath, tmpExtract);

      // 解包单层子目录
      let sourcePath = tmpExtract;
      const entries = await fsp.readdir(tmpExtract).catch(() => []);
      if (entries.length === 1) {
        const singleDir = path.join(tmpExtract, entries[0]);
        if ((await fsp.stat(singleDir).catch(() => null))?.isDirectory()) {
          sourcePath = singleDir;
        }
      }

      // 合并到引擎目录
      await fsp.mkdir(installPath, { recursive: true });
      for (const f of await fsp.readdir(sourcePath)) {
        await fsp.rename(path.join(sourcePath, f), path.join(installPath, f)).catch(async () => {
          await fsp.cp(path.join(sourcePath, f), path.join(installPath, f), { recursive: true });
        });
      }
      await fsp.rm(tmpExtract, { recursive: true, force: true }).catch(() => {});
      return;
    }

    const engine = engineManager.getEngine(engineId);
    const versionInfo = engineManager.getEngineVersionInfo(engineId, version);

    const downloadDir = path.join(PROJECT_ROOT, 'downloads/engines');
    await fsp.mkdir(downloadDir, { recursive: true });

    // 确定文件名
    const filename = versionInfo.download_url
      ? path.basename(new URL(versionInfo.download_url).pathname)
      : path.basename(versionInfo.modelscope_file);
    const filePath = path.join(downloadDir, filename);

    // 清理上次可能残留的不完整压缩包
    await fsp.unlink(filePath).catch(() => {});

    // 下载
    try {
      if (versionInfo.download_url) {
        await this._execHttpDownload(engineId, version, versionInfo.download_url, filePath);
      } else {
        const repo = versionInfo.modelscope_repo || engine.modelscope_repo;
        await this._execDownload(engineId, version, repo, versionInfo.modelscope_file, downloadDir);
      }
    } catch (err) {
      await fsp.unlink(filePath).catch(() => {});
      throw err;
    }

    // 验证文件是否存在且非空
    let fileStat;
    try { fileStat = await fsp.stat(filePath); } catch { fileStat = null; }
    if (!fileStat || fileStat.size === 0) {
      await fsp.unlink(filePath).catch(() => {});
      throw new Error(`下载失败：文件不存在或大小为0，请重试`);
    }

    // 解压到临时目录（与最终安装目录同层级，避免 rename 跨目录失败）
    const vInfo2 = engineManager.getEngineVersionInfo(engineId, version);
    let tempDir = engineId;
    if (vInfo2?.variant_id) tempDir = path.join(engineId, vInfo2.variant_id);
    else if (engine?._parentKey) tempDir = path.join(engine._parentKey, engineId);
    const tempExtractPath = path.join(PROJECT_ROOT, 'external', tempDir, `_temp_${version}`);
    downloadStateManager.setState(engineId, 'unpacking', null, version);
    eventBus.broadcast('download-progress', { engineId, status: 'unpacking' });
    try {
      // 清理可能存在的残留临时目录
      await fsp.rm(tempExtractPath, { recursive: true, force: true }).catch(() => {});
      await this._extract(filePath, tempExtractPath);
    } catch (err) {
      await fsp.unlink(filePath).catch(() => {});
      throw err;
    }

    // 确定最终安装目录
    const _eng = engineManager.getEngine(engineId);
    const vInfo = engineManager.getEngineVersionInfo(engineId, version);
    let installDirName;
    if (vInfo?.variant_id) {
      // 父引擎的 variant 版本：external/{parentId}/{variantId}/{version}/
      installDirName = path.join(engineId, vInfo.variant_id, version);
    } else if (_eng?._parentKey) {
      // variant 引擎自身：external/{parentKey}/{variantId}/{version}/
      installDirName = path.join(_eng._parentKey, engineId, version);
    } else {
      // 独立引擎：external/{engineId}/{version}/
      installDirName = path.join(engineId, version);
    }
    const installPath = path.join(PROJECT_ROOT, 'external', installDirName);

    // 解包顶层单目录（在 temp 中完成，不受 installPath 已有文件影响）
    let sourcePath = tempExtractPath;
    const tempEntries = await fsp.readdir(tempExtractPath).catch(() => []);
    if (tempEntries.length === 1) {
      const singleDir = path.join(tempExtractPath, tempEntries[0]);
      const stat = await fsp.stat(singleDir).catch(() => null);
      if (stat?.isDirectory()) {
        sourcePath = singleDir;
      }
    }

    // 合并到安装目录（覆盖同名文件，保留已有文件如运行时）
    await fsp.mkdir(installPath, { recursive: true });
    await this._mergeDir(sourcePath, installPath);
    await fsp.rm(tempExtractPath, { recursive: true, force: true }).catch(() => {});

    // 安装步骤
    if (engine.category === 'app') {
      const updateSource = this._resolveAppUpdateSource(installPath);
      if (!this._isValidAppUpdateSource(updateSource)) {
        throw new Error(`更新包结构无效: ${updateSource}`);
      }
      // App 更新：写 pending 文件，然后自动重启
      const PENDING_FILE = path.join(DATA_DIR, 'updates', 'pending');
      await fsp.mkdir(path.dirname(PENDING_FILE), { recursive: true });
      await fsp.writeFile(PENDING_FILE, updateSource, 'utf8');
      await fsp.unlink(filePath).catch(() => {});
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
    await this._runInstallScript(installId, version, installPath, runtimeId);

    // 安装脚本可能未写 version，统一补充
    const markerPath = path.join(installPath, '.installed');
    try {
      const m = JSON.parse(await fsp.readFile(markerPath, 'utf-8'));
      if (!m.version) {
        m.version = version;
        await fsp.writeFile(markerPath, JSON.stringify(m));
      }
    } catch {}

    // 清理下载文件
    await fsp.unlink(filePath).catch(() => {});
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
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // 必须消费 stdout，防止管道缓冲区满导致子进程阻塞
      let stdout = '';
      proc.stdout.on('data', (data) => { stdout += data.toString('utf-8'); });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        const line = data.toString('utf-8');
        stderr += line;
        console.log('[engineDownloader] stderr:', line.trim());

        // 解析进度并更新到 downloadStateManager
        const info = this._parseTqdmLine(line);
        console.log('[engineDownloader] parsed:', JSON.stringify(info));
        if (info.progress != null) {
          downloadStateManager.updateProgress(engineId, info.progress, info.speed || 0, version);
          if (info.downloadedBytes && info.totalBytes) {
            downloadStateManager.updateBytes(engineId, info.downloadedBytes, info.totalBytes, version);
          }
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // 尝试从 stdout JSON 中提取错误信息
          let detail = stderr.trim();
          if (!detail) {
            try {
              const json = JSON.parse(stdout.trim());
              detail = json.error || json.message || '';
            } catch {}
          }
          reject(new Error(detail || `Download failed with code ${code}`));
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
        }
      });
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  /**
   * 递归合并 src 目录内容到 dest，覆盖同名文件但保留 dest 中不冲突的文件
   */
  async _mergeDir(src, dest) {
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await fsp.mkdir(destPath, { recursive: true });
        await this._mergeDir(srcPath, destPath);
      } else {
        await fsp.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * 解压文件，根据扩展名自动选择方式（全异步，不阻塞事件循环）
   */
  async _extract(filePath, targetPath) {
    await fsp.mkdir(targetPath, { recursive: true });
    const name = filePath.toLowerCase();

    if (name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.tar')) {
      console.log(`Extracting tar archive: ${filePath} -> ${targetPath}`);
      await tar.extract({ file: filePath, cwd: targetPath });
    } else if (name.endsWith('.zip')) {
      console.log(`Extracting zip: ${filePath} -> ${targetPath}`);
      new AdmZip(filePath).extractAllTo(targetPath, true);
    } else {
      throw new Error(`不支持的压缩格式: ${path.basename(filePath)}`);
    }

    console.log('Extraction complete');
  }

  /**
   * 运行引擎安装脚本（从 ci/ 目录读取，支持热更新）
   * 优先 .py，回退 .bat；找不到则报错
   */
  async _runInstallScript(engineId, version, installPath, runtimeId = null) {
    // 尝试 variant 脚本，不存在则回退到父引擎脚本
    const eng = engineManager.getEngine(engineId);
    const parentId = eng?._parentKey;
    const scriptIds = [engineId];
    if (parentId) scriptIds.push(parentId);

    let pyScript = null, batScript = null;
    const python313 = path.join(PROJECT_ROOT, 'external', 'python313', 'python.exe');
    for (const sid of scriptIds) {
      const py = path.join(PROJECT_ROOT, 'ci', `install_${sid}.py`);
      const bat = path.join(PROJECT_ROOT, 'ci', `install_${sid}.bat`);
      if (fs.existsSync(py) && fs.existsSync(python313)) { pyScript = py; break; }
      if (fs.existsSync(bat)) { batScript = bat; break; }
    }
    if (!pyScript && !batScript) pyScript = path.join(PROJECT_ROOT, 'ci', `install_${engineId}.py`);
    if (!pyScript && !batScript) batScript = path.join(PROJECT_ROOT, 'ci', `install_${engineId}.bat`);

    const hasPy = fs.existsSync(pyScript) && fs.existsSync(python313);
    const hasBat = fs.existsSync(batScript);

    if (!hasPy && !hasBat) {
      // 无需安装脚本的引擎（如 ffmpeg）：zip 解压后直接可用
      const dirents = await fsp.readdir(installPath).catch(() => []);
      const hasBin = dirents.some(f => f.endsWith('.exe'));
      // 有 .exe 或有 contract.json+adapter.js 的引擎无需安装脚本
      const hasContract = dirents.some(f => f === 'contract.json') && dirents.some(f => f === 'adapter.js');
      if (hasBin || hasContract) {
        console.log(`No install script needed for ${engineId}, marking as installed`);
        const markerPath = path.join(installPath, '.installed');
        const markerData = { installed_at: new Date().toISOString(), engine: engineId };
        if (engineId === 'tts') {
          const vInfo = engineManager.getEngineVersionInfo(engineId, version);
          markerData.version = version;
          markerData.variant_id = vInfo?.variant_id || path.basename(path.dirname(installPath));
        }
        await fsp.writeFile(markerPath, JSON.stringify(markerData));
        return;
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
