# 组件库规格书 (Component Library Spec)

本页定义 `codex-server` 当前 UI 的**组件库分层**、**组件职责**、**变体集合**与 **Figma / 代码映射**。目标是避免设计组件和代码组件各自生长，最后无法对齐。

当前代码锚点:

- `frontend/src/components/ui/*.tsx`
- `frontend/src/components/shell/*.tsx`
- `frontend/src/components/thread/*.tsx`
- `frontend/src/components/settings/*.tsx`
- `frontend/src/components/workspace/*.tsx`

## 1. 组件库分层

Codex UI 组件库按 5 层组织:

| 层级 | 作用 | 典型组件 |
| :--- | :--- | :--- |
| **Primitives** | 最小交互控件 | `Button`, `SelectControl`, `Tabs`, `Tooltip` |
| **Feedback & Overlay** | 提示、弹层、确认 | `InlineNotice`, `Modal`, `ConfirmDialog`, `NotificationCenter` |
| **Page Chrome** | 页面壳层与头部 | `AppShell`, `SettingsShell`, `PageHeader` |
| **Domain Components** | 工作台、设置、资源目录特有组件 | `StatusPill`, `SettingsGroup`, `SettingsRecord`, timeline renderers |
| **Composite Surfaces** | 页面级组合结构 | Workspace registry, thread timeline, settings pages, runtime catalog sections |

## 2. 命名规则

### 2.1 设计系统命名

- 组件名使用 `PascalCase`
- 变体使用 `variant=...`
- 状态使用 `state=...`
- 尺寸使用 `size=...`
- 色调/语义使用 `intent=...` 或 `tone=...`

### 2.2 Figma 组件集命名

推荐命名形式:

```text
Button / intent=primary / size=md / state=default
Select / state=open / width=full
Notice / tone=error / dismissible=true / action=true
StatusPill / tone=connected
```

### 2.3 代码映射

Figma 名称尽量与代码导出名一致，不要出现:

- 设计里叫 `ActionButton`
- 代码里叫 `PrimaryCTA`
- 文档里又叫 `MainButton`

## 3. Primitive 组件

## 3.1 Button

代码源:

- `frontend/src/components/ui/Button.tsx`

当前代码能力:

- `intent`: `primary | secondary | danger | ghost`
- `size`: `sm | md | lg`
- `isLoading`
- `icon`

Figma 必须建成一个组件集:

- `intent`
- `size`
- `state`: `default | hover | active | focus-visible | disabled | loading`
- `icon`: `none | leading`

插槽:

- icon
- label

设计约束:

- loading 不应只改文案，必须有稳定 spinner 占位
- danger 与 ghost-danger 需要区分清楚

## 3.2 SelectControl

代码源:

- `frontend/src/components/ui/SelectControl.tsx`

当前代码能力:

- trigger
- portal listbox
- keyboard navigation
- disabled option
- full width
- menu label

Figma 需要至少 3 个层次:

1. trigger closed
2. trigger open
3. option row

变体:

- `state`: `closed | open | disabled`
- `width`: `content | full`
- `optionState`: `default | highlighted | selected | disabled`

设计约束:

- trigger 和 menu 分别建组件，不要只画一个截图态
- option 必须区分 selected 与 highlighted

## 3.3 Tabs

代码源:

- `frontend/src/components/ui/Tabs.tsx`

当前代码能力:

- icon
- badge
- keyboard arrow nav
- persisted active tab

Figma 组件集:

- `state`: `default | hover | active | focus-visible`
- `icon`: `none | yes`
- `badge`: `none | yes`

必须补的状态:

- active + badge
- active + icon
- overflow or multi-tab wrapping spec

## 3.4 Tooltip

代码源:

- `frontend/src/components/ui/Tooltip.tsx`

当前代码能力:

- `position`: `top | bottom | left | right`
- click/focus trigger
- portal rendering

Figma 组件集:

- `position`
- `state`: `hidden | visible`

设计约束:

- tooltip 是补充说明，不承载关键决策信息
- trigger 本身应可作为独立 focusable control 存在

## 4. Feedback & Overlay

## 4.1 InlineNotice

代码源:

- `frontend/src/components/ui/InlineNotice.tsx`

当前代码能力:

- `tone`: `info | error`
- `dismissible`
- `title`
- `details`
- `action`
- `retry`

Figma 组件集:

- `tone`: `info | error`
- `layout`: `simple | detailed | actionable`
- `dismissible`: `true | false`

必须覆盖:

- title only
- title + body
- retry tool
- copy details tool
- dismissible

## 4.2 Modal

代码源:

- `frontend/src/components/ui/Modal.tsx`

当前代码能力:

- title
- description
- body
- footer
- backdrop close
- escape close

Figma 需要拆成:

- backdrop
- shell
- header
- body
- footer

变体:

- `width`: `sm | md | lg | custom`
- `footer`: `none | actions`

