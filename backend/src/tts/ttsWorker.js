/**
 * TTS Worker — 消息路由 + 服务组装。
 *
 * 每个 import 对应一个独立模块，Worker 只负责：
 *   1. 初始化 DB、注册表、日志
 *   2. 接收主线程消息 → 分发到对应模块
 *   3. 返回结果或错误
 */
import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { getFfmpegExe } from './audio/ffmpeg.js';
import { idFromMd5Bytes } from '../utils/voiceIdHelper.js';
import { TTS_DEFAULTS } from '../config/constants.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';

// 主线程通过 workerData 传入正确的 PROJECT_ROOT
const PROJECT_ROOT = workerData.PROJECT_ROOT;
const TTS_CONFIG_PATH = path.join(PROJECT_ROOT, 'data', 'tts_services', 'config.json');
const TTS_WORKSPACES_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'workspaces');
const TTS_REF_AUDIO_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'reference_audio');
const TTS_DB_PATH = path.join(PROJECT_ROOT, 'data', 'tts_services', 'tts.db');
const TTS_HISTORY_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'history');
const TTS_LOGS_DIR = path.join(PROJECT_ROOT, 'data', 'logs');

import { openDb } from './db/connection.js';
import { migrate } from './db/schema.js';
import * as voiceRepo from './db/voiceRepo.js';
import * as workspaceRepo from './db/workspaceRepo.js';
import * as historyRepo from './db/historyRepo.js';

workspaceRepo.setRoot(PROJECT_ROOT);
historyRepo.setRoot(PROJECT_ROOT);

import { discoverEngines } from './engine/discovery.js';
import { createRegistry } from './engine/registry.js';
import { ensureInitialized, disposeEngine, sendToEngine, getStatus } from './engine/lifecycle.js';

const ENGINES_DIR = path.join(PROJECT_ROOT, 'external', 'tts');
const FFMPEG_DIR = path.join(PROJECT_ROOT, 'external', 'ffmpeg');
const ENGINE_WORKER_PATH = path.join(PROJECT_ROOT, 'backend', 'src', 'tts', 'engineWorker.js');

// 读取 engines.json 获取版本顺序
function getVersionOrder(engineType) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'engines.json'), 'utf-8'));
    const variants = cfg?.engines?.tts?.variants || [];
    const variant = variants.find(v => normalizeEngineType(v.id) === normalizeEngineType(engineType));
    return (variant?.versions || []).map(v => v.version);
  } catch { return []; }
}
import { resolveVoice } from './voice/resolver.js';
import { synthesize } from './synthesis/orchestrator.js';
import { createLogBuffer } from './log/buffer.js';

/* ========================================================================
 * 初始化
 * ======================================================================== */

const db = openDb(TTS_DB_PATH);
const dirs = { voices: TTS_WORKSPACES_DIR, workspaces: TTS_WORKSPACES_DIR, refAudio: TTS_REF_AUDIO_DIR, history: TTS_HISTORY_DIR };
migrate(db, dirs);

// 启动时扫描工作区目录，自动注册不在 DB 中的工作区
function syncWorkspaces() {
  if (!fs.existsSync(TTS_WORKSPACES_DIR)) return;
  // 先把 DB 里的 workspace 参数写回 config.json（防止下次 DB 重置时丢失）
  for (const ws of workspaceRepo.listWorkspaces(db)) {
    const cfgPath = path.join(ws.folder_path, 'config.json');
    try {
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      let cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) : {};
      cfg.name = ws.name;
      cfg.engine_type = ws.engine_type;
      cfg.voice_mode = ws.voice_mode;
      cfg.params = ws.params;
      cfg.output_dir = ws.output_dir;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    } catch {}
  }

  const existingModelIds = new Set(workspaceRepo.listWorkspaces(db).map(w => w.model_id));
  for (const dir of fs.readdirSync(TTS_WORKSPACES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (existingModelIds.has(dir.name)) continue;
    const cfgPath = path.join(TTS_WORKSPACES_DIR, dir.name, 'config.json');
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      workspaceRepo.createWorkspace(db, {
        id: dir.name,
        name: cfg.name || dir.name,
        engine_type: cfg.engine_type || '',
        voice_mode: cfg.voice_mode || cfg.params?.voice_mode || 'clone',
        voice_id: cfg.voice_id || null,
        params: cfg.params || {},
        folder_path: path.join(TTS_WORKSPACES_DIR, dir.name),
        output_dir: cfg.output_dir || path.join(TTS_WORKSPACES_DIR, dir.name, 'outputs'),
      });
      log.info('Auto-registered workspace: ' + (cfg.name || dir.name));
    } catch (e) {
      log.warn('Failed to register workspace ' + dir.name + ': ' + e.message);
    }
  }
}
const registry = createRegistry();
const log = createLogBuffer(TTS_LOGS_DIR);
const pendingRuntimeConfigs = new Map(); // engineType → { key: value, ... }  引擎未初始化时的暂存配置

