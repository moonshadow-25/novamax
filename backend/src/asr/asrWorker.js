/**
 * ASR Worker — ASR 模块的总线线程。
 * 管理：DB、文件、引擎、转录编排、日志、闲置超时。
 */
import { parentPort, Worker, workerData } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { ASR_DEFAULTS } from '../config/constants.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';
import { migrate as migrateDb } from './db/schema.js';

const PROJECT_ROOT = workerData.PROJECT_ROOT;
const ASR_ENGINE_DIR = path.join(PROJECT_ROOT, 'external', 'asr');
const ASR_DATA_DIR = path.join(PROJECT_ROOT, 'data', 'asr_services');
const ASR_HISTORY_DB = path.join(ASR_DATA_DIR, 'transcription_history.db');

const genId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;

/* ========================================================================
 * DB
 * ======================================================================== */

fs.mkdirSync(ASR_DATA_DIR, { recursive: true });
const db = new Database(ASR_HISTORY_DB);
db.pragma('journal_mode = WAL');
migrateDb(db, ASR_DATA_DIR);

/* ========================================================================
 * 日志
 * ======================================================================== */

const asrLogs = [];
const ASR_LOGS_DIR = path.join(PROJECT_ROOT, 'data', 'logs');
let _logStream = null;
let _logDate = null;

function getLogDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function cleanOldLogs() {
  try {
    if (!fs.existsSync(ASR_LOGS_DIR)) return;
    const now = Date.now();
    for (const file of fs.readdirSync(ASR_LOGS_DIR)) {
      const match = /^asr-engine-(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
      if (!match) continue;
      const logDate = new Date(`${match[1]}T00:00:00`).getTime();
      if (Number.isNaN(logDate)) continue;
      if ((now - logDate) / 86400000 > ASR_DEFAULTS.LOG_RETENTION_DAYS) {
        fs.unlinkSync(path.join(ASR_LOGS_DIR, file));
      }
    }
  } catch {}
}

function ensureLogStream() {
  const today = getLogDate();
  if (_logDate !== today) {
    if (_logStream) { try { _logStream.end(); } catch (e) { addLog('warn', '关闭旧日志流失败: '+e.message); } _logStream = null; }
    fs.mkdirSync(ASR_LOGS_DIR, { recursive: true });
    cleanOldLogs();
    _logStream = fs.createWriteStream(path.join(ASR_LOGS_DIR, `asr-engine-${today}.log`), { flags: 'a' });
    _logDate = today;
  }
}

function addLog(level, message) {
  const entry = { timestamp: new Date().toISOString(), level, message };
  asrLogs.push(entry); if (asrLogs.length > ASR_DEFAULTS.LOG_MAX_ENTRIES) asrLogs.shift();
  try { ensureLogStream(); _logStream.write(`[${entry.timestamp}] [${level}] ${message}\n`); } catch (e) { /* 日志写入失败时静默 — 不能因为日志导致进程崩溃 */ }
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
  if (!fs.existsSync(ASR_ENGINE_DIR)) return null;

  const normalizedType = normalizeEngineType(engineType);
  const matches = [];

  const variantDirs = fs.readdirSync(ASR_ENGINE_DIR, { withFileTypes: true })
    .filter(x => x.isDirectory() && !x.name.startsWith('_temp_'));

  for (const variantDirEntry of variantDirs) {
    const variantPath = path.join(ASR_ENGINE_DIR, variantDirEntry.name);
    const versionDirs = fs.readdirSync(variantPath, { withFileTypes: true })
      .filter(x => x.isDirectory() && !x.name.startsWith('_temp_'));

    for (const verDirEntry of versionDirs) {
      const dir = path.join(variantPath, verDirEntry.name);
      const cp = path.join(dir, 'contract.json');
      const ap = path.join(dir, 'adapter.js');
      if (!fs.existsSync(cp) || !fs.existsSync(ap)) continue;
      if (!fs.existsSync(path.join(dir, '.installed'))) continue;
      let c; try { c = JSON.parse(fs.readFileSync(cp, 'utf-8')); } catch (e) { addLog('warn', `解析 contract.json 失败: ${cp} — ${e.message}`); continue; }
      const contractType = normalizeEngineType(c?.engine?.type);
      if (!contractType || contractType !== normalizedType) continue;
      const priority = normalizeEngineType(variantDirEntry.name) === normalizedType ? 1 : 0;
      matches.push({ contract: c, adapterPath: ap, dir, enginePath: dir, priority });
    }
  }

  matches.sort((a, b) => b.priority - a.priority);
  if (matches.length > 1) {
    addLog('warn', `引擎类型 "${engineType}" 发现 ${matches.length} 个已安装版本，使用最高优先级: ${matches[0].dir}`);
  }
  return matches[0] || null;
}

/** @type {Map<string, { worker: Worker, status: string, initPromise: Promise|null, pending: Map, busy: boolean, activeTasks: number, lastActiveTime: number, report?: object }>} */
const engines = new Map();

function getOrCreateEngine(modelId, engineType) {
  let entry = engines.get(modelId);
  if (entry?.worker) return entry;

  const installed = getInstalledAsrEngine(engineType);
  if (!installed) throw { code: 'ENGINE_UNAVAILABLE', message: 'ASR 引擎未安装' };

  const worker = new Worker(path.join(PROJECT_ROOT, 'backend', 'src', 'asr', 'asrEngineWorker.js'), {
    workerData: { engineType: engineType, adapterPath: installed.adapterPath, contract: installed.contract, modelId, PROJECT_ROOT }
  });

  entry = { worker, engineType, status: 'idle', initPromise: null, pending: new Map(), busy: false, activeTasks: 0, lastActiveTime: Date.now() };
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
    addLog('error', `Engine worker 错误: ${err.message}`);
    entry.status = 'error';
    for (const [, cb] of entry.pending) cb({ type: 'error', payload: { code: 'ENGINE_UNAVAILABLE', message: err.message } });
    entry.pending.clear();
    // 尝试发送 dispose 指令（如果 Worker 还能响应），否则直接终止
    try { entry.worker.postMessage({ id: genId('disp'), type: 'dispose', payload: {} }); } catch {}
    try { entry.worker.terminate().catch(() => {}); } catch {}
    entry.worker = null;
    entry.initPromise = null;
  });

  worker.on('exit', () => {
    if (!entry._intentionalStop) {
      addLog('warn', `Engine worker ${modelId} 异常退出（engine 进程可能残留）`);
      engines.delete(modelId);
    }
  });
  return entry;
}

