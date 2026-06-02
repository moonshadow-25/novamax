import fs from 'fs';
import path from 'path';
import { TTS_LOGS_DIR, TTS_DEFAULTS } from '../../config/constants.js';

const { LOG_MAX_ENTRIES, LOG_RETENTION_DAYS } = TTS_DEFAULTS;

export function createLogBuffer() {
  const logs = [];
  let stream = null;
  let streamDate = null;

  function getDateStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function cleanOldLogs() {
    try {
      if (!fs.existsSync(TTS_LOGS_DIR)) return;
      const now = Date.now();
      for (const file of fs.readdirSync(TTS_LOGS_DIR)) {
        const match = /^tts-engine-(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
        if (!match) continue;
        const logDate = new Date(`${match[1]}T00:00:00`).getTime();
        if (Number.isNaN(logDate)) continue;
        if ((now - logDate) / 86400000 > LOG_RETENTION_DAYS) {
          fs.unlinkSync(path.join(TTS_LOGS_DIR, file));
        }
      }
    } catch {}
  }

  function ensureStream() {
    const today = getDateStr();
    if (today === streamDate) return;
    if (stream) stream.end();
    fs.mkdirSync(TTS_LOGS_DIR, { recursive: true });
    cleanOldLogs();
    stream = fs.createWriteStream(path.join(TTS_LOGS_DIR, `tts-engine-${today}.log`), { flags: 'a' });
    streamDate = today;
  }

  function push(level, message) {
    logs.push({ timestamp: Date.now(), level, message });
    if (logs.length > LOG_MAX_ENTRIES) logs.shift();

    try {
      ensureStream();
      if (stream) {
        stream.write(JSON.stringify({ t: Date.now(), l: level, m: message }) + '\n');
      }
    } catch (e) {
      process.stderr.write('[tts-log-error] ' + e.message + '\n');
    }
  }

  return {
    info(msg)    { push('info', msg); },
    warn(msg)    { push('warn', msg); },
    error(msg)   { push('error', msg); },
    push(level, message) { push(level, message); },
    get(limit = 500, level = 'all') {
      let result = logs;
      if (level !== 'all') result = result.filter(l => l.level === level);
      return result.slice(-limit);
    },
    clear() { logs.length = 0; },
  };
}
