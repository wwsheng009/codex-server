# WeChat Bot 接入分析与实施报告

## 0. 范围与前提

本报告面向当前项目 `E:\projects\ai\codex-server`，分析如何基于现有 `bots` 机制，把 `WeChat` 接入到系统中，目标效果与当前 `Telegram` provider 相同：

1. 外部聊天平台收消息
2. 建立外部会话与内部 workspace thread 的映射
3. 把消息送入现有 `workspace_thread` 或 `openai_responses` 后端
4. 把 AI 回复再发回聊天平台
5. 由前端提供配置与管理入口

这里将用户说的 `webchat` 按 `WeChat` 理解。WeChat 协议与可行传输层，参考前一份源码分析：

- [cli-wechat-bridge-source-analysis.md](E:/projects/ai/codex-server/docs/bots/wechat/cli-wechat-bridge-source-analysis.md)

那份分析的关键结论是：

1. `CLI-WeChat-Bridge` 没有自己实现微信底层协议，而是依赖 `iLink bot HTTP API`
2. 可复用的真正协议能力主要在：
   - 二维码登录
   - `getupdates` 长轮询
   - `sendmessage` 文本发送
   - `getuploadurl + CDN + AES-128-ECB` 附件发送
3. `CLI-WeChat-Bridge` 的 `bridge/companion/approval` 体系是“本地 CLI 远程桥接”架构，不应直接搬进当前 `codex-server` 的 `bots` 模块

因此本报告的结论是：

> 要复用的是 `WeChat 传输协议层`，不是 `CLI bridge 架构`。

## 1. 当前项目的 bots 机制现状

### 1.1 后端抽象

当前 `backend/internal/bots/types.go` 定义了两个核心抽象：

1. `Provider`
   - 平台侧实现
   - 负责激活、停用、解析入站、发送出站
2. `AIBackend`
   - 执行侧实现
   - 当前已有 `workspace_thread` 和 `openai_responses`

还存在两个可选增强抽象：

1. `PollingProvider`
   - 支持后台轮询获取消息
2. `StreamingProvider`
   - 支持把流式回复增量发回外部平台

这套设计本身是正确的。WeChat 可以自然映射到其中：

- `WeChat` 作为 `Provider`
- `workspace_thread` / `openai_responses` 保持不变

### 1.2 现有 Telegram 接入链路

当前 Telegram 路线已经完整打通，核心链路如下：

1. 前端 Bots 页创建连接
2. 后端 `bots.Service.CreateConnection`
3. `telegramProvider.Activate`
4. webhook 模式：
   - 注册 `POST /hooks/bots/{connectionId}`
5. polling 模式：
   - `RunPolling -> getUpdates`
6. 入站消息落入 `BotInboundDelivery`
7. `bots.Service` 做 conversation 解析与线程绑定
8. 调 `AIBackend.ProcessMessage` / `ProcessMessageStream`
9. provider 再把回复发回 Telegram

相关实现位置：

- `backend/internal/bots/service.go`
- `backend/internal/bots/telegram.go`
- `backend/internal/bots/workspace_thread_backend.go`
- `backend/internal/api/router.go`
- `frontend/src/pages/BotsPage.tsx`
- `frontend/src/pages/botsPageUtils.ts`

### 1.3 当前前端形态

前端已经有 Bots 页面，但目前是**明显 Telegram 特化**的：

- provider 下拉里只有 `telegram`
- 文案大量直接写死 `Telegram`
- draft 结构是 `telegramDeliveryMode`、`telegramBotToken`
- `buildBotConnectionCreateInput()` 只理解 `telegram_delivery_mode`
- `Public Base URL` 的出现条件也是 Telegram webhook 模式

这意味着：

> 后端抽象基本可复用，但前端配置层还没有真正“provider-agnostic”。

## 2. Telegram 模式中可直接复用的部分

WeChat 接入时，以下机制可以直接复用，不需要重做：

### 2.1 连接与会话模型

当前持久化模型已经适合大多数 bot provider：

- `store.BotConnection`
- `store.BotConversation`
- `store.BotInboundDelivery`

对 WeChat 来说依然需要：

- workspace 级 `BotConnection`
- 外部会话到内部 thread 的映射
- 入站 delivery 持久化与恢复

### 2.2 worker 与异步处理模型

`bots.Service` 当前已经具备：

- 入站 delivery 落盘
- 每个 conversation 的 worker queue
- 失败恢复
- polling worker 生命周期管理

这些对 WeChat 同样成立，完全可以复用。

### 2.3 AI backend

`workspace_thread` 后端与 provider 无关，它只关心：

- 是否有 thread
- 如何 start turn
- 如何从 turn 中提取 bot-visible 输出

这部分可以原样复用。

### 2.4 slash 命令与审批指令

`bots.Service` 里已经有一套文本控制命令：

- `/thread`
- `/approvals`
- `/approve`
- `/decline`
- `/answer`

这些都属于“bot 文本命令协议”，不依赖 Telegram webhook。WeChat provider 只要能把文本送进 `bots.Service`，这些能力天然可复用。

## 3. 从 CLI-WeChat-Bridge 可复用的能力

`CLI-WeChat-Bridge` 对当前项目真正有价值的，不是 `bridge` 主循环，而是它的 WeChat transport 经验：

### 3.1 可直接借鉴的协议点

1. 二维码登录
   - `GET /ilink/bot/get_bot_qrcode?bot_type=3`
   - `GET /ilink/bot/get_qrcode_status?qrcode=...`
