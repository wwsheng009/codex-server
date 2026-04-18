# `@larksuite/openclaw-lark` 集成实施清单

更新时间：2026-04-17

适用项目：

- `E:\projects\ai\codex-server`

前置文档：

- `docs/bots/feishu/openclaw-lark-api-integration-analysis-2026-04-17.md`
- `docs/bots/bot-connection-and-provider-reference.md`
- `docs/bots/feishu/feishu-bot-provider-implementation-plan.md`

---

## 1. 结论

本项目接入 `@larksuite/openclaw-lark` 相关能力的实施目标应明确分成两条线：

1. **保留现有 Feishu Bot Provider**
2. **新增 Feishu 工具服务层**

实施顺序建议：

| 阶段 | 范围 | 目标 |
| --- | --- | --- |
| 第一阶段 | Docs / 消息检索 / 用户与群查询 | 先补最常用只读与文档编辑能力 |
| 第二阶段 | Calendar / Tasks | 让线程结果能转成会议和待办 |
| 第三阶段 | Sheets | 补表格读写与导出 |
| 第四阶段 | Base | 补结构化业务数据能力 |
| 第五阶段 | 安全治理 / 审计 / 权限诊断 | 把工具能力纳入长期可维护体系 |

---

## 2. 总体实施原则

| 原则 | 说明 |
| --- | --- |
| 不替换现有 Feishu provider | 继续由 `backend/internal/bots/feishu.go` 负责 bot 消息链路 |
| 工具层与消息通道分离 | 线程工具只负责工作类 API，不负责 bot 收发 |
| 优先接只读和文档编辑 | 风险更低，收益更直接 |
| 用户身份与 bot 身份分离 | bot 消息收发与用户工作类 API 鉴权不能混用 |
| 配置、权限、审计同步建设 | 避免工具可用但不可治理 |

---

## 3. 目标交付物

| 交付物 | 内容 | 优先级 |
| --- | --- | --- |
| Feishu tools 配置模型 | appId、appSecret、endpoint、allowlist、OAuth 模式等 | 高 |
| Feishu tool gateway | 线程可调用的 Feishu 文档、消息检索、日程、任务工具 | 高 |
| 设置页配置入口 | 管理 Feishu tools 配置与状态 | 高 |
| MCP / sidecar 状态展示 | 查看服务是否可用 | 中 |
| 权限诊断与错误提示 | 缺 scope、token 失效、endpoint 异常的明确反馈 | 高 |
| 工具调用审计 | 记录线程内 Feishu 工具调用结果 | 中 |

---

## 4. 模块实施清单

### 4.1 后端配置层

| 项目 | 实施内容 | 输出 |
| --- | --- | --- |
| 配置读取 | 在 `config/read` / `config/write` 体系中增加 Feishu tools 配置字段 | 工作区级配置可持久化 |
| 配置校验 | 校验 `appId`、`appSecret`、`mcpEndpoint`、allowlist、OAuth 模式 | 错误能前置暴露 |
| 配置说明 | 为前端提供字段说明和默认值 | 设置页可直接消费 |

建议新增配置键：

| 配置键 | 用途 |
| --- | --- |
| `feishu_tools_enabled` | 是否启用 Feishu 工具层 |
| `feishu_app_id` | Feishu / Lark App ID |
| `feishu_app_secret` | App Secret |
| `feishu_mcp_endpoint` | 文档类 MCP endpoint |
| `feishu_tool_allowlist` | 允许暴露给线程的工具集合 |
| `feishu_oauth_mode` | `app_only` / `user_oauth` |
| `feishu_sensitive_write_guard` | 是否启用敏感写操作保护 |

### 4.2 工具服务接入层

