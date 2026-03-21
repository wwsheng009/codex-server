# 动画系统 (Motion System & Transitions)

## 1. 运动核心原则 (Core Principles)
- **非装饰性 (Non-Decorative)**: 动画必须引导视觉路径、传达层级关系或缓解感知延迟。
- **物理驱动 (Physics-Driven)**: 优先使用弹性动力学（Spring Physics）。避免机械线性运动，模拟具有质量（Mass）和张力的自然物理效果。
- **一致性 (Consistency)**: 全局共享时序与缓动原子，确保交互手感在不同模块间保持连贯。

## 2. 运动原子 (Motion Tokens)

### 持续时间量程 (Duration Scale)
| Token | Range | Usage |
| :--- | :--- | :--- |
| `duration-short` | 100ms - 200ms | 微交互、状态切换、悬停反馈 (Hover, Toggle) |
| `duration-medium` | 250ms - 350ms | 局部布局变更、列表展开、抽屉切入 (Drawer, Collapse) |
| `duration-long` | 400ms - 500ms | 页面级过渡、大型模态框进入 (Page Transitions, Modals) |

### 缓动曲线 (Easing Curves)
对于非弹性（CSS Transition）场景，使用标准三次贝塞尔曲线：
```css
/* Decelerate: 用于元素进入视野 (Enter) */
--ease-out: cubic-bezier(0, 0, 0.2, 1);

/* Accelerate: 用于元素离开视野 (Exit) */
--ease-in: cubic-bezier(0.4, 0, 1, 1);

/* Standard: 用于位置、大小的常规移动 (Move) */
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
```

### 弹性预设 (Spring Presets)
用于 "Fluid Interfaces" 的弹性物理参数（Stiffness/Damping）：
| Preset | Stiffness | Damping | Description |
| :--- | :--- | :--- | :--- |
| `spring-snappy` | 400 | 28 | 极速响应，几乎无回弹（Toast, Popover） |
| `spring-bouncy` | 300 | 18 | 明显的物理弹性（Button Click, Icon Morphing） |
| `spring-gentle` | 120 | 14 | 柔和过渡（Background Fade, Large Surface Move） |

## 3. 动画编排 (Choreography)
- **交错出现 (Staggering)**: 列表项应以 30ms-50ms 的间隔逐个出现，减少视觉冲击。
- **关联动画 (Parent-Child)**: 子级动画应在父级容器完成 60% 变换后启动。

## 4. 辅助功能与性能 (Accessibility & Performance)
- **`prefers-reduced-motion`**: 必须监听系统减弱动效设置。
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
- **GPU 加速**: 仅对 `transform` 和 `opacity` 进行高频动画处理，避免引发 Layout/Paint 重绘。

## 5. 典型模式 (Patterns)
- **反馈 (Feedback)**: 按钮点击应伴随 `scale(0.98)` 的瞬时压缩。
- **引导 (Guiding)**: 新生成元素应从操作触点位置向外扩散弹出。
