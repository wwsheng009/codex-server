import type { RefObject } from 'react'

export type VirtualizedConversationEntryLayout<T> = {
  entriesRef: T[]
  heights: number[]
  keyToIndex: Map<string, number>
  keys: string[]
  offsets: number[]
  totalHeight: number
}

export type VisibleVirtualizedEntriesSlice<T> = {
  endIndex: number
  entriesRef: T[]
  startIndex: number
  visibleEntries: T[]
}

export type VirtualizedConversationEntriesInput<T> = {
  enabled: boolean
  entries: T[]
  estimateEntryHeight: (entry: T) => number
  freezeLayout?: boolean
  getEntryKey: (entry: T) => string
  listIdentity: string
  overscanPx?: number
  scrollViewportRef: RefObject<HTMLElement | null>
}

export type VirtualizedConversationRenderWindow = {
  endIndex: number
  paddingBottom: number
  paddingTop: number
  startIndex: number
}

export type VirtualizedConversationLayoutCacheSnapshot = {
  entryHeights: Record<string, number>
  renderWindow: VirtualizedConversationRenderWindow | null
  updatedAt: number
}

export type WriteVirtualizedConversationLayoutCacheInput = {
  entryHeights?: Record<string, number>
  renderWindow?: VirtualizedConversationRenderWindow | null
}

export type ResolveVirtualizedViewportAnchorOffsetDeltaInput<T> = {
  anchorEntry: T | undefined
  getEntryKey: (entry: T) => string
  nextLayout: VirtualizedConversationEntryLayout<T>
  previousLayout: VirtualizedConversationEntryLayout<T>
}

export type ExpandVirtualizedRenderWindowInput = {
  current: VirtualizedConversationRenderWindow
  heights: number[]
  isUserScrolling: boolean
  offsets: number[]
  targetRange: VirtualizedConversationRenderWindow
  totalHeight: number
  viewportHeight: number
}
