# Bot 配置与联系人操作文档

更新时间：2026-04-23

适用项目：

- `E:\projects\ai\codex-server`

关联页面：

- `/bots`
- `/bots/outbound`
- `/notification-center`

关联代码：

- [backend/internal/bots/service.go](../../backend/internal/bots/service.go)
- [backend/internal/bots/types.go](../../backend/internal/bots/types.go)
- [backend/internal/api/router.go](../../backend/internal/api/router.go)
- [frontend/src/pages/BotsPage.tsx](../../frontend/src/pages/BotsPage.tsx)
- [frontend/src/features/bots/api.ts](../../frontend/src/features/bots/api.ts)
- [frontend/src/pages/NotificationCenterPage.tsx](../../frontend/src/pages/NotificationCenterPage.tsx)

---

## 1. 文档目的

本文档用于回答当前 Bots 页面最容易混淆的几个问题：

1. 当前系统的标准配置顺序是什么。
2. `Bot`、`Endpoint`、`联系人` 三者分别是什么关系。
3. 联系人是否一定要先给机器人发一条消息。
4. 各 provider 在主动发送上的差异是什么。
5. Notification Center 和线程绑定依赖哪一层对象。

本文档描述的是**当前实现和当前页面操作流程**，不是未来规划。

---

## 2. 先说结论

### 2.1 当前页面主流程

当前前端页面的主流程是：

```text
创建 Bot
  -> 在 Bot 下创建 Endpoint
  -> 形成可发送的联系人/收件目标（DeliveryTarget）
  -> 再用于主动发送、通知中心或线程绑定
```

也就是说，从 `/bots` 页面实际操作来看，推荐顺序确实是：

1. 先创建 `Bot`
2. 再创建 `Endpoint`
3. 再处理联系人/收件目标

### 2.2 联系人不是单独的一张“通讯录”

当前系统里页面上展示的“联系人”本质上是 `BotDeliveryTarget`，它表示：

> 这个 bot 之后如果要主动发消息，究竟发给谁。

它不是单纯的昵称列表，而是一个真正可用于投递的目标对象。

### 2.3 “联系人必须先发消息”不是全局规则

这条规则只对**一部分 provider**成立。

更准确地说：

- `Telegram`、`Feishu`、`QQ Bot`：
  通常可以手工创建联系人，只要你已经知道目标路由信息，就不必等对方先发消息。
- `WeChat`：
  可以先保存联系人，但如果对方还没给 bot 发过消息，这个联系人通常会处于 `waiting_for_context`，还不能真正主动发送。

所以真正的判断条件不是“有没有创建联系人”，而是：

> 当前这个 DeliveryTarget 是否已经 `ready`。

---

## 3. 核心对象说明

### 3.1 Bot

`Bot` 是逻辑实体，代表一组 bot 配置的管理入口。

它负责承载：

- bot 名称、描述、作用域
- 默认 binding
- 下面挂载的多个 endpoint
- 下面挂载的 delivery target、trigger

从页面上看，`Bot` 是第一层资源。

### 3.2 Endpoint

页面里的 `Endpoint` 对应后端的 `BotConnection`。

它表示：

> 这个 bot 通过哪个平台、哪套凭据、哪种 AI backend 对外工作。

一个 bot 可以有多个 endpoint，例如：

- Telegram endpoint
- WeChat endpoint
- Feishu endpoint

页面上 `New Endpoint` 创建的就是这一层。

### 3.3 联系人 / 收件目标

页面中的“联系人”“收件人”“Recipient”“Saved Contact”，对应后端都是 `BotDeliveryTarget`。

它表示：

> 这个 endpoint 后续主动发送时，消息应该发往哪个外部目标。

它主要分为两类。

#### 3.3.1 `session_backed`

这是从已有会话自动形成的目标。

典型场景：

1. 用户先给 bot 发消息
2. 系统创建 `BotConversation`
3. 后端把这个 conversation 投影成一个可发送目标

这类目标的特点是：

- 来自真实对话
- 通常天然带有 reply context
- 更适合“回复型外发”或从最近会话继续发消息

#### 3.3.2 `route_backed`

这是手工保存的目标。

典型场景：

1. 在 `/bots/outbound` 里点 `New Saved Contact`
2. 输入 chat id / user id / thread id / openid 等外部路由信息
3. 系统创建一个可复用的 DeliveryTarget

