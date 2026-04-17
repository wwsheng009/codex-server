# Bot 连接实现原理与接入参考

更新时间：2026-04-17

适用项目：

- `E:\projects\ai\codex-server`
- 参考项目：`E:\projects\ai\cc-connect`

关联代码：

- `backend/internal/bots/types.go`
- `backend/internal/bots/service.go`
- `backend/internal/bots/telegram.go`
- `backend/internal/bots/wechat.go`
- `backend/internal/bots/feishu.go`
- `backend/internal/bots/qqbot.go`
- `backend/internal/bots/workspace_thread_backend.go`
- `backend/internal/bots/trigger_dispatcher.go`
- `backend/internal/bots/thread_binding_dispatcher.go`
- `backend/internal/bots/feishu_test.go`
- `backend/internal/bots/qqbot_test.go`
- `backend/internal/bots/routing_providers_test.go`
- `backend/internal/api/router.go`
- `frontend/src/features/bots/api.ts`
- `frontend/src/pages/BotsPage.tsx`
- `E:\projects\ai\cc-connect\core\interfaces.go`
- `E:\projects\ai\cc-connect\core\engine.go`
- `E:\projects\ai\cc-connect\platform\feishu\feishu.go`
- `E:\projects\ai\cc-connect\platform\qqbot\qqbot.go`
- `E:\projects\ai\cc-connect\platform\qq\qq.go`

---

## 1. 文档目标

本文档用于回答三个问题：

1. 各类 bot / 平台连接的底层实现原理是什么。
2. `codex-server` 当前已经具备哪些 bot 配置、接入、会话绑定、主动发送与通知能力。
3. Feishu、QQ Bot 已如何按当前架构接入，以及后续扩展还应补哪些能力。

本文档不是单个平台的安装教程，而是一份**实现级参考文档**。如果只需要现有平台的使用说明，可优先参考：

- `docs/bot-integration-design.md`
- `docs/bots/telegram/telegram-bot-inbound-media-implementation.md`
- `docs/bots/wechat/wechat-bot-functional-overview.md`
- `docs/development/notification-center-hook-bot-architecture-2026-04-16.md`

---

## 2. 先说结论

### 2.1 `cc-connect` 的连接模型

`cc-connect` 采用的是：

```text
平台适配器 -> 统一 Message -> Engine -> Agent -> 原平台回复
```

它的重点是：

- 一个 project 可挂多个平台
- 所有平台共享同一个 `Engine`
- 平台只负责“接消息 / 发消息 / 维护 reply context”
- 会话通过 `sessionKey` 做隔离
- 不做“平台资源层”建模

### 2.2 `codex-server` 的连接模型

`codex-server` 采用的是：

```text
Bot(逻辑实体)
  -> BotConnection(平台端点)
  -> BotConversation(外部会话)
  -> AIBackend(workspace_thread / openai_responses)
  -> BotDeliveryTarget / BotTrigger / ThreadBotBinding
```

它的重点是：

- bot 被建模为独立资源，而不是单纯的平台实例
- connection、conversation、delivery target、trigger 都是显式对象
- 不只支持“用户发消息 -> bot 回复”，还支持：
  - 主动外发
  - 线程绑定回推
  - 通知触发
  - delivery target 复用

### 2.3 两个项目最核心的差别

| 维度 | `cc-connect` | `codex-server` |
| --- | --- | --- |
| 主体模型 | project + platform + agent | bot + connection + conversation + backend + target |
| 目标 | 把 AI agent 接到聊天平台 | 把聊天平台接到 Codex 工作区、线程、通知体系 |
| 会话主键 | `sessionKey` | `BotConversation` + `ThreadID` + `ProviderState` |
| 主动发送 | 有限，偏 reply/send | 原生支持 `DeliveryTarget`、`Trigger`、`ThreadBotBinding` |
| 扩展平台方式 | 新增 `Platform` 实现 | 新增 `Provider` 实现，必要时补 `PollingProvider` / `StreamingProvider` / `TypingProvider` |

**结论：**

- `cc-connect` 更适合当作“平台适配模式”的参考。
- `codex-server` 当前架构更适合承载“bot 资源管理 + 主动消息分发”。
- 后续若接入 Feishu / QQ / QQ Bot，应该复用 `cc-connect` 的平台连接经验，但落地到 `codex-server` 的 `Provider + BotConnection + BotConversation + DeliveryTarget` 模型里。

---

## 3. Bot 连接的通用实现原理

不管平台是 Telegram、WeChat、Feishu 还是 QQ Bot，连接层本质上都要解决同一组问题。

### 3.1 统一抽象

当前项目在 `backend/internal/bots/types.go` 已经给出了统一接口：

| 接口 | 作用 | 说明 |
| --- | --- | --- |
| `Provider` | 平台接入最小接口 | `Activate / Deactivate / ParseWebhook / SendMessages` |
| `PollingProvider` | 长轮询平台 | 例如 WeChat、Telegram polling |
| `StreamingProvider` | 流式更新回复 | 例如 Telegram 可先发消息再 edit |
| `TypingProvider` | 打字态/处理中提示 | 例如 WeChat typing、未来 Feishu/QQ 的 typing/emoji/reaction |
| `AIBackend` | bot 消息如何进入 AI 执行层 | 当前有 `workspace_thread` 与 `openai_responses` |

