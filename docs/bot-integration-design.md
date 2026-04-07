# Bot Integration Design

更新时间：2026-04-07

## 1. 文档目标

本文档基于当前代码实现的调研结果，重新定义 `codex-server` 中 bot 的使用机制与架构边界。目标不是推翻现有 `bots` 模块，而是在保留现有 provider、AI backend、入站持久化、回复重试和流式回复能力的前提下，把 bot 从“绑定在单个 workspace 内 conversation/thread 路由上的接入配置”演进为“独立的 bot 资源层”。

本次调研重点覆盖：

- `backend/internal/bots/service.go`
- `backend/internal/bots/workspace_thread_backend.go`
- `backend/internal/bots/openai_responses.go`
- `backend/internal/store/models.go`
- `backend/internal/api/router.go`
- `frontend/src/pages/BotsPage.tsx`
- `backend/internal/automations/service.go`
- `backend/internal/notifications/service.go`

## 2. 调研结论摘要

当前 bots 体系已经具备比较完整的“外部消息 -> AI 执行 -> 外部回复”闭环，但其资源模型仍然是以 `workspace-scoped BotConnection` 为中心，而不是以“Bot 逻辑实体”本身为中心。

现状可以概括为以下几点：

- 当前真正的管理实体是 `BotConnection`，它同时承担了 bot 身份、provider 接入、凭据、AI backend 选择、workspace 归属、运行配置等多种职责。
- 外部聊天会被持久化为 `BotConversation`，而 `BotConversation.ThreadID` 是当前 conversation 的唯一激活绑定点。
- `workspace_thread` backend 会直接使用 `connection.WorkspaceID` 进行 thread 查询、创建、turn 启动和事件订阅，因此 conversation 只能绑定到当前 connection 所在 workspace 的 thread。
- 前端 Bots 页面可以展示 conversation 绑定结果，但只能“查看”和“打开 thread”，没有管理绑定关系的 UI，也没有对应的公开 API。
- 后端实际上已经存在 conversation 改绑能力，但它被隐藏在 bot 文本命令里，例如 `/newthread`、`/thread use`、`/thread archive`，属于“能力存在但暴露层级错误”。
- 系统已经有 `automations` 和 `notifications` 两套能力，但 bot 还不是它们的统一消费方。当前 bot 只会响应 provider 的入站消息，不能作为通知订阅者或定时任务执行者被统一调度。
- `openai_responses` backend 已经说明 bot 并不一定天然依赖 thread；因此把 bot 架构继续固定在 `conversation.threadId` 上，会限制未来场景扩展。

## 3. 当前实现快照

### 3.1 当前资源模型

当前 bot 相关持久化资源主要包括：

| 资源 | 当前职责 | 当前问题 |
| --- | --- | --- |
| `BotConnection` | workspace 级 provider 接入配置，包含 provider、凭据、AI backend、settings、secrets | 同时承担“bot 身份 + endpoint + 默认执行配置 + workspace 归属”四类职责，耦合过重 |
| `BotConversation` | 外部会话路由记录，保存 provider 会话信息、`threadId`、`backendState`、`providerState` | 只有一个激活 `threadId`，绑定粒度过窄，且天然与 `BotConnection.WorkspaceID` 耦合 |
| `BotInboundDelivery` | 入站消息持久化、去重、恢复、失败重放 | 设计本身是健康的，但目前主要服务于“被动回复”链路，没有抽象成通用 bot run/delivery 模型 |

当前已有两种 AI backend：

- `workspace_thread`
  - 复用现有 `thread -> turn` 运行时
  - 使用 `connection.WorkspaceID`
  - 如果 `conversation.ThreadID` 不存在，会在当前 workspace 新建 thread
- `openai_responses`
  - 不依赖内部 thread
  - 通过 `conversation.BackendState["previous_response_id"]` 维护外部响应链路状态

### 3.2 当前主流程

当前 bot 核心链路可以抽象为：

```text
Provider webhook/polling
  -> BotConnection
  -> resolve/create BotConversation
  -> handle control command if needed
  -> AIBackend
  -> Provider send reply
```

如果选择 `workspace_thread` backend，则进一步变为：

```text
Inbound message
  -> BotConversation(threadId?)
  -> ensureThread(connection.WorkspaceID, conversation.ThreadID)
  -> turns.Start(connection.WorkspaceID, threadID)
  -> collect bot-visible messages
  -> provider.SendMessages(...)
```

这条链路的关键耦合点是：