这类目标的特点是：

- 不一定来自已有会话
- 适合通知、手工主动发送、线程回推
- 是否能立即发送，取决于 provider 是否支持 sessionless push 或是否依赖上下文

---

## 4. 当前页面的标准操作流程

### 4.1 场景一：先把 bot 接上平台，等用户来消息

这是最常见的“会话型 bot”流程。

步骤如下：

1. 打开 `/bots`
2. 点击 `New Bot`
3. 填写 bot 名称、描述、作用域并创建
4. 选中刚创建的 bot
5. 点击 `New Endpoint`
6. 选择 provider，例如 Telegram / WeChat / Feishu / QQ Bot
7. 填写 endpoint 凭据和运行配置
8. 保存 endpoint
9. 等外部用户给这个 bot 发消息
10. 系统创建 `BotConversation`
11. conversation 会逐步形成可发送的 `session_backed` target

这条路径的特点是：

- 配置简单
- 不需要先手工录入联系人
- 更适合“用户先找 bot，bot 再回复”的工作方式

### 4.2 场景二：需要主动发消息或做通知

这是“外发型 bot”流程。

步骤如下：

1. 先完成 `Bot -> Endpoint` 的创建
2. 打开 `/bots/outbound`
3. 选择目标 bot
4. 选择目标 endpoint
5. 在 `Recipients` 区域查看已有目标
6. 如果还没有合适目标：
   - 使用已存在的 conversation 自动形成的目标，或者
   - 点击 `New Saved Contact` 手工创建 `route_backed` target
7. 确认该目标的 `Delivery readiness`
8. 只有 `ready` 的目标才适合拿来做通知或稳定的主动发送

这条路径的特点是：

- 面向主动发送
- 更依赖 `DeliveryTarget`
- 是否可用取决于 provider 能力和上下文状态

### 4.3 场景三：给线程绑定 bot 出口

如果希望 workspace thread 的输出回推到某个 bot 联系人，流程是：

1. 先有一个可用的 `DeliveryTarget`
2. 在线程页或相关绑定入口创建 `ThreadBotBinding`
3. 后续 thread 完成的消息通过这个 target 发出去

这里绑定的不是“bot 名字”，而是具体的 `DeliveryTarget`。

因此线程绑定是否可靠，仍然取决于：

- endpoint 是否可用
- delivery target 是否 `active`
- provider 是否具备足够上下文

---

## 5. 各 provider 的联系人规则

### 5.1 总表

| Provider | 是否可手工创建联系人 | 是否必须对方先发消息 | 说明 |
| --- | --- | --- | --- |
| Telegram | 是 | 通常不需要 | 只要 route 信息正确，通常可直接主动发送 |
| WeChat | 是 | **通常需要，至少发送前需要上下文** | 可先保存联系人，但若没有上下文会处于 `waiting_for_context` |
| Feishu | 是 | 通常不需要 | 支持 sessionless push 的 route-backed 目标 |
| QQ Bot | 是 | 通常不需要 | 支持 sessionless push 的 route-backed 目标 |

### 5.2 Telegram

Telegram 当前支持手工创建目标，例如：

- `telegram_chat`
- `telegram_topic`

只要你已经拿到正确的 chat id 或 topic thread id，通常可以直接创建 `route_backed` target 并主动发送。

因此 Telegram 一般不是“必须先让对方发消息”的模型。

### 5.3 WeChat

WeChat 是当前最容易误判的平台。

当前实现里：

- 可以手工创建 `WeChat User ID`
- 这个目标也会出现在联系人列表中
- 但是如果还没有可用的 reply context，它会显示为 `waiting_for_context`

这意味着：

1. 联系人可以先保存
2. 但如果对方还没给 bot 发过消息，系统通常还没有可用上下文
3. 这时主动发送、通知中心等能力不会把它当作“已就绪目标”

所以对 WeChat 更准确的说法是：

> 不是“必须先创建联系人”，而是“真正发送前通常必须先拿到上下文，而这个上下文通常来自对方先发一条消息”。

### 5.4 Feishu

Feishu 当前支持：

- `feishu_chat`
- `feishu_thread`

只要目标 route 信息可用，通常可以直接创建 route-backed target 并发送，不强依赖对方先发消息。

### 5.5 QQ Bot

QQ Bot 当前支持：

