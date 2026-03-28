package bots

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
)

const (
	defaultWorkerQueueSize       = 32
	defaultWorkerIdleTimeout     = 2 * time.Minute
	defaultStreamingPendingText  = "Working..."
	defaultStreamingFailureText  = "The bot could not process your message right now.\nTechnical details: no additional error details were available from the bot backend."
	botFailureDetailCharLimit    = 1200
	botConversationContextKey    = "_bot_context_version"
	botConversationThreadListKey = "_bot_known_thread_ids"
)

type Service struct {
	store *store.MemoryStore

	threads threadExecutor
	turns   turnExecutor
	events  *events.Hub

	publicBaseURL string
	approvals     ApprovalResponder
	providers     map[string]Provider
	aiBackends    map[string]AIBackend

	started bool

	mu                sync.Mutex
	baseCtx           context.Context
	workers           map[string]*inboundWorker
	pollers           map[string]*pollerHandle
	messageTimeout    time.Duration
	queueSize         int
	workerIdleTimeout time.Duration
}

type inboundJob struct {
	connectionID string
	deliveryID   string
	message      InboundMessage
}

type botApprovalCommand struct {
	kind        string
	requestID   string
	action      string
	answerInput string
}

type botConversationCommand struct {
	kind     string
	threadID string
	title    string
}

type inboundWorker struct {
	mu             sync.Mutex
	queue          chan inboundJob
	pendingEnqueue int
}

type pollerHandle struct {
	cancel context.CancelFunc
}

type replyDeliveryError struct {
	reply        AIResult
	providerName string
	phase        string
	cause        error
}

func (e *replyDeliveryError) Error() string {
	if e == nil {
		return ""
	}

	label := "bot reply delivery failed"
	if providerLabel := formatFailureLabel(e.providerName); providerLabel != "" {
		label = providerLabel + " delivery failed"
	}
	if phase := strings.TrimSpace(e.phase); phase != "" {
		label += " during " + phase
	}
	if e.cause == nil {
		return label
	}
	return label + ": " + e.cause.Error()
}

func (e *replyDeliveryError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func NewService(
	dataStore *store.MemoryStore,
	threadService threadExecutor,
	turnService turnExecutor,
	eventHub *events.Hub,
	cfg Config,
) *Service {
	clientSource := httpClientSource(nil)
	if cfg.HTTPClient != nil {
		clientSource = staticHTTPClientSource{client: cfg.HTTPClient}
	} else {
		clientSource = newRuntimeHTTPClientSource(dataStore, cfg.OutboundProxyURL)
	}

	service := &Service{
		store:             dataStore,
		threads:           threadService,
		turns:             turnService,
		events:            eventHub,
		publicBaseURL:     strings.TrimSpace(cfg.PublicBaseURL),
		approvals:         cfg.Approvals,
		providers:         make(map[string]Provider),
		aiBackends:        make(map[string]AIBackend),
		workers:           make(map[string]*inboundWorker),
		pollers:           make(map[string]*pollerHandle),
		messageTimeout:    cfg.MessageTimeout,
		queueSize:         defaultWorkerQueueSize,
		workerIdleTimeout: defaultWorkerIdleTimeout,
	}

	service.registerProvider(newTelegramProviderWithClientSource(clientSource))
	service.registerAIBackend(newWorkspaceThreadAIBackend(threadService, turnService, eventHub, cfg.PollInterval, cfg.TurnTimeout))
	service.registerAIBackend(newOpenAIResponsesBackendWithClientSource(clientSource))
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
	if ctx == nil {
		ctx = context.Background()
	}
	s.baseCtx = ctx
	s.started = true
	s.mu.Unlock()

	s.syncPollingConnections()
	s.recoverPendingInboundDeliveries("", "")
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

	normalizedSettings, err := normalizeBotConnectionSettings(input.Settings)
	if err != nil {
		return ConnectionView{}, err
	}

	connection := store.BotConnection{
		ID:          store.NewID("bot"),
		WorkspaceID: workspaceID,
		Provider:    providerName,
		Name:        firstNonEmpty(strings.TrimSpace(input.Name), defaultConnectionName(providerName)),
		Status:      "active",
		AIBackend:   aiBackendName,
		AIConfig:    cloneStringMapLocal(input.AIConfig),
		Settings:    normalizedSettings,
		Secrets:     cloneStringMapLocal(input.Secrets),
	}

	if err := s.validatePollingConnectionOwnership(connection); err != nil {
		return ConnectionView{}, err
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

	s.syncPollingConnection(created)

	s.publish(created.WorkspaceID, "", "bot/connection/created", map[string]any{
		"connectionId": created.ID,
		"provider":     created.Provider,
		"name":         created.Name,
		"status":       created.Status,
	})
	logBotDebug(ctx, created, "connection created",
		slog.String("aiBackend", created.AIBackend),
		slog.String("deliveryMode", strings.TrimSpace(created.Settings[telegramDeliveryModeSetting])),
	)

	return connectionViewFromStore(created), nil
}

func (s *Service) PauseConnection(ctx context.Context, workspaceID string, connectionID string) (ConnectionView, error) {
	connection, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return ConnectionView{}, store.ErrBotConnectionNotFound
	}

	s.stopPollingConnection(connection.ID)

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
	s.syncPollingConnections()

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

	if err := s.validatePollingConnectionOwnership(connection); err != nil {
		return ConnectionView{}, err
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

	s.syncPollingConnection(updated)
	s.recoverPendingInboundDeliveries(workspaceID, updated.ID)

	s.publish(updated.WorkspaceID, "", "bot/connection/resumed", map[string]any{
		"connectionId": updated.ID,
	})
	logBotDebug(ctx, updated, "connection resumed")

	return connectionViewFromStore(updated), nil
}

func (s *Service) UpdateConnectionRuntimeMode(
	workspaceID string,
	connectionID string,
	input UpdateConnectionRuntimeModeInput,
) (ConnectionView, error) {
	runtimeMode, err := normalizeBotRuntimeMode(input.RuntimeMode)
	if err != nil {
		return ConnectionView{}, err
	}

	updated, err := s.store.UpdateBotConnection(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		if current.Settings == nil {
			current.Settings = map[string]string{}
		}
		current.Settings[botRuntimeModeSetting] = runtimeMode
		return current
	})
	if err != nil {
		return ConnectionView{}, err
	}

	s.publish(updated.WorkspaceID, "", "bot/connection/runtime_mode_updated", map[string]any{
		"connectionId": updated.ID,
		"runtimeMode":  runtimeMode,
	})
	logBotDebug(nil, updated, "runtime mode updated", slog.String("newMode", runtimeMode))

	return connectionViewFromStore(updated), nil
}

func (s *Service) DeleteConnection(ctx context.Context, workspaceID string, connectionID string) error {
	connection, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return store.ErrBotConnectionNotFound
	}

	s.stopPollingConnection(connection.ID)

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
	s.syncPollingConnections()
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
		enqueued, err := s.acceptInboundMessage(connection, message)
		if err != nil {
			return WebhookResult{}, err
		}
		if enqueued {
			accepted += 1
		}
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
	key := s.workerKeyForJob(job)
	ctx := s.workerContext()

	s.mu.Lock()
	worker, ok := s.workers[key]
	if !ok {
		worker = &inboundWorker{
			queue: make(chan inboundJob, s.queueSize),
		}
		s.workers[key] = worker
		go s.runWorker(ctx, key, worker)
	}
	worker.mu.Lock()
	worker.pendingEnqueue += 1
	worker.mu.Unlock()
	s.mu.Unlock()

	worker.queue <- job

	worker.mu.Lock()
	worker.pendingEnqueue -= 1
	worker.mu.Unlock()
}

func (s *Service) runWorker(ctx context.Context, key string, worker *inboundWorker) {
	idleTimeout := s.workerIdleTimeoutValue()
	idleTimer := time.NewTimer(idleTimeout)
	defer idleTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			s.mu.Lock()
			if current, ok := s.workers[key]; ok && current == worker {
				delete(s.workers, key)
			}
			s.mu.Unlock()
			return
		case job := <-worker.queue:
			s.processJob(ctx, job)
			resetWorkerTimer(idleTimer, idleTimeout)
		case <-idleTimer.C:
			if s.retireWorkerIfIdle(key, worker) {
				return
			}
			idleTimer.Reset(idleTimeout)
		}
	}
}

func (s *Service) retireWorkerIfIdle(key string, worker *inboundWorker) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, ok := s.workers[key]
	if !ok || current != worker {
		return true
	}

	worker.mu.Lock()
	defer worker.mu.Unlock()

	if worker.pendingEnqueue > 0 || len(worker.queue) > 0 {
		return false
	}

	delete(s.workers, key)
	return true
}

func (s *Service) processJob(ctx context.Context, job inboundJob) {
	_ = s.processInboundMessage(ctx, job.connectionID, job.deliveryID)
}

