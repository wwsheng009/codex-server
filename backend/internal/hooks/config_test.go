package hooks

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"codex-server/backend/internal/store"
)

func TestResolveConfigurationMergesWorkspaceHooksFileAndRuntimeOverrides(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	configPath := filepath.Join(rootDir, ".codex", "hooks.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		configPath,
		[]byte(`{
  "sessionStart": {
    "enabled": false,
    "contextPaths": [" docs\\\\session-start.md "],
    "maxChars": 1024
  },
  "userPromptSubmit": {
    "blockSecretPasteEnabled": false
  },
  "preToolUse": {
    "blockDangerousCommandEnabled": false,
    "additionalProtectedGovernancePaths": [" docs\\\\governance.md ", "./docs//governance.md"]
  }
}`),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	sessionStartEnabled := true
	sessionStartMaxChars := 512
	userPromptBlockEnabled := true
	runtimeProtectedGovernancePaths := []string{" runtime/governance.md ", "docs\\governance.md"}
	result := ResolveConfiguration(
		store.Workspace{
			ID:       "ws-1",
			RootPath: rootDir,
		},
		store.RuntimePreferences{
			HookSessionStartEnabled:                          &sessionStartEnabled,
			HookSessionStartMaxChars:                         &sessionStartMaxChars,
			HookUserPromptSubmitBlockSecretPasteEnabled:      &userPromptBlockEnabled,
			HookPreToolUseAdditionalProtectedGovernancePaths: runtimeProtectedGovernancePaths,
		},
	)

	if result.LoadStatus != WorkspaceConfigLoadStatusLoaded {
		t.Fatalf("expected loaded status, got %#v", result.LoadStatus)
	}
	if result.LoadedFromPath != configPath {
		t.Fatalf("expected loaded path %q, got %q", configPath, result.LoadedFromPath)
	}
	if len(result.SearchedPaths) != 2 {
		t.Fatalf("expected two searched paths, got %#v", result.SearchedPaths)
	}

	wantBaselinePaths := []string{"docs/session-start.md"}
	if result.BaselineHookSessionStartEnabled == nil || *result.BaselineHookSessionStartEnabled {
		t.Fatalf("unexpected baseline session-start enabled %#v", result.BaselineHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(result.BaselineHookSessionStartContextPaths, wantBaselinePaths) {
		t.Fatalf("expected baseline context paths %#v, got %#v", wantBaselinePaths, result.BaselineHookSessionStartContextPaths)
	}
	if result.BaselineHookSessionStartMaxChars == nil || *result.BaselineHookSessionStartMaxChars != 1024 {
		t.Fatalf("unexpected baseline max chars %#v", result.BaselineHookSessionStartMaxChars)
	}
	if result.BaselineHookPreToolUseBlockDangerousCommandEnabled == nil || *result.BaselineHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("unexpected baseline pre-tool flag %#v", result.BaselineHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !reflect.DeepEqual(
		result.BaselineHookPreToolUseAdditionalProtectedGovernancePaths,
		[]string{"docs/governance.md"},
	) {
		t.Fatalf(
			"unexpected baseline additional protected governance paths %#v",
			result.BaselineHookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}

	if result.ConfiguredHookSessionStartEnabled == nil || !*result.ConfiguredHookSessionStartEnabled {
		t.Fatalf("unexpected configured session-start enabled %#v", result.ConfiguredHookSessionStartEnabled)
	}
	if result.ConfiguredHookSessionStartMaxChars == nil || *result.ConfiguredHookSessionStartMaxChars != 512 {
		t.Fatalf("unexpected configured max chars %#v", result.ConfiguredHookSessionStartMaxChars)
	}
	if result.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled == nil || !*result.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("unexpected configured user-prompt flag %#v", result.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if !reflect.DeepEqual(
		result.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		[]string{"runtime/governance.md", "docs/governance.md"},
	) {
		t.Fatalf(
			"unexpected configured runtime protected governance paths %#v",
			result.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}

	if !result.EffectiveHookSessionStartEnabled {
		t.Fatalf("expected runtime override to enable session-start, got %#v", result.EffectiveHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(result.EffectiveHookSessionStartContextPaths, wantBaselinePaths) {
		t.Fatalf("expected workspace baseline context paths %#v, got %#v", wantBaselinePaths, result.EffectiveHookSessionStartContextPaths)
	}
	if result.EffectiveHookSessionStartMaxChars != 512 {
		t.Fatalf("expected runtime override max chars 512, got %d", result.EffectiveHookSessionStartMaxChars)
	}
	if !result.EffectiveHookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("expected runtime override to enable user-prompt block, got %#v", result.EffectiveHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if result.EffectiveHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("expected workspace baseline to disable pre-tool block, got %#v", result.EffectiveHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !reflect.DeepEqual(
		result.EffectiveHookPreToolUseProtectedGovernancePaths,
		append(DefaultProtectedGovernancePaths(), "docs/governance.md", "runtime/governance.md"),
	) {
		t.Fatalf(
			"unexpected effective protected governance paths %#v",
			result.EffectiveHookPreToolUseProtectedGovernancePaths,
		)
	}

	if result.EffectiveHookSessionStartEnabledSource != ConfigSourceRuntime {
		t.Fatalf("expected runtime source for session-start enabled, got %q", result.EffectiveHookSessionStartEnabledSource)
	}
	if result.EffectiveHookSessionStartContextPathsSource != ConfigSourceWorkspace {
		t.Fatalf("expected workspace source for context paths, got %q", result.EffectiveHookSessionStartContextPathsSource)
	}
	if result.EffectiveHookSessionStartMaxCharsSource != ConfigSourceRuntime {
		t.Fatalf("expected runtime source for max chars, got %q", result.EffectiveHookSessionStartMaxCharsSource)
	}
	if result.EffectiveHookUserPromptSubmitBlockSecretPasteSource != ConfigSourceRuntime {
		t.Fatalf("expected runtime source for user-prompt block, got %q", result.EffectiveHookUserPromptSubmitBlockSecretPasteSource)
	}
	if result.EffectiveHookPreToolUseDangerousCommandBlockSource != ConfigSourceWorkspace {
		t.Fatalf("expected workspace source for pre-tool block, got %q", result.EffectiveHookPreToolUseDangerousCommandBlockSource)
	}
	if result.EffectiveHookPreToolUseProtectedGovernancePathsSource != ConfigSourceRuntime {
		t.Fatalf("expected runtime source for protected governance paths, got %q", result.EffectiveHookPreToolUseProtectedGovernancePathsSource)
	}
}

func TestResolveConfigurationFallsBackToDefaultsWhenWorkspaceHooksFileIsInvalid(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	configPath := filepath.Join(rootDir, ".codex", "hooks.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(configPath, []byte(`{"sessionStart":{"maxChars":0}}`), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	result := ResolveConfiguration(
		store.Workspace{
			ID:       "ws-1",
			RootPath: rootDir,
		},
		store.RuntimePreferences{},
	)

	if result.LoadStatus != WorkspaceConfigLoadStatusError {
		t.Fatalf("expected load error status, got %#v", result.LoadStatus)
	}
	if result.LoadedFromPath != configPath {
		t.Fatalf("expected invalid config path %q, got %q", configPath, result.LoadedFromPath)
	}
	if !strings.Contains(result.LoadError, "sessionStart.maxChars") {
		t.Fatalf("expected validation error to mention maxChars, got %q", result.LoadError)
	}
	if result.EffectiveHookSessionStartEnabled != DefaultSessionStartEnabled {
		t.Fatalf("expected default session-start enabled on invalid file, got %#v", result.EffectiveHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(result.EffectiveHookSessionStartContextPaths, DefaultSessionStartContextPaths()) {
		t.Fatalf("expected default session-start paths, got %#v", result.EffectiveHookSessionStartContextPaths)
	}
	if result.EffectiveHookSessionStartMaxChars != DefaultSessionStartMaxChars {
		t.Fatalf("expected default max chars %d, got %d", DefaultSessionStartMaxChars, result.EffectiveHookSessionStartMaxChars)
	}
	if result.EffectiveHookSessionStartEnabledSource != ConfigSourceDefault {
		t.Fatalf("expected default source, got %q", result.EffectiveHookSessionStartEnabledSource)
	}
	if !reflect.DeepEqual(result.EffectiveHookPreToolUseProtectedGovernancePaths, DefaultProtectedGovernancePaths()) {
		t.Fatalf("expected default protected governance paths, got %#v", result.EffectiveHookPreToolUseProtectedGovernancePaths)
	}
	if result.EffectiveHookPreToolUseProtectedGovernancePathsSource != ConfigSourceDefault {
		t.Fatalf("expected default protected governance path source, got %q", result.EffectiveHookPreToolUseProtectedGovernancePathsSource)
	}
}
