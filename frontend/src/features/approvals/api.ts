import { apiRequest } from '../../lib/api-client'
import type { PendingApproval } from '../../types/api'

export type RespondServerRequestInput = {
  action: string
}

export type RespondServerRequestWithDetailsInput = {
  action: string
  answers?: Record<string, string[]>
  content?: unknown
}

export function listPendingApprovals(workspaceId: string) {
  return apiRequest<PendingApproval[]>(`/api/workspaces/${workspaceId}/pending-approvals`)
}

export function respondServerRequest(requestId: string, input: RespondServerRequestInput) {
  return apiRequest<PendingApproval>(`/api/server-requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function respondServerRequestWithDetails(
  requestId: string,
  input: RespondServerRequestWithDetailsInput,
) {
  return apiRequest<PendingApproval>(`/api/server-requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
