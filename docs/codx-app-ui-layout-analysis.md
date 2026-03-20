# codx-app UI 布局理解与设计分析

更新时间：2026-03-20

## 1. 分析范围

本分析基于两个目录中的界面截图，不基于源码实现：

- `C:\Users\vince\Documents\codx-app`
- `C:\Users\vince\Pictures\codex-app`
- `C:\Users\vince\Pictures\codex-app2`

截图来源：

- `2026-03-20 06 53 51.png`
- `2026-03-20 06 53 51 (2).png`
- `2026-03-20 06 53 51 (3).png`
- `2026-03-20 06 53 51 (4).png`
- `2026-03-20 06 53 51 (5).png`
- `2026-03-20 06 53 52.png`
- `2026-03-20 07 06 03.png`
- `2026-03-20 07 06 03 (2).png`
- `2026-03-20 07 06 04.png`
- `2026-03-20 07 06 04 (2).png`
- `2026-03-20 07 06 04 (3).png`
- `2026-03-20 07 06 04 (4).png`
- `2026-03-20 07 06 05 (4).png`
- `2026-03-20 07 06 05 (5).png`
- `2026-03-20 07 06 06.png`
- `2026-03-20 07 06 06 (2).png`
- `2026-03-20 07 06 06 (3).png`
- `2026-03-20 07 06 06 (4).png`
- `2026-03-20 07 06 06 (5).png`
- `2026-03-20 07 06 07.png`
- `2026-03-20 07 06 07 (2).png`
- `2026-03-20 07 06 07 (3).png`
- `2026-03-20 07 06 07 (4).png`
- `2026-03-20 07 16 44.png`
- `2026-03-20 07 16 45.png`
- `2026-03-20 07 16 45 (2).png`
- `2026-03-20 07 16 45 (3).png`
- `2026-03-20 07 16 45 (4).png`
- `2026-03-20 07 16 45 (5).png`
- `2026-03-20 07 16 45 (6).png`
- `2026-03-20 07 16 46.png`
- `2026-03-20 07 16 46 (2).png`
- `2026-03-20 07 16 46 (3).png`
- `2026-03-20 07 16 46 (4).png`

结论因此属于“界面结构与交互意图理解”，不是源码级组件分析。

## 2. 产品形态判断

`codx-app` 不是普通网页应用，而是桌面工作台式 AI 客户端。

其核心特征：

- 顶部存在系统菜单栏：`File / Edit / View / Window / Help`
- 左侧存在固定宽度边栏，承担导航与线程上下文切换
- 右侧主内容区根据模式切换为空态工作区、线程工作区、设置中心
- 底部输入区是持续存在的主交互入口

整体形态更接近：

- IDE / 工作台应用
- Electron / Tauri 风格桌面客户端
- “线程驱动”的 AI 任务界面

## 3. 总体布局骨架

主界面可抽象为如下布局：

```text
AppWindow
├─ SystemMenuBar
├─ Sidebar
│  ├─ SidebarHeader
│  ├─ PrimaryNav
│  ├─ WorkspaceThreadTree
│  └─ SidebarFooter
└─ MainSurface
   ├─ ContextHeader
   ├─ ContentCanvas
   └─ ComposerDock
```

设置页可抽象为：

```text
SettingsShell
├─ SettingsSidebar
│  ├─ BackToApp
│  └─ SettingsSectionNav
└─ SettingsContent
   ├─ PageTitle
   ├─ SettingsGroup
   │  └─ SettingRow*
   └─ SettingsGroup*
```

## 4. 左侧边栏理解

左侧边栏不是单纯的页面导航，而是“导航 + 工作上下文树”的混合体。

### 4.1 一级功能区

截图中可见的一级入口包括：

- 新线程
- 自动化
- 技能
- 设置

这里说明边栏顶部和底部承担的是全局功能切换。

### 4.2 工作区 / 线程树

边栏中部展示 workspace 分组及其线程列表，例如：

- `ai-gateway`
- `mint`

每个 workspace 下挂载多个线程，线程行带：

- 标题
- 最近更新时间
- 可能的快速操作入口

因此这部分的本质不是菜单，而是“工作上下文索引器”。

### 4.3 边栏职责结论

左栏承担 3 个职责：

- 功能入口
- 工作区切换
- 线程切换

这和典型网站 sidebar 很不一样，更接近 IDE 的 `Activity Bar + Explorer` 混合模式。

## 5. 主工作台页面理解

从主截图看，右侧主区域默认处于“新线程空态”。

结构大致如下：

```text
MainSurface
├─ TopRightControls
├─ CenterHero
│  ├─ App/Icon
│  ├─ MainTitle
│  └─ CurrentWorkspaceSelector
├─ PromptSuggestions
└─ ComposerDock
   ├─ AttachmentButton
   ├─ PromptInput
   ├─ SendButton
   └─ ContextStatusBar
```

