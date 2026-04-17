package bots

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
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
	defaultTelegramMediaGroupQuietTime = 3 * time.Second
	defaultTelegramMediaGroupSeenTTL   = 2 * time.Minute
	botFailureDetailCharLimit          = 1200
	botConversationContextKey          = "_bot_context_version"
	botConversationThreadListKey       = "_bot_known_thread_ids"
	botConversationCurrentThreadKey    = "_bot_current_thread_ref"
	botConversationPendingStartKey     = "_bot_pending_session_start_source"
	botConversationThreadRefSeparator  = "\t"
	botConversationThreadDisplaySep    = "/"
	botSuppressionNotificationCooldown = 15 * time.Minute
	botReplyDeliveryStatusSending      = "sending"
	botReplyDeliveryStatusRetrying     = "retrying"
	botReplyDeliveryStatusDelivered    = "delivered"
	botReplyDeliveryStatusFailed       = "failed"
	deliveryTargetReadinessReady       = "ready"
	deliveryTargetReadinessWaiting     = "waiting_for_context"
	botScopeWorkspace                  = "workspace"
	botScopeGlobal                     = "global"
	botSharingModeOwnerOnly            = "owner_only"
	botSharingModeAllWorkspaces        = "all_workspaces"
	botSharingModeSelected             = "selected_workspaces"
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

	mu                                sync.Mutex
	baseCtx                           context.Context
	workers                           map[string]*inboundWorker
	pollers                           map[string]*pollerHandle
	threadBoundTurns                  map[string]threadBoundTurnDispatch
	telegramMediaGroups               map[string]*telegramMediaGroupBuffer
	telegramMediaGroupSeen            map[string]*telegramMediaGroupSeenState
	messageTimeout                    time.Duration
	queueSize                         int
	workerIdleTimeout                 time.Duration
	telegramMediaGroupQuiet           time.Duration
	telegramMediaGroupSeenTTL         time.Duration
	notificationCenterManagedTriggers bool
	triggerDispatcherStarted          bool
	threadBindingDispatcherStarted    bool
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

type telegramMediaGroupBuffer struct {
	connection store.BotConnection
	groupID    string
	revision   int
	messages   map[string]InboundMessage
	lateBatch  bool
}

type telegramMediaGroupSeenState struct {
	revision int
	itemKeys map[string]struct{}
}

type pollerHandle struct {
	cancel context.CancelFunc
}

type threadBoundTurnDispatch struct {
	bindingID      string
	targetID       string
	botID          string
	botWorkspaceID string
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

type replyOutboundDeliveryContext struct {
	target             store.BotDeliveryTarget
	sendConversation   store.BotConversation
	storedConversation *store.BotConversation
	outboundDelivery   store.BotOutboundDelivery
}

type outboundDeliveryRetryHooks struct {
	onAttemptStart func(attempt int)
	onRetry        func(nextAttempt int, lastError string, delay time.Duration)
}

type botThreadRef struct {
	WorkspaceID string
	ThreadID    string
}

type deliveryTargetReadinessState struct {
	Readiness         string
	Message           string
	LastContextSeenAt *time.Time
}

type wechatOutboundContextResolution struct {
	ToUserID           string
	SendConversation   store.BotConversation
	StoredConversation *store.BotConversation
	LastContextSeenAt  *time.Time
	HasUsableContext   bool
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
		store:                             dataStore,
		threads:                           threadService,
		turns:                             turnService,
		events:                            eventHub,
		publicBaseURL:                     strings.TrimSpace(cfg.PublicBaseURL),
		approvals:                         cfg.Approvals,
		providers:                         make(map[string]Provider),
		aiBackends:                        make(map[string]AIBackend),
		wechatAuth:                        newWeChatAuthService(clientSource),
		workers:                           make(map[string]*inboundWorker),
		pollers:                           make(map[string]*pollerHandle),
		threadBoundTurns:                  make(map[string]threadBoundTurnDispatch),
		telegramMediaGroups:               make(map[string]*telegramMediaGroupBuffer),
		telegramMediaGroupSeen:            make(map[string]*telegramMediaGroupSeenState),
		messageTimeout:                    cfg.MessageTimeout,
		queueSize:                         defaultWorkerQueueSize,
		workerIdleTimeout:                 defaultWorkerIdleTimeout,
		notificationCenterManagedTriggers: cfg.NotificationCenterManagedTriggers,
	}

	service.registerProvider(newTelegramProviderWithClientSource(clientSource))
	service.registerProvider(newWeChatProviderWithClientSource(clientSource))
	service.registerProvider(newFeishuProviderWithClientSource(clientSource))
	service.registerProvider(newQQBotProviderWithClientSource(clientSource))
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

	if !s.notificationCenterManagedTriggers {
		s.startTriggerDispatcher(ctx)
	}
	s.startThreadBindingDispatcher(ctx)
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

func (s *Service) ListAllConnections() []ConnectionView {
	views := make([]ConnectionView, 0)
	for _, workspace := range s.store.ListWorkspaces() {
		views = append(views, s.ListConnections(workspace.ID)...)
	}
	sort.Slice(views, func(i int, j int) bool {
		if views[i].UpdatedAt.Equal(views[j].UpdatedAt) {
			return views[i].ID < views[j].ID
		}
		return views[i].UpdatedAt.After(views[j].UpdatedAt)
	})
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

func (s *Service) GetConnectionByID(connectionID string) (ConnectionView, error) {
	connection, ok := s.store.FindBotConnection(connectionID)
	if !ok {
		return ConnectionView{}, store.ErrBotConnectionNotFound
	}
	return s.GetConnection(connection.WorkspaceID, connection.ID)
}

func (s *Service) ListBots(workspaceID string) []BotView {
	return s.listWorkspaceBotViews(workspaceID, nil)
}

func (s *Service) listWorkspaceBotViews(workspaceID string, predicate func(store.Bot) bool) []BotView {
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
		if predicate != nil && !predicate(bot) {
			continue
		}
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

func (s *Service) ListAllBots() []BotView {
	views := make([]BotView, 0)
	for _, workspace := range s.store.ListWorkspaces() {
		views = append(views, s.listWorkspaceBotViews(workspace.ID, nil)...)
	}
	sort.Slice(views, func(i int, j int) bool {
		if views[i].UpdatedAt.Equal(views[j].UpdatedAt) {
			return views[i].ID < views[j].ID
		}
		return views[i].UpdatedAt.After(views[j].UpdatedAt)
	})
	return views
}

func (s *Service) ListAvailableBots(workspaceID string) ([]BotView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}

	views := make([]BotView, 0)
	for _, workspace := range s.store.ListWorkspaces() {
		views = append(views, s.listWorkspaceBotViews(workspace.ID, func(bot store.Bot) bool {
			return s.botAccessibleToWorkspace(bot, resolvedWorkspaceID)
		})...)
	}
	sort.Slice(views, func(i int, j int) bool {
		if views[i].UpdatedAt.Equal(views[j].UpdatedAt) {
			return views[i].ID < views[j].ID
		}
		return views[i].UpdatedAt.After(views[j].UpdatedAt)
	})
	return views, nil
}

func (s *Service) CreateBot(workspaceID string, input CreateBotInput) (BotView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return BotView{}, err
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Bot"
	}

	scope, sharingMode, sharedWorkspaceIDs, err := s.normalizeBotAccessPolicy(resolvedWorkspaceID, input.Scope, input.SharingMode, input.SharedWorkspaceIDs)
	if err != nil {
		return BotView{}, err
	}

	created, err := s.store.CreateBot(store.Bot{
		ID:                 store.NewID("botr"),
		WorkspaceID:        resolvedWorkspaceID,
		Scope:              scope,
		SharingMode:        sharingMode,
		SharedWorkspaceIDs: sharedWorkspaceIDs,
		Name:               name,
		Description:        strings.TrimSpace(input.Description),
		Status:             "active",
	})
	if err != nil {
		return BotView{}, err
	}

	s.publish(created.WorkspaceID, "", "bot/created", map[string]any{
		"botId":              created.ID,
		"name":               created.Name,
		"description":        created.Description,
		"status":             created.Status,
		"scope":              created.Scope,
		"sharingMode":        created.SharingMode,
		"sharedWorkspaceIds": cloneStringSliceLocal(created.SharedWorkspaceIDs),
	})

	return botViewFromStore(created, store.BotBinding{}, 0, 0), nil
}

func (s *Service) UpdateBot(workspaceID string, botID string, input UpdateBotInput) (BotView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return BotView{}, err
	}

	resolvedBotID := strings.TrimSpace(botID)
	if resolvedBotID == "" {
		return BotView{}, store.ErrBotNotFound
	}

	existing, ok := s.store.GetBot(resolvedWorkspaceID, resolvedBotID)
	if !ok {
		return BotView{}, store.ErrBotNotFound
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = firstNonEmpty(strings.TrimSpace(existing.Name), "Bot")
	}

	scopeInput := firstNonEmpty(strings.TrimSpace(input.Scope), normalizeBotScopeValue(existing.Scope))
	sharingModeInput := strings.TrimSpace(input.SharingMode)
	if sharingModeInput == "" {
		sharingModeInput = normalizeResolvedBotSharingMode(existing)
	}

	sharedWorkspaceIDsInput := input.SharedWorkspaceIDs
	if sharedWorkspaceIDsInput == nil && strings.EqualFold(scopeInput, botScopeGlobal) && strings.EqualFold(sharingModeInput, botSharingModeSelected) {
		sharedWorkspaceIDsInput = existing.SharedWorkspaceIDs
	}

	scope, sharingMode, sharedWorkspaceIDs, err := s.normalizeBotAccessPolicy(
		resolvedWorkspaceID,
		scopeInput,
		sharingModeInput,
		sharedWorkspaceIDsInput,
	)
	if err != nil {
		return BotView{}, err
	}

	updated, err := s.store.UpdateBot(resolvedWorkspaceID, resolvedBotID, func(current store.Bot) store.Bot {
		current.Name = name
		current.Description = strings.TrimSpace(input.Description)
		current.Scope = scope
		current.SharingMode = sharingMode
		current.SharedWorkspaceIDs = sharedWorkspaceIDs
		return current
	})
	if err != nil {
		return BotView{}, err
	}

	endpointCount := 0
	for _, connection := range s.store.ListBotConnections(resolvedWorkspaceID) {
		if strings.TrimSpace(connection.BotID) == updated.ID {
			endpointCount++
		}
	}

	conversationCount := 0
	for _, conversation := range s.store.ListBotConversations(resolvedWorkspaceID, "") {
		if strings.TrimSpace(conversation.BotID) == updated.ID {
			conversationCount++
		}
	}

	defaultBinding, _ := s.store.GetBotBinding(updated.WorkspaceID, updated.DefaultBindingID)

	s.publish(updated.WorkspaceID, "", "bot/updated", map[string]any{
		"botId":              updated.ID,
		"name":               updated.Name,
		"description":        updated.Description,
		"status":             updated.Status,
		"scope":              updated.Scope,
		"sharingMode":        updated.SharingMode,
		"sharedWorkspaceIds": cloneStringSliceLocal(updated.SharedWorkspaceIDs),
	})

	return botViewFromStore(updated, defaultBinding, endpointCount, conversationCount), nil
}

func (s *Service) GetThreadBotBinding(workspaceID string, threadID string) (ThreadBotBindingView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return ThreadBotBindingView{}, err
	}
	binding, ok := s.store.GetThreadBotBinding(resolvedWorkspaceID, strings.TrimSpace(threadID))
	if !ok {
		return ThreadBotBindingView{}, store.ErrThreadBotBindingNotFound
	}
	return s.threadBotBindingViewFromStore(binding)
}

func (s *Service) UpsertThreadBotBinding(
	ctx context.Context,
	workspaceID string,
	threadID string,
	input UpsertThreadBotBindingInput,
) (ThreadBotBindingView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return ThreadBotBindingView{}, err
	}
	resolvedThreadID := strings.TrimSpace(threadID)
	if resolvedThreadID == "" {
		return ThreadBotBindingView{}, store.ErrThreadNotFound
	}
	if _, ok := s.store.GetThread(resolvedWorkspaceID, resolvedThreadID); !ok {
		return ThreadBotBindingView{}, store.ErrThreadNotFound
	}

	resolvedBotWorkspaceID, err := s.requireWorkspaceID(firstNonEmpty(strings.TrimSpace(input.BotWorkspaceID), resolvedWorkspaceID))
	if err != nil {
		return ThreadBotBindingView{}, err
	}
	resolvedBotID := strings.TrimSpace(input.BotID)
	if resolvedBotID == "" {
		return ThreadBotBindingView{}, store.ErrBotNotFound
	}
	bot, ok := s.store.GetBot(resolvedBotWorkspaceID, resolvedBotID)
	if !ok {
		return ThreadBotBindingView{}, store.ErrBotNotFound
	}
	if !s.botAccessibleToWorkspace(bot, resolvedWorkspaceID) {
		return ThreadBotBindingView{}, store.ErrBotNotFound
	}

	resolvedTargetID := strings.TrimSpace(input.DeliveryTargetID)
	target, ok := s.store.GetBotDeliveryTarget(resolvedBotWorkspaceID, resolvedTargetID)
	if !ok || strings.TrimSpace(target.BotID) != resolvedBotID {
		return ThreadBotBindingView{}, store.ErrBotDeliveryTargetNotFound
	}
	if !strings.EqualFold(strings.TrimSpace(target.Status), "active") {
		return ThreadBotBindingView{}, fmt.Errorf("%w: delivery target must be active before binding a thread", ErrInvalidInput)
	}

	connection, err := s.requireBotConnectionContext(resolvedBotWorkspaceID, resolvedBotID, target.ConnectionID)
	if err != nil {
		return ThreadBotBindingView{}, err
	}
	if normalizeAIBackendName(connection.AIBackend) != defaultAIBackend {
		return ThreadBotBindingView{}, fmt.Errorf(
			"%w: thread bot binding currently requires a workspace_thread endpoint",
			ErrInvalidInput,
		)
	}

	if err := s.bindDeliveryTargetConversationToThread(ctx, resolvedWorkspaceID, resolvedThreadID, connection, target); err != nil {
		return ThreadBotBindingView{}, err
	}

	binding, err := s.store.UpsertThreadBotBinding(store.ThreadBotBinding{
		WorkspaceID:      resolvedWorkspaceID,
		ThreadID:         resolvedThreadID,
		BotWorkspaceID:   resolvedBotWorkspaceID,
		BotID:            resolvedBotID,
		DeliveryTargetID: resolvedTargetID,
	})
	if err != nil {
		return ThreadBotBindingView{}, err
	}

	s.publish(resolvedWorkspaceID, resolvedThreadID, "bot/thread_binding/updated", map[string]any{
		"botWorkspaceId":   binding.BotWorkspaceID,
		"bindingId":        binding.ID,
		"threadId":         binding.ThreadID,
		"botId":            binding.BotID,
		"deliveryTargetId": binding.DeliveryTargetID,
	})

	return s.threadBotBindingViewFromStore(binding)
}

func (s *Service) DeleteThreadBotBinding(
	ctx context.Context,
	workspaceID string,
	threadID string,
) error {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return err
	}
	resolvedThreadID := strings.TrimSpace(threadID)
	binding, ok := s.store.GetThreadBotBinding(resolvedWorkspaceID, resolvedThreadID)
	if !ok {
		return store.ErrThreadBotBindingNotFound
	}
	botWorkspaceID := firstNonEmpty(strings.TrimSpace(binding.BotWorkspaceID), resolvedWorkspaceID)

	target, targetOK := s.store.GetBotDeliveryTarget(botWorkspaceID, binding.DeliveryTargetID)
	if targetOK {
		if connection, err := s.requireBotConnectionContext(botWorkspaceID, binding.BotID, target.ConnectionID); err == nil {
			if normalizeAIBackendName(connection.AIBackend) == defaultAIBackend {
				if conversation, ok := s.findConversationForDeliveryTargetBinding(connection, target); ok {
					conversation = s.ensureConversationBotIdentity(conversation, connection)
					if strings.TrimSpace(conversation.ThreadID) == resolvedThreadID {
						_, _ = s.ClearConversationBinding(ctx, botWorkspaceID, connection.ID, conversation.ID)
					}
				}
			}
		}
	}

	if err := s.store.DeleteThreadBotBinding(resolvedWorkspaceID, resolvedThreadID); err != nil {
		return err
	}
	s.clearRegisteredThreadBoundTurns(resolvedWorkspaceID, resolvedThreadID)
	s.publish(resolvedWorkspaceID, resolvedThreadID, "bot/thread_binding/deleted", map[string]any{
		"botWorkspaceId":   botWorkspaceID,
		"bindingId":        binding.ID,
		"threadId":         binding.ThreadID,
		"botId":            binding.BotID,
		"deliveryTargetId": binding.DeliveryTargetID,
	})
	return nil
}

func (s *Service) RegisterThreadBoundTurn(workspaceID string, threadID string, turnID string) error {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return err
	}
	resolvedThreadID := strings.TrimSpace(threadID)
	resolvedTurnID := strings.TrimSpace(turnID)
	if resolvedThreadID == "" || resolvedTurnID == "" {
		return store.ErrThreadBotBindingNotFound
	}

	binding, ok := s.store.GetThreadBotBinding(resolvedWorkspaceID, resolvedThreadID)
	if !ok {
		return store.ErrThreadBotBindingNotFound
	}

	s.mu.Lock()
	s.threadBoundTurns[registeredThreadBoundTurnKey(resolvedWorkspaceID, resolvedThreadID, resolvedTurnID)] = threadBoundTurnDispatch{
		bindingID:      binding.ID,
		targetID:       binding.DeliveryTargetID,
		botID:          binding.BotID,
		botWorkspaceID: firstNonEmpty(strings.TrimSpace(binding.BotWorkspaceID), resolvedWorkspaceID),
	}
	s.mu.Unlock()
	return nil
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

func (s *Service) ListDeliveryTargets(workspaceID string, botID string) ([]DeliveryTargetView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return nil, store.ErrBotNotFound
	}

	items := s.store.ListBotDeliveryTargets(resolvedWorkspaceID, botID)
	views := make([]DeliveryTargetView, 0, len(items))
	for _, item := range items {
		views = append(views, s.deliveryTargetViewFromStore(item))
	}
	return views, nil
}

func (s *Service) ListAvailableDeliveryTargets(workspaceID string, botID string) ([]DeliveryTargetView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}

	resolvedBotID := strings.TrimSpace(botID)
	if resolvedBotID != "" {
		bot, ok := s.findBotByID(resolvedBotID)
		if !ok || !s.botAccessibleToWorkspace(bot, resolvedWorkspaceID) {
			return nil, store.ErrBotNotFound
		}
		return s.ListDeliveryTargets(bot.WorkspaceID, bot.ID)
	}

	views := make([]DeliveryTargetView, 0)
	for _, workspace := range s.store.ListWorkspaces() {
		for _, bot := range s.store.ListBots(workspace.ID) {
			if !s.botAccessibleToWorkspace(bot, resolvedWorkspaceID) {
				continue
			}
			items := s.store.ListBotDeliveryTargets(bot.WorkspaceID, bot.ID)
			for _, item := range items {
				views = append(views, s.deliveryTargetViewFromStore(item))
			}
		}
	}

	sort.Slice(views, func(i int, j int) bool {
		if views[i].UpdatedAt.Equal(views[j].UpdatedAt) {
			return views[i].ID < views[j].ID
		}
		return views[i].UpdatedAt.After(views[j].UpdatedAt)
	})
	return views, nil
}

func (s *Service) ListOutboundDeliveries(workspaceID string, botID string) ([]OutboundDeliveryView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return nil, store.ErrBotNotFound
	}

	items := s.store.ListBotOutboundDeliveries(resolvedWorkspaceID, store.BotOutboundDeliveryFilter{BotID: botID})
	views := make([]OutboundDeliveryView, 0, len(items))
	for _, item := range items {
		views = append(views, outboundDeliveryViewFromStore(item))
	}
	return views, nil
}

func (s *Service) GetOutboundDelivery(workspaceID string, botID string, deliveryID string) (OutboundDeliveryView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return OutboundDeliveryView{}, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return OutboundDeliveryView{}, store.ErrBotNotFound
	}

	item, ok := s.store.GetBotOutboundDelivery(resolvedWorkspaceID, deliveryID)
	if !ok || strings.TrimSpace(item.BotID) != strings.TrimSpace(botID) {
		return OutboundDeliveryView{}, store.ErrBotOutboundDeliveryNotFound
	}
	return outboundDeliveryViewFromStore(item), nil
}

func (s *Service) UpsertDeliveryTarget(
	ctx context.Context,
	workspaceID string,
	botID string,
	input UpsertDeliveryTargetInput,
) (DeliveryTargetView, error) {
	_ = ctx
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return DeliveryTargetView{}, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return DeliveryTargetView{}, store.ErrBotNotFound
	}

	targetType := normalizeDeliveryTargetType(input.TargetType, input.SessionID)
	switch targetType {
	case "session_backed":
		connection, conversation, err := s.requireBotSessionContext(resolvedWorkspaceID, botID, input.SessionID)
		if err != nil {
			return DeliveryTargetView{}, err
		}
		if strings.TrimSpace(input.EndpointID) != "" && strings.TrimSpace(input.EndpointID) != strings.TrimSpace(connection.ID) {
			return DeliveryTargetView{}, fmt.Errorf("%w: endpointId does not match the session endpoint", ErrInvalidInput)
		}

		routeType, routeKey := deliveryRouteFromConversation(connection, conversation)
		providerState := mergeProviderState(conversation.ProviderState, input.ProviderState)
		title := firstNonEmpty(
			strings.TrimSpace(input.Title),
			strings.TrimSpace(conversation.ExternalTitle),
			strings.TrimSpace(conversation.ExternalUsername),
			strings.TrimSpace(conversation.ExternalChatID),
		)
		capabilities := mergeNormalizedStringLists(deliveryTargetCapabilitiesForConnection(connection), input.Capabilities)
		status := firstNonEmpty(strings.TrimSpace(input.Status), "active")

		if existing, ok := s.store.FindBotDeliveryTargetByConversation(resolvedWorkspaceID, conversation.ID); ok &&
			strings.TrimSpace(existing.BotID) == strings.TrimSpace(botID) {
			target, err := s.store.UpdateBotDeliveryTarget(resolvedWorkspaceID, existing.ID, func(current store.BotDeliveryTarget) store.BotDeliveryTarget {
				current.Provider = connection.Provider
				current.TargetType = targetType
				current.RouteType = routeType
				current.RouteKey = routeKey
				current.Title = title
				current.Labels = cloneStringSliceLocal(input.Labels)
				current.Capabilities = capabilities
				current.ProviderState = providerState
				current.Status = status
				return current
			})
			if err != nil {
				return DeliveryTargetView{}, err
			}
			s.publish(resolvedWorkspaceID, strings.TrimSpace(conversation.ThreadID), "bot/delivery_target/updated", map[string]any{
				"botId":            botID,
				"deliveryTargetId": target.ID,
				"sessionId":        conversation.ID,
				"status":           target.Status,
			})
			return s.deliveryTargetViewFromStore(target), nil
		}

		target, err := s.store.CreateBotDeliveryTarget(store.BotDeliveryTarget{
			WorkspaceID:    resolvedWorkspaceID,
			BotID:          botID,
			ConnectionID:   connection.ID,
			ConversationID: conversation.ID,
			Provider:       connection.Provider,
			TargetType:     targetType,
			RouteType:      routeType,
			RouteKey:       routeKey,
			Title:          title,
			Labels:         cloneStringSliceLocal(input.Labels),
			Capabilities:   capabilities,
			ProviderState:  providerState,
			Status:         status,
		})
		if err != nil {
			return DeliveryTargetView{}, err
		}
		s.publish(resolvedWorkspaceID, strings.TrimSpace(conversation.ThreadID), "bot/delivery_target/updated", map[string]any{
			"botId":            botID,
			"deliveryTargetId": target.ID,
			"sessionId":        conversation.ID,
			"status":           target.Status,
		})
		return s.deliveryTargetViewFromStore(target), nil

	case "route_backed":
		connection, err := s.requireBotConnectionContext(resolvedWorkspaceID, botID, input.EndpointID)
		if err != nil {
			return DeliveryTargetView{}, err
		}

		target := store.BotDeliveryTarget{
			WorkspaceID:  resolvedWorkspaceID,
			BotID:        botID,
			ConnectionID: connection.ID,
			Provider:     connection.Provider,
			TargetType:   targetType,
			RouteType:    strings.TrimSpace(input.RouteType),
			RouteKey:     strings.TrimSpace(input.RouteKey),
			Title:        strings.TrimSpace(input.Title),
			Labels:       cloneStringSliceLocal(input.Labels),
			Capabilities: mergeNormalizedStringLists(deliveryTargetCapabilitiesForConnection(connection), input.Capabilities),
			Status:       firstNonEmpty(strings.TrimSpace(input.Status), "active"),
		}

		target.RouteType = normalizeRouteTypeForTarget(connection, target.RouteType, target.RouteKey)
		target.ProviderState = normalizeRouteBackedTargetProviderState(connection, target.RouteType, nil, input.ProviderState)
		syntheticConversation, err := buildSyntheticConversationForTarget(connection, target)
		if err != nil {
			return DeliveryTargetView{}, err
		}
		target.RouteType, target.RouteKey = canonicalRouteForTargetType(target.RouteType, syntheticConversation)
		target.Title = firstNonEmpty(strings.TrimSpace(target.Title), strings.TrimSpace(target.RouteKey))

		if existing, ok := s.findMatchingRouteBackedTarget(resolvedWorkspaceID, target); ok {
			updated, err := s.store.UpdateBotDeliveryTarget(resolvedWorkspaceID, existing.ID, func(current store.BotDeliveryTarget) store.BotDeliveryTarget {
				current.Provider = target.Provider
				current.TargetType = target.TargetType
				current.RouteType = target.RouteType
				current.RouteKey = target.RouteKey
				current.Title = target.Title
				current.Labels = cloneStringSliceLocal(target.Labels)
				current.Capabilities = cloneStringSliceLocal(target.Capabilities)
				current.ProviderState = normalizeRouteBackedTargetProviderState(connection, target.RouteType, current.ProviderState, input.ProviderState)
				current.Status = target.Status
				return current
			})
			if err != nil {
				return DeliveryTargetView{}, err
			}
			s.publish(resolvedWorkspaceID, "", "bot/delivery_target/updated", map[string]any{
				"botId":            botID,
				"deliveryTargetId": updated.ID,
				"status":           updated.Status,
			})
			return s.deliveryTargetViewFromStore(updated), nil
		}

		created, err := s.store.CreateBotDeliveryTarget(target)
		if err != nil {
			return DeliveryTargetView{}, err
		}
		s.publish(resolvedWorkspaceID, "", "bot/delivery_target/updated", map[string]any{
			"botId":            botID,
			"deliveryTargetId": created.ID,
			"status":           created.Status,
		})
		return s.deliveryTargetViewFromStore(created), nil

	default:
		return DeliveryTargetView{}, fmt.Errorf("%w: unsupported delivery target type %q", ErrInvalidInput, input.TargetType)
	}
}

