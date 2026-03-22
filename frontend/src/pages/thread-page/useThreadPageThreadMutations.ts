import { useMutation } from '@tanstack/react-query'

import { respondServerRequestWithDetails } from '../../features/approvals/api'
import { i18n } from '../../i18n/runtime'
import {
  archiveThread,
  compactThread,
  deleteThread,
  renameThread,
  runThreadShellCommand,
  unarchiveThread,
} from '../../features/threads/api'
import { interruptTurn, startTurn } from '../../features/turns/api'
import type { Thread, TurnResult } from '../../types/api'
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

  const renameThreadMutation = useMutation({
    mutationFn: ({ threadId, name }: { threadId: string; name: string }) =>
      renameThread(workspaceId, threadId, { name }),
    onSuccess: async () => {
      setEditingThreadId(undefined)
      setEditingThreadName('')
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
      queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
        (current ?? []).filter((thread) => thread.id !== threadId),
      )
      queryClient.setQueryData<Thread[]>(['shell-threads', workspaceId], (current) =>
        (current ?? []).filter((thread) => thread.id !== threadId),
      )
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

      await Promise.all([
        invalidateThreadQueries(),
        queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
      ])
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
    {
      threadId: string
      input: string
      model?: string
      reasoningEffort?: string
      permissionPreset?: string
      collaborationMode?: string
    }
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
    onSuccess: async () => {
      if (selectedThreadId) {
        clearPendingTurn(selectedThreadId)
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    },
  })

  const respondApprovalMutation = useMutation({
    mutationFn: ({
      requestId,
      action,
      answers,
    }: {
      requestId: string
      action: string
      answers?: Record<string, string[]>
    }) => respondServerRequestWithDetails(requestId, { action, answers }),
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
      await queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] })
    },
  })

  const threadShellCommandMutation = useMutation({
    mutationFn: ({ threadId, command }: { threadId: string; command: string }) =>
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
