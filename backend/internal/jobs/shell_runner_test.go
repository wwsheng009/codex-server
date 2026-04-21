package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"testing"

	"codex-server/backend/internal/store"
)

type fakeShellScriptRuntime struct {
	rootPath    string
	err         error
	exitCode    int
	stdout      string
	stderr      string
	lastMethod  string
	lastParams  map[string]any
	lastWorkdir string
}

func (f *fakeShellScriptRuntime) Call(_ context.Context, _ string, method string, params any, result any) error {
	f.lastMethod = method
	if record, ok := params.(map[string]any); ok {
		f.lastParams = make(map[string]any, len(record))
		for key, value := range record {
			f.lastParams[key] = value
		}
		if cwd, ok := record["cwd"].(string); ok {
			f.lastWorkdir = cwd
		}
	}
	if f.err != nil {
		return f.err
	}
	raw, err := json.Marshal(map[string]any{
		"exitCode": f.exitCode,
		"stdout":   f.stdout,
		"stderr":   f.stderr,
	})
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, result)
}

func (f *fakeShellScriptRuntime) RootPath(string) string {
	return f.rootPath
}

func TestShellScriptRunnerNormalizeCreateInput(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	runner := shellScriptRunner{
		runtimes: &fakeShellScriptRuntime{rootPath: workspace.RootPath},
		store:    dataStore,
		lookPath: func(name string) (string, error) { return name, nil },
		goos:     "windows",
		comSpec:  `C:\Windows\System32\cmd.exe`,
	}

	input := &CreateInput{
		SourceType:   "automation",
		SourceRefID:  "auto_legacy",
		Name:         "Nightly Script",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "shell_script",
		Payload: map[string]any{
			"script":     "Write-Output 'hello'",
			"shell":      "pwsh",
			"workdir":    filepath.Join(workspace.RootPath, "backend"),
			"timeoutSec": 900,
		},
	}

	if err := runner.NormalizeCreateInput(input); err != nil {
		t.Fatalf("NormalizeCreateInput() error = %v", err)
	}

	if input.SourceType != "" || input.SourceRefID != "" {
		t.Fatalf("expected shell_script to clear source references, got sourceType=%q sourceRefId=%q", input.SourceType, input.SourceRefID)
	}
	if got := readString(input.Payload, "shell"); got != "pwsh" {
		t.Fatalf("expected shell to stay normalized, got %q", got)
	}
	if got := readString(input.Payload, "workdir"); got != "backend" {
		t.Fatalf("expected workdir to be stored relative to workspace, got %q", got)
	}
	if got, ok := input.Payload["timeoutSec"].(int); !ok || got != 900 {
		t.Fatalf("expected timeoutSec=900, got %#v", input.Payload["timeoutSec"])
	}
}

