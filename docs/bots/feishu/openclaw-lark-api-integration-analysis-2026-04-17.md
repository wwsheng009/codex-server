# `@larksuite/openclaw-lark` API 能力分析与 `codex-server` 集成建议

更新时间：2026-04-17

适用项目：

- `E:\projects\ai\codex-server`

关联资料：

- npm 包：`@larksuite/openclaw-lark@2026.4.8`
- 当前项目：
  - `docs/bots/bot-connection-and-provider-reference.md`
  - `docs/bots/feishu/feishu-bot-provider-implementation-plan.md`
  - `backend/internal/catalog/service.go`
  - `backend/internal/api/router.go`

---

## 1. 结论

`@larksuite/openclaw-lark` 提供的不是单一 Feishu Bot SDK，而是一整套面向 Agent 的 Feishu 工具体系，覆盖：

- Messenger
- Docs / Wiki / Drive
- Base
- Sheets
- Calendar
- Tasks

对当前项目而言，这个包最有价值的部分是：

1. **工具面完整**
2. **参数语义成熟**
3. **权限映射已经整理**
4. **适合 Agent 调用**

但它**不适合直接作为本项目插件安装使用**，原因是它依赖 `openclaw/plugin-sdk` 和 OpenClaw runtime，而当前项目的运行时是：

- Go 后端
- React 前端
- `codex app-server` 桥接

因此，本项目最合理的接法不是“直接接入这个包作为插件”，而是：

- **保留现有 Go Feishu Bot Provider**
- **新增一层 Feishu 工具服务**
- **把 Docs / Base / Sheets / Calendar / Tasks 作为线程内 Agent 可调用能力接入**

---

## 2. 分析范围

本次分析覆盖两部分：

| 分析对象 | 范围 | 结论 |
| --- | --- | --- |
| `@larksuite/openclaw-lark` | 包结构、导出接口、工具名称、权限模型、MCP 相关调用方式 | 能力非常完整，但运行时与当前项目不一致 |
| `codex-server` | 现有 Feishu bot 通道、插件 / MCP 管理能力、线程工作流与通知体系 | 已具备承接 Feishu 工具层的基础设施 |

---

## 3. 包概况

### 3.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 包名 | `@larksuite/openclaw-lark` |
| 版本 | `2026.4.8` |
| Node 要求 | `>=22` |
| peer dependency | `openclaw >= 2026.3.22` |
| 插件清单 | `openclaw.plugin.json` |
| 主运行时依赖 | `openclaw/plugin-sdk` |
| 配套工具安装器 | `bin/openclaw-lark.js` |

### 3.2 包内结构摘要

| 目录 / 文件 | 作用 |
| --- | --- |
| `src/channel/` | Feishu channel runtime、账号解析、目录、onboarding、监控 |
| `src/messaging/` | 入站解析、出站发送、资源处理、mention、reaction |
| `src/card/` | interactive card、streaming card、tool-use 展示 |
| `src/tools/oapi/` | Feishu OpenAPI 工具集合 |
| `src/tools/mcp/` | 文档类 MCP 工具封装 |
| `skills/` | 面向 Agent 的使用说明，覆盖 bitable / calendar / docs / task / IM |

### 3.3 运行时特征

| 项目 | 说明 |
| --- | --- |
| 通道模型 | `feishu` channel plugin |
| 工具调用模型 | `api.registerTool(...)` |
| 鉴权模式 | 同时包含 app scope、user scope、UAT、OAuth 批量授权 |
| 消息能力 | bot 身份发送 + 用户身份读取 / 搜索 / 下载 |
| 文档能力 | 一部分工具直接走 SDK，一部分通过 Feishu MCP 网关调用 |

---

## 4. 工具总览

基于包内源码可见的工具名，当前可识别的 Feishu 工具共 **37** 个。

### 4.1 Messenger / Chat / Directory

