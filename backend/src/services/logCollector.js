import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants.js';

/**
 * 全局日志收集器
 * 拦截 console.log/warn/error，存入内存环形缓冲区，并持久化到 data/logs/
 * 日志文件命名: novamax-YYYY-MM-DD.log，当天同名文件覆盖，跨天新建
 */
class LogCollector {
  constructor(maxSize = 500) {
    this.logs = [];
    this.maxSize = maxSize;
    this._logStream = null;
    this._currentDate = null;
    this._initFileStream();
    this._intercept();
  }

  _getDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _cleanupOldLogs(logsDir) {
    const files = fs.readdirSync(logsDir);
    const now = new Date();

    for (const file of files) {
      const match = /^novamax-(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
      if (!match) continue;

      const logDate = new Date(`${match[1]}T00:00:00`);
      if (Number.isNaN(logDate.getTime())) continue;

      const ageDays = Math.floor((now - logDate) / (24 * 60 * 60 * 1000));
      if (ageDays > 7) {
        fs.unlinkSync(path.join(logsDir, file));
      }
    }
  }

  _initFileStream() {
    const logsDir = path.join(DATA_DIR, 'logs');
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      this._cleanupOldLogs(logsDir);
      const dateStr = this._getDateString();
      const logFile = path.join(logsDir, `novamax-${dateStr}.log`);
      if (this._logStream) {
        this._logStream.end();
      }
      // 当天追加（flags: 'a'），跨天新建同名新文件
      this._logStream = fs.createWriteStream(logFile, { flags: 'a' });
      this._currentDate = dateStr;
    } catch (e) {
      // 目录创建失败时不影响主流程
      this._logStream = null;
    }
  }

  _writeToFile(level, message) {
    const dateStr = this._getDateString();
    // 跨天时重新创建新文件
    if (dateStr !== this._currentDate) {
      this._initFileStream();
    }
    if (this._logStream) {
      const now = new Date();
      const time = now.toTimeString().slice(0, 8);
      this._logStream.write(`[${time}] [${level.toUpperCase()}] ${message}\n`);
    }
  }

  _intercept() {
    const orig = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };

    const capture = (level, origFn) => (...args) => {
      origFn(...args);
      const message = args.map(a =>
        typeof a === 'string' ? a : (a instanceof Error ? a.stack || a.message : JSON.stringify(a))
      ).join(' ');
      this.logs.push({ timestamp: Date.now(), level, message });
      if (this.logs.length > this.maxSize) {
        this.logs.shift();
      }
      this._writeToFile(level, message);
    };

    console.log = capture('info', orig.log);
    console.warn = capture('warn', orig.warn);
    console.error = capture('error', orig.error);
  }

  getLogs(limit = 200, level = 'all') {
    let result = this.logs;
    if (level && level !== 'all') {
      result = result.filter(l => l.level === level);
    }
    return result.slice(-limit);
  }

  clear() {
    this.logs = [];
  }
}

export default new LogCollector();
