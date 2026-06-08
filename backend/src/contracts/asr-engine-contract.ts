/**
 * NovaMax ASR Engine Contract v1.0
 *
 * 架构原则：
 *   NovaMax 拥有一切业务逻辑——模型管理、文件管理、转录历史、
 *   任务队列、日志收集。引擎只做一件事：接收音频，返回文本。
 *
 *   引擎适配器不关心：
 *     - 文件怎么上传、怎么管理
 *     - 历史怎么存储、怎么查询
 *     - 任务怎么排队、怎么持久化
 *     - 日志怎么收集、怎么展示
 *
 *   这些都通过 contract.json（元数据）声明，NovaMax 据此路由请求。
 */

// ============================================================================
// 1. contract.json 顶层结构
// ============================================================================

export interface AsrEngineContract {
  contract_version: '1.0';

  /** 引擎元数据 */
  engine: AsrEngineInfo;

  /** 能力声明 */
  capabilities: AsrEngineCapabilities;

  /** 运行时配置（语言默认值、线程数默认值等） */
  runtime_config?: AsrRuntimeConfig;

  /** 显存特征 */
  memory_profile?: AsrMemoryProfile;
}

// ============================================================================
// 2. 引擎基本信息
// ============================================================================

export interface AsrEngineInfo {
  /** 引擎唯一标识，如 "qwen3-asr" */
  type: string;

  /** 显示名称 */
  name: string;

  /** 语义版本 */
  version: string;

  description?: string;
  vendor?: string;
}

// ============================================================================
// 3. 能力声明
// ============================================================================

export interface AsrEngineCapabilities {
  /** 支持的语言列表，如 ["auto", "zh", "en"] */
  supported_languages: string[];

  /** 支持的输出格式 */
  output_formats: string[];

  /** 是否支持流式转录 */
  supports_streaming: boolean;

  /** 是否支持翻译（语音→英文文本） */
  supports_translation: boolean;

  /** 音频采样率（Hz） */
  sample_rate: number;

  /** 最大音频文件大小（MB） */
  max_file_size_mb: number;

  /** 建议最大并发转录数 */
  max_concurrency: number;
}

// ============================================================================
// 4. 运行时配置
// ============================================================================

export interface AsrRuntimeConfig {
  language: AsrConfigEntry<string>;
  threads: AsrConfigEntry<number>;
  model_path?: string;
  server_script?: string;
  python_search_paths?: string[];
}

export interface AsrConfigEntry<T> {
  default: T;
  description?: string;
}

// ============================================================================
// 5. 显存特征
// ============================================================================

export interface AsrMemoryProfile {
  base_vram_mb: number;
  supports_clear_cache: boolean;
  supports_memory_info: boolean;
}

// ============================================================================
// 6. 引擎适配器接口 (IAsrEngine)
// ============================================================================

export interface IAsrEngine {
  readonly meta: AsrEngineContract;

  // ---- 回调（由 engineWorker 设置，供 adapter 调用） ----
  onStdout: ((line: string) => void) | null;
  onStderr: ((line: string) => void) | null;

  // ---- 生命周期 ----
  initialize(config: AsrEngineInstanceConfig): Promise<void>;
  dispose(): Promise<void>;
  health(): Promise<AsrHealthReport>;

  // ---- 转录 ----
  transcribe(audioPath: string, params: AsrTranscribeParams): Promise<AsrTranscriptionResult>;
  transcribeStream?(audioPath: string, params: AsrTranscribeParams, onDelta: (delta: AsrTranscriptionDelta) => void): Promise<AsrTranscriptionResult>;

  // ---- 翻译 ----
  translate?(audioPath: string, params: AsrTranslateParams): Promise<AsrTranscriptionResult>;
  translateStream?(audioPath: string, params: AsrTranslateParams, onDelta: (delta: AsrTranscriptionDelta) => void): Promise<AsrTranscriptionResult>;

  // ---- 可选方法 ----
  getPid?(): number | null;
  getPort?(): number | null;
}

// ============================================================================
// 7. 引擎实例配置（NovaMax → adapter.initialize）
// ============================================================================

export interface AsrEngineInstanceConfig {
  modelFilePath: string;
  language?: string;
  threads?: number;
  enginePath?: string;
  enableVad?: boolean;
  vadFilePath?: string;
}

// ============================================================================
// 8. 转录参数
// ============================================================================

export interface AsrTranscribeParams {
  language?: string;
  response_format?: string;
  temperature?: number;
  prompt?: string;
  stream?: boolean;
  vad_filter?: boolean;
}

export interface AsrTranslateParams {
  temperature?: number;
  prompt?: string;
  stream?: boolean;
}

// ============================================================================
// 9. 转录结果
// ============================================================================

export interface AsrTranscriptionResult {
  text: string;
  language?: string;
  segments?: AsrTranscriptionSegment[];
}

export interface AsrTranscriptionSegment {
  text: string;
  start: number;
  end: number;
}

export interface AsrTranscriptionDelta {
  text: string;
  _final?: boolean;
}

// ============================================================================
// 10. 健康检查
// ============================================================================

export type AsrHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface AsrHealthReport {
  status: AsrHealthStatus;
  model_loaded?: boolean;
}

// ============================================================================
// 11. 错误码
// ============================================================================

export type AsrEngineErrorCode =
  | 'PYTHON_NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'ENGINE_NOT_FOUND'
  | 'ENGINE_CRASH'
  | 'ENGINE_START_TIMEOUT'
  | 'ENGINE_ERROR'
  | 'ENGINE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface AsrEngineError {
  code: AsrEngineErrorCode;
  message: string;
}
