import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

const DEFAULT_ENTRY_OVERSCAN_PX = 720
const FALLBACK_VIEWPORT_HEIGHT_PX = 720

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
  const frameRef = useRef<number | null>(null)
  const [entryHeightsVersion, setEntryHeightsVersion] = useState(0)
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
      if (entryHeightsRef.current[entryKey] === roundedHeight) {
        return
      }

      entryHeightsRef.current[entryKey] = roundedHeight
      scheduleHeightsRefresh()
    },
    [scheduleHeightsRefresh],
  )

  useEffect(() => {
    entryHeightsRef.current = {}
    setEntryHeightsVersion((current) => current + 1)
  }, [listIdentity])

  useEffect(
    () => () => {
      if (frameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(frameRef.current)
      }
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

    const updateViewportState = () => {
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

    updateViewportState()
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

  const visibleRange = useMemo(() => {
    if (!enabled || entries.length === 0) {
      return {
        isVirtualized: false,
        paddingBottom: 0,
        paddingTop: 0,
        visibleEntries: entries,
      }
    }

    const startOffset = Math.max(0, scrollState.scrollTop - overscanPx)
    const endOffset =
      scrollState.scrollTop + scrollState.viewportHeight + overscanPx
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
      isVirtualized: true,
      paddingBottom: Math.max(0, entryLayout.totalHeight - lastVisibleBottom),
      paddingTop,
      visibleEntries: entries.slice(startIndex, endIndex + 1),
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

  return {
    isVirtualized: visibleRange.isVirtualized,
    paddingBottom: visibleRange.paddingBottom,
    paddingTop: visibleRange.paddingTop,
    registerEntryHeight,
    visibleEntries: visibleRange.visibleEntries,
  }
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
