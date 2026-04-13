package turns

import (
	"context"
	"testing"

	"codex-server/backend/internal/bridge"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/testutil/codexfake"
)

func TestCodexFakeHelperProcess(t *testing.T) {
	codexfake.RunHelperProcessIfRequested(t)
}

func TestIsThreadResumeRequiredForNotLoaded(t *testing.T) {
	t.Parallel()

	err := &bridge.RPCError{
		Code:    -32600,
		Message: "thread not loaded: 019d0aa6-3c5a-7142-9820-8e8eb7bbbd36",
	}

	if !isThreadResumeRequired(err) {
		t.Fatal("expected thread-not-loaded error to be recognized")
	}
}

func TestIsThreadResumeRequiredForNotFound(t *testing.T) {
	t.Parallel()

	err := &bridge.RPCError{
		Code:    -32600,
		Message: "thread not found: 019d0b0a-da4d-72a0-bb67-ee081fa7e03e",
	}

	if !isThreadResumeRequired(err) {
		t.Fatal("expected thread-not-found error to be recognized")
	}
}

func TestIsThreadResumeRequiredRejectsOtherErrors(t *testing.T) {
	t.Parallel()

	err := &bridge.RPCError{
		Code:    -32600,
		Message: "thread/read failed",
	}

	if isThreadResumeRequired(err) {
		t.Fatal("expected unrelated RPC error to be ignored")
	}
}

func TestBuildTurnStartPayloadUsesSelectedOverrides(t *testing.T) {
	t.Parallel()

	payload := buildTurnStartPayload("thread-1", "Inspect the repo", StartOptions{
		Model:            "gpt-5.4",
		ReasoningEffort:  "xhigh",
		PermissionPreset: "full-access",
	}, nil)

	if payload["threadId"] != "thread-1" {
		t.Fatalf("expected thread id to be forwarded, got %#v", payload["threadId"])
	}
	if payload["model"] != "gpt-5.4" {
		t.Fatalf("expected model override, got %#v", payload["model"])
	}
	if payload["effort"] != "xhigh" {
		t.Fatalf("expected reasoning effort override, got %#v", payload["effort"])
	}
	if payload["approvalPolicy"] != "never" {
		t.Fatalf("expected full-access approval policy, got %#v", payload["approvalPolicy"])
	}

	sandboxPolicy, ok := payload["sandboxPolicy"].(map[string]any)
	if !ok {
		t.Fatalf("expected sandbox policy override map, got %#v", payload["sandboxPolicy"])
	}
	if sandboxPolicy["type"] != "dangerFullAccess" {
		t.Fatalf("expected danger-full-access sandbox policy, got %#v", sandboxPolicy["type"])
	}
}

func TestBuildTurnStartPayloadNormalizesReasoningEffort(t *testing.T) {
	t.Parallel()

	payload := buildTurnStartPayload("thread-1", "Inspect the repo", StartOptions{
		ReasoningEffort: "invalid",
	}, nil)

	if payload["effort"] != "medium" {
		t.Fatalf("expected invalid reasoning effort to fall back to medium, got %#v", payload["effort"])
	}
}

func TestBuildTurnStartPayloadAppliesRuntimeDefaults(t *testing.T) {
	t.Parallel()

	payload := buildTurnStartPayloadWithRuntimeDefaults("thread-1", "Inspect the repo", StartOptions{}, nil, runtimeDefaults{
		ApprovalPolicy: "on-request",
		SandboxPolicy: map[string]any{
			"type": "externalSandbox",
		},
	})

	if payload["approvalPolicy"] != "on-request" {
		t.Fatalf("expected runtime approval policy override, got %#v", payload["approvalPolicy"])
	}

	sandboxPolicy, ok := payload["sandboxPolicy"].(map[string]any)
	if !ok {
		t.Fatalf("expected sandbox policy override map, got %#v", payload["sandboxPolicy"])
	}
	if sandboxPolicy["type"] != "externalSandbox" {
		t.Fatalf("expected runtime sandbox policy override, got %#v", sandboxPolicy["type"])
	}
}

func TestBuildTurnStartPayloadOmitsEmptyResponsesAPIClientMetadata(t *testing.T) {
	t.Parallel()

	payload := buildTurnStartPayload("thread-1", "Inspect the repo", StartOptions{}, nil)
	if _, ok := payload["responsesapiClientMetadata"]; ok {
		t.Fatalf("expected responsesapiClientMetadata to be omitted, got %#v", payload["responsesapiClientMetadata"])
	}
}

