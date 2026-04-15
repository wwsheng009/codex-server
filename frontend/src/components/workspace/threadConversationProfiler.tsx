import {
  Profiler,
  useSyncExternalStore,
  type ProfilerOnRenderCallback,
} from 'react'
import { i18n } from '../../i18n/runtime'

import type {
  ConversationLiveDiagnosticEvent,
  ConversationLiveDiagnosticEventInput,
  ConversationLiveDiagnosticsSnapshot,
  ConversationLiveDiagnosticsStatus,
  ConversationLiveItemLifecycleEntry,
  ConversationLiveProblemItem,
  ConversationRenderProfilerBoundaryProps,
  ConversationRenderProfilerRailToggleProps,
  ConversationRenderProfilerRecord,
  ConversationRenderProfilerRecordState,
  ConversationRenderProfilerSample,
  ConversationRenderProfilerSnapshot,
  ConversationScrollDiagnosticEvent,
  ConversationScrollDiagnosticEventInput,
  ConversationScrollDiagnosticsSnapshot,
  ConversationScrollDiagnosticsSuggestionsInput,
  ConversationScrollMutatorDescriptor,
  DebugTone,
} from './threadConversationProfilerTypes'

const THREAD_CONVERSATION_PROFILER_STORAGE_KEY = 'codex.threadConversationProfiler.enabled'
const THREAD_CONVERSATION_PROFILER_WINDOW_MS = 5_000
const MAX_CONVERSATION_SCROLL_DIAGNOSTIC_EVENTS = 400
const MAX_CONVERSATION_SCROLL_DIAGNOSTIC_RECENT_EVENTS = 12
const MAX_CONVERSATION_LIVE_DIAGNOSTIC_EVENTS = 400
const MAX_CONVERSATION_LIVE_DIAGNOSTIC_RECENT_EVENTS = 12
const SCROLL_DIAGNOSTIC_JITTER_WINDOW_MS = 220

const KNOWN_CONVERSATION_SCROLL_MUTATORS: ConversationScrollMutatorDescriptor[] = [
  {
    file: 'frontend/src/pages/thread-page/useThreadViewportAutoScroll.ts',
    reason: i18n._({
      id: 'threadConversationProfiler.autoScrollReason',
      message: 'Follows new content, thread-open settle, jump-to-latest, and bottom-clearance changes by calling scrollTo(bottom).',
    }),
    source: 'auto-scroll',
  },
  {
    file: 'frontend/src/pages/thread-page/useThreadViewportAutoScroll.ts',
    reason: i18n._({
      id: 'threadConversationProfiler.olderTurnRestoreReason',
      message: 'Restores viewport position after loading older turns through the shared viewport scroll coordinator.',
    }),
    source: 'older-turn-restore',
  },
  {
    file: 'frontend/src/components/workspace/useVirtualizedConversationEntries.ts',
    reason: i18n._({
      id: 'threadConversationProfiler.virtualizationLayoutReason',
      message: 'Does not write scrollTop directly, but measured height and padding updates can change scrollHeight while follow mode is active.',
    }),
    source: 'virtualization-layout',
  },
]

const conversationRenderProfilerListeners = new Set<() => void>()
const conversationRenderProfilerRecords = new Map<string, ConversationRenderProfilerRecordState>()
const conversationScrollDiagnosticEvents: ConversationScrollDiagnosticEvent[] = []
const conversationLiveDiagnosticEvents: ConversationLiveDiagnosticEvent[] = []

let conversationRenderProfilerEnabled = false
let conversationRenderProfilerInitialized = false
let conversationRenderProfilerPanelVisible = false
let conversationScrollDiagnosticsEnabled = false
let conversationLiveDiagnosticsEnabled = false
let conversationScrollDiagnosticEventId = 0
let conversationLiveDiagnosticEventId = 0
let conversationRenderProfilerNotificationFrame: number | null = null
let conversationRenderProfilerSnapshotCache: ConversationRenderProfilerSnapshot | null = null
let conversationLiveDiagnosticsStatus: ConversationLiveDiagnosticsStatus = {
  followMode: 'unknown',
  hasUnreadThreadUpdates: false,
  lastLiveEventAgeMs: null,
  isThreadPinnedToLatest: null,
  lastLiveEventAt: null,
  lastThreadDetailRefreshAgeMs: null,
  lastThreadDetailRefreshAt: null,
  selectedThreadId: null,
}

function getConversationRenderProfilerNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }

  return Date.now()
}

function readConversationRenderProfilerEnabledFromStorage() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(THREAD_CONVERSATION_PROFILER_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistConversationRenderProfilerEnabled(nextEnabled: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (nextEnabled) {
      window.localStorage.setItem(THREAD_CONVERSATION_PROFILER_STORAGE_KEY, '1')
    } else {
      window.localStorage.removeItem(THREAD_CONVERSATION_PROFILER_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures in locked-down browser contexts.
  }
}

function initializeConversationRenderProfiler() {
  if (conversationRenderProfilerInitialized || !import.meta.env.DEV) {
    return
  }

  conversationRenderProfilerInitialized = true
  conversationRenderProfilerEnabled = readConversationRenderProfilerEnabledFromStorage()
}

function notifyConversationRenderProfilerListeners() {
  if (!conversationRenderProfilerListeners.size) {
    return
  }

  for (const listener of conversationRenderProfilerListeners) {
    listener()
  }
}

function scheduleConversationRenderProfilerNotification() {
  if (conversationRenderProfilerNotificationFrame !== null) {
    return
  }

  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    notifyConversationRenderProfilerListeners()
    return
  }

  conversationRenderProfilerNotificationFrame = window.requestAnimationFrame(() => {
    conversationRenderProfilerNotificationFrame = null
    notifyConversationRenderProfilerListeners()
  })
}

function markConversationRenderProfilerStoreDirty() {
  conversationRenderProfilerSnapshotCache = null
}

export function updateConversationLiveDiagnosticsStatus(
  nextStatus: Partial<ConversationLiveDiagnosticsStatus>,
) {
  if (!import.meta.env.DEV) {
    return
  }

  const mergedStatus: ConversationLiveDiagnosticsStatus = {
    ...conversationLiveDiagnosticsStatus,
    ...nextStatus,
  }

  if (
    mergedStatus.followMode === conversationLiveDiagnosticsStatus.followMode &&
    mergedStatus.hasUnreadThreadUpdates ===
      conversationLiveDiagnosticsStatus.hasUnreadThreadUpdates &&
    mergedStatus.lastLiveEventAgeMs ===
      conversationLiveDiagnosticsStatus.lastLiveEventAgeMs &&
    mergedStatus.isThreadPinnedToLatest ===
      conversationLiveDiagnosticsStatus.isThreadPinnedToLatest &&
    mergedStatus.lastLiveEventAt === conversationLiveDiagnosticsStatus.lastLiveEventAt &&
    mergedStatus.lastThreadDetailRefreshAgeMs ===
      conversationLiveDiagnosticsStatus.lastThreadDetailRefreshAgeMs &&
    mergedStatus.lastThreadDetailRefreshAt ===
      conversationLiveDiagnosticsStatus.lastThreadDetailRefreshAt &&
    mergedStatus.selectedThreadId === conversationLiveDiagnosticsStatus.selectedThreadId
  ) {
    return
  }

  conversationLiveDiagnosticsStatus = mergedStatus
  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

function getLastConversationScrollDiagnosticEvent() {
  return conversationScrollDiagnosticEvents.length
    ? conversationScrollDiagnosticEvents[conversationScrollDiagnosticEvents.length - 1]
    : null
}

function getLastConversationScrollDiagnosticValue(
  key: 'scrollTop' | 'targetTop',
) {
  for (let index = conversationScrollDiagnosticEvents.length - 1; index >= 0; index -= 1) {
    const value = conversationScrollDiagnosticEvents[index][key]
    if (typeof value === 'number') {
      return value
    }
  }

  return null
}

export function createConversationRenderProfilerRecordState(
  id: string,
): ConversationRenderProfilerRecordState {
  return {
    id,
    lastActualDuration: 0,
    lastBaseDuration: 0,
    lastCommitTime: 0,
    maxActualDuration: 0,
    mountCount: 0,
    nestedUpdateCount: 0,
    samples: [],
    totalActualDuration: 0,
    totalBaseDuration: 0,
    updateCount: 0,
  }
}

function pruneConversationRenderProfilerSamples(
  record: ConversationRenderProfilerRecordState,
  minCommitTime: number,
) {
  const { samples } = record
  let pruneCount = 0

  while (pruneCount < samples.length && samples[pruneCount].commitTime < minCommitTime) {
    pruneCount += 1
  }

  if (pruneCount > 0) {
    samples.splice(0, pruneCount)
  }
}

export function appendConversationRenderProfilerSample(
  record: ConversationRenderProfilerRecordState,
  sample: ConversationRenderProfilerSample & {
    phase: 'mount' | 'nested-update' | 'update'
  },
  windowMs: number,
) {
  record.samples.push({
    actualDuration: sample.actualDuration,
    baseDuration: sample.baseDuration,
    commitTime: sample.commitTime,
  })
  record.lastActualDuration = sample.actualDuration
  record.lastBaseDuration = sample.baseDuration
  record.lastCommitTime = sample.commitTime
  record.maxActualDuration = Math.max(record.maxActualDuration, sample.actualDuration)
  record.totalActualDuration += sample.actualDuration
  record.totalBaseDuration += sample.baseDuration

  switch (sample.phase) {
    case 'mount':
      record.mountCount += 1
      break
    case 'nested-update':
      record.nestedUpdateCount += 1
      break
    default:
      record.updateCount += 1
      break
  }

  pruneConversationRenderProfilerSamples(record, sample.commitTime - windowMs)
  return record
}

export function buildConversationRenderProfilerRecord(
  record: ConversationRenderProfilerRecordState,
  now: number,
  windowMs: number,
): ConversationRenderProfilerRecord {
  pruneConversationRenderProfilerSamples(record, now - windowMs)

  let recentActualDuration = 0
  let recentMaxActualDuration = 0

  for (const sample of record.samples) {
    recentActualDuration += sample.actualDuration
    recentMaxActualDuration = Math.max(recentMaxActualDuration, sample.actualDuration)
  }

  const recentCommitCount = record.samples.length

  return {
    id: record.id,
    lastActualDuration: record.lastActualDuration,
    lastBaseDuration: record.lastBaseDuration,
    lastCommitTime: record.lastCommitTime,
    maxActualDuration: record.maxActualDuration,
    mountCount: record.mountCount,
    nestedUpdateCount: record.nestedUpdateCount,
    recentActualDuration,
    recentAverageActualDuration:
      recentCommitCount > 0 ? recentActualDuration / recentCommitCount : 0,
    recentCommitCount,
    recentMaxActualDuration,
    totalActualDuration: record.totalActualDuration,
    totalBaseDuration: record.totalBaseDuration,
    totalCommitCount: record.mountCount + record.nestedUpdateCount + record.updateCount,
    updateCount: record.updateCount,
  }
}

export function buildConversationRenderProfilerSuggestions(
  records: ConversationRenderProfilerRecord[],
): string[] {
  if (!records.length) {
    return [
      i18n._({
        id: 'threadConversationProfiler.scrollToCollectWindow',
        message: 'Scroll the thread or wait for live output to collect a fresh five second window.',
      }),
    ]
  }

  const suggestions: string[] = []
  const topRecord = records[0]
  const rowRecord = records.find((record) => record.id === 'ConversationEntryRow')
  const hottestTimelineItem = records.find((record) => record.id.startsWith('TimelineItem:'))
  const itemCommitCount = records
    .filter((record) => record.id.startsWith('TimelineItem:'))
    .reduce((total, record) => total + record.recentCommitCount, 0)

  if (topRecord.id === 'ThreadWorkbenchSurface' || topRecord.id === 'TurnTimeline') {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.parentCommitsDominate',
        message: 'Parent commits dominate this window; verify surface props and turns or entries identity during scroll.',
      }),
    )
  }

  if (
    rowRecord &&
    rowRecord.recentCommitCount > 0 &&
    rowRecord.recentCommitCount > itemCommitCount
  ) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.rowWrappersCommitting',
        message: 'Row wrappers are committing more often than memoized items; stable windows may still be rebuilding entry shells.',
      }),
    )
  }

  if (hottestTimelineItem && hottestTimelineItem.recentActualDuration >= 8) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.visibleItemSubtreeWork',
        message: 'Visible item subtree work is concentrated in {id}; inspect that renderer path next.',
        values: { id: hottestTimelineItem.id },
      }),
    )
  }

  if (!suggestions.length) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.windowBalanced',
        message: 'This window looks fairly balanced. Capture one run while scrolling and another while live output streams, then compare the hottest records.',
      }),
    )
  }

  return suggestions.slice(0, 3)
}

