import type { CreateBotConnectionInput, UpdateBotConnectionInput } from '../features/bots/api'
import { formatLocalizedDateTime } from '../i18n/display'
import { i18n } from '../i18n/runtime'
import type { BotConnection, BotConversation, BotMessageMedia, WeChatAccount } from '../types/api'

export const WECHAT_CHANNEL_TIMING_SETTING = 'wechat_channel_timing'
export const WECHAT_CHANNEL_TIMING_ENABLED = 'enabled'
export const WECHAT_CHANNEL_TIMING_DISABLED = 'disabled'
export const BOT_COMMAND_OUTPUT_MODE_SETTING = 'command_output_mode'
export const BOT_COMMAND_OUTPUT_MODE_NONE = 'none'
export const BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE = 'single_line'
export const BOT_COMMAND_OUTPUT_MODE_BRIEF = 'brief'
export const BOT_COMMAND_OUTPUT_MODE_DETAILED = 'detailed'
export const BOT_COMMAND_OUTPUT_MODE_FULL = 'full'
export const FEISHU_DELIVERY_MODE_WEBSOCKET = 'websocket'
export const FEISHU_DELIVERY_MODE_WEBHOOK = 'webhook'

export type SupportedBotProvider = 'telegram' | 'wechat' | 'feishu' | 'qqbot'

export type BotOutboundMediaKind = 'image' | 'video' | 'voice' | 'file'
export type BotOutboundMediaSource = 'url' | 'path'
export type BotOutboundMediaDeliveryMode = 'none' | 'unsupported' | 'single' | 'group' | 'sequential'
export type BotOutboundMediaDeliveryReason =
  | 'no_media'
  | 'media_not_supported'
  | 'single_item'
  | 'group_supported'
  | 'group_not_supported_by_connection'
  | 'voice_not_groupable'
  | 'mixed_document_with_visual_media'

export type BotOutboundMediaDeliveryPlan = {
  mode: BotOutboundMediaDeliveryMode
  reason: BotOutboundMediaDeliveryReason
}

export type BotOutboundTextPlacement =
  | 'none'
  | 'text_only'
  | 'caption_single'
  | 'caption_group'
  | 'separate_before_media'

export type BotOutboundMediaLocationValidationIssue = '' | 'url_invalid' | 'path_must_be_absolute'
export type BotOutboundMediaAdvisory =
  | {
      code: 'kind_mismatch'
      source: 'location' | 'file_name' | 'content_type'
      detectedKind: BotOutboundMediaKind
    }
  | {
      code: 'metadata_mismatch'
      nameKind: BotOutboundMediaKind
      contentTypeKind: BotOutboundMediaKind
    }

export const BOT_OUTBOUND_MEDIA_KIND_ORDER: readonly BotOutboundMediaKind[] = ['image', 'video', 'voice', 'file']
export const BOT_OUTBOUND_MEDIA_SOURCE_ORDER: readonly BotOutboundMediaSource[] = ['url', 'path']

export type BotsPageDraft = {
  workspaceId: string
  provider: string
  name: string
  runtimeMode: string
  commandOutputMode: string
  telegramDeliveryMode: string
  feishuDeliveryMode: string
  publicBaseUrl: string
  wechatBaseUrl: string
  wechatRouteTag: string
  wechatChannelTimingEnabled: boolean
  wechatCredentialSource: string
  wechatSavedAccountId: string
  wechatLoginSessionId: string
  wechatLoginStatus: string
  wechatQrCodeContent: string
  feishuAppId: string
  feishuAppSecret: string
  feishuDomain: string
  feishuEnableCards: boolean
  feishuGroupReplyAll: boolean
  feishuThreadIsolation: boolean
  feishuShareSessionInChannel: boolean
  qqbotAppId: string
  qqbotAppSecret: string
  qqbotSandbox: boolean
  qqbotShareSessionInChannel: boolean
  qqbotMarkdownSupport: boolean
  qqbotIntents: string
  aiBackend: string
  telegramBotToken: string
  wechatBotToken: string
  wechatAccountId: string
  wechatUserId: string
  workspaceModel: string
  workspacePermissionPreset: string
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
  feishuDeliveryMode: 'websocket',
  publicBaseUrl: '',
  wechatBaseUrl: '',
  wechatRouteTag: '',
  wechatChannelTimingEnabled: false,
  wechatCredentialSource: 'manual',
  wechatSavedAccountId: '',
  wechatLoginSessionId: '',
  wechatLoginStatus: '',
  wechatQrCodeContent: '',
  feishuAppId: '',
  feishuAppSecret: '',
  feishuDomain: '',
  feishuEnableCards: false,
  feishuGroupReplyAll: false,
  feishuThreadIsolation: false,
  feishuShareSessionInChannel: false,
  qqbotAppId: '',
  qqbotAppSecret: '',
  qqbotSandbox: false,
  qqbotShareSessionInChannel: false,
  qqbotMarkdownSupport: false,
  qqbotIntents: '',
  aiBackend: 'workspace_thread',
  telegramBotToken: '',
  wechatBotToken: '',
  wechatAccountId: '',
  wechatUserId: '',
  workspaceModel: 'gpt-5.4',
  workspacePermissionPreset: 'default',
  workspaceReasoning: 'medium',
  workspaceCollaborationMode: 'default',
  openAIApiKey: '',
  openAIBaseUrl: '',
  openAIModel: 'gpt-5.4',
  openAIInstructions: '',
  openAIReasoning: 'medium',
  openAIStore: true,
}

