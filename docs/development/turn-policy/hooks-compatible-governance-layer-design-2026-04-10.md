# `codex-server` hooks-compatible 治理层替代 turn policy 自动干预方案

更新时间：2026-04-10

适用项目：

- `E:\projects\ai\codex-server`

关联文档：

- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-implementation-status-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-max-utilization-plan-2026-04-09.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-api-and-ui-usage-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\hooks-governance-coverage-matrix-2026-04-10.md`
- `E:\projects\ai\codex-server\docs\system-design.md`

外部前提说明：

- 本文对官方 Codex hooks 的限制判断，基于 2026-04-10 时用户已核对的文档页 `https://developers.openai.com/codex/hooks`。
- 该前提包括：官方 hooks 仍处于 experimental；Windows 当前临时禁用；`PreToolUse` / `PostToolUse` 目前只覆盖 Bash，不覆盖 MCP、Write、WebSearch 等非 shell 工具。
- 后续校对：`openai/codex` `rust-v0.120.0` 已移除 Windows hooks gate，因此“Windows 当前临时禁用”只代表本文写作时的历史前提，不再代表最新事实；但本文保留本地 hooks-compatible 治理层的核心理由不变，因为多工具面覆盖、统一审计与线程时间线暴露仍未由官方原生 hooks 完整替代。
- 因此，本文目标不是“直接切换到官方原生 hooks”，而是让 `codex-server` 自身具备一套与官方语义兼容、但不受其当前平台限制约束的本地治理层。

## 1. 执行摘要

当前 `codex-server` 的 turn policy 机制已经证明有价值，但它更像“事后补救器”，还不是“执行期治理层”。

问题不在于配置项数量不够，而在于治理位置过晚：

- `backend/internal/turnpolicies/service.go` 当前只在 `item/completed` 与 `turn/completed` 两个后置事件上触发规则。
- `backend/internal/turnpolicies/rules.go` 的两条核心规则都依赖“工具已经执行完、文件已经改完、turn 已经结束”之后再回看。
- `backend/internal/turnpolicies/validation.go` 对“验证”的识别仍然是命令前缀匹配，本质属于字符串启发式。
- `backend/internal/store/thread_projection.go` 当前没有 hook 原生概念，线程投影无法展示治理层自身的生命周期。
- `frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx` 当前只展示 turn policy decisions 和 metrics，没有 hook run 的显式可见性。

因此，本文给出的核心结论是：

