import type { FormEvent } from 'react'

import { getThread, resumeThread } from '../../features/threads/api'
import { getErrorMessage } from '../../lib/error-utils'
import type { Thread, ThreadTurn, TurnResult } from '../../types/api'
import {
  createPendingTurn,
  shouldRetryTurnAfterResume,
  updateThreadStatusInList,
} from '../threadPageTurnHelpers'
import type { ThreadPageThreadActionsInput } from './threadPageActionTypes'

export function buildThreadPageThreadActions({
  archiveThreadMutation,
  closeDeleteThreadDialog,
  compactDisabledReason,
  compactThreadMutation,
  composerPreferences,
  confirmingThreadDelete,
  deleteThreadMutation,
  editingThreadName,
  interruptTurnMutation,
  invalidateThreadQueries,
  isInterruptMode,
  isLoadingOlderTurns,
  message,
  oldestDisplayedTurnId,
  queryClient,
  renameThreadMutation,
  requestDeleteSelectedThread,
  respondApprovalMutation,
  scrollThreadToLatest,
  selectedThread,
  selectedThreadId,
  setActiveComposerPanel,
  setApprovalAnswers,
  setComposerCaret,
  setComposerCommandMenu,
  setDismissedComposerAutocompleteKey,
  setHasMoreHistoricalTurnsBefore,
  setHistoricalTurns,
  setIsLoadingOlderTurns,
  setMessage,
  setSendError,
  startTurnMutation,
  threadDetail,
  unarchiveThreadMutation,
  updatePendingTurn,
  workspaceId,
}: ThreadPageThreadActionsInput) {
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

  async function handleLoadOlderTurns() {
    if (
      !selectedThreadId ||
      !oldestDisplayedTurnId ||
      isLoadingOlderTurns
    ) {
      return
    }

    setIsLoadingOlderTurns(true)

    try {
      const page = await queryClient.fetchQuery({
        queryKey: [
          'thread-detail-page',
          workspaceId,
          selectedThreadId,
          oldestDisplayedTurnId,
          threadDetailPageSize(threadDetail),
        ],
        queryFn: () =>
          getThread(workspaceId, selectedThreadId, {
            beforeTurnId: oldestDisplayedTurnId,
            turnLimit: threadDetailPageSize(threadDetail),
          }),
        staleTime: 15_000,
      })

      setHistoricalTurns((current) => mergeHistoricalTurns(page.turns, current))
      setHasMoreHistoricalTurnsBefore(Boolean(page.hasMoreTurns))
    } catch (error) {
      setSendError(getErrorMessage(error, 'Failed to load older turns.'))
    } finally {
      setIsLoadingOlderTurns(false)
    }
  }

  return {
    handleApprovalAnswerChange,
    handleCloseDeleteThreadDialog,
    handleCompactSelectedThread,
    handleConfirmDeleteThreadDialog,
    handleDeleteSelectedThread,
    handlePrimaryComposerAction,
    handleRespondApproval,
    handleSendMessage,
    handleSubmitRenameSelectedThread,
    handleToggleArchiveSelectedThread,
    handleLoadOlderTurns,
  }
}

function threadDetailPageSize(threadDetail?: { turns?: ThreadTurn[] }) {
  return Math.max(threadDetail?.turns?.length ?? 0, 80)
}

function mergeHistoricalTurns(nextTurns: ThreadTurn[], currentTurns: ThreadTurn[]) {
  const mergedTurns: ThreadTurn[] = []
  const seenTurnIds = new Set<string>()

  for (const turn of [...nextTurns, ...currentTurns]) {
    if (seenTurnIds.has(turn.id)) {
      continue
    }

    seenTurnIds.add(turn.id)
    mergedTurns.push(turn)
  }

  return mergedTurns
}
