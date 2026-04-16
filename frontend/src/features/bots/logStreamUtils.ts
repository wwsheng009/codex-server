import { humanizeDisplayValue } from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import type { BotConnectionLogEntry } from '../../types/api'

export type BotConnectionLogFilter = 'all' | 'deliveries' | 'suppressed' | 'attention'

export type BotConnectionLogSummary = {
  totalCount: number
  deliveryCount: number
  suppressedCount: number
  duplicateSuppressedCount: number
  recoverySuppressedCount: number
  attentionCount: number
}

export type BotConnectionSuppressionWindowSummary = {
  suppressedCount: number
  duplicateSuppressedCount: number
  recoverySuppressedCount: number
  latestSuppressedAt?: string
}

export type BotConnectionLogDescriptor = {
  eventLabel?: string
  eventTone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  highlightStyle:
    | 'none'
    | 'suppressed'
    | 'delivery-sending'
    | 'delivery-success'
    | 'delivery-warning'
    | 'delivery-danger'
}

const SUPPRESSED_EVENT_TYPES = new Set(['duplicate_delivery_suppressed', 'recovery_replay_suppressed'])
const POLL_IDLE_NO_MESSAGES_RE = /^Poll completed successfully\. No new messages\.$/
const POLL_IDLE_NO_UPDATES_RE = /^Poll completed successfully\. No new updates\.$/
const POLL_RECEIVED_MESSAGES_RE =
  /^Poll completed successfully\. Received (\d+) message\(s\), processed (\d+), ignored (\d+)\.$/
const POLL_RECEIVED_UPDATES_RE =
  /^Poll completed successfully\. Received (\d+) update\(s\), processed (\d+), ignored (\d+)\.$/
const PROVIDER_PAUSED_RE = /^Provider paused\. Resume it before it can participate in routing again\.$/
const PROVIDER_RESUMED_RE = /^Provider resumed\. Waiting for the next health update\.$/
const REPLY_DELIVERY_RETRY_RE =
  /^Reply delivery attempt (\d+) failed during (.+) and will retry (.+): ([\s\S]+)$/
const MANUAL_REPLAY_FAILED_RE =
  /^Manual replay could not redeliver failed delivery (\S+) for original message (\S+): ([\s\S]+)$/
const MANUAL_REPLAYED_RE = /^Manually replayed failed delivery (\S+) for original message (\S+)\.$/
const OUTBOUND_DELIVERY_RETRY_RE =
  /^Outbound delivery (\S+) attempt (\d+) to target (\S+) failed and will retry (.+): ([\s\S]+)$/
const OUTBOUND_DELIVERY_FAILED_RE =
  /^Outbound delivery (\S+) to target (\S+) failed after (\d+) attempt\(s\): ([\s\S]+)$/
const OUTBOUND_DELIVERY_SENT_RE = /^Outbound delivery (\S+) sent to target (\S+)\.$/
const REPLY_DELIVERY_SENDING_RE = /^Reply delivery attempt (\d+) started for message (\S+)\.$/
const REPLY_DELIVERY_DELIVERED_RE =
  /^Reply delivery succeeded after (\d+) attempt\(s\) for message (\S+)\.$/
const REPLY_DELIVERY_RECOVERED_RE =
  /^Reply delivery recovered after (\d+) attempts for conversation (\S+)\.$/
const REPLY_DELIVERY_FAILED_RE =
  /^Reply delivery failed after (\d+) attempt\(s\) for message (\S+): ([\s\S]+)$/
const POLLING_FAILED_RE = /^Polling iteration failed: ([\s\S]+)$/
const POLLER_STARTED_RE = /^(.+) polling worker started\.$/
const POLLER_STOPPED_RE = /^(.+) polling worker stopped\.$/
const TELEGRAM_MEDIA_GROUP_SPLIT_RE =
  /^Telegram media group (\S+) for conversation (\S+) received new items after an earlier batch had already been flushed\. Processing the late items as a follow-up batch\.$/
const TELEGRAM_MEDIA_GROUP_FLUSH_FAILED_RE =
  /^Failed to persist aggregated Telegram media group (\S+) for conversation (\S+): ([\s\S]+)$/
const DUPLICATE_REPLAY_SUPPRESSED_MESSAGE_RE =
  /^Ignored duplicate inbound message (\S+) for conversation (\S+) because failed delivery (\S+) already has a saved reply snapshot with (\d+) outbound ([^.]+)\. Replaying it could duplicate previously sent content\.$/
