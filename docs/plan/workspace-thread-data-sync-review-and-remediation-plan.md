# Workspace / Thread 页面数据同步与渲染逻辑审查报告及实施方案

- 项目：`E:\projects\ai\codex-server`
- 报告日期：2026-05-11
- 范围：`workspace / thread` 页面组件、实时事件流、前端 session store、React Query 缓存、thread live projection、终端面板、approvals、侧边栏线程状态
- 目标：排查前后端数据传输及时性与准确性、用户输入与后端事件能否及时渲染、复杂组件潜在同步与渲染问题，并给出可落地实施方案。

---

## 1. 审查结论概览

当前 `workspace / thread` 页面已经形成较完整的数据架构：

```txt
HTTP 快照 / React Query
  + WebSocket workspace stream
  + Zustand session-store live projection
  + threadLiveState 增量投影
  + ThreadWorkbenchSurface / TurnTimeline 渲染
```

整体方向合理，但存在若干会影响“实时性”和“准确性”的关键风险：

1. **高风险：WebSocket 事件 seq 只做去重，不检测 gap。** 结合后端 subscriber backpressure drop、command output coalesce、workspace replay limit 和 event retention，前端可能漏事件且之后无法自愈。
2. **高风险：后端支持并可能发送 `turn/failed` / `turn/interrupted` / `turn/canceled` / `turn/cancelled`，但前端 live projection、activity status、refresh trigger 未完整覆盖。** 失败或中断后的 turn 可能继续显示为进行中。
3. **高风险：多个 thread live store 只用 `threadId` 做 key，没有加入 `workspaceId`。** 如果不同 workspace 出现同名 thread id，可能串数据。
4. **中风险：Live Feed 面板派生状态 memo 依赖遗漏 `surfacePanelView`。** 切换到 feed 面板时，已有实时事件可能不显示。
5. **中风险：终端 xterm 视图在 content 变为空字符串时不 reset。** 后端发送空 replace replay 后，UI 可能继续显示旧输出。
6. **中风险：发送消息的 optimistic pending turn 缺少 client request id。** HTTP 与 WebSocket race 或 HTTP 失败但后端已接受时，可能出现重复消息、错误提示与真实状态不一致。
7. **中低风险：非 active workspace 的侧边栏线程状态不一定实时。** 当前只有当前 workspace 和通知中心判定的 live workspace 会订阅 stream。
8. **低风险：`deferredEvents` 机制残留但没有实际入队逻辑。** 容易造成维护误判。
9. **产品行为确认：线程列表固定按 `created_at` 排序。** 如果产品期望最近活跃线程上浮，应改为 `updated_at` 或明确当前稳定排序行为。

本次没有修改前端代码，仅生成审查报告与实施方案。已执行辅助验证：

```powershell
cd E:\projects\ai\codex-server\frontend
npm run i18n:check
npm test -- useWorkspaceStream.test.ts session-store.test.ts threadLiveState.test.ts sync.test.ts ThreadTerminalViewport.test.tsx
```

结果：

- `npm run i18n:check`：通过，问题数量 0。
- 相关前端单测：5 个测试文件、69 个测试用例全部通过。

---

## 2. 已审查的核心链路

### 2.1 Thread 页面入口与状态聚合

关键文件：

- `frontend/src/pages/ThreadPage.tsx`
- `frontend/src/pages/thread-page/useThreadPageController.ts`
- `frontend/src/pages/thread-page/useThreadPageControllerState.ts`
- `frontend/src/pages/thread-page/useThreadPageControllerRuntimeState.ts`
- `frontend/src/pages/thread-page/useThreadPageControllerData.ts`
- `frontend/src/pages/thread-page/useThreadPageControllerEffects.ts`

当前页面结构：

```txt
ThreadPage
  -> useThreadPageController()
    -> useThreadPageControllerState()
       -> useWorkspaceStream(workspaceId)
       -> local state / Zustand store state / runtime state
    -> useThreadPageControllerData()
       -> React Query HTTP 快照
       -> Zustand session live state
       -> display derived state
    -> useThreadPageControllerActions()
    -> useThreadPageControllerEffects()
  -> ThreadPageLayout
     -> ThreadWorkbenchSurface
     -> ThreadComposerDock
     -> ThreadTerminalDock
     -> ThreadWorkbenchRail
```

### 2.2 WebSocket 实时流

前端关键文件：

- `frontend/src/hooks/useWorkspaceStream.ts`

主要行为：

- 当前 workspace 通过 `useWorkspaceStream(workspaceId)` 建立 WebSocket。
- delta 类事件进入 `eventQueue`，约 16ms batch flush。
- 非 delta 事件到达时会先 flush queued delta，再立即 ingest。
- reconnect 时使用 `lastEventSeqByWorkspace[workspaceId]` 作为 `afterSeq`。
- 跨 tab 使用 BroadcastChannel 选 leader，降低重复连接。

后端关键文件：

- `backend/internal/api/router.go`
  - `handleWorkspaceStream`
- `backend/internal/events/hub.go`
  - `Publish`
  - `SubscribeWithSource`
  - `Replay`
- `backend/internal/store/memory.go`
  - `AppendWorkspaceEvent`
  - `ListWorkspaceEventsAfter`

后端 stream 初始化顺序：

```txt
SubscribeWithSource
  -> workspace/connected
  -> command/exec/stateSnapshot
  -> command resume events
  -> approvals/snapshot
  -> Replay(afterSeq, workspaceReplayLimit=2000)
  -> live events loop
```

### 2.3 前端 session live state

关键文件：

- `frontend/src/stores/session-store.ts`
- `frontend/src/pages/threadLiveState.ts`
- `frontend/src/pages/thread-page/useThreadPageSessionState.ts`

事件进入后更新：

- `lastEventSeqByWorkspace`
- `eventsByThread`
- `threadProjectionsById`
- `threadActivityByThread`
- `tokenUsageByThread`
- `commandSessionsByWorkspace`
- `workspaceEventsByWorkspace`
- `activityEventsByWorkspace`

### 2.4 渲染层

关键文件：

- `frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx`
- `frontend/src/components/workspace/renderers.tsx`
- `frontend/src/components/thread/ThreadContent.tsx`

核心渲染结构：

```txt
ThreadWorkbenchSurface
  -> TurnTimeline
     -> buildConversationEntries(turns)
     -> useVirtualizedConversationEntries(...)
     -> MemoTimelineItem
        -> TimelineItem
           -> ThreadMarkdown / ThreadCodeBlock / ThreadTerminalBlock
```

### 2.5 Approvals 同步

关键文件：

- `frontend/src/app/providers.tsx`
- `frontend/src/features/approvals/WorkspaceApprovalsQuerySync.tsx`
- `frontend/src/features/approvals/sync.ts`
- `frontend/src/features/approvals/cache.ts`
- `frontend/src/pages/thread-page/useThreadPageQueries.ts`

已确认：

- `WorkspaceApprovalsQuerySync` 已挂载在 Provider 层。
- `approvals/snapshot` 会通过 `applyApprovalEventToCache` 进入 React Query cache。
- approval request/resolution event 也会尝试直接更新 cache，否则 debounce invalidate。

因此 approvals snapshot 并不是完全漏接，但仍有“只处理 latest event”的维护风险，详见后文。

---

## 3. 高风险问题与修复方案

---

## 3.1 高风险：WebSocket seq 只去重，不检测 gap，漏事件后可能无法自愈

### 相关文件

前端：

- `frontend/src/stores/session-store.ts`
  - `applySessionEvents`
  - `lastEventSeqByWorkspace`
- `frontend/src/hooks/useWorkspaceStream.ts`
  - `buildWorkspaceStreamPath`
  - `afterSeq`

后端：

- `backend/internal/events/hub.go`
  - `subscriber.enqueue`
  - `isDroppableEvent`
  - `Replay`
- `backend/internal/store/memory.go`
  - `workspaceEventRetentionLimit = 2000`
  - `ListWorkspaceEventsAfter`
- `backend/internal/api/router.go`
  - `workspaceReplayLimit = 2000`

### 当前逻辑

前端仅做重复过滤：

```ts
if (typeof event.seq === 'number' && Number.isFinite(event.seq)) {
  const currentLastSeq = nextLastEventSeqByWorkspace[event.workspaceId] ?? 0
  if (event.seq <= currentLastSeq) {
    continue
  }

  nextLastEventSeqByWorkspace[event.workspaceId] = event.seq
}
```

这无法判断：

```txt
lastSeq = 100
收到 seq = 105
```

中间 `101 ~ 104` 是否缺失。

后端会 drop droppable events：

- method 以 `Delta` 结尾；
- method 以 `/delta` 结尾；
- `command/exec/outputDelta`；
- `thread/tokenUsage/updated`。

后端 replay 也存在上限：

```go
const workspaceReplayLimit = 2000
```

memory store retention 也只有：

```go
workspaceEventRetentionLimit = 2000
```

### 触发场景

#### 场景 A：subscriber backpressure 丢 delta

```txt
前端 lastSeq = 100
后端产生：
101 item/agentMessage/delta
102 item/agentMessage/delta
103 item/agentMessage/delta
104 item/agentMessage/delta
105 item/completed
```

如果 101~104 被 subscriber drop，前端只收到 105：

```txt
lastSeq 直接更新到 105
下次 reconnect afterSeq=105
101~104 永远不会 replay
```

#### 场景 B：离线后待 replay 事件超过 2000

```txt
afterSeq = 100
后端已有 101~3100
replay 只发 101~2100
live 继续发 3101
```

前端可能从 2100 直接跳到 3101，`2101~3100` 永久缺失。

#### 场景 C：localStorage 中 lastSeq 超出后端 retention 范围

`lastEventSeqByWorkspace` 会持久化到 localStorage，但后端只保留最近 2000 条 workspace events。如果用户很久未打开页面，前端 afterSeq 可能过旧，而后端无法完整 replay，且当前协议不会告知 replay 不完整。

### 用户可见影响

- agent 消息缺字、缺段；
- reasoning / plan / file diff 不完整；
- terminal 输出缺行；
- token usage 不准；
- live feed 丢事件；
- thread 状态停留在旧状态；
- reconnect 后 UI 看似正常但实际投影缺失；
- 需要手动刷新页面才能恢复。

### 修复方案

#### 方案目标

构建“事件连续性协议”，避免前端把非连续 seq 直接当作可 resume 的 afterSeq。

#### 前端改造建议

1. 将当前单一 `lastEventSeqByWorkspace` 拆成：

```ts
type WorkspaceSeqState = {
  contiguousAppliedSeq: number
  highestSeenSeq: number
  recoveryNeeded: boolean
  missingRanges: Array<{ fromSeq: number; toSeq: number }>
}
```

2. 应用 event 时：

```ts
if (event.seq === contiguousAppliedSeq + 1) {
  contiguousAppliedSeq = event.seq
} else if (event.seq <= contiguousAppliedSeq) {
  // duplicate/replay，忽略
} else {
  // gap
  highestSeenSeq = Math.max(highestSeenSeq, event.seq)
  recoveryNeeded = true
  missingRanges.push({ fromSeq: contiguousAppliedSeq + 1, toSeq: event.seq - 1 })
  // 不要把 contiguousAppliedSeq 直接推进到 event.seq
}
```

3. reconnect `afterSeq` 应使用 `contiguousAppliedSeq`，不是 `highestSeenSeq`。

4. 检测 gap 后：

- 标记 workspace stream degraded；
- 主动重连或调用 replay endpoint；
- 补齐 replay 前避免覆盖关键 projection；
- 如果无法补齐，触发 thread detail / command session / approvals snapshot fallback。

#### 后端改造建议

1. `workspace/connected` payload 增加：

```json
{
  "status": "connected",
  "headSeq": 3100,
  "oldestSeq": 1101,
  "replayLimit": 2000
}
```

2. replay 结束后发送：

```json
{
  "method": "workspace/replay/completed",
  "payload": {
    "fromSeq": 100,
    "toSeq": 2100,
    "headSeq": 3100,
    "complete": false,
    "nextAfterSeq": 2100
  }
}
```

3. 支持分页 replay：

```http
GET /api/workspaces/{workspaceId}/events?afterSeq=2100&limit=2000
```

或通过 WebSocket query / control message 继续 replay。

4. backpressure drop 时发送不可丢弃事件：

```json
{
  "method": "workspace/events/dropped",
  "payload": {
    "fromSeq": 101,
    "toSeq": 104,
    "reason": "subscriber_backpressure"
  }
}
```

5. 对 coalesced command output 增加 seq 覆盖范围：

```json
{
  "seq": 105,
  "coversSeqFrom": 101,
  "coversSeqTo": 105,
  "coalesced": true
}
```

否则前端可能把良性 coalesce 误判为 gap。

### 建议测试

1. 前端单测：
   - seq 1 后收到 seq 5，标记 recovery，不推进 contiguous seq 到 5。
   - duplicate/replay seq 不重复应用。
   - coalesced event 带 `coversSeqFrom/coversSeqTo` 时不误报。

2. 后端测试：
   - afterSeq 后超过 2000 条事件时，stream 返回 replay incomplete。
   - afterSeq 小于 oldestSeq 时，返回 recoveryRequired。

3. 集成测试：
   - 模拟慢 WebSocket / subscriber drop；
   - 最终 thread projection 与后端 snapshot 一致；
   - terminal output 不缺行。

---

## 3.2 高风险：前端未处理全部 terminal turn lifecycle events

### 相关文件

后端：

- `backend/internal/store/thread_projection.go`
- `backend/internal/runtime/manager.go`

前端：

- `frontend/src/pages/threadLiveState.ts`
- `frontend/src/pages/threadPageUtils.ts`
- `frontend/src/stores/session-store.ts`

### 当前问题

后端投影支持：

```go
case "turn/started", "turn/completed", "turn/failed", "turn/interrupted", "turn/canceled", "turn/cancelled":
```

但前端 live projection 只处理：

```ts
case 'turn/started':
case 'turn/completed':
```

前端 activity status 也只处理：

```ts
case 'turn/started':
case 'turn/completed':
```

`threadDetailRefreshMethods` 也没有包含：

- `turn/failed`
- `turn/interrupted`
- `turn/canceled`
- `turn/cancelled`

### 触发场景

runtime unexpected close 时，后端会 publish：

```go
Method: "turn/interrupted"
```

但前端不更新对应 turn status。结果可能是：

- thread 整体显示 systemError；
- timeline 中具体 turn 仍为 inProgress；
- spinner / processing 状态持续；
- 用户误以为 turn 仍在运行。

### 修复方案

#### 1. 修改 `threadLiveState.ts`

将 turn lifecycle case 扩展为：

```ts
case 'turn/started':
case 'turn/completed':
case 'turn/failed':
case 'turn/interrupted':
case 'turn/canceled':
case 'turn/cancelled': {
  // existing handling
}
```

新增推导函数：

```ts
function inferTurnStatusFromLifecycleMethod(method: string) {
  switch (method) {
    case 'turn/completed':
      return 'completed'
    case 'turn/failed':
      return 'failed'
    case 'turn/interrupted':
      return 'interrupted'
    case 'turn/canceled':
    case 'turn/cancelled':
      return 'cancelled'
    default:
      return 'inProgress'
  }
}
```

并优先使用 `payload.turn.status`。

#### 2. 修改 `session-store.ts`

`readThreadActivityStatus` 增加：

```ts
case 'turn/failed':
  return readTurnLifecycleStatus(event.payload) || 'failed'
case 'turn/interrupted':
  return readTurnLifecycleStatus(event.payload) || 'interrupted'
case 'turn/canceled':
case 'turn/cancelled':
  return readTurnLifecycleStatus(event.payload) || 'cancelled'
```

#### 3. 修改 `threadPageUtils.ts`

将 terminal events 加入 `threadDetailRefreshMethods`：

```ts
const threadDetailRefreshMethods = new Set([
  ...,
  'turn/failed',
  'turn/interrupted',
  'turn/canceled',
  'turn/cancelled',
])
```

#### 4. 增加测试

- `threadLiveState.test.ts`
  - `turn/failed` 更新 turn status/error。
  - `turn/interrupted` 更新 turn status。
  - `turn/canceled` / `turn/cancelled` 更新为 cancelled。
- `session-store.test.ts`
  - activity status 对上述 event 正确。
- `useThreadPageRefreshEffects.test.tsx`
  - terminal lifecycle events 触发 thread detail refresh。

---

## 3.3 高风险：thread live store 使用 threadId 单独做 key，跨 workspace 可能串数据

### 相关文件

- `frontend/src/stores/session-store.ts`
- `frontend/src/pages/thread-page/useThreadPageSessionState.ts`
- `frontend/src/components/shell/WorkspaceTreeThreadRow.tsx`

### 当前问题

当前 store 中这些结构以 `threadId` 为 key：

```ts
eventsByThread: Record<string, ServerEvent[]>
threadProjectionsById: Record<string, ThreadDetail>
threadActivityByThread: Record<string, ThreadActivitySummary>
tokenUsageByThread: Record<string, ThreadTokenUsage>
```

读取也按 `threadId`：

```ts
state.eventsByThread[selectedThreadId]
state.tokenUsageByThread[selectedThreadId]
state.threadProjectionsById[projectionThreadId]
state.threadActivityByThread[thread.id]
```

这隐含要求 thread id 全局唯一。一旦不同 workspace 出现同名 thread id，就会串线。

### 触发场景

```txt
workspace A / thread-1
workspace B / thread-1
```

workspace A 收到 event 后：

```ts
threadProjectionsById['thread-1'] = projectionOfWorkspaceA
```

切到 workspace B 的 thread-1 时，可能读到 workspace A 的 projection。

### 用户可见影响

- 打开 workspace B 的线程，显示 workspace A 的 conversation；
- token usage 错误；
- live feed 错误；
- 侧边栏状态错误；
- removeWorkspace / removeThread 清理误删或漏删。

### 修复方案

#### 方案 A：完整迁移到复合 key

新增 helper：

```ts
const THREAD_STORE_KEY_SEPARATOR = '\u001f'

function threadStoreKey(workspaceId: string, threadId: string) {
  return `${workspaceId}${THREAD_STORE_KEY_SEPARATOR}${threadId}`
}
```

迁移以下结构：

```ts
eventsByThread
threadProjectionsById
threadActivityByThread
tokenUsageByThread
```

所有写入：

```ts
const key = threadStoreKey(event.workspaceId, event.threadId)
nextEventsByThread[key] = ...
nextThreadProjectionsById[key] = ...
```

所有读取：

```ts
const key = threadStoreKey(workspaceId, selectedThreadId)
state.eventsByThread[key]
```

#### 方案 B：短期保护

在完整迁移前，至少读取 projection 时校验 workspace：

```ts
const projection = state.threadProjectionsById[projectionThreadId]
return projection?.workspaceId === workspaceId ? projection : undefined
```

activity、events、tokenUsage 也应加类似保护，或尽快统一迁移。

#### 方案 C：持久化迁移

当前 partialize 持久化：

```ts
lastEventSeqByWorkspace
tokenUsageByThread
```

如果 key 结构变化，需要增加 zustand persist migration，避免旧 localStorage 数据污染。

### 建议测试

