# 组件状态矩阵 (Component State Matrix)

本页定义整套 UI 设计必须覆盖的**组件级状态空间**。如果没有这份矩阵，页面稿很容易只画默认态，导致实现阶段大量补状态。

## 1. 共享状态轴

任何核心组件，都至少要考虑以下状态轴:

| 状态轴 | 常见取值 |
| :--- | :--- |
| **交互态** | `default`, `hover`, `active`, `focus-visible`, `disabled` |
| **异步态** | `idle`, `loading`, `streaming`, `success`, `warning`, `error` |
| **选择态** | `unselected`, `selected`, `multi-selected` |
| **展开态** | `collapsed`, `expanded`, `docked`, `overlay` |
| **内容态** | `empty`, `filled`, `overflow`, `no-results` |
| **风险态** | `safe`, `warning`, `danger`, `approval-required` |

不是每个组件都要覆盖全部状态轴，但必须明确哪些适用、哪些不适用。

## 2. 组件矩阵

| 组件 | 变体 / 角色 | 必须覆盖的状态 | 关键说明 |
| :--- | :--- | :--- | :--- |
| **PrimaryNavItem** | 默认、激活、带 badge | default, hover, active, focus-visible, selected, collapsed-rail | 折叠 rail 下仍需可识别；图标与标签都要有可访问名称 |
| **WorkspaceGroup** | 展开、折叠 | expanded, collapsed, loading, empty | 展开收起不应丢失当前线程高亮 |
| **ThreadRow** | 默认、最近访问、归档、错误、等待审批 | default, hover, active, focus-visible, selected, renaming, status-badge, context-menu-open | 是高频切换节点，必须覆盖内联重命名和键盘导航 |
| **ComposerDock** | 空态、已输入、带附件 | idle, focused, filled, mention-open, sending, disabled, error | 固定在底部时要明确边界与安全区 |
| **PromptTextarea** | 单行、多行、mention 中 | default, focus-visible, composing, mention-open, overflow, disabled | 不能只画“空输入框” |
| **Scope / Model / Policy Pickers** | select / segmented / popover | closed, open, keyboard-nav, selected, disabled, invalid | 这些控件直接影响请求上下文，必须可检查 |
| **SendButton** | 发送、停止、重试 | default, hover, active, focus-visible, disabled, loading | 发出请求后状态切换要即时 |
| **TimelineBlock** | agent, reasoning, plan, command, fileChange, toolCall | default, expanded, collapsed, streaming, success, warning, error | 不同 block 至少共享统一外框、标题和元信息结构 |
| **ApprovalCard** | accept/decline/cancel/request input | pending, submitting, approved, declined, cancelled, failed | 审批卡是主工作流的一部分，不是旁路组件 |
| **DiffViewerPanel** | 关闭、打开、窄栏、宽栏 | hidden, visible, resized, file-selected, review-complete | 独立滚动、文件切换和关闭路径必须明确 |
| **BottomTerminalPanel** | 折叠、展开、运行中 | hidden, visible, resized, running, exited, error | 终端与时间线是并行上下文，不应互相覆盖 |
| **AutomationTemplateCard** | 默认、hover、选中 | default, hover, focus-visible, selected, disabled | 既是目录项，也是创建流程入口 |
| **AutomationRow** | 当前任务列表行 | default, hover, focus-visible, selected, status-badge | 要能跳转详情并展示频率、workspace 等元信息 |
| **SkillCard / SkillRow** | 已安装、未刷新、错误 | default, hover, focus-visible, loading, installed, error | 资源目录组件要支持空态与批量刷新反馈 |
| **SettingsNavItem** | 默认、当前 section | default, hover, focus-visible, selected | 设置导航必须保持稳定定位 |
| **SettingRow** | 只读、可编辑、错误 | default, editing, validating, success, warning, error, disabled | 必须明确定义保存粒度 |
| **ResourceListRow** | 设置资源列表、归档线程列表 | default, hover, focus-visible, selected, empty, loading | 列表行通常同时承担查看与操作入口 |
| **CommandPalette** | 搜索、建议、预览 | closed, open, typing, results, no-results, preview, keyboard-nav | 必须把无结果与危险命令预览画出来 |
| **Modal / ConfirmDialog** | 创建、确认、删除 | closed, open, submitting, success, error | 焦点进入、关闭、返回源元素都要定义 |
| **Drawer / SidePane** | 设置、详情、辅助面板 | closed, open, pinned, overlay, loading, error | 打开方式与页面主体关系必须明确 |
| **Toast / InlineNotice** | success, warning, error, info | enter, visible, dismissing, action-present | 不能把 toast 当作错误恢复主界面 |

## 3. 工作台专用组件

工作台页是状态最复杂的区域，以下组件必须有单独状态稿:

### 3.1 Thread Timeline

至少覆盖:

- 初次加载
- 历史回放
- 流式新增
- 长输出折叠
- 命令失败
- 文件变更出现
- 审批卡插入

### 3.2 Composer Dock

至少覆盖:

- 空态 placeholder
- 输入中
- mention / autocomplete 打开
- 带附件
- 发送中
- 发送失败可重试

### 3.3 Right Panel / Bottom Terminal

至少覆盖:

- 全收起
- 仅右栏打开
- 仅底部终端打开
- 右栏和终端同时打开
- 面板 resize 中

## 4. 目录页专用组件

目录型页面至少要定义两类组件:

- **Card 型资源项**: 自动化模板、技能卡片、workspace 卡片
- **Row 型资源项**: 当前任务、归档线程、设置资源列表

每类组件都必须至少给出:

- 默认态
- hover / focus-visible
- selected 或 current
- loading
- empty / no-results
- destructive action affordance

## 5. 设置页专用组件

设置页不能只定义字段控件，还要定义**容器级状态**:

- group with dirty changes
- list with loading
- editor block with validation errors
- action footer with save disabled / save pending / save success

## 6. 设计交付规则

每个核心组件在交付前，至少要有:

- 默认态
- 键盘焦点态
- 异步中的态
- 错误态
- 关闭或收起后的回到何处

如果组件承担高风险动作，还必须补:

- warning 态
- danger 态
- approval-required 态

## 7. 与代码实现的对齐

当前实现中可直接对应的代码区域包括:

- `frontend/src/components/shell/AppShell.tsx`
- `frontend/src/components/shell/SettingsShell.tsx`
- `frontend/src/components/thread/ThreadContent.tsx`
- `frontend/src/components/workspace/renderers.tsx`
- `frontend/src/components/ui/*.tsx`
- `frontend/src/pages/ThreadPage.tsx`

设计稿命名应尽量与这些组件职责对齐，避免“设计组件名”和“代码组件名”完全脱节。

## 8. 关联文档

- [页面蓝图](./PAGE_BLUEPRINTS.md)
- [交互规范](./UX_INTERACTION.md)
- [视觉反馈](./VISUAL_FEEDBACK.md)
- [组件设计规范](./COMPONENT_SPEC.md)

---
*没有状态矩阵的组件设计，不算可施工组件设计。*
