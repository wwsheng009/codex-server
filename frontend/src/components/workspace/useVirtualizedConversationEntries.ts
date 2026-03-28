import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { recordConversationScrollDiagnosticEvent } from './threadConversationProfiler'
import type {
  ExpandVirtualizedRenderWindowInput,
  ResolveVirtualizedViewportAnchorOffsetDeltaInput,
  VirtualizedConversationEntriesInput,
  VirtualizedConversationEntryLayout,
  VirtualizedConversationLayoutCacheSnapshot,
  VirtualizedConversationRenderWindow,
  VisibleVirtualizedEntriesSlice,
  WriteVirtualizedConversationLayoutCacheInput,
} from './virtualizedConversationTypes'

const DEFAULT_ENTRY_OVERSCAN_PX = 1800
const FALLBACK_VIEWPORT_HEIGHT_PX = 720
const RENDER_WINDOW_NEAR_BOTTOM_FREEZE_PX = 480
const SCROLLING_RENDER_WINDOW_BUFFER_PX = 960
const VIRTUALIZED_ENTRY_LAYOUT_CACHE_MAX_AGE_MS = 30_000

const virtualizedConversationLayoutCache = new Map<
  string,
  VirtualizedConversationLayoutCacheSnapshot
>()

function cloneVirtualizedConversationEntryHeights(
  entryHeights: Record<string, number>,
) {
  return { ...entryHeights }
}

function readVirtualizedConversationLayoutCache(
  listIdentity: string,
): VirtualizedConversationLayoutCacheSnapshot | null {
  if (!listIdentity) {
    return null
  }

  const cached = virtualizedConversationLayoutCache.get(listIdentity)
  if (!cached) {
    return null
  }

  if (Date.now() - cached.updatedAt > VIRTUALIZED_ENTRY_LAYOUT_CACHE_MAX_AGE_MS) {
    virtualizedConversationLayoutCache.delete(listIdentity)
    return null
  }

  return {
    entryHeights: cloneVirtualizedConversationEntryHeights(cached.entryHeights),
    renderWindow: cached.renderWindow,
    updatedAt: cached.updatedAt,
  }
}

function clampVirtualizedConversationRenderWindow(
  renderWindow: VirtualizedConversationRenderWindow | null,
  entryCount: number,
): VirtualizedConversationRenderWindow | null {
  if (!renderWindow || entryCount <= 0) {
    return null
  }

  const endIndex = Math.min(renderWindow.endIndex, entryCount - 1)
  const startIndex = Math.min(renderWindow.startIndex, endIndex)

  return {
    endIndex,
    paddingBottom: Math.max(0, renderWindow.paddingBottom),
    paddingTop: Math.max(0, renderWindow.paddingTop),
    startIndex,
  }
}

function writeVirtualizedConversationLayoutCache(
  listIdentity: string,
  input: WriteVirtualizedConversationLayoutCacheInput,
) {
  if (!listIdentity) {
    return
  }

  const current = virtualizedConversationLayoutCache.get(listIdentity)
  virtualizedConversationLayoutCache.set(listIdentity, {
    entryHeights:
      input.entryHeights !== undefined
        ? cloneVirtualizedConversationEntryHeights(input.entryHeights)
        : cloneVirtualizedConversationEntryHeights(current?.entryHeights ?? {}),
    renderWindow:
      input.renderWindow !== undefined
        ? input.renderWindow
        : current?.renderWindow ?? null,
    updatedAt: Date.now(),
  })
}

