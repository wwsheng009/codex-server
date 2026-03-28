# `realtime_conversation` 功能开关分析

## 分析范围

- 分析对象仓库：`E:\projects\ai\codex`
- 目标对象：运行时 feature 开关 `realtime_conversation`
- 分析时间：2026-03-28

## 一句话结论

`realtime_conversation` 不是 Cargo 编译期开关，而是一个运行时功能开关。它的主要作用不是决定底层 realtime 代码是否存在，而是决定这项能力是否对 TUI 和 app-server 暴露出来，尤其体现在：

- TUI 是否显示 `/realtime` 和相关音频设置入口
- app-server 的线程是否允许调用 `thread/realtime/*` 系列接口
- 当前已经启动的 realtime 会话在运行时被关闭时如何收口

从实现边界上看，它更像是“能力暴露开关”而不是“底层实现存在与否开关”。

## 1. 开关定义

该开关定义在 feature 注册表中：

- 文件：`codex-rs/features/src/lib.rs`
- 关键定义：
  - `id: Feature::RealtimeConversation`
  - `key: "realtime_conversation"`
  - `stage: Stage::UnderDevelopment`
  - `default_enabled: false`

这说明它是：

- 运行时配置项
- 默认关闭
- 当前仍处于开发中，而不是稳定功能

配置 schema 中也暴露了这个键：

- 文件：`codex-rs/core/config.schema.json`
- 路径：`[features].realtime_conversation`
- 类型：`boolean`

也就是说，用户可以通过配置文件里的如下形式开启它：

```toml
[features]
realtime_conversation = true
```

## 2. 它不是编译期 feature

代码里没有把它当作 Cargo feature 来处理，而是通过统一的 feature 管理体系在运行时读取，例如：

- `self.config.features.enabled(Feature::RealtimeConversation)`
- `thread.enabled(Feature::RealtimeConversation)`

这意味着：

- 二进制里已经包含相关 realtime 实现
- 开关控制的是是否允许用户或客户端使用这套能力
- 功能开关的影响更多集中在入口层和线程能力层

## 3. TUI 中的作用

### 3.1 控制是否显示 realtime 能力

在 TUI 中，是否允许进入 realtime 模式由如下条件共同决定：

- `Feature::RealtimeConversation` 已启用
- 当前目标平台不是 Linux

对应逻辑位于：

- `codex-rs/tui/src/chatwidget.rs`
- `codex-rs/tui_app_server/src/chatwidget.rs`

核心判断大意是：

```rust
self.config.features.enabled(Feature::RealtimeConversation)
    && cfg!(not(target_os = "linux"))
```

因此，即使配置里打开了该 feature，在 Linux 上 UI 侧仍不会把它当成可用功能。

### 3.2 控制 `/realtime` 和 `/settings` 是否可见

TUI 的底部命令系统会按 feature 动态筛掉命令：

- `/realtime` 受 `realtime_conversation_enabled` 控制
- `/settings` 受音频设备选择能力控制，而这个能力又依赖 realtime 可用

对应文件：

- `codex-rs/tui/src/bottom_pane/slash_commands.rs`
- `codex-rs/tui_app_server/src/bottom_pane/slash_commands.rs`

这层逻辑的实际效果是：

- 开关关闭时，用户在命令面板中看不到 `/realtime`
- 也看不到用于配置麦克风/扬声器的 `/settings`

### 3.3 控制 `/realtime` 命令是否真的生效

即使用户 somehow 触发了 `SlashCommand::Realtime`，代码仍会在执行前再判断一次：

- 未启用时直接返回
- 已启用时才会在“启动 realtime”和“关闭 realtime”之间切换

对应文件：

- `codex-rs/tui/src/chatwidget.rs`
- `codex-rs/tui_app_server/src/chatwidget.rs`

### 3.4 开启后 UI 行为变成 audio-only

当 realtime 模式 live 之后，TUI 会把用户的正常文本提交拦下来，不直接作为普通消息提交，而是：

- 把输入内容恢复回 composer
- 给用户显示提示：
  - `Realtime voice mode is audio-only. Use /realtime to stop.`

对应文件：

