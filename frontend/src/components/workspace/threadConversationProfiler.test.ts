import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'

let buildConversationLiveDiagnosticsSnapshot: typeof import('./threadConversationProfiler').buildConversationLiveDiagnosticsSnapshot
let buildConversationRenderProfilerExportPayload: typeof import('./threadConversationProfiler').buildConversationRenderProfilerExportPayload
let buildConversationRenderProfilerDiagnosticOverview: typeof import('./threadConversationProfiler').buildConversationRenderProfilerDiagnosticOverview
let appendConversationRenderProfilerSample: typeof import('./threadConversationProfiler').appendConversationRenderProfilerSample
let buildConversationRenderProfilerSnapshot: typeof import('./threadConversationProfiler').buildConversationRenderProfilerSnapshot
let buildConversationRenderProfilerSuggestions: typeof import('./threadConversationProfiler').buildConversationRenderProfilerSuggestions
let buildConversationScrollDiagnosticsSnapshot: typeof import('./threadConversationProfiler').buildConversationScrollDiagnosticsSnapshot
let createConversationRenderProfilerRecordState: typeof import('./threadConversationProfiler').createConversationRenderProfilerRecordState

describe('threadConversationProfiler', () => {
  beforeAll(async () => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
    ;({
      buildConversationLiveDiagnosticsSnapshot,
      buildConversationRenderProfilerExportPayload,
      buildConversationRenderProfilerDiagnosticOverview,
      appendConversationRenderProfilerSample,
      buildConversationRenderProfilerSnapshot,
      buildConversationRenderProfilerSuggestions,
      buildConversationScrollDiagnosticsSnapshot,
      createConversationRenderProfilerRecordState,
    } = await import('./threadConversationProfiler'))
  })

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

  it('summarizes live diagnostics for stream, flush, snapshot, refresh, viewport, and renderer fallbacks', () => {
    const snapshot = buildConversationLiveDiagnosticsSnapshot(
      [
        {
          id: 1,
          itemId: 'item-1',
          itemType: 'agentMessage',
          kind: 'stream-received',
          metadata: {
            deltaLength: 4,
          },
          method: 'item/agentMessage/delta',
          source: 'workspace-stream',
          threadId: 'thread-1',
          ts: 100,
          turnId: 'turn-1',
        },
        {
          id: 2,
          kind: 'stream-batch-flush',
          metadata: {
            count: 3,
          },
          method: 'item/agentMessage/delta',
          source: 'workspace-stream',
          threadId: 'thread-1',
          ts: 110,
          turnId: 'turn-1',
        },
        {
          id: 3,
          itemId: 'item-1',
          itemType: 'agentMessage',
          kind: 'baseline-filtered',
          method: 'item/completed',
          reason: 'filtered: stale event already represented',
          source: 'thread-live',
          threadId: 'thread-1',
          ts: 120,
          turnId: 'turn-1',
        },
        {
          id: 4,
          itemId: 'item-1',
          itemType: 'agentMessage',
          kind: 'baseline-replayed',
          metadata: {
            currentLength: 4,
            incomingLength: 12,
          },
          method: 'item/completed',
          reason: 'older event replayed: longer agent text',
          source: 'thread-live',
          threadId: 'thread-1',
          ts: 130,
          turnId: 'turn-1',
        },
        {
          id: 5,
          itemId: 'item-1',
          itemType: 'agentMessage',
          kind: 'snapshot-reconciled',
          metadata: {
            currentLength: 12,
            incomingLength: 8,
            preserveLongerCurrentText: true,
          },
          reason: 'preserved longer current text',
          source: 'thread-live',
          threadId: 'thread-1',
          ts: 140,
          turnId: 'turn-1',
        },
        {
          id: 6,
          itemId: 'item-2',
          itemType: 'reasoning',
          kind: 'timeline-placeholder',
          reason: 'reasoning placeholder',
          source: 'thread-render',
          threadId: 'thread-1',
          ts: 145,
          turnId: 'turn-1',
        },
        {
          id: 7,
          itemId: 'item-2',
          itemType: 'reasoning',
          kind: 'timeline-suppressed',
          reason: 'reasoning without content',
          source: 'thread-render',
          threadId: 'thread-1',
          ts: 150,
          turnId: 'turn-1',
        },
        {
          id: 8,
          kind: 'thread-detail-refresh-requested',
          metadata: {
            delayMs: 120,
          },
          reason: 'scheduled thread detail refresh',
          source: 'thread-page-refresh',
          threadId: 'thread-1',
          ts: 160,
        },
        {
          id: 9,
          kind: 'viewport-detached',
          metadata: {
            inputSource: 'wheel-up',
          },
          reason: 'user scroll intent detached viewport from latest',
          source: 'thread-viewport',
          threadId: 'thread-1',
          ts: 170,
        },
        {
          id: 10,
          kind: 'unread-marked',
          reason: 'new thread updates arrived while viewport was not following latest',
          source: 'thread-viewport',
          threadId: 'thread-1',
          ts: 175,
        },
        {
          id: 11,
          kind: 'jump-to-latest',
          reason: 'user requested jump to latest',
          source: 'thread-viewport',
          threadId: 'thread-1',
          ts: 180,
        },
      ],
      {
        enabled: true,
        maxRecentEvents: 3,
        now: 190,
        status: {
          followMode: 'detached',
          hasUnreadThreadUpdates: true,
          isThreadPinnedToLatest: false,
          lastLiveEventAgeMs: null,
          lastLiveEventAt: 180,
          lastThreadDetailRefreshAgeMs: null,
          lastThreadDetailRefreshAt: 160,
          selectedThreadId: 'thread-1',
        },
      },
    )

    expect(snapshot).toMatchObject({
      batchFlushCount: 1,
      enabled: true,
      eventCount: 11,
      filteredCount: 1,
      jumpToLatestCount: 1,
      lastEventAgeMs: 10,
      placeholderCount: 1,
      refreshRequestCount: 1,
      replayedCount: 1,
      snapshotReconciledCount: 1,
      streamReceivedCount: 1,
      suppressedCount: 1,
      trailingItemPreservedCount: 0,
      unreadMarkedCount: 1,
      viewportDetachedCount: 1,
    })
    expect(snapshot.topSources).toEqual([
      { count: 3, source: 'thread-live' },
      { count: 3, source: 'thread-viewport' },
      { count: 2, source: 'thread-render' },
      { count: 2, source: 'workspace-stream' },
      { count: 1, source: 'thread-page-refresh' },
    ])
    expect(snapshot.recentEvents.map((event) => event.id)).toEqual([9, 10, 11])
    expect(snapshot.latestItemLifecycle).toHaveLength(2)
    expect(snapshot.latestItemLifecycle[0]).toMatchObject({
      deltaCount: 0,
      filteredCount: 0,
      itemId: 'item-2',
      itemType: 'reasoning',
      placeholderRendered: true,
      replayedCount: 0,
      suppressedReason: 'reasoning without content',
      turnId: 'turn-1',
    })
    expect(snapshot.latestItemLifecycle[1]).toMatchObject({
      deltaCount: 1,
      filteredCount: 1,
      finalTextLength: 12,
      itemId: 'item-1',
      itemType: 'agentMessage',
      lastDeltaAt: 100,
      placeholderRendered: false,
      replayedCount: 1,
      suppressedReason: null,
      turnId: 'turn-1',
    })
    expect(snapshot.status).toMatchObject({
      followMode: 'detached',
      hasUnreadThreadUpdates: true,
      isThreadPinnedToLatest: false,
      lastLiveEventAgeMs: 10,
      lastThreadDetailRefreshAgeMs: 30,
      selectedThreadId: 'thread-1',
    })
    expect(snapshot.topProblemItems).toEqual([
      {
        evidence: [
          'suppressed: reasoning without content',
          'placeholder rendered',
        ],
        itemId: 'item-2',
        itemType: 'reasoning',
        key: 'turn-1:item-2',
        score: 6,
        summary: 'Renderer suppressed the item',
        turnId: 'turn-1',
      },
      {
        evidence: [
          'replayed 1 time(s)',
          'delta count 1',
          'final text length 12',
        ],
        itemId: 'item-1',
        itemType: 'agentMessage',
        key: 'turn-1:item-1',
        score: 3,
        summary: 'Older item state had to be replayed',
        turnId: 'turn-1',
      },
    ])
    expect(snapshot.suspectedRootCauses).toContain(
      'Visibility likely contributed: the viewport detached from latest updates and unread markers were raised.',
    )
    expect(snapshot.suspectedRootCauses).toContain(
      'Snapshot refresh/reconcile likely affected timing: fetched detail appears to have caught up with or overridden live state.',
    )
    expect(snapshot.suspectedRootCauses).toContain(
      'Renderer fallback is implicated: placeholders or suppression happened after live data reached the frontend.',
    )
    expect(snapshot.suggestions).toContain(
      'Older events were replayed back into live state; compare recovered item length and placeholder state before assuming the backend stream dropped content.',
    )
    expect(snapshot.suggestions).toContain(
      'Stream flush activity was captured; compare receive-to-flush timing when messages feel delayed even though transport stayed healthy.',
    )
    expect(snapshot.suggestions).toContain(
      'Viewport detachment or unread markers were recorded; the message may have arrived correctly but stayed below the user’s current reading position.',
    )

    const profilerSnapshot = buildConversationRenderProfilerSnapshot([], {
      enabled: true,
      liveDiagnosticsEnabled: true,
      liveDiagnosticsStatus: snapshot.status,
      liveEvents: [
        {
          id: 1,
          itemId: 'item-1',
          itemType: 'agentMessage',
          kind: 'stream-received',
          metadata: { deltaLength: 4 },
          method: 'item/agentMessage/delta',
          source: 'workspace-stream',
          threadId: 'thread-1',
          ts: 100,
          turnId: 'turn-1',
        },
        {
          id: 2,
          itemId: 'item-2',
          itemType: 'reasoning',
          kind: 'timeline-suppressed',
          reason: 'reasoning without content',
          source: 'thread-render',
          threadId: 'thread-1',
          ts: 150,
          turnId: 'turn-1',
        },
      ],
      now: 190,
      scrollDiagnosticsEnabled: true,
      scrollEvents: [
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
      ],
      windowMs: 5_000,
    })
    const overview = buildConversationRenderProfilerDiagnosticOverview(profilerSnapshot)
    expect(overview.currentStatus).toMatchObject({
      followMode: 'detached',
      hasUnreadThreadUpdates: true,
      selectedThreadId: 'thread-1',
    })
    expect(overview.likelyRootCauses).toContain(
      'Renderer fallback is implicated: placeholders or suppression happened after live data reached the frontend.',
    )
    expect(overview.topProblemItems[0]).toMatchObject({
      itemId: 'item-2',
      itemType: 'reasoning',
      summary: 'Renderer suppressed the item',
    })
    expect(overview.topSuggestions.live).toContain(
      'Renderer fallback events were recorded; inspect empty agent or reasoning items before tracing scroll or viewport behavior.',
    )
    expect(overview.topSuggestions.scroll).toContain(
      'The busiest scroll source in this capture is sync-thread-viewport; start the trace review there.',
    )

    const exportPayload = buildConversationRenderProfilerExportPayload(profilerSnapshot, {
      exportedAt: '2026-04-13T12:00:00.000Z',
      liveEvents: [
        {
          id: 1,
          itemId: 'item-2',
          itemType: 'reasoning',
          kind: 'timeline-suppressed',
          reason: 'reasoning without content',
          source: 'thread-render',
          threadId: 'thread-1',
          ts: 150,
          turnId: 'turn-1',
        },
      ],
      scrollEvents: [
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
      ],
    })
    expect(exportPayload).toMatchObject({
      diagnosticOverview: {
        currentStatus: {
          followMode: 'detached',
          selectedThreadId: 'thread-1',
        },
        likelyRootCauses: [
          'Renderer fallback is implicated: placeholders or suppression happened after live data reached the frontend.',
        ],
      },
      exportedAt: '2026-04-13T12:00:00.000Z',
      liveDiagnostics: {
        enabled: true,
        events: [
          {
            itemId: 'item-2',
            kind: 'timeline-suppressed',
          },
        ],
      },
      scrollDiagnostics: {
        enabled: true,
        events: [
          {
            kind: 'viewport-scroll',
            source: 'sync-thread-viewport',
          },
        ],
      },
    })
  })

  it('does not classify filtered items as unrecovered when snapshot reconciliation already caught them up', () => {
    const snapshot = buildConversationLiveDiagnosticsSnapshot(
      [
        {
          id: 1,
          itemId: 'cmd-1',
          itemType: 'commandExecution',
          kind: 'baseline-filtered',
          method: 'item/commandExecution/outputDelta',
          source: 'thread-live',
          threadId: 'thread-1',
          ts: 100,
          turnId: 'turn-1',
        },
        {
          id: 2,
          itemId: 'cmd-1',
          itemType: 'commandExecution',
          kind: 'snapshot-reconciled',
          metadata: {
            currentLength: 240,
            incomingLength: 120,
          },
          reason: 'preserved longer current text',
          source: 'thread-live',
          threadId: 'thread-1',
          ts: 110,
          turnId: 'turn-1',
        },
      ],
      {
        enabled: true,
        now: 120,
      },
    )

    expect(snapshot.latestItemLifecycle[0]).toMatchObject({
      filteredCount: 1,
      replayedCount: 0,
      snapshotReconciledCount: 1,
      snapshotPreservedCount: 0,
    })
    expect(snapshot.topProblemItems).toEqual([
      {
        evidence: [
          'filtered 1 time(s)',
          'snapshot recovered 1 time(s)',
          'final text length 240',
        ],
        itemId: 'cmd-1',
        itemType: 'commandExecution',
        key: 'turn-1:cmd-1',
        score: 1,
        summary: 'Baseline filtered the item, but snapshot recovery caught it up',
        turnId: 'turn-1',
      },
    ])
  })
})