func (s *Service) UpdateDeliveryTarget(
	ctx context.Context,
	workspaceID string,
	botID string,
	targetID string,
	input UpsertDeliveryTargetInput,
) (DeliveryTargetView, error) {
	_ = ctx
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return DeliveryTargetView{}, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return DeliveryTargetView{}, store.ErrBotNotFound
	}

	target, ok := s.store.GetBotDeliveryTarget(resolvedWorkspaceID, targetID)
	if !ok || strings.TrimSpace(target.BotID) != strings.TrimSpace(botID) {
		return DeliveryTargetView{}, store.ErrBotDeliveryTargetNotFound
	}
	if strings.TrimSpace(target.TargetType) != "route_backed" {
		return DeliveryTargetView{}, fmt.Errorf("%w: only route-backed delivery targets can be updated explicitly", ErrInvalidInput)
	}

	connection, err := s.requireBotConnectionContext(resolvedWorkspaceID, botID, target.ConnectionID)
	if err != nil {
		return DeliveryTargetView{}, err
	}
	if strings.TrimSpace(input.EndpointID) != "" && strings.TrimSpace(input.EndpointID) != strings.TrimSpace(target.ConnectionID) {
		return DeliveryTargetView{}, fmt.Errorf("%w: endpointId does not match the delivery target endpoint", ErrInvalidInput)
	}
	if normalizedTargetType := normalizeDeliveryTargetType(input.TargetType, input.SessionID); normalizedTargetType != "" &&
		normalizedTargetType != "route_backed" {
		return DeliveryTargetView{}, fmt.Errorf("%w: route-backed delivery targets cannot change targetType", ErrInvalidInput)
	}

	labels := cloneStringSliceLocal(target.Labels)
	if input.Labels != nil {
		labels = cloneStringSliceLocal(input.Labels)
	}

	capabilities := cloneStringSliceLocal(target.Capabilities)
	if input.Capabilities != nil {
		capabilities = mergeNormalizedStringLists(deliveryTargetCapabilitiesForConnection(connection), input.Capabilities)
	}

	nextTarget := cloneBotDeliveryTargetStoreValue(target)
	nextTarget.Provider = connection.Provider
	nextTarget.RouteType = firstNonEmpty(strings.TrimSpace(input.RouteType), strings.TrimSpace(target.RouteType))
	nextTarget.RouteKey = firstNonEmpty(strings.TrimSpace(input.RouteKey), strings.TrimSpace(target.RouteKey))
	nextTarget.Title = firstNonEmpty(strings.TrimSpace(input.Title), strings.TrimSpace(target.Title))
	nextTarget.Labels = labels
	nextTarget.Capabilities = capabilities
	nextTarget.ProviderState = cloneStringMapLocal(target.ProviderState)
	nextTarget.Status = firstNonEmpty(strings.TrimSpace(input.Status), strings.TrimSpace(target.Status), "active")

	nextTarget.RouteType = normalizeRouteTypeForTarget(connection, nextTarget.RouteType, nextTarget.RouteKey)
	if input.ProviderState != nil {
		nextTarget.ProviderState = normalizeRouteBackedTargetProviderState(connection, nextTarget.RouteType, target.ProviderState, input.ProviderState)
	}
	syntheticConversation, err := buildSyntheticConversationForTarget(connection, nextTarget)
	if err != nil {
		return DeliveryTargetView{}, err
	}
	nextTarget.RouteType, nextTarget.RouteKey = canonicalRouteForTargetType(nextTarget.RouteType, syntheticConversation)
	nextTarget.Title = firstNonEmpty(strings.TrimSpace(nextTarget.Title), strings.TrimSpace(nextTarget.RouteKey))

	if existing, ok := s.findMatchingRouteBackedTarget(resolvedWorkspaceID, nextTarget); ok &&
		strings.TrimSpace(existing.ID) != strings.TrimSpace(target.ID) {
		return DeliveryTargetView{}, fmt.Errorf("%w: another route-backed delivery target already uses %q", ErrInvalidInput, nextTarget.RouteKey)
	}

	updated, err := s.store.UpdateBotDeliveryTarget(resolvedWorkspaceID, target.ID, func(current store.BotDeliveryTarget) store.BotDeliveryTarget {
		current.Provider = nextTarget.Provider
		current.TargetType = nextTarget.TargetType
		current.RouteType = nextTarget.RouteType
		current.RouteKey = nextTarget.RouteKey
		current.Title = nextTarget.Title
		current.Labels = cloneStringSliceLocal(nextTarget.Labels)
		current.Capabilities = cloneStringSliceLocal(nextTarget.Capabilities)
		current.ProviderState = mergeProviderState(nil, nextTarget.ProviderState)
		current.Status = nextTarget.Status
		return current
	})
	if err != nil {
		return DeliveryTargetView{}, err
	}

	s.publish(resolvedWorkspaceID, "", "bot/delivery_target/updated", map[string]any{
		"botId":            botID,
		"deliveryTargetId": updated.ID,
		"status":           updated.Status,
	})
	return s.deliveryTargetViewFromStore(updated), nil
}

func (s *Service) DeleteDeliveryTarget(ctx context.Context, workspaceID string, botID string, targetID string) error {
	_ = ctx
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return store.ErrBotNotFound
	}

	target, ok := s.store.GetBotDeliveryTarget(resolvedWorkspaceID, targetID)
	if !ok || strings.TrimSpace(target.BotID) != strings.TrimSpace(botID) {
		return store.ErrBotDeliveryTargetNotFound
	}
	if strings.TrimSpace(target.TargetType) != "route_backed" {
		return fmt.Errorf("%w: only route-backed delivery targets can be deleted explicitly", ErrInvalidInput)
	}

	if err := s.store.DeleteBotDeliveryTarget(resolvedWorkspaceID, target.ID); err != nil {
		return err
	}
	s.publish(resolvedWorkspaceID, "", "bot/delivery_target/deleted", map[string]any{
		"botId":            botID,
		"deliveryTargetId": target.ID,
	})
	return nil
}

func (s *Service) SendSessionOutboundMessages(
	ctx context.Context,
	workspaceID string,
	botID string,
	sessionID string,
	input SendOutboundMessagesInput,
) (OutboundDeliveryView, error) {
	target, err := s.UpsertDeliveryTarget(ctx, workspaceID, botID, UpsertDeliveryTargetInput{
		SessionID:  sessionID,
		TargetType: "session_backed",
	})
	if err != nil {
		return OutboundDeliveryView{}, err
	}
	return s.SendDeliveryTargetOutboundMessages(ctx, workspaceID, botID, target.ID, input)
}

func (s *Service) ensureSessionBackedTargetForConversation(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (store.BotDeliveryTarget, error) {
	targetView, err := s.UpsertDeliveryTarget(ctx, connection.WorkspaceID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID:    connection.ID,
		SessionID:     conversation.ID,
		TargetType:    "session_backed",
		ProviderState: mergeProviderState(nil, conversation.ProviderState),
	})
	if err != nil {
		return store.BotDeliveryTarget{}, err
	}

	target, ok := s.store.GetBotDeliveryTarget(connection.WorkspaceID, targetView.ID)
	if !ok || strings.TrimSpace(target.ConnectionID) != strings.TrimSpace(connection.ID) {
		return store.BotDeliveryTarget{}, store.ErrBotDeliveryTargetNotFound
	}
	return target, nil
}

func replyOutboundDeliveryThreadID(outbound replyOutboundDeliveryContext) string {
	if outbound.storedConversation != nil && strings.TrimSpace(outbound.storedConversation.ThreadID) != "" {
		return strings.TrimSpace(outbound.storedConversation.ThreadID)
	}
	return strings.TrimSpace(outbound.sendConversation.ThreadID)
}

func (s *Service) prepareReplyOutboundDelivery(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	sourceDelivery *store.BotInboundDelivery,
	reply AIResult,
) (replyOutboundDeliveryContext, error) {
	target, err := s.ensureSessionBackedTargetForConversation(ctx, connection, conversation)
	if err != nil {
		return replyOutboundDeliveryContext{}, err
	}

	sendConversation, storedConversation, err := s.resolveConversationForDeliveryTarget(connection.WorkspaceID, connection, target)
	if err != nil {
		return replyOutboundDeliveryContext{}, err
	}

	sourceRefType := ""
	sourceRefID := ""
	if sourceDelivery != nil {
		sourceRefType = "inbound_delivery"
		sourceRefID = strings.TrimSpace(sourceDelivery.ID)
	}

	outboundDelivery, err := s.store.CreateBotOutboundDelivery(store.BotOutboundDelivery{
		WorkspaceID:      connection.WorkspaceID,
		BotID:            connection.BotID,
		ConnectionID:     connection.ID,
		ConversationID:   strings.TrimSpace(target.ConversationID),
		DeliveryTargetID: target.ID,
		SourceType:       "reply",
		SourceRefType:    sourceRefType,
		SourceRefID:      sourceRefID,
		Messages:         outboundReplyMessages(reply.Messages),
		Status:           "queued",
	})
	if err != nil {
		return replyOutboundDeliveryContext{}, err
	}

	outbound := replyOutboundDeliveryContext{
		target:             target,
		sendConversation:   sendConversation,
		storedConversation: storedConversation,
		outboundDelivery:   outboundDelivery,
	}
	s.publish(connection.WorkspaceID, replyOutboundDeliveryThreadID(outbound), "bot/outbound_delivery/created", map[string]any{
		"botId":            outboundDelivery.BotID,
		"connectionId":     connection.ID,
		"deliveryTargetId": target.ID,
		"deliveryId":       outboundDelivery.ID,
		"status":           outboundDelivery.Status,
	})
	return outbound, nil
}

func wrapReplyOutboundDeliveryError(
	err error,
	reply AIResult,
	provider Provider,
	phase string,
	attemptOffset int,
) error {
	if err == nil {
		return nil
	}

	effectiveAttemptCount := attemptOffset + 1
	var deliveryErr *replyDeliveryError
	if errors.As(err, &deliveryErr) {
		effectiveAttemptCount = attemptOffset + maxInt(deliveryErr.attemptCount, 1)
		return &replyDeliveryError{
			reply:        reply,
			providerName: firstNonEmpty(strings.TrimSpace(deliveryErr.providerName), providerName(provider)),
			phase:        firstNonEmpty(strings.TrimSpace(deliveryErr.phase), strings.TrimSpace(phase)),
			attemptCount: effectiveAttemptCount,
			cause:        firstNonEmptyError(deliveryErr.cause, err),
		}
	}

	return &replyDeliveryError{
		reply:        reply,
		providerName: providerName(provider),
		phase:        strings.TrimSpace(phase),
		attemptCount: effectiveAttemptCount,
		cause:        err,
	}
}

func firstNonEmptyError(primary error, fallback error) error {
	if primary != nil {
		return primary
	}
	return fallback
}

func providerName(provider Provider) string {
	if provider == nil {
		return ""
	}
	return provider.Name()
}

func (s *Service) sendReplyWithOutboundDelivery(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	conversation store.BotConversation,
	progressDelivery *store.BotInboundDelivery,
	sourceDelivery *store.BotInboundDelivery,
	inbound *InboundMessage,
	reply AIResult,
	phase string,
) (int, error) {
	if sourceDelivery == nil {
		sourceDelivery = progressDelivery
	}
	if s == nil ||
		s.store == nil ||
		sourceDelivery == nil ||
		strings.TrimSpace(connection.WorkspaceID) == "" ||
		strings.TrimSpace(connection.BotID) == "" ||
		strings.TrimSpace(conversation.ID) == "" {
		return s.sendReplyWithRetry(ctx, provider, connection, conversation, progressDelivery, inbound, reply, phase)
	}

	attemptOffset := maxInt(sourceDelivery.ReplyDeliveryAttemptCount, 0)

	outbound, err := s.prepareReplyOutboundDelivery(ctx, connection, conversation, sourceDelivery, reply)
	if err != nil {
		return attemptOffset + 1, wrapReplyOutboundDeliveryError(err, reply, provider, phase, attemptOffset)
	}

	var retryHooks *outboundDeliveryRetryHooks
	if progressDelivery != nil && inbound != nil {
		retryHooks = &outboundDeliveryRetryHooks{
			onAttemptStart: func(attempt int) {
				s.recordReplyDeliveryProgress(
					connection,
					conversation,
					progressDelivery,
					inbound,
					reply,
					botReplyDeliveryStatusSending,
					attemptOffset+attempt,
					"",
				)
			},
			onRetry: func(nextAttempt int, lastError string, delay time.Duration) {
				s.recordReplyDeliveryProgress(
					connection,
					conversation,
					progressDelivery,
					inbound,
					reply,
					botReplyDeliveryStatusRetrying,
					attemptOffset+nextAttempt,
					lastError,
				)
				delayLabel := delay.Round(time.Millisecond).String()
				if delay <= 0 {
					delayLabel = "immediately"
				}
				s.appendConnectionLog(
					connection.WorkspaceID,
					connection.ID,
					"warning",
					"reply_delivery_retry",
					fmt.Sprintf(
						"Reply delivery attempt %d failed during %s and will retry %s: %s",
						attemptOffset+nextAttempt-1,
						firstNonEmpty(strings.TrimSpace(phase), "provider send"),
						delayLabel,
						strings.TrimSpace(lastError),
					),
				)
			},
		}
	}

	outboundDelivery, _, err := s.sendOutboundDeliveryWithRetryHooks(
		ctx,
		provider,
		connection,
		outbound.sendConversation,
		outbound.storedConversation,
		outbound.target,
		outbound.outboundDelivery,
		reply.Messages,
		retryHooks,
	)
	if err != nil {
		return attemptOffset + maxInt(outboundDelivery.AttemptCount, 1), wrapReplyOutboundDeliveryError(err, reply, provider, phase, attemptOffset)
	}

	return attemptOffset + maxInt(outboundDelivery.AttemptCount, 1), nil
}

func (s *Service) updateReplyOutboundDeliveryRecord(
	connection store.BotConnection,
	outbound replyOutboundDeliveryContext,
	status string,
	attemptCount int,
	lastError string,
	deliveredAt *time.Time,
	reply AIResult,
) replyOutboundDeliveryContext {
	updatedDelivery, err := s.store.UpdateBotOutboundDelivery(connection.WorkspaceID, outbound.outboundDelivery.ID, func(current store.BotOutboundDelivery) store.BotOutboundDelivery {
		current.Status = strings.TrimSpace(status)
		current.AttemptCount = attemptCount
		current.LastError = strings.TrimSpace(lastError)
		current.DeliveredAt = cloneOptionalTimeLocal(deliveredAt)
		current.Messages = outboundReplyMessages(reply.Messages)
		return current
	})
	if err == nil {
		outbound.outboundDelivery = updatedDelivery
	}

	payload := map[string]any{
		"botId":            outbound.outboundDelivery.BotID,
		"connectionId":     connection.ID,
		"deliveryTargetId": outbound.target.ID,
		"deliveryId":       outbound.outboundDelivery.ID,
		"status":           strings.TrimSpace(status),
		"attemptCount":     attemptCount,
	}
	if trimmedError := strings.TrimSpace(lastError); trimmedError != "" {
		payload["lastError"] = trimmedError
	}
	if deliveredAt != nil {
		payload["deliveredAt"] = deliveredAt.UTC()
	}
	s.publish(connection.WorkspaceID, replyOutboundDeliveryThreadID(outbound), "bot/outbound_delivery/updated", payload)
	return outbound
}