- `codex-rs/tui/src/chatwidget/realtime.rs`
- `codex-rs/tui_app_server/src/chatwidget/realtime.rs`

这说明这个 feature 打开的不是“普通聊天 + 语音增强”，而是一个专门的实时语音会话模式。

### 3.5 运行中关闭 feature 会强制终止会话

如果 realtime 已经 live，此时用户或系统把 `Feature::RealtimeConversation` 关闭，TUI 会主动关闭当前 realtime 会话，并提示：

`Realtime voice mode was closed because the feature was disabled.`

对应文件：

- `codex-rs/tui/src/chatwidget.rs`
- `codex-rs/tui_app_server/src/chatwidget.rs`

这说明该开关不仅控制入口，也会影响已经运行中的会话生命周期。

## 4. app-server 中的作用

### 4.1 控制线程是否支持 `thread/realtime/*`

app-server 为 realtime 暴露了 4 个线程级 RPC：

- `thread/realtime/start`
- `thread/realtime/appendAudio`
- `thread/realtime/appendText`
- `thread/realtime/stop`

这些入口在真正转发到 core 之前，都会先走同一个线程检查：

- 加载线程
- 确保线程监听器已附着
- 检查 `thread.enabled(Feature::RealtimeConversation)`

如果线程不支持该能力，则直接返回：

```text
thread {thread_id} does not support realtime conversation
```

对应文件：

- `codex-rs/app-server/src/codex_message_processor.rs`

这说明在 app-server 中，`realtime_conversation` 的语义是“该线程是否具备 realtime 能力”。

### 4.2 app-server 只是桥接到 core 的 realtime Op

通过检查 `thread_realtime_start` / `appendAudio` / `appendText` / `stop` 的实现，可以看到 app-server 实际只是把请求桥接成 core 的这几个操作：

- `Op::RealtimeConversationStart`
- `Op::RealtimeConversationAudio`
- `Op::RealtimeConversationText`
- `Op::RealtimeConversationClose`

也就是说：

- app-server 自己不实现 realtime 业务逻辑
- 它负责做入口校验、协议转换和响应封装
- 真正的 websocket 会话和音频/文本流处理发生在 core

### 4.3 realtime 事件不是持久 ThreadItem

app-server README 对 realtime 通知的定位很明确：

- `thread/realtime/*` 是单独的线程级通知面
- 这些是临时传输事件
- 它们不是 `ThreadItem`
- 不会出现在 `thread/read`、`thread/resume`、`thread/fork` 的结果里

这点非常重要，因为它决定了该 feature 的数据形态：

- 它主要是“实时流”
- 不是会被完整落盘和回放的常规历史项

## 5. 它和 `experimentalApi` 的关系

这是最容易混淆的一点。

### 5.1 `realtime_conversation` 不等于 `experimentalApi`

两者是不同层面的开关：

- `realtime_conversation`
  - 是 feature 系统里的运行时能力开关
  - 决定线程和 UI 是否允许使用 realtime

- `experimentalApi`
  - 是 app-server 协议初始化阶段的客户端 opt-in
  - 决定客户端是否允许调用实验性 RPC/接收实验性通知

### 5.2 app-server 中是双重门禁

`thread/realtime/start`、`appendAudio`、`appendText`、`stop` 在协议层本身都被标注为 experimental：

- `#[experimental("thread/realtime/start")]`
- `#[experimental("thread/realtime/appendAudio")]`
- `#[experimental("thread/realtime/appendText")]`
- `#[experimental("thread/realtime/stop")]`

因此，对 app-server 客户端来说，要真正使用这套能力，必须同时满足：

1. `initialize.capabilities.experimentalApi = true`
2. 目标线程启用了 `Feature::RealtimeConversation`

少任何一个都不行：

- 没有 `experimentalApi`，协议层直接拒绝，报：
  - `<descriptor> requires experimentalApi capability`
- 有 `experimentalApi` 但线程 feature 没开，业务层继续拒绝，报：
  - `thread {thread_id} does not support realtime conversation`

所以它不是一个单一开关，而是“协议允许 + 线程支持”两层校验。

## 6. core 中真正发生了什么

