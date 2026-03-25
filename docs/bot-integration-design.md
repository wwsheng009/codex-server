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

2. `AIBackend`
   - owns how inbound text is executed against an AI system
   - current default is `workspace_thread`
   - this backend reuses the existing `thread -> turn` runtime in the current project

The `bots.Service` orchestrates both layers:

`provider webhook -> bot conversation lookup/create -> AI backend -> provider sendMessage`

## Persistent Models

Two new persisted entities were added to the store:

- `BotConnection`
  - workspace-scoped bot integration config
  - stores provider name, AI backend, provider settings, secret fields, status, and last error

- `BotConversation`
  - provider conversation to internal thread mapping
  - stores external chat/user metadata
  - tracks last inbound/outbound message
  - stores the bound internal `threadId`

## Current Telegram Support

The first concrete provider is `telegram`.

Supported operations:

- `getMe` validation during connection create/resume
- `setWebhook` on activation
- `deleteWebhook` on pause/delete
- webhook verification using `X-Telegram-Bot-Api-Secret-Token`
- inbound text message parsing
- outbound `sendMessage`

The public webhook path is:

- `POST /hooks/bots/{connectionId}`

The public base URL can come from:

- request field `publicBaseUrl`
- or backend env `CODEX_SERVER_PUBLIC_BASE_URL`

## API Surface

Workspace-scoped management routes:

- `GET /api/workspaces/{workspaceId}/bot-connections`
- `POST /api/workspaces/{workspaceId}/bot-connections`
- `GET /api/workspaces/{workspaceId}/bot-connections/{connectionId}`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/pause`
- `POST /api/workspaces/{workspaceId}/bot-connections/{connectionId}/resume`
- `DELETE /api/workspaces/{workspaceId}/bot-connections/{connectionId}`
- `GET /api/workspaces/{workspaceId}/bot-connections/{connectionId}/conversations`
- `GET /api/workspaces/{workspaceId}/bot-conversations?connectionId=...`

Public inbound route:

- `POST /hooks/bots/{connectionId}`

## Default AI Backend

`workspace_thread` is the current default AI backend.

Behavior:

- reuses existing thread and turn services
- creates a thread on first message if no binding exists
- persists the thread mapping back to `BotConversation`
- waits for the turn to complete
- extracts agent messages from the completed turn
- sends those messages back through the provider

This keeps the existing Codex runtime usable while leaving space for a future direct AI provider implementation.

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

- no frontend management UI yet
- no per-message persistence table beyond conversation-level latest state
- no retry policy for provider send failures
- duplicate webhook suppression is conversation-local and currently checks the latest inbound `messageId`
- no multi-part rich content normalization yet; current flow is text-first
