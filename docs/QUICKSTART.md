# NovaMax 快速开始指南

## 首次安装

### 1. 安装 Node.js

确保已安装 Node.js 18 或更高版本。

下载地址: https://nodejs.org/

验证安装:
```bash
node --version
npm --version
```

### 2. 安装项目依赖

```bash
# 安装前端依赖
cd frontend
npm install

# 安装后端依赖
cd ../backend
npm install
```

## 开发模式

使用开发模式可以实时查看代码修改效果。

### 方式1: 使用启动脚本（推荐）

双击运行 `dev.bat` 文件，会自动启动前后端服务器。

### 方式2: 手动启动

```bash
# 终端1 - 启动后端
cd backend
npm run dev

# 终端2 - 启动前端
cd frontend
npm run dev
```

访问: http://localhost:5173

## 生产模式

### 1. 构建前端

```bash
cd frontend
npm run build
```

### 2. 启动服务器

```bash
# 方式1: 使用启动脚本
双击运行 run.bat

# 方式2: 手动启动
cd backend
npm start
```

访问: http://localhost:3000

## 配置 AI 后端

### 1. llama.cpp

将 llama.cpp 的 server 可执行文件放到 `external/llamacpp/` 目录。

### 2. ComfyUI

将 ComfyUI 安装到 `external/comfyui/` 目录。

### 3. Whisper.cpp

将 whisper.cpp 的 server 可执行文件放到 `external/whispercpp/` 目录。

### 4. IndeTTS

将 IndeTTS 安装到 `external/indextts/` 目录。

## 添加模型

### 方式1: 从 ModelScope 添加（开发中）

1. 点击主页的"添加新模型"卡片
2. 搜索并选择模型
3. 点击下载

### 方式2: 手动添加

1. 将模型文件放到对应目录:
   - LLM: `data/downloads/LLM/`
   - ComfyUI: `data/downloads/COMFYUI/`
   - TTS: `data/downloads/TTS/`
   - Whisper: `data/downloads/ASR/`

2. 编辑对应的 JSON 文件添加模型信息:
   - `data/models/llm.json`
   - `data/models/comfyui.json`
   - `data/models/tts.json`
   - `data/models/whisper.json`

示例（LLM 模型）:
```json
{
  "models": [
    {
      "id": "llm-001",
      "name": "Qwen 7B",
      "type": "llm",
      "description": "通义千问 7B 模型",
      "size": "7B",
      "downloaded": true,
      "path": "./data/downloads/LLM/qwen-7b.gguf",
      "engine": "vulkan",
      "settings": {
        "context_size": 4096,
        "temperature": 0.7,
        "gpu_layers": 35
      },
      "status": "stopped",
      "port": null,
      "created_at": "2026-03-03T12:00:00Z",
      "updated_at": "2026-03-03T12:00:00Z"
    }
  ]
}
```

## 使用模型

1. 在主页找到要使用的模型
2. 点击"启动"按钮启动模型后端
3. 等待状态变为"运行中"
4. 点击"使用"按钮进入对应界面

## 常见问题

### 端口被占用

如果 3000 或 5173 端口被占用，可以修改:
- 后端端口: `backend/src/index.js` 中的 `PORT` 变量
- 前端端口: `frontend/vite.config.js` 中的 `server.port`

### 模型启动失败

1. 检查 AI 后端是否正确安装
2. 检查模型文件路径是否正确
3. 查看后端日志获取详细错误信息

### 前端无法连接后端

确保后端服务器正在运行，并且前端的代理配置正确。

## 下一步

- 配置 ModelScope API Token（在 `data/config.json` 中）
- 添加更多模型
- 探索不同的模型类型和功能

## 获取帮助

如有问题，请查看:
- README.md - 完整文档
- GitHub Issues - 报告问题
