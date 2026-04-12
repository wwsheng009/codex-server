package store

import (
	"strings"
	"testing"
)

func TestApplyThreadEventToProjectionPreservesExistingItemOrderOnTurnCompleted(t *testing.T) {
	t.Parallel()

	projection := &ThreadProjection{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
	}

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/started",
		Payload: map[string]any{
			"turnId": "turn-1",
			"item": map[string]any{
				"id":      "cmd-1",
				"type":    "commandExecution",
				"command": "go test ./...",
			},
		},
	})
	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/commandExecution/outputDelta",
		Payload: map[string]any{
			"turnId": "turn-1",
			"itemId": "cmd-1",
			"delta":  "ok",
		},
	})
	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/agentMessage/delta",
		Payload: map[string]any{
			"turnId": "turn-1",
			"itemId": "msg-1",
			"delta":  "done",
		},
	})

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":   "msg-1",
						"type": "agentMessage",
						"text": "done",
					},
					map[string]any{
						"id":               "cmd-1",
						"type":             "commandExecution",
						"command":          "go test ./...",
						"aggregatedOutput": "ok",
						"status":           "completed",
					},
				},
			},
		},
	})

	if len(projection.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %#v", projection.Turns)
	}
	if len(projection.Turns[0].Items) != 2 {
		t.Fatalf("expected 2 items after completion merge, got %#v", projection.Turns[0].Items)
	}
	if got := projection.Turns[0].Items[0]["id"]; got != "cmd-1" {
		t.Fatalf("expected command item to stay first, got %#v", projection.Turns[0].Items)
	}
	if got := projection.Turns[0].Items[1]["id"]; got != "msg-1" {
		t.Fatalf("expected agent item to stay second, got %#v", projection.Turns[0].Items)
	}
	if got := projection.Turns[0].Items[0]["status"]; got != "completed" {
		t.Fatalf("expected command item fields to merge from completion payload, got %#v", projection.Turns[0].Items[0])
	}
	if got := projection.Turns[0].Items[1]["text"]; got != "done" {
		t.Fatalf("expected agent text to survive completion merge, got %#v", projection.Turns[0].Items[1])
	}
}

func TestApplyThreadEventToProjectionCompactsLargeCommandOutput(t *testing.T) {
	t.Parallel()

	projection := &ThreadProjection{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
	}

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/started",
		Payload: map[string]any{
			"turnId": "turn-1",
			"item": map[string]any{
				"id":      "cmd-1",
				"type":    "commandExecution",
				"command": "go test ./...",
			},
		},
	})

	longDelta := strings.Repeat("output line\n", 600)
	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/commandExecution/outputDelta",
		Payload: map[string]any{
			"turnId": "turn-1",
			"itemId": "cmd-1",
			"delta":  longDelta,
		},
	})

	item := projection.Turns[0].Items[0]
	gotOutput := stringValue(item["aggregatedOutput"])
	if len(gotOutput) >= len(longDelta) {
		t.Fatalf("expected projected command output to be compacted, got len=%d want < %d", len(gotOutput), len(longDelta))
	}
	if len(gotOutput) > threadProjectionCommandOutputMaxBytes {
		t.Fatalf("expected projected command output to stay within %d bytes, got %d", threadProjectionCommandOutputMaxBytes, len(gotOutput))
	}
	if got := intValue(item["outputTotalLength"]); got != len(longDelta) {
		t.Fatalf("expected total output length %d, got %d", len(longDelta), got)
	}
	if got := stringValue(item["outputContentMode"]); got != "tail" {
		t.Fatalf("expected compacted command output mode tail, got %q", got)
	}
	if got := item["outputTruncated"]; got != true {
		t.Fatalf("expected compacted command output to be marked truncated, got %#v", got)
	}
	if got := intValue(item["outputStartOffset"]); got <= 0 {
		t.Fatalf("expected compacted command output to record a positive start offset, got %d", got)
	}
}