function normalizeCapabilities(capabilities?: string[] | null) {
  return new Set((capabilities ?? []).map((capability) => capability.trim()).filter(Boolean))
}

export function resolveBotProvider(value?: string | null): SupportedBotProvider | '' {
  switch (value?.trim().toLowerCase()) {
    case 'telegram':
      return 'telegram'
    case 'wechat':
      return 'wechat'
    case 'feishu':
      return 'feishu'
    case 'qqbot':
      return 'qqbot'
    default:
      return ''
  }
}

export function resolveBotBooleanSetting(value?: string | null | undefined) {
  switch (value?.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
    case 'enabled':
      return true
    default:
      return false
  }
}

export function resolveFeishuDeliveryMode(value?: string | null) {
  return value?.trim().toLowerCase() === FEISHU_DELIVERY_MODE_WEBHOOK
    ? FEISHU_DELIVERY_MODE_WEBHOOK
    : FEISHU_DELIVERY_MODE_WEBSOCKET
}

function normalizeBotOutboundMediaKind(value?: string | null): BotOutboundMediaKind {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'voice':
      return 'voice'
    default:
      return 'file'
  }
}

export function listSupportedBotOutboundMediaKinds(capabilities?: string[] | null): BotOutboundMediaKind[] {
  const normalized = normalizeCapabilities(capabilities)
  if (!normalized.has('supportsMediaOutbound')) {
    return []
  }

  return BOT_OUTBOUND_MEDIA_KIND_ORDER.filter((kind) => isBotOutboundMediaKindSupported(capabilities, kind))
}

export function listSupportedBotOutboundMediaSources(capabilities?: string[] | null): BotOutboundMediaSource[] {
  const normalized = normalizeCapabilities(capabilities)
  if (!normalized.has('supportsMediaOutbound')) {
    return []
  }

  return BOT_OUTBOUND_MEDIA_SOURCE_ORDER.filter((source) => isBotOutboundMediaSourceSupported(capabilities, source))
}

export function isBotOutboundMediaKindSupported(
  capabilities: string[] | null | undefined,
  kind: BotOutboundMediaKind,
) {
  const normalized = normalizeCapabilities(capabilities)
  if (!normalized.has('supportsMediaOutbound')) {
    return false
  }

  switch (kind) {
    case 'image':
      return normalized.has('supportsImageOutbound')
    case 'video':
      return normalized.has('supportsVideoOutbound')
    case 'voice':
      return normalized.has('supportsVoiceOutbound')
    case 'file':
    default:
      return (
        normalized.has('supportsFileOutbound') ||
        (!normalized.has('supportsImageOutbound') &&
          !normalized.has('supportsVideoOutbound') &&
          !normalized.has('supportsVoiceOutbound'))
      )
  }
}

export function isBotOutboundMediaSourceSupported(
  capabilities: string[] | null | undefined,
  source: BotOutboundMediaSource,
) {
  const normalized = normalizeCapabilities(capabilities)
  if (!normalized.has('supportsMediaOutbound')) {
    return false
  }

  switch (source) {
    case 'path':
      return normalized.has('supportsLocalMediaPathSource')
    case 'url':
    default:
      return normalized.has('supportsRemoteMediaURLSource')
  }
}

