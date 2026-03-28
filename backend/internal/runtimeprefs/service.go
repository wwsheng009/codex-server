package runtimeprefs

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"strings"

	appconfig "codex-server/backend/internal/config"
	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store        *store.MemoryStore
	runtimes     *runtime.Manager
	baseCommand  string
	defaultPrefs appconfig.RuntimePreferences
	defaultTrace diagnostics.ThreadTraceConfig
}

type ReadResult struct {
	ConfiguredModelCatalogPath              string            `json:"configuredModelCatalogPath"`
	ConfiguredDefaultShellType              string            `json:"configuredDefaultShellType"`
	ConfiguredDefaultTerminalShell          string            `json:"configuredDefaultTerminalShell"`
	SupportedTerminalShells                 []string          `json:"supportedTerminalShells"`
	ConfiguredModelShellTypeOverrides       map[string]string `json:"configuredModelShellTypeOverrides"`
	ConfiguredOutboundProxyURL              string            `json:"configuredOutboundProxyUrl"`
	ConfiguredDefaultTurnApprovalPolicy     string            `json:"configuredDefaultTurnApprovalPolicy"`
	ConfiguredDefaultTurnSandboxPolicy      map[string]any    `json:"configuredDefaultTurnSandboxPolicy"`
	ConfiguredDefaultCommandSandboxPolicy   map[string]any    `json:"configuredDefaultCommandSandboxPolicy"`
	ConfiguredBackendThreadTraceEnabled     *bool             `json:"configuredBackendThreadTraceEnabled"`
	ConfiguredBackendThreadTraceWorkspaceID string            `json:"configuredBackendThreadTraceWorkspaceId"`
	ConfiguredBackendThreadTraceThreadID    string            `json:"configuredBackendThreadTraceThreadId"`
	DefaultModelCatalogPath                 string            `json:"defaultModelCatalogPath"`
	DefaultDefaultShellType                 string            `json:"defaultDefaultShellType"`
	DefaultDefaultTerminalShell             string            `json:"defaultDefaultTerminalShell"`
	DefaultModelShellTypeOverrides          map[string]string `json:"defaultModelShellTypeOverrides"`
	DefaultOutboundProxyURL                 string            `json:"defaultOutboundProxyUrl"`
	DefaultDefaultTurnApprovalPolicy        string            `json:"defaultDefaultTurnApprovalPolicy"`
	DefaultDefaultTurnSandboxPolicy         map[string]any    `json:"defaultDefaultTurnSandboxPolicy"`
	DefaultDefaultCommandSandboxPolicy      map[string]any    `json:"defaultDefaultCommandSandboxPolicy"`
	DefaultBackendThreadTraceEnabled        bool              `json:"defaultBackendThreadTraceEnabled"`
	DefaultBackendThreadTraceWorkspaceID    string            `json:"defaultBackendThreadTraceWorkspaceId"`
	DefaultBackendThreadTraceThreadID       string            `json:"defaultBackendThreadTraceThreadId"`
	EffectiveModelCatalogPath               string            `json:"effectiveModelCatalogPath"`
	EffectiveDefaultShellType               string            `json:"effectiveDefaultShellType"`
	EffectiveDefaultTerminalShell           string            `json:"effectiveDefaultTerminalShell"`
	EffectiveModelShellTypeOverrides        map[string]string `json:"effectiveModelShellTypeOverrides"`
	EffectiveOutboundProxyURL               string            `json:"effectiveOutboundProxyUrl"`
	EffectiveDefaultTurnApprovalPolicy      string            `json:"effectiveDefaultTurnApprovalPolicy"`
	EffectiveDefaultTurnSandboxPolicy       map[string]any    `json:"effectiveDefaultTurnSandboxPolicy"`
	EffectiveDefaultCommandSandboxPolicy    map[string]any    `json:"effectiveDefaultCommandSandboxPolicy"`
	EffectiveBackendThreadTraceEnabled      bool              `json:"effectiveBackendThreadTraceEnabled"`
	EffectiveBackendThreadTraceWorkspaceID  string            `json:"effectiveBackendThreadTraceWorkspaceId"`
	EffectiveBackendThreadTraceThreadID     string            `json:"effectiveBackendThreadTraceThreadId"`
	EffectiveCommand                        string            `json:"effectiveCommand"`
}

