# UX 交互规范 (UX Interaction & Interactive Logic)

## 1. 状态矩阵 (Interactive State Matrix)
所有交互元素必须实现以下五个核心状态的视觉反馈。
| State | CSS Pseudo | Trigger | Visual Cue |
| :--- | :--- | :--- | :--- |
| `Default` | - | - | 基础样式 |
| `Hover` | `:hover` | 鼠标悬停 | 亮度提升（Luminance +10%）或 背景色变浅（Soft Overlay） |
| `Active` | `:active` | 鼠标点击/长按 | 尺寸微缩（Transform scale 0.98）或 深度反向（Inset shadow） |
| `Focus` | `:focus-visible` | Tab 键导航 | 2px 描边偏移（Outline offset 2px），颜色：`--border-accent` |
| `Disabled` | `:disabled` | 不可用 | 透明度降至 40% (Opacity 0.4)，指针：`not-allowed` |

## 2. 反馈反馈响应时序 (Feedback Timing)
- **即时响应 (< 100ms)**: 用于 Hover 和 Active。必须感觉到“触感”。
- **异步响应 (> 300ms)**: 显示局部加载器（Inline Spinner）。
- **长时间任务 (> 1s)**: 显示全局进度或骨架屏（Skeleton Screen）。

## 3. 组件级交互逻辑规范 (Component Logic)

### 模态框 (Modals & Dialogs)
- **打开时**: 自动聚焦到默认操作（Primary Action）。
- **关闭方式**: 点击 Back-drop、按下 ESC、点击 Cancel。
- **锁定逻辑**: 模态框打开时，背景页面应 `overflow: hidden`。

### 过滤与搜索 (Filtering)
- **防抖行为 (Debounce)**: 搜索框在用户停止输入 300ms 后才触发请求。
- **即时反馈**: 展示“正在搜索...”的文字占位。

### 状态指示 (Status Pills)
- **静态 (Static)**: 用于描述（如：`v1.2.0`）。
- **动态 (Live)**: 用于监控（如：`Active`, `Error`）。
- **呼吸感**: `Active` 态应配合 2s 周期的柔和背景呼吸动画。

## 4. 辅助功能 (A11y & ARIA)
- **Role 语义化**: 每个功能块必须有对应的 ARIA Role（如 `role="main"`, `role="navigation"`）。
- **Tab 索引**: 表单内的 Tab 顺序应符合逻辑（从左往右，从上往下）。
- **屏幕阅读器**: 非文本元素（如图标按钮）必须配备 `aria-label`。
