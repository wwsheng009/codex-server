import { apiRequest } from '../../lib/api-client'
import type {
  Bot,
  BotBinding,
  BotConnection,
  BotConnectionLogEntry,
  BotConversation,
  BotRecipientCandidate,
  BotDeliveryTarget,
  BotOutboundDelivery,
  BotReplyMessage,
  ThreadBotBinding,
  BotTrigger,
  WeChatAccount,
  WeChatLogin,
} from '../../types/api'

export type CreateBotInput = {
  name?: string
  description?: string
  scope?: string
  sharingMode?: string
  sharedWorkspaceIds?: string[]
}

export type UpdateBotInput = {
  name?: string
  description?: string
  scope?: string
  sharingMode?: string
  sharedWorkspaceIds?: string[]
}

export type CreateBotConnectionInput = {
  provider: string
  name: string
  publicBaseUrl?: string
  aiBackend: string
  aiConfig?: Record<string, string>
  settings?: Record<string, string>
  secrets?: Record<string, string>
}

export type UpdateBotConnectionInput = {
  provider: string
  name: string
  publicBaseUrl?: string
  aiBackend: string
  aiConfig?: Record<string, string>
  settings?: Record<string, string>
  secrets?: Record<string, string>
}

export type ResumeBotConnectionInput = {
  publicBaseUrl?: string
}

export type UpdateBotConnectionRuntimeModeInput = {
  runtimeMode: string
}

export type UpdateBotConnectionCommandOutputModeInput = {
  commandOutputMode: string
}

export type UpdateWeChatChannelTimingInput = {
  enabled: boolean
}

export type UpdateBotConversationBindingInput = {
  threadId?: string
  createThread?: boolean
  title?: string
  targetWorkspaceId?: string
}

export type UpdateBotDefaultBindingInput = {
  bindingMode: string
  targetWorkspaceId?: string
  targetThreadId?: string
  name?: string
}

export type UpsertBotDeliveryTargetInput = {
  endpointId?: string
  sessionId?: string
  targetType: string
  routeType?: string
  routeKey?: string
  title?: string
  labels?: string[]
  capabilities?: string[]
  providerState?: Record<string, string>
  status?: string
}

export type UpsertBotTriggerInput = {
  type?: string
  deliveryTargetId?: string
  filter?: Record<string, string>
  enabled?: boolean
}

export type SendBotOutboundMessagesInput = {
  sessionId?: string
  deliveryTargetId?: string
  sourceType: string
  sourceRefType?: string
  sourceRefId?: string
  originWorkspaceId?: string
  originThreadId?: string
  originTurnId?: string
  idempotencyKey?: string
  messages: BotReplyMessage[]
}

export type UpsertThreadBotBindingInput = {
  botWorkspaceId?: string
  botId: string
  deliveryTargetId: string
}

export type UpdateWeChatAccountInput = {
  alias: string
  note: string
}

export type StartWeChatLoginInput = {
  baseUrl: string
}

export function listBotConnections(workspaceId: string) {
  return apiRequest<BotConnection[]>(`/api/workspaces/${workspaceId}/bot-connections`)
}

export function listAllBotConnections() {
  return apiRequest<BotConnection[]>('/api/bot-connections')
}

export function listBots(workspaceId: string) {
  return apiRequest<Bot[]>(`/api/workspaces/${workspaceId}/bots`)
}

export function listAllBots() {
  return apiRequest<Bot[]>('/api/bots')
}

export function listAvailableBots(workspaceId: string) {
  return apiRequest<Bot[]>(`/api/workspaces/${workspaceId}/available-bots`)
}

