package catalog

import (
	"context"
	"fmt"
	"strings"

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
	Mode        string `json:"mode,omitempty"`
	Model       string `json:"model,omitempty"`
	ReasoningEffort *string `json:"reasoningEffort,omitempty"`
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

type RemoteSkillResult struct {
	Data []map[string]any `json:"data"`
}

type RemoteSkillWriteResult struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

type ExperimentalFeatureResult struct {
	Data []map[string]any `json:"data"`
}

type McpServerStatusResult struct {
	Data []map[string]any `json:"data"`
}

type SkillConfigWriteResult struct {
	EffectiveEnabled bool `json:"effectiveEnabled"`
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

func (s *Service) CollaborationModes(ctx context.Context, workspaceID string) ([]CollaborationMode, error) {
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

	items := make([]CollaborationMode, 0, len(response.Data))
	for _, entry := range response.Data {
		mode := normalizeCollaborationMode(stringPointerValue(entry.Mode))
		items = append(items, CollaborationMode{
			ID:              fallbackString(mode, slugifyModeName(entry.Name)),
			Name:            fallbackString(strings.TrimSpace(entry.Name), humanizeModeLabel(mode)),
			Description:     collaborationModeDescription(mode),
			Mode:            mode,
			Model:           strings.TrimSpace(stringPointerValue(entry.Model)),
			ReasoningEffort: trimStringPointer(entry.ReasoningEffort),
		})
	}

	return items, nil
}

func collaborationModeDescription(mode string) string {
	switch mode {
	case "plan":
		return "Task planning mode with explicit user checkpoints"
	default:
		return "Single-agent execution with proactive progress updates"
	}
}

func humanizeModeLabel(mode string) string {
	switch mode {
	case "plan":
		return "Plan"
	default:
		return "Default"
	}
}

func slugifyModeName(value string) string {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return "default"
	}

	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	return trimmed
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

func (s *Service) ListRemoteSkills(ctx context.Context, workspaceID string, enabled bool, hazelnutScope string, productSurface string) (RemoteSkillResult, error) {
	params := map[string]any{
		"enabled": enabled,
	}
	if hazelnutScope != "" {
		params["hazelnutScope"] = hazelnutScope
	}
	if productSurface != "" {
		params["productSurface"] = productSurface
	}

	var response RemoteSkillResult
	if err := s.runtimes.Call(ctx, workspaceID, "skills/remote/list", params, &response); err != nil {
		return RemoteSkillResult{}, err
	}

	return response, nil
}

func (s *Service) ExportRemoteSkill(ctx context.Context, workspaceID string, hazelnutID string) (RemoteSkillWriteResult, error) {
	var response RemoteSkillWriteResult
	if err := s.runtimes.Call(ctx, workspaceID, "skills/remote/export", map[string]any{
		"hazelnutId": hazelnutID,
	}, &response); err != nil {
		return RemoteSkillWriteResult{}, err
	}

	return response, nil
}

func (s *Service) ListExperimentalFeatures(ctx context.Context, workspaceID string) (ExperimentalFeatureResult, error) {
	var response ExperimentalFeatureResult
	if err := s.runtimes.Call(ctx, workspaceID, "experimentalFeature/list", map[string]any{
		"limit": 200,
	}, &response); err != nil {
		return ExperimentalFeatureResult{}, err
	}

	return response, nil
}

func (s *Service) ListMcpServerStatus(ctx context.Context, workspaceID string) (McpServerStatusResult, error) {
	var response McpServerStatusResult
	if err := s.runtimes.Call(ctx, workspaceID, "mcpServerStatus/list", map[string]any{
		"limit": 200,
	}, &response); err != nil {
		return McpServerStatusResult{}, err
	}

	return response, nil
}

func (s *Service) WriteSkillConfig(ctx context.Context, workspaceID string, path string, enabled bool) (SkillConfigWriteResult, error) {
	var response SkillConfigWriteResult
	if err := s.runtimes.Call(ctx, workspaceID, "skills/config/write", map[string]any{
		"enabled": enabled,
		"path":    path,
	}, &response); err != nil {
		return SkillConfigWriteResult{}, err
	}

	return response, nil
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
