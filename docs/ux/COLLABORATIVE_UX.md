# 协作式 UX (Collaborative UX)

本页以 **local-first / CRDT 友好交互** 作为架构基础。需要明确:

- “共存感” 是体验目标。
- `<100ms`、`RTT < 150ms` 这类数字如果出现，应被写成 **service goal**，不是外部标准。

## 1. 核心目标: 共存感 (Co-presence)

在分布式开发中，协作 UI 的目标是让用户感觉“他人正在这里”，同时又不会被同步噪音打断主任务。

## 2. 实时感知模式 (Presence Indicators)

| 模式 | 技术实现 | 交互规范 |
| :--- | :--- | :--- |
| **实时光标** | WebSocket 或增量同步 | 显示用户身份和当前位置；静止一段时间后弱化以减少噪音。 |
| **活跃头像** | 会话心跳 / presence 状态 | 展示谁在线、谁在看哪里，必要时支持跟随视图。 |
| **操作广播** | 轻量提示或局部状态标识 | 当他人正在编辑同一对象时，优先在局部提醒而不是全局打断。 |

## 3. 冲突处理与状态一致性 (Local-first / CRDT-friendly UI)

### 3.1 乐观状态管理 (Optimistic State Management)

- **本地先回显**: 用户操作应先在本地看到结果，再异步同步。
- **失败可恢复**: 同步失败时，UI 必须标明状态并提供重试、保留本地版本或查看冲突的入口。

### 3.2 冲突可视化 (Conflict Visualization)

- **冲突需被定位**: 无法自动合并时，明确指出对象、字段、作者和时间。
- **差异需可比较**: 优先使用并排 diff、局部高亮和决策按钮，而不是抽象提示“同步失败”。

## 4. 协作预算 (Service Goals)

以下是产品级预算，不是外部规范:

- **本地回显**: 用户本地操作应尽可能立即反馈。
- **远端存在感**: 远端光标和 presence 更新应平滑，而不是高频抖动。
- **差量同步优先**: 优先传播 diff 或操作日志，而不是整块状态覆盖。

## 5. 协作健康度指标

- **Sync conflict rate**: 自动合并失败并需要人工干预的频率。
- **Recovery success rate**: 用户在冲突后成功完成恢复或合并的比例。
- **Latency impact score**: 延迟对任务效率和误操作率的影响。

## 6. 规范依据 (Authority)

- [Local-First Software: You Own Your Data, in spite of the Cloud](https://www.inkandswitch.com/local-first/static/local-first.pdf)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
