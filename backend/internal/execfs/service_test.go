package execfs

import (
	"encoding/base64"
	"errors"
	stdruntime "runtime"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

func TestResolveWorkspacePathAcceptsRelativePathInsideRoot(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	runtimes := appRuntime.NewManager("codex app-server --listen stdio://", hub)
	runtimes.Configure("ws-1", `E:\projects\ai\codex-server`)

	service := NewService(runtimes, hub, nil)
	resolvedPath, err := service.resolveWorkspacePath("ws-1", `backend\main.go`)
	if err != nil {
		t.Fatalf("resolveWorkspacePath() error = %v", err)
	}

	expected := `E:\projects\ai\codex-server\backend\main.go`
	if resolvedPath != expected {
		t.Fatalf("expected %q, got %q", expected, resolvedPath)
	}
}

func TestResolveWorkspacePathRejectsEscapingRoot(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	runtimes := appRuntime.NewManager("codex app-server --listen stdio://", hub)
	runtimes.Configure("ws-1", `E:\projects\ai\codex-server`)

	service := NewService(runtimes, hub, nil)
	if _, err := service.resolveWorkspacePath("ws-1", `..\outside.txt`); err == nil {
		t.Fatal("expected resolveWorkspacePath to reject escaping root")
	}
}

func TestCommandSandboxPolicyDefaultsToDangerFullAccess(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	policy := service.commandSandboxPolicy()

	if got := policy["type"]; got != "dangerFullAccess" {
		t.Fatalf("expected default command sandbox policy, got %#v", got)
	}
}

func TestCommandSandboxPolicyUsesConfiguredRuntimePreference(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		DefaultCommandSandboxPolicy: map[string]any{
			"type":          "externalSandbox",
			"networkAccess": "enabled",
		},
	})

	service := NewService(nil, nil, dataStore)
	policy := service.commandSandboxPolicy()

	if got := policy["type"]; got != "externalSandbox" {
		t.Fatalf("expected configured sandbox policy type, got %#v", got)
	}
	if got := policy["networkAccess"]; got != "enabled" {
		t.Fatalf("expected configured sandbox network access, got %#v", got)
	}
}

func TestCloseCommandSessionRemovesSnapshot(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	createdAt := time.Now().UTC().Add(-time.Minute)

	service.mu.Lock()
	service.upsertCommandSessionSnapshotLocked(store.CommandSessionSnapshot{
		CommandSession: store.CommandSession{
			ID:          "proc_001",
			WorkspaceID: "ws-1",
			Command:     "echo hi",
			Status:      "completed",
			CreatedAt:   createdAt,
		},
		UpdatedAt: createdAt,
	})
	service.mu.Unlock()

	if err := service.CloseCommandSession(t.Context(), "ws-1", "proc_001"); err != nil {
		t.Fatalf("CloseCommandSession() error = %v", err)
	}

	if got := service.ListCommandSessions("ws-1"); len(got) != 0 {
		t.Fatalf("expected session snapshot to be removed, got %#v", got)
	}
}

func TestClearCompletedCommandSessionsKeepsActiveSessions(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	now := time.Now().UTC()

	service.mu.Lock()
	service.upsertCommandSessionSnapshotLocked(store.CommandSessionSnapshot{
		CommandSession: store.CommandSession{
			ID:          "proc_done",
			WorkspaceID: "ws-1",
			Command:     "echo done",
			Status:      "completed",
			CreatedAt:   now.Add(-2 * time.Minute),
		},
		UpdatedAt: now.Add(-time.Minute),
	})
	service.upsertCommandSessionSnapshotLocked(store.CommandSessionSnapshot{
		CommandSession: store.CommandSession{
			ID:          "proc_run",
			WorkspaceID: "ws-1",
			Command:     "tail -f log",
			Status:      "running",
			CreatedAt:   now.Add(-3 * time.Minute),
		},
		UpdatedAt: now,
	})
	service.mu.Unlock()

	removed := service.ClearCompletedCommandSessions("ws-1")
	if len(removed) != 1 || removed[0] != "proc_done" {
		t.Fatalf("expected only completed session removed, got %#v", removed)
	}

	sessions := service.ListCommandSessions("ws-1")
	if len(sessions) != 1 || sessions[0].ID != "proc_run" {
		t.Fatalf("expected running session to remain, got %#v", sessions)
	}
}

