# codex-server 如何吸收现有 `app-server sidecar` 研究成果

更新时间：2026-04-08

适用项目：

- `E:\projects\ai\codex-server`

关联研究：

- `E:\projects\ai\codex-analysis\hooks\windows-alternatives-to-hooks-json-2026-04-08.md`
- `E:\projects\ai\codex-analysis\hooks\app-server-sidecar-stop-posttooluse-workflow-2026-04-08.md`
- `E:\projects\ai\codex-analysis\hooks\app-server-sidecar-implementation-blueprint-2026-04-08.md`
- `E:\projects\ai\codex-analysis\hooks\app-server-sidecar-recommended-config-examples-2026-04-08.md`
- `E:\projects\ai\codex-analysis\hooks\go-sidecar-minimal-prototype-layout-and-interfaces-2026-04-08.md`
- `E:\projects\ai\codex-analysis\hooks\go-sidecar-mvp-task-breakdown-and-code-skeleton-2026-04-08.md`

## 1. 先说结论

`codex-server` 不需要再额外新建一个独立 sidecar 进程，才能吸收这轮关于 `Stop / PostToolUse` 的研究成果。

更准确地说：

- `codex-server` 现有的 Go 后端本身已经是一个浏览器前的 `app-server` 编排层
- 它已经具备：
  - `codex app-server` stdio JSON-RPC 桥接
  - workspace 级 runtime 管理
  - `turn/start` / `turn/steer` / `turn/interrupt` 封装
  - 统一事件总线
  - thread / turn / item 投影持久化
  - 自动化服务的事件订阅与幂等控制

因此，当前研究成果最合理的落地方式不是：

- 再造一个操作系统级 sidecar 进程

而是：

- 在 `backend` 内新增一层“事件驱动的 turn policy orchestrator”
- 利用现有 `runtime.Manager + turns.Service + events.Hub + store.ThreadProjection + automations.Service` 完成 `PostToolUse` 与 `Stop` 的模拟

一句话概括：

- 对通用研究来说，方案叫 `app-server sidecar`
- 对 `codex-server` 来说，最佳实现形态应当是“内嵌式 sidecar 能力”

## 2. 为什么 `codex-server` 已经具备 sidecar 基座

### 2.1 总体架构本身就是 BFF + app-server

项目 README 和系统设计文档都明确了当前架构：

- 浏览器不直连 `codex app-server`
- 前端走 Go BFF / Gateway
- Go 后端再通过 stdio JSON-RPC 连接 `codex app-server`

相关位置：

- `README.md`
- `docs/system-design.md:17`
- `docs/system-design.md:23`

这和前面研究里“sidecar 作为 app-server 前面的控制面”在本质上是一致的。

### 2.2 `bridge.Client` 已经完成 stdio JSON-RPC 和握手

`backend/internal/bridge/client.go` 已经做了：

- 启动 `codex app-server`
- 建立 stdin/stdout/stderr
- 发送 `initialize`
- 发送 `initialized`
- 处理 response / notification / request

关键位置：

- `backend/internal/bridge/client.go:93`
- `backend/internal/bridge/client.go:134`
- `backend/internal/bridge/client.go:254`

这意味着：

- 新能力不需要重新实现 transport
- 研究成果里关于独立 Go sidecar 的 `transport/appserver` 设计，在 `codex-server` 里基本已经存在

### 2.3 `runtime.Manager` 已经把 app-server 事件转成后端统一事件流

`backend/internal/runtime/manager.go` 已经完成：

- workspace 级 runtime 生命周期管理
- 自动启动 app-server runtime
- active turn 追踪
- 处理 notification
- 处理 server request
- 发布 `EventEnvelope`

关键位置：

- `backend/internal/runtime/manager.go:165`
- `backend/internal/runtime/manager.go:277`
- `backend/internal/runtime/manager.go:291`
- `backend/internal/runtime/manager.go:456`
- `backend/internal/runtime/manager.go:486`

这部分和研究里的 sidecar `event_router + state feeder` 非常接近。

### 2.4 `turns.Service` 已经封装了 sidecar 需要的控制动作

`backend/internal/turns/service.go` 已经有：

- `Start` -> `turn/start`
- `Steer` -> `turn/steer`
- `Interrupt` -> `turn/interrupt`
- `resumeThread` -> `thread/resume`

关键位置：

- `backend/internal/turns/service.go:45`
- `backend/internal/turns/service.go:433`
- `backend/internal/turns/service.go:466`
- `backend/internal/turns/service.go:570`

也就是说，研究里 sidecar 需要的三种核心动作：

- `turn/start`
- `turn/steer`
- `turn/interrupt`

在项目里都已经有稳定封装。

### 2.5 `events.Hub` + `ThreadProjection` 已经具备事件订阅与快照基础

