# Feishu 当前集成说明与使用指南

更新时间：2026-04-18

适用项目：

- `E:\projects\ai\codex-server`

关联代码：

- `backend/internal/bots/feishu.go`
- `backend/internal/bots/service.go`
- `backend/internal/feishutools/`
- `backend/internal/api/router.go`
- `backend/internal/servercmd/run.go`
- `frontend/src/pages/settings/FeishuToolsSettingsPage.tsx`
- `frontend/src/features/settings/api.ts`

---

## 1. 结论

当前项目中的 Feishu 集成不是单一模块，而是两条并行的能力线：

1. **Feishu Bot Provider**
2. **Feishu Tools Service**

两者都接入了同一个后端，但职责完全不同：

| 集成线 | 主要职责 | 典型场景 |
| --- | --- | --- |
| Feishu Bot Provider | 接收飞书消息、建立 bot webhook / websocket 通道、把消息送进线程、把回复发回飞书 | 用户在飞书里直接和 bot 对话 |
| Feishu Tools Service | 以工作区级工具服务形式调用 Feishu OpenAPI，并负责把受管 Feishu MCP server 同步进工作区 runtime | 文档读写、消息检索、日程、任务、表格、Base、Wiki |

这意味着：

- **机器人链路**负责“消息通道”
- **工具链路**负责“工作类 API 能力”

两者可以使用同一个飞书应用的 `App ID / App Secret`，但当前实现里**不是同一份配置存储**，不会自动同步。

从 `2026-04-18` 这版代码开始，Feishu tools 在保存配置时还会额外做一件事：

- 自动管理工作区 `mcpServers.feishu-tools`
- 实际写入的是工作区 `.codex/config.toml` 中的 `mcpServers.feishu-tools`
- 自动触发 `config/mcp-server/reload`
- 让 thread 直接通过这个受管 MCP server 发现 Feishu 工具
- 让 bot 通过“绑定到的 thread”继承同一套 Feishu 工具能力

---

## 2. 总体架构

### 2.1 后端注册关系

在启动阶段，后端会同时初始化 bot 服务和 Feishu tools 服务：

- `backend/internal/servercmd/run.go`
  - 创建 `bots.Service`
  - 创建 `feishutools.Service`
  - 对 `feishutools.Service` 调用 `SetPublicBaseURL(...)`
  - 把二者都注入 `api.NewRouter(...)`

### 2.2 API 路由

`backend/internal/api/router.go` 当前已经暴露了完整的 Feishu tools 路由：

| 路由 | 作用 |
| --- | --- |
| `GET /api/workspaces/{workspaceId}/feishu-tools/config` | 读取工作区级 Feishu tools 配置 |
| `POST /api/workspaces/{workspaceId}/feishu-tools/config` | 写入 Feishu tools 配置 |
| `GET /api/workspaces/{workspaceId}/feishu-tools/status` | 读取状态检查 |
| `GET /api/workspaces/{workspaceId}/feishu-tools/capabilities` | 读取工具能力清单 |
| `GET /api/workspaces/{workspaceId}/feishu-tools/permissions` | 读取权限诊断结果 |
| `POST /api/workspaces/{workspaceId}/feishu-tools/oauth/login` | 发起用户 OAuth |
| `GET /api/workspaces/{workspaceId}/feishu-tools/oauth/status` | 查看 OAuth 状态 |
| `POST /api/workspaces/{workspaceId}/feishu-tools/oauth/revoke` | 撤销 OAuth |
| `POST /api/workspaces/{workspaceId}/feishu-tools/invoke` | 调试调用某个 Feishu tool |
| `GET /api/feishu-tools/oauth/callback` | OAuth 回调入口 |

---

## 3. Feishu Bot Provider

### 3.1 位置与职责

核心实现位于：

- `backend/internal/bots/feishu.go`

由 `backend/internal/bots/service.go` 注册 provider：

- provider 名称：`feishu`

### 3.2 当前能力

Bot provider 负责的不是文档、任务或日程工具，而是飞书消息通道本身，包括：

- 激活飞书 bot 连接
- 用 `App ID / App Secret` 换取 tenant token
- 拉取 bot 信息
- 建立 webhook 或 websocket 投递模式
- 解析飞书入站消息
- 下载消息里的图片、文件、音频等资源
- 将线程回复回发到飞书

### 3.3 配置位置

Bot provider 的飞书配置保存在 **bot connection** 上，而不是工作区 Feishu tools 配置里：

- `connection.Settings["feishu_app_id"]`
- `connection.Secrets["feishu_app_secret"]`

