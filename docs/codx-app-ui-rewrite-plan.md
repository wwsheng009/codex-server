# codx-app 风格 UI 全量重构计划

更新时间：2026-03-20

## 1. 目标

本计划用于指导 `codex-server` 前端进行一次**完整的 UI 重构**。

重构目标不是在现有界面上继续修补，而是：

- 以 `codx-app` 截图分析结果为目标界面
- **不保留当前任何既有 UI 设计语言**
- 保留业务能力、API 调用、状态存储和页面功能
- 重建应用壳层、页面布局、交互入口、视觉体系和组件结构

本次重构的核心原则是：

> 保留“功能”，推倒“界面”。

## 2. 重构边界

### 2.1 保留的部分

以下内容默认保留并尽量复用：

- API 调用层
  - `frontend/src/features/**/api.ts`
  - `frontend/src/lib/api-client.ts`
- 状态与事件
  - `frontend/src/stores/session-store.ts`
  - `frontend/src/stores/session-store-utils.ts`
  - `frontend/src/stores/ui-store.ts`
  - `frontend/src/hooks/useWorkspaceStream.ts`
- 数据类型
  - `frontend/src/types/api.ts`
- 页面业务流程
  - 工作区加载
  - 线程加载
  - 消息发送
  - 审批响应
  - 命令执行
  - 技能/模型/插件查询

### 2.2 不保留的部分

以下内容不再视为设计基础，允许整体替换：

- 所有现有布局结构
- 所有现有页面排版
- 所有现有样式体系
- 所有现有目录页视觉语言
- 所有现有线程工作台视觉结构
- 所有现有顶部栏、侧边栏、表单、卡片、空态、弹层的设计方式

换句话说，下面这些文件虽然可能暂时继续存在，但都应该视为**待重写对象**：

- `frontend/src/components/layout/**`
- `frontend/src/components/thread/**`
- `frontend/src/components/ui/**`
- `frontend/src/pages/**`
- `frontend/src/styles/**`

## 3. 重构目标形态

基于 [codx-app-ui-layout-analysis.md](/abs/path-not-used) 的分析，本次重构目标形态应统一为如下产品结构：

### 3.1 顶层应用壳层

```text
AppShell
├─ Sidebar
│  ├─ PrimaryNav
│  ├─ WorkspaceTree
│  └─ SidebarFooter
└─ MainSurface
   ├─ ContextHeader
   ├─ ContentCanvas
   └─ ComposerDock
```

### 3.2 页面类别

目标页面类别只有 4 类：

1. 工作台页
   - 空态
   - 线程态
   - 执行中态
   - 审批态
   - Diff 双栏态
2. 目录页
   - 技能
   - 自动化
   - Runtime
3. 对象详情页
   - 自动化详情
4. 设置中心
   - 左侧分类导航
   - 右侧配置内容

## 4. 新旧结构映射

### 4.1 当前已有路由

当前前端已有以下业务路由：

- `/workspaces`
- `/workspaces/:workspaceId`
- `/runtime`
- `/settings`
- `/skills`
- `/automations`
- `/automations/:automationId`

这些路由可以继续沿用，但每个路由的布局都要按 `codx-app` 风格重建。

### 4.2 页面映射关系

| 当前页面 | 目标页面类型 | 处理方式 |
| --- | --- | --- |
| `WorkspacesPage` | 工作区目录 / 入口页 | 重写布局与卡片组织 |
| `ThreadPage` | 工作台页 | 重写为主工作目标页面 |
| `CatalogPage` | Runtime 目录页 | 重写为目录页模板 |
| `SkillsPage` | 技能目录页 | 保留数据逻辑，重写布局 |
| `AutomationsPage` | 自动化目录页 | 保留功能逻辑，重写布局 |
| `AutomationDetailPage` | 自动化详情页 | 保留功能逻辑，重写布局 |
| `AccountPage` | 设置中心 | 重写为标准设置壳层 |
| `NotFoundPage` | 空态页 | 重写为空态模板 |

## 5. 文件级重构策略

### 5.1 直接复用为主

这些文件以“逻辑复用”为主：

- `frontend/src/features/account/api.ts`
- `frontend/src/features/approvals/api.ts`
- `frontend/src/features/catalog/api.ts`
- `frontend/src/features/commands/api.ts`
- `frontend/src/features/settings/api.ts`
- `frontend/src/features/threads/api.ts`
- `frontend/src/features/turns/api.ts`
- `frontend/src/features/workspaces/api.ts`
- `frontend/src/lib/api-client.ts`
- `frontend/src/stores/**`
- `frontend/src/hooks/useWorkspaceStream.ts`
- `frontend/src/types/api.ts`

### 5.2 允许保留但应重写内容

这些文件可以保留文件路径，但应整体重写其 UI 结构：

- `frontend/src/components/layout/AppShell.tsx`
- `frontend/src/components/layout/PageTopbar.tsx`
- `frontend/src/components/thread/ThreadSidebar.tsx`
- `frontend/src/components/thread/ThreadConversation.tsx`
- `frontend/src/components/thread/ThreadUtilityPanel.tsx`
- `frontend/src/components/thread/HistoryItemCard.tsx`
- `frontend/src/components/thread/LiveEventCard.tsx`
- `frontend/src/components/ui/PanelCard.tsx`
- `frontend/src/components/ui/StatusBadge.tsx`
- `frontend/src/pages/*.tsx`

### 5.3 建议新增的结构层文件

