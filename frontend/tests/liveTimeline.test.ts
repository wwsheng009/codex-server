import { describe, expect, it } from 'vitest'

import { buildLiveTimelineEntries } from '../src/components/thread/liveTimeline'
import type { ServerEvent } from '../src/types/api'

describe('buildLiveTimelineEntries', () => {
  it('aggregates agent message deltas by itemId', () => {
    const entries = buildLiveTimelineEntries([
      event('item/agentMessage/delta', {
        delta: 'Hel',
        itemId: 'msg-1',
      }),
      event('item/agentMessage/delta', {
        delta: 'lo',
        itemId: 'msg-1',
      }),
      event('item/agentMessage/delta', {
        delta: '!',
        itemId: 'msg-2',
      }),
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      kind: 'delta',
      title: 'Agent Message Streaming',
      subtitle: 'msg-1',
      text: 'Hello',
      count: 2,
    })
    expect(entries[1]).toMatchObject({
      kind: 'delta',
      subtitle: 'msg-2',
      text: '!',
      count: 1,
    })
  })

  it('keeps non-delta events as standalone entries', () => {
    const entries = buildLiveTimelineEntries([
      event('turn/started', {
        turn: { id: 'turn-1', status: 'inProgress' },
      }),
      event('item/agentMessage/delta', {
        delta: 'hi',
        itemId: 'msg-1',
      }),
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      kind: 'event',
      event: expect.objectContaining({ method: 'turn/started' }),
    })
    expect(entries[1]).toMatchObject({
      kind: 'delta',
      text: 'hi',
    })
  })

  it('aggregates command output deltas by processId and stream', () => {
    const entries = buildLiveTimelineEntries([
      event('command/exec/outputDelta', {
        processId: 'proc-1',
        stream: 'stdout',
        deltaBase64: 'aGVs',
      }),
      event('command/exec/outputDelta', {
        processId: 'proc-1',
        stream: 'stdout',
        deltaBase64: 'bG8=',
      }),
      event('command/exec/outputDelta', {
        processId: 'proc-1',
        stream: 'stderr',
        deltaBase64: 'IQ==',
      }),
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      kind: 'delta',
      title: 'Command stdout Streaming',
      subtitle: 'proc-1',
      text: 'hello',
      count: 2,
    })
    expect(entries[1]).toMatchObject({
      kind: 'delta',
      title: 'Command stderr Streaming',
      text: '!',
      count: 1,
    })
  })
})

function event(method: string, payload: Record<string, unknown>): ServerEvent {
  const atob = (value: string) => Buffer.from(value, 'base64').toString('binary')
  ;(globalThis as { window?: { atob: (value: string) => string } }).window = { atob }

  return {
    workspaceId: 'ws-1',
    threadId: 'thr-1',
    turnId: 'turn-1',
    method,
    payload,
    ts: '2026-03-19T12:00:00Z',
  }
}
