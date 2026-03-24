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
