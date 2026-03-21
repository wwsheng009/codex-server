# UX 交互规范 (UX Interaction & Interactive Logic)

## 1. 交互核心理念：降低协作熵 (Reducing Cooperative Entropy)
Codex 的交互设计核心目标是 **降低协作熵**。这意味着系统的每一次交互都应增加“确定性”，减少用户在人机协作过程中的困惑。

- **确定性反馈 (Certainty)**: 所有的操作结果必须是可预测的。
- **一致性路径 (Consistency)**: 相似的任务应遵循相同的交互范式。
- **主动式引导 (Proactive)**: 在复杂逻辑中，通过 UI 预判用户下一步可能的需求并提供捷径。

## 2. 状态矩阵 (Interactive State Matrix)
所有交互元素必须实现以下五个核心状态的视觉与物理反馈。

| State | CSS Pseudo | Trigger | Visual Cue | Tactile/Haptic |
| :--- | :--- | :--- | :--- | :--- |
| `Default` | - | - | 基础样式 | - |
| `Hover` | `:hover` | 鼠标悬停 | 亮度提升或背景微光 | - |
| `Active` | `:active` | 鼠标点击/长按 | 尺寸微缩（Scale 0.98） | 轻度触感 (Light) |
| **Focus** | `:focus-visible` | **基于用户代理的聚焦可见性启发式** | 统一的聚焦环（2px Outline Color） | - |
| `Disabled` | `:disabled` | 不可用 | 透明度降至 40%，鼠标禁用指针 | - |

> **注**：`:focus-visible` 通常会在键盘导航等场景触发，但不应被文档简化成“只在 Tab 键时生效”。

## 3. 运动原则：表达性动效 (Expressive Motion)
弹性物理是一种可选的产品动效风格，不是外部规范要求：
- **Spring Overlays**: 弹出层（Modals/Drawers）进入时应有轻微的弹性回摆。推荐 `stiffness: 300, damping: 30`。
- **Magnetic Interaction**: 靠近关键操作按钮（如“发送”）时，光标或按钮本身可产生微弱的吸附感（Magnetic attraction）。

## 4. AI 专用 UI 模式 (AI-Specific UI Patterns)
AI 协作界面需要特定的交互闭环：
- **AI Labels**: AI 生成的每一段内容必须配备专属标识及“信任度”提示。
- **Progressive Disclosure**: 复杂生成的中间过程应通过“流式加载”实时展示，并允许随时中断（Stop Generation）。
- **Feedback Loops**: 每个 AI 输出端应内置 `Thumbs Up/Down` 快速反馈，并支持“引用到对话”的拖拽交互。

## 5. 反馈响应时序 (Feedback Timing)
- **即时响应 (< 100ms)**: 用于 Hover 和 Active。必须感觉到“触感”。
- **异步响应 (> 300ms)**: 显示局部加载器（Inline Spinner）。
- **长时间任务 (> 1s)**: 显示全局进度或骨架屏（Skeleton Screen）。

## 6. 组件级交互逻辑规范 (Component Logic)

### 模态框与抽屉 (Modals & Drawers)
- **生命周期 (Lifecycle)**:
  - **Mounting**: 是否在关闭时销毁内容取决于状态保留需求；不要把某个 UI 库的单一参数写成通用规则。
  - **Focus Trap**: 开启后必须将焦点锁定在容器内，直到关闭。
  - **Mask Control**: 是否允许点击遮罩关闭，应按风险分级决定；破坏性操作通常不应因为误点遮罩而直接关闭。
- **打开时**: 自动聚焦到默认操作（Primary Action）或首个输入框。
- **关闭方式**: 点击 Mask、按下 ESC、点击右上角关闭或 Cancel。
- **锁定逻辑**: 弹出层打开时，背景页面应 `overflow: hidden` 以防止滚动穿透。

### 过滤与搜索 (Filtering)
- **防抖行为 (Debounce)**: 搜索框在用户停止输入 300ms 后才触发请求。
- **即时反馈**: 展示“正在搜索...”的文字占位。

### 状态指示 (Status Pills)
- **静态 (Static)**: 用于描述（如：`v1.2.0`）。
- **动态 (Live)**: 用于监控（如：`Active`, `Error`）。
- **呼吸感**: `Active` 态应配合 2s 周期的柔和背景呼吸动画。

## 7. 辅助功能 (A11y & ARIA)
- **WCAG 2.2 Baseline**: 所有交互元素必须满足 AA 级对比度。
- **Role 语义化**: 每个功能块必须有对应的 ARIA Role（如 `role="main"`, `role="navigation"`）。
- **Tab 索引**: 表单内的 Tab 顺序应符合逻辑（从左往右，从上往下）。
- **屏幕阅读器**: 非文本元素（如图标按钮）必须配备 `aria-label`。

---
*规范依据: [APG Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) / [APG Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) / [WCAG 2.2](https://www.w3.org/TR/WCAG22/) / [统一来源基线](./UX_AUTHORITY_BASELINE.md)*
*审校: 2026-03-21*
