# 清理遗留下载状态

## 问题

即使终止了 Python 下载进程，模型仍然显示"正在下载"状态。这是因为后端记录的下载状态没有被清理。

## 解决方案

### 方法一：重启后端（推荐）

后端现在会在启动时**自动清理**所有遗留的下载状态。

```bash
# 1. 终止进程
kill-downloads.bat

# 2. 重启后端
restart-backend.bat
```

重启后，所有卡在 "downloading" 或 "paused" 状态的模型会被自动标记为 "failed"（下载失败）。

### 方法二：手动清理（不需要重启）

如果不想重启后端，可以手动调用清理 API：

```bash
cleanup-download-status.bat
```

或者手动调用 API：

```bash
curl -X POST http://localhost:3000/api/download/cleanup
```

## 自动清理逻辑

后端启动时会检查所有模型：

```javascript
for (const model of allModels) {
  if (model.download_status === 'downloading' || model.download_status === 'paused') {
    // 标记为失败，因为进程已经不存在了
    await modelManager.update(model.id, {
      download_status: 'failed',
      download_error: '下载已中断（服务重启）'
    });
  }
}
```

## 完整的清理流程

如果有无法取消的下载：

1. **终止所有进程**
   ```bash
   kill-downloads.bat
   ```
   - 终止 Python 下载进程
   - 终止 Node.js 后端进程

2. **重启后端**
   ```bash
   restart-backend.bat
   ```
   - 启动后端
   - **自动清理遗留下载状态**

3. **刷新前端**
   - 按 F5 刷新浏览器
   - 应该看到模型状态已重置

## 前端显示

清理后，模型会显示：
- 状态：下载失败
- 错误信息：下载已中断（服务重启）
- 可以点击"重试"按钮重新下载

## API 文档

### POST /api/download/cleanup

清理所有遗留的下载状态。

**请求：**
```bash
POST http://localhost:3000/api/download/cleanup
```

**响应：**
```json
{
  "success": true,
  "message": "已清理遗留的下载状态"
}
```

**后端日志：**
```
检查并清理遗留的下载状态...
清理遗留下载状态: model-123 (downloading)
清理遗留下载状态: model-456 (paused)
✓ 已清理 2 个遗留的下载状态
```

## 常见问题

### Q: 清理后数据会丢失吗？

A: 不会。清理只是重置下载状态，不会删除：
- 模型配置
- 已完成下载的文件
- 其他模型数据

### Q: 为什么标记为"失败"而不是删除状态？

A: 这样用户可以：
1. 知道之前有下载任务被中断
2. 点击"重试"按钮继续下载
3. 保留下载进度信息（如果支持断点续传）

### Q: 如何避免遗留状态？

A: 正确使用取消功能：
1. 使用前端的"取消下载"按钮（修复后应该能正常工作）
2. 不要直接杀进程或强制关闭后端

## 总结

现在有三种清理方式：

1. **自动清理**：后端启动时自动执行
2. **手动清理（重启）**：运行 `restart-backend.bat`
3. **手动清理（不重启）**：运行 `cleanup-download-status.bat`

推荐在遇到问题时使用方法 2（重启后端），因为它会同时清理进程和状态。
