import { useEffect } from 'react'

import type {
  ThreadTerminalLauncherSearchState,
  ThreadTerminalLauncherSearchStateInput
} from './threadTerminalInteractionStateTypes'
import { useThreadTerminalLauncherState } from './useThreadTerminalLauncherState'
import { useThreadTerminalTerminalSearchState } from './useThreadTerminalTerminalSearchState'

export function useThreadTerminalLauncherSearchState({
  activeSessionId,
  activeSessionsCount,
  archivedSessionsCount,
  clearActiveViewport,
  clearLauncher,
  commandSessions,
  findNextInActiveViewport,
  findPreviousInActiveViewport,
  focusActiveViewport,
  focusLauncher,
  onStartCommandLine,
  onStartShellSession,
  rootPath,
  startCommandPending,
}: ThreadTerminalLauncherSearchStateInput): ThreadTerminalLauncherSearchState {
  const launcher = useThreadTerminalLauncherState({
    activeSessionId,
    activeSessionsCount,
    archivedSessionsCount,
    commandSessions,
    onStartCommandLine,
    onStartShellSession,
    rootPath,
    startCommandPending,
  })

  const search = useThreadTerminalTerminalSearchState({
    activeSessionId,
    findNextInActiveViewport,
    findPreviousInActiveViewport,
    isLauncherOpen: launcher.isOpen,
  })

  useEffect(() => {
    if (launcher.isOpen) {
      requestAnimationFrame(() => focusLauncher())
      return
    }

    requestAnimationFrame(() => focusActiveViewport())
  }, [activeSessionId, launcher.isOpen])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const modifier = event.ctrlKey || event.metaKey
      if (!modifier) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === 'k') {
        event.preventDefault()
        launcher.open('command')
        return
      }

      if (key === 'f') {
        event.preventDefault()
        search.open()
        return
      }

      if (key === 'l') {
        event.preventDefault()
        if (launcher.isOpen) {
          clearLauncher()
        } else {
          clearActiveViewport()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeSessionId, launcher.isOpen])

  return {
    launcher,
    search,
  }
}
