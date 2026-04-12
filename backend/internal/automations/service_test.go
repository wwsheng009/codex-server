package automations

import (
	"context"
	"errors"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/hooks"
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
	result      turns.Result
	calls       int
	lastOptions turns.StartOptions
}

func (f *fakeTurnService) Start(_ context.Context, _ string, _ string, _ string, options turns.StartOptions) (turns.Result, error) {
	f.calls += 1
	f.lastOptions = options
	if f.result.TurnID == "" {
		f.result = turns.Result{
			TurnID: "turn_automation",
			Status: "running",
		}
	}

	return f.result, nil
}

func (f *fakeTurnService) Steer(_ context.Context, _ string, _ string, _ string) (turns.Result, error) {
	return turns.Result{}, nil
}

func (f *fakeTurnService) Interrupt(_ context.Context, _ string, _ string) (turns.Result, error) {
	return turns.Result{}, nil
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

func TestTriggerPassesResponsesAPIClientMetadataToTurnStart(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	threadService := &fakeThreadService{}
	turnService := &fakeTurnService{
		result: turns.Result{
			TurnID: "turn_automation_meta",
			Status: "running",
		},
	}

	service := NewService(dataStore, threadService, turnService, nil)
	service.runPollInterval = time.Hour

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

	if turnService.calls != 1 {
		t.Fatalf("expected turns.Start to be called once, got %d", turnService.calls)
	}
	if turnService.lastOptions.PermissionPreset != "full-access" {
		t.Fatalf("expected automation turn to keep full-access preset, got %#v", turnService.lastOptions.PermissionPreset)
	}
	if turnService.lastOptions.ResponsesAPIClientMetadata.Source != "automation" {
		t.Fatalf("expected automation metadata source, got %#v", turnService.lastOptions.ResponsesAPIClientMetadata.Source)
	}
	if turnService.lastOptions.ResponsesAPIClientMetadata.Origin != "codex-server-web" {
		t.Fatalf("expected codex-server-web metadata origin, got %#v", turnService.lastOptions.ResponsesAPIClientMetadata.Origin)
	}
	if turnService.lastOptions.ResponsesAPIClientMetadata.WorkspaceID != workspace.ID {
		t.Fatalf("expected automation metadata workspace id %q, got %#v", workspace.ID, turnService.lastOptions.ResponsesAPIClientMetadata.WorkspaceID)
	}
	if turnService.lastOptions.ResponsesAPIClientMetadata.ThreadID == "" {
		t.Fatal("expected automation metadata thread id to be populated")
	}
	if turnService.lastOptions.ResponsesAPIClientMetadata.AutomationID != automation.ID {
		t.Fatalf("expected automation metadata automation id %q, got %#v", automation.ID, turnService.lastOptions.ResponsesAPIClientMetadata.AutomationID)
	}
	if turnService.lastOptions.ResponsesAPIClientMetadata.AutomationRunID != run.ID {
		t.Fatalf("expected automation metadata run id %q, got %#v", run.ID, turnService.lastOptions.ResponsesAPIClientMetadata.AutomationRunID)
	}
	if turnService.lastOptions.ResponsesAPIClientMetadata.AutomationTrigger != "manual" {
		t.Fatalf("expected automation metadata trigger manual, got %#v", turnService.lastOptions.ResponsesAPIClientMetadata.AutomationTrigger)
	}
}

func TestTriggerBlocksSecretLikeAutomationPromptBeforeStartingTurn(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	threadService := &fakeThreadService{}
	rawTurnService := &fakeTurnService{}
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	hookService := hooks.NewService(dataStore, rawTurnService, eventHub)
	governedTurnStarter := hooks.NewGovernedTurnStarter(hookService, "automation/run", "thread")

	service := NewService(dataStore, threadService, governedTurnStarter, nil)
	automation, err := service.Create(CreateInput{
		Title:       "Daily Sync",
		Description: "Summary",
		Prompt:      "请直接使用这个 key: sk-proj-abcDEF1234567890xyzUVW9876543210",
		WorkspaceID: workspace.ID,
		Schedule:    "hourly",
		Model:       "gpt-5.4",
		Reasoning:   "medium",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	_, err = service.Trigger(context.Background(), automation.ID)
	var blockedErr *hooks.GovernedTurnBlockedError
	if !errors.As(err, &blockedErr) {
		t.Fatalf("expected governed turn start block error, got %v", err)
	}
	if rawTurnService.calls != 0 {
		t.Fatalf("expected blocked automation prompt to skip turns.Start, got %d calls", rawTurnService.calls)
	}
	if threadService.createdThread.ID == "" {
		t.Fatal("expected automation trigger to prepare a thread before hook evaluation")
	}

	runs := dataStore.ListHookRuns(workspace.ID, threadService.createdThread.ID)
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].EventName != "UserPromptSubmit" || runs[0].TriggerMethod != "automation/run" || runs[0].Scope != "thread" {
		t.Fatalf("expected automation trigger to record governed user prompt hook metadata, got %#v", runs[0])
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
