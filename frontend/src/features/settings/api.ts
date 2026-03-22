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

export function readConfig(workspaceId: string, input: { includeLayers?: boolean }) {
  return apiRequest<ConfigReadResult>(`/api/workspaces/${workspaceId}/config/read`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function readRuntimePreferences() {
  return apiRequest<RuntimePreferencesResult>(`/api/runtime/preferences`)
}

export function writeRuntimePreferences(input: {
  modelCatalogPath: string
  defaultShellType: string
  modelShellTypeOverrides: Record<string, string>
  defaultTurnApprovalPolicy?: string
  defaultTurnSandboxPolicy?: Record<string, unknown>
  defaultCommandSandboxPolicy?: Record<string, unknown>
}) {
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
  input: {
    filePath?: string
    keyPath: string
    mergeStrategy?: string
    value: unknown
  },
) {
  return apiRequest<ConfigWriteResult>(`/api/workspaces/${workspaceId}/config/write`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function batchWriteConfig(
  workspaceId: string,
  input: {
    filePath?: string
    edits: Array<Record<string, unknown>>
    reloadUserConfig?: boolean
  },
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
  input: { includeHome?: boolean },
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
  input: { migrationItems: Array<Record<string, unknown>> },
) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/external-agent/import`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function fuzzyFileSearch(workspaceId: string, input: { query: string }) {
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
  input: {
    classification: string
    includeLogs: boolean
    reason?: string
    threadId?: string
    extraLogFiles?: string[]
  },
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
  input: {
    name: string
    scopes?: string[]
    timeoutSecs?: number
  },
) {
  return apiRequest<McpOauthLoginResult>(
    `/api/workspaces/${workspaceId}/mcp/oauth/login`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}
