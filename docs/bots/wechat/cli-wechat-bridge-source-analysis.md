# CLI-WeChat-Bridge 源码分析报告

## 1. 结论摘要

对 `E:\projects\ai\CLI-WeChat-Bridge` 的源码分析后，可以得出几个核心结论：

1. 这个项目**并没有自己实现微信底层私有协议**，也没有接入 `wechaty`、桌面微信注入、浏览器 Web 微信等方案。
2. 它实际依赖的是一套外部 HTTP 接口层，默认基址为 `https://ilinkai.weixin.qq.com`，代码里统一称为 **iLink bot API**。
3. 微信侧交互的本质是：
   - 登录阶段：先拿二维码，再轮询二维码状态，拿到 `bot_token`、`ilink_bot_id`、`ilink_user_id`
   - 收消息阶段：使用 `ilink/bot/getupdates` 做**长轮询拉取**
   - 发消息阶段：使用 `ilink/bot/sendmessage`
   - 发附件阶段：先 `ilink/bot/getuploadurl`，然后把文件经 **AES-128-ECB** 加密后上传到微信 CDN，再把媒体描述回填到 `sendmessage`
4. 这个项目的“桥”不是微信机器人框架，而是**本地 CLI 会话桥接器**：
   - WeChat 只是远程输入/输出入口
   - 真正的执行端是本地 `Codex`、`Claude Code`、`OpenCode` 或持久 `shell`
   - 线程、审批、会话切换、最终回复都以本地 bridge/companion 状态为准
5. 仓库里**没有真正的 WeChat webhook / callback 服务端**。微信入站消息是主动拉取，不是被微信服务器回调推送。
6. 如果你说的“webcat 回调”是指“微信回调”，那这个项目的答案是：**没有微信 webhook，只有本地 callback/hook**，例如：
   - Claude hook 的本地 TCP 回调
   - companion 与 bridge 之间的本地 JSON-over-TCP IPC

## 2. 关键源码位置

### 2.1 微信协议与配置层

- `src/wechat/channel-config.ts`
  负责默认 API 地址、数据目录、凭据文件、同步游标、上下文 token 缓存、工作区状态目录等路径定义。
- `src/wechat/setup.ts`
  负责二维码登录流程。
- `src/wechat/wechat-transport.ts`
  负责真正的微信 API 收发、同步游标维护、上下文 token 缓存、附件加密上传、消息去重。
- `src/wechat/wechat-channel.ts`
  这是一个 MCP server 封装层，把 `WeChatTransport` 暴露成 `wechat_fetch_messages`、`wechat_reply`、`wechat_send_file` 之类工具。

### 2.2 bridge 与本地 CLI 层

- `src/bridge/wechat-bridge.ts`
  bridge 主循环。负责长轮询微信消息、控制命令解析、调用适配器、把本地输出再发回微信。
- `src/bridge/bridge-final-reply.ts`
  负责把 agent 的最终回复拆成“可见文本 + 附件列表”，并回发到微信。
- `src/bridge/bridge-utils.ts`
  负责：
  - 微信控制命令解析，如 `/status`、`/stop`、`/reset`
  - 审批消息格式化
  - 最终回复里的 `wechat-attachments` 块解析
  - 输出批处理
- `src/bridge/bridge-state.ts`
  负责 bridge 锁、状态持久化、授权 owner 记录、共享 session/thread 状态。

### 2.3 本地 callback / IPC 层

- `src/companion/local-companion-link.ts`
  定义本地 companion endpoint 文件格式，以及 JSON-over-TCP 消息协议。
- `src/bridge/bridge-adapters.claude.ts`
  会启动一个本地 TCP server，接收 Claude hook script 回调。

## 3. 整体架构与数据流

可以把它理解为三层：

1. 微信传输层
   `setup.ts` + `wechat-transport.ts`
2. bridge 编排层
   `wechat-bridge.ts`
3. 本地 CLI 执行层
   `bridge-adapters.*.ts` + `local-companion*`

整体时序如下：

```text
WeChat 用户
  -> iLink bot API / getupdates
  -> CLI-WeChat-Bridge / wechat-bridge.ts
  -> bridge adapter (codex / claude / opencode / shell)
  -> 本地 CLI 进程
  -> bridge 事件流 stdout / final_reply / approval_required
  -> WeChatTransport.sendText/sendFile/sendImage...
  -> iLink bot API / sendmessage
  -> 微信会话
```

