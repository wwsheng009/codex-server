package notificationcenter

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"codex-server/backend/internal/bots"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/notifications"
	"codex-server/backend/internal/store"
)

func NewService(
	dataStore *store.MemoryStore,
	eventHub *events.Hub,
	notificationService *notifications.Service,
	botService *bots.Service,
	cfg Config,
) *Service {
	return &Service{
		store:         dataStore,
		events:        eventHub,
		notifications: notificationService,
		bots:          botService,
		emailSender:   cfg.EmailSender,
		now:           func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) Start(ctx context.Context) {
	if s == nil {
		return
	}

	subscribe := false
	s.mu.Lock()
	if !s.started {
		s.started = true
		subscribe = true
	}
	s.mu.Unlock()
	if !subscribe || s.events == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}

	eventsCh, cancel := s.events.SubscribeAllWithSource(
		"notificationcenter.service",
		"notification-center-service",
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
				s.handleEvent(ctx, event)
			}
		}
	}()
}

func (s *Service) ListSubscriptions(workspaceID string) []store.NotificationSubscription {
	return s.store.ListNotificationSubscriptions(strings.TrimSpace(workspaceID))
}

func (s *Service) CreateSubscription(workspaceID string, input UpsertSubscriptionInput) (store.NotificationSubscription, error) {
	normalized, err := normalizeSubscriptionInput(strings.TrimSpace(workspaceID), input)
	if err != nil {
		return store.NotificationSubscription{}, err
	}
	return s.store.CreateNotificationSubscription(normalized)
}

func (s *Service) UpdateSubscription(workspaceID string, subscriptionID string, input UpsertSubscriptionInput) (store.NotificationSubscription, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	subscriptionID = strings.TrimSpace(subscriptionID)
	existing, ok := s.store.GetNotificationSubscription(workspaceID, subscriptionID)
	if !ok {
		return store.NotificationSubscription{}, store.ErrNotificationSubscriptionNotFound
	}

	normalized, err := normalizeSubscriptionInput(workspaceID, input)
	if err != nil {
		return store.NotificationSubscription{}, err
	}

	return s.store.UpdateNotificationSubscription(workspaceID, subscriptionID, func(current store.NotificationSubscription) store.NotificationSubscription {
		current.Topic = normalized.Topic
		current.SourceType = normalized.SourceType
		current.Filter = normalized.Filter
		current.Channels = normalized.Channels
		current.Enabled = normalized.Enabled
		current.CreatedAt = existing.CreatedAt
		return current
	})
}

func (s *Service) DeleteSubscription(workspaceID string, subscriptionID string) error {
	return s.store.DeleteNotificationSubscription(strings.TrimSpace(workspaceID), strings.TrimSpace(subscriptionID))
}

func (s *Service) ListEmailTargets(workspaceID string) []store.NotificationEmailTarget {
	return s.store.ListNotificationEmailTargets(strings.TrimSpace(workspaceID))
}

func (s *Service) CreateEmailTarget(workspaceID string, input CreateEmailTargetInput) (store.NotificationEmailTarget, error) {
	target, err := normalizeEmailTargetInput(strings.TrimSpace(workspaceID), input)
	if err != nil {
		return store.NotificationEmailTarget{}, err
	}
	return s.store.CreateNotificationEmailTarget(target)
}

func (s *Service) GetMailServerConfig(workspaceID string) store.NotificationMailServerConfig {
	workspaceID = strings.TrimSpace(workspaceID)
	if config, ok := s.store.GetNotificationMailServerConfig(workspaceID); ok {
		return config
	}
	return defaultMailServerConfig(workspaceID)
}

func (s *Service) UpsertMailServerConfig(
	workspaceID string,
	input UpsertMailServerConfigInput,
) (store.NotificationMailServerConfig, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	current, ok := s.store.GetNotificationMailServerConfig(workspaceID)
	if !ok {
		current = defaultMailServerConfig(workspaceID)
	}

	normalized, err := normalizeMailServerConfigInput(workspaceID, current, input)
	if err != nil {
		return store.NotificationMailServerConfig{}, err
	}

	return s.store.UpsertNotificationMailServerConfig(normalized)
}

