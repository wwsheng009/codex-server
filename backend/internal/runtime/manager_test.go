package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	appconfig "codex-server/backend/internal/config"
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

	event := awaitRuntimeEvent(t, eventsCh)
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
	firstEvent := awaitRuntimeEvent(t, eventsCh)
	firstPayload, ok := firstEvent.Payload.(map[string]any)
	if !ok {
		t.Fatalf("expected map payload, got %#v", firstEvent.Payload)
	}
	received = append(received, string(readRuntimeTestDeltaPayload(t, firstPayload)))

	for {
		select {
		case event := <-eventsCh:
			payload, ok := event.Payload.(map[string]any)
			if !ok {
				t.Fatalf("expected map payload, got %#v", event.Payload)
			}

			decoded := readRuntimeTestDeltaPayload(t, payload)
			received = append(received, string(decoded))
		case <-time.After(100 * time.Millisecond):
			if len(received) < 1 {
				t.Fatalf("expected large payload to emit at least one event, got %d", len(received))
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
	manager.RememberActiveTurn("ws-1", "thread-crash-1", "turn-stale-1")
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

func TestTrackTurnClearsActiveTurnForInterruptedTerminalEvent(t *testing.T) {
	t.Parallel()

	manager := NewManager("codex app-server --listen stdio://", nil)
	manager.Configure("ws-1", t.TempDir())
	manager.RememberActiveTurn("ws-1", "thread-1", "turn-1")

	runtime := manager.runtimes["ws-1"]
	runtime.HandleNotification("turn/interrupted", json.RawMessage(`{
		"threadId": "thread-1",
		"turn": {"id": "turn-1", "status": "interrupted"}
	}`))

	if activeTurnID := manager.ActiveTurnID("ws-1", "thread-1"); activeTurnID != "" {
		t.Fatalf("expected interrupted terminal event to clear active turn, got %q", activeTurnID)
	}

	manager.RememberActiveTurn("ws-1", "thread-1", "turn-1")
	if activeTurnID := manager.ActiveTurnID("ws-1", "thread-1"); activeTurnID != "" {
		t.Fatalf("expected terminal turn marker to prevent stale restore, got %q", activeTurnID)
	}
}

func TestBeginInterruptIsIdempotentForConcurrentCallers(t *testing.T) {
	t.Parallel()

	manager := NewManager("codex app-server --listen stdio://", nil)
	manager.Configure("ws-1", t.TempDir())
	manager.RememberActiveTurn("ws-1", "thread-1", "turn-1")

	first := manager.BeginInterrupt("ws-1", "thread-1")
	second := manager.BeginInterrupt("ws-1", "thread-1")

	if first != "turn-1" {
		t.Fatalf("expected first begin interrupt to capture active turn, got %q", first)
	}
	if second != "" {
		t.Fatalf("expected second begin interrupt to be idempotent, got %q", second)
	}
	if activeTurnID := manager.ActiveTurnID("ws-1", "thread-1"); activeTurnID != "" {
		t.Fatalf("expected begin interrupt to hide active turn immediately, got %q", activeTurnID)
	}

	manager.RestoreInterruptedTurn("ws-1", "thread-1", "turn-1")
	if activeTurnID := manager.ActiveTurnID("ws-1", "thread-1"); activeTurnID != "turn-1" {
		t.Fatalf("expected restore to reinstate active turn after failed interrupt, got %q", activeTurnID)
	}
}

func TestApplyLaunchConfigReplacesRuntimeCommandState(t *testing.T) {
	t.Parallel()

	manager := NewManager("codex app-server --listen stdio://", nil)
	manager.Configure("ws-1", t.TempDir())

	manager.ApplyLaunchConfig(appconfig.RuntimeLaunchConfig{
		BaseCommand:               "codex app-server --listen stdio://",
		Command:                   `codex app-server --listen stdio:// --config "model_catalog_json=E:/tmp/catalog.json"`,
		EffectiveModelCatalogPath: "E:/tmp/catalog.json",
	})

	state := manager.State("ws-1")
	if state.Command != `codex app-server --listen stdio:// --config "model_catalog_json=E:/tmp/catalog.json"` {
		t.Fatalf("expected structured launch config command to propagate into runtime state, got %q", state.Command)
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
			if state.LastErrorCategory != "process_exit" {
				t.Fatalf("expected process_exit classification, got %#v", state)
			}
			if state.LastErrorRecoveryAction != "retry-after-restart" {
				t.Fatalf("expected retry-after-restart recovery action, got %#v", state)
			}
			if !state.LastErrorRetryable || !state.LastErrorRequiresRuntimeRecycle {
				t.Fatalf("expected unexpected exit to be retryable with runtime recycle, got %#v", state)
			}
			if len(state.RecentStderr) == 0 {
				t.Fatalf("expected stderr ring buffer to retain crash context, got %#v", state)
			}
			if !strings.Contains(strings.Join(state.RecentStderr, "\n"), "runtime exited unexpectedly") {
				t.Fatalf("expected stderr tail to include crash line, got %#v", state.RecentStderr)
			}
			if activeTurnID := manager.ActiveTurnID("ws-1", "thread-crash-1"); activeTurnID != "" {
				t.Fatalf("expected runtime close to clear active turns, got %q", activeTurnID)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("expected runtime to close and retain stderr context, got %#v", manager.State("ws-1"))
}

func TestManagerPublishesSyntheticTerminalEventsWhenRuntimeClosesMidTurn(t *testing.T) {
	hub := events.NewHub()
	eventsCh, cancel := hub.Subscribe("ws-1")
	defer cancel()

	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"turn/start": {
				Result: map[string]any{
					"turn": map[string]any{
						"id":     "turn-crash-midstream-1",
						"status": "inProgress",
					},
				},
				Notifications: []codexfake.Notification{
					{
						Method: "turn/started",
						Params: map[string]any{
							"threadId": "thread-crash-midstream-1",
							"turn": map[string]any{
								"id":     "turn-crash-midstream-1",
								"status": "inProgress",
							},
						},
					},
				},
				Exit: &codexfake.ExitBehavior{
					Code:   19,
					Stderr: "runtime crashed before terminal event",
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
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := manager.Call(context.Background(), "ws-1", "turn/start", map[string]any{
		"threadId": "thread-crash-midstream-1",
	}, &response); err != nil {
		t.Fatalf("Call(turn/start) error = %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	var methods []string
	for time.Now().Before(deadline) {
		select {
		case event := <-eventsCh:
			methods = append(methods, event.Method)
			if len(methods) >= 3 {
				if methods[0] != "turn/started" {
					t.Fatalf("expected first event to be turn/started, got %#v", methods)
				}
				if methods[1] != "turn/interrupted" {
					t.Fatalf("expected synthetic turn/interrupted after crash, got %#v", methods)
				}
				if methods[2] != "thread/status/changed" {
					t.Fatalf("expected synthetic thread/status/changed after crash, got %#v", methods)
				}
				return
			}
		case <-time.After(20 * time.Millisecond):
		}
	}

	t.Fatalf("expected synthetic terminal events after runtime crash, got %#v", methods)
}

func TestEnsureStartedClassifiesLaunchMisconfiguration(t *testing.T) {
	t.Parallel()

	manager := NewManager("codex-command-that-does-not-exist", nil)
	manager.Configure("ws-1", t.TempDir())

	if _, err := manager.EnsureStarted(context.Background(), "ws-1"); err == nil {
		t.Fatal("expected EnsureStarted() to fail for missing runtime command")
	}

	state := manager.State("ws-1")
	if state.Status != "error" {
		t.Fatalf("expected runtime status error, got %#v", state)
	}
	if state.LastErrorCategory != "configuration" {
		t.Fatalf("expected configuration classification, got %#v", state)
	}
	if state.LastErrorRecoveryAction != "fix-launch-config" {
		t.Fatalf("expected fix-launch-config recovery action, got %#v", state)
	}
	if state.LastErrorRetryable {
		t.Fatalf("expected missing command not to be retryable, got %#v", state)
	}
	if state.LastErrorRequiresRuntimeRecycle {
		t.Fatalf("expected missing command not to require runtime recycle, got %#v", state)
	}
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
