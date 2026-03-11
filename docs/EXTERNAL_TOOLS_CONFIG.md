# 外部工具配置指南

## 📦 减少包体积 - 使用外部工具

通过配置外部工具路径，可以将包体积从 **~368MB** 减少到 **~20MB**！

## 🎯 工作原理

NovaMax 可以使用系统已安装的工具，而不是打包内置版本：

```
默认（内置所有工具）：
release/
├── external/
│   ├── node/ (86MB)
│   ├── python313/ (232MB)
│   └── llamacpp/ (50MB)
└── backend/ (21MB)
总计：~368MB

使用外部工具：
release/
└── backend/ (21MB)
总计：~20MB  ← 减少 95% 体积！
```

## ⚙️ 配置步骤

### 1. 编辑配置文件

编辑 `backend/config/external-paths.json`：

```json
{
  "node": "C:\\Program Files\\nodejs\\node.exe",
  "python": "C:\\Python313\\python.exe",
  "llamacpp": "C:\\tools\\llamacpp"
}
```

**说明：** 配置非常简单，直接写路径即可。如果路径存在就使用，不存在则使用默认的 `external/` 目录。

### 2. 安装外部工具

#### Node.js 18+
```powershell
# 下载并安装
# https://nodejs.org/

# 验证安装
node --version  # 应显示 v18.x 或更高
```

#### Python 3.13+
```powershell
# 下载并安装
# https://www.python.org/downloads/

# 验证安装
python --version  # 应显示 3.13.x

# 安装必要的包
pip install modelscope huggingface_hub
```

#### llama.cpp
```powershell
# 下载预编译版本
# https://github.com/ggerganov/llama.cpp/releases

# 或从项目复制
copy external\llamacpp C:\tools\llamacpp
```

### 3. 验证配置

```powershell
# 启动服务，查看日志
cd backend
node src/index.js

# 应该看到：
# ✓ 已加载外部工具配置
#   → 使用 Node.js: C:\Program Files\nodejs\node.exe
#   → 使用 Python: C:\Python313\python.exe
#   → 使用 llama.cpp: C:\tools\llamacpp
```

## 📋 路径配置说明

### 使用系统工具（绝对路径）
```json
{
  "python": "C:\\Python313\\python.exe"
}
```

### 使用打包内置工具（相对路径，默认）
```json
{
  "python": "external/python313/python.exe"
}
```
相对路径是相对于项目根目录。

### 路径判断逻辑
- 如果配置的路径存在 → 使用该路径
- 如果配置的路径不存在 → 使用默认路径（bundledPath）
- 不需要 `enabled` 开关，根据路径自动判断

## 🚀 打包精简版

### 打包命令

```powershell
# 完整版（包含 external，默认）
cd backend
npm run build

# 精简版（不包含 external）
cd backend
$env:SKIP_EXTERNAL = "true"
npm run build
```

**注意：** 精简版需要用户自己配置 `external-paths.json` 指向系统已安装的工具。

## 💼 分发方案

### 方案1：完整包（推荐）
- 包含所有工具（external 目录）
- 解压即用，无需配置
- 体积：~368MB
- 配置：默认的 `external-paths.json`

### 方案2：精简包
- 不包含 external 目录
- 用户需要自行安装并配置工具
- 体积：~20MB
- 配置：修改 `external-paths.json` 指向系统工具路径

**配置示例（精简包）：**
```json
{
  "node": "C:\\Program Files\\nodejs\\node.exe",
  "python": "C:\\Python313\\python.exe",
  "llamacpp": "C:\\tools\\llamacpp"
}
```

## 📊 体积对比

| 组件 | 大小 | 必需 | 可外置 |
|------|------|------|--------|
| backend 代码 | 21 MB | ✅ | ❌ |
| frontend | 1 MB | ✅ | ❌ |
| Node.js | 86 MB | ✅ | ✅ 需修改启动方式 |
| Python | 232 MB | ✅ | ✅ |
| llamacpp | 50 MB | ✅ | ✅ |
| **完整包** | **368 MB** | - | - |
| **精简包** | **20 MB** | - | - |

## ⚠️ 注意事项

### Node.js 特殊说明
- Node.js 统一放在 `external/node/` 目录
- 启动脚本：`external\node\node.exe backend\src\index.js`
- 如果要使用系统 Node.js:
  1. 编辑 `external-paths.json`：`{"node": "C:\\Program Files\\nodejs\\node.exe"}`
  2. 修改 `NovaMax.bat`：改为 `node backend\src\index.js`
- **建议**：保持默认配置，使用打包的 Node.js

### 版本要求
- Python: 3.13+
- Node.js: 18+
- llama.cpp: 最新版本

### 配置优先级
```
1. external-paths.json 配置的路径（如果存在）
2. bundledPath（默认路径，通常是 external/ 目录）
3. 无法找到 → 功能异常
```

## 🔧 故障排查

### 找不到工具
```
⚠ 配置的 Python 不存在: xxx, 使用默认路径
```
**解决：** 检查 `external-paths.json` 中的路径是否正确，文件是否存在

### 权限问题
**Windows:** 右键 → 以管理员身份运行

### 配置不生效
```powershell
# 重启服务
# 配置会在启动时重新加载
```

## 📚 相关文档

- [PACKAGE_QUICK_START.md](./PACKAGE_QUICK_START.md) - 打包指南和快速开始

---

**推荐配置：完整包模式，使用默认的 external 目录，无需额外配置。**
