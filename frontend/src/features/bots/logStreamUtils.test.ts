import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import type { BotConnectionLogEntry } from '../../types/api'
import {
  describeBotConnectionLogEntry,
  filterBotConnectionLogs,
  isBotConnectionLogAttentionEntry,
  isBotConnectionLogDeliveryEvent,
  isBotConnectionLogSuppressionEvent,
  summarizeRecentBotConnectionSuppressions,
  summarizeBotConnectionLogs,
} from './logStreamUtils'

function buildLogEntry(overrides: Partial<BotConnectionLogEntry>): BotConnectionLogEntry {
  return {
    id: 'log-1',
    workspaceId: 'ws-1',
    connectionId: 'bot-1',
    ts: '2026-04-06T11:47:33Z',
    level: 'info',
    eventType: '',
    message: 'example',
    ...overrides,
  }
}

describe('logStreamUtils', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('classifies suppression events and attention entries', () => {
    const duplicateSuppressed = buildLogEntry({
      eventType: 'duplicate_delivery_suppressed',
      level: 'warning',
    })
    const deliverySending = buildLogEntry({
      eventType: 'reply_delivery_sending',
      level: 'info',
    })
    const regularSuccess = buildLogEntry({
      eventType: 'poll_success',
      level: 'success',
    })

    expect(isBotConnectionLogSuppressionEvent(duplicateSuppressed.eventType)).toBe(true)
    expect(isBotConnectionLogDeliveryEvent(deliverySending.eventType)).toBe(true)
    expect(isBotConnectionLogAttentionEntry(duplicateSuppressed)).toBe(true)
    expect(isBotConnectionLogAttentionEntry(regularSuccess)).toBe(false)
  })

  it('summarizes suppression and attention counts', () => {
    const logs = [
      buildLogEntry({
        id: 'log-delivery',
        eventType: 'reply_delivery_sending',
        level: 'info',
      }),
      buildLogEntry({
        id: 'log-duplicate',
        eventType: 'duplicate_delivery_suppressed',
        level: 'warning',
      }),
      buildLogEntry({
        id: 'log-recovery',
        eventType: 'recovery_replay_suppressed',
        level: 'warning',
      }),
      buildLogEntry({
        id: 'log-error',
        eventType: 'poll_conflict',
        level: 'error',
      }),
      buildLogEntry({
        id: 'log-success',
        eventType: 'poll_success',
        level: 'success',
      }),
    ]

    expect(summarizeBotConnectionLogs(logs)).toEqual({
      totalCount: 5,
      deliveryCount: 1,
      suppressedCount: 2,
      duplicateSuppressedCount: 1,
      recoverySuppressedCount: 1,
      attentionCount: 3,
    })
  })

  it('filters suppressed and attention entries separately', () => {
    const logs = [
      buildLogEntry({
        id: 'log-delivery',
        eventType: 'reply_delivery_delivered',
        level: 'success',
      }),
      buildLogEntry({
        id: 'log-duplicate',
        eventType: 'duplicate_delivery_suppressed',
        level: 'warning',
      }),
      buildLogEntry({
        id: 'log-warning',
        eventType: 'provider_cleanup_failed',
        level: 'warning',
      }),
      buildLogEntry({
        id: 'log-success',
        eventType: 'poll_success',
        level: 'success',
      }),
    ]

    expect(filterBotConnectionLogs(logs, 'suppressed').map((entry) => entry.id)).toEqual(['log-duplicate'])
    expect(filterBotConnectionLogs(logs, 'deliveries').map((entry) => entry.id)).toEqual(['log-delivery'])
    expect(filterBotConnectionLogs(logs, 'attention').map((entry) => entry.id)).toEqual([
      'log-duplicate',
      'log-warning',
    ])
    expect(filterBotConnectionLogs(logs, 'all').map((entry) => entry.id)).toEqual([
      'log-delivery',
      'log-duplicate',
      'log-warning',
      'log-success',
    ])
  })

  it('describes suppressed replay entries with warning emphasis', () => {
    expect(
      describeBotConnectionLogEntry(
        buildLogEntry({
          eventType: 'recovery_replay_suppressed',
          level: 'warning',
        }),
      ),
    ).toEqual({
      eventLabel: 'Restart Replay Suppressed',
      eventTone: 'warning',
      highlightStyle: 'suppressed',
    })
  })

  it('summarizes suppression events within the recent window only', () => {
    const logs = [
      buildLogEntry({
        id: 'log-recent-duplicate',
        ts: '2026-04-06T11:00:00Z',
        eventType: 'duplicate_delivery_suppressed',
        level: 'warning',
      }),
      buildLogEntry({
        id: 'log-recent-recovery',
        ts: '2026-04-05T13:00:00Z',
        eventType: 'recovery_replay_suppressed',
        level: 'warning',
      }),
      buildLogEntry({
        id: 'log-old-duplicate',
        ts: '2026-04-04T11:00:00Z',
        eventType: 'duplicate_delivery_suppressed',
        level: 'warning',
      }),
    ]

    expect(
      summarizeRecentBotConnectionSuppressions(logs, Date.parse('2026-04-06T12:00:00Z')),
    ).toEqual({
      suppressedCount: 2,
      duplicateSuppressedCount: 1,
      recoverySuppressedCount: 1,
      latestSuppressedAt: '2026-04-06T11:00:00Z',
    })
  })

  it('formats known polling events with readable labels', () => {
    expect(
      describeBotConnectionLogEntry(
        buildLogEntry({
          eventType: 'poll_success',
          level: 'success',
        }),
      ),
    ).toEqual({
      eventLabel: 'Poll Success',
      eventTone: 'success',
      highlightStyle: 'none',
    })
  })

  it('highlights reply delivery events with delivery-specific styles', () => {
    expect(
      describeBotConnectionLogEntry(
        buildLogEntry({
          eventType: 'reply_delivery_failed',
          level: 'error',
        }),
      ),
    ).toEqual({
      eventLabel: 'Reply Failed',
      eventTone: 'danger',
      highlightStyle: 'delivery-danger',
    })
  })
})
