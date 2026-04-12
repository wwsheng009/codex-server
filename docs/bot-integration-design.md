# Bot Integration Design

更新时间：2026-04-08

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
- 当前 `conversation binding` 只定义 bot 的内部执行上下文，不等于 bot 的外部发送目标；provider 外发仍然依赖 `BotConversation` 上的外部路由状态。
- 当前系统不存在“thread 新消息自动推送回 bot provider”的反向桥接；修改 binding 后，只会影响后续 bot 入站消息的执行落点，不会让新 thread 的消息自动发给 bot。
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

### 3.5 当前 binding 的真实语义边界

基于当前后端实现，`conversation binding` 的真实语义应明确为：

- `binding` 只决定 bot 收到入站消息后，内部 AI 执行时应该使用哪个 workspace/thread。
- `binding` 不决定外部消息最终发给谁；真正的 provider 外发目标仍由 `BotConversation` 中的外部路由字段决定，例如 `ExternalChatID`、`ExternalConversationID`、`ProviderState`。
- `binding` 也不是主动通知目标。通知要不要发、发给哪个会话、是否允许无 session 主动推送，都必须经过独立的外发目标解析。

这意味着当前系统实际存在三种不同概念：

| 概念 | 当前承载对象 | 作用 |
| --- | --- | --- |
| `Execution Binding` | `BotConversation.ThreadID` / `BindingID` | 决定 bot 入站消息的内部执行上下文 |
| `External Delivery Route` | `BotConversation.ExternalChatID`、`ExternalConversationID`、`ProviderState` | 决定 provider 外发时真正的收件人 |
| `Proactive Notification Target` | 当前未独立建模 | 决定系统主动通知时发给谁 |

如果不把这三层拆开，就会自然产生一个错误假设：

```text
thread 绑定到某个 bot conversation
  => 这个 thread 的新消息天然就应该发给 bot
```

但当前实现并不支持这条反向语义，原因包括：

- 后端只有 `bot 入站 -> thread 执行 -> bot 外发` 的主链路，没有 `thread -> bot` 的独立桥接器。
- store 里只有按外部会话查 `BotConversation` 的能力，没有按 `threadId` 反查“应该推给哪个 bot 会话”的稳定索引。
- 一个 thread 未来可能被多个 session/default binding 指向，因此“thread 新消息发给谁”本身不是天然单值问题。
- 如果简单按 thread 监听自动外发，很容易与现有 bot 入站回复链路形成双发或回路。

因此，后续设计必须遵守一个原则：

- `binding` 负责内部执行。
- `delivery target` 负责外部收件人。
- `notification` 负责主动触发意图。

这三者可以关联，但不能混成同一个资源语义。

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

### 4.7 `binding`、`delivery route`、`notification target` 被混用

当前讨论中最容易出现的误区是把下面三件事当成同一件事：

- conversation 当前落在哪个 thread 上执行
- provider 回复时使用哪个外部路由
- 系统主动通知时应该发给哪个对象

如果后续继续沿用“只要 thread 绑定变了，thread 的新消息就应该发给 bot”这种思路，会立刻遇到以下问题：

- 同一个 thread 可能对应多个外部会话，主动外发目标不明确。
- thread 中的 AI 输出可能已经通过 bot 入站链路发过一次，再监听 thread 会重复发送。
- 某些 provider 需要会话级 route state，thread 本身无法单独承载这类能力。
- 通知可能根本不需要执行 thread，只需要直接主动外发一条模板消息。

因此推荐在目标架构中显式拆分：

- `Execution Binding`
- `Delivery Target`
- `Outbound Delivery`

而不是继续让 `conversation.threadId` 一项承担所有语义。

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
9. 明确区分 `execution binding`、`delivery target` 与 `notification target` 三种语义。
10. 让通知和手工主动发送走显式 `outbound delivery` 模型，而不是依赖 thread 自动镜像。

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
  - BotDeliveryTarget
  - BotRun

Execution Layer
  - workspace_thread
  - openai_responses
  - future workflow / toolchain backends

Delivery Layer
  - Telegram / WeChat / future providers
  - proactive push routing
  - explicit/manual thread-side writeback
  - notification-only sinks
