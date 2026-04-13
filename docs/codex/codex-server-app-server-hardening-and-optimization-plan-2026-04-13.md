# Codex Server App-Server Hardening And Optimization Plan

**Goal:** 基于对 `CodexPotter` 与当前 `codex-server` 的 app-server 集成方式对比，为 `codex-server` 制定一份可执行的 bridge / runtime / protocol 优化方案。在不改变当前“Go BFF + workspace runtime + 本地 `codex app-server --listen stdio://` sidecar”主架构的前提下，补强协议稳健性、故障诊断、生命周期一致性与升级兼容性。

**Architecture:** 保持当前单层 Web BFF 直连 upstream `codex app-server` 的架构，不引入 CodexPotter 的外层控制平面，不把多轮 project runner 语义混入现有 workspace/thread 主路径。本方案聚焦于 bridge 层、runtime 管理层、turn/thread 生命周期层和审批请求建模层的工程化加固。

**Tech Stack:** Go backend、React + Vite frontend、`codex app-server` JSON-RPC over stdio、本地 workspace runtime sidecar、现有 `events.Hub` / `store.MemoryStore` / runtime preferences / fake runtime 测试基线

---

更新时间：2026-04-13

## 1. 背景与结论

通过对比当前仓库与 `E:\projects\ai\CodexPotter` 的 app-server 接入方式，可以得到三个稳定判断：

1. 当前仓库的主路径和 CodexPotter 的目标不同，因此**不应照搬** CodexPotter 的“双层 app-server + 多轮控制平面”架构。
2. 当前仓库已经具备稳定的长生命周期 runtime 管理、审批 UI、事件广播、thread 持久化、bot/automation 扩展能力，说明其**总体架构方向是正确的**。
3. CodexPotter 在 bridge 稳健性、协议建模、stderr 诊断、server request 兜底和 turn 生命周期一致性方面，存在若干可以直接转化为本仓库收益的工程化细节，适合以小步增量方式吸收。

一句话概括：

- **保留当前 `codex-server` 的架构主轴。**
- **借鉴 CodexPotter 的 bridge 层硬化方法，而不是复制其产品形态。**

## 2. 当前基线

### 2.1 当前主路径

当前仓库真实主路径是：

- 浏览器 / bot / REST API
- Go BFF
- `runtime.Manager` 按 workspace 管理长生命周期 runtime 实例
- 本地 `codex app-server --listen stdio://`
- JSON-RPC over stdio

对应核心实现：

- `backend/internal/bridge/client.go`
- `backend/internal/runtime/manager.go`
- `backend/internal/threads/service.go`
- `backend/internal/turns/service.go`
- `backend/internal/approvals/service.go`

### 2.2 当前已具备的优势

当前仓库已经具备下列能力，这些能力不应在优化过程中被破坏：

- workspace 级 runtime 复用，避免每次 turn 都重启 app-server
- 审批请求持久化与前端审批 UI
- `turn/start`、`turn/interrupt`、`turn/steer`、`review/start` 等上层服务抽象
- `thread/read`、历史 turn / item 回放与 thread 投影缓存
- bot/automation 路径对 thread 的复用与流式等待
- `turnpolicies.Service` 对验证失败和缺少成功验证的自动补救
- runtime preferences 对 approval policy / sandbox policy / model catalog 的服务级配置能力

### 2.3 当前主要薄弱点

与 CodexPotter 对比后，当前实现的主要薄弱点集中在以下几个方向：

1. server request 缺少“显式建模 + unsupported 即失败”的策略，未知 request 可能进入 pending 队列后无法被 resolve。
2. bridge 层对 upstream 协议的类型化程度不足，notification 和 request 仍大量依赖 `map[string]any`。
3. runtime 启动方式仍以 shell command 字符串为主，扩展成本和跨平台 quoting 风险偏高。
4. stderr 只保留最近一行到 `LastError`，启动失败与异常退出缺少可复现上下文。
5. active turn 生命周期跟踪仍偏保守，终态方法集合和 interrupt 幂等语义可以更稳。
6. 缺少显式的 transient app-server 错误分层与 recovery 标记，前端/机器人侧只能把很多问题统称为失败。

## 3. 方案目标

本方案的目标是：

