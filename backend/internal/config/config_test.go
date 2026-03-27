package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestApplyModelCatalogOverride(t *testing.T) {
	t.Run("keeps command unchanged when catalog path is empty", func(t *testing.T) {
		command := "codex app-server --listen stdio://"
		if got := applyModelCatalogOverride(command, ""); got != command {
			t.Fatalf("applyModelCatalogOverride() = %q, want %q", got, command)
		}
	})

	t.Run("does not duplicate existing model catalog override", func(t *testing.T) {
		command := `codex app-server --listen stdio:// --config "model_catalog_json=E:/tmp/catalog.json"`
		if got := applyModelCatalogOverride(command, "E:/other/catalog.json"); got != command {
			t.Fatalf("applyModelCatalogOverride() = %q, want %q", got, command)
		}
	})

	t.Run("appends model catalog override", func(t *testing.T) {
		command := "codex app-server --listen stdio://"
		path := "E:/tmp/catalog.json"
		got := applyModelCatalogOverride(command, path)

		var want string
		if runtime.GOOS == "windows" {
			want = `codex app-server --listen stdio:// --config "model_catalog_json=E:/tmp/catalog.json"`
		} else {
			want = "codex app-server --listen stdio:// --config 'model_catalog_json=E:/tmp/catalog.json'"
		}

		if got != want {
			t.Fatalf("applyModelCatalogOverride() = %q, want %q", got, want)
		}
	})
}

func TestFromEnvBuildsCodexCommand(t *testing.T) {
	t.Setenv("CODEX_APP_SERVER_COMMAND", "codex app-server --listen stdio://")
	t.Setenv("CODEX_MODEL_CATALOG_JSON", "E:/tmp/catalog.json")

	cfg, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv() error = %v", err)
	}
	if cfg.CodexModelCatalogJSON != "E:/tmp/catalog.json" {
		t.Fatalf("CodexModelCatalogJSON = %q", cfg.CodexModelCatalogJSON)
	}
	if cfg.CodexCommand == "codex app-server --listen stdio://" {
		t.Fatalf("CodexCommand should include model catalog override, got %q", cfg.CodexCommand)
	}
}

func TestFromEnvBuildsGeneratedLocalShellCatalog(t *testing.T) {
	catalogPath := writeTestCatalog(t, map[string]any{
		"models": []map[string]any{
			{
				"slug":         "gpt-test",
				"display_name": "GPT Test",
				"shell_type":   "shell_command",
			},
		},
	})

	t.Setenv("CODEX_APP_SERVER_COMMAND", "codex app-server --listen stdio://")
	t.Setenv("CODEX_MODEL_CATALOG_JSON", catalogPath)
	t.Setenv("CODEX_LOCAL_SHELL_MODELS", "gpt-test")

	cfg, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv() error = %v", err)
	}
	if cfg.CodexModelCatalogJSON != catalogPath {
		t.Fatalf("expected source catalog path, got %q", cfg.CodexModelCatalogJSON)
	}
	if len(cfg.CodexLocalShellModels) != 1 || cfg.CodexLocalShellModels[0] != "gpt-test" {
		t.Fatalf("CodexLocalShellModels = %#v", cfg.CodexLocalShellModels)
	}

	resolved, err := ResolveCodexRuntime(cfg.BaseCodexCommand, RuntimePreferences{
		ModelCatalogPath: cfg.CodexModelCatalogJSON,
		LocalShellModels: cfg.CodexLocalShellModels,
	})
	if err != nil {
		t.Fatalf("ResolveCodexRuntime() error = %v", err)
	}
	if resolved.EffectiveModelCatalogPath == catalogPath {
		t.Fatalf("expected generated effective catalog path, got source path %q", resolved.EffectiveModelCatalogPath)
	}

	content, err := os.ReadFile(resolved.EffectiveModelCatalogPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", resolved.EffectiveModelCatalogPath, err)
	}

	var catalog map[string]any
	if err := json.Unmarshal(content, &catalog); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	models := catalog["models"].([]any)
	model := models[0].(map[string]any)
	if model["shell_type"] != "local" {
		t.Fatalf("generated shell_type = %#v", model["shell_type"])
	}
}

func TestFromEnvRejectsLocalShellModelsWithoutCatalog(t *testing.T) {
	t.Setenv("CODEX_LOCAL_SHELL_MODELS", "gpt-test")

	if _, err := FromEnv(); err == nil {
		t.Fatal("expected FromEnv to fail when CODEX_LOCAL_SHELL_MODELS is set without CODEX_MODEL_CATALOG_JSON")
	}
}

func TestFromEnvRejectsInlineModelCatalogWhenUsingLocalShellModels(t *testing.T) {
	catalogPath := writeTestCatalog(t, map[string]any{
		"models": []map[string]any{
			{
				"slug":       "gpt-test",
				"shell_type": "shell_command",
			},
		},
	})

	t.Setenv("CODEX_APP_SERVER_COMMAND", `codex app-server --listen stdio:// --config "model_catalog_json=E:/inline/catalog.json"`)
	t.Setenv("CODEX_MODEL_CATALOG_JSON", catalogPath)
	t.Setenv("CODEX_LOCAL_SHELL_MODELS", "gpt-test")

	if _, err := FromEnv(); err == nil {
		t.Fatal("expected FromEnv to fail when inline model_catalog_json and CODEX_LOCAL_SHELL_MODELS are both set")
	}
}

