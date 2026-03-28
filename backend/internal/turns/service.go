package turns

import (
	"context"
	"errors"
	"strings"
	"time"

	"codex-server/backend/internal/bridge"
	appconfig "codex-server/backend/internal/config"
	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	runtimes *runtime.Manager
	store    *store.MemoryStore
}

type StartOptions struct {
	Model             string
	ReasoningEffort   string
	PermissionPreset  string
	CollaborationMode string
}

type Result struct {
	TurnID string `json:"turnId"`
	Status string `json:"status"`
}

const interruptRuntimeCallTimeout = 5 * time.Second

type turnStartResponse struct {
	Turn struct {
		ID string `json:"id"`
	} `json:"turn"`
}

func NewService(runtimeManager *runtime.Manager, dataStore *store.MemoryStore) *Service {
	return &Service{
		runtimes: runtimeManager,
		store:    dataStore,
	}
}

func (s *Service) Start(ctx context.Context, workspaceID string, threadID string, input string, options StartOptions) (Result, error) {
	if strings.TrimSpace(input) == "" {
		return Result{}, errors.New("turn input is required")
	}

	response, err := s.startTurn(ctx, workspaceID, threadID, input, options)
	if err != nil {
		if !isThreadResumeRequired(err) {
			return Result{}, err
		}
		diagnostics.LogThreadTrace(
			workspaceID,
			threadID,
			"turn/start requires thread resume",
			"error",
			err,
		)

		if err := s.resumeThread(ctx, workspaceID, threadID); err != nil {
			diagnostics.LogThreadTrace(
				workspaceID,
				threadID,
				"thread/resume failed before retrying turn/start",
				"error",
				err,
			)
			return Result{}, err
		}
		diagnostics.LogThreadTrace(workspaceID, threadID, "thread/resume completed, retrying turn/start")

		response, err = s.startTurn(ctx, workspaceID, threadID, input, options)
		if err != nil {
			return Result{}, err
		}
	}

	s.runtimes.RememberActiveTurn(workspaceID, threadID, response.Turn.ID)

	return Result{
		TurnID: response.Turn.ID,
		Status: "running",
	}, nil
}

func (s *Service) startTurn(ctx context.Context, workspaceID string, threadID string, input string, options StartOptions) (turnStartResponse, error) {
	var response turnStartResponse

	payload, err := s.buildRuntimeTurnStartPayload(ctx, workspaceID, threadID, input, options)
	if err != nil {
		return turnStartResponse{}, err
	}
	diagnostics.LogThreadTrace(
		workspaceID,
		threadID,
		"turn/start requested",
		diagnostics.TurnStartTraceAttrs(payload)...,
	)

	if err := s.runtimes.Call(ctx, workspaceID, "turn/start", payload, &response); err != nil {
		diagnostics.LogThreadTrace(
			workspaceID,
			threadID,
			"turn/start failed",
			append(
				diagnostics.TurnStartTraceAttrs(payload),
				"error",
				err,
			)...,
		)
		return turnStartResponse{}, err
	}
	diagnostics.LogThreadTrace(
		workspaceID,
		threadID,
		"turn/start acknowledged",
		append(
			diagnostics.TurnStartTraceAttrs(payload),
			"turnId",
			response.Turn.ID,
		)...,
	)

	return response, nil
}

func (s *Service) buildRuntimeTurnStartPayload(
	ctx context.Context,
	workspaceID string,
	threadID string,
	input string,
	options StartOptions,
) (map[string]any, error) {
	collaborationMode, err := s.resolveCollaborationMode(ctx, workspaceID, options)
	if err != nil {
		return nil, err
	}

	defaults, err := s.runtimeDefaults()
	if err != nil {
		return nil, err
	}

	return buildTurnStartPayloadWithRuntimeDefaults(threadID, input, options, collaborationMode, defaults), nil
}

func buildTurnStartPayload(
	threadID string,
	input string,
	options StartOptions,
	collaborationMode map[string]any,
) map[string]any {
	return buildTurnStartPayloadWithRuntimeDefaults(threadID, input, options, collaborationMode, runtimeDefaults{})
}

type runtimeDefaults struct {
	ApprovalPolicy string
	SandboxPolicy  map[string]any
}

