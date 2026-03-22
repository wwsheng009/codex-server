import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useDocumentVisibility } from '../../hooks/useDocumentVisibility'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useSessionStore } from '../../stores/session-store'
import {
  getSelectedThreadIdForWorkspace,
  readPersistedThreadSelectionSnapshot,
} from '../../stores/session-store-utils'
import { useUIStore } from '../../stores/ui-store'

export function useThreadPageControllerStoreState(workspaceId: string) {
  const queryClient = useQueryClient()
  const isDocumentVisible = useDocumentVisibility()
  const isMobileViewport = useMediaQuery('(max-width: 900px)')
  const persistedSelectionSnapshot = useMemo(
    () => readPersistedThreadSelectionSnapshot(),
    [workspaceId],
  )

  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const removeThreadFromSession = useSessionStore((state) => state.removeThread)
  const removeCommandSession = useSessionStore((state) => state.removeCommandSession)
  const clearCompletedCommandSessions = useSessionStore(
    (state) => state.clearCompletedCommandSessions,
  )
  const selectedThreadId = useSessionStore((state) =>
    getSelectedThreadIdForWorkspace(state, workspaceId) ??
      getSelectedThreadIdForWorkspace(persistedSelectionSnapshot, workspaceId),
  )

  const mobileThreadToolsOpen = useUIStore((state) => state.mobileThreadToolsOpen)
  const setMobileThreadChrome = useUIStore((state) => state.setMobileThreadChrome)
  const setMobileThreadToolsOpen = useUIStore((state) => state.setMobileThreadToolsOpen)
  const resetMobileThreadChrome = useUIStore((state) => state.resetMobileThreadChrome)

  const responseTone = useSettingsLocalStore((state) => state.responseTone)
  const customInstructions = useSettingsLocalStore((state) => state.customInstructions)
  const maxWorktrees = useSettingsLocalStore((state) => state.maxWorktrees)
  const autoPruneDays = useSettingsLocalStore((state) => state.autoPruneDays)
  const reuseBranches = useSettingsLocalStore((state) => state.reuseBranches)

  return {
    autoPruneDays,
    clearCompletedCommandSessions,
    customInstructions,
    isDocumentVisible,
    isMobileViewport,
    maxWorktrees,
    mobileThreadToolsOpen,
    queryClient,
    removeCommandSession,
    removeThreadFromSession,
    resetMobileThreadChrome,
    responseTone,
    reuseBranches,
    selectedThreadId,
    setMobileThreadChrome,
    setMobileThreadToolsOpen,
    setSelectedThread,
    setSelectedWorkspace,
  }
}
