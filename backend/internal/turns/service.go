package turns

import (
	"context"
	"errors"
	"strings"

	"codex-server/backend/internal/bridge"
	"codex-server/backend/internal/runtime"
)

type Service struct {
	runtimes *runtime.Manager
}

type StartOptions struct {
	Model            string
	ReasoningEffort  string
	PermissionPreset string
}

type Result struct {
	TurnID string `json:"turnId"`
	Status string `json:"status"`
}

type turnStartResponse struct {
	Turn struct {
		ID string `json:"id"`
	} `json:"turn"`
}

func NewService(runtimeManager *runtime.Manager) *Service {
	return &Service{runtimes: runtimeManager}
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

		if err := s.resumeThread(ctx, workspaceID, threadID); err != nil {
			return Result{}, err
		}

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

	if err := s.runtimes.Call(ctx, workspaceID, "turn/start", buildTurnStartPayload(threadID, input, options), &response); err != nil {
		return turnStartResponse{}, err
	}

	return response, nil
}

func buildTurnStartPayload(threadID string, input string, options StartOptions) map[string]any {
	payload := map[string]any{
		"input": []map[string]any{
			{
				"text": input,
				"type": "text",
			},
		},
		"threadId": threadID,
	}

	if model := strings.TrimSpace(options.Model); model != "" {
		payload["model"] = model
	}

	switch normalizeReasoningEffort(options.ReasoningEffort) {
	case "low", "medium", "high", "xhigh":
		payload["effort"] = normalizeReasoningEffort(options.ReasoningEffort)
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
		return Result{}, runtime.ErrNoActiveTurn
	}

	if err := s.runtimes.Call(ctx, workspaceID, "turn/interrupt", map[string]any{
		"threadId": threadID,
		"turnId":   turnID,
	}, nil); err != nil {
		return Result{}, err
	}

	s.runtimes.RememberActiveTurn(workspaceID, threadID, "")

	return Result{
		TurnID: turnID,
		Status: "interrupted",
	}, nil
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

	return s.runtimes.Call(ctx, workspaceID, "thread/resume", map[string]any{
		"cwd":      s.runtimes.RootPath(workspaceID),
		"threadId": threadID,
	}, &response)
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
