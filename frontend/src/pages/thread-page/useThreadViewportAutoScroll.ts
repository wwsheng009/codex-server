import { useEffect, useRef, useState } from 'react'

import {
  computeThreadPinnedToLatest,
  resolveThreadViewportAutoScrollChange,
  resolveThreadViewportPinnedState,
} from './threadViewportAutoScrollUtils'
import type { ThreadViewportAutoScrollInput } from './threadViewportTypes'

const THREAD_VIEWPORT_INTERACTION_LOCK_MS = 220

export function useThreadViewportAutoScroll({
  displayedTurnsLength,
  selectedThreadId,
  threadBottomClearancePx,
  threadContentKey,
  threadUnreadUpdateKey,
  threadDetailIsLoading,
}: ThreadViewportAutoScrollInput) {
  const [hasUnreadThreadUpdates, setHasUnreadThreadUpdates] = useState(false)
  const [isThreadPinnedToLatest, setIsThreadPinnedToLatest] = useState(true)
  const [isThreadViewportInteracting, setIsThreadViewportInteracting] = useState(false)

  const threadViewportRef = useRef<HTMLDivElement | null>(null)
  const threadContentKeyRef = useRef('')
  const threadUnreadUpdateKeyRef = useRef('')
  const threadBottomClearancePxRef = useRef<number | null>(null)
  const pendingAutoScrollFrameRef = useRef<number | null>(null)
  const pendingBottomClearanceAutoScrollRef = useRef(false)
  const pendingThreadOpenSettleFrameRef = useRef<number | null>(null)
  const lastViewportScrollTopRef = useRef(0)
  const touchStartYRef = useRef<number | null>(null)
  const manuallyDetachedFromLatestRef = useRef(false)
  const userScrollLockUntilRef = useRef(0)
  const viewportInteractionTimeoutRef = useRef<number | null>(null)
  const shouldFollowThreadRef = useRef(true)
  const pendingThreadOpenScrollRef = useRef<string | null>(null)

  function scrollThreadViewportToBottom(behavior: ScrollBehavior = 'auto') {
    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior,
    })

    if (behavior === 'auto') {
      lastViewportScrollTopRef.current = viewport.scrollTop
    }
  }

  function cancelPendingAutoScrollFrame() {
    if (pendingAutoScrollFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingAutoScrollFrameRef.current)
    pendingAutoScrollFrameRef.current = null
  }

  function cancelPendingThreadOpenSettleFrame() {
    if (pendingThreadOpenSettleFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingThreadOpenSettleFrameRef.current)
    pendingThreadOpenSettleFrameRef.current = null
  }

  function stopViewportAutoScrollAnimation() {
    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTo({
      top: viewport.scrollTop,
      behavior: 'auto',
    })
  }

  function markUserScrollIntent(releaseFollow = false) {
    userScrollLockUntilRef.current = Date.now() + 600
    cancelPendingAutoScrollFrame()
    cancelPendingThreadOpenSettleFrame()
    stopViewportAutoScrollAnimation()

    if (releaseFollow) {
      manuallyDetachedFromLatestRef.current = true
      shouldFollowThreadRef.current = false
      setIsThreadPinnedToLatest(false)
    }
  }

  function markViewportInteraction() {
    if (!isThreadViewportInteracting) {
      setIsThreadViewportInteracting(true)
    }

    if (viewportInteractionTimeoutRef.current !== null) {
      window.clearTimeout(viewportInteractionTimeoutRef.current)
    }

    viewportInteractionTimeoutRef.current = window.setTimeout(() => {
      viewportInteractionTimeoutRef.current = null
      setIsThreadViewportInteracting(false)
    }, THREAD_VIEWPORT_INTERACTION_LOCK_MS)
  }

  function scheduleScrollThreadViewportToBottom(
    behavior: ScrollBehavior,
    onAfterScroll?: () => void,
  ) {
    cancelPendingAutoScrollFrame()
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null
      scrollThreadViewportToBottom(behavior)
      onAfterScroll?.()
    })
  }

  function finalizeThreadOpenScroll(nextSelectedThreadId: string) {
    cancelPendingThreadOpenSettleFrame()
    scheduleScrollThreadViewportToBottom('auto', () => {
      const settleStartMs = performance.now()
      let pinnedSinceMs: number | null = null

      const settleToBottom = () => {
        if (pendingThreadOpenScrollRef.current !== nextSelectedThreadId) {
          return
        }

        scrollThreadViewportToBottom('auto')

        const viewport = threadViewportRef.current
        const pinnedToLatest = viewport
          ? computeThreadPinnedToLatest(
              viewport.scrollTop,
              viewport.scrollHeight,
              viewport.clientHeight,
              true,
            )
          : true

        const nowMs = performance.now()
        if (pinnedToLatest) {
          pinnedSinceMs = pinnedSinceMs ?? nowMs
        } else {
          pinnedSinceMs = null
        }

        const stableAtBottom =
          pinnedSinceMs !== null && nowMs - pinnedSinceMs >= 240
        const exceededSettleBudget = nowMs - settleStartMs >= 2_000
        if (stableAtBottom || exceededSettleBudget) {
          pendingThreadOpenScrollRef.current = null
          pendingThreadOpenSettleFrameRef.current = null
          return
        }

        pendingThreadOpenSettleFrameRef.current = window.requestAnimationFrame(settleToBottom)
      }

      pendingThreadOpenSettleFrameRef.current = window.requestAnimationFrame(settleToBottom)
    })
  }

  useEffect(() => {
    pendingThreadOpenScrollRef.current = selectedThreadId ?? null
    cancelPendingAutoScrollFrame()
    lastViewportScrollTopRef.current = 0
    touchStartYRef.current = null
    manuallyDetachedFromLatestRef.current = false
    userScrollLockUntilRef.current = 0
    if (viewportInteractionTimeoutRef.current !== null) {
      window.clearTimeout(viewportInteractionTimeoutRef.current)
      viewportInteractionTimeoutRef.current = null
    }
    cancelPendingThreadOpenSettleFrame()
    shouldFollowThreadRef.current = true
    threadContentKeyRef.current = ''
    threadUnreadUpdateKeyRef.current = ''
    threadBottomClearancePxRef.current = null
    pendingBottomClearanceAutoScrollRef.current = false
    setHasUnreadThreadUpdates(false)
    setIsThreadPinnedToLatest(true)
    setIsThreadViewportInteracting(false)

    if (!selectedThreadId) {
      return
    }

    scheduleScrollThreadViewportToBottom('auto')

    return () => cancelPendingAutoScrollFrame()
  }, [selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId) {
      threadContentKeyRef.current = ''
      threadUnreadUpdateKeyRef.current = ''
      threadBottomClearancePxRef.current = null
      pendingBottomClearanceAutoScrollRef.current = false
      return
    }

    const viewport = threadViewportRef.current
    const pinnedToLatest = viewport
      ? computeThreadPinnedToLatest(
          viewport.scrollTop,
          viewport.scrollHeight,
          viewport.clientHeight,
          shouldFollowThreadRef.current && !manuallyDetachedFromLatestRef.current,
        )
      : true

    const userScrollLockActive = Date.now() < userScrollLockUntilRef.current
    const change = resolveThreadViewportAutoScrollChange({
      displayedTurnsLength,
      pendingThreadOpenThreadId: pendingThreadOpenScrollRef.current,
      pinnedToLatest,
      previousThreadContentKey: threadContentKeyRef.current,
      previousThreadUnreadKey: threadUnreadUpdateKeyRef.current,
      selectedThreadId,
      shouldFollowThread: shouldFollowThreadRef.current,
      threadContentKey,
      threadDetailIsLoading,
      threadUnreadUpdateKey,
      userScrollLockActive,
    })

    if (!change.contentChanged && !change.unreadKeyChanged) {
      return
    }

    threadContentKeyRef.current = threadContentKey
    threadUnreadUpdateKeyRef.current = threadUnreadUpdateKey

    if (change.shouldAutoScroll) {
      shouldFollowThreadRef.current = true
      setHasUnreadThreadUpdates(false)
      setIsThreadPinnedToLatest(true)

      scheduleScrollThreadViewportToBottom('auto')

      return () => cancelPendingAutoScrollFrame()
    }

    if (change.shouldMarkUnread) {
      setHasUnreadThreadUpdates(true)
    }
  }, [
    displayedTurnsLength,
    selectedThreadId,
    threadContentKey,
    threadUnreadUpdateKey,
    threadDetailIsLoading,
  ])

  useEffect(() => {
    if (
      !selectedThreadId ||
      pendingThreadOpenScrollRef.current !== selectedThreadId ||
      threadDetailIsLoading ||
      displayedTurnsLength === 0 ||
      Date.now() < userScrollLockUntilRef.current ||
      isThreadViewportInteracting
    ) {
      return
    }

    finalizeThreadOpenScroll(selectedThreadId)

    return () => cancelPendingAutoScrollFrame()
  }, [
    displayedTurnsLength,
    isThreadViewportInteracting,
    selectedThreadId,
    threadDetailIsLoading,
    threadContentKey,
  ])

  useEffect(() => {
    if (!selectedThreadId) {
      return
    }

    const previousBottomClearancePx = threadBottomClearancePxRef.current
    threadBottomClearancePxRef.current = threadBottomClearancePx

    if (
      previousBottomClearancePx === null ||
      previousBottomClearancePx === threadBottomClearancePx ||
      !shouldFollowThreadRef.current
    ) {
      return
    }

    pendingBottomClearanceAutoScrollRef.current = true

    if (
      Date.now() < userScrollLockUntilRef.current ||
      isThreadViewportInteracting
    ) {
      return
    }

    pendingBottomClearanceAutoScrollRef.current = false
    scheduleScrollThreadViewportToBottom('auto')

    return () => cancelPendingAutoScrollFrame()
  }, [isThreadViewportInteracting, selectedThreadId, threadBottomClearancePx])

  useEffect(() => {
    if (
      !selectedThreadId ||
      !pendingBottomClearanceAutoScrollRef.current ||
      !shouldFollowThreadRef.current ||
      Date.now() < userScrollLockUntilRef.current ||
      isThreadViewportInteracting
    ) {
      return
    }

    pendingBottomClearanceAutoScrollRef.current = false
    scheduleScrollThreadViewportToBottom('auto')

    return () => cancelPendingAutoScrollFrame()
  }, [isThreadViewportInteracting, selectedThreadId])

  useEffect(() => {
    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    function handleWheel(event: WheelEvent) {
      markViewportInteraction()
      if (event.deltaY < -2) {
        markUserScrollIntent(true)
        return
      }

      if (event.deltaY > 2 && !shouldFollowThreadRef.current) {
        markUserScrollIntent(false)
      }
    }

    function handleTouchStart(event: TouchEvent) {
      markViewportInteraction()
      touchStartYRef.current = event.touches[0]?.clientY ?? null
    }

    function handleTouchMove(event: TouchEvent) {
      markViewportInteraction()
      const currentY = event.touches[0]?.clientY
      const startY = touchStartYRef.current
      if (typeof currentY !== 'number' || typeof startY !== 'number') {
        return
      }

      const delta = currentY - startY
      if (delta > 3) {
        markUserScrollIntent(true)
      } else if (delta < -3 && !shouldFollowThreadRef.current) {
        markUserScrollIntent(false)
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: true })
    viewport.addEventListener('touchstart', handleTouchStart, { passive: true })
    viewport.addEventListener('touchmove', handleTouchMove, { passive: true })

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('touchstart', handleTouchStart)
      viewport.removeEventListener('touchmove', handleTouchMove)
    }
  }, [selectedThreadId])

  function syncThreadViewportState() {
    const viewport = threadViewportRef.current
    if (!viewport) {
      lastViewportScrollTopRef.current = 0
      shouldFollowThreadRef.current = true
      setHasUnreadThreadUpdates(false)
      setIsThreadPinnedToLatest(true)
      return true
    }

    markViewportInteraction()

    const currentScrollTop = viewport.scrollTop
    const previousScrollTop = lastViewportScrollTopRef.current
    lastViewportScrollTopRef.current = currentScrollTop
    const pinnedState = resolveThreadViewportPinnedState({
      clientHeight: viewport.clientHeight,
      currentScrollTop,
      currentlyPinned:
        shouldFollowThreadRef.current && !manuallyDetachedFromLatestRef.current,
      manuallyDetachedFromLatest: manuallyDetachedFromLatestRef.current,
      previousScrollTop,
      scrollHeight: viewport.scrollHeight,
    })

    if (pinnedState.isPinnedToLatest && pinnedState.shouldFollowThread) {
      manuallyDetachedFromLatestRef.current = false
      shouldFollowThreadRef.current = true
      setIsThreadPinnedToLatest(true)
      if (pinnedState.shouldResetUnread) {
        setHasUnreadThreadUpdates(false)
      }
      return true
    }

    shouldFollowThreadRef.current = pinnedState.shouldFollowThread
    setIsThreadPinnedToLatest(pinnedState.isPinnedToLatest)

    return pinnedState.isPinnedToLatest
  }

  function scrollThreadToLatest(behavior: ScrollBehavior = 'smooth') {
    manuallyDetachedFromLatestRef.current = false
    shouldFollowThreadRef.current = true
    cancelPendingThreadOpenSettleFrame()
    setHasUnreadThreadUpdates(false)
    setIsThreadPinnedToLatest(true)
    scheduleScrollThreadViewportToBottom(behavior)
  }

  function handleThreadViewportScroll() {
    syncThreadViewportState()
  }

  function handleJumpToLatest() {
    scrollThreadToLatest('smooth')
  }

  useEffect(
    () => () => {
      cancelPendingAutoScrollFrame()
      cancelPendingThreadOpenSettleFrame()
      if (viewportInteractionTimeoutRef.current !== null) {
        window.clearTimeout(viewportInteractionTimeoutRef.current)
      }
    },
    [],
  )

  return {
    handleJumpToLatest,
    handleThreadViewportScroll,
    hasUnreadThreadUpdates,
    isThreadPinnedToLatest,
    isThreadViewportInteracting,
    scrollThreadToLatest,
    threadViewportRef,
  }
}