这套抽象和 `cc-connect` 的 `Platform` 接口作用相近，只是当前项目把“平台能力”拆得更细，便于主动发送和后台任务复用。

### 3.2 生命周期

一个 bot connection 的完整生命周期通常是：

```text
CreateConnection
  -> Provider.Activate
  -> 持久化 connection/settings/secrets
  -> 启动 webhook 或 polling
  -> 接收入站消息
  -> 解析 conversation
  -> 进入 AIBackend
  -> 发送回复
  -> 更新会话状态 / 连接状态 / delivery 日志
```

当前项目中这一流程集中在 `bots.Service`：

- 创建：`CreateConnection` / `CreateConnectionForBot`
- 更新：`UpdateConnection`
- 暂停：`PauseConnection`
- 恢复：`ResumeConnection`
- Webhook：`HandleWebhook`
- Polling：`syncPollingConnection` 与对应 provider 的 `RunPolling`

### 3.3 三类外部接入模式

| 模式 | 实现原理 | 当前项目状态 | 参考来源 |
| --- | --- | --- | --- |
| Webhook | 平台主动 POST 到服务端 | Telegram、Feishu 已支持；WeChat 未用 | Telegram / Feishu / `cc-connect` Webhook 型平台 |
| Polling | 服务端主动轮询平台拉消息 | Telegram、WeChat 已支持 | 当前项目主流方案 |
| WebSocket 长连接 | 服务端主动连平台 Gateway | Feishu、QQ Bot 已支持；当前仍由各 provider 自行管理连接循环 | `cc-connect` Feishu、QQ Bot |

### 3.4 会话绑定原理

任何 bot 平台都必须先解决“外部消息如何映射到内部上下文”。

当前项目采用两层映射：

```text
外部消息
  -> BotConversation
  -> （可选）BotBinding / ThreadBotBinding / DeliveryTarget
  -> AIBackend 使用的 workspace + thread
```

需要明确区分三件事：

| 概念 | 当前项目承载对象 | 作用 |
| --- | --- | --- |
| 执行上下文 | `BotConversation.ThreadID` / `BotBinding` | 决定消息落到哪个 thread |
| 外发收件人 | `BotConversation` / `BotDeliveryTarget` | 决定消息真正发给谁 |
| 主动触发条件 | `BotTrigger` / `NotificationSubscription` | 决定什么事件会主动发消息 |

这比 `cc-connect` 的单层 `sessionKey` 模型更重，但也更适合主动通知和线程回推。

---

## 4. `cc-connect` 中 Feishu / QQ / QQ Bot 的实现原理

这一节只抽取对当前项目有迁移价值的部分。

### 4.0 `cc-connect` 最值得借鉴的优点

`cc-connect` 最有参考价值的，不是“平台数量多”本身，而是它把多平台接入中最容易失控的部分做成了稳定的通用模型。

| 优点 | 价值 | 对当前项目的借鉴方式 |
| --- | --- | --- |
| 平台抽象边界清晰 | 平台只负责接消息、发消息、维护 reply context，不把平台协议细节扩散到核心调度层 | 当前项目继续坚持 `Provider + AIBackend + Service` 分层，新平台只落在 provider 层 |
| 会话键设计成熟 | 群聊、私聊、thread、共享会话都能稳定映射到统一 key，降低串会话风险 | 后续 Feishu / QQ / QQ Bot 接入时，优先定义稳定的 conversation key 规则 |
| 能力接口拆分合理 | 图片、文件、按钮、typing、message update、card 等能力都按接口拆开，而不是按平台名写分支 | 当前项目适合继续扩展 `StreamingProvider`、`TypingProvider`、媒体发送能力，而不是在 Service 中硬编码平台差异 |
| 长连接恢复机制完整 | token 刷新、heartbeat、resume、reconnect 这类长连接必需能力已经验证过 | Feishu / QQ Bot 接入时应直接把重连与恢复当作基础功能，而不是后补功能 |
| 配置优先于硬编码 | 是否要求 `@`、是否群共享会话、是否按 thread 隔离、是否启用 markdown/card 等都靠配置控制 | 当前项目应把平台差异继续沉到 `BotConnection.Settings`，避免扩平台时改核心逻辑 |
| 富文本与降级策略稳定 | 能力强的平台走 card / markdown，能力弱的平台自动回退纯文本 | 当前项目未来补 Feishu card、QQ markdown 时，可以直接沿用“增强 + fallback”模式 |
| 主动发送与 reply context 经验丰富 | 既能处理即时 reply，也考虑到从 session 信息恢复发送目标 | 当前项目可以继续把即时回复上下文保留在 `BotConversation.ProviderState`，主动目标放在 `BotDeliveryTarget` |
| 文档与测试意识较强 | 接入步骤、限制条件、错误处理、测试覆盖都比较完整 | 当前项目新增平台时，建议同步补平台接入文档与协议级测试，而不是只补 UI 表单 |

其中最值得优先吸收的是以下 5 项：

