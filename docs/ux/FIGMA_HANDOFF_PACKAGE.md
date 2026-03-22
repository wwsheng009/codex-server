# Figma 交付包说明 (Figma Handoff Package)

本页定义一套可以直接用于 Figma 建稿与交付的文件结构、页面顺序、组件集和原型流要求。目标是让设计产物与当前 `codex-server` 实现和 `docs/ux` 文档保持一一对应。

逐页 frame 名册见 [Figma Frame 清单](./FIGMA_FRAME_INVENTORY.md)。

## 1. Figma 文件目标

这个 Figma 文件不是单纯做展示图，而是要服务 4 类工作:

1. 页面结构确认
2. 组件复用
3. 状态评审
4. 开发 handoff

## 2. 文件结构

建议按以下页面组织:

```text
00 Cover
01 Foundations
02 Tokens & Variables
03 Component Library
04 Shell & Navigation
05 Workspaces
06 Thread Workspace
07 Automations
08 Skills
09 Runtime
10 Settings
11 Overlays
12 Error & Recovery
13 Prototype Flows
14 Handoff Notes
```

## 3. 每页职责

### 00 Cover

- 产品名
- 当前版本
- 文档关联
- 设计 owner / 更新时间

### 01 Foundations

- 网格
- 间距系统
- 类型层级
- 视觉密度原则

### 02 Tokens & Variables

必须映射到:

- `data-theme`
- `data-color-theme`
- `data-thread-spacing`
- `data-message-surface`
- `data-user-message-emphasis`

### 03 Component Library

只放组件集，不放整页拼图。

### 04 Shell & Navigation

- AppShell 骨架
- Sidebar / PrimaryNav
- SettingsShell
- Command Palette

### 05-10 页面页签

按页面类型分别放:

- low-fi structure
- hi-fi main states
- edge states

### 11 Overlays

- modal
- confirm dialog
- notification center
- menus
- diff / terminal overlays if treated as overlay layouts

### 12 Error & Recovery

- empty states
- loading
- inline errors
- route recovery

### 13 Prototype Flows

放关键用户流，不放所有页面互跳。

### 14 Handoff Notes

- 实现注意事项
- token 使用约束
- 状态覆盖清单

## 4. 组件集要求

Figma 至少需要这些 component sets:

- Button
- Select
- Tabs
- StatusPill
- Notice
- Modal
- ConfirmDialog
- Settings primitives
- Thread block skeletons
- Directory items
- Workspace/thread rows

这些组件集必须与 [COMPONENT_LIBRARY_SPEC.md](./COMPONENT_LIBRARY_SPEC.md) 对齐。

## 5. 页面页签最低交付物

每个页面页签至少包含:

- 页面骨架
- 默认态
- loading 态
- error 态
- no-results / empty 态
- 至少一个高风险或复杂状态

例子:

- Thread Workspace: 空态、线程态、执行中、审批、diff、terminal
- Automations: 模板目录、当前任务、创建 modal
- Settings: 左侧导航 + 一页表单型 + 一页列表型 + 一页混合型

## 6. Frame 命名规则

建议统一采用:

```text
Page / Thread Workspace / Empty
Page / Thread Workspace / Main
Page / Thread Workspace / Approval
Page / Automations / Templates
Page / Automations / Current
Overlay / Modal / Create Automation
State / Error / Route Recovery
```

组件实例采用:

```text
Button / intent=primary / size=md / state=default
Notice / tone=error / dismissible=true
StatusPill / tone=connected
```

## 7. Auto Layout 规则

- 所有页面骨架和列表项必须用 Auto Layout
- 不允许靠手工拖拽做列表 spacing
- 文本容器必须允许真实内容长度变化
- 右侧面板、底部 dock 和 settings 侧栏要明确固定尺寸与伸缩关系

## 8. 变量规则

Figma Variables 至少需要对应:

- spacing
- text styles
- semantic colors
- focus ring
- elevation/shadow
- shell widths and workbench layout constants

如果某个设计值无法映射到系统变量，要先回到 [DESIGN_TOKENS_SOURCE.md](./DESIGN_TOKENS_SOURCE.md) 决定是否升级 token。

## 9. 原型流最低集合

这份文件至少需要做 6 条原型流:

1. 创建或进入 workspace
2. 在空态发起线程
3. 从线程进入执行 / 审批 / diff
4. 创建自动化
5. 浏览技能 / runtime 目录
6. 从主应用进入设置并切换 section

这些流的具体定义见 [PROTOTYPE_USER_FLOWS.md](./PROTOTYPE_USER_FLOWS.md)。

## 10. 开发 handoff 说明区

每个页面页签的末尾应有一块 handoff note，至少包含:

- 路由
- 壳层归属
- 主对象
- 主要组件
- 需要的状态稿
- token 注意事项
- 实现风险

## 11. 禁止事项

- 不要把所有内容画成自由摆放截图
- 不要只有默认态没有错误态
- 不要在 Figma 里随意创造文档中没有定义的页面结构
- 不要直接用视觉稿替代组件集

## 12. 与代码实现的对齐要求

Figma 必须至少能回到以下代码区域:

- `frontend/src/app/router.tsx`
- `frontend/src/components/ui/*.tsx`
- `frontend/src/components/shell/*.tsx`
- `frontend/src/components/settings/*.tsx`
- `frontend/src/pages/*.tsx`
- `frontend/src/styles/tokens.css`

## 13. 交付完成定义

一份 Figma 交付包达到“可进入实现”的标准，至少应满足:

- 组件集齐全
- 关键页面 hi-fi 稿齐全
- 关键状态覆盖
- 变量可映射
- 原型流可跑通
- handoff note 齐全

## 14. 关联文档

- [低保真线框说明](./LOW_FIDELITY_WIREFRAMES.md)
- [Figma Frame 清单](./FIGMA_FRAME_INVENTORY.md)
- [组件库规格书](./COMPONENT_LIBRARY_SPEC.md)
- [设计 Token 源规范](./DESIGN_TOKENS_SOURCE.md)
- [设计验收清单](./DESIGN_ACCEPTANCE_CHECKLIST.md)

---
*Figma 文件应该是设计系统和页面系统的载体，不是单次评审的静态画板。*
