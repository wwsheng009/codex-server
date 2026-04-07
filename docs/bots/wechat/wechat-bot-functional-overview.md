# WeChat Bot 功能说明

## 1. 文档目的

本文档说明当前项目 `E:\projects\ai\codex-server` 中 `WeChat Bot` 的已实现功能，重点覆盖：

1. 接入方式与账号管理
2. 消息收发与会话绑定
3. 线程控制与审批处理
4. 媒体、流式输出、打字状态与调试能力
5. 当前限制、边界与关键代码入口

本文档描述的是**当前实现**，不是规划方案。更早期的设计分析可参考：

- [wechat-bot-integration-analysis-and-implementation-plan.md](./wechat-bot-integration-analysis-and-implementation-plan.md)
- [cli-wechat-bridge-source-analysis.md](./cli-wechat-bridge-source-analysis.md)
- [wechat-bot-setup-and-validation-guide.md](./wechat-bot-setup-and-validation-guide.md)

## 2. 总览

当前 WeChat Bot 采用项目现有的 `bots.Service + AIBackend` 架构：

1. WeChat provider 负责和微信侧 API 通信
2. `bots.Service` 负责持久化入站消息、解析控制命令、绑定 conversation 与 workspace thread
3. AI backend 负责把消息送入线程运行时
4. 运行时产生的 bot 可见输出再由 WeChat provider 发回微信

关键代码入口：

- WeChat provider: [backend/internal/bots/wechat.go](../../../backend/internal/bots/wechat.go)
- WeChat 媒体处理: [backend/internal/bots/wechat_media.go](../../../backend/internal/bots/wechat_media.go)
- WeChat 登录与二维码: [backend/internal/bots/wechat_auth.go](../../../backend/internal/bots/wechat_auth.go)
- Bot 服务总入口: [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)
- Workspace thread bot backend: [backend/internal/bots/workspace_thread_backend.go](../../../backend/internal/bots/workspace_thread_backend.go)
- 审批服务: [backend/internal/approvals/service.go](../../../backend/internal/approvals/service.go)

## 3. 当前已支持的核心能力

### 3.1 接入方式

当前 WeChat Bot 只支持 **polling**，不支持 webhook。

- WeChat provider 的 `ParseWebhook()` 直接忽略 webhook
- 实际入站链路通过 `RunPolling()` 调用远端 `getupdates`
- `wechat_delivery_mode` 当前只允许 `polling`

对应代码：

- [backend/internal/bots/wechat.go](../../../backend/internal/bots/wechat.go)

### 3.2 账号接入与凭据管理

当前项目支持三种方式为 WeChat 连接准备凭据：

1. 手工填写连接参数
2. 通过二维码登录拿到确认后的登录会话
3. 复用已经保存到 workspace 的 WeChat 账号

#### 3.2.1 二维码登录

后端提供独立的 WeChat 登录会话服务，不把扫码登录直接塞进 `CreateConnection`。

流程如下：

1. 前端调用 `StartWeChatLogin`
2. 后端向 WeChat/iLink 接口申请二维码
3. 前端轮询登录状态
4. 登录确认后，后端得到 `bot_token`、`account_id`、`user_id`
5. 确认成功的账号会自动写入 workspace 级 WeChat 账号库
6. 后续创建 bot connection 时可以直接引用这个确认后的登录会话或已保存账号

对应服务代码：

- [backend/internal/bots/wechat_auth.go](../../../backend/internal/bots/wechat_auth.go)
- [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)

对应 API：

- `POST /api/workspaces/{workspaceId}/bot-providers/wechat/login/start`
- `GET /api/workspaces/{workspaceId}/bot-providers/wechat/login/{loginId}`
- `DELETE /api/workspaces/{workspaceId}/bot-providers/wechat/login/{loginId}`

#### 3.2.2 已保存账号

确认过的 WeChat 账号会保存为 workspace 级 `WeChatAccount`，可在后续创建连接时复用。

支持：

1. 列出账号
2. 更新账号 `alias` / `note`
3. 删除账号
4. 创建连接时通过 `wechat_saved_account_id` 复用

对应 API：