func TestHydrateCommandSessionsMarksActiveSessionsFailed(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace 1", `E:\projects\ai\codex-server`)
	now := time.Now().UTC()
	dataStore.UpsertCommandSessionSnapshot(store.CommandSessionSnapshot{
		CommandSession: store.CommandSession{
			ID:          "proc_active",
			WorkspaceID: workspace.ID,
			Command:     "tail -f log",
			Status:      "running",
			CreatedAt:   now.Add(-time.Minute),
		},
		UpdatedAt: now,
	})

	service := NewService(nil, nil, dataStore)
	sessions := service.ListCommandSessions(workspace.ID)
	if len(sessions) != 1 {
		t.Fatalf("expected hydrated command session, got %#v", sessions)
	}
	if sessions[0].Status != "failed" {
		t.Fatalf("expected active session to be marked failed after restart, got %q", sessions[0].Status)
	}
	if sessions[0].Error == "" {
		t.Fatal("expected failed hydrated session to carry an error reason")
	}
}

func TestListCommandSessionStateSnapshotsOmitsOutput(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	now := time.Now().UTC()

	service.mu.Lock()
	service.sessionsByWorkspace["ws-1"] = map[string]store.CommandSessionSnapshot{
		"proc_001": {
			CommandSession: store.CommandSession{
				ID:          "proc_001",
				WorkspaceID: "ws-1",
				Command:     "echo test",
				Status:      "running",
				CreatedAt:   now.Add(-time.Minute),
			},
			CombinedOutput: "hello\r\n",
			Stdout:         "hello\r\n",
			UpdatedAt:      now,
		},
	}
	service.mu.Unlock()

	got := service.ListCommandSessionStateSnapshots("ws-1")
	if len(got) != 1 {
		t.Fatalf("expected 1 state snapshot, got %#v", got)
	}
	if got[0].CombinedOutput != "" || got[0].Stdout != "" || got[0].Stderr != "" {
		t.Fatalf("expected state snapshot to omit output, got %#v", got[0])
	}
}

func TestBuildCommandSessionResumeEventsAppendsOnlyMissingTail(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	now := time.Now().UTC()
	currentOutput := "line 1\r\nline 2\r\n"

	service.mu.Lock()
	service.sessionsByWorkspace["ws-1"] = map[string]store.CommandSessionSnapshot{
		"proc_001": {
			CommandSession: store.CommandSession{
				ID:          "proc_001",
				WorkspaceID: "ws-1",
				Command:     "echo test",
				Status:      "running",
				CreatedAt:   now.Add(-time.Minute),
			},
			CombinedOutput: currentOutput,
			UpdatedAt:      now,
		},
	}
	service.mu.Unlock()

	events := service.BuildCommandSessionResumeEvents("ws-1", []CommandSessionResumeCursor{
		{
			ID:           "proc_001",
			OutputLength: len("line 1\r\n"),
			OutputTail:   "line 1\r\n",
			UpdatedAt:    now.Add(-time.Second).Format(time.RFC3339Nano),
		},
	})

	if len(events) != 1 {
		t.Fatalf("expected one resume delta event, got %#v", events)
	}

	payload, ok := events[0].Payload.(map[string]any)
	if !ok {
		t.Fatalf("expected map payload, got %#v", events[0].Payload)
	}
	if _, hasReplace := payload["replace"]; hasReplace {
		t.Fatalf("expected append-only replay, got %#v", payload)
	}
	if payload["replayReason"] != "cursor_match" {
		t.Fatalf("expected cursor_match replay reason, got %#v", payload["replayReason"])
	}
	if payload["replayBytes"] != len([]byte("line 2\r\n")) {
		t.Fatalf("expected replay byte count for missing tail, got %#v", payload["replayBytes"])
	}

	decoded := readExecfsTestDeltaPayload(t, payload)
	if string(decoded) != "line 2\r\n" {
		t.Fatalf("expected only missing tail, got %q", string(decoded))
	}
}

