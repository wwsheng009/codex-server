package runtimeprefs

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	appconfig "codex-server/backend/internal/config"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store        *store.MemoryStore
	runtimes     *runtime.Manager
	baseCommand  string
	defaultPrefs appconfig.RuntimePreferences
}

type ReadResult struct {
	ConfiguredModelCatalogPath        string            `json:"configuredModelCatalogPath"`
	ConfiguredDefaultShellType        string            `json:"configuredDefaultShellType"`
	ConfiguredModelShellTypeOverrides map[string]string `json:"configuredModelShellTypeOverrides"`
	DefaultModelCatalogPath           string            `json:"defaultModelCatalogPath"`
	DefaultDefaultShellType           string            `json:"defaultDefaultShellType"`
	DefaultModelShellTypeOverrides    map[string]string `json:"defaultModelShellTypeOverrides"`
	EffectiveModelCatalogPath         string            `json:"effectiveModelCatalogPath"`
	EffectiveDefaultShellType         string            `json:"effectiveDefaultShellType"`
	EffectiveModelShellTypeOverrides  map[string]string `json:"effectiveModelShellTypeOverrides"`
	EffectiveCommand                  string            `json:"effectiveCommand"`
}

type WriteInput struct {
	ModelCatalogPath        string            `json:"modelCatalogPath"`
	DefaultShellType        string            `json:"defaultShellType"`
	ModelShellTypeOverrides map[string]string `json:"modelShellTypeOverrides"`
}

func NewService(
	dataStore *store.MemoryStore,
	runtimeManager *runtime.Manager,
	baseCommand string,
	defaultModelCatalogPath string,
	defaultLocalShellModels []string,
) *Service {
	return &Service{
		store:       dataStore,
		runtimes:    runtimeManager,
		baseCommand: baseCommand,
		defaultPrefs: appconfig.RuntimePreferences{
			ModelCatalogPath:        strings.TrimSpace(defaultModelCatalogPath),
			ModelShellTypeOverrides: localShellModelsToOverrides(defaultLocalShellModels),
		},
	}
}

func (s *Service) Read() (ReadResult, error) {
	configuredPrefs := s.store.GetRuntimePreferences()
	effectivePrefs := s.mergeWithDefaults(configuredPrefs)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	return s.buildReadResult(configuredPrefs, resolved), nil
}

func (s *Service) Write(input WriteInput) (ReadResult, error) {
	candidateConfigured := store.RuntimePreferences{
		ModelCatalogPath:        strings.TrimSpace(input.ModelCatalogPath),
		DefaultShellType:        strings.TrimSpace(input.DefaultShellType),
		ModelShellTypeOverrides: normalizeInputs(input.ModelShellTypeOverrides),
	}
	effectivePrefs := s.mergeWithDefaults(candidateConfigured)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	s.store.SetRuntimePreferences(candidateConfigured)
	s.runtimes.ApplyCommand(resolved.Command)

	return s.buildReadResult(candidateConfigured, resolved), nil
}

func (s *Service) ImportModelCatalogTemplate() (ReadResult, error) {
	sourcePath, targetPath, err := resolveManagedModelCatalogTemplatePaths()
	if err != nil {
		return ReadResult{}, err
	}

	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return ReadResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return ReadResult{}, err
	}
	if err := os.WriteFile(targetPath, content, 0o644); err != nil {
		return ReadResult{}, err
	}

	currentConfigured := s.store.GetRuntimePreferences()
	candidateConfigured := store.RuntimePreferences{
		ModelCatalogPath:        targetPath,
		LocalShellModels:        cloneStrings(currentConfigured.LocalShellModels),
		DefaultShellType:        currentConfigured.DefaultShellType,
		ModelShellTypeOverrides: cloneStringMap(currentConfigured.ModelShellTypeOverrides),
	}
	effectivePrefs := s.mergeWithDefaults(candidateConfigured)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	s.store.SetRuntimePreferences(candidateConfigured)
	s.runtimes.ApplyCommand(resolved.Command)

	return s.buildReadResult(candidateConfigured, resolved), nil
}