```

### 6.2 核心实体

推荐引入以下核心实体。

| 实体 | 职责 | 关键字段建议 |
| --- | --- | --- |
| `Bot` | bot 的逻辑身份与默认策略 | `id`, `name`, `ownerWorkspaceId`, `status`, `defaultBindingId`, `description` |
| `BotEndpoint` | bot 的接入通道与凭据，等价于“provider 连接” | `id`, `botId`, `provider`, `status`, `settings`, `secrets`, `capabilities` |
| `BotBinding` | bot 到执行目标的声明式绑定 | `id`, `botId`, `targetWorkspaceId`, `targetThreadId`, `aiBackend`, `aiConfig`, `bindingMode` |
| `BotSession` | 外部会话或带状态的触发上下文，也是“回复型主动外发”的天然目标 | `id`, `botId`, `endpointId`, `routeKey`, `providerState`, `activeBindingId`, `backendState` |
| `BotDeliveryTarget` | 主动外发目标，表示一个可投递的 bot 收件人，可绑定到 session 或 provider route | `id`, `botId`, `endpointId`, `sessionId`, `routeType`, `routeKey`, `providerState`, `capabilities` |
| `BotTrigger` | 非聊天触发规则 | `id`, `botId`, `type`, `bindingId`, `schedule`, `filter`, `enabled` |
| `BotRun` | 每次 bot 执行的统一运行记录，关注“为何执行、执行到了哪一步” | `id`, `botId`, `triggerId`, `sessionId`, `bindingId`, `status`, `summary` |
| `BotOutboundDelivery` | 每次主动或被动外发的投递记录，关注“发给谁、是否成功、是否重试” | `id`, `botId`, `endpointId`, `sessionId`, `deliveryTargetId`, `sourceType`, `status`, `attemptCount`, `error` |

### 6.3 与当前模型的映射关系

为兼容现有实现，建议做如下映射：

| 当前模型 | 目标模型 |
| --- | --- |
| `BotConnection` | `BotEndpoint` + 部分 `Bot` 默认配置 |
| `BotConversation` | `BotSession` |
| `BotConversation.ThreadID` | `BotSession.activeBindingId` 所指向的实际 binding 结果 |
| `BotConversation.ExternalChatID` / `ProviderState` | `BotSession` 的外部回复路由状态，未来也可投影到 `BotDeliveryTarget(session-backed)` |
| `BotInboundDelivery` | provider 入站特化的 `BotRunInput` / `InboundDeliveryRecord` |
| 当前 reply delivery 状态 | `BotOutboundDelivery` 的被动回复特化视图 |
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

### 6.7 `Execution Binding` 与 `Delivery Target` 的分层原则

后续实现时，应明确采用以下分层：

#### `Execution Binding`

定义：

- bot 执行 AI 时选择的内部 workspace/thread/AI backend 落点

规则：

- 解析顺序遵循本节前面定义的 binding 优先级
- 只影响内部执行
- 不天然等于外部收件人

#### `Delivery Target`

定义：

- bot 主动外发时的明确收件目标

建议支持两类：

- `session-backed`
  - 直接绑定到已有 `BotSession`
  - 适合已有 Telegram/WeChat 会话的持续通知
- `route-backed`
  - 绑定到 provider 可直接投递的 route
  - 适合允许 sessionless push 的 provider 或固定群组目标

规则：

- `threadId` 只能作为内容上下文或默认执行上下文来源，不能直接当作主动外发目标。
- 如果一个 thread 关联多个 session，系统必须要求显式选择 `sessionId` 或 `deliveryTargetId`。
- thread 页可以提供 `Send To Bot` / `Notify Target` 之类显式动作，但不应默认启用“自动镜像 thread assistant 输出到 bot”。

#### `Notification Target`

定义：

- 某类通知应该送达的目标集合

推荐设计：

- 通知规则优先绑定到 `sessionId` 或 `deliveryTargetId`
- `threadId` 只作为通知生成内容时的参考上下文
- 通知执行时先决定：
  - 是否需要 AI 执行
  - 如果需要，使用哪个 `binding`
  - 如果需要外发，使用哪个 `delivery target`

推荐的统一流程：

```text
Trigger fired
  -> resolve execution binding
  -> optional AI execution
  -> resolve delivery target
  -> create outbound delivery
  -> provider.SendMessages(...)