const RECOVERY_REPLAY_SUPPRESSED_MESSAGE_RE =
  /^Skipped automatic recovery for failed delivery (\S+) \(message ([^)]+)\) because a saved reply snapshot with (\d+) outbound ([^.]+) already exists\. Replaying it after restart could duplicate previously sent content\.$/
const REPLAY_RECONCILE_FAILED_RE =
  /^Failed to reconcile recovered delivery (\S+) after retry request (\S+): ([\s\S]+)$/
const AUTO_REPLAYED_RE =
  /^Replayed failed delivery (\S+) for original message (\S+) after retry request (\S+)\.$/
const RETRY_REPLAY_FAILED_RE =
  /^Retry request (\S+) could not replay failed delivery (\S+) for original message (\S+): ([\s\S]+)$/

export function normalizeBotConnectionLogEventType(eventType: string | null | undefined) {
  return eventType?.trim().toLowerCase() ?? ''
}

export function formatBotRuntimeMessage(
  message: string | null | undefined,
  messageKey?: string | null,
  messageParams?: Record<string, string> | null,
  eventType?: string | null,
) {
  const normalizedKey = messageKey?.trim().toLowerCase() ?? ''
  const normalizedMessage = message?.trim() ?? ''
  const normalizedEventType = normalizeBotConnectionLogEventType(eventType)

  if (
    normalizedKey === 'bot.poll-idle.no-new-messages' ||
    POLL_IDLE_NO_MESSAGES_RE.test(normalizedMessage)
  ) {
    return i18n._({
      id: 'Poll completed successfully. No new messages.',
      message: 'Poll completed successfully. No new messages.',
    })
  }

  if (POLL_IDLE_NO_UPDATES_RE.test(normalizedMessage)) {
    return i18n._({
      id: 'Poll completed successfully. No new updates.',
      message: 'Poll completed successfully. No new updates.',
    })
  }

  if (normalizedKey === 'bot.recovery-replay-suppressed.saved-reply-snapshot') {
    return formatRecoveryReplaySuppressedMessage(messageParams, normalizedMessage)
  }

  const formatterByPattern = [
    [POLL_RECEIVED_MESSAGES_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Poll completed successfully. Received {receivedCount} message(s), processed {processedCount}, ignored {ignoredCount}.',
        message:
          'Poll completed successfully. Received {receivedCount} message(s), processed {processedCount}, ignored {ignoredCount}.',
        values: {
          receivedCount: match[1],
          processedCount: match[2],
          ignoredCount: match[3],
        },
      })],
    [POLL_RECEIVED_UPDATES_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Poll completed successfully. Received {receivedCount} update(s), processed {processedCount}, ignored {ignoredCount}.',
        message:
          'Poll completed successfully. Received {receivedCount} update(s), processed {processedCount}, ignored {ignoredCount}.',
        values: {
          receivedCount: match[1],
          processedCount: match[2],
          ignoredCount: match[3],
        },
      })],
    [PROVIDER_PAUSED_RE, () =>
      i18n._({
        id: 'Provider paused. Resume it before it can participate in routing again.',
        message: 'Provider paused. Resume it before it can participate in routing again.',
      })],
    [PROVIDER_RESUMED_RE, () =>
      i18n._({
        id: 'Provider resumed. Waiting for the next health update.',
        message: 'Provider resumed. Waiting for the next health update.',
      })],
    [REPLY_DELIVERY_RETRY_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Reply delivery attempt {attempt} failed during {phase} and will retry {delayLabel}: {error}',
        message:
          'Reply delivery attempt {attempt} failed during {phase} and will retry {delayLabel}: {error}',
        values: {
          attempt: match[1],
          phase: match[2],
          delayLabel: match[3],
          error: match[4],
        },
      })],
    [MANUAL_REPLAY_FAILED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Manual replay could not redeliver failed delivery {deliveryId} for original message {messageId}: {error}',
        message:
          'Manual replay could not redeliver failed delivery {deliveryId} for original message {messageId}: {error}',
        values: {
          deliveryId: match[1],
          messageId: match[2],
          error: match[3],
        },
      })],
    [MANUAL_REPLAYED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Manually replayed failed delivery {deliveryId} for original message {messageId}.',
        message: 'Manually replayed failed delivery {deliveryId} for original message {messageId}.',
        values: {
          deliveryId: match[1],
          messageId: match[2],
        },
      })],
    [OUTBOUND_DELIVERY_RETRY_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Outbound delivery {deliveryId} attempt {attempt} to target {targetId} failed and will retry {delayLabel}: {error}',
        message:
          'Outbound delivery {deliveryId} attempt {attempt} to target {targetId} failed and will retry {delayLabel}: {error}',
        values: {
          deliveryId: match[1],
          attempt: match[2],
          targetId: match[3],
          delayLabel: match[4],
          error: match[5],
        },
      })],
    [OUTBOUND_DELIVERY_FAILED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Outbound delivery {deliveryId} to target {targetId} failed after {attempt} attempt(s): {error}',
        message:
          'Outbound delivery {deliveryId} to target {targetId} failed after {attempt} attempt(s): {error}',
        values: {
          deliveryId: match[1],
          targetId: match[2],
          attempt: match[3],
          error: match[4],
        },
      })],
    [OUTBOUND_DELIVERY_SENT_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Outbound delivery {deliveryId} sent to target {targetId}.',
        message: 'Outbound delivery {deliveryId} sent to target {targetId}.',
        values: {
          deliveryId: match[1],
          targetId: match[2],
        },
      })],
    [REPLY_DELIVERY_SENDING_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Reply delivery attempt {attempt} started for message {messageId}.',
        message: 'Reply delivery attempt {attempt} started for message {messageId}.',
        values: {
          attempt: match[1],
          messageId: match[2],
        },
      })],
    [REPLY_DELIVERY_DELIVERED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Reply delivery succeeded after {attempt} attempt(s) for message {messageId}.',
        message: 'Reply delivery succeeded after {attempt} attempt(s) for message {messageId}.',
        values: {
          attempt: match[1],
          messageId: match[2],
        },
      })],
    [REPLY_DELIVERY_RECOVERED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Reply delivery recovered after {attempt} attempts for conversation {conversationId}.',
        message: 'Reply delivery recovered after {attempt} attempts for conversation {conversationId}.',
        values: {
          attempt: match[1],
          conversationId: match[2],
        },
      })],
    [REPLY_DELIVERY_FAILED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Reply delivery failed after {attempt} attempt(s) for message {messageId}: {error}',
        message:
          'Reply delivery failed after {attempt} attempt(s) for message {messageId}: {error}',
        values: {
          attempt: match[1],
          messageId: match[2],
          error: match[3],
        },
      })],
    [POLLING_FAILED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Polling iteration failed: {error}',
        message: 'Polling iteration failed: {error}',
        values: {
          error: match[1],
        },
      })],
    [POLLER_STARTED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: '{provider} polling worker started.',
        message: '{provider} polling worker started.',
        values: {
          provider: match[1],
        },
      })],
    [POLLER_STOPPED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: '{provider} polling worker stopped.',
        message: '{provider} polling worker stopped.',
        values: {
          provider: match[1],
        },
      })],
    [TELEGRAM_MEDIA_GROUP_SPLIT_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Telegram media group {groupId} for conversation {conversationId} received new items after an earlier batch had already been flushed. Processing the late items as a follow-up batch.',
        message:
          'Telegram media group {groupId} for conversation {conversationId} received new items after an earlier batch had already been flushed. Processing the late items as a follow-up batch.',
        values: {
          groupId: match[1],
          conversationId: match[2],
        },
      })],
    [TELEGRAM_MEDIA_GROUP_FLUSH_FAILED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Failed to persist aggregated Telegram media group {groupId} for conversation {conversationId}: {error}',
        message:
          'Failed to persist aggregated Telegram media group {groupId} for conversation {conversationId}: {error}',
        values: {
          groupId: match[1],
          conversationId: match[2],
          error: match[3],
        },
      })],
    [DUPLICATE_REPLAY_SUPPRESSED_MESSAGE_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Ignored duplicate inbound message {messageId} for conversation {conversationId} because failed delivery {deliveryId} already has a saved reply snapshot with {replyCount} outbound {replyLabel}. Replaying it could duplicate previously sent content.',
        message:
          'Ignored duplicate inbound message {messageId} for conversation {conversationId} because failed delivery {deliveryId} already has a saved reply snapshot with {replyCount} outbound {replyLabel}. Replaying it could duplicate previously sent content.',
        values: {
          messageId: match[1],
          conversationId: match[2],
          deliveryId: match[3],
          replyCount: match[4],
          replyLabel: match[5],
        },
      })],
    [REPLAY_RECONCILE_FAILED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Failed to reconcile recovered delivery {deliveryId} after retry request {retryMessageId}: {error}',
        message:
          'Failed to reconcile recovered delivery {deliveryId} after retry request {retryMessageId}: {error}',
        values: {
          deliveryId: match[1],
          retryMessageId: match[2],
          error: match[3],
        },
      })],
    [AUTO_REPLAYED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Replayed failed delivery {deliveryId} for original message {messageId} after retry request {retryMessageId}.',
        message:
          'Replayed failed delivery {deliveryId} for original message {messageId} after retry request {retryMessageId}.',
        values: {
          deliveryId: match[1],
          messageId: match[2],
          retryMessageId: match[3],
        },
      })],
    [RETRY_REPLAY_FAILED_RE, (match: RegExpMatchArray) =>
      i18n._({
        id: 'Retry request {retryMessageId} could not replay failed delivery {deliveryId} for original message {messageId}: {error}',
        message:
          'Retry request {retryMessageId} could not replay failed delivery {deliveryId} for original message {messageId}: {error}',
        values: {
          retryMessageId: match[1],
          deliveryId: match[2],
          messageId: match[3],
          error: match[4],
        },
      })],
  ] as const

  for (const [pattern, formatter] of formatterByPattern) {
    const match = normalizedMessage.match(pattern)
    if (match) {
      return formatter(match)
    }
  }

  if (RECOVERY_REPLAY_SUPPRESSED_MESSAGE_RE.test(normalizedMessage)) {
    return formatRecoveryReplaySuppressedMessage(parseRecoveryReplaySuppressedMessage(normalizedMessage))
  }

  if (!normalizedMessage && normalizedEventType === 'poll_idle') {
    return i18n._({
      id: 'Poll completed successfully. No new messages.',
      message: 'Poll completed successfully. No new messages.',
    })
  }

  return normalizedMessage
}