| 工具名 | 主要能力 | 典型动作 |
| --- | --- | --- |
| `feishu_im_user_message` | 以用户身份发送消息、回复消息 | `send`、`reply` |
| `feishu_im_user_get_messages` | 读取单聊 / 群聊历史消息 | 会话消息读取 |
| `feishu_im_user_get_thread_messages` | 读取话题消息 | thread 消息读取 |
| `feishu_im_user_search_messages` | 跨会话搜索消息 | 搜索 |
| `feishu_im_user_fetch_resource` | 下载 IM 消息内文件 / 图片资源 | 下载 |
| `feishu_im_bot_image` | 以 bot 身份下载消息资源 | 下载 |
| `feishu_chat` | 搜索群聊、获取群信息 | `search`、`get` |
| `feishu_chat_members` | 列出群成员 | 默认查询 |
| `feishu_get_user` | 获取用户信息 | 当前用户 / 指定用户 |
| `feishu_search_user` | 搜索员工 | 搜索 |

### 4.2 Docs / Wiki / Drive

| 工具名 | 主要能力 | 典型动作 |
| --- | --- | --- |
| `feishu_create_doc` | 从 Markdown 创建云文档 | 创建 |
| `feishu_fetch_doc` | 获取云文档 Markdown 内容 | 获取 |
| `feishu_update_doc` | 更新云文档内容 | `overwrite`、`append`、`replace_range` 等 |
| `feishu_search_doc_wiki` | 搜索文档与知识库 | 搜索 |
| `feishu_drive_file` | Drive 文件管理 | `list`、`get_meta`、`copy`、`move`、`delete`、`upload`、`download` |
| `feishu_doc_comments` | 文档评论管理 | `list`、`create`、`reply`、`patch` |
| `feishu_doc_media` | 文档媒体插入与下载 | `insert`、`download` |
| `feishu_wiki_space` | 知识库空间管理 | `list`、`get`、`create` |
| `feishu_wiki_space_node` | 知识库节点管理 | `list`、`get`、`create`、`move`、`copy` |

### 4.3 Base

| 工具名 | 主要能力 | 典型动作 |
| --- | --- | --- |
| `feishu_bitable_app` | Base 应用管理 | `create`、`get`、`list`、`patch`、`copy` |
| `feishu_bitable_app_table` | 数据表管理 | `create`、`list`、`patch`、`batch_create` |
| `feishu_bitable_app_table_field` | 字段管理 | `create`、`list`、`update`、`delete` |
| `feishu_bitable_app_table_record` | 记录管理 | `create`、`list`、`update`、`delete`、`batch_create`、`batch_update`、`batch_delete` |
| `feishu_bitable_app_table_view` | 视图管理 | `create`、`get`、`list`、`patch` |

### 4.4 Sheets

| 工具名 | 主要能力 | 典型动作 |
| --- | --- | --- |
| `feishu_sheet` | 电子表格统一工具 | `info`、`read`、`write`、`append`、`find`、`create`、`export` |

### 4.5 Calendar

| 工具名 | 主要能力 | 典型动作 |
| --- | --- | --- |
| `feishu_calendar_calendar` | 日历管理 | `list`、`get`、`primary` |
| `feishu_calendar_event` | 日程管理 | `create`、`list`、`get`、`patch`、`delete`、`search`、`reply` |
| `feishu_calendar_event_attendee` | 参与人管理 | `create`、`list` |
| `feishu_calendar_freebusy` | 忙闲查询 | `list` |

### 4.6 Tasks

| 工具名 | 主要能力 | 典型动作 |
| --- | --- | --- |
| `feishu_task_task` | 任务管理 | `create`、`get`、`list`、`patch` |
| `feishu_task_tasklist` | 任务清单管理 | `create`、`get`、`list`、`tasks`、`patch`、`add_members` |
| `feishu_task_section` | 任务分组管理 | `create`、`get`、`list`、`patch`、`tasks` |
| `feishu_task_subtask` | 子任务管理 | `create`、`list` |
| `feishu_task_comment` | 任务评论管理 | `create`、`list`、`get` |

### 4.7 OAuth / 授权

| 工具名 | 主要能力 | 说明 |
| --- | --- | --- |
| `feishu_oauth` | 用户授权撤销等 | 当前对外主要保留 `revoke` |
| `feishu_oauth_batch_auth` | 批量授权 | 会过滤高敏感 scope |

---

## 5. 权限模型

这个包不仅定义了工具，还整理了对应的 Feishu scope 映射。源码中可见：

- 工具动作总数：**96**
- 高敏感权限：**4**
- 必需应用身份权限：**20**