func buildTurnStartPayloadWithRuntimeDefaults(
	threadID string,
	input string,
	options StartOptions,
	collaborationMode map[string]any,
	defaults runtimeDefaults,
) map[string]any {
	payload := map[string]any{
		"input": []map[string]any{
			{
				"text": input,
				"type": "text",
			},
		},
		"threadId": threadID,
	}

	if collaborationMode != nil {
		payload["collaborationMode"] = collaborationMode
	} else {
		if model := strings.TrimSpace(options.Model); model != "" {
			payload["model"] = model
		}

		switch normalizeReasoningEffort(options.ReasoningEffort) {
		case "low", "medium", "high", "xhigh":
			payload["effort"] = normalizeReasoningEffort(options.ReasoningEffort)
		}
	}

	if approvalPolicy := appconfig.ApprovalPolicyJSONValue(defaults.ApprovalPolicy); approvalPolicy != "" {
		payload["approvalPolicy"] = approvalPolicy
	}
	if len(defaults.SandboxPolicy) > 0 {
		payload["sandboxPolicy"] = defaults.SandboxPolicy
	}

	switch normalizePermissionPreset(options.PermissionPreset) {
	case "full-access":
		payload["approvalPolicy"] = "never"
		payload["sandboxPolicy"] = map[string]any{
			"type": "dangerFullAccess",
		}
	}

	return payload
}

func (s *Service) runtimeDefaults() (runtimeDefaults, error) {
	if s.store == nil {
		return runtimeDefaults{}, nil
	}

	prefs := s.store.GetRuntimePreferences()
	approvalPolicy, err := appconfig.NormalizeApprovalPolicy(prefs.DefaultTurnApprovalPolicy)
	if err != nil {
		return runtimeDefaults{}, err
	}
	sandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(prefs.DefaultTurnSandboxPolicy)
	if err != nil {
		return runtimeDefaults{}, err
	}

	return runtimeDefaults{
		ApprovalPolicy: approvalPolicy,
		SandboxPolicy:  sandboxPolicy,
	}, nil
}

type collaborationModePreset struct {
	Name            string
	Mode            string
	Model           string
	ReasoningEffort *string
}

