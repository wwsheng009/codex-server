# 韧性与恢复 (Resilience & Recovery)

## 1. 核心哲学: 容错式设计
在分布式与 AI 驱动的环境中，失败是必然的。设计的核心目标是确保在服务降级、高延迟或模型出错时，系统依然能够提供价值并引导用户恢复。

---

## 2. 韧性交互模式 (Resilience Patterns)

| 模式 (Pattern) | 机制 (Mechanism) | 交互细节 (Interaction Detail) |
| :--- | :--- | :--- |
| **乐观更新 (Optimistic UI)** | React 19 `useOptimistic` 风格 | 操作后立即更新 UI 状态，并在后台执行 API。失败后自动回滚并显示错误提示。 |
| **从错误到草稿 (Error-to-Draft)** | 状态保存与自动恢复 | AI 生成失败时，将已生成的部分（如有）存为“草稿”，允许用户手动修正并重试。 |
| **优雅降级 (Graceful Degradation)** | 动态功能降级 | AI 延迟 > 1s 时，自动切换为本地传统正则引擎或基础自动补全模式。 |

---

## 3. 非线性撤销与重做 (Global Undo/Redo)
AI 工作流往往是探索性的。传统的线性 Undo 不再满足需求。

### 3.1 基于快照的状态历史
- **全局历史面板**: 以时间线形式展示所有的重大变更（如：AI 自动重构、批量修改）。
- **快照跳转**: 支持将系统状态回退到任意一个特定的“稳定点”。

---

## 4. AI 延迟管理 (AI Latency Management)
- **渐进式感知 (Progressive Perception)**: 
  - < 100ms: 视觉即时响应。
  - 100ms - 1s: 显示微妙的 Loading 占位或进度。
  - > 1s: 显示预估剩余时间与当前正在执行的步骤（如：“正在检索相关文件...”）。

---

## 5. 故障恢复标准 (Recovery Standards)
- **Zero-Data-Loss**: 任何崩溃或断网后，用户最后一次交互的数据必须能够自动恢复。
- **Actionable Errors**: 错误提示必须包含：
  - **Why**: 故障原因（网络？API 限制？逻辑错误？）。
  - **How**: 明确的解决步骤（重试按钮？检查配置？手动编辑？）。

---

## 6. 韧性指标
- **Success After Failure (SAF)**: 用户在遇到错误后，通过建议的操作成功完成任务的比例。
- **Recovery Latency**: 用户从发现错误到回到正常工作流所需的平均时长。
- **Optimistic Consistency Rate**: 乐观更新后的状态与服务器最终确认状态的一致性比例。

---
*规范依据: [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) / [Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) / [统一来源基线](./UX_AUTHORITY_BASELINE.md)*
*审校: 2026-03-21*
