# Codex `rust-v0.119.0` App-Server Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变当前本地 `stdio` 主链路的前提下，为 `codex-server` 明确 `rust-v0.119.0` 升级后的两项后续工作：一是补齐 `turn/start -> Responses` 的 `responsesapiClientMetadata` 透传能力；二是把 remote/websocket transport、remote-control、filesystem watch、exec-server 相关适配拆成独立的未来工作流，而不是与本次升级混做。

**Architecture:** 当前仓库的正确主路径仍然是“浏览器 -> Go BFF -> workspace runtime -> 本地 `codex app-server --listen stdio://` sidecar”。本计划将近期可交付项限定为“metadata 透传补齐”，并把 remote/workflow 相关事项作为条件触发的第二工作流单独规划，避免把尚未采用的运行架构提前耦合进现有实现。

**Tech Stack:** Go backend、React + Vite frontend、`codex app-server` JSON-RPC over stdio、Gorilla WebSocket、仓库现有 fake runtime / unit test 基线

---

更新时间：2026-04-11

## 1. 背景

基于对 `openai/codex` `rust-v0.119.0` release、相关 PR 说明和本仓库当前实现的静态比对，可以得出两个稳定判断：

1. `v0.119.0` 虽然包含多条与 app-server 相关的更新，但对当前仓库正在使用的本地 `stdio` 集成主链路，没有发现会直接打断运行的 breaking change。
2. 本次升级后真正值得进入实施 backlog 的事项只有两类：
   - 近期可直接落地的能力补齐：把 turn 级来源/追踪 metadata 透传到 Responses。
   - 未来可能启用、但当前不应混入主路径的架构变更：remote/websocket transport、remote-control、filesystem watch、exec-server。

这两个事项的优先级、风险和改动面完全不同，必须拆开处理。

## 2. 当前基线

### 2.1 当前真实主路径

当前仓库的 app-server 集成基线如下：

- 默认 runtime 命令仍然是 `codex app-server --listen stdio://`。
- `runtime.Manager` 负责为每个 workspace 启动一个本地 runtime 实例。
- `bridge.Start(...)` 通过本地子进程 `stdin/stdout/stderr` 与 app-server 交换 JSON-RPC。
- 浏览器和后端之间虽然使用 WebSocket 推送 workspace/thread 事件，但这不是 Codex runtime 的 remote transport。

这意味着：

- 只要主路径仍是本地 `stdio://`，`v0.119.0` 中针对 remote/workflow 的大多数改动都不会进入当前关键路径。
- 当前实现对 `cwd`、workspace root、本地文件路径约束和 runtime 生命周期的假设，仍然建立在“app-server 与 Go BFF 运行在同一主机或同一文件系统视图”之上。

### 2.2 当前 `turn/start` 的实际能力边界

当前仓库自定义的 `appserver.TurnStartRequest` 只覆盖最小字段集合：

- `input`
- `threadId`
- `collaborationMode`
- `model`
- `effort`
- `approvalPolicy`
- `sandboxPolicy`

当前链路中没有任何 turn 级 metadata 透传：

- 前端 turn API 没有 metadata 参数。
- `backend/internal/api/router.go` 的 `handleStartTurn` 没有读取 metadata。
- `turns.StartOptions` 没有 metadata 槽位。
- `buildTurnStartRequestWithRuntimeDefaults(...)` 也没有往 `turn/start` payload 中组装 metadata。

因此，升级到 `v0.119.0` 不会因为缺少该字段而坏掉，但仓库也无法利用该版本新增的 metadata 前传能力。

### 2.3 仓库中已经存在但尚未下沉的来源上下文

尽管 `turn/start` 现在不带 metadata，仓库业务层已经有一批可用于追踪来源和关联运行上下文的字段：

- bot 路径已有 `sourceType`、`sourceRefType`、`sourceRefId`、`originWorkspaceId`、`originThreadId`、`originTurnId`
- bot debug trace 已有 `traceId` / `deliveryId`
- automation 路径已有稳定 `runId`、`automationId`、`trigger`
- 线程路径天然已有 `workspaceId` / `threadId`

这说明 metadata 透传不是凭空增加一个字段，而是把已经存在的业务上下文继续向下游 Responses 扩展。

## 3. 本文档的目标与范围

## 3.1 目标

