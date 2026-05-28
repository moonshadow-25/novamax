/**
 * TTS Studio Manager — 工作区 & 参考音频管理
 *
 * 使用 NovaMax 现有的 better-sqlite3 数据库
 * 遵循 NovaMax 现有的 ESM + Express 模式
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { PROJECT_ROOT } from '../config/constants.js';
import configManager from './configManager.js';
import ttsVoiceManager from './ttsVoiceManager.js';

const genId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
const fileUuid = () => crypto.randomUUID().slice(0, 12);

const WORKSPACES_DIR = path.join(PROJECT_ROOT, 'data', 'tts_workspaces');
const REFERENCE_AUDIO_DIR = path.join(PROJECT_ROOT, 'data', 'tts_reference_audio');

function normalizeUploadFilename(name = '') {
  const base = path.basename(String(name || ''));
  try {
    return Buffer.from(base, 'latin1').toString('utf8');
  } catch {
    return base;
  }
}

class TtsStudioManager {
  constructor() {
    this.db = null;
  }

  // ======================== 初始化 ========================

  init() {
    this.db = configManager.db;
    if (!this.db) {
      console.error('[TtsStudioManager] configManager.db is null');
      return;
    }
    this._migrate();
    fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    fs.mkdirSync(REFERENCE_AUDIO_DIR, { recursive: true });
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tts_workspaces (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        engine_type     TEXT NOT NULL,
        voice_mode      TEXT NOT NULL DEFAULT 'clone',
        voice_instruction TEXT,
        voice_id        TEXT,
        reference_audio_id TEXT,
        params          TEXT NOT NULL DEFAULT '{}',
        folder_path     TEXT NOT NULL,
        output_dir      TEXT NOT NULL,
        cloned_from     TEXT,
        created_at      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tts_reference_audios (
        id              TEXT PRIMARY KEY,
        filename        TEXT NOT NULL,
        file_path       TEXT NOT NULL,
        file_size       INTEGER,
        duration        REAL,
        sample_rate     INTEGER DEFAULT 24000,
        format          TEXT DEFAULT 'wav',
        transcript      TEXT,
        transcript_lang TEXT,
        transcript_at   TEXT,
        tags            TEXT DEFAULT '[]',
        uploaded_at     TEXT NOT NULL
      );
    `);

    // 为旧表补充 voice_id 列（如果不存在）
    try {
      this.db.exec(`ALTER TABLE tts_workspaces ADD COLUMN voice_id TEXT`);
    } catch {}
  }

  // ======================== 参考音频 ========================

  createReferenceAudio(file, metadata = {}) {
    const id = genId('ra');
    const originalName = normalizeUploadFilename(file.originalname || file.filename || 'audio.wav');
    const ext = path.extname(originalName).toLowerCase() || '.wav';
    const filename = `${id}${ext}`;
    const filePath = path.join(REFERENCE_AUDIO_DIR, filename);

    fs.writeFileSync(filePath, file.buffer || fs.readFileSync(file.path));

    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO tts_reference_audios
      (id, filename, file_path, file_size, format, sample_rate, tags, uploaded_at)
      VALUES (?, ?, ?, ?, ?, 24000, '[]', ?)`)
      .run(id, originalName, filePath, file.size || fs.statSync(filePath).size, ext.slice(1), now);

    return this.getReferenceAudio(id);
  }

  getReferenceAudios(page = 1, pageSize = 8, search, format) {
    let where = '1=1';
    const params = [];
    if (search) { where += ' AND (filename LIKE ? OR transcript LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (format && format !== 'all') { where += ' AND format = ?'; params.push(format); }

    const total = this.db.prepare(`SELECT COUNT(*) as c FROM tts_reference_audios WHERE ${where}`).get(...params)?.c || 0;
    const offset = (page - 1) * pageSize;
    const items = this.db.prepare(`SELECT * FROM tts_reference_audios WHERE ${where} ORDER BY uploaded_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);
    return { items: items.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })), total, page, page_size: pageSize };
  }

  getReferenceAudio(id) {
    const r = this.db.prepare('SELECT * FROM tts_reference_audios WHERE id = ?').get(id);
    return r ? { ...r, tags: JSON.parse(r.tags || '[]') } : null;
  }

  deleteReferenceAudio(id) {
    const r = this.getReferenceAudio(id);
    if (r && fs.existsSync(r.file_path)) fs.unlinkSync(r.file_path);
    this.db.prepare('DELETE FROM tts_reference_audios WHERE id = ?').run(id);
  }

  updateTranscript(id, text, lang) {
    this.db.prepare('UPDATE tts_reference_audios SET transcript = ?, transcript_lang = ?, transcript_at = ? WHERE id = ?')
      .run(text, lang, new Date().toISOString(), id);
  }

  // ======================== 工作区 ========================

  createWorkspace({ name, engine_type, voice_mode, voice_instruction, reference_audio_id, voice_id, params, output_dir }) {
    const id = genId('ws');
    const folderPath = path.join(WORKSPACES_DIR, id);
    const refDir = path.join(folderPath, 'reference');
    const uploadsDir = path.join(folderPath, 'uploads');
    const jobsDir = path.join(folderPath, 'jobs');

    fs.mkdirSync(refDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(jobsDir, { recursive: true });

    // 复制参考音频
    if (voice_mode === 'clone' && reference_audio_id) {
      const ref = this.getReferenceAudio(reference_audio_id);
      if (ref && fs.existsSync(ref.file_path)) {
        const ext = path.extname(ref.filename);
        fs.copyFileSync(ref.file_path, path.join(refDir, `reference${ext}`));
      }
    }

    const resolvedOutputDir = output_dir || path.join(folderPath, 'outputs');

    // config.json
    const config = { name, engine_type, voice_mode, voice_instruction, params: params || {}, created_at: new Date().toISOString() };
    fs.writeFileSync(path.join(folderPath, 'config.json'), JSON.stringify(config, null, 2));

    // uploads_meta.json
    fs.writeFileSync(path.join(folderPath, 'uploads_meta.json'), '[]');

    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO tts_workspaces
      (id, name, engine_type, voice_mode, voice_instruction, voice_id, reference_audio_id, params, folder_path, output_dir, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, engine_type, voice_mode, voice_instruction || null, voice_id || null, reference_audio_id || null, JSON.stringify(params || {}), folderPath, resolvedOutputDir, now);

    return this.getWorkspace(id);
  }

  cloneWorkspace(sourceId, overrides = {}) {
    const source = this.getWorkspace(sourceId);
    if (!source) throw new Error('源工作区不存在');

    const mergedParams = { ...source.params, ...(overrides.params || {}) };
    const srcFolder = source.folder_path;

    // 复制参考音频
    const newWs = this.createWorkspace({
      name: overrides.name || `${source.name}(副本)`,
      engine_type: overrides.engine_type || source.engine_type,
      voice_mode: overrides.voice_mode || source.voice_mode,
      voice_instruction: overrides.voice_instruction !== undefined ? overrides.voice_instruction : source.voice_instruction,
      reference_audio_id: overrides.reference_audio_id || source.reference_audio_id,
      voice_id: source.voice_id,
      params: mergedParams,
      output_dir: overrides.output_dir || source.output_dir,
    });

    // 复制原工作区的参考音频文件
    const srcRefDir = path.join(srcFolder, 'reference');
    const dstRefDir = path.join(newWs.folder_path, 'reference');
    if (fs.existsSync(srcRefDir)) {
      for (const f of fs.readdirSync(srcRefDir)) {
        fs.copyFileSync(path.join(srcRefDir, f), path.join(dstRefDir, f));
      }
    }

    this.db.prepare('UPDATE tts_workspaces SET cloned_from = ? WHERE id = ?').run(sourceId, newWs.id);
    return this.getWorkspace(newWs.id);
  }

  getWorkspaces() {
    return this.db.prepare('SELECT * FROM tts_workspaces ORDER BY created_at DESC').all()
      .map(r => ({ ...r, params: JSON.parse(r.params || '{}') }));
  }

  getWorkspace(id) {
    const r = this.db.prepare('SELECT * FROM tts_workspaces WHERE id = ?').get(id);
    if (!r) return null;
    return { ...r, params: JSON.parse(r.params || '{}') };
  }

  deleteWorkspace(id) {
    const ws = this.getWorkspace(id);
    if (!ws) return;
    if (fs.existsSync(ws.folder_path)) fs.rmSync(ws.folder_path, { recursive: true, force: true });
    this.db.prepare('DELETE FROM tts_workspaces WHERE id = ?').run(id);
  }

  updateOutputDir(id, newDir) {
    const ws = this.getWorkspace(id);
    if (!ws) throw new Error('工作区不存在');
    this.db.prepare('UPDATE tts_workspaces SET output_dir = ? WHERE id = ?').run(newDir, id);
    const configPath = path.join(ws.folder_path, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  }

  // 工作区文件管理
  getWorkspaceFiles(workspaceId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return [];
    const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
    return fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];
  }

  addWorkspaceFiles(workspaceId, files) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error('工作区不存在');
    const uploadsDir = path.join(ws.folder_path, 'uploads');
    const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
    const existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];

    const added = [];
    for (const file of files) {
      const uuid = fileUuid();
      const originalName = normalizeUploadFilename(file.originalname || file.filename || 'upload.bin');
      const ext = path.extname(originalName);
      const filename = `${uuid}_${originalName}`;
      fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
      const meta = { uuid, original_name: originalName, filename, size: file.size, uploaded_at: new Date().toISOString() };
      existing.push(meta);
      added.push(meta);
    }
    fs.writeFileSync(metaPath, JSON.stringify(existing, null, 2));
    return added;
  }

  deleteWorkspaceFiles(workspaceId, filenames) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return;
    const uploadsDir = path.join(ws.folder_path, 'uploads');
    const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
    let existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];

    for (const fn of filenames) {
      const fp = path.join(uploadsDir, fn);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      existing = existing.filter(f => f.filename !== fn);
    }
    fs.writeFileSync(metaPath, JSON.stringify(existing, null, 2));
  }

  // 工作区指示灯计算
  getWorkspaceIndicator(ws, engineStatus) {
    const configPath = path.join(ws.folder_path, 'config.json');
    if (!fs.existsSync(configPath)) return { status: 'red', reason: '配置丢失', canOpen: false };

    if (ws.voice_mode === 'clone') {
      const refDir = path.join(ws.folder_path, 'reference');
      if (!fs.existsSync(refDir) || fs.readdirSync(refDir).length === 0) {
        return { status: 'red', reason: '参考音频缺失', canOpen: false };
      }
    } else if (ws.voice_mode === 'design') {
      if (!ws.voice_instruction?.trim()) return { status: 'red', reason: '语音指令缺失', canOpen: false };
    }

    if (engineStatus === 'idle' || engineStatus === 'busy') return { status: 'green', reason: '引擎运行中', canOpen: true };
    return { status: 'blue', reason: '就绪', canOpen: true };
  }

  // 引擎合约加载
  loadEngineContract(engineDir) {
    const contractPath = path.join(engineDir, 'contract.json');
    if (!fs.existsSync(contractPath)) return null;
    try { return JSON.parse(fs.readFileSync(contractPath, 'utf-8')); }
    catch { return null; }
  }
}

const ttsStudioManager = new TtsStudioManager();
export default ttsStudioManager;