- `GET /api/workspaces/{workspaceId}/bot-providers/wechat/accounts`
- `PATCH /api/workspaces/{workspaceId}/bot-providers/wechat/accounts/{accountId}`
- `DELETE /api/workspaces/{workspaceId}/bot-providers/wechat/accounts/{accountId}`

### 3.3 创建连接时支持的微信配置

创建 WeChat Bot 连接时，当前后端会识别以下主要字段：

#### Settings

- `wechat_delivery_mode`
- `wechat_base_url`
- `wechat_cdn_base_url`
- `wechat_route_tag`
- `wechat_account_id`
- `wechat_owner_user_id`
- `wechat_sync_buf`
- `wechat_channel_timing`
- `wechat_login_session_id`
- `wechat_saved_account_id`

#### Secrets

- `bot_token`

其中：

- `wechat_login_session_id` 和 `wechat_saved_account_id` 是创建时的过渡字段，后端会解析成真实连接配置
- `wechat_sync_buf` 是 polling 游标
- `wechat_channel_timing` 用于控制是否附加微信链路耗时信息

相关代码：

- [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)
- [backend/internal/bots/wechat.go](../../../backend/internal/bots/wechat.go)
- [backend/internal/bots/wechat_channel_timing.go](../../../backend/internal/bots/wechat_channel_timing.go)

## 4. 消息收发与会话行为

### 4.1 入站消息来源

WeChat provider 的 `RunPolling()` 会循环调用远端 `getupdates`，并完成：

1. 读取 `wechat_sync_buf`
2. 拉取新消息
3. 过滤非用户消息
4. 把微信消息转换为统一的 `InboundMessage`
5. 更新 `wechat_sync_buf`

如果上游返回会话过期错误码 `-14`，当前 provider 会把该账号临时暂停一段时间，避免持续失败重试。

### 4.2 入站消息持久化

所有入站消息会先被持久化为 `BotInboundDelivery`，再进入 worker 队列处理。

这带来几个直接效果：

1. 入站消息有持久化记录
2. delivery 可以被恢复重放
3. 去重不依赖仅内存状态
4. reply snapshot 可以在失败时用于后续恢复

相关代码：

- [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)
- [backend/internal/store/models.go](../../../backend/internal/store/models.go)

### 4.3 会话绑定

WeChat 当前将外部会话按用户维度绑定：

- `ConversationID = from_user_id`
- `ExternalChatID = from_user_id`
- `Title = session_id` 优先，否则回退到 `from_user_id`

系统会为每个外部会话创建或更新 `BotConversation`，并将其与内部 `workspace thread` 绑定。

### 4.4 Provider 侧上下文状态

WeChat 回复依赖会话级上下文，所以系统会把这些 provider 数据持久化到会话：

- `wechat_context_token`
- `wechat_session_id`
- `wechat_created_at_ms`

流转路径如下：

1. WeChat 入站消息写入 `InboundMessage.ProviderData`
2. `BotInboundDelivery.ProviderData` 落盘
3. `BotConversation.ProviderState` 合并保存
4. 后续发消息、流式回复、打字状态都从 `ProviderState` 中读取 `wechat_context_token`

这意味着：**没有可用的 `wechat_context_token` 时，WeChat provider 无法把回复发回原会话。**

### 4.5 引用消息处理

当前实现会把微信引用内容转成文本前缀：

```text
Quoted: ...
```

在解析控制命令时，系统会先自动去掉这些 `Quoted:` 前缀。因此下面两种情况都可以正确识别命令：

1. 直接发送 `/approvals`
2. 引用上一条消息再发送 `/approvals`

相关代码：

- [backend/internal/bots/wechat.go](../../../backend/internal/bots/wechat.go)
- [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)

## 5. 回复、流式输出与打字状态

### 5.1 普通回复

WeChat provider 通过 `sendmessage` 把文本或媒体发回微信。

发送回复时至少依赖：

- `bot_token`
- `wechat_base_url`
- `conversation.ExternalChatID`
- `conversation.ProviderState[wechat_context_token]`

### 5.2 流式回复

当前 WeChat provider 已实现流式回复会话：

- 支持把 streaming update 逐步提交到微信
- 只发送“已经稳定提交”的消息片段
- 最终完成时再以最终消息列表收敛

