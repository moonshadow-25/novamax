import express from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { PassThrough } from 'stream';
import processManager from '../services/processManager.js';
import modelManager from '../services/modelManager.js';
import comfyuiInstanceManager from '../services/comfyuiInstanceManager.js';
import logCollector from '../services/logCollector.js';
import configManager from '../services/configManager.js';
import { PROJECT_ROOT, MODELS_RUN_DIR, DATA_DIR } from '../config/constants.js';

const execAsync = promisify(exec);
const router = express.Router();

/**
 * 通过 tasklist 批量查询进程内存占用（Windows）
 */
async function getProcessMemoryMap() {
  const memMap = new Map();
  try {
    const { stdout } = await execAsync(
      'tasklist /FO CSV /NH',
      { encoding: 'utf-8', timeout: 5000 }
    );
    for (const line of stdout.split('\n')) {
      const parts = line.match(/"([^"]*)"/g);
      if (!parts || parts.length < 5) continue;
      const pid = parseInt(parts[1].replace(/"/g, ''));
      // 内存字段格式: "123,456 K"
      const memStr = parts[4].replace(/"/g, '')
        .replace(/[, K]/g, '');
      const memKB = parseInt(memStr);
      if (!isNaN(pid) && !isNaN(memKB)) {
        memMap.set(pid, memKB * 1024);
      }
    }
  } catch (e) {
    // 静默失败
  }
  return memMap;
}

router.get('/system/info', async (req, res) => {
  try {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const memMap = await getProcessMemoryMap();

    const running = processManager.getAllRunning().map(p => {
      const memory = p.pid ? (memMap.get(p.pid) || 0) : 0;
      if (p.category === 'model') {
        const model = modelManager.getById(p.id);
        return { ...p, name: model?.name || p.id, memory };
      }
      if (p.category === 'router') {
        const names = p.modelIds.map(id => {
          const m = modelManager.getById(id);
          return m?.name || id;
        });
        return {
          ...p,
          name: `${p.type.toUpperCase()} Router`,
          modelNames: names,
          memory
        };
      }
      return { ...p, memory };
    });

    // ComfyUI 实例进程
    const comfyuiProcesses = comfyuiInstanceManager.getRunningProcesses().map(p => {
      const memory = p.pid ? (memMap.get(p.pid) || 0) : 0;
      return { ...p, memory };
    });
    running.push(...comfyuiProcesses);

    // NovaMax 自身进程
    const selfMem = process.memoryUsage();
    running.unshift({
      id: 'novamax-server',
      pid: process.pid,
      name: 'NovaMax Server',
      type: 'system',
      mode: 'service',
      port: 3001,
      category: 'system',
      memory: selfMem.rss,
      startTime: Date.now() - (process.uptime() * 1000)
    });

    res.json({
      hardware: {
        cpu: {
          model: cpus[0]?.model || 'Unknown',
          cores: cpus.length,
          speed: cpus[0]?.speed || 0
        },
        memory: {
          total: totalMem,
          free: freeMem,
          used: totalMem - freeMem,
          usagePercent: Math.round(
            ((totalMem - freeMem) / totalMem) * 100
          )
        },
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime()
      },
      processes: running
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 全局日志 ==========

router.get('/system/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const level = req.query.level || 'all';
  res.json({ logs: logCollector.getLogs(limit, level) });
});

router.delete('/system/logs', (req, res) => {
  logCollector.clear();
  res.json({ success: true });
});

// ========== 模型存储管理 ==========

/** 存储迁移/还原异步任务状态 */
const migrationJobs = new Map();

function createJob() {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  migrationJobs.set(jobId, {
    status: 'running', message: '', startTime: Date.now(), endTime: null,
    totalBytes: 0, copiedBytes: 0, progress: 0, speed: 0,
    phase: 'migrate', // 'backup' | 'migrate'
    backupPath: null,
    sameDrive: false
  });
  return jobId;
}

function finishJob(jobId, success, message) {
  const job = migrationJobs.get(jobId);
  if (job) {
    job.status = success ? 'success' : 'failed';
    job.message = message;
    job.endTime = Date.now();
    if (success) { job.progress = 100; job.copiedBytes = job.totalBytes; }
    setTimeout(() => migrationJobs.delete(jobId), 600000);
  }
}

router.get('/system/storage/job-status/:jobId', (req, res) => {
  const job = migrationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json(job);
});

/** 检测两个路径是否在同一个盘符（卷） */
function isSameDrive(p1, p2) {
  return path.parse(path.resolve(p1)).root.toLowerCase() ===
         path.parse(path.resolve(p2)).root.toLowerCase();
}

/** 获取指定路径所在盘符的剩余空间（字节），失败返回 null */
async function getDriveFreeSpace(targetPath) {
  try {
    const root = path.parse(path.resolve(targetPath)).root; // e.g. "C:\"
    const letter = root.charAt(0).toUpperCase();
    // 优先用 wmic，失败时用 PowerShell 兜底
    try {
      const { stdout } = await execAsync(
        `wmic logicaldisk where "DeviceID='${letter}:'" get FreeSpace /value`,
        { timeout: 5000, encoding: 'utf8' }
      );
      const match = stdout.match(/FreeSpace=(\d+)/);
      if (match) return parseInt(match[1], 10);
    } catch (_) { /* fall through */ }

    const { stdout: ps } = await execAsync(
      `powershell -NoProfile -Command "(Get-PSDrive -Name '${letter}').Free"`,
      { timeout: 5000, encoding: 'utf8' }
    );
    const num = parseInt(ps.trim(), 10);
    return isNaN(num) ? null : num;
  } catch (e) {
    return null;
  }
}

// ── 大文件阈值与小文件并发数 ──────────────────────────────────────────────────
const LARGE_FILE_THRESHOLD = 512 * 1024 * 1024; // 512 MB：大文件顺序复制最大化带宽
const COPY_CONCURRENCY = 8;                      // 小文件最大并发数

/** 流式复制单个文件，边复制边计算 SHA-256，返回源文件哈希 */
function streamCopyFile(srcFile, destFile, onChunk) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const pt = new PassThrough();
    const rs = fs.createReadStream(srcFile);
    const ws = fs.createWriteStream(destFile);
    pt.on('data', chunk => { hash.update(chunk); if (onChunk) onChunk(chunk.length); });
    rs.on('error', reject);
    pt.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', () => resolve(hash.digest('hex')));
    rs.pipe(pt).pipe(ws);
  });
}

/** 独立读取文件计算 SHA-256（用于验证目标文件） */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', chunk => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
    rs.on('error', reject);
  });
}