| 优先级 | 借鉴项 | 原因 | 建议 |
| --- | --- | --- | --- |
| 最高 | 会话键设计 | 多平台 bot 最容易出问题的就是会话串线 | 先定义 conversation key，再写 provider 解析逻辑 |
| 最高 | 长连接恢复机制 | WebSocket 平台断线后如果没有恢复能力，整体不可用 | Feishu / QQ Bot 一开始就补 heartbeat、resume、reconnect |
| 高 | 能力接口拆分 | 平台增多后可以避免核心层充满平台分支 | 把 card、typing、streaming、media 保持为可选能力 |
| 高 | 配置化平台行为 | 平台差异不再需要靠代码分叉维护 | 把 `@提及要求`、群共享、thread 隔离沉到 connection settings |
| 高 | 富文本降级 | 保证同一功能在不同平台上都能工作 | 先实现 text fallback，再逐步补强 richer capability |

### 4.1 Feishu / Lark

`cc-connect` 的 Feishu 平台有几个关键特征：

| 能力 | 实现方式 | 对当前项目的借鉴 |
| --- | --- | --- |
| 连接方式 | SDK WebSocket long connection；Lark 也支持 webhook | 当前项目已实现 `feishu` Provider，并同时支持 `websocket` 与 `webhook` |
| 入站过滤 | 群聊默认要求 `@bot`，可配 `group_reply_all` | 适合变成 Feishu connection setting |
| 会话隔离 | `chatID + userID`，也支持 thread/root 维度 | 可映射为 `ConversationID` 或 `ExternalThreadID` |
| 回复策略 | reply 到原消息，必要时 thread 内回复 | 可对应 `SendMessages` 中的 reply context |
| 富文本能力 | card / markdown / image / file / audio | 当前项目可先保留 text-first，再逐步补 rich media |

可复用的核心思想：

1. **把 Feishu SDK 事件对象尽早转成统一消息结构。**
2. **保留 `chatID`、`messageID`、`thread/root` 信息作为 provider state。**
3. **不要把 Feishu 特有分支写进 AI backend；只写在 provider 层。**

### 4.2 QQ Bot（官方）

`cc-connect` 的 QQ Bot 实现对应腾讯官方机器人平台，关键特征是：

| 能力 | 实现方式 | 对当前项目的借鉴 |
| --- | --- | --- |
| 连接方式 | 先拿 access token，再连 Gateway WebSocket | 可做成 `Activate` 时校验凭据，运行时单独持有 token 与 gateway session |
| 协议流程 | `Hello -> Identify -> READY -> Heartbeat -> Dispatch` | 适合放在独立 `Provider` 的后台 goroutine 中 |
| 入站事件 | `GROUP_AT_MESSAGE_CREATE`、`C2C_MESSAGE_CREATE` | group / c2c 的 conversation key 规则可以直接借鉴 |
| 会话标识 | 群聊可按群共享或按群+用户隔离；私聊单独 openid | 可映射到 `BotConversation.ExternalChatID / ExternalUserID` |
| 回复方式 | REST API 发消息，必要时带 `msg_id` 做被动回复 | 可在 `SendMessages` 中保留 passive reply 能力 |

对当前项目最有价值的是：

1. **Gateway WebSocket 与发送 REST API 分离。**
2. **access token 和 session resume 逻辑都属于 provider 内部状态，不应污染通用 `bots.Service`。**
3. **群聊共享会话与群聊按人隔离，应该是 connection setting，而不是写死。**

### 4.3 QQ（NapCat / OneBot）

`cc-connect` 的 QQ 非官方接入，本质上是：

```text
QQ 客户端 -> NapCat / OneBot v11 -> WebSocket -> 平台适配器
```

对当前项目的借鉴主要不是协议细节，而是这两个架构点：

| 借鉴点 | 说明 |
| --- | --- |
| 外部适配器模型 | 平台可以不是“官方 API”，也可以是一个本地或自建网关 |
| connection setting 与 provider 隔离 | `ws_url`、`token`、`allow_from` 这类配置只属于 provider |

如果未来在当前项目接 QQ OneBot：

- `Provider` 可以直接对接 OneBot forward WebSocket
- `BotConnection.Settings` 存 `ws_url`
- `BotConnection.Secrets` 存 access token
- `ConversationID` 可按 `group:user` 或 `group` 组织

---

## 5. 当前项目的 bot 资源模型

`codex-server` 当前已经不是“只有 connection”的模型，而是一套完整的 bot 资源体系。

### 5.1 资源关系

```text
Bot
  -> BotConnection
      -> BotConversation
  -> BotBinding
  -> BotDeliveryTarget
  -> BotTrigger
Thread
  -> ThreadBotBinding
```

### 5.2 资源说明

| 资源 | 作用 | 是否已落地 |
| --- | --- | --- |
| `Bot` | 逻辑 bot 实体，支持 workspace / global 作用域 | 是 |
| `BotConnection` | 平台端点配置，含 provider、凭据、AI backend | 是 |
| `BotConversation` | 外部会话与内部 thread 的绑定状态 | 是 |
| `BotBinding` | bot 默认绑定或会话级绑定 | 是 |
| `BotDeliveryTarget` | 主动外发目标 | 是 |
| `BotTrigger` | bot 主动触发规则，当前兼容通知中心 | 是 |
| `ThreadBotBinding` | thread -> bot channel 的反向绑定 | 是 |
| `WeChatAccount` / `WeChatLogin` | WeChat 登录与账号复用 | 是 |

### 5.3 与 `cc-connect` 的对应关系