这意味着，当底层 AI backend 以流式方式输出 bot 可见消息时，WeChat 侧可以收到逐步推进的结果，而不只能等最终整段回复。

### 5.3 打字状态

当前 WeChat provider 已实现 typing：

1. 通过 `getconfig` 获取 `typing_ticket`
2. 调用 `sendtyping` 发送 typing 状态
3. 用 keepalive 周期续发
4. 结束时发送 cancel 状态

### 5.4 微信链路耗时

当前支持 `wechat_channel_timing`：

- `enabled`: 总是附加链路耗时信息
- `disabled`: 总是不附加
- 空值: 继承 runtime mode，`debug` 时默认开启

此外还提供了 WeChat provider 命令 `/echo`，会回显文本并附带链路耗时。

相关代码：

- [backend/internal/bots/wechat.go](../../../backend/internal/bots/wechat.go)
- [backend/internal/bots/wechat_slash_commands.go](../../../backend/internal/bots/wechat_slash_commands.go)
- [backend/internal/bots/wechat_channel_timing.go](../../../backend/internal/bots/wechat_channel_timing.go)

## 6. WeChat Bot 命令

当前微信连接支持三类命令：

1. WeChat provider 专属命令
2. 通用 bot conversation 命令
3. 通用 bot approval 命令

### 6.1 WeChat provider 专属命令

- `/echo <message>`
- `/toggle-debug`

说明：

- `/echo` 会发送回显文本，并附带 channel timing
- `/toggle-debug` 会切换当前 bot connection 的 runtime mode `normal/debug`

### 6.2 Conversation 命令

- `/newthread [title]`
- `/thread`
- `/thread list [active|archived|all]`
- `/thread rename <title>`
- `/thread archive`
- `/thread unarchive <thread_id|index>`
- `/thread use <thread_id|index>`

这些命令允许用户在微信会话中直接：

1. 新建 thread
2. 查看当前 thread
3. 列出已知 thread
4. 重命名当前 thread
5. 归档 / 取消归档 thread
6. 切换当前会话绑定的 thread

线程列表会优先显示当前 thread，并结合最近审批活动排序。

### 6.3 Approval 命令

- `/approvals`
- `/approve <request_id>`
- `/decline <request_id>`
- `/cancel <request_id>`
- `/answer <request_id> <text>`
- `/answer <request_id> question_id=value; question_id=value`

这些命令复用的是通用 bot 审批层，不是微信特有审批接口。

## 7. 审批请求的展示与处理

### 7.1 审批来源

审批请求不是由 WeChat provider 自己产生，而是由 runtime / thread 执行过程中发出的 `server request` 产生。

当前 bot 可见的 server request 类型包括：

- `item/commandExecution/requestApproval`
- `execCommandApproval`
- `item/fileChange/requestApproval`
- `applyPatchApproval`
- `item/tool/requestUserInput`
- `item/permissions/requestApproval`
- `mcpServer/elicitation/request`
- `item/tool/call`
- `account/chatgptAuthTokens/refresh`

这些事件会被 workspace thread bot backend 渲染成适合 bot 平台展示的文本。

### 7.2 在微信中如何展示审批

当前审批不是按钮式交互，而是**纯文本提示 + 文本命令**。

例如，bot 会向微信展示：

1. 审批标题和摘要
2. request id
3. 可以回复的命令提示

不同类型的审批会给出不同提示：

- `requestUserInput`:
  - `Reply with /answer <request_id> <text>`
  - 多问题时使用 `question_id=value; question_id=value`
- `item/permissions/requestApproval`:
  - `Reply with /approve <request_id>`
  - `Reply with /decline <request_id>`
- `account/chatgptAuthTokens/refresh`:
  - 明确提示只能在 workspace UI 完成

### 7.3 审批命令如何被处理

审批命令处理链路如下：

1. 微信文本消息进入 `bots.Service`
2. 命令文本先做微信引用前缀清理
3. `parseBotApprovalCommand()` 识别 `/approvals`、`/approve`、`/answer` 等命令
4. `approvals.Service.List()` 读取当前 workspace 的 pending approvals
5. `/approvals` 渲染列表并发回微信
6. `/approve`、`/answer` 会构造 `approvals.ResponseInput`
7. `approvals.Service.Respond()` 转成 runtime 需要的 payload
8. runtime 收到响应后继续被阻塞的 thread
9. bot 先向微信回一条“审批已处理”的确认文本

