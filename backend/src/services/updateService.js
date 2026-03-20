import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DATA_DIR, PROJECT_ROOT } from '../config/constants.js';

const UPDATES_DIR = path.join(DATA_DIR, 'updates');
const PENDING_FILE = path.join(UPDATES_DIR, 'pending');

let downloadState = {
  status: 'idle',
  progress: 0,
  error: null
};

function getState() {
  return { ...downloadState };
}

/**
 * 应用更新并重启：
 * 1. 生成临时重启脚本（等旧进程释放端口后启动新进程）
 * 2. 以 detached 方式运行脚本
 * 3. 退出当前进程
 */
async function applyUpdate() {
  if (!fs.existsSync(PENDING_FILE)) {
    throw new Error('更新包未就绪，请先下载更新');
  }

  console.log('[updateService] 已检测到 pending 标记，准备重启...');

  const entryScript = path.join(PROJECT_ROOT, 'backend', 'src', 'index.js').replace(/\\/g, '/');
  const nodeExe = process.execPath.replace(/\\/g, '/');
  const cwd = path.join(PROJECT_ROOT, 'backend').replace(/\\/g, '/');

  // 写一个临时 bat 脚本：等待 2 秒后启动新进程
  const restartScript = path.join(DATA_DIR, 'updates', '_restart.bat');
  fs.mkdirSync(path.dirname(restartScript), { recursive: true });
  fs.writeFileSync(restartScript, [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    `cd /d "${cwd}"`,
    `start "" "${nodeExe}" "${entryScript}"`,
    `del "%~f0"`,
    ''
  ].join('\r\n'), 'utf-8');

  // detached 运行重启脚本
  const child = spawn('cmd', ['/c', restartScript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();

  console.log('[updateService] 重启脚本已启动，即将退出当前进程...');

  // 延迟退出，让 HTTP 响应先发出
  setTimeout(() => process.exit(0), 500);
}

export default { applyUpdate, getState };
