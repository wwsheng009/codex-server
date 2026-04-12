# Remote Runtime / Watch / Exec-Server Must Be a Separate Project

更新时间：2026-04-11

## 1. 目的

本文档专门回答一个边界问题：

> 如果后续产品方向真的要走 remote runtime、filesystem watch、exec-server，这件事为什么不能被视为“顺手升级一下 Codex CLI / app-server”的小适配，而必须作为单独项目立项？

结论先行：

- 不能把这类工作视为“升级某个版本后顺手改几个参数”的小改动。
- 这不是单纯的 CLI 版本兼容问题，而是运行架构、路径语义、权限边界、前端事件模型和测试基线的系统级重构问题。
- 如果不单独立项，而是把它混进普通升级任务，极大概率会得到一个“局部能跑、整体不稳、边界含糊、难以验证”的半成品。

本文档不直接要求当前仓库立刻进入 remote runtime 实装，而是用于：

- 解释为什么必须单独立项
- 明确受影响的系统边界
- 给未来立项提供拆分基线

## 2. 当前架构基线

在讨论为什么要单独立项之前，必须先把当前架构钉死。当前 `codex-server` 的正确运行基线是：

- 浏览器通过 HTTP/WebSocket 连接 Go BFF
- Go BFF 以 workspace 为单位持有 runtime 状态
- runtime manager 默认启动本地 `codex app-server --listen stdio://`
- bridge 通过子进程 `stdin/stdout/stderr` 与 app-server 交换 JSON-RPC
- 前端看到的 WebSocket 只是浏览器到 BFF 的事件流，不是 Codex runtime transport

这套架构有几个关键假设：

1. **runtime 与 BFF 共享本地文件系统视图**
   - `cwd` 传给 app-server 的就是本地 workspace 路径
   - `fs/*`、`config/*`、线程恢复都默认站在同一台机器的路径语义上

2. **runtime 生命周期由本地进程模型驱动**
   - 启动是起一个子进程
   - 关闭是 kill 进程或等待退出
   - 错误模型主要是本地启动失败、stdout 读失败、进程退出

3. **前端与 runtime 之间隔着稳定的 BFF 事件面**
   - 前端不直接感知 runtime transport 的细节
   - 前端只消费 BFF 统一转发后的 thread/workspace 事件

4. **权限边界当前以内建沙箱和本地 workspace 根路径约束为主**
   - `turn/start` 和 `command/exec` 的权限主要由 `approvalPolicy` / `sandboxPolicy` 决定
   - `fs/remove`、`fs/copy` 等能力还会被 BFF 额外约束到 workspace root 内

只要这些假设成立，当前系统就是“本地 workspace runtime 模式”。而 remote runtime、watch、exec-server 恰恰会逐条动到这些假设。

## 3. 这不是“小适配”的根本原因

为什么这不能当作一次简单的 CLI 升级？因为 remote runtime / watch / exec-server 影响的不是一两个 API，而是五个系统级维度：

1. transport 模型
2. 路径与 `cwd` 语义
3. 权限边界与信任模型
4. UI 事件模型与状态恢复
5. 测试基线与回归方法

只要其中任一维度没设计清楚，整个项目就会进入“局部 patch 越来越多，系统语义越来越不清楚”的状态。

下面逐项展开。

## 4. 维度一：Transport 模型会变，不是命令行参数会变

### 4.1 当前 transport 是什么

当前 transport 本质上是：

- 本地命令字符串
- 本地子进程
- 本地 `stdin/stdout/stderr`
- BFF 进程内的 JSON-RPC client

这不是一个“可插拔 transport 抽象已经就绪”的系统。它是“默认且唯一 transport 就是本地 stdio”。

### 4.2 引入 remote runtime 后，变化发生在哪里

一旦改成 remote runtime，问题立刻从“启动命令怎么写”升级成“连接模型是什么”：

- 是 `stdio` 还是 websocket transport？
- 连接目标是谁维护？
- 连接失败时如何重试？
- remote runtime 断开以后，BFF 如何感知？
- 重新连接后是否需要重新 `initialize`？
- 已加载的 thread、订阅状态、命令执行状态如何恢复？

