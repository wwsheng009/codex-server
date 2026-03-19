import { apiRequest } from '../../lib/api-client'
import type { CatalogItem, CollaborationMode } from '../../types/api'

export function listModels(workspaceId: string) {
  return apiRequest<CatalogItem[]>(`/api/workspaces/${workspaceId}/models`)
}

export function listSkills(workspaceId: string) {
  return apiRequest<CatalogItem[]>(`/api/workspaces/${workspaceId}/skills`)
}

export function listApps(workspaceId: string) {
  return apiRequest<CatalogItem[]>(`/api/workspaces/${workspaceId}/apps`)
}

export function listPlugins(workspaceId: string) {
  return apiRequest<CatalogItem[]>(`/api/workspaces/${workspaceId}/plugins`)
}

export function listCollaborationModes(workspaceId: string) {
  return apiRequest<CollaborationMode[]>(`/api/workspaces/${workspaceId}/collaboration-modes`)
}
