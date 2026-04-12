package turnpolicies

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestMetricsAggregatesWorkspaceSummary(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
		{
			ID:     "turn-3",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-2", "backend/internal/turnpolicies/rules.go"),
				commandExecutionItem("cmd-2", "go test ./internal/turnpolicies", "completed", 0),
			},
		},
	})
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-2", []store.ThreadTurn{
		{
			ID:     "turn-4",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-3", "backend/internal/api/router.go"),
				{"id": "msg-2", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 16, 0, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-1",
		Verdict:             actionSteer,
		Action:              actionSteer,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(100 * time.Millisecond),
		CompletedAt:         base.Add(200 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-1",
		Verdict:             actionSteer,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "duplicate_fingerprint",
		EvidenceSummary:     "duplicate",
		Source:              "interactive",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 250*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 350*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-2",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "automation",
		EvaluationStartedAt: base.Add(2 * time.Minute),
		DecisionAt:          base.Add(2*time.Minute + 300*time.Millisecond),
		CompletedAt:         base.Add(2*time.Minute + 400*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-3",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "follow_up_cooldown_active",
		Source:              "bot",
		EvaluationStartedAt: base.Add(3 * time.Minute),
		DecisionAt:          base.Add(3*time.Minute + 500*time.Millisecond),
		CompletedAt:         base.Add(3*time.Minute + 600*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-2",
		TurnID:              "turn-4",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-4",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "",
		EvaluationStartedAt: base.Add(4 * time.Minute),
		DecisionAt:          base.Add(4*time.Minute + 900*time.Millisecond),
		CompletedAt:         base.Add(4*time.Minute + 1000*time.Millisecond),
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(5 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	if !summary.Config.PostToolUseFailedValidationPolicyEnabled ||
		!summary.Config.StopMissingSuccessfulVerificationPolicyEnabled ||
		summary.Config.FollowUpCooldownMs != DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected default metrics config %#v", summary.Config)
	}
	if summary.Config.PostToolUseFollowUpCooldownMs != DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected default post-tool-use follow-up cooldown %#v", summary.Config)
	}
	if summary.Config.StopMissingSuccessfulVerificationFollowUpCooldownMs != DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected default stop-missing-verify follow-up cooldown %#v", summary.Config)
	}
	if summary.Config.PostToolUsePrimaryAction != DefaultPostToolUsePrimaryAction {
		t.Fatalf("unexpected default post-tool-use primary action %#v", summary.Config)
	}
	if summary.Config.StopMissingSuccessfulVerificationPrimaryAction != DefaultStopMissingSuccessfulVerificationPrimaryAction {
		t.Fatalf("unexpected default stop-missing-verify primary action %#v", summary.Config)
	}
	if summary.Config.PostToolUseInterruptNoActiveTurnBehavior != DefaultPostToolUseInterruptNoActiveTurnBehavior {
		t.Fatalf("unexpected default post-tool-use interrupt fallback %#v", summary.Config)
	}
	if summary.Config.StopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != DefaultStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior {
		t.Fatalf("unexpected default stop-missing-verify interrupt fallback %#v", summary.Config)
	}
	if len(summary.AlertPolicy.SuppressedCodes) != 0 ||
		summary.AlertPolicy.SuppressedCount != 0 ||
		len(summary.AlertPolicy.AcknowledgedCodes) != 0 ||
		summary.AlertPolicy.AcknowledgedCount != 0 ||
		len(summary.AlertPolicy.SnoozedCodes) != 0 ||
		summary.AlertPolicy.SnoozedCount != 0 ||
		summary.AlertPolicy.SnoozeUntil != nil {
		t.Fatalf("unexpected default alert policy %#v", summary.AlertPolicy)
	}

	if summary.Decisions.Total != 5 {
		t.Fatalf("expected 5 decisions, got %#v", summary.Decisions)
	}
	if summary.Decisions.ActionStatusCounts.Succeeded != 3 ||
		summary.Decisions.ActionStatusCounts.Skipped != 2 ||
		summary.Decisions.ActionStatusCounts.Failed != 0 {
		t.Fatalf("unexpected action status counts %#v", summary.Decisions.ActionStatusCounts)
	}
	if summary.Decisions.ActionCounts.Steer != 1 ||
		summary.Decisions.ActionCounts.FollowUp != 2 ||
		summary.Decisions.ActionCounts.None != 2 {
		t.Fatalf("unexpected action counts %#v", summary.Decisions.ActionCounts)
	}
	if summary.Decisions.ActionAttempts != 3 ||
		summary.Decisions.ActionSucceeded != 3 ||
		summary.Decisions.ActionSuccessRate != 1 {
		t.Fatalf("unexpected action attempt metrics %#v", summary.Decisions)
	}
	if summary.Decisions.PolicyCounts.FailedValidationCommand != 2 ||
		summary.Decisions.PolicyCounts.MissingSuccessfulVerification != 3 {
		t.Fatalf("unexpected policy counts %#v", summary.Decisions.PolicyCounts)
	}
	if summary.Decisions.SkipReasonCounts.Total != 2 ||
		summary.Decisions.SkipReasonCounts.DuplicateFingerprint != 1 ||
		summary.Decisions.SkipReasonCounts.FollowUpCooldownActive != 1 {
		t.Fatalf("unexpected skip reason counts %#v", summary.Decisions.SkipReasonCounts)
	}
	if summary.Sources.Interactive.Total != 2 ||
		summary.Sources.Interactive.ActionAttempts != 1 ||
		summary.Sources.Interactive.ActionSucceeded != 1 ||
		summary.Sources.Interactive.ActionSuccessRate != 1 ||
		summary.Sources.Interactive.Skipped != 1 {
		t.Fatalf("unexpected interactive source metrics %#v", summary.Sources.Interactive)
	}
	if summary.Sources.Automation.Total != 1 ||
		summary.Sources.Automation.ActionAttempts != 1 ||
		summary.Sources.Automation.ActionSucceeded != 1 ||
		summary.Sources.Automation.ActionSuccessRate != 1 ||
		summary.Sources.Automation.Skipped != 0 {
		t.Fatalf("unexpected automation source metrics %#v", summary.Sources.Automation)
	}
	if summary.Sources.Bot.Total != 1 ||
		summary.Sources.Bot.ActionAttempts != 0 ||
		summary.Sources.Bot.ActionSucceeded != 0 ||
		summary.Sources.Bot.ActionSuccessRate != 0 ||
		summary.Sources.Bot.Skipped != 1 {
		t.Fatalf("unexpected bot source metrics %#v", summary.Sources.Bot)
	}
	if summary.Sources.Other.Total != 1 ||
		summary.Sources.Other.ActionAttempts != 1 ||
		summary.Sources.Other.ActionSucceeded != 1 ||
		summary.Sources.Other.ActionSuccessRate != 1 ||
		summary.Sources.Other.Skipped != 0 {
		t.Fatalf("unexpected other source metrics %#v", summary.Sources.Other)
	}
	if summary.Timings.PostToolUseDecisionLatency.P50Ms != 100 ||
		summary.Timings.PostToolUseDecisionLatency.P95Ms != 250 ||
		summary.Timings.StopDecisionLatency.P50Ms != 500 ||
		summary.Timings.StopDecisionLatency.P95Ms != 900 {
		t.Fatalf("unexpected decision timings %#v", summary.Timings)
	}

	if summary.Turns.CompletedWithFileChange != 3 {
		t.Fatalf("expected 3 completed turns with file changes, got %#v", summary.Turns)
	}
	if summary.Turns.MissingSuccessfulVerification != 2 || summary.Turns.MissingSuccessfulVerificationRate != 0.6667 {
		t.Fatalf("unexpected missing verification metrics %#v", summary.Turns)
	}
	if summary.Turns.FailedValidationCommand != 1 ||
		summary.Turns.FailedValidationWithPolicyAction != 1 ||
		summary.Turns.FailedValidationWithPolicyActionRate != 1 {
		t.Fatalf("unexpected failed validation remediation metrics %#v", summary.Turns)
	}

	if summary.Audit.EligibleTurns != 3 || summary.Audit.CoveredTurns != 3 || summary.Audit.CoverageRate != 1 {
		t.Fatalf("unexpected audit metrics %#v", summary.Audit)
	}
	if codes := metricsAlertCodes(summary.Alerts); len(codes) != 2 ||
		codes[0] != "cooldown_skips_detected" ||
		codes[1] != "duplicate_skips_detected" {
		t.Fatalf("unexpected workspace alerts %#v", summary.Alerts)
	}
	if summary.GeneratedAt != base.Add(5*time.Minute) {
		t.Fatalf("unexpected generatedAt %s", summary.GeneratedAt)
	}
	if summary.RecentWindows.LastHour.Decisions.Total != 5 ||
		summary.RecentWindows.LastHour.Decisions.ActionAttempts != 3 ||
		summary.RecentWindows.LastHour.Decisions.ActionSucceeded != 3 ||
		summary.RecentWindows.LastHour.Decisions.ActionSuccessRate != 1 ||
		summary.RecentWindows.LastHour.Decisions.Skipped != 2 ||
		summary.RecentWindows.LastHour.AlertsCount != 2 {
		t.Fatalf("unexpected last-hour metrics %#v", summary.RecentWindows.LastHour)
	}
	if summary.RecentWindows.LastHour.Timings.PostToolUseDecisionLatency.P95Ms != 250 ||
		summary.RecentWindows.LastHour.Timings.StopDecisionLatency.P95Ms != 900 {
		t.Fatalf("unexpected last-hour timings %#v", summary.RecentWindows.LastHour.Timings)
	}
	if summary.RecentWindows.Last24Hours.Decisions.Total != 5 ||
		summary.RecentWindows.Last24Hours.AlertsCount != 2 {
		t.Fatalf("unexpected last-24h metrics %#v", summary.RecentWindows.Last24Hours)
	}
}

func TestMetricsUsesConfiguredValidationCommandPrefixes(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyValidationCommandPrefixes: []string{"npm run check"},
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "npm run check -- --strict", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "frontend/src/App.tsx"),
				commandExecutionItem("cmd-2", "npm run check -- --strict", "completed", 0),
			},
		},
		{
			ID:     "turn-3",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-2", "frontend/src/main.tsx"),
				commandExecutionItem("cmd-3", "npm run lint", "completed", 0),
			},
		},
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time {
		return time.Date(2026, time.April, 9, 8, 0, 0, 0, time.UTC)
	}

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	wantPrefixes := []string{"npm run check"}
	if !reflect.DeepEqual(summary.Config.ValidationCommandPrefixes, wantPrefixes) {
		t.Fatalf("expected validation command prefixes %#v, got %#v", wantPrefixes, summary.Config.ValidationCommandPrefixes)
	}
	if summary.Turns.FailedValidationCommand != 1 {
		t.Fatalf("expected 1 failed validation command turn, got %#v", summary.Turns)
	}
	if summary.Turns.CompletedWithFileChange != 2 {
		t.Fatalf("expected 2 completed turns with file changes, got %#v", summary.Turns)
	}
	if summary.Turns.MissingSuccessfulVerification != 1 {
		t.Fatalf("expected 1 missing successful verification turn, got %#v", summary.Turns)
	}
}