对于附件，路径会变成：

```text
本地文件
  -> WeChatTransport.prepareUpload()
  -> ilink/bot/getuploadurl
  -> AES-128-ECB 加密
  -> novac2c.cdn.weixin.qq.com/c2c/upload
  -> 拿到 x-encrypted-param
  -> ilink/bot/sendmessage(媒体描述)
  -> 微信收到图片/文件/语音/视频
```

## 4. 登录与二维码生成原理

### 4.1 默认地址与 bot 类型

在 `src/wechat/channel-config.ts` 中：

- 默认 API 基址：`https://ilinkai.weixin.qq.com`
- 可由环境变量 `WECHAT_ILINK_BASE_URL` 覆盖
- `BOT_TYPE = "3"`

这说明二维码登录不是本地生成，而是**从远端 iLink 服务申请**。

### 4.2 二维码获取流程

`src/wechat/setup.ts` 的关键流程：

1. `fetchQRCode(baseUrl)`
   访问：

   ```text
   GET {base}/ilink/bot/get_bot_qrcode?bot_type=3
   ```

2. 返回结构：

   ```ts
   interface QRCodeResponse {
     qrcode: string;
     qrcode_img_content: string;
   }
   ```

3. 代码随后调用 `printQRCode(qrResp.qrcode_img_content)`

### 4.3 二维码是如何“生成”的

这里要区分两个层面：

1. **真正的登录二维码内容**不是本地计算出来的，而是由远端 `get_bot_qrcode` 返回。
2. 本地终端只是把返回的字符串交给 `qrcode-terminal` 做字符画渲染。

`setup.ts` 中的实现：

```ts
const qrterm = await import("qrcode-terminal");
qrterm.default.generate(qrContent, { small: true }, (qr: string) => {
  console.log(qr);
});
```

因此更准确地说：

- “二维码内容”由服务端签发
- “二维码显示”由本地 `qrcode-terminal` 渲染

从代码行为看，`qrcode_img_content` 虽然名字像“图片内容”，但实际上被当作一个**可直接编码成二维码的字符串**使用。这一点是基于源码调用方式得出的推断。

### 4.4 登录状态轮询

二维码拿到后，`setup.ts` 会不断轮询：

```text
GET {base}/ilink/bot/get_qrcode_status?qrcode=...
```

状态结构：

```ts
interface QRStatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}
```

几个关键点：

- `scaned` 是服务端返回值里的拼写，源码也直接照用
- `confirmed` 后才会把账号落盘
- 轮询请求带了头：

  ```text
  iLink-App-ClientVersion: 1
  ```

- 单次轮询 35 秒超时，超时视为 `wait`
- 总等待时长为 480 秒

### 4.5 凭据落盘

确认登录后写入：

```json
{
  "token": "bot_token",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "accountId": "ilink_bot_id",
  "userId": "ilink_user_id",
  "savedAt": "ISO 时间"
}
```

默认路径：

```text
~/.claude/channels/wechat/account.json
```

这个 `userId` 后续会被当成**唯一授权 owner**。

## 5. 微信 API 协议层分析

### 5.1 统一请求头

`src/wechat/wechat-transport.ts` 的 `buildHeaders()` 为 POST API 构造头：

```text
Content-Type: application/json
AuthorizationType: ilink_bot_token
X-WECHAT-UIN: <随机值>
Authorization: Bearer <bot_token>
Content-Length: <body 字节数>
```

其中：

- `AuthorizationType: ilink_bot_token` 明确说明鉴权凭据类型是 bot token
- `Authorization: Bearer <token>` 是实际鉴权
- `X-WECHAT-UIN` 并不是从账号文件读取，而是每次随机生成

`X-WECHAT-UIN` 的生成方式很特殊：

1. 随机生成一个 32 位整数
2. 转成十进制字符串
3. 再做 Base64

这说明客户端并不掌握真实微信 UIN，至少源码层面没有依赖真实 UIN 做签名。更像是服务端要求存在这样一个头，具体值不敏感。

### 5.2 通用请求函数

`apiFetch()` 的特点：

- 所有业务 API 都是 **POST JSON**
- 默认超时由 `AbortController` 控制
- 非 2xx 状态直接抛出 `HTTP <status>: <body>`

