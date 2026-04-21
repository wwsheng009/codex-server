package jobs

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turncapture"
	"codex-server/backend/internal/turns"
)

const (
	defaultPromptRunModel        = "gpt-5.4"
	defaultPromptRunReasoning    = "medium"
	defaultPromptRunTimeoutSec   = 1800
	maxPromptRunTimeoutSec       = 3600
	defaultPromptRunPollInterval = 2 * time.Second
	promptRunPreviewLimit        = 280
	promptRunMetadataOrigin      = "codex-server-jobs"
)

type promptRunThreadExecutor interface {
	Create(ctx context.Context, workspaceID string, input threads.CreateInput) (store.Thread, error)
	GetDetail(ctx context.Context, workspaceID string, threadID string) (store.ThreadDetail, error)
}

type promptRunTurnExecutor interface {
	Start(ctx context.Context, workspaceID string, threadID string, input string, options turns.StartOptions) (turns.Result, error)
}

type promptRunRunner struct {
	threads      promptRunThreadExecutor
	turns        promptRunTurnExecutor
	store        *store.MemoryStore
	now          func() time.Time
	pollInterval time.Duration
}

type promptRunPayload struct {
	Prompt     string
	Model      string
	Reasoning  string
	ThreadName string
	TimeoutSec int
}

func NewPromptRunRunner(
	threadExecutor promptRunThreadExecutor,
	turnExecutor promptRunTurnExecutor,
	dataStore *store.MemoryStore,
) Runner {
	return promptRunRunner{
		threads: threadExecutor,
		turns:   turnExecutor,
		store:   dataStore,
		now: func() time.Time {
			return time.Now().UTC()
		},
		pollInterval: defaultPromptRunPollInterval,
	}
}

func (r promptRunRunner) Definition() ExecutorDefinition {
	return ExecutorDefinition{
		Kind:             "prompt_run",
		Title:            "Prompt Run",
		Description:      "Run a prompt directly in the selected workspace without creating a separate Automation resource.",
		SupportsSchedule: true,
		Capabilities: &ExecutorCapabilities{
			DefaultCreatePriority: 100,
			Prompt: &PromptExecutorCapability{
				PromptKey:                "prompt",
				ModelKey:                 "model",
				ReasoningKey:             "reasoning",
				DefaultModel:             defaultPromptRunModel,
				DefaultReasoning:         defaultPromptRunReasoning,
				UseWorkspaceModelCatalog: true,
			},
		},
		Form: &ExecutorFormSpec{
			Fields: []ExecutorFormField{
				{
					Label:              "Prompt",
					Hint:               "Enter the prompt that should be sent when this job runs.",
					Placeholder:        "Summarize the latest repo changes and suggest next actions.",
					Purpose:            "prompt",
					Kind:               "textarea",
					PayloadKey:         "prompt",
					Required:           true,
					Group:              "prompt",
					Rows:               8,
					PreserveWhitespace: true,
					Validation: &ExecutorFormFieldValidation{
						MinLength: ptrInt(1),
					},
				},
				{
					Label:         "Model",
					Hint:          "Optional model override. Leave blank to use the executor default.",
					Placeholder:   defaultPromptRunModel,
					Purpose:       "model",
					Kind:          "text",
					PayloadKey:    "model",
					Group:         "model",
					DefaultString: defaultPromptRunModel,
					DataSource: &ExecutorFormFieldDataSource{
						Kind:             "workspace_models",
						AllowCustomValue: true,
					},
				},
				{
					Label:         "Reasoning",
					Hint:          "Optional reasoning override for this prompt run.",
					Purpose:       "reasoning",
					Kind:          "reasoning_select",
					PayloadKey:    "reasoning",
					Group:         "model",
					DefaultString: defaultPromptRunReasoning,
					Options: []ExecutorFormFieldOption{
						{Value: "low", Label: "Low"},
						{Value: "medium", Label: "Medium"},
						{Value: "high", Label: "High"},
						{Value: "xhigh", Label: "Extra High"},
					},
				},
				{
					Label:       "Thread Name",
					Hint:        "Leave blank to reuse the job name when this prompt run creates a thread.",
					Placeholder: "Nightly Prompt Review",
					Purpose:     "threadName",
					Kind:        "text",
					PayloadKey:  "threadName",
					Advanced:    true,
					Group:       "execution",
				},
				{
					Label:      "Timeout (Seconds)",
					Hint:       "Leave blank to use the executor default timeout. The backend caps this at 3600 seconds.",
					Purpose:    "timeoutSec",
					Kind:       "number",
					PayloadKey: "timeoutSec",
					Advanced:   true,
					Group:      "execution",
					Min:        ptrInt(1),
					Max:        ptrInt(maxPromptRunTimeoutSec),
					Step:       ptrInt(1),
					Validation: &ExecutorFormFieldValidation{
						IntegerOnly: true,
					},
				},
			},
		},
		PayloadSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"prompt": map[string]any{
					"type":        "string",
					"description": "Prompt text to send to the workspace runtime.",
				},
				"model": map[string]any{
					"type":        "string",
					"description": "Optional model override. Defaults to gpt-5.4.",
				},
				"reasoning": map[string]any{
					"type":        "string",
					"description": "Optional reasoning effort: low, medium, high, or xhigh. Defaults to medium.",
				},
				"threadName": map[string]any{
					"type":        "string",
					"description": "Optional thread name override. Defaults to the job name.",
				},
				"timeoutSec": map[string]any{
					"type":        "integer",
					"description": "Optional timeout in seconds. Defaults to 1800 and is capped at 3600.",
				},
			},
			"required": []string{"prompt"},
		},
		ExamplePayload: map[string]any{
			"prompt":    "Summarize the latest repo changes and suggest next actions.",
			"model":     defaultPromptRunModel,
			"reasoning": defaultPromptRunReasoning,
		},
	}
}

