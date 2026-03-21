# 低保真线框说明 (Low-Fidelity Wireframes)

本页不是视觉稿，而是给设计师、产品和前端共享的**页面骨架说明**。它基于当前路由、页面与壳层实现，把最关键页面的低保真结构固定下来。

当前实现锚点:

- 路由: `frontend/src/app/router.tsx`
- 主壳层: `frontend/src/components/shell/AppShell.tsx`
- 设置壳层: `frontend/src/components/shell/SettingsShell.tsx`
- 页面: `frontend/src/pages/*.tsx`

## 1. 使用规则

每个线框都只回答 4 个问题:

1. 哪些区域是固定的
2. 哪些区域会滚动
3. 哪些区域承担主要操作
4. 哪些区域属于覆盖层或可选面板

不要在低保真阶段讨论:

- 具体颜色
- 精确图标
- 装饰性背景
- 动效微调

## 2. App Shell 总体骨架

```text
┌─ App Shell ───────────────────────────────────────────────────────────────┐
│ Sidebar                                                                  │
│ ├─ Primary Nav                                                           │
│ ├─ Workspace / Thread Tree                                               │
│ └─ Footer / Utilities                                                    │
│                                                                          │
│ Main Router Surface                                                      │
│ ├─ Workspaces Page                                                       │
│ ├─ Thread Workspace                                                      │
│ ├─ Automations                                                           │
│ ├─ Skills                                                                │
│ ├─ Runtime                                                               │
│ └─ Settings Shell                                                        │
│                                                                          │
│ Global Overlays                                                          │
│ ├─ Command Palette                                                       │
│ ├─ Notification Center                                                   │
│ ├─ Menus                                                                 │
│ └─ Modal Layer                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

## 3. Workspaces Page

```text
┌────────────────────────── Workspaces Page ────────────────────────────────┐
│ Mode Strip                                                               │
│ ├─ Eyebrow                                                               │
│ ├─ Title                                                                 │
│ ├─ Description                                                           │
│ ├─ Metrics                                                               │
│ └─ [New Workspace]                                                       │
│                                                                          │
│ Workspace Registry                                                       │
│ ├─ Workspace Row/Card *                                                  │
│ │  ├─ Name + ID                                                          │
│ │  ├─ Root Path                                                          │
│ │  ├─ Status                                                             │
│ │  ├─ [Restart]                                                          │
│ │  └─ [Remove]                                                           │
│ └─ Empty State / Loading                                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

## 4. Thread Workspace: Empty Start State

```text
┌──────────────────────── Thread Workspace Empty ───────────────────────────┐
│ Workspace Header / Strip                                                 │
│                                                                          │
│                           Hero Title                                     │
│                       Current Workspace Label                            │
│                                                                          │
│                   Suggestion Card    Suggestion Card                     │
│                   Suggestion Card    Suggestion Card                     │
│                                                                          │
│ Composer Dock                                                            │
│ ├─ Attachment                                                            │
│ ├─ Prompt Input                                                          │
│ ├─ Send                                                                  │
│ └─ Context / Permission / Branch Status                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## 5. Thread Workspace: Main Timeline State

```text
┌───────────────────────── Thread Workspace Main ───────────────────────────┐
│ Thread Header                                                            │
│ ├─ Thread Title                                                          │
│ ├─ Workspace Label                                                       │
│ └─ Context Actions                                                       │
│                                                                          │
│ Timeline Surface                                                         │
│ ├─ Message Block                                                         │
│ ├─ Reasoning / Plan Block                                                │
│ ├─ Command Block                                                         │
│ ├─ File Change Block                                                     │
│ └─ Approval Block                                                        │
│                                                                          │
│ Composer Dock                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

## 6. Thread Workspace: Diff Right Panel

```text
┌──────────────────────── Thread + Diff ───────────────────────┬────────────┐
│ Main Thread Canvas                                           │ Diff Panel │
│ ├─ Header                                                    │ ├─ Files   │
│ ├─ Timeline                                                  │ ├─ Diffs   │
│ └─ Composer                                                  │ └─ Review  │
└──────────────────────────────────────────────────────────────┴────────────┘
```

规则:

- 主线程仍是主语
- diff panel 独立滚动
- panel 可关闭或调整宽度

## 7. Thread Workspace: Bottom Terminal

