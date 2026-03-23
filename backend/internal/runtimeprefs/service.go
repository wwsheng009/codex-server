package runtimeprefs

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
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
	ConfiguredModelCatalogPath            string            `json:"configuredModelCatalogPath"`
	ConfiguredDefaultShellType            string            `json:"configuredDefaultShellType"`
	ConfiguredDefaultTerminalShell        string            `json:"configuredDefaultTerminalShell"`
	SupportedTerminalShells               []string          `json:"supportedTerminalShells"`
	ConfiguredModelShellTypeOverrides     map[string]string `json:"configuredModelShellTypeOverrides"`
	ConfiguredDefaultTurnApprovalPolicy   string            `json:"configuredDefaultTurnApprovalPolicy"`
	ConfiguredDefaultTurnSandboxPolicy    map[string]any    `json:"configuredDefaultTurnSandboxPolicy"`
	ConfiguredDefaultCommandSandboxPolicy map[string]any    `json:"configuredDefaultCommandSandboxPolicy"`
	DefaultModelCatalogPath               string            `json:"defaultModelCatalogPath"`
	DefaultDefaultShellType               string            `json:"defaultDefaultShellType"`
	DefaultDefaultTerminalShell           string            `json:"defaultDefaultTerminalShell"`
	DefaultModelShellTypeOverrides        map[string]string `json:"defaultModelShellTypeOverrides"`
	DefaultDefaultTurnApprovalPolicy      string            `json:"defaultDefaultTurnApprovalPolicy"`
	DefaultDefaultTurnSandboxPolicy       map[string]any    `json:"defaultDefaultTurnSandboxPolicy"`
	DefaultDefaultCommandSandboxPolicy    map[string]any    `json:"defaultDefaultCommandSandboxPolicy"`
	EffectiveModelCatalogPath             string            `json:"effectiveModelCatalogPath"`
	EffectiveDefaultShellType             string            `json:"effectiveDefaultShellType"`
	EffectiveDefaultTerminalShell         string            `json:"effectiveDefaultTerminalShell"`
	EffectiveModelShellTypeOverrides      map[string]string `json:"effectiveModelShellTypeOverrides"`
	EffectiveDefaultTurnApprovalPolicy    string            `json:"effectiveDefaultTurnApprovalPolicy"`
	EffectiveDefaultTurnSandboxPolicy     map[string]any    `json:"effectiveDefaultTurnSandboxPolicy"`
	EffectiveDefaultCommandSandboxPolicy  map[string]any    `json:"effectiveDefaultCommandSandboxPolicy"`
	EffectiveCommand                      string            `json:"effectiveCommand"`
}

