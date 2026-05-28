# NovaMax TTS 引擎接入规范 v3.0

引擎开发者按此规范提供 `contract.json` 和 `adapter.js`，即可接入 NovaMax。

---

## 1. 架构原则

```
┌──────────────────────────────────────────────────────┐
│  NovaMax                                              │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Voice ID │  │ 工作区    │  │ 任务队列 & 历史     │  │
│  │ 体系     │  │ 管理     │  │                    │  │
│  └────┬─────┘  └────┬─────┘  └─────────┬──────────┘  │
│       │              │                  │             │
│       │     SynthesizeRequest           │             │
│       │     { text, voice, output_format, params }    │
│       │              │                  │             │
│       └──────────────┼──────────────────┘             │
│                      ▼                                │
│              ITtsEngine.synthesize()                   │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────┐
│  引擎目录 (external/tts/{variant}/{version}/)          │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │contract.json │  │ adapter.js   │                  │
│  │(元数据声明)   │  │(ITtsEngine)  │                  │
│  └──────────────┘  └──────┬───────┘                  │
│                           │                           │
│                   引擎内部实现                          │
│                   (HTTP / 子进程 / Python / ...)       │
└──────────────────────────────────────────────────────┘
```

- **NovaMax** 拥有所有业务逻辑——Voice ID、工作区、任务队列、历史记录、文本分割。
- **引擎** 只做一件事：接收文本和 voice 引用，返回音频。
- **adapter.js** 是 NovaMax 和引擎之间的唯一桥梁。引擎内部怎么实现，NovaMax 不关心。

---

## 2. 目录结构

引擎安装后（下载解压）的目录结构：

```
external/tts/{variant-id}/{version}/
├── contract.json          # 必需：引擎元数据声明
├── adapter.js             # 必需：实现 ITtsEngine 接口
├── engine/                # 引擎运行时（Python 环境等，adapter 内部使用）
├── models/                # 模型文件（adapter 内部使用）
├── start.py               # 引擎入口（adapter 内部调用，NovaMax 不关心）
└── ...                    # 其他引擎自有文件
```

---

## 3. contract.json 规范

### 3.1 完整 Schema

```json
{
  "contract_version": "3.0",

  "engine": {
    "type": "string   (必需) 引擎唯一标识，如 'indextts-2'",
    "name": "string   (必需) 显示名称，如 'IndexTTS 2'",
    "version": "string (必需) 引擎版本，语义化，如 '1.0.0'",
    "description": "string (可选) 引擎描述",
    "vendor": "string       (可选) 供应商/维护者"
  },

  "capabilities": {
    "voice_modes": ["string"],
    "max_text_length": "number",
    "output_formats": ["string"],
    "sample_rate": "number",
    "bit_depth": "16 | 24 | 32",
    "channels": "1 | 2",
    "max_output_duration_seconds": "number",
    "supports_streaming": "boolean",
    "supports_cancel": "boolean",
    "supports_runtime_params": "boolean",
    "supports_emotion": "boolean",
    "max_concurrency": "number",
    "config_schema": {}
  },

  "parameters": []
}
```

### 3.2 字段说明

#### engine（引擎标识）

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 引擎唯一标识。NovaMax 用此值区分不同引擎。示例：`"indextts-2"`、`"omnivoice"` |
| `name` | string | 是 | 前端展示的名称。示例：`"IndexTTS 2"` |
| `version` | string | 是 | 引擎自身版本（非 contract 版本）。语义化版本号 |
| `description` | string | 否 | 引擎简介，前端可展示 |
| `vendor` | string | 否 | 维护者名称 |

#### capabilities（能力声明）

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `voice_modes` | string[] | 是 | 支持的 voice 模式。引擎自定义字符串。常见值：`"clone"`（音频克隆）、`"design"`（文本描述）、`"preset"`（预设音色）。NovaMax 不做语义理解 |
| `max_text_length` | number | 是 | 单次 synthesize 调用能处理的最大字符数。NovaMax 在调用前按此值分割文本 |
| `output_formats` | string[] | 是 | 支持的输出格式。常见值：`"wav"`、`"mp3"`、`"flac"`、`"pcm"` |
| `sample_rate` | number | 是 | 输出音频采样率（Hz）。示例：`24000` |
| `bit_depth` | 16\|24\|32 | 是 | 输出位深（bit） |
| `channels` | 1\|2 | 是 | 输出声道数。1=单声道，2=立体声 |
| `max_output_duration_seconds` | number | 是 | 单次 synthesize 最大输出时长（秒）。超过此值引擎可能截断或拒绝 |
| `supports_streaming` | boolean | 是 | 是否支持流式输出。为 true 时 adapter.js 必须实现 `synthesizeStream` |
| `supports_cancel` | boolean | 是 | 是否支持取消正在进行的合成。为 true 时 adapter.js 必须实现 `cancel` |
| `supports_runtime_params` | boolean | 是 | 是否支持运行时更新参数。为 true 时 adapter.js 必须实现 `setParameters` |
| `supports_emotion` | boolean | 是 | 是否支持情感控制 |
| `max_concurrency` | number | 是 | 建议的最大并发 synthesize 调用数。NovaMax 据此控制并发 |

