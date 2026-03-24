import {
  Profiler,
  useSyncExternalStore,
  type ProfilerOnRenderCallback,
} from 'react'

import type {
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
const SCROLL_DIAGNOSTIC_JITTER_WINDOW_MS = 220

const KNOWN_CONVERSATION_SCROLL_MUTATORS: ConversationScrollMutatorDescriptor[] = [
  {
    file: 'frontend/src/pages/thread-page/useThreadViewportAutoScroll.ts',
    reason:
      'Follows new content, thread-open settle, jump-to-latest, and bottom-clearance changes by calling scrollTo(bottom).',
    source: 'auto-scroll',
  },
  {
    file: 'frontend/src/pages/thread-page/useThreadViewportAutoScroll.ts',
    reason:
      'Restores viewport position after loading older turns through the shared viewport scroll coordinator.',
    source: 'older-turn-restore',
  },
  {
    file: 'frontend/src/components/workspace/useVirtualizedConversationEntries.ts',
    reason:
      'Does not write scrollTop directly, but measured height and padding updates can change scrollHeight while follow mode is active.',
    source: 'virtualization-layout',
  },
]

const conversationRenderProfilerListeners = new Set<() => void>()
const conversationRenderProfilerRecords = new Map<string, ConversationRenderProfilerRecordState>()
const conversationScrollDiagnosticEvents: ConversationScrollDiagnosticEvent[] = []

let conversationRenderProfilerEnabled = false
let conversationRenderProfilerInitialized = false
let conversationRenderProfilerPanelVisible = false
let conversationScrollDiagnosticsEnabled = false
let conversationScrollDiagnosticEventId = 0
let conversationRenderProfilerNotificationFrame: number | null = null
let conversationRenderProfilerSnapshotCache: ConversationRenderProfilerSnapshot | null = null

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
      'Scroll the thread or wait for live output to collect a fresh five second window.',
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
      'Parent commits dominate this window; verify surface props and turns or entries identity during scroll.',
    )
  }

  if (
    rowRecord &&
    rowRecord.recentCommitCount > 0 &&
    rowRecord.recentCommitCount > itemCommitCount
  ) {
    suggestions.push(
      'Row wrappers are committing more often than memoized items; stable windows may still be rebuilding entry shells.',
    )
  }

  if (hottestTimelineItem && hottestTimelineItem.recentActualDuration >= 8) {
    suggestions.push(
      `Visible item subtree work is concentrated in ${hottestTimelineItem.id}; inspect that renderer path next.`,
    )
  }

  if (!suggestions.length) {
    suggestions.push(
      'This window looks fairly balanced. Capture one run while scrolling and another while live output streams, then compare the hottest records.',
    )
  }

  return suggestions.slice(0, 3)
}

export function buildConversationScrollDiagnosticsSuggestions(
  snapshot: ConversationScrollDiagnosticsSuggestionsInput,
): string[] {
  if (!snapshot.eventCount) {
    return [
      'Enable scroll capture, then reproduce the jump or jitter to collect viewport and programmatic scroll events.',
    ]
  }

  const suggestions: string[] = []
  const topSource = snapshot.topSources[0]?.source

  if (snapshot.candidateJitterCount > 0) {
    suggestions.push(
      'Rapid direction changes were detected inside the viewport event stream; inspect the export around those timestamps first.',
    )
  }

  if (snapshot.rapidProgrammaticWriteCount > 1) {
    suggestions.push(
      'Multiple programmatic scroll writes landed inside a short window; auto-follow and layout correction may be competing.',
    )
  }

  if (snapshot.layoutChangeCount > 0 && snapshot.programmaticScrollCount > 0) {
    suggestions.push(
      'Layout-changing virtualization events overlapped with programmatic scroll writes; measured heights are a likely contributor to visible jitter.',
    )
  }

  if (!suggestions.length && topSource) {
    suggestions.push(
      `The busiest scroll source in this capture is ${topSource}; start the trace review there.`,
    )
  }

  if (!suggestions.length && snapshot.viewportScrollCount > 0) {
    suggestions.push(
      'Only viewport scroll observations were captured. Re-run with the jitter reproduced while follow mode is active to catch competing writes.',
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

export function buildConversationRenderProfilerSnapshot(
  records: Iterable<ConversationRenderProfilerRecordState>,
  options?: {
    enabled?: boolean
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

export function exportConversationRenderProfilerAnalysis() {
  if (!import.meta.env.DEV || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const snapshot = getConversationRenderProfilerSnapshot()
  const payload = {
    exportedAt: new Date().toISOString(),
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
      events: conversationScrollDiagnosticEvents,
      summary: snapshot.scrollDiagnostics,
    },
  }

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
      Profile
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
  const recentScrollEvents = snapshot.scrollDiagnostics.recentEvents.slice().reverse()
  const canExport =
    snapshot.records.length > 0 || snapshot.scrollDiagnostics.eventCount > 0

  return (
    <div className="conversation-profiler" data-testid="conversation-profiler">
      <div className="conversation-profiler__card">
        <div className="conversation-profiler__header">
          <div className="conversation-profiler__toolbar">
            <div className="conversation-profiler__heading">
              <span className="conversation-profiler__eyebrow">Diagnostics</span>
              <span className="conversation-profiler__title">Thread Profile</span>
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
                  {snapshot.enabled ? 'Pause Render' : 'Record Render'}
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
                  {snapshot.scrollDiagnosticsEnabled ? 'Pause Scroll' : 'Record Scroll'}
                </button>
              </div>
              <div className="conversation-profiler__action-row conversation-profiler__action-row--secondary">
                <button
                  className="pane-section__toggle conversation-profiler__action"
                  disabled={!snapshot.records.length && !snapshot.scrollDiagnostics.eventCount}
                  onClick={resetConversationRenderProfiler}
                  type="button"
                >
                  Reset
                </button>
                <button
                  className="pane-section__toggle conversation-profiler__action"
                  disabled={!canExport}
                  onClick={exportConversationRenderProfilerAnalysis}
                  type="button"
                >
                  Export
                </button>
                <button
                  className="pane-section__toggle conversation-profiler__action conversation-profiler__action--dismiss"
                  onClick={() => setConversationRenderProfilerPanelVisible(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
          <p className="conversation-profiler__description">
            Recent React commits for the workbench surface and timeline subtree.
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
            <span className="conversation-profiler__chip conversation-profiler__chip--neutral">
              {canExport ? 'snapshot ready' : 'waiting for samples'}
            </span>
          </div>
        </div>
        <div className="conversation-profiler__body">
          <div className="conversation-profiler__section">
            <strong className="conversation-profiler__section-title">Render</strong>
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
                    Scroll the thread or let live output stream to collect render samples.
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
                Start render profiling to capture React commit cost inside the thread surface.
              </div>
            )}
          </div>
          <div className="conversation-profiler__section">
            <strong className="conversation-profiler__section-title">Scroll</strong>
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
                    Reproduce the viewport jump while capture is active to collect scroll diagnostics.
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
                Enable scroll capture to record programmatic writes, viewport scroll updates, and virtualization layout shifts.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