1. 提升 app-server 协议升级时的兼容性和可观测性。
2. 避免未知 server request 导致 thread 长时间卡住。
3. 提升 runtime 启动失败、异常退出和 protocol decode 问题的定位效率。
4. 统一 turn 生命周期边界，降低 interrupt / resume / settle 的灰区。
5. 为未来继续升级 upstream protocol、扩展 remote transport 或加入更复杂自动化行为打下清晰边界。

## 4. 非目标

以下事项不属于本方案的实施范围：

- 不引入 CodexPotter 风格的 `codex-potter app-server` 外层控制平面。
- 不把当前架构改造成“每轮一个新 app-server 进程”的模型。
- 不把审批系统改成默认 auto-accept / auto-cancel 模式。
- 不在本轮同时推进 remote websocket transport、exec-server、filesystem watch 产品化。
- 不要求前端一次性改造成和 CodexPotter TUI 同构的事件模型。

## 5. 总体策略

按收益和落地风险，本方案拆为三个优先级：

- **P0：主链路加固**
  - server request registry 与 unsupported request 兜底
  - stderr ring buffer 与 richer diagnostics
  - turn terminal lifecycle / interrupt 幂等硬化
- **P1：bridge 建模升级**
  - 精简 typed protocol façade
  - 结构化 runtime launch config
- **P2：恢复与可观测性增强**
  - transient stream / runtime error 分类
  - recovery marker / reconnect marker
  - session snapshot / thread startup metadata 加强

推荐实施顺序：

1. 先做 P0，解决“会卡住、难排障、状态不一致”的问题。
2. 再做 P1，降低未来协议升级和参数扩展成本。
3. 最后做 P2，把 error recovery 从“黑盒重试”推进到“显式分类、显式展示”。

## 6. 工作流 A：Server Request Registry 与 Unsupported Request 兜底

### 6.1 问题陈述

当前 runtime 收到 server request 后，会优先：

- 交给 `ServerRequestInterceptor`
- 若未处理则进入 pending requests 存储
- 再由审批 API / 前端手动响应

该模型对已知 request 没问题，但对未知 request 存在隐患：

- request 已被持久化并暴露给 UI
- 但 `approvals.Service` 未必知道如何构造响应 payload
- 用户最终可能无法 resolve
- thread 可能持续等待该 request

### 6.2 目标

建立一个 bridge 层级别的 server request registry，明确每类 request 的处理策略：

- `interactive_supported`
- `auto_handle`
- `unsupported`

### 6.3 设计原则

#### 原则 1：unsupported request 不应静默挂起

任何当前仓库明确不支持的 request，都应在 bridge/runtime 层立刻进入一种确定结局，而不是仅作为 pending item 暴露给前端。

#### 原则 2：interactive 能力与 payload 生成能力必须绑定

只有当前端和后端都已经具备完整请求表单与响应 payload 构造能力时，某个 request 才能被标记为 `interactive_supported`。

#### 原则 3：auto-handle 仅限安全且语义明确的场景

例如治理层为了阻断危险 dynamic tool call 而直接返回失败，属于明确的 auto-handle；但审批类 request 默认仍应维持人工决策。

### 6.4 方案设计

新增一个 server request registry 层，建议位置：

- `backend/internal/appserver/server_requests.go`
- 或 `backend/internal/runtime/server_requests.go`

建议建模：

```go
 type ServerRequestHandlingMode string
 
 const (
     ServerRequestInteractive ServerRequestHandlingMode = "interactive"
     ServerRequestAutoHandle  ServerRequestHandlingMode = "auto_handle"
     ServerRequestUnsupported ServerRequestHandlingMode = "unsupported"
 )
 
 type ServerRequestDescriptor struct {
     Method string
     Mode   ServerRequestHandlingMode
 }
```