func TestMetricsTracksInterruptActionCounts(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	base := time.Date(2026, time.April, 9, 18, 0, 0, 0, time.UTC)

	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-interrupt",
		Verdict:             actionInterrupt,
		Action:              actionInterrupt,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(125 * time.Millisecond),
		CompletedAt:         base.Add(150 * time.Millisecond),
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(5 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	if summary.Decisions.ActionCounts.Interrupt != 1 {
		t.Fatalf("expected interrupt action count to be tracked separately, got %#v", summary.Decisions.ActionCounts)
	}
	if summary.Decisions.ActionCounts.Other != 0 {
		t.Fatalf("expected interrupt action to avoid other bucket, got %#v", summary.Decisions.ActionCounts)
	}
	if summary.Decisions.ActionAttempts != 1 || summary.Decisions.ActionSucceeded != 1 || summary.Decisions.ActionSuccessRate != 1 {
		t.Fatalf("unexpected interrupt action metrics %#v", summary.Decisions)
	}
}

func TestMetricsTracksInterruptNoActiveTurnSkipReason(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	base := time.Date(2026, time.April, 9, 18, 10, 0, 0, time.UTC)

	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-interrupt-skipped",
		Verdict:             actionInterrupt,
		Action:              actionInterrupt,
		ActionStatus:        actionStatusSkipped,
		Reason:              reasonInterruptNoActiveTurn,
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(125 * time.Millisecond),
		CompletedAt:         base.Add(150 * time.Millisecond),
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(5 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	if summary.Decisions.ActionCounts.Interrupt != 1 {
		t.Fatalf("expected interrupt action count to include skipped interrupt decisions, got %#v", summary.Decisions.ActionCounts)
	}
	if summary.Decisions.ActionAttempts != 0 || summary.Decisions.ActionSucceeded != 0 || summary.Decisions.ActionSuccessRate != 0 {
		t.Fatalf("expected skipped interrupt decision to avoid attempt counters, got %#v", summary.Decisions)
	}
	if summary.Decisions.SkipReasonCounts.Total != 1 ||
		summary.Decisions.SkipReasonCounts.InterruptNoActiveTurn != 1 ||
		summary.Decisions.SkipReasonCounts.Other != 0 {
		t.Fatalf("unexpected interrupt skip reason counts %#v", summary.Decisions.SkipReasonCounts)
	}
}

func TestMetricsSupportsThreadFilter(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-2", []store.ThreadTurn{
		{
			ID:     "turn-3",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-2", "backend/internal/api/router.go"),
				{"id": "msg-2", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 17, 0, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-thread-1",
		Verdict:             actionSteer,
		Action:              actionSteer,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(140 * time.Millisecond),
		CompletedAt:         base.Add(240 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-2",
		TurnID:              "turn-3",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-thread-2",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "automation",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 720*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 820*time.Millisecond),
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(2 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "thread-1", "")
	if err != nil {
		t.Fatalf("Metrics(thread-1) error = %v", err)
	}

	if summary.ThreadID != "thread-1" {
		t.Fatalf("expected thread filter to be echoed, got %#v", summary)
	}
	if summary.Decisions.Total != 1 ||
		summary.Decisions.ActionCounts.Steer != 1 ||
		summary.Decisions.ActionAttempts != 1 ||
		summary.Decisions.ActionSucceeded != 1 ||
		summary.Decisions.ActionSuccessRate != 1 {
		t.Fatalf("unexpected filtered decision metrics %#v", summary.Decisions)
	}
	if summary.Sources.Interactive.Total != 1 ||
		summary.Sources.Interactive.ActionAttempts != 1 ||
		summary.Sources.Interactive.ActionSucceeded != 1 ||
		summary.Sources.Interactive.ActionSuccessRate != 1 ||
		summary.Sources.Interactive.Skipped != 0 {
		t.Fatalf("unexpected filtered interactive source metrics %#v", summary.Sources.Interactive)
	}
	if summary.Sources.Automation.Total != 0 ||
		summary.Sources.Bot.Total != 0 ||
		summary.Sources.Other.Total != 0 {
		t.Fatalf("expected other filtered source buckets to be empty, got %#v", summary.Sources)
	}
	if summary.Timings.PostToolUseDecisionLatency.P50Ms != 140 ||
		summary.Timings.PostToolUseDecisionLatency.P95Ms != 140 ||
		summary.Timings.StopDecisionLatency.P50Ms != 0 ||
		summary.Timings.StopDecisionLatency.P95Ms != 0 {
		t.Fatalf("unexpected filtered decision timings %#v", summary.Timings)
	}
	if summary.Turns.CompletedWithFileChange != 1 ||
		summary.Turns.MissingSuccessfulVerification != 1 ||
		summary.Turns.FailedValidationCommand != 1 ||
		summary.Turns.FailedValidationWithPolicyAction != 1 {
		t.Fatalf("unexpected filtered turn metrics %#v", summary.Turns)
	}
	if summary.Audit.EligibleTurns != 2 || summary.Audit.CoveredTurns != 1 || summary.Audit.CoverageRate != 0.5 {
		t.Fatalf("unexpected filtered audit metrics %#v", summary.Audit)
	}
	if codes := metricsAlertCodes(summary.Alerts); len(codes) != 1 || codes[0] != "audit_coverage_incomplete" {
		t.Fatalf("unexpected thread-filtered alerts %#v", summary.Alerts)
	}
}

func TestMetricsSupportsSourceFilter(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 18, 0, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-interactive",
		Verdict:             actionSteer,
		Action:              actionSteer,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(140 * time.Millisecond),
		CompletedAt:         base.Add(240 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-automation",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "automation",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 720*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 820*time.Millisecond),
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(2 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "thread-1", " automation ")
	if err != nil {
		t.Fatalf("Metrics(thread-1, automation) error = %v", err)
	}

	if summary.ThreadID != "thread-1" || summary.Source != "automation" {
		t.Fatalf("expected source-filtered scope to be echoed, got %#v", summary)
	}
	if summary.Decisions.Total != 1 ||
		summary.Decisions.ActionAttempts != 1 ||
		summary.Decisions.ActionSucceeded != 1 ||
		summary.Decisions.ActionSuccessRate != 1 ||
		summary.Decisions.ActionCounts.FollowUp != 1 ||
		summary.Decisions.ActionCounts.Steer != 0 {
		t.Fatalf("unexpected source-filtered decision metrics %#v", summary.Decisions)
	}
	if summary.Sources.Automation.Total != 1 ||
		summary.Sources.Automation.ActionAttempts != 1 ||
		summary.Sources.Automation.ActionSucceeded != 1 ||
		summary.Sources.Automation.ActionSuccessRate != 1 ||
		summary.Sources.Automation.Skipped != 0 {
		t.Fatalf("unexpected source-filtered automation metrics %#v", summary.Sources.Automation)
	}
	if summary.Sources.Interactive.Total != 0 ||
		summary.Sources.Bot.Total != 0 ||
		summary.Sources.Other.Total != 0 {
		t.Fatalf("expected non-selected source buckets to be empty, got %#v", summary.Sources)
	}
	if summary.Timings.PostToolUseDecisionLatency.P50Ms != 0 ||
		summary.Timings.PostToolUseDecisionLatency.P95Ms != 0 ||
		summary.Timings.StopDecisionLatency.P50Ms != 720 ||
		summary.Timings.StopDecisionLatency.P95Ms != 720 {
		t.Fatalf("unexpected source-filtered timing summary %#v", summary.Timings)
	}
	if summary.Turns.CompletedWithFileChange != 1 ||
		summary.Turns.MissingSuccessfulVerification != 1 ||
		summary.Turns.MissingSuccessfulVerificationRate != 1 ||
		summary.Turns.FailedValidationCommand != 1 ||
		summary.Turns.FailedValidationWithPolicyAction != 0 ||
		summary.Turns.FailedValidationWithPolicyActionRate != 0 {
		t.Fatalf("unexpected source-filtered turn summary %#v", summary.Turns)
	}
	if summary.Audit.CoveredTurns != 1 ||
		summary.Audit.EligibleTurns != 2 ||
		summary.Audit.CoverageRate != 0.5 {
		t.Fatalf("unexpected source-filtered audit summary %#v", summary.Audit)
	}
	if codes := metricsAlertCodes(summary.Alerts); len(codes) != 1 || codes[0] != "audit_coverage_incomplete" {
		t.Fatalf("unexpected source-filtered alerts %#v", summary.Alerts)
	}
	if summary.RecentWindows.LastHour.Decisions.Total != 1 ||
		summary.RecentWindows.LastHour.Decisions.ActionAttempts != 1 ||
		summary.RecentWindows.LastHour.Decisions.ActionSucceeded != 1 ||
		summary.RecentWindows.LastHour.AlertsCount != 0 {
		t.Fatalf("unexpected source-filtered recent window %#v", summary.RecentWindows.LastHour)
	}
}

func TestMetricsRecentWindowsFilterByDecisionTime(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	service := NewService(dataStore, nil, nil)
	now := time.Date(2026, time.April, 9, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-last-hour",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-last-hour",
		Verdict:             actionSteer,
		Action:              actionSteer,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: now.Add(-30*time.Minute - 400*time.Millisecond),
		DecisionAt:          now.Add(-30 * time.Minute),
		CompletedAt:         now.Add(-30*time.Minute + 100*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-last-day",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-last-day",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "duplicate_fingerprint",
		Source:              "automation",
		EvaluationStartedAt: now.Add(-2*time.Hour - 500*time.Millisecond),
		DecisionAt:          now.Add(-2 * time.Hour),
		CompletedAt:         now.Add(-2*time.Hour + 100*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-older-day",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-older-day",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "bot",
		EvaluationStartedAt: now.Add(-25*time.Hour - 800*time.Millisecond),
		DecisionAt:          now.Add(-25 * time.Hour),
		CompletedAt:         now.Add(-25*time.Hour + 100*time.Millisecond),
	})

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	if summary.RecentWindows.LastHour.Decisions.Total != 1 ||
		summary.RecentWindows.LastHour.Decisions.ActionAttempts != 1 ||
		summary.RecentWindows.LastHour.Decisions.ActionSucceeded != 1 ||
		summary.RecentWindows.LastHour.Decisions.ActionSuccessRate != 1 ||
		summary.RecentWindows.LastHour.Decisions.Skipped != 0 ||
		summary.RecentWindows.LastHour.AlertsCount != 0 {
		t.Fatalf("unexpected last-hour recent window %#v", summary.RecentWindows.LastHour)
	}
	if summary.RecentWindows.Last24Hours.Decisions.Total != 2 ||
		summary.RecentWindows.Last24Hours.Decisions.ActionAttempts != 1 ||
		summary.RecentWindows.Last24Hours.Decisions.ActionSucceeded != 1 ||
		summary.RecentWindows.Last24Hours.Decisions.ActionSuccessRate != 1 ||
		summary.RecentWindows.Last24Hours.Decisions.Skipped != 1 ||
		summary.RecentWindows.Last24Hours.AlertsCount != 1 {
		t.Fatalf("unexpected last-24-hours recent window %#v", summary.RecentWindows.Last24Hours)
	}
	if summary.RecentWindows.Last24Hours.Timings.PostToolUseDecisionLatency.P95Ms != 400 ||
		summary.RecentWindows.Last24Hours.Timings.StopDecisionLatency.P95Ms != 500 {
		t.Fatalf("unexpected last-24-hours timings %#v", summary.RecentWindows.Last24Hours.Timings)
	}
}

func TestMetricsGeneratesAlertsAcrossScopes(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-2", []store.ThreadTurn{
		{
			ID:     "turn-3",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-2", "backend/internal/api/router.go"),
				{"id": "msg-2", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 19, 0, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-automation-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(1500 * time.Millisecond),
		CompletedAt:         base.Add(1600 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-duplicate",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "duplicate_fingerprint",
		Source:              "automation",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 200*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 300*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-bot-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "bot",
		EvaluationStartedAt: base.Add(2 * time.Minute),
		DecisionAt:          base.Add(2*time.Minute + 1200*time.Millisecond),
		CompletedAt:         base.Add(2*time.Minute + 1300*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-cooldown",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "follow_up_cooldown_active",
		Source:              "bot",
		EvaluationStartedAt: base.Add(3 * time.Minute),
		DecisionAt:          base.Add(3*time.Minute + 200*time.Millisecond),
		CompletedAt:         base.Add(3*time.Minute + 300*time.Millisecond),
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(4 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	expectedCodes := []string{
		"audit_coverage_incomplete",
		"automation_action_success_below_target",
		"bot_action_success_below_target",
		"failed_actions_detected",
		"post_tool_use_latency_high",
		"stop_latency_high",
		"cooldown_skips_detected",
		"duplicate_skips_detected",
	}
	if codes := metricsAlertCodes(summary.Alerts); len(codes) != len(expectedCodes) {
		t.Fatalf("expected %d alert codes, got %#v", len(expectedCodes), summary.Alerts)
	} else {
		for _, code := range expectedCodes {
			if !metricsAlertCodeSet(summary.Alerts)[code] {
				t.Fatalf("expected alert code %q in %#v", code, summary.Alerts)
			}
		}
	}

	automationAlert := findMetricsAlert(summary.Alerts, "automation_action_success_below_target")
	if automationAlert.Source != "automation" || automationAlert.ActionStatus != actionStatusFailed {
		t.Fatalf("unexpected automation alert %#v", automationAlert)
	}
	duplicateAlert := findMetricsAlert(summary.Alerts, "duplicate_skips_detected")
	if duplicateAlert.Reason != "duplicate_fingerprint" || duplicateAlert.ActionStatus != actionStatusSkipped {
		t.Fatalf("unexpected duplicate alert %#v", duplicateAlert)
	}
	if duplicateAlert.Rank <= automationAlert.Rank {
		t.Fatalf("expected info alert rank to follow warning alert rank, got automation=%#v duplicate=%#v", automationAlert, duplicateAlert)
	}
	for index, alert := range summary.Alerts {
		if alert.Rank != index+1 {
			t.Fatalf("expected sequential alert ranks, got %#v", summary.Alerts)
		}
	}

	sourceSummary, err := service.Metrics(workspace.ID, "", "automation")
	if err != nil {
		t.Fatalf("Metrics(source=automation) error = %v", err)
	}
	sourceCodes := metricsAlertCodeSet(sourceSummary.Alerts)
	for _, code := range []string{
		"audit_coverage_incomplete",
		"automation_action_success_below_target",
		"failed_actions_detected",
		"post_tool_use_latency_high",
		"duplicate_skips_detected",
	} {
		if !sourceCodes[code] {
			t.Fatalf("expected automation-scoped alert %q in %#v", code, sourceSummary.Alerts)
		}
	}
	for _, code := range []string{
		"bot_action_success_below_target",
		"stop_latency_high",
		"cooldown_skips_detected",
	} {
		if sourceCodes[code] {
			t.Fatalf("did not expect automation-scoped alert %q in %#v", code, sourceSummary.Alerts)
		}
	}
}

func TestMetricsAlertsUseRuntimePreferenceThresholds(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 20, 0, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-automation-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(1500 * time.Millisecond),
		CompletedAt:         base.Add(1600 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-duplicate",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "duplicate_fingerprint",
		Source:              "automation",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 200*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 300*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-bot-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "bot",
		EvaluationStartedAt: base.Add(2 * time.Minute),
		DecisionAt:          base.Add(2*time.Minute + 1200*time.Millisecond),
		CompletedAt:         base.Add(2*time.Minute + 1300*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-cooldown",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "follow_up_cooldown_active",
		Source:              "bot",
		EvaluationStartedAt: base.Add(3 * time.Minute),
		DecisionAt:          base.Add(3*time.Minute + 200*time.Millisecond),
		CompletedAt:         base.Add(3*time.Minute + 300*time.Millisecond),
	})

	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyAlertCoverageThresholdPercent:            intPtr(50),
		TurnPolicyAlertPostToolUseLatencyP95ThresholdMs:    int64Ptr(1600),
		TurnPolicyAlertStopLatencyP95ThresholdMs:           int64Ptr(1300),
		TurnPolicyAlertSourceActionSuccessThresholdPercent: intPtr(0),
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(4 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	alertCodes := metricsAlertCodeSet(summary.Alerts)
	for _, suppressedCode := range []string{
		"audit_coverage_incomplete",
		"automation_action_success_below_target",
		"bot_action_success_below_target",
		"post_tool_use_latency_high",
		"stop_latency_high",
	} {
		if alertCodes[suppressedCode] {
			t.Fatalf("did not expect alert code %q in %#v", suppressedCode, summary.Alerts)
		}
	}
	for _, expectedCode := range []string{
		"failed_actions_detected",
		"cooldown_skips_detected",
		"duplicate_skips_detected",
	} {
		if !alertCodes[expectedCode] {
			t.Fatalf("expected alert code %q in %#v", expectedCode, summary.Alerts)
		}
	}
}

func TestMetricsAppliesAlertSuppressionAndRenumbersRanks(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 20, 30, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-automation-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(1500 * time.Millisecond),
		CompletedAt:         base.Add(1600 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-duplicate",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "duplicate_fingerprint",
		Source:              "automation",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 200*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 300*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-bot-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "bot",
		EvaluationStartedAt: base.Add(2 * time.Minute),
		DecisionAt:          base.Add(2*time.Minute + 1200*time.Millisecond),
		CompletedAt:         base.Add(2*time.Minute + 1300*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-cooldown",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "follow_up_cooldown_active",
		Source:              "bot",
		EvaluationStartedAt: base.Add(3 * time.Minute),
		DecisionAt:          base.Add(3*time.Minute + 200*time.Millisecond),
		CompletedAt:         base.Add(3*time.Minute + 300*time.Millisecond),
	})

	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyAlertSuppressedCodes: []string{
			" duplicate_skips_detected ",
			"failed_actions_detected",
			"duplicate_skips_detected",
		},
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(4 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	if len(summary.AlertPolicy.SuppressedCodes) != 2 ||
		summary.AlertPolicy.SuppressedCodes[0] != "duplicate_skips_detected" ||
		summary.AlertPolicy.SuppressedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected alert policy suppressed codes %#v", summary.AlertPolicy)
	}
	if summary.AlertPolicy.SuppressedCount != 2 {
		t.Fatalf("expected 2 suppressed alerts, got %#v", summary.AlertPolicy)
	}
	if len(summary.AlertPolicy.SnoozedCodes) != 0 ||
		summary.AlertPolicy.SnoozedCount != 0 ||
		len(summary.AlertPolicy.AcknowledgedCodes) != 0 ||
		summary.AlertPolicy.AcknowledgedCount != 0 ||
		summary.AlertPolicy.SnoozeUntil != nil {
		t.Fatalf("expected no snoozed alert policy values, got %#v", summary.AlertPolicy)
	}

	if metricsAlertCodeSet(summary.Alerts)["duplicate_skips_detected"] ||
		metricsAlertCodeSet(summary.Alerts)["failed_actions_detected"] {
		t.Fatalf("expected suppressed alert codes to be filtered, got %#v", summary.Alerts)
	}
	for index, alert := range summary.Alerts {
		if alert.Rank != index+1 {
			t.Fatalf("expected filtered alerts to be renumbered, got %#v", summary.Alerts)
		}
	}
	if summary.RecentWindows.LastHour.AlertsCount != len(summary.Alerts) {
		t.Fatalf("expected recent window alert count to honor suppression, got %#v with alerts %#v", summary.RecentWindows.LastHour, summary.Alerts)
	}
}

func TestMetricsAppliesAlertSnoozeWhileActiveAndExpiresAfterDeadline(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 21, 30, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-automation-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(1500 * time.Millisecond),
		CompletedAt:         base.Add(1600 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-duplicate",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "duplicate_fingerprint",
		Source:              "automation",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 200*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 300*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-cooldown",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "follow_up_cooldown_active",
		Source:              "bot",
		EvaluationStartedAt: base.Add(2 * time.Minute),
		DecisionAt:          base.Add(2*time.Minute + 200*time.Millisecond),
		CompletedAt:         base.Add(2*time.Minute + 300*time.Millisecond),
	})

	snoozeUntil := time.Date(2026, time.April, 9, 8, 40, 0, 0, time.FixedZone("CST", 8*60*60))
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyAlertSnoozedCodes: []string{
			" cooldown_skips_detected ",
			"failed_actions_detected",
			"cooldown_skips_detected",
		},
		TurnPolicyAlertSnoozeUntil: &snoozeUntil,
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(3 * time.Minute) }

	activeSummary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics(active snooze) error = %v", err)
	}

	expectedSnoozeUntil := snoozeUntil.UTC()
	if len(activeSummary.AlertPolicy.SnoozedCodes) != 2 ||
		activeSummary.AlertPolicy.SnoozedCodes[0] != "cooldown_skips_detected" ||
		activeSummary.AlertPolicy.SnoozedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected active snoozed codes %#v", activeSummary.AlertPolicy)
	}
	if activeSummary.AlertPolicy.SnoozedCount != 2 {
		t.Fatalf("expected 2 snoozed alerts, got %#v", activeSummary.AlertPolicy)
	}
	if activeSummary.AlertPolicy.SnoozeUntil == nil || !activeSummary.AlertPolicy.SnoozeUntil.Equal(expectedSnoozeUntil) {
		t.Fatalf("unexpected active snooze until %#v", activeSummary.AlertPolicy)
	}
	if len(activeSummary.AlertPolicy.AcknowledgedCodes) != 0 || activeSummary.AlertPolicy.AcknowledgedCount != 0 {
		t.Fatalf("expected no acknowledged alert policy values, got %#v", activeSummary.AlertPolicy)
	}
	if metricsAlertCodeSet(activeSummary.Alerts)["failed_actions_detected"] ||
		metricsAlertCodeSet(activeSummary.Alerts)["cooldown_skips_detected"] {
		t.Fatalf("expected snoozed alerts to be filtered, got %#v", activeSummary.Alerts)
	}
	if activeSummary.RecentWindows.LastHour.AlertsCount != len(activeSummary.Alerts) {
		t.Fatalf("expected recent window count to honor active snooze, got %#v with alerts %#v", activeSummary.RecentWindows.LastHour, activeSummary.Alerts)
	}
	alertPolicyJSON, err := json.Marshal(activeSummary.AlertPolicy)
	if err != nil {
		t.Fatalf("json.Marshal(alertPolicy) error = %v", err)
	}
	alertPolicyText := string(alertPolicyJSON)
	for _, fragment := range []string{
		"\"snoozedCodes\":[\"cooldown_skips_detected\",\"failed_actions_detected\"]",
		"\"snoozedCount\":2",
		"\"snoozeUntil\":\"2026-04-09T00:40:00Z\"",
	} {
		if !strings.Contains(alertPolicyText, fragment) {
			t.Fatalf("expected alertPolicy JSON to contain %q, got %s", fragment, alertPolicyText)
		}
	}

	service.now = func() time.Time { return expectedSnoozeUntil.Add(1 * time.Second) }
	expiredSummary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics(expired snooze) error = %v", err)
	}

	if len(expiredSummary.AlertPolicy.SnoozedCodes) != 0 ||
		expiredSummary.AlertPolicy.SnoozedCount != 0 ||
		len(expiredSummary.AlertPolicy.AcknowledgedCodes) != 0 ||
		expiredSummary.AlertPolicy.AcknowledgedCount != 0 ||
		expiredSummary.AlertPolicy.SnoozeUntil != nil {
		t.Fatalf("expected expired snooze to be ineffective, got %#v", expiredSummary.AlertPolicy)
	}
	if !metricsAlertCodeSet(expiredSummary.Alerts)["failed_actions_detected"] ||
		!metricsAlertCodeSet(expiredSummary.Alerts)["cooldown_skips_detected"] {
		t.Fatalf("expected expired snoozed alerts to return, got %#v", expiredSummary.Alerts)
	}
	if expiredSummary.RecentWindows.Last24Hours.AlertsCount != len(expiredSummary.Alerts) {
		t.Fatalf("expected recent window count to restore after snooze expiry, got %#v with alerts %#v", expiredSummary.RecentWindows.Last24Hours, expiredSummary.Alerts)
	}
}

func TestMetricsMarksAcknowledgedAlertsWithoutFilteringAndRenumbersRanks(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 22, 0, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-automation-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(200 * time.Millisecond),
		CompletedAt:         base.Add(300 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-duplicate",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "duplicate_fingerprint",
		Source:              "automation",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 100*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 200*time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-bot-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "bot",
		EvaluationStartedAt: base.Add(2 * time.Minute),
		DecisionAt:          base.Add(2*time.Minute + 150*time.Millisecond),
		CompletedAt:         base.Add(2*time.Minute + 250*time.Millisecond),
	})

	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyAlertAcknowledgedCodes: []string{
			" duplicate_skips_detected ",
			"automation_action_success_below_target",
			"duplicate_skips_detected",
		},
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(3 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	if len(summary.AlertPolicy.SuppressedCodes) != 0 || summary.AlertPolicy.SuppressedCount != 0 {
		t.Fatalf("expected no suppressed alert policy values, got %#v", summary.AlertPolicy)
	}
	if len(summary.AlertPolicy.SnoozedCodes) != 0 || summary.AlertPolicy.SnoozedCount != 0 || summary.AlertPolicy.SnoozeUntil != nil {
		t.Fatalf("expected no snoozed alert policy values, got %#v", summary.AlertPolicy)
	}
	if len(summary.AlertPolicy.AcknowledgedCodes) != 2 ||
		summary.AlertPolicy.AcknowledgedCodes[0] != "automation_action_success_below_target" ||
		summary.AlertPolicy.AcknowledgedCodes[1] != "duplicate_skips_detected" {
		t.Fatalf("unexpected acknowledged alert policy values %#v", summary.AlertPolicy)
	}
	if summary.AlertPolicy.AcknowledgedCount != 2 {
		t.Fatalf("expected 2 acknowledged alerts, got %#v", summary.AlertPolicy)
	}

	expectedCodes := []string{
		"bot_action_success_below_target",
		"failed_actions_detected",
		"automation_action_success_below_target",
		"duplicate_skips_detected",
	}
	if len(summary.Alerts) != len(expectedCodes) {
		t.Fatalf("expected %d alerts, got %#v", len(expectedCodes), summary.Alerts)
	}
	for index, code := range expectedCodes {
		if summary.Alerts[index].Code != code {
			t.Fatalf("expected alert %d to be %q, got %#v", index, code, summary.Alerts)
		}
		if summary.Alerts[index].Rank != index+1 {
			t.Fatalf("expected alert %q to have rank %d, got %#v", code, index+1, summary.Alerts[index])
		}
	}

	alertsByCode := make(map[string]MetricsAlert, len(summary.Alerts))
	for _, alert := range summary.Alerts {
		alertsByCode[alert.Code] = alert
	}
	if alertsByCode["automation_action_success_below_target"].Acknowledged != true {
		t.Fatalf("expected automation source alert to be acknowledged, got %#v", alertsByCode["automation_action_success_below_target"])
	}
	if alertsByCode["duplicate_skips_detected"].Acknowledged != true {
		t.Fatalf("expected duplicate alert to be acknowledged, got %#v", alertsByCode["duplicate_skips_detected"])
	}
	if alertsByCode["bot_action_success_below_target"].Acknowledged {
		t.Fatalf("expected bot source alert to remain unacknowledged, got %#v", alertsByCode["bot_action_success_below_target"])
	}
	if alertsByCode["failed_actions_detected"].Acknowledged {
		t.Fatalf("expected failed-actions alert to remain unacknowledged, got %#v", alertsByCode["failed_actions_detected"])
	}
	if summary.RecentWindows.LastHour.AlertsCount != len(summary.Alerts) {
		t.Fatalf("expected acknowledgement to leave recent window alert counts unchanged, got %#v with alerts %#v", summary.RecentWindows.LastHour, summary.Alerts)
	}

	alertPolicyJSON, err := json.Marshal(summary.AlertPolicy)
	if err != nil {
		t.Fatalf("json.Marshal(alertPolicy) error = %v", err)
	}
	alertPolicyText := string(alertPolicyJSON)
	for _, fragment := range []string{
		"\"acknowledgedCodes\":[\"automation_action_success_below_target\",\"duplicate_skips_detected\"]",
		"\"acknowledgedCount\":2",
	} {
		if !strings.Contains(alertPolicyText, fragment) {
			t.Fatalf("expected alertPolicy JSON to contain %q, got %s", fragment, alertPolicyText)
		}
	}
}

func TestMetricsBuildsDailyLast7DaysHistoryUsingNaturalDayBuckets(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	cst := time.FixedZone("CST", 8*60*60)
	generatedAt := time.Date(2026, time.April, 9, 10, 30, 0, 0, cst)

	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-mar10-outside-30d",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-mar10-outside-30d",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: time.Date(2026, time.March, 10, 9, 0, 0, 0, cst),
		DecisionAt:          time.Date(2026, time.March, 10, 9, 1, 0, 0, cst),
		CompletedAt:         time.Date(2026, time.March, 10, 9, 2, 0, 0, cst),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-apr5",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-apr5-bot-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "bot",
		EvaluationStartedAt: time.Date(2026, time.April, 5, 23, 58, 0, 0, cst),
		DecisionAt:          time.Date(2026, time.April, 5, 23, 59, 0, 0, cst),
		CompletedAt:         time.Date(2026, time.April, 5, 23, 59, 30, 0, cst),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-apr6",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-apr6-cooldown",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "follow_up_cooldown_active",
		Source:              "bot",
		EvaluationStartedAt: time.Date(2026, time.April, 6, 0, 0, 0, 0, cst),
		DecisionAt:          time.Date(2026, time.April, 6, 0, 0, 0, 0, cst).Add(100 * time.Millisecond),
		CompletedAt:         time.Date(2026, time.April, 6, 0, 0, 0, 0, cst).Add(200 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-apr7-a",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-apr7-automation-failed",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: time.Date(2026, time.April, 7, 9, 0, 0, 0, cst),
		DecisionAt:          time.Date(2026, time.April, 7, 9, 0, 0, 0, cst).Add(250 * time.Millisecond),
		CompletedAt:         time.Date(2026, time.April, 7, 9, 0, 0, 0, cst).Add(500 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-apr7-b",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-apr7-duplicate",
		Verdict:             actionFollowUp,
		Action:              actionNone,
		ActionStatus:        actionStatusSkipped,
		Reason:              "duplicate_fingerprint",
		Source:              "automation",
		EvaluationStartedAt: time.Date(2026, time.April, 7, 10, 0, 0, 0, cst),
		DecisionAt:          time.Date(2026, time.April, 7, 10, 0, 0, 0, cst).Add(100 * time.Millisecond),
		CompletedAt:         time.Date(2026, time.April, 7, 10, 0, 0, 0, cst).Add(200 * time.Millisecond),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-apr9-included",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-apr9-included",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: time.Date(2026, time.April, 9, 9, 0, 0, 0, cst),
		DecisionAt:          time.Date(2026, time.April, 9, 9, 0, 1, 0, cst),
		CompletedAt:         time.Date(2026, time.April, 9, 9, 0, 2, 0, cst),
	})
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-apr9-excluded",
		TriggerMethod:       "item/completed",
		PolicyName:          postToolUsePolicyName,
		Fingerprint:         "fp-apr9-excluded",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusFailed,
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: time.Date(2026, time.April, 9, 12, 0, 0, 0, cst),
		DecisionAt:          time.Date(2026, time.April, 9, 12, 0, 1, 0, cst),
		CompletedAt:         time.Date(2026, time.April, 9, 12, 0, 2, 0, cst),
	})

	snoozeUntil := time.Date(2026, time.April, 10, 0, 0, 0, 0, cst)
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyAlertSuppressedCodes: []string{
			"failed_actions_detected",
		},
		TurnPolicyAlertAcknowledgedCodes: []string{
			"automation_action_success_below_target",
		},
		TurnPolicyAlertSnoozedCodes: []string{
			"duplicate_skips_detected",
		},
		TurnPolicyAlertSnoozeUntil: &snoozeUntil,
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return generatedAt }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	history := summary.History.DailyLast7Days
	if len(history) != 7 {
		t.Fatalf("expected 7 daily history buckets, got %#v", history)
	}

	expectedFirstSince := time.Date(2026, time.April, 3, 0, 0, 0, 0, cst)
	if !history[0].Since.Equal(expectedFirstSince) {
		t.Fatalf("expected first history bucket to start at %v, got %#v", expectedFirstSince, history[0])
	}
	if !history[6].Until.Equal(generatedAt) {
		t.Fatalf("expected latest history bucket to end at generatedAt %v, got %#v", generatedAt, history[6])
	}
	for index := 1; index < len(history); index++ {
		if !history[index-1].Since.Before(history[index].Since) {
			t.Fatalf("expected history buckets in ascending order, got %#v", history)
		}
	}

	alertsByDay := make(map[string]int, len(history))
	for _, bucket := range history {
		alertsByDay[bucket.Since.In(cst).Format("2006-01-02")] = bucket.AlertsCount
	}
	expectedAlertsByDay := map[string]int{
		"2026-04-03": 0,
		"2026-04-04": 0,
		"2026-04-05": 2,
		"2026-04-06": 1,
		"2026-04-07": 1,
		"2026-04-08": 0,
		"2026-04-09": 1,
	}
	for day, expectedCount := range expectedAlertsByDay {
		if alertsByDay[day] != expectedCount {
			t.Fatalf("expected %s history bucket to have %d alerts after policies, got %#v", day, expectedCount, history)
		}
	}

	if history[2].Until.In(cst).Format(time.RFC3339) != "2026-04-06T00:00:00+08:00" {
		t.Fatalf("expected Apr 5 bucket to end at Apr 6 midnight in generatedAt location, got %#v", history[2])
	}
	if history[3].Since.In(cst).Format(time.RFC3339) != "2026-04-06T00:00:00+08:00" {
		t.Fatalf("expected Apr 6 bucket to start at Apr 6 midnight in generatedAt location, got %#v", history[3])
	}

	apr7Bucket := history[4]
	if apr7Bucket.Decisions.Total != 2 ||
		apr7Bucket.Decisions.ActionAttempts != 1 ||
		apr7Bucket.Decisions.ActionSucceeded != 0 ||
		apr7Bucket.Decisions.Skipped != 1 {
		t.Fatalf("expected Apr 7 bucket decisions to reflect one failed action plus one skipped duplicate, got %#v", apr7Bucket)
	}
	if apr7Bucket.AlertsCount != 1 {
		t.Fatalf("expected acknowledgement not to reduce Apr 7 history alerts beyond suppression+snooze, got %#v", apr7Bucket)
	}

	apr9Bucket := history[6]
	if apr9Bucket.Decisions.Total != 1 || apr9Bucket.AlertsCount != 1 {
		t.Fatalf("expected Apr 9 bucket to include only pre-generatedAt decision, got %#v", apr9Bucket)
	}

	historyJSON, err := json.Marshal(summary.History)
	if err != nil {
		t.Fatalf("json.Marshal(history) error = %v", err)
	}
	if !strings.Contains(string(historyJSON), "\"dailyLast7Days\"") {
		t.Fatalf("expected history JSON to contain dailyLast7Days, got %s", string(historyJSON))
	}
	if !strings.Contains(string(historyJSON), "\"dailyLast30Days\"") {
		t.Fatalf("expected history JSON to contain dailyLast30Days, got %s", string(historyJSON))
	}
	if !strings.Contains(string(historyJSON), "\"dailyLast90Days\"") {
		t.Fatalf("expected history JSON to contain dailyLast90Days, got %s", string(historyJSON))
	}
	if !strings.Contains(string(historyJSON), "\"weeklyLast12Weeks\"") {
		t.Fatalf("expected history JSON to contain weeklyLast12Weeks, got %s", string(historyJSON))
	}

	history30 := summary.History.DailyLast30Days
	if len(history30) != 30 {
		t.Fatalf("expected 30 daily history buckets, got %#v", history30)
	}

	expectedFirstSince30 := time.Date(2026, time.March, 11, 0, 0, 0, 0, cst)
	if !history30[0].Since.Equal(expectedFirstSince30) {
		t.Fatalf("expected first 30-day history bucket to start at %v, got %#v", expectedFirstSince30, history30[0])
	}
	if !history30[len(history30)-1].Until.Equal(generatedAt) {
		t.Fatalf("expected latest 30-day history bucket to end at generatedAt %v, got %#v", generatedAt, history30[len(history30)-1])
	}
	for index := 1; index < len(history30); index++ {
		if !history30[index-1].Since.Before(history30[index].Since) {
			t.Fatalf("expected 30-day history buckets in ascending order, got %#v", history30)
		}
	}

	totalAlerts30 := 0
	totalDecisions30 := 0
	for _, bucket := range history30 {
		totalAlerts30 += bucket.AlertsCount
		totalDecisions30 += bucket.Decisions.Total
	}
	if totalAlerts30 != 5 {
		t.Fatalf("expected 30-day history alerts to exclude data older than the 30-day window, got %#v", history30)
	}
	if totalDecisions30 != 5 {
		t.Fatalf("expected 30-day history decisions to exclude data older than the 30-day window, got %#v", history30)
	}

	apr5In30 := false
	for _, bucket := range history30 {
		if bucket.Since.In(cst).Format("2006-01-02") == "2026-04-05" {
			apr5In30 = true
			if bucket.AlertsCount != 2 {
				t.Fatalf("expected Apr 5 30-day bucket to match 7-day alert count, got %#v", bucket)
			}
		}
	}
	if !apr5In30 {
		t.Fatalf("expected Apr 5 bucket to remain present in 30-day history, got %#v", history30)
	}

	history90 := summary.History.DailyLast90Days
	if len(history90) != 90 {
		t.Fatalf("expected 90 daily history buckets, got %#v", history90)
	}

	expectedFirstSince90 := time.Date(2026, time.January, 10, 0, 0, 0, 0, cst)
	if !history90[0].Since.Equal(expectedFirstSince90) {
		t.Fatalf("expected first 90-day history bucket to start at %v, got %#v", expectedFirstSince90, history90[0])
	}
	if !history90[len(history90)-1].Until.Equal(generatedAt) {
		t.Fatalf("expected latest 90-day history bucket to end at generatedAt %v, got %#v", generatedAt, history90[len(history90)-1])
	}
	for index := 1; index < len(history90); index++ {
		if !history90[index-1].Since.Before(history90[index].Since) {
			t.Fatalf("expected 90-day history buckets in ascending order, got %#v", history90)
		}
	}

	totalAlerts90 := 0
	totalDecisions90 := 0
	mar10In90 := false
	for _, bucket := range history90 {
		totalAlerts90 += bucket.AlertsCount
		totalDecisions90 += bucket.Decisions.Total
		if bucket.Since.In(cst).Format("2006-01-02") == "2026-03-10" {
			mar10In90 = true
			if bucket.AlertsCount != 1 || bucket.Decisions.Total != 1 {
				t.Fatalf("expected Mar 10 bucket to appear in 90-day history with one failed action and one post-policy alert, got %#v", bucket)
			}
		}
	}
	if !mar10In90 {
		t.Fatalf("expected Mar 10 bucket to be present in 90-day history, got %#v", history90)
	}
	if totalAlerts90 != 6 {
		t.Fatalf("expected 90-day history alerts to include Mar 10 decision while excluding post-generatedAt data, got %#v", history90)
	}
	if totalDecisions90 != 6 {
		t.Fatalf("expected 90-day history decisions to include Mar 10 decision while excluding post-generatedAt data, got %#v", history90)
	}

	historyWeekly := summary.History.WeeklyLast12Weeks
	if len(historyWeekly) != 12 {
		t.Fatalf("expected 12 weekly history buckets, got %#v", historyWeekly)
	}

	expectedFirstWeekSince := time.Date(2026, time.January, 19, 0, 0, 0, 0, cst)
	if !historyWeekly[0].Since.Equal(expectedFirstWeekSince) {
		t.Fatalf("expected first weekly history bucket to start at %v, got %#v", expectedFirstWeekSince, historyWeekly[0])
	}
	if !historyWeekly[len(historyWeekly)-1].Since.Equal(time.Date(2026, time.April, 6, 0, 0, 0, 0, cst)) {
		t.Fatalf("expected latest weekly history bucket to start on Monday Apr 6, got %#v", historyWeekly[len(historyWeekly)-1])
	}
	if !historyWeekly[len(historyWeekly)-1].Until.Equal(generatedAt) {
		t.Fatalf("expected latest weekly history bucket to end at generatedAt %v, got %#v", generatedAt, historyWeekly[len(historyWeekly)-1])
	}
	for index := 1; index < len(historyWeekly); index++ {
		if !historyWeekly[index-1].Since.Before(historyWeekly[index].Since) {
			t.Fatalf("expected weekly history buckets in ascending order, got %#v", historyWeekly)
		}
	}

	latestWeek := historyWeekly[len(historyWeekly)-1]
	if latestWeek.Decisions.Total != 4 ||
		latestWeek.Decisions.ActionAttempts != 2 ||
		latestWeek.Decisions.ActionSucceeded != 0 ||
		latestWeek.Decisions.Skipped != 2 ||
		latestWeek.AlertsCount != 3 {
		t.Fatalf("expected latest weekly bucket to aggregate Apr 6-Apr 9 data before generatedAt, got %#v", latestWeek)
	}

	foundOutsideRangeData := false
	for _, bucket := range historyWeekly {
		if bucket.Since.Before(expectedFirstWeekSince) {
			foundOutsideRangeData = true
			break
		}
	}
	if foundOutsideRangeData {
		t.Fatalf("expected weekly history to exclude data older than 12 weeks, got %#v", historyWeekly)
	}
}

func TestMetricsConfigReflectsRuntimePreferencesAndCoverageEligibility(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyPostToolUseFailedValidationEnabled:                             serviceBoolPtr(false),
		TurnPolicyStopMissingSuccessfulVerificationEnabled:                       serviceBoolPtr(true),
		TurnPolicyPostToolUsePrimaryAction:                                       actionFollowUp,
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction:                 actionSteer,
		TurnPolicyPostToolUseInterruptNoActiveTurnBehavior:                       actionFollowUp,
		TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: interruptNoActiveTurnBehaviorSkip,
		TurnPolicyFollowUpCooldownMs:                                             serviceInt64Ptr(45000),
		TurnPolicyPostToolUseFollowUpCooldownMs:                                  serviceInt64Ptr(0),
		TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:            serviceInt64Ptr(120000),
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedMetricsThreadProjection(t, dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				commandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				fileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 21, 0, 0, 0, time.UTC)
	mustCreateMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          stopMissingVerifyPolicy,
		Fingerprint:         "fp-stop-policy",
		Verdict:             actionFollowUp,
		Action:              actionFollowUp,
		ActionStatus:        actionStatusSucceeded,
		Reason:              "file_changes_missing_successful_verification",
		Source:              "interactive",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(100 * time.Millisecond),
		CompletedAt:         base.Add(200 * time.Millisecond),
	})

	service := NewService(dataStore, nil, nil)
	service.now = func() time.Time { return base.Add(1 * time.Minute) }

	summary, err := service.Metrics(workspace.ID, "", "")
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	if summary.Config.PostToolUseFailedValidationPolicyEnabled {
		t.Fatalf("expected post-tool-use policy to be disabled, got %#v", summary.Config)
	}
	if !summary.Config.StopMissingSuccessfulVerificationPolicyEnabled {
		t.Fatalf("expected stop-missing-verify policy to stay enabled, got %#v", summary.Config)
	}
	if summary.Config.PostToolUsePrimaryAction != actionFollowUp {
		t.Fatalf("expected post-tool-use primary action override to be echoed, got %#v", summary.Config)
	}
	if summary.Config.StopMissingSuccessfulVerificationPrimaryAction != actionSteer {
		t.Fatalf("expected stop-missing-verify primary action override to be echoed, got %#v", summary.Config)
	}
	if summary.Config.PostToolUseInterruptNoActiveTurnBehavior != actionFollowUp {
		t.Fatalf("expected post-tool-use interrupt fallback override to be echoed, got %#v", summary.Config)
	}
	if summary.Config.StopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != interruptNoActiveTurnBehaviorSkip {
		t.Fatalf("expected stop-missing-verify interrupt fallback override to be echoed, got %#v", summary.Config)
	}
	if summary.Config.FollowUpCooldownMs != 45000 {
		t.Fatalf("expected follow-up cooldown override to be echoed, got %#v", summary.Config)
	}
	if summary.Config.PostToolUseFollowUpCooldownMs != 0 {
		t.Fatalf("expected post-tool-use follow-up cooldown override to be echoed, got %#v", summary.Config)
	}
	if summary.Config.StopMissingSuccessfulVerificationFollowUpCooldownMs != 120000 {
		t.Fatalf("expected stop-missing-verify follow-up cooldown override to be echoed, got %#v", summary.Config)
	}
	if summary.Audit.EligibleTurns != 1 || summary.Audit.CoveredTurns != 1 || summary.Audit.CoverageRate != 1 {
		t.Fatalf("expected disabled post-tool-use policy to be excluded from coverage eligibility, got %#v", summary.Audit)
	}
	if summary.Turns.FailedValidationCommand != 1 {
		t.Fatalf("expected failed validation turn to remain in turn summary, got %#v", summary.Turns)
	}
	if codes := metricsAlertCodeSet(summary.Alerts); codes["audit_coverage_incomplete"] {
		t.Fatalf("did not expect audit coverage alert when disabled policy is excluded from eligibility, got %#v", summary.Alerts)
	}
}

func seedMetricsThreadProjection(
	t *testing.T,
	dataStore *store.MemoryStore,
	workspaceID string,
	threadID string,
	turns []store.ThreadTurn,
) {
	t.Helper()

	now := time.Date(2026, time.April, 8, 15, 0, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:          threadID,
		WorkspaceID: workspaceID,
		Cwd:         `E:\projects\ai\codex-server`,
		Name:        threadID,
		Status:      "idle",
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread: store.Thread{
			ID:          threadID,
			WorkspaceID: workspaceID,
			Cwd:         `E:\projects\ai\codex-server`,
			Name:        threadID,
			Status:      "idle",
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		Cwd:          `E:\projects\ai\codex-server`,
		Source:       "interactive",
		TurnCount:    len(turns),
		MessageCount: len(turns),
		Turns:        turns,
	})
}

func mustCreateMetricsDecision(t *testing.T, dataStore *store.MemoryStore, decision store.TurnPolicyDecision) {
	t.Helper()

	if _, err := dataStore.CreateTurnPolicyDecision(decision); err != nil {
		t.Fatalf("CreateTurnPolicyDecision() error = %v", err)
	}
}

func metricsAlertCodes(alerts []MetricsAlert) []string {
	codes := make([]string, 0, len(alerts))
	for _, alert := range alerts {
		codes = append(codes, alert.Code)
	}
	return codes
}

func metricsAlertCodeSet(alerts []MetricsAlert) map[string]bool {
	set := make(map[string]bool, len(alerts))
	for _, alert := range alerts {
		set[alert.Code] = true
	}
	return set
}

func findMetricsAlert(alerts []MetricsAlert, code string) MetricsAlert {
	for _, alert := range alerts {
		if alert.Code == code {
			return alert
		}
	}
	return MetricsAlert{}
}

func intPtr(value int) *int {
	return &value
}

func int64Ptr(value int64) *int64 {
	return &value
}

func fileChangeItem(id string, path string) map[string]any {
	return map[string]any{
		"id":     id,
		"type":   "fileChange",
		"status": "completed",
		"changes": []any{
			map[string]any{
				"kind": "update",
				"path": path,
			},
		},
	}
}

func commandExecutionItem(id string, command string, status string, exitCode int) map[string]any {
	return map[string]any{
		"id":       id,
		"type":     "commandExecution",
		"command":  command,
		"status":   status,
		"exitCode": exitCode,
	}
}