export function isBotConnectionLogDeliveryEvent(eventType: string | null | undefined) {
  return normalizeBotConnectionLogEventType(eventType).startsWith('reply_delivery_')
}

export function isBotConnectionLogSuppressionEvent(eventType: string | null | undefined) {
  return SUPPRESSED_EVENT_TYPES.has(normalizeBotConnectionLogEventType(eventType))
}

export function isBotConnectionLogAttentionEntry(entry: Pick<BotConnectionLogEntry, 'eventType' | 'level'>) {
  if (isBotConnectionLogSuppressionEvent(entry.eventType)) {
    return true
  }

  const level = entry.level.trim().toLowerCase()
  return level === 'warning' || level === 'error' || level === 'failed'
}

export function summarizeBotConnectionLogs(logs: BotConnectionLogEntry[]): BotConnectionLogSummary {
  const summary: BotConnectionLogSummary = {
    totalCount: logs.length,
    deliveryCount: 0,
    suppressedCount: 0,
    duplicateSuppressedCount: 0,
    recoverySuppressedCount: 0,
    attentionCount: 0,
  }

  for (const entry of logs) {
    const eventType = normalizeBotConnectionLogEventType(entry.eventType)
    if (isBotConnectionLogDeliveryEvent(eventType)) {
      summary.deliveryCount += 1
    }
    if (isBotConnectionLogAttentionEntry(entry)) {
      summary.attentionCount += 1
    }
    if (eventType === 'duplicate_delivery_suppressed') {
      summary.suppressedCount += 1
      summary.duplicateSuppressedCount += 1
      continue
    }
    if (eventType === 'recovery_replay_suppressed') {
      summary.suppressedCount += 1
      summary.recoverySuppressedCount += 1
    }
  }

  return summary
}

