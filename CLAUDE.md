# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ 关键规则：不要启动或停止后端进程

用户自己管理 Node 后端的启动、重启和停止。不要运行 `node src/index.js`、`npm start`、`npm run dev` 等后端命令，也不要 kill 后端进程。

- 修改后端代码后 → 告知用户重启后端
- 修改前端代码后 → `cd frontend && npm run build`
- 同时修改前后端 → 先编译前端，再告知用户重启后端

## 技术栈

- **平台**: Windows 专用（使用 Windows Job Objects 管理进程树，`gpuinfo.exe` 查询 GPU 信息）
- **后端**: Node.js (ESM), Express 4, 端口 3001, `better-sqlite3` (SQLite，**同步 API**——所有查询不加 `await`，**原生 C++ 模块**——安装时需要 node-gyp 编译工具链) + JSON 文件混合存储，`multer` 处理文件上传
- **前端**: React 18 + Vite 5 + Ant Design 5 + React Router v6, 编译输出到 `frontend/dist`, 生产环境由 Express 托管静态文件
- **外部工具**: llama.cpp, ComfyUI, whisper.cpp, IndeTTS — 由后端通过子进程管理；**FFmpeg 必须系统安装**（TTS 音频处理依赖，前端有阻断式检测弹窗）
- **开发启动**: `python start_novamax_dev.py`（优先使用 `external/node/node.exe`，使用 Windows Job Objects 确保子进程随主进程退出，自动处理更新和进程生命周期）

### ESM 导入约定

所有后端文件是 ESM（`package.json` 中 `"type": "module"`），**导入必须带 `.js` 扩展名**：

```js
import configManager from './services/configManager.js';  // ✓
import configManager from './services/configManager';     // ✗ 运行时报错
```

### 服务单例模式

所有服务遵循统一模式：class → 单例导出 → 异步 `init()`：

```js
class FooManager {
  async init() { /* ... */ }
  // ...
}
export default new FooManager();  // 单例，不是类
```

路由是例外——导出 Express Router 实例或工厂函数。

### 前端 API 服务层

`frontend/src/services/api.js` 使用 axios 实例（baseURL `/api`，120s 超时），通过响应拦截器自动解包 `response.data`。所有后端 API 调用按功能域分组为命名导出（`modelService`、`modelscopeService`、`engineService` 等），每个方法返回解包后的数据：

```js
// api.js 内部：axios 拦截器已解包 response.data
export const modelService = {
  getAll: () => api.get('/models'),        // 直接返回数据，无需 .then(r => r.data)
  getById: (id) => api.get(`/models/${id}`),
  // ...
};
```

## 项目架构

```
novamax/
├── frontend/src/               # React 前端
│   ├── pages/                  # 路由页面
│   │   ├── Home/               # 仪表盘（模型/引擎卡片）
│   │   ├── LLMChat/            # LLM 对话
│   │   ├── ComfyUI/            # ComfyUI 工作流
│   │   ├── TTS/                # TTS 页面（index, TTSStudio, Workbench）
│   │   ├── Whisper/            # 语音识别
│   │   ├── GlobalSettings/     # 全局设置
│   │   └── Settings/           # 模型参数设置
│   ├── components/             # 可复用组件
│   ├── services/api.js         # axios API 服务层（所有后端调用）
│   ├── utils/                  # engineType.js, engineStatus.js
│   └── contexts/               # ThemeContext
├── backend/src/
│   ├── index.js                # 入口：按依赖顺序初始化所有服务，注册路由，SSE、静态文件
│   ├── routes/                 # Express 路由（见下方路由表）
│   ├── services/               # 业务逻辑层（见下方核心服务）
│   ├── tts/                    # TTS 引擎工作器
│   │   ├── ttsWorkerManager.js # 主线程代理：管理 Worker 线程生命周期，IPC 消息收发
│   │   ├── ttsWorker.js        # Worker 线程入口：加载各 TTS 服务模块
│   │   └── engineWorker.js     # 子进程：加载和运行引擎 adapter.js，通过 IPC 通信
│   ├── contracts/              # TTS 引擎契约 TypeScript 类型定义
│   ├── config/                 # constants.js（端口范围、模型类型、数据路径）、appConfig.js
│   └── utils/                  # pathHelper, engineTypeHelper, crypto, fileIntegrity, serviceRegistrar 等
├── external/                   # 外部 AI 后端 (llamacpp, comfyui, whispercpp, tts/)
├── data/                       # 运行时数据
│   ├── novamax.db              # SQLite 数据库
│   ├── config.json             # 全局配置
│   ├── engines.json            # 引擎注册表
│   ├── downloads/              # 下载的模型文件
│   ├── models/                 # 模型元数据 JSON
│   ├── models_dir/             # 模型运行时目录
│   ├── presets/                # 参数预设
│   ├── tts_services/           # TTS 工作区 & 参考音频
│   ├── updates/                # 应用更新临时文件
│   └── logs/                   # 运行日志
└── docs/                       # TTS_ENGINE_SPEC.md, NOVAMAX_API.md 等
```

