package hooks

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"codex-server/backend/internal/store"
)

const (
	DefaultSessionStartEnabled                    = true
	DefaultSessionStartMaxChars                   = 2400
	DefaultUserPromptSecretBlockEnabled           = true
	DefaultPreToolUseDangerousCommandBlockEnabled = true

	WorkspaceConfigLoadStatusLoaded   = "loaded"
	WorkspaceConfigLoadStatusNotFound = "not_found"
	WorkspaceConfigLoadStatusError    = "error"

	ConfigSourceDefault   = "default"
	ConfigSourceWorkspace = "workspace"
	ConfigSourceRuntime   = "runtime"
)

const DefaultSessionStartTemplate = `在处理当前请求前，请先遵循以下项目上下文与约定。
{{source_path_line}}项目上下文摘录：
{{context}}

用户请求：
{{user_request}}`

type RuntimeConfig struct {
	SessionStartEnabled                    bool
	SessionStartContextPaths               []string
	SessionStartMaxChars                   int
	SessionStartTemplate                   string
	UserPromptSecretBlockEnabled           bool
	PreToolUseDangerousCommandBlockEnabled bool
	PreToolUseProtectedGovernancePaths     []string
}

type WorkspaceFileConfig struct {
	Version          int                              `json:"version,omitempty"`
	SessionStart     *WorkspaceFileSessionStartConfig `json:"sessionStart,omitempty"`
	UserPromptSubmit *WorkspaceFileUserPromptConfig   `json:"userPromptSubmit,omitempty"`
	PreToolUse       *WorkspaceFilePreToolUseConfig   `json:"preToolUse,omitempty"`
}

type WorkspaceFileSessionStartConfig struct {
	Enabled      *bool    `json:"enabled,omitempty"`
	ContextPaths []string `json:"contextPaths,omitempty"`
	MaxChars     *int     `json:"maxChars,omitempty"`
	Template     *string  `json:"template,omitempty"`
}

type WorkspaceFileUserPromptConfig struct {
	BlockSecretPasteEnabled *bool `json:"blockSecretPasteEnabled,omitempty"`
}

type WorkspaceFilePreToolUseConfig struct {
	BlockDangerousCommandEnabled       *bool    `json:"blockDangerousCommandEnabled,omitempty"`
	AdditionalProtectedGovernancePaths []string `json:"additionalProtectedGovernancePaths,omitempty"`
}

type WorkspaceConfigOverrides struct {
	HookSessionStartEnabled                          *bool    `json:"hookSessionStartEnabled"`
	HookSessionStartContextPaths                     []string `json:"hookSessionStartContextPaths,omitempty"`
	HookSessionStartMaxChars                         *int     `json:"hookSessionStartMaxChars"`
	HookSessionStartTemplate                         *string  `json:"hookSessionStartTemplate"`
	HookUserPromptSubmitBlockSecretPasteEnabled      *bool    `json:"hookUserPromptSubmitBlockSecretPasteEnabled"`
	HookPreToolUseBlockDangerousCommandEnabled       *bool    `json:"hookPreToolUseBlockDangerousCommandEnabled"`
	HookPreToolUseAdditionalProtectedGovernancePaths []string `json:"hookPreToolUseAdditionalProtectedGovernancePaths,omitempty"`
}

