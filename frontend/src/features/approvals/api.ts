import { apiRequest } from '../../lib/api-client'
import type { PendingApproval } from '../../types/api'

export function listPendingApprovals(workspaceId: string) {
  return apiRequest<PendingApproval[]>(`/api/workspaces/${workspaceId}/pending-approvals`)
}

export function respondServerRequest(requestId: string, input: { action: string }) {
  return apiRequest<PendingApproval>(`/api/server-requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function respondServerRequestWithDetails(
  requestId: string,
  input: { action: string; answers?: Record<string, string[]>; content?: unknown },
) {
  return apiRequest<PendingApproval>(`/api/server-requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
