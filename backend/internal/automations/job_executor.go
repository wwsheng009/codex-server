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

func NewJobExecutor(service *Service) jobs.Executor {
	return jobExecutor{service: service}
}

func (e jobExecutor) Definition() jobs.ExecutorDefinition {
	return jobs.ExecutorDefinition{
		Kind:             "automation_run",
		Title:            "Automation Run",
		Description:      "Execute an automation prompt through the unified background job framework.",
		SupportsSchedule: true,
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
		ExamplePayload: map[string]any{
			"automationId": "auto_001",
		},
	}
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

	run, err := e.service.executeFromJob(ctx, automationID, request.Run.Trigger)
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

func (s *Service) executeFromJob(ctx context.Context, automationID string, trigger string) (store.AutomationRun, error) {
	automation, ok := s.store.GetAutomation(automationID)
	if !ok {
		return store.AutomationRun{}, store.ErrAutomationNotFound
	}
	run, err := s.startRun(ctx, s.hydrate(automation), firstNonEmpty(strings.TrimSpace(trigger), "schedule"))
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
