package jobs

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	appconfig "codex-server/backend/internal/config"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

const (
	defaultShellScriptTimeoutSec = 600
	maxShellScriptTimeoutSec     = 3600
	shellScriptOutputLimitBytes  = 64 * 1024
)

type shellScriptRuntime interface {
	Call(ctx context.Context, workspaceID string, method string, params any, result any) error
	RootPath(workspaceID string) string
}

type shellScriptRunner struct {
	runtimes shellScriptRuntime
	store    *store.MemoryStore
	lookPath func(string) (string, error)
	goos     string
	comSpec  string
	shellEnv string
	now      func() time.Time
}

type shellScriptPayload struct {
	Script          string
	RequestedShell  string
	ResolvedShell   string
	Workdir         string
	ResolvedWorkdir string
	TimeoutSec      int
}

func NewShellScriptRunner(runtimes shellScriptRuntime, dataStore *store.MemoryStore) Runner {
	return shellScriptRunner{
		runtimes: runtimes,
		store:    dataStore,
		lookPath: exec.LookPath,
		goos:     stdruntime.GOOS,
		comSpec:  strings.TrimSpace(os.Getenv("ComSpec")),
		shellEnv: strings.TrimSpace(os.Getenv("SHELL")),
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (r shellScriptRunner) Definition() ExecutorDefinition {
	return ExecutorDefinition{
		Kind:             "shell_script",
		Title:            "Shell Script",
		Description:      "Run a shell, PowerShell, or CMD script inside the selected workspace runtime.",
		SupportsSchedule: true,
		Capabilities: &ExecutorCapabilities{
			DefaultCreatePriority: 90,
			Script: &ScriptExecutorCapability{
				ScriptKey:  "script",
				ShellKey:   "shell",
				WorkdirKey: "workdir",
				TimeoutKey: "timeoutSec",
				ShellOptions: []string{
					"auto",
					"pwsh",
					"powershell",
					"cmd",
					"bash",
					"sh",
					"zsh",
					"git-bash",
					"wsl",
				},
			},
		},
		Form: &ExecutorFormSpec{
			Fields: []ExecutorFormField{
				{
					Label:              "Shell / CMD Script",
					Hint:               "Enter the script body that should run in the selected workspace runtime.",
					Placeholder:        "echo hello from background job",
					Purpose:            "script",
					Kind:               "textarea",
					PayloadKey:         "script",
					Required:           true,
					Group:              "script",
					Rows:               8,
					PreserveWhitespace: true,
					Validation: &ExecutorFormFieldValidation{
						MinLength: ptrInt(1),
					},
				},
				{
					Label:         "Shell",
					Hint:          "Choose which shell runtime should execute the script.",
					Purpose:       "shell",
					Kind:          "select",
					PayloadKey:    "shell",
					Advanced:      true,
					Group:         "environment",
					DefaultString: "auto",
					Options: []ExecutorFormFieldOption{
						{Value: "auto", Label: "Auto (Recommended)"},
						{Value: "pwsh", Label: "PowerShell Core"},
						{Value: "powershell", Label: "Windows PowerShell"},
						{Value: "cmd", Label: "Windows CMD"},
						{Value: "bash", Label: "Bash"},
						{Value: "sh", Label: "POSIX sh"},
						{Value: "zsh", Label: "Zsh"},
						{Value: "git-bash", Label: "Git Bash"},
						{Value: "wsl", Label: "WSL"},
					},
				},
				{
					Label:         "Working Directory",
					Hint:          "Use a relative path inside the workspace. \".\" runs from the workspace root.",
					Placeholder:   ".",
					Purpose:       "workdir",
					Kind:          "text",
					PayloadKey:    "workdir",
					Advanced:      true,
					Group:         "environment",
					DefaultString: ".",
					Validation: &ExecutorFormFieldValidation{
						RelativeWorkspacePath: true,
					},
				},
				{
					Label:      "Timeout (Seconds)",
					Hint:       "Leave blank to use the executor default timeout. The backend caps this at 3600 seconds.",
					Purpose:    "timeoutSec",
					Kind:       "number",
					PayloadKey: "timeoutSec",
					Advanced:   true,
					Group:      "execution",
					Min:        ptrInt(1),
					Max:        ptrInt(3600),
					Step:       ptrInt(1),
					Validation: &ExecutorFormFieldValidation{
						IntegerOnly: true,
					},
				},
			},
		},
		PayloadSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"script": map[string]any{
					"type":        "string",
					"description": "The script body to execute.",
				},
				"shell": map[string]any{
					"type":        "string",
					"description": "Shell kind: auto, pwsh, powershell, cmd, bash, sh, zsh, git-bash, or wsl.",
				},
				"workdir": map[string]any{
					"type":        "string",
					"description": "Optional working directory inside the workspace. Defaults to the workspace root.",
				},
				"timeoutSec": map[string]any{
					"type":        "integer",
					"description": "Optional timeout in seconds. Defaults to 600 and is capped at 3600.",
				},
			},
			"required": []string{"script"},
		},
		ExamplePayload: map[string]any{
			"shell":      "auto",
			"workdir":    ".",
			"timeoutSec": defaultShellScriptTimeoutSec,
			"script":     "echo hello from background job",
		},
	}
}