export function buildConversationScrollDiagnosticsSuggestions(
  snapshot: ConversationScrollDiagnosticsSuggestionsInput,
): string[] {
  if (!snapshot.eventCount) {
    return [
      i18n._({
        id: 'threadConversationProfiler.enableScrollCapture',
        message: 'Enable scroll capture, then reproduce the jump or jitter to collect viewport and programmatic scroll events.',
      }),
    ]
  }

  const suggestions: string[] = []
  const topSource = snapshot.topSources[0]?.source

  if (snapshot.candidateJitterCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.rapidDirectionChanges',
        message: 'Rapid direction changes were detected inside the viewport event stream; inspect the export around those timestamps first.',
      }),
    )
  }

  if (snapshot.rapidProgrammaticWriteCount > 1) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.multipleProgrammaticWrites',
        message: 'Multiple programmatic scroll writes landed inside a short window; auto-follow and layout correction may be competing.',
      }),
    )
  }

  if (snapshot.layoutChangeCount > 0 && snapshot.programmaticScrollCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.layoutChangeOverlap',
        message: 'Layout-changing virtualization events overlapped with programmatic scroll writes; measured heights are a likely contributor to visible jitter.',
      }),
    )
  }

  if (!suggestions.length && topSource) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.busiestScrollSource',
        message: 'The busiest scroll source in this capture is {source}; start the trace review there.',
        values: { source: topSource },
      }),
    )
  }

  if (!suggestions.length && snapshot.viewportScrollCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.onlyViewportScroll',
        message: 'Only viewport scroll observations were captured. Re-run with the jitter reproduced while follow mode is active to catch competing writes.',
      }),
    )
  }

  return suggestions.slice(0, 3)
}

export function buildConversationScrollDiagnosticsSnapshot(
  events: ConversationScrollDiagnosticEvent[],
  options?: {
    enabled?: boolean
    maxRecentEvents?: number
  },
): ConversationScrollDiagnosticsSnapshot {
  const sourceCounts = new Map<string, number>()
  let candidateJitterCount = 0
  let layoutChangeCount = 0
  let maxAbsoluteScrollDelta = 0
  let maxAbsoluteTargetDelta = 0
  let programmaticScrollCount = 0
  let rapidProgrammaticWriteCount = 0
  let userIntentCount = 0
  let viewportScrollCount = 0
  let previousDirectionalEvent: ConversationScrollDiagnosticEvent | null = null
  let previousProgrammaticScrollEvent: ConversationScrollDiagnosticEvent | null = null

  for (const event of events) {
    sourceCounts.set(event.source, (sourceCounts.get(event.source) ?? 0) + 1)

    if (typeof event.deltaScrollTop === 'number') {
      maxAbsoluteScrollDelta = Math.max(
        maxAbsoluteScrollDelta,
        Math.abs(event.deltaScrollTop),
      )
    }
    if (typeof event.deltaTargetTop === 'number') {
      maxAbsoluteTargetDelta = Math.max(
        maxAbsoluteTargetDelta,
        Math.abs(event.deltaTargetTop),
      )
    }

    if (event.kind === 'viewport-scroll') {
      viewportScrollCount += 1
    } else if (event.kind === 'programmatic-scroll') {
      programmaticScrollCount += 1
    } else if (
      event.kind === 'virtualization-layout' ||
      event.kind === 'virtualization-range' ||
      event.kind === 'older-turn-anchor'
    ) {
      layoutChangeCount += 1
    } else if (event.kind === 'user-intent') {
      userIntentCount += 1
    }

    const eventDelta =
      typeof event.deltaScrollTop === 'number'
        ? event.deltaScrollTop
        : typeof event.deltaTargetTop === 'number'
          ? event.deltaTargetTop
          : null

    if (
      previousDirectionalEvent &&
      typeof eventDelta === 'number' &&
      typeof previousDirectionalEvent.deltaScrollTop !== 'number' &&
      typeof previousDirectionalEvent.deltaTargetTop !== 'number'
    ) {
      previousDirectionalEvent = null
    }

    if (
      previousDirectionalEvent &&
      typeof eventDelta === 'number' &&
      event.timeSincePreviousEventMs !== null &&
      event.timeSincePreviousEventMs !== undefined &&
      event.timeSincePreviousEventMs <= SCROLL_DIAGNOSTIC_JITTER_WINDOW_MS
    ) {
      const previousDelta =
        typeof previousDirectionalEvent.deltaScrollTop === 'number'
          ? previousDirectionalEvent.deltaScrollTop
          : previousDirectionalEvent.deltaTargetTop

      if (
        typeof previousDelta === 'number' &&
        Math.abs(previousDelta) >= 4 &&
        Math.abs(eventDelta) >= 4 &&
        Math.sign(previousDelta) !== Math.sign(eventDelta)
      ) {
        candidateJitterCount += 1
      }
    }

    if (
      event.kind === 'programmatic-scroll' &&
      previousProgrammaticScrollEvent &&
      event.timeSincePreviousEventMs !== null &&
      event.timeSincePreviousEventMs !== undefined &&
      event.timeSincePreviousEventMs <= SCROLL_DIAGNOSTIC_JITTER_WINDOW_MS &&
      typeof event.deltaTargetTop === 'number' &&
      Math.abs(event.deltaTargetTop) >= 4
    ) {
      rapidProgrammaticWriteCount += 1
    }

    if (typeof eventDelta === 'number') {
      previousDirectionalEvent = event
    }

    if (event.kind === 'programmatic-scroll') {
      previousProgrammaticScrollEvent = event
    }
  }

  const topSources = Array.from(sourceCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1]
      }

      return left[0].localeCompare(right[0])
    })
    .slice(0, 5)
    .map(([source, count]) => ({ count, source }))

  const snapshot: ConversationScrollDiagnosticsSnapshot = {
    candidateJitterCount,
    enabled: options?.enabled ?? false,
    eventCount: events.length,
    lastEvent: events.length ? events[events.length - 1] : null,
    layoutChangeCount,
    maxAbsoluteScrollDelta,
    maxAbsoluteTargetDelta,
    programmaticScrollCount,
    rapidProgrammaticWriteCount,
    recentEvents: events.slice(-(options?.maxRecentEvents ?? MAX_CONVERSATION_SCROLL_DIAGNOSTIC_RECENT_EVENTS)),
    suggestions: [],
    topSources,
    userIntentCount,
    viewportScrollCount,
  }

  snapshot.suggestions = buildConversationScrollDiagnosticsSuggestions(snapshot)
  return snapshot
}

