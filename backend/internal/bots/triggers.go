package bots

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"codex-server/backend/internal/store"
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
