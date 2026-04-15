import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'

export function buildThreadPageControllerRailActionLayoutInput({
  controllerState,
  mutationState,
  pageActions,
  railState,
}: BuildThreadPageControllerLayoutPropsInput) {
  return {
    onArchiveToggle: pageActions.handleToggleArchiveSelectedThread,
    onBeginRenameThread: railState.handleBeginRenameSelectedThread,
    onBindThreadBotChannel: pageActions.handleBindThreadBotChannel,
    onCancelRenameThread: railState.handleCancelRenameSelectedThread,
    onChangeBotSendSelectedBotId: (value: string) => {
      controllerState.setBotSendError(null)
      controllerState.setBotSendSelectedBotId(value)
      controllerState.setBotSendSelectedDeliveryTargetId('')
    },
    onChangeBotSendSelectedDeliveryTargetId: (value: string) => {
      controllerState.setBotSendError(null)
      controllerState.setBotSendSelectedDeliveryTargetId(value)
    },
    onChangeBotSendText: (value: string) => {
      controllerState.setBotSendError(null)
      controllerState.setBotSendText(value)
    },
    onChangeCommand: controllerState.setCommand,
    onChangeCommandRunMode: pageActions.handleChangeCommandRunMode,
    onChangeEditingThreadName: railState.setEditingThreadName,
    onCloseDeleteThreadDialog: pageActions.handleCloseDeleteThreadDialog,
    onConfirmDeleteThreadDialog: pageActions.handleConfirmDeleteThreadDialog,
    onDeleteThread: pageActions.handleDeleteSelectedThread,
    onDeleteThreadBotBinding: pageActions.handleDeleteThreadBotBinding,
    onHideSurfacePanel: railState.handleHideSurfacePanel,
    onInspectorResizeStart: controllerState.handleInspectorResizeStart,
    onOpenInspector: railState.handleOpenInspector,
    onOpenSurfacePanel: railState.handleOpenSurfacePanel,
    onRetryRuntimeOperation: pageActions.handleRetryRuntimeOperation,
    onRestartRuntime: () => mutationState.restartRuntimeMutation.mutate(),
    onResetInspectorWidth: controllerState.handleResetInspectorWidth,
    onSendBotMessage: pageActions.handleSendBotMessage,
    onShowTerminalDock: controllerState.handleShowTerminalDock,
    onStartCommand: pageActions.handleStartCommand,
    onSubmitRenameThread: pageActions.handleSubmitRenameSelectedThread,
    onToggleThreadToolsExpanded: railState.handleToggleThreadToolsExpanded,
    onToggleWorkbenchToolsExpanded: railState.handleToggleWorkbenchToolsExpanded,
  }
}