这些都不是简单的 CLI 参数问题，而是 transport 层状态机问题。

### 4.3 为什么这会牵动现有实现

当前 bridge 的假设是：

- 启动 runtime 就是 `exec.Command(...)`
- 连接存在即 client 可用
- 断开就是进程退出或 IO 失败

如果未来变成 remote websocket transport，那么至少要重新定义：

- transport 抽象层
- 连接生命周期
- 初始化时机
- 重连策略
- close / shutdown 语义
- fatal error 与 transient error 的区分

这意味着：

- `bridge` 不再只是“命令启动器”
- `runtime.Manager` 不再只是“本地进程持有者”
- `State.Status` 的含义也要扩展，不再只是 `starting/ready/error`

### 4.4 为什么这不能顺手混进升级里

因为 transport 变化一旦混进版本升级任务，就会出现两个典型问题：

1. 为了先跑通远端链路，临时在现有 manager/bridge 里堆分支，导致本地路径也变复杂。
2. 因为没有单独的 transport 层设计，所有异常都只能通过 patch 式 if/else 修补，后续难以维护。

所以 transport 改造必须单独立项，并在项目开始时先回答：

- 本项目最终支持几种 transport？
- 默认 transport 是什么？
- transport 是全局级、workspace 级还是 runtime profile 级配置？
- 远端 transport 的失败恢复语义是什么？

如果这些问题不单独定稿，后续实现一定会漂。

## 5. 维度二：路径语义会变，不是把本地路径传远端那么简单

### 5.1 当前路径语义为什么简单

当前仓库里很多能力之所以成立，是因为默认假设：

- BFF 的 workspace root 是 `E:/...` 这样的本地路径
- app-server 启动在同一台机器或同一文件系统视图里
- `thread/start` 的 `cwd`、`thread/resume` 的 `cwd`、`fs/*` 的路径参数都能直接共享这套语义

因此当前的实现可以直接：

- 把本地 root path 作为 `cwd` 发出去
- 把相对路径解析成绝对路径
- 用 `filepath.Rel(...)` 判断是否逃逸 workspace root

### 5.2 remote runtime 会让哪些问题浮现

如果 runtime 在远端，这套假设就全部需要重审：

- BFF 看到的 `E:/projects/ai/codex-server`，远端 runtime 也认识吗？
- 如果远端是 Linux 容器，路径是不是应该变成 `/workspace`？
- `thread/resume` 时使用的 `cwd` 是谁决定的？
- `config/read` 读的是远端 `config.toml` 还是本地 `config.toml`？
- `fs/remove` 删的是本地文件还是远端文件？
- BFF 做的本地路径逃逸校验，在 remote runtime 下还有意义吗？

### 5.3 这会改变的不只是文件 API

路径语义一旦变化，受影响的不只是 `fs/*`：

- `thread/start`
- `thread/resume`
- `command/exec`
- `thread/shellCommand`
- `config/*`
- fuzzy file search
- 任何携带 `cwd` 或 workspace root 的能力

换句话说，这不是“给 `fs/remove` 加个 remote 分支”可以解决的问题，而是整个 runtime 视角下“workspace 是谁的目录”要重新定义。

### 5.4 为什么这必须单独立项

因为路径语义如果不先单独立项明确，会直接出现以下高风险状态：

- 有些接口操作本地文件，有些接口操作远端文件，但 UI 无法区分
- `thread/start` 在远端目录工作，`fs/remove` 却删本地目录
- `config/read` 看起来成功，实际上读取的是错误的一侧
- 本地路径安全检查继续存在，但已经不再保护真正的执行面

这种问题不是“bug 多一点”，而是系统语义错乱。它必须在单独项目中由“路径权威定义”和“路径映射策略”先落文档，再动代码。

## 6. 维度三：权限边界和信任模型会变

### 6.1 当前权限边界的成立条件

当前权限边界主要建立在下面几层：

- `approvalPolicy`
- `sandboxPolicy`
- 本地 workspace root 逃逸校验
- 本地 runtime 进程由当前服务进程直接托管

也就是说，今天的安全模型默认是：