本文档用于明确两条后续工作流：

1. **工作流 A：`responsesapiClientMetadata` 支持**
   - 补齐 turn 级 metadata 透传能力
   - 优先覆盖 interactive、bot、automation 三类来源
   - 不改变当前 API 主体语义和默认 UI 交互

2. **工作流 B：future remote/workflow 适配拆分**
   - 仅做实施分解和触发条件定义
   - 不在当前版本中默认接入 remote transport
   - 不把未采用架构提前掺入现有主链路

## 3.2 非目标

以下事项不属于本计划的直接落地范围：

- 不把默认 runtime 从本地 `stdio://` 切到 remote/websocket transport
- 不把 `exec-server` 作为当前 `command/exec` 或 `thread/shellCommand` 的替代实现
- 不实现 `filesystem watch` 的独立产品化 UI
- 不向前端开放任意形态、未经约束的用户自定义 Responses metadata 透传
- 不因为 `v0.119.0` 而对 `config/*`、`fs/*`、`thread/*` 主链路做预防性重构

## 4. 总体策略

### 4.1 一条近期交付，一条条件触发

本计划将后续工作拆成两个工作流：

- **工作流 A**：立即进入实现 backlog，原因是收益明确、改动集中、与当前主链路直接相关。
- **工作流 B**：仅在产品或架构决策明确要求 remote runtime / watch / exec-server 时才启动。

### 4.2 保持现有架构重心不漂移

当前 `codex-server` 的架构重心是“Web BFF + 本地 workspace runtime”。因此本计划坚持以下原则：

- 任何新增字段或逻辑都必须优先服务当前 `stdio` 路径。
- 所有未来 remote 能力都必须以显式 feature flag、显式 runtime profile 或显式 transport implementation 引入。
- 不允许为了未来可能的 remote 场景，提前污染当前本地路径的核心数据流和权限边界。

## 5. 工作流 A：`responsesapiClientMetadata` 支持

### 5.1 目标

在 `turn/start` 请求中新增可选的 `responsesapiClientMetadata` 字段，把 `codex-server` 侧已有的来源和追踪上下文继续透传给 app-server / Responses。

本工作流的直接收益如下：

- 区分本次 turn 是 interactive、bot 还是 automation 发起
- 让 Responses 侧能够关联 workspace、thread、automation run、bot delivery 等上下文
- 为后续排查“上游请求”和“本地下游线程/投递/任务”之间的关联问题提供稳定锚点
- 不影响未使用 metadata 的现有调用路径

### 5.2 设计原则

#### 原则 1：server-owned metadata

本次 metadata 只允许由后端构造和注入，不允许前端自由写入任意键值。原因很明确：

- 当前需求主要来自 tracing、来源分类和内部 run 关联
- 若前端可任意传入，将带来结构漂移、审核困难和潜在敏感字段泄露风险
- 当前仓库已经有足够的服务端上下文，无需把 metadata 构造责任推回前端

#### 原则 2：最小但稳定

第一版 metadata 只覆盖最有价值的一组字段，不做“全量镜像业务对象”：

- 必备上下文：`source`、`origin`、`workspaceId`、`threadId`
- bot 扩展：`botConnectionId`、`botDeliveryId`、`botSourceType`
- automation 扩展：`automationId`、`automationRunId`、`automationTrigger`
- trace 扩展：`serverTraceId`

第一版不传：

- 原始用户输入
- 完整 bot delivery 对象
- 完整 automation run 对象
- 任何密钥、token、文件路径、代理配置等敏感内容

#### 原则 3：空值即省略

如果某个来源上下文不存在，对应 metadata key 直接省略，不发送空字符串填充。原因如下：

- 减少 payload 噪音
- 避免下游把“空字符串”和“字段不存在”误判为不同语义
- 让单元测试更稳定，减少无意义字段比较

#### 原则 4：向后兼容优先

如果下游 app-server 版本不识别该字段，应确保：

- 字段整体是可选的
- metadata 构造失败时不影响 turn 启动
- 只有在 metadata 非空时才把字段写入 payload

### 5.3 推荐字段模型

第一版推荐采用扁平键值模型，而不是深层嵌套对象：