func (r shellScriptRunner) NormalizeCreateInput(input *CreateInput) error {
	if input == nil {
		return nil
	}
	payload, _, err := r.normalizePayload(input.WorkspaceID, input.Payload)
	if err != nil {
		return err
	}
	input.Payload = payload
	input.SourceType = ""
	input.SourceRefID = ""
	return nil
}

func (r shellScriptRunner) ValidateStoredJob(job store.BackgroundJob) error {
	_, _, err := r.normalizePayload(job.WorkspaceID, job.Payload)
	return err
}

func (r shellScriptRunner) Execute(ctx context.Context, request ExecutionRequest) (map[string]any, error) {
	if r.runtimes == nil {
		return nil, r.newExecutionError(
			appRuntime.ErrRuntimeNotConfigured,
			"workspace runtime is not configured",
			"workspace_runtime_not_configured",
			"configuration",
			false,
			map[string]string{
				"executorKind": "shell_script",
				"workspaceId":  strings.TrimSpace(request.WorkspaceID),
			},
		)
	}

	_, payload, err := r.normalizePayload(request.WorkspaceID, request.Job.Payload)
	if err != nil {
		return nil, err
	}

	commandArgs, shellPath, err := r.buildCommandArgs(payload.RequestedShell, payload.Script)
	if err != nil {
		return nil, r.newValidationError(
			err,
			"shell_script_shell_invalid",
			"unsupported shell selection",
			map[string]string{
				"executorKind": "shell_script",
				"shell":        payload.RequestedShell,
			},
		)
	}

	runCtx := ctx
	cancel := func() {}
	if payload.TimeoutSec > 0 {
		runCtx, cancel = context.WithTimeout(ctx, time.Duration(payload.TimeoutSec)*time.Second)
	}
	defer cancel()

	startedAt := r.currentTime()
	var response struct {
		ExitCode int    `json:"exitCode"`
		Stdout   string `json:"stdout"`
		Stderr   string `json:"stderr"`
	}

	err = r.runtimes.Call(runCtx, request.WorkspaceID, "command/exec", map[string]any{
		"command":            commandArgs,
		"cwd":                payload.ResolvedWorkdir,
		"processId":          store.NewID("jobproc"),
		"sandboxPolicy":      r.commandSandboxPolicy(),
		"streamStdin":        false,
		"streamStdoutStderr": true,
		"tty":                false,
	}, &response)
	duration := r.currentTime().Sub(startedAt)

	if err != nil {
		output := r.buildOutput(shellScriptOutputOptions{
			OK:         false,
			Message:    firstNonEmpty(strings.TrimSpace(err.Error()), "Shell script execution failed."),
			Shell:      payload.ResolvedShell,
			ShellPath:  shellPath,
			Workdir:    payload.ResolvedWorkdir,
			Duration:   duration,
			Stdout:     response.Stdout,
			Stderr:     response.Stderr,
			TimeoutSec: payload.TimeoutSec,
		})

		switch {
		case errors.Is(err, context.DeadlineExceeded):
			return nil, withFailureOutput(
				r.newExecutionError(
					err,
					fmt.Sprintf("Shell script timed out after %d seconds.", payload.TimeoutSec),
					"shell_script_timeout",
					"timeout",
					true,
					map[string]string{
						"executorKind": "shell_script",
						"shell":        payload.ResolvedShell,
						"workdir":      payload.Workdir,
						"timeoutSec":   strconv.Itoa(payload.TimeoutSec),
					},
				),
				output,
			)
		case errors.Is(err, appRuntime.ErrRuntimeNotConfigured):
			return nil, withFailureOutput(
				r.newExecutionError(
					err,
					"workspace runtime is not configured",
					"workspace_runtime_not_configured",
					"configuration",
					false,
					map[string]string{
						"executorKind": "shell_script",
						"workspaceId":  strings.TrimSpace(request.WorkspaceID),
					},
				),
				output,
			)
		default:
			return nil, withFailureOutput(
				r.newExecutionError(
					err,
					firstNonEmpty(strings.TrimSpace(err.Error()), "Shell script execution failed."),
					"shell_script_execution_failed",
					"execution",
					true,
					map[string]string{
						"executorKind": "shell_script",
						"shell":        payload.ResolvedShell,
						"workdir":      payload.Workdir,
					},
				),
				output,
			)
		}
	}

	if response.ExitCode != 0 {
		output := r.buildOutput(shellScriptOutputOptions{
			OK:        false,
			Message:   fmt.Sprintf("Shell script exited with code %d.", response.ExitCode),
			Shell:     payload.ResolvedShell,
			ShellPath: shellPath,
			Workdir:   payload.ResolvedWorkdir,
			Duration:  duration,
			ExitCode:  &response.ExitCode,
			Stdout:    response.Stdout,
			Stderr:    response.Stderr,
		})
		return nil, withFailureOutput(
			r.newExecutionError(
				errors.New("shell script exited with non-zero status"),
				output["message"].(string),
				"shell_script_exit_non_zero",
				"execution",
				true,
				map[string]string{
					"executorKind": "shell_script",
					"shell":        payload.ResolvedShell,
					"workdir":      payload.Workdir,
					"exitCode":     strconv.Itoa(response.ExitCode),
				},
			),
			output,
		)
	}

	return r.buildOutput(shellScriptOutputOptions{
		OK:        true,
		Message:   "Shell script completed successfully.",
		Shell:     payload.ResolvedShell,
		ShellPath: shellPath,
		Workdir:   payload.ResolvedWorkdir,
		Duration:  duration,
		ExitCode:  &response.ExitCode,
		Stdout:    response.Stdout,
		Stderr:    response.Stderr,
	}), nil
}