func (s *Service) SendDeliveryTargetOutboundMessages(
	ctx context.Context,
	workspaceID string,
	botID string,
	targetID string,
	input SendOutboundMessagesInput,
) (OutboundDeliveryView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return OutboundDeliveryView{}, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return OutboundDeliveryView{}, store.ErrBotNotFound
	}

	target, ok := s.store.GetBotDeliveryTarget(resolvedWorkspaceID, targetID)
	if !ok || strings.TrimSpace(target.BotID) != strings.TrimSpace(botID) {
		return OutboundDeliveryView{}, store.ErrBotDeliveryTargetNotFound
	}
	if !strings.EqualFold(strings.TrimSpace(target.Status), "active") {
		return OutboundDeliveryView{}, fmt.Errorf("%w: delivery target must be active before sending outbound messages", ErrInvalidInput)
	}

	connection, err := s.requireBotConnectionContext(resolvedWorkspaceID, botID, target.ConnectionID)
	if err != nil {
		return OutboundDeliveryView{}, err
	}
	if !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
		return OutboundDeliveryView{}, fmt.Errorf("%w: bot connection must be active before sending outbound messages", ErrInvalidInput)
	}

	provider, ok := s.providers[normalizeProviderName(connection.Provider)]
	if !ok {
		return OutboundDeliveryView{}, ErrProviderNotSupported
	}

	replyMessages, outboundMessages, err := normalizeOutboundReplyMessagesInput(input.Messages)
	if err != nil {
		return OutboundDeliveryView{}, err
	}
	if err := validateOutboundMessagesForProvider(provider, outboundMessages); err != nil {
		return OutboundDeliveryView{}, err
	}
	sourceType := firstNonEmpty(strings.TrimSpace(input.SourceType), "manual")

	sendConversation, storedConversation, err := s.resolveConversationForDeliveryTarget(resolvedWorkspaceID, connection, target)
	if err != nil {
		return OutboundDeliveryView{}, err
	}

	if existing, ok := s.findExistingOutboundDeliveryByIdempotency(
		resolvedWorkspaceID,
		botID,
		connection.ID,
		target.ID,
		sourceType,
		strings.TrimSpace(input.IdempotencyKey),
	); ok {
		return outboundDeliveryViewFromStore(existing), nil
	}

	delivery, err := s.store.CreateBotOutboundDelivery(store.BotOutboundDelivery{
		WorkspaceID:       resolvedWorkspaceID,
		BotID:             botID,
		ConnectionID:      connection.ID,
		ConversationID:    strings.TrimSpace(target.ConversationID),
		DeliveryTargetID:  target.ID,
		TriggerID:         strings.TrimSpace(input.TriggerID),
		SourceType:        sourceType,
		SourceRefType:     strings.TrimSpace(input.SourceRefType),
		SourceRefID:       strings.TrimSpace(input.SourceRefID),
		OriginWorkspaceID: strings.TrimSpace(input.OriginWorkspaceID),
		OriginThreadID:    strings.TrimSpace(input.OriginThreadID),
		OriginTurnID:      strings.TrimSpace(input.OriginTurnID),
		IdempotencyKey:    strings.TrimSpace(input.IdempotencyKey),
		Messages:          replyMessages,
		Status:            "queued",
	})
	if err != nil {
		return OutboundDeliveryView{}, err
	}

	s.publish(resolvedWorkspaceID, strings.TrimSpace(sendConversation.ThreadID), "bot/outbound_delivery/created", map[string]any{
		"botId":            botID,
		"connectionId":     connection.ID,
		"deliveryTargetId": target.ID,
		"deliveryId":       delivery.ID,
		"status":           delivery.Status,
	})

	delivery, storedConversation, err = s.sendOutboundDeliveryWithRetry(
		ctx,
		provider,
		connection,
		sendConversation,
		storedConversation,
		target,
		delivery,
		outboundMessages,
	)
	if err != nil {
		return OutboundDeliveryView{}, err
	}

	_ = storedConversation
	return outboundDeliveryViewFromStore(delivery), nil
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
	targetWorkspaceID, err := s.requireWorkspaceID(firstNonEmpty(strings.TrimSpace(input.TargetWorkspaceID), resolvedWorkspaceID))
	if err != nil {
		return BotBindingView{}, err
	}
	switch mode {
	case "fixed_thread":
		targetThreadID := strings.TrimSpace(input.TargetThreadID)
		if targetThreadID == "" {
			return BotBindingView{}, fmt.Errorf("%w: targetThreadId is required for fixed_thread bindings", ErrInvalidInput)
		}
		if s.threads == nil {
			return BotBindingView{}, fmt.Errorf("%w: workspace thread service is not configured", ErrInvalidInput)
		}
		if _, err := s.threads.GetDetail(ctx, targetWorkspaceID, targetThreadID); err != nil {
			return BotBindingView{}, err
		}
	case "workspace_auto_thread", "stateless":
	default:
		return BotBindingView{}, fmt.Errorf("%w: unsupported binding mode %q", ErrInvalidInput, input.BindingMode)
	}

	updatedBinding, err := s.store.UpdateBotBinding(resolvedWorkspaceID, currentBinding.ID, func(binding store.BotBinding) store.BotBinding {
		binding.Name = firstNonEmpty(strings.TrimSpace(input.Name), binding.Name, "Default Binding")
		binding.BindingMode = mode
		binding.TargetWorkspaceID = targetWorkspaceID
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

func (s *Service) ListConnectionLogsByID(connectionID string) ([]store.BotConnectionLogEntry, error) {
	connection, ok := s.store.FindBotConnection(connectionID)
	if !ok {
		return nil, store.ErrBotConnectionNotFound
	}
	return s.ListConnectionLogs(connection.WorkspaceID, connection.ID)
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

func (s *Service) ListConnectionRecipientCandidates(workspaceID string, connectionID string) ([]RecipientCandidateView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}

	connection, ok := s.store.GetBotConnection(resolvedWorkspaceID, connectionID)
	if !ok {
		return nil, store.ErrBotConnectionNotFound
	}
	connection, bot, _, err := s.ensureConnectionBotResources(connection)
	if err != nil {
		return nil, err
	}

	candidatesBySignature := make(map[string]RecipientCandidateView)
	storeCandidate := func(candidate RecipientCandidateView) {
		if strings.TrimSpace(candidate.ChatID) == "" {
			return
		}
		signature := recipientCandidateSignature(candidate)
		if current, exists := candidatesBySignature[signature]; !exists || shouldReplaceRecipientCandidate(current, candidate) {
			candidatesBySignature[signature] = candidate
		}
	}

	for _, conversation := range s.store.ListBotConversations(resolvedWorkspaceID, connection.ID) {
		storeCandidate(recipientCandidateFromConversation(resolvedWorkspaceID, connection, s.ensureConversationBotIdentity(conversation, connection)))
	}

	for _, target := range s.store.ListBotDeliveryTargets(resolvedWorkspaceID, bot.ID) {
		candidate, ok := s.recipientCandidateFromDeliveryTarget(resolvedWorkspaceID, connection, target)
		if !ok {
			continue
		}
		storeCandidate(candidate)
	}

	views := make([]RecipientCandidateView, 0, len(candidatesBySignature))
	for _, candidate := range candidatesBySignature {
		views = append(views, candidate)
	}
	sort.Slice(views, func(i int, j int) bool {
		return recipientCandidateLess(views[i], views[j])
	})

	return views, nil
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
	targetWorkspaceID, err := s.requireWorkspaceID(firstNonEmpty(strings.TrimSpace(input.TargetWorkspaceID), resolvedWorkspaceID))
	if err != nil {
		return ConversationView{}, err
	}

	var updatedConversation store.BotConversation
	switch {
	case input.CreateThread:
		updatedConversation, _, err = s.startNewConversationThread(
			ctx,
			connection,
			conversation,
			inboundMessageFromConversation(conversation),
			input.Title,
			targetWorkspaceID,
		)
	default:
		updatedConversation, _, err = s.switchConversationThread(ctx, connection, conversation, input.ThreadID, targetWorkspaceID)
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
		TargetWorkspaceID: targetWorkspaceID,
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

func (s *Service) normalizeBotAccessPolicy(
	ownerWorkspaceID string,
	scopeInput string,
	sharingModeInput string,
	sharedWorkspaceIDsInput []string,
) (string, string, []string, error) {
	scope := normalizeBotScopeValue(scopeInput)
	if scope == "" {
		return "", "", nil, fmt.Errorf("%w: unsupported bot scope %q", ErrInvalidInput, strings.TrimSpace(scopeInput))
	}

	sharingMode := normalizeBotSharingModeValue(sharingModeInput)
	if strings.TrimSpace(sharingModeInput) != "" && sharingMode == "" {
		return "", "", nil, fmt.Errorf("%w: unsupported bot sharing mode %q", ErrInvalidInput, strings.TrimSpace(sharingModeInput))
	}

	switch scope {
	case botScopeWorkspace:
		return botScopeWorkspace, botSharingModeOwnerOnly, nil, nil
	case botScopeGlobal:
		if sharingMode == "" {
			sharingMode = botSharingModeAllWorkspaces
		}
	default:
		return "", "", nil, fmt.Errorf("%w: unsupported bot scope %q", ErrInvalidInput, strings.TrimSpace(scopeInput))
	}

	sharedWorkspaceIDs := normalizeWorkspaceIDList(sharedWorkspaceIDsInput)
	filteredSharedWorkspaceIDs := make([]string, 0, len(sharedWorkspaceIDs))
	for _, workspaceID := range sharedWorkspaceIDs {
		if workspaceID == ownerWorkspaceID {
			continue
		}
		if _, ok := s.store.GetWorkspace(workspaceID); !ok {
			return "", "", nil, fmt.Errorf("%w: sharedWorkspaceId %q was not found", ErrInvalidInput, workspaceID)
		}
		filteredSharedWorkspaceIDs = append(filteredSharedWorkspaceIDs, workspaceID)
	}

	if sharingMode != botSharingModeSelected {
		filteredSharedWorkspaceIDs = nil
	}
	if sharingMode == botSharingModeSelected && len(filteredSharedWorkspaceIDs) == 0 {
		return "", "", nil, fmt.Errorf("%w: sharedWorkspaceIds is required when sharingMode is %q", ErrInvalidInput, botSharingModeSelected)
	}

	return scope, sharingMode, filteredSharedWorkspaceIDs, nil
}

func normalizeBotScopeValue(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", botScopeWorkspace:
		return botScopeWorkspace
	case botScopeGlobal:
		return botScopeGlobal
	default:
		return ""
	}
}

func normalizeBotSharingModeValue(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", botSharingModeOwnerOnly:
		return strings.ToLower(strings.TrimSpace(value))
	case botSharingModeAllWorkspaces:
		return botSharingModeAllWorkspaces
	case botSharingModeSelected:
		return botSharingModeSelected
	default:
		return ""
	}
}

func normalizeWorkspaceIDList(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func (s *Service) botAccessibleToWorkspace(bot store.Bot, workspaceID string) bool {
	resolvedWorkspaceID := strings.TrimSpace(workspaceID)
	if resolvedWorkspaceID == "" {
		return false
	}
	if strings.TrimSpace(bot.WorkspaceID) == resolvedWorkspaceID {
		return true
	}

	scope := normalizeBotScopeValue(bot.Scope)
	if scope != botScopeGlobal {
		return false
	}

	switch normalizeResolvedBotSharingMode(bot) {
	case botSharingModeAllWorkspaces:
		return true
	case botSharingModeSelected:
		return containsNormalizedWorkspaceID(bot.SharedWorkspaceIDs, resolvedWorkspaceID)
	default:
		return false
	}
}

func normalizeResolvedBotSharingMode(bot store.Bot) string {
	scope := normalizeBotScopeValue(bot.Scope)
	switch scope {
	case botScopeGlobal:
		switch normalizeBotSharingModeValue(bot.SharingMode) {
		case botSharingModeAllWorkspaces:
			return botSharingModeAllWorkspaces
		case botSharingModeSelected:
			return botSharingModeSelected
		case botSharingModeOwnerOnly:
			return botSharingModeOwnerOnly
		default:
			return botSharingModeAllWorkspaces
		}
	default:
		return botSharingModeOwnerOnly
	}
}

func containsNormalizedWorkspaceID(values []string, target string) bool {
	trimmedTarget := strings.TrimSpace(target)
	if trimmedTarget == "" {
		return false
	}
	for _, value := range values {
		if strings.TrimSpace(value) == trimmedTarget {
			return true
		}
	}
	return false
}

func (s *Service) findBotByID(botID string) (store.Bot, bool) {
	resolvedBotID := strings.TrimSpace(botID)
	if resolvedBotID == "" {
		return store.Bot{}, false
	}
	for _, workspace := range s.store.ListWorkspaces() {
		if bot, ok := s.store.GetBot(workspace.ID, resolvedBotID); ok {
			return bot, true
		}
	}
	return store.Bot{}, false
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
			Name:              defaultBotBindingName(bot.Name),
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
			if strings.TrimSpace(current.Name) == "" {
				current.Name = firstNonEmpty(strings.TrimSpace(bot.Name), strings.TrimSpace(connection.Name), "Bot")
			}
			if strings.TrimSpace(current.Status) == "" {
				current.Status = firstNonEmpty(strings.TrimSpace(current.Status), strings.TrimSpace(connection.Status), "active")
			}
			return current
		})
		if err != nil {
			return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
		}
		return connection, bot, defaultBinding, nil
	}

	botNeedsUpdate := strings.TrimSpace(bot.Name) == "" || strings.TrimSpace(bot.Status) == ""
	if botNeedsUpdate {
		var err error
		bot, err = s.store.UpdateBot(connection.WorkspaceID, bot.ID, func(current store.Bot) store.Bot {
			if strings.TrimSpace(current.Name) == "" {
				current.Name = firstNonEmpty(strings.TrimSpace(current.Name), strings.TrimSpace(connection.Name), "Bot")
			}
			if strings.TrimSpace(current.Status) == "" {
				current.Status = firstNonEmpty(strings.TrimSpace(current.Status), strings.TrimSpace(connection.Status), "active")
			}
			return current
		})
		if err != nil {
			return store.BotConnection{}, store.Bot{}, store.BotBinding{}, err
		}
	}

	expectedMode := normalizeBotBindingMode(defaultBinding.BindingMode, connection.AIBackend)
	if strings.TrimSpace(defaultBinding.Name) == "" ||
		strings.TrimSpace(defaultBinding.BindingMode) != expectedMode ||
		strings.TrimSpace(defaultBinding.AIBackend) != normalizeAIBackendName(connection.AIBackend) ||
		!reflect.DeepEqual(defaultBinding.AIConfig, cloneStringMapLocal(connection.AIConfig)) ||
		strings.TrimSpace(defaultBinding.TargetWorkspaceID) == "" ||
		(expectedMode != "fixed_thread" && strings.TrimSpace(defaultBinding.TargetThreadID) != "") {
		var err error
		defaultBinding, err = s.store.UpdateBotBinding(connection.WorkspaceID, defaultBinding.ID, func(current store.BotBinding) store.BotBinding {
			if strings.TrimSpace(current.Name) == "" {
				current.Name = defaultBotBindingName(bot.Name)
			}
			current.BindingMode = expectedMode
			if strings.TrimSpace(current.TargetWorkspaceID) == "" {
				current.TargetWorkspaceID = connection.WorkspaceID
			}
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

func normalizeDeliveryTargetType(value string, sessionID string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "session_backed", "route_backed":
		return normalized
	case "":
		if strings.TrimSpace(sessionID) != "" {
			return "session_backed"
		}
		return "route_backed"
	default:
		return normalized
	}
}

func normalizeRouteTypeForTarget(connection store.BotConnection, routeType string, routeKey string) string {
	normalized := strings.ToLower(strings.TrimSpace(routeType))
	if normalized != "" {
		return normalized
	}

	if strings.Contains(strings.TrimSpace(routeKey), ":thread:") {
		switch normalizeProviderName(connection.Provider) {
		case telegramProviderName:
			return "telegram_topic"
		case "feishu":
			return "feishu_thread"
		default:
			return "thread"
		}
	}

	switch normalizeProviderName(connection.Provider) {
	case telegramProviderName:
		return "telegram_chat"
	case wechatProviderName:
		return "wechat_session"
	case "feishu":
		return "feishu_chat"
	case "qqbot":
		normalizedRouteKey := strings.ToLower(strings.TrimSpace(routeKey))
		if strings.HasPrefix(normalizedRouteKey, "user:") {
			return "qqbot_c2c"
		}
		return "qqbot_group"
	default:
		return "conversation"
	}
}

func deliveryTargetCapabilitiesForConnection(connection store.BotConnection) []string {
	switch normalizeProviderName(connection.Provider) {
	case telegramProviderName:
		return []string{"supportsProactivePush", "supportsSessionlessPush"}
	case wechatProviderName:
		return []string{"supportsProactivePush", "requiresRouteState"}
	case "feishu", "qqbot":
		return []string{"supportsProactivePush", "supportsSessionlessPush"}
	default:
		return []string{"supportsProactivePush"}
	}
}

func connectionCapabilitiesForConnection(connection store.BotConnection) []string {
	switch normalizeProviderName(connection.Provider) {
	case telegramProviderName:
		return []string{
			"supportsTextOutbound",
			"supportsMediaOutbound",
			"supportsMediaGroup",
			"supportsImageOutbound",
			"supportsVideoOutbound",
			"supportsVoiceOutbound",
			"supportsFileOutbound",
			"supportsRemoteMediaURLSource",
			"supportsLocalMediaPathSource",
			"supportsProactivePush",
			"supportsSessionlessPush",
		}
	case wechatProviderName:
		return []string{
			"supportsTextOutbound",
			"supportsMediaOutbound",
			"supportsImageOutbound",
			"supportsVideoOutbound",
			"supportsFileOutbound",
			"supportsRemoteMediaURLSource",
			"supportsLocalMediaPathSource",
			"supportsProactivePush",
			"requiresRouteState",
		}
	case feishuProviderName:
		return []string{
			"supportsTextOutbound",
			"supportsProactivePush",
			"supportsSessionlessPush",
		}
	case qqbotProviderName:
		return []string{
			"supportsTextOutbound",
			"supportsMediaOutbound",
			"supportsImageOutbound",
			"supportsVideoOutbound",
			"supportsVoiceOutbound",
			"supportsFileOutbound",
			"supportsRemoteMediaURLSource",
			"supportsLocalMediaPathSource",
			"supportsProactivePush",
			"supportsSessionlessPush",
		}
	default:
		return []string{
			"supportsTextOutbound",
			"supportsProactivePush",
		}
	}
}

func mergeNormalizedStringLists(primary []string, secondary []string) []string {
	if len(primary) == 0 && len(secondary) == 0 {
		return nil
	}

	seen := make(map[string]struct{})
	merged := make([]string, 0, len(primary)+len(secondary))
	for _, source := range [][]string{primary, secondary} {
		for _, value := range source {
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				continue
			}
			if _, ok := seen[trimmed]; ok {
				continue
			}
			seen[trimmed] = struct{}{}
			merged = append(merged, trimmed)
		}
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}

func (s *Service) requireBotConnectionContext(workspaceID string, botID string, connectionID string) (store.BotConnection, error) {
	resolvedConnectionID := strings.TrimSpace(connectionID)
	if resolvedConnectionID == "" {
		return store.BotConnection{}, fmt.Errorf("%w: endpointId is required", ErrInvalidInput)
	}

	connection, ok := s.store.GetBotConnection(workspaceID, resolvedConnectionID)
	if !ok {
		return store.BotConnection{}, store.ErrBotConnectionNotFound
	}
	connection, bot, _, err := s.ensureConnectionBotResources(connection)
	if err != nil {
		return store.BotConnection{}, err
	}
	if strings.TrimSpace(bot.ID) != strings.TrimSpace(botID) {
		return store.BotConnection{}, store.ErrBotConnectionNotFound
	}
	return connection, nil
}

func (s *Service) requireBotSessionContext(workspaceID string, botID string, sessionID string) (store.BotConnection, store.BotConversation, error) {
	resolvedSessionID := strings.TrimSpace(sessionID)
	if resolvedSessionID == "" {
		return store.BotConnection{}, store.BotConversation{}, fmt.Errorf("%w: sessionId is required", ErrInvalidInput)
	}

	conversation, ok := s.store.GetBotConversation(workspaceID, resolvedSessionID)
	if !ok {
		return store.BotConnection{}, store.BotConversation{}, store.ErrBotConversationNotFound
	}
	connection, err := s.requireBotConnectionContext(workspaceID, botID, conversation.ConnectionID)
	if err != nil {
		return store.BotConnection{}, store.BotConversation{}, err
	}
	conversation = s.ensureConversationBotIdentity(conversation, connection)
	if botID != "" && strings.TrimSpace(conversation.BotID) != "" && strings.TrimSpace(conversation.BotID) != strings.TrimSpace(botID) {
		return store.BotConnection{}, store.BotConversation{}, store.ErrBotConversationNotFound
	}
	return connection, conversation, nil
}

func deliveryRouteFromConversation(connection store.BotConnection, conversation store.BotConversation) (string, string) {
	chatID := strings.TrimSpace(conversation.ExternalChatID)
	threadID := strings.TrimSpace(conversation.ExternalThreadID)
	conversationID := firstNonEmpty(strings.TrimSpace(conversation.ExternalConversationID), chatID)

	switch normalizeProviderName(connection.Provider) {
	case telegramProviderName:
		if threadID != "" {
			return "telegram_topic", "chat:" + chatID + ":thread:" + threadID
		}
		return "telegram_chat", "chat:" + chatID
	case wechatProviderName:
		return "wechat_session", "user:" + chatID
	case "feishu":
		if threadID != "" {
			return "feishu_thread", "chat:" + chatID + ":thread:" + threadID
		}
		return "feishu_chat", "chat:" + chatID
	case "qqbot":
		if strings.EqualFold(strings.TrimSpace(conversation.ProviderState["qqbot_message_type"]), "c2c") {
			userOpenID := firstNonEmpty(strings.TrimSpace(conversation.ExternalUserID), chatID)
			return "qqbot_c2c", "user:" + userOpenID
		}
		return "qqbot_group", "group:" + chatID
	default:
		if threadID != "" {
			return "thread", "conversation:" + conversationID + ":thread:" + threadID
		}
		return "conversation", conversationID
	}
}

func canonicalRouteForTargetType(routeType string, conversation store.BotConversation) (string, string) {
	normalizedRouteType := strings.ToLower(strings.TrimSpace(routeType))
	chatID := strings.TrimSpace(conversation.ExternalChatID)
	threadID := strings.TrimSpace(conversation.ExternalThreadID)
	conversationID := firstNonEmpty(strings.TrimSpace(conversation.ExternalConversationID), chatID)

	switch normalizedRouteType {
	case "telegram_chat":
		return "telegram_chat", "chat:" + chatID
	case "telegram_topic":
		return "telegram_topic", "chat:" + chatID + ":thread:" + threadID
	case "wechat_session":
		return "wechat_session", "user:" + chatID
	case "feishu_chat":
		return "feishu_chat", "chat:" + chatID
	case "feishu_thread":
		return "feishu_thread", "chat:" + chatID + ":thread:" + threadID
	case "qqbot_group":
		return "qqbot_group", "group:" + chatID
	case "qqbot_c2c":
		userOpenID := firstNonEmpty(strings.TrimSpace(conversation.ExternalUserID), chatID)
		return "qqbot_c2c", "user:" + userOpenID
	case "thread":
		return "thread", "conversation:" + conversationID + ":thread:" + threadID
	case "conversation", "session", "chat":
		return "conversation", conversationID
	default:
		return firstNonEmpty(normalizedRouteType, "conversation"), conversationID
	}
}

func (s *Service) findMatchingRouteBackedTarget(workspaceID string, target store.BotDeliveryTarget) (store.BotDeliveryTarget, bool) {
	candidates := s.store.ListBotDeliveryTargets(workspaceID, target.BotID)
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.TargetType) != "route_backed" {
			continue
		}
		if strings.TrimSpace(candidate.ConversationID) != "" {
			continue
		}
		if strings.TrimSpace(candidate.ConnectionID) != strings.TrimSpace(target.ConnectionID) {
			continue
		}
		if strings.TrimSpace(candidate.RouteType) != strings.TrimSpace(target.RouteType) {
			continue
		}
		if strings.TrimSpace(candidate.RouteKey) != strings.TrimSpace(target.RouteKey) {
			continue
		}
		return candidate, true
	}
	return store.BotDeliveryTarget{}, false
}

func buildSyntheticConversationForTarget(connection store.BotConnection, target store.BotDeliveryTarget) (store.BotConversation, error) {
	routeType := normalizeRouteTypeForTarget(connection, target.RouteType, target.RouteKey)
	routeKey := strings.TrimSpace(target.RouteKey)
	conversation := store.BotConversation{
		BotID:         strings.TrimSpace(target.BotID),
		WorkspaceID:   strings.TrimSpace(target.WorkspaceID),
		ConnectionID:  strings.TrimSpace(target.ConnectionID),
		Provider:      firstNonEmpty(strings.TrimSpace(target.Provider), strings.TrimSpace(connection.Provider)),
		ExternalTitle: strings.TrimSpace(target.Title),
		ProviderState: mergeProviderState(nil, target.ProviderState),
	}

	switch routeType {
	case "telegram_chat":
		chatID, _, err := parseTelegramDeliveryRoute(routeKey, target.ProviderState)
		if err != nil {
			return store.BotConversation{}, err
		}
		conversation.ExternalChatID = chatID
		conversation.ExternalConversationID = telegramConversationID(chatID, "")

	case "telegram_topic":
		chatID, threadID, err := parseTelegramDeliveryRoute(routeKey, target.ProviderState)
		if err != nil {
			return store.BotConversation{}, err
		}
		if strings.TrimSpace(threadID) == "" {
			return store.BotConversation{}, fmt.Errorf("%w: telegram topic targets require a thread id", ErrInvalidInput)
		}
		conversation.ExternalChatID = chatID
		conversation.ExternalThreadID = threadID
		conversation.ExternalConversationID = telegramConversationID(chatID, threadID)

	case "wechat_session":
		toUserID, err := parseWeChatDeliveryRoute(routeKey, target.ProviderState)
		if err != nil {
			return store.BotConversation{}, err
		}
		conversation.ExternalChatID = toUserID
		conversation.ExternalUserID = toUserID
		conversation.ExternalConversationID = toUserID

	case "feishu_chat":
		chatID, _, err := parseFeishuDeliveryRoute(routeKey, target.ProviderState)
		if err != nil {
			return store.BotConversation{}, err
		}
		conversation.ExternalChatID = chatID
		conversation.ExternalConversationID = firstNonEmpty(strings.TrimSpace(target.ProviderState["feishu_conversation_id"]), chatID)
		conversation.ExternalUserID = strings.TrimSpace(target.ProviderState["feishu_user_open_id"])
		conversation.ExternalTitle = firstNonEmpty(conversation.ExternalTitle, strings.TrimSpace(target.ProviderState["feishu_chat_name"]))

	case "feishu_thread":
		chatID, threadID, err := parseFeishuDeliveryRoute(routeKey, target.ProviderState)
		if err != nil {
			return store.BotConversation{}, err
		}
		if strings.TrimSpace(threadID) == "" {
			return store.BotConversation{}, fmt.Errorf("%w: feishu thread targets require a thread id", ErrInvalidInput)
		}
		conversation.ExternalChatID = chatID
		conversation.ExternalThreadID = threadID
		conversation.ExternalConversationID = firstNonEmpty(strings.TrimSpace(target.ProviderState["feishu_conversation_id"]), "chat:"+chatID+":thread:"+threadID)
		conversation.ExternalUserID = strings.TrimSpace(target.ProviderState["feishu_user_open_id"])
		conversation.ExternalTitle = firstNonEmpty(conversation.ExternalTitle, strings.TrimSpace(target.ProviderState["feishu_chat_name"]))

	case "qqbot_group", "qqbot_c2c":
		messageType, groupOpenID, userOpenID, err := parseQQBotDeliveryRoute(routeType, routeKey, target.ProviderState)
		if err != nil {
			return store.BotConversation{}, err
		}
		conversation.ProviderState = mergeProviderState(conversation.ProviderState, map[string]string{
			"qqbot_message_type": messageType,
		})
		conversation.ExternalUserID = userOpenID
		switch messageType {
		case "c2c":
			conversation.ExternalChatID = userOpenID
			conversation.ExternalConversationID = "user:" + userOpenID
		default:
			conversation.ExternalChatID = groupOpenID
			conversation.ExternalConversationID = firstNonEmpty("group:"+groupOpenID, groupOpenID)
		}

	case "thread":
		conversationID, threadID, err := parseGenericThreadRoute(routeKey)
		if err != nil {
			return store.BotConversation{}, err
		}
		conversation.ExternalConversationID = conversationID
		conversation.ExternalChatID = conversationID
		conversation.ExternalThreadID = threadID

	case "conversation", "session", "chat":
		conversationID := strings.TrimSpace(routeKey)
		conversationID = strings.TrimPrefix(conversationID, "conversation:")
		conversationID = strings.TrimPrefix(conversationID, "chat:")
		conversationID = strings.TrimPrefix(conversationID, "user:")
		conversationID = strings.TrimSpace(conversationID)
		if conversationID == "" {
			return store.BotConversation{}, fmt.Errorf("%w: routeKey is required", ErrInvalidInput)
		}
		conversation.ExternalConversationID = conversationID
		conversation.ExternalChatID = conversationID

	default:
		conversationID := strings.TrimSpace(routeKey)
		if conversationID == "" {
			return store.BotConversation{}, fmt.Errorf("%w: unsupported routeType %q", ErrInvalidInput, routeType)
		}
		conversation.ExternalConversationID = conversationID
		conversation.ExternalChatID = conversationID
	}

	return conversation, nil
}

func parseTelegramDeliveryRoute(routeKey string, providerState map[string]string) (string, string, error) {
	chatID := strings.TrimSpace(providerState["chat_id"])
	threadID := strings.TrimSpace(providerState["thread_id"])
	normalized := strings.TrimSpace(routeKey)
	lower := strings.ToLower(normalized)
	switch {
	case strings.HasPrefix(lower, "chat:"):
		normalized = normalized[len("chat:"):]
	case strings.HasPrefix(lower, "conversation:"):
		normalized = normalized[len("conversation:"):]
	}
	if before, after, ok := strings.Cut(normalized, ":thread:"); ok {
		if strings.TrimSpace(chatID) == "" {
			chatID = strings.TrimSpace(before)
		}
		if strings.TrimSpace(threadID) == "" {
			threadID = strings.TrimSpace(after)
		}
	} else if strings.TrimSpace(chatID) == "" {
		chatID = strings.TrimSpace(normalized)
	}
	if strings.TrimSpace(chatID) == "" {
		return "", "", fmt.Errorf("%w: telegram route key must include a chat id", ErrInvalidInput)
	}
	return strings.TrimSpace(chatID), strings.TrimSpace(threadID), nil
}

func parseWeChatDeliveryRoute(routeKey string, providerState map[string]string) (string, error) {
	toUserID := strings.TrimSpace(routeKey)
	toUserID = strings.TrimPrefix(strings.TrimPrefix(toUserID, "user:"), "chat:")
	if toUserID == "" {
		toUserID = firstNonEmpty(strings.TrimSpace(providerState["to_user_id"]), strings.TrimSpace(providerState["external_chat_id"]))
	}
	if strings.TrimSpace(toUserID) == "" {
		return "", fmt.Errorf("%w: wechat route key must include a user id", ErrInvalidInput)
	}
	return strings.TrimSpace(toUserID), nil
}

func parseFeishuDeliveryRoute(routeKey string, providerState map[string]string) (string, string, error) {
	chatID := strings.TrimSpace(providerState["feishu_chat_id"])
	threadID := firstNonEmpty(strings.TrimSpace(providerState["feishu_thread_id"]), strings.TrimSpace(providerState["feishu_root_id"]))
	normalized := strings.TrimSpace(routeKey)
	lower := strings.ToLower(normalized)
	switch {
	case strings.HasPrefix(lower, "chat:"):
		normalized = normalized[len("chat:"):]
	case strings.HasPrefix(lower, "conversation:"):
		normalized = normalized[len("conversation:"):]
	}
	if before, after, ok := strings.Cut(normalized, ":thread:"); ok {
		if chatID == "" {
			chatID = strings.TrimSpace(before)
		}
		if threadID == "" {
			threadID = strings.TrimSpace(after)
		}
	} else if chatID == "" {
		chatID = strings.TrimSpace(normalized)
	}
	if chatID == "" {
		return "", "", fmt.Errorf("%w: feishu route key must include a chat id", ErrInvalidInput)
	}
	return chatID, threadID, nil
}

func parseQQBotDeliveryRoute(routeType string, routeKey string, providerState map[string]string) (string, string, string, error) {
	normalizedRouteType := strings.ToLower(strings.TrimSpace(routeType))
	normalizedRouteKey := strings.TrimSpace(routeKey)
	groupOpenID := strings.TrimSpace(providerState["qqbot_group_openid"])
	userOpenID := strings.TrimSpace(providerState["qqbot_user_openid"])

	switch {
	case normalizedRouteType == "qqbot_c2c":
		normalizedRouteKey = strings.TrimPrefix(normalizedRouteKey, "user:")
		if userOpenID == "" {
			userOpenID = strings.TrimSpace(normalizedRouteKey)
		}
		if userOpenID == "" {
			return "", "", "", fmt.Errorf("%w: qqbot c2c route key must include a user openid", ErrInvalidInput)
		}
		return "c2c", "", userOpenID, nil
	case normalizedRouteType == "qqbot_group":
		normalizedRouteKey = strings.TrimPrefix(normalizedRouteKey, "group:")
		if groupOpenID == "" {
			groupOpenID = strings.TrimSpace(normalizedRouteKey)
		}
		if groupOpenID == "" {
			return "", "", "", fmt.Errorf("%w: qqbot group route key must include a group openid", ErrInvalidInput)
		}
		return "group", groupOpenID, userOpenID, nil
	default:
		return "", "", "", fmt.Errorf("%w: unsupported qqbot route type %q", ErrInvalidInput, routeType)
	}
}

func normalizeRouteBackedTargetProviderState(
	connection store.BotConnection,
	routeType string,
	currentProviderState map[string]string,
	inputProviderState map[string]string,
) map[string]string {
	if inputProviderState == nil {
		return cloneStringMapLocal(currentProviderState)
	}

	nextProviderState := mergeProviderState(nil, inputProviderState)
	if normalizeProviderName(connection.Provider) != wechatProviderName || strings.TrimSpace(routeType) != "wechat_session" {
		return nextProviderState
	}

	managedState := cloneManagedWeChatRouteProviderState(currentProviderState)
	nextProviderState = stripManagedWeChatRouteProviderState(nextProviderState)
	return mergeProviderState(managedState, nextProviderState)
}

func cloneManagedWeChatRouteProviderState(providerState map[string]string) map[string]string {
	if len(providerState) == 0 {
		return nil
	}

	next := make(map[string]string)
	for key, value := range providerState {
		if !isManagedWeChatRouteProviderStateKey(key) {
			continue
		}
		trimmedValue := strings.TrimSpace(value)
		if trimmedValue == "" {
			continue
		}
		next[strings.TrimSpace(key)] = trimmedValue
	}
	if len(next) == 0 {
		return nil
	}
	return next
}

func stripManagedWeChatRouteProviderState(providerState map[string]string) map[string]string {
	if len(providerState) == 0 {
		return nil
	}

	next := make(map[string]string, len(providerState))
	for key, value := range providerState {
		if isManagedWeChatRouteProviderStateKey(key) {
			continue
		}
		trimmedKey := strings.TrimSpace(key)
		trimmedValue := strings.TrimSpace(value)
		if trimmedKey == "" || trimmedValue == "" {
			continue
		}
		next[trimmedKey] = trimmedValue
	}
	if len(next) == 0 {
		return nil
	}
	return next
}

func isManagedWeChatRouteProviderStateKey(key string) bool {
	switch strings.TrimSpace(key) {
	case wechatContextTokenKey, wechatSessionIDKey, wechatCreatedAtMSKey, "to_user_id", "external_chat_id":
		return true
	default:
		return false
	}
}

func cloneTimeValue(ts time.Time) *time.Time {
	if ts.IsZero() {
		return nil
	}
	next := ts
	return &next
}

func wechatConversationMatchesRecipient(conversation store.BotConversation, toUserID string) bool {
	trimmedUserID := strings.TrimSpace(toUserID)
	if trimmedUserID == "" {
		return false
	}

	return strings.TrimSpace(conversation.ExternalChatID) == trimmedUserID ||
		strings.TrimSpace(conversation.ExternalUserID) == trimmedUserID ||
		strings.TrimSpace(conversation.ExternalConversationID) == trimmedUserID
}

func wechatWaitingForContextMessage() string {
	return "Waiting for the recipient to send a message first so WeChat reply context can be established."
}

func pausedConnectionHealthMessage() string {
	return "Provider paused. Resume it before it can participate in routing again."
}

func resumedConnectionHealthMessage() string {
	return "Provider resumed. Waiting for the next health update."
}

func inactiveProviderDeliveryTargetMessage(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "paused":
		return "Current provider is paused. Resume it before it can participate in routing again."
	case "disabled":
		return "Current provider is disabled. Re-enable it before it can participate in routing again."
	default:
		return "Current provider is not active. Restore it before it can participate in routing again."
	}
}

