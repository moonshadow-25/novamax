import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DATA_DIR, PROJECT_ROOT } from '../config/constants.js';

const UPDATES_DIR = path.join(DATA_DIR, 'updates');
const PENDING_FILE = path.join(UPDATES_DIR, 'pending');

/**
 * 应用更新并重启：
 * 直接 spawn 新 node 进程（detached + windowsHide），旧进程延迟退出
 */
async function applyUpdate() {
  if (!fs.existsSync(PENDING_FILE)) {
    throw new Error('更新包未就绪，请先下载更新');
  }

  console.log('[updateService] 已检测到 pending 标记，准备重启...');

  const srcDir = fs.existsSync(path.join(PROJECT_ROOT, 'backend', 'dist', 'index.js')) ? 'dist' : 'src';
  const entryScript = path.join(PROJECT_ROOT, 'backend', srcDir, 'index.js');
  const nodeExe = process.execPath;
  const cwd = path.join(PROJECT_ROOT, 'backend');

  const child = spawn(nodeExe, [entryScript], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  console.log('[updateService] 新进程已启动，即将退出当前进程...');
  setTimeout(() => process.exit(0), 500);
}

export default { applyUpdate, getState: () => ({ status: 'idle' }) };