#### parameters（参数定义）

数组，每项定义一个前端控件。NovaMax 根据此列表渲染参数面板，不做语义理解，原样透传值。

```json
{
  "key": "speed",
  "label": "语速",
  "widget": "slider",
  "default": 1.0,
  "description": "播放速度倍率",
  "min": 0.25,
  "max": 4.0,
  "step": 0.05,
  "visible_when": { "key": "other_param", "value": "some_value" }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `key` | string | 是 | 参数键名。NovaMax 透传时以此作为字段名 |
| `label` | string | 是 | 前端显示的标签 |
| `widget` | string | 是 | 控件类型：`slider`、`toggle`、`select`、`text` |
| `default` | any | 是 | 默认值 |
| `description` | string | 否 | 说明文字，鼠标悬停显示 |
| `min` | number | slider 时 | 最小值 |
| `max` | number | slider 时 | 最大值 |
| `step` | number | slider 时 | 步长 |
| `options` | array | select 时 | `[{"label": "显示", "value": "值"}]` |
| `placeholder` | string | text 时 | 输入框占位文字 |
| `visible_when` | object | 否 | 条件可见。`{"key": "K", "value": "V"}` 表示仅当参数 K 的当前值为 V 时显示此参数 |

#### config_schema（引擎配置）

引擎特有的配置项（精度、批大小等），非推理参数。NovaMax 据此渲染引擎设置表单。

```json
{
  "config_schema": {
    "type": "object",
    "properties": {
      "use_fp16": {
        "type": "boolean",
        "title": "半精度推理",
        "default": true,
        "description": "启用 FP16 以降低显存占用"
      },
      "batch_size": {
        "type": "integer",
        "title": "批大小",
        "default": 1,
        "minimum": 1,
        "maximum": 8
      }
    }
  }
}
```

值通过 `EngineInstanceConfig.custom` 传入适配器。

---

## 4. adapter.js 规范

### 4.1 导出约定

```javascript
// adapter.js 必须默认导出一个类
export default class MyEngineAdapter {
  constructor(contract) {
    // contract: contract.json 的解析后对象
    this.meta = contract;
  }

  // ... 实现 ITtsEngine 的全部方法
}
```

或者命名导出：

```javascript
export class TtsEngineAdapter {
  // ...
}
```

### 4.2 接口方法

#### `readonly meta`

返回 `contract.json` 的解析对象。NovaMax 读取 `meta.capabilities.max_text_length` 等。

---

#### `initialize(config: EngineInstanceConfig): Promise<void>`

初始化引擎、加载模型。NovaMax 在首次使用前调用。`dispose()` 之后可以再次调用。

```typescript
interface EngineInstanceConfig {
  modelDir: string;            // 模型文件目录（绝对路径）
  deviceId?: number;           // GPU 设备 ID，-1 表示 CPU
  custom?: Record<string, unknown>;  // config_schema 对应的值
}
```

---

#### `dispose(): Promise<void>`

销毁引擎，释放资源。

- 必须在 30 秒内返回
- 调用后 GPU 显存必须释放
- `dispose()` 之后可以再次 `initialize()`

---

#### `health(): Promise<HealthReport>`

当前健康状态。

```typescript
interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  model_loaded: boolean;       // 模型是否已加载
  gpu_memory_free_mb: number;  // GPU 可用显存（MB），不可知时为 -1
  active_requests: number;     // 当前活跃的合成请求数
  last_error?: string;         // 最后一次错误
  startup_time_ms: number;     // initialize() 耗时（ms）
}
```

---

#### `synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>`

核心方法。接收文本和 voice 引用，返回音频。

```typescript
interface SynthesizeRequest {
  text: string;                      // 待合成文本（单条，NovaMax 已分割）
  voice: Record<string, unknown>;    // voice 引用，内容由 NovaMax Voice 体系决定
  output_format: string;             // 输出格式，来自 meta.output_formats
  params: Record<string, unknown>;   // 引擎参数，来自参数面板，原样透传
}

