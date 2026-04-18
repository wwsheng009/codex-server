# Thread 渲染架构梳理与稳定性分析

日期：2026-04-18

## 目标

当前 thread 前端的最高优先级目标不是“尽量渲染”，而是：

1. 只要 realtime 事件已经到达前端，消息必须可见。
2. 页面不能因为快照刷新、事件批处理、窗口裁剪或局部重算而把已到达的消息重新丢掉。
3. 渲染必须既准确又及时。
4. 渲染真值必须单调递增，不能回退。

这份文档梳理当前 thread 页面从 websocket 到最终 UI 的完整链路，说明现有不稳定的根因，并给出目标架构和推荐改造顺序。

## 当前整体链路

### 1. realtime 进入前端

入口在 `frontend/src/hooks/useWorkspaceStream.ts`。

- websocket 收到 `ServerEvent`
- `handleWorkspaceStreamEvent(...)` 按事件类型做两类处理
- delta 类事件先进入 `eventQueue`
- 非 delta 事件可能触发先 flush delta，再延迟一帧处理
- flush 后调用 `useSessionStore.getState().ingestEvent(s)` 写入 store

这层的特点：

- 它已经不是“事件即刻逐条进入 React”，而是有批处理和 deferred flush。
- 这对性能有帮助，但会引入时序复杂度。

### 2. session store 聚合

核心在 `frontend/src/stores/session-store.ts`。

store 目前同时维护多份 thread 相关状态：

- `eventsByThread`
  近期 thread 事件缓冲
- `liveThreadDetailsByThread`
  当前 live 投影结果
- `threadActivityByThread`
  thread 活动摘要
- `workspaceEventsByWorkspace`
  workspace 级事件
- `activityEventsByWorkspace`
  workspace 活动事件
- `tokenUsageByThread`
  token usage

当前限制：

- 选中 thread 的事件缓冲上限是 `160`
- 非选中 thread 只保留 `4`
- 这说明 `eventsByThread` 本质上只是诊断/辅助数据，不适合作为最终渲染真值

### 3. thread 页面数据层

入口在 `frontend/src/pages/thread-page/useThreadPageData.ts`。

这一层会组合：

- `useThreadPageQueries(...)`
  拉 thread/detail、threads、loaded-threads、hook-runs 等
- `useThreadPageSessionState(...)`
  从 session store 取 live 状态
- `useThreadPageSelectedThread(...)`
  选中 thread 基础信息

### 4. thread 快照查询

核心在 `frontend/src/pages/thread-page/useThreadPageQueries.ts`。

当前 `thread-detail` 查询逻辑：

- 活跃 thread 在页面可见且有 pending turn / stream open / connecting 时，优先请求 `contentMode: 'full'`
- 其他相对静态场景使用 `contentMode: 'summary'`
- 仍然使用 `turnLimit`

对应后端在 `backend/internal/threads/service.go`：

- `GetDetailWindow(...)`
- `finalizeThreadDetailResponse(...)`
- `summarizeThreadDetailContent(...)`

这意味着前端拿到的 thread 快照可能是：

- 全量窗口快照
- 摘要窗口快照
- 被 turnLimit 裁剪后的窗口

### 5. 页面 session state

核心在 `frontend/src/pages/thread-page/useThreadPageSessionState.ts`。

当前实现已经做过一轮改造：

- 页面不再本地维护一份独立的 live projection reducer
- 而是直接读取 `session-store` 中的 `liveThreadDetailsByThread`
- 当 `thread-detail` query 返回时，通过 `syncThreadDetailProjection(threadDetail)` 把快照和当前 live 投影做 reconcile

这是当前架构中最关键的一步，因为它把“事件投影”从页面层下沉到了 store 层。

### 6. display state 组装

核心在：

- `frontend/src/pages/thread-page/useThreadPageDisplayState.ts`
- `frontend/src/pages/thread-page/buildThreadPageTurnDisplayState.ts`
- `frontend/src/pages/thread-page/buildThreadPageSelectionDisplayState.ts`

职责分为两部分：

- turn 渲染面：
  合并 `historicalTurns` 与 `liveThreadDetail.turns`
- 辅助选择面：
  token usage、timeline feed、approval、loaded 状态等

turn 渲染层当前仍然不是“原样输出 live projection”，还会继续做：

- merge 历史 turns
- pending turn 注入
- full-turn override / item override
- turn plan 状态补齐

因此它仍然属于“结果再加工层”，不是状态真值层。

## 当前架构的主要问题

### 1. 过去最致命的问题：把事件缓冲当成渲染真值

旧模型是：

- query 拿 summary snapshot
- 页面再拿 `selectedThreadEvents`
- 每次重算时把整个事件缓冲重新 replay 到 snapshot 上

