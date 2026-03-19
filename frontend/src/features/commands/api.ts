import { apiRequest } from '../../lib/api-client'
import type { CommandSession } from '../../types/api'

export function startCommand(workspaceId: string, input: { command: string }) {
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
