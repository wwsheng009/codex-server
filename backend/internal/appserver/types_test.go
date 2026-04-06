package appserver

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestInitializeCapabilitiesOmitsOptOutNotificationsWhenUnset(t *testing.T) {
	t.Parallel()

	payload, err := json.Marshal(InitializeCapabilities{
		ExperimentalAPI: true,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	text := string(payload)
	if !strings.Contains(text, `"experimentalApi":true`) {
		t.Fatalf("expected experimentalApi field, got %s", text)
	}
	if strings.Contains(text, "optOutNotificationMethods") {
		t.Fatalf("expected optOutNotificationMethods to be omitted, got %s", text)
	}
}

func TestInitializeCapabilitiesIncludesOptOutNotificationsWhenConfigured(t *testing.T) {
	t.Parallel()

	payload, err := json.Marshal(InitializeCapabilities{
		ExperimentalAPI: true,
		OptOutNotificationMethods: []string{
			"item/agentMessage/delta",
			"item/reasoning/textDelta",
		},
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	text := string(payload)
	if !strings.Contains(text, `"optOutNotificationMethods":["item/agentMessage/delta","item/reasoning/textDelta"]`) {
		t.Fatalf("expected optOutNotificationMethods field, got %s", text)
	}
}
