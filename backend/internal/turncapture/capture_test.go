package turncapture

import (
	"testing"

	"codex-server/backend/internal/store"
)

func TestFromTurnPrefersAgentMessageSummary(t *testing.T) {
	t.Parallel()

	result := FromTurn("thread-1", "turn-1", store.ThreadTurn{
		ID:     "turn-1",
		Status: "completed",
		Items: []map[string]any{
			{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"aggregatedOutput": "git status clean",
			},
			{
				"id":   "agent-1",
				"type": "agentMessage",
				"text": "Daily summary complete",
			},
		},
	})

	if !result.Succeeded() {
		t.Fatalf("expected successful result, got %#v", result)
	}
	if result.Summary != "Daily summary complete" {
		t.Fatalf("expected assistant summary, got %q", result.Summary)
	}
	if result.CommandOutput != "git status clean" {
		t.Fatalf("expected command output to still be captured, got %q", result.CommandOutput)
	}
}

func TestFromTurnFallsBackToCommandOutputAndCapturesReasoningAndSubagentIDs(t *testing.T) {
	t.Parallel()

	result := FromTurn("thread-1", "turn-1", store.ThreadTurn{
		ID:     "turn-1",
		Status: "completed",
		Items: []map[string]any{
			{
				"id":      "reason-1",
				"type":    "reasoning",
				"summary": []string{"Scanned repository"},
				"content": []string{"Found one migration to verify"},
			},
			{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"aggregatedOutput": "npm test ok",
			},
			{
				"id":               "subagent-1",
				"type":             "subagent",
				"subagentThreadId": "thread-child-1",
				"subagentTurnId":   "turn-child-1",
			},
		},
	})

	if result.Summary != "npm test ok" {
		t.Fatalf("expected command output fallback, got %q", result.Summary)
	}
	if result.ReasoningText != "Scanned repository\n\nFound one migration to verify" {
		t.Fatalf("unexpected reasoning text %q", result.ReasoningText)
	}
	if len(result.SubagentThreadIDs) != 1 || result.SubagentThreadIDs[0] != "thread-child-1" {
		t.Fatalf("expected subagent thread id, got %#v", result.SubagentThreadIDs)
	}
	if len(result.SubagentTurnIDs) != 1 || result.SubagentTurnIDs[0] != "turn-child-1" {
		t.Fatalf("expected subagent turn id, got %#v", result.SubagentTurnIDs)
	}
}

func TestFromTurnSettlesFromTerminalSnapshotWithoutCompletionEvent(t *testing.T) {
	t.Parallel()

	result := FromTurn("thread-1", "turn-1", store.ThreadTurn{
		ID:     "turn-1",
		Status: "completed",
		Items: []map[string]any{
			{
				"id":   "agent-1",
				"type": "agentMessage",
				"text": "Snapshot-only completion",
			},
		},
	})

	if !result.Terminal {
		t.Fatalf("expected terminal result, got %#v", result)
	}
	if result.Summary != "Snapshot-only completion" {
		t.Fatalf("expected snapshot summary, got %q", result.Summary)
	}
}

func TestFailureMessagePrefersTurnError(t *testing.T) {
	t.Parallel()

	result := FromTurn("thread-1", "turn-1", store.ThreadTurn{
		ID:     "turn-1",
		Status: "failed",
		Error: map[string]any{
			"message": "sandbox denied write access",
		},
	})

	if result.FailureMessage() != "sandbox denied write access" {
		t.Fatalf("expected error-derived failure message, got %q", result.FailureMessage())
	}
}

func TestCaptureApplyEventAggregatesStreamingUpdates(t *testing.T) {
	t.Parallel()

	capture := New("thread-1", "turn-1")
	capture.ApplyEvent(store.EventEnvelope{
		ThreadID: "thread-1",
		TurnID:   "turn-1",
		Method:   "item/agentMessage/delta",
		Payload: map[string]any{
			"itemId": "agent-1",
			"delta":  "hello",
		},
	})
	capture.ApplyEvent(store.EventEnvelope{
		ThreadID: "thread-1",
		TurnID:   "turn-1",
		Method:   "item/commandExecution/outputDelta",
		Payload: map[string]any{
			"itemId": "cmd-1",
			"delta":  "stdout",
		},
	})
	capture.ApplyEvent(store.EventEnvelope{
		ThreadID: "thread-1",
		TurnID:   "turn-1",
		Method:   "turn/completed",
		Payload: map[string]any{
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
			},
		},
	})

	result := capture.Result()
	if result.Summary != "hello" {
		t.Fatalf("expected streaming assistant text summary, got %q", result.Summary)
	}
	if result.CommandOutput != "stdout" {
		t.Fatalf("expected streaming command output, got %q", result.CommandOutput)
	}
	if !result.Terminal {
		t.Fatalf("expected terminal result after turn/completed, got %#v", result)
	}
}
