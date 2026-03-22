import type { FormEvent } from 'react'

import type { ThreadPageCommandActionsInput } from './threadPageActionTypes'

export function buildThreadPageCommandActions({
  clearCompletedCommandSessions,
  command,
  commandRunMode,
  commandSessions,
  removeCommandSession,
  selectedCommandSession,
  selectedThreadId,
  setCommandRunMode,
  selectedProcessId,
  setIsTerminalDockExpanded,
  setSelectedProcessId,
  startCommandMutation,
  threadShellCommandMutation,
  stdinValue,
  terminateCommandMutation,
  workspaceId,
  writeCommandMutation,
}: ThreadPageCommandActionsInput) {
  function handleStartCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command.trim()) {
      return
    }

    if (commandRunMode === 'thread-shell') {
      if (!selectedThreadId) {
        return
      }

      threadShellCommandMutation.mutate({
        threadId: selectedThreadId,
        command: command.trim(),
      })
      return
    }

    startCommandMutation.mutate({ command: command.trim() })
  }

  function handleSendStdin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCommandSession?.id || !stdinValue.trim()) {
      return
    }

    writeCommandMutation.mutate({
      processId: selectedCommandSession.id,
      input: `${stdinValue}\n`,
    })
  }

  function handleRemoveCommandSession(processId: string) {
    const remainingSessions = commandSessions.filter((session) => session.id !== processId)
    removeCommandSession(workspaceId, processId)

    if (selectedProcessId === processId) {
      setSelectedProcessId(remainingSessions[0]?.id)
    }

    if (!remainingSessions.length) {
      setIsTerminalDockExpanded(false)
    }
  }

  function handleClearCompletedCommandSessions() {
    const remainingSessions = commandSessions.filter((session) =>
      ['running', 'starting'].includes(session.status),
    )
    clearCompletedCommandSessions(workspaceId)

    if (
      selectedProcessId &&
      !remainingSessions.some((session) => session.id === selectedProcessId)
    ) {
      setSelectedProcessId(remainingSessions[0]?.id)
    }

    if (!remainingSessions.length) {
      setIsTerminalDockExpanded(false)
    }
  }

  function handleTerminateSelectedCommandSession() {
    if (!selectedCommandSession?.id) {
      return
    }

    terminateCommandMutation.mutate(selectedCommandSession.id)
  }

  return {
    handleClearCompletedCommandSessions,
    handleChangeCommandRunMode: setCommandRunMode,
    handleRemoveCommandSession,
    handleSendStdin,
    handleStartCommand,
    handleTerminateSelectedCommandSession,
  }
}