- `connection.WorkspaceID` 决定执行发生在哪个 workspace
- `conversation.ThreadID` 决定当前会话落在哪个 thread
- 但 `conversation.ThreadID` 本身也只能在 `connection.WorkspaceID` 下有效

### 3.3 当前 UI / API / 命令三层能力不对称

#### UI 层

Bots 页面当前可以：

- 查看 connection 列表
- 编辑 provider 和 AI backend 设置
- 查看 conversation 列表
- 查看 conversation 最近一次 reply 状态
- 打开 `conversation.threadId`
- 重放失败回复

但不能：

- 修改 conversation 和 thread 的绑定关系
- 为 conversation 新建 thread
- 清空 binding
- 选择其他 workspace 的 thread
- 配置 bot 的主动触发来源

#### API 层

当前公开路由里，与 conversation 相关的接口只有：

- `GET /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations`
- `GET /api/workspaces/{workspaceId}/bot-conversations`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations/{conversationId}/replay-failed-reply`

缺少：

- conversation binding update API
- conversation binding clear API
- cross-workspace binding API
- bot trigger 管理 API

#### 文本命令层

后端实际上已经支持：

- `/newthread [title]`
- `/thread`
- `/thread list [active|archived|all]`
- `/thread rename <title>`
- `/thread archive`
- `/thread unarchive <thread_id|index>`
- `/thread use <thread_id|index>`

这说明“conversation 改绑能力”并不是没有实现，而是错误地沉在 bot 对话命令里，没有提升为管理平面的显式能力。

### 3.4 当前已存在但与 bot 脱节的主动执行能力

当前系统还存在两类与 bot 高度相关、但没有被纳入同一架构层的能力：

#### `automations`

`automations.Service` 已支持：

- cron 计划任务
- 自动创建或复用 thread
- 启动 turn
- 跟踪 run 状态
- 产出 notification

本质上，`automations` 已经实现了“定时触发 -> thread 执行 -> 通知输出”的一条并行链路。

#### `notifications`

当前通知系统已支持：

- 持久化 notification
- workspace 事件流广播 `notification/created`
- bot 失败、automation 完成/失败等场景的通知落盘

但 bot 不能声明“订阅哪些通知，并把通知转成 bot run 或 bot 外发消息”。

## 4. 当前架构的核心问题

### 4.1 `BotConnection` 不是 bot，只是接入连接

当前数据模型里没有独立的 `Bot` 逻辑实体，只有 `BotConnection`。这带来两个直接问题：

- 一个 bot 无法拥有多个 endpoint
  - 例如同时接 Telegram 和 WeChat
- bot 的逻辑身份和 provider 接入配置无法分离
  - 改 provider 配置几乎等于改 bot 自身

### 4.2 绑定关系被压缩成 `conversation.threadId`

当前 conversation 绑定模型等价于：

```text
外部会话 = 一个当前激活 thread
```

这个模型只够支持“聊天会话持续落在同一个 thread”这一种场景，不足以表达：

- 一个 bot 的默认工作 workspace
- 一个 bot 针对不同触发源的不同执行目标
- 一个 bot 的跨 workspace thread 路由
- 一个 bot 的 schedule / notification / manual run 默认落点
- 一个 bot 的无 thread backend 会话状态

### 4.3 workspace 耦合写死在 backend 执行入口

`workspace_thread` backend 当前直接使用 `connection.WorkspaceID`：

- 查询 thread 用它
- 创建 thread 用它
- 启动 turn 用它
- 订阅 workspace events 用它

这意味着即使未来 UI 允许选择其他 workspace 的 thread，只要 backend 执行上下文不重构，这个绑定也无法真正落地。

### 4.4 “控制能力”放在对话命令里，不适合作为管理面

现在 conversation 改绑依赖 `/thread use` 等命令，问题在于：

- 只能由 bot 聊天参与者自己触发
- 管理员无法在 UI 上直接修正错误绑定
- 无法做批量治理
- 无法为 schedule / notification 这类无聊天上下文的触发配置默认落点

### 4.5 bot 只能被动接收入站消息，不能成为统一执行入口

现有 bots 模块只处理 provider 入站消息，缺少统一的 trigger 抽象，因此 bot 不能原生接入：

- schedule
- notification
- workspace event
- manual dispatch
- 外部 webhook / callback

如果在当前 `bots.Service` 里直接临时塞入 schedule 和 notification 逻辑，会与 `automations.Service` 形成第二套平行调度器，进一步恶化系统边界。

### 4.6 provider 路由状态与 execution 状态没有分层

某些 provider 的主动外发并不是“只要有 chat id 就能发”，例如 WeChat 目前依赖会话级 `context_token`。这意味着：

- “bot 可以主动推送”不是统一真命题
- 必须有 provider capability / route capability 的显式建模
- 不能把“通知触发”简单等同为“任意 endpoint 都能主动发消息”

## 5. 设计目标

目标架构应满足以下要求：

1. bot 成为独立资源，而不是 `BotConnection` 的别名。
2. provider 接入、执行目标、触发来源、运行记录分层建模。
3. conversation / session binding 可以在 UI 和 API 中显式管理。
4. 支持 bot 与不同 workspace 中的 thread 建立绑定。
5. 支持 bot 接收通知、定时任务，以及后续更多事件源。
6. 保留现有 `Provider`、`AIBackend`、`BotInboundDelivery` 的可复用部分，避免一次性重构过大。
7. 为 provider 能力差异留出空间，尤其是“被动回复”和“主动推送”的差异。
8. 给出现实可执行的迁移路径，而不是一次性大爆炸重写。

## 6. 目标架构

### 6.1 分层模型

推荐将 bot 架构明确拆成四层：

```text
Trigger Layer
  - inbound message
  - notification
  - schedule
  - manual run
  - future workspace event / webhook

