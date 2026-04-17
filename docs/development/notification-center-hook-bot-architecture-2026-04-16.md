# Hook 与 Bot 连接的通知中心架构方案

更新时间：2026-04-16

适用项目：

- `E:\projects\ai\codex-server`

关联代码：

- `backend/internal/hooks/service.go`
- `backend/internal/turnpolicies/service.go`
- `backend/internal/events/hub.go`
- `backend/internal/notifications/service.go`
- `backend/internal/bots/service.go`
- `backend/internal/bots/triggers.go`
- `backend/internal/bots/trigger_dispatcher.go`
- `backend/internal/automations/service.go`
- `backend/internal/store/models.go`
- `backend/internal/api/router.go`

## 1. 目标

当前仓库已经具备三块基础能力：

- `hooks`：负责治理事件与 `HookRun` 审计。
- `bots`：负责机器人接入、会话、外发目标与消息投递。
- `notifications`：负责站内通知数据读写。

现阶段缺少的是一层独立的通知编排能力。`HookRun` 已经能发出 `hook/started`、`hook/completed` 事件，但这些事件还不能通过统一订阅规则分发到：

- 机器人
- 邮件
- 站内通知

本文给出的结论是：

- 不建议让 `hooks` 直接调用 `bots` 或邮件服务。
- 不建议继续把 `notifications` 扩成一个同时负责事件订阅、模板渲染、渠道分发、重试与审计的大模块。
- 建议新增独立的 `notificationcenter` 层，位于 `events.Hub` 与各通知渠道之间，负责事件归一化、订阅匹配、模板渲染、去重、分发与审计。
- 当前 `notifications` 模块保留为站内通知收件箱能力；当前 `bots` 模块保留为 Bot 渠道适配器；新增邮件渠道适配器。

---

## 2. 当前架构梳理

### 2.1 现有模块职责

| 模块 | 当前职责 | 当前边界 |
| --- | --- | --- |
| `events.Hub` | 工作区事件总线、订阅、回放、广播 | 只负责事件流，不做业务分发决策 |
| `hooks.Service` | 生成 `HookRun`、发布 `hook/started` / `hook/completed`、执行治理动作 | 能产出事件，不能声明通知订阅 |
| `turnpolicies.Service` | 监听事件、补救执行、记录 `TurnPolicyDecision` | 更偏治理与审计，不适合兼任通知中心 |
| `notifications.Service` | 列表、已读、清理 | 只有收件箱 CRUD，没有订阅、模板、渠道编排 |
| `bots.Service` | Bot 连接、会话、DeliveryTarget、OutboundDelivery | 已具备 Bot 发送能力，但不应直接承担全部通知路由 |
| `bots.trigger_dispatcher` | 监听 `notification/created`，按 `BotTrigger` 把站内通知再转发给 Bot | 只支持 `notification` 这一种来源，且只支持 Bot 渠道 |
| `automations.Service` | 定时运行、写通知、发布 `notification/created` | 业务事件和通知写入耦合在一起 |

### 2.2 当前关键链路

#### Hook 侧

```text
runtime event
  -> hooks.Service
  -> HookRun 持久化
  -> events.Hub 发布 hook/started 或 hook/completed
```

#### 站内通知侧

```text
automations.Service
  -> store.CreateNotification
  -> events.Hub 发布 notification/created
```

#### Bot 订阅侧

```text
events.Hub 收到 notification/created
  -> bots.trigger_dispatcher
  -> 读取 BotTrigger
  -> 发送到 DeliveryTarget
```

