package jobs

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
)

type testExecutor struct {
	definition     ExecutorDefinition
	normalizeInput func(*CreateInput) error
	validateJob    func(store.BackgroundJob) error
	execute        func(context.Context, ExecutionRequest) (map[string]any, error)
}

func (e testExecutor) Definition() ExecutorDefinition {
	return e.definition
}

func (e testExecutor) Execute(ctx context.Context, request ExecutionRequest) (map[string]any, error) {
	if e.execute == nil {
		return map[string]any{"ok": true}, nil
	}
	return e.execute(ctx, request)
}

func (e testExecutor) NormalizeCreateInput(input *CreateInput) error {
	if e.normalizeInput == nil {
		return nil
	}
	return e.normalizeInput(input)
}

func (e testExecutor) ValidateStoredJob(job store.BackgroundJob) error {
	if e.validateJob == nil {
		return nil
	}
	return e.validateJob(job)
}

func newAutomationRunTestRunner(dataStore *store.MemoryStore) Runner {
	return testExecutor{
		definition: ExecutorDefinition{
			Kind:             "automation_run",
			Title:            "Automation Run",
			SupportsSchedule: true,
		},
		normalizeInput: func(input *CreateInput) error {
			return normalizeTestAutomationRunInput(dataStore, input)
		},
		validateJob: func(job store.BackgroundJob) error {
			return normalizeTestAutomationRunInput(dataStore, &CreateInput{
				SourceType:   job.SourceType,
				SourceRefID:  job.SourceRefID,
				Name:         firstNonEmpty(strings.TrimSpace(job.Name), "automation_run"),
				WorkspaceID:  job.WorkspaceID,
				ExecutorKind: job.ExecutorKind,
				Schedule:     job.Schedule,
				Payload:      cloneAnyMap(job.Payload),
			})
		},
	}
}

func normalizeTestAutomationRunInput(dataStore *store.MemoryStore, input *CreateInput) error {
	if input == nil {
		return nil
	}
	payload := cloneAnyMap(input.Payload)
	automationID := readString(payload, "automationId")
	sourceType := strings.TrimSpace(input.SourceType)
	sourceRefID := strings.TrimSpace(input.SourceRefID)

	switch {
	case sourceType != "" && !strings.EqualFold(sourceType, "automation"):
		return newClassifiedError(
			ErrInvalidInput,
			"automation_run jobs must use sourceType automation",
			store.ErrorMetadata{
				Code:      "automation_run_source_type_invalid",
				Category:  "validation",
				Retryable: ptrBool(false),
				Details: map[string]string{
					"executorKind": "automation_run",
					"sourceType":   sourceType,
				},
			},
		)
	case automationID == "" && sourceRefID == "":
		return newClassifiedError(
			ErrInvalidInput,
			"automation_run jobs require automationId or sourceRefId",
			store.ErrorMetadata{
				Code:      "automation_run_reference_required",
				Category:  "validation",
				Retryable: ptrBool(false),
				Details: map[string]string{
					"executorKind": "automation_run",
				},
			},
		)
	case automationID != "" && sourceRefID != "" && automationID != sourceRefID:
		return newClassifiedError(
			ErrInvalidInput,
			"automation_run job sourceRefId must match payload automationId",
			store.ErrorMetadata{
				Code:      "automation_run_reference_mismatch",
				Category:  "validation",
				Retryable: ptrBool(false),
				Details: map[string]string{
					"executorKind": "automation_run",
					"sourceRefId":  sourceRefID,
					"automationId": automationID,
				},
			},
		)
	}

	resolvedAutomationID := firstNonEmpty(automationID, sourceRefID)
	automation, ok := dataStore.GetAutomation(resolvedAutomationID)
	if !ok {
		return newClassifiedError(
			store.ErrAutomationNotFound,
			"automation not found",
			store.ErrorMetadata{
				Code:      "automation_not_found",
				Category:  "reference",
				Retryable: ptrBool(false),
				Details: map[string]string{
					"executorKind": "automation_run",
					"automationId": resolvedAutomationID,
				},
			},
		)
	}
	if strings.TrimSpace(automation.WorkspaceID) != strings.TrimSpace(input.WorkspaceID) {
		return newClassifiedError(
			ErrInvalidInput,
			"automation_run job workspaceId must match automation workspace",
			store.ErrorMetadata{
				Code:      "automation_run_workspace_mismatch",
				Category:  "validation",
				Retryable: ptrBool(false),
				Details: map[string]string{
					"executorKind":          "automation_run",
					"automationId":          resolvedAutomationID,
					"workspaceId":           strings.TrimSpace(input.WorkspaceID),
					"automationWorkspaceId": strings.TrimSpace(automation.WorkspaceID),
				},
			},
		)
	}

	payload["automationId"] = resolvedAutomationID
	input.Payload = payload
	input.SourceType = "automation"
	input.SourceRefID = resolvedAutomationID
	return nil
}

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

