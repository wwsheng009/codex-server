package config

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	toml "github.com/pelletier/go-toml/v2"
)

type Config struct {
	Addr                  string
	FrontendOrigin        string
	BaseCodexCommand      string
	CodexCommand          string
	CodexModelCatalogJSON string
	CodexLocalShellModels []string
	StorePath             string
}

type RuntimePreferences struct {
	ModelCatalogPath            string
	LocalShellModels            []string
	DefaultShellType            string
	ModelShellTypeOverrides     map[string]string
	DefaultTurnApprovalPolicy   string
	DefaultTurnSandboxPolicy    map[string]any
	DefaultCommandSandboxPolicy map[string]any
}

type ResolvedRuntime struct {
	Command                   string
	EffectiveModelCatalogPath string
	Preferences               RuntimePreferences
}

func FromEnv() (Config, error) {
	modelCatalogPath := strings.TrimSpace(getEnv("CODEX_MODEL_CATALOG_JSON", ""))
	if modelCatalogPath == "" {
		modelCatalogPath = discoverModelCatalogPath()
	}
	localShellModels := parseCSVEnv(getEnv("CODEX_LOCAL_SHELL_MODELS", ""))
	codexCommand := getEnv("CODEX_APP_SERVER_COMMAND", "codex app-server --listen stdio://")
	resolved, err := ResolveCodexRuntime(codexCommand, RuntimePreferences{
		ModelCatalogPath: modelCatalogPath,
		LocalShellModels: localShellModels,
	})
	if err != nil {
		return Config{}, err
	}

	return Config{
		Addr:                  getEnv("CODEX_SERVER_ADDR", ":18080"),
		FrontendOrigin:        getEnv("CODEX_FRONTEND_ORIGIN", "http://0.0.0.0:15173"),
		BaseCodexCommand:      codexCommand,
		CodexCommand:          resolved.Command,
		CodexModelCatalogJSON: resolved.Preferences.ModelCatalogPath,
		CodexLocalShellModels: resolved.Preferences.LocalShellModels,
		StorePath:             getEnv("CODEX_SERVER_STORE_PATH", "data/metadata.json"),
	}, nil
}

func ResolveCodexRuntime(baseCommand string, prefs RuntimePreferences) (ResolvedRuntime, error) {
	modelCatalogPath := strings.TrimSpace(prefs.ModelCatalogPath)
	localShellModels := normalizeModelTargets(prefs.LocalShellModels)
	defaultShellType, err := normalizeShellType(prefs.DefaultShellType)
	if err != nil {
		return ResolvedRuntime{}, err
	}
	defaultTurnApprovalPolicy, err := NormalizeApprovalPolicy(prefs.DefaultTurnApprovalPolicy)
	if err != nil {
		return ResolvedRuntime{}, err
	}
	defaultTurnSandboxPolicy, err := NormalizeSandboxPolicyMap(prefs.DefaultTurnSandboxPolicy)
	if err != nil {
		return ResolvedRuntime{}, err
	}
	defaultCommandSandboxPolicy, err := NormalizeSandboxPolicyMap(prefs.DefaultCommandSandboxPolicy)
	if err != nil {
		return ResolvedRuntime{}, err
	}
	modelShellTypeOverrides, err := normalizeModelShellTypeOverrides(prefs.ModelShellTypeOverrides)
	if err != nil {
		return ResolvedRuntime{}, err
	}
	for _, model := range localShellModels {
		modelShellTypeOverrides[normalizeModelTarget(model)] = "local"
	}
	effectiveCatalogPath := modelCatalogPath

	if defaultShellType != "" || len(modelShellTypeOverrides) > 0 {
		if containsModelCatalogOverride(baseCommand) {
			return ResolvedRuntime{}, errors.New("runtime shell overrides cannot be used when CODEX_APP_SERVER_COMMAND already contains model_catalog_json; remove the inline override and use CODEX_MODEL_CATALOG_JSON or runtime preferences instead")
		}
		if effectiveCatalogPath == "" {
			return ResolvedRuntime{}, errors.New("runtime shell overrides require a full model catalog JSON file. Set Model Catalog Path in Settings, set CODEX_MODEL_CATALOG_JSON, add model_catalog_json to Codex config.toml, or keep a local codex checkout with codex-rs/core/models.json")
		}

		generatedCatalogPath, err := buildShellTypeCatalog(
			effectiveCatalogPath,
			defaultShellType,
			modelShellTypeOverrides,
		)
		if err != nil {
			return ResolvedRuntime{}, err
		}
		effectiveCatalogPath = generatedCatalogPath
	}

	return ResolvedRuntime{
		Command:                   applyModelCatalogOverride(baseCommand, effectiveCatalogPath),
		EffectiveModelCatalogPath: effectiveCatalogPath,
		Preferences: RuntimePreferences{
			ModelCatalogPath:            modelCatalogPath,
			LocalShellModels:            localShellModels,
			DefaultShellType:            defaultShellType,
			ModelShellTypeOverrides:     modelShellTypeOverrides,
			DefaultTurnApprovalPolicy:   defaultTurnApprovalPolicy,
			DefaultTurnSandboxPolicy:    defaultTurnSandboxPolicy,
			DefaultCommandSandboxPolicy: defaultCommandSandboxPolicy,
		},
	}, nil
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

func applyModelCatalogOverride(command string, modelCatalogPath string) string {
	command = strings.TrimSpace(command)
	modelCatalogPath = strings.TrimSpace(modelCatalogPath)
	if command == "" || modelCatalogPath == "" {
		return command
	}
	if containsModelCatalogOverride(command) {
		return command
	}

	override := fmt.Sprintf("model_catalog_json=%s", modelCatalogPath)
	return fmt.Sprintf("%s --config %s", command, shellQuote(override))
}

func containsModelCatalogOverride(command string) bool {
	return strings.Contains(command, "model_catalog_json")
}

func shellQuote(value string) string {
	if runtime.GOOS == "windows" {
		return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
	}

	return `'` + strings.ReplaceAll(value, `'`, `'"'"'`) + `'`
}

func parseCSVEnv(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		items = append(items, trimmed)
	}
	return items
}

