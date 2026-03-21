import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, FormEvent, SetStateAction } from 'react'

import { resumeThread } from '../../features/threads/api'
import { getErrorMessage } from '../../lib/error-utils'
import type { Thread, TurnResult } from '../../types/api'
import {
  createPendingTurn,
  shouldRetryTurnAfterResume,
  type PendingThreadTurn,
  updateThreadStatusInList,
} from '../threadPageTurnHelpers'
import type {
  ComposerAssistPanel,
  ComposerCommandMenu,
  ComposerPreferences,
} from './threadPageComposerShared'

export function useThreadPageActions({
  archiveThreadMutation,
  clearCompletedCommandSessions,
  closeDeleteThreadDialog,
  command,
  commandSessions,
  compactDisabledReason,
  compactThreadMutation,
  composerPreferences,
  confirmingThreadDelete,
  deleteThreadMutation,
  editingThreadName,
  interruptTurnMutation,
  invalidateThreadQueries,
  isInterruptMode,
  message,
  queryClient,
  removeCommandSession,
  renameThreadMutation,
  requestDeleteSelectedThread,
  respondApprovalMutation,
  scrollThreadToLatest,
  selectedCommandSession,
  selectedProcessId,
  selectedThread,
  selectedThreadId,
  setActiveComposerPanel,
  setApprovalAnswers,
  setComposerCaret,
  setComposerCommandMenu,
  setDismissedComposerAutocompleteKey,
  setIsTerminalDockExpanded,
  setMessage,
  setSelectedProcessId,
  setSendError,
  startCommandMutation,
  startTurnMutation,
  stdinValue,
  terminateCommandMutation,
  unarchiveThreadMutation,
  updatePendingTurn,
  workspaceId,
  writeCommandMutation,
}: {
  archiveThreadMutation: {
    mutate: (threadId: string) => void
  }
  clearCompletedCommandSessions: (workspaceId: string) => void
  closeDeleteThreadDialog: () => void
  command: string
  commandSessions: Array<{ id: string; status: string }>
  compactDisabledReason: string | null
  compactThreadMutation: {
    isPending: boolean
    mutate: (threadId: string) => void
  }
  composerPreferences: ComposerPreferences
  confirmingThreadDelete: { id: string } | null
  deleteThreadMutation: {
    isPending: boolean
    mutate: (threadId: string) => void
    reset: () => void
  }
  editingThreadName: string
  interruptTurnMutation: {
    isPending: boolean
    mutate: () => void
  }
  invalidateThreadQueries: () => Promise<unknown>
  isInterruptMode: boolean
  message: string
  queryClient: QueryClient
  removeCommandSession: (workspaceId: string, processId: string) => void
  renameThreadMutation: {
    mutate: (input: { threadId: string; name: string }) => void
  }
  requestDeleteSelectedThread: () => void
  respondApprovalMutation: {
    mutate: (input: {
      requestId: string
      action: string
      answers?: Record<string, string[]>
    }) => void
  }
  scrollThreadToLatest: (behavior?: ScrollBehavior) => void
  selectedCommandSession?: { id: string }
  selectedProcessId?: string
  selectedThread?: { id: string; archived: boolean }
  selectedThreadId?: string
  setActiveComposerPanel: Dispatch<SetStateAction<ComposerAssistPanel | null>>
  setApprovalAnswers: Dispatch<SetStateAction<Record<string, Record<string, string>>>>
  setComposerCaret: (value: number) => void
  setComposerCommandMenu: Dispatch<SetStateAction<ComposerCommandMenu>>
  setDismissedComposerAutocompleteKey: (value: string | null) => void
  setIsTerminalDockExpanded: (value: boolean) => void
  setMessage: (value: string) => void
  setSelectedProcessId: (value: string | undefined) => void
  setSendError: (value: string | null) => void
  startCommandMutation: {
    mutate: (input: { command: string }) => void
  }
  startTurnMutation: {
    mutateAsync: (input: {
      threadId: string
      input: string
      model?: string
      reasoningEffort?: string
      permissionPreset?: string
      collaborationMode?: string
    }) => Promise<TurnResult>
  }
  stdinValue: string
  terminateCommandMutation: {
    mutate: (processId: string) => void
  }
  unarchiveThreadMutation: {
    mutate: (threadId: string) => void
  }
  updatePendingTurn: (
    threadId: string,
    updater: (current: PendingThreadTurn | null) => PendingThreadTurn | null,
  ) => void
  workspaceId: string
  writeCommandMutation: {
    mutate: (input: { processId: string; input: string }) => void
  }
}) {
  function handleDeleteSelectedThread() {
    if (!selectedThread || deleteThreadMutation.isPending) {
      return
    }

    deleteThreadMutation.reset()
    requestDeleteSelectedThread()
  }

  function handleSubmitRenameSelectedThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedThread || !editingThreadName.trim()) {
      return
    }

    renameThreadMutation.mutate({
      threadId: selectedThread.id,
      name: editingThreadName.trim(),
    })
  }

  function handleToggleArchiveSelectedThread() {
    if (!selectedThread) {
      return
    }

    if (selectedThread.archived) {
      unarchiveThreadMutation.mutate(selectedThread.id)
      return
    }

    archiveThreadMutation.mutate(selectedThread.id)
  }

  function handleCloseDeleteThreadDialog() {
    if (deleteThreadMutation.isPending) {
      return
    }

    closeDeleteThreadDialog()
    deleteThreadMutation.reset()
  }

  function handleConfirmDeleteThreadDialog() {
    if (!confirmingThreadDelete || deleteThreadMutation.isPending) {
      return
    }

    deleteThreadMutation.mutate(confirmingThreadDelete.id)
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedThreadId || !selectedThread || !message.trim()) {
      return
    }

    const input = message.trim()
    const optimisticTurn = createPendingTurn(selectedThreadId, input)
    const optimisticStatusUpdatedAt = new Date().toISOString()
    const startTurnInput = {
      threadId: selectedThreadId,
      input,
      model: composerPreferences.model || undefined,
      reasoningEffort: composerPreferences.reasoningEffort,
      permissionPreset: composerPreferences.permissionPreset,
      collaborationMode: composerPreferences.collaborationMode === 'plan' ? 'plan' : undefined,
    }

    setSendError(null)
    updatePendingTurn(selectedThreadId, () => optimisticTurn)
    setMessage('')
    setComposerCaret(0)
    setComposerCommandMenu('root')
    setDismissedComposerAutocompleteKey(null)
    setActiveComposerPanel(null)
    queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
      updateThreadStatusInList(current, selectedThreadId, 'running', optimisticStatusUpdatedAt),
    )
    queryClient.setQueryData<Thread[]>(['shell-threads', workspaceId], (current) =>
      updateThreadStatusInList(current, selectedThreadId, 'running', optimisticStatusUpdatedAt),
    )
    queryClient.setQueryData<string[]>(['loaded-threads', workspaceId], (current) => {
      if (!current?.length) {
        return current
      }

      return current.includes(selectedThreadId) ? current : [...current, selectedThreadId]
    })
    scrollThreadToLatest('smooth')

    try {
      let result: TurnResult

      try {
        result = await startTurnMutation.mutateAsync(startTurnInput)
      } catch (error) {
        if (!shouldRetryTurnAfterResume(error)) {
          throw error
        }

        await resumeThread(workspaceId, selectedThreadId)
        result = await startTurnMutation.mutateAsync(startTurnInput)
      }

      updatePendingTurn(selectedThreadId, (current) =>
        current?.localId === optimisticTurn.localId
          ? {
              ...current,
              phase: 'waiting',
              turnId: result.turnId,
            }
          : current,
      )

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    } catch (error) {
      updatePendingTurn(selectedThreadId, (current) =>
        current?.localId === optimisticTurn.localId ? null : current,
      )
      setMessage(input)
      setComposerCaret(input.length)
      setSendError(getErrorMessage(error, 'Failed to send message.'))
      void invalidateThreadQueries()
    }
  }

  function handleStartCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command.trim()) {
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

  function handleApprovalAnswerChange(requestId: string, questionId: string, value: string) {
    setApprovalAnswers((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] ?? {}),
        [questionId]: value,
      },
    }))
  }

  function handleRespondApproval(input: {
    requestId: string
    action: string
    answers?: Record<string, string[]>
  }) {
    respondApprovalMutation.mutate(input)
  }

  function handlePrimaryComposerAction() {
    if (!isInterruptMode || !selectedThreadId) {
      return
    }

    interruptTurnMutation.mutate()
  }

  function handleCompactSelectedThread() {
    if (!selectedThreadId || compactDisabledReason || compactThreadMutation.isPending) {
      return
    }

    compactThreadMutation.mutate(selectedThreadId)
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
    handleApprovalAnswerChange,
    handleClearCompletedCommandSessions,
    handleCloseDeleteThreadDialog,
    handleCompactSelectedThread,
    handleConfirmDeleteThreadDialog,
    handleDeleteSelectedThread,
    handlePrimaryComposerAction,
    handleRemoveCommandSession,
    handleRespondApproval,
    handleSendMessage,
    handleSendStdin,
    handleStartCommand,
    handleSubmitRenameSelectedThread,
    handleTerminateSelectedCommandSession,
    handleToggleArchiveSelectedThread,
  }
}
