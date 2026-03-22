import type { BuildComposerMessageChangeHandlerInput } from './threadComposerActionTypes'

export function buildComposerMessageChangeHandler({
  sendError,
  setComposerCaret,
  setComposerCommandMenu,
  setDismissedComposerAutocompleteKey,
  setMessage,
  setSendError,
}: BuildComposerMessageChangeHandlerInput) {
  return (value: string, caret: number) => {
    setMessage(value)
    setComposerCaret(caret)
    setComposerCommandMenu((current) => (current === 'review' ? current : 'root'))
    setDismissedComposerAutocompleteKey(null)
    if (sendError) {
      setSendError(null)
    }
  }
}
