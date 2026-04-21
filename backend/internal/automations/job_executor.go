package automations

import (
	"context"
	"errors"
	"strings"
	"time"

	"codex-server/backend/internal/jobs"
	"codex-server/backend/internal/store"
)

type jobExecutor struct {
	service *Service
}

func NewJobRunner(service *Service) jobs.Runner {
	return jobExecutor{service: service}
}

func NewJobExecutor(service *Service) jobs.Executor {
	return NewJobRunner(service)
}

func (e jobExecutor) Definition() jobs.ExecutorDefinition {
	return jobs.ExecutorDefinition{
		Kind:             "automation_run",
		Title:            "Automation Run",
		Description:      "Execute an existing automation through the unified background job framework.",
		SupportsSchedule: true,
		Capabilities: &jobs.ExecutorCapabilities{
			DefaultCreatePriority: 20,
			AutomationRef: &jobs.AutomationReferenceCapability{
				PayloadKey: "automationId",
				SourceType: "automation",
			},
		},
		Form: &jobs.ExecutorFormSpec{
			Fields: []jobs.ExecutorFormField{
				{
					Label:      "Automation",
					Hint:       "Choose the existing Automation resource that this job should run.",
					Purpose:    "automationRef",
					Kind:       "select",
					PayloadKey: "automationId",
					Required:   true,
					Group:      "target",
					DataSource: &jobs.ExecutorFormFieldDataSource{
						Kind:       "workspace_automations",
						AllowBlank: true,
						BlankLabel: "Select Automation",
					},
					Validation: &jobs.ExecutorFormFieldValidation{
						MinLength:              ptrAutomationInt(1),
						DisallowedPattern:      `^auto[_-]?0*1$`,
						DisallowedPatternFlags: "i",
						AllowSourceRefFallback: true,
					},
				},
				{
					Label:      "Model",
					Hint:       "Optional override for this job run. Leave blank to reuse the linked automation model.",
					Purpose:    "model",
					Kind:       "text",
					PayloadKey: "model",
					Advanced:   true,
					Group:      "overrides",
					DataSource: &jobs.ExecutorFormFieldDataSource{
						Kind:             "workspace_models",
						AllowBlank:       true,
						AllowCustomValue: true,
						BlankLabel:       "Reuse automation model",
					},
				},
				{
					Label:      "Reasoning",
					Hint:       "Optional reasoning override for this job run.",
					Purpose:    "reasoning",
					Kind:       "reasoning_select",
					PayloadKey: "reasoning",
					Advanced:   true,
					Group:      "overrides",
					Options: []jobs.ExecutorFormFieldOption{
						{Value: "low", Label: "Low"},
						{Value: "medium", Label: "Medium"},
						{Value: "high", Label: "High"},
						{Value: "xhigh", Label: "Extra High"},
					},
				},
			},
		},
		PayloadSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"automationId": map[string]any{
					"type":        "string",
					"description": "Automation resource identifier.",
				},
				"model": map[string]any{
					"type":        "string",
					"description": "Optional model override.",
				},
				"reasoning": map[string]any{
					"type":        "string",
					"description": "Optional reasoning override.",
				},
			},
			"required": []string{"automationId"},
		},
		ExamplePayload: map[string]any{},
	}
}