func readyDeliveryTargetReadinessState(lastContextSeenAt *time.Time) deliveryTargetReadinessState {
	return deliveryTargetReadinessState{
		Readiness:         deliveryTargetReadinessReady,
		Message:           "Ready to send.",
		LastContextSeenAt: cloneOptionalTimeLocal(lastContextSeenAt),
	}
}

func waitingDeliveryTargetReadinessState(lastContextSeenAt *time.Time, message string) deliveryTargetReadinessState {
	return deliveryTargetReadinessState{
		Readiness:         deliveryTargetReadinessWaiting,
		Message:           strings.TrimSpace(message),
		LastContextSeenAt: cloneOptionalTimeLocal(lastContextSeenAt),
	}
}

func (s *Service) resolveWeChatRouteBackedConversation(
	workspaceID string,
	connection store.BotConnection,
	target store.BotDeliveryTarget,
) (wechatOutboundContextResolution, error) {
	syntheticConversation, err := buildSyntheticConversationForTarget(connection, target)
	if err != nil {
		return wechatOutboundContextResolution{}, err
	}

	toUserID := strings.TrimSpace(syntheticConversation.ExternalChatID)
	resolution := wechatOutboundContextResolution{
		ToUserID:         toUserID,
		SendConversation: syntheticConversation,
	}

	conversations := s.store.ListBotConversations(workspaceID, connection.ID)
	var latestMatch *store.BotConversation
	for _, candidate := range conversations {
		if !wechatConversationMatchesRecipient(candidate, toUserID) {
			continue
		}

		resolvedConversation := s.ensureConversationBotIdentity(candidate, connection)
		if latestMatch == nil {
			conversationCopy := resolvedConversation
			latestMatch = &conversationCopy
		}
		if strings.TrimSpace(resolvedConversation.ProviderState[wechatContextTokenKey]) == "" {
			continue
		}

		sendConversation := resolvedConversation
		sendConversation.ProviderState = mergeProviderState(target.ProviderState, resolvedConversation.ProviderState)
		resolution.SendConversation = sendConversation
		resolution.StoredConversation = &resolvedConversation
		resolution.LastContextSeenAt = cloneTimeValue(resolvedConversation.UpdatedAt)
		resolution.HasUsableContext = true
		return resolution, nil
	}

	if strings.TrimSpace(target.ProviderState[wechatContextTokenKey]) != "" {
		if latestMatch != nil {
			sendConversation := *latestMatch
			sendConversation.ProviderState = mergeProviderState(sendConversation.ProviderState, target.ProviderState)
			resolution.SendConversation = sendConversation
			resolution.StoredConversation = latestMatch
			resolution.LastContextSeenAt = cloneTimeValue(latestMatch.UpdatedAt)
		}
		resolution.HasUsableContext = true
		return resolution, nil
	}

	if latestMatch != nil {
		resolution.StoredConversation = latestMatch
		resolution.LastContextSeenAt = cloneTimeValue(latestMatch.UpdatedAt)
	}
	return resolution, nil
}

func parseGenericThreadRoute(routeKey string) (string, string, error) {
	normalized := strings.TrimSpace(routeKey)
	normalized = strings.TrimPrefix(normalized, "conversation:")
	normalized = strings.TrimPrefix(normalized, "chat:")
	before, after, ok := strings.Cut(normalized, ":thread:")
	if !ok || strings.TrimSpace(before) == "" || strings.TrimSpace(after) == "" {
		return "", "", fmt.Errorf("%w: thread route keys must use conversation:<id>:thread:<threadId>", ErrInvalidInput)
	}
	return strings.TrimSpace(before), strings.TrimSpace(after), nil
}

func normalizeOutboundReplyMessagesInput(messages []store.BotReplyMessage) ([]store.BotReplyMessage, []OutboundMessage, error) {
	outbound := outboundMessagesFromReplyMessages(messages)
	if len(outbound) == 0 {
		return nil, nil, fmt.Errorf("%w: at least one outbound message with text or media is required", ErrInvalidInput)
	}
	return outboundReplyMessages(outbound), outbound, nil
}

func validateOutboundMessagesForProvider(provider Provider, messages []OutboundMessage) error {
	if provider == nil {
		return nil
	}

	switch normalizeProviderName(provider.Name()) {
	case telegramProviderName:
		return validateTelegramOutboundMessages(messages)
	default:
		return nil
	}
}

func (s *Service) resolveConversationForDeliveryTarget(
	workspaceID string,
	connection store.BotConnection,
	target store.BotDeliveryTarget,
) (store.BotConversation, *store.BotConversation, error) {
	if conversationID := strings.TrimSpace(target.ConversationID); conversationID != "" {
		conversation, ok := s.store.GetBotConversation(workspaceID, conversationID)
		if !ok || conversation.ConnectionID != connection.ID {
			return store.BotConversation{}, nil, store.ErrBotConversationNotFound
		}
		conversation = s.ensureConversationBotIdentity(conversation, connection)
		return conversation, &conversation, nil
	}

	synthetic, err := buildSyntheticConversationForTarget(connection, target)
	if err != nil {
		return store.BotConversation{}, nil, err
	}
	if normalizeProviderName(connection.Provider) == wechatProviderName &&
		strings.TrimSpace(normalizeRouteTypeForTarget(connection, target.RouteType, target.RouteKey)) == "wechat_session" {
		resolution, err := s.resolveWeChatRouteBackedConversation(workspaceID, connection, target)
		if err != nil {
			return store.BotConversation{}, nil, err
		}
		if resolution.HasUsableContext {
			return resolution.SendConversation, resolution.StoredConversation, nil
		}
		return store.BotConversation{}, nil, fmt.Errorf(
			"%w: wechat recipient %q has not established a sendable reply context yet; wait for the user to send a message first",
			ErrInvalidInput,
			resolution.ToUserID,
		)
	}
	if shouldReuseLatestRouteBackedConversation(connection.Provider) {
		sendConversation, storedConversation := s.resolveLatestRouteBackedConversation(
			workspaceID,
			connection,
			target,
			synthetic,
		)
		return sendConversation, storedConversation, nil
	}
	return synthetic, nil, nil
}

func shouldReuseLatestRouteBackedConversation(provider string) bool {
	switch normalizeProviderName(provider) {
	case feishuProviderName, qqbotProviderName:
		return true
	default:
		return false
	}
}

func (s *Service) resolveLatestRouteBackedConversation(
	workspaceID string,
	connection store.BotConnection,
	target store.BotDeliveryTarget,
	synthetic store.BotConversation,
) (store.BotConversation, *store.BotConversation) {
	routeType, routeKey := canonicalRouteForTargetType(
		normalizeRouteTypeForTarget(connection, target.RouteType, target.RouteKey),
		synthetic,
	)

	var latestMatch *store.BotConversation
	latestUpdatedAt := time.Time{}

	conversations := s.store.ListBotConversations(workspaceID, connection.ID)
	for _, candidate := range conversations {
		resolvedConversation := s.ensureConversationBotIdentity(candidate, connection)
		candidateRouteType, candidateRouteKey := deliveryRouteFromConversation(connection, resolvedConversation)
		candidateRouteType, candidateRouteKey = canonicalRouteForTargetType(candidateRouteType, resolvedConversation)
		if strings.TrimSpace(candidateRouteType) != strings.TrimSpace(routeType) ||
			strings.TrimSpace(candidateRouteKey) != strings.TrimSpace(routeKey) {
			continue
		}
		if latestMatch == nil || resolvedConversation.UpdatedAt.After(latestUpdatedAt) {
			conversationCopy := resolvedConversation
			latestMatch = &conversationCopy
			latestUpdatedAt = resolvedConversation.UpdatedAt
		}
	}

	if latestMatch == nil {
		return synthetic, nil
	}

	sendConversation := *latestMatch
	sendConversation.ExternalConversationID = firstNonEmpty(
		strings.TrimSpace(sendConversation.ExternalConversationID),
		strings.TrimSpace(synthetic.ExternalConversationID),
	)
	sendConversation.ExternalChatID = firstNonEmpty(
		strings.TrimSpace(sendConversation.ExternalChatID),
		strings.TrimSpace(synthetic.ExternalChatID),
	)
	sendConversation.ExternalThreadID = firstNonEmpty(
		strings.TrimSpace(sendConversation.ExternalThreadID),
		strings.TrimSpace(synthetic.ExternalThreadID),
	)
	sendConversation.ExternalUserID = firstNonEmpty(
		strings.TrimSpace(sendConversation.ExternalUserID),
		strings.TrimSpace(synthetic.ExternalUserID),
	)
	sendConversation.ExternalUsername = firstNonEmpty(
		strings.TrimSpace(sendConversation.ExternalUsername),
		strings.TrimSpace(synthetic.ExternalUsername),
	)
	sendConversation.ExternalTitle = firstNonEmpty(
		strings.TrimSpace(sendConversation.ExternalTitle),
		strings.TrimSpace(synthetic.ExternalTitle),
	)
	sendConversation.ProviderState = mergeProviderState(target.ProviderState, sendConversation.ProviderState)

	return sendConversation, latestMatch
}

func (s *Service) findExistingOutboundDeliveryByIdempotency(
	workspaceID string,
	botID string,
	connectionID string,
	deliveryTargetID string,
	sourceType string,
	idempotencyKey string,
) (store.BotOutboundDelivery, bool) {
	trimmedKey := strings.TrimSpace(idempotencyKey)
	if trimmedKey == "" {
		return store.BotOutboundDelivery{}, false
	}

	deliveries := s.store.ListBotOutboundDeliveries(workspaceID, store.BotOutboundDeliveryFilter{
		BotID:            botID,
		ConnectionID:     connectionID,
		DeliveryTargetID: deliveryTargetID,
	})
	for _, delivery := range deliveries {
		if strings.TrimSpace(delivery.SourceType) != strings.TrimSpace(sourceType) {
			continue
		}
		if strings.TrimSpace(delivery.IdempotencyKey) != trimmedKey {
			continue
		}
		return delivery, true
	}
	return store.BotOutboundDelivery{}, false
}

func (s *Service) recordConversationOutboundDeliveryState(
	connection store.BotConnection,
	conversation store.BotConversation,
	messages []store.BotReplyMessage,
	status string,
	lastError string,
	attemptCount int,
	deliveredAt *time.Time,
) store.BotConversation {
	lastOutboundText := ""
	if len(messages) > 0 {
		lastOutboundText = summarizeStoredProviderReplyMessages(connection, messages)
	}

	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		current.LastOutboundText = lastOutboundText
		current.LastOutboundDeliveryStatus = strings.TrimSpace(status)
		current.LastOutboundDeliveryError = strings.TrimSpace(lastError)
		current.LastOutboundDeliveryAttemptCount = attemptCount
		current.LastOutboundDeliveredAt = cloneOptionalTimeLocal(deliveredAt)
		return current
	})
	if err != nil {
		updatedConversation = conversation
		updatedConversation.LastOutboundText = lastOutboundText
		updatedConversation.LastOutboundDeliveryStatus = strings.TrimSpace(status)
		updatedConversation.LastOutboundDeliveryError = strings.TrimSpace(lastError)
		updatedConversation.LastOutboundDeliveryAttemptCount = attemptCount
		updatedConversation.LastOutboundDeliveredAt = cloneOptionalTimeLocal(deliveredAt)
	}
	return updatedConversation
}

func (s *Service) sendOutboundDeliveryWithRetry(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	sendConversation store.BotConversation,
	storedConversation *store.BotConversation,
	target store.BotDeliveryTarget,
	delivery store.BotOutboundDelivery,
	outboundMessages []OutboundMessage,
) (store.BotOutboundDelivery, *store.BotConversation, error) {
	return s.sendOutboundDeliveryWithRetryHooks(
		ctx,
		provider,
		connection,
		sendConversation,
		storedConversation,
		target,
		delivery,
		outboundMessages,
		nil,
	)
}

func (s *Service) sendOutboundDeliveryWithRetryHooks(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	sendConversation store.BotConversation,
	storedConversation *store.BotConversation,
	target store.BotDeliveryTarget,
	delivery store.BotOutboundDelivery,
	outboundMessages []OutboundMessage,
	hooks *outboundDeliveryRetryHooks,
) (store.BotOutboundDelivery, *store.BotConversation, error) {
	threadID := strings.TrimSpace(sendConversation.ThreadID)
	if storedConversation != nil && strings.TrimSpace(storedConversation.ThreadID) != "" {
		threadID = strings.TrimSpace(storedConversation.ThreadID)
	}

	for attempt := 1; ; attempt++ {
		updatedDelivery, updateErr := s.store.UpdateBotOutboundDelivery(connection.WorkspaceID, delivery.ID, func(current store.BotOutboundDelivery) store.BotOutboundDelivery {
			current.Status = "sending"
			current.AttemptCount = attempt
			current.LastError = ""
			current.DeliveredAt = nil
			return current
		})
		if updateErr == nil {
			delivery = updatedDelivery
		}
		if hooks != nil && hooks.onAttemptStart != nil {
			hooks.onAttemptStart(attempt)
		}
		s.publish(connection.WorkspaceID, threadID, "bot/outbound_delivery/updated", map[string]any{
			"botId":            delivery.BotID,
			"connectionId":     connection.ID,
			"deliveryTargetId": target.ID,
			"deliveryId":       delivery.ID,
			"status":           "sending",
			"attemptCount":     attempt,
		})

		if err := provider.SendMessages(ctx, connection, sendConversation, outboundMessages); err != nil {
			retry, delay := replyDeliveryRetryDecision(provider, err, attempt)
			trimmedError := strings.TrimSpace(unwrapReplyDeliveryRetryable(err).Error())
			if trimmedError == "" {
				trimmedError = "outbound delivery failed with an empty error message"
			}
			if retry {
				delayLabel := delay.Round(time.Millisecond).String()
				if delay <= 0 {
					delayLabel = "immediately"
				}
				if hooks != nil && hooks.onRetry != nil {
					hooks.onRetry(attempt+1, trimmedError, delay)
				}
				s.appendConnectionLog(
					connection.WorkspaceID,
					connection.ID,
					"warning",
					"outbound_delivery_retry",
					fmt.Sprintf(
						"Outbound delivery %s attempt %d to target %s failed and will retry %s: %s",
						delivery.ID,
						attempt,
						target.ID,
						delayLabel,
						trimmedError,
					),
				)
				if delay > 0 {
					if sleepErr := sleepWithContext(ctx, delay); sleepErr != nil {
						err = errors.Join(unwrapReplyDeliveryRetryable(err), sleepErr)
						trimmedError = strings.TrimSpace(err.Error())
						retry = false
					}
				}
				if retry {
					continue
				}
			}

			updatedDelivery, updateErr = s.store.UpdateBotOutboundDelivery(connection.WorkspaceID, delivery.ID, func(current store.BotOutboundDelivery) store.BotOutboundDelivery {
				current.Status = "failed"
				current.AttemptCount = attempt
				current.LastError = trimmedError
				current.DeliveredAt = nil
				return current
			})
			if updateErr == nil {
				delivery = updatedDelivery
			}
			if storedConversation != nil {
				updatedConversation := s.recordConversationOutboundDeliveryState(
					connection,
					*storedConversation,
					delivery.Messages,
					"failed",
					trimmedError,
					attempt,
					nil,
				)
				storedConversation = &updatedConversation
				threadID = strings.TrimSpace(updatedConversation.ThreadID)
			}
			s.publish(connection.WorkspaceID, threadID, "bot/outbound_delivery/updated", map[string]any{
				"botId":            delivery.BotID,
				"connectionId":     connection.ID,
				"deliveryTargetId": target.ID,
				"deliveryId":       delivery.ID,
				"status":           "failed",
				"attemptCount":     attempt,
				"lastError":        trimmedError,
			})
			s.appendConnectionLog(
				connection.WorkspaceID,
				connection.ID,
				"error",
				"outbound_delivery_failed",
				fmt.Sprintf(
					"Outbound delivery %s to target %s failed after %d attempt(s): %s",
					delivery.ID,
					target.ID,
					attempt,
					trimmedError,
				),
			)
			s.setConnectionLastError(connection.WorkspaceID, connection.ID, trimmedError)
			return delivery, storedConversation, &replyDeliveryError{
				providerName: provider.Name(),
				phase:        "outbound send",
				attemptCount: attempt,
				cause:        unwrapReplyDeliveryRetryable(err),
			}
		}

		deliveredAt := time.Now().UTC()
		updatedDelivery, updateErr = s.store.UpdateBotOutboundDelivery(connection.WorkspaceID, delivery.ID, func(current store.BotOutboundDelivery) store.BotOutboundDelivery {
			current.Status = "delivered"
			current.AttemptCount = attempt
			current.LastError = ""
			current.DeliveredAt = &deliveredAt
			return current
		})
		if updateErr == nil {
			delivery = updatedDelivery
		}
		if storedConversation != nil {
			updatedConversation := s.recordConversationOutboundDeliveryState(
				connection,
				*storedConversation,
				delivery.Messages,
				"delivered",
				"",
				attempt,
				&deliveredAt,
			)
			storedConversation = &updatedConversation
			threadID = strings.TrimSpace(updatedConversation.ThreadID)
		}
		s.publish(connection.WorkspaceID, threadID, "bot/outbound_delivery/updated", map[string]any{
			"botId":            delivery.BotID,
			"connectionId":     connection.ID,
			"deliveryTargetId": target.ID,
			"deliveryId":       delivery.ID,
			"status":           "delivered",
			"attemptCount":     attempt,
		})
		s.appendConnectionLog(
			connection.WorkspaceID,
			connection.ID,
			"success",
			"outbound_delivery_sent",
			fmt.Sprintf(
				"Outbound delivery %s sent to target %s.",
				delivery.ID,
				target.ID,
			),
		)
		s.setConnectionLastError(connection.WorkspaceID, connection.ID, "")
		return delivery, storedConversation, nil
	}
}