```text
┌──────────────────────── Thread + Terminal ────────────────────────────────┐
│ Thread Header                                                            │
│ Timeline Surface                                                         │
│ Composer Dock                                                            │
├──────────────────── Bottom Terminal Dock ────────────────────────────────┤
│ Terminal Tabs                                                            │
│ Command Output / Shell Stream                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

规则:

- 终端 dock 是附加层，不替代线程主体
- 必须可折叠、展开、调高

## 8. Automations Page

### 8.1 模板目录态

```text
┌────────────────────────── Automations Directory ──────────────────────────┐
│ Mode Strip                                                               │
│ Intro                                                                    │
│ View Switch / Filter                                                     │
│                                                                          │
│ Category Section                                                         │
│ ├─ Template Card                                                         │
│ ├─ Template Card                                                         │
│ └─ Template Card                                                         │
│                                                                          │
│ [New Automation]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 8.2 当前任务列表态

```text
┌────────────────────────── Automations Current ────────────────────────────┐
│ Mode Strip                                                               │
│ Current Jobs List                                                        │
│ ├─ Automation Row                                                        │
│ ├─ Automation Row                                                        │
│ └─ Automation Row                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## 9. Automation Create Modal

```text
┌────────────────────── Automation Create Modal ────────────────────────────┐
│ Title / Template Info                                                    │
│                                                                          │
│ Title Field                                                              │
│ Description Field                                                        │
│ Prompt Field                                                             │
│ Workspace Select                                                         │
│ Schedule Select / Cron                                                   │
│ Model Select                                                             │
│ Reasoning Select                                                         │
│                                                                          │
│ [Cancel]                                                [Create]         │
└──────────────────────────────────────────────────────────────────────────┘
```

## 10. Skills Page

```text
┌────────────── Skills Page ──────────────┬─────────────────────────────────┐
│ Mode Rail                              │ Directory Surface               │
│ ├─ Workspace Scope                     │ ├─ Installed Section            │
│ ├─ Search                              │ │  └─ Skill Card/Row *          │
│ └─ Metrics                             │ └─ Remote Section               │
│                                        │    └─ Skill Card/Row *          │
└────────────────────────────────────────┴──────────────────────────────────┘
```

## 11. Runtime / Catalog Page

```text
┌────────────── Runtime Page ─────────────┬─────────────────────────────────┐
│ Mode Rail                              │ Inventory / Action Surface      │
│ ├─ Workspace Scope                     │ ├─ Models                       │
│ ├─ Filters                             │ ├─ Installed Skills             │
│ ├─ Search / Plugin Actions             │ ├─ Remote Skills                │
│ └─ Feedback Upload                     │ ├─ Apps / Plugins / Modes       │
│                                        │ └─ Results / Notices            │
└────────────────────────────────────────┴──────────────────────────────────┘
```

## 12. Settings Shell

```text
┌────────────────────── Settings Shell ─────────────────────────────────────┐
│ Settings Sidebar                  │ Settings Content                      │
│ ├─ Back to App                    │ ├─ Page Header                        │
│ ├─ Workspace Scope                │ ├─ Group                              │
│ ├─ General                        │ │  └─ Setting Row *                   │
│ ├─ Appearance                     │ ├─ Resource List                      │
│ ├─ Config                         │ ├─ Editor Block                       │
│ ├─ Personalization                │ └─ Action Footer?                     │
│ ├─ MCP                            │                                        │
│ ├─ Git                            │                                        │
│ ├─ Environment                    │                                        │
│ ├─ Worktrees                      │                                        │
│ └─ Archived Threads               │                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## 13. Error / Recovery States

### 13.1 Route Error

```text
┌──────────────────────────── Route Error ──────────────────────────────────┐
│ Error Scope                                                               │
│ Description                                                               │
│ [Go Back]  [Reload]  [Go Home]                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 13.2 Not Found

```text
┌──────────────────────────── Not Found ────────────────────────────────────┐
│ Missing Route / Missing Resource                                           │
│ Recovery Copy                                                              │
│ [Go to Workspaces]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

## 14. 移动端重排原则

- Sidebar -> drawer
- Diff panel -> full screen or bottom sheet
- Settings sidebar -> list-to-content
- Multi-column directory pages -> single column
- Composer 保持底部，但不遮挡 notice、approval 和 keyboard safe area

## 15. 交付要求

任何高保真页面都必须能回溯到本页某个线框骨架；如果设计稿突破了骨架，应先在 [PAGE_BLUEPRINTS.md](./PAGE_BLUEPRINTS.md) 和 [IA_NAVIGATION.md](./IA_NAVIGATION.md) 里更新结构定义。

## 16. 关联文档

- [页面蓝图](./PAGE_BLUEPRINTS.md)
- [信息架构与导航](./IA_NAVIGATION.md)
- [组件状态矩阵](./COMPONENT_STATE_MATRIX.md)

---
*这份文档用于把页面结构讨论从“口头想象”变成“可共享的骨架图”。*
