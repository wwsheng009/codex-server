import type {
  BuildComposerAutocompleteSelectionHandlersInput,
  ComposerAutocompleteItemHandler,
  ComposerCommandActionHandler,
} from './threadComposerActionTypes'

import { i18n } from '../../i18n/runtime'

export function buildComposerAutocompleteSelectionHandlers({
  activeComposerMatchMode,
  applyComposerMessage,
  clearComposerTriggerToken,
  dismissComposerAutocomplete,
  insertComposerText,
  setActiveComposerPanel,
  setComposerCommandMenu,
  setComposerPreferences,
  setDismissedComposerAutocompleteKey,
  setSendError,
  supportsPlanMode,
}: BuildComposerAutocompleteSelectionHandlersInput): {
  handleComposerCommandAction: ComposerCommandActionHandler
  handleSelectComposerAutocompleteItem: ComposerAutocompleteItemHandler
} {
  const handleComposerCommandAction: ComposerCommandActionHandler = (action) => {
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
          setSendError(i18n._({ id: 'Plan mode is not available for this workspace.', message: 'Plan mode is not available for this workspace.' }))
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
      }
    }
  }

  const handleSelectComposerAutocompleteItem: ComposerAutocompleteItemHandler = (item) => {
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
      }
    }
  }

  return {
    handleComposerCommandAction,
    handleSelectComposerAutocompleteItem,
  }
}
