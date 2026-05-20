# Workspace Thread Realtime Performance Fix

## 背景

同一 workspace 下多个 thread 同时运行时，thread 进度、完成状态和 sidebar/workspace thread 状态更新存在滞后。现有分析显示，延迟主要来自后端事件消费链路的串行阻塞，以及前端 thread list 缓存只依赖轻量 activity overlay、未同步更新列表快照。

## 目标

- 降低 app-server 事件进入 Go backend 后的同步处理成本。
- 确保 turn/thread 生命周期事件尽快反映到 stored thread summary、workspace stream 和 sidebar thread list。
- 保持现有 workspace stream 协议兼容，先做低风险修复，再保留更大结构性改造待办。
- 每次前端文案或 UI 改动后执行 i18n 检查。

## 进度

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 建立修复跟踪文档 | 已完成 | 本文档用于记录方案、改动、验证和剩余风险。 |
| 后端 workspace event retention 优化 | 已完成 | retained workspace event log 改为环形缓冲，append 满保留上限后 O(1) 覆盖，读取/持久化时按 seq 顺序 clone。 |
| 后端 thread lifecycle summary 同步 | 已完成 | `ApplyThreadEvent` 更新 projection 时同步基础 `Thread` status/count/updatedAt；projection 忽略重复状态事件时，也会修正 stale summary 并持久化。 |
| 后端 subscriber 队列分配优化 | 已完成 | workspace stream subscriber 出队改为 head 游标，避免每次 pop 移动剩余队列；任意位置淘汰仍原地移动并清尾，减少高频事件消费时的临时分配、内存移动和 GC 压力。 |
| 后端 projection apply 过滤 | 已完成 | `Hub.Publish` 仅对会影响 thread projection 的 thread-scoped 事件调用 `ApplyThreadEvent`，避免通知类事件抢占全局 store 写锁。 |
| 后端 delta 队列合并扩展 | 已完成 | subscriber 队列支持合并 agent/plan/reasoning/commandExecution item delta，积压时减少 websocket 待发送事件数；合并仅允许连续 seq 覆盖，避免错误掩盖中间事件缺失。 |
| 后端测试 | 已完成 | 覆盖 event retention 顺序、replay 标记、stored thread status/count/updatedAt 跟随生命周期事件，以及重复 status event 修复 stale summary。 |
| 前端 thread list 实时同步 | 已完成 | AppShell 为当前路由和已展开 workspace 订阅 stream；生命周期/状态事件按 workspace debounce 刷新 `shell-threads`/`threads`。 |
| 前端 updated_at 实时排序 | 已完成 | AppShell 用轻量本地 activity overlay 修正 visible thread status/updatedAt，并仅在 `updated_at` 模式下重新排序，避免 delta 高频重排；overlay 增加上限避免常驻内存无界增长。 |
| 前端 batch seq 检测优化 | 已完成 | workspace stream batch queue 使用 per-workspace seq cursor 增量检测 gap，避免每个 delta 都复制并扫描整条队列。 |
| 前端 session store ingest 优化 | 已完成 | `applySessionEvents` 过滤非 thread-detail projection 事件，批内复用 activity/token/event buffer draft，减少高频 delta 下重复 projection、对象展开和数组复制。 |
| 前端诊断通知节流 | 已完成 | workspace stream 诊断 snapshot 仍立即标脏，但诊断订阅者通知按短时间窗合并，避免高频 delta flush 时驱动无意义重渲染。 |
| 前端 overlay 裁剪优化 | 已完成 | AppShell thread list realtime overlay 超限时只扫描并删除最旧项，避免每次新增都对 1000 条 overlay 全量排序。 |
| 前端测试 | 已完成 | 覆盖 thread refresh methods、cache created_at/updated_at 排序，以及 thread row activity 状态显示。 |
| i18n 检查 | 已完成 | `npm run i18n:check` 通过，未发现新增未国际化文本或空翻译条目。 |
| 全量验证 | 已完成 | 相关 Go/前端测试与前端 build 已通过，见下方验证记录。 |

## 已确认根因

- Go bridge `readStdout()` 单 goroutine 同步处理 app-server stdout notification。
- `runtime.HandleNotification()` 同步调用 `Hub.Publish()`。
- `Hub.Publish()` 同步执行 workspace event seq/store append、subscriber enqueue、thread projection apply。
- `MemoryStore` 使用全局锁；原 workspace event append 每次 clone 最多 2000 条 retained event。
- persistence flush 在同一把 store 锁内构建完整 snapshot、marshal、写文件。
- 前端 `shell-threads` 默认 30 秒 stale，生命周期事件默认不刷新 thread list。
- sidebar 行状态主要依赖 `threadActivityByThread` overlay，列表快照、排序和 stored fallback 可能滞后。

