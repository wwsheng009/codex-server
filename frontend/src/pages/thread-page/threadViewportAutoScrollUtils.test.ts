import { describe, expect, it } from 'vitest'

import { buildThreadContentSignature } from './threadContentSignature'
import {
  computeThreadPinnedToLatest,
  resolveOlderTurnsRestoreTarget,
  resolveThreadViewportAutoScrollChange,
  resolveThreadViewportContentFollowThrottleState,
  resolveThreadViewportPinnedState,
  resolveThreadViewportScrollExecution,
  resolveThreadViewportScrollDeferState,
  shouldCoalesceThreadViewportScheduledFrame,
} from './threadViewportAutoScrollUtils'

function buildTestThreadContentSignature(suffix: string) {
  return buildThreadContentSignature({
    latestRenderableItemKey: `renderable-${suffix}`,
    latestTurnId: `turn-${suffix}`,
    latestTurnStatus: 'completed',
    pendingPhase: '',
    pendingTurnId: '',
    selectedThreadId: 'thread-1',
    timelineItemCount: 3,
    turnCount: 1,
  })
}

describe('resolveThreadViewportAutoScrollChange', () => {
  it('auto-scrolls followed content changes without marking unread', () => {
    expect(
      resolveThreadViewportAutoScrollChange({
        displayedTurnsLength: 3,
        pendingThreadOpenThreadId: null,
        pinnedToLatest: true,
        previousThreadContentSignature: buildTestThreadContentSignature('before'),
        previousThreadUnreadKey: 'msg-1',
        selectedThreadId: 'thread-1',
        shouldFollowThread: true,
        threadContentSignature: buildTestThreadContentSignature('after'),
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
        previousThreadContentSignature: buildTestThreadContentSignature('before'),
        previousThreadUnreadKey: 'msg-1',
        selectedThreadId: 'thread-1',
        shouldFollowThread: false,
        threadContentSignature: buildTestThreadContentSignature('after'),
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
        previousThreadContentSignature: buildTestThreadContentSignature('before'),
        previousThreadUnreadKey: 'msg-1',
        selectedThreadId: 'thread-1',
        shouldFollowThread: false,
        threadContentSignature: buildTestThreadContentSignature('after'),
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
        previousThreadContentSignature: null,
        previousThreadUnreadKey: '',
        selectedThreadId: 'thread-1',
        shouldFollowThread: false,
        threadContentSignature: buildTestThreadContentSignature('after'),
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

  it('treats structurally identical signatures as unchanged', () => {
    expect(
      resolveThreadViewportAutoScrollChange({
        displayedTurnsLength: 1,
        pendingThreadOpenThreadId: null,
        pinnedToLatest: true,
        previousThreadContentSignature: buildTestThreadContentSignature('same'),
        previousThreadUnreadKey: 'msg-1',
        selectedThreadId: 'thread-1',
        shouldFollowThread: true,
        threadContentSignature: buildTestThreadContentSignature('same'),
        threadDetailIsLoading: false,
        threadUnreadUpdateKey: 'msg-1',
        userScrollLockActive: false,
      }),
    ).toMatchObject({
      contentChanged: false,
      shouldAutoScroll: false,
      shouldMarkUnread: false,
      unreadKeyChanged: false,
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

  it('defers follow-latest writes while the user scroll lock is active', () => {
    expect(
      resolveThreadViewportScrollDeferState({
        isThreadViewportInteracting: false,
        nowMs: 1_000,
        policy: 'follow-latest',
        userScrollLockUntilMs: 1_150,
      }),
    ).toMatchObject({
      shouldDefer: true,
    })
  })

  it('skips no-op writes when the viewport is already at the clamped bottom target', () => {
    expect(
      resolveThreadViewportScrollExecution({
        clientHeight: 858,
        currentScrollTop: 10_080,
        requestedTargetTop: 10_938,
        scrollHeight: 10_938,
      }),
    ).toEqual({
      nextTargetTop: 10_080,
      shouldScroll: false,
    })
  })

  it('keeps follow-latest writes when content growth moved the actual bottom', () => {
    expect(
      resolveThreadViewportScrollExecution({
        clientHeight: 858,
        currentScrollTop: 10_080,
        requestedTargetTop: 11_120,
        scrollHeight: 11_120,
      }),
    ).toEqual({
      nextTargetTop: 10_262,
      shouldScroll: true,
    })
  })

  it('keeps small but real follow deltas so the viewport can finish reaching bottom', () => {
    expect(
      resolveThreadViewportScrollExecution({
        clientHeight: 858,
        currentScrollTop: 2_475,
        requestedTargetTop: 2_483,
        scrollHeight: 3_341,
      }),
    ).toEqual({
      nextTargetTop: 2_483,
      shouldScroll: true,
    })
  })

  it('coalesces same-frame auto follow requests without affecting other scroll policies', () => {
    expect(
      shouldCoalesceThreadViewportScheduledFrame({
        nextTaskBehavior: 'auto',
        nextTaskPolicy: 'follow-latest',
        pendingTaskBehavior: 'auto',
        pendingTaskPolicy: 'follow-latest',
      }),
    ).toBe(true)

    expect(
      shouldCoalesceThreadViewportScheduledFrame({
        nextTaskBehavior: 'smooth',
        nextTaskPolicy: 'follow-latest',
        pendingTaskBehavior: 'auto',
        pendingTaskPolicy: 'follow-latest',
      }),
    ).toBe(false)

    expect(
      shouldCoalesceThreadViewportScheduledFrame({
        nextTaskBehavior: 'auto',
        nextTaskPolicy: 'preserve-position',
        pendingTaskBehavior: 'auto',
        pendingTaskPolicy: 'follow-latest',
      }),
    ).toBe(false)
  })

  it('throttles only high-frequency content-change follow requests', () => {
    expect(
      resolveThreadViewportContentFollowThrottleState({
        lastAutoFollowScrollAtMs: 1_000,
        nowMs: 1_020,
        policy: 'follow-latest',
        source: 'content-change-follow',
      }),
    ).toEqual({
      delayMs: 28,
      shouldDefer: true,
    })

    expect(
      resolveThreadViewportContentFollowThrottleState({
        lastAutoFollowScrollAtMs: 1_000,
        nowMs: 1_060,
        policy: 'follow-latest',
        source: 'content-change-follow',
      }),
    ).toEqual({
      delayMs: 0,
      shouldDefer: false,
    })

    expect(
      resolveThreadViewportContentFollowThrottleState({
        lastAutoFollowScrollAtMs: 1_000,
        nowMs: 1_020,
        policy: 'follow-latest',
        source: 'content-layout-follow',
      }),
    ).toEqual({
      delayMs: 28,
      shouldDefer: true,
    })

    expect(
      resolveThreadViewportContentFollowThrottleState({
        lastAutoFollowScrollAtMs: 1_000,
        nowMs: 1_020,
        policy: 'follow-latest',
        source: 'jump-to-latest',
      }),
    ).toEqual({
      delayMs: 0,
      shouldDefer: false,
    })
  })

  it('defers position-preserving writes during active user interaction', () => {
    expect(
      resolveThreadViewportScrollDeferState({
        isThreadViewportInteracting: true,
        nowMs: 1_000,
        policy: 'preserve-position',
        userScrollLockUntilMs: 2_000,
      }),
    ).toMatchObject({
      shouldDefer: true,
    })
  })

  it('allows position-preserving writes once interaction has ended', () => {
    expect(
      resolveThreadViewportScrollDeferState({
        isThreadViewportInteracting: false,
        nowMs: 1_000,
        policy: 'preserve-position',
        userScrollLockUntilMs: 2_000,
      }),
    ).toEqual({
      delayMs: 0,
      shouldDefer: false,
    })
  })

  it('restores older-turn anchors using the added scroll height delta', () => {
    expect(
      resolveOlderTurnsRestoreTarget({
        anchorScrollHeight: 1_200,
        anchorScrollTop: 240,
        currentScrollHeight: 1_520,
      }),
    ).toBe(560)
  })

  it('skips older-turn restoration when the scroll height did not grow', () => {
    expect(
      resolveOlderTurnsRestoreTarget({
        anchorScrollHeight: 1_200,
        anchorScrollTop: 240,
        currentScrollHeight: 1_200,
      }),
    ).toBeNull()
  })
})