func (r promptRunRunner) NormalizeCreateInput(input *CreateInput) error {
	if input == nil {
		return nil
	}
	payload, _, err := r.normalizePayload(input.WorkspaceID, input.Name, input.Payload)
	if err != nil {
		return err
	}
	input.Payload = payload
	input.SourceType = ""
	input.SourceRefID = ""
	return nil
}

func (r promptRunRunner) ValidateStoredJob(job store.BackgroundJob) error {
	_, _, err := r.normalizePayload(job.WorkspaceID, job.Name, job.Payload)
	return err
}

func (r promptRunRunner) Execute(ctx context.Context, request ExecutionRequest) (map[string]any, error) {
	if r.threads == nil || r.turns == nil {
		return nil, r.newExecutionError(
			errors.New("prompt_run execution is unavailable"),
			"prompt_run execution is unavailable",
			"prompt_run_unavailable",
			"configuration",
			false,
			map[string]string{
				"executorKind": "prompt_run",
			},
		)
	}

	_, payload, err := r.normalizePayload(request.WorkspaceID, request.Job.Name, request.Job.Payload)
	if err != nil {
		return nil, err
	}

	runCtx := ctx
	cancel := func() {}
	if payload.TimeoutSec > 0 {
		runCtx, cancel = context.WithTimeout(ctx, time.Duration(payload.TimeoutSec)*time.Second)
	}
	defer cancel()

	startedAt := r.currentTime()
	threadName := firstNonEmpty(payload.ThreadName, strings.TrimSpace(request.Job.Name), "Background Job")
	promptPreview := summarizePromptRunPreview(payload.Prompt)

	thread, err := r.threads.Create(runCtx, request.WorkspaceID, threads.CreateInput{
		Name:               threadName,
		Model:              payload.Model,
		PermissionPreset:   "full-access",
		SessionStartSource: threads.ThreadStartSourceStartup,
	})
	duration := r.currentTime().Sub(startedAt)
	if err != nil {
		output := r.buildOutput(promptRunOutputOptions{
			OK:            false,
			Message:       firstNonEmpty(strings.TrimSpace(err.Error()), "Prompt run could not create a thread."),
			Error:         strings.TrimSpace(err.Error()),
			Model:         payload.Model,
			Reasoning:     payload.Reasoning,
			ThreadName:    threadName,
			Status:        "failed",
			Duration:      duration,
			TimeoutSec:    payload.TimeoutSec,
			PromptPreview: promptPreview,
		})
		return nil, withFailureOutput(r.classifyExecutionError(
			err,
			"Prompt run could not create a thread.",
			"prompt_run_thread_create_failed",
			map[string]string{
				"executorKind": "prompt_run",
				"threadName":   threadName,
				"timeoutSec":   strconv.Itoa(payload.TimeoutSec),
			},
		), output)
	}

	resolvedThreadName := firstNonEmpty(strings.TrimSpace(thread.Name), threadName)
	turnResult, err := r.turns.Start(runCtx, request.WorkspaceID, thread.ID, payload.Prompt, turns.StartOptions{
		Model:            payload.Model,
		ReasoningEffort:  payload.Reasoning,
		PermissionPreset: "full-access",
		ResponsesAPIClientMetadata: turns.StartMetadata{
			Source:      "job",
			Origin:      promptRunMetadataOrigin,
			WorkspaceID: request.WorkspaceID,
			ThreadID:    thread.ID,
		},
	})
	duration = r.currentTime().Sub(startedAt)
	if err != nil {
		output := r.buildOutput(promptRunOutputOptions{
			OK:            false,
			Message:       firstNonEmpty(strings.TrimSpace(err.Error()), "Prompt run could not start a turn."),
			Error:         strings.TrimSpace(err.Error()),
			Model:         payload.Model,
			Reasoning:     payload.Reasoning,
			ThreadID:      thread.ID,
			ThreadName:    resolvedThreadName,
			Status:        "failed",
			Duration:      duration,
			TimeoutSec:    payload.TimeoutSec,
			PromptPreview: promptPreview,
		})
		return nil, withFailureOutput(r.classifyExecutionError(
			err,
			"Prompt run could not start a turn.",
			"prompt_run_turn_start_failed",
			map[string]string{
				"executorKind": "prompt_run",
				"threadId":     thread.ID,
				"threadName":   resolvedThreadName,
				"timeoutSec":   strconv.Itoa(payload.TimeoutSec),
			},
		), output)
	}
	if strings.TrimSpace(turnResult.TurnID) == "" {
		output := r.buildOutput(promptRunOutputOptions{
			OK:            false,
			Message:       "Prompt run returned an empty turn id.",
			Error:         "Prompt run returned an empty turn id.",
			Model:         payload.Model,
			Reasoning:     payload.Reasoning,
			ThreadID:      thread.ID,
			ThreadName:    resolvedThreadName,
			Status:        "failed",
			Duration:      duration,
			TimeoutSec:    payload.TimeoutSec,
			PromptPreview: promptPreview,
		})
		return nil, withFailureOutput(
			r.newExecutionError(
				errors.New("prompt_run returned empty turn id"),
				"Prompt run returned an empty turn id.",
				"prompt_run_turn_id_empty",
				"execution",
				true,
				map[string]string{
					"executorKind": "prompt_run",
					"threadId":     thread.ID,
					"timeoutSec":   strconv.Itoa(payload.TimeoutSec),
				},
			),
			output,
		)
	}

	captured, err := r.waitForTurn(runCtx, request.WorkspaceID, thread.ID, turnResult.TurnID)
	duration = r.currentTime().Sub(startedAt)
	if err != nil {
		status := "failed"
		message := firstNonEmpty(strings.TrimSpace(err.Error()), "Prompt run did not finish successfully.")
		code := "prompt_run_poll_failed"
		category := "execution"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = "timeout"
			message = fmt.Sprintf("Prompt run timed out after %d seconds.", payload.TimeoutSec)
			code = "prompt_run_timeout"
			category = "timeout"
		case errors.Is(err, context.Canceled):
			status = "canceled"
			message = "Prompt run was canceled."
			code = "background_job_canceled"
			category = "canceled"
		case errors.Is(err, store.ErrThreadNotFound):
			message = "Prompt run thread was not found."
			code = "prompt_run_thread_not_found"
		}
		output := r.buildOutput(promptRunOutputOptions{
			OK:            false,
			Message:       message,
			Error:         message,
			Model:         payload.Model,
			Reasoning:     payload.Reasoning,
			ThreadID:      thread.ID,
			ThreadName:    resolvedThreadName,
			TurnID:        turnResult.TurnID,
			Status:        status,
			Duration:      duration,
			TimeoutSec:    payload.TimeoutSec,
			PromptPreview: promptPreview,
		})
		return nil, withFailureOutput(
			r.newExecutionError(
				err,
				message,
				code,
				category,
				true,
				map[string]string{
					"executorKind": "prompt_run",
					"threadId":     thread.ID,
					"turnId":       turnResult.TurnID,
					"timeoutSec":   strconv.Itoa(payload.TimeoutSec),
				},
			),
			output,
		)
	}

	summary := firstNonEmpty(captured.Summary, captured.AssistantText, captured.CommandOutput, captured.ReasoningText)
	output := r.buildOutput(promptRunOutputOptions{
		OK:                captured.FailureMessage() == "",
		Message:           firstNonEmpty(captured.FailureMessage(), "Prompt run completed successfully."),
		Model:             payload.Model,
		Reasoning:         payload.Reasoning,
		ThreadID:          thread.ID,
		ThreadName:        resolvedThreadName,
		TurnID:            turnResult.TurnID,
		Status:            firstNonEmpty(captured.Status, "completed"),
		Summary:           summary,
		AssistantText:     captured.AssistantText,
		ReasoningText:     captured.ReasoningText,
		CommandOutput:     captured.CommandOutput,
		Duration:          duration,
		TimeoutSec:        payload.TimeoutSec,
		SubagentThreadIDs: captured.SubagentThreadIDs,
		SubagentTurnIDs:   captured.SubagentTurnIDs,
		PromptPreview:     promptPreview,
	})
	if failureMessage := captured.FailureMessage(); failureMessage != "" {
		output["error"] = failureMessage
		return nil, withFailureOutput(
			r.newExecutionError(
				errors.New(failureMessage),
				failureMessage,
				"prompt_run_turn_failed",
				"execution",
				true,
				map[string]string{
					"executorKind": "prompt_run",
					"threadId":     thread.ID,
					"turnId":       turnResult.TurnID,
				},
			),
			output,
		)
	}

	return output, nil
}