1. `turnpolicies.Service` 不应继续承担主治理职责。
2. 应新增一层 hooks-compatible 的本地治理层，事件语义对齐官方 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`。
3. hooks 负责同步判定、执行前 veto、执行中续跑与结束门禁。
4. 现有 turn policy 退到审计、指标和 fallback。
5. 设计上必须支持 Windows，且必须覆盖 Bash 之外的工具面。

一句话概括：

- 目标不是“把 turn policy 修补得更聪明”，而是“把治理前移到执行期”，并让 `codex-server` 形成一套可以兼容官方 hooks 语义的本地治理底座。

## 2. 当前实现为何脆弱

### 2.1 当前机制的真实落点

截至 2026-04-10，仓库里已经存在的 turn policy 能力主要包括：

- `backend/internal/turnpolicies/service.go`
  - 订阅 `events.Hub`
  - 在 `item/completed` 上执行“失败验证补救”
  - 在 `turn/completed` 上执行“缺少成功验证补跑”
- `backend/internal/turnpolicies/rules.go`
  - `evaluateFailedValidationCommand`
  - `evaluateMissingVerificationTurn`
- `backend/internal/turnpolicies/validation.go`
  - `isValidationCommand`
  - `ResolveValidationCommandPrefixes`
- `backend/internal/store/turn_policy_decisions.go`
  - 决策事实持久化
- `backend/internal/turnpolicies/metrics.go`
  - thread / workspace KPI 汇总
- `frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx`
  - thread rail 上的 decisions 和 metrics 展示

这说明现阶段并不是“毫无治理能力”，而是“治理能力位置不对”。

### 2.2 现有机制的结构性短板

现有实现的短板不是偶然 bug，而是结构性的：

1. 它不能在危险输入提交前阻断。
   - 当前没有 `UserPromptSubmit` 这一层。
   - 例如用户粘贴 token、要求在错误目录执行、缺失复现信息等，都无法在 turn 启动前同步处理。

2. 它不能在工具执行前 veto。
   - 当前没有 `PreToolUse`。
   - 命令和工具一旦真正执行，就只能在 `item/completed` 后再做补救。

3. 它只能在事后推断“发生了什么”。
   - `evaluateFailedValidationCommand` 需要等命令失败。
   - `evaluateMissingVerificationTurn` 需要等 turn 完整结束。

4. 它对“验证”只有前缀匹配语义。
   - `isValidationCommand(command, prefixes)` 本质仍然是字符串前缀识别。
   - 这不利于后续扩展更丰富的验证语义，例如按工具类型、路径、工作区规则、语言生态来判定。

5. 它的自动动作依赖模型配合。
   - 现在的自动纠偏主要通过 `turn/steer`、follow-up 或 `interrupt` 补一刀。
   - 一旦模型不配合、上下文漂移或重复收尾，治理效果会明显不稳定。

6. 它没有 hook 级别的可观测性。
   - 当前 thread UI 展示的是“policy decision 结果”，不是“治理层在什么时候、对哪个输入、以什么理由做过判断”。
   - 对用户来说，系统仍然像“神秘插手”。

### 2.3 结论

继续在现有 turn policy 上叠更多规则，只会把事后补救做得更复杂，不会从根上解决治理位置过晚的问题。

因此，最合理的路线不是：

- 继续给 `turnpolicies.Service` 加更多字符串规则

而是：

- 把治理主轴迁移到 hooks-compatible 生命周期层
- 把 `turnpolicies.Service` 留作审计、指标、兼容迁移和 fallback

## 3. 设计目标与非目标

### 3.1 设计目标

本方案的目标如下：

1. 把治理从“事后补救”前移到“执行期治理”。
2. 事件语义尽量对齐官方 hooks，降低未来与原生 hooks 接轨的成本。
3. 不依赖官方当前的 Windows 与 Bash 限制。
4. 在 Bash 之外覆盖 `commandExecution`、`thread/shellCommand`、`command/exec`、文件写入类 item、关键 MCP 工具。
5. 保留现有 turn policy 的审计与指标沉淀，不推翻已有资产。
6. 让 hook run 成为 thread 内可见、可解释、可复盘的一等事件。
7. 保持渐进迁移，而不是一次性重写全部运行链路。

### 3.2 非目标

本方案当前不追求：

1. 第一期就引入复杂 DSL。
2. 第一期就支持任意脚本型 hook handler 的完全开放式编排。
3. 第一期就把所有 UI 从 turn policy 切换为 hook 专用视图。
4. 第一期就依赖官方 runtime 原生 hooks 作为唯一实现来源。

## 4. 目标架构

### 4.1 总体判断

目标架构应当是“双层治理”：

- 第一层：`Hook Engine`
  - 承担同步判定、执行前阻断、执行后续跑、结束门禁
- 第二层：`turnpolicies.Service`
  - 承担审计记录、指标汇总、兼容 fallback、历史视图

也就是：

- hooks 是主治理层
- turn policy 是审计与 fallback 层

### 4.2 目标结构图

```text
User / Automation / Bot Input
        |
        v
Hook Engine
  |- SessionStart
  |- UserPromptSubmit
  |- PreToolUse
  |- PostToolUse
  |- Stop
        |
        | 同步判定 / 阻断 / 改写 / 续跑
        v
Runtime / Tool Dispatch / Turn Lifecycle
        |
        v
