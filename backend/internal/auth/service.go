package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store    *store.MemoryStore
	runtimes *runtime.Manager
}

var ErrInvalidLoginInput = errors.New("invalid login input")

type LoginInput struct {
	Type   string `json:"type"`
	APIKey string `json:"apiKey,omitempty"`
}

type LoginResult struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	AuthURL string `json:"authUrl,omitempty"`
	LoginID string `json:"loginId,omitempty"`
	Message string `json:"message,omitempty"`
}

func NewService(dataStore *store.MemoryStore, runtimeManager *runtime.Manager) *Service {
	return &Service{
		store:    dataStore,
		runtimes: runtimeManager,
	}
}

func (s *Service) CurrentAccount(ctx context.Context) (store.Account, error) {
	workspaceID := s.primaryWorkspaceID()
	if workspaceID == "" {
		return disconnectedAccount(), nil
	}

	var response struct {
		Account            map[string]any `json:"account"`
		RequiresOpenAIAuth bool           `json:"requiresOpenaiAuth"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "account/read", map[string]any{}, &response); err != nil {
		return store.Account{}, err
	}

	accountType := stringValue(response.Account["type"])
	status := "connected"
	if response.RequiresOpenAIAuth {
		status = "requires_openai_auth"
	}
	if accountType == "" {
		status = "disconnected"
	}

	email := stringValue(response.Account["email"])
	if email == "" {
		email = accountType
	}
	if email == "" {
		email = "unknown"
	}

	return store.Account{
		ID:           "acct_runtime",
		Email:        email,
		Status:       status,
		LastSyncedAt: time.Now().UTC(),
	}, nil
}

func (s *Service) RateLimits(ctx context.Context) ([]store.RateLimit, error) {
	workspaceID := s.primaryWorkspaceID()
	if workspaceID == "" {
		return nil, nil
	}

	var response struct {
		RateLimits []map[string]any `json:"rateLimits"`
	}

	err := s.runtimes.Call(ctx, workspaceID, "account/rateLimits/read", map[string]any{}, &response)
	if err != nil {
		if strings.Contains(err.Error(), "authentication required") {
			return nil, nil
		}
		return nil, err
	}

	items := make([]store.RateLimit, 0, len(response.RateLimits))
	for _, limit := range response.RateLimits {
		items = append(items, store.RateLimit{
			Name:      fallbackString(stringValue(limit["name"]), stringValue(limit["limitId"])),
			Limit:     intValue(limit["limit"]),
			Remaining: intValue(limit["remaining"]),
			ResetsAt:  time.Now().UTC(),
		})
	}

	return items, nil
}

func (s *Service) Logout(ctx context.Context) error {
	workspaceID := s.primaryWorkspaceID()
	if workspaceID == "" {
		return nil
	}

	return s.runtimes.Call(ctx, workspaceID, "account/logout", map[string]any{}, nil)
}

func (s *Service) Login(ctx context.Context, input LoginInput) (LoginResult, error) {
	workspaceID := s.primaryWorkspaceID()
	if workspaceID == "" {
		return LoginResult{}, runtime.ErrRuntimeNotConfigured
	}

	switch input.Type {
	case "apiKey":
		if strings.TrimSpace(input.APIKey) == "" {
			return LoginResult{}, fmt.Errorf("%w: apiKey is required", ErrInvalidLoginInput)
		}

		var response struct {
			Type string `json:"type"`
		}

		if err := s.runtimes.Call(ctx, workspaceID, "account/login/start", map[string]any{
			"apiKey": input.APIKey,
			"type":   "apiKey",
		}, &response); err != nil {
			return LoginResult{}, err
		}

		return LoginResult{
			Type:    response.Type,
			Status:  "submitted",
			Message: "API key submitted to Codex runtime",
		}, nil
	case "chatgpt":
		var response struct {
			Type    string `json:"type"`
			AuthURL string `json:"authUrl"`
			LoginID string `json:"loginId"`
		}

		if err := s.runtimes.Call(ctx, workspaceID, "account/login/start", map[string]any{
			"type": "chatgpt",
		}, &response); err != nil {
			return LoginResult{}, err
		}

		return LoginResult{
			Type:    response.Type,
			Status:  "pending",
			AuthURL: response.AuthURL,
			LoginID: response.LoginID,
			Message: "Open the returned URL to complete ChatGPT login",
		}, nil
	default:
		return LoginResult{}, fmt.Errorf("%w: unsupported login type", ErrInvalidLoginInput)
	}
}

func (s *Service) primaryWorkspaceID() string {
	workspaces := s.store.ListWorkspaces()
	if len(workspaces) == 0 {
		return ""
	}

	return workspaces[0].ID
}

func disconnectedAccount() store.Account {
	return store.Account{
		ID:           "acct_disconnected",
		Email:        "not-connected",
		Status:       "disconnected",
		LastSyncedAt: time.Now().UTC(),
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func intValue(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	default:
		return 0
	}
}

func fallbackString(value string, fallback string) string {
	if value == "" {
		return fallback
	}

	return value
}
