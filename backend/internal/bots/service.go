package bots

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
)

const (
	defaultWorkerQueueSize = 32
	defaultMessageTimeout  = 3 * time.Minute
)

type Service struct {
	store *store.MemoryStore

	threads threadExecutor
	turns   turnExecutor
	events  *events.Hub

	publicBaseURL string
	providers     map[string]Provider
	aiBackends    map[string]AIBackend

	mu        sync.Mutex
	baseCtx   context.Context
	workers   map[string]chan inboundJob
	queueSize int
}

type inboundJob struct {
	connectionID string
	message      InboundMessage
}

func NewService(
	dataStore *store.MemoryStore,
	threadService threadExecutor,
	turnService turnExecutor,
	eventHub *events.Hub,
	cfg Config,
) *Service {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}

	service := &Service{
		store:         dataStore,
		threads:       threadService,
		turns:         turnService,
		events:        eventHub,
		publicBaseURL: strings.TrimSpace(cfg.PublicBaseURL),
		providers:     make(map[string]Provider),
		aiBackends:    make(map[string]AIBackend),
		workers:       make(map[string]chan inboundJob),
		queueSize:     defaultWorkerQueueSize,
	}

	service.registerProvider(newTelegramProvider(httpClient))
	service.registerAIBackend(newWorkspaceThreadAIBackend(threadService, turnService, cfg.PollInterval, cfg.TurnTimeout))
	service.registerAIBackend(newOpenAIResponsesBackend(httpClient))
	for _, provider := range cfg.Providers {
		service.registerProvider(provider)
	}
	for _, backend := range cfg.AIBackends {
		service.registerAIBackend(backend)
	}

	return service
}

func (s *Service) Start(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if ctx == nil {
		ctx = context.Background()
	}
	s.baseCtx = ctx
}

func (s *Service) ListConnections(workspaceID string) []ConnectionView {
	items := s.store.ListBotConnections(workspaceID)
	views := make([]ConnectionView, 0, len(items))
	for _, item := range items {
		views = append(views, connectionViewFromStore(item))
	}
	return views
}

func (s *Service) GetConnection(workspaceID string, connectionID string) (ConnectionView, error) {
	connection, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return ConnectionView{}, store.ErrBotConnectionNotFound
	}

	return connectionViewFromStore(connection), nil
}

func (s *Service) ListConversations(workspaceID string, connectionID string) []store.BotConversation {
	return s.store.ListBotConversations(workspaceID, connectionID)
}

func (s *Service) CreateConnection(
	ctx context.Context,
	workspaceID string,
	input CreateConnectionInput,
) (ConnectionView, error) {
	providerName := normalizeProviderName(input.Provider)
	provider, ok := s.providers[providerName]
	if !ok {
		return ConnectionView{}, ErrProviderNotSupported
	}

	aiBackendName := normalizeAIBackendName(input.AIBackend)
	if _, ok := s.aiBackends[aiBackendName]; !ok {
		return ConnectionView{}, ErrAIBackendUnsupported
	}

	connection := store.BotConnection{
		ID:          store.NewID("bot"),
		WorkspaceID: workspaceID,
		Provider:    providerName,
		Name:        firstNonEmpty(strings.TrimSpace(input.Name), defaultConnectionName(providerName)),
		Status:      "active",
		AIBackend:   aiBackendName,
		AIConfig:    cloneStringMapLocal(input.AIConfig),
		Settings:    cloneStringMapLocal(input.Settings),
		Secrets:     cloneStringMapLocal(input.Secrets),
	}

	activation, err := provider.Activate(ctx, connection, s.resolvePublicBaseURL(input.PublicBaseURL))
	if err != nil {
		return ConnectionView{}, err
	}

	connection.Settings = mergeStringMaps(connection.Settings, activation.Settings)
	connection.Secrets = mergeStringMaps(connection.Secrets, activation.Secrets)
	connection.LastError = ""

	created, err := s.store.CreateBotConnection(connection)
	if err != nil {
		return ConnectionView{}, err
	}

	s.publish(created.WorkspaceID, "", "bot/connection/created", map[string]any{
		"connectionId": created.ID,
		"provider":     created.Provider,
		"name":         created.Name,
		"status":       created.Status,
	})

	return connectionViewFromStore(created), nil
}