- `ws-1/thread-1` 和 `ws-2/thread-1` 同时存在；
- 各自收到不同 event；
- 切换 workspace 不串 projection / events / tokenUsage / activity；
- `removeWorkspace(ws-1)` 不删除 `ws-2/thread-1` 数据。

---

## 4. 中风险问题与修复方案

---

## 4.1 Live Feed 面板 `useMemo` 依赖遗漏 `surfacePanelView`

### 相关文件

- `frontend/src/pages/thread-page/useThreadPageDisplayState.ts`
- `frontend/src/pages/thread-page/buildThreadPageSelectionDisplayState.ts`

### 当前问题

`buildThreadPageSelectionDisplayState` 中：

```ts
const liveTimelineEntries =
  surfacePanelView === 'feed'
    ? buildLiveTimelineEntries(mergeEventsByTimestamp(workspaceEvents, selectedThreadEvents))
    : EMPTY_LIVE_TIMELINE_ENTRIES
```

但上层 memo deps 未包含 `surfacePanelView`：

```ts
const selectionDisplayState = useMemo(
  () => buildThreadPageSelectionDisplayState(input),
  [
    input.approvals,
    input.contextCompactionFeedback,
    input.threadProjection,
    input.loadedThreadIds,
    input.selectedCommandSession,
    input.selectedThreadEvents,
    input.selectedThreadId,
    input.selectedThreadTokenUsage,
    input.workspaceEvents,
  ],
)
```

### 触发场景

1. 页面已经收到实时事件；
2. 当前未打开 feed panel，`liveTimelineEntries = []`；
3. 用户打开 feed panel；
4. 因 `surfacePanelView` 不在 deps 中，memo 不重算；
5. feed 可能显示 “No live feed entries yet.”；
6. 直到下一条 event 到达才刷新。

### 修复方案

增加依赖：

```ts
const selectionDisplayState = useMemo(
  () => buildThreadPageSelectionDisplayState(input),
  [
    input.approvals,
    input.contextCompactionFeedback,
    input.threadProjection,
    input.loadedThreadIds,
    input.selectedCommandSession,
    input.selectedThreadEvents,
    input.selectedThreadId,
    input.selectedThreadTokenUsage,
    input.surfacePanelView,
    input.workspaceEvents,
  ],
)
```

### 建议测试

新增测试或扩展 hook/display state 测试：

```txt
给定 workspaceEvents / selectedThreadEvents 非空
初始 surfacePanelView = null
切换 surfacePanelView = 'feed'
期望 liveTimelineEntries 立即非空
```

---

## 4.2 终端 content 变为空时 xterm 不 reset，可能显示旧输出

### 相关文件

- `frontend/src/features/thread-terminal/ThreadTerminalViewport.tsx`
- `frontend/src/stores/session-store.ts`
- `backend/internal/execfs/service.go`

### 当前问题

后端 resume 逻辑可能发送空 replace：

```go
if currentOutput == "" {
  if cursor.OutputLength > 0 || strings.TrimSpace(cursor.OutputTail) != "" {
    return true, "", "empty_output"
  }
}

if replaceOutput && len(chunks) == 0 {
  chunks = []string{""}
}
```

前端 terminal viewport 对空 content：

```ts
if (!content) {
  clearQueuedWritesRef.current()
  latestContentRef.current = ''
  onSelectionChangeRef.current?.(false)
  return
}
```

没有调用：

```ts
terminal.reset()
```

因此 store 里的 `combinedOutput` 已为空，但 xterm 画面可能仍显示旧内容。

### 修复方案

修改 `ThreadTerminalViewport.tsx`：

```ts
if (!content) {
  clearQueuedWritesRef.current()

  if (latestContentRef.current) {
    terminal.reset()
    terminal.options.disableStdin = !interactive
  }

  latestContentRef.current = ''
  onSelectionChangeRef.current?.(false)
  return
}
```

### 建议测试

扩展 `ThreadTerminalViewport.test.tsx`：

```txt
render content="old output"
flush animation frame
rerender content=""
expect terminal.reset called
expect latestContentRef 已清空
```

---

## 4.3 Optimistic pending turn 缺少 client request id，HTTP / stream race 下体验不稳定

### 相关文件

- `frontend/src/pages/thread-page/buildThreadPageThreadActions.ts`
- `frontend/src/pages/thread-page/usePendingThreadTurns.ts`
- `frontend/src/pages/thread-page/useThreadPageLifecycleEffects.ts`
- `frontend/src/features/turns/api.ts`
- `backend/internal/api/router.go`

### 当前问题

发送消息时：

1. 前端创建 local optimistic pending turn；
2. 清空 composer；
3. HTTP `startTurn` 返回后才拿到 `turnId`；
4. 再把 pending turn 与真实 turn 关联。

如果 WebSocket 事件先于 HTTP response 到达，pending turn 暂时没有 `turnId`，可能出现短暂重复 user message。

如果 HTTP 失败/超时但后端实际已启动 turn，前端会恢复输入并显示发送失败，而 stream 继续产生真实事件，用户可能误以为没发出去并重复发送。

### 修复方案

#### 前端 API 增加 client request id

`StartTurnInput` 增加：

```ts
clientTurnRequestId?: string
```

发送时：

```ts
const clientTurnRequestId = crypto.randomUUID()
const optimisticTurn = createPendingTurn(selectedThreadId, trimmedInput, clientTurnRequestId)

const startTurnInput = {
  input: trimmedInput,
  clientTurnRequestId,
  ...
}
```

#### 后端 echo client request id

`handleStartTurn` 接收 `clientTurnRequestId`，通过 `turns.StartOptions` 或 event metadata 传递，最终在：

- HTTP result；
- `turn/started` event；
- 可能的 `item/started` user message；

中返回。

#### 前端关联逻辑

当前 pending turn 可以通过：

```ts
pendingTurn.clientTurnRequestId === event.payload.clientTurnRequestId
```

直接关联真实 turn，即使 HTTP response 慢或失败也能确认。

#### HTTP 失败但 stream 已开始的处理

catch 中不要立即认定失败，可短时间进入 pending-confirmation：

```txt
HTTP failed -> wait 1~3s for matching stream event
matched -> 清除 sendError，pending 关联真实 turn
not matched -> 恢复 composer，显示 sendError
```

### 建议测试

- stream 先于 HTTP result；
- HTTP reject 但之后收到 matching `turn/started`；
- 不重复显示 user message；
- 不错误恢复输入。

---

## 4.4 非 active workspace 的侧边栏线程状态不一定实时

### 相关文件

- `frontend/src/pages/thread-page/useThreadPageControllerRuntimeState.ts`
- `frontend/src/components/shell/NotificationCenter.tsx`
- `frontend/src/features/notifications/notificationStreamUtils.ts`
- `frontend/src/components/shell/AppShell.tsx`
- `frontend/src/components/shell/WorkspaceTreeThreadRow.tsx`

### 当前行为

实时订阅主要来自：

1. 当前 ThreadPage workspace：

```ts
useWorkspaceStream(workspaceId)
```

2. NotificationCenter 判定的 `liveWorkspaceIds`：

- active workspace；
- unread notification workspace；
- recent suppression workspace。

左侧 AppShell workspace tree 本身没有订阅所有展开 workspace。

### 影响

如果非当前 workspace 有运行中 thread，但没有 unread notification，也不是 active workspace，其侧边栏状态可能不实时。

### 修复选项

#### 选项 A：保持当前设计

如果产品目标是减少连接数量，则保留现状，并明确：

- 当前 workspace 实时；
- 非当前 workspace 只通过刷新/通知/轮询更新。

#### 选项 B：订阅展开 workspace

在 AppShell 中收集展开 workspace：

```ts
const expandedWorkspaceIds = ...
useWorkspaceStreams(expandedWorkspaceIds)
```

可限制最大数量，避免连接过多。

#### 选项 C：轻量轮询

非 active workspace 不开完整 stream，只轮询 thread summary：

```txt
每 15~30 秒刷新 shell-threads 或 workspace activity summary
```

---

## 5. 低风险与维护项

---

## 5.1 `deferredEvents` 机制残留但没有实际入队逻辑

### 相关文件

- `frontend/src/hooks/useWorkspaceStream.ts`

### 问题

代码存在：

- `deferredEvents`
- `scheduleDeferredWorkspaceEventFlush`
- `flushDeferredWorkspaceEvents`
- diagnostics 中的 deferred count

但当前没有实际逻辑执行：

```ts
stream.deferredEvents.push(...)
```

### 影响

- 不是直接用户可见 bug；
- 但 diagnostics 永远显示 deferred count 为 0；
- 开发者容易误以为 non-delta batching 生效。

### 修复方案

二选一：

1. 删除 deferred 相关逻辑与 diagnostics；
2. 或明确哪些 non-delta event 需要 rAF defer，并补充测试。

---

## 5.2 Approvals sync 当前可用，但只处理 latest event，未来 batching 后可能漏中间事件

### 相关文件

- `frontend/src/features/approvals/WorkspaceApprovalsQuerySync.tsx`
- `frontend/src/features/approvals/sync.ts`
- `frontend/src/features/approvals/cache.ts`

### 当前正向结论

`approvals/snapshot` 已接入，不是漏接：

```txt
WebSocket event
  -> session-store activityEventsByWorkspace
  -> WorkspaceApprovalsQuerySync
  -> syncApprovalQueriesFromWorkspaceActivity
  -> applyApprovalEventToCache
```

### 潜在风险

`syncApprovalQueriesFromWorkspaceActivity` 当前每次只处理：

```ts
const latestEvent = events[events.length - 1]
```

当前非 delta event 通常单条立即 ingest，所以一般没问题。但如果未来启用 non-delta batching 或其他地方批量 ingest 多个 approval event，则可能漏掉中间 approval request/resolution。

### 修复方案

改成按 workspace 记录 last processed index 或 seq，扫描所有未处理 event：

```ts
for (const event of events.slice(lastProcessedIndex + 1)) {
  applyApprovalEventToCache(...)
}
```

---

## 5.3 线程列表排序固定 `created_at`，需要产品确认

### 相关文件

- `frontend/src/pages/thread-page/useThreadPageQueries.ts`
- `frontend/src/components/shell/AppShell.tsx`
- `frontend/src/features/threads/cache.ts`
- `backend/internal/threads/service.go`

### 当前行为

前端请求：

```ts
sortKey: 'created_at'
```

前端 cache normalize：

```ts
sort by createdAt desc
```

后端实际支持：

- `created_at`
- `updated_at`

### 影响

如果产品预期是“最近活跃线程上浮”，当前表现会让用户觉得列表不同步。

如果产品预期是“稳定排序，不因活动跳动”，当前行为可以接受。

### 建议

如果要最近活跃优先：

1. query 改为 `sortKey: 'updated_at'`；
2. `normalizeThreads` 改为 updatedAt desc；
3. 评估 shell pagination / Show more 行为；
4. 增加测试。

如果保持创建时间排序：

- 明确 UI 语义；
- 通过状态图标和相对时间展示活跃变化。

---

## 6. 实施路线图

---

## P0：事件连续性与 replay 完整性

### 目标

保证前端最终状态不因 stream drop、replay limit、retention 或 reconnect race 长期不准确。

### 后端任务

1. `workspace/connected` 增加：
   - `headSeq`
   - `oldestSeq`
   - `replayLimit`
2. replay 完成后增加 `workspace/replay/completed`。
3. 支持分页 replay 或继续 replay 到 head。
4. subscriber drop 时增加不可丢弃的 `workspace/events/dropped`。
5. coalesced command output / token usage 增加 seq coverage metadata。
6. 增加后端 tests。

### 前端任务

1. 引入 workspace seq state：
   - `contiguousAppliedSeq`
   - `highestSeenSeq`
   - `missingRanges`
   - `recoveryNeeded`
2. `afterSeq` 改用 contiguous seq。
3. gap detected 时触发 recovery。
4. replay incomplete 时继续请求或 fallback snapshot。
5. diagnostics 面板展示 stream degraded / gap 信息。
6. 增加前端 tests。

### 验收标准

- 模拟漏 seq 后前端不会直接推进 afterSeq。
- reconnect 后能补齐缺失事件或明确进入 snapshot recovery。
- 超过 replay limit 时不会静默丢事件。
- terminal output / thread projection 最终与后端快照一致。

---

## P1：补齐 terminal turn lifecycle events

### 任务

1. `threadLiveState.ts` 支持：
   - `turn/failed`
   - `turn/interrupted`
   - `turn/canceled`
   - `turn/cancelled`
2. `session-store.ts` activity status 支持上述事件。
3. `threadPageUtils.ts` refresh method 支持上述事件。
4. 增加单测。

### 验收标准

- 收到 `turn/interrupted` 后 timeline 对应 turn 显示 interrupted。
- 收到 `turn/failed` 后 timeline 对应 turn 显示 failed，并保留 error。
- 侧边栏状态不再停留在 processing。
- terminal lifecycle events 触发必要 detail refresh。

---

## P1：thread live store workspace 隔离

### 任务

1. 增加 `threadStoreKey(workspaceId, threadId)`。
2. 迁移：
   - `eventsByThread`
   - `threadProjectionsById`
   - `threadActivityByThread`
   - `tokenUsageByThread`
3. 所有读写统一使用复合 key。
4. 添加 persist migration。
5. 增加跨 workspace 同名 thread 测试。

### 验收标准

- `ws-a/thread-1` 与 `ws-b/thread-1` 不串 projection。
- 删除 workspace A 不影响 workspace B 同名 thread。
- 侧边栏状态读取正确 workspace 的 activity。

---

## P2：快速修复明确 UI stale bug

### 任务 1：Live Feed memo deps

修改：

```ts
input.surfacePanelView
```

加入 `selectionDisplayState` memo deps。

验收：打开 feed panel 立即显示已有 event。

### 任务 2：Terminal empty content reset

修改 `ThreadTerminalViewport.tsx`：content 变空时 reset xterm。

验收：store combinedOutput 清空后，xterm 不显示旧输出。

---

## P2：优化 optimistic send ack

### 任务

1. `StartTurnInput` 增加 `clientTurnRequestId`。
2. 后端 start turn request 接收并传递。
3. HTTP result 和 stream event echo `clientTurnRequestId`。
4. pending turn 使用 client request id 与真实 turn 关联。
5. HTTP 失败后短暂等待 matching stream event。

### 验收

- stream 先到不重复显示用户消息。
- HTTP 超时但 stream 已开始时，不恢复 composer 为失败状态。
- 用户不容易重复发送。

---

## P3：产品行为与维护项

1. 明确 thread list 排序：`created_at` 还是 `updated_at`。
2. 明确非 active workspace 是否需要实时。
3. 删除或恢复 `deferredEvents`。
4. approvals sync 改为扫描所有未处理 event，增强未来 batching 容错。

---

## 7. 建议测试清单

### 7.1 WebSocket seq / replay

- seq gap detection；
- replay pagination；
- retention overflow；
- coalesced command output coverage；
- subscriber backpressure drop recovery。

### 7.2 Thread live projection

- `turn/failed`；
- `turn/interrupted`；
- `turn/canceled`；
- `turn/cancelled`；
- terminal event 后 fallback refresh。

### 7.3 Store workspace 隔离

- 两个 workspace 同 threadId；
- projection/events/activity/tokenUsage 不串；
- removeWorkspace/removeThread 行为正确。

### 7.4 UI render memo

- `surfacePanelView: null -> feed` 立即生成 live feed。

### 7.5 Terminal viewport

- content 非空 -> 空时 reset；
- replace replay 正确覆盖旧输出；
- command resume append/replace 行为保持。

### 7.6 Optimistic send

- stream 先于 HTTP response；
- HTTP error 但 stream matching；
- 失败恢复 composer；
- 不重复显示 pending user message。

---

## 8. 执行建议顺序

推荐分 5 个 PR 或任务批次执行：

### 批次 1：低风险快速修复

- Live Feed memo deps。
- Terminal empty reset。
- 增加对应测试。

风险低、收益明确。

### 批次 2：terminal lifecycle event 补齐

- 前端支持 `turn/failed` / `turn/interrupted` / `turn/canceled` / `turn/cancelled`。
- activity status 和 refresh trigger 同步补齐。
- 增加测试。

该批次可显著改善失败/中断状态准确性。

### 批次 3：thread store workspace 复合 key

- 需要认真做 migration 和测试。
- 影响面较大，但能解决跨 workspace 串数据高风险。

### 批次 4：WebSocket seq recovery 协议

- 需要前后端协同。
- 是最大风险修复，但改动较大。
- 建议先做 diagnostics 和后端 metadata，再做严格恢复。

### 批次 5：产品策略优化

- thread list sort；
- 非 active workspace stream policy；
- deferredEvents cleanup；
- approvals sync 全量扫描。

---

## 9. 提交前检查建议

若后续按本方案修改代码，建议至少执行：

```powershell
cd E:\projects\ai\codex-server\frontend
npm run i18n:check
npm test -- useWorkspaceStream.test.ts session-store.test.ts threadLiveState.test.ts sync.test.ts ThreadTerminalViewport.test.tsx
npm run build
```

如果改动后端 stream / hub / store，建议补充执行对应 Go 测试，例如：

```powershell
go test ./backend/internal/events ./backend/internal/store ./backend/internal/api ./backend/internal/threads ./backend/internal/runtime
```

具体命令可根据项目 go module 路径调整。

---

## 10. 最终判断

当前项目在实时线程页上已有较好的基础设施，但核心风险集中在“事件可靠性协议不足”和“前后端事件类型不一致”。如果不修复，用户在高频 stream、网络抖动、runtime crash、长时间离线、多 workspace 同名 thread 等场景下可能看到长期不准确的 UI。

优先修复建议：

1. **P0：seq gap / replay 完整性机制。**
2. **P1：terminal turn lifecycle event 补齐。**
3. **P1：thread live store workspace 隔离。**
4. **P2：Live Feed deps 与 terminal empty reset 快速修复。**
5. **P2/P3：optimistic send ack、排序策略、非 active workspace 实时策略、deferredEvents cleanup。**

---

## 11. 二次文档完整性自检与补充

本节为对本文档自身完整性的复核结果。复核结论：原报告已覆盖核心链路、问题分级、修复建议和测试方向；为便于后续直接落地实施，本次补充以下内容：

- 影响面矩阵；
- 分阶段任务拆解表；
- API / 数据结构变更建议；
- store migration 细化方案；
- 回滚策略；
- Definition of Done；
- 实施顺序依赖关系；
- 前端 i18n 检查注意事项。

### 11.1 完整性检查表

| 检查项 | 状态 | 说明 |
| --- | --- | --- |
| 页面入口与 Controller 链路 | 已覆盖 | 已列出 ThreadPage、controller state/data/actions/effects、layout 与 surface。 |
| WebSocket 事件流 | 已覆盖 | 已覆盖前端 queue/batch/reconnect 与后端 stream/replay/subscriber/store。 |
| Zustand session store | 已覆盖 | 已覆盖 seq、thread projection、activity、token usage、command sessions。 |
| React Query 快照与缓存 | 已覆盖 | 已覆盖 thread detail、threads、shell-threads、approvals、command sessions fallback。 |
| Thread live projection | 已覆盖 | 已指出 terminal lifecycle events 缺口。 |
| 用户输入发送链路 | 已覆盖 | 已指出 optimistic pending turn 与 client request id 问题。 |
| Terminal 面板 | 已覆盖 | 已指出空 content 不 reset 与 command output replay 风险。 |
| Approvals | 已覆盖 | 已确认 snapshot 已接入，并补充 latest-only sync 风险。 |
| Sidebar / AppShell | 已覆盖 | 已指出非 active workspace 不完全实时与 created_at 排序行为。 |
| i18n 要求 | 已覆盖 | 已记录当前审查未改前端文案，且已执行 i18n 检查。后续实施若新增 UI 文案必须继续执行。 |
| 实施方案 | 已覆盖并补充 | 原文已有 P0~P3，本节补充分解表、回滚、验收标准。 |
| 测试方案 | 已覆盖并补充 | 原文已有建议测试清单，本节补充每批次必跑命令与 DoD。 |