func cloneBotConnectionStoreValue(connection store.BotConnection) store.BotConnection {
	next := connection
	next.AIConfig = cloneStringMapLocal(connection.AIConfig)
	next.Settings = cloneStringMapLocal(connection.Settings)
	next.Secrets = cloneStringMapLocal(connection.Secrets)
	next.LastPollAt = cloneOptionalTimeLocal(connection.LastPollAt)
	return next
}

func cloneBotConversationStoreValue(conversation store.BotConversation) store.BotConversation {
	next := conversation
	next.BackendState = cloneStringMapLocal(conversation.BackendState)
	next.ProviderState = cloneStringMapLocal(conversation.ProviderState)
	next.LastOutboundDeliveredAt = cloneOptionalTimeLocal(conversation.LastOutboundDeliveredAt)
	return next
}

func cloneBotDeliveryTargetStoreValue(target store.BotDeliveryTarget) store.BotDeliveryTarget {
	next := target
	next.Labels = cloneStringSliceLocal(target.Labels)
	next.Capabilities = cloneStringSliceLocal(target.Capabilities)
	next.ProviderState = cloneStringMapLocal(target.ProviderState)
	next.LastVerifiedAt = cloneOptionalTimeLocal(target.LastVerifiedAt)
	return next
}

func (s *Service) resolveConversationExecutionContext(
	connection store.BotConnection,
	conversation store.BotConversation,
) (store.BotConnection, store.BotConversation) {
	executionConnection := cloneBotConnectionStoreValue(connection)
	executionConversation := cloneBotConversationStoreValue(conversation)

	binding, ok := s.resolveConversationBinding(conversation)
	if !ok {
		return executionConnection, executionConversation
	}

	if normalizeAIBackendName(binding.AIBackend) == normalizeAIBackendName(connection.AIBackend) && len(binding.AIConfig) > 0 {
		executionConnection.AIConfig = cloneStringMapLocal(binding.AIConfig)
	}

	targetWorkspaceID := firstNonEmpty(
		strings.TrimSpace(binding.TargetWorkspaceID),
		strings.TrimSpace(conversation.WorkspaceID),
		strings.TrimSpace(connection.WorkspaceID),
	)
	currentRef := resolveConversationCurrentThreadRef(
		conversation,
		binding,
		true,
		firstNonEmpty(strings.TrimSpace(conversation.WorkspaceID), strings.TrimSpace(connection.WorkspaceID)),
	)

	switch strings.TrimSpace(binding.BindingMode) {
	case "fixed_thread":
		if currentRef.WorkspaceID != "" {
			executionConnection.WorkspaceID = currentRef.WorkspaceID
		} else if targetWorkspaceID != "" {
			executionConnection.WorkspaceID = targetWorkspaceID
		}
		if currentRef.ThreadID != "" {
			executionConversation.ThreadID = currentRef.ThreadID
		}
	case "workspace_auto_thread":
		if currentRef.WorkspaceID != "" {
			executionConnection.WorkspaceID = currentRef.WorkspaceID
		} else if targetWorkspaceID != "" {
			executionConnection.WorkspaceID = targetWorkspaceID
		}
		if currentRef.ThreadID != "" {
			executionConversation.ThreadID = currentRef.ThreadID
		} else if strings.TrimSpace(executionConversation.ThreadID) == "" {
			executionConversation.ThreadID = strings.TrimSpace(binding.TargetThreadID)
		}
	}

	return executionConnection, executionConversation
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

func (s *Service) ListAllWeChatAccounts() []WeChatAccountView {
	views := make([]WeChatAccountView, 0)
	for _, workspace := range s.store.ListWorkspaces() {
		items := s.store.ListWeChatAccounts(workspace.ID)
		for _, item := range items {
			views = append(views, wechatAccountViewFromStore(item))
		}
	}
	sort.Slice(views, func(i int, j int) bool {
		if views[i].UpdatedAt.Equal(views[j].UpdatedAt) {
			return views[i].ID < views[j].ID
		}
		return views[i].UpdatedAt.After(views[j].UpdatedAt)
	})
	return views
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
	return s.createConnection(ctx, workspaceID, "", input)
}

func (s *Service) CreateConnectionForBot(
	ctx context.Context,
	workspaceID string,
	botID string,
	input CreateConnectionInput,
) (ConnectionView, error) {
	return s.createConnection(ctx, workspaceID, botID, input)
}

func (s *Service) createConnection(
	ctx context.Context,
	workspaceID string,
	botID string,
	input CreateConnectionInput,
) (ConnectionView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return ConnectionView{}, err
	}

	resolvedBotID := strings.TrimSpace(botID)
	if resolvedBotID != "" {
		if _, ok := s.store.GetBot(resolvedWorkspaceID, resolvedBotID); !ok {
			return ConnectionView{}, store.ErrBotNotFound
		}
	}

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
		resolvedWorkspaceID,
		providerName,
		normalizedSettings,
		input.Secrets,
	)
	if err != nil {
		return ConnectionView{}, err
	}

	connection := store.BotConnection{
		ID:          store.NewID("bot"),
		BotID:       resolvedBotID,
		WorkspaceID: resolvedWorkspaceID,
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

	now := time.Now().UTC()
	pausedMessage := pausedConnectionHealthMessage()
	updated, err := s.store.UpdateBotConnection(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.Status = "paused"
		current.LastError = ""
		current.LastPollAt = &now
		current.LastPollStatus = "paused"
		current.LastPollMessage = pausedMessage
		current.LastPollMessageKey = ""
		current.LastPollMessageParams = nil
		return current
	})
	if err != nil {
		return ConnectionView{}, err
	}

	s.appendConnectionLog(updated.WorkspaceID, updated.ID, "warning", "connection_paused", pausedMessage)
	s.publish(updated.WorkspaceID, "", "bot/connection/paused", map[string]any{
		"connectionId": updated.ID,
	})
	s.syncPollingConnections()
	logBotDebug(ctx, updated, "connection paused")

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

	now := time.Now().UTC()
	resumedMessage := resumedConnectionHealthMessage()
	updated, err := s.store.UpdateBotConnection(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.Status = "active"
		current.LastError = ""
		current.LastPollAt = &now
		current.LastPollStatus = "starting"
		current.LastPollMessage = resumedMessage
		current.LastPollMessageKey = ""
		current.LastPollMessageParams = nil
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
	s.appendConnectionLog(updated.WorkspaceID, updated.ID, "info", "connection_resumed", resumedMessage)
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

	result := WebhookResult{}
	var messages []InboundMessage
	if advancedProvider, ok := provider.(WebhookResultProvider); ok {
		result, messages, err = advancedProvider.ParseWebhookResult(r, connection)
	} else {
		messages, err = provider.ParseWebhook(r, connection)
	}
	if err != nil {
		return WebhookResult{}, err
	}

	accepted := 0
	for _, message := range messages {
		enqueued, err := s.acceptOrBufferInboundMessage(connection, message)
		if err != nil {
			return WebhookResult{}, err
		}
		if enqueued {
			accepted += 1
		}
	}

	result.Accepted = accepted
	return result, nil
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
		attemptCount, err := s.sendReplyWithOutboundDelivery(messageCtx, provider, connection, conversation, &delivery, &delivery, &message, reply, "saved reply replay")
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
	executionConnection, executionConversation := s.resolveConversationExecutionContext(connection, conversation)
	streamingProvider, providerSupportsStreaming := provider.(StreamingProvider)
	streamingBackend, backendSupportsStreaming := aiBackend.(StreamingAIBackend)
	if !providerSupportsStreaming || !backendSupportsStreaming {
		logBotDebug(ctx, connection, "executing final ai reply",
			slog.String("backend", aiBackend.Name()),
			slog.Bool("streamingProvider", providerSupportsStreaming),
			slog.Bool("streamingBackend", backendSupportsStreaming),
		)
		reply, attemptCount, err := s.executeFinalAIReply(
			ctx,
			provider,
			aiBackend,
			connection,
			conversation,
			executionConnection,
			executionConversation,
			preparedInbound,
			inbound,
			startedAt,
			delivery,
		)
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

	shadowOutbound := replyOutboundDeliveryContext{}
	shadowOutboundEnabled := false
	if s != nil && s.store != nil && delivery != nil &&
		strings.TrimSpace(connection.WorkspaceID) != "" &&
		strings.TrimSpace(connection.BotID) != "" &&
		strings.TrimSpace(conversation.ID) != "" {
		shadowOutbound, err = s.prepareReplyOutboundDelivery(ctx, connection, conversation, delivery, AIResult{})
		if err != nil {
			return AIResult{}, 0, false, "", err
		}
		shadowOutbound = s.updateReplyOutboundDeliveryRecord(
			connection,
			shadowOutbound,
			"sending",
			1,
			"",
			nil,
			AIResult{},
		)
		shadowOutboundEnabled = true
	}

	if err := session.Update(ctx, StreamingUpdate{Messages: []OutboundMessage{{Text: defaultStreamingPendingText}}}); err == nil {
	}

	reply, processErr := streamingBackend.ProcessMessageStream(
		ctx,
		executionConnection,
		executionConversation,
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
			if shadowOutboundEnabled {
				shadowOutbound = s.updateReplyOutboundDeliveryRecord(
					connection,
					shadowOutbound,
					"failed",
					1,
					strings.TrimSpace(errors.Join(processErr, failErr).Error()),
					nil,
					AIResult{},
				)
			}
			return AIResult{}, 1, false, "", errors.Join(processErr, failErr)
		}
		if shadowOutboundEnabled {
			shadowOutbound = s.updateReplyOutboundDeliveryRecord(
				connection,
				shadowOutbound,
				"failed",
				1,
				strings.TrimSpace(processErr.Error()),
				nil,
				AIResult{},
			)
		}
		return AIResult{}, 1, true, failureText, processErr
	}

	reply = finalizeProviderAIResult(connection, inbound, startedAt, reply)
	if err := session.Complete(ctx, reply.Messages); err != nil {
		if shadowOutboundEnabled {
			shadowOutbound = s.updateReplyOutboundDeliveryRecord(
				connection,
				shadowOutbound,
				"failed",
				1,
				strings.TrimSpace(err.Error()),
				nil,
				reply,
			)
		}
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
	if shadowOutboundEnabled {
		deliveredAt := time.Now().UTC()
		shadowOutbound = s.updateReplyOutboundDeliveryRecord(
			connection,
			shadowOutbound,
			"delivered",
			1,
			"",
			&deliveredAt,
			reply,
		)
	}

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
	executionConnection store.BotConnection,
	executionConversation store.BotConversation,
	inbound InboundMessage,
	originalInbound InboundMessage,
	startedAt time.Time,
	delivery *store.BotInboundDelivery,
) (AIResult, int, error) {
	reply, err := aiBackend.ProcessMessage(ctx, executionConnection, executionConversation, inbound)
	if err != nil {
		return AIResult{}, 0, wrapAIBackendError(aiBackend.Name(), err)
	}
	reply = finalizeProviderAIResult(connection, originalInbound, startedAt, reply)
	logBotDebug(ctx, connection, "final ai reply produced",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("replyThreadId", strings.TrimSpace(reply.ThreadID)),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
	)

	attemptCount, err := s.sendReplyWithOutboundDelivery(ctx, provider, connection, conversation, delivery, delivery, &originalInbound, reply, "final message send")
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

func (s *Service) setConnectionLastErrorTransient(workspaceID string, connectionID string, lastError string) {
	_, _ = s.store.UpdateBotConnectionRuntimeStateTransient(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.LastError = strings.TrimSpace(lastError)
		return current
	})
}

func (s *Service) updateConnectionPollState(
	workspaceID string,
	connectionID string,
	status string,
	message string,
	messageKey string,
	messageParams map[string]string,
	lastError string,
) {
	now := time.Now().UTC()
	_, _ = s.store.UpdateBotConnectionRuntimeStateTransient(workspaceID, connectionID, func(current store.BotConnection) store.BotConnection {
		current.LastPollAt = &now
		current.LastPollStatus = strings.TrimSpace(status)
		current.LastPollMessage = strings.TrimSpace(message)
		current.LastPollMessageKey = strings.TrimSpace(messageKey)
		current.LastPollMessageParams = cloneStringMapLocal(messageParams)
		current.LastError = strings.TrimSpace(lastError)
		return current
	})
}

func (s *Service) appendConnectionLog(workspaceID string, connectionID string, level string, eventType string, message string) {
	s.appendConnectionLogWithI18n(workspaceID, connectionID, level, eventType, message, "", nil)
}

func (s *Service) appendConnectionLogWithI18n(
	workspaceID string,
	connectionID string,
	level string,
	eventType string,
	message string,
	messageKey string,
	messageParams map[string]string,
) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}

	_, _ = s.store.AppendBotConnectionLog(workspaceID, connectionID, store.BotConnectionLogEntry{
		Level:         strings.TrimSpace(level),
		EventType:     strings.TrimSpace(eventType),
		Message:       message,
		MessageKey:    strings.TrimSpace(messageKey),
		MessageParams: cloneStringMapLocal(messageParams),
	})
}

func (s *Service) appendConnectionLogTransient(workspaceID string, connectionID string, level string, eventType string, message string) {
	s.appendConnectionLogTransientWithI18n(workspaceID, connectionID, level, eventType, message, "", nil)
}

func (s *Service) appendConnectionLogTransientWithI18n(
	workspaceID string,
	connectionID string,
	level string,
	eventType string,
	message string,
	messageKey string,
	messageParams map[string]string,
) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}

	_, _ = s.store.AppendBotConnectionLogTransient(workspaceID, connectionID, store.BotConnectionLogEntry{
		Level:         strings.TrimSpace(level),
		EventType:     strings.TrimSpace(eventType),
		Message:       message,
		MessageKey:    strings.TrimSpace(messageKey),
		MessageParams: cloneStringMapLocal(messageParams),
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

	s.updateConnectionPollState(
		workspaceID,
		connectionID,
		"success",
		message,
		event.MessageKey,
		event.MessageParams,
		"",
	)
	s.appendConnectionLogTransientWithI18n(
		workspaceID,
		connectionID,
		"success",
		eventType,
		message,
		event.MessageKey,
		event.MessageParams,
	)
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
			s.setConnectionLastErrorTransient(connection.WorkspaceID, connection.ID, err.Error())
			s.appendConnectionLogTransient(connection.WorkspaceID, connection.ID, "error", "poll_conflict", err.Error())
		}
		return
	}
	if strings.TrimSpace(connection.LastError) != "" {
		s.setConnectionLastErrorTransient(connection.WorkspaceID, connection.ID, "")
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
				_, err := s.acceptOrBufferInboundMessage(connection, message)
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

	s.updateConnectionPollState(connection.WorkspaceID, connection.ID, "failed", err.Error(), "", nil, err.Error())
	s.appendConnectionLogTransient(
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

func cloneStringSliceLocal(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func cloneBotReplyMessagesLocal(messages []store.BotReplyMessage) []store.BotReplyMessage {
	if len(messages) == 0 {
		return nil
	}

	cloned := make([]store.BotReplyMessage, 0, len(messages))
	for _, message := range messages {
		next := message
		next.Media = cloneBotMessageMediaList(message.Media)
		cloned = append(cloned, next)
	}
	return cloned
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
	refs := knownConversationThreadRefs(conversation)
	items := make([]string, 0, len(refs))
	for _, ref := range refs {
		if ref.ThreadID == "" {
			continue
		}
		items = append(items, ref.ThreadID)
	}
	return items
}

func knownConversationThreadIDsFromState(state map[string]string) []string {
	refs := knownConversationThreadRefsFromState(state, "")
	items := make([]string, 0, len(refs))
	for _, ref := range refs {
		if ref.ThreadID == "" {
			continue
		}
		items = append(items, ref.ThreadID)
	}
	return items
}

func knownConversationThreadRefs(conversation store.BotConversation) []botThreadRef {
	return knownConversationThreadRefsFromState(conversation.BackendState, conversation.WorkspaceID)
}

func pendingConversationSessionStartSource(state map[string]string) string {
	return threads.NormalizeThreadStartSource(state[botConversationPendingStartKey])
}

func conversationBackendStateWithPendingSessionStartSource(state map[string]string, source string) map[string]string {
	normalized := threads.NormalizeThreadStartSource(source)
	next := cloneStringMapLocal(state)
	if normalized == "" {
		if len(next) == 0 {
			return nil
		}
		delete(next, botConversationPendingStartKey)
		if len(next) == 0 {
			return nil
		}
		return next
	}
	if next == nil {
		next = make(map[string]string)
	}
	next[botConversationPendingStartKey] = normalized
	return next
}

func currentConversationThreadRefFromState(state map[string]string, fallbackWorkspaceID string) botThreadRef {
	return parseStoredBotThreadRef(state[botConversationCurrentThreadKey], fallbackWorkspaceID)
}

func resolveStoredConversationCurrentThreadRef(
	state map[string]string,
	threadID string,
	fallbackWorkspaceID string,
) botThreadRef {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return botThreadRef{}
	}

	if storedRef := currentConversationThreadRefFromState(state, fallbackWorkspaceID); storedRef.ThreadID == threadID {
		return storedRef
	}

	matches := make([]botThreadRef, 0, 1)
	seen := make(map[string]struct{})
	for _, ref := range knownConversationThreadRefsFromState(state, fallbackWorkspaceID) {
		if ref.ThreadID != threadID {
			continue
		}
		refKey := botThreadRefKey(ref)
		if refKey == "" {
			continue
		}
		if _, ok := seen[refKey]; ok {
			continue
		}
		seen[refKey] = struct{}{}
		matches = append(matches, ref)
		if len(matches) > 1 {
			return botThreadRef{}
		}
	}
	if len(matches) == 1 {
		return matches[0]
	}
	return botThreadRef{}
}

func normalizeBotThreadRef(ref botThreadRef, fallbackWorkspaceID string) botThreadRef {
	ref.WorkspaceID = firstNonEmpty(strings.TrimSpace(ref.WorkspaceID), strings.TrimSpace(fallbackWorkspaceID))
	ref.ThreadID = strings.TrimSpace(ref.ThreadID)
	if ref.ThreadID == "" {
		return botThreadRef{}
	}
	return ref
}

func encodeBotThreadRef(ref botThreadRef) string {
	ref = normalizeBotThreadRef(ref, "")
	if ref.ThreadID == "" {
		return ""
	}
	if ref.WorkspaceID == "" {
		return ref.ThreadID
	}
	return ref.WorkspaceID + botConversationThreadRefSeparator + ref.ThreadID
}

func parseStoredBotThreadRef(raw string, fallbackWorkspaceID string) botThreadRef {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return botThreadRef{}
	}
	if workspaceID, threadID, ok := strings.Cut(raw, botConversationThreadRefSeparator); ok {
		return normalizeBotThreadRef(botThreadRef{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
		}, fallbackWorkspaceID)
	}
	return normalizeBotThreadRef(botThreadRef{ThreadID: raw}, fallbackWorkspaceID)
}

func knownConversationThreadRefsFromState(state map[string]string, fallbackWorkspaceID string) []botThreadRef {
	raw := strings.TrimSpace(state[botConversationThreadListKey])
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, "\n")
	items := make([]botThreadRef, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		ref := parseStoredBotThreadRef(part, fallbackWorkspaceID)
		if ref.ThreadID == "" {
			continue
		}
		key := botThreadRefKey(ref)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		items = append(items, ref)
	}
	return items
}

func appendBotThreadRef(items []botThreadRef, ref botThreadRef, fallbackWorkspaceID string) []botThreadRef {
	ref = normalizeBotThreadRef(ref, fallbackWorkspaceID)
	if ref.ThreadID == "" {
		return items
	}
	refKey := botThreadRefKey(ref)
	for _, existing := range items {
		if botThreadRefKey(existing) == refKey {
			return items
		}
	}
	return append(items, ref)
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

func appendKnownConversationThreadRef(state map[string]string, ref botThreadRef, fallbackWorkspaceID string) []botThreadRef {
	items := knownConversationThreadRefsFromState(state, fallbackWorkspaceID)
	return appendBotThreadRef(items, ref, fallbackWorkspaceID)
}

func conversationBackendStateWithKnownThreads(state map[string]string, threadIDs []string) map[string]string {
	refs := make([]botThreadRef, 0, len(threadIDs))
	for _, threadID := range threadIDs {
		refs = append(refs, normalizeBotThreadRef(botThreadRef{ThreadID: threadID}, ""))
	}
	return conversationBackendStateWithKnownThreadRefs(state, refs)
}

func conversationBackendStateWithKnownThreadRefs(state map[string]string, refs []botThreadRef) map[string]string {
	currentRef := currentConversationThreadRefFromState(state, "")
	next := stripConversationInternalBackendState(state)
	if len(refs) == 0 {
		return conversationBackendStateWithCurrentThreadRef(next, currentRef, "")
	}
	encoded := make([]string, 0, len(refs))
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		ref = normalizeBotThreadRef(ref, "")
		if ref.ThreadID == "" {
			continue
		}
		key := botThreadRefKey(ref)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		encodedValue := encodeBotThreadRef(ref)
		if encodedValue == "" {
			continue
		}
		encoded = append(encoded, encodedValue)
	}
	if len(encoded) == 0 {
		return conversationBackendStateWithCurrentThreadRef(next, currentRef, "")
	}
	if next == nil {
		next = make(map[string]string)
	}
	next[botConversationThreadListKey] = strings.Join(encoded, "\n")
	return conversationBackendStateWithCurrentThreadRef(next, currentRef, "")
}

func conversationBackendStateWithCurrentThreadRef(
	state map[string]string,
	ref botThreadRef,
	fallbackWorkspaceID string,
) map[string]string {
	ref = normalizeBotThreadRef(ref, fallbackWorkspaceID)
	next := cloneStringMapLocal(state)
	if ref.ThreadID == "" {
		if len(next) == 0 {
			return nil
		}
		delete(next, botConversationCurrentThreadKey)
		if len(next) == 0 {
			return nil
		}
		return next
	}

	encodedRef := encodeBotThreadRef(ref)
	if encodedRef == "" {
		if len(next) == 0 {
			return nil
		}
		delete(next, botConversationCurrentThreadKey)
		if len(next) == 0 {
			return nil
		}
		return next
	}
	if next == nil {
		next = make(map[string]string)
	}
	next[botConversationCurrentThreadKey] = encodedRef
	return next
}

func botThreadRefKey(ref botThreadRef) string {
	ref = normalizeBotThreadRef(ref, "")
	if ref.ThreadID == "" {
		return ""
	}
	return ref.WorkspaceID + botConversationThreadRefSeparator + ref.ThreadID
}

func mergeConversationBackendState(base map[string]string, overlay map[string]string, version int, fallbackWorkspaceID string) map[string]string {
	knownThreadRefs := knownConversationThreadRefsFromState(base, fallbackWorkspaceID)
	for _, ref := range knownConversationThreadRefsFromState(overlay, fallbackWorkspaceID) {
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, ref, fallbackWorkspaceID)
	}
	currentRef := currentConversationThreadRefFromState(overlay, fallbackWorkspaceID)
	if currentRef.ThreadID == "" {
		currentRef = currentConversationThreadRefFromState(base, fallbackWorkspaceID)
	}

	merged := mergeStringMaps(
		stripConversationInternalBackendState(base),
		stripConversationInternalBackendState(overlay),
	)
	merged = conversationBackendStateWithKnownThreadRefs(merged, knownThreadRefs)
	merged = conversationBackendStateWithCurrentThreadRef(merged, currentRef, fallbackWorkspaceID)
	return conversationBackendStateWithVersion(merged, version)
}

