import type { FormEvent } from 'react'

import { accountQueryKey } from '../../features/account/api'
import {
  getThread,
  getThreadTurn,
  getThreadTurnItem,
  getThreadTurnItemOutput,
  resumeThread,
} from '../../features/threads/api'
import { updateThreadPage } from '../../features/threads/cache'
import { getErrorMessage, isAuthenticationError } from '../../lib/error-utils'
import type { Thread, ThreadListPage, ThreadTurn, TurnResult } from '../../types/api'
import {
  createPendingTurn,
  shouldRetryTurnAfterResume,
  updateThreadStatusInList,
} from '../threadPageTurnHelpers'
import { threadTurnItemOverrideKey } from './threadPageContentOverrideUtils'
import { parseBangShellCommandShortcut } from './threadShellShortcut'
import type { FindThreadItemInput } from './buildThreadPageThreadActionsTypes'
import type {
  ThreadPageRespondApprovalInput,
  ThreadPageActionsInput,
} from './threadPageActionTypes'
import { THREAD_TURN_WINDOW_INCREMENT } from './useThreadPageControllerLocalState'

const COMMAND_OUTPUT_TAIL_WINDOW_LINES = 1_200

export function buildThreadPageThreadActions({
  archiveThreadMutation,
  closeDeleteThreadDialog,
  compactDisabledReason,
  compactThreadMutation,
  composerPreferences,
  confirmingThreadDelete,
  deleteThreadMutation,
  editingThreadName,
  fullTurnItemContentOverridesById,
  fullTurnItemOverridesById,
  fullTurnItemRetainCountById,
  fullTurnOverridesById,
  fullTurnRetainCountById,
  historicalTurns,
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
  setAuthRecoveryRequestedAt,
  setComposerCaret,
  setComposerCommandMenu,
  setDismissedComposerAutocompleteKey,
  setFullTurnItemContentOverridesById,
  setFullTurnItemOverridesById,
  setFullTurnItemRetainCountById,
  setFullTurnOverridesById,
  setFullTurnRetainCountById,
  setHasMoreHistoricalTurnsBefore,
  setHistoricalTurns,
  setIsLoadingOlderTurns,
  setMessage,
  setSendError,
  startTurnMutation,
  threadShellCommandMutation,
  threadDetail,
  unarchiveThreadMutation,
  updatePendingTurn,
  workspaceId,
}: ThreadPageActionsInput) {
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
    const shellCommand = parseBangShellCommandShortcut(input)

    if (shellCommand) {
      setSendError(null)
      setMessage('')
      setComposerCaret(0)
      setComposerCommandMenu('root')
      setDismissedComposerAutocompleteKey(null)
      setActiveComposerPanel(null)
      scrollThreadToLatest('smooth')

      try {
        await threadShellCommandMutation.mutateAsync({
          threadId: selectedThreadId,
          command: shellCommand,
        })

        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
          queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
          queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
          queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
        ])
      } catch (error) {
        setMessage(input)
        setComposerCaret(input.length)
        setSendError(getErrorMessage(error, 'Failed to run shell command.'))
        void invalidateThreadQueries()
      }

      return
    }

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
    queryClient.setQueriesData<ThreadListPage>(
      { queryKey: ['shell-threads', workspaceId] },
      (current) =>
        current
          ? updateThreadPage(current, {
              ...(current.data.find((thread) => thread.id === selectedThreadId) ?? {
                archived: false,
                createdAt: optimisticStatusUpdatedAt,
                id: selectedThreadId,
                name: '',
                status: 'running',
                updatedAt: optimisticStatusUpdatedAt,
                workspaceId,
              }),
              status: 'running',
              updatedAt: optimisticStatusUpdatedAt,
            })
          : current,
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
      setAuthRecoveryRequestedAt(Date.now())

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: accountQueryKey(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    } catch (error) {
      updatePendingTurn(selectedThreadId, (current) =>
        current?.localId === optimisticTurn.localId ? null : current,
      )
      if (isAuthenticationError(error)) {
        setAuthRecoveryRequestedAt(null)
      }
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

  function handleRespondApproval(input: ThreadPageRespondApprovalInput) {
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

  async function handleLoadFullTurn(turnId: string, itemId?: string) {
    if (!selectedThreadId || !turnId) {
      return
    }

    if (itemId) {
      const itemKey = threadTurnItemOverrideKey(turnId, itemId)
      const itemOverride = fullTurnItemOverridesById[itemKey]
      const itemContentOverride = fullTurnItemContentOverridesById[itemKey]
      if (itemOverride) {
        return
      }

      try {
        const item = findThreadItem(turnId, itemId, {
          fullTurnItemOverridesById,
          fullTurnOverridesById,
          historicalTurns,
          turns: threadDetail?.turns ?? [],
        })

        if (stringField(item?.type) === 'commandExecution') {
          if (stringField(itemContentOverride?.outputContentMode) === 'full') {
            return
          }

          const outputMode =
            !itemContentOverride
              ? 'summary'
              : stringField(itemContentOverride.outputContentMode) === 'summary'
                ? 'tail'
                : stringField(itemContentOverride.outputContentMode) === 'tail'
                  ? 'tail'
                  : 'full'
          const beforeLine =
            outputMode === 'tail' && stringField(itemContentOverride?.outputContentMode) === 'tail'
              ? numberField(itemContentOverride?.outputStartLine)
              : undefined
          const tailLines =
            outputMode === 'tail'
              ? nextCommandOutputTailLines(itemContentOverride)
              : undefined

          const output = await getThreadTurnItemOutput(workspaceId, selectedThreadId, turnId, itemId, {
            beforeLine,
            outputMode,
            tailLines,
          })

          setFullTurnItemContentOverridesById((current) =>
            ({
              ...current,
              [itemKey]: mergeCommandOutputOverride(current[itemKey], output),
            }),
          )
          return
        }

        if (itemContentOverride) {
          return
        }

        const fullItem = await getThreadTurnItem(workspaceId, selectedThreadId, turnId, itemId, {
          contentMode: 'full',
        })

        setFullTurnItemOverridesById((current) =>
          current[itemKey]
            ? current
            : {
                ...current,
                [itemKey]: fullItem,
              },
        )
      } catch (error) {
        setSendError(getErrorMessage(error, 'Failed to load the full item.'))
      }

      return
    }

    if (fullTurnOverridesById[turnId]) {
      return
    }

    try {
      const turn = await getThreadTurn(workspaceId, selectedThreadId, turnId, {
        contentMode: 'full',
      })

      setFullTurnOverridesById((current) =>
        current[turnId]
          ? current
          : {
              ...current,
              [turnId]: turn,
            },
      )
    } catch (error) {
      setSendError(getErrorMessage(error, 'Failed to load the full turn.'))
    }
  }

  function handleRetainFullTurn(turnId: string, itemId?: string) {
    if (!turnId) {
      return
    }

    if (itemId) {
      const itemKey = threadTurnItemOverrideKey(turnId, itemId)
      const retainCount = fullTurnItemRetainCountById[itemKey] ?? 0
      setFullTurnItemRetainCountById((current) => ({
        ...current,
        [itemKey]: (current[itemKey] ?? 0) + 1,
      }))

      if (
        !fullTurnItemOverridesById[itemKey] &&
        !fullTurnItemContentOverridesById[itemKey] &&
        retainCount === 0
      ) {
        void handleLoadFullTurn(turnId, itemId)
      }
      return
    }

    const retainCount = fullTurnRetainCountById[turnId] ?? 0
    setFullTurnRetainCountById((current) => ({
      ...current,
      [turnId]: (current[turnId] ?? 0) + 1,
    }))

    if (!fullTurnOverridesById[turnId] && retainCount === 0) {
      void handleLoadFullTurn(turnId)
    }
  }

  function handleReleaseFullTurn(turnId: string, itemId?: string) {
    if (!turnId) {
      return
    }

    if (itemId) {
      const itemKey = threadTurnItemOverrideKey(turnId, itemId)
      let shouldRemoveOverride = false
      setFullTurnItemRetainCountById((current) => {
        const nextCount = (current[itemKey] ?? 0) - 1
        if (nextCount > 0) {
          return {
            ...current,
            [itemKey]: nextCount,
          }
        }

        const next = { ...current }
        delete next[itemKey]
        shouldRemoveOverride = true
        return next
      })

      if (!shouldRemoveOverride) {
        return
      }

      setFullTurnItemOverridesById((current) => {
        if (!current[itemKey]) {
          return current
        }

        const next = { ...current }
        delete next[itemKey]
        return next
      })
      setFullTurnItemContentOverridesById((current) => {
        if (!current[itemKey]) {
          return current
        }

        const next = { ...current }
        delete next[itemKey]
        return next
      })
      return
    }

    let shouldRemoveOverride = false
    setFullTurnRetainCountById((current) => {
      const nextCount = (current[turnId] ?? 0) - 1
      if (nextCount > 0) {
        return {
          ...current,
          [turnId]: nextCount,
        }
      }

      const next = { ...current }
      delete next[turnId]
      shouldRemoveOverride = true
      return next
    })

    if (!shouldRemoveOverride) {
      return
    }

    setFullTurnOverridesById((current) => {
      if (!current[turnId]) {
        return current
      }

      const next = { ...current }
      delete next[turnId]
      return next
    })
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
      const page = await getThread(workspaceId, selectedThreadId, {
        beforeTurnId: oldestDisplayedTurnId,
        contentMode: 'summary',
        turnLimit: threadDetailPageSize(),
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
    handleLoadFullTurn,
    handleReleaseFullTurn,
    handleRetainFullTurn,
    handlePrimaryComposerAction,
    handleRespondApproval,
    handleSendMessage,
    handleSubmitRenameSelectedThread,
    handleToggleArchiveSelectedThread,
    handleLoadOlderTurns,
  }
}

function threadDetailPageSize() {
  return THREAD_TURN_WINDOW_INCREMENT
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

function findThreadItem(
  turnId: string,
  itemId: string,
  input: FindThreadItemInput,
) {
  const itemKey = threadTurnItemOverrideKey(turnId, itemId)
  const directOverride = input.fullTurnItemOverridesById[itemKey]
  if (directOverride) {
    return directOverride
  }

  const turnOverride = input.fullTurnOverridesById[turnId]
  const turnOverrideItem = turnOverride?.items.find((item) => stringField(item.id) === itemId)
  if (turnOverrideItem) {
    return turnOverrideItem
  }

  for (const turn of [...input.historicalTurns, ...input.turns]) {
    if (turn.id !== turnId) {
      continue
    }

    const item = turn.items.find((entry) => stringField(entry.id) === itemId)
    if (item) {
      return item
    }
  }

  return null
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nextCommandOutputTailLines(itemContentOverride: Record<string, unknown> | undefined) {
  const contentMode = stringField(itemContentOverride?.outputContentMode)
  if (contentMode !== 'tail') {
    return COMMAND_OUTPUT_TAIL_WINDOW_LINES
  }

  const totalLines = numberField(itemContentOverride?.outputLineCount)
  const startLine = numberField(itemContentOverride?.outputStartLine)
  const endLine = numberField(itemContentOverride?.outputEndLine)
  if (
    typeof totalLines !== 'number' ||
    typeof startLine !== 'number' ||
    typeof endLine !== 'number'
  ) {
    return COMMAND_OUTPUT_TAIL_WINDOW_LINES
  }

  const currentWindowSize = Math.max(0, endLine - startLine)
  if (currentWindowSize <= 0) {
    return COMMAND_OUTPUT_TAIL_WINDOW_LINES
  }

  return Math.min(totalLines, currentWindowSize + COMMAND_OUTPUT_TAIL_WINDOW_LINES)
}

function mergeCommandOutputOverride(
  current: Record<string, unknown> | undefined,
  output: {
    aggregatedOutput: string
    command?: string
    outputContentMode?: string
    outputEndOffset?: number
    outputEndLine?: number
    outputLineCount?: number
    outputStartOffset?: number
    outputStartLine?: number
    outputTotalLength?: number
    outputTruncated?: boolean
  },
) {
  const currentContentMode = stringField(current?.outputContentMode)
  const currentOutputChunks = stringArrayField(current?.aggregatedOutputChunks)
  const currentOutput = currentOutputChunks.length
    ? currentOutputChunks.join('')
    : stringField(current?.aggregatedOutput)
  const currentStartLine = numberField(current?.outputStartLine)
  const currentEndLine = numberField(current?.outputEndLine)
  const currentStartOffset = numberField(current?.outputStartOffset)
  const currentEndOffset = numberField(current?.outputEndOffset)
  const nextStartLine = output.outputStartLine
  const nextEndLine = output.outputEndLine
  const nextStartOffset = output.outputStartOffset
  const nextEndOffset = output.outputEndOffset
  const nextTotalLength = output.outputTotalLength

  if (
    currentContentMode === 'tail' &&
    typeof currentStartLine === 'number' &&
    typeof currentEndLine === 'number' &&
    typeof currentStartOffset === 'number' &&
    typeof currentEndOffset === 'number' &&
    typeof nextStartLine === 'number' &&
    typeof nextEndLine === 'number' &&
    typeof nextStartOffset === 'number' &&
    typeof nextEndOffset === 'number' &&
    nextEndLine === currentStartLine &&
    nextEndOffset === currentStartOffset
  ) {
    const mergedOutputChunks = currentOutputChunks.length
      ? [output.aggregatedOutput, ...currentOutputChunks]
      : currentOutput
        ? [output.aggregatedOutput, currentOutput]
        : [output.aggregatedOutput]
    const mergedCommand = output.command ?? stringField(current?.command)
    const mergedStartLine = nextStartLine
    const mergedEndLine = currentEndLine
    const mergedStartOffset = nextStartOffset
    const mergedEndOffset = currentEndOffset
    const mergedTotalLength = nextTotalLength ?? numberField(current?.outputTotalLength) ?? mergedEndOffset
    const mergedContentMode =
      mergedStartLine === 0 &&
      typeof output.outputLineCount === 'number' &&
      mergedEndLine === output.outputLineCount
        ? 'full'
        : 'tail'

    return {
      aggregatedOutputChunks: mergedOutputChunks,
      command: mergedCommand || undefined,
      outputContentMode: mergedContentMode,
      outputEndOffset: mergedEndOffset,
      outputEndLine: mergedEndLine,
      outputLineCount: output.outputLineCount,
      outputStartOffset: mergedStartOffset,
      outputStartLine: mergedStartLine,
      outputTotalLength: mergedTotalLength,
      outputTruncated: mergedContentMode !== 'full',
    }
  }

  return {
    aggregatedOutputChunks: [output.aggregatedOutput],
    command: output.command,
    outputContentMode: output.outputContentMode,
    outputEndOffset: output.outputEndOffset,
    outputEndLine: output.outputEndLine,
    outputLineCount: output.outputLineCount,
    outputStartOffset: output.outputStartOffset,
    outputStartLine: output.outputStartLine,
    outputTotalLength: output.outputTotalLength,
    outputTruncated: output.outputTruncated,
  }
}

function stringArrayField(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
