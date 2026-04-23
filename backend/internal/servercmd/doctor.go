package servercmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const (
	codexInstallCommand = "npm i -g @openai/codex"
	doctorTimeout       = 5 * time.Second
)

type codexDoctorReport struct {
	ExecutablePath string
	Version        string
}

type codexDoctorError struct {
	message     string
	installHint string
}

func (e *codexDoctorError) Error() string {
	return e.message
}

var (
	findCodexExecutable = func(name string) (string, error) {
		return exec.LookPath(name)
	}
	runCodexVersionCommand = func(ctx context.Context) ([]byte, error) {
		if runtime.GOOS == "windows" {
			return exec.CommandContext(ctx, "cmd.exe", "/C", "codex", "-V").CombinedOutput()
		}
		return exec.CommandContext(ctx, "codex", "-V").CombinedOutput()
	}
)

func checkCodexCLI() (codexDoctorReport, error) {
	ctx, cancel := context.WithTimeout(context.Background(), doctorTimeout)
	defer cancel()

	var report codexDoctorReport

	executablePath, err := findCodexExecutable("codex")
	if err != nil {
		return report, &codexDoctorError{
			message:     "codex CLI was not found in PATH",
			installHint: codexInstallCommand,
		}
	}
	report.ExecutablePath = executablePath

	output, err := runCodexVersionCommand(ctx)
	version := strings.TrimSpace(string(output))
	if err != nil {
		if version != "" {
			return report, fmt.Errorf("codex CLI is installed at %q but `codex -V` failed: %w (%s)", executablePath, err, version)
		}
		return report, fmt.Errorf("codex CLI is installed at %q but `codex -V` failed: %w", executablePath, err)
	}
	if version == "" {
		return report, fmt.Errorf("codex CLI is installed at %q but `codex -V` returned empty output", executablePath)
	}

	report.Version = version
	return report, nil
}

func writeDoctorSuccess(w io.Writer, report codexDoctorReport) {
	fmt.Fprintf(w, "codex executable: %s\n", report.ExecutablePath)
	fmt.Fprintf(w, "codex version: %s\n", report.Version)
}

func writeDoctorFailure(w io.Writer, report codexDoctorReport, err error) {
	if report.ExecutablePath != "" {
		fmt.Fprintf(w, "codex executable: %s\n", report.ExecutablePath)
	}
	fmt.Fprintln(w, err)

	var doctorErr *codexDoctorError
	if errors.As(err, &doctorErr) && strings.TrimSpace(doctorErr.installHint) != "" {
		fmt.Fprintf(w, "Install it with: %s\n", doctorErr.installHint)
	}
}
