package store

import (
	"fmt"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type Workspace struct {
	ID                     string     `json:"id"`
	Name                   string     `json:"name"`
	RootPath               string     `json:"rootPath"`
	RuntimeStatus          string     `json:"runtimeStatus"`
	RuntimeConfigChangedAt *time.Time `json:"runtimeConfigChangedAt,omitempty"`
	CreatedAt              time.Time  `json:"createdAt"`
	UpdatedAt              time.Time  `json:"updatedAt"`
}

type AccessToken struct {
	ID           string     `json:"id"`
	Label        string     `json:"label,omitempty"`
	TokenHash    string     `json:"tokenHash"`
	TokenPreview string     `json:"tokenPreview,omitempty"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt,omitempty"`
	UpdatedAt    time.Time  `json:"updatedAt,omitempty"`
}

type RuntimePreferences struct {
	ModelCatalogPath                                                         string                           `json:"modelCatalogPath"`
	LocalShellModels                                                         []string                         `json:"localShellModels,omitempty"`
	DefaultShellType                                                         string                           `json:"defaultShellType,omitempty"`
	DefaultTerminalShell                                                     string                           `json:"defaultTerminalShell,omitempty"`
	ModelShellTypeOverrides                                                  map[string]string                `json:"modelShellTypeOverrides,omitempty"`
	OutboundProxyURL                                                         string                           `json:"outboundProxyUrl,omitempty"`
	DefaultTurnApprovalPolicy                                                string                           `json:"defaultTurnApprovalPolicy,omitempty"`
	DefaultTurnSandboxPolicy                                                 map[string]any                   `json:"defaultTurnSandboxPolicy,omitempty"`
	DefaultCommandSandboxPolicy                                              map[string]any                   `json:"defaultCommandSandboxPolicy,omitempty"`
	HookSessionStartEnabled                                                  *bool                            `json:"hookSessionStartEnabled"`
	HookSessionStartContextPaths                                             []string                         `json:"hookSessionStartContextPaths,omitempty"`
	HookSessionStartMaxChars                                                 *int                             `json:"hookSessionStartMaxChars"`
	HookSessionStartTemplate                                                 *string                          `json:"hookSessionStartTemplate"`
	HookUserPromptSubmitBlockSecretPasteEnabled                              *bool                            `json:"hookUserPromptSubmitBlockSecretPasteEnabled"`
	HookPreToolUseBlockDangerousCommandEnabled                               *bool                            `json:"hookPreToolUseBlockDangerousCommandEnabled"`
	HookPreToolUseAdditionalProtectedGovernancePaths                         []string                         `json:"hookPreToolUseAdditionalProtectedGovernancePaths,omitempty"`
	TurnPolicyPostToolUseFailedValidationEnabled                             *bool                            `json:"turnPolicyPostToolUseFailedValidationEnabled"`
	TurnPolicyStopMissingSuccessfulVerificationEnabled                       *bool                            `json:"turnPolicyStopMissingSuccessfulVerificationEnabled"`
	TurnPolicyPostToolUsePrimaryAction                                       string                           `json:"turnPolicyPostToolUsePrimaryAction,omitempty"`
	TurnPolicyStopMissingSuccessfulVerificationPrimaryAction                 string                           `json:"turnPolicyStopMissingSuccessfulVerificationPrimaryAction,omitempty"`
	TurnPolicyPostToolUseInterruptNoActiveTurnBehavior                       string                           `json:"turnPolicyPostToolUseInterruptNoActiveTurnBehavior,omitempty"`
	TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior string                           `json:"turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,omitempty"`
	TurnPolicyValidationCommandPrefixes                                      []string                         `json:"turnPolicyValidationCommandPrefixes,omitempty"`
	TurnPolicyFollowUpCooldownMs                                             *int64                           `json:"turnPolicyFollowUpCooldownMs"`
	TurnPolicyPostToolUseFollowUpCooldownMs                                  *int64                           `json:"turnPolicyPostToolUseFollowUpCooldownMs"`
	TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs            *int64                           `json:"turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs"`
	TurnPolicyAlertCoverageThresholdPercent                                  *int                             `json:"turnPolicyAlertCoverageThresholdPercent"`
	TurnPolicyAlertPostToolUseLatencyP95ThresholdMs                          *int64                           `json:"turnPolicyAlertPostToolUseLatencyP95ThresholdMs"`
	TurnPolicyAlertStopLatencyP95ThresholdMs                                 *int64                           `json:"turnPolicyAlertStopLatencyP95ThresholdMs"`
	TurnPolicyAlertSourceActionSuccessThresholdPercent                       *int                             `json:"turnPolicyAlertSourceActionSuccessThresholdPercent"`
	TurnPolicyAlertSuppressedCodes                                           []string                         `json:"turnPolicyAlertSuppressedCodes,omitempty"`
	TurnPolicyAlertAcknowledgedCodes                                         []string                         `json:"turnPolicyAlertAcknowledgedCodes,omitempty"`
	TurnPolicyAlertSnoozedCodes                                              []string                         `json:"turnPolicyAlertSnoozedCodes,omitempty"`
	TurnPolicyAlertSnoozeUntil                                               *time.Time                       `json:"turnPolicyAlertSnoozeUntil,omitempty"`
	TurnPolicyAlertGovernanceHistory                                         []TurnPolicyAlertGovernanceEvent `json:"turnPolicyAlertGovernanceHistory,omitempty"`
	AllowRemoteAccess                                                        *bool                            `json:"allowRemoteAccess"`
	AllowLocalhostWithoutAccessToken                                         *bool                            `json:"allowLocalhostWithoutAccessToken"`
	AccessTokens                                                             []AccessToken                    `json:"accessTokens,omitempty"`
	BackendThreadTraceEnabled                                                *bool                            `json:"backendThreadTraceEnabled"`
	BackendThreadTraceWorkspaceID                                            string                           `json:"backendThreadTraceWorkspaceId,omitempty"`
	BackendThreadTraceThreadID                                               string                           `json:"backendThreadTraceThreadId,omitempty"`
	UpdatedAt                                                                time.Time                        `json:"updatedAt,omitempty"`
}

type FeishuUserToken struct {
	AccessToken           string     `json:"accessToken,omitempty"`
	RefreshToken          string     `json:"refreshToken,omitempty"`
	AccessTokenExpiresAt  *time.Time `json:"accessTokenExpiresAt,omitempty"`
	RefreshTokenExpiresAt *time.Time `json:"refreshTokenExpiresAt,omitempty"`
	Scopes                []string   `json:"scopes,omitempty"`
	OpenID                string     `json:"openId,omitempty"`
	UnionID               string     `json:"unionId,omitempty"`
	ObtainedAt            *time.Time `json:"obtainedAt,omitempty"`
}

type JobMCPConfig struct {
	WorkspaceID         string    `json:"workspaceId"`
	Enabled             bool      `json:"enabled"`
	ServerName          string    `json:"serverName,omitempty"`
	ManagedMCPAuthToken string    `json:"managedMcpAuthToken,omitempty"`
	ToolAllowlist       []string  `json:"toolAllowlist,omitempty"`
	UpdatedAt           time.Time `json:"updatedAt,omitempty"`
}

type FeishuToolsConfig struct {
	WorkspaceID         string          `json:"workspaceId"`
	Enabled             bool            `json:"enabled"`
	AppID               string          `json:"appId,omitempty"`
	AppSecret           string          `json:"appSecret,omitempty"`
	ManagedMCPAuthToken string          `json:"managedMcpAuthToken,omitempty"`
	MCPEndpoint         string          `json:"mcpEndpoint,omitempty"`
	OauthMode           string          `json:"oauthMode,omitempty"`
	SensitiveWriteGuard bool            `json:"sensitiveWriteGuard"`
	ToolAllowlist       []string        `json:"toolAllowlist,omitempty"`
	UserToken           FeishuUserToken `json:"userToken,omitempty"`
	UpdatedAt           time.Time       `json:"updatedAt,omitempty"`
}

type FeishuToolAuditRecord struct {
	ID            string    `json:"id"`
	WorkspaceID   string    `json:"workspaceId"`
	ThreadID      string    `json:"threadId,omitempty"`
	TurnID        string    `json:"turnId,omitempty"`
	InvocationID  string    `json:"invocationId,omitempty"`
	ToolName      string    `json:"toolName"`
	Action        string    `json:"action,omitempty"`
	ActionKey     string    `json:"actionKey,omitempty"`
	PrincipalType string    `json:"principalType,omitempty"`
	PrincipalID   string    `json:"principalId,omitempty"`
	Result        string    `json:"result"`
	ErrorCode     string    `json:"errorCode,omitempty"`
	ErrorMessage  string    `json:"errorMessage,omitempty"`
	StartedAt     time.Time `json:"startedAt"`
	CompletedAt   time.Time `json:"completedAt"`
	DurationMs    int64     `json:"durationMs"`
}

type FeishuToolAuditFilter struct {
	ToolName string `json:"toolName,omitempty"`
	Result   string `json:"result,omitempty"`
	Limit    int    `json:"limit,omitempty"`
}

type TurnPolicyAlertGovernanceEvent struct {
	ID          string     `json:"id"`
	Action      string     `json:"action"`
	Source      string     `json:"source,omitempty"`
	Codes       []string   `json:"codes,omitempty"`
	SnoozeUntil *time.Time `json:"snoozeUntil,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type Automation struct {
	ID            string     `json:"id"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Prompt        string     `json:"prompt"`
	WorkspaceID   string     `json:"workspaceId"`
	WorkspaceName string     `json:"workspaceName"`
	ThreadID      string     `json:"threadId,omitempty"`
	Schedule      string     `json:"schedule"`
	ScheduleLabel string     `json:"scheduleLabel"`
	Model         string     `json:"model"`
	Reasoning     string     `json:"reasoning"`
	Status        string     `json:"status"`
	NextRun       string     `json:"nextRun"`
	NextRunAt     *time.Time `json:"nextRunAt,omitempty"`
	LastRun       *time.Time `json:"lastRun"`
	JobID         string     `json:"jobId,omitempty"`
	ManagedBy     string     `json:"managedBy,omitempty"`
	JobStatus     string     `json:"jobStatus,omitempty"`
	JobExecutor   string     `json:"jobExecutor,omitempty"`
	LastRunStatus string     `json:"lastRunStatus,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type AutomationTemplate struct {
	ID          string    `json:"id"`
	Category    string    `json:"category"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Prompt      string    `json:"prompt"`
	IsBuiltIn   bool      `json:"isBuiltIn"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type AutomationRunLogEntry struct {
	ID        string    `json:"id"`
	TS        time.Time `json:"ts"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	EventType string    `json:"eventType,omitempty"`
}

type AutomationRun struct {
	ID              string                  `json:"id"`
	AutomationID    string                  `json:"automationId"`
	AutomationTitle string                  `json:"automationTitle"`
	WorkspaceID     string                  `json:"workspaceId"`
	WorkspaceName   string                  `json:"workspaceName"`
	ThreadID        string                  `json:"threadId,omitempty"`
	TurnID          string                  `json:"turnId,omitempty"`
	Trigger         string                  `json:"trigger"`
	Status          string                  `json:"status"`
	Summary         string                  `json:"summary,omitempty"`
	Error           string                  `json:"error,omitempty"`
	ErrorMeta       *ErrorMetadata          `json:"errorMeta,omitempty"`
	StartedAt       time.Time               `json:"startedAt"`
	FinishedAt      *time.Time              `json:"finishedAt,omitempty"`
	Logs            []AutomationRunLogEntry `json:"logs"`
}

type Notification struct {
	ID                string     `json:"id"`
	WorkspaceID       string     `json:"workspaceId"`
	WorkspaceName     string     `json:"workspaceName"`
	AutomationID      string     `json:"automationId,omitempty"`
	AutomationTitle   string     `json:"automationTitle,omitempty"`
	RunID             string     `json:"runId,omitempty"`
	BotConnectionID   string     `json:"botConnectionId,omitempty"`
	BotConnectionName string     `json:"botConnectionName,omitempty"`
	Kind              string     `json:"kind"`
	Title             string     `json:"title"`
	Message           string     `json:"message"`
	Level             string     `json:"level"`
	Read              bool       `json:"read"`
	CreatedAt         time.Time  `json:"createdAt"`
	ReadAt            *time.Time `json:"readAt,omitempty"`
}

type NotificationChannelBinding struct {
	Channel       string            `json:"channel"`
	TargetRefType string            `json:"targetRefType"`
	TargetRefID   string            `json:"targetRefId,omitempty"`
	TitleTemplate string            `json:"titleTemplate,omitempty"`
	BodyTemplate  string            `json:"bodyTemplate,omitempty"`
	Settings      map[string]string `json:"settings,omitempty"`
}

type NotificationSubscription struct {
	ID          string                       `json:"id"`
	WorkspaceID string                       `json:"workspaceId"`
	Topic       string                       `json:"topic"`
	SourceType  string                       `json:"sourceType,omitempty"`
	Filter      map[string]string            `json:"filter,omitempty"`
	Channels    []NotificationChannelBinding `json:"channels,omitempty"`
	Enabled     bool                         `json:"enabled"`
	CreatedAt   time.Time                    `json:"createdAt"`
	UpdatedAt   time.Time                    `json:"updatedAt"`
}

type NotificationEmailTarget struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	Name            string    `json:"name"`
	Emails          []string  `json:"emails,omitempty"`
	SubjectTemplate string    `json:"subjectTemplate,omitempty"`
	BodyTemplate    string    `json:"bodyTemplate,omitempty"`
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type NotificationMailServerConfig struct {
	WorkspaceID string    `json:"workspaceId"`
	Enabled     bool      `json:"enabled"`
	Host        string    `json:"host,omitempty"`
	Port        int       `json:"port,omitempty"`
	Username    string    `json:"username,omitempty"`
	Password    string    `json:"password,omitempty"`
	PasswordSet bool      `json:"passwordSet,omitempty"`
	From        string    `json:"from,omitempty"`
	RequireTLS  bool      `json:"requireTls"`
	SkipVerify  bool      `json:"skipVerify"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type BackgroundJob struct {
	ID            string         `json:"id"`
	WorkspaceID   string         `json:"workspaceId"`
	WorkspaceName string         `json:"workspaceName"`
	SourceType    string         `json:"sourceType,omitempty"`
	SourceRefID   string         `json:"sourceRefId,omitempty"`
	Name          string         `json:"name"`
	Description   string         `json:"description"`
	ExecutorKind  string         `json:"executorKind"`
	Schedule      string         `json:"schedule,omitempty"`
	ScheduleLabel string         `json:"scheduleLabel,omitempty"`
	Status        string         `json:"status"`
	Payload       map[string]any `json:"payload,omitempty"`
	LastRunID     string         `json:"lastRunId,omitempty"`
	LastRunStatus string         `json:"lastRunStatus,omitempty"`
	LastError     string         `json:"lastError,omitempty"`
	LastErrorMeta *ErrorMetadata `json:"lastErrorMeta,omitempty"`
	LastRunAt     *time.Time     `json:"lastRunAt,omitempty"`
	NextRunAt     *time.Time     `json:"nextRunAt,omitempty"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}

type BackgroundJobRunLogEntry struct {
	ID        string    `json:"id"`
	TS        time.Time `json:"ts"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	EventType string    `json:"eventType,omitempty"`
}

type BackgroundJobRun struct {
	ID            string                     `json:"id"`
	JobID         string                     `json:"jobId"`
	JobName       string                     `json:"jobName"`
	WorkspaceID   string                     `json:"workspaceId"`
	WorkspaceName string                     `json:"workspaceName"`
	ExecutorKind  string                     `json:"executorKind"`
	Trigger       string                     `json:"trigger"`
	Status        string                     `json:"status"`
	Output        map[string]any             `json:"output,omitempty"`
	Summary       string                     `json:"summary,omitempty"`
	Error         string                     `json:"error,omitempty"`
	ErrorMeta     *ErrorMetadata             `json:"errorMeta,omitempty"`
	StartedAt     time.Time                  `json:"startedAt"`
	FinishedAt    *time.Time                 `json:"finishedAt,omitempty"`
	Logs          []BackgroundJobRunLogEntry `json:"logs"`
}

type ErrorMetadata struct {
	Code      string            `json:"code,omitempty"`
	Category  string            `json:"category,omitempty"`
	Retryable *bool             `json:"retryable,omitempty"`
	Details   map[string]string `json:"details,omitempty"`
}

type NotificationDispatch struct {
	ID                    string     `json:"id"`
	WorkspaceID           string     `json:"workspaceId"`
	SubscriptionID        string     `json:"subscriptionId,omitempty"`
	EventKey              string     `json:"eventKey"`
	DedupKey              string     `json:"dedupKey,omitempty"`
	Topic                 string     `json:"topic"`
	SourceType            string     `json:"sourceType,omitempty"`
	SourceRefType         string     `json:"sourceRefType,omitempty"`
	SourceRefID           string     `json:"sourceRefId,omitempty"`
	Channel               string     `json:"channel"`
	TargetRefType         string     `json:"targetRefType"`
	TargetRefID           string     `json:"targetRefId,omitempty"`
	Title                 string     `json:"title,omitempty"`
	Message               string     `json:"message,omitempty"`
	Level                 string     `json:"level,omitempty"`
	Status                string     `json:"status"`
	Error                 string     `json:"error,omitempty"`
	AttemptCount          int        `json:"attemptCount,omitempty"`
	NotificationID        string     `json:"notificationId,omitempty"`
	BotOutboundDeliveryID string     `json:"botOutboundDeliveryId,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
	DeliveredAt           *time.Time `json:"deliveredAt,omitempty"`
}

type NotificationDispatchFilter struct {
	SubscriptionID string `json:"subscriptionId,omitempty"`
	Topic          string `json:"topic,omitempty"`
	Channel        string `json:"channel,omitempty"`
	Status         string `json:"status,omitempty"`
	TargetRefType  string `json:"targetRefType,omitempty"`
	TargetRefID    string `json:"targetRefId,omitempty"`
	SourceRefType  string `json:"sourceRefType,omitempty"`
	SourceRefID    string `json:"sourceRefId,omitempty"`
	EventKey       string `json:"eventKey,omitempty"`
}

type TurnPolicyDecision struct {
	ID                  string    `json:"id"`
	WorkspaceID         string    `json:"workspaceId"`
	ThreadID            string    `json:"threadId"`
	TurnID              string    `json:"turnId,omitempty"`
	ItemID              string    `json:"itemId,omitempty"`
	TriggerMethod       string    `json:"triggerMethod"`
	PolicyName          string    `json:"policyName"`
	Fingerprint         string    `json:"fingerprint"`
	Verdict             string    `json:"verdict"`
	Action              string    `json:"action"`
	ActionStatus        string    `json:"actionStatus"`
	ActionTurnID        string    `json:"actionTurnId,omitempty"`
	Reason              string    `json:"reason"`
	EvidenceSummary     string    `json:"evidenceSummary,omitempty"`
	GovernanceLayer     string    `json:"governanceLayer,omitempty"`
	HookRunID           string    `json:"hookRunId,omitempty"`
	Source              string    `json:"source,omitempty"`
	Error               string    `json:"error,omitempty"`
	EvaluationStartedAt time.Time `json:"evaluationStartedAt"`
	DecisionAt          time.Time `json:"decisionAt"`
	CompletedAt         time.Time `json:"completedAt"`
}

type HookOutputEntry struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type HookRun struct {
	ID                 string            `json:"id"`
	WorkspaceID        string            `json:"workspaceId"`
	ThreadID           string            `json:"threadId,omitempty"`
	TurnID             string            `json:"turnId,omitempty"`
	ItemID             string            `json:"itemId,omitempty"`
	EventName          string            `json:"eventName"`
	HandlerKey         string            `json:"handlerKey"`
	HandlerType        string            `json:"handlerType,omitempty"`
	Provider           string            `json:"provider,omitempty"`
	ExecutionMode      string            `json:"executionMode,omitempty"`
	Scope              string            `json:"scope,omitempty"`
	TriggerMethod      string            `json:"triggerMethod,omitempty"`
	SessionStartSource string            `json:"sessionStartSource,omitempty"`
	ToolKind           string            `json:"toolKind,omitempty"`
	ToolName           string            `json:"toolName,omitempty"`
	Status             string            `json:"status"`
	Decision           string            `json:"decision,omitempty"`
	Reason             string            `json:"reason,omitempty"`
	Fingerprint        string            `json:"fingerprint,omitempty"`
	AdditionalContext  string            `json:"additionalContext,omitempty"`
	UpdatedInput       any               `json:"updatedInput,omitempty"`
	Entries            []HookOutputEntry `json:"entries,omitempty"`
	Source             string            `json:"source,omitempty"`
	Error              string            `json:"error,omitempty"`
	StartedAt          time.Time         `json:"startedAt"`
	CompletedAt        *time.Time        `json:"completedAt,omitempty"`
	DurationMs         *int64            `json:"durationMs,omitempty"`
}

type Bot struct {
	ID                 string    `json:"id"`
	WorkspaceID        string    `json:"workspaceId"`
	Scope              string    `json:"scope,omitempty"`
	SharingMode        string    `json:"sharingMode,omitempty"`
	SharedWorkspaceIDs []string  `json:"sharedWorkspaceIds,omitempty"`
	Name               string    `json:"name"`
	Description        string    `json:"description,omitempty"`
	Status             string    `json:"status"`
	DefaultBindingID   string    `json:"defaultBindingId,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type BotBinding struct {
	ID                string            `json:"id"`
	WorkspaceID       string            `json:"workspaceId"`
	BotID             string            `json:"botId"`
	Name              string            `json:"name"`
	BindingMode       string            `json:"bindingMode"`
	TargetWorkspaceID string            `json:"targetWorkspaceId,omitempty"`
	TargetThreadID    string            `json:"targetThreadId,omitempty"`
	AIBackend         string            `json:"aiBackend"`
	AIConfig          map[string]string `json:"aiConfig,omitempty"`
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
}

type ThreadBotBinding struct {
	ID               string    `json:"id"`
	WorkspaceID      string    `json:"workspaceId"`
	ThreadID         string    `json:"threadId"`
	BotWorkspaceID   string    `json:"botWorkspaceId,omitempty"`
	BotID            string    `json:"botId"`
	DeliveryTargetID string    `json:"deliveryTargetId"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type BotTrigger struct {
	ID               string            `json:"id"`
	WorkspaceID      string            `json:"workspaceId"`
	BotID            string            `json:"botId"`
	Type             string            `json:"type"`
	DeliveryTargetID string            `json:"deliveryTargetId"`
	Filter           map[string]string `json:"filter,omitempty"`
	Enabled          bool              `json:"enabled"`
	CreatedAt        time.Time         `json:"createdAt"`
	UpdatedAt        time.Time         `json:"updatedAt"`
}

type BotTriggerFilter struct {
	BotID            string `json:"botId,omitempty"`
	Type             string `json:"type,omitempty"`
	DeliveryTargetID string `json:"deliveryTargetId,omitempty"`
	Enabled          *bool  `json:"enabled,omitempty"`
}

type BotConnection struct {
	ID                    string            `json:"id"`
	BotID                 string            `json:"botId,omitempty"`
	WorkspaceID           string            `json:"workspaceId"`
	Provider              string            `json:"provider"`
	Name                  string            `json:"name"`
	Status                string            `json:"status"`
	AIBackend             string            `json:"aiBackend"`
	AIConfig              map[string]string `json:"aiConfig,omitempty"`
	Settings              map[string]string `json:"settings,omitempty"`
	Secrets               map[string]string `json:"secrets,omitempty"`
	LastError             string            `json:"lastError,omitempty"`
	LastPollAt            *time.Time        `json:"lastPollAt,omitempty"`
	LastPollStatus        string            `json:"lastPollStatus,omitempty"`
	LastPollMessage       string            `json:"lastPollMessage,omitempty"`
	LastPollMessageKey    string            `json:"lastPollMessageKey,omitempty"`
	LastPollMessageParams map[string]string `json:"lastPollMessageParams,omitempty"`
	CreatedAt             time.Time         `json:"createdAt"`
	UpdatedAt             time.Time         `json:"updatedAt"`
}

type BotConnectionLogEntry struct {
	ID            string            `json:"id"`
	WorkspaceID   string            `json:"workspaceId"`
	ConnectionID  string            `json:"connectionId"`
	TS            time.Time         `json:"ts"`
	Level         string            `json:"level"`
	EventType     string            `json:"eventType,omitempty"`
	Message       string            `json:"message"`
	MessageKey    string            `json:"messageKey,omitempty"`
	MessageParams map[string]string `json:"messageParams,omitempty"`
}

type WeChatAccount struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	Alias           string    `json:"alias,omitempty"`
	Note            string    `json:"note,omitempty"`
	BaseURL         string    `json:"baseUrl"`
	AccountID       string    `json:"accountId"`
	UserID          string    `json:"userId"`
	BotToken        string    `json:"botToken,omitempty"`
	LastLoginID     string    `json:"lastLoginId,omitempty"`
	LastConfirmedAt time.Time `json:"lastConfirmedAt"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type BotConversation struct {
	ID                               string            `json:"id"`
	BotID                            string            `json:"botId,omitempty"`
	BindingID                        string            `json:"bindingId,omitempty"`
	WorkspaceID                      string            `json:"workspaceId"`
	ConnectionID                     string            `json:"connectionId"`
	Provider                         string            `json:"provider"`
	ExternalConversationID           string            `json:"externalConversationId,omitempty"`
	ExternalChatID                   string            `json:"externalChatId"`
	ExternalThreadID                 string            `json:"externalThreadId,omitempty"`
	ExternalUserID                   string            `json:"externalUserId,omitempty"`
	ExternalUsername                 string            `json:"externalUsername,omitempty"`
	ExternalTitle                    string            `json:"externalTitle,omitempty"`
	ThreadID                         string            `json:"threadId,omitempty"`
	BackendState                     map[string]string `json:"backendState,omitempty"`
	ProviderState                    map[string]string `json:"providerState,omitempty"`
	LastInboundMessageID             string            `json:"lastInboundMessageId,omitempty"`
	LastInboundText                  string            `json:"lastInboundText,omitempty"`
	LastOutboundText                 string            `json:"lastOutboundText,omitempty"`
	LastOutboundDeliveryStatus       string            `json:"lastOutboundDeliveryStatus,omitempty"`
	LastOutboundDeliveryError        string            `json:"lastOutboundDeliveryError,omitempty"`
	LastOutboundDeliveryAttemptCount int               `json:"lastOutboundDeliveryAttemptCount,omitempty"`
	LastOutboundDeliveredAt          *time.Time        `json:"lastOutboundDeliveredAt,omitempty"`
	CreatedAt                        time.Time         `json:"createdAt"`
	UpdatedAt                        time.Time         `json:"updatedAt"`
}

type BotDeliveryTarget struct {
	ID             string            `json:"id"`
	WorkspaceID    string            `json:"workspaceId"`
	BotID          string            `json:"botId"`
	ConnectionID   string            `json:"connectionId"`
	ConversationID string            `json:"conversationId,omitempty"`
	Provider       string            `json:"provider"`
	TargetType     string            `json:"targetType"`
	RouteType      string            `json:"routeType,omitempty"`
	RouteKey       string            `json:"routeKey,omitempty"`
	Title          string            `json:"title,omitempty"`
	Labels         []string          `json:"labels,omitempty"`
	Capabilities   []string          `json:"capabilities,omitempty"`
	ProviderState  map[string]string `json:"providerState,omitempty"`
	Status         string            `json:"status"`
	LastVerifiedAt *time.Time        `json:"lastVerifiedAt,omitempty"`
	CreatedAt      time.Time         `json:"createdAt"`
	UpdatedAt      time.Time         `json:"updatedAt"`
}

type BotOutboundDelivery struct {
	ID                 string            `json:"id"`
	WorkspaceID        string            `json:"workspaceId"`
	BotID              string            `json:"botId"`
	ConnectionID       string            `json:"connectionId"`
	ConversationID     string            `json:"conversationId,omitempty"`
	DeliveryTargetID   string            `json:"deliveryTargetId,omitempty"`
	RunID              string            `json:"runId,omitempty"`
	TriggerID          string            `json:"triggerId,omitempty"`
	SourceType         string            `json:"sourceType"`
	SourceRefType      string            `json:"sourceRefType,omitempty"`
	SourceRefID        string            `json:"sourceRefId,omitempty"`
	OriginWorkspaceID  string            `json:"originWorkspaceId,omitempty"`
	OriginThreadID     string            `json:"originThreadId,omitempty"`
	OriginTurnID       string            `json:"originTurnId,omitempty"`
	Messages           []BotReplyMessage `json:"messages,omitempty"`
	Status             string            `json:"status"`
	AttemptCount       int               `json:"attemptCount,omitempty"`
	IdempotencyKey     string            `json:"idempotencyKey,omitempty"`
	ProviderMessageIDs []string          `json:"providerMessageIds,omitempty"`
	LastError          string            `json:"lastError,omitempty"`
	CreatedAt          time.Time         `json:"createdAt"`
	UpdatedAt          time.Time         `json:"updatedAt"`
	DeliveredAt        *time.Time        `json:"deliveredAt,omitempty"`
}

type BotOutboundDeliveryFilter struct {
	BotID            string `json:"botId,omitempty"`
	ConnectionID     string `json:"connectionId,omitempty"`
	ConversationID   string `json:"conversationId,omitempty"`
	DeliveryTargetID string `json:"deliveryTargetId,omitempty"`
	SourceType       string `json:"sourceType,omitempty"`
	SourceRefType    string `json:"sourceRefType,omitempty"`
	SourceRefID      string `json:"sourceRefId,omitempty"`
	Status           string `json:"status,omitempty"`
}

type BotMessageMedia struct {
	Kind        string `json:"kind"`
	Path        string `json:"path,omitempty"`
	URL         string `json:"url,omitempty"`
	FileName    string `json:"fileName,omitempty"`
	ContentType string `json:"contentType,omitempty"`
}

type BotReplyMessage struct {
	Text  string            `json:"text,omitempty"`
	Media []BotMessageMedia `json:"media,omitempty"`
}

type BotInboundDelivery struct {
	ID                        string            `json:"id"`
	WorkspaceID               string            `json:"workspaceId"`
	ConnectionID              string            `json:"connectionId"`
	Provider                  string            `json:"provider"`
	ExternalConversationID    string            `json:"externalConversationId,omitempty"`
	ExternalChatID            string            `json:"externalChatId"`
	ExternalThreadID          string            `json:"externalThreadId,omitempty"`
	MessageID                 string            `json:"messageId,omitempty"`
	UserID                    string            `json:"userId,omitempty"`
	Username                  string            `json:"username,omitempty"`
	Title                     string            `json:"title,omitempty"`
	Text                      string            `json:"text"`
	Media                     []BotMessageMedia `json:"media,omitempty"`
	ProviderData              map[string]string `json:"providerData,omitempty"`
	ReplyThreadID             string            `json:"replyThreadId,omitempty"`
	ReplyMessages             []BotReplyMessage `json:"replyMessages,omitempty"`
	ReplyTexts                []string          `json:"replyTexts,omitempty"`
	ReplyDeliveryStatus       string            `json:"replyDeliveryStatus,omitempty"`
	ReplyDeliveryAttemptCount int               `json:"replyDeliveryAttemptCount,omitempty"`
	ReplyDeliveryLastError    string            `json:"replyDeliveryLastError,omitempty"`
	ReplyDeliveredAt          *time.Time        `json:"replyDeliveredAt,omitempty"`
	Status                    string            `json:"status"`
	AttemptCount              int               `json:"attemptCount,omitempty"`
	LastError                 string            `json:"lastError,omitempty"`
	CreatedAt                 time.Time         `json:"createdAt"`
	UpdatedAt                 time.Time         `json:"updatedAt"`
}

type Thread struct {
	ID                 string    `json:"id"`
	WorkspaceID        string    `json:"workspaceId"`
	Cwd                string    `json:"cwd,omitempty"`
	Materialized       bool      `json:"materialized,omitempty"`
	Name               string    `json:"name"`
	Status             string    `json:"status"`
	Archived           bool      `json:"archived"`
	SessionStartSource string    `json:"sessionStartSource,omitempty"`
	TurnCount          int       `json:"turnCount,omitempty"`
	MessageCount       int       `json:"messageCount,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type DeletedThread struct {
	WorkspaceID string    `json:"workspaceId"`
	ThreadID    string    `json:"threadId"`
	DeletedAt   time.Time `json:"deletedAt"`
}

type ThreadTurn struct {
	ID     string           `json:"id"`
	Status string           `json:"status"`
	Items  []map[string]any `json:"items"`
	Error  any              `json:"error,omitempty"`
}

type TokenUsageBreakdown struct {
	CachedInputTokens     int64 `json:"cachedInputTokens"`
	InputTokens           int64 `json:"inputTokens"`
	OutputTokens          int64 `json:"outputTokens"`
	ReasoningOutputTokens int64 `json:"reasoningOutputTokens"`
	TotalTokens           int64 `json:"totalTokens"`
}

type ThreadTokenUsage struct {
	Last               TokenUsageBreakdown `json:"last"`
	Total              TokenUsageBreakdown `json:"total"`
	ModelContextWindow *int64              `json:"modelContextWindow,omitempty"`
}

type ThreadDetail struct {
	Thread
	Cwd          string            `json:"cwd,omitempty"`
	Preview      string            `json:"preview,omitempty"`
	Path         string            `json:"path,omitempty"`
	Source       string            `json:"source,omitempty"`
	TokenUsage   *ThreadTokenUsage `json:"tokenUsage,omitempty"`
	TurnCount    int               `json:"turnCount"`
	MessageCount int               `json:"messageCount,omitempty"`
	HasMoreTurns bool              `json:"hasMoreTurns,omitempty"`
	Turns        []ThreadTurn      `json:"turns"`
}

type ThreadProjection struct {
	WorkspaceID      string            `json:"workspaceId"`
	ThreadID         string            `json:"threadId"`
	Cwd              string            `json:"cwd,omitempty"`
	Preview          string            `json:"preview,omitempty"`
	Path             string            `json:"path,omitempty"`
	Source           string            `json:"source,omitempty"`
	Status           string            `json:"status,omitempty"`
	UpdatedAt        time.Time         `json:"updatedAt"`
	TokenUsage       *ThreadTokenUsage `json:"tokenUsage,omitempty"`
	TurnCount        int               `json:"turnCount,omitempty"`
	MessageCount     int               `json:"messageCount,omitempty"`
	SnapshotComplete bool              `json:"snapshotComplete,omitempty"`
	Turns            []ThreadTurn      `json:"turns"`
}

type ThreadProjectionWindow struct {
	Projection      ThreadProjection `json:"projection"`
	HasMore         bool             `json:"hasMore"`
	BeforeTurnFound bool             `json:"beforeTurnFound"`
	ReadSource      string           `json:"-"`
	ScannedTurns    int              `json:"-"`
}

type PendingApproval struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	ThreadID    string    `json:"threadId"`
	Kind        string    `json:"kind"`
	Summary     string    `json:"summary"`
	Status      string    `json:"status"`
	Actions     []string  `json:"actions"`
	Details     any       `json:"details,omitempty"`
	RequestedAt time.Time `json:"requestedAt"`
}

