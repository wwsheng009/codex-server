# Feishu Bot Provider 实施文档

更新时间：2026-04-17

适用项目：

- `E:\projects\ai\codex-server`

参考实现：

- `E:\projects\ai\cc-connect\platform\feishu\feishu.go`
- `backend/internal/bots/feishu.go`
- `backend/internal/bots/service.go`
- `backend/internal/bots/feishu_test.go`
- `backend/internal/bots/routing_providers_test.go`
- `frontend/src/pages/BotsPage.tsx`
- `frontend/src/pages/botsPageUtils.ts`

---

## 1. 结论

Feishu 已完成当前阶段接入，现状不是“只有 WebSocket 文本闭环”，而是已经进入可用的双通道实现：

- `websocket` 长连接入站已完成
- `webhook` 模式已完成
- `url_verification` challenge 自定义响应已完成
- 私聊 / 群聊 `text` 与 `post` 入站归一化已完成
- `@bot` 过滤、群共享会话、thread 隔离已完成
- reply 优先、chat send fallback 的文本出站已完成
- `feishu_enable_cards` 控制的 interactive card 出站已完成
- `feishu_chat` / `feishu_thread` route-backed 主动发送已完成
- connection / delivery target capability 标签已接入

当前版本仍以文本语义为主：card 是文本的渲染增强，独立 media / typing 仍未补齐。

---

## 2. 实施状态

| 模块 | 当前状态 | 说明 | 备注 |
| --- | --- | --- | --- |
| Provider 注册 | 已完成 | `feishu` 已注册为内置 provider | `service.go` |
| 连接激活 | 已完成 | 校验 `app_id / app_secret`，拉取 bot 信息并写回 settings | 保存 `bot_open_id / bot_display_name` |
| 传输模式 | 已完成 | `websocket` 与 `webhook` 都可用 | `feishu_delivery_mode` 控制 |
| webhook challenge | 已完成 | 识别 `url_verification` 并直接返回 challenge echo | 不产生入站消息 |
| 入站解析 | 已完成 | 支持 `im.message.receive_v1` 的 `text` / `post` | 统一为文本消息 |
| 群聊过滤 | 已完成 | 默认要求 `@bot`，可用 `feishu_group_reply_all` 放开 | 私聊默认接收 |
| 会话隔离 | 已完成 | 支持 thread/root 隔离、群共享、按人隔离 | conversation key 已稳定 |
| 出站发送 | 已完成 | reply 原消息优先，失败时退化为 chat send | 支持主动发送 |
| card 渲染 | 已完成 | `feishu_enable_cards=true` 时输出 interactive card | card body 使用 markdown element |
| route-backed 目标 | 已完成 | `feishu_chat`、`feishu_thread` 已接入 | 支持 sessionless push |
| 最新上下文复用 | 已完成 | route-backed 发送会优先复用最近匹配 conversation | 便于带上最近 reply context |
| capability 标签 | 已完成 | connection 与 delivery target 均会暴露 capability | 供前端与调度复用 |
| 前端表单 | 已完成 | Bots 页面可创建、编辑、查看 Feishu 连接 | i18n 已接入 |
| media / typing | 未完成 | 当前仍以文本闭环为主 | 属于下一阶段增强 |

---

## 3. 配置字段

| 类别 | 字段 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| settings | `feishu_app_id` | 是 | App ID |
| secrets | `feishu_app_secret` | 是 | App Secret |
| settings | `feishu_domain` | 否 | 默认 `https://open.feishu.cn` |
| settings | `feishu_delivery_mode` | 否 | `websocket` 或 `webhook`，默认 `websocket` |
| settings | `feishu_group_reply_all` | 否 | 群聊是否无需 `@bot` 即响应 |
| settings | `feishu_thread_isolation` | 否 | 是否按 thread/root 隔离会话 |
| settings | `feishu_share_session_in_channel` | 否 | 群聊是否共享会话 |
| settings | `feishu_enable_cards` | 否 | 是否把文本出站包装成 interactive card |
| settings | `webhook_url` | webhook 激活后写回 | 公开回调地址 |
| settings | `bot_open_id` | 激活后写回 | Feishu bot open id |
| settings | `bot_display_name` | 激活后写回 | Feishu bot 展示名 |

