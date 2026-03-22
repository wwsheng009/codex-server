import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerComposerLayoutInput } from './threadPageControllerLayoutInputTypes'

type ComposerActionLayoutInput = Pick<
  ControllerComposerLayoutInput,
  | 'onChangeCollaborationMode'
  | 'onChangeComposerAutocompleteIndex'
  | 'onChangeComposerMessage'
  | 'onChangeModel'
  | 'onChangePermissionPreset'
  | 'onChangeReasoningEffort'
  | 'onCloseComposerPanel'
  | 'onCompactSelectedThread'
  | 'onComposerKeyDown'
  | 'onComposerSelect'
  | 'onJumpToLatest'
  | 'onPrimaryComposerAction'
  | 'onRetryComposerStatus'
  | 'onSelectComposerAutocompleteItem'
  | 'onSubmit'
>

export function buildThreadPageControllerComposerActionLayoutInput({
  composerActions,
  composerCallbacks,
  controllerState,
  pageActions,
  viewportState,
}: BuildThreadPageControllerLayoutPropsInput): ComposerActionLayoutInput {
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
