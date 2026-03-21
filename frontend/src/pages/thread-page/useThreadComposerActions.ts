import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from 'react'

import type { ComposerAutocompleteMode } from '../../lib/composer-autocomplete'
import { buildRetryPromptFromServerRequest } from '../threadPageTurnHelpers'
import type {
  ComposerAssistPanel,
  ComposerAutocompleteItem,
  ComposerCommandAction,
  ComposerCommandMenu,
  ComposerPreferences,
} from './threadPageComposerShared'

export function useThreadComposerActions({
  activeComposerMatchMode,
  applyComposerMessage,
  clearComposerTriggerToken,
  composerAutocompleteItem,
  composerAutocompleteItemsLength,
  dismissComposerAutocomplete,
  insertComposerText,
  isCommandAutocompleteOpen,
  isMentionAutocompleteOpen,
  isSkillAutocompleteOpen,
  message,
  sendError,
  setActiveComposerPanel,
  setComposerAutocompleteIndex,
  setComposerCaret,
  setComposerCommandMenu,
  setComposerPreferences,
  setDismissedComposerAutocompleteKey,
  setMessage,
  setSendError,
  supportsPlanMode,
}: {
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
}) {
  function handleRetryServerRequest(item: Record<string, unknown>) {
    const nextPrompt = buildRetryPromptFromServerRequest(item)
    const trimmed = message.trim()
    const nextValue = !trimmed
      ? nextPrompt
      : trimmed.includes(nextPrompt)
        ? message
        : `${message.trimEnd()}\n\n${nextPrompt}`

    applyComposerMessage(nextValue, nextValue.length)
  }

  function handleComposerCommandAction(action: ComposerCommandAction) {
    switch (action.kind) {
      case 'panel': {
        const cleared = clearComposerTriggerToken()
        setComposerCommandMenu('root')
        setActiveComposerPanel(action.panel)
        applyComposerMessage(cleared.value, cleared.caret)
        return
      }
      case 'prompt': {
        const nextMessage = insertComposerText({
          replacement: action.prompt,
          replaceActiveToken: activeComposerMatchMode === 'command',
        })
        setComposerCommandMenu('root')
        applyComposerMessage(nextMessage.value, nextMessage.caret)
        return
      }
      case 'submenu': {
        const cleared = clearComposerTriggerToken()
        setComposerCommandMenu(action.menu)
        setDismissedComposerAutocompleteKey(null)
        applyComposerMessage(cleared.value, cleared.caret)
        return
      }
      case 'toggle-plan': {
        if (!supportsPlanMode) {
          setSendError('Plan mode is not available for this workspace.')
          dismissComposerAutocomplete()
          return
        }

        const cleared = clearComposerTriggerToken()
        setComposerPreferences((current) => ({
          ...current,
          collaborationMode: current.collaborationMode === 'plan' ? 'default' : 'plan',
        }))
        setComposerCommandMenu('root')
        setActiveComposerPanel(null)
        applyComposerMessage(cleared.value, cleared.caret)
        return
      }
    }
  }

  function handleSelectComposerAutocompleteItem(item: ComposerAutocompleteItem) {
    switch (item.kind) {
      case 'command':
        handleComposerCommandAction(item.action)
        return
      case 'review': {
        const nextMessage = insertComposerText({
          replacement: item.prompt,
          replaceActiveToken: activeComposerMatchMode === 'command',
        })
        setComposerCommandMenu('root')
        applyComposerMessage(nextMessage.value, nextMessage.caret)
        return
      }
      case 'skill':
      case 'file': {
        const nextMessage = insertComposerText({
          replacement: item.insertion,
          replaceActiveToken: Boolean(activeComposerMatchMode),
        })
        setComposerCommandMenu('root')
        applyComposerMessage(nextMessage.value, nextMessage.caret)
        return
      }
    }
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
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

  function handleComposerMessageChange(value: string, caret: number) {
    setMessage(value)
    setComposerCaret(caret)
    setComposerCommandMenu((current) => (current === 'review' ? current : 'root'))
    setDismissedComposerAutocompleteKey(null)
    if (sendError) {
      setSendError(null)
    }
  }

  return {
    handleComposerKeyDown,
    handleComposerMessageChange,
    handleRetryServerRequest,
    handleSelectComposerAutocompleteItem,
  }
}