| `cc-connect` 概念 | `codex-server` 对应概念 |
| --- | --- |
| `Platform` | `Provider` |
| `Engine` | `bots.Service + AIBackend` |
| `Message` | `InboundMessage` / `OutboundMessage` |
| `sessionKey` | `BotConversation + ThreadID + ProviderState` |
| 平台回复上下文 | `BotConversation.ProviderState` / `BotDeliveryTarget.ProviderState` |

---

## 6. 当前项目已实现的平台与连接方式

### 6.1 平台现状

| 平台 | Provider 名称 | 接入方式 | 当前状态 |
| --- | --- | --- | --- |
| Telegram | `telegram` | webhook 或 polling | 已实现 |
| WeChat | `wechat` | polling | 已实现 |
| Feishu / Lark | `feishu` | `websocket` 或 `webhook` | 已实现；支持文本 / post 入站、challenge 响应、card 出站与主动发送 |
| QQ Bot（官方） | `qqbot` | Gateway WebSocket + REST | 已实现；支持文本入站、markdown / media 出站与主动发送 |
| QQ（OneBot/NapCat） | — | WebSocket | 未实现，建议参考 `cc-connect` |

### 6.2 AI backend 现状

| AI backend | 说明 | 当前状态 |
| --- | --- | --- |
| `workspace_thread` | 把 bot 消息送到工作区 thread，等待 turn 完成后提取 bot 可见输出 | 已实现，默认 |
| `openai_responses` | 不依赖内部 thread，用外部 response chain 维护上下文 | 已实现 |

### 6.3 Connection / DeliveryTarget capability 现状

当前项目会在 connection 详情与 delivery target 上暴露 capability 标签，供前端和后续调度逻辑复用。

| Provider | Connection capabilities | DeliveryTarget capabilities | 说明 |
| --- | --- | --- | --- |
| `telegram` | `supportsTextOutbound`、`supportsMediaOutbound`、`supportsMediaGroup`、`supportsImageOutbound`、`supportsVideoOutbound`、`supportsVoiceOutbound`、`supportsFileOutbound`、`supportsRemoteMediaURLSource`、`supportsLocalMediaPathSource`、`supportsProactivePush`、`supportsSessionlessPush` | `supportsProactivePush`、`supportsSessionlessPush` | Telegram 同时覆盖文本、媒体组与 sessionless push |
| `wechat` | `supportsTextOutbound`、`supportsMediaOutbound`、`supportsImageOutbound`、`supportsVideoOutbound`、`supportsFileOutbound`、`supportsRemoteMediaURLSource`、`supportsLocalMediaPathSource`、`supportsProactivePush`、`requiresRouteState` | `supportsProactivePush`、`requiresRouteState` | WeChat 主动发送依赖 route state / context token |
| `feishu` | `supportsTextOutbound`、`supportsProactivePush`、`supportsSessionlessPush` | `supportsProactivePush`、`supportsSessionlessPush` | card 是文本出站的 provider 渲染增强，不单独暴露媒体 capability |
| `qqbot` | `supportsTextOutbound`、`supportsMediaOutbound`、`supportsImageOutbound`、`supportsVideoOutbound`、`supportsVoiceOutbound`、`supportsFileOutbound`、`supportsRemoteMediaURLSource`、`supportsLocalMediaPathSource`、`supportsProactivePush`、`supportsSessionlessPush` | `supportsProactivePush`、`supportsSessionlessPush` | QQ Bot 已支持文本、markdown、rich media 外发 |

---

## 7. 当前项目的 connection 配置能力

### 7.1 通用字段

创建和更新 connection 的通用字段来自：

- `backend/internal/bots/types.go`
- `frontend/src/features/bots/api.ts`

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `provider` | 顶层 | 平台类型，例如 `telegram`、`wechat` |
| `name` | 顶层 | connection 展示名 |
| `publicBaseUrl` | 顶层 | webhook 平台用于生成公开回调地址 |
| `aiBackend` | 顶层 | `workspace_thread` 或 `openai_responses` |
| `aiConfig` | 顶层 | 模型、reasoning、权限等 AI backend 配置 |
| `settings` | 顶层 | 平台公开配置与运行参数 |
| `secrets` | 顶层 | 平台密钥、token、API key |

### 7.2 通用运行配置

当前项目已经把一部分“bot 行为控制”抽成通用设置，而不是绑死在某个平台里。

| 设置项 | 取值 | 作用 |
| --- | --- | --- |
| `runtime_mode` | `normal` / `debug` | 是否打开 bot debug 日志 |
| `command_output_mode` | `none` / `single_line` / `brief` / `detailed` / `full` | 线程内 command 输出如何回显给 bot |

### 7.3 Telegram connection 配置

当前 Telegram provider 使用的主要字段：

| 类别 | 字段 | 说明 |
| --- | --- | --- |
| settings | `telegram_delivery_mode` | `webhook` 或 `polling` |
| settings | `telegram_update_offset` | polling 游标 |
| settings | `webhook_url` | 激活 webhook 后写回的回调地址 |
| settings | `bot_id` | `getMe` 后写回 |
| settings | `bot_display_name` | `getMe` 后写回 |
| settings | `bot_username` | `getMe` 后写回 |
| secrets | `bot_token` | Telegram bot token |
| secrets | `webhook_secret` | webhook secret header 校验 |