export function useVirtualizedConversationEntries<T>({
  enabled,
  entries,
  estimateEntryHeight,
  freezeLayout = false,
  getEntryKey,
  listIdentity,
  overscanPx = DEFAULT_ENTRY_OVERSCAN_PX,
  scrollViewportRef,
}: VirtualizedConversationEntriesInput<T>) {
  const initialCacheSnapshot = readVirtualizedConversationLayoutCache(listIdentity)
  const entryHeightsRef = useRef<Record<string, number>>(
    initialCacheSnapshot?.entryHeights ?? {},
  )
  const pendingEntryHeightsRef = useRef<Record<string, number>>({})
  const dirtyEntryKeysRef = useRef<Set<string>>(new Set())
  const previousEntryLayoutRef = useRef<VirtualizedConversationEntryLayout<T> | null>(null)
  const previousCommittedEntryLayoutRef = useRef<VirtualizedConversationEntryLayout<T> | null>(null)
  const previousVisibleEntriesRef = useRef<VisibleVirtualizedEntriesSlice<T> | null>(null)
  const previousRangeMetricsRef = useRef<{
    endIndex: number
    paddingBottom: number
    paddingTop: number
    startIndex: number
    totalHeight: number
  } | null>(null)
  const previousTotalHeightRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const scrollIdleTimeoutRef = useRef<number | null>(null)
  const isUserScrollingRef = useRef(false)
  const [entryHeightsVersion, setEntryHeightsVersion] = useState(0)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [renderWindow, setRenderWindow] = useState<VirtualizedConversationRenderWindow | null>(
    clampVirtualizedConversationRenderWindow(initialCacheSnapshot?.renderWindow ?? null, entries.length),
  )
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

      if (freezeLayout) {
        pendingEntryHeightsRef.current[entryKey] = roundedHeight
        return
      }

      entryHeightsRef.current[entryKey] = roundedHeight
      writeVirtualizedConversationLayoutCache(listIdentity, {
        entryHeights: entryHeightsRef.current,
      })
      dirtyEntryKeysRef.current.add(entryKey)
      scheduleHeightsRefresh()
    },
    [freezeLayout, listIdentity, scheduleHeightsRefresh],
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

    const cachedLayout = readVirtualizedConversationLayoutCache(listIdentity)
    entryHeightsRef.current = cachedLayout?.entryHeights ?? {}
    pendingEntryHeightsRef.current = {}
    dirtyEntryKeysRef.current = new Set()
    previousEntryLayoutRef.current = null
    previousCommittedEntryLayoutRef.current = null
    previousVisibleEntriesRef.current = null
    previousRangeMetricsRef.current = null
    previousTotalHeightRef.current = null
    isUserScrollingRef.current = false
    setIsUserScrolling(false)
    setRenderWindow(
      clampVirtualizedConversationRenderWindow(cachedLayout?.renderWindow ?? null, entries.length),
    )
    setScrollState({
      scrollTop: scrollViewportRef.current?.scrollTop ?? 0,
      viewportHeight: Math.max(
        scrollViewportRef.current?.clientHeight ?? 0,
        FALLBACK_VIEWPORT_HEIGHT_PX,
      ),
    })
    setEntryHeightsVersion((current) => current + 1)
  }, [entries.length, listIdentity, scrollViewportRef])

  useEffect(() => {
    if (isUserScrolling || freezeLayout) {
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
      writeVirtualizedConversationLayoutCache(listIdentity, {
        entryHeights: entryHeightsRef.current,
      })
      dirtyEntryKeysRef.current.add(entryKey)
      changed = true
    }

    pendingEntryHeightsRef.current = {}
    if (changed) {
      scheduleHeightsRefresh()
    }
  }, [freezeLayout, isUserScrolling, listIdentity, scheduleHeightsRefresh])

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
    const layout = buildVirtualizedConversationEntryLayout(
      entries,
      getEntryKey,
      estimateEntryHeight,
      entryHeightsRef.current,
      previousEntryLayoutRef.current,
      dirtyEntryKeysRef.current,
    )
    previousEntryLayoutRef.current = layout
    dirtyEntryKeysRef.current = new Set()
    return layout
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

      if (
        current.startIndex === 0 &&
        current.endIndex >= entries.length - 1 &&
        current.paddingTop === 0 &&
        current.paddingBottom === 0
      ) {
        // Once the thread has expanded to a full real-DOM window, keep it stable for this list.
        return current
      }

      if (!shouldPreserveExpandedRenderWindow(
        isUserScrolling || freezeLayout,
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

      const nextWindow = expandVirtualizedRenderWindow({
        current,
        heights: entryLayout.heights,
        isUserScrolling: isUserScrolling || freezeLayout,
        offsets: entryLayout.offsets,
        targetRange,
        totalHeight: entryLayout.totalHeight,
        viewportHeight: scrollState.viewportHeight,
      })

      if (
        current.startIndex === nextWindow.startIndex &&
        current.endIndex === nextWindow.endIndex &&
        current.paddingTop === nextWindow.paddingTop &&
        current.paddingBottom === nextWindow.paddingBottom
      ) {
        return current
      }

      return nextWindow
    })
  }, [
    enabled,
    entries.length,
    entryLayout.heights,
    entryLayout.offsets,
    entryLayout.totalHeight,
    freezeLayout,
    isUserScrolling,
    scrollState.scrollTop,
    scrollState.viewportHeight,
    targetRange.endIndex,
    targetRange.paddingBottom,
    targetRange.paddingTop,
    targetRange.startIndex,
  ])

  useEffect(() => {
    writeVirtualizedConversationLayoutCache(listIdentity, {
      entryHeights: entryHeightsRef.current,
      renderWindow,
    })
  }, [listIdentity, renderWindow])

  const activeRange = renderWindow ?? {
    endIndex: targetRange.endIndex,
    paddingBottom: targetRange.paddingBottom,
    paddingTop: targetRange.paddingTop,
    startIndex: targetRange.startIndex,
  }

  useEffect(() => {
    if (!enabled) {
      previousCommittedEntryLayoutRef.current = null
      return
    }

    const viewport = scrollViewportRef.current
    const previousLayout = previousCommittedEntryLayoutRef.current
    previousCommittedEntryLayoutRef.current = entryLayout

    if (
      !viewport ||
      !shouldApplyVirtualizedViewportAnchorCorrection({
        freezeLayout,
        hasPreviousLayout: Boolean(previousLayout),
        isUserScrolling,
        scrollTop: viewport.scrollTop,
        targetStartIndex: targetRange.startIndex,
        viewportHeight: viewport.clientHeight,
        viewportScrollHeight: viewport.scrollHeight,
        virtualTotalHeight: entryLayout.totalHeight,
      })
    ) {
      return
    }

    const anchorEntry = entries[targetRange.startIndex]
    const offsetDelta = resolveVirtualizedViewportAnchorOffsetDelta({
      anchorEntry,
      getEntryKey,
      nextLayout: entryLayout,
      previousLayout,
    })

    if (!offsetDelta) {
      return
    }

    const nextScrollTop = viewport.scrollTop + offsetDelta
    recordConversationScrollDiagnosticEvent({
      behavior: 'auto',
      clientHeight: viewport.clientHeight,
      kind: 'programmatic-scroll',
      metadata: {
        anchorIndex: targetRange.startIndex,
        offsetDelta,
      },
      scrollHeight: entryLayout.totalHeight,
      scrollTop: viewport.scrollTop,
      source: 'virtualization-anchor-correct',
      targetTop: nextScrollTop,
    })
    viewport.scrollTo({
      top: nextScrollTop,
      behavior: 'auto',
    })
  }, [
    enabled,
    entries,
    entryLayout,
    freezeLayout,
    getEntryKey,
    isUserScrolling,
    scrollState.viewportHeight,
    scrollViewportRef,
    targetRange.startIndex,
  ])

  useEffect(() => {
    if (!enabled) {
      previousTotalHeightRef.current = null
      return
    }

    const previousTotalHeight = previousTotalHeightRef.current
    previousTotalHeightRef.current = entryLayout.totalHeight

    if (previousTotalHeight === null || previousTotalHeight === entryLayout.totalHeight) {
      return
    }

    recordConversationScrollDiagnosticEvent({
      clientHeight: scrollState.viewportHeight,
      kind: 'virtualization-layout',
      metadata: {
        entryCount: entries.length,
        heightVersion: entryHeightsVersion,
        isUserScrolling,
        previousTotalHeight,
        totalHeight: entryLayout.totalHeight,
      },
      scrollHeight: entryLayout.totalHeight,
      scrollTop: scrollState.scrollTop,
      source: 'virtualized-layout',
    })
  }, [
    enabled,
    entries.length,
    entryHeightsVersion,
    entryLayout.totalHeight,
    isUserScrolling,
    scrollState.scrollTop,
    scrollState.viewportHeight,
  ])

  useEffect(() => {
    if (!enabled) {
      previousRangeMetricsRef.current = null
      return
    }

    const nextRangeMetrics = {
      endIndex: activeRange.endIndex,
      paddingBottom: activeRange.paddingBottom,
      paddingTop: activeRange.paddingTop,
      startIndex: activeRange.startIndex,
      totalHeight: entryLayout.totalHeight,
    }
    const previousRangeMetrics = previousRangeMetricsRef.current
    previousRangeMetricsRef.current = nextRangeMetrics

    if (
      previousRangeMetrics &&
      previousRangeMetrics.startIndex === nextRangeMetrics.startIndex &&
      previousRangeMetrics.endIndex === nextRangeMetrics.endIndex &&
      previousRangeMetrics.paddingTop === nextRangeMetrics.paddingTop &&
      previousRangeMetrics.paddingBottom === nextRangeMetrics.paddingBottom &&
      previousRangeMetrics.totalHeight === nextRangeMetrics.totalHeight
    ) {
      return
    }

    recordConversationScrollDiagnosticEvent({
      clientHeight: scrollState.viewportHeight,
      kind: 'virtualization-range',
      metadata: {
        endIndex: activeRange.endIndex,
        entryCount: entries.length,
        isUserScrolling,
        paddingBottom: activeRange.paddingBottom,
        paddingTop: activeRange.paddingTop,
        startIndex: activeRange.startIndex,
        totalHeight: entryLayout.totalHeight,
      },
      scrollHeight: entryLayout.totalHeight,
      scrollTop: scrollState.scrollTop,
      source: 'virtualized-range',
    })
  }, [
    activeRange.endIndex,
    activeRange.paddingBottom,
    activeRange.paddingTop,
    activeRange.startIndex,
    enabled,
    entries.length,
    entryLayout.totalHeight,
    isUserScrolling,
    scrollState.scrollTop,
    scrollState.viewportHeight,
  ])

  const visibleEntries = useMemo(() => {
    const visibleSlice = buildVisibleVirtualizedEntries(
      entries,
      activeRange.startIndex,
      activeRange.endIndex,
      previousVisibleEntriesRef.current,
    )
    previousVisibleEntriesRef.current = visibleSlice
    return visibleSlice.visibleEntries
  }, [activeRange.endIndex, activeRange.startIndex, entries])

  return {
    isVirtualized: targetRange.isVirtualized,
    paddingBottom: activeRange.paddingBottom,
    paddingTop: activeRange.paddingTop,
    registerEntryHeight,
    visibleEntries,
  }
}

