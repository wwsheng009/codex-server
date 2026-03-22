import { isViewportNearBottom } from '../threadPageUtils'

const THREAD_VIEWPORT_ENTER_PIN_THRESHOLD_PX = 12
const THREAD_VIEWPORT_EXIT_PIN_THRESHOLD_PX = 96

export type ResolveThreadViewportAutoScrollChangeInput = {
  displayedTurnsLength: number
  pendingThreadOpenThreadId: string | null
  pinnedToLatest: boolean
  previousThreadContentKey: string
  previousThreadUnreadKey: string
  selectedThreadId?: string
  shouldFollowThread: boolean
  threadDetailIsLoading: boolean
  threadContentKey: string
  threadUnreadUpdateKey: string
  userScrollLockActive: boolean
}

export function resolveThreadViewportAutoScrollChange({
  displayedTurnsLength,
  pendingThreadOpenThreadId,
  pinnedToLatest,
  previousThreadContentKey,
  previousThreadUnreadKey,
  selectedThreadId,
  shouldFollowThread,
  threadDetailIsLoading,
  threadContentKey,
  threadUnreadUpdateKey,
  userScrollLockActive,
}: ResolveThreadViewportAutoScrollChangeInput) {
  const contentChanged = previousThreadContentKey !== threadContentKey
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

  const isInitialPaintForThread = !previousThreadContentKey
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
