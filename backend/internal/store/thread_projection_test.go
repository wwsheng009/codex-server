package store

import "testing"

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
