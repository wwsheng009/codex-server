import { apiRequest } from '../../lib/api-client'
import type {
  Bot,
  BotBinding,
  BotConnection,
  BotConnectionLogEntry,
  BotConversation,
  WeChatAccount,
  WeChatLogin,
} from '../../types/api'

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
}

export type UpdateBotDefaultBindingInput = {
  bindingMode: string
  targetWorkspaceId?: string
  targetThreadId?: string
  name?: string
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

export function listBots(workspaceId: string) {
  return apiRequest<Bot[]>(`/api/workspaces/${workspaceId}/bots`)
}

export function listBotBindings(workspaceId: string, botId: string) {
  return apiRequest<BotBinding[]>(`/api/workspaces/${workspaceId}/bots/${botId}/bindings`)
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

export function updateBotConnection(workspaceId: string, connectionId: string, input: UpdateBotConnectionInput) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listBotConnectionLogs(workspaceId: string, connectionId: string) {
  return apiRequest<BotConnectionLogEntry[]>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}/logs`)
}

export function createBotConnection(workspaceId: string, input: CreateBotConnectionInput) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections`, {
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

export function startWeChatLogin(workspaceId: string, input: StartWeChatLoginInput) {
  return apiRequest<WeChatLogin>(`/api/workspaces/${workspaceId}/bot-providers/wechat/login/start`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listWeChatAccounts(workspaceId: string) {
  return apiRequest<WeChatAccount[]>(`/api/workspaces/${workspaceId}/bot-providers/wechat/accounts`)
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
