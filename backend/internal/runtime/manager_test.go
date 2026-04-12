package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/testutil/codexfake"
)

func TestCodexFakeHelperProcess(t *testing.T) {
	codexfake.RunHelperProcessIfRequested(t)
}

type fakeServerRequestInterceptor struct {
	calls    []ServerRequestInput
	decision ServerRequestInterception
	err      error
}

func (f *fakeServerRequestInterceptor) InterceptServerRequest(
	_ context.Context,
	input ServerRequestInput,
) (ServerRequestInterception, error) {
	f.calls = append(f.calls, input)
	return f.decision, f.err
}

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

func TestHandleRequestSkipsPendingStorageWhenInterceptorHandlesRequest(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	manager := NewManager("codex app-server --listen stdio://", hub)
	interceptor := &fakeServerRequestInterceptor{
		decision: ServerRequestInterception{
			Handled: true,
			Response: map[string]any{
				"success": false,
			},
		},
	}
	manager.SetServerRequestInterceptor(interceptor)

	runtime := &instance{
		manager:     manager,
		workspaceID: "ws-1",
	}
	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	payload, _ := json.Marshal(map[string]any{
		"threadId": "thread-1",
		"turnId":   "turn-1",
		"tool":     "fs/writeFile",
		"arguments": map[string]any{
			"path": ".codex/hooks.json",
		},
	})

	runtime.HandleRequest(json.RawMessage(`1`), "item/tool/call", payload)

	if len(interceptor.calls) != 1 {
		t.Fatalf("expected interceptor to be called once, got %#v", interceptor.calls)
	}
	if len(manager.ListPendingRequests("ws-1")) != 0 {
		t.Fatalf("expected handled request to skip pending storage, got %#v", manager.ListPendingRequests("ws-1"))
	}

	select {
	case event := <-eventsCh:
		t.Fatalf("expected handled request to skip event publication, got %#v", event)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestHandleRequestPreservesPendingStorageWhenInterceptorDoesNotHandle(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	manager := NewManager("codex app-server --listen stdio://", hub)
	interceptor := &fakeServerRequestInterceptor{}
	manager.SetServerRequestInterceptor(interceptor)

	runtime := &instance{
		manager:     manager,
		workspaceID: "ws-1",
	}
	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	payload, _ := json.Marshal(map[string]any{
		"threadId": "thread-1",
		"turnId":   "turn-1",
		"tool":     "search_query",
		"arguments": map[string]any{
			"q": "codex server",
		},
	})

	runtime.HandleRequest(json.RawMessage(`1`), "item/tool/call", payload)

	if len(interceptor.calls) != 1 {
		t.Fatalf("expected interceptor to be called once, got %#v", interceptor.calls)
	}

	requests := manager.ListPendingRequests("ws-1")
	if len(requests) != 1 {
		t.Fatalf("expected unhandled request to remain pending, got %#v", requests)
	}
	if requests[0].Method != "item/tool/call" || requests[0].ThreadID != "thread-1" || requests[0].TurnID != "turn-1" {
		t.Fatalf("unexpected pending request metadata %#v", requests[0])
	}

	select {
	case event := <-eventsCh:
		if event.Method != "item/tool/call" {
			t.Fatalf("expected item/tool/call event, got %#v", event)
		}
		if event.ServerRequestID == nil || *event.ServerRequestID == "" {
			t.Fatalf("expected published request event to carry server request id, got %#v", event)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected unhandled request event to be published")
	}
}

func TestManagerCallStartsRuntimeAndPublishesThreadStarted(t *testing.T) {
	hub := events.NewHub()
	session := codexfake.NewSession(t, "TestCodexFakeHelperProcess")
	t.Setenv("CODEX_FAKE_HELPER_ENABLED", "1")
	t.Setenv("CODEX_FAKE_HELPER_STATE_FILE", session.StateFile)

	manager := NewManager(session.Command, hub)
	rootPath := t.TempDir()
	manager.Configure("ws-1", rootPath)
	t.Cleanup(func() {
		manager.Remove("ws-1")
	})
	defer manager.Remove("ws-1")

	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	var response struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := manager.Call(context.Background(), "ws-1", "thread/start", map[string]any{
		"cwd": rootPath,
	}, &response); err != nil {
		t.Fatalf("Call() error = %v", err)
	}
	if response.Thread.ID != "thread-test-1" {
		t.Fatalf("expected fake thread id, got %q", response.Thread.ID)
	}

	select {
	case event := <-eventsCh:
		if event.Method != "thread/started" {
			t.Fatalf("expected thread/started event, got %q", event.Method)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected thread/started event to be published")
	}

	state := manager.State("ws-1")
	if state.Status != "ready" {
		t.Fatalf("expected runtime ready, got %q", state.Status)
	}
}

func TestManagerCallPublishesTurnLifecycleEvents(t *testing.T) {
	hub := events.NewHub()
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"turn/start": {
				Result: map[string]any{
					"turn": map[string]any{
						"id":     "turn-runtime-1",
						"status": "inProgress",
					},
				},
				Notifications: []codexfake.Notification{
					{
						Method: "turn/started",
						Params: map[string]any{
							"threadId": "thread-1",
							"turn": map[string]any{
								"id":     "turn-runtime-1",
								"status": "inProgress",
							},
						},
					},
					{
						Method: "item/started",
						Params: map[string]any{
							"threadId": "thread-1",
							"turnId":   "turn-runtime-1",
							"item": map[string]any{
								"id":   "item-1",
								"type": "agentMessage",
							},
						},
					},
					{
						Method: "item/completed",
						Params: map[string]any{
							"threadId": "thread-1",
							"turnId":   "turn-runtime-1",
							"item": map[string]any{
								"id":   "item-1",
								"type": "agentMessage",
								"text": "manager turn result",
							},
						},
					},
					{
						Method: "turn/completed",
						Params: map[string]any{
							"threadId": "thread-1",
							"turn": map[string]any{
								"id":     "turn-runtime-1",
								"status": "completed",
							},
						},
					},
				},
			},
		},
	})

	manager := NewManager(session.Command, hub)
	rootPath := t.TempDir()
	manager.Configure("ws-1", rootPath)
	t.Cleanup(func() {
		manager.Remove("ws-1")
	})

	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	var response struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := manager.Call(context.Background(), "ws-1", "turn/start", map[string]any{
		"threadId": "thread-1",
	}, &response); err != nil {
		t.Fatalf("Call(turn/start) error = %v", err)
	}
	if response.Turn.ID != "turn-runtime-1" {
		t.Fatalf("expected fake turn id, got %q", response.Turn.ID)
	}

	expected := []string{"turn/started", "item/started", "item/completed", "turn/completed"}
	for _, method := range expected {
		event := awaitRuntimeEvent(t, eventsCh)
		if event.Method != method {
			t.Fatalf("expected event %q, got %q", method, event.Method)
		}
	}
}

func TestManagerPublishesAvailableTurnEventsWhenCompletionMissing(t *testing.T) {
	hub := events.NewHub()
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"turn/start": {
				Result: map[string]any{
					"turn": map[string]any{
						"id":     "turn-no-complete-1",
						"status": "inProgress",
					},
				},
				Notifications: []codexfake.Notification{
					{
						Method: "turn/started",
						Params: map[string]any{
							"threadId": "thread-1",
							"turn": map[string]any{
								"id":     "turn-no-complete-1",
								"status": "inProgress",
							},
						},
					},
					{
						Method: "item/started",
						Params: map[string]any{
							"threadId": "thread-1",
							"turnId":   "turn-no-complete-1",
							"item": map[string]any{
								"id":     "subagent-1",
								"type":   "agentMessage",
								"source": "subagent",
							},
						},
					},
					{
						Method: "item/completed",
						Params: map[string]any{
							"threadId": "thread-1",
							"turnId":   "turn-no-complete-1",
							"item": map[string]any{
								"id":     "subagent-1",
								"type":   "agentMessage",
								"source": "subagent",
								"text":   "subagent partial result",
							},
						},
					},
				},
			},
		},
	})

	manager := NewManager(session.Command, hub)
	rootPath := t.TempDir()
	manager.Configure("ws-1", rootPath)
	t.Cleanup(func() {
		manager.Remove("ws-1")
	})

	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	var response struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := manager.Call(context.Background(), "ws-1", "turn/start", map[string]any{
		"threadId": "thread-1",
	}, &response); err != nil {
		t.Fatalf("Call(turn/start) error = %v", err)
	}
	if response.Turn.ID != "turn-no-complete-1" {
		t.Fatalf("expected fake turn id, got %q", response.Turn.ID)
	}

	expected := []string{"turn/started", "item/started", "item/completed"}
	for _, method := range expected {
		event := awaitRuntimeEvent(t, eventsCh)
		if event.Method != method {
			t.Fatalf("expected event %q, got %q", method, event.Method)
		}
	}

	select {
	case event := <-eventsCh:
		t.Fatalf("expected no terminal completion event, got %q", event.Method)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestManagerTransitionsToErrorWhenRuntimeExitsUnexpectedly(t *testing.T) {
	hub := events.NewHub()
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"thread/start": {
				Result: map[string]any{
					"thread": map[string]any{
						"id": "thread-crash-1",
					},
				},
				Exit: &codexfake.ExitBehavior{
					Code:   23,
					Stderr: "runtime exited unexpectedly",
				},
			},
		},
	})

	manager := NewManager(session.Command, hub)
	rootPath := t.TempDir()
	manager.Configure("ws-1", rootPath)
	t.Cleanup(func() {
		manager.Remove("ws-1")
	})

	var response struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := manager.Call(context.Background(), "ws-1", "thread/start", map[string]any{
		"cwd": rootPath,
	}, &response); err != nil {
		t.Fatalf("Call(thread/start) error = %v", err)
	}
	if response.Thread.ID != "thread-crash-1" {
		t.Fatalf("expected fake thread id, got %q", response.Thread.ID)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		state := manager.State("ws-1")
		if state.Status != "ready" && strings.Contains(state.LastError, "runtime exited unexpectedly") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("expected runtime to close and retain stderr context, got %#v", manager.State("ws-1"))
}

func awaitRuntimeEvent(t *testing.T, eventsCh <-chan store.EventEnvelope) store.EventEnvelope {
	t.Helper()

	select {
	case event := <-eventsCh:
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("expected runtime event")
		return store.EventEnvelope{}
	}
}