/**
 * 复制单个文件，含 SHA-256 校验、时间戳保留、失败重试（最多 3 次）。
 * move=true 时：只有校验通过才删除源文件，保证数据安全。
 */
async function copyFileVerified(srcFile, destFile, onChunk, move) {
  const srcStat = fs.statSync(srcFile);
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (fs.existsSync(destFile)) { try { fs.unlinkSync(destFile); } catch (_) {} }
    try {
      const srcHash = await streamCopyFile(srcFile, destFile, onChunk);
      const destHash = await hashFile(destFile); // 独立读取验证，捕获静默写入错误
      if (srcHash !== destHash) throw new Error(`SHA-256 不匹配 (第 ${attempt} 次): ${path.basename(srcFile)}`);
      fs.utimesSync(destFile, srcStat.atime, srcStat.mtime); // 补回时间戳
      if (move) fs.unlinkSync(srcFile); // 校验通过后才删源文件
      return srcHash;
    } catch (err) {
      if (fs.existsSync(destFile)) { try { fs.unlinkSync(destFile); } catch (_) {} }
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt)); // 重试等待 1s / 2s
    }
  }
}

/**
 * 复制目录，支持字节级进度、SHA-256 校验、时间戳保留、失败重试。
 * 大文件（>= LARGE_FILE_THRESHOLD）顺序复制；小文件并发（最多 COPY_CONCURRENCY 个）。
 */
