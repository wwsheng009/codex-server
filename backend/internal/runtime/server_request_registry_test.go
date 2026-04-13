package runtime

import (
	"encoding/json"
	"testing"
	"time"
)

func TestServerRequestRegistryListResolveAndExpire(t *testing.T) {
	t.Parallel()

	registry := newServerRequestRegistry()
	base := time.Date(2026, 4, 13, 12, 0, 0, 0, time.UTC)

	registry.Register(PendingServerRequest{
		RequestID:   "req-old",
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		Method:      "item/tool/call",
		RawID:       json.RawMessage(`1`),
		RequestedAt: base,
	})
	registry.Register(PendingServerRequest{
		RequestID:   "req-new",
		WorkspaceID: "ws-1",
		ThreadID:    "thread-2",
		Method:      "item/tool/requestUserInput",
		RawID:       json.RawMessage(`2`),
		RequestedAt: base.Add(2 * time.Minute),
	})
	registry.Register(PendingServerRequest{
		RequestID:   "req-other-workspace",
		WorkspaceID: "ws-2",
		ThreadID:    "thread-9",
		Method:      "execCommandApproval",
		RawID:       json.RawMessage(`3`),
		RequestedAt: base.Add(time.Minute),
	})

	items := registry.ListByWorkspace("ws-1")
	if len(items) != 2 {
		t.Fatalf("expected 2 requests for ws-1, got %#v", items)
	}
	if items[0].RequestID != "req-new" || items[1].RequestID != "req-old" {
		t.Fatalf("expected requests sorted newest first, got %#v", items)
	}

	resolved, ok := registry.Resolve("req-new")
	if !ok {
		t.Fatal("expected req-new to resolve")
	}
	if resolved.WorkspaceID != "ws-1" || resolved.ThreadID != "thread-2" {
		t.Fatalf("unexpected resolved request %#v", resolved)
	}

	items = registry.ListByWorkspace("ws-1")
	if len(items) != 1 || items[0].RequestID != "req-old" {
		t.Fatalf("expected req-new to be removed from ws-1 list, got %#v", items)
	}

	expired := registry.ExpireWorkspace("ws-1")
	if len(expired) != 1 || expired[0].RequestID != "req-old" {
		t.Fatalf("expected only req-old to expire for ws-1, got %#v", expired)
	}

	if _, ok := registry.Get("req-old"); ok {
		t.Fatal("expected req-old to be removed after workspace expiration")
	}
	if _, ok := registry.Get("req-other-workspace"); !ok {
		t.Fatal("expected other workspace request to remain registered")
	}
}

func TestServerRequestRegistryResolveMissingRequest(t *testing.T) {
	t.Parallel()

	registry := newServerRequestRegistry()
	if _, ok := registry.Resolve("missing-request"); ok {
		t.Fatal("expected missing request resolve to return false")
	}
}
