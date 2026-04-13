import { accountQueryKey } from '../../features/account/api'
import {
  normalizeCollaborationMode,
  normalizePermissionPreset,
  normalizeReasoningEffort,
} from './threadPageComposerShared'
import type { UseThreadPageComposerCallbacksInput } from './threadPageRuntimeTypes'

export function useThreadPageComposerCallbacks({
  handleRestartAndRetryCommandOperation,
  handleRestartAndRetryRuntimeOperation,
  hasAccountError,
  hasRecoverableCommandOperation,
  hasRecoverableRuntimeOperation,
  isRestartAndRetryPending,
  queryClient,
  requiresOpenAIAuth,
  sendError,
  setActiveComposerPanel,
  setComposerPreferences,
  setSendError,
  workspaceId,
}: UseThreadPageComposerCallbacksInput) {
  function handleChangeCollaborationMode(nextValue: string) {
    setComposerPreferences((current) => ({
      ...current,
      collaborationMode: normalizeCollaborationMode(nextValue),
    }))
  }

  function handleChangeModel(nextValue: string) {
    setComposerPreferences((current) => ({
      ...current,
      model: nextValue,
    }))
  }

  function handleChangePermissionPreset(nextValue: string) {
    setComposerPreferences((current) => ({
      ...current,
      permissionPreset: normalizePermissionPreset(nextValue),
    }))
  }

  function handleChangeReasoningEffort(nextValue: string) {
    setComposerPreferences((current) => ({
      ...current,
      reasoningEffort: normalizeReasoningEffort(nextValue),
    }))
  }

  function handleCloseComposerPanel() {
    setActiveComposerPanel(null)
  }

  const handleRetryComposerStatus = hasAccountError
    ? () => void queryClient.invalidateQueries({ queryKey: accountQueryKey(workspaceId) })
    : hasRecoverableRuntimeOperation && !isRestartAndRetryPending
      ? () =>
          void (
            hasRecoverableCommandOperation
              ? handleRestartAndRetryCommandOperation()
              : handleRestartAndRetryRuntimeOperation()
          )
      : !requiresOpenAIAuth && sendError
      ? () => {
          setSendError(null)
        }
      : undefined

  return {
    handleChangeCollaborationMode,
    handleChangeModel,
    handleChangePermissionPreset,
    handleChangeReasoningEffort,
    handleCloseComposerPanel,
    handleRetryComposerStatus,
  }
}