func (r promptRunRunner) waitForTurn(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnID string,
) (turncapture.Result, error) {
	pollInterval := r.pollInterval
	if pollInterval <= 0 {
		pollInterval = defaultPromptRunPollInterval
	}

	for {
		detail, err := r.threads.GetDetail(ctx, workspaceID, threadID)
		if err != nil {
			return turncapture.Result{}, err
		}
		if turn, ok := findPromptRunTurn(detail, turnID); ok {
			captured := turncapture.FromTurn(threadID, turnID, turn)
			if captured.Terminal {
				return captured, nil
			}
		}

		timer := time.NewTimer(pollInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return turncapture.Result{}, ctx.Err()
		case <-timer.C:
		}
	}
}

func (r promptRunRunner) normalizePayload(
	workspaceID string,
	jobName string,
	payload map[string]any,
) (map[string]any, promptRunPayload, error) {
	if err := r.ensureWorkspaceExists(workspaceID); err != nil {
		return nil, promptRunPayload{}, err
	}

	normalized := cloneAnyMap(payload)
	if normalized == nil {
		normalized = map[string]any{}
	}

	prompt := readString(normalized, "prompt")
	if prompt == "" {
		return nil, promptRunPayload{}, r.newValidationError(
			ErrInvalidInput,
			"prompt_run_prompt_required",
			"prompt_run jobs require payload.prompt",
			map[string]string{
				"executorKind": "prompt_run",
			},
		)
	}

	model := normalizePromptRunModel(readString(normalized, "model"))
	reasoning, err := normalizePromptRunReasoning(readString(normalized, "reasoning"))
	if err != nil {
		return nil, promptRunPayload{}, r.newValidationError(
			err,
			"prompt_run_reasoning_invalid",
			err.Error(),
			map[string]string{
				"executorKind": "prompt_run",
			},
		)
	}

	timeoutSec, err := normalizePromptRunTimeout(normalized["timeoutSec"])
	if err != nil {
		return nil, promptRunPayload{}, r.newValidationError(
			err,
			"prompt_run_timeout_invalid",
			err.Error(),
			map[string]string{
				"executorKind": "prompt_run",
			},
		)
	}

	threadNameInput := readString(normalized, "threadName")
	threadName := firstNonEmpty(threadNameInput, strings.TrimSpace(jobName), "Background Job")

	normalized["prompt"] = prompt
	normalized["model"] = model
	normalized["reasoning"] = reasoning
	normalized["timeoutSec"] = timeoutSec
	normalized["threadName"] = threadName

	return normalized, promptRunPayload{
		Prompt:     prompt,
		Model:      model,
		Reasoning:  reasoning,
		ThreadName: threadName,
		TimeoutSec: timeoutSec,
	}, nil
}

