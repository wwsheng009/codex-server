export type ApiResponse<T> = {
  data: T
  error?: {
    code: string
    message: string
  } | null
}

export type Workspace = {
  id: string
  name: string
  rootPath: string
  runtimeStatus: string
  createdAt: string
  updatedAt: string
}

export type Thread = {
  id: string
  workspaceId: string
  name: string
  status: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export type ThreadTurn = {
  id: string
  status: string
  items: Record<string, unknown>[]
  error?: unknown
}

export type ThreadDetail = Thread & {
  cwd?: string
  preview?: string
  path?: string
  source?: string
  turns: ThreadTurn[]
}

export type PendingApproval = {
  id: string
  workspaceId: string
  threadId: string
  kind: string
  summary: string
  status: string
  actions: string[]
  details?: ApprovalDetails | null
  requestedAt: string
}

export type ApprovalOption = {
  label: string
  description: string
}

export type ApprovalQuestion = {
  header: string
  id: string
  question: string
  isOther?: boolean
  isSecret?: boolean
  options?: ApprovalOption[] | null
}

export type ApprovalDetails = {
  itemId?: string
  threadId?: string
  turnId?: string
  callId?: string
  tool?: string
  arguments?: unknown
  previousAccountId?: string
  serverName?: string
  reason?: string
  message?: string
  mode?: string
  url?: string
  questions?: ApprovalQuestion[]
  requestedSchema?: Record<string, unknown>
  [key: string]: unknown
}

export type Account = {
  id: string
  email: string
  status: string
  lastSyncedAt: string
}

export type AccountLoginResult = {
  type: string
  status: string
  authUrl?: string
  loginId?: string
  message?: string
}

export type AccountCancelLoginResult = {
  status: string
}

export type McpOauthLoginResult = {
  authorizationUrl: string
}

export type RateLimit = {
  name: string
  limit: number
  remaining: number
  resetsAt: string
}

export type CatalogItem = {
  id: string
  name: string
  description: string
}

export type RemoteSkillSummary = {
  id: string
  name: string
  description: string
}

export type RemoteSkillWriteResult = {
  id: string
  path: string
}

export type PluginDetailResult = {
  plugin: Record<string, unknown>
}

export type PluginInstallResult = {
  appsNeedingAuth: Array<Record<string, unknown>>
  authPolicy: string
}

export type ConfigReadResult = {
  config: Record<string, unknown>
  origins: Record<string, unknown>
  layers?: unknown[] | null
}

export type ConfigWriteResult = {
  filePath: string
  status: string
  version: string
  overriddenMetadata?: Record<string, unknown> | null
}

export type ConfigRequirementsResult = {
  requirements?: Record<string, unknown> | null
}

export type ExternalAgentConfigDetectResult = {
  items: Array<Record<string, unknown>>
}

export type FeedbackUploadResult = {
  threadId: string
}

export type CollaborationMode = {
  id: string
  name: string
  description: string
}

export type TokenUsageBreakdown = {
  cachedInputTokens: number
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export type ThreadTokenUsage = {
  last: TokenUsageBreakdown
  total: TokenUsageBreakdown
  modelContextWindow?: number | null
}

export type ServerEvent = {
  workspaceId: string
  threadId?: string
  turnId?: string
  method: string
  payload: unknown
  serverRequestId?: string | null
  ts: string
}

export type TurnResult = {
  turnId: string
  status: string
}

export type CommandSession = {
  id: string
  workspaceId: string
  command: string
  status: string
  createdAt: string
}
