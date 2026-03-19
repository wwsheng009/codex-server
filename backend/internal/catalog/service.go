package catalog

import (
	"context"
	"fmt"

	"codex-server/backend/internal/runtime"
)

type Item struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type CollaborationMode struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Service struct {
	runtimes *runtime.Manager
}

type PluginDetailResult struct {
	Plugin map[string]any `json:"plugin"`
}

type PluginInstallResult struct {
	AppsNeedingAuth []map[string]any `json:"appsNeedingAuth"`
	AuthPolicy      string           `json:"authPolicy"`
}

func NewService(runtimeManager *runtime.Manager) *Service {
	return &Service{
		runtimes: runtimeManager,
	}
}

func (s *Service) Models(ctx context.Context, workspaceID string) ([]Item, error) {
	var response struct {
		Data []map[string]any `json:"data"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "model/list", map[string]any{}, &response); err != nil {
		return nil, err
	}

	items := make([]Item, 0, len(response.Data))
	for _, entry := range response.Data {
		items = append(items, Item{
			ID:          stringValue(entry["id"]),
			Name:        fallbackString(stringValue(entry["displayName"]), stringValue(entry["model"])),
			Description: stringValue(entry["description"]),
		})
	}

	return items, nil
}

func (s *Service) Skills(ctx context.Context, workspaceID string) ([]Item, error) {
	var response struct {
		Data []struct {
			Skills []map[string]any `json:"skills"`
		} `json:"data"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "skills/list", map[string]any{
		"cwds": []string{s.runtimes.RootPath(workspaceID)},
	}, &response); err != nil {
		return nil, err
	}

	items := make([]Item, 0)
	for _, group := range response.Data {
		for _, skill := range group.Skills {
			items = append(items, Item{
				ID:          stringValue(skill["name"]),
				Name:        stringValue(skill["name"]),
				Description: stringValue(skill["description"]),
			})
		}
	}

	return items, nil
}

func (s *Service) Apps(ctx context.Context, workspaceID string) ([]Item, error) {
	var response struct {
		Data []map[string]any `json:"data"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "app/list", map[string]any{}, &response); err != nil {
		return nil, err
	}

	items := make([]Item, 0, len(response.Data))
	for _, app := range response.Data {
		items = append(items, Item{
			ID:          fallbackString(stringValue(app["id"]), stringValue(app["name"])),
			Name:        fallbackString(stringValue(app["name"]), stringValue(app["id"])),
			Description: fallbackString(stringValue(app["description"]), "Connected app"),
		})
	}

	return items, nil
}

func (s *Service) Plugins(ctx context.Context, workspaceID string) ([]Item, error) {
	var response struct {
		Marketplaces []map[string]any `json:"marketplaces"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "plugin/list", map[string]any{
		"cwds": []string{s.runtimes.RootPath(workspaceID)},
	}, &response); err != nil {
		return nil, err
	}

	items := make([]Item, 0, len(response.Marketplaces))
	for index, marketplace := range response.Marketplaces {
		items = append(items, Item{
			ID:          fallbackString(stringValue(marketplace["id"]), fmt.Sprintf("marketplace_%d", index+1)),
			Name:        fallbackString(stringValue(marketplace["name"]), "Marketplace"),
			Description: fallbackString(stringValue(marketplace["description"]), "Plugin marketplace"),
		})
	}

	return items, nil
}

func (s *Service) ReadPlugin(ctx context.Context, workspaceID string, marketplacePath string, pluginName string) (PluginDetailResult, error) {
	var response PluginDetailResult
	if err := s.runtimes.Call(ctx, workspaceID, "plugin/read", map[string]any{
		"marketplacePath": marketplacePath,
		"pluginName":      pluginName,
	}, &response); err != nil {
		return PluginDetailResult{}, err
	}

	return response, nil
}

func (s *Service) InstallPlugin(ctx context.Context, workspaceID string, marketplacePath string, pluginName string) (PluginInstallResult, error) {
	var response PluginInstallResult
	if err := s.runtimes.Call(ctx, workspaceID, "plugin/install", map[string]any{
		"marketplacePath": marketplacePath,
		"pluginName":      pluginName,
	}, &response); err != nil {
		return PluginInstallResult{}, err
	}

	return response, nil
}

func (s *Service) UninstallPlugin(ctx context.Context, workspaceID string, pluginID string) error {
	return s.runtimes.Call(ctx, workspaceID, "plugin/uninstall", map[string]any{
		"pluginId": pluginID,
	}, nil)
}

func (s *Service) CollaborationModes() []CollaborationMode {
	return []CollaborationMode{
		{ID: "default", Name: "Default", Description: "Single-agent execution with proactive progress updates"},
		{ID: "plan", Name: "Plan", Description: "Task planning mode with explicit user checkpoints"},
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

func fallbackString(value string, fallback string) string {
	if value == "" {
		return fallback
	}

	return value
}
