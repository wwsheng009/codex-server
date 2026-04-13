package bots

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"codex-server/backend/internal/store"
)

const threadBoundTurnContentMode = "full"

func registeredThreadBoundTurnKey(workspaceID string, threadID string, turnID string) string {
	return strings.TrimSpace(workspaceID) + "\x00" + strings.TrimSpace(threadID) + "\x00" + strings.TrimSpace(turnID)
}

func registeredThreadBoundTurnPrefix(workspaceID string, threadID string) string {
	return strings.TrimSpace(workspaceID) + "\x00" + strings.TrimSpace(threadID) + "\x00"
}

func (s *Service) startThreadBindingDispatcher(ctx context.Context) {
	s.mu.Lock()
	if s.events == nil || s.threadBindingDispatcherStarted {
		s.mu.Unlock()
		return
	}
	s.threadBindingDispatcherStarted = true
	s.mu.Unlock()

	eventsCh, cancel := s.events.SubscribeAllWithSource(
		"bots.thread_binding_dispatcher",
		"bot-thread-binding-dispatcher",
	)
	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-eventsCh:
				if !ok {
					return
				}
				s.handleThreadBindingEvent(ctx, event)
			}
		}
	}()
}

func (s *Service) handleThreadBindingEvent(ctx context.Context, event store.EventEnvelope) {
	if strings.ToLower(strings.TrimSpace(event.Method)) != "turn/completed" {
		return
	}

	workspaceID := strings.TrimSpace(event.WorkspaceID)
	threadID := strings.TrimSpace(event.ThreadID)
	turnID := strings.TrimSpace(event.TurnID)
	if workspaceID == "" || threadID == "" || turnID == "" {
		return
	}

	dispatch, ok := s.popRegisteredThreadBoundTurn(workspaceID, threadID, turnID)
	if !ok {
		return
	}

	if err := s.dispatchThreadBoundTurn(ctx, workspaceID, threadID, turnID, dispatch); err != nil {
		target, targetOK := s.store.GetBotDeliveryTarget(
			firstNonEmpty(strings.TrimSpace(dispatch.botWorkspaceID), workspaceID),
			dispatch.targetID,
		)
		if !targetOK {
			return
		}
		s.appendConnectionLog(
			firstNonEmpty(strings.TrimSpace(dispatch.botWorkspaceID), workspaceID),
			target.ConnectionID,
			"error",
			"thread_binding_delivery_failed",
			fmt.Sprintf(
				"Thread binding could not deliver turn %s from thread %s to target %s: %s",
				turnID,
				threadID,
				target.ID,
				failureReplyDetail(err),
			),
		)
	}
}

func (s *Service) popRegisteredThreadBoundTurn(workspaceID string, threadID string, turnID string) (threadBoundTurnDispatch, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := registeredThreadBoundTurnKey(workspaceID, threadID, turnID)
	dispatch, ok := s.threadBoundTurns[key]
	if !ok {
		return threadBoundTurnDispatch{}, false
	}
	delete(s.threadBoundTurns, key)
	return dispatch, true
}

func (s *Service) clearRegisteredThreadBoundTurns(workspaceID string, threadID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	prefix := registeredThreadBoundTurnPrefix(workspaceID, threadID)
	for key := range s.threadBoundTurns {
		if strings.HasPrefix(key, prefix) {
			delete(s.threadBoundTurns, key)
		}
	}
}

