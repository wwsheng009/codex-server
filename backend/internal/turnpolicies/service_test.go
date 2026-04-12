package turnpolicies

import (
	"context"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turns"
)

func TestServiceSteersAfterFailedValidationCommand(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 0, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.steerCount() == 1
	})

	if fakeTurns.startCount() != 0 {
		t.Fatalf("expected no follow-up start, got %d", fakeTurns.startCount())
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Action != actionSteer || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected successful steer decision, got %#v", decisions[0])
	}
}

func TestServiceSkipsFallbackWhenHookGovernanceAlreadyHandledEvent(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	turnPolicyService := NewService(dataStore, fakeTurns, eventHub)
	turnPolicyService.SetHooksPrimary(true)
	turnPolicyService.hookStartGrace = 20 * time.Millisecond
	turnPolicyService.hookPollInterval = 5 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	turnPolicyService.Start(ctx)

	event := store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 11, 1, 0, 0, 0, time.UTC),
	}
	request, ok := evaluateFailedValidationCommand(event, DefaultValidationCommandPrefixes())
	if !ok {
		t.Fatal("expected failed validation event to produce a policy request")
	}

	go func() {
		time.Sleep(10 * time.Millisecond)
		_, _ = dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
			WorkspaceID:         workspace.ID,
			ThreadID:            "thread-1",
			TurnID:              request.turnID,
			ItemID:              request.itemID,
			TriggerMethod:       request.triggerMethod,
			PolicyName:          request.policyName,
			Fingerprint:         request.fingerprint,
			Verdict:             actionSteer,
			Action:              actionSteer,
			ActionStatus:        actionStatusSucceeded,
			Reason:              request.reason,
			EvidenceSummary:     request.evidenceSummary,
			GovernanceLayer:     governanceLayerHook,
			EvaluationStartedAt: event.TS,
			DecisionAt:          event.TS.Add(10 * time.Millisecond),
			CompletedAt:         event.TS.Add(10 * time.Millisecond),
		})
	}()

	eventHub.Publish(event)

	waitFor(t, func() bool {
		decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
		return fakeTurns.steerCount() == 0 && len(decisions) == 1
	})

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected hook primary path to avoid duplicate fallback decisions, got %#v", decisions)
	}
	if decisions[0].GovernanceLayer != governanceLayerHook {
		t.Fatalf("expected hook governance layer when hook already handled event, got %#v", decisions[0])
	}
	if decisions[0].ActionStatus != actionStatusSucceeded || decisions[0].Action != actionSteer {
		t.Fatalf("expected successful hook decision without fallback duplication, got %#v", decisions[0])
	}
}

func TestServiceFallsBackWhenHookGovernanceFails(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	turnPolicyService := NewService(dataStore, fakeTurns, eventHub)
	turnPolicyService.SetHooksPrimary(true)
	turnPolicyService.hookStartGrace = 20 * time.Millisecond
	turnPolicyService.hookPollInterval = 5 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	turnPolicyService.Start(ctx)

	event := store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 11, 1, 5, 0, 0, time.UTC),
	}
	request, ok := evaluateFailedValidationCommand(event, DefaultValidationCommandPrefixes())
	if !ok {
		t.Fatal("expected failed validation event to produce a policy request")
	}

	go func() {
		time.Sleep(10 * time.Millisecond)
		_, _ = dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
			WorkspaceID:         workspace.ID,
			ThreadID:            "thread-1",
			TurnID:              request.turnID,
			ItemID:              request.itemID,
			TriggerMethod:       request.triggerMethod,
			PolicyName:          request.policyName,
			Fingerprint:         request.fingerprint,
			Verdict:             actionSteer,
			Action:              actionSteer,
			ActionStatus:        actionStatusFailed,
			Reason:              request.reason,
			EvidenceSummary:     request.evidenceSummary,
			GovernanceLayer:     governanceLayerHook,
			Error:               "hook steer failed",
			EvaluationStartedAt: event.TS,
			DecisionAt:          event.TS.Add(10 * time.Millisecond),
			CompletedAt:         event.TS.Add(10 * time.Millisecond),
		})
	}()

	eventHub.Publish(event)

	waitFor(t, func() bool {
		decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
		return fakeTurns.steerCount() == 1 && len(decisions) == 2
	})

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	hookDecision, ok := findDecisionByGovernanceLayer(decisions, governanceLayerHook)
	if !ok {
		t.Fatalf("expected failed hook decision before fallback, got %#v", decisions)
	}
	if hookDecision.ActionStatus != actionStatusFailed {
		t.Fatalf("expected hook decision to record failure before fallback, got %#v", hookDecision)
	}

	fallbackDecision, ok := findDecisionByGovernanceLayer(decisions, governanceLayerTurnPolicyFallback)
	if !ok {
		t.Fatalf("expected fallback decision to be persisted after hook failure, got %#v", decisions)
	}
	if fallbackDecision.ActionStatus != actionStatusSucceeded || fallbackDecision.Action != actionSteer {
		t.Fatalf("expected successful turn policy fallback rescue, got %#v", fallbackDecision)
	}
}

