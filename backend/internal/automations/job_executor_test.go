package automations

import (
	"context"
	"testing"
	"time"

	"codex-server/backend/internal/jobs"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turns"
)

func TestJobExecutorAppliesPayloadOverridesToAutomationRuns(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	threadService := &fakeThreadService{
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thr_automation_override",
				WorkspaceID: workspace.ID,
				Name:        "Automation Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{
				{
					ID:     "turn_automation_override",
					Status: "completed",
					Items: []map[string]any{
						{
							"id":    "msg_1",
							"type":  "agentMessage",
							"text":  "Override complete",
							"phase": "final_answer",
						},
					},
				},
			},
		},
	}
	turnService := &fakeTurnService{
		result: turns.Result{
			TurnID: "turn_automation_override",
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

	executor := NewJobExecutor(service)
	_, err = executor.Execute(context.Background(), jobs.ExecutionRequest{
		WorkspaceID: workspace.ID,
		Job: store.BackgroundJob{
			WorkspaceID:  workspace.ID,
			ExecutorKind: "automation_run",
			SourceType:   "automation",
			SourceRefID:  automation.ID,
			Payload: map[string]any{
				"automationId": automation.ID,
				"model":        "gpt-5.4-mini",
				"reasoning":    "high",
			},
		},
		Run: store.BackgroundJobRun{
			Trigger: "manual",
		},
	})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if turnService.calls != 1 {
		t.Fatalf("expected turns.Start to be called once, got %d", turnService.calls)
	}
	if turnService.lastOptions.Model != "gpt-5.4-mini" {
		t.Fatalf("expected model override to be applied, got %#v", turnService.lastOptions.Model)
	}
	if turnService.lastOptions.ReasoningEffort != "high" {
		t.Fatalf("expected reasoning override to be applied, got %#v", turnService.lastOptions.ReasoningEffort)
	}
}

func TestJobExecutorDefinitionExposesStructuredFormMetadata(t *testing.T) {
	t.Parallel()

	definition := NewJobExecutor(&Service{}).Definition()
	if definition.Kind != "automation_run" {
		t.Fatalf("expected automation_run definition, got %#v", definition.Kind)
	}
	if definition.Capabilities == nil || definition.Capabilities.AutomationRef == nil {
		t.Fatalf("expected automation reference capability, got %#v", definition.Capabilities)
	}
	if definition.Form == nil || len(definition.Form.Fields) < 3 {
		t.Fatalf("expected structured form fields, got %#v", definition.Form)
	}

	expectations := map[string]string{
		"automationRef": "select",
		"model":         "text",
		"reasoning":     "reasoning_select",
	}
	for purpose, wantKind := range expectations {
		field := findAutomationFormField(definition.Form.Fields, purpose)
		if field == nil {
			t.Fatalf("expected form field %q, got %#v", purpose, definition.Form.Fields)
		}
		if field.Kind != wantKind {
			t.Fatalf("expected %q kind %q, got %#v", purpose, wantKind, field.Kind)
		}
	}

	automationField := findAutomationFormField(definition.Form.Fields, "automationRef")
	if automationField == nil || automationField.Label != "Automation" || automationField.Group != "target" {
		t.Fatalf("expected automation target metadata, got %#v", automationField)
	}
	if automationField.DataSource == nil || automationField.DataSource.Kind != "workspace_automations" || !automationField.DataSource.AllowBlank {
		t.Fatalf("expected automation datasource metadata, got %#v", automationField)
	}
	if automationField.Validation == nil || automationField.Validation.DisallowedPattern == "" || !automationField.Validation.AllowSourceRefFallback {
		t.Fatalf("expected automation validation metadata, got %#v", automationField)
	}
	modelField := findAutomationFormField(definition.Form.Fields, "model")
	if modelField == nil || !modelField.Advanced || modelField.Group != "overrides" {
		t.Fatalf("expected advanced model override metadata, got %#v", modelField)
	}
	if modelField.DataSource == nil || modelField.DataSource.Kind != "workspace_models" || !modelField.DataSource.AllowCustomValue {
		t.Fatalf("expected model datasource metadata, got %#v", modelField)
	}
	reasoningField := findAutomationFormField(definition.Form.Fields, "reasoning")
	if reasoningField == nil || !reasoningField.Advanced || len(reasoningField.Options) != 4 || reasoningField.Options[0].Label != "Low" {
		t.Fatalf("expected advanced reasoning override metadata, got %#v", reasoningField)
	}
}

func findAutomationFormField(fields []jobs.ExecutorFormField, purpose string) *jobs.ExecutorFormField {
	for index := range fields {
		if fields[index].Purpose == purpose {
			return &fields[index]
		}
	}
	return nil
}
