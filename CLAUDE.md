# NovaMax

## 关键规则：不要启动或停止后端进程

用户自己管理 Node 后端的启动、重启和停止。不要运行 `node src/index.js`、`npm start`、`npm run dev` 等后端命令，也不要 kill 后端进程。

- 修改后端代码后：告知用户重启后端。
- 修改前端代码后：运行 `cd frontend && npm run build`。
- 同时修改前后端：先编译前端，再告知用户重启后端。

## 项目约定

- 平台为 Windows 专用。后端使用 Node.js ESM；所有本地导入必须带 `.js` 扩展名。
- 服务通常遵循 class → 单例导出 → 异步 `init()` 的模式；路由导出 Express Router 或工厂函数。
- `frontend/src/services/api.js` 的 axios 响应拦截器已解包 `response.data`。调用 API 服务方法时直接使用返回数据，不再访问 `.data`。
- 项目没有测试框架、ESLint 或 Prettier；不要运行 `npm test` 或 `npm run lint`。前端变更用生产构建验证。
