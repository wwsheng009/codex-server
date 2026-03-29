package logging

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigureWritesLogsToConfiguredFile(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "backend-runtime.log")
	previous := slog.Default()
	defer slog.SetDefault(previous)

	runtime, err := Configure(Config{LogPath: logPath})
	if err != nil {
		t.Fatalf("Configure() error = %v", err)
	}
	defer func() {
		_ = runtime.Close()
	}()

	runtime.Logger.Info("logger test message", "component", "logging_test")
	if err := runtime.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	content, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", logPath, err)
	}

	text := string(content)
	if !strings.Contains(text, "logger test message") {
		t.Fatalf("expected log file to contain message, got %q", text)
	}
	if !strings.Contains(text, "component=logging_test") {
		t.Fatalf("expected log file to contain attributes, got %q", text)
	}
}

func TestConfigureSetsDefaultLogger(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "default-runtime.log")
	previous := slog.Default()
	defer slog.SetDefault(previous)

	runtime, err := Configure(Config{LogPath: logPath})
	if err != nil {
		t.Fatalf("Configure() error = %v", err)
	}
	defer func() {
		_ = runtime.Close()
	}()

	slog.Info("default logger message", "source", "default")
	if err := runtime.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	content, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", logPath, err)
	}
	if !strings.Contains(string(content), "default logger message") {
		t.Fatalf("expected default logger message in file, got %q", string(content))
	}
}
