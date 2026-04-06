# codex-plugin-cc app-server 借鉴执行计划

更新时间：2026-03-31

## 1. 背景

本计划基于对 `E:\projects\ai\codex-plugin-cc` 的专项检查，目标不是照搬该项目的整体架构，而是有选择地吸收其中对 `codex app-server` 集成最有价值的部分，落到当前 `codex-server` 仓库中。

核心判断如下：

- `codex-plugin-cc` 的本质是“本地 `codex` CLI / `codex app-server` 包装层”，不是 Web BFF。
- `codex-server` 当前的正确架构仍然是“浏览器 -> Go BFF -> workspace runtime -> app-server sidecar”。
- 最值得借鉴的是协议类型收敛、turn 聚合逻辑、后台 worker 的低噪声初始化 profile，以及 fake app-server 进程级集成测试。
- 最不值得照搬的是 session 级 broker、busy 后 direct fallback、全局 delta opt-out、以及把 server request 简化为 unsupported 的做法。

## 2. 本次执行的目标

本轮执行目标不是大范围重构，而是把后续改造拆成可落地、可并行、可验收的工作包：

1. 建立一层更稳的 `app-server` 协议类型约束。
2. 为后台任务增加 turn 结果聚合能力。
3. 为后台 worker 提供可选的低噪声初始化 profile。
4. 建立 fake `codex` / fake `app-server` 进程级测试基线。
5. 在计划层面明确不做 session broker 改造，避免实现跑偏。

## 3. 明确不做的事项

以下事项不进入本轮执行范围：

- 不引入 Claude session 级 broker 架构。
- 不实现 broker busy 后 direct fallback 到新 runtime。
- 不对主 Web UI runtime 全局关闭 `item/agentMessage/delta`、`item/reasoning/*Delta` 等高频通知。
- 不把 server request 处理降级为统一 unsupported。

原因很明确：这些做法适合 `codex-plugin-cc` 的 CLI 插件场景，但会破坏当前 `codex-server` 的 workspace runtime 一致性、审批链路和实时 UI 能力。

## 4. Team 分工

### Team A：协议类型与初始化约束

目标：

- 为 `app-server` 主路径建立一层薄的协议类型收敛层。
- 减少当前 `map[string]any` 和原始 payload 处理带来的协议漂移风险。
- 给 runtime bridge 加上初始化 profile 的扩展点，但先只定义接口，不改变主 UI 默认行为。

建议改动位置：

- `backend/internal/bridge`
- `backend/internal/threads`
- `backend/internal/turns`
- `backend/schema-out`
- `scripts/`

优先覆盖的方法：

- `thread/start`
- `thread/resume`
- `review/start`
- `turn/start`
- `turn/interrupt`

交付物：

- 一份协议类型生成方案，说明生成源、生成命令、产物落点和更新方式。
- 一层最小可用的方法类型封装，至少覆盖上述 5 条主路径。
- bridge 初始化参数的 profile 设计，区分主 UI runtime 和后台 worker runtime。

验收标准：

- 新增或更新的类型层可以约束至少 5 条主路径的请求和响应结构。
- 主 Web UI runtime 的初始化行为不发生语义变化。
- 后续调用侧无需再直接手写同一批主路径的自由形态 payload。

主要风险：

- 如果类型层过厚，会把官方协议升级成本转嫁到本仓库。
- 如果 profile 设计和运行时调用路径耦合过深，后续会影响 bridge 复用。

### Team B：turn 聚合器与后台任务结果收敛

目标：

- 新增一层 turn 聚合器，用于把通知流收敛成更高层的结果对象。
- 统一处理 `turn/started`、`item/*`、`turn/completed`、subagent、reasoning、文件改动、命令执行和缺失 completion 的边界情况。
- 优先服务 bot、automation、后台 review/task 汇总，不直接干扰当前前端实时渲染链路。

建议改动位置：

- `backend/internal/runtime`
- `backend/internal/automations`
- `backend/internal/bots`
- 新建 `backend/internal/turncapture` 或等价目录

交付物：

- 一份 turn 聚合器的数据模型。
- 一条后台任务结果收敛链路，能输出高层结果对象。
- 对 subagent、late notification、missing completion 的处理策略。

