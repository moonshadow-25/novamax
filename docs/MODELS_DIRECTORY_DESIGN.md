# NovaMax 模型目录结构设计

## 设计目标

基于 llama.cpp 的 `--models-dir` 特性，设计一个能够高效管理多个模型的目录结构和配置系统。

## 推荐的目录结构

```
data/
├─ models/                          # 模型元数据配置（保留现有系统）
│  ├─ llm.json
│  ├─ comfyui.json
│  ├─ tts.json
│  └─ whisper.json
│
├─ models_dir/                      # llama-server --models-dir 指向这里
│  ├─ llm/                          # LLM 模型目录
│  │  ├─ Qwen3.5-35B-A3B-GGUF/     # 多文件模型（multimodal）
│  │  │  ├─ Qwen3.5-35B-A3B-Q8_0.gguf
│  │  │  └─ mmproj-Qwen_Qwen3.5-35B-A3B-bf16.gguf
│  │  │
│  │  ├─ llama-3.2-1B-Q4_K_M.gguf  # 单文件模型
│  │  └─ gemma-7B-Q8_0.gguf
│  │
│  ├─ tts/                          # TTS 模型目录
│  └─ whisper/                      # Whisper 模型目录
│
├─ presets/                         # 模型预设配置（INI 格式）
│  ├─ llm.ini                       # LLM 模型预设
│  ├─ tts.ini
│  └─ whisper.ini
│
└─ downloads/                       # 临时下载目录（保留现有）
   ├─ llm/
   ├─ tts/
   └─ whisper/
```

## 核心改进

### 1. 分离下载目录和运行目录

**现状问题**：
- 下载目录 `data/downloads/{type}/{modelId}` 与运行目录混在一起
- llama-server 需要明确的模型路径

**解决方案**：
- `data/downloads/` - 临时下载目录，下载完成后移动
- `data/models_dir/` - 运行时目录，llama-server 从这里加载

**下载完成后的处理**：
```javascript
// downloadService.js 中下载完成后
async _onDownloadComplete(model, downloadState) {
  const downloadDir = path.join(DOWNLOADS_DIR, model.type, model.id);
  const modelsDir = path.join(MODELS_RUN_DIR, model.type, model.id);

  // 移动到运行目录
  await fs.promises.rename(downloadDir, modelsDir);

  // 更新模型配置
  model.downloaded = true;
  model.model_path = modelsDir;
}
```

### 2. INI 预设配置（替代 JSON parameters）

**优势**：
- llama-server 原生支持 INI 格式
- 更清晰的层级配置（全局 + 特定模型）
- 支持环境变量和简写参数

**示例：`data/presets/llm.ini`**
```ini
version = 1

; 全局默认配置（适用于所有 LLM）
[*]
ctx-size = 8192
gpu-layers = -1
threads = 8
parallel = 2
batch = 512
ubatch = 512
temperature = 0.7
top-p = 0.9
top-k = 40
repeat-penalty = 1.1

; 特定模型配置（覆盖全局）
[Qwen3.5-35B-A3B-GGUF]
model = C:/Users/xh/wk/novamax/data/models_dir/llm/Qwen3.5-35B-A3B-GGUF/Qwen3.5-35B-A3B-Q8_0.gguf
mmproj = C:/Users/xh/wk/novamax/data/models_dir/llm/Qwen3.5-35B-A3B-GGUF/mmproj-Qwen_Qwen3.5-35B-A3B-bf16.gguf
ctx-size = 131072
alias = qwen3.5-35b

[llama-3.2-1B]
model = C:/Users/xh/wk/novamax/data/models_dir/llm/llama-3.2-1B-Q4_K_M.gguf
ctx-size = 4096
gpu-layers = 20
```

### 3. 启动命令改进

**单模型模式（当前）**：
```bash
llama-server -m path/to/model.gguf --ctx-size 8192 --gpu-layers -1 ...
```

**多模型路由模式（推荐）**：
```bash
llama-server --models-dir C:/Users/xh/wk/novamax/data/models_dir/llm --models-preset C:/Users/xh/wk/novamax/data/presets/llm.ini
```

**优势**：
- 一次启动，动态加载多个模型
- 通过 API 控制模型加载/卸载
- 减少内存占用（按需加载）

## 文件命名规范

### 单文件模型
- 直接放在类型目录下
- 文件名即模型 ID
- 示例：`data/models_dir/llm/Qwen3-8B-Q4_K_M.gguf`

### 多文件模型（multimodal）
- 创建子目录，目录名即模型 ID
- 主模型文件：`{modelId}.gguf`
- mmproj 文件：必须以 `mmproj` 开头，如 `mmproj-F16.gguf`
- 示例：
  ```
  data/models_dir/llm/gemma-3-4b-it-Q8_0/
    ├─ gemma-3-4b-it-Q8_0.gguf
    └─ mmproj-F16.gguf
  ```

### 多分片模型（multi-shard）
- 创建子目录
- 分片文件命名：`{modelId}-00001-of-00006.gguf`
- llama.cpp 会自动合并
- 示例：
  ```
  data/models_dir/llm/Kimi-K2-35B/
    ├─ Kimi-K2-35B-00001-of-00004.gguf
    ├─ Kimi-K2-35B-00002-of-00004.gguf
    ├─ Kimi-K2-35B-00003-of-00004.gguf
    └─ Kimi-K2-35B-00004-of-00004.gguf
  ```

## 配置版本控制策略

### 三层配置系统

