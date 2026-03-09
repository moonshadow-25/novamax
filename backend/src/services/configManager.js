import path from 'path';
import { readJSON, writeJSON, ensureDir } from '../utils/fileHelper.js';
import { CONFIG_FILE, DATA_DIR, MODELS_DIR, DOWNLOADS_DIR } from '../config/constants.js';

class ConfigManager {
  constructor() {
    this.config = null;
  }

  async init() {
    await ensureDir(DATA_DIR);
    await ensureDir(MODELS_DIR);
    await ensureDir(DOWNLOADS_DIR);
    await ensureDir(path.join(DOWNLOADS_DIR, 'LLM'));
    await ensureDir(path.join(DOWNLOADS_DIR, 'COMFYUI'));
    await ensureDir(path.join(DOWNLOADS_DIR, 'TTS'));
    await ensureDir(path.join(DOWNLOADS_DIR, 'ASR'));

    this.config = await readJSON(CONFIG_FILE);
    if (!this.config) {
      this.config = this.getDefaultConfig();
      await this.save();
    }
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
        indextts: './external/indextts'
      },
      ports: {
        llamacpp_range: [8100, 8199],
        comfyui: 8188,
        tts: 8200,
        whisper: 8201
      },
      favorites: []
    };
  }

  async save() {
    await writeJSON(CONFIG_FILE, this.config);
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
    await this.save();
  }
}

export default new ConfigManager();
