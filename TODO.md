# NovaMax 开发任务清单

## Phase 1: 项目初始化和基础架构 ✅ 已完成

- [x] 创建项目目录结构
- [x] 初始化前端项目 (React + Vite + Ant Design)
- [x] 初始化后端项目 (Express.js)
- [x] 配置开发环境
- [x] 创建基础配置文件和数据模型
- [x] 实现主题切换功能
- [x] 实现基础路由配置
- [x] 创建模型管理 API
- [x] 创建进程管理系统
- [x] 创建 LLM 对话界面

## Phase 2: ModelScope 集成 🚧 待开发

### 2.1 研究 ModelScope API
- [ ] 阅读 ModelScope API 文档
- [ ] 测试 API 调用
- [ ] 确认认证方式（API Token）
- [ ] 确认模型元数据格式

### 2.2 实现 ModelScopeService
- [ ] 创建 `backend/src/services/modelscope.js`
- [ ] 实现 `getModelsByType(type)` 方法
- [ ] 实现 `searchModels(keyword, type)` 方法
- [ ] 实现 `getModelDetail(modelId)` 方法
- [ ] 实现 `getDownloadUrl(modelId)` 方法
- [ ] 添加缓存机制

### 2.3 更新 API 路由
- [ ] 完善 `routes/modelscope.js`
- [ ] 测试 API 端点

### 2.4 更新前端
- [ ] 完善 `AddModelModal` 组件
- [ ] 实现模型搜索功能
- [ ] 显示 ModelScope 模型列表

## Phase 3: 下载管理系统 🚧 待开发

### 3.1 实现 DownloadManager
- [ ] 创建 `backend/src/services/downloadManager.js`
- [ ] 实现 `startDownload(modelId, modelInfo)` 方法
- [ ] 实现 `pauseDownload(downloadId)` 方法
- [ ] 实现 `resumeDownload(downloadId)` 方法
- [ ] 实现 `cancelDownload(downloadId)` 方法
- [ ] 实现 `getProgress(downloadId)` 方法
- [ ] 实现断点续传
- [ ] 实现文件完整性验证

### 3.2 实现 WebSocket
- [ ] 添加 WebSocket 服务器
- [ ] 实现进度推送
- [ ] 前端 WebSocket 客户端

### 3.3 更新 API 路由
- [ ] 完善 `routes/download.js`
- [ ] 测试下载功能

### 3.4 更新前端
- [ ] 实现下载进度显示
- [ ] 实现下载管理界面
- [ ] 实现暂停/恢复/取消功能

## Phase 4: 完善 LLM 功能 🚧 待开发

### 4.1 流式响应
- [ ] 实现 SSE (Server-Sent Events)
- [ ] 前端流式响应处理
- [ ] 显示打字机效果

### 4.2 对话历史
- [ ] 实现对话历史持久化
- [ ] 实现对话历史加载
- [ ] 实现多会话管理

### 4.3 设置界面
- [ ] 完善 `Settings.jsx`
- [ ] 实现参数配置表单
- [ ] 实现引擎选择（Vulkan/ROCm）
- [ ] 保存设置到模型配置

### 4.4 优化
- [ ] Markdown 渲染
- [ ] 代码高亮
- [ ] 复制消息功能
- [ ] 导出对话功能

## Phase 5: ComfyUI 功能 🚧 待开发

### 5.1 Workflow 参数映射
- [ ] 研究 ComfyUI workflow 格式
- [ ] 创建预定义模板
- [ ] 实现 LLM 自动分析 workflow
- [ ] 实现参数映射保存

### 5.2 生成界面
- [ ] 完善 `ComfyUI.jsx`
- [ ] 动态生成表单
- [ ] 实现图片上传
- [ ] 实现生成任务提交

### 5.3 进度和结果
- [ ] 实现生成进度追踪
- [ ] 实现结果预览
- [ ] 实现结果下载
- [ ] 实现历史记录

### 5.4 自定义 Workflow
- [ ] 实现 workflow 上传
- [ ] 实现 workflow 分析
- [ ] 实现手动参数映射

