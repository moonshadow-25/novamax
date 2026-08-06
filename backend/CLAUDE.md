# 后端

- Node.js ESM + Express 4；所有本地导入必须带 `.js` 扩展名。
- `better-sqlite3` 是同步 API，查询不加 `await`。
- `backend/src/index.js` 按顺序初始化：`configManager`、`modelManager`、`engineManager`、`ttsWorkerManager`、`comfyuiInstanceManager`。
- 路由集中在 `src/routes/`，由 `src/index.js` 挂载；SSE 使用 `eventBus.broadcast(event, data)` 通过 `/api/events` 广播。
- TTS 引擎仅接收文本与 `voiceRef` 并返回音频；Voice ID 和业务流程由 NovaMax 管理。引擎类型归一化：剥离非字母数字字符并转小写。
- 不要启动、停止或 kill 后端进程。修改后端代码后告知用户自行重启。
