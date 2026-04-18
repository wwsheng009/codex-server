import type { QueryClient } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'

import {
  deleteThreadBotBinding,
  sendBotDeliveryTargetOutboundMessages,
  upsertThreadBotBinding,
} from '../../features/bots/api'

type ThreadPageBotMutationsInput = {
  queryClient: QueryClient
  setBotSendText: (value: string) => void
  threadWorkspaceId: string
  workspaceId: string
}

export function useThreadPageBotMutations({
  queryClient,
  setBotSendText,
  threadWorkspaceId,
  workspaceId,
}: ThreadPageBotMutationsInput) {
  const sendBotDeliveryTargetOutboundMessageMutation = useMutation({
    mutationFn: ({
      botWorkspaceId,
      botId,
      deliveryTargetId,
      text,
      threadId,
      threadWorkspaceId,
    }: {
      botWorkspaceId: string
      botId: string
      deliveryTargetId: string
      text: string
      threadId: string
      threadWorkspaceId: string
    }) =>
      sendBotDeliveryTargetOutboundMessages(botWorkspaceId, botId, deliveryTargetId, {
        sourceType: 'manual',
        sourceRefType: 'thread',
        sourceRefId: threadId,
        originWorkspaceId: threadWorkspaceId,
        originThreadId: threadId,
        idempotencyKey: `thread-bot-send:${threadWorkspaceId}:${threadId}:${Date.now()}`,
        messages: [
          {
            text,
          },
        ],
      }),
    onSuccess: () => {
      setBotSendText('')
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['thread-page-bot-delivery-targets', variables.botWorkspaceId, variables.botId],
        }),
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.botWorkspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-outbound-deliveries', variables.botWorkspaceId, variables.botId] }),
      ])
    },
  })

  const bindThreadBotChannelMutation = useMutation({
    mutationFn: ({
      botWorkspaceId,
      botId,
      deliveryTargetId,
      threadId,
    }: {
      botWorkspaceId: string
      botId: string
      deliveryTargetId: string
      threadId: string
    }) =>
      upsertThreadBotBinding(workspaceId, threadId, {
        botWorkspaceId,
        botId,
        deliveryTargetId,
      }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-bot-binding', threadWorkspaceId, variables.threadId] }),
        queryClient.invalidateQueries({
          queryKey: ['thread-page-bot-delivery-targets', variables.botWorkspaceId, variables.botId],
        }),
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.botWorkspaceId, variables.botId] }),
      ])
    },
  })

  const deleteThreadBotBindingMutation = useMutation({
    mutationFn: ({ threadId }: { threadId: string }) => deleteThreadBotBinding(workspaceId, threadId),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-bot-binding', threadWorkspaceId, variables.threadId] }),
        queryClient.invalidateQueries({ queryKey: ['thread-page-bot-delivery-targets'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets'] }),
      ])
    },
  })

  return {
    bindThreadBotChannelMutation,
    deleteThreadBotBindingMutation,
    sendBotDeliveryTargetOutboundMessageMutation,
  }
}