| 项目 | 实施内容 | 输出 |
| --- | --- | --- |
| Feishu tool gateway | 增加 Feishu 工具服务适配层 | 线程内可调用 |
| 调用封装 | 统一封装文档、消息检索、Calendar、Tasks、Sheets、Base 的调用入口 | 降低上层耦合 |
| 错误映射 | 把上游错误映射成稳定响应 | 前端与线程都能读懂 |
| 能力开关 | 根据 allowlist 控制实际暴露的工具 | 工具可分阶段上线 |

### 4.3 鉴权层

| 项目 | 实施内容 | 输出 |
| --- | --- | --- |
| OAuth 复用 | 复用现有 `mcp/oauth/login` 入口，补 Feishu provider 适配 | 降低新入口数量 |
| 用户 token 存储 | 保存 Feishu 用户身份授权状态 | 线程工具可用 |
| token 状态检查 | 失效、缺 scope、未授权的状态判定 | 调用失败时能给出准确信息 |
| 高敏感操作保护 | 对删除、批量修改、用户身份写消息等动作增加防护 | 降低误操作风险 |

### 4.4 目录与状态查询层

| 项目 | 实施内容 | 输出 |
| --- | --- | --- |
| 服务状态 | 查询 Feishu tool gateway / MCP 服务状态 | 设置页可查看 |
| 能力清单 | 返回当前启用的 Feishu 工具列表 | 前端可展示 |
| 权限诊断 | 返回缺失的 scope 与修复建议 | 运维定位更快 |

### 4.5 前端设置页

| 项目 | 实施内容 | 输出 |
| --- | --- | --- |
| Config 页面 | 增加 Feishu tools 配置区块 | 可直接编辑配置 |
| MCP 页面 | 增加 Feishu 相关状态显示 | 可见运行状态 |
| 错误展示 | 对未授权、缺 scope、endpoint 异常做明确提示 | 提高可用性 |
| i18n | 新增文案全部接入国际化 | 满足前端规范 |

### 4.6 线程工具层

| 项目 | 实施内容 | 输出 |
| --- | --- | --- |
| 工具注册 | 让线程内 Agent 能调用 Feishu 工具 | 能实际使用 |
| 工具分组 | 按 Docs / Messages / Calendar / Tasks / Sheets / Base 分类 | 易于管理 |
| 安全提示 | 对高风险工具加明确提示 | 降低误调用 |

---

## 5. 分阶段工具上线清单

### 5.1 第一阶段：Docs / 消息检索 / 用户与群查询

| 工具 | 范围 | 优先级 | 备注 |
| --- | --- | --- | --- |
| `feishu_search_doc_wiki` | 搜索文档 / Wiki | 高 | 检索入口 |
| `feishu_fetch_doc` | 读取文档 Markdown | 高 | 读现有文档 |
| `feishu_create_doc` | 创建文档 | 高 | 新建文档 |
| `feishu_update_doc` | 更新文档 | 高 | 覆盖 / 追加 / 局部替换 |
| `feishu_im_user_search_messages` | 搜索历史消息 | 高 | 聊天检索 |
| `feishu_im_user_get_messages` | 读取会话消息 | 高 | 获取上下文 |
| `feishu_im_user_get_thread_messages` | 读取 thread 消息 | 中 | 补 thread 上下文 |
| `feishu_im_user_fetch_resource` | 下载附件 | 中 | 图片 / 文件资源 |
| `feishu_search_user` | 搜用户 | 高 | 身份定位 |
| `feishu_get_user` | 获取用户详情 | 中 | 详情补充 |
| `feishu_chat` | 搜索 / 获取群聊 | 高 | 群定位 |
| `feishu_chat_members` | 获取群成员 | 中 | 成员列表 |

### 5.2 第二阶段：Calendar / Tasks