## 4.3 ConfirmDialog

代码源:

- `frontend/src/components/ui/ConfirmDialog.tsx`

当前代码能力:

- subject
- confirm/cancel labels
- error notice
- pending

Figma 组件集:

- `tone`: `default | danger`
- `state`: `default | pending | error`

设计约束:

- danger confirm 必须有更高风险权重
- error state 不能吞掉主体说明

## 4.4 NotificationCenter

代码源:

- `frontend/src/components/shell/NotificationCenter.tsx`

当前代码能力:

- bell trigger
- unread count
- popover
- toast stack
- mark read / mark all read / clear read
- deep link into automation or workspace

Figma 需要至少三组组件:

- trigger
- popover list item
- toast item

必须覆盖:

- empty
- unread
- mixed read/unread
- error / loading
- compact mobile trigger

## 5. Page Chrome

## 5.1 PageHeader

代码源:

- `frontend/src/components/ui/PageHeader.tsx`

结构:

- eyebrow
- title
- description
- meta
- actions

Figma 组件集:

- `meta`: `none | yes`
- `actions`: `none | yes`
- `description`: `none | yes`

## 5.2 AppShell

代码源:

- `frontend/src/components/shell/AppShell.tsx`

AppShell 是结构组件，不是视觉单组件。Figma 里应拆为:

- Sidebar
- PrimaryNav
- WorkspaceTree
- MainRouterSurface
- GlobalMenuAnchors

不要把整个 AppShell 做成一个巨大 component instance。

## 5.3 SettingsShell

代码源:

- `frontend/src/components/shell/SettingsShell.tsx`

Figma 应拆为:

- SettingsSidebar
- SettingsNavItem
- SettingsContentFrame
- Workspace Scope Block

## 6. Domain Components

## 6.1 StatusPill

代码源:

- `frontend/src/components/ui/StatusPill.tsx`

当前能力:

- 根据 `status` 文本派生 tone class

Figma 需要至少定义:

- `connected`
- `paused`
- `error`
- `warning`
- `active`
- `archived`
- `restarting`

要求:

- 不能只靠颜色区分状态
- pill 文本必须可直接读出状态

## 6.2 Settings Primitives

代码源:

- `frontend/src/components/settings/SettingsPrimitives.tsx`

当前结构组件:

- `SettingsPageHeader`
- `SettingsGroup`
- `SettingRow`
- `SettingsJsonPreview`
- `SettingsRecord`

Figma 组件集建议:

- Settings / PageHeader
- Settings / Group
- Settings / Row
- Settings / OutputCard
- Settings / Record

必须覆盖:

- row with meta
- row with control
- record with action
- JSON preview collapsed / expanded

## 6.3 Thread Content Renderers

代码源:

- `frontend/src/components/thread/ThreadContent.tsx`
- `frontend/src/components/workspace/renderers.tsx`

这是最关键但也最不适合“一把梭组件集”的区域。建议在 Figma 中按 block 类型拆:

- Thread / Markdown Block
- Thread / Code Block
- Thread / Terminal Block
- Thread / Reasoning Block
- Thread / Plan Block
- Thread / Command Block
- Thread / FileChange Block
- Thread / Approval Block

统一骨架字段:

- block label
- content
- meta
- actions
- expand/collapse

## 7. Composite Surfaces

以下更适合定义为**页面局部模块**而不是全局基础组件:

- Workspace Registry Row
- Automation Template Card
- Automation Current Row
- Skill Directory Item
- Runtime Inventory Section
- Diff File Summary Row
- Approval Drawer Section

规则:

- 如果一个组件只在一个页面模型里成立，就优先做页面模块，而不是全局 primitive。

## 8. Figma 组件集最小清单

要开始高保真页面设计，至少应先建立这些组件集:

- Button
- Input / Textarea
- Select
- Tabs
- StatusPill
- Notice
- Modal
- ConfirmDialog
- PageHeader
- Settings primitives
- Thread block skeletons
- Directory item
- Workspace row

## 9. 代码对齐规则

当代码组件能力变化时，以下内容必须同步更新:

- 变体集合
- 状态集合
- 插槽结构
- 组件命名

尤其是下面这些组件:

- `Button`
- `SelectControl`
- `InlineNotice`
- `Modal`
- `ConfirmDialog`
- `StatusPill`
- settings primitives

## 10. 组件交付检查

任何组件进入开发前至少要有:

- Figma 组件集
- 变体表
- 状态表
- slot 说明
- 与代码组件的映射

## 11. 关联文档

- [组件状态矩阵](./COMPONENT_STATE_MATRIX.md)
- [设计 Token 源规范](./DESIGN_TOKENS_SOURCE.md)
- [设计验收清单](./DESIGN_ACCEPTANCE_CHECKLIST.md)

---
*如果没有一份组件库规格书，Figma 很容易变成“好看的截图集合”，而不是可维护组件系统。*