---

## 12. 影响面矩阵

| 问题/改动 | 前端影响 | 后端影响 | 数据持久化影响 | 兼容性风险 | 推荐优先级 |
| --- | --- | --- | --- | --- | --- |
| seq gap / replay 完整性 | 高：stream store、diagnostics、reconnect 策略 | 高：stream protocol、hub、store replay | 中：可能新增 seq state 持久化 | 高，需要灰度或渐进实现 | P0 |
| terminal lifecycle events 补齐 | 中：projection、activity、refresh | 低：后端已产生事件，主要是前端补齐 | 无 | 低 | P1 |
| thread store 复合 key | 高：session-store 读写全链路 | 无 | 高：localStorage migration | 中高，需要完整测试 | P1 |
| Live Feed memo deps | 低 | 无 | 无 | 低 | P2 |
| terminal empty reset | 低 | 无 | 无 | 低 | P2 |
| optimistic send client id | 中：API 类型、pending turn、UI 状态 | 中：start turn API/event echo | 低 | 中，需要兼容旧事件 | P2 |
| 非 active workspace 实时策略 | 中：AppShell/NotificationCenter | 低或无 | 无 | 中，连接数量可能增加 | P3 |
| created_at / updated_at 排序 | 中：queries/cache/UI 行为 | 低：后端已支持 | 无 | 中，用户习惯变化 | P3 |
| deferredEvents cleanup | 低 | 无 | 无 | 低 | P3 |
| approvals sync 扫描未处理事件 | 低 | 无 | 无 | 低 | P3 |

---

## 13. 分阶段实施任务拆解

### 13.1 批次 1：快速修复 UI stale 问题

目标：先修复明确、低风险、可独立验证的前端 stale bug。

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 1.1 | `selectionDisplayState` memo deps 加 `input.surfacePanelView` | `frontend/src/pages/thread-page/useThreadPageDisplayState.ts` | 已有事件时打开 feed panel 立即显示 live feed。 |
| 1.2 | 增加 display state 或 surface 相关测试 | 建议新增/扩展 `frontend/src/pages/thread-page/useThreadPageDisplayState.test.ts` 或现有测试 | 测试覆盖 `surfacePanelView: null -> feed`。 |
| 1.3 | terminal viewport 在 `content === ''` 时 reset xterm | `frontend/src/features/thread-terminal/ThreadTerminalViewport.tsx` | content 从非空变空时旧输出消失。 |
| 1.4 | 增加 terminal viewport 测试 | `frontend/src/features/thread-terminal/ThreadTerminalViewport.test.tsx` | mock Terminal 的 `reset` 被调用。 |

建议验证：

```powershell
cd frontend
npm run i18n:check
npm test -- ThreadTerminalViewport.test.tsx
npm test -- ThreadWorkbenchSurface.test.tsx
```

如果新增或修改 UI 文案，必须确认均使用现有 i18n 方案。

### 13.2 批次 2：补齐 terminal turn lifecycle event

目标：前端完整处理后端已存在的 terminal turn lifecycle 事件。

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 2.1 | `applyThreadEventToDetail` 支持 `turn/failed` / `turn/interrupted` / `turn/canceled` / `turn/cancelled` | `frontend/src/pages/threadLiveState.ts` | timeline turn status 正确更新。 |
| 2.2 | 补齐 activity status 推导 | `frontend/src/stores/session-store.ts` | sidebar status 不再停留在 processing。 |
| 2.3 | 补齐 thread detail refresh trigger | `frontend/src/pages/threadPageUtils.ts` | terminal events 触发必要 detail refresh。 |
| 2.4 | 补齐单测 | `threadLiveState.test.ts`、`session-store.test.ts`、`threadPageUtils.test.ts` | 覆盖四类 terminal events。 |

建议验证：

```powershell
cd frontend
npm run i18n:check
npm test -- threadLiveState.test.ts session-store.test.ts threadPageUtils.test.ts useThreadPageRefreshEffects.test.tsx
```

### 13.3 批次 3：thread live store 复合 key 隔离

目标：彻底消除跨 workspace 同 threadId 串数据风险。

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 3.1 | 新增 `threadStoreKey(workspaceId, threadId)` helper | 建议 `frontend/src/stores/session-store-utils.ts` 或 session-store 内部 | 所有 thread live key 统一生成。 |
| 3.2 | 迁移 `eventsByThread` 写入和读取 | `session-store.ts`、`useThreadPageSessionState.ts` | selectedThreadEvents 不串 workspace。 |
| 3.3 | 迁移 `threadProjectionsById` | `session-store.ts`、`useThreadPageSessionState.ts` | projection workspaceId 与当前 workspace 一致。 |
| 3.4 | 迁移 `threadActivityByThread` | `session-store.ts`、`WorkspaceTreeThreadRow.tsx` | sidebar activity 按 workspace 隔离。 |
| 3.5 | 迁移 `tokenUsageByThread` | `session-store.ts`、`useThreadPageSessionState.ts` | token usage 不串 workspace。 |
| 3.6 | 增加 persist migration | `session-store.ts` | 旧 localStorage 不污染新结构。 |
| 3.7 | 增加跨 workspace 同名 thread 测试 | `session-store.test.ts`、必要时 `WorkspaceTreeThreadRow.test.tsx` | 同名 thread 完全隔离。 |

迁移建议：

```ts
const THREAD_STORE_KEY_SEPARATOR = '\u001f'

export function buildThreadStoreKey(workspaceId: string, threadId: string) {
  return `${workspaceId}${THREAD_STORE_KEY_SEPARATOR}${threadId}`
}
```

短期兼容读取可以在迁移期间保留 fallback：

```ts
const composite = state.threadProjectionsById[buildThreadStoreKey(workspaceId, threadId)]
if (composite) return composite

const legacy = state.threadProjectionsById[threadId]
return legacy?.workspaceId === workspaceId ? legacy : undefined
```

完成 migration 并稳定后，可以删除 legacy fallback。

建议验证：

```powershell
cd frontend
npm run i18n:check
npm test -- session-store.test.ts useThreadPageSessionState.test.ts WorkspaceTreeThreadRow.test.tsx
npm run build
```

### 13.4 批次 4：WebSocket seq recovery 协议

目标：从协议层保证事件不静默丢失。

后端拆分：

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 4.1 | store 暴露 oldest/head seq 信息 | `backend/internal/store/memory.go` | 可查询 workspace oldestSeq/headSeq。 |
| 4.2 | `workspace/connected` 增加 headSeq/oldestSeq/replayLimit | `backend/internal/api/router.go` | 前端连接时知道 replay 可用范围。 |
| 4.3 | replay 完成事件 | `backend/internal/api/router.go` | 客户端知道 replay 是否完整。 |
| 4.4 | replay 分页或继续 replay | `router.go` / 新 endpoint | 超 2000 事件可继续补齐。 |
| 4.5 | subscriber drop 显式事件 | `backend/internal/events/hub.go` | drop 不再静默。 |
| 4.6 | coalesced event coverage metadata | `backend/internal/events/hub.go` | 前端可区分良性 coalesce 与真实 gap。 |

前端拆分：

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 4.7 | 增加 workspace seq state | `session-store.ts` / types | 区分 contiguous/highest/recovery。 |
| 4.8 | afterSeq 使用 contiguous seq | `useWorkspaceStream.ts` | 不因 gap 误跳过 replay。 |
| 4.9 | 处理 `workspace/replay/completed` | `session-store.ts` / stream handler | replay incomplete 触发继续恢复。 |
| 4.10 | 处理 `workspace/events/dropped` | `session-store.ts` / diagnostics | 标记 degraded 并触发 fallback。 |
| 4.11 | diagnostics 展示 gap/recovery | 现有 profiler/diagnostics 相关组件 | 可见恢复状态。 |

建议分两步落地：

1. **观测优先**：先增加后端 metadata 和前端 diagnostics，不改变应用逻辑。
2. **严格恢复**：再改 afterSeq 与 gap recovery 策略。

建议验证：

```powershell
go test ./backend/internal/events ./backend/internal/store ./backend/internal/api
cd frontend
npm test -- useWorkspaceStream.test.ts session-store.test.ts
npm run build
```

实际 Go 测试路径请以项目 go module 命令可执行情况为准。

### 13.5 批次 5：optimistic send client request id

目标：解决 HTTP 与 stream race，以及 HTTP 失败但后端已接受导致的 UX 歧义。

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 5.1 | `StartTurnInput` 增加 `clientTurnRequestId` | `frontend/src/features/turns/api.ts` | 类型可用。 |
| 5.2 | pending turn 保存 client request id | `threadPageTurnHelpers.ts`、`usePendingThreadTurns.ts` | pending 可被 stream event 匹配。 |
| 5.3 | 前端 startTurn request 传入 id | `buildThreadPageThreadActions.ts` | 每次发送生成唯一 id。 |
| 5.4 | 后端 request 结构接收 id | `backend/internal/api/router.go` | 不破坏旧请求。 |
| 5.5 | 后端 result/event echo id | turns service / runtime event metadata 相关链路 | stream 可关联 pending。 |
| 5.6 | HTTP failure 后短暂等待 matching stream event | `buildThreadPageThreadActions.ts` / effect | 不误恢复 composer。 |
| 5.7 | 增加 race tests | 前端 action tests / integration tests | stream 先到或 HTTP 失败场景正确。 |

兼容要求：旧后端不 echo `clientTurnRequestId` 时，前端应回退到现有 `turnId` 匹配逻辑。

---

## 14. API / 数据结构建议细化

### 14.1 WebSocket bootstrap event

建议将 `workspace/connected` payload 扩展为：

```json
{
  "status": "connected",
  "headSeq": 3100,
  "oldestSeq": 1101,
  "replayLimit": 2000,
  "protocolVersion": 2
}
```

兼容策略：

- 老前端忽略新增字段；
- 新前端如果字段缺失，则按 legacy 模式运行，但 diagnostics 标记 `seqRecoveryProtocol=false`。

### 14.2 Replay completed event

建议新增：

```json
{
  "workspaceId": "ws-1",
  "method": "workspace/replay/completed",
  "payload": {
    "afterSeq": 100,
    "fromSeq": 101,
    "toSeq": 2100,
    "headSeq": 3100,
    "oldestSeq": 101,
    "complete": false,
    "nextAfterSeq": 2100,
    "limit": 2000
  },
  "ts": "..."
}
```

该事件不应占用业务 seq，或需要明确它是否参与 seq 机制。建议作为 bootstrap/control event，不参与 workspace event seq。

### 14.3 Dropped event control message

建议新增：

```json
{
  "workspaceId": "ws-1",
  "method": "workspace/events/dropped",
  "payload": {
    "fromSeq": 101,
    "toSeq": 104,
    "methods": ["item/agentMessage/delta"],
    "reason": "subscriber_backpressure",
    "recoverable": true
  },
  "ts": "..."
}
```

注意：该事件必须不可丢弃，否则无法通知客户端 drop。

### 14.4 Coalesced event coverage metadata

对后端合并过的事件，建议增加：

```json
{
  "seq": 105,
  "coversSeqFrom": 101,
  "coversSeqTo": 105,
  "coalesced": true
}
```

前端 gap 检测规则：

```txt
如果 event.seq > contiguous + 1：
  如果 coversSeqFrom <= contiguous + 1 且 coversSeqTo == event.seq：
    可推进 contiguous 到 event.seq
  否则：
    标记 gap
```

---

## 15. 回滚策略

### 15.1 快速 UI 修复回滚

- Live Feed deps：回滚单行依赖即可。
- Terminal reset：回滚 `content === ''` 分支的 reset 逻辑即可。

风险较低，不需要数据迁移。

### 15.2 terminal lifecycle event 回滚

如出现异常，可回滚前端对新增 event 的处理，让后端 snapshot fallback 接管。但建议保留 refresh trigger，以避免 UI 永久 stale。

### 15.3 thread store 复合 key 回滚

这是高影响改动，建议：

1. 实施时保留 legacy fallback；
2. migration 只增不删，避免不可逆；
3. 如果回滚代码，新版本写入的 composite key 不会被旧代码读取，因此回滚前应确认 fallback 或清理 localStorage 策略。

推荐在 migration 中保留旧 key 一段时间：

```txt
旧 key 保留 -> 新代码优先读 composite -> fallback legacy -> 稳定后再清理
```

### 15.4 WebSocket seq recovery 回滚

建议通过 protocolVersion / feature flag 渐进开启：

```ts
const workspaceSeqRecoveryEnabled = true
```

回滚方式：

- 前端关闭严格 gap recovery，仅保留 diagnostics；
- 后端新增 control fields 保持兼容，不需要回滚；
- 若新增 control event 导致问题，可后端停止发送，前端按 legacy 运行。

### 15.5 optimistic send client id 回滚

兼容策略：

- 前端可发送 `clientTurnRequestId`，旧后端忽略；
- 新前端若没有收到 echo，回退现有 `turnId` 匹配；
- 后端可保留字段不使用，不影响旧客户端。

---

## 16. Definition of Done（完成标准）

### 16.1 通用完成标准

每个批次至少满足：

1. TypeScript 编译通过：

```powershell
cd frontend
npm run build
```

2. 多语言扫描通过：

```powershell
npm run i18n:check
```

3. 相关单测通过。
4. 若修改后端，相关 Go 单测通过。
5. 没有新增未国际化 UI 文案。
6. 没有用白名单掩盖 i18n 漏洞。
7. 手动或自动验证关键用户路径：
   - 打开 workspace/thread；
   - 发送消息；
   - 接收 stream delta；
   - terminal output；
   - approval request/resolution；
   - 切换 thread / workspace。

### 16.2 P0 seq recovery 完成标准

- gap 不再静默推进 `afterSeq`；
- replay 超上限时前端明确知道 incomplete；
- drop 后可以自动补齐或进入 degraded + snapshot recovery；
- diagnostics 能显示 recovery 状态；
- 旧后端/旧事件在兼容模式下不崩溃。

### 16.3 P1 lifecycle 完成标准

- failed/interrupted/cancelled turn 不再显示为 inProgress；
- sidebar activity 与 timeline 状态一致；
- refresh trigger 覆盖 terminal events；
- 对应 tests 覆盖。

### 16.4 P1 composite key 完成标准

- 跨 workspace 同 threadId 不串数据；
- localStorage migration 不破坏旧用户状态；
- removeWorkspace/removeThread 清理准确；
- tokenUsage/events/activity/projection 均按 workspace 隔离。

---

## 17. 后续实现时的注意事项

1. **避免一次性大爆炸改动。** 建议先做批次 1、2，再做复合 key，最后做 seq recovery 协议。
2. **seq recovery 不宜只在前端做。** 由于后端存在 coalesce 与 replay limit，必须前后端协议协同。
3. **不要用 threadId 假设全局唯一。** 即使当前后端生成全局唯一，也应在前端 store 层使用 workspaceId 隔离，降低未来导入/迁移/测试风险。
4. **terminal output 要同时考虑 xterm 内部 buffer 与 React prop。** 仅更新 React state 不代表 xterm 画面已清空。
5. **所有新增 UI 文案必须接入 i18n。** 特别是 diagnostics、recovery notice、error banner、debug chip 等容易漏。
6. **backward compatibility 优先。** 前端应能连接未升级后端；后端新增字段不应破坏旧前端。

---

## 18. 本次文档复核记录（2026-05-11）

本节记录对本文档完整性的最终复核结果，避免后续实施阶段无法判断报告是否已可直接作为开发计划使用。

### 18.1 复核结论

复核结论：**文档已达到可实施标准，无需再补充新的问题域**。当前文档已经覆盖：

- workspace/thread 页面入口、controller、state、data、effects、actions 与 surface 渲染链路；
- WebSocket workspace stream、后端 hub、replay、retention、subscriber backpressure 与前端 `afterSeq` 使用方式；
- session store、thread live projection、React Query 快照缓存之间的数据来源优先级与同步关系；
- 用户输入发送、optimistic pending turn、HTTP / WebSocket race 风险；
- terminal 输出、xterm 内部 buffer、command session fallback 与 turn lifecycle event；
- approvals snapshot / event cache sync；
- sidebar、AppShell、非 active workspace 实时性、thread list 排序策略；
- P0/P1/P2/P3 分级实施路线、影响面矩阵、API / 数据结构建议、回滚策略与 Definition of Done。

### 18.2 本次补充原因

原文主体已经完整，但为了让后续执行者能够快速确认“这份计划是否经过最终复核”，本次仅补充复核记录与使用建议，不新增新的风险结论，也不改变原有优先级判断。

### 18.3 后续使用建议

后续进入代码修复时，建议直接按本文档第 13 节批次执行：

1. 先落地低风险 UI stale 修复：Live Feed memo deps、terminal empty reset；
2. 再补齐 terminal turn lifecycle event；
3. 再处理 thread live store 复合 key 隔离；
4. 最后推进 WebSocket seq recovery 协议与 optimistic send client request id。

每个涉及前端代码的批次完成后，必须按项目要求执行：

```powershell
cd frontend
npm run i18n:check
```

若批次新增、修改或移动界面文案，必须确认文案已接入现有 i18n 方案；如修改 i18n 白名单，需要同步复核白名单是否仍合理，避免掩盖真实遗漏。

### 18.4 本次复核未做的事情

- 未修改前端或后端业务代码；
- 未新增 UI 文案；
- 未调整 i18n 白名单；
- 未执行完整 build，因为本次变更范围仅为文档复核与补充。

因此，本次文档更新本身不触发前端 i18n 扫描的强制要求；后续任何前端实现批次仍必须执行相关检查。

---

## 19. 实施记录（2026-05-11）

本轮已按第 13 节的实施批次完成以下代码落地。需要特别说明：批次 4 已完成“基础 seq/gap 保护 + 兼容协议元数据 + coalesced coverage metadata”，但尚未完全达到第 16.2 的全部 P0 完成标准；剩余的 replay pagination、显式 dropped control event 与 degraded/recovery UI 仍需后续批次继续推进。

### 19.1 已实施批次

1. **批次 1：快速修复 UI stale 问题**
   - `useThreadPageDisplayState` 的 `selectionDisplayState` memo 依赖已补充 `surfacePanelView`，避免切换 Live Feed 面板时派生状态不刷新。
   - `ThreadTerminalViewport` 在同一 session 的 `content` 从非空变为空时会重置 xterm，避免 React state 已清空但终端 buffer 仍显示旧输出。