func (r shellScriptRunner) normalizePayload(workspaceID string, payload map[string]any) (map[string]any, shellScriptPayload, error) {
	rootPath, err := r.workspaceRootPath(workspaceID)
	if err != nil {
		return nil, shellScriptPayload{}, err
	}
	if strings.TrimSpace(rootPath) == "" {
		return nil, shellScriptPayload{}, r.newExecutionError(
			appRuntime.ErrRuntimeNotConfigured,
			"workspace runtime is not configured",
			"workspace_runtime_not_configured",
			"configuration",
			false,
			map[string]string{
				"executorKind": "shell_script",
				"workspaceId":  strings.TrimSpace(workspaceID),
			},
		)
	}

	normalized := cloneAnyMap(payload)
	if normalized == nil {
		normalized = map[string]any{}
	}

	script := readString(normalized, "script")
	if script == "" {
		return nil, shellScriptPayload{}, r.newValidationError(
			ErrInvalidInput,
			"shell_script_script_required",
			"shell_script jobs require payload.script",
			map[string]string{
				"executorKind": "shell_script",
			},
		)
	}

	requestedShell, err := normalizeShellScriptKind(readString(normalized, "shell"))
	if err != nil {
		return nil, shellScriptPayload{}, r.newValidationError(
			err,
			"shell_script_shell_invalid",
			"unsupported shell selection",
			map[string]string{
				"executorKind": "shell_script",
				"shell":        readString(normalized, "shell"),
			},
		)
	}
	resolvedShell := r.resolveShellPreference(requestedShell)

	workdir, resolvedWorkdir, err := normalizeShellScriptWorkdir(readString(normalized, "workdir"), rootPath)
	if err != nil {
		return nil, shellScriptPayload{}, r.newValidationError(
			err,
			"shell_script_workdir_invalid",
			err.Error(),
			map[string]string{
				"executorKind": "shell_script",
				"workdir":      readString(normalized, "workdir"),
			},
		)
	}

	timeoutSec, err := normalizeShellScriptTimeout(normalized["timeoutSec"])
	if err != nil {
		return nil, shellScriptPayload{}, r.newValidationError(
			err,
			"shell_script_timeout_invalid",
			err.Error(),
			map[string]string{
				"executorKind": "shell_script",
			},
		)
	}

	normalized["script"] = script
	normalized["shell"] = requestedShell
	normalized["workdir"] = workdir
	normalized["timeoutSec"] = timeoutSec

	return normalized, shellScriptPayload{
		Script:          script,
		RequestedShell:  requestedShell,
		ResolvedShell:   resolvedShell,
		Workdir:         workdir,
		ResolvedWorkdir: resolvedWorkdir,
		TimeoutSec:      timeoutSec,
	}, nil
}