interface SynthesizeResult {
  requestId: string;       // 唯一请求 ID
  audio: Buffer;           // 音频二进制数据
  duration_seconds: number;// 音频时长
  rtf: number;             // 实时因子（合成耗时/音频时长）
}
```

失败时抛出：

```typescript
interface TtsEngineError {
  code: string;      // INVALID_TEXT | INVALID_VOICE | INVALID_PARAMS | MODEL_NOT_READY
                     // ENGINE_UNAVAILABLE | TEXT_TOO_LONG | GPU_OOM | TIMEOUT | INTERNAL_ERROR
  message: string;
  retryable: boolean;
}
```

---

#### `synthesizeStream?(request: SynthesizeRequest): AsyncIterable<SynthesizeChunk>`

可选。`meta.capabilities.supports_streaming` 为 true 时必须实现。

```typescript
interface SynthesizeChunk {
  audio: Buffer;
  index: number;    // 从 0 递增
  is_final: boolean;// 最后一段
}
```

---

#### `cancel?(requestId: string): Promise<void>`

可选。`meta.capabilities.supports_cancel` 为 true 时必须实现。

---

#### `setParameters?(params: Record<string, unknown>): Promise<void>`

可选。`meta.capabilities.supports_runtime_params` 为 true 时必须实现。

---

### 4.3 Voice 引用说明

`SynthesizeRequest.voice` 是 `Record<string, unknown>`，内容由 NovaMax 的 Voice ID 体系决定。引擎适配器根据自身 `voice_modes` 解析需要的字段。

典型场景：
- clone 模式的 voice 对象可能包含 `mode`、`reference_audio`（文件路径）、`instruction`（参考文本）
- design 模式的 voice 对象可能包含 `mode`、`instruction`（音色描述）
- random 模式的 voice 对象可能只有 `mode`

引擎适配器自行读取需要的字段。NovaMax 不做语义理解，只负责透传。

---

## 5. 完整示例

### contract.json

```json
{
  "contract_version": "3.0",
  "engine": {
    "type": "indextts-2",
    "name": "IndexTTS 2",
    "version": "2.0.0",
    "description": "多语言文本转语音引擎，支持语音克隆和情感控制",
    "vendor": "IndexTTS Team"
  },
  "capabilities": {
    "voice_modes": ["clone", "random"],
    "max_text_length": 4000,
    "output_formats": ["wav", "mp3", "flac"],
    "sample_rate": 24000,
    "bit_depth": 16,
    "channels": 1,
    "max_output_duration_seconds": 120,
    "supports_streaming": false,
    "supports_cancel": false,
    "supports_runtime_params": false,
    "supports_emotion": true,
    "max_concurrency": 1
  },
  "parameters": [
    {
      "key": "speed",
      "label": "语速",
      "widget": "slider",
      "default": 1.0,
      "min": 0.25,
      "max": 4.0,
      "step": 0.05,
      "description": "播放速度倍率"
    },
    {
      "key": "temperature",
      "label": "采样温度",
      "widget": "slider",
      "default": 1.0,
      "min": 0.1,
      "max": 2.0,
      "step": 0.05
    },
    {
      "key": "do_sample",
      "label": "随机采样",
      "widget": "toggle",
      "default": false,
      "description": "关闭则使用贪心解码"
    },
    {
      "key": "infer_mode",
      "label": "推理模式",
      "widget": "select",
      "default": "normal",
      "options": [
        { "label": "标准", "value": "normal" },
        { "label": "快速", "value": "fast" }
      ]
    }
  ],
  "config_schema": {
    "type": "object",
    "properties": {
      "use_fp16": {
        "type": "boolean",
        "title": "半精度推理",
        "default": true,
        "description": "启用 FP16 降低显存占用"
      },
      "workers": {
        "type": "integer",
        "title": "Worker 数",
        "default": 1,
        "minimum": 1,
        "maximum": 4,
        "description": "并发处理数"
      }
    }
  }
}
```

### adapter.js

```javascript
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export default class IndexTTS2Adapter {
  constructor(contract) {
    this.meta = contract;
    this._process = null;
    this._port = null;
    this._baseUrl = null;
    this._initialized = false;
  }

  async initialize(config) {
    if (this._initialized) return;

    // 找可用端口
    this._port = await this._findFreePort();
    this._baseUrl = `http://127.0.0.1:${this._port}`;

    // 找 Python 解释器
    const engineDir = path.dirname(new URL(import.meta.url).pathname);
    const python = this._resolvePython(engineDir);

    // 启动引擎进程
    const args = [
      path.join(engineDir, 'start.py'),
      '--api-port', String(this._port),
      '--model-dir', config.modelDir
    ];

    this._process = spawn(python, args, {
      cwd: engineDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this._process.on('exit', (code) => {
      console.log(`[IndexTTS2] 进程退出, code=${code}`);
    });

    // 等待就绪
    await this._waitReady();
    this._initialized = true;
  }

  async dispose() {
    if (this._process) {
      this._process.kill('SIGTERM');
      setTimeout(() => { try { this._process.kill('SIGKILL'); } catch {} }, 30000);
      this._process = null;
    }
    this._initialized = false;
  }

  async health() {
    if (!this._initialized) {
      return { status: 'unhealthy', model_loaded: false, gpu_memory_free_mb: -1, active_requests: 0, startup_time_ms: 0 };
    }
    try {
      const r = await fetch(`${this._baseUrl}/v1/health`);
      return {
        status: r.ok ? 'healthy' : 'degraded',
        model_loaded: r.ok,
        gpu_memory_free_mb: -1,
        active_requests: 0,
        startup_time_ms: 0
      };
    } catch (e) {
      return { status: 'unhealthy', model_loaded: false, gpu_memory_free_mb: -1, active_requests: 0, startup_time_ms: 0, last_error: e.message };
    }
  }

  async synthesize(request) {
    if (!this._initialized) {
      throw { code: 'MODEL_NOT_READY', message: '引擎未初始化', retryable: true };
    }

    const startTime = Date.now();
    const body = {
      model: this.meta.engine.type,
      input: request.text,
      voice: request.voice.reference_audio || '',
      response_format: request.output_format,
      ...request.params
    };

    const resp = await fetch(`${this._baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw {
        code: resp.status >= 500 ? 'INTERNAL_ERROR' : resp.status === 400 ? 'INVALID_TEXT' : 'ENGINE_UNAVAILABLE',
        message: errText || `HTTP ${resp.status}`,
        retryable: resp.status >= 500
      };
    }

    const audio = Buffer.from(await resp.arrayBuffer());
    const elapsed = (Date.now() - startTime) / 1000;
    const duration = this._estimateDuration(audio);

    return { requestId: `${Date.now()}`, audio, duration_seconds: duration, rtf: duration > 0 ? elapsed / duration : 0 };
  }

  // ---- 私有方法 ----

  _resolvePython(engineDir) {
    const candidates = [
      path.join(engineDir, 'engine', 'python.exe'),
      path.join(engineDir, 'engine', 'Scripts', 'python.exe'),
      path.join(engineDir, 'engine', 'bin', 'python')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error('找不到 Python 解释器');
  }

  _findFreePort() {
    return new Promise((resolve, reject) => {
      const net = require('net');
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
      s.once('error', reject);
    });
  }

  async _waitReady(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await fetch(`${this._baseUrl}/v1/health`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    throw { code: 'TIMEOUT', message: '引擎启动超时', retryable: true };
  }

  _estimateDuration(buf) {
    if (buf.length > 44) {
      const dataSize = buf.readUInt32LE(40);
      const byteRate = buf.readUInt32LE(28);
      if (byteRate > 0) return dataSize / byteRate;
    }
    return buf.length / 48000;
  }
}
```

---

## 6. 验收清单

引擎接入 NovaMax 前，确保以下全部满足：

- [ ] 引擎目录包含 `contract.json`，JSON 格式合法，所有必需字段完整
- [ ] `contract_version` 为 `"3.0"`
- [ ] `capabilities` 中所有字段已填写，值真实反映引擎能力
- [ ] `parameters` 中每个参数的 `key`/`label`/`widget`/`default` 完整
- [ ] 引擎目录包含 `adapter.js`
- [ ] `adapter.js` 导出了默认类或 `TtsEngineAdapter`
- [ ] `initialize()` 可以在 60 秒内完成
- [ ] `dispose()` 可以在 30 秒内返回
- [ ] `synthesize()` 返回的 `SynthesizeResult` 三个字段均有效
- [ ] 错误时抛出 `{ code, message, retryable }` 结构
- [ ] `health()` 返回前模型确实已加载（`model_loaded: true`）
- [ ] 多次 `initialize()` → `dispose()` 循环正常工作