type ConfigurationReadResult struct {
	WorkspaceID                                                string   `json:"workspaceId"`
	WorkspaceRootPath                                          string   `json:"workspaceRootPath"`
	LoadStatus                                                 string   `json:"loadStatus"`
	LoadError                                                  string   `json:"loadError,omitempty"`
	LoadedFromPath                                             string   `json:"loadedFromPath,omitempty"`
	SearchedPaths                                              []string `json:"searchedPaths,omitempty"`
	BaselineHookSessionStartEnabled                            *bool    `json:"baselineHookSessionStartEnabled"`
	BaselineHookSessionStartContextPaths                       []string `json:"baselineHookSessionStartContextPaths,omitempty"`
	BaselineHookSessionStartMaxChars                           *int     `json:"baselineHookSessionStartMaxChars"`
	BaselineHookSessionStartTemplate                           *string  `json:"baselineHookSessionStartTemplate"`
	BaselineHookUserPromptSubmitBlockSecretPasteEnabled        *bool    `json:"baselineHookUserPromptSubmitBlockSecretPasteEnabled"`
	BaselineHookPreToolUseBlockDangerousCommandEnabled         *bool    `json:"baselineHookPreToolUseBlockDangerousCommandEnabled"`
	BaselineHookPreToolUseAdditionalProtectedGovernancePaths   []string `json:"baselineHookPreToolUseAdditionalProtectedGovernancePaths,omitempty"`
	ConfiguredHookSessionStartEnabled                          *bool    `json:"configuredHookSessionStartEnabled"`
	ConfiguredHookSessionStartContextPaths                     []string `json:"configuredHookSessionStartContextPaths,omitempty"`
	ConfiguredHookSessionStartMaxChars                         *int     `json:"configuredHookSessionStartMaxChars"`
	ConfiguredHookSessionStartTemplate                         *string  `json:"configuredHookSessionStartTemplate"`
	ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled      *bool    `json:"configuredHookUserPromptSubmitBlockSecretPasteEnabled"`
	ConfiguredHookPreToolUseBlockDangerousCommandEnabled       *bool    `json:"configuredHookPreToolUseBlockDangerousCommandEnabled"`
	ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths []string `json:"configuredHookPreToolUseAdditionalProtectedGovernancePaths,omitempty"`
	EffectiveHookSessionStartEnabled                           bool     `json:"effectiveHookSessionStartEnabled"`
	EffectiveHookSessionStartContextPaths                      []string `json:"effectiveHookSessionStartContextPaths,omitempty"`
	EffectiveHookSessionStartMaxChars                          int      `json:"effectiveHookSessionStartMaxChars"`
	EffectiveHookSessionStartTemplate                          string   `json:"effectiveHookSessionStartTemplate"`
	EffectiveHookUserPromptSubmitBlockSecretPasteEnabled       bool     `json:"effectiveHookUserPromptSubmitBlockSecretPasteEnabled"`
	EffectiveHookPreToolUseBlockDangerousCommandEnabled        bool     `json:"effectiveHookPreToolUseBlockDangerousCommandEnabled"`
	EffectiveHookPreToolUseProtectedGovernancePaths            []string `json:"effectiveHookPreToolUseProtectedGovernancePaths,omitempty"`
	EffectiveHookSessionStartEnabledSource                     string   `json:"effectiveHookSessionStartEnabledSource"`
	EffectiveHookSessionStartContextPathsSource                string   `json:"effectiveHookSessionStartContextPathsSource"`
	EffectiveHookSessionStartMaxCharsSource                    string   `json:"effectiveHookSessionStartMaxCharsSource"`
	EffectiveHookSessionStartTemplateSource                    string   `json:"effectiveHookSessionStartTemplateSource"`
	EffectiveHookUserPromptSubmitBlockSecretPasteSource        string   `json:"effectiveHookUserPromptSubmitBlockSecretPasteSource"`
	EffectiveHookPreToolUseDangerousCommandBlockSource         string   `json:"effectiveHookPreToolUseDangerousCommandBlockSource"`
	EffectiveHookPreToolUseProtectedGovernancePathsSource      string   `json:"effectiveHookPreToolUseProtectedGovernancePathsSource"`
}

type ConfigurationWriteResult struct {
	Status        string                  `json:"status"`
	FilePath      string                  `json:"filePath,omitempty"`
	Configuration ConfigurationReadResult `json:"configuration"`
}

type workspaceConfigLoadResult struct {
	loadStatus string
	loadError  string
	loadedFrom string
	searched   []string
	overrides  WorkspaceConfigOverrides
}

func DefaultSessionStartContextPaths() []string {
	return []string{
		".codex/SESSION_START.md",
		".codex/session-start.md",
	}
}

func DefaultProtectedGovernancePaths() []string {
	return []string{
		".codex/hooks.json",
		"hooks.json",
		".codex/SESSION_START.md",
		".codex/session-start.md",
		"AGENTS.md",
		"CLAUDE.md",
	}
}

func ResolveRuntimeConfig(prefs store.RuntimePreferences) RuntimeConfig {
	return ResolveRuntimeConfigWithWorkspaceOverrides(
		WorkspaceConfigOverrides{},
		RuntimeConfigOverridesFromPreferences(prefs),
	)
}

