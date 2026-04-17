package bots

import (
	"context"
	"errors"
	"net/http"
	"time"

	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
)

var (
	ErrInvalidInput         = errors.New("invalid bot integration input")
	ErrProviderNotSupported = errors.New("bot provider is not supported")
	ErrAIBackendUnsupported = errors.New("bot ai backend is not supported")
	ErrWebhookUnauthorized  = errors.New("bot webhook is unauthorized")
	ErrWebhookIgnored       = errors.New("bot webhook did not contain a supported message")
	ErrPublicBaseURLMissing = errors.New("public base url is required")
)

const defaultAIBackend = "workspace_thread"

type threadExecutor interface {
	Create(ctx context.Context, workspaceID string, input threads.CreateInput) (store.Thread, error)
	GetDetail(ctx context.Context, workspaceID string, threadID string) (store.ThreadDetail, error)
	GetTurn(ctx context.Context, workspaceID string, threadID string, turnID string, contentMode string) (store.ThreadTurn, error)
	Rename(ctx context.Context, workspaceID string, threadID string, name string) (store.Thread, error)
	Archive(ctx context.Context, workspaceID string, threadID string) (store.Thread, error)
	Unarchive(ctx context.Context, workspaceID string, threadID string) (store.Thread, error)
}

type turnExecutor interface {
	Start(ctx context.Context, workspaceID string, threadID string, input string, options turns.StartOptions) (turns.Result, error)
}

type Provider interface {
	Name() string
	Activate(ctx context.Context, connection store.BotConnection, publicBaseURL string) (ActivationResult, error)
	Deactivate(ctx context.Context, connection store.BotConnection) error
	ParseWebhook(r *http.Request, connection store.BotConnection) ([]InboundMessage, error)
	SendMessages(ctx context.Context, connection store.BotConnection, conversation store.BotConversation, messages []OutboundMessage) error
}

type WebhookResultProvider interface {
	Provider
	ParseWebhookResult(r *http.Request, connection store.BotConnection) (WebhookResult, []InboundMessage, error)
}

type ReplyDeliveryRetryDecider interface {
	ReplyDeliveryRetryDecision(err error, attempt int) (bool, time.Duration)
}

type StreamingReplySession interface {
	Update(ctx context.Context, update StreamingUpdate) error
	Complete(ctx context.Context, messages []OutboundMessage) error
	Fail(ctx context.Context, text string) error
}

type StreamingProvider interface {
	Provider
	StartStreamingReply(
		ctx context.Context,
		connection store.BotConnection,
		conversation store.BotConversation,
	) (StreamingReplySession, error)
}

type TypingSession interface {
	Stop(ctx context.Context) error
}

type TypingProvider interface {
	Provider
	StartTyping(
		ctx context.Context,
		connection store.BotConnection,
		conversation store.BotConversation,
	) (TypingSession, error)
}

type PollingMessageHandler func(ctx context.Context, message InboundMessage) error

type PollingSettingsHandler func(ctx context.Context, settings map[string]string) error

type PollingEvent struct {
	EventType      string
	Message        string
	MessageKey     string
	MessageParams  map[string]string
	ReceivedCount  int
	ProcessedCount int
	IgnoredCount   int
}

type PollingEventHandler func(ctx context.Context, event PollingEvent) error

func emitPollingEvent(ctx context.Context, report PollingEventHandler, event PollingEvent) error {
	if report == nil {
		return nil
	}

	return report(ctx, event)
}

type PollingProvider interface {
	Provider
	SupportsPolling(connection store.BotConnection) bool
	RunPolling(
		ctx context.Context,
		connection store.BotConnection,
		handleMessage PollingMessageHandler,
		updateSettings PollingSettingsHandler,
		reportEvent PollingEventHandler,
	) error
}

type PollingOwnershipProvider interface {
	Provider
	PollingOwnerKey(connection store.BotConnection) string
	PollingConflictError(ownerConnectionID string) error
}

type AIBackend interface {
	Name() string
	ProcessMessage(ctx context.Context, connection store.BotConnection, conversation store.BotConversation, inbound InboundMessage) (AIResult, error)
}