2. 长轮询收消息
   - `POST /ilink/bot/getupdates`
   - 维护 `get_updates_buf`
3. 文本发消息
   - `POST /ilink/bot/sendmessage`
4. 文本/语音内容解析
   - `item_list`
   - `text_item`
   - `voice_item.text`
5. 回复上下文依赖 `context_token`
6. 入站去重建议
   - `from_user_id + client_id + create_time_ms + context_token`

### 3.2 不应该直接照搬的部分

以下内容不属于当前 `codex-server` bots 架构应当复用的对象：

1. `src/bridge/wechat-bridge.ts`
   - 这是本地终端桥
2. `src/companion/*`
   - 这是本地可见 CLI 会话与 app-server IPC
3. `approval_required` 的本地 CLI 审批流程
4. `wechat-attachments` prompt 注入与附件回传协议
   - 这套设计是为“远程操控本地 CLI”服务的，不是为当前 workspace-thread bot service 服务的

结论是：

> 当前项目只需要借用 `setup.ts + wechat-transport.ts` 所揭示的远端协议，不应该把 `CLI-WeChat-Bridge` 整个运行时搬过来。

## 4. 直接新增 WeChat provider 时会碰到的核心问题

这里是最关键的分析部分。

### 4.1 好消息：WeChat 很适合走 polling provider

`CLI-WeChat-Bridge` 已证明 WeChat iLink bot API 可以通过长轮询工作：

- `getupdates`

这与当前 Telegram polling 模式非常接近。

因此 WeChat provider 的第一版完全可以只实现：

- `Provider`
- `PollingProvider`

而不需要任何 webhook。

这也意味着：

- 不需要 `publicBaseUrl`
- 不需要 `/hooks/bots/{connectionId}` 参与 WeChat 流程

### 4.2 第一个结构性问题：当前 bots 系统没有 provider-level conversation state

Telegram 发送回复时只需要：

- `chat_id`
- 可选 `message_thread_id`

而 WeChat 发送回复时需要：

- `to_user_id`
- `context_token`

问题在于：

1. `context_token` 是**每个会话/联系人上下文**上的数据
2. 当前 `store.BotConversation` 没有 provider 独立状态字段
3. 当前 `bots.InboundMessage` 也没有 provider metadata 承载位

这会导致：

- WeChat provider 能收到消息，但无法把 `context_token` 干净地保存下来
- 后续 `SendMessages()` 没法拿到可靠的 reply context

#### 结论

要支持 WeChat，必须补一个“provider conversation state”通道。

推荐做法：

1. `bots.InboundMessage` 增加：
   - `ProviderData map[string]string`
2. `store.BotInboundDelivery` 增加：
   - `ProviderData map[string]string`
3. `store.BotConversation` 增加：
   - `ProviderState map[string]string`

典型 WeChat 字段：

- `wechat_context_token`
- `wechat_sender_name`
- `wechat_session_id`
- `wechat_created_at_ms`

这样做的好处是：

1. provider 特有状态与 AI backend 状态分离
2. 不污染当前 `BackendState`
3. 后续如果 Discord、Slack、WhatsApp 也需要 provider-side state，也能复用同一抽象

### 4.3 第二个结构性问题：当前 polling ownership 是 Telegram 专用

现在 `bots.Service` 里有一套明显 Telegram 定制逻辑：

- `findConflictingTelegramPollingConnection`
- `telegramPollingOwner`
- `telegramPollingToken`
- `telegramPollingConflictError`

这套逻辑的本质是：

> 防止多个 active polling connection 用同一个 Telegram token 同时拉消息。

WeChat 也存在同类问题：

- 同一个 bot token / account 同时被两个连接轮询，会争用 cursor
- 还可能造成重复消费和乱序推进 `sync_buf`

#### 结论

这部分必须抽象成 provider-generic 机制，而不是继续写第二套 `wechatPollingOwner`。

推荐新增一个可选 provider 接口，例如：

```go
type PollingOwnershipProvider interface {
    PollingOwnerKey(connection store.BotConnection) string
    PollingConflictMessage(ownerConnectionID string) string
}
```

然后：

- Telegram 返回 `telegram:<bot_token>`
- WeChat 返回 `wechat:<account_id>` 或 `wechat:<bot_token>`

这样 `bots.Service` 就能统一做冲突检测。

### 4.4 第三个结构性问题：当前前端是 Telegram 写死的

当前前端 Bots 页面存在以下问题：

1. provider 选项只有 `telegram`
2. form draft 使用 `telegramDeliveryMode`、`telegramBotToken`
3. 文案和布局都是 Telegram 中心化
4. webhook/polling 显示逻辑是 Telegram 特定规则

如果直接在现有页面里再塞一组 WeChat 特殊字段，页面会迅速变得难维护。

#### 结论

在接入 WeChat 前，前端至少要做一次小规模结构化重构：

1. 把 Telegram-specific draft 字段改成 provider-aware 结构
2. 把 provider-specific 表单段拆成独立 section
3. Bots 页面头部与详情区文案改成通用 provider 表述

### 4.5 第四个结构性问题：WeChat 登录是异步二维码流程，不适合直接塞进 CreateConnection

Telegram 是同步表单模式：

- 输入 `bot_token`
- `POST /bot-connections`
- 后端 `Activate()`
- 成功后连接立即创建

WeChat 更像：

1. 发起二维码登录
2. 展示二维码
3. 用户扫码确认
4. 后端拿到 `bot_token` / `account_id` / `user_id`
5. 再创建 connection

如果硬把这套流程塞进 `CreateConnection`：