### 5.1 中心空态区

页面中心展示：

- 主标题：`开始构建`
- 当前 workspace：`ai-gateway`
- 建议卡片

这说明主区默认不是信息密集的 dashboard，而是“任务启动页”。

### 5.2 建议卡片区

建议卡片承担：

- 首次任务引导
- 高频任务模板入口
- 降低输入门槛

它们位于 composer 之上，属于“辅助启动层”，而不是主控制区。

### 5.3 底部输入区

底部输入区是整个产品的主交互入口，截图中可见：

- 附件入口 `+`
- 大尺寸输入框
- 发送按钮
- 环境/权限/分支状态栏

因此主内容区真正的重心在 composer，而不是顶部按钮。

### 5.4 线程主态

新增截图补到了真实线程打开后的主界面。

线程主态下的主区结构大致为：

```text
ThreadWorkspace
├─ ThreadHeader
│  ├─ ThreadTitle
│  ├─ Run / Context Controls
│  └─ Git / Usage Indicators
├─ MessageStream
│  ├─ AssistantMessage
│  ├─ InlineCode
│  ├─ BulletList
│  └─ ActionChip
└─ ComposerDock
```

观察点：

- 标题区固定在顶部，展示当前线程名
- 消息区是单列阅读流，宽度受控，偏文档阅读体验
- 内容可混合代码路径、内联代码、列表、轻量状态 chip
- composer 在已有消息时仍固定保留在底部

这说明线程态不是气泡聊天为主，而是“文档式任务流 + 输入 dock”。

### 5.5 Diff 面板

新增截图补到了主工作区右侧 diff 面板打开的状态。

布局模式变为：

```text
WorkspaceWithDiff
├─ MainCanvas
└─ DiffPanel
   ├─ ChangedFilesSummary
   ├─ DiffBlocks
   └─ Review / Apply Actions
```

关键观察：

- diff 面板是右侧附加列，不是替换主内容区
- 主工作区仍保留空态或主线程区域
- 右侧 diff 面板采用代码 review 风格的单独滚动区
- 文件块内展示增删行、折叠行、文件名和变更计数
- diff 打开态还包含右侧文件筛选树与批量动作，例如“还原全部 / 暂存全部”

因此右侧面板应被理解为“辅助工作面板”，不是页面级切换。

### 5.6 执行中态

`codx-app2` 补到了线程执行中的真实状态。

执行中态下，主区会在消息流中插入运行过程块：

```text
ExecutionState
├─ AssistantNarration
├─ CommandBlock*
│  ├─ ToolTypeLabel
│  ├─ CommandText
│  ├─ Running / Success Status
│  └─ OutputPreview
├─ ThinkingState
└─ ComposerDock
```

观察点：

- 运行中的 shell 命令直接内嵌在消息流里，而不是跳转到独立页
- 命令块展示持续时间、状态、命令内容和输出摘录
- “正在思考”与工具调用状态混合出现在同一纵向时间流中
- 执行中的线程在左侧列表上会显示状态 badge，例如“等待批准”

这说明线程主区本质是“消息流 + 执行流 + 审批流”的融合时间线。

### 5.7 审批卡片与底部终端

`codx-app2` 还补到了审批卡片和底部终端面板。

其结构可抽象为：

```text
WorkspaceWithApprovalAndTerminal
├─ MessageStream
│  ├─ CommandBlocks
│  └─ ApprovalCard
├─ ComposerDock
└─ BottomTerminalPanel
   ├─ TerminalHeader
   └─ TerminalConsole
```

关键观察：

- 审批不是弹窗优先，而是可嵌入消息流中的一等卡片
- 审批卡片包含：
  - 问题文案
  - 待执行命令
  - 选项列表
  - 跳过 / 提交动作
- 底部终端是一个可展开的辅助面板，不会挤占左栏和主区结构
- 终端上下文与当前 workspace 强绑定

因此审批流和终端流都属于工作台主布局的一部分，而不是额外工具窗口。

### 5.8 本地打开方式与环境上下文

新增截图还补到了右上角“Open in Terminal”下拉菜单，以及输入区左下角的本地项目选择菜单。

可见的本地打开目标包括：

- VS Code
- Visual Studio
- File Explorer
- Terminal
- Git Bash
- WSL

这说明工作台在设计上明确区分：

- 应用内部操作
- 外部本地工具跳转

而底部环境菜单则承担：

- 本地项目选择
- Codex web 关联
- 云端发送能力

因此底部状态栏不仅是状态显示，也包含环境切换与能力切换入口。

### 5.9 自动化触发的线程态

