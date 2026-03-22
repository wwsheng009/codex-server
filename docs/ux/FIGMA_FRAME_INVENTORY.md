# Figma Frame 清单 (Figma Frame Inventory)

本页把当前代码中的真实路由、shell 和复杂状态，拆成可以直接在 Figma 中建稿的 frame 清单。它是 [Figma 交付包说明](./FIGMA_HANDOFF_PACKAGE.md) 的逐页展开版。

## 1. 使用规则

- 先画 `desktop` 主路径，再补 `mobile` 的关键 frame。
- 先完成 **P0 shell + P0 flow**，再进入视觉细化。
- 所有 frame 名称必须能回指到真实页面、组件或覆盖层。
- 如果某个 frame 代表“文档要求但代码尚未实现”的状态，要在 Figma 中打 `target-state` 标记。

## 2. 命名格式

推荐统一采用:

```text
Shell / App / Desktop / Expanded
Page / Workspaces / Empty Registry
Page / Thread Workspace / Streaming
Overlay / Automation Run / Logs
State / Route Error / Settings Panel
```

补充标签建议:

- `desktop`
- `mobile`
- `target-state`
- `p0` / `p1` / `p2`

## 3. 04 Shell & Navigation

| Frame | Priority | Source Anchor | Notes |
| :--- | :--- | :--- | :--- |
| `Shell / App / Desktop / Expanded` | P0 | `../../frontend/src/components/shell/AppShell.tsx` | 左侧工作区与线程树展开。 |
| `Shell / App / Desktop / Collapsed` | P0 | `../../frontend/src/components/shell/AppShell.tsx` | 仅显示 rail icon。 |
| `Shell / App / Mobile / Closed` | P0 | `../../frontend/src/components/shell/AppShell.tsx` | 内容优先，侧栏关闭。 |
| `Shell / App / Mobile / Open` | P0 | `../../frontend/src/components/shell/AppShell.tsx` | 移动端抽屉式侧栏。 |
| `Shell / Settings / Desktop` | P0 | `../../frontend/src/components/shell/SettingsShell.tsx` | 独立设置模式。 |
| `Shell / Settings / Mobile` | P1 | `../../frontend/src/components/shell/SettingsShell.tsx` | 侧栏压缩后的设置中心。 |
| `Overlay / Sidebar Menu / Workspace` | P1 | `../../frontend/src/components/shell/AppShell.tsx` | workspace 更多操作菜单。 |
| `Overlay / Sidebar Menu / Thread` | P1 | `../../frontend/src/components/shell/AppShell.tsx` | thread 更多操作菜单。 |
| `Overlay / Rename / Workspace` | P1 | `../../frontend/src/components/ui/RenameDialog.tsx` | workspace 重命名。 |
| `Overlay / Rename / Thread` | P1 | `../../frontend/src/components/ui/RenameDialog.tsx` | thread 重命名。 |
| `Overlay / Confirm / Delete Workspace` | P0 | `../../frontend/src/components/ui/ConfirmDialog.tsx` | 删除 workspace。 |
| `Overlay / Confirm / Delete Thread` | P0 | `../../frontend/src/components/ui/ConfirmDialog.tsx` | 删除 thread。 |
| `Overlay / Notification Center / Default` | P1 | `../../frontend/src/components/shell/NotificationCenter.tsx` | 通知抽屉。 |
| `Overlay / Command Palette / Default` | P0 | `../../frontend/src/components/shell/CommandPalette.tsx` | 已接入 `AppShell` 菜单栏入口与 `Ctrl/Cmd + K`。 |

## 4. 05 Workspaces

| Frame | Priority | Source Anchor | Notes |
| :--- | :--- | :--- | :--- |
| `Page / Workspaces / Default` | P0 | `../../frontend/src/pages/WorkspacesPage.tsx` | registry 列表主态。 |
| `Page / Workspaces / Loading` | P0 | `../../frontend/src/pages/WorkspacesPage.tsx` | `Loading registry…`。 |
| `Page / Workspaces / Restarting` | P1 | `../../frontend/src/pages/WorkspacesPage.tsx` | 单行 workspace 进入 restarting。 |
| `Overlay / Workspaces / Create Workspace` | P0 | `../../frontend/src/components/workspace/CreateWorkspaceDialog.tsx` | 创建 workspace modal。 |
| `Overlay / Workspaces / Create Workspace Error` | P1 | `../../frontend/src/components/workspace/CreateWorkspaceDialog.tsx` | 表单错误/后端错误。 |
| `Overlay / Workspaces / Remove Confirm` | P0 | `../../frontend/src/pages/WorkspacesPage.tsx` | 删除确认。 |
| `Page / Workspaces / Empty Registry` | P0 | `../../frontend/src/pages/WorkspacesPage.tsx` | 已有显式 empty-state 与主 CTA。 |
| `Page / Workspaces / Load Error` | P0 | `../../frontend/src/pages/WorkspacesPage.tsx` | 已有 `InlineNotice` + retry。 |