### 5.1 高价值点

| 能力 | 价值 |
| --- | --- |
| 工具动作到 scope 的显式映射 | 可以直接作为本项目权限清单的初版 |
| 区分 app scope 与 user scope | 适合本项目未来做精细化授权 |
| 高敏感 scope 白名单 | 可直接用于风险控制 |

### 5.2 对本项目的启发

| 项目 | 建议 |
| --- | --- |
| Docs / Sheets / Calendar / Tasks | 都按“工具动作 → 所需 scope”建模 |
| 用户身份工具 | 必须显式区分 bot token 与 user token |
| 敏感写操作 | 单独标记高风险，如删除文档、删除日程、用户身份发消息 |

---

## 6. 当前 `codex-server` 能力基线

### 6.1 已有 Feishu Bot 通道

当前项目已经具备完整 Feishu Provider，包含：

| 能力 | 当前状态 |
| --- | --- |
| webhook 模式 | 已完成 |
| websocket 模式 | 已完成 |
| challenge 响应 | 已完成 |
| 群聊 / 私聊消息接入 | 已完成 |
| 文本与 post 归一化 | 已完成 |
| card 文本发送 | 已完成 |
| 主动发送 | 已完成 |
| thread 绑定回推 | 已完成 |
| 部分媒体入站 / 出站 | 已完成 |

### 6.2 已有平台管理能力

当前项目还具备：

| 能力 | 当前状态 |
| --- | --- |
| 插件列表 | 已有 `plugin/list` 聚合 |
| 插件安装 / 卸载 | 已有 `plugin/install`、`plugin/uninstall` |
| MCP 状态查询 | 已有 `mcp-server-status` |
| MCP reload | 已有 `config/mcp-server/reload` |
| OAuth 登录接口 | 已有 `mcp/oauth/login` |
| 工作区级配置写入 | 已有 `config/read`、`config/write`、`config/batch-write` |

### 6.3 当前缺口

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 缺少 Feishu Docs / Wiki / Drive 工具层 | 线程内工具能力 | 高 | 当前只有 bot 通道，没有文档操作能力 |
| 缺少 Feishu Base 工具层 | 结构化数据操作 | 中 | 当前无法直接操作多维表格 |
| 缺少 Feishu Sheets 工具层 | 表格读写 | 中 | 当前无法把线程结果同步到电子表格 |
| 缺少 Feishu Calendar / Tasks 工具层 | 日程与待办 | 高 | 当前无法把线程结果转成会议或任务 |
| 缺少 Feishu 专用用户授权存储模型 | 用户身份工具 | 高 | 直接复用 OpenClaw 的 OAuth 流程不可行 |

---

## 7. 直接复用方式评估

| 方案 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- |
| 方案1：直接安装 `@larksuite/openclaw-lark` | 能力齐全 | 依赖 `openclaw/plugin-sdk`，与当前 runtime 不兼容 | 不推荐 |
| 方案2：抽取其工具能力，作为独立 Node sidecar / MCP 服务接入 | 与当前架构兼容性最好；复用价值高 | 需要补一层鉴权和配置接入 | 推荐 |
| 方案3：参考其工具语义，在 Go 中原生重写 | 运行时一致；后端统一 | 工作量最大 | 长期演进可考虑 |

**推荐方案：方案2**

推荐原因：

- 本项目已经有 Feishu 通道，不需要再引入第二套通道运行时。
- 当前最缺的是“线程内可调用的 Feishu 工作类 API”。
- 方案2 可以直接复用现有：
  - 插件 / MCP 管理界面
  - 工作区配置体系
  - OAuth 登录接口
  - 线程工具调用链路

---

## 8. 推荐架构

### 8.1 目标结构

```text
Feishu 用户 / 群聊
  -> 现有 Go Feishu Provider
  -> workspace thread / bot notification / thread binding

线程内 Agent
  -> Feishu Tool Gateway（新增）
  -> Feishu OpenAPI / Feishu MCP
  -> Docs / Base / Sheets / Calendar / Tasks
```

### 8.2 职责划分

