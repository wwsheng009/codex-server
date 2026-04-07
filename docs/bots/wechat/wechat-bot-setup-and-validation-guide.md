# WeChat Bot 配置与验收指南

## 1. 目标

本文档面向需要实际落地使用 `WeChat Bot` 的开发者或运维人员，说明如何：

1. 准备 WeChat 凭据
2. 创建 WeChat Bot 连接
3. 做基础连通性验证
4. 验证 thread 绑定与审批链路
5. 排查常见故障

如果你需要了解功能边界和实现原理，先看：

- [wechat-bot-functional-overview.md](./wechat-bot-functional-overview.md)

## 2. 适用前提

开始之前，建议确认以下条件：

1. 后端服务已经启动，并可访问 `/api/...` 路由
2. 已存在可用的 workspace
3. WeChat/iLink 基础地址可从当前后端访问
4. 如果要验证审批链路，目标 workspace 不应运行在“完全无审批”的默认执行策略下

第 4 点很重要。当前 bot 审批验证依赖 runtime 真实产生 `pending approval`。如果 workspace 默认执行环境已经是：

- `approval_policy = never`
- `sandbox_mode = danger-full-access`

那么很多需要审批的动作都不会再弹审批，微信里自然也看不到 `/approvals` 对应的待处理项。

如果你要验收审批链路，优先使用更保守的运行策略，例如：

- `approval_policy = on-request`
- `sandbox_mode = workspace-write`

## 3. 选择接入方式

当前 WeChat Bot 支持三种凭据来源：

1. 二维码登录会话
2. 已保存 WeChat 账号
3. 手工填写 `bot_token + account_id + owner_user_id`

推荐顺序如下：

1. 二维码登录
2. 已保存账号
3. 手工填写

原因很直接：

- 二维码登录最接近真实接入流程
- 已保存账号最适合复用
- 手工填写最适合调试或迁移已有凭据

## 4. 凭据准备

### 4.1 方式 A: 二维码登录

当前后端为 WeChat 登录提供独立的登录会话 API。

#### 4.1.1 发起登录

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-providers/wechat/login/start" ^
  -H "Content-Type: application/json" ^
  -d "{\"baseUrl\":\"https://wechat.example.com\"}"
```

预期返回：

1. `loginId`
2. `status`
3. `qrCodeContent`
4. `expiresAt`

其中 `qrCodeContent` 可用于前端展示二维码。

#### 4.1.2 轮询登录状态

```bash
curl "http://localhost:8080/api/workspaces/<workspaceId>/bot-providers/wechat/login/<loginId>"
```

当状态变为 `confirmed` 后，返回中应包含：

1. `baseUrl`
2. `accountId`
3. `userId`
4. `botToken`
5. `credentialReady = true`

当前实现会在 `GetWeChatLogin()` 时自动把确认成功的账号写入 workspace 级 `WeChatAccount` 账号库，后续可直接复用。

#### 4.1.3 删除未再需要的登录会话

```bash
curl -X DELETE "http://localhost:8080/api/workspaces/<workspaceId>/bot-providers/wechat/login/<loginId>"
```

### 4.2 方式 B: 复用已保存账号

列出当前 workspace 已保存的 WeChat 账号：

```bash
curl "http://localhost:8080/api/workspaces/<workspaceId>/bot-providers/wechat/accounts"
```

如果要补充备注信息，使用：

```bash
curl -X PATCH "http://localhost:8080/api/workspaces/<workspaceId>/bot-providers/wechat/accounts/<accountId>" ^
  -H "Content-Type: application/json" ^
  -d "{\"alias\":\"Support Queue\",\"note\":\"生产客服账号\"}"