type StreamingUpdate struct {
	Text     string
	Messages []OutboundMessage
}

type StreamingUpdateHandler func(ctx context.Context, update StreamingUpdate) error

type StreamingAIBackend interface {
	AIBackend
	ProcessMessageStream(
		ctx context.Context,
		connection store.BotConnection,
		conversation store.BotConversation,
		inbound InboundMessage,
		handle StreamingUpdateHandler,
	) (AIResult, error)
}

type ApprovalResponder interface {
	List(workspaceID string) []store.PendingApproval
	Respond(ctx context.Context, requestID string, input approvals.ResponseInput) (store.PendingApproval, error)
}

type Config struct {
	PublicBaseURL                     string
	OutboundProxyURL                  string
	HTTPClient                        *http.Client
	MessageTimeout                    time.Duration
	PollInterval                      time.Duration
	TurnTimeout                       time.Duration
	NotificationCenterManagedTriggers bool
	Approvals                         ApprovalResponder
	Providers                         []Provider
	AIBackends                        []AIBackend
}

type ActivationResult struct {
	Settings map[string]string
	Secrets  map[string]string
}

type InboundMessage struct {
	ConversationID   string
	ExternalChatID   string
	ExternalThreadID string
	MessageID        string
	UserID           string
	Username         string
	Title            string
	Text             string
	Media            []store.BotMessageMedia
	ProviderData     map[string]string
}

type OutboundMessage struct {
	Text  string
	Media []store.BotMessageMedia
}

type AIResult struct {
	ThreadID     string
	Messages     []OutboundMessage
	BackendState map[string]string
}

type CreateBotInput struct {
	Name               string   `json:"name"`
	Description        string   `json:"description"`
	Scope              string   `json:"scope,omitempty"`
	SharingMode        string   `json:"sharingMode,omitempty"`
	SharedWorkspaceIDs []string `json:"sharedWorkspaceIds,omitempty"`
}

type UpdateBotInput struct {
	Name               string   `json:"name"`
	Description        string   `json:"description"`
	Scope              string   `json:"scope,omitempty"`
	SharingMode        string   `json:"sharingMode,omitempty"`
	SharedWorkspaceIDs []string `json:"sharedWorkspaceIds,omitempty"`
}

type UpsertThreadBotBindingInput struct {
	BotWorkspaceID   string `json:"botWorkspaceId,omitempty"`
	BotID            string `json:"botId"`
	DeliveryTargetID string `json:"deliveryTargetId"`
}

type CreateConnectionInput struct {
	Provider      string            `json:"provider"`
	Name          string            `json:"name"`
	PublicBaseURL string            `json:"publicBaseUrl"`
	AIBackend     string            `json:"aiBackend"`
	AIConfig      map[string]string `json:"aiConfig"`
	Settings      map[string]string `json:"settings"`
	Secrets       map[string]string `json:"secrets"`
}

type UpdateConnectionInput struct {
	Provider      string            `json:"provider"`
	Name          string            `json:"name"`
	PublicBaseURL string            `json:"publicBaseUrl"`
	AIBackend     string            `json:"aiBackend"`
	AIConfig      map[string]string `json:"aiConfig"`
	Settings      map[string]string `json:"settings"`
	Secrets       map[string]string `json:"secrets"`
}

type ResumeConnectionInput struct {
	PublicBaseURL string `json:"publicBaseUrl"`
}

type UpdateConnectionRuntimeModeInput struct {
	RuntimeMode string `json:"runtimeMode"`
}

type UpdateConnectionCommandOutputModeInput struct {
	CommandOutputMode string `json:"commandOutputMode"`
}

type UpdateWeChatChannelTimingInput struct {
	Enabled bool `json:"enabled"`
}

type UpdateConversationBindingInput struct {
	ThreadID          string `json:"threadId"`
	CreateThread      bool   `json:"createThread"`
	Title             string `json:"title"`
	TargetWorkspaceID string `json:"targetWorkspaceId"`
}

