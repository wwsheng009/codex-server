# UI 交付顺序 (UI Delivery Sequence)

本页给出一条适合当前 `codex-server` 的 UI 设计与实现推进顺序。目标不是平均铺开所有页面，而是优先完成最影响主流程、最能沉淀组件资产的部分。

## 1. 总体原则

- 先做 **shell 与组件基线**，再做页面细化。
- 先做 **P0 任务流**，再补长尾页面。
- 先补 **缺失状态**，再做视觉润色。
- 一个波次完成后，必须同时满足: `Figma frame`、`组件状态`、`验收清单`、`实现回指`。

## 2. Wave 0: Foundations

### 目标

建立所有后续页面共用的骨架与语言。

### 交付物

- header 三大家族: `mode-strip` / `PageHeader` / `SettingsPageHeader`
- `Modal` / `ConfirmDialog` / `InlineNotice` / `StatusPill` redline
- token 与变量映射
- frame 命名规则

### 主要锚点

- `../../frontend/src/components/ui/PageHeader.tsx`
- `../../frontend/src/components/settings/SettingsPrimitives.tsx`
- `../../frontend/src/components/ui/Modal.tsx`
- `../../frontend/src/components/ui/ConfirmDialog.tsx`
- `../../frontend/src/components/ui/InlineNotice.tsx`
- [DESIGN_TOKENS_SOURCE.md](./DESIGN_TOKENS_SOURCE.md)

### 完成定义

- 组件库和页面稿不再各自发明 header/notice/dialog。

## 3. Wave 1: Shells & Recovery

### 目标

先把整站公共框架稳定下来。

### 交付物

- AppShell desktop/mobile
- SettingsShell desktop/mobile
- 通知中心
- route error 与 404
- Command Palette default frame + global shortcut

### 主要锚点

- `../../frontend/src/components/shell/AppShell.tsx`
- `../../frontend/src/components/shell/SettingsShell.tsx`
- `../../frontend/src/components/shell/NotificationCenter.tsx`
- `../../frontend/src/pages/RouteErrorPage.tsx`
- `../../frontend/src/pages/NotFoundPage.tsx`

### 完成定义

- 任一主页面都能挂回稳定壳层。
- 恢复路径与全局覆盖层有明确设计稿与实现锚点。

## 4. Wave 2: Workspaces & Thread Core

### 目标

优先打通最关键的工作流: 进入 workspace、进入 thread、发送消息、审批、看输出。

### 交付物

- Workspaces 默认态、empty、error、create、remove
- Thread Workspace 主态
- composer states
- surface feed / approvals
- side rail expanded/collapsed/mobile
- terminal dock empty/sessions

### 主要锚点

- `../../frontend/src/pages/WorkspacesPage.tsx`
- `../../frontend/src/pages/ThreadPage.tsx`
- `../../frontend/src/pages/thread-page/ThreadPageLayout.tsx`
- `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx`
- `../../frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx`
- `../../frontend/src/pages/thread-page/ThreadComposerDock.tsx`
- `../../frontend/src/pages/thread-page/ThreadTerminalDock.tsx`

### 完成定义

- [PROTOTYPE_USER_FLOWS.md](./PROTOTYPE_USER_FLOWS.md) 中 Flow 1-4 能完整跑通。
- Workspaces 与 Thread 的 empty/error/confirm 不再缺口明显。

## 5. Wave 3: Automations

### 目标

把第二条主业务流做成可独立交付的页面组。

### 交付物

- Automations 目录页 default/loading/error/empty
- create automation modal
- template create/edit modal
- delete confirm
- automation detail default/loading/not-found/error
- run summary/logs/details modal

### 主要锚点

- `../../frontend/src/pages/AutomationsPage.tsx`
- `../../frontend/src/pages/AutomationDetailPage.tsx`

### 完成定义

- Flow 5-6 能跑通。
- detail 页高风险删除动作与全站模式一致。

## 6. Wave 4: Runtime & Skills

### 目标

补齐目录型页面与操作控制台页面。

### 交付物

- Skills default/loading/no-results/error
- Runtime inventory board
- Runtime action forms
- Runtime search / feedback / plugin action states
- 语言一致性第一轮清理

### 主要锚点

- `../../frontend/src/pages/SkillsPage.tsx`
- `../../frontend/src/pages/CatalogPage.tsx`

### 完成定义

- Skills 不再把“查询失败”伪装成“没有数据”。
- Runtime 的写操作具有清晰反馈路径。

## 7. Wave 5: Settings

### 目标

把设置中心从“页面集合”整理成统一设计系统的展示面。

### 交付物

- General
- Appearance
- Config
- Environment
- MCP
- Worktrees
- Archived Threads

### 主要锚点

- `../../frontend/src/pages/settings/GeneralSettingsPage.tsx`
- `../../frontend/src/pages/settings/AppearanceSettingsPage.tsx`
- `../../frontend/src/pages/settings/ConfigSettingsPage.tsx`
- `../../frontend/src/pages/settings/EnvironmentSettingsPage.tsx`
- `../../frontend/src/pages/settings/McpSettingsPage.tsx`
- `../../frontend/src/pages/settings/WorktreesSettingsPage.tsx`
- `../../frontend/src/pages/settings/ArchivedThreadsSettingsPage.tsx`

### 完成定义

- 至少形成 3 套可复用 settings 页面模板:
  - 表单型
  - 记录列表型
  - 混合输出型

## 8. Wave 6: Cross-Cutting Hardening

### 目标

处理那些不属于单页、但会显著影响整站完成度的问题。

### 交付物

- 统一 success feedback 模式
- 统一语言与本地化策略
- 完整移动端 frame 补齐
- accessibility 与 keyboard pass

### 主要锚点

- [COMMAND_PALETTE.md](./COMMAND_PALETTE.md)
- [I18N_LOCALIZATION.md](./I18N_LOCALIZATION.md)
- [ACCESSIBILITY_DETAIL.md](./ACCESSIBILITY_DETAIL.md)
- [UI_IMPLEMENTATION_GAP_AUDIT.md](./UI_IMPLEMENTATION_GAP_AUDIT.md)

### 完成定义

- 整套 UI 不再只是在“主要路径可用”，而是进入“可以稳定 handoff 与实现”的阶段。

## 9. 不建议的推进方式

- 不要先把所有页面都画一版默认态。
- 不要先做视觉样张，再回头补状态。
- 不要把 Command Palette、恢复态、移动态永远放到最后。
- 不要跳过 shell 与 header 规范，直接逐页出高保真。

## 10. 推荐节奏

如果按设计交付顺序推进，建议节奏如下:

1. `Wave 0 + Wave 1`
2. `Wave 2`
3. `Wave 3`
4. `Wave 4 + Wave 5`
5. `Wave 6`

其中 `Wave 2` 必须单独成波次，因为它会决定大量后续组件和布局基线。

## 11. 关联文档

- [Figma Frame 清单](./FIGMA_FRAME_INVENTORY.md)
- [页面蓝图](./PAGE_BLUEPRINTS.md)
- [组件库规格书](./COMPONENT_LIBRARY_SPEC.md)
- [设计验收清单](./DESIGN_ACCEPTANCE_CHECKLIST.md)

---
*这份顺序的核心不是“谁先谁后好看”，而是先把最能沉淀系统资产的页面组打透。*
