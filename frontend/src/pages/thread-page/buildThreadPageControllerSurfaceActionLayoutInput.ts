import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerSurfaceLayoutInput } from './threadPageControllerLayoutInputTypes'

type SurfaceActionLayoutInput = Pick<
  ControllerSurfaceLayoutInput,
  | 'onChangeApprovalAnswer'
  | 'onChangeStdinValue'
  | 'onClearCompletedSessions'
  | 'onCloseWorkbenchOverlay'
  | 'onCreateThread'
  | 'onLoadOlderTurns'
  | 'onRemoveSession'
  | 'onRespondApproval'
  | 'onResizeStart'
  | 'onRetryServerRequest'
  | 'onSelectSession'
  | 'onSubmitStdin'
  | 'onSurfacePanelResizeStart'
  | 'onTerminateSelectedSession'
  | 'onThreadViewportScroll'
>

export function buildThreadPageControllerSurfaceActionLayoutInput({
  composerActions,
  controllerState,
  mutationState,
  pageActions,
  railState,
  viewportState,
}: BuildThreadPageControllerLayoutPropsInput): SurfaceActionLayoutInput {
  return {
    onChangeApprovalAnswer: pageActions.handleApprovalAnswerChange,
    onChangeStdinValue: controllerState.setStdinValue,
    onClearCompletedSessions: pageActions.handleClearCompletedCommandSessions,
    onCloseWorkbenchOverlay: railState.handleCloseWorkbenchOverlay,
    onCreateThread: () => {
      mutationState.createThreadMutation.reset()
      mutationState.createThreadMutation.mutate()
    },
    onLoadOlderTurns: pageActions.handleLoadOlderTurns,
    onRemoveSession: pageActions.handleRemoveCommandSession,
    onRespondApproval: pageActions.handleRespondApproval,
    onResizeStart: controllerState.handleTerminalResizeStart,
    onRetryServerRequest: composerActions.handleRetryServerRequest,
    onSelectSession: controllerState.setSelectedProcessId,
    onSubmitStdin: pageActions.handleSendStdin,
    onSurfacePanelResizeStart: controllerState.handleSurfacePanelResizeStart,
    onTerminateSelectedSession: pageActions.handleTerminateSelectedCommandSession,
    onThreadViewportScroll: viewportState.handleThreadViewportScroll,
  }
}