func (s *Service) processInboundMessage(ctx context.Context, connectionID string, deliveryID string) error {
	connection, ok := s.store.FindBotConnection(connectionID)
	if !ok {
		return store.ErrBotConnectionNotFound
	}
	if !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
		return nil
	}

	delivery, shouldProcess, err := s.store.ClaimBotInboundDelivery(connection.WorkspaceID, deliveryID)
	if errors.Is(err, store.ErrBotInboundDeliveryNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if !shouldProcess {
		return nil
	}

	ctx = withBotDebugTrace(ctx, connection.ID, delivery.ID)
	message := inboundMessageFromDelivery(delivery)
	logBotDebug(ctx, connection, "claimed inbound delivery",
		slog.String("deliveryId", delivery.ID),
		slog.String("deliveryStatus", delivery.Status),
		slog.String("messageId", strings.TrimSpace(message.MessageID)),
		slog.String("conversationId", strings.TrimSpace(message.ConversationID)),
		slog.String("externalChatId", strings.TrimSpace(message.ExternalChatID)),
		slog.String("externalThreadId", strings.TrimSpace(message.ExternalThreadID)),
		slog.Int("textLength", len([]rune(message.Text))),
		slog.String("textPreview", debugTextPreview(message.Text)),
	)

	provider, ok := s.providers[normalizeProviderName(connection.Provider)]
	if !ok {
		_, _ = s.store.FailBotInboundDelivery(connection.WorkspaceID, delivery.ID, ErrProviderNotSupported.Error())
		return ErrProviderNotSupported
	}

	conversation, err := s.resolveConversation(connection, message)
	if err != nil {
		_, _ = s.store.FailBotInboundDelivery(connection.WorkspaceID, delivery.ID, err.Error())
		return err
	}
	logBotDebug(ctx, connection, "resolved bot conversation",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("threadId", strings.TrimSpace(conversation.ThreadID)),
		slog.String("externalConversationId", strings.TrimSpace(conversation.ExternalConversationID)),
	)

	if handled, updatedConversation, controlText, controlErr := s.handleConversationCommand(ctx, provider, connection, conversation, message); handled {
		logBotDebug(ctx, connection, "processing conversation control command",
			slog.String("conversationStoreId", conversation.ID),
			slog.String("textPreview", debugTextPreview(message.Text)),
		)
		if controlErr != nil {
			_, _ = s.store.FailBotInboundDelivery(connection.WorkspaceID, delivery.ID, controlErr.Error())
			return controlErr
		}
		updatedConversation = s.recordConversationOutcome(connection, updatedConversation, AIResult{}, message, controlText)
		_, _ = s.store.CompleteBotInboundDelivery(connection.WorkspaceID, delivery.ID)
		s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/processed", map[string]any{
			"connectionId":   connection.ID,
			"conversationId": updatedConversation.ID,
			"threadId":       updatedConversation.ThreadID,
		})
		return nil
	}

	if handled, controlText, controlErr := s.handleApprovalCommand(ctx, provider, connection, conversation, message); handled {
		logBotDebug(ctx, connection, "processing control command",
			slog.String("conversationStoreId", conversation.ID),
			slog.String("textPreview", debugTextPreview(message.Text)),
		)
		if controlErr != nil {
			_, _ = s.store.FailBotInboundDelivery(connection.WorkspaceID, delivery.ID, controlErr.Error())
			return controlErr
		}
		updatedConversation := s.recordConversationOutcome(connection, conversation, AIResult{}, message, controlText)
		_, _ = s.store.CompleteBotInboundDelivery(connection.WorkspaceID, delivery.ID)
		s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/processed", map[string]any{
			"connectionId":   connection.ID,
			"conversationId": updatedConversation.ID,
			"threadId":       updatedConversation.ThreadID,
		})
		return nil
	}

	messageCtx, cancel := withOptionalTimeout(ctx, s.messageTimeout)
	defer cancel()

	if reply, ok := aiResultFromDelivery(delivery); ok {
		logBotDebug(messageCtx, connection, "replaying saved reply snapshot",
			slog.String("conversationStoreId", conversation.ID),
			slog.String("replyThreadId", strings.TrimSpace(reply.ThreadID)),
			slog.Any("messages", debugOutboundMessages(reply.Messages)),
		)
		if err := provider.SendMessages(messageCtx, connection, conversation, reply.Messages); err != nil {
			return s.handleReplyDeliveryFailure(messageCtx, connection, conversation, delivery, message, reply, err)
		}
		return s.completeInboundDeliveryWithReply(messageCtx, connection, conversation, delivery, message, reply)
	}

	aiBackend, ok := s.aiBackends[normalizeAIBackendName(connection.AIBackend)]
	if !ok {
		err := ErrAIBackendUnsupported
		failureText, notifyErr := s.sendFailureReply(messageCtx, provider, connection, conversation, err)
		if notifyErr != nil {
			err = errors.Join(err, notifyErr)
			_, _ = s.store.FailBotInboundDelivery(connection.WorkspaceID, delivery.ID, err.Error())
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
			return err
		}
		updatedConversation := s.recordConversationOutcome(connection, conversation, AIResult{}, message, failureText)
		_, _ = s.store.CompleteBotInboundDelivery(connection.WorkspaceID, delivery.ID)
		s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/failed", map[string]any{
			"connectionId":   connection.ID,
			"conversationId": updatedConversation.ID,
			"threadId":       updatedConversation.ThreadID,
			"error":          err.Error(),
		})
		_, _ = s.store.UpdateBotConnection(connection.WorkspaceID, connection.ID, func(current store.BotConnection) store.BotConnection {
			current.LastError = err.Error()
			return current
		})
		return nil
	}

	reply, failureDelivered, failureText, err := s.executeAIReply(messageCtx, provider, aiBackend, connection, conversation, message)
	if err != nil {
		logBotDebug(messageCtx, connection, "ai reply execution failed",
			slog.String("conversationStoreId", conversation.ID),
			slog.String("error", err.Error()),
			slog.Bool("failureDelivered", failureDelivered),
			slog.String("failureTextPreview", debugTextPreview(failureText)),
		)
		var deliveryErr *replyDeliveryError
		if errors.As(err, &deliveryErr) {
			return s.handleReplyDeliveryFailure(messageCtx, connection, conversation, delivery, message, deliveryErr.reply, deliveryErr)
		}

		if !failureDelivered {
			var notifyErr error
			failureText, notifyErr = s.sendFailureReply(messageCtx, provider, connection, conversation, err)
			if notifyErr != nil {
				err = errors.Join(err, notifyErr)
				_, _ = s.store.FailBotInboundDelivery(connection.WorkspaceID, delivery.ID, err.Error())
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
				return err
			}
			failureDelivered = true
		}

		updatedConversation := s.recordConversationOutcome(connection, conversation, AIResult{}, message, failureText)
		_, _ = s.store.CompleteBotInboundDelivery(connection.WorkspaceID, delivery.ID)
		s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/failed", map[string]any{
			"connectionId":   connection.ID,
			"conversationId": updatedConversation.ID,
			"threadId":       updatedConversation.ThreadID,
			"error":          err.Error(),
		})
		_, _ = s.store.UpdateBotConnection(connection.WorkspaceID, connection.ID, func(current store.BotConnection) store.BotConnection {
			current.LastError = err.Error()
			return current
		})
		return nil
	}

	return s.completeInboundDeliveryWithReply(messageCtx, connection, conversation, delivery, message, reply)
}

func (s *Service) executeAIReply(
	ctx context.Context,
	provider Provider,
	aiBackend AIBackend,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (AIResult, bool, string, error) {
	streamingProvider, providerSupportsStreaming := provider.(StreamingProvider)
	streamingBackend, backendSupportsStreaming := aiBackend.(StreamingAIBackend)
	if !providerSupportsStreaming || !backendSupportsStreaming {
		logBotDebug(ctx, connection, "executing final ai reply",
			slog.String("backend", aiBackend.Name()),
			slog.Bool("streamingProvider", providerSupportsStreaming),
			slog.Bool("streamingBackend", backendSupportsStreaming),
		)
		reply, err := s.executeFinalAIReply(ctx, provider, aiBackend, connection, conversation, inbound)
		return reply, false, "", err
	}
	logBotDebug(ctx, connection, "starting streaming ai reply",
		slog.String("backend", aiBackend.Name()),
		slog.String("provider", provider.Name()),
	)

	session, err := streamingProvider.StartStreamingReply(ctx, connection, conversation)
	if err != nil {
		return AIResult{}, false, "", err
	}

	if err := session.Update(ctx, StreamingUpdate{Messages: []OutboundMessage{{Text: defaultStreamingPendingText}}}); err == nil {
	}

	reply, processErr := streamingBackend.ProcessMessageStream(
		ctx,
		connection,
		conversation,
		inbound,
		func(updateCtx context.Context, update StreamingUpdate) error {
			normalized := normalizeStreamingMessages(update)
			if len(normalized) == 0 {
				return nil
			}
			logBotDebug(updateCtx, connection, "streaming update received",
				slog.String("conversationStoreId", conversation.ID),
				slog.Int("messageCount", len(normalized)),
				slog.Any("messages", debugOutboundMessages(normalized)),
			)
			return session.Update(updateCtx, update)
		},
	)
	if processErr != nil {
		processErr = wrapAIBackendError(aiBackend.Name(), processErr)
		failureText := strings.TrimSpace(failureReplyText(processErr))
		if failureText == "" {
			failureText = defaultStreamingFailureText
		}
		if failErr := session.Fail(ctx, failureText); failErr != nil {
			return AIResult{}, false, "", errors.Join(processErr, failErr)
		}
		return AIResult{}, true, failureText, processErr
	}

	if err := session.Complete(ctx, reply.Messages); err != nil {
		return AIResult{}, false, "", &replyDeliveryError{
			reply:        reply,
			providerName: provider.Name(),
			phase:        "stream completion",
			cause:        err,
		}
	}
	logBotDebug(ctx, connection, "streaming ai reply completed",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("replyThreadId", strings.TrimSpace(reply.ThreadID)),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
	)

	return reply, false, "", nil
}

func (s *Service) executeFinalAIReply(
	ctx context.Context,
	provider Provider,
	aiBackend AIBackend,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (AIResult, error) {
	reply, err := aiBackend.ProcessMessage(ctx, connection, conversation, inbound)
	if err != nil {
		return AIResult{}, wrapAIBackendError(aiBackend.Name(), err)
	}
	logBotDebug(ctx, connection, "final ai reply produced",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("replyThreadId", strings.TrimSpace(reply.ThreadID)),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
	)

	if err := provider.SendMessages(ctx, connection, conversation, reply.Messages); err != nil {
		return AIResult{}, &replyDeliveryError{
			reply:        reply,
			providerName: provider.Name(),
			phase:        "final message send",
			cause:        err,
		}
	}

	return reply, nil
}

func (s *Service) completeInboundDeliveryWithReply(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	delivery store.BotInboundDelivery,
	message InboundMessage,
	reply AIResult,
) error {
	updatedConversation := s.recordConversationOutcome(connection, conversation, reply, message, "")
	if _, err := s.store.CompleteBotInboundDelivery(connection.WorkspaceID, delivery.ID); err != nil {
		return err
	}
	logBotDebug(ctx, connection, "completed inbound delivery",
		slog.String("deliveryId", delivery.ID),
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", strings.TrimSpace(updatedConversation.ThreadID)),
		slog.Int("messageCount", len(reply.Messages)),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
	)

	s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/sent", map[string]any{
		"connectionId":   connection.ID,
		"conversationId": updatedConversation.ID,
		"threadId":       updatedConversation.ThreadID,
		"messageCount":   len(reply.Messages),
	})

	return nil
}

func (s *Service) handleReplyDeliveryFailure(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	delivery store.BotInboundDelivery,
	message InboundMessage,
	reply AIResult,
	deliveryErr error,
) error {
	updatedConversation := s.recordConversationOutcome(connection, conversation, reply, message, "")

	replyTexts := outboundMessageTexts(reply.Messages)
	saveErr := error(nil)
	if _, err := s.store.SaveBotInboundDeliveryReply(connection.WorkspaceID, delivery.ID, reply.ThreadID, replyTexts); err != nil {
		saveErr = err
	}

	lastError := deliveryErr
	if saveErr != nil {
		lastError = errors.Join(lastError, saveErr)
	}

	failErr := error(nil)
	if _, err := s.store.FailBotInboundDelivery(connection.WorkspaceID, delivery.ID, lastError.Error()); err != nil {
		failErr = err
		lastError = errors.Join(lastError, failErr)
	}

	s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/delivery_failed", map[string]any{
		"connectionId":   connection.ID,
		"conversationId": updatedConversation.ID,
		"threadId":       updatedConversation.ThreadID,
		"messageCount":   len(reply.Messages),
		"error":          lastError.Error(),
	})
	_, _ = s.store.UpdateBotConnection(connection.WorkspaceID, connection.ID, func(current store.BotConnection) store.BotConnection {
		current.LastError = lastError.Error()
		return current
	})
	logBotDebug(ctx, connection, "reply delivery failed",
		slog.String("deliveryId", delivery.ID),
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", strings.TrimSpace(updatedConversation.ThreadID)),
		slog.Int("messageCount", len(reply.Messages)),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
		slog.String("error", lastError.Error()),
	)

	if saveErr != nil || failErr != nil {
		return lastError
	}
	return nil
}

func (s *Service) resolveConversation(
	connection store.BotConnection,
	inbound InboundMessage,
) (store.BotConversation, error) {
	if conversation, ok := s.store.FindBotConversationByExternalConversation(connection.WorkspaceID, connection.ID, inbound.ConversationID); ok {
		updated, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
			current.ExternalConversationID = strings.TrimSpace(inbound.ConversationID)
			current.ExternalChatID = firstNonEmpty(strings.TrimSpace(inbound.ExternalChatID), strings.TrimSpace(inbound.ConversationID))
			current.ExternalThreadID = strings.TrimSpace(inbound.ExternalThreadID)
			current.ExternalUserID = strings.TrimSpace(inbound.UserID)
			current.ExternalUsername = strings.TrimSpace(inbound.Username)
			current.ExternalTitle = strings.TrimSpace(inbound.Title)
			current.LastInboundText = strings.TrimSpace(inbound.Text)
			return current
		})
		return updated, err
	}

	created, err := s.store.CreateBotConversation(store.BotConversation{
		WorkspaceID:            connection.WorkspaceID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: strings.TrimSpace(inbound.ConversationID),
		ExternalChatID:         firstNonEmpty(strings.TrimSpace(inbound.ExternalChatID), strings.TrimSpace(inbound.ConversationID)),
		ExternalThreadID:       strings.TrimSpace(inbound.ExternalThreadID),
		ExternalUserID:         strings.TrimSpace(inbound.UserID),
		ExternalUsername:       strings.TrimSpace(inbound.Username),
		ExternalTitle:          strings.TrimSpace(inbound.Title),
		LastInboundText:        strings.TrimSpace(inbound.Text),
	})
	return created, err
}

func (s *Service) resolvePublicBaseURL(override string) string {
	if strings.TrimSpace(override) != "" {
		return strings.TrimSpace(override)
	}
	return s.publicBaseURL
}

func (s *Service) validatePollingConnectionOwnership(connection store.BotConnection) error {
	conflict, ok := s.findConflictingTelegramPollingConnection(connection)
	if !ok {
		return nil
	}
	return telegramPollingConflictError(conflict.ID)
}

func (s *Service) findConflictingTelegramPollingConnection(connection store.BotConnection) (store.BotConnection, bool) {
	token := telegramPollingTokenForValidation(connection)
	if token == "" {
		return store.BotConnection{}, false
	}

	var conflict store.BotConnection
	found := false
	for _, workspace := range s.store.ListWorkspaces() {
		for _, candidate := range s.store.ListBotConnections(workspace.ID) {
			if candidate.ID == connection.ID {
				continue
			}
			if telegramPollingToken(candidate) != token {
				continue
			}
			if !found || botConnectionSortsBefore(candidate, conflict) {
				conflict = candidate
				found = true
			}
		}
	}

	return conflict, found
}

func (s *Service) telegramPollingOwner(connection store.BotConnection) (store.BotConnection, bool) {
	token := telegramPollingToken(connection)
	if token == "" {
		return store.BotConnection{}, false
	}

	owner := connection
	found := false
	for _, workspace := range s.store.ListWorkspaces() {
		for _, candidate := range s.store.ListBotConnections(workspace.ID) {
			if telegramPollingToken(candidate) != token {
				continue
			}
			if !found || botConnectionSortsBefore(candidate, owner) {
				owner = candidate
				found = true
			}
		}
	}

	if !found {
		return store.BotConnection{}, false
	}
	return owner, true
}

func isActiveTelegramPollingConnection(connection store.BotConnection) bool {
	return strings.EqualFold(strings.TrimSpace(connection.Status), "active") &&
		normalizeProviderName(connection.Provider) == telegramProviderName &&
		telegramDeliveryMode(connection) == telegramDeliveryModePolling &&
		strings.TrimSpace(connection.Secrets["bot_token"]) != ""
}

func telegramPollingTokenForValidation(connection store.BotConnection) string {
	if normalizeProviderName(connection.Provider) != telegramProviderName {
		return ""
	}
	if telegramDeliveryMode(connection) != telegramDeliveryModePolling {
		return ""
	}
	return strings.TrimSpace(connection.Secrets["bot_token"])
}

func telegramPollingToken(connection store.BotConnection) string {
	if !isActiveTelegramPollingConnection(connection) {
		return ""
	}
	return strings.TrimSpace(connection.Secrets["bot_token"])
}

func botConnectionSortsBefore(left store.BotConnection, right store.BotConnection) bool {
	if right.ID == "" {
		return true
	}
	if left.CreatedAt.IsZero() && !right.CreatedAt.IsZero() {
		return false
	}
	if !left.CreatedAt.IsZero() && right.CreatedAt.IsZero() {
		return true
	}
	if !left.CreatedAt.Equal(right.CreatedAt) {
		return left.CreatedAt.Before(right.CreatedAt)
	}
	return left.ID < right.ID
}

func telegramPollingConflictError(ownerConnectionID string) error {
	message := "telegram polling token is already claimed by another active polling connection"
	if owner := strings.TrimSpace(ownerConnectionID); owner != "" {
		message += " (" + owner + ")"
	}
	message += "; pause or delete the other polling connection, or switch one connection to webhook mode"
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

func (s *Service) setConnectionLastError(workspaceID string, connectionID string, lastError string) {
	_, _ = s.store.UpdateBotConnection(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.LastError = strings.TrimSpace(lastError)
		return current
	})
}

func (s *Service) syncPollingConnections() {
	for _, workspace := range s.store.ListWorkspaces() {
		for _, connection := range s.store.ListBotConnections(workspace.ID) {
			s.syncPollingConnection(connection)
		}
	}
}

func (s *Service) syncPollingConnection(connection store.BotConnection) {
	pollingProvider, shouldPoll := s.pollingProviderForConnection(connection)
	if !shouldPoll {
		s.stopPollingConnection(connection.ID)
		return
	}

	if owner, ok := s.telegramPollingOwner(connection); ok && owner.ID != connection.ID {
		s.stopPollingConnection(connection.ID)
		s.setConnectionLastError(connection.WorkspaceID, connection.ID, telegramPollingConflictError(owner.ID).Error())
		return
	}
	if strings.TrimSpace(connection.LastError) != "" {
		s.setConnectionLastError(connection.WorkspaceID, connection.ID, "")
	}

	s.mu.Lock()
	if !s.started {
		s.mu.Unlock()
		return
	}
	if _, ok := s.pollers[connection.ID]; ok {
		s.mu.Unlock()
		return
	}

	baseCtx := s.baseCtx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	ctx, cancel := context.WithCancel(baseCtx)
	handle := &pollerHandle{cancel: cancel}
	s.pollers[connection.ID] = handle
	s.mu.Unlock()

	go s.runPollingConnection(ctx, connection.ID, pollingProvider, handle)
}

func (s *Service) pollingProviderForConnection(connection store.BotConnection) (PollingProvider, bool) {
	if !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
		return nil, false
	}

	provider, ok := s.providers[normalizeProviderName(connection.Provider)]
	if !ok {
		return nil, false
	}

	pollingProvider, ok := provider.(PollingProvider)
	if !ok || !pollingProvider.SupportsPolling(connection) {
		return nil, false
	}

	return pollingProvider, true
}

func (s *Service) stopPollingConnection(connectionID string) {
	s.mu.Lock()
	handle, ok := s.pollers[connectionID]
	if ok {
		delete(s.pollers, connectionID)
	}
	s.mu.Unlock()

	if ok {
		handle.cancel()
	}
}

func (s *Service) runPollingConnection(
	ctx context.Context,
	connectionID string,
	provider PollingProvider,
	handle *pollerHandle,
) {
	defer s.finishPollingConnection(connectionID, handle)

	retryDelay := time.Second
	for {
		connection, ok := s.store.FindBotConnection(connectionID)
		if !ok {
			return
		}

		currentProvider, shouldPoll := s.pollingProviderForConnection(connection)
		if !shouldPoll {
			return
		}
		provider = currentProvider

		err := provider.RunPolling(
			ctx,
			connection,
			func(messageCtx context.Context, message InboundMessage) error {
				_, err := s.acceptInboundMessage(connection, message)
				return err
			},
			func(_ context.Context, settings map[string]string) error {
				if len(settings) == 0 {
					return nil
				}
				_, err := s.store.UpdateBotConnection(connection.WorkspaceID, connection.ID, func(current store.BotConnection) store.BotConnection {
					current.Settings = mergeStringMaps(current.Settings, settings)
					current.LastError = ""
					return current
				})
				return err
			},
		)
		if err == nil || ctx.Err() != nil || errors.Is(err, context.Canceled) {
			return
		}

		s.recordPollingError(connection, err)

		timer := time.NewTimer(retryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}

		if retryDelay < 30*time.Second {
			retryDelay *= 2
			if retryDelay > 30*time.Second {
				retryDelay = 30 * time.Second
			}
		}
	}
}

func (s *Service) finishPollingConnection(connectionID string, handle *pollerHandle) {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, ok := s.pollers[connectionID]
	if ok && current == handle {
		delete(s.pollers, connectionID)
	}
}

func (s *Service) recordPollingError(connection store.BotConnection, err error) {
	if strings.TrimSpace(err.Error()) == "" {
		return
	}

	_, _ = s.store.UpdateBotConnection(connection.WorkspaceID, connection.ID, func(current store.BotConnection) store.BotConnection {
		current.LastError = err.Error()
		return current
	})
}

func (s *Service) workerContext() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.baseCtx == nil {
		s.baseCtx = context.Background()
	}

	return s.baseCtx
}

func (s *Service) workerKeyForJob(job inboundJob) string {
	if isBotControlCommand(job.message.Text) {
		return job.connectionID + "\x00control"
	}
	return job.connectionID + "\x00" + job.message.ConversationID
}

func (s *Service) workerIdleTimeoutValue() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.workerIdleTimeout > 0 {
		return s.workerIdleTimeout
	}
	return defaultWorkerIdleTimeout
}

func resetWorkerTimer(timer *time.Timer, delay time.Duration) {
	if timer == nil {
		return
	}
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(delay)
}

func isBotControlCommand(text string) bool {
	if _, ok, _ := parseBotConversationCommand(text); ok {
		return true
	}
	if _, ok, _ := parseBotApprovalCommand(text); ok {
		return true
	}
	return false
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

func (s *Service) publishMessageReceived(connection store.BotConnection, message InboundMessage) {
	s.publish(connection.WorkspaceID, "", "bot/message/received", map[string]any{
		"connectionId":   connection.ID,
		"conversationId": message.ConversationID,
		"messageId":      message.MessageID,
		"username":       message.Username,
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

func conversationContextVersion(conversation store.BotConversation) int {
	return conversationContextVersionFromState(conversation.BackendState)
}

func conversationContextVersionFromState(state map[string]string) int {
	trimmed := strings.TrimSpace(state[botConversationContextKey])
	if trimmed == "" {
		return 0
	}

	version, err := strconv.Atoi(trimmed)
	if err != nil || version < 0 {
		return 0
	}
	return version
}

func conversationBackendStateWithVersion(state map[string]string, version int) map[string]string {
	next := cloneStringMapLocal(state)
	if next == nil {
		next = make(map[string]string)
	}
	next[botConversationContextKey] = strconv.Itoa(version)
	return next
}

func knownConversationThreadIDs(conversation store.BotConversation) []string {
	return knownConversationThreadIDsFromState(conversation.BackendState)
}

func knownConversationThreadIDsFromState(state map[string]string) []string {
	raw := strings.TrimSpace(state[botConversationThreadListKey])
	if raw == "" {
		return nil
	}

	parts := strings.Split(raw, "\n")
	items := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		threadID := strings.TrimSpace(part)
		if threadID == "" {
			continue
		}
		if _, ok := seen[threadID]; ok {
			continue
		}
		seen[threadID] = struct{}{}
		items = append(items, threadID)
	}
	return items
}

func appendKnownConversationThreadID(state map[string]string, threadID string) []string {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return knownConversationThreadIDsFromState(state)
	}

	items := knownConversationThreadIDsFromState(state)
	for _, existing := range items {
		if existing == threadID {
			return items
		}
	}
	return append(items, threadID)
}

func conversationBackendStateWithKnownThreads(state map[string]string, threadIDs []string) map[string]string {
	next := stripConversationInternalBackendState(state)
	if len(threadIDs) == 0 {
		return next
	}
	if next == nil {
		next = make(map[string]string)
	}
	next[botConversationThreadListKey] = strings.Join(threadIDs, "\n")
	return next
}

func mergeConversationBackendState(base map[string]string, overlay map[string]string, version int) map[string]string {
	knownThreadIDs := knownConversationThreadIDsFromState(base)
	for _, threadID := range knownConversationThreadIDsFromState(overlay) {
		knownThreadIDs = appendKnownConversationThreadID(
			conversationBackendStateWithKnownThreads(nil, knownThreadIDs),
			threadID,
		)
	}

	merged := mergeStringMaps(
		stripConversationInternalBackendState(base),
		stripConversationInternalBackendState(overlay),
	)
	merged = conversationBackendStateWithKnownThreads(merged, knownThreadIDs)
	return conversationBackendStateWithVersion(merged, version)
}

func stripConversationInternalBackendState(state map[string]string) map[string]string {
	if len(state) == 0 {
		return nil
	}

	next := make(map[string]string, len(state))
	for key, value := range state {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == botConversationContextKey || trimmedKey == botConversationThreadListKey {
			continue
		}
		next[key] = value
	}
	if len(next) == 0 {
		return nil
	}
	return next
}

func normalizeStreamingMessages(update StreamingUpdate) []OutboundMessage {
	if len(update.Messages) > 0 {
		messages := make([]OutboundMessage, 0, len(update.Messages))
		for _, message := range update.Messages {
			if strings.TrimSpace(message.Text) == "" {
				continue
			}
			messages = append(messages, message)
		}
		return messages
	}

	if strings.TrimSpace(update.Text) == "" {
		return nil
	}

	return []OutboundMessage{{Text: update.Text}}
}

func (s *Service) sendFailureReply(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	conversation store.BotConversation,
	cause error,
) (string, error) {
	text := strings.TrimSpace(failureReplyText(cause))
	if text == "" {
		text = defaultStreamingFailureText
	}
	return text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
}

func failureReplyText(err error) string {
	summary := failureReplySummary(err)
	detail := failureReplyDetail(err)

	switch {
	case summary == "" && detail == "":
		return ""
	case summary == "":
		return detail
	case detail == "":
		return summary
	case strings.Contains(summary, detail):
		return summary
	default:
		return summary + "\nTechnical details: " + detail
	}
}

func failureReplySummary(err error) string {
	switch {
	case err == nil:
		return "The bot failed, but the backend did not record a structured error."
	case errors.Is(err, appRuntime.ErrRuntimeNotConfigured):
		return "The bot runtime is not configured right now. Please contact the workspace admin."
	case errors.Is(err, context.Canceled):
		return "The bot backend stopped before finishing your message. Please try again."
	case errors.Is(err, context.DeadlineExceeded):
		return "The bot backend stopped before finishing your message. Please try again."
	case errors.Is(err, ErrAIBackendUnsupported):
		return "The bot AI backend is not configured correctly right now."
	case errors.Is(err, ErrInvalidInput):
		return "The bot configuration is incomplete right now."
	}

	var deliveryErr *replyDeliveryError
	if errors.As(err, &deliveryErr) {
		providerLabel := formatFailureLabel(deliveryErr.providerName)
		if providerLabel == "" {
			return "The bot generated a reply, but the final delivery step failed."
		}
		return "The bot generated a reply, but the final delivery step to " + providerLabel + " failed."
	}

	var turnErr *workspaceTurnTerminalError
	if errors.As(err, &turnErr) {
		switch strings.ToLower(strings.TrimSpace(turnErr.Status)) {
		case "interrupted", "canceled", "cancelled":
			return "The workspace turn stopped before finishing your reply."
		case "failed":
			return "The workspace turn failed before producing a final bot reply."
		default:
			return "The workspace turn ended without a successful bot reply."
		}
	}

	var noReplyErr *botVisibleReplyMissingError
	if errors.As(err, &noReplyErr) {
		return "The AI backend finished, but it did not produce any bot-visible reply."
	}

	var backendErr *aiBackendExecutionError
	if errors.As(err, &backendErr) {
		if backendLabel := formatFailureLabel(backendErr.backend); backendLabel != "" {
			return "The " + backendLabel + " AI backend failed while processing your message."
		}
		return "The AI backend failed while processing your message."
	}

	return "The bot could not process your message right now. Please try again later."
}

func failureReplyDetail(err error) string {
	if err == nil {
		return "no error object was provided by the bot backend"
	}

	normalized := strings.ReplaceAll(err.Error(), "\r\n", "\n")
	parts := strings.Split(normalized, "\n")
	lines := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		line := strings.TrimSpace(part)
		if line == "" {
			continue
		}
		if _, ok := seen[line]; ok {
			continue
		}
		seen[line] = struct{}{}
		lines = append(lines, line)
		if len(lines) >= 4 {
			break
		}
	}
	if len(lines) == 0 {
		return "the bot backend returned an empty error message"
	}

	detail := strings.Join(lines, " | ")
	runes := []rune(detail)
	if len(runes) > botFailureDetailCharLimit {
		detail = strings.TrimSpace(string(runes[:botFailureDetailCharLimit])) + "..."
	}
	return detail
}

func (s *Service) handleApprovalCommand(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (bool, string, error) {
	command, recognized, err := parseBotApprovalCommand(inbound.Text)
	if !recognized {
		return false, "", nil
	}

	if err != nil {
		text := botApprovalCommandHelp(err.Error())
		return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	}
	if s.approvals == nil {
		text := "Bot approval commands are not configured on this server."
		return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	}

	pending := s.approvals.List(connection.WorkspaceID)
	switch command.kind {
	case "list":
		text := renderPendingApprovalsForBot(pending, strings.TrimSpace(conversation.ThreadID))
		return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	case "respond":
		approval, ok := findPendingApprovalByID(pending, command.requestID)
		if !ok {
			text := "Approval request " + command.requestID + " was not found or is no longer pending."
			return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}

		input, err := buildBotApprovalResponseInput(command, approval)
		if err != nil {
			text := err.Error()
			return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}

		resolved, err := s.approvals.Respond(ctx, command.requestID, input)
		if err != nil {
			text := "Approval request " + command.requestID + " could not be processed right now: " + err.Error()
			return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}

		text := renderResolvedApprovalForBot(resolved, input.Action)
		return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	default:
		return false, "", nil
	}
}

func (s *Service) handleConversationCommand(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (bool, store.BotConversation, string, error) {
	command, recognized, err := parseBotConversationCommand(inbound.Text)
	if !recognized {
		return false, conversation, "", nil
	}

	if err != nil {
		text := botConversationCommandHelp(err.Error())
		return true, conversation, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	}

	switch command.kind {
	case "new_thread":
		updatedConversation, text, commandErr := s.startNewConversationThread(ctx, connection, conversation, inbound, command.title)
		if commandErr != nil {
			text = "The bot could not start a new thread right now: " + commandErr.Error()
			return true, conversation, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}
		return true, updatedConversation, text, provider.SendMessages(ctx, connection, updatedConversation, []OutboundMessage{{Text: text}})
	case "show_thread":
		text := s.renderCurrentConversationThread(ctx, connection, conversation)
		return true, conversation, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	case "list_threads":
		text := s.renderKnownConversationThreads(ctx, connection, conversation)
		return true, conversation, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	case "rename_thread":
		updatedConversation, text, commandErr := s.renameConversationThread(ctx, connection, conversation, command.title)
		if commandErr != nil {
			text = "The bot could not rename the current thread right now: " + commandErr.Error()
			return true, conversation, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}
		return true, updatedConversation, text, provider.SendMessages(ctx, connection, updatedConversation, []OutboundMessage{{Text: text}})
	case "archive_thread":
		updatedConversation, text, commandErr := s.archiveConversationThread(ctx, connection, conversation)
		if commandErr != nil {
			text = "The bot could not archive the current thread right now: " + commandErr.Error()
			return true, conversation, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}
		return true, updatedConversation, text, provider.SendMessages(ctx, connection, updatedConversation, []OutboundMessage{{Text: text}})
	case "use_thread":
		updatedConversation, text, commandErr := s.switchConversationThread(ctx, connection, conversation, command.threadID)
		if commandErr != nil {
			text = "The bot could not switch threads right now: " + commandErr.Error()
			return true, conversation, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}
		return true, updatedConversation, text, provider.SendMessages(ctx, connection, updatedConversation, []OutboundMessage{{Text: text}})
	default:
		return false, conversation, "", nil
	}
}

func parseBotApprovalCommand(text string) (botApprovalCommand, bool, error) {
	commandToken, remainder := splitBotCommandText(text)
	if commandToken == "" || !strings.HasPrefix(commandToken, "/") {
		return botApprovalCommand{}, false, nil
	}

	commandName := normalizeBotCommandName(commandToken)
	switch commandName {
	case "approvals":
		return botApprovalCommand{kind: "list"}, true, nil
	case "approve", "decline", "cancel":
		requestID, extra := splitBotCommandText(remainder)
		if requestID == "" {
			return botApprovalCommand{}, true, errors.New("usage: /" + commandName + " <request_id>")
		}
		if strings.TrimSpace(extra) != "" {
			return botApprovalCommand{}, true, errors.New("usage: /" + commandName + " <request_id>")
		}
		return botApprovalCommand{
			kind:      "respond",
			requestID: requestID,
			action:    commandName,
		}, true, nil
	case "answer":
		requestID, answerInput := splitBotCommandText(remainder)
		if requestID == "" || strings.TrimSpace(answerInput) == "" {
			return botApprovalCommand{}, true, errors.New("usage: /answer <request_id> <text> or /answer <request_id> question_id=value; question_id=value")
		}
		return botApprovalCommand{
			kind:        "respond",
			requestID:   requestID,
			action:      "accept",
			answerInput: strings.TrimSpace(answerInput),
		}, true, nil
	default:
		return botApprovalCommand{}, false, nil
	}
}

func parseBotConversationCommand(text string) (botConversationCommand, bool, error) {
	commandToken, remainder := splitBotCommandText(text)
	if commandToken == "" || !strings.HasPrefix(commandToken, "/") {
		return botConversationCommand{}, false, nil
	}

	switch normalizeBotCommandName(commandToken) {
	case "newthread":
		return botConversationCommand{
			kind:  "new_thread",
			title: strings.TrimSpace(remainder),
		}, true, nil
	case "thread":
		subcommand, extra := splitBotCommandText(remainder)
		switch strings.ToLower(strings.TrimSpace(subcommand)) {
		case "":
			return botConversationCommand{kind: "show_thread"}, true, nil
		case "list":
			if strings.TrimSpace(extra) != "" {
				return botConversationCommand{}, true, errors.New("usage: /thread list")
			}
			return botConversationCommand{kind: "list_threads"}, true, nil
		case "rename":
			if strings.TrimSpace(extra) == "" {
				return botConversationCommand{}, true, errors.New("usage: /thread rename <title>")
			}
			return botConversationCommand{kind: "rename_thread", title: strings.TrimSpace(extra)}, true, nil
		case "archive":
			if strings.TrimSpace(extra) != "" {
				return botConversationCommand{}, true, errors.New("usage: /thread archive")
			}
			return botConversationCommand{kind: "archive_thread"}, true, nil
		case "use":
			threadID, trailing := splitBotCommandText(extra)
			if strings.TrimSpace(threadID) == "" || strings.TrimSpace(trailing) != "" {
				return botConversationCommand{}, true, errors.New("usage: /thread use <thread_id>")
			}
			return botConversationCommand{kind: "use_thread", threadID: strings.TrimSpace(threadID)}, true, nil
		default:
			return botConversationCommand{}, true, errors.New("usage: /thread | /thread list | /thread rename <title> | /thread archive | /thread use <thread_id>")
		}
	default:
		return botConversationCommand{}, false, nil
	}
}

func splitBotCommandText(text string) (string, string) {
	trimmed := strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
	if trimmed == "" {
		return "", ""
	}

	index := strings.IndexAny(trimmed, " \t\n")
	if index < 0 {
		return trimmed, ""
	}

	return trimmed[:index], strings.TrimSpace(trimmed[index+1:])
}

func normalizeBotCommandName(token string) string {
	trimmed := strings.TrimSpace(token)
	trimmed = strings.TrimPrefix(trimmed, "/")
	if at := strings.Index(trimmed, "@"); at >= 0 {
		trimmed = trimmed[:at]
	}
	return strings.ToLower(strings.TrimSpace(trimmed))
}

func botApprovalCommandHelp(reason string) string {
	lines := []string{
		"Bot approval commands:",
		"/approvals",
		"/approve <request_id>",
		"/decline <request_id>",
		"/cancel <request_id>",
		"/answer <request_id> <text>",
		"/answer <request_id> question_id=value; question_id=value",
	}
	if strings.TrimSpace(reason) != "" {
		lines = append([]string{"Approval command error: " + strings.TrimSpace(reason)}, lines...)
	}
	return strings.Join(lines, "\n")
}

func botConversationCommandHelp(reason string) string {
	lines := []string{
		"Bot conversation commands:",
		"/newthread [title]",
		"/thread",
		"/thread list",
		"/thread rename <title>",
		"/thread archive",
		"/thread use <thread_id>",
	}
	if strings.TrimSpace(reason) != "" {
		lines = append([]string{"Conversation command error: " + strings.TrimSpace(reason)}, lines...)
	}
	return strings.Join(lines, "\n")
}

func renderPendingApprovalsForBot(items []store.PendingApproval, currentThreadID string) string {
	if len(items) == 0 {
		return "No pending approvals right now."
	}

	ordered := prioritizePendingApprovals(items, currentThreadID)
	lines := []string{"Pending approvals:"}
	limit := minInt(len(ordered), 6)
	for index := 0; index < limit; index++ {
		approval := ordered[index]
		lines = append(lines, formatPendingApprovalLine(index+1, approval))
		for _, helpLine := range approvalCommandHelpLines(approval) {
			lines = append(lines, helpLine)
		}
	}
	if len(ordered) > limit {
		lines = append(lines, "+"+intToString(len(ordered)-limit)+" more pending approval(s)")
	}

	return strings.Join(lines, "\n")
}

func (s *Service) startNewConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
	title string,
) (store.BotConversation, string, error) {
	nextContextVersion := conversationContextVersion(conversation) + 1
	nextThreadID := ""
	responseText := "Started a new conversation context. Future messages in this chat will use a fresh backend session."

	if normalizeAIBackendName(connection.AIBackend) == defaultAIBackend {
		if s.threads == nil {
			return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
		}

		thread, err := s.threads.Create(ctx, connection.WorkspaceID, threads.CreateInput{
			Name:  buildThreadNameWithTarget(connection, firstNonEmpty(strings.TrimSpace(title), strings.TrimSpace(inbound.Title), strings.TrimSpace(inbound.Username), strings.TrimSpace(inbound.ConversationID))),
			Model: strings.TrimSpace(connection.AIConfig["model"]),
		})
		if err != nil {
			return store.BotConversation{}, "", err
		}
		nextThreadID = thread.ID
		responseLines := []string{"Started a new workspace thread: " + nextThreadID}
		if strings.TrimSpace(thread.Name) != "" {
			responseLines = append(responseLines, "Name: "+strings.TrimSpace(thread.Name))
		}
		responseLines = append(responseLines, "Future messages in this chat will use the new thread.")
		responseText = strings.Join(responseLines, "\n")
	}

	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadIDs := appendKnownConversationThreadID(current.BackendState, current.ThreadID)
		knownThreadIDs = appendKnownConversationThreadID(conversationBackendStateWithKnownThreads(nil, knownThreadIDs), nextThreadID)
		current.ThreadID = strings.TrimSpace(nextThreadID)
		current.BackendState = conversationBackendStateWithVersion(
			conversationBackendStateWithKnownThreads(nil, knownThreadIDs),
			nextContextVersion,
		)
		return current
	})
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "started new conversation thread context",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", strings.TrimSpace(updatedConversation.ThreadID)),
		slog.Int("contextVersion", conversationContextVersion(updatedConversation)),
	)

	return updatedConversation, responseText, nil
}

func (s *Service) switchConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	selection string,
) (store.BotConversation, string, error) {
	threadID, err := s.resolveConversationThreadSelection(ctx, connection, conversation, selection)
	if err != nil {
		return store.BotConversation{}, "", err
	}
	if threadID == "" {
		return store.BotConversation{}, "", errors.New("thread id is required")
	}
	if normalizeAIBackendName(connection.AIBackend) == defaultAIBackend {
		if s.threads == nil {
			return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
		}
		if _, err := s.threads.GetDetail(ctx, connection.WorkspaceID, threadID); err != nil {
			return store.BotConversation{}, "", err
		}
	}

	nextContextVersion := conversationContextVersion(conversation) + 1
	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadIDs := appendKnownConversationThreadID(current.BackendState, current.ThreadID)
		knownThreadIDs = appendKnownConversationThreadID(conversationBackendStateWithKnownThreads(nil, knownThreadIDs), threadID)
		current.ThreadID = threadID
		current.BackendState = conversationBackendStateWithVersion(
			conversationBackendStateWithKnownThreads(nil, knownThreadIDs),
			nextContextVersion,
		)
		return current
	})
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "switched conversation thread",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", threadID),
		slog.Int("contextVersion", conversationContextVersion(updatedConversation)),
	)

	return updatedConversation, "Switched the current conversation to thread: " + threadID, nil
}

func (s *Service) renameConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	title string,
) (store.BotConversation, string, error) {
	threadID := strings.TrimSpace(conversation.ThreadID)
	if threadID == "" {
		return store.BotConversation{}, "", errors.New("this conversation is not currently bound to a workspace thread")
	}
	if s.threads == nil {
		return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
	}
	thread, err := s.threads.Rename(ctx, connection.WorkspaceID, threadID, strings.TrimSpace(title))
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "renamed conversation thread",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("threadId", threadID),
		slog.String("threadName", strings.TrimSpace(thread.Name)),
	)

	return conversation, "Renamed the current thread to: " + strings.TrimSpace(thread.Name), nil
}

func (s *Service) archiveConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (store.BotConversation, string, error) {
	threadID := strings.TrimSpace(conversation.ThreadID)
	if threadID == "" {
		return store.BotConversation{}, "", errors.New("this conversation is not currently bound to a workspace thread")
	}
	if s.threads == nil {
		return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
	}
	thread, err := s.threads.Archive(ctx, connection.WorkspaceID, threadID)
	if err != nil {
		return store.BotConversation{}, "", err
	}

	nextContextVersion := conversationContextVersion(conversation) + 1
	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadIDs := appendKnownConversationThreadID(current.BackendState, current.ThreadID)
		current.ThreadID = ""
		current.BackendState = conversationBackendStateWithVersion(
			conversationBackendStateWithKnownThreads(nil, knownThreadIDs),
			nextContextVersion,
		)
		return current
	})
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "archived conversation thread",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", threadID),
		slog.Bool("archived", thread.Archived),
		slog.Int("contextVersion", conversationContextVersion(updatedConversation)),
	)

	return updatedConversation, "Archived the current thread: " + threadID + "\nFuture messages in this chat will require /newthread or /thread use.", nil
}

type botThreadSummary struct {
	ID        string
	Name      string
	Preview   string
	Archived  bool
	UpdatedAt time.Time
}

func (s *Service) renderCurrentConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) string {
	currentThreadID := strings.TrimSpace(conversation.ThreadID)
	if currentThreadID == "" {
		return "This conversation is not currently bound to a workspace thread."
	}

	lines := []string{
		"Current workspace thread: " + currentThreadID,
	}
	if summary, ok := s.lookupConversationThreadSummary(ctx, connection, currentThreadID); ok {
		if summary.Archived {
			lines = append(lines, "Status: archived")
		}
		if strings.TrimSpace(summary.Name) != "" {
			lines = append(lines, "Name: "+summary.Name)
		}
		if preview := formatBotThreadPreview(summary.Preview); preview != "" {
			lines = append(lines, "Preview: "+preview)
		}
		if formatted := formatBotThreadTimestamp(summary.UpdatedAt); formatted != "" {
			lines = append(lines, "Updated: "+formatted)
		}
	}
	if versions := conversationContextVersion(conversation); versions > 0 {
		lines = append(lines, "Conversation context version: "+strconv.Itoa(versions))
	}
	return strings.Join(lines, "\n")
}

func (s *Service) renderKnownConversationThreads(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) string {
	threadIDs := knownConversationThreadIDs(conversation)
	currentThreadID := strings.TrimSpace(conversation.ThreadID)
	if currentThreadID != "" {
		threadIDs = appendKnownConversationThreadID(
			conversationBackendStateWithKnownThreads(nil, threadIDs),
			currentThreadID,
		)
	}
	if len(threadIDs) == 0 {
		return "No workspace threads have been recorded for this conversation yet."
	}

	lines := []string{"Known workspace threads:"}
	for index, threadID := range threadIDs {
		line := fmt.Sprintf("%d. %s", index+1, threadID)
		if threadID == currentThreadID {
			line += " (current)"
		}
		if summary, ok := s.lookupConversationThreadSummary(ctx, connection, threadID); ok {
			if summary.Archived {
				line += " (archived)"
			}
			if strings.TrimSpace(summary.Name) != "" {
				line += " | " + summary.Name
			}
			if preview := formatBotThreadPreview(summary.Preview); preview != "" {
				line += " | " + preview
			}
			if formatted := formatBotThreadTimestamp(summary.UpdatedAt); formatted != "" {
				line += " | updated " + formatted
			}
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

func (s *Service) resolveConversationThreadSelection(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	selection string,
) (string, error) {
	selection = strings.TrimSpace(selection)
	if selection == "" {
		return "", errors.New("thread id is required")
	}

	threadIDs := knownConversationThreadIDs(conversation)
	if currentThreadID := strings.TrimSpace(conversation.ThreadID); currentThreadID != "" {
		threadIDs = appendKnownConversationThreadID(
			conversationBackendStateWithKnownThreads(nil, threadIDs),
			currentThreadID,
		)
	}

	for _, threadID := range threadIDs {
		if threadID == selection {
			if summary, ok := s.lookupConversationThreadSummary(ctx, connection, threadID); ok && summary.Archived {
				return "", fmt.Errorf("thread %q is archived; start a new thread or use an active thread instead", threadID)
			}
			return threadID, nil
		}
	}

	index, err := strconv.Atoi(selection)
	if err == nil && index >= 1 && index <= len(threadIDs) {
		threadID := threadIDs[index-1]
		if summary, ok := s.lookupConversationThreadSummary(ctx, connection, threadID); ok && summary.Archived {
			return "", fmt.Errorf("thread %q is archived; start a new thread or use an active thread instead", threadID)
		}
		return threadID, nil
	}

	if normalizeAIBackendName(connection.AIBackend) == defaultAIBackend && s.threads != nil {
		if detail, err := s.threads.GetDetail(ctx, connection.WorkspaceID, selection); err == nil {
			if detail.Archived {
				return "", fmt.Errorf("thread %q is archived; start a new thread or use an active thread instead", selection)
			}
			return selection, nil
		}
	}

	return "", fmt.Errorf("thread %q is not known in this conversation; use /thread list to inspect available threads", selection)
}

func (s *Service) lookupConversationThreadSummary(
	ctx context.Context,
	connection store.BotConnection,
	threadID string,
) (botThreadSummary, bool) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" || s.threads == nil {
		return botThreadSummary{}, false
	}

	detail, err := s.threads.GetDetail(ctx, connection.WorkspaceID, threadID)
	if err != nil {
		return botThreadSummary{}, false
	}
	return botThreadSummary{
		ID:        threadID,
		Name:      strings.TrimSpace(detail.Name),
		Preview:   strings.TrimSpace(detail.Preview),
		Archived:  detail.Archived,
		UpdatedAt: detail.UpdatedAt,
	}, true
}

func formatBotThreadTimestamp(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format("2006-01-02 15:04:05 MST")
}

func formatBotThreadPreview(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if value == "" {
		return ""
	}
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) <= 120 {
		return value
	}
	return strings.TrimSpace(string(runes[:120])) + "..."
}

func prioritizePendingApprovals(items []store.PendingApproval, currentThreadID string) []store.PendingApproval {
	if len(items) == 0 {
		return nil
	}

	ordered := append([]store.PendingApproval(nil), items...)
	currentThreadID = strings.TrimSpace(currentThreadID)
	if currentThreadID == "" {
		return ordered
	}

	sort.SliceStable(ordered, func(i int, j int) bool {
		leftCurrent := strings.TrimSpace(ordered[i].ThreadID) == currentThreadID
		rightCurrent := strings.TrimSpace(ordered[j].ThreadID) == currentThreadID
		if leftCurrent != rightCurrent {
			return leftCurrent
		}
		return ordered[i].RequestedAt.After(ordered[j].RequestedAt)
	})
	return ordered
}

func formatPendingApprovalLine(index int, approval store.PendingApproval) string {
	parts := []string{
		intToString(index) + ".",
		approval.ID,
		"(" + humanizeApprovalKind(approval.Kind) + ")",
		strings.TrimSpace(approval.Summary),
	}
	if strings.TrimSpace(approval.ThreadID) != "" {
		parts = append(parts, "thread="+strings.TrimSpace(approval.ThreadID))
	}
	return strings.Join(parts, " ")
}

func approvalCommandHelpLines(approval store.PendingApproval) []string {
	requestID := strings.TrimSpace(approval.ID)
	if requestID == "" {
		return nil
	}
	helpLines := botPendingApprovalHelpLines(approval.Kind, requestID, objectValue(approval.Details))
	if len(helpLines) == 0 {
		return nil
	}
	indented := make([]string, 0, len(helpLines))
	for _, line := range helpLines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		indented = append(indented, "   "+line)
	}
	return indented
}

func findPendingApprovalByID(items []store.PendingApproval, requestID string) (store.PendingApproval, bool) {
	target := strings.TrimSpace(requestID)
	for _, item := range items {
		if strings.TrimSpace(item.ID) == target {
			return item, true
		}
	}
	return store.PendingApproval{}, false
}

func buildBotApprovalResponseInput(command botApprovalCommand, approval store.PendingApproval) (approvals.ResponseInput, error) {
	input := approvals.ResponseInput{Action: normalizeBotApprovalAction(command.action)}

	switch approval.Kind {
	case "item/tool/requestUserInput":
		if command.action != "accept" {
			return input, nil
		}
		answers, err := parseBotApprovalAnswers(approval, command.answerInput)
		if err != nil {
			return approvals.ResponseInput{}, err
		}
		input.Answers = answers
		return input, nil
	case "mcpServer/elicitation/request", "item/tool/call":
		if command.action != "accept" {
			return input, nil
		}
		if strings.TrimSpace(command.answerInput) == "" {
			return approvals.ResponseInput{}, errors.New("this request needs input. Use /answer " + approval.ID + " <text>")
		}
		input.Content = strings.TrimSpace(command.answerInput)
		return input, nil
	case "account/chatgptAuthTokens/refresh":
		return approvals.ResponseInput{}, errors.New("this request cannot be completed from Telegram; use the workspace UI instead")
	default:
		if strings.TrimSpace(command.answerInput) != "" {
			return approvals.ResponseInput{}, errors.New("this request does not take free-form input. Use /approve " + approval.ID + " or /decline " + approval.ID)
		}
		return input, nil
	}
}

func parseBotApprovalAnswers(approval store.PendingApproval, raw string) (map[string][]string, error) {
	questions := approvalQuestionIDs(approval.Details)
	if len(questions) == 0 {
		return nil, errors.New("this request does not expose answer fields")
	}

	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("answers are required. Use /answer " + approval.ID + " <text>")
	}

	if len(questions) == 1 && !strings.Contains(trimmed, "=") && !strings.Contains(trimmed, ";") && !strings.Contains(trimmed, "\n") {
		return map[string][]string{
			questions[0]: {trimmed},
		}, nil
	}

	allowed := make(map[string]struct{}, len(questions))
	for _, questionID := range questions {
		allowed[questionID] = struct{}{}
	}

	answers := make(map[string][]string, len(questions))
	for _, entry := range splitBotAnswerAssignments(trimmed) {
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			return nil, errors.New("multi-question answers must use question_id=value; question_id=value")
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			return nil, errors.New("multi-question answers must use question_id=value; question_id=value")
		}
		if _, ok := allowed[key]; !ok {
			return nil, errors.New("unknown question id " + key)
		}
		answers[key] = []string{value}
	}

	for _, questionID := range questions {
		if _, ok := answers[questionID]; !ok {
			return nil, errors.New("missing answer for question " + questionID)
		}
	}

	return answers, nil
}

func splitBotAnswerAssignments(value string) []string {
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\n", ";")
	rawItems := strings.Split(normalized, ";")
	items := make([]string, 0, len(rawItems))
	for _, rawItem := range rawItems {
		item := strings.TrimSpace(rawItem)
		if item != "" {
			items = append(items, item)
		}
	}
	return items
}

func approvalQuestionIDs(details any) []string {
	object, _ := details.(map[string]any)
	if len(object) == 0 {
		return nil
	}
	rawQuestions, ok := object["questions"].([]any)
	if !ok {
		return nil
	}

	questionIDs := make([]string, 0, len(rawQuestions))
	for _, rawQuestion := range rawQuestions {
		question, _ := rawQuestion.(map[string]any)
		questionID := strings.TrimSpace(stringValueAny(question["id"]))
		if questionID != "" {
			questionIDs = append(questionIDs, questionID)
		}
	}
	return questionIDs
}

func renderResolvedApprovalForBot(approval store.PendingApproval, action string) string {
	line := "Approval request " + approval.ID + " was " + botApprovalActionLabel(action) + "."
	if summary := strings.TrimSpace(approval.Summary); summary != "" {
		line += "\n" + summary
	}
	line += "\nThe waiting thread should continue if it was blocked on this request."
	return line
}

func normalizeBotApprovalAction(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "approve":
		return "accept"
	default:
		return strings.ToLower(strings.TrimSpace(action))
	}
}

func botApprovalActionLabel(action string) string {
	switch normalizeBotApprovalAction(action) {
	case "accept":
		return "approved"
	case "decline":
		return "declined"
	case "cancel":
		return "canceled"
	default:
		if trimmed := strings.TrimSpace(action); trimmed != "" {
			return trimmed
		}
		return "handled"
	}
}

func humanizeApprovalKind(kind string) string {
	switch kind {
	case "item/commandExecution/requestApproval", "execCommandApproval":
		return "Command Approval"
	case "item/fileChange/requestApproval", "applyPatchApproval":
		return "File Change Approval"
	case "item/tool/requestUserInput":
		return "User Input Request"
	case "item/permissions/requestApproval":
		return "Permissions Request"
	case "mcpServer/elicitation/request":
		return "MCP Input Request"
	case "item/tool/call":
		return "Tool Response Request"
	case "account/chatgptAuthTokens/refresh":
		return "Auth Refresh Request"
	default:
		return "Approval"
	}
}

func intToString(value int) string {
	return strconv.Itoa(value)
}

func stringValueAny(value any) string {
	text, _ := value.(string)
	return text
}

func (s *Service) acceptInboundMessage(connection store.BotConnection, message InboundMessage) (bool, error) {
	if strings.TrimSpace(message.Text) == "" || strings.TrimSpace(message.ConversationID) == "" {
		return false, nil
	}

	delivery, shouldEnqueue, err := s.store.UpsertBotInboundDelivery(store.BotInboundDelivery{
		WorkspaceID:            connection.WorkspaceID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: strings.TrimSpace(message.ConversationID),
		ExternalChatID:         firstNonEmpty(strings.TrimSpace(message.ExternalChatID), strings.TrimSpace(message.ConversationID)),
		ExternalThreadID:       strings.TrimSpace(message.ExternalThreadID),
		MessageID:              strings.TrimSpace(message.MessageID),
		UserID:                 strings.TrimSpace(message.UserID),
		Username:               strings.TrimSpace(message.Username),
		Title:                  strings.TrimSpace(message.Title),
		Text:                   strings.TrimSpace(message.Text),
	})
	if err != nil {
		return false, err
	}
	if !shouldEnqueue {
		return false, nil
	}

	s.enqueueJob(inboundJob{
		connectionID: connection.ID,
		deliveryID:   delivery.ID,
		message:      inboundMessageFromDelivery(delivery),
	})
	s.publishMessageReceived(connection, message)
	return true, nil
}

func (s *Service) recoverPendingInboundDeliveries(workspaceID string, connectionID string) {
	for _, delivery := range s.store.PrepareBotInboundDeliveriesForRecovery(workspaceID, connectionID) {
		connection, ok := s.store.FindBotConnection(delivery.ConnectionID)
		if !ok || !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
			continue
		}
		s.enqueueJob(inboundJob{
			connectionID: delivery.ConnectionID,
			deliveryID:   delivery.ID,
			message:      inboundMessageFromDelivery(delivery),
		})
	}
}

func (s *Service) recordConversationOutcome(
	connection store.BotConnection,
	conversation store.BotConversation,
	reply AIResult,
	inbound InboundMessage,
	fallbackOutboundText string,
) store.BotConversation {
	lastOutboundText := strings.TrimSpace(fallbackOutboundText)
	if len(reply.Messages) > 0 {
		lastOutboundText = strings.TrimSpace(reply.Messages[len(reply.Messages)-1].Text)
	}
	expectedContextVersion := conversationContextVersion(conversation)

	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		currentContextVersion := conversationContextVersion(current)
		if currentContextVersion != expectedContextVersion {
			return current
		}

		if strings.TrimSpace(reply.ThreadID) != "" {
			current.ThreadID = reply.ThreadID
		}
		current.BackendState = mergeConversationBackendState(current.BackendState, reply.BackendState, currentContextVersion)
		if strings.TrimSpace(reply.ThreadID) != "" {
			current.BackendState = conversationBackendStateWithVersion(
				conversationBackendStateWithKnownThreads(
					current.BackendState,
					appendKnownConversationThreadID(current.BackendState, reply.ThreadID),
				),
				currentContextVersion,
			)
		}
		current.LastInboundMessageID = strings.TrimSpace(inbound.MessageID)
		current.LastInboundText = strings.TrimSpace(inbound.Text)
		current.LastOutboundText = lastOutboundText
		return current
	})
	if err != nil {
		updatedConversation = conversation
		if strings.TrimSpace(reply.ThreadID) != "" && conversationContextVersion(updatedConversation) == expectedContextVersion {
			updatedConversation.ThreadID = reply.ThreadID
		}
		updatedConversation.BackendState = mergeConversationBackendState(updatedConversation.BackendState, reply.BackendState, expectedContextVersion)
		if strings.TrimSpace(reply.ThreadID) != "" && conversationContextVersion(updatedConversation) == expectedContextVersion {
			updatedConversation.BackendState = conversationBackendStateWithVersion(
				conversationBackendStateWithKnownThreads(
					updatedConversation.BackendState,
					appendKnownConversationThreadID(updatedConversation.BackendState, reply.ThreadID),
				),
				expectedContextVersion,
			)
		}
		if conversationContextVersion(updatedConversation) == expectedContextVersion {
			updatedConversation.LastInboundMessageID = strings.TrimSpace(inbound.MessageID)
			updatedConversation.LastInboundText = strings.TrimSpace(inbound.Text)
			updatedConversation.LastOutboundText = lastOutboundText
		}
	}
	return updatedConversation
}

func inboundMessageFromDelivery(delivery store.BotInboundDelivery) InboundMessage {
	return InboundMessage{
		ConversationID:   firstNonEmpty(strings.TrimSpace(delivery.ExternalConversationID), strings.TrimSpace(delivery.ExternalChatID)),
		ExternalChatID:   strings.TrimSpace(delivery.ExternalChatID),
		ExternalThreadID: strings.TrimSpace(delivery.ExternalThreadID),
		MessageID:        strings.TrimSpace(delivery.MessageID),
		UserID:           strings.TrimSpace(delivery.UserID),
		Username:         strings.TrimSpace(delivery.Username),
		Title:            strings.TrimSpace(delivery.Title),
		Text:             strings.TrimSpace(delivery.Text),
	}
}

func aiResultFromDelivery(delivery store.BotInboundDelivery) (AIResult, bool) {
	if len(delivery.ReplyTexts) == 0 {
		return AIResult{}, false
	}

	messages := make([]OutboundMessage, 0, len(delivery.ReplyTexts))
	for _, text := range delivery.ReplyTexts {
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		messages = append(messages, OutboundMessage{Text: text})
	}
	if len(messages) == 0 {
		return AIResult{}, false
	}

	return AIResult{
		ThreadID: strings.TrimSpace(delivery.ReplyThreadID),
		Messages: messages,
	}, true
}

func outboundMessageTexts(messages []OutboundMessage) []string {
	if len(messages) == 0 {
		return nil
	}

	texts := make([]string, 0, len(messages))
	for _, message := range messages {
		text := strings.TrimSpace(message.Text)
		if text == "" {
			continue
		}
		texts = append(texts, text)
	}
	return texts
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