func (s *Service) dispatchThreadBoundTurn(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnID string,
	dispatch threadBoundTurnDispatch,
) error {
	binding, ok := s.store.GetThreadBotBinding(workspaceID, threadID)
	if !ok {
		return store.ErrThreadBotBindingNotFound
	}
	botWorkspaceID := firstNonEmpty(strings.TrimSpace(binding.BotWorkspaceID), workspaceID)
	if strings.TrimSpace(binding.ID) != strings.TrimSpace(dispatch.bindingID) ||
		strings.TrimSpace(binding.BotID) != strings.TrimSpace(dispatch.botID) ||
		botWorkspaceID != firstNonEmpty(strings.TrimSpace(dispatch.botWorkspaceID), botWorkspaceID) ||
		strings.TrimSpace(binding.DeliveryTargetID) != strings.TrimSpace(dispatch.targetID) {
		return nil
	}

	target, ok := s.store.GetBotDeliveryTarget(botWorkspaceID, binding.DeliveryTargetID)
	if !ok {
		return store.ErrBotDeliveryTargetNotFound
	}
	connection, err := s.requireBotConnectionContext(botWorkspaceID, binding.BotID, target.ConnectionID)
	if err != nil {
		return err
	}

	turn, err := s.threads.GetTurn(ctx, workspaceID, threadID, turnID, threadBoundTurnContentMode)
	if err != nil {
		return err
	}

	messages := collectBotVisibleMessagesWithConfig(turn, botTranscriptRenderConfigFromConnection(connection))
	if len(messages) == 0 {
		logBotDebug(ctx, connection, "thread binding skipped turn without bot-visible messages",
			slog.String("threadId", threadID),
			slog.String("turnId", turnID),
		)
		return nil
	}

	logBotDebug(ctx, connection, "dispatching bound thread turn to delivery target",
		slog.String("threadId", threadID),
		slog.String("turnId", turnID),
		slog.String("bindingId", binding.ID),
		slog.String("deliveryTargetId", target.ID),
		slog.Int("messageCount", len(messages)),
		slog.Any("messages", debugOutboundMessages(messages)),
	)

	_, err = s.SendDeliveryTargetOutboundMessages(ctx, botWorkspaceID, binding.BotID, target.ID, SendOutboundMessagesInput{
		SourceType:        "thread_binding",
		SourceRefType:     "thread_turn",
		SourceRefID:       turnID,
		OriginWorkspaceID: workspaceID,
		OriginThreadID:    threadID,
		OriginTurnID:      turnID,
		IdempotencyKey:    fmt.Sprintf("thread-binding:%s:%s:%s", binding.ID, threadID, turnID),
		Messages:          outboundReplyMessages(messages),
	})
	return err
}

func (s *Service) threadBotBindingViewFromStore(binding store.ThreadBotBinding) (ThreadBotBindingView, error) {
	botWorkspaceID := firstNonEmpty(strings.TrimSpace(binding.BotWorkspaceID), strings.TrimSpace(binding.WorkspaceID))
	bot, ok := s.store.GetBot(botWorkspaceID, binding.BotID)
	if !ok {
		return ThreadBotBindingView{}, store.ErrBotNotFound
	}

	target, ok := s.store.GetBotDeliveryTarget(botWorkspaceID, binding.DeliveryTargetID)
	if !ok || strings.TrimSpace(target.BotID) != strings.TrimSpace(binding.BotID) {
		return ThreadBotBindingView{}, store.ErrBotDeliveryTargetNotFound
	}

	connection, connectionOK := s.store.GetBotConnection(botWorkspaceID, target.ConnectionID)
	sessionID := strings.TrimSpace(target.ConversationID)
	if connectionOK && sessionID == "" {
		if conversation, ok := s.findConversationForDeliveryTargetBinding(connection, target); ok {
			sessionID = strings.TrimSpace(conversation.ID)
		}
	}

	readiness := s.deliveryTargetReadinessState(target)
	return ThreadBotBindingView{
		ID:                       strings.TrimSpace(binding.ID),
		WorkspaceID:              strings.TrimSpace(binding.WorkspaceID),
		ThreadID:                 strings.TrimSpace(binding.ThreadID),
		BotWorkspaceID:           botWorkspaceID,
		BotID:                    strings.TrimSpace(binding.BotID),
		BotName:                  strings.TrimSpace(bot.Name),
		DeliveryTargetID:         strings.TrimSpace(target.ID),
		DeliveryTargetTitle:      strings.TrimSpace(target.Title),
		EndpointID:               strings.TrimSpace(target.ConnectionID),
		Provider:                 firstNonEmpty(strings.TrimSpace(target.Provider), strings.TrimSpace(connection.Provider)),
		SessionID:                sessionID,
		DeliveryReadiness:        readiness.Readiness,
		DeliveryReadinessMessage: readiness.Message,
		Status:                   strings.TrimSpace(target.Status),
		CreatedAt:                binding.CreatedAt,
		UpdatedAt:                binding.UpdatedAt,
	}, nil
}

