package jobs

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
)

type fakePromptRunThreads struct {
	createdThread   store.Thread
	detail          store.ThreadDetail
	createErr       error
	detailErr       error
	createCalls     int
	getDetailCalls  int
	lastCreateInput threads.CreateInput
}

func (f *fakePromptRunThreads) Create(
	_ context.Context,
	workspaceID string,
	input threads.CreateInput,
) (store.Thread, error) {
	f.createCalls += 1
	f.lastCreateInput = input
	if f.createErr != nil {
		return store.Thread{}, f.createErr
	}
	if strings.TrimSpace(f.createdThread.ID) == "" {
		now := time.Now().UTC()
		f.createdThread = store.Thread{
			ID:          "thread_prompt_1",
			WorkspaceID: workspaceID,
			Name:        input.Name,
			Status:      "idle",
			CreatedAt:   now,
			UpdatedAt:   now,
		}
	}
	return f.createdThread, nil
}

func (f *fakePromptRunThreads) GetDetail(
	_ context.Context,
	workspaceID string,
	threadID string,
) (store.ThreadDetail, error) {
	f.getDetailCalls += 1
	if f.detailErr != nil {
		return store.ThreadDetail{}, f.detailErr
	}
	if strings.TrimSpace(f.detail.ID) == "" {
		f.detail = store.ThreadDetail{
			Thread: store.Thread{
				ID:          threadID,
				WorkspaceID: workspaceID,
				Name:        "Prompt Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		}
	}
	return f.detail, nil
}

type fakePromptRunTurns struct {
	result      turns.Result
	err         error
	calls       int
	lastInput   string
	lastOptions turns.StartOptions
}

func (f *fakePromptRunTurns) Start(
	_ context.Context,
	_ string,
	_ string,
	input string,
	options turns.StartOptions,
) (turns.Result, error) {
	f.calls += 1
	f.lastInput = input
	f.lastOptions = options
	if f.err != nil {
		return turns.Result{}, f.err
	}
	if strings.TrimSpace(f.result.TurnID) == "" {
		f.result = turns.Result{
			TurnID: "turn_prompt_1",
			Status: "running",
		}
	}
	return f.result, nil
}

func TestPromptRunRunnerNormalizeCreateInput(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	runner := promptRunRunner{
		store: dataStore,
	}

	input := &CreateInput{
		SourceType:   "automation",
		SourceRefID:  "auto_legacy",
		Name:         "Nightly Prompt",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "prompt_run",
		Payload: map[string]any{
			"prompt":     "  Summarize repo changes  ",
			"reasoning":  "high",
			"threadName": "Prompt Review",
			"timeoutSec": 900,
		},
	}

	if err := runner.NormalizeCreateInput(input); err != nil {
		t.Fatalf("NormalizeCreateInput() error = %v", err)
	}

	if input.SourceType != "" || input.SourceRefID != "" {
		t.Fatalf("expected prompt_run to clear source references, got sourceType=%q sourceRefId=%q", input.SourceType, input.SourceRefID)
	}
	if got := readString(input.Payload, "prompt"); got != "Summarize repo changes" {
		t.Fatalf("expected normalized prompt, got %q", got)
	}
	if got := readString(input.Payload, "model"); got != defaultPromptRunModel {
		t.Fatalf("expected default model %q, got %q", defaultPromptRunModel, got)
	}
	if got := readString(input.Payload, "reasoning"); got != "high" {
		t.Fatalf("expected reasoning high, got %q", got)
	}
	if got := readString(input.Payload, "threadName"); got != "Prompt Review" {
		t.Fatalf("expected threadName Prompt Review, got %q", got)
	}
	if got, ok := input.Payload["timeoutSec"].(int); !ok || got != 900 {
		t.Fatalf("expected timeoutSec=900, got %#v", input.Payload["timeoutSec"])
	}
}

func TestPromptRunRunnerRejectsMissingPrompt(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	runner := promptRunRunner{
		store: dataStore,
	}

	err := runner.NormalizeCreateInput(&CreateInput{
		Name:         "Empty Prompt",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "prompt_run",
		Payload: map[string]any{
			"model": "gpt-5.4",
		},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	meta, ok := ExtractErrorMetadata(err)
	if !ok || meta.Code != "prompt_run_prompt_required" {
		t.Fatalf("expected prompt_run_prompt_required metadata, got %#v", meta)
	}
}

func TestPromptRunRunnerDefinitionExposesStructuredFormMetadata(t *testing.T) {
	t.Parallel()

	definition := promptRunRunner{}.Definition()
	if definition.Kind != "prompt_run" {
		t.Fatalf("expected prompt_run definition, got %#v", definition.Kind)
	}
	if definition.Capabilities == nil || definition.Capabilities.Prompt == nil {
		t.Fatalf("expected prompt capability, got %#v", definition.Capabilities)
	}
	if definition.Form == nil || len(definition.Form.Fields) < 5 {
		t.Fatalf("expected structured form fields, got %#v", definition.Form)
	}

	expectations := map[string]string{
		"prompt":     "textarea",
		"model":      "text",
		"reasoning":  "reasoning_select",
		"threadName": "text",
		"timeoutSec": "number",
	}
	for purpose, wantKind := range expectations {
		field := findPromptRunFormField(definition.Form.Fields, purpose)
		if field == nil {
			t.Fatalf("expected form field %q, got %#v", purpose, definition.Form.Fields)
		}
		if field.Kind != wantKind {
			t.Fatalf("expected %q kind %q, got %#v", purpose, wantKind, field.Kind)
		}
	}

	promptField := findPromptRunFormField(definition.Form.Fields, "prompt")
	if promptField == nil || promptField.Label != "Prompt" || promptField.Group != "prompt" {
		t.Fatalf("expected prompt field metadata, got %#v", promptField)
	}
	if promptField.Validation == nil || promptField.Validation.MinLength == nil || *promptField.Validation.MinLength != 1 {
		t.Fatalf("expected prompt validation metadata, got %#v", promptField)
	}
	modelField := findPromptRunFormField(definition.Form.Fields, "model")
	if modelField == nil || modelField.DataSource == nil || modelField.DataSource.Kind != "workspace_models" || !modelField.DataSource.AllowCustomValue {
		t.Fatalf("expected model datasource metadata, got %#v", modelField)
	}
	threadNameField := findPromptRunFormField(definition.Form.Fields, "threadName")
	if threadNameField == nil || !threadNameField.Advanced || threadNameField.Group != "execution" {
		t.Fatalf("expected advanced threadName execution metadata, got %#v", threadNameField)
	}
	timeoutField := findPromptRunFormField(definition.Form.Fields, "timeoutSec")
	if timeoutField == nil || !timeoutField.Advanced || timeoutField.Label != "Timeout (Seconds)" {
		t.Fatalf("expected advanced timeout metadata, got %#v", timeoutField)
	}
	if timeoutField.Validation == nil || !timeoutField.Validation.IntegerOnly {
		t.Fatalf("expected timeout integer validation metadata, got %#v", timeoutField)
	}
	reasoningField := findPromptRunFormField(definition.Form.Fields, "reasoning")
	if reasoningField == nil || len(reasoningField.Options) != 4 || reasoningField.Options[3].Label != "Extra High" {
		t.Fatalf("expected labeled reasoning options, got %#v", reasoningField)
	}
}

func TestPromptRunRunnerExecuteReturnsSuccessOutput(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	threadService := &fakePromptRunThreads{
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread_prompt_1",
				WorkspaceID: workspace.ID,
				Name:        "Nightly Prompt",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{
				{
					ID:     "turn_prompt_1",
					Status: "completed",
					Items: []map[string]any{
						{
							"id":   "reasoning_1",
							"type": "reasoning",
							"summary": []any{
								"Checked repository state.",
							},
						},
						{
							"id":    "msg_1",
							"type":  "agentMessage",
							"text":  "Nightly summary complete",
							"phase": "final_answer",
						},
					},
				},
			},
		},
	}
	turnService := &fakePromptRunTurns{
		result: turns.Result{
			TurnID: "turn_prompt_1",
			Status: "running",
		},
	}
	runner := promptRunRunner{
		threads:      threadService,
		turns:        turnService,
		store:        dataStore,
		now:          func() time.Time { return time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC) },
		pollInterval: time.Millisecond,
	}

	output, err := runner.Execute(context.Background(), ExecutionRequest{
		WorkspaceID: workspace.ID,
		Job: store.BackgroundJob{
			ID:           "job_prompt_1",
			Name:         "Nightly Prompt",
			WorkspaceID:  workspace.ID,
			ExecutorKind: "prompt_run",
			Payload: map[string]any{
				"prompt":    "Summarize repo changes",
				"model":     "gpt-5.4",
				"reasoning": "high",
			},
		},
		Run: store.BackgroundJobRun{
			ID:     "run_prompt_1",
			Status: "running",
		},
	})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if threadService.createCalls != 1 {
		t.Fatalf("expected one thread create call, got %d", threadService.createCalls)
	}
	if turnService.calls != 1 {
		t.Fatalf("expected one turn start call, got %d", turnService.calls)
	}
	if turnService.lastInput != "Summarize repo changes" {
		t.Fatalf("expected prompt input to be forwarded, got %q", turnService.lastInput)
	}
	if threadService.lastCreateInput.PermissionPreset != "full-access" {
		t.Fatalf("expected full-access thread creation, got %q", threadService.lastCreateInput.PermissionPreset)
	}
	if threadService.lastCreateInput.SessionStartSource != threads.ThreadStartSourceStartup {
		t.Fatalf("expected startup session start source, got %q", threadService.lastCreateInput.SessionStartSource)
	}
	if turnService.lastOptions.PermissionPreset != "full-access" {
		t.Fatalf("expected full-access turn start, got %q", turnService.lastOptions.PermissionPreset)
	}
	if turnService.lastOptions.Model != "gpt-5.4" {
		t.Fatalf("expected model gpt-5.4, got %q", turnService.lastOptions.Model)
	}
	if turnService.lastOptions.ReasoningEffort != "high" {
		t.Fatalf("expected reasoning high, got %q", turnService.lastOptions.ReasoningEffort)
	}
	if turnService.lastOptions.ResponsesAPIClientMetadata.Source != "job" {
		t.Fatalf("expected job source metadata, got %q", turnService.lastOptions.ResponsesAPIClientMetadata.Source)
	}
	if output["ok"] != true {
		t.Fatalf("expected ok output, got %#v", output)
	}
	if output["threadId"] != "thread_prompt_1" {
		t.Fatalf("expected threadId thread_prompt_1, got %#v", output["threadId"])
	}
	if output["turnId"] != "turn_prompt_1" {
		t.Fatalf("expected turnId turn_prompt_1, got %#v", output["turnId"])
	}
	if output["summary"] != "Nightly summary complete" {
		t.Fatalf("expected summary from final assistant text, got %#v", output["summary"])
	}
	if output["assistantText"] != "Nightly summary complete" {
		t.Fatalf("expected assistantText, got %#v", output["assistantText"])
	}
	if output["reasoningText"] != "Checked repository state." {
		t.Fatalf("expected reasoningText, got %#v", output["reasoningText"])
	}
}

func TestPromptRunRunnerExecuteReturnsFailureOutput(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	threadService := &fakePromptRunThreads{
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread_prompt_1",
				WorkspaceID: workspace.ID,
				Name:        "Failing Prompt",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{
				{
					ID:     "turn_prompt_1",
					Status: "failed",
					Error: map[string]any{
						"message": "sandbox denied write access",
					},
					Items: []map[string]any{
						{
							"id":               "cmd_1",
							"type":             "commandExecution",
							"aggregatedOutput": "git status",
						},
					},
				},
			},
		},
	}
	turnService := &fakePromptRunTurns{
		result: turns.Result{
			TurnID: "turn_prompt_1",
			Status: "running",
		},
	}
	runner := promptRunRunner{
		threads:      threadService,
		turns:        turnService,
		store:        dataStore,
		now:          func() time.Time { return time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC) },
		pollInterval: time.Millisecond,
	}

	_, err := runner.Execute(context.Background(), ExecutionRequest{
		WorkspaceID: workspace.ID,
		Job: store.BackgroundJob{
			ID:           "job_prompt_1",
			Name:         "Failing Prompt",
			WorkspaceID:  workspace.ID,
			ExecutorKind: "prompt_run",
			Payload: map[string]any{
				"prompt": "Inspect repo and fix issues",
			},
		},
	})
	if err == nil {
		t.Fatal("expected failed terminal turn to return an error")
	}

	output := extractFailureOutput(err)
	if output["threadId"] != "thread_prompt_1" {
		t.Fatalf("expected failure output threadId, got %#v", output["threadId"])
	}
	if output["turnId"] != "turn_prompt_1" {
		t.Fatalf("expected failure output turnId, got %#v", output["turnId"])
	}
	if output["message"] != "sandbox denied write access" {
		t.Fatalf("expected failure output message, got %#v", output["message"])
	}
	if output["commandOutput"] != "git status" {
		t.Fatalf("expected failure output commandOutput, got %#v", output["commandOutput"])
	}
	meta, ok := ExtractErrorMetadata(err)
	if !ok || meta.Code != "prompt_run_turn_failed" || meta.Retryable == nil || !*meta.Retryable {
		t.Fatalf("expected retryable prompt_run_turn_failed metadata, got %#v", meta)
	}
}

