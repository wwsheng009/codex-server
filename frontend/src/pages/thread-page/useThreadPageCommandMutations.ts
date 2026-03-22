import { useMutation } from '@tanstack/react-query'

import { startCommand, terminateCommand, writeCommand } from '../../features/commands/api'
import { useSessionStore } from '../../stores/session-store'
import type { ThreadPageCommandMutationsInput } from './threadPageMutationTypes'

export function useThreadPageCommandMutations({
  setCommand,
  setIsTerminalDockExpanded,
  setSelectedProcessId,
  setStdinValue,
  workspaceId,
}: ThreadPageCommandMutationsInput) {
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
    startCommandMutation,
    terminateCommandMutation,
    writeCommandMutation,
  }
}