export function summarizeRecentBotConnectionSuppressions(
  logs: BotConnectionLogEntry[],
  now = Date.now(),
  windowMs = 24 * 60 * 60 * 1000,
): BotConnectionSuppressionWindowSummary {
  const summary: BotConnectionSuppressionWindowSummary = {
    suppressedCount: 0,
    duplicateSuppressedCount: 0,
    recoverySuppressedCount: 0,
  }
  const windowStart = now - windowMs
  let latestSuppressedAtMs = Number.NEGATIVE_INFINITY

  for (const entry of logs) {
    const eventType = normalizeBotConnectionLogEventType(entry.eventType)
    if (!isBotConnectionLogSuppressionEvent(eventType)) {
      continue
    }

    const entryTime = Date.parse(entry.ts)
    if (Number.isNaN(entryTime) || entryTime < windowStart || entryTime > now) {
      continue
    }

    summary.suppressedCount += 1
    if (eventType === 'duplicate_delivery_suppressed') {
      summary.duplicateSuppressedCount += 1
    }
    if (eventType === 'recovery_replay_suppressed') {
      summary.recoverySuppressedCount += 1
    }
    if (entryTime > latestSuppressedAtMs) {
      latestSuppressedAtMs = entryTime
      summary.latestSuppressedAt = entry.ts
    }
  }

  return summary
}