1. **默认配置（INI [*] 部分）**
   - 全局默认值
   - 适用于所有模型

2. **模型预设（INI 特定模型部分）**
   - 管理员定义的模型特定配置
   - 覆盖全局默认

3. **用户参数（数据库/JSON）**
   - 用户自定义配置
   - 优先级最高

### 版本更新机制

**INI 文件版本控制**：
```ini
version = 2

[*]
; version 2 新增参数
flash-attn = auto
cache-reuse = 1024
```

**检测逻辑**：
```javascript
// parameterService.js
getEffectiveParameters(model) {
  const iniVersion = this._loadIniVersion(model.type);
  const userVersion = model.user_parameters_version || '0.0.0';

  if (this._compareVersions(iniVersion, userVersion) > 0) {
    // INI 版本更新，重置用户参数
    return this._loadFromIni(model);
  }

  // 合并用户参数
  return this._mergeParameters(model);
}
```

## API 路由改进

### 当前 NovaMax API
```
POST /api/backends/start/:modelId
GET  /api/parameters/:modelId
PUT  /api/parameters/:modelId
```

### 集成 llama-server 路由模式

**启动模型（使用路由）**：
```javascript
// backendService.js
async start(modelId) {
  // 1. 加载模型到 llama-server
  await axios.post('http://localhost:8100/models/load', {
    model: modelId
  });

  // 2. 验证模型已加载
  const status = await axios.get(`http://localhost:8100/models`);
  const modelStatus = status.data.data.find(m => m.id === modelId);

  if (modelStatus?.status?.value === 'loaded') {
    return { success: true };
  }
}
```

**停止模型**：
```javascript
async stop(modelId) {
  await axios.post('http://localhost:8100/models/unload', {
    model: modelId
  });
}
```

**查询模型状态**：
```javascript
async getStatus() {
  const response = await axios.get('http://localhost:8100/models');
  return response.data.data.map(model => ({
    id: model.id,
    status: model.status.value, // 'loaded', 'unloaded', 'loading'
    args: model.status.args
  }));
}
```

## 实施步骤

### Phase 1: 目录结构迁移
1. 创建 `data/models_dir/{type}/` 目录
2. 修改 downloadService.js，下载完成后移动到 models_dir
3. 更新 modelManager.js，从 models_dir 读取模型路径

### Phase 2: INI 配置生成
1. 创建 presetService.js
2. 从现有 JSON parameters 生成 INI 文件
3. 实现 INI 文件读写和版本管理

### Phase 3: llama-server 集成
1. 修改 llmRunner.js，使用路由模式启动
2. 更新 backendService.js，使用 /models/load 和 /models/unload API
3. 实现健康检查和状态监控

### Phase 4: 前端适配
1. 更新模型卡片，显示路由模式状态
2. 支持多模型同时运行
3. 资源监控（显示已加载模型数量和内存占用）

## 示例配置文件

### data/presets/llm.ini
```ini
version = 1.0.0

; ===== 全局默认配置 =====
[*]
; 运行时参数
ctx-size = 8192
gpu-layers = -1
threads = 8
parallel = 2
batch = 512
ubatch = 512
flash-attn = auto
cache-reuse = 1024

; 采样参数
temperature = 0.7
top-p = 0.9
top-k = 40
repeat-penalty = 1.1

; 服务器参数
port = 8100
host = 127.0.0.1
timeout = 600

; ===== Qwen 3.5 35B 配置 =====
[shoujiekeji_Qwen3.5-35B-A3B-GGUF]
model = C:/Users/xh/wk/novamax/data/models_dir/llm/shoujiekeji_Qwen3.5-35B-A3B-GGUF/Qwen3.5-35B-A3B-Q8_0.gguf
mmproj = C:/Users/xh/wk/novamax/data/models_dir/llm/shoujiekeji_Qwen3.5-35B-A3B-GGUF/mmproj-Qwen_Qwen3.5-35B-A3B-bf16.gguf
alias = qwen3.5-35b
ctx-size = 131072
load-on-startup = false
stop-timeout = 10

; ===== 其他模型示例 =====
[llama-3.2-1B]
model = C:/Users/xh/wk/novamax/data/models_dir/llm/llama-3.2-1B-Q4_K_M.gguf
ctx-size = 4096
gpu-layers = 20
temperature = 0.8
```

## 兼容性说明

### 向后兼容
- 保留现有 JSON 配置系统
- 新旧系统并行运行
- 逐步迁移用户参数到 INI

### 迁移路径
1. 第一次启动时检测 INI 文件是否存在
2. 如果不存在，从 JSON 生成 INI
3. 用户参数仍存储在数据库中
4. 启动时合并 INI + 用户参数

## 性能优化

### 按需加载（Lazy Loading）
- 使用 `load-on-startup = false` 控制
- 第一次请求时自动加载
- 空闲时自动卸载（`--sleep-idle-seconds`）

### 资源限制
```ini
[*]
; 最多同时加载 2 个模型
models-max = 2
```

### 内存优化
```ini
[large_model]
; 大模型使用量化 KV cache
cache-type-k = q8_0
cache-type-v = q8_0
```

## 总结

这个设计方案：
1. ✅ 遵循 llama.cpp 官方最佳实践
2. ✅ 支持多模型动态加载
3. ✅ 清晰的目录结构（下载、运行分离）
4. ✅ 灵活的配置系统（全局 + 模型 + 用户）
5. ✅ 向后兼容现有系统
6. ✅ 为未来扩展预留空间（TTS、Whisper）
