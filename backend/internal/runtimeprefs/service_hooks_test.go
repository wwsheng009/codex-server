package runtimeprefs

import (
	"reflect"
	"testing"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/hooks"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

func TestRuntimePreferencesReadIncludesHookDefaults(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	result, err := service.Read()
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}

	if result.ConfiguredHookSessionStartEnabled != nil {
		t.Fatalf("expected no configured session-start enabled override, got %#v", result.ConfiguredHookSessionStartEnabled)
	}
	if len(result.ConfiguredHookSessionStartContextPaths) != 0 {
		t.Fatalf("expected no configured session-start context paths, got %#v", result.ConfiguredHookSessionStartContextPaths)
	}
	if result.ConfiguredHookSessionStartMaxChars != nil {
		t.Fatalf("expected no configured session-start max chars override, got %#v", result.ConfiguredHookSessionStartMaxChars)
	}
	if result.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled != nil {
		t.Fatalf("expected no configured secret-block override, got %#v", result.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if result.ConfiguredHookPreToolUseBlockDangerousCommandEnabled != nil {
		t.Fatalf("expected no configured pre-tool dangerous-command override, got %#v", result.ConfiguredHookPreToolUseBlockDangerousCommandEnabled)
	}
	if len(result.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths) != 0 {
		t.Fatalf(
			"expected no configured protected governance path overrides, got %#v",
			result.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}

	wantPaths := hooks.DefaultSessionStartContextPaths()
	wantProtectedPaths := hooks.DefaultProtectedGovernancePaths()
	if result.DefaultHookSessionStartEnabled != hooks.DefaultSessionStartEnabled {
		t.Fatalf("unexpected default session-start enabled %t", result.DefaultHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(result.DefaultHookSessionStartContextPaths, wantPaths) {
		t.Fatalf("expected default session-start paths %#v, got %#v", wantPaths, result.DefaultHookSessionStartContextPaths)
	}
	if result.DefaultHookSessionStartMaxChars != hooks.DefaultSessionStartMaxChars {
		t.Fatalf("unexpected default session-start max chars %d", result.DefaultHookSessionStartMaxChars)
	}
	if result.DefaultHookUserPromptSubmitBlockSecretPasteEnabled != hooks.DefaultUserPromptSecretBlockEnabled {
		t.Fatalf("unexpected default secret-block enabled %t", result.DefaultHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if result.DefaultHookPreToolUseBlockDangerousCommandEnabled != hooks.DefaultPreToolUseDangerousCommandBlockEnabled {
		t.Fatalf("unexpected default pre-tool dangerous-command enabled %t", result.DefaultHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !reflect.DeepEqual(result.DefaultHookPreToolUseProtectedGovernancePaths, wantProtectedPaths) {
		t.Fatalf(
			"expected default protected governance paths %#v, got %#v",
			wantProtectedPaths,
			result.DefaultHookPreToolUseProtectedGovernancePaths,
		)
	}

	if result.EffectiveHookSessionStartEnabled != hooks.DefaultSessionStartEnabled {
		t.Fatalf("unexpected effective session-start enabled %t", result.EffectiveHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(result.EffectiveHookSessionStartContextPaths, wantPaths) {
		t.Fatalf("expected effective session-start paths %#v, got %#v", wantPaths, result.EffectiveHookSessionStartContextPaths)
	}
	if result.EffectiveHookSessionStartMaxChars != hooks.DefaultSessionStartMaxChars {
		t.Fatalf("unexpected effective session-start max chars %d", result.EffectiveHookSessionStartMaxChars)
	}
	if result.EffectiveHookUserPromptSubmitBlockSecretPasteEnabled != hooks.DefaultUserPromptSecretBlockEnabled {
		t.Fatalf("unexpected effective secret-block enabled %t", result.EffectiveHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if result.EffectiveHookPreToolUseBlockDangerousCommandEnabled != hooks.DefaultPreToolUseDangerousCommandBlockEnabled {
		t.Fatalf("unexpected effective pre-tool dangerous-command enabled %t", result.EffectiveHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !reflect.DeepEqual(result.EffectiveHookPreToolUseProtectedGovernancePaths, wantProtectedPaths) {
		t.Fatalf(
			"expected effective protected governance paths %#v, got %#v",
			wantProtectedPaths,
			result.EffectiveHookPreToolUseProtectedGovernancePaths,
		)
	}
}

func TestRuntimePreferencesWritePersistsHookConfig(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	written, err := service.Write(WriteInput{
		HookSessionStartEnabled:                     boolPtr(false),
		HookSessionStartContextPaths:                []string{" docs/session-start.md ", "README.md", "docs\\session-start.md"},
		HookSessionStartMaxChars:                    intPtr(512),
		HookUserPromptSubmitBlockSecretPasteEnabled: boolPtr(false),
		HookPreToolUseBlockDangerousCommandEnabled:  boolPtr(false),
		HookPreToolUseAdditionalProtectedGovernancePaths: []string{
			" docs\\governance.md ",
			"runtime/policy.md",
			"./runtime/policy.md",
		},
	})
	if err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	wantPaths := []string{"docs/session-start.md", "README.md"}
	if written.ConfiguredHookSessionStartEnabled == nil || *written.ConfiguredHookSessionStartEnabled {
		t.Fatalf("unexpected configured session-start enabled %#v", written.ConfiguredHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(written.ConfiguredHookSessionStartContextPaths, wantPaths) {
		t.Fatalf("expected configured session-start paths %#v, got %#v", wantPaths, written.ConfiguredHookSessionStartContextPaths)
	}
	if written.ConfiguredHookSessionStartMaxChars == nil || *written.ConfiguredHookSessionStartMaxChars != 512 {
		t.Fatalf("unexpected configured session-start max chars %#v", written.ConfiguredHookSessionStartMaxChars)
	}
	if written.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled == nil || *written.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("unexpected configured secret-block enabled %#v", written.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if written.ConfiguredHookPreToolUseBlockDangerousCommandEnabled == nil || *written.ConfiguredHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("unexpected configured pre-tool dangerous-command enabled %#v", written.ConfiguredHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !reflect.DeepEqual(
		written.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		[]string{"docs/governance.md", "runtime/policy.md"},
	) {
		t.Fatalf(
			"unexpected configured protected governance paths %#v",
			written.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}

	if written.EffectiveHookSessionStartEnabled {
		t.Fatalf("expected effective session-start to be disabled, got %#v", written.EffectiveHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(written.EffectiveHookSessionStartContextPaths, wantPaths) {
		t.Fatalf("expected effective session-start paths %#v, got %#v", wantPaths, written.EffectiveHookSessionStartContextPaths)
	}
	if written.EffectiveHookSessionStartMaxChars != 512 {
		t.Fatalf("unexpected effective session-start max chars %d", written.EffectiveHookSessionStartMaxChars)
	}
	if written.EffectiveHookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("expected effective secret-block to be disabled")
	}
	if written.EffectiveHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("expected effective pre-tool dangerous-command block to be disabled")
	}
	if !reflect.DeepEqual(
		written.EffectiveHookPreToolUseProtectedGovernancePaths,
		append(hooks.DefaultProtectedGovernancePaths(), "docs/governance.md", "runtime/policy.md"),
	) {
		t.Fatalf(
			"unexpected effective protected governance paths %#v",
			written.EffectiveHookPreToolUseProtectedGovernancePaths,
		)
	}

	stored := dataStore.GetRuntimePreferences()
	if stored.HookSessionStartEnabled == nil || *stored.HookSessionStartEnabled {
		t.Fatalf("unexpected stored session-start enabled %#v", stored.HookSessionStartEnabled)
	}
	if !reflect.DeepEqual(stored.HookSessionStartContextPaths, wantPaths) {
		t.Fatalf("expected stored session-start paths %#v, got %#v", wantPaths, stored.HookSessionStartContextPaths)
	}
	if stored.HookSessionStartMaxChars == nil || *stored.HookSessionStartMaxChars != 512 {
		t.Fatalf("unexpected stored session-start max chars %#v", stored.HookSessionStartMaxChars)
	}
	if stored.HookUserPromptSubmitBlockSecretPasteEnabled == nil || *stored.HookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("unexpected stored secret-block enabled %#v", stored.HookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if stored.HookPreToolUseBlockDangerousCommandEnabled == nil || *stored.HookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("unexpected stored pre-tool dangerous-command enabled %#v", stored.HookPreToolUseBlockDangerousCommandEnabled)
	}
	if !reflect.DeepEqual(
		stored.HookPreToolUseAdditionalProtectedGovernancePaths,
		[]string{"docs/governance.md", "runtime/policy.md"},
	) {
		t.Fatalf(
			"unexpected stored protected governance paths %#v",
			stored.HookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}
}