func TestApplyThreadEventToProjectionPersistsHookRunsInsideTurnTimeline(t *testing.T) {
	t.Parallel()

	projection := &ThreadProjection{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
	}

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "hook/started",
		Payload: map[string]any{
			"run": map[string]any{
				"id":            "hook-1",
				"turnId":        "turn-1",
				"eventName":     "PostToolUse",
				"handlerKey":    "builtin.posttooluse.failed-validation-rescue",
				"triggerMethod": "item/completed",
				"toolName":      "command/exec",
				"status":        "running",
				"decision":      "continueTurn",
				"reason":        "validation_command_failed",
				"entries": []any{
					map[string]any{
						"kind": "feedback",
						"text": "command=go test ./...",
					},
				},
			},
		},
	})

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "hook/completed",
		Payload: map[string]any{
			"run": map[string]any{
				"id":            "hook-1",
				"turnId":        "turn-1",
				"eventName":     "PostToolUse",
				"handlerKey":    "builtin.posttooluse.failed-validation-rescue",
				"triggerMethod": "item/completed",
				"toolName":      "command/exec",
				"status":        "completed",
				"decision":      "continueTurn",
				"reason":        "validation_command_failed",
				"durationMs":    42,
			},
		},
	})

	if len(projection.Turns) != 1 || len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected hook run item in projection, got %#v", projection.Turns)
	}

	item := projection.Turns[0].Items[0]
	if got := item["id"]; got != "hook-run-hook-1" {
		t.Fatalf("expected hook run item id, got %#v", item)
	}
	if got := item["type"]; got != "hookRun" {
		t.Fatalf("expected hookRun item type, got %#v", item)
	}
	if got := item["status"]; got != "completed" {
		t.Fatalf("expected latest hook status to merge, got %#v", item)
	}
	if got := stringValue(item["message"]); got != "Event: Post-Tool Use\nHandler: Failed Validation Rescue\nStatus: Completed\nDecision: Continue Turn\nTrigger: Item Completed\nTool: Command Execution\nReason: Validation command failed" {
		t.Fatalf("expected hook message to use readable labels, got %#v", item["message"])
	}
}

func TestApplyThreadEventToProjectionInsertsHookRunAfterRelatedItem(t *testing.T) {
	t.Parallel()

	projection := &ThreadProjection{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
	}

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"turnId": "turn-1",
			"item": map[string]any{
				"id":      "cmd-1",
				"type":    "commandExecution",
				"command": "go test ./...",
				"status":  "completed",
			},
		},
	})
	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"turnId": "turn-1",
			"item": map[string]any{
				"id":   "msg-1",
				"type": "agentMessage",
				"text": "done",
			},
		},
	})

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "hook/completed",
		Payload: map[string]any{
			"run": map[string]any{
				"id":            "hook-1",
				"turnId":        "turn-1",
				"itemId":        "cmd-1",
				"eventName":     "PostToolUse",
				"handlerKey":    "builtin.posttooluse.failed-validation-rescue",
				"triggerMethod": "item/completed",
				"toolName":      "command/exec",
				"status":        "completed",
				"decision":      "continueTurn",
				"reason":        "validation_command_failed",
			},
		},
	})

	if len(projection.Turns) != 1 || len(projection.Turns[0].Items) != 3 {
		t.Fatalf("expected hook run to be inserted into turn timeline, got %#v", projection.Turns)
	}
	if got := projection.Turns[0].Items[0]["id"]; got != "cmd-1" {
		t.Fatalf("expected related command item to stay first, got %#v", projection.Turns[0].Items)
	}
	if got := projection.Turns[0].Items[1]["id"]; got != "hook-run-hook-1" {
		t.Fatalf("expected hook run to be inserted after related item, got %#v", projection.Turns[0].Items)
	}
	if got := projection.Turns[0].Items[2]["id"]; got != "msg-1" {
		t.Fatalf("expected later items to remain after hook run, got %#v", projection.Turns[0].Items)
	}
	if got := projection.Turns[0].Items[1]["itemId"]; got != "cmd-1" {
		t.Fatalf("expected projected hook run to preserve related item id, got %#v", projection.Turns[0].Items[1])
	}
}

func TestApplyThreadEventToProjectionPersistsSessionStartSource(t *testing.T) {
	t.Parallel()

	projection := &ThreadProjection{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
	}

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		Method:      "hook/completed",
		Payload: map[string]any{
			"run": map[string]any{
				"id":                 "hook-session-1",
				"eventName":          "SessionStart",
				"handlerKey":         "builtin.sessionstart.inject-project-context",
				"triggerMethod":      "turn/start",
				"status":             "completed",
				"decision":           "continue",
				"reason":             "project_context_injected",
				"sessionStartSource": "resume",
			},
		},
	})

	if len(projection.Turns) != 1 || len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected session-start hook run item in projection, got %#v", projection.Turns)
	}

	item := projection.Turns[0].Items[0]
	if got := item["sessionStartSource"]; got != "resume" {
		t.Fatalf("expected projected session-start source, got %#v", item)
	}
	if got := stringValue(item["message"]); got != "Event: Session Start\nHandler: Project Context Injection\nStatus: Completed\nDecision: Continue\nTrigger: Turn Start\nSession Start Source: Resume\nReason: Project context injected" {
		t.Fatalf("expected session-start hook message to include source, got %#v", item["message"])
	}
}