func (r shellScriptRunner) workspaceRootPath(workspaceID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return "", ErrInvalidInput
	}
	if r.store != nil {
		workspace, ok := r.store.GetWorkspace(workspaceID)
		if !ok {
			return "", store.ErrWorkspaceNotFound
		}
		rootPath := filepath.Clean(filepath.FromSlash(strings.TrimSpace(workspace.RootPath)))
		if rootPath != "" {
			return rootPath, nil
		}
	}
	if r.runtimes == nil {
		return "", appRuntime.ErrRuntimeNotConfigured
	}
	rootPath := filepath.Clean(filepath.FromSlash(strings.TrimSpace(r.runtimes.RootPath(workspaceID))))
	if rootPath == "" {
		return "", appRuntime.ErrRuntimeNotConfigured
	}
	return rootPath, nil
}

func normalizeShellScriptKind(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "auto":
		return "auto", nil
	case "pwsh", "powershell", "cmd", "bash", "sh", "zsh", "git-bash", "wsl":
		return strings.ToLower(strings.TrimSpace(value)), nil
	default:
		return "", errors.New("shell must be one of auto, pwsh, powershell, cmd, bash, sh, zsh, git-bash, or wsl")
	}
}

func normalizeShellScriptWorkdir(value string, rootPath string) (string, string, error) {
	rootPath = filepath.Clean(filepath.FromSlash(strings.TrimSpace(rootPath)))
	if rootPath == "" {
		return "", "", appRuntime.ErrRuntimeNotConfigured
	}

	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		trimmed = "."
	}

	candidate := filepath.FromSlash(trimmed)
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(rootPath, candidate)
	}
	resolved := filepath.Clean(candidate)
	relativePath, err := filepath.Rel(rootPath, resolved)
	if err != nil {
		return "", "", err
	}
	if relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return "", "", errors.New("workdir escapes workspace root")
	}

	normalized := filepath.ToSlash(relativePath)
	if normalized == "" || normalized == "." {
		normalized = "."
	}
	return normalized, resolved, nil
}

func normalizeShellScriptTimeout(value any) (int, error) {
	if value == nil {
		return defaultShellScriptTimeoutSec, nil
	}

	parsed, ok := parseShellScriptTimeout(value)
	if !ok {
		return 0, errors.New("timeoutSec must be a positive integer")
	}
	if parsed <= 0 {
		return 0, errors.New("timeoutSec must be greater than 0")
	}
	if parsed > maxShellScriptTimeoutSec {
		return 0, fmt.Errorf("timeoutSec must be less than or equal to %d", maxShellScriptTimeoutSec)
	}
	return parsed, nil
}