export function createBot(workspaceId: string, input: CreateBotInput) {
  return apiRequest<Bot>(`/api/workspaces/${workspaceId}/bots`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateBot(workspaceId: string, botId: string, input: UpdateBotInput) {
  return apiRequest<Bot>(`/api/workspaces/${workspaceId}/bots/${botId}/metadata`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listBotBindings(workspaceId: string, botId: string) {
  return apiRequest<BotBinding[]>(`/api/workspaces/${workspaceId}/bots/${botId}/bindings`)
}

export function listBotTriggers(workspaceId: string, botId: string) {
  return apiRequest<BotTrigger[]>(`/api/workspaces/${workspaceId}/bots/${botId}/triggers`)
}

export function listBotDeliveryTargets(workspaceId: string, botId: string) {
  return apiRequest<BotDeliveryTarget[]>(`/api/workspaces/${workspaceId}/bots/${botId}/delivery-targets`)
}

export function listAvailableBotDeliveryTargets(
  workspaceId: string,
  input: {
    botId?: string
  } = {},
) {
  const query = new URLSearchParams()
  if (input.botId) {
    query.set('botId', input.botId)
  }
  const suffix = query.size ? `?${query.toString()}` : ''
  return apiRequest<BotDeliveryTarget[]>(
    `/api/workspaces/${workspaceId}/available-bot-delivery-targets${suffix}`,
  )
}

export function createBotTrigger(workspaceId: string, botId: string, input: UpsertBotTriggerInput) {
  return apiRequest<BotTrigger>(`/api/workspaces/${workspaceId}/bots/${botId}/triggers`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateBotTrigger(
  workspaceId: string,
  botId: string,
  triggerId: string,
  input: UpsertBotTriggerInput,
) {
  return apiRequest<BotTrigger>(`/api/workspaces/${workspaceId}/bots/${botId}/triggers/${triggerId}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteBotTrigger(workspaceId: string, botId: string, triggerId: string) {
  return apiRequest<{ status: string }>(`/api/workspaces/${workspaceId}/bots/${botId}/triggers/${triggerId}`, {
    method: 'DELETE',
  })
}

export function upsertBotDeliveryTarget(workspaceId: string, botId: string, input: UpsertBotDeliveryTargetInput) {
  return apiRequest<BotDeliveryTarget>(`/api/workspaces/${workspaceId}/bots/${botId}/delivery-targets`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateBotDeliveryTarget(
  workspaceId: string,
  botId: string,
  targetId: string,
  input: UpsertBotDeliveryTargetInput,
) {
  return apiRequest<BotDeliveryTarget>(`/api/workspaces/${workspaceId}/bots/${botId}/delivery-targets/${targetId}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteBotDeliveryTarget(workspaceId: string, botId: string, targetId: string) {
  return apiRequest<{ status: string }>(`/api/workspaces/${workspaceId}/bots/${botId}/delivery-targets/${targetId}`, {
    method: 'DELETE',
  })
}

export function listBotOutboundDeliveries(workspaceId: string, botId: string) {
  return apiRequest<BotOutboundDelivery[]>(`/api/workspaces/${workspaceId}/bots/${botId}/outbound-deliveries`)
}

export function getBotOutboundDelivery(workspaceId: string, botId: string, deliveryId: string) {
  return apiRequest<BotOutboundDelivery>(`/api/workspaces/${workspaceId}/bots/${botId}/outbound-deliveries/${deliveryId}`)
}

export function updateBotDefaultBinding(workspaceId: string, botId: string, input: UpdateBotDefaultBindingInput) {
  return apiRequest<BotBinding>(`/api/workspaces/${workspaceId}/bots/${botId}/default-binding`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getBotConnection(workspaceId: string, connectionId: string) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}`)
}

export function getBotConnectionById(connectionId: string) {
  return apiRequest<BotConnection>(`/api/bot-connections/${connectionId}`)
}

export function updateBotConnection(workspaceId: string, connectionId: string, input: UpdateBotConnectionInput) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listBotConnectionLogs(workspaceId: string, connectionId: string) {
  return apiRequest<BotConnectionLogEntry[]>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}/logs`)
}

export function listBotConnectionLogsById(connectionId: string) {
  return apiRequest<BotConnectionLogEntry[]>(`/api/bot-connections/${connectionId}/logs`)
}

export function createBotConnection(workspaceId: string, input: CreateBotConnectionInput) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createBotConnectionForBot(workspaceId: string, botId: string, input: CreateBotConnectionInput) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bots/${botId}/connections`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function pauseBotConnection(workspaceId: string, connectionId: string) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}/pause`, {
    method: 'POST',
  })
}

export function resumeBotConnection(
  workspaceId: string,
  connectionId: string,
  input?: ResumeBotConnectionInput,
) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}/resume`, {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  })
}

export function updateBotConnectionRuntimeMode(
  workspaceId: string,
  connectionId: string,
  input: UpdateBotConnectionRuntimeModeInput,
) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}/runtime-mode`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateBotConnectionCommandOutputMode(
  workspaceId: string,
  connectionId: string,
  input: UpdateBotConnectionCommandOutputModeInput,
) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}/command-output-mode`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateWeChatChannelTiming(
  workspaceId: string,
  connectionId: string,
  input: UpdateWeChatChannelTimingInput,
) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}/wechat-channel-timing`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteBotConnection(workspaceId: string, connectionId: string) {
  return apiRequest<{ status: string }>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}`, {
    method: 'DELETE',
  })
}

export function listBotConversations(workspaceId: string, connectionId: string) {
  return apiRequest<BotConversation[]>(
    `/api/workspaces/${workspaceId}/bot-connections/${connectionId}/conversations`,
  )
}

export function listBotConnectionRecipientCandidates(workspaceId: string, connectionId: string) {
  return apiRequest<BotRecipientCandidate[]>(
    `/api/workspaces/${workspaceId}/bot-connections/${connectionId}/recipient-candidates`,
  )
}

export function replayBotConversationFailedReply(workspaceId: string, connectionId: string, conversationId: string) {
  return apiRequest<BotConversation>(
    `/api/workspaces/${workspaceId}/bot-connections/${connectionId}/conversations/${conversationId}/replay-failed-reply`,
    {
      method: 'POST',
    },
  )
}

export function updateBotConversationBinding(
  workspaceId: string,
  connectionId: string,
  conversationId: string,
  input: UpdateBotConversationBindingInput,
) {
  return apiRequest<BotConversation>(
    `/api/workspaces/${workspaceId}/bot-connections/${connectionId}/conversations/${conversationId}/binding`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function clearBotConversationBinding(workspaceId: string, connectionId: string, conversationId: string) {
  return apiRequest<BotConversation>(
    `/api/workspaces/${workspaceId}/bot-connections/${connectionId}/conversations/${conversationId}/binding/clear`,
    {
      method: 'POST',
    },
  )
}

export function sendBotSessionOutboundMessages(
  workspaceId: string,
  botId: string,
  sessionId: string,
  input: SendBotOutboundMessagesInput,
) {
  return apiRequest<BotOutboundDelivery>(`/api/workspaces/${workspaceId}/bots/${botId}/sessions/${sessionId}/outbound-messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function sendBotDeliveryTargetOutboundMessages(
  workspaceId: string,
  botId: string,
  targetId: string,
  input: SendBotOutboundMessagesInput,
) {
  return apiRequest<BotOutboundDelivery>(
    `/api/workspaces/${workspaceId}/bots/${botId}/delivery-targets/${targetId}/outbound-messages`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function getThreadBotBinding(workspaceId: string, threadId: string) {
  return apiRequest<ThreadBotBinding>(
    `/api/workspaces/${workspaceId}/threads/${threadId}/bot-channel-binding`,
  )
}

export function upsertThreadBotBinding(
  workspaceId: string,
  threadId: string,
  input: UpsertThreadBotBindingInput,
) {
  return apiRequest<ThreadBotBinding>(
    `/api/workspaces/${workspaceId}/threads/${threadId}/bot-channel-binding`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function deleteThreadBotBinding(workspaceId: string, threadId: string) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/threads/${threadId}/bot-channel-binding`,
    {
      method: 'DELETE',
    },
  )
}

export function startWeChatLogin(workspaceId: string, input: StartWeChatLoginInput) {
  return apiRequest<WeChatLogin>(`/api/workspaces/${workspaceId}/bot-providers/wechat/login/start`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listWeChatAccounts(workspaceId: string) {
  return apiRequest<WeChatAccount[]>(`/api/workspaces/${workspaceId}/bot-providers/wechat/accounts`)
}

export function listAllWeChatAccounts() {
  return apiRequest<WeChatAccount[]>('/api/bot-providers/wechat/accounts')
}

export function updateWeChatAccount(workspaceId: string, accountId: string, input: UpdateWeChatAccountInput) {
  return apiRequest<WeChatAccount>(`/api/workspaces/${workspaceId}/bot-providers/wechat/accounts/${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteWeChatAccount(workspaceId: string, accountId: string) {
  return apiRequest<{ status: string }>(`/api/workspaces/${workspaceId}/bot-providers/wechat/accounts/${accountId}`, {
    method: 'DELETE',
  })
}

export function getWeChatLogin(workspaceId: string, loginId: string) {
  return apiRequest<WeChatLogin>(`/api/workspaces/${workspaceId}/bot-providers/wechat/login/${loginId}`)
}

export function deleteWeChatLogin(workspaceId: string, loginId: string) {
  return apiRequest<{ status: string }>(`/api/workspaces/${workspaceId}/bot-providers/wechat/login/${loginId}`, {
    method: 'DELETE',
  })
}