- BFF 知道 runtime 跑在哪
- BFF 知道 workspace root 是什么
- BFF 对文件路径有直接控制能力
- runtime 是本地 sidecar，不是外部独立服务

### 6.2 remote runtime 后为什么权限边界要重画

一旦 runtime 远端化，权限模型会新增一整层问题：

- 谁可以连接 remote runtime？
- transport 连接的认证是什么？
- remote runtime 是否接受 workspace 级别的访问控制？
- BFF 还能否继续宣称“我限制了 workspace root”？
- remote `thread/shellCommand` 的 full access 到底作用在哪一侧？
- `dangerFullAccess` 在 remote runtime 下是“远端机器 full access”还是“某个受限工作目录 full access”？

### 6.3 exec-server 会放大这个问题

`exec-server` 相关能力一旦进入主路径，命令执行边界会变得更复杂：

- 命令到底是在 BFF 所在机器执行，还是 runtime 所在机器执行？
- stdout、process id、resume 能力由谁负责？
- 文件系统能力和命令能力是不是还共享同一个授权边界？

如果这些问题不先单独立项，最容易发生的就是：

- UI 还在用旧文案描述权限
- 后端已经切到新执行面
- 用户以为自己操作的是本地 workspace，实际命中远端 runtime

### 6.4 为什么这不能混进普通升级

普通升级任务通常验证的是：

- 接口还通不通
- 字段还兼不兼容
- 原有主链路是否回归

但权限边界项目验证的是：

- 谁信任谁
- 谁授权谁
- 谁对文件和命令的执行面负责
- UI 文案、后端限制、runtime 实际行为是否一致

这两个问题域完全不同。前者是兼容性，后者是安全和产品语义。必须分项目处理。

## 7. 维度四：UI 事件模型会变，不再只是“事件照常推给前端”

### 7.1 当前 UI 事件模型为什么还能保持简单

今天前端只需要理解：

- BFF 的 workspace stream 已连接
- thread/workspace 事件持续到达
- command output 可以 replay / resume
- runtime 问题通常表现为某类统一错误或状态切换

因为 runtime transport 细节基本被 BFF 吞掉了，前端消费的是统一的事件面。

### 7.2 remote runtime 会带来的新状态

如果后端接入 remote websocket transport，前端最终一定会面对更多状态：

- 浏览器到 BFF 的 WebSocket 连接正常
- 但 BFF 到 remote runtime 的 transport 已断开
- BFF 正在重连 remote runtime
- remote runtime 已连通，但 thread 订阅尚未恢复
- remote runtime 已恢复 thread 事件，但 command session 状态尚未恢复
- watch 事件连接正常，但 turn 事件连接异常

这些都是真实的用户可见状态，而不是后端内部细节。

### 7.3 filesystem watch 不是简单多一类通知

`filesystem watch` 真正进入产品后，前端不只是“多收一类 event”：

- 要不要展示 watch 建立中、建立失败、watch stale？
- watch 事件是 workspace 级、thread 级还是 view 级？
- watch 是否会触发文件树刷新、编辑器刷新、thread context 刷新？
- watch 丢失以后，前端如何提示用户当前文件视图可能过期？

如果把这些问题混进一次普通版本升级，最后往往只会得到“后端已经能发事件，但前端不知道怎么解释”的半成品。

### 7.4 为什么 exec-server 也会影响 UI 事件模型

如果 `exec-server` 进入主路径，那么 terminal / workbench 侧至少会遇到：

- 事件源变化
- process 生命周期变化
- 输出聚合与 replay 语义变化
- completion / snapshot / delta 的边界变化

前端现有对 `command/exec` 的状态机、回放逻辑和视图恢复逻辑都需要重新验证。

### 7.5 为什么这要单独立项

因为 UI 事件模型不是“把新通知类型接上就完事”，而是要重新定义：

- 哪些状态对用户可见
- 哪些状态只在诊断面板可见
- 断连与重连如何表达
- watch 和 command/exec 是否共享同一条状态语义

这已经是完整的产品设计任务，不是 CLI 升级附带的小兼容。

## 8. 维度五：测试基线会变，现有回归方法不足以覆盖

