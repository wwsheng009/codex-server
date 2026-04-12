# Codex `rust-v0.120.0` App-Server Impact Analysis

更新时间：2026-04-11

## 1. 结论

基于对 `openai/codex` `rust-v0.120.0` release、相关 PR、协议 schema diff，以及本仓库当前 `app-server` 接入面的静态比对，可以得出四个稳定判断：

1. 对当前仓库的主路径来说，`rust-v0.120.0` **没有发现必须先改本仓库代码才能升级 binary 的 breaking change**。
2. 当前仓库的真实主路径仍然是“浏览器 -> Go BFF -> workspace runtime -> 本地 `codex app-server --listen stdio://` sidecar”，因此 release 中不少 remote/websocket 相关修复 **暂时不在关键路径上**。
3. `rust-v0.120.0` 中真正需要进入本仓库 backlog 的 app-server 相关变化主要有两项：
   - `thread/start` 新增 `sessionStartSource`，允许区分普通 startup 与 `/clear` 后的 session start。
   - guardian review 相关通知新增稳定 `reviewId`，完成态新增 `decisionSource`。
4. Windows sandbox / symlink writable roots 相关修复，对当前仓库已经暴露的 `approvalPolicy`、`sandboxPolicy`、`command/exec`、`windows-sandbox/setup-start` 能力面是**直接正收益**，不需要先改 Go/React 代码。

一句话概括：

- **可以直接升级到 `rust-v0.120.0`。**
- **应补一个小型协议跟进工作流：优先为未来 `/clear` 语义预留 `sessionStartSource`，并同步更新本地 schema 产物。**

## 2. 分析范围与外部依据

本分析基于以下官方来源：

- release：<https://github.com/openai/codex/releases/tag/rust-v0.120.0>
- compare：<https://github.com/openai/codex/compare/rust-v0.119.0...rust-v0.120.0>
- 关键 PR：
  - `#17073` Support clear SessionStart source
  - `#17189` Emit live hook prompts before raw-event filtering
  - `#17223` fix: MCP leaks in app-server
  - `#17298` fix(guardian, app-server): introduce guardian review ids
  - `#14568` fix: support split carveouts in windows elevated sandbox
  - `#15981` fix(permissions): fix symlinked writable roots in sandbox permissions
  - `#17268` remove windows gate that disables hooks
  - `#17288` Install rustls provider for remote websocket client

本分析同时对照了当前仓库中的以下本地实现面：

- `backend/internal/appserver`
- `backend/internal/threads`
- `backend/internal/runtime`
- `backend/internal/hooks`
- `backend/internal/store`
- `frontend/src/pages/threadLiveState.ts`
- `backend/schema-out`

## 3. 当前仓库的真实 app-server 集成基线

### 3.1 当前主路径仍是本地 `stdio`

当前仓库的主路径不是 app-server websocket transport，而是本地 sidecar：

- `runtime.Manager` 通过 `bridge.Client` 启动和管理本地 runtime 子进程。
- JSON-RPC 主链路走子进程 `stdin/stdout/stderr`，而不是 `codex --remote wss://...`。
- 浏览器与后端之间的 WebSocket 只用于工作区/线程事件推送，不是 Codex runtime transport。

这意味着：

- 与 remote websocket client、remote control、连接订阅者清理强耦合的改动，不是当前主路径的兼容性阻断项。
- 当前升级分析应优先聚焦：
  - `thread/start` / `thread/resume` 请求结构
  - server notification shape
  - hooks / SessionStart 语义
  - sandbox / permission 实际运行收益

### 3.2 当前 `thread/start` / `thread/resume` 的本地边界

当前 `ThreadStartRequest` 本地定义只包含：

- `cwd`
- `approvalPolicy`
- `sandbox`
- `model`

当前 `ThreadResumeRequest` 只包含：

- `cwd`
- `threadId`

也就是说，当前仓库还没有任何 `thread/start` 级的扩展字段通道去承接 `sessionStartSource` 这类新语义。

### 3.3 当前 hooks-compatible 治理层的 `SessionStart` 语义

当前仓库已经自建了一层 hooks-compatible 治理能力，`SessionStart` 的核心特征如下：

- 语义上把它当作“首条 turn 前的项目上下文注入”。
- 是否执行，取决于线程是否已经存在对话 turn。
- 当前没有区分：
  - fresh startup
  - clear 后重新开始
  - resume 后重新附着

这使得 `v0.120.0` 新增的 `sessionStartSource` 对当前仓库虽然不是兼容性阻断，但确实形成了一个语义缺口。

## 4. `rust-v0.120.0` 对当前仓库的影响分类

## 4.1 必须进入 backlog 的协议/语义差异

### 4.1.1 `thread/start.sessionStartSource`

`#17073` 给 app-server v2 `ThreadStartParams` 新增了：

- `sessionStartSource?: "startup" | "clear"`