补充说明：

| 项目 | 说明 |
| --- | --- |
| `publicBaseUrl` | 仅在 `feishu_delivery_mode=webhook` 时必需，用于生成 `webhook_url` |
| 出站语义 | card 开关不改变内部 `OutboundMessage` 结构，只改变 provider 最终发送形态 |

---

## 4. 传输、会话与 capability

### 4.1 传输模式

| 模式 | 当前规则 | 说明 |
| --- | --- | --- |
| `websocket` | 通过 `RunPolling()` 获取 endpoint 并建立长连接 | 入站主链路，支持自动重连 |
| `webhook` | 通过 `POST /hooks/bots/{connectionId}` 接收事件 | 与 WebSocket 共用事件解析逻辑 |
| `url_verification` | 直接返回 `{"challenge":"..."}` | 作为自定义 challenge 响应，不进入 AI 链路 |

### 4.2 Conversation key

| 场景 | 当前规则 | 说明 |
| --- | --- | --- |
| 私聊 | `chat:{chatID}:user:{userID}` | 私聊按用户隔离 |
| 群聊按人隔离 | `chat:{chatID}:user:{userID}` | 默认群聊行为 |
| 群聊共享会话 | `chat:{chatID}` | `feishu_share_session_in_channel=true` |
| 群聊 thread/root 隔离 | `chat:{chatID}:root:{rootOrThreadID}` | `feishu_thread_isolation=true` |

### 4.3 route-backed target

| RouteType | RouteKey 规则 | 用途 |
| --- | --- | --- |
| `feishu_chat` | `chat:{chatID}` | 主动向 chat 发送 |
| `feishu_thread` | `chat:{chatID}:thread:{threadID}` | 主动向 thread 发送 |

### 4.4 ProviderState

| 字段 | 说明 |
| --- | --- |
| `feishu_chat_id` | chat id |
| `feishu_message_id` | 最近可 reply 的 message id |
| `feishu_thread_id` | thread id |
| `feishu_root_id` | root id |
| `feishu_parent_id` | parent id |
| `feishu_chat_type` | `p2p / group` |
| `feishu_user_open_id` | 发送人 open id |
| `feishu_conversation_id` | 当前 conversation key |
| `feishu_chat_name` | chat 标题 |

### 4.5 capability

| 作用域 | 当前标签 | 说明 |
| --- | --- | --- |
| Connection | `supportsTextOutbound`、`supportsProactivePush`、`supportsSessionlessPush` | 当前只声明文本能力；card 属于文本渲染增强 |
| DeliveryTarget | `supportsProactivePush`、`supportsSessionlessPush` | 支持 route-backed 主动发送与 sessionless push |

---

## 5. 当前实现原理

### 5.1 激活

| 步骤 | 当前实现 | 结果 |
| --- | --- | --- |
| 校验凭据 | 校验 `feishu_app_id / feishu_app_secret` | 缺失时拒绝激活 |
| 获取 token | 调用 Feishu token 接口 | 验证凭据有效 |
| 获取 bot 信息 | 调用 bot info 接口 | 写回 bot 身份信息 |
| 标准化设置 | 写回 `domain / delivery_mode / bot_open_id / bot_display_name / feishu_enable_cards` | 统一后续运行配置 |
| webhook 地址生成 | `webhook` 模式下生成 `webhook_url` | 供平台侧配置回调 |

### 5.2 入站

