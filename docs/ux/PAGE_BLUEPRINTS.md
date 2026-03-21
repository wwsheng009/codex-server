# 页面蓝图 (Page Blueprints)

本页给出 `codex-server` 当前 Web UI 的**页面级施工图规范**。目标不是替代视觉稿，而是为每个页面定义稳定的:

- 路由与壳层
- 内容区域
- 主动作
- 必须覆盖的状态
- 移动端重排
- 交付检查项

## 1. 蓝图字段定义

每个页面蓝图至少要回答 6 个问题:

1. **用户来这里要完成什么**
2. **页面由哪些固定区域组成**
3. **主 CTA 是什么**
4. **必须覆盖哪些状态**
5. **窄屏怎么重排**
6. **设计稿必须标清哪些边界条件**

## 2. 路由级页面清单

| 路由 | 页面 | 壳层 | 页面模型 |
| :--- | :--- | :--- | :--- |
| `/workspaces` | Workspaces Page | `AppShell` | 目录 / 入口页 |
| `/workspaces/:workspaceId` | Thread Workspace | `AppShell` | 工作台页 |
| `/automations` | Automations Page | `AppShell` | 目录页 + 当前任务页 |
| `/automations/:automationId` | Automation Detail | `AppShell` | 对象详情页 |
| `/skills` | Skills Page | `AppShell` | 资源目录页 |
| `/runtime` | Catalog / Runtime Page | `AppShell` | 控制面板页 |
| `/settings/*` | Settings Center | `SettingsShell` | 设置壳层 + 内容页 |
| `*` | Not Found | `AppShell` | 恢复页 |

## 3. Workspaces Page

### 3.1 目标

- 选择已有 workspace
- 创建 workspace
- 进入主工作台

### 3.2 固定区域

```text
PageHeader
├─ Title
├─ Summary / Intro
└─ Primary Actions

WorkspaceRegistrySurface
├─ WorkspaceCard*
└─ CreateWorkspaceEntry
```

### 3.3 主动作

- 新建 workspace
- 打开 workspace
- 搜索或筛选 workspace

### 3.4 必须覆盖的状态

- 初始空态
- 已有 workspace 列表
- 创建中
- 创建失败
- 删除 / 移除确认
- 无权限或读取失败

### 3.5 移动端

- 卡片转单列
- 主 CTA 固定在可见区域
- 次要元数据折叠

### 3.6 设计稿必须标清

- workspace 卡片字段
- workspace 行为入口
- 空态引导
- 列表过长时的滚动与搜索行为

## 4. Thread Workspace

这是整个产品最核心的页面。它不是单一状态页，而是一组**共享同一路由的工作台状态**。

### 4.1 固定区域

```text
ThreadWorkspace
├─ ThreadWorkspaceHeader
├─ TimelineSurface
├─ Optional Right Panel
└─ ComposerDock
```

### 4.2 子状态 A: 空态启动页

#### 目标

- 在当前 workspace 中开始新任务

#### 结构

```text
WorkspaceEmptyView
├─ Hero Title
├─ Workspace Selector / Label
├─ Prompt Suggestions
└─ ComposerDock
```

#### 必须覆盖的状态

- 无建议卡片
- 有建议卡片
- composer 聚焦
- attachments 已添加
- workspace 无可用上下文

### 4.3 子状态 B: 线程主态

#### 目标

- 阅读线程时间线
- 继续提问或下达新指令

#### 结构

```text
ThreadMainState
├─ Header
│  ├─ Thread Title
│  ├─ Workspace Label
│  └─ Context Actions
├─ Timeline
│  └─ Mixed Blocks*
└─ ComposerDock
```

#### 必须覆盖的状态

- 空时间线
- 历史回放
- 流式输出
- 长内容折叠/展开
- 多 block 混排

### 4.4 子状态 C: 执行中 / 审批态

#### 目标

- 观察命令、工具调用、推理和审批进展
- 在不离开线程的前提下完成审查与决策

#### 必须出现的 block

- `reasoning`
- `plan`
- `commandExecution`
- `fileChange`
- `approval`
- tool call cards

#### 必须覆盖的状态

- pending approval
- approved
- declined
- cancelled
- command running
- command failed
- command completed
- session disconnected / reconnecting

### 4.5 子状态 D: Thread + Diff 双栏态

#### 目标

- 保留主线程上下文的同时审阅变更

#### 结构

```text
ThreadWithDiff
├─ Main Thread Canvas
└─ DiffViewerPanel
   ├─ File Summary
   ├─ Diff Blocks
   └─ Review Actions
```

#### 设计约束

- diff 面板不能吞掉主线程主体
- 主线程和 diff 至少有一个主次层级
- diff panel 要有独立滚动和关闭路径

### 4.6 子状态 E: 底部终端展开态

#### 目标

- 在不离开线程的前提下观察命令输出或交互式终端

#### 设计约束

