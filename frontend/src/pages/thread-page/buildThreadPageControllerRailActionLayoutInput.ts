import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'

export function buildThreadPageControllerRailActionLayoutInput({
  controllerState,
  pageActions,
  railState,
}: BuildThreadPageControllerLayoutPropsInput) {
  return {
    onArchiveToggle: pageActions.handleToggleArchiveSelectedThread,
    onBeginRenameThread: railState.handleBeginRenameSelectedThread,
    onCancelRenameThread: railState.handleCancelRenameSelectedThread,
    onChangeCommand: controllerState.setCommand,
    onChangeCommandRunMode: pageActions.handleChangeCommandRunMode,
    onChangeEditingThreadName: railState.setEditingThreadName,
    onCloseDeleteThreadDialog: pageActions.handleCloseDeleteThreadDialog,
    onConfirmDeleteThreadDialog: pageActions.handleConfirmDeleteThreadDialog,
    onDeleteThread: pageActions.handleDeleteSelectedThread,
    onHideSurfacePanel: railState.handleHideSurfacePanel,
    onInspectorResizeStart: controllerState.handleInspectorResizeStart,
    onOpenInspector: railState.handleOpenInspector,
    onOpenSurfacePanel: railState.handleOpenSurfacePanel,
    onResetInspectorWidth: controllerState.handleResetInspectorWidth,
    onStartCommand: pageActions.handleStartCommand,
    onSubmitRenameThread: pageActions.handleSubmitRenameSelectedThread,
    onToggleThreadToolsExpanded: railState.handleToggleThreadToolsExpanded,
    onToggleWorkbenchToolsExpanded: railState.handleToggleWorkbenchToolsExpanded,
  }
}
