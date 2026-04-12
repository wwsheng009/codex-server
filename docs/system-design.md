# codex-server 系统设计方案

更新时间：2026-04-11

关联文档：

- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-implementation-status-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\hooks-compatible-governance-layer-design-2026-04-10.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\hooks-governance-coverage-matrix-2026-04-10.md`

## 1. 目标

`codex-server` 的目标是把 `codex app-server` 封装为一个面向浏览器的 Web 应用，提供接近桌面客户端的完整 Codex 使用体验，包括：

- 多会话管理
- 聊天入口
- 流式回复渲染
- 命令执行展示
- 文件变更 / diff 展示
- 审批流
- review 能力
- 模型、技能、应用、插件等目录能力
- 账号状态与速率限制展示

本项目建议采用：

- 后端：Go
- 前端：React + Vite
- Codex 运行时：`codex app-server --listen stdio://`
- 可选模型目录覆盖：通过 `CODEX_MODEL_CATALOG_JSON` 注入 `model_catalog_json`
- 可选 `LocalShell` 自动派生：通过 `CODEX_LOCAL_SHELL_MODELS` 基于完整模型目录生成覆盖 catalog

## 2. 总体架构

不建议让浏览器直接连接 `codex app-server`。推荐结构如下：

```text
React + Vite SPA
   |
   | HTTP / WebSocket
   v
Go BFF / Gateway
   |
   | stdio JSON-RPC
   v
codex app-server
   |
   v
codex-core / workspace / shell / tools
```

### 设计原则

1. 浏览器只和 Go 后端通信
2. Go 后端负责 `app-server` 生命周期、鉴权、审计和工作区隔离
3. `codex app-server` 作为 sidecar 运行时，保持官方协议语义
4. Go 后端内部可以叠加 hooks-compatible 治理层与事件驱动 fallback 层，例如
   `hooks.Service` 负责前置拦截、显式 hook run 审计与部分执行期治理，
   `turnpolicies.Service` 负责后置补救、自动 follow-up、审计与指标聚合
5. 如需覆盖模型能力元数据（例如把某个模型的 `shell_type` 改成 `local`），后端可通过
   `CODEX_MODEL_CATALOG_JSON` 在启动时追加 `--config model_catalog_json=...`
6. 如需按配置自动启用 `LocalShell`，后端可读取 `CODEX_LOCAL_SHELL_MODELS`，基于完整模型目录
   生成派生 catalog，再把该派生 catalog 注入到 app-server 启动命令
7. 前端不直接消费原始 JSON-RPC，而消费后端包装后的 Web API 与事件流

## 3. 关键约束

### 3.1 不让浏览器直连 app-server

原因：

- `app-server` 的 WebSocket 不是生产优先接口
- 浏览器环境不适合直接承接服务端反向请求与复杂状态编排
- 命令执行、文件操作都发生在服务端机器，不应暴露为浏览器直连能力

### 3.2 工作区是服务端资源

Web 版产品中，用户操作的是服务端工作区，不是浏览器本地磁盘。

因此：

- `thread/shellCommand`
- `command/exec`
- `fs/*`

都作用于后端运行环境中的工作区。

### 3.3 审批流是一等功能

审批不是补充能力，而是主链路之一。前端必须完整支持：

- 命令审批
- 文件变更审批
- `requestUserInput`

## 4. 运行时模型

建议采用：

- 1 个 `workspace runtime` = 1 个 `codex app-server` 进程
- 1 个 runtime 管理多个 thread
- 多个浏览器连接共享同一 runtime

不建议：

- 1 个 thread 起 1 个进程
- 1 个浏览器 tab 起 1 个进程

### Runtime 生命周期

1. 用户打开某个工作区
2. Go 后端检查对应 runtime 是否存在
3. 不存在则拉起 `codex app-server`
4. Go 后端完成 `initialize` / `initialized`
5. 建立 stdout/stderr / stdin JSON-RPC 桥接
6. 前端通过 WebSocket 订阅该工作区事件流

## 5. 后端模块设计

建议的 Go 包结构：

```text
backend/
  cmd/server/
  internal/
    api/
    auth/
    workspace/
    runtime/
    bridge/
    threads/
    turns/
    hooks/
    turnpolicies/
    approvals/
    catalog/
    execfs/
    events/
    store/
```

### 5.1 `api`

职责：

- 暴露 HTTP / WebSocket 接口
- 请求鉴权
- 参数校验
- 返回标准错误结构

### 5.2 `auth`

职责：

- Web 用户登录态
- 用户 / 组织 / 权限模型
- 对 Codex 账号能力的统一包装

### 5.3 `workspace`

职责：