async function copyWithProgress(src, dest, move, jobId) {
  const job = migrationJobs.get(jobId);

  // 递归枚举文件
  function listFiles(dir) {
    const result = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) result.push(...listFiles(full));
      else if (entry.isFile()) result.push({ full, rel: path.relative(src, full), size: fs.statSync(full).size });
    }
    return result;
  }

  const files = listFiles(src);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  if (job) { job.totalBytes = totalBytes; job.copiedBytes = 0; job.progress = 0; job.speed = 0; }

  // 日志（UTF-8，无乱码）
  const logsDir = path.join(DATA_DIR, 'logs', 'migrate');
  fs.mkdirSync(logsDir, { recursive: true });
  const logStream = fs.createWriteStream(path.join(logsDir, `migrate_${jobId}_${Date.now()}.log`), { encoding: 'utf8' });
  const log = msg => logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
  log(`${move ? '迁移' : '备份'} | ${files.length} 个文件 | ${(totalBytes / 1024 ** 3).toFixed(2)} GB`);
  log(`大文件阈值: ${LARGE_FILE_THRESHOLD / 1024 ** 2} MB | 小文件并发: ${COPY_CONCURRENCY}`);

  // 进度追踪（inProgressMap 追踪并发小文件各自的已读字节）
  let completedBytes = 0;
  let snapshotBytes = 0, snapshotTime = Date.now();
  const inProgressMap = new Map();

  const tick = (rel, chunkLen) => {
    if (!job) return;
    if (rel) inProgressMap.set(rel, (inProgressMap.get(rel) || 0) + chunkLen);
    const inProgress = [...inProgressMap.values()].reduce((a, b) => a + b, 0);
    job.copiedBytes = Math.min(completedBytes + inProgress, totalBytes);
    job.progress = totalBytes > 0 ? Math.min(99, Math.round(job.copiedBytes / totalBytes * 100)) : 0;
    const now = Date.now();
    const elapsed = (now - snapshotTime) / 1000;
    if (elapsed >= 1) { job.speed = (job.copiedBytes - snapshotBytes) / elapsed; snapshotBytes = job.copiedBytes; snapshotTime = now; }
  };

  const finishFile = (file, hash) => {
    completedBytes += file.size;
    inProgressMap.delete(file.rel);
    tick(null, 0);
    log(`✓ ${file.rel} | ${(file.size / 1024 ** 2).toFixed(2)} MB | sha256:${hash.slice(0, 16)}...`);
  };

  // 大文件顺序处理
  for (const file of files.filter(f => f.size >= LARGE_FILE_THRESHOLD)) {
    fs.mkdirSync(path.dirname(path.join(dest, file.rel)), { recursive: true });
    inProgressMap.set(file.rel, 0);
    const hash = await copyFileVerified(file.full, path.join(dest, file.rel), len => tick(file.rel, len), move);
    finishFile(file, hash);
  }

  // 小文件并发处理（worker pool）
  const smallTasks = files.filter(f => f.size < LARGE_FILE_THRESHOLD).map(file => async () => {
    fs.mkdirSync(path.dirname(path.join(dest, file.rel)), { recursive: true });
    inProgressMap.set(file.rel, 0);
    const hash = await copyFileVerified(file.full, path.join(dest, file.rel), len => tick(file.rel, len), move);
    finishFile(file, hash);
  });

  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, smallTasks.length || 1) }, async () => {
    while (idx < smallTasks.length) await smallTasks[idx++]();
  }));

  // 保留目录时间戳（补回 robocopy /COPY:T 对目录的处理）
  const syncDirTimes = (srcDir, destDir) => {
    try {
      for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (e.isDirectory()) syncDirTimes(path.join(srcDir, e.name), path.join(destDir, e.name));
      }
      const s = fs.statSync(srcDir);
      fs.utimesSync(destDir, s.atime, s.mtime);
    } catch (_) {}
  };
  syncDirTimes(src, dest);

  // move 模式：清理空目录
  if (move) {
    const removeEmpty = dir => {
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) removeEmpty(path.join(dir, e.name));
        }
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch (_) {}
    };
    removeEmpty(src);
  }

  log('完成');
  logStream.end();
}