func TestBuildTurnStartPayloadIncludesResponsesAPIClientMetadata(t *testing.T) {
	t.Parallel()

	payload := buildTurnStartPayload("thread-1", "Inspect the repo", StartOptions{
		ResponsesAPIClientMetadata: InteractiveStartMetadata("ws-1", "thread-1"),
	}, nil)

	metadata, ok := payload["responsesapiClientMetadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected responsesapiClientMetadata map, got %#v", payload["responsesapiClientMetadata"])
	}
	if metadata["source"] != "interactive" {
		t.Fatalf("expected interactive metadata source, got %#v", metadata["source"])
	}
	if metadata["origin"] != "codex-server-web" {
		t.Fatalf("expected codex-server-web origin, got %#v", metadata["origin"])
	}
	if metadata["workspaceId"] != "ws-1" {
		t.Fatalf("expected workspaceId ws-1, got %#v", metadata["workspaceId"])
	}
	if metadata["threadId"] != "thread-1" {
		t.Fatalf("expected threadId thread-1, got %#v", metadata["threadId"])
	}
}

func TestBuildTurnStartPayloadKeepsResponsesAPIClientMetadataWithFullAccessPreset(t *testing.T) {
	t.Parallel()

	payload := buildTurnStartPayload("thread-1", "Inspect the repo", StartOptions{
		PermissionPreset:           "full-access",
		ResponsesAPIClientMetadata: InteractiveStartMetadata("ws-1", "thread-1"),
	}, nil)

	metadata, ok := payload["responsesapiClientMetadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected responsesapiClientMetadata map, got %#v", payload["responsesapiClientMetadata"])
	}
	if metadata["source"] != "interactive" {
		t.Fatalf("expected interactive metadata source, got %#v", metadata["source"])
	}
	if payload["approvalPolicy"] != "never" {
		t.Fatalf("expected full-access approval policy, got %#v", payload["approvalPolicy"])
	}
	sandboxPolicy, ok := payload["sandboxPolicy"].(map[string]any)
	if !ok {
		t.Fatalf("expected sandbox policy override map, got %#v", payload["sandboxPolicy"])
	}
	if sandboxPolicy["type"] != "dangerFullAccess" {
		t.Fatalf("expected danger-full-access sandbox policy, got %#v", sandboxPolicy["type"])
	}
}

func TestBuildCollaborationModePayloadUsesPresetDefaults(t *testing.T) {
	t.Parallel()

	reasoningEffort := "high"
	payload, err := buildCollaborationModePayload("plan", StartOptions{}, collaborationModePreset{
		Mode:            "plan",
		Model:           "gpt-5.4",
		ReasoningEffort: &reasoningEffort,
	})
	if err != nil {
		t.Fatalf("expected collaboration mode payload, got error %v", err)
	}

	if payload["mode"] != "plan" {
		t.Fatalf("expected plan mode, got %#v", payload["mode"])
	}

	settings, ok := payload["settings"].(map[string]any)
	if !ok {
		t.Fatalf("expected settings map, got %#v", payload["settings"])
	}
	if settings["model"] != "gpt-5.4" {
		t.Fatalf("expected preset model, got %#v", settings["model"])
	}
	if settings["reasoning_effort"] != "high" {
		t.Fatalf("expected preset reasoning effort, got %#v", settings["reasoning_effort"])
	}
	if value, ok := settings["developer_instructions"]; !ok || value != nil {
		t.Fatalf("expected developer instructions to be explicit nil, got %#v", settings["developer_instructions"])
	}
}

func TestBuildCollaborationModePayloadPrefersExplicitOverrides(t *testing.T) {
	t.Parallel()

	payload, err := buildCollaborationModePayload("plan", StartOptions{
		Model:           "gpt-5.3-codex",
		ReasoningEffort: "low",
	}, collaborationModePreset{
		Mode:  "plan",
		Model: "gpt-5.4",
	})
	if err != nil {
		t.Fatalf("expected collaboration mode payload, got error %v", err)
	}

	settings := payload["settings"].(map[string]any)
	if settings["model"] != "gpt-5.3-codex" {
		t.Fatalf("expected explicit model override, got %#v", settings["model"])
	}
	if settings["reasoning_effort"] != "low" {
		t.Fatalf("expected explicit reasoning effort override, got %#v", settings["reasoning_effort"])
	}
}

