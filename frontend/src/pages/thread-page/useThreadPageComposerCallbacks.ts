import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'

import { accountQueryKey } from '../../features/account/api'
import {
  normalizeCollaborationMode,
  normalizePermissionPreset,
  normalizeReasoningEffort,
  type ComposerAssistPanel,
  type ComposerPreferences,
} from './threadPageComposerShared'

export function useThreadPageComposerCallbacks({
  hasAccountError,
  queryClient,
  requiresOpenAIAuth,
  sendError,
  setActiveComposerPanel,
  setComposerPreferences,
  setSendError,
  workspaceId,
}: {
  hasAccountError: boolean
  queryClient: QueryClient
  requiresOpenAIAuth: boolean
  sendError: string | null
  setActiveComposerPanel: Dispatch<SetStateAction<ComposerAssistPanel | null>>
  setComposerPreferences: Dispatch<SetStateAction<ComposerPreferences>>
  setSendError: (value: string | null) => void
  workspaceId: string
}) {
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