export function buildConversationLiveDiagnosticsSuggestions(
  snapshot: Pick<
    ConversationLiveDiagnosticsSnapshot,
    | 'batchFlushCount'
    | 'deferredFlushCount'
    | 'eventCount'
    | 'filteredCount'
    | 'jumpToLatestCount'
    | 'placeholderCount'
    | 'refreshRequestCount'
    | 'replayedCount'
    | 'snapshotReconciledCount'
    | 'streamReceivedCount'
    | 'suppressedCount'
    | 'topSources'
    | 'unreadMarkedCount'
    | 'viewportDetachedCount'
  >,
): string[] {
  if (!snapshot.eventCount) {
    return [
      i18n._({
        id: 'threadConversationProfiler.enableLiveCapture',
        message: 'Enable live capture, reproduce the missing or delayed message, then inspect stream receipt, baseline filtering, and renderer suppression in one timeline.',
      }),
    ]
  }

  const suggestions: string[] = []
  const topSource = snapshot.topSources[0]?.source

  if (
    snapshot.filteredCount >= 3 &&
    snapshot.filteredCount >= snapshot.replayedCount &&
    snapshot.filteredCount >= snapshot.suppressedCount
  ) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.baselineFilteredDominate',
        message: 'Baseline-filtered events dominate this capture; inspect updatedAt drift and whether the snapshot already represented the incoming item.',
      }),
    )
  }

  if (snapshot.replayedCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.olderEventsReplayed',
        message: 'Older events were replayed back into live state; compare recovered item length and placeholder state before assuming the backend stream dropped content.',
      }),
    )
  }

  if (snapshot.viewportDetachedCount > 0 || snapshot.unreadMarkedCount > 0) {
    suggestions.push(
      'Viewport detachment or unread markers were recorded; the message may have arrived correctly but stayed below the user’s current reading position.',
    )
  }

  if (snapshot.batchFlushCount > 0 || snapshot.deferredFlushCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.streamFlushActivity',
        message: 'Stream flush activity was captured; compare receive-to-flush timing when messages feel delayed even though transport stayed healthy.',
      }),
    )
  }

  if (snapshot.snapshotReconciledCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.snapshotReconciliation',
        message: 'Snapshot reconciliation preserved live state over fetched detail; inspect whether longer text or streaming markers were intentionally kept.',
      }),
    )
  }

  if (snapshot.refreshRequestCount > 0) {
    suggestions.push(
      'Thread detail refreshes were requested during this capture; compare live event timing with snapshot refresh timing when content appears to “catch up” late.',
    )
  }

  if (snapshot.suppressedCount > 0 || snapshot.placeholderCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.rendererFallbackEvents',
        message: 'Renderer fallback events were recorded; inspect empty agent or reasoning items before tracing scroll or viewport behavior.',
      }),
    )
  }

  if (!suggestions.length && snapshot.jumpToLatestCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.jumpToLatestUsed',
        message: 'Jump-to-latest was used in this capture; compare unread markers and detach events to confirm whether the UI was behaving as expected.',
      }),
    )
  }

  if (!suggestions.length && snapshot.streamReceivedCount > 0) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.frontendReceivedEvents',
        message: 'The frontend did receive live stream events in this capture; if the UI still looked stale, inspect downstream state application rather than transport first.',
      }),
    )
  }

  if (!suggestions.length && topSource) {
    suggestions.push(
      i18n._({
        id: 'threadConversationProfiler.busiestLiveSource',
        message: 'The busiest live diagnostic source in this capture is {source}; start there.',
        values: { source: topSource },
      }),
    )
  }

  return suggestions.slice(0, 3)
}

function isConversationLiveDeltaMethod(method?: string) {
  return [
    'item/agentMessage/delta',
    'item/commandExecution/outputDelta',
    'item/plan/delta',
    'item/reasoning/summaryTextDelta',
    'item/reasoning/textDelta',
  ].includes(method ?? '')
}

function readConversationLiveDiagnosticLength(
  event: ConversationLiveDiagnosticEvent,
) {
  const lengthCandidates = [
    typeof event.metadata?.textLength === 'number' ? event.metadata.textLength : null,
    typeof event.metadata?.deltaLength === 'number' ? event.metadata.deltaLength : null,
    typeof event.metadata?.currentLength === 'number' ? event.metadata.currentLength : null,
    typeof event.metadata?.incomingLength === 'number' ? event.metadata.incomingLength : null,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (!lengthCandidates.length) {
    return null
  }

  return Math.max(...lengthCandidates)
}

export function buildConversationLiveItemLifecycleEntries(
  events: ConversationLiveDiagnosticEvent[],
  maxEntries = 8,
): ConversationLiveItemLifecycleEntry[] {
  const lifecycleByKey = new Map<string, ConversationLiveItemLifecycleEntry>()

  for (const event of events) {
    if (!event.turnId || !event.itemId) {
      continue
    }

    const lifecycleKey = `${event.turnId}:${event.itemId}`
    const existing =
      lifecycleByKey.get(lifecycleKey) ??
      {
        completedAt: null,
        deltaCount: 0,
        filteredCount: 0,
        finalTextLength: 0,
        itemId: event.itemId,
        itemType: event.itemType ?? null,
        key: lifecycleKey,
        lastDeltaAt: null,
        lastEventKind: event.kind,
        lastEventTs: event.ts,
        placeholderRendered: false,
        replayedCount: 0,
        startedAt: null,
        suppressedReason: null,
        turnId: event.turnId,
      }

    existing.itemType = event.itemType ?? existing.itemType
    if (
      event.ts > existing.lastEventTs ||
      (event.ts === existing.lastEventTs && event.id > 0)
    ) {
      existing.lastEventKind = event.kind
      existing.lastEventTs = event.ts
    }

    if (event.kind === 'stream-received') {
      if (event.method === 'item/started') {
        existing.startedAt = existing.startedAt === null ? event.ts : Math.min(existing.startedAt, event.ts)
      }
      if (event.method === 'item/completed') {
        existing.completedAt =
          existing.completedAt === null ? event.ts : Math.max(existing.completedAt, event.ts)
      }
      if (isConversationLiveDeltaMethod(event.method)) {
        existing.deltaCount += 1
        existing.lastDeltaAt = event.ts
      }
    } else if (event.kind === 'baseline-filtered') {
      existing.filteredCount += 1
    } else if (event.kind === 'baseline-replayed') {
      existing.replayedCount += 1
    } else if (event.kind === 'timeline-placeholder') {
      existing.placeholderRendered = true
    } else if (event.kind === 'timeline-suppressed') {
      existing.suppressedReason = event.reason ?? existing.suppressedReason
    }

    const measuredLength = readConversationLiveDiagnosticLength(event)
    if (measuredLength !== null) {
      existing.finalTextLength = Math.max(existing.finalTextLength, measuredLength)
    }

    lifecycleByKey.set(lifecycleKey, existing)
  }

  return Array.from(lifecycleByKey.values())
    .sort((left, right) => {
      if (right.lastEventTs !== left.lastEventTs) {
        return right.lastEventTs - left.lastEventTs
      }
      return left.key.localeCompare(right.key)
    })
    .slice(0, maxEntries)
}

export function buildConversationLiveProblemItems(
  lifecycleEntries: ConversationLiveItemLifecycleEntry[],
  maxItems = 5,
): ConversationLiveProblemItem[] {
  return lifecycleEntries
    .map((entry) => {
      const evidence: string[] = []
      let summary = i18n._({ id: 'Observed live item activity', message: 'Observed live item activity' })
      let score = 0

      if (entry.suppressedReason) {
        summary = 'Renderer suppressed the item'
        evidence.push(`suppressed: ${entry.suppressedReason}`)
        score += 4
      }

      if (entry.placeholderRendered) {
        if (!entry.suppressedReason) {
          summary = 'Item rendered as placeholder'
        }
        evidence.push('placeholder rendered')
        score += 2
      }

      if (entry.filteredCount > 0 && entry.replayedCount === 0) {
        summary = 'Baseline filtered the item without replay'
        evidence.push(`filtered ${entry.filteredCount} time(s)`)
        score += 4
      } else if (entry.replayedCount > 0) {
        summary = 'Older item state had to be replayed'
        evidence.push(`replayed ${entry.replayedCount} time(s)`)
        score += 2
      }

      if (entry.startedAt !== null && entry.completedAt === null) {
        summary = 'Item started but never completed'
        evidence.push('started without completed')
        score += 3
      }

      if (entry.deltaCount > 0) {
        evidence.push(`delta count ${entry.deltaCount}`)
        if (entry.finalTextLength === 0 && !entry.placeholderRendered) {
          summary = 'Received delta updates but final text stayed empty'
          score += 3
        } else {
          score += 1
        }
      }

      if (entry.finalTextLength > 0) {
        evidence.push(`final text length ${entry.finalTextLength}`)
      }

      if (score === 0) {
        return null
      }

      return {
        evidence,
        itemId: entry.itemId,
        itemType: entry.itemType,
        key: entry.key,
        score,
        summary,
        turnId: entry.turnId,
      }
    })
    .filter((item): item is ConversationLiveProblemItem => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.key.localeCompare(right.key)
    })
    .slice(0, maxItems)
}

