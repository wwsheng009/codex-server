# Thread 渲染架构完整重构方案

日期：2026-04-18

关联文档：

- `docs/workspace/thread/thread-rendering-architecture-analysis-2026-04-18.md`

## 1. 目标与结论

本次重构不是继续在现有链路上“补丁式修延迟”，而是把 thread 主消息面板收敛到一个真正稳定的架构：

1. realtime 事件一旦到达前端，必须先进入单一 projection truth。
2. 主消息面板只依赖这份 projection truth，不再由 snapshot、event buffer、display merge、override 共同决定“消息是否存在”。
3. snapshot 的职责降级为 hydration、recovery、history backfill，不再在 open stream 期间反复抢写主 truth。
4. renderer 必须 placeholder-first，不能因为字段暂不完整就把 realtime item 从时间线中抹掉。
5. viewport、virtualization、动画只能影响体验，不能影响消息是否进入主时间线。

一句话概括目标架构：

`Event Stream -> Monotonic Thread Projection -> Pure Timeline Selectors -> Renderer/View`

而不是当前的：

`Event Stream + Snapshot Query + Override + Display Merge + Renderer Suppression + Virtualization Freeze -> 最终是否可见`

## 2. 当前架构为什么脆弱

当前系统脆弱点不在单一模块，而在于“多层都拥有部分决定权”：

1. `useWorkspaceStream.ts` 对 delta 做 batch，对非 delta 做 deferred flush，事件进入 store 已经不是即时。
2. `useThreadPageRefreshEffects.ts` 在 open stream 期间仍会因为部分 live 事件触发 `thread-detail` invalidate/reconcile。
3. `buildThreadPageTurnDisplayState.ts` 仍会在 display 阶段应用 full-turn/full-item override。
4. `renderers.tsx` 会 suppress 不完整 item，并对部分完成消息执行本地 `animate-once`。
5. `useVirtualizedConversationEntries.ts` 与 `useThreadViewportAutoScroll.ts` 会冻结布局、延迟滚动跟随。

这几个机制单独看都“有理由”，叠加后就会出现下面的问题：

1. 数据已经到前端，但未立刻进入 store。
2. 数据已经进 store，但被 snapshot reconcile 改写。
3. 数据已经在 projection 里，但被 override 或 display merge 换掉。
4. 数据已经在 displayed turns 里，但被 renderer suppress。
5. 数据已经在 DOM 中，但视口跟随或虚拟化冻结让用户看起来像没渲染。

这正是当前 thread 页面不稳定的根因。

## 3. 正确目标架构

### 3.1 分层模型

正确架构必须拆成四层，且每层职责单一：

#### A. Ingestion Layer

职责：

1. 接收 SSE/WebSocket `ServerEvent`
2. 做最小必要的传输层批处理
3. 尽快写入 projection reducer

要求：

1. 不能在这一层决定 UI 可见性
2. 不能依赖后续 snapshot 才让消息成立
3. batching 只能服务性能，不能改变语义

#### B. Projection Layer

职责：

1. 维护每个 thread 的 `ThreadProjection`
2. 以 seq / ts / turn order / item order 为基础做单调更新
3. 保存当前 thread 可见真相

要求：

1. 所有 live 事件都先作用到 projection
2. projection 只前进，不回退
3. snapshot 只能补充 projection 缺失字段，不能覆盖更“新”的 live 内容

#### C. Selector Layer

职责：

1. 从 projection 派生出 timeline entries、pending indicators、token usage、scroll signature 等 UI 所需结构
2. 把“视图需要的拼装”放在 selector 中完成

要求：

1. selector 必须是纯函数
2. selector 不能重建 truth
3. selector 不能删除 projection 中已存在的 live item

#### D. View Layer

职责：

1. 渲染 timeline
2. 处理滚动跟随、虚拟化、动画、展开态

要求：

1. view 不参与 truth 决策
2. placeholder-first
3. virtualization 只能裁剪 DOM，不得让 bottom live region 丢失

### 3.2 单一真相的数据模型

建议引入明确的 projection 状态边界：

```ts
type ThreadProjection = {
  threadId: string
  workspaceId: string
  updatedAt: string
  lastAppliedSeq: number | null
  completeness: 'live-partial' | 'live-full-window' | 'snapshot-summary' | 'snapshot-full'
  turns: ProjectedTurn[]
  turnIndexById: Record<string, number>
  pendingTurnId: string | null
  liveWindow: {
    startTurnId: string | null
    endTurnId: string | null
  }
  snapshotBase?: {
    updatedAt: string | null
    contentMode: 'summary' | 'full' | null
    turnLimit: number | null
  }
}
```

这里最关键的不是字段名，而是三个约束：

