/**
 * ASR Worker — ASR 模块的总线线程。
 * 管理：DB、文件、引擎、转录编排、日志、闲置超时。
 */
import { parentPort, Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT } from '../config/constants.js';

const ASR_DATA_DIR = path.join(PROJECT_ROOT, 'data', 'asr_services');
const HISTORY_DB_PATH = path.join(ASR_DATA_DIR, 'transcription_history.db');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { normalizeEngineType } from '../utils/engineTypeHelper.js';

const genId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;

/* ========================================================================
 * DB
 * ======================================================================== */

fs.mkdirSync(ASR_DATA_DIR, { recursive: true });
const db = new Database(HISTORY_DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS asr_transcription_history (
    id TEXT PRIMARY KEY, model_id TEXT NOT NULL,
    original_filename TEXT, audio_path TEXT, result_text TEXT,
    output_format TEXT DEFAULT 'json', language TEXT, task_type TEXT DEFAULT 'transcribe',
    duration_seconds REAL, word_count INTEGER DEFAULT 0,
    output_files TEXT DEFAULT '[]', source_type TEXT DEFAULT 'manual', source_file TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_asr_hist_model ON asr_transcription_history(model_id);
  CREATE INDEX IF NOT EXISTS idx_asr_hist_created ON asr_transcription_history(created_at);
`);

/* ========================================================================
 * 日志
 * ======================================================================== */

const LOG_MAX = 2000;
const asrLogs = [];
const ASR_LOGS_DIR = path.join(PROJECT_ROOT, 'data', 'logs');
let _logStream = null;
let _logDate = null;

function getLogDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function ensureLogStream() {
  const today = getLogDate();
  if (_logDate !== today) {
    if (_logStream) { try { _logStream.end(); } catch {} _logStream = null; }
    fs.mkdirSync(ASR_LOGS_DIR, { recursive: true });
    _logStream = fs.createWriteStream(path.join(ASR_LOGS_DIR, `asr-engine-${today}.log`), { flags: 'a' });
    _logDate = today;
  }
}

function addLog(level, message) {
  const entry = { timestamp: new Date().toISOString(), level, message };
  asrLogs.push(entry); if (asrLogs.length > LOG_MAX) asrLogs.shift();
  try { ensureLogStream(); _logStream.write(`[${entry.timestamp}] [${level}] ${message}\n`); } catch {}
}

addLog('info', 'ASR Worker started');

/* ========================================================================
 * 文件管理
 * ======================================================================== */

function getModelDir(modelId) {
  const dir = path.join(ASR_DATA_DIR, modelId);
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'outputs'), { recursive: true });
  return dir;
}

function getUploadsMeta(modelId) {
  const metaPath = path.join(getModelDir(modelId), 'uploads_meta.json');
  return fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];
}

function saveUploadsMeta(modelId, meta) {
  fs.writeFileSync(path.join(getModelDir(modelId), 'uploads_meta.json'), JSON.stringify(meta, null, 2));
}

/* ========================================================================
 * 引擎发现 + 管理
 * ======================================================================== */

function getInstalledAsrEngine(engineType) {
  const asrDir = path.join(PROJECT_ROOT, 'external', 'asr');
  if (!fs.existsSync(asrDir)) return null;

  const normalizedType = normalizeEngineType(engineType);
  const matches = [];

  // 扫描 external/asr/{variantId}/{versionDir}/ 结构
  const variantDirs = fs.readdirSync(asrDir, { withFileTypes: true })
    .filter(x => x.isDirectory() && !x.name.startsWith('_temp_'));

  for (const variantDirEntry of variantDirs) {
    const variantPath = path.join(asrDir, variantDirEntry.name);
    const versionDirs = fs.readdirSync(variantPath, { withFileTypes: true })
      .filter(x => x.isDirectory() && !x.name.startsWith('_temp_'));

    for (const verDirEntry of versionDirs) {
      const dir = path.join(variantPath, verDirEntry.name);
      const cp = path.join(dir, 'contract.json');
      const ap = path.join(dir, 'adapter.js');
      if (!fs.existsSync(cp) || !fs.existsSync(ap)) continue;
      if (!fs.existsSync(path.join(dir, '.installed'))) continue;
      let c; try { c = JSON.parse(fs.readFileSync(cp, 'utf-8')); } catch { continue; }
      // 用 normalizeEngineType 匹配 contract 中声明的 engine.type
      const contractType = normalizeEngineType(c?.engine?.type);
      if (contractType !== normalizedType) continue;
      // 优先级：variant 目录名匹配 > 其他
      const priority = normalizeEngineType(variantDirEntry.name) === normalizedType ? 1 : 0;
      matches.push({ contract: c, adapterPath: ap, dir, enginePath: dir, priority });
    }
  }

  // 按优先级降序排列，取最佳匹配
  matches.sort((a, b) => b.priority - a.priority);
  return matches[0] || null;
}

/** @type {Map<string, { worker: Worker, status: string, initPromise: Promise|null, pending: Map, busy: boolean, activeTasks: number, lastActiveTime: number, report?: object }>} */
const engines = new Map();

function getOrCreateEngine(modelId, engineType) {
  let entry = engines.get(modelId);
  if (entry?.worker) return entry;

  const installed = getInstalledAsrEngine(engineType);
  if (!installed) throw { code: 'ENGINE_UNAVAILABLE', message: 'ASR 引擎未安装' };

  const worker = new Worker(path.join(__dirname, 'asrEngineWorker.js'), {
    workerData: { engineType: engineType, adapterPath: installed.adapterPath, contract: installed.contract, modelId }
  });

  entry = { worker, status: 'idle', initPromise: null, pending: new Map(), busy: false, activeTasks: 0, lastActiveTime: Date.now() };
  engines.set(modelId, entry);

  worker.on('message', (msg) => {
    if (msg.type === 'report') {
      const r = msg.payload;
      if (!entry.report) entry.report = {};
      if (r.health != null) entry.report.health = r.health;
      if (r.pid != null) entry.report.pid = r.pid;
      if (r.port != null) entry.report.port = r.port;
      if (r.event === 'ready') { entry.status = 'running'; addLog('info', `Engine ${modelId} ready, port=${r.port}`); parentPort.postMessage({ type: 'statusChange', payload: { modelId, status: 'running', port: r.port, pid: r.pid } }); }
      if (r.event === 'disposed') { entry.status = 'stopped'; parentPort.postMessage({ type: 'statusChange', payload: { modelId, status: 'stopped' } }); }
      return;
    }
    if (msg.type === 'log') { addLog(msg.payload.level, msg.payload.message); return; }
    const cb = entry.pending.get(msg.id);
    if (cb) { entry.pending.delete(msg.id); cb(msg); }
  });

  worker.on('error', (err) => {
    entry.status = 'error';
    for (const [, cb] of entry.pending) cb({ type: 'error', payload: { code: 'ENGINE_UNAVAILABLE', message: err.message } });
    entry.pending.clear();
  });

  worker.on('exit', () => { engines.delete(modelId); });
  return entry;
}

function sendToEngine(modelId, engineType, type, payload) {
  const entry = getOrCreateEngine(modelId, engineType);
  entry.lastActiveTime = Date.now();  // 每次请求刷新闲置计时
  const id = genId('eng');
  return new Promise((resolve, reject) => {
    entry.pending.set(id, (msg) => msg.type === 'result' ? resolve(msg.payload) : reject(msg.payload));
    entry.worker.postMessage({ id, type, payload });
  });
}

async function ensureEngineReady(modelId, engineType, config) {
  const installed = getInstalledAsrEngine(engineType);
  if (!installed) throw { code: 'ENGINE_UNAVAILABLE', message: 'ASR 引擎未安装' };
  const entry = getOrCreateEngine(modelId, engineType);
  entry.lastActiveTime = Date.now();
  if (entry.status === 'running') return entry.report?.port;

  if (entry.initPromise) { await entry.initPromise; return entry.report?.port; }

  entry.initPromise = sendToEngine(modelId, engineType, 'initialize', { ...config, enginePath: installed.enginePath || installed.dir }).then(() => {
    entry.status = 'running'; entry.initPromise = null;
  }).catch(e => { entry.initPromise = null; entry.status = 'idle'; throw e; });

  await entry.initPromise;
  return entry.report?.port;
}

/* ========================================================================
 * 转录编排
 * ======================================================================== */

async function transcribe(msg) {
  const { modelId, engineType, audioPath, language, outputFormat, temperature, prompt, stream,
    modelFilePath, threads } = msg;
  const taskType = msg.task || 'transcribe';

  await ensureEngineReady(modelId, engineType, { modelFilePath, language, threads });

  addLog('info', `Transcribing: ${path.basename(audioPath)} (${modelId})`);

  // 通过 engine worker 调用 adapter.transcribe()（各引擎路径不同，adapter 自行处理）
  const result = await sendToEngine(modelId, engineType, 'transcribe', {
    audioPath,
    params: { language, response_format: outputFormat, temperature, prompt, stream }
  });

  let parsed = result || {};
  if (typeof parsed === 'string') parsed = { text: parsed };

  // 写历史
  const historyId = genId('asr-hist');
  const outputDir = msg.outputDir || path.join(getModelDir(modelId), 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = path.basename(audioPath, path.extname(audioPath));
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const outputFiles = [];

  // 输出文件由前端单独调 /asr-studio/save-output 写入，不在转录时自动写

  const now = new Date().toISOString();
  db.prepare(`INSERT INTO asr_transcription_history
    (id, model_id, original_filename, audio_path, result_text, output_format, language, task_type, output_files, source_type, source_file, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(historyId, modelId, path.basename(audioPath), audioPath, parsed.text || '', outputFormat || 'json',
      language || '', taskType, JSON.stringify(outputFiles), msg.sourceType || 'manual', msg.sourceFile || '', now);

  addLog('info', `Transcription done: historyId=${historyId}`);
  return { historyId, text: parsed.text || '', outputFiles };
}

function formatSrt(result) { /* simplified - returns empty if no segments */
  if (!result.segments?.length) return `1\n00:00:00,000 --> 00:00:01,000\n${result.text || ''}\n`;
  return result.segments.map((s, i) => `${i+1}\n${fmtSrtTime(s.start)} --> ${fmtSrtTime(s.end)}\n${s.text}\n`).join('\n');
}
function formatVtt(result) {
  if (!result.segments?.length) return `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${result.text || ''}\n`;
  return 'WEBVTT\n\n' + result.segments.map(s => `${fmtVttTime(s.start)} --> ${fmtVttTime(s.end)}\n${s.text}\n`).join('\n');
}
function fmtSrtTime(s) { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.floor((s%1)*1000); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`; }
function fmtVttTime(s) { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.floor((s%1)*1000); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms).padStart(3,'0')}`; }

/* ========================================================================
 * 历史
 * ======================================================================== */

function getHistory(page = 1, pageSize = 20, modelId) {
  let where = '1=1'; const params = [];
  if (modelId) { where += ' AND model_id = ?'; params.push(modelId); }
  const total = db.prepare(`SELECT COUNT(*) as c FROM asr_transcription_history WHERE ${where}`).get(...params)?.c || 0;
  const items = db.prepare(`SELECT * FROM asr_transcription_history WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map(r => ({ ...r, output_files: JSON.parse(r.output_files || '[]') }));
  return { items, total, page, page_size: pageSize };
}

/* ========================================================================
 * 请求队列（服务端）
 * ======================================================================== */

const taskQueue = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (taskQueue.length > 0) {
    const task = taskQueue[0];
    task.status = 'processing';
    try {
      const result = await transcribe(task);
      task.status = 'completed';
      task.resultText = result.text;
    } catch (e) {
      task.status = 'failed';
      task.error = e.message;
    }
    taskQueue.shift();
  }
  processing = false;
}

/* ========================================================================
 * 消息分发
 * ======================================================================== */

parentPort.on('message', async (msg) => {
  const { id, type, payload } = msg;
  try {
    const result = await dispatch(type, payload);
    parentPort.postMessage({ id, type: 'result', payload: result !== undefined ? result : {} });
  } catch (e) {
    parentPort.postMessage({ id, type: 'error', payload: { code: e.code || 'INTERNAL_ERROR', message: e.message } });
  }
});

async function dispatch(type, payload) {
  switch (type) {
    // 文件
    case 'getFiles': return getUploadsMeta(payload.modelId);
    case 'uploadFiles': {
      const { modelId, files: fileList } = payload;
      const meta = getUploadsMeta(modelId);
      const added = [];
      for (const f of fileList) {
        const uuid = crypto.randomUUID().slice(0, 12);
        const filename = `${uuid}_${f.originalName}`;
        const dest = path.join(getModelDir(modelId), 'uploads', filename);
        fs.writeFileSync(dest, Buffer.from(f.buffer));
        const entry = { uuid, original_name: f.originalName, filename, size: f.size, status: 'pending', uploaded_at: new Date().toISOString() };
        meta.push(entry); added.push(entry);
      }
      saveUploadsMeta(modelId, meta);
      return added;
    }
    case 'deleteFiles': {
      const { modelId, filenames } = payload;
      let meta = getUploadsMeta(modelId);
      for (const fn of filenames) {
        try { fs.unlinkSync(path.join(getModelDir(modelId), 'uploads', fn)); } catch {}
      }
      meta = meta.filter(f => !filenames.includes(f.filename));
      saveUploadsMeta(modelId, meta);
      return { success: true };
    }
    case 'updateFileStatus': {
      const { modelId, filename, status } = payload;
      const meta = getUploadsMeta(modelId);
      const entry = meta.find(f => f.filename === filename);
      if (entry) { entry.status = status; saveUploadsMeta(modelId, meta); }
      return { success: true };
    }
    case 'deleteCompletedFiles': {
      const { modelId } = payload;
      let meta = getUploadsMeta(modelId);
      for (const f of meta.filter(x => x.status === 'completed')) {
        try { fs.unlinkSync(path.join(getModelDir(modelId), 'uploads', f.filename)); } catch {}
      }
      meta = meta.filter(x => x.status !== 'completed');
      saveUploadsMeta(modelId, meta);
      return { success: true };
    }

    // 历史
    case 'getHistory': return getHistory(payload.page || 1, payload.pageSize || 20, payload.modelId);
    case 'deleteHistoryItem': {
      const item = db.prepare('SELECT * FROM asr_transcription_history WHERE id = ?').get(payload.id);
      if (item?.output_files) {
        for (const f of JSON.parse(item.output_files || '[]')) { try { fs.unlinkSync(f); } catch {} }
      }
      db.prepare('DELETE FROM asr_transcription_history WHERE id = ?').run(payload.id);
      return { success: true };
    }
    case 'clearHistory': {
      if (payload.modelId) {
        const items = db.prepare('SELECT * FROM asr_transcription_history WHERE model_id = ?').all(payload.modelId);
        for (const item of items) {
          for (const f of JSON.parse(item.output_files || '[]')) { try { fs.unlinkSync(f); } catch {} }
        }
        db.prepare('DELETE FROM asr_transcription_history WHERE model_id = ?').run(payload.modelId);
      }
      return { success: true };
    }

    // 队列
    case 'enqueueTranscribe': {
      const task = { id: genId('q'), ...payload, status: 'pending', createdAt: new Date().toISOString() };
      taskQueue.push(task);
      addLog('info', `Enqueued: ${payload.filename}`);
      processQueue();
      return task;
    }
    case 'getQueue': return { items: taskQueue.map(t => ({ id: t.id, filename: t.filename, status: t.status, error: t.error })) };

    // 转录（直接调用，同步返回）
    case 'transcribe':
    case 'transcribeStream':
      return transcribe(payload);

    // 引擎
    case 'startEngine': {
      const { modelId, engineType, modelFilePath, language, threads, enginePath } = payload;
      await ensureEngineReady(modelId, engineType, { modelFilePath, language, threads, enginePath });
      return { status: 'running' };
    }
    case 'stopEngine': {
      const e = engines.get(payload.modelId);
      if (e?.worker) {
        try { await sendToEngine(payload.modelId, payload.engineType, 'dispose', {}); } catch {}
        try { await e.worker.terminate(); } catch {}
        engines.delete(payload.modelId);
      }
      return { status: 'stopped' };
    }
    case 'engineStatus': {
      const e = engines.get(payload.modelId);
      return { modelId: payload.modelId, status: e?.status || 'idle', port: e?.report?.port };
    }
    case 'isEngineRunning': {
      const statuses = {};
      for (const [mid, e] of engines) statuses[mid] = e.status;
      return { running: [...engines.values()].some(e => e.status === 'running' || e.status === 'busy'), engines: statuses };
    }

    // 日志
    case 'getAsrLogs': return { logs: asrLogs.slice(-(payload.limit || 500)), _count: asrLogs.length };
    case 'clearAsrLogs': asrLogs.length = 0; return { success: true };

    // 输出目录
    case 'getOutputDir': {
      const { modelManager } = await import('../services/modelManager.js');
      const m = modelManager.default.getById(payload.modelId);
      return { output_dir: m?.asr_config?.output_dir || m?.whisper_config?.output_dir || path.join(getModelDir(payload.modelId), 'outputs') };
    }
    case 'setOutputDir': {
      const { modelManager } = await import('../services/modelManager.js');
      const m = modelManager.default.getById(payload.modelId);
      if (m) {
        const cfg = m.asr_config || m.whisper_config || {};
        cfg.output_dir = payload.outputDir;
        modelManager.default.update(payload.modelId, { asr_config: cfg });
      }
      return { success: true };
    }
    case 'openOutputDir': {
      const { execSync } = await import('child_process');
      const dir = payload.outputDir || path.join(getModelDir(payload.modelId), 'outputs');
      fs.mkdirSync(dir, { recursive: true });
      execSync(`start "" "${dir}"`, { shell: true });
      return { success: true };
    }

    default:
      throw { code: 'UNKNOWN_TYPE', message: `Unknown: ${type}` };
  }
}

/* ========================================================================
 * 闲置超时
 * ======================================================================== */
setInterval(() => {
  const now = Date.now();
  for (const [modelId, entry] of engines) {
    if (entry.status !== 'running' || entry.activeTasks > 0 || entry.busy) continue;
    if (now - entry.lastActiveTime < 5 * 60 * 1000) continue;
    addLog('info', `Engine ${modelId} idle timeout, disposing`);
    try { entry.worker.postMessage({ id: genId('disp'), type: 'dispose', payload: {} }); } catch {}
    entry.worker.terminate();
    entry.worker = null; entry.status = 'idle'; entry.initPromise = null;
  }
}, 30000);
