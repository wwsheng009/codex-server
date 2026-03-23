package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPersistentStoreRoundTrip(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.UpsertThread(Thread{
		ID:          "thread-1",
		WorkspaceID: workspace.ID,
		Name:        "Thread A",
		Status:      "idle",
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	workspaces := secondStore.ListWorkspaces()
	if len(workspaces) != 1 {
		t.Fatalf("expected 1 workspace after reload, got %d", len(workspaces))
	}

	threads := secondStore.ListThreads(workspace.ID)
	if len(threads) != 1 {
		t.Fatalf("expected 1 thread after reload, got %d", len(threads))
	}

	if threads[0].Name != "Thread A" {
		t.Fatalf("expected persisted thread name, got %q", threads[0].Name)
	}
}

func TestPersistentStoreSeedsWorkspaceIDs(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	firstWorkspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	if firstWorkspace.ID == "" {
		t.Fatal("expected first workspace id")
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	secondWorkspace := secondStore.CreateWorkspace("Workspace B", "E:/projects/b")
	if secondWorkspace.ID == firstWorkspace.ID {
		t.Fatalf("expected unique workspace id after reload, got duplicate %q", secondWorkspace.ID)
	}
}

func TestPersistentStorePersistsThreadProjections(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/started",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":        "tool-1",
				"type":      "dynamicToolCall",
				"tool":      "search_query",
				"status":    "inProgress",
				"arguments": map[string]any{"q": "codex"},
			},
		},
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	projection, ok := secondStore.GetThreadProjection(workspace.ID, "thread-1")
	if !ok {
		t.Fatal("expected thread projection to persist after reload")
	}
	if len(projection.Turns) != 1 {
		t.Fatalf("expected 1 projected turn, got %d", len(projection.Turns))
	}
	if len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected 1 projected item, got %d", len(projection.Turns[0].Items))
	}
	if got := projection.Turns[0].Items[0]["type"]; got != "dynamicToolCall" {
		t.Fatalf("expected projected tool call item, got %#v", got)
	}
}

func TestPersistentStorePersistsAutomations(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	_, err = firstStore.CreateAutomation(Automation{
		Title:         "Daily Sync",
		Description:   "Summarize changes",
		Prompt:        "Summarize changes",
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Schedule:      "hourly",
		ScheduleLabel: "Every hour",
		Model:         "gpt-5.4",
		Reasoning:     "medium",
		Status:        "active",
		NextRun:       "Today at next hour",
	})
	if err != nil {
		t.Fatalf("CreateAutomation() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	automations := secondStore.ListAutomations()
	if len(automations) != 1 {
		t.Fatalf("expected 1 automation after reload, got %d", len(automations))
	}
	if automations[0].Title != "Daily Sync" {
		t.Fatalf("expected persisted automation title, got %q", automations[0].Title)
	}
}

func TestPersistentStorePersistsAutomationTemplates(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	template, err := firstStore.CreateAutomationTemplate(AutomationTemplate{
		Category:    "Custom",
		Title:       "Security Audit",
		Description: "Review security posture",
		Prompt:      "Audit the repository for security issues.",
	})
	if err != nil {
		t.Fatalf("CreateAutomationTemplate() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	templates := secondStore.ListAutomationTemplates()
	if len(templates) != 1 {
		t.Fatalf("expected 1 template after reload, got %d", len(templates))
	}
	if templates[0].ID != template.ID || templates[0].Title != "Security Audit" {
		t.Fatalf("expected persisted template, got %#v", templates[0])
	}
}

func TestPersistentStorePersistsAutomationRunsAndNotifications(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	automation, err := firstStore.CreateAutomation(Automation{
		Title:         "Daily Sync",
		Description:   "Summarize changes",
		Prompt:        "Summarize changes",
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Schedule:      "hourly",
		ScheduleLabel: "Every hour",
		Model:         "gpt-5.4",
		Reasoning:     "medium",
		Status:        "active",
		NextRun:       "2026-03-21 09:00",
	})
	if err != nil {
		t.Fatalf("CreateAutomation() error = %v", err)
	}

	run, err := firstStore.CreateAutomationRun(AutomationRun{
		AutomationID:    automation.ID,
		AutomationTitle: automation.Title,
		WorkspaceID:     workspace.ID,
		WorkspaceName:   workspace.Name,
		Status:          "completed",
		Trigger:         "manual",
	})
	if err != nil {
		t.Fatalf("CreateAutomationRun() error = %v", err)
	}
	if _, err := firstStore.AppendAutomationRunLog(run.ID, AutomationRunLogEntry{
		Level:   "info",
		Message: "Run started",
	}); err != nil {
		t.Fatalf("AppendAutomationRunLog() error = %v", err)
	}

	if _, err := firstStore.CreateNotification(Notification{
		WorkspaceID:     workspace.ID,
		WorkspaceName:   workspace.Name,
		AutomationID:    automation.ID,
		AutomationTitle: automation.Title,
		RunID:           run.ID,
		Kind:            "automation_run_completed",
		Title:           "Automation completed",
		Message:         "Daily Sync completed",
		Level:           "success",
	}); err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	reloadedRuns := secondStore.ListAutomationRuns(automation.ID)
	if len(reloadedRuns) != 1 {
		t.Fatalf("expected 1 automation run after reload, got %d", len(reloadedRuns))
	}
	if len(reloadedRuns[0].Logs) != 1 {
		t.Fatalf("expected persisted run logs, got %#v", reloadedRuns[0].Logs)
	}

	reloadedNotifications := secondStore.ListNotifications()
	if len(reloadedNotifications) != 1 {
		t.Fatalf("expected 1 notification after reload, got %d", len(reloadedNotifications))
	}
	if reloadedNotifications[0].Kind != "automation_run_completed" {
		t.Fatalf("expected persisted notification kind, got %q", reloadedNotifications[0].Kind)
	}
}

func TestThreadProjectionPersistsServerRequests(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/commandExecution/requestApproval",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"command":  "rm -rf build",
		},
		ServerRequestID: ptr("req-1"),
	})
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "server/request/resolved",
		Payload: map[string]any{
			"method": "item/commandExecution/requestApproval",
		},
		ServerRequestID: ptr("req-1"),
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	projection, ok := secondStore.GetThreadProjection(workspace.ID, "thread-1")
	if !ok || len(projection.Turns) != 1 || len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected persisted server request projection, got %#v", projection)
	}
	if got := projection.Turns[0].Items[0]["type"]; got != "serverRequest" {
		t.Fatalf("expected serverRequest item, got %#v", got)
	}
	if got := projection.Turns[0].Items[0]["status"]; got != "resolved" {
		t.Fatalf("expected resolved request status, got %#v", got)
	}
}