### 7.4 审批输入映射

不同审批类型在响应时会被映射成不同 payload：

- 命令 / 文件审批:
  - 生成 `decision`
- 权限审批:
  - 生成 `permissions` + `scope`
- `item/tool/requestUserInput`:
  - 生成 `answers`
- `mcpServer/elicitation/request`:
  - 生成 `action` + `content`
- `item/tool/call`:
  - 生成 `contentItems` + `success`

### 7.5 审批命令的一个关键行为

审批命令被识别为 `control command`，不会和普通会话消息共享同一个 conversation worker。

当前实现会把控制命令放进独立的 `connection + control` worker。这意味着：

1. 如果普通 AI 回复还在执行
2. 当前微信聊天里又发送了 `/approvals` 或 `/approve`
3. 这些审批命令仍可以立即处理

换句话说，审批命令可以绕过“当前会话普通消息正在阻塞”的情况。

### 7.6 审批范围说明

当前 `/approvals` 列的是 **workspace 级 pending approvals**，不是当前会话独享的审批列表。

系统会做的事情是：

1. 读取当前 workspace 全部 pending approvals
2. 优先把当前 conversation 绑定 thread 的审批排到前面
3. 但本质上仍然是 workspace 范围的列表

这是当前实现需要特别注意的边界。

### 7.7 当前明确不能在微信里完成的审批

`account/chatgptAuthTokens/refresh` 当前不能在 WeChat Bot 中完成。

系统行为是：

1. 在审批列表中显示该请求
2. 明确提示“use the workspace UI instead”
3. bot 侧拒绝把它构造成可提交的微信审批输入

相关代码：

- [backend/internal/bots/transcript_render.go](../../../backend/internal/bots/transcript_render.go)
- [backend/internal/bots/workspace_thread_backend.go](../../../backend/internal/bots/workspace_thread_backend.go)
- [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)
- [backend/internal/approvals/service.go](../../../backend/internal/approvals/service.go)

## 8. 媒体能力

### 8.1 入站媒体

当前 WeChat provider 支持解析和下载以下入站媒体：

- 图片
- 语音
- 文件
- 视频

处理特点：

1. 媒体会尽量下载到本地临时文件
2. 语音默认先保存为 `silk`，若转码成功会转为 `wav`
3. 如果当前消息本身没有媒体，但引用消息里带媒体，系统会尝试回退到引用消息中的媒体
4. 文本摘要中会插入 `[WeChat ... attachment]` 信息，保证即使上层只看摘要也知道有附件

### 8.2 出站媒体

当前 WeChat provider 支持发送以下出站媒体：

- 图片
- 视频
- 文件

说明：

- `voice` 类型在当前出站分类中会归入文件通道，不作为微信原生语音消息发送
- 出站媒体支持本地文件，也支持远程 URL
- 对远程 URL，系统会尝试解析结构化页面，抽取真实媒体地址
- 对部分远程视频资源，必要时会先转码为 MP4 再上传

### 8.3 上传方式

当前媒体发送流程大致是：

1. 解析本地文件或下载远程资源
2. 判断图片 / 视频 / 文件类型
3. 调用 `getuploadurl`
4. 用 AES-ECB 加密内容
5. 上传到 CDN
6. 再通过 `sendmessage` 发送媒体描述

### 8.4 失败回退

如果媒体上传或发送失败，当前实现会尝试回退为文本说明，例如：

- 原回复文本
- 附件 URL / 本地路径 / 文件名摘要

这样即使媒体发送失败，也尽量保证微信侧能看到可操作的退化信息。

相关代码：

- [backend/internal/bots/wechat_media.go](../../../backend/internal/bots/wechat_media.go)
- [backend/internal/bots/wechat_outbound_media_resolver.go](../../../backend/internal/bots/wechat_outbound_media_resolver.go)
- [backend/internal/bots/message_media.go](../../../backend/internal/bots/message_media.go)

## 9. 当前实现中的数据模型

### 9.1 WeChatAccount

用于保存 workspace 级可复用微信账号：

- `BaseURL`
- `AccountID`
- `UserID`
- `BotToken`
- `Alias`
- `Note`
- `LastConfirmedAt`

