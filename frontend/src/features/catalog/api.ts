import { apiRequest } from '../../lib/api-client'
import type {
  CatalogItem,
  CollaborationMode,
  PluginDetailResult,
  PluginInstallResult,
  RemoteSkillSummary,
  RemoteSkillWriteResult,
} from '../../types/api'

export type ListRemoteSkillsInput = {
  enabled?: boolean
  hazelnutScope?: string
  productSurface?: string
}

export type ExportRemoteSkillInput = {
  hazelnutId: string
}

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

export function listRemoteSkills(
  workspaceId: string,
  input: ListRemoteSkillsInput,
) {
  return apiRequest<{ data: RemoteSkillSummary[] }>(
    `/api/workspaces/${workspaceId}/skills/remote/list`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function exportRemoteSkill(workspaceId: string, input: ExportRemoteSkillInput) {
  return apiRequest<RemoteSkillWriteResult>(
    `/api/workspaces/${workspaceId}/skills/remote/export`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function listApps(workspaceId: string) {
  return apiRequest<CatalogItem[]>(`/api/workspaces/${workspaceId}/apps`)
}

export function listPlugins(workspaceId: string) {
  return apiRequest<CatalogItem[]>(`/api/workspaces/${workspaceId}/plugins`)
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
