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
import { TTS_DEFAULTS } from '../config/constants.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';

// 主线程通过 workerData 传入正确的 PROJECT_ROOT
const PROJECT_ROOT = workerData.PROJECT_ROOT;
const TTS_CONFIG_PATH = path.join(PROJECT_ROOT, 'data', 'tts_services', 'config.json');
const TTS_WORKSPACES_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'workspaces');

import { openDb } from './db/connection.js';
import { migrate } from './db/schema.js';
import * as voiceRepo from './db/voiceRepo.js';
import * as workspaceRepo from './db/workspaceRepo.js';
import * as historyRepo from './db/historyRepo.js';

import { discoverEngines } from './engine/discovery.js';
import { createRegistry } from './engine/registry.js';
import { ensureInitialized, disposeEngine, sendToEngine, getStatus } from './engine/lifecycle.js';

const ENGINES_DIR = path.join(PROJECT_ROOT, 'external', 'tts');
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

const db = openDb();
migrate(db);

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
const log = createLogBuffer();
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
    parentPort.postMessage({
      id, type: 'error',
      payload: { code: e.code || 'INTERNAL_ERROR', message: e.message, retryable: e.retryable !== false }
    });
  }
});

async function dispatch(type, payload) {
  switch (type) {
    // Voice
    case 'listVoices':
      return voiceRepo.listVoices(db, payload);
    case 'createVoice':
      return voiceRepo.createVoice(db, payload);
    case 'cleanupVoice':
      voiceRepo.deleteVoice(db, payload.voice_id);
      return { success: true };
    case 'resolveVoice':
      return resolveVoice(db, payload.voice_id);

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
      const voice = voiceRepo.getVoice(db, payload.voice_id);
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
      const voiceRef = skipVoiceResolve ? { skip: true } : resolveVoice(db, voiceId);
      await ensureInitialized(registry, engineType, modelDir, log, ENGINES_DIR, ENGINE_WORKER_PATH, getVersionOrder(engineType));

      return synthesize({
        text, voiceRef, engineType, outputFormat, outputDir, params, workspaceId,
        sourceFile, sourceType, modelDir, llmPort, log,
        engines: registry, historyRepo: {
          createHistory: (opts) => historyRepo.createHistory(db, opts)
        }
      });
    }

    // Engine lifecycle
    case 'startEngine':
      await ensureInitialized(registry, payload.engine_type, payload.model_dir, log, ENGINES_DIR, ENGINE_WORKER_PATH, getVersionOrder(payload.engine_type));
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
      if (!cfg) {
        try { cfg = await sendToEngine(registry.get(payload.engine_type), 'getRuntimeConfig', {}); } catch { cfg = {}; }
      }
      return cfg || {};
    }
    case 'setEngineRuntimeConfig':
      return sendToEngine(registry.get(payload.engine_type), 'setRuntimeConfig', { key: payload.key, value: payload.value });
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