## 服务初始化顺序

`backend/src/index.js` 的 `init()` 中严格按以下顺序初始化：

1. `configManager.init()` — 读 `config.json`
2. `modelManager.init()` — 初始化 SQLite，迁移 schema
3. `engineManager.init()` — 加载 `engines.json`
4. `ttsWorkerManager.start()` — 启动 TTS Worker 线程
5. `comfyuiInstanceManager.init()` — ComfyUI 实例管理

之后依次：清理旧临时字段 → `llmDownloader.cleanupStaleDownloads()` → `modelManager.syncAllDownloadedFiles()` → `modelManager.syncAllDownloadedQuantizations()` → 自动启动标记了 `auto_start` 的 LLM 模型 → 后台补算缺失 SHA256 → 写 `.installed` 标记 → 异步拉取远程配置并检查更新。

## 核心服务

| 服务 | 文件 | 职责 |
|------|------|------|
| `configManager` | `services/configManager.js` | 读写 `data/config.json`，全局配置管理 |
| `modelManager` | `services/modelManager.js` | 模型 CRUD，基于 SQLite，管理 LLM/ComfyUI/TTS/Whisper 模型元数据 |
| `engineManager` | `services/engineManager.js` | TTS 引擎注册表，管理 `engines.json`，引擎安装/卸载/版本管理 |
| `engineDownloader` | `services/engineDownloader.js` | 引擎/应用下载器，处理下载、解压、依赖管理 |
| `processManager` | `services/processManager.js` | 子进程管理：启动/停止 llama.cpp、ComfyUI 等后端，端口分配 |
| `eventBus` | `services/eventBus.js` | SSE 广播 (`/api/events`)，前端实时接收下载进度、服务状态等事件 |
| `remoteConfigService` | `services/remoteConfigService.js` | 从远程拉取模型/引擎配置，版本更新检查 |
| `logCollector` | `services/logCollector.js` | 拦截所有 console 输出写入日志文件（最早初始化） |
| `llmDownloader` | `services/llmDownloader.js` | LLM 模型下载、校验、SHA256 管理 |
| `commonDownloader` | `services/commonDownloader.js` | 通用下载器基类 |
| `downloadStateManager` | `services/downloadStateManager.js` | 下载状态持久化与恢复 |
| `comfyuiInstanceManager` | `services/comfyuiInstanceManager.js` | ComfyUI 实例生命周期管理 |
| `comfyuiModelManager` | `services/comfyuiModelManager.js` | ComfyUI 模型管理 |
| `comfyuiRunner` | `services/comfyuiRunner.js` | ComfyUI 工作流执行 |
| `llmRunner` | `services/llmRunner.js` | 生成 llama-server 路由模式启动命令，支持多模型动态加载 |
| `openaiProxyService` | `services/openaiProxyService.js` | LLM 的 OpenAI 兼容代理 |
| `multiConnectService` | `services/multiConnectService.js` | 多连接服务管理 |
| `presetService` | `services/presetService.js` | 参数预设 CRUD |
| `parameterService` | `services/parameterService.js` | 模型参数管理 |
| `modelscopeService` | `services/modelscopeService.js` | ModelScope API 集成（搜索、详情） |
| `modelscopeParser` | `services/modelscopeParser.js` | ModelScope URL 解析 |

### TTS Studio 服务（均在 Worker 线程中运行）