```

### 4.3 方式 C: 手工填写凭据

手工方式至少要准备：

1. `wechat_base_url`
2. `wechat_account_id`
3. `wechat_owner_user_id`
4. `bot_token`

适合：

1. 已知可用凭据从别处迁移过来
2. 调试登录流程以外的问题

## 5. 创建 WeChat Bot 连接

### 5.1 推荐默认值

如果你只是要先把 WeChat Bot 跑起来，建议使用下面这组默认值：

- `provider = wechat`
- `aiBackend = workspace_thread`
- `aiConfig.model = gpt-5.4`
- `aiConfig.permission_preset = default`
- `aiConfig.reasoning_effort = medium`
- `aiConfig.collaboration_mode = default`
- `settings.wechat_delivery_mode = polling`
- `settings.runtime_mode = normal`
- `settings.command_output_mode = brief`
- `settings.wechat_channel_timing = disabled`

说明：

- `workspace_thread` 更适合验证 thread 管理、审批和 bot 可见 turn 输出
- `permission_preset = default` 更容易保留 runtime 的审批行为
- `command_output_mode = brief` 适合作为日常 bot 输出默认值

### 5.2 方式 A: 用二维码登录会话创建连接

当 `loginId` 已经确认成功后，可直接创建连接：

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections" ^
  -H "Content-Type: application/json" ^
  -d "{
    \"provider\": \"wechat\",
    \"name\": \"WeChat Support\",
    \"aiBackend\": \"workspace_thread\",
    \"aiConfig\": {
      \"model\": \"gpt-5.4\",
      \"permission_preset\": \"default\",
      \"reasoning_effort\": \"medium\",
      \"collaboration_mode\": \"default\"
    },
    \"settings\": {
      \"wechat_delivery_mode\": \"polling\",
      \"wechat_login_session_id\": \"<loginId>\",
      \"runtime_mode\": \"normal\",
      \"command_output_mode\": \"brief\",
      \"wechat_channel_timing\": \"disabled\"
    },
    \"secrets\": {}
  }"
```

当前后端会在创建时自动把：

- `wechat_login_session_id`

解析为真实连接配置：

- `wechat_base_url`
- `wechat_account_id`
- `wechat_owner_user_id`
- `bot_token`

### 5.3 方式 B: 用已保存账号创建连接

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections" ^
  -H "Content-Type: application/json" ^
  -d "{
    \"provider\": \"wechat\",
    \"name\": \"WeChat Saved Account Bot\",
    \"aiBackend\": \"workspace_thread\",
    \"aiConfig\": {
      \"model\": \"gpt-5.4\",
      \"permission_preset\": \"default\",
      \"reasoning_effort\": \"medium\",
      \"collaboration_mode\": \"default\"
    },
    \"settings\": {
      \"wechat_delivery_mode\": \"polling\",
      \"wechat_saved_account_id\": \"<savedAccountId>\",
      \"runtime_mode\": \"normal\",
      \"command_output_mode\": \"brief\",
      \"wechat_channel_timing\": \"disabled\"
    },
    \"secrets\": {}
  }"
```

### 5.4 方式 C: 手工凭据创建连接

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections" ^
  -H "Content-Type: application/json" ^
  -d "{
    \"provider\": \"wechat\",
    \"name\": \"WeChat Manual Bot\",
    \"aiBackend\": \"workspace_thread\",
    \"aiConfig\": {
      \"model\": \"gpt-5.4\",
      \"permission_preset\": \"default\",
      \"reasoning_effort\": \"medium\",
      \"collaboration_mode\": \"default\"
    },
    \"settings\": {
      \"wechat_delivery_mode\": \"polling\",
      \"wechat_base_url\": \"https://wechat.example.com\",
      \"wechat_account_id\": \"account-1\",
      \"wechat_owner_user_id\": \"owner-1\",
      \"runtime_mode\": \"normal\",
      \"command_output_mode\": \"brief\",
      \"wechat_channel_timing\": \"disabled\"
    },
    \"secrets\": {
      \"bot_token\": \"token-1\"
    }
  }"
```

### 5.5 如果用前端 UI 创建

当前项目的 Bots 页面已经具备 WeChat 相关表单能力。推荐填写顺序：

1. Provider 选 `WeChat`
2. 选择凭据来源：
   - `QR`
   - `Saved`
   - `Manual`
3. AI backend 选 `Workspace Thread`
4. Model 先用 `gpt-5.4`
5. Permission preset 用 `default`
6. Runtime mode 先用 `normal`
7. Command output mode 先用 `brief`
8. WeChat channel timing 先关掉，调试链路时再开启