func parseShellScriptTimeout(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int8:
		return int(typed), true
	case int16:
		return int(typed), true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case float32:
		if math.IsNaN(float64(typed)) || math.IsInf(float64(typed), 0) || math.Trunc(float64(typed)) != float64(typed) {
			return 0, false
		}
		return int(typed), true
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || math.Trunc(typed) != typed {
			return 0, false
		}
		return int(typed), true
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return defaultShellScriptTimeoutSec, true
		}
		parsed, err := strconv.Atoi(trimmed)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func (r shellScriptRunner) resolveShellPreference(requested string) string {
	if normalized, err := normalizeShellScriptKind(requested); err == nil && normalized != "" && normalized != "auto" {
		return normalized
	}

	if r.store != nil {
		if normalized, err := normalizeShellScriptKind(r.store.GetRuntimePreferences().DefaultTerminalShell); err == nil && normalized != "" && normalized != "auto" {
			return normalized
		}
	}

	if fromEnv := normalizeShellScriptEnvPreference(r.shellEnv); fromEnv != "" {
		return fromEnv
	}

	if strings.EqualFold(strings.TrimSpace(r.goos), "windows") {
		for _, candidate := range []string{"pwsh", "powershell", "cmd"} {
			if r.shellIsAvailable(candidate) {
				return candidate
			}
		}
		return "cmd"
	}

	for _, candidate := range []string{"bash", "zsh", "sh"} {
		if r.shellIsAvailable(candidate) {
			return candidate
		}
	}
	return "sh"
}

func normalizeShellScriptEnvPreference(value string) string {
	baseName := strings.ToLower(strings.TrimSpace(filepath.Base(strings.TrimSpace(value))))
	switch {
	case strings.Contains(baseName, "pwsh"):
		return "pwsh"
	case strings.Contains(baseName, "powershell"):
		return "powershell"
	case strings.Contains(baseName, "cmd"):
		return "cmd"
	case strings.Contains(baseName, "bash"):
		return "bash"
	case strings.Contains(baseName, "zsh"):
		return "zsh"
	case baseName == "sh":
		return "sh"
	default:
		return ""
	}
}

func (r shellScriptRunner) shellIsAvailable(kind string) bool {
	path, err := r.resolveShellPath(kind)
	return err == nil && strings.TrimSpace(path) != ""
}

func (r shellScriptRunner) buildCommandArgs(requestedShell string, script string) ([]string, string, error) {
	shellKind := r.resolveShellPreference(requestedShell)
	shellPath, err := r.resolveShellPath(shellKind)
	if err != nil {
		return nil, "", err
	}

	switch shellKind {
	case "cmd":
		return []string{shellPath, "/d", "/s", "/c", script}, shellPath, nil
	case "powershell":
		return []string{
			shellPath,
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			script,
		}, shellPath, nil
	case "pwsh":
		return []string{
			shellPath,
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			script,
		}, shellPath, nil
	case "bash", "zsh", "sh", "git-bash":
		return []string{shellPath, "-lc", script}, shellPath, nil
	case "wsl":
		return []string{shellPath, "sh", "-lc", script}, shellPath, nil
	default:
		return nil, "", errors.New("unsupported shell selection")
	}
}

func (r shellScriptRunner) resolveShellPath(kind string) (string, error) {
	switch kind {
	case "cmd":
		if strings.TrimSpace(r.comSpec) != "" {
			return strings.TrimSpace(r.comSpec), nil
		}
		return r.firstExistingCommand("cmd.exe", "cmd")
	case "powershell":
		return r.firstExistingCommand("powershell.exe", "powershell")
	case "pwsh":
		return r.firstExistingCommand("pwsh.exe", "pwsh")
	case "bash":
		return r.firstExistingCommand("bash", "bash.exe")
	case "zsh":
		return r.firstExistingCommand("zsh", "zsh.exe")
	case "sh":
		return r.firstExistingCommand("sh", "sh.exe")
	case "wsl":
		return r.firstExistingCommand("wsl.exe", "wsl")
	case "git-bash":
		if resolved, ok := r.resolveGitBashPath(); ok {
			return resolved, nil
		}
		return "", errors.New("git-bash is not available")
	default:
		return "", errors.New("unsupported shell selection")
	}
}

