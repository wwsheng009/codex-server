# 移动化适配与响应式策略 (Adaptive and Responsive Strategy)

本页把 **Web 规范**、**Apple** 与 **Android** 的官方指导拆开使用:

- 组件级响应式优先参考 Web 平台规范。
- 触控目标与移动交互优先参考平台官方建议。
- 具体 breakpoints、动效预算和导航重排方式属于 Codex 产品约定。

## 1. 响应式分级 (Breakpoints Scale)

以下断点是 Codex 的默认布局分级，不是行业统一标准:

| Level | Range | Layout Logic |
| :--- | :--- | :--- |
| `Mobile` | `< 640px` | 单列流式，Pane 转为垂直堆叠。 |
| `Tablet` | `640px - 1024px` | 双栏或折叠 Rail。 |
| `Desktop` | `> 1024px` | 完整 Workbench，多 Pane 并行。 |

## 2. 容器查询优先 (Container Queries)

- **原则**: 当组件行为依赖容器宽度而不是视口宽度时，优先使用 `@container`。
- **场景**: 相同组件在 `300px` 宽的侧栏里呈现紧凑态，在 `800px` 主区域里呈现详情态。
- **边界**: 页面级布局仍可配合 `@media`；组件级适配优先用容器查询。

## 3. 触摸体验优化 (Touch UX Specs)

### 3.1 触控规格 (Targeting)

- **Apple 建议**: 触控目标通常应至少有约 `44pt x 44pt` 的可点击区域。
- **Android 建议**: 触控目标通常应至少有约 `48dp x 48dp` 的可点击区域。
- **WCAG 2.2 基线**: Web 至少满足 `Target Size (Minimum)` 的要求。
- **Codex 默认**: 对主要触控操作，优先按接近 `44 CSS px` 的命中区域设计；对高密度内联操作，必须通过额外间距、替代入口或聚合动作补偿。

### 3.2 交互转换策略 (Platform Mapping)

- **不要把 hover 当作唯一入口**: 移动端必须为 hover 才可见的说明或操作提供 tap、focus 或显式按钮替代。
- **浮窗转全屏或底部 sheet**: Desktop 上的 popover / drawer，在窄屏上通常需要转为全屏页、sheet 或显式路由。
- **手势只是补充，不是唯一通道**: 侧滑、长按、拖拽都应有可发现的替代操作。

## 4. 移动端典型组件重塑模式 (Adaptive Patterns)

### 4.1 导航重排 (Navigation Remapping)

- **Desktop / Tablet**: 侧边 Rail 展示完整工作台导航。
- **Mobile**: 只保留最核心的顶级入口；底部导航建议控制在 `3-5` 个主目的地，其余入口通过更多菜单或上下文操作进入。
- **说明**: 这是平台实践和可达性折中后的产品约定，不是强制行业标准。

### 4.2 列表到详情 (List to Detail)

- **Desktop**: 支持列表与详情并排。
- **Mobile**: 优先使用层级导航或全屏详情，确保返回路径清晰且手指可达。

## 5. 手势与性能 (Gestures and Performance)

### 5.1 侧滑操作 (Swipe Actions)

- **可逆优先**: 侧滑更适合归档、标记等可恢复操作。
- **破坏性动作要谨慎**: 若允许长距离滑动直接删除，必须提供撤销或二次确认。
- **Haptic 只做补充**: 触感反馈不能成为唯一状态信号。

### 5.2 性能优化

- **动效属性**: 优先使用 `opacity` 和 `transform`。
- **时长预算**: `200ms-300ms` 是 Codex 的移动端默认目标，不是外部标准。
- **减弱动效**: 系统开启 reduced motion 时，移动端同样必须降级动画。

## 6. 规范依据 (Authority)

- [CSS Containment Module Level 3](https://www.w3.org/TR/css-contain-3/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Apple UI Design Dos and Don'ts](https://developer.apple.com/design/tips/)
- [Android Developers: Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
