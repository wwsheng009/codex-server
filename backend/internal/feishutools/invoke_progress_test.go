package feishutools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

type captureInvokeEventPublisher struct {
	mu     sync.Mutex
	events []store.EventEnvelope
}

func (p *captureInvokeEventPublisher) Publish(event store.EventEnvelope) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, event)
}

func (p *captureInvokeEventPublisher) snapshot() []store.EventEnvelope {
	p.mu.Lock()
	defer p.mu.Unlock()
	cloned := make([]store.EventEnvelope, len(p.events))
	copy(cloned, p.events)
	return cloned
}

func TestRunSheetAppendPublishesInvokeProgress(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/open-apis/sheets/v2/spreadsheets/sht123/values_append":
			_, _ = w.Write([]byte(`{"code":0,"data":{"tableRange":"sheetA!A1:B2","updates":{"updatedCells":2,"updatedRows":1}}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	publisher := &captureInvokeEventPublisher{}
	service.SetEventPublisher(publisher)

	invokeCtx := ContextWithInvokeEventScope(context.Background(), "thread-tool-1", "turn-tool-1")
	tracker := service.newInvokeTracker(invokeCtx, "ws", "feishu_invoke_test", "feishu_sheet", "append", time.Now().UTC())
	ctx := contextWithInvokeTracker(invokeCtx, tracker)
	result, err := service.runSheet(ctx, "ws", validUserConfig(), "append", map[string]any{
		"spreadsheetToken": "sht123",
		"range":            "sheetA",
		"values": []any{
			[]any{"Task1", "Open"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["tableRange"] != "sheetA!A1:B2" {
		t.Fatalf("unexpected result: %#v", result)
	}

	events := tracker.Snapshot()
	if len(events) < 3 {
		t.Fatalf("expected invoke progress events, got %#v", events)
	}
	states := make(map[string]bool, len(events))
	for _, event := range events {
		states[event.State] = true
	}
	for _, state := range []string{"authorizing", "writing", "verifying"} {
		if !states[state] {
			t.Fatalf("expected state %q in timeline, got %#v", state, events)
		}
	}

	published := publisher.snapshot()
	if len(published) != len(events) {
		t.Fatalf("expected %d published events, got %d", len(events), len(published))
	}
	for _, event := range published {
		if event.Method != feishuInvokeProgressEventMethod {
			t.Fatalf("unexpected method %q", event.Method)
		}
		if event.ThreadID != "thread-tool-1" || event.TurnID != "turn-tool-1" {
			t.Fatalf("expected thread/turn scope on published event, got %#v", event)
		}
	}
}
