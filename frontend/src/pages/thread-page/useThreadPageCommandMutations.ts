import { useMutation } from '@tanstack/react-query'

import {
  startCommand,
  terminateCommand,
  type StartCommandInput,
  writeCommand,
} from '../../features/commands/api'
import { getErrorMessage } from '../../lib/error-utils'
import { useSessionStore } from '../../stores/session-store'
import type { ThreadPageWriteCommandMutationInput } from './threadPageActionTypes'
import type { ThreadPageCommandMutationsInput } from './threadPageMutationTypes'

export function useThreadPageCommandMutations({
  queryClient,
  setCommand,
  setIsTerminalDockExpanded,
  setIsTerminalDockVisible,
  setSelectedProcessId,
  setSendError,
  setStdinValue,
  streamState,
  workspaceId,
}: ThreadPageCommandMutationsInput) {
  const startCommandMutation = useMutation({
    mutationFn: (input: StartCommandInput) => startCommand(workspaceId, input),
    onSuccess: (session) => {
      useSessionStore.getState().upsertCommandSession(session)
      setSelectedProcessId(session.id)
      setIsTerminalDockVisible(true)
      setIsTerminalDockExpanded(true)
      setCommand('')

      if (streamState !== 'open' && streamState !== 'connecting') {
        void queryClient.invalidateQueries({ queryKey: ['command-sessions', workspaceId] })
      }
    },
    onError: (error, variables) => {
      setSendError(
        getErrorMessage(
          error,
          variables.mode === 'shell'
            ? 'Failed to start shell session.'
            : 'Failed to start command session.',
        ),
      )
    },
  })

  const writeCommandMutation = useMutation({
    mutationFn: ({ processId, input }: ThreadPageWriteCommandMutationInput) =>
      writeCommand(workspaceId, processId, { input }),
    onSuccess: () => {
      setStdinValue('')
    },
    onError: (error) => {
      setSendError(getErrorMessage(error, 'Failed to send terminal input.'))
    },
  })

  const terminateCommandMutation = useMutation({
    mutationFn: (processId: string) => terminateCommand(workspaceId, processId),
    onError: (error) => {
      setSendError(getErrorMessage(error, 'Failed to stop terminal session.'))
    },
  })

  return {
    startCommandMutation,
    terminateCommandMutation,
    writeCommandMutation,
  }
}