`backend/internal/events/hub.go` 已经支持：

- workspace 订阅
- 全局订阅
- 发布时同步写入 store

关键位置：

- `backend/internal/events/hub.go:35`
- `backend/internal/events/hub.go:67`
- `backend/internal/events/hub.go:87`
- `backend/internal/events/hub.go:132`

`backend/internal/store/thread_projection.go` 已经支持基于事件重建：

- `turn/started`
- `turn/completed`
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `item/commandExecution/outputDelta`
- `server/request/resolved`
- `server/request/expired`

关键位置：

- `backend/internal/store/thread_projection.go:37`
- `backend/internal/store/thread_projection.go:79`
- `backend/internal/store/thread_projection.go:98`
- `backend/internal/store/thread_projection.go:166`

这正是研究里 sidecar 做 `Stop / PostToolUse` 判定时最需要的“turn / item 真相层”。

### 2.6 `automations.Service` 已经提供了事件驱动和幂等模板

`backend/internal/automations/service.go` 已经证明：

- 可以全局订阅事件流
- 可以根据 `turn/completed` 驱动后续逻辑
- 可以用 `activeRunByThreadTurn`、`finalizingRuns` 做幂等控制

关键位置：

- `backend/internal/automations/service.go:157`
- `backend/internal/automations/service.go:780`
- `backend/internal/automations/service.go:862`
- `backend/internal/automations/service.go:897`
- `backend/internal/automations/service.go:914`

这部分可以直接复用为 `Stop / PostToolUse` 编排层的实现模式。

## 3. 当前研究成果在 `codex-server` 中的映射关系

下面把研究成果里的几个关键概念，映射到 `codex-server` 现有结构里。

### 3.1 “独立 sidecar process”

研究里原本的泛化方案：

- 一个独立进程作为 `app-server` 客户端

在 `codex-server` 中更好的映射：

- `backend` 内部服务层

原因：

- `bridge.Client` 已存在
- `runtime.Manager` 已存在
- 不需要额外 IPC
- 不需要额外部署面

### 3.2 “事件路由 + 状态聚合”

研究里的实现建议：

- event router
- state store
- turn / item 聚合

在 `codex-server` 中的对应物：

- `runtime.Manager` 负责把 app-server 事件转成 `EventEnvelope`
- `events.Hub` 负责发布
- `store.ThreadProjection` 负责聚合

### 3.3 “动作执行器”

研究里的动作执行器：

- `SendSteer`
- `SendInterrupt`
- `SendFollowUpTurn`

在 `codex-server` 中的对应物：

- `turns.Service.Steer`
- `turns.Service.Interrupt`
- `turns.Service.Start`

### 3.4 “去重/幂等”

研究里建议：

- 用 `threadId + turnId + policyName + evidence` 做 fingerprint
- 防止重复 `turn/completed` 导致重复续跑

在 `codex-server` 中的对应物：

- `automations.Service.activeRunByThreadTurn`
- `automations.Service.finalizingRuns`

因此：

- `codex-server` 不需要从零设计去重思路
- 可以把研究里更细的 fingerprint 机制叠加到现有幂等控制之上

## 4. 对 `codex-server` 最推荐的吸收方式

### 4.1 不建议的做法

不建议：

- 在 `codex-server` 外面再包一层新的独立 sidecar 进程

原因：

- 现有后端已经是 app-server 控制面
- 会重复实现 transport、事件转发和动作执行
- 会引入新的进程间状态同步问题

### 4.2 最推荐的做法

建议在 `backend/internal/` 下新增一个专用服务层，例如：

```text
backend/internal/turnpolicies/
  service.go
  posttooluse.go
  stop.go
  fingerprint.go
  templates.go
  config.go
```

或者：

```text
backend/internal/sidecarpolicy/
```

命名上更推荐 `turnpolicies`，因为它表达的是：

- 这不是另一个 OS 级 sidecar
- 而是 turn 级的后置策略与续跑编排服务

## 5. 推荐的目标架构

建议新增一层：

```text
frontend
   |
   v
api / ws
   |
   v
turnpolicies.Service
   |
   +--> events.Hub.SubscribeAll()
   +--> store.ThreadProjection / MemoryStore
   +--> turns.Service
   +--> runtime.Manager
   |
   v
codex app-server
```

其中职责划分建议如下。

### 5.1 `runtime.Manager`

继续负责：

- runtime 生命周期
- app-server 桥接
- notification / request 转发

不要把 `PostToolUse` / `Stop` 策略塞进去。

### 5.2 `turns.Service`

继续负责：

- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `thread/resume`

不要把复杂策略判断塞进去。

### 5.3 新增 `turnpolicies.Service`

新增负责：