- API 会变成异步长事务
- `BotConnection` 状态需要新增 `auth_pending`
- pause/resume/create 的语义会变脏

#### 结论

最合理的方案不是修改 `CreateConnection` 为异步，而是增加一层**独立的 provider auth session API**。

推荐模式：

1. 前端先启动 WeChat 授权会话
2. 完成二维码登录
3. 获得 credential bundle
4. 再调用现有 `CreateConnection`

这样 `BotConnection` 生命周期保持干净：

- create 仍然是同步创建 active/paused connection
- provider auth 是连接创建前的准备步骤

## 5. 推荐目标架构

## 5.1 Provider 层定位

WeChat 接入应实现为：

- `backend/internal/bots/wechat.go`

实现接口：

- `Provider`
- `PollingProvider`

第一阶段不实现：

- `StreamingProvider`

### 5.2 Provider 行为建议

#### Activate

第一阶段建议：

1. 要求已有 credential bundle
2. 只做轻量校验与 settings 补全
3. 不主动消费 `getupdates`

原因：

- 当前已知协议里没有 Telegram `getMe` 那样的无副作用验证接口
- 如果在激活阶段直接调 `getupdates`，可能意外推进同步游标

建议激活时仅检查：

- `bot_token`
- `base_url`
- `account_id`
- `user_id`

以及填充：

- `wechat_base_url`
- `wechat_account_id`
- `wechat_owner_user_id`
- `wechat_delivery_mode = polling`

#### ParseWebhook

直接返回 `ErrWebhookIgnored`。

#### SupportsPolling

恒为 `true`，或在 `wechat_delivery_mode == polling` 时为 `true`。

#### RunPolling

内部逻辑应基本映射 `CLI-WeChat-Bridge` 的 `getupdates`：

1. 从 connection settings 读取：
   - `wechat_sync_buf`
2. 调 `ilink/bot/getupdates`
3. 解析 `msgs`
4. 过滤：
   - 只保留 `message_type == MSG_TYPE_USER`
   - 丢弃空文本
5. 构造 `InboundMessage`
6. 对每条消息推进 `wechat_sync_buf`

需要持久化的 provider setting：

- `wechat_sync_buf`

#### SendMessages

第一阶段只实现文本消息。

发送时从 conversation 的 `ProviderState` 中读取：

- `wechat_context_token`

以及从 conversation 读取：

- `ExternalChatID`
- `ExternalThreadID`

推荐映射（经当前代码结构核对后修正）：

- `ExternalChatID` = `from_user_id`
- `ExternalThreadID` = 第一版留空，或仅作展示信息，不参与回复路由
- `ConversationID` = `from_user_id`

原因：

- `sendmessage` 真正需要的是 `to_user_id + context_token`，并不依赖 `session_id`
- 前一份源码分析已经表明 `context_token` 是按 `senderId` 缓存，而不是按 `session_id` 缓存
- 当前 `MemoryStore.UpdateBotConversation()` 会把 `ExternalConversationID`、`ExternalChatID`、`ExternalThreadID` 视为稳定身份键，后续更新时不会允许它们被当作可变状态随意改写
- 因此第一版更稳妥的做法是：conversation 以“用户维度”稳定识别，`context_token` 与 `session_id` 则进入 `ProviderState`

### 5.3 数据模型建议

#### `bots.InboundMessage`

新增：

```go
ProviderData map[string]string
```

#### `store.BotInboundDelivery`

新增：

```go
ProviderData map[string]string
```

#### `store.BotConversation`

新增：

```go
ProviderState map[string]string
```

#### 状态同步规则

推荐规则：

1. delivery 记录完整 inbound provider metadata
2. resolve/create conversation 时，把最新 provider metadata 合并到 `ProviderState`
3. `SendMessages()` 永远从 `conversation.ProviderState` 取 reply context

这样即便 worker 重启，也能从持久化 conversation 恢复发送上下文。

这里还要结合当前 `bots.Service` 的 worker 语义再强调一次：

- 当前 worker key 是 `connectionID + ConversationID`
- 同一个 `ConversationID` 的消息会被串行处理

因此 WeChat 第一版如果使用：

- `ConversationID = from_user_id`

则同一用户的消息会自然进入同一个 worker，最新 `wechat_context_token` 也会按顺序覆盖，和当前 `ProviderState` 设计是相容的。

反过来，如果把 `session_id` 作为 `ConversationID`：

- 同一用户的消息可能被拆到多个 worker
- `ProviderState` 更新会分散到多个 conversation 记录
- 回复上下文将更容易出现竞争和漂移

所以从当前代码语义看，`from_user_id` 不只是“更方便”，而是和现有串行处理模型更一致。

### 5.4 WeChat 授权会话建议

建议新增一个独立服务，例如：

- `backend/internal/bots/wechat_auth.go`

职责：

1. `StartLogin()`
   - 调 `get_bot_qrcode`
2. `GetLoginStatus()`
   - 调 `get_qrcode_status`
3. confirmed 后返回 credential bundle

推荐 API：

- `POST /api/workspaces/{workspaceId}/bot-providers/wechat/login/start`
- `GET /api/workspaces/{workspaceId}/bot-providers/wechat/login/{loginId}`
- `DELETE /api/workspaces/{workspaceId}/bot-providers/wechat/login/{loginId}`

返回字段建议：

- `loginId`
- `status`
- `qrCodeContent`
- `accountId`
- `userId`
- `baseUrl`
- `credentialReady`