### 8.1 当前测试基线验证了什么

当前仓库已有的很多 runtime/bridge/execfs 测试，主要验证的是：

- 本地 app-server 进程启动
- `initialize -> initialized -> thread/start -> turn/start` 这类主链路
- `command/exec` 输出 batching / replay / resume
- 本地 fake runtime 对请求和通知的最小模拟

这套测试基线默认站在本地 stdio 模式上，是合理且必要的。

### 8.2 remote runtime 项目需要新增什么测试能力

如果未来进入 remote runtime 项目，至少要新增以下测试基线：

1. **fake remote transport**
   - 模拟 socket 连接
   - 模拟半开、重连、断连、延迟消息

2. **路径映射测试**
   - 本地 workspace root 与远端 working directory 的映射
   - 相对路径、绝对路径、越界路径的行为

3. **权限模型测试**
   - local 与 remote 的审批、沙箱和 full-access 语义是否一致
   - UI 展示与后端实际执行面的对应关系

4. **事件恢复测试**
   - 远端 transport 短断后 thread 事件是否恢复
   - command 输出与 watch 事件是否乱序或丢失

5. **capability matrix 测试**
   - 某个 runtime profile 是否支持 watch
   - 某个 runtime profile 是否支持 exec-server
   - 前端在能力缺失时是否正确降级

### 8.3 为什么现有测试不能顺手扩一下就算完

因为现有 fake runtime 大概率只模拟了：

- 请求响应
- 通知顺序
- 本地关闭行为

而 remote runtime 项目真正要验证的是：

- transport 级故障
- 多层连接状态
- 跨语义边界的路径与权限一致性
- watch / exec / thread 事件之间的耦合恢复

这不是补几条 case 的量级，而是测试基线本身要扩成新的类别。

### 8.4 为什么这必须纳入单独项目

如果测试基线不单独立项，项目会进入一个危险状态：

- 代码看起来已经支持 remote
- 但回归只验证“理想路径能通”
- 一到断线、路径映射、权限误配、事件恢复这些真实场景就失稳

所以 remote runtime 项目必须把“测试基线建设”视为第一等交付物，而不是实施后补。

## 9. 这类项目到底在重构什么

把上面五个维度放在一起看，future remote runtime / watch / exec-server 项目本质上是在重构以下五件事：

1. **runtime transport 层**
   - 从单一 stdio 模式走向多 transport 模式

2. **workspace 语义层**
   - 从“本地路径即工作目录”走向“本地视图与远端视图需要映射”

3. **执行与授权层**
   - 从“本地 sidecar + 本地路径限制”走向“远端执行面 + 显式信任模型”

4. **前端状态层**
   - 从“统一事件流消费”走向“多层连接状态 + 能力探测 + 恢复语义”

5. **验证层**
   - 从“本地主链路回归”走向“跨 transport / 路径 / 权限 / 事件恢复的系统级验证”

只要把这五层看清楚，就会明白这已经是一个独立项目，而不是升级任务中的附属 patch。

## 10. 单独立项后的推荐项目定义

如果未来真的要启动，建议把项目定义成：

### 项目名称

`Remote Runtime and Execution Surface for Codex Server`

### 项目目标

- 为 `codex-server` 增加可选的 remote runtime 支持
- 在不破坏本地 `stdio` 默认路径的前提下，引入可控的 transport 抽象
- 为 watch / exec-server 等未来能力建立清晰接入边界

### 项目非目标

- 不在第一阶段替换本地 `stdio` 为默认 transport
- 不在没有路径语义方案前直接开放 remote `fs/*`
- 不在没有能力矩阵前让前端默认假设 watch / exec-server 一定存在

### 项目启动门槛

只有在以下条件满足时才应立项：

- 产品明确 remote runtime 的业务价值
- 远端执行面的托管边界明确
- 安全/权限边界至少有一版书面定义
- 有资源补齐 transport 与测试基线

## 11. 推荐工作包拆分

### Workstream A：Transport Layer

目标：

- 抽出 `stdio` 与 remote transport 的统一接口

核心问题：

- transport lifecycle
- reconnect
- initialize / reinitialize
- fatal vs transient error

