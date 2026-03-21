# Codex 统一交互指南 (Unified UX/Interaction Guide)

## 1. 核心设计哲学 (Design Philosophy)
Codex 的 UI 不仅仅是网页，而是一个**高性能协作工作台 (High-Performance Collaborative Workbench)**。
- **低认知负荷**: 用户不应思考“我在哪”或“该点哪”。
- **极速响应**: 物理级的交互反馈，消除“延迟感”。
- **上下文优先**: 所有设计必须服务于当前的编程任务，不相关信息应被折叠或弱化。

---

## 2. 核心交互隐喻：Rail-Stage 模式
整个系统遵循固定的空间逻辑。
| 区域 (Area) | 角色 (Role) | 交互行为 (Interaction) |
| :--- | :--- | :--- |
| **App Rail** | 导航与全局切换 | 侧边常驻，图标驱动，点击后切换主舞台内容。 |
| **Side Panel** | 配置、参数、二级目录 | 辅助操作。默认展开，但在小屏或专注模式下可折叠。 |
| **Stage (Center)** | 核心工作区 (Thread/Editor) | 沉浸式。最高视觉权重，支持纵向滚动与横向分屏。 |
| **Mode Strip** | 页面标题与全局动作 | 承载页面元数据（Metrics）与核心 CTA 按钮。 |

---

## 3. 交互金律 (The Golden Rules of Interaction)

### 3.1 预见性 (Predictability)
- **位置固定**: 危险操作（如删除）永远在右下角。核心动作（如创建）永远在 Mode Strip 右侧。
- **光标反馈**: 所有可交互项必须触发 `pointer` 光标。

### 3.2 物理反馈 (Physical Feedback)
- **触感点击**: 任何按钮点击必须触发 `-1px` 的 Y 轴位移（Transform）或背景色加深，模拟物理按键。
- **状态同步**: 如果用户发起异步任务，对应的按钮应立即转为 Loading 态。

### 3.3 容错与恢复 (Recovery)
- **撤销优先**: 对于复杂操作，优先提供“撤销”而非“弹出确认框”。
- **破坏性操作**: 仅在“删除工作区”等不可逆场景下使用模态框二次确认。

---

## 4. 通用交互模式 (Interaction Patterns)

### 4.1 列表与卡片 (Lists & Cards)
- **Hover Reveal**: 在桌面端，次要操作（编辑、删除图标）仅在 Hover 时显现，以保持视觉清爽。
- **点击穿透**: 整个卡片区域应作为链接响应，但卡片内的按钮应独立拦截事件。

### 4.2 模态框与侧滑窗 (Modals vs. Drawers)
- **模态框 (Modal)**: 用于**中断式**操作（如：必须填写的创建表单）。
- **侧滑窗 (Drawer)**: 用于**补充式**操作（如：查看运行日志、修改设置）。

### 4.3 表单交互 (Form Dynamics)
- **行内校验**: 错误应在失焦（onBlur）后立即显示，而非提交时。
- **智能默认值**: 尽可能预填用户最近使用的配置（如上次选择的模型）。

---

## 5. 交互状态映射 (Semantic Mapping)
| 交互意图 (Intent) | 颜色/动效 | 视觉信号 (Signal) |
| :--- | :--- | :--- |
| **积极 (Positive)** | `--accent` | 引导用户完成核心路径。 |
| **危险 (Danger)** | `--danger` | 警告破坏性后果。 |
| **进行中 (Processing)** | `Infinite Spin` | 告知系统正在处理。 |
| **禁用 (Disabled)** | `Opacity 0.4` | 逻辑上不可选，必须提供提示原因。 |

---

## 6. 指南索引 (Specialized Guides)
为了获得更具体的实现规格，请参阅以下分册：
1. [**主题与 Token 系统**](./THEME_SYSTEM.md): 间距、颜色、排版的硬性规格。
2. [**交互逻辑与状态**](./UX_INTERACTION.md): 状态机、防抖、无障碍 (ARIA) 规格。
3. [**动画与转场**](./ANIMATION_SYSTEM.md): 缓动曲线与持续时间规格。
4. [**移动化适配**](./MOBILE_ADAPTATION.md): 断点与触摸手势规格。
5. [**UI 文案与语音**](./UI_WRITING.md): 术语表与语气规范。

---
*版本: v2.1 (2025-Q1)*
*所有 UI 提交必须符合本指南中定义的物理性和一致性要求。*