`codx-app3` 补到了由自动化任务触发的新线程执行态。

和普通线程相比，这类线程在消息流上方增加了自动化上下文摘要：

- Automation 名称
- Automation ID
- memory 文件位置
- last run 信息

这说明线程工作台除了手动线程，还支持“由系统任务触发的线程实例”，并且会在主区显式暴露任务上下文。

## 6. 功能页理解

除了工作台和设置页，`codx-app2` 还补到了两个一级功能页。

### 6.1 自动化页面

自动化页面采用“分类标题 + 模板卡片网格”的布局。

结构大致为：

```text
AutomationPage
├─ PageTitle
├─ IntroCopy
├─ CategorySection*
│  ├─ SectionTitle
│  └─ AutomationTemplateCard*
└─ NewAutomationButton
```

观察点：

- 页面不是表单，而是模板浏览页
- 卡片按场景分组，如 `Status reports`、`Release prep`
- 每个卡片都像可复用任务模板
- 右上角存在 `+ 新`，说明支持创建新自动化任务

这说明“自动化”是一个任务模板与调度入口页。

### 6.2 自动化创建弹层

自动化页面还补到了创建弹层。

其特征：

- 居中大尺寸 modal
- 顶部标题 + `Use template`
- 主体为多行文本输入区
- 底部是上下文设置行，如工作树、项目、时间、模型、推理强度
- 右下角是取消 / 创建动作

这说明自动化创建流程采用“对话框编辑器”模式，而不是跳到单独页面。

### 6.3 技能页面

技能页面采用“已安装技能列表 + 搜索 + 新建”的资源浏览布局。

结构大致为：

```text
SkillsPage
├─ PageTitle
├─ IntroCopy
├─ Toolbar
│  ├─ Refresh
│  ├─ SearchInput
│  └─ NewSkillButton
└─ InstalledSkillGrid
   └─ SkillRow*
```

观察点：

- 技能页更像资源目录 / 插件中心
- 列表是双列资源卡片式排列
- 每项展示图标、名称、说明、安装状态
- 页面支持刷新、搜索、创建

说明“技能”是管理型目录页，不是聊天上下文附属面板。

### 6.4 自动化当前任务列表

`codx-app3` 还补到了自动化任务创建后的“Current”列表页。

结构大致为：

```text
AutomationCurrentView
├─ PageTitle
├─ CurrentSection
│  └─ AutomationRow*
│     ├─ Name
│     ├─ Workspace
│     └─ Schedule
```

观察点：

- 自动化页存在从“模板目录”切换到“当前任务列表”的状态
- 当前任务以轻量列表行展示，不是卡片网格
- 每个任务显示名称、归属 workspace 和频率

这说明自动化模块至少有两个主视图：

- 模板浏览页
- 当前任务列表页

### 6.5 自动化详情页

`codx-app3` 还补到了自动化详情页。

其布局模式为：

```text
AutomationDetailView
├─ Breadcrumb
├─ MainContent
│  ├─ Title
│  └─ Description
└─ RightDetailPanel
   ├─ Status
   ├─ NextRun
   ├─ LastRun
   ├─ Folder
   ├─ Repeats
   ├─ Model
   ├─ Reasoning
   └─ PreviousRuns
```

观察点：

- 自动化详情页采用“主内容 + 右侧详情栏”的双栏布局
- 右侧是状态与配置摘要，而不是编辑表单
- 顶部右侧还有测试 / 启停 / 删除类动作

这说明自动化不仅有创建入口，还有完整的对象详情页。

## 7. 设置中心理解

设置页采用的是标准桌面设置中心布局。

### 7.1 左侧设置导航

可见分类包括：

- 常规
- Appearance
- 配置
- 个性化
- MCP 服务器
- Git
- 环境
- 工作树
- 已归档线程

顶部还有“返回应用”。

这说明设置是独立模式，而不是浮层或抽屉。

### 7.2 右侧设置内容

右侧详情区采用“分组 + 行配置”的结构。

每个设置行一般由两部分组成：

- 左侧：标题 + 说明
- 右侧：控件

控件类型包括：

- 下拉框
- 开关
- 按钮组

这是一种成熟且可扩展的桌面设置模板。

### 7.3 设置子页的实际布局模式

新增截图补到了多个设置子页，说明设置中心不是单一表单，而是复用统一模板承载不同内容类型。

#### 常规

- 使用标准 `SettingRow`
- 左侧标题 + 说明
- 右侧为 select / switch / segmented actions
- 适合运行环境、通知、行为配置

#### Appearance

- 在标准设置模板中嵌入了主题预览区
- 有 diff 风格预览块
- 有颜色、字体、对比度、开关与 slider
- 说明视觉设置页可以包含“预览 + 配置”双层结构