也就是说，bot 配置是“连接级”的。

### 3.4 使用方式

适用场景：

- 用户要在飞书里直接给 bot 发消息
- 项目要从飞书聊天触发线程
- 线程结果需要发回飞书聊天窗口

如果只是要在工作区里调用“读取文档 / 创建任务 / 查日程”等能力，不需要走 bot provider，应该走 Feishu tools。

---

## 4. Feishu Tools Service

### 4.1 位置与职责

核心代码目录：

- `backend/internal/feishutools/`

主要文件分工：

| 文件 | 作用 |
| --- | --- |
| `service.go` | 配置读写、状态、能力清单、权限诊断 |
| `oauth.go` | Feishu 用户 OAuth 流程 |
| `gateway.go` | tenant token / user token / OpenAPI 请求网关 |
| `invoke.go` | 工具统一分发入口 |
| `data.go` | 工具注册表、能力分类、scope 映射、敏感 scope |
| `docs.go` | Docs / 搜索文档 |
| `messenger.go` | 消息检索、线程读取、用户发消息 |
| `directory.go` | 用户、群、群成员 |
| `calendar.go` | Calendar / Event / Attendee |
| `tasks.go` | Task / Tasklist / Section / Subtask / Comment |
| `sheets.go` | Sheets |
| `bitable.go` | Base |
| `drive.go` | Drive / 文档评论 / 文档媒体 |
| `wiki.go` | Wiki Space / Wiki Node |

### 4.2 配置模型

Feishu tools 使用的是**工作区级配置**，当前关键字段包括：

| 配置键 | 说明 |
| --- | --- |
| `feishu_tools_enabled` | 是否启用 Feishu tools |
| `feishu_app_id` | Feishu App ID |
| `feishu_app_secret` | Feishu App Secret |
| `feishu_mcp_endpoint` | 可选的 MCP endpoint 覆盖值；留空时由 codex-server 自动生成内建 Feishu MCP HTTP endpoint |
| `feishu_oauth_mode` | `app_only` 或 `user_oauth` |
| `feishu_sensitive_write_guard` | 是否开启敏感写保护 |
| `feishu_tool_allowlist` | 当前工作区允许暴露的工具名集合 |

这些字段由 `backend/internal/feishutools/service.go` 读取和写入。

### 4.3 OAuth 模型

Feishu tools 同时支持两类身份：

| 身份 | 用途 |
| --- | --- |
| tenant / app 身份 | 适合一部分应用级调用 |
| user OAuth 身份 | 适合消息检索、用户身份写消息、任务、日历、Wiki 等用户域操作 |

OAuth 流程实现于：

- `backend/internal/feishutools/oauth.go`

回调 URL 由 `publicBaseURL` 推导，实际回调入口为：

- `/api/feishu-tools/oauth/callback`

用户 token 会持久化到工作区配置相关字段中，供后续工具调用复用。

### 4.4 工具调度方式

所有工具统一走：

- `Service.Invoke(...)`

核心机制：

1. 校验 `toolName`
2. 读取工作区配置
3. 校验是否启用
4. 校验 allowlist
5. 解析 action key
6. 执行 Sensitive Write Guard
7. 分发到具体实现
8. 返回统一的 `InvokeResult`

因此前端调试页和后续线程内调用都可以复用同一个调用模型。

---

## 5. 当前已集成的工具能力

### 5.1 Docs / Wiki / Drive

当前已落地：

- `feishu_search_doc_wiki`
- `feishu_fetch_doc`
- `feishu_create_doc`
- `feishu_update_doc`
- `feishu_drive_file`
- `feishu_doc_comments`
- `feishu_doc_media`
- `feishu_wiki_space`
- `feishu_wiki_space_node`

适用场景：

- 搜索文档和知识库
- 读取 / 创建 / 更新文档
- 上传下载 Drive 文件
- 处理评论与媒体
- 管理 Wiki 空间和节点

### 5.2 Messenger / Directory

当前已落地：

- `feishu_im_user_search_messages`
- `feishu_im_user_get_messages`
- `feishu_im_user_get_thread_messages`
- `feishu_im_user_fetch_resource`
- `feishu_im_user_message`
- `feishu_search_user`
- `feishu_get_user`
- `feishu_chat`
- `feishu_chat_members`

适用场景：

- 搜索历史消息
- 读取会话或 thread 回复
- 下载附件
- 以用户身份发送 / 回复 IM 消息
- 搜索用户、群聊、群成员

### 5.3 Calendar / Tasks