func (s *Service) ListDispatches(workspaceID string, options ListDispatchOptions) []store.NotificationDispatch {
	return s.store.ListNotificationDispatches(strings.TrimSpace(workspaceID), store.NotificationDispatchFilter{
		SubscriptionID: strings.TrimSpace(options.SubscriptionID),
		Topic:          strings.TrimSpace(options.Topic),
		Channel:        strings.TrimSpace(options.Channel),
		Status:         strings.TrimSpace(options.Status),
		TargetRefType:  strings.TrimSpace(options.TargetRefType),
		TargetRefID:    strings.TrimSpace(options.TargetRefID),
		SourceRefType:  strings.TrimSpace(options.SourceRefType),
		SourceRefID:    strings.TrimSpace(options.SourceRefID),
		EventKey:       strings.TrimSpace(options.EventKey),
	})
}

func (s *Service) GetDispatch(workspaceID string, dispatchID string) (store.NotificationDispatch, error) {
	dispatch, ok := s.store.GetNotificationDispatch(strings.TrimSpace(workspaceID), strings.TrimSpace(dispatchID))
	if !ok {
		return store.NotificationDispatch{}, store.ErrNotificationDispatchNotFound
	}
	return dispatch, nil
}

func (s *Service) RetryDispatch(ctx context.Context, workspaceID string, dispatchID string) (store.NotificationDispatch, error) {
	dispatch, err := s.GetDispatch(workspaceID, dispatchID)
	if err != nil {
		return store.NotificationDispatch{}, err
	}

	plan, err := s.planFromDispatch(dispatch)
	if err != nil {
		return store.NotificationDispatch{}, err
	}

	return s.executeDispatchPlan(ctx, plan, dispatch.ID)
}

func (s *Service) handleEvent(ctx context.Context, event store.EventEnvelope) {
	normalized, ok := normalizeEvent(event, s.store)
	if !ok {
		return
	}

	plans := s.buildDispatchPlans(normalized)
	for _, plan := range plans {
		if _, err := s.executeDispatchPlan(ctx, plan, ""); err != nil {
			slog.Debug("notification dispatch failed", "workspaceId", plan.Event.WorkspaceID, "topic", plan.Event.Topic, "channel", plan.Binding.Channel, "error", err)
		}
	}
}

func (s *Service) buildDispatchPlans(event normalizedEvent) []dispatchPlan {
	plans := make([]dispatchPlan, 0)
	for _, subscription := range s.store.ListNotificationSubscriptions(event.WorkspaceID) {
		if !subscriptionMatchesEvent(subscription, event) {
			continue
		}
		for _, binding := range subscription.Channels {
			plan, ok := s.buildPlanFromBinding(event, subscription.ID, "", binding)
			if !ok {
				continue
			}
			plans = append(plans, plan)
		}
	}

	enabled := true
	for _, trigger := range s.store.ListBotTriggers(event.WorkspaceID, store.BotTriggerFilter{Type: "notification", Enabled: &enabled}) {
		if !legacyTriggerMatchesEvent(trigger, event) {
			continue
		}
		plan, ok := s.buildPlanFromBinding(event, "", trigger.ID, store.NotificationChannelBinding{
			Channel:       ChannelBot,
			TargetRefType: TargetRefTypeBotDeliveryTarget,
			TargetRefID:   trigger.DeliveryTargetID,
		})
		if !ok {
			continue
		}
		plans = append(plans, plan)
	}

	sort.Slice(plans, func(i int, j int) bool {
		left := plans[i]
		right := plans[j]
		leftKey := strings.Join([]string{left.SubscriptionID, left.LegacyTriggerID, left.Binding.Channel, left.Binding.TargetRefType, left.Binding.TargetRefID}, "|")
		rightKey := strings.Join([]string{right.SubscriptionID, right.LegacyTriggerID, right.Binding.Channel, right.Binding.TargetRefType, right.Binding.TargetRefID}, "|")
		return leftKey < rightKey
	})
	return plans
}

func (s *Service) buildPlanFromBinding(event normalizedEvent, subscriptionID string, legacyTriggerID string, binding store.NotificationChannelBinding) (dispatchPlan, bool) {
	normalizedBinding, ok := normalizeChannelBinding(event.WorkspaceID, binding)
	if !ok {
		return dispatchPlan{}, false
	}

	title := renderTemplate(normalizedBinding.TitleTemplate, event, event.Title)
	message := renderTemplate(normalizedBinding.BodyTemplate, event, event.Message)
	if strings.TrimSpace(title) == "" {
		title = strings.TrimSpace(event.Title)
	}
	if strings.TrimSpace(message) == "" {
		message = strings.TrimSpace(event.Message)
	}
	if title == "" && message == "" {
		return dispatchPlan{}, false
	}

	return dispatchPlan{
		SubscriptionID:  subscriptionID,
		LegacyTriggerID: legacyTriggerID,
		Event:           event,
		Binding:         normalizedBinding,
		Title:           title,
		Message:         message,
	}, true
}

