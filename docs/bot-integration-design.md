# Bot Integration Module

## Goal

Provide a backend module that can:

- receive inbound messages from bot platforms such as Telegram
- map external conversations to internal workspace threads
- forward inbound text to an AI backend
- send the AI reply back to the bot platform
- keep the platform layer and AI execution layer decoupled so future providers can be added without rewriting the core flow

## Current Architecture

The implementation is split into two abstraction layers:

1. `Provider`
   - owns platform-specific concerns
   - validates credentials
   - provisions and removes webhooks
   - parses inbound webhook payloads
   - sends outbound messages
   - may optionally expose a streaming reply session that reconciles bot-visible message segments in place

2. `AIBackend`
   - owns how inbound text is executed against an AI system
   - current default is `workspace_thread`
   - this backend reuses the existing `thread -> turn` runtime in the current project
   - may optionally expose a streaming execution path that emits bot-visible message segments before the turn completes

The `bots.Service` orchestrates both layers:

`provider webhook -> bot conversation lookup/create -> AI backend -> provider sendMessage`

When both sides support streaming, the orchestration becomes:

`provider webhook -> bot conversation lookup/create -> AI backend stream -> provider edit/send -> final completed turn -> provider finalize reply`

Inbound delivery is now persisted before bot work is handed to the async worker path.

- webhook and polling intake create a durable inbound delivery record first
- the worker claims that record before processing
- successful replies mark the delivery as completed
- failed replies keep the delivery recoverable unless a user-visible failure reply has already been delivered
- pending deliveries are recovered on service start and on connection resume
- per-conversation workers are reclaimed after an idle timeout so inactive chats do not hold goroutines indefinitely

## Persistent Models

Two new persisted entities were added to the store:

- `BotConnection`
  - workspace-scoped bot integration config
  - stores provider name, AI backend, provider settings, secret fields, status, and last error
  - settings also carry reply-formatting preferences such as runtime mode and command output mode

- `BotConversation`
  - provider conversation to internal thread mapping
  - stores external chat/user metadata
  - tracks last inbound/outbound message
  - stores the bound internal `threadId`

## Current Telegram Support

The first concrete provider is `telegram`.

Supported operations:

- `getMe` validation during connection create/resume
- `setWebhook` on webhook activation
- `deleteWebhook` on pause/delete
- `deleteWebhook` before entering polling mode so `getUpdates` can be used safely
- `getUpdates` long polling for inbound message intake without a public callback URL
- webhook verification using `X-Telegram-Bot-Api-Secret-Token`
- inbound text message parsing
- outbound `sendMessage`

Telegram now supports two delivery modes:

1. `webhook`
   - Codex Server registers `POST /hooks/bots/{connectionId}` with Telegram
   - requires a public HTTPS base URL that Telegram can reach
   - public base URL comes from request field `publicBaseUrl` or backend env `CODEX_SERVER_PUBLIC_BASE_URL`

2. `polling`
   - Codex Server keeps a background worker per active connection and calls `getUpdates`
   - does not require a public callback URL
   - persists `telegram_update_offset` in provider settings to resume polling after restart

The public webhook path for webhook mode is:

- `POST /hooks/bots/{connectionId}`

The public base URL used by webhook mode can come from:

- request field `publicBaseUrl`
- or backend env `CODEX_SERVER_PUBLIC_BASE_URL`

Provider-specific Telegram settings now include:

- `telegram_delivery_mode`
  - `webhook` or `polling`
- `telegram_update_offset`
  - internal cursor used only in polling mode
- `webhook_url`
  - resolved callback URL used only in webhook mode

Connection-level reply formatting settings now include:

- `command_output_mode`
  - controls how command execution output is exposed inside bot replies
  - supported values are `single_line`, `brief`, `detailed`, and `full`
  - default is `brief`
  - currently used by text transcript rendering for Telegram and WeChat bot replies

### Why Polling Does Not Need A Public URL

The difference is transport direction:

- webhook mode is inbound HTTP from Telegram to this server, so Telegram needs a publicly reachable URL
- polling mode is outbound HTTP from this server to Telegram, so no callback URL is required

This is the same general reason some other integrations do not ask users for an external address:

- pure outbound API integrations only make requests to the external service
- long-polling integrations pull events from the external service
- outbound WebSocket integrations keep a client connection open to the external service

The current `openai_responses` AI backend in this project is an example of a pure outbound integration. It calls OpenAI directly and therefore does not need any public callback endpoint.

## API Surface

Workspace-scoped management routes:

