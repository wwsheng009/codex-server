package bridge

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	appconfig "codex-server/backend/internal/config"
)

func TestBuildInitializeRequestOmitsOptOutNotificationsByDefault(t *testing.T) {
	t.Parallel()

	request := buildInitializeRequest(Config{
		ClientName:      "codex-server",
		ClientVersion:   "0.1.0",
		ExperimentalAPI: true,
	})

	if request.Capabilities.ExperimentalAPI != true {
		t.Fatal("expected experimental API to stay enabled")
	}
	if len(request.Capabilities.OptOutNotificationMethods) != 0 {
		t.Fatalf("expected no opt-out notifications, got %#v", request.Capabilities.OptOutNotificationMethods)
	}

	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if strings.Contains(string(payload), "optOutNotificationMethods") {
		t.Fatalf("expected initialize payload to omit optOutNotificationMethods, got %s", string(payload))
	}
}

func TestBuildInitializeRequestIncludesOptOutNotificationsWhenConfigured(t *testing.T) {
	t.Parallel()

	expected := []string{
		"item/agentMessage/delta",
		"item/reasoning/textDelta",
	}
	request := buildInitializeRequest(Config{
		ClientName:                "codex-server",
		ClientVersion:             "0.1.0",
		ExperimentalAPI:           true,
		OptOutNotificationMethods: expected,
	})

	if !reflect.DeepEqual(request.Capabilities.OptOutNotificationMethods, expected) {
		t.Fatalf("expected opt-out notifications %#v, got %#v", expected, request.Capabilities.OptOutNotificationMethods)
	}

	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if !strings.Contains(string(payload), `"optOutNotificationMethods":["item/agentMessage/delta","item/reasoning/textDelta"]`) {
		t.Fatalf("expected initialize payload to include optOutNotificationMethods, got %s", string(payload))
	}
}

func TestResolveLaunchConfigPrefersStructuredLaunchConfig(t *testing.T) {
	t.Parallel()

	launchConfig := resolveLaunchConfig(Config{
		Command: "ignored fallback command",
		LaunchConfig: appconfig.RuntimeLaunchConfig{
			BaseCommand:               "codex app-server --listen stdio://",
			Command:                   `codex app-server --listen stdio:// --config "model_catalog_json=E:/tmp/catalog.json"`,
			EffectiveModelCatalogPath: "E:/tmp/catalog.json",
		},
	})

	if launchConfig.Command != `codex app-server --listen stdio:// --config "model_catalog_json=E:/tmp/catalog.json"` {
		t.Fatalf("expected structured launch command to win, got %q", launchConfig.Command)
	}
	if launchConfig.BaseCommand != "codex app-server --listen stdio://" {
		t.Fatalf("expected structured base command to be preserved, got %q", launchConfig.BaseCommand)
	}
	if launchConfig.EffectiveModelCatalogPath != "E:/tmp/catalog.json" {
		t.Fatalf("expected effective model catalog path to be preserved, got %q", launchConfig.EffectiveModelCatalogPath)
	}
}
