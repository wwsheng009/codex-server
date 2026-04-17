# QQ Bot Provider 实施文档

更新时间：2026-04-17

适用项目：

- `E:\projects\ai\codex-server`

参考实现：

- `E:\projects\ai\cc-connect\platform\qqbot\qqbot.go`
- `backend/internal/bots/qqbot.go`
- `backend/internal/bots/service.go`
- `backend/internal/bots/qqbot_test.go`
- `backend/internal/bots/routing_providers_test.go`
- `frontend/src/pages/BotsPage.tsx`
- `frontend/src/pages/botsPageUtils.ts`

---

## 1. 结论

QQ Bot 已完成当前阶段接入，现状不是“只有 Gateway 文本闭环”，而是已经覆盖文本、markdown、rich media 与主动发送：

- access token 获取、缓存与刷新已完成
- Gateway `Hello / Identify / READY / Heartbeat / Resume / Reconnect` 已完成
- 群聊与私聊文本入站已完成
- 群聊 `@bot` 前缀清洗与引用摘要拼接已完成
- passive reply 优先、proactive fallback 的出站策略已完成
- `qqbot_markdown_support` 控制的 markdown 文本出站已完成
- 图片 / 视频 / 语音 / 文件 rich media 出站已完成
- 远程 URL 与绝对本地路径两类媒体来源已完成
- `qqbot_group` / `qqbot_c2c` route-backed 主动发送已完成
- connection / delivery target capability 标签已接入

当前版本的短板不在 outbound，而在 inbound rich media 与更强的 markdown 模板能力。

---

## 2. 实施状态

| 模块 | 当前状态 | 说明 | 备注 |
| --- | --- | --- | --- |
| Provider 注册 | 已完成 | `qqbot` 已注册为内置 provider | `service.go` |
| 激活校验 | 已完成 | 校验 `app_id / app_secret`，验证 token 与 gateway 地址 | 激活时标准化 settings |
| Gateway 连接 | 已完成 | 使用官方 Gateway WebSocket | 支持 reconnect / resume |
| Token 缓存 | 已完成 | access token 按过期时间缓存与刷新 | 降低重复请求 |
| 协议握手 | 已完成 | `Hello / Identify / READY / Heartbeat / ACK` | 保持会话活性 |
| Session 持久化 | 已完成 | 运行中写回 `qqbot_gateway_session_id / qqbot_gateway_seq` | 用于恢复会话 |
| 入站解析 | 已完成 | 支持 `GROUP_AT_MESSAGE_CREATE`、`C2C_MESSAGE_CREATE` | 归一为文本消息 |
| 会话隔离 | 已完成 | 支持群共享、群按人隔离、私聊 | conversation key 已稳定 |
| 文本出站 | 已完成 | group / c2c 双路径；被动回复失败时主动发送 | 文本优先 |
| markdown 出站 | 已完成 | `qqbot_markdown_support=true` 时切换 markdown payload | 文本语义不变 |
| media 出站 | 已完成 | 图片、视频、语音、文件均先上传再发送 rich media | 支持被动 / 主动发送 |
| route-backed 目标 | 已完成 | `qqbot_group`、`qqbot_c2c` 已接入 | 支持 sessionless push |
| 最新上下文复用 | 已完成 | route-backed 发送会优先复用最近匹配 conversation | 可带最近 `msg_id` |
| capability 标签 | 已完成 | connection 与 delivery target 均会暴露 capability | 供前端与调度复用 |
| 前端表单 | 已完成 | Bots 页面可创建、编辑、查看 QQ Bot 连接 | i18n 已接入 |
| inbound rich media | 未完成 | 当前入站仍以文本事件为主 | 属于下一阶段增强 |

---

## 3. 配置字段