| 服务 | 文件 | 职责 |
|------|------|------|
| `ttsStudioManager` | `services/ttsStudioManager.js` | 工作区 CRUD，参考音频管理 |
| `ttsVoiceManager` | `services/ttsVoiceManager.js` | Voice ID 体系：注册、查找、音色克隆 |
| `ttsTaskQueue` | `services/ttsTaskQueue.js` | 合成任务队列与历史记录 |
| `ttsSynthesisService` | `services/ttsSynthesisService.js` | 合成编排：文本分割 → 引擎调用 → 拼接 |
| `ttsTextSegmenter` | `services/ttsTextSegmenter.js` | 长文本智能分割 |
| `ttsAdapterLoader` | `services/ttsAdapterLoader.js` | 动态加载引擎 adapter.js |
| `ttsEngineManager` | `services/ttsEngineManager.js` | 引擎实例生命周期（启动/健康检查/回收） |

### 路由注册

所有路由挂载在 `backend/src/index.js`：

| 路由文件 | 挂载路径 | 职责 |
|---------|---------|------|
| `routes/models.js` | `/api` | 模型 CRUD |
| `routes/engines.js` | `/api` | 引擎注册表 |
| `routes/tts.js` | `/api` | 旧版 TTS |
| `routes/tts-studio.js` | `/api/tts-studio` | TTS Studio：工作区、参考音频、合成、Voice ID |
| `routes/openai-tts.js` | `/v1` | OpenAI 兼容 `/v1/audio/speech` 和 `/v1/audio/models` |
| `routes/llm.js` | `/api` | LLM 对话和补全 |
| `routes/comfyui.js` | `/api` | ComfyUI 工作流 |
| `routes/whisper.js` | `/api` | 语音识别 |
| `routes/download.js` | `/api` | 下载管理 |
| `routes/modelscope.js` | `/api` | ModelScope 搜索和导入 |
| `routes/config.js` | `/api` | 全局配置 |
| `routes/parameters.js` | `/api` | 模型参数 |
| `routes/system.js` | `/api` | 系统信息（GPU、磁盘等） |
| `routes/backend.js` | `/api` | 后端进程启动/停止/状态 |
| `routes/multiconnect.js` | `/api` | 多连接管理 |

## TTS 引擎系统 (v3.0)

核心概念：NovaMax 拥有所有业务逻辑（Voice ID 体系、工作区、任务队列、参数面板），引擎只做一件事——接收文本和 voice 引用，返回音频。

- **契约文件** (`backend/src/contracts/tts-engine-contract.ts`): 定义 `ITtsEngine` 接口——引擎必须实现 `initialize()`, `synthesize()`, `dispose()`, `health()`
- **引擎目录**: `external/tts/{variant-id}/{version}/`，包含 `contract.json`（元数据声明）和 `adapter.js`（实现 ITtsEngine）。版本目录命名格式为 `{timestamp}-{variant-id}`（例如 `202605281738-index-tts1.5`），timestamp 在引擎安装时生成，用于版本排序和更新对比。
- **引擎工作器** (`backend/src/tts/engineWorker.js`): 在子进程中加载和运行引擎适配器，通过 IPC 与主进程通信
- **相关路由**: `routes/tts.js`（旧版 TTS）、`routes/tts-studio.js`（新版工作室）、`routes/openai-tts.js`（OpenAI 兼容 `/v1` 端点）
- 详见 `docs/TTS_ENGINE_SPEC.md`

### Voice ID 体系

NovaMax 生成并管理 Voice ID（8 位 ID），引擎只需通过 `voiceRef` 接收。voiceRef 可以是：
- NovaMax Voice ID → 系统从参考音频缓存中查找
- `file:` 前缀路径 → 直接使用指定音频文件

### 引擎类型归一化

前后端共享同一归一化逻辑：剥离所有非字母数字字符并转小写。
- `"indextts1.5"` / `"index-tts1.5"` / `"index_tts1.5"` → `"indextts15"`
- 前端: `frontend/src/utils/engineType.js`
- 后端: `backend/src/utils/engineTypeHelper.js`

## 模型类型

系统支持 4 种模型类型 (定义在 `backend/src/config/constants.js`):
- `llm` — GGUF 模型，通过 llama.cpp 运行
- `comfyui` — ComfyUI workflow 模型
- `tts` — TTS 语音合成模型（新旧两套系统并行）
- `whisper` — 语音识别模型，通过 whisper.cpp 运行

### 模型量化

LLM 模型支持多量化版本：`modelManager.syncAllDownloadedQuantizations()` 扫描 `downloads/` 目录下的 GGUF 文件，按量化级别（Q2_K ~ Q8_0）分组。前端 `QuantizationSelector` 组件允许用户在模型详情中选择不同量化版本运行。

