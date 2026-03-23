import { describe, expect, it } from 'vitest'

import {
  appendConversationRenderProfilerSample,
  buildConversationRenderProfilerSnapshot,
  buildConversationRenderProfilerSuggestions,
  buildConversationScrollDiagnosticsSnapshot,
  createConversationRenderProfilerRecordState,
} from './threadConversationProfiler'

describe('threadConversationProfiler', () => {
  it('keeps only recent samples inside the rolling window', () => {
    const record = createConversationRenderProfilerRecordState('TurnTimeline')

    appendConversationRenderProfilerSample(
      record,
      {
        actualDuration: 2,
        baseDuration: 4,
        commitTime: 10,
        phase: 'mount',
      },
      50,
    )
    appendConversationRenderProfilerSample(
      record,
      {
        actualDuration: 6,
        baseDuration: 9,
        commitTime: 80,
        phase: 'update',
      },
      50,
    )

    const snapshot = buildConversationRenderProfilerSnapshot([record], {
      enabled: true,
      now: 80,
      windowMs: 50,
    })

    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toMatchObject({
      mountCount: 1,
      recentActualDuration: 6,
      recentCommitCount: 1,
      totalCommitCount: 2,
      updateCount: 1,
    })
  })

  it('sorts hotter records ahead of lighter ones', () => {
    const rowRecord = createConversationRenderProfilerRecordState('ConversationEntryRow')
    const itemRecord = createConversationRenderProfilerRecordState('TimelineItem:agentMessage')

    appendConversationRenderProfilerSample(
      rowRecord,
      {
        actualDuration: 4,
        baseDuration: 5,
        commitTime: 120,
        phase: 'update',
      },
      5_000,
    )
    appendConversationRenderProfilerSample(
      itemRecord,
      {
        actualDuration: 11,
        baseDuration: 13,
        commitTime: 120,
        phase: 'update',
      },
      5_000,
    )

    const snapshot = buildConversationRenderProfilerSnapshot([rowRecord, itemRecord], {
      enabled: true,
      now: 120,
      windowMs: 5_000,
    })

    expect(snapshot.records.map((record) => record.id)).toEqual([
      'TimelineItem:agentMessage',
      'ConversationEntryRow',
    ])
    expect(snapshot.totalRecentActualDuration).toBe(15)
    expect(snapshot.totalRecentCommitCount).toBe(2)
  })

  it('suggests row wrapper churn when wrappers outpace item commits', () => {
    const suggestions = buildConversationRenderProfilerSuggestions([
      {
        id: 'ConversationEntryRow',
        lastActualDuration: 1,
        lastBaseDuration: 1,
        lastCommitTime: 100,
        maxActualDuration: 3,
        mountCount: 1,
        nestedUpdateCount: 0,
        recentActualDuration: 9,
        recentAverageActualDuration: 1.5,
        recentCommitCount: 6,
        recentMaxActualDuration: 3,
        totalActualDuration: 12,
        totalBaseDuration: 12,
        totalCommitCount: 6,
        updateCount: 5,
      },
      {
        id: 'TimelineItem:userMessage',
        lastActualDuration: 1,
        lastBaseDuration: 1,
        lastCommitTime: 100,
        maxActualDuration: 2,
        mountCount: 1,
        nestedUpdateCount: 0,
        recentActualDuration: 3,
        recentAverageActualDuration: 1.5,
        recentCommitCount: 2,
        recentMaxActualDuration: 2,
        totalActualDuration: 3,
        totalBaseDuration: 3,
        totalCommitCount: 2,
        updateCount: 1,
      },
    ])

    expect(suggestions).toContain(
      'Row wrappers are committing more often than memoized items; stable windows may still be rebuilding entry shells.',
    )
  })

  it('summarizes scroll diagnostics and flags likely jitter windows', () => {
    const snapshot = buildConversationScrollDiagnosticsSnapshot(
      [
        {
          clientHeight: 500,
          deltaScrollTop: null,
          deltaTargetTop: null,
          id: 1,
          kind: 'programmatic-scroll',
          scrollHeight: 1_000,
          scrollTop: 480,
          source: 'thread-open-settle',
          targetTop: 1_000,
          timeSincePreviousEventMs: null,
          ts: 100,
        },
        {
          clientHeight: 500,
          deltaScrollTop: 4,
          deltaTargetTop: 32,
          id: 2,
          kind: 'programmatic-scroll',
          scrollHeight: 1_032,
          scrollTop: 484,
          source: 'content-change-follow',
          targetTop: 1_032,
          timeSincePreviousEventMs: 80,
          ts: 180,
        },
        {
          clientHeight: 500,
          deltaScrollTop: 2,
          deltaTargetTop: null,
          id: 3,
          kind: 'virtualization-layout',
          scrollHeight: 1_064,
          scrollTop: 486,
          source: 'virtualized-layout',
          timeSincePreviousEventMs: 20,
          ts: 200,
        },
        {
          clientHeight: 500,
          deltaScrollTop: -24,
          deltaTargetTop: null,
          id: 4,
          kind: 'viewport-scroll',
          scrollHeight: 1_064,
          scrollTop: 462,
          source: 'sync-thread-viewport',
          timeSincePreviousEventMs: 50,
          ts: 250,
        },
        {
          clientHeight: 500,
          deltaScrollTop: 22,
          deltaTargetTop: null,
          id: 5,
          kind: 'viewport-scroll',
          scrollHeight: 1_064,
          scrollTop: 484,
          source: 'sync-thread-viewport',
          timeSincePreviousEventMs: 70,
          ts: 320,
        },
      ],
      {
        enabled: true,
        maxRecentEvents: 3,
      },
    )

    expect(snapshot).toMatchObject({
      candidateJitterCount: 1,
      enabled: true,
      eventCount: 5,
      layoutChangeCount: 1,
      programmaticScrollCount: 2,
      rapidProgrammaticWriteCount: 1,
      viewportScrollCount: 2,
    })
    expect(snapshot.topSources[0]).toEqual({
      count: 2,
      source: 'sync-thread-viewport',
    })
    expect(snapshot.recentEvents.map((event) => event.id)).toEqual([3, 4, 5])
    expect(snapshot.suggestions).toContain(
      'Layout-changing virtualization events overlapped with programmatic scroll writes; measured heights are a likely contributor to visible jitter.',
    )
  })
})
