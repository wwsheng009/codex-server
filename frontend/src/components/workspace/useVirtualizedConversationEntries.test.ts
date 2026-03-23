import { describe, expect, it, vi } from 'vitest'

import {
  buildVirtualizedConversationEntryLayout,
  buildVisibleVirtualizedEntries,
  expandVirtualizedRenderWindow,
  resolveVirtualizedViewportAnchorOffsetDelta,
} from './useVirtualizedConversationEntries'

describe('buildVirtualizedConversationEntryLayout', () => {
  it('recomputes offsets only from the first dirty entry onward', () => {
    const entries = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
    const estimateEntryHeight = vi
      .fn<(entry: { key: string }) => number>()
      .mockImplementation((entry) => {
        switch (entry.key) {
          case 'a':
            return 10
          case 'b':
            return 20
          default:
            return 30
        }
      })

    const initialLayout = buildVirtualizedConversationEntryLayout(
      entries,
      (entry) => entry.key,
      estimateEntryHeight,
      {},
    )

    expect(initialLayout.offsets).toEqual([0, 10, 30])
    expect(initialLayout.heights).toEqual([10, 20, 30])
    expect(estimateEntryHeight).toHaveBeenCalledTimes(3)

    const nextLayout = buildVirtualizedConversationEntryLayout(
      entries,
      (entry) => entry.key,
      estimateEntryHeight,
      { b: 24 },
      initialLayout,
      new Set(['b']),
    )

    expect(nextLayout.offsets).toEqual([0, 10, 34])
    expect(nextLayout.heights).toEqual([10, 24, 30])
    expect(estimateEntryHeight).toHaveBeenCalledTimes(3)
  })

  it('reuses the visible slice when entries and range are unchanged', () => {
    const entries = ['a', 'b', 'c', 'd']

    const firstSlice = buildVisibleVirtualizedEntries(entries, 1, 2)
    const secondSlice = buildVisibleVirtualizedEntries(entries, 1, 2, firstSlice)

    expect(secondSlice).toBe(firstSlice)
    expect(secondSlice.visibleEntries).toBe(firstSlice.visibleEntries)
    expect(secondSlice.visibleEntries).toEqual(['b', 'c'])
  })

  it('expands the scrolling render window with extra buffer while the user is scrolling', () => {
    const offsets = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]
    const heights = new Array(10).fill(100)

    const nextWindow = expandVirtualizedRenderWindow({
      current: {
        endIndex: 5,
        paddingBottom: 400,
        paddingTop: 300,
        startIndex: 3,
      },
      heights,
      isUserScrolling: true,
      offsets,
      targetRange: {
        endIndex: 6,
        paddingBottom: 300,
        paddingTop: 400,
        startIndex: 4,
      },
      totalHeight: 1_000,
      viewportHeight: 240,
    })

    expect(nextWindow).toEqual({
      endIndex: 9,
      paddingBottom: 0,
      paddingTop: 0,
      startIndex: 0,
    })
  })

  it('keeps buffered virtualization for larger scrolling threads', () => {
    const offsets = Array.from({ length: 400 }, (_, index) => index * 100)
    const heights = new Array(400).fill(100)

    const nextWindow = expandVirtualizedRenderWindow({
      current: {
        endIndex: 130,
        paddingBottom: 26_900,
        paddingTop: 12_000,
        startIndex: 120,
      },
      heights,
      isUserScrolling: true,
      offsets,
      targetRange: {
        endIndex: 131,
        paddingBottom: 26_800,
        paddingTop: 12_500,
        startIndex: 125,
      },
      totalHeight: 40_000,
      viewportHeight: 240,
    })

    expect(nextWindow).toEqual({
      endIndex: 141,
      paddingBottom: 25_800,
      paddingTop: 11_500,
      startIndex: 115,
    })
  })

  it('keeps a bounded window for mid-sized scrolling threads instead of fully expanding', () => {
    const offsets = Array.from({ length: 120 }, (_, index) => index * 100)
    const heights = new Array(120).fill(100)

    const nextWindow = expandVirtualizedRenderWindow({
      current: {
        endIndex: 42,
        paddingBottom: 7_700,
        paddingTop: 3_000,
        startIndex: 30,
      },
      heights,
      isUserScrolling: true,
      offsets,
      targetRange: {
        endIndex: 44,
        paddingBottom: 7_500,
        paddingTop: 3_400,
        startIndex: 34,
      },
      totalHeight: 12_000,
      viewportHeight: 240,
    })

    expect(nextWindow).toEqual({
      endIndex: 54,
      paddingBottom: 6_500,
      paddingTop: 2_400,
      startIndex: 24,
    })
  })

  it('computes anchor offset deltas by entry key instead of raw index', () => {
    const previousLayout = buildVirtualizedConversationEntryLayout(
      [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
      (entry) => entry.key,
      (entry) => (entry.key === 'a' ? 100 : 80),
      {},
    )
    const nextLayout = buildVirtualizedConversationEntryLayout(
      [{ key: 'x' }, { key: 'a' }, { key: 'b' }, { key: 'c' }],
      (entry) => entry.key,
      (entry) => (entry.key === 'x' ? 60 : entry.key === 'a' ? 120 : 80),
      {},
    )

    expect(
      resolveVirtualizedViewportAnchorOffsetDelta({
        anchorEntry: { key: 'b' },
        getEntryKey: (entry) => entry.key,
        nextLayout,
        previousLayout,
      }),
    ).toBe(80)
  })
})