1. projection 本身就是主面板真相。
2. projection 必须显式记录自己来自 live 还是 snapshot，以及完整度。
3. 任意后续层都只能读取 projection，不能再独立推翻 projection。

## 4. 架构不变量

下面这些不变量必须在重构完成后成立，否则说明仍然停留在补丁阶段。

### 4.1 Truth 不变量

1. 主消息面板只从 `ThreadProjection` 派生。
2. `thread-detail query` 不直接进入主渲染树。
3. `eventsByThread` 永远不是主重建源，只用于诊断、回放、辅助 feed。

### 4.2 Monotonic 不变量

1. item 文本长度不能因较旧 snapshot 变短。
2. 已出现的 turn/item 不能因 summary/full 切换而消失。
3. 已完成 item 不能因 fallback refresh 回退到“未开始”或“空内容”。

### 4.3 View 不变量

1. projection 中存在的 item，timeline 中必须有一条稳定 entry 或 placeholder。
2. suppress 只能用于明确非法数据，不能用于“实时字段尚未补齐”。
3. pinned-to-latest 状态下，live region 不允许因 virtualization freeze 而不可见。

### 4.4 Snapshot 不变量

1. snapshot 只能在以下几类场景写入 projection：
   - 首次 hydration
   - 断流恢复
   - older history backfill
   - 命令执行、文件变更等 live 事件确实无法表达的补字段
2. open stream 期间，delta 类消息不触发频繁 thread-detail 抢写。

## 5. 目标模块职责

### 5.1 `useWorkspaceStream.ts`

保留职责：

1. 收事件
2. 最小必要 batching
3. 立即写 store

需要去掉的隐式职责：

1. 通过 flush 时机决定用户感知到的可见时间
2. 让非 delta 事件因为已有队列而额外等待一帧

目标：

1. 允许对高频 delta 做微批处理
2. 但批处理后必须一次性同步进入 projection reducer
3. 不允许再出现“事件在浏览器里，但主 timeline 还未有对应 placeholder”的状态

### 5.2 `session-store.ts` / `threadLiveState.ts`

目标：

1. store 中的 `liveThreadDetailsByThread` 演进为明确的 `threadProjectionsById`
2. projection reducer 成为唯一的 thread truth writer
3. 所有事件先进入 projection reducer，再由 selector 层派生渲染状态

需要调整：

1. 当前仅对 selected thread 建投影的限制要放宽为：
   - selected thread 必建
   - route target / preselected target 必建
   - 最近活跃且可能即将切换到的 thread 可按预算预建
2. snapshot reconcile 必须显式比较“内容新旧”和“完整度”，不能仅按 `updatedAt` 盲合并

### 5.3 `useThreadPageQueries.ts` / `useThreadPageRefreshEffects.ts`

目标：

1. query 只负责 baseline 与 recovery
2. open stream 期间不再以 delta 驱动 thread-detail 高频 invalidate

需要调整：

1. 将 `threadDetailRefreshMethods` 分成：
   - truth-irrelevant refresh
   - recovery-only refresh
   - terminal refresh
2. stream open 时只保留：
   - thread closed / compacted
   - reconnect recovery
   - command/fileChange 的必要补字段刷新
3. 删除 completed assistant message 的基于字符数的 refresh delay

### 5.4 `buildThreadPageTurnDisplayState.ts`

目标：

1. 从“状态合成器”改成“纯显示 selector”
2. 不再承担 truth merge

需要调整：

1. 历史 turns 只能 backfill older range，不能替换 live window
2. full-turn override 改为 view patch，不再 replace turn
3. pending turn display 只增加局部派生 UI，不修改 projection 真值

### 5.5 `renderers.tsx`

目标：

1. renderer 不删除实时 item
2. renderer 不人为拖慢 active thread 的已到达文本

需要调整：

1. active thread surface 禁用 `animate-once`
2. `conversationEntryOmissionReason` 改为 placeholder-first 策略
3. 对以下 item 提供稳定 placeholder：
   - agentMessage
   - commandExecution
   - fileChange
   - reasoning
   - plan / turnPlan

### 5.6 `useVirtualizedConversationEntries.ts` / `useThreadViewportAutoScroll.ts`

目标：

1. 视口系统只处理“怎么跟随”，不处理“有没有”
2. live region 永远优先于 layout 稳定性

需要调整：

1. pinned-to-latest 且 active streaming 时，底部 live region 不冻结高度提交
2. near-bottom 场景下保留真实 DOM 窗口，而不是保留过期虚拟 anchor
3. 用户交互锁只阻止自动滚动，不阻止新消息进入可见底部区域

## 6. 完整重构路径

本次重构建议按四个阶段推进，每一阶段都必须可独立验证、可回退。

### 阶段 0：观测与断言收紧

目标：

1. 先把现有脆弱点观测清楚
2. 在不改语义前提下补齐诊断