Events Hub
  |- item/*
  |- turn/*
  |- thread/*
  |- hook/started
  |- hook/completed
        |
        +--> ThreadProjection / HookRun store / UI
        |
        +--> turnpolicies.Service
                |- 审计
                |- 指标
                |- fallback
```

### 4.3 新增模块建议

建议新增 `backend/internal/hooks/` 包，承担以下职责：

- `Engine`
  - 统一运行 hook
- `Registry`
  - 注册 builtin hook 与配置化 hook
- `Matcher`
  - 匹配事件、工具、路径、source、scope
- `Runner`
  - 统一执行 handler
- `Builtin`
  - 内建治理规则
- `Bridge`
  - 接入 runtime 生命周期与工具拦截点
- `StoreAdapter`
  - 持久化 `HookRun`
- `EventEmitter`
  - 发出 `hook/started`、`hook/completed`

对应地，现有 `backend/internal/turnpolicies/` 应保留，但职责收缩为：

- `TurnPolicyDecision` 持久化
- KPI 汇总
- fallback 触发
- 历史指标 API

## 5. Hook Engine 设计

### 5.1 核心抽象

建议将 Hook Engine 的核心抽象稳定为四层：

1. `HookInvocation`
   - 一次治理调用的标准输入
   - 包含 event、scope、source、thread/turn/item、工具元数据、上下文摘要

2. `HookHandler`
   - 一个具体规则执行单元
   - 可以是 builtin，也可以是配置化 handler，未来也可以桥接官方 native hook

3. `HookDecision`
   - 一个 hook 对当前调用给出的规范化决策

4. `HookRun`
   - 一次 hook 实际执行的持久化与 UI 可见事实记录

### 5.2 决策模型

建议统一成一套比当前 turn policy 更明确的决策语义：

- `continue`
  - 正常放行，不追加上下文
- `continueWithContext`
  - 放行，但注入附加上下文
- `modifyInput`
  - 放行，但改写 prompt 或工具输入
- `requireApproval`
  - 放行前要求审批
- `block`
  - 阻断当前动作
- `continueTurn`
  - 阻止本次“正常结束”，并把 reason 作为 continuation prompt 继续当前线程

这套模型与官方 hooks 语义的对应关系如下：

- `block` 对应官方 hook 的阻断决策
- `continueTurn` 对应官方 `Stop` 中“block 但继续 turn”的语义
- `modifyInput` / `continueWithContext` 对应官方 hooks 的 `updated_input` / `additional_context` 类能力

### 5.3 执行模式

建议区分两类模式：

- `sync`
  - 用于真正会影响执行结果的 hook
  - 包括 `UserPromptSubmit`、`PreToolUse`、`Stop`
- `async`
  - 用于仅做审计、注释、附加上下文准备的 hook
  - 包括部分 `SessionStart`、部分 `PostToolUse`

第一期建议：

- `SessionStart` 支持 `sync` 与 `async`
- `UserPromptSubmit` 必须 `sync`
- `PreToolUse` 必须 `sync`
- `PostToolUse` 默认 `sync`
- `Stop` 必须 `sync`

### 5.4 执行顺序

建议 hook handler 执行顺序如下：

1. 系统 builtin hook
2. workspace / project 配置化 hook
3. native runtime hook 导入适配器
4. 观测型 async hook

规则：

- 终局性决策优先，出现 `block` 或 `continueTurn` 后停止同一事件链后续 handler。
- 非终局性结果可以累积，例如多个 `continueWithContext` 条目可合并。
- 同一事件的执行顺序必须稳定，避免“同配置不同次序”导致行为漂移。

### 5.5 失败策略

Hook Engine 不能因为自身异常把整个系统变成高波动源，因此建议区分：

- `fail-open`
  - hook 执行失败时记录失败并放行
- `fail-closed`
  - hook 执行失败时视同阻断

默认建议：

- `UserPromptSubmit` / `PreToolUse` / `Stop` 默认 `fail-open`
- 高风险内建规则可单独配置 `fail-closed`
  - 例如危险删除阻断
  - 例如明显 secret 泄漏阻断

## 6. 生命周期事件模型

### 6.1 事件名

建议事件名与官方 hooks 保持一致：

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

### 6.2 事件职责与当前 turn policy 的映射

| 事件 | 触发时机 | 主要用途 | 与当前能力的映射 |
| --- | --- | --- | --- |
| `SessionStart` | thread 建立、resume、runtime 附着时 | 预热项目规则、目录约束、source 上下文 | 当前无等价能力 |
| `UserPromptSubmit` | 用户/自动化/bot 输入提交前 | 输入治理、敏感信息阻断、上下文注入 | 当前无等价能力 |
| `PreToolUse` | 工具实际执行前 | 危险命令 veto、路径写入保护、审批门禁 | 当前无等价能力 |
| `PostToolUse` | 工具完成后、turn 继续前 | 快纠偏、失败补救、补充上下文 | 对应当前 `posttooluse/failed-validation-command` |
| `Stop` | turn 进入收尾前 | 缺少验证门禁、强制继续验证 | 对应当前 `stop/missing-successful-verification` |

### 6.3 事件输入模型

建议所有事件都共享一个统一基础字段：

- `workspaceId`
- `threadId`
- `turnId`
- `itemId`
- `source`
  - `interactive`
  - `automation`
  - `bot`
  - `other`
- `cwd`
- `eventName`
- `triggerMethod`
- `ts`

在此基础上按事件扩展：

#### `SessionStart`

- `threadStatus`
- `runtimeStatus`
- `projectRoot`
- `threadSource`
- `workspacePreferencesSnapshot`

#### `UserPromptSubmit`

- `promptText`
- `attachmentsSummary`
- `composerMode`
- `selectedTools`
- `currentThreadSummary`

#### `PreToolUse`

- `toolKind`
  - `commandExecution`
  - `thread/shellCommand`
  - `command/exec`
  - `fileChange`
  - `mcpToolCall`
  - `webSearch`
- `toolName`
- `input`
- `normalizedCommand`
- `pathTargets`
- `riskFlags`
- `approvalContext`

#### `PostToolUse`

- `toolKind`
- `toolName`
- `input`
- `output`
- `status`
- `exitCode`
- `stdoutTail`
- `stderrTail`
- `aggregatedOutputTail`
- `generatedPaths`

#### `Stop`

- `turnItemsSummary`
- `fileChanges`
- `successfulVerifications`
- `failedVerifications`
- `pendingApprovals`
- `finalAgentMessagePreview`

### 6.4 事件输出模型

建议 Hook Engine 对所有事件统一输出：

```json
{
  "decision": "continue",
  "reason": "string",
  "additionalContext": "string",
  "updatedInput": {},
  "requireApproval": false,
  "entries": [
    { "kind": "context", "text": "..." }
  ]
}
```

其中：

- `decision`
  - `continue`
  - `continueWithContext`
  - `modifyInput`
  - `requireApproval`
  - `block`
  - `continueTurn`
- `reason`
  - 既用于 UI 展示，也用于 continuation prompt
- `entries`
  - 与官方 `HookOutputEntry` 风格保持一致
  - 建议支持 `warning`、`stop`、`feedback`、`context`、`error`

## 7. 第一阶段必须覆盖的工具面

官方 hooks 当前 `PreToolUse` / `PostToolUse` 只覆盖 Bash，这正是 `codex-server` 不应直接依赖官方 runtime 的原因之一。

本地 Hook Engine 第一阶段建议覆盖下列工具面：

| 工具面 | 当前仓库证据 | 建议 hook 覆盖 | 备注 |
| --- | --- | --- | --- |
| `commandExecution` | thread item 已存在 | `PreToolUse` + `PostToolUse` | 核心治理对象 |
| `thread/shellCommand` | UI 与文档已存在 | `PreToolUse` + `PostToolUse` | unsandboxed，优先级高 |
| `command/exec` | app-server surface 已存在 | `PreToolUse` + `PostToolUse` | terminal dock 路径必须覆盖 |
| `fileChange` / patch 写入 | schema 与审批流已存在 | `PreToolUse` + `PostToolUse` | 可先从审批与写入入口接 |
| `mcpToolCall` | 协议 item 类型已存在 | 至少 `PostToolUse` | 截至 2026-04-10 已实现的是审计型 `PostToolUse`，不是原生前置门禁 |
| `webSearch` | 协议 item 类型已存在 | 至少 `PostToolUse` | 初期偏审计 |

这里的关键不是“所有工具一口气拦满”，而是：

- 不能只治理 Bash
- 不能漏掉 `thread/shellCommand`
- 不能漏掉 `command/exec`

截至 2026-04-10 的仓库真实覆盖状态，建议结合
`E:\projects\ai\codex-server\docs\development\turn-policy\hooks-governance-coverage-matrix-2026-04-10.md`
一起阅读。需要特别区分：

- `item/tool/call` 是当前 runtime 可同步前置拦截的 `ServerRequest`
- `mcpServer/elicitation/request` 当前只落显式 `ServerRequest` 审计
- 关键 `mcpToolCall` 当前只落审计型 `PostToolUse`，不应与 native MCP pre-exec gate 混为一谈

否则治理层会天然出现“最危险链路反而不拦”的漏洞。

## 8. 内建 hook 设计

### 8.1 应优先内建的四类 hook

建议第一阶段先做四类内建 hook：

1. `builtin.stop.require-successful-verification`
   - 替代当前 `stop/missing-successful-verification`

2. `builtin.posttooluse.failed-validation-rescue`
   - 替代当前 `posttooluse/failed-validation-command`

3. `builtin.pretooluse.dangerous-command-guard`
   - 阻断危险删除、危险路径写入等

4. `builtin.userprompt.sensitive-input-guard`
   - 阻断 token、密钥等明显敏感内容误贴

### 8.2 当前两条规则的精确替代方式

#### 8.2.1 失败验证补救

当前：

- 由 `item/completed` 触发
- 仅识别 `commandExecution`
- 依据命令前缀 + 失败状态做事后补救

替代后：

- 改为 `PostToolUse` 内建 hook
- 输入包含完整工具元数据
  - `toolKind`
  - `toolName`
  - `cwd`
  - `exitCode`
  - `stdout/stderr/aggregatedOutput`
  - `source`
  - `thread/turn/item`
- 输出支持：
  - `continue`
  - `continueWithContext`
  - `continueTurn`

推荐默认行为：

- 对失败的验证型工具返回 `continueTurn`
- continuation reason 沿用当前 prompt 语义，但由 hook 直接驱动，而不是等 turn policy 再 follow-up

#### 8.2.2 缺少成功验证门禁

当前：

- 由 `turn/completed` 触发
- turn 已结束后才补一轮 follow-up

替代后：

- 改为 `Stop` 内建 hook
- 在 turn 准备结束时检查：
  - 是否存在 `fileChange`
  - 是否存在后续成功验证
  - 是否已经有同类 hook 连续续跑过
- 不满足时返回 `continueTurn`

这会比当前实现更符合官方 `Stop` 语义，也更符合“别结束，先验证完”的真实目标。

### 8.3 续跑上限与防循环

`continueTurn` 如果没有边界，会变成新型循环器，因此必须内建以下保护：

- 同一 turn / 同一 hook / 同一证据指纹的最大续跑次数
- 最短冷却时间
- 达到上限后降级为：
  - 记录 `HookRun` 为 `blocked`
  - turn policy fallback 不再重复触发
  - UI 显示“已达治理上限”

## 9. 数据模型与存储设计

### 9.1 新增 `HookRun`

建议在 `backend/internal/store/models.go` 中新增独立模型，而不是把 hook 结果硬塞进 `TurnPolicyDecision`：

```go
type HookRun struct {
    ID              string
    WorkspaceID     string
    ThreadID        string
    TurnID          string
    ItemID          string
    EventName       string
    HandlerKey      string
    HandlerType     string
    Provider        string
    ExecutionMode   string
    Scope           string
    TriggerMethod   string
    ToolKind        string
    ToolName        string
    Status          string
    Decision        string
    Reason          string
    Fingerprint     string
    AdditionalContext string
    UpdatedInput    any
    Entries         []HookOutputEntry
    Source          string
    Error           string
    StartedAt       time.Time
    CompletedAt     *time.Time
    DurationMs      *int64
}
```

建议状态枚举尽量对齐官方协议：

- `running`
- `completed`
- `failed`
- `blocked`
- `stopped`

### 9.2 `TurnPolicyDecision` 不删除，但增加来源语义

现有 `TurnPolicyDecision` 仍然应保留，因为它已经是指标与历史视图的数据源。

建议新增可选字段：

- `GovernanceLayer`
  - `hook`
  - `turnPolicyFallback`
- `HookRunID`
  - 用于追溯是哪个 hook 触发了该决策

这样可以实现：

- hook 成为执行主因
- decision 仍保留为审计与 KPI 事实表

### 9.3 线程投影扩展

当前 `backend/internal/store/thread_projection.go` 没有 hook 分支。

建议增加：

- `hook/started`
- `hook/completed`

并把 `ThreadProjection` 扩展为：

```go
type ThreadProjection struct {
    ...
    HookRuns []ThreadHookRun `json:"hookRuns,omitempty"`
}
```

`ThreadHookRun` 建议只保留 thread UI 需要的摘要字段：

- `id`
- `turnId`
- `itemId`
- `eventName`
- `handlerKey`
- `status`
- `decision`
- `reason`
- `source`
- `startedAt`
- `completedAt`

这样可以避免把完整 hook payload 全部塞进 projection。

### 9.4 事件总线新增事件

建议新增两类事件：

- `hook/started`
- `hook/completed`

`hook/started` 示例：

```json
{
  "workspaceId": "ws_123",
  "threadId": "thread_123",
  "turnId": "turn_456",
  "itemId": "item_789",
  "method": "hook/started",
  "payload": {
    "run": {
      "id": "hook_001",
      "eventName": "PreToolUse",
      "handlerKey": "builtin.pretooluse.dangerous-command-guard",
      "status": "running",
      "toolKind": "thread/shellCommand",
      "toolName": "thread/shellCommand",
      "triggerMethod": "thread/shellCommand",
      "startedAt": "2026-04-10T10:00:00Z"
    }
  }
}
```

`hook/completed` 示例：

```json
{
  "workspaceId": "ws_123",
  "threadId": "thread_123",
  "turnId": "turn_456",
  "itemId": "item_789",
  "method": "hook/completed",
  "payload": {
    "run": {
      "id": "hook_001",
      "eventName": "PreToolUse",
      "handlerKey": "builtin.pretooluse.dangerous-command-guard",
      "status": "blocked",
      "decision": "block",
      "reason": "dangerous_recursive_delete",
      "completedAt": "2026-04-10T10:00:00Z",
      "durationMs": 4
    }
  }
}
```

## 10. API 与前端可见性

### 10.1 API 建议

建议新增只读 API：

- `GET /api/workspaces/{workspaceId}/hook-runs`
  - 支持 `threadId`
  - 支持 `eventName`
  - 支持 `status`
  - 支持 `handlerKey`
  - 支持 `limit`

可选第二阶段再加：

- `GET /api/workspaces/{workspaceId}/hook-metrics`
- `GET /api/workspaces/{workspaceId}/hook-config`

### 10.2 Thread UI 的最小可用展示

当前 thread rail 只有：

- `Turn Policy Decisions`
- `Turn Policy Metrics`

建议在线程页新增 `Hook Runs` 区块，位置放在 decisions 之前，因为 hook 是更靠前的执行期事实。

第一阶段推荐展示：

- 最近 10 条 hook run
- 按时间倒序
- 每条显示：
  - `eventName`
  - `handlerKey`
  - `status`
  - `decision`
  - `reason`
  - `turnId` / `itemId`
  - `startedAt`
  - `durationMs`

### 10.3 `hook started/completed/block/continue` 的 UI 表达

thread UI 建议采用如下状态映射：

- `hook/started`
  - 展示为 `Running`
  - 使用流动态或 spinner

- `hook/completed` + `decision=continue`
  - 展示为 `Continue`
  - 颜色中性或成功色

- `hook/completed` + `decision=continueTurn`
  - 展示为 `Continue Turn`
  - 颜色警示，但不算失败

- `hook/completed` + `decision=block`
  - 展示为 `Blocked`
  - 明确显示阻断原因

- `hook/completed` + `status=failed`
  - 展示为 `Hook Failed`
  - 如果同时触发 fallback，应展示 “fallback applied”

### 10.4 Turn Policy UI 的保留与调整

现有 turn policy UI 不应删除，但需要调整文案与语义：

- `Turn Policy Decisions`
  - 从“主治理事实”降级为“治理动作审计”
- `Turn Policy Metrics`
  - 从“完整治理面板”降级为“策略与补救效果面板”

建议在 UI 上显式增加：

- `origin: hook`
- `origin: turnPolicyFallback`

这样用户能够看懂：

- 到底是 hook 在执行期拦住了
- 还是 turn policy 在事后补了一刀

## 11. 配置设计

### 11.1 配置分层建议

建议采用双层配置：

1. `RuntimePreferences`
   - 存放是否启用引擎、fallback 策略、UI 行为等平台级偏好

2. `hooks.json`
   - 存放 hook handler 列表、事件匹配、优先级和 handler 私有配置

这样做的原因是：

- 平台开关适合继续放在 `RuntimePreferences`
- 具体 hook 编排不适合继续压进现有 turn policy 那组布尔和字符串字段

### 11.2 `RuntimePreferences` 建议新增字段

建议新增：

- `hookEngineEnabled`
- `hookNativeImportEnabled`
- `hookFallbackToTurnPoliciesEnabled`
- `hookConfigPath`
- `hookRecentRunLimit`
- `hookFailMode`

保留现有 turn policy 字段用于迁移期兼容。

### 11.3 `hooks.json` 示例

```json
{
  "version": 1,
  "defaultFailMode": "open",
  "handlers": [
    {
      "id": "builtin.stop.require-successful-verification",
      "type": "builtin",
      "event": "Stop",
      "enabled": true,
      "scope": "turn",
      "priority": 100,
      "match": {
        "sources": ["interactive", "automation", "bot"]
      },
      "config": {
        "validationCommandPrefixes": ["go test", "pytest", "pnpm test", "cargo test"],
        "cooldownMs": 120000,
        "maxContinuationCount": 2
      }
    },
    {
      "id": "builtin.posttooluse.failed-validation-rescue",
      "type": "builtin",
      "event": "PostToolUse",
      "enabled": true,
      "scope": "item",
      "priority": 100,
      "match": {
        "toolKinds": ["commandExecution", "thread/shellCommand", "command/exec"]
      },
      "config": {
        "validationCommandPrefixes": ["go test", "pytest", "pnpm test", "cargo test"],
        "maxOutputTailChars": 600
      }
    },
    {
      "id": "builtin.pretooluse.dangerous-command-guard",
      "type": "builtin",
      "event": "PreToolUse",
      "enabled": true,
      "scope": "item",
      "priority": 50,
      "match": {
        "toolKinds": ["commandExecution", "thread/shellCommand", "command/exec"]
      },
      "config": {
        "blockedPatterns": ["rm -rf /", "del /s /q", "Remove-Item -Recurse -Force C:\\"]
      }
    }
  ]
}
```

### 11.4 与当前 turn policy 配置的迁移映射

| 当前字段 | 迁移后去向 | 说明 |
| --- | --- | --- |
| `TurnPolicyPostToolUseFailedValidationEnabled` | `builtin.posttooluse.failed-validation-rescue.enabled` | 等价迁移 |
| `TurnPolicyStopMissingSuccessfulVerificationEnabled` | `builtin.stop.require-successful-verification.enabled` | 等价迁移 |
| `TurnPolicyValidationCommandPrefixes` | 对应 builtin hook `config.validationCommandPrefixes` | 改为共享 matcher 配置 |
| `TurnPolicyPostToolUsePrimaryAction` | `PostToolUse` hook 的默认决策模式 | 建议迁移为 `continueTurn` / `continueWithContext` 语义 |
| `TurnPolicyStopMissingSuccessfulVerificationPrimaryAction` | `Stop` hook 默认决策模式 | 建议收敛到 `continueTurn` |
| `TurnPolicyFollowUpCooldownMs` 及其子项 | hook `cooldownMs` | 迁移为 hook 续跑节流 |

## 12. 与现有 `turnpolicies.Service` 的关系

### 12.1 迁移后 `turnpolicies.Service` 的职责

迁移后建议保留 `turnpolicies.Service`，但职责明确收缩为：

1. 审计记录
   - 持久化 `TurnPolicyDecision`

2. 指标汇总
   - 继续维护 thread / workspace KPI

3. fallback
   - 当 Hook Engine 未启用
   - 当某类工具面尚未接入 hook
   - 当 hook 执行失败且配置允许 fallback

4. 兼容旧 API
   - 保持现有 `turn-policy-decisions` 与 `turn-policy-metrics` 可用

### 12.2 迁移后的触发逻辑

建议改成：

1. Hook Engine 先运行。
2. 如果 hook 给出终局性结果，则以 hook 为准。
3. `turnpolicies.Service` 只记录审计，或在必要时做 fallback。
4. 如果 fallback 被触发，必须在 `TurnPolicyDecision` 里标明 `governanceLayer=turnPolicyFallback`。

### 12.3 为什么不直接删除 turn policy

不建议直接删除，原因有三：

1. 当前 metrics 和 UI 已经建立在 `TurnPolicyDecision` 之上。
2. hook 覆盖面不可能第一天就打齐。
3. 没有 fallback 的执行期治理，在迁移早期风险会偏高。

## 13. 官方原生 hooks 的兼容策略

### 13.1 不直接依赖，但语义兼容

建议明确一个原则：

- `codex-server` 的 Hook Engine 是主实现
- 官方原生 hooks 是未来可接入的 provider，不是当前唯一实现

### 13.2 兼容点

建议主动兼容以下官方概念：

- `HookEventName`
  - `PreToolUse`
  - `PostToolUse`
  - `SessionStart`
  - `UserPromptSubmit`
  - `Stop`
- `HookRunStatus`
  - `Running`
  - `Completed`
  - `Failed`
  - `Blocked`
  - `Stopped`
- `HookOutputEntry`
  - `Warning`
  - `Stop`
  - `Feedback`
  - `Context`
  - `Error`

### 13.3 兼容方式

建议未来支持两种来源：

1. `provider=server`
   - `codex-server` 自己执行的本地 hook

2. `provider=native`
   - 从 app-server / runtime 收到的原生 hook 通知

这样做的好处是：

- 当前不受 Windows / Bash 限制
- 将来如果官方 hooks 在 Windows 和多工具面成熟，可以平滑纳入同一 UI 和审计面

### 13.4 相对官方 hooks 的三处明确扩展

本文方案不是原样复刻官方 hooks，而是“兼容其事件语义，但按 `codex-server` 运行面做扩展”。

明确扩展点有三处：

1. 必须支持 Windows。
   - 这是硬要求，不能等官方 Windows 支持成熟后再推进治理层。

2. 必须支持 Bash 之外的工具面。
   - 至少覆盖 `commandExecution`、`thread/shellCommand`、`command/exec`、文件写入类 item、关键 `mcpToolCall`。

3. 必须把 hook run 变成 thread 内可见事件。
   - 通过 `hook/started`、`hook/completed`、`Hook Runs` UI 区块把治理过程显式暴露出来。

也就是说，`codex-server` 的目标不是做“官方 hooks 的被动镜像”，而是做“官方语义兼容的本地治理平台”。

## 14. 分阶段实施顺序

### 14.1 Phase 1：先补协议与可观测性

目标：

- 让 hook 成为一等事件
- 哪怕一开始只有 server 内部模拟 hook，也要先可见、可存、可查

具体动作：

- 新增 `backend/internal/hooks/`
- 新增 `HookRun` 模型和 store
- 新增 `hook/started`、`hook/completed`
- 扩展 `thread_projection.go`
- 新增 `GET /hook-runs`
- thread rail 新增 `Hook Runs` 区块

验收标准：

- thread 内能看到 hook started / completed
- API 可以按 thread 查询 hook runs
- fallback 与 hook 来源可区分

### 14.2 Phase 2：先做 `Stop` hook

目标：

- 先替换收益最高、风险最低的“缺少成功验证”规则

具体动作：

- 内建 `builtin.stop.require-successful-verification`
- 在 turn 收尾前同步检查
- 满足条件时直接 `continueTurn`

验收标准：

- 修改文件但未验证时，turn 不再先结束再补救
- thread UI 能看到 `Stop` hook 的 `continueTurn`

### 14.3 Phase 3：再做 `PostToolUse` hook

目标：

- 把失败验证补救从事后规则迁移到工具后审查

具体动作：

- 内建 `builtin.posttooluse.failed-validation-rescue`
- 覆盖 `commandExecution`
- 覆盖 `thread/shellCommand`
- 覆盖 `command/exec`

验收标准：

- 验证失败后，hook 直接推动同轮续跑
- turn policy 对同场景默认只做审计与 fallback

### 14.4 Phase 4：补 `UserPromptSubmit` 与 `PreToolUse`

目标：

- 把治理真正前移到输入与执行前

具体动作：

- 敏感输入阻断
- 危险命令 veto
- 关键路径写入前审批

验收标准：

- 危险操作能在执行前被拦下
- 用户能看到明确的 block reason

### 14.5 Phase 5：降级 turn policy 自动干预为默认 fallback

目标：

- 完成主治理层切换

具体动作：

- 默认关闭现有 turn policy 的自动动作
- 保留 metrics、历史视图与 fallback 开关
- 用 hook run + decision 作为新的治理事实源

验收标准：

- 主路径以 hook 为准
- turn policy 只在覆盖缺口或 hook 异常时介入

## 15. 风险与缓解

### 15.1 双重触发风险

风险：

- hook 已经 `continueTurn`
- turn policy fallback 又补了一次 follow-up

缓解：

- 统一证据指纹
- `TurnPolicyDecision` 记录 `HookRunID`
- fallback 先检查最近 hook run 是否已经终局处理

### 15.2 续跑循环风险

风险：

- `Stop` / `PostToolUse` 反复把线程推回去

缓解：

- continuation 次数上限
- cooldown
- 同指纹去重
- 达上限后只告警不续跑

### 15.3 Hook 延迟风险

风险：

- `PreToolUse` / `Stop` 过慢，拖慢用户体感

缓解：

- hook 超时默认 100ms 到 300ms 量级
- 关键链路只允许轻量 builtin
- async hook 不得阻塞 sync 主路径

### 15.4 平台覆盖不一致风险

风险：

- 某些工具走了 hook
- 某些工具仍绕开 hook

缓解：

- 明确工具覆盖矩阵
- 在配置与 UI 上标识“治理覆盖率”
- 未覆盖链路由 turn policy fallback 托底

### 15.5 Windows 语义差异风险

风险：

- PowerShell / CMD / Bash 的命令语义差异导致 matcher 误判

缓解：

- matcher 优先基于结构化工具元数据，而不是纯字符串
- 命令字符串匹配只做兼容补充
- Windows 特定危险命令单独维护规则集

## 16. 测试建议

建议新增四层测试：

1. Hook Engine 单元测试
   - handler 顺序
   - 决策优先级
   - fail-open / fail-closed

2. 内建 hook 规则测试
   - `Stop` 缺少验证
   - `PostToolUse` 失败验证
   - 危险命令阻断
   - 敏感输入阻断

3. API / projection 集成测试
   - `hook/started`
   - `hook/completed`
   - thread projection 聚合
   - `GET /hook-runs`

4. 前端组件测试
   - thread rail `Hook Runs`
   - blocked / continue / continueTurn 状态
   - hook 与 turn policy 来源区分

## 17. 建议的首批代码落点

后端建议新增或修改：

- `backend/internal/hooks/engine.go`
- `backend/internal/hooks/registry.go`
- `backend/internal/hooks/types.go`
- `backend/internal/hooks/builtin_stop_verification.go`
- `backend/internal/hooks/builtin_posttooluse_validation.go`
- `backend/internal/hooks/builtin_pretooluse_guard.go`
- `backend/internal/store/models.go`
- `backend/internal/store/thread_projection.go`
- `backend/internal/store/hook_runs.go`
- `backend/internal/api/router.go`
- `backend/internal/turnpolicies/service.go`

前端建议新增或修改：

- `frontend/src/types/api.ts`
- `frontend/src/features/threads/api.ts`
- `frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx`
- `frontend/src/pages/thread-page/ThreadWorkbenchRailHookRunsSection.tsx`
- `frontend/src/pages/thread-page/threadWorkbenchRailTypes.ts`

## 18. 一句话结论

当前 turn policy 不该继续充当主治理机制。

最合理的下一步，是让 `codex-server` 新增一层与官方 hooks 语义兼容、但不受其当前 Windows 与 Bash 限制约束的本地 Hook Engine，让 hooks 负责同步门禁与执行期治理，而现有 turn policy 退到审计、指标与 fallback。