只有二维码登录阶段的两个接口是 GET。

### 5.3 channel_version

多个请求都带：

```json
{
  "base_info": {
    "channel_version": "0.3.0"
  }
}
```

这说明服务端协议有明确的 channel/version 兼容概念。

## 6. 入站消息机制：不是 webhook，而是长轮询

### 6.1 关键结论

这个仓库没有实现任何面向微信服务器开放的 HTTP callback 端口。

微信消息拉取使用的是：

```text
POST {base}/ilink/bot/getupdates
```

也就是**客户端主动长轮询**，而不是服务端 webhook 推送。

### 6.2 `getupdates` 请求体

`WeChatTransport.getUpdates()` 的请求体：

```json
{
  "get_updates_buf": "<上次同步游标>",
  "base_info": {
    "channel_version": "0.3.0"
  }
}
```

其中 `get_updates_buf` 是增量游标，对应本地文件：

```text
~/.claude/channels/wechat/sync_buf.txt
```

### 6.3 `getupdates` 响应结构

源码里对应：

```ts
interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
}
```

成功后会把新的 `get_updates_buf` 再写回本地文件，形成下一次增量拉取起点。

### 6.4 入站消息结构与过滤

内部消息结构 `WeixinMessage` 里关键字段包括：

- `from_user_id`
- `to_user_id`
- `client_id`
- `session_id`
- `message_type`
- `message_state`
- `item_list`
- `context_token`
- `create_time_ms`

bridge 只处理：

- `message_type === 1`

也就是用户消息，源码常量名为 `MSG_TYPE_USER = 1`。

机器人自己发出的消息类型是：

- `MSG_TYPE_BOT = 2`

### 6.5 文本内容抽取逻辑

`extractTextFromMessage()` 会遍历 `item_list`，把可读内容拼出来：

- `type === 1` 时读取 `text_item.text`
- `type === 3` 时读取 `voice_item.text`
- 如果有引用消息 `ref_msg`，会拼出一行 `Quoted: ...`

这意味着：

1. 文字消息可直接读
2. 语音消息如果服务端已提供转写文本，也能当文本输入
3. 回复/引用消息会被折叠成前缀信息

### 6.6 `context_token` 的作用

每条入站消息可能包含 `context_token`。源码在轮询到消息时会：

1. 按 `senderId` 缓存 `context_token`
2. 写入 `context_tokens.json`

后续回复时，必须拿到对应的 `context_token` 才能发消息。也就是说，这个协议并不是只靠 `to_user_id` 就能直接发消息，而是要求：

- `recipientId`
- `context_token`

共同确定一个可回复上下文。

### 6.7 去重与跨进程抢占

源码做了两层防重：

1. 进程内最近消息缓存
   - `recentMessageKeys`
   - 上限 500 条
2. 跨进程 claim 文件
   - claim key: `accountId|messageKey`
   - claim 文件目录：`~/.claude/channels/wechat/inbound-message-claims`
   - 以 SHA-1 哈希为文件名
   - TTL 默认 10 分钟

`messageKey` 由以下字段拼成：

- `from_user_id`
- `client_id`
- `create_time_ms`
- `context_token`

这套机制的目的是避免多个 bridge 进程同时消费同一条微信消息。

### 6.8 启动时积压消息处理

bridge 主循环调用 `pollMessages()` 时会传：

```ts
minCreatedAtMs = bridgeStartedAtMs - MESSAGE_START_GRACE_MS
```

其中 `MESSAGE_START_GRACE_MS = 5000`。

也就是说：

- 启动前太久的历史消息会被视作 backlog
- 只统计忽略数量，不会作为当前会话输入处理

这有助于避免 bridge 重启后“补发”很多旧消息。

## 7. 出站消息发送机制

### 7.1 文本消息发送

最终发送都走 `sendMessage()`，对应接口：

```text
POST {base}/ilink/bot/sendmessage
```