前端完成二维码登录后，再把拿到的 credential bundle 放进标准 `CreateConnectionInput.secrets/settings` 中提交。

## 6. 推荐实施路线

我建议不要一次做完二维码、轮询、流式、附件，而是分阶段。

### Phase 1: 最小可用版

目标：

- 像 Telegram 一样，让 WeChat 文本消息可以进入 `workspace_thread`
- 最终回复以文本形式回发
- 配置入口可在前端完成

范围：

1. 后端新增 `wechat` provider
2. 只支持 polling
3. 只支持文本收发
4. conversation/provider state 持久化
5. 前端 Bots 页面支持 WeChat provider
6. CreateConnection 支持“手动填写 credential bundle”

这一阶段不做：

- 前端二维码登录
- 附件上传
- 流式更新
- WeChat 特殊富文本

这样做的优点是：

1. 能快速证明 `bots` 抽象能承载 WeChat
2. 把复杂点压缩到 provider 与 provider-state 抽象上
3. 不会被 QR 登录 UI 和附件能力拖慢主线

### Phase 2: 二维码授权接入前端

目标：

- 用户不再手填 token
- 直接在 Bots 页面发起 WeChat 登录

范围：

1. 新增 provider auth session API
2. 前端增加二维码授权 modal
3. 登录成功后把 credential bundle 注入 create flow

这一阶段依然可以不做 streaming 和附件。

### Phase 3: 体验增强

目标：

- 更接近 Telegram 已有体验

可选项：

1. 流式文本回显
   - 仅在 WeChat 协议能接受较高频文本发送时考虑
   - 如不支持 edit-in-place，只能采用保守批量消息策略
2. 附件支持
   - 需要先扩展 `OutboundMessage`
   - 或新增富消息结构
3. 更细致的发送失败恢复
4. provider-specific diagnostics

## 7. 具体改动建议

## 7.1 后端改动

### 必改文件

1. `backend/internal/bots/types.go`
   - 为 `InboundMessage` 增加 `ProviderData`
   - 建议新增对外 API 使用的 `ConversationView`
2. `backend/internal/store/models.go`
   - 为 `BotInboundDelivery` 增加 `ProviderData`
   - 为 `BotConversation` 增加 `ProviderState`
3. `backend/internal/store/memory.go`
   - `cloneBotConversation()` / `cloneBotInboundDelivery()` 需要复制新增 map
   - `CreateBotConversation()` / `UpdateBotConversation()` / `UpsertBotInboundDelivery()` / `updateBotInboundDelivery()` 需要保留 provider state/data
   - 持久化 snapshot 自动会带出新字段，但 clone 路径必须补齐
4. `backend/internal/bots/service.go`
   - `acceptInboundMessage()` 持久化 provider data
   - `resolveConversation()` 合并 provider state
   - `recordConversationOutcome()` 保留 provider state
   - `ListConversations()` 建议改为返回脱敏后的 `ConversationView`
   - 把 Telegram-specific polling ownership 泛化
   - 去除或改写硬编码 Telegram 文案
5. `backend/internal/bots/runtime_mode.go`
   - 无需大改，但 debug log 文案可保持 provider 中立
6. `backend/internal/bots/wechat.go`
   - 新增 provider 实现
7. `backend/internal/bots/service_test.go`
   - 增加 provider-state persistence 和 polling ownership 测试
8. `backend/internal/api/router.go`
   - 若做二维码登录，则新增 auth session API
9. `backend/internal/api/router_test.go`
   - 若新增 WeChat auth session API，需要补路由接线测试

### 建议新增文件

1. `backend/internal/bots/wechat.go`
2. `backend/internal/bots/wechat_test.go`
3. `backend/internal/bots/wechat_auth.go`
4. `backend/internal/bots/wechat_auth_test.go`

### 关键代码修改建议

#### 1. Provider 注册

在 `NewService()` 里增加：

```go
service.registerProvider(newWeChatProviderWithClientSource(clientSource))
```

#### 2. 默认连接名

当前 `defaultConnectionName()` 只有 Telegram，需增加：

- `WeChat Bot`

#### 3. provider-neutral 错误文本

当前存在这种 Telegram 写死文案：

- `"this request cannot be completed from Telegram; use the workspace UI instead"`

应改成 provider-neutral，例如：

- `"this request cannot be completed from this bot provider; use the workspace UI instead"`

或者：

- `"this request cannot be completed from WeChat; use the workspace UI instead"`

更推荐第二种，通过 provider label 渲染。

#### 4. polling ownership 抽象

不要继续把 WeChat 写成第二套 Telegram 分支。应该把当前 Telegram 轮询冲突检测提升成通用策略。

## 7.2 前端改动

### 必改文件

1. `frontend/src/pages/BotsPage.tsx`
2. `frontend/src/pages/botsPageUtils.ts`
3. `frontend/src/pages/botsPageUtils.test.ts`
4. `frontend/src/types/api.ts`
   - `BotConversation` 类型应与后端 `ConversationView` 对齐，而不是继续镜像 store model
5. `frontend/src/features/bots/api.ts`

### 前端结构改造建议

#### 1. draft 改成 provider-aware

当前 draft：

- `telegramDeliveryMode`
- `telegramBotToken`

建议改成：

- 通用字段
  - `provider`
  - `name`
  - `runtimeMode`
  - `aiBackend`
  - `publicBaseUrl`
- Telegram 字段
  - `telegramDeliveryMode`
  - `telegramBotToken`
- WeChat 字段
  - `wechatBaseUrl`
  - `wechatBotToken`
  - `wechatAccountId`
  - `wechatUserId`
  - `wechatCredentialSource`