2. **批次 2：补齐 terminal turn lifecycle event**
   - `threadLiveState` 已支持 `turn/failed`、`turn/interrupted`、`turn/canceled`、`turn/cancelled`。
   - `session-store` 的 thread activity 状态推导已覆盖上述 terminal events。
   - `threadPageUtils` 的 thread detail refresh trigger 已覆盖上述 terminal events，并纳入 open-stream recovery refresh 范围。

3. **批次 3：thread live store workspace 隔离**
   - 新增 workspace-scoped thread store key：`buildThreadStoreKey(workspaceId, threadId)`。
   - `eventsByThread`、`threadProjectionsById`、`threadActivityByThread`、`tokenUsageByThread` 写入已改用复合 key。
   - Thread 页面读取、Sidebar activity 读取已改用复合 key，并对可验证 workspaceId 的 legacy 数据保留兼容 fallback。
   - persisted `tokenUsageByThread` 已增加 versioned migration / partialize 过滤，避免旧 threadId-only token usage 污染新结构。
   - `removeWorkspace` / `removeThread` 清理逻辑已同时覆盖 composite key 与 legacy key。

4. **批次 4：WebSocket seq/gap 基础恢复协议（阶段性完成）**
   - 后端 `EventEnvelope` 增加 `coversSeqFrom`、`coversSeqTo`、`coalesced` 字段，保持 `omitempty`，兼容旧客户端。
   - 后端 workspace stream 的 `workspace/connected` control event 增加 `headSeq`、`oldestSeq`、`replayLimit`、`protocolVersion`。
   - 后端 replay 完成后发送 `workspace/replay/completed` control event，payload 包含 `afterSeq`、`fromSeq`、`toSeq`、`headSeq`、`oldestSeq`、`complete`、`nextAfterSeq`、`limit`、`replayed`。
   - 后端 `MemoryStore` 增加 `GetWorkspaceEventOldestSeq`，用于判断 replay retention 是否已覆盖所需范围。
   - 后端 hub 的 workspace event sequencing 已排除 `workspace/connected`、`workspace/replay/completed`、`workspace/events/dropped`、`command/exec/stateSnapshot`、`approvals/snapshot` 等 control/snapshot event，避免控制事件污染业务 seq。
   - 后端 subscriber 在合并 `command/exec/outputDelta`、`thread/tokenUsage/updated` 时写入 coverage metadata，使前端可区分“合并造成的 seq 跳跃”和真实丢包。
   - 前端 `ServerEvent` 类型补齐 `coversSeqFrom`、`coversSeqTo`、`coalesced`。
   - 前端 `useWorkspaceStream` 在非 replay live event 到达前检测 workspace seq gap：
   - 若本地没有已知 last seq，则允许首个 live event 建立基线；
   - 若已有 last seq 且收到 `seq > lastSeq + 1`，并且事件没有覆盖缺口，则不 ingest、不 broadcast，记录 lifecycle diagnostic，清空 queued delta，并关闭 socket 触发 reconnect/replay；
   - 对 queued delta 会在检测到 gap 时立即应用 gap 前的连续事件、阻止 gap event 继续 broadcast，再丢弃 gap 及之后的队列事件并触发 reconnect。
   - 前端 `session-store` 增加兜底防线：已知 last seq 下的非 replay gap event 不会推进 `lastEventSeqByWorkspace`，避免绕过 stream handler 的路径静默跳过缺失 seq；带 coverage metadata 的 coalesced event 可通过。

### 19.2 已补充测试

- terminal content 清空时 xterm reset；
- failed / interrupted / canceled / cancelled turn lifecycle live projection；
- terminal lifecycle event 的 activity status；
- terminal lifecycle event 的 thread detail refresh trigger；
- 跨 workspace 同 threadId 的 events / projection / activity 隔离；
- sidebar 使用 workspace-scoped activity；
- `useWorkspaceStream` 对非 replay live seq gap 的拒绝、socket close 与 diagnostic 记录；
- coalesced coverage metadata 跨过缺失 seq 时不误报 gap；
- queued delta flush 在 gap 前正常应用、gap 后丢弃并触发 reconnect；
- `session-store` 对已知 seq gap 的兜底拒绝，以及 coverage metadata 的兜底放行；
- 后端 subscriber coalescing 写入 `Coalesced` / `CoversSeqFrom` / `CoversSeqTo`；
- 后端 `MemoryStore` oldest seq 在持久化/reload 与 retention trimming 场景下保持正确。

### 19.3 已执行验证

后端验证：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api
```

结果：通过。

前端相关单测：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts session-store.test.ts threadLiveState.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts
```

结果：8 个测试文件、114 个测试用例全部通过。

前端 i18n 与 build：

```powershell
cd frontend
npm run i18n:check
npm run build
```

结果：

- i18n 检查：通过，扫描文件 423，问题数量 0，影响文件 0；
- 前端 build：通过。

### 19.4 当前仍未完全闭环的事项

以下事项仍建议后续单独批次推进，因为需要更完整的协议、UI 或交互改造：

- **Replay incomplete 的前端可视化与恢复策略**：后端已提供 `workspace/replay/completed.complete`、`oldestSeq`、`headSeq` 等元数据，但前端尚未将 incomplete 状态展示为 degraded/recovery UI，也尚未触发 snapshot recovery 的显式用户提示。
- **Replay pagination / continue replay**：当前仍使用单次 `workspaceReplayLimit = 2000`；若缺口超过 replay limit，后端可报告 incomplete，但还不能自动分页补齐至 head。
- **Explicit dropped event control message**：`workspace/events/dropped` 已在 sequencing 中预留为 control event，但 subscriber drop 时尚未实现可靠、不可丢弃的 dropped control event 下发路径。
- **Optimistic send `clientTurnRequestId` 的 HTTP / stream ack 协议**：尚未实施；发送 race 与 HTTP response 失败后由 stream event 反向确认的能力仍需后续批次补齐。
- **非 active workspace 的实时订阅策略**：本轮未改变订阅范围与资源策略。
- **thread list `created_at` / `updated_at` 排序策略确认**：本轮未调整 thread list 排序语义。

### 19.5 回归风险与兼容性说明

- 新增后端 event 字段均为 `omitempty`，旧前端会忽略；新前端遇到旧后端缺少 coverage/replay metadata 时按兼容路径处理，不因缺字段崩溃。
- 前端 gap 检测只在本地已有 workspace last seq 时启用；首次建立 live seq 基线时不会因为历史 head seq 大于 1 而误判。
- coalesced coverage 的放行条件要求 `coversSeqFrom <= currentSeq + 1` 且 `coversSeqTo >= event.seq`，避免 coverage 不完整时误吞真实 gap。
- `session-store` 的 gap 兜底保护不会替代 stream recovery；它只防止异常路径静默推进 seq，真正补齐仍依赖 reconnect/replay。
- 本轮没有新增 UI 文案；已按项目要求执行 `npm run i18n:check`，未修改 i18n 白名单。

---

## 20. 实施完整性复核记录（2026-05-12）

本节记录对第 19 节已实施内容的完整性复核结果。复核目标是判断当前代码是否已经完整覆盖本文档提出的 workspace/thread 数据同步与渲染修复目标，以及哪些事项仍不能视为闭环。

### 20.1 总体结论

复核结论：**当前实施达到“阶段性可验证完成”，但尚未达到全文档定义的最终完成态**。

- **已闭环**：批次 1、批次 2、批次 3 已具备代码实现、测试覆盖与构建验证，可视为完成。
- **阶段性完成**：批次 4 已完成基础 seq/gap 防护、后端 replay 元数据、coalesced coverage metadata 与前端 gap-triggered reconnect，但尚未满足第 16.2 的完整 P0 seq recovery 完成标准。
- **未开始**：批次 5 optimistic send `clientTurnRequestId` 协议尚未落地。
- **文档状态**：第 19 节对已完成和未闭环事项的描述基本准确，本节补充更明确的完整性判定矩阵。

### 20.2 按批次完整性矩阵

| 批次 | 目标 | 当前状态 | 完整性判断 |
| --- | --- | --- | --- |
| 批次 1 | Live Feed memo deps、terminal empty reset | 已实现并有测试 | **完成** |
| 批次 2 | terminal failed/interrupted/cancelled lifecycle 同步 | 已实现并有 projection/activity/refresh trigger 测试 | **完成** |
| 批次 3 | thread live store workspace-scoped key 隔离 | 已实现 composite key、legacy fallback、migration 与跨 workspace 测试 | **完成** |
| 批次 4.1-4.3 | stream protocol metadata、oldest/head seq、gap 检测 | 已实现 `workspace/connected` metadata、`workspace/replay/completed`、前端 gap 检测 | **阶段性完成** |
| 批次 4.4 | replay pagination / continue replay | 未实现 | **未完成** |
| 批次 4.5 | explicit dropped event control message | 仅预留 `workspace/events/dropped` sequencing 排除，未真正下发 | **未完成** |
| 批次 4.6 | coalesced coverage metadata | 已实现 command output / token usage coverage metadata 与测试 | **完成** |
| 批次 4.9-4.11 | replay incomplete 处理、dropped 处理、diagnostics 可视化 | 未完整实现；仅有 lifecycle event 记录 | **未完成** |
| 批次 5 | optimistic send `clientTurnRequestId` | 代码中未发现实际实现 | **未完成** |

### 20.3 当前实现已经解决的问题

1. **前端 stale 渲染问题**
   - Live Feed 面板切换后的派生状态刷新问题已修复。
   - terminal `content` 清空后 xterm buffer 残留问题已修复。

2. **terminal lifecycle 状态不一致问题**
   - `turn/failed`、`turn/interrupted`、`turn/canceled`、`turn/cancelled` 已纳入 live projection、activity status 与 refresh trigger。
   - 可避免 terminal turn 永久停留在 `inProgress`。

3. **跨 workspace 同 threadId 串数据问题**
   - `eventsByThread`、`threadProjectionsById`、`threadActivityByThread`、`tokenUsageByThread` 已改用 workspace/thread composite key。
   - Thread 页面读取、Sidebar activity 读取和清理逻辑已同步调整。

4. **基础 stream gap 不再静默推进**
   - leader socket 收到非 replay live gap event 时，不再 ingest，也不再 broadcast，并会关闭 socket 触发 reconnect。
   - session store 增加兜底保护，防止绕过 stream handler 的 gap event 推进 `lastEventSeqByWorkspace`。
   - coalesced coverage metadata 可避免后端合并事件被误判为真实 gap。

### 20.4 尚不能视为完整闭环的问题

1. **P0 seq recovery 只完成了“发现 gap + reconnect”，未完成“保证补齐”**
   - 当前逻辑可以避免静默丢事件，但 replay 超过 2000 或 retention 已丢失时，前端还没有完整 degraded/recovery UI 或 snapshot fallback。
   - `workspace/replay/completed.complete=false` 已有后端元数据基础，但前端尚未将其转化为用户可见状态或自动补偿动作。

2. **缺少 replay pagination**
   - `workspaceReplayLimit = 2000` 仍是单次上限。
   - 若缺口超过该上限，目前只能报告 incomplete，不能自动继续拉取到 head。

3. **subscriber dropped control event 未实现**
   - `workspace/events/dropped` 已被当作 control event 预留，避免未来污染 seq。
   - 但 subscriber 发生 drop 时，还没有可靠的不可丢弃控制事件下发机制。

4. **BroadcastChannel follower 恢复链路仍不完整**
   - leader 检测到 gap 时会阻止 broadcast 并重连。
   - 但 follower 若因本地 seq 落后而对已 broadcast 的事件检测出 gap，本身没有 socket，当前只能拒绝该事件，不能主动要求 leader replay 或升级为 direct recovery。
   - 这属于多标签页一致性的剩余风险。

5. **optimistic send race 未闭环**
   - 代码中未发现 `clientTurnRequestId` 的实际前后端传递、HTTP echo 或 stream event echo。
   - 因此 HTTP response 慢/失败而 stream event 先到的场景，仍主要依赖现有 turnId/pending 逻辑，未达到文档中批次 5 的目标。

6. **端到端和浏览器手动验证不足**
   - 当前主要通过单元测试、TypeScript build、Go 包测试验证。
   - 尚未记录真实浏览器路径验证：打开 workspace/thread、发送消息、断线重连、模拟 stream gap、多 tab follower 等。

### 20.5 本次复核重新执行的验证

后端相关包测试：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api
```

结果：通过。

前端相关测试：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts session-store.test.ts threadLiveState.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts
```

结果：8 个测试文件、114 个测试用例全部通过。

前端 i18n 检查：

```powershell
cd frontend
npm run i18n:check
```

结果：通过，扫描文件 423，问题数量 0。

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

### 20.6 推荐后续收敛顺序

1. **优先完成 replay incomplete 处理**
   - 前端消费 `workspace/replay/completed`；
   - 当 `complete=false` 时进入 degraded/recovery 状态；
   - 触发 snapshot fallback 或提示用户刷新。

2. **实现 replay pagination / continue replay**
   - 后端支持继续从 `nextAfterSeq` 补齐；
   - 前端在 replay incomplete 时自动继续，直到 head 或确认 retention 不可恢复。

3. **实现 `workspace/events/dropped` 控制事件**
   - subscriber drop 时发出不可丢弃 control event；
   - 前端收到后标记 degraded 并触发恢复。

4. **补齐 BroadcastChannel follower recovery**
   - follower 检测 gap 后向 leader 请求 replay；或
   - follower 临时升级为 direct socket 以自身 `afterSeq` 做恢复。

5. **落地 optimistic send `clientTurnRequestId`**
   - 前端生成 request id；
   - 后端 HTTP result 与 `turn/started` event echo；
   - pending turn 使用 request id 关联真实 turn。

### 20.7 最终判定

当前实现可以合并为一个**阶段性同步可靠性增强**：它显著降低了 stale render、terminal lifecycle 错误、跨 workspace 串数据和 live stream gap 静默推进的风险。

但若按本文档第 16 节 Definition of Done 严格判断，整个 workspace/thread 数据同步治理仍是：

```txt
部分完成：批次 1-3 完成，批次 4 阶段性完成，批次 5 未完成。
```

因此，不建议将当前状态标记为“全部实施完成”；建议标记为“核心低中风险修复完成，P0 seq recovery 进入第二阶段”。

---

## 21. Replay incomplete 自动续页实施记录（2026-05-12）

本节记录在第 20 节完整性复核之后继续推进的 P0 seq recovery 第二阶段实现。该批次聚焦 `workspace/replay/completed` 的前端消费和基于 reconnect 的 replay continuation，目标是让 replay 超出单次 limit 时不再停留在“只知道 incomplete，但不能继续补齐”的状态。

### 21.1 已实施内容

1. **前端消费 `workspace/replay/completed` control event**
   - `handleWorkspaceStreamEvent` 在处理非 batchable event 时，先 flush 已排队的 replay delta，再识别 `workspace/replay/completed`。
   - `workspace/replay/completed` 不进入普通 ingest / broadcast 流程，避免污染 workspace activity 或跨 tab 广播控制事件。
   - 完整 replay 会记录 `replay-completed` lifecycle event。

2. **incomplete replay 自动继续下一页**
   - 当前端收到 `complete=false`，且 payload 中 `nextAfterSeq` / `toSeq` 表示 replay cursor 已向前推进，并且本地 `lastEventSeqByWorkspace` 已至少推进到该 cursor 时：
     - 记录 `replay-incomplete` lifecycle event；
     - 记录 `replay-continuation-requested` lifecycle event；
     - 设置 `reconnectDelayOverrideMs = 0`；
     - 主动关闭当前 socket，让现有 reconnect 流程立即用最新 `lastEventSeqByWorkspace` 作为 `afterSeq` 打开下一条 workspace stream。
   - 这样可以通过多次 websocket reconnect 分页补齐超过单次 `workspaceReplayLimit` 的 replay 内容。

3. **stalled / retention gap 防循环保护**
   - 当 `complete=false` 但 `nextAfterSeq` 没有向前推进，或本地 cursor 未确认推进时，不会盲目关闭 socket，避免无限 reconnect loop。
   - 此时记录 `replay-incomplete-stalled` lifecycle event。
   - 如果 `afterSeq + 1 < oldestSeq`，metadata 中会标记 `retentionGap=true`，供 diagnostics 判断该缺口可能已无法通过 replay 完整恢复。

4. **seq gap recovery 也改为立即重连**
   - `requestWorkspaceStreamSeqRecovery` 现在会设置 `reconnectDelayOverrideMs = 0`。
   - 因此真实 seq gap 被检测到后，socket close 后的下一次 reconnect 不再等待常规 1s/2s/5s backoff，而是尽快恢复，降低用户可见延迟。

### 21.2 新增测试覆盖

`frontend/src/hooks/useWorkspaceStream.test.ts` 新增覆盖：

- replay completion `complete=false` 且 cursor 已推进时：
  - 先 flush replay delta；
  - 更新 `lastEventSeqByWorkspace`；
  - 记录 `replay-incomplete` / `replay-continuation-requested`；
  - 设置 immediate reconnect override；
  - 关闭 socket。
- replay completion `complete=false` 但无可继续 cursor 时：
  - 记录 `replay-incomplete-stalled`；
  - 不关闭 socket，避免重连循环。
- replay completion `complete=true` 时：
  - 记录 `replay-completed`；
  - 不触发 reconnect。

### 21.3 本次验证结果