func ResolveRuntimeConfigWithWorkspaceOverrides(
	baseline WorkspaceConfigOverrides,
	runtimeOverrides WorkspaceConfigOverrides,
) RuntimeConfig {
	config := RuntimeConfig{
		SessionStartEnabled:                    DefaultSessionStartEnabled,
		SessionStartContextPaths:               DefaultSessionStartContextPaths(),
		SessionStartMaxChars:                   DefaultSessionStartMaxChars,
		SessionStartTemplate:                   DefaultSessionStartTemplate,
		UserPromptSecretBlockEnabled:           DefaultUserPromptSecretBlockEnabled,
		PreToolUseDangerousCommandBlockEnabled: DefaultPreToolUseDangerousCommandBlockEnabled,
		PreToolUseProtectedGovernancePaths:     DefaultProtectedGovernancePaths(),
	}

	if baseline.HookSessionStartEnabled != nil {
		config.SessionStartEnabled = *baseline.HookSessionStartEnabled
	}
	if paths := NormalizeSessionStartContextPaths(baseline.HookSessionStartContextPaths); len(paths) > 0 {
		config.SessionStartContextPaths = paths
	}
	if baseline.HookSessionStartMaxChars != nil && *baseline.HookSessionStartMaxChars > 0 {
		config.SessionStartMaxChars = *baseline.HookSessionStartMaxChars
	}
	if baseline.HookSessionStartTemplate != nil {
		config.SessionStartTemplate = *baseline.HookSessionStartTemplate
	}
	if baseline.HookUserPromptSubmitBlockSecretPasteEnabled != nil {
		config.UserPromptSecretBlockEnabled = *baseline.HookUserPromptSubmitBlockSecretPasteEnabled
	}
	if baseline.HookPreToolUseBlockDangerousCommandEnabled != nil {
		config.PreToolUseDangerousCommandBlockEnabled = *baseline.HookPreToolUseBlockDangerousCommandEnabled
	}
	if additional := NormalizeProtectedGovernancePaths(baseline.HookPreToolUseAdditionalProtectedGovernancePaths); len(additional) > 0 {
		config.PreToolUseProtectedGovernancePaths = appendUniquePaths(
			config.PreToolUseProtectedGovernancePaths,
			additional,
		)
	}

	if runtimeOverrides.HookSessionStartEnabled != nil {
		config.SessionStartEnabled = *runtimeOverrides.HookSessionStartEnabled
	}
	if paths := NormalizeSessionStartContextPaths(runtimeOverrides.HookSessionStartContextPaths); len(paths) > 0 {
		config.SessionStartContextPaths = paths
	}
	if runtimeOverrides.HookSessionStartMaxChars != nil && *runtimeOverrides.HookSessionStartMaxChars > 0 {
		config.SessionStartMaxChars = *runtimeOverrides.HookSessionStartMaxChars
	}
	if runtimeOverrides.HookSessionStartTemplate != nil {
		config.SessionStartTemplate = *runtimeOverrides.HookSessionStartTemplate
	}
	if runtimeOverrides.HookUserPromptSubmitBlockSecretPasteEnabled != nil {
		config.UserPromptSecretBlockEnabled = *runtimeOverrides.HookUserPromptSubmitBlockSecretPasteEnabled
	}
	if runtimeOverrides.HookPreToolUseBlockDangerousCommandEnabled != nil {
		config.PreToolUseDangerousCommandBlockEnabled = *runtimeOverrides.HookPreToolUseBlockDangerousCommandEnabled
	}
	if additional := NormalizeProtectedGovernancePaths(runtimeOverrides.HookPreToolUseAdditionalProtectedGovernancePaths); len(additional) > 0 {
		config.PreToolUseProtectedGovernancePaths = appendUniquePaths(
			config.PreToolUseProtectedGovernancePaths,
			additional,
		)
	}

	return config
}

func RuntimeConfigOverridesFromPreferences(prefs store.RuntimePreferences) WorkspaceConfigOverrides {
	return WorkspaceConfigOverrides{
		HookSessionStartEnabled:                     cloneOptionalBool(prefs.HookSessionStartEnabled),
		HookSessionStartContextPaths:                cloneStrings(NormalizeSessionStartContextPaths(prefs.HookSessionStartContextPaths)),
		HookSessionStartMaxChars:                    cloneOptionalInt(prefs.HookSessionStartMaxChars),
		HookSessionStartTemplate:                    cloneOptionalString(prefs.HookSessionStartTemplate),
		HookUserPromptSubmitBlockSecretPasteEnabled: cloneOptionalBool(prefs.HookUserPromptSubmitBlockSecretPasteEnabled),
		HookPreToolUseBlockDangerousCommandEnabled:  cloneOptionalBool(prefs.HookPreToolUseBlockDangerousCommandEnabled),
		HookPreToolUseAdditionalProtectedGovernancePaths: cloneStrings(
			NormalizeProtectedGovernancePaths(prefs.HookPreToolUseAdditionalProtectedGovernancePaths),
		),
	}
}

