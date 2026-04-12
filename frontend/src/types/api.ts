export type ApiResponse<T> = {
  data: T;
  error?: {
    code: string;
    message: string;
  } | null;
};

export type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  runtimeStatus: string;
  runtimeConfigChangedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRuntimeState = {
  workspaceId: string;
  status: string;
  command: string;
  rootPath: string;
  lastError?: string;
  startedAt?: string | null;
  updatedAt: string;
  runtimeConfigChangedAt?: string | null;
  configLoadStatus: string;
  restartRequired: boolean;
};

export type Automation = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  workspaceId: string;
  workspaceName: string;
  threadId?: string;
  schedule: string;
  scheduleLabel: string;
  model: string;
  reasoning: string;
  status: string;
  nextRun: string;
  nextRunAt?: string | null;
  lastRun: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationTemplate = {
  id: string;
  category: string;
  title: string;
  description: string;
  prompt: string;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRunLogEntry = {
  id: string;
  ts: string;
  level: string;
  message: string;
  eventType?: string;
};

export type AutomationRun = {
  id: string;
  automationId: string;
  automationTitle: string;
  workspaceId: string;
  workspaceName: string;
  threadId?: string;
  turnId?: string;
  trigger: string;
  status: string;
  summary?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string | null;
  logs: AutomationRunLogEntry[];
};

export type NotificationItem = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  automationId?: string;
  automationTitle?: string;
  runId?: string;
  botConnectionId?: string;
  botConnectionName?: string;
  kind: string;
  title: string;
  message: string;
  level: string;
  read: boolean;
  createdAt: string;
  readAt?: string | null;
};