func normalizeModelTargets(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	deduped := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := normalizeModelTarget(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, trimmed)
	}

	if len(deduped) == 0 {
		return nil
	}

	return deduped
}

func buildShellTypeCatalog(
	sourcePath string,
	defaultShellType string,
	modelOverrides map[string]string,
) (string, error) {
	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return "", fmt.Errorf("read model catalog %q: %w", sourcePath, err)
	}

	var catalog map[string]any
	if err := json.Unmarshal(content, &catalog); err != nil {
		return "", fmt.Errorf("decode model catalog %q: %w", sourcePath, err)
	}

	modelsRaw, ok := catalog["models"].([]any)
	if !ok || len(modelsRaw) == 0 {
		return "", fmt.Errorf("model catalog %q does not contain a non-empty models array", sourcePath)
	}

	matchedTargets := make(map[string]struct{}, len(modelOverrides))

	for _, raw := range modelsRaw {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		if defaultShellType != "" {
			entry["shell_type"] = defaultShellType
		}

		if overrideShellType, ok := matchCatalogModelOverride(entry, modelOverrides, matchedTargets); ok {
			entry["shell_type"] = overrideShellType
		}
	}

	unmatched := make([]string, 0)
	for target := range modelOverrides {
		if _, ok := matchedTargets[target]; !ok {
			unmatched = append(unmatched, target)
		}
	}
	if len(unmatched) > 0 {
		slices.Sort(unmatched)
		return "", fmt.Errorf(
			"model catalog %q did not contain requested shell overrides for models: %s",
			sourcePath,
			strings.Join(unmatched, ", "),
		)
	}

	output, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode generated local-shell model catalog: %w", err)
	}

	generatedDir := filepath.Join(os.TempDir(), "codex-server")
	if err := os.MkdirAll(generatedDir, 0o755); err != nil {
		return "", fmt.Errorf("create generated catalog directory %q: %w", generatedDir, err)
	}

	sortedOverrides := make([]string, 0, len(modelOverrides))
	for key, value := range modelOverrides {
		sortedOverrides = append(sortedOverrides, fmt.Sprintf("%s=%s", key, value))
	}
	slices.Sort(sortedOverrides)
	digest := sha256.Sum256([]byte(sourcePath + "\n" + string(content) + "\n" + defaultShellType + "\n" + strings.Join(sortedOverrides, ",")))
	outputPath := filepath.Join(
		generatedDir,
		fmt.Sprintf("model-catalog-shell-overrides-%s.json", hex.EncodeToString(digest[:8])),
	)

	if err := os.WriteFile(outputPath, output, 0o644); err != nil {
		return "", fmt.Errorf("write generated local-shell model catalog %q: %w", outputPath, err)
	}

	return outputPath, nil
}

func matchCatalogModelOverride(
	entry map[string]any,
	targets map[string]string,
	matchedTargets map[string]struct{},
) (string, bool) {
	for _, key := range []string{"slug", "display_name", "displayName", "model", "id"} {
		value, _ := entry[key].(string)
		normalized := normalizeModelTarget(value)
		if normalized == "" {
			continue
		}
		if shellType, ok := targets[normalized]; ok {
			matchedTargets[normalized] = struct{}{}
			return shellType, true
		}
	}

	return "", false
}

func normalizeModelTarget(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeShellType(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "", nil
	}

	switch normalized {
	case "default", "local", "unified_exec", "disabled", "shell_command":
		return normalized, nil
	default:
		return "", fmt.Errorf("unsupported shell type %q", value)
	}
}

func normalizeModelShellTypeOverrides(values map[string]string) (map[string]string, error) {
	if len(values) == 0 {
		return map[string]string{}, nil
	}

	normalized := make(map[string]string, len(values))
	for rawKey, rawValue := range values {
		key := normalizeModelTarget(rawKey)
		if key == "" {
			continue
		}
		shellType, err := normalizeShellType(rawValue)
		if err != nil {
			return nil, fmt.Errorf("model shell override for %q is invalid: %w", rawKey, err)
		}
		if shellType == "" {
			continue
		}
		normalized[key] = shellType
	}

	return normalized, nil
}

func discoverModelCatalogPath() string {
	return discoverModelCatalogPathFromCodexConfig()
}

func discoverModelCatalogPathFromCodexConfig() string {
	codexHome := strings.TrimSpace(os.Getenv("CODEX_HOME"))
	if codexHome == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil || strings.TrimSpace(homeDir) == "" {
			return ""
		}
		codexHome = filepath.Join(homeDir, ".codex")
	}

	configPath := filepath.Join(codexHome, "config.toml")
	content, err := os.ReadFile(configPath)
	if err != nil {
		return ""
	}

	var config struct {
		ModelCatalogJSON string `toml:"model_catalog_json"`
	}
	if err := toml.Unmarshal(content, &config); err != nil {
		return ""
	}

	modelCatalogPath := strings.TrimSpace(config.ModelCatalogJSON)
	if modelCatalogPath == "" {
		return ""
	}
	if filepath.IsAbs(modelCatalogPath) {
		return modelCatalogPath
	}

	return filepath.Clean(filepath.Join(codexHome, modelCatalogPath))
}
