import { isViewportNearBottom } from '../threadPageUtils'
import { didThreadContentChange } from './threadContentSignature'
import type { ThreadContentSignature } from './threadContentSignature'

const THREAD_VIEWPORT_ENTER_PIN_THRESHOLD_PX = 12
const THREAD_VIEWPORT_EXIT_PIN_THRESHOLD_PX = 96
const THREAD_VIEWPORT_SCROLL_NOOP_THRESHOLD_PX = 1
const THREAD_VIEWPORT_SCROLL_RETRY_MS = 32
const THREAD_VIEWPORT_CONTENT_FOLLOW_THROTTLE_MS = 48
const THREAD_VIEWPORT_THROTTLED_FOLLOW_SOURCES = new Set([
  'content-change-follow',
  'content-layout-follow',
])

export type ThreadViewportProgrammaticScrollPolicy =
  | 'follow-latest'
  | 'preserve-position'

export type ResolveThreadViewportAutoScrollChangeInput = {
  displayedTurnsLength: number
  pendingThreadOpenThreadId: string | null
  pinnedToLatest: boolean
  previousThreadContentSignature: ThreadContentSignature | null
  previousThreadUnreadKey: string
  selectedThreadId?: string
  shouldFollowThread: boolean
  threadDetailIsLoading: boolean
  threadContentSignature: ThreadContentSignature
  threadUnreadUpdateKey: string
  userScrollLockActive: boolean
}

export function resolveThreadViewportAutoScrollChange({
  displayedTurnsLength,
  pendingThreadOpenThreadId,
  pinnedToLatest,
  previousThreadContentSignature,
  previousThreadUnreadKey,
  selectedThreadId,
  shouldFollowThread,
  threadDetailIsLoading,
  threadContentSignature,
  threadUnreadUpdateKey,
  userScrollLockActive,
}: ResolveThreadViewportAutoScrollChangeInput) {
  const contentChanged = didThreadContentChange(
    previousThreadContentSignature,
    threadContentSignature,
  )
  const unreadKeyChanged =
    Boolean(threadUnreadUpdateKey) && previousThreadUnreadKey !== threadUnreadUpdateKey

  if (!selectedThreadId || (!contentChanged && !unreadKeyChanged)) {
    return {
      contentChanged,
      shouldAutoScroll: false,
      shouldMarkUnread: false,
      unreadKeyChanged,
    }
  }

  const isInitialPaintForThread = previousThreadContentSignature === null
  const shouldAutoScrollForThreadOpen =
    pendingThreadOpenThreadId === selectedThreadId &&
    (!threadDetailIsLoading || displayedTurnsLength > 0)
  const shouldAutoScrollForContentChange =
    (contentChanged || unreadKeyChanged) && (shouldFollowThread || pinnedToLatest)
  const shouldAutoScroll =
    !userScrollLockActive &&
    (shouldAutoScrollForThreadOpen || isInitialPaintForThread || shouldAutoScrollForContentChange)

  return {
    contentChanged,
    shouldAutoScroll,
    shouldMarkUnread: unreadKeyChanged && !shouldAutoScroll,
    unreadKeyChanged,
  }
}

export type ResolveThreadViewportPinnedStateInput = {
  clientHeight: number
  currentScrollTop: number
  currentlyPinned: boolean
  manuallyDetachedFromLatest: boolean
  previousScrollTop: number
  scrollHeight: number
}

export function resolveThreadViewportPinnedState({
  clientHeight,
  currentScrollTop,
  currentlyPinned,
  manuallyDetachedFromLatest,
  previousScrollTop,
  scrollHeight,
}: ResolveThreadViewportPinnedStateInput) {
  const scrollDelta = currentScrollTop - previousScrollTop
  const pinnedToLatest = isViewportNearBottom(
    currentScrollTop,
    scrollHeight,
    clientHeight,
    currentlyPinned
      ? THREAD_VIEWPORT_EXIT_PIN_THRESHOLD_PX
      : THREAD_VIEWPORT_ENTER_PIN_THRESHOLD_PX,
  )

  if (pinnedToLatest) {
    if (!manuallyDetachedFromLatest || scrollDelta > 0) {
      return {
        isPinnedToLatest: true,
        shouldFollowThread: true,
        shouldResetUnread: true,
      }
    }

    return {
      isPinnedToLatest: false,
      shouldFollowThread: false,
      shouldResetUnread: false,
    }
  }

  return {
    isPinnedToLatest: false,
    shouldFollowThread: false,
    shouldResetUnread: false,
  }
}

