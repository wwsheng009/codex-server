# 视觉反馈 (Visual Feedback & Interactivity)

## 1. 微交互逻辑 (Micro-interaction Logic)
交互反馈必须是瞬时的，通过属性变化传达状态。

| Interaction | Visual Change | Duration | Purpose |
| :--- | :--- | :--- | :--- |
| **Hover** | `brightness(1.1)` 或 `luminance +10%` | `duration-short` | 确认交互热区 (Affordance) |
| **Active** | `scale(0.98)` | `duration-short` | 确认操作意图 (Action Confirmation) |
| **Focus** | `outline-offset: 2px` + `ring` | `duration-short` | 导航上下文锁定 (Contextual Focus) |

## 2. 状态形变 (State Morphing)
图标与组件之间的状态转换应使用 **插值转换** 而非瞬间切换。
- **示例 (Icon Morphing)**: Hamburger 菜单到 Cross 关闭图标，应通过路径旋转与位移完成 200ms 的平滑过渡。
- **一致性**: 形变方向应与用户操作路径一致。

## 3. 响应时效性 (Acknowledgment Timing)
- **100ms 规则**: 系统对用户操作的初步反馈（Hover、Active 态）必须在 100ms 内发生，以满足感官上的“即时性”。
- **异步反馈**: 对于耗时 > 300ms 的操作，必须立即进入中间状态（Loading/Pending）。

## 4. 感知性能优化 (Perceived Performance)

### 骨架屏 (Skeleton Screens)
对于数据加载，优先使用 **Pulsing Skeleton Screens** 而非静态 Spinner。
- **动画参数**: 线性扫描（Sheen）从左至右，周期 1.5s - 2.0s。
- **视觉重心**: 骨架屏布局必须与真实渲染后的 DOM 结构保持 100% 对应。

### 加载指示器 (Loaders)
- **静态 Spinner**: 仅用于极小空间（按钮内部、输入框末端）。
- **线性进度条**: 用于页面顶部或跨模块的大型资源加载。

## 5. 校验反馈 (Validation Feedback)

### 动态错误状态 (Error States)
对于无效输入，使用 **微抖动 (Shake)** 模拟物理世界中的“拒绝”反馈。
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
```
- **触发逻辑**: 校验失败时触发一次 300ms 的抖动，并同步改变颜色或描边（Border Color: Error）。
- **非侵入性**: 错误提示应紧随输入框下方，且动态出现时伴随淡入或向下滑动的微动效。