## Phase 6: TTS 功能 🚧 待开发

### 6.1 TTS 界面
- [ ] 完善 `TTS.jsx`
- [ ] 实现文本输入
- [ ] 实现参数调节（语速、音调）
- [ ] 实现声音选择

### 6.2 音频处理
- [ ] 实现音频生成
- [ ] 实现音频播放器
- [ ] 实现音频下载

### 6.3 API 集成
- [ ] 完善 `routes/tts.js`
- [ ] 集成 IndeTTS 后端

## Phase 7: Whisper 功能 🚧 待开发

### 7.1 Whisper 界面
- [ ] 完善 `Whisper.jsx`
- [ ] 实现文件上传
- [ ] 实现拖拽上传
- [ ] 实现语言选择
- [ ] 实现任务选择（转录/翻译）

### 7.2 识别处理
- [ ] 实现音频转录
- [ ] 实现进度显示
- [ ] 实现结果显示
- [ ] 实现结果导出

### 7.3 API 集成
- [ ] 完善 `routes/whisper.js`
- [ ] 集成 whisper.cpp 后端

## Phase 8: 优化和完善 🚧 待开发

### 8.1 错误处理
- [ ] 统一错误处理机制
- [ ] 友好的错误提示
- [ ] 错误日志记录

### 8.2 性能优化
- [ ] 前端代码分割
- [ ] 懒加载
- [ ] 缓存优化
- [ ] 内存管理

### 8.3 UI/UX 优化
- [ ] 响应式布局
- [ ] 加载状态优化
- [ ] 动画效果
- [ ] 快捷键支持

### 8.4 安全性
- [ ] 输入验证
- [ ] 文件上传安全
- [ ] API 限流

## Phase 9: 打包和部署 🚧 待开发

### 9.1 pkg 打包
- [ ] 配置 pkg
- [ ] 测试打包
- [ ] 优化打包大小
- [ ] 处理动态 require

### 9.2 启动脚本
- [ ] 优化 run.bat
- [ ] 创建 Linux/Mac 启动脚本
- [ ] 自动打开浏览器
- [ ] 错误处理

### 9.3 文档
- [ ] 用户手册
- [ ] 开发文档
- [ ] API 文档
- [ ] 故障排除指南

## Phase 10: 测试 🚧 待开发

### 10.1 功能测试
- [ ] 模型管理测试
- [ ] 进程管理测试
- [ ] LLM 对话测试
- [ ] ComfyUI 生成测试
- [ ] TTS 测试
- [ ] Whisper 测试

### 10.2 集成测试
- [ ] 端到端测试
- [ ] API 测试
- [ ] 错误场景测试

### 10.3 性能测试
- [ ] 负载测试
- [ ] 内存泄漏测试
- [ ] 并发测试

## 待确认问题

### ModelScope 相关
- [ ] ModelScope API 文档链接
- [ ] API Token 获取方式
- [ ] shoujiekeji 组织下的仓库列表
- [ ] 模型元数据格式示例

### AI 后端相关
- [ ] llama.cpp 启动命令和参数
- [ ] ComfyUI 启动命令和参数
- [ ] whisper.cpp 启动命令和参数
- [ ] IndeTTS 启动命令和参数
- [ ] 各后端的 API 规范

### ComfyUI 相关
- [ ] 示例 workflow JSON 文件
- [ ] 预定义 workflow 的类型和数量
- [ ] workflow 参数映射规则

## 优先级说明

- ✅ 已完成
- 🚧 待开发
- 🔥 高优先级
- ⭐ 中优先级
- 💡 低优先级

## 当前进度

- Phase 1: ✅ 100%
- Phase 2: 🚧 0%
- Phase 3: 🚧 0%
- Phase 4: 🚧 20%
- Phase 5: 🚧 0%
- Phase 6: 🚧 0%
- Phase 7: 🚧 0%
- Phase 8: 🚧 0%
- Phase 9: 🚧 0%
- Phase 10: 🚧 0%

总体进度: ~15%
