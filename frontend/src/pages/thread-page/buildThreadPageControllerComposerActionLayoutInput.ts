import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'

export function buildThreadPageControllerComposerActionLayoutInput({
  composerActions,
  composerCallbacks,
  controllerState,
  pageActions,
  viewportState,
}: BuildThreadPageControllerLayoutPropsInput) {
  return {
    onChangeCollaborationMode: composerCallbacks.handleChangeCollaborationMode,
    onChangeComposerAutocompleteIndex: controllerState.setComposerAutocompleteIndex,
    onChangeComposerMessage: composerActions.handleComposerMessageChange,
    onChangeModel: composerCallbacks.handleChangeModel,
    onChangePermissionPreset: composerCallbacks.handleChangePermissionPreset,
    onChangeReasoningEffort: composerCallbacks.handleChangeReasoningEffort,
    onCloseComposerPanel: composerCallbacks.handleCloseComposerPanel,
    onCompactSelectedThread: pageActions.handleCompactSelectedThread,
    onComposerKeyDown: composerActions.handleComposerKeyDown,
    onComposerSelect: controllerState.setComposerCaret,
    onJumpToLatest: viewportState.handleJumpToLatest,
    onPrimaryComposerAction: pageActions.handlePrimaryComposerAction,
    onRetryComposerStatus: composerCallbacks.handleRetryComposerStatus,
    onSelectComposerAutocompleteItem:
      composerActions.handleSelectComposerAutocompleteItem,
    onSubmit: pageActions.handleSendMessage,
  }
}