### Workstream B：Path and Workspace Semantics

目标：

- 定义本地 workspace 与远端 working directory 的权威关系

核心问题：

- `cwd`
- path mapping
- remote root authority
- local path validation replacement

### Workstream C：Permission and Execution Boundary

目标：

- 定义 remote runtime、watch、exec-server 的授权和执行面边界

核心问题：

- approval / sandbox semantics
- full-access meaning
- remote-control authorization
- exec-server responsibility boundary

### Workstream D：Frontend Runtime State Model

目标：

- 为前端定义新的 runtime connectivity / capability / recovery 语义

核心问题：

- UI 状态分层
- degraded mode
- reconnect indicators
- watch/exec/thread 状态组合

### Workstream E：System Test Baseline

目标：

- 建立 remote transport、事件恢复、路径语义、权限边界的回归基线

核心问题：

- fixture design
- remote fake runtime
- reconnection tests
- capability matrix tests

## 12. 立项前必须回答的 15 个问题

如果未来有人想把这件事当作普通升级附带工作推进，应该先要求其回答以下问题；只要其中多数没有答案，就说明还不能混入升级：

1. remote runtime 的连接目标是谁维护？
2. transport 是 workspace 级还是全局级？
3. 本地 workspace root 与远端 working directory 的映射规则是什么？
4. `thread/start` 的 `cwd` 由谁定义？
5. `config/read` 读取的是哪一侧配置？
6. `fs/remove` 操作的是哪一侧文件系统？
7. 远端 full access 的作用域是什么？
8. `thread/shellCommand` 在 remote 模式下是否继续保留？
9. `command/exec` 与 `exec-server` 如何分工？
10. watch 是 workspace 级能力还是页面级能力？
11. 浏览器到 BFF 正常、BFF 到 runtime 异常时，前端如何展示？
12. remote transport 断开后，thread 订阅如何恢复？
13. 现有 fake runtime 如何扩展到 remote transport？
14. 哪些能力在 remote 模式下可以降级，哪些必须 hard fail？
15. 默认路径为什么仍应保持本地 `stdio`？

如果这些问题没有明确答案，就说明该工作尚处于“探索阶段”，不应伪装成升级附带 patch。

## 13. 对项目排期和协作方式的建议

这类项目不适合以“顺手做一下”的方式推进，推荐采用下面的协作方式：

1. 先做 architecture spike
   - 只回答 transport、路径、权限、事件、测试五大问题

2. 再拆 workstream
   - Transport
   - Path
   - Permission
   - UI state
   - Test baseline

3. 再做 feature-flagged implementation
   - 默认本地 `stdio`
   - remote 能力显式开启

4. 最后做产品化 UI 和运维控制面
   - watch 可视化
   - remote-control 管理入口
   - capability inspection

如果跳过前两步，直接“边实现边想语义”，后期成本一定更高。

## 14. 最终判断

future remote runtime、filesystem watch、exec-server 之所以必须单独立项，不是因为它们“代码量大一点”，而是因为它们会同时改变：

- transport 模型
- workspace 与路径语义
- 权限边界与信任关系
- UI 连接状态与事件恢复语义
- 测试基线与回归方法

这五个维度一起变化时，问题就已经从“升级兼容”变成“架构演进”。

所以正确做法不是：

- “升级到新版本时顺手接一下 remote/watch/exec”

而是：

- “当产品明确要进入 remote runtime 方向时，单独发起一个架构项目，并为 transport、路径、权限、UI、测试分别建立交付物”

## 15. 建议的下一步

如果只是为了维持当前 `v0.119.0` 升级结论，本文档已经足够，下一步不需要立刻动 remote runtime 代码。

如果后续产品真的决定推进这条路线，建议严格按下面顺序进入下一阶段：

1. 先写 remote runtime architecture spike
2. 再写 workstream-level implementation plan
3. 再以 feature flag 方式实现 transport abstraction
4. 再处理路径语义、权限边界、UI 状态和测试基线

不要反过来从 `exec-server` 或 watch 的某个单点接口开始 patch。那会让项目从第一天起就背上错误的系统边界。
