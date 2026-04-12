import { useMutation } from '@tanstack/react-query'

import { accountQueryKey, rateLimitsQueryKey } from '../../features/account/api'
import { removeApprovalFromList, removeThreadApprovalsFromList } from '../../features/approvals/cache'
import { respondServerRequestWithDetails } from '../../features/approvals/api'
import {
  removeThreadFromThreadCaches,
  syncThreadIntoThreadCaches,
} from '../../features/threads/cache'
import { i18n } from '../../i18n/runtime'
import {
  archiveThread,
  compactThread,
  createThread,
  deleteThread,
  renameThread,
  runThreadShellCommand,
  unarchiveThread,
} from '../../features/threads/api'
import { interruptTurn, startTurn } from '../../features/turns/api'
import type { PendingApproval, Thread, ThreadDetail, ThreadListPage, TurnResult } from '../../types/api'
import {
  reconcileInterruptedThreadDetail,
  settleInterruptedThreadStatusInList,
  shouldReconcileNoActiveTurn,
} from '../threadPageTurnHelpers'
import type {
  ThreadPageRenameThreadMutationInput,
  ThreadPageRespondApprovalInput,
  ThreadPageStartTurnMutationInput,
  ThreadPageThreadShellCommandMutationInput,
} from './threadPageActionTypes'
import type { ThreadPageThreadMutationsInput } from './threadPageMutationTypes'

