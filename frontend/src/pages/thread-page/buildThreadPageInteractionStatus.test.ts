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
      hasRecoverableRuntimeOperation: false,
      recoverableRuntimeActionKind: null,
      hasUnreadThreadUpdates: false,
      interruptPending: false,
      isThreadPinnedToLatest: true,
      latestDisplayedTurn: undefined,
      liveThreadStatus: undefined,
      restartAndRetryPending: false,
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
      hasRecoverableRuntimeOperation: false,
      recoverableRuntimeActionKind: null,
      hasUnreadThreadUpdates: false,
      interruptPending: false,
      isThreadPinnedToLatest: true,
      latestDisplayedTurn: undefined,
      liveThreadStatus: undefined,
      restartAndRetryPending: false,
      selectedThread: undefined,
      selectedThreadId: 'thread-1',
      sendError: 'OpenAI authentication is required.',
      streamState: 'open',
      suppressAuthenticationError: false,
    })

    expect(result.requiresOpenAIAuth).toBe(true)
  })

  it('uses restart-and-retry labeling when a recoverable runtime restart flow is available', () => {
    const result = buildThreadPageInteractionStatus({
      account: undefined,
      accountError: null,
      activeComposerApproval: null,
      activeContextCompactionFeedback: null,
      activePendingTurn: null,
      hasRecoverableRuntimeOperation: true,
      recoverableRuntimeActionKind: 'restart-and-retry',
      hasUnreadThreadUpdates: false,
      interruptPending: false,
      isThreadPinnedToLatest: true,
      latestDisplayedTurn: undefined,
      liveThreadStatus: undefined,
      restartAndRetryPending: false,
      selectedThread: undefined,
      selectedThreadId: 'thread-1',
      sendError: 'Runtime exited unexpectedly.',
      streamState: 'open',
      suppressAuthenticationError: false,
    })

    expect(result.composerStatusRetryLabel).toBe('Restart and Retry')
    expect(result.isSendBusy).toBe(false)
  })

  it('uses plain retry labeling when the runtime suggests retry without recycle', () => {
    const result = buildThreadPageInteractionStatus({
      account: undefined,
      accountError: null,
      activeComposerApproval: null,
      activeContextCompactionFeedback: null,
      activePendingTurn: null,
      hasRecoverableRuntimeOperation: true,
      recoverableRuntimeActionKind: 'retry',
      hasUnreadThreadUpdates: false,
      interruptPending: false,
      isThreadPinnedToLatest: true,
      latestDisplayedTurn: undefined,
      liveThreadStatus: undefined,
      restartAndRetryPending: false,
      selectedThread: undefined,
      selectedThreadId: 'thread-1',
      sendError: 'Temporary transport interruption.',
      streamState: 'open',
      suppressAuthenticationError: false,
    })

    expect(result.composerStatusRetryLabel).toBe('Retry')
    expect(result.isSendBusy).toBe(false)
  })

  it('uses live thread status to clear stale replying state after completion', () => {
    const result = buildThreadPageInteractionStatus({
      account: undefined,
      accountError: null,
      activeComposerApproval: null,
      activeContextCompactionFeedback: null,
      activePendingTurn: null,
      hasRecoverableRuntimeOperation: false,
      recoverableRuntimeActionKind: null,
      hasUnreadThreadUpdates: false,
      interruptPending: false,
      isThreadPinnedToLatest: true,
      latestDisplayedTurn: {
        id: 'turn-1',
        items: [],
        status: 'completed',
      },
      liveThreadStatus: 'completed',
      restartAndRetryPending: false,
      selectedThread: {
        archived: false,
        createdAt: new Date().toISOString(),
        id: 'thread-1',
        name: 'Example',
        status: 'running',
        updatedAt: new Date().toISOString(),
        workspaceId: 'workspace-1',
      },
      selectedThreadId: 'thread-1',
      sendError: null,
      streamState: 'open',
      suppressAuthenticationError: false,
    })

    expect(result.isThreadInterruptible).toBe(false)
    expect(result.composerActivityTitle).toBeNull()
    expect(result.mobileStatus).toBe('completed')
  })
})
