import type { Dispatch, SetStateAction } from 'react'

import type { ComposerAutocompleteMode } from '../../lib/composer-autocomplete-types'
import type {
  ComposerAssistPanel,
  ComposerAutocompleteItem,
  ComposerCommandAction,
  ComposerCommandMenu,
  ComposerPreferences,
} from './threadPageComposerShared'

export type BuildComposerRetryServerRequestHandlerInput = {
  applyComposerMessage: (nextValue: string, nextCaret: number) => void
  message: string
}

export type ComposerTextSelectionResult = {
  caret: number
  value: string
}

export type InsertComposerTextInput = {
  replacement: string
  replaceActiveToken?: boolean
}

export type BuildComposerAutocompleteSelectionHandlersInput = {
  activeComposerMatchMode?: ComposerAutocompleteMode
  applyComposerMessage: (nextValue: string, nextCaret: number) => void
  clearComposerTriggerToken: () => ComposerTextSelectionResult
  dismissComposerAutocomplete: () => void
  insertComposerText: (input: InsertComposerTextInput) => ComposerTextSelectionResult
  setActiveComposerPanel: Dispatch<SetStateAction<ComposerAssistPanel | null>>
  setComposerCommandMenu: Dispatch<SetStateAction<ComposerCommandMenu>>
  setComposerPreferences: Dispatch<SetStateAction<ComposerPreferences>>
  setDismissedComposerAutocompleteKey: (value: string | null) => void
  setSendError: (value: string | null) => void
  supportsPlanMode: boolean
}

export type ComposerCommandActionHandler = (action: ComposerCommandAction) => void
export type ComposerAutocompleteItemHandler = (item: ComposerAutocompleteItem) => void

export type ThreadComposerAutocompleteKeyDownStateInput = {
  composerAutocompleteItem: ComposerAutocompleteItem | null
  composerAutocompleteItemsLength: number
  dismissComposerAutocomplete: () => void
  isCommandAutocompleteOpen: boolean
  isMentionAutocompleteOpen: boolean
  isSkillAutocompleteOpen: boolean
  setComposerAutocompleteIndex: Dispatch<SetStateAction<number>>
}

export type BuildComposerKeyDownHandlerInput = ThreadComposerAutocompleteKeyDownStateInput & {
  handleSelectComposerAutocompleteItem: ComposerAutocompleteItemHandler
}

export type BuildComposerMessageChangeHandlerInput = {
  sendError: string | null
  setComposerCaret: (value: number) => void
  setComposerCommandMenu: Dispatch<SetStateAction<ComposerCommandMenu>>
  setDismissedComposerAutocompleteKey: (value: string | null) => void
  setMessage: (value: string) => void
  setSendError: (value: string | null) => void
}

export type ThreadComposerActionsInput =
  BuildComposerRetryServerRequestHandlerInput &
    BuildComposerAutocompleteSelectionHandlersInput &
    ThreadComposerAutocompleteKeyDownStateInput &
    BuildComposerMessageChangeHandlerInput
