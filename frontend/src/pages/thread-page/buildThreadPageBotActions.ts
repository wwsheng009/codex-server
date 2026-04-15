import type { FormEvent } from 'react'

import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'
import type { Bot } from '../../types/api'

type ThreadPageBotSendMutationInput = {
  botWorkspaceId: string
  botId: string
  deliveryTargetId: string
  text: string
  threadId: string
  threadWorkspaceId: string
}

type ThreadPageBotSendMutation = {
  isPending: boolean
  mutate: (
    input: ThreadPageBotSendMutationInput,
    options?: {
      onError?: (error: unknown) => void
    },
  ) => void
}

type ThreadPageBotActionsInput = {
  botSendBots: Bot[]
  botSendSelectedBotId: string
  botSendSelectedDeliveryTargetId: string
  botSendText: string
  bindThreadBotChannelMutation: {
    isPending: boolean
    mutate: (
      input: {
        botWorkspaceId: string
        botId: string
        deliveryTargetId: string
        threadId: string
      },
      options?: {
        onError?: (error: unknown) => void
      },
    ) => void
  }
  deleteThreadBotBindingMutation: {
    isPending: boolean
    mutate: (
      input: {
        threadId: string
      },
      options?: {
        onError?: (error: unknown) => void
      },
    ) => void
  }
  selectedThread?: {
    id: string
    workspaceId: string
  }
  sendBotDeliveryTargetOutboundMessageMutation: ThreadPageBotSendMutation
  setBotSendError: (value: string | null) => void
}

export function buildThreadPageBotActions({
  botSendBots,
  botSendSelectedBotId,
  botSendSelectedDeliveryTargetId,
  botSendText,
  bindThreadBotChannelMutation,
  deleteThreadBotBindingMutation,
  selectedThread,
  sendBotDeliveryTargetOutboundMessageMutation,
  setBotSendError,
}: ThreadPageBotActionsInput) {
  const selectedBot = botSendBots.find((bot) => bot.id === botSendSelectedBotId.trim())
  const selectedBotWorkspaceId = selectedBot?.workspaceId?.trim() ?? ''

  function handleSendBotMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (
      !selectedThread ||
      sendBotDeliveryTargetOutboundMessageMutation.isPending ||
      !selectedBotWorkspaceId ||
      !botSendSelectedBotId.trim() ||
      !botSendSelectedDeliveryTargetId.trim() ||
      !botSendText.trim()
    ) {
      return
    }

    setBotSendError(null)
    sendBotDeliveryTargetOutboundMessageMutation.mutate(
      {
        botWorkspaceId: selectedBotWorkspaceId,
        botId: botSendSelectedBotId.trim(),
        deliveryTargetId: botSendSelectedDeliveryTargetId.trim(),
        text: botSendText.trim(),
        threadId: selectedThread.id,
        threadWorkspaceId: selectedThread.workspaceId,
      },
      {
        onError: (error) => {
          setBotSendError(getErrorMessage(error, i18n._({ id: 'Failed to send message to bot.', message: 'Failed to send message to bot.' })))
        },
      },
    )
  }

  function handleBindThreadBotChannel() {
    if (
      !selectedThread ||
      bindThreadBotChannelMutation.isPending ||
      !selectedBotWorkspaceId ||
      !botSendSelectedBotId.trim() ||
      !botSendSelectedDeliveryTargetId.trim()
    ) {
      return
    }

    setBotSendError(null)
    bindThreadBotChannelMutation.mutate(
      {
        botWorkspaceId: selectedBotWorkspaceId,
        botId: botSendSelectedBotId.trim(),
        deliveryTargetId: botSendSelectedDeliveryTargetId.trim(),
        threadId: selectedThread.id,
      },
      {
        onError: (error) => {
          setBotSendError(getErrorMessage(error, i18n._({ id: 'Failed to bind bot channel to thread.', message: 'Failed to bind bot channel to thread.' })))
        },
      },
    )
  }

  function handleDeleteThreadBotBinding() {
    if (!selectedThread || deleteThreadBotBindingMutation.isPending) {
      return
    }

    setBotSendError(null)
    deleteThreadBotBindingMutation.mutate(
      {
        threadId: selectedThread.id,
      },
      {
        onError: (error) => {
          setBotSendError(getErrorMessage(error, i18n._({ id: 'Failed to remove bot channel binding.', message: 'Failed to remove bot channel binding.' })))
        },
      },
    )
  }

  return {
    handleBindThreadBotChannel,
    handleDeleteThreadBotBinding,
    handleSendBotMessage,
  }
}
