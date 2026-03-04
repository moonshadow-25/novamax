import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MODEL_TYPES = {
  LLM: 'llm',
  COMFYUI: 'comfyui',
  TTS: 'tts',
  WHISPER: 'whisper'
};

export const MODEL_STATUS = {
  STOPPED: 'stopped',
  RUNNING: 'running',
  STARTING: 'starting',
  ERROR: 'error'
};

export const DOWNLOAD_STATUS = {
  PENDING: 'pending',
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

export const DEFAULT_PORTS = {
  LLAMACPP_START: 8100,
  LLAMACPP_END: 8199,
  COMFYUI: 8188,
  TTS: 8200,
  WHISPER: 8201
};

// 使用绝对路径，从项目根目录开始
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
export { PROJECT_ROOT };
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const MODELS_DIR = path.join(PROJECT_ROOT, 'data', 'models');
export const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'data', 'downloads');
export const MODELS_RUN_DIR = path.join(PROJECT_ROOT, 'data', 'models_dir');
export const PRESETS_DIR = path.join(PROJECT_ROOT, 'data', 'presets');
export const CONFIG_FILE = path.join(PROJECT_ROOT, 'data', 'config.json');
