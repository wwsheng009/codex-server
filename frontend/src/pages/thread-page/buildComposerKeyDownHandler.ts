import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import type {
  BuildComposerKeyDownHandlerInput,
} from './threadComposerActionTypes'

export function buildComposerKeyDownHandler({
  composerAutocompleteItem,
  composerAutocompleteItemsLength,
  dismissComposerAutocomplete,
  handleSelectComposerAutocompleteItem,
  isCommandAutocompleteOpen,
  isMentionAutocompleteOpen,
  isSkillAutocompleteOpen,
  setComposerAutocompleteIndex,
}: BuildComposerKeyDownHandlerInput) {
  return (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Escape' &&
      (isCommandAutocompleteOpen || isMentionAutocompleteOpen || isSkillAutocompleteOpen)
    ) {
      event.preventDefault()
      dismissComposerAutocomplete()
      return
    }

    if (!composerAutocompleteItemsLength) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setComposerAutocompleteIndex((current) =>
        current + 1 >= composerAutocompleteItemsLength ? 0 : current + 1,
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setComposerAutocompleteIndex((current) =>
        current - 1 < 0 ? composerAutocompleteItemsLength - 1 : current - 1,
      )
      return
    }

    if ((event.key === 'Enter' || event.key === 'Tab') && composerAutocompleteItem) {
      event.preventDefault()
      handleSelectComposerAutocompleteItem(composerAutocompleteItem)
    }
  }
}
