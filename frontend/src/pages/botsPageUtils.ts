import type { CreateBotConnectionInput, UpdateBotConnectionInput } from '../features/bots/api'
import { i18n } from '../i18n/runtime'
import type { BotConnection, BotConversation, WeChatAccount } from '../types/api'

export const WECHAT_CHANNEL_TIMING_SETTING = 'wechat_channel_timing'
export const WECHAT_CHANNEL_TIMING_ENABLED = 'enabled'
export const WECHAT_CHANNEL_TIMING_DISABLED = 'disabled'
export const BOT_COMMAND_OUTPUT_MODE_SETTING = 'command_output_mode'
export const BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE = 'single_line'
export const BOT_COMMAND_OUTPUT_MODE_BRIEF = 'brief'
export const BOT_COMMAND_OUTPUT_MODE_DETAILED = 'detailed'
export const BOT_COMMAND_OUTPUT_MODE_FULL = 'full'

export type BotsPageDraft = {
  workspaceId: string
  provider: string
  name: string
  runtimeMode: string
  commandOutputMode: string
  telegramDeliveryMode: string
  publicBaseUrl: string
  wechatBaseUrl: string
  wechatRouteTag: string
  wechatChannelTimingEnabled: boolean
  wechatCredentialSource: string
  wechatSavedAccountId: string
  wechatLoginSessionId: string
  wechatLoginStatus: string
  wechatQrCodeContent: string
  aiBackend: string
  telegramBotToken: string
  wechatBotToken: string
  wechatAccountId: string
  wechatUserId: string
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
  runtimeMode: 'normal',
  commandOutputMode: BOT_COMMAND_OUTPUT_MODE_BRIEF,
  telegramDeliveryMode: 'webhook',
  publicBaseUrl: '',
  wechatBaseUrl: '',
  wechatRouteTag: '',
  wechatChannelTimingEnabled: false,
  wechatCredentialSource: 'manual',
  wechatSavedAccountId: '',
  wechatLoginSessionId: '',
  wechatLoginStatus: '',
  wechatQrCodeContent: '',
  aiBackend: 'workspace_thread',
  telegramBotToken: '',
  wechatBotToken: '',
  wechatAccountId: '',
  wechatUserId: '',
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
  const provider = draft.provider.trim().toLowerCase() === 'wechat' ? 'wechat' : 'telegram'
  const commandOutputMode = resolveBotCommandOutputMode(draft.commandOutputMode)
  const useConfirmedWeChatLoginSession =
    provider === 'wechat' &&
    draft.wechatCredentialSource.trim().toLowerCase() === 'qr' &&
    draft.wechatLoginSessionId.trim().length > 0 &&
    draft.wechatLoginStatus.trim().toLowerCase() === 'confirmed'
  const useSavedWeChatAccount =
    provider === 'wechat' &&
    draft.wechatCredentialSource.trim().toLowerCase() === 'saved' &&
    draft.wechatSavedAccountId.trim().length > 0
  const useInlineWeChatCredentials = provider === 'wechat' && !useConfirmedWeChatLoginSession && !useSavedWeChatAccount

  if (provider === 'telegram') {
    settings.telegram_delivery_mode = draft.telegramDeliveryMode.trim() || 'webhook'
  } else {
    settings.wechat_delivery_mode = 'polling'
    if (draft.wechatBaseUrl.trim()) {
      settings.wechat_base_url = draft.wechatBaseUrl.trim()
    }
    if (draft.wechatRouteTag.trim()) {
      settings.wechat_route_tag = draft.wechatRouteTag.trim()
    }
    settings[WECHAT_CHANNEL_TIMING_SETTING] = draft.wechatChannelTimingEnabled
      ? WECHAT_CHANNEL_TIMING_ENABLED
      : WECHAT_CHANNEL_TIMING_DISABLED
    if (useSavedWeChatAccount) {
      settings.wechat_saved_account_id = draft.wechatSavedAccountId.trim()
    }
    if (useConfirmedWeChatLoginSession) {
      settings.wechat_login_session_id = draft.wechatLoginSessionId.trim()
    }
    if (useInlineWeChatCredentials && draft.wechatAccountId.trim()) {
      settings.wechat_account_id = draft.wechatAccountId.trim()
    }
    if (useInlineWeChatCredentials && draft.wechatUserId.trim()) {
      settings.wechat_owner_user_id = draft.wechatUserId.trim()
    }
  }
  settings.runtime_mode = draft.runtimeMode.trim().toLowerCase() === 'debug' ? 'debug' : 'normal'
  settings[BOT_COMMAND_OUTPUT_MODE_SETTING] = commandOutputMode

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

  if (provider === 'telegram' && draft.telegramBotToken.trim()) {
    secrets.bot_token = draft.telegramBotToken.trim()
  }
  if (useInlineWeChatCredentials && draft.wechatBotToken.trim()) {
    secrets.bot_token = draft.wechatBotToken.trim()
  }

  return {
    provider,
    name: draft.name.trim(),
    publicBaseUrl:
      provider === 'telegram' && (draft.telegramDeliveryMode.trim() || 'webhook') === 'webhook'
        ? draft.publicBaseUrl.trim() || undefined
        : undefined,
    aiBackend: draft.aiBackend,
    aiConfig: Object.keys(aiConfig).length ? aiConfig : undefined,
    settings: Object.keys(settings).length ? settings : undefined,
    secrets: Object.keys(secrets).length ? secrets : undefined,
  }
}

