import { apiRequest } from '../../lib/api-client'
import type { Workspace, WorkspaceRuntimeState } from '../../types/api'

export type CreateWorkspaceInput = {
  name: string
  rootPath: string
}

export type RenameWorkspaceInput = {
  name: string
}

export function listWorkspaces() {
  return apiRequest<Workspace[]>('/api/workspaces')
}

export function getWorkspace(workspaceId: string) {
  return apiRequest<Workspace>(`/api/workspaces/${workspaceId}`)
}

export function getWorkspaceRuntimeState(workspaceId: string) {
  return apiRequest<WorkspaceRuntimeState>(`/api/workspaces/${workspaceId}/runtime-state`)
}

export function createWorkspace(input: CreateWorkspaceInput) {
  return apiRequest<Workspace>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function renameWorkspace(workspaceId: string, input: RenameWorkspaceInput) {
  return apiRequest<Workspace>(`/api/workspaces/${workspaceId}/name`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function restartWorkspace(workspaceId: string) {
  return apiRequest<Workspace>(`/api/workspaces/${workspaceId}/restart`, {
    method: 'POST',
  })
}

export function deleteWorkspace(workspaceId: string) {
  return apiRequest<{ status: string }>(`/api/workspaces/${workspaceId}`, {
    method: 'DELETE',
  })
}