### 2.3 当前问题

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 事件生产与通知分发没有中间层，`automations` 直接写站内通知，`bots` 直接监听 `notification/created` | hooks、automations、bots、notifications | 高 | 会导致后续邮件、Webhook、短信等渠道继续复制同类逻辑 |
| `notifications.Service` 只有收件箱语义，没有“订阅规则”和“分发记录”语义 | notifications、API、前端 | 高 | 当前 `Notification` 更像站内消息，不是通知编排中心 |
| `bots.trigger_dispatcher` 只能消费 `notification/created`，无法直接消费 `hook/completed`、`turn-policy`、`bot delivery failed` 等事件 | hooks、turnpolicies、bots | 高 | Hook 与 Bot 之间仍然是间接关系，且能力不足 |
| Bot 订阅模型只有 `BotTrigger(type=notification)`，缺少统一 topic、事件等级、模板、去重和限流 | bots、store、API | 高 | 当前模型更接近单用途转发规则 |
| 邮件渠道不存在统一接入点 | 邮件通知 | 高 | 一旦直接接在各业务模块中，后续维护成本会快速增加 |
| 站内通知、Bot 通知、邮件通知没有统一分发日志 | 运维、审计、重试 | 中 | 难以回答“事件是否送达、失败在哪个渠道” |
| 当前通知对象缺少“事件事实”和“投递事实”的分层 | store、API、前端 | 中 | `Notification` 与 `BotOutboundDelivery` 不能构成统一查询视图 |
| Hook 事件没有统一映射到业务 topic，订阅条件只能靠原始 method 或自定义字符串判断 | hooks、notification rule | 中 | 后续规则会分散在多个模块中 |

---

## 3. 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- |
| 方案1：`hooks` / `automations` 直接调用 Bot、邮件、站内通知 | 代码改动最少，短期可以很快打通单一场景 | 业务模块与渠道强耦合；无法统一审计、重试、限流；每新增一个事件源都要重复接渠道 | 只做一次性演示，不适合当前项目 |
| 方案2：继续扩展 `notifications.Service`，让它同时负责收件箱、订阅、分发、模板与日志 | 模块数量少，入口直观 | `notifications` 语义会混杂；站内通知模型会污染 Bot 与邮件分发模型；后续维护困难 | 小规模系统，渠道固定且规则简单 |
| 方案3：新增独立 `notificationcenter`，把 `notifications` 作为站内通知渠道，把 `bots` 作为 Bot 渠道适配器 | 分层清晰；Hook、Bot、邮件都能通过统一订阅模型连接；便于扩展、审计、重试和灰度 | 初期需要新增 store、API 与事件归一化逻辑 | 当前项目 |

**推荐方案：方案3：新增独立 `notificationcenter`。**

**推荐原因：**

1. 当前仓库已经有 `events.Hub`、`HookRun`、`BotDeliveryTarget`、`BotOutboundDelivery`，只缺统一编排层，不缺基础能力。
2. 站内通知、Bot 通知、邮件通知本质上是不同渠道，不应继续共享同一个“收件箱模型”。
3. Hook、turn policy、automation、bot delivery failure 都会继续增加事件类型，必须先把事件订阅和渠道分发解耦。

---

## 4. 目标架构分层

### 4.1 目标分层图

```text
Event Producers
  - hooks
  - turnpolicies
  - automations
  - bots
  - runtime/system
        |
        v
Notification Event Bridge
  - topic 归一化
  - severity / scope 归一化
  - 事件去重键生成
        |
        v
Notification Center
  - subscription 匹配
  - 模板渲染
  - 去重 / 限流
  - dispatch 计划生成
        |
        v
Channel Adapters
  - in-app
  - bot
  - email
  - future: webhook / sms
        |
        v
Delivery Records / Inbox / Audit
```

### 4.2 分层职责表

| 层级 | 职责 | 当前模块 | 目标模块 |
| --- | --- | --- | --- |
| 事件生产层 | 产生原始业务事件 | `hooks`、`turnpolicies`、`automations`、`bots` | 保持现状 |
| 事件归一化层 | 把原始 method 转成稳定 topic 和 payload | 无 | `backend/internal/notificationcenter/eventbridge.go` |
| 订阅与路由层 | 匹配 subscription、解析渠道、生成 dispatch 任务 | `bots.trigger_dispatcher` 局部承担 | `backend/internal/notificationcenter/service.go` |
| 渠道适配层 | 执行具体发送 | `notifications.Service`、`bots.Service` | `notificationcenter/channels/inapp.go`、`bot.go`、`email.go` |
| 投递审计层 | 存储站内通知、投递记录、失败原因、重试状态 | `Notification`、`BotOutboundDelivery` | 保留并补充统一 `NotificationDispatch` |