func TestInterruptIsIdempotentWithoutActiveTurn(t *testing.T) {
	t.Parallel()

	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", nil)
	service := NewService(runtimeManager, store.NewMemoryStore())

	result, err := service.Interrupt(context.Background(), "ws-1", "thread-1")
	if err != nil {
		t.Fatalf("Interrupt() error = %v", err)
	}
	if result.Status != "interrupted" {
		t.Fatalf("expected interrupted status, got %#v", result.Status)
	}
	if result.TurnID != "" {
		t.Fatalf("expected empty turn id for idempotent interrupt, got %#v", result.TurnID)
	}
}

func TestInterruptSendsTurnInterruptThroughRuntime(t *testing.T) {
	session := codexfake.NewSession(t, "TestCodexFakeHelperProcess")
	t.Setenv("CODEX_FAKE_HELPER_ENABLED", "1")
	t.Setenv("CODEX_FAKE_HELPER_STATE_FILE", session.StateFile)

	runtimeManager := runtime.NewManager(session.Command, events.NewHub())
	workspaceRoot := t.TempDir()
	runtimeManager.Configure("ws-1", workspaceRoot)
	defer runtimeManager.Remove("ws-1")
	runtimeManager.RememberActiveTurn("ws-1", "thread-1", "turn-9")

	service := NewService(runtimeManager, store.NewMemoryStore())
	result, err := service.Interrupt(context.Background(), "ws-1", "thread-1")
	if err != nil {
		t.Fatalf("Interrupt() error = %v", err)
	}
	if result.Status != "interrupted" {
		t.Fatalf("expected interrupted status, got %#v", result.Status)
	}
	if result.TurnID != "turn-9" {
		t.Fatalf("expected turn-9 to be returned, got %#v", result.TurnID)
	}
	if activeTurnID := runtimeManager.ActiveTurnID("ws-1", "thread-1"); activeTurnID != "" {
		t.Fatalf("expected active turn to be cleared, got %q", activeTurnID)
	}

	state := codexfake.ReadState(t, session.StateFile)
	if len(state.Received) < 3 {
		t.Fatalf("expected initialize, initialized, turn/interrupt to be recorded, got %#v", state.Received)
	}
	last := state.Received[len(state.Received)-1]
	if last.Method != "turn/interrupt" {
		t.Fatalf("expected last method turn/interrupt, got %q", last.Method)
	}
	if state.LastInterrupt["threadId"] != "thread-1" {
		t.Fatalf("expected interrupt threadId thread-1, got %#v", state.LastInterrupt["threadId"])
	}
	if state.LastInterrupt["turnId"] != "turn-9" {
		t.Fatalf("expected interrupt turnId turn-9, got %#v", state.LastInterrupt["turnId"])
	}
}

func TestInterruptIsIdempotentWhenInterruptAlreadyInProgress(t *testing.T) {
	t.Parallel()

	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", nil)
	runtimeManager.Configure("ws-1", t.TempDir())
	runtimeManager.RememberActiveTurn("ws-1", "thread-1", "turn-9")
	if begun := runtimeManager.BeginInterrupt("ws-1", "thread-1"); begun != "turn-9" {
		t.Fatalf("expected begin interrupt to capture turn-9, got %q", begun)
	}

	service := NewService(runtimeManager, store.NewMemoryStore())
	result, err := service.Interrupt(context.Background(), "ws-1", "thread-1")
	if err != nil {
		t.Fatalf("Interrupt() error = %v", err)
	}
	if result.Status != "interrupted" {
		t.Fatalf("expected interrupted status, got %#v", result.Status)
	}
	if result.TurnID != "" {
		t.Fatalf("expected idempotent interrupt-in-progress to return empty turn id, got %#v", result.TurnID)
	}
}