如果进入 Phase 2，再增加：

- `wechatLoginSessionId`
- `wechatLoginStatus`
- `wechatQrCodeContent`

#### 2. Provider 选择

`providerOptions` 增加：

- `wechat`

#### 3. 条件化表单区

当 `provider === 'wechat'` 时：

1. 隐藏 `Public Base URL`
2. 隐藏 webhook/polling 选项
3. 显示：
   - WeChat base URL
   - account ID
   - user ID
   - bot token
   - 或二维码授权入口

#### 4. 页面文案去 Telegram 中心化

当前 Bots 页大段文案是：

- “Connect Telegram bots...”
- “Telegram supports both webhook and long-polling...”

建议改成：

- 顶部使用 provider-neutral 描述
- 选中不同 provider 时，在详情区展示 provider-specific posture

例如：

- Telegram:
  - webhook / polling
- WeChat:
  - polling only
  - no public callback URL required
  - reply context depends on inbound session token

另外还需要处理一个容易忽略的 Telegram 语义泄漏：

- `formatBotConversationTitle()` 当前会把 `externalThreadId` 渲染成 `(topic X)`

这明显是 Telegram topic 语义，不适合泛化到 WeChat。更稳妥的方式是：

- Telegram provider 下才显示 `topic`
- 其他 provider 直接显示 provider-neutral secondary label
- 或第一版直接不展示 `externalThreadId`

## 8. 推荐的数据映射

这里给出第一版建议映射。

### 8.1 BotConnection.Settings

建议增加 WeChat settings：

- `wechat_delivery_mode = polling`
- `wechat_base_url`
- `wechat_account_id`
- `wechat_owner_user_id`
- `wechat_sync_buf`

### 8.2 BotConnection.Secrets

建议：

- `bot_token`

如果后续需要，也可区分为：

- `wechat_bot_token`

但从当前系统看，共享 `bot_token` 也可工作，因为 provider 不同。

### 8.3 InboundMessage.ProviderData

建议存：

- `wechat_context_token`
- `wechat_sender_name`
- `wechat_session_id`
- `wechat_created_at_ms`

### 8.4 BotConversation.ProviderState

建议最终至少保留：

- `wechat_context_token`
- `wechat_session_id`
- `wechat_sender_name`

其中最关键的是：

- `wechat_context_token`

### 8.5 External Routing 与入站去重

第一版建议：

- `ConversationID = from_user_id`
- `ExternalChatID = from_user_id`
- `ExternalThreadID = ""`
- `MessageID = from_user_id + client_id + create_time_ms + context_token` 的稳定组合值

这样做的原因：

1. 当前 `MemoryStore` 的入站去重键是 `workspaceID + connectionID + externalConversationID + messageID`
2. 如果 `MessageID` 为空，当前实现会生成随机 lookup key，去重直接失效
3. 当前 `UpdateBotConversation()` 与 `updateBotInboundDelivery()` 会把 `ExternalConversationID` / `ExternalChatID` / `ExternalThreadID` 固定回旧值，这些字段在现有代码里更接近“身份键”，不适合承载会变化的 `context_token` 或潜在变化的 `session_id`
4. 前一份 `CLI-WeChat-Bridge` 源码分析也表明，真正决定能否回消息的是“发送对象 + 最新 `context_token`”，而不是 `session_id`

因此第一版 WeChat provider 应该：

- 把稳定身份放在 `ConversationID`
- 把可变化的回复上下文放在 `ProviderData` / `ProviderState`
- 把用于防重的复合键写入 `InboundMessage.MessageID`

## 9. 附件与流式回复是否应该进入第一版

不建议。

原因很明确：

### 9.1 当前 bots 协议是文本优先

当前 `bots.OutboundMessage` 只有：

```go
type OutboundMessage struct {
    Text string
}
```

也就是说现有 provider 能力边界就是文本。

Telegram 之所以已经体验不错，是因为：

- 先把 streaming + text chunking 做好了
- 并没有把富媒体作为当前 bots 抽象的一部分

### 9.2 WeChat 附件发送需要 richer outbound schema

如果要支持：

- 图片
- 文件
- 视频
- 语音

需要至少把 `OutboundMessage` 升级为 richer model，例如：

```go
type OutboundPart struct {
    Kind string
    Text string
    FilePath string
}
```

这不是 WeChat 单独的问题，而是整个 bots 模块的协议升级问题。

#### 结论

第一版 WeChat 不应承诺附件能力。先做文本 bot parity。

### 9.3 流式回复也不建议先做

Telegram 的 streaming 之所以顺手，是因为它有：

- `sendMessage`
- `editMessageText`
- `deleteMessage`

而当前已知 WeChat iLink API 只证明了：

- 发消息
- 发附件

没有证明存在“原地编辑消息”的公开能力。

如果没有 edit-in-place，硬做 streaming 只会产生大量刷屏消息。

#### 结论

第一版 WeChat 应该走 final-only reply。

## 10. 风险评估

### 10.1 最大风险：reply context 必须依赖 `context_token`

这是 WeChat 与 Telegram 最大不同。

影响：

1. conversation model 必须支持 provider state
2. provider send 失败时，可能需要提示：
   - `context token missing or expired`
3. 用户下一条入站消息可能刷新上下文

### 10.2 第二大风险：协议可验证接口不足

Telegram 有 `getMe`，而当前已知 WeChat iLink bot API 没有等价“无副作用校验”接口。

影响：

- `Activate()` 很难像 Telegram 那样即时验证 token 完整性