const STORAGE_TYPES = {
  llm: { label: 'LLM 模型', dir: 'llm' },
  comfyui: { label: 'ComfyUI 模型', dir: 'comfyui' },
  tts: { label: 'TTS 模型', dir: 'tts' },
  whisper: { label: 'Whisper 模型', dir: 'whisper' }
};

/** 递归计算目录大小 */
function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else if (entry.isFile()) {
        size += fs.statSync(fullPath).size;
      }
    }
  } catch (e) { /* ignore */ }
  return size;
}

/** 检测路径是否为 junction/symlink */
function isJunction(dirPath) {
  try {
    const stat = fs.lstatSync(dirPath);
    return stat.isSymbolicLink();
  } catch (e) {
    return false;
  }
}

/** 获取 junction 的真实目标路径 */
function getJunctionTarget(dirPath) {
  try {
    return fs.readlinkSync(dirPath);
  } catch (e) {
    return null;
  }
}

router.get('/system/storage', async (req, res) => {
  try {
    const items = [];
    for (const [type, info] of Object.entries(STORAGE_TYPES)) {
      const dirPath = path.join(MODELS_RUN_DIR, info.dir);
      const exists = fs.existsSync(dirPath);
      const junction = isJunction(dirPath);
      const target = junction ? getJunctionTarget(dirPath) : null;
      const realPath = junction ? target : dirPath;
      const size = exists ? getDirSize(dirPath) : 0;
      const driveFreeSpace = realPath ? await getDriveFreeSpace(realPath) : null;

      items.push({
        type,
        label: info.label,
        path: dirPath,
        exists,
        size,
        driveFreeSpace,
        isJunction: junction,
        junctionTarget: target
      });
    }
    res.json({ basePath: MODELS_RUN_DIR, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/system/storage/open', async (req, res) => {
  try {
    const { dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: '缺少路径' });
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    exec(`explorer.exe "${resolved}"`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/system/storage/migrate', async (req, res) => {
  console.log('[migrate] 收到请求:', req.body);
  try {
    const { type, targetPath, backup = false } = req.body;
    if (!type || !targetPath) return res.status(400).json({ error: '缺少参数' });
    const info = STORAGE_TYPES[type];
    if (!info) return res.status(400).json({ error: '无效的类型' });

    const srcPath = path.join(MODELS_RUN_DIR, info.dir);
    const destPath = path.resolve(targetPath);

    if (path.resolve(srcPath) === destPath) {
      return res.status(400).json({ error: '目标路径不能与当前路径相同' });
    }

    const realSrc = isJunction(srcPath) ? getJunctionTarget(srcPath) : srcPath;

    // 验证目标路径
    if (fs.existsSync(destPath)) {
      if (fs.readdirSync(destPath).length > 0) {
        return res.status(400).json({ error: `目标路径 ${destPath} 已存在且非空，请清空后重试` });
      }
    } else {
      const parentDir = path.dirname(destPath);
      if (!fs.existsSync(parentDir)) {
        return res.status(400).json({ error: `父目录 ${parentDir} 不存在，请先创建` });
      }
    }

    const sameDrive = isSameDrive(realSrc, destPath);

    if (!sameDrive) {
      // 跨盘：检查目标磁盘剩余空间
      const srcSize = getDirSize(realSrc);
      const destFree = await getDriveFreeSpace(destPath);
      if (destFree !== null && destFree < srcSize) {
        const need = (srcSize / 1024 ** 3).toFixed(2);
        const avail = (destFree / 1024 ** 3).toFixed(2);
        return res.status(400).json({ error: `目标磁盘空间不足：需要 ${need} GB，可用 ${avail} GB` });
      }
      // 如需备份，同时检查源磁盘剩余空间（备份写回源盘）
      if (backup) {
        const srcFree = await getDriveFreeSpace(realSrc);
        if (srcFree !== null && srcFree < srcSize) {
          const need = (srcSize / 1024 ** 3).toFixed(2);
          const avail = (srcFree / 1024 ** 3).toFixed(2);
          return res.status(400).json({ error: `备份空间不足：源磁盘需要 ${need} GB，可用 ${avail} GB` });
        }
      }
    }

    const jobId = createJob();
    const job = migrationJobs.get(jobId);
    job.sameDrive = sameDrive;
    res.json({ jobId, sameDrive });

    // 后台执行
    (async () => {
      try {
        // ── 阶段一：备份（可选）──
        if (backup) {
          job.phase = 'backup';
          const backupPath = `${realSrc}_bak_${Date.now()}`;
          await copyWithProgress(realSrc, backupPath, false, jobId);
          job.backupPath = backupPath;
          // 重置进度供迁移阶段使用
          job.copiedBytes = 0; job.progress = 0; job.totalBytes = 0; job.speed = 0;
        }

        // ── 阶段二：迁移 ──
        job.phase = 'migrate';

        if (isJunction(srcPath)) {
          await execAsync(`rmdir "${srcPath}"`, { timeout: 5000 });
        }

        if (sameDrive) {
          // 同盘：用 fs.rename（只改目录项，不移动数据，无需额外空间）
          if (fs.existsSync(destPath)) fs.rmdirSync(destPath); // rename 前清除空目标目录
          fs.renameSync(realSrc, destPath);
          job.progress = 100; job.totalBytes = 1; job.copiedBytes = 1;
        } else {
          // 跨盘：用 robocopy /MOVE
          if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
          await copyWithProgress(realSrc, destPath, true, jobId);
          if (fs.existsSync(srcPath) && !isJunction(srcPath)) {
            await execAsync(`rmdir /S /Q "${srcPath}"`, { timeout: 30000 });
          }
        }

        // 创建 junction，保持原路径透明可用
        await execAsync(`mklink /J "${srcPath}" "${destPath}"`, { timeout: 5000 });

        let msg = `已将 ${info.label} 迁移到 ${destPath}`;
        if (backup && job.backupPath) msg += `（备份位于 ${job.backupPath}）`;
        finishJob(jobId, true, msg);
        console.log('[migrate] 完成:', destPath, sameDrive ? '(同盘)' : '(跨盘)');
      } catch (error) {
        finishJob(jobId, false, `迁移失败: ${error.message}`);
        console.error('[migrate] 错误:', error);
      }
    })();
  } catch (error) {
    console.error('[migrate] 参数验证错误:', error);
    res.status(500).json({ error: `迁移失败: ${error.message}` });
  }
});

/** 还原迁移：将文件从迁移目标移回原路径，删除 junction */
router.post('/system/storage/restore', async (req, res) => {
  console.log('[restore] 收到请求:', req.body);
  try {
    const { type } = req.body;
    if (!type) return res.status(400).json({ error: '缺少参数' });
    const info = STORAGE_TYPES[type];
    if (!info) return res.status(400).json({ error: '无效的类型' });

    const junctionPath = path.join(MODELS_RUN_DIR, info.dir);

    if (!isJunction(junctionPath)) {
      return res.status(400).json({ error: '当前路径不是 junction，无需还原' });
    }

    const targetPath = getJunctionTarget(junctionPath);
    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'Junction 目标路径不存在' });
    }

    const sameDrive = isSameDrive(targetPath, junctionPath);

    if (!sameDrive) {
      // 跨盘还原：检查目标（原路径所在盘）剩余空间
      const dataSize = getDirSize(targetPath);
      const destFree = await getDriveFreeSpace(junctionPath);
      if (destFree !== null && destFree < dataSize) {
        const need = (dataSize / 1024 ** 3).toFixed(2);
        const avail = (destFree / 1024 ** 3).toFixed(2);
        return res.status(400).json({ error: `还原磁盘空间不足：需要 ${need} GB，可用 ${avail} GB` });
      }
    }

    const jobId = createJob();
    const job = migrationJobs.get(jobId);
    job.sameDrive = sameDrive;
    res.json({ jobId });

    (async () => {
      try {
        job.phase = 'migrate';
        await execAsync(`rmdir "${junctionPath}"`, { timeout: 5000 });

        if (sameDrive) {
          // 同盘：rename
          if (fs.existsSync(junctionPath)) fs.rmdirSync(junctionPath);
          fs.renameSync(targetPath, junctionPath);
          job.progress = 100; job.totalBytes = 1; job.copiedBytes = 1;
        } else {
          // 跨盘：robocopy /MOVE
          fs.mkdirSync(junctionPath, { recursive: true });
          await copyWithProgress(targetPath, junctionPath, true, jobId);
          if (fs.existsSync(targetPath)) {
            try { await execAsync(`rmdir /S /Q "${targetPath}"`, { timeout: 30000 }); }
            catch (e) { console.warn('[restore] 删除目标目录失败:', e.message); }
          }
        }

        finishJob(jobId, true, `已将 ${info.label} 还原到原路径`);
        console.log('[restore] 完成', sameDrive ? '(同盘)' : '(跨盘)');
      } catch (error) {
        finishJob(jobId, false, `还原失败: ${error.message}`);
        console.error('[restore] 错误:', error);
      }
    })();
  } catch (error) {
    console.error('[restore] 参数验证错误:', error);
    res.status(500).json({ error: `还原失败: ${error.message}` });
  }
});

/** 调用系统原生文件夹选择对话框 */
router.post('/system/storage/pick-folder', async (req, res) => {
  try {
    const { initialDir } = req.body;

    // 用户输入只嵌入 PS 脚本字符串内（非命令行），单引号在 PS 单引号串中需双写转义
    let initDirLine = '';
    if (initialDir && typeof initialDir === 'string') {
      const safePath = initialDir.replace(/'/g, "''");
      initDirLine = `$f.InitialDirectory = '${safePath}'`;
    }

    // 构建 PS 脚本：-STA 保证 WinForms 在 PS3+ 正常创建窗口
    // 使用隐藏的置顶父窗口，确保对话框显示在最前面而不是被浏览器遮挡
    // 同时让父窗口置于当前鼠标所在屏幕（支持多屏）
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$screen = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)',
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.StartPosition = "Manual"',
      '$owner.Left = [int]($screen.WorkingArea.Left + ($screen.WorkingArea.Width / 2))',
      '$owner.Top = [int]($screen.WorkingArea.Top + ($screen.WorkingArea.Height / 2))',
      '$owner.TopMost = $true; $owner.Width = 0; $owner.Height = 0',
      '$owner.ShowInTaskbar = $false; $owner.Opacity = 0',
      '$null = $owner.Handle',
      '$f = New-Object System.Windows.Forms.OpenFileDialog',
      "$f.Title = '选择目标文件夹'",
      '$f.CheckFileExists = $false; $f.CheckPathExists = $true; $f.ValidateNames = $false',
      "$f.FileName = '请选择文件夹'",
      initDirLine,
      'if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  $selected = Split-Path -Path $f.FileName -Parent',
      '  if (-not $selected) { $selected = $f.FileName }',
      '  Write-Output $selected',
      '}',
      '$owner.Dispose()',
    ].filter(Boolean).join('\n');

    // -EncodedCommand 接受 UTF-16LE Base64，彻底避免 shell 转义和中文乱码
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -STA -EncodedCommand ${encoded}`,
      { encoding: 'utf8', timeout: 120000 }
    );
    const selected = stdout.trim();
    res.json(selected ? { cancelled: false, path: selected } : { cancelled: true });
  } catch (error) {
    // execAsync 在非零退出时 throw，stdout 仍可能含有效路径
    const out = error.stdout?.trim();
    res.json(out ? { cancelled: false, path: out } : { cancelled: true });
  }
});

export default router;
