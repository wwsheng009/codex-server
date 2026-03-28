# `realtime_conversation` 在 app-server 场景下的调用说明

## 分析范围

- 分析对象仓库：`E:\projects\ai\codex`
- 目标场景：`codex app-server` 集成下，客户端如何调用 realtime 语音输入能力
- 分析时间：2026-03-28

## 一句话结论

在 app-server 场景下，所谓“realtime 语音输入接口”并不是一个单独的 HTTP 端点，而是一组 thread-scoped JSON-RPC 方法：

1. `initialize` 时显式开启 `capabilities.experimentalApi = true`
2. 确保目标线程具备 `realtime_conversation` 能力
3. 调用 `thread/realtime/start`
4. 在收到 `thread/realtime/started` 之后，持续调用 `thread/realtime/appendAudio`
5. 通过 `thread/realtime/transcriptUpdated`、`thread/realtime/outputAudio/delta`、`thread/realtime/itemAdded` 等通知收流
6. 结束时调用 `thread/realtime/stop`

其中，真正的“语音输入”方法是：

- `thread/realtime/appendAudio`

但它只能在已经启动成功的 realtime 会话上使用。`thread/realtime/start` 返回的 `{}` 只表示请求被 app-server 接受并转发到了 core，不等于上游 realtime websocket 已经连通；真正表示可开始送音频的是 `thread/realtime/started` 通知。

## 1. 先理解调用链

从 app-server 客户端视角看，调用链是：

```text
客户端 JSON-RPC
  -> app-server 的 thread/realtime/*
  -> core 的 Op::RealtimeConversation*
  -> codex-api 的 realtime websocket client
  -> 上游 provider 的 /v1/realtime websocket
```

也就是说：

- 客户端不会直接调用 `/v1/realtime`
- 客户端只和 `codex app-server` 的 JSON-RPC 方法交互
- app-server 负责线程能力校验、协议层 experimental gate、事件转发
- core 负责真正建立上游 realtime websocket 会话

## 2. 前置条件

### 2.1 连接级前置条件：必须先 `initialize`

每条 app-server 连接都必须先完成：

1. `initialize`
2. `initialized`

否则任何后续 realtime 请求都会因为连接未初始化而被拒绝。

最小初始化示例：

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "my_realtime_client",
      "title": "My Realtime Client",
      "version": "0.1.0"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

随后客户端还需要发送：

```json
{
  "method": "initialized"
}
```

这里的 `experimentalApi = true` 是必须的，因为以下方法和通知都被协议层标成 experimental：

- `thread/realtime/start`
- `thread/realtime/appendAudio`
- `thread/realtime/appendText`
- `thread/realtime/stop`
- `thread/realtime/*` 全套通知

如果没开，app-server 会在协议层直接拒绝，例如：

```text
thread/realtime/start requires experimentalApi capability
```

### 2.2 线程级前置条件：目标线程必须启用 `realtime_conversation`

即使连接已经开启了 `experimentalApi`，目标线程仍然必须满足：

```text
thread.enabled(Feature::RealtimeConversation) == true
```

否则 app-server 在转发到 core 之前就会直接报错：

```text
thread {thread_id} does not support realtime conversation
```

这说明 app-server 对 realtime 有两层门禁：

1. 连接是否 opt-in experimental API
2. 线程是否具备 realtime feature 能力

### 2.3 鉴权前置条件：底层 realtime 仍然需要 API key

在 core 中，realtime 启动时会额外要求可用 API key。如果拿不到，会生成 realtime 错误事件，最终由 app-server 转成：

- `thread/realtime/error`

典型错误消息是：

```text
realtime conversation requires API key auth
```

所以：

- `thread/realtime/start` 的响应 `{}` 不是“启动一定成功”
- 真正的失败可能会在稍后以 `thread/realtime/error` 通知体现

## 3. 如何让线程具备 `realtime_conversation` 能力

这是 app-server 集成里最关键、也最容易误判的一部分。

### 3.1 推荐方式：在 `thread/start` 时按线程覆盖配置

`thread/start` 的 `params.config` 支持“点路径”形式的 per-request 配置覆盖。源码注释明确说明：

- `params.config` 会作为 per-request dotted-path overrides 参与 `ConfigBuilder`

因此，新线程最直接的做法是：

```json
{
  "method": "thread/start",
  "id": 2,
  "params": {
    "cwd": "E:\\projects\\ai\\codex",
    "config": {
      "features.realtime_conversation": true
    }
  }
}
```

