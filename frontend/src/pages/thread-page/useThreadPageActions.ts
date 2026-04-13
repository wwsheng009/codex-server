import { buildThreadPageBotActions } from './buildThreadPageBotActions'
import { buildThreadPageCommandActions } from './buildThreadPageCommandActions'
import { buildThreadPageThreadActions } from './buildThreadPageThreadActions'
import type { ThreadPageActionsInput } from './threadPageActionTypes'

export function useThreadPageActions(input: ThreadPageActionsInput) {
  const botActions = buildThreadPageBotActions(input)
  const threadActions = buildThreadPageThreadActions(input)
  const commandActions = buildThreadPageCommandActions(input)

  return {
    ...botActions,
    ...threadActions,
    ...commandActions,
    handleRestartAndRetryRuntimeOperation: async () => {
      if (input.recoverableSendInput?.trim()) {
        await threadActions.handleRestartAndRetrySend()
        return
      }

      if (input.recoverableCommandOperation) {
        await commandActions.handleRestartAndRetryCommandOperation()
      }
    },
  }
}
