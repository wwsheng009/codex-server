package configfs

import (
	"context"
	"errors"
	"strings"

	"codex-server/backend/internal/runtime"
)

type Service struct {
	runtimes *runtime.Manager
}

type ConfigReadResult struct {
	Config  map[string]any `json:"config"`
	Origins map[string]any `json:"origins"`
	Layers  []any          `json:"layers,omitempty"`
}

type ConfigWriteResult struct {
	FilePath           string         `json:"filePath"`
	Status             string         `json:"status"`
	Version            string         `json:"version"`
	OverriddenMetadata map[string]any `json:"overriddenMetadata,omitempty"`
}

type FuzzyFileSearchResult struct {
	Files []map[string]any `json:"files"`
}

type ConfigRequirementsResult struct {
	Requirements map[string]any `json:"requirements"`
}

type ExternalAgentConfigDetectResult struct {
	Items []map[string]any `json:"items"`
}

type WindowsSandboxSetupResult struct {
	Started bool `json:"started"`
}

func NewService(runtimeManager *runtime.Manager) *Service {
	return &Service{runtimes: runtimeManager}
}

func (s *Service) ReadConfig(ctx context.Context, workspaceID string, includeLayers bool) (ConfigReadResult, error) {
	var response ConfigReadResult
	if err := s.runtimes.Call(ctx, workspaceID, "config/read", map[string]any{
		"cwd":           s.runtimes.RootPath(workspaceID),
		"includeLayers": includeLayers,
	}, &response); err != nil {
		return ConfigReadResult{}, err
	}

	return response, nil
}

func (s *Service) WriteConfigValue(ctx context.Context, workspaceID string, filePath string, keyPath string, mergeStrategy string, value any) (ConfigWriteResult, error) {
	if strings.TrimSpace(keyPath) == "" {
		return ConfigWriteResult{}, errors.New("keyPath is required")
	}

	if mergeStrategy == "" {
		mergeStrategy = "upsert"
	}

	params := map[string]any{
		"keyPath":       keyPath,
		"mergeStrategy": mergeStrategy,
		"value":         value,
	}
	if strings.TrimSpace(filePath) != "" {
		params["filePath"] = filePath
	}

	var response ConfigWriteResult
	if err := s.runtimes.Call(ctx, workspaceID, "config/value/write", params, &response); err != nil {
		return ConfigWriteResult{}, err
	}

	return response, nil
}

func (s *Service) BatchWriteConfig(ctx context.Context, workspaceID string, filePath string, edits []map[string]any, reloadUserConfig bool) (ConfigWriteResult, error) {
	if len(edits) == 0 {
		return ConfigWriteResult{}, errors.New("edits are required")
	}

	params := map[string]any{
		"edits":            edits,
		"reloadUserConfig": reloadUserConfig,
	}
	if strings.TrimSpace(filePath) != "" {
		params["filePath"] = filePath
	}

	var response ConfigWriteResult
	if err := s.runtimes.Call(ctx, workspaceID, "config/batchWrite", params, &response); err != nil {
		return ConfigWriteResult{}, err
	}

	return response, nil
}

func (s *Service) FuzzyFileSearch(ctx context.Context, workspaceID string, query string) (FuzzyFileSearchResult, error) {
	if strings.TrimSpace(query) == "" {
		return FuzzyFileSearchResult{}, errors.New("query is required")
	}

	var response FuzzyFileSearchResult
	if err := s.runtimes.Call(ctx, workspaceID, "fuzzyFileSearch", map[string]any{
		"query": query,
		"roots": []string{s.runtimes.RootPath(workspaceID)},
	}, &response); err != nil {
		return FuzzyFileSearchResult{}, err
	}

	return response, nil
}

func (s *Service) ReadConfigRequirements(ctx context.Context, workspaceID string) (ConfigRequirementsResult, error) {
	var response ConfigRequirementsResult
	if err := s.runtimes.Call(ctx, workspaceID, "configRequirements/read", map[string]any{}, &response); err != nil {
		return ConfigRequirementsResult{}, err
	}

	return response, nil
}

func (s *Service) DetectExternalAgentConfig(ctx context.Context, workspaceID string, includeHome bool) (ExternalAgentConfigDetectResult, error) {
	var response ExternalAgentConfigDetectResult
	if err := s.runtimes.Call(ctx, workspaceID, "externalAgentConfig/detect", map[string]any{
		"cwds":        []string{s.runtimes.RootPath(workspaceID)},
		"includeHome": includeHome,
	}, &response); err != nil {
		return ExternalAgentConfigDetectResult{}, err
	}

	return response, nil
}

func (s *Service) ImportExternalAgentConfig(ctx context.Context, workspaceID string, migrationItems []map[string]any) error {
	if len(migrationItems) == 0 {
		return errors.New("migrationItems are required")
	}

	return s.runtimes.Call(ctx, workspaceID, "externalAgentConfig/import", map[string]any{
		"migrationItems": migrationItems,
	}, nil)
}

func (s *Service) ReloadMcpServers(ctx context.Context, workspaceID string) error {
	return s.runtimes.Call(ctx, workspaceID, "config/mcpServer/reload", map[string]any{}, nil)
}

func (s *Service) StartWindowsSandboxSetup(ctx context.Context, workspaceID string, mode string) (WindowsSandboxSetupResult, error) {
	if strings.TrimSpace(mode) == "" {
		return WindowsSandboxSetupResult{}, errors.New("mode is required")
	}

	var response WindowsSandboxSetupResult
	if err := s.runtimes.Call(ctx, workspaceID, "windowsSandbox/setupStart", map[string]any{
		"cwd":  s.runtimes.RootPath(workspaceID),
		"mode": mode,
	}, &response); err != nil {
		return WindowsSandboxSetupResult{}, err
	}

	return response, nil
}