func TestPersistentStorePersistsCommandSessions(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
		CommandSession: CommandSession{
			ID:          "proc_001",
			WorkspaceID: workspace.ID,
			Command:     "echo hello",
			Mode:        "command",
			ShellPath:   "cmd.exe",
			InitialCwd:  workspace.RootPath,
			CurrentCwd:  workspace.RootPath,
			Status:      "completed",
			CreatedAt:   time.Now().UTC().Add(-time.Minute),
		},
		CombinedOutput: "hello\r\n",
		Stdout:         "hello\r\n",
		UpdatedAt:      time.Now().UTC(),
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	sessions := secondStore.ListCommandSessions(workspace.ID)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 command session after reload, got %d", len(sessions))
	}
	if sessions[0].CombinedOutput != "hello\r\n" {
		t.Fatalf("expected persisted combined output, got %q", sessions[0].CombinedOutput)
	}
	if sessions[0].Mode != "command" || sessions[0].ShellPath != "cmd.exe" {
		t.Fatalf("expected persisted command session metadata, got %#v", sessions[0])
	}
	if sessions[0].CurrentCwd != workspace.RootPath {
		t.Fatalf("expected persisted command session cwd, got %q", sessions[0].CurrentCwd)
	}
}

func TestCommandSessionRetentionAndTTL(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	now := time.Now().UTC()

	for index := 0; index < 10; index += 1 {
		dataStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
			CommandSession: CommandSession{
				ID:          "proc_" + string(rune('a'+index)),
				WorkspaceID: workspace.ID,
				Command:     "echo test",
				Status:      "completed",
				CreatedAt:   now.Add(-time.Duration(index) * time.Minute),
			},
			UpdatedAt: now.Add(-time.Duration(index) * time.Minute),
		})
	}

	sessions := dataStore.ListCommandSessions(workspace.ID)
	if len(sessions) != 10 {
		t.Fatalf("expected 10 command sessions before retention overflow, got %d", len(sessions))
	}

	dataStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
		CommandSession: CommandSession{
			ID:          "proc_expired",
			WorkspaceID: workspace.ID,
			Command:     "echo old",
			Status:      "completed",
			CreatedAt:   now.Add(-48 * time.Hour),
		},
		UpdatedAt: now.Add(-48 * time.Hour),
	})

	removed := dataStore.PruneExpiredCommandSessions(now)
	if len(removed) == 0 {
		t.Fatal("expected expired command session to be pruned")
	}

	for index := 10; index < 16; index += 1 {
		dataStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
			CommandSession: CommandSession{
				ID:          "proc_" + string(rune('a'+index)),
				WorkspaceID: workspace.ID,
				Command:     "echo test",
				Status:      "completed",
				CreatedAt:   now.Add(-time.Duration(index) * time.Minute),
			},
			UpdatedAt: now.Add(-time.Duration(index) * time.Minute),
		})
	}

	sessions = dataStore.ListCommandSessions(workspace.ID)
	if len(sessions) != commandSessionRetentionLimit {
		t.Fatalf("expected retention limit %d after overflow, got %d", commandSessionRetentionLimit, len(sessions))
	}
}

func TestPinnedAndArchivedCommandSessionsAreCapped(t *testing.T) {
	t.Parallel()

	dataStore := NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	now := time.Now().UTC()

	for index := 0; index < commandSessionPinnedArchivedLimit+6; index += 1 {
		dataStore.UpsertCommandSessionSnapshot(CommandSessionSnapshot{
			CommandSession: CommandSession{
				ID:          "proc_pinned_" + string(rune('a'+index)),
				WorkspaceID: workspace.ID,
				Command:     "echo pinned",
				Status:      "completed",
				CreatedAt:   now.Add(-time.Duration(index) * time.Minute),
			},
			Pinned:    true,
			UpdatedAt: now.Add(-time.Duration(index) * time.Minute),
		})
	}

	sessions := dataStore.ListCommandSessions(workspace.ID)
	if len(sessions) != commandSessionPinnedArchivedLimit {
		t.Fatalf(
			"expected pinned/archived retention limit %d after overflow, got %d",
			commandSessionPinnedArchivedLimit,
			len(sessions),
		)
	}
}

func ptr(value string) *string {
	return &value
}