工作项：

1. 为 projection 写入、snapshot reconcile、override 命中、renderer suppress、viewport freeze 增加统一诊断事件
2. 为每条 live item 打通 `event-arrived -> projection-applied -> timeline-entry-visible` 的端到端链路时间
3. 为 active thread 增加“消息已在 projection 但未出现在 timeline”的硬告警

验收：

1. 能稳定定位延迟发生在 ingestion、projection、selector、renderer、viewport 哪一层

### 阶段 1：切断 snapshot 抢写主真相

目标：

1. open stream 时让 projection 成为真正唯一 truth

工作项：

1. 收缩 `threadDetailRefreshMethods`
2. 删除 delta 类事件对 `thread-detail` 的高频 invalidate
3. 仅保留 recovery/terminal refresh
4. 调整 snapshot reconcile 逻辑：
   - live 内容更长时永不回退
   - summary 不得覆盖 full/live item
   - snapshot 缺失 item 时保留 live trailing items

验收：

1. stream open 期间 thread-detail 请求量明显下降
2. profiler 中不再出现 live item 被 snapshot 回卷的现象

### 阶段 2：主面板只从 projection 派生

目标：

1. build/display/render 链路彻底不再依赖 snapshot 真值

工作项：

1. 把 `renderThreadDetail` 明确重命名或收敛为 `threadProjection`
2. `buildThreadPageTurnDisplayState` 仅接受 projection + older history + view patches
3. timeline feed 与主面板职责分离
4. 页面上任何“消息是否存在”的判断只读 projection

验收：

1. 切换 summary/full query 模式不再让主消息面板抖动
2. 主消息面板脱离 `selectedThreadEvents` 仍可稳定工作

### 阶段 3：移除 view 层对实时可见性的限制

目标：

1. 数据一旦进入 projection，就必须立刻得到时间线占位

工作项：

1. 禁用 active thread 的 `animate-once`
2. `conversationEntryOmissionReason` 调整为 placeholder-first
3. virtualization freeze 只用于离屏区域，不作用于底部 live region
4. auto-scroll 锁只影响滚动行为，不影响消息可见 DOM 扩展

验收：

1. 新消息到达后，timeline 在一帧内出现对应 placeholder 或完整内容
2. 不再有“消息实际上已存在，但用户需要等滚动或动画才能看到”

### 阶段 4：扩展投影覆盖面并清理过渡层

目标：

1. 从局部稳定走向整体稳定

工作项：

1. 将 projection 从“selected thread”扩展到“selected + route target + hot threads”
2. 清理已不再需要的事件回放路径
3. 将 full-turn override 改成纯 view patch 模型
4. 统一 timeline、feed、diagnostics 的投影来源

验收：

1. thread 切换时不会因 projection 初始化窗口导致明显补跳
2. 过渡逻辑删除后，系统行为仍稳定

## 7. 关键实现策略

### 7.1 Projection reducer 策略

建议显式引入 reducer 入口：

```ts
applyThreadProjectionEvent(projection, event)
reconcileThreadProjectionSnapshot(projection, snapshot, metadata)
deriveThreadTimelineState(projection, viewState)
```

要求：

1. event reducer 和 snapshot reconcile 必须分开
2. event reducer 只处理 live 事件语义
3. snapshot reconcile 只处理 hydration/recovery 语义

### 7.2 Override 改造策略

当前 full-turn override 的问题是“可替换数据 truth”。正确模型应改为：

```ts
type TimelineViewPatch = {
  turnId: string
  itemId?: string
  patchKind: 'expanded-content' | 'expanded-command-output' | 'temporary-highlight'
  expiresAt?: number
}
```

也就是说：

1. patch 只影响展示字段
2. patch 不替换 turn id / item id / item existence
3. patch 失效后只回落到 projection 展示，不会引起 live 数据抖动

### 7.3 Placeholder-first 策略

对任何仍未完整的数据，统一渲染为稳定占位：

1. `agentMessage` 无 text 但已 started：显示 streaming bubble placeholder
2. `commandExecution` 无 output：显示 command shell placeholder
3. `fileChange` 无 diff：显示 applying changes placeholder
4. `reasoning` 无 content：显示 reasoning in progress placeholder

只要 item 已在 projection 中，timeline 就必须留住该位置。

### 7.4 Virtualization 策略

虚拟化必须从“防抖优先”改成“live bottom correctness 优先”：

1. 底部 live region 保留真实 DOM 窗口
2. 上方历史区继续虚拟化
3. 活跃 thread pinned-to-latest 时，允许局部取消 freeze

建议分区：

1. `historicalWindow`
2. `liveWindow`

其中 `liveWindow` 可配置为非虚拟化或弱虚拟化。

## 8. 代码改造清单

### 8.1 第一批必须动的文件

