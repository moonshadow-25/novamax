# 修复下载取消功能

## 问题

之前的实现中，取消下载按钮无法正确终止 Python 下载进程。

## 已修复的内容

1. **暂停下载**：现在会正确终止 Python 进程（发送 SIGTERM 信号）
2. **取消下载**：现在会强制终止 Python 进程树（在 Windows 上使用 taskkill）
3. **进程管理**：保存 Python 进程引用，可以随时终止
4. **状态检测**：区分正常结束、暂停和取消的情况

## 如何使用

### 如果当前有无法取消的下载

1. **终止所有进程**
   ```bash
   kill-downloads.bat
   ```
   这会终止所有 Python 和 Node.js 进程，包括正在下载的进程。

2. **重启后端**
   ```bash
   restart-backend.bat
   ```
   重启后端服务。

3. **清理下载文件**（可选）
   ```bash
   clean-downloads.bat
   ```
   如果需要清理已下载的文件。

### 正常使用流程

1. **开始下载**
   - 前端选择量化版本
   - 点击"确定"开始下载

2. **暂停下载**
   - 点击"暂停"按钮
   - Python 进程会被终止
   - 下载状态保存为"已暂停"
   - 可以点击"继续下载"恢复

3. **取消下载**
   - 点击"取消下载"按钮
   - Python 进程会被强制终止
   - 已下载的文件会被删除
   - 模型状态重置为未下载

## 工作原理

### 暂停下载
```javascript
downloadState.pythonProcess.kill('SIGTERM');  // 优雅终止
downloadState.status = 'paused';
```

### 取消下载（Windows）
```bash
taskkill /pid {pid} /T /F
# /T - 终止进程树（包括子进程）
# /F - 强制终止
```

### 取消下载（Linux/Mac）
```javascript
pythonProcess.kill('SIGKILL');  // 强制终止
```

## 故障排除

### 取消按钮没反应

1. 检查后端日志，看是否有错误信息
2. 确认后端服务正在运行
3. 尝试刷新前端页面

### Python 进程没有被终止

1. 手动运行 `kill-downloads.bat`
2. 或者手动打开任务管理器，终止 `python.exe` 进程

### 下载状态不更新

1. 刷新前端页面
2. 检查后端日志
3. 确认模型数据库状态：查看 `backend/data/models/llm.json`

## 测试

创建一个测试：

1. 开始下载一个较大的模型
2. 等待几秒钟
3. 点击"取消下载"
4. 检查：
   - Python 进程是否被终止（任务管理器）
   - 下载目录是否被清理（`data/downloads/llm/`）
   - 模型状态是否重置（前端显示"下载模型"按钮）

## 日志检查

后端会输出以下日志：

```
已强制终止 Python 进程树: {pid}
已删除下载目录: {path}
下载已被取消: {modelId}
```

如果看到这些日志，说明取消操作成功。