解决建议：

- 第一版依赖二维码登录成功结果作为 credential 正确性的来源
- 手动录入模式则只做字段完整性校验

### 10.3 第三大风险：当前前端重构不到位会导致技术债更大

如果直接在 `BotsPage.tsx` 里继续堆 WeChat 专用字段，而不先做 provider-aware 重构，会导致：

1. 表单逻辑爆炸
2. 文案越来越不可维护
3. 后续 Slack/Discord/WhatsApp 也会复制同样问题

## 11. 最终建议

综合现有代码和 `CLI-WeChat-Bridge` 协议分析，我的建议是：

### 推荐主路径

1. 先把当前 bots 核心抽象补齐：
   - provider conversation state
   - provider-generic polling ownership
   - provider-neutral 文案
2. 先做 WeChat polling + 文本收发 MVP
3. 前端先支持 WeChat provider 表单
4. 再做二维码授权 API 和前端 modal
5. 最后视需要决定是否扩展 streaming / attachment

### 不推荐路径

不建议把 `CLI-WeChat-Bridge` 整个 bridge 体系并入当前 bots 模块。

理由：

1. `CLI-WeChat-Bridge` 服务的是“本地 CLI 远程操控”
2. 当前 `codex-server` bots 模块服务的是“workspace_thread conversation bot”
3. 两者的执行模型、状态权威和审批路径不同

正确做法是：

> 只复用 WeChat transport/protocol 经验，不复用 bridge runtime。

## 12. 建议实施顺序

建议按下面顺序落地：

1. 后端抽象重构
   - `ProviderData`
   - `ProviderState`
   - polling ownership genericization
2. 新增 `wechat` provider
   - polling only
   - text only
3. 前端 Bots 页 provider-aware 重构
4. 前端支持手动 WeChat credential 创建 connection
5. 增加二维码授权会话 API
6. 前端接二维码登录流
7. 评估 streaming / attachment 是否值得进入 bots 模块

## 13. 一句话结论

当前项目**可以**按 Telegram 的 bots 机制接入 WeChat，而且整体方向是对的，但不能简单“照抄 Telegram provider”。

必须先处理三件事：

1. `context_token` 所需的 provider conversation state
2. Telegram 专用的 polling ownership 逻辑泛化
3. 前端 Bots 页面从 Telegram 专用表单改成 provider-aware 表单

完成这三件事后，WeChat 的第一版完全可以作为：

- `polling only`
- `text only`
- `workspace_thread` 复用

的 provider 稳定接入当前系统。

## 14. 基于当前代码核对后的修正与补充

这一节是在实际核对当前仓库代码后追加的实现级结论，用于把前文从“架构判断”收敛到“可直接动手改代码”的粒度。

### 14.1 已被代码验证的关键判断

下列结论已经被当前代码直接验证：

1. `backend/internal/bots/types.go` 里的 `InboundMessage` 目前没有 provider metadata 承载位
2. `backend/internal/bots/service.go` 的 `resolveConversation()` 只会维护外部路由基础字段与最近文本，不会维护 provider-side reply context
3. `backend/internal/bots/service.go` 的 polling ownership 完整写死在 Telegram 分支里：
   - `validatePollingConnectionOwnership()`
   - `findConflictingTelegramPollingConnection()`
   - `telegramPollingOwner()`
   - `telegramPollingConflictError()`
4. `frontend/src/pages/BotsPage.tsx`、`frontend/src/pages/botsPageUtils.ts`、`frontend/src/pages/botsPageUtils.test.ts` 当前都显著 Telegram 特化
5. `backend/internal/api/router.go` 目前只有标准 bot connection CRUD 和统一 webhook 入口，没有 provider auth session API

这意味着前文的总体方向没有问题，但在真正动手实现时，需要把“稳定身份”和“可变 provider 状态”分得更明确。

### 14.2 现有 Store 对外部路由字段的真实语义

当前 `MemoryStore` 有一个非常重要的行为特征：

1. `UpdateBotConversation()` 会把 `ExternalConversationID`、`ExternalChatID`、`ExternalThreadID` 固定回旧值
2. `updateBotInboundDelivery()` 也会把 `ExternalConversationID`、`ExternalChatID`、`ExternalThreadID` 固定回旧值

这说明在当前仓库里，这些字段并不是“每条消息都可以刷新的临时 provider 状态”，而是更接近：

- conversation identity
- delivery routing identity

因此 WeChat 第一版不应该把：

- `context_token`
- `session_id`

设计成依赖外部路由字段去刷新。更合理的做法是：

- 外部路由字段保持稳定身份
- 最新 reply context 进入 `ProviderState`

这也进一步支持了前文修正后的推荐映射：conversation 优先按 `from_user_id` 建模。

### 14.3 Polling ownership 抽象应进一步收敛

前文给过一个可选接口方向，但结合当前 `service.go` 的真实调用方式，更推荐用下面这种形式：

```go
type PollingOwnershipProvider interface {
    PollingOwnerKey(connection store.BotConnection) string
    PollingConflictError(ownerConnectionID string) error
}
```

这样比单纯返回 message 更贴近现有服务层代码，原因是：

1. `CreateConnection()` 和 `ResumeConnection()` 当前直接返回 `error`
2. `syncPollingConnection()` 当前也是直接把冲突错误写进 `LastError`
3. Telegram 和 WeChat 的 remediation 文案并不相同

具体效果可以是：

- Telegram:
  - owner key: `telegram:<bot_token>`
  - conflict error: 可以继续提示“切到 webhook”
