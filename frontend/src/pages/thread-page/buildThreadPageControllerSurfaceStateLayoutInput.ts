import { getErrorMessage } from '../../lib/error-utils'
import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerSurfaceLayoutInput } from './threadPageControllerLayoutInputTypes'

type SurfaceStateLayoutInput = Pick<
  ControllerSurfaceLayoutInput,
  | 'activeCommandCount'
  | 'activePendingTurnPhase'
  | 'activeSurfacePanelSide'
  | 'approvalAnswers'
  | 'approvalErrors'
  | 'approvals'
  | 'commandSessions'
  | 'createThreadErrorMessage'
  | 'displayedTurns'
  | 'hasMoreTurnsBefore'
  | 'hasThreads'
  | 'hiddenTurnsCount'
  | 'isCreateThreadPending'
  | 'isLoadingOlderTurns'
  | 'isThreadsLoaded'
  | 'isThreadSelectionLoading'
  | 'isMobileViewport'
  | 'isSurfacePanelResizing'
  | 'isTerminalDockExpanded'
  | 'isThreadPinnedToLatest'
  | 'isThreadProcessing'
  | 'isWaitingForThreadData'
  | 'liveTimelineEntries'
  | 'queryClient'
  | 'respondingToApproval'
  | 'selectedCommandSession'
  | 'selectedThread'
  | 'selectedThreadId'
  | 'setIsTerminalDockExpanded'
  | 'setSurfacePanelSides'
  | 'stdinValue'
  | 'surfacePanelView'
  | 'terminalDockClassName'
  | 'terminateDisabled'
  | 'threadDetailError'
  | 'threadDetailIsLoading'
  | 'threadLogStyle'
  | 'threadRuntimeNotice'
  | 'timelineIdentity'
  | 'threadViewportRef'
  | 'workspaceName'
  | 'workspaceId'
>

export function buildThreadPageControllerSurfaceStateLayoutInput({
  controllerState,
  dataState,
  displayState,
  mutationState,
  statusState,
  viewportState,
}: BuildThreadPageControllerLayoutPropsInput): SurfaceStateLayoutInput {
  const activeSelectedThreadId =
    dataState.resolvedSelectedThreadId ?? controllerState.selectedThreadId

  return {
    activeCommandCount: statusState.activeCommandCount,
    activePendingTurnPhase: controllerState.activePendingTurn?.phase,
    activeSurfacePanelSide: controllerState.activeSurfacePanelSide,
    approvalAnswers: controllerState.approvalAnswers,
    approvalErrors: controllerState.approvalErrors,
    approvals: dataState.approvalsQuery.data,
    commandSessions: dataState.commandSessions,
    createThreadErrorMessage: mutationState.createThreadMutation.error
      ? getErrorMessage(mutationState.createThreadMutation.error)
      : undefined,
    displayedTurns: displayState.displayedTurns,
    hasMoreTurnsBefore:
      controllerState.hasMoreHistoricalTurnsBefore ?? Boolean(dataState.liveThreadDetail?.hasMoreTurns),
    hasThreads: Boolean(dataState.threadsQuery.data?.length),
    hiddenTurnsCount: Math.max(
      0,
      (dataState.liveThreadDetail?.turnCount ?? displayState.displayedTurns.length) -
        displayState.displayedTurns.length,
    ),
    isCreateThreadPending: mutationState.createThreadMutation.isPending,
    isLoadingOlderTurns: controllerState.isLoadingOlderTurns,
    isThreadsLoaded: dataState.threadsQuery.isSuccess,
    isThreadSelectionLoading:
      !dataState.selectedThread &&
      !dataState.resolvedSelectedThreadId &&
      dataState.threadsQuery.isLoading,
    isMobileViewport: controllerState.isMobileViewport,
    isSurfacePanelResizing: controllerState.isSurfacePanelResizing,
    isTerminalDockExpanded: controllerState.isTerminalDockExpanded,
    isThreadPinnedToLatest: viewportState.isThreadPinnedToLatest,
    isThreadProcessing: statusState.isThreadProcessing,
    isWaitingForThreadData: statusState.isWaitingForThreadData,
    liveTimelineEntries: displayState.liveTimelineEntries,
    queryClient: controllerState.queryClient,
    respondingToApproval: mutationState.respondApprovalMutation.isPending,
    selectedCommandSession: displayState.selectedCommandSession,
    selectedThread: dataState.selectedThread,
    selectedThreadId: activeSelectedThreadId,
    setIsTerminalDockExpanded: controllerState.setIsTerminalDockExpanded,
    setSurfacePanelSides: controllerState.setSurfacePanelSides,
    stdinValue: controllerState.stdinValue,
    surfacePanelView: controllerState.surfacePanelView,
    terminalDockClassName: statusState.terminalDockClassName,
    terminateDisabled: !displayState.selectedCommandSession?.id,
    threadDetailError: dataState.threadDetailQuery.error,
    threadDetailIsLoading: dataState.threadDetailQuery.isLoading,
    threadLogStyle: viewportState.threadLogStyle,
    threadRuntimeNotice: statusState.threadRuntimeNotice,
    timelineIdentity: activeSelectedThreadId ?? '',
    threadViewportRef: viewportState.threadViewportRef,
    workspaceName: dataState.workspaceQuery.data?.name,
    workspaceId: controllerState.workspaceId,
  }
}