#### 配置

- 仍是标准设置行
- 外加“导入外部配置”卡片式列表
- 说明设置页支持“表单区 + 批处理卡片区”混合结构

#### 个性化

- 顶部单个 select
- 下方大面积 multiline 文本框
- 右下保存按钮
- 说明设置模板支持“轻表单 + 大文本编辑器”模式

#### MCP 服务器

- 顶部是自定义服务器区
- 下方是推荐服务器列表
- 列表项包含图标、标题、说明、操作按钮
- 说明设置页也可承载 marketplace / app-list 风格的列表

#### Git

- 顶部是标准设置行
- 下方是多个文本区域，用于模板或指令
- 说明设置页支持“行配置 + 多段配置文本”的复合布局

#### 环境

- 主体是项目列表
- 每行包含项目名、归属信息、右侧操作
- 说明此页更像“资源选择器”

#### 工作树

- 顶部是数值和开关配置
- 下方是空列表区
- 说明设置中心支持“配置 + 数据列表占位”混合形态

#### 已归档线程

- 主区是归档项列表
- 当前截图中出现了错误线程项和“取消归档”按钮
- 说明归档页本质是资源列表页，而不是传统设置表单页

## 8. 菜单与弹层系统

从账户菜单、`File` 菜单、`View` 菜单、`Help` 菜单可以看出弹层系统高度统一。

共同特征：

- 白色 / 极浅色浮层背景
- 较大圆角
- 柔和阴影
- 清晰分组分隔线
- 行高较大
- 支持快捷键右对齐
- 当前项使用浅灰高亮

这说明应用内部存在稳定的菜单原语，适合抽象为：

- `MenuPopover`
- `MenuItem`
- `MenuGroup`
- `MenuDivider`
- `ShortcutLabel`

### 8.1 顶部菜单覆盖度

新增截图基本补齐了顶部菜单的覆盖范围：

- `File`
- `Edit`
- `View`
- `Window`
- `Help`

其中：

- `View` 菜单直接暴露布局切换能力，例如切换侧边栏、终端、diff panel
- `Help` 菜单承载文档、自动化、环境、工作树、技能、MCP 等知识入口
- `File` 菜单承载新线程、打开目录、设置、退出等应用级动作

这说明系统菜单是高频布局控制入口，而不是可有可无的桌面装饰。

### 8.2 Git 操作菜单

主工作区右上角还存在独立的 Git 操作下拉菜单。

包含：

- 提交
- 推送
- 创建拉取请求
- Create branch

说明右上角工具区承担“线程上下文相关操作”，而顶部系统菜单承担“应用级操作”。

### 8.3 账户与语言菜单

新增截图还补到了账户菜单的语言选择展开态。

这说明账户菜单具备：

- 登录状态入口
- 设置入口
- 语言选择二级列表
- 退出登录

因此账户菜单不是简单 profile 菜单，而是一个轻量全局控制中心。

### 8.4 外部打开菜单

`codx-app2` 还补到了右上角外部打开菜单。

这说明菜单系统除了应用级菜单外，还有面向上下文的工具分发菜单，用于把当前项目快速切到外部工具。

因此菜单系统至少分成三层：

- 系统级菜单
- 上下文操作菜单
- 账户 / 语言全局菜单

### 8.5 线程上下文菜单

`codx-app3` 补到了线程行的右键 / 更多操作菜单。

可见操作包括：

- Pin thread
- 重命名线程
- 归档线程
- 标记为未读
- 复制工作目录
- 复制会话 ID
- 复制 Deeplink
- 派生到本地
- 派生到新工作树

这说明线程行本身是一个高密度操作节点，除了“选择线程”外，还承担归档、复制、派生等工作流入口。

## 9. 视觉语言总结

这套 UI 的风格关键词：

- 安静
- 极简
- 桌面原生感
- 低噪声
- 低对比
- 大留白
- 强结构

具体表现：

- 主背景接近白色
- 左栏带轻微暖灰 / 粉灰层
- 边界以浅阴影和极淡描边为主
- 圆角使用频繁
- 图标以线性图标为主
- 不靠强色块建立层级，更多依赖留白、位置和排版

新增截图进一步说明：

- 资源列表页和设置页共用相同的浅色容器语言
- 错误归档项也没有使用重警告背景，而是克制地保留在同一视觉体系中
- 右侧 diff 与主题预览中的代码区域采用独立但仍然很轻的嵌入式代码面板风格

## 10. 信息层级判断

从信息层级上看，优先级大致是：

1. 左侧线程 / workspace 上下文
2. 当前主任务区域
3. 底部输入区
4. 辅助建议卡片
5. 系统菜单与账户菜单

