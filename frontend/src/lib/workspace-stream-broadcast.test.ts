import { describe, expect, it } from 'vitest'

import {
  selectWorkspaceStreamLeaderCandidate,
  shouldYieldWorkspaceStreamLeadership,
} from './workspace-stream-broadcast'

describe('workspace stream broadcast leader helpers', () => {
  it('selects the lowest active instance id as leader', () => {
    const leader = selectWorkspaceStreamLeaderCandidate(
      'tab-c',
      {
        'tab-a': 1_000,
        'tab-b': 1_100,
      },
      1_500,
      1_000,
    )

    expect(leader).toBe('tab-a')
  })

  it('ignores stale peers during leader selection', () => {
    const leader = selectWorkspaceStreamLeaderCandidate(
      'tab-c',
      {
        'tab-a': 100,
        'tab-b': 1_250,
      },
      1_500,
      300,
    )

    expect(leader).toBe('tab-b')
  })

  it('yields leadership only to a lower-priority instance', () => {
    expect(shouldYieldWorkspaceStreamLeadership('tab-b', 'tab-a')).toBe(true)
    expect(shouldYieldWorkspaceStreamLeadership('tab-b', 'tab-c')).toBe(false)
    expect(shouldYieldWorkspaceStreamLeadership('tab-b', 'tab-b')).toBe(false)
  })
})
