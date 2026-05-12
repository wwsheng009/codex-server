# Workspace / Thread 数据同步剩余缺口 TODO

创建日期：2026-05-12  
适用范围：`workspace` / `thread` 页面组件、workspace stream、thread projection、recovery UI、snapshot fallback、BroadcastChannel 多标签页协同。

> 本文档从 `docs/plan/workspace-thread-data-sync-review-and-remediation-plan.md` 的最新实施记录中拆分而来，只保留仍未完成、暂缓或建议继续优化的缺口。已完成项不再作为 TODO 跟踪。

---

## 1. 当前已完成的关键项基线

以下能力已经完成并通过验证，不再列为缺口：

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| workspace stream seq gap detection | 已完成 | 前端可检测缺失 seq，并触发 replay / recovery |
| replay continuation | 已完成 | replay incomplete 但 cursor 推进时可继续 replay |
| retention gap snapshot fallback | 已完成 | replay 无法覆盖缺失范围时触发 snapshot fallback |
| `workspace/events/dropped` control event | 已完成 | 后端 dropped event 能触发前端恢复状态与刷新 |
| BroadcastChannel follower recovery 单测 | 已完成 | leader/follower recovery request/accepted 已有单测覆盖 |
| optimistic send `clientTurnRequestId` | 已完成 | HTTP start request 与 optimistic turn 使用同一 client id |
| HTTP failure / stream success stale error suppression 单测 | 已完成 | stream 已确认 turn 后可抑制 stale HTTP error |
| HTTP failure / stream success 浏览器 E2E | 已完成 | Playwright 已覆盖 stale HTTP failure + stream `turn/started` 接管 |
| pending turn live 接管及时性 | 已完成 | live turn 匹配后立即清理 optimistic pending |
| 用户可见 recovery / degraded UI | 已完成 | thread 页面展示 reconnecting / recovering / snapshot fallback / recovered |
| snapshot fallback query invalidation debounce | 已完成 | 同 workspace 750ms 合并 snapshot fallback invalidation |
| `deferredEvents` 残留清理 | 已完成 | 已删除无 producer 的 deferred stream 机制与诊断噪音 |
| i18n 扫描与 zh-CN 空翻译 | 已完成 | `i18n:check` 0 问题，`i18n:coverage` 100% |

---

## 2. 剩余缺口总览

| ID | 缺口 | 优先级 | 状态 | 建议处理方式 |
| --- | --- | --- | --- | --- |
| TODO-WS-01 | 多标签页 BroadcastChannel follower recovery 浏览器 E2E | P1 | 未实施 | 新增独立 Playwright 文件，模拟多 page / 多 tab broadcast 总线 |
| TODO-WS-02 | recovery invalidation query family 精细裁剪 | P2 | 暂缓 | 先收集 telemetry，再按恢复原因缩小 invalidate 范围 |
| TODO-WS-03 | replay stalled / retention gap 浏览器路径细化 | P2 | 部分覆盖 | 在现有 retention gap E2E 基础上补 stalled replay 场景 |
| TODO-WS-04 | recovery telemetry 与诊断可观测性整理 | P2 | 建议优化 | 梳理 Environment / diagnostics 中 recovery reason、次数、耗时 |
| TODO-WS-05 | thread projection 大量事件压力与乱序回放性能测试 | P3 | 建议优化 | 增加 synthetic unit / integration 测试，不优先做 UI E2E |

---

## 3. TODO-WS-01：多标签页 BroadcastChannel follower recovery 浏览器 E2E

### 背景

当前 BroadcastChannel follower recovery 已有单元测试覆盖：

- follower 收到 broadcast event 时发现 seq gap；
- follower 向 leader 发送 `recovery-request`；
- leader 接受 follower cursor；
- leader 使用 follower cursor 重新打开 websocket replay。

但还缺少真实浏览器层的多 tab / 多 page 覆盖。该缺口价值较高，因为真实问题最容易发生在以下场景：

```txt
Tab A 是 leader，拥有唯一后端 websocket；
Tab B 是 follower，只通过 BroadcastChannel 接收 leader 转发事件；
Tab B 的本地 seq cursor 与 leader 转发事件出现 gap；
Tab B 必须请求 Tab A 按自己的 cursor replay；
Tab A 必须接受较小 cursor，重新连接后端 stream；
Tab B 最终恢复并刷新 UI。
```

### 建议实现文件

```txt
frontend/playwright/workspace-stream-broadcast-recovery.spec.ts
```

或复用：

```txt
frontend/playwright/workspace-stream-recovery-ui.spec.ts
```

但建议新建独立文件，避免现有单 tab recovery UI 文件过大。

### 建议实现步骤

1. 在 Playwright 中创建两个 page：

   ```ts
   const pageLeader = await context.newPage()
   const pageFollower = await context.newPage()
   ```

