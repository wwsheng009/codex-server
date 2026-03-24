import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { i18n } from '../../i18n/runtime'
import { readRuntimePreferences } from '../settings/api'
import {
  buildTerminalShellOptions,
  formatTerminalShellLauncherName,
} from './threadTerminalShellUtils'
import type {
  ThreadTerminalLauncherState,
  ThreadTerminalLauncherStateInput
} from './threadTerminalInteractionStateTypes'
import type { TerminalLauncherMode } from './threadTerminalDockTypes'

export function useThreadTerminalLauncherState({
  activeSessionId,
  activeSessionsCount,
  archivedSessionsCount,
  commandSessions,
  onStartCommandLine,
  onStartShellSession,
  rootPath,
  startCommandPending,
}: ThreadTerminalLauncherStateInput): ThreadTerminalLauncherState {
  const [isLauncherOpen, setIsLauncherOpen] = useState(commandSessions.length === 0)
  const [launcherMode, setLauncherMode] = useState<TerminalLauncherMode>(() =>
    commandSessions.length === 0 ? 'shell' : 'command',
  )
  const [launcherHistory, setLauncherHistory] = useState<string[]>([])
  const [launcherShell, setLauncherShell] = useState('')
  const [launcherHasSelection, setLauncherHasSelection] = useState(false)

  const runtimePreferencesQuery = useQuery({
    queryKey: ['settings-runtime-preferences'],
    queryFn: readRuntimePreferences,
    staleTime: 30_000,
  })

  const terminalShellOptions = useMemo(
    () =>
      buildTerminalShellOptions({
        currentShell: launcherShell,
        supportedShells: runtimePreferencesQuery.data?.supportedTerminalShells ?? [],
      }),
    [launcherShell, runtimePreferencesQuery.data?.supportedTerminalShells],
  )
  const defaultShellLauncherName = formatTerminalShellLauncherName({
    rootPath,
    shell: launcherShell,
  })
  const newShellSessionTitle = i18n._({
    id: 'New {shellName} session',
    message: 'New {shellName} session',
    values: { shellName: defaultShellLauncherName },
  })

  function handleOpenLauncher(mode: TerminalLauncherMode) {
    setLauncherMode(mode)
    setIsLauncherOpen(true)
  }

  function handleCloseLauncher() {
    if (!commandSessions.length) {
      return
    }

    setIsLauncherOpen(false)
  }

  function handleStartLauncherCommand(commandLine: string) {
    const nextCommand = commandLine.trim()
    if (!nextCommand) {
      return
    }

    setLauncherHistory((current) => {
      const nextHistory = [nextCommand, ...current.filter((entry) => entry !== nextCommand)]
      return nextHistory.slice(0, 24)
    })
    onStartCommandLine(nextCommand)
  }

  function handleStartShellSessionDirect() {
    setLauncherMode('shell')
    setIsLauncherOpen(true)
  }

  function handleStartShellFromLauncher() {
    onStartShellSession(launcherShell || undefined)
  }

  function handleLauncherSelectionChange(hasSelection: boolean) {
    setLauncherHasSelection(hasSelection)
  }

  useEffect(() => {
    const configuredShell = (runtimePreferencesQuery.data?.configuredDefaultTerminalShell ?? '').trim()
    if (!configuredShell) {
      return
    }

    setLauncherShell((current) => current || configuredShell)
  }, [runtimePreferencesQuery.data?.configuredDefaultTerminalShell])

  useEffect(() => {
    if (!activeSessionsCount && !archivedSessionsCount) {
      setIsLauncherOpen(true)
      setLauncherMode('shell')
      return
    }

    if (activeSessionId && !startCommandPending) {
      setIsLauncherOpen(false)
    }
  }, [activeSessionId, activeSessionsCount, archivedSessionsCount, startCommandPending])

  return {
    close: handleCloseLauncher,
    defaultShellLauncherName,
    handleSelectionChange: handleLauncherSelectionChange,
    hasSelection: launcherHasSelection,
    history: launcherHistory,
    isOpen: isLauncherOpen,
    mode: launcherMode,
    newShellSessionTitle,
    open: handleOpenLauncher,
    setShell: setLauncherShell,
    shell: launcherShell,
    startCommand: handleStartLauncherCommand,
    startShellDirect: handleStartShellSessionDirect,
    startShellFromLauncher: handleStartShellFromLauncher,
    terminalShellOptions,
  }
}