func ResolveConfiguration(workspace store.Workspace, prefs store.RuntimePreferences) ConfigurationReadResult {
	loadResult := loadWorkspaceConfig(workspace)
	runtimeOverrides := RuntimeConfigOverridesFromPreferences(prefs)
	effective := ResolveRuntimeConfigWithWorkspaceOverrides(loadResult.overrides, runtimeOverrides)

	return ConfigurationReadResult{
		WorkspaceID:                          workspace.ID,
		WorkspaceRootPath:                    strings.TrimSpace(workspace.RootPath),
		LoadStatus:                           loadResult.loadStatus,
		LoadError:                            loadResult.loadError,
		LoadedFromPath:                       loadResult.loadedFrom,
		SearchedPaths:                        cloneStrings(loadResult.searched),
		BaselineHookSessionStartEnabled:      cloneOptionalBool(loadResult.overrides.HookSessionStartEnabled),
		BaselineHookSessionStartContextPaths: cloneStrings(loadResult.overrides.HookSessionStartContextPaths),
		BaselineHookSessionStartMaxChars:     cloneOptionalInt(loadResult.overrides.HookSessionStartMaxChars),
		BaselineHookSessionStartTemplate:     cloneOptionalString(loadResult.overrides.HookSessionStartTemplate),
		BaselineHookUserPromptSubmitBlockSecretPasteEnabled:        cloneOptionalBool(loadResult.overrides.HookUserPromptSubmitBlockSecretPasteEnabled),
		BaselineHookPreToolUseBlockDangerousCommandEnabled:         cloneOptionalBool(loadResult.overrides.HookPreToolUseBlockDangerousCommandEnabled),
		BaselineHookPreToolUseAdditionalProtectedGovernancePaths:   cloneStrings(loadResult.overrides.HookPreToolUseAdditionalProtectedGovernancePaths),
		ConfiguredHookSessionStartEnabled:                          cloneOptionalBool(runtimeOverrides.HookSessionStartEnabled),
		ConfiguredHookSessionStartContextPaths:                     cloneStrings(runtimeOverrides.HookSessionStartContextPaths),
		ConfiguredHookSessionStartMaxChars:                         cloneOptionalInt(runtimeOverrides.HookSessionStartMaxChars),
		ConfiguredHookSessionStartTemplate:                         cloneOptionalString(runtimeOverrides.HookSessionStartTemplate),
		ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled:      cloneOptionalBool(runtimeOverrides.HookUserPromptSubmitBlockSecretPasteEnabled),
		ConfiguredHookPreToolUseBlockDangerousCommandEnabled:       cloneOptionalBool(runtimeOverrides.HookPreToolUseBlockDangerousCommandEnabled),
		ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths: cloneStrings(runtimeOverrides.HookPreToolUseAdditionalProtectedGovernancePaths),
		EffectiveHookSessionStartEnabled:                           effective.SessionStartEnabled,
		EffectiveHookSessionStartContextPaths:                      cloneStrings(effective.SessionStartContextPaths),
		EffectiveHookSessionStartMaxChars:                          effective.SessionStartMaxChars,
		EffectiveHookSessionStartTemplate:                          effective.SessionStartTemplate,
		EffectiveHookUserPromptSubmitBlockSecretPasteEnabled:       effective.UserPromptSecretBlockEnabled,
		EffectiveHookPreToolUseBlockDangerousCommandEnabled:        effective.PreToolUseDangerousCommandBlockEnabled,
		EffectiveHookPreToolUseProtectedGovernancePaths:            cloneStrings(effective.PreToolUseProtectedGovernancePaths),
		EffectiveHookSessionStartEnabledSource:                     resolveBoolSource(loadResult.overrides.HookSessionStartEnabled, runtimeOverrides.HookSessionStartEnabled),
		EffectiveHookSessionStartContextPathsSource:                resolvePathsSource(loadResult.overrides.HookSessionStartContextPaths, runtimeOverrides.HookSessionStartContextPaths),
		EffectiveHookSessionStartMaxCharsSource:                    resolveIntSource(loadResult.overrides.HookSessionStartMaxChars, runtimeOverrides.HookSessionStartMaxChars),
		EffectiveHookSessionStartTemplateSource:                    resolveStringSource(loadResult.overrides.HookSessionStartTemplate, runtimeOverrides.HookSessionStartTemplate),
		EffectiveHookUserPromptSubmitBlockSecretPasteSource:        resolveBoolSource(loadResult.overrides.HookUserPromptSubmitBlockSecretPasteEnabled, runtimeOverrides.HookUserPromptSubmitBlockSecretPasteEnabled),
		EffectiveHookPreToolUseDangerousCommandBlockSource:         resolveBoolSource(loadResult.overrides.HookPreToolUseBlockDangerousCommandEnabled, runtimeOverrides.HookPreToolUseBlockDangerousCommandEnabled),
		EffectiveHookPreToolUseProtectedGovernancePathsSource:      resolvePathsSource(loadResult.overrides.HookPreToolUseAdditionalProtectedGovernancePaths, runtimeOverrides.HookPreToolUseAdditionalProtectedGovernancePaths),
	}
}

