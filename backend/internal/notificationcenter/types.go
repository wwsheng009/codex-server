package notificationcenter

import (
	"context"
	"errors"
	"sync"
	"time"

	"codex-server/backend/internal/bots"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/notifications"
	"codex-server/backend/internal/store"
)

const (
	ChannelInApp = "in_app"
	ChannelBot   = "bot"
	ChannelEmail = "email"

	TargetRefTypeWorkspace         = "workspace"
	TargetRefTypeBotDeliveryTarget = "bot_delivery_target"
	TargetRefTypeEmailTarget       = "email_target"

	DispatchStatusPending   = "pending"
	DispatchStatusDelivered = "delivered"
	DispatchStatusFailed    = "failed"
)

var (
	ErrInvalidInput             = errors.New("invalid notification center input")
	ErrEmailDeliveryUnavailable = errors.New("notification email delivery unavailable")
)

type EmailMessage struct {
	WorkspaceID string
	TargetID    string
	Name        string
	To          []string
	Subject     string
	Body        string
}

type EmailSender interface {
	Send(ctx context.Context, message EmailMessage) error
}

type Config struct {
	EmailSender EmailSender
}

type Service struct {
	store         *store.MemoryStore
	events        *events.Hub
	notifications *notifications.Service
	bots          *bots.Service
	emailSender   EmailSender
	now           func() time.Time
	mu            sync.Mutex
	started       bool
}

type SubscriptionChannelInput struct {
	Channel       string            `json:"channel"`
	TargetRefType string            `json:"targetRefType,omitempty"`
	TargetRefID   string            `json:"targetRefId,omitempty"`
	TitleTemplate string            `json:"titleTemplate,omitempty"`
	BodyTemplate  string            `json:"bodyTemplate,omitempty"`
	Settings      map[string]string `json:"settings,omitempty"`
}

type UpsertSubscriptionInput struct {
	Topic      string                     `json:"topic"`
	SourceType string                     `json:"sourceType,omitempty"`
	Filter     map[string]string          `json:"filter,omitempty"`
	Channels   []SubscriptionChannelInput `json:"channels,omitempty"`
	Enabled    *bool                      `json:"enabled,omitempty"`
}

type CreateEmailTargetInput struct {
	Name            string   `json:"name"`
	Emails          []string `json:"emails,omitempty"`
	SubjectTemplate string   `json:"subjectTemplate,omitempty"`
	BodyTemplate    string   `json:"bodyTemplate,omitempty"`
	Enabled         *bool    `json:"enabled,omitempty"`
}

type UpsertMailServerConfigInput struct {
	Enabled       bool   `json:"enabled"`
	Host          string `json:"host,omitempty"`
	Port          int    `json:"port,omitempty"`
	Username      string `json:"username,omitempty"`
	Password      string `json:"password,omitempty"`
	ClearPassword bool   `json:"clearPassword,omitempty"`
	From          string `json:"from,omitempty"`
	RequireTLS    bool   `json:"requireTls"`
	SkipVerify    bool   `json:"skipVerify"`
}

type ListDispatchOptions struct {
	SubscriptionID string
	Topic          string
	Channel        string
	Status         string
	TargetRefType  string
	TargetRefID    string
	SourceRefType  string
	SourceRefID    string
	EventKey       string
}

type normalizedEvent struct {
	WorkspaceID   string
	ThreadID      string
	TurnID        string
	Method        string
	Topic         string
	SourceType    string
	SourceRefType string
	SourceRefID   string
	EventKey      string
	Level         string
	Title         string
	Message       string
	Attributes    map[string]string
}

type dispatchPlan struct {
	SubscriptionID  string
	LegacyTriggerID string
	Event           normalizedEvent
	Binding         store.NotificationChannelBinding
	Title           string
	Message         string
}