这意味着设计优先级是：

- 先保证工作上下文可见
- 再保证主任务区聚焦
- 最后提供轻量辅助操作

## 11. 关键交互模式

### 11.1 线程驱动

核心工作流围绕“线程”组织，而不是文档页或单个聊天页。

### 11.2 Workspace 作用域

主区内容、空态标题和建议动作都与当前 workspace 相关。

### 11.3 Composer 驱动

用户最主要的行为不是点击顶部按钮，而是：

- 输入 prompt
- 添加文件
- 触发命令 / 构建动作

### 11.4 设置中心独立模式

设置页是单独的信息架构，不与主工作台混排。

### 11.5 右侧辅助面板模式

Diff 面板证明该应用支持“主工作区 + 右侧辅助面板”的双栏工作模式。

这意味着产品至少有两种主区形态：

- 单栏工作模式
- 主内容 + 辅助面板模式

### 11.6 列表型设置页

环境、MCP 服务器、已归档线程等页面说明设置中心内部不只有表单，还有资源列表与操作列表。

### 11.7 模态创建流

自动化创建弹层说明，部分一级功能不是切页，而是“页内触发大弹层编辑器”。

### 11.8 审批内嵌流

审批卡片说明风险决策被设计为主线程上下文中的一部分，而不是打断式系统弹窗。

### 11.9 自动化对象生命周期

自动化模块存在完整生命周期：

- 浏览模板
- 创建任务
- 查看当前任务列表
- 查看单个任务详情
- 触发或观察自动化线程执行

## 12. 可落地的布局原语

如果要实现这套 UI，建议先抽象出以下布局原语：

### 12.1 Shell 层

- `AppShell`
- `WorkspaceShell`
- `SettingsShell`
- `DirectoryPageShell`
- `ModalEditorShell`

### 12.2 结构层

- `SidebarNav`
- `WorkspaceTree`
- `ThreadList`
- `MainCanvas`
- `ComposerDock`
- `SettingsSection`
- `SettingRow`
- `RightSidePanel`
- `ResourceList`
- `SettingEditorBlock`
- `ExecutionTimeline`
- `ApprovalCard`
- `BottomTerminalPanel`
- `TemplateGrid`

### 12.3 基础组件层

- `MenuPopover`
- `MenuItem`
- `SelectField`
- `SwitchField`
- `SuggestionCard`
- `StatusBar`
- `ThreadRow`
- `DiffViewerPanel`
- `SettingsResourceRow`
- `LanguageSelectorMenu`
- `GitActionMenu`
- `OpenExternallyMenu`
- `SkillCard`
- `AutomationTemplateCard`
- `ProjectScopeMenu`
- `ThreadContextMenu`
- `AutomationSummaryCard`
- `AutomationDetailPanel`

## 13. 页面级线框说明

以下线框基于截图观察抽象，目标是帮助把界面理解转成稳定布局，而不是精确复刻像素。

### 13.1 工作台空态

```text
┌─────────────────────────────────────────────────────────────────────┐
│ System Menu Bar                                                    │
├───────────────┬─────────────────────────────────────────────────────┤
│ Sidebar       │ Workspace Topbar                                   │
│               │                                                     │
│ Primary Nav   │                     Hero Icon                       │
│               │                    开始构建                          │
│ WorkspaceTree │                   ai-gateway                       │
│               │                                                     │
│               │     Suggestion Card   Suggestion Card   Suggestion  │
│               │                                                     │
│ Footer        │   Composer Input / Attach / Send                    │
│               │   Context Status Bar                                │
└───────────────┴─────────────────────────────────────────────────────┘
```

布局重点：

- 左侧边栏恒定存在
- 主区视觉重心在中心空态与底部输入区
- 右上角工具区为轻量附属，不抢主视觉

### 13.2 线程执行态

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Thread Header / Actions                                             │
├─────────────────────────────────────────────────────────────────────┤
│ Assistant message / narrative                                       │
│                                                                     │
│ Shell block                                                         │
│  - command                                                          │
│  - status / duration                                                │
│  - output preview                                                   │
│                                                                     │
│ Thinking state                                                      │
│                                                                     │
│ Approval card (optional)                                            │
│  - question                                                         │
│  - options                                                          │
│  - actions                                                          │
├─────────────────────────────────────────────────────────────────────┤
│ Composer Dock                                                       │
├─────────────────────────────────────────────────────────────────────┤
│ Bottom Terminal Panel (optional open state)                         │
└─────────────────────────────────────────────────────────────────────┘
```

布局重点：

- 主流是单列时间线
- 命令、审批、思考状态都嵌入消息流
- 终端是底部附加层，不是主内容替代

### 13.3 线程 + Diff 双栏态

```text
┌────────────────── Main Workspace ─────────────────┬─ Diff Panel ────┐
│ Thread / Empty Canvas                             │ File summary     │
│                                                   │ Diff blocks      │
│                                                   │ Review actions   │
│ Composer Dock                                     │                  │
└───────────────────────────────────────────────────┴──────────────────┘
```

布局重点：

- Diff 是辅助面板
- 主内容与 diff 同时可见
- 适合 code review / file change 决策

### 13.4 自动化目录页

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Page Title              Learn more                     + 新          │
├─────────────────────────────────────────────────────────────────────┤
│ Section: Status reports                                            │
│  Card            Card                                              │
│  Card                                                            │
│                                                                     │
│ Section: Release prep                                              │
│  Card            Card                                              │
│  Card                                                              │
└─────────────────────────────────────────────────────────────────────┘
```

