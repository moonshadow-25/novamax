import express from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import processManager from '../services/processManager.js';
import modelManager from '../services/modelManager.js';
import comfyuiInstanceManager from '../services/comfyuiInstanceManager.js';
import logCollector from '../services/logCollector.js';
import configManager from '../services/configManager.js';
import { PROJECT_ROOT, MODELS_RUN_DIR } from '../config/constants.js';

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
      const size = exists ? getDirSize(dirPath) : 0;

      items.push({
        type,
        label: info.label,
        path: dirPath,
        exists,
        size,
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
    const { type, targetPath } = req.body;
    if (!type || !targetPath) {
      return res.status(400).json({ error: '缺少参数' });
    }
    const info = STORAGE_TYPES[type];
    if (!info) return res.status(400).json({ error: '无效的类型' });

    const srcPath = path.join(MODELS_RUN_DIR, info.dir);
    const destPath = path.resolve(targetPath);

    if (path.resolve(srcPath) === destPath) {
      return res.status(400).json({ error: '目标路径不能与当前路径相同' });
    }

    const realSrc = isJunction(srcPath)
      ? getJunctionTarget(srcPath)
      : srcPath;

    if (fs.existsSync(destPath)) {
      const entries = fs.readdirSync(destPath);
      if (entries.length > 0) {
        return res.status(400).json({
          error: `目标路径 ${destPath} 已存在且非空，请清空后重试`
        });
      }
    } else {
      const parentDir = path.dirname(destPath);
      if (!fs.existsSync(parentDir)) {
        return res.status(400).json({
          error: `父目录 ${parentDir} 不存在，请先创建`
        });
      }
      fs.mkdirSync(destPath);
    }

    const robocopy = `robocopy "${realSrc}" "${destPath}" /E /MOVE /R:1 /W:1`;
    const mklink = `mklink /J "${srcPath}" "${destPath}"`;

    if (isJunction(srcPath)) {
      await execAsync(`rmdir "${srcPath}"`, { timeout: 5000 });
    }

    try {
      await execAsync(robocopy, { timeout: 600000 });
    } catch (e) {
      const exitCode = e.code || 0;
      if (exitCode >= 8) {
        throw new Error(`robocopy 失败 (code=${exitCode}): ${e.stderr || e.message}`);
      }
    }

    if (fs.existsSync(srcPath) && !isJunction(srcPath)) {
      try {
        await execAsync(`rmdir /S /Q "${srcPath}"`, { timeout: 30000 });
      } catch (e) {
        throw new Error(`删除原目录失败: ${e.message}`);
      }
    }

    try {
      await execAsync(mklink, { timeout: 5000 });
    } catch (e) {
      throw new Error(`创建目录联接失败: ${e.stderr || e.message}`);
    }

    res.json({
      success: true,
      message: `已将 ${info.label} 迁移到 ${destPath}`,
      junctionTarget: destPath
    });
  } catch (error) {
    console.error('[migrate] 错误:', error);
    res.status(500).json({ error: `迁移失败: ${error.message}` });
  }
});

/** 还原迁移：将文件从迁移目标移回原路径，删除 junction */
router.post('/system/storage/restore', async (req, res) => {
  console.log('[restore] 收到请求:', req.body);
  try {
    const { type } = req.body;
    if (!type) {
      return res.status(400).json({ error: '缺少参数' });
    }
    const info = STORAGE_TYPES[type];
    if (!info) return res.status(400).json({ error: '无效的类型' });

    const junctionPath = path.join(MODELS_RUN_DIR, info.dir);

    // 检查是否为 junction
    if (!isJunction(junctionPath)) {
      return res.status(400).json({ error: '当前路径不是 junction，无需还原' });
    }

    // 获取 junction 目标路径
    const targetPath = getJunctionTarget(junctionPath);
    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'Junction 目标路径不存在' });
    }

    // 1. 删除 junction
    await execAsync(`rmdir "${junctionPath}"`, { timeout: 5000 });

    // 2. 将文件从目标路径移回原路径
    fs.mkdirSync(junctionPath, { recursive: true });
    const robocopy = `robocopy "${targetPath}" "${junctionPath}" /E /MOVE /R:1 /W:1`;

    try {
      await execAsync(robocopy, { timeout: 600000 });
    } catch (e) {
      const exitCode = e.code || 0;
      if (exitCode >= 8) {
        throw new Error(`robocopy 失败 (code=${exitCode}): ${e.stderr || e.message}`);
      }
    }

    // 3. 删除原迁移目标目录
    if (fs.existsSync(targetPath)) {
      try {
        await execAsync(`rmdir /S /Q "${targetPath}"`, { timeout: 30000 });
      } catch (e) {
        console.warn('[restore] 删除目标目录失败:', e.message);
      }
    }

    res.json({
      success: true,
      message: `已将 ${info.label} 还原到原路径`
    });
  } catch (error) {
    console.error('[restore] 错误:', error);
    res.status(500).json({ error: `还原失败: ${error.message}` });
  }
});

/** 调用系统原生文件夹选择对话框 */
router.post('/system/storage/pick-folder', async (req, res) => {
  try {
    const cmd = [
      'powershell',
      '-NoProfile',
      '-NoLogo',
      '-Command',
      '"Add-Type -AssemblyName System.Windows.Forms;',
      '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
      '$f.Description = \'选择目标文件夹\';',
      '$f.ShowNewFolderButton = $true;',
      'if ($f.ShowDialog() -eq \'OK\') { $f.SelectedPath }"'
    ].join(' ');

    const { stdout } = await execAsync(cmd, { encoding: 'utf-8', timeout: 120000 });
    const selected = stdout.trim();
    res.json(selected ? { cancelled: false, path: selected } : { cancelled: true });
  } catch (error) {
    const out = error.stdout?.trim();
    res.json(out ? { cancelled: false, path: out } : { cancelled: true });
  }
});

export default router;