function loadRuntimeConfigs() {
  const rows = db.prepare('SELECT engine_type, key, value FROM tts_engine_runtime_config').all();
  const configs = {};
  for (const { engine_type, key, value } of rows) {
    if (!configs[engine_type]) configs[engine_type] = {};
    // 尝试还原数字/布尔类型，JSON 解析失败则保留字符串
    try { configs[engine_type][key] = JSON.parse(value); } catch { configs[engine_type][key] = value; }
  }
  return configs;
}

function saveRuntimeConfigs(configs) {
  const upsert = db.prepare('INSERT OR REPLACE INTO tts_engine_runtime_config (engine_type, key, value) VALUES (?, ?, ?)');
  for (const [engineType, cfg] of Object.entries(configs)) {
    for (const [key, value] of Object.entries(cfg)) {
      upsert.run(engineType, key, JSON.stringify(value));
    }
  }
}

async function applyPendingRuntimeConfigs(engineType) {
  const pending = pendingRuntimeConfigs.get(engineType);
  if (!pending || Object.keys(pending).length === 0) return;
  const entry = registry.get(engineType);
  if (!entry) return;
  for (const [key, value] of Object.entries(pending)) {
    try { await sendToEngine(entry, 'setRuntimeConfig', { key, value }); } catch {}
  }
  pendingRuntimeConfigs.delete(engineType);
  log.info(`Applied ${Object.keys(pending).length} pending runtime configs for ${engineType}`);
}
// 启动时从文件恢复持久化的运行时配置
const persistedConfigs = loadRuntimeConfigs();
for (const [engineType, cfg] of Object.entries(persistedConfigs)) {
  if (cfg && Object.keys(cfg).length > 0) {
    pendingRuntimeConfigs.set(engineType, { ...cfg });
  }
}

try {
  syncWorkspaces();
} catch (e) {
  log.error('syncWorkspaces failed: ' + e.message);
}
const wsCount = workspaceRepo.listWorkspaces(db).length;
log.info('TTS Worker started, ' + wsCount + ' workspaces, PROJECT_ROOT=' + PROJECT_ROOT);

function getIdleTimeoutMs() {
  try {
    if (fs.existsSync(TTS_CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(TTS_CONFIG_PATH, 'utf-8'));
      const val = Number(cfg.idle_timeout_minutes) || TTS_DEFAULTS.IDLE_TIMEOUT_MINUTES;
      return Math.max(TTS_DEFAULTS.IDLE_MIN_MINUTES, Math.min(TTS_DEFAULTS.IDLE_MAX_MINUTES, val)) * 60 * 1000;
    }
  } catch {}
  return TTS_DEFAULTS.IDLE_TIMEOUT_MINUTES * 60 * 1000;
}

registry.setIdleTimeoutGetter(getIdleTimeoutMs);

/* ========================================================================
 * 消息路由
 * ======================================================================== */

