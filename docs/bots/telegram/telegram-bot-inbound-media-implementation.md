# Telegram Bot 入站多媒体接收实现说明

## 0. 文档目的

本文档记录当前项目 `E:\projects\ai\codex-server` 中 Telegram bot 入站多媒体接收能力的实现结果、支持范围、限制条件和后续建议。

本文档对应的实现时间为 `2026-04-08`，面向本次已经落地的第一阶段能力。

## 1. 官方依据

Telegram Bot API 官方文档说明，bot 接收到的 `Update.message` 可以携带多种媒体字段，而不是只有文本：

- `photo`
- `video`
- `document`
- `voice`
- `audio`
- `caption`
- `media_group_id`

实际文件下载走官方 `getFile` 接口，然后根据返回的 `file_path` 下载文件内容。

官方参考：

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Message](https://core.telegram.org/bots/api#message)
- [getFile](https://core.telegram.org/bots/api#getfile)
- [File](https://core.telegram.org/bots/api#file)

## 2. 本次已实现内容

### 2.1 Telegram provider 已支持的入站媒体类型

当前 Telegram provider 已支持接收并解析以下入站媒体：

1. `photo`
2. `video`
3. `document`
4. `voice`
5. `audio`

支持范围包括：

1. webhook 接收
2. polling 接收
3. `caption` 解析为 `InboundMessage.Text`
4. 纯媒体消息接收
5. 调用 `getFile` 下载真实文件
6. 下载后持久化到本地临时目录
7. `media_group_id` 相册聚合后再送入 store / AI

### 2.2 关键实现位置

本次实现的核心代码位于：

- [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)
- [backend/internal/bots/telegram.go](../../../backend/internal/bots/telegram.go)
- [backend/internal/bots/telegram_inbound_media.go](../../../backend/internal/bots/telegram_inbound_media.go)
- [backend/internal/bots/wechat_attachment_protocol.go](../../../backend/internal/bots/wechat_attachment_protocol.go)
- [backend/internal/bots/message_media.go](../../../backend/internal/bots/message_media.go)

测试覆盖位于：

- [backend/internal/bots/telegram_test.go](../../../backend/internal/bots/telegram_test.go)
- [backend/internal/bots/wechat_attachment_protocol_test.go](../../../backend/internal/bots/wechat_attachment_protocol_test.go)

## 3. 当前行为说明

### 3.1 webhook / polling 的入站解析

Telegram webhook 与 polling 现在都会走 provider 内统一的入站解析流程。

当前行为：

1. 如果是 bot 自己发的消息，仍然忽略
2. 如果是纯文本消息，行为与之前一致
3. 如果是媒体消息，优先解析媒体对象
4. 如果有 `caption`，会把 `caption` 放入 `InboundMessage.Text`
5. 如果没有文本但有媒体，不再被判定为 ignored

### 3.2 media group 聚合

Telegram 的相册 / 组媒体消息会带 `media_group_id`，但 webhook 通常仍然是按单条消息推送。当前实现已经在 `Service` 层补了聚合逻辑：

1. 仅对 Telegram 且带 `media_group_id` 的媒体消息生效
2. 以 `connection + conversation + media_group_id` 作为聚合键
3. 在一个短静默窗口内持续收集同组消息
4. 默认静默窗口为 3 秒，用来覆盖多数 webhook 乱序和文件下载延迟
4. 窗口结束后，把整组媒体合并成一条逻辑 `InboundMessage`
5. 最终只创建一个 `BotInboundDelivery`，只触发一次 AI 处理

聚合后的行为：

1. `MessageID` 会改写为形如 `telegram-media-group:<media_group_id>:<count>:<hash>` 的稳定合成消息 ID
2. `Media` 会按消息 ID 顺序合并
3. 文本会保留首个 caption；如果同组里出现多个不同文本，会按段落追加
4. 组内原始 Telegram 消息 ID 会记录到 provider data，便于排查和调试
5. 如果某个新 item 晚于首批聚合窗口到达，不会再因为复用同一个 synthetic message ID 而被静默去重吞掉，而是会作为 follow-up batch 继续处理

### 3.3 文件下载与本地落盘

对于可下载的 Telegram 媒体，当前实现会：

1. 从消息里取 `file_id`
2. 调用 `getFile`
3. 取回 `file_path`
4. 从 Telegram 文件下载地址读取文件内容
5. 落盘到系统临时目录下的 Telegram 专用目录

当前临时目录结构：

`%TEMP%/codex-server/telegram/media/inbound`

持久化后写入 `store.BotMessageMedia` 的字段包括：

1. `Kind`
2. `Path`
3. `FileName`
4. `ContentType`

### 3.4 provider data

当前 Telegram 入站媒体还会把部分元信息放入 `InboundMessage.ProviderData`：

1. `telegram_media_kind`
2. `telegram_media_file_id`
3. `telegram_media_group_id`，如果消息携带 `media_group_id`
4. `telegram_media_group_message_ids`，如果消息在聚合后形成一组逻辑消息
5. `telegram_media_group_late_batch`，如果这批消息是某个已 flush 相册的晚到 follow-up batch

说明：

1. 单条媒体消息会保留 `telegram_media_kind` / `telegram_media_file_id`
2. 聚合后的相册消息不会再保留单 item 级别的 `telegram_media_kind` / `telegram_media_file_id`
3. 聚合后的逻辑消息会改为记录 `telegram_media_group_id` 和 `telegram_media_group_message_ids`
4. 如果相册发生晚到拆批，follow-up batch 会额外记录 `telegram_media_group_late_batch=true`

## 4. AI 输入链的当前处理

当前项目默认 `workspace_thread` backend 仍然只把 `inbound.Text` 发给 turn executor，不会直接把二进制附件交给模型。

因此本次实现同时补了 AI 输入准备逻辑：

1. 对非 WeChat provider，如果入站消息带媒体
2. 会把媒体摘要追加到发给 AI 的文本里
3. 如果原消息没有文本，则直接用媒体摘要作为 AI 输入文本

这样做的目的不是把 Telegram 变成真正的“多模态模型输入”，而是保证：

1. AI 至少知道用户发来了什么类型的附件
2. AI 能看到文件名、内容类型、本地临时路径等摘要信息
3. 纯媒体消息不会因为 `Text == ""` 而让 AI 收到空输入

## 5. 本次顺手修正的摘要问题

在本次实现前，通用媒体摘要文本会写成：

`[WeChat ... attachment]`

这对 Telegram 是错误的，因为 Telegram 入站媒体一旦复用这套摘要，就会在 AI 文本和会话摘要里显示成 WeChat 附件。

本次已把通用摘要改成 provider-neutral 形式，例如：

- `[Image attachment]`
- `[Video attachment]`
- `[File attachment]`
- `[Voice attachment]`
- `[Audio attachment]`

WeChat 专属的发送 fallback 文案 `[WeChat attachment delivery fallback]` 没有改动。

## 6. 当前已知限制

本次实现是第一阶段，不是最终完整版。当前仍有这些限制：

### 6.1 media group 聚合依赖静默窗口

当前已经支持 Telegram `media_group_id` 聚合，但 Telegram webhook / polling 并不会显式告诉服务“这一组已经结束”。因此当前实现采用的是一个短静默窗口策略：

1. 如果一段很短时间内没有新的同组消息到达，就认为该组结束并执行聚合
2. 这可以覆盖绝大多数正常相册发送场景
3. 但如果某个组内消息异常延迟到静默窗口之后才到达，它仍然可能被拆成新的逻辑批次
4. 当前实现已经修复了“晚到 item 被既有 synthetic message ID 静默压掉”的问题，晚到 item 现在会作为 follow-up batch 继续处理，并在日志与 provider data 中留下标记

这不是当前项目独有的问题，而是 Telegram `media_group_id` 在 webhook / polling 场景里的常见工程权衡。当前默认实现优先保证：

1. 普通相册能合并成一次 AI 处理
2. 相同 album item 不会因为重复 webhook 被重复拼进去
3. 晚到的新 item 不会被静默吞掉
4. 系统不会再把同一个 Telegram 重试 item 重复当成新的 AI 会话

### 6.2 还没有支持更多 Telegram 特殊媒体类型

本次未做：

1. `animation`
2. `video_note`
3. `sticker`
4. `contact`
5. `location`
6. `poll`

这些类型目前仍会按现有规则被忽略，除非它们同时带有可用文本。

### 6.3 还没有把 `file_id` 显式建模到 media item

当前 `file_id` 被放在消息级 `ProviderData` 里，而不是 `BotMessageMedia` 自身字段。

这意味着：

1. 当前足够用于单消息单媒体场景
2. 但如果未来要做更复杂的多媒体组、延迟下载、重复文件复用，最好把 provider-specific media metadata 下沉到 media item 级别

### 6.4 还不是“真正多模态输入”

当前 AI 看到的是媒体摘要文本，不是附件内容本身。

因此：

1. 模型能知道“用户发了一张图 / 一个 PDF / 一个语音”
2. 但不能直接理解图片像素内容或音频内容
3. 如果要做真正的多模态推理，还需要后续把媒体内容接到支持多模态的 backend

## 7. 测试覆盖

本次新增或扩展的回归测试覆盖了这些重点：

1. webhook 入站图片、视频、文件、语音、音频解析
2. `caption` 到 `InboundMessage.Text` 的映射
3. 纯媒体消息不再被忽略
4. `getFile` 下载路径与本地落盘
5. Telegram `media_group_id` 在 webhook 路径聚合后只触发一次 AI 处理
6. Telegram `media_group_id` 在 polling 路径聚合后只触发一次 AI 处理
7. polling 模式下聚合后仍能推进 offset
8. 非 WeChat provider 的媒体摘要能进入 AI 输入文本

## 8. 建议的下一步

如果继续往下做，建议顺序如下：

1. 给 `BotMessageMedia` 增加 provider-specific item metadata
2. 评估是否需要把静默窗口做成可配置项
3. 决定是否对 `animation` / `video_note` 做第一类支持
4. 如果有明确业务需求，再把 Telegram inbound media 接入真正的多模态 backend

## 9. 最终结论

截至本次实现，Telegram 在当前项目中的入站多媒体能力已经从“只支持纯文本”升级为：

1. 可以接收主流媒体消息
2. 可以下载真实文件并落盘
3. 可以把媒体摘要传入当前 AI 输入链
4. 纯媒体消息不再被静默忽略
5. Telegram 相册现在会聚合成一次逻辑入站消息，而不是逐条触发 AI

但它仍然不是完整终态，尤其在以下方面还有继续演进空间：

1. item 级 file_id 元数据
2. 更完整的 Telegram 媒体类型支持
3. 更可配置的 media group 聚合策略
4. 真正的多模态模型接入