func (r shellScriptRunner) firstExistingCommand(candidates ...string) (string, error) {
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if r.lookPath != nil {
			if resolved, err := r.lookPath(candidate); err == nil && strings.TrimSpace(resolved) != "" {
				return resolved, nil
			}
		}
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) != "" {
			return strings.TrimSpace(candidate), nil
		}
	}
	return "", errors.New("shell is not available")
}

func (r shellScriptRunner) resolveGitBashPath() (string, bool) {
	if r.lookPath != nil {
		if gitPath, err := r.lookPath("git.exe"); err == nil && strings.TrimSpace(gitPath) != "" {
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
		if resolved, err := r.lookPath("bash.exe"); err == nil && strings.TrimSpace(resolved) != "" {
			return resolved, true
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

func (r shellScriptRunner) commandSandboxPolicy() map[string]any {
	if r.store == nil {
		return appconfig.DefaultCommandSandboxPolicy()
	}

	prefs := r.store.GetRuntimePreferences()
	sandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(prefs.DefaultCommandSandboxPolicy)
	if err != nil || len(sandboxPolicy) == 0 {
		return appconfig.DefaultCommandSandboxPolicy()
	}
	return sandboxPolicy
}

func (r shellScriptRunner) currentTime() time.Time {
	if r.now != nil {
		return r.now().UTC()
	}
	return time.Now().UTC()
}

type shellScriptOutputOptions struct {
	OK         bool
	Message    string
	Shell      string
	ShellPath  string
	Workdir    string
	Duration   time.Duration
	ExitCode   *int
	Stdout     string
	Stderr     string
	TimeoutSec int
}

func (r shellScriptRunner) buildOutput(options shellScriptOutputOptions) map[string]any {
	stdout, stdoutTruncated, stdoutBytes := truncateShellScriptText(options.Stdout, shellScriptOutputLimitBytes)
	stderr, stderrTruncated, stderrBytes := truncateShellScriptText(options.Stderr, shellScriptOutputLimitBytes)

	output := map[string]any{
		"ok":              options.OK,
		"message":         strings.TrimSpace(options.Message),
		"shell":           strings.TrimSpace(options.Shell),
		"shellPath":       strings.TrimSpace(options.ShellPath),
		"workdir":         strings.TrimSpace(options.Workdir),
		"durationMs":      options.Duration.Milliseconds(),
		"stdout":          stdout,
		"stderr":          stderr,
		"stdoutBytes":     stdoutBytes,
		"stderrBytes":     stderrBytes,
		"stdoutTruncated": stdoutTruncated,
		"stderrTruncated": stderrTruncated,
	}
	if options.ExitCode != nil {
		output["exitCode"] = *options.ExitCode
	}
	if options.TimeoutSec > 0 {
		output["timeoutSec"] = options.TimeoutSec
	}
	return output
}

func truncateShellScriptText(value string, limit int) (string, bool, int) {
	byteLen := len([]byte(value))
	if limit <= 0 || byteLen <= limit {
		return value, false, byteLen
	}

	buffer := []byte(value)
	cut := limit
	for cut > 0 && !utf8.Valid(buffer[:cut]) {
		cut -= 1
	}
	if cut <= 0 {
		cut = limit
	}
	return string(buffer[:cut]) + "\n...[truncated]", true, byteLen
}

func (r shellScriptRunner) newValidationError(cause error, code string, message string, details map[string]string) error {
	if strings.TrimSpace(message) == "" && cause != nil {
		message = cause.Error()
	}
	return NewClassifiedError(ErrInvalidInput, message, store.ErrorMetadata{
		Code:      strings.TrimSpace(code),
		Category:  "validation",
		Retryable: ptrBool(false),
		Details:   cloneStringMap(details),
	})
}

func (r shellScriptRunner) newExecutionError(
	cause error,
	message string,
	code string,
	category string,
	retryable bool,
	details map[string]string,
) error {
	return NewClassifiedError(cause, message, store.ErrorMetadata{
		Code:      strings.TrimSpace(code),
		Category:  strings.TrimSpace(category),
		Retryable: ptrBool(retryable),
		Details:   cloneStringMap(details),
	})
}