func (r promptRunRunner) ensureWorkspaceExists(workspaceID string) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return ErrInvalidInput
	}
	if r.store == nil {
		return nil
	}
	if _, ok := r.store.GetWorkspace(workspaceID); !ok {
		return store.ErrWorkspaceNotFound
	}
	return nil
}

func normalizePromptRunModel(value string) string {
	if strings.TrimSpace(value) == "" {
		return defaultPromptRunModel
	}
	return strings.TrimSpace(value)
}

func normalizePromptRunReasoning(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "medium":
		return defaultPromptRunReasoning, nil
	case "low", "high", "xhigh":
		return strings.ToLower(strings.TrimSpace(value)), nil
	default:
		return "", errors.New("reasoning must be one of low, medium, high, or xhigh")
	}
}

func normalizePromptRunTimeout(value any) (int, error) {
	switch typed := value.(type) {
	case nil:
		return defaultPromptRunTimeoutSec, nil
	case int:
		return validatePromptRunTimeout(typed)
	case int8:
		return validatePromptRunTimeout(int(typed))
	case int16:
		return validatePromptRunTimeout(int(typed))
	case int32:
		return validatePromptRunTimeout(int(typed))
	case int64:
		return validatePromptRunTimeout(int(typed))
	case float32:
		if math.IsNaN(float64(typed)) || math.IsInf(float64(typed), 0) || math.Trunc(float64(typed)) != float64(typed) {
			return 0, errors.New("timeoutSec must be an integer")
		}
		return validatePromptRunTimeout(int(typed))
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || math.Trunc(typed) != typed {
			return 0, errors.New("timeoutSec must be an integer")
		}
		return validatePromptRunTimeout(int(typed))
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return defaultPromptRunTimeoutSec, nil
		}
		parsed, err := strconv.Atoi(trimmed)
		if err != nil {
			return 0, errors.New("timeoutSec must be an integer")
		}
		return validatePromptRunTimeout(parsed)
	default:
		return 0, errors.New("timeoutSec must be an integer")
	}
}