type WriteInput struct {
	ModelCatalogPath              string            `json:"modelCatalogPath"`
	DefaultShellType              string            `json:"defaultShellType"`
	DefaultTerminalShell          string            `json:"defaultTerminalShell"`
	ModelShellTypeOverrides       map[string]string `json:"modelShellTypeOverrides"`
	OutboundProxyURL              string            `json:"outboundProxyUrl"`
	DefaultTurnApprovalPolicy     string            `json:"defaultTurnApprovalPolicy"`
	DefaultTurnSandboxPolicy      map[string]any    `json:"defaultTurnSandboxPolicy"`
	DefaultCommandSandboxPolicy   map[string]any    `json:"defaultCommandSandboxPolicy"`
	BackendThreadTraceEnabled     *bool             `json:"backendThreadTraceEnabled"`
	BackendThreadTraceWorkspaceID string            `json:"backendThreadTraceWorkspaceId"`
	BackendThreadTraceThreadID    string            `json:"backendThreadTraceThreadId"`
}

func NewService(
	dataStore *store.MemoryStore,
	runtimeManager *runtime.Manager,
	baseCommand string,
	defaultModelCatalogPath string,
	defaultLocalShellModels []string,
	defaultOutboundProxyURL string,
	defaultThreadTraceEnabled bool,
	defaultThreadTraceWorkspaceID string,
	defaultThreadTraceThreadID string,
) *Service {
	return &Service{
		store:       dataStore,
		runtimes:    runtimeManager,
		baseCommand: baseCommand,
		defaultPrefs: appconfig.RuntimePreferences{
			ModelCatalogPath:            strings.TrimSpace(defaultModelCatalogPath),
			ModelShellTypeOverrides:     localShellModelsToOverrides(defaultLocalShellModels),
			OutboundProxyURL:            strings.TrimSpace(defaultOutboundProxyURL),
			DefaultCommandSandboxPolicy: appconfig.DefaultCommandSandboxPolicy(),
		},
		defaultTrace: diagnostics.ThreadTraceConfig{
			Enabled:     defaultThreadTraceEnabled,
			WorkspaceID: strings.TrimSpace(defaultThreadTraceWorkspaceID),
			ThreadID:    strings.TrimSpace(defaultThreadTraceThreadID),
		},
	}
}

func (s *Service) Read() (ReadResult, error) {
	configuredPrefs, err := normalizeConfiguredPreferences(s.store.GetRuntimePreferences())
	if err != nil {
		return ReadResult{}, err
	}
	effectivePrefs := s.mergeWithDefaults(configuredPrefs)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	return s.buildReadResult(configuredPrefs, resolved), nil
}