func TestBuildCommandSessionResumeEventsReplacesWhenOverlapMissing(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	now := time.Now().UTC()
	currentOutput := "line 1\r\nline 2\r\n"

	service.mu.Lock()
	service.sessionsByWorkspace["ws-1"] = map[string]store.CommandSessionSnapshot{
		"proc_001": {
			CommandSession: store.CommandSession{
				ID:          "proc_001",
				WorkspaceID: "ws-1",
				Command:     "echo test",
				Status:      "running",
				CreatedAt:   now.Add(-time.Minute),
			},
			CombinedOutput: currentOutput,
			UpdatedAt:      now,
		},
	}
	service.mu.Unlock()

	events := service.BuildCommandSessionResumeEvents("ws-1", []CommandSessionResumeCursor{
		{
			ID:           "proc_001",
			OutputLength: len("stale"),
			OutputTail:   "stale",
			UpdatedAt:    now.Add(-time.Second).Format(time.RFC3339Nano),
		},
	})

	if len(events) != 1 {
		t.Fatalf("expected one replace replay event, got %#v", events)
	}

	payload, ok := events[0].Payload.(map[string]any)
	if !ok {
		t.Fatalf("expected map payload, got %#v", events[0].Payload)
	}
	if payload["replace"] != true {
		t.Fatalf("expected replay replace flag, got %#v", payload)
	}
	if payload["replayReason"] != "tail_mismatch" {
		t.Fatalf("expected tail_mismatch replay reason, got %#v", payload["replayReason"])
	}
	if payload["replayBytes"] != len([]byte(currentOutput)) {
		t.Fatalf("expected replay byte count for replace fallback, got %#v", payload["replayBytes"])
	}

	decoded := readExecfsTestDeltaPayload(t, payload)
	if string(decoded) != currentOutput {
		t.Fatalf("expected full replay output, got %q", string(decoded))
	}
}

func readExecfsTestDeltaPayload(t *testing.T, payload map[string]any) []byte {
	t.Helper()

	if deltaText, ok := payload["deltaText"].(string); ok {
		return []byte(deltaText)
	}

	decoded, err := base64.StdEncoding.DecodeString(payload["deltaBase64"].(string))
	if err != nil {
		t.Fatalf("decode deltaBase64: %v", err)
	}

	return decoded
}

func TestListCommandSessionsForClientOmitsSplitStreams(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	now := time.Now().UTC()

	service.mu.Lock()
	service.sessionsByWorkspace["ws-1"] = map[string]store.CommandSessionSnapshot{
		"proc_001": {
			CommandSession: store.CommandSession{
				ID:          "proc_001",
				WorkspaceID: "ws-1",
				Command:     "echo test",
				Status:      "running",
				CreatedAt:   now,
			},
			CombinedOutput: "combined",
			Stdout:         "stdout",
			Stderr:         "stderr",
			UpdatedAt:      now,
		},
	}
	service.mu.Unlock()

	got := service.ListCommandSessionsForClient("ws-1")
	if len(got) != 1 {
		t.Fatalf("expected one client session snapshot, got %#v", got)
	}
	if got[0].CombinedOutput != "combined" {
		t.Fatalf("expected combined output preserved, got %#v", got[0].CombinedOutput)
	}
	if got[0].Stdout != "" || got[0].Stderr != "" {
		t.Fatalf("expected split streams omitted for client snapshot, got %#v", got[0])
	}
}

func TestResolveCommandStartSpecUsesWrappedCommandModeByDefault(t *testing.T) {
	t.Parallel()

	spec, err := resolveCommandStartSpec(StartCommandInput{
		Command: "git status",
	})
	if err != nil {
		t.Fatalf("resolveCommandStartSpec() error = %v", err)
	}

	if spec.displayCommand != "git status" {
		t.Fatalf("expected display command preserved, got %q", spec.displayCommand)
	}
	if len(spec.commandArgs) == 0 {
		t.Fatal("expected wrapped command arguments")
	}
	if spec.mode != "command" {
		t.Fatalf("expected command mode metadata, got %q", spec.mode)
	}
	if strings.TrimSpace(spec.shellPath) == "" {
		t.Fatal("expected wrapped command mode to record its shell path")
	}
}

func TestResolveCommandStartSpecRejectsEmptyCommandInCommandMode(t *testing.T) {
	t.Parallel()

	if _, err := resolveCommandStartSpec(StartCommandInput{Mode: "command"}); err == nil {
		t.Fatal("expected empty command mode input to be rejected")
	}
}