func (s *Service) bindDeliveryTargetConversationToThread(
	ctx context.Context,
	workspaceID string,
	threadID string,
	connection store.BotConnection,
	target store.BotDeliveryTarget,
) error {
	conversation, err := s.ensureConversationForDeliveryTargetBinding(connection, target)
	if err != nil {
		return err
	}

	currentRef := s.currentConversationThreadRef(connection, conversation)
	updatedConversation := conversation
	if strings.TrimSpace(currentRef.WorkspaceID) != strings.TrimSpace(workspaceID) ||
		strings.TrimSpace(currentRef.ThreadID) != strings.TrimSpace(threadID) {
		updatedConversation, err = s.bindConversationToThreadRef(
			ctx,
			connection,
			conversation,
			botThreadRef{
				WorkspaceID: workspaceID,
				ThreadID:    threadID,
			},
		)
		if err != nil {
			return err
		}
	}

	_, err = s.ensureConversationSessionBindingTarget(
		connection,
		updatedConversation,
		workspaceID,
		threadID,
		firstNonEmpty(strings.TrimSpace(target.Title), "Thread Channel Binding"),
	)
	return err
}

func (s *Service) findConversationForDeliveryTargetBinding(
	connection store.BotConnection,
	target store.BotDeliveryTarget,
) (store.BotConversation, bool) {
	workspaceID := strings.TrimSpace(connection.WorkspaceID)
	if conversationID := strings.TrimSpace(target.ConversationID); conversationID != "" {
		conversation, ok := s.store.GetBotConversation(workspaceID, conversationID)
		if !ok || strings.TrimSpace(conversation.ConnectionID) != strings.TrimSpace(connection.ID) {
			return store.BotConversation{}, false
		}
		return s.ensureConversationBotIdentity(conversation, connection), true
	}

	synthetic, err := buildSyntheticConversationForTarget(connection, target)
	if err != nil || strings.TrimSpace(synthetic.ExternalConversationID) == "" {
		return store.BotConversation{}, false
	}

	conversation, ok := s.store.FindBotConversationByExternalConversation(
		workspaceID,
		connection.ID,
		synthetic.ExternalConversationID,
	)
	if !ok {
		return store.BotConversation{}, false
	}
	return s.ensureConversationBotIdentity(conversation, connection), true
}

func (s *Service) ensureConversationForDeliveryTargetBinding(
	connection store.BotConnection,
	target store.BotDeliveryTarget,
) (store.BotConversation, error) {
	if conversation, ok := s.findConversationForDeliveryTargetBinding(connection, target); ok {
		return conversation, nil
	}

	synthetic, err := buildSyntheticConversationForTarget(connection, target)
	if err != nil {
		return store.BotConversation{}, err
	}
	synthetic.WorkspaceID = connection.WorkspaceID
	synthetic.ConnectionID = connection.ID
	synthetic.BotID = firstNonEmpty(strings.TrimSpace(synthetic.BotID), strings.TrimSpace(connection.BotID))
	synthetic.Provider = firstNonEmpty(strings.TrimSpace(synthetic.Provider), strings.TrimSpace(connection.Provider))
	return s.store.CreateBotConversation(synthetic)
}

func (s *Service) bindConversationToThreadRef(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	targetRef botThreadRef,
) (store.BotConversation, error) {
	targetRef = normalizeBotThreadRef(targetRef, connection.WorkspaceID)
	if targetRef.ThreadID == "" {
		return store.BotConversation{}, store.ErrThreadNotFound
	}
	if _, ok := s.store.GetThread(targetRef.WorkspaceID, targetRef.ThreadID); !ok {
		return store.BotConversation{}, store.ErrThreadNotFound
	}

	nextContextVersion := conversationContextVersion(conversation) + 1
	currentRef := s.currentConversationThreadRef(connection, conversation)
	updatedConversation, err := s.store.UpdateBotConversation(connection.WorkspaceID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		knownThreadRefs := knownConversationThreadRefsFromState(current.BackendState, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, currentRef, current.WorkspaceID)
		knownThreadRefs = appendBotThreadRef(knownThreadRefs, targetRef, current.WorkspaceID)
		current.ThreadID = targetRef.ThreadID
		current.BackendState = conversationBackendStateWithCurrentThreadRef(
			conversationBackendStateWithKnownThreadRefs(nil, knownThreadRefs),
			targetRef,
			current.WorkspaceID,
		)
		current.BackendState = conversationBackendStateWithVersion(current.BackendState, nextContextVersion)
		return current
	})
	if err != nil {
		return store.BotConversation{}, err
	}

	logBotDebug(ctx, connection, "bound conversation to existing thread",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("threadId", targetRef.ThreadID),
		slog.String("threadWorkspaceId", targetRef.WorkspaceID),
		slog.Int("contextVersion", conversationContextVersion(updatedConversation)),
	)

	return updatedConversation, nil
}
