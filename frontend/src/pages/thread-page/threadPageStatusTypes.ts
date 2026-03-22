import type { Account, PendingApproval, ServerEvent, Thread, ThreadTurn } from '../../types/api'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type { ComposerStatusInfo, ContextCompactionFeedback } from './threadPageComposerShared'

export type ThreadPageStatusStateInput = {
  account?: Account
  accountError: unknown
  activeComposerApproval: PendingApproval | null
  activeContextCompactionFeedback: ContextCompactionFeedback | null
  activePendingTurn: PendingThreadTurn | null
  approvalsDataUpdatedAt: number
  approvalsIsFetching: boolean
  commandSessions: Array<{ status: string }>
  displayedTurnsLength: number
  hasUnreadThreadUpdates: boolean
  interruptPending: boolean
  isInspectorExpanded: boolean
  isMobileViewport: boolean
  isSelectedThreadLoaded: boolean | null
  isTerminalDockExpanded: boolean
  isTerminalDockResizing: boolean
  isThreadPinnedToLatest: boolean
  latestDisplayedTurn?: ThreadTurn
  liveThreadStatus?: string
  selectedThread?: Thread
  selectedThreadEvents: Array<Pick<ServerEvent, 'ts'>>
  selectedThreadId?: string
  sendError: string | null
  streamState: string
  surfacePanelView: 'approvals' | 'feed' | null
  syncClock: number
  threadDetailDataUpdatedAt: number
  threadDetailIsFetching: boolean
  threadsDataUpdatedAt: number
  threadsIsFetching: boolean
  workspaceEvents: Array<Pick<ServerEvent, 'ts'>>
  workspaceId: string
}

export type ThreadPageInteractionStatusInput = Pick<
  ThreadPageStatusStateInput,
  | 'account'
  | 'accountError'
  | 'activeComposerApproval'
  | 'activeContextCompactionFeedback'
  | 'activePendingTurn'
  | 'hasUnreadThreadUpdates'
  | 'interruptPending'
  | 'isThreadPinnedToLatest'
  | 'latestDisplayedTurn'
  | 'selectedThread'
  | 'selectedThreadId'
  | 'sendError'
  | 'streamState'
>

export type ThreadPageSyncStatusInput = Pick<
  ThreadPageStatusStateInput,
  | 'activePendingTurn'
  | 'approvalsDataUpdatedAt'
  | 'approvalsIsFetching'
  | 'selectedThreadId'
  | 'streamState'
  | 'syncClock'
  | 'threadDetailDataUpdatedAt'
  | 'threadDetailIsFetching'
  | 'threadsDataUpdatedAt'
  | 'threadsIsFetching'
  | 'workspaceId'
>

export type ThreadPageWorkbenchStatusInput = Pick<
  ThreadPageStatusStateInput,
  | 'commandSessions'
  | 'displayedTurnsLength'
  | 'isInspectorExpanded'
  | 'isMobileViewport'
  | 'isTerminalDockExpanded'
  | 'isTerminalDockResizing'
  | 'isThreadPinnedToLatest'
  | 'selectedThread'
  | 'selectedThreadEvents'
  | 'selectedThreadId'
  | 'streamState'
  | 'surfacePanelView'
  | 'workspaceEvents'
> & {
  composerStatusInfo: ComposerStatusInfo | null
  mobileStatus: string
  syncLabel: string
}
