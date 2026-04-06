import { apiRequest } from '../../lib/api-client'
import type { BotConnection, BotConnectionLogEntry, BotConversation, WeChatLogin } from '../../types/api'

export type CreateBotConnectionInput = {
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

export type StartWeChatLoginInput = {
  baseUrl: string
}

export function listBotConnections(workspaceId: string) {
  return apiRequest<BotConnection[]>(`/api/workspaces/${workspaceId}/bot-connections`)
}

export function getBotConnection(workspaceId: string, connectionId: string) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}`)
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

export function startWeChatLogin(workspaceId: string, input: StartWeChatLoginInput) {
  return apiRequest<WeChatLogin>(`/api/workspaces/${workspaceId}/bot-providers/wechat/login/start`, {
    method: 'POST',
    body: JSON.stringify(input),
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
