package runtimeprefs

import (
	"reflect"
	"testing"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turnpolicies"
)

func TestRuntimePreferencesReadIncludesTurnPolicyValidationCommandDefaults(t *testing.T) {
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

	if len(result.ConfiguredTurnPolicyValidationCommandPrefixes) != 0 {
		t.Fatalf("expected no configured validation command prefixes, got %#v", result.ConfiguredTurnPolicyValidationCommandPrefixes)
	}
	wantDefaults := turnpolicies.DefaultValidationCommandPrefixes()
	if !reflect.DeepEqual(result.DefaultTurnPolicyValidationCommandPrefixes, wantDefaults) {
		t.Fatalf("expected default validation command prefixes %#v, got %#v", wantDefaults, result.DefaultTurnPolicyValidationCommandPrefixes)
	}
	if !reflect.DeepEqual(result.EffectiveTurnPolicyValidationCommandPrefixes, wantDefaults) {
		t.Fatalf("expected effective validation command prefixes %#v, got %#v", wantDefaults, result.EffectiveTurnPolicyValidationCommandPrefixes)
	}
}

func TestRuntimePreferencesWritePersistsTurnPolicyValidationCommandPrefixes(t *testing.T) {
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
		TurnPolicyValidationCommandPrefixes: []string{
			" npm run check ",
			"NPM RUN CHECK",
			"pnpm lint",
		},
	})
	if err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	want := []string{"npm run check", "pnpm lint"}
	if !reflect.DeepEqual(written.ConfiguredTurnPolicyValidationCommandPrefixes, want) {
		t.Fatalf("expected configured validation command prefixes %#v, got %#v", want, written.ConfiguredTurnPolicyValidationCommandPrefixes)
	}
	if !reflect.DeepEqual(written.EffectiveTurnPolicyValidationCommandPrefixes, want) {
		t.Fatalf("expected effective validation command prefixes %#v, got %#v", want, written.EffectiveTurnPolicyValidationCommandPrefixes)
	}

	stored := dataStore.GetRuntimePreferences()
	if !reflect.DeepEqual(stored.TurnPolicyValidationCommandPrefixes, want) {
		t.Fatalf("expected stored validation command prefixes %#v, got %#v", want, stored.TurnPolicyValidationCommandPrefixes)
	}
}