### 6.1 realtime 核心逻辑始终存在

core 中有完整的 realtime 实现模块：

- `codex-rs/core/src/realtime_conversation.rs`

它负责：

- 建立 realtime websocket 连接
- 配置会话参数
- 发送音频帧和文本
- 接收输出音频、转写、错误和 handoff 事件
- 在会话结束时发出关闭通知

### 6.2 启动时会构造 realtime websocket 会话

`handle_start()` 最终会：

- 准备 provider 和鉴权头
- 拼接 websocket instructions
- 构造 `RealtimeSessionConfig`
- 启动 `RealtimeConversationManager`
- 发出 `RealtimeConversationStarted` 事件

如果启动失败，会通过 realtime 错误事件向上游报告。

### 6.3 底层上游连接默认是 `/v1/realtime`

这里有一个容易误解的实现细节：

- 对 Codex 客户端来说，外部看到的是：
  - `thread/realtime/*` RPC
  - `Op::RealtimeConversation*` 内部操作
- 但对上游模型 provider 来说，底层真正建立的是一条 realtime websocket 连接

这条连接默认访问的就是：

```text
/v1/realtime
```

更准确地说，`codex-api` 中的 realtime websocket URL 归一化逻辑会做下面几件事：

- 如果 base URL 没有 path，直接把 path 设成 `/v1/realtime`
- 如果 base URL 以 `/v1` 或 `/v1/` 结尾，则自动补成 `/v1/realtime`
- 如果 base URL 已经以 `/realtime` 结尾，则保留现有 realtime 路径，不重复改写
- 同时把协议从 `http/https` 转成 `ws/wss`

这说明它访问的不是普通 REST 端点，而是一条专门的 realtime websocket 连接。

这层行为还有两个重要含义：

- 配置项 `experimental_realtime_ws_base_url` 覆盖的只是 realtime conversation 专用 websocket base URL
- 它不是让 app-server 客户端直接去调用 `/v1/realtime`，而是让 core 在底层连到该上游端点，再由 Codex 自己向外暴露更高层封装接口

测试中也直接断言过握手 URI 形如：

```text
/v1/realtime?intent=quicksilver&model=realtime-test-model
```

因此，更准确的描述应该是：

- `realtime_conversation` 对外暴露的是 Codex 自己的 realtime 能力接口
- 但这套能力在底层默认依赖访问上游 provider 的 `/v1/realtime` websocket 端点

### 6.4 会注入 startup context

启动 realtime 时，core 会尝试构造 startup context：

- 默认走 `build_realtime_startup_context(...)`
- 然后把结果追加到 websocket instructions 中

这说明 realtime 会话不是裸连接，它会带上一定的上下文，让上游模型知道当前 Codex 环境和状态。

### 6.5 需要 API key 鉴权

realtime 逻辑里有一个明确约束：

如果拿不到可用 API key，则返回：

`realtime conversation requires API key auth`

因此即使 feature 打开，也不代表用户一定能成功进入该模式；认证条件仍然独立存在。

### 6.6 realtime 不只是音频收发，还会触发 handoff

当 realtime 上游发出 `HandoffRequested` 时，core 会从事件里提取文本，然后调用：

- `route_realtime_text_input(text)`

把这段文本重新注入普通 Codex 输入通路。

这意味着该 feature 不只是“实时播报/收音”，它还承担一个桥接作用：

- 实时语音侧负责实时交互
- 某些时刻会把转写文本移交回常规 Codex 任务通路

这也是 README 中 `thread/realtime/itemAdded` 会出现 `handoff_request` 的原因。

## 7. 它如何影响 prompt/history

除了实时流本身，realtime 状态还会影响上下文管理逻辑。

在 turn context 更新时：

- realtime 从 inactive 变 active，会插入 realtime start 的开发者消息
- realtime 从 active 变 inactive，会插入 realtime end 的开发者消息

这些消息会带有 `<realtime_conversation>` 标记。

另外，配置项：

- `experimental_realtime_start_instructions`

可以替换掉 realtime 启动时插入到开发者消息中的内置说明，但它只影响 prompt history 中的 realtime start 消息，不影响 websocket backend prompt 本身。