export function buildConversationLiveSuspectedRootCauses(
  snapshot: Pick<
    ConversationLiveDiagnosticsSnapshot,
    | 'batchFlushCount'
    | 'deferredFlushCount'
    | 'filteredCount'
    | 'placeholderCount'
    | 'refreshRequestCount'
    | 'replayedCount'
    | 'snapshotReconciledCount'
    | 'suppressedCount'
    | 'unreadMarkedCount'
    | 'viewportDetachedCount'
  >,
  problemItems: ConversationLiveProblemItem[],
): string[] {
  const causes: string[] = []

  if (snapshot.viewportDetachedCount > 0 || snapshot.unreadMarkedCount > 0) {
    causes.push(
      'Visibility likely contributed: the viewport detached from latest updates and unread markers were raised.',
    )
  }

  if (snapshot.filteredCount > snapshot.replayedCount) {
    causes.push(
      'Baseline filtering looks dominant: more live events were filtered than replayed back into view.',
    )
  }

  if (snapshot.snapshotReconciledCount > 0 || snapshot.refreshRequestCount > 0) {
    causes.push(
      'Snapshot refresh/reconcile likely affected timing: fetched detail appears to have caught up with or overridden live state.',
    )
  }

  if (snapshot.placeholderCount > 0 || snapshot.suppressedCount > 0) {
    causes.push(
      'Renderer fallback is implicated: placeholders or suppression happened after live data reached the frontend.',
    )
  }

  if (
    !causes.length &&
    (snapshot.batchFlushCount > 0 || snapshot.deferredFlushCount > 0)
  ) {
    causes.push(
      'Transport reached the client, so remaining delay is more likely inside flush scheduling or downstream state/render work.',
    )
  }

  if (!causes.length && problemItems.length) {
    causes.push(
      `The highest-risk item is ${problemItems[0].itemType ?? 'item'} ${problemItems[0].itemId}; start with that lifecycle trace.`,
    )
  }

  return causes.slice(0, 4)
}

export function buildConversationLiveDiagnosticsSnapshot(
  events: ConversationLiveDiagnosticEvent[],
  options?: {
    enabled?: boolean
    maxRecentEvents?: number
    now?: number
    status?: ConversationLiveDiagnosticsStatus
  },
): ConversationLiveDiagnosticsSnapshot {
  let batchFlushCount = 0
  let deferredFlushCount = 0
  const sourceCounts = new Map<string, number>()
  let filteredCount = 0
  let jumpToLatestCount = 0
  let placeholderCount = 0
  let refreshRequestCount = 0
  let replayedCount = 0
  let snapshotReconciledCount = 0
  let streamReceivedCount = 0
  let suppressedCount = 0
  let trailingItemPreservedCount = 0
  let unreadMarkedCount = 0
  let viewportDetachedCount = 0

  for (const event of events) {
    sourceCounts.set(event.source, (sourceCounts.get(event.source) ?? 0) + 1)

    switch (event.kind) {
      case 'stream-received':
        streamReceivedCount += 1
        break
      case 'stream-batch-flush':
        batchFlushCount += 1
        break
      case 'stream-deferred-flush':
        deferredFlushCount += 1
        break
      case 'baseline-filtered':
        filteredCount += 1
        break
      case 'baseline-replayed':
        replayedCount += 1
        break
      case 'snapshot-reconciled':
        snapshotReconciledCount += 1
        break
      case 'snapshot-trailing-item-preserved':
        trailingItemPreservedCount += 1
        break
      case 'thread-detail-refresh-requested':
        refreshRequestCount += 1
        break
      case 'unread-marked':
        unreadMarkedCount += 1
        break
      case 'jump-to-latest':
        jumpToLatestCount += 1
        break
      case 'viewport-detached':
        viewportDetachedCount += 1
        break
      case 'timeline-placeholder':
        placeholderCount += 1
        break
      case 'timeline-suppressed':
        suppressedCount += 1
        break
    }
  }

  const topSources = Array.from(sourceCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1]
      }

      return left[0].localeCompare(right[0])
    })
    .slice(0, 5)
    .map(([source, count]) => ({ count, source }))

  const lastEvent = events.length ? events[events.length - 1] : null
  const latestItemLifecycle = buildConversationLiveItemLifecycleEntries(events)
  const topProblemItems = buildConversationLiveProblemItems(latestItemLifecycle)
  const baseStatus = options?.status ?? {
    followMode: 'unknown',
    hasUnreadThreadUpdates: false,
    lastLiveEventAgeMs: null,
    isThreadPinnedToLatest: null,
    lastLiveEventAt: null,
    lastThreadDetailRefreshAgeMs: null,
    lastThreadDetailRefreshAt: null,
    selectedThreadId: null,
  }
  const snapshot: ConversationLiveDiagnosticsSnapshot = {
    batchFlushCount,
    deferredFlushCount,
    enabled: options?.enabled ?? false,
    eventCount: events.length,
    filteredCount,
    jumpToLatestCount,
    lastEvent,
    lastEventAgeMs:
      lastEvent && typeof options?.now === 'number'
        ? Math.max(0, options.now - lastEvent.ts)
        : null,
    latestItemLifecycle,
    placeholderCount,
    recentEvents: events.slice(-(options?.maxRecentEvents ?? MAX_CONVERSATION_LIVE_DIAGNOSTIC_RECENT_EVENTS)),
    refreshRequestCount,
    replayedCount,
    snapshotReconciledCount,
    suspectedRootCauses: [],
    streamReceivedCount,
    suggestions: [],
    suppressedCount,
    topProblemItems,
    status: {
      ...baseStatus,
      lastLiveEventAgeMs:
        baseStatus.lastLiveEventAt !== null && typeof options?.now === 'number'
          ? Math.max(0, options.now - baseStatus.lastLiveEventAt)
          : null,
      lastThreadDetailRefreshAgeMs:
        baseStatus.lastThreadDetailRefreshAt !== null && typeof options?.now === 'number'
          ? Math.max(0, options.now - baseStatus.lastThreadDetailRefreshAt)
          : null,
    },
    trailingItemPreservedCount,
    unreadMarkedCount,
    viewportDetachedCount,
    topSources,
  }

  snapshot.suspectedRootCauses = buildConversationLiveSuspectedRootCauses(
    snapshot,
    topProblemItems,
  )
  snapshot.suggestions = buildConversationLiveDiagnosticsSuggestions(snapshot)
  return snapshot
}