前端相关测试：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts session-store.test.ts threadLiveState.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts
```

结果：8 个测试文件、117 个测试用例全部通过。

前端 i18n 检查：

```powershell
cd frontend
npm run i18n:check
```

结果：通过，扫描文件 423，问题数量 0，影响文件 0。

前端 build：

```powershell
cd frontend
npm run build
```

结果：通过。

### 21.4 当前状态更新

第 20 节中“Replay incomplete 只能报告但不能继续”的问题已被**部分解决**：

- 对于 replay limit 导致的 incomplete，只要 replay cursor 能向前推进，前端现在会自动关闭 socket 并立即 reconnect，从最新 `lastEventSeqByWorkspace` 继续请求下一页。
- 对于 retention gap 或 replay cursor 无法前进的场景，前端会记录 stalled 状态，但仍没有用户可见 degraded UI 或 snapshot fallback。

因此，批次 4 当前可更新为：

```txt
批次 4：基础 seq/gap 检测 + coalesced coverage + replay completed metadata + reconnect-based replay continuation 已阶段性完成。
```

### 21.5 仍未完成的事项

本批次没有改变以下剩余缺口：

1. **Retention gap 的最终恢复策略**
   - 仍缺少前端 degraded UI；
   - 仍缺少 snapshot fallback 或强制 thread detail refresh 策略；
   - `replay-incomplete-stalled` 目前主要作为 diagnostics/lifecycle 信号。

2. **显式 dropped control event**
   - `workspace/events/dropped` 仍只是协议预留和 sequencing 排除；
   - subscriber drop 时尚未可靠下发不可丢弃控制事件。

3. **BroadcastChannel follower recovery**
   - follower 检测本地 gap 后仍不能主动要求 leader replay，也不能自动升级 direct recovery。

4. **Optimistic send `clientTurnRequestId`**
   - 仍未实现 HTTP / stream echo 与 pending turn 匹配。

5. **真实浏览器端到端验证**
   - 本轮仍以单元测试、i18n 检查和 build 为主；
   - 尚未记录浏览器中模拟断线、大 gap、多 tab follower 的手动验证。

---

## 22. `workspace/events/dropped` 控制事件实施记录（2026-05-12）

本节记录在 Replay incomplete 自动续页之后继续推进的 stream backpressure recovery 实施。该批次聚焦第 20.4 / 第 21.5 中仍未闭环的 **explicit dropped event control message**：当后端 subscriber 因 soft limit / hard limit / hard eviction 发生事件丢失时，前端不能只依赖后续 seq gap 才发现问题，而应尽快收到一个不参与业务 seq 的控制事件并立即进入 reconnect/replay 恢复路径。

### 22.1 已实施内容

1. **后端 backpressure 结果携带丢失上下文**
   - `subscriberBackpressureResult` 从单一 `dropped bool` 扩展为：
     - `dropped`：当前 incoming event 被直接丢弃；
     - `evicted`：队列中的既有 droppable event 被 hard eviction；
     - `droppedEvent`：实际丢失或被驱逐的 event；
     - `reason`：`soft` / `hard` / `hard-evicted` / `closed`；
     - `merged`：保持既有 coalescing 语义。
   - 新增 `hasLoss()`，统一判断 `dropped || evicted`，避免 hard eviction 场景遗漏控制事件。

2. **后端在 subscriber loss 后追加 `workspace/events/dropped` 控制事件**
   - `Hub.Publish` 对 workspace subscriber 与 global subscriber 分别判断 backpressure loss；
   - 发生 loss 时调用 `buildWorkspaceEventsDroppedEvent(...)` 构造控制事件，并通过 `enqueueDroppedControlEvent(...)` 放入对应 subscriber 队列；
   - 控制事件不经过 `Publish` 再入主流程，避免递归发布、避免写入 workspace event store，也避免污染 thread projection。

3. **控制事件 payload 包含恢复诊断所需元数据**
   - `droppedMethod`：丢失 event 的 method；
   - `dropCount`：同一 subscriber 队列内合并后的丢失计数；
   - `reason`：丢失原因；
   - `subscriberId` / `subscriberRole` / `subscriberScope` / `subscriberSource`：定位是 workspace stream leader、global worker 还是其它订阅者；
   - `seq` / `fromSeq` / `toSeq`：丢失 event 的 seq 覆盖范围；
   - `threadId` / `turnId`：若原 event 具备线程/turn 上下文则一并带上。

4. **控制事件保持 unsequenced**
   - `shouldSequenceWorkspaceEvent` 已排除 `workspace/events/dropped`；
   - 控制事件 `Seq` 保持 0，不推进前端 `lastEventSeqByWorkspace`；
   - 前端恢复仍以业务 event seq 为准，避免控制事件本身制造新的 gap 或误导 resume cursor。

5. **控制事件在队列内合并，避免二次 backpressure**
   - `enqueueDroppedControlEvent` 会优先查找同 workspace 已排队的 `workspace/events/dropped`；
   - 若存在，则只递增 `dropCount` 并更新时间戳，不重复追加大量控制事件；
   - 若不存在且队列已到 hard limit，会优先驱逐 droppable queued event，为控制事件腾出位置；
   - 该策略避免“每次 soft drop 都追加一个 control event”导致控制事件本身挤压关键事件。

6. **前端消费 `workspace/events/dropped`**
   - `handleWorkspaceStreamEvent` 在普通 event ingest / broadcast 前识别 `workspace/events/dropped`；
   - 前端收到后：
     - 不进入 `session-store.ingestEvent`；
     - 不通过 BroadcastChannel 继续广播；
     - 不推进 `lastEventSeqByWorkspace`；
     - 记录 `events-dropped` lifecycle event；
     - 设置 `reconnectDelayOverrideMs = 0`；
     - 关闭当前 socket，使下一次 reconnect 立即基于当前业务 `lastEventSeqByWorkspace` 请求 replay。

### 22.2 新增与修复的测试覆盖

后端新增/强化：

- `TestSubscriberEnqueuesDroppedControlEventAfterSoftDrop`
  - 验证 soft drop 后可以构造并入队 `workspace/events/dropped`；
  - 验证控制事件不带业务 seq；
  - 验证 payload 中包含 `droppedMethod`、`reason`、`seq/fromSeq/toSeq`。
- `TestSubscriberMergesRepeatedDroppedControlEvents`
  - 验证同一 subscriber 队列中重复 dropped control event 会合并为一个控制事件；
  - 验证 `dropCount` 会递增；
  - 防止未来回退为“大量 dropped control event 挤压 critical event”的实现。
- `TestHubSnapshotReportsWorkspaceAndGlobalSubscriberStats`
  - 修复该测试对 goroutine 调度的隐含依赖；
  - 通过预填 subscriber output buffer 让 command output coalescing 统计稳定可验证，避免 total coalesced byte 断言随机失败。

前端新增/强化：

- `requests immediate recovery when the backend reports dropped workspace events`
  - 验证 `workspace/events/dropped` 返回 `false`，不会被普通 ingest / broadcast；
  - 验证 `lastEventSeqByWorkspace` 不推进；
  - 验证 socket 被关闭且 `reconnectDelayOverrideMs = 0`；
  - 验证 lifecycle 最新事件为 `events-dropped`，metadata 包含 dropped method、reason 与 seq coverage。

### 22.3 本次验证结果

后端格式化与测试：

```powershell
cd backend
gofmt -w internal/events/hub.go internal/events/hub_test.go
go test ./internal/events -run TestHubSnapshotReportsWorkspaceAndGlobalSubscriberStats -count=10
go test ./internal/events ./internal/store ./internal/api
```

结果：通过。

前端相关测试：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts session-store.test.ts threadLiveState.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts
```

结果：8 个测试文件、118 个测试用例全部通过。

前端 i18n 检查：

```powershell
cd frontend
npm run i18n:check
```

结果：通过，扫描文件 423，问题数量 0，影响文件 0；未修改 i18n 白名单。

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

### 22.4 当前状态更新

第 20 节与第 21 节中标记为未完成的 **显式 dropped control event** 已完成阶段性闭环：

```txt
后端 subscriber drop / eviction
  -> workspace/events/dropped control event
  -> 前端 events-dropped lifecycle diagnostic
  -> 立即 close socket
  -> reconnect/replay 使用当前业务 lastEventSeqByWorkspace 补齐
```

该批次与第 21 节 replay continuation 组合后，当前 P0 stream recovery 能覆盖更多故障路径：

- live seq gap：前端检测到 gap 后立即 reconnect；
- replay 超过单页 limit：`workspace/replay/completed.complete=false` 且 cursor 前进时自动续页；
- subscriber backpressure drop：后端主动下发 `workspace/events/dropped`，前端立即 reconnect；
- coalesced delta：通过 `coversSeqFrom/coversSeqTo/coalesced` 避免误判 gap。

### 22.5 仍未完成的事项

本批次仍未改变以下剩余缺口：

1. **Retention gap 的最终恢复策略**
   - 当前能记录 `replay-incomplete-stalled` 与 `retentionGap=true`；
   - 仍缺少用户可见 degraded UI；
   - 仍缺少自动 snapshot fallback / 强制 thread detail refresh / command session snapshot reconciliation 的完整策略。

2. **BroadcastChannel follower recovery**
   - leader 的 socket gap 与 dropped control recovery 已增强；
   - follower 若因为本地 BroadcastChannel 丢消息而落后，仍缺少主动向 leader 请求按 follower cursor replay 或临时 direct recovery 的协议。

3. **Optimistic send `clientTurnRequestId`**
   - 仍未实现 HTTP / stream echo 与 pending turn 精确匹配；
   - HTTP response 与 websocket event race 的最终消重和确认机制仍需后续批次。

4. **真实浏览器端到端验证**
   - 仍建议后续使用真实页面验证：
     - workspace/thread 页面发送消息；
     - 模拟 websocket 断开重连；
     - 模拟 replay 超单页；
     - 模拟 subscriber drop；
     - 多 tab follower 落后场景。

---

## 23. BroadcastChannel follower recovery 实施记录（2026-05-12）

本节记录在第 22 节 `workspace/events/dropped` 控制事件之后继续推进的多标签页一致性修复。该批次聚焦第 22.5 中仍未闭环的 **BroadcastChannel follower recovery**：当非 leader 标签页通过 BroadcastChannel 接收 leader 转播事件时，如果本地因为浏览器调度、BroadcastChannel 消息丢失或标签页挂起导致 seq 落后，follower 需要主动请求 leader 以 follower 的 cursor 重新 replay，而不是只记录 gap 后停留在 stale 状态。

### 23.1 问题背景

当前 workspace stream 为减少多标签页重复 WebSocket，采用：

```txt
leader tab
  -> 连接后端 workspace websocket
  -> ingest 本地 session store
  -> 通过 BroadcastChannel 转播 server event

follower tab
  -> 不直接连接后端 websocket
  -> 只消费 BroadcastChannel event
```

在第 21 / 第 22 节之前，leader 的 socket gap、replay incomplete、subscriber dropped 都已具备恢复能力。但 follower 存在独立风险：

```txt
follower 本地 lastSeq = 5
leader 已转播 seq 6、7，但 follower 因标签页挂起/消息丢失未收到
leader 后续转播 seq 8
follower 检测到 expected=6 received=8
```

此时 follower 没有自己的 socket，旧逻辑只能：

- 不 ingest gap event；
- 记录 `seq-gap-detected`；
- 尝试 close 一个不存在的 socket；
- 无法触发后端 replay。

结果是 follower 页面可能长期 stale，直到用户刷新页面或标签页重新成为 leader。

### 23.2 已实施内容

1. **BroadcastChannel 协议新增 `recovery-request` 消息**

在 `frontend/src/lib/workspace-stream-broadcast.ts` 中新增 BroadcastChannel message 类型：

```ts
{
  type: 'recovery-request'
  workspaceId: string
  instanceId: string
  ts: number
  afterSeq: number
  expectedSeq: number
  receivedSeq: number
  method?: string | null
  threadId?: string | null
  turnId?: string | null
}
```

其中：

- `afterSeq` 是 follower 当前确认连续应用的业务 seq；
- `expectedSeq` / `receivedSeq` 记录 gap 范围；
- `method` / `threadId` / `turnId` 用于 diagnostics 定位。

2. **follower 检测 gap 后请求 leader replay**

`requestWorkspaceStreamSeqRecovery(...)` 现在区分 leader 与 follower：

- leader / direct stream：保持原逻辑，立即 close socket，触发 reconnect/replay；
- follower 且存在 BroadcastChannel：不再尝试关闭不存在的 socket，而是发送 `recovery-request`。

follower recovery request 会记录 lifecycle：

```txt
follower-recovery-requested
```

并带上：

```txt
afterSeq
expectedSeq
receivedSeq
leaderId
method
threadId
turnId
```

3. **follower recovery request 增加冷却去重**

为避免 follower 在 leader replay 尚未开始前对每个后续 gap event 都发送请求，新增 1 秒冷却：

```ts
const workspaceFollowerRecoveryRequestCooldownMs = 1_000
```

同一 `afterSeq` 在冷却窗口内只发送一次 `recovery-request`。

4. **leader 接收 request 后使用 follower cursor 重连**

`useWorkspaceStream.ts` 新增可测试的 BroadcastChannel message handler：

```ts
handleWorkspaceStreamBroadcastMessage(...)
```

leader 收到 `recovery-request` 后：

- 校验自身是 leader；
- 读取 follower 请求的 `afterSeq`；
- 设置：

```ts
stream.replayAfterSeqOverride = requestedAfterSeq
stream.reconnectDelayOverrideMs = 0
```

- 清理已有 reconnect timer；
- 若 socket active，则关闭 socket；
- 若 socket 已不存在，则立即 schedule reconnect。

leader 记录 lifecycle：

```txt
follower-recovery-accepted
```

5. **leader 下次打开 WebSocket 时使用 follower cursor**

`openWorkspaceSocket(...)` 现在会消费一次性：

```ts
stream.replayAfterSeqOverride
```

构造 WebSocket URL 时优先使用该值作为 `afterSeq`，即使 leader 自身本地 `lastEventSeqByWorkspace` 已经更高。

这使 leader 可以作为 recovery broadcaster：

```txt
follower lastSeq=5
leader lastSeq=12
follower 请求 afterSeq=5
leader 重新打开 websocket：?afterSeq=5
后端 replay seq 6..12
leader 对本地重复 seq 可安全跳过
leader 仍会把 replay events 通过 BroadcastChannel 转播
follower ingest replay events 后补齐
```

6. **避免恢复 replay 影响 leader 自身状态**

leader 本地已经应用过的 replay event 会被 `session-store` 以 `seq <= currentLastSeq` 跳过，不会重复推进 projection；但 `handleWorkspaceStreamEvent` 仍会返回 `true`，使 leader 能继续把 replay event 转播给 follower。

因此该方案不会破坏 leader 自身状态，同时可恢复 follower。

### 23.3 新增测试覆盖

`frontend/src/hooks/useWorkspaceStream.test.ts` 新增覆盖：

1. **follower gap 触发 recovery-request**
   - follower 本地 `lastSeq=5`；
   - 收到 broadcast event `seq=8`；
   - 不 ingest；
   - BroadcastChannel `postMessage` 发送：

```txt
type = recovery-request
afterSeq = 5
expectedSeq = 6
receivedSeq = 8
method = item/agentMessage/delta
```

   - lifecycle 包含：

```txt
seq-gap-detected
follower-recovery-requested
```

2. **重复 follower request 冷却去重**
   - 同一 cursor 在冷却窗口内多次 gap；
   - 只发送一次 `recovery-request`。

3. **leader 接收 recovery-request 后准备重连**
   - leader active socket 收到 request；
   - 设置 `replayAfterSeqOverride=5`；
   - 设置 `reconnectDelayOverrideMs=0`；
   - 关闭当前 socket；
   - lifecycle 记录 `follower-recovery-accepted`。

4. **leader 下一次 WebSocket path 使用 follower cursor**
   - leader 自身本地 `lastSeq=12`；
   - follower request `afterSeq=5`；
   - 下次打开的 WebSocket URL 包含：

```txt
afterSeq=5
streamClientRole=leader
```

   - `replayAfterSeqOverride` 被一次性消费并清空。

### 23.4 本次验证结果

前端局部测试：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts
```

结果：1 个测试文件、14 个测试用例全部通过。

前端相关回归测试：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts session-store.test.ts threadLiveState.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts
```

结果：8 个测试文件、122 个测试用例全部通过。

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

前端 i18n 检查：

```powershell
cd frontend
npm run i18n:check
```

结果：通过，扫描文件 423，问题数量 0，影响文件 0；未修改 i18n 白名单。

后端回归测试：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api
```

结果：通过。

### 23.5 当前状态更新

第 22.5 中的 **BroadcastChannel follower recovery** 已完成阶段性闭环：

```txt
follower 检测 broadcast event seq gap
  -> 不 ingest gap event
  -> 发送 recovery-request(afterSeq=followerLastSeq)
  -> leader 接收 request
  -> leader 用 follower cursor 立即重连
  -> 后端 replay 缺失范围
  -> leader 转播 replay events
  -> follower 补齐
```

当前 workspace stream recovery 覆盖面更新为：

- leader live seq gap：完成；
- replay incomplete 自动续页：完成；
- subscriber backpressure dropped control event：完成；
- BroadcastChannel follower seq gap：完成；
- coalesced delta coverage：完成；
- retention gap degraded UI / snapshot fallback：仍未完成；
- optimistic send `clientTurnRequestId`：仍未完成。

### 23.6 仍未完成的事项

1. **Retention gap 的最终恢复策略**
   - 仍缺少用户可见 degraded UI；
   - 仍缺少自动 snapshot fallback / 强制 thread detail refresh / command session snapshot reconciliation；
   - 当前 `replay-incomplete-stalled` 与 `retentionGap=true` 仍主要作为 diagnostics 信号。

2. **Optimistic send `clientTurnRequestId`**
   - 仍未实现 HTTP / stream echo；
   - pending optimistic turn 仍无法通过 client request id 精确匹配真实 turn；
   - HTTP 失败但 stream 已开始的 race 仍需后续批次处理。

3. **真实浏览器端到端验证**
   - 本轮通过单测和构建验证协议；
   - 后续仍建议使用真实浏览器多标签页验证：
     - 打开两个同 workspace/thread 页面；
     - follower 人为落后或暂停；
     - leader 继续接收事件；
     - follower 检测 gap 后能通过 request 补齐。

---

## 24. Retention gap / stalled replay snapshot fallback 实施记录（2026-05-12）

本节记录在第 23 节 BroadcastChannel follower recovery 之后继续推进的最终兜底恢复能力。该批次聚焦第 23.6 中仍未闭环的 **Retention gap 的最终恢复策略**：当后端 workspace event retention 已无法覆盖前端所需缺口，或者 `workspace/replay/completed.complete=false` 但 replay cursor 无法继续前进时，前端不能只停留在 lifecycle diagnostics，而应主动触发 HTTP snapshot fallback，使 thread detail、thread list、approvals、command sessions 等查询重新对齐后端快照。

### 24.1 问题背景

第 21 节已经实现 replay incomplete 自动续页：

```txt
workspace/replay/completed complete=false
  -> cursor 已前进
  -> immediate reconnect
  -> 用最新 lastEventSeqByWorkspace 继续 replay 下一页
```

但仍存在不可通过 replay 完整恢复的场景：

1. **retention gap**

```txt
前端 afterSeq = 5
后端 oldestSeq = 8
说明 seq 6~7 已超出 retention，无法 replay
```

即使后续能从 seq 8 继续 replay 到 head，前端 projection 仍可能缺少 seq 6~7 对应的 delta / lifecycle / command output。

2. **stalled replay**

```txt
complete=false
nextAfterSeq 没有前进
或 currentSeq 没有推进到 nextAfterSeq
```

此时继续 reconnect 可能形成死循环，因此第 21 节仅记录 `replay-incomplete-stalled`，但没有主动刷新快照。

### 24.2 已实施内容

1. **新增 workspace stream recovery DOM event**

新增文件：

```txt
frontend/src/lib/workspace-stream-recovery.ts
```

新增事件名：

```ts
export const WORKSPACE_STREAM_RECOVERY_REQUIRED_EVENT =
  'codex-server-workspace-stream-recovery-required'
```

新增 detail 类型：

```ts
export type WorkspaceStreamRecoveryRequiredDetail = {
  workspaceId: string
  reason: 'replay-incomplete-stalled' | 'replay-retention-gap'
  afterSeq?: number | null
  currentSeq?: number | null
  fromSeq?: number | null
  headSeq?: number | null
  limit?: number | null
  nextAfterSeq?: number | null
  oldestSeq?: number | null
  replayed?: number | null
  threadId?: string | null
  toSeq?: number | null
  turnId?: string | null
}
```

该事件作为 stream 层与 React Query 层之间的低耦合桥梁：

```txt
useWorkspaceStream
  -> 发现 replay 无法保证完整补齐
  -> dispatch WORKSPACE_STREAM_RECOVERY_REQUIRED_EVENT

WorkspaceStreamRecoveryQuerySync
  -> 监听事件
  -> invalidate snapshot query families