布局重点：

- 内容按分类分组
- 分类下是模板卡片网格
- 行为是“浏览模板并创建”，不是编辑详情

### 13.4A 自动化当前任务列表页

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Page Title                                                         │
├─────────────────────────────────────────────────────────────────────┤
│ Section: Current                                                   │
│  ○ Automation row                                  每小时           │
└─────────────────────────────────────────────────────────────────────┘
```

布局重点：

- 更像资源列表，不是模板浏览
- 适合展示已存在的计划任务

### 13.5 自动化创建弹层

```text
┌────────────────────────── Modal Editor ─────────────────────────────┐
│ Title                                  Info / Use template          │
├─────────────────────────────────────────────────────────────────────┤
│ Large multiline editor                                              │
│                                                                     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Scope / Project / Time / More…                      Cancel  Create  │
└─────────────────────────────────────────────────────────────────────┘
```

布局重点：

- 大文本编辑器优先
- 底部是上下文设置行
- 适合模板实例化与计划任务创建

### 13.6 技能目录页

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Page Title                         Refresh  Search      + 新技能     │
├─────────────────────────────────────────────────────────────────────┤
│ Skill row                    │ Skill row                              │
│ Skill row                    │ Skill row                              │
│ Skill row                    │ Skill row                              │
│ ...                                                           scroll │
└─────────────────────────────────────────────────────────────────────┘
```

布局重点：

- 双列资源目录
- 每项包含图标、标题、说明、状态
- 更接近插件市场而不是设置表单

### 13.7 设置中心

```text
┌──────────── Settings Sidebar ───────────┬──── Settings Content ─────┐
│ Back to App                             │ Page Title                │
│ 常规                                     │ Group                     │
│ Appearance                              │  SettingRow               │
│ 配置                                     │  SettingRow               │
│ 个性化                                   │                           │
│ MCP 服务器                               │ Group / List / Editor     │
│ Git                                     │                           │
│ 环境                                     │                           │
│ 工作树                                   │                           │
│ 已归档线程                               │                           │
└─────────────────────────────────────────┴────────────────────────────┘
```

布局重点：

- 左右双栏模板稳定
- 右侧可根据分类切成表单、列表、编辑器或混合型内容

### 13.8 自动化详情页

```text
┌──────────────────────── Main Detail ──────────────┬─ Side Panel ───┐
│ Breadcrumb                                        │ Status         │
│ Title                                             │ Next run       │
│ Description                                       │ Folder         │
│                                                   │ Repeats        │
│                                                   │ Model          │
│                                                   │ Reasoning      │
│                                                   │ Previous runs  │
└───────────────────────────────────────────────────┴────────────────┘
```

布局重点：

- 主区负责对象说明
- 右栏负责状态、调度与配置摘要
- 适合从列表进入后的对象详情管理

## 14. 建议组件树

### 14.1 App 级组件树

```text
CodxApp
├─ SystemMenuController
├─ AppShell
│  ├─ Sidebar
│  │  ├─ PrimaryNav
│  │  ├─ WorkspaceGroupList
│  │  │  └─ ThreadRow*
│  │  └─ SidebarFooter
│  └─ MainRouterSurface
│     ├─ WorkspaceEmptyView
│     ├─ ThreadWorkspaceView
│     ├─ AutomationView
│     ├─ SkillsView
│     └─ SettingsView
├─ GlobalMenus
│  ├─ AccountMenu
│  ├─ LanguageMenu
│  ├─ GitActionMenu
│  ├─ OpenExternallyMenu
│  └─ ThreadContextMenu
└─ ModalLayer
   ├─ AutomationCreateModal
   └─ OtherEditorModals
```

### 14.2 Thread Workspace 级组件树