```

这个分层能保证：

- 修改 binding 不会意外改变收件人
- 同一个 thread 不会因为被多个 session 复用而自动误发
- 通知能力可以复用 bot 外发基础设施，而不是绑死在 thread 上

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

但这里需要特别强调：

- `BotExecutionContext` 只负责内部执行，不负责决定外发目标。
- 主动外发应额外解析独立的 `BotDeliveryContext`，例如：

```go
type BotDeliveryContext struct {
    BotID             string
    EndpointID        string
    SessionID         string
    DeliveryTargetID  string
    RouteType         string
    RouteKey          string
    ProviderState     map[string]string
    SourceType        string
}
```

也就是说，执行上下文和投递上下文必须分层，不能继续复用一个 `conversation.threadId` 贯穿到底。

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
  -> optional execute backend
  -> resolve sessionId / deliveryTargetId
  -> create BotOutboundDelivery
  -> push message directly
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
- “审批完成后，不跑 thread，只把模板通知直接推送给既有 bot session”

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
- 可选择：
  - 直接走模板通知并主动推送
  - 或先走 bot binding 的执行/摘要逻辑，再外发
- 外发目标通过 `sessionId` 或 `deliveryTargetId` 显式决定，而不是直接用 `threadId`

### 9.4 bot 定时运行

场景：

- 每天 10:00 执行一次仓库巡检，并将结果发到 WeChat 群

目标行为：

- 由 `BotTrigger(type=schedule)` 唤起
- 在目标 workspace/thread 执行
- 若 provider 支持主动推送且 route 可用，则外发结果

### 9.5 从 thread 页向 bot 主动发送

场景：

- 管理员在 workspace thread 中人工整理了一段内容，希望主动发给某个 Telegram / WeChat 会话

目标行为：

- thread 页提供显式 `Send To Bot` 或 `Notify Target`
- 用户选择：
  - 目标 `session`
  - 或目标 `delivery target`
- thread 内容只作为消息来源或摘要来源
- 系统创建一条 `BotOutboundDelivery`
- provider 发送后记录 delivery 状态、重试和审计日志

这里的关键约束是：

- 这是显式动作，不是“thread 绑定后自动镜像”
- 如果同一 thread 关联多个 session，必须显式选择收件人
- 如果 provider 不支持主动推送或缺少 route state，应在 UI 上直接阻止发送

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

### 10.5 delivery target 与主动外发 API

- `GET /api/bots/{botId}/delivery-targets`
- `POST /api/bots/{botId}/delivery-targets`
- `POST /api/bots/{botId}/delivery-targets/{targetId}`
- `DELETE /api/bots/{botId}/delivery-targets/{targetId}`
- `POST /api/bots/{botId}/sessions/{sessionId}/outbound-messages`
- `POST /api/bots/{botId}/delivery-targets/{targetId}/outbound-messages`
- `GET /api/bots/{botId}/outbound-deliveries`
- `GET /api/bots/{botId}/outbound-deliveries/{deliveryId}`

建议：

- `sessions/{sessionId}/outbound-messages` 用于“回复型主动外发”
- `delivery-targets/{targetId}/outbound-messages` 用于“通知型主动外发”
- 请求体允许携带：
  - `text`
  - `media`
  - `sourceType`
  - `idempotencyKey`
  - 可选 `threadId` 或 `originThreadId`，但仅用于审计/上下文，不用于决定收件人

### 10.6 trigger 管理 API

- `GET /api/bots/{botId}/triggers`
- `POST /api/bots/{botId}/triggers`
- `POST /api/bots/{botId}/triggers/{triggerId}`
- `DELETE /api/bots/{botId}/triggers/{triggerId}`
- `POST /api/bots/{botId}/triggers/{triggerId}/run`

### 10.7 兼容性 API

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

### 11.3 Thread 页增加“绑定到 bot / 主动发送”

建议在线程页增加：

- `Bind Bot Here`
- `Set As Default Bot Binding`
- `Send To Bot`
- `Notify Target`

这样 thread 侧既能主动建立关联，也能发起显式主动外发，而不必只能从 Bots 页面进入。

### 11.4 Notification / Automation 页增加“发送到 bot”

建议在通知页和自动化页增加：

- 选择 bot
- 选择 session 或 delivery target
- 是否直接推送
- 是否只写入绑定 thread

这里推荐把“内容上下文来源”和“收件目标”分开显示：

- `Context Source`
  - 当前 thread
  - 指定 binding
  - 无上下文模板
- `Delivery Target`
  - 某个 session
  - 某个 delivery target
  - 仅写入 thread，不外发

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
- 引入 `BotDeliveryTarget` 与主动外发 API
- 复用或抽离 `automations` 的 scheduler 能力
- 把 notification 事件接入 TriggerDispatcher
- 引入 `BotRun` 与 `BotOutboundDelivery`

### Phase 5：收敛自动化与 bot 能力边界

目标：

- 避免长期并存两套“计划任务 -> thread -> 通知”模型

建议方向：

- `automations` 逐步收敛为 `BotTrigger(type=schedule)` 的一个 UI 视图
- 或至少共享 scheduler、run 记录和通知分发基础设施

## 14. 推荐的近期实现顺序

如果只按“投入产出比”排序，建议近期优先做以下五步：

1. 先给现有 `BotConversation` 补绑定管理 API 和 UI。
2. 再抽出 `BotBinding`，把“当前激活 thread”从 conversation 记录里提升成显式资源。
3. 然后重构 `workspace_thread` backend 的执行上下文，解除 `connection.WorkspaceID` 耦合。
4. 再补 `delivery target` 与主动外发 API，把“执行上下文”和“外发目标”正式拆开。
5. 最后再接入 schedule 和 notification trigger，并复用现有 `automations`/`notifications` 能力。

## 15. 结论

当前 bots 模块并不是功能太少，而是“层级不对”：

- 现有实现已经有 provider、AI backend、入站持久化、失败恢复、对话命令改绑、审批处理等一整套能力。
- 但 bot 还没有被建模成独立的逻辑实体，仍然被压缩在 `workspace -> bot connection -> conversation -> threadId` 这条链路里。
- 这条链路足以支撑当前的“被动聊天 bot”，但无法自然扩展到跨 workspace 绑定、通知订阅、定时任务和更多主动场景。

因此，本次设计的核心结论是：

1. 保留现有 provider 与 backend 的实现积累。
2. 把 `Bot` 提升为独立资源层。
3. 把 `Endpoint`、`Binding`、`Session`、`DeliveryTarget`、`Trigger`、`Run`、`OutboundDelivery` 明确拆开。
4. 明确 `binding` 只负责内部执行，不把它直接建模成主动外发目标。
5. 先通过补 API/UI 解决当前 conversation 改绑问题，再逐步演进到跨 workspace 与主动触发场景。

这是风险最低、同时又能持续放大 bot 使用场景的演进路线。

## 16. 参考实现草案

这一节不再讨论“是否应该这样设计”，而是给出一版贴近当前仓库的实现草案，便于后续直接拆任务。

### 16.1 store 层目标实体草案

在当前仓库里，`Bot`、`BotBinding`、`BotConnection`、`BotConversation` 已经存在。建议下一步不要急着大规模改名，而是按“新增实体 + 兼容投影”的方式演进。

#### 目标实体：`BotSession`

短期内可继续以 `BotConversation` 为持久化主实体，对外逐步投影为 `BotSession`。推荐目标字段如下：

| 字段 | 建议含义 | 备注 |
| --- | --- | --- |
| `id` | session 主键 | 初期可直接复用 `BotConversation.ID` |
| `botId` | 所属 bot | 已有字段 |
| `endpointId` | 接入 endpoint | 对应当前 `ConnectionID` |
| `provider` | provider 类型 | 已有字段 |
| `routeType` | 路由类型 | 如 `chat`, `chat_thread`, `conversation` |
| `routeKey` | provider 可识别的收件键 | 可由 `ExternalChatID + ExternalThreadID + ExternalConversationID` 归一化得到 |
| `activeBindingId` | 当前 session 生效 binding | 目标字段；短期可由 `BindingID` 或 `ThreadID` 推导 |
| `backendState` | AI backend 状态 | 已有字段 |
| `providerState` | provider 会话状态 | 已有字段 |
| `lastInboundAt` | 最后一次入站时间 | 可从 delivery 衍生 |
| `lastOutboundAt` | 最后一次外发时间 | 可从 outbound delivery 衍生 |
| `lastOutboundDeliveryId` | 最近一次外发记录 | 新增投影字段 |
| `createdAt` / `updatedAt` | 时间戳 | 已有字段 |

#### 新增实体：`BotDeliveryTarget`

`BotDeliveryTarget` 用于表达“一个明确可投递的外部收件目标”。这是后续通知、thread 页主动发送、批量推送的核心。

| 字段 | 建议含义 | 备注 |
| --- | --- | --- |
| `id` | target 主键 | 新增 |
| `botId` | 所属 bot | 必填 |
| `endpointId` | 使用哪个 endpoint 投递 | 必填 |
| `sessionId` | 若来源于已有 session，则关联 session | 可空 |
| `provider` | provider 类型 | 冗余字段，便于查询和审计 |
| `targetType` | `session_backed` 或 `route_backed` | 区分是否依赖现有 session |
| `routeType` | 路由类型 | 如 `telegram_chat`, `telegram_topic`, `wechat_session` |
| `routeKey` | provider 路由键 | 可直接供 provider 发送层消费 |
| `providerState` | 发送所需的 provider 状态 | 对 WeChat 这类 provider 很关键 |
| `capabilities` | 主动投递能力标签 | 如 `supportsProactivePush`, `requiresRouteState` |
| `status` | `active`, `invalid`, `paused` | 用于兜底禁用失效目标 |
| `title` | 人类可读名称 | 便于 UI 选择 |
| `labels` | 标签或分类 | 可选 |
| `lastVerifiedAt` | 最近一次校验时间 | 可选 |
| `createdAt` / `updatedAt` | 时间戳 | 必填 |

#### 新增实体：`BotOutboundDelivery`

当前仓库里，外发结果主要散落在 `BotConversation.LastOutbound*` 和 `BotInboundDelivery.Reply*` 字段里。建议统一沉淀到 `BotOutboundDelivery`。

| 字段 | 建议含义 | 备注 |
| --- | --- | --- |
| `id` | delivery 主键 | 新增 |
| `botId` | 所属 bot | 必填 |
| `endpointId` | 使用哪个 endpoint 发送 | 必填 |
| `sessionId` | 如果是回复型外发，则关联 session | 可空 |
| `deliveryTargetId` | 主动外发目标 | 可空，但通知型主动推送应优先使用 |
| `runId` | 关联 bot run | 可空 |
| `triggerId` | 来源 trigger | 可空 |
| `sourceType` | `reply`, `notification`, `manual`, `schedule` 等 | 必填 |
| `sourceRefType` / `sourceRefId` | 来源资源引用 | 如 `notification`, `thread_turn`, `automation_run` |
| `originWorkspaceId` / `originThreadId` / `originTurnId` | 内容来源上下文 | 仅用于审计和回溯，不决定收件人 |
| `messages` | 本次准备发送的消息体 | 建议直接复用现有 `BotReplyMessage` 结构 |
| `status` | `queued`, `sending`, `delivered`, `failed`, `partial_failed`, `canceled` | 必填 |
| `attemptCount` | 重试次数 | 必填 |
| `idempotencyKey` | 幂等键 | 通知类场景必须支持 |
| `providerMessageIds` | provider 返回的消息标识 | 可空 |
| `lastError` | 最近错误 | 可空 |
| `createdAt` / `updatedAt` / `deliveredAt` | 时间戳 | 必填 |

#### `BotBinding` 建议保持为执行层资源

本次设计不建议再新增 `BotExecutionBinding` 一类重复实体。当前已有 `BotBinding`，后续只需要：

- 补足 `bindingMode`
- 补足 `targetWorkspaceId`
- 明确 `AIBackend / AIConfig`
- 在 session / trigger / bot 默认策略三层解析中统一复用

这样可以避免“执行目标”再被拆成第二套模型。

### 16.2 兼容持久化策略

推荐采用以下兼容策略：

1. 第一阶段不重命名现有 store 表示层。
2. `BotConversation` 继续作为 session 持久化来源。
3. `BotDeliveryTarget` 与 `BotOutboundDelivery` 作为新增实体落库。
4. 对外 API 和前端 view model 开始使用 `session`、`delivery target`、`outbound delivery` 语义。
5. 待 UI、服务层、审计链路稳定后，再决定是否在 store 层做重命名或完全投影。

这样可以避免一次性搬迁大量历史数据，也便于逐步把当前零散的外发状态收敛到 `BotOutboundDelivery`。

### 16.3 服务层接口与职责草案

建议在 `bots.Service` 内显式拆出以下职责，哪怕初期仍然放在同一个 service 文件中，也要在函数边界上先分清楚。

#### binding / execution 相关

```go
type ResolveExecutionBindingInput struct {
    BotID       string
    SessionID   string
    TriggerID   string
    RequestedID string
}