这条路径的优点是：

- 不需要先改用户全局 `config.toml`
- 只对当前新建线程生效
- 最符合“按线程启用 capability”的语义

如果你不是创建新线程，而是从磁盘恢复一个尚未加载的线程，也可以在 `thread/resume` 时用同样的 `config` 覆盖：

```json
{
  "method": "thread/resume",
  "id": 3,
  "params": {
    "threadId": "thr_123",
    "config": {
      "features.realtime_conversation": true
    }
  }
}
```

但是，这里要注意一个非常重要的边界，见下文 3.3。

### 3.2 持久方式：先写用户配置，再创建新线程

如果你希望把 feature 打开到用户级配置，可以调用：

- `config/value/write`
- 或 `config/batchWrite`

最小示例：

```json
{
  "method": "config/value/write",
  "id": 4,
  "params": {
    "keyPath": "features.realtime_conversation",
    "value": true,
    "mergeStrategy": "replace"
  }
}
```

如果你使用批量写入，也可以：

```json
{
  "method": "config/batchWrite",
  "id": 5,
  "params": {
    "edits": [
      {
        "keyPath": "features.realtime_conversation",
        "value": true,
        "mergeStrategy": "replace"
      }
    ],
    "reloadUserConfig": true
  }
}
```

这类做法适合：

- 你希望后续新线程默认就具备 realtime 能力
- 你希望配置落盘到用户 `config.toml`

### 3.3 重要边界：已加载线程不会因为热更新自动获得该能力

源码显示，`Session` 内部单独保存了一份 feature 集合，并且注释写得非常明确：

```text
The set of enabled features should be invariant for the lifetime of the session.
```

同时，session 创建时会把：

```text
config.features.clone()
```

固化到 `Session.features` 中。

这带来两个直接结论：

1. 对已经加载到内存里的线程来说，feature 更像“线程能力快照”
2. 后续 `config/value/write` / `config/batchWrite(reloadUserConfig=true)` 并不会直接修改这个已存在的 `Session.features`

更进一步，app-server 的 `thread/resume` 对“已经运行中的 loaded thread”还有一个特殊逻辑：

- 如果线程已经在内存中，`resume_running_thread(...)` 会直接复用当前线程
- 这时传入的 resume overrides 可能会被忽略

所以在 app-server 使用场景里，最安全的结论是：

- 想用 realtime，最好在 `thread/start` 之前就把 feature 打开
- 如果线程已经 loaded，不要假设 `reloadUserConfig` 后它就能立刻支持 realtime
- 对已经 loaded 的线程，最稳妥的做法是新建线程
- 如果必须复用旧线程，至少要先确保该线程被真正 unload，再重新 `thread/resume`

app-server 里，线程只有在“最后一个 subscriber 退订”之后才会真正 unload；也就是：

- `thread/unsubscribe`
- 且该连接是最后一个订阅者

这时线程才会关闭并从内存移除。

### 3.4 可选的能力探测方式

如果你希望在客户端做前置探测，可以用：

- `experimentalFeature/list`

它会返回 feature 的：

- `name`
- `stage`
- `enabled`
- `defaultEnabled`

对于 `realtime_conversation`，你可以用它确认：

- 当前 server 版本是否认识这个 feature
- 当前加载的配置里它是否 enabled

但要注意：

- 这更接近“当前配置视角”
- 真正决定某个 thread 是否可用的，仍然是该 thread 的 session feature 快照

## 4. 正确的调用时序

推荐调用时序如下：

1. 连接 app-server
2. 发送 `initialize`，并在 `capabilities.experimentalApi` 中设 `true`
3. 发送 `initialized`
4. 创建一个已启用 `realtime_conversation` 的线程
5. 调用 `thread/realtime/start`
6. 等待 `thread/realtime/started`
7. 开始循环调用 `thread/realtime/appendAudio`
8. 并行消费 `thread/realtime/transcriptUpdated` / `thread/realtime/outputAudio/delta` / `thread/realtime/itemAdded` / `thread/realtime/error` / `thread/realtime/closed`
9. 结束时调用 `thread/realtime/stop`

这里最关键的时序要求是：

- 不要在 `thread/realtime/started` 之前发送音频
- `thread/realtime/start` 的同步响应 `{}` 只代表“请求已受理”，不代表“session 已 ready”

## 5. 每个相关接口该怎么调用

### 5.1 `thread/realtime/start`

请求参数在协议层定义为：

- `threadId: string`
- `prompt: string`
- `sessionId?: string | null`