- WeChat:
  - owner key: `wechat:<bot_token>` 或 `wechat:<account_id>`
  - conflict error: 只能提示 pause/delete 另一个 polling connection，不应再出现 webhook 提示

### 14.4 WeChat provider 的两个实现性约束

除了 provider state，本次核对还得到两个之前应该明确写进实施文档的约束：

#### 1. `InboundMessage.MessageID` 必须由 provider 主动合成

当前 store 的入站去重依赖 `messageID`。如果 provider 留空，`botInboundLookupKey()` 会生成随机 key，意味着：

- 同一条消息重复拉到时无法去重
- 失败恢复时也没有稳定主键可依赖

因此 WeChat provider 必须把前一份源码分析里的建议防重字段真正落实成 `MessageID`，而不是只放在 `ProviderData` 里。

#### 2. `context_token` 应视为“最近一次有效回复上下文”

当前 `SendMessages()` 的调用点只拿 `conversation`，并不会回看整条 delivery 列表。

因此 service 层必须保证：

1. 每次收到新的 inbound WeChat 消息，都把最新 `wechat_context_token` 合并进 `conversation.ProviderState`
2. `SendMessages()` 始终从 `conversation.ProviderState` 读取最新 `wechat_context_token`

这样 worker 重启、失败重试、重新投递时，provider 仍然能找到当前可回复上下文。

### 14.5 `ConversationID` 还承担 worker 串行键语义

当前 `Service.workerKeyForJob()` 的规则是：

```go
if isBotControlCommand(job.message.Text) {
    return job.connectionID + "\x00control"
}
return job.connectionID + "\x00" + job.message.ConversationID
```

这意味着 `ConversationID` 不只是 store identity，它还决定：

- 哪些消息会进入同一条 worker queue
- 哪些消息会严格串行处理

因此 WeChat 第一版采用：

- `ConversationID = from_user_id`

还有一个隐藏好处：

1. 同一用户的上下文刷新天然串行
2. `context_token` 总是朝“最近一次收到的有效上下文”单方向更新
3. 恢复重试时也更符合“按联系人恢复 bot 会话”的预期

这进一步说明不应把 `session_id` 当成第一版的 conversation key。

### 14.6 当前连接模型对 WeChat settings/secrets 已经足够宽松

还有一个被代码验证过、对实施顺序很重要的事实：

1. `CreateConnectionInput` 已经允许自由传入 `settings map[string]string`
2. `CreateConnectionInput` 已经允许自由传入 `secrets map[string]string`
3. `normalizeBotConnectionSettings()` 当前只校验 `runtime_mode`
4. `MemoryStore.CreateBotConnection()` 会原样 clone 并持久化这些 map

这意味着 Phase 1 的“手动录入 WeChat credential bundle”其实不需要为了字段 schema 再改后端 API 协议，只需要：

- 前端能提交这些 settings/secrets
- `wechatProvider.Activate()` 对必填字段做校验

也就是说 Phase 1 完全可以复用当前标准 `CreateConnection`：

- `settings.wechat_base_url`
- `settings.wechat_account_id`
- `settings.wechat_owner_user_id`
- `settings.wechat_delivery_mode = polling`
- `secrets.bot_token`

这也是为什么建议把二维码登录放到 Phase 2，而不是一上来改造 connection create lifecycle。

### 14.7 会话 API 视图层需要先于 ProviderState 落地

当前还存在一个实现时必须正面处理的问题：

1. `bots.Service.ListConversations()` 现在直接返回 `[]store.BotConversation`
2. `router.go` 又把它原样写给前端
3. `frontend/src/types/api.ts` 的 `BotConversation` 也在镜像这个 store model

这在当前阶段问题还不大，但如果把下面这些值放进 `BotConversation.ProviderState`：

- `wechat_context_token`
- `wechat_session_id`

它们会直接经 API 暴露给前端。

这不是理想设计，尤其是 `wechat_context_token` 已经接近“回复能力上下文凭据”。

因此更推荐在这一轮重构里顺手把 conversations API 改成 view-model 方式，模式参考现有的 `ConnectionView`：

```go
type ConversationView struct {
    ID                     string            `json:"id"`
    WorkspaceID            string            `json:"workspaceId"`
    ConnectionID           string            `json:"connectionId"`
    Provider               string            `json:"provider"`
    ExternalConversationID string            `json:"externalConversationId,omitempty"`
    ExternalChatID         string            `json:"externalChatId"`
    ExternalThreadID       string            `json:"externalThreadId,omitempty"`
    ExternalUserID         string            `json:"externalUserId,omitempty"`
    ExternalUsername       string            `json:"externalUsername,omitempty"`
    ExternalTitle          string            `json:"externalTitle,omitempty"`
    ThreadID               string            `json:"threadId,omitempty"`
    LastInboundMessageID   string            `json:"lastInboundMessageId,omitempty"`
    LastInboundText        string            `json:"lastInboundText,omitempty"`
    LastOutboundText       string            `json:"lastOutboundText,omitempty"`
    CreatedAt              time.Time         `json:"createdAt"`
    UpdatedAt              time.Time         `json:"updatedAt"`
}
```

这样做的收益：

1. `ProviderState` 可以安全持久化，但不必暴露给前端
2. 当前已经暴露出去的 `BackendState` 也可以一并从 conversations API 脱敏
3. 前端 Bots 页面实际上并不依赖 `BackendState` / `ProviderState`，切换成本很低

如果暂时不想做完整 view layer，至少也要保证：