func (s *Service) executeDispatchPlan(ctx context.Context, plan dispatchPlan, dispatchID string) (store.NotificationDispatch, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	workspaceID := strings.TrimSpace(plan.Event.WorkspaceID)
	if workspaceID == "" {
		return store.NotificationDispatch{}, fmt.Errorf("%w: missing workspace id", ErrInvalidInput)
	}

	dedupKey := dispatchDedupKey(plan)
	if dispatchID == "" {
		if existing, ok := s.store.FindNotificationDispatchByDedupKey(workspaceID, dedupKey); ok {
			return existing, nil
		}
		created, err := s.store.CreateNotificationDispatch(store.NotificationDispatch{
			WorkspaceID:    workspaceID,
			SubscriptionID: strings.TrimSpace(plan.SubscriptionID),
			EventKey:       strings.TrimSpace(plan.Event.EventKey),
			DedupKey:       dedupKey,
			Topic:          strings.TrimSpace(plan.Event.Topic),
			SourceType:     strings.TrimSpace(plan.Event.SourceType),
			SourceRefType:  strings.TrimSpace(plan.Event.SourceRefType),
			SourceRefID:    strings.TrimSpace(plan.Event.SourceRefID),
			Channel:        strings.TrimSpace(plan.Binding.Channel),
			TargetRefType:  strings.TrimSpace(plan.Binding.TargetRefType),
			TargetRefID:    strings.TrimSpace(plan.Binding.TargetRefID),
			Title:          strings.TrimSpace(plan.Title),
			Message:        strings.TrimSpace(plan.Message),
			Level:          strings.TrimSpace(plan.Event.Level),
			Status:         DispatchStatusPending,
		})
		if err != nil {
			return store.NotificationDispatch{}, err
		}
		dispatchID = created.ID
	}

	updated, err := s.store.UpdateNotificationDispatch(workspaceID, dispatchID, func(current store.NotificationDispatch) store.NotificationDispatch {
		current.SubscriptionID = firstNonEmpty(strings.TrimSpace(current.SubscriptionID), strings.TrimSpace(plan.SubscriptionID))
		current.EventKey = strings.TrimSpace(plan.Event.EventKey)
		current.DedupKey = dedupKey
		current.Topic = strings.TrimSpace(plan.Event.Topic)
		current.SourceType = strings.TrimSpace(plan.Event.SourceType)
		current.SourceRefType = strings.TrimSpace(plan.Event.SourceRefType)
		current.SourceRefID = strings.TrimSpace(plan.Event.SourceRefID)
		current.Channel = strings.TrimSpace(plan.Binding.Channel)
		current.TargetRefType = strings.TrimSpace(plan.Binding.TargetRefType)
		current.TargetRefID = strings.TrimSpace(plan.Binding.TargetRefID)
		current.Title = strings.TrimSpace(plan.Title)
		current.Message = strings.TrimSpace(plan.Message)
		current.Level = strings.TrimSpace(plan.Event.Level)
		current.Status = DispatchStatusPending
		current.Error = ""
		current.AttemptCount += 1
		current.DeliveredAt = nil
		return current
	})
	if err != nil {
		return store.NotificationDispatch{}, err
	}

	var outcome store.NotificationDispatch
	switch strings.TrimSpace(plan.Binding.Channel) {
	case ChannelInApp:
		outcome, err = s.deliverInApp(ctx, plan)
	case ChannelBot:
		outcome, err = s.deliverBot(ctx, plan)
	case ChannelEmail:
		outcome, err = s.deliverEmail(ctx, plan)
	default:
		err = fmt.Errorf("%w: unsupported channel %q", ErrInvalidInput, plan.Binding.Channel)
	}
	if err != nil {
		failed, updateErr := s.markDispatchFailed(workspaceID, updated.ID, err)
		if updateErr != nil {
			return store.NotificationDispatch{}, updateErr
		}
		return failed, err
	}

	return s.markDispatchDelivered(workspaceID, updated.ID, outcome)
}