示例：

```json
{
  "method": "thread/realtime/start",
  "id": 10,
  "params": {
    "threadId": "thr_123",
    "prompt": "You are the live voice assistant for this coding session.",
    "sessionId": "rt_session_001"
  }
}
```

成功的同步响应是空对象：

```json
{
  "id": 10,
  "result": {}
}
```

但真正表示启动成功的是后续通知：

```json
{
  "method": "thread/realtime/started",
  "params": {
    "threadId": "thr_123",
    "sessionId": "rt_session_001",
    "version": "v1"
  }
}
```

这里有几个关键技术细节：

- `prompt` 会进入 core 的 `ConversationStartParams`
- 如果服务端配置了 `experimental_realtime_ws_backend_prompt`，它可能覆盖请求里的 `prompt`
- core 还会把 startup context 追加进 realtime websocket instructions
- `sessionId` 如果省略，core 会默认使用 `threadId`
- `sessionId` 最终还会被写到上游请求头 `x-session-id`

因此，`sessionId` 更适合作为：

- 你的客户端侧 realtime 会话相关性标识
- 或跨系统追踪值

### 5.2 `thread/realtime/appendAudio`

这是真正的“语音输入接口”。

协议层定义的请求参数是：

- `threadId: string`
- `audio: { data, sampleRate, numChannels, samplesPerChannel?, itemId? }`

最小示例：

```json
{
  "method": "thread/realtime/appendAudio",
  "id": 11,
  "params": {
    "threadId": "thr_123",
    "audio": {
      "data": "AAAAAA==",
      "sampleRate": 24000,
      "numChannels": 1,
      "samplesPerChannel": 480,
      "itemId": null
    }
  }
}
```

同步成功响应仍然只是：

```json
{
  "id": 11,
  "result": {}
}
```

这个响应表示：

- app-server 已经把这个音频块转发到了 core 的 `Op::RealtimeConversationAudio`

它不表示：

- 这段音频已经被上游转写完成
- 或已经生成了 assistant 输出

真正的结果要看后续通知，例如：

- `thread/realtime/transcriptUpdated`
- `thread/realtime/outputAudio/delta`
- `thread/realtime/itemAdded`
- `thread/realtime/error`

### 输入音频格式的源码级说明

结合 `codex-api` 的 websocket 实现，实际有一个很重要的细节：

- realtime websocket 的 `session.update` 会把输入格式声明为 `audio/pcm`
- 采样率固定为 `24000`

也就是说，底层上游会话约定的是：

- `audio/pcm`
- `24kHz`

更进一步，当前 websocket writer 在发送 `input_audio_buffer.append` 时，真正写入上游的只有：

- `audio` 这一个 base64 字段

也就是说，app-server 请求里 `sampleRate`、`numChannels`、`samplesPerChannel` 这些字段，当前实现并不会被逐字段转发到上游 websocket 消息中。

因此，更准确的工程结论是：

- 客户端应该主动把 `audio.data` 按“24kHz、PCM、单声道”准备好
- `sampleRate = 24000`、`numChannels = 1` 应当与实际音频一致
- `samplesPerChannel` 建议填写，便于客户端本地 bookkeeping；即使不填，某些内部逻辑也能按 base64 解码后的字节数推导

从代码行为推断，最稳妥的发送格式是：

- `PCM16`
- `mono`
- `24_000 Hz`
- 原始字节再做 base64

需要特别强调：

- 当前源码没有看到 app-server 对输入音频格式做严格服务端校验
- 但 websocket session contract 明确声明了 `audio/pcm` + `24000`
- 因此客户端最好自己严格对齐这份 contract，而不是依赖服务端容错

### 5.3 `thread/realtime/appendText`

这个接口不是语音输入本身，而是给已启动的 realtime 会话追加文本输入。

请求参数：

- `threadId: string`
- `text: string`

示例：

```json
{
  "method": "thread/realtime/appendText",
  "id": 12,
  "params": {
    "threadId": "thr_123",
    "text": "请继续总结刚才用户说的话。"
  }
}
```

它适合：

- 调试 realtime 会话是否正常
- 做“语音 + 文本混合输入”的客户端
- 某些非麦克风来源的文本注入

如果你只是要做标准麦克风输入，核心接口仍然是 `appendAudio`。

### 5.4 `thread/realtime/stop`

停止当前线程上的 active realtime 会话：

```json
{
  "method": "thread/realtime/stop",
  "id": 13,
  "params": {
    "threadId": "thr_123"
  }
}
```