Bot Domain Layer
  - Bot
  - BotEndpoint
  - BotBinding
  - BotSession
  - BotRun

Execution Layer
  - workspace_thread
  - openai_responses
  - future workflow / toolchain backends

Delivery Layer
  - Telegram / WeChat / future providers
  - thread-side writeback
  - notification-only sinks
```

### 6.2 核心实体

推荐引入以下核心实体。

| 实体 | 职责 | 关键字段建议 |
| --- | --- | --- |
| `Bot` | bot 的逻辑身份与默认策略 | `id`, `name`, `ownerWorkspaceId`, `status`, `defaultBindingId`, `description` |
| `BotEndpoint` | bot 的接入通道与凭据，等价于“provider 连接” | `id`, `botId`, `provider`, `status`, `settings`, `secrets`, `capabilities` |
| `BotBinding` | bot 到执行目标的声明式绑定 | `id`, `botId`, `targetWorkspaceId`, `targetThreadId`, `aiBackend`, `aiConfig`, `bindingMode` |
| `BotSession` | 外部会话或带状态的触发上下文 | `id`, `botId`, `endpointId`, `routeKey`, `providerState`, `activeBindingId`, `backendState` |
| `BotTrigger` | 非聊天触发规则 | `id`, `botId`, `type`, `bindingId`, `schedule`, `filter`, `enabled` |
| `BotRun` | 每次 bot 执行与外发的统一运行记录 | `id`, `botId`, `triggerId`, `sessionId`, `bindingId`, `status`, `deliveryStatus`, `summary` |

### 6.3 与当前模型的映射关系

为兼容现有实现，建议做如下映射：

| 当前模型 | 目标模型 |
| --- | --- |
| `BotConnection` | `BotEndpoint` + 部分 `Bot` 默认配置 |
| `BotConversation` | `BotSession` |
| `BotConversation.ThreadID` | `BotSession.activeBindingId` 所指向的实际 binding 结果 |
| `BotInboundDelivery` | provider 入站特化的 `BotRunInput` / `DeliveryRecord` |
| `Automation` | `BotTrigger(type=schedule)` 的既有实现来源，短期兼容，长期可融合 |

### 6.4 Binding 模式

`BotBinding` 不应该只表达“固定 thread id”，而应支持至少四种模式：

| 模式 | 说明 | 适用场景 |
| --- | --- | --- |
| `fixed_thread` | 固定绑定到某个 workspace/thread | 明确归档线程、长期支持会话 |
| `workspace_auto_thread` | 固定 workspace，但 thread 按 session 首次创建并保持粘性 | 当前 conversation bot 的主流模式 |
| `ephemeral_thread` | 每次 run 新建 thread，不复用历史 | 临时通知总结、一次性计划任务 |
| `stateless` | 不依赖内部 thread，只依赖 backendState 或外部会话状态 | `openai_responses` 一类 backend |

初期实现时，建议优先支持：

- `fixed_thread`
- `workspace_auto_thread`

这两种模式已经足以覆盖当前 conversation 改绑和跨 workspace thread 绑定需求。

### 6.5 Binding 解析优先级

推荐统一使用以下解析顺序：

1. `BotSession.activeBindingId`
2. `BotTrigger.bindingId`
3. `Bot.defaultBindingId`
4. 如果 binding 为 `workspace_auto_thread` 且 session 尚无落点，则自动创建 thread 并回写到 session

这样可以同时支持：

- 聊天会话级别的临时改绑
- 计划任务级别的固定落点
- bot 级默认执行目标

### 6.6 Provider 能力模型

为支持“接收通知”和“定时主动外发”，需要显式引入 provider capability，而不是假设所有 provider 都能主动推送。

建议每个 endpoint/provider 暴露以下能力标签：

- `supportsInboundMessage`
- `supportsProactivePush`
- `supportsSessionlessPush`
- `requiresRouteState`
- `supportsStreamingEdit`
- `supportsTyping`

基于当前实现，可初步理解为：

- Telegram
  - 更接近可主动推送，只要已有可达 chat/topic route
- WeChat
  - 当前更依赖会话级 provider state，例如 `context_token`
  - 因此“主动通知推送”只能对已建立过有效 session 且 route state 可用的目标生效

这个能力模型必须进入 bot 设计，否则 notification / schedule 在部分 provider 上会表现为“概念上支持，实际上发不出去”。

## 7. 执行上下文重构

### 7.1 现有问题

当前 `AIBackend` 的输入是：

```text
ProcessMessage(ctx, connection, conversation, inbound)
```

这个接口天然把 execution context 绑死在：

- `connection`
- `conversation`
- provider 入站消息

它不适合承载：

- schedule trigger
- notification trigger
- manual run
- 跨 workspace target

### 7.2 建议的执行上下文

建议引入独立的执行上下文对象，例如：

```go
type BotExecutionContext struct {
    BotID              string
    EndpointID         string
    SessionID          string
    TriggerID          string
    RunID              string
    SourceType         string
    SourceText         string
    TargetWorkspaceID  string
    TargetThreadID     string
    AIBackend          string
    AIConfig           map[string]string
    SessionState       map[string]string
    ProviderState      map[string]string
}
```

然后把 AI backend 统一改为基于 `BotExecutionContext` 执行。

### 7.3 `workspace_thread` backend 的关键改造

`workspace_thread` backend 的核心改造点应是：

- 不再使用 `connection.WorkspaceID`
- 改为使用 `resolvedBinding.TargetWorkspaceID`
- `ensureThread()` 使用 target workspace 和 target thread
- 事件订阅使用 target workspace
- 完成后把最终 thread 落点回写到 `BotSession`

这一步是跨 workspace 绑定真正成立的前提。

### 7.4 `openai_responses` backend 的意义

`openai_responses` backend 说明 bot 的 session 状态并不总是 thread。它更适合作为新模型中的：

- `stateless`
- 或“外部 session state”示例

因此目标架构必须保留 `backendState`，但不能继续把所有状态都塞进 `threadId`。

## 8. Trigger 体系设计

### 8.1 统一 Trigger 抽象

建议把 bot 的输入源统一收敛为 `BotTrigger`，至少支持以下类型：

| Trigger 类型 | 说明 |
| --- | --- |
| `provider_message` | Telegram / WeChat 等外部入站消息 |
| `notification` | 订阅系统 notification，例如 automation 失败、bot 失败、构建告警 |
| `schedule` | cron 计划任务 |
| `manual` | UI 或 API 手动触发 |
| `workspace_event` | 后续可扩展的 thread/turn/workspace 事件 |

### 8.2 不建议在 `bots.Service` 内复制一个新调度器

当前 `automations.Service` 已经实现 schedule 相关能力。如果在 bots 模块里再直接加第二套 cron/scheduler，会出现：

- 两套计划任务状态机
- 两套 run 记录
- 两套通知逻辑

更合理的方向是：

1. 抽出共享的 `TriggerEngine` / `Scheduler`
2. 让 `automations` 和 `bots` 共用该调度能力
3. 或者逐步把 `Automation` 视为 `BotTrigger(type=schedule)` 的一个特化视图

### 8.3 notification 触发的推荐方式

notification 触发不应通过“轮询通知表”实现，而应直接基于已有 `notification/created` 事件流或 notification 创建入口进行分发。

推荐流程：

```text
CreateNotification(...)
  -> publish notification/created
  -> TriggerDispatcher matches BotTrigger(type=notification)
  -> create BotRun
  -> resolve binding
  -> execute backend or push message directly
