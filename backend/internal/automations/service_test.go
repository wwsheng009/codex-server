package automations

import (
	"context"
	"errors"
	"testing"
	"time"

	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
)

type fakeThreadService struct {
	createdThread store.Thread
	detail        store.ThreadDetail
	createCalls   int
}

func (f *fakeThreadService) Create(_ context.Context, workspaceID string, input threads.CreateInput) (store.Thread, error) {
	f.createCalls += 1
	if f.createdThread.ID == "" {
		f.createdThread = store.Thread{
			ID:          "thr_automation",
			WorkspaceID: workspaceID,
			Name:        input.Name,
			Status:      "idle",
			CreatedAt:   time.Now().UTC(),
			UpdatedAt:   time.Now().UTC(),
		}
	}

	return f.createdThread, nil
}

func (f *fakeThreadService) GetDetail(_ context.Context, workspaceID string, threadID string) (store.ThreadDetail, error) {
	if f.detail.ID == "" {
		f.detail = store.ThreadDetail{
			Thread: store.Thread{
				ID:          threadID,
				WorkspaceID: workspaceID,
				Name:        "Automation Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		}
	}

	return f.detail, nil
}

type fakeTurnService struct {
	result turns.Result
	calls  int
}

func (f *fakeTurnService) Start(_ context.Context, _ string, _ string, _ string, _ turns.StartOptions) (turns.Result, error) {
	f.calls += 1
	if f.result.TurnID == "" {
		f.result = turns.Result{
			TurnID: "turn_automation",
			Status: "running",
		}
	}

	return f.result, nil
}

func TestCreateRequiresWorkspace(t *testing.T) {
	t.Parallel()

	service := NewService(store.NewMemoryStore(), nil, nil, nil)

	_, err := service.Create(CreateInput{
		Title:       "Daily Sync",
		Prompt:      "Summarize changes",
		WorkspaceID: "missing",
	})
	if err != store.ErrWorkspaceNotFound {
		t.Fatalf("expected ErrWorkspaceNotFound, got %v", err)
	}
}

func TestListHydratesCurrentWorkspaceName(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Original Workspace", "E:/projects/ai/codex-server")
	service := NewService(dataStore, nil, nil, nil)

	automation, err := service.Create(CreateInput{
		Title:       "Daily Sync",
		Description: "Summary",
		Prompt:      "Summarize changes",
		WorkspaceID: workspace.ID,
		Schedule:    "hourly",
		Model:       "gpt-5.4",
		Reasoning:   "medium",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := dataStore.SetWorkspaceName(workspace.ID, "Renamed Workspace"); err != nil {
		t.Fatalf("SetWorkspaceName() error = %v", err)
	}

	reloaded, err := service.Get(automation.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if reloaded.WorkspaceName != "Renamed Workspace" {
		t.Fatalf("expected hydrated workspace name, got %q", reloaded.WorkspaceName)
	}
}

func TestTriggerCompletesRunAndCreatesNotification(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	threadService := &fakeThreadService{
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thr_automation",
				WorkspaceID: workspace.ID,
				Name:        "Automation Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{
				{
					ID:     "turn_automation",
					Status: "completed",
					Items: []map[string]any{
						{
							"id":    "msg_1",
							"type":  "agentMessage",
							"text":  "Daily summary complete",
							"phase": "final_answer",
						},
					},
				},
			},
		},
	}
	turnService := &fakeTurnService{
		result: turns.Result{
			TurnID: "turn_automation",
			Status: "running",
		},
	}

	service := NewService(dataStore, threadService, turnService, nil)
	now := time.Date(2026, 3, 21, 6, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	automation, err := service.Create(CreateInput{
		Title:       "Daily Sync",
		Description: "Summary",
		Prompt:      "Summarize changes",
		WorkspaceID: workspace.ID,
		Schedule:    "hourly",
		Model:       "gpt-5.4",
		Reasoning:   "medium",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	run, err := service.Trigger(context.Background(), automation.ID)
	if err != nil {
		t.Fatalf("Trigger() error = %v", err)
	}

	if _, err := service.tryFinalizeRun(context.Background(), run.ID); err != nil {
		t.Fatalf("tryFinalizeRun() error = %v", err)
	}

	storedRun, err := service.GetRun(run.ID)
	if err != nil {
		t.Fatalf("GetRun() error = %v", err)
	}

	if storedRun.Status != "completed" {
		t.Fatalf("expected completed run, got %q", storedRun.Status)
	}
	if storedRun.Summary != "Daily summary complete" {
		t.Fatalf("expected run summary to be captured, got %q", storedRun.Summary)
	}
	if len(storedRun.Logs) == 0 {
		t.Fatal("expected run logs to be persisted")
	}

	notifications := dataStore.ListNotifications()
	if len(notifications) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(notifications))
	}
	if notifications[0].Kind != "automation_run_completed" {
		t.Fatalf("expected completion notification, got %q", notifications[0].Kind)
	}
}

func TestTryFinalizeRunFailsTerminalTurnWithCapturedError(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	threadService := &fakeThreadService{
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thr_automation",
				WorkspaceID: workspace.ID,
				Name:        "Automation Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{
				{
					ID:     "turn_automation",
					Status: "failed",
					Error: map[string]any{
						"message": "sandbox denied write access",
					},
					Items: []map[string]any{
						{
							"id":               "cmd_1",
							"type":             "commandExecution",
							"aggregatedOutput": "partial output",
						},
					},
				},
			},
		},
	}
	turnService := &fakeTurnService{
		result: turns.Result{
			TurnID: "turn_automation",
			Status: "running",
		},
	}

	service := NewService(dataStore, threadService, turnService, nil)
	now := time.Date(2026, 3, 21, 6, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	automation, err := service.Create(CreateInput{
		Title:       "Daily Sync",
		Description: "Summary",
		Prompt:      "Summarize changes",
		WorkspaceID: workspace.ID,
		Schedule:    "hourly",
		Model:       "gpt-5.4",
		Reasoning:   "medium",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	run, err := service.Trigger(context.Background(), automation.ID)
	if err != nil {
		t.Fatalf("Trigger() error = %v", err)
	}

	finalized, err := service.tryFinalizeRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("tryFinalizeRun() error = %v", err)
	}
	if !finalized {
		t.Fatal("expected terminal failed snapshot to finalize the run")
	}

	storedRun, err := service.GetRun(run.ID)
	if err != nil {
		t.Fatalf("GetRun() error = %v", err)
	}
	if storedRun.Status != "failed" {
		t.Fatalf("expected failed run, got %q", storedRun.Status)
	}
	if storedRun.Error != "sandbox denied write access" {
		t.Fatalf("expected captured error, got %q", storedRun.Error)
	}
}

func TestTemplateLifecycleAndBuiltInImmutability(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	service := NewService(dataStore, nil, nil, nil)

	templates := service.ListTemplates()
	if len(templates) == 0 || !templates[0].IsBuiltIn {
		t.Fatalf("expected built-in templates, got %#v", templates)
	}

	template, err := service.CreateTemplate(TemplateInput{
		Category:    "Custom",
		Title:       "Security Audit",
		Description: "Review security posture",
		Prompt:      "Audit the repository for security issues.",
	})
	if err != nil {
		t.Fatalf("CreateTemplate() error = %v", err)
	}

	updated, err := service.UpdateTemplate(template.ID, TemplateInput{
		Category:    "Security",
		Title:       "Security Audit Updated",
		Description: "Updated",
		Prompt:      "Updated prompt",
	})
	if err != nil {
		t.Fatalf("UpdateTemplate() error = %v", err)
	}
	if updated.Title != "Security Audit Updated" || updated.Category != "Security" {
		t.Fatalf("expected updated template, got %#v", updated)
	}

	if err := service.DeleteTemplate(template.ID); err != nil {
		t.Fatalf("DeleteTemplate() error = %v", err)
	}

	if _, err := service.UpdateTemplate("status-standup", TemplateInput{
		Category:    "Status Reports",
		Title:       "Changed",
		Description: "Changed",
		Prompt:      "Changed",
	}); !errors.Is(err, ErrImmutableTemplate) {
		t.Fatalf("expected ErrImmutableTemplate, got %v", err)
	}
}
