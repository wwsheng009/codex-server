import type { CreateBotConnectionInput } from '../features/bots/api'
import { i18n } from '../i18n/runtime'
import type { BotConversation } from '../types/api'

export type BotsPageDraft = {
  workspaceId: string
  provider: string
  name: string
  telegramDeliveryMode: string
  publicBaseUrl: string
  aiBackend: string
  telegramBotToken: string
  workspaceModel: string
  workspaceReasoning: string
  workspaceCollaborationMode: string
  openAIApiKey: string
  openAIBaseUrl: string
  openAIModel: string
  openAIInstructions: string
  openAIReasoning: string
  openAIStore: boolean
}

export const EMPTY_BOTS_PAGE_DRAFT: BotsPageDraft = {
  workspaceId: '',
  provider: 'telegram',
  name: '',
  telegramDeliveryMode: 'webhook',
  publicBaseUrl: '',
  aiBackend: 'workspace_thread',
  telegramBotToken: '',
  workspaceModel: 'gpt-5.4',
  workspaceReasoning: 'medium',
  workspaceCollaborationMode: 'default',
  openAIApiKey: '',
  openAIBaseUrl: '',
  openAIModel: 'gpt-5.4',
  openAIInstructions: '',
  openAIReasoning: 'medium',
  openAIStore: true,
}

export function buildBotConnectionCreateInput(draft: BotsPageDraft): CreateBotConnectionInput {
  const aiConfig: Record<string, string> = {}
  const settings: Record<string, string> = {}
  const secrets: Record<string, string> = {}

  if (draft.provider === 'telegram') {
    settings.telegram_delivery_mode = draft.telegramDeliveryMode.trim() || 'webhook'
  }

  if (draft.aiBackend === 'workspace_thread') {
    if (draft.workspaceModel.trim()) {
      aiConfig.model = draft.workspaceModel.trim()
    }
    if (draft.workspaceReasoning.trim()) {
      aiConfig.reasoning_effort = draft.workspaceReasoning.trim()
    }
    if (draft.workspaceCollaborationMode.trim()) {
      aiConfig.collaboration_mode = draft.workspaceCollaborationMode.trim()
    }
  } else {
    if (draft.openAIModel.trim()) {
      aiConfig.model = draft.openAIModel.trim()
    }
    if (draft.openAIInstructions.trim()) {
      aiConfig.instructions = draft.openAIInstructions.trim()
    }
    if (draft.openAIReasoning.trim()) {
      aiConfig.reasoning_effort = draft.openAIReasoning.trim()
    }
    aiConfig.store = String(draft.openAIStore)

    if (draft.openAIBaseUrl.trim()) {
      settings.openai_base_url = draft.openAIBaseUrl.trim()
    }
    if (draft.openAIApiKey.trim()) {
      secrets.openai_api_key = draft.openAIApiKey.trim()
    }
  }

  if (draft.telegramBotToken.trim()) {
    secrets.bot_token = draft.telegramBotToken.trim()
  }

  return {
    provider: draft.provider,
    name: draft.name.trim(),
    publicBaseUrl:
      draft.provider === 'telegram' && (draft.telegramDeliveryMode.trim() || 'webhook') === 'webhook'
        ? draft.publicBaseUrl.trim() || undefined
        : undefined,
    aiBackend: draft.aiBackend,
    aiConfig: Object.keys(aiConfig).length ? aiConfig : undefined,
    settings: Object.keys(settings).length ? settings : undefined,
    secrets: Object.keys(secrets).length ? secrets : undefined,
  }
}

export function formatBotProviderLabel(provider: string) {
  switch (provider.trim().toLowerCase()) {
    case 'telegram':
      return i18n._({ id: 'Telegram', message: 'Telegram' })
    case 'discord':
      return i18n._({ id: 'Discord', message: 'Discord' })
    default:
      return provider
  }
}

export function formatBotBackendLabel(backend: string) {
  switch (backend.trim().toLowerCase()) {
    case 'workspace_thread':
      return i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })
    case 'openai_responses':
      return i18n._({ id: 'OpenAI Responses', message: 'OpenAI Responses' })
    default:
      return backend
  }
}

export function formatBotTimestamp(value: string | undefined) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

export function summarizeBotMap(value: Record<string, string> | null | undefined) {
  if (!value || !Object.keys(value).length) {
    return i18n._({ id: 'none', message: 'none' })
  }

  return Object.entries(value)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, mapValue]) => `${key}=${mapValue}`)
    .join(', ')
}

export function formatBotConversationTitle(conversation: BotConversation) {
  const baseTitle =
    conversation.externalTitle ||
    conversation.externalUsername ||
    conversation.externalUserId ||
    conversation.externalChatId

  if (conversation.externalThreadId) {
    return `${baseTitle} (topic ${conversation.externalThreadId})`
  }

  return baseTitle
}