实现要点：

1. `Activate()` 会先调用 `getMe()` 校验 token。
2. webhook 模式下会自动 `setWebhook()`。
3. polling 模式下会自动 `deleteWebhook()`，避免两种模式互相干扰。

### 7.4 WeChat connection 配置

当前 WeChat provider 使用的主要字段：

| 类别 | 字段 | 说明 |
| --- | --- | --- |
| settings | `wechat_delivery_mode` | 当前只支持 `polling` |
| settings | `wechat_base_url` | WeChat / iLink API base URL |
| settings | `wechat_cdn_base_url` | 媒体 CDN base URL |
| settings | `wechat_route_tag` | 路由标记 |
| settings | `wechat_account_id` | 账号 ID |
| settings | `wechat_owner_user_id` | 所属用户 ID |
| settings | `wechat_sync_buf` | polling 游标 |
| settings | `wechat_login_session_id` | 创建时可作为过渡字段 |
| settings | `wechat_saved_account_id` | 创建时可复用已保存账号 |
| settings | `wechat_channel_timing` | 是否附加链路耗时 |
| secrets | `bot_token` | WeChat bot token |

实现要点：

1. `Activate()` 会校验 `bot_token / base_url / account_id / owner_user_id`。
2. WeChat 不走 webhook，`ParseWebhook()` 直接忽略。
3. 真实入站流量来自 `RunPolling()`。
4. 回复依赖 `wechat_context_token`，没有上下文时不能直接回原会话。

### 7.5 Feishu connection 配置

当前 Feishu provider 使用的主要字段：

| 类别 | 字段 | 说明 |
| --- | --- | --- |
| settings | `feishu_app_id` | Feishu / Lark App ID |
| secrets | `feishu_app_secret` | App Secret |
| settings | `feishu_domain` | 平台域名，默认 `https://open.feishu.cn` |
| settings | `feishu_delivery_mode` | `websocket` 或 `webhook` |
| settings | `feishu_group_reply_all` | 群聊是否无需 `@bot` 即响应 |
| settings | `feishu_thread_isolation` | 是否按 root / thread 隔离会话 |
| settings | `feishu_share_session_in_channel` | 群聊是否共享会话 |
| settings | `feishu_enable_cards` | 是否把文本出站包装成 interactive card |
| settings | `webhook_url` | webhook 模式激活后写回的公开回调地址 |
| settings | `bot_open_id` | 激活后写回的 bot open id |
| settings | `bot_display_name` | 激活后写回的 bot 展示名 |

实现要点：

1. `Activate()` 会校验 `feishu_app_id / feishu_app_secret`，并拉取 bot 信息标准化 settings。
2. `feishu_delivery_mode=webhook` 时，激活依赖 `publicBaseUrl`，并写回 `webhook_url`。
3. `websocket` 模式通过 `RunPolling()` 维护 Feishu WebSocket 长连接；`webhook` 模式通过通用 `/hooks/bots/{connectionId}` 入口接收事件。
4. webhook 模式对 `url_verification` 返回自定义 challenge echo，正常消息与 WebSocket 共用同一套事件解析逻辑。
5. `feishu_enable_cards=true` 时，provider 仍走文本语义，但会把出站内容包装成带 markdown element 的 interactive card。

### 7.6 QQ Bot connection 配置

当前 QQ Bot provider 使用的主要字段：

| 类别 | 字段 | 说明 |
| --- | --- | --- |
| settings | `qqbot_app_id` | QQ Bot App ID |
| secrets | `qqbot_app_secret` | QQ Bot App Secret |
| settings | `qqbot_sandbox` | 是否使用沙箱地址 |
| settings | `qqbot_share_session_in_channel` | 群聊是否共享会话 |
| settings | `qqbot_markdown_support` | 是否启用 markdown 文本发送 |
| settings | `qqbot_intents` | Gateway intents；未填时使用默认值 |
| settings | `qqbot_gateway_session_id` | 运行时写回的 Gateway session id |
| settings | `qqbot_gateway_seq` | 运行时写回的最近 Gateway seq |

实现要点：

1. `Activate()` 会校验 `qqbot_app_id / qqbot_app_secret`，同时验证 access token 与 gateway 地址。
2. `RunPolling()` 负责 `Hello / Identify / READY / Heartbeat / Resume / Reconnect` 全链路，并持续写回 `session_id / seq`。
3. `qqbot_markdown_support=true` 时，文本出站会切到 `msg_type=2` 的 markdown 发送分支；未开启时走普通文本。
4. rich media 出站会先上传文件拿 `file_info`，再发送 `msg_type=7` 消息；媒体来源支持远程 URL 与绝对本地路径。
5. 群聊有最近 `event_msg_id` 时优先走 passive reply；失败后退化为 proactive send。

### 7.7 AI backend 配置

`workspace_thread` 连接最常用的 `aiConfig`：

| 字段 | 作用 |
| --- | --- |
| `model` | 线程执行模型 |
| `reasoning_effort` | reasoning 强度 |
| `permission_preset` | 权限预设 |
| `collaboration_mode` | 协作模式 |

这些配置会在 `workspace_thread_backend.go` 中透传给 `turns.Start(...)`。

---

## 8. 当前项目的入站、会话、回复主链路

### 8.1 入站链路

