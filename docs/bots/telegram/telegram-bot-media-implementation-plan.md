# Telegram Bot 多媒体支持分析与实施方案

## 0. 范围与结论

本文档面向当前项目 `E:\projects\ai\codex-server`，整理 Telegram Bot 多媒体能力的官方结论、当前仓库实现现状、与 WeChat bot 的可复用边界，以及推荐的实施方案。

本文档回答三个具体问题：

1. Telegram 官方是否支持 bot 多媒体发送
2. 当前项目为什么仍然把 Telegram outbound media 视为不支持
3. WeChat bot 现有多媒体实现中，哪些可以借鉴，哪些不能直接照搬

结论先行：

1. Telegram 官方 Bot API 明确支持多媒体发送，这不是平台限制。
2. 当前项目里 Telegram outbound media 不支持，是当前 provider 实现尚未补齐，不是 Telegram 能力缺失。
3. WeChat bot 的多媒体实现可以借鉴“媒体抽象、校验、解析、降级、测试方法”，但其上传协议与消息结构是微信私有实现，不能直接复用到 Telegram。

本文档中的 Telegram 官方能力已于 `2026-04-08` 复核，参考官方文档：

- [Telegram Bot API 总参考页](https://core.telegram.org/bots/api)
- [sendPhoto](https://core.telegram.org/bots/api#sendphoto)
- [sendVideo](https://core.telegram.org/bots/api#sendvideo)
- [sendAudio](https://core.telegram.org/bots/api#sendaudio)
- [sendDocument](https://core.telegram.org/bots/api#senddocument)
- [sendVoice](https://core.telegram.org/bots/api#sendvoice)
- [sendMediaGroup](https://core.telegram.org/bots/api#sendmediagroup)
- [Using a Local Bot API Server](https://core.telegram.org/bots/api#using-a-local-bot-api-server)

## 1. Telegram 官方能力核对

### 1.1 官方已支持的发送能力

Telegram Bot API 官方文档明确提供以下方法：

1. `sendPhoto`
2. `sendVideo`
3. `sendAudio`
4. `sendDocument`
5. `sendVoice`
6. `sendMediaGroup`

这意味着 Telegram bot 官方至少支持：

- 图片发送
- 视频发送
- 音频发送
- 文件发送
- 语音发送
- 相册/媒体组发送

因此，“Telegram 不支持 outbound media”这个说法，如果不加上下文，就是不准确的。更准确的表达应是：

> 当前项目的 Telegram provider 还没有实现 outbound media。

### 1.2 Telegram 对文件来源的官方支持方式

从官方 Bot API 文档看，Telegram 发送媒体时通常支持三种来源：

1. `file_id`
   - 复用 Telegram 服务器上已存在的文件
2. HTTP URL
   - 由 Telegram 服务器自行拉取
3. `multipart/form-data`
   - 由当前服务端直接上传新文件

这三种来源模型对当前项目的意义如下：

1. `media.URL`
   - 可以直接映射到 Telegram 支持的远程 URL 发送
2. `media.Path`
   - 不能像当前 WeChat 一样走自定义上传协议
   - 需要单独实现 Telegram 的 `multipart/form-data`
3. `file_id`
   - 当前项目的 `store.BotMessageMedia` 里没有显式字段承载
   - 第一阶段可以不做，后续若要优化重复上传成本，再增加 provider-specific metadata

### 1.3 Telegram topic/thread 与多媒体发送并不冲突

当前项目的 Telegram conversation 已经使用 `ExternalThreadID` 保存 Telegram topic thread id。官方发送接口支持 `message_thread_id`，因此：

- 文本消息可以继续使用现有 topic 逻辑
- 媒体消息也可以在 topic 内发送
- 这不是 Telegram media 落地的阻塞点

### 1.4 Local Bot API Server 不是前置条件

Telegram 官方还支持自建 Local Bot API Server，这会带来更大的上传上限和本地路径等扩展能力。但对当前项目而言：

- 支持 Telegram outbound media 不依赖本地 Bot API Server
- 走官方云端 API 就能完成第一版多媒体发送
- 只是本地绝对路径在默认云端模式下不能直接作为请求参数，需要由当前服务端以 `multipart/form-data` 上传

结论是：

> Telegram media 能力可以直接按当前线上默认模式实现，不需要先引入 Local Bot API Server。

## 2. 当前仓库实现现状

### 2.1 现有 Telegram provider 仍然是文本发送模型

当前 Telegram provider 的关键代码位于：

- [backend/internal/bots/telegram.go](../../../backend/internal/bots/telegram.go)
- [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)
- [backend/internal/bots/telegram_test.go](../../../backend/internal/bots/telegram_test.go)

当前发送实现的关键事实：

1. [telegram.go](../../../backend/internal/bots/telegram.go) 的 `SendMessages()` 只会把消息整理为文本分块，再调用 `sendMessage`
2. 当前 provider 没有 `sendPhoto`、`sendVideo`、`sendDocument` 等实现
3. 当前公共 HTTP 调用辅助也只覆盖 JSON 请求路径，没有 Telegram multipart 上传实现

也就是说，当前 Telegram provider 的真实能力模型仍然是：

- 入站：文本
- 出站：文本
- 流式 reply：文本编辑/替换

### 2.2 现在的“不支持”是主动硬拦，不是偶发失败

你这次刚修掉的问题，本质上是把 Telegram media 从“假成功”收敛成了“明确失败”。这部分实现已经形成三层防线：

1. proactive outbound 入口在 [service.go](../../../backend/internal/bots/service.go) 里做 provider 级校验
2. Telegram provider 的 `SendMessages()` 内部再次校验
3. Telegram streaming reconcile 路径再次校验

当前关键校验点：

- [service.go](../../../backend/internal/bots/service.go) 的 `validateOutboundMessagesForProvider()`
- [telegram.go](../../../backend/internal/bots/telegram.go) 的 `validateTelegramOutboundMessages()`
- [telegram.go](../../../backend/internal/bots/telegram.go) 的 streaming `reconcile()` 也复用同一校验

当前行为是正确的，因为它至少保证了：

1. 现在不会再把带 media 的 Telegram outbound delivery 误记成成功
2. 任意调用链绕过 proactive outbound 入口，也仍会在 provider 层失败
3. 流式 reply 也不会把媒体消息误判为 delivered

### 2.3 当前 Telegram inbound 也基本是文本优先

当前 Telegram 入站解析位于：

- [backend/internal/bots/telegram.go](../../../backend/internal/bots/telegram.go)

目前 `inboundMessageFromTelegramUpdate()` 的行为是：

1. 只处理 `Update.message`
2. 只提取 `message.text`
3. 如果没有文本，则直接忽略
4. 不会把 `photo`、`video`、`document`、`voice` 等消息映射到 `InboundMessage.Media`

因此后续如果只补 outbound，而不补 inbound，系统会处于一种“半支持”状态：

- bot 能向 Telegram 发媒体
- 但用户给 bot 发媒体时，bot 依然无法理解

这不是第一阶段必须一起做的事情，但需要在方案里明确记录。

### 2.4 当前 delivery target 能力标签还不够细

当前 [service.go](../../../backend/internal/bots/service.go) 的 `deliveryTargetCapabilitiesForConnection()` 只区分：

- `supportsProactivePush`
- `supportsSessionlessPush`
- `requiresRouteState`

这里还没有暴露类似：

- `supportsTextOutbound`
- `supportsMediaOutbound`
- `supportsMultipartUpload`
- `supportsMediaGroup`

所以现在前端或上层管理接口并不能明确看出“Telegram 只支持文本”还是“Telegram 支持媒体但当前连接不支持某种发送方式”。

## 3. WeChat 已实现多媒体能力的现状

当前 WeChat 相关核心文件位于：

- [backend/internal/bots/wechat.go](../../../backend/internal/bots/wechat.go)
- [backend/internal/bots/wechat_media.go](../../../backend/internal/bots/wechat_media.go)
- [backend/internal/bots/wechat_outbound_media_resolver.go](../../../backend/internal/bots/wechat_outbound_media_resolver.go)
- [backend/internal/bots/wechat_attachment_protocol.go](../../../backend/internal/bots/wechat_attachment_protocol.go)
- [backend/internal/bots/wechat_test.go](../../../backend/internal/bots/wechat_test.go)

WeChat 已实现的关键能力不是单点能力，而是一整条多媒体链路：

1. `OutboundMessage.Media` 已被真正用于 WeChat outbound
2. 支持从 AI 回复文本里解析 `wechat-attachments` 指令块
3. 支持本地绝对路径与远程 URL 两种媒体来源
4. 支持从 HTML 页面或结构化文档里继续解析真实媒体链接
5. 支持必要时对远程视频做转码
6. 支持上传到微信侧媒体通道
7. 支持上传失败时回退成文本说明，而不是静默吞掉
8. 测试已覆盖远程视频、播放页抽取、播放列表转码、fallback、quoted file、voice 入站转码等场景

这说明当前项目中，bot 多媒体并不是一个理论需求，而是已经有一套成熟的实现范式，只是 Telegram 还没接入。

## 4. 哪些可以借鉴，哪些不能直接照搬

### 4.1 可以直接借鉴的部分

WeChat 这边可复用的不是协议，而是工程方法。

#### 4.1.1 统一消息抽象

当前项目已经有统一抽象：

- `OutboundMessage.Text`
- `OutboundMessage.Media`
- `store.BotMessageMedia`

这意味着 Telegram 不需要重新定义一套新消息模型，可以直接沿用现有结构。

#### 4.1.2 provider 前的统一标准化与校验

当前系统已经有以下可用结构：

1. service 层先做 provider 级校验
2. provider 层再做最终校验
3. streaming reply 单独再防一次

这套分层在 Telegram media 上线后也应保留，只是把“全部拒绝”改成“按媒体类型校验并允许支持的类型”。

#### 4.1.3 媒体解析与清理模型

WeChat 里已经形成了比较好的流程：

1. 解析 `media.URL` 或 `media.Path`
2. 解析完成后返回统一的文件路径、文件名、内容类型
3. 对临时文件提供清理函数

Telegram 非常适合沿用这个模式，只是最后一步不再上传到 WeChat CDN，而是改为 Telegram multipart/form-data。

#### 4.1.4 失败降级与测试覆盖思路

WeChat 当前的经验里最值得继承的是两个原则：

1. 不要静默假成功
2. 不要把“部分发送成功”的状态伪装成完整成功

Telegram 这边第一版即使不做所有花哨能力，也要保持这两个原则。

### 4.2 不能直接复用的部分

#### 4.2.1 WeChat 上传协议完全是私有实现

以下逻辑是微信专有的，Telegram 无法复用：

1. `getuploadurl`
2. CDN `upload` 返回 `x-encrypted-param`
3. AES-128-ECB 加密上传
4. WeChat `item_list` 消息结构
5. `context_token` 驱动的发送协议

Telegram 的发送模型是标准 Bot API HTTP 接口，不存在这些概念。

#### 4.2.2 WeChat 的“先发文本再发媒体”不宜原样迁移

WeChat 当前发送策略中，一个常见模式是：

1. 先发文本
2. 再逐个发媒体 item

Telegram 如果照搬这套策略，会引入新的不一致问题：

1. 文本已经发出，但媒体发送失败
2. 用户看到的不是完整消息，而是一半结果
3. caption 与媒体的关系被拆散

Telegram 更合理的策略应是：

1. 单个媒体时，优先把文本作为 `caption`
2. 多图/多视频时，优先考虑 `sendMediaGroup`
3. 混合类型时，再按明确规则拆分发送

#### 4.2.3 WeChat 的附件协议不应直接复制成 Telegram 特化版本

当前 WeChat 使用：

- `wechat-attachments`

如果 Telegram 也做同类能力，不建议立刻再加一套：

- `telegram-attachments`

更合理的方向是把这层协议抽象成 provider-generic 的 attachment block，再由 provider 决定哪些媒体真正可发送。

## 5. 推荐目标状态

### 5.1 第一阶段目标

第一阶段建议只解决一个明确问题：

> 让 Telegram bot 可以稳定发送单媒体和基础多媒体消息，不再把 media 一律判为不支持。

建议第一阶段支持：

1. 单图片
2. 单视频
3. 单文件
4. 单语音
5. 文本加单媒体
6. topic/thread 内发送媒体
7. 绝对路径文件上传
8. 可直接访问的 HTTP URL 媒体发送

第一阶段不强求：

1. `file_id` 复用
2. 智能抓取 HTML 页面里的真实媒体
3. 全量 inbound media 解析
4. 所有 Telegram 媒体类型一次到位
5. 所有媒体组合的自动分组优化

### 5.2 对消息语义的推荐规则

为了避免歧义，建议统一定义 Telegram outbound message 语义：

#### 场景 A：只有文本

- 继续走当前 `sendMessage`

#### 场景 B：文本 + 1 个媒体

- 根据媒体类型走对应 `sendPhoto` / `sendVideo` / `sendDocument` / `sendVoice`
- 文本优先作为 `caption`

#### 场景 C：无文本 + 1 个媒体

- 直接发送媒体

#### 场景 D：文本 + 多个图片/视频

- 第一阶段可以先顺序发送
- 第二阶段再优化成 `sendMediaGroup`

如果追求更快落地，第一阶段不必强行上 `sendMediaGroup`。先保证单媒体与顺序多媒体稳定，再做组发送优化，风险更低。

#### 场景 E：混合类型多媒体

- 第一阶段按顺序逐条发送
- 不自动做复杂合并

这样可以显著降低第一版复杂度。

### 5.3 对远程 URL 的推荐边界

Telegram 官方允许把 HTTP URL 作为媒体来源，但这并不意味着任何 URL 都可直接发送。

建议第一阶段只支持：

1. 直接指向媒体文件的 URL
2. Telegram 官方可直接拉取的稳定 URL

建议第一阶段不自动支持：

1. 指向 HTML 页面而不是媒体文件本身的 URL
2. 需要解析 Open Graph 或页面内嵌播放器才能找到真实媒体的 URL
3. 需要转码后才能上传的远程流媒体地址

这部分如果一开始就做，会把 Telegram provider 的第一版实现复杂度迅速抬高。更合理的做法是：

- 第一版先做“直接媒体 URL + 本地绝对路径”
- 第二版如有真实业务需求，再把 WeChat 的远程媒体解析能力抽成 provider-generic 组件复用

## 6. 推荐实施方案

### 6.1 总体策略

建议把 Telegram media 上线拆成三个阶段：

1. Phase 1：补 Telegram outbound media MVP
2. Phase 2：把 AI 输出附件协议抽象成 provider-generic
3. Phase 3：补 Telegram inbound media

这样能避免一次性改太多路径。

### 6.2 Phase 1：Telegram outbound media MVP

#### 6.2.1 新增 Telegram 媒体发送能力

建议在 Telegram provider 中新增以下能力：

1. `sendPhotoMessage`
2. `sendVideoMessage`
3. `sendDocumentMessage`
4. `sendVoiceMessage`
5. `sendMultipart` 或类似 HTTP helper

推荐位置：

- 保持在 [backend/internal/bots/telegram.go](../../../backend/internal/bots/telegram.go)
- 或者拆出新文件 `backend/internal/bots/telegram_media.go`

如果考虑可维护性，更推荐拆出 `telegram_media.go`，避免继续让 `telegram.go` 变成超大文件。

#### 6.2.2 复用统一媒体解析接口

建议参考 WeChat 的处理方式，引入 Telegram 版本的解析流程：

1. 对 `media.Path`：
   - 必须是绝对路径
   - 校验文件存在且不是目录
   - 推断 `Content-Type`
2. 对 `media.URL`：
   - 第一阶段直接把 URL 交给 Telegram API
   - 不在服务端主动下载
3. 对不合法输入：
   - 明确返回 `ErrInvalidInput`

这里可以考虑抽出 provider-generic helper，而不是再复制一套类似 `resolveOutboundMediaFile()` 的逻辑。

#### 6.2.3 补 multipart/form-data 请求能力

当前 Telegram provider 的 `callJSON()` 只支持 JSON 请求，这不足以发送本地文件。

因此需要补一个 multipart 路径，例如：

1. `callMultipart()`
2. `newMultipartTelegramRequest()`
3. 一个统一的 `sendTelegramMedia()` helper

这个 helper 应负责：

1. 设置 `chat_id`
2. 设置可选 `message_thread_id`
3. 设置可选 `caption`
4. 附加文件字段
5. 解析 Telegram API 返回

#### 6.2.4 修改当前硬拒绝逻辑

当前 `validateTelegramOutboundMessages()` 是“只要有 media 就拒绝”。

Phase 1 后它应改成：

1. 校验是否包含至少一种当前支持的媒体类型
2. 校验每个媒体项是否具备合法来源
3. 校验文本与媒体组合是否满足当前发送策略
4. 对暂不支持的组合明确报错

也就是说，校验函数应该从“全部拒绝”升级成“声明式约束检查”。

#### 6.2.5 保留 thread/topic 支持

无论走 `sendMessage` 还是发送媒体，都应继续保留：

- `message_thread_id`

这部分当前已有良好基础，不需要推翻，只需要让媒体发送路径也复用。

### 6.3 Phase 2：抽象 provider-generic 附件协议

当前 WeChat 已有：

- [backend/internal/bots/wechat_attachment_protocol.go](../../../backend/internal/bots/wechat_attachment_protocol.go)

这层逻辑的价值其实不局限于 WeChat。更合理的未来方向是：

1. 抽出 provider-generic attachment block 语法
2. provider 再决定允许哪些媒体类型与来源
3. 不再让 AI 看到仅针对单 provider 的提示词

建议未来抽象方向：

1. 新增通用注释，例如 `attachments`
2. 通用解析到 `[]store.BotMessageMedia`
3. WeChat 与 Telegram 分别做 provider-specific validation

但这不应阻塞 Telegram media MVP。如果当前需求只是“先能发媒体”，可以先不动 AI 附件协议。

### 6.4 Phase 3：补 Telegram inbound media

当前 Telegram inbound 基本只识别文本。Phase 3 建议补：

1. 图片入站解析
2. 文档入站解析
3. 视频入站解析
4. 语音入站解析

第一阶段可以只提取 metadata：

- kind
- file_id
- file_name
- mime_type

第二阶段再决定是否需要真正下载文件到本地。

这是因为 Telegram inbound 与 WeChat inbound 不完全一样：

- WeChat 现有实现更偏向“把附件下载到本地，再挂入 `media.Path`”
- Telegram 很适合先走 metadata-only 路线，因为 Telegram 原生就有 `file_id`

## 7. 与 WeChat 的复用建议

### 7.1 建议复用的部分

建议直接参考或抽取的能力：

1. 媒体消息统一抽象
2. provider 前的标准化与校验
3. 路径/URL 解析后返回统一结果
4. 临时资源 cleanup 模式
5. 回归测试设计方法
6. 失败时明确报错，而不是吞错

### 7.2 不建议复用的部分

不建议照搬的能力：

1. WeChat 的上传协议
2. WeChat 的 AES/CDN 逻辑
3. WeChat 的 `context_token` 发送模型
4. WeChat 的 `item_list` 载荷结构
5. WeChat 的“先发文本后发媒体”顺序策略

### 7.3 是否要复用 WeChat 的远程页面媒体解析

结论是：

1. 从工程价值上看，可以借鉴
2. 从 Phase 1 风险控制看，不建议一开始就带上

原因：

1. Telegram 官方直接支持 URL，本地上传实现才是第一优先级
2. HTML 页抽取、播放页解析、转码本身复杂度很高
3. 一开始就支持“故事页/嵌入页/播放器页自动抽媒体”，会明显扩大失败面

建议顺序：

1. 先支持“直接 URL + 本地绝对路径”
2. 再视真实业务需求决定是否引入智能解析

## 8. 建议修改的代码点

### 8.1 后端核心

必改文件：

1. [backend/internal/bots/telegram.go](../../../backend/internal/bots/telegram.go)
2. [backend/internal/bots/service.go](../../../backend/internal/bots/service.go)
3. [backend/internal/bots/telegram_test.go](../../../backend/internal/bots/telegram_test.go)

推荐新增文件：

1. [backend/internal/bots/telegram_media.go](../../../backend/internal/bots/telegram_media.go)
2. [backend/internal/bots/telegram_media_test.go](../../../backend/internal/bots/telegram_media_test.go)

如果希望提取通用能力，可考虑新增：

1. [backend/internal/bots/message_media.go](../../../backend/internal/bots/message_media.go) 扩展通用 helper
2. `backend/internal/bots/attachment_protocol.go`

### 8.2 service 层

建议修改：

1. `validateOutboundMessagesForProvider()`
   - 不再对 Telegram media 一律拒绝
   - 改为调用升级后的 Telegram media validator
2. `deliveryTargetCapabilitiesForConnection()`
   - 补更细能力标签

推荐新增能力标签：

- `supportsTextOutbound`
- `supportsMediaOutbound`
- `supportsMediaUpload`
- `supportsMediaURL`

如果后续要给前端直接提示“Telegram 当前仅支持文本发送”或“此连接已支持图片/文件发送”，这些标签会很有用。

### 8.3 前端与 API

如果只做 provider 能力落地，前端不一定必须立刻改。但如果想让用户体验闭环，建议补两层：

1. 管理接口返回更明确的媒体支持能力
2. 前端在发送时做预校验与提示

如果你还要继续做“更明确的 API 响应文案”，建议直接把错误规范成类似：

- `telegram_outbound_media_not_supported`
- `telegram_outbound_media_type_not_supported`
- `telegram_outbound_media_source_invalid`

这样前端可以直接提示：

> Telegram 当前仅支持文本发送

或者：

> Telegram 当前只支持图片、视频、文件和语音发送

## 9. 测试方案

### 9.1 provider 单元测试

至少应补以下测试：

1. `sendPhoto` 带 caption 成功
2. `sendVideo` 带 caption 成功
3. `sendDocument` 成功
4. `sendVoice` 成功
5. 本地绝对路径走 multipart 上传
6. 远程 URL 直传成功
7. topic/thread 时 `message_thread_id` 被保留
8. 不支持的媒体类型明确失败
9. 非法路径明确失败
10. 相对路径明确失败

### 9.2 service 层回归测试

建议补以下场景：

1. proactive outbound 发送 Telegram 图片成功
2. proactive outbound 发送 Telegram 文件成功
3. mixed media 走既定策略
4. provider 返回错误时 delivery 标记为失败而不是 delivered
5. streaming reply 最终消息带媒体时按新规则成功或明确失败

### 9.3 不回归现有语义的测试

必须确保以下行为不被破坏：

1. 当前纯文本 Telegram reply 仍正常
2. topic/thread 文本消息仍正常
3. polling/webhook 不受影响
4. 已有 outbound idempotency 逻辑不变
5. 已修复的“静默假成功”不会重新出现

## 10. 风险与边界

### 10.1 部分发送成功

这是 Telegram media 接入时最大的语义风险之一。

例如：

1. 文本先发成功
2. 图片后发失败

用户看到的是半条消息，但系统可能错误地认为整体成功。

建议第一阶段尽量避免这种模型：

1. 单媒体时优先“媒体 + caption”一次发送
2. 多媒体顺序发送时，delivery 状态必须按真实结果记录

### 10.2 URL 可达性并不等于 Telegram 可拉取

即使当前服务端能访问某个 URL，也不意味着 Telegram 服务器能访问。典型风险包括：

1. 内网地址
2. 临时签名 URL 很快失效
3. 目标站点拦截 Telegram 拉取

所以对于 `media.URL`，建议：

1. 文档中明确要求提供公开可访问直链
2. 对失败场景保留清晰错误信息

### 10.3 文件大小与类型限制

Telegram 对不同媒体类型有不同限制，而且这些限制未来可能变化。第一阶段建议：

1. 先依赖 Telegram API 返回错误
2. 不在项目内硬编码过多平台限制
3. 如需本地预校验，再单独做配置化限制

### 10.4 streaming reply 的复杂度

流式文本和媒体的组合并不天然优雅。因为流式过程中通常只适合持续更新文本，而媒体更适合作为最终完成态消息。

因此建议：

1. 流式中间态继续只发送文本
2. 最终 `Complete()` 时允许带媒体
3. 如果最终回复包含媒体，按最终消息规则发出

## 11. 推荐落地顺序

推荐按以下顺序推进：

1. 保持当前 Telegram media 硬失败策略不动，先避免回归
2. 新增 Telegram 本地文件 multipart 上传能力
3. 先支持单图片、单视频、单文件、单语音
4. 让文本 + 单媒体走 caption
5. 补 provider 与 service 层测试
6. 再决定是否做多媒体组发送
7. 再决定是否引入 provider-generic attachment protocol
8. 最后再补 Telegram inbound media

这个顺序的优点是：

1. 最短路径解决真实功能缺口
2. 不会一开始就把 Telegram provider 做成第二个 WeChat provider 那样复杂
3. 便于把风险限定在 outbound 一条链路

## 12. 最终建议

基于当前代码与官方文档，推荐的明确结论如下：

1. Telegram outbound media 应该做，而且技术上没有平台阻塞。
2. 不应再把“当前实现不支持”表述成“Telegram 平台不支持”。
3. WeChat 的实现值得借鉴，但应借鉴架构与流程，不应直接迁移上传协议代码。
4. 第一阶段优先做 Telegram outbound media MVP，不建议一开始就上远程页面解析、转码、通用附件协议和 inbound media。
5. 现有三层防绕过校验要保留，只需把拒绝逻辑升级成能力校验。

最重要的一句话是：

> Telegram 多媒体能力的核心工作，不是“证明 Telegram 支持媒体”，而是把当前项目现有的通用媒体抽象真正接到 Telegram Bot API 上。

