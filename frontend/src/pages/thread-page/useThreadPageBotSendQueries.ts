import { useQuery } from '@tanstack/react-query'

import { ApiClientError } from '../../lib/api-client'
import { getThreadBotBinding, listAllBots, listBotDeliveryTargets } from '../../features/bots/api'
import type { ThreadBotBinding } from '../../types/api'
import type { UseThreadPageBotSendQueriesInput } from './threadPageRuntimeTypes'

export function useThreadPageBotSendQueries({
  selectedBotId,
  selectedThreadId,
  workspaceId,
}: UseThreadPageBotSendQueriesInput) {
  const botSendBotsQuery = useQuery({
    queryKey: ['thread-page-bots', workspaceId],
    queryFn: () => listAllBots(),
    enabled: Boolean(workspaceId && selectedThreadId),
    staleTime: 15_000,
  })

  const selectedBotWorkspaceId =
    botSendBotsQuery.data?.find((bot) => bot.id === selectedBotId)?.workspaceId?.trim() ?? ''

  const botSendDeliveryTargetsQuery = useQuery({
    queryKey: ['thread-page-bot-delivery-targets', selectedBotWorkspaceId, selectedBotId],
    queryFn: () => listBotDeliveryTargets(selectedBotWorkspaceId, selectedBotId ?? ''),
    enabled: Boolean(workspaceId && selectedThreadId && selectedBotId && selectedBotWorkspaceId),
    staleTime: 15_000,
  })

  const threadBotBindingQuery = useQuery<ThreadBotBinding | null>({
    queryKey: ['thread-bot-binding', workspaceId, selectedThreadId],
    queryFn: async () => {
      try {
        return await getThreadBotBinding(workspaceId, selectedThreadId ?? '')
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404) {
          return null
        }
        throw error
      }
    },
    enabled: Boolean(workspaceId && selectedThreadId),
    staleTime: 15_000,
    retry: false,
  })

  return {
    botSendBotsQuery,
    botSendDeliveryTargetsQuery,
    threadBotBindingQuery,
  }
}
