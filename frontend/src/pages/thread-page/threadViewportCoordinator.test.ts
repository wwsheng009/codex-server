import { describe, expect, it } from 'vitest'

import {
  createThreadViewportCoordinatorState,
  reduceThreadViewportContentChange,
  reduceThreadViewportDetach,
  reduceThreadViewportJumpToLatest,
  reduceThreadViewportOlderTurnsAnchor,
  reduceThreadViewportPinnedState,
  reduceThreadViewportRestoreOlderTurns,
  reduceThreadViewportSelection,
  reduceThreadViewportThreadOpenSettleComplete,
} from './threadViewportCoordinator'

describe('threadViewportCoordinator', () => {
  it('resets to follow mode and queues a scroll when a thread is selected', () => {
    const result = reduceThreadViewportSelection('thread-1')

    expect(result.state.followMode).toBe('follow')
    expect(result.state.pendingThreadOpenThreadId).toBe('thread-1')
    expect(result.command).toMatchObject({
      kind: 'scroll-to-bottom',
      source: 'thread-selected',
    })
  })

  it('marks unread instead of auto-scrolling while detached', () => {
    const detachedState = reduceThreadViewportDetach(
      createThreadViewportCoordinatorState('thread-1'),
    )

    const result = reduceThreadViewportContentChange(detachedState, {
      shouldAutoScroll: false,
      shouldMarkUnread: true,
    })

    expect(result.state.hasUnreadThreadUpdates).toBe(true)
    expect(result.command).toBeUndefined()
  })

  it('queues a jump-to-latest command and reattaches follow mode', () => {
    const detachedState = reduceThreadViewportDetach(
      createThreadViewportCoordinatorState('thread-1'),
    )

    const result = reduceThreadViewportJumpToLatest(detachedState, 'smooth')

    expect(result.state.followMode).toBe('follow')
    expect(result.state.isPinnedToLatest).toBe(true)
    expect(result.state.hasUnreadThreadUpdates).toBe(false)
    expect(result.command).toMatchObject({
      behavior: 'smooth',
      kind: 'scroll-to-bottom',
      source: 'jump-to-latest',
    })
  })

  it('captures and restores older-turn anchors through a preserve-position command', () => {
    const stateWithAnchor = reduceThreadViewportOlderTurnsAnchor(
      createThreadViewportCoordinatorState('thread-1'),
      {
        restoreMode: 'preserve-position',
        scrollHeight: 1200,
        scrollTop: 320,
      },
    )

    const result = reduceThreadViewportRestoreOlderTurns(stateWithAnchor)

    expect(result.state.olderTurnsAnchor).toBeNull()
    expect(result.command).toMatchObject({
      kind: 'restore-anchor',
      source: 'older-turn-restore',
      anchor: {
        restoreMode: 'preserve-position',
        scrollHeight: 1200,
        scrollTop: 320,
      },
    })
  })

  it('drops auto-loaded older-turn anchors without issuing a restore command', () => {
    const stateWithAnchor = reduceThreadViewportOlderTurnsAnchor(
      createThreadViewportCoordinatorState('thread-1'),
      {
        restoreMode: 'reveal-older',
        scrollHeight: 1200,
        scrollTop: 0,
      },
    )

    const result = reduceThreadViewportRestoreOlderTurns(stateWithAnchor)

    expect(result.command).toBeUndefined()
    expect(result.state.olderTurnsAnchor).toBeNull()
  })

  it('tracks pinned viewport sync results in coordinator state', () => {
    const state = createThreadViewportCoordinatorState('thread-1')

    const followState = reduceThreadViewportPinnedState(state, {
      isPinnedToLatest: true,
      shouldFollowThread: true,
      shouldResetUnread: true,
    })
    expect(followState.followMode).toBe('follow')
    expect(followState.isPinnedToLatest).toBe(true)

    const detachedState = reduceThreadViewportPinnedState(followState, {
      isPinnedToLatest: false,
      shouldFollowThread: false,
      shouldResetUnread: false,
    })
    expect(detachedState.followMode).toBe('detached')
    expect(detachedState.isPinnedToLatest).toBe(false)
  })

  it('clears the pending thread-open settle flag when requested', () => {
    const state = createThreadViewportCoordinatorState('thread-1')

    expect(reduceThreadViewportThreadOpenSettleComplete(state).pendingThreadOpenThreadId).toBeNull()
  })
})