这说明 `realtime_conversation` 不只是一个 UI/传输开关，它还会影响模型看到的会话上下文。

## 8. 一个关键实现边界：底层并不会再次用 feature 拦截

检查 core 的主操作分发可以看到，`Op::RealtimeConversationStart` / `Audio` / `Text` / `Close` 会直接进入对应 handler。

换句话说：

- core 的底层实现本身没有在这里再次检查 `Feature::RealtimeConversation`
- 真正负责“挡入口”的是更外层的 TUI 和 app-server

这进一步证明该 feature 的定位更接近：

- 能力暴露开关
- 入口门禁开关

而不是：

- 底层功能模块编译/加载开关

## 9. 线程级语义：feature 更像 session/线程能力快照

core 的 `Session` 内部保存了一份 feature 集合，并且代码注释写得很明确：

> The set of enabled features should be invariant for the lifetime of the session.

同时，`Session` 初始化时会把 `config.features.clone()` 固化进去。

这意味着：

- feature 对一个 session/thread 来说，语义上是“创建时的能力快照”
- 不是每次请求都重新读取一次全局配置

从 app-server 那边的 `thread.enabled(Feature::RealtimeConversation)` 调用方式看，`realtime_conversation` 在运行时体现出来的是线程能力，而不是纯全局即时状态。

TUI 内部允许运行时切换 feature 并关闭当前会话，那是 UI 层的补充控制，不改变这个 feature 在 core session 语义上偏“会话不变量”的事实。

## 10. 最终归纳

`realtime_conversation` 这个开关的作用可以归纳为四层：

### 第一层：配置层

- 在 feature 注册表中定义一个默认关闭的运行时开关

### 第二层：UI 层

- 控制 TUI 是否显示 `/realtime` 和音频设置入口
- 控制是否允许用户进入实时语音模式
- 在关闭 feature 时主动结束正在运行的 realtime 会话

### 第三层：app-server 入口层

- 控制线程是否接受 `thread/realtime/*` RPC
- 没开时直接拒绝请求

### 第四层：实时业务层

- 一旦放行，就启动到底层 `/v1/realtime` 的 websocket realtime 会话
- 处理音频输入、文本输入、输出音频、转写、handoff、错误和关闭事件
- 同时把状态变化反映到 prompt history 中

## 11. 结论建议

如果以后要在 `codex-server` 里对接这项能力，最好把它理解成下面这个模型：

- `realtime_conversation`：服务端/线程是否支持 realtime
- `experimentalApi`：客户端协议是否允许调用 realtime 实验接口
- realtime 本体：一个独立于普通 ThreadItem 历史的临时流式子系统

如果要做产品化封装，建议单独处理这三件事：

1. 能力发现
   - 当前线程是否支持 realtime

2. 协议协商
   - 客户端是否已在 initialize 中开启 `experimentalApi`

3. 生命周期管理
   - realtime 是否已启动
   - 是否需要收听 `thread/realtime/*` 临时事件
   - 是否需要把 handoff 文本重新并入常规会话流

## 12. `codex-server` 中的误用与修复

基于上面的边界分析，可以明确得出一个对 `codex-server` 很重要的结论：

- `realtime_conversation` 不是“普通线程流式会话开关”
- 它也不是“只要跑 app-server 就应该默认打开”的基础能力
- 它的语义更接近“是否对外暴露 realtime 语音会话能力”

### 12.1 之前的误用点

`codex-server` 里曾经有一处错误用法：

- 文件：`backend/internal/config/config.go`
- 旧行为：只要检测到命令像 `codex app-server ...`，就自动追加：
  - `--enable realtime_conversation`

这个行为的问题在于：

- 它把 `realtime_conversation` 当成了 app-server 常规工作模式的一部分
- 但从 `codex-rs` 的实现看，这个 feature 真正控制的是：
  - TUI 是否显示 `/realtime` 和相关音频设置
  - app-server 是否允许进入 `thread/realtime/*` 这套实时语音 RPC
- 它并不控制普通的：
  - `thread/start`
  - `turn/start`
  - `thread/read`
  - `thread/list`
  - 常规线程事件流 / 增量输出