2. 注入同一个 mock BroadcastChannel 总线。

   推荐实现一个浏览器端全局 channel registry：

   ```txt
   channelName -> subscribers[]
   postMessage -> dispatch to same channel other subscribers
   ```

   注意：不同 page 的 JS realm 隔离，普通 `window.__channels` 无法跨 page 共享。可选方案：

   - 方案 A：使用 Playwright `page.exposeFunction` 将 postMessage 交给 Node 侧总线，再分发到各 page；
   - 方案 B：通过同一个 browser context 的 `storageState` / localStorage 辅助不够实时，不推荐；
   - 方案 C：单 page 内模拟两个 stream manager 实例成本较高，不推荐。

3. 控制 leader election。

   需要让一个 tab 稳定成为 leader，另一个成为 follower。可以通过 mock `getWorkspaceStreamInstanceId()` 或控制 `Math.random()` / instance id 生成顺序达成。验收重点不是 election 本身，而是 follower recovery。

4. leader page mock WebSocket 后端 stream。

   leader 收到 follower recovery request 后，应关闭旧 socket 并重新打开带 `afterSeq={followerAfterSeq}` 的 stream URL。

5. follower page 制造 seq gap。

   follower 先拥有 last seq，例如：

   ```txt
   lastEventSeqByWorkspace[ws-1] = 5
   ```

   然后通过 broadcast 收到 seq 8 的 event，触发：

   ```txt
   expectedSeq = 6
   receivedSeq = 8
   afterSeq = 5
   ```

6. 断言 follower diagnostics：

   ```txt
   seq-gap-detected
   follower-recovery-requested
   ```

7. 断言 leader diagnostics：

   ```txt
   follower-recovery-accepted
   replayAfterSeqOverride = 5 或下一次 websocket URL 包含 afterSeq=5
   ```

8. 断言 follower UI：

   - recovery notice 可见；
   - replay / snapshot 后页面恢复；
   - 不重复显示 thread turn；
   - 不丢失用户输入或 live delta。

### 验收标准

必须至少断言：

```txt
follower: seq-gap-detected
follower: follower-recovery-requested
leader: follower-recovery-accepted
leader websocket URL: afterSeq=5
follower UI: recovery notice -> recovered 或正常渲染
```

### 预计风险

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| Playwright 多 page BroadcastChannel mock 复杂 | page 间 JS realm 不共享 | 使用 Node 侧 exposeFunction 总线 |
| leader election 不稳定 | instance id 生成随机 | mock instance id 或控制随机源 |
| E2E flaky | 心跳和 election 有定时器 | 使用 fake timer 不现实，建议显式等待 diagnostics，而不是固定 sleep |

---

## 4. TODO-WS-02：recovery invalidation query family 精细裁剪

### 背景

当前 snapshot fallback / recovery query invalidation 采用保守刷新范围：

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

并已实现同 workspace 750ms debounce / dedupe。这样优先保证正确性，但在事件风暴或多 workspace 场景下可能产生较多 refetch。

### 建议推进方式

不要立即裁剪。建议先引入 telemetry 或利用已有 diagnostics 采集：

- recovery reason；
- invalidated query family；
- refetch 数量；
- refetch 耗时；
- snapshot fallback 后实际哪些 query 数据发生变化；
- 用户是否在当前 thread 页面、workspace shell、settings 页面。

### 可选裁剪策略

| recovery reason | 建议刷新范围 | 说明 |
| --- | --- | --- |
| selected thread seq gap | `thread-detail` + `threads` + `loaded-threads` | 当前 thread 内容优先 |
| workspace-level dropped event | 保守刷新全部 workspace 相关 | dropped event 无法准确知道影响范围 |
| snapshot fallback retention gap | 保守刷新全部 | retention gap 意味着已丢不可重放事件 |
| follower recovery accepted | 优先 thread / workspace stream 状态 | 如果 replay 能补齐，不必立即刷新所有 query |
| command output gap | `command-sessions` + thread detail | 终端和 thread projection 同步 |

### 验收标准

- 新增单测覆盖不同 reason 到 query family 的映射；
- Playwright retention gap E2E 仍通过；
- 不降低 snapshot fallback 的正确性；
- `npm run test:e2e -- workspace-stream-recovery-ui.spec.ts` 通过；
- `npm run i18n:check` 通过，如有 UI 文案变更。

---

## 5. TODO-WS-03：replay stalled / retention gap 浏览器路径细化

### 背景

当前 Playwright 已覆盖 retention gap：

```txt
workspace/replay/completed complete=false
oldestSeq > afterSeq + 1
=> snapshot-fallback-requested
=> active thread detail query refetch
```

但 stalled replay path 主要在单测层覆盖，浏览器层还可以继续补一条。

### 建议新增路径

在现有 `workspace-stream-recovery-ui.spec.ts` 中新增一条：

```txt
thread page refreshes snapshots when replay continuation stalls without advancing cursor
```

模拟：

```txt
workspace/replay/completed complete=false
nextAfterSeq <= afterSeq
或 replay continuation 多次不推进
=> replay-incomplete-stalled
=> snapshot-fallback-requested
=> query invalidation debounce 生效
=> UI 展示 snapshot fallback notice
```