export function buildVirtualizedConversationEntryLayout<T>(
  entries: T[],
  getEntryKey: (entry: T) => string,
  estimateEntryHeight: (entry: T) => number,
  entryHeights: Record<string, number>,
  previousLayout?: VirtualizedConversationEntryLayout<T> | null,
  dirtyEntryKeys?: ReadonlySet<string>,
): VirtualizedConversationEntryLayout<T> {
  if (
    previousLayout &&
    previousLayout.entriesRef === entries &&
    dirtyEntryKeys &&
    dirtyEntryKeys.size > 0
  ) {
    let firstDirtyIndex = entries.length
    for (const entryKey of dirtyEntryKeys) {
      const index = previousLayout.keyToIndex.get(entryKey)
      if (typeof index === 'number' && index < firstDirtyIndex) {
        firstDirtyIndex = index
      }
    }

    if (firstDirtyIndex < entries.length) {
      const offsets = previousLayout.offsets.slice()
      const heights = previousLayout.heights.slice()
      let totalHeight = firstDirtyIndex > 0 ? offsets[firstDirtyIndex] : 0

      for (let index = firstDirtyIndex; index < entries.length; index += 1) {
        const entryKey = previousLayout.keys[index]
        const entryHeight = dirtyEntryKeys.has(entryKey)
          ? entryHeights[entryKey] ?? estimateEntryHeight(entries[index])
          : previousLayout.heights[index]

        offsets[index] = totalHeight
        heights[index] = entryHeight
        totalHeight += entryHeight
      }

      return {
        entriesRef: entries,
        heights,
        keyToIndex: previousLayout.keyToIndex,
        keys: previousLayout.keys,
        offsets,
        totalHeight,
      }
    }
  }

  const offsets = new Array(entries.length)
  const heights = new Array(entries.length)
  const keys = new Array<string>(entries.length)
  const keyToIndex = new Map<string, number>()
  let totalHeight = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const entryKey = getEntryKey(entry)
    const entryHeight = entryHeights[entryKey] ?? estimateEntryHeight(entry)

    keys[index] = entryKey
    keyToIndex.set(entryKey, index)
    offsets[index] = totalHeight
    heights[index] = entryHeight
    totalHeight += entryHeight
  }

  return {
    entriesRef: entries,
    heights,
    keyToIndex,
    keys,
    offsets,
    totalHeight,
  }
}

