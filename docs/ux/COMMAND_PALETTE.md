# 命令面板规范 (Command Palette)

本页参考可访问搜索/建议组件与键盘交互模式，但命令排序、召回和快捷键方案仍是 Codex 的产品约定。

## 1. 交互与入口 (Interaction & Entry)

命令面板是系统的**中枢操作系统 (Central Operating System)**。

- **全局唤起 (Global Trigger)**: 统一使用 `Cmd + K` (macOS) 或 `Ctrl + K` (Windows/Linux)。
- **实时响应 (Real-time Response)**: 输入后的匹配反馈应尽量即时；`< 50ms` 可作为本地索引场景的产品目标，但不是通用标准。
- **分组策略 (Categorization)**:
  - **Action (动作)**: 命令性任务（如：新建工作区、清空会话）。
  - **Nav (导航)**: 页面或工作区跳转。
  - **Recent (最近)**: 最近访问过的文件或执行过的命令。

---

## 2. 智能上下文优先 (Context-Aware Prioritization)

结果排序不应仅依赖模糊匹配，而应根据**当前视口上下文 (Viewport Context)** 进行动态调权。

| 场景 (Current Context) | 优先展示 (Priority Results) |
| :--- | :--- |
| **代码编辑器 (Editor)** | 代码重构动作、格式化、跳转至定义。 |
| **会话 Thread (Chat)** | AI 角色切换、导出记录、重置 Context。 |
| **工作区管理 (Workspace)** | 导入文件、工作区设置、成员管理。 |
| **全局 (Default)** | 最近打开的 Thread、最常用的工具入口。 |

---

## 3. 实时预览与验证 (Real-time Preview)

在执行破坏性或大规模变更操作前，面板右侧应提供预览。

- **视觉影响 (Visual Impact)**: 鼠标悬停（Hover）在命令上时，背景或目标区域应以高亮或半透明层显示预期的变更。
- **参数动态填充 (Dynamic Argument Filling)**:
  - 输入 `Rename Thread:` 时，面板内显示输入框。
  - 输入后，实时在预览区展示更名后的 UI 效果。

---

## 4. 键盘驱动流 (Keyboard-Driven Workflow)

- **完全脱鼠 (Mouse-free)**: 所有的选择、参数输入、提交、取消操作均通过键盘完成。
- **快捷键直达 (Shortcuts)**: 在每一个常用命令旁，标注对应的原生快捷键（如：`Cmd + P`），引导用户从命令面板转向肌肉记忆。

---
*规范依据: [APG Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) / [APG Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) / [统一来源基线](./UX_AUTHORITY_BASELINE.md)*
*审校: 2026-03-21*