### 4.3 模块边界调整

| 调整前 | 调整后 |
| --- | --- |
| `notifications.Service` = 站内通知 CRUD | `notifications.Service` = 站内通知收件箱服务 |
| `bots.trigger_dispatcher` = 订阅器 + Bot 渠道发送 | `bots` 只保留 Bot 渠道发送，订阅逻辑迁入 `notificationcenter` |
| `automations.Service` 直接创建 `Notification` | `automations.Service` 只发布业务事件，由 `notificationcenter` 决定是否写站内通知 |
| `hooks.Service` 只发布 `hook/started` / `hook/completed` | `hooks.Service` 继续发布事件，`notificationcenter` 负责把 Hook 事件映射为通知 topic |

---

## 5. 目标领域模型

### 5.1 事件事实与投递事实分离

建议把“发生了什么”和“发给了谁”拆开。

#### 事件事实

| 实体 | 用途 | 说明 |
| --- | --- | --- |
| `NotificationEvent` | 归一化后的业务事件 | 不是必须长期落库；第一阶段可按需生成后立即处理 |
| `NotificationTopic` | 稳定 topic 名称 | 例如 `hook.blocked`、`hook.failed`、`automation.failed` |

#### 订阅与模板

| 实体 | 用途 | 说明 |
| --- | --- | --- |
| `NotificationSubscription` | 定义谁订阅什么事件，通过什么渠道发送 | 核心配置实体 |
| `NotificationTemplate` | 主题、正文、变量模板 | 支持不同渠道使用不同模板 |
| `NotificationPreference` | 用户级或工作区级开关 | 第二阶段可补 |

#### 投递事实

| 实体 | 用途 | 说明 |
| --- | --- | --- |
| `Notification` | 站内通知收件箱记录 | 保持现有模型定位 |
| `NotificationDispatch` | 一次渠道投递记录 | 新增，统一记录 in-app / bot / email 的发送结果 |
| `BotOutboundDelivery` | Bot 渠道的详细发送记录 | 保持现有模型，作为 Bot 渠道的底层明细 |

### 5.2 建议新增的 store 模型

| 模型 | 关键字段建议 | 说明 |
| --- | --- | --- |
| `NotificationSubscription` | `id`, `workspaceId`, `topic`, `sourceType`, `filter`, `channels`, `enabled`, `createdAt`, `updatedAt` | 描述订阅规则 |
| `NotificationChannelBinding` | `channel`, `targetRefType`, `targetRefId`, `templateId`, `settings` | 描述每个订阅规则在某个渠道的目标 |
| `NotificationDispatch` | `id`, `workspaceId`, `eventKey`, `topic`, `channel`, `targetRefType`, `targetRefId`, `status`, `error`, `attemptCount`, `createdAt`, `updatedAt`, `deliveredAt` | 统一投递审计 |
| `NotificationEmailTarget` | `id`, `workspaceId`, `name`, `emails`, `subjectTemplate`, `bodyTemplate`, `enabled` | 邮件渠道目标配置 |

### 5.3 与现有模型的关系

| 现有模型 | 目标定位 | 处理建议 |
| --- | --- | --- |
| `Notification` | 站内通知渠道结果 | 保留，不再承担订阅规则职责 |
| `BotTrigger` | 旧版 Bot 订阅规则 | 迁移为 `NotificationSubscription(channel=bot)`；兼容期保留只读映射 |
| `BotDeliveryTarget` | Bot 渠道接收目标 | 保留，作为 `targetRefType=bot_delivery_target` |
| `BotOutboundDelivery` | Bot 渠道发送明细 | 保留，`NotificationDispatch` 与其建立关联 |
| `HookRun` | Hook 原始审计事实 | 保留，由 `notificationcenter` 订阅其事件 |