1. `frontend/src/hooks/useWorkspaceStream.ts`
2. `frontend/src/stores/session-store.ts`
3. `frontend/src/pages/threadLiveState.ts`
4. `frontend/src/pages/thread-page/useThreadPageRefreshEffects.ts`
5. `frontend/src/pages/threadPageUtils.ts`
6. `frontend/src/pages/thread-page/buildThreadPageTurnDisplayState.ts`
7. `frontend/src/components/workspace/renderers.tsx`
8. `frontend/src/components/workspace/useVirtualizedConversationEntries.ts`
9. `frontend/src/pages/thread-page/useThreadViewportAutoScroll.ts`
10. `frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx`

### 8.2 第二批清理文件

1. `frontend/src/pages/thread-page/useThreadPageData.ts`
2. `frontend/src/pages/thread-page/useThreadPageSessionState.ts`
3. `frontend/src/pages/thread-page/useThreadPageControllerData.ts`
4. `frontend/src/pages/thread-page/useThreadPageControllerActions.ts`
5. `frontend/src/pages/thread-page/useThreadPageControllerEffects.ts`
6. timeline feed 相关 selector 和 diagnostics 入口

## 9. 风险与回退策略

### 9.1 主要风险

1. 切掉 query refresh 后，某些 command/fileChange 字段可能补不全
2. 去掉 suppress 后，timeline placeholder 数量会上升
3. 放宽 virtualization freeze 后，底部布局抖动可能暂时增大
4. 扩大 projection 覆盖面后，store 内存占用会上升

### 9.2 回退策略

每个阶段都必须挂在 feature flag 下：

1. `threadProjectionSingleTruth`
2. `threadProjectionRecoveryOnlySnapshot`
3. `threadTimelinePlaceholderFirst`
4. `threadTimelineLiveWindowUnfrozen`

回退原则：

1. 可以回退 view 行为
2. 不回退 projection truth 收敛方向
3. 一旦某阶段证明单一 truth 正确，不再重新引入“多源共同决定存在性”的逻辑

## 10. 测试与验证方案

### 10.1 单元测试

必须补齐以下测试：

1. event reducer 的 monotonic 断言
2. snapshot reconcile 不回退文本长度
3. live trailing items 不被 summary snapshot 删除
4. override 仅影响 view patch，不替换 existence
5. renderer 对不完整 item 产出 placeholder

### 10.2 集成测试

必须覆盖以下场景：

1. agent message delta 连续到达，timeline 实时增长
2. delta 期间插入 `thread-detail` refresh，主消息不回退
3. command execution outputDelta 持续更新，placeholder 平滑转完整内容
4. 用户停留在 bottom，消息持续到达时始终可见
5. 用户滚动离开 bottom，消息继续到达时 unread 状态正确但 timeline truth 不丢

### 10.3 性能指标

需要观测：

1. event-arrived 到 projection-applied 的 p50/p95
2. projection-applied 到 timeline-entry-visible 的 p50/p95
3. open stream 期间 `thread-detail` 请求数
4. active thread DOM 节点数与渲染帧耗时

## 11. 完成标准

只有同时满足下面标准，才算完成架构重构，而不是停留在补丁修复：

1. 主消息面板只从 projection 派生。
2. open stream 期间 snapshot 不再高频抢写主消息 truth。
3. live item 一旦进入 projection，timeline 必有 entry 或 placeholder。
4. override 不再决定 turn/item existence。
5. active thread 上不再存在本地动画导致的“数据已到但消息还没显示完全”。
6. pinned-to-latest 时，底部 live region 对用户持续可见。
7. thread 切换、summary/full 切换、fallback refresh 都不会让主消息面板回退。

## 12. 推荐执行顺序

如果按真实工程收益排序，建议如下：

1. 先做阶段 1：切断 snapshot 抢写。
2. 再做阶段 3 的前两项：禁用 `animate-once`，改 placeholder-first。
3. 然后做阶段 2：主面板只从 projection 派生。
4. 再做阶段 3 的 virtualization / viewport 收口。
5. 最后做阶段 4：扩展投影覆盖面并清理过渡层。

原因很简单：

1. 先去掉 truth 竞争，才能保证行为稳定。
2. 再去掉 view 层延迟，用户才会感知到“消息第一时间渲染”。
3. 最后再清理外围过渡层，风险最低。

## 13. 最终判断标准

未来如果再问“某条实时消息为什么没显示”，正确的排查路径应该只有两问：

1. 事件是否已进入 projection？
2. 如果已进入 projection，为什么 timeline 没有稳定 entry？

如果还需要继续问：

1. query 有没有刷新回来
2. full-turn override 有没有覆盖
3. display merge 有没有吃掉
4. 虚拟化是不是冻结了

那就说明架构还没有重构完成。
