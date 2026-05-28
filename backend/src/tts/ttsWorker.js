/**
 * TTS Worker — TTS 模块的总线线程。
 *
 * 由主线程在启动时 spawn。
 * 职责：
 *   1. 管理 DB 连接（voice、workspace、history 等 TTS 专属数据）
 *   2. 管理 Engine Workers（每个引擎一个独立线程）
 *   3. 服务层：合成、分段、工作区、音色
 *   4. 消息路由：接收主线程请求，分发到对应服务或 Engine Worker
 *
 * 消息协议:
 *   { id, type, payload }  →  { id, type:'result'|'error', payload }
 */
import { parentPort, Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT } from '../config/constants.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';

const TTS_DB_PATH = path.join(PROJECT_ROOT, 'data', 'tts_services', 'tts.db');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'history');
const genId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;

// 与 Voice ID 同算法的 model ID 生成（MD5 前 4 字节 → base25 → 6 位）
const ID_ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';
function hashToId(input) {
  const md5 = crypto.createHash('md5').update(input).digest();
  const num = md5.readUInt32BE(0);
  const base = ID_ALPHABET.length;
  let id = '';
  let n = num;
  for (let i = 0; i < 6; i++) {
    id = ID_ALPHABET[n % base] + id;
    n = Math.floor(n / base);
  }
  return id;
}

/* ========================================================================
 * DB 初始化（Worker 自有连接，不通过 configManager）
 * ======================================================================== */

const db = new Database(TTS_DB_PATH);
db.pragma('journal_mode = WAL');

// 建表（幂等）
db.exec(`
  CREATE TABLE IF NOT EXISTS tts_voices (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, voice_mode TEXT NOT NULL DEFAULT 'clone',
    reference_audio_path TEXT, instruction TEXT, emotion_preset TEXT DEFAULT '{}',
    engine_meta TEXT DEFAULT '{}', tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tts_workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, engine_type TEXT NOT NULL,
    voice_mode TEXT NOT NULL DEFAULT 'clone', voice_instruction TEXT, voice_id TEXT,
    reference_audio_id TEXT, active_voice_id TEXT, params TEXT NOT NULL DEFAULT '{}',
    folder_path TEXT NOT NULL, output_dir TEXT NOT NULL, cloned_from TEXT,
    model_id TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tts_reference_audios (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL, file_path TEXT NOT NULL,
    file_size INTEGER, duration REAL, sample_rate INTEGER DEFAULT 24000,
    format TEXT DEFAULT 'wav', transcript TEXT, transcript_lang TEXT,
    transcript_at TEXT, tags TEXT DEFAULT '[]', uploaded_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tts_synthesis_history (
    id TEXT PRIMARY KEY, workspace_id TEXT, voice_id TEXT, text TEXT,
    text_hash TEXT, output_file TEXT, output_format TEXT DEFAULT 'wav',
    duration_seconds REAL, rtf REAL, engine_type TEXT, params TEXT DEFAULT '{}',
    status TEXT DEFAULT 'completed', error_message TEXT, source_file TEXT,
    created_at TEXT NOT NULL
  );
`);

// 兼容存量表：添加缺失列
const alterStatements = [
  'ALTER TABLE tts_workspaces ADD COLUMN voice_id TEXT',
  'ALTER TABLE tts_workspaces ADD COLUMN active_voice_id TEXT',
  'ALTER TABLE tts_workspaces ADD COLUMN model_id TEXT',
  'ALTER TABLE tts_synthesis_history ADD COLUMN source_file TEXT',
  'ALTER TABLE tts_synthesis_history ADD COLUMN source_type TEXT DEFAULT \'manual\'',
];
for (const sql of alterStatements) {
  try { db.exec(sql); } catch {}
}

const VOICES_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'voices');
const WORKSPACES_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'workspaces');
const REF_AUDIO_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'reference_audio');
fs.mkdirSync(VOICES_DIR, { recursive: true });
fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
fs.mkdirSync(REF_AUDIO_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });

/* ========================================================================
 * TTS 日志缓冲区（Worker 自治）
 * ======================================================================== */

const LOG_MAX = 2000;
const ttsLogs = [];
const TTS_LOGS_DIR = path.join(PROJECT_ROOT, 'data', 'logs');
let _ttsLogStream = null;
let _ttsLogDate = null;

function getLogDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function cleanOldTtsLogs() {
  try {
    if (!fs.existsSync(TTS_LOGS_DIR)) return;
    const now = new Date();
    for (const file of fs.readdirSync(TTS_LOGS_DIR)) {
      const match = /^tts-engine-(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
      if (!match) continue;
      const logDate = new Date(`${match[1]}T00:00:00`);
      if (Number.isNaN(logDate.getTime())) continue;
      if ((now - logDate) / 86400000 > 7) {
        fs.unlinkSync(path.join(TTS_LOGS_DIR, file));
      }
    }
  } catch {}
}

function addLog(level, message) {
  ttsLogs.push({ timestamp: Date.now(), level, message });
  if (ttsLogs.length > LOG_MAX) ttsLogs.shift();

  // 写入磁盘日志文件，供 GET /api/system/logs/tts 读取
  try {
    const today = getLogDate();
    if (today !== _ttsLogDate) {
      if (_ttsLogStream) { try { _ttsLogStream.end(); } catch {} }
      fs.mkdirSync(TTS_LOGS_DIR, { recursive: true });
      cleanOldTtsLogs();
      _ttsLogStream = fs.createWriteStream(path.join(TTS_LOGS_DIR, `tts-engine-${today}.log`), { flags: 'a' });
      _ttsLogStream.on('error', () => { _ttsLogStream = null; _ttsLogDate = null; });
      _ttsLogDate = today;
    }
    if (_ttsLogStream) {
      const entry = JSON.stringify({ t: Date.now(), l: level, m: message });
      _ttsLogStream.write(entry + '\n');
    }
  } catch {}
}

function getTtsLogs(limit = 500, level = 'all') {
  let result = ttsLogs;
  if (level !== 'all') result = result.filter(l => l.level === level);
  return result.slice(-limit);
}

function clearTtsLogs() {
  ttsLogs.length = 0;
}

/* ========================================================================
 * Engine Worker 管理
 * ======================================================================== */

/** @type {Map<string, { worker: Worker, status: string, initPromise: Promise<void>|null, modelDir: string, pending: Map<string, Function> }>} */
const engines = new Map();

function getOrCreateEngine(engineType) {
  let entry = engines.get(engineType);
  if (entry && entry.worker) return entry;
  // 被 dispose 的 entry：重新创建 worker

  const installed = getInstalledEngine(engineType);
  if (!installed) throw { code: 'ENGINE_UNAVAILABLE', message: `引擎 "${engineType}" 未安装` };

  const worker = new Worker(
    path.join(__dirname, 'engineWorker.js'),
    {
      workerData: {
        engineType,
        adapterPath: installed.adapterPath,
        contract: installed.contract,
      }
    }
  );

  const prevModelDir = entry?.modelDir || '';
  entry = { worker, status: 'idle', initPromise: null, modelDir: prevModelDir, pending: new Map(), taskQueue: [], busy: false, activeTasks: 0, lastActiveTime: Date.now() };
  engines.set(engineType, entry);

  worker.on('message', (msg) => {
    if (msg.type === 'report') {
      const r = msg.payload;
      if (!entry.report) entry.report = {};
      if (r.health != null) entry.report.health = r.health;
      if (r.pid != null) entry.report.pid = r.pid;
      if (r.memory != null) entry.report.memory = r.memory;
      if (r.runtimeConfig != null) entry.report.runtimeConfig = r.runtimeConfig;
      if (r.port != null) entry.report.port = r.port;
      if (r.event === 'ready') { entry.status = 'running'; addLog('info', `Engine ${engineType} ready, PID=${r.pid}`); }
      if (r.event === 'disposed') { entry.status = 'stopped'; }
      return;
    }
    if (msg.type === 'log') {
      addLog(msg.payload.level, msg.payload.message);
      return;
    }
    const cb = entry.pending.get(msg.id);
    if (cb) { entry.pending.delete(msg.id); cb(msg); }
  });

  worker.on('error', (err) => {
    entry.status = 'error';
    // 拒绝所有等待中的请求
    for (const [id, cb] of entry.pending) {
      cb({ id, type: 'error', payload: { code: 'ENGINE_UNAVAILABLE', message: err.message } });
    }
    entry.pending.clear();
  });

  worker.on('exit', () => {
    engines.delete(engineType);
  });

  return entry;
}

function sendToEngine(engineType, type, payload) {
  const entry = getOrCreateEngine(engineType);
  const id = genId('eng');
  return new Promise((resolve, reject) => {
    entry.pending.set(id, (msg) => {
      if (msg.type === 'result') resolve(msg.payload);
      else reject(msg.payload);
    });
    entry.worker.postMessage({ id, type, payload });
  });
}

/**
 * 引擎任务队列。序列化所有对同一引擎的请求。
 * 若引擎空闲则立即执行，否则排队等待。
 */
function enqueueEngineTask(engineType, taskFn) {
  const entry = getOrCreateEngine(engineType);
  return new Promise((resolve, reject) => {
    const run = async () => {
      try {
        entry.busy = true;
        entry.activeTasks++;
        const result = await taskFn();
        resolve(result);
      } catch (e) {
        reject(e);
      } finally {
        entry.busy = false;
        entry.activeTasks = Math.max(0, entry.activeTasks - 1);
        // 出队下一个任务
        const next = entry.taskQueue.shift();
        if (next) next();
      }
    };

    if (!entry.busy) {
      run();
    } else {
      entry.taskQueue.push(run);
      addLog('info', `Engine ${engineType} busy, queued (position: ${entry.taskQueue.length})`);
    }
  });
}

/**
 * 确保引擎已初始化。若正在初始化中则等待，否则启动初始化。
 */
async function ensureInitialized(engineType, modelDir) {
  const entry = getOrCreateEngine(engineType);
  entry.lastActiveTime = Date.now();
  if (entry.status === 'running') return;

  if (entry.initPromise) {
    addLog('info', `Engine ${engineType} initializing, waiting...`);
    await entry.initPromise;
    return;
  }

  entry.modelDir = modelDir || entry.modelDir;
  addLog('info', `Auto-initializing engine ${engineType}, modelDir=${entry.modelDir}`);

  entry.initPromise = sendToEngine(engineType, 'initialize', {
    modelDir: entry.modelDir,
    deviceId: -1,
    custom: {}
  }).then(() => {
    entry.status = 'running';
    entry.initPromise = null;
    addLog('info', `Engine ${engineType} initialized`);
  }).catch((e) => {
    entry.initPromise = null;
    entry.status = 'error';
    addLog('error', `Engine ${engineType} init failed: ${e.message}`);
    throw e;
  });

  await entry.initPromise;
}

/**
 * 获取引擎运行状态。不向 engineWorker 发消息——直接读取引擎上报的快照。
 *
 * 状态优先级：error > busy > running > starting > idle
 */
function getEngineStatus() {
  let hasStarting = false, hasError = false, anyBusy = false, anyRunning = false;
  const perEngine = {};

  for (const [engineType, entry] of engines) {
    if (entry.status === 'idle' && entry.initPromise) {
      hasStarting = true;
      perEngine[engineType] = { status: 'starting' };
      continue;
    }
    if (entry.status === 'error') {
      hasError = true;
      perEngine[engineType] = { status: 'error' };
      continue;
    }
    if (entry.status !== 'running') continue;

    if (entry.activeTasks > 0) {
      anyBusy = true;
      anyRunning = true;
      perEngine[engineType] = { status: 'busy' };
      continue;
    }

    // entry.status 是运行状态的权威来源。
    // report.health 仅用于检测降级（healthy → unhealthy），
    // report 尚未到达时信任 entry.status。
    const h = entry.report?.health;
    if (h?.status === 'unhealthy') {
      hasError = true;
      perEngine[engineType] = { status: 'error' };
    } else {
      anyRunning = true;
      perEngine[engineType] = { status: 'running' };
    }
  }

  const status = hasError ? 'error'
    : anyBusy ? 'busy'
    : anyRunning ? 'running'
    : hasStarting ? 'starting'
    : 'idle';

  return { running: anyRunning || anyBusy || hasStarting, status, engines: perEngine };
}

function getInstalledEngine(engineType) {
  const ttsDir = path.join(PROJECT_ROOT, 'external', 'tts');
  if (!fs.existsSync(ttsDir)) return null;

  const dirs = fs.readdirSync(ttsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  const matches = [];
  for (const d of dirs) {
    // 跳过临时目录
    if (d.name.startsWith('_temp_')) continue;
    const dir = path.join(ttsDir, d.name);
    const contractPath = path.join(dir, 'contract.json');
    const adapterPath = path.join(dir, 'adapter.js');
    const installed = path.join(dir, '.installed');
    if (!fs.existsSync(contractPath) || !fs.existsSync(adapterPath) || !fs.existsSync(installed)) continue;

    let contract;
    try { contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8')); } catch { continue; }
    if (normalizeEngineType(contract?.engine?.type) !== normalizeEngineType(engineType)) continue;

    // 读取 .installed 获取版本号
    let installedVersion = '0.0.0';
    try {
      const m = JSON.parse(fs.readFileSync(installed, 'utf-8'));
      installedVersion = m.version || contract.engine?.version || '0.0.0';
    } catch {}

    // 新格式：目录名 = variant.id（如 indextts2）→ priority 1
    // 旧格式：目录名 = version（如 202605131733-index-tts2）→ priority 0
    const priority = normalizeEngineType(d.name) === normalizeEngineType(engineType) ? 1 : 0;
    matches.push({ contract, adapterPath, dir, version: installedVersion, priority });
  }

  // 按 priority 降序，同 priority 按 version 降序
  matches.sort((a, b) => b.priority - a.priority || b.version.localeCompare(a.version, undefined, { numeric: true }));
  return matches[0] || null;
}

/* ========================================================================
 * Voice 管理（Worker 内自实现，不依赖主线程模块）
 * ======================================================================== */

function getVoice(id) {
  const row = db.prepare('SELECT * FROM tts_voices WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, emotion_preset: JSON.parse(row.emotion_preset || '{}'), engine_meta: JSON.parse(row.engine_meta || '{}'), tags: JSON.parse(row.tags || '[]') };
}

function resolveVoice(voiceId) {
  const voice = getVoice(voiceId);
  if (!voice) throw { code: 'INVALID_VOICE', message: `Voice ${voiceId} 不存在` };
  return {
    mode: voice.voice_mode,
    reference_audio: voice.reference_audio_path || undefined,
    instruction: voice.instruction || undefined,
    emotion_preset: voice.emotion_preset || undefined,
    engine_meta: voice.engine_meta || undefined
  };
}

function listVoices(page = 1, pageSize = 100, search) {
  let where = '1=1'; const params = [];
  if (search) { where += ' AND name LIKE ?'; params.push(`%${search}%`); }
  const total = db.prepare(`SELECT COUNT(*) as c FROM tts_voices WHERE ${where}`).get(...params)?.c || 0;
  const items = db.prepare(`SELECT * FROM tts_voices WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map(r => ({ ...r, emotion_preset: JSON.parse(r.emotion_preset || '{}'), engine_meta: JSON.parse(r.engine_meta || '{}'), tags: JSON.parse(r.tags || '[]') }));
  return { items, total, page, page_size: pageSize };
}

/* ========================================================================
 * 工作区管理
 * ======================================================================== */

function getWorkspace(id) {
  const r = db.prepare('SELECT * FROM tts_workspaces WHERE id = ?').get(id);
  return r ? { ...r, params: JSON.parse(r.params || '{}') } : null;
}

function getWorkspaceFiles(workspaceId) {
  const ws = getWorkspace(workspaceId);
  if (!ws) return [];
  const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
  return fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];
}

function getWorkspaces() {
  return db.prepare('SELECT * FROM tts_workspaces ORDER BY created_at DESC').all()
    .map(r => ({ ...r, params: JSON.parse(r.params || '{}') }));
}

/* ========================================================================
 * 历史
 * ======================================================================== */

function getHistory(page = 1, pageSize = 20, workspaceId) {
  let where = '1=1'; const params = [];
  if (workspaceId) { where += ' AND workspace_id = ?'; params.push(workspaceId); }
  const total = db.prepare(`SELECT COUNT(*) as c FROM tts_synthesis_history WHERE ${where}`).get(...params)?.c || 0;
  const items = db.prepare(`SELECT * FROM tts_synthesis_history WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map(r => ({ ...r, params: JSON.parse(r.params || '{}') }));
  return { items, total, page, page_size: pageSize };
}

function deleteHistoryItem(id) {
  const item = db.prepare('SELECT * FROM tts_synthesis_history WHERE id = ?').get(id);
  if (item?.output_file && fs.existsSync(item.output_file)) fs.unlinkSync(item.output_file);
  db.prepare('DELETE FROM tts_synthesis_history WHERE id = ?').run(id);
}

/* ========================================================================
 * 合成编排（使用主线程同款 segment + ffmpeg 逻辑）
 * ======================================================================== */

async function synthesize(opts) {
  const { text, voiceId, engineType, outputFormat = 'wav', outputDir = '', params = {}, workspaceId, sourceFile, sourceType, modelDir = '' } = opts;
  const engineEntry = getOrCreateEngine(engineType);
  engineEntry.lastActiveTime = Date.now();
  addLog('info', `Synthesis start: ${text.length} chars, voice=${voiceId}, engine=${engineType}, workspace=${workspaceId || '-'}${sourceFile ? ', file=' + sourceFile : ''}`);

  const voiceRef = resolveVoice(voiceId);

  // 等待引擎就绪（初始化中则等待，未初始化则启动）
  await ensureInitialized(engineType, modelDir);

  // 从引擎获取运行时配置（如 max_text_length），优先级：引擎配置 > 契约上限 > 4000
  let maxLen = 4000;
  try {
    const rc = await sendToEngine(engineType, 'getRuntimeConfig', {});
    if (rc?.max_text_length) {
      maxLen = rc.max_text_length;
    } else {
      const installed = getInstalledEngine(engineType);
      maxLen = installed?.contract?.capabilities?.max_text_length || 4000;
    }
  } catch {
    const installed = getInstalledEngine(engineType);
    maxLen = installed?.contract?.capabilities?.max_text_length || 4000;
  }
  const segs = await segmentText(text, maxLen);

  if (segs.length > 1) addLog('info', `Text segmented: ${segs.length} parts (max=${maxLen}/segment)`);

  const results = await enqueueEngineTask(engineType, async () => {
    const results = [];
    for (let i = 0; i < segs.length; i++) {
      const result = await sendToEngine(engineType, 'synthesize', {
        text: segs[i],
        voice: voiceRef,
        output_format: outputFormat,
        output_dir: outputDir || HISTORY_DIR,
        workspace_id: workspaceId || '',
        request_id: genId('req'),
        params: { ...params, index: i }
      });
      results.push(result);
      // 段间清理显存（由引擎自行决定清理策略）
      try { await sendToEngine(engineType, 'clearCache', {}); } catch {}
    }
    return results;
  });

  if (results.length > 1) addLog('info', `${results.length} segments done, concatenating...`);

  let audio = results.length === 1
    ? results[0].audio
    : await ffmpegConcat(results, outputFormat, outputDir || HISTORY_DIR);

  // ffmpeg 转码：引擎输出 WAV，按需转换为目标格式
  let actualFormat = outputFormat;
  let ffmpegMissing = false;
  if (outputFormat !== 'wav') {
    const tmpWavPath = path.join(outputDir || HISTORY_DIR, `${genId('tmpwav')}.wav`);
    fs.writeFileSync(tmpWavPath, audio);
    try {
      audio = await ffmpegConvert(tmpWavPath, outputFormat);
      try { fs.unlinkSync(tmpWavPath); } catch {}
    } catch (e) {
      addLog('warn', `ffmpeg convert to ${outputFormat} failed: ${e.message}, falling back to wav`);
      actualFormat = 'wav';
      ffmpegMissing = e.message.includes('ffmpeg');
    }
  }

  // ffmpeg 合片降级检测
  if (results.length > 1 && !getFfmpegExe()) {
    ffmpegMissing = true;
  }

  const totalDuration = results.reduce((s, r) => s + (r?.duration_seconds || 0), 0);
  const avgRtf = results.length > 0 ? results.reduce((s, r) => s + (r?.rtf || 0), 0) / results.length : 0;

  addLog('info', `Synthesis complete: ${totalDuration.toFixed(1)}s, RTF=${avgRtf.toFixed(2)}, segments=${segs.length}, format=${actualFormat}`);

  const resolvedDir = outputDir || HISTORY_DIR;
  fs.mkdirSync(resolvedDir, { recursive: true });
  const outFile = path.join(resolvedDir, buildOutputFilename(voiceId, text, actualFormat));
  fs.writeFileSync(outFile, audio);

  // 清理 adapter 生成的临时分段文件
  for (const r of results) {
    if (r.output_path && r.output_path !== outFile) {
      try { fs.unlinkSync(r.output_path); } catch {}
    }
  }

  const historyId = genId('hist');
  db.prepare(`INSERT INTO tts_synthesis_history
    (id, workspace_id, voice_id, text, text_hash, output_file, output_format, duration_seconds, rtf, engine_type, params, source_file, source_type, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'completed',?)`)
    .run(historyId, workspaceId || null, voiceId, text,
      crypto.createHash('md5').update(text).digest('hex').slice(0, 16),
      outFile, actualFormat, totalDuration, avgRtf, engineType, JSON.stringify(params),
      sourceFile || null, sourceType || 'manual', new Date().toISOString());

  return { historyId, audio, duration: totalDuration, output_file: outFile, segment_count: segs.length, ffmpeg_missing: ffmpegMissing };
}

/* ========================================================================
 * 文本分割（LLM + 算法，与主线程版本逻辑一致）
 * ======================================================================== */

async function segmentText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const targets = calculateTargets(text.length, maxLen);
  if (targets.length === 0) return [text];

  const segments = [];
  let startPos = 0;
  for (const target of targets) {
    const pos = findSplitAlgorithmic(text, target, maxLen);
    const cutPos = Math.max(startPos + 1, Math.min(text.length - 1, pos));
    segments.push(text.slice(startPos, cutPos).trim());
    startPos = cutPos;
  }
  segments.push(text.slice(startPos).trim());
  return segments.filter(s => s.length > 0);
}

function calculateTargets(totalLen, maxLen) {
  const targets = [];
  let remaining = totalLen, offset = 0;
  while (remaining > maxLen) {
    if (remaining <= maxLen * 2) { targets.push(offset + Math.floor(remaining / 2)); break; }
    offset += maxLen; targets.push(offset); remaining -= maxLen;
  }
  return targets;
}

function findSplitAlgorithmic(text, target, maxLen) {
  const halfWindow = Math.floor(maxLen * 0.1);
  const start = Math.max(0, target - halfWindow);
  const end = Math.min(text.length, target + halfWindow);
  const window = text.slice(start, end);
  let best = -1;

  const sentenceEnd = /[。！？.!?][\s\n]*/g;
  let match;
  while ((match = sentenceEnd.exec(window)) !== null) {
    const pos = start + match.index + match[0].length;
    if (pos > start && pos < end) best = pos;
  }
  if (best > 0) return best;

  const paraBreak = /\n\s*\n/;
  const pm = paraBreak.exec(window);
  if (pm) return start + pm.index + 1;

  const secondary = /[，、；,:;]\s*/g;
  while ((match = secondary.exec(window)) !== null) {
    const pos = start + match.index + match[0].length;
    if (pos > start && pos < end) best = pos;
  }
  if (best > 0) return best;

  return target;
}

/* ========================================================================
 * ffmpeg 合片
 * ======================================================================== */

import { spawn } from 'child_process';

/** 输出文件名：VoiceID_文本前10字符_随机6位.格式 */
function buildOutputFilename(voiceId, text, format) {
  const clean = (text || '').replace(/[\s\n\r]+/g, '').slice(0, 10);
  const rand = crypto.randomBytes(4).readUInt32BE(0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  return `${voiceId}_${clean}_${rand}.${format}`;
}

const FFMPEG_DIR = path.join(PROJECT_ROOT, 'external', 'ffmpeg');

function getFfmpegExe() {
  if (!fs.existsSync(FFMPEG_DIR)) return null;
  const dirs = fs.readdirSync(FFMPEG_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const d of dirs) {
    const exe = path.join(FFMPEG_DIR, d.name, 'ffmpeg.exe');
    if (fs.existsSync(path.join(FFMPEG_DIR, d.name, '.installed')) && fs.existsSync(exe)) return exe;
  }
  return null;
}

async function ffmpegConcat(results, format, outputDir) {
  const ffExe = getFfmpegExe();
  if (!ffExe) return rawConcat(results, format);

  const inputFiles = [], tempFiles = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.output_path && fs.existsSync(r.output_path)) {
      inputFiles.push(r.output_path);
    } else {
      const tmpPath = path.join(outputDir, `_seg_${i}_${genId('tmp')}.${format}`);
      fs.writeFileSync(tmpPath, r.audio);
      inputFiles.push(tmpPath);
      tempFiles.push(tmpPath);
    }
  }

  const listPath = path.join(outputDir, `${genId('list')}.txt`);
  fs.writeFileSync(listPath, inputFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const outFile = path.join(outputDir, `${genId('concat')}.${format}`);

  await new Promise((resolve) => {
    const proc = spawn(ffExe, ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outFile, '-y'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    proc.on('close', () => {
      try { fs.unlinkSync(listPath); } catch {}
      for (const f of tempFiles) try { fs.unlinkSync(f); } catch {}
      resolve();
    });
    proc.on('error', () => {
      try { fs.unlinkSync(listPath); } catch {}
      for (const f of tempFiles) try { fs.unlinkSync(f); } catch {}
      resolve();
    });
  });

  const audio = fs.readFileSync(outFile);
  return audio;
}

/**
 * ffmpeg 转码。将音频文件转换为目标格式。
 * @returns {Promise<Buffer>}
 */
function ffmpegConvert(inputPath, targetFormat) {
  const ffExe = getFfmpegExe();
  if (!ffExe) throw new Error('ffmpeg 未安装。请在引擎管理中下载 ffmpeg。');
  const outPath = inputPath.replace(/\.[^.]+$/, `.${targetFormat}`);
  const codecArgs = {
    mp3:  ['-codec:a', 'libmp3lame', '-b:a', '192k'],
    flac: ['-c:a', 'flac'],
    opus: ['-c:a', 'libopus', '-b:a', '96k'],
  };
  const args = ['-i', inputPath, ...(codecArgs[targetFormat] || []), outPath, '-y'];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffExe, args, { timeout: 120000 });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg convert failed: ${stderr.slice(-200)}`));
      if (!fs.existsSync(outPath)) return reject(new Error('ffmpeg output not found'));
      try { resolve(fs.readFileSync(outPath)); } catch (e) { reject(e); }
    });
    proc.on('error', (e) => reject(new Error(`ffmpeg convert error: ${e.message}`)));
  });
}

function rawConcat(results, format) {
  if (results.length === 1) return results[0].audio;
  if (format === 'wav' && results.every(r => r.audio?.length > 44)) {
    const header = results[0].audio.slice(0, 44);
    const data = Buffer.concat(results.map(r => r.audio.slice(44)));
    const out = Buffer.concat([header, data]);
    out.writeUInt32LE(36 + data.length, 4);
    out.writeUInt32LE(data.length, 40);
    return out;
  }
  return Buffer.concat(results.map(r => r.audio));
}

/* ========================================================================
 * 消息路由（主线程 → Worker）
 * ======================================================================== */

parentPort.on('message', async (msg) => {
  const { id, type, payload } = msg;
  try {
    const result = await dispatch(type, payload);
    parentPort.postMessage({ id, type: 'result', payload: result !== undefined ? result : {} });
  } catch (e) {
    parentPort.postMessage({
      id, type: 'error',
      payload: { code: e.code || 'INTERNAL_ERROR', message: e.message, retryable: e.retryable !== false }
    });
  }
});

async function dispatch(type, payload) {
  switch (type) {
    // ---- 合成 ----
    case 'synthesize':
      return synthesize(payload);

    // ---- 引擎生命周期 ----
    case 'startEngine': {
      const entry = getOrCreateEngine(payload.engine_type);
      entry.modelDir = payload.model_dir || '';
      await ensureInitialized(payload.engine_type, entry.modelDir);
      return { engine_type: payload.engine_type, status: 'running', model_dir: entry.modelDir };
    }

    case 'stopEngine': {
      const e = engines.get(payload.engine_type);
      if (e?.worker) {
        try { await sendToEngine(payload.engine_type, 'dispose', {}); } catch {}
        try { await e.worker.terminate(); } catch {}
      }
      engines.delete(payload.engine_type);
      addLog('info', `Engine ${payload.engine_type} stopped`);
      return { status: 'stopped' };
    }

    case 'engineStatus':
      return engines.has(payload.engine_type)
        ? { engine_type: payload.engine_type, status: engines.get(payload.engine_type).status }
        : { engine_type: payload.engine_type, status: 'stopped' };

    case 'isEngineRunning':
      return getEngineStatus();

    // ---- 工作区 ----
    case 'getWorkspace':
      return getWorkspace(payload.id);

    case 'getWorkspaces':
      return getWorkspaces();

    case 'getWorkspaceFiles':
      return getWorkspaceFiles(payload.id);

    case 'createWorkspace': {
      const ws = payload;
      const modelId = ws.model_id || hashToId(ws.id);
      db.prepare(`INSERT INTO tts_workspaces
        (id,name,engine_type,voice_mode,voice_instruction,voice_id,active_voice_id,reference_audio_id,params,folder_path,output_dir,model_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(ws.id, ws.name, ws.engine_type, ws.voice_mode || 'clone', ws.voice_instruction || null,
          ws.voice_id || null, ws.active_voice_id || null, ws.reference_audio_id || null,
          JSON.stringify(ws.params || {}), ws.folder_path, ws.output_dir, modelId, new Date().toISOString());
      return getWorkspace(ws.id);
    }

    case 'deleteWorkspace':
      db.prepare('DELETE FROM tts_workspaces WHERE id = ?').run(payload.id);
      return { success: true };

    case 'updateOutputDir':
      db.prepare('UPDATE tts_workspaces SET output_dir = ? WHERE id = ?').run(payload.output_dir, payload.id);
      return { success: true };

    case 'updateWorkspaceParams':
      db.prepare('UPDATE tts_workspaces SET params = ? WHERE id = ?').run(JSON.stringify(payload.params || {}), payload.id);
      // 同步更新 workspace 文件夹中的 config.json
      try {
        const ws = db.prepare('SELECT folder_path FROM tts_workspaces WHERE id = ?').get(payload.id);
        if (ws?.folder_path) {
          const configPath = path.join(ws.folder_path, 'config.json');
          if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            cfg.params = payload.params || {};
            fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
          }
        }
      } catch {}
      return { success: true };

    // ---- Voice ----
    case 'listVoices':
      return listVoices(payload?.page || 1, payload?.page_size || 100, payload?.search);

    case 'createVoice': {
      const { id: extId, name, voice_mode, reference_audio_path, instruction, emotion_preset, engine_meta, tags } = payload;
      // 外部传入 ID（如 MD5 生成）则直接使用，否则自增
      let id;
      if (extId) {
        id = extId;
      } else {
        const last = db.prepare("SELECT id FROM tts_voices WHERE id LIKE 'voice_%' ORDER BY id DESC LIMIT 1").get();
        const nextNum = last?.id ? parseInt(last.id.replace('voice_', ''), 10) + 1 : 1;
        id = `voice_${String(nextNum).padStart(3, '0')}`;
      }
      // 已存在则更新路径（目录可能已重组）
      const existing = db.prepare('SELECT id FROM tts_voices WHERE id = ?').get(id);
      if (existing) {
        db.prepare('UPDATE tts_voices SET reference_audio_path=?, name=?, updated_at=? WHERE id=?')
          .run(reference_audio_path || null, name, new Date().toISOString(), id);
        return getVoice(id);
      }
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO tts_voices (id,name,voice_mode,reference_audio_path,instruction,emotion_preset,engine_meta,tags,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id, name, voice_mode, reference_audio_path || null, instruction || null,
          JSON.stringify(emotion_preset || {}), JSON.stringify(engine_meta || {}), JSON.stringify(tags || []), now, now);
      return getVoice(id);
    }

    case 'activateVoice': {
      const { workspace_id, voice_id } = payload;
      db.prepare('UPDATE tts_workspaces SET active_voice_id = ? WHERE id = ?').run(voice_id, workspace_id);
      const voice = getVoice(voice_id);
      return { workspace_id, active_voice_id: voice_id, voice };
    }

    case 'cleanupVoice': {
      const vid = payload.voice_id;
      db.prepare('DELETE FROM tts_voices WHERE id = ?').run(vid);
      db.prepare('UPDATE tts_workspaces SET active_voice_id = NULL WHERE active_voice_id = ?').run(vid);
      return { success: true };
    }

    case 'resolveVoice':
      return resolveVoice(payload.voice_id);

    // ---- 日志（Worker 自治） ----
    case 'getTtsLogs': {
      const logs = getTtsLogs(payload?.limit || 500, payload?.level || 'all');
      return { logs, _count: ttsLogs.length, _time: Date.now() };
    }

    case 'clearTtsLogs':
      clearTtsLogs();
      return { success: true };
    case 'getHistory':
      return getHistory(payload?.page || 1, payload?.page_size || 20, payload?.workspace_id);

    case 'deleteHistoryItem':
      deleteHistoryItem(payload.id);
      return { success: true };

    // ---- 引擎合约 ----
    case 'listEngineContracts': {
      const ttsDir = path.join(PROJECT_ROOT, 'external', 'tts');
      if (!fs.existsSync(ttsDir)) return [];
      const contracts = [];
      // 从 engines.json 读取在线引擎的 name
      const onlineNames = new Map();
      try {
        const engCfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'engines.json'), 'utf-8'));
        if (engCfg?.engines?.tts?.variants) {
          for (const v of engCfg.engines.tts.variants) {
            onlineNames.set(normalizeEngineType(v.id), v.name);
          }
        }
      } catch {}
      for (const d of fs.readdirSync(ttsDir, { withFileTypes: true }).filter(x => x.isDirectory())) {
        if (d.name.startsWith('_temp_')) continue;
        const cp = path.join(ttsDir, d.name, 'contract.json');
        const installed = path.join(ttsDir, d.name, '.installed');
        if (fs.existsSync(cp) && fs.existsSync(installed)) {
          try {
            const c = JSON.parse(fs.readFileSync(cp, 'utf-8'));
            const eType = c.engine?.type || d.name;
            const eName = c.engine?.name || onlineNames.get(normalizeEngineType(eType)) || eType;
            const installedVersion = JSON.parse(fs.readFileSync(installed, 'utf-8')).version || c.engine?.version || '0.0.0';
            // 新格式：目录名为 variant.id；旧格式：目录名为 version 字符串 → 标记 legacy
            const isLegacy = normalizeEngineType(d.name) !== normalizeEngineType(eType);
            contracts.push({ engine_type: eType, engine_name: eName, version: d.name, contract: c, engine_version: installedVersion, legacy: isLegacy });
          } catch {}
        }
      }
      // 每个 engine_type 只保留一个：新格式优先，版本高的优先
      const latest = new Map();
      for (const c of contracts) {
        const key = normalizeEngineType(c.engine_type);
        const existing = latest.get(key);
        if (!existing) { latest.set(key, c); continue; }
        // 新格式替换旧格式
        if (!c.legacy && existing.legacy) { latest.set(key, c); continue; }
        if (c.legacy && !existing.legacy) continue;
        // 同格式比版本
        if (c.engine_version.localeCompare(existing.engine_version, undefined, { numeric: true }) > 0) {
          latest.set(key, c);
        }
      }
      return [...latest.values()];
    }

    // ---- 引擎运行时配置 ----
    case 'getEngineRuntimeConfig': {
      // 优先读上报快照，无快照时才查询
      let cfg = engines.get(payload.engine_type)?.report?.runtimeConfig;
      if (!cfg) {
        try { cfg = await sendToEngine(payload.engine_type, 'getRuntimeConfig', {}); } catch { cfg = {}; }
      }
      const installed = getInstalledEngine(payload.engine_type);
      // 合并 contract 默认值与引擎当前值
      const rc = installed?.contract?.runtime_config || {};
      const merged = {};
      for (const [k, v] of Object.entries(rc)) {
        merged[k] = cfg?.[k] ?? v.default;
      }
      return merged;
    }

    case 'setEngineRuntimeConfig':
      return sendToEngine(payload.engine_type, 'setRuntimeConfig', { key: payload.key, value: payload.value });

    // ---- 引擎主动报告 ----
    case 'storeEngineReport': {
      const e = engines.get(payload.engine_type);
      if (!e) { addLog('warn', `storeEngineReport: engine ${payload.engine_type} not in map`); return { success: true }; }
      if (!e.report) e.report = {};
      addLog('info', `storeEngineReport: event=${payload.event} pid=${payload.pid} health=${payload.health?.status} memory=${payload.memory?.vram_used_mb}`);
      if (payload.health != null) e.report.health = payload.health;
      if (payload.pid != null) e.report.pid = payload.pid;
      if (payload.memory != null) e.report.memory = payload.memory;
      if (payload.error) {
        e.report.lastError = payload.error;
        e.report.health = { status: 'degraded', model_loaded: true, last_error: payload.error.message };
      }
      if (payload.event === 'ready' && e.status === 'starting') e.status = 'running';
      return { success: true };
    }

    case 'getEnginePid': {
      const e = engines.get(payload.engine_type);
      return e?.report?.pid ?? null;
    }

    case 'getEnginePort': {
      const e = engines.get(payload.engine_type);
      return e?.report?.port ?? null;
    }

    case 'getEngineMemoryInfo': {
      const e = engines.get(payload.engine_type);
      return e?.report?.memory || { vram_used_mb: -1, vram_total_mb: -1, shared_used_mb: -1, shared_total_mb: -1 };
    }

    default:
      throw { code: 'UNKNOWN_TYPE', message: `Unknown TTS worker message: ${type}` };
  }
}