- `qqbot_group`
- `qqbot_c2c`

同样更偏向“已知目标即可主动发”，不是必须先由对方触发会话。

---

## 6. 页面上看到的几种状态是什么意思

### 6.1 `No endpoint selected`

表示你已经在 bot 层完成选择，但还没有选择具体 endpoint。

此时不能配置联系人，也不能进行针对某个 provider 的外发操作。

### 6.2 `This bot does not have any endpoints yet`

表示 bot 已创建，但还没有 endpoint。

这时下一步就是：

1. 选中 bot
2. 点 `New Endpoint`

### 6.3 `No proactive recipients exist for this endpoint yet`

表示这个 endpoint 下面还没有任何 `DeliveryTarget`。

常见原因：

- 还没有用户来消息，所以没有形成 `session_backed`
- 也还没有手工创建 `route_backed`

### 6.4 `waiting_for_context`

这是最关键的状态之一。

它表示：

> 目标已经存在，但当前还没有足够上下文完成发送。

目前最典型的就是 WeChat。

看到这个状态时，应优先判断：

1. 这是不是 WeChat endpoint
2. 目标用户是否还没给 bot 发过消息
3. 系统是否还没有拿到 provider-side context token

### 6.5 `ready`

表示该目标已经满足主动发送条件。

通常这意味着它可以用于：

- 手工主动发送
- Notification Center
- 更稳定的线程回推

---

## 7. Notification Center 与联系人可用性的关系

Notification Center 绑定的是 `DeliveryTarget`，不是 `Bot` 本身。

这意味着：

1. 先有 bot
2. 再有 endpoint
3. 再有 delivery target
4. 并且这个 target 必须 `ready`
5. Notification Center 才会把它当成可选目标

因此如果你遇到“明明保存了联系人，但通知中心选不到”的情况，优先检查：

- target 是否只是 `waiting_for_context`
- endpoint 是否不是 `active`
- 该 target 是否还没有真正 ready

对 WeChat 尤其如此：

> 联系人可以先保存，但只有在上下文可用后，它才适合作为通知目标。

---

## 8. 当前实现的一个补充说明

### 8.1 从 UI 看，推荐顺序是 bot-first

当前页面的推荐操作顺序是：

```text
Bot -> Endpoint -> Recipient/DeliveryTarget
```

这是本文档推荐遵循的方式。

### 8.2 从后端 API 看，也支持 connection-first 的兜底

后端仍保留了直接创建 connection 的入口：

- `POST /api/workspaces/{workspaceId}/bot-connections`

如果这样做，系统会自动为 connection 补齐 bot 资源。

但这属于后端兼容能力，不是当前前端页面的主操作心智。

因此实际使用中，仍然建议把流程理解为：

> 先建 bot，再建 endpoint，再建或发现联系人。

---

## 9. 推荐的实际操作建议

### 9.1 如果你做的是“响应式 bot”

例如用户先在 Telegram 或 WeChat 上找 bot，然后 bot 回复。

建议流程：

1. 创建 bot
2. 创建 endpoint
3. 不着急手工创建联系人
4. 等真实会话进来
5. 让系统自动形成 conversation 和 session-backed target

### 9.2 如果你做的是“通知 / 主动发送 bot”

例如告警通知、自动播报、线程回推。

建议流程：

1. 创建 bot
2. 创建 endpoint
3. 明确每个平台的路由能力
4. 为 endpoint 创建或确认合适的 `DeliveryTarget`
5. 确认它处于 `ready`
6. 再接入 Notification Center 或 ThreadBotBinding

### 9.3 如果你做的是 WeChat 主动发送

建议额外注意：

1. 可以先保存联系人
2. 但不要把“已保存”误当成“已可发”
3. 一定要确认 `Delivery readiness`
4. 如果是 `waiting_for_context`，需要先让对方给 bot 发一条消息，拿到上下文后再用

---

## 10. 一句话总结

当前系统的推荐操作顺序是：

```text
先创建 Bot
  -> 再创建 Endpoint
  -> 再形成或保存联系人（DeliveryTarget）
  -> 等联系人处于 ready 后再用于主动发送、通知中心或线程绑定
```

其中：

- `Telegram / Feishu / QQ Bot` 往往可以直接手工建联系人并发送
- `WeChat` 往往需要联系人先发一条消息，拿到上下文后才真正可发