当前已落地：

- `feishu_calendar_freebusy`
- `feishu_calendar_calendar`
- `feishu_calendar_event`
- `feishu_calendar_event_attendee`
- `feishu_task_task`
- `feishu_task_tasklist`
- `feishu_task_section`
- `feishu_task_subtask`
- `feishu_task_comment`

Calendar 里当前已支持：

- `create`
- `list`
- `get`
- `patch`
- `delete`
- `search`
- `reply`
- `instances`
- `instance_view`

### 5.4 Sheets / Base

当前已落地：

- `feishu_sheet`
- `feishu_bitable_app`
- `feishu_bitable_app_table`
- `feishu_bitable_app_table_field`
- `feishu_bitable_app_table_record`
- `feishu_bitable_app_table_view`

---

## 6. 前端接入情况

### 6.1 设置页入口

当前前端已经有专门的 Feishu Tools 设置页：

- `frontend/src/pages/settings/FeishuToolsSettingsPage.tsx`

路由位置：

- `/settings/feishu-tools`

### 6.2 前端已具备的能力

设置页当前已支持：

- 保存工作区级配置
- 保存后自动同步受管 `mcpServers.feishu-tools` 到工作区 `.codex/config.toml`
- 保存后自动触发 MCP reload
- 查看 readiness / status
- 查看 capability 分类
- 查看 permission 诊断结果
- 发起 OAuth
- 查看 OAuth 当前状态
- 撤销 OAuth
- 通过 debug 面板直接调用某个 Feishu tool

对应前端 API 封装位于：

- `frontend/src/features/settings/api.ts`

---

## 7. 如何使用这些能力

### 7.1 使用 Feishu Bot Provider

适用前提：

- 你要让飞书聊天直接成为本项目的消息入口

操作路径：

1. 创建 / 编辑一个 Feishu bot connection
2. 填入 bot connection 自己的 `feishu_app_id` / `feishu_app_secret`
3. 选择 webhook 或 websocket 投递模式
4. 激活连接
5. 在飞书端配置对应事件订阅或 websocket 能力

使用结果：

- 用户在飞书里的消息会进入绑定线程
- 线程回复会回到飞书

### 7.2 使用 Feishu Tools

适用前提：

- 你要在工作区里调用 Feishu OpenAPI 工具能力

操作路径：

1. 打开 `/settings/feishu-tools`
2. 开启 `Enable Feishu tools`
3. 填入 `App ID` 和 `App Secret`
4. 配置 `MCP Endpoint`
5. 选择 `OAuth mode`
6. 根据需要设置 `Tool allowlist`
7. 点击 `Start Feishu OAuth`
8. 完成用户授权
9. 点击保存后，后端会把 `mcpServers.feishu-tools` 同步到工作区 `.codex/config.toml`，并自动触发 MCP reload
10. 在 thread 页面或 bot 绑定 thread 中使用 Feishu MCP tools
11. 在调试区用 `Invoke tool (debug)` 验证后端直调能力

### 7.3 通过 API 使用 Feishu Tools

如果要从前端外部或脚本调用，可以直接走后端 API。

典型步骤：

1. 先配置工作区 Feishu tools
2. 发起 OAuth
3. 查看 `permissions`
4. 调用 `invoke`

如果目标是让 thread / bot 真正可见 Feishu 工具，除了保存 Feishu tools 配置本身，还要确认：

1. `status.runtimeIntegration.status = configured`
2. `status.runtimeIntegration.serverName = feishu-tools`
3. `mcp-server-status` 里能看到对应 Feishu server 已加载

示例：读取配置

```http
GET /api/workspaces/{workspaceId}/feishu-tools/config
```

示例：发起 OAuth

```http
POST /api/workspaces/{workspaceId}/feishu-tools/oauth/login
Content-Type: application/json

{
  "scopes": ["docx:document:readonly", "wiki:node:read"]
}
```

示例：调用工具

```http
POST /api/workspaces/{workspaceId}/feishu-tools/invoke
Content-Type: application/json

{
  "toolName": "feishu_fetch_doc",
  "params": {
    "documentId": "doccnxxxxxxxx"
  }
}
```

示例：以用户身份发消息

```http
POST /api/workspaces/{workspaceId}/feishu-tools/invoke
Content-Type: application/json

{
  "toolName": "feishu_im_user_message",
  "action": "send",
  "params": {
    "receiveIdType": "chat_id",
    "receiveId": "oc_xxx",
    "msgType": "text",
    "content": "{\"text\":\"hello\"}"
  }
}
```