- 全局订阅事件
- 识别 `item/completed` / `turn/completed`
- 构建 `PostToolUse` / `Stop` 判定 snapshot
- 运行策略
- 执行动作
- 去重与审计

### 5.4 `store.ThreadProjection`

继续作为：

- 构建 turn / item 真相快照的底座

必要时补一些更方便策略读取的 helper，但不要把策略逻辑塞进 store。

## 6. 如何在现有项目里模拟 `PostToolUse`

### 6.1 推荐触发点

直接监听：

- `item/completed`

因为这一点在研究里已经确认是最接近 native `PostToolUse` 的事件。

`codex-server` 当前也已经完整收到并持久化了这类事件：

- `runtime.Manager` 会 publish `item/completed`
- `ThreadProjection` 会 upsert item

### 6.2 推荐最小流程

在 `turnpolicies.Service` 中：

1. 收到 `item/completed`
2. 判断 item 类型是否属于受支持范围
   - `commandExecution`
   - `fileChange`
3. 从投影或事件本身构建 snapshot
4. 运行 `PostToolUse` policy
5. 若 verdict 是 `continue`
   - 优先调用 `turns.Service.Steer`
6. 若 verdict 是 `interrupt`
   - 调用 `turns.Service.Interrupt`
7. 若当前 turn 已结束或 `steer` 失败
   - 回退到新的 `turns.Service.Start`

### 6.3 在 `codex-server` 中这条链路的优势

相比重新造 sidecar，有几个明显优势：

- 已有 `ActiveTurnID` 追踪
  - `backend/internal/runtime/manager.go:277`
- 已有 `turn/steer` 封装
  - `backend/internal/turns/service.go:433`
- 已有 `turn/interrupt` 封装
  - `backend/internal/turns/service.go:466`
- 已有 turn/item 聚合快照
  - `backend/internal/store/thread_projection.go`

### 6.4 对应的最小可落地策略

建议第一条就做：

- 测试命令失败 -> `turn/steer`

理由：

- 检测简单
- 用户价值高
- 最接近研究中的“快纠偏”路径

## 7. 如何在现有项目里模拟 `Stop`

### 7.1 推荐触发点

直接监听：

- `turn/completed`

这和前面研究里的标准路径完全一致。

### 7.2 推荐最小流程

1. 收到 `turn/completed`
2. 从 `ThreadProjection` 获取该 turn 的最终视图
3. 构建 stop snapshot：
   - 最后 assistant message
   - 本轮 file changes
   - 本轮 command executions
   - 最新 diff
4. 运行 `Stop` policy
5. 若 verdict 是 `followUp`
   - 调用 `turns.Service.Start`
   - 注入 continuation prompt

### 7.3 最适合 `codex-server` 的第一条 `Stop` 规则

建议第一条做：

- 本轮改了文件，但没有有效验证 -> follow-up turn

这条规则：

- 不需要侵入 runtime 层
- 可以完全依赖现有投影数据
- 和前端当前的工作流也最一致

## 8. `codex-server` 现有项目里最值得复用的 6 个点

### 8.1 `bridge.Client`

复用点：

- 不再重复造 app-server transport

### 8.2 `runtime.Manager.ActiveTurnID`

复用点：

- `PostToolUse` 决定是否 `steer` 时直接使用

### 8.3 `turns.Service`

复用点：

- 所有动作统一走 service，而不是在新策略层里直接调 runtime

### 8.4 `events.Hub.SubscribeAll`

复用点：

- 新策略层可以像 `automations.Service` 一样全局订阅事件

### 8.5 `ThreadProjection`

复用点：

- 构建 turn snapshot
- 聚合 delta
- 持久化 server request 状态

### 8.6 `automations.Service` 的幂等结构

复用点：

- `activeRunByThreadTurn`
- `finalizingRuns`

可以直接借鉴为：

- `activePolicyByThreadTurn`
- `finalizingPolicyRuns`

## 9. 推荐新增的最小实现切片

下面是最小可落地的一组新增内容。

### 9.1 新包

```text
backend/internal/turnpolicies/
  service.go
  config.go
  snapshot.go
  posttooluse.go
  stop.go
  fingerprint.go
  templates.go
```

### 9.2 `Service` 依赖

建议依赖：

- `*events.Hub`
- `*store.MemoryStore`
- `*turns.Service`
- 可选：`*runtime.Manager`

### 9.3 `Service` 职责

- `Start(ctx)` 订阅 `SubscribeAll()`
- `handleEvent(event)`
- `handleItemCompleted(event)`
- `handleTurnCompleted(event)`
- `beginRun(fingerprint)`
- `endRun(fingerprint)`

### 9.4 新配置

建议先放进 runtime preferences 或服务配置里：