func validatePromptRunTimeout(value int) (int, error) {
	if value <= 0 {
		return 0, errors.New("timeoutSec must be greater than 0")
	}
	if value > maxPromptRunTimeoutSec {
		return 0, fmt.Errorf("timeoutSec must not exceed %d", maxPromptRunTimeoutSec)
	}
	return value, nil
}

func findPromptRunTurn(detail store.ThreadDetail, turnID string) (store.ThreadTurn, bool) {
	for _, turn := range detail.Turns {
		if strings.TrimSpace(turn.ID) == strings.TrimSpace(turnID) {
			return turn, true
		}
	}
	return store.ThreadTurn{}, false
}

type promptRunOutputOptions struct {
	OK                bool
	Message           string
	Error             string
	Model             string
	Reasoning         string
	ThreadID          string
	TurnID            string
	ThreadName        string
	Status            string
	Summary           string
	AssistantText     string
	ReasoningText     string
	CommandOutput     string
	Duration          time.Duration
	TimeoutSec        int
	SubagentThreadIDs []string
	SubagentTurnIDs   []string
	PromptPreview     string
}

func (r promptRunRunner) buildOutput(options promptRunOutputOptions) map[string]any {
	output := map[string]any{
		"ok":            options.OK,
		"message":       strings.TrimSpace(options.Message),
		"model":         strings.TrimSpace(options.Model),
		"reasoning":     strings.TrimSpace(options.Reasoning),
		"threadId":      strings.TrimSpace(options.ThreadID),
		"turnId":        strings.TrimSpace(options.TurnID),
		"threadName":    strings.TrimSpace(options.ThreadName),
		"status":        strings.TrimSpace(options.Status),
		"summary":       strings.TrimSpace(options.Summary),
		"assistantText": strings.TrimSpace(options.AssistantText),
		"reasoningText": strings.TrimSpace(options.ReasoningText),
		"commandOutput": strings.TrimSpace(options.CommandOutput),
		"durationMs":    options.Duration.Milliseconds(),
		"timeoutSec":    options.TimeoutSec,
		"promptPreview": strings.TrimSpace(options.PromptPreview),
	}
	if strings.TrimSpace(options.Error) != "" {
		output["error"] = strings.TrimSpace(options.Error)
	}
	if len(options.SubagentThreadIDs) > 0 {
		output["subagentThreadIds"] = append([]string(nil), options.SubagentThreadIDs...)
	}
	if len(options.SubagentTurnIDs) > 0 {
		output["subagentTurnIds"] = append([]string(nil), options.SubagentTurnIDs...)
	}
	if len(options.SubagentThreadIDs) > 0 || len(options.SubagentTurnIDs) > 0 {
		output["subagentIds"] = map[string]any{
			"threadIds": append([]string(nil), options.SubagentThreadIDs...),
			"turnIds":   append([]string(nil), options.SubagentTurnIDs...),
		}
	}
	return output
}

