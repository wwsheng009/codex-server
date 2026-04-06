import { i18n } from '../../i18n/runtime'
import type { BotConnectionLogEntry } from '../../types/api'

export type BotConnectionLogFilter = 'all' | 'suppressed' | 'attention'

export type BotConnectionLogSummary = {
  totalCount: number
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
  highlightStyle: 'none' | 'suppressed'
}

const SUPPRESSED_EVENT_TYPES = new Set(['duplicate_delivery_suppressed', 'recovery_replay_suppressed'])

export function normalizeBotConnectionLogEventType(eventType: string | null | undefined) {
  return eventType?.trim().toLowerCase() ?? ''
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
    suppressedCount: 0,
    duplicateSuppressedCount: 0,
    recoverySuppressedCount: 0,
    attentionCount: 0,
  }

  for (const entry of logs) {
    const eventType = normalizeBotConnectionLogEventType(entry.eventType)
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
    default:
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

function formatBotConnectionLogEventTypeLabel(eventType: string) {
  return eventType
    .split('_')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}