- 工作区注册
- 代码目录管理
- 工作区白名单
- 工作区配置

### 5.4 `runtime`

职责：

- 启动 / 关闭 `codex app-server`
- 维护进程状态
- 健康检查
- 自动重连 / 自动清理

### 5.5 `bridge`

职责：

- JSON-RPC 编解码
- request id 映射
- response / notification 分发
- server request 跟踪

### 5.6 `threads`

职责：

- `thread/start`
- `thread/list`
- `thread/read`
- `thread/resume`
- `thread/fork`
- `thread/archive`
- `thread/unarchive`
- `thread/name/set`
- `thread/rollback`

### 5.7 `turns`

职责：

- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `review/start`

### 5.8 `approvals`

职责：

- 审批请求缓存
- 审批响应路由
- `tool/requestUserInput` 响应

### 5.9 `hooks`

职责：

- 运行 hooks-compatible 治理主链
- 对可稳定接入的 server request 做前置拦截
- 在关键 server request / item / turn 事件上记录 hook run
- 复用 `turns.Service` 执行部分治理动作
- 持久化 `HookRun` 审计记录

当前边界：

- `item/tool/call` 是当前稳定的前置拦截入口
- `mcpServer/elicitation/request` 当前是显式 `ServerRequest` 审计面
- 关键 `mcpToolCall` 当前是审计型 `PostToolUse` 覆盖
- 截至 2026-04-10，仓库内还不存在独立的 native MCP pre-exec request surface

### 5.10 `turnpolicies`

职责：

- 订阅 `events.Hub` 的统一事件流
- 在 `item/completed` 与 `turn/completed` 上运行 turn policy
- 复用 `turns.Service` 执行 `turn/steer`、`turn/start` 等动作
- 持久化 `TurnPolicyDecision` 审计记录
- 聚合 thread / workspace 级 turn policy KPI

当前定位：

- 作为后置补救、自动续跑、KPI 聚合与 fallback 层存在
- 不再适合被表述为唯一治理入口

当前已实现的首期规则包括：

- 验证命令失败时自动 `turn/steer`
- 本轮存在 `fileChange` 但之后没有成功验证时自动 follow-up `turn/start`

### 5.11 `catalog`

职责：

- `model/list`
- `skills/list`
- `app/list`
- `plugin/list`
- `collaborationMode/list`

### 5.12 `execfs`

职责：

- `command/exec*`
- `fs/*`

### 5.13 `events`

职责：

- 工作区事件总线
- thread 级别订阅
- WebSocket fan-out
- reconnect 后状态补偿

### 5.14 `store`

职责：

- 用户元数据
- 工作区元数据
- 前端偏好设置
- runtime 缓存信息

注意：Codex 自身 thread / rollout 内容仍以 `app-server` / Codex 侧持久化为主，不建议由业务库重复存整份会话。

## 6. 前端模块设计

建议的 React 目录结构：

```text
frontend/
  src/
    app/
    pages/
    components/
    features/
      workspaces/
      threads/
      turns/
      approvals/
      terminal/
      diff/
      account/
      settings/
      catalog/
    lib/
    hooks/
    stores/
    types/
```

## 7. 主要页面与面板

### 7.1 工作区页

展示：

- 工作区列表
- 当前工作区状态
- runtime 状态

### 7.2 多会话列表

展示：

- thread 名称
- 最近更新时间
- 归档状态
- loaded / active / idle 状态
- 搜索与筛选

### 7.3 聊天主界面

展示：

- 当前 thread 的 turn 时间线
- Item 级内容流
- 正在运行中的 turn
- 中断按钮
- 右侧 workbench rail 中的 thread tools、recent turn policy decisions、turn policy metrics

### 7.4 审批抽屉

展示：

- 待审批命令
- 待审批文件变更
- request user input 表单

### 7.5 终端面板

展示：

- `command/exec` 输出
- 交互式命令执行状态
- 可选 stdin 写入

### 7.6 Diff 面板

展示：

- 文件变更摘要
- patch 预览
- 通过 / 拒绝入口

### 7.7 账号与设置页

展示：

- 当前 auth 状态
- API Key 登录
- rate limit
- 模型与模式配置

### 7.8 技能 / 应用 / 插件页

展示：

- skills 列表
- app connectors
- plugin marketplace 基础信息

## 8. 前端状态模型

### 8.1 核心对象

- `Workspace`
- `Thread`
- `Turn`
- `Item`
- `PendingApproval`
- `CommandSession`

### 8.2 建议状态管理

推荐：

- React Query：请求缓存
- Zustand / Redux Toolkit：会话中的本地 UI 状态

划分建议：

