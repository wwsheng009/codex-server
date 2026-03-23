import { apiRequest } from '../../lib/api-client'
import type { CommandSession, CommandSessionSnapshot } from '../../types/api'

export type StartCommandInput = {
  command?: string
  mode?: 'command' | 'shell'
}

export function listCommandSessions(workspaceId: string) {
  return apiRequest<CommandSessionSnapshot[]>(`/api/workspaces/${workspaceId}/commands`)
}

export function closeCommandSession(workspaceId: string, processId: string) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/commands/${processId}`,
    {
      method: 'DELETE',
    },
  )
}

export function clearCompletedCommandSessions(workspaceId: string) {
  return apiRequest<{ removedProcessIds: string[]; status: string }>(
    `/api/workspaces/${workspaceId}/commands/completed`,
    {
      method: 'DELETE',
    },
  )
}

export function pinCommandSession(workspaceId: string, processId: string) {
  return apiRequest<{ pinned: boolean; status: string }>(
    `/api/workspaces/${workspaceId}/commands/${processId}/pin`,
    {
      method: 'POST',
    },
  )
}

export function archiveCommandSession(workspaceId: string, processId: string) {
  return apiRequest<{ archived: boolean; status: string }>(
    `/api/workspaces/${workspaceId}/commands/${processId}/archive`,
    {
      method: 'POST',
    },
  )
}

export function unpinCommandSession(workspaceId: string, processId: string) {
  return apiRequest<{ pinned: boolean; status: string }>(
    `/api/workspaces/${workspaceId}/commands/${processId}/unpin`,
    {
      method: 'POST',
    },
  )
}

export function unarchiveCommandSession(workspaceId: string, processId: string) {
  return apiRequest<{ archived: boolean; status: string }>(
    `/api/workspaces/${workspaceId}/commands/${processId}/unarchive`,
    {
      method: 'POST',
    },
  )
}

export function startCommand(workspaceId: string, input: StartCommandInput) {
  return apiRequest<CommandSession>(`/api/workspaces/${workspaceId}/commands`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function writeCommand(
  workspaceId: string,
  processId: string,
  input: { input: string },
) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/commands/${processId}/write`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function terminateCommand(workspaceId: string, processId: string) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/commands/${processId}/terminate`,
    {
      method: 'POST',
    },
  )
}

export function resizeCommand(
  workspaceId: string,
  processId: string,
  input: { cols: number; rows: number },
) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/commands/${processId}/resize`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}
