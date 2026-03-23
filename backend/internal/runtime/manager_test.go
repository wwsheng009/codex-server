package runtime

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

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

		decoded := readRuntimeTestDeltaPayload(t, payload)
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

func TestQueueCommandOutputDeltaSplitsLargePayloadIntoMultipleEvents(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	manager := NewManager("codex app-server --listen stdio://", hub)
	runtime := &instance{
		manager:     manager,
		workspaceID: "ws-1",
	}

	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	largeOutput := strings.Repeat("chunk-", (commandOutputMaxChunkBytes/6)*3)
	payload, _ := json.Marshal(map[string]any{
		"deltaBase64": base64.StdEncoding.EncodeToString([]byte(largeOutput)),
		"processId":   "proc_1",
		"stream":      "stdout",
	})

	if !runtime.queueCommandOutputDelta(payload) {
		t.Fatal("expected large output delta to be queued")
	}

	received := make([]string, 0)
	for {
		select {
		case event := <-eventsCh:
			payload, ok := event.Payload.(map[string]any)
			if !ok {
				t.Fatalf("expected map payload, got %#v", event.Payload)
			}

			decoded := readRuntimeTestDeltaPayload(t, payload)
			received = append(received, string(decoded))
		default:
			if len(received) < 2 {
				t.Fatalf("expected large payload to be split into multiple events, got %d", len(received))
			}
			if strings.Join(received, "") != largeOutput {
				t.Fatalf("expected split payload to round-trip exactly")
			}
			return
		}
	}
}

func readRuntimeTestDeltaPayload(t *testing.T, payload map[string]any) []byte {
	t.Helper()

	if deltaText, ok := payload["deltaText"].(string); ok {
		return []byte(deltaText)
	}

	decoded, err := base64.StdEncoding.DecodeString(payload["deltaBase64"].(string))
	if err != nil {
		t.Fatalf("decode deltaBase64: %v", err)
	}

	return decoded
}

func TestSplitCommandOutputDeltaPreservesUTF8Boundaries(t *testing.T) {
	t.Parallel()

	input := []byte(strings.Repeat("终端", commandOutputMaxChunkBytes/2))
	chunks := splitCommandOutputDelta(input, commandOutputMaxChunkBytes-1)
	if len(chunks) < 2 {
		t.Fatalf("expected UTF-8 input to be split, got %d chunks", len(chunks))
	}

	var rebuilt strings.Builder
	for index, chunk := range chunks {
		if !utf8.Valid(chunk) {
			t.Fatalf("expected chunk %d to remain valid UTF-8", index)
		}
		rebuilt.Write(chunk)
	}

	if rebuilt.String() != string(input) {
		t.Fatal("expected UTF-8 chunks to reassemble without loss")
	}
}
