import { buildRetryPromptFromServerRequest } from '../threadPageTurnHelpers'
import type { BuildComposerRetryServerRequestHandlerInput } from './threadComposerActionTypes'

export function buildComposerRetryServerRequestHandler({
  applyComposerMessage,
  message,
}: BuildComposerRetryServerRequestHandlerInput) {
  return (item: Record<string, unknown>) => {
    const nextPrompt = buildRetryPromptFromServerRequest(item)
    const trimmed = message.trim()
    const nextValue = !trimmed
      ? nextPrompt
      : trimmed.includes(nextPrompt)
        ? message
        : `${message.trimEnd()}\n\n${nextPrompt}`

    applyComposerMessage(nextValue, nextValue.length)
  }
}
