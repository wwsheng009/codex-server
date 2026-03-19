import { apiRequest } from '../../lib/api-client'
import type { Workspace } from '../../types/api'

export function listWorkspaces() {
  return apiRequest<Workspace[]>('/api/workspaces')
}

export function getWorkspace(workspaceId: string) {
  return apiRequest<Workspace>(`/api/workspaces/${workspaceId}`)
}

export function createWorkspace(input: { name: string; rootPath: string }) {
  return apiRequest<Workspace>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