func (s *Service) PauseConnection(ctx context.Context, workspaceID string, connectionID string) (ConnectionView, error) {
	connection, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return ConnectionView{}, store.ErrBotConnectionNotFound
	}

	if provider, ok := s.providers[normalizeProviderName(connection.Provider)]; ok {
		if err := provider.Deactivate(ctx, connection); err != nil {
			return ConnectionView{}, err
		}
	}

	updated, err := s.store.UpdateBotConnection(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.Status = "paused"
		current.LastError = ""
		return current
	})
	if err != nil {
		return ConnectionView{}, err
	}

	s.publish(updated.WorkspaceID, "", "bot/connection/paused", map[string]any{
		"connectionId": updated.ID,
	})

	return connectionViewFromStore(updated), nil
}

func (s *Service) ResumeConnection(
	ctx context.Context,
	workspaceID string,
	connectionID string,
	input ResumeConnectionInput,
) (ConnectionView, error) {
	connection, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return ConnectionView{}, store.ErrBotConnectionNotFound
	}

	provider, ok := s.providers[normalizeProviderName(connection.Provider)]
	if !ok {
		return ConnectionView{}, ErrProviderNotSupported
	}

	activation, err := provider.Activate(ctx, connection, s.resolvePublicBaseURL(input.PublicBaseURL))
	if err != nil {
		return ConnectionView{}, err
	}

	updated, err := s.store.UpdateBotConnection(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.Status = "active"
		current.LastError = ""
		current.Settings = mergeStringMaps(current.Settings, activation.Settings)
		current.Secrets = mergeStringMaps(current.Secrets, activation.Secrets)
		return current
	})
	if err != nil {
		return ConnectionView{}, err
	}

	s.publish(updated.WorkspaceID, "", "bot/connection/resumed", map[string]any{
		"connectionId": updated.ID,
	})

	return connectionViewFromStore(updated), nil
}

func (s *Service) DeleteConnection(ctx context.Context, workspaceID string, connectionID string) error {
	connection, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return store.ErrBotConnectionNotFound
	}

	if provider, ok := s.providers[normalizeProviderName(connection.Provider)]; ok {
		if err := provider.Deactivate(ctx, connection); err != nil {
			return err
		}
	}

	if err := s.store.DeleteBotConnection(workspaceID, connectionID); err != nil {
		return err
	}

	s.publish(workspaceID, "", "bot/connection/deleted", map[string]any{
		"connectionId": connectionID,
	})
	return nil
}

func (s *Service) HandleWebhook(r *http.Request, connectionID string) (WebhookResult, error) {
	connection, ok := s.store.FindBotConnection(connectionID)
	if !ok {
		return WebhookResult{}, store.ErrBotConnectionNotFound
	}

	provider, ok := s.providers[normalizeProviderName(connection.Provider)]
	if !ok {
		return WebhookResult{}, ErrProviderNotSupported
	}
	if !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
		return WebhookResult{}, nil
	}

	messages, err := provider.ParseWebhook(r, connection)
	if err != nil {
		return WebhookResult{}, err
	}

	accepted := 0
	for _, message := range messages {
		if strings.TrimSpace(message.Text) == "" || strings.TrimSpace(message.ConversationID) == "" {
			continue
		}

		s.enqueueJob(inboundJob{
			connectionID: connection.ID,
			message:      message,
		})
		accepted += 1

		s.publish(connection.WorkspaceID, "", "bot/message/received", map[string]any{
			"connectionId":   connection.ID,
			"conversationId": message.ConversationID,
			"messageId":      message.MessageID,
			"username":       message.Username,
		})
	}

	return WebhookResult{Accepted: accepted}, nil
}