func summarizePromptRunPreview(prompt string) string {
	text := strings.TrimSpace(prompt)
	if text == "" {
		return ""
	}
	if newline := strings.Index(text, "\n"); newline >= 0 {
		text = text[:newline]
	}
	runes := []rune(text)
	if len(runes) <= promptRunPreviewLimit {
		return text
	}
	return strings.TrimSpace(string(runes[:promptRunPreviewLimit])) + "..."
}

func (r promptRunRunner) currentTime() time.Time {
	if r.now != nil {
		return r.now().UTC()
	}
	return time.Now().UTC()
}

func (r promptRunRunner) newValidationError(cause error, code string, message string, details map[string]string) error {
	if strings.TrimSpace(message) == "" && cause != nil {
		message = cause.Error()
	}
	return NewClassifiedError(ErrInvalidInput, message, store.ErrorMetadata{
		Code:      strings.TrimSpace(code),
		Category:  "validation",
		Retryable: ptrBool(false),
		Details:   cloneStringMap(details),
	})
}

func (r promptRunRunner) newExecutionError(
	cause error,
	message string,
	code string,
	category string,
	retryable bool,
	details map[string]string,
) error {
	return NewClassifiedError(cause, message, store.ErrorMetadata{
		Code:      strings.TrimSpace(code),
		Category:  strings.TrimSpace(category),
		Retryable: ptrBool(retryable),
		Details:   cloneStringMap(details),
	})
}

func (r promptRunRunner) classifyExecutionError(
	err error,
	fallbackMessage string,
	fallbackCode string,
	details map[string]string,
) error {
	switch {
	case errors.Is(err, context.Canceled):
		return err
	case errors.Is(err, context.DeadlineExceeded):
		timeoutMessage := "Prompt run timed out."
		if timeoutSec := strings.TrimSpace(details["timeoutSec"]); timeoutSec != "" {
			timeoutMessage = "Prompt run timed out after " + timeoutSec + " seconds."
		}
		return r.newExecutionError(
			err,
			timeoutMessage,
			"prompt_run_timeout",
			"timeout",
			true,
			details,
		)
	case errors.Is(err, appRuntime.ErrRuntimeNotConfigured):
		return r.newExecutionError(
			err,
			"workspace runtime is not configured",
			"workspace_runtime_not_configured",
			"configuration",
			false,
			details,
		)
	case errors.Is(err, store.ErrThreadNotFound):
		return r.newExecutionError(
			err,
			firstNonEmpty(fallbackMessage, "Prompt run thread was not found."),
			firstNonEmpty(fallbackCode, "prompt_run_thread_not_found"),
			"execution",
			true,
			details,
		)
	default:
		return r.newExecutionError(
			err,
			firstNonEmpty(strings.TrimSpace(err.Error()), fallbackMessage, "Prompt run execution failed."),
			firstNonEmpty(fallbackCode, "prompt_run_execution_failed"),
			"execution",
			true,
			details,
		)
	}
}