func (s *Service) Write(input WriteInput) (ReadResult, error) {
	defaultTurnApprovalPolicy, err := appconfig.NormalizeApprovalPolicy(strings.TrimSpace(input.DefaultTurnApprovalPolicy))
	if err != nil {
		return ReadResult{}, err
	}
	defaultTurnSandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(input.DefaultTurnSandboxPolicy)
	if err != nil {
		return ReadResult{}, err
	}
	defaultCommandSandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(input.DefaultCommandSandboxPolicy)
	if err != nil {
		return ReadResult{}, err
	}
	outboundProxyURL, err := appconfig.NormalizeOutboundProxyURL(input.OutboundProxyURL)
	if err != nil {
		return ReadResult{}, err
	}

	candidateConfigured := store.RuntimePreferences{
		ModelCatalogPath:              strings.TrimSpace(input.ModelCatalogPath),
		DefaultShellType:              strings.TrimSpace(input.DefaultShellType),
		DefaultTerminalShell:          normalizeTerminalShellPreference(input.DefaultTerminalShell),
		ModelShellTypeOverrides:       normalizeInputs(input.ModelShellTypeOverrides),
		OutboundProxyURL:              outboundProxyURL,
		DefaultTurnApprovalPolicy:     defaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:      defaultTurnSandboxPolicy,
		DefaultCommandSandboxPolicy:   defaultCommandSandboxPolicy,
		BackendThreadTraceEnabled:     cloneOptionalBool(input.BackendThreadTraceEnabled),
		BackendThreadTraceWorkspaceID: strings.TrimSpace(input.BackendThreadTraceWorkspaceID),
		BackendThreadTraceThreadID:    strings.TrimSpace(input.BackendThreadTraceThreadID),
	}
	effectivePrefs := s.mergeWithDefaults(candidateConfigured)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	s.store.SetRuntimePreferences(candidateConfigured)
	s.runtimes.ApplyCommand(resolved.Command)
	effectiveTrace := s.resolveThreadTraceConfig(candidateConfigured)
	diagnostics.ConfigureThreadTrace(
		effectiveTrace.Enabled,
		effectiveTrace.WorkspaceID,
		effectiveTrace.ThreadID,
	)

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

	currentConfigured, err := normalizeConfiguredPreferences(s.store.GetRuntimePreferences())
	if err != nil {
		return ReadResult{}, err
	}
	candidateConfigured := store.RuntimePreferences{
		ModelCatalogPath:              targetPath,
		LocalShellModels:              cloneStrings(currentConfigured.LocalShellModels),
		DefaultShellType:              currentConfigured.DefaultShellType,
		DefaultTerminalShell:          currentConfigured.DefaultTerminalShell,
		ModelShellTypeOverrides:       cloneStringMap(currentConfigured.ModelShellTypeOverrides),
		OutboundProxyURL:              currentConfigured.OutboundProxyURL,
		DefaultTurnApprovalPolicy:     currentConfigured.DefaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:      cloneAnyMap(currentConfigured.DefaultTurnSandboxPolicy),
		DefaultCommandSandboxPolicy:   cloneAnyMap(currentConfigured.DefaultCommandSandboxPolicy),
		BackendThreadTraceEnabled:     cloneOptionalBool(currentConfigured.BackendThreadTraceEnabled),
		BackendThreadTraceWorkspaceID: strings.TrimSpace(currentConfigured.BackendThreadTraceWorkspaceID),
		BackendThreadTraceThreadID:    strings.TrimSpace(currentConfigured.BackendThreadTraceThreadID),
	}
	effectivePrefs := s.mergeWithDefaults(candidateConfigured)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	s.store.SetRuntimePreferences(candidateConfigured)
	s.runtimes.ApplyCommand(resolved.Command)
	effectiveTrace := s.resolveThreadTraceConfig(candidateConfigured)
	diagnostics.ConfigureThreadTrace(
		effectiveTrace.Enabled,
		effectiveTrace.WorkspaceID,
		effectiveTrace.ThreadID,
	)

	return s.buildReadResult(candidateConfigured, resolved), nil
}

func (s *Service) mergeWithDefaults(configured store.RuntimePreferences) appconfig.RuntimePreferences {
	merged := appconfig.RuntimePreferences{
		ModelCatalogPath:            configured.ModelCatalogPath,
		LocalShellModels:            cloneStrings(configured.LocalShellModels),
		DefaultShellType:            configured.DefaultShellType,
		ModelShellTypeOverrides:     cloneStringMap(configured.ModelShellTypeOverrides),
		OutboundProxyURL:            configured.OutboundProxyURL,
		DefaultTurnApprovalPolicy:   configured.DefaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:    cloneAnyMap(configured.DefaultTurnSandboxPolicy),
		DefaultCommandSandboxPolicy: cloneAnyMap(configured.DefaultCommandSandboxPolicy),
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
	if merged.OutboundProxyURL == "" {
		merged.OutboundProxyURL = s.defaultPrefs.OutboundProxyURL
	}
	if merged.DefaultTurnApprovalPolicy == "" {
		merged.DefaultTurnApprovalPolicy = s.defaultPrefs.DefaultTurnApprovalPolicy
	}
	if len(merged.DefaultTurnSandboxPolicy) == 0 {
		merged.DefaultTurnSandboxPolicy = cloneAnyMap(s.defaultPrefs.DefaultTurnSandboxPolicy)
	}
	if len(merged.DefaultCommandSandboxPolicy) == 0 {
		merged.DefaultCommandSandboxPolicy = cloneAnyMap(s.defaultPrefs.DefaultCommandSandboxPolicy)
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

func normalizeConfiguredPreferences(input store.RuntimePreferences) (store.RuntimePreferences, error) {
	defaultTurnApprovalPolicy, err := appconfig.NormalizeApprovalPolicy(input.DefaultTurnApprovalPolicy)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	defaultTurnSandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(input.DefaultTurnSandboxPolicy)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	defaultCommandSandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(input.DefaultCommandSandboxPolicy)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	outboundProxyURL, err := appconfig.NormalizeOutboundProxyURL(input.OutboundProxyURL)
	if err != nil {
		return store.RuntimePreferences{}, err
	}

	input.DefaultTurnApprovalPolicy = defaultTurnApprovalPolicy
	input.DefaultTerminalShell = normalizeTerminalShellPreference(input.DefaultTerminalShell)
	input.OutboundProxyURL = outboundProxyURL
	input.DefaultTurnSandboxPolicy = defaultTurnSandboxPolicy
	input.DefaultCommandSandboxPolicy = defaultCommandSandboxPolicy
	input.BackendThreadTraceEnabled = cloneOptionalBool(input.BackendThreadTraceEnabled)
	input.BackendThreadTraceWorkspaceID = strings.TrimSpace(input.BackendThreadTraceWorkspaceID)
	input.BackendThreadTraceThreadID = strings.TrimSpace(input.BackendThreadTraceThreadID)
	return input, nil
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

func cloneAnyMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = cloneAnyValue(value)
	}
	return cloned
}

func cloneAnyValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneAnyMap(typed)
	case []any:
		cloned := make([]any, len(typed))
		for index, entry := range typed {
			cloned[index] = cloneAnyValue(entry)
		}
		return cloned
	default:
		return typed
	}
}

