import type { FormEvent } from 'react'

import {
  archiveCommandSession,
  clearCompletedCommandSessions as clearCompletedCommandSessionsRequest,
  closeCommandSession,
  pinCommandSession,
  resizeCommand,
  unarchiveCommandSession,
  unpinCommandSession,
  writeCommand,
} from '../../features/commands/api'
import { getErrorMessage } from '../../lib/error-utils'
import type { ThreadPageCommandActionsInput } from './threadPageActionTypes'

export function buildThreadPageCommandActions({
  clearCompletedCommandSessions,
  command,
  commandRunMode,
  commandSessions,
  removeCommandSession,
  selectedCommandSession,
  selectedThreadId,
  setSendError,
  setCommandRunMode,
  selectedProcessId,
  setIsTerminalDockExpanded,
  setSelectedProcessId,
  startCommandMutation,
  threadShellCommandMutation,
  stdinValue,
  terminateCommandMutation,
  updateCommandSession,
  workspaceId,
  writeCommandMutation,
}: ThreadPageCommandActionsInput) {
  function isTerminableCommandSession(status?: string) {
    switch ((status ?? '').toLowerCase()) {
      case 'running':
      case 'starting':
      case 'processing':
        return true
      default:
        return false
    }
  }

  function startExecCommand() {
    if (!command.trim()) {
      return
    }

    startCommandMutation.mutate({
      command: command.trim(),
      mode: 'command',
    })
  }

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

    startExecCommand()
  }

  function handleStartTerminalCommandLine(commandLine: string) {
    const nextCommand = commandLine.trim()
    if (!nextCommand) {
      return
    }

    startCommandMutation.mutate({
      command: nextCommand,
      mode: 'command',
    })
  }

  function handleStartTerminalShellSession(shell?: string) {
    startCommandMutation.mutate({
      mode: 'shell',
      ...(shell ? { shell } : {}),
    })
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

  function handleWriteTerminalData(input: string) {
    if (!selectedCommandSession?.id || !input) {
      return
    }

    void writeCommand(workspaceId, selectedCommandSession.id, { input }).catch((error) => {
      setSendError(getErrorMessage(error, 'Failed to send terminal input.'))
    })
  }

  function handleResizeTerminal(cols: number, rows: number) {
    if (
      !selectedCommandSession?.id ||
      !Number.isFinite(cols) ||
      !Number.isFinite(rows) ||
      cols <= 0 ||
      rows <= 0
    ) {
      return
    }

    void resizeCommand(workspaceId, selectedCommandSession.id, { cols, rows }).catch(() => {
      // Ignore resize errors to avoid noisy UI during rapid layout changes.
    })
  }

  function handleRemoveCommandSession(processId: string) {
    const remainingSessions = commandSessions.filter((session) => session.id !== processId)
    void closeCommandSession(workspaceId, processId)
      .then(() => {
        removeCommandSession(workspaceId, processId)

        if (selectedProcessId === processId) {
          setSelectedProcessId(remainingSessions[0]?.id)
        }

        if (!remainingSessions.length) {
          setIsTerminalDockExpanded(false)
        }
      })
      .catch((error) => {
        setSendError(getErrorMessage(error, 'Failed to close terminal session.'))
      })
  }

  function handleClearCompletedCommandSessions() {
    const remainingSessions = commandSessions.filter((session) =>
      ['running', 'starting'].includes(session.status),
    )
    void clearCompletedCommandSessionsRequest(workspaceId)
      .then(() => {
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
      })
      .catch((error) => {
        setSendError(getErrorMessage(error, 'Failed to clear finished terminal sessions.'))
      })
  }

  function handleTerminateSelectedCommandSession() {
    if (!selectedCommandSession?.id || !isTerminableCommandSession(selectedCommandSession.status)) {
      return
    }

    terminateCommandMutation.mutate(selectedCommandSession.id)
  }

  function handleTogglePinnedCommandSession(processId: string) {
    const session = commandSessions.find((item) => item.id === processId)
    if (!session) {
      return
    }

    const request = session.pinned ? unpinCommandSession : pinCommandSession
    void request(workspaceId, processId)
      .then((result) => {
        updateCommandSession(workspaceId, processId, {
          pinned: result.pinned,
          updatedAt: new Date().toISOString(),
        })
      })
      .catch((error) => {
        setSendError(getErrorMessage(error, 'Failed to update terminal pin state.'))
      })
  }

  function handleToggleArchivedCommandSession(processId: string) {
    const session = commandSessions.find((item) => item.id === processId)
    if (!session) {
      return
    }

    const request = session.archived ? unarchiveCommandSession : archiveCommandSession
    void request(workspaceId, processId)
      .then((result) => {
        updateCommandSession(workspaceId, processId, {
          archived: result.archived,
          updatedAt: new Date().toISOString(),
        })
      })
      .catch((error) => {
        setSendError(getErrorMessage(error, 'Failed to update terminal archive state.'))
      })
  }

  return {
    handleClearCompletedCommandSessions,
    handleChangeCommandRunMode: setCommandRunMode,
    handleRemoveCommandSession,
    handleSendStdin,
    handleStartCommand,
    handleStartTerminalCommandLine,
    handleStartTerminalShellSession,
    handleResizeTerminal,
    handleToggleArchivedCommandSession,
    handleTogglePinnedCommandSession,
    handleTerminateSelectedCommandSession,
    handleWriteTerminalData,
  }
}