func TestShellScriptRunnerRejectsEscapingWorkdir(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	runner := shellScriptRunner{
		runtimes: &fakeShellScriptRuntime{rootPath: workspace.RootPath},
		store:    dataStore,
		lookPath: func(name string) (string, error) { return name, nil },
		goos:     "windows",
		comSpec:  `C:\Windows\System32\cmd.exe`,
	}

	err := runner.NormalizeCreateInput(&CreateInput{
		Name:         "Escaping Script",
		WorkspaceID:  workspace.ID,
		ExecutorKind: "shell_script",
		Payload: map[string]any{
			"script":  "echo fail",
			"workdir": `..\outside`,
		},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	meta, ok := ExtractErrorMetadata(err)
	if !ok || meta.Code != "shell_script_workdir_invalid" {
		t.Fatalf("expected structured shell_script_workdir_invalid metadata, got %#v", meta)
	}
}

func TestShellScriptRunnerDefinitionExposesStructuredFormMetadata(t *testing.T) {
	t.Parallel()

	definition := shellScriptRunner{}.Definition()
	if definition.Kind != "shell_script" {
		t.Fatalf("expected shell_script definition, got %#v", definition.Kind)
	}
	if definition.Capabilities == nil || definition.Capabilities.Script == nil {
		t.Fatalf("expected script capability, got %#v", definition.Capabilities)
	}
	if definition.Form == nil || len(definition.Form.Fields) < 4 {
		t.Fatalf("expected structured form fields, got %#v", definition.Form)
	}

	scriptField := findShellScriptFormField(definition.Form.Fields, "script")
	if scriptField == nil || scriptField.Label != "Shell / CMD Script" || scriptField.Group != "script" {
		t.Fatalf("expected script field metadata, got %#v", scriptField)
	}
	if scriptField.Validation == nil || scriptField.Validation.MinLength == nil || *scriptField.Validation.MinLength != 1 {
		t.Fatalf("expected script validation metadata, got %#v", scriptField)
	}
	shellField := findShellScriptFormField(definition.Form.Fields, "shell")
	if shellField == nil || !shellField.Advanced || shellField.Group != "environment" || len(shellField.Options) != 9 {
		t.Fatalf("expected advanced shell metadata, got %#v", shellField)
	}
	workdirField := findShellScriptFormField(definition.Form.Fields, "workdir")
	if workdirField == nil || !workdirField.Advanced || workdirField.Placeholder != "." {
		t.Fatalf("expected workdir metadata, got %#v", workdirField)
	}
	if workdirField.Validation == nil || !workdirField.Validation.RelativeWorkspacePath {
		t.Fatalf("expected workdir relative path validation metadata, got %#v", workdirField)
	}
	timeoutField := findShellScriptFormField(definition.Form.Fields, "timeoutSec")
	if timeoutField == nil || !timeoutField.Advanced || timeoutField.Label != "Timeout (Seconds)" {
		t.Fatalf("expected timeout metadata, got %#v", timeoutField)
	}
	if timeoutField.Validation == nil || !timeoutField.Validation.IntegerOnly {
		t.Fatalf("expected timeout integer validation metadata, got %#v", timeoutField)
	}
}

func TestShellScriptRunnerExecuteReturnsSuccessOutput(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	fakeRuntime := &fakeShellScriptRuntime{
		rootPath: workspace.RootPath,
		exitCode: 0,
		stdout:   "hello\n",
		stderr:   "",
	}

	runner := shellScriptRunner{
		runtimes: fakeRuntime,
		store:    dataStore,
		lookPath: func(name string) (string, error) { return "C:/Program Files/PowerShell/7/pwsh.exe", nil },
		goos:     "windows",
		comSpec:  `C:\Windows\System32\cmd.exe`,
	}

	output, err := runner.Execute(context.Background(), ExecutionRequest{
		WorkspaceID: workspace.ID,
		Job: store.BackgroundJob{
			WorkspaceID:  workspace.ID,
			ExecutorKind: "shell_script",
			Payload: map[string]any{
				"script":     "Write-Output 'hello'",
				"shell":      "pwsh",
				"workdir":    ".",
				"timeoutSec": 30,
			},
		},
	})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if fakeRuntime.lastMethod != "command/exec" {
		t.Fatalf("expected command/exec runtime call, got %q", fakeRuntime.lastMethod)
	}
	expectedWorkdir := filepath.Clean(filepath.FromSlash(workspace.RootPath))
	if fakeRuntime.lastWorkdir != expectedWorkdir {
		t.Fatalf("expected cwd %q, got %q", expectedWorkdir, fakeRuntime.lastWorkdir)
	}
	command, ok := fakeRuntime.lastParams["command"].([]string)
	if !ok {
		t.Fatalf("expected command args slice, got %#v", fakeRuntime.lastParams["command"])
	}
	wantCommand := []string{
		"C:/Program Files/PowerShell/7/pwsh.exe",
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		"Write-Output 'hello'",
	}
	if !reflect.DeepEqual(command, wantCommand) {
		t.Fatalf("unexpected command args: got %#v want %#v", command, wantCommand)
	}
	if output["ok"] != true {
		t.Fatalf("expected ok output, got %#v", output)
	}
	if output["shell"] != "pwsh" {
		t.Fatalf("expected resolved shell pwsh, got %#v", output["shell"])
	}
	if output["exitCode"] != 0 {
		t.Fatalf("expected exitCode=0, got %#v", output["exitCode"])
	}
}

func findShellScriptFormField(fields []ExecutorFormField, purpose string) *ExecutorFormField {
	for index := range fields {
		if fields[index].Purpose == purpose {
			return &fields[index]
		}
	}
	return nil
}

func TestShellScriptRunnerExecuteReturnsFailureOutputOnNonZeroExit(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	fakeRuntime := &fakeShellScriptRuntime{
		rootPath: workspace.RootPath,
		exitCode: 2,
		stdout:   "",
		stderr:   "boom",
	}

	runner := shellScriptRunner{
		runtimes: fakeRuntime,
		store:    dataStore,
		lookPath: func(name string) (string, error) { return `C:\Windows\System32\cmd.exe`, nil },
		goos:     "windows",
		comSpec:  `C:\Windows\System32\cmd.exe`,
	}

	_, err := runner.Execute(context.Background(), ExecutionRequest{
		WorkspaceID: workspace.ID,
		Job: store.BackgroundJob{
			WorkspaceID:  workspace.ID,
			ExecutorKind: "shell_script",
			Payload: map[string]any{
				"script":  "exit /b 2",
				"shell":   "cmd",
				"workdir": ".",
			},
		},
	})
	if err == nil {
		t.Fatal("expected non-zero exit to return an error")
	}

	output := extractFailureOutput(err)
	if got, ok := output["exitCode"].(float64); !ok || got != 2 {
		t.Fatalf("expected failure output exitCode=2, got %#v", got)
	}
	if got := output["stderr"]; got != "boom" {
		t.Fatalf("expected failure output stderr, got %#v", got)
	}
	meta, ok := ExtractErrorMetadata(err)
	if !ok || meta.Code != "shell_script_exit_non_zero" || meta.Retryable == nil || !*meta.Retryable {
		t.Fatalf("expected retryable shell_script_exit_non_zero metadata, got %#v", meta)
	}
}