func cloneOptionalBool(value *bool) *bool {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func (s *Service) resolveThreadTraceConfig(configured store.RuntimePreferences) diagnostics.ThreadTraceConfig {
	hasOverride :=
		configured.BackendThreadTraceEnabled != nil ||
			strings.TrimSpace(configured.BackendThreadTraceWorkspaceID) != "" ||
			strings.TrimSpace(configured.BackendThreadTraceThreadID) != ""
	if !hasOverride {
		return s.defaultTrace
	}

	enabled := s.defaultTrace.Enabled
	if configured.BackendThreadTraceEnabled != nil {
		enabled = *configured.BackendThreadTraceEnabled
	}

	return diagnostics.ThreadTraceConfig{
		Enabled:     enabled,
		WorkspaceID: strings.TrimSpace(configured.BackendThreadTraceWorkspaceID),
		ThreadID:    strings.TrimSpace(configured.BackendThreadTraceThreadID),
	}
}

func (s *Service) buildReadResult(
	configuredPrefs store.RuntimePreferences,
	resolved appconfig.ResolvedRuntime,
) ReadResult {
	effectiveTrace := s.resolveThreadTraceConfig(configuredPrefs)

	return ReadResult{
		ConfiguredModelCatalogPath:              configuredPrefs.ModelCatalogPath,
		ConfiguredDefaultShellType:              configuredPrefs.DefaultShellType,
		ConfiguredDefaultTerminalShell:          configuredPrefs.DefaultTerminalShell,
		SupportedTerminalShells:                 detectSupportedTerminalShells(),
		ConfiguredModelShellTypeOverrides:       cloneStringMap(configuredPrefs.ModelShellTypeOverrides),
		ConfiguredOutboundProxyURL:              configuredPrefs.OutboundProxyURL,
		ConfiguredDefaultTurnApprovalPolicy:     configuredPrefs.DefaultTurnApprovalPolicy,
		ConfiguredDefaultTurnSandboxPolicy:      cloneAnyMap(configuredPrefs.DefaultTurnSandboxPolicy),
		ConfiguredDefaultCommandSandboxPolicy:   cloneAnyMap(configuredPrefs.DefaultCommandSandboxPolicy),
		ConfiguredBackendThreadTraceEnabled:     cloneOptionalBool(configuredPrefs.BackendThreadTraceEnabled),
		ConfiguredBackendThreadTraceWorkspaceID: strings.TrimSpace(configuredPrefs.BackendThreadTraceWorkspaceID),
		ConfiguredBackendThreadTraceThreadID:    strings.TrimSpace(configuredPrefs.BackendThreadTraceThreadID),
		DefaultModelCatalogPath:                 s.defaultPrefs.ModelCatalogPath,
		DefaultDefaultShellType:                 s.defaultPrefs.DefaultShellType,
		DefaultDefaultTerminalShell:             "auto",
		DefaultModelShellTypeOverrides:          cloneStringMap(s.defaultPrefs.ModelShellTypeOverrides),
		DefaultOutboundProxyURL:                 s.defaultPrefs.OutboundProxyURL,
		DefaultDefaultTurnApprovalPolicy:        s.defaultPrefs.DefaultTurnApprovalPolicy,
		DefaultDefaultTurnSandboxPolicy:         cloneAnyMap(s.defaultPrefs.DefaultTurnSandboxPolicy),
		DefaultDefaultCommandSandboxPolicy:      cloneAnyMap(s.defaultPrefs.DefaultCommandSandboxPolicy),
		DefaultBackendThreadTraceEnabled:        s.defaultTrace.Enabled,
		DefaultBackendThreadTraceWorkspaceID:    s.defaultTrace.WorkspaceID,
		DefaultBackendThreadTraceThreadID:       s.defaultTrace.ThreadID,
		EffectiveModelCatalogPath:               resolved.EffectiveModelCatalogPath,
		EffectiveDefaultShellType:               resolved.Preferences.DefaultShellType,
		EffectiveDefaultTerminalShell:           effectiveTerminalShellPreference(configuredPrefs.DefaultTerminalShell),
		EffectiveModelShellTypeOverrides:        cloneStringMap(resolved.Preferences.ModelShellTypeOverrides),
		EffectiveOutboundProxyURL:               resolved.Preferences.OutboundProxyURL,
		EffectiveDefaultTurnApprovalPolicy:      resolved.Preferences.DefaultTurnApprovalPolicy,
		EffectiveDefaultTurnSandboxPolicy:       cloneAnyMap(resolved.Preferences.DefaultTurnSandboxPolicy),
		EffectiveDefaultCommandSandboxPolicy:    cloneAnyMap(resolved.Preferences.DefaultCommandSandboxPolicy),
		EffectiveBackendThreadTraceEnabled:      effectiveTrace.Enabled,
		EffectiveBackendThreadTraceWorkspaceID:  effectiveTrace.WorkspaceID,
		EffectiveBackendThreadTraceThreadID:     effectiveTrace.ThreadID,
		EffectiveCommand:                        resolved.Command,
	}
}

func detectSupportedTerminalShells() []string {
	items := make([]string, 0, 8)
	seen := make(map[string]struct{}, 8)

	add := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		if _, ok := seen[trimmed]; ok {
			return
		}
		seen[trimmed] = struct{}{}
		items = append(items, trimmed)
	}

	if stdruntime.GOOS == "windows" {
		if shellExists("pwsh.exe", "pwsh") {
			add("pwsh")
		}
		if shellExists("powershell.exe", "powershell") {
			add("powershell")
		}
		if strings.TrimSpace(os.Getenv("ComSpec")) != "" || shellExists("cmd.exe") {
			add("cmd")
		}
		if shellExists("wsl.exe", "wsl") {
			add("wsl")
		}
		if gitBashPath, ok := resolvePreferredGitBashPath(exec.LookPath); ok && strings.TrimSpace(gitBashPath) != "" {
			add("git-bash")
		}
	}

	if stdruntime.GOOS != "windows" && shellExists("bash", "/bin/bash", "/usr/bin/bash") {
		add("bash")
	}
	if shellExists("zsh", "/bin/zsh", "/usr/bin/zsh") {
		add("zsh")
	}
	if shellExists("sh", "/bin/sh", "/usr/bin/sh") {
		add("sh")
	}

	return items
}