```json
{
  "responsesapiClientMetadata": {
    "source": "interactive",
    "origin": "codex-server-web",
    "workspaceId": "ws_123",
    "threadId": "thread_456",
    "serverTraceId": "trace_789",
    "automationId": "auto_001",
    "automationRunId": "run_002",
    "automationTrigger": "schedule",
    "botConnectionId": "bot_conn_003",
    "botDeliveryId": "delivery_004",
    "botSourceType": "manual"
  }
}
```

采用扁平结构的原因：

- 更容易在日志、debug dump 和上游筛选条件里直接查看
- 更容易做单元测试断言
- 避免过早承诺嵌套 schema

### 5.4 来源映射规则

#### Interactive 路径

interactive 路径由普通 Web thread turn 触发。第一版固定注入：

- `source=interactive`
- `origin=codex-server-web`
- `workspaceId`
- `threadId`

如后端已有可用 trace id，则可追加：

- `serverTraceId`

#### Bot 路径

bot 路径在 interactive 基础上追加：

- `source=bot`
- `botConnectionId`
- `botDeliveryId`
- `botSourceType`

如果 bot 路径本身绑定了来源线程，也允许继续保留：

- `workspaceId`
- `threadId`

第一版不继续透传：

- `sourceRefType`
- `sourceRefId`
- `originTurnId`

原因是这些字段对调试有帮助，但不是第一版的必需条件，且会扩大映射面。

#### Automation 路径

automation 路径在 interactive 基础上追加：

- `source=automation`
- `automationId`
- `automationRunId`
- `automationTrigger`

如果 automation 在内部事件流中已经有一致的 run id，该字段必须与运行时事件中的 `runId` 保持同源，避免出现两个不同的 run 标识。

### 5.5 代码改动边界

#### 需要修改的文件

- `backend/internal/appserver/types.go`
- `backend/internal/turns/service.go`
- `backend/internal/bots/workspace_thread_backend.go`
- `backend/internal/automations/service.go`
- `backend/internal/diagnostics/thread_trace.go`
- `backend/internal/turns/service_test.go`
- `backend/internal/bots/workspace_thread_backend_test.go`
- `backend/internal/automations/service_test.go`
- `backend/internal/runtime/manager_test.go` 或 fake runtime 断言路径

#### 推荐新建的文件

- `backend/internal/turns/metadata.go`

该文件只负责：

- metadata 字段名常量
- metadata 组装函数
- 来源分类 helper
- 省略空值逻辑

不建议把 metadata 构造继续塞回 `service.go`，否则 `turns` 文件会进一步膨胀。

### 5.6 分阶段实施

#### 阶段 A1：协议类型补齐

目标：

- 为 `TurnStartRequest` 增加可选 `ResponsesAPIClientMetadata map[string]any`

动作：

- 在 `backend/internal/appserver/types.go` 中增加字段
- JSON tag 使用实验字段名 `responsesapiClientMetadata,omitempty`
- 不改动已有字段名，不重命名已有请求结构

退出条件：

- 新字段存在但默认不发送

#### 阶段 A2：turn 层 metadata 组装

目标：

- 让 `turns.StartOptions` 能承接 metadata 来源上下文

动作：

- 在 `backend/internal/turns/service.go` 中为 `StartOptions` 增加 metadata 槽位
- 新建 `backend/internal/turns/metadata.go`，提供 `buildResponsesAPIClientMetadata(...)`
- `buildTurnStartRequestWithRuntimeDefaults(...)` 在 metadata 非空时把字段写入请求
- `buildTurnStartPayloadWithRuntimeDefaults(...)` 同步把 metadata 写入 trace payload，便于日志排查

退出条件：

- interactive 路径可生成基础 metadata
- metadata 构造逻辑集中在单一 helper 文件

#### 阶段 A3：interactive 路径接入

目标：

- 普通 Web turn 自动带基础 metadata

动作：

- `handleStartTurn` 仍保持现有 REST 请求体，不新增前端入参
- 后端在调用 `turns.Start(...)` 时自动注入 `source=interactive`
- 优先使用服务端已有 `workspaceId/threadId`

退出条件：

- 前端 API 无需改动即可获得基础 metadata 透传

#### 阶段 A4：bot / automation 路径接入

目标：

- 把 bot 与 automation 的来源上下文补进 turn metadata

动作：