上游实际行为不是单纯补文档，而是把该字段真正接入到了 thread start 处理链路中：

- `startup` 对应正常的新 session start
- `clear` 对应 `/clear` 后的重新开始

对本仓库的影响如下：

- **当前不会导致升级失败**，因为该字段是可选的。
- 但**未来如果本仓库要支持 Codex 原生 `/clear` 语义**，当前 `ThreadStartRequest` 结构和 `buildThreadStartRequest(...)` 无法表达该来源。
- 当前本地 `SessionStart` 治理层也无法把“clear restart”与“fresh startup”区分开。

风险具体表现为：

- `SessionStart` hook run 的审计语义会过粗。
- 如果后续要按来源决定上下文注入、冷启动提示、治理节流或 UI 文案，当前模型不够用。
- 未来接 `/clear` 时，很容易把它误实现成“只是又一次 first turn”。

结论：

- 这是 `rust-v0.120.0` 里最值得在本仓库补一个小型适配的点。

### 4.1.2 guardian review 新增 `reviewId` / `decisionSource`

`#17298` 调整了 guardian automatic approval review 相关通知：

- started 通知新增稳定 `reviewId`
- completed 通知新增稳定 `reviewId`
- completed 通知新增 `decisionSource`
- `targetItemId` 允许为空

对本仓库的影响如下：

- 当前运行时不会因为这个直接 break，因为通知分发和大部分事件投影仍然使用动态 payload。
- 但本地 schema 产物还停在旧形状：
  - `backend/schema-out/ServerNotification.json`
  - `backend/schema-out/codex_app_server_protocol.v2.schemas.json`
  - `backend/schema-out/v2/ItemGuardianApprovalReviewStartedNotification.json`
  - `backend/schema-out/v2/ItemGuardianApprovalReviewCompletedNotification.json`

这带来的问题不是“升级失败”，而是：

- 本地 schema / 类型 / 文档会落后于真实协议。
- 后续如果要在 UI、审计或问题排查里把 guardian review started/completed 串联起来，缺少稳定 `reviewId` 会降低可观测性。

结论：

- 这是 schema 与后续可观测性层面的跟进项，不是当前主路径的运行阻断项。

## 4.2 升级即可获得的直接收益

### 4.2.1 Windows sandbox split carveouts 修复

`#14568` 修复了 Windows elevated sandbox 下 split filesystem policies 的处理，包括 writable roots 之下的 read-only carveouts。

这对当前仓库是直接相关的，因为当前仓库已经明确暴露了：

- `approvalPolicy`
- `sandboxPolicy`
- `command/exec`
- `windows-sandbox/setup-start`

且文档里已经明确说明：

- `sandboxPolicy` 决定 `turn/start` 和 `command/exec` 是否进入 Codex 自带沙箱。
- `thread/start` 只能表达粗粒度 `sandbox` mode，精确语义仍要依赖 `turn/start` 和 `command/exec` 的 `sandboxPolicy`。

因此，只要用户在 Windows 上实际使用 Codex 自带沙箱，这个修复就属于**升级即收益**。

### 4.2.2 symlinked writable roots / carveouts 修复

`#15981` 修复了 symlinked writable roots 和 carveouts 的权限处理问题，避免 shell 和 `apply_patch` 工作流误失败。

对当前仓库的意义同样是直接正收益：

- 当前仓库已经有 `command/exec`、线程执行、patch / 文件写入相关能力面。
- 若 workspace root 或某些写入目录经由 symlink 暴露，旧版 app-server / core 在权限判定上更容易出边缘错误。

这一项同样不要求先改本仓库逻辑。

## 4.3 影响较小或只在 future work 中重要的条目

### 4.3.1 `#17223` app-server MCP cleanup on disconnect

该修复主要集中在：

- app-server 连接断开
- subscriber 移除
- thread/resource teardown

它的主要压力场景是 app-server websocket 连接和 subscriber 生命周期管理，而不是当前仓库的本地 `stdio` sidecar 主路径。

对当前仓库的判断：

- 不是主路径升级阻断项。
- 如果未来启用 app-server websocket transport、多客户端订阅或 remote 直连，它会立刻变成高优先级。

### 4.3.2 `#17288` remote `wss://` panic 修复

该修复只在采用：

- `codex --remote wss://...`
- remote websocket transport

时直接相关。

当前仓库仍把 remote/websocket transport 明确归入 future work，因此这一项不应混入本次升级阻断。

### 4.3.3 `#17189` live Stop-hook prompt 时序修复

该修复解决的是原生 hook prompt 的即时显示问题。

当前仓库的治理主轴不是消费上游原生 hook prompt，而是本地 hooks-compatible 治理层与 `hook/started` / `hook/completed` 事件投影，因此：

- 当前影响较小。
- 它不会推翻本地治理实现，也不是当前主路径的关键兼容点。

## 4.4 需要更新认知但不要求回滚方案的条目