func TestReviewStartsThroughRuntime(t *testing.T) {
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"review/start": {
				Result: map[string]any{
					"turn": map[string]any{
						"id":     "review-turn-42",
						"status": "inProgress",
					},
				},
			},
		},
	})

	runtimeManager := runtime.NewManager(session.Command, events.NewHub())
	workspaceRoot := t.TempDir()
	runtimeManager.Configure("ws-1", workspaceRoot)
	defer runtimeManager.Remove("ws-1")

	service := NewService(runtimeManager, store.NewMemoryStore())
	result, err := service.Review(context.Background(), "ws-1", "thread-1")
	if err != nil {
		t.Fatalf("Review() error = %v", err)
	}
	if result.Status != "reviewing" {
		t.Fatalf("expected reviewing status, got %#v", result.Status)
	}
	if result.TurnID != "review-turn-42" {
		t.Fatalf("expected custom review turn id, got %#v", result.TurnID)
	}

	state := codexfake.ReadState(t, session.StateFile)
	if state.LastReview["threadId"] != "thread-1" {
		t.Fatalf("expected review threadId thread-1, got %#v", state.LastReview["threadId"])
	}
	if state.LastReview["delivery"] != "inline" {
		t.Fatalf("expected inline review delivery, got %#v", state.LastReview["delivery"])
	}
}

func TestStartReturnsRunningWhenCompletionNotificationIsMissing(t *testing.T) {
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"turn/start": {
				Result: map[string]any{
					"turn": map[string]any{
						"id":     "turn-missing-complete-1",
						"status": "inProgress",
					},
				},
				Notifications: []codexfake.Notification{
					{
						Method: "turn/started",
						Params: map[string]any{
							"threadId": "thread-1",
							"turn": map[string]any{
								"id":     "turn-missing-complete-1",
								"status": "inProgress",
							},
						},
					},
					{
						Method: "item/completed",
						Params: map[string]any{
							"threadId": "thread-1",
							"turnId":   "turn-missing-complete-1",
							"item": map[string]any{
								"id":   "subagent-item-1",
								"type": "agentMessage",
								"text": "partial result",
							},
						},
					},
				},
			},
		},
	})

	runtimeManager := runtime.NewManager(session.Command, events.NewHub())
	workspaceRoot := t.TempDir()
	runtimeManager.Configure("ws-1", workspaceRoot)
	defer runtimeManager.Remove("ws-1")

	service := NewService(runtimeManager, store.NewMemoryStore())
	result, err := service.Start(context.Background(), "ws-1", "thread-1", "Inspect the repo", StartOptions{})
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if result.Status != "running" {
		t.Fatalf("expected running status, got %#v", result.Status)
	}
	if result.TurnID != "turn-missing-complete-1" {
		t.Fatalf("expected custom turn id, got %#v", result.TurnID)
	}
	if activeTurnID := runtimeManager.ActiveTurnID("ws-1", "thread-1"); activeTurnID != "turn-missing-complete-1" {
		t.Fatalf("expected active turn to be remembered, got %q", activeTurnID)
	}
}

func TestStartSendsResponsesAPIClientMetadataThroughRuntime(t *testing.T) {
	session := codexfake.NewSession(t, "TestCodexFakeHelperProcess")

	runtimeManager := runtime.NewManager(session.Command, events.NewHub())
	workspaceRoot := t.TempDir()
	runtimeManager.Configure("ws-1", workspaceRoot)
	defer runtimeManager.Remove("ws-1")

	service := NewService(runtimeManager, store.NewMemoryStore())
	result, err := service.Start(context.Background(), "ws-1", "thread-1", "Inspect the repo", StartOptions{
		ResponsesAPIClientMetadata: AutomationStartMetadata("ws-1", "thread-1", "auto-1", "run-1", "schedule"),
	})
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if result.TurnID != "turn-test-1" {
		t.Fatalf("expected fake turn id, got %#v", result.TurnID)
	}

	state := codexfake.ReadState(t, session.StateFile)
	metadata, ok := state.LastTurn["responsesapiClientMetadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected responsesapiClientMetadata in runtime payload, got %#v", state.LastTurn["responsesapiClientMetadata"])
	}
	if metadata["source"] != "automation" {
		t.Fatalf("expected automation metadata source, got %#v", metadata["source"])
	}
	if metadata["automationId"] != "auto-1" {
		t.Fatalf("expected automationId auto-1, got %#v", metadata["automationId"])
	}
	if metadata["automationRunId"] != "run-1" {
		t.Fatalf("expected automationRunId run-1, got %#v", metadata["automationRunId"])
	}
	if metadata["automationTrigger"] != "schedule" {
		t.Fatalf("expected automationTrigger schedule, got %#v", metadata["automationTrigger"])
	}
}
