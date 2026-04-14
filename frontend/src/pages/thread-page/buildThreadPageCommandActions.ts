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
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'
import type { WorkspaceRuntimeState } from '../../types/api'
import { createThreadPageRuntimeRecoveryExecutionNotice } from './threadPageRecoveryExecution'
import { getRecoverableRuntimeActionKind } from './threadPageRuntimeRecovery'
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
  setRecoverableSendInput,
  setRuntimeRecoveryExecutionNotice,
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
    if (getRecoverableRuntimeActionKind(latestRuntimeState)) {
      setRecoverableSendInput(null)
      setRecoverableCommandOperation(nextOperation)
      return
    }

    setRecoverableCommandOperation(null)
  }

  async function startExecCommand(commandLine: string) {
    const nextCommand = commandLine.trim()
    if (!nextCommand) {
      return false
    }

    setRecoverableSendInput(null)
    setRecoverableCommandOperation(null)

    try {
      await startCommandMutation.mutateAsync({
        command: nextCommand,
        mode: 'command',
      })
      return true
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
      return false
    }
  }

  async function runThreadShellCommand(commandLine: string, threadId = selectedThreadId) {
    if (!threadId) {
      return false
    }

    const nextCommand = commandLine.trim()
    if (!nextCommand) {
      return false
    }

    setRecoverableSendInput(null)
    setRecoverableCommandOperation(null)

    try {
      await threadShellCommandMutation.mutateAsync({
        threadId,
        command: nextCommand,
      })
      return true
    } catch (error) {
      await captureRecoverableCommandOperationIfNeeded({
        kind: 'thread-shell-command',
        input: {
          threadId,
          command: nextCommand,
        },
      })
      setSendError(getErrorMessage(error, 'Failed to run shell command.'))
      void queryClient.invalidateQueries({ queryKey: ['workspace-runtime-state', workspaceId] })
      return false
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

  async function startShellSession(shell?: string) {
    const nextInput = {
      mode: 'shell' as const,
      ...(shell ? { shell } : {}),
    }

    setRecoverableSendInput(null)
    setRecoverableCommandOperation(null)

    try {
      await startCommandMutation.mutateAsync(nextInput)
      return true
    } catch (error) {
      await captureRecoverableCommandOperationIfNeeded({
        kind: 'start-command',
        input: nextInput,
      })
      setSendError(getErrorMessage(error, 'Failed to start shell session.'))
      void queryClient.invalidateQueries({ queryKey: ['workspace-runtime-state', workspaceId] })
      return false
    }
  }

  function handleStartTerminalShellSession(shell?: string) {
    void startShellSession(shell)
  }

  async function handleRestartAndRetryCommandOperation() {
    if (!recoverableCommandOperation || restartRuntimeMutation.isPending) {
      return
    }

    setIsRestartAndRetryPending(true)
    setSendError(null)

    try {
      await restartRuntimeMutation.mutateAsync()

      let didRetrySucceed = false
      if (recoverableCommandOperation.kind === 'thread-shell-command') {
        didRetrySucceed = await runThreadShellCommand(
          recoverableCommandOperation.input.command,
          recoverableCommandOperation.input.threadId,
        )
      } else if (recoverableCommandOperation.input.mode === 'shell') {
        didRetrySucceed = await startShellSession(recoverableCommandOperation.input.shell)
      } else {
        didRetrySucceed = await startExecCommand(
          recoverableCommandOperation.input.command ?? '',
        )
      }

      setRuntimeRecoveryExecutionNotice((current) =>
        createThreadPageRuntimeRecoveryExecutionNotice({
          actionKind: 'restart-and-retry',
          previous: current,
          status: didRetrySucceed ? 'success' : 'error',
          summary: didRetrySucceed
            ? i18n._({
                id: 'Runtime restarted and the failed terminal operation was started again.',
                message:
                  'Runtime restarted and the failed terminal operation was started again.',
              })
            : i18n._({
                id: 'Runtime restarted, but the failed terminal operation still could not be started.',
                message:
                  'Runtime restarted, but the failed terminal operation still could not be started.',
              }),
        }),
      )
    } catch (error) {
      const errorMessage = getErrorMessage(
        error,
        'Failed to restart runtime and retry the terminal action.',
      )
      setSendError(errorMessage)
      setRuntimeRecoveryExecutionNotice((current) =>
        createThreadPageRuntimeRecoveryExecutionNotice({
          actionKind: 'restart-and-retry',
          details: errorMessage,
          previous: current,
          status: 'error',
          summary: i18n._({
            id: 'The runtime could not be restarted for the terminal recovery replay.',
            message:
              'The runtime could not be restarted for the terminal recovery replay.',
          }),
        }),
      )
    } finally {
      setIsRestartAndRetryPending(false)
    }
  }

  async function handleRetryCommandOperation() {
    if (!recoverableCommandOperation) {
      return
    }

    setSendError(null)

    let didRetrySucceed = false
    if (recoverableCommandOperation.kind === 'thread-shell-command') {
      didRetrySucceed = await runThreadShellCommand(
        recoverableCommandOperation.input.command,
        recoverableCommandOperation.input.threadId,
      )
    } else if (recoverableCommandOperation.input.mode === 'shell') {
      didRetrySucceed = await startShellSession(recoverableCommandOperation.input.shell)
    } else {
      didRetrySucceed = await startExecCommand(
        recoverableCommandOperation.input.command ?? '',
      )
    }

    setRuntimeRecoveryExecutionNotice((current) =>
      createThreadPageRuntimeRecoveryExecutionNotice({
        actionKind: 'retry',
        previous: current,
        status: didRetrySucceed ? 'success' : 'error',
        summary: didRetrySucceed
          ? i18n._({
              id: 'The failed terminal operation was started again without restarting the runtime.',
              message:
                'The failed terminal operation was started again without restarting the runtime.',
            })
          : i18n._({
              id: 'Retry could not restart the failed terminal operation.',
              message: 'Retry could not restart the failed terminal operation.',
            }),
      }),
    )
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
    handleRetryCommandOperation,
    handleRestartAndRetryCommandOperation,
    handleToggleArchivedCommandSession,
    handleTogglePinnedCommandSession,
    handleTerminateSelectedCommandSession,
    handleWriteTerminalData,
  }
}