export function planBotOutboundMediaDelivery(
  capabilities?: string[] | null,
  media?: BotMessageMedia[] | null,
): BotOutboundMediaDeliveryPlan {
  const items = media ?? []
  const normalized = normalizeCapabilities(capabilities)
  if (!items.length) {
    return { mode: 'none', reason: 'no_media' }
  }
  if (!normalized.has('supportsMediaOutbound')) {
    return { mode: 'unsupported', reason: 'media_not_supported' }
  }
  if (items.length === 1) {
    return { mode: 'single', reason: 'single_item' }
  }
  if (!normalized.has('supportsMediaGroup')) {
    return { mode: 'sequential', reason: 'group_not_supported_by_connection' }
  }

  const kinds = items.map((item) => normalizeBotOutboundMediaKind(item.kind))
  if (kinds.includes('voice')) {
    return { mode: 'sequential', reason: 'voice_not_groupable' }
  }

  const hasDocument = kinds.includes('file')
  const hasVisualMedia = kinds.includes('image') || kinds.includes('video')
  if (hasDocument && hasVisualMedia) {
    return { mode: 'sequential', reason: 'mixed_document_with_visual_media' }
  }

  return { mode: 'group', reason: 'group_supported' }
}

export function planBotOutboundTextPlacement(
  text?: string | null,
  media?: BotMessageMedia[] | null,
  mediaDeliveryPlan?: BotOutboundMediaDeliveryPlan | null,
): BotOutboundTextPlacement {
  const trimmedText = text?.trim() ?? ''
  const items = media ?? []
  if (!trimmedText) {
    return 'none'
  }
  if (!items.length) {
    return 'text_only'
  }

  const textLength = Array.from(text ?? '').length
  if (items.length === 1 && textLength <= 1024) {
    return 'caption_single'
  }
  if (items.length > 1 && mediaDeliveryPlan?.mode === 'group' && textLength <= 1024) {
    return 'caption_group'
  }
  return 'separate_before_media'
}

function isValidRemoteMediaURL(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isAbsoluteLocalMediaPath(value: string) {
  if (!value) {
    return false
  }
  if (/^file:\/\/.+/i.test(value)) {
    return true
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return true
  }
  if (/^\\\\[^\\]+\\[^\\]+/.test(value)) {
    return true
  }
  return value.startsWith('/')
}

export function validateBotOutboundMediaLocation(
  source: BotOutboundMediaSource,
  location?: string | null,
): BotOutboundMediaLocationValidationIssue {
  const trimmed = location?.trim() ?? ''
  if (!trimmed) {
    return ''
  }
  if (source === 'path') {
    return isAbsoluteLocalMediaPath(trimmed) ? '' : 'path_must_be_absolute'
  }
  return isValidRemoteMediaURL(trimmed) ? '' : 'url_invalid'
}

function extractPathLikeName(value?: string | null) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) {
    return ''
  }

  let candidate = trimmed
  try {
    if (/^(https?|file):\/\//i.test(trimmed)) {
      candidate = new URL(trimmed).pathname
    }
  } catch {
    candidate = trimmed
  }

  const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/, '')
  const name = normalized.split('/').pop() ?? normalized
  if (!name) {
    return ''
  }

  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function inferBotOutboundMediaKindFromPathLikeValue(value?: string | null): BotOutboundMediaKind | '' {
  const name = extractPathLikeName(value).toLowerCase()
  if (!name) {
    return ''
  }

  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  if (!extension) {
    return ''
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic', 'heif', 'avif'].includes(extension)) {
    return 'image'
  }
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpeg', 'mpg', '3gp'].includes(extension)) {
    return 'video'
  }
  if (['ogg', 'oga', 'opus', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'amr'].includes(extension)) {
    return 'voice'
  }
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'json', 'xml', 'zip', 'md', 'rtf'].includes(extension)) {
    return 'file'
  }
  return ''
}