---

## 6. 事件模型设计

### 6.1 建议的通知 topic

第一阶段建议统一以下 topic：

| topic | 来源 | 建议默认级别 | 典型用途 |
| --- | --- | --- | --- |
| `hook.blocked` | `hook/completed` 且 `decision=block` | warning / error | 命令被拦截、敏感输入被拦截 |
| `hook.failed` | `hook/completed` 且 `status=failed` | error | Hook 执行自身失败 |
| `hook.continue_turn` | `hook/completed` 且 `decision=continueTurn` | info / warning | 自动续跑告警 |
| `turn_policy.failed_action` | `TurnPolicyDecision` | warning / error | 自动补救失败 |
| `automation.completed` | `automation/run/completed` | success | 自动任务完成 |
| `automation.failed` | `automation/run/completed` 且 `status=failed` | error | 自动任务失败 |
| `bot.delivery.failed` | Bot 外发失败 | error | Bot 渠道需要人工处理 |
| `system.notification.created` | 兼容旧路径 | info | 旧通知规则过渡期使用 |

### 6.2 Hook 事件映射规则

建议由 `notificationcenter` 统一处理：

| 原始事件 | 条件 | 归一化 topic | 默认渠道建议 |
| --- | --- | --- | --- |
| `hook/completed` | `decision=block` | `hook.blocked` | in-app、bot、email |
| `hook/completed` | `status=failed` | `hook.failed` | in-app、email |
| `hook/completed` | `decision=continueTurn` | `hook.continue_turn` | in-app |
| `hook/completed` | `status=completed` 且 `decision=continue` | 不默认通知 | 仅保留审计 |

### 6.3 去重键建议

建议统一生成：

```text
workspaceId + topic + sourcePrimaryId + channel + targetRefId
```

其中 `sourcePrimaryId` 取值优先级建议为：

1. `hookRun.id`
2. `turnPolicyDecision.id`
3. `automationRun.id`
4. `notification.id`

这样可以避免：

- Hook 重放时重复发邮件
- 同一条站内通知被 Bot 规则重复转发
- 多实例监听时出现重复发送

---

## 7. 关键流程设计

### 7.1 Hook 事件 -> 通知中心 -> 多渠道

```text
hook/completed
  -> notificationcenter.eventbridge
  -> 归一化为 hook.blocked / hook.failed / hook.continue_turn
  -> 匹配 NotificationSubscription
  -> 为每个渠道生成 NotificationDispatch
      -> in-app channel: 写 Notification
      -> bot channel: 调 bots.SendDeliveryTargetOutboundMessages
      -> email channel: 调 email adapter
```

### 7.2 Bot 渠道调用方式

Bot 渠道不新增独立发送模型，直接复用现有能力：

- `bots.SendDeliveryTargetOutboundMessages(...)`
- `BotDeliveryTarget`
- `BotOutboundDelivery`

这样可以直接获得：

- 渠道能力校验
- 现有 provider 发送实现
- 已有重试与发送状态模型

### 7.3 站内通知调用方式

站内通知渠道只负责写收件箱：

- `notifications.Service.CreateInAppNotification(...)`（建议新增）
- 或直接由 `notificationcenter` 通过 store 创建 `Notification`

重点是：

- `Notification` 代表“用户在系统内看到的消息”
- 不是“通知中心的总记录”

### 7.4 邮件渠道调用方式

新增 `email` 渠道适配器：

| 组件 | 职责 |
| --- | --- |
| `notificationcenter/channels/email.go` | 统一邮件发送入口 |
| `internal/mail` 或 `internal/notifications/email` | SMTP / API provider 具体实现 |
| `NotificationEmailTarget` | 邮件地址组、主题模板、正文模板 |

邮件渠道第一阶段建议只支持：

