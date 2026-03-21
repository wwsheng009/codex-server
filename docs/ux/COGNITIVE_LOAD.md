# 认知负荷管理 (Cognitive Load Management)

本页以 **认知负荷理论** 与 **NASA TLX** 为研究基础。需要特别避免把 “7+-2” 之类的旧口号直接当成工程规则；对复杂 AI 工具，更有效的做法是分块、减噪和渐进披露。

## 1. 核心理论: 认知负荷三元模型

在复杂 IDE 与 AI 协作场景中，目标是控制负荷，而不是一味“减少所有信息”。

| 负荷类型 | 目标 | 策略 |
| :--- | :--- | :--- |
| **内在负荷 (Intrinsic)** | 管理 | 把复杂任务拆成可理解的阶段。 |
| **外在负荷 (Extraneous)** | 降低 | 去掉无关动画、噪音、重复状态和不必要术语。 |
| **关联负荷 (Germane)** | 支持 | 帮助用户建立正确心智模型，例如来源、diff、执行范围。 |

## 2. 适应性 UI: 动态密度调整 (Dynamic Density Adjustment)

UI 密度应服务于当前任务，而不是固定美学偏好。

- **专注模式**: 折叠次要导航，保留主任务、关键状态和必要回退路径。
- **全局概览**: 在系统分析、批量审查或多对象比较时，提高信息密度，但仍要保留清晰的分组与过滤手段。

## 3. 分块与渐进披露 (Chunking and Progressive Disclosure)

### 3.1 分块原则

- **按任务语义分块**: 把建议、日志、diff、审批和来源拆成彼此可识别的块。
- **按风险分块**: 把高风险内容放在需要主动展开或审批的位置。
- **按时间分块**: 长流程分阶段显示，不要把检索、推理、执行和结论堆在一个面板里。

### 3.2 渐进披露

- **默认只显示做决定所需的最小信息**。
- **细节按需展开**: 例如完整 diff、完整来源、工具输出、长日志和推理中间态。
- **避免一次性塞满**: “更多信息” 应该降低理解成本，而不是制造新的滚动负担。

## 4. 视觉层级与导向 (Visual Hierarchy)

- **位置稳定**: 高频动作与关键反馈保持稳定位置，减少视觉搜索。
- **颜色克制**: 饱和色主要用于错误、警告、成功和需要关注的状态。
- **层级明确**: 标题、摘要、主结论、次要解释和元信息要能一眼区分。

## 5. 认知负荷评估 (Measurement)

- **Task success rate**: 是否真的帮助用户完成任务。
- **Task completion time**: 用户从理解问题到执行决策的时间。
- **NASA-TLX**: 用于周期性评估主观工作负荷。
- **Context switch penalty**: 用户是否被迫在多个区域间来回确认信息。

## 6. 规范依据 (Authority)

- [Cognitive Architecture and Instructional Design: 20 Years Later](https://link.springer.com/article/10.1007/s10648-019-09465-5)
- [NASA Task Load Index (TLX)](https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