export function buildConversationRenderProfilerSnapshot(
  records: Iterable<ConversationRenderProfilerRecordState>,
  options?: {
    enabled?: boolean
    liveDiagnosticsEnabled?: boolean
    liveEvents?: ConversationLiveDiagnosticEvent[]
    liveDiagnosticsStatus?: ConversationLiveDiagnosticsStatus
    now?: number
    scrollDiagnosticsEnabled?: boolean
    scrollEvents?: ConversationScrollDiagnosticEvent[]
    windowMs?: number
  },
): ConversationRenderProfilerSnapshot {
  const now = options?.now ?? getConversationRenderProfilerNow()
  const windowMs = options?.windowMs ?? THREAD_CONVERSATION_PROFILER_WINDOW_MS
  const scrollDiagnostics = buildConversationScrollDiagnosticsSnapshot(
    options?.scrollEvents ?? [],
    {
      enabled: options?.scrollDiagnosticsEnabled ?? false,
    },
  )
  const liveDiagnostics = buildConversationLiveDiagnosticsSnapshot(
    options?.liveEvents ?? [],
    {
      enabled: options?.liveDiagnosticsEnabled ?? false,
      now,
      status: options?.liveDiagnosticsStatus,
    },
  )
  const renderedRecords = Array.from(records, (record) =>
    buildConversationRenderProfilerRecord(record, now, windowMs),
  )
    .filter((record) => record.recentCommitCount > 0)
    .sort((left, right) => {
      if (right.recentActualDuration !== left.recentActualDuration) {
        return right.recentActualDuration - left.recentActualDuration
      }
      if (right.recentCommitCount !== left.recentCommitCount) {
        return right.recentCommitCount - left.recentCommitCount
      }
      if (right.recentMaxActualDuration !== left.recentMaxActualDuration) {
        return right.recentMaxActualDuration - left.recentMaxActualDuration
      }
      return left.id.localeCompare(right.id)
    })

  let totalRecentActualDuration = 0
  let totalRecentCommitCount = 0
  let totalRecentMaxActualDuration = 0
  let lastCommitTime: number | null = null

  for (const record of renderedRecords) {
    totalRecentActualDuration += record.recentActualDuration
    totalRecentCommitCount += record.recentCommitCount
    totalRecentMaxActualDuration = Math.max(
      totalRecentMaxActualDuration,
      record.recentMaxActualDuration,
    )
    lastCommitTime =
      lastCommitTime === null ? record.lastCommitTime : Math.max(lastCommitTime, record.lastCommitTime)
  }

  return {
    enabled: options?.enabled ?? false,
    liveDiagnostics,
    liveDiagnosticsEnabled: options?.liveDiagnosticsEnabled ?? false,
    knownScrollMutators: KNOWN_CONVERSATION_SCROLL_MUTATORS,
    lastCommitTime,
    panelVisible: false,
    records: renderedRecords,
    scrollDiagnostics,
    scrollDiagnosticsEnabled: options?.scrollDiagnosticsEnabled ?? false,
    suggestions: buildConversationRenderProfilerSuggestions(renderedRecords),
    totalRecentActualDuration,
    totalRecentCommitCount,
    totalRecentMaxActualDuration,
    windowMs,
  }
}

function subscribeConversationRenderProfiler(listener: () => void) {
  conversationRenderProfilerListeners.add(listener)
  return () => {
    conversationRenderProfilerListeners.delete(listener)
  }
}

function getConversationRenderProfilerSnapshot() {
  initializeConversationRenderProfiler()
  if (conversationRenderProfilerSnapshotCache) {
    return conversationRenderProfilerSnapshotCache
  }

  conversationRenderProfilerSnapshotCache = buildConversationRenderProfilerSnapshot(
    conversationRenderProfilerRecords.values(),
    {
      enabled: conversationRenderProfilerEnabled,
      liveDiagnosticsEnabled: conversationLiveDiagnosticsEnabled,
      liveEvents: conversationLiveDiagnosticEvents,
      liveDiagnosticsStatus: conversationLiveDiagnosticsStatus,
      scrollDiagnosticsEnabled: conversationScrollDiagnosticsEnabled,
      scrollEvents: conversationScrollDiagnosticEvents,
    },
  )
  conversationRenderProfilerSnapshotCache = {
    ...conversationRenderProfilerSnapshotCache,
    panelVisible: conversationRenderProfilerPanelVisible,
  }

  return conversationRenderProfilerSnapshotCache
}

export function useConversationRenderProfilerSnapshot() {
  return useSyncExternalStore(
    subscribeConversationRenderProfiler,
    getConversationRenderProfilerSnapshot,
    getConversationRenderProfilerSnapshot,
  )
}