func TestFromEnvLoadsModelCatalogPathFromCodexConfig(t *testing.T) {
	codexHome := t.TempDir()
	configPath := filepath.Join(codexHome, "config.toml")
	expectedPath := filepath.Join(codexHome, "catalogs", "models.json")

	if err := os.WriteFile(
		configPath,
		[]byte("model_catalog_json = \"catalogs/models.json\"\n"),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile(config.toml) error = %v", err)
	}

	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("CODEX_MODEL_CATALOG_JSON", "")
	t.Setenv("CODEX_APP_SERVER_COMMAND", "codex app-server --listen stdio://")

	cfg, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv() error = %v", err)
	}

	if cfg.CodexModelCatalogJSON != expectedPath {
		t.Fatalf("CodexModelCatalogJSON = %q, want %q", cfg.CodexModelCatalogJSON, expectedPath)
	}
}

func TestResolveCodexRuntimeAppliesDefaultShellTypeAndModelOverrides(t *testing.T) {
	catalogPath := writeTestCatalog(t, map[string]any{
		"models": []map[string]any{
			{
				"slug":         "gpt-a",
				"display_name": "gpt-a",
				"shell_type":   "shell_command",
			},
			{
				"slug":         "gpt-b",
				"display_name": "gpt-b",
				"shell_type":   "shell_command",
			},
		},
	})

	resolved, err := ResolveCodexRuntime("codex app-server --listen stdio://", RuntimePreferences{
		ModelCatalogPath: catalogPath,
		DefaultShellType: "unified_exec",
		ModelShellTypeOverrides: map[string]string{
			"gpt-b": "local",
		},
	})
	if err != nil {
		t.Fatalf("ResolveCodexRuntime() error = %v", err)
	}

	content, err := os.ReadFile(resolved.EffectiveModelCatalogPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", resolved.EffectiveModelCatalogPath, err)
	}

	var catalog map[string]any
	if err := json.Unmarshal(content, &catalog); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	models := catalog["models"].([]any)
	first := models[0].(map[string]any)
	second := models[1].(map[string]any)
	if first["shell_type"] != "unified_exec" {
		t.Fatalf("expected first model shell_type unified_exec, got %#v", first["shell_type"])
	}
	if second["shell_type"] != "local" {
		t.Fatalf("expected second model shell_type local, got %#v", second["shell_type"])
	}
}

func TestResolveCodexRuntimeRejectsUnknownShellType(t *testing.T) {
	catalogPath := writeTestCatalog(t, map[string]any{
		"models": []map[string]any{
			{
				"slug":       "gpt-a",
				"shell_type": "shell_command",
			},
		},
	})

	if _, err := ResolveCodexRuntime("codex app-server --listen stdio://", RuntimePreferences{
		ModelCatalogPath: catalogPath,
		DefaultShellType: "powershell",
	}); err == nil {
		t.Fatal("expected ResolveCodexRuntime to reject unknown shell type")
	}
}

func TestNormalizeOutboundProxyURL(t *testing.T) {
	t.Run("adds http scheme when missing", func(t *testing.T) {
		got, err := NormalizeOutboundProxyURL("127.0.0.1:7890")
		if err != nil {
			t.Fatalf("NormalizeOutboundProxyURL() error = %v", err)
		}
		if got != "http://127.0.0.1:7890" {
			t.Fatalf("NormalizeOutboundProxyURL() = %q", got)
		}
	})

	t.Run("keeps socks5 proxy url", func(t *testing.T) {
		got, err := NormalizeOutboundProxyURL("socks5://127.0.0.1:1080")
		if err != nil {
			t.Fatalf("NormalizeOutboundProxyURL() error = %v", err)
		}
		if got != "socks5://127.0.0.1:1080" {
			t.Fatalf("NormalizeOutboundProxyURL() = %q", got)
		}
	})

	t.Run("rejects unsupported scheme", func(t *testing.T) {
		if _, err := NormalizeOutboundProxyURL("ftp://127.0.0.1:21"); err == nil {
			t.Fatal("expected NormalizeOutboundProxyURL to reject unsupported scheme")
		}
	})
}

func TestResolveCodexRuntimeCarriesOutboundProxyURL(t *testing.T) {
	resolved, err := ResolveCodexRuntime("codex app-server --listen stdio://", RuntimePreferences{
		OutboundProxyURL: "127.0.0.1:7890",
	})
	if err != nil {
		t.Fatalf("ResolveCodexRuntime() error = %v", err)
	}

	if resolved.Preferences.OutboundProxyURL != "http://127.0.0.1:7890" {
		t.Fatalf("expected normalized outbound proxy url, got %q", resolved.Preferences.OutboundProxyURL)
	}
}

func writeTestCatalog(t *testing.T, catalog map[string]any) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "catalog.json")
	content, err := json.Marshal(catalog)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return path
}