parentPort.on('message', async (msg) => {
  const { id, type, payload } = msg;
  try {
    const result = await dispatch(type, payload);
    parentPort.postMessage({ id, type: 'result', payload: result !== undefined ? result : {} });
  } catch (e) {
    log.error(type + ' failed: ' + e.message);
    parentPort.postMessage({
      id, type: 'error',
      payload: { code: e.code || 'INTERNAL_ERROR', message: e.message, retryable: e.retryable !== false }
    });
  }
});

async function dispatch(type, payload) {
  switch (type) {
    // Voice
    case 'uploadReferenceAudio': {
      const { buffer, originalName } = payload;
      const ext = path.extname(originalName).toLowerCase().slice(1) || 'wav';
      const displayName = path.basename(originalName, path.extname(originalName)) || originalName;
      let audioBuffer = Buffer.from(buffer);
      let actualExt = ext;

      // ffmpeg 转码非 wav/mp3 格式
      if (!['wav', 'mp3'].includes(ext)) {
        const ffExe = getFfmpegExe(FFMPEG_DIR);
        if (!ffExe) throw new Error('ffmpeg 未安装，无法处理 .' + ext + ' 格式');
        const tmpIn = path.join(TTS_REF_AUDIO_DIR, '_tmp_in_' + Date.now() + '.' + ext);
        const tmpOut = path.join(TTS_REF_AUDIO_DIR, '_tmp_out_' + Date.now() + '.wav');
        fs.writeFileSync(tmpIn, audioBuffer);
        try {
          await new Promise((resolve, reject) => {
            const p = spawn(ffExe, ['-i', tmpIn, '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', tmpOut, '-y']);
            p.on('close', code => { code !== 0 || !fs.existsSync(tmpOut) ? reject(new Error('转码失败')) : resolve(); });
            p.on('error', e => reject(e));
          });
          audioBuffer = fs.readFileSync(tmpOut);
          actualExt = 'wav';
        } finally {
          try { fs.unlinkSync(tmpIn); } catch {}
          try { fs.unlinkSync(tmpOut); } catch {}
        }
      }

      const md5 = crypto.createHash('md5').update(audioBuffer).digest();
      const voiceId = idFromMd5Bytes(md5);
      const filename = voiceId + '_' + displayName + '.' + actualExt;
      const filePath = path.join(TTS_REF_AUDIO_DIR, filename);
      fs.mkdirSync(TTS_REF_AUDIO_DIR, { recursive: true });
      fs.writeFileSync(filePath, audioBuffer);

      return {
        id: voiceId, voice_id: voiceId, name: displayName,
        file_path: filePath, file_size: audioBuffer.length,
        format: actualExt, uploaded_at: new Date().toISOString()
      };
    }
    case 'listVoices':
      return voiceRepo.listVoices(payload, TTS_REF_AUDIO_DIR);
    case 'cleanupVoice':
      voiceRepo.deleteVoice(payload.voice_id, TTS_REF_AUDIO_DIR);
      return { success: true };
    case 'resolveVoice':
      return resolveVoice(db, payload.voice_id, TTS_REF_AUDIO_DIR);

    // Workspace
    case 'getWorkspace':
      return workspaceRepo.getWorkspace(db, payload.id);
    case 'getWorkspaces':
      return workspaceRepo.listWorkspaces(db);
    case 'getWorkspaceFiles': {
      const ws = workspaceRepo.getWorkspace(db, payload.id);
      if (!ws) return [];
      const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
      return fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];
    }
    case 'createWorkspace': {
      const ws = payload;
      return workspaceRepo.createWorkspace(db, ws);
    }
    case 'deleteWorkspace':
      workspaceRepo.deleteWorkspace(db, payload.id);
      return { success: true };
    case 'updateOutputDir':
      workspaceRepo.updateOutputDir(db, payload.id, payload.output_dir);
      return { success: true };
    case 'updateWorkspaceParams':
      workspaceRepo.updateParams(db, payload.id, payload.params);
      return { success: true };
    case 'activateVoice':
      workspaceRepo.activateVoice(db, payload.workspace_id, payload.voice_id);
      const voice = voiceRepo.getVoice(payload.voice_id, TTS_REF_AUDIO_DIR);
      return { workspace_id: payload.workspace_id, active_voice_id: payload.voice_id, voice };

    // History
    case 'getHistory':
      return historyRepo.listHistory(db, payload);
    case 'deleteHistoryItem': {
      const item = historyRepo.listHistory(db, { page: 1, pageSize: 1 });
      // 通过 historyRepo 读取以获取正确的绝对路径
      const fullItem = db.prepare('SELECT output_file FROM tts_synthesis_history WHERE id = ?').get(payload.id);
      if (fullItem?.output_file) {
        const absPath = path.isAbsolute(fullItem.output_file) ? fullItem.output_file : path.join(PROJECT_ROOT, fullItem.output_file);
        if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
      }
      historyRepo.deleteHistory(db, payload.id);
      return { success: true };
    }

    // Synthesis
    case 'synthesize': {
      const { text, voiceId, engineType, outputFormat = 'wav', outputDir = '', params = {},
        workspaceId, sourceFile, sourceType, modelDir = '', skipVoiceResolve = false, llmPort } = payload;
      const voiceRef = skipVoiceResolve ? { skip: true } : resolveVoice(db, voiceId, TTS_REF_AUDIO_DIR);
      await ensureInitialized(registry, engineType, modelDir, log, ENGINES_DIR, ENGINE_WORKER_PATH, getVersionOrder(engineType), PROJECT_ROOT);
      await applyPendingRuntimeConfigs(engineType);

      const result = await synthesize({
        text, voiceRef, engineType, outputFormat, outputDir, params, workspaceId,
        sourceFile, sourceType, modelDir, llmPort, log,
        engines: registry, ffmpegDir: FFMPEG_DIR, defaultOutputDir: TTS_HISTORY_DIR, historyRepo: {
          createHistory: (opts) => historyRepo.createHistory(db, opts)
        }
      });
      return result;
    }

    // Engine lifecycle
    case 'startEngine':
      await ensureInitialized(registry, payload.engine_type, payload.model_dir, log, ENGINES_DIR, ENGINE_WORKER_PATH, getVersionOrder(payload.engine_type), PROJECT_ROOT);
      await applyPendingRuntimeConfigs(payload.engine_type);
      return { engine_type: payload.engine_type, status: 'running' };
    case 'stopEngine':
      disposeEngine(registry, payload.engine_type);
      log.info(`Engine ${payload.engine_type} stopped`);
      return { status: 'stopped' };
    case 'isEngineRunning':
      return getStatus(registry);
    case 'listEngineContracts': {
      const contracts = [];
      const onlineNames = new Map();
      try {
        const engCfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'engines.json'), 'utf-8'));
        for (const v of engCfg?.engines?.tts?.variants || []) {
          onlineNames.set(normalizeEngineType(v.id), v.name);
        }
      } catch {}
      const discovered = discoverEngines(ENGINES_DIR);
      for (const eng of discovered) {
        const eType = eng.contract.engine?.type || eng.engineType;
        contracts.push({
          engine_type: eType,
          engine_name: eng.contract.engine?.name || onlineNames.get(normalizeEngineType(eType)) || eType,
          version: path.basename(eng.installDir),
          contract: eng.contract,
          engine_version: eng.version,
        });
      }
      // 每个 engine_type 只保留 engines.json 中排最前的版本
      const versionRanks = new Map();
      try {
        const engCfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'engines.json'), 'utf-8'));
        for (const v of engCfg?.engines?.tts?.variants || []) {
          (v.versions || []).forEach((ver, idx) => versionRanks.set(ver.version, idx));
        }
      } catch {}
      const best = new Map();
      for (const c of contracts) {
        const key = normalizeEngineType(c.engine_type);
        const existing = best.get(key);
        if (!existing) { best.set(key, c); continue; }
        const newRank = versionRanks.get(c.engine_version) ?? Infinity;
        const existRank = versionRanks.get(existing.engine_version) ?? Infinity;
        if (newRank < existRank) { best.set(key, c); }
      }
      return [...best.values()];
    }

    // Engine runtime
    case 'getEngineRuntimeConfig': {
      let cfg = registry.get(payload.engine_type)?.report?.runtimeConfig;
      if (!cfg || Object.keys(cfg).length === 0) {
        const pending = pendingRuntimeConfigs.get(payload.engine_type);
        if (pending && Object.keys(pending).length > 0) {
          cfg = { ...pending };
        } else {
          const entry = registry.get(payload.engine_type);
          if (entry) {
            try { cfg = await sendToEngine(entry, 'getRuntimeConfig', {}); } catch { cfg = {}; }
          }
        }
      }
      // 内存中没有则从持久化文件加载
      if (!cfg || Object.keys(cfg).length === 0) {
        const persisted = loadRuntimeConfigs();
        cfg = persisted[payload.engine_type] || {};
      }
      return cfg || {};
    }
    case 'setEngineRuntimeConfig': {
      const entry = registry.get(payload.engine_type);

      // 持久化到文件
      const persisted = loadRuntimeConfigs();
      if (!persisted[payload.engine_type]) persisted[payload.engine_type] = {};
      persisted[payload.engine_type][payload.key] = payload.value;
      saveRuntimeConfigs(persisted);

      if (entry) {
        return sendToEngine(entry, 'setRuntimeConfig', { key: payload.key, value: payload.value });
      }
      // 引擎未初始化：暂存配置，等引擎启动后应用
      if (!pendingRuntimeConfigs.has(payload.engine_type)) {
        pendingRuntimeConfigs.set(payload.engine_type, {});
      }
      pendingRuntimeConfigs.get(payload.engine_type)[payload.key] = payload.value;
      log.info(`Runtime config pending for ${payload.engine_type}: ${payload.key}=${payload.value}`);
      return { key: payload.key, value: payload.value };
    }
    case 'getEngineIdleInfo': {
      const e = registry.get(payload.engine_type);
      if (!e) return null;
      const timeoutMs = registry.getIdleTimeoutMs();
      const elapsed = Date.now() - (e.lastActiveTime || 0);
      const remainingMs = Math.max(0, timeoutMs - elapsed);
      return {
        status: e.status,
        lastActiveTime: e.lastActiveTime || null,
        idleTimeoutMs: timeoutMs,
        remainingMs,
        activeTasks: e.activeTasks || 0,
      };
    }
    case 'getEnginePid':
      return registry.get(payload.engine_type)?.report?.pid ?? null;
    case 'getEnginePort':
      return registry.get(payload.engine_type)?.report?.port ?? null;
    case 'getEngineMemoryInfo':
      return registry.get(payload.engine_type)?.report?.memory || { vram_used_mb: -1, vram_total_mb: -1, shared_used_mb: -1, shared_total_mb: -1 };
    case 'storeEngineReport': {
      const e = registry.get(payload.engine_type);
      if (!e) return { success: true };
      if (!e.report) e.report = {};
      const r = payload;
      if (r.health != null) e.report.health = r.health;
      if (r.pid != null) e.report.pid = r.pid;
      if (r.memory != null) e.report.memory = r.memory;
      if (r.event === 'ready' && e.status === 'starting') e.status = 'running';
      return { success: true };
    }

    // Logs
    case 'getTtsLogs':
      return { logs: log.get(payload?.limit || 500, payload?.level || 'all'), _time: Date.now() };
    case 'clearTtsLogs':
      log.clear();
      return { success: true };

    default:
      throw { code: 'UNKNOWN_TYPE', message: `Unknown TTS worker message: ${type}` };
  }
}

/* ========================================================================
 * 引擎闲置自动关闭
 * ======================================================================== */
setInterval(() => {
  for (const { type, entry } of registry.getIdleEngines()) {
    const timeoutMs = getIdleTimeoutMs();
    log.info(`Engine ${type} idle timeout (${timeoutMs / 60000}min), auto-disposing`);
    disposeEngine(registry, type);
  }
}, TTS_DEFAULTS.IDLE_CHECK_INTERVAL_MS);