- 服务端数据：React Query
- 实时事件合并后的会话状态：Zustand
- 弹窗 / 抽屉 / tab 等视图状态：Zustand

## 9. Web API 设计

Go 后端对前端暴露统一 REST + WebSocket 接口。

### 9.1 工作区接口

- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/:workspaceId`

### 9.2 Thread 接口

- `GET /api/workspaces/:workspaceId/threads`
- `GET /api/workspaces/:workspaceId/threads/loaded`
- `POST /api/workspaces/:workspaceId/threads`
- `GET /api/workspaces/:workspaceId/threads/:threadId`
- `POST /api/workspaces/:workspaceId/threads/:threadId/resume`
- `POST /api/workspaces/:workspaceId/threads/:threadId/fork`
- `POST /api/workspaces/:workspaceId/threads/:threadId/archive`
- `POST /api/workspaces/:workspaceId/threads/:threadId/unarchive`
- `POST /api/workspaces/:workspaceId/threads/:threadId/name`
- `POST /api/workspaces/:workspaceId/threads/:threadId/metadata`
- `POST /api/workspaces/:workspaceId/threads/:threadId/rollback`
- `POST /api/workspaces/:workspaceId/threads/:threadId/compact`

### 9.3 Turn 接口

- `POST /api/workspaces/:workspaceId/threads/:threadId/turns`
- `POST /api/workspaces/:workspaceId/threads/:threadId/turns/steer`
- `POST /api/workspaces/:workspaceId/threads/:threadId/turns/interrupt`
- `POST /api/workspaces/:workspaceId/threads/:threadId/review`

### 9.4 Turn Policy 接口

- `GET /api/workspaces/:workspaceId/turn-policy-decisions`
  - 支持 `threadId`
  - 支持 `limit`
- `GET /api/workspaces/:workspaceId/turn-policy-metrics`
  - 支持可选 `threadId`

### 9.5 审批接口

- `GET /api/workspaces/:workspaceId/pending-approvals`
- `POST /api/server-requests/:requestId/respond`

### 9.6 命令与文件接口

- `POST /api/workspaces/:workspaceId/commands`
- `POST /api/workspaces/:workspaceId/commands/:processId/write`
- `POST /api/workspaces/:workspaceId/commands/:processId/resize`
- `POST /api/workspaces/:workspaceId/commands/:processId/terminate`
- `POST /api/workspaces/:workspaceId/fs/read`
- `POST /api/workspaces/:workspaceId/fs/write`
- `POST /api/workspaces/:workspaceId/fs/read-directory`
- `POST /api/workspaces/:workspaceId/fs/metadata`
- `POST /api/workspaces/:workspaceId/fs/mkdir`
- `POST /api/workspaces/:workspaceId/fs/remove`
- `POST /api/workspaces/:workspaceId/fs/copy`

### 9.7 目录接口

- `GET /api/workspaces/:workspaceId/models`
- `GET /api/workspaces/:workspaceId/skills`
- `POST /api/workspaces/:workspaceId/skills/config/write`
- `GET /api/workspaces/:workspaceId/apps`
- `GET /api/workspaces/:workspaceId/plugins`
- `POST /api/workspaces/:workspaceId/plugins/read`
- `POST /api/workspaces/:workspaceId/plugins/install`
- `POST /api/workspaces/:workspaceId/plugins/uninstall`
- `POST /api/workspaces/:workspaceId/config/read`
- `POST /api/workspaces/:workspaceId/config/write`
- `POST /api/workspaces/:workspaceId/config/batch-write`
- `GET /api/workspaces/:workspaceId/config/requirements`
- `POST /api/workspaces/:workspaceId/config/mcp-server/reload`
- `POST /api/workspaces/:workspaceId/external-agent/detect`
- `POST /api/workspaces/:workspaceId/external-agent/import`
- `POST /api/workspaces/:workspaceId/search/files`
- `POST /api/workspaces/:workspaceId/feedback/upload`
- `GET /api/workspaces/:workspaceId/experimental-features`
- `GET /api/workspaces/:workspaceId/mcp-server-status`
- `POST /api/workspaces/:workspaceId/windows-sandbox/setup-start`
- `GET /api/workspaces/:workspaceId/collaboration-modes`

### 9.8 账号接口

- `GET /api/account`
- `POST /api/account/login`
- `POST /api/account/login/cancel`
- `POST /api/account/logout`
- `GET /api/account/rate-limits`

与 workspace 相关的授权入口：

- `POST /api/workspaces/:workspaceId/mcp/oauth/login`

### 9.9 事件流接口

- `GET /api/workspaces/:workspaceId/stream`（WebSocket）

## 10. WebSocket 事件模型

推荐后端输出统一 envelope：

```json
{
  "workspaceId": "ws_1",
  "threadId": "thr_1",
  "turnId": "turn_1",
  "method": "item/agentMessage/delta",
  "payload": {},
  "serverRequestId": null,
  "ts": "2026-03-19T14:00:00Z"
}
```

前端优先消费这些 method：

- `thread/started`
- `thread/status/changed`
- `thread/archived`
- `thread/unarchived`
- `thread/closed`
- `turn/started`
- `turn/completed`
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `item/reasoning/summaryTextDelta`
- `item/commandExecution/outputDelta`
- `command/exec/outputDelta`
- `account/updated`
- `account/rateLimits/updated`
- `skills/changed`
- `app/list/updated`

## 11. 聊天与多会话 UI 行为

### 11.1 Thread 列表

支持：

- 搜索
- 最近访问
- 状态标签
- fork
- archive / unarchive
- 自定义命名

### 11.2 聊天输入框

支持：

- 普通文本输入
- 模型选择
- approval policy
- sandbox policy
- collaboration mode
- mentions
  - skill
  - app
  - plugin

### 11.3 Turn 渲染

不同 `item.type` 对应不同 UI：

- `agentMessage`：Markdown
- `reasoning`：可折叠推理摘要
- `plan`：计划卡片
- `commandExecution`：命令输出卡片
- `fileChange`：Diff 卡片
- `dynamicToolCall` / `mcpToolCall`：工具调用卡片

## 12. 审批流设计

### 12.1 后端

后端要维护：

- `pendingServerRequests`
- requestId 到 workspace / thread / turn 的映射

并需要区分两类不同的 server request 面：

- `item/tool/call`
  - 当前 runtime 可同步前置拦截的 dynamic tool request
- `mcpServer/elicitation/request`
  - MCP 向用户收集输入的 request 面
  - 当前应视为显式审计与交互请求，不等于 native MCP 工具前置 gate

### 12.2 前端

审批应双重展示：

- 当前 thread 时间线中的 pending 卡片
- 全局右侧审批抽屉

### 12.3 决策类型

至少支持：

- accept
- decline
- cancel
- 可能的 session 级放行

并应为以下 server request 预留前端表单与后端响应映射：

- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`
- `item/tool/call`
- `account/chatgptAuthTokens/refresh`