func NormalizeWorkspaceConfigOverrides(input WorkspaceConfigOverrides) (WorkspaceConfigOverrides, error) {
	result := WorkspaceConfigOverrides{
		HookSessionStartEnabled: cloneOptionalBool(input.HookSessionStartEnabled),
		HookSessionStartContextPaths: cloneStrings(
			NormalizeSessionStartContextPaths(input.HookSessionStartContextPaths),
		),
		HookSessionStartMaxChars:                    cloneOptionalInt(input.HookSessionStartMaxChars),
		HookSessionStartTemplate:                    cloneOptionalString(input.HookSessionStartTemplate),
		HookUserPromptSubmitBlockSecretPasteEnabled: cloneOptionalBool(input.HookUserPromptSubmitBlockSecretPasteEnabled),
		HookPreToolUseBlockDangerousCommandEnabled:  cloneOptionalBool(input.HookPreToolUseBlockDangerousCommandEnabled),
		HookPreToolUseAdditionalProtectedGovernancePaths: cloneStrings(
			NormalizeProtectedGovernancePaths(input.HookPreToolUseAdditionalProtectedGovernancePaths),
		),
	}

	if result.HookSessionStartMaxChars != nil && *result.HookSessionStartMaxChars <= 0 {
		return WorkspaceConfigOverrides{}, errors.New("hookSessionStartMaxChars must be a positive integer")
	}
	if result.HookSessionStartTemplate != nil {
		normalizedTemplate, err := NormalizeSessionStartTemplate(*result.HookSessionStartTemplate)
		if err != nil {
			return WorkspaceConfigOverrides{}, err
		}
		result.HookSessionStartTemplate = &normalizedTemplate
	}

	return result, nil
}

func NormalizeSessionStartTemplate(value string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if normalized == "" {
		return "", errors.New("hookSessionStartTemplate must not be empty")
	}
	if !strings.Contains(normalized, "{{context}}") {
		return "", errors.New("hookSessionStartTemplate must include {{context}}")
	}
	if !strings.Contains(normalized, "{{user_request}}") {
		return "", errors.New("hookSessionStartTemplate must include {{user_request}}")
	}
	return normalized, nil
}

func NormalizeSessionStartContextPaths(values []string) []string {
	return normalizeRelativePathList(values)
}

func NormalizeProtectedGovernancePaths(values []string) []string {
	return normalizeRelativePathList(values)
}

func normalizeRelativePathList(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	items := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		normalized := strings.ReplaceAll(trimmed, "\\", "/")
		for strings.Contains(normalized, "//") {
			normalized = strings.ReplaceAll(normalized, "//", "/")
		}
		normalized = strings.TrimPrefix(normalized, "./")
		key := strings.ToLower(normalized)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		items = append(items, normalized)
	}
	if len(items) == 0 {
		return nil
	}
	return items
}

