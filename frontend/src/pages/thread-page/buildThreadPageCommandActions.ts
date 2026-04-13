import type { FormEvent } from 'react'

import { getWorkspaceRuntimeState } from '../../features/workspaces/api'
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
import type { WorkspaceRuntimeState } from '../../types/api'
import type { ThreadPageCommandActionsInput } from './threadPageActionTypes'

export function buildThreadPageCommandActions({
  clearCompletedCommandSessions,
  command,
  commandRunMode,
  commandSessions,
  queryClient,
  recoverableCommandOperation,
  removeCommandSession,
  restartRuntimeMutation,
  selectedCommandSession,
  selectedThreadId,
  setIsRestartAndRetryPending,
  setSendError,
  setCommandRunMode,
  setRecoverableCommandOperation,
  selectedProcessId,
  setIsTerminalDockExpanded,
  setSelectedProcessId,
  startCommandMutation,
  threadShellCommandMutation,
  stdinValue,
  terminateCommandMutation,
  updateCommandSession,
  workspaceRuntimeState,
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

  async function fetchLatestWorkspaceRuntimeState() {
    if (!workspaceId) {
      return workspaceRuntimeState ?? null
    }

    try {
      return await queryClient.fetchQuery({
        queryKey: ['workspace-runtime-state', workspaceId],
        queryFn: () => getWorkspaceRuntimeState(workspaceId),
        staleTime: 0,
      })
    } catch {
      return (
        queryClient.getQueryData<WorkspaceRuntimeState | null>([
          'workspace-runtime-state',
          workspaceId,
        ]) ??
        workspaceRuntimeState ??
        null
      )
    }
  }

  async function captureRecoverableCommandOperationIfNeeded(
    nextOperation: ThreadPageCommandActionsInput['recoverableCommandOperation'],
  ) {
    const latestRuntimeState = await fetchLatestWorkspaceRuntimeState()
    if (shouldOfferRestartAndRetry(latestRuntimeState)) {
      setRecoverableCommandOperation(nextOperation)
      return
    }

    setRecoverableCommandOperation(null)
  }

  async function startExecCommand(commandLine: string) {
    const nextCommand = commandLine.trim()
    if (!nextCommand) {
      return
    }

    setRecoverableCommandOperation(null)

    try {
      await startCommandMutation.mutateAsync({
        command: nextCommand,
        mode: 'command',
      })
    } catch (error) {
      await captureRecoverableCommandOperationIfNeeded({
        kind: 'start-command',
        input: {
          command: nextCommand,
          mode: 'command',
        },
      })
      setSendError(getErrorMessage(error, 'Failed to start command session.'))
      void queryClient.invalidateQueries({ queryKey: ['workspace-runtime-state', workspaceId] })
    }
  }

  async function runThreadShellCommand(commandLine: string) {
    if (!selectedThreadId) {
      return
    }

    const nextCommand = commandLine.trim()
    if (!nextCommand) {
      return
    }

    setRecoverableCommandOperation(null)

    try {
      await threadShellCommandMutation.mutateAsync({
        threadId: selectedThreadId,
        command: nextCommand,
      })
    } catch (error) {
      await captureRecoverableCommandOperationIfNeeded({
        kind: 'thread-shell-command',
        input: {
          threadId: selectedThreadId,
          command: nextCommand,
        },
      })
      setSendError(getErrorMessage(error, 'Failed to run shell command.'))
      void queryClient.invalidateQueries({ queryKey: ['workspace-runtime-state', workspaceId] })
    }
  }

  async function handleStartCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command.trim()) {
      return
    }

    if (commandRunMode === 'thread-shell') {
      if (!selectedThreadId) {
        return
      }

      await runThreadShellCommand(command)
      return
    }

    await startExecCommand(command)
  }

  function handleStartTerminalCommandLine(commandLine: string) {
    void startExecCommand(commandLine)
  }

  function handleStartTerminalShellSession(shell?: string) {
    void (async () => {
      setRecoverableCommandOperation(null)

      try {
        await startCommandMutation.mutateAsync({
          mode: 'shell',
          ...(shell ? { shell } : {}),
        })
      } catch (error) {
        await captureRecoverableCommandOperationIfNeeded({
          kind: 'start-command',
          input: {
            mode: 'shell',
            ...(shell ? { shell } : {}),
          },
        })
        setSendError(getErrorMessage(error, 'Failed to start shell session.'))
        void queryClient.invalidateQueries({ queryKey: ['workspace-runtime-state', workspaceId] })
      }
    })()
  }

  async function handleRestartAndRetryCommandOperation() {
    if (!recoverableCommandOperation || restartRuntimeMutation.isPending) {
      return
    }

    setIsRestartAndRetryPending(true)
    setSendError(null)

    try {
      await restartRuntimeMutation.mutateAsync()

      if (recoverableCommandOperation.kind === 'thread-shell-command') {
        await runThreadShellCommand(recoverableCommandOperation.input.command)
        return
      }

      if (recoverableCommandOperation.input.mode === 'shell') {
        await startCommandMutation.mutateAsync(recoverableCommandOperation.input)
        return
      }

      await startExecCommand(recoverableCommandOperation.input.command ?? '')
    } catch (error) {
      setSendError(getErrorMessage(error, 'Failed to restart runtime and retry the terminal action.'))
    } finally {
      setIsRestartAndRetryPending(false)
    }
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
    handleRestartAndRetryCommandOperation,
    handleToggleArchivedCommandSession,
    handleTogglePinnedCommandSession,
    handleTerminateSelectedCommandSession,
    handleWriteTerminalData,
  }
}

function shouldOfferRestartAndRetry(state: WorkspaceRuntimeState | null | undefined) {
  if (!state) {
    return false
  }

  return (
    Boolean(state.lastErrorRequiresRuntimeRecycle) ||
    (state.lastErrorRecoveryAction ?? '').trim() === 'retry-after-restart'
  )
}