## 13. 安全设计

### 13.1 工作区隔离

- 每个用户仅能访问授权工作区
- 严格限制可操作路径
- `fs/*` 不允许逃逸 workspace root

### 13.2 命令执行安全

- 默认在受控工作区运行
- 命令与 patch 全部记录审计日志
- 高危能力通过审批流控制
- 对 `item/tool/call` 中的关键 dynamic tools 可做执行前 veto

### 13.3 hooks 治理边界

- 当前稳定的执行前门禁入口是 `item/tool/call`
- `mcpServer/elicitation/request` 与关键 `mcpToolCall` 当前都已纳入治理主链，但语义分别是显式审计和审计型 `PostToolUse`
- 截至 2026-04-10，仓库内不存在独立的 native MCP pre-exec request surface
- 不应把 dynamic tool 的前置拦截表述成“所有 MCP 工具都可前置门禁”
- 具体覆盖矩阵以 `hooks-governance-coverage-matrix-2026-04-10.md` 为准

### 13.4 认证与凭据

- Web 用户认证与 Codex 账号认证分离
- 服务端存储凭据时做加密或系统密钥保护

### 13.5 事件鉴权

- WebSocket 必须绑定用户身份
- 一个用户只能订阅自己可见的 workspace 事件

## 14. 推荐里程碑

### Phase 1

- 工作区管理
- thread 列表
- chat 主界面
- turn 流式渲染
- 基础审批流
- API key 登录

### Phase 2

- `command/exec`
- 文件 diff 展示
- thread fork / archive / rollback
- 模型与模式选择
- skills / apps 列表

### Phase 3

- review/start
- plugin 基础能力
- rate limits
- 专家控制台

### Phase 4

- realtime 能力
- 更完整插件能力
- 更强的审计与运维能力

## 15. 建议的初始目录

```text
codex-server/
  README.md
  docs/
    system-design.md
  backend/
  frontend/
```

## 16. 最终结论

本项目最合适的落地方式是：

- **Go 做后端网关 / BFF**
- **React + Vite 做多会话 Web UI**
- **`codex app-server` 作为后端 sidecar 运行时**

这个方案兼顾了：

- 官方协议兼容性
- 多会话体验
- 安全与审计
- 前端流式交互能力
- 后续扩展到 review / skills / apps / plugins / command exec 的完整能力面