## 修复策略

### 第一阶段：低风险即时修复

1. 优化 `AppendWorkspaceEvent`，避免每条事件 O(retention) clone。
2. 在 `ApplyThreadEvent` 中同步基础 `Thread` summary，减少 stored list 和 projection 状态不一致。
3. 前端将生命周期事件加入 thread list refresh debounce。
4. 前端在渲染 workspace thread list 时让 activity overlay 参与 `updated_at` 排序和 stale status 修正。

## 本次改动记录

### 后端

- `backend/internal/store/memory.go`
  - `workspaceEvents` 从普通 slice 改为 `workspaceEventLog` 环形缓冲。
  - `AppendWorkspaceEvent` 不再每条事件 clone retained log，降低多 thread 并发事件写入时的 store 锁持有成本。
  - `ListWorkspaceEventsAfter`、`GetWorkspaceEventOldestSeq`、load/persist 路径保持原有 seq 顺序语义。
  - `ApplyThreadEvent` 在 projection 更新后同步基础 `Thread` summary。
  - projection 忽略重复 `thread/status/changed` 等事件时，仍尝试用当前 projection 和事件 timestamp/status 修复 stale summary，避免列表 fallback 长期显示旧状态。
- `backend/internal/store/memory_test.go`
  - 增强 retained event replay 顺序和 replay 标记断言。
  - 新增 stored thread summary 生命周期同步回归测试。
- `backend/internal/events/hub.go`
  - subscriber queue 出队改为 `queueHead` 游标，正常 FIFO drain 摊销 O(1)，避免每次 `pop()` 都移动剩余队列。
  - hard-limit 任意位置淘汰保留 `copy` 原地移动并清空尾槽；head 游标会在 append 前或累计出队后 compact，避免长期保留已出队对象引用。
  - snapshot `QueueLen` 改为统计活跃队列长度，避免 head 游标导致诊断误报积压。
  - `Hub.Publish` 在 append workspace event 之后，先用 `store.ShouldApplyThreadEventToProjection` 判断事件是否会影响 thread projection；非 projection 事件不再进入 `ApplyThreadEvent`。
  - subscriber queue 新增 item text delta 合并，覆盖 `item/agentMessage/delta`、`item/plan/delta`、`item/reasoning/summaryTextDelta`、`item/reasoning/textDelta`、`item/commandExecution/outputDelta`。
  - reasoning delta 合并时会校验 `summaryIndex` / `contentIndex`，避免不同 reasoning 段落被错误拼接。
  - command/item/tokenUsage 合并统一校验 seq 覆盖连续性；如果 incoming event 与当前合并候选之间存在 seq gap，则保持为独立事件，避免 coalesced `coversSeqFrom`/`coversSeqTo` 掩盖中间事件缺失。
- `backend/internal/events/hub_test.go`
  - 新增队列删除顺序和尾槽清理回归测试。
  - 新增 subscriber pop head cursor 与 snapshot active queue length 回归测试。
  - 新增非 projection thread-scoped 事件跳过 apply 的回归测试。
  - 新增 item delta 合并以及 reasoning 不跨 index 合并的回归测试。
  - 新增非连续 seq item delta 不合并的回归测试。
- `backend/internal/store/thread_projection.go`
  - 新增 `ShouldApplyThreadEventToProjection`，集中声明 thread projection 需要消费的事件集合。

### 前端

- `frontend/src/components/shell/AppShell.tsx`
  - 对当前路由 workspace 和已展开 workspace 调用 `useWorkspaceStreams`，确保 shell 本身能收到 workspace stream。
  - 使用 `useWorkspaceEventSubscription` 监听 thread 生命周期、状态和结构事件。
  - 对 `shell-threads` 与 `threads` 查询按 workspace 做 600ms debounce invalidate，避免同一批生命周期事件触发多次请求。
  - 维护仅包含生命周期/状态事件的本地 activity overlay，用于快速修正 visible thread 的 `status`/`updatedAt`。
  - stale overlay 不再覆盖查询返回的新状态；本地 overlay 保留最新 1000 条 lifecycle activity，避免长期运行后无界增长。
  - `updated_at` 排序模式下按 overlay 后的 `updatedAt` 重新排序；delta 事件不进入该 overlay，避免高频输出导致整个 sidebar 重排。
- `frontend/src/pages/threadPageUtils.ts`
  - 将 `thread/status/changed`、`turn/started`、`turn/completed`、terminal turn lifecycle 纳入 thread list refresh 判定。
- `frontend/src/pages/threadPageUtils.test.ts`
  - 更新刷新规则断言，确认 delta 仍不会刷新 thread list。
