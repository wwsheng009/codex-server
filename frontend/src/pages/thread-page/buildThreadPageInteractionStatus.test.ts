import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import { buildThreadPageInteractionStatus } from './buildThreadPageInteractionStatus'

describe('buildThreadPageInteractionStatus', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('suppresses stale authentication status while recovery is being confirmed', () => {
    const result = buildThreadPageInteractionStatus({
      account: {
        email: 'user@example.com',
        id: 'acct-1',
        lastSyncedAt: new Date().toISOString(),
        status: 'requires_openai_auth',
      },
      accountError: null,
      activeComposerApproval: null,
      activeContextCompactionFeedback: null,
      activePendingTurn: null,
      hasUnreadThreadUpdates: false,
      interruptPending: false,
      isThreadPinnedToLatest: true,
      latestDisplayedTurn: undefined,
      selectedThread: undefined,
      selectedThreadId: 'thread-1',
      sendError: null,
      streamState: 'open',
      suppressAuthenticationError: true,
    })

    expect(result.requiresOpenAIAuth).toBe(false)
  })

  it('treats authentication-flavored send errors as auth errors when not suppressed', () => {
    const result = buildThreadPageInteractionStatus({
      account: undefined,
      accountError: null,
      activeComposerApproval: null,
      activeContextCompactionFeedback: null,
      activePendingTurn: null,
      hasUnreadThreadUpdates: false,
      interruptPending: false,
      isThreadPinnedToLatest: true,
      latestDisplayedTurn: undefined,
      selectedThread: undefined,
      selectedThreadId: 'thread-1',
      sendError: 'OpenAI authentication is required.',
      streamState: 'open',
      suppressAuthenticationError: false,
    })

    expect(result.requiresOpenAIAuth).toBe(true)
  })
})