## 6. 基础连通性验证

连接创建成功后，先不要急着验证审批，先做最小闭环。

### 6.1 看连接状态

```bash
curl "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections/<connectionId>"
```

关注字段：

1. `status`
2. `lastError`
3. `lastPollAt`
4. `lastPollStatus`
5. `lastPollMessage`

### 6.2 检查连接日志

```bash
curl "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections/<connectionId>/logs"
```

如果 polling 正常，应该能看到周期性拉取与处理日志。

### 6.3 微信里执行 `/echo`

向该 WeChat Bot 发送：

```text
/echo hello
```

预期结果：

1. 机器人回显 `hello`
2. 附带一段 `Channel timing`

如果这一步都失败，优先不要继续做审批验证。

### 6.4 微信里执行 `/thread`

发送：

```text
/thread
```

预期结果：

1. 返回当前绑定 thread 信息
2. 如果尚未绑定 thread，会返回如何开始新 thread 的提示

### 6.5 新建 thread

发送：

```text
/newthread WeChat Smoke Test
```

预期结果：

1. 当前会话绑定到新的 workspace thread
2. 后续普通消息将进入这个新 thread

### 6.6 查看 conversation 绑定情况

```bash
curl "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections/<connectionId>/conversations"
```

重点确认：

1. conversation 已创建
2. `threadId` 已绑定
3. `lastInboundText` / `lastOutboundText` 在更新

## 7. 审批链路验收

### 7.1 前提条件

要验证审批链路，请先确认：

1. 连接的 `aiBackend = workspace_thread`
2. `aiConfig.permission_preset = default`
3. workspace 默认执行策略不是完全无审批模式

如果你使用的是 `openai_responses`，或者 runtime 默认已经是完全开放执行模式，那么微信里大概率看不到审批请求。

### 7.2 触发一个可能产生审批的请求

向微信 bot 发送一条会让 runtime 需要额外授权的请求，例如：

```text
请查看当前工作区根目录有哪些文件，并把结果回复给我。
```

或者：

```text
请在 docs 目录下创建一个 tmp-wechat-validation.txt 文件，并写入 hello。
```

注意：

1. 是否真的产生审批，取决于当前 workspace 的运行策略和模型执行路径
2. 如果当前环境已经允许这类操作直接执行，就不会出现审批

### 7.3 在微信里查看待审批项

如果 thread 被审批阻塞，WeChat 侧通常会收到 pending request 的文本提示。你也可以主动发送：

```text
/approvals
```

预期结果：

1. 返回 `Pending approvals:`
2. 包含 `request_id`
3. 包含对应操作提示，例如：
   - `/approve <request_id>`
   - `/decline <request_id>`
   - `/cancel <request_id>`
   - `/answer <request_id> <text>`

### 7.4 用微信命令完成审批

#### 7.4.1 普通批准

```text
/approve <request_id>
```

#### 7.4.2 回答输入型审批

单问题：

```text
/answer <request_id> production
```

多问题：

```text
/answer <request_id> environment=production; region=cn
```

#### 7.4.3 拒绝或取消

```text
/decline <request_id>
/cancel <request_id>
```

### 7.5 审批后的预期结果

审批命令处理成功后，微信里应先收到一条确认消息，例如：

1. `Approval request <request_id> was approved.`
2. 带审批摘要
3. 提示等待中的 thread 应继续运行

随后，原本因为审批阻塞的 thread 应继续执行，并把后续 bot 可见结果发回微信。

### 7.6 用 API 交叉验证审批状态

如果你想同时从后端确认状态，可以用：

列出当前 workspace 的待审批：

```bash
curl "http://localhost:8080/api/workspaces/<workspaceId>/pending-approvals"
```

如果你想直接通过 API 响应审批：

```bash
curl -X POST "http://localhost:8080/api/server-requests/<requestId>/respond" ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"accept\"}"
```

输入型审批示例：

