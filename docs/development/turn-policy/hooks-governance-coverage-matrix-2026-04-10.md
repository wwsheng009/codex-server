# `codex-server` hooks 治理覆盖矩阵（含 MCP 真实覆盖结论）

更新时间：2026-04-10

适用项目：

- `E:\projects\ai\codex-server`

关联文档：

- `E:\projects\ai\codex-server\docs\development\turn-policy\hooks-compatible-governance-layer-design-2026-04-10.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-implementation-status-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\system-design.md`

## 1. 文档目的

这份文档只做一件事：把当前仓库里 hooks 治理层已经真实接到的协议面、运行时拦截点和审计覆盖范围明确写清楚。

尤其是 MCP 相关链路，这里要避免三种常见混淆：

- 把 `mcpServer/elicitation/request` 误当成真实 `PreToolUse`
- 把 `mcpToolCall` 的后置审计误当成前置门禁
- 把 `item/tool/call` 的动态工具前置拦截误表述成“所有 MCP 调用都能前置拦截”

本文结论以仓库内 schema、runtime 和 hooks 实现为准，不依赖推测性解释。

## 2. 核心结论

### 2.1 当前不存在独立的 native MCP pre-exec request surface

截至 2026-04-10，仓库内 schema 可见的 MCP 相关协议面是：

- `mcpServer/elicitation/request`
- `item/mcpToolCall/progress`
- `mcpToolCall` item 类型本身

但不存在一个独立的：

- `item/mcpToolCall/requestApproval`
- `item/mcpToolCall/request`
- 或其他可在执行前由 `runtime.Manager` 同步拦截的 native MCP tool request

这意味着当前无法把“真实 MCP 工具调用”稳定地接成一个原生前置门禁。

### 2.2 当前真正可前置拦截的是 `ServerRequest` 路径里的 `item/tool/call`

`runtime.Manager` 的前置拦截器挂在 `HandleRequest(...)` 上，因此只能同步拦截 server request。

在当前协议里，hooks 服务实际接住的是：

- `item/tool/call`

并且 `backend/internal/hooks/service.go` 里当前只对这一路径做 `InterceptServerRequest(...)`，把部分 dynamic tool call 映射成 `PreToolUse` 输入后执行阻断判断。

因此：

- `item/tool/call` 可以是当前仓库里的稳定前置门禁入口
- 但它不等于“真实 `mcpToolCall` 原生前置门禁”

### 2.3 当前 MCP 面已实现的是“显式审计 + 关键后置观察”

当前 MCP 已落地的 hooks 覆盖包括：

- `mcpServer/elicitation/request`
  - 记一条显式 `ServerRequest` 审计 run
- `item/completed` 上的关键 `mcpToolCall`
  - 记一条 `PostToolUse` 审计 run
  - 仅覆盖可稳定识别的关键写入 / 删除 / 执行类工具

这两者都不应被表述为“真实 MCP 工具调用的前置阻断”。

## 3. 证据链

### 3.1 Schema 证据

`backend/schema-out/ServerRequest.json` 当前包含的相关 request method 是：

- `mcpServer/elicitation/request`
- `item/tool/call`

