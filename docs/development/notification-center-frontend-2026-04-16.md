# Notification Center 前端配置补充说明

更新时间：2026-04-16

## 1. 结论

前端需要补充通知中心配置，但不需要把 Telegram 单独建成通知渠道。

统一关系如下：

- `notificationcenter`：负责事件订阅、规则配置、投递审计
- `bot`：通知渠道类型之一
- `telegram` / `wechat`：`bot` 渠道下的 provider，由 Bot Connection 与 Delivery Target 决定
- `email`：独立渠道
- `in-app`：独立渠道

前端配置对象应围绕 `NotificationSubscription`，而不是继续围绕旧 `BotTrigger` 扩展。

---

## 2. 前端需要补的配置

| 配置域 | 是否需要前端支持 | 说明 |
| --- | --- | --- |
| 事件 topic 选择 | 需要 | 前端应配置归一化 topic，例如 `hook.blocked`、`automation.failed`，不直接暴露原始 hook method |
| 渠道选择 | 需要 | 当前渠道为 `in_app`、`bot`、`email` |
| Bot 目标选择 | 需要 | 选择的是 `BotDeliveryTarget`，Telegram 只是该目标背后的 provider |
| 邮件目标组 | 需要 | 选择的是 `NotificationEmailTarget` |
| 站内通知目标 | 建议需要 | 第一阶段可默认工作区级，后续可扩展到 thread 级 |
| 分发审计与重试 | 需要 | 前端需要区分 inbox 与 dispatch history |
| 旧 BotTrigger 管理 | 兼容保留 | 旧页面可保留，但新规则入口应改为 Notification Center |

---

## 3. 事件配置原则

| 项目 | 前端应展示 | 不建议展示 |
| --- | --- | --- |
| 事件标识 | 稳定 topic | 原始 `hook/completed` 条件组合 |
| 来源类型 | `hook`、`automation`、`turn_policy`、`bot`、`notification` | provider 内部事件名 |
| 过滤条件 | 工作区、thread、level、decision、status 等业务字段 | Telegram chat ID 这类渠道内部字段 |
| 模板 | 标题模板、正文模板 | provider 特定拼接逻辑 |

---

## 4. Notification Center 与 Bot / Telegram / 邮件的关系

| 对象 | 系统定位 | 前端配置入口 |
| --- | --- | --- |
| `NotificationSubscription` | 顶层订阅规则 | Notification Center 页面 |
| `NotificationChannelBinding(channel=bot)` | Bot 渠道绑定 | 在订阅规则里选择渠道与目标 |
| `BotDeliveryTarget` | Bot 渠道接收目标 | 复用 Bots 页面已有目标管理 |
| `Telegram` provider | Bot 的具体 provider | 仍在 Bots 页面配置 Connection / Delivery Target |
| `NotificationEmailTarget` | 邮件地址组 | Notification Center 页面 |
| `NotificationDispatch` | 统一投递审计 | Notification Center 页面 |
| `Notification` | 站内收件箱 | 现有通知中心 UI |

关键关系：

- Notification Center 不直接绑定 Telegram chat。
- Notification Center 绑定的是 `BotDeliveryTarget`。
- `BotDeliveryTarget` 决定该通知最终发往 Telegram、WeChat 或未来其他 provider。

---

## 5. 推荐前端页面分层

| 页面 | 主要职责 | 数据来源 |
| --- | --- | --- |
| Bots 页面 | 管理 Bot、Connection、Delivery Target | `/bots`、`/bot-connections`、`/delivery-targets` |
| Notification Center 页面 | 管理订阅规则、邮件目标组、投递审计 | `/notification-subscriptions`、`/notification-email-targets`、`/notification-dispatches` |
| Inbox UI | 展示站内通知 | `/notifications` |

推荐方案：将“事件配置”与“Bot provider 配置”分开。

推荐原因：

- 事件订阅与 Telegram 连接不是同一层职责。
- 如果把 topic 规则继续塞进 Bots 页面，后续邮件与站内通知会继续耦合在 Bot 视图里。
- 复用现有 Delivery Target 模型后，Telegram 与 WeChat 不需要重复建通知目标模型。

---

## 6. 当前代码状态

| 项目 | 当前状态 | 备注 |
| --- | --- | --- |
| 后端通知中心 API | 已完成 | 已提供 subscription / email target / dispatch 接口 |
| 前端新 API 封装 | 已补充 | 新增 `frontend/src/features/notification-center/api.ts` |
| 前端 topic 与渠道目录 | 已补充 | 新增 `frontend/src/features/notification-center/catalog.ts` |
| 前端配置页面 | 未完成 | 仍以旧 BotTrigger 页面为主 |
| Inbox UI | 已存在 | 只覆盖站内通知，不覆盖 dispatch 审计 |

---

## 7. 下一步建议

| 任务 | 说明 |
| --- | --- |
| 新增 Notification Center 页面 | 管理订阅规则、邮件目标组、投递审计 |
| Bots 页面增加跳转关系 | 从 Delivery Target 跳到被哪些订阅规则使用 |
| 旧 BotTrigger 页面标记兼容模式 | 避免继续把新规则建在旧模型上 |
| Dispatch 详情页增加关联跳转 | 可跳到 Notification、BotOutboundDelivery、Email target |
