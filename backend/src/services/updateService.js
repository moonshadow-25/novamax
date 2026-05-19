import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants.js';

const UPDATES_DIR = path.join(DATA_DIR, 'updates');
const PENDING_FILE = path.join(UPDATES_DIR, 'pending');

/**
 * 应用更新并重启：
 * 仅退出当前 Node，由外层启动器（NovaMax.bat/start_novamax.py）接管更新与重启
 */
async function applyUpdate() {
  if (!fs.existsSync(PENDING_FILE)) {
    throw new Error('更新包未就绪，请先下载更新');
  }

  console.log('[updateService] 已检测到 pending 标记，退出当前进程，交由启动器完成更新并拉起新进程...');
  setTimeout(() => process.exit(0), 300);
}

export default { applyUpdate, getState: () => ({ status: 'idle' }) };
