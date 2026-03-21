# 移动化适配与响应式策略 (Adaptive & Responsive Strategy)

## 1. 响应式分级 (Breakpoints Scale)
基于典型的设备屏幕尺寸定义。
| Level | Range | Layout Logic |
| :--- | :--- | :--- |
| `Mobile` | `< 640px` | 单列流式，所有 Pane 变为 Stack 垂直排列。 |
| `Tablet` | `640px - 1024px` | 双栏或折叠 Rail，面板侧向滚动。 |
| `Desktop` | `> 1024px` | 完整 Workbench，多 Pane 并行排列。 |

## 2. 容器查询优先 (Container Queries)
- **原则**: 优先使用 `@container` 而非 `@media`。
- **场景**: 当面板 A 在左侧 300px 时，它内部的组件应展示“紧凑态”。当它被扩展至 800px 时，组件应自动展现“详情态”。

## 3. 触摸体验优化 (Touch UX Specs)

### 触控规格 (Targeting)
- **最小点击尺寸**: `44px * 44px` (Apple Human Interface 指导)。
- **安全间距**: 点击项之间至少保留 `8px` 间距。

### 交互转换策略 (Platform Mapping)
- **Hover 转点击**: 原本通过 Hover 显示的操作（如：删除图标），在移动端应始终显示或转为长按操作。
- **浮窗转页签**: 在 Desktop 上是浮窗的组件，在 Mobile 上应全屏显示并带有关闭按钮。

## 4. 移动端典型组件重塑模式 (Adaptive Patterns)

### 列表 -> 详情 (List to Detail)
- **Desktop**: 左右两栏同步展示。
- **Mobile**: 经典的层级导航模式（点击列表项，覆盖主屏幕显示详情，带返回按钮）。

### 卡片布局 (Grid to Stack)
- **Desktop**: `repeat(auto-fill, minmax(280px, 1fr))`。
- **Mobile**: 强制 `grid-template-columns: 1fr`。

## 5. 性能与手势 (Gestures & Performance)
- **动效优先级**: 移动端优先使用 `Opacity` 和 `Transform` 动画，避免引起布局重排（Reflow）。
- **侧滑删除**: 移动端列表建议支持原生手势，通过 `translateX` + 透明度变化实现。