同步响应：

```json
{
  "id": 13,
  "result": {}
}
```

随后通常会看到：

```json
{
  "method": "thread/realtime/closed",
  "params": {
    "threadId": "thr_123",
    "reason": "requested"
  }
}
```

根据 core 实现，`closed.reason` 常见值包括：

- `requested`
- `transport_closed`
- `error`

## 6. 客户端需要处理哪些通知

在 app-server 集成中，真正有价值的信息大多来自通知，而不是同步响应。

### 6.1 `thread/realtime/started`

源码层的真实 payload 是：

- `threadId`
- `sessionId`
- `version`

注意这里的 `version` 是源码里明确存在的字段，值来自 `RealtimeConversationVersion`，目前是：

- `v1`
- `v2`

所以如果客户端要兼容不同 realtime websocket 协议代际，应该读这个字段，而不是只看 README 里的简化描述。

### 6.2 `thread/realtime/transcriptUpdated`

payload：

- `threadId`
- `role`
- `text`

这里的 `text` 是增量，不是完整 transcript。客户端如果想显示完整实时字幕，需要自己按顺序累计。

`role` 目前来自 core 的映射：

- 用户侧输入转写 -> `user`
- assistant 侧输出转写 -> `assistant`

### 6.3 `thread/realtime/outputAudio/delta`

payload：

- `threadId`
- `audio`

其中 `audio` 的源码真实字段是：

- `data`
- `sampleRate`
- `numChannels`
- `samplesPerChannel`
- `itemId`

也就是说，除了 README 提到的几个字段以外，源码里的通知还包含：

- `itemId`

客户端如果要做精细播放队列或把音频片段归并到某个 assistant item，可以利用它。

### 6.4 `thread/realtime/itemAdded`

这是一个“兜底原始事件”通知，app-server 会把若干没有专门 typed notification 的 realtime 事件都经由它转发。

当前源码里至少会出现这些类型：

- `input_audio_buffer.speech_started`
- `response.cancelled`
- 原始 `conversation item`
- `handoff_request`

其中 `handoff_request` 很重要，它意味着 realtime 侧请求把内容移交回常规 Codex 流程。

### 6.5 `thread/realtime/error`

用于承载 realtime 启动失败、传输失败、后端失败等错误，例如：

- API key 不可用
- websocket 建连失败
- 向上游发送输入失败

这条通知非常关键，因为 `thread/realtime/start` 自身的同步响应并不会携带这些异步启动错误。

### 6.6 `thread/realtime/closed`

表示 realtime 传输层已经结束。客户端应在收到它后：

- 停止继续发送 `appendAudio`
- 收尾本地录音状态
- 清理播放器或缓冲区

## 7. 一个最小的端到端调用示例

下面给出一条更接近实际集成的建议顺序。

### 7.1 初始化连接

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "my_realtime_client",
      "title": "My Realtime Client",
      "version": "0.1.0"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

```json
{
  "method": "initialized"
}
```

### 7.2 创建一个带 realtime feature 的新线程

```json
{
  "method": "thread/start",
  "id": 2,
  "params": {
    "cwd": "E:\\projects\\ai\\codex",
    "config": {
      "features.realtime_conversation": true
    }
  }
}
```

假设响应里拿到：

```json
{
  "id": 2,
  "result": {
    "thread": {
      "id": "thr_123"
    }
  }
}
```

### 7.3 启动 realtime 会话

```json
{
  "method": "thread/realtime/start",
  "id": 3,
  "params": {
    "threadId": "thr_123",
    "prompt": "You are the live voice assistant for this coding session."
  }
}
```

收到 `{}` 后，不要立刻开始推流，先等：

```json
{
  "method": "thread/realtime/started",
  "params": {
    "threadId": "thr_123",
    "sessionId": "thr_123",
    "version": "v1"
  }
}
```

### 7.4 开始推送麦克风音频

```json
{
  "method": "thread/realtime/appendAudio",
  "id": 4,
  "params": {
    "threadId": "thr_123",
    "audio": {
      "data": "<base64_pcm_24khz_mono_chunk>",
      "sampleRate": 24000,
      "numChannels": 1,
      "samplesPerChannel": 480,
      "itemId": null
    }
  }
}
```

然后持续读取通知，例如：

```json
{
  "method": "thread/realtime/transcriptUpdated",
  "params": {
    "threadId": "thr_123",
    "role": "user",
    "text": "帮我看看这个 feature 开关..."
  }
}
```

