import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { isViewportNearBottom } from '../threadPageUtils'

const MIN_THREAD_BOTTOM_CLEARANCE_PX = 96
const DEFAULT_THREAD_BOTTOM_CLEARANCE_PX = 180
const THREAD_BOTTOM_CLEARANCE_GAP_PX = 16

export function useThreadViewportState({
  displayedTurnsLength,
  selectedThreadId,
  settledMessageAutoScrollKey,
  threadContentKey,
  threadDetailIsLoading,
}: {
  displayedTurnsLength: number
  selectedThreadId?: string
  settledMessageAutoScrollKey: string
  threadContentKey: string
  threadDetailIsLoading: boolean
}) {
  const [hasUnreadThreadUpdates, setHasUnreadThreadUpdates] = useState(false)
  const [isThreadPinnedToLatest, setIsThreadPinnedToLatest] = useState(true)
  const [threadBottomClearancePx, setThreadBottomClearancePx] = useState(
    DEFAULT_THREAD_BOTTOM_CLEARANCE_PX,
  )

  const threadViewportRef = useRef<HTMLDivElement | null>(null)
  const composerDockRef = useRef<HTMLFormElement | null>(null)
  const threadContentKeyRef = useRef('')
  const threadSettledMessageKeyRef = useRef('')
  const shouldFollowThreadRef = useRef(true)
  const pendingThreadOpenScrollRef = useRef<string | null>(null)

  const threadLogStyle = useMemo(
    () =>
      ({
        '--thread-bottom-clearance': `${threadBottomClearancePx}px`,
      }) as CSSProperties,
    [threadBottomClearancePx],
  )

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
    const composerDock = composerDockRef.current
    if (!composerDock) {
      return
    }

    const updateThreadBottomClearance = () => {
      const nextClearance = Math.max(
        MIN_THREAD_BOTTOM_CLEARANCE_PX,
        Math.ceil(composerDock.getBoundingClientRect().height) + THREAD_BOTTOM_CLEARANCE_GAP_PX,
      )

      setThreadBottomClearancePx((current) =>
        current === nextClearance ? current : nextClearance,
      )
    }

    updateThreadBottomClearance()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      updateThreadBottomClearance()
    })

    observer.observe(composerDock)

    return () => observer.disconnect()
  }, [])

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
    composerDockRef,
    handleJumpToLatest,
    handleThreadViewportScroll,
    hasUnreadThreadUpdates,
    isThreadPinnedToLatest,
    scrollThreadToLatest,
    threadLogStyle,
    threadViewportRef,
  }
}