## 关键数据流

1. **模型下载**: 前端 → `/api/modelscope/search` → ModelScope API → 用户确认 → `/api/download/start` → `engineDownloader`/`commonDownloader` → SSE 推送进度
2. **LLM 推理**: 前端 → `/api/llm/:id/chat` → `processManager` 启动 llama.cpp 子进程 → `/api/backend/start` → OpenAI 兼容代理 (`openaiProxyService`)
3. **TTS 合成（新版）**: 前端 → `/api/tts-studio/synthesize` → `ttsWorkerManager` (IPC) → `ttsWorker.js` → `ttsSynthesisService` → `ttsTextSegmenter`（分割长文本）→ `ttsEngineManager` → `engineWorker.js` (子进程) → 引擎 `adapter.js`
4. **OpenAI TTS 兼容**: 外部客户端 → `/v1/audio/speech` → `ttsWorkerManager` → 引擎 adapter → 返回音频
5. **ComfyUI 工作流**: 前端 → `/api/comfyui/generate` → `comfyuiRunner` → `comfyuiInstanceManager`（管理 ComfyUI 子进程）→ ComfyUI 后端 → 轮询结果并推送 SSE
6. **Whisper 语音识别**: 前端上传音频 → `/api/whisper/transcribe` → `processManager` 管理 whisper.cpp 子进程 → 返回识别文本

## 前端路由

| 路径 | 页面组件 | 说明 |
|------|---------|------|
| `/` | `Home` | 模型/引擎卡片仪表盘 |
| `/llm/:modelId` | `LLMChat` | LLM 对话 |
| `/comfyui/:modelId` | `ComfyUI` | ComfyUI 工作流 |
| `/tts/workspace/:id` | `TTS/Workbench` | TTS 工作区 |
| `/tts/:modelId` | → 重定向到 `/?tab=tts` | 旧版 TTS（已废弃） |
| `/whisper/:modelId` | `Whisper` | 语音识别 |
| `/settings/:modelId` | `Settings` | 模型参数设置 |
| `/global-settings` | `GlobalSettings` | 全局设置 |

## 前端关键组件

- `DynamicParamPanel` — 根据引擎 contract.json 的 `params` schema 动态渲染参数表单
- `EngineCard` — 引擎卡片（版本、状态、操作）
- `WorkspaceCard` — TTS 工作区卡片
- `VramBar` — GPU 显存使用量进度条
- `FfmpegRequiredModal` — FFmpeg 未安装时阻断式提示弹窗

## SSE 事件推送

`/api/events` 端点使用 Server-Sent Events，`eventBus.broadcast(event, data)` 广播。主要事件类型：
- `download-progress` — 下载进度更新
- `server-restarted` — 后端重启时通知前端刷新（`{ action: 'reload' }`）

## 常见命令

```bash
# 开发模式启动（推荐：Python 脚本自动管理 Node 进程和更新）
python start_novamax_dev.py

# 前端开发（Vite dev server，带 HMR，端口 5173，代理 /api → localhost:3001）
cd frontend && npm run dev

# 前端生产构建
cd frontend && npm run build

# 后端开发（--watch 自动重启）
cd backend && npm run dev

# 后端生产启动
cd backend && npm start

# 后端便携式打包（esbuild → dist/novamax-backend.js）
cd backend && npm run build

# 检查构建环境是否就绪
cd backend && npm run check
```

## Vite 开发代理

`frontend/vite.config.js` 将 `/api` 代理到 `http://localhost:3001`，绑定到 `0.0.0.0:5173`（所有网络接口可访问）。开发时前端在 5173 端口，后端在 3001 端口，无需 CORS 配置。

**注意：Vite 只代理了 `/api` 路径，`/v1`（OpenAI TTS 兼容端点）在 Vite 开发模式下无法访问。** 测试 `/v1/audio/speech` 需要直接访问后端 `http://localhost:3001`，或通过生产模式（`npm run build` + 后端托管静态文件）使用。

## 测试与代码规范

- 项目目前**没有测试框架**（无 vitest/jest/mocha），也没有 ESLint 或 Prettier 配置——不要尝试运行 `npm test` 或 `npm run lint`
- 修改代码后通过前端构建验证：`cd frontend && npm run build`
