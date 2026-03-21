# 动画系统 (Functional Motion & Transitions)

## 1. 运动核心原则 (Core Principles)
- **非装饰性**: 动画必须引导视觉路径或缓解感知延迟。
- **物理性 (Physics-based)**: 符合重力和惯性直觉。避免生硬的线性运动。
- **一致性**: 同类组件的动作轨迹必须统一。

## 2. 运动原子 (Motion Tokens)

### 持续时间 (Durations)
| Token | Value | Scenario |
| :--- | :--- | :--- |
| `duration-fast` | 150ms | 按钮 Hover, Checkbox 状态切换 |
| `duration-base` | 240ms | 下拉菜单展示, 侧边栏折叠 |
| `duration-slow` | 400ms | 模态框切入, 页面大面积布局变更 |

### 缓动曲线 (Easing Curves)
| Token | Cubic Bezier | Effect |
| :--- | :--- | :--- |
| `ease-standard` | `(0.4, 0, 0.2, 1)` | 默认平滑（加速进入，减速停止） |
| `ease-entrance` | `(0, 0, 0.2, 1)` | 快速进入（从外向内） |
| `ease-exit` | `(0.4, 0, 1, 1)` | 离场（从内向外） |

## 3. 动画编排 (Choreography)
- **交错出现 (Staggering)**: 列表项应以 40ms 的间隔逐个滑入。
- **关联动画**: 如果父级容器变大，子级元素的出现应在父级完成 60% 后开始。

## 4. 典型动画模式 (Motion Patterns)

### 面板过渡 (Slide & Fade)
- **进入方向**: 与操作意图一致。向右导航应从右侧滑入。
- **位移偏量**: 推荐 `12px - 20px`。过大显得笨重，过小不明显。

### 呼吸效果 (Pulse & Breath)
- **关键帧**:
  - `0%`: 背景色 `opacity: 0.1`
  - `50%`: 背景色 `opacity: 0.25`
  - `100%`: 背景色 `opacity: 0.1`

### Sheen (扫光加载)
- **应用场景**: Skeleton 屏。
- **参数**: 线性渐变从左往右无限循环，持续时间 1.2s。

## 5. 性能与减弱动效 (Performance & Accessibility)
- **`will-change`**: 仅对大尺寸、高频变换（如 Transform）应用，避免内存溢出。
- **`prefers-reduced-motion`**: 监测系统设置，若用户开启“减少动效”，则立即禁用所有 Transform 和 Slide，仅保留 Fade 过渡。