这个模型的问题很严重：

- `eventsByThread` 只有最近 160 条
- 事件缓冲天生不是完整历史
- 一旦依赖它重建“当前页面真相”，就会出现：
  - 缓冲裁剪后内容永久丢失
  - seq 被误解释为“快照已覆盖”
  - summary snapshot 覆盖掉 live 局部内容

这正是此前 profiler 中大量 `baseline-filtered` 的根因。

### 2. 当前仍然存在的结构性风险：真值层还不够单一

虽然 live projection 已经下沉到 session store，但页面最终显示仍然受多层输入影响：

- `liveThreadDetailsByThread`
- `thread-detail` query
- `historicalTurns`
- `selectedThreadEvents`
- full-turn / item overrides
- pending turn

只要最终渲染输出由多份状态共同决定，系统就会继续有“部分真、部分假”的风险。

### 3. websocket flush 策略会改变事件可见时序

`useWorkspaceStream.ts` 中：

- delta 先入批队列
- 非 delta 可能触发 flush + deferred

这意味着事件到达浏览器时间，不等于事件进入 store 时间，也不等于事件进入最终 UI 时间。

这本身不是 bug，但如果下游层继续依赖“后续 query 修正”，就会放大时序问题。

### 4. query 快照仍然有窗口和模式差异

后端 `thread-detail` 存在：

- `turnLimit`
- `summary/full`
- command output summary truncation

所以快照天然不等于“最终完整 truth”。

如果前端把 query 返回当成更高优先级真值，而不是拿它做 base reconcile，就还会有回退风险。

### 5. display 层做了太多状态合成

`buildThreadPageTurnDisplayState.ts` 负责的不只是 UI 变换，还承担了：

- history/live 合并
- pending turn 注入
- override 替换
- status 修正

这会导致调试很难：

- 某条消息到底是没进入 store
- 还是进入 store 后被 query 覆盖
- 还是进入 display state 后被 merge/override 吃掉

排查成本非常高。

## 已经完成的改造

### 1. 增量 live projection

`frontend/src/pages/threadLiveState.ts`

- 引入增量 projection 状态
- 不再在页面层对整段缓冲做重复全量重算

### 2. live projection 下沉到 session store

`frontend/src/stores/session-store.ts`

- 新增 `liveThreadDetailsByThread`
- realtime 事件进入 store 时直接调用 `applyThreadEventToDetail(...)`
- query 返回的 `threadDetail` 通过 `reconcileLiveThreadDetailSnapshot(...)` 与现有投影对齐

这一步的意义：

- 一旦事件已进入 store，页面即使后续刷新，也不应丢掉这条消息

### 3. 活跃线程优先使用 full snapshot

`frontend/src/pages/thread-page/useThreadPageQueries.ts`

- stream 打开、连接中、或存在 pending turn 时，`thread-detail` 改为 `contentMode: 'full'`
- 降低 summary snapshot 对当前窗口实时内容的破坏性

## 现阶段仍未彻底解决的问题

### 1. store 中的 projection 仍然只对“被追踪 thread”建立

当前 `applyLiveThreadProjectionEvent(...)` 在没有已有 detail 且不是当前选中 thread 时不会建立 projection。

这对当前页面是合理的，但意味着：

- 选中 thread 切换前的事件仍主要保存在缓冲中
- 切换后如果只依赖 query 窗口，仍可能需要一次修正过程

### 2. display 层仍然会继续改写 turn 结果

即使 store projection 是真的，最后显示仍会经过：

- `mergeThreadTurnHistory(...)`
- `applyTurnAndItemOverrides(...)`
- `applyPendingTurnDisplay(...)`

所以“消息已进入 live projection”不等于“消息一定最终可见”。

### 3. feed / diagnostics 仍然依赖 `selectedThreadEvents`

`buildThreadPageSelectionDisplayState.ts` 中 timeline feed 仍使用：

- `workspaceEvents`
- `selectedThreadEvents`

这不是主消息面板，但仍会让开发阶段观察到“不同区域看到的 thread 状态不一致”。

### 4. query cache key 与无 turnLimit 的 invalidate 之间有轻微耦合风险

部分地方 invalidate `['thread-detail', workspaceId, selectedThreadId]`
而 query key 实际是：

- `['thread-detail', workspaceId, selectedThreadId, turnLimit, contentMode]`

TanStack Query 的前缀匹配通常可以覆盖，但这类隐式依赖容易让后续维护者误解。

## 根因总结

thread 前端不稳定，不是因为单个 renderer 漏处理，而是因为系统长期缺少单一真值层。

更准确地说，当前问题来自三个层面的叠加：

