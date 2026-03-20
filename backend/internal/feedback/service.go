package feedback

import (
	"context"
	"errors"
	"strings"

	"codex-server/backend/internal/runtime"
)

type Service struct {
	runtimes *runtime.Manager
}

type UploadResult struct {
	ThreadID string `json:"threadId"`
}

func NewService(runtimeManager *runtime.Manager) *Service {
	return &Service{runtimes: runtimeManager}
}

func (s *Service) Upload(ctx context.Context, workspaceID string, classification string, includeLogs bool, reason string, threadID string, extraLogFiles []string) (UploadResult, error) {
	if strings.TrimSpace(classification) == "" {
		return UploadResult{}, errors.New("classification is required")
	}

	params := map[string]any{
		"classification": classification,
		"includeLogs":    includeLogs,
	}
	if reason != "" {
		params["reason"] = reason
	}
	if threadID != "" {
		params["threadId"] = threadID
	}
	if len(extraLogFiles) > 0 {
		params["extraLogFiles"] = extraLogFiles
	}

	var response UploadResult
	if err := s.runtimes.Call(ctx, workspaceID, "feedback/upload", params, &response); err != nil {
		return UploadResult{}, err
	}

	return response, nil
}
