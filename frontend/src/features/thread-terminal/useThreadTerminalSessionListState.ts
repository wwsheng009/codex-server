import { useEffect, useState } from 'react'

import {
  canCommandSessionInteract,
  hasLimitedShellIntegration,
} from './threadTerminalSessionBehavior'
import type {
  ThreadTerminalSessionListState,
  ThreadTerminalSessionSelectionInput
} from './threadTerminalInteractionStateTypes'

export function useThreadTerminalSessionListState({
  commandSessions,
  onSelectSession,
  selectedCommandSession,
}: ThreadTerminalSessionSelectionInput): ThreadTerminalSessionListState {
  const [showArchivedSessions, setShowArchivedSessions] = useState(false)
  const [sessionSelectionById, setSessionSelectionById] = useState<Record<string, boolean>>({})

  const activeSessions = commandSessions.filter((session) => !session.archived)
  const archivedSessions = commandSessions.filter((session) => session.archived)
  const visibleSessions = showArchivedSessions ? archivedSessions : activeSessions
  const hasFinishedSessions = activeSessions.some(
    (session) => !['running', 'starting'].includes(session.status),
  )
  const isInteractive = canCommandSessionInteract(selectedCommandSession)
  const selectedSessionHasLimitedIntegration = hasLimitedShellIntegration(selectedCommandSession)
  const activeSessionId = selectedCommandSession?.id
  const hasSelectedSessionSelection = activeSessionId
    ? Boolean(sessionSelectionById[activeSessionId])
    : false

  function handleSelectSession(processId: string) {
    onSelectSession(processId)
  }

  function handleSessionSelectionChange(sessionId: string, hasSelection: boolean) {
    setSessionSelectionById((current) => {
      if (current[sessionId] === hasSelection) {
        return current
      }

      return {
        ...current,
        [sessionId]: hasSelection,
      }
    })
  }

  function handleToggleArchivedSessions() {
    setShowArchivedSessions((current) => !current)
  }

  useEffect(() => {
    if (selectedCommandSession?.archived) {
      setShowArchivedSessions(true)
    }
  }, [selectedCommandSession?.archived])

  useEffect(() => {
    if (!commandSessions.length) {
      setSessionSelectionById({})
      return
    }

    const nextIds = new Set(commandSessions.map((session) => session.id))
    setSessionSelectionById((current) => {
      const nextEntries = Object.entries(current).filter(([sessionId]) => nextIds.has(sessionId))
      if (nextEntries.length === Object.keys(current).length) {
        return current
      }

      return Object.fromEntries(nextEntries)
    })
  }, [commandSessions])

  return {
    activeSessionId,
    selectSession: handleSelectSession,
    sessions: {
      activeSessions,
      archivedSessions,
      handleSelectionChange: handleSessionSelectionChange,
      hasFinishedSessions,
      hasSelectedSessionSelection,
      isInteractive,
      selectSession: handleSelectSession,
      selectedSessionHasLimitedIntegration,
      showArchivedSessions,
      toggleShowArchivedSessions: handleToggleArchivedSessions,
      visibleSessions,
    },
  }
}
