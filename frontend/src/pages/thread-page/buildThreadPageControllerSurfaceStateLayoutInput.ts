import { getErrorMessage } from '../../lib/error-utils'
import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import { buildWorkspaceRuntimeRecoverySummary } from '../../features/workspaces/runtimeRecovery'

export function buildThreadPageControllerSurfaceStateLayoutInput({
  controllerState,
  dataState,
  displayState,
  mutationState,
  statusState,
  viewportState,
}: BuildThreadPageControllerLayoutPropsInput) {
  const activeSelectedThreadId =
    dataState.resolvedSelectedThreadId ?? controllerState.selectedThreadId
  const isTerminableCommandSession =
    displayState.selectedCommandSession &&
    ['running', 'starting', 'processing'].includes(
      (displayState.selectedCommandSession.status ?? '').toLowerCase(),
    )

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
      controllerState.hasMoreHistoricalTurnsBefore ??
      Boolean(dataState.threadProjection?.hasMoreTurns),
    hasThreads: Boolean(dataState.threadsQuery.data?.length),
    hiddenTurnsCount: Math.max(
      0,
      (dataState.threadProjection?.turnCount ?? displayState.displayedTurns.length) -
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
    isTerminalDockVisible: controllerState.isTerminalDockVisible,
    isTerminalDockExpanded: controllerState.isTerminalDockExpanded,
    isTerminalWindowMaximized: controllerState.isTerminalWindowMaximized,
    isThreadPinnedToLatest: viewportState.isThreadPinnedToLatest,
    isThreadProcessing: statusState.isThreadProcessing,
    isThreadViewportInteracting: viewportState.isThreadViewportInteracting,
    isWaitingForThreadData: statusState.isWaitingForThreadData,
    liveTimelineEntries: displayState.liveTimelineEntries,
    placement: controllerState.terminalDockPlacement,
    queryClient: controllerState.queryClient,
    respondingToApproval: mutationState.respondApprovalMutation.isPending,
    rootPath: dataState.workspaceQuery.data?.rootPath,
    hasRecoverableRuntimeOperation:
      Boolean(controllerState.recoverableSendInput?.trim()) ||
      Boolean(controllerState.recoverableCommandOperation),
    runtimeRecoveryNotice: buildWorkspaceRuntimeRecoverySummary(
      dataState.workspaceRuntimeStateQuery.data,
    ),
    runtimeRecoveryExecutionNotice: controllerState.runtimeRecoveryExecutionNotice,
    restartAndRetryPending: controllerState.isRestartAndRetryPending,
    selectedCommandSession: displayState.selectedCommandSession,
    selectedThread: dataState.selectedThread,
    selectedThreadId: activeSelectedThreadId,
    setIsTerminalDockExpanded: controllerState.setIsTerminalDockExpanded,
    setSurfacePanelSides: controllerState.setSurfacePanelSides,
    startTerminalCommandPending:
      mutationState.startCommandMutation.isPending ||
      (controllerState.isRestartAndRetryPending &&
        Boolean(controllerState.recoverableCommandOperation)),
    restartRuntimePending: mutationState.restartRuntimeMutation.isPending,
    surfacePanelView: controllerState.surfacePanelView,
    terminalDockClassName: statusState.terminalDockClassName,
    terminalWindowBounds: controllerState.terminalWindowBounds,
    terminateDisabled:
      mutationState.terminateCommandMutation.isPending || !isTerminableCommandSession,
    threadDetailError: dataState.threadDetailQuery.error,
    threadDetailIsLoading: dataState.threadDetailQuery.isLoading,
    threadLogStyle: viewportState.threadLogStyle,
    threadRuntimeNotice: statusState.threadRuntimeNotice,
    threadViewportRef: viewportState.threadViewportRef,
    workspaceName: dataState.workspaceQuery.data?.name,
    workspaceId: controllerState.workspaceId,
  }
}
