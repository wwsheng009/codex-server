package bridge

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/testutil/codexfake"
)

func TestCodexFakeHelperProcess(t *testing.T) {
	codexfake.RunHelperProcessIfRequested(t)
}

type testHandler struct {
	notifications chan testNotification
	stderr        chan string
	closed        chan error
}

type testNotification struct {
	Method string
	Params map[string]any
}

func newTestHandler() *testHandler {
	return &testHandler{
		notifications: make(chan testNotification, 16),
		stderr:        make(chan string, 4),
		closed:        make(chan error, 1),
	}
}

func (h *testHandler) HandleNotification(method string, params json.RawMessage) {
	payload := map[string]any{}
	if len(params) > 0 {
		_ = json.Unmarshal(params, &payload)
	}
	h.notifications <- testNotification{Method: method, Params: payload}
}

func (h *testHandler) HandleRequest(_ json.RawMessage, _ string, _ json.RawMessage) {}

func (h *testHandler) HandleStderr(line string) {
	h.stderr <- line
}

func (h *testHandler) HandleClosed(err error) {
	h.closed <- err
}

func (h *testHandler) drainStderr() string {
	lines := make([]string, 0, len(h.stderr))
	for {
		select {
		case line := <-h.stderr:
			lines = append(lines, line)
		default:
			return strings.Join(lines, "\n")
		}
	}
}

func (h *testHandler) awaitNotification(t *testing.T) testNotification {
	t.Helper()

	select {
	case notification := <-h.notifications:
		return notification
	case <-time.After(2 * time.Second):
		t.Fatal("expected notification")
		return testNotification{}
	}
}

