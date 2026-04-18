import type { ReactNode } from 'react'

export type DebugTone = 'neutral' | 'warn' | 'danger' | 'good'

export type ConversationScrollDiagnosticKind =
  | 'viewport-scroll'
  | 'programmatic-scroll'
  | 'virtualization-range'
  | 'virtualization-layout'
  | 'older-turn-anchor'
  | 'user-intent'

export type ConversationScrollDiagnosticMetadata = Record<
  string,
  boolean | number | string | null
>

export type ConversationLiveDiagnosticKind =
  | 'stream-received'
  | 'stream-batch-flush'
  | 'stream-deferred-flush'
  | 'baseline-filtered'
  | 'baseline-replayed'
  | 'snapshot-reconciled'
  | 'snapshot-trailing-item-preserved'
  | 'thread-detail-refresh-requested'
  | 'unread-marked'
  | 'jump-to-latest'
  | 'viewport-detached'
  | 'timeline-placeholder'
  | 'timeline-suppressed'

export type ConversationLiveDiagnosticMetadata = Record<
  string,
  boolean | number | string | null
>

export type ConversationScrollDiagnosticEventInput = {
  behavior?: string
  clientHeight?: number
  detail?: string
  kind: ConversationScrollDiagnosticKind
  metadata?: ConversationScrollDiagnosticMetadata
  scrollHeight?: number
  scrollTop?: number
  source: string
  targetTop?: number
}

export type ConversationLiveDiagnosticEventInput = {
  itemId?: string | null
  itemType?: string | null
  kind: ConversationLiveDiagnosticKind
  metadata?: ConversationLiveDiagnosticMetadata
  method?: string
  reason?: string
  serverRequestId?: string | null
  source: string
  threadId?: string | null
  turnId?: string | null
}

export type ConversationRenderProfilerSample = {
  actualDuration: number
  baseDuration: number
  commitTime: number
}

export type ConversationScrollMutatorDescriptor = {
  file: string
  reason: string
  source: string
}

export type ConversationScrollDiagnosticEvent = {
  behavior?: string
  clientHeight?: number
  deltaScrollTop?: number | null
  deltaTargetTop?: number | null
  detail?: string
  id: number
  kind: ConversationScrollDiagnosticKind
  metadata?: ConversationScrollDiagnosticMetadata
  scrollHeight?: number
  scrollTop?: number
  source: string
  targetTop?: number
  timeSincePreviousEventMs?: number | null
  ts: number
}

export type ConversationScrollDiagnosticsSnapshot = {
  candidateJitterCount: number
  enabled: boolean
  eventCount: number
  lastEvent: ConversationScrollDiagnosticEvent | null
  layoutChangeCount: number
  maxAbsoluteScrollDelta: number
  maxAbsoluteTargetDelta: number
  programmaticScrollCount: number
  rapidProgrammaticWriteCount: number
  recentEvents: ConversationScrollDiagnosticEvent[]
  suggestions: string[]
  topSources: Array<{
    count: number
    source: string
  }>
  userIntentCount: number
  viewportScrollCount: number
}

export type ConversationLiveDiagnosticEvent = {
  id: number
  itemId?: string | null
  itemType?: string | null
  kind: ConversationLiveDiagnosticKind
  metadata?: ConversationLiveDiagnosticMetadata
  method?: string
  reason?: string
  serverRequestId?: string | null
  source: string
  threadId?: string | null
  ts: number
  turnId?: string | null
}

export type ConversationLiveItemLifecycleEntry = {
  completedAt: number | null
  deltaCount: number
  filteredCount: number
  finalTextLength: number
  itemId: string
  itemType: string | null
  key: string
  lastDeltaAt: number | null
  lastEventKind: ConversationLiveDiagnosticKind
  lastEventTs: number
  placeholderRendered: boolean
  replayedCount: number
  snapshotPreservedCount: number
  snapshotReconciledCount: number
  startedAt: number | null
  suppressedReason: string | null
  turnId: string
}

export type ConversationLiveProblemItem = {
  evidence: string[]
  itemId: string
  itemType: string | null
  key: string
  score: number
  summary: string
  turnId: string
}

export type ConversationLiveDiagnosticsStatus = {
  followMode: 'detached' | 'follow' | 'unknown'
  hasUnreadThreadUpdates: boolean
  lastLiveEventAgeMs: number | null
  isThreadPinnedToLatest: boolean | null
  lastLiveEventAt: number | null
  lastThreadDetailRefreshAgeMs: number | null
  lastThreadDetailRefreshAt: number | null
  selectedThreadId: string | null
}

export type ConversationLiveDiagnosticsSnapshot = {
  batchFlushCount: number
  deferredFlushCount: number
  enabled: boolean
  eventCount: number
  filteredCount: number
  jumpToLatestCount: number
  lastEvent: ConversationLiveDiagnosticEvent | null
  lastEventAgeMs: number | null
  latestItemLifecycle: ConversationLiveItemLifecycleEntry[]
  placeholderCount: number
  recentEvents: ConversationLiveDiagnosticEvent[]
  refreshRequestCount: number
  replayedCount: number
  snapshotReconciledCount: number
  suspectedRootCauses: string[]
  streamReceivedCount: number
  suggestions: string[]
  suppressedCount: number
  topProblemItems: ConversationLiveProblemItem[]
  trailingItemPreservedCount: number
  unreadMarkedCount: number
  viewportDetachedCount: number
  status: ConversationLiveDiagnosticsStatus
  topSources: Array<{
    count: number
    source: string
  }>
}

export type ConversationScrollDiagnosticsSuggestionsInput = {
  candidateJitterCount: number
  eventCount: number
  layoutChangeCount: number
  programmaticScrollCount: number
  rapidProgrammaticWriteCount: number
  topSources: Array<{
    count: number
    source: string
  }>
  viewportScrollCount: number
}

export type ConversationRenderProfilerBoundaryProps = {
  children: ReactNode
  id: string
}

export type ConversationRenderProfilerRailToggleProps = {
  disabled?: boolean
}

export type ConversationRenderProfilerRecordState = {
  id: string
  lastActualDuration: number
  lastBaseDuration: number
  lastCommitTime: number
  maxActualDuration: number
  mountCount: number
  nestedUpdateCount: number
  samples: ConversationRenderProfilerSample[]
  totalActualDuration: number
  totalBaseDuration: number
  updateCount: number
}

export type ConversationRenderProfilerRecord = {
  id: string
  lastActualDuration: number
  lastBaseDuration: number
  lastCommitTime: number
  maxActualDuration: number
  mountCount: number
  nestedUpdateCount: number
  recentActualDuration: number
  recentAverageActualDuration: number
  recentCommitCount: number
  recentMaxActualDuration: number
  totalActualDuration: number
  totalBaseDuration: number
  totalCommitCount: number
  updateCount: number
}

export type ConversationRenderProfilerSnapshot = {
  enabled: boolean
  liveDiagnostics: ConversationLiveDiagnosticsSnapshot
  liveDiagnosticsEnabled: boolean
  knownScrollMutators: ConversationScrollMutatorDescriptor[]
  lastCommitTime: number | null
  panelVisible: boolean
  records: ConversationRenderProfilerRecord[]
  scrollDiagnostics: ConversationScrollDiagnosticsSnapshot
  scrollDiagnosticsEnabled: boolean
  suggestions: string[]
  totalRecentActualDuration: number
  totalRecentCommitCount: number
  totalRecentMaxActualDuration: number
  windowMs: number
}
