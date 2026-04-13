import type { BuildComposerMessageChangeHandlerInput } from './threadComposerActionTypes'

export function buildComposerMessageChangeHandler({
  recoverableCommandOperation,
  recoverableSendInput,
  sendError,
  setComposerCaret,
  setComposerCommandMenu,
  setDismissedComposerAutocompleteKey,
  setRecoverableCommandOperation,
  setRecoverableSendInput,
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
    if (recoverableSendInput) {
      setRecoverableSendInput(null)
    }
    if (recoverableCommandOperation) {
      setRecoverableCommandOperation(null)
    }
  }
}
