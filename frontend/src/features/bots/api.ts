import { apiRequest } from '../../lib/api-client'
import type { BotConnection, BotConversation } from '../../types/api'

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

export function listBotConnections(workspaceId: string) {
  return apiRequest<BotConnection[]>(`/api/workspaces/${workspaceId}/bot-connections`)
}

export function getBotConnection(workspaceId: string, connectionId: string) {
  return apiRequest<BotConnection>(`/api/workspaces/${workspaceId}/bot-connections/${connectionId}`)
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