func TestResolveCommandStartSpecBuildsDefaultShellMode(t *testing.T) {
	t.Parallel()

	spec, err := resolveCommandStartSpec(StartCommandInput{Mode: "shell"})
	if err != nil {
		t.Fatalf("resolveCommandStartSpec() error = %v", err)
	}

	if strings.TrimSpace(spec.displayCommand) == "" {
		t.Fatal("expected shell mode to expose a display command")
	}
	if len(spec.commandArgs) == 0 || strings.TrimSpace(spec.commandArgs[0]) == "" {
		t.Fatalf("expected shell mode to produce launch arguments, got %#v", spec.commandArgs)
	}
	if spec.mode != "shell" {
		t.Fatalf("expected shell mode metadata, got %q", spec.mode)
	}
	if strings.TrimSpace(spec.shellPath) == "" {
		t.Fatal("expected shell mode to record the shell path")
	}
}

func TestResolveCommandStartSpecHonorsConfiguredTerminalShellOnWindows(t *testing.T) {
	t.Parallel()

	if stdruntime.GOOS != "windows" {
		t.Skip("windows-specific terminal shell selection")
	}

	path := resolvePreferredWindowsShellPath(
		func(candidate string) (string, error) {
			switch candidate {
			case "cmd.exe":
				return `C:\Windows\System32\cmd.exe`, nil
			default:
				return "", errors.New("not found")
			}
		},
		`C:\Windows\System32\cmd.exe`,
		"cmd",
	)

	if path != `C:\Windows\System32\cmd.exe` {
		t.Fatalf("expected configured cmd terminal shell, got %q", path)
	}
}