function inferBotOutboundMediaKindFromContentType(value?: string | null): BotOutboundMediaKind | '' {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!normalized) {
    return ''
  }

  if (normalized.startsWith('image/')) {
    return 'image'
  }
  if (normalized.startsWith('video/')) {
    return 'video'
  }
  if (normalized.startsWith('audio/')) {
    return 'voice'
  }
  if (
    normalized.startsWith('text/') ||
    normalized === 'application/pdf' ||
    normalized === 'application/zip' ||
    normalized === 'application/json' ||
    normalized === 'application/xml' ||
    normalized.endsWith('+json') ||
    normalized.endsWith('+xml') ||
    normalized.includes('msword') ||
    normalized.includes('officedocument') ||
    normalized.includes('spreadsheet') ||
    normalized.includes('powerpoint')
  ) {
    return 'file'
  }
  return ''
}

export function collectBotOutboundMediaAdvisories(input: {
  kind: BotOutboundMediaKind
  location?: string | null
  fileName?: string | null
  contentType?: string | null
}): BotOutboundMediaAdvisory[] {
  const advisories: BotOutboundMediaAdvisory[] = []
  const locationKind = inferBotOutboundMediaKindFromPathLikeValue(input.location)
  const fileNameKind = inferBotOutboundMediaKindFromPathLikeValue(input.fileName)
  const contentTypeKind = inferBotOutboundMediaKindFromContentType(input.contentType)
  const effectiveNameKind = fileNameKind || locationKind

  const addKindMismatch = (
    source: Extract<BotOutboundMediaAdvisory, { code: 'kind_mismatch' }>['source'],
    detectedKind: BotOutboundMediaKind | '',
  ) => {
    if (!detectedKind || input.kind === 'file' || detectedKind === input.kind) {
      return
    }
    advisories.push({ code: 'kind_mismatch', source, detectedKind })
  }

  addKindMismatch('location', locationKind)
  if (fileNameKind && fileNameKind !== locationKind) {
    addKindMismatch('file_name', fileNameKind)
  }
  addKindMismatch('content_type', contentTypeKind)

  if (effectiveNameKind && contentTypeKind && effectiveNameKind !== contentTypeKind) {
    advisories.push({
      code: 'metadata_mismatch',
      nameKind: effectiveNameKind,
      contentTypeKind,
    })
  }

  return advisories
}