func (s *Service) registerProvider(provider Provider) {
	if provider == nil {
		return
	}
	s.providers[normalizeProviderName(provider.Name())] = provider
}

func (s *Service) registerAIBackend(backend AIBackend) {
	if backend == nil {
		return
	}
	s.aiBackends[normalizeAIBackendName(backend.Name())] = backend
}

func (s *Service) enqueueJob(job inboundJob) {
	key := job.connectionID + "\x00" + job.message.ConversationID
	ctx := s.workerContext()

	s.mu.Lock()
	queue, ok := s.workers[key]
	if !ok {
		queue = make(chan inboundJob, s.queueSize)
		s.workers[key] = queue
		go s.runWorker(ctx, key, queue)
	}
	s.mu.Unlock()

	queue <- job
}

func (s *Service) runWorker(ctx context.Context, key string, queue <-chan inboundJob) {
	for {
		select {
		case <-ctx.Done():
			s.mu.Lock()
			delete(s.workers, key)
			s.mu.Unlock()
			return
		case job := <-queue:
			s.processJob(ctx, job)
		}
	}
}

func (s *Service) processJob(ctx context.Context, job inboundJob) {
	connection, ok := s.store.FindBotConnection(job.connectionID)
	if !ok {
		return
	}
	if !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
		return
	}

	provider, ok := s.providers[normalizeProviderName(connection.Provider)]
	if !ok {
		return
	}

	aiBackend, ok := s.aiBackends[normalizeAIBackendName(connection.AIBackend)]
	if !ok {
		s.publish(connection.WorkspaceID, "", "bot/message/failed", map[string]any{
			"connectionId":   connection.ID,
			"conversationId": job.message.ConversationID,
			"error":          ErrAIBackendUnsupported.Error(),
		})
		return
	}

	conversation, duplicate, err := s.resolveConversation(connection, job.message)
	if err != nil {
		return
	}
	if duplicate {
		return
	}

	messageCtx, cancel := context.WithTimeout(ctx, defaultMessageTimeout)
	defer cancel()

	reply, err := aiBackend.ProcessMessage(messageCtx, connection, conversation, job.message)
	if err != nil {
		s.publish(connection.WorkspaceID, conversation.ThreadID, "bot/message/failed", map[string]any{
			"connectionId":   connection.ID,
			"conversationId": conversation.ID,
			"threadId":       conversation.ThreadID,
			"error":          err.Error(),
		})
		_, _ = s.store.UpdateBotConnection(connection.WorkspaceID, connection.ID, func(current store.BotConnection) store.BotConnection {
			current.LastError = err.Error()
			return current
		})
		return
	}

	if err := provider.SendMessages(messageCtx, connection, conversation, reply.Messages); err != nil {
		s.publish(connection.WorkspaceID, reply.ThreadID, "bot/message/failed", map[string]any{
			"connectionId":   connection.ID,
			"conversationId": conversation.ID,
			"threadId":       reply.ThreadID,
			"error":          err.Error(),
		})
		return
	}

	lastOutboundText := ""
	if len(reply.Messages) > 0 {
		lastOutboundText = strings.TrimSpace(reply.Messages[len(reply.Messages)-1].Text)
	}

	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		if strings.TrimSpace(reply.ThreadID) != "" {
			current.ThreadID = reply.ThreadID
		}
		current.BackendState = mergeStringMaps(current.BackendState, reply.BackendState)
		current.LastOutboundText = lastOutboundText
		return current
	})
	if err != nil {
		updatedConversation = conversation
		if strings.TrimSpace(reply.ThreadID) != "" {
			updatedConversation.ThreadID = reply.ThreadID
		}
		updatedConversation.BackendState = mergeStringMaps(updatedConversation.BackendState, reply.BackendState)
		updatedConversation.LastOutboundText = lastOutboundText
	}

	s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/sent", map[string]any{
		"connectionId":   connection.ID,
		"conversationId": updatedConversation.ID,
		"threadId":       updatedConversation.ThreadID,
		"messageCount":   len(reply.Messages),
	})
}

