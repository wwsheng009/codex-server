# AI UX 交互模式 (AI UX Patterns)

本页基于 **NIST AI RMF**、**NIST AI 600-1** 与 **Microsoft Research: Guidelines for Human-AI Interaction**，在此基础上定义 Codex 的产品级 AI 交互模式。凡是没有统一行业标准的部分，以下内容明确写为 **产品约定**，而不是“外部规范”。

## 1. 核心理念 (Core Concepts)

### 1.1 代理式 UI (Agentic UI)

AI 可以代表用户规划步骤、调用工具和串联上下文，但必须满足三个前提:

- **可检查 (Inspectable)**: 用户能看到 AI 准备做什么、为什么做、影响范围是什么。
- **可中断 (Interruptible)**: 长任务或多步骤任务必须允许暂停、取消或收窄范围。
- **可接管 (Overridable)**: 高影响动作始终保留人工审批或手动改做路径。

### 1.2 基于意图的导航 (Intent-based Navigation)

自然语言可以成为入口，但不能替代清晰的系统状态。

- **意图表达是入口，不是黑箱跳转**: 输入 “修这个错误” 后，系统仍应把目标文件、命令或工作区范围讲清楚。
- **动作映射必须可见**: 把模糊意图解析为具体动作时，需展示受影响对象、即将执行的步骤和回退方式。

## 2. 流式反馈标准 (Streaming Standards)

| 特性 | 产品要求 | 说明 |
| :--- | :--- | :--- |
| **语义分块 (Semantic chunking)** | 按句子、段落、工具步骤或 diff 块流式追加 | 不默认使用“逐字符打字机效果”伪装思考过程。 |
| **来源透明 (Provenance visibility)** | 有来源时显示文件、工具、引用或检索命中；无来源时明确标注“当前未附依据” | 溯源状态比单个置信度数值更重要。 |
| **等待状态 (Pending state)** | 工具运行、检索、审批等待时展示稳定的中间态 | 避免布局跳动和含义不明的脉冲动画。 |
| **可控流式 (Controllable streaming)** | 支持停止生成、折叠中间步骤、只看最终结论或 diff | 用户应能管理信息密度。 |

## 3. 人机协同 (Human-in-the-Loop, HITL)

### 3.1 决策门控 (Decision Gating)

对于会改动代码、数据、权限、环境或工作流的动作，必须加门控。

- **显式确认**: 默认拦截破坏性或高影响操作，例如覆盖文件、执行脚本、批量删除。
- **上下文对齐**: 审批前展示目标范围、受影响文件、关键参数和预期结果。
- **可撤销优先**: 能通过撤销实现保护时，优先用撤销；不可逆动作再升级到二次确认。

### 3.2 可解释性与审批 (Explainability and Approval)

- **并排对比**: 代码、配置或文本修改应提供“当前值 / 建议值 / 差异”视图。
- **证据优先**: 如果建议依赖检索、工具调用或外部文档，应展示证据来源与失败状态。
- **审批动作简单明确**:
  - `Accept`: 采用建议并记录。
  - `Refine`: 保留上下文继续协作修正。
  - `Discard`: 放弃当前建议，不制造残留状态。

## 4. 异常处理与不确定性 (Error and Uncertainty)

- **不要把信任简化为单一百分比**: 单个 “70% 置信度” 既不稳定，也难以解释来源。
- **优先披露不确定性的原因**: 例如检索覆盖不足、工具执行失败、用户意图不明确、上下文冲突、来源缺失。
- **失败模式要能退化**: AI 不可用时，界面必须能回退到传统手动流程，而不是让用户卡死在 AI 壳层里。
- **避免拟人化误导**: 不要用“AI 很确定”“AI 觉得没问题”之类措辞替代证据与验证状态。

## 5. 规范依据 (Authority)

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [NIST AI 600-1: Generative Artificial Intelligence Profile](https://doi.org/10.6028/NIST.AI.600-1)
- [Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
