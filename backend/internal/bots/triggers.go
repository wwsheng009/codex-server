package bots

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"codex-server/backend/internal/store"
)

const (
	managedNotificationTriggerTopic      = "system.notification.created"
	managedNotificationTriggerSourceType = "notification"
	managedTriggerIDPrefix               = "nc"
)

func normalizeBotTriggerType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "notification":
		return "notification"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func normalizeBotTriggerFilter(filter map[string]string) map[string]string {
	if len(filter) == 0 {
		return nil
	}

	normalized := make(map[string]string)
	keys := make([]string, 0, len(filter))
	for key, value := range filter {
		trimmedKey := strings.TrimSpace(key)
		trimmedValue := strings.TrimSpace(value)
		if trimmedKey == "" || trimmedValue == "" {
			continue
		}
		if _, exists := normalized[trimmedKey]; exists {
			continue
		}
		normalized[trimmedKey] = trimmedValue
		keys = append(keys, trimmedKey)
	}
	if len(normalized) == 0 {
		return nil
	}

	sort.Strings(keys)
	ordered := make(map[string]string, len(keys))
	for _, key := range keys {
		ordered[key] = normalized[key]
	}
	return ordered
}

func botTriggerViewFromStore(trigger store.BotTrigger) BotTriggerView {
	return BotTriggerView{
		ID:               strings.TrimSpace(trigger.ID),
		WorkspaceID:      strings.TrimSpace(trigger.WorkspaceID),
		BotID:            strings.TrimSpace(trigger.BotID),
		Type:             strings.TrimSpace(trigger.Type),
		DeliveryTargetID: strings.TrimSpace(trigger.DeliveryTargetID),
		Filter:           cloneStringMapLocal(trigger.Filter),
		Enabled:          trigger.Enabled,
		CreatedAt:        trigger.CreatedAt,
		UpdatedAt:        trigger.UpdatedAt,
	}
}

func managedTriggerID(subscriptionID string, deliveryTargetID string) string {
	return strings.Join([]string{
		managedTriggerIDPrefix,
		strings.TrimSpace(subscriptionID),
		strings.TrimSpace(deliveryTargetID),
	}, ":")
}

func parseManagedTriggerID(triggerID string) (string, string, bool) {
	parts := strings.Split(strings.TrimSpace(triggerID), ":")
	if len(parts) != 3 || parts[0] != managedTriggerIDPrefix {
		return "", "", false
	}
	subscriptionID := strings.TrimSpace(parts[1])
	deliveryTargetID := strings.TrimSpace(parts[2])
	if subscriptionID == "" || deliveryTargetID == "" {
		return "", "", false
	}
	return subscriptionID, deliveryTargetID, true
}

func managedSubscriptionMatchesTriggerCompatView(subscription store.NotificationSubscription) bool {
	if strings.TrimSpace(subscription.Topic) != managedNotificationTriggerTopic {
		return false
	}
	sourceType := strings.TrimSpace(subscription.SourceType)
	return sourceType == "" || sourceType == managedNotificationTriggerSourceType
}

func managedTriggerViewFromSubscription(
	subscription store.NotificationSubscription,
	target store.BotDeliveryTarget,
) BotTriggerView {
	return BotTriggerView{
		ID:               managedTriggerID(subscription.ID, target.ID),
		WorkspaceID:      strings.TrimSpace(subscription.WorkspaceID),
		BotID:            strings.TrimSpace(target.BotID),
		Type:             "notification",
		DeliveryTargetID: strings.TrimSpace(target.ID),
		Filter:           cloneStringMapLocal(subscription.Filter),
		Enabled:          subscription.Enabled,
		CreatedAt:        subscription.CreatedAt,
		UpdatedAt:        subscription.UpdatedAt,
	}
}