- 底部终端属于工作台的一部分，不是另开页面
- 终端展开后仍要保留可见的线程上下文
- 折叠、展开、调整高度必须有明确手柄或操作区

### 4.7 移动端

- 左侧 context tree 转抽屉
- 右侧 diff panel 转全屏或底部 sheet
- composer 固定于底部，但不能遮挡审批和错误信息

### 4.8 设计稿必须标清

- 工作台最小可用布局
- 时间线 block 排列规则
- composer dock 的固定逻辑
- right panel 和 terminal 的收放规则
- 审批卡在时间线中的位置

## 5. Automations Page

### 5.1 目标

- 浏览自动化模板
- 创建自动化
- 查看当前任务

### 5.2 页面模型

同一路由下至少存在两个主视图:

- **模板目录视图**
- **当前任务视图**

### 5.3 固定区域

```text
AutomationsPage
├─ Page Header
├─ Intro Copy
├─ View Switch / Filters
├─ Directory or Current List
└─ Primary CTA
```

### 5.4 必须覆盖的状态

- 模板网格
- 当前任务列表
- 搜索无结果
- 创建自动化 modal 打开
- 创建成功 / 失败

### 5.5 设计稿必须标清

- 目录与当前任务的切换方式
- 卡片字段与列表字段
- 创建按钮位置与 modal 生命周期

## 6. Automation Detail Page

### 6.1 目标

- 阅读单个自动化对象的说明
- 查看状态、调度、模型和历史运行

### 6.2 固定区域

```text
AutomationDetail
├─ Breadcrumb
├─ Main Content
│  ├─ Title
│  └─ Description
└─ Right Detail Panel
   ├─ Status
   ├─ Next Run
   ├─ Folder
   ├─ Repeats
   ├─ Model / Reasoning
   └─ Previous Runs
```

### 6.3 必须覆盖的状态

- 正常详情
- 已暂停 / 出错
- 无历史运行
- 运行记录展开
- 删除或编辑确认

## 7. Skills Page

### 7.1 目标

- 浏览已安装技能
- 搜索技能
- 新建技能

### 7.2 固定区域

```text
SkillsPage
├─ Page Header
├─ Toolbar
│  ├─ Refresh
│  ├─ Search
│  └─ New Skill
└─ Resource Surface
   └─ Skill Card / Row*
```

### 7.3 必须覆盖的状态

- 资源网格
- 搜索结果
- 空态
- 刷新中
- 安装状态 / 错误状态

## 8. Runtime / Catalog Page

### 8.1 目标

- 作为运行时资源、控制面板和操作入口页

### 8.2 固定区域

- 页面标题
- 资源面板
- 控制面板
- 可能的日志或结果区域

### 8.3 必须覆盖的状态

- 资源有值
- 资源为空
- 调用成功 / 失败
- 长列表与长表单

## 9. Settings Center

### 9.1 外层模板

```text
SettingsShell
├─ SettingsSidebar
└─ SettingsContent
```

### 9.2 当前子页

- General
- Appearance
- Config
- Personalization
- MCP
- Git
- Environment
- Worktrees
- Archived Threads

### 9.3 子页内容模型

设置子页至少会落入以下四类之一:

- 表单页
- 资源列表页
- 编辑器页
- 混合页

### 9.4 设计约束

- 左侧 section nav 永远稳定
- 右侧内容区才发生布局变化
- 复杂资源页允许出现列表 + editor block 的混合结构

### 9.5 设计稿必须标清

- 当前 section 的高亮与返回主应用路径
- group / row / editor block 的层级
- 保存动作是行级、组级还是页级

## 10. 异常页

### 10.1 Not Found

必须提供:

- 当前问题说明
- 返回首页 / 返回上一步
- 可操作恢复路径

### 10.2 Route Error

必须提供:

- 错误范围说明
- 刷新、返回、回首页
- 若有 debug 信息，应默认折叠

## 11. 全局弹层和覆盖层

以下虽然不是路由页，但必须纳入页面级蓝图:

- Command Palette
- Create Workspace Dialog
- Automation Create Modal
- Confirm Dialog
- Notification Center
- Approval Drawer

设计稿至少要给出:

- 触发源
- 打开后焦点位置
- 关闭方式
- 与底层页面的关系

## 12. 页面交付清单

每个页面在进入高保真设计前，必须先完成:

- 页面目标
- 路由归属
- 区域结构图
- 主动作与次动作
- 空态 / loading / error / success
- 桌面和移动端重排
- 与全局弹层的关系

## 13. 关联文档

- [信息架构与导航](./IA_NAVIGATION.md)
- [组件状态矩阵](./COMPONENT_STATE_MATRIX.md)
- [布局系统](./LAYOUT_SYSTEM.md)
- [交互编排](./INTERACTIVE_ORCHESTRATION.md)

---
*内部设计施工文档。页面视觉稿、原型和前端实现都应对齐本页定义的页面模型。*