| 组件 | 职责 |
| --- | --- |
| 现有 `backend/internal/bots/feishu.go` | Feishu bot 入站、回复、主动发送、媒体发送、会话绑定 |
| 新增 Feishu Tool Gateway | 面向线程 Agent 暴露工作类工具 |
| 工作区配置层 | 管理 appId / appSecret / OAuth / MCP endpoint / 允许的工具范围 |
| 线程层 | 把 Feishu 工具作为可调用资源呈现给 Agent |

### 8.3 不建议的做法

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 让 OpenClaw Feishu channel 替换当前 Go Provider | 现有 bot 功能 | 高 | 会和当前会话、通知、thread 绑定模型冲突 |
| 直接照搬其 OAuth 卡片流程 | 鉴权链路 | 高 | 当前项目没有 `LarkTicket` 与 OpenClaw token store |
| 把文档工具和 bot 通道混在一个 provider 中 | 后端设计 | 中 | 会把消息通道与工作类 API 耦合在一起 |

---

## 9. 按能力域的集成建议

### 9.1 Messenger

| 能力 | 当前项目已有情况 | 建议 |
| --- | --- | --- |
| 发送消息 / 回复消息 | 已有 bot provider | 不新增同类线程工具，避免职责重叠 |
| 读取历史消息 | 缺失 | 新增只读工具，供线程查上下文 |
| 搜索消息 | 缺失 | 新增高优先级工具 |
| 下载消息文件 / 图片 | 部分 bot 通道可用 | 补线程工具版本 |
| 搜索群聊 / 群成员 / 用户 | 缺失 | 新增辅助类工具，方便让 Agent 找到目标对象 |

**建议保留：**

- bot 通道继续负责“对话收发”
- 线程工具负责“读历史、搜消息、查人查群、下载附件”

### 9.2 Docs / Wiki / Drive

| 能力 | 当前项目状态 | 建议优先级 |
| --- | --- | --- |
| 创建文档 | 缺失 | 高 |
| 获取文档 Markdown | 缺失 | 高 |
| 更新文档 | 缺失 | 高 |
| 搜索文档 / Wiki | 缺失 | 高 |
| Drive 文件操作 | 缺失 | 中 |
| 评论与媒体插入 | 缺失 | 中 |

这组能力与线程工作流最贴近，适合做：

- 会议纪要生成
- 方案文档更新
- 每日 / 每周报告整理
- 知识库检索与编辑

### 9.3 Base

| 能力 | 当前项目状态 | 建议优先级 |
| --- | --- | --- |
| app / table 管理 | 缺失 | 中 |
| 字段管理 | 缺失 | 中 |
| 记录 CRUD | 缺失 | 高 |
| 批量记录操作 | 缺失 | 高 |
| 视图管理 | 缺失 | 低 |

适合的业务场景：

- 工单系统
- 客户台账
- 发布排期
- 运营数据录入

### 9.4 Sheets

| 能力 | 当前项目状态 | 建议优先级 |
| --- | --- | --- |
| 表格读取 | 缺失 | 中 |
| 表格写入 / 追加 | 缺失 | 中 |
| 查找 | 缺失 | 中 |
| 导出 | 缺失 | 低 |

适合：

- 报表同步
- 轻量结构化写入
- 导出交付物

### 9.5 Calendar

| 能力 | 当前项目状态 | 建议优先级 |
| --- | --- | --- |
| 日历列表 / 主日历 | 缺失 | 中 |
| 创建 / 查询 / 更新 / 删除日程 | 缺失 | 高 |
| 参与人管理 | 缺失 | 高 |
| 忙闲查询 | 缺失 | 高 |

适合：

- 根据对话直接安排会议
- 检查参会人忙闲
- 生成会议邀请

### 9.6 Tasks

| 能力 | 当前项目状态 | 建议优先级 |
| --- | --- | --- |
| 任务创建 / 查询 / 更新 | 缺失 | 高 |
| 清单管理 | 缺失 | 中 |
| 分组 / 子任务 | 缺失 | 中 |
| 评论 | 缺失 | 低 |

适合：

- 把聊天结论转为待办
- 把 thread 结果同步进任务系统

---

## 10. 建议的第一批接入范围

### 10.1 推荐第一批工具