```text
ThreadWorkspaceView
├─ ThreadWorkspaceHeader
│  ├─ ThreadTitle
│  ├─ WorkspaceLabel
│  ├─ PlayAction
│  ├─ OpenExternallyButton
│  └─ GitActionButton
├─ ThreadTimeline
│  ├─ AssistantMessageBlock*
│  ├─ ShellCommandBlock*
│  ├─ ToolCallBlock*
│  ├─ ApprovalCard*
│  └─ ThinkingStateBlock*
├─ ComposerDock
│  ├─ ScopePicker
│  ├─ PermissionModeIndicator
│  ├─ BranchIndicator
│  ├─ AttachmentButton
│  ├─ PromptTextarea
│  └─ SendButton
├─ DiffViewerPanel?
└─ BottomTerminalPanel?
```

### 14.3 Settings 级组件树

```text
SettingsView
├─ SettingsSidebar
│  ├─ BackButton
│  └─ SettingsNavItem*
└─ SettingsContent
   ├─ SettingsPageHeader
   ├─ SettingsGroup*
   │  ├─ SettingRow*
   │  ├─ SettingsResourceList*
   │  └─ SettingsEditorBlock*
   └─ ActionFooter?
```

### 14.4 Automation 级组件树

```text
AutomationView
├─ PageHeader
│  ├─ Title
│  ├─ LearnMoreLink
│  └─ NewAutomationButton
├─ AutomationTemplateBrowser?
│  └─ AutomationCategorySection*
│     ├─ SectionTitle
│     └─ AutomationTemplateCard*
├─ AutomationCurrentList?
│  └─ AutomationListRow*
├─ AutomationDetailView?
│  ├─ AutomationDetailMain
│  └─ AutomationDetailPanel
└─ AutomationCreateModal?
```

### 14.5 Skills 级组件树

```text
SkillsView
├─ PageHeader
│  ├─ Title
│  ├─ RefreshButton
│  ├─ SearchInput
│  └─ NewSkillButton
└─ SkillCatalogGrid
   └─ SkillCard*
```

## 15. 对现有实现的启发

如果要在 Web 端或桌面壳层中复刻该体验，重点不是单页视觉，而是壳层逻辑：

- 左侧边栏必须同时支持导航和上下文树
- 主区必须支持空态 / 线程态 / 设置态 / 功能目录页切换
- 底部 composer 必须是第一主入口
- 设置页应采用独立模板，不应与主线程工作台混排
- 审批、命令执行、终端应视为线程工作台的组成部分
- 自动化与技能应实现为目录页或资源页，而不是简单弹窗

## 16. 结论

`codx-app` 的 UI 本质是一个 AI 工作台桌面客户端，核心布局模式为：

- 顶部系统菜单
- 左侧上下文边栏
- 右侧主画布
- 底部持续输入区

它的重点不是页面跳转，而是“工作上下文切换 + 线程驱动 + 输入驱动”。

## 17. 当前覆盖与剩余缺口

基于三批截图，目前已经覆盖：

- 主工作台空态
- 线程主态
- 线程执行中态
- Diff 面板
- 审批卡片
- 底部终端面板
- 顶部系统菜单
- Git 操作菜单
- 外部打开菜单
- 账户菜单与语言二级菜单
- 自动化页面与自动化创建弹层
- 自动化当前列表页
- 自动化详情页
- 自动化触发线程态
- 技能页面
- 设置中心：常规、Appearance、配置、个性化、MCP 服务器、Git、环境、工作树、已归档线程

仍未看到或仍然较弱的状态：

- 多线程切换时的中间态或 loading 态
- 更复杂的多步骤审批类型
- 自动化任务编辑页

如果后续要继续推进，可基于本文档再展开两类产出：

- 组件树与页面区域图
- 映射到现有项目代码结构的落地方案

## 18. 页面状态矩阵

下表用于把页面模式、布局结构和已覆盖证据对齐，便于开发与验收。

