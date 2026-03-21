import { useMutation, type QueryClient } from '@tanstack/react-query'

import { respondServerRequestWithDetails } from '../../features/approvals/api'
import { startCommand, terminateCommand, writeCommand } from '../../features/commands/api'
import {
  archiveThread,
  compactThread,
  deleteThread,
  renameThread,
  unarchiveThread,
} from '../../features/threads/api'
import { interruptTurn, startTurn } from '../../features/turns/api'
import { useSessionStore } from '../../stores/session-store'
import type { Thread, TurnResult } from '../../types/api'
import type { ContextCompactionFeedback } from './threadPageComposerShared'

export function useThreadPageMutations({
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
  setIsTerminalDockExpanded,
  setSelectedProcessId,
  setSelectedThread,
  setSendError,
  setStdinValue,
  workspaceId,
}: {
  clearPendingTurn: (threadId: string) => void
  queryClient: QueryClient
  removeThreadFromSession: (workspaceId: string, threadId: string) => void
  selectedThreadId?: string
  setApprovalAnswers: (
    value:
      | Record<string, Record<string, string>>
      | ((
          current: Record<string, Record<string, string>>,
        ) => Record<string, Record<string, string>>),
  ) => void
  setApprovalErrors: (
    value:
      | Record<string, string>
      | ((current: Record<string, string>) => Record<string, string>),
  ) => void
  setCommand: (value: string) => void
  setConfirmingThreadDelete: (value: Thread | null) => void
  setContextCompactionFeedback: (
    value: ContextCompactionFeedback | null | ((current: ContextCompactionFeedback | null) => ContextCompactionFeedback | null),
  ) => void
  setEditingThreadId: (value: string | undefined | ((current: string | undefined) => string | undefined)) => void
  setEditingThreadName: (value: string) => void
  setIsTerminalDockExpanded: (value: boolean) => void
  setSelectedProcessId: (value: string | undefined) => void
  setSelectedThread: (workspaceId: string, threadId?: string) => void
  setSendError: (value: string | null) => void
  setStdinValue: (value: string) => void
  workspaceId: string
}) {
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
        title: 'Queued',
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
        title: 'Failed',
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

  const startCommandMutation = useMutation({
    mutationFn: (input: { command: string }) => startCommand(workspaceId, input),
    onSuccess: (session) => {
      useSessionStore.getState().upsertCommandSession(session)
      setSelectedProcessId(session.id)
      setIsTerminalDockExpanded(true)
      setCommand('')
    },
  })

  const writeCommandMutation = useMutation({
    mutationFn: ({ processId, input }: { processId: string; input: string }) =>
      writeCommand(workspaceId, processId, { input }),
    onSuccess: () => {
      setStdinValue('')
    },
  })

  const terminateCommandMutation = useMutation({
    mutationFn: (processId: string) => terminateCommand(workspaceId, processId),
  })

  return {
    archiveThreadMutation,
    compactThreadMutation,
    deleteThreadMutation,
    interruptTurnMutation,
    invalidateThreadQueries,
    renameThreadMutation,
    respondApprovalMutation,
    startCommandMutation,
    startTurnMutation,
    terminateCommandMutation,
    unarchiveThreadMutation,
    writeCommandMutation,
  }
}
