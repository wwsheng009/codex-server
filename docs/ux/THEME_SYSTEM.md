# 主题系统 (Architectural Theme System)

## 1. 视觉隐喻与设计原则 (Visual Metaphor and Principles)

Codex UI 采用**分层工作台 (layered workbench)** 隐喻。每一层通过表面亮度、边界、阴影和内容密度区分职责，而不是依赖口号式的视觉趋势命名。

### 核心视觉子原则

- **More focus**: 核心内容区的对比度、可读性和可操作性优先于装饰层。
- **Distraction-free**: 背景与容器只承担分层和归组作用，不承担无意义装饰。
- **Semantic over decorative**: 颜色与样式 token 优先表达语义与状态，而不是具体外观名称。

## 2. Token 系统架构 (Token Hierarchy)

Codex 沿用设计 token 的三层结构，便于跨组件、跨主题和跨平台映射:

| 层级 | 名称 | 作用 |
| :--- | :--- | :--- |
| **Seed tokens** | 种子变量 | 品牌色、基础圆角、基础间距等原始输入。 |
| **Map tokens** | 派生变量 | 根据种子生成文本、边界、表面、状态等中间值。 |
| **Alias tokens** | 语义别名 | 面向具体组件与场景的稳定命名，例如 `surface-raised`、`action-primary`。 |

## 3. 核心 Token 规格 (Core Tokens)

### 3.1 形状与边框 (Shape and Radius)

- **容器默认圆角**: `6px`
- **小型控件圆角**: `2px`
- **边框命名**: 统一使用语义 token，例如 `boundary-faint`、`boundary-strong`，避免写成组件私有颜色值。

### 3.2 颜色系统 (OKLCH-based Color System)

`oklch()` 已在 CSS Color 4 中标准化，适合用作工程级主题色空间。Codex 的要求如下:

- **Primary space**: 主色、状态色和表面色均允许以 `oklch(L C H)` 表达。
- **感知一致性**: 不同色相在相近 `L` 值下更容易保持接近的视觉权重。
- **对比度必须验证**: 不能因为使用了 OKLCH 就假设天然满足可读性，仍需按 WCAG 2.2 校验文本、图形与焦点指示。
- **State-aware tones**: `hover` / `active` 允许通过 `L` 与 `C` 的受控偏移生成，但这些偏移量属于产品约定，不是规范条文。

### 3.3 间距比例尺 (Spacing Scale)

Codex 默认使用 4px 步进系统:

| Token | Value | Usage |
| :--- | :--- | :--- |
| `--space-2` | 8px | 图标与文本、紧凑内部间距 |
| `--space-3` | 12px | 紧凑列表与小型容器 |
| `--space-4` | 16px | 默认内边距 |
| `--space-6` | 24px | 区域间距 |
| `--space-10` | 40px | 页面级留白 |

### 3.4 排版系统 (Typography)

| Level | Size | Weight | Line Height | Letter Spacing |
| :--- | :--- | :--- | :--- | :--- |
| `H1 (Page Title)` | 1.82rem | 700 | 1.2 | -0.04em |
| `H2 (Section)` | 1.12rem | 600 | 1.4 | -0.01em |
| `Body (Default)` | 0.94rem | 400 | 1.55 | Normal |
| `Code (Mono)` | 0.86rem | 500 | 1.5 | -0.02em |
| `Meta (Faint)` | 0.76rem | 600 | 1.4 | 0.08em (Uppercase) |

## 4. 颜色与表面系统 (Color and Surface System)

### 表面层级 (Layered Workbench)

使用 OKLCH 的 `L` 步进表达层级关系:

| Layer | Intent | Light Mode (L) | Dark Mode (L) |
| :--- | :--- | :--- | :--- |
| **Floor** | 底座背景 | `0.98` | `0.12` |
| **Base** | 侧边栏 / 主面板 | `0.96` | `0.17` |
| **Raised** | 卡片 / 编辑器容器 | `1.00` | `0.22` |
| **Overlay** | 菜单 / 弹层 | `1.00` | `0.28` |

### 语义化 Token

- **Primary (Accent)**: `oklch(0.60 0.18 250)`
- **Success**: `oklch(0.62 0.17 145)`
- **Warning**: `oklch(0.62 0.17 75)`
- **Danger**: `oklch(0.62 0.17 25)`

## 5. 暗色模式适配逻辑

- **Elevation as lightness**: 暗色模式中，越高层的表面通常越亮，以维持层级差异。
- **Chroma control**: 深色背景上的强调色可适度降低 `C`，防止视觉溢出。
- **Contrast stretching**: 深色表面之间通常需要更明显的亮度差，才能在真实屏幕和环境光下保持可分辨性。

## 6. 无障碍与合规边界 (Accessibility and Compliance)

- **当前合规基线是 WCAG 2.2 AA**。
- **APCA / WCAG 3 只能作为探索性诊断输入**: WCAG 3 仍处于 Working Draft，不应写成当前已生效的合规标准。
- **Focus indicators**: 所有关键交互组件必须有高对比度焦点指示，且不能与 hover / selected 状态混淆。

## 7. 规范依据 (Authority)

- [CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG 3.0 Working Draft](https://www.w3.org/TR/wcag-3.0/)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