export function buildBotConnectionUpdateInput(draft: BotsPageDraft): UpdateBotConnectionInput {
  return buildBotConnectionCreateInput(draft)
}

export function buildBotsPageDraftFromConnection(
  connection: BotConnection,
  savedWeChatAccounts: WeChatAccount[] = [],
): BotsPageDraft {
  const provider = connection.provider.trim().toLowerCase() === 'wechat' ? 'wechat' : 'telegram'
  const runtimeMode = connection.settings?.runtime_mode?.trim().toLowerCase() === 'debug' ? 'debug' : 'normal'
  const aiBackend = connection.aiBackend.trim().toLowerCase() === 'openai_responses' ? 'openai_responses' : 'workspace_thread'
  const linkedWeChatAccount =
    provider === 'wechat'
      ? savedWeChatAccounts.find((account) => isWeChatConnectionForAccount(connection, account)) ?? null
      : null

  return {
    ...EMPTY_BOTS_PAGE_DRAFT,
    workspaceId: connection.workspaceId,
    provider,
    name: connection.name,
    runtimeMode,
    commandOutputMode: resolveBotCommandOutputMode(connection.settings?.[BOT_COMMAND_OUTPUT_MODE_SETTING]),
    telegramDeliveryMode:
      provider === 'telegram' && connection.settings?.telegram_delivery_mode?.trim().toLowerCase() === 'polling'
        ? 'polling'
        : 'webhook',
    publicBaseUrl: resolveBotConnectionPublicBaseUrl(connection),
    wechatBaseUrl: provider === 'wechat' ? connection.settings?.wechat_base_url?.trim() ?? '' : '',
    wechatRouteTag: provider === 'wechat' ? connection.settings?.wechat_route_tag?.trim() ?? '' : '',
    wechatChannelTimingEnabled:
      provider === 'wechat' ? resolveWeChatChannelTimingEnabled(connection.settings, runtimeMode) : false,
    wechatCredentialSource: provider === 'wechat' ? (linkedWeChatAccount ? 'saved' : 'manual') : 'manual',
    wechatSavedAccountId: linkedWeChatAccount?.id ?? '',
    aiBackend,
    telegramBotToken: '',
    wechatBotToken: '',
    wechatAccountId: provider === 'wechat' ? connection.settings?.wechat_account_id?.trim() ?? '' : '',
    wechatUserId: provider === 'wechat' ? connection.settings?.wechat_owner_user_id?.trim() ?? '' : '',
    workspaceModel:
      aiBackend === 'workspace_thread'
        ? connection.aiConfig?.model?.trim() || EMPTY_BOTS_PAGE_DRAFT.workspaceModel
        : EMPTY_BOTS_PAGE_DRAFT.workspaceModel,
    workspaceReasoning:
      aiBackend === 'workspace_thread'
        ? connection.aiConfig?.reasoning_effort?.trim() || EMPTY_BOTS_PAGE_DRAFT.workspaceReasoning
        : EMPTY_BOTS_PAGE_DRAFT.workspaceReasoning,
    workspaceCollaborationMode:
      aiBackend === 'workspace_thread'
        ? connection.aiConfig?.collaboration_mode?.trim() || EMPTY_BOTS_PAGE_DRAFT.workspaceCollaborationMode
        : EMPTY_BOTS_PAGE_DRAFT.workspaceCollaborationMode,
    openAIBaseUrl: aiBackend === 'openai_responses' ? connection.settings?.openai_base_url?.trim() ?? '' : '',
    openAIModel:
      aiBackend === 'openai_responses'
        ? connection.aiConfig?.model?.trim() || EMPTY_BOTS_PAGE_DRAFT.openAIModel
        : EMPTY_BOTS_PAGE_DRAFT.openAIModel,
    openAIInstructions: aiBackend === 'openai_responses' ? connection.aiConfig?.instructions?.trim() ?? '' : '',
    openAIReasoning:
      aiBackend === 'openai_responses'
        ? connection.aiConfig?.reasoning_effort?.trim() || EMPTY_BOTS_PAGE_DRAFT.openAIReasoning
        : EMPTY_BOTS_PAGE_DRAFT.openAIReasoning,
    openAIStore: resolveBotConnectionOpenAIStore(connection.aiConfig?.store),
  }
}

