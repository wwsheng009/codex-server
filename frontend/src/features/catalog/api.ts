import { apiRequest } from '../../lib/api-client'
import type {
  CatalogItem,
  CollaborationMode,
  PluginCatalogItem,
  PluginDetailResult,
  PluginInstallResult,
  PluginListResult,
} from '../../types/api'

export type ReadPluginInput = {
  marketplacePath: string
  pluginName: string
}

export type InstallPluginInput = {
  marketplacePath: string
  pluginName: string
}

export type UninstallPluginInput = {
  pluginId: string
}

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
  return apiRequest<PluginListResult>(`/api/workspaces/${workspaceId}/plugins`).then((result) => ({
    plugins: (result.plugins ?? []) as PluginCatalogItem[],
    remoteSyncError: result.remoteSyncError ?? null,
  }))
}

export function readPlugin(
  workspaceId: string,
  input: ReadPluginInput,
) {
  return apiRequest<PluginDetailResult>(`/api/workspaces/${workspaceId}/plugins/read`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function installPlugin(
  workspaceId: string,
  input: InstallPluginInput,
) {
  return apiRequest<PluginInstallResult>(
    `/api/workspaces/${workspaceId}/plugins/install`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function uninstallPlugin(workspaceId: string, input: UninstallPluginInput) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/plugins/uninstall`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function listCollaborationModes(workspaceId: string) {
  return apiRequest<CollaborationMode[]>(`/api/workspaces/${workspaceId}/collaboration-modes`)
}

export function listMcpServerStatus(workspaceId: string) {
  return apiRequest<{ data: Array<Record<string, unknown>> }>(
    `/api/workspaces/${workspaceId}/mcp-server-status`,
  )
}