## 5. 06 Thread Workspace

| Frame | Priority | Source Anchor | Notes |
| :--- | :--- | :--- | :--- |
| `Page / Thread Workspace / No Thread Selected` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | 进入 workspace 但未选 thread。 |
| `Page / Thread Workspace / Empty Thread` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | thread 已选但无消息。 |
| `Page / Thread Workspace / Active Timeline` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | 默认主工作态。 |
| `Page / Thread Workspace / Sending` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | composer 已发送，等待 turn。 |
| `Page / Thread Workspace / Streaming Pinned` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | 自动跟随最新输出。 |
| `Page / Thread Workspace / Streaming Unpinned` | P1 | `../../frontend/src/pages/thread-page/ThreadComposerDock.tsx` | 出现 jump-to-latest。 |
| `Page / Thread Workspace / Runtime Error Notice` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | 线程运行异常 notice。 |
| `Page / Thread Workspace / Approval Dialog` | P0 | `../../frontend/src/pages/thread-page/ThreadComposerDock.tsx` | composer 上方审批卡。 |
| `Page / Thread Workspace / Surface Panel Feed` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | 右/左内嵌 feed panel。 |
| `Page / Thread Workspace / Surface Panel Approvals` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | 内嵌 approvals panel。 |
| `Page / Thread Workspace / Surface Panel Empty Feed` | P1 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | 无 feed entry。 |
| `Page / Thread Workspace / Surface Panel Empty Approvals` | P1 | `../../frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx` | 无待审批项。 |
| `Page / Thread Workspace / Rail Expanded` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx` | 展开侧 rail。 |
| `Page / Thread Workspace / Rail Collapsed` | P0 | `../../frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx` | 折叠图标 rail。 |
| `Page / Thread Workspace / Rail Mobile Overlay` | P1 | `../../frontend/src/pages/thread-page/ThreadPageLayout.tsx` | 移动端工作台覆盖层。 |
| `Page / Thread Workspace / Terminal Empty` | P1 | `../../frontend/src/pages/thread-page/ThreadTerminalDock.tsx` | 打开终端但无 session。 |
| `Page / Thread Workspace / Terminal Sessions` | P0 | `../../frontend/src/pages/thread-page/ThreadTerminalDock.tsx` | 有 tab、有输出、有 stdin。 |
| `Page / Thread Workspace / Terminal Collapsed` | P1 | `../../frontend/src/pages/thread-page/ThreadTerminalDock.tsx` | 底 dock 折叠。 |
| `Overlay / Thread / Delete Confirm` | P0 | `../../frontend/src/pages/thread-page/ThreadPageLayout.tsx` | 删除当前 thread。 |
| `Overlay / Thread / Rename Inline` | P1 | `../../frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx` | rail 中重命名表单。 |

## 6. 07 Automations

| Frame | Priority | Source Anchor | Notes |
| :--- | :--- | :--- | :--- |
| `Page / Automations / Directory Default` | P0 | `../../frontend/src/pages/AutomationsPage.tsx` | 自动化目录 + 模板区。 |
| `Page / Automations / Directory Loading` | P0 | `../../frontend/src/pages/AutomationsPage.tsx` | 列表加载。 |
| `Page / Automations / Directory Error` | P0 | `../../frontend/src/pages/AutomationsPage.tsx` | automations/templates 读取错误。 |
| `Page / Automations / Directory Empty` | P1 | `../../frontend/src/pages/AutomationsPage.tsx` | 无自动化记录。 |
| `Overlay / Automations / Create Modal` | P0 | `../../frontend/src/pages/AutomationsPage.tsx` | 新建 automation。 |
| `Overlay / Automations / Create Modal Error` | P0 | `../../frontend/src/pages/AutomationsPage.tsx` | 校验失败或后端错误。 |
| `Overlay / Automations / Template Modal Create` | P1 | `../../frontend/src/pages/AutomationsPage.tsx` | 新建模板。 |
| `Overlay / Automations / Template Modal Edit` | P1 | `../../frontend/src/pages/AutomationsPage.tsx` | 编辑模板。 |
| `Overlay / Automations / Delete Confirm` | P0 | `../../frontend/src/pages/AutomationsPage.tsx` | 目录页删除 automation。 |
| `Page / Automation Detail / Default` | P0 | `../../frontend/src/pages/AutomationDetailPage.tsx` | 最近运行 + prompt 配置。 |
| `Page / Automation Detail / Runs Empty` | P1 | `../../frontend/src/pages/AutomationDetailPage.tsx` | 无运行记录。 |
| `Page / Automation Detail / Loading` | P0 | `../../frontend/src/pages/AutomationDetailPage.tsx` | detail loading。 |
| `Page / Automation Detail / Not Found` | P0 | `../../frontend/src/pages/AutomationDetailPage.tsx` | automation 不存在。 |
| `Page / Automation Detail / Error` | P0 | `../../frontend/src/pages/AutomationDetailPage.tsx` | detail 读取失败。 |
| `Overlay / Automation Run / Summary` | P0 | `../../frontend/src/pages/AutomationDetailPage.tsx` | run summary modal。 |
| `Overlay / Automation Run / Logs` | P0 | `../../frontend/src/pages/AutomationDetailPage.tsx` | run logs modal。 |
| `Overlay / Automation Run / Details` | P0 | `../../frontend/src/pages/AutomationDetailPage.tsx` | run details modal。 |
| `Overlay / Automation Detail / Delete Confirm` | P0 | `../../frontend/src/pages/AutomationDetailPage.tsx` | detail 页删除已进入确认层。 |

## 7. 08 Skills

| Frame | Priority | Source Anchor | Notes |
| :--- | :--- | :--- | :--- |
| `Page / Skills / Default` | P0 | `../../frontend/src/pages/SkillsPage.tsx` | workspace scope + installed/remote 两栏。 |
| `Page / Skills / Loading` | P0 | `../../frontend/src/pages/SkillsPage.tsx` | directory section loading。 |
| `Page / Skills / Installed Empty` | P1 | `../../frontend/src/pages/SkillsPage.tsx` | 本地为空。 |
| `Page / Skills / Remote Empty` | P1 | `../../frontend/src/pages/SkillsPage.tsx` | 远程为空。 |
| `Page / Skills / No Results` | P1 | `../../frontend/src/pages/SkillsPage.tsx` | 搜索命中为空。 |
| `Page / Skills / Query Error` | P0 | `../../frontend/src/pages/SkillsPage.tsx` | installed/remote 查询已提供显式 error notice。 |

## 8. 09 Runtime

| Frame | Priority | Source Anchor | Notes |
| :--- | :--- | :--- | :--- |
| `Page / Runtime / Default` | P0 | `../../frontend/src/pages/CatalogPage.tsx` | inventory board + console grid。 |
| `Page / Runtime / Workspace Required` | P0 | `../../frontend/src/pages/CatalogPage.tsx` | 无 workspace 时 notice。 |
| `Page / Runtime / Loading` | P0 | `../../frontend/src/pages/CatalogPage.tsx` | inventory loading。 |
| `Page / Runtime / Inventory Error` | P0 | `../../frontend/src/pages/CatalogPage.tsx` | runtime catalog 读取失败。 |
| `Page / Runtime / Empty Section` | P1 | `../../frontend/src/pages/CatalogPage.tsx` | 任一 section 无数据。 |
| `Page / Runtime / Plugin Action` | P1 | `../../frontend/src/pages/CatalogPage.tsx` | read / install / uninstall 表单。 |
| `Page / Runtime / Search Result` | P1 | `../../frontend/src/pages/CatalogPage.tsx` | fuzzy file search 结果。 |
| `Page / Runtime / Feedback Submit` | P1 | `../../frontend/src/pages/CatalogPage.tsx` | feedback 上传结果。 |

## 9. 10 Settings

| Frame | Priority | Source Anchor | Notes |
| :--- | :--- | :--- | :--- |
| `Page / Settings / Shell Default` | P0 | `../../frontend/src/components/shell/SettingsShell.tsx` | 左侧分区导航。 |
| `Page / Settings / General / Signed In` | P0 | `../../frontend/src/pages/settings/GeneralSettingsPage.tsx` | 账户状态、登录流程、额度。 |
| `Page / Settings / General / Error` | P1 | `../../frontend/src/pages/settings/GeneralSettingsPage.tsx` | auth/rate limit 错误。 |
| `Page / Settings / Appearance / Default` | P0 | `../../frontend/src/pages/settings/AppearanceSettingsPage.tsx` | 主题、颜色、字号。 |
| `Page / Settings / Config / Runtime Prefs Loading` | P1 | `../../frontend/src/pages/settings/ConfigSettingsPage.tsx` | runtime preferences loading。 |
| `Page / Settings / Config / Config Empty` | P1 | `../../frontend/src/pages/settings/ConfigSettingsPage.tsx` | 配置不可用或 requirements 缺失。 |
| `Page / Settings / Environment / Empty Workspaces` | P1 | `../../frontend/src/pages/settings/EnvironmentSettingsPage.tsx` | 无 workspace。 |
| `Page / Settings / MCP / OAuth Error` | P1 | `../../frontend/src/pages/settings/McpSettingsPage.tsx` | OAuth 失败。 |
| `Page / Settings / Archived Threads / Empty` | P1 | `../../frontend/src/pages/settings/ArchivedThreadsSettingsPage.tsx` | 无归档线程。 |
| `Page / Settings / Worktrees / Empty` | P1 | `../../frontend/src/pages/settings/WorktreesSettingsPage.tsx` | root summary 为空。 |

## 10. 11 Overlays

除了页面页签中的局部 modal，还需要单独做一页 overlays：

- `Overlay / Modal / Generic`
- `Overlay / Confirm Dialog / Generic`
- `Overlay / Rename Dialog / Generic`
- `Overlay / Notification Center / Empty`
- `Overlay / Notification Center / Loaded`
- `Overlay / Automation Run / Logs`
- `Overlay / Create Workspace / Error`

这些 overlay 要与 [COMPONENT_LIBRARY_SPEC.md](./COMPONENT_LIBRARY_SPEC.md) 中的 `Modal`、`ConfirmDialog`、`InlineNotice` 对齐。

## 11. 12 Error & Recovery

| Frame | Priority | Source Anchor | Notes |
| :--- | :--- | :--- | :--- |
| `State / Route Error / Root` | P0 | `../../frontend/src/pages/RouteErrorPage.tsx` | App shell 级错误。 |
| `State / Route Error / App Content` | P0 | `../../frontend/src/pages/RouteErrorPage.tsx` | 主内容区错误。 |
| `State / Route Error / Settings Shell` | P0 | `../../frontend/src/pages/RouteErrorPage.tsx` | 设置壳层错误。 |
| `State / Route Error / Settings Panel` | P0 | `../../frontend/src/pages/RouteErrorPage.tsx` | 设置子页面错误。 |
| `State / Not Found / 404` | P0 | `../../frontend/src/pages/NotFoundPage.tsx` | 未命中路由。 |

## 12. P0 最小交付集

如果时间有限，至少先完成以下 frame：

1. `Shell / App / Desktop / Expanded`
2. `Shell / Settings / Desktop`
3. `Page / Workspaces / Default`
4. `Page / Workspaces / Empty Registry`
5. `Page / Workspaces / Load Error`
6. `Page / Thread Workspace / Active Timeline`
7. `Page / Thread Workspace / Approval Dialog`
8. `Page / Thread Workspace / Surface Panel Feed`
9. `Page / Thread Workspace / Terminal Sessions`
10. `Page / Automations / Directory Default`
11. `Page / Automation Detail / Default`
12. `Page / Skills / Default`
13. `Page / Skills / Query Error`
14. `Page / Runtime / Default`
15. `Page / Settings / Appearance / Default`
16. `State / Route Error / Root`
17. `Overlay / Command Palette / Default`

## 13. 关联文档

- [Figma 交付包说明](./FIGMA_HANDOFF_PACKAGE.md)
- [页面蓝图](./PAGE_BLUEPRINTS.md)
- [低保真线框说明](./LOW_FIDELITY_WIREFRAMES.md)
- [UI 实现差距审计](./UI_IMPLEMENTATION_GAP_AUDIT.md)

---
*这份清单的价值不在“列得多”，而在于每个 frame 都能回指到真实实现或明确的 target-state。*
