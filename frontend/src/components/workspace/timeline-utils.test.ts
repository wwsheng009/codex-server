import { describe, expect, it } from 'vitest'

import type { ServerEvent } from '../../types/api'
import { buildLiveTimelineEntries } from './timeline-utils'

function makeEvent(method: string, payload: unknown, ts: string): ServerEvent {
  return {
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    method,
    payload,
    ts,
  }
}

describe('timeline-utils', () => {
  it('aggregates plan text deltas into a single live feed card', () => {
    const entries = buildLiveTimelineEntries([
      makeEvent(
        'item/plan/delta',
        {
          itemId: 'turn-1-plan',
          delta: '1. Inspect logs\n',
        },
        '2026-04-11T01:00:00.000Z',
      ),
      makeEvent(
        'item/plan/delta',
        {
          itemId: 'turn-1-plan',
          delta: '2. Patch retry flow\n',
        },
        '2026-04-11T01:00:01.000Z',
      ),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'delta',
      title: 'Plan Draft',
      subtitle: 'turn-1-plan',
      count: 2,
    })
    if (entries[0].kind !== 'delta') {
      throw new Error('expected delta entry')
    }
    expect(entries[0].text).toContain('1. Inspect logs')
    expect(entries[0].text).toContain('2. Patch retry flow')
  })

  it('formats turn plan updates as readable status snapshots', () => {
    const entries = buildLiveTimelineEntries([
      makeEvent(
        'turn/plan/updated',
        {
          turnId: 'turn-1',
          explanation: 'Stabilize the pipeline',
          plan: [
            {
              step: 'Inspect runtime events',
              status: 'completed',
            },
            {
              step: 'Render status badges',
              status: 'inProgress',
            },
          ],
        },
        '2026-04-11T01:10:00.000Z',
      ),
      makeEvent(
        'turn/plan/updated',
        {
          turnId: 'turn-1',
          explanation: 'Stabilize the pipeline',
          plan: [
            {
              step: 'Inspect runtime events',
              status: 'completed',
            },
            {
              step: 'Render status badges',
              status: 'completed',
            },
          ],
        },
        '2026-04-11T01:10:01.000Z',
      ),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'delta',
      title: 'Plan Status',
      subtitle: 'turn-1',
      count: 2,
    })
    if (entries[0].kind !== 'delta') {
      throw new Error('expected delta entry')
    }
    expect(entries[0].text).toContain('Explanation: Stabilize the pipeline')
    expect(entries[0].text).toContain('[completed] Inspect runtime events')
    expect(entries[0].text).toContain('[inProgress] Render status badges')
  })
})