type UpdateBotDefaultBindingInput struct {
	BindingMode       string `json:"bindingMode"`
	TargetWorkspaceID string `json:"targetWorkspaceId"`
	TargetThreadID    string `json:"targetThreadId"`
	Name              string `json:"name"`
}

type UpsertBotTriggerInput struct {
	Type             string            `json:"type"`
	DeliveryTargetID string            `json:"deliveryTargetId"`
	Filter           map[string]string `json:"filter,omitempty"`
	Enabled          *bool             `json:"enabled,omitempty"`
}

type UpsertDeliveryTargetInput struct {
	EndpointID    string            `json:"endpointId"`
	SessionID     string            `json:"sessionId,omitempty"`
	TargetType    string            `json:"targetType"`
	RouteType     string            `json:"routeType,omitempty"`
	RouteKey      string            `json:"routeKey,omitempty"`
	Title         string            `json:"title,omitempty"`
	Labels        []string          `json:"labels,omitempty"`
	Capabilities  []string          `json:"capabilities,omitempty"`
	ProviderState map[string]string `json:"providerState,omitempty"`
	Status        string            `json:"status,omitempty"`
}

type SendOutboundMessagesInput struct {
	SessionID         string                  `json:"sessionId,omitempty"`
	DeliveryTargetID  string                  `json:"deliveryTargetId,omitempty"`
	SourceType        string                  `json:"sourceType"`
	TriggerID         string                  `json:"triggerId,omitempty"`
	SourceRefType     string                  `json:"sourceRefType,omitempty"`
	SourceRefID       string                  `json:"sourceRefId,omitempty"`
	OriginWorkspaceID string                  `json:"originWorkspaceId,omitempty"`
	OriginThreadID    string                  `json:"originThreadId,omitempty"`
	OriginTurnID      string                  `json:"originTurnId,omitempty"`
	IdempotencyKey    string                  `json:"idempotencyKey,omitempty"`
	Messages          []store.BotReplyMessage `json:"messages"`
}

type UpdateWeChatAccountInput struct {
	Alias string `json:"alias"`
	Note  string `json:"note"`
}

type BotView struct {
	ID                     string    `json:"id"`
	WorkspaceID            string    `json:"workspaceId"`
	Scope                  string    `json:"scope,omitempty"`
	SharingMode            string    `json:"sharingMode,omitempty"`
	SharedWorkspaceIDs     []string  `json:"sharedWorkspaceIds,omitempty"`
	Name                   string    `json:"name"`
	Description            string    `json:"description,omitempty"`
	Status                 string    `json:"status"`
	DefaultBindingID       string    `json:"defaultBindingId,omitempty"`
	DefaultBindingMode     string    `json:"defaultBindingMode,omitempty"`
	DefaultTargetWorkspace string    `json:"defaultTargetWorkspaceId,omitempty"`
	DefaultTargetThreadID  string    `json:"defaultTargetThreadId,omitempty"`
	EndpointCount          int       `json:"endpointCount"`
	ConversationCount      int       `json:"conversationCount"`
	CreatedAt              time.Time `json:"createdAt"`
	UpdatedAt              time.Time `json:"updatedAt"`
}

type BotBindingView struct {
	ID                string            `json:"id"`
	WorkspaceID       string            `json:"workspaceId"`
	BotID             string            `json:"botId"`
	Name              string            `json:"name"`
	BindingMode       string            `json:"bindingMode"`
	TargetWorkspaceID string            `json:"targetWorkspaceId,omitempty"`
	TargetThreadID    string            `json:"targetThreadId,omitempty"`
	AIBackend         string            `json:"aiBackend"`
	AIConfig          map[string]string `json:"aiConfig,omitempty"`
	IsDefault         bool              `json:"isDefault"`
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
}

