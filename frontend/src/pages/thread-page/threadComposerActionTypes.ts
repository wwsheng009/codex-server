import type { Dispatch, SetStateAction } from 'react'

import type { ComposerAutocompleteMode } from '../../lib/composer-autocomplete'
import type {
  ComposerAssistPanel,
  ComposerAutocompleteItem,
  ComposerCommandAction,
  ComposerCommandMenu,
  ComposerPreferences,
} from './threadPageComposerShared'

export type ThreadComposerActionsInput = {
  activeComposerMatchMode?: ComposerAutocompleteMode
  applyComposerMessage: (nextValue: string, nextCaret: number) => void
  clearComposerTriggerToken: () => { value: string; caret: number }
  composerAutocompleteItem: ComposerAutocompleteItem | null
  composerAutocompleteItemsLength: number
  dismissComposerAutocomplete: () => void
  insertComposerText: (input: {
    replacement: string
    replaceActiveToken?: boolean
  }) => { value: string; caret: number }
  isCommandAutocompleteOpen: boolean
  isMentionAutocompleteOpen: boolean
  isSkillAutocompleteOpen: boolean
  message: string
  sendError: string | null
  setActiveComposerPanel: Dispatch<SetStateAction<ComposerAssistPanel | null>>
  setComposerAutocompleteIndex: Dispatch<SetStateAction<number>>
  setComposerCaret: (value: number) => void
  setComposerCommandMenu: Dispatch<SetStateAction<ComposerCommandMenu>>
  setComposerPreferences: Dispatch<SetStateAction<ComposerPreferences>>
  setDismissedComposerAutocompleteKey: (value: string | null) => void
  setMessage: (value: string) => void
  setSendError: (value: string | null) => void
  supportsPlanMode: boolean
}

export type BuildComposerRetryServerRequestHandlerInput = Pick<
  ThreadComposerActionsInput,
  'applyComposerMessage' | 'message'
>

export type BuildComposerAutocompleteSelectionHandlersInput = Pick<
  ThreadComposerActionsInput,
  | 'activeComposerMatchMode'
  | 'applyComposerMessage'
  | 'clearComposerTriggerToken'
  | 'dismissComposerAutocomplete'
  | 'insertComposerText'
  | 'setActiveComposerPanel'
  | 'setComposerCommandMenu'
  | 'setComposerPreferences'
  | 'setDismissedComposerAutocompleteKey'
  | 'setSendError'
  | 'supportsPlanMode'
>

export type ComposerCommandActionHandler = (action: ComposerCommandAction) => void
export type ComposerAutocompleteItemHandler = (item: ComposerAutocompleteItem) => void

export type BuildComposerKeyDownHandlerInput = Pick<
  ThreadComposerActionsInput,
  | 'composerAutocompleteItem'
  | 'composerAutocompleteItemsLength'
  | 'dismissComposerAutocomplete'
  | 'isCommandAutocompleteOpen'
  | 'isMentionAutocompleteOpen'
  | 'isSkillAutocompleteOpen'
  | 'setComposerAutocompleteIndex'
> & {
  handleSelectComposerAutocompleteItem: ComposerAutocompleteItemHandler
}

export type BuildComposerMessageChangeHandlerInput = Pick<
  ThreadComposerActionsInput,
  | 'sendError'
  | 'setComposerCaret'
  | 'setComposerCommandMenu'
  | 'setDismissedComposerAutocompleteKey'
  | 'setMessage'
  | 'setSendError'
>