- 纯文本正文
- 同步模板渲染
- 基础重试
- 工作区级目标组

---

## 8. API 设计建议

### 8.1 配置类 API

| 接口 | 说明 |
| --- | --- |
| `GET /api/workspaces/{workspaceId}/notification-subscriptions` | 列表 |
| `POST /api/workspaces/{workspaceId}/notification-subscriptions` | 创建订阅 |
| `POST /api/workspaces/{workspaceId}/notification-subscriptions/{subscriptionId}` | 更新订阅 |
| `DELETE /api/workspaces/{workspaceId}/notification-subscriptions/{subscriptionId}` | 删除订阅 |
| `GET /api/workspaces/{workspaceId}/notification-email-targets` | 邮件目标组列表 |
| `POST /api/workspaces/{workspaceId}/notification-email-targets` | 创建邮件目标组 |

### 8.2 审计类 API

| 接口 | 说明 |
| --- | --- |
| `GET /api/workspaces/{workspaceId}/notification-dispatches` | 查看投递记录 |
| `GET /api/workspaces/{workspaceId}/notification-dispatches/{dispatchId}` | 查看单条投递详情 |
| `POST /api/workspaces/{workspaceId}/notification-dispatches/{dispatchId}/retry` | 重试失败投递 |

### 8.3 兼容策略

兼容期建议保留：

- `/api/notifications`
- `/api/workspaces/{workspaceId}/bots/{botId}/triggers`

但语义调整为：

- `notifications`：只管站内通知收件箱
- `bot triggers`：旧规则视图，内部映射到 `notification-subscriptions` 的 Bot 渠道子集

---

## 9. 模块调整建议

### 9.1 建议新增目录

```text
backend/internal/
  notificationcenter/
    service.go
    eventbridge.go
    matcher.go
    templates.go
    rate_limit.go
    dedupe.go
    channels/
      inapp.go
      bot.go
      email.go
```

### 9.2 建议调整现有模块

| 模块 | 建议调整 |
| --- | --- |
| `backend/internal/notifications/service.go` | 保留为站内通知服务；补创建接口；不再负责跨渠道编排 |
| `backend/internal/bots/trigger_dispatcher.go` | 停止直接监听 `notification/created`；兼容期转为调用 `notificationcenter` |
| `backend/internal/bots/triggers.go` | 逐步迁移为 `NotificationSubscription` 的兼容层 |
| `backend/internal/automations/service.go` | 从“直接创建通知”改为“发布 automation topic 事件” |
| `backend/internal/hooks/service.go` | 保持当前事件发布方式，无需直接依赖通知中心 |
| `backend/internal/api/router.go` | 增加通知中心配置与投递查询接口 |
| `backend/internal/store/models.go` | 增加 `NotificationSubscription`、`NotificationDispatch`、`NotificationEmailTarget` |

### 9.3 为什么不建议让 `hooks` 直接依赖 `notifications` 或 `bots`

| 原因 | 说明 |
| --- | --- |
| 关注点不同 | `hooks` 负责治理与审计，不应关心某条事件是发邮件还是发机器人 |
| 可扩展性差 | 后续新增渠道时，所有事件源都要重复修改 |
| 测试复杂 | 业务判断、模板渲染、渠道错误会混在同一个模块中 |
| 重试困难 | Hook 执行成功不代表通知发送成功，必须拆开审计 |

---

## 10. 分阶段实施建议

### Phase 1：先引入通知中心骨架

目标：

- 新增 `notificationcenter` 模块
- 建立事件归一化与订阅匹配能力
- 先支持 `hook/completed` -> `in-app`

范围：

- 新增 `NotificationSubscription`
- 新增 `NotificationDispatch`
- `hooks` 事件接入 `notificationcenter`
- 站内通知渠道打通

验收标准：

- `hook.blocked` 能写入站内通知
- 可查询 dispatch 记录

### Phase 2：接入 Bot 渠道

目标：

