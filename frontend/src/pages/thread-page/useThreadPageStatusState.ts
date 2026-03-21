import { useMemo } from 'react'

import { isAuthenticationError } from '../../lib/error-utils'
import type { Account, PendingApproval, ServerEvent, Thread, ThreadTurn } from '../../types/api'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import {
  buildComposerStatusInfo,
  compactStatusLabel,
  compactStatusTone,
  compactSyncLabel,
  formatSyncCountdown,
  statusIsInterruptible,
  type ContextCompactionFeedback,
} from './threadPageComposerShared'

export function useThreadPageStatusState({
  account,
  accountError,
  activeComposerApproval,
  activeContextCompactionFeedback,
  activePendingTurn,
  approvalsDataUpdatedAt,
  approvalsIsFetching,
  commandSessions,
  displayedTurnsLength,
  hasUnreadThreadUpdates,
  interruptPending,
  isInspectorExpanded,
  isMobileViewport,
  isSelectedThreadLoaded,
  isTerminalDockExpanded,
  isTerminalDockResizing,
  isThreadPinnedToLatest,
  latestDisplayedTurn,
  liveThreadStatus,
  selectedThread,
  selectedThreadEvents,
  selectedThreadId,
  sendError,
  streamState,
  surfacePanelView,
  syncClock,
  threadDetailDataUpdatedAt,
  threadDetailIsFetching,
  threadsDataUpdatedAt,
  threadsIsFetching,
  workspaceEvents,
  workspaceId,
}: {
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
}) {
  const isWaitingForThreadData = Boolean(activePendingTurn)
  const isSendingSelectedThread = activePendingTurn?.phase === 'sending'
  const isApprovalDialogOpen = Boolean(activeComposerApproval)
  const requiresOpenAIAuth =
    account?.status === 'requires_openai_auth' || isAuthenticationError(accountError)

  const isThreadInterruptible = Boolean(
    selectedThreadId &&
      (isWaitingForThreadData ||
        statusIsInterruptible(selectedThread?.status) ||
        statusIsInterruptible(latestDisplayedTurn?.status)),
  )

  const isSendBusy = isWaitingForThreadData
  const isThreadProcessing =
    isWaitingForThreadData || interruptPending || isThreadInterruptible
  const compactDisabledReason = !selectedThreadId
    ? 'Select a thread to compact its context.'
    : activeContextCompactionFeedback?.phase === 'requested'
      ? 'Compaction is already running. This panel will update when the runtime confirms it.'
      : isThreadProcessing
        ? 'Wait until the current reply finishes before compacting this thread.'
        : null

  const isInterruptMode = Boolean(
    selectedThreadId &&
      !isApprovalDialogOpen &&
      !isSendingSelectedThread &&
      (interruptPending || isThreadInterruptible),
  )

  const isComposerLocked =
    isApprovalDialogOpen ||
    isWaitingForThreadData ||
    interruptPending ||
    isThreadInterruptible

  const sendButtonLabel = interruptPending
    ? 'Stopping…'
    : isSendingSelectedThread
      ? 'Sending…'
      : isInterruptMode
        ? 'Stop'
        : 'Send'

  const shouldShowComposerSpinner =
    isSendingSelectedThread || interruptPending || isInterruptMode

  const composerActivityTitle = interruptPending
    ? 'Stopping current reply…'
    : isSendingSelectedThread
      ? 'Sending message to Codex…'
      : isThreadInterruptible
        ? 'Codex is replying…'
        : null

  const composerActivityDetail = interruptPending
    ? 'The runtime is stopping the active turn. The thread will settle in place when it completes.'
    : isSendingSelectedThread
      ? 'Your message is staged. The primary action will switch to Stop as soon as the turn is live.'
      : isThreadInterruptible
        ? isThreadPinnedToLatest
          ? 'Auto-follow is keeping the latest output in view.'
          : hasUnreadThreadUpdates
            ? 'New output is available below. Jump to latest to follow it.'
            : 'Scroll back to the latest message to resume auto-follow.'
        : null

  const mobileStatus = isWaitingForThreadData ? 'running' : selectedThread?.status ?? streamState
  const composerStatusMessage = sendError

  const composerStatusInfo = useMemo(
    () =>
      buildComposerStatusInfo({
        streamState,
        rawThreadStatus: liveThreadStatus ?? selectedThread?.status,
        latestTurnStatus: latestDisplayedTurn?.status,
        latestTurnError: latestDisplayedTurn?.error,
        sendError,
        requiresOpenAIAuth,
        isApprovalDialogOpen,
        approvalSummary: activeComposerApproval?.summary,
        isWaitingForThreadData,
        pendingPhase: activePendingTurn?.phase,
        isThreadInterruptible,
        isThreadLoaded: isSelectedThreadLoaded,
      }),
    [
      activeComposerApproval?.summary,
      activePendingTurn?.phase,
      isApprovalDialogOpen,
      isSelectedThreadLoaded,
      isThreadInterruptible,
      isWaitingForThreadData,
      latestDisplayedTurn?.error,
      latestDisplayedTurn?.status,
      liveThreadStatus,
      requiresOpenAIAuth,
      selectedThread?.status,
      sendError,
      streamState,
    ],
  )

  const threadDetailPollIntervalMs = selectedThreadId
    ? activePendingTurn
      ? 1_000
      : streamState !== 'open'
        ? 5_000
        : null
    : null
  const approvalsPollIntervalMs = workspaceId && streamState !== 'open' ? 4_000 : null
  const autoSyncIntervalMs = [threadDetailPollIntervalMs, approvalsPollIntervalMs].reduce<number | null>(
    (current, value) => {
      if (typeof value !== 'number') {
        return current
      }

      return current === null ? value : Math.min(current, value)
    },
    null,
  )

  const lastAutoSyncAtMs = Math.max(
    threadsDataUpdatedAt || 0,
    selectedThreadId ? threadDetailDataUpdatedAt || 0 : 0,
    approvalsDataUpdatedAt || 0,
  )
  const isHeaderSyncBusy =
    threadsIsFetching ||
    (Boolean(selectedThreadId) && threadDetailIsFetching) ||
    approvalsIsFetching

  const syncCountdownLabel = isHeaderSyncBusy
    ? 'Syncing…'
    : autoSyncIntervalMs
      ? `Next sync ${formatSyncCountdown(lastAutoSyncAtMs, autoSyncIntervalMs, syncClock)}`
      : streamState === 'open'
        ? 'Live'
        : 'Manual sync'

  const activeCommandCount = commandSessions.filter((session) => session.status === 'running').length
  const lastTimelineEventTs =
    selectedThreadEvents[selectedThreadEvents.length - 1]?.ts ??
    workspaceEvents[workspaceEvents.length - 1]?.ts

  const terminalDockClassName = [
    'terminal-dock',
    'terminal-dock--attached',
    !commandSessions.length ? 'terminal-dock--empty' : '',
    !isTerminalDockExpanded ? 'terminal-dock--collapsed' : '',
    isTerminalDockResizing ? 'terminal-dock--resizing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const isMobileInspectorOpen = isMobileViewport && isInspectorExpanded
  const isMobileSurfacePanelOpen = isMobileViewport && Boolean(surfacePanelView)
  const isMobileWorkbenchOverlayOpen = isMobileInspectorOpen || isMobileSurfacePanelOpen
  const showJumpToLatestButton = Boolean(
    selectedThread && displayedTurnsLength > 0 && !isThreadPinnedToLatest,
  )

  const threadRuntimeNotice =
    composerStatusInfo?.noticeTitle && composerStatusInfo.noticeMessage
      ? {
          title: composerStatusInfo.noticeTitle,
          message: composerStatusInfo.noticeMessage,
          summary: composerStatusInfo.summary,
          noticeKey: `thread-runtime-${selectedThreadId}-${composerStatusInfo.label}`,
        }
      : undefined

  const composerStatusRetryLabel = accountError ? 'Refresh Status' : 'Dismiss Error'
  const chromeState = {
    statusLabel: compactStatusLabel(mobileStatus),
    statusTone: compactStatusTone(mobileStatus),
    syncLabel: compactSyncLabel(syncCountdownLabel, streamState),
  }

  return {
    activeCommandCount,
    autoSyncIntervalMs,
    chromeState,
    compactDisabledReason,
    composerActivityDetail,
    composerActivityTitle,
    composerStatusInfo,
    composerStatusMessage,
    composerStatusRetryLabel,
    isApprovalDialogOpen,
    isComposerLocked,
    isHeaderSyncBusy,
    isInterruptMode,
    isMobileWorkbenchOverlayOpen,
    isSendBusy,
    isSendingSelectedThread,
    isThreadInterruptible,
    isThreadProcessing,
    isWaitingForThreadData,
    lastTimelineEventTs,
    mobileStatus,
    requiresOpenAIAuth,
    sendButtonLabel,
    shouldShowComposerSpinner,
    showJumpToLatestButton,
    syncCountdownLabel,
    terminalDockClassName,
    threadRuntimeNotice,
  }
}
