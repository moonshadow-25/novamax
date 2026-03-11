import path from 'path';
import os from 'os';
import { getProjectRoot } from '../utils/pathHelper.js';

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

// 使用绝对路径，从项目根目录开始（用于 external 工具等）
const PROJECT_ROOT = getProjectRoot();
export { PROJECT_ROOT };

//  Windows 目录联接（Junction）示例：
// 1. 创建一个新的目录作为数据目录（如果不存在）
//    mkdir C:\novastudio_data
// 2. 创建一个联接，将 ~/.novastudio 指向新的数据目录
//    mklink /J C:\Users\YourUsername\.novastudio C:\novastudio_data
// 用户数据目录：~/.novastudio
// export const DATA_DIR = 'C:\\linglong';
export const DATA_DIR = path.join(os.homedir(), '.novastudio');
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
export const MODELS_RUN_DIR = path.join(DATA_DIR, 'models_dir');
export const PRESETS_DIR = path.join(DATA_DIR, 'presets');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