### 4.4.1 Windows hooks gate 被移除

`#17268` 移除了 Windows 上禁用 hooks 的 gate。

这会让本仓库一个设计前提变旧：

- 现有 hooks-compatible 设计文档仍写着“官方 hooks 在 Windows 当前临时禁用”。

但它**不会推翻当前 hooks-compatible 方案本身**，因为当前方案的核心理由并不只依赖这个前提，还包括：

- 要覆盖 Bash 之外的工具面
- 要统一 MCP、Write、WebSearch 等非 shell 工具的治理语义
- 要统一本地审计、线程时间线和 Hook Runs UI

因此更准确的结论是：

- 文档前提应更新
- 方案方向不必回滚

## 5. 本仓库当前实现面上的具体证据

以下证据点支撑上面的影响判断：

- `backend/internal/appserver/types.go`
  - `ThreadStartRequest` 当前没有 `sessionStartSource`
  - `TurnStartRequest` 已有 `ResponsesAPIClientMetadata`
- `backend/internal/threads/service.go`
  - `thread/start` 请求仍由 `buildThreadStartRequest(...)` 组装
  - `thread/resume` 当前只发 `cwd + threadId`
  - thread 删除时会显式调用 `thread/unsubscribe`
- `backend/internal/hooks/service.go`
  - 当前 `SessionStart` 是本地 hooks-compatible 治理事件
  - 是否触发取决于线程是否已有对话 turn
  - 当前没有 clear/startup source 语义
- `backend/internal/api/router_test.go`
  - 已有测试明确把 `SessionStart` 建模为首条 turn 前的 hook run
- `backend/internal/runtime/manager.go`
  - runtime 通知按动态 payload 转发
  - runtime close 时只做本地 request 过期与状态切换，不承担上游 websocket subscriber cleanup 语义
- `backend/internal/store/thread_projection.go`
  - 线程投影能处理 `turn/*`、`item/*`、`hook/*`
  - server request 投影聚焦审批、`mcpServer/elicitation/request`、`item/tool/call` 等事件
- `frontend/src/pages/threadLiveState.ts`
  - 前端 live state 当前重点处理 `serverRequest`、`hook/started`、`hook/completed`
  - 没有 guardian review `reviewId` / `decisionSource` 的消费逻辑
- `backend/schema-out/*`
  - guardian review 相关 schema 仍是旧版形状

## 6. 推荐动作

## 6.1 立即动作

1. **允许直接升级 app-server binary 到 `rust-v0.120.0`**
   - 当前没有发现必须先改本仓库代码的硬阻断。
   - Windows 环境下预计能直接获得 sandbox 相关稳定性收益。

2. **重新生成或同步 `backend/schema-out`**
   - 至少把 guardian review 的 `reviewId` / `decisionSource` 更新进来。
   - 这一步更多是协议产物一致性和后续开发基线治理。

3. **更新 hooks-compatible 设计文档中的 Windows hooks 前提**
   - 把“官方 hooks 在 Windows 临时禁用”改为最新事实。
   - 但不要把这件事误读为“本地 hooks-compatible 层没有必要了”。

## 6.2 应进入 backlog 的适配工作

建议新增一个小型跟进任务，范围严格限定为 `sessionStartSource`：

- 在 `backend/internal/appserver` 为 `ThreadStartRequest` 预留可选 `SessionStartSource`
- 在 `backend/internal/threads` 的 `buildThreadStartRequest(...)` 里支持可选下发
- 如果未来接 `/clear`：
  - 明确 API 层如何表达 clear
  - 明确 hooks-compatible `SessionStart` 如何消费该来源
  - 明确 thread timeline / hook run / UI 文案如何区分 `startup` 与 `clear`

这项工作当前不必立即实现，但应该在 `/clear` 语义进入产品面之前完成。

## 6.3 继续保持为 future work 的事项

以下事项仍应继续留在独立 future workstream，而不是混入本次升级：

- app-server websocket transport
- `codex --remote wss://...`
- remote control
- filesystem watch
- exec-server 接入

原因不变：

- 当前仓库主路径仍是本地 `stdio`
- 提前把 remote/workflow 语义混入现有实现，只会扩大升级面与验证面

## 7. 最终判断

对当前仓库来说，`rust-v0.120.0` 的最佳处理方式不是“大范围预防性重构”，而是：

1. 直接升级 binary，先拿到 Windows sandbox / symlink 权限相关修复收益。
2. 增补一个小型协议跟进 backlog：
   - `sessionStartSource`
   - guardian review schema 同步
3. 保持 remote/websocket transport 相关工作继续独立，不与这次升级混做。

如果只看优先级：

- **P1**：升级 binary
- **P1**：为未来 `/clear` 语义记录 `sessionStartSource` 跟进项
- **P2**：同步 schema-out
- **P2**：修正文档前提
- **P3**：继续维持 remote/websocket transport 为 future work
