/**
 * NovaMax TTS Engine Contract v3.0
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
// 1. 引擎适配器接口
// ============================================================================

export interface ITtsEngine {
  readonly meta: EngineMeta;

  // ---- 生命周期 ----

  /**
   * 初始化引擎（加载模型等）。dispose() 后可以再次调用。
   * config 来自 NovaMax 运行时注入 + 引擎 contract.json 的 config_schema。
   */
  initialize(config: EngineInstanceConfig): Promise<void>;

  /**
   * 销毁引擎。必须在 30 秒内返回。正在进行的合成会被丢弃。
   */
  dispose(): Promise<void>;

  /** 当前健康状态 */
  health(): Promise<HealthReport>;

  // ---- 合成 ----

  /**
   * 核心方法。引擎接收文本和 Voice 引用，返回音频。
   * 失败时抛出 TtsEngineError，NovaMax 根据 retryable 决定重试。
   */
  synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>;

  /**
   * 流式合成（可选）。
   * 引擎在 meta.supports_streaming 为 true 时必须实现。
   */
  synthesizeStream?(request: SynthesizeRequest): AsyncIterable<SynthesizeChunk>;
}

// ============================================================================
// 2. 引擎元数据 — contract.json
// ============================================================================

export interface EngineMeta {
  contract_version: '3.0';

  /** 引擎唯一标识 */
  type: string;

  /** 显示名称 */
  name: string;

  /** 语义版本 */
  version: string;

  description?: string;
  vendor?: string;

  // ---- 能力声明 ----

  /** 支持的 voice 模式，引擎自定义字符串，如 "clone" / "design" / "preset" */
  voice_modes: string[];

  /** 单次合成最大字符数 */
  max_text_length: number;

  /** 支持的输出格式 */
  output_formats: string[];

  /** 输出采样率（Hz） */
  sample_rate: number;

  /** 是否有流式 */
  supports_streaming: boolean;

  /** 建议最大并发 */
  max_concurrency: number;

  /**
   * 参数定义列表。NovaMax 据此渲染 UI，不做语义理解。
   * 实际值通过 SynthesizeRequest.params 原样透传。
   */
  parameters?: ParamDef[];

  /**
   * 引擎配置 Schema。NovaMax 据此渲染引擎设置表单。
   * 实际值通过 EngineInstanceConfig.custom 原样透传。
   */
  config_schema?: ConfigSchema;
}

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
// 3. 运行时配置 — NovaMax 注入
// ============================================================================

export interface EngineInstanceConfig {
  /** 模型文件目录（绝对路径） */
  modelDir: string;

  /** GPU 设备 ID，-1 表示 CPU */
  deviceId?: number;

  /** 引擎 config_schema 对应的值，原样透传 */
  custom?: Record<string, unknown>;
}

// ============================================================================
// 4. 合成
// ============================================================================

export interface SynthesizeRequest {
  /** 待合成文本（单条，NovaMax 已做好分割） */
  text: string;

  /**
   * Voice 引用。内容由 NovaMax 的工作区/Voice 体系决定。
   * 引擎根据自身 voice_modes 解析，NovaMax 不做语义理解。
   */
  voice: Record<string, unknown>;

  /** 输出格式，NovaMax 从 meta.output_formats 中选择 */
  output_format: string;

  /**
   * 引擎参数。key-value 来自参数面板，NovaMax 不做语义理解，原样透传。
   */
  params: Record<string, unknown>;
}

export interface SynthesizeResult {
  /** 音频二进制 */
  audio: Buffer;

  /** 音频时长（秒） */
  duration_seconds: number;

  /** RTF（实时因子） */
  rtf: number;
}

export interface SynthesizeChunk {
  audio: Buffer;
  index: number;
  is_final: boolean;
}

// ============================================================================
// 5. 参数定义 — 引擎声明，NovaMax 渲染
// ============================================================================

export type ParamWidget = 'slider' | 'toggle' | 'select' | 'text';

export interface ParamDef {
  key: string;
  label: string;
  widget: ParamWidget;
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
// 6. 健康检查
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthReport {
  status: HealthStatus;
  model_loaded: boolean;
  gpu_memory_free_mb: number;
  active_requests: number;
  last_error?: string;
  startup_time_ms: number;
}

// ============================================================================
// 7. 错误
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