```json
{
  "method": "thread/realtime/outputAudio/delta",
  "params": {
    "threadId": "thr_123",
    "audio": {
      "data": "<base64_pcm_chunk>",
      "sampleRate": 24000,
      "numChannels": 1,
      "samplesPerChannel": 512,
      "itemId": "item_456"
    }
  }
}
```

### 7.5 停止 realtime

```json
{
  "method": "thread/realtime/stop",
  "id": 5,
  "params": {
    "threadId": "thr_123"
  }
}
```

收尾时通常会看到：

```json
{
  "method": "thread/realtime/closed",
  "params": {
    "threadId": "thr_123",
    "reason": "requested"
  }
}
```

## 8. 几个最容易踩坑的点

### 坑 1：只开了 feature，没有开 `experimentalApi`

结果是协议层直接拒绝，连 thread feature 检查都走不到。

### 坑 2：只在连接上开了 `experimentalApi`，但线程本身不支持 realtime

结果是 app-server 返回：

```text
thread {thread_id} does not support realtime conversation
```

### 坑 3：对已经 loaded 的线程改配置后，立刻就想调用 realtime

这通常不可靠，因为 feature 集合在 session 生命周期内被当作不变量。最安全的做法是：

- 新建线程
- 或确保旧线程真的 unload 后再 resume

### 坑 4：把 `thread/realtime/start` 的 `{}` 当成“已经连上”

不对。真正 ready 的标志是：

- `thread/realtime/started`

失败则看：

- `thread/realtime/error`

### 坑 5：发送了不匹配 websocket session contract 的音频格式

源码显示底层 session 约定的是：

- `audio/pcm`
- `24000 Hz`

因此客户端应主动按这个格式准备输入，不要赌服务端会自动纠正。

### 坑 6：把 `transcriptUpdated.text` 当成完整文本

它只是 delta，不是完整 transcript。需要客户端自行累计。

## 9. 建议的客户端实现策略

如果你要在 `codex-server` 或其它前端里封装这个能力，比较稳妥的实现方式是：

1. 连接建立后，固定在 `initialize` 里开启 `experimentalApi`
2. 创建 realtime 专用线程时，在 `thread/start.params.config` 里显式加上 `features.realtime_conversation = true`
3. 只有在收到 `thread/realtime/started` 后才开始送麦克风音频
4. 用 `thread/realtime/transcriptUpdated` 做实时字幕
5. 用 `thread/realtime/outputAudio/delta` 做流式播报
6. 用 `thread/realtime/error` 和 `thread/realtime/closed` 做状态机收口

这种做法比“先改全局配置，再赌现有线程会热更新”要稳得多。

## 10. 关键源码索引

- `E:\projects\ai\codex\codex-rs\app-server-protocol\src\protocol\common.rs`
- `E:\projects\ai\codex\codex-rs\app-server-protocol\src\protocol\v1.rs`
- `E:\projects\ai\codex\codex-rs\app-server-protocol\src\protocol\v2.rs`
- `E:\projects\ai\codex\codex-rs\app-server-protocol\src\experimental_api.rs`
- `E:\projects\ai\codex\codex-rs\app-server\src\message_processor.rs`
- `E:\projects\ai\codex\codex-rs\app-server\src\codex_message_processor.rs`
- `E:\projects\ai\codex\codex-rs\app-server\src\bespoke_event_handling.rs`
- `E:\projects\ai\codex\codex-rs\app-server\src\config_api.rs`
- `E:\projects\ai\codex\codex-rs\app-server\README.md`
- `E:\projects\ai\codex\codex-rs\core\src\codex.rs`
- `E:\projects\ai\codex\codex-rs\core\src\codex_thread.rs`
- `E:\projects\ai\codex\codex-rs\core\src\realtime_conversation.rs`
- `E:\projects\ai\codex\codex-rs\protocol\src\protocol.rs`
- `E:\projects\ai\codex\codex-rs\codex-api\src\endpoint\realtime_websocket\protocol.rs`
- `E:\projects\ai\codex\codex-rs\codex-api\src\endpoint\realtime_websocket\methods.rs`
- `E:\projects\ai\codex\codex-rs\codex-api\src\endpoint\realtime_websocket\methods_common.rs`
- `E:\projects\ai\codex\codex-rs\codex-api\src\endpoint\realtime_websocket\methods_v1.rs`
- `E:\projects\ai\codex\codex-rs\codex-api\src\endpoint\realtime_websocket\methods_v2.rs`
