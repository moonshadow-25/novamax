import path from 'path';
import os from 'os';
import { getProjectRoot } from '../utils/pathHelper.js';

export const MODEL_TYPES = {
  LLM: 'llm',
  COMFYUI: 'comfyui',
  TTS: 'tts',
  ASR: 'asr'
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
  ASR: 0  // 0 = 引擎自行分配动态端口
};

// 使用绝对路径，从项目根目录开始（用于 external 工具等）
const PROJECT_ROOT = getProjectRoot();
export { PROJECT_ROOT };

//  Windows 目录联接（Junction）示例：
// 1. 创建一个新的目录作为数据目录（如果不存在）
//    mkdir C:\novastudio_data
// 2. 创建一个联接，将 ~/.novastudio 指向新的数据目录
//    mklink /J C:\Users\YourUsername\.novastudio C:\novastudio_data
// 数据目录：项目根目录下的 data 文件夹
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'novamax.db');
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const MODELS_RUN_DIR = path.join(DATA_DIR, 'models_dir');
export const PRESETS_DIR = path.join(DATA_DIR, 'presets');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const DOWNLOAD_STATE_FILE = path.join(DATA_DIR, 'download_state.json');
export const GPUINFO_PATH = path.join(PROJECT_ROOT, 'scripts', 'gpuinfo.exe');

// ===== TTS 模块常量 =====
export const TTS_DATA_DIR = path.join(DATA_DIR, 'tts_services');
export const TTS_DB_PATH = path.join(TTS_DATA_DIR, 'tts.db');
export const TTS_CONFIG_PATH = path.join(TTS_DATA_DIR, 'config.json');
export const TTS_ENGINES_DIR = path.join(PROJECT_ROOT, 'external', 'tts');
export const TTS_VOICES_DIR = path.join(TTS_DATA_DIR, 'voices');
export const TTS_WORKSPACES_DIR = path.join(TTS_DATA_DIR, 'workspaces');
export const TTS_REF_AUDIO_DIR = path.join(TTS_DATA_DIR, 'reference_audio');
export const TTS_HISTORY_DIR = path.join(TTS_DATA_DIR, 'history');
export const TTS_LOGS_DIR = path.join(DATA_DIR, 'logs');
export const FFMPEG_DIR = path.join(PROJECT_ROOT, 'external', 'ffmpeg');
export const TTS_PID_DIR = TTS_DATA_DIR;

// TTS 默认配置
export const TTS_DEFAULTS = {
  LOG_MAX_ENTRIES: 2000,
  LOG_RETENTION_DAYS: 7,
  IDLE_TIMEOUT_MINUTES: 5,
  IDLE_CHECK_INTERVAL_MS: 30000,
  IDLE_MIN_MINUTES: 3,
  IDLE_MAX_MINUTES: 30,
  VOICE_ID_LENGTH: 6,
  RECONNECT_DELAY_MS: 3000,
  MAX_UPLOAD_SIZE_BYTES: 100 * 1024 * 1024,
  MAX_BATCH_FILES: 20,
  MAX_TEXT_LENGTH_FALLBACK: 4000,
};

// ===== ASR 模块常量 =====
export const ASR_ENGINE_DIR = path.join(PROJECT_ROOT, 'external', 'asr');
export const ASR_DATA_DIR = path.join(DATA_DIR, 'asr_services');
export const ASR_MODELS_DIR = path.join(MODELS_RUN_DIR, 'asr');
export const ASR_HISTORY_DB = path.join(ASR_DATA_DIR, 'transcription_history.db');
export const ASR_SHARED_MODEL_ID = '__shared__';
export const ASR_PID_DIR = ASR_DATA_DIR;

// ASR 默认配置
export const ASR_DEFAULTS = {
  LOG_MAX_ENTRIES: 2000,
  LOG_RETENTION_DAYS: 7,
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  IDLE_CHECK_INTERVAL_MS: 30000,
  HISTORY_PAGE_SIZE: 20,
  LOG_FETCH_LIMIT: 500,
  MAX_FILE_SIZE_MB: 500,
  HEALTH_POLL_MAX_MS: 90000,
  HEALTH_POLL_INTERVAL_MS: 1000,
  TRANSCRIBE_TIMEOUT_MS: 7200000,
  RECONNECT_DELAY_MS: 3000,
  DEFAULT_LANGUAGE: 'auto',
  DEFAULT_THREADS: 4,
};

/**
 * 参数映射：LLM 模型的默认参数（与 llama-server 路由模式兼容）
 * 注意：远端配置使用 default_parameters，本地配置使用 parameters 字段
 * 这样可以避免直接覆盖用户参数，同时保持与远端配置的兼容性
 */ 
export const DEFAULT_LLM_PARAMETERS = {
  version: '1.0.0',
  context_length: 0,
  port: 1234,
  parallel: 1,
  'load-mode': 'none',
  'n-gpu-layers': 100,
  temperature: 0.8,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.1,
  reasoning: 'off'
};

/**
 * 已弃用的 llama-server 参数（被新参数替代）
 *
 * 加入此集合的参数会被 presetService（INI 生成）和 llmRunner（CLI 构建）
 * 两处输出端自动跳过，不会写入 llm.ini 或命令行。
 *
 * INI 文件每次是全量重建后覆盖写入，旧参数不会残留。
 * 数据库里存的旧值无需清理，输出时被拦截即可。
 */
export const DEPRECATED_LLM_PARAMS = new Set(['no-mmap']);