export function computeThreadPinnedToLatest(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  currentlyPinned: boolean,
) {
  return isViewportNearBottom(
    scrollTop,
    scrollHeight,
    clientHeight,
    currentlyPinned
      ? THREAD_VIEWPORT_EXIT_PIN_THRESHOLD_PX
      : THREAD_VIEWPORT_ENTER_PIN_THRESHOLD_PX,
  )
}

export function resolveThreadViewportScrollDeferState({
  isThreadViewportInteracting,
  nowMs,
  policy,
  userScrollLockUntilMs,
}: ResolveThreadViewportScrollDeferStateInput) {
  if (isThreadViewportInteracting) {
    return {
      delayMs: THREAD_VIEWPORT_SCROLL_RETRY_MS,
      shouldDefer: true,
    }
  }

  if (policy === 'preserve-position') {
    return {
      delayMs: 0,
      shouldDefer: false,
    }
  }

  const remainingUserScrollLockMs = userScrollLockUntilMs - nowMs
  if (remainingUserScrollLockMs > 0) {
    return {
      delayMs: Math.max(THREAD_VIEWPORT_SCROLL_RETRY_MS, remainingUserScrollLockMs),
      shouldDefer: true,
    }
  }

  return {
    delayMs: 0,
    shouldDefer: false,
  }
}

export type ResolveThreadViewportScrollExecutionInput = {
  clientHeight: number
  currentScrollTop: number
  requestedTargetTop: number
  scrollHeight: number
}

export function resolveThreadViewportScrollExecution({
  clientHeight,
  currentScrollTop,
  requestedTargetTop,
  scrollHeight,
}: ResolveThreadViewportScrollExecutionInput) {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  const nextTargetTop = Math.min(Math.max(0, requestedTargetTop), maxScrollTop)

  return {
    nextTargetTop,
    shouldScroll:
      Math.abs(nextTargetTop - currentScrollTop) > THREAD_VIEWPORT_SCROLL_NOOP_THRESHOLD_PX,
  }
}

export function shouldCoalesceThreadViewportScheduledFrame({
  nextTaskBehavior,
  nextTaskPolicy,
  pendingTaskBehavior,
  pendingTaskPolicy,
}: {
  nextTaskBehavior: ScrollBehavior
  nextTaskPolicy: ThreadViewportProgrammaticScrollPolicy
  pendingTaskBehavior: ScrollBehavior | null
  pendingTaskPolicy: ThreadViewportProgrammaticScrollPolicy | null
}) {
  return (
    pendingTaskPolicy === 'follow-latest' &&
    nextTaskPolicy === 'follow-latest' &&
    pendingTaskBehavior === 'auto' &&
    nextTaskBehavior === 'auto'
  )
}

export function resolveThreadViewportContentFollowThrottleState({
  lastAutoFollowScrollAtMs,
  nowMs,
  policy,
  source,
}: {
  lastAutoFollowScrollAtMs: number
  nowMs: number
  policy: ThreadViewportProgrammaticScrollPolicy
  source: string
}) {
  if (
    policy !== 'follow-latest' ||
    !THREAD_VIEWPORT_THROTTLED_FOLLOW_SOURCES.has(source)
  ) {
    return {
      delayMs: 0,
      shouldDefer: false,
    }
  }

  const remainingThrottleMs =
    lastAutoFollowScrollAtMs + THREAD_VIEWPORT_CONTENT_FOLLOW_THROTTLE_MS - nowMs

  if (remainingThrottleMs <= 0) {
    return {
      delayMs: 0,
      shouldDefer: false,
    }
  }

  return {
    delayMs: remainingThrottleMs,
    shouldDefer: true,
  }
}

export type ResolveThreadViewportScrollDeferStateInput = {
  isThreadViewportInteracting: boolean
  nowMs: number
  policy: ThreadViewportProgrammaticScrollPolicy
  userScrollLockUntilMs: number
}

export type ResolveOlderTurnsRestoreTargetInput = {
  anchorScrollHeight: number
  anchorScrollTop: number
  currentScrollHeight: number
}

export function resolveOlderTurnsRestoreTarget({
  anchorScrollHeight,
  anchorScrollTop,
  currentScrollHeight,
}: ResolveOlderTurnsRestoreTargetInput) {
  const scrollHeightDelta = currentScrollHeight - anchorScrollHeight
  if (scrollHeightDelta <= 0) {
    return null
  }

  return anchorScrollTop + scrollHeightDelta
}
