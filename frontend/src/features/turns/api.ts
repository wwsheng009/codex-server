import { apiRequest } from '../../lib/api-client'
import type { TurnResult } from '../../types/api'

export function startTurn(
  workspaceId: string,
  threadId: string,
  input: {
    input: string
    model?: string
    reasoningEffort?: string
    permissionPreset?: string
    collaborationMode?: string
  },
) {
  return apiRequest<TurnResult>(`/api/workspaces/${workspaceId}/threads/${threadId}/turns`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function interruptTurn(workspaceId: string, threadId: string) {
  return apiRequest<TurnResult>(`/api/workspaces/${workspaceId}/threads/${threadId}/turns/interrupt`, {
    method: 'POST',
  })
}