func formatConversationThreadRef(ref botThreadRef, defaultWorkspaceID string) string {
	ref = normalizeBotThreadRef(ref, defaultWorkspaceID)
	if ref.ThreadID == "" {
		return ""
	}
	if ref.WorkspaceID == "" || ref.WorkspaceID == strings.TrimSpace(defaultWorkspaceID) {
		return ref.ThreadID
	}
	return ref.WorkspaceID + botConversationThreadDisplaySep + ref.ThreadID
}

func parseConversationThreadSelectionRef(selection string, fallbackWorkspaceID string) botThreadRef {
	selection = strings.TrimSpace(selection)
	if selection == "" {
		return botThreadRef{}
	}
	if workspaceID, threadID, ok := strings.Cut(selection, botConversationThreadDisplaySep); ok {
		workspaceID = strings.TrimSpace(workspaceID)
		threadID = strings.TrimSpace(threadID)
		if workspaceID != "" && threadID != "" {
			return normalizeBotThreadRef(botThreadRef{
				WorkspaceID: workspaceID,
				ThreadID:    threadID,
			}, fallbackWorkspaceID)
		}
	}
	return normalizeBotThreadRef(botThreadRef{ThreadID: selection}, fallbackWorkspaceID)
}

func matchConversationThreadSelection(ref botThreadRef, selection string, defaultWorkspaceID string) bool {
	ref = normalizeBotThreadRef(ref, defaultWorkspaceID)
	selection = strings.TrimSpace(selection)
	if ref.ThreadID == "" || selection == "" {
		return false
	}
	if selection == ref.ThreadID {
		return true
	}
	return selection == formatConversationThreadRef(ref, defaultWorkspaceID)
}

func stripConversationInternalBackendState(state map[string]string) map[string]string {
	if len(state) == 0 {
		return nil
	}

	next := make(map[string]string, len(state))
	for key, value := range state {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == botConversationContextKey ||
			trimmedKey == botConversationThreadListKey ||
			trimmedKey == botConversationCurrentThreadKey ||
			trimmedKey == botConversationPendingStartKey {
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

	pending := s.pendingApprovalsForConversation(connection, conversation)
	switch command.kind {
	case "list":
		text := renderPendingApprovalsForBotWithRefs(
			pending,
			s.currentConversationThreadRef(connection, conversation),
			s.conversationThreadRefs(connection, conversation),
			connection.WorkspaceID,
		)
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
		targetWorkspaceID := s.conversationExecutionWorkspaceID(connection, conversation)
		updatedConversation, text, commandErr := s.startNewConversationThread(
			ctx,
			connection,
			conversation,
			inbound,
			command.title,
			targetWorkspaceID,
		)
		if commandErr == nil {
			updatedConversation, commandErr = s.ensureConversationSessionBindingTarget(
				connection,
				updatedConversation,
				targetWorkspaceID,
				updatedConversation.ThreadID,
				firstNonEmpty(strings.TrimSpace(command.title), "Session Binding"),
			)
		}
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
		currentRef := s.currentConversationThreadRef(connection, conversation)
		updatedConversation, text, commandErr := s.archiveConversationThread(ctx, connection, conversation)
		if commandErr == nil {
			updatedConversation, commandErr = s.ensureConversationSessionBindingTarget(
				connection,
				updatedConversation,
				currentRef.WorkspaceID,
				"",
				"Session Binding",
			)
		}
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
		targetWorkspaceID := s.conversationExecutionWorkspaceID(connection, conversation)
		selectedRef, resolveErr := s.resolveConversationThreadSelectionRef(ctx, connection, conversation, command.threadID, "active", targetWorkspaceID)
		if resolveErr != nil {
			text := "The bot could not switch threads right now: " + resolveErr.Error()
			return true, conversation, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}
		updatedConversation, text, commandErr := s.switchConversationThread(
			ctx,
			connection,
			conversation,
			selectedRef.ThreadID,
			selectedRef.WorkspaceID,
		)
		if commandErr == nil {
			updatedConversation, commandErr = s.ensureConversationSessionBindingTarget(
				connection,
				updatedConversation,
				selectedRef.WorkspaceID,
				updatedConversation.ThreadID,
				"Session Binding",
			)
		}
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
	return renderPendingApprovalsForBotWithRefs(
		items,
		botThreadRef{ThreadID: currentThreadID},
		nil,
		"",
	)
}

func renderPendingApprovalsForBotWithRefs(
	items []store.PendingApproval,
	currentThreadRef botThreadRef,
	knownThreadRefs []botThreadRef,
	defaultWorkspaceID string,
) string {
	if len(items) == 0 {
		return "No pending approvals right now."
	}

	ordered := prioritizePendingApprovalsWithRefs(items, currentThreadRef, knownThreadRefs)
	lines := []string{"Pending approvals:"}
	limit := minInt(len(ordered), 6)
	for index := 0; index < limit; index++ {
		approval := ordered[index]
		lines = append(lines, formatPendingApprovalLineWithWorkspace(index+1, approval, defaultWorkspaceID))
		for _, helpLine := range approvalCommandHelpLines(approval) {
			lines = append(lines, helpLine)
		}
	}
	if len(ordered) > limit {
		lines = append(lines, "+"+intToString(len(ordered)-limit)+" more pending approval(s)")
	}

	return strings.Join(lines, "\n")
}

func (s *Service) approvalWorkspaceIDsForConversation(connection store.BotConnection, conversation store.BotConversation) []string {
	workspaceIDs := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)
	appendWorkspaceID := func(workspaceID string) {
		workspaceID = strings.TrimSpace(workspaceID)
		if workspaceID == "" {
			return
		}
		if _, ok := seen[workspaceID]; ok {
			return
		}
		seen[workspaceID] = struct{}{}
		workspaceIDs = append(workspaceIDs, workspaceID)
	}

	appendWorkspaceID(s.conversationExecutionWorkspaceID(connection, conversation))
	appendWorkspaceID(s.currentConversationThreadRef(connection, conversation).WorkspaceID)
	for _, threadRef := range s.conversationThreadRefs(connection, conversation) {
		appendWorkspaceID(threadRef.WorkspaceID)
	}
	return workspaceIDs
}

func (s *Service) pendingApprovalsForConversation(connection store.BotConnection, conversation store.BotConversation) []store.PendingApproval {
	if s.approvals == nil {
		return nil
	}

	workspaceIDs := s.approvalWorkspaceIDsForConversation(connection, conversation)
	if len(workspaceIDs) == 0 {
		return nil
	}

	items := make([]store.PendingApproval, 0)
	seen := make(map[string]struct{})
	for _, workspaceID := range workspaceIDs {
		for _, approval := range s.approvals.List(workspaceID) {
			requestID := strings.TrimSpace(approval.ID)
			if requestID != "" {
				if _, ok := seen[requestID]; ok {
					continue
				}
				seen[requestID] = struct{}{}
			}
			items = append(items, approval)
		}
	}
	return items
}

func (s *Service) conversationExecutionWorkspaceID(connection store.BotConnection, conversation store.BotConversation) string {
	executionConnection, _ := s.resolveConversationExecutionContext(connection, conversation)
	return firstNonEmpty(
		strings.TrimSpace(executionConnection.WorkspaceID),
		strings.TrimSpace(conversation.WorkspaceID),
		strings.TrimSpace(connection.WorkspaceID),
	)
}

func (s *Service) currentConversationThreadRef(connection store.BotConnection, conversation store.BotConversation) botThreadRef {
	fallbackWorkspaceID := firstNonEmpty(
		strings.TrimSpace(conversation.WorkspaceID),
		strings.TrimSpace(connection.WorkspaceID),
	)
	binding, hasBinding := s.resolveConversationBinding(conversation)
	return resolveConversationCurrentThreadRef(conversation, binding, hasBinding, fallbackWorkspaceID)
}

func resolveConversationCurrentThreadRef(
	conversation store.BotConversation,
	binding store.BotBinding,
	hasBinding bool,
	fallbackWorkspaceID string,
) botThreadRef {
	fallbackWorkspaceID = firstNonEmpty(
		strings.TrimSpace(fallbackWorkspaceID),
		strings.TrimSpace(conversation.WorkspaceID),
	)
	currentThreadID := strings.TrimSpace(conversation.ThreadID)
	storedRef := resolveStoredConversationCurrentThreadRef(conversation.BackendState, currentThreadID, fallbackWorkspaceID)
	if !hasBinding {
		if storedRef.ThreadID != "" {
			return storedRef
		}
		return normalizeBotThreadRef(botThreadRef{
			WorkspaceID: fallbackWorkspaceID,
			ThreadID:    currentThreadID,
		}, fallbackWorkspaceID)
	}

	targetWorkspaceID := firstNonEmpty(strings.TrimSpace(binding.TargetWorkspaceID), fallbackWorkspaceID)
	switch normalizeBotBindingMode(binding.BindingMode, binding.AIBackend) {
	case "fixed_thread":
		if targetThreadID := strings.TrimSpace(binding.TargetThreadID); targetThreadID != "" {
			return normalizeBotThreadRef(botThreadRef{
				WorkspaceID: targetWorkspaceID,
				ThreadID:    targetThreadID,
			}, fallbackWorkspaceID)
		}
		if storedRef.ThreadID != "" {
			return storedRef
		}
		return normalizeBotThreadRef(botThreadRef{
			WorkspaceID: targetWorkspaceID,
			ThreadID:    currentThreadID,
		}, fallbackWorkspaceID)
	case "workspace_auto_thread":
		if storedRef.ThreadID != "" {
			return storedRef
		}
		if currentThreadID != "" {
			return normalizeBotThreadRef(botThreadRef{
				WorkspaceID: targetWorkspaceID,
				ThreadID:    currentThreadID,
			}, fallbackWorkspaceID)
		}
		return normalizeBotThreadRef(botThreadRef{
			WorkspaceID: targetWorkspaceID,
			ThreadID:    strings.TrimSpace(binding.TargetThreadID),
		}, fallbackWorkspaceID)
	default:
		if storedRef.ThreadID != "" {
			return storedRef
		}
		return normalizeBotThreadRef(botThreadRef{
			WorkspaceID: fallbackWorkspaceID,
			ThreadID:    currentThreadID,
		}, fallbackWorkspaceID)
	}
}

func (s *Service) conversationThreadRefs(connection store.BotConnection, conversation store.BotConversation) []botThreadRef {
	fallbackWorkspaceID := firstNonEmpty(
		strings.TrimSpace(conversation.WorkspaceID),
		strings.TrimSpace(connection.WorkspaceID),
	)
	refs := append([]botThreadRef(nil), knownConversationThreadRefsFromState(conversation.BackendState, fallbackWorkspaceID)...)
	currentRef := s.currentConversationThreadRef(connection, conversation)
	return appendBotThreadRef(refs, currentRef, fallbackWorkspaceID)
}

func (s *Service) ensureConversationSessionBindingTarget(
	connection store.BotConnection,
	conversation store.BotConversation,
	targetWorkspaceID string,
	targetThreadID string,
	preferredName string,
) (store.BotConversation, error) {
	targetWorkspaceID = firstNonEmpty(
		strings.TrimSpace(targetWorkspaceID),
		strings.TrimSpace(conversation.WorkspaceID),
		strings.TrimSpace(connection.WorkspaceID),
	)
	targetThreadID = strings.TrimSpace(targetThreadID)

	botID := firstNonEmpty(strings.TrimSpace(conversation.BotID), strings.TrimSpace(connection.BotID))
	if botID == "" {
		return store.BotConversation{}, store.ErrBotNotFound
	}

	bindingID := strings.TrimSpace(conversation.BindingID)
	switch {
	case bindingID != "":
		if _, ok := s.store.GetBotBinding(conversation.WorkspaceID, bindingID); ok {
			if _, err := s.store.UpdateBotBinding(conversation.WorkspaceID, bindingID, func(current store.BotBinding) store.BotBinding {
				current.Name = firstNonEmpty(strings.TrimSpace(current.Name), firstNonEmpty(strings.TrimSpace(preferredName), "Session Binding"))
				current.BindingMode = "fixed_thread"
				current.TargetWorkspaceID = targetWorkspaceID
				current.TargetThreadID = targetThreadID
				current.AIBackend = normalizeAIBackendName(connection.AIBackend)
				current.AIConfig = cloneStringMapLocal(connection.AIConfig)
				return current
			}); err != nil {
				return store.BotConversation{}, err
			}
			return s.store.UpdateBotConversation(conversation.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
				current.BotID = firstNonEmpty(strings.TrimSpace(current.BotID), botID)
				current.BindingID = bindingID
				return current
			})
		}
	}

	sessionBinding, err := s.store.CreateBotBinding(store.BotBinding{
		ID:                store.NewID("bbd"),
		WorkspaceID:       conversation.WorkspaceID,
		BotID:             botID,
		Name:              firstNonEmpty(strings.TrimSpace(preferredName), "Session Binding"),
		BindingMode:       "fixed_thread",
		TargetWorkspaceID: targetWorkspaceID,
		TargetThreadID:    targetThreadID,
		AIBackend:         normalizeAIBackendName(connection.AIBackend),
		AIConfig:          cloneStringMapLocal(connection.AIConfig),
	})
	if err != nil {
		return store.BotConversation{}, err
	}

	return s.store.UpdateBotConversation(conversation.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		current.BotID = firstNonEmpty(strings.TrimSpace(current.BotID), botID)
		current.BindingID = sessionBinding.ID
		return current
	})
}

func (s *Service) startNewConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
	title string,
	targetWorkspaceID string,
) (store.BotConversation, string, error) {
	nextContextVersion := conversationContextVersion(conversation) + 1
	nextThreadID := ""
	responseText := "Started a new conversation context. Future messages in this chat will use a fresh backend session."
	targetWorkspaceID = firstNonEmpty(strings.TrimSpace(targetWorkspaceID), strings.TrimSpace(connection.WorkspaceID))
	currentRef := s.currentConversationThreadRef(connection, conversation)

	if normalizeAIBackendName(connection.AIBackend) == defaultAIBackend {
		if s.threads == nil {
			return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
		}

		thread, err := s.threads.Create(ctx, targetWorkspaceID, threads.CreateInput{
			Name:               buildThreadNameWithTarget(connection, firstNonEmpty(strings.TrimSpace(title), strings.TrimSpace(inbound.Title), strings.TrimSpace(inbound.Username), strings.TrimSpace(inbound.ConversationID))),
			Model:              strings.TrimSpace(connection.AIConfig["model"]),
			SessionStartSource: pendingConversationSessionStartSource(conversation.BackendState),
		})
		if err != nil {
			return store.BotConversation{}, "", err
		}
		nextThreadID = thread.ID
		nextThreadRef := botThreadRef{WorkspaceID: targetWorkspaceID, ThreadID: nextThreadID}
		responseLines := []string{"Started a new workspace thread: " + formatConversationThreadRef(nextThreadRef, connection.WorkspaceID)}
		if strings.TrimSpace(thread.Name) != "" {
			responseLines = append(responseLines, "Name: "+strings.TrimSpace(thread.Name))
		}
		responseLines = append(responseLines, "Future messages in this chat will use the new thread.")
		responseText = strings.Join(responseLines, "\n")
	}

	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadRefs := knownConversationThreadRefsFromState(current.BackendState, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, currentRef, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, botThreadRef{
			WorkspaceID: targetWorkspaceID,
			ThreadID:    nextThreadID,
		}, targetWorkspaceID)
		current.ThreadID = strings.TrimSpace(nextThreadID)
		current.BackendState = conversationBackendStateWithCurrentThreadRef(
			conversationBackendStateWithKnownThreadRefs(nil, knownThreadRefs),
			botThreadRef{
				WorkspaceID: targetWorkspaceID,
				ThreadID:    nextThreadID,
			},
			targetWorkspaceID,
		)
		current.BackendState = conversationBackendStateWithVersion(current.BackendState, nextContextVersion)
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
	targetWorkspaceID string,
) (store.BotConversation, string, error) {
	targetWorkspaceID = firstNonEmpty(strings.TrimSpace(targetWorkspaceID), strings.TrimSpace(connection.WorkspaceID))
	selectedRef, err := s.resolveConversationThreadSelectionRef(ctx, connection, conversation, selection, "active", targetWorkspaceID)
	if err != nil {
		return store.BotConversation{}, "", err
	}
	if selectedRef.ThreadID == "" {
		return store.BotConversation{}, "", errors.New("thread id is required")
	}
	if normalizeAIBackendName(connection.AIBackend) == defaultAIBackend {
		if s.threads == nil {
			return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
		}
		if _, err := s.threads.GetDetail(ctx, selectedRef.WorkspaceID, selectedRef.ThreadID); err != nil {
			return store.BotConversation{}, "", err
		}
	}

	nextContextVersion := conversationContextVersion(conversation) + 1
	currentRef := s.currentConversationThreadRef(connection, conversation)
	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadRefs := knownConversationThreadRefsFromState(current.BackendState, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, currentRef, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, selectedRef, current.WorkspaceID)
		current.ThreadID = selectedRef.ThreadID
		current.BackendState = conversationBackendStateWithCurrentThreadRef(
			conversationBackendStateWithKnownThreadRefs(nil, knownThreadRefs),
			selectedRef,
			current.WorkspaceID,
		)
		current.BackendState = conversationBackendStateWithVersion(current.BackendState, nextContextVersion)
		return current
	})
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "switched conversation thread",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", selectedRef.ThreadID),
		slog.String("threadWorkspaceId", selectedRef.WorkspaceID),
		slog.Int("contextVersion", conversationContextVersion(updatedConversation)),
	)

	return updatedConversation, "Switched the current conversation to thread: " + formatConversationThreadRef(selectedRef, connection.WorkspaceID), nil
}

func (s *Service) renameConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	title string,
) (store.BotConversation, string, error) {
	currentRef := s.currentConversationThreadRef(connection, conversation)
	if currentRef.ThreadID == "" {
		return store.BotConversation{}, "", errors.New("this conversation is not currently bound to a workspace thread")
	}
	if s.threads == nil {
		return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
	}
	thread, err := s.threads.Rename(ctx, currentRef.WorkspaceID, currentRef.ThreadID, strings.TrimSpace(title))
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "renamed conversation thread",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("threadId", currentRef.ThreadID),
		slog.String("threadWorkspaceId", currentRef.WorkspaceID),
		slog.String("threadName", strings.TrimSpace(thread.Name)),
	)

	return conversation, "Renamed the current thread to: " + strings.TrimSpace(thread.Name), nil
}

func (s *Service) archiveConversationThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (store.BotConversation, string, error) {
	currentRef := s.currentConversationThreadRef(connection, conversation)
	if currentRef.ThreadID == "" {
		return store.BotConversation{}, "", errors.New("this conversation is not currently bound to a workspace thread")
	}
	if s.threads == nil {
		return store.BotConversation{}, "", errors.New("workspace thread service is not configured")
	}
	thread, err := s.threads.Archive(ctx, currentRef.WorkspaceID, currentRef.ThreadID)
	if err != nil {
		return store.BotConversation{}, "", err
	}

	nextContextVersion := conversationContextVersion(conversation) + 1
	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadRefs := knownConversationThreadRefsFromState(current.BackendState, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, currentRef, current.WorkspaceID)
		current.ThreadID = ""
		current.BackendState = conversationBackendStateWithCurrentThreadRef(
			conversationBackendStateWithKnownThreadRefs(nil, knownThreadRefs),
			botThreadRef{},
			current.WorkspaceID,
		)
		current.BackendState = conversationBackendStateWithVersion(current.BackendState, nextContextVersion)
		return current
	})
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "archived conversation thread",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", currentRef.ThreadID),
		slog.String("threadWorkspaceId", currentRef.WorkspaceID),
		slog.Bool("archived", thread.Archived),
		slog.Int("contextVersion", conversationContextVersion(updatedConversation)),
	)

	return updatedConversation, "Archived the current thread: " + formatConversationThreadRef(currentRef, connection.WorkspaceID) + "\nFuture messages in this chat will require /newthread or /thread use.", nil
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

	targetWorkspaceID := s.conversationExecutionWorkspaceID(connection, conversation)
	selectedRef, err := s.resolveConversationThreadSelectionRef(ctx, connection, conversation, selection, "archived", targetWorkspaceID)
	if err != nil {
		return store.BotConversation{}, "", err
	}
	thread, err := s.threads.Unarchive(ctx, selectedRef.WorkspaceID, selectedRef.ThreadID)
	if err != nil {
		return store.BotConversation{}, "", err
	}

	currentRef := s.currentConversationThreadRef(connection, conversation)
	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadRefs := knownConversationThreadRefsFromState(current.BackendState, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, currentRef, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, selectedRef, current.WorkspaceID)
		current.BackendState = mergeConversationBackendState(
			current.BackendState,
			conversationBackendStateWithKnownThreadRefs(nil, knownThreadRefs),
			conversationContextVersion(current),
			current.WorkspaceID,
		)
		return current
	})
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "unarchived conversation thread",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", selectedRef.ThreadID),
		slog.String("threadWorkspaceId", selectedRef.WorkspaceID),
		slog.Bool("archived", thread.Archived),
	)

	formattedRef := formatConversationThreadRef(selectedRef, connection.WorkspaceID)
	return updatedConversation, "Unarchived thread: " + formattedRef + "\nUse /thread use " + formattedRef + " to switch this conversation back.", nil
}