```

2. **`workspace/replay/completed` retention gap 触发 snapshot fallback**

修改文件：

```txt
frontend/src/hooks/useWorkspaceStream.ts
```

当 replay completion payload 满足：

```ts
afterSeq !== null &&
oldestSeq !== null &&
afterSeq + 1 < oldestSeq
```

时，前端现在会：

- 记录原有 `replay-incomplete`；
- 记录新增 lifecycle：

```txt
snapshot-fallback-requested
```

- dispatch recovery required event：

```txt
reason = replay-retention-gap
```

- 如果 cursor 仍可前进，则继续执行原有 immediate reconnect continuation。

也就是说，retention gap 场景现在同时具备：

```txt
snapshot fallback
  + replay continuation
```

这样可以：

- 用 HTTP snapshot 弥补 retention 已丢失的旧缺口；
- 用 replay continuation 继续追上 head。

3. **`replay-incomplete-stalled` 触发 snapshot fallback**

当 `complete=false` 但不能继续 replay 时，前端现在会：

- 记录 `replay-incomplete-stalled`；
- 记录 `snapshot-fallback-requested`；
- dispatch recovery required event：

```txt
reason = replay-incomplete-stalled
```

此时不关闭 socket，仍避免 reconnect loop；但会通过 query invalidation 让 HTTP snapshot 接管恢复。

4. **新增全局 Query Sync**

新增文件：

```txt
frontend/src/features/workspace-stream/WorkspaceStreamRecoveryQuerySync.tsx
```

并在 Provider 层挂载：

```txt
frontend/src/app/providers.tsx
```

挂载位置：

```tsx
<WorkspaceApprovalsQuerySync />
<WorkspaceStreamRecoveryQuerySync />
<ToastHost />
```

5. **snapshot fallback invalidation 范围**

收到 recovery required event 后，会 invalidate 以下 query families：

```txt
['threads', workspaceId]
['shell-threads', workspaceId]
['loaded-threads', workspaceId]
['thread-detail', workspaceId]
['approvals', workspaceId]
['command-sessions', workspaceId]
['workspace-hook-configuration', workspaceId]
['hook-runs', workspaceId]
['turn-policy-decisions', workspaceId]
['turn-policy-metrics', workspaceId]
```

覆盖目标：

- thread list / shell tree；
- loaded threads；
- 当前或已缓存 thread detail；
- approvals；
- command session snapshot；
- hook configuration / hook runs；
- turn policy decisions / metrics。

其中 `['thread-detail', workspaceId]` 使用 query prefix，使同 workspace 下已缓存或 active 的 thread detail 都能被刷新，而不依赖 stream control event 必须携带 threadId。

### 24.3 新增测试覆盖

1. `frontend/src/hooks/useWorkspaceStream.test.ts`

新增覆盖：

- **stalled replay 触发 snapshot fallback**
  - `complete=false`；
  - `nextAfterSeq` 无前进；
  - 不关闭 socket；
  - 记录 `snapshot-fallback-requested`；
  - dispatch `codex-server-workspace-stream-recovery-required`；
  - detail 包含：

```txt
reason = replay-incomplete-stalled
workspaceId
afterSeq
currentSeq
```

- **retention gap 在继续 replay 的同时触发 snapshot fallback**
  - `afterSeq + 1 < oldestSeq`；
  - dispatch：

```txt
reason = replay-retention-gap
```

  - 同时保留原有 replay continuation 行为：

```txt
reconnectDelayOverrideMs = 0
socket.close()
```

2. `frontend/src/features/workspace-stream/WorkspaceStreamRecoveryQuerySync.test.tsx`

新增覆盖：

- recovery query sync 会 invalidate workspace/thread snapshot fallback query families；
- 空 workspaceId 会被忽略，避免误触发全局无效 query。

### 24.4 本次验证结果

前端局部测试：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts WorkspaceStreamRecoveryQuerySync.test.tsx
```

结果：2 个测试文件、17 个测试用例全部通过。

前端相关回归测试：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts WorkspaceStreamRecoveryQuerySync.test.tsx session-store.test.ts threadLiveState.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts
```

结果：9 个测试文件、125 个测试用例全部通过。

前端 i18n 检查：

```powershell
cd frontend
npm run i18n:check
```

结果：通过，扫描文件 425，问题数量 0，影响文件 0；未修改 i18n 白名单。

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

后端回归测试：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api
```

结果：通过。

### 24.5 当前状态更新

第 23.6 中的 **Retention gap 的最终恢复策略** 已完成 snapshot fallback 层面的阶段性闭环：

```txt
replay retention gap / stalled replay
  -> snapshot-fallback-requested lifecycle diagnostic
  -> dispatch workspace stream recovery required event
  -> Provider 层 Query Sync invalidates snapshot queries
  -> React Query 重新获取 HTTP 快照
  -> thread/detail/command/approval 等状态对齐后端
```

当前 workspace/thread 数据同步恢复能力更新为：

- leader live seq gap：完成；
- replay incomplete 自动续页：完成；
- subscriber dropped control event：完成；
- BroadcastChannel follower seq gap：完成；
- replay retention gap snapshot fallback：完成；
- replay stalled snapshot fallback：完成；
- coalesced delta coverage：完成；
- 用户可见 degraded UI：仍未完成；
- optimistic send `clientTurnRequestId`：已在第 25 节完成阶段性闭环；
- 真实浏览器 E2E：仍未完成。

### 24.6 仍未完成的事项

1. **用户可见 degraded UI**
   - 当前会记录 lifecycle diagnostic，并触发 snapshot fallback；
   - 但 thread 页面尚未展示“正在恢复 / 已从快照恢复 / 部分历史事件可能缺失”的用户可见提示；
   - 如需产品层可见性，可在 thread/workspace 页面消费 diagnostics 或新增 session state banner。

2. **Optimistic send `clientTurnRequestId`**
   - 第 25 节已完成 HTTP request id、HTTP response echo、`turn/started` stream echo、pending/live turn 匹配与 HTTP failure confirmation window；
   - 后续如需进一步强化，可将该 request id 扩展到更长周期的 telemetry / debug UI 中。

3. **真实浏览器端到端验证**
   - 本轮通过单测、构建、i18n 和后端包测试；
   - 仍建议使用真实浏览器验证 retention gap / stalled replay 时是否按预期触发 query refetch 与页面快照回填。

## 25. Optimistic send `clientTurnRequestId` 实施记录（2026-05-12）

### 25.1 本轮实施目标

本轮继续沿 `workspace/thread` 数据同步审查计划推进，聚焦用户输入发送路径中的 optimistic UI 与后端事件竞态：

```txt
用户提交输入
  -> 前端创建 optimistic pending turn
  -> HTTP POST /turns
  -> 后端 turn/start
  -> runtime 发布 turn/started
  -> WebSocket stream 回到前端
  -> pending turn 与真实 turn 对齐 / 清理
```

本轮要解决的核心问题：

1. **pending turn 缺少稳定跨 HTTP / stream 的关联键**
   - 之前 pending turn 主要依赖 HTTP response 返回的 `turnId`；
   - 如果 `turn/started` 比 HTTP success 更早到达，pending turn 无法准确绑定真实 turn；
   - UI 可能短暂出现独立 pending turn 与真实 live turn 并存。

2. **HTTP failure 与 stream success 的竞态**
   - 如果前端 HTTP 层看到失败，但后端/运行时实际上已经接受并开始 turn；
   - 旧逻辑会立刻清理 optimistic turn、恢复输入并展示发送失败；
   - 这会导致“页面已经在流式渲染，但 composer 显示发送失败”的错误体验。

3. **后端事件缺少 request correlation echo**
   - 后端 `turn/start` request 没有把前端生成的 request id 关联到 `turn/started`；
   - replay / live projection 也无法保留该 request id 供页面匹配。

### 25.2 后端协议实现

涉及文件：

```txt
backend/internal/api/router.go
backend/internal/appserver/types.go
backend/internal/turns/service.go
backend/internal/runtime/protocol_facade.go
backend/internal/runtime/manager.go
```

#### 25.2.1 API request / response echo

`POST /api/workspaces/{workspaceId}/threads/{threadId}/turns` request body 新增：

```json
{
  "input": "...",
  "clientTurnRequestId": "client-turn-..."
}
```

后端 route 将该字段写入：

```go
turns.StartOptions{
  ClientTurnRequestID: request.ClientTurnRequestID,
}
```

`turns.Result` 新增：

```go
ClientTurnRequestID string `json:"clientTurnRequestId,omitempty"`
```

成功响应会 echo：

```json
{
  "turnId": "turn-...",
  "status": "running",
  "clientTurnRequestId": "client-turn-..."
}
```

这样前端即使只收到 HTTP success，也能确认 response 与当前 optimistic pending turn 属于同一次提交。

#### 25.2.2 clientTurnRequestId 保持 server-side，不透传给 runtime JSON-RPC

`appserver.TurnStartRequest` 新增内部字段：

```go
ClientTurnRequestID string `json:"-"`
```

设计理由：

- 当前运行时协议未明确声明需要消费该字段；
- 直接把未知字段发送给 runtime 可能受 schema / unknown field 策略影响；
- 因此 request id 由 server-side manager 维护，不污染 runtime JSON-RPC payload；
- `buildTurnStartPayload` 仍将其写入 diagnostic payload，方便后端 trace / 单测校验。

#### 25.2.3 runtime manager 维护 request id 与 turn/started 的关联

`runtime.instance` 新增两类关联状态：

```go
pendingTurnStartRequests map[string]string // threadId -> clientTurnRequestId
clientTurnRequestsByTurn map[string]string // threadId + turnId -> clientTurnRequestId
```

`Manager.TurnStart(...)` 行为：

1. 发送 runtime request 前：
   - 记录 `threadId -> clientTurnRequestId` pending correlation。
2. runtime response 成功后：
   - 记录 `threadId + turnId -> clientTurnRequestId`；
   - 清理 pending correlation。
3. runtime response 失败：
   - 如果 pending correlation 仍属于本次 request，则清理。
4. 收到 `turn/started` notification：
   - 优先通过 `threadId + turnId` 查找；
   - 若 response 尚未返回，则消费 `threadId -> clientTurnRequestId` pending correlation；
   - 将 request id 写入 event payload 顶层与 nested turn：

```json
{
  "threadId": "thread-1",
  "clientTurnRequestId": "client-turn-1",
  "turn": {
    "id": "turn-runtime-1",
    "status": "inProgress",
    "clientTurnRequestId": "client-turn-1"
  }
}
```

这样同时覆盖两种顺序：

```txt
顺序 A：turn/start response -> turn/started notification
顺序 B：turn/started notification -> turn/start response
```

terminal lifecycle event 到达后，会清理 `clientTurnRequestsByTurn` 中对应 turn 的 correlation，避免长期累积。

### 25.3 前端 request id 与 pending/live turn 对齐

涉及文件：

```txt
frontend/src/features/turns/api.ts
frontend/src/types/api.ts
frontend/src/pages/threadPageTurnHelpers.ts
frontend/src/pages/thread-page/buildThreadPageThreadActions.ts
frontend/src/pages/thread-page/useThreadPageThreadMutations.ts
frontend/src/pages/thread-page/usePendingThreadTurns.ts
frontend/src/pages/thread-page/useThreadPageLifecycleEffects.ts
frontend/src/pages/thread-page/buildThreadPageTurnDisplayState.ts
frontend/src/pages/threadLiveState.ts
```

#### 25.3.1 StartTurnInput / TurnResult 类型扩展

`StartTurnInput` 新增：

```ts
clientTurnRequestId?: string
```

`TurnResult` 新增：

```ts
clientTurnRequestId?: string
```

`ThreadTurn` 新增：

```ts
clientTurnRequestId?: string
```

#### 25.3.2 前端生成稳定 request id

`threadPageTurnHelpers.ts` 新增：

```ts
createClientTurnRequestId()
```

生成策略：

- 优先使用 `crypto.randomUUID()`；
- fallback 为 `client-turn-${Date.now()}-${counter}`；
- pending turn 的 `localId` 复用同一个 request id，确保 optimistic UI item key 与 request correlation 一致。

`PendingThreadTurn` 新增：

```ts
clientTurnRequestId?: string
```

发送普通 thread input 时：

```ts
const clientTurnRequestId = createClientTurnRequestId()
const optimisticTurn = createPendingTurn(
  selectedThreadId,
  trimmedInput,
  clientTurnRequestId,
)

startTurnMutation.mutateAsync({
  threadId: selectedThreadId,
  input: trimmedInput,
  clientTurnRequestId,
  ...
})
```

#### 25.3.3 useThreadPageThreadMutations 保留 request id

`startTurnMutation` 之前 destructure 变量时未包含新增字段，本轮修复为：

```ts
mutationFn: ({
  threadId,
  input,
  clientTurnRequestId,
  ...
}) =>
  startTurn(workspaceId, threadId, {
    input,
    clientTurnRequestId,
    ...
  })
```

这避免 action 层构造的 id 在 mutation 层被丢弃。

#### 25.3.4 live projection 保留 clientTurnRequestId

`threadLiveState.ts` 在处理 `turn/started` / terminal lifecycle events 时读取：

```ts
turn.clientTurnRequestId || payload.clientTurnRequestId
```

并写入 `ThreadTurn.clientTurnRequestId`。

同时，后续 `item/started`、`item/completed`、delta 等通过 `updateTurnItem(...)` 更新 turn 时，会保留已存在的 `clientTurnRequestId`，避免生命周期事件后又被 item event 覆盖丢失。

#### 25.3.5 pending turn 与 live turn 的匹配规则

`useThreadPageLifecycleEffects.ts` 新增纯函数：

```ts
pendingTurnMatchesLiveTurn(pendingTurn, liveTurn)
findMatchingLiveTurnForPendingTurn(pendingTurn, liveThreadTurns)
```

匹配优先级：

1. `pendingTurn.turnId === liveTurn.id`
2. `pendingTurn.clientTurnRequestId === liveTurn.clientTurnRequestId`

这解决了 `turn/started` 先于 HTTP success 到达时，pending turn 无法通过 turnId 匹配的问题。

#### 25.3.6 display 层避免 pending/live 双 turn

`buildThreadPageTurnDisplayState.ts` 之前只有 `pendingTurn.turnId` 命中时才会把 optimistic user message 注入真实 turn；否则会 append 一个独立 pending turn。

本轮改为：

```txt
if pending.turnId matches live turn id:
  inject pending user message into live turn
else if pending.clientTurnRequestId matches live turn.clientTurnRequestId:
  inject pending user message into live turn
else:
  append standalone pending turn
```

效果：

- stream turn 已出现但 HTTP response 尚未返回时；
- 页面不会出现“真实 streaming turn + 独立 pending turn”的双 turn；
- optimistic user message 会正确补入真实 live turn 前部。

#### 25.3.7 HTTP failure confirmation window

`buildThreadPageThreadActions.ts` 在 `startTurnMutation` 抛错后，不再立即清理 optimistic turn，而是等待一个短确认窗口：

```txt
OPTIMISTIC_TURN_FAILURE_CONFIRMATION_WINDOW_MS = 1000
```

窗口结束后检查：

```ts
getPendingTurn(threadId)?.localId !== optimisticTurn.localId
```

若 pending turn 已被 lifecycle / stream reconciliation 清理，说明 stream 已经确认该 turn 开始，HTTP error 是 stale / transport 层竞态：

- 不恢复 composer 输入；
- 不展示发送失败；
- 触发 account / thread detail / thread list query invalidation；
- 将本次提交视为已被 stream 确认。

若 pending turn 仍是同一个 optimistic turn，则按原失败路径处理：

- 清理 pending turn；
- 恢复 composer 输入与 caret；
- 捕获 recoverable runtime action；
- 展示错误；
- invalidate thread / runtime state。

`usePendingThreadTurns.ts` 为此新增：

```ts
getPendingTurn(threadId)
```

并用 `useRef` 同步维护 pending turns 的最新快照，避免 async callback 只能看到过期闭包。

### 25.4 新增 / 更新测试覆盖

#### 25.4.1 后端测试

```txt
backend/internal/turns/service_test.go
backend/internal/runtime/manager_test.go
backend/internal/api/router_test.go
```

新增覆盖：

1. `buildTurnStartPayload` diagnostic payload 包含 `clientTurnRequestId`；
2. `appserver.TurnStartRequest` 的 `clientTurnRequestId` 不会进入 runtime JSON-RPC JSON；
3. `Manager.TurnStart` 会把 server-side request id 写入 `turn/started` event 顶层与 nested turn；
4. API route 会：
   - 接收 request body `clientTurnRequestId`；
   - HTTP response echo `clientTurnRequestId`；
   - `turn/started` stream event echo `clientTurnRequestId`；
   - runtime fake 收到的 `turn/start` payload 不包含该字段。

#### 25.4.2 前端测试

```txt
frontend/src/pages/thread-page/buildThreadPageThreadActions.test.ts
frontend/src/pages/thread-page/useThreadPageLifecycleEffects.test.ts
frontend/src/pages/thread-page/buildThreadPageTurnDisplayState.test.ts
frontend/src/pages/threadLiveState.test.ts
```

新增覆盖：

1. optimistic pending turn 与 start request 使用同一个 `clientTurnRequestId`；
2. stream reconciliation 已清理 optimistic turn 时，会抑制 stale HTTP send error；
3. pending/live turn 可通过 `clientTurnRequestId` 匹配；
4. unrelated request id 不会误匹配；
5. display state 可通过 request id 把 optimistic user message 注入 live turn，避免双 turn；
6. live projection 会从 `turn/started` 保存 `clientTurnRequestId`，并在后续 item event 中保留。

### 25.5 本次验证结果

后端局部验证：

```powershell
cd backend
go test ./internal/turns ./internal/runtime ./internal/api
```

结果：通过。

