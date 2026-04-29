import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { ensureDir } from '../utils/fileHelper.js';
import { DB_PATH, CONFIG_FILE, DATA_DIR, MODELS_DIR, DOWNLOADS_DIR } from '../config/constants.js';

class ConfigManager {
  constructor() {
    this.config = null;
    this.db = null;
    this._stmtGet = null;
    this._stmtSet = null;
  }

  async init() {
    await ensureDir(DATA_DIR);
    await ensureDir(MODELS_DIR);
    await ensureDir(DOWNLOADS_DIR);
    await ensureDir(path.join(DOWNLOADS_DIR, 'LLM'));
    await ensureDir(path.join(DOWNLOADS_DIR, 'COMFYUI'));
    await ensureDir(path.join(DOWNLOADS_DIR, 'TTS'));
    await ensureDir(path.join(DOWNLOADS_DIR, 'ASR'));
    await ensureDir(path.join(DATA_DIR, 'logs'));

    this.db = new Database(DB_PATH);

    // 建表（与 modelManager 共用同一个 DB 文件）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 预编译语句
    this._stmtGet = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    this._stmtSet = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    // 加载配置到内存
    const row = this._stmtGet.get('app_config');
    if (row) {
      // DB 中已有配置
      try {
        const parsed = JSON.parse(row.value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.config = parsed;
        } else {
          console.warn('[ConfigDB] 配置格式异常（非对象），重置为默认配置');
          this.config = this.getDefaultConfig();
          this._persist();
        }
      } catch (e) {
        console.error('[ConfigDB] 解析配置失败，使用默认配置:', e.message);
        this.config = this.getDefaultConfig();
        this._persist();
      }
    } else {
      // 尝试从旧 config.json 迁移
      this.config = this._migrateFromJSON() || this.getDefaultConfig();
      this._persist();
    }
  }

  _migrateFromJSON() {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const data = JSON.parse(raw);
      console.log('[ConfigDB] 已从 config.json 迁移配置');
      fs.renameSync(CONFIG_FILE, CONFIG_FILE + '.bak');
      return data;
    } catch (e) {
      console.warn('[ConfigDB] 读取 config.json 失败:', e.message);
      return null;
    }
  }

  _persist() {
    this._stmtSet.run('app_config', JSON.stringify(this.config));
  }

  getDefaultConfig() {
    return {
      theme: 'dark',
      modelscope: {
        organization: 'shoujiekeji',
        cache_ttl: 3600,
        api_token: ''
      },
      external_paths: {
        llamacpp: './external/llamacpp',
        comfyui: './external/comfyui',
        whispercpp: './external/whispercpp',
        indextts2: './external/indextts2'
      },
      ports: {
        llm_range: { start: 8080, end: 8089 },
        llamacpp_range: [8100, 8199],
        comfyui: 8188,
        tts: 7863,
        whisper: 18181
      },
      update_settings: {
        auto_check: true,
        last_check: null,
        channel: 'stable',
        server_url: 'https://api.novamax.com'
      },
      installed_engines: {},
      favorites: []
    };
  }

  async save() {
    this._persist();
  }

  get(key) {
    return key ? this.config[key] : this.config;
  }

  async set(key, value) {
    if (typeof key === 'object') {
      this.config = { ...this.config, ...key };
    } else {
      this.config[key] = value;
    }
    this._persist();
  }
}

export default new ConfigManager();