- 让通知中心统一调用 `bots.SendDeliveryTargetOutboundMessages`
- 把旧 `BotTrigger(type=notification)` 映射到新订阅规则

范围：

- 新增 `channel=bot`
- 建立 `NotificationDispatch` 与 `BotOutboundDelivery` 关联
- 保留旧 Bot trigger API 兼容

验收标准：

- `hook.blocked` 可通过 Bot 发出
- 同一事件不会重复发给同一 DeliveryTarget

### Phase 3：接入邮件渠道

目标：

- 工作区级邮件目标组
- 支持 `hook.failed`、`automation.failed` 邮件通知

范围：

- 新增 `NotificationEmailTarget`
- 新增 `email` channel adapter
- 增加失败重试

验收标准：

- 邮件渠道具备基础发送、失败记录、手动重试

### Phase 4：事件源统一收敛

目标：

- `automations`、`turnpolicies`、`bot delivery failed` 全部通过通知中心编排

范围：

- `automations.Service` 不再直接写 `Notification`
- `bots` 渠道失败事件进入通知中心
- `turn policy` 决策事件归一化

验收标准：

- 站内通知、Bot、邮件都通过统一订阅规则配置

### Phase 5：收敛旧接口语义

目标：

- `BotTrigger` 退为兼容模型
- `notifications` 只保留收件箱

范围：

- 新前端改用 notification-subscriptions
- 旧 API 视图兼容保留一段时间

验收标准：

- 新旧接口可以并存
- 订阅配置只维护一套事实来源

---

## 11. 风险与控制

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 事件重复消费导致重复发送 | Bot、邮件、站内通知 | 高 | 必须引入统一 `eventKey` 与渠道级去重键 |
| Hook 高频事件导致通知风暴 | Hook、邮件、Bot | 高 | 需要 topic 级别限流和聚合策略 |
| 邮件或 Bot 发送失败影响主业务路径 | hooks、automations | 高 | 通知发送必须异步，失败只影响 `NotificationDispatch` |
| 旧 `BotTrigger` 与新订阅模型同时生效造成双发 | bots、notificationcenter | 高 | 兼容期只允许单向映射，不允许双写双读 |
| 站内通知与统一投递日志语义混淆 | 前端、API | 中 | 前端需要区分 inbox 与 dispatch history |
| 模板变量失配造成空消息 | Bot、邮件 | 中 | 渠道发送前必须校验模板渲染结果 |

---

## 12. 推荐的第一阶段最小实现范围

为了尽快连接 Hook 与 Bot，同时避免范围过大，建议第一阶段只做以下内容：

1. 新增 `notificationcenter` 模块。
2. 只接入 `hook/completed` 事件。
3. 只归一化三类 topic：
   - `hook.blocked`
   - `hook.failed`
   - `hook.continue_turn`
4. 只支持两个渠道：
   - `in-app`
   - `bot`
5. 邮件渠道放到第二阶段。
6. 旧 `BotTrigger(type=notification)` 暂不删除，但新建规则优先走 `notificationcenter`。

这样可以尽快完成用户要求的核心目标：

- Hook 系统与机器人系统真正连接
- 中间增加独立通知中心
- 支持站内通知与 Bot 通知
- 邮件通道保留明确扩展位

---

## 13. 最终结论

本项目当前最合适的分层方式如下：

```text
hooks / turnpolicies / automations / bots
  -> events.Hub
  -> notificationcenter
  -> channel adapters (in-app / bot / email)
```

其中：

- `events.Hub` 继续做事件总线，不承担通知规则。
- `hooks` 继续做治理与 `HookRun` 审计，不直接发通知。
- `notifications` 继续做站内通知收件箱，不再兼任统一分发器。
- `bots` 继续做 Bot 渠道发送适配器，不再直接承担订阅总线。
- 新增 `notificationcenter` 负责事件归一化、订阅匹配、模板渲染、去重、重试与投递审计。

这样处理后，Hook、Bot、邮件、站内通知之间的职责边界会清晰很多，后续扩展也更稳定。