export function buildBotConnectionCreateInput(draft: BotsPageDraft): CreateBotConnectionInput {
  const aiConfig: Record<string, string> = {}
  const settings: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  const provider = resolveBotProvider(draft.provider) || 'telegram'
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
  } else if (provider === 'wechat') {
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
  } else if (provider === 'feishu') {
    if (draft.feishuAppId.trim()) {
      settings.feishu_app_id = draft.feishuAppId.trim()
    }
    settings.feishu_delivery_mode = resolveFeishuDeliveryMode(draft.feishuDeliveryMode)
    if (draft.feishuDomain.trim()) {
      settings.feishu_domain = draft.feishuDomain.trim()
    }
    settings.feishu_enable_cards = String(draft.feishuEnableCards)
    settings.feishu_group_reply_all = String(draft.feishuGroupReplyAll)
    settings.feishu_thread_isolation = String(draft.feishuThreadIsolation)
    settings.feishu_share_session_in_channel = String(draft.feishuShareSessionInChannel)
  } else if (provider === 'qqbot') {
    if (draft.qqbotAppId.trim()) {
      settings.qqbot_app_id = draft.qqbotAppId.trim()
    }
    settings.qqbot_sandbox = String(draft.qqbotSandbox)
    settings.qqbot_share_session_in_channel = String(draft.qqbotShareSessionInChannel)
    settings.qqbot_markdown_support = String(draft.qqbotMarkdownSupport)
    if (draft.qqbotIntents.trim()) {
      settings.qqbot_intents = draft.qqbotIntents.trim()
    }
  }
  settings.runtime_mode = draft.runtimeMode.trim().toLowerCase() === 'debug' ? 'debug' : 'normal'
  settings[BOT_COMMAND_OUTPUT_MODE_SETTING] = commandOutputMode

  if (draft.aiBackend === 'workspace_thread') {
    if (draft.workspaceModel.trim()) {
      aiConfig.model = draft.workspaceModel.trim()
    }
    if (draft.workspacePermissionPreset.trim()) {
      aiConfig.permission_preset = resolveBotWorkspacePermissionPreset(draft.workspacePermissionPreset)
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
  if (provider === 'feishu' && draft.feishuAppSecret.trim()) {
    secrets.feishu_app_secret = draft.feishuAppSecret.trim()
  }
  if (provider === 'qqbot' && draft.qqbotAppSecret.trim()) {
    secrets.qqbot_app_secret = draft.qqbotAppSecret.trim()
  }

  return {
    provider,
    name: draft.name.trim(),
    publicBaseUrl:
      ((provider === 'telegram' && (draft.telegramDeliveryMode.trim() || 'webhook') === 'webhook') ||
        (provider === 'feishu' && resolveFeishuDeliveryMode(draft.feishuDeliveryMode) === FEISHU_DELIVERY_MODE_WEBHOOK))
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
  const provider = resolveBotProvider(connection.provider) || 'telegram'
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
    feishuDeliveryMode:
      provider === 'feishu'
        ? resolveFeishuDeliveryMode(connection.settings?.feishu_delivery_mode)
        : FEISHU_DELIVERY_MODE_WEBSOCKET,
    publicBaseUrl: resolveBotConnectionPublicBaseUrl(connection),
    wechatBaseUrl: provider === 'wechat' ? connection.settings?.wechat_base_url?.trim() ?? '' : '',
    wechatRouteTag: provider === 'wechat' ? connection.settings?.wechat_route_tag?.trim() ?? '' : '',
    wechatChannelTimingEnabled:
      provider === 'wechat' ? resolveWeChatChannelTimingEnabled(connection.settings, runtimeMode) : false,
    wechatCredentialSource: provider === 'wechat' ? (linkedWeChatAccount ? 'saved' : 'manual') : 'manual',
    wechatSavedAccountId: linkedWeChatAccount?.id ?? '',
    feishuAppId: provider === 'feishu' ? connection.settings?.feishu_app_id?.trim() ?? '' : '',
    feishuAppSecret: '',
    feishuDomain: provider === 'feishu' ? connection.settings?.feishu_domain?.trim() ?? '' : '',
    feishuEnableCards: provider === 'feishu' ? resolveBotBooleanSetting(connection.settings?.feishu_enable_cards) : false,
    feishuGroupReplyAll: provider === 'feishu' ? resolveBotBooleanSetting(connection.settings?.feishu_group_reply_all) : false,
    feishuThreadIsolation:
      provider === 'feishu' ? resolveBotBooleanSetting(connection.settings?.feishu_thread_isolation) : false,
    feishuShareSessionInChannel:
      provider === 'feishu'
        ? resolveBotBooleanSetting(connection.settings?.feishu_share_session_in_channel)
        : false,
    qqbotAppId: provider === 'qqbot' ? connection.settings?.qqbot_app_id?.trim() ?? '' : '',
    qqbotAppSecret: '',
    qqbotSandbox: provider === 'qqbot' ? resolveBotBooleanSetting(connection.settings?.qqbot_sandbox) : false,
    qqbotShareSessionInChannel:
      provider === 'qqbot'
        ? resolveBotBooleanSetting(connection.settings?.qqbot_share_session_in_channel)
        : false,
    qqbotMarkdownSupport:
      provider === 'qqbot' ? resolveBotBooleanSetting(connection.settings?.qqbot_markdown_support) : false,
    qqbotIntents: provider === 'qqbot' ? connection.settings?.qqbot_intents?.trim() ?? '' : '',
    aiBackend,
    telegramBotToken: '',
    wechatBotToken: '',
    wechatAccountId: provider === 'wechat' ? connection.settings?.wechat_account_id?.trim() ?? '' : '',
    wechatUserId: provider === 'wechat' ? connection.settings?.wechat_owner_user_id?.trim() ?? '' : '',
    workspaceModel:
      aiBackend === 'workspace_thread'
        ? connection.aiConfig?.model?.trim() || EMPTY_BOTS_PAGE_DRAFT.workspaceModel
        : EMPTY_BOTS_PAGE_DRAFT.workspaceModel,
    workspacePermissionPreset:
      aiBackend === 'workspace_thread'
        ? resolveBotWorkspacePermissionPreset(connection.aiConfig?.permission_preset)
        : EMPTY_BOTS_PAGE_DRAFT.workspacePermissionPreset,
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

function resolveBotWorkspacePermissionPreset(value: string | null | undefined) {
  return value?.trim().toLowerCase() === 'full-access' ? 'full-access' : 'default'
}

export function isBotWorkspacePermissionPresetFullAccess(value: string | null | undefined) {
  return resolveBotWorkspacePermissionPreset(value) === 'full-access'
}

export function formatBotProviderLabel(provider: string) {
  const normalizedProvider = provider.trim().toLowerCase()
  switch (normalizedProvider) {
    case 'telegram':
      return i18n._({ id: 'Telegram', message: 'Telegram' })
    case 'wechat':
      return i18n._({ id: 'WeChat', message: 'WeChat' })
    case 'feishu':
      return i18n._({ id: 'Feishu', message: 'Feishu' })
    case 'qqbot':
      return i18n._({ id: 'QQ Bot', message: 'QQ Bot' })
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

export function formatBotWorkspacePermissionPresetLabel(value: string | null | undefined) {
  return isBotWorkspacePermissionPresetFullAccess(value)
    ? i18n._({ id: 'Full access', message: 'Full access' })
    : i18n._({ id: 'Default permission', message: 'Default permission' })
}

export function resolveBotCommandOutputMode(value: string | null | undefined) {
  switch (value?.trim().toLowerCase()) {
    case BOT_COMMAND_OUTPUT_MODE_NONE:
      return BOT_COMMAND_OUTPUT_MODE_NONE
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
    case BOT_COMMAND_OUTPUT_MODE_NONE:
      return i18n._({ id: 'No Command Output', message: 'No Command Output' })
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

  return formatLocalizedDateTime(value)
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
    return i18n._({
      id: '{baseTitle} (topic {externalThreadId})',
      message: '{baseTitle} (topic {externalThreadId})',
      values: { baseTitle, externalThreadId: conversation.externalThreadId },
    })
  }

  return baseTitle
}

export function resolveBotConversationBindingMode(
  conversation: Pick<BotConversation, 'resolvedBindingMode' | 'threadId'>,
) {
  const resolvedMode = conversation.resolvedBindingMode?.trim().toLowerCase() ?? ''
  switch (resolvedMode) {
    case 'fixed_thread':
      return 'fixed_thread'
    case 'workspace_auto_thread':
      return 'workspace_auto_thread'
    case 'stateless':
      return 'stateless'
    default:
      return conversation.threadId?.trim() ? 'fixed_thread' : ''
  }
}

export function formatBotConversationBindingModeLabel(
  conversation: Pick<BotConversation, 'resolvedBindingMode' | 'threadId'>,
) {
  switch (resolveBotConversationBindingMode(conversation)) {
    case 'fixed_thread':
      return i18n._({ id: 'Fixed Thread', message: 'Fixed Thread' })
    case 'workspace_auto_thread':
      return i18n._({ id: 'Workspace Auto Thread', message: 'Workspace Auto Thread' })
    case 'stateless':
      return i18n._({ id: 'Stateless', message: 'Stateless' })
    default:
      return i18n._({ id: 'Not bound', message: 'Not bound' })
  }
}

export function formatBotConversationBindingSourceLabel(
  conversation: Pick<BotConversation, 'bindingId' | 'resolvedBindingId' | 'threadId'>,
) {
  if (conversation.bindingId?.trim()) {
    return i18n._({ id: 'Conversation Override', message: 'Conversation Override' })
  }
  if (conversation.resolvedBindingId?.trim()) {
    return i18n._({ id: 'Bot Default', message: 'Bot Default' })
  }
  if (conversation.threadId?.trim()) {
    return i18n._({ id: 'Legacy Binding', message: 'Legacy Binding' })
  }
  return i18n._({ id: 'Not bound', message: 'Not bound' })
}

export function resolveBotConversationThreadTarget(
  conversation: Pick<
    BotConversation,
    'workspaceId' | 'threadId' | 'resolvedTargetWorkspaceId' | 'resolvedTargetThreadId'
  >,
) {
  const threadId = conversation.resolvedTargetThreadId?.trim() || conversation.threadId?.trim() || ''
  const workspaceId = conversation.resolvedTargetWorkspaceId?.trim() || conversation.workspaceId.trim()
  return {
    workspaceId,
    threadId,
  }
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
