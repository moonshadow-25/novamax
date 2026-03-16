import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants.js';

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
 * 触发进程退出，守护进程检测到 pending 文件后执行更新
 * pending 文件由 engineDownloader 在下载完成后写入
 */
async function applyUpdate() {
  if (!fs.existsSync(PENDING_FILE)) {
    throw new Error('更新包未就绪，请先下载更新');
  }

  console.log('[updateService] 已检测到 pending 标记，即将退出进程...');

  // 延迟退出，让响应先发出
  setTimeout(() => process.exit(0), 500);
}

export default { applyUpdate, getState };
