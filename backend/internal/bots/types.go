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

type PollingMessageHandler func(ctx context.Context, message InboundMessage) error

type PollingSettingsHandler func(ctx context.Context, settings map[string]string) error

type PollingProvider interface {
	Provider
	SupportsPolling(connection store.BotConnection) bool
	RunPolling(
		ctx context.Context,
		connection store.BotConnection,
		handleMessage PollingMessageHandler,
		updateSettings PollingSettingsHandler,
	) error
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
	PublicBaseURL    string
	OutboundProxyURL string
	HTTPClient       *http.Client
	PollInterval     time.Duration
	TurnTimeout      time.Duration
	Approvals        ApprovalResponder
	Providers        []Provider
	AIBackends       []AIBackend
}

type ActivationResult struct {
	Settings map[string]string
	Secrets  map[string]string
}

type InboundMessage struct {
	ConversationID string
	ExternalChatID string
	ExternalThreadID string
	MessageID      string
	UserID         string
	Username       string
	Title          string
	Text           string
}

type OutboundMessage struct {
	Text string
}

type AIResult struct {
	ThreadID     string
	Messages     []OutboundMessage
	BackendState map[string]string
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

type ResumeConnectionInput struct {
	PublicBaseURL string `json:"publicBaseUrl"`
}

type ConnectionView struct {
	ID          string            `json:"id"`
	WorkspaceID string            `json:"workspaceId"`
	Provider    string            `json:"provider"`
	Name        string            `json:"name"`
	Status      string            `json:"status"`
	AIBackend   string            `json:"aiBackend"`
	AIConfig    map[string]string `json:"aiConfig,omitempty"`
	Settings    map[string]string `json:"settings,omitempty"`
	SecretKeys  []string          `json:"secretKeys,omitempty"`
	LastError   string            `json:"lastError,omitempty"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
}

type WebhookResult struct {
	Accepted int `json:"accepted"`
}
