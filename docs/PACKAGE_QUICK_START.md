# 🚀 NovaMax 打包指南

NovaMax 采用**便携版打包方式** - Node.js + 源码直接打包，100% 兼容性，易于调试和更新。

## ⚡ 快速开始

```powershell
# 1. 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 2. 打包（会自动构建前端）
cd ../backend
npm run build
```

打包完成后，`release/` 目录即为可分发的完整应用。

## 📋 详细步骤

### 第一步：环境准备

确保已安装：
- Node.js 18+
- npm 或 yarn

```powershell
# 检查环境（可选）
cd backend
npm run check
```

### 第二步：安装依赖

```powershell
# 后端依赖
cd backend
npm install

# 前端依赖
cd ../frontend
npm install
```

### 第三步：执行打包

```powershell
cd backend
npm run build
```

**打包过程：**
1. ✅ 清理旧的发布目录
2. ✅ 重新构建前端（确保最新）
3. ✅ 复制后端源码和 node_modules
4. ✅ 复制前端构建产物
5. ✅ 复制 external 目录（Node.js, Python, llamacpp）
6. ✅ 复制配置文件
7. ✅ 创建 data 目录和默认配置
8. ✅ 生成启动脚本和用户文档

## 📁 打包产物

打包完成后，`release/` 目录包含：

```
release/
├── NovaMax.bat          # 启动（显示窗口）
├── NovaMax-Silent.vbs   # 启动（后台运行）
├── Stop-NovaMax.bat     # 停止服务
├── README.txt           # 用户说明
├── backend/             # 后端代码
│   ├── src/
│   ├── node_modules/
│   └── config/
│       └── external-paths.json
├── frontend/            # 前端文件
│   └── dist/
├── external/            # 外部工具
│   ├── node/            # Node.js
│   ├── python313/       # Python
│   └── llamacpp/        # llama.cpp
└── data/                # 用户数据
```

## 📦 分发给用户

### 压缩打包

```powershell
# 使用 7-Zip（推荐）
7z a -mx9 NovaMax.zip release/

# 或使用 Windows 内置压缩
Compress-Archive -Path release/* -DestinationPath NovaMax.zip
```

### 用户使用

1. 解压到任意目录
2. 双击 `NovaMax.bat`（或 `NovaMax-Silent.vbs` 后台运行）
3. 浏览器自动打开 http://localhost:3001
4. 开始使用！

### 停止服务

- 方式1：关闭控制台窗口或按 Ctrl+C
- 方式2：双击 `Stop-NovaMax.bat`
- 方式3：任务管理器结束 node.exe 进程

### 卸载

直接删除整个目录即可，无需卸载程序，不会残留系统文件。

## 🔧 高级配置

### 精简打包（减小体积）

```powershell
# 不包含 external 目录（从 ~368MB 减到 ~20MB）
$env:SKIP_EXTERNAL = "true"
cd backend
npm run build
```

**注意：** 精简版需要用户配置 `backend/config/external-paths.json` 指向系统工具。详见 [EXTERNAL_TOOLS_CONFIG.md](./EXTERNAL_TOOLS_CONFIG.md)

### 自定义打包内容

编辑 `backend/build-portable.js`，修改复制逻辑：

```javascript
// 排除特定 node_modules
copyDirectory(nodeModulesSrc, nodeModulesDest, ['pkg', '.cache', '.bin', 'your-exclude']);

// 添加额外文件
fs.copyFileSync(sourcePath, destPath);
```

### 更换 Node.js 版本

替换 `external/node/node.exe` 为你需要的版本即可。

## 🐛 故障排查

### 打包失败

```powershell
# 清理并重新安装依赖
cd backend
rm -rf node_modules
npm install

# 重新打包
npm run build
```

### 服务无法启动

- 检查杀毒软件是否拦截
- 确保 `external/` 目录完整
- 查看端口 3001 是否被占用
- 查看控制台错误信息

### Python 脚本无法执行

- 确保 `external/python313/python.exe` 存在
- 检查 Python 脚本路径是否正确
- 查看文件权限

### 前端页面显示错误

- 确保 `frontend/dist/index.html` 存在
- 重新构建前端：`cd frontend && npm run build`
- 然后重新打包

## 📊 优化建议

### 减小体积

1. **使用精简打包**
   ```powershell
   $env:SKIP_EXTERNAL = "true"
   npm run build
   ```

2. **清理 external 目录**
   - 移除不需要的 Python 库
   - 删除 llamacpp 调试符号

3. **优化 node_modules**
   ```powershell
   npm install --production
   ```

4. **使用高压缩**
   ```powershell
   7z a -mx9 NovaMax.7z release/
   ```

### 性能优化

- 使用最新的 Node.js LTS 版本
- 前端已启用 Vite Tree-shaking 和代码分割
- 配置静态资源 CDN（可选）

## 🔒 安全提示

- 不要在代码中硬编码敏感信息
- 用户数据保存在 `data/` 目录，更新时注意备份
- Python 环境是独立的，不会影响系统

## 📚 相关文档

- [EXTERNAL_TOOLS_CONFIG.md](./EXTERNAL_TOOLS_CONFIG.md) - 外部工具配置（精简打包）
- [CLAUDE.md](../CLAUDE.md) - 开发规则

## 🎯 技术架构

```
用户浏览器 (Web)
    ↓ HTTP
Node.js (external/node/node.exe) + 后端代码 (端口 3001)
    ↓ 调用
external/python313/python.exe  （ModelScope/HuggingFace 下载）
external/llamacpp/             （LLM 模型运行）
```

## 💡 打包特点

- **100% 兼容**：直接运行源码，支持所有 Node.js 特性（包括 ESM）
- **易于调试**：用户可查看和修改源码
- **简单更新**：替换文件即可，无需重新安装
- **路径自适应**：自动检测开发环境或便携版环境

---

**打包体积：** 完整版 ~368MB | 精简版 ~20MB  
**最后更新：** 2026-03-11  
**首次打包？** 运行 `npm run check` 检查环境！