func TestStartInitializesBridgeAndDispatchesThreadStarted(t *testing.T) {
	session := codexfake.NewSession(t, "TestCodexFakeHelperProcess")
	t.Setenv("CODEX_FAKE_HELPER_ENABLED", "1")
	t.Setenv("CODEX_FAKE_HELPER_STATE_FILE", session.StateFile)

	handler := newTestHandler()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := Start(ctx, Config{
		Command:         session.Command,
		Cwd:             t.TempDir(),
		ClientName:      "bridge-test",
		ClientVersion:   "1.2.3",
		ExperimentalAPI: true,
	}, handler)
	if err != nil {
		if stderr := handler.drainStderr(); strings.TrimSpace(stderr) != "" {
			t.Fatalf("Start() error = %v; stderr = %s", err, stderr)
		}
		t.Fatalf("Start() error = %v", err)
	}
	defer client.Close()

	var response struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := client.Call(ctx, "thread/start", map[string]any{
		"cwd": t.TempDir(),
	}, &response); err != nil {
		t.Fatalf("Call(thread/start) error = %v", err)
	}
	if response.Thread.ID != "thread-test-1" {
		t.Fatalf("expected fake thread id, got %q", response.Thread.ID)
	}

	select {
	case notification := <-handler.notifications:
		if notification.Method != "thread/started" {
			t.Fatalf("expected thread/started notification, got %q", notification.Method)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected thread/started notification")
	}

	state := codexfake.ReadState(t, session.StateFile)
	if len(state.Received) < 3 {
		t.Fatalf("expected initialize, initialized, thread/start to be recorded, got %#v", state.Received)
	}
	if state.Received[0].Method != "initialize" {
		t.Fatalf("expected first method initialize, got %q", state.Received[0].Method)
	}
	if state.Received[1].Method != "initialized" {
		t.Fatalf("expected initialized notification after initialize, got %q", state.Received[1].Method)
	}
	if state.Received[2].Method != "thread/start" {
		t.Fatalf("expected thread/start after initialized, got %q", state.Received[2].Method)
	}

	clientInfo := codexfake.ReadState(t, session.StateFile).Initialize["clientInfo"].(map[string]any)
	if clientInfo["name"] != "bridge-test" {
		t.Fatalf("expected client name bridge-test, got %#v", clientInfo["name"])
	}
	capabilities := state.Initialize["capabilities"].(map[string]any)
	if capabilities["experimentalApi"] != true {
		t.Fatalf("expected experimentalApi=true, got %#v", capabilities["experimentalApi"])
	}
}

func TestStartSupportsReviewStartAndTurnLifecycleNotifications(t *testing.T) {
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"review/start": {
				Result: map[string]any{
					"turn": map[string]any{
						"id":     "review-turn-9",
						"status": "inProgress",
					},
				},
			},
			"turn/start": {
				Result: map[string]any{
					"turn": map[string]any{
						"id":     "turn-rich-1",
						"status": "inProgress",
					},
				},
				Notifications: []codexfake.Notification{
					{
						Method: "turn/started",
						Params: map[string]any{
							"threadId": "thread-test-1",
							"turn": map[string]any{
								"id":     "turn-rich-1",
								"status": "inProgress",
							},
						},
					},
					{
						Method: "item/started",
						Params: map[string]any{
							"threadId": "thread-test-1",
							"turnId":   "turn-rich-1",
							"item": map[string]any{
								"id":   "item-agent-1",
								"type": "agentMessage",
							},
						},
					},
					{
						Method: "item/completed",
						Params: map[string]any{
							"threadId": "thread-test-1",
							"turnId":   "turn-rich-1",
							"item": map[string]any{
								"id":   "item-agent-1",
								"type": "agentMessage",
								"text": "final response",
							},
						},
					},
					{
						Method: "turn/completed",
						Params: map[string]any{
							"threadId": "thread-test-1",
							"turn": map[string]any{
								"id":     "turn-rich-1",
								"status": "completed",
							},
						},
					},
				},
			},
		},
	})

	handler := newTestHandler()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := Start(ctx, Config{
		Command:         session.Command,
		Cwd:             t.TempDir(),
		ClientName:      "bridge-test",
		ClientVersion:   "1.2.3",
		ExperimentalAPI: true,
	}, handler)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer client.Close()

	var reviewResponse struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := client.Call(ctx, "review/start", map[string]any{
		"delivery": "inline",
		"target": map[string]any{
			"type": "uncommittedChanges",
		},
		"threadId": "thread-test-1",
	}, &reviewResponse); err != nil {
		t.Fatalf("Call(review/start) error = %v", err)
	}
	if reviewResponse.Turn.ID != "review-turn-9" {
		t.Fatalf("expected custom review turn id, got %q", reviewResponse.Turn.ID)
	}

	var turnResponse struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := client.Call(ctx, "turn/start", map[string]any{
		"threadId": "thread-test-1",
		"input": []map[string]any{
			{
				"type": "text",
				"text": "inspect repository",
			},
		},
	}, &turnResponse); err != nil {
		t.Fatalf("Call(turn/start) error = %v", err)
	}
	if turnResponse.Turn.ID != "turn-rich-1" {
		t.Fatalf("expected custom turn id, got %q", turnResponse.Turn.ID)
	}

	expectedMethods := []string{"turn/started", "item/started", "item/completed", "turn/completed"}
	for _, expectedMethod := range expectedMethods {
		notification := handler.awaitNotification(t)
		if notification.Method != expectedMethod {
			t.Fatalf("expected notification %q, got %q", expectedMethod, notification.Method)
		}
	}

	state := codexfake.ReadState(t, session.StateFile)
	if state.LastReview["threadId"] != "thread-test-1" {
		t.Fatalf("expected review threadId to be recorded, got %#v", state.LastReview["threadId"])
	}
	if state.LastTurn["threadId"] != "thread-test-1" {
		t.Fatalf("expected turn threadId to be recorded, got %#v", state.LastTurn["threadId"])
	}
}

func TestStartReportsUnexpectedRuntimeClosure(t *testing.T) {
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"turn/start": {
				Result: map[string]any{
					"turn": map[string]any{
						"id":     "turn-crash-1",
						"status": "inProgress",
					},
				},
				Exit: &codexfake.ExitBehavior{
					Code:   17,
					Stderr: "simulated runtime crash",
				},
			},
		},
	})

	handler := newTestHandler()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := Start(ctx, Config{
		Command:         session.Command,
		Cwd:             t.TempDir(),
		ClientName:      "bridge-test",
		ClientVersion:   "1.2.3",
		ExperimentalAPI: true,
	}, handler)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer client.Close()

	var response struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := client.Call(ctx, "turn/start", map[string]any{
		"threadId": "thread-test-1",
	}, &response); err != nil {
		t.Fatalf("Call(turn/start) error = %v", err)
	}
	if response.Turn.ID != "turn-crash-1" {
		t.Fatalf("expected crash scenario turn id, got %q", response.Turn.ID)
	}

	select {
	case err := <-handler.closed:
		_ = err
	case <-time.After(2 * time.Second):
		t.Fatal("expected runtime close notification")
	}

	if stderr := handler.drainStderr(); !strings.Contains(stderr, "simulated runtime crash") {
		t.Fatalf("expected crash stderr to be captured, got %q", stderr)
	}
}