/* ========================================================================
 * 引擎闲置自动关闭
 * 每 30 秒检查一次，闲置超过 idle_timeout_minutes 的引擎自动 dispose
 * ======================================================================== */

const TTS_CONFIG_PATH_IDLE = path.join(PROJECT_ROOT, 'data', 'tts_services', 'config.json');

function getIdleTimeoutMs() {
  try {
    if (fs.existsSync(TTS_CONFIG_PATH_IDLE)) {
      const cfg = JSON.parse(fs.readFileSync(TTS_CONFIG_PATH_IDLE, 'utf-8'));
      return (Math.max(3, Math.min(30, Number(cfg.idle_timeout_minutes) || 5)) || 5) * 60 * 1000;
    }
  } catch {}
  return 5 * 60 * 1000; // 默认 5 分钟
}

setInterval(() => {
  const timeoutMs = getIdleTimeoutMs();
  const now = Date.now();
  for (const [engineType, entry] of engines) {
    if (entry.status !== 'running') continue;
    if (entry.activeTasks > 0 || entry.busy) continue;
    if (now - entry.lastActiveTime < timeoutMs) continue;

    addLog('info', `Engine ${engineType} idle timeout (${timeoutMs / 60000}min), auto-disposing`);
    try { entry.worker.postMessage({ id: genId('disp'), type: 'dispose', payload: {} }); } catch {}
    entry.worker.terminate();
    entry.worker = null;
    entry.status = 'idle';
    entry.initPromise = null;
    entry.pending.clear();
  }
}, 30000);