func (s *Service) resolveCollaborationMode(
	ctx context.Context,
	workspaceID string,
	options StartOptions,
) (map[string]any, error) {
	mode := normalizeCollaborationMode(options.CollaborationMode)
	if mode == "default" {
		return nil, nil
	}

	presets, err := s.listCollaborationModePresets(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	var preset *collaborationModePreset
	for index := range presets {
		if presets[index].Mode == mode {
			preset = &presets[index]
			break
		}
	}
	if preset == nil {
		return nil, errors.New("collaboration mode " + mode + " is not available")
	}

	return buildCollaborationModePayload(mode, options, *preset)
}

func (s *Service) listCollaborationModePresets(
	ctx context.Context,
	workspaceID string,
) ([]collaborationModePreset, error) {
	var response struct {
		Data []struct {
			Name            string  `json:"name"`
			Mode            *string `json:"mode"`
			Model           *string `json:"model"`
			ReasoningEffort *string `json:"reasoning_effort"`
		} `json:"data"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "collaborationMode/list", map[string]any{}, &response); err != nil {
		return nil, err
	}

	items := make([]collaborationModePreset, 0, len(response.Data))
	for _, entry := range response.Data {
		items = append(items, collaborationModePreset{
			Name:            strings.TrimSpace(entry.Name),
			Mode:            normalizeCollaborationMode(stringPointerValue(entry.Mode)),
			Model:           strings.TrimSpace(stringPointerValue(entry.Model)),
			ReasoningEffort: trimStringPointer(entry.ReasoningEffort),
		})
	}

	return items, nil
}

func buildCollaborationModePayload(
	mode string,
	options StartOptions,
	preset collaborationModePreset,
) (map[string]any, error) {
	model := strings.TrimSpace(options.Model)
	if model == "" {
		model = strings.TrimSpace(preset.Model)
	}
	if model == "" {
		return nil, errors.New("collaboration mode " + mode + " requires a model")
	}

	settings := map[string]any{
		"developer_instructions": nil,
		"model":                  model,
	}

	reasoningEffort := ""
	if strings.TrimSpace(options.ReasoningEffort) != "" {
		reasoningEffort = normalizeReasoningEffort(options.ReasoningEffort)
	} else if preset.ReasoningEffort != nil {
		reasoningEffort = normalizeReasoningEffort(*preset.ReasoningEffort)
	}

	if reasoningEffort != "" {
		settings["reasoning_effort"] = reasoningEffort
	}

	return map[string]any{
		"mode":     mode,
		"settings": settings,
	}, nil
}

func normalizeReasoningEffort(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "low":
		return "low"
	case "high":
		return "high"
	case "xhigh":
		return "xhigh"
	default:
		return "medium"
	}
}

func normalizePermissionPreset(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "full-access":
		return "full-access"
	default:
		return "default"
	}
}

func normalizeCollaborationMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "plan":
		return "plan"
	default:
		return "default"
	}
}

func stringPointerValue(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}

func trimStringPointer(value *string) *string {
	if value == nil {
		return nil
	}

	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}

	return &trimmed
}

func (s *Service) Steer(ctx context.Context, workspaceID string, threadID string, input string) (Result, error) {
	if strings.TrimSpace(input) == "" {
		return Result{}, errors.New("steer input is required")
	}

	turnID := s.runtimes.ActiveTurnID(workspaceID, threadID)
	if turnID == "" {
		return Result{}, runtime.ErrNoActiveTurn
	}

	var response struct {
		TurnID string `json:"turnId"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "turn/steer", map[string]any{
		"expectedTurnId": turnID,
		"input": []map[string]any{
			{
				"text": input,
				"type": "text",
			},
		},
		"threadId": threadID,
	}, &response); err != nil {
		return Result{}, err
	}

	return Result{
		TurnID: response.TurnID,
		Status: "steered",
	}, nil
}

func (s *Service) Interrupt(ctx context.Context, workspaceID string, threadID string) (Result, error) {
	turnID := s.runtimes.ActiveTurnID(workspaceID, threadID)
	if turnID == "" {
		return Result{
			TurnID: "",
			Status: "interrupted",
		}, nil
	}

	callCtx, cancel, timeoutApplied := runtimeCallContext(ctx, interruptRuntimeCallTimeout)
	defer cancel()

	if err := s.runtimes.Call(callCtx, workspaceID, "turn/interrupt", map[string]any{
		"threadId": threadID,
		"turnId":   turnID,
	}, nil); err != nil {
		if errors.Is(err, runtime.ErrNoActiveTurn) {
			s.runtimes.RememberActiveTurn(workspaceID, threadID, "")
			return Result{
				TurnID: "",
				Status: "interrupted",
			}, nil
		}
		if runtimeCallTimedOut(err, timeoutApplied) {
			s.runtimes.Recycle(workspaceID)
			return Result{
				TurnID: turnID,
				Status: "interrupted",
			}, nil
		}
		return Result{}, err
	}

	s.runtimes.RememberActiveTurn(workspaceID, threadID, "")

	return Result{
		TurnID: turnID,
		Status: "interrupted",
	}, nil
}

func runtimeCallContext(
	ctx context.Context,
	timeout time.Duration,
) (context.Context, context.CancelFunc, bool) {
	if timeout <= 0 {
		callCtx, cancel := context.WithCancel(ctx)
		return callCtx, cancel, false
	}

	if deadline, ok := ctx.Deadline(); ok {
		if time.Until(deadline) <= timeout {
			callCtx, cancel := context.WithCancel(ctx)
			return callCtx, cancel, false
		}
	}

	callCtx, cancel := context.WithTimeout(ctx, timeout)
	return callCtx, cancel, true
}

func runtimeCallTimedOut(err error, timeoutApplied bool) bool {
	return timeoutApplied && errors.Is(err, context.DeadlineExceeded)
}

func (s *Service) Review(ctx context.Context, workspaceID string, threadID string) (Result, error) {
	response, err := s.startReview(ctx, workspaceID, threadID)
	if err != nil {
		if !isThreadResumeRequired(err) {
			return Result{}, err
		}

		if err := s.resumeThread(ctx, workspaceID, threadID); err != nil {
			return Result{}, err
		}

		response, err = s.startReview(ctx, workspaceID, threadID)
		if err != nil {
			return Result{}, err
		}
	}

	return Result{
		TurnID: response.Turn.ID,
		Status: "reviewing",
	}, nil
}

func (s *Service) startReview(ctx context.Context, workspaceID string, threadID string) (turnStartResponse, error) {
	var response turnStartResponse

	if err := s.runtimes.Call(ctx, workspaceID, "review/start", map[string]any{
		"delivery": "inline",
		"target": map[string]any{
			"type": "uncommittedChanges",
		},
		"threadId": threadID,
	}, &response); err != nil {
		return turnStartResponse{}, err
	}

	return response, nil
}

func (s *Service) resumeThread(ctx context.Context, workspaceID string, threadID string) error {
	var response struct {
		Thread map[string]any `json:"thread"`
	}

	diagnostics.LogThreadTrace(workspaceID, threadID, "thread/resume requested")
	err := s.runtimes.Call(ctx, workspaceID, "thread/resume", map[string]any{
		"cwd":      s.runtimes.RootPath(workspaceID),
		"threadId": threadID,
	}, &response)
	if err != nil {
		return err
	}
	diagnostics.LogThreadTrace(
		workspaceID,
		threadID,
		"thread/resume acknowledged",
		"responseFieldCount",
		len(response.Thread),
	)
	return nil
}

func isThreadResumeRequired(err error) bool {
	var rpcErr *bridge.RPCError
	if !errors.As(err, &rpcErr) {
		return false
	}

	if rpcErr.Code != -32600 {
		return false
	}

	message := strings.ToLower(strings.TrimSpace(rpcErr.Message))
	return strings.Contains(message, "thread not loaded") ||
		strings.Contains(message, "thread not found")
}
