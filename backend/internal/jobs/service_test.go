package jobs

import (
	"context"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
)

func TestCreateAndTriggerNoopJob(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	service := NewService(dataStore, events.NewHub())
	service.now = func() time.Time {
		return time.Date(2026, 4, 19, 10, 0, 0, 0, time.UTC)
	}

	job, err := service.Create(CreateInput{
		Name:         "Smoke Test",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "noop",
		Schedule:     "manual",
		Payload: map[string]any{
			"message": "job ok",
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	run, err := service.Trigger(context.Background(), job.ID, "manual")
	if err != nil {
		t.Fatalf("Trigger() error = %v", err)
	}

	service.processRun(context.Background(), queuedRun{jobID: job.ID, runID: run.ID, trigger: "manual"})

	storedRun, err := service.GetRun(run.ID)
	if err != nil {
		t.Fatalf("GetRun() error = %v", err)
	}
	if storedRun.Status != "completed" {
		t.Fatalf("expected completed run, got %q", storedRun.Status)
	}
	if storedRun.Output["message"] != "job ok" {
		t.Fatalf("expected output message, got %#v", storedRun.Output)
	}

	storedJob, err := service.Get(job.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if storedJob.LastRunStatus != "completed" {
		t.Fatalf("expected completed last run status, got %q", storedJob.LastRunStatus)
	}
}

func TestPauseResumeBackgroundJob(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	service := NewService(dataStore, nil)
	service.now = func() time.Time {
		return time.Date(2026, 4, 19, 10, 0, 0, 0, time.UTC)
	}

	job, err := service.Create(CreateInput{
		Name:         "Hourly MCP Sync",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "noop",
		Schedule:     "hourly",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if job.NextRunAt == nil {
		t.Fatal("expected nextRunAt for scheduled job")
	}

	paused, err := service.Pause(job.ID)
	if err != nil {
		t.Fatalf("Pause() error = %v", err)
	}
	if paused.Status != "paused" || paused.NextRunAt != nil {
		t.Fatalf("expected paused job without nextRunAt, got %#v", paused)
	}

	resumed, err := service.Resume(job.ID)
	if err != nil {
		t.Fatalf("Resume() error = %v", err)
	}
	if resumed.Status != "active" || resumed.NextRunAt == nil {
		t.Fatalf("expected active job with nextRunAt, got %#v", resumed)
	}
}

func TestUpdateAndCancelRun(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	service := NewService(dataStore, nil)
	service.now = func() time.Time {
		return time.Date(2026, 4, 19, 10, 0, 0, 0, time.UTC)
	}

	job, err := service.Create(CreateInput{
		SourceType:   "automation",
		SourceRefID:  "auto_123",
		Name:         "Initial Name",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "noop",
		Schedule:     "manual",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	updated, err := service.Update(job.ID, UpdateInput{
		SourceType:   "automation",
		SourceRefID:  "auto_123",
		Name:         "Updated Name",
		Description:  "Updated description",
		ExecutorKind: "noop",
		Schedule:     "daily",
		Payload: map[string]any{
			"message": "updated payload",
		},
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Name != "Updated Name" || updated.Schedule != "0 9 * * *" {
		t.Fatalf("expected updated job, got %#v", updated)
	}
	if updated.SourceType != "automation" || updated.SourceRefID != "auto_123" {
		t.Fatalf("expected source link to be preserved, got %#v", updated)
	}

	run, err := service.Trigger(context.Background(), job.ID, "manual")
	if err != nil {
		t.Fatalf("Trigger() error = %v", err)
	}

	service.registerRunCancel(run.ID, func() {})
	canceled, err := service.CancelRun(run.ID)
	if err != nil {
		t.Fatalf("CancelRun() error = %v", err)
	}
	if canceled.Status != "canceled" {
		t.Fatalf("expected canceled run, got %#v", canceled)
	}
}

func TestCreateSupportsAutomationStyleSchedules(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	service := NewService(dataStore, nil)
	service.now = func() time.Time {
		return time.Date(2026, 4, 19, 10, 0, 0, 0, time.UTC)
	}

	testCases := []struct {
		name          string
		inputSchedule string
		wantSchedule  string
		wantLabel     string
	}{
		{
			name:          "daily compact schedule",
			inputSchedule: "daily-0830",
			wantSchedule:  "30 8 * * *",
			wantLabel:     "Daily at 08:30",
		},
		{
			name:          "weekly compact schedule",
			inputSchedule: "weekly-1-0915",
			wantSchedule:  "15 9 * * 1",
			wantLabel:     "Weekly on Monday at 09:15",
		},
		{
			name:          "monthly compact schedule",
			inputSchedule: "monthly-12-1045",
			wantSchedule:  "45 10 12 * *",
			wantLabel:     "Monthly on day 12 at 10:45",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			job, err := service.Create(CreateInput{
				Name:         tc.name,
				WorkspaceID:  workspace.ID,
				ExecutorKind: "noop",
				Schedule:     tc.inputSchedule,
			})
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			if job.Schedule != tc.wantSchedule {
				t.Fatalf("expected schedule %q, got %q", tc.wantSchedule, job.Schedule)
			}
			if job.ScheduleLabel != tc.wantLabel {
				t.Fatalf("expected schedule label %q, got %q", tc.wantLabel, job.ScheduleLabel)
			}
			if job.NextRunAt == nil {
				t.Fatal("expected nextRunAt for scheduled job")
			}
		})
	}
}