export function setConversationRenderProfilerEnabled(nextEnabled: boolean) {
  initializeConversationRenderProfiler()
  if (conversationRenderProfilerEnabled === nextEnabled) {
    return
  }

  conversationRenderProfilerEnabled = nextEnabled
  persistConversationRenderProfilerEnabled(nextEnabled)

  if (nextEnabled) {
    conversationRenderProfilerRecords.clear()
  }

  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

export function setConversationScrollDiagnosticsEnabled(nextEnabled: boolean) {
  initializeConversationRenderProfiler()
  if (conversationScrollDiagnosticsEnabled === nextEnabled) {
    return
  }

  conversationScrollDiagnosticsEnabled = nextEnabled
  if (nextEnabled) {
    conversationScrollDiagnosticEvents.length = 0
    conversationScrollDiagnosticEventId = 0
  }

  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

export function setConversationLiveDiagnosticsEnabled(nextEnabled: boolean) {
  initializeConversationRenderProfiler()
  if (conversationLiveDiagnosticsEnabled === nextEnabled) {
    return
  }

  conversationLiveDiagnosticsEnabled = nextEnabled
  if (nextEnabled) {
    conversationLiveDiagnosticEvents.length = 0
    conversationLiveDiagnosticEventId = 0
  }

  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

export function setConversationRenderProfilerPanelVisible(nextVisible: boolean) {
  initializeConversationRenderProfiler()
  if (conversationRenderProfilerPanelVisible === nextVisible) {
    return
  }

  conversationRenderProfilerPanelVisible = nextVisible
  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

export function toggleConversationRenderProfilerPanelVisible() {
  setConversationRenderProfilerPanelVisible(!conversationRenderProfilerPanelVisible)
}

export function resetConversationRenderProfiler() {
  initializeConversationRenderProfiler()
  conversationRenderProfilerRecords.clear()
  conversationLiveDiagnosticEvents.length = 0
  conversationLiveDiagnosticEventId = 0
  conversationLiveDiagnosticsStatus = {
    followMode: 'unknown',
    hasUnreadThreadUpdates: false,
    lastLiveEventAgeMs: null,
    isThreadPinnedToLatest: null,
    lastLiveEventAt: null,
    lastThreadDetailRefreshAgeMs: null,
    lastThreadDetailRefreshAt: null,
    selectedThreadId: null,
  }
  conversationScrollDiagnosticEvents.length = 0
  conversationScrollDiagnosticEventId = 0
  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

export function recordConversationScrollDiagnosticEvent(input: ConversationScrollDiagnosticEventInput) {
  if (!import.meta.env.DEV) {
    return
  }

  initializeConversationRenderProfiler()
  if (!conversationScrollDiagnosticsEnabled) {
    return
  }

  const ts = getConversationRenderProfilerNow()
  const previousEvent = getLastConversationScrollDiagnosticEvent()
  const previousScrollTop = getLastConversationScrollDiagnosticValue('scrollTop')
  const previousTargetTop = getLastConversationScrollDiagnosticValue('targetTop')

  conversationScrollDiagnosticEvents.push({
    behavior: input.behavior,
    clientHeight: input.clientHeight,
    deltaScrollTop:
      typeof input.scrollTop === 'number' && typeof previousScrollTop === 'number'
        ? input.scrollTop - previousScrollTop
        : null,
    deltaTargetTop:
      typeof input.targetTop === 'number' && typeof previousTargetTop === 'number'
        ? input.targetTop - previousTargetTop
        : null,
    detail: input.detail,
    id: conversationScrollDiagnosticEventId + 1,
    kind: input.kind,
    metadata: input.metadata,
    scrollHeight: input.scrollHeight,
    scrollTop: input.scrollTop,
    source: input.source,
    targetTop: input.targetTop,
    timeSincePreviousEventMs: previousEvent ? ts - previousEvent.ts : null,
    ts,
  })
  conversationScrollDiagnosticEventId += 1

  const overflowCount =
    conversationScrollDiagnosticEvents.length - MAX_CONVERSATION_SCROLL_DIAGNOSTIC_EVENTS
  if (overflowCount > 0) {
    conversationScrollDiagnosticEvents.splice(0, overflowCount)
  }

  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

export function recordConversationLiveDiagnosticEvent(input: ConversationLiveDiagnosticEventInput) {
  if (!import.meta.env.DEV) {
    return
  }

  initializeConversationRenderProfiler()
  if (!conversationLiveDiagnosticsEnabled) {
    return
  }

  conversationLiveDiagnosticEvents.push({
    id: conversationLiveDiagnosticEventId + 1,
    itemId: input.itemId,
    itemType: input.itemType,
    kind: input.kind,
    metadata: input.metadata,
    method: input.method,
    reason: input.reason,
    serverRequestId: input.serverRequestId,
    source: input.source,
    threadId: input.threadId,
    ts: getConversationRenderProfilerNow(),
    turnId: input.turnId,
  })
  conversationLiveDiagnosticEventId += 1

  if (input.kind === 'stream-received') {
    conversationLiveDiagnosticsStatus = {
      ...conversationLiveDiagnosticsStatus,
      lastLiveEventAgeMs: null,
      lastLiveEventAt: conversationLiveDiagnosticEvents[conversationLiveDiagnosticEvents.length - 1].ts,
      selectedThreadId:
        input.threadId ?? conversationLiveDiagnosticsStatus.selectedThreadId,
    }
  }

  const overflowCount =
    conversationLiveDiagnosticEvents.length - MAX_CONVERSATION_LIVE_DIAGNOSTIC_EVENTS
  if (overflowCount > 0) {
    conversationLiveDiagnosticEvents.splice(0, overflowCount)
  }

  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

export function exportConversationRenderProfilerAnalysis() {
  if (!import.meta.env.DEV || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const snapshot = getConversationRenderProfilerSnapshot()
  const payload = buildConversationRenderProfilerExportPayload(snapshot)

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  link.href = url
  link.download = `thread-profile-analysis-${timestamp}.json`
  link.click()
  window.URL.revokeObjectURL(url)
}

export const handleConversationRenderProfilerRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  _startTime,
  commitTime,
) => {
  if (!import.meta.env.DEV) {
    return
  }

  initializeConversationRenderProfiler()
  if (!conversationRenderProfilerEnabled) {
    return
  }

  const record =
    conversationRenderProfilerRecords.get(id) ??
    createConversationRenderProfilerRecordState(id)

  appendConversationRenderProfilerSample(record, {
    actualDuration,
    baseDuration,
    commitTime,
    phase,
  }, THREAD_CONVERSATION_PROFILER_WINDOW_MS)
  conversationRenderProfilerRecords.set(id, record)
  markConversationRenderProfilerStoreDirty()
  scheduleConversationRenderProfilerNotification()
}

function formatConversationRenderProfilerDuration(value: number) {
  if (value >= 100) {
    return `${Math.round(value)}ms`
  }

  if (value >= 10) {
    return `${value.toFixed(1)}ms`
  }

  return `${value.toFixed(2)}ms`
}

function getConversationRenderProfilerTone(value: number, warnAt: number, dangerAt: number): DebugTone {
  if (value >= dangerAt) {
    return 'danger'
  }

  if (value >= warnAt) {
    return 'warn'
  }

  if (value === 0) {
    return 'neutral'
  }

  return 'good'
}

function formatConversationDiagnosticAge(ageMs: number | null) {
  if (ageMs === null) {
    return 'n/a'
  }

  if (ageMs < 1_000) {
    return `${Math.round(ageMs)}ms ago`
  }

  return `${(ageMs / 1_000).toFixed(ageMs >= 10_000 ? 0 : 1)}s ago`
}

function formatConversationLiveDiagnosticContext(event: ConversationLiveDiagnosticEvent) {
  const parts = [
    event.method,
    event.itemType,
    event.turnId ? `turn ${event.turnId}` : null,
    event.itemId ? `item ${event.itemId}` : null,
  ].filter((part): part is string => Boolean(part))

  return parts.length ? parts.join(' · ') : 'live event'
}

function formatConversationLiveDiagnosticDetail(event: ConversationLiveDiagnosticEvent) {
  const counts = [
    typeof event.metadata?.count === 'number'
      ? `count ${event.metadata.count}`
      : null,
    typeof event.metadata?.delayMs === 'number'
      ? `delay ${event.metadata.delayMs}ms`
      : null,
    typeof event.metadata?.intervalMs === 'number'
      ? `interval ${event.metadata.intervalMs}ms`
      : null,
    typeof event.metadata?.currentLength === 'number'
      ? `current ${event.metadata.currentLength}`
      : null,
    typeof event.metadata?.incomingLength === 'number'
      ? `incoming ${event.metadata.incomingLength}`
      : null,
    event.metadata?.preserveLongerCurrentText === true ? 'keep longer text' : null,
    event.metadata?.preserveStreamingPhase === true ? 'keep streaming phase' : null,
    event.metadata?.preserveClientRenderMode === true ? 'keep animate-once' : null,
  ].filter((part): part is string => Boolean(part))

  if (counts.length) {
    return counts.join(' · ')
  }

  return event.reason ?? 'sample'
}

function formatConversationLiveLifecycleStatus(entry: ConversationLiveItemLifecycleEntry) {
  if (entry.completedAt !== null) {
    return 'completed'
  }
  if (entry.startedAt !== null) {
    return 'started'
  }
  return entry.lastEventKind
}

function formatConversationLiveLifecycleDetail(entry: ConversationLiveItemLifecycleEntry) {
  const parts = [
    `delta ${entry.deltaCount}`,
    entry.filteredCount > 0 ? `filtered ${entry.filteredCount}` : null,
    entry.replayedCount > 0 ? `replayed ${entry.replayedCount}` : null,
    entry.finalTextLength > 0 ? `len ${entry.finalTextLength}` : null,
    entry.placeholderRendered ? 'placeholder' : null,
    entry.suppressedReason ? `suppressed: ${entry.suppressedReason}` : null,
  ].filter((part): part is string => Boolean(part))

  return parts.join(' · ')
}

function formatConversationLiveProblemItemDetail(item: ConversationLiveProblemItem) {
  return item.evidence.join(' · ')
}

function formatConversationLiveStatusBoolean(value: boolean | null) {
  if (value === null) {
    return 'unknown'
  }

  return value ? 'yes' : 'no'
}

export function buildConversationRenderProfilerDiagnosticOverview(
  snapshot: ConversationRenderProfilerSnapshot,
) {
  return {
    currentStatus: snapshot.liveDiagnostics.status,
    likelyRootCauses: snapshot.liveDiagnostics.suspectedRootCauses,
    topProblemItems: snapshot.liveDiagnostics.topProblemItems,
    topSuggestions: {
      live: snapshot.liveDiagnostics.suggestions,
      render: snapshot.suggestions,
      scroll: snapshot.scrollDiagnostics.suggestions,
    },
  }
}

export function buildConversationRenderProfilerExportPayload(
  snapshot: ConversationRenderProfilerSnapshot,
  options?: {
    exportedAt?: string
    liveEvents?: ConversationLiveDiagnosticEvent[]
    scrollEvents?: ConversationScrollDiagnosticEvent[]
  },
) {
  return {
    diagnosticOverview: buildConversationRenderProfilerDiagnosticOverview(snapshot),
    exportedAt: options?.exportedAt ?? new Date().toISOString(),
    knownViewportMutators: snapshot.knownScrollMutators,
    renderProfile: {
      enabled: snapshot.enabled,
      records: snapshot.records,
      suggestions: snapshot.suggestions,
      totalRecentActualDuration: snapshot.totalRecentActualDuration,
      totalRecentCommitCount: snapshot.totalRecentCommitCount,
      totalRecentMaxActualDuration: snapshot.totalRecentMaxActualDuration,
      windowMs: snapshot.windowMs,
    },
    scrollDiagnostics: {
      enabled: snapshot.scrollDiagnosticsEnabled,
      events: options?.scrollEvents ?? conversationScrollDiagnosticEvents,
      summary: snapshot.scrollDiagnostics,
    },
    liveDiagnostics: {
      enabled: snapshot.liveDiagnosticsEnabled,
      events: options?.liveEvents ?? conversationLiveDiagnosticEvents,
      summary: snapshot.liveDiagnostics,
    },
  }
}

export function ConversationRenderProfilerBoundary({
  children,
  id,
}: ConversationRenderProfilerBoundaryProps) {
  if (!import.meta.env.DEV) {
    return <>{children}</>
  }

  return (
    <Profiler id={id} onRender={handleConversationRenderProfilerRender}>
      {children}
    </Profiler>
  )
}

export function ConversationRenderProfilerRailToggle({
  disabled = false,
}: ConversationRenderProfilerRailToggleProps) {
  if (!import.meta.env.DEV) {
    return null
  }

  const snapshot = useConversationRenderProfilerSnapshot()

  return (
    <button
      aria-pressed={snapshot.panelVisible}
      className={
        snapshot.panelVisible
          ? 'pane-section__toggle workbench-pane__panel-toggle workbench-pane__panel-toggle--active'
          : 'pane-section__toggle workbench-pane__panel-toggle'
      }
      disabled={disabled}
      onClick={toggleConversationRenderProfilerPanelVisible}
      type="button"
    >
      {i18n._({ id: "Profile", message: "Profile" })}
    </button>
  )
}

export function ConversationRenderProfilerPanel() {
  if (!import.meta.env.DEV) {
    return null
  }

  const snapshot = useConversationRenderProfilerSnapshot()
  if (!snapshot.panelVisible) {
    return null
  }
  const topRecords = snapshot.records.slice(0, 6)
  const recentLiveEvents = snapshot.liveDiagnostics.recentEvents.slice().reverse()
  const latestItemLifecycle = snapshot.liveDiagnostics.latestItemLifecycle
  const topProblemItems = snapshot.liveDiagnostics.topProblemItems
  const recentScrollEvents = snapshot.scrollDiagnostics.recentEvents.slice().reverse()
  const canExport =
    snapshot.records.length > 0 ||
    snapshot.scrollDiagnostics.eventCount > 0 ||
    snapshot.liveDiagnostics.eventCount > 0

  return (
    <div className="conversation-profiler" data-testid="conversation-profiler">
      <div className="conversation-profiler__card">
        <div className="conversation-profiler__header">
          <div className="conversation-profiler__toolbar">
            <div className="conversation-profiler__heading">
              <span className="conversation-profiler__eyebrow">{i18n._({ id: "Diagnostics", message: "Diagnostics" })}</span>
              <span className="conversation-profiler__title">{i18n._({ id: "Thread Profile", message: "Thread Profile" })}</span>
            </div>
            <div className="conversation-profiler__actions">
              <div className="conversation-profiler__action-row">
                <button
                  aria-pressed={snapshot.enabled}
                  className={`pane-section__toggle conversation-profiler__action conversation-profiler__action--accent${
                    snapshot.enabled ? ' workbench-pane__panel-toggle--active' : ''
                  }`}
                  onClick={() => setConversationRenderProfilerEnabled(!snapshot.enabled)}
                  type="button"
                >
                  {snapshot.enabled ? i18n._({ id: 'threadConversationProfiler.pauseRender', message: 'Pause Render' }) : i18n._({ id: 'threadConversationProfiler.recordRender', message: 'Record Render' })}
                </button>
                <button
                  aria-pressed={snapshot.scrollDiagnosticsEnabled}
                  className={`pane-section__toggle conversation-profiler__action conversation-profiler__action--accent${
                    snapshot.scrollDiagnosticsEnabled
                      ? ' workbench-pane__panel-toggle--active'
                      : ''
                  }`}
                  onClick={() =>
                    setConversationScrollDiagnosticsEnabled(!snapshot.scrollDiagnosticsEnabled)
                  }
                  type="button"
                >
                  {snapshot.scrollDiagnosticsEnabled ? i18n._({ id: 'threadConversationProfiler.pauseScroll', message: 'Pause Scroll' }) : i18n._({ id: 'threadConversationProfiler.recordScroll', message: 'Record Scroll' })}
                </button>
                <button
                  aria-pressed={snapshot.liveDiagnosticsEnabled}
                  className={`pane-section__toggle conversation-profiler__action conversation-profiler__action--accent${
                    snapshot.liveDiagnosticsEnabled
                      ? ' workbench-pane__panel-toggle--active'
                      : ''
                  }`}
                  onClick={() =>
                    setConversationLiveDiagnosticsEnabled(!snapshot.liveDiagnosticsEnabled)
                  }
                  type="button"
                >
                  {snapshot.liveDiagnosticsEnabled ? i18n._({ id: 'threadConversationProfiler.pauseLive', message: 'Pause Live' }) : i18n._({ id: 'threadConversationProfiler.recordLive', message: 'Record Live' })}
                </button>
              </div>
              <div className="conversation-profiler__action-row conversation-profiler__action-row--secondary">
                <button
                  className="pane-section__toggle conversation-profiler__action"
                  disabled={
                    !snapshot.records.length &&
                    !snapshot.scrollDiagnostics.eventCount &&
                    !snapshot.liveDiagnostics.eventCount
                  }
                  onClick={resetConversationRenderProfiler}
                  type="button"
                >
                  {i18n._({ id: "Reset", message: "Reset" })}
                </button>
                <button
                  className="pane-section__toggle conversation-profiler__action"
                  disabled={!canExport}
                  onClick={exportConversationRenderProfilerAnalysis}
                  type="button"
                >
                  {i18n._({ id: "Export", message: "Export" })}
                </button>
                <button
                  className="pane-section__toggle conversation-profiler__action conversation-profiler__action--dismiss"
                  onClick={() => setConversationRenderProfilerPanelVisible(false)}
                  type="button"
                >
                  {i18n._({ id: "Close", message: "Close" })}
                </button>
              </div>
            </div>
          </div>
          <p className="conversation-profiler__description">
            {i18n._({ id: "Capture render cost, scroll writes, and live-stream delivery decisions for the active thread.", message: "Capture render cost, scroll writes, and live-stream delivery decisions for the active thread." })}
          </p>
          <div className="conversation-profiler__summary">
            <span
              className={`conversation-profiler__chip conversation-profiler__chip--${
                snapshot.enabled ? 'good' : 'neutral'
              }`}
            >
              {snapshot.enabled ? 'render live' : 'render idle'}
            </span>
            <span
              className={`conversation-profiler__chip conversation-profiler__chip--${
                snapshot.scrollDiagnosticsEnabled ? 'warn' : 'neutral'
              }`}
            >
              {snapshot.scrollDiagnosticsEnabled ? 'scroll live' : 'scroll idle'}
            </span>
            <span
              className={`conversation-profiler__chip conversation-profiler__chip--${
                snapshot.liveDiagnosticsEnabled ? 'warn' : 'neutral'
              }`}
            >
              {snapshot.liveDiagnosticsEnabled ? 'live capture' : 'live idle'}
            </span>
            <span className="conversation-profiler__chip conversation-profiler__chip--neutral">
              {canExport ? 'snapshot ready' : 'waiting for samples'}
            </span>
          </div>
        </div>
        <div className="conversation-profiler__body">
          <div className="conversation-profiler__section">
            <strong className="conversation-profiler__section-title">{i18n._({ id: "Render", message: "Render" })}</strong>
            {snapshot.enabled ? (
              <>
                <div className="conversation-profiler__chips">
                  <span className="conversation-profiler__chip conversation-profiler__chip--neutral">
                    {`window:${Math.round(snapshot.windowMs / 1_000)}s`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.totalRecentCommitCount,
                      24,
                      64,
                    )}`}
                  >
                    {`commits:${snapshot.totalRecentCommitCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.totalRecentActualDuration,
                      32,
                      96,
                    )}`}
                  >
                    {`actual:${formatConversationRenderProfilerDuration(snapshot.totalRecentActualDuration)}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.totalRecentMaxActualDuration,
                      8,
                      16,
                    )}`}
                  >
                    {`peak:${formatConversationRenderProfilerDuration(snapshot.totalRecentMaxActualDuration)}`}
                  </span>
                </div>
                {topRecords.length ? (
                  <div className="conversation-profiler__records">
                    {topRecords.map((record) => (
                      <div className="conversation-profiler__record" key={record.id}>
                        <strong>{record.id}</strong>
                        <span>{`${record.recentCommitCount} commit(s)`}</span>
                        <span>{`actual ${formatConversationRenderProfilerDuration(record.recentActualDuration)}`}</span>
                        <span>{`peak ${formatConversationRenderProfilerDuration(record.recentMaxActualDuration)}`}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="conversation-profiler__empty">
                    {i18n._({ id: "Scroll the thread or let live output stream to collect render samples.", message: "Scroll the thread or let live output stream to collect render samples." })}
                  </div>
                )}
                <div className="conversation-profiler__suggestions">
                  {snapshot.suggestions.map((suggestion) => (
                    <span className="conversation-profiler__suggestion" key={suggestion}>
                      {suggestion}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="conversation-profiler__empty">
                {i18n._({ id: "Start render profiling to capture React commit cost inside the thread surface.", message: "Start render profiling to capture React commit cost inside the thread surface." })}
              </div>
            )}
          </div>
          <div className="conversation-profiler__section">
            <strong className="conversation-profiler__section-title">{i18n._({ id: "Scroll", message: "Scroll" })}</strong>
            {snapshot.scrollDiagnosticsEnabled ? (
              <>
                <div className="conversation-profiler__chips">
                  <span className="conversation-profiler__chip conversation-profiler__chip--neutral">
                    {`events:${snapshot.scrollDiagnostics.eventCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.scrollDiagnostics.programmaticScrollCount,
                      3,
                      8,
                    )}`}
                  >
                    {`writes:${snapshot.scrollDiagnostics.programmaticScrollCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.scrollDiagnostics.layoutChangeCount,
                      4,
                      10,
                    )}`}
                  >
                    {`layout:${snapshot.scrollDiagnostics.layoutChangeCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.scrollDiagnostics.candidateJitterCount,
                      1,
                      3,
                    )}`}
                  >
                    {`jitter:${snapshot.scrollDiagnostics.candidateJitterCount}`}
                  </span>
                </div>
                {recentScrollEvents.length ? (
                  <div className="conversation-profiler__records">
                    {recentScrollEvents.map((event) => (
                      <div className="conversation-profiler__record" key={event.id}>
                        <strong>{event.source}</strong>
                        <span>{event.kind}</span>
                        <span>
                          {typeof event.scrollTop === 'number'
                            ? `top ${Math.round(event.scrollTop)}`
                            : typeof event.targetTop === 'number'
                              ? `target ${Math.round(event.targetTop)}`
                              : 'position n/a'}
                        </span>
                        <span>
                          {typeof event.deltaScrollTop === 'number'
                            ? `delta ${Math.round(event.deltaScrollTop)}`
                            : typeof event.deltaTargetTop === 'number'
                              ? `target delta ${Math.round(event.deltaTargetTop)}`
                              : event.detail ?? 'sample'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="conversation-profiler__empty">
                    {i18n._({ id: "Reproduce the viewport jump while capture is active to collect scroll diagnostics.", message: "Reproduce the viewport jump while capture is active to collect scroll diagnostics." })}
                  </div>
                )}
                <div className="conversation-profiler__suggestions">
                  {snapshot.scrollDiagnostics.suggestions.map((suggestion) => (
                    <span className="conversation-profiler__suggestion" key={suggestion}>
                      {suggestion}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="conversation-profiler__empty">
                {i18n._({ id: "Enable scroll capture to record programmatic writes, viewport scroll updates, and virtualization layout shifts.", message: "Enable scroll capture to record programmatic writes, viewport scroll updates, and virtualization layout shifts." })}
              </div>
            )}
          </div>
          <div className="conversation-profiler__section">
            <strong className="conversation-profiler__section-title">{i18n._({ id: "Live", message: "Live" })}</strong>
            {snapshot.liveDiagnosticsEnabled ? (
              <>
                <div className="conversation-profiler__chips">
                  <span className="conversation-profiler__chip conversation-profiler__chip--neutral">
                    {`events:${snapshot.liveDiagnostics.eventCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.liveDiagnostics.streamReceivedCount,
                      1,
                      4,
                    )}`}
                  >
                    {`received:${snapshot.liveDiagnostics.streamReceivedCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.liveDiagnostics.batchFlushCount + snapshot.liveDiagnostics.deferredFlushCount,
                      1,
                      4,
                    )}`}
                  >
                    {`flushes:${snapshot.liveDiagnostics.batchFlushCount + snapshot.liveDiagnostics.deferredFlushCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.liveDiagnostics.filteredCount,
                      1,
                      4,
                    )}`}
                  >
                    {`filtered:${snapshot.liveDiagnostics.filteredCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.liveDiagnostics.replayedCount,
                      1,
                      3,
                    )}`}
                  >
                    {`replayed:${snapshot.liveDiagnostics.replayedCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.liveDiagnostics.snapshotReconciledCount +
                        snapshot.liveDiagnostics.trailingItemPreservedCount,
                      1,
                      3,
                    )}`}
                  >
                    {`reconcile:${snapshot.liveDiagnostics.snapshotReconciledCount + snapshot.liveDiagnostics.trailingItemPreservedCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.liveDiagnostics.refreshRequestCount,
                      1,
                      4,
                    )}`}
                  >
                    {`refresh:${snapshot.liveDiagnostics.refreshRequestCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.liveDiagnostics.unreadMarkedCount +
                        snapshot.liveDiagnostics.viewportDetachedCount +
                        snapshot.liveDiagnostics.jumpToLatestCount,
                      1,
                      4,
                    )}`}
                  >
                    {`viewport:${snapshot.liveDiagnostics.unreadMarkedCount + snapshot.liveDiagnostics.viewportDetachedCount + snapshot.liveDiagnostics.jumpToLatestCount}`}
                  </span>
                  <span
                    className={`conversation-profiler__chip conversation-profiler__chip--${getConversationRenderProfilerTone(
                      snapshot.liveDiagnostics.suppressedCount +
                        snapshot.liveDiagnostics.placeholderCount,
                      1,
                      3,
                    )}`}
                  >
                    {`fallbacks:${snapshot.liveDiagnostics.suppressedCount + snapshot.liveDiagnostics.placeholderCount}`}
                  </span>
                  <span className="conversation-profiler__chip conversation-profiler__chip--neutral">
                    {`last:${formatConversationDiagnosticAge(snapshot.liveDiagnostics.lastEventAgeMs)}`}
                  </span>
                </div>
                <div className="conversation-profiler__records">
                  <div className="conversation-profiler__record">
                    <strong>{i18n._({ id: "selected thread", message: "selected thread" })}</strong>
                    <span>{snapshot.liveDiagnostics.status.selectedThreadId ?? 'none'}</span>
                    <span>{`follow ${snapshot.liveDiagnostics.status.followMode}`}</span>
                    <span>{`pinned ${formatConversationLiveStatusBoolean(snapshot.liveDiagnostics.status.isThreadPinnedToLatest)}`}</span>
                  </div>
                  <div className="conversation-profiler__record">
                    <strong>{i18n._({ id: "viewport state", message: "viewport state" })}</strong>
                    <span>{`unread ${snapshot.liveDiagnostics.status.hasUnreadThreadUpdates ? 'yes' : 'no'}`}</span>
                    <span>{`last live ${formatConversationDiagnosticAge(snapshot.liveDiagnostics.status.lastLiveEventAgeMs)}`}</span>
                    <span>{`last refresh ${formatConversationDiagnosticAge(snapshot.liveDiagnostics.status.lastThreadDetailRefreshAgeMs)}`}</span>
                  </div>
                </div>
                {recentLiveEvents.length ? (
                  <div className="conversation-profiler__records">
                    {recentLiveEvents.map((event) => (
                      <div className="conversation-profiler__record" key={event.id}>
                        <strong>{event.source}</strong>
                        <span>{event.kind}</span>
                        <span>{formatConversationLiveDiagnosticContext(event)}</span>
                        <span>{formatConversationLiveDiagnosticDetail(event)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="conversation-profiler__empty">
                    {i18n._({ id: "Reproduce the missing or delayed live message while capture is active to collect stream, baseline, and suppression diagnostics.", message: "Reproduce the missing or delayed live message while capture is active to collect stream, baseline, and suppression diagnostics." })}
                  </div>
                )}
                <div className="conversation-profiler__suggestions">
                  {snapshot.liveDiagnostics.suggestions.map((suggestion) => (
                    <span className="conversation-profiler__suggestion" key={suggestion}>
                      {suggestion}
                    </span>
                  ))}
                </div>
                {snapshot.liveDiagnostics.suspectedRootCauses.length ? (
                  <>
                    <strong className="conversation-profiler__section-title">
                      {i18n._({ id: "Suspected root causes", message: "Suspected root causes" })}
                    </strong>
                    <div className="conversation-profiler__suggestions">
                      {snapshot.liveDiagnostics.suspectedRootCauses.map((cause) => (
                        <span className="conversation-profiler__suggestion" key={cause}>
                          {cause}
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
                {latestItemLifecycle.length ? (
                  <>
                    <strong className="conversation-profiler__section-title">
                      {i18n._({ id: "Latest item lifecycle", message: "Latest item lifecycle" })}
                    </strong>
                    <div className="conversation-profiler__records">
                      {latestItemLifecycle.map((entry) => (
                        <div className="conversation-profiler__record" key={entry.key}>
                          <strong>{entry.itemType ?? 'item'}</strong>
                          <span>{`${entry.turnId} · ${entry.itemId}`}</span>
                          <span>{formatConversationLiveLifecycleStatus(entry)}</span>
                          <span>{formatConversationLiveLifecycleDetail(entry)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
                {topProblemItems.length ? (
                  <>
                    <strong className="conversation-profiler__section-title">
                      {i18n._({ id: "Top problem items", message: "Top problem items" })}
                    </strong>
                    <div className="conversation-profiler__records">
                      {topProblemItems.map((item) => (
                        <div className="conversation-profiler__record" key={item.key}>
                          <strong>{item.summary}</strong>
                          <span>{`${item.turnId} · ${item.itemId}`}</span>
                          <span>{item.itemType ?? 'item'}</span>
                          <span>{formatConversationLiveProblemItemDetail(item)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="conversation-profiler__empty">
                {i18n._({ id: "Enable live capture to record whether realtime events arrived, were baseline-filtered, replayed, or suppressed by the renderer.", message: "Enable live capture to record whether realtime events arrived, were baseline-filtered, replayed, or suppressed by the renderer." })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