### 9.2 BotConversation

会话级状态同时保存：

1. bot backend 绑定信息
2. provider 侧会话状态

其中与 WeChat 强相关的是：

- `ProviderState`
  - `wechat_context_token`
  - `wechat_session_id`
  - 其他 provider 级元数据

### 9.3 BotInboundDelivery

每个入站消息的 delivery 记录中会保存：

- 文本
- 媒体
- providerData
- reply snapshot
- 状态 / 尝试次数 / 错误

这些数据用于恢复、去重、失败重试和调试。

相关模型：

- [backend/internal/store/models.go](../../../backend/internal/store/models.go)

## 10. API 入口汇总

### 10.1 WeChat 登录与账号

- `POST /api/workspaces/{workspaceId}/bot-providers/wechat/login/start`
- `GET /api/workspaces/{workspaceId}/bot-providers/wechat/login/{loginId}`
- `DELETE /api/workspaces/{workspaceId}/bot-providers/wechat/login/{loginId}`
- `GET /api/workspaces/{workspaceId}/bot-providers/wechat/accounts`
- `PATCH /api/workspaces/{workspaceId}/bot-providers/wechat/accounts/{accountId}`
- `DELETE /api/workspaces/{workspaceId}/bot-providers/wechat/accounts/{accountId}`

### 10.2 通用 bot connection API 中的 WeChat 相关能力

- `POST /api/workspaces/{workspaceId}/bot-connections`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/pause`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/resume`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/runtime-mode`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/wechat-channel-timing`
- `GET /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations`

对应路由定义：

- [backend/internal/api/router.go](../../../backend/internal/api/router.go)

## 11. 当前限制与注意事项

### 11.1 只支持 polling

当前没有 WeChat webhook 接入能力。

### 11.2 回复依赖 context token

如果 conversation 没有有效的 `wechat_context_token`，bot 无法继续往该会话发送消息。

### 11.3 审批是文本命令，不是按钮交互

当前用户必须通过 `/approve`、`/answer` 等文本命令完成审批。

### 11.4 `/approvals` 是 workspace 范围

当前实现会优先展示当前 thread 相关审批，但列表本质上仍是 workspace 级 pending approvals。

### 11.5 部分审批必须回到 UI

`account/chatgptAuthTokens/refresh` 这类请求只能在 workspace UI 完成。

### 11.6 语音出站未实现原生语音消息

当前出站 `voice` 不会转成微信原生语音消息类型，而是按文件类路径处理。

### 11.7 上游会话过期时会临时暂停

如果微信上游返回 `errcode = -14`，当前 provider 会把该连接临时暂停一段时间，再恢复轮询或发送。

## 12. 测试依据

当前与 WeChat Bot 功能直接相关的测试覆盖了以下关键行为：

1. provider state 会被持久化到 conversation
2. 审批命令可以绕过被阻塞的普通会话 worker
3. 微信引用命令可以正确识别
4. `/approve` 和 `/answer` 会构造正确审批输入
5. `auth refresh` 会被限制为仅 UI 处理

可参考：

- [backend/internal/bots/service_test.go](../../../backend/internal/bots/service_test.go)
- [backend/internal/bots/wechat_test.go](../../../backend/internal/bots/wechat_test.go)
- [backend/internal/approvals/service_test.go](../../../backend/internal/approvals/service_test.go)

## 13. 结论

当前 WeChat Bot 已经不是单纯的“消息收发适配器”，而是一套完整接入：

1. 支持二维码登录和账号复用
2. 支持 polling 收消息、持久化 delivery、绑定 workspace thread
3. 支持线程控制命令与 WeChat 专属调试命令
4. 支持 bot 可见审批在微信中以文本命令方式处理
5. 支持图片 / 视频 / 文件出站，以及图片 / 语音 / 文件 / 视频入站
6. 支持流式回复、打字状态和链路耗时调试

如果后续要继续增强，最值得优先关注的方向通常是：

1. 审批范围隔离是否要从 workspace 级收紧到 conversation/thread 级
2. WeChat 侧是否需要更强的结构化交互而不只依赖文本命令
3. 出站语音、更多媒体类型和更细致的失败恢复策略