- `ProviderState` 不会被路由直接回传

但从长期维护性看，建议直接补 `ConversationView`。

### 14.8 WeChat provider 最小代码骨架建议

为了避免下一步编码时再次回到纯概念讨论，这里给出更接近当前代码库风格的 provider 骨架建议。

#### 1. 常量与 settings key

建议在 `backend/internal/bots/wechat.go` 里定义：

```go
const (
    wechatProviderName            = "wechat"
    wechatDeliveryModeSetting     = "wechat_delivery_mode"
    wechatDeliveryModePolling     = "polling"
    wechatBaseURLSetting          = "wechat_base_url"
    wechatAccountIDSetting        = "wechat_account_id"
    wechatOwnerUserIDSetting      = "wechat_owner_user_id"
    wechatSyncBufSetting          = "wechat_sync_buf"
    wechatContextTokenKey         = "wechat_context_token"
    wechatSessionIDKey            = "wechat_session_id"
    wechatSenderNameKey           = "wechat_sender_name"
    wechatCreatedAtMSKey          = "wechat_created_at_ms"
    wechatChannelVersion          = "0.3.0"
)
```

#### 2. transport 请求头

根据前一份源码分析，统一请求头至少应包括：

```text
AuthorizationType: ilink_bot_token
Authorization: Bearer <bot_token>
```

登录状态轮询还出现了：

```text
iLink-App-ClientVersion: 1
```

因此建议 provider 内部先抽一个最小 transport helper：

```go
func (p *wechatProvider) callJSON(ctx context.Context, baseURL string, token string, method string, path string, payload any, target any) error
```

由它统一负责：

- 拼 URL
- 写鉴权头
- 序列化 JSON
- 反序列化错误响应

#### 3. `Activate()`

第一版建议只做字段存在性校验与 settings 补全：

```go
func (p *wechatProvider) Activate(ctx context.Context, connection store.BotConnection, _ string) (ActivationResult, error)
```

校验项：

- `secrets.bot_token`
- `settings.wechat_base_url`
- `settings.wechat_account_id`
- `settings.wechat_owner_user_id`

补全项：

- `wechat_delivery_mode = polling`

第一版不要在这里主动调 `getupdates`。

#### 4. `RunPolling()`

建议读取：

- `settings.wechat_base_url`
- `settings.wechat_sync_buf`
- `secrets.bot_token`

然后循环调用：

```text
POST /ilink/bot/getupdates
```

把每条支持的入站消息转成：

```go
InboundMessage{
    ConversationID: fromUserID,
    ExternalChatID: fromUserID,
    MessageID:      stableWeChatMessageID(...),
    UserID:         fromUserID,
    Username:       senderName,
    Title:          senderName,
    Text:           extractedText,
    ProviderData: map[string]string{
        wechatContextTokenKey: contextToken,
        wechatSessionIDKey:    sessionID,
        wechatSenderNameKey:   senderName,
        wechatCreatedAtMSKey:  createTimeMS,
    },
}
```

轮询结束前通过 `updateSettings()` 持久化：

- `wechat_sync_buf`

#### 5. `SendMessages()`

第一版只支持文本：

1. 从 `conversation.ExternalChatID` 读取 `to_user_id`
2. 从 `conversation.ProviderState[wechatContextTokenKey]` 读取 `context_token`
3. 把 `[]OutboundMessage` 扁平成多条文本发送
4. 调：

```text
POST /ilink/bot/sendmessage
```

如果 `context_token` 缺失，应该返回 provider-specific 错误，而不是静默丢消息。

#### 6. auth session

如果进入 Phase 2，建议返回字段尽量贴近已知远端协议：

- `status: wait | scaned | confirmed | expired`
- `botToken`
- `accountId`
- `userId`
- `baseUrl`

其中 `scaned` 的拼写建议保持与上游协议一致，在前端再做展示层文案转换。

### 14.9 建议补充的测试矩阵

为了把 WeChat MVP 做稳，建议至少补下面这些测试：

1. `wechat_test.go`
   - `RunPolling()` 能解析文本消息
   - 会忽略不支持的消息类型
   - 会推进 `wechat_sync_buf`
   - 会生成稳定 `MessageID`
2. `service_test.go`
   - `ProviderData` 会随 delivery 落盘
   - `ProviderState` 会在 conversation 中被合并并持久化
   - 回复发送使用的是最新 `wechat_context_token`
   - generic polling ownership 能同时覆盖 Telegram 和 WeChat
3. `router_test.go`
   - 若新增二维码登录 API，验证 start/status/cancel 路由已接线
4. `botsPageUtils.test.ts`
   - WeChat 手动 credential 模式能生成正确 payload
   - WeChat 模式不会再要求 `publicBaseUrl`
   - WeChat 模式不会写入 `telegram_delivery_mode`
   - conversation title 格式不再把非 Telegram provider 的 `externalThreadId` 渲染成 `topic`

### 14.10 结论修正

综合源码分析文档与当前仓库代码，WeChat 第一版最稳妥的落地形态应修正为：

- `polling only`
- `text only`
- `ConversationID = from_user_id`
- `MessageID = 由 provider 合成的稳定去重键`
- `context_token` 保存在 `BotConversation.ProviderState`

也就是说，真正需要新增的不是“另一套 Telegram 风格 provider 分支”，而是：

1. provider-side mutable state 通道
2. provider-generic polling ownership
3. provider-aware 前端配置结构
4. WeChat 专用 transport provider

这四块补齐后，当前 bots 架构就已经足以承载一个稳定的 WeChat MVP。
