import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'

const DEFAULT_ENTRY_OVERSCAN_PX = 1800
const FALLBACK_VIEWPORT_HEIGHT_PX = 720
const RENDER_WINDOW_NEAR_BOTTOM_FREEZE_PX = 480

type VirtualizedConversationEntriesInput<T> = {
  enabled: boolean
  entries: T[]
  estimateEntryHeight: (entry: T) => number
  getEntryKey: (entry: T) => string
  listIdentity: string
  overscanPx?: number
  scrollViewportRef: RefObject<HTMLElement | null>
}

export function useVirtualizedConversationEntries<T>({
  enabled,
  entries,
  estimateEntryHeight,
  getEntryKey,
  listIdentity,
  overscanPx = DEFAULT_ENTRY_OVERSCAN_PX,
  scrollViewportRef,
}: VirtualizedConversationEntriesInput<T>) {
  const entryHeightsRef = useRef<Record<string, number>>({})
  const pendingEntryHeightsRef = useRef<Record<string, number>>({})
  const frameRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const scrollIdleTimeoutRef = useRef<number | null>(null)
  const isUserScrollingRef = useRef(false)
  const [entryHeightsVersion, setEntryHeightsVersion] = useState(0)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [renderWindow, setRenderWindow] = useState<{
    endIndex: number
    paddingBottom: number
    paddingTop: number
    startIndex: number
  } | null>(null)
  const [scrollState, setScrollState] = useState({
    scrollTop: 0,
    viewportHeight: FALLBACK_VIEWPORT_HEIGHT_PX,
  })

  const scheduleHeightsRefresh = useCallback(() => {
    if (frameRef.current !== null || typeof window === 'undefined') {
      return
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      setEntryHeightsVersion((current) => current + 1)
    })
  }, [])

  const registerEntryHeight = useCallback(
    (entryKey: string, nextHeight: number) => {
      if (!nextHeight || !Number.isFinite(nextHeight)) {
        return
      }

      const roundedHeight = Math.max(1, Math.ceil(nextHeight))
      if (
        entryHeightsRef.current[entryKey] === roundedHeight ||
        pendingEntryHeightsRef.current[entryKey] === roundedHeight
      ) {
        return
      }

      if (isUserScrollingRef.current) {
        pendingEntryHeightsRef.current[entryKey] = roundedHeight
        return
      }

      entryHeightsRef.current[entryKey] = roundedHeight
      scheduleHeightsRefresh()
    },
    [scheduleHeightsRefresh],
  )

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
      if (scrollIdleTimeoutRef.current !== null) {
        window.clearTimeout(scrollIdleTimeoutRef.current)
        scrollIdleTimeoutRef.current = null
      }
    }

    entryHeightsRef.current = {}
    pendingEntryHeightsRef.current = {}
    isUserScrollingRef.current = false
    setIsUserScrolling(false)
    setRenderWindow(null)
    setScrollState({
      scrollTop: scrollViewportRef.current?.scrollTop ?? 0,
      viewportHeight: Math.max(
        scrollViewportRef.current?.clientHeight ?? 0,
        FALLBACK_VIEWPORT_HEIGHT_PX,
      ),
    })
    setEntryHeightsVersion((current) => current + 1)
  }, [listIdentity, scrollViewportRef])

  useEffect(() => {
    if (isUserScrolling) {
      return
    }

    const pendingHeights = pendingEntryHeightsRef.current
    const pendingKeys = Object.keys(pendingHeights)
    if (!pendingKeys.length) {
      return
    }

    let changed = false
    for (const entryKey of pendingKeys) {
      const nextHeight = pendingHeights[entryKey]
      if (entryHeightsRef.current[entryKey] === nextHeight) {
        continue
      }

      entryHeightsRef.current[entryKey] = nextHeight
      changed = true
    }

    pendingEntryHeightsRef.current = {}
    if (changed) {
      scheduleHeightsRefresh()
    }
  }, [isUserScrolling, scheduleHeightsRefresh])

  useEffect(
    () => () => {
      if (frameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(frameRef.current)
      }
      if (scrollFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
      if (scrollIdleTimeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(scrollIdleTimeoutRef.current)
      }
      isUserScrollingRef.current = false
    },
    [],
  )

  useEffect(() => {
    if (!enabled) {
      setScrollState({
        scrollTop: 0,
        viewportHeight: FALLBACK_VIEWPORT_HEIGHT_PX,
      })
      return
    }

    const viewport = scrollViewportRef.current
    if (!viewport) {
      return
    }

    const syncViewportState = () => {
      const nextScrollTop = viewport.scrollTop
      const nextViewportHeight = Math.max(
        viewport.clientHeight,
        FALLBACK_VIEWPORT_HEIGHT_PX,
      )

      setScrollState((current) =>
        current.scrollTop === nextScrollTop && current.viewportHeight === nextViewportHeight
          ? current
          : {
              scrollTop: nextScrollTop,
              viewportHeight: nextViewportHeight,
            },
      )
    }

    const updateViewportState = () => {
      if (scrollFrameRef.current !== null || typeof window === 'undefined') {
        return
      }

      if (!isUserScrollingRef.current) {
        isUserScrollingRef.current = true
        setIsUserScrolling(true)
      }
      if (scrollIdleTimeoutRef.current !== null) {
        window.clearTimeout(scrollIdleTimeoutRef.current)
      }
      scrollIdleTimeoutRef.current = window.setTimeout(() => {
        scrollIdleTimeoutRef.current = null
        isUserScrollingRef.current = false
        setIsUserScrolling(false)
      }, 140)

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null
        syncViewportState()
      })
    }

    syncViewportState()
    viewport.addEventListener('scroll', updateViewportState, { passive: true })

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        viewport.removeEventListener('scroll', updateViewportState)
      }
    }

    const observer = new ResizeObserver(() => {
      updateViewportState()
    })

    observer.observe(viewport)

    return () => {
      viewport.removeEventListener('scroll', updateViewportState)
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
      if (scrollIdleTimeoutRef.current !== null) {
        window.clearTimeout(scrollIdleTimeoutRef.current)
        scrollIdleTimeoutRef.current = null
      }
      observer.disconnect()
    }
  }, [enabled, listIdentity, scrollViewportRef])

  const entryLayout = useMemo(() => {
    const offsets = new Array(entries.length)
    const heights = new Array(entries.length)
    let totalHeight = 0

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const entryKey = getEntryKey(entry)
      const entryHeight =
        entryHeightsRef.current[entryKey] ?? estimateEntryHeight(entry)

      offsets[index] = totalHeight
      heights[index] = entryHeight
      totalHeight += entryHeight
    }

    return {
      offsets,
      heights,
      totalHeight,
    }
  }, [entries, entryHeightsVersion, estimateEntryHeight, getEntryKey])

  const targetRange = useMemo(() => {
    if (!enabled || entries.length === 0) {
      return {
        endIndex: entries.length ? entries.length - 1 : 0,
        isVirtualized: false,
        paddingBottom: 0,
        paddingTop: 0,
        startIndex: 0,
      }
    }

    const effectiveOverscanPx = Math.max(overscanPx, scrollState.viewportHeight)
    const startOffset = Math.max(0, scrollState.scrollTop - effectiveOverscanPx)
    const endOffset =
      scrollState.scrollTop + scrollState.viewportHeight + effectiveOverscanPx
    const startIndex = findConversationEntryIndex(
      entryLayout.offsets,
      entryLayout.heights,
      startOffset,
    )
    const endIndex = findConversationEntryEndIndex(
      entryLayout.offsets,
      entryLayout.heights,
      endOffset,
    )
    const paddingTop = entryLayout.offsets[startIndex] ?? 0
    const lastVisibleBottom =
      (entryLayout.offsets[endIndex] ?? 0) + (entryLayout.heights[endIndex] ?? 0)

    return {
      endIndex,
      isVirtualized: true,
      paddingBottom: Math.max(0, entryLayout.totalHeight - lastVisibleBottom),
      paddingTop,
      startIndex,
    }
  }, [
    enabled,
    entries,
    entryLayout.heights,
    entryLayout.offsets,
    entryLayout.totalHeight,
    overscanPx,
    scrollState.scrollTop,
    scrollState.viewportHeight,
  ])

  useEffect(() => {
    if (!enabled || entries.length === 0) {
      setRenderWindow(null)
      return
    }

    setRenderWindow((current) => {
      if (!current) {
        return {
          endIndex: targetRange.endIndex,
          paddingBottom: targetRange.paddingBottom,
          paddingTop: targetRange.paddingTop,
          startIndex: targetRange.startIndex,
        }
      }

      if (!shouldPreserveExpandedRenderWindow(
        isUserScrolling,
        scrollState.scrollTop,
        entryLayout.totalHeight,
        scrollState.viewportHeight,
      )) {
        return {
          endIndex: targetRange.endIndex,
          paddingBottom: targetRange.paddingBottom,
          paddingTop: targetRange.paddingTop,
          startIndex: targetRange.startIndex,
        }
      }

      const nextStartIndex = Math.min(current.startIndex, targetRange.startIndex)
      const nextEndIndex = Math.max(current.endIndex, targetRange.endIndex)
      const nextPaddingTop = entryLayout.offsets[nextStartIndex] ?? 0
      const nextVisibleBottom =
        (entryLayout.offsets[nextEndIndex] ?? 0) + (entryLayout.heights[nextEndIndex] ?? 0)
      const nextPaddingBottom = Math.max(0, entryLayout.totalHeight - nextVisibleBottom)

      if (
        current.startIndex === nextStartIndex &&
        current.endIndex === nextEndIndex &&
        current.paddingTop === nextPaddingTop &&
        current.paddingBottom === nextPaddingBottom
      ) {
        return current
      }

      return {
        endIndex: nextEndIndex,
        paddingBottom: nextPaddingBottom,
        paddingTop: nextPaddingTop,
        startIndex: nextStartIndex,
      }
    })
  }, [
    enabled,
    entries.length,
    entryLayout.heights,
    entryLayout.offsets,
    entryLayout.totalHeight,
    isUserScrolling,
    scrollState.scrollTop,
    scrollState.viewportHeight,
    targetRange.endIndex,
    targetRange.paddingBottom,
    targetRange.paddingTop,
    targetRange.startIndex,
  ])

  const activeRange = renderWindow ?? {
    endIndex: targetRange.endIndex,
    paddingBottom: targetRange.paddingBottom,
    paddingTop: targetRange.paddingTop,
    startIndex: targetRange.startIndex,
  }

  return {
    isVirtualized: targetRange.isVirtualized,
    paddingBottom: activeRange.paddingBottom,
    paddingTop: activeRange.paddingTop,
    registerEntryHeight,
    visibleEntries: entries.slice(activeRange.startIndex, activeRange.endIndex + 1),
  }
}

function shouldPreserveExpandedRenderWindow(
  isUserScrolling: boolean,
  scrollTop: number,
  totalHeight: number,
  viewportHeight: number,
) {
  if (isUserScrolling) {
    return true
  }

  return totalHeight - (scrollTop + viewportHeight) <= RENDER_WINDOW_NEAR_BOTTOM_FREEZE_PX
}

function findConversationEntryIndex(
  offsets: number[],
  heights: number[],
  targetOffset: number,
) {
  if (offsets.length === 0) {
    return 0
  }

  let low = 0
  let high = offsets.length - 1

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const entryEnd = offsets[mid] + heights[mid]

    if (entryEnd <= targetOffset) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

function findConversationEntryEndIndex(
  offsets: number[],
  heights: number[],
  targetOffset: number,
) {
  if (offsets.length === 0) {
    return 0
  }

  let low = 0
  let high = offsets.length - 1

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (offsets[mid] < targetOffset) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  while (low < offsets.length - 1 && offsets[low] + heights[low] < targetOffset) {
    low += 1
  }

  return low
}