建议把新 UI 拆成更接近 `codx-app` 的结构：

```text
frontend/src/
  components/
    shell/
      DesktopSidebar.tsx
      SidebarWorkspaceTree.tsx
      MainSurfaceHeader.tsx
      ComposerDock.tsx
    directories/
      DirectoryHeader.tsx
      SkillGrid.tsx
      AutomationTemplateGrid.tsx
      AutomationList.tsx
    workspace/
      ThreadTimeline.tsx
      TimelineMessageBlock.tsx
      TimelineCommandBlock.tsx
      TimelineApprovalCard.tsx
      BottomTerminalPanel.tsx
      DiffPanel.tsx
    settings/
      SettingsShell.tsx
      SettingsNav.tsx
      SettingsRow.tsx
      SettingsResourceList.tsx
```

### 5.4 建议替换样式体系

当前样式文件分布：

- `base.css`
- `shell.css`
- `ui.css`
- `directory.css`
- `thread.css`
- `workspace.css`
- `responsive.css`

建议不要继续在这些文件上叠加，而是改成新体系：

```text
frontend/src/styles/
  tokens.css
  app-shell.css
  sidebar.css
  composer.css
  workspace.css
  timeline.css
  approvals.css
  diff-panel.css
  directories.css
  settings.css
  modals.css
  responsive.css
```

现有旧样式文件最终应下线或仅作为过渡层。

## 6. 分阶段实施方案

### Phase 1: 壳层替换

目标：

- 替换当前 `AppShell`
- 统一左侧导航和 workspace tree
- 统一主内容画布与底部 composer 的壳层结构

交付结果：

- 所有页面进入新的应用壳层
- 旧的页面头与布局容器不再作为设计基础

### Phase 2: 工作台重构

目标：

- 重构 `ThreadPage`
- 以时间线模型重建消息区、命令块、审批块、终端块
- 重构右侧 diff panel

交付结果：

- 工作台达到 `codx-app` 的核心体验形态

### Phase 3: 目录页重构

目标：

- 重构 `SkillsPage`
- 重构 `AutomationsPage`
- 重构 `CatalogPage` 为 runtime 目录页

交付结果：

- 所有目录页统一使用目录页模板

### Phase 4: 自动化详情与流程重构

目标：

- 重构 `AutomationDetailPage`
- 补齐自动化创建弹层与详情页交互
- 如有后端支持，接入真正的 automation API

交付结果：

- 自动化模块从“原型页”升级为完整子系统

### Phase 5: 设置中心重构

目标：

- 重构 `AccountPage`
- 改造成标准双栏设置中心

交付结果：

- 设置中心与工作台完全脱钩

### Phase 6: 清理旧 UI

目标：

- 删除旧设计残留
- 清理无用样式、过渡组件、旧命名

交付结果：

- 代码中不再保留旧 UI 设计遗产

## 7. 实施原则

### 7.1 不允许的做法

以下做法本次重构中应避免：

- 在旧页面上继续局部打补丁
- 继续沿用旧样式命名并叠加新样式
- 把 `codx-app` 风格只做成“局部皮肤”
- 一个页面内混合旧布局与新布局

### 7.2 允许的做法

- 保留 API、store、hooks
- 保留业务逻辑函数
- 保留路由路径
- 重写 UI 组件文件本身
- 新建并替换样式体系

## 8. 验收标准

### 8.1 结构验收

- 左侧导航必须统一为 `codx-app` 风格的固定工作台侧栏
- 工作台主区必须是“时间线 + composer + 可选辅助面板”结构
- 设置页必须是独立双栏设置中心
- 技能/自动化/runtime 必须是目录页，而不是旧卡片页微调版本

### 8.2 视觉验收

- 不再保留当前项目现有设计语言的痕迹
- 页面头、卡片、表单、菜单、空态、终端区应属于同一设计系统
- 不允许出现“某些区域还是旧风格”的混搭感

### 8.3 代码验收

- 新样式体系成组组织
- 旧样式文件最终可清理
- 路由、组件、样式命名反映新的产品结构

## 9. 建议的下一步执行切片

如果从现在开始真正实施完整重构，推荐的首个切片不是继续加新页面，而是：

### 推荐切片 A

**完整重写工作台壳层与线程页**

范围：

- `AppShell`
- `ThreadPage`
- `ThreadSidebar`
- `ThreadConversation`
- `ThreadUtilityPanel`
- `HistoryItemCard`
- `LiveEventCard`
- 新样式体系中的：
  - `app-shell.css`
  - `sidebar.css`
  - `composer.css`
  - `timeline.css`
  - `approvals.css`
  - `diff-panel.css`

原因：

- 这是 `codx-app` 的核心体验页
- 先重写这里，后面的目录页和设置页都能共享壳层
- 也能最快消除“还保留旧 UI 设计”的问题

### 备选切片 B

**完整重写目录页体系**

范围：

- `SkillsPage`
- `AutomationsPage`
- `CatalogPage`
- 目录页共享 header / grid / list / modal

原因：

- 代码风险更低
- 但无法先解决最核心的工作台体验问题

## 10. 当前结论

如果你的要求是“全部重构”，那当前正确方向不是继续在现有文件上微调视觉，而是：

1. 先冻结旧 UI 设计作为参考对象
2. 把 `codx-app` 设计文档作为唯一目标界面
3. 用分阶段替换方式逐块重写
4. 每个阶段结束后清掉旧 UI 遗留

本计划建议直接从“工作台壳层 + 线程页”开始。