后端相关回归验证：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api ./internal/turns ./internal/runtime
```

结果：通过。

前端局部验证：

```powershell
cd frontend
npm test -- buildThreadPageThreadActions.test.ts useThreadPageLifecycleEffects.test.ts buildThreadPageTurnDisplayState.test.ts threadLiveState.test.ts
```

结果：4 个测试文件、85 个测试用例全部通过。

前端相关回归验证：

```powershell
cd frontend
npm test -- buildThreadPageThreadActions.test.ts useThreadPageLifecycleEffects.test.ts buildThreadPageTurnDisplayState.test.ts threadLiveState.test.ts useWorkspaceStream.test.ts WorkspaceStreamRecoveryQuerySync.test.tsx session-store.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts
```

结果：12 个测试文件、159 个测试用例全部通过。

前端 i18n 检查：

```powershell
cd frontend
npm run i18n:check
```

结果：通过，扫描文件 425，问题数量 0，影响文件 0；本轮未新增 UI 文案，未修改 i18n 白名单。

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

### 25.6 当前状态更新

截至本节完成后，workspace/thread 数据同步修复状态如下：

- leader live seq gap：完成；
- replay incomplete 自动续页：完成；
- subscriber dropped control event：完成；
- BroadcastChannel follower seq gap：完成；
- replay retention gap snapshot fallback：完成；
- replay stalled snapshot fallback：完成；
- coalesced delta coverage：完成；
- optimistic send `clientTurnRequestId`：完成阶段性闭环；
- HTTP failure / stream success 竞态：完成 1000ms confirmation window 的低风险缓解；
- 用户可见 degraded UI：仍未完成；
- 真实浏览器 E2E：仍未完成。

### 25.7 剩余风险与后续建议

1. **真实浏览器 E2E 仍建议补充**
   - 当前已通过单测 / 构建验证；
   - 仍建议在真实浏览器中模拟：
     - stream turn/started 早于 HTTP response；
     - HTTP request 失败但 stream 已开始；
     - 多 tab BroadcastChannel leader/follower recovery；
     - retention gap snapshot fallback。

2. **用户可见 degraded / recovery UI**
   - 目前 recovery 主要通过 lifecycle diagnostics 与 query invalidation 完成；
   - 用户侧尚无 banner/toast 明确提示“正在恢复实时连接 / 已回退快照同步”；
   - 若需要产品可见性，可在后续接入 workspace stream diagnostics。

3. **多并发 turn start 的边界**
   - 当前页面交互模型默认单 thread 同一时刻一个 active send；
   - manager 使用 `threadId -> clientTurnRequestId` 记录 pending correlation；
   - 如果未来允许同一 thread 并发多个 turn/start，需要将 pending correlation 扩展为队列或 request token 更强绑定。

## 26. 全功能完整性审查记录（2026-05-12）

### 26.1 审查结论

本次对本文档中已列出的 `workspace / thread` 数据同步、实时渲染与恢复相关功能进行完整性复核。结论如下：

```txt
核心数据同步可靠性能力：已基本实施并通过自动化验证。
全部产品化功能：尚未 100% 完整实施。
```

换言之，当前状态不能简单标记为“所有功能全部完成”。更准确的状态是：

```txt
P0/P1/P2 的核心技术闭环已完成：
  - live seq gap detection / reconnect
  - replay continuation
  - dropped control event
  - follower BroadcastChannel recovery
  - retention/stalled replay snapshot fallback
  - terminal lifecycle events
  - workspace-scoped thread store key
  - UI stale 修复
  - optimistic send clientTurnRequestId

仍未完全闭环：
  - 用户可见 degraded / recovery UI
  - 真实浏览器 E2E
  - P3 产品/维护项，如非 active workspace 全量实时订阅策略、deferredEvents 残留清理、approvals batching future-proof、线程列表排序策略确认
```

第 20~23 节中的部分“未完成”描述是历史复核记录，已被第 21~25 节后续实施逐步覆盖；最终状态以本第 26 节为准。

### 26.2 功能完整性矩阵

| 功能/风险项 | 当前实现状态 | 证据/位置 | 完整性判定 |
| --- | --- | --- | --- |
| Live Feed 面板 memo 依赖遗漏 `surfacePanelView` | 已修复 | `frontend/src/pages/thread-page/useThreadPageDisplayState.ts` | **完成** |
| Terminal xterm content 从非空变空不 reset | 已修复 | `frontend/src/features/thread-terminal/ThreadTerminalViewport.tsx`、测试 | **完成** |
| `turn/failed` / `turn/interrupted` / `turn/canceled` / `turn/cancelled` 前端同步 | 已覆盖 projection、activity、refresh trigger | `frontend/src/pages/threadLiveState.ts`、`frontend/src/stores/session-store.ts`、`frontend/src/pages/threadPageUtils.ts`、测试 | **完成** |
| thread live store 仅用 `threadId` 导致跨 workspace 串数据 | 已改为 workspace/thread composite key，并保留 legacy fallback | `frontend/src/stores/session-store-utils.ts`、`frontend/src/stores/session-store.ts`、`useThreadPageSessionState.ts`、测试 | **完成** |
| 后端 event seq / coverage metadata | 已实现 `seq`、`coversSeqFrom`、`coversSeqTo`、`coalesced` | `backend/internal/store/models.go`、`backend/internal/events/hub.go`、测试 | **完成** |
| `workspace/connected` head/oldest/replay metadata | 已实现 | `backend/internal/api/router.go`、前端 stream 处理 | **完成** |
| leader live seq gap detection | 前端检测 gap 后不 ingest、不 broadcast，立即 reconnect | `frontend/src/hooks/useWorkspaceStream.ts`、测试 | **完成** |
| session-store 绕过 stream handler 的 gap 防线 | 已拒绝非 replay gap event 推进 `lastEventSeqByWorkspace` | `frontend/src/stores/session-store.ts`、测试 | **完成** |
| replay completed control event | 后端发送，前端识别不 ingest、不 broadcast | `backend/internal/api/router.go`、`frontend/src/hooks/useWorkspaceStream.ts`、测试 | **完成** |
| replay incomplete 自动续页 | `complete=false` 且 cursor 前进时 immediate reconnect continuation | `frontend/src/hooks/useWorkspaceStream.ts`、测试 | **完成** |
| replay stalled fallback | `nextAfterSeq` 无前进时触发 snapshot fallback event | `frontend/src/hooks/useWorkspaceStream.ts`、测试 | **完成（数据恢复层）** |
| retention gap fallback | `afterSeq + 1 < oldestSeq` 时触发 snapshot fallback，同时继续 replay | `frontend/src/hooks/useWorkspaceStream.ts`、`frontend/src/lib/workspace-stream-recovery.ts`、测试 | **完成（数据恢复层）** |
| snapshot fallback query invalidation | Provider 层监听 recovery event 并 invalidate thread/workspace 相关 query families | `frontend/src/features/workspace-stream/WorkspaceStreamRecoveryQuerySync.tsx`、`frontend/src/app/providers.tsx`、测试 | **完成** |
| `workspace/events/dropped` control event | 后端 backpressure loss 时入队 control event，前端收到后 immediate reconnect | `backend/internal/events/hub.go`、`frontend/src/hooks/useWorkspaceStream.ts`、测试 | **完成** |
| coalesced command output / token usage coverage | 后端合并事件写 coverage metadata，前端不误判 gap | `backend/internal/events/hub.go`、`frontend/src/hooks/useWorkspaceStream.ts`、`frontend/src/stores/session-store.ts`、测试 | **完成** |
| BroadcastChannel follower seq gap recovery | follower 发现 gap 后发 `recovery-request`，leader 使用 follower cursor reconnect replay | `frontend/src/lib/workspace-stream-broadcast.ts`、`frontend/src/hooks/useWorkspaceStream.ts`、测试 | **完成** |
| optimistic send `clientTurnRequestId` | HTTP request / response echo、stream echo、pending/live 匹配、HTTP failure confirmation window 已完成 | `frontend/src/pages/threadPageTurnHelpers.ts`、`frontend/src/pages/thread-page/buildThreadPageThreadActions.ts`、`backend/internal/runtime/manager.go`、测试 | **完成** |
| HTTP failure 但 stream 已开始的 stale error 抑制 | 新增 1000ms confirmation window，pending 已被 stream 清理则不恢复输入、不报错 | `frontend/src/pages/thread-page/buildThreadPageThreadActions.ts`、测试 | **完成（低风险缓解）** |
| 用户可见 degraded / recovery UI | 目前仅有 lifecycle diagnostics 与 snapshot fallback；thread/workspace 页面未直接展示恢复状态 banner/toast | 代码中未发现面向 thread 页面用户的 stream degraded UI | **未完成** |
| 真实浏览器 E2E | 当前完成单测、构建和后端包测试；未执行浏览器端到端脚本/手工记录 | 无 Playwright/Cypress/Browser 验证记录 | **未完成（验证项）** |
| 非 active workspace 侧边栏状态全量实时 | 当前主要订阅当前 workspace 与通知中心计算出的 live workspaces；未实现所有 workspace 全量实时订阅 | `useWorkspaceStream` / `useWorkspaceStreams` 调用点 | **未完成 / 产品取舍项** |
| `deferredEvents` 残留机制清理 | 仍存在 flush / timer 机制，但未发现 producer push；不影响当前功能，但仍是维护噪音 | `frontend/src/hooks/useWorkspaceStream.ts`、`useWorkspaceStreamTypes.ts` | **未完成 / 维护项** |
| approvals latest-only future-proof | 当前 snapshot/query sync 可用；若未来 event batching 改变，仍建议避免只依赖 latest event | `WorkspaceApprovalsQuerySync`、refresh effects | **部分完成 / 未来风险** |
| 线程列表排序策略 | 未调整，仍属于产品确认项，不属于数据一致性必修复 | threads API / query 使用侧 | **未完成 / 产品确认项** |

### 26.3 自动化验证状态

本次完整性审查复用了第 25 节后的最新验证结果，并确认当前相关代码仍与该结果一致。

后端相关回归：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api ./internal/turns ./internal/runtime
```

结果：通过。

前端相关回归：

```powershell
cd frontend
npm test -- buildThreadPageThreadActions.test.ts useThreadPageLifecycleEffects.test.ts buildThreadPageTurnDisplayState.test.ts threadLiveState.test.ts useWorkspaceStream.test.ts WorkspaceStreamRecoveryQuerySync.test.tsx session-store.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts
```

结果：12 个测试文件、159 个测试用例通过。

前端 i18n：

```powershell
cd frontend
npm run i18n:check
```

结果：通过，扫描文件 425，问题数量 0。本次完整性审查没有新增 UI 文案，也未修改 i18n 白名单。

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

局部 whitespace 检查：

```powershell
git diff --check -- <本轮相关文件>
```

结果：通过。

### 26.4 是否可以宣称“全部完整实施”

不建议宣称“全部完整实施”。

建议对外状态描述为：

```txt
workspace/thread 核心数据同步与自动恢复能力已完成阶段性闭环，并通过相关自动化测试、i18n 检查与构建；
但产品层仍缺少用户可见 degraded/recovery UI，且尚未进行真实浏览器 E2E 验证。
```

如果以“数据正确性 / 及时性 / 自动恢复”为验收标准，当前实现已经覆盖主要高风险路径。

如果以“完整产品体验”为验收标准，仍需继续实施：

1. 用户可见 degraded/recovery UI；
2. 浏览器 E2E 验证；
3. 非 active workspace 的实时订阅产品策略确认；
4. `deferredEvents` 残留清理；
5. approvals batching future-proof；
6. 线程列表排序策略确认。

### 26.5 推荐下一步

推荐继续按以下顺序收敛：

1. **实现用户可见 degraded/recovery UI**
   - 消费 workspace stream lifecycle diagnostics；
   - 在 thread surface 或 header 显示“实时连接恢复中 / 已回退快照同步 / 已恢复”的轻量提示；
   - 文案必须接入 i18n，并执行 `npm run i18n:check`。

2. **补充真实浏览器 E2E**
   - 覆盖 stream gap、replay continuation、dropped control event、snapshot fallback、clientTurnRequestId race。

3. **清理维护项**
   - 删除或真正接入 `deferredEvents`；
   - 审查 approvals sync 是否需要从 latest-only 改为批量事件处理；
   - 明确非 active workspace 是否需要全量 live subscription。

## 27. 用户可见 degraded / recovery UI 与浏览器验证实施记录（2026-05-12）

### 27.1 本轮实施目标

本轮继续补齐第 26 节列出的产品化缺口，重点完成：

1. 在 `workspace / thread` 页面向用户直接展示实时同步降级、恢复中、快照兜底与恢复完成状态；
2. 将提示状态从已有 `workspace stream lifecycle diagnostics` 派生，避免新增一套并行状态机；
3. 保持新增 UI 文案接入现有 i18n 运行时；
4. 补充单元测试与真实浏览器 Playwright 验证；
5. 复核 `deferredEvents` 残留机制，确认其当前风险等级与后续处理策略。

### 27.2 状态派生设计

新增 `WorkspaceStreamRecoveryNotice`，其数据源来自 `getWorkspaceStreamManagerDiagnosticsSnapshot()` 中每个 workspace stream 的：

- `lastKnownConnectionState`；
- `socketState`；
- `reconnectScheduled` / `reconnectAttempt`；
- `latestLifecycleEvent`；
- `recentLifecycleEvents`。

派生规则如下：

| 场景 | 触发依据 | 用户提示 | tone | 生命周期 |
| --- | --- | --- | --- | --- |
| 连接正在重连 | `reconnectScheduled=true` 或连接状态为 `closed/error` 且仍有 subscriber | `Realtime sync is reconnecting` | `error` | active 状态持续展示，noticeKey 随事件/重试变化 |
| stream event recovery | 最近 2 分钟内出现 `seq-gap-detected`、`events-dropped`、`replay-incomplete`、`replay-continuation-requested`、`follower-recovery-*` 等事件，且尚无后续稳定事件 | `Realtime sync is recovering` | `error` | 2 分钟 TTL，超时自动清除 |
| snapshot fallback | 最近 2 分钟内出现 `snapshot-fallback-requested`，且没有更新的 problem event 覆盖它 | `Realtime sync refreshed from snapshots` | `info` | 2 分钟 TTL，提示用户已通过快照追平 |
| recovery completed | problem event 后 30 秒内出现 `replay-completed` 或 `socket-opened` | `Realtime sync recovered` | `info` | 30 秒 TTL，用于确认恢复完成 |

实现上没有直接读取 WebSocket 私有实例，而是复用现有 diagnostics subscription：

```ts
useSyncExternalStore(
  subscribeWorkspaceStreamManagerDiagnostics,
  getWorkspaceStreamManagerDiagnosticsSnapshot,
  getWorkspaceStreamManagerDiagnosticsSnapshot,
)
```

这样可以确保：

- stream lifecycle 一旦记录新事件，页面会被 diagnostics listener 推动重新渲染；
- follower / leader / direct 三种模式都能从统一 diagnostics 视角派生；
- 不需要在 WebSocket 分支里额外维护 UI 状态，降低竞态风险；
- TTL 到期通过 hook 内部 timer 触发一次轻量重算，避免 stale notice 长时间残留。

### 27.3 前端页面接入

变更文件：

```txt
frontend/src/hooks/useWorkspaceStreamTypes.ts
frontend/src/hooks/useWorkspaceStream.ts
frontend/src/pages/thread-page/useThreadPageControllerRuntimeState.ts
frontend/src/pages/thread-page/buildThreadPageControllerSurfaceStateLayoutInput.ts
frontend/src/pages/thread-page/buildThreadPageSurfaceLayoutProps.ts
frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx
frontend/src/locales/en/messages.po
frontend/src/locales/zh-CN/messages.po
```

关键接入链路：

```txt
useWorkspaceStreamRecoveryNotice(workspaceId)
  -> useThreadPageControllerRuntimeState
  -> buildThreadPageControllerSurfaceStateLayoutInput
  -> buildThreadPageSurfaceLayoutProps
  -> ThreadWorkbenchSurface
  -> InlineNotice
```

`ThreadWorkbenchSurface` 现在会在以下位置展示同一类 realtime recovery banner：

1. 已有 turns 的 thread timeline 顶部；
2. 已选中 thread 但当前没有 turns 的 empty state；
3. 未选中 thread / workspace 空态区域。

这样可以覆盖“事件恢复发生时页面当前没有对话内容”的边界，避免只在 `displayedTurns.length > 0` 时才可见。

新增/使用的 UI 文案全部通过 `i18n._(...)`：

- `Realtime sync is reconnecting`
- `Live updates paused briefly. The page is reconnecting and will replay missed workspace and thread events automatically.`
- `Realtime sync is recovering`
- `Some live events arrived out of order or were dropped. The page is replaying missed workspace and thread events before applying newer updates.`
- `Realtime sync refreshed from snapshots`
- `Some live events could not be replayed, so workspace and thread snapshots were refreshed to catch up.`
- `Realtime sync recovered`
- `Missed live events have been replayed or refreshed from snapshots. New user input and backend events should render normally.`

同时已补充 `en` 与 `zh-CN` locale catalog 条目，避免仅依赖 fallback message。

`InlineNotice` 继续使用已有 `Copy details` 工具，details 中包含 workspace id、notice reason、connection/socket state、reconnect 信息、coordination mode、queue length、latest lifecycle event 与 metadata，便于用户或开发者复制诊断信息。

### 27.4 测试补充

新增/更新测试：

```txt
frontend/src/hooks/useWorkspaceStream.test.ts
frontend/src/pages/thread-page/ThreadWorkbenchSurface.test.tsx
frontend/playwright/workspace-stream-recovery-ui.spec.ts
```

覆盖内容：

1. `buildWorkspaceStreamRecoveryNoticeFromDiagnostics` 纯函数：
   - active reconnecting notice；
   - snapshot fallback notice；
   - recovered notice；
   - TTL 过期后 suppress stale notice。
2. `ThreadWorkbenchSurface`：
   - 能在 timeline 顶部渲染 realtime recovery notice；
   - notice 带 `Copy details`，可复制诊断详情。
3. Playwright 真实浏览器：
   - 进入 thread 页面；
   - 通过 mock WebSocket 先发送 `workspace/connected` 建立已知 seq；
   - 再发送缺失 seq 的 `item/agentMessage/delta` 触发 `seq-gap-detected`；
   - 断言 diagnostics 中出现 `seq-gap-detected`；
   - 断言页面展示 realtime recovery notice 和 `Copy details`。

### 27.5 `deferredEvents` 残留审查

本轮再次搜索并复核了 `deferredEvents` 相关路径：

```powershell
rg "deferredEvents|deferredEventFlushHandle|flushDeferredWorkspaceEvents|scheduleDeferredWorkspaceEventFlush|cancelDeferredWorkspaceEventFlush|deferredFlush" frontend/src -n
```

结论：

- 当前仍存在 `deferredEvents` 字段、flush/timer 函数与 diagnostics 字段；
- 未发现有效 producer（例如 `.push` 或赋值追加）把事件放入 `deferredEvents`；
- 当前实际 stream 事件路径是：
  - batchable delta 进入 `eventQueue`；
  - non-delta event 在 flush queued delta 后 immediate ingest；
  - snapshot fallback / recovery 由 lifecycle diagnostics 与 query invalidation 处理；
- 因此 `deferredEvents` 目前是维护噪音，不是已知的数据正确性风险。

处理策略：

```txt
本轮不删除 deferredEvents 机制，原因是它属于 P3 维护性重构；删除会改动 diagnostics contract、测试 handler 类型和 profiler 历史指标，风险与本轮 P1/P2 修复收益不匹配。
```

建议后续单独做一项小型重构：

1. 删除 `WorkspaceStream.deferredEvents` / `deferredEventFlushHandle`；
2. 删除 diagnostics 中的 `deferredEventCount` / `deferredFlushScheduled`；
3. 删除 `scheduleDeferredWorkspaceEventFlush` / `cancelDeferredWorkspaceEventFlush` / `flushDeferredWorkspaceEvents`；
4. 清理测试 helper 中的 deferred handler；
5. 确认 profiler 中 `stream-deferred-flush` 历史展示是否需要兼容旧 session 数据。

### 27.6 验证结果

前端相关单元回归：

```powershell
cd frontend
npm test -- buildThreadPageThreadActions.test.ts useThreadPageLifecycleEffects.test.ts buildThreadPageTurnDisplayState.test.ts threadLiveState.test.ts useWorkspaceStream.test.ts WorkspaceStreamRecoveryQuerySync.test.tsx session-store.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts ThreadWorkbenchSurface.test.tsx buildThreadPageControllerSurfaceStateLayoutInput.test.ts
```

结果：通过。

```txt
14 个测试文件，182 个测试用例通过。
```

新增真实浏览器 Playwright 验证：

```powershell
cd frontend
npm run test:e2e -- workspace-stream-recovery-ui.spec.ts
```