func (e jobExecutor) NormalizeCreateInput(input *jobs.CreateInput) error {
	if input == nil {
		return nil
	}
	if e.service == nil || e.service.store == nil {
		return errors.New("automation service is unavailable")
	}

	payload := cloneAutomationPayload(input.Payload)
	automationID := readAutomationPayloadString(payload, "automationId")
	sourceType := strings.TrimSpace(input.SourceType)
	sourceRefID := strings.TrimSpace(input.SourceRefID)

	switch {
	case sourceType != "" && !strings.EqualFold(sourceType, "automation"):
		return jobs.NewClassifiedError(
			jobs.ErrInvalidInput,
			"automation_run jobs must use sourceType automation",
			store.ErrorMetadata{
				Code:      "automation_run_source_type_invalid",
				Category:  "validation",
				Retryable: ptrAutomationBool(false),
				Details: map[string]string{
					"executorKind": "automation_run",
					"sourceType":   sourceType,
				},
			},
		)
	case automationID == "" && sourceRefID == "":
		return jobs.NewClassifiedError(
			jobs.ErrInvalidInput,
			"automation_run jobs require automationId or sourceRefId",
			store.ErrorMetadata{
				Code:      "automation_run_reference_required",
				Category:  "validation",
				Retryable: ptrAutomationBool(false),
				Details: map[string]string{
					"executorKind": "automation_run",
				},
			},
		)
	case automationID != "" && sourceRefID != "" && automationID != sourceRefID:
		return jobs.NewClassifiedError(
			jobs.ErrInvalidInput,
			"automation_run job sourceRefId must match payload automationId",
			store.ErrorMetadata{
				Code:      "automation_run_reference_mismatch",
				Category:  "validation",
				Retryable: ptrAutomationBool(false),
				Details: map[string]string{
					"executorKind": "automation_run",
					"sourceRefId":  sourceRefID,
					"automationId": automationID,
				},
			},
		)
	}

	resolvedAutomationID := firstNonEmpty(automationID, sourceRefID)
	automation, ok := e.service.store.GetAutomation(resolvedAutomationID)
	if !ok {
		return jobs.NewClassifiedError(
			store.ErrAutomationNotFound,
			"automation not found",
			store.ErrorMetadata{
				Code:      "automation_not_found",
				Category:  "reference",
				Retryable: ptrAutomationBool(false),
				Details: map[string]string{
					"executorKind": "automation_run",
					"automationId": resolvedAutomationID,
				},
			},
		)
	}
	if strings.TrimSpace(automation.WorkspaceID) != strings.TrimSpace(input.WorkspaceID) {
		return jobs.NewClassifiedError(
			jobs.ErrInvalidInput,
			"automation_run job workspaceId must match automation workspace",
			store.ErrorMetadata{
				Code:      "automation_run_workspace_mismatch",
				Category:  "validation",
				Retryable: ptrAutomationBool(false),
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

func (e jobExecutor) ValidateStoredJob(job store.BackgroundJob) error {
	return e.NormalizeCreateInput(&jobs.CreateInput{
		SourceType:   job.SourceType,
		SourceRefID:  job.SourceRefID,
		Name:         firstNonEmpty(strings.TrimSpace(job.Name), "automation_run"),
		WorkspaceID:  job.WorkspaceID,
		ExecutorKind: job.ExecutorKind,
		Schedule:     job.Schedule,
		Payload:      cloneAutomationPayload(job.Payload),
	})
}

func (e jobExecutor) Execute(ctx context.Context, request jobs.ExecutionRequest) (map[string]any, error) {
	if e.service == nil {
		return nil, errors.New("automation service is unavailable")
	}
	automationID := readAutomationPayloadString(request.Job.Payload, "automationId")
	if automationID == "" {
		automationID = strings.TrimSpace(request.Job.SourceRefID)
	}
	if automationID == "" {
		return nil, errors.New("automationId is required")
	}
	modelOverride := readAutomationPayloadString(request.Job.Payload, "model")
	reasoningOverride := readAutomationPayloadString(request.Job.Payload, "reasoning")

	run, err := e.service.executeFromJob(ctx, automationID, request.Run.Trigger, modelOverride, reasoningOverride)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"automationId": automationID,
		"runId":        run.ID,
		"summary":      run.Summary,
		"error":        run.Error,
	}, nil
}

func (s *Service) executeFromJob(
	ctx context.Context,
	automationID string,
	trigger string,
	modelOverride string,
	reasoningOverride string,
) (store.AutomationRun, error) {
	automation, ok := s.store.GetAutomation(automationID)
	if !ok {
		return store.AutomationRun{}, store.ErrAutomationNotFound
	}
	hydratedAutomation := s.hydrate(automation)
	if strings.TrimSpace(modelOverride) != "" {
		hydratedAutomation.Model = normalizeModel(modelOverride)
	}
	if strings.TrimSpace(reasoningOverride) != "" {
		hydratedAutomation.Reasoning = normalizeReasoning(reasoningOverride)
	}
	run, err := s.startRun(ctx, hydratedAutomation, firstNonEmpty(strings.TrimSpace(trigger), "schedule"))
	if err != nil {
		return store.AutomationRun{}, err
	}

	deadline := s.now().Add(s.runTimeout)
	for {
		current, ok := s.store.GetAutomationRun(run.ID)
		if ok && current.Status != "queued" && current.Status != "running" {
			return current, nil
		}
		if s.now().After(deadline) {
			return store.AutomationRun{}, errors.New("automation execution timed out")
		}
		finalized, finalizeErr := s.tryFinalizeRun(ctx, run.ID)
		if finalizeErr == nil && finalized {
			current, ok := s.store.GetAutomationRun(run.ID)
			if !ok {
				return store.AutomationRun{}, store.ErrAutomationRunNotFound
			}
			return current, nil
		}
		select {
		case <-ctx.Done():
			return store.AutomationRun{}, ctx.Err()
		case <-time.After(s.runPollInterval):
		}
	}
}

func readAutomationPayloadString(values map[string]any, key string) string {
	if len(values) == 0 {
		return ""
	}
	value, ok := values[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func cloneAutomationPayload(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func ptrAutomationBool(value bool) *bool {
	return &value
}

func ptrAutomationInt(value int) *int {
	return &value
}