func TestServiceUsesFallbackWhenHooksPrimaryEnabledButNoHookRunAppears(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	service.SetHooksPrimary(true)
	service.hookStartGrace = 20 * time.Millisecond
	service.hookPollInterval = 5 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 11, 1, 10, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
		return fakeTurns.steerCount() == 1 && len(decisions) == 1
	})

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected a single fallback decision when no hook run appears, got %#v", decisions)
	}
	if decisions[0].GovernanceLayer != governanceLayerTurnPolicyFallback {
		t.Fatalf("expected turn policy fallback governance layer, got %#v", decisions[0])
	}
	if decisions[0].ActionStatus != actionStatusSucceeded || decisions[0].Action != actionSteer {
		t.Fatalf("expected fallback to execute the rescue action, got %#v", decisions[0])
	}
}

func TestServiceUsesConfiguredFollowUpPrimaryActionForFailedValidationCommand(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyPostToolUsePrimaryAction: actionFollowUp,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 2, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.startCount() == 1
	})

	if fakeTurns.steerCount() != 0 {
		t.Fatalf("expected configured follow-up action to avoid steer, got %d", fakeTurns.steerCount())
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Verdict != actionFollowUp || decisions[0].Action != actionFollowUp || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected configured follow-up decision, got %#v", decisions[0])
	}
	expectTurnPolicyFollowUpMetadata(
		t,
		fakeTurns.startCalls[0],
		workspace.ID,
		"thread-1",
		"item/completed",
		postToolUsePolicyName,
	)
}

func TestServiceUsesConfiguredValidationCommandPrefixes(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyValidationCommandPrefixes: []string{"npm run check"},
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "npm run check -- --strict",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "lint failed\n",
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 2, 30, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.steerCount() == 1
	})

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Reason != "validation_command_failed" || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected configured validation command failure to trigger rescue, got %#v", decisions[0])
	}
}

func TestServiceUsesConfiguredInterruptPrimaryActionForFailedValidationCommand(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyPostToolUsePrimaryAction: actionInterrupt,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 3, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.interruptCount() == 1
	})

	if fakeTurns.startCount() != 0 || fakeTurns.steerCount() != 0 {
		t.Fatalf(
			"expected configured interrupt action to avoid follow-up and steer, got start=%d steer=%d",
			fakeTurns.startCount(),
			fakeTurns.steerCount(),
		)
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Verdict != actionInterrupt || decisions[0].Action != actionInterrupt || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected configured interrupt decision, got %#v", decisions[0])
	}
	if decisions[0].ActionTurnID != "turn-interrupted" {
		t.Fatalf("expected interrupt action turn id to be persisted, got %#v", decisions[0])
	}
}

