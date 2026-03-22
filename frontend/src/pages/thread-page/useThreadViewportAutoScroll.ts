import { useEffect, useRef, useState } from 'react'

import { isViewportNearBottom } from '../threadPageUtils'
import type { ThreadViewportAutoScrollInput } from './threadViewportTypes'

export function useThreadViewportAutoScroll({
  displayedTurnsLength,
  selectedThreadId,
  settledMessageAutoScrollKey,
  threadBottomClearancePx,
  threadContentKey,
  threadDetailIsLoading,
}: ThreadViewportAutoScrollInput) {
  const [hasUnreadThreadUpdates, setHasUnreadThreadUpdates] = useState(false)
  const [isThreadPinnedToLatest, setIsThreadPinnedToLatest] = useState(true)

  const threadViewportRef = useRef<HTMLDivElement | null>(null)
  const threadContentKeyRef = useRef('')
  const threadSettledMessageKeyRef = useRef('')
  const shouldFollowThreadRef = useRef(true)
  const pendingThreadOpenScrollRef = useRef<string | null>(null)

  function scrollThreadViewportToBottom(behavior: ScrollBehavior = 'smooth') {
    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior,
    })
  }

  useEffect(() => {
    pendingThreadOpenScrollRef.current = selectedThreadId ?? null
    shouldFollowThreadRef.current = true
    threadContentKeyRef.current = ''
    threadSettledMessageKeyRef.current = ''
    setHasUnreadThreadUpdates(false)
    setIsThreadPinnedToLatest(true)

    if (!selectedThreadId) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollThreadViewportToBottom('auto')
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId) {
      threadContentKeyRef.current = ''
      threadSettledMessageKeyRef.current = ''
      return
    }

    const previousContentKey = threadContentKeyRef.current
    if (previousContentKey === threadContentKey) {
      return
    }

    const previousSettledMessageKey = threadSettledMessageKeyRef.current
    const isInitialPaintForThread =
      !previousContentKey || !previousContentKey.startsWith(`${selectedThreadId}|`)
    const shouldAutoScrollForThreadOpen =
      pendingThreadOpenScrollRef.current === selectedThreadId &&
      (!threadDetailIsLoading || displayedTurnsLength > 0)
    const shouldAutoScrollForMessage =
      Boolean(settledMessageAutoScrollKey) &&
      previousSettledMessageKey !== settledMessageAutoScrollKey

    threadContentKeyRef.current = threadContentKey
    threadSettledMessageKeyRef.current = settledMessageAutoScrollKey

    const viewport = threadViewportRef.current
    const pinnedToLatest = viewport
      ? isViewportNearBottom(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight)
      : true

    if (pinnedToLatest) {
      shouldFollowThreadRef.current = true
      setIsThreadPinnedToLatest(true)
    }

    if (
      shouldAutoScrollForThreadOpen ||
      isInitialPaintForThread ||
      (shouldAutoScrollForMessage && (shouldFollowThreadRef.current || pinnedToLatest))
    ) {
      shouldFollowThreadRef.current = true
      setHasUnreadThreadUpdates(false)
      setIsThreadPinnedToLatest(true)

      const frameId = window.requestAnimationFrame(() => {
        if (pendingThreadOpenScrollRef.current === selectedThreadId) {
          pendingThreadOpenScrollRef.current = null
        }
        scrollThreadViewportToBottom(
          shouldAutoScrollForThreadOpen || isInitialPaintForThread ? 'auto' : 'smooth',
        )
      })

      return () => window.cancelAnimationFrame(frameId)
    }

    setHasUnreadThreadUpdates(true)
  }, [
    displayedTurnsLength,
    selectedThreadId,
    settledMessageAutoScrollKey,
    threadContentKey,
    threadDetailIsLoading,
  ])

  useEffect(() => {
    if (!selectedThreadId || !shouldFollowThreadRef.current) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollThreadViewportToBottom('auto')
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectedThreadId, threadBottomClearancePx])

  function syncThreadViewportState() {
    const viewport = threadViewportRef.current
    if (!viewport) {
      shouldFollowThreadRef.current = true
      setHasUnreadThreadUpdates(false)
      setIsThreadPinnedToLatest(true)
      return true
    }

    const pinnedToLatest = isViewportNearBottom(
      viewport.scrollTop,
      viewport.scrollHeight,
      viewport.clientHeight,
    )

    shouldFollowThreadRef.current = pinnedToLatest
    setIsThreadPinnedToLatest(pinnedToLatest)

    if (pinnedToLatest) {
      setHasUnreadThreadUpdates(false)
    }

    return pinnedToLatest
  }

  function scrollThreadToLatest(behavior: ScrollBehavior = 'smooth') {
    shouldFollowThreadRef.current = true
    setHasUnreadThreadUpdates(false)
    setIsThreadPinnedToLatest(true)
    window.requestAnimationFrame(() => {
      scrollThreadViewportToBottom(behavior)
    })
  }

  function handleThreadViewportScroll() {
    syncThreadViewportState()
  }

  function handleJumpToLatest() {
    scrollThreadToLatest('smooth')
  }

  return {
    handleJumpToLatest,
    handleThreadViewportScroll,
    hasUnreadThreadUpdates,
    isThreadPinnedToLatest,
    scrollThreadToLatest,
    threadViewportRef,
  }
}
