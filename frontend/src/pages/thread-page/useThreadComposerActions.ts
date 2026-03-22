import { buildComposerAutocompleteSelectionHandlers } from './buildComposerAutocompleteSelectionHandlers'
import { buildComposerKeyDownHandler } from './buildComposerKeyDownHandler'
import { buildComposerMessageChangeHandler } from './buildComposerMessageChangeHandler'
import { buildComposerRetryServerRequestHandler } from './buildComposerRetryServerRequestHandler'
import type { ThreadComposerActionsInput } from './threadComposerActionTypes'

export function useThreadComposerActions(input: ThreadComposerActionsInput) {
  const handleRetryServerRequest = buildComposerRetryServerRequestHandler(input)
  const { handleSelectComposerAutocompleteItem } =
    buildComposerAutocompleteSelectionHandlers(input)
  const handleComposerKeyDown = buildComposerKeyDownHandler({
    ...input,
    handleSelectComposerAutocompleteItem,
  })
  const handleComposerMessageChange = buildComposerMessageChangeHandler(input)

  return {
    handleComposerKeyDown,
    handleComposerMessageChange,
    handleRetryServerRequest,
    handleSelectComposerAutocompleteItem,
  }
}
