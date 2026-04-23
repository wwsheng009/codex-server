package servercmd

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCheckCodexCLIReportsMissingExecutable(t *testing.T) {
	originalFind := findCodexExecutable
	originalRun := runCodexVersionCommand
	t.Cleanup(func() {
		findCodexExecutable = originalFind
		runCodexVersionCommand = originalRun
	})

	findCodexExecutable = func(string) (string, error) {
		return "", errors.New("not found")
	}
	runCodexVersionCommand = func(context.Context) ([]byte, error) {
		t.Fatal("runCodexVersionCommand should not be called when codex is missing")
		return nil, nil
	}

	report, err := checkCodexCLI()
	if err == nil {
		t.Fatal("checkCodexCLI() error = nil, want missing executable error")
	}
	if report.ExecutablePath != "" {
		t.Fatalf("checkCodexCLI() executable path = %q, want empty", report.ExecutablePath)
	}

	var doctorErr *codexDoctorError
	if !errors.As(err, &doctorErr) {
		t.Fatalf("checkCodexCLI() error = %T, want *codexDoctorError", err)
	}
	if doctorErr.installHint != codexInstallCommand {
		t.Fatalf("install hint = %q, want %q", doctorErr.installHint, codexInstallCommand)
	}
}

func TestCheckCodexCLIReturnsVersion(t *testing.T) {
	originalFind := findCodexExecutable
	originalRun := runCodexVersionCommand
	t.Cleanup(func() {
		findCodexExecutable = originalFind
		runCodexVersionCommand = originalRun
	})

	findCodexExecutable = func(string) (string, error) {
		return "/usr/bin/codex", nil
	}
	runCodexVersionCommand = func(context.Context) ([]byte, error) {
		return []byte("codex 0.1.0\n"), nil
	}

	report, err := checkCodexCLI()
	if err != nil {
		t.Fatalf("checkCodexCLI() error = %v", err)
	}
	if report.ExecutablePath != "/usr/bin/codex" {
		t.Fatalf("executable path = %q, want %q", report.ExecutablePath, "/usr/bin/codex")
	}
	if report.Version != "codex 0.1.0" {
		t.Fatalf("version = %q, want %q", report.Version, "codex 0.1.0")
	}
}

func TestCheckCodexCLIReturnsVersionCommandFailure(t *testing.T) {
	originalFind := findCodexExecutable
	originalRun := runCodexVersionCommand
	t.Cleanup(func() {
		findCodexExecutable = originalFind
		runCodexVersionCommand = originalRun
	})

	findCodexExecutable = func(string) (string, error) {
		return "/usr/bin/codex", nil
	}
	runCodexVersionCommand = func(context.Context) ([]byte, error) {
		return []byte("unknown flag"), errors.New("exit status 1")
	}

	report, err := checkCodexCLI()
	if err == nil {
		t.Fatal("checkCodexCLI() error = nil, want version failure")
	}
	if report.ExecutablePath != "/usr/bin/codex" {
		t.Fatalf("executable path = %q, want %q", report.ExecutablePath, "/usr/bin/codex")
	}
	if !strings.Contains(err.Error(), "codex -V") {
		t.Fatalf("checkCodexCLI() error = %q, want codex -V context", err.Error())
	}
}
