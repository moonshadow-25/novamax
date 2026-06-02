/**
 * NovaMax TTS Engine Contract v5.0
 *
 * 架构原则：
 *   NovaMax 拥有一切业务逻辑——Voice ID 体系、工作区、任务队列、
 *   参数面板渲染、文件管理、历史记录。引擎只做一件事：把文本变成音频。
 *
 *   引擎适配器不关心：
 *     - 参数是什么、怎么调、怎么展示
 *     - Voice 怎么注册、怎么管理
 *     - 任务怎么排队、怎么持久化
 *     - 文本怎么分割、怎么批处理
 *
 *   这些都通过 contract.json（元数据）声明，NovaMax 渲染 UI 并原样透传。
 */

// ============================================================================
// 1. contract.json 顶层结构
// ============================================================================

export interface EngineContract {
  contract_version: '5.0';

  engine: EngineInfo;
  capabilities: EngineCapabilities;
  api_endpoints?: EngineApiEndpoints;
  runtime_config?: Record<string, RuntimeConfigField>;
  memory_profile?: MemoryProfile;
  parameters?: { flat?: ParamDef[] } | ParamDef[];
  config_schema?: ConfigSchema;
}

// ============================================================================
// 2. 引擎基本信息
// ============================================================================

export interface EngineInfo {
  type: string;
  name: string;
  version: string;
  description?: string;
  vendor?: string;
  entry_point?: string;
  env?: Record<string, string>;
}

export interface EngineApiEndpoints {
  health?: string;
  speech?: string;
  clear_cache?: string;
  memory?: string;
  config?: string;
}

// ============================================================================
// 3. 能力声明
// ============================================================================

export interface EngineCapabilities {
  /** 支持的 voice 模式 */
  voice_modes: string[];

  /** 单次合成最大字符数 */
  max_text_length: number;

  /** 支持的输出格式 */
  output_formats: string[];

  /** 输出采样率（Hz） */
  sample_rate: number;

  /** 位深度 */
  bit_depth?: number;

  /** 声道数 */
  channels?: number;

  /** 单次合成最大输出时长（秒） */
  max_output_duration_seconds?: number;

  /** 是否支持流式 */
  supports_streaming: boolean;

  /** 是否支持取消 */
  supports_cancel?: boolean;

  /** 是否支持运行时参数变更 */
  supports_runtime_params?: boolean;

  /** 是否支持情感控制 */
  supports_emotion?: boolean;

  /** 建议最大并发 */
  max_concurrency: number;
}

// ============================================================================
// 4. 运行时配置
// ============================================================================

export interface RuntimeConfigField {
  default: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  description?: string;
}

// ============================================================================
// 5. 显存特征
// ============================================================================

export interface MemoryProfile {
  base_vram_mb: number;
  supports_clear_cache: boolean;
  supports_memory_info: boolean;
}

// ============================================================================
// 6. 引擎适配器接口 (ITtsEngine)
// ============================================================================

export interface ITtsEngine {
  readonly meta: EngineContract;

  // ---- 生命周期 ----

  initialize(config: EngineInstanceConfig): Promise<void>;
  dispose(): Promise<void>;
  health(): Promise<HealthReport>;

  // ---- 合成 ----

  synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>;
  synthesizeStream?(request: SynthesizeRequest): AsyncIterable<SynthesizeChunk>;

  // ---- 可选方法 ----

  clearCache?(): Promise<void>;
  getMemoryInfo?(): Promise<MemoryInfo>;
  getPid?(): Promise<number | null>;
  getPort?(): Promise<number | null>;
  setRuntimeConfig?(key: string, value: unknown): Promise<void>;
}

// ============================================================================
// 7. 运行时配置 — NovaMax 注入
// ============================================================================

export interface EngineInstanceConfig {
  modelDir: string;
  deviceId?: number;
  custom?: Record<string, unknown>;
}

// ============================================================================
// 8. 合成
// ============================================================================

export interface SynthesizeRequest {
  text: string;
  voice: Record<string, unknown>;
  output_format: string;
  output_dir?: string;
  workspace_id?: string;
  request_id?: string;
  params: Record<string, unknown>;
}

export interface SynthesizeResult {
  audio: Buffer;
  duration_seconds: number;
  rtf: number;
  output_path?: string;
}

export interface SynthesizeChunk {
  audio: Buffer;
  index: number;
  is_final: boolean;
}

// ============================================================================
// 9. 参数定义 — 引擎声明，NovaMax 渲染
// ============================================================================

export type ParamWidget = 'slider' | 'toggle' | 'select' | 'text';

export interface ParamDef {
  key: string;
  label: string;
  widget: ParamWidget;
  type?: 'float' | 'int' | 'bool' | 'select';
  default: unknown;
  description?: string;

  // slider
  min?: number;
  max?: number;
  step?: number;

  // select
  options?: Array<{ label: string; value: string }>;

  // text
  placeholder?: string;

  /** 条件可见：key === value 时显示 */
  visible_when?: { key: string; value: unknown };
}

// ============================================================================
// 10. 引擎配置 Schema
// ============================================================================

export interface ConfigSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, ConfigProperty>;
}

export interface ConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'integer';
  title: string;
  default: unknown;
  minimum?: number;
  maximum?: number;
  description?: string;
  enum?: Array<string | number | boolean>;
}

// ============================================================================
// 11. 健康检查
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthReport {
  status: HealthStatus;
  model_loaded: boolean;
  gpu_memory_free_mb?: number;
  gpu_memory_total_mb?: number;
  active_requests: number;
  startup_time_ms: number;
  last_error?: string;
}

// ============================================================================
// 12. 显存信息
// ============================================================================

export interface MemoryInfo {
  vram_used_mb: number;
  vram_total_mb: number;
  shared_used_mb: number;
  shared_total_mb: number;
  ram_used_mb?: number;
  ram_total_mb?: number;
}

// ============================================================================
// 13. 错误
// ============================================================================

export type EngineErrorCode =
  | 'INVALID_TEXT'
  | 'INVALID_VOICE'
  | 'INVALID_PARAMS'
  | 'MODEL_NOT_READY'
  | 'ENGINE_UNAVAILABLE'
  | 'TEXT_TOO_LONG'
  | 'GPU_OOM'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export interface TtsEngineError {
  code: EngineErrorCode;
  message: string;
  retryable: boolean;
}
