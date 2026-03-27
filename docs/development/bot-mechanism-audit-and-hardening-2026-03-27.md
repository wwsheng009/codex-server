# Bot Mechanism Audit And Hardening

Date: 2026-03-27

## Scope

This audit reviews the end-to-end bot path:

- Telegram webhook and polling intake
- inbound deduplication and worker scheduling
- conversation binding and thread routing
- `workspace_thread` and `openai_responses` AI execution
- Telegram final and streaming delivery
- failure handling and recovery behavior

## Findings

### High Priority

1. Inbound deduplication is currently tied to `BotConversation.LastInboundMessageID`.
   - The message id is persisted before the reply has been fully delivered.
   - If AI execution or Telegram outbound delivery fails after that write, a later redelivery of the same Telegram message can be incorrectly treated as a duplicate.
   - This creates a permanent message-loss risk.

2. Webhook acceptance currently acknowledges delivery after enqueueing work into an in-memory channel.
   - A process crash between the HTTP 200 response and worker execution can lose the inbound message permanently.
   - Polling has a similar persistence gap because the offset can advance after callback success while the actual work still only lives in RAM.

3. Bot transcript rendering currently includes `reasoning`.
   - The frontend intentionally hides reasoning cards.
   - Forwarding reasoning to Telegram leaks internal reasoning that should not be exposed by default.

### Medium Priority

1. Per-conversation workers have no idle reclamation.
   - A long-running server with many conversations can accumulate goroutines and channels.

2. Telegram outbound delivery has no retry/backoff for transient network failure or rate limiting.

## Execution Plan For This Round

This round will implement the highest-value fixes with bounded risk:

1. Add a persisted inbound delivery record and drive deduplication from delivery state instead of `LastInboundMessageID`.
2. Persist inbound deliveries before webhook and polling handoff so pending work can be recovered after restart.
3. Recover persisted pending deliveries on startup and on connection resume.
4. Stop forwarding `reasoning` to Telegram by default.

## Expected Outcome

After this hardening pass:

- the same inbound Telegram message will not be dropped after a failed processing attempt
- webhook and polling intake will survive process restarts once the inbound delivery has been persisted
- Telegram users will no longer receive hidden reasoning output

## Follow-Up Execution

A follow-up hardening pass on 2026-03-27 implemented Telegram outbound retry/backoff:

- `sendMessage`, `editMessageText`, and `deleteMessage` now retry with bounded exponential backoff on transient `5xx` responses and transient transport failures
- explicit Telegram rate limiting is honored through `retry_after` / `Retry-After`
- fatal client-side `4xx` responses still fail fast so invalid requests are not retried indefinitely

Another follow-up pass on 2026-03-27 implemented Telegram forum topic isolation:

- inbound Telegram messages now derive a distinct bot conversation key from `chat.id` and `message_thread_id`
- `BotConversation` and `BotInboundDelivery` persist the route key separately from the raw Telegram `chat_id`
- outbound Telegram sends now include `message_thread_id` when the conversation is bound to a forum topic

Another follow-up pass on 2026-03-27 implemented worker idle reclamation:

- per-conversation bot workers now retire after an idle timeout instead of staying alive for the full process lifetime
- the enqueue path keeps a small amount of worker state so reclaim does not race with late-arriving inbound jobs
- sequential per-conversation processing semantics are preserved

No deferred items from this audit remain open.