- `enablePostToolUsePolicies`
- `enableStopPolicies`
- `postToolUseSteerOnTestFailure`
- `stopRequireVerificationAfterFileChange`
- `turnPolicyMaxAutoFollowUpsPerTurn`

第一阶段不建议上复杂 DSL。

## 10. 推荐的幂等与去重设计

### 10.1 为什么 `codex-server` 需要比现在更细的去重

当前项目已经有：

- run 级幂等
- `turn/completed` finalization 防重

但如果要把研究里的 `PostToolUse` / `Stop` 策略引进来，还需要更细的策略级去重，否则容易出现：

- 同一 turn 被多个订阅者重复判断
- `item/completed` 和 `turn/completed` 之间重复补轮
- sidecar 注入消息再次被策略命中

### 10.2 推荐 fingerprint

建议最小字段：

- `workspaceId`
- `threadId`
- `turnId`
- `itemId`
- `policyName`
- `normalizedEvidence`

### 10.3 推荐沿用现有幂等模式

可以直接参考：

- `backend/internal/automations/service.go:862`
- `backend/internal/automations/service.go:897`
- `backend/internal/automations/service.go:914`

把它转成策略层版本，例如：

```text
activePolicyByThreadTurn
activePolicyByItem
finalizingPolicyRuns
```

## 11. 对前端和 API 的影响

### 11.1 第一阶段可以零前端改动起步

因为：

- 现有前端已经消费统一事件流
- 已经展示 turn / item 生命周期
- 已经支持审批抽屉与运行态提示

第一阶段完全可以只在后端里做：

- 自动 `steer`
- 自动 `interrupt`
- 自动 follow-up `turn/start`

### 11.2 第二阶段再考虑增加显式可见性

等策略稳定后，再补前端会更合理。可以考虑新增：

- “Policy injected message” 标记
- “为什么本轮被自动续跑” 的事件卡
- “策略命中日志” 面板

## 12. 对配置层的建议

### 12.1 不要把硬门禁转移到新策略层

研究里已经明确：

- sidecar 更适合运行后检查和续跑
- 真正的硬门禁仍应留给 approvals / sandbox

`codex-server` 当前已经支持 runtime preferences 中的：

- `DefaultTurnApprovalPolicy`
- `DefaultTurnSandboxPolicy`

相关位置：

- `backend/internal/store/models.go:38`
- `backend/internal/turns/service.go:259`

因此建议继续保持：

- approvals / sandbox 负责前置硬约束
- `turnpolicies.Service` 负责后置审查与自动续跑

### 12.2 不要第一阶段就做通用 DSL

第一阶段建议把规则写死为几个高价值布尔开关或简洁配置：

- 测试失败是否自动 steer
- 改了文件是否要求验证
- 命中禁止路径是否 interrupt

这样最利于快速验证价值。

## 13. 最推荐的实施顺序

### 阶段 A：最小策略层

目标：

- 建立 `turnpolicies.Service`
- 订阅事件总线
- 跑通一个 `PostToolUse` 规则
- 跑通一个 `Stop` 规则

### 阶段 B：幂等与审计

目标：

- 指纹去重
- 策略运行日志
- 失败回退路径

### 阶段 C：前端可见性

目标：

- 策略命中说明
- 自动续跑来源标记
- 调试与诊断入口

### 阶段 D：配置化扩展

目标：

- 把简单硬编码策略逐步抽成受控配置

## 14. 不建议的两条路线

### 14.1 不建议再造一个独立 Go sidecar 进程

原因：

- 与现有 Go backend 职责重叠
- 状态同步复杂
- 会重复实现 transport、event routing、actions

### 14.2 不建议把这套逻辑放到前端

原因：

- 前端拿不到稳定完整的运行时上下文
- 动作执行仍要回到后端
- 幂等和审计更难做

## 15. 一句话建议

如果要在 `codex-server` 中利用这轮研究成果，最优路径不是“再起一个 sidecar”，而是：

- 把 Go backend 视作现有 sidecar/BFF
- 在其内部新增一个 `turnpolicies.Service`
- 复用已有的 `bridge + runtime + turns + events + store + automations` 能力
- 先落两条高价值规则：
  - 测试失败 -> `turn/steer`
  - 改了文件未验证 -> follow-up `turn/start`

这条路线改动最小、复用最高，也最符合 `codex-server` 当前已经成型的架构。

## 16. 参考文件

- `README.md`
- `docs/system-design.md`
- `docs/development/codex-rust-v0.117.0-adaptation-plan.md`
- `backend/internal/bridge/client.go`
- `backend/internal/runtime/manager.go`
- `backend/internal/turns/service.go`
- `backend/internal/events/hub.go`
- `backend/internal/store/models.go`
- `backend/internal/store/thread_projection.go`
- `backend/internal/automations/service.go`