func TestServiceSkipsInterruptWhenNoActiveTurnExists(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyPostToolUsePrimaryAction: actionInterrupt,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		interruptResult: turns.Result{
			TurnID: "",
			Status: "interrupted",
		},
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 4, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.interruptCount() == 1
	})

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Verdict != actionInterrupt || decisions[0].Action != actionInterrupt || decisions[0].ActionStatus != actionStatusSkipped {
		t.Fatalf("expected skipped interrupt decision when no active turn exists, got %#v", decisions[0])
	}
	if decisions[0].Reason != reasonInterruptNoActiveTurn {
		t.Fatalf("expected interrupt skip reason %q, got %#v", reasonInterruptNoActiveTurn, decisions[0])
	}
	if decisions[0].ActionTurnID != "" {
		t.Fatalf("expected no interrupt action turn id to be persisted, got %#v", decisions[0])
	}
}

func TestServiceFallsBackToFollowUpWhenInterruptHasNoActiveTurnAndConfiguredForFailedValidationCommand(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyPostToolUsePrimaryAction:                 actionInterrupt,
		TurnPolicyPostToolUseInterruptNoActiveTurnBehavior: actionFollowUp,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		interruptResult: turns.Result{
			TurnID: "",
			Status: "interrupted",
		},
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 5, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.interruptCount() == 1 && fakeTurns.startCount() == 1
	})

	if fakeTurns.steerCount() != 0 {
		t.Fatalf("expected interrupt fallback to avoid steer, got %d", fakeTurns.steerCount())
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Verdict != actionInterrupt || decisions[0].Action != actionFollowUp || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected interrupt verdict with follow-up fallback, got %#v", decisions[0])
	}
	if decisions[0].Reason != reasonInterruptNoActiveTurn {
		t.Fatalf("expected interrupt no-active-turn reason to be preserved, got %#v", decisions[0])
	}
	if decisions[0].ActionTurnID != "turn-follow-up" {
		t.Fatalf("expected follow-up fallback turn id to be persisted, got %#v", decisions[0])
	}
	expectTurnPolicyFollowUpMetadata(
		t,
		fakeTurns.startCalls[0],
		workspace.ID,
		"thread-1",
		"item/completed",
		postToolUsePolicyName,
	)
}

func TestServiceDeduplicatesRepeatedFailedValidationEvents(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	event := store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":       "cmd-1",
				"type":     "commandExecution",
				"command":  "go test ./...",
				"status":   "failed",
				"exitCode": 1,
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 5, 0, 0, time.UTC),
	}

	eventHub.Publish(event)
	eventHub.Publish(event)

	waitFor(t, func() bool {
		return fakeTurns.steerCount() == 1
	})
	time.Sleep(100 * time.Millisecond)

	if fakeTurns.steerCount() != 1 {
		t.Fatalf("expected repeated event to steer only once, got %d", fakeTurns.steerCount())
	}
}

func TestServiceStartsFollowUpWhenTurnCompletesWithoutSuccessfulVerification(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-1",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/turnpolicies/service.go",
								"diff": "@@",
							},
						},
					},
					map[string]any{
						"id":   "msg-1",
						"type": "agentMessage",
						"text": "done",
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 10, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.startCount() == 1
	})

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Action != actionFollowUp || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected successful follow-up decision, got %#v", decisions[0])
	}
	expectTurnPolicyFollowUpMetadata(
		t,
		fakeTurns.startCalls[0],
		workspace.ID,
		"thread-1",
		"turn/completed",
		stopMissingVerifyPolicy,
	)
}