| 工具 | 范围 | 优先级 | 备注 |
| --- | --- | --- | --- |
| `feishu_calendar_freebusy` | 忙闲查询 | 高 | 建会前置 |
| `feishu_calendar_event` | 建会 / 查会 / 更新 / 删除 | 高 | 核心能力 |
| `feishu_calendar_event_attendee` | 参与人管理 | 中 | 细化参会人操作 |
| `feishu_calendar_calendar` | 日历列表 / 主日历 | 中 | 补日历选择 |
| `feishu_task_task` | 任务创建 / 查询 / 更新 | 高 | 核心任务能力 |
| `feishu_task_tasklist` | 任务清单 | 中 | 清单归档 |
| `feishu_task_section` | 分组管理 | 中 | 清单内分组 |
| `feishu_task_subtask` | 子任务 | 中 | 拆分任务 |
| `feishu_task_comment` | 评论 | 低 | 协作补充 |

### 5.3 第三阶段：Sheets

| 工具 | 范围 | 优先级 | 备注 |
| --- | --- | --- | --- |
| `feishu_sheet` | `info/read/write/append/find/create/export` | 中 | 统一入口，逐步放开写能力 |

### 5.4 第四阶段：Base

| 工具 | 范围 | 优先级 | 备注 |
| --- | --- | --- | --- |
| `feishu_bitable_app` | app 管理 | 中 | 多维表格入口 |
| `feishu_bitable_app_table` | 表管理 | 中 | 数据表层 |
| `feishu_bitable_app_table_field` | 字段管理 | 中 | 字段定义 |
| `feishu_bitable_app_table_record` | 记录 CRUD / 批量操作 | 高 | 最核心 |
| `feishu_bitable_app_table_view` | 视图管理 | 低 | 后补 |

---

## 6. API 与后端接口建议

### 6.1 配置与状态接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/workspaces/{workspaceId}/feishu-tools/config` | 读取 Feishu tools 配置 |
| `POST /api/workspaces/{workspaceId}/feishu-tools/config` | 写入 Feishu tools 配置 |
| `GET /api/workspaces/{workspaceId}/feishu-tools/status` | 查询 endpoint / OAuth / 工具状态 |
| `GET /api/workspaces/{workspaceId}/feishu-tools/capabilities` | 获取当前暴露的工具列表 |
| `GET /api/workspaces/{workspaceId}/feishu-tools/permissions` | 获取缺失 scope 与建议 |

### 6.2 鉴权接口

| 接口 | 用途 |
| --- | --- |
| `POST /api/workspaces/{workspaceId}/feishu-tools/oauth/login` | 发起 Feishu 用户授权 |
| `GET /api/workspaces/{workspaceId}/feishu-tools/oauth/status` | 查询当前授权状态 |
| `POST /api/workspaces/{workspaceId}/feishu-tools/oauth/revoke` | 撤销授权 |

### 6.3 内部工具调用

| 项目 | 建议 |
| --- | --- |
| 线程内调用 | 走统一 Feishu tool gateway |
| 高风险写操作 | 统一打审计点 |
| 错误结构 | 返回稳定的 code / message / hint |

---

## 7. 数据与状态模型建议

### 7.1 建议新增模型

| 模型 | 用途 |
| --- | --- |
| `FeishuToolConfig` | 工作区级 Feishu tools 配置 |
| `FeishuUserAuthState` | 当前用户的 Feishu OAuth 状态 |
| `FeishuToolStatus` | endpoint、token、scope、health 状态 |
| `FeishuToolAuditRecord` | 工具调用审计 |

### 7.2 建议记录字段

| 字段 | 用途 |
| --- | --- |
| `workspaceId` | 工作区隔离 |
| `toolName` | 工具名 |
| `action` | 工具动作 |
| `principalType` | `bot` / `user` |
| `principalId` | 用户或账号标识 |
| `result` | success / failure |
| `errorCode` | 上游错误码 |
| `startedAt` / `completedAt` | 统计耗时 |

---