func shellExists(candidates ...string) bool {
	for _, candidate := range candidates {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}

		if filepath.IsAbs(trimmed) {
			if info, err := os.Stat(trimmed); err == nil && !info.IsDir() {
				return true
			}
			continue
		}

		if resolved, err := exec.LookPath(trimmed); err == nil && strings.TrimSpace(resolved) != "" {
			return true
		}
	}

	return false
}

func resolvePreferredGitBashPath(lookPath func(string) (string, error)) (string, bool) {
	if gitPath, err := lookPath("git.exe"); err == nil && strings.TrimSpace(gitPath) != "" {
		gitRoot := filepath.Clean(filepath.Join(filepath.Dir(gitPath), ".."))
		for _, candidate := range []string{
			filepath.Join(gitRoot, "bin", "bash.exe"),
			filepath.Join(gitRoot, "git-bash.exe"),
			filepath.Join(gitRoot, "usr", "bin", "bash.exe"),
		} {
			if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
				return candidate, true
			}
		}
	}

	for _, candidate := range []string{
		`C:\Program Files\Git\bin\bash.exe`,
		`C:\Program Files\Git\git-bash.exe`,
		`C:\Program Files\Git\usr\bin\bash.exe`,
	} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
	}

	return "", false
}

func normalizeTerminalShellPreference(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "auto":
		return ""
	case "pwsh", "powershell", "cmd", "bash", "zsh", "sh":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func effectiveTerminalShellPreference(value string) string {
	normalized := normalizeTerminalShellPreference(value)
	if normalized == "" {
		return "auto"
	}

	return normalized
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