func TestServiceFallsBackToFollowUpWhenStopMissingVerifyInterruptHasNoActiveTurn(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyPostToolUseInterruptNoActiveTurnBehavior:                       interruptNoActiveTurnBehaviorSkip,
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction:                 actionInterrupt,
		TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: actionFollowUp,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		interruptResult: turns.Result{
			TurnID: "",
			Status: "interrupted",
		},
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-1",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/turnpolicies/service.go",
								"diff": "@@",
							},
						},
					},
					map[string]any{
						"id":     "msg-1",
						"type":   "agentMessage",
						"status": "completed",
						"text":   "done",
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 8, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.interruptCount() == 1 && fakeTurns.startCount() == 1
	})

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].PolicyName != stopMissingVerifyPolicy {
		t.Fatalf("expected stop-missing-verify policy decision, got %#v", decisions[0])
	}
	if decisions[0].Verdict != actionInterrupt || decisions[0].Action != actionFollowUp || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected interrupt verdict with follow-up fallback, got %#v", decisions[0])
	}
	if decisions[0].Reason != reasonInterruptNoActiveTurn {
		t.Fatalf("expected interrupt no-active-turn reason to be preserved, got %#v", decisions[0])
	}
	expectTurnPolicyFollowUpMetadata(
		t,
		fakeTurns.startCalls[0],
		workspace.ID,
		"thread-1",
		"turn/completed",
		stopMissingVerifyPolicy,
	)
}

func TestServiceUsesConfiguredSteerPrimaryActionForMissingVerificationTurn(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction: actionSteer,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-1",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/turnpolicies/service.go",
								"diff": "@@",
							},
						},
					},
					map[string]any{
						"id":   "msg-1",
						"type": "agentMessage",
						"text": "done",
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 12, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.steerCount() == 1
	})

	if fakeTurns.startCount() != 0 {
		t.Fatalf("expected configured steer action to avoid follow-up start, got %d", fakeTurns.startCount())
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Verdict != actionSteer || decisions[0].Action != actionSteer || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected configured steer decision, got %#v", decisions[0])
	}
}

func TestServiceSkipsFollowUpWhenSuccessfulValidationExistsAfterFileChange(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-1",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/turnpolicies/service.go",
								"diff": "@@",
							},
						},
					},
					map[string]any{
						"id":       "cmd-1",
						"type":     "commandExecution",
						"command":  "go test ./...",
						"status":   "completed",
						"exitCode": 0,
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 8, 13, 15, 0, 0, time.UTC),
	})

	time.Sleep(150 * time.Millisecond)

	if fakeTurns.startCount() != 0 {
		t.Fatalf("expected no follow-up start, got %d", fakeTurns.startCount())
	}
	if decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1"); len(decisions) != 0 {
		t.Fatalf("expected no decision to be stored, got %#v", decisions)
	}
}

func TestServiceSkipsDisabledPolicies(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyPostToolUseFailedValidationEnabled:       serviceBoolPtr(false),
		TurnPolicyStopMissingSuccessfulVerificationEnabled: serviceBoolPtr(false),
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":       "cmd-1",
				"type":     "commandExecution",
				"command":  "go test ./...",
				"status":   "failed",
				"exitCode": 1,
			},
		},
		TS: time.Date(2026, time.April, 9, 10, 0, 0, 0, time.UTC),
	})
	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-2",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-2",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-1",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/turnpolicies/service.go",
							},
						},
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 9, 10, 1, 0, 0, time.UTC),
	})

	time.Sleep(150 * time.Millisecond)

	if fakeTurns.steerCount() != 0 || fakeTurns.startCount() != 0 {
		t.Fatalf("expected disabled policies to avoid actions, got steer=%d start=%d", fakeTurns.steerCount(), fakeTurns.startCount())
	}
	if decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1"); len(decisions) != 0 {
		t.Fatalf("expected disabled policies to avoid persisted decisions, got %#v", decisions)
	}
}