func loadWorkspaceConfig(workspace store.Workspace) workspaceConfigLoadResult {
	searched := workspaceHookConfigurationReadPaths(workspace.RootPath)
	if len(searched) == 0 {
		return workspaceConfigLoadResult{
			loadStatus: WorkspaceConfigLoadStatusNotFound,
		}
	}

	for _, path := range searched {
		info, err := os.Stat(path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return workspaceConfigLoadResult{
				loadStatus: WorkspaceConfigLoadStatusError,
				loadError:  err.Error(),
				loadedFrom: path,
				searched:   searched,
			}
		}
		if info.IsDir() {
			return workspaceConfigLoadResult{
				loadStatus: WorkspaceConfigLoadStatusError,
				loadError:  "hooks configuration path is a directory",
				loadedFrom: path,
				searched:   searched,
			}
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return workspaceConfigLoadResult{
				loadStatus: WorkspaceConfigLoadStatusError,
				loadError:  err.Error(),
				loadedFrom: path,
				searched:   searched,
			}
		}

		var fileConfig WorkspaceFileConfig
		if err := json.Unmarshal(content, &fileConfig); err != nil {
			return workspaceConfigLoadResult{
				loadStatus: WorkspaceConfigLoadStatusError,
				loadError:  "invalid hooks.json: " + err.Error(),
				loadedFrom: path,
				searched:   searched,
			}
		}

		overrides, err := normalizeWorkspaceFileConfig(fileConfig)
		if err != nil {
			return workspaceConfigLoadResult{
				loadStatus: WorkspaceConfigLoadStatusError,
				loadError:  err.Error(),
				loadedFrom: path,
				searched:   searched,
			}
		}

		return workspaceConfigLoadResult{
			loadStatus: WorkspaceConfigLoadStatusLoaded,
			loadedFrom: path,
			searched:   searched,
			overrides:  overrides,
		}
	}

	return workspaceConfigLoadResult{
		loadStatus: WorkspaceConfigLoadStatusNotFound,
		searched:   searched,
	}
}

func workspaceHookConfigurationReadPaths(rootPath string) []string {
	paths := workspaceHookConfigurationWritePaths(rootPath)
	codexHome := discoverCodexHomePath()
	if codexHome != "" {
		paths = append(paths, filepath.Join(codexHome, "hooks.json"))
	}
	return dedupeHookConfigurationPaths(paths)
}

func workspaceHookConfigurationWritePaths(rootPath string) []string {
	trimmed := strings.TrimSpace(rootPath)
	if trimmed == "" {
		return nil
	}

	return []string{
		filepath.Join(trimmed, ".codex", "hooks.json"),
		filepath.Join(trimmed, "hooks.json"),
	}
}

func dedupeHookConfigurationPaths(paths []string) []string {
	if len(paths) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(paths))
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}
		cleaned := filepath.Clean(trimmed)
		if _, exists := seen[cleaned]; exists {
			continue
		}
		seen[cleaned] = struct{}{}
		result = append(result, cleaned)
	}
	return result
}

func normalizeWorkspaceFileConfig(fileConfig WorkspaceFileConfig) (WorkspaceConfigOverrides, error) {
	result := WorkspaceConfigOverrides{}

	if fileConfig.SessionStart != nil {
		result.HookSessionStartEnabled = cloneOptionalBool(fileConfig.SessionStart.Enabled)
		result.HookSessionStartContextPaths = cloneStrings(
			NormalizeSessionStartContextPaths(fileConfig.SessionStart.ContextPaths),
		)
		if fileConfig.SessionStart.MaxChars != nil {
			if *fileConfig.SessionStart.MaxChars <= 0 {
				return WorkspaceConfigOverrides{}, errors.New("invalid hooks.json: sessionStart.maxChars must be a positive integer")
			}
			result.HookSessionStartMaxChars = cloneOptionalInt(fileConfig.SessionStart.MaxChars)
		}
		if fileConfig.SessionStart.Template != nil {
			normalizedTemplate, err := NormalizeSessionStartTemplate(*fileConfig.SessionStart.Template)
			if err != nil {
				return WorkspaceConfigOverrides{}, fmt.Errorf("invalid hooks.json: %w", err)
			}
			result.HookSessionStartTemplate = &normalizedTemplate
		}
	}

	if fileConfig.UserPromptSubmit != nil {
		result.HookUserPromptSubmitBlockSecretPasteEnabled = cloneOptionalBool(
			fileConfig.UserPromptSubmit.BlockSecretPasteEnabled,
		)
	}

	if fileConfig.PreToolUse != nil {
		result.HookPreToolUseBlockDangerousCommandEnabled = cloneOptionalBool(
			fileConfig.PreToolUse.BlockDangerousCommandEnabled,
		)
		result.HookPreToolUseAdditionalProtectedGovernancePaths = cloneStrings(
			NormalizeProtectedGovernancePaths(fileConfig.PreToolUse.AdditionalProtectedGovernancePaths),
		)
	}

	return result, nil
}

