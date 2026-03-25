import type { ThreadTurn } from '../../types/api'
import type { ThreadDisplayMetrics } from '../threadPageUtils'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type { ThreadContentSignature } from './threadContentSignature'

export type TurnItemOverrideCacheNode = {
  byItemIndex?: Map<number, TurnItemOverrideCacheNode>
  byOverrideKind?: Map<number, TurnItemOverrideCacheNode>
  byOverrideRef?: WeakMap<Record<string, unknown>, TurnItemOverrideCacheNode>
  result?: ThreadTurn
}

export type TurnOverrideCacheNode = {
  byTurnIndex?: Map<number, TurnOverrideCacheNode>
  byOverrideRef?: WeakMap<ThreadTurn, TurnOverrideCacheNode>
  result?: ThreadTurn[]
}

export type TurnReplacementRef = {
  turnIndex: number
  turnRef: ThreadTurn
}

export type ItemOverrideMetadata = {
  byTurnId: Map<string, Map<string, Record<string, unknown>>>
  count: number
  turnIds: string[]
}

export type TurnOverrideMetadata = {
  count: number
  turnIds: string[]
}

export type TurnMetadata = {
  hasUserMessage?: boolean
  itemIndexById?: Map<string, number>
}

export type PendingTurnMetadata = {
  messageKey?: string
  standaloneTurn?: ThreadTurn
  userMessageItem?: Record<string, unknown>
}

export type ThreadPageTurnDisplayStateResult = {
  displayedTurns: ThreadTurn[]
  loadedAssistantMessageCount: number
  loadedMessageCount: number
  loadedUserMessageCount: number
  oldestDisplayedTurnId?: string
  latestDisplayedTurn?: ThreadTurn
  settledMessageAutoScrollKey: string
  threadUnreadUpdateKey: string
  threadContentSignature: ThreadContentSignature
  timelineItemCount: number
  turnCount: number
}

export type TurnDisplayStateCacheBucket = {
  nullPendingByThreadId: Map<string, ThreadPageTurnDisplayStateResult>
  pendingByThreadId: Map<string, WeakMap<PendingThreadTurn, ThreadPageTurnDisplayStateResult>>
}

export type TurnArrayCacheEntry = {
  combinedOverrideResults: WeakMap<
    Record<string, ThreadTurn>,
    WeakMap<
      Record<string, Record<string, unknown>>,
      WeakMap<Record<string, Record<string, unknown>>, ThreadTurn[]>
    >
  >
  displayState: TurnDisplayStateCacheBucket
  itemOverrideResults: WeakMap<
    Record<string, Record<string, unknown>>,
    WeakMap<Record<string, Record<string, unknown>>, ThreadTurn[]>
  >
  pendingInjectedMetrics: WeakMap<PendingThreadTurn, ThreadDisplayMetrics>
  pendingStandaloneMetrics: WeakMap<PendingThreadTurn, ThreadDisplayMetrics>
  pendingTurnResults: WeakMap<PendingThreadTurn, ThreadTurn[]>
  turnIndexById?: Map<string, number>
  turnOverrideResultTree: TurnOverrideCacheNode
  turnOverrideResults: WeakMap<Record<string, ThreadTurn>, ThreadTurn[]>
}
