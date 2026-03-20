# codex-server

基于 `Go + React + Vite + codex app-server` 的 Web 版 Codex 应用。

## 目录

- `docs/`：架构与方案文档
- `backend/`：Go 后端网关 / BFF 骨架
- `frontend/`：React + Vite 前端骨架

## 当前状态

当前已完成：

- `docs/system-design.md`：总体架构与实施规划
- `backend/`：Go 服务入口、模块目录、REST/WS 骨架、真实 `codex app-server` stdio runtime 桥接
- workspace 与线程元数据已落盘到 `CODEX_SERVER_STORE_PATH` 指定的 JSON 文件
- `frontend/`：React + Vite 单页应用骨架、路由、React Query、Zustand、工作区/线程/审批页面
- 账号页支持 `API Key` / `ChatGPT` 登录入口
- 审批抽屉支持基础审批和 `requestUserInput` 问题填写
- 聊天页支持独立 `command/exec` 终端面板和流式输出展示
- 线程详情支持基于 `thread/read` 的历史 turn / item 回放
- 历史回放已按 `userMessage / agentMessage / plan / reasoning / commandExecution / fileChange` 分类渲染
- `Live Events` 区也已升级为专用事件卡片，而不是原始 JSON
- `Live Events` 已合并 thread 级与 workspace 级事件，覆盖连接、审批、终端、状态更新等卡片
- `Live Events` 中的 agent/reasoning/command delta 已按 `itemId` 或 `processId` 聚合显示
- 审批抽屉支持 `mcpServer/elicitation/request` 的动态表单渲染
- 后端已补 `fs/read-directory`、`fs/metadata`、`fs/mkdir`、`fs/remove`、`fs/copy`
- 后端已补 `plugins/read`、`plugins/install`、`plugins/uninstall`
- 后端已补 `config/read`、`config/write`、`config/batch-write`、`search/files`
- 后端已补 `config/requirements`、`external-agent/detect`、`external-agent/import`
- 后端已补 `skills/remote/list`、`skills/remote/export`、`feedback/upload`
- 后端已补 `threads/loaded`、`thread metadata`、`thread compact`
- 后端已补 `skills/config/write`、`experimental-features`、`mcp-server-status`
- 后端已补 `config/mcp-server/reload`、`windows-sandbox/setup-start`
- 前端 `Catalog` / `Settings` 页面已接入 remote skills、plugin actions、config、external agent detect、fuzzy file search、feedback upload
- 前端 `Settings` 页面已接入 `account/login/cancel` 和 `mcp/oauth/login`
- 审批抽屉已支持 `item/tool/call` 与 `account/chatgptAuthTokens/refresh` 的响应表单
- 线程侧栏支持搜索、状态筛选与最近更新时间展示
- 线程侧栏支持最近访问排序、归档分组与内联重命名
- 线程侧栏支持键盘导航：`/` 聚焦搜索，`↑/↓` 切换线程，`Esc` 退出重命名或搜索焦点
- 前端会恢复上次的 workspace/thread 选择、审批抽屉状态和线程侧栏筛选条件

## 启动方式

### 后端

```bash
cd backend
go mod tidy
go run ./cmd/server
```

默认监听：`http://localhost:18080`

可通过环境变量覆盖：

```bash
CODEX_SERVER_ADDR=:18080
CODEX_FRONTEND_ORIGIN=http://localhost:15173
CODEX_APP_SERVER_COMMAND="codex app-server --listen stdio://"
CODEX_SERVER_STORE_PATH=data/metadata.json
```

当 `CODEX_FRONTEND_ORIGIN` 指向本机回环地址（如 `localhost` / `127.0.0.1`）时，后端也会放行同协议下其他本机端口，避免 Vite 自动切到 `15174`、`15175` 时触发开发期 CORS 问题。

### 前端

```bash
cd frontend
npm install
npm run dev
npm test
```

默认地址：`http://localhost:15173`

如需指定后端地址，可设置：

```bash
VITE_API_BASE_URL=http://localhost:18080
```

## 下一步建议

- 细化 `docs/` 中的 API 请求/响应 DTO 与鉴权方案
- 完善 `requestUserInput`、更复杂审批 decision 和登录流程
- 将线程索引从当前进程内缓存升级为更稳定的持久层或官方可枚举会话索引
- 将当前 Windows 下为支持流式终端而启用的 `dangerFullAccess` 收敛回审批驱动策略

## 当前验证

- 后端：`go test ./...`
- 前端：`npm test`、`npm run build`
- 已覆盖前端关键纯逻辑：live timeline delta 聚合、thread render helper
- 已覆盖后端关键基础链路：workspace 元数据持久化、历史线程归属判断、扩展路由请求体验证