1. 事件输入层是异步批处理的
2. 快照层返回的是窗口化、模式化、可能被摘要裁剪的结果
3. 渲染层又继续把多份状态合成

只要这三个层面之间没有清晰的优先级和单调规则，就会出现：

- realtime 到了，但 UI 没显示
- 先显示了，又被快照覆盖掉
- 某次刷新后又恢复
- command output 部分出现、部分缺失

## 目标架构

### 原则 1：渲染真值只能有一个

thread 主消息面板最终应只消费一份状态：

- `renderThreadDetail`

它应该是一个 store 内的单调投影，不应由页面每次临时组装。

### 原则 2：query snapshot 只能做基底同步，不能推翻已到达的 realtime

规则必须明确：

- websocket 事件一旦进入前端并成功写入 projection
- 后续 query 只能补齐、对账、校正 metadata
- 不能让已可见内容回退为不可见

### 原则 3：事件缓冲只能用于诊断和 feed，不能用于“重建真相”

`eventsByThread` 应继续保留，但职责应严格限定为：

- profiler
- timeline feed
- 观察最近事件

不能再承担主渲染恢复职责。

### 原则 4：display 层只做视图变换，不做状态决定

display 层应该只负责：

- 排版
- 排序
- UI 辅助项注入

不应再承担“决定某条消息是否存在”的职责。

## 推荐目标分层

### A. 输入层

- websocket / stream batching
- query fetch

### B. 状态层

- `threadProjectionStore`
- 每个 thread 有一个单调 reducer state

这个 state 至少包含：

- 当前 turns
- token usage
- latest applied seq
- latest snapshot watermark
- completeness 标记
- projection source metadata

### C. 对账层

- 用 query snapshot 与 projection 做 reconcile
- 只允许补齐，禁止回退

### D. 视图层

- pending turn 注入
- override 展示
- virtualization / auto scroll

## 推荐后续改造顺序

### 阶段 1：继续收缩 display 层职责

目标：

- 让 `buildThreadPageTurnDisplayState(...)` 不再决定消息存在性

优先检查：

- `mergeThreadTurnHistory(...)`
- `applyTurnAndItemOverrides(...)`
- `applyPendingTurnDisplay(...)`

要明确区分：

- 真值数据
- UI 覆盖数据

### 阶段 2：为 projection 增加明确的 snapshot watermark

当前只有 `clientLiveEventSeq`，但它仍然偏向“事件游标”。

建议增加显式元数据，例如：

- `clientProjectionAppliedSeq`
- `clientSnapshotUpdatedAt`
- `clientSnapshotContentMode`
- `clientSnapshotTurnLimit`
- `clientProjectionCompleteness`

避免再把一个字段同时当事件游标和快照完整性证明。

### 阶段 3：把选中 thread 的 render 输入改成单一对象

建议在 controller/data 层产出统一对象，例如：

- `renderThreadState`

它应包含：

- `detail`
- `selectionMeta`
- `timelineMeta`
- `pendingMeta`

ThreadWorkbenchSurface 只接这个对象，不再直接拼多份来源。

### 阶段 4：把 feed 和主消息面板彻底解耦

当前 feed 仍依赖事件缓冲。

建议：

- feed 用事件流模型
- 主消息面板用投影模型

两者都可以展示，但不能再互相借用真值。

### 阶段 5：为“事件已到前端但未显示”建立强校验

建议新增开发期断言：

- 当 `stream-received` 命中某个 item
- 在合理时间窗口内主面板找不到对应 item
- profiler 直接记录为高优先级错误

这类断言比靠人工看日志更有效。

## 建议的稳定性验收标准

未来判断 thread 渲染是否稳定，不应只看“感觉上没卡住”，而要满足：

1. 任意 `item/agentMessage/delta` 到达后，最终消息文本长度只能增加，不能回退。
2. 任意 `item/commandExecution/outputDelta` 到达后，输出只能追加或被更完整窗口替换，不能消失。
3. 任意 `item/completed` 到达后，对应 item 不允许从 UI 中消失。
4. query refresh 前后，已存在 item 的可见性不能下降。
5. 切换 turn window、older turns、viewport 交互时，当前 thread 最新 turn 不丢。

## 当前建议

如果后续还要继续修这条线，优先级应该是：

1. 把主消息面板的最终输入收敛为单一 projection truth
2. 继续减少 display 层的状态合成职责
3. 给 projection 增加更明确的 watermarks / completeness metadata
4. 用 profiler 对“事件已到前端但未显示”做自动报警

不要再回到“靠多加 replay heuristic 修一个漏渲染”的方向。

那种方式只能缓解个别 item type，不能从架构上保证消息准确、及时、单调地渲染。