export function filterBotConnectionLogs(logs: BotConnectionLogEntry[], filter: BotConnectionLogFilter) {
  switch (filter) {
    case 'deliveries':
      return logs.filter((entry) => isBotConnectionLogDeliveryEvent(entry.eventType))
    case 'suppressed':
      return logs.filter((entry) => isBotConnectionLogSuppressionEvent(entry.eventType))
    case 'attention':
      return logs.filter((entry) => isBotConnectionLogAttentionEntry(entry))
    case 'all':
    default:
      return logs
  }
}

export function describeBotConnectionLogEntry(entry: Pick<BotConnectionLogEntry, 'eventType' | 'level'>): BotConnectionLogDescriptor {
  const eventType = normalizeBotConnectionLogEventType(entry.eventType)
  switch (eventType) {
    case 'duplicate_delivery_suppressed':
      return {
        eventLabel: i18n._({
          id: 'Duplicate Replay Suppressed',
          message: 'Duplicate Replay Suppressed',
        }),
        eventTone: 'warning',
        highlightStyle: 'suppressed',
      }
    case 'recovery_replay_suppressed':
      return {
        eventLabel: i18n._({
          id: 'Restart Replay Suppressed',
          message: 'Restart Replay Suppressed',
        }),
        eventTone: 'warning',
        highlightStyle: 'suppressed',
      }
    case 'poller_started':
      return {
        eventLabel: i18n._({ id: 'Poller Started', message: 'Poller Started' }),
        eventTone: 'accent',
        highlightStyle: 'none',
      }
    case 'poller_stopped':
      return {
        eventLabel: i18n._({ id: 'Poller Stopped', message: 'Poller Stopped' }),
        eventTone: 'neutral',
        highlightStyle: 'none',
      }
    case 'poll_success':
      return {
        eventLabel: i18n._({ id: 'Poll Success', message: 'Poll Success' }),
        eventTone: 'success',
        highlightStyle: 'none',
      }
    case 'poll_idle':
      return {
        eventLabel: i18n._({ id: 'Poll Idle', message: 'Poll Idle' }),
        eventTone: 'accent',
        highlightStyle: 'none',
      }
    case 'poll_conflict':
      return {
        eventLabel: i18n._({ id: 'Polling Conflict', message: 'Polling Conflict' }),
        eventTone: 'danger',
        highlightStyle: 'none',
      }
    case 'provider_cleanup_failed':
      return {
        eventLabel: i18n._({ id: 'Cleanup Failed', message: 'Cleanup Failed' }),
        eventTone: 'warning',
        highlightStyle: 'none',
      }
    case 'reply_delivery_sending':
      return {
        eventLabel: i18n._({ id: 'Reply Sending', message: 'Reply Sending' }),
        eventTone: 'accent',
        highlightStyle: 'delivery-sending',
      }
    case 'reply_delivery_retry':
      return {
        eventLabel: i18n._({ id: 'Reply Retrying', message: 'Reply Retrying' }),
        eventTone: 'warning',
        highlightStyle: 'delivery-warning',
      }
    case 'reply_delivery_delivered':
      return {
        eventLabel: i18n._({ id: 'Reply Delivered', message: 'Reply Delivered' }),
        eventTone: 'success',
        highlightStyle: 'delivery-success',
      }
    case 'reply_delivery_recovered':
      return {
        eventLabel: i18n._({ id: 'Reply Recovered', message: 'Reply Recovered' }),
        eventTone: 'success',
        highlightStyle: 'delivery-success',
      }
    case 'reply_delivery_replayed':
      return {
        eventLabel: i18n._({ id: 'Reply Replayed', message: 'Reply Replayed' }),
        eventTone: 'success',
        highlightStyle: 'delivery-success',
      }
    case 'reply_delivery_failed':
      return {
        eventLabel: i18n._({ id: 'Reply Failed', message: 'Reply Failed' }),
        eventTone: 'danger',
        highlightStyle: 'delivery-danger',
      }
    case 'reply_delivery_replay_failed':
      return {
        eventLabel: i18n._({ id: 'Replay Failed', message: 'Replay Failed' }),
        eventTone: 'danger',
        highlightStyle: 'delivery-danger',
      }
    case 'reply_delivery_replay_reconcile_failed':
      return {
        eventLabel: i18n._({
          id: 'Replay Reconcile Failed',
          message: 'Replay Reconcile Failed',
        }),
        eventTone: 'warning',
        highlightStyle: 'delivery-warning',
      }
    default:
      if (isBotConnectionLogDeliveryEvent(eventType)) {
        const eventTone = toneFromLogLevel(entry.level)
        return {
          eventLabel: formatBotConnectionLogEventTypeLabel(eventType),
          eventTone,
          highlightStyle: deliveryHighlightStyleFromTone(eventTone),
        }
      }
      if (!eventType) {
        return {
          eventTone: toneFromLogLevel(entry.level),
          highlightStyle: 'none',
        }
      }
      return {
        eventLabel: formatBotConnectionLogEventTypeLabel(eventType),
        eventTone: toneFromLogLevel(entry.level),
        highlightStyle: 'none',
      }
  }
}

