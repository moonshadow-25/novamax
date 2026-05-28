/**
 * TTS Voice Manager — NovaMax 自有 Voice ID 体系
 *
 * 设计：
 *   Voice ID 是 NovaMax 内部唯一标识，与任何引擎解耦。
 *   合成前，NovaMax 根据 Voice ID 解析出 VoiceReference (Record<string, unknown>)，
 *   原样传入 SynthesizeRequest.voice 透传给引擎适配器。
 *
 * Voice ID 支持的来源：
 *   - 参考音频文件（clone 模式）→ reference_audio: 文件路径
 *   - 文本描述（design 模式）  → instruction: 描述文本
 *   - 随机（random 模式）       → 无额外数据
 *
 * 存储：
 *   - 数据库表 tts_voices
 *   - 音频文件存储在 data/tts_voices/
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { PROJECT_ROOT } from '../config/constants.js';
import configManager from './configManager.js';

const VOICES_DIR = path.join(PROJECT_ROOT, 'data', 'tts_voices');
const genId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;

class TtsVoiceManager {
  constructor() {
    this.db = null;
    this._initialized = false;
  }

  /* ========================================================================
   * 初始化
   * ======================================================================== */

  init() {
    if (this._initialized) return;
    this.db = configManager.db;
    if (!this.db) {
      console.error('[TtsVoiceManager] db is null, init skipped');
      return;
    }
    this._migrate();
    fs.mkdirSync(VOICES_DIR, { recursive: true });
    this._initialized = true;
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tts_voices (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        voice_mode      TEXT NOT NULL DEFAULT 'clone',
        reference_audio_path TEXT,
        instruction     TEXT,
        emotion_preset  TEXT DEFAULT '{}',
        engine_meta     TEXT DEFAULT '{}',
        tags            TEXT DEFAULT '[]',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
    `);
  }

  /* ========================================================================
   * CRUD
   * ======================================================================== */

  /**
   * 注册一个新 Voice。
   * @param {object} opts
   * @param {string} opts.name
   * @param {'clone'|'design'|'random'} opts.mode
   * @param {string} [opts.referenceAudioPath] - clone 模式：已有音频文件路径
   * @param {Buffer} [opts.referenceAudioBuffer] - clone 模式：上传的音频 buffer
   * @param {string} [opts.originalFilename] - 原始文件名（保留扩展名）
   * @param {string} [opts.instruction] - design 模式：描述文本
   * @param {object} [opts.emotionPreset]
   * @param {object} [opts.engineMeta] - 引擎特定元数据，透传
   * @param {string[]} [opts.tags]
   */
  create(opts) {
    this._ensureInit();
    const id = genId('voice');
    const now = new Date().toISOString();

    let refPath = null;
    if (opts.mode === 'clone') {
      if (opts.referenceAudioPath) {
        // 引用已有文件：复制到 voice 目录
        const ext = path.extname(opts.referenceAudioPath);
        refPath = path.join(VOICES_DIR, `${id}${ext}`);
        fs.copyFileSync(opts.referenceAudioPath, refPath);
      } else if (opts.referenceAudioBuffer) {
        const ext = opts.originalFilename ? path.extname(opts.originalFilename) : '.wav';
        refPath = path.join(VOICES_DIR, `${id}${ext}`);
        fs.writeFileSync(refPath, opts.referenceAudioBuffer);
      }
    }

    this.db.prepare(`INSERT INTO tts_voices
      (id, name, voice_mode, reference_audio_path, instruction, emotion_preset, engine_meta, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, opts.name, opts.mode, refPath,
        opts.instruction || null,
        JSON.stringify(opts.emotionPreset || {}),
        JSON.stringify(opts.engineMeta || {}),
        JSON.stringify(opts.tags || []),
        now, now);

    return this.get(id);
  }

  /** 分页列表 */
  list(page = 1, pageSize = 20, search) {
    this._ensureInit();
    let where = '1=1';
    const params = [];
    if (search) { where += ' AND name LIKE ?'; params.push(`%${search}%`); }

    const total = this.db.prepare(`SELECT COUNT(*) as c FROM tts_voices WHERE ${where}`).get(...params)?.c || 0;
    const offset = (page - 1) * pageSize;
    const items = this.db.prepare(`SELECT * FROM tts_voices WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(this._deserialize);
    return { items, total, page, page_size: pageSize };
  }

  /** 列举所有（不分页，供下拉等场景） */
  all() {
    this._ensureInit();
    return this.db.prepare('SELECT * FROM tts_voices ORDER BY created_at DESC').all().map(this._deserialize);
  }

  get(id) {
    this._ensureInit();
    const row = this.db.prepare('SELECT * FROM tts_voices WHERE id = ?').get(id);
    return row ? this._deserialize(row) : null;
  }

  update(id, fields) {
    this._ensureInit();
    const existing = this.get(id);
    if (!existing) throw new Error(`Voice ${id} 不存在`);

    const sets = [];
    const params = [];
    if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
    if (fields.instruction !== undefined) { sets.push('instruction = ?'); params.push(fields.instruction); }
    if (fields.emotionPreset !== undefined) { sets.push('emotion_preset = ?'); params.push(JSON.stringify(fields.emotionPreset)); }
    if (fields.engineMeta !== undefined) { sets.push('engine_meta = ?'); params.push(JSON.stringify(fields.engineMeta)); }
    if (fields.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(fields.tags)); }

    if (sets.length === 0) return existing;
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.prepare(`UPDATE tts_voices SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.get(id);
  }

  remove(id) {
    this._ensureInit();
    const voice = this.get(id);
    if (!voice) return;
    if (voice.reference_audio_path && fs.existsSync(voice.reference_audio_path)) {
      fs.unlinkSync(voice.reference_audio_path);
    }
    this.db.prepare('DELETE FROM tts_voices WHERE id = ?').run(id);
  }

  /* ========================================================================
   * Voice ID → VoiceReference 解析
   * ======================================================================== */

  /**
   * 将 NovaMax Voice ID 解析为引擎无关的 VoiceReference。
   * 引擎适配器收到后自行解析需要的字段。
   *
   * @param {string} voiceId
   * @returns {Record<string, unknown>}
   */
  resolve(voiceId) {
    const voice = this.get(voiceId);
    if (!voice) throw new Error(`Voice ${voiceId} 不存在`);

    return {
      mode: voice.voice_mode,
      reference_audio: voice.reference_audio_path || undefined,
      instruction: voice.instruction || undefined,
      emotion_preset: voice.emotion_preset || undefined,
      engine_meta: voice.engine_meta || undefined
    };
  }

  /* ========================================================================
   * 内部
   * ======================================================================== */

  _ensureInit() { if (!this._initialized) this.init(); }

  _deserialize(row) {
    return {
      ...row,
      emotion_preset: JSON.parse(row.emotion_preset || '{}'),
      engine_meta: JSON.parse(row.engine_meta || '{}'),
      tags: JSON.parse(row.tags || '[]')
    };
  }
}

const ttsVoiceManager = new TtsVoiceManager();
export default ttsVoiceManager;