func TestServiceAllowsFollowUpWhenCooldownOverrideIsZero(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyFollowUpCooldownMs: serviceInt64Ptr(0),
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	firstEvent := store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-1",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/turnpolicies/service.go",
							},
						},
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 9, 10, 5, 0, 0, time.UTC),
	}
	secondEvent := store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-2",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-2",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-2",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/turnpolicies/rules.go",
							},
						},
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 9, 10, 5, 30, 0, time.UTC),
	}

	eventHub.Publish(firstEvent)
	waitFor(t, func() bool {
		return fakeTurns.startCount() == 1
	})

	eventHub.Publish(secondEvent)
	waitFor(t, func() bool {
		return fakeTurns.startCount() == 2
	})

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 2 {
		t.Fatalf("expected 2 persisted decisions when cooldown override is zero, got %#v", decisions)
	}
	for _, decision := range decisions {
		if decision.Action != actionFollowUp || decision.ActionStatus != actionStatusSucceeded {
			t.Fatalf("expected follow-up cooldown override to keep decisions actionable, got %#v", decision)
		}
	}
}

func TestServiceAppliesPolicySpecificFollowUpCooldownOverrides(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyFollowUpCooldownMs:                                  serviceInt64Ptr(10 * 60 * 1000),
		TurnPolicyPostToolUseFollowUpCooldownMs:                       serviceInt64Ptr(0),
		TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: serviceInt64Ptr(10 * 60 * 1000),
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	now := time.Date(2026, time.April, 9, 11, 0, 0, 0, time.UTC)

	if _, err := dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-post",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-post",
		Action:              actionFollowUp,
		ActionStatus:        actionStatusSucceeded,
		EvaluationStartedAt: now.Add(-1 * time.Minute),
		DecisionAt:          now.Add(-1 * time.Minute),
		CompletedAt:         now.Add(-1 * time.Minute),
	}); err != nil {
		t.Fatalf("CreateTurnPolicyDecision() post-tool-use error = %v", err)
	}
	if _, err := dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-stop",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-stop",
		Action:              actionFollowUp,
		ActionStatus:        actionStatusSucceeded,
		EvaluationStartedAt: now.Add(-1 * time.Minute),
		DecisionAt:          now.Add(-1 * time.Minute),
		CompletedAt:         now.Add(-1 * time.Minute),
	}); err != nil {
		t.Fatalf("CreateTurnPolicyDecision() stop-missing-verify error = %v", err)
	}

	service := NewService(dataStore, nil, nil)
	if service.recentSuccessfulFollowUp(workspace.ID, "thread-1", postToolUsePolicyName, now) {
		t.Fatalf("expected post-tool-use cooldown override to allow an immediate follow-up")
	}
	if !service.recentSuccessfulFollowUp(workspace.ID, "thread-1", stopMissingVerifyPolicy, now) {
		t.Fatalf("expected stop-missing-verify policy to keep using its configured cooldown")
	}
}

func TestNormalizePrimaryActionPreferenceAcceptsInterrupt(t *testing.T) {
	t.Parallel()

	if got := normalizePrimaryActionPreference(actionInterrupt); got != actionInterrupt {
		t.Fatalf("normalizePrimaryActionPreference(interrupt) = %q, want %q", got, actionInterrupt)
	}
}

func TestNormalizeInterruptNoActiveTurnBehaviorPreferenceAcceptsFollowUp(t *testing.T) {
	t.Parallel()

	if got := normalizeInterruptNoActiveTurnBehaviorPreference(actionFollowUp); got != actionFollowUp {
		t.Fatalf("normalizeInterruptNoActiveTurnBehaviorPreference(followUp) = %q, want %q", got, actionFollowUp)
	}
}

type fakeTurnExecutor struct {
	mu              sync.Mutex
	startCalls      []fakeTurnCall
	steerCalls      []fakeTurnCall
	interruptCalls  []fakeTurnCall
	startErr        error
	steerErr        error
	steerErrs       []error
	interruptResult turns.Result
	interruptErr    error
	reviewErr       error
}

type fakeTurnCall struct {
	workspaceID string
	threadID    string
	input       string
	options     turns.StartOptions
}

