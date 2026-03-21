# 信息架构与导航 (IA and Navigation)

本页把 `codex-server` 当前 Web UI 的**信息架构**、**路由层级**和**导航职责**固定下来，作为整套 UI 设计的施工基线。

当前实现依据:

- 路由源: `frontend/src/app/router.tsx`
- 主壳层: `frontend/src/components/shell/AppShell.tsx`
- 设置壳层: `frontend/src/components/shell/SettingsShell.tsx`
- 产品形态分析: `docs/codx-app-ui-layout-analysis.md`

## 1. 产品 IA 总结

Codex Web 不是传统站点，也不是单一聊天页，而是一个**工作台式 AI 客户端**。它的 IA 由三层组成:

1. **应用层**: 一级功能入口，例如工作台、自动化、技能、Runtime、设置。
2. **上下文层**: 当前 workspace、线程、审批、diff、终端等工作上下文。
3. **对象层**: 自动化对象、技能条目、设置资源、历史运行记录等具体管理对象。

核心原则:

- **线程驱动**: 主工作流围绕线程组织，而不是围绕页面跳转组织。
- **Workspace 作用域**: 大部分工作行为都发生在当前 workspace 上下文内。
- **设置独立**: 设置中心是一套独立 IA，不与主工作台混排。
- **右侧/底部面板属于页面内部结构**: diff、审批、终端默认不是独立路由。

## 2. 路由树 (Current Route Tree)

```text
/
├─ /workspaces
├─ /workspaces/:workspaceId
├─ /automations
├─ /automations/:automationId
├─ /skills
├─ /runtime
├─ /settings
│  ├─ /settings/general
│  ├─ /settings/appearance
│  ├─ /settings/config
│  ├─ /settings/personalization
│  ├─ /settings/mcp
│  ├─ /settings/git
│  ├─ /settings/environment
│  ├─ /settings/worktrees
│  └─ /settings/archived-threads
└─ *
```

## 3. 路由到页面映射

| 路由 | 壳层 | 页面类型 | 用户目标 |
| :--- | :--- | :--- | :--- |
| `/workspaces` | `AppShell` | 工作区目录 / 入口页 | 选择或创建 workspace，进入主工作区 |
| `/workspaces/:workspaceId` | `AppShell` | 工作台页 | 启动或继续线程，查看时间线、审批、diff、终端 |
| `/automations` | `AppShell` | 自动化目录页 | 浏览模板、查看当前任务、创建自动化 |
| `/automations/:automationId` | `AppShell` | 自动化详情页 | 查看单个自动化的状态、调度和历史 |
| `/skills` | `AppShell` | 技能目录页 | 浏览、搜索、刷新、创建技能 |
| `/runtime` | `AppShell` | Runtime 目录页 | 管理运行时能力、配置、资源面板 |
| `/settings/*` | `SettingsShell` | 设置中心 | 编辑账户、外观、配置、MCP、Git、环境、工作树等 |
| `*` | `AppShell` | Not Found | 从异常路由恢复 |

## 4. 壳层职责分离

### 4.1 `AppShell`

负责主工作台模式下的全局结构:

- 一级导航
- workspace / thread 上下文树
- 页面主体路由切换
- 全局菜单
- 通知中心
- 模态层与全局弹层

### 4.2 `SettingsShell`

负责设置中心的独立信息架构:

- 返回主应用入口
- 左侧设置分类导航
- 右侧设置内容区
- workspace 作用域上下文透传

### 4.3 为什么要拆两层

- 工作台的主语是“当前任务”。
- 设置中心的主语是“系统和账户配置”。
- 两者在阅读节奏、导航方式、信息密度和 CTA 语义上都不同，不应共享同一页面模板。

## 5. 导航区域职责

### 5.1 一级导航 (Primary Nav)

一级导航固定放在主壳层左侧，负责跨功能域切换:

- Workspaces
- Automations
- Skills
- Runtime
- Settings

规则:

- 一级导航只切换**功能域**，不承担局部筛选或对象编辑。
- 一级导航标签必须稳定，不随 workspace、线程或对象状态改变。

### 5.2 Workspace / Thread 树

左侧边栏中部承担“导航 + 工作上下文树”的双重职责。

包含:

- workspace 分组
- 当前 workspace 下的线程列表
- 线程状态
- 搜索 / 最近访问 / 归档 / 重命名 / 上下文菜单