### 验收标准

- diagnostics 包含：

  ```txt
  replay-incomplete-stalled
  snapshot-fallback-requested
  ```

- UI 展示：

  ```txt
  Realtime sync refreshed from snapshots
  ```

- active thread detail 至少重新请求一次；
- 不出现无限 reconnect / replay loop。

---

## 6. TODO-WS-04：recovery telemetry 与诊断可观测性整理

### 背景

当前 diagnostics 已包含 lifecycle events、leader/follower 状态、queueLength、socket state、connection state 等。但 recovery 的统计维度仍偏事件日志，不够适合长期观察。

### 建议补充字段

可在 diagnostics 或 Environment 页面中增加聚合字段：

```txt
lastRecoveryReason
lastRecoveryStartedAt
lastRecoverySettledAt
lastSnapshotFallbackAt
recoveryCountByReason
lastReplayAfterSeq
lastReplayHeadSeq
lastReplayOldestSeq
lastReplayComplete
lastInvalidationReason
lastInvalidationQueryFamilies
```

### 注意事项

- 不要在 UI 中堆叠过多字段；
- 优先放到 Copy details / diagnostics JSON；
- 用户可见 notice 保持简洁；
- 新增 UI 文案必须接入 i18n，并执行 `npm run i18n:check`。

### 验收标准

- diagnostics snapshot 可稳定序列化；
- 不引入大量频繁变化导致 React 重渲染；
- Environment 页面展示不误导；
- 单测覆盖字段生成逻辑。

---

## 7. TODO-WS-05：thread projection 大量事件压力与乱序回放性能测试

### 背景

workspace/thread 页面功能复杂，thread projection 会处理：

- turn lifecycle；
- agent message delta；
- command output delta；
- file change；
- tool call；
- approval request；
- token usage；
- replay event；
- snapshot reconciliation。

当前已有大量单测，但仍建议加入 synthetic 压力场景，避免未来修改造成性能退化或重复渲染。

### 建议测试方向

1. 大量 delta 合并：

   ```txt
   1000 个 item/agentMessage/delta
   => projection 最终文本准确
   => eventQueue flush 后无重复 item
   ```

2. replay + live 混合：

   ```txt
   replay seq 10-20 后接 live seq 21
   => baseline filter 不误过滤 live event
   ```

3. snapshot reconciliation：

   ```txt
   snapshot already contains部分 item
   replay event 补齐缺失 item
   => 不重复、不倒序、不丢字段
   ```

4. command output tail / full output：

   ```txt
   output delta + output snapshot + tail expansion
   => content override 与 projection 一致
   ```

### 验收标准

- 优先单测，不优先浏览器 E2E；
- 对关键函数设定耗时上限时要宽松，避免 CI flaky；
- 覆盖重复 event / stale seq / coalesced event。

---

## 8. 建议执行顺序

推荐后续按以下顺序推进：

1. **TODO-WS-01 多标签页 BroadcastChannel follower recovery 浏览器 E2E**  
   当前价值最高，能补齐真实多 tab 数据同步链路。

2. **TODO-WS-03 replay stalled 浏览器路径细化**  
   成本较低，可继续增强现有 recovery E2E 文件。

3. **TODO-WS-04 recovery telemetry 整理**  
   为 query family 精细裁剪提供依据。

4. **TODO-WS-02 recovery invalidation query family 精细裁剪**  
   等 telemetry 或更明确的真实问题后再做，避免为了减少请求牺牲正确性。

5. **TODO-WS-05 thread projection 压力测试**  
   作为维护性增强，适合与后续 projection 重构一起做。

---

## 9. 每次处理 TODO 后必须执行的验证

如涉及前端代码或 UI 文案，至少执行：

```powershell
cd frontend
npm run i18n:check
npm test -- useWorkspaceStream.test.ts useThreadPageLifecycleEffects.test.ts buildThreadPageThreadActions.test.ts
npm run build
```

如涉及 recovery 浏览器路径，执行：

```powershell
cd frontend
npm run test:e2e -- workspace-stream-recovery-ui.spec.ts
```

如新增 BroadcastChannel 多标签页 E2E，执行对应新文件，例如：

```powershell
cd frontend
npm run test:e2e -- workspace-stream-broadcast-recovery.spec.ts
```

如涉及后端 event hub / stream / replay 行为，执行：

```powershell
cd backend
go test ./internal/events ./internal/store ./internal/api ./internal/turns ./internal/runtime
```

---

## 10. 文档维护规则

每完成一个 TODO，需要同步更新：

```txt
docs/plan/workspace-thread-data-sync-review-and-remediation-plan.md
docs/plan/workspace-thread-data-sync-todo.md
```

更新要求：

- 将对应 TODO 状态改为“已完成”；
- 记录变更文件；
- 记录核心实现策略；
- 记录验证命令与结果；
- 如新增 UI 文案，记录 i18n 检查结果；
- 如决定暂缓或放弃，写明原因和替代方案。