func (f *fakeTurnExecutor) Start(
	_ context.Context,
	workspaceID string,
	threadID string,
	input string,
	options turns.StartOptions,
) (turns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.startCalls = append(f.startCalls, fakeTurnCall{
		workspaceID: workspaceID,
		threadID:    threadID,
		input:       input,
		options:     options,
	})
	if f.startErr != nil {
		return turns.Result{}, f.startErr
	}

	return turns.Result{
		TurnID: "turn-follow-up",
		Status: "running",
	}, nil
}

func (f *fakeTurnExecutor) Steer(_ context.Context, workspaceID string, threadID string, input string) (turns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.steerCalls = append(f.steerCalls, fakeTurnCall{
		workspaceID: workspaceID,
		threadID:    threadID,
		input:       input,
	})
	if len(f.steerErrs) > 0 {
		err := f.steerErrs[0]
		f.steerErrs = append([]error(nil), f.steerErrs[1:]...)
		if err != nil {
			return turns.Result{}, err
		}
	}
	if f.steerErr != nil {
		return turns.Result{}, f.steerErr
	}

	return turns.Result{
		TurnID: "turn-1",
		Status: "steered",
	}, nil
}

func (f *fakeTurnExecutor) Interrupt(_ context.Context, workspaceID string, threadID string) (turns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.interruptCalls = append(f.interruptCalls, fakeTurnCall{
		workspaceID: workspaceID,
		threadID:    threadID,
	})

	if f.interruptErr != nil {
		return turns.Result{}, f.interruptErr
	}
	if f.interruptResult != (turns.Result{}) {
		return f.interruptResult, nil
	}

	return turns.Result{
		TurnID: "turn-interrupted",
		Status: "interrupted",
	}, nil
}

func (f *fakeTurnExecutor) Review(_ context.Context, workspaceID string, threadID string) (turns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.reviewErr != nil {
		return turns.Result{}, f.reviewErr
	}
	return turns.Result{
		TurnID: "review-turn-1",
		Status: "reviewing",
	}, nil
}

func (f *fakeTurnExecutor) startCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.startCalls)
}

func (f *fakeTurnExecutor) steerCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.steerCalls)
}

func (f *fakeTurnExecutor) interruptCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.interruptCalls)
}

func expectTurnPolicyFollowUpMetadata(
	t *testing.T,
	call fakeTurnCall,
	workspaceID string,
	threadID string,
	triggerMethod string,
	policyName string,
) {
	t.Helper()

	metadata := call.options.ResponsesAPIClientMetadata
	if metadata.Source != "turn-policy" {
		t.Fatalf("expected turn-policy metadata source, got %#v", metadata.Source)
	}
	if metadata.Origin != "codex-server-web" {
		t.Fatalf("expected codex-server-web metadata origin, got %#v", metadata.Origin)
	}
	if metadata.WorkspaceID != workspaceID {
		t.Fatalf("expected turn-policy metadata workspace id %q, got %#v", workspaceID, metadata.WorkspaceID)
	}
	if metadata.ThreadID != threadID {
		t.Fatalf("expected turn-policy metadata thread id %q, got %#v", threadID, metadata.ThreadID)
	}
	if metadata.TurnPolicyTrigger != triggerMethod {
		t.Fatalf("expected turn-policy trigger method %q, got %#v", triggerMethod, metadata.TurnPolicyTrigger)
	}
	if metadata.TurnPolicyName != policyName {
		t.Fatalf("expected turn-policy name %q, got %#v", policyName, metadata.TurnPolicyName)
	}
}

func findDecisionByGovernanceLayer(
	decisions []store.TurnPolicyDecision,
	governanceLayer string,
) (store.TurnPolicyDecision, bool) {
	for _, decision := range decisions {
		if decision.GovernanceLayer == governanceLayer {
			return decision, true
		}
	}

	return store.TurnPolicyDecision{}, false
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatal("condition not satisfied before timeout")
}

func serviceBoolPtr(value bool) *bool {
	return &value
}

func serviceInt64Ptr(value int64) *int64 {
	return &value
}