func TestCreateAutomationRunJobValidatesReferences(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	otherWorkspace := dataStore.CreateWorkspace("Workspace B", "E:/projects/ai/codex-server")
	automation, err := dataStore.CreateAutomation(store.Automation{
		WorkspaceID: workspace.ID,
		Title:       "Automation A",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateAutomation() error = %v", err)
	}

	service := NewService(dataStore, nil)
	service.RegisterRunner(newAutomationRunTestRunner(dataStore))

	t.Run("backfills source reference from payload", func(t *testing.T) {
		job, err := service.Create(CreateInput{
			Name:         "Automation Backfill",
			WorkspaceID:  workspace.ID,
			ExecutorKind: "automation_run",
			Payload: map[string]any{
				"automationId": automation.ID,
			},
		})
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if job.SourceType != "automation" || job.SourceRefID != automation.ID {
			t.Fatalf("expected automation source to be normalized, got %#v", job)
		}
		if got, _ := job.Payload["automationId"].(string); got != automation.ID {
			t.Fatalf("expected payload automationId %q, got %#v", automation.ID, job.Payload)
		}
	})

	t.Run("rejects missing automation", func(t *testing.T) {
		_, err := service.Create(CreateInput{
			Name:         "Missing Automation",
			WorkspaceID:  workspace.ID,
			ExecutorKind: "automation_run",
			SourceType:   "automation",
			SourceRefID:  "auto_missing",
		})
		if !errors.Is(err, store.ErrAutomationNotFound) {
			t.Fatalf("expected ErrAutomationNotFound, got %v", err)
		}
		meta, ok := ExtractErrorMetadata(err)
		if !ok || meta.Code != "automation_not_found" || meta.Retryable == nil || *meta.Retryable {
			t.Fatalf("expected structured automation_not_found metadata, got %#v", meta)
		}
	})

	t.Run("rejects workspace mismatch", func(t *testing.T) {
		_, err := service.Create(CreateInput{
			Name:         "Wrong Workspace",
			WorkspaceID:  otherWorkspace.ID,
			ExecutorKind: "automation_run",
			SourceType:   "automation",
			SourceRefID:  automation.ID,
		})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		meta, ok := ExtractErrorMetadata(err)
		if !ok || meta.Code != "automation_run_workspace_mismatch" {
			t.Fatalf("expected workspace mismatch metadata, got %#v", meta)
		}
	})

	t.Run("rejects source mismatch", func(t *testing.T) {
		_, err := service.Create(CreateInput{
			Name:         "Mismatched Source",
			WorkspaceID:  workspace.ID,
			ExecutorKind: "automation_run",
			SourceType:   "automation",
			SourceRefID:  automation.ID,
			Payload: map[string]any{
				"automationId": "auto_other",
			},
		})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		meta, ok := ExtractErrorMetadata(err)
		if !ok || meta.Code != "automation_run_reference_mismatch" {
			t.Fatalf("expected reference mismatch metadata, got %#v", meta)
		}
	})
}

func TestAutomationRunFailureClassificationAndRetryBlock(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	service := NewService(dataStore, nil)
	service.RegisterRunner(testExecutor{
		definition: ExecutorDefinition{
			Kind:             "automation_run",
			Title:            "Automation Run",
			SupportsSchedule: true,
		},
		validateJob: func(job store.BackgroundJob) error {
			return normalizeTestAutomationRunInput(dataStore, &CreateInput{
				SourceType:   job.SourceType,
				SourceRefID:  job.SourceRefID,
				Name:         firstNonEmpty(strings.TrimSpace(job.Name), "automation_run"),
				WorkspaceID:  job.WorkspaceID,
				ExecutorKind: job.ExecutorKind,
				Schedule:     job.Schedule,
				Payload:      cloneAnyMap(job.Payload),
			})
		},
		execute: func(context.Context, ExecutionRequest) (map[string]any, error) {
			return nil, store.ErrAutomationNotFound
		},
	})

	job, err := dataStore.CreateBackgroundJob(store.BackgroundJob{
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Name:          "Legacy Automation Job",
		ExecutorKind:  "automation_run",
		SourceType:    "automation",
		SourceRefID:   "auto_missing",
		Payload: map[string]any{
			"automationId": "auto_missing",
		},
		Status: "active",
	})
	if err != nil {
		t.Fatalf("CreateBackgroundJob() error = %v", err)
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
	if storedRun.Status != "failed" {
		t.Fatalf("expected failed run, got %#v", storedRun)
	}
	if storedRun.ErrorMeta == nil || storedRun.ErrorMeta.Code != "automation_not_found" {
		t.Fatalf("expected automation_not_found error metadata, got %#v", storedRun.ErrorMeta)
	}
	if storedRun.ErrorMeta.Retryable == nil || *storedRun.ErrorMeta.Retryable {
		t.Fatalf("expected non-retryable failed run, got %#v", storedRun.ErrorMeta)
	}

	_, err = service.RetryRun(context.Background(), run.ID)
	if !errors.Is(err, ErrJobRunNotRetryable) {
		t.Fatalf("expected ErrJobRunNotRetryable, got %v", err)
	}
	meta, ok := ExtractErrorMetadata(err)
	if !ok || meta.Code != "automation_not_found" || meta.Retryable == nil || *meta.Retryable {
		t.Fatalf("expected retry-block metadata to preserve automation_not_found, got %#v", meta)
	}
}

func TestRetryRunBlocksLegacyAutomationReferenceWithoutStoredMetadata(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	service := NewService(dataStore, nil)
	service.RegisterRunner(newAutomationRunTestRunner(dataStore))

	job, err := dataStore.CreateBackgroundJob(store.BackgroundJob{
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Name:          "Legacy Missing Automation Job",
		ExecutorKind:  "automation_run",
		SourceType:    "automation",
		SourceRefID:   "auto_missing",
		Payload: map[string]any{
			"automationId": "auto_missing",
		},
		Status: "active",
	})
	if err != nil {
		t.Fatalf("CreateBackgroundJob() error = %v", err)
	}
	run, err := dataStore.CreateBackgroundJobRun(store.BackgroundJobRun{
		JobID:         job.ID,
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		ExecutorKind:  job.ExecutorKind,
		Trigger:       "manual",
		Status:        "failed",
		Error:         "automation not found",
		StartedAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("CreateBackgroundJobRun() error = %v", err)
	}

	_, err = service.RetryRun(context.Background(), run.ID)
	if !errors.Is(err, ErrJobRunNotRetryable) {
		t.Fatalf("expected ErrJobRunNotRetryable, got %v", err)
	}
	meta, ok := ExtractErrorMetadata(err)
	if !ok || meta.Code != "automation_not_found" || meta.Retryable == nil || *meta.Retryable {
		t.Fatalf("expected automation_not_found retry block metadata, got %#v", meta)
	}
}

func TestFailRunStoresFailureOutput(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	service := NewService(dataStore, nil)
	service.RegisterRunner(testExecutor{
		definition: ExecutorDefinition{
			Kind:             "failure_output",
			Title:            "Failure Output",
			SupportsSchedule: true,
		},
		execute: func(context.Context, ExecutionRequest) (map[string]any, error) {
			return nil, withFailureOutput(
				NewClassifiedError(
					errors.New("non-zero exit"),
					"Shell script exited with code 2.",
					store.ErrorMetadata{
						Code:      "shell_script_exit_non_zero",
						Category:  "execution",
						Retryable: ptrBool(true),
					},
				),
				map[string]any{
					"message":  "Shell script exited with code 2.",
					"exitCode": 2,
					"stderr":   "boom",
				},
			)
		},
	})

	job, err := service.Create(CreateInput{
		Name:         "Failure Output Job",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "failure_output",
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
	if storedRun.Status != "failed" {
		t.Fatalf("expected failed run, got %#v", storedRun)
	}
	if storedRun.Output["stderr"] != "boom" {
		t.Fatalf("expected failure output to be persisted, got %#v", storedRun.Output)
	}
	if storedRun.Summary != "Shell script exited with code 2." {
		t.Fatalf("expected summary from failure output, got %q", storedRun.Summary)
	}
}

func TestSummarizeOutputPrefersSummaryBeforeMessage(t *testing.T) {
	t.Parallel()

	output := map[string]any{
		"message": "Prompt run completed successfully.",
		"summary": "Nightly summary complete",
	}

	if got := summarizeOutput(output); got != "Nightly summary complete" {
		t.Fatalf("expected summarizeOutput() to prefer summary, got %q", got)
	}
}
