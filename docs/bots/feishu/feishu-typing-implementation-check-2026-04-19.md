# Feishu Typing 实现检查说明

更新时间：2026-04-19
适用项目：`E:\projects\ai\codex-server`

---

## 1. 结论

- 当前项目 **已经实现 Feishu typing 对接**。
- 当前实现不是飞书公开文档中的原生 typing indicator API，而是通过 **消息 reaction** 近似表达 typing 状态。
- bot 开始处理时会添加 reaction，处理结束时会删除 reaction。
- 因此这部分代码 **当前无需补缺口**。

---

## 2. 实现状态

| 模块 | 当前状态 | 结论 | 备注 |
| --- | --- | --- | --- |
| `TypingProvider` 接口 | 已存在 | 已具备抽象能力 | bot 框架支持 typing 调度 |
| Feishu provider `StartTyping(...)` | 已实现 | 已对接 | 位于 `backend/internal/bots/feishu.go` |
| Feishu typing 会话 | 已实现 | 已对接 | `feishuTypingSession.Stop(...)` 会移除 reaction |
| 实现方式 | 已实现 | 非原生 typing API | 通过消息 reaction 实现 |
| 相关测试 | 已存在并通过 | 已验证 | Feishu typing 测试通过 |

---

## 3. 当前实现方式

| 项目 | 内容 | 备注 |
| --- | --- | --- |
| 启动入口 | `feishuProvider.StartTyping(...)` | 读取发送上下文 |
| 前置条件 | 必须存在 `replyMessageID` | 没有 reply 上下文时返回空 session |
| 开始动作 | 添加 `Typing` reaction | `emoji_type = Typing` |
| 停止动作 | 删除对应 reaction | 在 `Stop(...)` 中执行 |
| 失败策略 | reaction 失败时跳过 | 不阻塞正常消息发送 |

---

## 4. 关键代码点

| 位置 | 作用 | 备注 |
| --- | --- | --- |
| `backend/internal/bots/service.go` | typing 调度入口 | `startProviderTyping` / `stopProviderTyping` |
| `backend/internal/bots/feishu.go` | Feishu typing 主实现 | `StartTyping(...)` |
| `backend/internal/bots/feishu.go` | 添加 reaction | `addFeishuTypingReaction(...)` |
| `backend/internal/bots/feishu.go` | 删除 reaction | `removeFeishuTypingReaction(...)` |
| `backend/internal/bots/feishu.go` | typing session 停止 | `feishuTypingSession.Stop(...)` |

---

## 5. 风险与限制

| 问题描述 | 影响范围 | 严重程度 | 备注 |
| --- | --- | --- | --- |
| 当前实现依赖 reaction | Feishu 交互语义 | 低 | 更像“状态占位”而不是平台原生输入态 |
| 需要 reply 上下文 | Feishu bot 回复链路 | 低 | 没有 `replyMessageID` 时不会显示 typing |
| 与公开 typing API 语义不完全一致 | 平台一致性 | 中 | 属于工程侧近似实现 |

---

## 6. 验证结果

| 检查项 | 结果 | 备注 |
| --- | --- | --- |
| `feishu.go` 中 `StartTyping(...)` | 已确认 | 存在实现 |
| reaction 创建 / 删除实现 | 已确认 | 已接入 |
| `service.go` typing 调度链 | 已确认 | 已接入 |
| `go test ./internal/bots -run Feishu.*Typing -count=1` | 通过 | Feishu typing 相关测试通过 |

---

## 7. 一句话总结

当前项目里的 Feishu typing **已经实现**，但实现方式是 **通过 reaction 模拟 typing 状态**，不是单独的原生 typing indicator 接口。