func (s *Service) planFromDispatch(dispatch store.NotificationDispatch) (dispatchPlan, error) {
	event := normalizedEvent{
		WorkspaceID:   strings.TrimSpace(dispatch.WorkspaceID),
		Topic:         strings.TrimSpace(dispatch.Topic),
		SourceType:    strings.TrimSpace(dispatch.SourceType),
		SourceRefType: strings.TrimSpace(dispatch.SourceRefType),
		SourceRefID:   strings.TrimSpace(dispatch.SourceRefID),
		EventKey:      strings.TrimSpace(dispatch.EventKey),
		Level:         strings.TrimSpace(dispatch.Level),
		Title:         strings.TrimSpace(dispatch.Title),
		Message:       strings.TrimSpace(dispatch.Message),
		Attributes: map[string]string{
			"topic":         strings.TrimSpace(dispatch.Topic),
			"sourceType":    strings.TrimSpace(dispatch.SourceType),
			"sourceRefType": strings.TrimSpace(dispatch.SourceRefType),
			"sourceRefId":   strings.TrimSpace(dispatch.SourceRefID),
			"level":         strings.TrimSpace(dispatch.Level),
		},
	}

	binding := store.NotificationChannelBinding{
		Channel:       strings.TrimSpace(dispatch.Channel),
		TargetRefType: strings.TrimSpace(dispatch.TargetRefType),
		TargetRefID:   strings.TrimSpace(dispatch.TargetRefID),
	}
	if strings.TrimSpace(dispatch.SubscriptionID) != "" {
		subscription, ok := s.store.GetNotificationSubscription(dispatch.WorkspaceID, dispatch.SubscriptionID)
		if !ok {
			return dispatchPlan{}, store.ErrNotificationSubscriptionNotFound
		}
		for _, candidate := range subscription.Channels {
			if strings.TrimSpace(candidate.Channel) != strings.TrimSpace(dispatch.Channel) {
				continue
			}
			if strings.TrimSpace(candidate.TargetRefType) != strings.TrimSpace(dispatch.TargetRefType) {
				continue
			}
			if strings.TrimSpace(candidate.TargetRefID) != strings.TrimSpace(dispatch.TargetRefID) {
				continue
			}
			binding = candidate
			break
		}
	}

	plan, ok := s.buildPlanFromBinding(event, dispatch.SubscriptionID, "", binding)
	if !ok {
		return dispatchPlan{}, fmt.Errorf("%w: could not reconstruct dispatch plan", ErrInvalidInput)
	}
	plan.Title = firstNonEmpty(strings.TrimSpace(dispatch.Title), plan.Title)
	plan.Message = firstNonEmpty(strings.TrimSpace(dispatch.Message), plan.Message)
	return plan, nil
}

func normalizeSubscriptionInput(workspaceID string, input UpsertSubscriptionInput) (store.NotificationSubscription, error) {
	topic := strings.TrimSpace(input.Topic)
	if workspaceID == "" || topic == "" {
		return store.NotificationSubscription{}, ErrInvalidInput
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}

	channels := make([]store.NotificationChannelBinding, 0, len(input.Channels))
	for _, channelInput := range input.Channels {
		binding, ok := normalizeChannelBinding(workspaceID, store.NotificationChannelBinding{
			Channel:       channelInput.Channel,
			TargetRefType: channelInput.TargetRefType,
			TargetRefID:   channelInput.TargetRefID,
			TitleTemplate: channelInput.TitleTemplate,
			BodyTemplate:  channelInput.BodyTemplate,
			Settings:      channelInput.Settings,
		})
		if !ok {
			return store.NotificationSubscription{}, ErrInvalidInput
		}
		channels = append(channels, binding)
	}
	if len(channels) == 0 {
		return store.NotificationSubscription{}, ErrInvalidInput
	}

	return store.NotificationSubscription{
		WorkspaceID: workspaceID,
		Topic:       topic,
		SourceType:  strings.TrimSpace(input.SourceType),
		Filter:      normalizeFilter(input.Filter),
		Channels:    channels,
		Enabled:     enabled,
	}, nil
}