- `backend/internal/bots/workspace_thread_backend.go` 在调用 `turns.Start(...)` 时注入 bot 元数据
- `backend/internal/automations/service.go` 在调用 `turns.Start(...)` 时注入 automation 元数据
- 保证 bot / automation 的上下文字段和其已有事件、日志模型保持同源

退出条件：

- bot 与 automation 路径能各自生成最小 metadata 集合

#### 阶段 A5：测试与回归

目标：

- 证明新字段存在时请求正确，缺省时行为不变

必须覆盖的测试：

- `turns` 单元测试：
  - metadata 为空时不输出该字段
  - interactive 路径输出 `source/origin/workspaceId/threadId`
  - full-access preset 与 metadata 可以共存
- bot 单元测试：
  - turn 请求包含 `source=bot`
  - `botConnectionId`、`botDeliveryId` 命中预期
- automation 单元测试：
  - turn 请求包含 `source=automation`
  - `automationId`、`automationRunId`、`automationTrigger` 命中预期
- runtime/fake 测试：
  - `turn/start` 请求体新增字段后不会打破现有 fake app-server 行为

退出条件：

- 所有新增测试通过
- 现有 `turn/start` 主链路测试不回退

#### 阶段 A6：文档与验收说明

目标：

- 为后续升级和排查保留明确说明

动作：

- 更新升级说明文档
- 在相关开发文档中写明该字段是“可选透传能力，不是运行必需项”
- 记录 metadata 字段白名单，避免后续随意扩张

退出条件：

- 仓库中存在可供后续开发者复核的字段说明和边界定义

### 5.7 风险与控制

#### 风险 1：metadata 键名持续漂移

控制方式：

- 把字段集中在 `turns/metadata.go` 里定义
- 在文档中固定第一版白名单
- 禁止在调用侧直接手写 `map[string]any`

#### 风险 2：bot / automation 字段来源不一致

控制方式：

- metadata 只读取已经稳定存在的 store / runtime 上下文
- 不新建第二套 run id 或 delivery id

#### 风险 3：未来误把前端开放成任意 metadata 透传

控制方式：

- 第一版不改前端 API 合同
- 任何开放式 metadata 需求都必须另立设计说明

### 5.8 工作流 A 验收标准

满足以下条件即可视为工作流 A 完成：

- 普通 interactive turn 会携带基础 metadata
- bot turn 会携带 bot 来源 metadata
- automation turn 会携带 automation run metadata
- metadata 为空时，`turn/start` 请求与当前行为保持一致
- 现有 thread 创建、resume、shell、config、fs 主链路不受影响

## 6. 工作流 B：future remote/workflow 适配拆分

### 6.1 为什么必须单独拆分

remote/websocket transport、remote-control、filesystem watch、exec-server 虽然都出现在 `v0.119.0` 相关更新中，但它们不属于当前仓库已采用的运行架构。

如果把这类事项与当前升级混做，会造成三个问题：

1. 把“本地 `stdio` 主路径升级”与“未来架构迁移”混成同一个任务，优先级失真。
2. 让当前围绕本地 workspace root、`cwd`、`fs/*`、`config/*` 建立的假设提前失效。
3. 在尚未明确产品需求前，为远端路径引入大量抽象层和状态机复杂度。

因此，本工作流在当前阶段只做触发条件、子课题拆分和执行顺序定义，不直接进入默认实现。

### 6.2 触发条件

只有在满足以下任一条件时，才应启动工作流 B：

- 产品明确要求 Codex runtime 可运行在远端机器或远端容器
- 需要以 websocket transport 连接 app-server，而不是本地子进程
- 需要把 `filesystem watch` 暴露成可见的 Web 产品能力
- 需要把 `exec-server` 纳入命令执行或文件操作主路径
- 需要对 runtime 做独立 remote-control，而不再由当前 workspace-local manager 主导

若以上条件都不满足，本工作流保持为“文档级储备方案”即可。

### 6.3 拆分后的子工作流

#### Track B1：Transport 抽象重构

目标：

- 把当前“bridge = 本地子进程 + stdio”的假设抽离成 transport 接口

涉及文件：

- `backend/internal/bridge/client.go`
- `backend/internal/runtime/manager.go`
- 新建 `backend/internal/runtime/transport` 或等价目录

实施要点：

- 保留 `stdio` 实现为默认 transport
- 新增 `remote-websocket` transport 仅作为可选实现
- transport 抽象只处理连接、收发、关闭，不处理业务级线程状态