- `GET /api/workspaces/{workspaceId}/bot-connections`
- `POST /api/workspaces/{workspaceId}/bot-connections`
- `GET /api/workspaces/{workspaceId}/bot-connections/{connectionId}`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/runtime-mode`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/command-output-mode`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/wechat-channel-timing`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/pause`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/resume`
- `DELETE /api/workspaces/{workspaceId}/bot-connections/{connectionId}`
- `GET /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations`
- `GET /api/workspaces/{workspaceId}/bot-conversations?connectionId=...`

Public inbound route:

- `POST /hooks/bots/{connectionId}`

Background inbound mode:

- active Telegram polling workers call `getUpdates` and feed accepted messages into the same bot orchestration flow used by webhooks

## Default AI Backend

`workspace_thread` is the current default AI backend.

Behavior:

- reuses existing thread and turn services
- creates a thread on first message if no binding exists
- persists the thread mapping back to `BotConversation`
- starts a turn in the existing Codex runtime
- when streaming is available, subscribes to workspace events and forwards bot-visible thread output snapshots to the provider
- still waits for the turn to complete before producing the authoritative final reply
- extracts bot-visible output items from the completed turn
- sends or finalizes those messages back through the provider

This keeps the existing Codex runtime usable while leaving space for a future direct AI provider implementation.

## Real-Time Reply Flow

The first streaming-capable path is:

- provider: `telegram`
- AI backend: `workspace_thread`

Flow:

1. Telegram inbound text creates or resolves a `BotConversation`
2. `workspace_thread` starts a Codex turn
3. The backend subscribes to workspace events for the active turn
4. Bot-visible output events such as `item/agentMessage/delta`, `item/plan/delta`, `item/commandExecution/outputDelta`, `item/completed`, and server-request lifecycle events are aggregated into ordered message segments
5. Telegram creates new segment messages with `sendMessage` only when the visible segment list grows
6. Existing segment messages are updated in place with `editMessageText`
7. When `turn/completed` arrives, the backend waits for a short settle window so late item updates and server-request resolutions can still land before finalization
8. The backend fetches the final completed turn after the settle window closes
9. Telegram edits the in-progress message to the first final chunk and sends any remaining chunks as additional messages

Important boundaries:

- the current bot-visible set includes assistant replies, plan text, command output, file changes, tool-call summaries, and server-request summaries
- command output inside bot-visible transcript summaries is filtered by `command_output_mode`; the default `brief` mode targets compact 3-5 line summaries, while `full` emits the complete aggregated command output
- server-request events are mirrored into Telegram as concise status lines rather than interactive approval controls
- the final completed turn remains the source of truth for persisted bot reply state
- if either the provider or AI backend does not support streaming, the service falls back to the existing final-only reply flow

## Telegram Streaming Semantics

Telegram does not receive a brand-new full reply for every token. Instead:

- streaming state is tracked as an ordered chunk list derived from the current bot-visible messages
- unchanged chunks are left untouched
- changed chunks are updated with `editMessageText`
- newly added chunks are appended with `sendMessage`
- extra trailing chunks are removed on finalization if the final reply becomes shorter than the preview
- streaming edits are throttled so the provider API is not called for every delta
- Telegram forum topics are routed by a conversation key derived from `chat.id + message_thread_id`, while outbound `sendMessage` keeps using the raw `chat_id` plus `message_thread_id`
- Telegram `sendMessage`, `editMessageText`, and `deleteMessage` use bounded in-provider retry/backoff for `429`, `5xx`, and transient transport failures, and honor Telegram `retry_after` when present

This avoids chat spam, reduces duplicate final replies, and gives users a smoother near-real-time sense of Codex progress.

## Extension Path

To add another platform:

1. implement `Provider`
2. register it in `bots.NewService`
3. add any provider-specific request validation in its own implementation

To add direct AI API execution later:

1. implement `AIBackend`
2. store an alternate `aiBackend` on `BotConnection`
3. keep the provider layer unchanged

## Current Limitations

- no multi-part rich content normalization yet; current flow is text-first
- polling offset is advanced after each accepted update, so unsupported Telegram updates are skipped intentionally instead of blocking the stream
- delivery-mode switching is still not exposed as an in-place API for an existing connection; changing webhook vs polling is still expected to happen by creating a new connection or updating provider settings before resume
- runtime mode, WeChat channel timing, and command output mode do support in-place updates through workspace-scoped management routes
- real-time reply streaming currently only covers `workspace_thread -> telegram`
- Telegram currently mirrors bot-visible items as plain-text transcript summaries; it does not provide interactive approval controls inside Telegram
- if the streaming preview exceeds Telegram's single-message edit window, only the leading chunk is edited in place until the final reply is sent
- Telegram outbound delivery now retries transient failures in-process, but it still has no durable outbound queue or cross-process resend mechanism
- active conversations still map 1:1 to in-memory workers; there is no shared worker pool or explicit global concurrency cap yet