## 8. 风险控制清单

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 用户身份高权限写操作 | 安全 | 高 | 删除文档、删除日程、批量改记录需额外保护 |
| 消息发送类工具与现有 bot 通道混用 | 架构一致性 | 高 | 第一阶段不开放 `feishu_im_user_message` |
| 文档类 MCP endpoint 不稳定 | 工具可用性 | 中 | 必须有状态检查与错误提示 |
| scope 不足导致调用失败 | 可用性 | 高 | 必须有权限诊断页面 |
| OAuth 状态与工作区绑定不清 | 多租户隔离 | 中 | 状态要绑定 workspace 与账号 |

---

## 9. 测试清单

### 9.1 后端测试

| 项目 | 验证内容 |
| --- | --- |
| 配置读写 | 配置项持久化、默认值、非法值校验 |
| 状态查询 | endpoint 异常、未授权、token 失效、scope 缺失 |
| 鉴权流程 | 登录、查询、撤销 |
| 工具调用代理 | 调用成功、超时、鉴权失败、上游错误映射 |
| 审计记录 | 高风险操作是否记录 |

### 9.2 前端测试

| 项目 | 验证内容 |
| --- | --- |
| 设置页配置 | 表单读写、错误提示、保存状态 |
| MCP 状态页 | 服务状态、权限缺失展示 |
| i18n | 新增文案扫描通过 |

### 9.3 线程级联调

| 项目 | 验证内容 |
| --- | --- |
| 文档检索 | 搜索、读取、创建、更新 |
| 消息检索 | 搜索历史消息、读取 thread、下载附件 |
| Calendar | 忙闲查询、建会、更新 |
| Tasks | 创建、查询、更新 |

---

## 10. 前端多语言检查要求

根据项目规范，前端改动需要同步完成 i18n 检查。

| 项目 | 要求 |
| --- | --- |
| 新增设置页文案 | 必须接入现有 i18n |
| 新增状态提示 | 必须接入现有 i18n |
| 文案扫描 | 提交前至少执行一次前端多语言扫描 |
| 检查命令 | 如存在 `npm run i18n:check`，必须执行 |

---

## 11. 里程碑建议

| 里程碑 | 范围 | 完成标准 |
| --- | --- | --- |
| M1 | 配置层 + 状态层 | 能保存配置，能查看 Feishu tools 健康状态 |
| M2 | Docs + 消息检索 | 线程内能搜文档、读写文档、搜消息 |
| M3 | Calendar + Tasks | 线程内能建会、查忙闲、建任务 |
| M4 | Sheets | 表格读写可用 |
| M5 | Base + 治理 | Base 记录操作可用，权限诊断与审计完成 |

---

## 12. 推荐执行顺序

| 方案 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- |
| 方案1：先做配置与状态，再接只读工具，再接写工具 | 风险最低，定位清晰 | 交付节奏分阶段 | 推荐 |
| 方案2：一次性把 Docs / Calendar / Tasks 全部接入 | 短期能力完整 | 调试面大，风险高 | 不推荐 |
| 方案3：先做 Base / Sheets，再回头做 Docs / Calendar / Tasks | 结构化数据能力更强 | 对当前线程工作流收益不如文档和协作对象直接 | 不推荐 |

**推荐方案：方案1**

**推荐原因：**

- 先把配置、状态、权限、诊断做好，后续工具接入更稳定。
- 文档检索和文档编辑最贴近当前线程式工作流。
- Calendar / Tasks 能直接把线程结果转成执行动作，适合作为第二批。

---

## 13. 最终交付标准

| 验收项 | 标准 |
| --- | --- |
| Feishu tools 配置可管理 | 设置页可读写配置并持久化 |
| 文档工具可用 | 可搜索、读取、创建、更新文档 |
| 消息检索可用 | 可搜索消息、读取历史、下载附件 |
| Calendar 可用 | 可查忙闲、建会、更新会议 |
| Tasks 可用 | 可创建、查询、更新任务 |
| 状态诊断可用 | 缺授权、缺 scope、endpoint 异常可见 |
| Bot 通道稳定 | 现有 Feishu bot 链路不退化 |
| i18n 合规 | 新增前端文案通过扫描 |