export function normalizeBotConnectionLogLevel(level: string | null | undefined) {
  const normalized = level?.trim().toLowerCase() ?? ''
  switch (normalized) {
    case 'success':
    case 'error':
    case 'warning':
    case 'info':
      return normalized
    default:
      return 'info'
  }
}

function toneFromLogLevel(level: string | null | undefined): BotConnectionLogDescriptor['eventTone'] {
  switch (normalizeBotConnectionLogLevel(level)) {
    case 'success':
      return 'success'
    case 'error':
      return 'danger'
    case 'warning':
      return 'warning'
    default:
      return 'neutral'
  }
}

function deliveryHighlightStyleFromTone(
  tone: BotConnectionLogDescriptor['eventTone'],
): BotConnectionLogDescriptor['highlightStyle'] {
  switch (tone) {
    case 'success':
      return 'delivery-success'
    case 'warning':
      return 'delivery-warning'
    case 'danger':
      return 'delivery-danger'
    case 'accent':
      return 'delivery-sending'
    default:
      return 'none'
  }
}

function formatBotConnectionLogEventTypeLabel(eventType: string) {
  return humanizeDisplayValue(eventType, eventType)
}

function formatRecoveryReplaySuppressedMessage(
  params?: Record<string, string> | null,
  fallback = '',
) {
  const values = {
    deliveryId: params?.deliveryId?.trim() || '',
    messageId: params?.messageId?.trim() || '',
    replyCount: params?.replyCount?.trim() || '',
    replyLabel: params?.replyLabel?.trim() || '',
  }

  if (!values.deliveryId || !values.messageId || !values.replyCount || !values.replyLabel) {
    return fallback
  }

  return i18n._({
    id: 'Skipped automatic recovery for failed delivery {deliveryId} (message {messageId}) because a saved reply snapshot with {replyCount} outbound {replyLabel} already exists. Replaying it after restart could duplicate previously sent content.',
    message:
      'Skipped automatic recovery for failed delivery {deliveryId} (message {messageId}) because a saved reply snapshot with {replyCount} outbound {replyLabel} already exists. Replaying it after restart could duplicate previously sent content.',
    values,
  })
}

function parseRecoveryReplaySuppressedMessage(message: string) {
  const match = message.match(RECOVERY_REPLAY_SUPPRESSED_MESSAGE_RE)
  if (!match) {
    return null
  }

  return {
    deliveryId: match[1],
    messageId: match[2],
    replyCount: match[3],
    replyLabel: match[4],
  }
}
