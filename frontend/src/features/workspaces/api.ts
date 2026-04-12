import { apiRequest } from '../../lib/api-client'
import type {
  Workspace,
  WorkspaceHookConfigurationResult,
  WorkspaceHookConfigurationWriteResult,
  WorkspaceRuntimeState,
} from '../../types/api'

export type CreateWorkspaceInput = {
  name: string
  rootPath: string
}

export type RenameWorkspaceInput = {
  name: string
}

export type WriteWorkspaceHookConfigurationInput = {
  hookSessionStartEnabled?: boolean | null
  hookSessionStartContextPaths?: string[] | null
  hookSessionStartMaxChars?: number | null
  hookSessionStartTemplate?: string | null
  hookUserPromptSubmitBlockSecretPasteEnabled?: boolean | null
  hookPreToolUseBlockDangerousCommandEnabled?: boolean | null
  hookPreToolUseAdditionalProtectedGovernancePaths?: string[] | null
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

export function getWorkspaceHookConfiguration(workspaceId: string) {
  return apiRequest<WorkspaceHookConfigurationResult>(
    `/api/workspaces/${workspaceId}/hook-configuration`,
  )
}

export function writeWorkspaceHookConfiguration(
  workspaceId: string,
  input: WriteWorkspaceHookConfigurationInput,
) {
  return apiRequest<WorkspaceHookConfigurationWriteResult>(
    `/api/workspaces/${workspaceId}/hook-configuration`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
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
