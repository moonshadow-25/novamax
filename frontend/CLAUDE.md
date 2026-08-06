# 前端

- React 18 + Vite 5 + Ant Design 5 + React Router v6；生产构建输出到 `frontend/dist`，由 Express 托管。
- 所有后端调用通过 `src/services/api.js` 的命名服务进行；axios 实例的 base URL 是 `/api`，响应已解包。
- Vite 开发服务器将 `/api` 代理至 `http://localhost:3001`；不代理 `/v1`。开发时测试 OpenAI TTS 兼容端点需直接请求后端。
- 前端路由和组件位置可从 `src/pages/`、`src/components/` 与路由配置中查找。
- 修改前端后必须运行 `npm run build` 验证。