type BotExecutionContext struct {
    BotID              string
    EndpointID         string
    SessionID          string
    BindingID          string
    BindingMode        string
    TargetWorkspaceID  string
    TargetThreadID     string
    AIBackend          string
    AIConfig           map[string]string
    BackendState       map[string]string
}

func (s *Service) ResolveExecutionContext(ctx context.Context, input ResolveExecutionBindingInput) (BotExecutionContext, error)
func (s *Service) UpdateSessionBinding(ctx context.Context, botID, sessionID string, input UpdateSessionBindingInput) (BotSessionView, error)
func (s *Service) ClearSessionBinding(ctx context.Context, botID, sessionID string) (BotSessionView, error)
```

职责边界：

- `ResolveExecutionContext` 只负责决定内部执行去哪。
- 不在这里做外部主动投递。
- 不在这里偷偷把 thread 当作 provider route 使用。

#### delivery target 相关

```go
type ResolveDeliveryTargetInput struct {
    BotID            string
    SessionID        string
    DeliveryTargetID string
}

type BotDeliveryContext struct {
    BotID            string
    EndpointID       string
    SessionID        string
    DeliveryTargetID string
    Provider         string
    RouteType        string
    RouteKey         string
    ProviderState    map[string]string
    Capabilities     []string
}

func (s *Service) EnsureSessionDeliveryTarget(ctx context.Context, botID, sessionID string) (BotDeliveryTargetView, error)
func (s *Service) ResolveDeliveryTarget(ctx context.Context, input ResolveDeliveryTargetInput) (BotDeliveryContext, error)
func (s *Service) UpsertDeliveryTarget(ctx context.Context, botID string, input UpsertDeliveryTargetInput) (BotDeliveryTargetView, error)
func (s *Service) DeleteDeliveryTarget(ctx context.Context, botID, targetID string) error
```

职责边界：

- `EnsureSessionDeliveryTarget` 用于把现有 session 兜底投影成一个可主动发送的收件目标。
- `ResolveDeliveryTarget` 只负责“发给谁”，不负责“内部执行去哪”。
- 这里必须校验 provider capability，尤其是是否支持主动推送、是否依赖 route state。

#### outbound delivery 相关

```go
type SendOutboundMessageInput struct {
    BotID            string
    SessionID        string
    DeliveryTargetID string
    SourceType       string
    SourceRefType    string
    SourceRefID      string
    OriginWorkspaceID string
    OriginThreadID   string
    OriginTurnID     string
    IdempotencyKey   string
    Messages         []store.BotReplyMessage
}