export function resolveBotConnectionPublicBaseUrl(connection: Pick<BotConnection, 'id' | 'provider' | 'settings'>) {
  if (connection.provider.trim().toLowerCase() !== 'telegram') {
    return ''
  }

  const webhookUrl = connection.settings?.webhook_url?.trim() ?? ''
  const suffix = `/hooks/bots/${connection.id}`
  if (!webhookUrl || !webhookUrl.endsWith(suffix)) {
    return ''
  }

  return webhookUrl.slice(0, webhookUrl.length - suffix.length)
}

function resolveBotConnectionOpenAIStore(value: string | null | undefined) {
  return value?.trim().toLowerCase() !== 'false'
}

export function formatBotProviderLabel(provider: string) {
  switch (provider.trim().toLowerCase()) {
    case 'telegram':
      return i18n._({ id: 'Telegram', message: 'Telegram' })
    case 'wechat':
      return i18n._({ id: 'WeChat', message: 'WeChat' })
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

export function resolveBotCommandOutputMode(value: string | null | undefined) {
  switch (value?.trim().toLowerCase()) {
    case BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE:
      return BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE
    case BOT_COMMAND_OUTPUT_MODE_DETAILED:
      return BOT_COMMAND_OUTPUT_MODE_DETAILED
    case BOT_COMMAND_OUTPUT_MODE_FULL:
      return BOT_COMMAND_OUTPUT_MODE_FULL
    case BOT_COMMAND_OUTPUT_MODE_BRIEF:
    default:
      return BOT_COMMAND_OUTPUT_MODE_BRIEF
  }
}

export function formatBotCommandOutputModeLabel(value: string) {
  switch (resolveBotCommandOutputMode(value)) {
    case BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE:
      return i18n._({ id: 'Single Line', message: 'Single Line' })
    case BOT_COMMAND_OUTPUT_MODE_DETAILED:
      return i18n._({ id: 'Detailed', message: 'Detailed' })
    case BOT_COMMAND_OUTPUT_MODE_FULL:
      return i18n._({ id: 'Full Output', message: 'Full Output' })
    default:
      return i18n._({ id: 'Brief (3-5 lines)', message: 'Brief (3-5 lines)' })
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

  if (conversation.provider.trim().toLowerCase() === 'telegram' && conversation.externalThreadId) {
    return `${baseTitle} (topic ${conversation.externalThreadId})`
  }

  return baseTitle
}

export function formatWeChatAccountLabel(account: Pick<WeChatAccount, 'alias' | 'accountId' | 'userId'>) {
  const alias = account.alias?.trim() ?? ''
  const identity = `${account.accountId.trim()} · ${account.userId.trim()}`
  if (alias === '') {
    return identity
  }
  return `${alias} · ${identity}`
}

export function matchesWeChatAccountSearch(
  account: Pick<WeChatAccount, 'alias' | 'note' | 'baseUrl' | 'accountId' | 'userId'>,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') {
    return true
  }

  return [
    account.alias ?? '',
    account.note ?? '',
    account.baseUrl,
    account.accountId,
    account.userId,
  ].some((value) => value.trim().toLowerCase().includes(normalizedQuery))
}

export function findWeChatAccountForConnection(
  accounts: WeChatAccount[],
  connection: Pick<BotConnection, 'provider' | 'settings'> | null | undefined,
) {
  return accounts.find((account) => isWeChatConnectionForAccount(connection, account)) ?? null
}

export function matchesBotConnectionSearch(
  connection: Pick<BotConnection, 'name' | 'provider' | 'status' | 'aiBackend'>,
  query: string,
  linkedWeChatAccount?: Pick<WeChatAccount, 'alias' | 'note' | 'accountId' | 'userId'> | null,
) {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') {
    return true
  }

  return [
    connection.name,
    connection.provider,
    connection.status,
    connection.aiBackend,
    linkedWeChatAccount?.alias ?? '',
    linkedWeChatAccount?.note ?? '',
    linkedWeChatAccount?.accountId ?? '',
    linkedWeChatAccount?.userId ?? '',
  ].some((value) => value.trim().toLowerCase().includes(normalizedQuery))
}

export function isWeChatConnectionForAccount(
  connection: Pick<BotConnection, 'provider' | 'settings'> | null | undefined,
  account: Pick<WeChatAccount, 'baseUrl' | 'accountId' | 'userId'> | null | undefined,
) {
  if (!connection || !account || connection.provider.trim().toLowerCase() !== 'wechat') {
    return false
  }

  const connectionAccountId = connection.settings?.wechat_account_id?.trim() ?? ''
  const connectionUserId = connection.settings?.wechat_owner_user_id?.trim() ?? ''
  if (connectionAccountId === '' || connectionUserId === '') {
    return false
  }

  const accountId = account.accountId.trim()
  const userId = account.userId.trim()
  if (connectionAccountId !== accountId || connectionUserId !== userId) {
    return false
  }

  const connectionBaseUrl = connection.settings?.wechat_base_url?.trim() ?? ''
  const accountBaseUrl = account.baseUrl.trim()
  if (connectionBaseUrl !== '' && accountBaseUrl !== '' && connectionBaseUrl !== accountBaseUrl) {
    return false
  }

  return true
}

export function listWeChatConnectionsForAccount(connections: BotConnection[], account: WeChatAccount) {
  return connections.filter((connection) => isWeChatConnectionForAccount(connection, account))
}

export function countWeChatConnectionsForAccount(connections: BotConnection[], account: WeChatAccount) {
  return listWeChatConnectionsForAccount(connections, account).length
}

export function resolveWeChatChannelTimingEnabled(
  settings: Record<string, string> | null | undefined,
  runtimeMode: string,
) {
  const configured = settings?.[WECHAT_CHANNEL_TIMING_SETTING]?.trim().toLowerCase()
  if (configured === WECHAT_CHANNEL_TIMING_ENABLED) {
    return true
  }
  if (configured === WECHAT_CHANNEL_TIMING_DISABLED) {
    return false
  }
  return runtimeMode.trim().toLowerCase() === 'debug'
}
