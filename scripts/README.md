# NovaMax - AI 模型运行平台

## 🚀 快速开始

本项目自带运行环境（Node.js + Python），**无需额外安装**。

### 启动服务

**双击 `NovaMax.bat`**（显示控制台窗口，关闭窗口即停止）。

或在终端中使用 Python 启动（保持窗口打开，Ctrl+C 停止）：
```
external\python313\python.exe start_novamax.py
```

### 访问界面
浏览器访问 **http://localhost:3001**

### 停止服务
- NovaMax.bat 启动：关闭控制台窗口
- 后台静默启动：双击 **Stop-NovaMax.bat**

## 📁 目录结构

- `NovaMax.bat` - 显示窗口启动
- `start_novamax.py` - 后台静默启动（推荐）
- `Stop-NovaMax.bat` - 停止服务
- `backend/` - 后端服务代码
- `frontend/` - 前端界面文件
- `external/node/` - Node.js 运行时（自带）
- `external/python313/` - Python 运行时（自带）
- `data/` - 用户数据和配置

## ⚙️ 配置说明

所有配置文件存储在 `data/` 目录：
- `models.json` - 模型列表
- `config.json` - 系统配置
- `presets.json` - 预设参数
- `parameters.json` - 运行参数

## 🔧 常见问题

### 端口被占用
如果提示端口 3001 被占用，编辑 `data/config.json` 修改端口配置。

### 启动报错找不到 Python
确保 `external/python313/python.exe` 文件存在。本项目自带 Python 运行时，无需系统安装 Python。

### 无法访问界面
检查防火墙是否拦截，或尝试访问 http://127.0.0.1:3001

## 📦 更新说明

更新时，只需备份 `data/` 目录，然后用新版本替换其他文件即可。

## 🗑️ 卸载

直接删除整个文件夹，无需卸载程序。
用户数据全部在本地，不会残留系统文件。

## 📊 系统要求

- Windows 10/11 (64位)
- 至少 4GB 内存
- 建议 SSD 硬盘

## 📚 技术信息

- 构建日期: {{BUILD_DATE}}
- 架构: 便携版 (无需安装)

## 🆘 获取帮助

如遇问题，请查看控制台输出的错误信息。
也可以访问项目主页获取帮助。

---

感谢使用 NovaMax！
