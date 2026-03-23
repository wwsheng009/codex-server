import { isViewportNearBottom } from '../threadPageUtils'
import { didThreadContentChange } from './threadContentSignature'
import type { ThreadContentSignature } from './threadContentSignature'

const THREAD_VIEWPORT_ENTER_PIN_THRESHOLD_PX = 12
const THREAD_VIEWPORT_EXIT_PIN_THRESHOLD_PX = 96

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
