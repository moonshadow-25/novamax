# NovaMax Backend API 文档

**Base URL**: `http://localhost:3001/api`  
**Content-Type**: `application/json`（文件上传接口除外）

---

## 目录

- [通用](#通用)
- [模型管理 /models](#模型管理-models)
- [后端进程 /backend](#后端进程-backend)
- [LLM 推理 /llm](#llm-推理-llm)
- [下载管理 /download](#下载管理-download)
- [参数管理 /parameters](#参数管理-parameters)
- [引擎管理 /engines](#引擎管理-engines)
- [ComfyUI /comfyui](#comfyui-comfyui)
- [TTS 语音合成 /tts](#tts-语音合成-tts)
- [Whisper 语音识别 /whisper](#whisper-语音识别-whisper)
- [配置管理 /config](#配置管理-config)
- [ModelScope /modelscope](#modelscope-modelscope)
- [系统信息 /system](#系统信息-system)
- [实时事件 SSE](#实时事件-sse)

---

## 通用

### 健康检查

```
GET /api/health
```

**响应**
```json
{ "status": "ok" }
```

---

## 模型管理 /models

### 获取所有模型

```
GET /api/models
```

**响应**
```json
{
  "models": [
    {
      "id": "string",
      "name": "string",
      "type": "llm | comfyui | tts | whisper",
      "source": "remote | custom | cloudapi",
      "status": "running | starting | stopped",
      "port": 1234,
      "download_status": "downloading | paused | completed | null",
      "download_progress": 0.75,
      "download_error": "string | null",
      "downloading_quantization": "string | null",
      "downloaded_files": [],
      "downloaded_quantizations": [],
      "active_file_ok": true,
      "download_states": []
    }
  ]
}
```

---

### 获取单个模型

```
GET /api/models/:id
```

**响应**: 同单个模型对象（含运行状态字段）

---

### 按类型获取模型

```
GET /api/models/type/:type
```

**参数**: `type` = `llm | comfyui | tts | whisper`

**响应**: `{ "models": [...] }`

---

### 搜索模型

```
GET /api/models/search?q=关键词
```

**响应**: `{ "models": [...] }`

---

### 创建模型（通用）

```
POST /api/models
```

**请求体**
```json
{
  "type": "llm",
  "name": "string",
  "modelscope_id": "owner/repo"
}
```

---

### 添加自定义本地模型（GGUF）

```
POST /api/models/custom
```

**请求体**
```json
{
  "name": "我的模型",
  "local_path": "C:/path/to/model/folder",
  "description": "可选描述",
  "type": "llm"
}
```

**说明**: `local_path` 下须有 `.gguf` 文件。

**响应**
```json
{ "success": true, "model": { ... } }
```

---

### 添加云 API 模型

```
POST /api/models/cloudapi
```

**请求体**
```json
{
  "name": "GPT-4o",
  "api_base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "api_model": "gpt-4o",
  "description": "可选",
  "cloud_platform": "openai"
}
```

**响应**: `{ "success": true, "model": { ... } }`

---

### 测试云 API 连接

```
POST /api/models/cloudapi/test
```

**请求体**
```json
{
  "api_base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "api_model": "gpt-4o"
}
```

**响应**: `{ "success": true, "message": "云API连接测试成功" }`

---

### 更新模型信息

```
PUT /api/models/:id
```

**请求体**（字段均可选）
```json
{
  "name": "新名称",
  "selected_quantization": "Q4_K_M",
  "auto_start": false,
  "api_key": "新key"
}
```

**响应**: 更新后的模型对象

---

### 删除指定量化版本文件

```
DELETE /api/models/:id/quantization
```

**请求体**
```json
{ "filename": "model-Q4_K_M.gguf" }
```

**响应**: `{ "success": true, "message": "..." }`

---

### 清理模型所有文件（保留配置）

```
DELETE /api/models/:id/files
```

**响应**: `{ "success": true, "message": "..." }`

---

### 删除模型配置（保留文件）

```
DELETE /api/models/:id/config
```

**响应**: `{ "success": true, "message": "..." }`

---

### 删除模型（文件+配置）

```
DELETE /api/models/:id
```

**响应**: `{ "success": true, "message": "..." }`

---

### 扫描已下载的量化版本

```
GET /api/models/:id/downloaded-quantizations
```

**响应**: `{ "downloadedQuantizations": ["Q4_K_M", "Q8_0"] }`

---

### 扫描已下载的文件列表

```
GET /api/models/:id/scan-files
```

**响应**
```json
{
  "downloadedFiles": [
    { "filename": "model-Q4_K_M.gguf", "size": 4294967296, "is_active": true, "matched_preset": "Q4_K_M" }
  ]
}
```

---

### 设置激活文件

```
POST /api/models/:id/set-active-file
```

**请求体**
```json
{ "filename": "model-Q8_0.gguf" }
```

**响应**: `{ "success": true }`

---

### 恢复远程默认配置

```
POST /api/models/:id/restore-defaults
```

**响应**: 更新后的模型对象

---

### 从远端刷新模型配置

```
POST /api/models/:id/refresh-remote
```

**说明**: 仅 ModelScope 来源的模型支持。从 ModelScope 重新拉取量化列表和 sha256。

**响应**: 更新后的模型对象

---

## 后端进程 /backend

### 启动模型进程

```
POST /api/backend/start/:modelId?mode=single
```

**Query 参数**
| 参数 | 说明 |
|------|------|
| `mode` | `single`（独立端口）或 `router`（路由模式），默认 `single` |

**响应**: `{ "success": true, "port": 1234 }`

---

### 路由模式批量启动同类型模型

```
POST /api/backend/start-router/:type
```

**参数**: `type` = `llm | tts | whisper`

**响应**: `{ "success": true }`

---

### 停止模型进程

```
POST /api/backend/stop/:modelId
```

**响应**: `{ "success": true }`

---

### 查询模型运行状态

```
GET /api/backend/status/:modelId
```

**响应**
```json
{
  "running": true,
  "starting": false,
  "port": 1234,
  "pid": 12345
}
```

---

### 获取模型进程日志

```
GET /api/backend/logs/:modelId
```

**响应**: `{ "logs": ["..."] }`

---

### 打开日志文件夹

```
POST /api/backend/open-logs
```

**响应**: `{ "success": true }`

---

## LLM 推理 /llm

> 以下接口要求对应模型已处于 running 状态。

### 聊天对话

```
POST /api/llm/:modelId/chat
```

**请求体**
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**响应**: OpenAI 格式的 chat completion 响应

---

### 文本补全

```
POST /api/llm/:modelId/complete
```

**请求体**
```json
{
  "prompt": "从前有座山",
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**响应**: llama.cpp 格式的 completion 响应

---

### 获取模型信息

```
GET /api/llm/:modelId/info
```

**响应**: OpenAI `/v1/models` 格式响应

---

## 下载管理 /download

### 开始下载

```
POST /api/download/start
```

**请求体**
```json
{
  "modelId": "model_id",
  "quantizationName": "Q4_K_M"
}
```

**响应**: 下载状态对象

---

### 暂停下载

```
POST /api/download/pause/:id
```

**请求体**（可选）
```json
{ "quantizationName": "Q4_K_M" }
```

---

### 恢复下载

```
POST /api/download/resume/:id
```

**请求体**（可选）
```json
{ "quantizationName": "Q4_K_M" }
```

---

### 取消下载

```
DELETE /api/download/:id
```

**请求体** 或 **Query 参数 `?q=quantizationName`**（可选）
```json
{ "quantizationName": "Q4_K_M" }
```

---

### 获取下载状态

```
GET /api/download/status/:id
```

**响应**
```json
{
  "status": "downloading | paused | completed | error",
  "progress": 0.75,
  "speed": 1048576,
  "targetQuantization": "Q4_K_M",
  "error": null
}
```

---

### 获取所有下载任务

```
GET /api/download/list
```

**响应**: `{ "downloads": [...] }`

---

### 清理遗留下载状态

```
POST /api/download/cleanup
```

**响应**: `{ "success": true }`

---

## 参数管理 /parameters

### 获取模型有效参数

```
GET /api/parameters/:modelId
```

**响应**
```json
{
  "parameters": {
    "context_size": 4096,
    "gpu_layers": 35,
    "port": 1234,
    "temperature": 0.7
  }
}
```

---

### 保存用户参数

```
PUT /api/parameters/:modelId
```

**请求体**
```json
{
  "parameters": {
    "context_size": 8192,
    "gpu_layers": -1,
    "port": 1234
  }
}
```

---

### 重置为默认参数

```
POST /api/parameters/:modelId/reset
```

---

### 添加自定义参数

```
POST /api/parameters/:modelId/custom
```

**请求体**
```json
{ "key": "--mlock", "value": "" }
```

---

### 删除自定义参数

```
DELETE /api/parameters/:modelId/custom/:key
```

---

### 获取参数元数据

```
GET /api/parameters/metadata/all
```

**响应**: `{ "metadata": { ... } }`

---

## 引擎管理 /engines

### 获取所有引擎

```
GET /api/engines
```

**响应**
```json
{
  "llamacpp": {
    "id": "llamacpp",
    "name": "llama.cpp",
    "installed": true,
    "installed_versions": ["202604031826"],
    "broken_versions": [],
    "default_version": "202604031826",
    "download_states": [],
    "download_state": null
  }
}
```

---

### 获取单个引擎

```
GET /api/engines/:id
```

**参数**: `id` = `llamacpp | comfyui | tts | whisper | rocm`

---

### 检查引擎是否已安装

```
GET /api/engines/:id/check
```

**响应**: `{ "installed": true, "engineInfo": {...}, "default_version": "..." }`

---

### 获取已安装版本列表

```
GET /api/engines/:id/versions
```

**响应**: `{ "versions": ["202604031826"] }`

---

### 验证引擎依赖

```
POST /api/engines/:id/validate
```

**请求体**
```json
{ "version": "202604031826" }
```

---

### 下载引擎

```
POST /api/engines/:id/download
```

**请求体**
```json
{ "version": "202604031826" }
```

**说明**: 会自动下载依赖（如 rocm）。

---

### 重新安装指定版本

```
POST /api/engines/:id/versions/:version/reinstall
```

---

### 卸载指定版本

```
DELETE /api/engines/:id/versions/:version
```

---

### 查询引擎下载进度

```
GET /api/engines/download/:taskId
```

**说明**: `taskId` 格式为 `engineId::version`，例如 `llamacpp::202604031826`。

---

## ComfyUI /comfyui

### 上传并分析工作流

```
POST /api/comfyui/upload-workflow
Content-Type: multipart/form-data
```

**表单字段**
| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `apiWorkflow` | file (JSON) | ✓ | API 格式工作流（用于执行） |
| `fullWorkflow` | file (JSON) | 可选 | 完整工作流（用于提取模型下载链接） |
| `name` | string | ✓ | 工作流名称 |
| `description` | string | 可选 | 描述 |

**响应**
```json
{
  "success": true,
  "analysis": {
    "required_models": [...],
    "parameter_mapping": {...},
    "default_parameters": {...}
  }
}
```

---

### 获取工作流节点列表

```
GET /api/comfyui/:id/workflow-nodes
```

**响应**
```json
{
  "success": true,
  "nodes": [
    { "id": "1", "class_type": "KSampler", "title": "", "inputs": {} }
  ]
}
```

---

### 保存用户参数映射

```
PUT /api/comfyui/:id/user-mapping
```

**请求体**
```json
{
  "user_parameter_mapping": {
    "prompt": { "node_id": "6", "field": "text" }
  }
}
```

---

### 搜索关联模型（ModelScope）

```
POST /api/comfyui/:id/search-model
```

**请求体**
```json
{
  "model_type": "checkpoints",
  "filename": "sd_xl_base_1.0.safetensors"
}
```

---

### 下载单个缺失模型

```
POST /api/comfyui/:id/download-model
```

**请求体**
```json
{
  "type": "checkpoints",
  "filename": "sd_xl_base_1.0.safetensors"
}
```

**响应**: `{ "success": true, "taskId": "abc123" }`

---

### 批量下载所有缺失模型

```
POST /api/comfyui/:id/download-all-models
```

**响应**
```json
{
  "success": true,
  "tasks": [
    { "taskId": "abc123", "filename": "model.safetensors", "type": "checkpoints" }
  ]
}
```

---

### 查询下载任务状态

```
GET /api/comfyui/download-status/:taskId
```

**响应**: `{ "success": true, "task": { "status": "downloading", "progress": 0.5 } }`

---

### 暂停 / 恢复 / 取消下载任务

```
POST /api/comfyui/download-pause/:taskId
POST /api/comfyui/download-resume/:taskId
POST /api/comfyui/download-cancel/:taskId
```

---

### 获取模型文件状态

```
GET /api/comfyui/:id/models-status
```

**响应**
```json
{
  "success": true,
  "required_models": [...],
  "summary": { "total": 3, "downloaded": 2, "missing": 1 }
}
```

---

### 实例管理

```
GET    /api/comfyui/instances              # 所有实例
POST   /api/comfyui/instances              # 创建实例
POST   /api/comfyui/instances/ensure       # 确保存在默认实例
PUT    /api/comfyui/instances/:id          # 更新实例配置
DELETE /api/comfyui/instances/:id          # 删除实例
POST   /api/comfyui/instances/:id/start    # 启动
POST   /api/comfyui/instances/:id/stop     # 停止
GET    /api/comfyui/instances/:id/status   # 状态
GET    /api/comfyui/instances/:id/logs     # 日志
POST   /api/comfyui/instances/:id/open-folder  # 打开文件夹
```

---

### 检查 ComfyUI 连接

```
POST /api/comfyui/check
```

**请求体**
```json
{ "host": "127.0.0.1", "port": 8188 }
```

---

### 上传图片到 ComfyUI

```
POST /api/comfyui/upload-image
Content-Type: multipart/form-data
```

**表单字段**: `image`（文件），`host`，`port`

**响应**: `{ "success": true, "filename": "upload.png" }`

---

### 上传音频到 ComfyUI

```
POST /api/comfyui/upload-audio
Content-Type: multipart/form-data
```

**表单字段**: `audio`（文件），`host`，`port`

---

### 异步提交工作流（执行）

```
POST /api/comfyui/:id/run
```

**请求体**
```json
{
  "host": "127.0.0.1",
  "port": 8188,
  "prompt": "a cat",
  "negative_prompt": "",
  "steps": 20
}
```

**响应**: `{ "success": true, "promptId": "uuid" }`

---

### 生成（OpenAI 兼容）

```
POST /api/comfyui/:id/generate
```

**请求体**: OpenAI image generation 格式

---

### 查询生成进度

```
GET /api/comfyui/progress/:taskId?host=127.0.0.1&port=8188
```

---

### 获取生成结果

```
GET /api/comfyui/result/:taskId?host=127.0.0.1&port=8188
```

**响应**
```json
{
  "success": true,
  "data": [
    { "url": "/api/comfyui/view/ComfyUI_00001_.png?type=output&host=127.0.0.1&port=8188" }
  ]
}
```

---

### 代理获取输出图片/视频

```
GET /api/comfyui/view/:filename?host=xxx&port=xxx&type=output&subfolder=xxx
```

---

## TTS 语音合成 /tts

> TTS 服务运行在独立进程，默认端口通过配置读取。

### 健康检查

```
GET /api/tts/health
```

---

### 语音合成

```
POST /api/tts/speech
```

**请求体**（OpenAI TTS 格式）
```json
{
  "model": "tts-1",
  "input": "你好，世界",
  "voice": "alloy",
  "response_format": "wav",
  "speed": 1.0
}
```

**响应**: 音频文件（`audio/wav` 等）

---

### 获取音色列表

```
GET /api/tts/voices
```

---

### 添加音色（上传参考音频）

```
POST /api/tts/voices
Content-Type: multipart/form-data
```

**表单字段**: `file`（音频），`name`，`description`

---

### 自动注册音色

```
POST /api/tts/voices/auto-register
```

---

### 获取音色详情

```
GET /api/tts/voices/:voiceId
```

---

### 获取音色预览音频

```
GET /api/tts/voices/:voiceId/audio
```

**响应**: 音频文件

---

### 删除音色

```
DELETE /api/tts/voices/:voiceId
```

---

### 获取合成历史

```
GET /api/tts/history
```

---

### 获取历史条目音频

```
GET /api/tts/history/:itemId/audio
```

---

### 删除历史条目

```
DELETE /api/tts/history/:itemId
```

---

### 清空历史

```
DELETE /api/tts/history
```

---

## Whisper 语音识别 /whisper

### 健康检查

```
GET /api/whisper/health
```

---

### 语音转文字

```
POST /api/whisper/transcribe
Content-Type: multipart/form-data
```

**表单字段**
| 字段 | 必需 | 说明 |
|------|------|------|
| `file` | ✓ | 音频文件（最大 500MB） |
| `model` | 可选 | 默认 `whisper-1` |
| `language` | 可选 | 语言代码，如 `zh` |
| `response_format` | 可选 | `json | text | srt | vtt` |
| `temperature` | 可选 | 采样温度 |
| `prompt` | 可选 | 提示词 |
| `vad_filter` | 可选 | 是否启用 VAD |

**响应**（OpenAI 格式）
```json
{ "text": "识别出的文字" }
```

---

### 语音翻译（翻为英文）

```
POST /api/whisper/translate
Content-Type: multipart/form-data
```

**表单字段**: `file`（音频），`model`，`response_format`，`temperature`

---

## 配置管理 /config

### 获取全局配置

```
GET /api/config
```

---

### 更新全局配置

```
PUT /api/config
```

**请求体**: 配置对象（部分字段均可）

---

### 主题配置

```
GET /api/config/theme
PUT /api/config/theme
```

PUT 请求体: `{ "theme": "dark | light" }`

---

### 收藏夹

```
GET /api/config/favorites
PUT /api/config/favorites
```

PUT 请求体: `{ "favorites": ["modelId1", "modelId2"] }`

---

### 端口配置

```
GET /api/config/ports
PUT /api/config/ports
```

GET 响应:
```json
{
  "ports": {
    "llm_range": { "start": 8080, "end": 8089 },
    "comfyui": 8188,
    "tts": 5000,
    "whisper": 5001
  }
}
```

PUT 请求体: `{ "ports": { ... } }`

---

### 更新设置

```
GET /api/config/update-settings
PUT /api/config/update-settings
```

GET 响应:
```json
{
  "updateSettings": {
    "auto_check": true,
    "last_check": null,
    "channel": "stable",
    "server_url": "https://api.novamax.com"
  }
}
```

---

### 远程配置同步

```
POST /api/remote-config/sync
GET  /api/remote-config/status
```

---

### 软件更新

```
GET  /api/update/check     # 检查更新
GET  /api/update/status    # 更新状态
POST /api/update/apply     # 应用更新
```

---

## ModelScope /modelscope

### 设置访问 Token

```
POST /api/modelscope/token
```

**请求体**: `{ "token": "your_token" }`

---

### 解析 ModelScope URL 并预览

```
POST /api/modelscope/parse-url
```

**请求体**
```json
{
  "url": "https://modelscope.cn/models/owner/repo-name",
  "type": "llm"
}
```

**响应**
```json
{
  "success": true,
  "modelId": "owner/repo-name",
  "folder": null,
  "preview": {
    "name": "string",
    "description": "string",
    "quantizations": [...],
    "mmproj_count": 0,
    "capabilities": []
  },
  "config": { ... }
}
```

---

### 搜索 ModelScope 模型

```
POST /api/modelscope/search
```

**请求体**: `{ "query": "qwen2.5" }`

**响应**
```json
{
  "success": true,
  "models": [...],
  "totalCount": 10
}
```

---

### 确认并保存模型配置

```
POST /api/modelscope/confirm
```

**请求体**: `{ "config": { ...来自 parse-url 的 config 对象... } }`

**响应**: `{ "success": true, "model": { ... } }`

---

### 获取用户模型列表

```
GET /api/modelscope/user/:username/models
```

---

### 获取模型文件列表

```
GET /api/modelscope/model/:owner/:name/files
```

---

## 系统信息 /system

### 获取系统硬件与进程信息

```
GET /api/system/info
```

**响应**
```json
{
  "hardware": {
    "cpu": {
      "model": "Intel Core i9-13900K",
      "cores": 24,
      "speed": 3000,
      "usagePercent": 15
    },
    "memory": {
      "total": 34359738368,
      "free": 17179869184,
      "used": 17179869184,
      "usagePercent": 50
    },
    "gpus": [
      {
        "name": "NVIDIA GeForce RTX 4090",
        "total": 25769803776,
        "used": 8589934592,
        "free": 17179869184,
        "usagePercent": 33
      }
    ],
    "platform": "win32",
    "arch": "x64",
    "hostname": "DESKTOP",
    "uptime": 3600
  },
  "processes": [
    {
      "id": "novamax-server",
      "name": "NovaMax Server",
      "pid": 12345,
      "port": 3001,
      "memory": 104857600
    }
  ]
}
```

---

### 日志

```
GET    /api/system/logs?limit=200&level=all   # 获取系统日志
DELETE /api/system/logs                        # 清空日志
```

**level** 可选值: `all | info | warn | error`

---

### 存储管理

```
GET /api/system/storage
```

**响应**
```json
{
  "basePath": "C:/path/to/models",
  "items": [
    {
      "type": "llm",
      "label": "LLM 模型",
      "path": "...",
      "exists": true,
      "size": 4294967296,
      "driveFreeSpace": 107374182400,
      "isJunction": false,
      "junctionTarget": null
    }
  ]
}
```

---

### 打开存储目录

```
POST /api/system/storage/open
```

**请求体**: `{ "dirPath": "C:/path/to/dir" }`

---

### 迁移存储目录

```
POST /api/system/storage/migrate
```

**请求体**
```json
{
  "type": "llm",
  "targetPath": "D:/models/llm",
  "backup": false
}
```

**响应**: `{ "jobId": "xxx", "sameDrive": false }`

---

### 还原存储目录（取消迁移 junction）

```
POST /api/system/storage/restore
```

**请求体**: `{ "type": "llm" }`

**响应**: `{ "jobId": "xxx" }`

---

### 查询迁移/还原任务状态

```
GET /api/system/storage/job-status/:jobId
```

**响应**
```json
{
  "status": "running | success | failed",
  "message": "",
  "progress": 75,
  "totalBytes": 4294967296,
  "copiedBytes": 3221225472,
  "speed": 52428800,
  "phase": "migrate",
  "sameDrive": false
}
```

---

## 实时事件 SSE

```
GET /api/events
```

建立 Server-Sent Events 长连接，接收实时事件推送。

**事件格式**
```
data: {"type":"model-updated","data":{"modelId":"xxx"}}
```

**事件类型**
| type | 触发时机 |
|------|----------|
| `model-updated` | 模型信息变更（状态、参数、下载等） |
| `download-progress` | 下载进度更新 |
| `favorites-updated` | 收藏夹变更 |

**示例（JavaScript）**
```js
const es = new EventSource('http://localhost:3001/api/events');
es.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  console.log(type, data);
};
```

---

## 错误响应格式

所有接口在出错时统一返回：

```json
{
  "error": "错误描述信息"
}
```

HTTP 状态码说明：
| 状态码 | 含义 |
|--------|------|
| 400 | 参数错误 / 业务规则限制 |
| 404 | 资源不存在 |
| 409 | 冲突（如重名、端口占用） |
| 500 | 服务器内部错误 |
| 502 | 上游服务（TTS/Whisper）错误 |
| 503 | 上游服务不可用 |