type WriteInput struct {
	ModelCatalogPath            string            `json:"modelCatalogPath"`
	DefaultShellType            string            `json:"defaultShellType"`
	DefaultTerminalShell        string            `json:"defaultTerminalShell"`
	ModelShellTypeOverrides     map[string]string `json:"modelShellTypeOverrides"`
	DefaultTurnApprovalPolicy   string            `json:"defaultTurnApprovalPolicy"`
	DefaultTurnSandboxPolicy    map[string]any    `json:"defaultTurnSandboxPolicy"`
	DefaultCommandSandboxPolicy map[string]any    `json:"defaultCommandSandboxPolicy"`
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
			ModelCatalogPath:            strings.TrimSpace(defaultModelCatalogPath),
			ModelShellTypeOverrides:     localShellModelsToOverrides(defaultLocalShellModels),
			DefaultCommandSandboxPolicy: appconfig.DefaultCommandSandboxPolicy(),
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

	candidateConfigured := store.RuntimePreferences{
		ModelCatalogPath:            strings.TrimSpace(input.ModelCatalogPath),
		DefaultShellType:            strings.TrimSpace(input.DefaultShellType),
		DefaultTerminalShell:        normalizeTerminalShellPreference(input.DefaultTerminalShell),
		ModelShellTypeOverrides:     normalizeInputs(input.ModelShellTypeOverrides),
		DefaultTurnApprovalPolicy:   defaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:    defaultTurnSandboxPolicy,
		DefaultCommandSandboxPolicy: defaultCommandSandboxPolicy,
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

	currentConfigured, err := normalizeConfiguredPreferences(s.store.GetRuntimePreferences())
	if err != nil {
		return ReadResult{}, err
	}
	candidateConfigured := store.RuntimePreferences{
		ModelCatalogPath:            targetPath,
		LocalShellModels:            cloneStrings(currentConfigured.LocalShellModels),
		DefaultShellType:            currentConfigured.DefaultShellType,
		DefaultTerminalShell:        currentConfigured.DefaultTerminalShell,
		ModelShellTypeOverrides:     cloneStringMap(currentConfigured.ModelShellTypeOverrides),
		DefaultTurnApprovalPolicy:   currentConfigured.DefaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:    cloneAnyMap(currentConfigured.DefaultTurnSandboxPolicy),
		DefaultCommandSandboxPolicy: cloneAnyMap(currentConfigured.DefaultCommandSandboxPolicy),
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
		ModelCatalogPath:            configured.ModelCatalogPath,
		LocalShellModels:            cloneStrings(configured.LocalShellModels),
		DefaultShellType:            configured.DefaultShellType,
		ModelShellTypeOverrides:     cloneStringMap(configured.ModelShellTypeOverrides),
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

	input.DefaultTurnApprovalPolicy = defaultTurnApprovalPolicy
	input.DefaultTerminalShell = normalizeTerminalShellPreference(input.DefaultTerminalShell)
	input.DefaultTurnSandboxPolicy = defaultTurnSandboxPolicy
	input.DefaultCommandSandboxPolicy = defaultCommandSandboxPolicy
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

func (s *Service) buildReadResult(
	configuredPrefs store.RuntimePreferences,
	resolved appconfig.ResolvedRuntime,
) ReadResult {
	return ReadResult{
		ConfiguredModelCatalogPath:            configuredPrefs.ModelCatalogPath,
		ConfiguredDefaultShellType:            configuredPrefs.DefaultShellType,
		ConfiguredDefaultTerminalShell:        configuredPrefs.DefaultTerminalShell,
		SupportedTerminalShells:               detectSupportedTerminalShells(),
		ConfiguredModelShellTypeOverrides:     cloneStringMap(configuredPrefs.ModelShellTypeOverrides),
		ConfiguredDefaultTurnApprovalPolicy:   configuredPrefs.DefaultTurnApprovalPolicy,
		ConfiguredDefaultTurnSandboxPolicy:    cloneAnyMap(configuredPrefs.DefaultTurnSandboxPolicy),
		ConfiguredDefaultCommandSandboxPolicy: cloneAnyMap(configuredPrefs.DefaultCommandSandboxPolicy),
		DefaultModelCatalogPath:               s.defaultPrefs.ModelCatalogPath,
		DefaultDefaultShellType:               s.defaultPrefs.DefaultShellType,
		DefaultDefaultTerminalShell:           "auto",
		DefaultModelShellTypeOverrides:        cloneStringMap(s.defaultPrefs.ModelShellTypeOverrides),
		DefaultDefaultTurnApprovalPolicy:      s.defaultPrefs.DefaultTurnApprovalPolicy,
		DefaultDefaultTurnSandboxPolicy:       cloneAnyMap(s.defaultPrefs.DefaultTurnSandboxPolicy),
		DefaultDefaultCommandSandboxPolicy:    cloneAnyMap(s.defaultPrefs.DefaultCommandSandboxPolicy),
		EffectiveModelCatalogPath:             resolved.EffectiveModelCatalogPath,
		EffectiveDefaultShellType:             resolved.Preferences.DefaultShellType,
		EffectiveDefaultTerminalShell:         effectiveTerminalShellPreference(configuredPrefs.DefaultTerminalShell),
		EffectiveModelShellTypeOverrides:      cloneStringMap(resolved.Preferences.ModelShellTypeOverrides),
		EffectiveDefaultTurnApprovalPolicy:    resolved.Preferences.DefaultTurnApprovalPolicy,
		EffectiveDefaultTurnSandboxPolicy:     cloneAnyMap(resolved.Preferences.DefaultTurnSandboxPolicy),
		EffectiveDefaultCommandSandboxPolicy:  cloneAnyMap(resolved.Preferences.DefaultCommandSandboxPolicy),
		EffectiveCommand:                      resolved.Command,
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