当前项目的标准入站链路如下：

```text
Webhook / Polling
  -> Provider 解析为 InboundMessage
  -> acceptOrBufferInboundMessage
  -> BotInboundDelivery 持久化
  -> worker 异步处理
  -> 解析控制命令 / 确认 conversation
  -> AIBackend
  -> Provider.SendMessages
  -> 更新 conversation / delivery 状态
```

### 8.2 conversation 解析原则

不同平台需要把平台特有的会话标识，映射为稳定的 `BotConversation` 主键来源。

当前项目已验证的四种做法：

| 平台 | `ConversationID` 策略 | 说明 |
| --- | --- | --- |
| Telegram | 由 chat / thread / user 组合而来 | 支持群聊、topic、媒体 group 等场景 |
| WeChat | 当前按用户维度绑定，`ConversationID = from_user_id` | 回复强依赖 `context_token` |
| Feishu | `chat:{chatID}:user:{userID}`；thread 隔离时改为 `chat:{chatID}:root:{rootOrThreadID}` | 已覆盖私聊、群聊、root/thread 场景 |
| QQ Bot（官方） | 群聊 `group:{group_openid}:user:{member_openid}` 或 `group:{group_openid}`；私聊 `user:{user_openid}` | 已覆盖群共享、群按人隔离、c2c |

如果后续接 QQ（OneBot），建议保持同一原则：

| 平台 | 建议 conversation key |
| --- | --- |
| QQ（OneBot） | 群聊 `group_id:user_id` 或 `group_id`；私聊 `user_id` |

### 8.3 回复链路

当前项目的回复链路不是“只回当前 conversation”这一种模式，而是分成三类：

| 模式 | 入口 | 用途 |
| --- | --- | --- |
| 会话内回复 | `BotConversation` | 用户给 bot 发消息后的正常回复 |
| 主动外发 | `BotDeliveryTarget` | 管理面手工发送、通知分发 |
| 线程回推 | `ThreadBotBinding` | 指定 thread 的 turn 完成后主动推送给某个 bot target |

这正是当前项目比 `cc-connect` 更适合作为“bot 管理中枢”的原因。

---

## 9. 当前项目的主动发送能力

### 9.1 DeliveryTarget

`BotDeliveryTarget` 是当前项目主动发送的核心抽象。

它回答的是：

> 如果系统想主动发消息，应该发给哪个 bot 渠道目标？

关键字段包括：

| 字段 | 说明 |
| --- | --- |
| `ConnectionID` | 使用哪个平台端点发送 |
| `ConversationID` | 是否绑定某个已有会话 |
| `TargetType` | 目标类型 |
| `RouteType` / `RouteKey` | 外发路由键 |
| `ProviderState` | 平台特有上下文 |
| `Capabilities` | 支持的外发能力 |

### 9.2 Trigger

`BotTrigger` 当前主要承担通知触发兼容层：

- 逻辑上已与通知中心衔接
- 默认类型是 `notification`
- 真正的数据源已经开始迁到 `NotificationSubscription`

因此当前建议理解为：

| 概念 | 当前定位 |
| --- | --- |
| `BotTrigger` | 兼容层与 UI 入口 |
| `NotificationSubscription(channel=bot)` | 长期演进方向 |

### 9.3 ThreadBotBinding

`ThreadBotBinding` 解决的是反向链路：

```text
thread turn 完成
  -> 提取 bot-visible messages
  -> 投递到某个 bot delivery target
```

这条能力在 `cc-connect` 中并不存在，是当前项目的重要差异能力。

适用场景：

- 指定某个 thread 的完成结果自动发到 Telegram / WeChat
- 把某个工作区线程当成“推送通道”
- 构建“线程运行结果 -> 外部 bot 通知”的自动桥接

---

## 10. API 与前端能力总览

### 10.1 Connection 管理接口

| 接口 | 作用 |
| --- | --- |
| `GET /api/workspaces/{workspaceId}/bot-connections` | 列表 |
| `POST /api/workspaces/{workspaceId}/bot-connections` | 创建 |
| `GET /api/workspaces/{workspaceId}/bot-connections/{connectionId}` | 详情 |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}` | 更新 |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/pause` | 暂停 |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/resume` | 恢复 |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/runtime-mode` | 运行模式 |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/command-output-mode` | 输出模式 |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/wechat-channel-timing` | WeChat 链路耗时开关 |
| `DELETE /api/workspaces/{workspaceId}/bot-connections/{connectionId}` | 删除 |

### 10.2 Conversation 管理接口

| 接口 | 作用 |
| --- | --- |
| `GET /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations` | 列出会话 |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations/{conversationId}/binding` | 改绑 thread |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations/{conversationId}/binding/clear` | 清空绑定 |
| `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations/{conversationId}/replay-failed-reply` | 重放失败回复 |

### 10.3 Provider 专用接口