结果：通过。

```txt
1 个 Chromium 浏览器测试通过。
```

前端 i18n 扫描：

```powershell
cd frontend
npm run i18n:check
```

结果：通过。

```txt
扫描文件 425，问题数量 0，影响文件 0。
```

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

后端相关回归：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api ./internal/turns ./internal/runtime
```

结果：通过。

局部 whitespace 检查：

```powershell
git diff --check -- frontend/src/hooks/useWorkspaceStream.ts frontend/src/hooks/useWorkspaceStreamTypes.ts frontend/src/pages/thread-page/useThreadPageControllerRuntimeState.ts frontend/src/pages/thread-page/buildThreadPageControllerSurfaceStateLayoutInput.ts frontend/src/pages/thread-page/buildThreadPageSurfaceLayoutProps.ts frontend/src/pages/thread-page/ThreadWorkbenchSurface.tsx frontend/src/hooks/useWorkspaceStream.test.ts frontend/src/pages/thread-page/ThreadWorkbenchSurface.test.tsx frontend/playwright/workspace-stream-recovery-ui.spec.ts docs/plan/workspace-thread-data-sync-review-and-remediation-plan.md
```

结果：通过。

### 27.7 最新完整性状态

第 26 节中标记为未完成的两项核心产品化缺口，本轮状态更新如下：

| 缺口 | 第 26 节状态 | 本轮状态 | 说明 |
| --- | --- | --- | --- |
| 用户可见 degraded / recovery UI | 未完成 | **已完成阶段性闭环** | thread 页面已消费 workspace stream diagnostics 并展示 reconnecting / recovering / snapshot fallback / recovered notice |
| 真实浏览器 E2E | 未完成 | **已补充 1 条关键路径验证** | 新增 Playwright 覆盖 workspace stream seq gap 后页面展示 recovery notice |

截至本节完成后，建议状态更新为：

```txt
workspace/thread 核心数据同步、自动恢复、用户可见恢复提示，以及至少一条真实浏览器关键路径验证已完成阶段性闭环。
```

仍保留为 P3 / 产品策略项的内容：

1. 非 active workspace 是否需要全量实时订阅；
2. `deferredEvents` 残留机制的独立维护性清理；
3. approvals batching future-proof；
4. thread list sort policy 产品确认；
5. 进一步扩展真实浏览器 E2E，覆盖多 tab follower recovery、retention gap snapshot fallback、`clientTurnRequestId` HTTP failure / stream success 竞态等组合场景。

## 28. 恢复路径优化实施记录：invalidation 去重与浏览器覆盖扩展（2026-05-12）

### 28.1 本轮实施目标

在第 27 节完成用户可见 recovery UI 后，本轮继续执行最值得优先推进的优化项：

1. 为 snapshot fallback / recovery query invalidation 增加 workspace 维度 debounce，避免短时间重复恢复事件导致请求风暴；
2. 扩展真实浏览器 Playwright 覆盖，锁住更多关键恢复路径；
3. 调整 recovery notice 优先级，让真实 retention gap 场景下的 snapshot fallback 能展示更具体的用户提示；
4. 保持 i18n、单测、E2E、构建与后端回归闭环。

### 28.2 Snapshot fallback query invalidation debounce

变更文件：

```txt
frontend/src/features/workspace-stream/WorkspaceStreamRecoveryQuerySync.tsx
frontend/src/features/workspace-stream/WorkspaceStreamRecoveryQuerySync.test.tsx
```

新增默认 debounce：

```ts
export const workspaceStreamRecoveryInvalidationDebounceMs = 750
```

新增调度能力：

```ts
scheduleWorkspaceStreamRecoveryQueryInvalidation(...)
clearWorkspaceStreamRecoveryQueryInvalidations(...)
```

行为：

- 同一个 workspace 的 recovery invalidation 在 750ms 窗口内会被合并；
- 后到的 recovery detail 会覆盖同 workspace 的旧 detail；
- 不同 workspace 的 timer 互相隔离；
- `WorkspaceStreamRecoveryQuerySync` unmount 时会清理所有 pending timer，避免组件卸载后继续触发 query 操作。

保留原有实际刷新范围：

```txt
threads
shell-threads
loaded-threads
thread-detail
approvals
command-sessions
workspace-hook-configuration
hook-runs
turn-policy-decisions
turn-policy-metrics
```

本轮没有做 query family 精细裁剪，原因是当前恢复路径优先保证数据正确性。先做 debounce / dedupe 可以降低重复请求风险，同时不降低 snapshot fallback 的保守恢复能力。

### 28.3 Recovery notice 优先级调整

变更文件：

```txt
frontend/src/hooks/useWorkspaceStream.ts
frontend/src/hooks/useWorkspaceStream.test.ts
```

调整点：

- `snapshot-fallback-requested` 现在在非 active reconnecting 状态下会优先展示 snapshot fallback notice；
- 即使后续紧接着记录 `replay-continuation-requested` 或 `replay-incomplete-stalled`，只要 snapshot fallback 仍在 TTL 内，用户仍会看到更具体的：

```txt
Realtime sync refreshed from snapshots
```

原因：真实 retention gap / stalled replay 场景中，`snapshot-fallback-requested` 往往会和后续 replay lifecycle event 连续出现。如果单纯按最新 problem event 覆盖 snapshot fallback，用户就看不到“已通过快照刷新”的关键语义。

新增单测覆盖：

- snapshot fallback 后又记录 replay continuation 时，notice 仍保持 `snapshot-fallback`；
- 保留原有 reconnecting、recovering、recovered 和 TTL suppress 行为。

### 28.4 Playwright 浏览器覆盖扩展

变更文件：

```txt
frontend/playwright/workspace-stream-recovery-ui.spec.ts
```

该文件现在覆盖 3 条浏览器关键路径：

1. **workspace stream seq gap**
   - 先用 mock WebSocket 发送 `workspace/connected` 建立已知 seq；
   - 再发送缺失 seq 的 `item/agentMessage/delta`；
   - 断言 diagnostics 出现 `seq-gap-detected`；
   - 断言页面展示 realtime recovery notice。

2. **replay retention gap -> snapshot fallback**
   - 发送 `workspace/replay/completed complete=false`，并让 `oldestSeq > afterSeq + 1`；
   - 断言 diagnostics 出现 `snapshot-fallback-requested`；
   - 断言页面展示 `Realtime sync refreshed from snapshots`；
   - 断言 active thread detail query 被重新请求，证明 `WorkspaceStreamRecoveryQuerySync` 的 snapshot fallback invalidation 生效。

3. **workspace/events/dropped**
   - 发送 `workspace/events/dropped` control event；
   - 断言 diagnostics 出现 `events-dropped`；
   - 断言页面展示 recovery notice。

这三条浏览器测试分别覆盖：

```txt
前端检测到 seq gap
后端 replay retention gap fallback
后端 subscriber dropped control event
```

比第 27 节的单条浏览器路径覆盖更完整。

### 28.5 验证结果

局部单测：

```powershell
cd frontend
npm test -- WorkspaceStreamRecoveryQuerySync.test.tsx useWorkspaceStream.test.ts
```

结果：通过。

```txt
2 个测试文件，24 个测试用例通过。
```

前端相关回归：

```powershell
cd frontend
npm test -- buildThreadPageThreadActions.test.ts useThreadPageLifecycleEffects.test.ts buildThreadPageTurnDisplayState.test.ts threadLiveState.test.ts useWorkspaceStream.test.ts WorkspaceStreamRecoveryQuerySync.test.tsx session-store.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts ThreadWorkbenchSurface.test.tsx buildThreadPageControllerSurfaceStateLayoutInput.test.ts
```

结果：通过。

```txt
14 个测试文件，185 个测试用例通过。
```

Playwright 浏览器验证：

```powershell
cd frontend
npm run test:e2e -- workspace-stream-recovery-ui.spec.ts
```

结果：通过。

```txt
3 个 Chromium 浏览器测试通过。
```

前端 i18n 扫描：

```powershell
cd frontend
npm run i18n:check
```

结果：通过。

```txt
扫描文件 425，问题数量 0，影响文件 0。
```

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

后端相关回归：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api ./internal/turns ./internal/runtime
```

结果：通过。

局部 whitespace 检查：

```powershell
git diff --check -- frontend/src/features/workspace-stream/WorkspaceStreamRecoveryQuerySync.tsx frontend/src/features/workspace-stream/WorkspaceStreamRecoveryQuerySync.test.tsx frontend/src/hooks/useWorkspaceStream.ts frontend/src/hooks/useWorkspaceStream.test.ts frontend/playwright/workspace-stream-recovery-ui.spec.ts docs/plan/workspace-thread-data-sync-review-and-remediation-plan.md
```

结果：通过。

### 28.6 当前优化状态

本轮完成后，上一轮建议中的优化项状态更新如下：

| 优化项 | 当前状态 | 说明 |
| --- | --- | --- |
| 扩展真实浏览器 E2E | **已进一步推进** | 已覆盖 seq gap、retention gap snapshot fallback、events dropped 三条关键路径 |
| snapshot fallback query invalidation debounce / dedupe | **已完成阶段性实现** | 同 workspace 750ms debounce，不改变保守 invalidation 范围 |
| recovery notice UX polish | **已完成一项关键修正** | snapshot fallback notice 在真实 retention gap 后能优先展示具体语义 |
| `deferredEvents` 清理 | 未实施 | 仍建议独立小重构，不与本轮恢复路径优化混合 |
| `clientTurnRequestId` 浏览器竞态 E2E | 未实施 | 单元层已有覆盖，后续仍建议补 HTTP failure / stream success 真实浏览器测试 |
| 多 tab BroadcastChannel follower recovery E2E | 未实施 | 后续可单独补多 context / 多 page Playwright 测试 |

### 28.7 后续建议

继续优化时建议优先做：

1. `clientTurnRequestId` 的浏览器级竞态测试：HTTP 失败但 stream 已 started 时不重复 turn、不恢复 stale 输入、不显示 stale error；
2. 多 tab BroadcastChannel follower recovery 浏览器测试；
3. 独立清理 `deferredEvents` 残留机制；
4. 根据实际 telemetry 再考虑是否对 recovery invalidation 按 reason 进一步缩小 query family。

---

## 29. 继续补缺口实施记录：clientTurnRequestId 浏览器竞态与 stream deferred 噪音清理（2026-05-12）

本轮继续执行第 28.7 节列出的缺口，重点补齐两类已经具备明确收益且风险可控的项：

1. `clientTurnRequestId` 的真实浏览器竞态覆盖；
2. `useWorkspaceStream` 中已经没有 producer 的 `deferredEvents` 残留机制清理。

### 29.1 `clientTurnRequestId` HTTP failure / stream success 浏览器覆盖

变更文件：

```txt
frontend/playwright/workspace-stream-recovery-ui.spec.ts
frontend/src/pages/thread-page/useThreadPageLifecycleEffects.ts
```

新增 Playwright 用例：

```txt
thread composer suppresses a stale HTTP send error when the stream already started the turn
```

覆盖路径：

```txt
用户提交 composer 输入
  -> 前端创建 optimistic pending turn，并随 POST /turns 发送 clientTurnRequestId
  -> POST /turns 返回 500，模拟 HTTP 传输失败 / 迟到失败
  -> WebSocket stream 在失败确认窗口内发送 turn/started，携带同一个 clientTurnRequestId
  -> live turn 与 optimistic pending turn 通过 clientTurnRequestId 匹配
  -> pending turn 被清理，页面切换到 live turn 的 Stop / replying 状态
  -> 不恢复 stale 输入，不显示 stale HTTP error，不重复渲染用户消息
```

断言点：

- `/api/workspaces/{workspaceId}/threads/{threadId}/turns` 的 POST payload 包含：
  - `clientTurnRequestId`
  - `input`
  - `permissionPreset`
  - `reasoningEffort`
- stream `turn/started` 使用同一个 `clientTurnRequestId`；
- 页面只有 1 条用户输入文本；
- `textarea` 继续保持清空；
- 不显示 `Simulated stale HTTP turn start failure`；
- 不显示 `Sending message to Codex…` / `Sending…` 的 optimistic pending 状态；
- live turn 已接管，主按钮进入 `Stop`；
- diagnostics 不出现 `seq-gap-detected`。

### 29.2 测试 mock 的 ThreadListPage 形状修正

在补浏览器竞态时发现 Playwright mock 对 `/api/workspaces/{workspaceId}/threads` 返回了数组，而当前真实调用路径 `listThreadsPage()` 期望 `ThreadListPage`：

```ts
{
  data: Thread[]
  nextCursor?: string | null
}
```

该 mock 形状错误会导致：

```txt
queryClient.setQueriesData<ThreadListPage>({ queryKey: ['shell-threads', workspaceId] }, ...)
```

拿到 array-shaped cache 后在 `current.data.find(...)` 处抛错。表现为：

```txt
optimistic pending turn 已经渲染
但 POST /turns 没有真正发出
composer 卡在 Sending…
```

本轮已将 Playwright mock 修正为真实 page shape，避免测试环境掩盖/制造非真实同步问题。

### 29.3 pending turn 与 live turn 匹配后的清理策略调整

原逻辑在 `useThreadPageLifecycleEffects` 中，发现 live turn 与 pending turn 匹配后会尝试保留最多约 700ms 的 optimistic staged 状态：

```txt
pending sending -> 延迟清理 -> live turn 接管
```

这在 HTTP failure / stream success 竞态下有两个问题：

1. 用户看到 `Sending message to Codex…` 的时间可能被不必要延长；
2. 在父级状态持续刷新或竞态失败窗口内，pending 清理与 HTTP stale error suppression 的配合更脆弱。

本轮改为：

```txt
只要 liveThreadTurns 中出现与 activePendingTurn 匹配的 turnId / clientTurnRequestId，
立即 clearPendingTurn(selectedThreadId)。
```

这与 composer 文案“as soon as the turn is live”一致，也让 UI 更及时地从 optimistic pending 状态切换为 live turn 状态：

```txt
Sending… -> Stop / Codex is replying…
```

准确性收益：

- pending 与 live turn 的边界更清晰；
- stream 已确认 turn start 时，不再由 HTTP stale failure 决定用户界面；
- 避免 optimistic user message 与 live user message 重复展示；
- 避免 stale HTTP error 恢复输入导致用户重复发送。

### 29.4 清理 `deferredEvents` 残留机制

变更文件：

```txt
frontend/src/hooks/useWorkspaceStream.ts
frontend/src/hooks/useWorkspaceStreamTypes.ts
frontend/src/hooks/useWorkspaceStream.test.ts
frontend/src/pages/settings/EnvironmentSettingsPage.tsx
frontend/src/locales/en/messages.po
frontend/src/locales/zh-CN/messages.po
```

清理前状态：

- `WorkspaceStream.deferredEvents`
- `WorkspaceStream.deferredEventFlushHandle`
- `scheduleDeferredWorkspaceEventFlush`
- `cancelDeferredWorkspaceEventFlush`
- `flushDeferredWorkspaceEvents`
- diagnostics 中的：
  - `deferredEventCount`
  - `deferredFlushScheduled`
- Environment diagnostics 中的 `deferred {deferred}` 展示

但当前代码已经没有任何 producer 会向 `deferredEvents` push 事件；非 delta event 现在直接走 immediate ingestion，delta event 走 `eventQueue` 批处理。因此 `deferredEvents` 只会增加：

```txt
诊断噪音
类型复杂度
dispose / onclose 清理分支
单测 mock 负担
Environment diagnostics 误导性指标
```

本轮删除了该残留机制，并将 Environment diagnostics 的 frontend stream 描述从：

```txt
queued {queued} · deferred {deferred} · peers {peers}
```

调整为：

```txt
queued {queued} · peers {peers}
```

同时更新了中英文 i18n catalog，并补齐 `zh-CN/messages.po` 中既有的空翻译条目，使多语言扫描和 PO 覆盖均恢复为通过状态。

### 29.5 当前剩余缺口状态

| 缺口 | 当前状态 | 说明 |
| --- | --- | --- |
| `clientTurnRequestId` 浏览器竞态 E2E | **已完成** | Playwright 覆盖 HTTP failure / stream started success 接管路径 |
| pending turn live 接管及时性 | **已优化** | 匹配 live turn 后立即清理 optimistic pending |
| `deferredEvents` 清理 | **已完成** | 删除无 producer 的残留机制与诊断字段 |
| snapshot fallback debounce / recovery notice | **已完成** | 第 28 节已实施并验证 |
| 多 tab BroadcastChannel follower recovery E2E | **仍建议后续单独实施** | 单测已有 leader/follower recovery 覆盖；真实多 tab Playwright 仍需独立 mock BroadcastChannel 总线 |
| recovery invalidation query family 精细裁剪 | **暂缓** | 当前保持保守刷新范围，后续需基于 telemetry 决定 |

### 29.6 验证结果

局部单测：

```powershell
cd frontend
npm test -- useWorkspaceStream.test.ts useThreadPageLifecycleEffects.test.ts buildThreadPageThreadActions.test.ts
```

结果：通过。

```txt
3 个测试文件，34 个测试用例通过。
```

前端相关回归：

```powershell
cd frontend
npm test -- buildThreadPageThreadActions.test.ts useThreadPageLifecycleEffects.test.ts buildThreadPageTurnDisplayState.test.ts threadLiveState.test.ts useWorkspaceStream.test.ts WorkspaceStreamRecoveryQuerySync.test.tsx session-store.test.ts sync.test.ts ThreadTerminalViewport.test.tsx threadPageUtils.test.ts WorkspaceTreeThreadRow.test.tsx useThreadPageSessionState.test.ts ThreadWorkbenchSurface.test.tsx buildThreadPageControllerSurfaceStateLayoutInput.test.ts
```

结果：通过。

```txt
14 个测试文件，185 个测试用例通过。
```

Playwright 浏览器验证：

```powershell
cd frontend
npm run test:e2e -- workspace-stream-recovery-ui.spec.ts
```

结果：通过。

```txt
4 个 Chromium 浏览器测试通过。
```

i18n 提取与扫描：

```powershell
cd frontend
npm run i18n:extract
npm run i18n:check
npm run i18n:coverage
```

结果：

```txt
i18n:check 通过，问题数量 0，影响文件 0。
i18n:coverage 通过，zh-CN 有效条目 3973，已翻译 3973，空翻译 0。
```

前端构建：

```powershell
cd frontend
npm run build
```

结果：通过。

后端相关回归：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api ./internal/turns ./internal/runtime
```

结果：通过。

---

## 30. 独立 TODO 文档拆分记录（2026-05-12）

为便于后续继续跟踪未完成或暂缓的同步可靠性优化，已将剩余缺口拆分为独立 TODO 文档：

```txt
docs/plan/workspace-thread-data-sync-todo.md
```

该 TODO 文档当前跟踪：

1. 多标签页 BroadcastChannel follower recovery 浏览器 E2E；
2. recovery invalidation query family 精细裁剪；
3. replay stalled / retention gap 浏览器路径细化；
4. recovery telemetry 与诊断可观测性整理；
5. thread projection 大量事件压力与乱序回放性能测试。

后续每完成一个 TODO，需要同步更新本实施记录与 TODO 文档，记录状态、变更文件、实现策略和验证结果。
