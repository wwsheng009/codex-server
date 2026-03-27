package runtimeprefs

import (
	"testing"

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