同时也包含 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval` 等其他 request，但没有任何 `item/mcpToolCall/request*` 变体。

`backend/schema-out/ServerNotification.json` 当前与 MCP tool call 直接相关的 notification 只有：

- `item/mcpToolCall/progress`

这说明 schema 层面能够确认的是：

- MCP 有 elicitation request
- MCP tool call 有 progress notification
- 但没有一个独立暴露出来、可在执行前拦截的 native MCP tool request

### 3.2 Runtime 证据

`backend/internal/runtime/manager.go` 的拦截链路发生在：

- `instance.HandleRequest(...)`
- `instance.interceptServerRequest(...)`

也就是说，只有 server 主动发出的 request 才会进入 runtime 前置拦截器。

当前 hooks 服务通过 `runtime.Manager.SetServerRequestInterceptor(...)` 注册到这条链路上，但 `backend/internal/hooks/service.go` 中的 `InterceptServerRequest(...)` 只处理：

- `item/tool/call`

如果不是这一路径，当前实现会直接放行，不会进入 `PreToolUse` 阻断逻辑。

### 3.3 Hooks 服务证据

`backend/internal/hooks/service.go` 当前与 MCP 相关的处理点是：

- `handleEvent(...)`
  - `mcpServer/elicitation/request` -> `observeMcpElicitationRequest(...)`
  - `item/completed` -> `observeMcpToolCallPostToolUse(...)`

这里需要特别区分：

- `observeMcpElicitationRequest(...)`
  - 产生 `ServerRequest` 审计 run
- `observeMcpToolCallPostToolUse(...)`
  - 只有在 `item/completed` 且 item 类型已经是 `mcpToolCall` 时才会触发
  - 它发生在工具执行之后，语义上属于后置观察

此外，`preToolUseInputFromMcpToolCall(...)` 虽然会把部分 MCP 工具名映射成路径写入 / 删除 / 命令执行等结构化输入，但这个映射当前只是为了让后置审计能复用已有危险路径 / 危险命令识别，不代表 runtime 已经在 MCP 原生调用前拿到了同等 request 面。

## 4. 当前治理覆盖矩阵

状态定义：

- `已前置阻断`：可在工具实际执行前同步返回阻断结果
- `已后置治理`：工具或 turn 已推进后，仍可驱动补救 / 续跑动作
- `仅审计`：只记录 hook run，不做执行期门禁
- `未接入`：当前没有稳定 hooks 处理点
- `协议缺口`：当前 schema / runtime 未提供可稳定接入的前置面

| 工具面 / 事件面 | 协议或运行时入口 | 当前 hooks 落点 | 当前语义 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `item/tool/call` 中的 `thread/shellCommand`、`command/exec`、`fs/writeFile`、`fs/remove`、`fs/copy`、`config/*` | `ServerRequest` | `InterceptServerRequest(...)` -> `EvaluatePreToolUse(...)` | 可同步 `block` | `已前置阻断` | 当前最稳定的真实前置门禁面，但它属于 dynamic tool call，不等于原生 `mcpToolCall` |
| `item/completed` 上的 `commandExecution` | thread item 完成事件 | `evaluateFailedValidationPostToolUse(...)` | 失败验证后的 `PostToolUse` 补救 | `已后置治理` | 已有动作执行，可 `steer` |
| `turn/completed` 上的文件变更与验证事实 | turn 完成事件 | `evaluateMissingVerificationStop(...)` | `Stop` 风格缺少成功验证补跑 | `已后置治理` | 发生在 turn 准备收口时 |
| `mcpServer/elicitation/request` | `ServerRequest` | `observeMcpElicitationRequest(...)` | `ServerRequest` 审计 run | `仅审计` | 当前没有接成 `PreToolUse` 阻断 |
| `item/completed` 上的关键 `mcpToolCall` | thread item 完成事件 | `observeMcpToolCallPostToolUse(...)` | 关键写入 / 删除 / 执行类 `PostToolUse` 审计 | `仅审计` | 依赖 allowlist + 参数名映射，且只能在执行后观察 |
| `item/mcpToolCall/progress` | `ServerNotification` | 无 | 无 | `未接入` | 后续可用于 richer telemetry 或延迟分析，但不是前置门禁 |
| native `mcpToolCall` pre-exec request surface | 无独立 schema / runtime 入口 | 无 | 无 | `协议缺口` | 当前不存在可稳定接入的原生 MCP 前置请求面 |

## 5. 当前关于 MCP 的精确表述

为了避免后续文档、UI 或讨论继续混淆，当前建议统一使用下面这组表述：

1. `mcpServer/elicitation/request` 当前已纳入显式审计，但不是 `PreToolUse`。
2. 关键 `mcpToolCall` 当前已纳入 `PostToolUse` 审计，但不是前置门禁。
3. 真正的前置阻断当前只稳定存在于 `item/tool/call` 这类可被 runtime 拦截的 server request。
4. 截至 2026-04-10，仓库内不存在一个独立、稳定、native 的 MCP pre-exec request surface。

## 6. 后续缺口与建议

### 6.1 现阶段不应再做的表述升级

在没有新增协议面之前，不应把当前实现升级表述为：

- “MCP 已支持 `PreToolUse`”
- “MCP 已支持真实前置审批”
- “`mcpToolCall` 已被 hooks 执行前拦截”

这些说法都与当前 schema/runtime 事实不一致。

### 6.2 当前可以继续稳定推进的方向

在现有协议约束下，可以继续做的只有两类收敛：

1. 继续扩充关键 `mcpToolCall` 的后置审计识别面，但保持“审计型 `PostToolUse`”表述。
2. 如需补充可观测性，可接入 `item/mcpToolCall/progress` 做延迟、阶段或失败证据，但不要把它包装成前置 gate。

### 6.3 真正进入下一阶段的前提

只有在后续 schema / runtime 出现下面任一能力时，才应再讨论“真实 MCP 前置门禁”：

- 独立的 `item/mcpToolCall/request*`
- 可在执行前送达 `runtime.Manager` 的 MCP tool request
- 或其他具备同等同步 veto 语义的原生协议面

在那之前，当前实现应被严格归类为：

- 同一治理主链中的显式审计覆盖
- 以及关键 MCP 调用的后置治理观察

而不是原生 MCP pre-exec governance。
