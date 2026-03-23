package runtime

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"codex-server/backend/internal/events"
)

func TestQueueCommandOutputDeltaMergesAdjacentChunks(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	manager := NewManager("codex app-server --listen stdio://", hub)
	runtime := &instance{
		manager:     manager,
		workspaceID: "ws-1",
	}

	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	firstPayload, _ := json.Marshal(map[string]any{
		"deltaBase64": base64.StdEncoding.EncodeToString([]byte("hel")),
		"processId":   "proc_1",
		"stream":      "stdout",
	})
	secondPayload, _ := json.Marshal(map[string]any{
		"deltaBase64": base64.StdEncoding.EncodeToString([]byte("lo")),
		"processId":   "proc_1",
		"stream":      "stdout",
	})

	if !runtime.queueCommandOutputDelta(firstPayload) {
		t.Fatal("expected first output delta to be queued")
	}
	if !runtime.queueCommandOutputDelta(secondPayload) {
		t.Fatal("expected second output delta to be queued")
	}

	runtime.flushPendingCommandOutput()

	select {
	case event := <-eventsCh:
		if event.Method != "command/exec/outputDelta" {
			t.Fatalf("expected output delta event, got %q", event.Method)
		}

		payload, ok := event.Payload.(map[string]any)
		if !ok {
			t.Fatalf("expected map payload, got %#v", event.Payload)
		}

		decoded, err := base64.StdEncoding.DecodeString(payload["deltaBase64"].(string))
		if err != nil {
			t.Fatalf("decode deltaBase64: %v", err)
		}
		if string(decoded) != "hello" {
			t.Fatalf("expected merged delta payload %q, got %q", "hello", string(decoded))
		}
	default:
		t.Fatal("expected merged output delta event to be published")
	}

	select {
	case extraEvent := <-eventsCh:
		t.Fatalf("expected only one merged event, got extra %#v", extraEvent)
	default:
	}
}
