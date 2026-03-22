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
  | 'displayedTurns'
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
  | 'threadViewportRef'
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
  return {
    activeCommandCount: statusState.activeCommandCount,
    activePendingTurnPhase: controllerState.activePendingTurn?.phase,
    activeSurfacePanelSide: controllerState.activeSurfacePanelSide,
    approvalAnswers: controllerState.approvalAnswers,
    approvalErrors: controllerState.approvalErrors,
    approvals: dataState.approvalsQuery.data,
    commandSessions: dataState.commandSessions,
    displayedTurns: displayState.displayedTurns,
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
    selectedThreadId: controllerState.selectedThreadId,
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
    threadViewportRef: viewportState.threadViewportRef,
    workspaceId: controllerState.workspaceId,
  }
}