type Account struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Status       string    `json:"status"`
	AuthMode     string    `json:"authMode,omitempty"`
	PlanType     string    `json:"planType,omitempty"`
	LastSyncedAt time.Time `json:"lastSyncedAt"`
}

type RateLimitWindow struct {
	UsedPercent        int        `json:"usedPercent"`
	WindowDurationMins *int64     `json:"windowDurationMins,omitempty"`
	ResetsAt           *time.Time `json:"resetsAt,omitempty"`
}

type RateLimitCredits struct {
	HasCredits bool   `json:"hasCredits"`
	Unlimited  bool   `json:"unlimited"`
	Balance    string `json:"balance,omitempty"`
}

type RateLimit struct {
	LimitID   string            `json:"limitId,omitempty"`
	LimitName string            `json:"limitName,omitempty"`
	Primary   *RateLimitWindow  `json:"primary,omitempty"`
	Secondary *RateLimitWindow  `json:"secondary,omitempty"`
	Credits   *RateLimitCredits `json:"credits,omitempty"`
	PlanType  string            `json:"planType,omitempty"`
}

type CommandSession struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspaceId"`
	Command      string    `json:"command"`
	Mode         string    `json:"mode,omitempty"`
	ShellPath    string    `json:"shellPath,omitempty"`
	InitialCwd   string    `json:"initialCwd,omitempty"`
	CurrentCwd   string    `json:"currentCwd,omitempty"`
	ShellState   string    `json:"shellState,omitempty"`
	LastExitCode *int      `json:"lastExitCode,omitempty"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

type CommandSessionSnapshot struct {
	CommandSession
	Archived       bool      `json:"archived,omitempty"`
	CombinedOutput string    `json:"combinedOutput"`
	Stdout         string    `json:"stdout"`
	Stderr         string    `json:"stderr"`
	ExitCode       *int      `json:"exitCode,omitempty"`
	Error          string    `json:"error,omitempty"`
	Pinned         bool      `json:"pinned,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type EventEnvelope struct {
	Seq             uint64    `json:"seq,omitempty"`
	WorkspaceID     string    `json:"workspaceId"`
	ThreadID        string    `json:"threadId,omitempty"`
	TurnID          string    `json:"turnId,omitempty"`
	Method          string    `json:"method"`
	Payload         any       `json:"payload"`
	ServerRequestID *string   `json:"serverRequestId"`
	Replay          bool      `json:"replay,omitempty"`
	TS              time.Time `json:"ts"`
}

var idCounter atomic.Uint64

func NewID(prefix string) string {
	return fmt.Sprintf("%s_%06d", prefix, idCounter.Add(1))
}

func SeedIDCounter(minValue uint64) {
	for {
		current := idCounter.Load()
		if current >= minValue {
			return
		}

		if idCounter.CompareAndSwap(current, minValue) {
			return
		}
	}
}

func NumericIDSuffix(id string) uint64 {
	separatorIndex := strings.LastIndex(id, "_")
	if separatorIndex < 0 || separatorIndex == len(id)-1 {
		return 0
	}

	value, err := strconv.ParseUint(id[separatorIndex+1:], 10, 64)
	if err != nil {
		return 0
	}

	return value
}