func TestResolvePreferredGitBashPathFindsGitInstallation(t *testing.T) {
	t.Parallel()

	path, ok := resolvePreferredGitBashPath(
		func(candidate string) (string, error) {
			if candidate == "git.exe" {
				return `C:\Program Files\Git\cmd\git.exe`, nil
			}
			return "", errors.New("not found")
		},
	)

	if stdruntime.GOOS == "windows" && ok {
		if !strings.Contains(strings.ToLower(path), `\git\`) {
			t.Fatalf("expected git bash path from git installation, got %q", path)
		}
	}
}

func TestResolveCommandStartSpecRejectsUnknownMode(t *testing.T) {
	t.Parallel()

	if _, err := resolveCommandStartSpec(StartCommandInput{
		Command: "git status",
		Mode:    "interactive",
	}); err == nil {
		t.Fatal("expected unknown command mode to be rejected")
	}
}

func TestResolveCommandStartSpecRejectsUnknownTerminalShellOverride(t *testing.T) {
	t.Parallel()

	if _, err := resolveCommandStartSpecWithTerminalShell(
		StartCommandInput{Mode: "shell", Shell: "fish"},
		"",
	); err == nil {
		t.Fatal("expected unknown terminal shell override to be rejected")
	}
}

func TestExtractTerminalCurrentCwdReadsOsc7Sequence(t *testing.T) {
	t.Parallel()

	output := "prompt\x1b]7;file:///tmp/project\x07$ "
	got := extractTerminalCurrentCwd(output, "/fallback")

	if got == "/tmp/project" {
		return
	}

	if got == `tmp\project` || got == `\tmp\project` {
		return
	}

	t.Fatalf("expected OSC 7 cwd to be parsed, got %q", got)
}

func TestApplyShellIntegrationDeltaLockedUpdatesSessionState(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	session := store.CommandSessionSnapshot{
		CommandSession: store.CommandSession{
			ID:         "proc_001",
			CurrentCwd: "/workspace",
			Mode:       "shell",
			ShellState: "starting",
		},
	}

	events := service.applyShellIntegrationDeltaLocked(
		"ws-1",
		"proc_001",
		"\x1b]133;A\x07\x1b]7;file:///tmp/project\x07\x1b]133;C\x07\x1b]133;D;7\x07",
		&session,
	)

	if len(events) != 4 {
		t.Fatalf("expected 4 shell integration events, got %d", len(events))
	}
	if session.ShellState != "prompt" {
		t.Fatalf("expected session shell state prompt after command finish, got %q", session.ShellState)
	}
	if session.LastExitCode == nil || *session.LastExitCode != 7 {
		t.Fatalf("expected last exit code 7, got %#v", session.LastExitCode)
	}

	if session.CurrentCwd == "/tmp/project" {
		return
	}

	if session.CurrentCwd == `tmp\project` || session.CurrentCwd == `\tmp\project` {
		return
	}

	t.Fatalf("expected cwd parsed from shell integration, got %q", session.CurrentCwd)
}

func TestApplyCommandCompletedDoesNotDuplicateStreamedOutput(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	now := time.Now().UTC()
	streamedOutput := "first line\r\n\r\nsecond line\r\n"

	service.mu.Lock()
	service.sessionsByWorkspace["ws-1"] = map[string]store.CommandSessionSnapshot{
		"proc_001": {
			CommandSession: store.CommandSession{
				ID:          "proc_001",
				WorkspaceID: "ws-1",
				Command:     "echo test",
				Status:      "running",
				CreatedAt:   now.Add(-time.Minute),
			},
			CombinedOutput: streamedOutput,
			UpdatedAt:      now.Add(-time.Second),
		},
	}
	service.mu.Unlock()

	service.applyCommandCompleted(store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "command/exec/completed",
		Payload: map[string]any{
			"processId": "proc_001",
			"status":    "completed",
			"stdout":    streamedOutput,
		},
		TS: now,
	})

	got := service.ListCommandSessions("ws-1")
	if len(got) != 1 {
		t.Fatalf("expected 1 session, got %#v", got)
	}
	if got[0].CombinedOutput != streamedOutput {
		t.Fatalf("expected completion to avoid duplicating streamed combined output, got %q", got[0].CombinedOutput)
	}
	if got[0].Stdout != "" || got[0].Stderr != "" {
		t.Fatalf("expected split stream buffers to remain empty, got %#v", got[0])
	}
}

func TestApplyCommandCompletedAppendsOnlyMissingCompletionTail(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	now := time.Now().UTC()
	streamedOutput := "line 1\r\n"
	finalOutput := "line 1\r\nline 2\r\n"

	service.mu.Lock()
	service.sessionsByWorkspace["ws-1"] = map[string]store.CommandSessionSnapshot{
		"proc_001": {
			CommandSession: store.CommandSession{
				ID:          "proc_001",
				WorkspaceID: "ws-1",
				Command:     "echo test",
				Status:      "running",
				CreatedAt:   now.Add(-time.Minute),
			},
			CombinedOutput: streamedOutput,
			UpdatedAt:      now.Add(-time.Second),
		},
	}
	service.mu.Unlock()

	service.applyCommandCompleted(store.EventEnvelope{
		WorkspaceID: "ws-1",
		Method:      "command/exec/completed",
		Payload: map[string]any{
			"processId": "proc_001",
			"status":    "completed",
			"stdout":    finalOutput,
		},
		TS: now,
	})

	got := service.ListCommandSessions("ws-1")
	if len(got) != 1 {
		t.Fatalf("expected 1 session, got %#v", got)
	}
	if got[0].CombinedOutput != finalOutput {
		t.Fatalf("expected completion to append only missing tail, got %q", got[0].CombinedOutput)
	}
	if got[0].Stdout != "" || got[0].Stderr != "" {
		t.Fatalf("expected split stream buffers to remain empty, got %#v", got[0])
	}
}

func TestBuildIntegratedShellCommandArgsWrapsBashInteractiveRcfile(t *testing.T) {
	t.Parallel()

	args, err := buildIntegratedShellCommandArgs("/bin/bash")
	if err != nil {
		t.Fatalf("buildIntegratedShellCommandArgs() error = %v", err)
	}
	if len(args) != 4 {
		t.Fatalf("expected bash integration args, got %#v", args)
	}
	if args[0] != "/bin/bash" || args[1] != "--rcfile" || args[3] != "-i" {
		t.Fatalf("unexpected bash integration args %#v", args)
	}
}

func TestBuildIntegratedShellCommandArgsWrapsZshWithZDotDirBootstrap(t *testing.T) {
	t.Parallel()

	args, err := buildIntegratedShellCommandArgs("/bin/zsh")
	if err != nil {
		t.Fatalf("buildIntegratedShellCommandArgs() error = %v", err)
	}
	if len(args) != 3 {
		t.Fatalf("expected zsh integration args, got %#v", args)
	}
	if args[0] != "sh" || args[1] != "-lc" {
		t.Fatalf("unexpected zsh integration args %#v", args)
	}
	if !strings.Contains(args[2], "ZDOTDIR=") || !strings.Contains(args[2], "/bin/zsh") {
		t.Fatalf("expected zsh bootstrap command, got %q", args[2])
	}
}

func TestBuildIntegratedShellCommandArgsWrapsCmdStartupScript(t *testing.T) {
	t.Parallel()

	args, err := buildIntegratedShellCommandArgs("cmd.exe")
	if err != nil {
		t.Fatalf("buildIntegratedShellCommandArgs() error = %v", err)
	}
	if len(args) != 4 {
		t.Fatalf("expected cmd integration args, got %#v", args)
	}
	if args[0] != "cmd.exe" || args[1] != "/Q" || args[2] != "/K" {
		t.Fatalf("unexpected cmd integration args %#v", args)
	}
}

func TestBuildIntegratedShellCommandArgsWrapsPowerShellWithCommandBootstrap(t *testing.T) {
	t.Parallel()

	args, err := buildIntegratedShellCommandArgs("pwsh.exe")
	if err != nil {
		t.Fatalf("buildIntegratedShellCommandArgs() error = %v", err)
	}
	if len(args) != 6 {
		t.Fatalf("expected pwsh integration args, got %#v", args)
	}
	if args[0] != "pwsh.exe" || args[4] != "-Command" {
		t.Fatalf("unexpected pwsh integration args %#v", args)
	}
	if !strings.Contains(args[5], "powershell-integration.ps1") {
		t.Fatalf("expected pwsh bootstrap command, got %q", args[5])
	}
}

func TestPowerShellIntegrationScriptAvoidsPSReadLineReplayNoise(t *testing.T) {
	t.Parallel()

	script := powerShellIntegrationScript()

	if strings.Contains(script, "PSReadLine") {
		t.Fatalf("expected embedded PowerShell integration to avoid PSReadLine redraw sequences, got %q", script)
	}
	if !strings.Contains(script, "__CodexServerEmitPromptReady") {
		t.Fatalf("expected prompt-ready integration to remain in place, got %q", script)
	}
}

func TestResolvePreferredWindowsShellPathPrefersPwshBeforeComSpec(t *testing.T) {
	t.Parallel()

	path := resolvePreferredWindowsShellPath(
		func(candidate string) (string, error) {
			if candidate == "pwsh.exe" {
				return `C:\Program Files\PowerShell\7\pwsh.exe`, nil
			}
			return "", errors.New("not found")
		},
		`C:\Windows\System32\cmd.exe`,
		"",
	)

	if path != `C:\Program Files\PowerShell\7\pwsh.exe` {
		t.Fatalf("expected pwsh preference, got %q", path)
	}
}

func TestBuildCommandExecParamsDisablesTimeoutForShellSessions(t *testing.T) {
	t.Parallel()

	params := buildCommandExecParams(
		commandStartSpec{
			commandArgs: []string{"pwsh.exe"},
			mode:        "shell",
		},
		`E:\projects\ai\codex-server`,
		"proc_001",
		map[string]any{"type": "dangerFullAccess"},
	)

	if params["disableTimeout"] != true {
		t.Fatalf("expected shell sessions to disable timeout, got %#v", params["disableTimeout"])
	}
}

func TestBuildCommandExecParamsKeepsDefaultTimeoutForOneShotCommands(t *testing.T) {
	t.Parallel()

	params := buildCommandExecParams(
		commandStartSpec{
			commandArgs: []string{"cmd.exe", "/c", "git status"},
			mode:        "command",
		},
		`E:\projects\ai\codex-server`,
		"proc_001",
		map[string]any{"type": "dangerFullAccess"},
	)

	if _, ok := params["disableTimeout"]; ok {
		t.Fatalf("expected one-shot command sessions to keep default timeout behavior, got %#v", params)
	}
}

func TestShouldRetryCommandProcessCallOnlyForStartingShells(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	service.mu.Lock()
	service.processes["proc_001"] = "ws-1"
	service.sessionsByWorkspace["ws-1"] = map[string]store.CommandSessionSnapshot{
		"proc_001": {
			CommandSession: store.CommandSession{
				ID:          "proc_001",
				WorkspaceID: "ws-1",
				Mode:        "shell",
				ShellState:  "starting",
			},
		},
	}
	service.mu.Unlock()

	if !service.shouldRetryCommandProcessCall("proc_001", errors.New("no active command/exec")) {
		t.Fatal("expected transient activation error to retry for starting shell")
	}

	service.mu.Lock()
	session := service.sessionsByWorkspace["ws-1"]["proc_001"]
	session.ShellState = "prompt"
	service.sessionsByWorkspace["ws-1"]["proc_001"] = session
	service.mu.Unlock()

	if service.shouldRetryCommandProcessCall("proc_001", errors.New("no active command/exec")) {
		t.Fatal("expected retry to stop once shell is active")
	}
}
