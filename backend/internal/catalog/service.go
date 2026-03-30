package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/runtimeprefs"
)

type Item struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Value       string `json:"value,omitempty"`
	ShellType   string `json:"shellType,omitempty"`
}

type PluginListItem struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	MarketplaceName string   `json:"marketplaceName"`
	MarketplacePath string   `json:"marketplacePath,omitempty"`
	Installed       bool     `json:"installed"`
	Enabled         bool     `json:"enabled"`
	AuthPolicy      string   `json:"authPolicy,omitempty"`
	InstallPolicy   string   `json:"installPolicy,omitempty"`
	SourceType      string   `json:"sourceType,omitempty"`
	SourcePath      string   `json:"sourcePath,omitempty"`
	Capabilities    []string `json:"capabilities,omitempty"`
	Category        string   `json:"category,omitempty"`
	BrandColor      string   `json:"brandColor,omitempty"`
}

type PluginListResult struct {
	Plugins         []PluginListItem `json:"plugins"`
	RemoteSyncError string           `json:"remoteSyncError,omitempty"`
}

type CollaborationMode struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	Mode            string  `json:"mode,omitempty"`
	Model           string  `json:"model,omitempty"`
	ReasoningEffort *string `json:"reasoningEffort,omitempty"`
}

type Service struct {
	runtimes     *runtime.Manager
	runtimePrefs *runtimeprefs.Service
}

type PluginDetailResult struct {
	Plugin map[string]any `json:"plugin"`
}