func (s *Service) clearConversationThreadBinding(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (store.BotConversation, string, error) {
	currentRef := s.currentConversationThreadRef(connection, conversation)
	if currentRef.ThreadID == "" {
		return conversation, "This conversation is not currently bound to a workspace thread.", nil
	}

	nextContextVersion := conversationContextVersion(conversation) + 1
	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadRefs := knownConversationThreadRefsFromState(current.BackendState, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, currentRef, current.WorkspaceID)
		current.ThreadID = ""
		current.BackendState = conversationBackendStateWithCurrentThreadRef(
			conversationBackendStateWithKnownThreadRefs(nil, knownThreadRefs),
			botThreadRef{},
			current.WorkspaceID,
		)
		current.BackendState = conversationBackendStateWithVersion(current.BackendState, nextContextVersion)
		current.BackendState = conversationBackendStateWithPendingSessionStartSource(
			current.BackendState,
			threads.ThreadStartSourceClear,
		)
		return current
	})
	if err != nil {
		return store.BotConversation{}, "", err
	}

	logBotDebug(ctx, connection, "cleared conversation thread binding",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", currentRef.ThreadID),
		slog.String("threadWorkspaceId", currentRef.WorkspaceID),
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
	currentRef := s.currentConversationThreadRef(connection, conversation)
	threadRefs := s.conversationThreadRefs(connection, conversation)
	approvalSummaries := s.pendingApprovalSummariesByThreadRefs(threadRefs)
	if currentRef.ThreadID == "" {
		lines := []string{
			"This conversation is not currently bound to a workspace thread.",
			"Use /newthread to start a new thread.",
		}
		if activeThreadRefs := s.orderedConversationThreadRefsForDisplay(ctx, connection, conversation, "active", approvalSummaries); len(activeThreadRefs) > 0 {
			lines = append(lines, formatThreadListHint("active", len(activeThreadRefs)))
		}
		if archivedThreadRefs := s.orderedConversationThreadRefsForDisplay(ctx, connection, conversation, "archived", approvalSummaries); len(archivedThreadRefs) > 0 {
			lines = append(lines, formatThreadListHint("archived", len(archivedThreadRefs)))
		}
		return strings.Join(lines, "\n")
	}

	lines := []string{
		"Current workspace thread: " + formatConversationThreadRef(currentRef, connection.WorkspaceID),
	}
	if summary, ok := s.lookupConversationThreadSummaryRef(ctx, connection, currentRef); ok {
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
	if pendingSummary, ok := approvalSummaries[botThreadRefKey(currentRef)]; ok && pendingSummary.Count > 0 {
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
	threadRefs := s.conversationThreadRefs(connection, conversation)
	approvalSummaries := s.pendingApprovalSummariesByThreadRefs(threadRefs)
	orderedThreadRefs := s.orderedConversationThreadRefsForDisplay(ctx, connection, conversation, filter, approvalSummaries)
	if len(orderedThreadRefs) == 0 {
		switch filter {
		case "active":
			return "No active workspace threads are currently recorded for this conversation."
		case "archived":
			return "No archived workspace threads are currently recorded for this conversation."
		default:
			return "No workspace threads have been recorded for this conversation yet."
		}
	}

	currentRef := s.currentConversationThreadRef(connection, conversation)
	currentRefKey := botThreadRefKey(currentRef)
	heading := "Known workspace threads (current first, then recent approvals/activity):"
	switch filter {
	case "active":
		heading = "Known active workspace threads (current first, then recent approvals/activity):"
	case "archived":
		heading = "Known archived workspace threads (recent approvals/activity first):"
	}

	lines := []string{heading}
	for index, threadRef := range orderedThreadRefs {
		threadLabel := formatConversationThreadRef(threadRef, connection.WorkspaceID)
		line := fmt.Sprintf("%d. %s", index+1, threadLabel)
		if botThreadRefKey(threadRef) == currentRefKey {
			line += " (current)"
		}
		if summary, ok := s.lookupConversationThreadSummaryRef(ctx, connection, threadRef); ok {
			if summary.Archived {
				line += " (archived)"
			}
			if strings.TrimSpace(summary.Name) != "" {
				line += " | " + summary.Name
			}
			if preview := formatBotThreadPreview(summary.Preview); preview != "" {
				line += " | " + preview
			}
			if pendingSummary, ok := approvalSummaries[botThreadRefKey(threadRef)]; ok && pendingSummary.Count > 0 {
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
	ref, err := s.resolveConversationThreadSelectionRef(
		ctx,
		connection,
		conversation,
		selection,
		filter,
		s.conversationExecutionWorkspaceID(connection, conversation),
	)
	if err != nil {
		return "", err
	}
	return ref.ThreadID, nil
}

func (s *Service) resolveConversationThreadSelectionRef(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	selection string,
	filter string,
	fallbackWorkspaceID string,
) (botThreadRef, error) {
	selection = strings.TrimSpace(selection)
	if selection == "" {
		return botThreadRef{}, errors.New("thread id is required")
	}

	filter = normalizeConversationThreadFilter(filter)
	threadRefs := s.conversationThreadRefs(connection, conversation)
	approvalSummaries := s.pendingApprovalSummariesByThreadRefs(threadRefs)
	allThreadRefs := s.orderedConversationThreadRefsForDisplay(ctx, connection, conversation, "all", approvalSummaries)
	filteredThreadRefs := s.orderedConversationThreadRefsForDisplay(ctx, connection, conversation, filter, approvalSummaries)

	findSelectionMatches := func(candidates []botThreadRef) ([]botThreadRef, error) {
		matches := make([]botThreadRef, 0, 1)
		for _, candidate := range candidates {
			if !matchConversationThreadSelection(candidate, selection, connection.WorkspaceID) {
				continue
			}
			matches = appendBotThreadRef(matches, candidate, candidate.WorkspaceID)
		}
		if len(matches) > 1 {
			return nil, fmt.Errorf("thread selection %q matches multiple known threads; use /thread list and select by index or workspace-prefixed id", selection)
		}
		return matches, nil
	}

	if matches, err := findSelectionMatches(filteredThreadRefs); err != nil {
		return botThreadRef{}, err
	} else if len(matches) == 1 {
		return matches[0], nil
	}

	if matches, err := findSelectionMatches(allThreadRefs); err != nil {
		return botThreadRef{}, err
	} else if len(matches) == 1 {
		if err := s.validateConversationThreadSelectionFilter(ctx, connection, matches[0], filter); err != nil {
			return botThreadRef{}, err
		}
		return matches[0], nil
	}

	index, err := strconv.Atoi(selection)
	if err == nil && index >= 1 && index <= len(filteredThreadRefs) {
		return filteredThreadRefs[index-1], nil
	}
	if err == nil && index >= 1 && index <= len(allThreadRefs) {
		threadRef := allThreadRefs[index-1]
		if err := s.validateConversationThreadSelectionFilter(ctx, connection, threadRef, filter); err != nil {
			return botThreadRef{}, err
		}
		return threadRef, nil
	}

	if normalizeAIBackendName(connection.AIBackend) == defaultAIBackend && s.threads != nil {
		directRef := parseConversationThreadSelectionRef(
			selection,
			firstNonEmpty(
				strings.TrimSpace(fallbackWorkspaceID),
				s.conversationExecutionWorkspaceID(connection, conversation),
				strings.TrimSpace(connection.WorkspaceID),
			),
		)
		if detail, err := s.threads.GetDetail(ctx, directRef.WorkspaceID, directRef.ThreadID); err == nil {
			switch filter {
			case "active":
				if detail.Archived {
					return botThreadRef{}, fmt.Errorf("thread %q is archived; start a new thread or use an active thread instead", formatConversationThreadRef(directRef, connection.WorkspaceID))
				}
			case "archived":
				if !detail.Archived {
					return botThreadRef{}, fmt.Errorf("thread %q is already active", formatConversationThreadRef(directRef, connection.WorkspaceID))
				}
			}
			return directRef, nil
		}
	}

	return botThreadRef{}, s.unknownConversationThreadSelectionError(selection, filter)
}

func (s *Service) validateConversationThreadSelectionFilter(
	ctx context.Context,
	connection store.BotConnection,
	threadRef botThreadRef,
	filter string,
) error {
	summary, ok := s.lookupConversationThreadSummaryRef(ctx, connection, threadRef)
	if !ok {
		switch normalizeConversationThreadFilter(filter) {
		case "archived":
			return s.unknownConversationThreadSelectionError(formatConversationThreadRef(threadRef, connection.WorkspaceID), filter)
		default:
			return nil
		}
	}

	label := formatConversationThreadRef(threadRef, connection.WorkspaceID)
	switch normalizeConversationThreadFilter(filter) {
	case "active":
		if summary.Archived {
			return fmt.Errorf("thread %q is archived; start a new thread or use an active thread instead", label)
		}
	case "archived":
		if !summary.Archived {
			return fmt.Errorf("thread %q is already active", label)
		}
	}
	return nil
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
	threadRefs := s.filteredConversationThreadRefs(ctx, connection, conversation, filter)
	threadIDs := make([]string, 0, len(threadRefs))
	for _, threadRef := range threadRefs {
		threadIDs = append(threadIDs, threadRef.ThreadID)
	}
	return threadIDs
}

func (s *Service) filteredConversationThreadRefs(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	filter string,
) []botThreadRef {
	filter = normalizeConversationThreadFilter(filter)
	threadRefs := s.conversationThreadRefs(connection, conversation)
	if filter == "all" {
		return threadRefs
	}

	filtered := make([]botThreadRef, 0, len(threadRefs))
	for _, threadRef := range threadRefs {
		summary, ok := s.lookupConversationThreadSummaryRef(ctx, connection, threadRef)
		if !ok {
			if filter == "active" {
				filtered = append(filtered, threadRef)
			}
			continue
		}
		if filter == "archived" && summary.Archived {
			filtered = append(filtered, threadRef)
			continue
		}
		if filter == "active" && !summary.Archived {
			filtered = append(filtered, threadRef)
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
	threadRefs := s.orderedConversationThreadRefsForDisplay(ctx, connection, conversation, filter, approvalSummaries)
	threadIDs := make([]string, 0, len(threadRefs))
	for _, threadRef := range threadRefs {
		threadIDs = append(threadIDs, threadRef.ThreadID)
	}
	return threadIDs
}

func (s *Service) orderedConversationThreadRefsForDisplay(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	filter string,
	approvalSummaries map[string]botThreadApprovalSummary,
) []botThreadRef {
	threadRefs := s.filteredConversationThreadRefs(ctx, connection, conversation, filter)
	if len(threadRefs) <= 1 {
		return threadRefs
	}

	currentThreadRef := s.currentConversationThreadRef(connection, conversation)
	currentThreadKey := botThreadRefKey(currentThreadRef)
	type rankedThread struct {
		threadRef botThreadRef
		index     int
		isCurrent bool
		latestAt  time.Time
		updatedAt time.Time
	}

	ranked := make([]rankedThread, 0, len(threadRefs))
	for index, threadRef := range threadRefs {
		refKey := botThreadRefKey(threadRef)
		item := rankedThread{
			threadRef: threadRef,
			index:     index,
			isCurrent: refKey != "" && refKey == currentThreadKey,
		}
		if approvalSummary, ok := approvalSummaries[refKey]; ok {
			item.latestAt = approvalSummary.LatestAt
		}
		if summary, ok := s.lookupConversationThreadSummaryRef(ctx, connection, threadRef); ok {
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

	ordered := make([]botThreadRef, 0, len(ranked))
	for _, item := range ranked {
		ordered = append(ordered, item.threadRef)
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
	return s.lookupConversationThreadSummaryRef(ctx, connection, botThreadRef{
		WorkspaceID: connection.WorkspaceID,
		ThreadID:    threadID,
	})
}

func (s *Service) lookupConversationThreadSummaryRef(
	ctx context.Context,
	connection store.BotConnection,
	threadRef botThreadRef,
) (botThreadSummary, bool) {
	threadRef = normalizeBotThreadRef(threadRef, connection.WorkspaceID)
	if threadRef.ThreadID == "" || s.threads == nil {
		return botThreadSummary{}, false
	}

	detail, err := s.threads.GetDetail(ctx, threadRef.WorkspaceID, threadRef.ThreadID)
	if err != nil {
		return botThreadSummary{}, false
	}
	return botThreadSummary{
		ID:        threadRef.ThreadID,
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
	return s.pendingApprovalSummariesByThreadRefs([]botThreadRef{{WorkspaceID: workspaceID}})
}

func (s *Service) pendingApprovalSummariesByThreadRefs(threadRefs []botThreadRef) map[string]botThreadApprovalSummary {
	if s.approvals == nil {
		return nil
	}

	type accumulator struct {
		count             int
		kindCount         map[string]int
		latestRequestedAt time.Time
		latestSummary     string
	}

	workspaceIDs := make([]string, 0, len(threadRefs))
	seenWorkspaces := make(map[string]struct{}, len(threadRefs))
	for _, threadRef := range threadRefs {
		workspaceID := strings.TrimSpace(threadRef.WorkspaceID)
		if workspaceID == "" {
			continue
		}
		if _, ok := seenWorkspaces[workspaceID]; ok {
			continue
		}
		seenWorkspaces[workspaceID] = struct{}{}
		workspaceIDs = append(workspaceIDs, workspaceID)
	}
	if len(workspaceIDs) == 0 {
		return nil
	}

	accumulators := make(map[string]*accumulator)
	for _, workspaceID := range workspaceIDs {
		for _, item := range s.approvals.List(workspaceID) {
			threadRef := normalizeBotThreadRef(botThreadRef{
				WorkspaceID: item.WorkspaceID,
				ThreadID:    item.ThreadID,
			}, workspaceID)
			if threadRef.ThreadID == "" {
				continue
			}
			refKey := botThreadRefKey(threadRef)
			entry := accumulators[refKey]
			if entry == nil {
				entry = &accumulator{kindCount: make(map[string]int)}
				accumulators[refKey] = entry
			}
			entry.count += 1
			entry.kindCount[humanizeApprovalKind(item.Kind)] += 1
			if item.RequestedAt.After(entry.latestRequestedAt) || entry.latestRequestedAt.IsZero() {
				entry.latestRequestedAt = item.RequestedAt
				entry.latestSummary = strings.TrimSpace(item.Summary)
			}
		}
	}

	if len(accumulators) == 0 {
		return nil
	}

	summaries := make(map[string]botThreadApprovalSummary, len(accumulators))
	for refKey, entry := range accumulators {
		summaries[refKey] = botThreadApprovalSummary{
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
	return prioritizePendingApprovalsWithRefs(
		items,
		botThreadRef{ThreadID: currentThreadID},
		nil,
	)
}

func prioritizePendingApprovalsWithRefs(
	items []store.PendingApproval,
	currentThreadRef botThreadRef,
	knownThreadRefs []botThreadRef,
) []store.PendingApproval {
	if len(items) == 0 {
		return nil
	}

	ordered := append([]store.PendingApproval(nil), items...)
	currentThreadRef = normalizeBotThreadRef(currentThreadRef, "")
	currentThreadKey := botThreadRefKey(currentThreadRef)
	knownThreadKeys := make(map[string]struct{}, len(knownThreadRefs))
	for _, threadRef := range knownThreadRefs {
		threadKey := botThreadRefKey(threadRef)
		if threadKey == "" {
			continue
		}
		knownThreadKeys[threadKey] = struct{}{}
	}

	type rankedApproval struct {
		item         store.PendingApproval
		index        int
		isCurrent    bool
		isKnown      bool
		requestedAt  time.Time
		threadHasRef bool
	}

	ranked := make([]rankedApproval, 0, len(ordered))
	for index, item := range ordered {
		threadRef := normalizeBotThreadRef(botThreadRef{
			WorkspaceID: item.WorkspaceID,
			ThreadID:    item.ThreadID,
		}, "")
		threadKey := botThreadRefKey(threadRef)
		_, isKnown := knownThreadKeys[threadKey]
		ranked = append(ranked, rankedApproval{
			item:         item,
			index:        index,
			isCurrent:    currentThreadKey != "" && threadKey == currentThreadKey,
			isKnown:      threadKey != "" && isKnown,
			requestedAt:  item.RequestedAt,
			threadHasRef: threadKey != "",
		})
	}

	sort.SliceStable(ranked, func(i int, j int) bool {
		left := ranked[i]
		right := ranked[j]
		if left.isCurrent != right.isCurrent {
			return left.isCurrent
		}
		if left.isKnown != right.isKnown {
			return left.isKnown
		}
		if left.threadHasRef != right.threadHasRef {
			return left.threadHasRef
		}
		if !left.requestedAt.Equal(right.requestedAt) {
			if left.requestedAt.IsZero() != right.requestedAt.IsZero() {
				return !left.requestedAt.IsZero()
			}
			return left.requestedAt.After(right.requestedAt)
		}
		return left.index < right.index
	})

	for index, item := range ranked {
		ordered[index] = item.item
	}
	return ordered
}

func formatPendingApprovalLine(index int, approval store.PendingApproval) string {
	return formatPendingApprovalLineWithWorkspace(index, approval, "")
}

func formatPendingApprovalLineWithWorkspace(index int, approval store.PendingApproval, defaultWorkspaceID string) string {
	parts := []string{
		intToString(index) + ".",
		approval.ID,
		"(" + humanizeApprovalKind(approval.Kind) + ")",
		strings.TrimSpace(approval.Summary),
	}
	threadRef := normalizeBotThreadRef(botThreadRef{
		WorkspaceID: approval.WorkspaceID,
		ThreadID:    approval.ThreadID,
	}, "")
	if threadRef.ThreadID != "" {
		parts = append(parts, "thread="+formatConversationThreadRef(threadRef, defaultWorkspaceID))
	} else if workspaceID := strings.TrimSpace(approval.WorkspaceID); workspaceID != "" && workspaceID != strings.TrimSpace(defaultWorkspaceID) {
		parts = append(parts, "workspace="+workspaceID)
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

func (s *Service) acceptOrBufferInboundMessage(connection store.BotConnection, message InboundMessage) (bool, error) {
	if !shouldBufferTelegramMediaGroupMessage(connection, message) {
		return s.acceptInboundMessage(connection, message)
	}
	return s.bufferTelegramMediaGroupMessage(connection, message), nil
}

func shouldBufferTelegramMediaGroupMessage(connection store.BotConnection, message InboundMessage) bool {
	if normalizeProviderName(connection.Provider) != telegramProviderName {
		return false
	}
	if len(message.Media) == 0 {
		return false
	}
	return strings.TrimSpace(message.ProviderData[telegramMediaGroupIDProviderDataKey]) != ""
}

func (s *Service) bufferTelegramMediaGroupMessage(connection store.BotConnection, message InboundMessage) bool {
	groupID := strings.TrimSpace(message.ProviderData[telegramMediaGroupIDProviderDataKey])
	if groupID == "" {
		return false
	}

	itemKey := telegramMediaGroupItemKey(message)
	bufferKey := telegramMediaGroupBufferKey(connection.ID, message.ConversationID, groupID)
	delay := s.telegramMediaGroupQuietPeriodValue()

	s.mu.Lock()
	seenState := s.telegramMediaGroupSeen[bufferKey]
	if seenState != nil {
		if _, exists := seenState.itemKeys[itemKey]; exists {
			s.mu.Unlock()
			return false
		}
	}

	buffer, ok := s.telegramMediaGroups[bufferKey]
	if !ok {
		buffer = &telegramMediaGroupBuffer{
			connection: cloneBotConnectionStoreValue(connection),
			groupID:    groupID,
			messages:   map[string]InboundMessage{itemKey: cloneInboundMessageValue(message)},
			lateBatch:  seenState != nil && len(seenState.itemKeys) > 0,
		}
		buffer.revision = 1
		s.telegramMediaGroups[bufferKey] = buffer
		revision := buffer.revision
		lateBatch := buffer.lateBatch
		s.mu.Unlock()

		if lateBatch {
			s.appendConnectionLog(
				connection.WorkspaceID,
				connection.ID,
				"warning",
				"telegram_media_group_split_detected",
				fmt.Sprintf(
					"Telegram media group %s for conversation %s received new items after an earlier batch had already been flushed. Processing the late items as a follow-up batch.",
					firstNonEmpty(groupID, "unknown"),
					firstNonEmpty(strings.TrimSpace(message.ConversationID), "unknown"),
				),
			)
		}

		time.AfterFunc(delay, func() {
			s.flushTelegramMediaGroupBuffer(bufferKey, revision)
		})
		return true
	}

	if _, exists := buffer.messages[itemKey]; exists {
		s.mu.Unlock()
		return false
	}

	buffer.messages[itemKey] = cloneInboundMessageValue(message)
	buffer.revision += 1
	revision := buffer.revision
	s.mu.Unlock()

	time.AfterFunc(delay, func() {
		s.flushTelegramMediaGroupBuffer(bufferKey, revision)
	})
	return false
}

func (s *Service) flushTelegramMediaGroupBuffer(bufferKey string, expectedRevision int) {
	s.mu.Lock()
	buffer, ok := s.telegramMediaGroups[bufferKey]
	if !ok || buffer.revision != expectedRevision {
		s.mu.Unlock()
		return
	}
	delete(s.telegramMediaGroups, bufferKey)
	connection := cloneBotConnectionStoreValue(buffer.connection)
	message := aggregateTelegramMediaGroupMessages(buffer.groupID, buffer.messages, buffer.lateBatch)
	itemKeys := telegramMediaGroupSeenKeys(buffer.messages)
	seenRevision := s.rememberTelegramMediaGroupSeenKeysLocked(bufferKey, itemKeys)
	s.mu.Unlock()

	time.AfterFunc(s.telegramMediaGroupSeenTTLValue(), func() {
		s.evictTelegramMediaGroupSeenState(bufferKey, seenRevision)
	})

	if _, err := s.acceptInboundMessage(connection, message); err != nil {
		s.clearTelegramMediaGroupSeenState(bufferKey, seenRevision)
		s.appendConnectionLog(
			connection.WorkspaceID,
			connection.ID,
			"warning",
			"telegram_media_group_flush_failed",
			fmt.Sprintf(
				"Failed to persist aggregated Telegram media group %s for conversation %s: %v",
				firstNonEmpty(strings.TrimSpace(buffer.groupID), "unknown"),
				firstNonEmpty(strings.TrimSpace(message.ConversationID), "unknown"),
				err,
			),
		)
	}
}

func (s *Service) telegramMediaGroupQuietPeriodValue() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.telegramMediaGroupQuiet > 0 {
		return s.telegramMediaGroupQuiet
	}
	return defaultTelegramMediaGroupQuietTime
}

func (s *Service) telegramMediaGroupSeenTTLValue() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.telegramMediaGroupSeenTTL > 0 {
		return s.telegramMediaGroupSeenTTL
	}
	return defaultTelegramMediaGroupSeenTTL
}

func (s *Service) rememberTelegramMediaGroupSeenKeysLocked(bufferKey string, itemKeys []string) int {
	state, ok := s.telegramMediaGroupSeen[bufferKey]
	if !ok {
		state = &telegramMediaGroupSeenState{
			itemKeys: make(map[string]struct{}, len(itemKeys)),
		}
		s.telegramMediaGroupSeen[bufferKey] = state
	}
	for _, itemKey := range itemKeys {
		if trimmed := strings.TrimSpace(itemKey); trimmed != "" {
			state.itemKeys[trimmed] = struct{}{}
		}
	}
	state.revision += 1
	return state.revision
}

func (s *Service) evictTelegramMediaGroupSeenState(bufferKey string, expectedRevision int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, ok := s.telegramMediaGroupSeen[bufferKey]
	if !ok || state.revision != expectedRevision {
		return
	}
	delete(s.telegramMediaGroupSeen, bufferKey)
}

func (s *Service) clearTelegramMediaGroupSeenState(bufferKey string, expectedRevision int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, ok := s.telegramMediaGroupSeen[bufferKey]
	if !ok || state.revision != expectedRevision {
		return
	}
	delete(s.telegramMediaGroupSeen, bufferKey)
}

func telegramMediaGroupBufferKey(connectionID string, conversationID string, groupID string) string {
	return strings.TrimSpace(connectionID) + "\x00" + strings.TrimSpace(conversationID) + "\x00" + strings.TrimSpace(groupID)
}

func telegramMediaGroupItemKey(message InboundMessage) string {
	if messageID := strings.TrimSpace(message.MessageID); messageID != "" {
		return messageID
	}
	signature := strings.Builder{}
	signature.WriteString(strings.TrimSpace(message.Text))
	signature.WriteString("\x00")
	signature.WriteString(strings.TrimSpace(message.ConversationID))
	for _, item := range message.Media {
		signature.WriteString("\x00")
		signature.WriteString(strings.TrimSpace(item.Kind))
		signature.WriteString("\x00")
		signature.WriteString(strings.TrimSpace(item.Path))
		signature.WriteString("\x00")
		signature.WriteString(strings.TrimSpace(item.URL))
		signature.WriteString("\x00")
		signature.WriteString(strings.TrimSpace(item.FileName))
	}
	return signature.String()
}

func aggregateTelegramMediaGroupMessages(groupID string, items map[string]InboundMessage, lateBatch bool) InboundMessage {
	order := telegramMediaGroupItemOrder(items)
	messageIDs := telegramMediaGroupMessageIDs(order, items)
	aggregated := InboundMessage{
		MessageID:    telegramMediaGroupSyntheticMessageID(groupID, messageIDs),
		ProviderData: map[string]string{telegramMediaGroupIDProviderDataKey: strings.TrimSpace(groupID)},
	}
	if lateBatch {
		aggregated.ProviderData[telegramMediaGroupLateBatchProviderDataKey] = "true"
	}

	for _, itemKey := range order {
		item := cloneInboundMessageValue(items[itemKey])
		if strings.TrimSpace(item.ConversationID) != "" && strings.TrimSpace(aggregated.ConversationID) == "" {
			aggregated.ConversationID = strings.TrimSpace(item.ConversationID)
		}
		if strings.TrimSpace(item.ExternalChatID) != "" && strings.TrimSpace(aggregated.ExternalChatID) == "" {
			aggregated.ExternalChatID = strings.TrimSpace(item.ExternalChatID)
		}
		if strings.TrimSpace(item.ExternalThreadID) != "" && strings.TrimSpace(aggregated.ExternalThreadID) == "" {
			aggregated.ExternalThreadID = strings.TrimSpace(item.ExternalThreadID)
		}
		if strings.TrimSpace(item.UserID) != "" && strings.TrimSpace(aggregated.UserID) == "" {
			aggregated.UserID = strings.TrimSpace(item.UserID)
		}
		if strings.TrimSpace(item.Username) != "" && strings.TrimSpace(aggregated.Username) == "" {
			aggregated.Username = strings.TrimSpace(item.Username)
		}
		if strings.TrimSpace(item.Title) != "" && strings.TrimSpace(aggregated.Title) == "" {
			aggregated.Title = strings.TrimSpace(item.Title)
		}
		aggregated.Text = mergeTelegramMediaGroupText(aggregated.Text, item.Text)
		aggregated.Media = append(aggregated.Media, cloneBotMessageMediaList(item.Media)...)
	}

	if len(messageIDs) > 0 {
		aggregated.ProviderData[telegramMediaGroupMessageIDsProviderDataKey] = strings.Join(messageIDs, ",")
	}
	return aggregated
}

func telegramMediaGroupItemOrder(items map[string]InboundMessage) []string {
	order := make([]string, 0, len(items))
	for itemKey := range items {
		order = append(order, itemKey)
	}
	sort.Slice(order, func(i int, j int) bool {
		leftNumeric, leftErr := strconv.ParseInt(order[i], 10, 64)
		rightNumeric, rightErr := strconv.ParseInt(order[j], 10, 64)
		switch {
		case leftErr == nil && rightErr == nil:
			return leftNumeric < rightNumeric
		case leftErr == nil:
			return true
		case rightErr == nil:
			return false
		default:
			return order[i] < order[j]
		}
	})
	return order
}

func telegramMediaGroupSeenKeys(items map[string]InboundMessage) []string {
	keys := make([]string, 0, len(items))
	for itemKey := range items {
		if trimmed := strings.TrimSpace(itemKey); trimmed != "" {
			keys = append(keys, trimmed)
		}
	}
	return keys
}

func telegramMediaGroupMessageIDs(order []string, items map[string]InboundMessage) []string {
	messageIDs := make([]string, 0, len(order))
	for _, itemKey := range order {
		item := items[itemKey]
		if messageID := strings.TrimSpace(item.MessageID); messageID != "" {
			messageIDs = append(messageIDs, messageID)
			continue
		}
		if trimmed := strings.TrimSpace(itemKey); trimmed != "" {
			messageIDs = append(messageIDs, trimmed)
		}
	}
	return messageIDs
}

func telegramMediaGroupSyntheticMessageID(groupID string, messageIDs []string) string {
	trimmedGroupID := strings.TrimSpace(groupID)
	if len(messageIDs) == 0 {
		return "telegram-media-group:" + trimmedGroupID
	}
	digest := sha1.Sum([]byte(strings.Join(messageIDs, ",")))
	return "telegram-media-group:" +
		trimmedGroupID +
		":" +
		intToString(len(messageIDs)) +
		":" +
		hex.EncodeToString(digest[:8])
}

func mergeTelegramMediaGroupText(current string, next string) string {
	current = strings.TrimSpace(current)
	next = strings.TrimSpace(next)
	switch {
	case current == "":
		return next
	case next == "":
		return current
	case current == next:
		return current
	default:
		return current + "\n\n" + next
	}
}

func cloneInboundMessageValue(message InboundMessage) InboundMessage {
	next := message
	next.Media = cloneBotMessageMediaList(message.Media)
	next.ProviderData = mergeProviderState(nil, message.ProviderData)
	return next
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
		s.appendConnectionLogWithI18n(
			connection.WorkspaceID,
			connection.ID,
			"warning",
			"recovery_replay_suppressed",
			recoverySavedReplySuppressionMessage(delivery),
			"bot.recovery-replay-suppressed.saved-reply-snapshot",
			recoverySavedReplySuppressionParams(delivery),
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

func recoverySavedReplySuppressionParams(delivery store.BotInboundDelivery) map[string]string {
	messageID := firstNonEmpty(strings.TrimSpace(delivery.MessageID), "unknown")
	replyCount := savedReplySnapshotMessageCount(delivery)
	return map[string]string{
		"deliveryId": delivery.ID,
		"messageId":  messageID,
		"replyCount": intToString(replyCount),
		"replyLabel": pluralizeLabel(replyCount, "message", "messages"),
	}
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
		lastOutboundText = summarizeProviderReplyMessages(connection, reply.Messages)
	}
	expectedContextVersion := conversationContextVersion(conversation)
	lastInboundText := messageSummaryText(inbound.Text, inbound.Media)
	executionWorkspaceID := s.conversationExecutionWorkspaceID(connection, conversation)

	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		currentContextVersion := conversationContextVersion(current)
		if currentContextVersion != expectedContextVersion {
			return current
		}

		nextThreadRef := botThreadRef{
			WorkspaceID: executionWorkspaceID,
			ThreadID:    strings.TrimSpace(reply.ThreadID),
		}
		if strings.TrimSpace(reply.ThreadID) != "" {
			current.ThreadID = reply.ThreadID
		}
		current.BackendState = mergeConversationBackendState(current.BackendState, reply.BackendState, currentContextVersion, executionWorkspaceID)
		if strings.TrimSpace(reply.ThreadID) != "" {
			knownThreadRefs := knownConversationThreadRefsFromState(current.BackendState, current.WorkspaceID)
			knownThreadRefs = appendBotThreadRef(knownThreadRefs, botThreadRef{
				WorkspaceID: executionWorkspaceID,
				ThreadID:    reply.ThreadID,
			}, executionWorkspaceID)
			current.BackendState = conversationBackendStateWithCurrentThreadRef(
				conversationBackendStateWithKnownThreadRefs(current.BackendState, knownThreadRefs),
				nextThreadRef,
				executionWorkspaceID,
			)
			current.BackendState = conversationBackendStateWithVersion(current.BackendState, currentContextVersion)
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
		nextThreadRef := botThreadRef{
			WorkspaceID: executionWorkspaceID,
			ThreadID:    strings.TrimSpace(reply.ThreadID),
		}
		if strings.TrimSpace(reply.ThreadID) != "" && conversationContextVersion(updatedConversation) == expectedContextVersion {
			updatedConversation.ThreadID = reply.ThreadID
		}
		updatedConversation.BackendState = mergeConversationBackendState(updatedConversation.BackendState, reply.BackendState, expectedContextVersion, executionWorkspaceID)
		if strings.TrimSpace(reply.ThreadID) != "" && conversationContextVersion(updatedConversation) == expectedContextVersion {
			knownThreadRefs := knownConversationThreadRefsFromState(updatedConversation.BackendState, updatedConversation.WorkspaceID)
			knownThreadRefs = appendBotThreadRef(knownThreadRefs, botThreadRef{
				WorkspaceID: executionWorkspaceID,
				ThreadID:    reply.ThreadID,
			}, executionWorkspaceID)
			updatedConversation.BackendState = conversationBackendStateWithCurrentThreadRef(
				conversationBackendStateWithKnownThreadRefs(updatedConversation.BackendState, knownThreadRefs),
				nextThreadRef,
				executionWorkspaceID,
			)
			updatedConversation.BackendState = conversationBackendStateWithVersion(updatedConversation.BackendState, expectedContextVersion)
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
		ID:                    connection.ID,
		BotID:                 strings.TrimSpace(connection.BotID),
		WorkspaceID:           connection.WorkspaceID,
		Provider:              connection.Provider,
		Name:                  connection.Name,
		Status:                connection.Status,
		AIBackend:             connection.AIBackend,
		AIConfig:              cloneStringMapLocal(connection.AIConfig),
		Settings:              cloneStringMapLocal(connection.Settings),
		Capabilities:          cloneStringSliceLocal(connectionCapabilitiesForConnection(connection)),
		SecretKeys:            secretKeys,
		LastError:             connection.LastError,
		LastPollAt:            cloneOptionalTimeLocal(connection.LastPollAt),
		LastPollStatus:        connection.LastPollStatus,
		LastPollMessage:       connection.LastPollMessage,
		LastPollMessageKey:    connection.LastPollMessageKey,
		LastPollMessageParams: cloneStringMapLocal(connection.LastPollMessageParams),
		CreatedAt:             connection.CreatedAt,
		UpdatedAt:             connection.UpdatedAt,
	}
}

func botViewFromStore(bot store.Bot, defaultBinding store.BotBinding, endpointCount int, conversationCount int) BotView {
	return BotView{
		ID:                     strings.TrimSpace(bot.ID),
		WorkspaceID:            strings.TrimSpace(bot.WorkspaceID),
		Scope:                  normalizeBotScopeValue(bot.Scope),
		SharingMode:            normalizeResolvedBotSharingMode(bot),
		SharedWorkspaceIDs:     cloneStringSliceLocal(normalizeWorkspaceIDList(bot.SharedWorkspaceIDs)),
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

func (s *Service) deliveryTargetReadinessState(target store.BotDeliveryTarget) deliveryTargetReadinessState {
	connection, ok := s.store.GetBotConnection(strings.TrimSpace(target.WorkspaceID), strings.TrimSpace(target.ConnectionID))
	if !ok {
		connection = store.BotConnection{
			ID:          strings.TrimSpace(target.ConnectionID),
			WorkspaceID: strings.TrimSpace(target.WorkspaceID),
			Provider:    strings.TrimSpace(target.Provider),
		}
	}

	readiness := readyDeliveryTargetReadinessState(nil)
	if normalizeProviderName(connection.Provider) == wechatProviderName {
		if conversationID := strings.TrimSpace(target.ConversationID); conversationID != "" {
			conversation, ok := s.store.GetBotConversation(connection.WorkspaceID, conversationID)
			if !ok || strings.TrimSpace(conversation.ConnectionID) != connection.ID {
				readiness = waitingDeliveryTargetReadinessState(nil, wechatWaitingForContextMessage())
			} else {
				conversation = s.ensureConversationBotIdentity(conversation, connection)
				lastContextSeenAt := cloneTimeValue(conversation.UpdatedAt)
				if strings.TrimSpace(mergeProviderState(target.ProviderState, conversation.ProviderState)[wechatContextTokenKey]) != "" {
					readiness = readyDeliveryTargetReadinessState(lastContextSeenAt)
				} else {
					readiness = waitingDeliveryTargetReadinessState(lastContextSeenAt, wechatWaitingForContextMessage())
				}
			}
		} else if strings.TrimSpace(normalizeRouteTypeForTarget(connection, target.RouteType, target.RouteKey)) == "wechat_session" {
			resolution, err := s.resolveWeChatRouteBackedConversation(connection.WorkspaceID, connection, target)
			if err != nil {
				readiness = waitingDeliveryTargetReadinessState(nil, err.Error())
			} else if resolution.HasUsableContext {
				readiness = readyDeliveryTargetReadinessState(resolution.LastContextSeenAt)
			} else {
				readiness = waitingDeliveryTargetReadinessState(resolution.LastContextSeenAt, wechatWaitingForContextMessage())
			}
		}
	}

	if !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
		readiness.Readiness = deliveryTargetReadinessWaiting
		readiness.Message = inactiveProviderDeliveryTargetMessage(connection.Status)
	}

	return readiness
}

func recipientCandidateConversationReadinessState(
	connection store.BotConnection,
	conversation store.BotConversation,
) deliveryTargetReadinessState {
	lastContextSeenAt := cloneTimeValue(conversation.UpdatedAt)
	readiness := readyDeliveryTargetReadinessState(lastContextSeenAt)
	if normalizeProviderName(connection.Provider) == wechatProviderName &&
		strings.TrimSpace(conversation.ProviderState[wechatContextTokenKey]) == "" {
		readiness = waitingDeliveryTargetReadinessState(lastContextSeenAt, wechatWaitingForContextMessage())
	}
	if !strings.EqualFold(strings.TrimSpace(connection.Status), "active") {
		readiness.Readiness = deliveryTargetReadinessWaiting
		readiness.Message = inactiveProviderDeliveryTargetMessage(connection.Status)
	}
	return readiness
}

func recipientCandidateFromConversation(
	workspaceID string,
	connection store.BotConnection,
	conversation store.BotConversation,
) RecipientCandidateView {
	routeType, routeKey := deliveryRouteFromConversation(connection, conversation)
	return recipientCandidateView(
		workspaceID,
		connection,
		routeType,
		routeKey,
		strings.TrimSpace(conversation.ExternalChatID),
		strings.TrimSpace(conversation.ExternalThreadID),
		recipientCandidateTitle(conversation.ExternalTitle, conversation.ExternalUsername, conversation.ExternalUserID, conversation.ExternalChatID),
		"conversation",
		strings.TrimSpace(conversation.ID),
		cloneTimeValue(conversation.UpdatedAt),
	).withReadiness(recipientCandidateConversationReadinessState(connection, conversation))
}

func (s *Service) recipientCandidateFromDeliveryTarget(
	workspaceID string,
	connection store.BotConnection,
	target store.BotDeliveryTarget,
) (RecipientCandidateView, bool) {
	if strings.TrimSpace(target.ConnectionID) != strings.TrimSpace(connection.ID) {
		return RecipientCandidateView{}, false
	}

	source := "saved_target"
	switch strings.TrimSpace(target.TargetType) {
	case "session_backed":
		conversationID := strings.TrimSpace(target.ConversationID)
		if conversationID == "" {
			return RecipientCandidateView{}, false
		}
		conversation, ok := s.store.GetBotConversation(workspaceID, conversationID)
		if !ok || strings.TrimSpace(conversation.ConnectionID) != strings.TrimSpace(connection.ID) {
			return RecipientCandidateView{}, false
		}
		conversation = s.ensureConversationBotIdentity(conversation, connection)
		routeType, routeKey := deliveryRouteFromConversation(connection, conversation)
		lastSeenAt := cloneTimeValue(conversation.UpdatedAt)
		if lastSeenAt == nil {
			lastSeenAt = cloneTimeValue(target.UpdatedAt)
		}
		return recipientCandidateView(
			workspaceID,
			connection,
			routeType,
			routeKey,
			strings.TrimSpace(conversation.ExternalChatID),
			strings.TrimSpace(conversation.ExternalThreadID),
			firstNonEmpty(strings.TrimSpace(target.Title), recipientCandidateTitle(conversation.ExternalTitle, conversation.ExternalUsername, conversation.ExternalUserID, conversation.ExternalChatID)),
			source,
			strings.TrimSpace(target.ID),
			lastSeenAt,
		).withReadiness(s.deliveryTargetReadinessState(target)), true

	case "route_backed":
		syntheticConversation, err := buildSyntheticConversationForTarget(connection, target)
		if err != nil {
			return RecipientCandidateView{}, false
		}
		normalizedRouteType := normalizeRouteTypeForTarget(connection, target.RouteType, target.RouteKey)
		routeType, routeKey := canonicalRouteForTargetType(normalizedRouteType, syntheticConversation)
		lastSeenAt := cloneOptionalTimeLocal(target.LastVerifiedAt)
		if lastSeenAt == nil {
			lastSeenAt = cloneTimeValue(target.UpdatedAt)
		}
		return recipientCandidateView(
			workspaceID,
			connection,
			routeType,
			routeKey,
			strings.TrimSpace(syntheticConversation.ExternalChatID),
			strings.TrimSpace(syntheticConversation.ExternalThreadID),
			firstNonEmpty(strings.TrimSpace(target.Title), recipientCandidateTitle(syntheticConversation.ExternalTitle, syntheticConversation.ExternalUsername, syntheticConversation.ExternalUserID, syntheticConversation.ExternalChatID)),
			source,
			strings.TrimSpace(target.ID),
			lastSeenAt,
		).withReadiness(s.deliveryTargetReadinessState(target)), true
	default:
		return RecipientCandidateView{}, false
	}
}

func recipientCandidateView(
	workspaceID string,
	connection store.BotConnection,
	routeType string,
	routeKey string,
	chatID string,
	threadID string,
	title string,
	source string,
	sourceRefID string,
	lastSeenAt *time.Time,
) RecipientCandidateView {
	return RecipientCandidateView{
		ID:           recipientCandidateID(connection.ID, source, sourceRefID, routeType, routeKey),
		WorkspaceID:  strings.TrimSpace(workspaceID),
		ConnectionID: strings.TrimSpace(connection.ID),
		Provider:     strings.TrimSpace(connection.Provider),
		RouteType:    strings.TrimSpace(routeType),
		RouteKey:     strings.TrimSpace(routeKey),
		ChatID:       strings.TrimSpace(chatID),
		ThreadID:     strings.TrimSpace(threadID),
		Title:        strings.TrimSpace(title),
		Source:       strings.TrimSpace(source),
		SourceRefID:  strings.TrimSpace(sourceRefID),
		LastSeenAt:   cloneOptionalTimeLocal(lastSeenAt),
	}
}

func (view RecipientCandidateView) withReadiness(readiness deliveryTargetReadinessState) RecipientCandidateView {
	view.DeliveryReadiness = strings.TrimSpace(readiness.Readiness)
	view.DeliveryReadinessMessage = strings.TrimSpace(readiness.Message)
	view.LastContextSeenAt = cloneOptionalTimeLocal(readiness.LastContextSeenAt)
	return view
}

func recipientCandidateID(connectionID string, source string, sourceRefID string, routeType string, routeKey string) string {
	signature := strings.Join([]string{
		strings.TrimSpace(connectionID),
		strings.TrimSpace(source),
		strings.TrimSpace(sourceRefID),
		strings.ToLower(strings.TrimSpace(routeType)),
		strings.TrimSpace(routeKey),
	}, "|")
	digest := sha1.Sum([]byte(signature))
	return "brc_" + hex.EncodeToString(digest[:])[:16]
}

func recipientCandidateSignature(candidate RecipientCandidateView) string {
	return strings.Join([]string{
		strings.ToLower(strings.TrimSpace(candidate.RouteType)),
		strings.TrimSpace(candidate.ChatID),
		strings.TrimSpace(candidate.ThreadID),
	}, "\n")
}

func recipientCandidateTitle(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func recipientCandidateSourcePriority(source string) int {
	switch strings.TrimSpace(source) {
	case "saved_target":
		return 0
	case "conversation":
		return 1
	case "connection_owner":
		return 2
	default:
		return 3
	}
}

func recipientCandidateTime(lastSeenAt *time.Time) time.Time {
	if lastSeenAt == nil {
		return time.Time{}
	}
	return lastSeenAt.UTC()
}

func shouldReplaceRecipientCandidate(current RecipientCandidateView, next RecipientCandidateView) bool {
	currentPriority := recipientCandidateSourcePriority(current.Source)
	nextPriority := recipientCandidateSourcePriority(next.Source)
	if nextPriority != currentPriority {
		return nextPriority < currentPriority
	}

	currentTime := recipientCandidateTime(current.LastSeenAt)
	nextTime := recipientCandidateTime(next.LastSeenAt)
	if !currentTime.Equal(nextTime) {
		return nextTime.After(currentTime)
	}

	if strings.TrimSpace(current.Title) == "" && strings.TrimSpace(next.Title) != "" {
		return true
	}
	if strings.TrimSpace(current.SourceRefID) == "" && strings.TrimSpace(next.SourceRefID) != "" {
		return true
	}
	return false
}

func recipientCandidateLess(left RecipientCandidateView, right RecipientCandidateView) bool {
	leftPriority := recipientCandidateSourcePriority(left.Source)
	rightPriority := recipientCandidateSourcePriority(right.Source)
	if leftPriority != rightPriority {
		return leftPriority < rightPriority
	}

	leftTime := recipientCandidateTime(left.LastSeenAt)
	rightTime := recipientCandidateTime(right.LastSeenAt)
	if !leftTime.Equal(rightTime) {
		return leftTime.After(rightTime)
	}

	leftTitle := strings.ToLower(strings.TrimSpace(left.Title))
	rightTitle := strings.ToLower(strings.TrimSpace(right.Title))
	if leftTitle != rightTitle {
		return leftTitle < rightTitle
	}
	if strings.TrimSpace(left.ChatID) != strings.TrimSpace(right.ChatID) {
		return strings.TrimSpace(left.ChatID) < strings.TrimSpace(right.ChatID)
	}
	if strings.TrimSpace(left.ThreadID) != strings.TrimSpace(right.ThreadID) {
		return strings.TrimSpace(left.ThreadID) < strings.TrimSpace(right.ThreadID)
	}
	return strings.TrimSpace(left.ID) < strings.TrimSpace(right.ID)
}

func (s *Service) deliveryTargetViewFromStore(target store.BotDeliveryTarget) DeliveryTargetView {
	readiness := s.deliveryTargetReadinessState(target)
	return DeliveryTargetView{
		ID:                       strings.TrimSpace(target.ID),
		WorkspaceID:              strings.TrimSpace(target.WorkspaceID),
		BotID:                    strings.TrimSpace(target.BotID),
		EndpointID:               strings.TrimSpace(target.ConnectionID),
		SessionID:                strings.TrimSpace(target.ConversationID),
		Provider:                 strings.TrimSpace(target.Provider),
		TargetType:               strings.TrimSpace(target.TargetType),
		RouteType:                strings.TrimSpace(target.RouteType),
		RouteKey:                 strings.TrimSpace(target.RouteKey),
		Title:                    strings.TrimSpace(target.Title),
		Labels:                   cloneStringSliceLocal(target.Labels),
		Capabilities:             cloneStringSliceLocal(target.Capabilities),
		ProviderState:            deliveryTargetProviderStateForView(target),
		Status:                   strings.TrimSpace(target.Status),
		DeliveryReadiness:        readiness.Readiness,
		DeliveryReadinessMessage: readiness.Message,
		LastContextSeenAt:        cloneOptionalTimeLocal(readiness.LastContextSeenAt),
		LastVerifiedAt:           cloneOptionalTimeLocal(target.LastVerifiedAt),
		CreatedAt:                target.CreatedAt,
		UpdatedAt:                target.UpdatedAt,
	}
}

func deliveryTargetProviderStateForView(target store.BotDeliveryTarget) map[string]string {
	providerState := cloneStringMapLocal(target.ProviderState)
	if normalizeProviderName(target.Provider) != wechatProviderName {
		return providerState
	}
	return stripManagedWeChatRouteProviderState(providerState)
}

func outboundDeliveryViewFromStore(delivery store.BotOutboundDelivery) OutboundDeliveryView {
	return OutboundDeliveryView{
		ID:                 strings.TrimSpace(delivery.ID),
		BotID:              strings.TrimSpace(delivery.BotID),
		EndpointID:         strings.TrimSpace(delivery.ConnectionID),
		SessionID:          strings.TrimSpace(delivery.ConversationID),
		DeliveryTargetID:   strings.TrimSpace(delivery.DeliveryTargetID),
		RunID:              strings.TrimSpace(delivery.RunID),
		TriggerID:          strings.TrimSpace(delivery.TriggerID),
		SourceType:         strings.TrimSpace(delivery.SourceType),
		SourceRefType:      strings.TrimSpace(delivery.SourceRefType),
		SourceRefID:        strings.TrimSpace(delivery.SourceRefID),
		OriginWorkspaceID:  strings.TrimSpace(delivery.OriginWorkspaceID),
		OriginThreadID:     strings.TrimSpace(delivery.OriginThreadID),
		OriginTurnID:       strings.TrimSpace(delivery.OriginTurnID),
		Messages:           cloneBotReplyMessagesLocal(delivery.Messages),
		Status:             strings.TrimSpace(delivery.Status),
		AttemptCount:       delivery.AttemptCount,
		IdempotencyKey:     strings.TrimSpace(delivery.IdempotencyKey),
		ProviderMessageIDs: cloneStringSliceLocal(delivery.ProviderMessageIDs),
		LastError:          strings.TrimSpace(delivery.LastError),
		CreatedAt:          delivery.CreatedAt,
		UpdatedAt:          delivery.UpdatedAt,
		DeliveredAt:        cloneOptionalTimeLocal(delivery.DeliveredAt),
	}
}

func conversationViewFromStore(conversation store.BotConversation, binding store.BotBinding, hasBinding bool) ConversationView {
	resolvedBindingID := ""
	resolvedBindingMode := ""
	resolvedTargetWorkspaceID := ""
	resolvedTargetThreadID := ""
	currentRef := resolveConversationCurrentThreadRef(conversation, binding, hasBinding, strings.TrimSpace(conversation.WorkspaceID))
	if hasBinding {
		resolvedBindingID = strings.TrimSpace(binding.ID)
		resolvedBindingMode = strings.TrimSpace(binding.BindingMode)
		resolvedTargetWorkspaceID = currentRef.WorkspaceID
		resolvedTargetThreadID = currentRef.ThreadID
		if resolvedTargetWorkspaceID == "" {
			resolvedTargetWorkspaceID = firstNonEmpty(strings.TrimSpace(binding.TargetWorkspaceID), strings.TrimSpace(conversation.WorkspaceID))
		}
		if resolvedTargetThreadID == "" {
			resolvedTargetThreadID = strings.TrimSpace(binding.TargetThreadID)
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
