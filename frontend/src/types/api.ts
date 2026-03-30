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
  runtimeConfigChangedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type WorkspaceRuntimeState = {
  workspaceId: string
  status: string
  command: string
  rootPath: string
  lastError?: string
  startedAt?: string | null
  updatedAt: string
  runtimeConfigChangedAt?: string | null
  configLoadStatus: string
  restartRequired: boolean
}

export type Automation = {
  id: string
  title: string
  description: string
  prompt: string
  workspaceId: string
  workspaceName: string
  threadId?: string
  schedule: string
  scheduleLabel: string
  model: string
  reasoning: string
  status: string
  nextRun: string
  nextRunAt?: string | null
  lastRun: string | null
  createdAt: string
  updatedAt: string
}

export type AutomationTemplate = {
  id: string
  category: string
  title: string
  description: string
  prompt: string
  isBuiltIn: boolean
  createdAt: string
  updatedAt: string
}

export type AutomationRunLogEntry = {
  id: string
  ts: string
  level: string
  message: string
  eventType?: string
}

export type AutomationRun = {
  id: string
  automationId: string
  automationTitle: string
  workspaceId: string
  workspaceName: string
  threadId?: string
  turnId?: string
  trigger: string
  status: string
  summary?: string
  error?: string
  startedAt: string
  finishedAt?: string | null
  logs: AutomationRunLogEntry[]
}

export type NotificationItem = {
  id: string
  workspaceId: string
  workspaceName: string
  automationId?: string
  automationTitle?: string
  runId?: string
  kind: string
  title: string
  message: string
  level: string
  read: boolean
  createdAt: string
  readAt?: string | null
}

export type BotConnection = {
  id: string
  workspaceId: string
  provider: string
  name: string
  status: string
  aiBackend: string
  aiConfig?: Record<string, string> | null
  settings?: Record<string, string> | null
  secretKeys?: string[] | null
  lastError?: string | null
  createdAt: string
  updatedAt: string
}

export type BotConversation = {
  id: string
  workspaceId: string
  connectionId: string
  provider: string
  externalConversationId?: string
  externalChatId: string
  externalThreadId?: string
  externalUserId?: string
  externalUsername?: string
  externalTitle?: string
  threadId?: string
  backendState?: Record<string, string> | null
  lastInboundMessageId?: string
  lastInboundText?: string
  lastOutboundText?: string
  createdAt: string
  updatedAt: string
}

export type Thread = {
  id: string
  workspaceId: string
  name: string
  status: string
  archived: boolean
  turnCount?: number
  messageCount?: number
  createdAt: string
  updatedAt: string
}

export type ThreadListPage = {
  data: Thread[]
  nextCursor?: string | null
}

export type ThreadTurn = {
  id: string
  status: string
  items: Record<string, unknown>[]
  error?: unknown
}

export type ThreadDetail = Thread & {
  cwd?: string
  hasMoreTurns?: boolean
  messageCount?: number
  preview?: string
  path?: string
  source?: string
  tokenUsage?: ThreadTokenUsage | null
  turnCount?: number
  turns: ThreadTurn[]
}

export type ThreadTurnItemOutput = {
  itemId: string
  command?: string
  aggregatedOutput: string
  outputLineCount?: number
  outputContentMode?: string
  outputStartLine?: number
  outputEndLine?: number
  outputStartOffset?: number
  outputEndOffset?: number
  outputTotalLength?: number
  outputTruncated?: boolean
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
  value?: string
  shellType?: string
}

export type PluginCatalogItem = {
  id: string
  name: string
  description: string
  marketplaceName: string
  marketplacePath?: string
  installed: boolean
  enabled: boolean
  authPolicy?: string
  installPolicy?: string
  sourceType?: string
  sourcePath?: string
  capabilities?: string[] | null
  category?: string | null
  brandColor?: string | null
}

export type PluginListResult = {
  plugins: PluginCatalogItem[]
  remoteSyncError?: string | null
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
  runtimeReloadRequired?: boolean
  matchedRuntimeSensitiveKey?: string
}

export type ConfigRequirementsResult = {
  requirements?: Record<string, unknown> | null
}

export type RuntimePreferencesResult = {
  configuredModelCatalogPath: string
  configuredDefaultShellType: string
  configuredDefaultTerminalShell: string
  supportedTerminalShells: string[]
  configuredModelShellTypeOverrides: Record<string, string>
  configuredOutboundProxyUrl: string
  configuredDefaultTurnApprovalPolicy: string
  configuredDefaultTurnSandboxPolicy?: Record<string, unknown> | null
  configuredDefaultCommandSandboxPolicy?: Record<string, unknown> | null
  configuredBackendThreadTraceEnabled?: boolean | null
  configuredBackendThreadTraceWorkspaceId: string
  configuredBackendThreadTraceThreadId: string
  defaultModelCatalogPath: string
  defaultDefaultShellType: string
  defaultDefaultTerminalShell: string
  defaultModelShellTypeOverrides: Record<string, string>
  defaultOutboundProxyUrl: string
  defaultDefaultTurnApprovalPolicy: string
  defaultDefaultTurnSandboxPolicy?: Record<string, unknown> | null
  defaultDefaultCommandSandboxPolicy?: Record<string, unknown> | null
  defaultBackendThreadTraceEnabled: boolean
  defaultBackendThreadTraceWorkspaceId: string
  defaultBackendThreadTraceThreadId: string
  effectiveModelCatalogPath: string
  effectiveDefaultShellType: string
  effectiveDefaultTerminalShell: string
  effectiveModelShellTypeOverrides: Record<string, string>
  effectiveOutboundProxyUrl: string
  effectiveDefaultTurnApprovalPolicy: string
  effectiveDefaultTurnSandboxPolicy?: Record<string, unknown> | null
  effectiveDefaultCommandSandboxPolicy?: Record<string, unknown> | null
  effectiveBackendThreadTraceEnabled: boolean
  effectiveBackendThreadTraceWorkspaceId: string
  effectiveBackendThreadTraceThreadId: string
  effectiveCommand: string
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
  mode?: string
  model?: string
  reasoningEffort?: string | null
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
  mode?: string
  shellPath?: string
  initialCwd?: string
  currentCwd?: string
  shellState?: string
  lastExitCode?: number | null
  status: string
  createdAt: string
}

export type CommandSessionSnapshot = CommandSession & {
  archived?: boolean
  combinedOutput: string
  stdout: string
  stderr: string
  exitCode?: number | null
  error?: string | null
  pinned?: boolean
  updatedAt: string
}