换句话说，`codex-server` 的普通线程创建、普通回复流式返回、线程读取与恢复，本来就不应该依赖这个 feature。

### 12.2 为什么这是错误绑定

`codex-server` 当前对接 app-server 的主路径是常规线程 RPC，而不是 realtime 语音接口。典型调用包括：

- `thread/list`
- `thread/start`
- `thread/read`
- `thread/resume`
- `thread/fork`
- `thread/archive`
- `thread/shellCommand`

这些路径对应的是常规线程/回合模型，不是 `thread/realtime/*`。

因此，如果在 `codex-server` 里默认打开 `realtime_conversation`，含义就会被扭曲成：

- “为了让普通流式会话可用，所以必须开启 realtime”

这个结论是不成立的。

更准确的说法应该是：

- 普通流式会话是否可用，取决于常规线程与事件流链路是否正常
- `realtime_conversation` 只和 realtime 语音模式暴露有关

### 12.3 修复后的行为

在 `2026-03-28`，`codex-server` 已按这个结论修正：

- `backend/internal/config/config.go`
  - 不再对 `codex app-server` 默认注入 `--enable realtime_conversation`
- `backend/internal/config/config_test.go`
  - 删除“默认应开启 realtime_conversation”的错误测试预期
  - 增加回归测试，明确默认情况下命令应保持不变

修复后的原则是：

- 如果业务未来真的要暴露 realtime 语音能力，就显式开启 `realtime_conversation`
- 如果只是为了普通线程流式会话、线程事件同步、常规命令执行，不应碰这个 feature

### 12.4 对后续接入的建议

以后在 `codex-server` 里看到下面两类说法时，需要明确区分：

- “会话是流式返回的”
  - 这通常指普通线程事件流、增量输出、SSE/WebSocket 更新
- “支持 realtime conversation”
  - 这特指实时语音会话模式，以及 `thread/realtime/*` 接口链路

只有当产品真的要提供“实时语音对话”时，才应考虑：

1. 是否显式启用 `realtime_conversation`
2. 是否开放 `thread/realtime/*` 相关协议能力
3. 是否处理音频输入、输出音频、handoff 和会话关闭事件

否则，把它和普通流式会话绑定在一起，会持续制造错误认知和错误默认值。

## 13. 关键文件索引

- `E:\projects\ai\codex\codex-rs\features\src\lib.rs`
- `E:\projects\ai\codex\codex-rs\core\config.schema.json`
- `E:\projects\ai\codex\codex-rs\tui\src\chatwidget.rs`
- `E:\projects\ai\codex\codex-rs\tui\src\chatwidget\realtime.rs`
- `E:\projects\ai\codex\codex-rs\tui\src\bottom_pane\slash_commands.rs`
- `E:\projects\ai\codex\codex-rs\tui_app_server\src\chatwidget.rs`
- `E:\projects\ai\codex\codex-rs\tui_app_server\src\chatwidget\realtime.rs`
- `E:\projects\ai\codex\codex-rs\app-server\src\codex_message_processor.rs`
- `E:\projects\ai\codex\codex-rs\app-server\src\bespoke_event_handling.rs`
- `E:\projects\ai\codex\codex-rs\app-server\README.md`
- `E:\projects\ai\codex\codex-rs\app-server-protocol\src\protocol\common.rs`
- `E:\projects\ai\codex\codex-rs\codex-api\src\endpoint\realtime_websocket\methods.rs`
- `E:\projects\ai\codex\codex-rs\core\src\realtime_conversation.rs`
- `E:\projects\ai\codex\codex-rs\core\src\config\mod.rs`
- `E:\projects\ai\codex\codex-rs\core\tests\suite\realtime_conversation.rs`
- `E:\projects\ai\codex\codex-rs\core\src\codex.rs`
- `E:\projects\ai\codex\codex-rs\core\src\context_manager\updates.rs`
- `E:\projects\ai\codex\docs\config.md`
- `E:\projects\ai\codex-server\backend\internal\config\config.go`
- `E:\projects\ai\codex-server\backend\internal\config\config_test.go`