---

## 8. 权限与安全

### 8.1 Sensitive Write Guard

当前 Feishu tools 内置了敏感写保护。

典型敏感 scope 包括：

- `im:message.send_as_user`
- `space:document:delete`
- `calendar:calendar.event:delete`
- `base:table:delete`

当 `SensitiveWriteGuard=true` 时，这些高风险动作会在 invoke 前被拦截。

### 8.2 权限诊断

`permissions` 接口当前已经会返回：

- `RequiredScopes`
- `GrantedScopes`
- `MissingScopes`
- `SensitiveScopes`
- 每个 scope 的状态与原因

前端设置页也已经接入了这些结果，可以直接看：

- 哪些权限已授权
- 哪些仍缺失
- 哪些是敏感权限

---

## 9. Feishu Bot 与 Feishu Tools 的关系

### 9.1 相同点

- 都使用飞书开放平台应用
- 都可能需要 `App ID / App Secret`
- 都通过后端统一暴露能力

### 9.2 不同点

| 维度 | Feishu Bot Provider | Feishu Tools |
| --- | --- | --- |
| 配置层级 | bot connection 级 | workspace 级 |
| 主要职责 | 消息通道 | 工作类工具 API |
| 主要入口 | bot connection / webhook / websocket | settings / invoke / OAuth |
| 身份模型 | bot / tenant 为主 | tenant + user OAuth |
| 典型数据流 | 飞书消息进线程、线程回复回飞书 | 工作区直接读写飞书资源 |

### 9.3 当前是否共享密钥

当前实现里：

- **值可以相同**
- **配置存储不是同一份**

即：

- 你可以给 bot connection 和 Feishu tools 填同一个飞书应用的 `App ID / App Secret`
- 但当前不会自动同步
- 在 Feishu tools 配置页保存，不会自动写到 bot connection
- 在 bot connection 里修改，也不会回写工作区 Feishu tools 配置

### 9.4 当前 thread / bot 是怎么拿到 Feishu tools 的

当前实现是：

1. 工作区保存 Feishu tools 配置
2. 如果 `feishu_mcp_endpoint` 为空，后端会生成内建的 Feishu MCP HTTP endpoint；如果配置了值，则作为覆盖地址使用
3. 后端把最终 endpoint 同步成工作区 `.codex/config.toml` 里的受管 `mcpServers.feishu-tools`
4. 后端自动调用 `config/mcp-server/reload`
5. thread runtime 通过这个 MCP server 发现 Feishu tools
6. bot 没有单独的 Feishu tools 执行管线，而是通过绑定的 thread 复用这些工具

也就是说：

- **thread 集成方式**：工作区受管 MCP server
- **bot 集成方式**：继承 thread 的工具面
- **不是**：bot provider 自己直接执行 Feishu tool

---

## 10. 当前建议的使用方式

### 10.1 如果目标是“在飞书里聊天”

使用：

- Feishu Bot Provider

### 10.2 如果目标是“让线程调用飞书资源”

使用：

- Feishu Tools

补充说明：

- 保存设置后要确认 `runtimeIntegration.status = configured`
- 实际 thread 看到的是 `mcpServers.feishu-tools` 暴露出来的工具面

### 10.3 如果目标是“既能聊天，又能调工具”

建议：

1. 同时启用 Feishu Bot Provider 和 Feishu Tools
2. 可以使用同一个飞书应用，也可以拆成两个应用
3. 如果希望权限边界更清晰，建议拆分：
   - 一个应用给 bot 通道
   - 一个应用给 tools / user OAuth

---

## 11. 后续可继续收口的方向

当前实现已经具备实际可用性，但仍有一些可继续增强的点：

- bot connection 复用工作区 Feishu tools 密钥，减少重复录入
- 为内建 MCP adapter 增加更细的审计与观测能力
- 增加工具调用审计
- 对 capability 与 permission 的差异做更直接的前端提示
- 完善大文件上传和更细粒度错误提示

---

## 12. 一句话总结

当前项目中的 Feishu 已经不是“只接了一个 bot”，而是：

- **一条 Feishu Bot 消息通道**
- **一套工作区级 Feishu 工具服务**

如果你要“在飞书里跟 bot 对话”，走 bot provider；
如果你要“让工作区或线程操作飞书文档、消息、日历、任务、表格、Base、Wiki”，走 Feishu tools；
如果你要“让 bot 也能用这些工具”，本质上仍然是先把 Feishu tools 接到 thread，再让 bot 绑定并复用这个 thread。