验收标准：

- 聚合器能识别主线程和子线程事件。
- 聚合器能在 completion 缺失时做受控推断，而不是无限等待。
- 聚合结果可直接被 bot / automation / 后台任务消费。

主要风险：

- 如果聚合器直接夹在主 UI 事件流中，容易与现有 thread projection 逻辑冲突。
- 如果过早覆盖太多场景，会放大边界条件数量，拖慢交付。

### Team C：后台 worker 低噪声初始化 profile

目标：

- 为 bot、automation、后台 review/task worker 提供可选的低噪声初始化 profile。
- 只减少后台 worker 不需要的高频 delta 通知，不动主 UI runtime 的实时流式能力。

建议改动位置：

- `backend/internal/bridge/client.go`
- `backend/internal/runtime/manager.go`
- bot / automation 的调用路径

交付物：

- 一套可配置的 initialize profile。
- 后台 worker 使用该 profile 的接入方案。
- 文档说明哪些 notification 可以 opt-out，哪些不可以。

验收标准：

- 主 Web UI runtime 保持现有事件面。
- 后台 worker 可选择低噪声 profile。
- 不允许把低噪声 profile 误用于用户实时会话。

主要风险：

- 误关关键 delta 会让后台任务结果不完整。
- profile 如果没有清晰边界，容易被滥用到前台 runtime。

### Team D：fake app-server 进程级测试与回归基线

目标：

- 建立 fake `codex` / fake `app-server` 夹具，让 bridge/runtime 测试不依赖真实 Codex 安装。
- 用进程级测试覆盖主链路和关键异常链路。

建议改动位置：

- 新建 `backend/internal/testsupport`、`backend/internal/testutil/codexfake` 或等价目录
- `backend/internal/bridge`
- `backend/internal/runtime`
- `backend/internal/threads`
- `backend/internal/turns`
- 前端 thread live state 相关测试

第一批必须覆盖的场景：

- `initialize`
- `thread/start`
- `review/start`
- `turn/start`
- `turn/interrupt`
- subagent 通知
- 缺失 `turn/completed`
- runtime 关闭或异常退出

交付物：

- 一个可复用的 fake `codex` / fake `app-server` 进程夹具。
- 一组协议链路测试，验证请求 payload、响应解析和通知处理。
- 一组顺序性测试，验证中断优先于本地清理。

验收标准：

- 测试可在没有真实 `codex` 安装的环境下运行。
- 测试能记录最后一次 interrupt、启动次数和关键通知顺序。
- fake 夹具行为与真实 JSONL request-response-notification 模型一致。

主要风险：

- fake 行为过度简化，会造成假阳性。
- 夹具若不随协议升级更新，会演变成新的历史负担。

## 5. 执行顺序

### Phase 0：约束确认

负责人：

- Team Lead
- Team A
- Team B
- Team C
- Team D

动作：

- 把“本轮不做 session broker”和“主 UI 不做全局 delta opt-out”写入实现约束。
- 确认 Team A、B、C、D 的目录边界，避免多人改同一块核心逻辑。

退出条件：

- 本文档被接受为执行基线。

### Phase 1：Team A 与 Team D 并行

并行原因：

- 类型层和 fake 测试夹具相互促进，但文件写入范围可以基本分离。

Team A 先做：

- 定义协议类型生成方案。
- 先在 `thread/start`、`review/start`、`turn/start`、`turn/interrupt` 接入薄类型封装。
- 为 bridge 初始化 profile 预留接口。

Team D 同步做：

- 搭建 fake `codex` / fake `app-server` 夹具。
- 先覆盖 `initialize`、`thread/start`、`turn/start`、`turn/interrupt` 四条主链路。

退出条件：

- 主路径的类型约束和假 runtime 测试夹具都已经可用。

### Phase 2：Team B 接入 turn 聚合器

前置依赖：

- 依赖 Team A 的方法面收敛。
- 依赖 Team D 的 fake runtime 能模拟 subagent、late notification、missing completion。

动作：

- 新建 turn 聚合器。
- 接入后台 review/task 或 automation 的结果收敛链路。
- 补 subagent、reasoning、missing completion 的行为测试。

退出条件：

