package configfs

import "testing"

func TestConfigWriteRequiresRuntimeReload(t *testing.T) {
	t.Parallel()

	for _, keyPath := range []string{
		"shell_environment_policy",
		"shell_environment_policy.set.PATHEXT",
		"sandbox_mode",
		"sandbox_workspace_write.network_access",
		"approval_policy",
		"model",
		"model_reasoning_effort",
		"service_tier",
	} {
		if !ConfigWriteRequiresRuntimeReload(keyPath) {
			t.Fatalf("expected %q to require runtime reload", keyPath)
		}
	}

	for _, keyPath := range []string{
		"theme",
		"ui.scale",
		"notifications.enabled",
	} {
		if ConfigWriteRequiresRuntimeReload(keyPath) {
			t.Fatalf("expected %q to not require runtime reload", keyPath)
		}
	}
}

func TestMatchingRuntimeSensitiveConfigPrefix(t *testing.T) {
	t.Parallel()

	if got := MatchingRuntimeSensitiveConfigPrefix("shell_environment_policy.set.PATHEXT"); got != "shell_environment_policy" {
		t.Fatalf("expected shell_environment_policy prefix, got %q", got)
	}

	if got := MatchingRuntimeSensitiveConfigPrefix("model_reasoning_effort"); got != "model_reasoning_effort" {
		t.Fatalf("expected model_reasoning_effort prefix, got %q", got)
	}

	if got := MatchingRuntimeSensitiveConfigPrefix("ui.theme"); got != "" {
		t.Fatalf("expected no runtime-sensitive prefix, got %q", got)
	}
}
