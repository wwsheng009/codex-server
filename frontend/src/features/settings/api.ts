import { apiRequest } from '../../lib/api-client'
import type {
  ConfigReadResult,
  ConfigRequirementsResult,
  ConfigWriteResult,
  ExternalAgentConfigDetectResult,
  FeedbackUploadResult,
  McpOauthLoginResult,
  RuntimePreferencesResult,
} from '../../types/api'

export type ReadConfigInput = {
  includeLayers?: boolean
}

export type WriteRuntimePreferencesInput = {
  modelCatalogPath: string
  defaultShellType: string
  defaultTerminalShell: string
  modelShellTypeOverrides: Record<string, string>
  outboundProxyUrl: string
  defaultTurnApprovalPolicy?: string
  defaultTurnSandboxPolicy?: Record<string, unknown>
  defaultCommandSandboxPolicy?: Record<string, unknown>
  backendThreadTraceEnabled?: boolean | null
  backendThreadTraceWorkspaceId?: string
  backendThreadTraceThreadId?: string
}

export type WriteConfigValueInput = {
  filePath?: string
  keyPath: string
  mergeStrategy?: string
  value: unknown
}

export type BatchWriteConfigInput = {
  filePath?: string
  edits: Array<Record<string, unknown>>
  reloadUserConfig?: boolean
}

export type DetectExternalAgentConfigInput = {
  includeHome?: boolean
}

export type ImportExternalAgentConfigInput = {
  migrationItems: Array<Record<string, unknown>>
}

export type FuzzyFileSearchInput = {
  query: string
}

export type UploadFeedbackInput = {
  classification: string
  includeLogs: boolean
  reason?: string
  threadId?: string
  extraLogFiles?: string[]
}

export type McpOauthLoginInput = {
  name: string
  scopes?: string[]
  timeoutSecs?: number
}

export function readConfig(workspaceId: string, input: ReadConfigInput) {
  return apiRequest<ConfigReadResult>(`/api/workspaces/${workspaceId}/config/read`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function readRuntimePreferences() {
  return apiRequest<RuntimePreferencesResult>(`/api/runtime/preferences`)
}

export function writeRuntimePreferences(input: WriteRuntimePreferencesInput) {
  return apiRequest<RuntimePreferencesResult>(`/api/runtime/preferences`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function importRuntimeModelCatalogTemplate() {
  return apiRequest<RuntimePreferencesResult>(`/api/runtime/preferences/import-model-catalog`, {
    method: 'POST',
  })
}

export function writeConfigValue(
  workspaceId: string,
  input: WriteConfigValueInput,
) {
  return apiRequest<ConfigWriteResult>(`/api/workspaces/${workspaceId}/config/write`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function batchWriteConfig(
  workspaceId: string,
  input: BatchWriteConfigInput,
) {
  return apiRequest<ConfigWriteResult>(
    `/api/workspaces/${workspaceId}/config/batch-write`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function readConfigRequirements(workspaceId: string) {
  return apiRequest<ConfigRequirementsResult>(
    `/api/workspaces/${workspaceId}/config/requirements`,
  )
}

export function detectExternalAgentConfig(
  workspaceId: string,
  input: DetectExternalAgentConfigInput,
) {
  return apiRequest<ExternalAgentConfigDetectResult>(
    `/api/workspaces/${workspaceId}/external-agent/detect`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function importExternalAgentConfig(
  workspaceId: string,
  input: ImportExternalAgentConfigInput,
) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/external-agent/import`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function fuzzyFileSearch(workspaceId: string, input: FuzzyFileSearchInput) {
  return apiRequest<{ files: Array<Record<string, unknown>> }>(
    `/api/workspaces/${workspaceId}/search/files`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function uploadFeedback(
  workspaceId: string,
  input: UploadFeedbackInput,
) {
  return apiRequest<FeedbackUploadResult>(
    `/api/workspaces/${workspaceId}/feedback/upload`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function mcpOauthLogin(
  workspaceId: string,
  input: McpOauthLoginInput,
) {
  return apiRequest<McpOauthLoginResult>(
    `/api/workspaces/${workspaceId}/mcp/oauth/login`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}
