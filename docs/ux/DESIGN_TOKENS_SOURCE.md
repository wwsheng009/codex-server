# 设计 Token 源规范 (Design Tokens Source)

本页定义整套 UI 设计系统的**可落地 token 源规范**。目标是把“主题系统说明”推进到真正可实现、可维护、可映射到代码的层级。

当前代码基线:

- 样式入口: `frontend/src/styles.css`
- 当前 token 主文件: `frontend/src/styles/tokens.css`

## 1. 当前单一事实来源 (Current Source of Truth)

现阶段，运行中的 CSS token 单一事实来源是:

- `frontend/src/styles/tokens.css`

这意味着:

- 视觉设计稿、组件规格、主题规则都必须能回落到该文件中的语义变量。
- 前端组件不应随意硬编码颜色、阴影、圆角和间距。
- 如果设计系统升级为 JSON 生成流，`tokens.css` 仍必须作为生成产物或受控出口之一。

## 2. Token 分层

Codex 当前 token 建议固定为 5 层:

| 层级 | 作用 | 当前命名示例 |
| :--- | :--- | :--- |
| **Foundation** | 基础比例和原始值 | `--space-4`, `--text-h1-size` |
| **Theme Base** | 主题底色和主强调色 | `--bg-app`, `--bg-main`, `--accent` |
| **Semantic Surface** | 语义表面和文本 | `--surface-card`, `--text-primary`, `--border-subtle` |
| **Interaction** | 焦点、滚动条、状态强调 | `--focus-ring`, `--scrollbar-thumb` |
| **Workbench / Component Domain** | 工作台特有布局与消息变量 | `--thread-stream-gap`, `--rail-collapsed-width` |

## 3. 当前命名命名空间

### 3.1 间距与排版

- `--space-*`
- `--text-h1-*`
- `--text-h2-*`
- `--text-body-*`
- `--text-code-*`
- `--text-meta-*`

### 3.2 基础背景与表面

- `--bg-*`
- `--surface-*`
- `--surface-terminal-*`

### 3.3 文本、边界与阴影

- `--text-*`
- `--border-*`
- `--shadow-*`

### 3.4 强调色与功能色

- `--accent`
- `--accent-strong`
- `--success`
- `--warning`
- `--file`
- `--danger`

### 3.5 工作台专属

- `--thread-*`
- `--rail-*`
- `--focus-ring`
- `--spinner-*`
- `--scrollbar-*`

## 4. Root Data Attributes

当前主题系统已经存在一套运行时属性矩阵，UI 设计必须认识这些开关:

| 属性 | 当前值 |
| :--- | :--- |
| `data-theme` | `light`, `dark` |
| `data-color-theme` | `slate`, `amber`, `mint`, `graphite`, `solarized`, `cyan` |
| `data-thread-spacing` | `tight`, `balanced`, `relaxed` |
| `data-message-surface` | `bare`, `soft`, `layered` |
| `data-user-message-emphasis` | `minimal`, `subtle`, `accented` |
| `data-translucent-sidebar` | `true` |
| `data-pointer-cursor` | `true` |
| `data-motion` | `reduce` |

这意味着整套视觉系统不是单维深浅主题，而是**主题 x 配色 x 消息密度 x 消息表面 x 交互偏好**的组合系统。

## 5. Token 使用规则

### 5.1 组件代码规则

- 组件中优先使用语义 token，不直接写十六进制颜色。
- 组件样式优先消费 `--surface-*`, `--text-*`, `--border-*`，而不是直接消费 `--accent`。
- 只有在该组件承担明确品牌强调时，才直接使用 `--accent`。

### 5.2 页面代码规则

- 页面布局优先消费 spacing、surface 和 rail token。
- 页面不新增孤立的 page-only 颜色 token；先复用语义 token，不足时再回到设计系统层扩展。

### 5.3 工作台规则

- 时间线、composer、diff panel、bottom terminal 使用工作台域 token。
- 工作台域 token 不应污染目录页和设置页。

## 6. 新增 Token 的准入规则

新增 token 前按以下顺序判断:

1. 现有语义 token 是否已经能表达该意图
2. 是否只是某个组件局部状态，而不是系统级 token
3. 是否应该新增为语义 token，而不是组件私有 token
4. 是否需要同时支持 light / dark / color-theme / reduced-motion

满足以下情况才新增:

- 至少两个页面或两个组件会复用
- 能清楚命名其语义
- 不会与现有 token 重叠

## 7. 当前推荐的规范格式

现阶段代码端真实来源是 CSS，但设计系统层建议维护一份结构化规范，字段至少包括:

```json
{
  "foundation": {
    "space": { "2": { "value": "8px" } },
    "type": { "body": { "size": { "value": "0.94rem" } } }
  },
  "semantic": {
    "surface": { "card": { "value": "{theme.bg.main} / derived" } },
    "text": { "primary": { "value": "#303744" } },
    "border": { "subtle": { "value": "derived" } }
  },
  "workbench": {
    "thread": { "streamGap": { "value": "8px" } },
    "rail": { "collapsedWidth": { "value": "56px" } }
  }
}
```

说明:

- 这份结构化 token 可以后续生成 CSS、TS 常量和设计工具导入数据。
- 在真正引入生成链路前，`tokens.css` 仍是当前运行版本的最终权威。

## 8. Token 与设计稿的映射要求

每个高保真设计稿至少要能映射回以下系统变量:

- 页面背景
- 主表面 / 次表面 / overlay
- 主文本 / 次文本 / 弱文本
- 边界强弱
- 阴影层级
- 主强调色
- 焦点环
- 间距尺度

如果设计稿出现无法映射的视觉值，必须先决定:

- 是复用已有 token
- 还是升级设计系统新增 token

不能直接在实现里临时写死。

## 9. 主题与偏好系统的施工要求

设计交付不能只给一套默认主题。至少需要说明:

- light / dark 的对照关系
- 至少一种替代色主题的验证效果
- thread spacing 三档下的消息密度变化
- message surface 三档下的时间线可读性差异
- reduced motion 下哪些视觉反馈会降级

## 10. 代码与文档对齐

当以下内容发生变化时，必须同步更新本页和 `THEME_SYSTEM.md`:

- 新增或删除 root data attributes
- token namespace 变更
- 主题 preset 变更
- 组件开始依赖新的工作台域 token

## 11. 最低交付物

如果要说“设计系统已能支撑整套 UI”，至少要同时具备:

- 本文档
- [主题系统](./THEME_SYSTEM.md)
- [组件状态矩阵](./COMPONENT_STATE_MATRIX.md)
- 代码中的 `frontend/src/styles/tokens.css`

缺一项都很难真正形成稳定、可维护的设计系统。

## 12. 关联文档

- [主题系统](./THEME_SYSTEM.md)
- [颜色指南](./COLOR_PALETTE_GUIDE.md)
- [组件状态矩阵](./COMPONENT_STATE_MATRIX.md)
- [系统治理规范](./SYSTEM_GOVERNANCE.md)

---
*当前运行时 token 权威实现为 `frontend/src/styles/tokens.css`。后续若引入生成链路，本文档定义的是应被生成和被校验的结构。*