- 后台任务能得到高层结果对象，而不是只依赖零散事件。

### Phase 3：Team C 接入低噪声 profile

前置依赖：

- 依赖 Team A 完成 initialize profile 设计。
- 依赖 Team B 明确后台任务对哪些通知仍有需求。

动作：

- 给后台 worker 单独接入低噪声 profile。
- 验证主 UI runtime 不受影响。
- 验证后台任务结果没有因 opt-out 而缺失关键内容。

退出条件：

- 主 UI 保持现状。
- 后台 worker 的事件噪声下降，但结果完整性不下降。

### Phase 4：联合验收

负责人：

- Team Lead
- Team D 主测

联合验收检查项：

- 协议类型层是否只覆盖主路径且没有过度封装。
- fake runtime 测试是否覆盖 `review/start`、`turn/start`、`turn/interrupt`、subagent、missing completion。
- turn 聚合器是否只服务后台结果收敛，没有污染主 UI 链路。
- 低噪声 profile 是否只用于后台 worker。
- 架构约束项是否被遵守，没有出现 session broker 或 direct fallback 实现。

## 6. Definition of Done

本计划完成的判定标准如下：

- `codex-server` 增加了可维护的 `app-server` 主路径类型收敛层。
- 后台任务具备 turn 聚合能力，可稳定处理 subagent 和 completion 边界。
- 后台 worker 可选低噪声 profile，主 UI runtime 行为保持不变。
- 仓库具备 fake `codex` / fake `app-server` 进程级回归测试。
- 文档和实现层都明确坚持 `1 workspace = 1 runtime = 1 app-server` 的架构约束。

## 7. 本轮优先级

建议优先级如下：

1. Team D：fake runtime 夹具与主链路测试
2. Team A：协议类型收敛层
3. Team B：turn 聚合器
4. Team C：后台 worker 低噪声 profile

原因：

- 测试基线和协议类型层风险最低、收益最快。
- turn 聚合器价值高，但设计空间更大，适合在前两者稳定后推进。
- 低噪声 profile 是优化项，不应先于正确性保障项落地。

## 8. 执行进展（2026-03-31）

### 已完成

- Team A 已完成 `app-server` 主路径的最小类型收敛，覆盖 `initialize`、`thread/start`、`thread/resume`、`review/start`、`turn/start`、`turn/interrupt`，并落在 `backend/internal/appserver`、`backend/internal/bridge`、`backend/internal/threads`、`backend/internal/turns`。
- Team B 已新增 `backend/internal/turncapture`，提供最小 turn 聚合结果对象，并已接入 `backend/internal/automations` 的终态结果收敛，不再只依赖 automation 内部手写遍历 `turn.Items`。
- Team C 已完成 low-noise initialize profile 的基础透传能力：
  - `InitializeCapabilities` 增加 `optOutNotificationMethods`
  - `bridge.Config` 增加可选 `OptOutNotificationMethods`
  - 默认行为保持不变，当前主 UI runtime 没有启用该配置
- Team D 已把 fake `codex/app-server` 夹具扩成方法级可配置场景，覆盖：
  - `initialize`
  - `thread/start`
  - `review/start`
  - `turn/start`
  - `turn/interrupt`
  - turn 生命周期通知
  - 缺失 `turn/completed`
  - runtime 异常退出

### 已验证

- 已执行：
  - `go test -p 1 ./internal/appserver ./internal/bridge ./internal/runtime ./internal/threads ./internal/turns ./internal/automations ./internal/turncapture`
- 结果：通过。

### 当前结论

- Phase 1 已完成。
- Phase 2 已完成最小可用版本，且目前只接入后台 automation 结果收敛，没有碰主 UI 实时链路。
- Phase 3 只完成了协议与 bridge 层基础能力，尚未把 low-noise profile 接到后台 worker 运行时。
- Phase 4 的联合验收条件里，测试覆盖和架构约束当前均满足第一轮落地要求。

### 后续待办

- 为后台 worker 设计清晰的 runtime 边界后，再决定 low-noise profile 的真实启用路径，避免误伤当前 `1 workspace = 1 runtime = 1 app-server` 的默认模型。
- 在 fake runtime 上继续补 server request / approval 场景，覆盖审批链路回归。