export function buildVisibleVirtualizedEntries<T>(
  entries: T[],
  startIndex: number,
  endIndex: number,
  previousSlice?: VisibleVirtualizedEntriesSlice<T> | null,
): VisibleVirtualizedEntriesSlice<T> {
  if (
    previousSlice &&
    previousSlice.entriesRef === entries &&
    previousSlice.startIndex === startIndex &&
    previousSlice.endIndex === endIndex
  ) {
    return previousSlice
  }

  return {
    endIndex,
    entriesRef: entries,
    startIndex,
    visibleEntries: entries.slice(startIndex, endIndex + 1),
  }
}

export function resolveVirtualizedViewportAnchorOffsetDelta<T>({
  anchorEntry,
  getEntryKey,
  nextLayout,
  previousLayout,
}: ResolveVirtualizedViewportAnchorOffsetDeltaInput<T>) {
  if (!anchorEntry) {
    return 0
  }

  const anchorKey = getEntryKey(anchorEntry)
  const previousIndex = previousLayout.keyToIndex.get(anchorKey)
  const nextIndex = nextLayout.keyToIndex.get(anchorKey)
  if (typeof previousIndex !== 'number' || typeof nextIndex !== 'number') {
    return 0
  }

  const previousOffset = previousLayout.offsets[previousIndex] ?? 0
  const nextOffset = nextLayout.offsets[nextIndex] ?? 0
  return nextOffset - previousOffset
}