| 类别 | 字段 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| settings | `qqbot_app_id` | 是 | Bot AppID |
| secrets | `qqbot_app_secret` | 是 | Bot AppSecret |
| settings | `qqbot_sandbox` | 否 | 是否使用沙箱环境 |
| settings | `qqbot_share_session_in_channel` | 否 | 群聊是否共享会话 |
| settings | `qqbot_markdown_support` | 否 | 是否启用 markdown 文本发送 |
| settings | `qqbot_intents` | 否 | Gateway intents；未填时使用默认值 |
| settings | `qqbot_gateway_session_id` | 运行中更新 | Gateway session id |
| settings | `qqbot_gateway_seq` | 运行中更新 | 最近 Gateway seq |

补充说明：

| 项目 | 说明 |
| --- | --- |
| token 缓存键 | 以 `app_id + app_secret` 作为缓存维度 |
| media 本地路径 | 必须是绝对路径；`file://` 会先解析为本地路径 |
| media URL | 会先下载，再按内容类型推导 `file_type` |

---

## 4. 传输、会话与 capability

### 4.1 传输模式

| 模式 | 当前规则 | 说明 |
| --- | --- | --- |
| Gateway 入站 | WebSocket 连接官方 `/gateway/bot` | 消费 `Dispatch` 事件 |
| REST 出站 | 按 group / c2c 调用消息接口 | 文本、markdown、media 共用此路径 |
| 文件上传 | rich media 先调用 `/files` 上传 | 返回 `file_info` 后再发消息 |

### 4.2 Conversation key

| 场景 | 当前规则 | 说明 |
| --- | --- | --- |
| 群聊按人隔离 | `group:{group_openid}:user:{member_openid}` | 默认群聊行为 |
| 群聊共享会话 | `group:{group_openid}` | `qqbot_share_session_in_channel=true` |
| 私聊 | `user:{user_openid}` | c2c 独立会话 |

### 4.3 route-backed target

| RouteType | RouteKey 规则 | 用途 |
| --- | --- | --- |
| `qqbot_group` | `group:{group_openid}` | 主动向群发送 |
| `qqbot_c2c` | `user:{user_openid}` | 主动向私聊发送 |

### 4.4 ProviderState

| 字段 | 说明 |
| --- | --- |
| `qqbot_message_type` | `group / c2c` |
| `qqbot_group_openid` | group openid |
| `qqbot_user_openid` | user openid |
| `qqbot_event_msg_id` | 最近可用于被动回复的 msg id |
| `qqbot_markdown_support` | 当前会话是否允许 markdown |

### 4.5 capability

| 作用域 | 当前标签 | 说明 |
| --- | --- | --- |
| Connection | `supportsTextOutbound`、`supportsMediaOutbound`、`supportsImageOutbound`、`supportsVideoOutbound`、`supportsVoiceOutbound`、`supportsFileOutbound`、`supportsRemoteMediaURLSource`、`supportsLocalMediaPathSource`、`supportsProactivePush`、`supportsSessionlessPush` | QQ Bot 已声明文本与 rich media 能力 |
| DeliveryTarget | `supportsProactivePush`、`supportsSessionlessPush` | 支持 route-backed 主动发送与 sessionless push |

---

## 5. 当前实现原理

### 5.1 激活

| 步骤 | 当前实现 | 结果 |
| --- | --- | --- |
| 校验配置 | 校验 `qqbot_app_id / qqbot_app_secret` | 缺失时拒绝激活 |
| 获取 token | 拉取 access token | 验证凭据有效 |
| 获取 gateway | 拉取官方 gateway 地址 | 验证连接前置条件 |
| 标准化设置 | 写回 `sandbox / intents / markdown_support` 等配置 | 后续运行一致 |

### 5.2 入站