```bash
curl -X POST "http://localhost:8080/api/server-requests/<requestId>/respond" ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"accept\",\"answers\":{\"environment\":[\"production\"]}}"
```

说明：

- 这条 API 是调试和兜底手段
- 如果你的目标是验证 WeChat 审批链路，优先还是从微信侧使用 `/approve` 或 `/answer`

## 8. 常用运维操作

### 8.1 暂停连接

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections/<connectionId>/pause"
```

### 8.2 恢复连接

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections/<connectionId>/resume" ^
  -H "Content-Type: application/json" ^
  -d "{}"
```

### 8.3 打开调试模式

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections/<connectionId>/runtime-mode" ^
  -H "Content-Type: application/json" ^
  -d "{\"runtimeMode\":\"debug\"}"
```

或者直接在微信里发送：

```text
/toggle-debug
```

### 8.4 打开微信链路耗时输出

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections/<connectionId>/wechat-channel-timing" ^
  -H "Content-Type: application/json" ^
  -d "{\"enabled\":true}"
```

### 8.5 调整命令输出模式

```bash
curl -X POST "http://localhost:8080/api/workspaces/<workspaceId>/bot-connections/<connectionId>/command-output-mode" ^
  -H "Content-Type: application/json" ^
  -d "{\"commandOutputMode\":\"brief\"}"
```

可选值：

- `none`
- `single_line`
- `brief`
- `detailed`
- `full`

推荐：

- 日常使用: `brief`
- 排查问题: `detailed` 或 `full`

## 9. 常见问题排查

### 9.1 `/echo` 没有回复

优先检查：

1. 连接是否 `active`
2. `lastPollStatus` 是否异常
3. 连接日志里是否有上游请求错误
4. 该会话是否已经成功写入 `wechat_context_token`

如果 conversation 没有拿到 `context_token`，provider 无法回消息。

### 9.2 轮询正常，但回复时报错

重点排查：

1. `wechat_base_url`
2. `bot_token`
3. `wechat_account_id`
4. `conversation.ProviderState[wechat_context_token]`

### 9.3 出现 `errcode = -14`

这通常表示微信上游会话失效或短期不可用。当前 provider 会临时暂停该连接一段时间。

建议动作：

1. 查看连接日志
2. 等待自动恢复
3. 如持续出现，重新做二维码登录并重建或更新连接

### 9.4 看不到审批

先排查下面几项：

1. `aiBackend` 是否为 `workspace_thread`
2. `permission_preset` 是否使用 `default`
3. workspace 默认执行策略是否已经是完全开放模式
4. 当前用户消息是否真的触发了需要审批的操作

### 9.5 `/approvals` 为空，但你认为 thread 正在等待

要区分两种情况：

1. thread 真的在等 runtime 审批
2. thread 是因为别的原因卡住，例如运行错误、上游超时、最终回复缺失

如果需要，先查看：

1. bot connection logs
2. workspace thread 状态
3. `/api/workspaces/<workspaceId>/pending-approvals`

### 9.6 微信里使用引用命令失败

当前实现会去掉 `Quoted:` 前缀后再识别命令。若仍失败，重点检查：

1. 引用文本前后是否夹杂了额外内容
2. 实际命令是否是首个可识别命令行
3. 是否把 `/approve` 写成了不支持的格式

## 10. 建议的验收顺序

如果你是第一次部署 WeChat Bot，建议按这个顺序验收：

1. 创建并确认二维码登录会话
2. 创建 WeChat Bot 连接
3. 看连接状态和 polling 日志
4. 微信中发送 `/echo hello`
5. 微信中执行 `/newthread WeChat Validation`
6. 发一条普通消息，确认 bot 正常回复
7. 发一条可能触发审批的消息
8. 微信中执行 `/approvals`
9. 用 `/approve` 或 `/answer` 完成审批
10. 确认被阻塞的 thread 继续输出结果

## 11. 备注

本文档中的 `curl` 示例假定服务直接暴露在 `http://localhost:8080`，未包含额外的认证、反向代理前缀或网关头。

如果你的部署环境有 API 网关、鉴权中间件或不同端口，请按实际环境调整。