风险：

- 抽象过早或过厚，会让当前本地路径变复杂

#### Track B2：Workspace 路径与 `cwd` 语义重定义

目标：

- 明确“后端看到的 workspace root”和“remote runtime 看到的工作目录”是否仍为同一概念

涉及文件：

- `backend/internal/threads/service.go`
- `backend/internal/configfs/service.go`
- `backend/internal/execfs/service.go`

实施要点：

- 禁止继续默认假设本地绝对路径能直接传给远端 runtime
- 为 remote runtime 定义路径映射、路径授权和路径显示策略
- 明确 `thread/start` / `thread/resume` 的 `cwd` 来源

风险：

- 若路径语义不先定清楚，`config/*`、`fs/*`、`thread/*` 都会出现半兼容状态

#### Track B3：`config/*` 与 `fs/*` 语义重新校准

目标：

- 明确 remote runtime 下，哪些配置与文件方法仍然可以直接沿用，哪些必须改成 broker 或代理调用

涉及文件：

- `backend/internal/configfs/service.go`
- `backend/internal/execfs/service.go`
- 相关 API router 与测试文件

实施要点：

- 单独梳理 `config/read`、`config/value/write`、`config/batchWrite`
- 单独梳理 `fs/remove`、`fs/copy`、`fs/createDirectory`、`fs/metadata`
- 对“workspace root 内路径校验”补一个 remote 语义版本，不得直接复用本地 `filepath.Rel(...)` 逻辑

风险：

- 继续复用本地路径校验会制造虚假的安全感

#### Track B4：命令执行模型分叉评估

目标：

- 明确 `command/exec`、`thread/shellCommand`、`exec-server` 三者未来的职责边界

涉及文件：

- `backend/internal/threads/service.go`
- `backend/internal/execfs/service.go`
- thread 页面终端相关前端代码

实施要点：

- 决定 `exec-server` 是替代、补充，还是独立能力
- 明确是否需要命令执行 capability 探测
- 明确 remote runtime 下 stdout、resume、process id 的稳定语义

风险：

- 若不先定义边界，就会出现三套命令入口并存但行为不一致

#### Track B5：事件模型与前端状态同步

目标：

- 让 remote runtime 的通知、状态恢复和错误模型在前端可见且不破坏现有 thread live state

涉及文件：

- `backend/internal/api/router.go`
- `backend/internal/runtime/manager.go`
- `frontend/src/pages/threadLiveState.ts`
- `frontend/src/features/notifications/notificationStreamUtils.ts`
- thread page / workbench 相关状态层

实施要点：

- 区分“浏览器到 BFF 的 WebSocket 事件流”和“BFF 到 Codex runtime 的 remote transport”
- 定义 remote transport 断开、重连、半开状态、重新订阅行为
- 明确 `command/exec` 输出回放与 thread 事件恢复的优先级

风险：

- 若仍把两层 WebSocket 混在一起描述，排障和监控都会失真

#### Track B6：配置、权限与运维控制面

目标：

- 让 remote runtime 的配置、认证与启停控制具备明确入口

涉及文件：

- `backend/internal/config/config.go`
- `backend/internal/servercmd/*`
- 相关 Settings 文档与页面

实施要点：

- 定义 remote runtime 所需配置项
- 定义是否允许按 workspace 选择 transport
- 定义 remote-control 的权限边界与审计点

风险：

- 若控制面定义不清，后续会把 transport 配置散落在环境变量、设置页和命令行参数中

### 6.4 推荐执行顺序

当工作流 B 被正式启动时，推荐顺序如下：

1. `Track B1` transport 抽象
2. `Track B2` 路径与 `cwd` 语义
3. `Track B3` `config/*` / `fs/*` 重校准
4. `Track B4` 命令执行边界
5. `Track B5` 事件模型与前端状态
6. `Track B6` 配置与控制面

原因很明确：

- 没有 transport 抽象，后续所有改造都无处落脚
- 没有路径语义，文件与配置能力无法判断谁是权威
- 没有命令执行边界和事件模型，前端无法做稳定恢复

### 6.5 工作流 B 的前置产物

工作流 B 在动代码之前，必须先产出一份独立的架构 spike 文档，至少回答以下问题：