| 步骤 | 当前实现 | 结果 |
| --- | --- | --- |
| 建立 Gateway 连接 | WebSocket 连接官方 Gateway | 进入事件循环 |
| 完成握手 | `Hello -> Identify/Resume -> READY/RESUMED` | 获得 session 状态 |
| 保持心跳 | Heartbeat 与 ACK | 判断连接健康度 |
| 持久化 session | 持续写回 `session_id / seq` | 支持断线恢复 |
| 解析事件 | 处理 group / c2c 文本消息 | 归一为 `InboundMessage` |
| 文本清洗 | 去除自动 `@bot` 前缀，拼接引用消息摘要 | 提高 AI 输入质量 |

### 5.3 出站

| 场景 | 当前实现 | 结果 |
| --- | --- | --- |
| 群聊即时回复 | 优先使用最近 `msg_id` 被动回复 | 保持平台语义一致 |
| 被动回复失败 | 自动退化为主动群发 | 保证消息可达 |
| 普通文本 | 默认发送 `msg_type=0` 的 `content` | 纯文本稳定 |
| markdown 文本 | `qqbot_markdown_support=true` 时发送 `msg_type=2` | 使用 `markdown.content` |
| rich media | 先上传文件获得 `file_info`，再发送 `msg_type=7` | 支持图片、视频、语音、文件 |
| 远程媒体 | 先下载 URL 内容，再推断内容类型与文件名 | 支持 sessionless push |
| 本地媒体 | 读取绝对路径文件后上传 | 支持主动发送与文本混发 |
| route-backed 主动发送 | 支持 `qqbot_group / qqbot_c2c` | 可直接用于 DeliveryTarget |
| 最新上下文复用 | 优先匹配最近 conversation | 便于带上最近 `event_msg_id` |

---

## 6. 与 `cc-connect` 的对应关系

| 能力 | `cc-connect` 思路 | 当前项目实现 |
| --- | --- | --- |
| Gateway 管理 | provider 内维护 token、session、heartbeat | `qqbot` Provider 负责连接循环 |
| 会话隔离 | group / c2c 明确分开 | 写入 `BotConversation.ExternalConversationID` |
| passive reply | 使用最近 `msg_id` | 保存到 `ProviderState` |
| markdown 发送 | 能力强的平台走 richer payload | 当前项目通过 `qqbot_markdown_support` 控制 |
| rich media 发送 | 文件上传与消息发送解耦 | 当前项目先上传 `file_info` 再发消息 |
| 主动发送 | 从 session 信息恢复投递目标 | 复用 `BotDeliveryTarget` |

---

## 7. 后续待补项

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 暂无 inbound rich media 解析 | 消息形态 | 中 | 当前入站仍以文本事件为主 |
| markdown 渲染仍是基础分支 | 消息样式 | 中 | 当前未补更复杂模板能力 |
| Gateway 公共生命周期尚未抽象 | 架构一致性 | 中 | 当前由 provider 自行管理 |
| richer media 降级仍较基础 | 复杂消息展示 | 低 | 当前重点是可发送，不是最佳展示 |

---

## 8. 验证结果

| 验证项 | 结果 | 备注 |
| --- | --- | --- |
| token 刷新与缓存 | 通过 | 已覆盖过期刷新 |
| group / c2c 入站解析 | 通过 | 已覆盖会话键与文本清洗 |
| Gateway 握手与心跳 | 通过 | 已覆盖 `Hello / Identify / READY / Heartbeat` |
| passive reply fallback | 通过 | 已覆盖群聊被动回复失败时主动发送 |
| 远程图片 rich media 出站 | 通过 | 已覆盖下载 URL、上传文件、发送 `msg_type=7` |
| 本地文件 rich media 出站 | 通过 | 已覆盖绝对路径文件上传与文本混发 |
| markdown 出站分支 | 已实现 | 代码对照已确认 `msg_type=2` 发送路径 |
| route-backed 主动发送 | 通过 | 已覆盖 `qqbot_group / qqbot_c2c` |
| 最新上下文复用 | 通过 | 已覆盖 route-backed 发送复用最近 conversation |
| 前端 i18n | 已接入 | 本轮未新增前端改动 |