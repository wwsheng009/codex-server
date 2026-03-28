package runtimeprefs

import (
	"testing"

	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

func TestRuntimePreferencesReadWriteOutboundProxyURL(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"http://default-proxy.local:7890",
		false,
		"",
		"",
	)

	initial, err := service.Read()
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if initial.ConfiguredOutboundProxyURL != "" {
		t.Fatalf("expected no configured outbound proxy, got %q", initial.ConfiguredOutboundProxyURL)
	}
	if initial.DefaultOutboundProxyURL != "http://default-proxy.local:7890" {
		t.Fatalf("unexpected default outbound proxy %q", initial.DefaultOutboundProxyURL)
	}
	if initial.EffectiveOutboundProxyURL != "http://default-proxy.local:7890" {
		t.Fatalf("unexpected effective outbound proxy %q", initial.EffectiveOutboundProxyURL)
	}

	written, err := service.Write(WriteInput{
		OutboundProxyURL: "127.0.0.1:7890",
	})
	if err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	if written.ConfiguredOutboundProxyURL != "http://127.0.0.1:7890" {
		t.Fatalf("unexpected configured outbound proxy %q", written.ConfiguredOutboundProxyURL)
	}
	if written.EffectiveOutboundProxyURL != "http://127.0.0.1:7890" {
		t.Fatalf("unexpected effective outbound proxy %q", written.EffectiveOutboundProxyURL)
	}
	if stored := dataStore.GetRuntimePreferences().OutboundProxyURL; stored != "http://127.0.0.1:7890" {
		t.Fatalf("unexpected stored outbound proxy %q", stored)
	}
}

func TestRuntimePreferencesWriteAppliesBackendThreadTraceImmediately(t *testing.T) {
	diagnostics.ConfigureThreadTrace(false, "", "")
	t.Cleanup(func() {
		diagnostics.ConfigureThreadTrace(false, "", "")
	})

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
		"ws_env",
		"thread_env",
	)

	initial, err := service.Read()
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if !initial.EffectiveBackendThreadTraceEnabled {
		t.Fatal("expected env-default backend trace to be enabled")
	}
	if initial.EffectiveBackendThreadTraceWorkspaceID != "ws_env" {
		t.Fatalf("unexpected default workspace filter %q", initial.EffectiveBackendThreadTraceWorkspaceID)
	}
	if initial.EffectiveBackendThreadTraceThreadID != "thread_env" {
		t.Fatalf("unexpected default thread filter %q", initial.EffectiveBackendThreadTraceThreadID)
	}

	enabled := true
	written, err := service.Write(WriteInput{
		BackendThreadTraceEnabled:     &enabled,
		BackendThreadTraceWorkspaceID: " ws_live ",
		BackendThreadTraceThreadID:    " thread_live ",
	})
	if err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	if written.ConfiguredBackendThreadTraceEnabled == nil || !*written.ConfiguredBackendThreadTraceEnabled {
		t.Fatalf("expected configured backend trace to be explicitly enabled, got %#v", written.ConfiguredBackendThreadTraceEnabled)
	}
	if written.EffectiveBackendThreadTraceWorkspaceID != "ws_live" {
		t.Fatalf("unexpected effective workspace filter %q", written.EffectiveBackendThreadTraceWorkspaceID)
	}
	if written.EffectiveBackendThreadTraceThreadID != "thread_live" {
		t.Fatalf("unexpected effective thread filter %q", written.EffectiveBackendThreadTraceThreadID)
	}
	if !diagnostics.ThreadTraceEnabled("ws_live", "thread_live") {
		t.Fatal("expected diagnostics thread trace to be active immediately after write")
	}
	if stored := dataStore.GetRuntimePreferences().BackendThreadTraceEnabled; stored == nil || !*stored {
		t.Fatalf("expected persisted backend trace flag, got %#v", stored)
	}

	reset, err := service.Write(WriteInput{
		BackendThreadTraceEnabled:     nil,
		BackendThreadTraceWorkspaceID: "",
		BackendThreadTraceThreadID:    "",
	})
	if err != nil {
		t.Fatalf("reset Write() error = %v", err)
	}

	if reset.ConfiguredBackendThreadTraceEnabled != nil {
		t.Fatalf("expected configured backend trace override to be cleared, got %#v", reset.ConfiguredBackendThreadTraceEnabled)
	}
	if !reset.EffectiveBackendThreadTraceEnabled {
		t.Fatal("expected effective backend trace to fall back to env default")
	}
	if reset.EffectiveBackendThreadTraceWorkspaceID != "ws_env" {
		t.Fatalf("expected workspace filter to fall back to env default, got %q", reset.EffectiveBackendThreadTraceWorkspaceID)
	}
	if !diagnostics.ThreadTraceEnabled("ws_env", "thread_env") {
		t.Fatal("expected diagnostics thread trace to fall back to env default immediately after reset")
	}
}