function sendToEngine(modelId, engineType, type, payload) {
  const entry = getOrCreateEngine(modelId, engineType);
  entry.lastActiveTime = Date.now();
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

  entry.initPromise = sendToEngine(modelId, engineType, 'initialize', { ...config, enginePath: installed.enginePath }).then(() => {
    entry.status = 'running'; entry.initPromise = null;
  }).catch(e => { entry.initPromise = null; entry.status = 'idle'; addLog('error', `引擎初始化失败: ${e.message}`); throw e; });

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

  if (!modelFilePath) {
    throw { code: 'MODEL_NOT_FOUND', message: `模型 ${modelId} 未关联模型文件（path 字段为空），请先下载模型文件` };
  }

  await ensureEngineReady(modelId, engineType, { modelFilePath, language, threads });

  // 标记引擎忙碌，防止闲置超时在转录中途杀死引擎
  const entry = engines.get(modelId);
  if (entry) { entry.busy = true; entry.activeTasks = (entry.activeTasks || 0) + 1; }

  addLog('info', `Transcribing: ${path.basename(audioPath)} (${modelId})`);

  try {
    const result = await sendToEngine(modelId, engineType, 'transcribe', {
      audioPath,
      params: { language, response_format: outputFormat, temperature, prompt, stream }
    });

    let parsed = result || {};
    if (typeof parsed === 'string') parsed = { text: parsed };

    const historyId = genId('asr-hist');
    const outputDir = msg.outputDir || path.join(getModelDir(modelId), 'outputs');
    fs.mkdirSync(outputDir, { recursive: true });

    // 输出到文件 (output_mode === 'file')
    const outputFiles = [];
    const outputMode = msg.outputMode || 'inline';
    if (outputMode === 'file' && parsed.text) {
      const ext = outputFormat === 'text' ? 'txt'
        : outputFormat === 'srt' ? 'srt'
        : outputFormat === 'vtt' ? 'vtt'
        : outputFormat === 'verbose_json' ? 'json'
        : 'json';
      const baseName = path.basename(audioPath, path.extname(audioPath));
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
      const outPath = path.join(outputDir, `${baseName}_${ts}.${ext}`);
      let content = parsed.text;
      if (outputFormat === 'srt') content = formatSrt(parsed);
      else if (outputFormat === 'vtt') content = formatVtt(parsed);
      else if (outputFormat === 'verbose_json' || outputFormat === 'json') {
        content = JSON.stringify(parsed, null, 2);
      }
      fs.writeFileSync(outPath, content, 'utf-8');
      outputFiles.push(outPath);
      addLog('info', `Output written: ${outPath}`);
    }

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO asr_transcription_history
      (id, model_id, original_filename, audio_path, result_text, output_format, language, task_type, output_files, source_type, source_file, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(historyId, modelId, path.basename(audioPath), audioPath, parsed.text || '', outputFormat || 'json',
        language || '', taskType, JSON.stringify(outputFiles), msg.sourceType || 'manual', msg.sourceFile || '', now);

    addLog('info', `Transcription done: historyId=${historyId}`);
    return { historyId, text: parsed.text || '', outputFiles };
  } finally {
    // 无论成功或失败，释放忙碌标记，允许闲置超时
    if (entry) {
      entry.busy = false;
      entry.activeTasks = Math.max(0, (entry.activeTasks || 1) - 1);
      entry.lastActiveTime = Date.now();
    }
  }
}

function formatSrt(result) {
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

function getHistory(page = 1, pageSize = ASR_DEFAULTS.HISTORY_PAGE_SIZE, modelId) {
  let where = '1=1'; const params = [];
  if (modelId) { where += ' AND model_id = ?'; params.push(modelId); }
  const total = db.prepare(`SELECT COUNT(*) as c FROM asr_transcription_history WHERE ${where}`).get(...params)?.c || 0;
  const items = db.prepare(`SELECT * FROM asr_transcription_history WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map(r => ({ ...r, output_files: JSON.parse(r.output_files || '[]') }));
  return { items, total, page, page_size: pageSize };
}

/* ========================================================================
 * 请求队列
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
      addLog('error', `队列任务失败: ${task.filename} — ${e.message}`);
    }
    taskQueue.shift();
  }
  processing = false;
  if (taskQueue.length > 0) processQueue();
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
    addLog('error', `dispatch "${type}" 失败: ${e.message}`);
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
        try { fs.unlinkSync(path.join(getModelDir(modelId), 'uploads', fn)); } catch (e) { addLog('warn', `删除文件失败: ${fn} — ${e.message}`); }
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
        try { fs.unlinkSync(path.join(getModelDir(modelId), 'uploads', f.filename)); } catch (e) { addLog('warn', `删除已完成文件失败: ${f.filename} — ${e.message}`); }
      }
      meta = meta.filter(x => x.status !== 'completed');
      saveUploadsMeta(modelId, meta);
      return { success: true };
    }

    // 历史
    case 'getHistory': return getHistory(payload.page || 1, payload.pageSize || ASR_DEFAULTS.HISTORY_PAGE_SIZE, payload.modelId);
    case 'deleteHistoryItem': {
      const item = db.prepare('SELECT * FROM asr_transcription_history WHERE id = ?').get(payload.id);
      if (item?.output_files) {
        for (const f of JSON.parse(item.output_files || '[]')) { try { fs.unlinkSync(f); } catch (e) { addLog('warn', `删除历史输出文件失败: ${f} — ${e.message}`); } }
      }
      db.prepare('DELETE FROM asr_transcription_history WHERE id = ?').run(payload.id);
      return { success: true };
    }
    case 'clearHistory': {
      if (payload.modelId) {
        const items = db.prepare('SELECT * FROM asr_transcription_history WHERE model_id = ?').all(payload.modelId);
        for (const item of items) {
          for (const f of JSON.parse(item.output_files || '[]')) { try { fs.unlinkSync(f); } catch (e) { addLog('warn', `清除历史文件失败: ${f} — ${e.message}`); } }
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

    // 转录
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
        e._intentionalStop = true;
        try { await sendToEngine(payload.modelId, payload.engineType, 'dispose', {}); } catch (err) { addLog('warn', `引擎 dispose 失败: ${err.message}`); }
        try { await e.worker.terminate(); } catch (err) { addLog('warn', `Worker terminate 失败: ${err.message}`); }
        engines.delete(payload.modelId);
      }
      parentPort.postMessage({ type: 'statusChange', payload: { modelId: payload.modelId, status: 'stopped' } });
      return { status: 'stopped' };
    }
    case 'engineStatus': {
      const e = engines.get(payload.modelId);
      return { modelId: payload.modelId, status: e?.status || 'idle', port: e?.report?.port };
    }
    case 'engineIdleInfo': {
      const e = engines.get(payload.modelId);
      if (!e) return null;
      const timeoutMin = payload.idleTimeoutMin || 5;
      const timeoutMs = timeoutMin * 60 * 1000;
      const now = Date.now();
      const elapsed = now - (e.lastActiveTime || 0);
      const remainingMs = Math.max(0, timeoutMs - elapsed);
      return {
        status: e.status,
        lastActiveTime: e.lastActiveTime || null,
        idleTimeoutMs: timeoutMs,
        remainingMs,
        activeTasks: e.activeTasks || 0,
      };
    }
    case 'isEngineRunning': {
      const statuses = {};
      for (const [mid, e] of engines) statuses[mid] = e.status;
      return { running: [...engines.values()].some(e => e.status === 'running' || e.status === 'busy'), engines: statuses };
    }

    // 日志
    case 'getAsrLogs': return { logs: asrLogs.slice(-(payload.limit || ASR_DEFAULTS.LOG_FETCH_LIMIT)), _count: asrLogs.length };
    case 'clearAsrLogs': asrLogs.length = 0; return { success: true };

    // 输出目录（已迁移到 asr-studio.js 路由层直接调用 modelManager）
    // getOutputDir / setOutputDir 不再通过 Worker，因 Worker 中无法 import modelManager（native better-sqlite3 兼容性问题）
    case 'openOutputDir': {
      const dir = payload.outputDir || path.join(getModelDir(payload.modelId), 'outputs');
      fs.mkdirSync(dir, { recursive: true });
      const { exec } = await import('child_process');
      exec(`start "" "${dir}"`, { shell: true });
      return { success: true };
    }

    // 优雅关闭 — 释放所有引擎后再退出
    case 'shutdown': {
      addLog('info', 'Worker shutdown requested, disposing all engines...');
      for (const [modelId, e] of engines) {
        if (e.worker) {
          e._intentionalStop = true;
          try {
            await sendToEngine(modelId, e.engineType, 'dispose', {});
            addLog('info', `Engine ${modelId} disposed`);
          } catch (err) {
            addLog('warn', `Engine ${modelId} dispose failed: ${err.message}`);
          }
          try { await e.worker.terminate(); } catch {}
          e.worker = null;
        }
      }
      engines.clear();
      addLog('info', 'All engines disposed');
      return { success: true };
    }

    default:
      throw { code: 'UNKNOWN_TYPE', message: `Unknown: ${type}` };
  }
}

/* ========================================================================
 * 闲置超时
 * ======================================================================== */
setInterval(async () => {
  const now = Date.now();
  for (const [modelId, entry] of engines) {
    if (entry.status !== 'running' || entry.activeTasks > 0 || entry.busy) continue;
    if (now - entry.lastActiveTime < ASR_DEFAULTS.IDLE_TIMEOUT_MS) continue;
    addLog('info', `Engine ${modelId} idle timeout, disposing`);
    entry._intentionalStop = true;
    // 先发 dispose 指令并等待响应，确保 adapter.dispose() → taskkill 有机会执行
    try {
      await sendToEngine(modelId, entry.engineType, 'dispose', {});
      addLog('info', `Engine ${modelId} disposed cleanly`);
    } catch (e) {
      addLog('warn', `Engine ${modelId} dispose via IPC failed, force-terminating: ${e.message}`);
    }
    try { await entry.worker.terminate(); } catch (e) { addLog('warn', `Worker terminate 失败: ${e.message}`); }
    entry.worker = null; entry.status = 'idle'; entry.initPromise = null;
    parentPort.postMessage({ type: 'statusChange', payload: { modelId, status: 'stopped' } });
  }
}, ASR_DEFAULTS.IDLE_CHECK_INTERVAL_MS);