func (s *Service) listManagedTriggerViews(workspaceID string, botID string) []BotTriggerView {
	views := make([]BotTriggerView, 0)
	for _, subscription := range s.store.ListNotificationSubscriptions(workspaceID) {
		if !managedSubscriptionMatchesTriggerCompatView(subscription) {
			continue
		}
		for _, channel := range subscription.Channels {
			if strings.TrimSpace(channel.Channel) != "bot" {
				continue
			}
			if strings.TrimSpace(channel.TargetRefType) != "bot_delivery_target" {
				continue
			}
			target, ok := s.store.GetBotDeliveryTarget(workspaceID, channel.TargetRefID)
			if !ok || strings.TrimSpace(target.BotID) != strings.TrimSpace(botID) {
				continue
			}
			views = append(views, managedTriggerViewFromSubscription(subscription, target))
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

func (s *Service) createManagedTrigger(
	workspaceID string,
	botID string,
	input UpsertBotTriggerInput,
) (BotTriggerView, error) {
	triggerType := normalizeBotTriggerType(input.Type)
	if triggerType != "notification" {
		return BotTriggerView{}, fmt.Errorf("%w: unsupported bot trigger type %q", ErrInvalidInput, input.Type)
	}

	targetID := strings.TrimSpace(input.DeliveryTargetID)
	target, ok := s.store.GetBotDeliveryTarget(workspaceID, targetID)
	if !ok || strings.TrimSpace(target.BotID) != strings.TrimSpace(botID) {
		return BotTriggerView{}, store.ErrBotDeliveryTargetNotFound
	}

	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}

	subscription, err := s.store.CreateNotificationSubscription(store.NotificationSubscription{
		WorkspaceID: workspaceID,
		Topic:       managedNotificationTriggerTopic,
		SourceType:  managedNotificationTriggerSourceType,
		Filter:      normalizeBotTriggerFilter(input.Filter),
		Channels: []store.NotificationChannelBinding{{
			Channel:       "bot",
			TargetRefType: "bot_delivery_target",
			TargetRefID:   target.ID,
		}},
		Enabled: enabled,
	})
	if err != nil {
		return BotTriggerView{}, err
	}

	view := managedTriggerViewFromSubscription(subscription, target)
	s.publish(workspaceID, "", "bot/trigger/created", map[string]any{
		"botId":            botID,
		"triggerId":        view.ID,
		"type":             view.Type,
		"deliveryTargetId": view.DeliveryTargetID,
		"enabled":          view.Enabled,
		"managedBy":        "notification_center",
	})
	return view, nil
}

func (s *Service) updateManagedTrigger(
	workspaceID string,
	botID string,
	triggerID string,
	input UpsertBotTriggerInput,
) (BotTriggerView, error) {
	subscriptionID, currentTargetID, ok := parseManagedTriggerID(triggerID)
	if !ok {
		return BotTriggerView{}, store.ErrBotTriggerNotFound
	}
	subscription, ok := s.store.GetNotificationSubscription(workspaceID, subscriptionID)
	if !ok || !managedSubscriptionMatchesTriggerCompatView(subscription) {
		return BotTriggerView{}, store.ErrBotTriggerNotFound
	}
	currentTarget, ok := s.store.GetBotDeliveryTarget(workspaceID, currentTargetID)
	if !ok || strings.TrimSpace(currentTarget.BotID) != strings.TrimSpace(botID) {
		return BotTriggerView{}, store.ErrBotTriggerNotFound
	}

	triggerType := normalizeBotTriggerType(firstNonEmpty(strings.TrimSpace(input.Type), "notification"))
	if triggerType != "notification" {
		return BotTriggerView{}, fmt.Errorf("%w: unsupported bot trigger type %q", ErrInvalidInput, input.Type)
	}

	nextTargetID := strings.TrimSpace(input.DeliveryTargetID)
	if nextTargetID == "" {
		nextTargetID = currentTarget.ID
	}
	nextTarget, ok := s.store.GetBotDeliveryTarget(workspaceID, nextTargetID)
	if !ok || strings.TrimSpace(nextTarget.BotID) != strings.TrimSpace(botID) {
		return BotTriggerView{}, store.ErrBotDeliveryTargetNotFound
	}

	nextFilter := cloneStringMapLocal(subscription.Filter)
	if input.Filter != nil {
		nextFilter = normalizeBotTriggerFilter(input.Filter)
	}
	nextEnabled := subscription.Enabled
	if input.Enabled != nil {
		nextEnabled = *input.Enabled
	}

	updated, err := s.store.UpdateNotificationSubscription(
		workspaceID,
		subscription.ID,
		func(current store.NotificationSubscription) store.NotificationSubscription {
			current.Topic = managedNotificationTriggerTopic
			current.SourceType = managedNotificationTriggerSourceType
			current.Filter = cloneStringMapLocal(nextFilter)
			current.Enabled = nextEnabled

			nextChannels := make([]store.NotificationChannelBinding, 0, len(current.Channels))
			replaced := false
			for _, channel := range current.Channels {
				if strings.TrimSpace(channel.Channel) == "bot" &&
					strings.TrimSpace(channel.TargetRefType) == "bot_delivery_target" &&
					strings.TrimSpace(channel.TargetRefID) == currentTargetID &&
					!replaced {
					channel.TargetRefID = nextTarget.ID
					nextChannels = append(nextChannels, channel)
					replaced = true
					continue
				}
				nextChannels = append(nextChannels, channel)
			}
			if !replaced {
				nextChannels = append(nextChannels, store.NotificationChannelBinding{
					Channel:       "bot",
					TargetRefType: "bot_delivery_target",
					TargetRefID:   nextTarget.ID,
				})
			}
			current.Channels = nextChannels
			return current
		},
	)
	if err != nil {
		return BotTriggerView{}, err
	}

	view := managedTriggerViewFromSubscription(updated, nextTarget)
	s.publish(workspaceID, "", "bot/trigger/updated", map[string]any{
		"botId":            botID,
		"triggerId":        view.ID,
		"type":             view.Type,
		"deliveryTargetId": view.DeliveryTargetID,
		"enabled":          view.Enabled,
		"managedBy":        "notification_center",
	})
	return view, nil
}

func (s *Service) deleteManagedTrigger(workspaceID string, botID string, triggerID string) error {
	subscriptionID, deliveryTargetID, ok := parseManagedTriggerID(triggerID)
	if !ok {
		return store.ErrBotTriggerNotFound
	}
	subscription, ok := s.store.GetNotificationSubscription(workspaceID, subscriptionID)
	if !ok || !managedSubscriptionMatchesTriggerCompatView(subscription) {
		return store.ErrBotTriggerNotFound
	}
	target, ok := s.store.GetBotDeliveryTarget(workspaceID, deliveryTargetID)
	if !ok || strings.TrimSpace(target.BotID) != strings.TrimSpace(botID) {
		return store.ErrBotTriggerNotFound
	}

	nextChannels := make([]store.NotificationChannelBinding, 0, len(subscription.Channels))
	removed := false
	for _, channel := range subscription.Channels {
		if strings.TrimSpace(channel.Channel) == "bot" &&
			strings.TrimSpace(channel.TargetRefType) == "bot_delivery_target" &&
			strings.TrimSpace(channel.TargetRefID) == deliveryTargetID &&
			!removed {
			removed = true
			continue
		}
		nextChannels = append(nextChannels, channel)
	}
	if !removed {
		return store.ErrBotTriggerNotFound
	}

	if len(nextChannels) == 0 {
		if err := s.store.DeleteNotificationSubscription(workspaceID, subscription.ID); err != nil {
			return err
		}
	} else {
		if _, err := s.store.UpdateNotificationSubscription(
			workspaceID,
			subscription.ID,
			func(current store.NotificationSubscription) store.NotificationSubscription {
				current.Channels = nextChannels
				return current
			},
		); err != nil {
			return err
		}
	}

	s.publish(workspaceID, "", "bot/trigger/deleted", map[string]any{
		"botId":     botID,
		"triggerId": triggerID,
		"managedBy": "notification_center",
	})
	return nil
}

func (s *Service) ListTriggers(workspaceID string, botID string) ([]BotTriggerView, error) {
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return nil, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return nil, store.ErrBotNotFound
	}

	items := s.store.ListBotTriggers(resolvedWorkspaceID, store.BotTriggerFilter{BotID: botID})
	views := make([]BotTriggerView, 0, len(items))
	for _, item := range items {
		views = append(views, botTriggerViewFromStore(item))
	}
	if s.notificationCenterManagedTriggers {
		views = append(views, s.listManagedTriggerViews(resolvedWorkspaceID, botID)...)
		sort.Slice(views, func(i int, j int) bool {
			if views[i].UpdatedAt.Equal(views[j].UpdatedAt) {
				return views[i].ID < views[j].ID
			}
			return views[i].UpdatedAt.After(views[j].UpdatedAt)
		})
	}
	return views, nil
}

func (s *Service) CreateTrigger(
	ctx context.Context,
	workspaceID string,
	botID string,
	input UpsertBotTriggerInput,
) (BotTriggerView, error) {
	_ = ctx
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return BotTriggerView{}, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return BotTriggerView{}, store.ErrBotNotFound
	}

	if s.notificationCenterManagedTriggers {
		return s.createManagedTrigger(resolvedWorkspaceID, botID, input)
	}

	triggerType := normalizeBotTriggerType(input.Type)
	if triggerType != "notification" {
		return BotTriggerView{}, fmt.Errorf("%w: unsupported bot trigger type %q", ErrInvalidInput, input.Type)
	}
	if _, ok := s.store.GetBotDeliveryTarget(resolvedWorkspaceID, strings.TrimSpace(input.DeliveryTargetID)); !ok {
		return BotTriggerView{}, store.ErrBotDeliveryTargetNotFound
	}

	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}

	trigger, err := s.store.CreateBotTrigger(store.BotTrigger{
		WorkspaceID:      resolvedWorkspaceID,
		BotID:            strings.TrimSpace(botID),
		Type:             triggerType,
		DeliveryTargetID: strings.TrimSpace(input.DeliveryTargetID),
		Filter:           normalizeBotTriggerFilter(input.Filter),
		Enabled:          enabled,
	})
	if err != nil {
		return BotTriggerView{}, err
	}

	s.publish(resolvedWorkspaceID, "", "bot/trigger/created", map[string]any{
		"botId":            botID,
		"triggerId":        trigger.ID,
		"type":             trigger.Type,
		"deliveryTargetId": trigger.DeliveryTargetID,
		"enabled":          trigger.Enabled,
	})
	return botTriggerViewFromStore(trigger), nil
}

