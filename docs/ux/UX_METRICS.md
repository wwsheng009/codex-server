# UX 指标体系 (UX Metrics System)

本页以 **Google HEART** 作为主框架，并补充适用于 AI 产品的 **产品级质量信号**。需要强调:

- **HEART 是外部研究框架**。
- **AI 质量信号是 Codex 的产品扩展**，不应伪装成行业统一标准。
- **所有定量指标都必须与定性研究联读**，不能单独解释。

## 1. 核心框架: HEART + AI 产品信号

| 类别 | 核心指标 | 典型信号 |
| :--- | :--- | :--- |
| **Happiness** | CSAT / helpfulness survey | “这次建议是否有帮助”“噪音是否过高” |
| **Engagement** | Feature engagement | AI 功能被使用的频率、深度和重复使用率 |
| **Adoption** | New-user / feature adoption | 新能力首次使用率、首次完成率 |
| **Retention** | Retention / repeat usage | 次日、7 日、30 日回访与持续使用 |
| **Task success** | Effectiveness + efficiency | 任务完成率、完成时间、错误率、返工率 |
| **产品级 AI 信号** | Accepted suggestion stability | 被采纳建议在后续一段时间内未被立即回滚、重写或禁用的比例 |

说明: Google HEART 原文强调指标应从产品目标映射而来，并与其他研究方法三角校验。因此，“采纳率高”不等于“质量高”，“停留时间长”也不一定等于“体验好”。

## 2. 效率与感知指标 (Efficiency and Perception)

### 2.1 流式效率 (Flow Efficiency)

- **Flow onset latency**: 用户发起请求到收到首个可行动结果的时间。
- **Context switch penalty**: 用户在编辑器、会话面板、预览和审批界面之间来回切换的频率。
- **Approval overhead**: 高影响操作从建议出现到完成审批的额外时间。

### 2.2 感知的 AI 效用 (Perceived AI Utility)

- **Helpfulness score**: AI 的帮助是否超过其带来的噪音。
- **Trust with verification**: 用户是否愿意在查看依据后授权 AI 执行更高影响的动作。
- **Provenance usefulness**: 来源展示是否真的帮助用户更快做出判断。

## 3. GSM 映射 (Goals, Signals, Metrics)

| 目标 | 信号 | 指标示例 |
| :--- | :--- | :--- |
| **减少返工** | 采纳后快速回滚、重写、二次修补变少 | Accepted suggestion stability、post-accept revert rate |
| **提升首轮质量** | 首次生成更接近可交付状态 | First-pass success、review pass rate |
| **降低认知负担** | 用户切换、回看、重复提问减少 | Context switch penalty、repeat prompt rate、NASA-TLX |
| **维持响应性** | 关键反馈不让用户失去上下文 | Time to first feedback、P95 completion time、queue escape rate |

## 4. 数据驱动的反馈闭环

- **埋点系统**: 记录请求、来源状态、工具调用、审批、采纳、回滚和最终结果。
- **定性反馈**: 结合拇指反馈、拒绝原因、研究访谈和可用性测试解释行为数据。
- **分层归因**: 把问题拆成模型质量、提示策略、检索质量、UI 摩擦、性能瓶颈五类，不要混成一个“采纳率”。

## 5. 指标警示线 (Guardrails)

警示线应根据产品基线设定，不建议把某个固定数字写成通用行业标准。推荐做法:

- **使用滚动基线**: 观察周同比、版本同比和任务分组差异，而不是孤立看单日绝对值。
- **把质量和性能分开告警**: 例如 “采纳后回滚率升高” 与 “首字节变慢” 应走不同排查路径。
- **保留人工复核样本**: 对高影响任务，持续抽样审核 AI 输出与采纳结果，避免指标漂移。

## 6. 规范依据 (Authority)

- [Google HEART paper](https://research.google.com/pubs/archive/36299.pdf)
- [NASA Task Load Index (TLX)](https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/)
- [NIST AI 600-1: Generative Artificial Intelligence Profile](https://doi.org/10.6028/NIST.AI.600-1)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