func (s *Service) mergeWithDefaults(configured store.RuntimePreferences) appconfig.RuntimePreferences {
	merged := appconfig.RuntimePreferences{
		ModelCatalogPath:        configured.ModelCatalogPath,
		LocalShellModels:        cloneStrings(configured.LocalShellModels),
		DefaultShellType:        configured.DefaultShellType,
		ModelShellTypeOverrides: cloneStringMap(configured.ModelShellTypeOverrides),
	}
	if merged.ModelCatalogPath == "" {
		merged.ModelCatalogPath = s.defaultPrefs.ModelCatalogPath
	}
	if merged.DefaultShellType == "" {
		merged.DefaultShellType = s.defaultPrefs.DefaultShellType
	}
	if len(merged.ModelShellTypeOverrides) == 0 {
		merged.ModelShellTypeOverrides = cloneStringMap(s.defaultPrefs.ModelShellTypeOverrides)
	} else {
		for key, value := range localShellModelsToOverrides(merged.LocalShellModels) {
			if _, ok := merged.ModelShellTypeOverrides[key]; !ok {
				merged.ModelShellTypeOverrides[key] = value
			}
		}
		for key, value := range s.defaultPrefs.ModelShellTypeOverrides {
			if _, ok := merged.ModelShellTypeOverrides[key]; !ok {
				merged.ModelShellTypeOverrides[key] = value
			}
		}
	}
	return merged
}

func normalizeInputs(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	items := make(map[string]string, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		trimmedValue := strings.TrimSpace(value)
		if trimmedKey == "" || trimmedValue == "" {
			continue
		}
		items[trimmedKey] = trimmedValue
	}
	if len(items) == 0 {
		return nil
	}
	return items
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	return append([]string(nil), values...)
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func (s *Service) buildReadResult(
	configuredPrefs store.RuntimePreferences,
	resolved appconfig.ResolvedRuntime,
) ReadResult {
	return ReadResult{
		ConfiguredModelCatalogPath:        configuredPrefs.ModelCatalogPath,
		ConfiguredDefaultShellType:        configuredPrefs.DefaultShellType,
		ConfiguredModelShellTypeOverrides: cloneStringMap(configuredPrefs.ModelShellTypeOverrides),
		DefaultModelCatalogPath:           s.defaultPrefs.ModelCatalogPath,
		DefaultDefaultShellType:           s.defaultPrefs.DefaultShellType,
		DefaultModelShellTypeOverrides:    cloneStringMap(s.defaultPrefs.ModelShellTypeOverrides),
		EffectiveModelCatalogPath:         resolved.EffectiveModelCatalogPath,
		EffectiveDefaultShellType:         resolved.Preferences.DefaultShellType,
		EffectiveModelShellTypeOverrides:  cloneStringMap(resolved.Preferences.ModelShellTypeOverrides),
		EffectiveCommand:                  resolved.Command,
	}
}

func resolveManagedModelCatalogTemplatePaths() (string, string, error) {
	workingDir, err := os.Getwd()
	if err != nil {
		return "", "", err
	}

	candidates := []string{
		filepath.Clean(workingDir),
		filepath.Clean(filepath.Dir(workingDir)),
	}

	for _, root := range candidates {
		sourcePath := filepath.Join(root, "config", "model-catalog.json")
		info, err := os.Stat(sourcePath)
		if err == nil && !info.IsDir() {
			targetPath := filepath.Join(root, "config", "runtime-model-catalog.json")
			return sourcePath, targetPath, nil
		}
	}

	return "", "", errors.New("bundled model catalog template not found at config/model-catalog.json")
}

func localShellModelsToOverrides(values []string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	overrides := make(map[string]string, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		overrides[trimmed] = "local"
	}
	if len(overrides) == 0 {
		return nil
	}
	return overrides
}