第一版 registry 至少覆盖：

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`
- `item/tool/call`
- `applyPatchApproval`
- `execCommandApproval`
- `account/chatgptAuthTokens/refresh`

### 6.5 实施步骤

- [ ] 新增 server request descriptor 与 lookup 逻辑。
- [ ] 在 `runtime.instance.HandleRequest(...)` 进入 pending 存储前先查询 registry。
- [ ] 对 `unsupported` request：
  - 记录 diagnostics/event
  - 直接向 upstream 返回错误响应或确定性 deny/cancel
  - 不进入 pending 存储
- [ ] 对 `interactive_supported` request：保留当前 pending + approvals 流程。
- [ ] 对 `auto_handle` request：走 interceptor 或 builtin response，不进入 pending。
- [ ] 在 `approvals.Service` 中只接受 registry 标记为 `interactive_supported` 的方法。
- [ ] 为 unsupported request 增加面向前端/日志的明确 reason code，例如：
  - `unsupported_server_request`
  - `unsupported_request_method`

### 6.6 主要改动文件

- `backend/internal/runtime/manager.go`
- `backend/internal/approvals/service.go`
- `backend/internal/appserver/*` 或新增 registry 文件
- `backend/internal/api/router.go`（如需补错误码映射）
- `frontend/src/features/approvals/*`（如果需要展示“不支持”的特殊状态）

### 6.7 测试要求

- 未知 request 不再进入 pending requests。
- 未知 request 会生成明确 diagnostics/event。
- 已知 interactive request 仍保留原有审批行为。
- 已知 auto-handle request 不会回归为 pending。
- 现有审批 API 对已支持 request 的行为保持不变。

## 7. 工作流 B：精简 Typed Protocol Façade

### 7.1 问题陈述

当前仓库虽然已有 `backend/internal/appserver/types.go`，但覆盖面仍然偏请求侧；notification 和 server request 主链路仍大量依赖 `map[string]any` 动态解码。这样做短期灵活，但在以下场景会增加成本：

- upstream protocol 升级时很难快速定位影响面
- 新 request / notification 的字段名、可空性和状态枚举容易在运行期才暴露问题
- 事件投影、审批 UI、runtime diagnostics 无法共享同一套协议语义源

### 7.2 目标

引入一个“精简而不是大而全”的 protocol façade，仅对当前仓库已经进入关键路径的 request / response / notification / server request 做强类型建模。

### 7.3 设计原则

#### 原则 1：只覆盖关键路径

不追求把 `schema-out/` 中所有结构都搬成 Go 类型；只覆盖当前真实消费的那些方法。

#### 原则 2：bridge 层和业务层共享协议定义

避免 runtime、approvals、threads、turns 各自手写同一组 method string 和 payload 键名。

#### 原则 3：保留兼容宽松解码

对尚未稳定或并非关键路径的 payload，仍允许保留 fallback 的 `map[string]any` / `json.RawMessage` 处理。

### 7.4 第一阶段推荐覆盖面

#### 请求 / 响应

- `initialize`
- `thread/start`
- `thread/resume`
- `thread/rollback`
- `turn/start`
- `turn/interrupt`
- `turn/steer`
- `review/start`

#### server request

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`
- `item/tool/call`
- `applyPatchApproval`
- `execCommandApproval`
- `account/chatgptAuthTokens/refresh`

#### notification

- `turn/started`
- `turn/completed`
- `hook/started`
- `hook/completed`
- `item/started`
- `item/completed`
- `thread/tokenUsage/updated`
- guardian review started/completed

### 7.5 实施步骤

- [ ] 新建 `backend/internal/appserver/protocol` 包，或在现有 `appserver` 下分 `common / v1 / v2`。
- [ ] 把关键 request / response / server request 迁入该层。
- [ ] 在 `runtime.Manager` 中优先使用 typed decode，失败时才 fallback 到 generic payload。
- [ ] 把审批层的 payload 生成从“按 method switch 拼 map”逐步迁到 typed response builder。
- [ ] 明确 protocol update 流程：
  - 升级 upstream binary
  - 同步 `schema-out`
  - 审查 typed façade 差异
  - 补测试

### 7.6 主要改动文件

- `backend/internal/appserver/types.go`
- 新增 `backend/internal/appserver/protocol/*`
- `backend/internal/runtime/manager.go`
- `backend/internal/approvals/service.go`
- `backend/internal/threads/service.go`
- `backend/internal/turns/service.go`

### 7.7 测试要求

- typed decode 成功路径单元测试
- typed decode 失败 fallback 到 dynamic decode 的兼容测试
- server request response builder 的 schema 对齐测试
- protocol upgrade 差异测试或 golden fixture 测试

## 8. 工作流 C：结构化 Runtime Launch Config

### 8.1 问题陈述

当前 runtime 启动仍围绕一条 shell command 字符串展开：

- `CODEX_APP_SERVER_COMMAND`
- `ResolveCodexRuntime(...)` 对字符串做追加和拼接
- `bridge.Start(...)` 通过 shell 执行整条命令

这种模式已有一定扩展能力，但随着以下需求增加，复杂度会持续上升：

- `model_catalog_json` 等 `--config` 覆盖继续扩展
- 日后可能增加 `CODEX_HOME`、更多 env、更多运行时偏好
- Windows / Unix quoting 差异
- 参数审计与可重复诊断

### 8.2 目标

引入内部结构化 launch config，把“用户提供的 base command”和“系统构造的 runtime options”分开管理，在真正启动 `exec.Cmd` 前统一渲染。

### 8.3 设计原则

#### 原则 1：保留现有环境变量兼容性

外部接口仍兼容 `CODEX_APP_SERVER_COMMAND`，但内部不再把所有逻辑绑死在字符串替换上。

#### 原则 2：先内部结构化，再决定是否暴露更多配置

第一阶段只做内部建模，不新增前端设置项。

#### 原则 3：日志中保留结构化启动快照

runtime 启动时应能记录：

- executable
- args
- cwd
- injected env keys
- runtime preference summary

### 8.4 推荐建模

```go
 type RuntimeLaunchOptions struct {
     Executable string
     Args       []string
     Cwd        string
     Env        map[string]string
     Display    string
 }
```

建议把配置链路拆为两步：

1. `ResolveCodexRuntime(...)` 解析并归一化 launch intent
2. `bridge.Start(...)` 接受结构化 `RuntimeLaunchOptions` 而不是 shell command 字符串

### 8.5 实施步骤

- [ ] 新增 launch options 结构体。
- [ ] 让 `ResolveCodexRuntime(...)` 返回结构化结果，而不只是拼好的 command string。
- [ ] 保留 shell string 作为 `Display` / compatibility 字段，便于日志与 UI 展示。
- [ ] `bridge.Start(...)` 改为优先走结构化启动；仅在兼容模式下保留 shell fallback。
- [ ] 为 Windows/Unix 分别补参数渲染测试，确保 `model_catalog_json`、代理与路径覆盖不回归。

### 8.6 主要改动文件

- `backend/internal/config/config.go`
- `backend/internal/bridge/client.go`
- `backend/internal/runtime/manager.go`
- 相关 config / runtime / servercmd 测试

### 8.7 测试要求

- `model_catalog_json` 注入后得到稳定 args
- Windows quoting 与 Unix quoting golden test
- `CODEX_APP_SERVER_COMMAND` 兼容路径不回归
- runtime state / diagnostics 能输出结构化 launch 摘要

## 9. 工作流 D：Stderr Ring Buffer 与 Rich Diagnostics

### 9.1 问题陈述

当前 runtime 对 stderr 的处理只保留最近一行到 `state.LastError`。这在以下场景会明显不够：

- app-server 启动失败
- initialize / protocol decode 失败
- child process 异常退出
- 某次 request 前后出现 stderr 异常，但最终 error 只剩最后一句

### 9.2 目标

为每个 runtime 增加 bounded stderr ring buffer，并在启动失败、异常退出、bridge 关闭等关键节点把 stderr 摘要并入 diagnostics / state。

### 9.3 设计原则

#### 原则 1：有界缓存

只保留最近固定大小，例如：

- 最近 32 KiB 或
- 最近 200 行

防止长时间运行的 runtime 无限占用内存。

#### 原则 2：错误摘要与运行态分离

`LastError` 保留简洁摘要；完整 stderr tail 走单独字段，例如：

- `LastError`
- `RecentStderr`
- `RecentStderrTruncated`

#### 原则 3：只暴露必要上下文

默认 API 不必把全部 stderr 原样返回给前端常规页面，但诊断接口、debug logging 或 admin 视图应可访问末尾摘要。

### 9.4 实施步骤

- [ ] 在 `runtime.instance` 上增加 stderr ring buffer。
- [ ] `HandleStderr` 改为追加 ring buffer，而不只是覆盖 `LastError`。
- [ ] `HandleClosed` 和 `ensureStarted` 失败路径将 stderr tail 追加到 diagnostics。
- [ ] 为 runtime state 增加可选字段：
  - `RecentStderr`
  - `RecentStderrTruncated`
- [ ] 视产品需求决定是否提供只读调试接口查看最近 stderr。

### 9.5 主要改动文件

- `backend/internal/runtime/manager.go`
- `backend/internal/api/router.go`（如新增调试接口）
- `backend/internal/diagnostics/*`

### 9.6 测试要求

- stderr 缓冲区有界
- 超过限制时正确截断
- 启动失败时 error 能带上 stderr 摘要
- 正常运行中 `LastError` 与 `RecentStderr` 行为符合预期

## 10. 工作流 E：Turn Lifecycle 与 Interrupt 幂等硬化

### 10.1 问题陈述

当前 runtime active turn 跟踪主要依赖：

- `turn/started` 记 active turn
- `turn/completed` 清 active turn

这对多数路径够用，但仍存在改进空间：

- 其他终态方法如 `turn/failed`、`turn/interrupted`、`turn/canceled`、`turn/cancelled` 没有统一作为 active turn 清理信号
- `Interrupt(...)` 仍需在 service 层做较多兜底
- 不同模块对“turn 终态”的认识尚未完全统一

### 10.2 目标

把 active turn 的 lifecycle 尽量收敛到 runtime/bridge 层，减少上层 service 对 protocol 细节的依赖。

### 10.3 设计原则

#### 原则 1：统一 terminal turn semantics

定义一组 bridge 层共享的“turn 终态方法 / 终态状态”集合，供 runtime、turncapture、bots、thread projection 共同复用。

#### 原则 2：interrupt 视为幂等操作

如果 upstream 已经没有 active turn，`turn/interrupt` 应尽量表现为 no-op，而不是把“稍晚到达的终态事件”和“调用错误”混成 fatal。

#### 原则 3：将协议细节吸收在下层

上层 `turns.Service` 仍保留业务语义，但不再承担太多 upstream 特定错误码解释逻辑。

### 10.4 实施步骤

- [ ] 新增 terminal turn method / status helper。
- [ ] 在 `runtime.instance.trackTurn(...)` 中统一处理：
  - `turn/completed`
  - `turn/failed`
  - `turn/interrupted`
  - `turn/canceled`
  - `turn/cancelled`
- [ ] 在 `turns.Service.Interrupt(...)` 中明确区分：
  - truly failed interrupt
  - no active turn / already terminal
  - timeout 后 recycle
- [ ] 若 upstream 返回可识别的“invalid request because turn already completed”错误，将其归为幂等成功。
- [ ] 复用这套 helper 到 bots / capture / projection 层，减少各处手写 method 集合。

### 10.5 主要改动文件

- `backend/internal/runtime/manager.go`
- `backend/internal/turns/service.go`
- `backend/internal/turncapture/capture.go`
- `backend/internal/bots/workspace_thread_backend.go`
- 相关测试文件

### 10.6 测试要求

- 所有 terminal turn 方法都能清理 active turn
- double interrupt 或 late interrupt 不会把 thread 弄成异常状态
- timeout recycle 行为不回归
- bots 等待 turn settle 时对 interrupted/failed/cancelled 的行为保持可预测

## 11. 工作流 F：Transient Runtime Error Classification 与 Recovery Markers

### 11.1 问题陈述

当前仓库已经有：

- `thread not loaded` 时自动 `thread/resume` + retry `turn/start`
- turn policy 的 follow-up / steer / interrupt 机制
- bot 侧 turn settle 等待

但仍缺少一层更明确的 app-server 瞬时错误分类，例如：

- runtime stdout 中断
- initialize 后短时间异常退出
- 某些 `error` notification 明确带有 retryable 语义
- stream 暂态错误和真正 turn failure 没被前端显式区分

### 11.2 目标

引入一层最小恢复分类，不先上复杂自动 continue，只先实现：

- 瞬时错误识别
- recovery / reconnect marker 事件
- 前端与 bot 可感知的可重试态

### 11.3 设计原则

#### 原则 1：先分类，再自动化

第一阶段不要直接实现 CodexPotter 风格的 auto-`Continue`。先建立一层清晰的 error taxonomy。

#### 原则 2：Web 用户路径与 bot/automation 路径分开处理

Web 用户线程优先展示“可重试 / 已恢复 / 需要手动重试”的明确状态；bot/automation 将来如需自动恢复，可在独立策略层开启。

#### 原则 3：恢复标记事件是 bridge 责任

这类 marker 不应由前端通过 heuristics 猜测，而应由 runtime/bridge 层显式发布。

### 11.4 第一阶段建议

新增几类工作区/线程事件：

- `runtime/recovering`
- `runtime/recovered`
- `runtime/reconnect_required`
- `turn/retryable_error`

并在 diagnostics 中记录：

- 分类结果
- 触发条件
- 是否已经 recycle runtime
- 是否影响 active turn

### 11.5 实施步骤

- [ ] 盘点当前可识别错误：`thread not loaded`、runtime timeout、unexpected close、retryable notification 等。
- [ ] 新增错误分类 helper。
- [ ] runtime recycle 或 resume retry 时显式发布 marker event。
- [ ] 前端 live event / status state 接入 marker 展示。
- [ ] bot 路径先只感知这些 marker，不自动继续 turn。

### 11.6 主要改动文件

- `backend/internal/runtime/*`
- `backend/internal/turns/service.go`
- `backend/internal/events/*`
- `frontend/src/pages/thread-page/*`
- `frontend/src/types/api.ts`

### 11.7 测试要求

- thread not loaded -> resume retry 仍然成功
- runtime timeout -> recycle 后状态明确
- unexpected close -> marker event 正常发出
- 前端状态不会把 recoverable error 误渲染为最终 fatal

## 12. 不建议照搬的内容

以下 CodexPotter 特性在当前仓库中不建议直接引入：

### 12.1 外层控制平面 app-server

CodexPotter 的外层 app-server 是为多轮 project、round replay 和 progress-file 驱动工作流服务的，不适合直接叠加到当前 workspace/thread Web BFF 主链路。

### 12.2 非交互默认 auto-accept 审批

当前仓库的核心能力之一就是可视化审批与人工决策，因此不能把审批主链路改成默认 auto-accept。未来如 bot/automation 需要无人值守 fallback，应单独做策略开关，不应污染人工交互默认路径。

## 13. 推荐里程碑

### Milestone 1：主链路硬化

目标：先解决卡住与难排障问题。

- [ ] 工作流 A：server request registry
- [ ] 工作流 D：stderr ring buffer
- [ ] 工作流 E：turn lifecycle / interrupt 幂等

完成标志：

- 未知 request 不会再把 thread 卡成 pending 死锁
- runtime 启动失败能够快速定位
- active turn 状态更稳，interrupt 语义一致

### Milestone 2：bridge 建模升级

目标：降低协议升级成本。

- [ ] 工作流 B：typed protocol façade
- [ ] 工作流 C：structured launch config

完成标志：

- 新版 upstream 协议差异可以集中落在 protocol façade 审查中
- runtime 启动参数可结构化诊断

### Milestone 3：恢复与可观测性增强

目标：让 recoverable failure 可被显式识别和展示。

- [ ] 工作流 F：transient error classification + marker events

完成标志：

- 前端、bot、diagnostics 可以区分可恢复错误与最终失败
- 为未来 bot/automation 自动恢复保留清晰扩展点

## 14. 回归与验证清单

实施本方案后，至少需要完整回归以下能力面：

- `thread/start`
- `thread/resume`
- `thread/read`
- `thread/rollback`
- `turn/start`
- `turn/interrupt`
- `turn/steer`
- `review/start`
- `command/exec`
- approvals UI / `requestUserInput` / MCP elicitation
- bot workspace thread backend 流式等待
- thread projection / live events / rail metrics
- runtime preferences 中 approval policy / sandbox policy / model catalog override

建议最小验证命令：

```bash
cd backend
go test ./...
```

如涉及前端事件类型和审批/状态展示，再补：

```bash
cd frontend
npm test
npm run build
```

## 15. 最终建议

如果只允许先做一轮低风险优化，推荐落地顺序如下：

1. **Server Request Registry 与 Unsupported Request 兜底**
2. **Stderr Ring Buffer 与 Rich Diagnostics**
3. **Turn Lifecycle 与 Interrupt 幂等硬化**
4. **精简 Typed Protocol Façade**
5. **结构化 Runtime Launch Config**
6. **Transient Runtime Error Classification 与 Recovery Markers**

其中前 3 项是最小且最能直接提升运行稳定性的组合；后 3 项则主要降低未来 protocol 升级与功能扩展的成本。
