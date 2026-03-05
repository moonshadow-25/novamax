# NovaMax 开发规则

## ⚠️ 重要：后端运行规则

**绝对不要自己启动 Node 后端进程。**

- 用户自己管理后端的启动和重启
- 每次修改代码后，只需编译前端：`cd frontend && npm run build`
- 不要运行 `node src/index.js`、`npm start`、`npm run dev` 等后端命令
- 不要 kill 后端进程

## 技术栈

- 后端：Node.js (ESM)，Express，端口 3001
- 前端：React + Vite + Ant Design，编译输出到 `frontend/dist`
- 数据：JSON 文件存储在 `data/`

## 工作流程

1. 修改后端代码 → 告知用户重启后端
2. 修改前端代码 → `cd frontend && npm run build`
3. 同时修改前后端 → 先编译前端，再告知用户重启后端
