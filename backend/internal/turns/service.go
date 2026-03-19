package turns

import (
	"context"
	"errors"
	"strings"

	"codex-server/backend/internal/runtime"
)

type Service struct {
	runtimes *runtime.Manager
}

type Result struct {
	TurnID string `json:"turnId"`
	Status string `json:"status"`
}

func NewService(runtimeManager *runtime.Manager) *Service {
	return &Service{runtimes: runtimeManager}
}

func (s *Service) Start(ctx context.Context, workspaceID string, threadID string, input string) (Result, error) {
	if strings.TrimSpace(input) == "" {
		return Result{}, errors.New("turn input is required")
	}

	var response struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "turn/start", map[string]any{
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

	s.runtimes.RememberActiveTurn(workspaceID, threadID, response.Turn.ID)

	return Result{
		TurnID: response.Turn.ID,
		Status: "running",
	}, nil
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
	var response struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "review/start", map[string]any{
		"delivery": "inline",
		"target": map[string]any{
			"type": "uncommittedChanges",
		},
		"threadId": threadID,
	}, &response); err != nil {
		return Result{}, err
	}

	return Result{
		TurnID: response.Turn.ID,
		Status: "reviewing",
	}, nil
}