func (s *Service) resolveConversation(
	connection store.BotConnection,
	inbound InboundMessage,
) (store.BotConversation, bool, error) {
	if conversation, ok := s.store.FindBotConversationByExternalChat(connection.WorkspaceID, connection.ID, inbound.ConversationID); ok {
		if strings.TrimSpace(inbound.MessageID) != "" && strings.TrimSpace(conversation.LastInboundMessageID) == strings.TrimSpace(inbound.MessageID) {
			return conversation, true, nil
		}

		updated, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
			current.ExternalUserID = strings.TrimSpace(inbound.UserID)
			current.ExternalUsername = strings.TrimSpace(inbound.Username)
			current.ExternalTitle = strings.TrimSpace(inbound.Title)
			current.LastInboundMessageID = strings.TrimSpace(inbound.MessageID)
			current.LastInboundText = strings.TrimSpace(inbound.Text)
			return current
		})
		return updated, false, err
	}

	created, err := s.store.CreateBotConversation(store.BotConversation{
		WorkspaceID:          connection.WorkspaceID,
		ConnectionID:         connection.ID,
		Provider:             connection.Provider,
		ExternalChatID:       strings.TrimSpace(inbound.ConversationID),
		ExternalUserID:       strings.TrimSpace(inbound.UserID),
		ExternalUsername:     strings.TrimSpace(inbound.Username),
		ExternalTitle:        strings.TrimSpace(inbound.Title),
		LastInboundMessageID: strings.TrimSpace(inbound.MessageID),
		LastInboundText:      strings.TrimSpace(inbound.Text),
	})
	return created, false, err
}

func (s *Service) resolvePublicBaseURL(override string) string {
	if strings.TrimSpace(override) != "" {
		return strings.TrimSpace(override)
	}
	return s.publicBaseURL
}

func (s *Service) workerContext() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.baseCtx == nil {
		s.baseCtx = context.Background()
	}

	return s.baseCtx
}

func (s *Service) publish(workspaceID string, threadID string, method string, payload map[string]any) {
	if s.events == nil {
		return
	}

	s.events.Publish(store.EventEnvelope{
		WorkspaceID: workspaceID,
		ThreadID:    threadID,
		Method:      method,
		Payload:     payload,
		TS:          time.Now().UTC(),
	})
}

func normalizeProviderName(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeAIBackendName(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return defaultAIBackend
	}
	return normalized
}

func defaultConnectionName(provider string) string {
	switch normalizeProviderName(provider) {
	case telegramProviderName:
		return "Telegram Bot"
	default:
		return "Bot Connection"
	}
}

func mergeStringMaps(base map[string]string, overlay map[string]string) map[string]string {
	switch {
	case len(base) == 0 && len(overlay) == 0:
		return nil
	case len(base) == 0:
		return cloneStringMapLocal(overlay)
	case len(overlay) == 0:
		return cloneStringMapLocal(base)
	}

	next := cloneStringMapLocal(base)
	for key, value := range overlay {
		next[key] = value
	}
	return next
}

func connectionViewFromStore(connection store.BotConnection) ConnectionView {
	secretKeys := make([]string, 0, len(connection.Secrets))
	for key := range connection.Secrets {
		secretKeys = append(secretKeys, key)
	}
	sort.Strings(secretKeys)

	return ConnectionView{
		ID:          connection.ID,
		WorkspaceID: connection.WorkspaceID,
		Provider:    connection.Provider,
		Name:        connection.Name,
		Status:      connection.Status,
		AIBackend:   connection.AIBackend,
		AIConfig:    cloneStringMapLocal(connection.AIConfig),
		Settings:    cloneStringMapLocal(connection.Settings),
		SecretKeys:  secretKeys,
		LastError:   connection.LastError,
		CreatedAt:   connection.CreatedAt,
		UpdatedAt:   connection.UpdatedAt,
	}
}

func IsIgnorableWebhookError(err error) bool {
	return err != nil && (errors.Is(err, ErrWebhookIgnored) || errors.Is(err, context.Canceled))
}