export function useThreadPageThreadMutations({
  clearPendingTurn,
  queryClient,
  removeThreadFromSession,
  selectedThreadId,
  setApprovalAnswers,
  setApprovalErrors,
  setCommand,
  setConfirmingThreadDelete,
  setContextCompactionFeedback,
  setEditingThreadId,
  setEditingThreadName,
  setSelectedThread,
  setSendError,
  workspaceId,
}: ThreadPageThreadMutationsInput) {
  async function invalidateThreadQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
    ])
  }

  function reconcileInterruptedThreadLocally(threadId: string, updatedAt = new Date().toISOString()) {
    queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
      settleInterruptedThreadStatusInList(current, threadId, updatedAt),
    )
    queryClient.setQueriesData<ThreadListPage>({ queryKey: ['shell-threads', workspaceId] }, (current) =>
      current
        ? {
            ...current,
            data: settleInterruptedThreadStatusInList(current.data, threadId, updatedAt) ?? current.data,
          }
        : current,
    )

    for (const [queryKey] of queryClient.getQueriesData({
      queryKey: ['thread-detail', workspaceId, threadId],
    })) {
      queryClient.setQueryData<ThreadDetail | undefined>(queryKey, (current) =>
        reconcileInterruptedThreadDetail(current, updatedAt),
      )
    }
  }

  const createThreadMutation = useMutation({
    mutationFn: () => createThread(workspaceId),
    onSuccess: async (thread) => {
      syncThreadIntoThreadCaches(queryClient, workspaceId, thread)
      setSelectedThread(workspaceId, thread.id)
      setSendError(null)
      await Promise.all([
        invalidateThreadQueries(),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-workspaces'] }),
      ])
    },
  })

  const renameThreadMutation = useMutation({
    mutationFn: ({ threadId, name }: ThreadPageRenameThreadMutationInput) =>
      renameThread(workspaceId, threadId, { name }),
    onSuccess: async (thread) => {
      setEditingThreadId(undefined)
      setEditingThreadName('')
      syncThreadIntoThreadCaches(queryClient, workspaceId, thread)
      await invalidateThreadQueries()
    },
  })

  const archiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => archiveThread(workspaceId, threadId),
    onSuccess: async () => {
      await invalidateThreadQueries()
    },
  })

  const unarchiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => unarchiveThread(workspaceId, threadId),
    onSuccess: async () => {
      await invalidateThreadQueries()
    },
  })

  const deleteThreadMutation = useMutation({
    mutationFn: (threadId: string) => deleteThread(workspaceId, threadId),
    onSuccess: async (_, threadId) => {
      removeThreadFromThreadCaches(queryClient, workspaceId, threadId)
      queryClient.removeQueries({ queryKey: ['thread-detail', workspaceId, threadId] })

      const remainingThreads =
        (queryClient.getQueryData<Thread[]>(['threads', workspaceId]) ?? []).filter(
          (thread) => thread.id !== threadId,
        )

      setEditingThreadId((current) => (current === threadId ? undefined : current))
      setEditingThreadName('')
      clearPendingTurn(threadId)
      setSendError(null)
      setConfirmingThreadDelete(null)
      deleteThreadMutation.reset()
      removeThreadFromSession(workspaceId, threadId)

      if (selectedThreadId === threadId) {
        setSelectedThread(workspaceId, remainingThreads[0]?.id)
      }

      queryClient.setQueryData<PendingApproval[]>(['approvals', workspaceId], (current: PendingApproval[] | undefined) =>
        removeThreadApprovalsFromList(current, threadId),
      )
      await invalidateThreadQueries()
    },
  })

  const compactThreadMutation = useMutation({
    mutationFn: (threadId: string) => compactThread(workspaceId, threadId),
    onMutate: (threadId) => {
      setContextCompactionFeedback({
        threadId,
        phase: 'requested',
        title: i18n._({
          id: 'Queued',
          message: 'Queued',
        }),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    },
    onError: (error, threadId) => {
      void error
      setContextCompactionFeedback({
        threadId,
        phase: 'failed',
        title: i18n._({
          id: 'Failed',
          message: 'Failed',
        }),
      })
    },
  })

  const startTurnMutation = useMutation<
    TurnResult,
    Error,
    ThreadPageStartTurnMutationInput
  >({
    mutationFn: ({ threadId, input, model, reasoningEffort, permissionPreset, collaborationMode }) =>
      startTurn(workspaceId, threadId, {
        input,
        model,
        reasoningEffort,
        permissionPreset,
        collaborationMode,
      }),
  })

  const interruptTurnMutation = useMutation({
    mutationFn: () => interruptTurn(workspaceId, selectedThreadId ?? ''),
    onSuccess: () => {
      const settledAt = new Date().toISOString()
      if (selectedThreadId) {
        clearPendingTurn(selectedThreadId)
        reconcileInterruptedThreadLocally(selectedThreadId, settledAt)
      }
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
        invalidateThreadQueries(),
      ])
    },
    onError: (error) => {
      if (!selectedThreadId || !shouldReconcileNoActiveTurn(error)) {
        return
      }

      const settledAt = new Date().toISOString()
      clearPendingTurn(selectedThreadId)
      reconcileInterruptedThreadLocally(selectedThreadId, settledAt)
      void Promise.all([
        queryClient.refetchQueries({
          queryKey: ['thread-detail', workspaceId, selectedThreadId],
          type: 'active',
        }),
        queryClient.refetchQueries({ queryKey: ['threads', workspaceId], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['shell-threads', workspaceId], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['loaded-threads', workspaceId], type: 'active' }),
      ])
    },
  })

  const respondApprovalMutation = useMutation({
    mutationFn: ({
      requestId,
      action,
      answers,
    }: ThreadPageRespondApprovalInput) => respondServerRequestWithDetails(requestId, { action, answers }),
    onSuccess: async (_, variables) => {
      setApprovalAnswers((current) => {
        const next = { ...current }
        delete next[variables.requestId]
        return next
      })
      setApprovalErrors((current) => {
        const next = { ...current }
        delete next[variables.requestId]
        return next
      })
      queryClient.setQueryData<PendingApproval[]>(['approvals', workspaceId], (current: PendingApproval[] | undefined) =>
        removeApprovalFromList(current, variables.requestId),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountQueryKey(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: rateLimitsQueryKey(workspaceId) }),
      ])
    },
  })

  const threadShellCommandMutation = useMutation({
    mutationFn: ({ threadId, command }: ThreadPageThreadShellCommandMutationInput) =>
      runThreadShellCommand(workspaceId, threadId, { command }),
    onSuccess: async (_, variables) => {
      setCommand('')
      setSendError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, variables.threadId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    },
  })

  return {
    archiveThreadMutation,
    compactThreadMutation,
    createThreadMutation,
    deleteThreadMutation,
    interruptTurnMutation,
    invalidateThreadQueries,
    renameThreadMutation,
    respondApprovalMutation,
    startTurnMutation,
    threadShellCommandMutation,
    unarchiveThreadMutation,
  }
}
