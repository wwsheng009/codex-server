# AI 伦理与信任 (AI Ethics and Trust)

本页采用 **NIST AI RMF**、**NIST AI 600-1** 与 **Microsoft 人机协作指南** 作为外部依据。目标不是让用户“更相信 AI”，而是让信任与证据、风险和控制权保持一致。

## 1. 核心理念: 信任校准而非信任放大

信任不是单向增长指标，而是需要被持续校准的系统状态。设计重点如下:

- **防止过度依赖**: 不能用顺滑的 UI 或拟人化表述掩盖证据不足、来源缺失或失败状态。
- **防止不必要的不信任**: 当系统确有充分依据时，也应帮助用户快速检查与采纳，而不是一味增加摩擦。
- **关键动作保留人工责任**: 高风险决策必须允许人工审批、覆写和回退。

## 2. 信任支柱 (Pillars of Trust)

| 支柱 | 技术要求 | 交互表现 |
| :--- | :--- | :--- |
| **透明度 (Transparency)** | 明确系统能力边界、失败模式和限制 | 展示模型/工具状态、已知风险、失败原因，而不是笼统“已完成” |
| **来源与可追踪性 (Provenance and traceability)** | 跟踪内容来源、修改链路和版本历史 | 可查看文件、文档、引用、工具执行记录或变更历史 |
| **可控性 (Controllability)** | 保留暂停、拒绝、覆写、撤销和缩小范围的能力 | 高影响动作前展示 diff、范围和批准入口 |
| **申诉与反馈 (Recourse and feedback)** | 用户能指出错误并影响后续系统改进 | 记录拒绝原因、错误类型、来源问题和人工接管案例 |

## 3. 设计中的重点风险

### 3.1 探索模式与执行模式

- **探索模式**: 可以提供多方案与替代视角，但必须清楚标记“候选”而非“已验证答案”。
- **执行模式**: 当动作会写入文件、执行命令或影响共享状态时，界面应收紧范围并强化审批。

### 3.2 偏见、拟人化与来源缺失

- **偏见监测**: 对高影响输出保留复核、替代方案和人工纠偏路径。
- **限制拟人化**: 不用“AI 觉得”“AI 很确信”这类表述替代证据展示。NIST AI 600-1 明确建议跟踪界面中的拟人化元素。
- **来源缺失要显式披露**: 若当前答案没有可验证来源，应明确标出“未附来源 / 未完成校验”，而不是把界面做成像已审定的结论。

## 4. 关键指标 (Trust Metrics)

以下指标可用于观察信任是否被正确校准，但它们都需要与定性研究一起解释:

- **Misuse rate**: 用户因过度信任而采纳错误建议的频率。
- **Disuse rate**: 用户因缺乏信任而忽略有效建议的频率。
- **Calibration time**: 用户完成核验并决定是否采纳所需时间。
- **Provenance coverage**: 关键输出中带有可核查来源或变更链路的占比。
- **Override rate**: 用户或审查系统主动覆写 AI 决策的频率，以及对应原因。

## 5. 规范依据 (Authority)

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [NIST AI 600-1: Generative Artificial Intelligence Profile](https://doi.org/10.6028/NIST.AI.600-1)
- [Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