| 模块 | 关键状态 | 主布局 | 主要交互 | 截图覆盖 |
| --- | --- | --- | --- | --- |
| 工作台 | 空态 | 左栏 + 主画布 + 底部 composer | 选择 workspace、点击建议卡片、直接输入 | 已覆盖 |
| 工作台 | 线程主态 | 左栏 + 单列消息流 + composer | 阅读消息、继续追问、执行上下文操作 | 已覆盖 |
| 工作台 | 执行中态 | 单列时间线 + 命令块 + 思考态 | 观察命令执行、等待结果、处理中断 | 已覆盖 |
| 工作台 | 审批态 | 时间线内嵌审批卡片 + 底部终端 | 选择批准选项、提交、跳过 | 已覆盖 |
| 工作台 | Diff 双栏态 | 主画布 + 右侧 diff 面板 | 浏览文件树、查看 diff、批量审查 | 已覆盖 |
| 工作台 | 线程上下文菜单 | 左栏线程行弹出菜单 | 置顶、归档、复制、派生 | 已覆盖 |
| 工作台 | 加载 / 切换中间态 | 未知 | 线程切换或 workspace 切换反馈 | 未覆盖 |
| 自动化 | 模板浏览页 | 页面头 + 分类卡片网格 | 浏览模板、创建任务 | 已覆盖 |
| 自动化 | 创建弹层 | 居中 modal + 底部上下文行 | 输入描述、选择项目、频率、模型 | 已覆盖 |
| 自动化 | 当前任务列表 | 轻量资源列表 | 查看已有任务、进入详情 | 已覆盖 |
| 自动化 | 详情页 | 主内容 + 右侧详情栏 | 查看状态、运行参数、历史 | 已覆盖 |
| 自动化 | 编辑页 | 未知 | 修改现有任务 | 未覆盖 |
| 技能 | 目录页 | 页面头 + 双列资源目录 | 搜索、刷新、新建 | 已覆盖 |
| 设置 | 表单型页面 | 左侧分类 + 右侧设置行 | 修改配置、切换开关、选择项 | 已覆盖 |
| 设置 | 列表型页面 | 左侧分类 + 右侧资源列表 | 浏览环境、MCP、归档条目 | 已覆盖 |
| 菜单 | 系统菜单 | 顶部原生菜单 | 全局操作和布局切换 | 已覆盖 |
| 菜单 | 上下文菜单 | 右上角工具区 / 线程行菜单 | Git、外部打开、线程操作 | 已覆盖 |

## 19. 截图到状态映射

以下映射用于快速追溯“哪个截图支撑了哪个结论”。

### 19.1 `Documents/codx-app`

- `2026-03-20 06 53 51.png`
  - 工作台空态
  - 左侧线程树
  - 底部 composer
- `2026-03-20 06 53 51 (2).png`
  - 账户菜单
- `2026-03-20 06 53 51 (3).png`
  - `File` 菜单
- `2026-03-20 06 53 51 (4).png`
  - `View` 菜单
- `2026-03-20 06 53 51 (5).png`
  - `Help` 菜单
- `2026-03-20 06 53 52.png`
  - 设置中心 `常规`

### 19.2 `Pictures/codex-app`

- `2026-03-20 07 06 03.png`
  - 线程主态
- `2026-03-20 07 06 04.png`
  - Diff 双栏态
- `2026-03-20 07 06 04 (2).png`
  - Git 操作菜单
- `2026-03-20 07 06 05 (4).png`
  - 账户菜单
- `2026-03-20 07 06 07 (4).png`
  - 语言二级菜单
- `2026-03-20 07 06 05.png`
  - 设置中心 `常规`
- `2026-03-20 07 06 06.png`
  - 设置中心 `Appearance`
- `2026-03-20 07 06 06 (2).png`
  - 设置中心 `配置`
- `2026-03-20 07 06 06 (3).png`
  - 设置中心 `个性化`
- `2026-03-20 07 06 06 (4).png`
  - 设置中心 `MCP 服务器`
- `2026-03-20 07 06 06 (5).png`
  - 设置中心 `Git`
- `2026-03-20 07 06 07.png`
  - 设置中心 `环境`
- `2026-03-20 07 06 07 (2).png`
  - 设置中心 `工作树`
- `2026-03-20 07 06 07 (3).png`
  - 设置中心 `已归档线程`

### 19.3 `Pictures/codex-app2`

- `2026-03-20 07 16 44.png`
  - 外部打开菜单
- `2026-03-20 07 16 45.png`
  - 技能目录页
- `2026-03-20 07 16 45 (3).png`
  - 自动化目录页
- `2026-03-20 07 16 45 (4).png`
  - 自动化创建弹层
- `2026-03-20 07 16 45 (6).png`
  - 线程执行中态
- `2026-03-20 07 16 46.png`
  - 审批卡片 + 底部终端面板
- `2026-03-20 07 16 46 (2).png`
  - 审批与执行流的并存状态
- `2026-03-20 07 16 46 (3).png`
  - 命令输出成功块
- `2026-03-20 07 16 46 (4).png`
  - 审批卡片的另一条命令示例

### 19.4 `Pictures/codex-app3`

- `2026-03-20 07 30 02 (4).png`
  - 线程上下文菜单
- `2026-03-20 07 30 03 (4).png`
  - 自动化当前任务列表
- `2026-03-20 07 30 03 (5).png`
  - 自动化详情页
- `2026-03-20 07 30 03 (6).png`
  - 自动化触发线程态
- `2026-03-20 07 30 03 (2).png`
  - 自动化创建弹层的完整上下文控制
- `2026-03-20 07 30 02 (5).png`
  - Diff 面板中文件树与批量操作