type ThreadBotBindingView struct {
	ID                       string    `json:"id"`
	WorkspaceID              string    `json:"workspaceId"`
	ThreadID                 string    `json:"threadId"`
	BotWorkspaceID           string    `json:"botWorkspaceId,omitempty"`
	BotID                    string    `json:"botId"`
	BotName                  string    `json:"botName"`
	DeliveryTargetID         string    `json:"deliveryTargetId"`
	DeliveryTargetTitle      string    `json:"deliveryTargetTitle,omitempty"`
	EndpointID               string    `json:"endpointId"`
	Provider                 string    `json:"provider"`
	SessionID                string    `json:"sessionId,omitempty"`
	DeliveryReadiness        string    `json:"deliveryReadiness,omitempty"`
	DeliveryReadinessMessage string    `json:"deliveryReadinessMessage,omitempty"`
	Status                   string    `json:"status"`
	CreatedAt                time.Time `json:"createdAt"`
	UpdatedAt                time.Time `json:"updatedAt"`
}

type BotTriggerView struct {
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

type WeChatAccountView struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	Alias           string    `json:"alias,omitempty"`
	Note            string    `json:"note,omitempty"`
	BaseURL         string    `json:"baseUrl"`
	AccountID       string    `json:"accountId"`
	UserID          string    `json:"userId"`
	LastLoginID     string    `json:"lastLoginId,omitempty"`
	LastConfirmedAt time.Time `json:"lastConfirmedAt"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type ConnectionView struct {
	ID                    string            `json:"id"`
	BotID                 string            `json:"botId,omitempty"`
	WorkspaceID           string            `json:"workspaceId"`
	Provider              string            `json:"provider"`
	Name                  string            `json:"name"`
	Status                string            `json:"status"`
	AIBackend             string            `json:"aiBackend"`
	AIConfig              map[string]string `json:"aiConfig,omitempty"`
	Settings              map[string]string `json:"settings,omitempty"`
	Capabilities          []string          `json:"capabilities,omitempty"`
	SecretKeys            []string          `json:"secretKeys,omitempty"`
	LastError             string            `json:"lastError,omitempty"`
	LastPollAt            *time.Time        `json:"lastPollAt,omitempty"`
	LastPollStatus        string            `json:"lastPollStatus,omitempty"`
	LastPollMessage       string            `json:"lastPollMessage,omitempty"`
	LastPollMessageKey    string            `json:"lastPollMessageKey,omitempty"`
	LastPollMessageParams map[string]string `json:"lastPollMessageParams,omitempty"`
	CreatedAt             time.Time         `json:"createdAt"`
	UpdatedAt             time.Time         `json:"updatedAt"`
}

type ConversationView struct {
	ID                               string     `json:"id"`
	BotID                            string     `json:"botId,omitempty"`
	BindingID                        string     `json:"bindingId,omitempty"`
	ResolvedBindingID                string     `json:"resolvedBindingId,omitempty"`
	ResolvedBindingMode              string     `json:"resolvedBindingMode,omitempty"`
	ResolvedTargetWorkspaceID        string     `json:"resolvedTargetWorkspaceId,omitempty"`
	ResolvedTargetThreadID           string     `json:"resolvedTargetThreadId,omitempty"`
	WorkspaceID                      string     `json:"workspaceId"`
	ConnectionID                     string     `json:"connectionId"`
	Provider                         string     `json:"provider"`
	ExternalConversationID           string     `json:"externalConversationId,omitempty"`
	ExternalChatID                   string     `json:"externalChatId"`
	ExternalThreadID                 string     `json:"externalThreadId,omitempty"`
	ExternalUserID                   string     `json:"externalUserId,omitempty"`
	ExternalUsername                 string     `json:"externalUsername,omitempty"`
	ExternalTitle                    string     `json:"externalTitle,omitempty"`
	ThreadID                         string     `json:"threadId,omitempty"`
	LastInboundMessageID             string     `json:"lastInboundMessageId,omitempty"`
	LastInboundText                  string     `json:"lastInboundText,omitempty"`
	LastOutboundText                 string     `json:"lastOutboundText,omitempty"`
	LastOutboundDeliveryStatus       string     `json:"lastOutboundDeliveryStatus,omitempty"`
	LastOutboundDeliveryError        string     `json:"lastOutboundDeliveryError,omitempty"`
	LastOutboundDeliveryAttemptCount int        `json:"lastOutboundDeliveryAttemptCount,omitempty"`
	LastOutboundDeliveredAt          *time.Time `json:"lastOutboundDeliveredAt,omitempty"`
	CreatedAt                        time.Time  `json:"createdAt"`
	UpdatedAt                        time.Time  `json:"updatedAt"`
}

type DeliveryTargetView struct {
	ID                       string            `json:"id"`
	WorkspaceID              string            `json:"workspaceId"`
	BotID                    string            `json:"botId"`
	EndpointID               string            `json:"endpointId"`
	SessionID                string            `json:"sessionId,omitempty"`
	Provider                 string            `json:"provider"`
	TargetType               string            `json:"targetType"`
	RouteType                string            `json:"routeType,omitempty"`
	RouteKey                 string            `json:"routeKey,omitempty"`
	Title                    string            `json:"title,omitempty"`
	Labels                   []string          `json:"labels,omitempty"`
	Capabilities             []string          `json:"capabilities,omitempty"`
	ProviderState            map[string]string `json:"providerState,omitempty"`
	Status                   string            `json:"status"`
	DeliveryReadiness        string            `json:"deliveryReadiness,omitempty"`
	DeliveryReadinessMessage string            `json:"deliveryReadinessMessage,omitempty"`
	LastContextSeenAt        *time.Time        `json:"lastContextSeenAt,omitempty"`
	LastVerifiedAt           *time.Time        `json:"lastVerifiedAt,omitempty"`
	CreatedAt                time.Time         `json:"createdAt"`
	UpdatedAt                time.Time         `json:"updatedAt"`
}

type RecipientCandidateView struct {
	ID                       string     `json:"id"`
	WorkspaceID              string     `json:"workspaceId"`
	ConnectionID             string     `json:"connectionId"`
	Provider                 string     `json:"provider"`
	RouteType                string     `json:"routeType"`
	RouteKey                 string     `json:"routeKey"`
	ChatID                   string     `json:"chatId"`
	ThreadID                 string     `json:"threadId,omitempty"`
	Title                    string     `json:"title,omitempty"`
	Source                   string     `json:"source,omitempty"`
	SourceRefID              string     `json:"sourceRefId,omitempty"`
	DeliveryReadiness        string     `json:"deliveryReadiness,omitempty"`
	DeliveryReadinessMessage string     `json:"deliveryReadinessMessage,omitempty"`
	LastContextSeenAt        *time.Time `json:"lastContextSeenAt,omitempty"`
	LastSeenAt               *time.Time `json:"lastSeenAt,omitempty"`
}

type OutboundDeliveryView struct {
	ID                 string                  `json:"id"`
	BotID              string                  `json:"botId"`
	EndpointID         string                  `json:"endpointId"`
	SessionID          string                  `json:"sessionId,omitempty"`
	DeliveryTargetID   string                  `json:"deliveryTargetId,omitempty"`
	RunID              string                  `json:"runId,omitempty"`
	TriggerID          string                  `json:"triggerId,omitempty"`
	SourceType         string                  `json:"sourceType"`
	SourceRefType      string                  `json:"sourceRefType,omitempty"`
	SourceRefID        string                  `json:"sourceRefId,omitempty"`
	OriginWorkspaceID  string                  `json:"originWorkspaceId,omitempty"`
	OriginThreadID     string                  `json:"originThreadId,omitempty"`
	OriginTurnID       string                  `json:"originTurnId,omitempty"`
	Messages           []store.BotReplyMessage `json:"messages,omitempty"`
	Status             string                  `json:"status"`
	AttemptCount       int                     `json:"attemptCount,omitempty"`
	IdempotencyKey     string                  `json:"idempotencyKey,omitempty"`
	ProviderMessageIDs []string                `json:"providerMessageIds,omitempty"`
	LastError          string                  `json:"lastError,omitempty"`
	CreatedAt          time.Time               `json:"createdAt"`
	UpdatedAt          time.Time               `json:"updatedAt"`
	DeliveredAt        *time.Time              `json:"deliveredAt,omitempty"`
}

type WebhookResult struct {
	Accepted   int               `json:"accepted"`
	StatusCode int               `json:"-"`
	Headers    map[string]string `json:"-"`
	Body       any               `json:"-"`
}