func normalizeEmailTargetInput(workspaceID string, input CreateEmailTargetInput) (store.NotificationEmailTarget, error) {
	name := strings.TrimSpace(input.Name)
	emails := normalizeEmails(input.Emails)
	if workspaceID == "" || name == "" || len(emails) == 0 {
		return store.NotificationEmailTarget{}, ErrInvalidInput
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	return store.NotificationEmailTarget{
		WorkspaceID:     workspaceID,
		Name:            name,
		Emails:          emails,
		SubjectTemplate: strings.TrimSpace(input.SubjectTemplate),
		BodyTemplate:    strings.TrimSpace(input.BodyTemplate),
		Enabled:         enabled,
	}, nil
}

func defaultMailServerConfig(workspaceID string) store.NotificationMailServerConfig {
	return store.NotificationMailServerConfig{
		WorkspaceID: workspaceID,
		Port:        defaultNotificationSMTPPort,
		RequireTLS:  true,
	}
}

func normalizeMailServerConfigInput(
	workspaceID string,
	current store.NotificationMailServerConfig,
	input UpsertMailServerConfigInput,
) (store.NotificationMailServerConfig, error) {
	if workspaceID == "" {
		return store.NotificationMailServerConfig{}, ErrInvalidInput
	}

	password := current.Password
	switch {
	case input.Password != "":
		password = input.Password
	case input.ClearPassword:
		password = ""
	}

	port := input.Port
	if port == 0 {
		port = defaultNotificationSMTPPort
	}
	if port < 0 || port > 65535 {
		return store.NotificationMailServerConfig{}, ErrInvalidInput
	}

	config := store.NotificationMailServerConfig{
		WorkspaceID: workspaceID,
		Enabled:     input.Enabled,
		Host:        strings.TrimSpace(input.Host),
		Port:        port,
		Username:    strings.TrimSpace(input.Username),
		Password:    password,
		From:        strings.TrimSpace(input.From),
		RequireTLS:  input.RequireTLS,
		SkipVerify:  input.SkipVerify,
		CreatedAt:   current.CreatedAt,
	}
	config.PasswordSet = config.Password != ""

	if config.Enabled && (config.Host == "" || config.From == "") {
		return store.NotificationMailServerConfig{}, ErrInvalidInput
	}

	return config, nil
}

func normalizeChannelBinding(workspaceID string, binding store.NotificationChannelBinding) (store.NotificationChannelBinding, bool) {
	normalized := store.NotificationChannelBinding{
		Channel:       normalizeChannel(binding.Channel),
		TargetRefType: strings.TrimSpace(binding.TargetRefType),
		TargetRefID:   strings.TrimSpace(binding.TargetRefID),
		TitleTemplate: strings.TrimSpace(binding.TitleTemplate),
		BodyTemplate:  strings.TrimSpace(binding.BodyTemplate),
		Settings:      normalizeFilter(binding.Settings),
	}
	if normalized.Channel == "" {
		return store.NotificationChannelBinding{}, false
	}

	switch normalized.Channel {
	case ChannelInApp:
		if normalized.TargetRefType == "" {
			normalized.TargetRefType = TargetRefTypeWorkspace
		}
		if normalized.TargetRefType != TargetRefTypeWorkspace {
			return store.NotificationChannelBinding{}, false
		}
		if normalized.TargetRefID == "" {
			normalized.TargetRefID = strings.TrimSpace(workspaceID)
		}
	case ChannelBot:
		if normalized.TargetRefType == "" {
			normalized.TargetRefType = TargetRefTypeBotDeliveryTarget
		}
		if normalized.TargetRefType != TargetRefTypeBotDeliveryTarget || normalized.TargetRefID == "" {
			return store.NotificationChannelBinding{}, false
		}
	case ChannelEmail:
		if normalized.TargetRefType == "" {
			normalized.TargetRefType = TargetRefTypeEmailTarget
		}
		if normalized.TargetRefType != TargetRefTypeEmailTarget || normalized.TargetRefID == "" {
			return store.NotificationChannelBinding{}, false
		}
	default:
		return store.NotificationChannelBinding{}, false
	}
	return normalized, true
}

func normalizeChannel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ChannelInApp, "inapp", "in-app":
		return ChannelInApp
	case ChannelBot:
		return ChannelBot
	case ChannelEmail:
		return ChannelEmail
	default:
		return ""
	}
}

func normalizeFilter(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	normalized := make(map[string]string)
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		trimmedValue := strings.TrimSpace(value)
		if trimmedKey == "" || trimmedValue == "" {
			continue
		}
		normalized[trimmedKey] = trimmedValue
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func normalizeEmails(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{})
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func dispatchDedupKey(plan dispatchPlan) string {
	return strings.Join([]string{
		strings.TrimSpace(plan.Event.EventKey),
		strings.TrimSpace(plan.Binding.Channel),
		strings.TrimSpace(plan.Binding.TargetRefType),
		strings.TrimSpace(plan.Binding.TargetRefID),
	}, "|")
}