func TestApplyThreadEventToProjectionProjectsTurnPlanUpdates(t *testing.T) {
	t.Parallel()

	projection := &ThreadProjection{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
	}

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/plan/updated",
		Payload: map[string]any{
			"turnId":      "turn-1",
			"explanation": "Investigate and patch the runtime flow",
			"plan": []any{
				map[string]any{
					"step":   "Inspect logs",
					"status": "completed",
				},
				map[string]any{
					"step":   "Patch retry flow",
					"status": "inProgress",
				},
			},
		},
	})

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items":  []any{},
			},
		},
	})

	if len(projection.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %#v", projection.Turns)
	}
	if len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected 1 projected plan item, got %#v", projection.Turns[0].Items)
	}

	item := projection.Turns[0].Items[0]
	if got := stringValue(item["id"]); got != "turn-plan-turn-1" {
		t.Fatalf("expected synthetic turn plan id, got %#v", item)
	}
	if got := stringValue(item["type"]); got != "turnPlan" {
		t.Fatalf("expected turnPlan item type, got %#v", item)
	}
	if got := stringValue(item["status"]); got != "inProgress" {
		t.Fatalf("expected overall plan status to reflect active work, got %#v", item)
	}
	if got := stringValue(item["explanation"]); got != "Investigate and patch the runtime flow" {
		t.Fatalf("expected explanation to be projected, got %#v", item)
	}

	steps, ok := item["steps"].([]map[string]any)
	if !ok || len(steps) != 2 {
		t.Fatalf("expected 2 projected plan steps, got %#v", item["steps"])
	}
	if got := stringValue(steps[0]["status"]); got != "completed" {
		t.Fatalf("expected first step to be completed, got %#v", steps[0])
	}
	if got := stringValue(steps[1]["status"]); got != "inProgress" {
		t.Fatalf("expected second step to be inProgress, got %#v", steps[1])
	}
	if projection.Turns[0].Status != "completed" {
		t.Fatalf("expected turn completion to remain intact, got %#v", projection.Turns[0])
	}
}

func TestApplyThreadEventToProjectionPlacesTurnlessHookRunsIntoSyntheticGovernanceTurn(t *testing.T) {
	t.Parallel()

	projection := &ThreadProjection{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		Turns: []ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items:  []map[string]any{},
			},
		},
	}

	applyThreadEventToProjection(projection, EventEnvelope{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		Method:      "hook/completed",
		Payload: map[string]any{
			"run": map[string]any{
				"id":            "hook-thread-1",
				"threadId":      "thread-1",
				"eventName":     "UserPromptSubmit",
				"handlerKey":    "builtin.userpromptsubmit.block-secret-paste",
				"triggerMethod": "turn/start",
				"status":        "completed",
				"decision":      "block",
				"reason":        "secret_like_input_blocked",
			},
		},
	})

	if len(projection.Turns) != 2 {
		t.Fatalf("expected synthetic governance turn plus existing turn, got %#v", projection.Turns)
	}
	if projection.Turns[0].ID != threadGovernanceTurnID {
		t.Fatalf("expected synthetic governance turn to be prepended, got %#v", projection.Turns)
	}
	if len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected hook run item in governance turn, got %#v", projection.Turns[0].Items)
	}
	if got := projection.Turns[0].Items[0]["hookRunId"]; got != "hook-thread-1" {
		t.Fatalf("expected governance hook run item, got %#v", projection.Turns[0].Items[0])
	}
	if got := stringValue(projection.Turns[0].Items[0]["message"]); got != "Event: User Prompt Submit\nHandler: Secret Paste Guard\nStatus: Completed\nDecision: Block\nTrigger: Turn Start\nReason: Secret-like input blocked" {
		t.Fatalf("expected governance hook message to use readable labels, got %#v", projection.Turns[0].Items[0]["message"])
	}
	if projection.TurnCount != 1 {
		t.Fatalf("expected synthetic governance turn to be excluded from turn count, got %d", projection.TurnCount)
	}
}