| 接口 | 作用 |
| --- | --- |
| `POST /hooks/bots/{connectionId}` | 通用 webhook 入口；当前供 Telegram 与 Feishu webhook / challenge 响应共用 |
| `POST /api/workspaces/{workspaceId}/bot-providers/wechat/login/start` | 启动 WeChat 扫码登录 |
| `GET /api/workspaces/{workspaceId}/bot-providers/wechat/login/{loginId}` | 查询扫码状态 |
| `DELETE /api/workspaces/{workspaceId}/bot-providers/wechat/login/{loginId}` | 取消登录 |
| `GET /api/workspaces/{workspaceId}/bot-providers/wechat/accounts` | 列出 WeChat 账号 |
| `PATCH /api/workspaces/{workspaceId}/bot-providers/wechat/accounts/{accountId}` | 更新账号备注 |
| `DELETE /api/workspaces/{workspaceId}/bot-providers/wechat/accounts/{accountId}` | 删除账号 |

### 10.4 Bot / target / trigger / thread binding 接口

| 接口 | 作用 |
| --- | --- |
| `GET /api/workspaces/{workspaceId}/bots` | bot 列表 |
| `POST /api/workspaces/{workspaceId}/bots` | 创建 bot |
| `POST /api/workspaces/{workspaceId}/bots/{botId}/default-binding` | 更新默认 binding |
| `GET /api/workspaces/{workspaceId}/bots/{botId}/delivery-targets` | target 列表 |
| `POST /api/workspaces/{workspaceId}/bots/{botId}/delivery-targets` | 新增 target |
| `GET /api/workspaces/{workspaceId}/bots/{botId}/triggers` | trigger 列表 |
| `POST /api/workspaces/{workspaceId}/bots/{botId}/triggers` | 新增 trigger |
| `POST /api/workspaces/{workspaceId}/threads/{threadId}/bot-channel-binding` | 配置 thread 绑定 |

### 10.5 前端页面能力

`frontend/src/pages/BotsPage.tsx` 当前已经覆盖：

| 能力 | 当前状态 |
| --- | --- |
| 创建 / 编辑 bot connection | 已支持 |
| Telegram / WeChat / Feishu / QQ Bot 参数录入 | 已支持 |
| WeChat 扫码登录与账号复用 | 已支持 |
| 会话列表与 thread 打开 | 已支持 |
| conversation 改绑 / 清空绑定 | 已支持 |
| runtime mode / command output mode 调整 | 已支持 |
| 主动外发 target 管理 | 已支持 |
| trigger 管理 | 已支持 |
| outbound delivery 浏览 | 已支持 |
| thread bot binding 配置 | 已支持 |

---

## 11. Feishu / QQ Bot 当前落地方式与补充方向

### 11.1 统一接入原则

当前已落地的平台仍遵循同一套分层：

| 层 | 应做什么 | 不应做什么 |
| --- | --- | --- |
| `Provider` | 连接平台、解析消息、发送回复、维护 provider state | 不直接操作 thread 执行逻辑 |
| `bots.Service` | 会话、delivery、重试、日志、状态流转 | 不写平台专用协议 |
| `AIBackend` | 把 bot 消息送进 thread / Responses API | 不关心平台字段 |

### 11.2 Feishu 当前实现

| 项目 | 当前状态 |
| --- | --- |
| provider 名称 | `feishu` |
| 接入模式 | `websocket` 与 `webhook` 都已实现 |
| 入站事件 | `im.message.receive_v1`；支持 `text` 与 `post` 归一为文本 |
| webhook 行为 | `url_verification` 返回 challenge echo；普通消息与 WebSocket 共用解析链路 |
| 会话键 | `chat:{chatID}:user:{userID}`；启用 thread 隔离时为 `chat:{chatID}:root:{rootOrThreadID}` |
| provider state | `message_id`、`chat_id`、`thread_id`、`root_id`、`parent_id`、`chat_type`、`user_open_id` |
| 回复策略 | 优先 reply 原消息；thread 模式下带 `reply_in_thread`；失败后退化为 chat send |
| card 能力 | `feishu_enable_cards=true` 时输出 interactive card，card body 使用 markdown element |
| 主动发送 | 已支持 `feishu_chat`、`feishu_thread` route-backed target 与 sessionless push |
| capability | connection: `supportsTextOutbound`、`supportsProactivePush`、`supportsSessionlessPush` |

### 11.3 QQ Bot 当前实现

| 项目 | 当前状态 |
| --- | --- |
| provider 名称 | `qqbot` |
| 接入模式 | Gateway WebSocket 收消息，REST API 发消息 |
| 入站事件 | `GROUP_AT_MESSAGE_CREATE`、`C2C_MESSAGE_CREATE` |
| 会话键 | 群聊 `group:{group_openid}:user:{member_openid}` 或 `group:{group_openid}`；私聊 `user:{user_openid}` |
| provider state | `message_type`、`group_openid`、`user_openid`、`event_msg_id`、`markdown_support` |
| 回复策略 | 群聊优先 passive reply，失败后退化为 proactive send；私聊直接 c2c REST 发送 |
| markdown 能力 | `qqbot_markdown_support=true` 时文本出站改用 markdown payload |
| media 能力 | 已支持图片、视频、语音、文件；先上传 `file_info`，再发送 rich media 消息 |
| 主动发送 | 已支持 `qqbot_group`、`qqbot_c2c` route-backed target 与 sessionless push |
| capability | connection: `supportsTextOutbound`、`supportsMediaOutbound`、`supportsImageOutbound`、`supportsVideoOutbound`、`supportsVoiceOutbound`、`supportsFileOutbound`、`supportsRemoteMediaURLSource`、`supportsLocalMediaPathSource`、`supportsProactivePush`、`supportsSessionlessPush` |

