package notificationcenter

import (
	"strings"

	"codex-server/backend/internal/store"
)

func subscriptionMatchesEvent(subscription store.NotificationSubscription, event normalizedEvent) bool {
	if !subscription.Enabled {
		return false
	}
	if strings.TrimSpace(subscription.WorkspaceID) != strings.TrimSpace(event.WorkspaceID) {
		return false
	}
	if strings.TrimSpace(subscription.Topic) != strings.TrimSpace(event.Topic) {
		return false
	}
	if sourceType := strings.TrimSpace(subscription.SourceType); sourceType != "" && sourceType != strings.TrimSpace(event.SourceType) {
		return false
	}
	return attributesMatchFilter(subscription.Filter, event.Attributes)
}

func legacyTriggerMatchesEvent(trigger store.BotTrigger, event normalizedEvent) bool {
	if !trigger.Enabled {
		return false
	}
	if strings.TrimSpace(trigger.Type) != "notification" {
		return false
	}
	if strings.TrimSpace(event.Topic) != "system.notification.created" {
		return false
	}
	return attributesMatchFilter(trigger.Filter, event.Attributes)
}

func attributesMatchFilter(filter map[string]string, attributes map[string]string) bool {
	if len(filter) == 0 {
		return true
	}
	for key, expectedValue := range filter {
		trimmedKey := strings.TrimSpace(key)
		trimmedExpected := strings.TrimSpace(expectedValue)
		if trimmedKey == "" || trimmedExpected == "" {
			continue
		}
		if strings.TrimSpace(attributes[trimmedKey]) != trimmedExpected {
			return false
		}
	}
	return true
}