func (s *Service) UpdateTrigger(
	ctx context.Context,
	workspaceID string,
	botID string,
	triggerID string,
	input UpsertBotTriggerInput,
) (BotTriggerView, error) {
	_ = ctx
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return BotTriggerView{}, err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return BotTriggerView{}, store.ErrBotNotFound
	}

	if s.notificationCenterManagedTriggers {
		if _, _, ok := parseManagedTriggerID(triggerID); ok {
			return s.updateManagedTrigger(resolvedWorkspaceID, botID, triggerID, input)
		}
	}

	trigger, ok := s.store.GetBotTrigger(resolvedWorkspaceID, triggerID)
	if !ok || strings.TrimSpace(trigger.BotID) != strings.TrimSpace(botID) {
		return BotTriggerView{}, store.ErrBotTriggerNotFound
	}

	triggerType := normalizeBotTriggerType(firstNonEmpty(strings.TrimSpace(input.Type), trigger.Type))
	if triggerType != "notification" {
		return BotTriggerView{}, fmt.Errorf("%w: unsupported bot trigger type %q", ErrInvalidInput, input.Type)
	}

	nextFilter := cloneStringMapLocal(trigger.Filter)
	if input.Filter != nil {
		nextFilter = normalizeBotTriggerFilter(input.Filter)
	}
	nextEnabled := trigger.Enabled
	if input.Enabled != nil {
		nextEnabled = *input.Enabled
	}
	nextTargetID := strings.TrimSpace(input.DeliveryTargetID)
	if nextTargetID == "" {
		nextTargetID = strings.TrimSpace(trigger.DeliveryTargetID)
	}

	updated, err := s.store.UpdateBotTrigger(resolvedWorkspaceID, trigger.ID, func(current store.BotTrigger) store.BotTrigger {
		current.DeliveryTargetID = nextTargetID
		current.Filter = cloneStringMapLocal(nextFilter)
		current.Enabled = nextEnabled
		return current
	})
	if err != nil {
		return BotTriggerView{}, err
	}

	s.publish(resolvedWorkspaceID, "", "bot/trigger/updated", map[string]any{
		"botId":            botID,
		"triggerId":        updated.ID,
		"type":             updated.Type,
		"deliveryTargetId": updated.DeliveryTargetID,
		"enabled":          updated.Enabled,
	})
	return botTriggerViewFromStore(updated), nil
}

func (s *Service) DeleteTrigger(ctx context.Context, workspaceID string, botID string, triggerID string) error {
	_ = ctx
	resolvedWorkspaceID, err := s.requireWorkspaceID(workspaceID)
	if err != nil {
		return err
	}
	if _, ok := s.store.GetBot(resolvedWorkspaceID, botID); !ok {
		return store.ErrBotNotFound
	}

	if s.notificationCenterManagedTriggers {
		if _, _, ok := parseManagedTriggerID(triggerID); ok {
			return s.deleteManagedTrigger(resolvedWorkspaceID, botID, triggerID)
		}
	}

	trigger, ok := s.store.GetBotTrigger(resolvedWorkspaceID, triggerID)
	if !ok || strings.TrimSpace(trigger.BotID) != strings.TrimSpace(botID) {
		return store.ErrBotTriggerNotFound
	}
	if err := s.store.DeleteBotTrigger(resolvedWorkspaceID, trigger.ID); err != nil {
		return err
	}

	s.publish(resolvedWorkspaceID, "", "bot/trigger/deleted", map[string]any{
		"botId":     botID,
		"triggerId": trigger.ID,
	})
	return nil
}