export function expandVirtualizedRenderWindow({
  current,
  heights,
  isUserScrolling,
  offsets,
  targetRange,
  totalHeight,
  viewportHeight,
}: ExpandVirtualizedRenderWindowInput): VirtualizedConversationRenderWindow {
  const effectiveBufferPx = isUserScrolling
    ? Math.max(viewportHeight, SCROLLING_RENDER_WINDOW_BUFFER_PX)
    : 0
  const bufferedStartOffset = Math.max(0, targetRange.paddingTop - effectiveBufferPx)
  const targetVisibleBottom =
    (offsets[targetRange.endIndex] ?? 0) + (heights[targetRange.endIndex] ?? 0)
  const bufferedEndOffset = targetVisibleBottom + effectiveBufferPx
  const bufferedStartIndex =
    effectiveBufferPx > 0
      ? findConversationEntryIndex(offsets, heights, bufferedStartOffset)
      : targetRange.startIndex
  const bufferedEndIndex =
    effectiveBufferPx > 0
      ? findConversationEntryEndIndex(offsets, heights, bufferedEndOffset)
      : targetRange.endIndex
  const nextStartIndex = Math.min(current.startIndex, bufferedStartIndex)
  const nextEndIndex = Math.max(current.endIndex, bufferedEndIndex)
  const nextPaddingTop = offsets[nextStartIndex] ?? 0
  const nextVisibleBottom = (offsets[nextEndIndex] ?? 0) + (heights[nextEndIndex] ?? 0)

  return {
    endIndex: nextEndIndex,
    paddingBottom: Math.max(0, totalHeight - nextVisibleBottom),
    paddingTop: nextPaddingTop,
    startIndex: nextStartIndex,
  }
}

export function shouldApplyVirtualizedViewportAnchorCorrection({
  freezeLayout,
  hasPreviousLayout,
  isUserScrolling,
  scrollTop,
  targetStartIndex,
  viewportHeight,
  viewportScrollHeight,
  virtualTotalHeight,
}: {
  freezeLayout: boolean
  hasPreviousLayout: boolean
  isUserScrolling: boolean
  scrollTop: number
  targetStartIndex: number
  viewportHeight: number
  viewportScrollHeight: number
  virtualTotalHeight: number
}) {
  if (
    !hasPreviousLayout ||
    isUserScrolling ||
    freezeLayout ||
    targetStartIndex <= 0
  ) {
    return false
  }

  // The real DOM viewport wins here. When the browser is already near the
  // actual bottom, preserving a stale virtual anchor causes visible snap-back.
  if (isViewportNearBottom(scrollTop, viewportScrollHeight, viewportHeight)) {
    return false
  }

  if (isViewportNearBottom(scrollTop, virtualTotalHeight, viewportHeight)) {
    return false
  }

  return true
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

function isViewportNearBottom(
  scrollTop: number,
  totalHeight: number,
  viewportHeight: number,
) {
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