规则:

- workspace / thread 树是**主工作上下文切换器**，不是普通菜单。
- 线程行必须支持快速恢复工作，而不仅是“打开详情”。
- 线程级操作如置顶、归档、复制会话 ID、派生线程，应收敛到上下文菜单。

### 5.3 Main Router Surface

主内容区只承载当前一级功能域对应的页面，不再重复左侧导航。

页面分三类:

- **工作台型**: `/workspaces/:workspaceId`
- **目录型**: `/automations`, `/skills`, `/runtime`
- **设置型**: `/settings/*`

### 5.4 页面内部导航

页面内部允许出现以下局部导航:

- mode strip
- 二级 tabs
- breadcrumb
- 目录/列表筛选
- 设置左侧 section nav

它们不能与一级导航竞争主语。

### 5.5 全局入口

以下入口属于全局层，不绑定单一路由:

- Command Palette
- 顶部系统菜单
- 账户菜单
- 语言菜单
- Git 菜单
- 外部打开菜单
- 通知中心

这些入口用于**快捷操作**、**辅助跳转**和**系统级动作**，而不是替代主 IA。

## 6. 对象层级 (Object Hierarchy)

### 6.1 工作台域

```text
Workspace
└─ Thread
   ├─ Timeline Blocks
   │  ├─ agentMessage
   │  ├─ reasoning
   │  ├─ plan
   │  ├─ commandExecution
   │  ├─ fileChange
   │  └─ toolCall / approval
   ├─ Diff Panel
   └─ Bottom Terminal
```

### 6.2 自动化域

```text
Automation Template
└─ Automation Job
   ├─ Status
   ├─ Schedule
   ├─ Model / Reasoning
   └─ Previous Runs
```

### 6.3 设置域

```text
Settings Section
└─ Group
   ├─ Setting Row
   ├─ Resource List
   └─ Editor Block
```

## 7. 导航规则

### 7.1 深链接规则

- 顶级功能页和详情页必须有稳定 URL。
- 当前实现中，工作台使用 `/workspaces/:workspaceId` 表达页面上下文，**线程选择仍是壳层内部状态**。
- 如果后续要支持线程级深链接，优先扩展为 `/workspaces/:workspaceId/threads/:threadId`，但不改变工作台壳层。

### 7.2 页面与弹层边界

以下内容默认不应升级为独立页面:

- command palette
- 创建自动化 modal
- 创建 workspace dialog
- 轻量 popover
- 右侧 diff panel
- 底部 terminal

只有当它们需要独立分享、刷新恢复或完整编辑生命周期时，才考虑路由化。

### 7.3 Breadcrumb 规则

- 对象详情页使用 breadcrumb，例如自动化详情。
- 工作台线程流不使用传统 breadcrumb，避免破坏“持续任务”心智模型。
- 设置中心不需要跨 section breadcrumb，左侧 section nav 即为主定位机制。

### 7.4 移动端规则

- 一级导航可折叠或转到底部 / 抽屉，但功能域结构不能改变。
- workspace / thread 树在窄屏优先转为抽屉，不与时间线并排。
- 设置中心保持“列表到内容”的层级模式。

## 8. 命令面板在 IA 中的位置

Command Palette 是**加速器**，不是 IA 本体。

它可以:

- 跳转功能页
- 跳转 workspace / thread
- 触发高频操作
- 触发上下文动作

它不应:

- 替代左侧一级导航
- 隐藏仅能通过搜索发现的核心能力
- 让设置分类、线程树和对象列表失去结构意义

## 9. 设计交付约束

任何 IA 或导航设计交付，至少要给出以下内容:

- 路由树
- 壳层归属
- 一级导航结构
- workspace / thread 树行为
- 页面内部二级导航
- 弹层与页面的边界
- 移动端导航重排方案

缺少这些内容时，设计稿只能算视觉稿，不能算可施工 IA。

## 10. 关联文档

- [统一交互指南](./UX_GUIDE.md)
- [页面蓝图](./PAGE_BLUEPRINTS.md)
- [组件状态矩阵](./COMPONENT_STATE_MATRIX.md)
- [布局系统](./LAYOUT_SYSTEM.md)
- [命令面板规范](./COMMAND_PALETTE.md)

---
*内部设计施工文档。外部规范来源见 [UX 权威来源基线](./UX_AUTHORITY_BASELINE.md)。*