func (s *Service) SendOutboundMessages(ctx context.Context, input SendOutboundMessageInput) (BotOutboundDeliveryView, error)
func (s *Service) ReplayOutboundDelivery(ctx context.Context, botID, deliveryID string) (BotOutboundDeliveryView, error)
func (s *Service) ListOutboundDeliveries(ctx context.Context, botID string, filter ListOutboundDeliveriesFilter) ([]BotOutboundDeliveryView, error)
```

职责边界：

- `SendOutboundMessages` 是后续通知、thread 页手动发送、schedule 主动推送的统一入口。
- 这个入口内部可以继续复用现有 provider 的 `SendMessages(...)` 能力，但调用前必须先解析出 `BotDeliveryContext`。
- 回复型外发也应逐步落到这个入口，避免存在两套“发送消息但日志结构完全不同”的实现。

### 16.4 出站状态机建议

建议把外发状态统一约束为如下状态机：

1. `queued`
2. `sending`
3. `delivered`
4. `failed`
5. `partial_failed`
6. `canceled`

约束建议：

- `queued -> sending -> delivered/failed/partial_failed`
- 允许 `failed -> queued` 作为重试
- 不允许直接从 `delivered` 回退到 `queued`
- `partial_failed` 只在多消息或多媒体混发时出现

幂等建议：

- 对通知、schedule、业务回调这类主动场景，`idempotencyKey` 必填
- 幂等范围建议至少包含：
  - `botId`
  - `endpointId`
  - `deliveryTargetId`
  - `sourceType`
  - `idempotencyKey`

这样才能避免业务系统重复回调时把同一条通知发多次。

## 17. API Schema 草案

这一节给出更接近实现的 request/response 结构建议，便于后续直接生成 handler 与前端类型。

### 17.1 更新 session binding

`POST /api/bots/{botId}/sessions/{sessionId}/binding`

请求体建议：

```json
{
  "bindingId": "bbd_123",
  "targetWorkspaceId": "ws_ops",
  "targetThreadId": "th_456",
  "createThread": false,
  "bindingTitle": "客服升级线程"
}
```

规则建议：

- `bindingId` 与 `targetWorkspaceId + targetThreadId` 二选一
- `createThread=true` 时，允许只传 `targetWorkspaceId`
- 如果指定 `bindingId`，则忽略其他目标字段
- 服务端返回 resolved 后的 session 视图，而不是只返回 `204`

响应体建议：

```json
{
  "session": {
    "id": "bcs_123",
    "botId": "bot_001",
    "endpointId": "bep_001",
    "activeBindingId": "bbd_123",
    "resolvedBinding": {
      "id": "bbd_123",
      "bindingMode": "fixed_thread",
      "targetWorkspaceId": "ws_ops",
      "targetThreadId": "th_456"
    },
    "updatedAt": "2026-04-08T11:00:00Z"
  }
}
```

### 17.2 创建或更新 delivery target

`POST /api/bots/{botId}/delivery-targets`

请求体建议：

```json
{
  "endpointId": "bep_001",
  "sessionId": "bcs_123",
  "targetType": "session_backed",
  "routeType": "telegram_chat",
  "routeKey": "chat:99887766",
  "title": "客服主群",
  "providerState": {
    "chat_id": "99887766"
  }
}
```

响应体建议：

```json
{
  "deliveryTarget": {
    "id": "bdt_001",
    "botId": "bot_001",
    "endpointId": "bep_001",
    "sessionId": "bcs_123",
    "targetType": "session_backed",
    "routeType": "telegram_chat",
    "routeKey": "chat:99887766",
    "status": "active",
    "capabilities": [
      "supportsProactivePush"
    ],
    "updatedAt": "2026-04-08T11:00:00Z"
  }
}
```

规则建议：

- `session_backed` target 可以由服务端自动创建，不一定要求用户手工先建
- `route_backed` target 必须校验 provider 是否支持 sessionless push
- 对需要 route state 的 provider，缺少 `providerState` 时应直接返回 4xx，而不是先创建一个一定会失败的 target

### 17.3 主动外发消息

`POST /api/bots/{botId}/sessions/{sessionId}/outbound-messages`

或

`POST /api/bots/{botId}/delivery-targets/{targetId}/outbound-messages`

请求体建议：

```json
{
  "messages": [
    {
      "text": "审批已经通过，预计 10 分钟内生效。"
    }
  ],
  "sourceType": "notification",
  "sourceRefType": "notification",
  "sourceRefId": "ntf_001",
  "originWorkspaceId": "ws_ops",
  "originThreadId": "th_456",
  "originTurnId": "turn_789",
  "idempotencyKey": "approval:ntf_001:v1"
}
```

响应体建议：

```json
{
  "delivery": {
    "id": "bod_001",
    "botId": "bot_001",
    "endpointId": "bep_001",
    "sessionId": "bcs_123",
    "deliveryTargetId": "bdt_001",
    "sourceType": "notification",
    "status": "sending",
    "attemptCount": 1,
    "createdAt": "2026-04-08T11:02:00Z"
  }
}
```

规则建议：

- 如果 path 上给的是 `sessionId`，服务端内部先 `EnsureSessionDeliveryTarget`
- 如果 path 上给的是 `deliveryTargetId`，则直接解析外发目标
- `originThreadId` 仅用于审计和 UI 上“来自哪个 thread”的显示，不参与路由决策

### 17.4 出站记录查询

`GET /api/bots/{botId}/outbound-deliveries?sessionId=...&sourceType=...&status=...`

返回结构建议：

```json
{
  "data": [
    {
      "id": "bod_001",
      "sessionId": "bcs_123",
      "deliveryTargetId": "bdt_001",
      "sourceType": "notification",
      "status": "delivered",
      "attemptCount": 1,
      "lastError": "",
      "deliveredAt": "2026-04-08T11:02:03Z"
    }
  ],
  "nextCursor": ""
}
```

这样后续 Bots 页面、通知页、thread 页都能复用同一套投递日志视图。

### 17.5 事件流建议

前端如果继续依赖 workspace stream，建议新增并统一以下事件：

- `bot/session/updated`
- `bot/session/binding_updated`
- `bot/delivery_target/updated`
- `bot/outbound_delivery/created`
- `bot/outbound_delivery/updated`

这样可以避免前端只能靠大范围 `invalidateQueries` 猜哪些数据变了。

### 17.6 兼容性 workspace 路由建议

短期内保留现有 workspace 级路由，但内部应尽快转为调用新的 session / delivery service：

- `POST /api/workspaces/{workspaceId}/bot-conversations/{conversationId}/binding`
  - 兼容到 `UpdateSessionBinding`
- `POST /api/workspaces/{workspaceId}/bot-conversations/{conversationId}/binding/clear`
  - 兼容到 `ClearSessionBinding`
- `POST /api/workspaces/{workspaceId}/bot-conversations/{conversationId}/replay-latest-failed-reply`
  - 兼容到 `ReplayOutboundDelivery`

这样可以保证旧前端逐步迁移，而不是所有页面同时切换。

## 18. 与当前实现的迁移映射

### 18.1 当前字段到目标模型的映射

| 当前字段 | 目标含义 | 迁移建议 |
| --- | --- | --- |
| `BotConnection.ID` | `BotEndpoint.id` | 直接映射 |
| `BotConnection.BotID` | `BotEndpoint.botId` | 直接映射 |
| `BotConversation.ID` | `BotSession.id` | 直接映射 |
| `BotConversation.ConnectionID` | `BotSession.endpointId` | 直接映射 |
| `BotConversation.BindingID` | `BotSession.activeBindingId` | 直接映射 |
| `BotConversation.ThreadID` | resolved execution target | 短期继续保留；长期尽量由 binding 解析得出 |
| `BotConversation.ExternalChatID` / `ExternalThreadID` / `ExternalConversationID` | `routeKey` 组成部分 | 归一化成 provider route |
| `BotConversation.ProviderState` | `BotSession.providerState` / `BotDeliveryTarget.providerState` | session 视图保留一份，主动外发目标保留一份快照 |
| `BotConversation.LastOutbound*` | `BotOutboundDelivery` 最新投影 | 新增 delivery 后逐步退化为冗余摘要字段 |
| `BotInboundDelivery.Reply*` | 回复型 `BotOutboundDelivery` | 新增 delivery 记录时同步写入 |

### 18.2 建议的迁移阶段

推荐按以下阶段推进：

1. `服务层先分层，不动存储结构`
   - 补 `ResolveExecutionContext`
   - 补 `ResolveDeliveryTarget`
   - 补 `SendOutboundMessages`
   - 现有 `BotConversation` 继续存在

2. `新增 BotDeliveryTarget`
   - 为已有 session 提供 `EnsureSessionDeliveryTarget`
   - 先支持 session-backed target
   - 先不要求 route-backed target 全量上线

3. `新增 BotOutboundDelivery`
   - 新产生的回复和主动通知都写新 delivery 记录
   - 旧字段 `LastOutbound*` 继续维护为摘要投影

4. `前端切到新语义`
   - Bots 页面把 conversation 文案逐步替换成 session
   - 新增 outbound delivery 列表与详情
   - thread 页显式增加 `Send To Bot`

5. `最后再收口旧字段`
   - 当所有 UI 和 API 都稳定后，再评估是否移除 `ThreadID` 直连语义和 `LastOutbound*` 冗余字段

### 18.3 对现有 `bots.Service` 的改造建议

当前 `bots.Service` 已经包含：

- provider 接入
- inbound delivery 落库
- conversation/session 管理
- execution backend 解析
- reply 发送
- 部分失败重放

因此不建议新建一套平行 service。更可行的做法是：

1. 保留 `bots.Service` 作为主入口。
2. 先在内部拆出：
   - `resolveExecutionContext`
   - `resolveDeliveryTarget`
   - `sendOutboundMessages`
3. 让现有入站回复也逐步走新的出站记录结构。
4. 再把 notification / schedule 主动发送接进来。

这样改造范围集中，且能最大化复用现有 provider 发送实现。

### 18.4 对 `notifications` 与 `automations` 的接入建议

如果后续要做“通知主动发给 bot”，建议接法如下：

#### notification

- `notifications.Service` 仍负责产生业务事件
- 当通知规则目标是 bot 时，不直接拼 provider 消息
- 而是调用 `bots.Service.SendOutboundMessages(...)`
- `sourceType=notification`
- `sourceRefType=notification`
- `sourceRefId=<notificationId>`

#### automation / schedule

- `automations` 仍可保留当前 scheduler
- 但最终如果目标是 bot 对外发消息，也统一走 `SendOutboundMessages(...)`
- `sourceType=schedule`
- `sourceRefType=automation_run`

这样能保证通知、定时任务、thread 页手动发送，最终都沉淀成同一种 `BotOutboundDelivery`。

### 18.5 对前端的直接影响

前端在后续重构时，建议把以下三块 UI 明确拆开：

1. `Binding`
   - 解决“内部执行去哪”
   - 管理项包括：默认 binding、session binding、跨 workspace thread 绑定

2. `Delivery Target`
   - 解决“主动消息发给谁”
   - 管理项包括：session-backed target、route-backed target、能力校验

3. `Outbound Delivery`
   - 解决“发出去没有”
   - 管理项包括：状态、错误、重试、来源追踪、最近投递

只要前端继续把这三者混成一个“会话设置”面板，后面通知、主动发送、定时触发都会再次混乱。

## 19. 文件级实施计划

这一节把设计落到当前仓库的实际文件结构上，便于后续直接拆 issue 和开发任务。

### 19.1 第一批后端改造落点

#### `backend/internal/store/models.go`

建议新增以下实体或视图模型：

- `BotDeliveryTarget`
- `BotOutboundDelivery`
- 必要时增加 `BotDeliveryTargetCapability` 常量约束，避免 capability 名称在代码里散落为字符串字面量

同时建议保留现有：

- `Bot`
- `BotBinding`
- `BotConnection`
- `BotConversation`
- `BotInboundDelivery`

原因是当前这几类实体已经被 `bots.Service`、router、前端类型复用过，短期全部改名收益不高。

#### `backend/internal/store/memory.go`

建议补齐以下存取方法：

- `ListBotDeliveryTargets(workspaceID, botID string) []BotDeliveryTarget`
- `GetBotDeliveryTarget(workspaceID, targetID string) (BotDeliveryTarget, bool)`
- `CreateBotDeliveryTarget(target BotDeliveryTarget) (BotDeliveryTarget, error)`
- `UpdateBotDeliveryTarget(workspaceID, targetID string, updater func(BotDeliveryTarget) BotDeliveryTarget) (BotDeliveryTarget, error)`
- `DeleteBotDeliveryTarget(workspaceID, targetID string) error`
- `ListBotOutboundDeliveries(workspaceID, botID string, filter ...) []BotOutboundDelivery`
- `GetBotOutboundDelivery(workspaceID, deliveryID string) (BotOutboundDelivery, bool)`
- `CreateBotOutboundDelivery(delivery BotOutboundDelivery) (BotOutboundDelivery, error)`
- `UpdateBotOutboundDelivery(workspaceID, deliveryID string, updater func(BotOutboundDelivery) BotOutboundDelivery) (BotOutboundDelivery, error)`

如果 store 接口不在单独文件定义，而是靠 `MemoryStore` 事实标准演进，那么建议这批方法先在内存实现中补齐，再逐步扩展到其他 store backend。

#### `backend/internal/bots/types.go`

建议新增输入输出模型：

- `UpsertDeliveryTargetInput`
- `SendOutboundMessagesInput`
- `ReplayOutboundDeliveryInput`
- `DeliveryTargetView`
- `OutboundDeliveryView`
- `SessionView`
  说明：短期可以继续复用 `ConversationView`，但如果开始对外暴露新 API，建议同步引入更贴近目标语义的 view type。

#### `backend/internal/bots/service.go`

建议在现有 `Service` 上分三步改：

第一步：抽内部函数，不改对外 API

- 把 `resolveConversationBinding(...)`、`resolveConversationExecutionContext(...)` 继续保留
- 在此基础上新增：
  - `resolveDeliveryTarget(...)`
  - `ensureSessionDeliveryTarget(...)`
  - `sendOutboundMessages(...)`
- 让现有 `ReplayLatestFailedReply(...)` 内部开始复用新的 outbound 发送逻辑

第二步：增加新 service 方法

- `ListDeliveryTargets(...)`
- `UpsertDeliveryTarget(...)`
- `DeleteDeliveryTarget(...)`
- `SendOutboundMessages(...)`
- `ListOutboundDeliveries(...)`
- `GetOutboundDelivery(...)`

第三步：把旧逻辑逐步接入

- 被动回复发送从“直接调 provider + 写 conversation 摘要”切到“先写 outbound delivery，再发送，再回写摘要”
- notification / automation 统一接到 `SendOutboundMessages(...)`

#### `backend/internal/api/router.go`

建议新增以下 handler：

- `handleListBotDeliveryTargets`
- `handleUpsertBotDeliveryTarget`
- `handleDeleteBotDeliveryTarget`
- `handleSendBotSessionOutboundMessages`
- `handleSendBotDeliveryTargetOutboundMessages`
- `handleListBotOutboundDeliveries`
- `handleGetBotOutboundDelivery`

同时保留现有兼容路由：

- `handleUpdateBotConversationBinding`
- `handleClearBotConversationBinding`
- `handleReplayBotConversationFailedReply`

路由顺序建议维持当前风格，不要一次性把 workspace 路由删掉。先增加 `/api/bots/...` 或 `/api/workspaces/{workspaceId}/bots/{botId}/...` 的新入口，再让前端逐步迁移。

### 19.2 第一批前端改造落点

#### `frontend/src/types/api.ts`

建议新增类型：

- `BotSession`
- `BotDeliveryTarget`
- `BotOutboundDelivery`
- `SendBotOutboundMessageInput`
- `UpsertBotDeliveryTargetInput`

如果短期不改 API 返回名字，也至少要增加兼容类型别名，避免后续所有组件都继续拿 `BotConversation` 承担 session 和 delivery 语义。

#### `frontend/src/features/.../api.ts` 或现有 bots API 文件

建议补这些 API 包装：

- `listBotDeliveryTargets(...)`
- `upsertBotDeliveryTarget(...)`
- `deleteBotDeliveryTarget(...)`
- `sendBotSessionOutboundMessages(...)`
- `sendBotDeliveryTargetOutboundMessages(...)`
- `listBotOutboundDeliveries(...)`
- `getBotOutboundDelivery(...)`

#### `frontend/src/pages/BotsPage.tsx`

建议分三个面板推进，而不是继续往单个“绑定弹窗”里堆逻辑：

1. `Binding`
   - 保持当前 default binding 与 session binding 能力
   - 重点解决内部 thread 选择与状态展示

2. `Delivery Targets`
   - 展示 session-backed target
   - 后续再补 route-backed target
   - 展示 capability 与状态，如 `supportsProactivePush`、`requiresRouteState`

3. `Outbound Deliveries`
   - 展示最近发送记录
   - 支持失败重试
   - 展示来源，如 `notification`, `manual`, `schedule`, `reply`

#### `frontend/src/pages/thread-page/*`

后续如果要做 thread 页主动发给 bot，建议不要直接在 thread 详情组件里拼接口，而是复用：

- `listBotDeliveryTargets(...)`
- `sendBotSessionOutboundMessages(...)`
- `sendBotDeliveryTargetOutboundMessages(...)`

并且 UI 上必须强制用户显式选择目标 session 或 target，不能把当前 thread 直接当收件人。

### 19.3 推荐的实施顺序

如果按一周一个主题来拆，建议顺序如下：

1. 后端 store 模型与 `memory.go`
   - 新增 `BotDeliveryTarget`
   - 新增 `BotOutboundDelivery`
   - 补内存 store CRUD

2. `bots.Service` 内部拆分
   - 新增 `resolveDeliveryTarget`
   - 新增 `sendOutboundMessages`
   - 让 `ReplayLatestFailedReply` 走新链路

3. router + API types
   - 开新路由
   - 补 request/response model
   - 保留旧兼容路由

4. 前端 bots 页
   - 增加 delivery target 面板
   - 增加 outbound delivery 列表
   - 不急着一次性做 thread 页入口

5. thread 页主动发送
   - 显式选择 session/target
   - 发出后回看 outbound delivery 状态

6. notifications / automations 接入
   - 最后把业务通知和定时任务接到统一出站链路

## 20. 测试与验收清单

### 20.1 后端单测建议

当前仓库已有：

- [service_test.go](/E:/projects/ai/codex-server/backend/internal/bots/service_test.go)
- [workspace_thread_backend_test.go](/E:/projects/ai/codex-server/backend/internal/bots/workspace_thread_backend_test.go)
- [telegram_test.go](/E:/projects/ai/codex-server/backend/internal/bots/telegram_test.go)
- [wechat_test.go](/E:/projects/ai/codex-server/backend/internal/bots/wechat_test.go)
- [router_test.go](/E:/projects/ai/codex-server/backend/internal/api/router_test.go)

建议新增以下测试组：

1. delivery target 解析
   - session-backed target 能正确从 conversation/session 投影
   - route-backed target 缺少 provider state 时返回错误
   - provider 不支持 proactive push 时返回错误

2. outbound delivery 生命周期
   - 创建 delivery 后进入 `queued/sending`
   - 发送成功后写 `delivered`
   - provider 返回错误时写 `failed`
   - replay 只对失败 delivery 生效

3. 幂等校验
   - 相同 `idempotencyKey` 不重复发送
   - 不同 target 不共享幂等范围

4. 兼容路径
   - 旧的 `replay-failed-reply` 最终复用新 delivery 发送链
   - 旧 conversation binding API 不受影响

### 20.2 API 集成测试建议

围绕 [router_test.go](/E:/projects/ai/codex-server/backend/internal/api/router_test.go) 补以下 case：

- `POST /.../sessions/{sessionId}/outbound-messages`
- `POST /.../delivery-targets/{targetId}/outbound-messages`
- `GET /.../outbound-deliveries`
- `POST /.../delivery-targets`
- delivery target 参数不完整时返回 4xx
- provider capability 不满足时返回 4xx

### 20.3 前端验收建议

围绕 [BotsPage.tsx](/E:/projects/ai/codex-server/frontend/src/pages/BotsPage.tsx) 的实际交互，至少验证：

1. 修改 binding 后，不会误以为 thread 自动成为主动外发目标
2. 主动发送时，用户必须显式选择 session 或 delivery target
3. 发送中、发送成功、发送失败有明确视觉状态
4. 失败记录支持重试，且重试结果能刷新列表
5. 通知类发送在重复点击时不会制造重复消息

### 20.4 业务验收标准

这一轮改造完成后，至少应满足以下标准：

1. `binding` 与 `delivery target` 在数据模型、API、UI 三层都已分离
2. thread 页或通知页可以显式主动向 bot 外发消息
3. 外发记录可以独立追踪，不再只依赖 conversation 上的摘要字段
4. 旧的被动 bot 回复链路仍然可用
5. 旧前端路径仍能工作，迁移可以分阶段进行
