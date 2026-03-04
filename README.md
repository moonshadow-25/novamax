# NovaMax - 本地PC模型部署平台

一个基于 Node.js 的全栈多模型管理平台，支持 LLM、ComfyUI、TTS、ASR 等多种模型类型的下载、管理和运行。

## 核心特性

- 从 ModelScope 官方仓库自动读取和下载模型
- 支持 4 种模型类型：GGUF(llama.cpp)、ComfyUI、Whisper、TTS
- 统一的模型管理界面和独立的运行UI
- 深色/白色主题支持
- AMD AI MAX 395 硬件优化

## 技术栈

### 前端
- React 18 + Vite
- Ant Design 5.x
- React Router v6
- Axios

### 后端
- Express.js
- Node.js 18+
- JSON 文件存储

## 项目结构

```
novamax/
├── frontend/                 # React 前端
│   ├── src/
│   │   ├── components/      # 可复用组件
│   │   ├── pages/           # 页面组件
│   │   ├── services/        # API服务层
│   │   ├── contexts/        # Context providers
│   │   └── utils/           # 工具函数
│   └── package.json
│
├── backend/                 # Express 后端
│   ├── src/
│   │   ├── routes/          # API路由
│   │   ├── services/        # 业务逻辑层
│   │   ├── utils/           # 工具函数
│   │   └── config/          # 配置文件
│   └── package.json
│
├── external/                # 外部AI后端
│   ├── llamacpp/           # llama.cpp 后端
│   ├── comfyui/            # ComfyUI 后端
│   ├── whispercpp/         # whisper.cpp 后端
│   └── indextts/           # IndeTTS 后端
│
└── data/                    # 数据存储目录
    ├── config.json         # 全局配置
    ├── models/             # 模型元数据
    └── downloads/          # 下载的模型文件
```

## 快速开始

### 开发模式

1. 安装依赖

```bash
# 安装前端依赖
cd frontend
npm install

# 安装后端依赖
cd ../backend
npm install
```

2. 启动开发服务器

```bash
# 启动后端 (终端1)
cd backend
npm run dev

# 启动前端 (终端2)
cd frontend
npm run dev
```

3. 访问应用

打开浏览器访问: http://localhost:5173

### 生产构建

1. 构建前端

```bash
cd frontend
npm run build
```

2. 启动后端（会自动提供前端静态文件）

```bash
cd backend
npm start
```

3. 访问应用

打开浏览器访问: http://localhost:3000

## 功能说明

### 模型管理

- 查看所有已添加的模型
- 按类型筛选模型（LLM、ComfyUI、TTS、Whisper）
- 搜索模型
- 添加新模型（从 ModelScope 或自定义）
- 删除模型

### 模型运行

- 启动/停止模型后端
- 查看模型运行状态
- 查看模型日志

### LLM 对话

- 与 LLM 模型进行对话
- 支持流式响应
- 对话历史管理
- 参数配置（温度、上下文长度等）

### ComfyUI 生成

- 图片/视频生成
- 简化的用户界面
- 自动 workflow 参数映射
- 生成进度追踪

### TTS 语音合成

- 文本转语音
- 语速、音调调节
- 音频播放和下载

### Whisper 语音识别

- 音频转文字
- 多语言支持
- 翻译功能

## API 文档

### 模型管理 API

- `GET /api/models` - 获取所有模型
- `GET /api/models/:id` - 获取单个模型
- `GET /api/models/type/:type` - 按类型获取模型
- `POST /api/models` - 添加新模型
- `PUT /api/models/:id` - 更新模型
- `DELETE /api/models/:id` - 删除模型

### 后端进程管理 API

- `POST /api/backend/start/:modelId` - 启动后端
- `POST /api/backend/stop/:modelId` - 停止后端
- `GET /api/backend/status/:modelId` - 获取状态
- `GET /api/backend/logs/:modelId` - 获取日志

### LLM API

- `POST /api/llm/:modelId/chat` - 聊天
- `POST /api/llm/:modelId/complete` - 文本补全
- `GET /api/llm/:modelId/info` - 获取模型信息

## 配置

配置文件位于 `data/config.json`：

```json
{
  "theme": "dark",
  "modelscope": {
    "organization": "shoujiekeji",
    "cache_ttl": 3600,
    "api_token": ""
  },
  "external_paths": {
    "llamacpp": "./external/llamacpp",
    "comfyui": "./external/comfyui",
    "whispercpp": "./external/whispercpp",
    "indextts": "./external/indextts"
  },
  "ports": {
    "llamacpp_range": [8100, 8199],
    "comfyui": 8188,
    "tts": 8200,
    "whisper": 8201
  }
}
```

## 开发状态

### 已完成 ✓

- [x] 项目结构搭建
- [x] 前端基础框架（React + Vite + Ant Design）
- [x] 后端基础框架（Express.js）
- [x] 主题切换功能
- [x] 模型管理 CRUD
- [x] 进程管理系统
- [x] LLM 对话界面
- [x] 基础 API 路由

### 开发中 🚧

- [ ] ModelScope 集成
- [ ] 下载管理系统
- [ ] ComfyUI 功能
- [ ] TTS 功能
- [ ] Whisper 功能
- [ ] WebSocket 实时通信

### 计划中 📋

- [ ] 打包为独立可执行文件（pkg）
- [ ] 完整的错误处理
- [ ] 单元测试
- [ ] 性能优化

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT
