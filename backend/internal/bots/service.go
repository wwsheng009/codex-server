package bots

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
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
	defaultWorkerQueueSize             = 32
	defaultWorkerIdleTimeout           = 2 * time.Minute
	defaultStreamingPendingText        = "Working..."
	defaultStreamingFailureText        = "The bot could not process your message right now.\nTechnical details: no additional error details were available from the bot backend."
	botFailureDetailCharLimit          = 1200
	botConversationContextKey          = "_bot_context_version"
	botConversationThreadListKey       = "_bot_known_thread_ids"
	botSuppressionNotificationCooldown = 15 * time.Minute
	botReplyDeliveryStatusSending      = "sending"
	botReplyDeliveryStatusRetrying     = "retrying"
	botReplyDeliveryStatusDelivered    = "delivered"
	botReplyDeliveryStatusFailed       = "failed"
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
	wechatAuth    *wechatAuthService

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
	filter   string
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
	attemptCount int
	cause        error
}

type replyDeliveryRetryableError struct {
	cause error
}

type conversationReplyDeliveryState struct {
	status       string
	attemptCount int
	lastError    string
	deliveredAt  *time.Time
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
	if e.attemptCount > 1 {
		label += fmt.Sprintf(" after %d attempts", e.attemptCount)
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

func (e *replyDeliveryRetryableError) Error() string {
	if e == nil || e.cause == nil {
		return "bot reply delivery retryable failure"
	}
	return e.cause.Error()
}

func (e *replyDeliveryRetryableError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func markReplyDeliveryRetryable(err error) error {
	if err == nil {
		return nil
	}
	var retryable *replyDeliveryRetryableError
	if errors.As(err, &retryable) {
		return err
	}
	return &replyDeliveryRetryableError{cause: err}
}

func isReplyDeliveryRetryable(err error) bool {
	var retryable *replyDeliveryRetryableError
	return errors.As(err, &retryable)
}

func unwrapReplyDeliveryRetryable(err error) error {
	var retryable *replyDeliveryRetryableError
	if errors.As(err, &retryable) && retryable.cause != nil {
		return retryable.cause
	}
	return err
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
		wechatAuth:        newWeChatAuthService(clientSource),
		workers:           make(map[string]*inboundWorker),
		pollers:           make(map[string]*pollerHandle),
		messageTimeout:    cfg.MessageTimeout,
		queueSize:         defaultWorkerQueueSize,
		workerIdleTimeout: defaultWorkerIdleTimeout,
	}

	service.registerProvider(newTelegramProviderWithClientSource(clientSource))
	service.registerProvider(newWeChatProviderWithClientSource(clientSource))
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
		resolvedConnection, _, _, err := s.ensureConnectionBotResources(item)
		if err != nil {
			resolvedConnection = item
		}
		views = append(views, connectionViewFromStore(resolvedConnection))
	}
	return views
}

func (s *Service) GetConnection(workspaceID string, connectionID string) (ConnectionView, error) {
	connection, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return ConnectionView{}, store.ErrBotConnectionNotFound
	}

	connection, _, _, err := s.ensureConnectionBotResources(connection)
	if err != nil {
		return ConnectionView{}, err
	}

	return connectionViewFromStore(connection), nil
}

func (s *Service) ListBots(workspaceID string) []BotView {
	items := s.store.ListBotConnections(workspaceID)
	for _, item := range items {
		_, _, _, _ = s.ensureConnectionBotResources(item)
	}

	botsList := s.store.ListBots(workspaceID)
	connections := s.store.ListBotConnections(workspaceID)
	conversations := s.store.ListBotConversations(workspaceID, "")
	endpointCountByBotID := make(map[string]int, len(connections))
	conversationCountByBotID := make(map[string]int, len(conversations))
	for _, connection := range connections {
		if botID := strings.TrimSpace(connection.BotID); botID != "" {
			endpointCountByBotID[botID]++
		}
	}
	for _, conversation := range conversations {
		if botID := strings.TrimSpace(conversation.BotID); botID != "" {
			conversationCountByBotID[botID]++
		}
	}

	views := make([]BotView, 0, len(botsList))
	for _, bot := range botsList {
		defaultBinding, _ := s.store.GetBotBinding(bot.WorkspaceID, bot.DefaultBindingID)
		views = append(views, botViewFromStore(
			bot,
			defaultBinding,
			endpointCountByBotID[bot.ID],
			conversationCountByBotID[bot.ID],
		))
	}
	return views
}

func (s *Service) ListBotBindings(workspaceID string, botID string) ([]BotBindingView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}
	bot, ok := s.store.GetBot(resolvedWorkspaceID, botID)
	if !ok {
		return nil, store.ErrBotNotFound
	}

	items := s.store.ListBotBindings(resolvedWorkspaceID, botID)
	views := make([]BotBindingView, 0, len(items))
	for _, item := range items {
		views = append(views, botBindingViewFromStore(item, strings.TrimSpace(bot.DefaultBindingID) == strings.TrimSpace(item.ID)))
	}
	return views, nil
}

func (s *Service) UpdateBotDefaultBinding(
	ctx context.Context,
	workspaceID string,
	botID string,
	input UpdateBotDefaultBindingInput,
) (BotBindingView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return BotBindingView{}, err
	}
	bot, ok := s.store.GetBot(resolvedWorkspaceID, botID)
	if !ok {
		return BotBindingView{}, store.ErrBotNotFound
	}

	connections := s.store.ListBotConnections(resolvedWorkspaceID)
	var primaryConnection store.BotConnection
	for _, connection := range connections {
		if strings.TrimSpace(connection.BotID) == strings.TrimSpace(bot.ID) {
			primaryConnection = connection
			break
		}
	}
	if strings.TrimSpace(primaryConnection.ID) == "" {
		return BotBindingView{}, fmt.Errorf("%w: bot does not have an endpoint yet", ErrInvalidInput)
	}
	primaryConnection, bot, currentBinding, err := s.ensureConnectionBotResources(primaryConnection)
	if err != nil {
		return BotBindingView{}, err
	}

	mode := normalizeBotBindingMode(input.BindingMode, primaryConnection.AIBackend)
	switch mode {
	case "fixed_thread":
		targetWorkspaceID := firstNonEmpty(strings.TrimSpace(input.TargetWorkspaceID), resolvedWorkspaceID)
		if targetWorkspaceID != resolvedWorkspaceID {
			return BotBindingView{}, fmt.Errorf("%w: cross-workspace default bindings require phase 3 execution support", ErrInvalidInput)
		}
		targetThreadID := strings.TrimSpace(input.TargetThreadID)
		if targetThreadID == "" {
			return BotBindingView{}, fmt.Errorf("%w: targetThreadId is required for fixed_thread bindings", ErrInvalidInput)
		}
		if s.threads == nil {
			return BotBindingView{}, fmt.Errorf("%w: workspace thread service is not configured", ErrInvalidInput)
		}
		if _, err := s.threads.GetDetail(ctx, resolvedWorkspaceID, targetThreadID); err != nil {
			return BotBindingView{}, err
		}
	case "workspace_auto_thread", "stateless":
	default:
		return BotBindingView{}, fmt.Errorf("%w: unsupported binding mode %q", ErrInvalidInput, input.BindingMode)
	}

	updatedBinding, err := s.store.UpdateBotBinding(resolvedWorkspaceID, currentBinding.ID, func(binding store.BotBinding) store.BotBinding {
		binding.Name = firstNonEmpty(strings.TrimSpace(input.Name), binding.Name, "Default Binding")
		binding.BindingMode = mode
		binding.TargetWorkspaceID = resolvedWorkspaceID
		if mode == "fixed_thread" {
			binding.TargetThreadID = strings.TrimSpace(input.TargetThreadID)
		} else {
			binding.TargetThreadID = ""
		}
		binding.AIBackend = normalizeAIBackendName(primaryConnection.AIBackend)
		binding.AIConfig = cloneStringMapLocal(primaryConnection.AIConfig)
		return binding
	})
	if err != nil {
		return BotBindingView{}, err
	}

	s.publish(resolvedWorkspaceID, "", "bot/binding/default_updated", map[string]any{
		"botId":       bot.ID,
		"bindingId":   updatedBinding.ID,
		"bindingMode": updatedBinding.BindingMode,
	})

	return botBindingViewFromStore(updatedBinding, true), nil
}

func (s *Service) ListConnectionLogs(workspaceID string, connectionID string) ([]store.BotConnectionLogEntry, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}
	if _, ok := s.store.GetBotConnection(resolvedWorkspaceID, connectionID); !ok {
		return nil, store.ErrBotConnectionNotFound
	}

	return s.store.ListBotConnectionLogs(resolvedWorkspaceID, connectionID), nil
}

func (s *Service) ListConversations(workspaceID string, connectionID string) []store.BotConversation {
	return s.store.ListBotConversations(workspaceID, connectionID)
}

func (s *Service) ListConversationViews(workspaceID string, connectionID string) []ConversationView {
	items := s.store.ListBotConversations(workspaceID, connectionID)
	views := make([]ConversationView, 0, len(items))
	for _, item := range items {
		binding, ok := s.resolveConversationBinding(item)
		views = append(views, conversationViewFromStore(item, binding, ok))
	}
	return views
}

func (s *Service) ReplayLatestFailedReply(
	ctx context.Context,
	workspaceID string,
	connectionID string,
	conversationID string,
) (ConversationView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return ConversationView{}, err
	}

	connection, ok := s.store.GetBotConnection(resolvedWorkspaceID, connectionID)
	if !ok {
		return ConversationView{}, store.ErrBotConnectionNotFound
	}
	connection, _, _, err = s.ensureConnectionBotResources(connection)
	if err != nil {
		return ConversationView{}, err
	}
	if !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
		return ConversationView{}, fmt.Errorf("%w: bot connection must be active before replaying a failed reply", ErrInvalidInput)
	}

	conversation, ok := s.store.GetBotConversation(resolvedWorkspaceID, conversationID)
	if !ok || conversation.ConnectionID != connection.ID {
		return ConversationView{}, store.ErrBotConversationNotFound
	}

	failedDelivery, ok := s.store.FindLatestFailedBotInboundDeliveryWithSavedReply(
		resolvedWorkspaceID,
		connection.ID,
		firstNonEmpty(strings.TrimSpace(conversation.ExternalConversationID), strings.TrimSpace(conversation.ExternalChatID)),
		"",
	)
	if !ok {
		return ConversationView{}, store.ErrBotInboundDeliveryNotFound
	}

	logBotDebug(ctx, connection, "manually replaying failed reply",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("failedDeliveryId", failedDelivery.ID),
		slog.String("failedMessageId", strings.TrimSpace(failedDelivery.MessageID)),
	)
	if err := s.processInboundMessage(ctx, connection.ID, failedDelivery.ID); err != nil {
		s.appendConnectionLog(
			connection.WorkspaceID,
			connection.ID,
			"error",
			"reply_delivery_replay_failed",
			fmt.Sprintf(
				"Manual replay could not redeliver failed delivery %s for original message %s: %s",
				failedDelivery.ID,
				firstNonEmpty(strings.TrimSpace(failedDelivery.MessageID), "unknown"),
				failureReplyDetail(err),
			),
		)
		return ConversationView{}, err
	}

	updatedConversation, ok := s.store.GetBotConversation(resolvedWorkspaceID, conversation.ID)
	if !ok {
		updatedConversation = conversation
	}

	s.appendConnectionLog(
		connection.WorkspaceID,
		connection.ID,
		"success",
		"reply_delivery_replayed",
		fmt.Sprintf(
			"Manually replayed failed delivery %s for original message %s.",
			failedDelivery.ID,
			firstNonEmpty(strings.TrimSpace(failedDelivery.MessageID), "unknown"),
		),
	)
	s.setConnectionLastError(connection.WorkspaceID, connection.ID, "")

	binding, hasBinding := s.resolveConversationBinding(updatedConversation)
	return conversationViewFromStore(updatedConversation, binding, hasBinding), nil
}

func (s *Service) UpdateConversationBinding(
	ctx context.Context,
	workspaceID string,
	connectionID string,
	conversationID string,
	input UpdateConversationBindingInput,
) (ConversationView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return ConversationView{}, err
	}

	connection, ok := s.store.GetBotConnection(resolvedWorkspaceID, connectionID)
	if !ok {
		return ConversationView{}, store.ErrBotConnectionNotFound
	}
	connection, bot, _, err := s.ensureConnectionBotResources(connection)
	if err != nil {
		return ConversationView{}, err
	}
	if normalizeAIBackendName(connection.AIBackend) != defaultAIBackend {
		return ConversationView{}, fmt.Errorf("%w: conversation thread binding management is only available for workspace_thread bot connections", ErrInvalidInput)
	}

	conversation, ok := s.store.GetBotConversation(resolvedWorkspaceID, conversationID)
	if !ok || conversation.ConnectionID != connection.ID {
		return ConversationView{}, store.ErrBotConversationNotFound
	}
	conversation = s.ensureConversationBotIdentity(conversation, connection)

	switch {
	case input.CreateThread && strings.TrimSpace(input.ThreadID) != "":
		return ConversationView{}, fmt.Errorf("%w: provide either threadId or createThread, not both", ErrInvalidInput)
	case !input.CreateThread && strings.TrimSpace(input.ThreadID) == "":
		return ConversationView{}, fmt.Errorf("%w: threadId is required when createThread is false", ErrInvalidInput)
	}

	var updatedConversation store.BotConversation
	switch {
	case input.CreateThread:
		updatedConversation, _, err = s.startNewConversationThread(ctx, connection, conversation, inboundMessageFromConversation(conversation), input.Title)
	default:
		updatedConversation, _, err = s.switchConversationThread(ctx, connection, conversation, input.ThreadID)
	}
	if err != nil {
		return ConversationView{}, err
	}

	targetThreadID := strings.TrimSpace(updatedConversation.ThreadID)
	bindingName := firstNonEmpty(strings.TrimSpace(input.Title), "Session Binding")
	switch {
	case input.CreateThread:
		bindingName = firstNonEmpty(strings.TrimSpace(input.Title), "Session Binding")
	default:
		bindingName = "Session Binding"
	}
	sessionBinding, err := s.store.CreateBotBinding(store.BotBinding{
		ID:                store.NewID("bbd"),
		WorkspaceID:       resolvedWorkspaceID,
		BotID:             bot.ID,
		Name:              bindingName,
		BindingMode:       "fixed_thread",
		TargetWorkspaceID: resolvedWorkspaceID,
		TargetThreadID:    targetThreadID,
		AIBackend:         normalizeAIBackendName(connection.AIBackend),
		AIConfig:          cloneStringMapLocal(connection.AIConfig),
	})
	if err != nil {
		return ConversationView{}, err
	}
	updatedConversation, err = s.store.UpdateBotConversation(resolvedWorkspaceID, updatedConversation.ID, func(current store.BotConversation) store.BotConversation {
		current.BotID = bot.ID
		current.BindingID = sessionBinding.ID
		return current
	})
	if err != nil {
		return ConversationView{}, err
	}

	s.publish(updatedConversation.WorkspaceID, "", "bot/conversation/binding_updated", map[string]any{
		"connectionId":   updatedConversation.ConnectionID,
		"conversationId": updatedConversation.ID,
		"bindingId":      sessionBinding.ID,
		"threadId":       strings.TrimSpace(updatedConversation.ThreadID),
	})

	return conversationViewFromStore(updatedConversation, sessionBinding, true), nil
}

func (s *Service) ClearConversationBinding(
	ctx context.Context,
	workspaceID string,
	connectionID string,
	conversationID string,
) (ConversationView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return ConversationView{}, err
	}

	connection, ok := s.store.GetBotConnection(resolvedWorkspaceID, connectionID)
	if !ok {
		return ConversationView{}, store.ErrBotConnectionNotFound
	}
	connection, _, _, err = s.ensureConnectionBotResources(connection)
	if err != nil {
		return ConversationView{}, err
	}
	if normalizeAIBackendName(connection.AIBackend) != defaultAIBackend {
		return ConversationView{}, fmt.Errorf("%w: conversation thread binding management is only available for workspace_thread bot connections", ErrInvalidInput)
	}

	conversation, ok := s.store.GetBotConversation(resolvedWorkspaceID, conversationID)
	if !ok || conversation.ConnectionID != connection.ID {
		return ConversationView{}, store.ErrBotConversationNotFound
	}
	conversation = s.ensureConversationBotIdentity(conversation, connection)
	if strings.TrimSpace(conversation.ThreadID) == "" {
		binding, hasBinding := s.resolveConversationBinding(conversation)
		return conversationViewFromStore(conversation, binding, hasBinding), nil
	}

	updatedConversation, _, err := s.clearConversationThreadBinding(ctx, connection, conversation)
	if err != nil {
		return ConversationView{}, err
	}
	updatedConversation, err = s.store.UpdateBotConversation(resolvedWorkspaceID, updatedConversation.ID, func(current store.BotConversation) store.BotConversation {
		current.BotID = conversation.BotID
		current.BindingID = ""
		return current
	})
	if err != nil {
		return ConversationView{}, err
	}

	s.publish(updatedConversation.WorkspaceID, "", "bot/conversation/binding_cleared", map[string]any{
		"connectionId":   updatedConversation.ConnectionID,
		"conversationId": updatedConversation.ID,
	})

	binding, hasBinding := s.resolveConversationBinding(updatedConversation)
	return conversationViewFromStore(updatedConversation, binding, hasBinding), nil
}

func (s *Service) requireWorkspaceID(workspaceID string) (string, error) {
	resolvedWorkspaceID := strings.TrimSpace(workspaceID)
	if resolvedWorkspaceID == "" {
		return "", store.ErrWorkspaceNotFound
	}
	if _, ok := s.store.GetWorkspace(resolvedWorkspaceID); !ok {
		return "", store.ErrWorkspaceNotFound
	}
	return resolvedWorkspaceID, nil
}

func normalizeBotBindingMode(value string, aiBackend string) string {
	switch normalizeAIBackendName(aiBackend) {
	case openAIResponsesBackendName:
		return "stateless"
	default:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "fixed_thread":
			return "fixed_thread"
		case "workspace_auto_thread":
			return "workspace_auto_thread"
		default:
			return "workspace_auto_thread"
		}
	}
}

func defaultBotBindingName(botName string) string {
	return firstNonEmpty(strings.TrimSpace(botName), "Bot") + " Default Binding"
}

func (s *Service) ensureConnectionBotResources(connection store.BotConnection) (store.BotConnection, store.Bot, store.BotBinding, error) {
	connection = cloneBotConnectionStoreValue(connection)
	if strings.TrimSpace(connection.BotID) == "" {
		return s.provisionBotResourcesForConnection(connection)
	}

	bot, ok := s.store.GetBot(connection.WorkspaceID, connection.BotID)
	if !ok {
		return s.provisionBotResourcesForConnection(connection)
	}

	defaultBinding, ok := s.store.GetBotBinding(connection.WorkspaceID, bot.DefaultBindingID)
	if !ok {
		defaultBinding, err := s.store.CreateBotBinding(store.BotBinding{
			ID:                store.NewID("bbd"),
			WorkspaceID:       connection.WorkspaceID,
			BotID:             bot.ID,
			Name:              defaultBotBindingName(connection.Name),
			BindingMode:       normalizeBotBindingMode("", connection.AIBackend),
			TargetWorkspaceID: connection.WorkspaceID,
			AIBackend:         normalizeAIBackendName(connection.AIBackend),
			AIConfig:          cloneStringMapLocal(connection.AIConfig),
		})
		if err != nil {
			return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
		}
		bot, err = s.store.UpdateBot(connection.WorkspaceID, bot.ID, func(current store.Bot) store.Bot {
			current.DefaultBindingID = defaultBinding.ID
			current.Name = firstNonEmpty(strings.TrimSpace(current.Name), strings.TrimSpace(connection.Name))
			current.Status = firstNonEmpty(strings.TrimSpace(connection.Status), strings.TrimSpace(current.Status))
			return current
		})
		if err != nil {
			return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
		}
		return connection, bot, defaultBinding, nil
	}

	botNeedsUpdate := strings.TrimSpace(bot.Name) != strings.TrimSpace(connection.Name) || strings.TrimSpace(bot.Status) != strings.TrimSpace(connection.Status)
	if botNeedsUpdate {
		var err error
		bot, err = s.store.UpdateBot(connection.WorkspaceID, bot.ID, func(current store.Bot) store.Bot {
			current.Name = firstNonEmpty(strings.TrimSpace(connection.Name), strings.TrimSpace(current.Name))
			current.Status = firstNonEmpty(strings.TrimSpace(connection.Status), strings.TrimSpace(current.Status))
			return current
		})
		if err != nil {
			return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
		}
	}

	expectedMode := normalizeBotBindingMode(defaultBinding.BindingMode, connection.AIBackend)
	if strings.TrimSpace(defaultBinding.Name) != defaultBotBindingName(connection.Name) ||
		strings.TrimSpace(defaultBinding.BindingMode) != expectedMode ||
		strings.TrimSpace(defaultBinding.AIBackend) != normalizeAIBackendName(connection.AIBackend) ||
		!reflect.DeepEqual(defaultBinding.AIConfig, cloneStringMapLocal(connection.AIConfig)) ||
		strings.TrimSpace(defaultBinding.TargetWorkspaceID) != strings.TrimSpace(connection.WorkspaceID) ||
		(expectedMode != "fixed_thread" && strings.TrimSpace(defaultBinding.TargetThreadID) != "") {
		var err error
		defaultBinding, err = s.store.UpdateBotBinding(connection.WorkspaceID, defaultBinding.ID, func(current store.BotBinding) store.BotBinding {
			current.Name = defaultBotBindingName(connection.Name)
			current.BindingMode = expectedMode
			current.TargetWorkspaceID = connection.WorkspaceID
			if expectedMode != "fixed_thread" {
				current.TargetThreadID = ""
			}
			current.AIBackend = normalizeAIBackendName(connection.AIBackend)
			current.AIConfig = cloneStringMapLocal(connection.AIConfig)
			return current
		})
		if err != nil {
			return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
		}
	}

	return connection, bot, defaultBinding, nil
}

func (s *Service) provisionBotResourcesForConnection(connection store.BotConnection) (store.BotConnection, store.Bot, store.BotBinding, error) {
	connection = cloneBotConnectionStoreValue(connection)
	bot, err := s.store.CreateBot(store.Bot{
		ID:          store.NewID("botr"),
		WorkspaceID: connection.WorkspaceID,
		Name:        firstNonEmpty(strings.TrimSpace(connection.Name), defaultConnectionName(connection.Provider)),
		Status:      firstNonEmpty(strings.TrimSpace(connection.Status), "active"),
	})
	if err != nil {
		return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
	}

	defaultBinding, err := s.store.CreateBotBinding(store.BotBinding{
		ID:                store.NewID("bbd"),
		WorkspaceID:       connection.WorkspaceID,
		BotID:             bot.ID,
		Name:              defaultBotBindingName(connection.Name),
		BindingMode:       normalizeBotBindingMode("", connection.AIBackend),
		TargetWorkspaceID: connection.WorkspaceID,
		AIBackend:         normalizeAIBackendName(connection.AIBackend),
		AIConfig:          cloneStringMapLocal(connection.AIConfig),
	})
	if err != nil {
		_ = s.store.DeleteBot(connection.WorkspaceID, bot.ID)
		return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
	}

	bot, err = s.store.UpdateBot(connection.WorkspaceID, bot.ID, func(current store.Bot) store.Bot {
		current.DefaultBindingID = defaultBinding.ID
		return current
	})
	if err != nil {
		_ = s.store.DeleteBotBinding(connection.WorkspaceID, defaultBinding.ID)
		_ = s.store.DeleteBot(connection.WorkspaceID, bot.ID)
		return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
	}

	if strings.TrimSpace(connection.ID) != "" {
		updatedConnection, updateErr := s.store.UpdateBotConnectionRuntimeState(connection.WorkspaceID, connection.ID, func(current store.BotConnection) store.BotConnection {
			current.BotID = bot.ID
			return current
		})
		if updateErr != nil {
			return store.BotConnection{}, store.Bot{}, store.BotBinding{}, updateErr
		}
		connection = updatedConnection
	} else {
		connection.BotID = bot.ID
	}

	return connection, bot, defaultBinding, nil
}

func (s *Service) ensureConversationBotIdentity(conversation store.BotConversation, connection store.BotConnection) store.BotConversation {
	next := conversation
	next.BotID = firstNonEmpty(strings.TrimSpace(next.BotID), strings.TrimSpace(connection.BotID))
	return next
}

func (s *Service) resolveConversationBinding(conversation store.BotConversation) (store.BotBinding, bool) {
	if bindingID := strings.TrimSpace(conversation.BindingID); bindingID != "" {
		if binding, ok := s.store.GetBotBinding(conversation.WorkspaceID, bindingID); ok {
			return binding, true
		}
	}
	if botID := strings.TrimSpace(conversation.BotID); botID != "" {
		bot, ok := s.store.GetBot(conversation.WorkspaceID, botID)
		if !ok {
			return store.BotBinding{}, false
		}
		if binding, ok := s.store.GetBotBinding(conversation.WorkspaceID, bot.DefaultBindingID); ok {
			return binding, true
		}
	}
	return store.BotBinding{}, false
}

func cloneBotConnectionStoreValue(connection store.BotConnection) store.BotConnection {
	next := connection
	next.AIConfig = cloneStringMapLocal(connection.AIConfig)
	next.Settings = cloneStringMapLocal(connection.Settings)
	next.Secrets = cloneStringMapLocal(connection.Secrets)
	next.LastPollAt = cloneOptionalTimeLocal(connection.LastPollAt)
	return next
}

func (s *Service) StartWeChatLogin(ctx context.Context, workspaceID string, input StartWeChatLoginInput) (WeChatLoginView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return WeChatLoginView{}, err
	}
	if s.wechatAuth == nil {
		return WeChatLoginView{}, fmt.Errorf("%w: wechat auth service is unavailable", ErrInvalidInput)
	}
	return s.wechatAuth.StartLogin(ctx, resolvedWorkspaceID, input.BaseURL)
}

func (s *Service) GetWeChatLogin(ctx context.Context, workspaceID string, loginID string) (WeChatLoginView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return WeChatLoginView{}, err
	}
	if s.wechatAuth == nil {
		return WeChatLoginView{}, fmt.Errorf("%w: wechat auth service is unavailable", ErrInvalidInput)
	}
	view, err := s.wechatAuth.GetLoginStatus(ctx, resolvedWorkspaceID, loginID)
	if err != nil {
		return WeChatLoginView{}, err
	}
	s.rememberConfirmedWeChatLogin(resolvedWorkspaceID, view)
	return view, nil
}

func (s *Service) DeleteWeChatLogin(workspaceID string, loginID string) error {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return err
	}
	if s.wechatAuth == nil {
		return fmt.Errorf("%w: wechat auth service is unavailable", ErrInvalidInput)
	}
	return s.wechatAuth.DeleteLogin(resolvedWorkspaceID, loginID)
}

func (s *Service) ListWeChatAccounts(workspaceID string) ([]WeChatAccountView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}

	items := s.store.ListWeChatAccounts(resolvedWorkspaceID)
	views := make([]WeChatAccountView, 0, len(items))
	for _, item := range items {
		views = append(views, wechatAccountViewFromStore(item))
	}
	return views, nil
}

func (s *Service) DeleteWeChatAccount(workspaceID string, accountID string) error {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return err
	}
	return s.store.DeleteWeChatAccount(resolvedWorkspaceID, strings.TrimSpace(accountID))
}

func (s *Service) UpdateWeChatAccount(
	workspaceID string,
	accountID string,
	input UpdateWeChatAccountInput,
) (WeChatAccountView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return WeChatAccountView{}, err
	}

	alias := strings.TrimSpace(input.Alias)
	note := strings.TrimSpace(input.Note)
	if len([]rune(alias)) > 80 {
		return WeChatAccountView{}, fmt.Errorf("%w: wechat account alias must be 80 characters or fewer", ErrInvalidInput)
	}
	if len([]rune(note)) > 2000 {
		return WeChatAccountView{}, fmt.Errorf("%w: wechat account note must be 2000 characters or fewer", ErrInvalidInput)
	}

	updated, err := s.store.UpdateWeChatAccount(resolvedWorkspaceID, strings.TrimSpace(accountID), func(current store.WeChatAccount) store.WeChatAccount {
		current.Alias = alias
		current.Note = note
		return current
	})
	if err != nil {
		return WeChatAccountView{}, err
	}

	s.publish(updated.WorkspaceID, "", "bot/wechat_account/updated", map[string]any{
		"accountId": updated.ID,
		"alias":     updated.Alias,
	})

	return wechatAccountViewFromStore(updated), nil
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
	resolvedSettings, resolvedSecrets, err := s.resolveProviderCreateInput(
		ctx,
		workspaceID,
		providerName,
		normalizedSettings,
		input.Secrets,
	)
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
		Settings:    resolvedSettings,
		Secrets:     resolvedSecrets,
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
	created, _, _, err = s.ensureConnectionBotResources(created)
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
		slog.String("deliveryMode", debugConnectionDeliveryMode(created)),
	)

	return connectionViewFromStore(created), nil
}

func (s *Service) UpdateConnection(
	ctx context.Context,
	workspaceID string,
	connectionID string,
	input UpdateConnectionInput,
) (ConnectionView, error) {
	current, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return ConnectionView{}, store.ErrBotConnectionNotFound
	}

	currentProviderName := normalizeProviderName(current.Provider)
	requestedProviderName := normalizeProviderName(input.Provider)
	if requestedProviderName != "" && requestedProviderName != currentProviderName {
		return ConnectionView{}, fmt.Errorf("%w: bot provider cannot be changed after creation", ErrInvalidInput)
	}

	provider, ok := s.providers[currentProviderName]
	if !ok {
		return ConnectionView{}, ErrProviderNotSupported
	}

	aiBackendName := normalizeAIBackendName(input.AIBackend)
	if aiBackendName == "" {
		aiBackendName = normalizeAIBackendName(current.AIBackend)
	}
	if _, ok := s.aiBackends[aiBackendName]; !ok {
		return ConnectionView{}, ErrAIBackendUnsupported
	}

	normalizedSettings, err := normalizeBotConnectionSettings(input.Settings)
	if err != nil {
		return ConnectionView{}, err
	}

	nextSecrets := overlayBotConnectionSecrets(current.Secrets, input.Secrets)
	if aiBackendName != openAIResponsesBackendName {
		nextSecrets = removeBotConnectionSecrets(nextSecrets, "openai_api_key")
	}
	if currentProviderName == telegramProviderName {
		if strings.TrimSpace(nextSecrets["bot_token"]) != strings.TrimSpace(current.Secrets["bot_token"]) {
			nextSecrets = removeBotConnectionSecrets(nextSecrets, "webhook_secret")
		}
	}

	resolvedSettings, resolvedSecrets, err := s.resolveProviderCreateInput(
		ctx,
		workspaceID,
		currentProviderName,
		normalizedSettings,
		nextSecrets,
	)
	if err != nil {
		return ConnectionView{}, err
	}

	updatedConnection := current
	updatedConnection.Provider = currentProviderName
	updatedConnection.Name = firstNonEmpty(strings.TrimSpace(input.Name), defaultConnectionName(currentProviderName))
	updatedConnection.AIBackend = aiBackendName
	updatedConnection.AIConfig = cloneStringMapLocal(input.AIConfig)
	updatedConnection.Settings = cloneStringMapLocal(resolvedSettings)
	updatedConnection.Secrets = cloneStringMapLocal(resolvedSecrets)
	updatedConnection.LastError = ""

	if s.isActivePollingConnection(updatedConnection) {
		if err := s.validatePollingConnectionOwnership(updatedConnection); err != nil {
			return ConnectionView{}, err
		}
	}

	if strings.EqualFold(strings.TrimSpace(current.Status), "active") {
		activation, err := provider.Activate(ctx, updatedConnection, s.resolvePublicBaseURL(input.PublicBaseURL))
		if err != nil {
			return ConnectionView{}, err
		}
		updatedConnection.Settings = mergeStringMaps(updatedConnection.Settings, activation.Settings)
		updatedConnection.Secrets = mergeStringMaps(updatedConnection.Secrets, activation.Secrets)
	}

	updated, err := s.store.UpdateBotConnection(workspaceID, connectionID, func(store.BotConnection) store.BotConnection {
		return updatedConnection
	})
	if err != nil {
		return ConnectionView{}, err
	}
	updated, _, _, err = s.ensureConnectionBotResources(updated)
	if err != nil {
		return ConnectionView{}, err
	}

	if strings.EqualFold(strings.TrimSpace(current.Status), "active") &&
		strings.TrimSpace(current.Secrets["bot_token"]) != "" &&
		strings.TrimSpace(current.Secrets["bot_token"]) != strings.TrimSpace(updated.Secrets["bot_token"]) {
		if cleanupErr := provider.Deactivate(ctx, current); cleanupErr != nil {
			s.appendConnectionLog(updated.WorkspaceID, updated.ID, "warning", "provider_cleanup_failed", cleanupErr.Error())
		}
	}

	if s.isActivePollingConnection(current) || s.isActivePollingConnection(updated) {
		s.stopPollingConnection(updated.ID)
	}
	s.syncPollingConnections()
	if strings.EqualFold(strings.TrimSpace(updated.Status), "active") {
		s.recoverPendingInboundDeliveries(workspaceID, updated.ID)
	}

	s.publish(updated.WorkspaceID, "", "bot/connection/updated", map[string]any{
		"connectionId": updated.ID,
		"name":         updated.Name,
		"aiBackend":    updated.AIBackend,
		"status":       updated.Status,
	})
	logBotDebug(ctx, updated, "connection updated",
		slog.String("aiBackend", updated.AIBackend),
		slog.String("deliveryMode", debugConnectionDeliveryMode(updated)),
	)

	return connectionViewFromStore(updated), nil
}

func (s *Service) resolveProviderCreateInput(
	ctx context.Context,
	workspaceID string,
	providerName string,
	settings map[string]string,
	secrets map[string]string,
) (map[string]string, map[string]string, error) {
	switch providerName {
	case wechatProviderName:
		return s.resolveWeChatCreateInput(ctx, workspaceID, settings, secrets)
	default:
		return cloneStringMapLocal(settings), cloneStringMapLocal(secrets), nil
	}
}

func (s *Service) resolveWeChatCreateInput(
	ctx context.Context,
	workspaceID string,
	settings map[string]string,
	secrets map[string]string,
) (map[string]string, map[string]string, error) {
	loginID := strings.TrimSpace(settings[wechatLoginSessionIDSetting])
	if loginID != "" {
		if s.wechatAuth == nil {
			return nil, nil, fmt.Errorf("%w: wechat auth service is unavailable", ErrInvalidInput)
		}

		login, err := s.wechatAuth.ResolveConfirmedLogin(ctx, workspaceID, loginID)
		if err != nil {
			return nil, nil, err
		}
		s.rememberConfirmedWeChatLogin(workspaceID, login)
		nextSettings, nextSecrets := mergeResolvedWeChatCreateInput(
			settings,
			secrets,
			login.BaseURL,
			login.AccountID,
			login.UserID,
			login.BotToken,
			wechatLoginSessionIDSetting,
		)
		return nextSettings, nextSecrets, nil
	}

	savedAccountID := strings.TrimSpace(settings[wechatSavedAccountIDSetting])
	if savedAccountID == "" {
		return cloneStringMapLocal(settings), cloneStringMapLocal(secrets), nil
	}
	account, ok := s.store.GetWeChatAccount(workspaceID, savedAccountID)
	if !ok {
		return nil, nil, store.ErrWeChatAccountNotFound
	}
	nextSettings, nextSecrets := mergeResolvedWeChatCreateInput(
		settings,
		secrets,
		account.BaseURL,
		account.AccountID,
		account.UserID,
		account.BotToken,
		wechatSavedAccountIDSetting,
	)
	return nextSettings, nextSecrets, nil
}

func mergeResolvedWeChatCreateInput(
	settings map[string]string,
	secrets map[string]string,
	baseURL string,
	accountID string,
	userID string,
	botToken string,
	transientKey string,
) (map[string]string, map[string]string) {
	nextSettings := cloneStringMapLocal(settings)
	if nextSettings == nil {
		nextSettings = make(map[string]string)
	}
	delete(nextSettings, transientKey)
	if baseURL = strings.TrimSpace(baseURL); baseURL != "" {
		nextSettings[wechatBaseURLSetting] = baseURL
	}
	if accountID = strings.TrimSpace(accountID); accountID != "" {
		nextSettings[wechatAccountIDSetting] = accountID
	}
	if userID = strings.TrimSpace(userID); userID != "" {
		nextSettings[wechatOwnerUserIDSetting] = userID
	}

	nextSecrets := cloneStringMapLocal(secrets)
	if nextSecrets == nil {
		nextSecrets = make(map[string]string)
	}
	if botToken = strings.TrimSpace(botToken); botToken != "" {
		nextSecrets["bot_token"] = botToken
	}
	return nextSettings, nextSecrets
}

func overlayBotConnectionSecrets(base map[string]string, overlay map[string]string) map[string]string {
	next := cloneStringMapLocal(base)
	for key, value := range overlay {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		trimmedValue := strings.TrimSpace(value)
		if trimmedValue == "" {
			continue
		}
		if next == nil {
			next = make(map[string]string)
		}
		next[trimmedKey] = trimmedValue
	}
	return next
}

func removeBotConnectionSecrets(values map[string]string, keys ...string) map[string]string {
	if len(values) == 0 || len(keys) == 0 {
		return cloneStringMapLocal(values)
	}

	next := cloneStringMapLocal(values)
	for _, key := range keys {
		delete(next, strings.TrimSpace(key))
	}
	if len(next) == 0 {
		return nil
	}
	return next
}

func (s *Service) rememberConfirmedWeChatLogin(workspaceID string, login WeChatLoginView) {
	if normalizeWeChatLoginStatus(login.Status) != wechatLoginStatusConfirmed || !login.CredentialReady {
		return
	}
	if _, err := s.store.UpsertWeChatAccount(store.WeChatAccount{
		WorkspaceID:     strings.TrimSpace(workspaceID),
		BaseURL:         strings.TrimSpace(login.BaseURL),
		AccountID:       strings.TrimSpace(login.AccountID),
		UserID:          strings.TrimSpace(login.UserID),
		BotToken:        strings.TrimSpace(login.BotToken),
		LastLoginID:     strings.TrimSpace(login.LoginID),
		LastConfirmedAt: time.Now().UTC(),
	}); err != nil {
		return
	}
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

func (s *Service) UpdateConnectionCommandOutputMode(
	workspaceID string,
	connectionID string,
	input UpdateConnectionCommandOutputModeInput,
) (ConnectionView, error) {
	commandOutputMode, err := normalizeBotCommandOutputMode(input.CommandOutputMode)
	if err != nil {
		return ConnectionView{}, err
	}

	updated, err := s.store.UpdateBotConnection(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		if current.Settings == nil {
			current.Settings = map[string]string{}
		}
		current.Settings[botCommandOutputModeSetting] = commandOutputMode
		return current
	})
	if err != nil {
		return ConnectionView{}, err
	}

	s.publish(updated.WorkspaceID, "", "bot/connection/command_output_mode_updated", map[string]any{
		"connectionId":      updated.ID,
		"commandOutputMode": commandOutputMode,
	})
	logBotDebug(nil, updated, "command output mode updated", slog.String("newMode", commandOutputMode))

	return connectionViewFromStore(updated), nil
}

func (s *Service) UpdateWeChatChannelTiming(
	workspaceID string,
	connectionID string,
	input UpdateWeChatChannelTimingInput,
) (ConnectionView, error) {
	connection, ok := s.store.GetBotConnection(workspaceID, connectionID)
	if !ok {
		return ConnectionView{}, store.ErrBotConnectionNotFound
	}
	if normalizeProviderName(connection.Provider) != wechatProviderName {
		return ConnectionView{}, fmt.Errorf("%w: wechat channel timing is only supported for wechat bot connections", ErrInvalidInput)
	}

	channelTimingSetting := wechatChannelTimingDisabled
	if input.Enabled {
		channelTimingSetting = wechatChannelTimingEnabled
	}

	updated, err := s.store.UpdateBotConnection(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		if current.Settings == nil {
			current.Settings = map[string]string{}
		}
		current.Settings[wechatChannelTimingSetting] = channelTimingSetting
		return current
	})
	if err != nil {
		return ConnectionView{}, err
	}

	s.publish(updated.WorkspaceID, "", "bot/connection/wechat_channel_timing_updated", map[string]any{
		"connectionId": updated.ID,
		"enabled":      input.Enabled,
	})
	logBotDebug(nil, updated, "wechat channel timing updated", slog.Bool("enabled", input.Enabled))

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
	if strings.TrimSpace(connection.BotID) != "" {
		hasRemainingEndpoint := false
		for _, candidate := range s.store.ListBotConnections(workspaceID) {
			if strings.TrimSpace(candidate.BotID) == strings.TrimSpace(connection.BotID) {
				hasRemainingEndpoint = true
				break
			}
		}
		if !hasRemainingEndpoint {
			_ = s.store.DeleteBot(workspaceID, connection.BotID)
		}
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
	connection, _, _, err := s.ensureConnectionBotResources(connection)
	if err != nil {
		return WebhookResult{}, err
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
	connection, _, _, err := s.ensureConnectionBotResources(connection)
	if err != nil {
		return err
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

	if handled, controlText, controlErr := s.handleProviderCommand(ctx, provider, connection, conversation, message); handled {
		logBotDebug(ctx, connection, "processing provider command",
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
		reply = normalizeProviderAIResult(connection, reply)
		logBotDebug(messageCtx, connection, "replaying saved reply snapshot",
			slog.String("conversationStoreId", conversation.ID),
			slog.String("replyThreadId", strings.TrimSpace(reply.ThreadID)),
			slog.Any("messages", debugOutboundMessages(reply.Messages)),
		)
		attemptCount, err := s.sendReplyWithRetry(messageCtx, provider, connection, conversation, &delivery, &message, reply, "saved reply replay")
		if err != nil {
			return s.handleReplyDeliveryFailure(messageCtx, connection, conversation, delivery, message, reply, err)
		}
		return s.completeInboundDeliveryWithReply(messageCtx, connection, conversation, delivery, message, reply, attemptCount)
	}

	if handled, err := s.handleWeChatFailedReplyReplayIntent(messageCtx, provider, connection, conversation, delivery, message); handled {
		return err
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

	reply, replyAttemptCount, failureDelivered, failureText, err := s.executeAIReply(messageCtx, provider, aiBackend, connection, conversation, message, &delivery)
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

	return s.completeInboundDeliveryWithReply(messageCtx, connection, conversation, delivery, message, reply, replyAttemptCount)
}

func (s *Service) executeAIReply(
	ctx context.Context,
	provider Provider,
	aiBackend AIBackend,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
	delivery *store.BotInboundDelivery,
) (AIResult, int, bool, string, error) {
	startedAt := time.Now().UTC()
	typingSession := s.startProviderTyping(ctx, provider, aiBackend, connection, conversation)
	defer s.stopProviderTyping(ctx, connection, typingSession)

	preparedInbound := prepareInboundMessageForAI(connection, inbound)
	streamingProvider, providerSupportsStreaming := provider.(StreamingProvider)
	streamingBackend, backendSupportsStreaming := aiBackend.(StreamingAIBackend)
	if !providerSupportsStreaming || !backendSupportsStreaming {
		logBotDebug(ctx, connection, "executing final ai reply",
			slog.String("backend", aiBackend.Name()),
			slog.Bool("streamingProvider", providerSupportsStreaming),
			slog.Bool("streamingBackend", backendSupportsStreaming),
		)
		reply, attemptCount, err := s.executeFinalAIReply(ctx, provider, aiBackend, connection, conversation, preparedInbound, inbound, startedAt, delivery)
		return reply, attemptCount, false, "", err
	}
	logBotDebug(ctx, connection, "starting streaming ai reply",
		slog.String("backend", aiBackend.Name()),
		slog.String("provider", provider.Name()),
	)

	session, err := streamingProvider.StartStreamingReply(ctx, connection, conversation)
	if err != nil {
		return AIResult{}, 0, false, "", err
	}

	if err := session.Update(ctx, StreamingUpdate{Messages: []OutboundMessage{{Text: defaultStreamingPendingText}}}); err == nil {
	}

	reply, processErr := streamingBackend.ProcessMessageStream(
		ctx,
		connection,
		conversation,
		preparedInbound,
		func(updateCtx context.Context, update StreamingUpdate) error {
			normalizedUpdate := normalizeProviderStreamingUpdate(connection, update)
			if len(normalizedUpdate.Messages) == 0 {
				return nil
			}
			logBotDebug(updateCtx, connection, "streaming update received",
				slog.String("conversationStoreId", conversation.ID),
				slog.Int("messageCount", len(normalizedUpdate.Messages)),
				slog.Any("messages", debugOutboundMessages(normalizedUpdate.Messages)),
			)
			return session.Update(updateCtx, normalizedUpdate)
		},
	)
	if processErr != nil {
		processErr = wrapAIBackendError(aiBackend.Name(), processErr)
		failureText := strings.TrimSpace(failureReplyText(processErr))
		if failureText == "" {
			failureText = defaultStreamingFailureText
		}
		if failErr := session.Fail(ctx, failureText); failErr != nil {
			return AIResult{}, 1, false, "", errors.Join(processErr, failErr)
		}
		return AIResult{}, 1, true, failureText, processErr
	}

	reply = finalizeProviderAIResult(connection, inbound, startedAt, reply)
	if err := session.Complete(ctx, reply.Messages); err != nil {
		return AIResult{}, 1, false, "", &replyDeliveryError{
			reply:        reply,
			providerName: provider.Name(),
			phase:        "stream completion",
			attemptCount: 1,
			cause:        err,
		}
	}
	logBotDebug(ctx, connection, "streaming ai reply completed",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("replyThreadId", strings.TrimSpace(reply.ThreadID)),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
	)

	return reply, 1, false, "", nil
}

func (s *Service) startProviderTyping(
	ctx context.Context,
	provider Provider,
	aiBackend AIBackend,
	connection store.BotConnection,
	conversation store.BotConversation,
) TypingSession {
	if provider == nil || aiBackend == nil {
		return nil
	}

	typingProvider, ok := provider.(TypingProvider)
	if !ok {
		return nil
	}

	session, err := typingProvider.StartTyping(ctx, connection, conversation)
	if err != nil {
		logBotDebug(ctx, connection, "provider typing start failed",
			slog.String("provider", provider.Name()),
			slog.String("error", err.Error()),
		)
		return nil
	}

	if session != nil {
		logBotDebug(ctx, connection, "provider typing started",
			slog.String("provider", provider.Name()),
		)
	}
	return session
}

func (s *Service) stopProviderTyping(ctx context.Context, connection store.BotConnection, session TypingSession) {
	if session == nil {
		return
	}
	if err := session.Stop(ctx); err != nil {
		logBotDebug(ctx, connection, "provider typing stop failed",
			slog.String("error", err.Error()),
		)
		return
	}
	logBotDebug(ctx, connection, "provider typing stopped")
}

func (s *Service) executeFinalAIReply(
	ctx context.Context,
	provider Provider,
	aiBackend AIBackend,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
	originalInbound InboundMessage,
	startedAt time.Time,
	delivery *store.BotInboundDelivery,
) (AIResult, int, error) {
	reply, err := aiBackend.ProcessMessage(ctx, connection, conversation, inbound)
	if err != nil {
		return AIResult{}, 0, wrapAIBackendError(aiBackend.Name(), err)
	}
	reply = finalizeProviderAIResult(connection, originalInbound, startedAt, reply)
	logBotDebug(ctx, connection, "final ai reply produced",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("replyThreadId", strings.TrimSpace(reply.ThreadID)),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
	)

	attemptCount, err := s.sendReplyWithRetry(ctx, provider, connection, conversation, delivery, &originalInbound, reply, "final message send")
	if err != nil {
		return AIResult{}, attemptCount, err
	}

	return reply, attemptCount, nil
}

func (s *Service) sendReplyWithRetry(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	conversation store.BotConversation,
	delivery *store.BotInboundDelivery,
	inbound *InboundMessage,
	reply AIResult,
	phase string,
) (int, error) {
	if provider == nil {
		return 0, &replyDeliveryError{
			reply:        reply,
			phase:        phase,
			attemptCount: 1,
			cause:        ErrProviderNotSupported,
		}
	}

	attemptOffset := 0
	if delivery != nil {
		attemptOffset = maxInt(delivery.ReplyDeliveryAttemptCount, 0)
	}
	attemptCount := 0
	for {
		attemptCount += 1
		effectiveAttemptCount := attemptOffset + attemptCount
		s.recordReplyDeliveryProgress(
			connection,
			conversation,
			delivery,
			inbound,
			reply,
			botReplyDeliveryStatusSending,
			effectiveAttemptCount,
			"",
		)
		if err := provider.SendMessages(ctx, connection, conversation, reply.Messages); err != nil {
			retry, delay := replyDeliveryRetryDecision(provider, err, attemptCount)
			if !retry {
				return attemptCount, &replyDeliveryError{
					reply:        reply,
					providerName: provider.Name(),
					phase:        phase,
					attemptCount: effectiveAttemptCount,
					cause:        unwrapReplyDeliveryRetryable(err),
				}
			}

			trimmedError := strings.TrimSpace(unwrapReplyDeliveryRetryable(err).Error())
			if trimmedError == "" {
				trimmedError = "reply delivery failed with an empty error message"
			}
			delayLabel := delay.Round(time.Millisecond).String()
			if delay <= 0 {
				delayLabel = "immediately"
			}
			s.recordReplyDeliveryProgress(
				connection,
				conversation,
				delivery,
				inbound,
				reply,
				botReplyDeliveryStatusRetrying,
				effectiveAttemptCount+1,
				trimmedError,
			)

			logBotDebug(ctx, connection, "reply delivery retry scheduled",
				slog.String("conversationStoreId", conversation.ID),
				slog.String("provider", provider.Name()),
				slog.String("phase", strings.TrimSpace(phase)),
				slog.Int("attempt", effectiveAttemptCount),
				slog.String("retryAfter", delayLabel),
				slog.String("error", trimmedError),
			)
			s.appendConnectionLog(
				connection.WorkspaceID,
				connection.ID,
				"warning",
				"reply_delivery_retry",
				fmt.Sprintf(
					"Reply delivery attempt %d failed during %s and will retry %s: %s",
					effectiveAttemptCount,
					firstNonEmpty(strings.TrimSpace(phase), "provider send"),
					delayLabel,
					trimmedError,
				),
			)

			if delay > 0 {
				if sleepErr := sleepWithContext(ctx, delay); sleepErr != nil {
					return attemptCount, &replyDeliveryError{
						reply:        reply,
						providerName: provider.Name(),
						phase:        phase,
						attemptCount: effectiveAttemptCount,
						cause:        errors.Join(unwrapReplyDeliveryRetryable(err), sleepErr),
					}
				}
			}
			continue
		}

		return effectiveAttemptCount, nil
	}
}

func replyDeliveryRetryDecision(provider Provider, err error, attempt int) (bool, time.Duration) {
	if provider == nil || err == nil {
		return false, 0
	}

	decider, ok := provider.(ReplyDeliveryRetryDecider)
	if !ok {
		return false, 0
	}
	return decider.ReplyDeliveryRetryDecision(err, attempt)
}

func (s *Service) recordReplyDeliveryProgress(
	connection store.BotConnection,
	conversation store.BotConversation,
	delivery *store.BotInboundDelivery,
	inbound *InboundMessage,
	reply AIResult,
	status string,
	attemptCount int,
	lastError string,
) {
	if s == nil || s.store == nil || delivery == nil || inbound == nil {
		return
	}
	if strings.TrimSpace(delivery.ID) == "" || strings.TrimSpace(conversation.ID) == "" {
		return
	}
	status = strings.TrimSpace(status)
	if status == "" {
		return
	}

	updatedConversation := s.recordConversationReplyOutcome(
		connection,
		conversation,
		reply,
		*inbound,
		"",
		conversationReplyDeliveryState{
			status:       status,
			attemptCount: attemptCount,
			lastError:    strings.TrimSpace(lastError),
		},
	)
	_, _ = s.store.RecordBotInboundDeliveryReplyDelivery(
		connection.WorkspaceID,
		delivery.ID,
		status,
		attemptCount,
		lastError,
		nil,
	)

	payload := map[string]any{
		"connectionId":   connection.ID,
		"conversationId": updatedConversation.ID,
		"threadId":       updatedConversation.ThreadID,
		"messageCount":   len(reply.Messages),
		"deliveryStatus": status,
		"attemptCount":   attemptCount,
	}
	if trimmedError := strings.TrimSpace(lastError); trimmedError != "" {
		payload["error"] = trimmedError
	}
	s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/delivery_status", payload)

	if status == botReplyDeliveryStatusSending {
		s.appendConnectionLog(
			connection.WorkspaceID,
			connection.ID,
			"info",
			"reply_delivery_sending",
			fmt.Sprintf(
				"Reply delivery attempt %d started for message %s.",
				attemptCount,
				firstNonEmpty(strings.TrimSpace(inbound.MessageID), "unknown"),
			),
		)
	}
}

func finalizeProviderAIResult(
	connection store.BotConnection,
	inbound InboundMessage,
	startedAt time.Time,
	result AIResult,
) AIResult {
	next := normalizeProviderAIResult(connection, result)
	next.Messages = appendWeChatTimingMessage(connection, inbound, startedAt, time.Now().UTC(), next.Messages)
	return next
}

func (s *Service) completeInboundDeliveryWithReply(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	delivery store.BotInboundDelivery,
	message InboundMessage,
	reply AIResult,
	attemptCount int,
) error {
	if attemptCount <= 0 {
		attemptCount = 1
	}
	deliveredAt := time.Now().UTC()
	updatedConversation := s.recordConversationReplyOutcome(
		connection,
		conversation,
		reply,
		message,
		"",
		conversationReplyDeliveryState{
			status:       botReplyDeliveryStatusDelivered,
			attemptCount: attemptCount,
			deliveredAt:  &deliveredAt,
		},
	)
	if _, err := s.store.RecordBotInboundDeliveryReplyDelivery(
		connection.WorkspaceID,
		delivery.ID,
		botReplyDeliveryStatusDelivered,
		attemptCount,
		"",
		&deliveredAt,
	); err != nil {
		return err
	}
	if _, err := s.store.CompleteBotInboundDelivery(connection.WorkspaceID, delivery.ID); err != nil {
		return err
	}
	s.appendConnectionLog(
		connection.WorkspaceID,
		connection.ID,
		"success",
		"reply_delivery_delivered",
		fmt.Sprintf(
			"Reply delivery succeeded after %d attempt(s) for message %s.",
			attemptCount,
			firstNonEmpty(strings.TrimSpace(delivery.MessageID), "unknown"),
		),
	)
	if attemptCount > 1 {
		s.appendConnectionLog(
			connection.WorkspaceID,
			connection.ID,
			"success",
			"reply_delivery_recovered",
			fmt.Sprintf(
				"Reply delivery recovered after %d attempts for conversation %s.",
				attemptCount,
				firstNonEmpty(strings.TrimSpace(updatedConversation.ID), strings.TrimSpace(conversation.ID)),
			),
		)
	}
	logBotDebug(ctx, connection, "completed inbound delivery",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", strings.TrimSpace(updatedConversation.ThreadID)),
		slog.Int("messageCount", len(reply.Messages)),
		slog.Int("attemptCount", attemptCount),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
	)

	s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/sent", map[string]any{
		"connectionId":   connection.ID,
		"conversationId": updatedConversation.ID,
		"threadId":       updatedConversation.ThreadID,
		"messageCount":   len(reply.Messages),
		"deliveryStatus": botReplyDeliveryStatusDelivered,
		"attemptCount":   attemptCount,
		"deliveredAt":    deliveredAt,
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
	attemptCount := replyDeliveryAttemptCount(deliveryErr)
	if attemptCount <= 0 {
		attemptCount = 1
	}
	deliveryMessage := strings.TrimSpace(deliveryErr.Error())
	updatedConversation := s.recordConversationReplyOutcome(
		connection,
		conversation,
		reply,
		message,
		"",
		conversationReplyDeliveryState{
			status:       botReplyDeliveryStatusFailed,
			attemptCount: attemptCount,
			lastError:    deliveryMessage,
		},
	)

	saveErr := error(nil)
	if _, err := s.store.SaveBotInboundDeliveryReply(connection.WorkspaceID, delivery.ID, reply.ThreadID, outboundReplyMessages(reply.Messages)); err != nil {
		saveErr = err
	}

	recordErr := error(nil)
	if _, err := s.store.RecordBotInboundDeliveryReplyDelivery(
		connection.WorkspaceID,
		delivery.ID,
		botReplyDeliveryStatusFailed,
		attemptCount,
		deliveryMessage,
		nil,
	); err != nil {
		recordErr = err
	}

	lastError := deliveryErr
	if saveErr != nil {
		lastError = errors.Join(lastError, saveErr)
	}
	if recordErr != nil {
		lastError = errors.Join(lastError, recordErr)
	}

	failErr := error(nil)
	if _, err := s.store.FailBotInboundDelivery(connection.WorkspaceID, delivery.ID, lastError.Error()); err != nil {
		failErr = err
		lastError = errors.Join(lastError, failErr)
	}

	s.appendConnectionLog(
		connection.WorkspaceID,
		connection.ID,
		"error",
		"reply_delivery_failed",
		fmt.Sprintf(
			"Reply delivery failed after %d attempt(s) for message %s: %s",
			attemptCount,
			firstNonEmpty(strings.TrimSpace(delivery.MessageID), "unknown"),
			failureReplyDetail(lastError),
		),
	)
	s.notifyReplyDeliveryFailed(connection, delivery, lastError, attemptCount)

	s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/delivery_failed", map[string]any{
		"connectionId":   connection.ID,
		"conversationId": updatedConversation.ID,
		"threadId":       updatedConversation.ThreadID,
		"messageCount":   len(reply.Messages),
		"deliveryStatus": botReplyDeliveryStatusFailed,
		"attemptCount":   attemptCount,
		"error":          lastError.Error(),
	})
	_, _ = s.store.UpdateBotConnection(connection.WorkspaceID, connection.ID, func(current store.BotConnection) store.BotConnection {
		current.LastError = lastError.Error()
		return current
	})
	logBotDebug(ctx, connection, "reply delivery failed",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", strings.TrimSpace(updatedConversation.ThreadID)),
		slog.Int("messageCount", len(reply.Messages)),
		slog.Int("attemptCount", attemptCount),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
		slog.String("error", lastError.Error()),
	)

	if saveErr != nil || recordErr != nil || failErr != nil {
		return lastError
	}
	return nil
}

func (s *Service) resolveConversation(
	connection store.BotConnection,
	inbound InboundMessage,
) (store.BotConversation, error) {
	connection, _, _, err := s.ensureConnectionBotResources(connection)
	if err != nil {
		return store.BotConversation{}, err
	}
	lastInboundText := messageSummaryText(inbound.Text, inbound.Media)
	if conversation, ok := s.store.FindBotConversationByExternalConversation(connection.WorkspaceID, connection.ID, inbound.ConversationID); ok {
		updated, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
			current.BotID = firstNonEmpty(strings.TrimSpace(current.BotID), strings.TrimSpace(connection.BotID))
			current.ExternalConversationID = strings.TrimSpace(inbound.ConversationID)
			current.ExternalChatID = firstNonEmpty(strings.TrimSpace(inbound.ExternalChatID), strings.TrimSpace(inbound.ConversationID))
			current.ExternalThreadID = strings.TrimSpace(inbound.ExternalThreadID)
			current.ExternalUserID = strings.TrimSpace(inbound.UserID)
			current.ExternalUsername = strings.TrimSpace(inbound.Username)
			current.ExternalTitle = strings.TrimSpace(inbound.Title)
			current.ProviderState = mergeProviderState(current.ProviderState, inbound.ProviderData)
			current.LastInboundText = lastInboundText
			return current
		})
		return updated, err
	}

	created, err := s.store.CreateBotConversation(store.BotConversation{
		BotID:                  strings.TrimSpace(connection.BotID),
		WorkspaceID:            connection.WorkspaceID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: strings.TrimSpace(inbound.ConversationID),
		ExternalChatID:         firstNonEmpty(strings.TrimSpace(inbound.ExternalChatID), strings.TrimSpace(inbound.ConversationID)),
		ExternalThreadID:       strings.TrimSpace(inbound.ExternalThreadID),
		ExternalUserID:         strings.TrimSpace(inbound.UserID),
		ExternalUsername:       strings.TrimSpace(inbound.Username),
		ExternalTitle:          strings.TrimSpace(inbound.Title),
		ProviderState:          mergeProviderState(nil, inbound.ProviderData),
		LastInboundText:        lastInboundText,
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
	_, err, ok := s.findConflictingPollingConnection(connection)
	if !ok {
		return nil
	}
	return err
}

func (s *Service) findConflictingPollingConnection(connection store.BotConnection) (store.BotConnection, error, bool) {
	ownershipProvider, ownerKey, ok := s.pollingOwnershipForConnection(connection)
	if !ok {
		return store.BotConnection{}, nil, false
	}

	var conflict store.BotConnection
	found := false
	for _, workspace := range s.store.ListWorkspaces() {
		for _, candidate := range s.store.ListBotConnections(workspace.ID) {
			if candidate.ID == connection.ID {
				continue
			}
			if !s.isActivePollingConnection(candidate) {
				continue
			}
			if s.pollingOwnerKey(candidate) != ownerKey {
				continue
			}
			if !found || botConnectionSortsBefore(candidate, conflict) {
				conflict = candidate
				found = true
			}
		}
	}

	if !found {
		return store.BotConnection{}, nil, false
	}
	return conflict, ownershipProvider.PollingConflictError(conflict.ID), true
}

func (s *Service) pollingOwner(connection store.BotConnection) (store.BotConnection, error, bool) {
	ownershipProvider, ownerKey, ok := s.pollingOwnershipForConnection(connection)
	if !ok || !s.isActivePollingConnection(connection) {
		return store.BotConnection{}, nil, false
	}

	owner := connection
	found := false
	for _, workspace := range s.store.ListWorkspaces() {
		for _, candidate := range s.store.ListBotConnections(workspace.ID) {
			if !s.isActivePollingConnection(candidate) {
				continue
			}
			if s.pollingOwnerKey(candidate) != ownerKey {
				continue
			}
			if !found || botConnectionSortsBefore(candidate, owner) {
				owner = candidate
				found = true
			}
		}
	}

	if !found {
		return store.BotConnection{}, nil, false
	}
	if owner.ID == connection.ID {
		return owner, nil, true
	}
	return owner, ownershipProvider.PollingConflictError(owner.ID), true
}

func (s *Service) isActivePollingConnection(connection store.BotConnection) bool {
	return strings.EqualFold(strings.TrimSpace(connection.Status), "active") && s.pollingOwnerKey(connection) != ""
}

func (s *Service) pollingOwnershipForConnection(connection store.BotConnection) (PollingOwnershipProvider, string, bool) {
	provider, ok := s.providers[normalizeProviderName(connection.Provider)]
	if !ok {
		return nil, "", false
	}

	pollingProvider, ok := provider.(PollingProvider)
	if !ok || !pollingProvider.SupportsPolling(connection) {
		return nil, "", false
	}

	ownershipProvider, ok := provider.(PollingOwnershipProvider)
	if !ok {
		return nil, "", false
	}

	ownerKey := strings.TrimSpace(ownershipProvider.PollingOwnerKey(connection))
	if ownerKey == "" {
		return nil, "", false
	}
	return ownershipProvider, ownerKey, true
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

func (s *Service) pollingOwnerKey(connection store.BotConnection) string {
	ownershipProvider, ownerKey, ok := s.pollingOwnershipForConnection(connection)
	if !ok || ownershipProvider == nil {
		return ""
	}
	return ownerKey
}

func (s *Service) setConnectionLastError(workspaceID string, connectionID string, lastError string) {
	_, _ = s.store.UpdateBotConnectionRuntimeState(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.LastError = strings.TrimSpace(lastError)
		return current
	})
}

func (s *Service) updateConnectionPollState(
	workspaceID string,
	connectionID string,
	status string,
	message string,
	lastError string,
) {
	now := time.Now().UTC()
	_, _ = s.store.UpdateBotConnectionRuntimeState(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.LastPollAt = &now
		current.LastPollStatus = strings.TrimSpace(status)
		current.LastPollMessage = strings.TrimSpace(message)
		current.LastError = strings.TrimSpace(lastError)
		return current
	})
}

func (s *Service) appendConnectionLog(workspaceID string, connectionID string, level string, eventType string, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}

	_, _ = s.store.AppendBotConnectionLog(workspaceID, connectionID, store.BotConnectionLogEntry{
		Level:     strings.TrimSpace(level),
		EventType: strings.TrimSpace(eventType),
		Message:   message,
	})
}

func (s *Service) recordPollingEvent(workspaceID string, connectionID string, event PollingEvent) {
	message := strings.TrimSpace(event.Message)
	if message == "" {
		message = "Polling iteration completed successfully."
	}

	eventType := strings.TrimSpace(event.EventType)
	if eventType == "" {
		eventType = "poll_success"
	}

	s.updateConnectionPollState(workspaceID, connectionID, "success", message, "")
	s.appendConnectionLog(workspaceID, connectionID, "success", eventType, message)
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

	if owner, err, ok := s.pollingOwner(connection); ok && owner.ID != connection.ID {
		s.stopPollingConnection(connection.ID)
		if err != nil {
			s.setConnectionLastError(connection.WorkspaceID, connection.ID, err.Error())
			s.appendConnectionLog(connection.WorkspaceID, connection.ID, "error", "poll_conflict", err.Error())
		}
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
	if connection, ok := s.store.FindBotConnection(connectionID); ok {
		s.appendConnectionLog(
			connection.WorkspaceID,
			connection.ID,
			"info",
			"poller_started",
			fmt.Sprintf("%s polling worker started.", providerDisplayName(connection.Provider)),
		)
	}

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
			func(_ context.Context, event PollingEvent) error {
				s.recordPollingEvent(connection.WorkspaceID, connection.ID, event)
				return nil
			},
		)
		if err == nil || ctx.Err() != nil || errors.Is(err, context.Canceled) {
			s.appendConnectionLog(
				connection.WorkspaceID,
				connection.ID,
				"info",
				"poller_stopped",
				fmt.Sprintf("%s polling worker stopped.", providerDisplayName(connection.Provider)),
			)
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

	s.updateConnectionPollState(connection.WorkspaceID, connection.ID, "failed", err.Error(), err.Error())
	s.appendConnectionLog(
		connection.WorkspaceID,
		connection.ID,
		"error",
		"poll_failed",
		"Polling iteration failed: "+strings.TrimSpace(err.Error()),
	)

	attrs := []slog.Attr{slog.String("error", err.Error())}
	var proxyDiagnostic interface{ PollingProxyURL() string }
	if errors.As(err, &proxyDiagnostic) {
		if proxyURL := strings.TrimSpace(proxyDiagnostic.PollingProxyURL()); proxyURL != "" {
			attrs = append(attrs, slog.String("proxyUrl", proxyURL))
		}
	}

	logBotDebug(nil, connection, "polling iteration failed", attrs...)
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
	commandText := job.message.Text
	if connection, ok := s.store.FindBotConnection(job.connectionID); ok {
		commandText = normalizeInboundCommandText(connection, commandText)
	}
	if isBotControlCommand(commandText) {
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
	if _, ok, _ := parseWeChatSlashCommand(text); ok {
		return true
	}
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
	case wechatProviderName:
		return "WeChat Bot"
	default:
		return "Bot Connection"
	}
}

func providerDisplayName(provider string) string {
	switch normalizeProviderName(provider) {
	case telegramProviderName:
		return "Telegram"
	case wechatProviderName:
		return "WeChat"
	default:
		if strings.TrimSpace(provider) == "" {
			return "Bot"
		}
		return strings.TrimSpace(provider)
	}
}

func cloneOptionalTimeLocal(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
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

func mergeProviderState(base map[string]string, overlay map[string]string) map[string]string {
	switch {
	case len(base) == 0 && len(overlay) == 0:
		return nil
	case len(base) == 0:
		next := make(map[string]string, len(overlay))
		for key, value := range overlay {
			if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
				continue
			}
			next[key] = strings.TrimSpace(value)
		}
		if len(next) == 0 {
			return nil
		}
		return next
	case len(overlay) == 0:
		return cloneStringMapLocal(base)
	}

	next := cloneStringMapLocal(base)
	for key, value := range overlay {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		next[key] = value
	}
	if len(next) == 0 {
		return nil
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
			if !outboundMessageHasContent(message) {
				continue
			}
			messages = append(messages, cloneOutboundMessage(message))
		}
		return messages
	}

	if strings.TrimSpace(update.Text) == "" {
		return nil
	}

	return []OutboundMessage{{Text: update.Text}}
}

func normalizeProviderStreamingUpdate(connection store.BotConnection, update StreamingUpdate) StreamingUpdate {
	return StreamingUpdate{
		Messages: normalizeProviderReplyMessages(connection, normalizeStreamingMessages(update)),
	}
}

func normalizeProviderAIResult(connection store.BotConnection, result AIResult) AIResult {
	next := result
	next.Messages = normalizeProviderReplyMessages(connection, result.Messages)
	return next
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
	command, recognized, err := parseBotApprovalCommand(normalizeInboundCommandText(connection, inbound.Text))
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
	command, recognized, err := parseBotConversationCommand(normalizeInboundCommandText(connection, inbound.Text))
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
		text := s.renderKnownConversationThreads(ctx, connection, conversation, command.filter)
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
	case "unarchive_thread":
		updatedConversation, text, commandErr := s.unarchiveConversationThread(ctx, connection, conversation, command.threadID)
		if commandErr != nil {
			text = "The bot could not unarchive the selected thread right now: " + commandErr.Error()
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
			filter := strings.ToLower(strings.TrimSpace(extra))
			switch filter {
			case "", "all":
				return botConversationCommand{kind: "list_threads", filter: "all"}, true, nil
			case "active", "archived":
				return botConversationCommand{kind: "list_threads", filter: filter}, true, nil
			default:
				return botConversationCommand{}, true, errors.New("usage: /thread list [active|archived|all]")
			}
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
		case "unarchive":
			threadID, trailing := splitBotCommandText(extra)
			if strings.TrimSpace(threadID) == "" || strings.TrimSpace(trailing) != "" {
				return botConversationCommand{}, true, errors.New("usage: /thread unarchive <thread_id|index>")
			}
			return botConversationCommand{kind: "unarchive_thread", threadID: strings.TrimSpace(threadID)}, true, nil
		case "use":
			threadID, trailing := splitBotCommandText(extra)
			if strings.TrimSpace(threadID) == "" || strings.TrimSpace(trailing) != "" {
				return botConversationCommand{}, true, errors.New("usage: /thread use <thread_id|index>")
			}
			return botConversationCommand{kind: "use_thread", threadID: strings.TrimSpace(threadID)}, true, nil
		default:
			return botConversationCommand{}, true, errors.New("usage: /thread | /thread list [active|archived|all] | /thread rename <title> | /thread archive | /thread unarchive <thread_id|index> | /thread use <thread_id|index>")
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

func normalizeInboundCommandText(connection store.BotConnection, text string) string {
	switch normalizeProviderName(connection.Provider) {
	case wechatProviderName:
		return trimWeChatQuotedPrefix(text)
	default:
		return text
	}
}

func trimWeChatQuotedPrefix(text string) string {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	start := 0
	for start < len(lines) {
		trimmed := strings.TrimSpace(lines[start])
		switch {
		case trimmed == "":
			start += 1
		case strings.HasPrefix(trimmed, "Quoted:"):
			start += 1
		default:
			return strings.TrimSpace(strings.Join(lines[start:], "\n"))
		}
	}
	return strings.TrimSpace(text)
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
		"/thread list [active|archived|all]",
		"  lists current thread first, then recent approvals/activity",
		"/thread rename <title>",
		"/thread archive",
		"/thread unarchive <thread_id|index>",
		"/thread use <thread_id|index>",
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
	threadID, err := s.resolveConversationThreadSelection(ctx, connection, conversation, selection, "active")
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

func (s *Service) unarchiveConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	selection string,
) (store.BotConversation, string, error) {
	if s.threads == nil {
		return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
	}

	threadID, err := s.resolveConversationThreadSelection(ctx, connection, conversation, selection, "archived")
	if err != nil {
		return store.BotConversation{}, "", err
	}
	thread, err := s.threads.Unarchive(ctx, connection.WorkspaceID, threadID)
	if err != nil {
		return store.BotConversation{}, "", err
	}

	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadIDs := appendKnownConversationThreadID(current.BackendState, current.ThreadID)
		knownThreadIDs = appendKnownConversationThreadID(conversationBackendStateWithKnownThreads(nil, knownThreadIDs), threadID)
		current.BackendState = mergeConversationBackendState(
			current.BackendState,
			conversationBackendStateWithKnownThreads(nil, knownThreadIDs),
			conversationContextVersion(current),
		)
		return current
	})
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "unarchived conversation thread",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", threadID),
		slog.Bool("archived", thread.Archived),
	)

	return updatedConversation, "Unarchived thread: " + threadID + "\nUse /thread use " + threadID + " to switch this conversation back.", nil
}

func (s *Service) clearConversationThreadBinding(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (store.BotConversation, string, error) {
	currentThreadID := strings.TrimSpace(conversation.ThreadID)
	if currentThreadID == "" {
		return conversation, "This conversation is not currently bound to a workspace thread.", nil
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

	logBotDebug(ctx, connection, "cleared conversation thread binding",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", currentThreadID),
		slog.Int("contextVersion", conversationContextVersion(updatedConversation)),
	)

	return updatedConversation, "Cleared the current conversation thread binding.\nThe next message will create a fresh workspace thread.", nil
}

type botThreadSummary struct {
	ID        string
	Name      string
	Preview   string
	Archived  bool
	UpdatedAt time.Time
}

type botThreadApprovalSummary struct {
	Count       int
	KindSummary string
	LatestText  string
	LatestAt    time.Time
}

func (s *Service) renderCurrentConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) string {
	currentThreadID := strings.TrimSpace(conversation.ThreadID)
	approvalSummaries := s.pendingApprovalSummariesByThread(connection.WorkspaceID)
	if currentThreadID == "" {
		lines := []string{
			"This conversation is not currently bound to a workspace thread.",
			"Use /newthread to start a new thread.",
		}
		if activeThreadIDs := s.orderedConversationThreadIDsForDisplay(ctx, connection, conversation, "active", approvalSummaries); len(activeThreadIDs) > 0 {
			lines = append(lines, formatThreadListHint("active", len(activeThreadIDs)))
		}
		if archivedThreadIDs := s.orderedConversationThreadIDsForDisplay(ctx, connection, conversation, "archived", approvalSummaries); len(archivedThreadIDs) > 0 {
			lines = append(lines, formatThreadListHint("archived", len(archivedThreadIDs)))
		}
		return strings.Join(lines, "\n")
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
	if pendingSummary, ok := approvalSummaries[currentThreadID]; ok && pendingSummary.Count > 0 {
		lines = append(lines, formatCurrentThreadPendingApprovalLine(pendingSummary))
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
	filter string,
) string {
	filter = normalizeConversationThreadFilter(filter)
	approvalSummaries := s.pendingApprovalSummariesByThread(connection.WorkspaceID)
	threadIDs := s.orderedConversationThreadIDsForDisplay(ctx, connection, conversation, filter, approvalSummaries)
	if len(threadIDs) == 0 {
		switch filter {
		case "active":
			return "No active workspace threads are currently recorded for this conversation."
		case "archived":
			return "No archived workspace threads are currently recorded for this conversation."
		default:
			return "No workspace threads have been recorded for this conversation yet."
		}
	}

	currentThreadID := strings.TrimSpace(conversation.ThreadID)
	heading := "Known workspace threads (current first, then recent approvals/activity):"
	switch filter {
	case "active":
		heading = "Known active workspace threads (current first, then recent approvals/activity):"
	case "archived":
		heading = "Known archived workspace threads (recent approvals/activity first):"
	}

	lines := []string{heading}
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
			if pendingSummary, ok := approvalSummaries[threadID]; ok && pendingSummary.Count > 0 {
				line += " | " + formatThreadPendingApprovalLabel(pendingSummary)
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
	filter string,
) (string, error) {
	selection = strings.TrimSpace(selection)
	if selection == "" {
		return "", errors.New("thread id is required")
	}

	filter = normalizeConversationThreadFilter(filter)
	approvalSummaries := s.pendingApprovalSummariesByThread(connection.WorkspaceID)
	allThreadIDs := s.orderedConversationThreadIDsForDisplay(ctx, connection, conversation, "all", approvalSummaries)
	threadIDs := s.orderedConversationThreadIDsForDisplay(ctx, connection, conversation, filter, approvalSummaries)

	for _, threadID := range threadIDs {
		if threadID == selection {
			return threadID, nil
		}
	}

	for _, threadID := range allThreadIDs {
		if threadID != selection {
			continue
		}
		if summary, ok := s.lookupConversationThreadSummary(ctx, connection, threadID); ok {
			switch filter {
			case "active":
				if summary.Archived {
					return "", fmt.Errorf("thread %q is archived; start a new thread or use an active thread instead", threadID)
				}
			case "archived":
				if !summary.Archived {
					return "", fmt.Errorf("thread %q is already active", threadID)
				}
			}
		}
		return "", s.unknownConversationThreadSelectionError(selection, filter)
	}

	index, err := strconv.Atoi(selection)
	if err == nil && index >= 1 && index <= len(threadIDs) {
		return threadIDs[index-1], nil
	}
	if err == nil && index >= 1 && index <= len(allThreadIDs) {
		threadID := allThreadIDs[index-1]
		if summary, ok := s.lookupConversationThreadSummary(ctx, connection, threadID); ok {
			switch filter {
			case "active":
				if summary.Archived {
					return "", fmt.Errorf("thread %q is archived; start a new thread or use an active thread instead", threadID)
				}
			case "archived":
				if !summary.Archived {
					return "", fmt.Errorf("thread %q is already active", threadID)
				}
			}
		}
	}

	if normalizeAIBackendName(connection.AIBackend) == defaultAIBackend && s.threads != nil {
		if detail, err := s.threads.GetDetail(ctx, connection.WorkspaceID, selection); err == nil {
			switch filter {
			case "active":
				if detail.Archived {
					return "", fmt.Errorf("thread %q is archived; start a new thread or use an active thread instead", selection)
				}
			case "archived":
				if !detail.Archived {
					return "", fmt.Errorf("thread %q is already active", selection)
				}
			}
			return selection, nil
		}
	}

	return "", s.unknownConversationThreadSelectionError(selection, filter)
}

func normalizeConversationThreadFilter(filter string) string {
	switch strings.ToLower(strings.TrimSpace(filter)) {
	case "active":
		return "active"
	case "archived":
		return "archived"
	default:
		return "all"
	}
}

func (s *Service) filteredConversationThreadIDs(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	filter string,
) []string {
	filter = normalizeConversationThreadFilter(filter)
	threadIDs := knownConversationThreadIDs(conversation)
	if currentThreadID := strings.TrimSpace(conversation.ThreadID); currentThreadID != "" {
		threadIDs = appendKnownConversationThreadID(
			conversationBackendStateWithKnownThreads(nil, threadIDs),
			currentThreadID,
		)
	}
	if filter == "all" {
		return threadIDs
	}

	filtered := make([]string, 0, len(threadIDs))
	for _, threadID := range threadIDs {
		summary, ok := s.lookupConversationThreadSummary(ctx, connection, threadID)
		if !ok {
			if filter == "active" {
				filtered = append(filtered, threadID)
			}
			continue
		}
		if filter == "archived" && summary.Archived {
			filtered = append(filtered, threadID)
			continue
		}
		if filter == "active" && !summary.Archived {
			filtered = append(filtered, threadID)
		}
	}
	return filtered
}

func (s *Service) orderedConversationThreadIDsForDisplay(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	filter string,
	approvalSummaries map[string]botThreadApprovalSummary,
) []string {
	threadIDs := s.filteredConversationThreadIDs(ctx, connection, conversation, filter)
	if len(threadIDs) <= 1 {
		return threadIDs
	}

	currentThreadID := strings.TrimSpace(conversation.ThreadID)
	type rankedThread struct {
		threadID  string
		index     int
		isCurrent bool
		latestAt  time.Time
		updatedAt time.Time
	}

	ranked := make([]rankedThread, 0, len(threadIDs))
	for index, threadID := range threadIDs {
		item := rankedThread{
			threadID:  threadID,
			index:     index,
			isCurrent: threadID == currentThreadID,
		}
		if approvalSummary, ok := approvalSummaries[threadID]; ok {
			item.latestAt = approvalSummary.LatestAt
		}
		if summary, ok := s.lookupConversationThreadSummary(ctx, connection, threadID); ok {
			item.updatedAt = summary.UpdatedAt
		}
		ranked = append(ranked, item)
	}

	sort.SliceStable(ranked, func(i int, j int) bool {
		left := ranked[i]
		right := ranked[j]
		if left.isCurrent != right.isCurrent {
			return left.isCurrent
		}
		if !left.latestAt.Equal(right.latestAt) {
			if left.latestAt.IsZero() != right.latestAt.IsZero() {
				return !left.latestAt.IsZero()
			}
			return left.latestAt.After(right.latestAt)
		}
		if !left.updatedAt.Equal(right.updatedAt) {
			if left.updatedAt.IsZero() != right.updatedAt.IsZero() {
				return !left.updatedAt.IsZero()
			}
			return left.updatedAt.After(right.updatedAt)
		}
		return left.index < right.index
	})

	ordered := make([]string, 0, len(ranked))
	for _, item := range ranked {
		ordered = append(ordered, item.threadID)
	}
	return ordered
}

func (s *Service) unknownConversationThreadSelectionError(selection string, filter string) error {
	switch normalizeConversationThreadFilter(filter) {
	case "active":
		return fmt.Errorf("thread %q is not known as an active thread in this conversation; use /thread list active to inspect available threads", selection)
	case "archived":
		return fmt.Errorf("thread %q is not known as an archived thread in this conversation; use /thread list archived to inspect available threads", selection)
	default:
		return fmt.Errorf("thread %q is not known in this conversation; use /thread list to inspect available threads", selection)
	}
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

func (s *Service) pendingApprovalSummariesByThread(workspaceID string) map[string]botThreadApprovalSummary {
	if s.approvals == nil {
		return nil
	}

	type accumulator struct {
		count             int
		kindCount         map[string]int
		latestRequestedAt time.Time
		latestSummary     string
	}

	accumulators := make(map[string]*accumulator)
	for _, item := range s.approvals.List(workspaceID) {
		threadID := strings.TrimSpace(item.ThreadID)
		if threadID == "" {
			continue
		}
		entry := accumulators[threadID]
		if entry == nil {
			entry = &accumulator{kindCount: make(map[string]int)}
			accumulators[threadID] = entry
		}
		entry.count += 1
		entry.kindCount[humanizeApprovalKind(item.Kind)] += 1
		if item.RequestedAt.After(entry.latestRequestedAt) || entry.latestRequestedAt.IsZero() {
			entry.latestRequestedAt = item.RequestedAt
			entry.latestSummary = strings.TrimSpace(item.Summary)
		}
	}

	if len(accumulators) == 0 {
		return nil
	}

	summaries := make(map[string]botThreadApprovalSummary, len(accumulators))
	for threadID, entry := range accumulators {
		summaries[threadID] = botThreadApprovalSummary{
			Count:       entry.count,
			KindSummary: formatThreadApprovalKindSummary(entry.kindCount),
			LatestText:  formatBotApprovalSummaryPreview(entry.latestSummary),
			LatestAt:    entry.latestRequestedAt,
		}
	}
	return summaries
}

func formatThreadPendingApprovalLabel(summary botThreadApprovalSummary) string {
	if summary.Count <= 0 {
		return ""
	}
	details := make([]string, 0, 2)
	if summary.KindSummary != "" {
		details = append(details, summary.KindSummary)
	}
	if summary.LatestText != "" {
		details = append(details, "latest: "+summary.LatestText)
	}
	if formatted := formatBotThreadTimestamp(summary.LatestAt); formatted != "" {
		details = append(details, "requested "+formatted)
	}
	if len(details) > 0 {
		if summary.Count == 1 {
			return "1 pending approval: " + strings.Join(details, "; ")
		}
		return fmt.Sprintf("%d pending approvals: %s", summary.Count, strings.Join(details, "; "))
	}
	if summary.Count == 1 {
		return "1 pending approval"
	}
	return fmt.Sprintf("%d pending approvals", summary.Count)
}

func formatCurrentThreadPendingApprovalLine(summary botThreadApprovalSummary) string {
	if summary.Count <= 0 {
		return ""
	}
	details := make([]string, 0, 3)
	if summary.KindSummary != "" {
		details = append(details, summary.KindSummary)
	}
	if summary.LatestText != "" {
		details = append(details, "latest: "+summary.LatestText)
	}
	if formatted := formatBotThreadTimestamp(summary.LatestAt); formatted != "" {
		details = append(details, "requested "+formatted)
	}
	details = append(details, "use /approvals")
	if len(details) > 1 {
		if summary.Count == 1 {
			return "Pending approval: 1 (" + strings.Join(details, "; ") + ")"
		}
		return fmt.Sprintf("Pending approvals: %d (%s)", summary.Count, strings.Join(details, "; "))
	}
	if summary.Count == 1 {
		return "Pending approval: 1 (use /approvals)"
	}
	return fmt.Sprintf("Pending approvals: %d (use /approvals)", summary.Count)
}

func formatThreadApprovalKindSummary(kindCounts map[string]int) string {
	if len(kindCounts) == 0 {
		return ""
	}

	type item struct {
		label string
		count int
	}

	items := make([]item, 0, len(kindCounts))
	for label, count := range kindCounts {
		label = strings.TrimSpace(label)
		if label == "" || count <= 0 {
			continue
		}
		items = append(items, item{label: label, count: count})
	}
	if len(items) == 0 {
		return ""
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].count != items[j].count {
			return items[i].count > items[j].count
		}
		return items[i].label < items[j].label
	})

	limit := minInt(len(items), 2)
	parts := make([]string, 0, limit+1)
	for index := 0; index < limit; index++ {
		parts = append(parts, fmt.Sprintf("%s x%d", items[index].label, items[index].count))
	}
	if len(items) > limit {
		parts = append(parts, fmt.Sprintf("+%d more type(s)", len(items)-limit))
	}
	return strings.Join(parts, ", ")
}

func formatBotApprovalSummaryPreview(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if value == "" {
		return ""
	}
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) <= 80 {
		return value
	}
	return strings.TrimSpace(string(runes[:80])) + "..."
}

func formatThreadListHint(filter string, count int) string {
	filter = normalizeConversationThreadFilter(filter)
	if count <= 0 {
		return ""
	}
	switch filter {
	case "active":
		if count == 1 {
			return "Use /thread list active to inspect 1 known active thread."
		}
		return fmt.Sprintf("Use /thread list active to inspect %d known active threads.", count)
	case "archived":
		if count == 1 {
			return "Use /thread list archived to inspect 1 archived thread."
		}
		return fmt.Sprintf("Use /thread list archived to inspect %d archived threads.", count)
	default:
		if count == 1 {
			return "Use /thread list to inspect 1 known thread."
		}
		return fmt.Sprintf("Use /thread list to inspect %d known threads.", count)
	}
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
		return approvals.ResponseInput{}, errors.New("this request cannot be completed from this bot provider; use the workspace UI instead")
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
	if !inboundMessageHasContent(message) || strings.TrimSpace(message.ConversationID) == "" {
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
		Media:                  cloneBotMessageMediaList(message.Media),
		ProviderData:           mergeProviderState(nil, message.ProviderData),
	})
	if err != nil {
		return false, err
	}
	if !shouldEnqueue {
		if deliveryHasSavedReplySnapshot(delivery) && strings.EqualFold(strings.TrimSpace(delivery.Status), "failed") {
			s.appendConnectionLog(
				connection.WorkspaceID,
				connection.ID,
				"warning",
				"duplicate_delivery_suppressed",
				duplicateSavedReplySuppressionMessage(delivery),
			)
			s.notifyDuplicateDeliverySuppressed(connection, delivery)
		}
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
	deliveries, suppressed := s.store.PrepareBotInboundDeliveriesForRecovery(workspaceID, connectionID)
	for _, delivery := range suppressed {
		connection, ok := s.store.FindBotConnection(delivery.ConnectionID)
		if !ok {
			continue
		}
		s.appendConnectionLog(
			connection.WorkspaceID,
			connection.ID,
			"warning",
			"recovery_replay_suppressed",
			recoverySavedReplySuppressionMessage(delivery),
		)
		s.notifyRecoveryReplaySuppressed(connection, delivery)
	}

	for _, delivery := range deliveries {
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

func deliveryHasSavedReplySnapshot(delivery store.BotInboundDelivery) bool {
	_, ok := aiResultFromDelivery(delivery)
	return ok
}

func savedReplySnapshotMessageCount(delivery store.BotInboundDelivery) int {
	reply, ok := aiResultFromDelivery(delivery)
	if !ok {
		return 0
	}
	return len(reply.Messages)
}

func duplicateSavedReplySuppressionMessage(delivery store.BotInboundDelivery) string {
	messageID := firstNonEmpty(strings.TrimSpace(delivery.MessageID), "unknown")
	conversationID := firstNonEmpty(
		strings.TrimSpace(delivery.ExternalConversationID),
		strings.TrimSpace(delivery.ExternalChatID),
		"unknown",
	)
	replyCount := savedReplySnapshotMessageCount(delivery)
	return fmt.Sprintf(
		"Ignored duplicate inbound message %s for conversation %s because failed delivery %s already has a saved reply snapshot with %d outbound %s. Replaying it could duplicate previously sent content.",
		messageID,
		conversationID,
		delivery.ID,
		replyCount,
		pluralizeLabel(replyCount, "message", "messages"),
	)
}

func recoverySavedReplySuppressionMessage(delivery store.BotInboundDelivery) string {
	messageID := firstNonEmpty(strings.TrimSpace(delivery.MessageID), "unknown")
	replyCount := savedReplySnapshotMessageCount(delivery)
	return fmt.Sprintf(
		"Skipped automatic recovery for failed delivery %s (message %s) because a saved reply snapshot with %d outbound %s already exists. Replaying it after restart could duplicate previously sent content.",
		delivery.ID,
		messageID,
		replyCount,
		pluralizeLabel(replyCount, "message", "messages"),
	)
}

func pluralizeLabel(count int, singular string, plural string) string {
	if count == 1 {
		return singular
	}
	return plural
}

func (s *Service) notifyDuplicateDeliverySuppressed(connection store.BotConnection, delivery store.BotInboundDelivery) {
	s.createBotSuppressionNotification(
		connection,
		"bot_duplicate_delivery_suppressed",
		"Duplicate bot replay suppressed",
		fmt.Sprintf(
			"%s ignored a duplicate inbound delivery for message %s because a failed delivery already had a saved reply snapshot. Open bot logs for details.",
			firstNonEmpty(strings.TrimSpace(connection.Name), connection.ID),
			firstNonEmpty(strings.TrimSpace(delivery.MessageID), "unknown"),
		),
	)
}

func (s *Service) notifyRecoveryReplaySuppressed(connection store.BotConnection, delivery store.BotInboundDelivery) {
	s.createBotSuppressionNotification(
		connection,
		"bot_recovery_replay_suppressed",
		"Restart bot replay suppressed",
		fmt.Sprintf(
			"%s skipped replaying failed delivery %s for message %s during startup recovery because a saved reply snapshot already existed. Open bot logs for details.",
			firstNonEmpty(strings.TrimSpace(connection.Name), connection.ID),
			delivery.ID,
			firstNonEmpty(strings.TrimSpace(delivery.MessageID), "unknown"),
		),
	)
}

func (s *Service) notifyReplyDeliveryFailed(
	connection store.BotConnection,
	delivery store.BotInboundDelivery,
	cause error,
	attemptCount int,
) {
	workspace, ok := s.store.GetWorkspace(connection.WorkspaceID)
	if !ok {
		return
	}

	notification, err := s.store.CreateNotification(store.Notification{
		WorkspaceID:       connection.WorkspaceID,
		WorkspaceName:     workspace.Name,
		BotConnectionID:   connection.ID,
		BotConnectionName: connection.Name,
		Kind:              "bot_reply_delivery_failed",
		Title:             "Bot reply delivery failed",
		Message: fmt.Sprintf(
			"%s failed to deliver a bot reply for message %s after %d attempt(s). %s",
			firstNonEmpty(strings.TrimSpace(connection.Name), connection.ID),
			firstNonEmpty(strings.TrimSpace(delivery.MessageID), "unknown"),
			maxInt(attemptCount, 1),
			failureReplyDetail(cause),
		),
		Level: "warning",
	})
	if err != nil {
		return
	}

	s.publish(connection.WorkspaceID, "", "notification/created", map[string]any{
		"notificationId":    notification.ID,
		"kind":              notification.Kind,
		"title":             notification.Title,
		"message":           notification.Message,
		"level":             notification.Level,
		"read":              notification.Read,
		"botConnectionId":   notification.BotConnectionID,
		"botConnectionName": notification.BotConnectionName,
	})
}

func (s *Service) createBotSuppressionNotification(
	connection store.BotConnection,
	kind string,
	title string,
	message string,
) {
	workspace, ok := s.store.GetWorkspace(connection.WorkspaceID)
	if !ok {
		return
	}

	now := time.Now().UTC()
	for _, notification := range s.store.ListNotifications() {
		if notification.WorkspaceID != connection.WorkspaceID {
			continue
		}
		if strings.TrimSpace(notification.BotConnectionID) != connection.ID {
			continue
		}
		if strings.TrimSpace(notification.Kind) != strings.TrimSpace(kind) {
			continue
		}
		if now.Sub(notification.CreatedAt) < botSuppressionNotificationCooldown {
			return
		}
	}

	notification, err := s.store.CreateNotification(store.Notification{
		WorkspaceID:       connection.WorkspaceID,
		WorkspaceName:     workspace.Name,
		BotConnectionID:   connection.ID,
		BotConnectionName: connection.Name,
		Kind:              strings.TrimSpace(kind),
		Title:             strings.TrimSpace(title),
		Message:           strings.TrimSpace(message),
		Level:             "warning",
	})
	if err != nil {
		return
	}

	s.publish(connection.WorkspaceID, "", "notification/created", map[string]any{
		"notificationId":    notification.ID,
		"kind":              notification.Kind,
		"title":             notification.Title,
		"message":           notification.Message,
		"level":             notification.Level,
		"read":              notification.Read,
		"botConnectionId":   notification.BotConnectionID,
		"botConnectionName": notification.BotConnectionName,
	})
}

func replyDeliveryAttemptCount(err error) int {
	var deliveryErr *replyDeliveryError
	if errors.As(err, &deliveryErr) && deliveryErr.attemptCount > 0 {
		return deliveryErr.attemptCount
	}
	return 0
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func (s *Service) recordConversationOutcome(
	connection store.BotConnection,
	conversation store.BotConversation,
	reply AIResult,
	inbound InboundMessage,
	fallbackOutboundText string,
) store.BotConversation {
	return s.recordConversationReplyOutcome(
		connection,
		conversation,
		reply,
		inbound,
		fallbackOutboundText,
		conversationReplyDeliveryState{},
	)
}

func (s *Service) recordConversationReplyOutcome(
	connection store.BotConnection,
	conversation store.BotConversation,
	reply AIResult,
	inbound InboundMessage,
	fallbackOutboundText string,
	deliveryState conversationReplyDeliveryState,
) store.BotConversation {
	lastOutboundText := strings.TrimSpace(fallbackOutboundText)
	if len(reply.Messages) > 0 {
		lastMessage := reply.Messages[len(reply.Messages)-1]
		lastOutboundText = messageSummaryText(lastMessage.Text, lastMessage.Media)
	}
	expectedContextVersion := conversationContextVersion(conversation)
	lastInboundText := messageSummaryText(inbound.Text, inbound.Media)

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
		current.LastInboundText = lastInboundText
		current.LastOutboundText = lastOutboundText
		current.LastOutboundDeliveryStatus = strings.TrimSpace(deliveryState.status)
		current.LastOutboundDeliveryError = strings.TrimSpace(deliveryState.lastError)
		current.LastOutboundDeliveryAttemptCount = deliveryState.attemptCount
		current.LastOutboundDeliveredAt = cloneOptionalTimeLocal(deliveryState.deliveredAt)
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
			updatedConversation.LastInboundText = lastInboundText
			updatedConversation.LastOutboundText = lastOutboundText
			updatedConversation.LastOutboundDeliveryStatus = strings.TrimSpace(deliveryState.status)
			updatedConversation.LastOutboundDeliveryError = strings.TrimSpace(deliveryState.lastError)
			updatedConversation.LastOutboundDeliveryAttemptCount = deliveryState.attemptCount
			updatedConversation.LastOutboundDeliveredAt = cloneOptionalTimeLocal(deliveryState.deliveredAt)
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
		Media:            cloneBotMessageMediaList(delivery.Media),
		ProviderData:     mergeProviderState(nil, delivery.ProviderData),
	}
}

func inboundMessageFromConversation(conversation store.BotConversation) InboundMessage {
	return InboundMessage{
		ConversationID:   firstNonEmpty(strings.TrimSpace(conversation.ExternalConversationID), strings.TrimSpace(conversation.ExternalChatID)),
		ExternalChatID:   strings.TrimSpace(conversation.ExternalChatID),
		ExternalThreadID: strings.TrimSpace(conversation.ExternalThreadID),
		UserID:           strings.TrimSpace(conversation.ExternalUserID),
		Username:         strings.TrimSpace(conversation.ExternalUsername),
		Title:            strings.TrimSpace(conversation.ExternalTitle),
		ProviderData:     mergeProviderState(nil, conversation.ProviderState),
	}
}

func aiResultFromDelivery(delivery store.BotInboundDelivery) (AIResult, bool) {
	if len(delivery.ReplyMessages) > 0 {
		messages := make([]OutboundMessage, 0, len(delivery.ReplyMessages))
		for _, replyMessage := range delivery.ReplyMessages {
			message := OutboundMessage{
				Text:  strings.TrimSpace(replyMessage.Text),
				Media: cloneBotMessageMediaList(replyMessage.Media),
			}
			if !outboundMessageHasContent(message) {
				continue
			}
			messages = append(messages, message)
		}
		if len(messages) == 0 {
			return AIResult{}, false
		}
		return AIResult{
			ThreadID: strings.TrimSpace(delivery.ReplyThreadID),
			Messages: messages,
		}, true
	}

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

func debugConnectionDeliveryMode(connection store.BotConnection) string {
	switch normalizeProviderName(connection.Provider) {
	case telegramProviderName:
		return strings.TrimSpace(connection.Settings[telegramDeliveryModeSetting])
	case wechatProviderName:
		return strings.TrimSpace(connection.Settings[wechatDeliveryModeSetting])
	default:
		return ""
	}
}

func connectionViewFromStore(connection store.BotConnection) ConnectionView {
	secretKeys := make([]string, 0, len(connection.Secrets))
	for key := range connection.Secrets {
		secretKeys = append(secretKeys, key)
	}
	sort.Strings(secretKeys)

	return ConnectionView{
		ID:              connection.ID,
		BotID:           strings.TrimSpace(connection.BotID),
		WorkspaceID:     connection.WorkspaceID,
		Provider:        connection.Provider,
		Name:            connection.Name,
		Status:          connection.Status,
		AIBackend:       connection.AIBackend,
		AIConfig:        cloneStringMapLocal(connection.AIConfig),
		Settings:        cloneStringMapLocal(connection.Settings),
		SecretKeys:      secretKeys,
		LastError:       connection.LastError,
		LastPollAt:      cloneOptionalTimeLocal(connection.LastPollAt),
		LastPollStatus:  connection.LastPollStatus,
		LastPollMessage: connection.LastPollMessage,
		CreatedAt:       connection.CreatedAt,
		UpdatedAt:       connection.UpdatedAt,
	}
}

func botViewFromStore(bot store.Bot, defaultBinding store.BotBinding, endpointCount int, conversationCount int) BotView {
	return BotView{
		ID:                     strings.TrimSpace(bot.ID),
		WorkspaceID:            strings.TrimSpace(bot.WorkspaceID),
		Name:                   strings.TrimSpace(bot.Name),
		Description:            strings.TrimSpace(bot.Description),
		Status:                 strings.TrimSpace(bot.Status),
		DefaultBindingID:       strings.TrimSpace(bot.DefaultBindingID),
		DefaultBindingMode:     strings.TrimSpace(defaultBinding.BindingMode),
		DefaultTargetWorkspace: strings.TrimSpace(defaultBinding.TargetWorkspaceID),
		DefaultTargetThreadID:  strings.TrimSpace(defaultBinding.TargetThreadID),
		EndpointCount:          endpointCount,
		ConversationCount:      conversationCount,
		CreatedAt:              bot.CreatedAt,
		UpdatedAt:              bot.UpdatedAt,
	}
}

func botBindingViewFromStore(binding store.BotBinding, isDefault bool) BotBindingView {
	return BotBindingView{
		ID:                strings.TrimSpace(binding.ID),
		WorkspaceID:       strings.TrimSpace(binding.WorkspaceID),
		BotID:             strings.TrimSpace(binding.BotID),
		Name:              strings.TrimSpace(binding.Name),
		BindingMode:       strings.TrimSpace(binding.BindingMode),
		TargetWorkspaceID: strings.TrimSpace(binding.TargetWorkspaceID),
		TargetThreadID:    strings.TrimSpace(binding.TargetThreadID),
		AIBackend:         strings.TrimSpace(binding.AIBackend),
		AIConfig:          cloneStringMapLocal(binding.AIConfig),
		IsDefault:         isDefault,
		CreatedAt:         binding.CreatedAt,
		UpdatedAt:         binding.UpdatedAt,
	}
}

func wechatAccountViewFromStore(account store.WeChatAccount) WeChatAccountView {
	return WeChatAccountView{
		ID:              strings.TrimSpace(account.ID),
		WorkspaceID:     strings.TrimSpace(account.WorkspaceID),
		Alias:           strings.TrimSpace(account.Alias),
		Note:            strings.TrimSpace(account.Note),
		BaseURL:         strings.TrimSpace(account.BaseURL),
		AccountID:       strings.TrimSpace(account.AccountID),
		UserID:          strings.TrimSpace(account.UserID),
		LastLoginID:     strings.TrimSpace(account.LastLoginID),
		LastConfirmedAt: account.LastConfirmedAt,
		CreatedAt:       account.CreatedAt,
		UpdatedAt:       account.UpdatedAt,
	}
}

func conversationViewFromStore(conversation store.BotConversation, binding store.BotBinding, hasBinding bool) ConversationView {
	resolvedBindingID := ""
	resolvedBindingMode := ""
	resolvedTargetWorkspaceID := ""
	resolvedTargetThreadID := ""
	if hasBinding {
		resolvedBindingID = strings.TrimSpace(binding.ID)
		resolvedBindingMode = strings.TrimSpace(binding.BindingMode)
		resolvedTargetWorkspaceID = strings.TrimSpace(binding.TargetWorkspaceID)
		resolvedTargetThreadID = strings.TrimSpace(binding.TargetThreadID)
		if resolvedTargetWorkspaceID == "" {
			resolvedTargetWorkspaceID = strings.TrimSpace(conversation.WorkspaceID)
		}
		if resolvedBindingMode == "workspace_auto_thread" && strings.TrimSpace(conversation.ThreadID) != "" {
			resolvedTargetThreadID = strings.TrimSpace(conversation.ThreadID)
		}
	}
	return ConversationView{
		ID:                               conversation.ID,
		BotID:                            strings.TrimSpace(conversation.BotID),
		BindingID:                        strings.TrimSpace(conversation.BindingID),
		ResolvedBindingID:                resolvedBindingID,
		ResolvedBindingMode:              resolvedBindingMode,
		ResolvedTargetWorkspaceID:        resolvedTargetWorkspaceID,
		ResolvedTargetThreadID:           resolvedTargetThreadID,
		WorkspaceID:                      conversation.WorkspaceID,
		ConnectionID:                     conversation.ConnectionID,
		Provider:                         conversation.Provider,
		ExternalConversationID:           strings.TrimSpace(conversation.ExternalConversationID),
		ExternalChatID:                   strings.TrimSpace(conversation.ExternalChatID),
		ExternalThreadID:                 strings.TrimSpace(conversation.ExternalThreadID),
		ExternalUserID:                   strings.TrimSpace(conversation.ExternalUserID),
		ExternalUsername:                 strings.TrimSpace(conversation.ExternalUsername),
		ExternalTitle:                    strings.TrimSpace(conversation.ExternalTitle),
		ThreadID:                         strings.TrimSpace(conversation.ThreadID),
		LastInboundMessageID:             strings.TrimSpace(conversation.LastInboundMessageID),
		LastInboundText:                  strings.TrimSpace(conversation.LastInboundText),
		LastOutboundText:                 strings.TrimSpace(conversation.LastOutboundText),
		LastOutboundDeliveryStatus:       strings.TrimSpace(conversation.LastOutboundDeliveryStatus),
		LastOutboundDeliveryError:        strings.TrimSpace(conversation.LastOutboundDeliveryError),
		LastOutboundDeliveryAttemptCount: conversation.LastOutboundDeliveryAttemptCount,
		LastOutboundDeliveredAt:          cloneOptionalTimeLocal(conversation.LastOutboundDeliveredAt),
		CreatedAt:                        conversation.CreatedAt,
		UpdatedAt:                        conversation.UpdatedAt,
	}
}

func IsIgnorableWebhookError(err error) bool {
	return err != nil && (errors.Is(err, ErrWebhookIgnored) || errors.Is(err, context.Canceled))
}