发送体核心结构：

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<recipientId>",
    "client_id": "wechat-bridge:<timestamp>-<random>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [...],
    "context_token": "<context_token>"
  },
  "base_info": {
    "channel_version": "0.3.0"
  }
}
```

关键点：

- `from_user_id` 被留空，由服务端按 bot 身份推断
- `message_type = 2` 表示 bot 发出的消息
- `message_state = 2` 表示完成态
- `client_id` 本地生成，用于消息唯一性
- 文本消息的 `item_list` 里是：

```json
[
  {
    "type": 1,
    "text_item": {
      "text": "..."
    }
  }
]
```

### 7.2 recipient 的解析规则

`resolveRecipient()` 的逻辑不是简单依赖 `recipientId` 参数：

1. 如果显式传入 `recipientId`，直接使用
2. 否则使用 `contextTokenCache` 里最近活跃的 sender
3. 然后再从缓存中找对应 `context_token`

因此如果从未收到对方消息，就算知道对方 `userId`，源码层面也可能因为缺少 `context_token` 而无法发送。

## 8. 附件发送机制：先申请上传，再加密上传 CDN，再发媒体消息

### 8.1 支持的媒体类型

源码常量定义：

- `MSG_ITEM_IMAGE = 2`
- `MSG_ITEM_VOICE = 3`
- `MSG_ITEM_FILE = 4`
- `MSG_ITEM_VIDEO = 5`

上传媒体类型：

- `UPLOAD_MEDIA_TYPE_IMAGE = 1`
- `UPLOAD_MEDIA_TYPE_VIDEO = 2`
- `UPLOAD_MEDIA_TYPE_FILE = 3`
- `UPLOAD_MEDIA_TYPE_VOICE = 4`

### 8.2 尺寸限制

默认上传限制：

- 图片：20 MB
- 文件：50 MB
- 语音：20 MB
- 视频：100 MB

可由环境变量覆盖：

- `WECHAT_MAX_IMAGE_MB`
- `WECHAT_MAX_FILE_MB`
- `WECHAT_MAX_VOICE_MB`
- `WECHAT_MAX_VIDEO_MB`

### 8.3 `getuploadurl`

发送附件前，先调用：

```text
POST {base}/ilink/bot/getuploadurl
```

请求体关键字段：

- `filekey`
- `media_type`
- `to_user_id`
- `rawsize`
- `rawfilemd5`
- `filesize`
- `aeskey`
- `no_need_thumb: true`
- `base_info.channel_version`

其中：

- `rawsize` 是原始文件大小
- `rawfilemd5` 是原文件 MD5
- `filesize` 不是原始大小，而是**AES ECB 加密后按块对齐的大小**
- `aeskey` 是 16 字节随机密钥的 hex 字符串

### 8.4 文件加密与 CDN 上传

`uploadBufferToCdn()` 的关键逻辑：

1. 用 `AES-128-ECB` 加密原文件
2. 上传到：

   ```text
   https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=...&filekey=...
   ```

3. 成功后从响应头读取：

   ```text
   x-encrypted-param
   ```

4. 这个值被记作 `downloadParam`，后续会写回 `sendmessage`

源码里没有做 IV 管理，因为 ECB 模式本身不使用 IV。这是一个典型的“协议指定实现”，不是通用安全设计最佳实践，但显然服务端要求如此。

### 8.5 图片/文件/语音/视频如何封装到 `sendmessage`

媒体消息不是直接把文件内容放进 `sendmessage`，而是发送“媒体描述”。

公共媒体字段形式类似：

```json
{
  "media": {
    "encrypt_query_param": "<downloadParam>",
    "aes_key": "<base64(hex(aeskey))>",
    "encrypt_type": 1
  }
}
```

这里的 `aes_key` 编码方式比较特殊：

1. 先取 16 字节 aes key 的 hex 文本
2. 再把这个 hex 文本作为普通字符串做 Base64

不是“直接对原始 16 字节 key 做 Base64”。

各媒体额外字段：

- 图片：`mid_size`
- 文件：`file_name`、`len`
- 视频：`video_size`
- 语音：只带 `media`

## 9. bridge 如何把微信消息转给本地 CLI

### 9.1 主循环

`src/bridge/wechat-bridge.ts` 的主循环会不断执行：

1. `transport.pollMessages()`
2. 对每条新消息执行 `handleInboundMessage()`
3. 如果是普通文本，则 `dispatchInboundWechatText()`
4. 最终调用适配器：

   ```ts
   await adapter.sendInput(buildWechatInboundPrompt(message.text));
   ```

### 9.2 为什么要 `buildWechatInboundPrompt()`

这是一个非常关键的实现点。

如果微信消息里看起来像是在要求“把某个本地文件发到微信”，bridge 会自动在 prompt 前面注入一段说明，告诉下游 agent：

- 这是微信桥环境
- 如果用户要求发文件到微信，不要回答“我没有微信发送工具”
- 应该在最终回复结尾输出一个 `wechat-attachments` 代码块

示例：

````text
```wechat-attachments
file C:\Users\name\Desktop\document.pdf
```
````

这相当于把“微信发附件能力”伪装成一个 prompt protocol，让上游 agent 通过文本协议驱动实际文件上传。

### 9.3 微信侧控制命令

bridge 支持：

- `/status`
- `/resume`
- `/stop`
- `/reset`
- `/confirm`
- `/deny`

但注意：

- `codex` / `claude` / `opencode` 的微信 `/resume` 都被显式禁用了
- 项目要求在线程切换上以本地 companion 为权威，微信只跟随

## 10. 本地输出如何回流到微信

### 10.1 adapter 事件总线

bridge 并不直接读所有 CLI 进程 stdout 后立刻发送，而是依赖 adapter 事件：

- `stdout`
- `stderr`
- `notice`
- `approval_required`
- `mirrored_user_input`
- `session_switched`
- `thread_switched`
- `final_reply`
- `task_complete`
- `task_failed`
- `fatal_error`

`wechat-bridge.ts` 里通过 `adapter.setEventSink(...)` 接收这些事件，再决定如何发回微信。

### 10.2 输出批处理

`bridge-utils.ts` 里的 `OutputBatcher` 会：

- 把零碎输出拼接起来
- 默认每 1 秒 flush 一次
- 单次最多约 1200 字符

这样做的目的是避免 CLI 连续输出时向微信刷屏。

### 10.3 最终回复与附件解析

当 adapter 发出 `final_reply` 事件时，bridge 调用：

```ts
forwardWechatFinalReply(...)
```

该函数会：

1. 先用 `parseWechatFinalReply(rawText)` 解析最终回复
2. 拆成：
   - `visibleText`
   - `attachments`
3. 先发可见文本
4. 再逐个上传附件

解析规则有两种：

1. 显式 `wechat-attachments` 代码块
2. 内联路径回退解析

比如如果最终回复里直接出现可识别的本地图片/文件路径，也可能被自动识别成要发送的附件。

### 10.4 发送失败处理

如果附件上传失败，不会中断整个最终回复，而是补发一条文本说明：

```text
Failed to send <kind> attachment: <path>
<error>
```

这让微信侧至少能知道失败原因。

## 11. 授权、状态与工作区模型

### 11.1 单 owner 授权

登录成功后的 `account.json` 会保存 `userId`。bridge 启动时把它写进 `BridgeStateStore` 的 `authorizedUserId`。

后续每条入站消息都会检查：

```ts
if (message.senderId !== state.authorizedUserId) {
  return "Unauthorized..."
}
```

所以这个项目是**单 owner、单 bridge、单当前工作区**模型。

### 11.2 工作区隔离

`channel-config.ts` 会基于 `cwd` 生成 workspace key：

- 用规范化路径做 SHA-256
- 截取 12 位摘要
- 再拼上目录名 label

因此每个工作区都有自己的：

- `bridge-state.json`
- `codex-panel-endpoint.json`

但全局仍共享：

- `account.json`
- `sync_buf.txt`
- `context_tokens.json`
- `bridge.lock.json`

### 11.3 bridge 锁

`bridge-state.ts` 使用 `bridge.lock.json` 防止多个 bridge 同时占用全局运行权。

它还支持：

- 孤儿锁回收
- 父进程退出回收
- 运行期 ownership 校验

这与“跨进程消息 claim”一起，构成了比较完整的多进程保护。

## 12. “webcat 回调”在这个仓库里到底对应什么

我在整个仓库里检索了 `webcat`，**没有发现任何同名标识、模块、接口或协议字段**。

所以这里大概率有两种可能：

### 12.1 如果你想问的是 “WeChat 回调 / webhook”

答案是：

- 这个项目**没有微信 webhook**
- 没有 `express`/`http.createServer()` 一类面向微信开放的回调接口
- 微信入站消息完全依赖 `ilink/bot/getupdates` 长轮询

### 12.2 如果你想问的是 “本地 callback/hook 机制”

仓库里确实有两类：

1. Claude hook callback
   - `bridge-adapters.claude.ts` 启动本地 TCP server
   - 写出 hook script 和 `settings.json`
   - Claude 运行时会把 `SessionStart`、`PermissionRequest`、`Stop` 等事件通过本地 socket 回发给 bridge
2. companion callback / IPC
   - `local-companion-link.ts` 定义 endpoint 文件
   - companion 通过 TCP + JSON line 与 bridge 通信
   - 消息类型包括 `hello`、`request`、`response`、`event`、`state`

这两个 callback 都是**本地进程间通信**，不是微信服务器回调。

## 13. 与 MCP server 模式的关系

`src/wechat/wechat-channel.ts` 表明这个仓库其实保留了一个更“原始”的 MCP server 入口：

- `wechat_fetch_messages`
- `wechat_reply`
- `wechat_notify`
- `wechat_send_image`
- `wechat_send_file`
- `wechat_send_voice`
- `wechat_send_video`
- `wechat_reset_sync`

它与新 bridge 架构的关系是：

- 底层都复用 `WeChatTransport`
- MCP 模式更像“给外部 agent 一个微信工具包”
- bridge 模式更像“把微信接到本地 CLI 会话”

也就是说：

- `wechat-channel.ts` 是底层 transport 的工具化暴露
- `wechat-bridge.ts` 是完整的本地执行编排层

## 14. 可以直接复用的协议结论

如果你后续想在别的项目里复刻这个能力，按源码看最小必需协议能力如下：

1. 登录
   - `GET /ilink/bot/get_bot_qrcode?bot_type=3`
   - `GET /ilink/bot/get_qrcode_status?qrcode=...`
2. 拉消息
   - `POST /ilink/bot/getupdates`
   - 维护 `get_updates_buf`
3. 回复文本
   - `POST /ilink/bot/sendmessage`
   - 需要 `to_user_id + context_token`
4. 发附件
   - `POST /ilink/bot/getuploadurl`
   - 本地 AES-128-ECB 加密
   - 上传 CDN
   - 再 `sendmessage`
5. 做防重
   - 最近消息缓存
   - 跨进程 claim 文件
6. 做 owner 鉴权
   - 登录返回的 `ilink_user_id`

## 15. 风险与注意事项

### 15.1 协议依赖外部服务

这个项目不是基于公开、稳定、标准化的微信机器人 SDK，而是基于某个 iLink bot API。意味着：

- 可用性依赖该服务
- 协议字段未来可能变化
- `bot_type=3`、`AuthorizationType=ilink_bot_token`、`channel_version=0.3.0` 等都具有外部耦合性

### 15.2 `context_token` 是发消息的关键前提

源码已经明确表明：

- 没有缓存的 `context_token` 就无法直接回消息
- 所以“先让用户给 bot 发一条消息建立上下文”是必要步骤

### 15.3 这不是多租户桥

从锁、授权和工作区模型看，它不是：

- 一个中心化多用户机器人
- 一个多 owner 并发 bridge

而是：

- 单机
- 单 owner
- 单桥实例主导当前工作区

## 16. 最终判断

从源码实现看，CLI-WeChat-Bridge 的微信交互方案可以概括为一句话：

> 它不是“直接讲微信协议”，而是“通过 iLink bot HTTP 协议拿到一个微信收发通道，再把这个通道桥接到本地 CLI 会话”。

更具体地说：

1. 二维码不是本地生成登录票据，而是远端服务签发后，本地终端只负责渲染。
2. 微信消息不是 webhook 推送，而是 `getupdates` 长轮询。
3. 回复文本依赖 `context_token`。
4. 附件发送是“申请上传参数 -> AES-128-ECB 加密上传 CDN -> `sendmessage` 发送媒体描述”三段式。
5. 所谓“回调”主要发生在本地 bridge 与 companion/Claude hook 之间，不发生在微信服务器到本机之间。

---

如果后续要把这份分析进一步转成设计文档，我建议下一步拆成两份：

1. `协议抽象文档`
   专门定义 `getupdates` / `sendmessage` / `getuploadurl` 的请求响应模型
2. `运行时架构文档`
   专门描述 bridge、companion、adapter、approval、workspace 状态机
