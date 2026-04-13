package bots

import (
	"context"
	"fmt"
	"strings"

	"codex-server/backend/internal/store"
)

func (s *Service) startTriggerDispatcher(ctx context.Context) {
	s.mu.Lock()
	if s.events == nil || s.triggerDispatcherStarted {
		s.mu.Unlock()
		return
	}
	s.triggerDispatcherStarted = true
	s.mu.Unlock()

	eventsCh, cancel := s.events.SubscribeAllWithSource(
		"bots.trigger_dispatcher",
		"bot-trigger-dispatcher",
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
				s.handleTriggerEvent(ctx, event)
			}
		}
	}()
}

func (s *Service) handleTriggerEvent(ctx context.Context, event store.EventEnvelope) {
	if strings.ToLower(strings.TrimSpace(event.Method)) != "notification/created" {
		return
	}

	workspaceID := strings.TrimSpace(event.WorkspaceID)
	if workspaceID == "" {
		return
	}

	payload := eventPayloadStringMap(event.Payload)
	notificationID := strings.TrimSpace(payload["notificationId"])
	if notificationID == "" {
		return
	}

	triggers := s.store.ListBotTriggers(workspaceID, store.BotTriggerFilter{
		Type:    "notification",
		Enabled: boolPointer(true),
	})
	for _, trigger := range triggers {
		if !notificationTriggerMatchesFilter(trigger.Filter, payload) {
			continue
		}
		s.dispatchNotificationTrigger(ctx, workspaceID, trigger, payload)
	}
}

func (s *Service) dispatchNotificationTrigger(
	ctx context.Context,
	workspaceID string,
	trigger store.BotTrigger,
	payload map[string]string,
) {
	notificationID := strings.TrimSpace(payload["notificationId"])
	if notificationID == "" {
		return
	}

	text := formatNotificationTriggerText(payload)
	if text == "" {
		return
	}

	_, err := s.SendDeliveryTargetOutboundMessages(ctx, workspaceID, trigger.BotID, trigger.DeliveryTargetID, SendOutboundMessagesInput{
		TriggerID:      trigger.ID,
		SourceType:     "notification",
		SourceRefType:  "notification",
		SourceRefID:    notificationID,
		IdempotencyKey: fmt.Sprintf("notification:%s:trigger:%s", notificationID, trigger.ID),
		Messages: []store.BotReplyMessage{
			{Text: text},
		},
	})
	if err == nil {
		return
	}

	target, ok := s.store.GetBotDeliveryTarget(workspaceID, trigger.DeliveryTargetID)
	if !ok {
		return
	}
	s.appendConnectionLog(
		workspaceID,
		target.ConnectionID,
		"error",
		"notification_trigger_delivery_failed",
		fmt.Sprintf(
			"Notification trigger %s could not deliver notification %s: %s",
			trigger.ID,
			notificationID,
			failureReplyDetail(err),
		),
	)
}

func boolPointer(value bool) *bool {
	next := value
	return &next
}

func notificationTriggerMatchesFilter(filter map[string]string, payload map[string]string) bool {
	if len(filter) == 0 {
		return true
	}

	for key, expectedValue := range filter {
		actualValue := strings.TrimSpace(payload[strings.TrimSpace(key)])
		if actualValue != strings.TrimSpace(expectedValue) {
			return false
		}
	}
	return true
}

func formatNotificationTriggerText(payload map[string]string) string {
	title := strings.TrimSpace(payload["title"])
	message := strings.TrimSpace(payload["message"])

	switch {
	case title == "" && message == "":
		return ""
	case title == "":
		return message
	case message == "", message == title:
		return title
	default:
		return title + "\n" + message
	}
}

func eventPayloadStringMap(payload any) map[string]string {
	source, ok := payload.(map[string]any)
	if !ok || len(source) == 0 {
		return nil
	}

	normalized := make(map[string]string, len(source))
	for key, value := range source {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" || value == nil {
			continue
		}
		normalized[trimmedKey] = strings.TrimSpace(fmt.Sprint(value))
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}
