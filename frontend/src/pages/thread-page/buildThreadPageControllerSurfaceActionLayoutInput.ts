import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'

export function buildThreadPageControllerSurfaceActionLayoutInput({
  composerActions,
  controllerState,
  mutationState,
  pageActions,
  railState,
  viewportState,
}: BuildThreadPageControllerLayoutPropsInput) {
  return {
    onChangeApprovalAnswer: pageActions.handleApprovalAnswerChange,
    onCaptureOlderTurnsAnchor: viewportState.captureOlderTurnsAnchor,
    onChangePlacement: controllerState.handleChangeTerminalDockPlacement,
    onClearCompletedSessions: pageActions.handleClearCompletedCommandSessions,
    onCloseWorkbenchOverlay: railState.handleCloseWorkbenchOverlay,
    onCreateThread: () => {
      mutationState.createThreadMutation.reset()
      mutationState.createThreadMutation.mutate()
    },
    onHideTerminalDock: controllerState.handleHideTerminalDock,
    onLoadOlderTurns: pageActions.handleLoadOlderTurns,
    onReleaseFullTurn: pageActions.handleReleaseFullTurn,
    onRetainFullTurn: pageActions.handleRetainFullTurn,
    onResetTerminalWindowBounds: controllerState.handleResetTerminalWindowBounds,
    onRequestFullTurn: pageActions.handleLoadFullTurn,
    onRemoveSession: pageActions.handleRemoveCommandSession,
    onResizeTerminal: pageActions.handleResizeTerminal,
    onRespondApproval: pageActions.handleRespondApproval,
    onRestoreOlderTurnsViewport: viewportState.restoreOlderTurnsViewport,
    onResizeStart: controllerState.handleTerminalResizeStart,
    onRetryServerRequest: composerActions.handleRetryServerRequest,
    onSelectSession: controllerState.setSelectedProcessId,
    onShowTerminalDock: controllerState.handleShowTerminalDock,
    onStartTerminalShellSession: pageActions.handleStartTerminalShellSession,
    onStartTerminalCommandLine: pageActions.handleStartTerminalCommandLine,
    onStartTerminalWindowDrag: controllerState.handleTerminalWindowDragStart,
    onStartTerminalWindowResize: controllerState.handleTerminalWindowResizeStart,
    onToggleArchivedSession: pageActions.handleToggleArchivedCommandSession,
    onTogglePinnedSession: pageActions.handleTogglePinnedCommandSession,
    onToggleTerminalWindowMaximized: controllerState.handleToggleTerminalWindowMaximized,
    onSurfacePanelResizeStart: controllerState.handleSurfacePanelResizeStart,
    onTerminateSelectedSession: pageActions.handleTerminateSelectedCommandSession,
    onThreadViewportScroll: viewportState.handleThreadViewportScroll,
    onWriteTerminalData: pageActions.handleWriteTerminalData,
  }
}