| 工具 | 理由 |
| --- | --- |
| `feishu_search_doc_wiki` | 检索收益最高 |
| `feishu_fetch_doc` | 读取现有文档内容 |
| `feishu_create_doc` | 生成新文档 |
| `feishu_update_doc` | 更新现有文档 |
| `feishu_im_user_search_messages` | 搜索历史消息 |
| `feishu_im_user_get_messages` | 读取聊天上下文 |
| `feishu_im_user_fetch_resource` | 下载历史附件 |
| `feishu_search_user` | 解析员工身份 |
| `feishu_chat` | 搜群聊 |
| `feishu_calendar_freebusy` | 查询忙闲 |
| `feishu_calendar_event` | 创建 / 管理会议 |
| `feishu_task_task` | 创建 / 更新任务 |

### 10.2 第一批暂不包含

| 项目 | 原因 |
| --- | --- |
| `feishu_im_user_message` | 与现有 bot 通道消息发送职责重叠 |
| `feishu_oauth` / `feishu_oauth_batch_auth` | 当前项目需要自己的鉴权桥接实现 |
| 全量 Base 工具 | 字段类型复杂，第二阶段更合适 |
| 全量 Sheets 工具 | 收益高但不如 Docs / Calendar / Tasks 紧迫 |

---

## 11. 本项目中的集成位置建议

### 11.1 后端

| 模块 | 建议变化 |
| --- | --- |
| `backend/internal/catalog/` | 继续承接 MCP / plugin inventory，不改消息通道 |
| `backend/internal/runtime/` | 增加 Feishu tools 服务发现或配置注入 |
| `backend/internal/configfs/` | 增加 Feishu tools 配置写入项 |
| `backend/internal/auth/` | 如果走通用 OAuth，需要增加 Feishu 用户授权信息持久化接口 |
| `backend/internal/bots/` | 不替换现有 Feishu Provider，仅补“线程工具能力说明” |

### 11.2 前端

| 页面 | 建议变化 |
| --- | --- |
| `Settings > Config` | 增加 Feishu tools 的 app config / endpoint config |
| `Settings > MCP` | 展示 Feishu tool gateway 状态 |
| `Bots` 页面 | 不改变现有 connection 模型 |

### 11.3 配置项建议

| 配置项 | 用途 |
| --- | --- |
| `feishu_tools_enabled` | 全局开关 |
| `feishu_app_id` | 应用 ID |
| `feishu_app_secret` | 应用密钥 |
| `feishu_mcp_endpoint` | 文档类 MCP endpoint |
| `feishu_tool_allowlist` | 允许暴露给线程的工具集合 |
| `feishu_oauth_mode` | `app_only` / `user_oauth` |
| `feishu_sensitive_write_guard` | 是否开启敏感写操作保护 |

---

## 12. 鉴权建议

### 12.1 建议区分两类调用

| 调用类型 | 建议凭据 | 场景 |
| --- | --- | --- |
| bot 通道消息收发 | tenant access token / app credentials | 现有 Feishu bot provider |
| 用户工作类工具 | user access token | Docs、Calendar、Tasks、Base 等 |

### 12.2 当前包中的做法

当前包大量工具是通过：

- `client.invoke(..., { as: 'user' })`

来要求用户身份授权；文档 MCP 工具会通过：

- `X-Lark-MCP-UAT`

把用户令牌传给 MCP 网关。

### 12.3 对本项目的建议

| 方案 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- |
| 方案1：沿用本项目通用 `mcp/oauth/login`，增加 Feishu provider 适配 | 复用现有 OAuth 入口 | 仍需补 Feishu 用户 token 存储 | 推荐 |
| 方案2：单独实现 Feishu OAuth 页面与状态存储 | 语义更清晰 | 开发面更大 | 长期可考虑 |

**推荐方案：方案1**

推荐原因：

- 当前项目已经有 OAuth 登录流程。
- 增加 Feishu provider 适配比重做一套页面成本更低。

---

## 13. 风险与约束

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 用户身份写操作权限较高 | 安全 | 高 | 尤其是用户身份发消息、删文档、删日程 |
| `@larksuite/openclaw-lark` 部分文档类工具依赖外部 MCP 网关 | 可部署性 | 中 | 需要明确是否使用 `mcp.feishu.cn` 或自建代理 |
| Base 字段类型复杂 | 工具稳定性 | 中 | 需要字段类型映射与更强校验 |
| 现有 bot 通道与线程工具若职责不清 | 架构一致性 | 中 | 必须严格区分“消息通道”与“工作类工具” |
| OAuth 状态与工作区状态如果未绑定 | 多工作区 | 中 | 需要明确 token 作用域与账号选择策略 |

