import { useStableCallback } from '../../lib/useStableCallback'
import { getRecoverableRuntimeActionKind } from './threadPageRuntimeRecovery'
import { buildThreadPageBotActions } from './buildThreadPageBotActions'
import { buildThreadPageCommandActions } from './buildThreadPageCommandActions'
import { buildThreadPageThreadActions } from './buildThreadPageThreadActions'
import type { ThreadPageActionsInput } from './threadPageActionTypes'

export function useThreadPageActions(input: ThreadPageActionsInput) {
  const botActions = buildThreadPageBotActions(input)
  const threadActions = buildThreadPageThreadActions(input)
  const commandActions = buildThreadPageCommandActions(input)
  const handleLoadFullTurn = useStableCallback(threadActions.handleLoadFullTurn)
  const handleReleaseFullTurn = useStableCallback(threadActions.handleReleaseFullTurn)
  const handleRetainFullTurn = useStableCallback(threadActions.handleRetainFullTurn)

  return {
    ...botActions,
    ...threadActions,
    ...commandActions,
    handleLoadFullTurn,
    handleReleaseFullTurn,
    handleRetainFullTurn,
    handleRetryRuntimeOperation: async () => {
      if (input.recoverableSendInput?.trim()) {
        await threadActions.handleRetrySend()
        return
      }

      if (input.recoverableCommandOperation) {
        await commandActions.handleRetryCommandOperation()
      }
    },
    handleRestartAndRetryRuntimeOperation: async () => {
      const recoverableRuntimeActionKind = getRecoverableRuntimeActionKind(
        input.workspaceRuntimeState,
      )
      if (recoverableRuntimeActionKind === 'retry') {
        if (input.recoverableSendInput?.trim()) {
          await threadActions.handleRetrySend()
          return
        }

        if (input.recoverableCommandOperation) {
          await commandActions.handleRetryCommandOperation()
        }

        return
      }

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