func HasWorkspaceConfigOverrides(input WorkspaceConfigOverrides) bool {
	return input.HookSessionStartEnabled != nil ||
		len(input.HookSessionStartContextPaths) > 0 ||
		input.HookSessionStartMaxChars != nil ||
		input.HookSessionStartTemplate != nil ||
		input.HookUserPromptSubmitBlockSecretPasteEnabled != nil ||
		input.HookPreToolUseBlockDangerousCommandEnabled != nil ||
		len(input.HookPreToolUseAdditionalProtectedGovernancePaths) > 0
}

func RenderWorkspaceFileConfig(input WorkspaceConfigOverrides) ([]byte, error) {
	normalized, err := NormalizeWorkspaceConfigOverrides(input)
	if err != nil {
		return nil, err
	}

	fileConfig := WorkspaceFileConfig{
		Version: 1,
	}
	if normalized.HookSessionStartEnabled != nil ||
		len(normalized.HookSessionStartContextPaths) > 0 ||
		normalized.HookSessionStartMaxChars != nil ||
		normalized.HookSessionStartTemplate != nil {
		fileConfig.SessionStart = &WorkspaceFileSessionStartConfig{
			Enabled:      cloneOptionalBool(normalized.HookSessionStartEnabled),
			ContextPaths: cloneStrings(normalized.HookSessionStartContextPaths),
			MaxChars:     cloneOptionalInt(normalized.HookSessionStartMaxChars),
			Template:     cloneOptionalString(normalized.HookSessionStartTemplate),
		}
	}
	if normalized.HookUserPromptSubmitBlockSecretPasteEnabled != nil {
		fileConfig.UserPromptSubmit = &WorkspaceFileUserPromptConfig{
			BlockSecretPasteEnabled: cloneOptionalBool(
				normalized.HookUserPromptSubmitBlockSecretPasteEnabled,
			),
		}
	}
	if normalized.HookPreToolUseBlockDangerousCommandEnabled != nil {
		fileConfig.PreToolUse = &WorkspaceFilePreToolUseConfig{
			BlockDangerousCommandEnabled: cloneOptionalBool(
				normalized.HookPreToolUseBlockDangerousCommandEnabled,
			),
		}
	}
	if len(normalized.HookPreToolUseAdditionalProtectedGovernancePaths) > 0 {
		if fileConfig.PreToolUse == nil {
			fileConfig.PreToolUse = &WorkspaceFilePreToolUseConfig{}
		}
		fileConfig.PreToolUse.AdditionalProtectedGovernancePaths = cloneStrings(
			normalized.HookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}

	return json.MarshalIndent(fileConfig, "", "  ")
}

func resolveBoolSource(workspaceValue *bool, runtimeValue *bool) string {
	if runtimeValue != nil {
		return ConfigSourceRuntime
	}
	if workspaceValue != nil {
		return ConfigSourceWorkspace
	}
	return ConfigSourceDefault
}

func resolveIntSource(workspaceValue *int, runtimeValue *int) string {
	if runtimeValue != nil {
		return ConfigSourceRuntime
	}
	if workspaceValue != nil {
		return ConfigSourceWorkspace
	}
	return ConfigSourceDefault
}

func resolvePathsSource(workspaceValue []string, runtimeValue []string) string {
	if len(runtimeValue) > 0 {
		return ConfigSourceRuntime
	}
	if len(workspaceValue) > 0 {
		return ConfigSourceWorkspace
	}
	return ConfigSourceDefault
}

func resolveStringSource(workspaceValue *string, runtimeValue *string) string {
	if runtimeValue != nil {
		return ConfigSourceRuntime
	}
	if workspaceValue != nil {
		return ConfigSourceWorkspace
	}
	return ConfigSourceDefault
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	return append([]string(nil), values...)
}

func appendUniquePaths(base []string, additional []string) []string {
	if len(additional) == 0 {
		return cloneStrings(base)
	}

	result := cloneStrings(base)
	seen := make(map[string]struct{}, len(result))
	for _, value := range result {
		seen[strings.ToLower(strings.TrimSpace(value))] = struct{}{}
	}
	for _, value := range additional {
		key := strings.ToLower(strings.TrimSpace(value))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}

func cloneOptionalBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneOptionalInt(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
