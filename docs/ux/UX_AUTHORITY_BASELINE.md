# UX 权威来源基线 (Authority Baseline)

*审校日期: 2026-03-21*

本文件用于区分 `docs/ux` 中三类内容：

- **规范性要求**: 直接来自标准或正式规范，默认应视为最低基线。
- **平台指导**: 来自 Apple、Android、Ant Design 等官方文档，用于平台适配或实现细化。
- **研究结论**: 来自论文或研究机构，用于支撑产品策略、指标和交互假设，但通常不构成“合规要求”。
- **产品约定**: Codex 自身的 UI 决策。没有统一外部标准时，应在文档中明确写成“内部约定”或 “service goal”，不要伪装成行业标准。

## 1. 核心外部来源

### 1.1 Web 与无障碍规范

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [WAI Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)
- [APG: Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [APG: Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [APG: Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/)
- [WCAG Technique C39: prefers-reduced-motion](https://www.w3.org/WAI/WCAG21/Techniques/css/C39)

### 1.2 颜色、主题与响应式实现

- [CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/)
- [CSS Containment Module Level 3](https://www.w3.org/TR/css-contain-3/)
- [CSS Logical Properties and Values Level 1](https://www.w3.org/TR/css-logical-1/)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)
- [WCAG 3.0 Working Draft](https://www.w3.org/TR/wcag-3.0/)

说明: WCAG 3.0 仍是 Working Draft，尤其对比度算法尚未定稿，因此 `WCAG 2.2 AA` 仍应作为当前合规基线；APCA 类方法最多作为探索性诊断输入。

### 1.3 国际化与本地化

- [Structural markup and right-to-left text in HTML](https://www.w3.org/International/questions/qa-html-dir)
- [Inline markup and bidirectional text in HTML](https://www.w3.org/International/articles/inline-bidi-markup/index.en.html)
- [ECMAScript Internationalization API (ECMA-402)](https://tc39.es/ecma402/)

### 1.4 AI 与人机协作

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [NIST AI 600-1: Generative Artificial Intelligence Profile](https://doi.org/10.6028/NIST.AI.600-1)
- [Microsoft Research: Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)

### 1.5 指标、认知负荷与协作研究

- [Google HEART paper](https://research.google.com/pubs/archive/36299.pdf)
- [NASA Task Load Index (TLX)](https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/)
- [Cognitive Architecture and Instructional Design: 20 Years Later](https://link.springer.com/article/10.1007/s10648-019-09465-5)
- [Local-First Software: You Own Your Data, in spite of the Cloud](https://www.inkandswitch.com/local-first/static/local-first.pdf)

### 1.6 平台与设计系统指导

- [Apple UI Design Dos and Don'ts](https://developer.apple.com/design/tips/)
- [Android Developers: Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps)
- [Ant Design: Design Values](https://ant.design/docs/spec/values/)
- [Ant Design: Form Page](https://ant.design/docs/spec/research-form/)
- [Ant Design: Navigation](https://ant.design/docs/spec/research-navigation/)
- [Microsoft Style Guide](https://learn.microsoft.com/en-us/style-guide/)
- [Semantic Versioning 2.0.0](https://semver.org/)

### 1.7 数据可视化官方指导

- [Government Analysis Function: Data visualisation - charts](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/)
- [Government Analysis Function: Data visualisation - colours](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-colours-in-charts/)

## 2. 文档映射

| 文档 | 外部基线 | 说明 |
| :--- | :--- | :--- |
| `ACCESSIBILITY_DETAIL.md` | WCAG 2.2, APG, WAI Tables Tutorial, C39 | 合规性与交互细节应直接服从规范。 |
| `AI_UX_PATTERNS.md` | NIST AI RMF, NIST AI 600-1, Microsoft HAI | 透明度、溯源、审批、人工接管由外部来源约束；具体 UI 形态是产品约定。 |
| `ANIMATION_SYSTEM.md` | Media Queries Level 5, C39 | `prefers-reduced-motion` 是规范；时长 token 属产品约定。 |
| `COGNITIVE_LOAD.md` | Cognitive Load Theory review, NASA TLX | 认知负荷框架来自研究；密度策略是产品实现。 |
| `COLLABORATIVE_UX.md` | Local-First paper | CRDT/local-first 是架构思路；延迟预算应写成 service goal。 |
| `COLOR_PALETTE_GUIDE.md` | CSS Color 4, WCAG 2.2, DTCG Format | `oklch()` 已标准化；配色比例与步进是内部设计策略。 |
| `COMMAND_PALETTE.md` | APG Combobox, APG Keyboard Interface | 可访问搜索/建议模式有外部基线；排序与召回策略是产品约定。 |
| `COMPONENT_SPEC.md` | Ant Design Values, Form Page, Navigation, APG Dialog | 设计价值观与部件模式可参考平台文档；组件 API 仍以项目栈为准。 |
| `DATA_TABLES.md` | WAI Tables Tutorial, APG Grid | 原生表格与交互式 grid 的边界应按 WAI 文档处理。 |
| `DATA_VISUALIZATION.md` | Government Analysis Function charts/colors, WCAG 2.2 | 图表选型、用色、直接标注与文字替代有明确官方指导。 |
| `ETHICS_TRUST_AI.md` | NIST AI RMF, NIST AI 600-1, Microsoft HAI | 信任校准应建立在证据、限制披露与人工复核上。 |
| `I18N_LOCALIZATION.md` | W3C i18n docs, CSS Logical 1, ECMA-402 | 方向、双向文本与本地化 API 均有明确标准来源。 |
| `INTERACTIVE_ORCHESTRATION.md` | APG Dialog, APG Keyboard Interface | 焦点与键盘事件遵循规范；节流/防抖参数是工程预算。 |
| `LAYOUT_SYSTEM.md` | CSS Logical 1, CSS Containment 3 | 布局原语是内部方法论；响应式能力以 Web 规范为边界。 |
| `MOBILE_ADAPTATION.md` | Apple, Android, WCAG 2.2, CSS Containment 3 | 触控目标、移动端可达性与组件级响应式有官方基线。 |
| `RESILIENCE_RECOVERY.md` | NIST AI RMF, Microsoft HAI | AI 延迟披露与恢复策略可借鉴人机协作指导；数值阈值是产品 SLO。 |
| `SEARCH_FILTER.md` | APG Combobox, WCAG 2.2 | 搜索建议、实时公告与键盘行为应遵循 APG。 |
| `SYSTEM_GOVERNANCE.md` | SemVer, DTCG Format | 版本与 token 交换格式可外部对齐；治理流程仍属内部制度。 |
| `THEME_SYSTEM.md` | CSS Color 4, DTCG Format, WCAG 2.2, WCAG 3 draft | 主题 token 与 `oklch()` 有规范来源；APCA 只能作为探索性输入。 |
| `UI_WRITING.md` | Microsoft Style Guide | 语气、句式、大小写和错误消息写法可借鉴官方文案规范。 |
| `UX_GUIDE.md` | WCAG 2.2, NIST AI RMF, Microsoft HAI | 总纲需要明确哪些是外部标准，哪些是 Codex 内部约定。 |
| `UX_INTERACTION.md` | WCAG 2.2, APG Keyboard Interface, APG Dialog | 焦点、键盘路径、状态通报服从规范；动效细节是内部实现。 |
| `UX_METRICS.md` | Google HEART paper, NASA TLX, NIST AI 600-1 | HEART 是通用框架；AI 质量信号与阈值应声明为产品扩展。 |
| `VISUAL_FEEDBACK.md` | WCAG 2.2, Media Queries 5 | 焦点、非文本对比与减弱动效有规范基线；微交互 timing 是工程目标。 |

## 3. 使用约束

- 任何写成 “必须” 的语句，都应能在上面的规范或平台文档中找到依据；找不到时，应改写成 “建议” 或 “产品约定”。
- 任何固定数值阈值，例如 `50ms`、`70%`、`<100ms`、`3s`，如果不是标准条文，就应明确标注为 **service goal**、**默认预算** 或 **实验阈值**。
- 任何 AI 相关文案，不要把“单一置信度分数”写成充分的信任依据；优先披露证据、来源覆盖率、工具状态、失败原因和人工复核路径。
- 任何 APCA 或 WCAG 3 相关表述，都不得写成“当前已生效的合规标准”。
