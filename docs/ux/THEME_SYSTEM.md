# 主题系统 (Architectural Theme System)

## 1. 视觉隐喻：分层工作台 (The Layered Workbench)
Codex UI 基于“物理叠加”逻辑。每一层通过阴影（Box Shadow）和背景色深度（Luminance）来定义其功能：
- **Layer 0 (App Base)**: 底层画布，使用 `--surface-base`。
- **Layer 1 (Panels)**: 固定工作区，使用 `--surface-pane`。
- **Layer 2 (Cards)**: 内容容器，使用 `--surface-card`。
- **Layer 3 (Floating)**: 临时弹出项，使用 `--surface-overlay` + `var(--shadow-float)`。

## 2. 核心 Token 规格 (Core Tokens)

### 间距比例尺 (Spacing Scale)
严禁使用奇数像素，遵循 4px 步进系统：
| Token | Value | Usage |
| :--- | :--- | :--- |
| `--space-2` | 8px | 内部元素间距（如 Icon 与 Text） |
| `--space-3` | 12px | 紧凑排列（如 List Item） |
| `--space-4` | 16px | 默认内边距（Padding） |
| `--space-6` | 24px | 区域间距（Section Gap） |
| `--space-10` | 40px | 页面大边距 |

### 排版系统 (Typography)
| Level | Size | Weight | Line Height | Letter Spacing |
| :--- | :--- | :--- | :--- | :--- |
| `H1 (Page Title)` | 1.82rem | 700 | 1.2 | -0.04em |
| `H2 (Section)` | 1.12rem | 600 | 1.4 | -0.01em |
| `Body (Default)` | 0.94rem | 400 | 1.55 | Normal |
| `Code (Mono)` | 0.86rem | 500 | 1.5 | -0.02em |
| `Meta (Faint)` | 0.76rem | 600 | 1.4 | 0.08em (Uppercase) |

## 3. 颜色矩阵 (Color Matrix)
### 语义化映射
- **Primary (Accent)**: `#5271FF` (Brand focus)
- **Neutral**: 
  - `Strong`: `#FFFFFF` (High contrast)
  - `Secondary`: `#A1A1AA` (Muted info)
  - `Faint`: `#71717A` (Metadata)
- **Functional**:
  - `Success`: `#22C55E` (Ready/Active)
  - `Warning`: `#F59E0B` (Resource limit)
  - `Danger`: `#EF4444` (Error/Delete)

## 4. 暗色模式适配逻辑
暗色模式不应只是颜色的反转，而是“亮度层叠”的逆向平衡：
- 越往上层的元素，背景色应越亮（对比度补偿）。
- 阴影在暗色模式下应增加扩散（Spread）并降低不透明度。
