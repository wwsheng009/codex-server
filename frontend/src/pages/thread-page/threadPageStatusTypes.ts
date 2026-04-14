import type { Account, PendingApproval, Thread, ThreadTurn } from '../../types/api'
import type { SurfacePanelView, TerminalDockPlacement } from '../../lib/layout-config-types'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type { ComposerStatusInfo, ContextCompactionFeedback } from './threadPageComposerShared'
import type { ThreadPageRecoverableRuntimeActionKind } from './threadPageRuntimeRecovery'

export type ThreadPageStatusEventTimestamp = {
  ts: string
}

export type ThreadPageStatusStateInput = {
  account?: Account
  accountError: unknown
  activeComposerApproval: PendingApproval | null
  activeContextCompactionFeedback: ContextCompactionFeedback | null
  activePendingTurn: PendingThreadTurn | null
  activeCommandCount: number
  approvalsDataUpdatedAt: number
  approvalsIsFetching: boolean
  commandSessionCount: number
  displayedTurnsLength: number
  hasRecoverableRuntimeOperation: boolean
  recoverableRuntimeActionKind: ThreadPageRecoverableRuntimeActionKind | null
  hasUnreadThreadUpdates: boolean
  isDocumentVisible: boolean
  interruptPending: boolean
  isInspectorExpanded: boolean
  isMobileViewport: boolean
  isTerminalDockVisible: boolean
  isSelectedThreadLoaded: boolean | null
  isTerminalDockExpanded: boolean
  isTerminalDockResizing: boolean
  isTerminalWindowDragging: boolean
  isTerminalWindowMaximized: boolean
  isTerminalWindowResizing: boolean
  terminalDockPlacement: TerminalDockPlacement
  isThreadPinnedToLatest: boolean
  latestDisplayedTurn?: ThreadTurn
  liveThreadStatus?: string
  restartAndRetryPending: boolean
  selectedThread?: Thread
  selectedThreadEvents: ThreadPageStatusEventTimestamp[]
  selectedThreadId?: string
  sendError: string | null
  suppressAuthenticationError: boolean
  streamState: string
  surfacePanelView: SurfacePanelView | null
  syncClock: number
  threadDetailDataUpdatedAt: number
  threadDetailIsFetching: boolean
  threadsDataUpdatedAt: number
  threadsIsFetching: boolean
  workspaceEvents: ThreadPageStatusEventTimestamp[]
  workspaceId: string
}

export type ThreadPageInteractionStatusInput = {
  account?: Account
  accountError: unknown
  activeComposerApproval: PendingApproval | null
  activeContextCompactionFeedback: ContextCompactionFeedback | null
  activePendingTurn: PendingThreadTurn | null
  hasRecoverableRuntimeOperation: boolean
  recoverableRuntimeActionKind: ThreadPageRecoverableRuntimeActionKind | null
  hasUnreadThreadUpdates: boolean
  interruptPending: boolean
  isThreadPinnedToLatest: boolean
  latestDisplayedTurn?: ThreadTurn
  restartAndRetryPending: boolean
  selectedThread?: Thread
  selectedThreadId?: string
  sendError: string | null
  streamState: string
  suppressAuthenticationError: boolean
}

export type ThreadPageSyncStatusInput = {
  activePendingTurn: PendingThreadTurn | null
  approvalsDataUpdatedAt: number
  approvalsIsFetching: boolean
  selectedThreadId?: string
  streamState: string
  syncClock: number
  threadDetailDataUpdatedAt: number
  threadDetailIsFetching: boolean
  threadsDataUpdatedAt: number
  threadsIsFetching: boolean
  workspaceId: string
}

export type ThreadPageWorkbenchStatusInput = {
  activeCommandCount: number
  commandSessionCount: number
  composerStatusInfo: ComposerStatusInfo | null
  displayedTurnsLength: number
  isInspectorExpanded: boolean
  isMobileViewport: boolean
  isTerminalDockExpanded: boolean
  isTerminalDockResizing: boolean
  isTerminalDockVisible: boolean
  isTerminalWindowDragging: boolean
  isTerminalWindowMaximized: boolean
  isTerminalWindowResizing: boolean
  isThreadPinnedToLatest: boolean
  mobileStatus: string
  selectedThread?: Thread
  selectedThreadEvents: ThreadPageStatusEventTimestamp[]
  selectedThreadId?: string
  streamState: string
  surfacePanelView: SurfacePanelView | null
  syncLabel: string
  terminalDockPlacement: TerminalDockPlacement
  workspaceEvents: ThreadPageStatusEventTimestamp[]
}