---

## 14. 分阶段实施建议

### 第一阶段：工具层基础接入

| 项目 | 目标 |
| --- | --- |
| 文档搜索 / 读取 / 创建 / 更新 | 让线程可直接操作 Feishu 文档 |
| 消息搜索 / 历史读取 / 附件下载 | 让线程可读取聊天上下文 |
| 用户 / 群搜索 | 让线程能定位操作对象 |
| Feishu tools 配置项 | 能控制 app config 与工具可见范围 |

### 第二阶段：协作对象接入

| 项目 | 目标 |
| --- | --- |
| Calendar | 忙闲查询、建会、更新会议 |
| Tasks | 创建任务、更新任务、管理清单 |

### 第三阶段：结构化数据能力

| 项目 | 目标 |
| --- | --- |
| Sheets | 表格读写、导出 |
| Base | 记录 CRUD、批量同步 |

### 第四阶段：安全与治理增强

| 项目 | 目标 |
| --- | --- |
| 敏感写操作保护 | 明确高风险动作提示 |
| scope 诊断 | 展示缺失权限与修复建议 |
| 审计记录 | 记录线程内 Feishu 工具调用历史 |

---

## 15. 建议的验收标准

| 验收项 | 判定标准 |
| --- | --- |
| 文档工具可用 | 线程中能搜索、读取、创建、更新 Feishu 文档 |
| 消息读取可用 | 线程中能读取群聊 / 单聊历史、搜索消息、下载附件 |
| Calendar 可用 | 线程中能查询忙闲并创建日程 |
| Tasks 可用 | 线程中能创建和更新任务 |
| 权限提示清晰 | 缺 scope 时能明确提示所缺权限 |
| Bot 通道不受影响 | 现有 Feishu connection、主动发送、thread 绑定保持正常 |

---

## 16. 最终建议

### 16.1 架构建议

| 建议 | 原因 |
| --- | --- |
| 保留当前 Go Feishu Provider | 它已经适配本项目的 bot、conversation、thread binding、notification 模型 |
| 把 `@larksuite/openclaw-lark` 视作“工具能力参考源” | 其真正价值在工具设计、权限模型、参数语义 |
| 以 MCP / Node sidecar 方式引入 Feishu 工作类 API | 与当前项目最兼容 |

### 16.2 实施建议

| 建议 | 原因 |
| --- | --- |
| 第一批先做 Docs / 消息检索 / Calendar / Tasks | 使用频率最高，收益最直接 |
| 第二批再做 Sheets / Base | 复杂度更高，适合在工具基础稳定后处理 |
| OAuth 优先复用现有 MCP OAuth 入口 | 成本更低，便于与现有设置页整合 |

---

## 17. 参考依据

### 17.1 `@larksuite/openclaw-lark` 包内依据

| 位置 | 用途 |
| --- | --- |
| `index.d.ts` / `index.js` | 顶层导出与插件入口 |
| `openclaw.plugin.json` | 插件清单 |
| `src/channel/plugin.js` | channel 定义与能力声明 |
| `src/core/tool-scopes.js` | 工具动作与 scope 映射 |
| `src/tools/oapi/` | OpenAPI 工具实现 |
| `src/tools/mcp/shared.js` | 文档类 MCP 调用方式 |
| `src/core/config-schema.js` | 配置模型 |

### 17.2 当前项目依据

| 位置 | 用途 |
| --- | --- |
| `docs/bots/bot-connection-and-provider-reference.md` | bot 架构与现有 Feishu / QQ Bot 状态 |
| `docs/bots/feishu/feishu-bot-provider-implementation-plan.md` | Feishu 通道现状 |
| `backend/internal/catalog/service.go` | 插件、MCP、应用、技能目录能力 |
| `backend/internal/api/router.go` | `plugins/*`、`mcp-server-status`、`mcp/oauth/login` 等接口 |