type PluginInstallResult struct {
	AppsNeedingAuth []map[string]any `json:"appsNeedingAuth"`
	AuthPolicy      string           `json:"authPolicy"`
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

type pluginListResponse struct {
	Marketplaces    []map[string]any `json:"marketplaces"`
	RemoteSyncError string           `json:"remoteSyncError"`
}

func NewService(runtimeManager *runtime.Manager, runtimePrefs ...*runtimeprefs.Service) *Service {
	var prefsService *runtimeprefs.Service
	if len(runtimePrefs) > 0 {
		prefsService = runtimePrefs[0]
	}

	return &Service{
		runtimes:     runtimeManager,
		runtimePrefs: prefsService,
	}
}

func (s *Service) Models(ctx context.Context, workspaceID string) ([]Item, error) {
	var response struct {
		Data []map[string]any `json:"data"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "model/list", map[string]any{}, &response); err != nil {
		return nil, err
	}
	shellTypes := s.modelShellTypes()

	items := make([]Item, 0, len(response.Data))
	for _, entry := range response.Data {
		modelValue := fallbackString(stringValue(entry["model"]), stringValue(entry["id"]))
		displayName := fallbackString(stringValue(entry["displayName"]), stringValue(entry["model"]))
		items = append(items, Item{
			ID:          stringValue(entry["id"]),
			Name:        displayName,
			Description: stringValue(entry["description"]),
			Value:       modelValue,
			ShellType:   resolveModelShellType(shellTypes, modelValue, stringValue(entry["id"]), displayName),
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

func (s *Service) Plugins(ctx context.Context, workspaceID string) (PluginListResult, error) {
	var response pluginListResponse

	if err := s.runtimes.Call(ctx, workspaceID, "plugin/list", map[string]any{
		"cwds": []string{s.runtimes.RootPath(workspaceID)},
	}, &response); err != nil {
		return PluginListResult{}, err
	}

	return mapPluginListResponse(response), nil
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

func (s *Service) modelShellTypes() map[string]string {
	if s.runtimePrefs == nil {
		return nil
	}

	prefs, err := s.runtimePrefs.Read()
	if err != nil || strings.TrimSpace(prefs.EffectiveModelCatalogPath) == "" {
		return nil
	}

	content, err := os.ReadFile(prefs.EffectiveModelCatalogPath)
	if err != nil {
		return nil
	}

	var catalog struct {
		Models []map[string]any `json:"models"`
	}
	if err := json.Unmarshal(content, &catalog); err != nil {
		return nil
	}

	shellTypes := make(map[string]string, len(catalog.Models)*4)
	for _, model := range catalog.Models {
		shellType := strings.TrimSpace(stringValue(model["shell_type"]))
		if shellType == "" {
			continue
		}
		for _, key := range []string{"slug", "display_name", "displayName", "model", "id"} {
			value := strings.TrimSpace(stringValue(model[key]))
			if value == "" {
				continue
			}
			shellTypes[strings.ToLower(value)] = shellType
		}
	}

	return shellTypes
}

func resolveModelShellType(shellTypes map[string]string, candidates ...string) string {
	if len(shellTypes) == 0 {
		return ""
	}

	for _, candidate := range candidates {
		key := strings.ToLower(strings.TrimSpace(candidate))
		if key == "" {
			continue
		}
		if shellType, ok := shellTypes[key]; ok {
			return shellType
		}
	}

	return ""
}

func mapPluginListResponse(response pluginListResponse) PluginListResult {
	items := make([]PluginListItem, 0)

	for index, marketplace := range response.Marketplaces {
		marketplaceName := fallbackString(stringValue(marketplace["name"]), fmt.Sprintf("Marketplace %d", index+1))
		marketplacePath := stringValue(marketplace["path"])
		plugins := objectSliceValue(marketplace["plugins"])

		for pluginIndex, plugin := range plugins {
			interfaceObject := mapValue(plugin["interface"])
			capabilities := stringSliceValue(interfaceObject["capabilities"])
			category := stringValue(interfaceObject["category"])
			brandColor := stringValue(interfaceObject["brandColor"])
			source := mapValue(plugin["source"])
			name := fallbackString(stringValue(plugin["name"]), fmt.Sprintf("%s Plugin %d", marketplaceName, pluginIndex+1))

			items = append(items, PluginListItem{
				ID:              fallbackString(stringValue(plugin["id"]), name),
				Name:            name,
				Description:     buildPluginDescription(category, capabilities, marketplaceName),
				MarketplaceName: marketplaceName,
				MarketplacePath: marketplacePath,
				Installed:       boolValue(plugin["installed"]),
				Enabled:         boolValue(plugin["enabled"]),
				AuthPolicy:      stringValue(plugin["authPolicy"]),
				InstallPolicy:   stringValue(plugin["installPolicy"]),
				SourceType:      stringValue(source["type"]),
				SourcePath:      stringValue(source["path"]),
				Capabilities:    capabilities,
				Category:        category,
				BrandColor:      brandColor,
			})
		}
	}

	return PluginListResult{
		Plugins:         items,
		RemoteSyncError: strings.TrimSpace(response.RemoteSyncError),
	}
}

func buildPluginDescription(category string, capabilities []string, marketplaceName string) string {
	parts := make([]string, 0, 2)

	if strings.TrimSpace(category) != "" {
		parts = append(parts, "Category: "+strings.TrimSpace(category))
	}
	if len(capabilities) > 0 {
		parts = append(parts, "Capabilities: "+strings.Join(capabilities, ", "))
	}
	if len(parts) == 0 {
		return "Plugin from " + marketplaceName
	}

	return strings.Join(parts, " | ")
}

func mapValue(value any) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}

	return object
}

func objectSliceValue(value any) []map[string]any {
	rawItems, ok := value.([]any)
	if !ok || len(rawItems) == 0 {
		return nil
	}

	items := make([]map[string]any, 0, len(rawItems))
	for _, rawItem := range rawItems {
		object, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		items = append(items, object)
	}

	return items
}

func stringSliceValue(value any) []string {
	rawItems, ok := value.([]any)
	if !ok || len(rawItems) == 0 {
		return nil
	}

	items := make([]string, 0, len(rawItems))
	for _, rawItem := range rawItems {
		item := strings.TrimSpace(stringValue(rawItem))
		if item == "" {
			continue
		}
		items = append(items, item)
	}

	return items
}

func boolValue(value any) bool {
	typed, ok := value.(bool)
	if !ok {
		return false
	}

	return typed
}