func TestPromptRunRunnerNormalizeCreateInputAppliesThreadNameDefault(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	runner := promptRunRunner{
		store: dataStore,
	}

	input := &CreateInput{
		Name:         "Prompt Job Name",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "prompt_run",
		Payload: map[string]any{
			"prompt": "Summarize repo changes",
		},
	}

	if err := runner.NormalizeCreateInput(input); err != nil {
		t.Fatalf("NormalizeCreateInput() error = %v", err)
	}

	if got := readString(input.Payload, "threadName"); got != "Prompt Job Name" {
		t.Fatalf("expected default threadName from job name, got %q", got)
	}
}

func TestPromptRunRunnerExecuteReturnsTimeoutFailureOutput(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	threadService := &fakePromptRunThreads{
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread_prompt_timeout",
				WorkspaceID: workspace.ID,
				Name:        "Slow Prompt",
				Status:      "running",
			},
			Turns: []store.ThreadTurn{
				{
					ID:     "turn_prompt_timeout",
					Status: "running",
				},
			},
		},
	}
	turnService := &fakePromptRunTurns{
		result: turns.Result{
			TurnID: "turn_prompt_timeout",
			Status: "running",
		},
	}
	runner := promptRunRunner{
		threads:      threadService,
		turns:        turnService,
		store:        dataStore,
		pollInterval: time.Millisecond,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	_, err := runner.Execute(ctx, ExecutionRequest{
		WorkspaceID: workspace.ID,
		Job: store.BackgroundJob{
			ID:           "job_prompt_timeout",
			Name:         "Slow Prompt",
			WorkspaceID:  workspace.ID,
			ExecutorKind: "prompt_run",
			Payload: map[string]any{
				"prompt":     "Wait until timeout",
				"timeoutSec": 120,
			},
		},
	})
	if err == nil {
		t.Fatal("expected timeout to return an error")
	}

	output := extractFailureOutput(err)
	if output["status"] != "timeout" {
		t.Fatalf("expected timeout status, got %#v", output["status"])
	}
	meta, ok := ExtractErrorMetadata(err)
	if !ok || meta.Code != "prompt_run_timeout" || meta.Category != "timeout" {
		t.Fatalf("expected prompt_run_timeout metadata, got %#v", meta)
	}
}

func findPromptRunFormField(fields []ExecutorFormField, purpose string) *ExecutorFormField {
	for index := range fields {
		if fields[index].Purpose == purpose {
			return &fields[index]
		}
	}
	return nil
}