| 场景 | 当前实现 | 结果 |
| --- | --- | --- |
| WebSocket 入站 | 获取 endpoint 后建立长连接，消费 Feishu frame 与 event payload | 进入统一 `InboundMessage` |
| webhook 普通事件 | 读取 HTTP body 后复用事件解析逻辑 | 与 WebSocket 保持一致 |
| webhook challenge | 识别 `url_verification` 后直接回写 challenge | 不创建 conversation |
| 群聊过滤 | 未 `@bot` 时忽略，或按 `group_reply_all` 放开 | 避免误触发 |
| 文本归一 | `text` / `post` 统一抽取文本，剥离 bot mention | 提高 AI 输入一致性 |
| 会话建模 | 生成 conversation key 与 provider state | 进入 `BotConversation` |

### 5.3 出站

| 场景 | 当前实现 | 结果 |
| --- | --- | --- |
| 会话内回复 | 优先 reply 原消息 | 最大化保留上下文 |
| thread 回复 | thread 隔离场景下附带 `reply_in_thread` | 保持 thread 语义 |
| reply 失败 | 自动退化为向 chat 发新消息 | 保证消息可达 |
| 普通文本 | 默认发送 `msg_type=text` | 文本闭环稳定 |
| card 文本 | `feishu_enable_cards=true` 时发送 `msg_type=interactive` | 以 markdown element 展示文本 |
| route-backed 主动发送 | 支持 `feishu_chat / feishu_thread` | 可直接用于 DeliveryTarget |
| 最新上下文复用 | 优先匹配最近 conversation | 可带最近 `message_id` |

---

## 6. 与 `cc-connect` 的对应关系

| 能力 | `cc-connect` 思路 | 当前项目实现 |
| --- | --- | --- |
| 长连接接入 | Feishu SDK / WebSocket | `feishu` Provider 负责连接循环 |
| webhook 兼容 | 可作为长连接之外的备用模式 | 当前项目同时支持 `websocket` 与 `webhook` |
| challenge 响应 | 平台校验需要原样回写 challenge | `ParseWebhookResult()` 直接返回 challenge body |
| 会话键设计 | `chat + user` 或 `chat + root` | 写入 `BotConversation.ExternalConversationID` |
| reply context | 依赖最近 message / thread 信息 | 保存到 `ProviderState` |
| card 能力 | 富文本平台可走 card / markdown | 当前项目通过 `feishu_enable_cards` 先补文本 card |
| 主动发送 | 从 session 信息恢复发送目标 | 复用 `BotDeliveryTarget` |

---

## 7. 后续待补项

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 暂无独立 media 出站 | 消息形态 | 中 | 当前仅声明文本 outbound capability |
| 暂无 typing 能力 | 交互反馈 | 中 | 尚未实现 `TypingProvider` |
| mention 解析仍以 bot mention 清洗为主 | 富文本输入 | 低 | 未补更多 mention 展开策略 |
| 长连接生命周期仍按 provider 各自管理 | 架构一致性 | 中 | 可后续抽出通用 ConnectionLoop |

---

## 8. 验证结果

| 验证项 | 结果 | 备注 |
| --- | --- | --- |
| webhook 激活写回 `webhook_url` | 通过 | 已覆盖 `publicBaseUrl` 生成回调地址 |
| webhook challenge 响应 | 通过 | 已覆盖 `url_verification` challenge echo |
| WebSocket 入站解析 | 通过 | 已覆盖文本消息与 conversation key |
| `post` / `text` 文本归一 | 通过 | 代码对照已确认两类文本入口 |
| reply fallback | 通过 | reply 失败会退化为 chat send |
| interactive card 出站 | 通过 | 已覆盖 `feishu_enable_cards=true` 的发送分支 |
| route-backed 主动发送 | 通过 | 已覆盖 `feishu_chat / feishu_thread` |
| 最新上下文复用 | 通过 | 已覆盖 route-backed 发送复用最近 conversation |
| 前端 i18n | 已接入 | 本轮未新增前端改动 |