### 11.4 QQ OneBot Provider 建议

建议接法：

| 项目 | 建议 |
| --- | --- |
| provider 名称 | `qq` 或 `onebot_qq` |
| 接入模式 | OneBot v11 forward WebSocket |
| settings | `ws_url`、`share_session_in_channel` |
| secrets | `token` |
| 会话键 | 群聊 `group_id:user_id` 或 `group_id`；私聊 `user_id` |
| provider state | `message_id`、`group_id`、`user_id` |
| 回复策略 | 通过 OneBot send APIs / action frames |

实现参考：

- `cc-connect/platform/qq/qq.go`
- `cc-connect/docs/qq.md`

---

## 12. 平台迁移时最需要保留的设计约束

### 12.1 把“连接状态”和“会话状态”分开

| 层级 | 应保存的状态 |
| --- | --- |
| `BotConnection` | 平台凭据、轮询游标、平台级健康状态 |
| `BotConversation` | 外部会话路由、内部 thread 绑定、provider session state |
| `BotDeliveryTarget` | 主动发送收件目标、可复用路由 |

不要把全部状态都压进 `connection.Settings`。

### 12.2 把“回复上下文”和“主动发送目标”分开

`cc-connect` 的 reply context 足够处理即时回复，但当前项目还要支持主动推送，因此必须区分：

| 概念 | 当前项目承载 |
| --- | --- |
| 即时 reply context | `BotConversation.ProviderState` |
| 主动发送 target | `BotDeliveryTarget` |

### 12.3 不要把平台分支写进 AI backend

`workspace_thread_backend` 不应该知道 Telegram、WeChat、Feishu、QQ 的任何协议细节。

平台差异应停留在：

- `Provider.ParseWebhook`
- `Provider.RunPolling`
- `Provider.SendMessages`
- `StreamingProvider`
- `TypingProvider`

### 12.4 平台接入优先支持最小闭环

新增平台建议按以下顺序交付：

| 阶段 | 内容 |
| --- | --- |
| 第一阶段 | 文本入站 + 文本回复 + conversation 持久化 |
| 第二阶段 | polling / webhook / websocket 稳定化、重试、日志 |
| 第三阶段 | 媒体入站与媒体外发 |
| 第四阶段 | streaming reply、typing、主动 delivery target |
| 第五阶段 | thread binding、通知触发 |

不要一开始同时做全量富媒体、流式、主动发送和通知。

---

## 13. 推荐实施顺序

基于当前实现状态，后续补强建议顺序如下：

| 顺序 | 平台 / 能力 | 原因 |
| --- | --- | --- |
| 第一步 | Feishu media / typing / richer mention 处理 | 当前 webhook、challenge、card 已完成，下一步补富媒体与交互反馈 |
| 第二步 | QQ Bot inbound rich media / richer markdown 模板 | 当前 outbound markdown / media 已完成，下一步补入站与更强展示模板 |
| 第三步 | QQ OneBot | 外部依赖更多，适合放在官方能力之后 |
| 第四步 | 通用 ConnectionLoop / streaming / typing 对齐 | 在多平台基础稳定后再抽公共能力 |

---

## 14. 最终建议

### 14.1 架构建议

| 建议 | 原因 |
| --- | --- |
| 平台接入参考 `cc-connect` 的 `Platform` 思路 | 它在“如何把外部协议压成统一消息接口”上已经验证过 |
| 资源编排保留当前项目的 `Bot / Connection / Conversation / DeliveryTarget / Trigger` 体系 | 当前项目已经不仅是聊天接入，而是 bot 管理中枢 |
| Feishu、QQ Bot 继续保持 `Provider` 实现方式；QQ OneBot 也按同一路径扩展 | 与现有 `bots.Service` 最契合 |
| webhook / polling / websocket 三种模式都由 provider 自己收口 | 这样 `bots.Service` 不需要知道平台传输层差异 |

### 14.2 实施建议

| 建议 | 原因 |
| --- | --- |
| 继续以 `feishu` 与 `qqbot` 作为长连接 / webhook / rich message 的主验证平台 | 两者已覆盖当前最主要的平台差异 |
| QQ OneBot 作为可选接入 | 适合自建环境，但不应影响官方平台能力推进 |
| 新平台优先打通文本闭环，再补富媒体和主动通道 | 现有 Feishu / QQ Bot 也遵循了这一顺序，扩平台时可直接复用 |

---

## 15. 参考清单

### 当前项目

- `docs/bot-integration-design.md`
- `docs/bots/telegram/telegram-bot-inbound-media-implementation.md`
- `docs/bots/wechat/wechat-bot-functional-overview.md`
- `docs/development/notification-center-hook-bot-architecture-2026-04-16.md`

### `cc-connect`

- `E:\projects\ai\cc-connect\AGENTS.md`
- `E:\projects\ai\cc-connect\core\interfaces.go`
- `E:\projects\ai\cc-connect\core\engine.go`
- `E:\projects\ai\cc-connect\platform\feishu\feishu.go`
- `E:\projects\ai\cc-connect\platform\qqbot\qqbot.go`
- `E:\projects\ai\cc-connect\platform\qq\qq.go`
- `E:\projects\ai\cc-connect\docs\qq.md`
