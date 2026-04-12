package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPersistentStorePersistsTurnPolicyDecisions(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "store.json")
	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore(first) error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	startedAt := time.Date(2026, time.April, 8, 12, 0, 0, 0, time.UTC)
	created, err := firstStore.CreateTurnPolicyDecision(TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		ItemID:              "cmd-1",
		TriggerMethod:       "item/completed",
		PolicyName:          "posttooluse/failed-validation-command",
		Fingerprint:         "fp-1",
		Verdict:             "steer",
		Action:              "steer",
		ActionStatus:        "succeeded",
		ActionTurnID:        "turn-1",
		Reason:              "validation_command_failed",
		EvidenceSummary:     "command=go test ./...; exitCode=1",
		EvaluationStartedAt: startedAt,
		DecisionAt:          startedAt.Add(500 * time.Millisecond),
		CompletedAt:         startedAt.Add(800 * time.Millisecond),
	})
	if err != nil {
		t.Fatalf("CreateTurnPolicyDecision() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore(second) error = %v", err)
	}

	decisions := secondStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 persisted decision, got %#v", decisions)
	}
	if decisions[0].ID != created.ID {
		t.Fatalf("expected persisted decision id %q, got %#v", created.ID, decisions[0])
	}

	loaded, ok := secondStore.GetTurnPolicyDecisionByFingerprint(workspace.ID, "thread-1", "fp-1")
	if !ok {
		t.Fatal("expected fingerprint lookup to return persisted decision")
	}
	if loaded.ActionStatus != "succeeded" {
		t.Fatalf("expected persisted action status succeeded, got %#v", loaded)
	}
}