- remote runtime 的权威 workspace root 是谁定义的
- BFF 是否仍然拥有文件系统代理职责
- `exec-server` 是否进入默认命令执行主路径
- remote transport 失败时的降级策略是什么
- 前端如何区分“后端事件流已连通”与“runtime remote transport 已连通”

若这些问题没有定稿，不应进入代码实现阶段。

### 6.6 工作流 B 验收标准

只有满足以下条件，才可认为 remote/workflow 适配完成：

- 本地 `stdio` 路径仍可独立工作
- remote transport 可以在 feature flag 下稳定启用
- `thread/start`、`thread/resume`、`turn/start`、`command/exec` 在 remote 模式下语义清晰
- `config/*` 与 `fs/*` 的远端行为不依赖本地路径碰巧可用
- 前端能稳定展示 remote runtime 的连接状态与恢复状态

## 7. 推荐里程碑

### Milestone 0：维持当前 `stdio` 基线

输出：

- 继续把本地 `stdio` 作为唯一默认 transport
- 不把 remote/workflow 事项混入升级阻塞项

### Milestone 1：完成工作流 A

输出：

- `responsesapiClientMetadata` 在 interactive、bot、automation 三类 turn 路径全部可用

### Milestone 2：形成工作流 B spike

输出：

- 一份独立 remote/runtime 架构设计文档
- 明确是否真的要进入 remote transport 实施

### Milestone 3：如有需要，再进入工作流 B 实装

输出：

- 以 feature flag 或独立 runtime profile 方式逐步接入

## 8. 测试与回归建议

### 8.1 工作流 A 冒烟回归

完成 metadata 支持后，至少回归以下调用：

- `initialize` / `initialized`
- `thread/start`
- `thread/resume`
- `turn/start`
- `thread/shellCommand`
- `command/exec`
- `config/read`
- `config/value/write`
- `fs/remove`
- `fs/copy`

重点观察：

- 新 metadata 字段不会让 turn 启动失败
- bot / automation 路径不会出现 metadata 丢失或 run id 错配
- trace 日志可看到 metadata 是否存在，但不泄露敏感值

### 8.2 工作流 B 启动前的额外验证

若未来启动 remote/workflow 适配，应额外建立以下测试基线：

- fake remote transport 进程级测试
- 断开重连与订阅恢复测试
- 远端路径映射测试
- remote `config/*` / `fs/*` 语义测试
- 远端 `command/exec` 输出恢复测试

## 9. 主要风险总表

| 风险 | 影响 | 控制方式 |
| --- | --- | --- |
| 将 metadata 能力误判为 breaking fix | 不必要地扩大改动面 | 明确工作流 A 是能力补齐，不是兼容性修补 |
| 提前为 remote 场景重构主路径 | 影响当前稳定性 | 工作流 B 仅在触发条件满足后启动 |
| metadata 结构失控 | 日志、调试、兼容性变差 | 采用白名单和集中 helper |
| 本地路径语义直接沿用到 remote | 文件与配置行为错误 | 在工作流 B 中单独重定义路径与授权语义 |
| 三套命令执行能力边界不清 | UI 行为混乱 | 在 Track B4 先做职责划分，再做实现 |

## 10. 最终结论

`rust-v0.119.0` 对当前仓库的正确处理方式不是“大范围适配”，而是分两步：

1. 立即补齐 `responsesapiClientMetadata`，把现有 interactive、bot、automation 的来源上下文继续透传给 Responses。
2. 把 remote/websocket transport、remote-control、filesystem watch、exec-server 全部归入独立 future workstream，仅在产品明确要求时再启动。

这样做的好处很直接：

- 当前升级不会被未来架构迁移拖住
- 近期收益能尽快落地
- 未来若真的进入 remote runtime 方向，也有清晰的拆分基线，而不是临时拼接

## 11. 实施入口建议

若按优先级执行，建议下一步直接进入以下顺序：

1. 新建 `backend/internal/turns/metadata.go`
2. 为 `TurnStartRequest` 增加 `responsesapiClientMetadata`
3. 先接 interactive 路径
4. 再接 bot / automation 路径
5. 完成单元测试和 fake runtime 断言
6. 最后更新升级文档

如果后续产品决定评估 remote runtime，再单独基于本文档第 6 节生成一份新的架构实施计划，不与工作流 A 混做。