export type BotConnection = {
  id: string;
  botId?: string;
  workspaceId: string;
  provider: string;
  name: string;
  status: string;
  aiBackend: string;
  aiConfig?: Record<string, string> | null;
  settings?: Record<string, string> | null;
  capabilities?: string[] | null;
  secretKeys?: string[] | null;
  lastError?: string | null;
  lastPollAt?: string | null;
  lastPollStatus?: string | null;
  lastPollMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Bot = {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  status: string;
  defaultBindingId?: string | null;
  defaultBindingMode?: string | null;
  defaultTargetWorkspaceId?: string | null;
  defaultTargetThreadId?: string | null;
  endpointCount: number;
  conversationCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BotBinding = {
  id: string;
  workspaceId: string;
  botId: string;
  name: string;
  bindingMode: string;
  targetWorkspaceId?: string | null;
  targetThreadId?: string | null;
  aiBackend: string;
  aiConfig?: Record<string, string> | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BotMessageMedia = {
  kind: string;
  path?: string | null;
  url?: string | null;
  fileName?: string | null;
  contentType?: string | null;
};

export type BotReplyMessage = {
  text?: string | null;
  media?: BotMessageMedia[] | null;
};

export type BotConnectionLogEntry = {
  id: string;
  workspaceId: string;
  connectionId: string;
  ts: string;
  level: string;
  eventType?: string;
  message: string;
};

export type BotConversation = {
  id: string;
  botId?: string;
  bindingId?: string;
  resolvedBindingId?: string;
  resolvedBindingMode?: string;
  resolvedTargetWorkspaceId?: string;
  resolvedTargetThreadId?: string;
  workspaceId: string;
  connectionId: string;
  provider: string;
  externalConversationId?: string;
  externalChatId: string;
  externalThreadId?: string;
  externalUserId?: string;
  externalUsername?: string;
  externalTitle?: string;
  threadId?: string;
  backendState?: Record<string, string> | null;
  lastInboundMessageId?: string;
  lastInboundText?: string;
  lastOutboundText?: string;
  lastOutboundDeliveryStatus?: string;
  lastOutboundDeliveryError?: string;
  lastOutboundDeliveryAttemptCount?: number;
  lastOutboundDeliveredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type BotDeliveryTarget = {
  id: string;
  botId: string;
  endpointId: string;
  sessionId?: string | null;
  provider: string;
  targetType: string;
  routeType?: string | null;
  routeKey?: string | null;
  title?: string | null;
  labels?: string[] | null;
  capabilities?: string[] | null;
  providerState?: Record<string, string> | null;
  status: string;
  deliveryReadiness?: string | null;
  deliveryReadinessMessage?: string | null;
  lastContextSeenAt?: string | null;
  lastVerifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ThreadBotBinding = {
  id: string;
  workspaceId: string;
  threadId: string;
  botWorkspaceId?: string | null;
  botId: string;
  botName: string;
  deliveryTargetId: string;
  deliveryTargetTitle?: string | null;
  endpointId: string;
  provider: string;
  sessionId?: string | null;
  deliveryReadiness?: string | null;
  deliveryReadinessMessage?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type BotTrigger = {
  id: string;
  workspaceId: string;
  botId: string;
  type: string;
  deliveryTargetId: string;
  filter?: Record<string, string> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BotOutboundDelivery = {
  id: string;
  botId: string;
  endpointId: string;
  sessionId?: string | null;
  deliveryTargetId?: string | null;
  runId?: string | null;
  triggerId?: string | null;
  sourceType: string;
  sourceRefType?: string | null;
  sourceRefId?: string | null;
  originWorkspaceId?: string | null;
  originThreadId?: string | null;
  originTurnId?: string | null;
  messages?: BotReplyMessage[] | null;
  status: string;
  attemptCount?: number;
  idempotencyKey?: string | null;
  providerMessageIds?: string[] | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string | null;
};

export type WeChatLogin = {
  loginId: string;
  status: string;
  baseUrl?: string;
  qrCodeContent?: string;
  accountId?: string;
  userId?: string;
  botToken?: string;
  credentialReady: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

export type WeChatAccount = {
  id: string;
  workspaceId: string;
  alias?: string;
  note?: string;
  baseUrl: string;
  accountId: string;
  userId: string;
  lastLoginId?: string;
  lastConfirmedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Thread = {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  archived: boolean;
  sessionStartSource?: string;
  turnCount?: number;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type ThreadListPage = {
  data: Thread[];
  nextCursor?: string | null;
};

export type ThreadTurn = {
  id: string;
  status: string;
  items: Record<string, unknown>[];
  error?: unknown;
};

export type ThreadDetail = Thread & {
  cwd?: string;
  hasMoreTurns?: boolean;
  messageCount?: number;
  preview?: string;
  path?: string;
  source?: string;
  tokenUsage?: ThreadTokenUsage | null;
  turnCount?: number;
  turns: ThreadTurn[];
};

export type ThreadTurnItemOutput = {
  itemId: string;
  command?: string;
  aggregatedOutput: string;
  outputLineCount?: number;
  outputContentMode?: string;
  outputStartLine?: number;
  outputEndLine?: number;
  outputStartOffset?: number;
  outputEndOffset?: number;
  outputTotalLength?: number;
  outputTruncated?: boolean;
};

export type TurnPolicyDecision = {
  id: string;
  workspaceId: string;
  threadId: string;
  turnId?: string;
  itemId?: string;
  triggerMethod: string;
  policyName: string;
  fingerprint: string;
  verdict: string;
  action: string;
  actionStatus: string;
  actionTurnId?: string;
  reason: string;
  evidenceSummary?: string;
  governanceLayer?: string;
  hookRunId?: string;
  source?: string;
  error?: string;
  evaluationStartedAt: string;
  decisionAt: string;
  completedAt: string;
};

export type HookOutputEntry = {
  kind: string;
  text: string;
};

export type HookRun = {
  id: string;
  workspaceId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  eventName: string;
  handlerKey: string;
  handlerType?: string;
  provider?: string;
  executionMode?: string;
  scope?: string;
  triggerMethod?: string;
  sessionStartSource?: string;
  toolKind?: string;
  toolName?: string;
  status: string;
  decision?: string;
  reason?: string;
  fingerprint?: string;
  additionalContext?: string;
  updatedInput?: unknown;
  entries?: HookOutputEntry[] | null;
  source?: string;
  error?: string;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
};

export type TurnPolicyMetricsSummary = {
  workspaceId: string;
  threadId?: string;
  source?: string;
  generatedAt?: string;
  config?: {
    postToolUseFailedValidationPolicyEnabled: boolean;
    stopMissingSuccessfulVerificationPolicyEnabled: boolean;
    postToolUsePrimaryAction?: string;
    stopMissingSuccessfulVerificationPrimaryAction?: string;
    postToolUseInterruptNoActiveTurnBehavior?: string;
    stopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior?: string;
    validationCommandPrefixes?: string[];
    followUpCooldownMs: number;
    postToolUseFollowUpCooldownMs: number;
    stopMissingSuccessfulVerificationFollowUpCooldownMs: number;
  };
  alerts?: TurnPolicyMetricAlert[];
  alertPolicy?: {
    suppressedCodes?: string[];
    suppressedCount?: number;
    acknowledgedCodes?: string[];
    acknowledgedCount?: number;
    snoozedCodes?: string[];
    snoozedCount?: number;
    snoozeUntil?: string;
  };
  recentWindows?: {
    lastHour?: TurnPolicyMetricsRecentWindow;
    last24Hours?: TurnPolicyMetricsRecentWindow;
  };
  history?: TurnPolicyMetricsHistorySummary;
  decisions: {
    total: number;
    actionAttempts: number;
    actionSucceeded: number;
    actionSuccessRate: number;
    actionStatusCounts: {
      succeeded: number;
      failed: number;
      skipped: number;
      other: number;
    };
    actionCounts: {
      steer: number;
      followUp: number;
      interrupt: number;
      none: number;
      other: number;
    };
    policyCounts: {
      failedValidationCommand: number;
      missingSuccessfulVerification: number;
      other: number;
    };
    skipReasonCounts: {
      total: number;
      duplicateFingerprint: number;
      followUpCooldownActive: number;
      interruptNoActiveTurn: number;
      other: number;
    };
  };
  sources: {
    interactive: {
      total: number;
      actionAttempts: number;
      actionSucceeded: number;
      actionSuccessRate: number;
      skipped: number;
    };
    automation: {
      total: number;
      actionAttempts: number;
      actionSucceeded: number;
      actionSuccessRate: number;
      skipped: number;
    };
    bot: {
      total: number;
      actionAttempts: number;
      actionSucceeded: number;
      actionSuccessRate: number;
      skipped: number;
    };
    other: {
      total: number;
      actionAttempts: number;
      actionSucceeded: number;
      actionSuccessRate: number;
      skipped: number;
    };
  };
  turns: {
    completedWithFileChange: number;
    missingSuccessfulVerification: number;
    missingSuccessfulVerificationRate: number;
    failedValidationCommand: number;
    failedValidationWithPolicyAction: number;
    failedValidationWithPolicyActionRate: number;
  };
  audit: {
    coveredTurns: number;
    eligibleTurns: number;
    coverageRate: number;
    coverageDefinition: string;
  };
  timings: {
    postToolUseDecisionLatency: {
      p50Ms: number;
      p95Ms: number;
    };
    stopDecisionLatency: {
      p50Ms: number;
      p95Ms: number;
    };
  };
};

export type TurnPolicyMetricAlert = {
  code: string;
  severity: "warning" | "info";
  title: string;
  message: string;
  acknowledged?: boolean;
  rank?: number;
  source?: string;
  actionStatus?: string;
  reason?: string;
};

export type TurnPolicyMetricsRecentWindow = {
  label?: string;
  decisions: {
    total: number;
    actionAttempts: number;
    actionSucceeded: number;
    actionSuccessRate: number;
    skipped: number;
  };
  alerts: {
    total: number;
  };
  timings: {
    postToolUseDecisionLatency: {
      p95Ms: number;
    };
    stopDecisionLatency: {
      p95Ms: number;
    };
  };
};

export type TurnPolicyMetricsHistorySummary = {
  dailyLast7Days: TurnPolicyMetricsHistoryBucket[];
  dailyLast30Days: TurnPolicyMetricsHistoryBucket[];
  dailyLast90Days: TurnPolicyMetricsHistoryBucket[];
  weeklyLast12Weeks: TurnPolicyMetricsHistoryBucket[];
};

export type TurnPolicyMetricsHistoryBucket = {
  since: string;
  until: string;
  alertsCount: number;
  decisions: {
    total: number;
    actionAttempts: number;
    actionSucceeded: number;
    actionSuccessRate: number;
    skipped: number;
  };
  timings: {
    postToolUseDecisionLatency: {
      p50Ms: number;
      p95Ms: number;
    };
    stopDecisionLatency: {
      p50Ms: number;
      p95Ms: number;
    };
  };
};

export type PendingApproval = {
  id: string;
  workspaceId: string;
  threadId: string;
  kind: string;
  summary: string;
  status: string;
  actions: string[];
  details?: ApprovalDetails | null;
  requestedAt: string;
};

export type ApprovalOption = {
  label: string;
  description: string;
};

export type ApprovalQuestion = {
  header: string;
  id: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: ApprovalOption[] | null;
};

export type ApprovalDetails = {
  itemId?: string;
  threadId?: string;
  turnId?: string;
  callId?: string;
  tool?: string;
  arguments?: unknown;
  previousAccountId?: string;
  serverName?: string;
  reason?: string;
  message?: string;
  mode?: string;
  url?: string;
  questions?: ApprovalQuestion[];
  requestedSchema?: Record<string, unknown>;
  [key: string]: unknown;
};

export type Account = {
  id: string;
  email: string;
  status: string;
  lastSyncedAt: string;
};

export type AccountLoginResult = {
  type: string;
  status: string;
  authUrl?: string;
  loginId?: string;
  message?: string;
};

export type AccountCancelLoginResult = {
  status: string;
};

export type McpOauthLoginResult = {
  authorizationUrl: string;
};

export type RateLimit = {
  name: string;
  limit: number;
  remaining: number;
  resetsAt: string;
};

export type CatalogItem = {
  id: string;
  name: string;
  description: string;
  value?: string;
  shellType?: string;
};

export type PluginCatalogItem = {
  id: string;
  name: string;
  description: string;
  marketplaceName: string;
  marketplacePath?: string;
  installed: boolean;
  enabled: boolean;
  authPolicy?: string;
  installPolicy?: string;
  sourceType?: string;
  sourcePath?: string;
  capabilities?: string[] | null;
  category?: string | null;
  brandColor?: string | null;
};

export type PluginListResult = {
  plugins: PluginCatalogItem[];
  remoteSyncError?: string | null;
};

export type PluginDetailResult = {
  plugin: Record<string, unknown>;
};

export type PluginInstallResult = {
  appsNeedingAuth: Array<Record<string, unknown>>;
  authPolicy: string;
};

export type ConfigReadResult = {
  config: Record<string, unknown>;
  origins: Record<string, unknown>;
  layers?: unknown[] | null;
};

export type ConfigWriteResult = {
  filePath: string;
  status: string;
  version: string;
  overriddenMetadata?: Record<string, unknown> | null;
  runtimeReloadRequired?: boolean;
  matchedRuntimeSensitiveKey?: string;
};

export type ConfigRequirementsResult = {
  requirements?: Record<string, unknown> | null;
};

export type RuntimePreferencesResult = {
  configuredModelCatalogPath: string;
  configuredDefaultShellType: string;
  configuredDefaultTerminalShell: string;
  supportedTerminalShells: string[];
  configuredModelShellTypeOverrides: Record<string, string>;
  configuredOutboundProxyUrl: string;
  configuredHookSessionStartEnabled?: boolean | null;
  configuredHookSessionStartContextPaths?: string[];
  configuredHookSessionStartMaxChars?: number | null;
  configuredHookUserPromptSubmitBlockSecretPasteEnabled?: boolean | null;
  configuredHookPreToolUseBlockDangerousCommandEnabled?: boolean | null;
  configuredHookPreToolUseAdditionalProtectedGovernancePaths?: string[];
  configuredTurnPolicyPostToolUseFailedValidationEnabled?: boolean | null;
  configuredTurnPolicyStopMissingSuccessfulVerificationEnabled?: boolean | null;
  configuredTurnPolicyFollowUpCooldownMs?: number | null;
  configuredTurnPolicyPostToolUseFollowUpCooldownMs?: number | null;
  configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs?:
    | number
    | null;
  configuredTurnPolicyPostToolUsePrimaryAction?: string;
  configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction?: string;
  configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior?: string;
  configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior?: string;
  configuredTurnPolicyValidationCommandPrefixes?: string[];
  configuredTurnPolicyAlertCoverageThresholdPercent?: number | null;
  configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs?: number | null;
  configuredTurnPolicyAlertStopLatencyP95ThresholdMs?: number | null;
  configuredTurnPolicyAlertSourceActionSuccessThresholdPercent?: number | null;
  configuredTurnPolicyAlertSuppressedCodes?: string[];
  configuredTurnPolicyAlertAcknowledgedCodes?: string[];
  configuredTurnPolicyAlertSnoozedCodes?: string[];
  configuredTurnPolicyAlertSnoozeUntil?: string | null;
  configuredTurnPolicyAlertSnoozeActive: boolean;
  configuredTurnPolicyAlertSnoozeExpired: boolean;
  turnPolicyAlertGovernanceHistory?: TurnPolicyAlertGovernanceEvent[];
  configuredDefaultTurnApprovalPolicy: string;
  configuredDefaultTurnSandboxPolicy?: Record<string, unknown> | null;
  configuredDefaultCommandSandboxPolicy?: Record<string, unknown> | null;
  configuredAllowRemoteAccess?: boolean | null;
  configuredAllowLocalhostWithoutAccessToken?: boolean | null;
  configuredAccessTokens: AccessTokenDescriptor[];
  configuredBackendThreadTraceEnabled?: boolean | null;
  configuredBackendThreadTraceWorkspaceId: string;
  configuredBackendThreadTraceThreadId: string;
  defaultModelCatalogPath: string;
  defaultDefaultShellType: string;
  defaultDefaultTerminalShell: string;
  defaultModelShellTypeOverrides: Record<string, string>;
  defaultOutboundProxyUrl: string;
  defaultHookSessionStartEnabled?: boolean;
  defaultHookSessionStartContextPaths?: string[];
  defaultHookSessionStartMaxChars?: number;
  defaultHookUserPromptSubmitBlockSecretPasteEnabled?: boolean;
  defaultHookPreToolUseBlockDangerousCommandEnabled?: boolean;
  defaultHookPreToolUseProtectedGovernancePaths?: string[];
  defaultTurnPolicyPostToolUseFailedValidationEnabled: boolean;
  defaultTurnPolicyStopMissingSuccessfulVerificationEnabled: boolean;
  defaultTurnPolicyFollowUpCooldownMs: number;
  defaultTurnPolicyPostToolUseFollowUpCooldownMs: number;
  defaultTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: number;
  defaultTurnPolicyPostToolUsePrimaryAction: string;
  defaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction: string;
  defaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: string;
  defaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: string;
  defaultTurnPolicyValidationCommandPrefixes?: string[];
  defaultTurnPolicyAlertCoverageThresholdPercent: number;
  defaultTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: number;
  defaultTurnPolicyAlertStopLatencyP95ThresholdMs: number;
  defaultTurnPolicyAlertSourceActionSuccessThresholdPercent: number;
  defaultTurnPolicyAlertSuppressedCodes: string[];
  defaultTurnPolicyAlertAcknowledgedCodes: string[];
  defaultTurnPolicyAlertSnoozedCodes: string[];
  defaultTurnPolicyAlertSnoozeUntil?: string | null;
  defaultDefaultTurnApprovalPolicy: string;
  defaultDefaultTurnSandboxPolicy?: Record<string, unknown> | null;
  defaultDefaultCommandSandboxPolicy?: Record<string, unknown> | null;
  defaultAllowRemoteAccess: boolean;
  defaultAllowLocalhostWithoutAccessToken: boolean;
  defaultBackendThreadTraceEnabled: boolean;
  defaultBackendThreadTraceWorkspaceId: string;
  defaultBackendThreadTraceThreadId: string;
  effectiveModelCatalogPath: string;
  effectiveDefaultShellType: string;
  effectiveDefaultTerminalShell: string;
  effectiveModelShellTypeOverrides: Record<string, string>;
  effectiveOutboundProxyUrl: string;
  effectiveHookSessionStartEnabled?: boolean;
  effectiveHookSessionStartContextPaths?: string[];
  effectiveHookSessionStartMaxChars?: number;
  effectiveHookUserPromptSubmitBlockSecretPasteEnabled?: boolean;
  effectiveHookPreToolUseBlockDangerousCommandEnabled?: boolean;
  effectiveHookPreToolUseProtectedGovernancePaths?: string[];
  effectiveTurnPolicyPostToolUseFailedValidationEnabled: boolean;
  effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled: boolean;
  effectiveTurnPolicyFollowUpCooldownMs: number;
  effectiveTurnPolicyPostToolUseFollowUpCooldownMs: number;
  effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: number;
  effectiveTurnPolicyPostToolUsePrimaryAction: string;
  effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction: string;
  effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: string;
  effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: string;
  effectiveTurnPolicyValidationCommandPrefixes?: string[];
  effectiveTurnPolicyAlertCoverageThresholdPercent: number;
  effectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: number;
  effectiveTurnPolicyAlertStopLatencyP95ThresholdMs: number;
  effectiveTurnPolicyAlertSourceActionSuccessThresholdPercent: number;
  effectiveTurnPolicyAlertSuppressedCodes: string[];
  effectiveTurnPolicyAlertAcknowledgedCodes: string[];
  effectiveTurnPolicyAlertSnoozedCodes: string[];
  effectiveTurnPolicyAlertSnoozeUntil?: string | null;
  effectiveDefaultTurnApprovalPolicy: string;
  effectiveDefaultTurnSandboxPolicy?: Record<string, unknown> | null;
  effectiveDefaultCommandSandboxPolicy?: Record<string, unknown> | null;
  effectiveAllowRemoteAccess: boolean;
  effectiveAllowLocalhostWithoutAccessToken: boolean;
  effectiveBackendThreadTraceEnabled: boolean;
  effectiveBackendThreadTraceWorkspaceId: string;
  effectiveBackendThreadTraceThreadId: string;
  effectiveCommand: string;
};

export type WorkspaceHookConfigurationResult = {
  workspaceId: string;
  workspaceRootPath: string;
  loadStatus: string;
  loadError?: string | null;
  loadedFromPath?: string;
  searchedPaths?: string[];
  baselineHookSessionStartEnabled?: boolean | null;
  baselineHookSessionStartContextPaths?: string[];
  baselineHookSessionStartMaxChars?: number | null;
  baselineHookUserPromptSubmitBlockSecretPasteEnabled?: boolean | null;
  baselineHookPreToolUseBlockDangerousCommandEnabled?: boolean | null;
  baselineHookPreToolUseAdditionalProtectedGovernancePaths?: string[];
  configuredHookSessionStartEnabled?: boolean | null;
  configuredHookSessionStartContextPaths?: string[];
  configuredHookSessionStartMaxChars?: number | null;
  configuredHookUserPromptSubmitBlockSecretPasteEnabled?: boolean | null;
  configuredHookPreToolUseBlockDangerousCommandEnabled?: boolean | null;
  configuredHookPreToolUseAdditionalProtectedGovernancePaths?: string[];
  effectiveHookSessionStartEnabled?: boolean;
  effectiveHookSessionStartContextPaths?: string[];
  effectiveHookSessionStartMaxChars?: number;
  effectiveHookUserPromptSubmitBlockSecretPasteEnabled?: boolean;
  effectiveHookPreToolUseBlockDangerousCommandEnabled?: boolean;
  effectiveHookPreToolUseProtectedGovernancePaths?: string[];
  effectiveHookSessionStartEnabledSource?: string;
  effectiveHookSessionStartContextPathsSource?: string;
  effectiveHookSessionStartMaxCharsSource?: string;
  effectiveHookUserPromptSubmitBlockSecretPasteSource?: string;
  effectiveHookPreToolUseDangerousCommandBlockSource?: string;
  effectiveHookPreToolUseProtectedGovernancePathsSource?: string;
};

export type WorkspaceHookConfigurationWriteResult = {
  status: string;
  filePath?: string;
  configuration: WorkspaceHookConfigurationResult;
};

export type TurnPolicyAlertGovernanceEvent = {
  id: string;
  action: string;
  source?: string;
  codes?: string[];
  snoozeUntil?: string | null;
  createdAt: string;
};

export type AccessTokenDescriptor = {
  id: string;
  label?: string;
  tokenPreview: string;
  expiresAt?: string | null;
  permanent: boolean;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AccessBootstrapResult = {
  authenticated: boolean;
  loginRequired: boolean;
  allowRemoteAccess: boolean;
  allowLocalhostWithoutAccessToken: boolean;
  configuredTokenCount: number;
  activeTokenCount: number;
};

export type ExternalAgentConfigDetectResult = {
  items: Array<Record<string, unknown>>;
};

export type FeedbackUploadResult = {
  threadId: string;
};

export type CollaborationMode = {
  id: string;
  name: string;
  description: string;
  mode?: string;
  model?: string;
  reasoningEffort?: string | null;
};

export type TokenUsageBreakdown = {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type ThreadTokenUsage = {
  last: TokenUsageBreakdown;
  total: TokenUsageBreakdown;
  modelContextWindow?: number | null;
};

export type ServerEvent = {
  workspaceId: string;
  threadId?: string;
  turnId?: string;
  method: string;
  payload: unknown;
  serverRequestId?: string | null;
  ts: string;
};

export type TurnResult = {
  turnId: string;
  status: string;
};

export type CommandSession = {
  id: string;
  workspaceId: string;
  command: string;
  mode?: string;
  shellPath?: string;
  initialCwd?: string;
  currentCwd?: string;
  shellState?: string;
  lastExitCode?: number | null;
  status: string;
  createdAt: string;
};

export type CommandSessionSnapshot = CommandSession & {
  archived?: boolean;
  combinedOutput: string;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  error?: string | null;
  pinned?: boolean;
  updatedAt: string;
};