```

### 8.4 schedule 触发的推荐方式

schedule 触发应支持两种执行模式：

- `execute_only`
  - 在绑定的 workspace/thread 中运行，不主动外发
- `execute_and_deliver`
  - 运行后将结果推送到一个或多个 bot endpoint/session

这样可以支持：

- “每天早上 9 点生成 standup 并发到 Telegram 群”
- “每小时检查 release 风险，只写入 thread，不外发”

## 9. 典型场景

### 9.1 UI 管理 conversation 改绑

场景：

- 管理员在 Bots 页面看到某个 Telegram chat 误绑定到了错误 thread

目标行为：

- 直接在 UI 中选择新的 workspace/thread
- 或创建新 thread
- 或清空 binding，等待下一次消息重新选择

这对应的实际上是 `BotSession.activeBindingId` 的修改，而不是 provider 配置变更。

### 9.2 跨 workspace 绑定

场景：

- 同一个 support bot 接入在运营 workspace 中维护
- 但某些 VIP 会话要切到另一个工程 workspace 的专属 thread

目标行为：

- bot 保持同一个 endpoint
- session 绑定切到另一个 workspace 的固定 thread
- 后续消息继续沿用该 binding

### 9.3 bot 接收通知

场景：

- 自动化任务失败后，希望 bot 主动把告警推送到 Telegram 群

目标行为：

- notification 创建后触发 `BotTrigger(type=notification)`
- 走 bot binding 的执行/摘要逻辑
- 选择 endpoint 主动推送

### 9.4 bot 定时运行

场景：

- 每天 10:00 执行一次仓库巡检，并将结果发到 WeChat 群

目标行为：

- 由 `BotTrigger(type=schedule)` 唤起
- 在目标 workspace/thread 执行
- 若 provider 支持主动推送且 route 可用，则外发结果

## 10. API 设计建议

### 10.1 新的 bot 管理 API

建议增加顶层 bot 资源：

- `GET /api/bots`
- `POST /api/bots`
- `GET /api/bots/{botId}`
- `POST /api/bots/{botId}`
- `POST /api/bots/{botId}/pause`
- `POST /api/bots/{botId}/resume`

### 10.2 endpoint 管理 API

- `GET /api/bots/{botId}/endpoints`
- `POST /api/bots/{botId}/endpoints`
- `POST /api/bots/{botId}/endpoints/{endpointId}`
- `DELETE /api/bots/{botId}/endpoints/{endpointId}`

### 10.3 binding 管理 API

- `GET /api/bots/{botId}/bindings`
- `POST /api/bots/{botId}/bindings`
- `POST /api/bots/{botId}/bindings/{bindingId}`
- `DELETE /api/bots/{botId}/bindings/{bindingId}`

### 10.4 session 管理 API

- `GET /api/bots/{botId}/sessions`
- `GET /api/bots/{botId}/sessions/{sessionId}`
- `POST /api/bots/{botId}/sessions/{sessionId}/binding`
- `POST /api/bots/{botId}/sessions/{sessionId}/binding/clear`

其中 `POST /binding` 应允许：

- 指定 `bindingId`
- 或直接给出 `targetWorkspaceId + targetThreadId`
- 或请求 `createThread=true`

### 10.5 trigger 管理 API

- `GET /api/bots/{botId}/triggers`
- `POST /api/bots/{botId}/triggers`
- `POST /api/bots/{botId}/triggers/{triggerId}`
- `DELETE /api/bots/{botId}/triggers/{triggerId}`
- `POST /api/bots/{botId}/triggers/{triggerId}/run`

### 10.6 兼容性 API

短期内保留现有 workspace 路由，但把它们视为投影视图：

- `BotConnection` 视图投影到 `BotEndpoint`
- `BotConversation` 视图投影到 `BotSession`

这样前端可以分阶段迁移，而不需要一次性切换所有接口。

## 11. UI 设计建议

### 11.1 Bots 页面从“连接页”升级为“Bot Center”

建议前端把当前 Bots 页面升级为 bot 资源中心，至少拆成以下面板：

- Bots
- Endpoints
- Bindings
- Sessions
- Triggers
- Runs

### 11.2 Session Binding 可视化编辑

在当前 conversation 列表位置，新增以下操作：

- 查看当前 binding
- 切换到已有 binding
- 直接选择 workspace/thread 改绑
- 创建新 thread 并绑定
- 清空 binding
- 查看历史已知 thread

这里本质上是把当前隐藏在 `/thread use` 和 `/newthread` 命令里的能力升级到 UI。

### 11.3 Thread 页增加“绑定到 bot”

建议在线程页增加：

- `Bind Bot Here`
- `Set As Default Bot Binding`

这样 thread 侧也能主动建立关联，而不必只能从 Bots 页面进入。

### 11.4 Notification / Automation 页增加“发送到 bot”

建议在通知页和自动化页增加：

- 选择 bot
- 选择 endpoint 或 session
- 是否直接推送
- 是否只写入绑定 thread

## 12. 安全与权限边界

### 12.1 推荐的 ownership 模型

短期建议采用：

- `Bot.ownerWorkspaceId`
  - 作为管理归属 workspace
- `BotBinding.targetWorkspaceId`
  - 允许指向其他 workspace

这样可以在不引入更大租户模型的前提下，先支持“跨 workspace 绑定”。

### 12.2 跨 workspace 绑定校验

任何跨 workspace binding 修改都必须校验：

1. 操作者对目标 workspace 有权限
2. bot 对目标 workspace 在 allowlist 中
3. 目标 thread 存在且属于目标 workspace

### 12.3 审计要求

以下动作必须进入审计日志：

- 创建 / 删除 binding
- session 改绑
- schedule / notification trigger 配置变更
- 主动推送失败
- 跨 workspace 绑定变更

## 13. 渐进式落地方案

### Phase 1：先补齐当前模型下最缺的管理能力

目标：

- 不引入新实体
- 先解决“UI 不能改绑”的现实问题

实施项：

- 新增 conversation binding update API
- 新增 conversation binding clear API
- Bots 页面增加：
  - `新建 thread`
  - `切换 thread`
  - `清空绑定`
- 先支持同 workspace 内改绑

产出价值：

- 立即解决当前最痛的使用问题
- 同时验证前端交互模型

### Phase 2：引入独立 `Bot` 与 `BotBinding`

目标：

- 把 bot 从 `BotConnection` 中抽离

实施项：

- 新增 `Bot`
- `BotConnection` 兼容映射为 `BotEndpoint`
- `BotConversation` 兼容映射为 `BotSession`
- 引入 `BotBinding`
- UI 开始以 bot 为主入口

### Phase 3：重构执行上下文，支持跨 workspace 绑定

目标：

- 让 `workspace_thread` backend 真正基于 resolved target 执行

实施项：

- 引入 `BotExecutionContext`
- `workspace_thread` backend 改为使用 `targetWorkspaceId`
- session binding 支持跨 workspace
- 加入权限与审计校验

### Phase 4：统一 Trigger 体系

目标：

- 让 bot 成为 schedule / notification 的统一消费层

实施项：

- 引入 `BotTrigger`
- 复用或抽离 `automations` 的 scheduler 能力
- 把 notification 事件接入 TriggerDispatcher
- 引入 `BotRun`

### Phase 5：收敛自动化与 bot 能力边界

目标：

- 避免长期并存两套“计划任务 -> thread -> 通知”模型

建议方向：

- `automations` 逐步收敛为 `BotTrigger(type=schedule)` 的一个 UI 视图
- 或至少共享 scheduler、run 记录和通知分发基础设施

## 14. 推荐的近期实现顺序

如果只按“投入产出比”排序，建议近期优先做以下四步：

1. 先给现有 `BotConversation` 补绑定管理 API 和 UI。
2. 再抽出 `BotBinding`，把“当前激活 thread”从 conversation 记录里提升成显式资源。
3. 然后重构 `workspace_thread` backend 的执行上下文，解除 `connection.WorkspaceID` 耦合。
4. 最后再接入 schedule 和 notification trigger，并复用现有 `automations`/`notifications` 能力。

## 15. 结论

当前 bots 模块并不是功能太少，而是“层级不对”：

- 现有实现已经有 provider、AI backend、入站持久化、失败恢复、对话命令改绑、审批处理等一整套能力。
- 但 bot 还没有被建模成独立的逻辑实体，仍然被压缩在 `workspace -> bot connection -> conversation -> threadId` 这条链路里。
- 这条链路足以支撑当前的“被动聊天 bot”，但无法自然扩展到跨 workspace 绑定、通知订阅、定时任务和更多主动场景。

因此，本次设计的核心结论是：

1. 保留现有 provider 与 backend 的实现积累。
2. 把 `Bot` 提升为独立资源层。
3. 把 `Endpoint`、`Binding`、`Session`、`Trigger`、`Run` 明确拆开。
4. 先通过补 API/UI 解决当前 conversation 改绑问题，再逐步演进到跨 workspace 与主动触发场景。

这是风险最低、同时又能持续放大 bot 使用场景的演进路线。