- `frontend/src/hooks/useWorkspaceStream.ts`
  - batch queue 新增 `queuedSeqByWorkspace` cursor。batchable event 入队时只与 cursor 或 store 中 last seq 对比，不再构造 `[...]` 并扫描整个 queue。
  - forced flush、普通 flush 后清理 queued seq cursor，保持 gap 检测语义与真实 applied seq 对齐。
  - workspace stream diagnostics snapshot 继续即时标记 dirty；有诊断订阅者时，对通知做 100ms 合并，降低高频 batch flush 对恢复提示/诊断面板的渲染压力。
- `frontend/src/hooks/useWorkspaceStreamTypes.ts`
  - `WorkspaceStream` 增加 `queuedSeqByWorkspace`。
- `frontend/src/hooks/useWorkspaceStream.test.ts`
  - 新增 batch seq cursor 重置测试。
  - 新增诊断通知 burst 合并测试。
- `frontend/src/stores/session-store.ts`
  - `applySessionEvents` 不再对 `command/exec/outputDelta` 等普通 command runtime 事件创建或更新 thread detail projection；命令输出仍进入 command session，thread activity 仍更新。
  - thread activity 更新改为批内懒克隆，避免同一批多事件重复展开整个 `threadActivityByThread`。
  - token usage 更新改为批内懒克隆，避免同一批多事件重复展开整个 `tokenUsageByThread`。
  - workspace/thread event ring buffer 改为批内 draft 复用，同一 workspace/thread 在一个 batch 内只复制一次数组，并按上限截断。
- `frontend/src/stores/session-store.test.ts`
  - 新增 command runtime output delta 不创建 thread projection 的回归测试。
  - 新增同一批多个 thread activity 更新仍正确落库的回归测试。
  - 新增批量 delta 下 inactive thread event buffer 仍按上限截断的回归测试。
  - 新增同一批多个 thread token usage 更新仍正确落库的回归测试。
- `frontend/src/components/shell/AppShell.tsx`
  - `limitThreadListRealtimeActivity` 从全量排序后 slice 改为扫描最旧 key 并删除，overlay 达到上限后单次裁剪保持 O(n) 且减少临时数组排序成本。

### 第二阶段：结构性改造待办

1. 将 `readStdout()` 改为快速入队，由 per-workspace/per-thread worker 消费。
2. 对生命周期/control event 建立优先级队列，避免 delta 淹没 terminal event。
3. 将 projection apply 和 persistence 从 `Hub.Publish()` 主路径进一步异步化。
4. 将 persistence snapshot 构建、JSON marshal、文件写入移出全局 store 锁。
5. 增加端到端延迟指标：app-server emit、Go bridge receive、Hub seq、WS write、browser receive/apply。

## 验证计划

- `go test ./internal/store`
- `go test ./internal/events ./internal/runtime`
- `npm run test -- --run src/features/threads/cache.test.ts src/pages/threadPageUtils.test.ts src/components/shell/WorkspaceTreeThreadRow.test.tsx`
- `npm run build`
- `npm run i18n:check`

## 验证记录

| 命令 | 结果 |
| --- | --- |
| `go test ./internal/events ./internal/store ./internal/runtime` | 通过 |
| `go test ./internal/events ./internal/store ./internal/runtime ./internal/threads` | 通过 |
| `npm run test -- --run src/features/threads/cache.test.ts src/pages/threadPageUtils.test.ts src/components/shell/WorkspaceTreeThreadRow.test.tsx` | 通过，3 个文件、39 个测试 |
| `npm run test -- --run src/hooks/useWorkspaceStream.test.ts src/features/threads/cache.test.ts src/pages/threadPageUtils.test.ts src/components/shell/WorkspaceTreeThreadRow.test.tsx` | 通过，4 个文件、61 个测试 |
| `npm run test -- --run src/stores/session-store.test.ts src/hooks/useWorkspaceStream.test.ts src/features/threads/cache.test.ts src/pages/threadPageUtils.test.ts src/components/shell/WorkspaceTreeThreadRow.test.tsx` | 通过，5 个文件、78 个测试 |
| `npm run build` | 通过 |
| `npm run i18n:check` | 通过，问题数量 0 |
| `git diff --check` | 通过 |

## 剩余风险

- 本次优先做低风险修复，仍保留 `Hub.Publish()` 主路径同步 projection/store 的结构；在极端高频事件和大 snapshot 场景下，仍可能需要第二阶段异步化。
- AppShell 现在只为当前路由和已展开 workspace 打开 stream；折叠且未访问的 workspace 不会主动消费实时事件，直到展开、进入路由或后续查询刷新。
- 本地排序 overlay 只捕获生命周期/状态事件，不捕获高频 delta；这是为了避免 delta 输出导致侧边栏整体重排。可见行的进度文本/状态仍由 `WorkspaceTreeThreadRow` 通过 session store activity 独立更新。
