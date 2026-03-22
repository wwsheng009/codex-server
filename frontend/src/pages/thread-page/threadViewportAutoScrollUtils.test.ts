import { describe, expect, it } from 'vitest'

import {
  computeThreadPinnedToLatest,
  resolveThreadViewportAutoScrollChange,
  resolveThreadViewportPinnedState,
} from './threadViewportAutoScrollUtils'

describe('resolveThreadViewportAutoScrollChange', () => {
  it('auto-scrolls followed content changes without marking unread', () => {
    expect(
      resolveThreadViewportAutoScrollChange({
        displayedTurnsLength: 3,
        pendingThreadOpenThreadId: null,
        pinnedToLatest: true,
        previousThreadContentKey: 'thread-1|before',
        previousThreadUnreadKey: 'msg-1',
        selectedThreadId: 'thread-1',
        shouldFollowThread: true,
        threadContentKey: 'thread-1|after',
        threadDetailIsLoading: false,
        threadUnreadUpdateKey: 'msg-1',
        userScrollLockActive: false,
      }),
    ).toMatchObject({
      contentChanged: true,
      shouldAutoScroll: true,
      shouldMarkUnread: false,
      unreadKeyChanged: false,
    })
  })

  it('marks unread only when the latest message changes while detached', () => {
    expect(
      resolveThreadViewportAutoScrollChange({
        displayedTurnsLength: 3,
        pendingThreadOpenThreadId: null,
        pinnedToLatest: false,
        previousThreadContentKey: 'thread-1|before',
        previousThreadUnreadKey: 'msg-1',
        selectedThreadId: 'thread-1',
        shouldFollowThread: false,
        threadContentKey: 'thread-1|after',
        threadDetailIsLoading: false,
        threadUnreadUpdateKey: 'msg-2',
        userScrollLockActive: false,
      }),
    ).toMatchObject({
      contentChanged: true,
      shouldAutoScroll: false,
      shouldMarkUnread: true,
      unreadKeyChanged: true,
    })
  })

  it('does not mark unread for detached content changes that are not new messages', () => {
    expect(
      resolveThreadViewportAutoScrollChange({
        displayedTurnsLength: 3,
        pendingThreadOpenThreadId: null,
        pinnedToLatest: false,
        previousThreadContentKey: 'thread-1|before',
        previousThreadUnreadKey: 'msg-1',
        selectedThreadId: 'thread-1',
        shouldFollowThread: false,
        threadContentKey: 'thread-1|after',
        threadDetailIsLoading: false,
        threadUnreadUpdateKey: 'msg-1',
        userScrollLockActive: false,
      }),
    ).toMatchObject({
      contentChanged: true,
      shouldAutoScroll: false,
      shouldMarkUnread: false,
      unreadKeyChanged: false,
    })
  })

  it('auto-scrolls the first populated paint when a thread opens', () => {
    expect(
      resolveThreadViewportAutoScrollChange({
        displayedTurnsLength: 1,
        pendingThreadOpenThreadId: 'thread-1',
        pinnedToLatest: false,
        previousThreadContentKey: '',
        previousThreadUnreadKey: '',
        selectedThreadId: 'thread-1',
        shouldFollowThread: false,
        threadContentKey: 'thread-1|after',
        threadDetailIsLoading: true,
        threadUnreadUpdateKey: 'msg-1',
        userScrollLockActive: false,
      }),
    ).toMatchObject({
      contentChanged: true,
      shouldAutoScroll: true,
      shouldMarkUnread: false,
      unreadKeyChanged: true,
    })
  })

  it('keeps the viewport pinned when layout changes reduce scrollTop but it is still near the bottom', () => {
    expect(
      resolveThreadViewportPinnedState({
        clientHeight: 500,
        currentScrollTop: 640,
        currentlyPinned: true,
        manuallyDetachedFromLatest: false,
        previousScrollTop: 700,
        scrollHeight: 1_200,
      }),
    ).toMatchObject({
      isPinnedToLatest: true,
      shouldFollowThread: true,
      shouldResetUnread: true,
    })
  })

  it('detaches only after the viewport is actually no longer near the latest content', () => {
    expect(
      resolveThreadViewportPinnedState({
        clientHeight: 500,
        currentScrollTop: 520,
        currentlyPinned: true,
        manuallyDetachedFromLatest: false,
        previousScrollTop: 700,
        scrollHeight: 1_200,
      }),
    ).toMatchObject({
      isPinnedToLatest: false,
      shouldFollowThread: false,
      shouldResetUnread: false,
    })
  })

  it('uses a wider threshold while already pinned to latest', () => {
    expect(computeThreadPinnedToLatest(604, 1_200, 500, true)).toBe(true)
    expect(computeThreadPinnedToLatest(604, 1_200, 500, false)).toBe(false)
  })
})
