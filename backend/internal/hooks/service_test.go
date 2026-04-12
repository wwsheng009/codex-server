package hooks

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turns"
)

func writeDefaultSessionStartDocument(t *testing.T, rootDir string, content string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Join(rootDir, ".codex"), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(rootDir, ".codex", "SESSION_START.md"),
		[]byte(content),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
}

func writeUserCodexSessionStartDocument(t *testing.T, codexHome string, fileName string, content string) {
	t.Helper()

	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(codexHome, fileName),
		[]byte(content),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
}

func TestServiceRecordsHookRunAndDecisionForFailedValidationCommand(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 10, 1, 0, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return fakeTurns.steerCount() == 1 &&
			len(runs) == 1 &&
			runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	run := runs[0]
	if run.EventName != eventNamePostToolUse || run.HandlerKey != handlerKeyFailedValidation {
		t.Fatalf("unexpected hook run identity %#v", run)
	}
	if run.Source != "" {
		t.Fatalf("expected empty hook source without thread projection, got %#v", run)
	}
	if run.DurationMs == nil || *run.DurationMs < 0 {
		t.Fatalf("expected hook duration to be recorded, got %#v", run.DurationMs)
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	decision := decisions[0]
	if decision.GovernanceLayer != governanceLayerHook {
		t.Fatalf("expected hook governance layer, got %#v", decision)
	}
	if decision.HookRunID != run.ID {
		t.Fatalf("expected hook run id %q, got %#v", run.ID, decision)
	}
	if decision.Action != actionSteer || decision.ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected successful steer decision, got %#v", decision)
	}
}

func TestServiceDeduplicatesRepeatedFailedValidationEvents(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	event := store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":       "cmd-1",
				"type":     "commandExecution",
				"command":  "go test ./...",
				"status":   "failed",
				"exitCode": 1,
			},
		},
		TS: time.Date(2026, time.April, 10, 1, 30, 0, 0, time.UTC),
	}

	eventHub.Publish(event)
	eventHub.Publish(event)

	waitFor(t, func() bool {
		return fakeTurns.steerCount() == 1
	})
	time.Sleep(100 * time.Millisecond)

	if fakeTurns.steerCount() != 1 {
		t.Fatalf("expected repeated event to steer only once, got %d", fakeTurns.steerCount())
	}
	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) == 0 {
		t.Fatalf("expected at least one persisted hook run after dedupe, got %#v", runs)
	}
	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) == 0 {
		t.Fatalf("expected at least one persisted decision after dedupe, got %#v", decisions)
	}
	succeededActions := 0
	for _, decision := range decisions {
		if decision.ActionStatus == actionStatusSucceeded {
			succeededActions++
		}
	}
	if succeededActions != 1 {
		t.Fatalf("expected exactly one successful governance action after dedupe, got %#v", decisions)
	}
}

func TestServiceRecordsHookRunForCriticalMcpToolCall(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":     "mcp-1",
				"type":   "mcpToolCall",
				"server": "filesystem",
				"tool":   "write_file",
				"status": "completed",
				"arguments": map[string]any{
					"path": ".codex/hooks.json",
				},
			},
		},
		TS: time.Date(2026, time.April, 10, 2, 30, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}

	run := runs[0]
	if run.EventName != eventNamePostToolUse || run.HandlerKey != handlerKeyMcpToolCallAudit {
		t.Fatalf("unexpected MCP tool call hook run identity %#v", run)
	}
	if run.Decision != decisionContinue {
		t.Fatalf("expected MCP tool call audit to continue, got %#v", run)
	}
	if run.Reason != "protected_governance_file_mutation_observed_after_mcp_tool_call" {
		t.Fatalf("unexpected MCP tool call audit reason %#v", run)
	}
	if run.ToolKind != "mcpToolCall" || run.ToolName != "filesystem/write_file" {
		t.Fatalf("unexpected MCP tool call tool metadata %#v", run)
	}
	if run.TriggerMethod != "item/completed" || run.ItemID != "mcp-1" {
		t.Fatalf("unexpected MCP tool call trigger metadata %#v", run)
	}
	if len(dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")) != 0 {
		t.Fatalf("expected audit-only MCP tool call observation to skip governance actions, got %#v", dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1"))
	}
}

func TestServiceRecordsHookRunForMcpMoveFromProtectedSourceUsesSourcePathEntry(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":     "mcp-2",
				"type":   "mcpToolCall",
				"server": "filesystem",
				"tool":   "move_file",
				"status": "completed",
				"arguments": map[string]any{
					"source_path":      ".codex/hooks.json",
					"destination_path": "docs/hooks-moved.json",
				},
			},
		},
		TS: time.Date(2026, time.April, 10, 2, 30, 30, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}

	run := runs[0]
	if run.Reason != "protected_governance_file_mutation_observed_after_mcp_tool_call" {
		t.Fatalf("unexpected MCP move audit reason %#v", run)
	}
	if !containsHookEntry(run.Entries, "sourcePath=.codex/hooks.json") {
		t.Fatalf("expected MCP move audit to record matched source path, got %#v", run.Entries)
	}
}

func TestServiceSkipsSafeReadOnlyMcpToolCall(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":     "mcp-1",
				"type":   "mcpToolCall",
				"server": "filesystem",
				"tool":   "read_file",
				"status": "completed",
				"arguments": map[string]any{
					"path": "README.md",
				},
			},
		},
		TS: time.Date(2026, time.April, 10, 2, 31, 0, 0, time.UTC),
	})

	time.Sleep(150 * time.Millisecond)

	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected read-only MCP tool call to skip hook audit, got %#v", runs)
	}
}

func TestServiceRecordsHookRunForMcpElicitationRequest(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "mcpServer/elicitation/request",
		Payload: map[string]any{
			"threadId":   "thread-1",
			"turnId":     "turn-1",
			"serverName": "github",
			"mode":       "url",
			"message":    "Open the browser to complete GitHub authentication.",
		},
		TS: time.Date(2026, time.April, 10, 2, 32, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}

	run := runs[0]
	if run.EventName != eventNameServerRequest || run.HandlerKey != handlerKeyMcpElicitationAudit {
		t.Fatalf("unexpected MCP elicitation hook run identity %#v", run)
	}
	if run.Decision != decisionContinue || run.Reason != "mcp_elicitation_request_audited" {
		t.Fatalf("unexpected MCP elicitation hook run decision %#v", run)
	}
	if run.TriggerMethod != "mcpServer/elicitation/request" || run.ToolName != "github" {
		t.Fatalf("unexpected MCP elicitation hook run metadata %#v", run)
	}
	if !strings.Contains(run.AdditionalContext, "GitHub authentication") {
		t.Fatalf("expected MCP elicitation message to be preserved, got %#v", run)
	}
}

func TestServiceRecordsHookRunForCommandExecutionApprovalRequest(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	requestID := "req-command-1"
	eventHub.Publish(store.EventEnvelope{
		WorkspaceID:     workspace.ID,
		ThreadID:        "thread-1",
		TurnID:          "turn-1",
		Method:          "item/commandExecution/requestApproval",
		ServerRequestID: &requestID,
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"command":  "rm -rf build",
		},
		TS: time.Date(2026, time.April, 10, 2, 33, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	run, ok := findHookRun(runs, eventNameServerRequest, handlerKeyServerRequestApprovalAudit)
	if !ok {
		t.Fatalf("expected approval server request hook run, got %#v", runs)
	}
	if run.TriggerMethod != "item/commandExecution/requestApproval" || run.ToolKind != "commandExecutionApprovalRequest" {
		t.Fatalf("unexpected command approval hook metadata %#v", run)
	}
	if run.ToolName != "rm -rf build" || run.Reason != "command_execution_approval_request_audited" {
		t.Fatalf("unexpected command approval hook payload %#v", run)
	}
	if run.ItemID != requestID {
		t.Fatalf("expected request id %q to be persisted as hook item id, got %#v", requestID, run)
	}
	if len(dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")) != 0 {
		t.Fatalf("expected command approval audit to avoid governance actions, got %#v", dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1"))
	}
}

func TestServiceRecordsHookRunForFileChangeApprovalRequest(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	requestID := "req-file-1"
	eventHub.Publish(store.EventEnvelope{
		WorkspaceID:     workspace.ID,
		ThreadID:        "thread-1",
		TurnID:          "turn-1",
		Method:          "item/fileChange/requestApproval",
		ServerRequestID: &requestID,
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"path":     "backend/internal/hooks/service.go",
		},
		TS: time.Date(2026, time.April, 10, 2, 34, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	run, ok := findHookRun(runs, eventNameServerRequest, handlerKeyServerRequestApprovalAudit)
	if !ok {
		t.Fatalf("expected approval server request hook run, got %#v", runs)
	}
	if run.TriggerMethod != "item/fileChange/requestApproval" || run.ToolKind != "fileChangeApprovalRequest" {
		t.Fatalf("unexpected file change approval hook metadata %#v", run)
	}
	if run.ToolName != "backend/internal/hooks/service.go" || run.Reason != "file_change_approval_request_audited" {
		t.Fatalf("unexpected file change approval hook payload %#v", run)
	}
}

func TestServiceRecordsHookRunForPermissionsApprovalRequest(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	requestID := "req-permissions-1"
	eventHub.Publish(store.EventEnvelope{
		WorkspaceID:     workspace.ID,
		ThreadID:        "thread-1",
		TurnID:          "turn-1",
		Method:          "item/permissions/requestApproval",
		ServerRequestID: &requestID,
		Payload: map[string]any{
			"threadId":    "thread-1",
			"turnId":      "turn-1",
			"reason":      "Need broader workspace access",
			"permissions": []any{"fs.write", "network"},
		},
		TS: time.Date(2026, time.April, 10, 2, 35, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	run, ok := findHookRun(runs, eventNameServerRequest, handlerKeyServerRequestApprovalAudit)
	if !ok {
		t.Fatalf("expected approval server request hook run, got %#v", runs)
	}
	if run.TriggerMethod != "item/permissions/requestApproval" || run.ToolKind != "permissionsApprovalRequest" {
		t.Fatalf("unexpected permissions approval hook metadata %#v", run)
	}
	if run.ToolName != "permissions" || run.Reason != "permissions_approval_request_audited" {
		t.Fatalf("unexpected permissions approval hook payload %#v", run)
	}
	if !strings.Contains(run.AdditionalContext, "broader workspace access") {
		t.Fatalf("expected permissions approval reason to be preserved, got %#v", run)
	}
}

func TestServiceRecordsHookRunForDynamicToolCallRequest(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	requestID := "req-tool-1"
	eventHub.Publish(store.EventEnvelope{
		WorkspaceID:     workspace.ID,
		ThreadID:        "thread-1",
		TurnID:          "turn-1",
		Method:          "item/tool/call",
		ServerRequestID: &requestID,
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"tool":     "search_query",
		},
		TS: time.Date(2026, time.April, 10, 2, 36, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	run, ok := findHookRun(runs, eventNameServerRequest, handlerKeyServerRequestApprovalAudit)
	if !ok {
		t.Fatalf("expected approval server request hook run, got %#v", runs)
	}
	if run.TriggerMethod != "item/tool/call" || run.ToolKind != "dynamicToolCallRequest" {
		t.Fatalf("unexpected dynamic tool call hook metadata %#v", run)
	}
	if run.ToolName != "search_query" || run.Reason != "dynamic_tool_call_request_audited" {
		t.Fatalf("unexpected dynamic tool call hook payload %#v", run)
	}
}

func TestServiceRecordsHookRunForConfigMcpServerReloadHTTPMutation(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		Method:      "workspace/httpMutation",
		Payload: map[string]any{
			"requestId":     "http-req-1",
			"requestKind":   "httpMutation",
			"triggerMethod": "config/mcp-server/reload",
			"toolKind":      "configMcpServerReload",
			"toolName":      "config/mcp-server/reload",
			"reason":        "config_mcp_server_reload_audited",
			"context":       "Reload MCP servers",
			"fingerprint":   "config/mcp-server/reload",
			"scope":         "workspace",
		},
		TS: time.Date(2026, time.April, 10, 2, 37, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "")
	run, ok := findHookRun(runs, eventNameHTTPMutation, handlerKeyHTTPMutationAudit)
	if !ok {
		t.Fatalf("expected HTTP mutation hook run, got %#v", runs)
	}
	if run.TriggerMethod != "config/mcp-server/reload" || run.ToolKind != "configMcpServerReload" {
		t.Fatalf("unexpected config MCP reload hook metadata %#v", run)
	}
	if run.ToolName != "config/mcp-server/reload" || run.Reason != "config_mcp_server_reload_audited" {
		t.Fatalf("unexpected config MCP reload hook payload %#v", run)
	}
	if run.ItemID != "http-req-1" || run.Scope != "workspace" || run.ThreadID != "" {
		t.Fatalf("expected workspace-scoped HTTP mutation hook run, got %#v", run)
	}
}

func TestServiceRecordsHookRunForWindowsSandboxSetupHTTPMutation(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		Method:      "workspace/httpMutation",
		Payload: map[string]any{
			"requestId":     "http-req-2",
			"requestKind":   "httpMutation",
			"triggerMethod": "windows-sandbox/setup-start",
			"toolKind":      "windowsSandboxSetupStart",
			"toolName":      "windows-sandbox/setup-start",
			"reason":        "windows_sandbox_setup_start_audited",
			"context":       "mode=bootstrap",
			"fingerprint":   "windows-sandbox/setup-start\x00bootstrap",
			"scope":         "workspace",
		},
		TS: time.Date(2026, time.April, 10, 2, 38, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "")
	run, ok := findHookRun(runs, eventNameHTTPMutation, handlerKeyHTTPMutationAudit)
	if !ok {
		t.Fatalf("expected HTTP mutation hook run, got %#v", runs)
	}
	if run.TriggerMethod != "windows-sandbox/setup-start" || run.ToolKind != "windowsSandboxSetupStart" {
		t.Fatalf("unexpected windows sandbox hook metadata %#v", run)
	}
	if run.ToolName != "windows-sandbox/setup-start" || run.Reason != "windows_sandbox_setup_start_audited" {
		t.Fatalf("unexpected windows sandbox hook payload %#v", run)
	}
	if !strings.Contains(run.AdditionalContext, "mode=bootstrap") {
		t.Fatalf("expected sandbox mode context to be preserved, got %#v", run)
	}
}

func TestInterruptGovernedTurnRecordsDedicatedHookRun(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		interruptResult: turns.Result{
			TurnID: "turn-interrupted",
			Status: "interrupted",
		},
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	result, err := service.InterruptGovernedTurn(context.Background(), GovernedTurnInterruptInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/interrupt",
		Scope:         "thread",
		RequestID:     "req-interrupt-1",
	})
	if err != nil {
		t.Fatalf("InterruptGovernedTurn() error = %v", err)
	}
	if !result.Interrupted || !result.HadActiveTurn {
		t.Fatalf("expected interrupt result with active turn, got %#v", result)
	}
	if result.Run == nil {
		t.Fatal("expected interrupt governance to persist a hook run")
	}
	if result.Run.EventName != eventNameTurnInterrupt || result.Run.HandlerKey != handlerKeyTurnInterruptAudit {
		t.Fatalf("unexpected interrupt hook run identity %#v", result.Run)
	}
	if result.Run.TriggerMethod != "turn/interrupt" || result.Run.ToolName != "turn/interrupt" {
		t.Fatalf("unexpected interrupt hook run metadata %#v", result.Run)
	}
	if result.Run.Reason != reasonTurnInterruptAudited || result.Run.Status != hookStatusCompleted {
		t.Fatalf("unexpected interrupt hook completion %#v", result.Run)
	}
	if result.Run.ItemID != "req-interrupt-1" || result.Run.TurnID != "turn-interrupted" {
		t.Fatalf("expected interrupt audit to preserve request and turn ids, got %#v", result.Run)
	}
	if len(dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")) != 0 {
		t.Fatalf("expected interrupt audit to avoid turn-policy persistence, got %#v", dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1"))
	}
}

func TestInterruptGovernedTurnRecordsNoActiveTurnOutcome(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		interruptResult: turns.Result{
			TurnID: "",
			Status: "interrupted",
		},
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	result, err := service.InterruptGovernedTurn(context.Background(), GovernedTurnInterruptInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/interrupt",
		Scope:         "thread",
		RequestID:     "req-interrupt-idle",
	})
	if err != nil {
		t.Fatalf("InterruptGovernedTurn() error = %v", err)
	}
	if !result.Interrupted || result.HadActiveTurn {
		t.Fatalf("expected interrupt result without active turn, got %#v", result)
	}
	if result.Reason != reasonInterruptNoActiveTurn {
		t.Fatalf("expected no-active-turn reason, got %#v", result)
	}
	if result.Run == nil || result.Run.Reason != reasonInterruptNoActiveTurn {
		t.Fatalf("expected persisted no-active-turn audit, got %#v", result.Run)
	}
	if !strings.Contains(result.Run.AdditionalContext, "activeTurn=false") {
		t.Fatalf("expected interrupt audit context to capture idle outcome, got %#v", result.Run)
	}
}

func TestStartGovernedReviewRecordsDedicatedHookRun(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		reviewResult: turns.Result{
			TurnID: "review-turn-1",
			Status: "reviewing",
		},
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	result, err := service.StartGovernedReview(context.Background(), GovernedReviewStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "review/start",
		Scope:         "thread",
		RequestID:     "req-review-1",
	})
	if err != nil {
		t.Fatalf("StartGovernedReview() error = %v", err)
	}
	if !result.Started {
		t.Fatalf("expected review to start, got %#v", result)
	}
	if result.Run == nil {
		t.Fatal("expected review governance to persist a hook run")
	}
	if result.Run.EventName != eventNameReviewStart || result.Run.HandlerKey != handlerKeyReviewStartAudit {
		t.Fatalf("unexpected review hook run identity %#v", result.Run)
	}
	if result.Run.Reason != reasonReviewStartAudited || result.Run.Status != hookStatusCompleted {
		t.Fatalf("unexpected review hook completion %#v", result.Run)
	}
	if result.Run.TurnID != "review-turn-1" || result.Run.ItemID != "req-review-1" {
		t.Fatalf("expected review audit to persist request and turn ids, got %#v", result.Run)
	}
	if !strings.Contains(result.Run.AdditionalContext, "target="+reviewStartTarget) {
		t.Fatalf("expected review audit context to capture target metadata, got %#v", result.Run)
	}
}

func TestStartGovernedReviewPersistsFailedAudit(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		reviewErr: errors.New("review runtime unavailable"),
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	result, err := service.StartGovernedReview(context.Background(), GovernedReviewStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "review/start",
		Scope:         "thread",
		RequestID:     "req-review-failed",
	})
	if err == nil {
		t.Fatal("expected StartGovernedReview() to return the underlying review error")
	}
	if result.Run == nil {
		t.Fatal("expected failed review to still persist a hook run")
	}
	if result.Run.Status != hookStatusFailed || result.Run.Reason != reasonReviewStartFailed {
		t.Fatalf("expected failed review audit, got %#v", result.Run)
	}
	if result.Run.Error != "review runtime unavailable" {
		t.Fatalf("expected review failure reason to be captured, got %#v", result.Run)
	}
}

func TestServiceUsesGovernedFollowUpForConfiguredFollowUpAction(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	writeDefaultSessionStartDocument(
		t,
		rootDir,
		"# Hook Context\n\n- governed follow-up should inherit session start context",
	)

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction: actionFollowUp,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-1",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/hooks/service.go",
							},
						},
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 10, 2, 0, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.startCount() == 1
	})

	if fakeTurns.startCalls[0].input == "" || !strings.Contains(fakeTurns.startCalls[0].input, "来源文件：.codex/SESSION_START.md") {
		t.Fatalf("expected governed follow-up input to include injected session-start context, got %q", fakeTurns.startCalls[0].input)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	sessionRun, ok := findHookRun(runs, eventNameSessionStart, handlerKeySessionStartProjectContext)
	if !ok {
		t.Fatalf("expected session-start hook run for governed follow-up, got %#v", runs)
	}
	if sessionRun.TriggerMethod != hookFollowUpTriggerMethod || sessionRun.Scope != "thread" {
		t.Fatalf("expected governed follow-up hook metadata, got %#v", sessionRun)
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Action != actionFollowUp || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected successful configured follow-up action, got %#v", decisions[0])
	}
	expectHookFollowUpMetadata(
		t,
		fakeTurns.startCalls[0],
		workspace.ID,
		"thread-1",
		"turn/completed",
		policyNameMissingVerification,
		decisions[0].HookRunID,
	)
}

func TestServiceUsesGovernedFollowUpWhenSteerFallsBackWithoutActiveTurn(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	writeDefaultSessionStartDocument(
		t,
		rootDir,
		"# Hook Context\n\n- steer fallback follow-up should inherit session start context",
	)

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	fakeTurns := &fakeTurnExecutor{
		steerErr: appRuntime.ErrNoActiveTurn,
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":               "cmd-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "failed",
				"exitCode":         1,
				"aggregatedOutput": "--- FAIL: TestExample\n",
			},
		},
		TS: time.Date(2026, time.April, 10, 1, 0, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.steerCount() == 1 && fakeTurns.startCount() == 1
	})

	if fakeTurns.startCalls[0].input == "" || !strings.Contains(fakeTurns.startCalls[0].input, "来源文件：.codex/SESSION_START.md") {
		t.Fatalf("expected steer fallback follow-up input to include injected session-start context, got %q", fakeTurns.startCalls[0].input)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	sessionRun, ok := findHookRun(runs, eventNameSessionStart, handlerKeySessionStartProjectContext)
	if !ok {
		t.Fatalf("expected session-start hook run after steer fallback, got %#v", runs)
	}
	if sessionRun.TriggerMethod != hookFollowUpTriggerMethod || sessionRun.Scope != "thread" {
		t.Fatalf("expected steer fallback follow-up to use hook follow-up metadata, got %#v", sessionRun)
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	if decisions[0].Action != actionFollowUp || decisions[0].ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected steer fallback to succeed as follow-up, got %#v", decisions[0])
	}
	expectHookFollowUpMetadata(
		t,
		fakeTurns.startCalls[0],
		workspace.ID,
		"thread-1",
		"item/completed",
		policyNameFailedValidation,
		decisions[0].HookRunID,
	)
}

func TestServiceFallsBackToFollowUpWhenStopInterruptHasNoActiveTurn(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	writeDefaultSessionStartDocument(
		t,
		rootDir,
		"# Hook Context\n\n- interrupt fallback follow-up should inherit session start context",
	)

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction:                 actionInterrupt,
		TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: actionFollowUp,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	fakeTurns := &fakeTurnExecutor{
		interruptResult: turns.Result{
			TurnID: "",
			Status: "interrupted",
		},
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []any{
					map[string]any{
						"id":     "patch-1",
						"type":   "fileChange",
						"status": "completed",
						"changes": []any{
							map[string]any{
								"kind": "update",
								"path": "backend/internal/hooks/service.go",
							},
						},
					},
				},
			},
		},
		TS: time.Date(2026, time.April, 10, 2, 0, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		return fakeTurns.interruptCount() == 1 && fakeTurns.startCount() == 1
	})

	if fakeTurns.startCalls[0].input == "" || !strings.Contains(fakeTurns.startCalls[0].input, "来源文件：.codex/SESSION_START.md") {
		t.Fatalf("expected interrupt fallback follow-up input to include injected session-start context, got %q", fakeTurns.startCalls[0].input)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	sessionRun, ok := findHookRun(runs, eventNameSessionStart, handlerKeySessionStartProjectContext)
	if !ok {
		t.Fatalf("expected session-start hook run after interrupt fallback, got %#v", runs)
	}
	if sessionRun.TriggerMethod != hookFollowUpTriggerMethod || sessionRun.Scope != "thread" {
		t.Fatalf("expected interrupt fallback follow-up to use hook follow-up metadata, got %#v", sessionRun)
	}

	decisions := dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")
	if len(decisions) != 1 {
		t.Fatalf("expected 1 decision, got %#v", decisions)
	}
	decision := decisions[0]
	if decision.PolicyName != policyNameMissingVerification {
		t.Fatalf("expected stop missing verification policy, got %#v", decision)
	}
	if decision.Verdict != actionInterrupt || decision.Action != actionFollowUp || decision.ActionStatus != actionStatusSucceeded {
		t.Fatalf("expected interrupt verdict with follow-up fallback, got %#v", decision)
	}
	if decision.Reason != reasonInterruptNoActiveTurn {
		t.Fatalf("expected no-active-turn reason to be preserved, got %#v", decision)
	}
	expectHookFollowUpMetadata(
		t,
		fakeTurns.startCalls[0],
		workspace.ID,
		"thread-1",
		"turn/completed",
		policyNameMissingVerification,
		decision.HookRunID,
	)
}

func TestStartGovernedTurnBlocksWhenUserPromptSubmitBlocks(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	secret := "sk-proj-abcDEF1234567890xyzUVW9876543210"
	result, err := service.StartGovernedTurn(context.Background(), GovernedTurnStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "hook/test-follow-up",
		Scope:         "thread",
		Input:         "请直接使用这个 key：" + secret,
	})
	if err != nil {
		t.Fatalf("StartGovernedTurn() error = %v", err)
	}
	if !result.Blocked || result.Started {
		t.Fatalf("expected governed turn start to be blocked, got %#v", result)
	}
	if !result.UserPromptSubmit.Blocked || result.SessionStart.Applied {
		t.Fatalf("expected block before session-start evaluation, got %#v", result)
	}
	if fakeTurns.startCount() != 0 {
		t.Fatalf("expected blocked governed turn start to skip turns.Start, got %d", fakeTurns.startCount())
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].EventName != eventNameUserPromptSubmit || runs[0].TriggerMethod != "hook/test-follow-up" || runs[0].Scope != "thread" {
		t.Fatalf("expected custom governed turn metadata to flow into user prompt hook, got %#v", runs[0])
	}
}

func TestStartGovernedTurnAppliesSessionStartBeforeStartingTurn(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	writeDefaultSessionStartDocument(
		t,
		rootDir,
		"# Repo Rules\n\n- governed turn start should inject this context",
	)

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}

	service := NewService(dataStore, fakeTurns, eventHub)
	result, err := service.StartGovernedTurn(context.Background(), GovernedTurnStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "hook/test-follow-up",
		Scope:         "thread",
		Input:         "请统一 hooks 的 governed start",
	})
	if err != nil {
		t.Fatalf("StartGovernedTurn() error = %v", err)
	}
	if !result.Started || result.Blocked {
		t.Fatalf("expected governed turn start to succeed, got %#v", result)
	}
	if !result.SessionStart.Applied || !result.UserPromptSubmit.Allowed {
		t.Fatalf("expected governed turn start to allow prompt and apply session-start injection, got %#v", result)
	}
	if fakeTurns.startCount() != 1 {
		t.Fatalf("expected exactly one turns.Start call, got %d", fakeTurns.startCount())
	}
	if fakeTurns.startCalls[0].input != result.FinalInput {
		t.Fatalf("expected turns.Start input to match governed final input, got call=%q result=%q", fakeTurns.startCalls[0].input, result.FinalInput)
	}
	if !strings.Contains(fakeTurns.startCalls[0].input, "来源文件：.codex/SESSION_START.md") {
		t.Fatalf("expected governed final input to include injected session-start context, got %q", fakeTurns.startCalls[0].input)
	}
	if result.Run == nil {
		t.Fatal("expected governed turn start to persist a dedicated hook run")
	}
	if result.Run.EventName != eventNameTurnStart || result.Run.HandlerKey != handlerKeyTurnStartAudit {
		t.Fatalf("expected dedicated turn-start hook run, got %#v", result.Run)
	}
	if result.Run.Reason != reasonTurnStartAudited || result.Run.Status != hookStatusCompleted {
		t.Fatalf("unexpected turn-start hook completion %#v", result.Run)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 2 {
		t.Fatalf("expected 2 hook runs, got %#v", runs)
	}
	sessionRun, ok := findHookRun(runs, eventNameSessionStart, handlerKeySessionStartProjectContext)
	if !ok {
		t.Fatalf("expected custom governed turn metadata to flow into session-start hook, got %#v", runs)
	}
	if sessionRun.TriggerMethod != "hook/test-follow-up" || sessionRun.Scope != "thread" {
		t.Fatalf("expected session-start hook metadata to preserve governed trigger, got %#v", sessionRun)
	}
	if sessionRun.SessionStartSource != sessionStartSourceStartup {
		t.Fatalf("expected session-start hook to default to startup source, got %#v", sessionRun)
	}
	startRun, ok := findHookRun(runs, eventNameTurnStart, handlerKeyTurnStartAudit)
	if !ok {
		t.Fatalf("expected dedicated turn-start hook run, got %#v", runs)
	}
	if startRun.TriggerMethod != "hook/test-follow-up" || startRun.Scope != "thread" {
		t.Fatalf("expected turn-start hook metadata to preserve governed trigger, got %#v", startRun)
	}
	if !strings.Contains(startRun.AdditionalContext, "sessionStartApplied=true") {
		t.Fatalf("expected turn-start hook to record session-start application, got %#v", startRun)
	}
	if !strings.Contains(startRun.AdditionalContext, "sessionStartSource=startup") {
		t.Fatalf("expected turn-start hook to record startup session source, got %#v", startRun)
	}
}

func TestStartGovernedTurnPersistsFailedAudit(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		startErr: errors.New("turn runtime unavailable"),
	}

	service := NewService(dataStore, fakeTurns, eventHub)
	result, err := service.StartGovernedTurn(context.Background(), GovernedTurnStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		RequestID:     "req-start-failed",
		Input:         "请继续推进",
	})
	if err == nil {
		t.Fatal("expected StartGovernedTurn() to return the underlying start error")
	}
	if result.Run == nil {
		t.Fatal("expected failed governed turn start to persist a dedicated hook run")
	}
	if result.Run.Status != hookStatusFailed || result.Run.Reason != reasonTurnStartFailed {
		t.Fatalf("unexpected failed turn-start hook run %#v", result.Run)
	}
	if result.Run.Error != "turn runtime unavailable" {
		t.Fatalf("expected turn-start failure to be captured, got %#v", result.Run)
	}
	if result.SessionStart.Run == nil || result.SessionStart.SessionStartSource != sessionStartSourceStartup {
		t.Fatalf("expected failed governed turn start to audit the startup session start, got %#v", result.SessionStart)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 2 {
		t.Fatalf("expected 2 hook runs, got %#v", runs)
	}
	sessionRun, ok := findHookRun(runs, eventNameSessionStart, handlerKeySessionStartProjectContext)
	if !ok {
		t.Fatalf("expected failed turn-start path to persist a session-start hook run, got %#v", runs)
	}
	if sessionRun.SessionStartSource != sessionStartSourceStartup || sessionRun.Reason != reasonSessionStartAudited {
		t.Fatalf("unexpected session-start audit run %#v", sessionRun)
	}
	startRun, ok := findHookRun(runs, eventNameTurnStart, handlerKeyTurnStartAudit)
	if !ok {
		t.Fatalf("expected failed turn-start hook run, got %#v", runs)
	}
	if startRun.ItemID != "req-start-failed" {
		t.Fatalf("expected failed turn-start hook run to persist request id, got %#v", startRun)
	}
	if !strings.Contains(startRun.AdditionalContext, "sessionStartSource=startup") {
		t.Fatalf("expected failed turn-start hook run to record startup session source, got %#v", startRun)
	}
}

func TestEvaluatePreToolUseBlocksDangerousThreadShellCommand(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		ToolKind:      "shellCommand",
		ToolName:      "thread/shellCommand",
		TriggerMethod: "thread/shellCommand",
		Scope:         "thread",
		Command:       "Remove-Item -Recurse -Force .\\*",
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Blocked || result.Allowed {
		t.Fatalf("expected pre-tool evaluation to block dangerous command, got %#v", result)
	}
	if result.Run == nil || result.Run.EventName != eventNamePreToolUse || result.Run.Decision != decisionBlock {
		t.Fatalf("expected persisted pre-tool hook run, got %#v", result.Run)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].Status != hookStatusCompleted || runs[0].HandlerKey != handlerKeyDangerousCommand {
		t.Fatalf("expected completed dangerous-command hook run, got %#v", runs[0])
	}
}

func TestEvaluatePreToolUseAllowsScopedDeleteCommands(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		ToolKind:      "commandExecution",
		ToolName:      "command/exec",
		TriggerMethod: "command/exec",
		Scope:         "workspace",
		Command:       "rm -rf build",
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Allowed || result.Blocked {
		t.Fatalf("expected scoped delete command to pass, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run to be recorded for allowed command, got %#v", runs)
	}
}

func TestEvaluatePreToolUseBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		ToolKind:      "fileWrite",
		ToolName:      "fs/writeFile",
		TriggerMethod: "fs/write",
		Scope:         "workspace",
		TargetPath:    filepath.Join(rootDir, ".codex", "hooks.json"),
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Blocked || result.Allowed {
		t.Fatalf("expected governance file mutation to be blocked, got %#v", result)
	}
	if result.Run == nil || result.Run.HandlerKey != handlerKeyProtectedPathWrite {
		t.Fatalf("expected protected-path hook run, got %#v", result.Run)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].Reason != "protected_governance_file_mutation_blocked" {
		t.Fatalf("expected protected mutation reason, got %#v", runs[0])
	}
	if len(runs[0].Entries) == 0 || !strings.Contains(runs[0].Entries[0].Text, ".codex") {
		t.Fatalf("expected hook entries to include matched path context, got %#v", runs[0].Entries)
	}
}

func TestEvaluatePreToolUseBlocksProtectedSessionGovernanceDocumentMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		ToolKind:      "fileWrite",
		ToolName:      "fs/writeFile",
		TriggerMethod: "fs/write",
		Scope:         "workspace",
		TargetPath:    "AGENTS.md",
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Blocked || result.Allowed {
		t.Fatalf("expected session governance document mutation to be blocked, got %#v", result)
	}
	if result.Run == nil || result.Run.HandlerKey != handlerKeyProtectedPathWrite {
		t.Fatalf("expected protected-path hook run, got %#v", result.Run)
	}
	if !strings.Contains(result.Reason, "session governance documents") {
		t.Fatalf("expected session governance guidance, got %#v", result.Reason)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if len(runs[0].Entries) == 0 || !strings.Contains(runs[0].Entries[0].Text, "AGENTS.md") {
		t.Fatalf("expected hook entries to include AGENTS.md context, got %#v", runs[0].Entries)
	}
}

func TestEvaluatePreToolUseAllowsRegularFileWrites(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		ToolKind:      "fileWrite",
		ToolName:      "fs/writeFile",
		TriggerMethod: "fs/write",
		Scope:         "workspace",
		TargetPath:    "README.md",
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Allowed || result.Blocked {
		t.Fatalf("expected regular file write to pass, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run to be recorded for allowed file write, got %#v", runs)
	}
}

func TestEvaluatePreToolUseAllowsCopyFromProtectedGovernanceFileToSafeDestination(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:     workspace.ID,
		ThreadID:        "thread-1",
		ToolKind:        "pathCopy",
		ToolName:        "fs/copy",
		TriggerMethod:   "fs/copy",
		Scope:           "workspace",
		TargetPath:      ".codex/hooks.json",
		DestinationPath: "backups/hooks-copy.json",
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Allowed || result.Blocked {
		t.Fatalf("expected copy-out from protected governance file to pass, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run to be recorded for safe copy-out, got %#v", runs)
	}
}

func TestEvaluatePreToolUseBlocksConfigWriteToProtectedGovernanceFile(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		ToolKind:      "configWrite",
		ToolName:      "config/value/write",
		TriggerMethod: "config/write",
		Scope:         "workspace",
		TargetPath:    "hooks.json",
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Blocked || result.Allowed {
		t.Fatalf("expected protected governance config write to be blocked, got %#v", result)
	}
	if result.Run == nil || result.Run.HandlerKey != handlerKeyProtectedPathWrite {
		t.Fatalf("expected protected-path hook run, got %#v", result.Run)
	}
}

func TestEvaluatePreToolUseBlocksAdditionalConfiguredGovernancePath(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	configPath := filepath.Join(rootDir, ".codex", "hooks.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		configPath,
		[]byte(`{
  "preToolUse": {
    "additionalProtectedGovernancePaths": ["docs/governance.md"]
  }
}`),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		ToolKind:      "fileWrite",
		ToolName:      "fs/writeFile",
		TriggerMethod: "fs/write",
		Scope:         "workspace",
		TargetPath:    "docs/governance.md",
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Blocked || result.Allowed {
		t.Fatalf("expected configured governance path mutation to be blocked, got %#v", result)
	}
	if !strings.Contains(result.Reason, "configured governance files") {
		t.Fatalf("expected configured-governance guidance, got %#v", result.Reason)
	}
}

func TestInterceptServerRequestBlocksDynamicToolCallProtectedGovernanceMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.InterceptServerRequest(context.Background(), appRuntime.ServerRequestInput{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/tool/call",
		Params: map[string]any{
			"tool": "fs/writeFile",
			"arguments": map[string]any{
				"path": ".codex/hooks.json",
			},
		},
	})
	if err != nil {
		t.Fatalf("InterceptServerRequest() error = %v", err)
	}
	if !result.Handled {
		t.Fatalf("expected dynamic tool call interception to block the request, got %#v", result)
	}

	response, ok := result.Response.(map[string]any)
	if !ok {
		t.Fatalf("expected block response payload, got %#v", result.Response)
	}
	if success, _ := response["success"].(bool); success {
		t.Fatalf("expected blocked dynamic tool call response to mark success=false, got %#v", response)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].ToolName != "fs/writeFile" || runs[0].TriggerMethod != "item/tool/call" {
		t.Fatalf("expected dynamic tool call hook metadata, got %#v", runs[0])
	}
	if runs[0].HandlerKey != handlerKeyProtectedPathWrite {
		t.Fatalf("expected protected-path handler for dynamic tool call, got %#v", runs[0])
	}
}

func TestInterceptServerRequestAllowsSafeDynamicToolCall(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.InterceptServerRequest(context.Background(), appRuntime.ServerRequestInput{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/tool/call",
		Params: map[string]any{
			"tool": "search_query",
			"arguments": map[string]any{
				"q": "codex server",
			},
		},
	})
	if err != nil {
		t.Fatalf("InterceptServerRequest() error = %v", err)
	}
	if result.Handled {
		t.Fatalf("expected safe dynamic tool call to bypass pre-tool interception, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run for safe dynamic tool call, got %#v", runs)
	}
}

func TestInterceptServerRequestBlocksMcpStyleDynamicToolCallProtectedGovernanceMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.InterceptServerRequest(context.Background(), appRuntime.ServerRequestInput{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/tool/call",
		Params: map[string]any{
			"tool": "filesystem/write_file",
			"arguments": map[string]any{
				"path": ".codex/hooks.json",
			},
		},
	})
	if err != nil {
		t.Fatalf("InterceptServerRequest() error = %v", err)
	}
	if !result.Handled {
		t.Fatalf("expected MCP-style dynamic tool call interception to block the request, got %#v", result)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].ToolKind != "mcpToolCall" || runs[0].ToolName != "fs/writeFile" {
		t.Fatalf("expected MCP-style dynamic tool call to reuse canonical pre-tool mapping, got %#v", runs[0])
	}
	if runs[0].HandlerKey != handlerKeyProtectedPathWrite {
		t.Fatalf("expected protected-path handler for MCP-style dynamic tool call, got %#v", runs[0])
	}
}

func TestInterceptServerRequestBlocksMcpStyleDynamicToolCallAdditionalWorkspaceBaselinePath(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	configPath := filepath.Join(rootDir, ".codex", "hooks.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		configPath,
		[]byte(`{
  "preToolUse": {
    "additionalProtectedGovernancePaths": ["docs/governance.md"]
  }
}`),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.InterceptServerRequest(context.Background(), appRuntime.ServerRequestInput{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/tool/call",
		Params: map[string]any{
			"tool": "filesystem/write_file",
			"arguments": map[string]any{
				"path": "docs/governance.md",
			},
		},
	})
	if err != nil {
		t.Fatalf("InterceptServerRequest() error = %v", err)
	}
	if !result.Handled {
		t.Fatalf("expected MCP-style dynamic tool call to honor workspace baseline protected path, got %#v", result)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if len(runs[0].Entries) < 2 || runs[0].Entries[0].Text != "targetPath=docs/governance.md" {
		t.Fatalf("expected workspace baseline protected path to be persisted in hook entries, got %#v", runs[0])
	}
}

func TestInterceptServerRequestAllowsSafeMcpStyleCopyFromProtectedSource(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.InterceptServerRequest(context.Background(), appRuntime.ServerRequestInput{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/tool/call",
		Params: map[string]any{
			"tool": "mcp__filesystem__copy_file",
			"arguments": map[string]any{
				"source_path":      ".codex/hooks.json",
				"destination_path": "docs/copied-hooks.json",
			},
		},
	})
	if err != nil {
		t.Fatalf("InterceptServerRequest() error = %v", err)
	}
	if result.Handled {
		t.Fatalf("expected safe MCP-style copy to bypass pre-tool interception, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run for safe MCP-style copy, got %#v", runs)
	}
}

func TestInterceptServerRequestBlocksMcpStyleMoveFromProtectedSource(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.InterceptServerRequest(context.Background(), appRuntime.ServerRequestInput{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/tool/call",
		Params: map[string]any{
			"tool": "mcp__filesystem__move_file",
			"arguments": map[string]any{
				"source_path":      ".codex/hooks.json",
				"destination_path": "docs/hooks-moved.json",
			},
		},
	})
	if err != nil {
		t.Fatalf("InterceptServerRequest() error = %v", err)
	}
	if !result.Handled {
		t.Fatalf("expected MCP-style move from protected source to be intercepted, got %#v", result)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].ToolKind != "mcpToolCall" || runs[0].ToolName != "fs/move" {
		t.Fatalf("expected MCP-style move tool to map into canonical move guard, got %#v", runs[0])
	}
	if runs[0].HandlerKey != handlerKeyProtectedPathWrite {
		t.Fatalf("expected protected-path handler for MCP-style move, got %#v", runs[0])
	}
	if len(runs[0].Entries) < 2 || runs[0].Entries[0].Text != "sourcePath=.codex/hooks.json" {
		t.Fatalf("expected MCP-style move guard to record the matched source path, got %#v", runs[0])
	}
}

func TestInterceptServerRequestBlocksMcpStyleDynamicToolCallDangerousCommand(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.InterceptServerRequest(context.Background(), appRuntime.ServerRequestInput{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/tool/call",
		Params: map[string]any{
			"tool": "mcp/filesystem/exec_command",
			"arguments": map[string]any{
				"command": "Remove-Item -Recurse -Force .\\*",
			},
		},
	})
	if err != nil {
		t.Fatalf("InterceptServerRequest() error = %v", err)
	}
	if !result.Handled {
		t.Fatalf("expected dangerous MCP-style command to be intercepted, got %#v", result)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].ToolKind != "mcpToolCall" || runs[0].ToolName != "command/exec" {
		t.Fatalf("expected MCP-style command tool to map into canonical command execution guard, got %#v", runs[0])
	}
	if runs[0].HandlerKey != handlerKeyDangerousCommand {
		t.Fatalf("expected dangerous-command handler for MCP-style dynamic tool call, got %#v", runs[0])
	}
}

func TestInterceptServerRequestAllowsMcpStyleDangerousCommandWhenWorkspaceBaselineDisablesBlock(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	configPath := filepath.Join(rootDir, ".codex", "hooks.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		configPath,
		[]byte(`{
  "preToolUse": {
    "blockDangerousCommandEnabled": false
  }
}`),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.InterceptServerRequest(context.Background(), appRuntime.ServerRequestInput{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/tool/call",
		Params: map[string]any{
			"tool": "mcp/filesystem/exec_command",
			"arguments": map[string]any{
				"command": "Remove-Item -Recurse -Force .\\*",
			},
		},
	})
	if err != nil {
		t.Fatalf("InterceptServerRequest() error = %v", err)
	}
	if result.Handled {
		t.Fatalf("expected workspace baseline to disable dangerous-command blocking for MCP-style dynamic tool call, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run when workspace baseline disables MCP-style dangerous-command blocking, got %#v", runs)
	}
}

func TestEvaluateUserPromptSubmitBlocksSecretLikePromptWithoutPersistingRawSecret(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	secret := "sk-proj-abcDEF1234567890xyzUVW9876543210"
	result, err := service.EvaluateUserPromptSubmit(context.Background(), UserPromptSubmitInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "请直接使用这个 key：" + secret,
	})
	if err != nil {
		t.Fatalf("EvaluateUserPromptSubmit() error = %v", err)
	}
	if !result.Blocked || result.Allowed {
		t.Fatalf("expected user prompt evaluation to block pasted secret, got %#v", result)
	}
	if result.Run == nil || result.Run.EventName != eventNameUserPromptSubmit || result.Run.Decision != decisionBlock {
		t.Fatalf("expected persisted user-prompt hook run, got %#v", result.Run)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	run := runs[0]
	if run.Status != hookStatusCompleted || run.HandlerKey != handlerKeySecretPrompt {
		t.Fatalf("expected completed secret-prompt hook run, got %#v", run)
	}
	for _, entry := range run.Entries {
		if strings.Contains(entry.Text, secret) {
			t.Fatalf("expected hook entries to avoid storing raw secret, got %#v", run.Entries)
		}
	}
}

func TestEvaluateUserPromptSubmitAllowsPlaceholderExamples(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.EvaluateUserPromptSubmit(context.Background(), UserPromptSubmitInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         `请帮我解释这个示例配置：Authorization: Bearer your-token-here-please-replace`,
	})
	if err != nil {
		t.Fatalf("EvaluateUserPromptSubmit() error = %v", err)
	}
	if !result.Allowed || result.Blocked {
		t.Fatalf("expected placeholder example to pass, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run to be recorded for placeholder example, got %#v", runs)
	}
}

func TestEvaluateUserPromptSubmitSkipsWhenSecretBlockDisabled(t *testing.T) {
	t.Parallel()

	disabled := false
	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		HookUserPromptSubmitBlockSecretPasteEnabled: &disabled,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.EvaluateUserPromptSubmit(context.Background(), UserPromptSubmitInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "Authorization: Bearer sk-proj-abcDEF1234567890xyzUVW9876543210",
	})
	if err != nil {
		t.Fatalf("EvaluateUserPromptSubmit() error = %v", err)
	}
	if !result.Allowed || result.Blocked {
		t.Fatalf("expected secret-like input to pass when hook is disabled, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run to be recorded when secret block is disabled, got %#v", runs)
	}
}

func TestEvaluatePreToolUseSkipsWhenDangerousCommandBlockDisabled(t *testing.T) {
	t.Parallel()

	disabled := false
	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		HookPreToolUseBlockDangerousCommandEnabled: &disabled,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	service := NewService(dataStore, nil, events.NewHub())

	result, err := service.EvaluatePreToolUse(context.Background(), PreToolUseInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		ToolKind:      "shellCommand",
		ToolName:      "thread/shellCommand",
		TriggerMethod: "thread/shellCommand",
		Scope:         "thread",
		Command:       "Remove-Item -Recurse -Force .\\*",
	})
	if err != nil {
		t.Fatalf("EvaluatePreToolUse() error = %v", err)
	}
	if !result.Allowed || result.Blocked {
		t.Fatalf("expected dangerous command to pass when pre-tool block is disabled, got %#v", result)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run to be recorded when pre-tool block is disabled, got %#v", runs)
	}
}

func TestEvaluateSessionStartInjectsProjectContextForFirstTurn(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	writeDefaultSessionStartDocument(
		t,
		rootDir,
		"# Repo Rules\n\n- run tests before finalizing\n- keep hooks visible in the thread",
	)

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	service := NewService(dataStore, nil, eventHub)
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "请修复 hooks 的入口治理",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected session-start context injection, got %#v", result)
	}
	if !strings.Contains(result.UpdatedInput, "来源文件：.codex/SESSION_START.md") || !strings.Contains(result.UpdatedInput, "请修复 hooks 的入口治理") {
		t.Fatalf("expected updated input to include context and original request, got %q", result.UpdatedInput)
	}
	if !strings.Contains(result.AdditionalContext, "run tests before finalizing") {
		t.Fatalf("expected additional context excerpt, got %q", result.AdditionalContext)
	}
	if result.Run == nil || result.Run.EventName != eventNameSessionStart || result.Run.HandlerKey != handlerKeySessionStartProjectContext {
		t.Fatalf("expected persisted session-start hook run, got %#v", result.Run)
	}
	if result.SessionStartSource != sessionStartSourceStartup || result.Run.SessionStartSource != sessionStartSourceStartup {
		t.Fatalf("expected default startup session-start source, got result=%#v run=%#v", result, result.Run)
	}
	if result.Run.UpdatedInput == nil {
		t.Fatalf("expected session-start hook run to persist updated input, got %#v", result.Run)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	run := runs[0]
	if run.Decision != decisionContinue || run.Reason != "project_context_injected" {
		t.Fatalf("expected session-start continue decision, got %#v", run)
	}
	if !strings.Contains(run.AdditionalContext, "keep hooks visible in the thread") {
		t.Fatalf("expected persisted additional context, got %#v", run)
	}
}

func TestEvaluateSessionStartUsesConfiguredTemplate(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	writeDefaultSessionStartDocument(
		t,
		rootDir,
		"# Repo Rules\n\n- keep template configurable",
	)

	template := "项目摘要:\n{{context}}\n{{source_path_line}}请求如下:\n{{user_request}}"
	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		HookSessionStartTemplate: &template,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})

	service := NewService(dataStore, nil, events.NewHub())
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "请允许前端配置模板",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected configured template injection, got %#v", result)
	}
	if strings.Contains(result.UpdatedInput, "项目上下文摘录：") {
		t.Fatalf("expected default template labels to be replaced, got %q", result.UpdatedInput)
	}
	if !strings.Contains(result.UpdatedInput, "项目摘要:\n# Repo Rules") {
		t.Fatalf("expected configured template to include context, got %q", result.UpdatedInput)
	}
	if !strings.Contains(result.UpdatedInput, "来源文件：.codex/SESSION_START.md") {
		t.Fatalf("expected source path line placeholder to expand, got %q", result.UpdatedInput)
	}
	if !strings.Contains(result.UpdatedInput, "请求如下:\n请允许前端配置模板") {
		t.Fatalf("expected configured template to include request, got %q", result.UpdatedInput)
	}
}

func TestEvaluateSessionStartFallsBackToUserCodexHomeWhenWorkspaceDocumentIsMissing(t *testing.T) {
	rootDir := t.TempDir()
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	writeUserCodexSessionStartDocument(
		t,
		codexHome,
		"SESSION_START.md",
		"# User Rules\n\n- use codex home fallback when workspace document is missing",
	)

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})

	service := NewService(dataStore, nil, events.NewHub())
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "请验证用户级 .codex 回退",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected CODEX_HOME fallback to inject session-start context, got %#v", result)
	}
	if !strings.Contains(result.UpdatedInput, "来源文件：.codex/SESSION_START.md") {
		t.Fatalf("expected CODEX_HOME fallback to preserve .codex display path, got %q", result.UpdatedInput)
	}
	if !strings.Contains(result.AdditionalContext, "use codex home fallback") {
		t.Fatalf("expected CODEX_HOME fallback context, got %q", result.AdditionalContext)
	}
}

func TestEvaluateSessionStartPrefersWorkspaceCodexDocumentOverUserCodexHome(t *testing.T) {
	rootDir := t.TempDir()
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	writeDefaultSessionStartDocument(
		t,
		rootDir,
		"# Workspace Rules\n\n- prefer workspace codex document first",
	)
	writeUserCodexSessionStartDocument(
		t,
		codexHome,
		"SESSION_START.md",
		"# User Rules\n\n- do not override workspace codex document",
	)

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})

	service := NewService(dataStore, nil, events.NewHub())
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "请验证 workspace .codex 优先级",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected workspace .codex document to inject session-start context, got %#v", result)
	}
	if !strings.Contains(result.AdditionalContext, "prefer workspace codex document first") {
		t.Fatalf("expected workspace .codex document to win, got %q", result.AdditionalContext)
	}
	if strings.Contains(result.AdditionalContext, "do not override workspace codex document") {
		t.Fatalf("expected workspace .codex document to take precedence over CODEX_HOME, got %q", result.AdditionalContext)
	}
}

func TestEvaluateSessionStartAuditsClearSourceWithoutProjectContext(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:                 "thread-1",
		WorkspaceID:        workspace.ID,
		Cwd:                rootDir,
		Materialized:       true,
		Name:               "Thread 1",
		Status:             "idle",
		SessionStartSource: sessionStartSourceClear,
	})
	dataStore.SetThreadSessionStartSource(workspace.ID, "thread-1", sessionStartSourceClear, true)

	service := NewService(dataStore, nil, events.NewHub())
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "请继续推进 hooks 审计语义",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if result.Applied {
		t.Fatalf("expected session-start audit without project context injection, got %#v", result)
	}
	if result.UpdatedInput != "请继续推进 hooks 审计语义" {
		t.Fatalf("expected input to remain unchanged, got %q", result.UpdatedInput)
	}
	if result.SessionStartSource != sessionStartSourceClear {
		t.Fatalf("expected clear session start source, got %#v", result)
	}
	if result.Run == nil || result.Run.Reason != reasonSessionStartAudited {
		t.Fatalf("expected audited session-start run without context injection, got %#v", result.Run)
	}
	if result.Run.SessionStartSource != sessionStartSourceClear {
		t.Fatalf("expected persisted clear session start source, got %#v", result.Run)
	}
	if result.Run.UpdatedInput != nil {
		t.Fatalf("expected no updated input when context is unavailable, got %#v", result.Run)
	}
	if got := dataStore.PendingThreadSessionStartSource(workspace.ID, "thread-1"); got != "" {
		t.Fatalf("expected clear session-start source to be consumed, got %q", got)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].Reason != reasonSessionStartAudited || runs[0].SessionStartSource != sessionStartSourceClear {
		t.Fatalf("unexpected audited session-start run %#v", runs[0])
	}
}

func TestEvaluateSessionStartUsesConfiguredContextPathsAndMaxChars(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(rootDir, "docs"), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(rootDir, "docs", "session-start.md"),
		[]byte("line 1\n\nline 2 with more context\nline 3 that should be truncated away"),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	maxChars := 32
	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		HookSessionStartContextPaths: []string{" docs\\session-start.md "},
		HookSessionStartMaxChars:     &maxChars,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})

	service := NewService(dataStore, nil, events.NewHub())
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "请继续实现 hooks 配置层",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected session-start hook to apply configured context path, got %#v", result)
	}
	if !strings.Contains(result.UpdatedInput, "来源文件：docs/session-start.md") {
		t.Fatalf("expected configured context path to be used, got %q", result.UpdatedInput)
	}
	if !strings.Contains(result.AdditionalContext, "[truncated]") {
		t.Fatalf("expected configured max chars to truncate context, got %q", result.AdditionalContext)
	}
	if result.Run == nil || result.Run.AdditionalContext != result.AdditionalContext {
		t.Fatalf("expected session-start run to persist truncated context, got %#v", result.Run)
	}
}

func TestEvaluateSessionStartUsesWorkspaceHooksFileBaseline(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(rootDir, ".codex"), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.MkdirAll(filepath.Join(rootDir, "docs"), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(rootDir, ".codex", "hooks.json"),
		[]byte(`{
  "sessionStart": {
    "contextPaths": [" docs\\\\session-start.md "],
    "maxChars": 36
  }
}`),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(rootDir, "docs", "session-start.md"),
		[]byte("line 1\nline 2 with more context\nline 3 should be truncated away"),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})

	service := NewService(dataStore, nil, events.NewHub())
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "请继续实现 hooks.json 基线配置",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected session-start hook to apply workspace baseline, got %#v", result)
	}
	if !strings.Contains(result.UpdatedInput, "来源文件：docs/session-start.md") {
		t.Fatalf("expected workspace hooks file to override context path, got %q", result.UpdatedInput)
	}
	if !strings.Contains(result.AdditionalContext, "[truncated]") {
		t.Fatalf("expected workspace hooks file to override max chars, got %q", result.AdditionalContext)
	}
}

func TestEvaluateSessionStartSkipsWhenThreadAlreadyHasConversationTurns(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(rootDir, "README.md"), []byte("# Repo Rules\n\n- always verify"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          rootDir,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
	})
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread: store.Thread{
			ID:           "thread-1",
			WorkspaceID:  workspace.ID,
			Cwd:          rootDir,
			Materialized: true,
			Name:         "Thread 1",
			Status:       "completed",
		},
		Cwd:       rootDir,
		TurnCount: 1,
		Turns: []store.ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":   "msg-1",
						"type": "agentMessage",
						"text": "done",
					},
				},
			},
		},
	})

	service := NewService(dataStore, nil, events.NewHub())
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "继续修复 hooks",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if result.Applied {
		t.Fatalf("expected session-start hook to skip threads that already have turns, got %#v", result)
	}
	if result.UpdatedInput != "继续修复 hooks" {
		t.Fatalf("expected input to remain unchanged, got %q", result.UpdatedInput)
	}
	if runs := dataStore.ListHookRuns(workspace.ID, "thread-1"); len(runs) != 0 {
		t.Fatalf("expected no hook run when session start is skipped, got %#v", runs)
	}
}

func TestEvaluateSessionStartAppliesPendingResumeSourceForThreadWithTurns(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	writeDefaultSessionStartDocument(
		t,
		rootDir,
		"# Repo Rules\n\n- reload project context after resume",
	)

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	dataStore.UpsertThread(store.Thread{
		ID:                 "thread-1",
		WorkspaceID:        workspace.ID,
		Cwd:                rootDir,
		Materialized:       true,
		Name:               "Thread 1",
		Status:             "idle",
		SessionStartSource: sessionStartSourceResume,
	})
	dataStore.SetThreadSessionStartSource(workspace.ID, "thread-1", sessionStartSourceResume, true)
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread: store.Thread{
			ID:                 "thread-1",
			WorkspaceID:        workspace.ID,
			Cwd:                rootDir,
			Materialized:       true,
			Name:               "Thread 1",
			Status:             "completed",
			SessionStartSource: sessionStartSourceResume,
		},
		Cwd:       rootDir,
		TurnCount: 1,
		Turns: []store.ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":   "msg-1",
						"type": "agentMessage",
						"text": "done",
					},
				},
			},
		},
	})

	service := NewService(dataStore, nil, events.NewHub())
	result, err := service.EvaluateSessionStart(context.Background(), SessionStartInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		TriggerMethod: "turn/start",
		Scope:         "thread",
		Input:         "继续修复 resume 后的 hooks 语义",
	})
	if err != nil {
		t.Fatalf("EvaluateSessionStart() error = %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected pending resume session-start source to inject project context, got %#v", result)
	}
	if result.SessionStartSource != sessionStartSourceResume {
		t.Fatalf("expected resume session-start source, got %#v", result)
	}
	if result.Run == nil || result.Run.SessionStartSource != sessionStartSourceResume {
		t.Fatalf("expected persisted resume session-start source, got %#v", result.Run)
	}
	if !strings.Contains(result.UpdatedInput, "来源文件：.codex/SESSION_START.md") {
		t.Fatalf("expected resume session-start to load project context, got %q", result.UpdatedInput)
	}
	if got := dataStore.PendingThreadSessionStartSource(workspace.ID, "thread-1"); got != "" {
		t.Fatalf("expected resume session-start source to be consumed, got %q", got)
	}
}

func TestWriteConfigurationWritesCanonicalHooksFileAndClearsFallbackOnReset(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	fallbackPath := filepath.Join(rootDir, "hooks.json")
	if err := os.WriteFile(
		fallbackPath,
		[]byte(`{"sessionStart":{"enabled":false}}`),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)
	service := NewService(dataStore, nil, events.NewHub())

	disabled := false
	result, err := service.WriteConfiguration(workspace.ID, WorkspaceConfigOverrides{
		HookUserPromptSubmitBlockSecretPasteEnabled: &disabled,
		HookPreToolUseAdditionalProtectedGovernancePaths: []string{
			"docs/governance.md",
		},
	})
	if err != nil {
		t.Fatalf("WriteConfiguration() error = %v", err)
	}
	if result.Status != "written" {
		t.Fatalf("expected written status, got %#v", result.Status)
	}

	primaryPath := filepath.Join(rootDir, ".codex", "hooks.json")
	content, err := os.ReadFile(primaryPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", primaryPath, err)
	}
	if !strings.Contains(string(content), `"blockSecretPasteEnabled": false`) {
		t.Fatalf("expected canonical hooks file to persist user-prompt baseline, got %q", string(content))
	}
	if !strings.Contains(string(content), `"additionalProtectedGovernancePaths": [`) {
		t.Fatalf("expected canonical hooks file to persist additional protected governance paths, got %q", string(content))
	}
	if _, err := os.Stat(fallbackPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected fallback hooks file to be removed, got err=%v", err)
	}
	if result.Configuration.LoadStatus != WorkspaceConfigLoadStatusLoaded {
		t.Fatalf("expected loaded configuration after write, got %#v", result.Configuration.LoadStatus)
	}
	if result.Configuration.LoadedFromPath != primaryPath {
		t.Fatalf("expected loaded path %q, got %q", primaryPath, result.Configuration.LoadedFromPath)
	}
	if !reflect.DeepEqual(
		result.Configuration.BaselineHookPreToolUseAdditionalProtectedGovernancePaths,
		[]string{"docs/governance.md"},
	) {
		t.Fatalf(
			"expected baseline protected governance paths to persist, got %#v",
			result.Configuration.BaselineHookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}

	resetResult, err := service.WriteConfiguration(workspace.ID, WorkspaceConfigOverrides{})
	if err != nil {
		t.Fatalf("WriteConfiguration(reset) error = %v", err)
	}
	if resetResult.Status != "deleted" {
		t.Fatalf("expected deleted status after reset, got %#v", resetResult.Status)
	}
	if _, err := os.Stat(primaryPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected primary hooks file to be removed, got err=%v", err)
	}
	if resetResult.Configuration.LoadStatus != WorkspaceConfigLoadStatusNotFound {
		t.Fatalf("expected not_found load status after reset, got %#v", resetResult.Configuration.LoadStatus)
	}
}

type fakeTurnExecutor struct {
	mu              sync.Mutex
	startCalls      []fakeTurnCall
	steerCalls      []fakeTurnCall
	interruptCalls  []fakeTurnCall
	reviewCalls     []fakeTurnCall
	startResult     turns.Result
	startErr        error
	steerResult     turns.Result
	steerErr        error
	interruptResult turns.Result
	interruptErr    error
	reviewResult    turns.Result
	reviewErr       error
}

type fakeTurnCall struct {
	workspaceID string
	threadID    string
	input       string
	options     turns.StartOptions
}

func (f *fakeTurnExecutor) Start(
	_ context.Context,
	workspaceID string,
	threadID string,
	input string,
	options turns.StartOptions,
) (turns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.startCalls = append(f.startCalls, fakeTurnCall{
		workspaceID: workspaceID,
		threadID:    threadID,
		input:       input,
		options:     options,
	})

	if f.startErr != nil {
		return turns.Result{}, f.startErr
	}
	if f.startResult != (turns.Result{}) {
		return f.startResult, nil
	}

	return turns.Result{
		TurnID: "turn-follow-up",
		Status: "running",
	}, nil
}

func (f *fakeTurnExecutor) Steer(
	_ context.Context,
	workspaceID string,
	threadID string,
	input string,
) (turns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.steerCalls = append(f.steerCalls, fakeTurnCall{
		workspaceID: workspaceID,
		threadID:    threadID,
		input:       input,
	})

	if f.steerErr != nil {
		return turns.Result{}, f.steerErr
	}
	if f.steerResult != (turns.Result{}) {
		return f.steerResult, nil
	}

	return turns.Result{
		TurnID: "turn-1",
		Status: "steered",
	}, nil
}

func (f *fakeTurnExecutor) Interrupt(_ context.Context, workspaceID string, threadID string) (turns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.interruptCalls = append(f.interruptCalls, fakeTurnCall{
		workspaceID: workspaceID,
		threadID:    threadID,
	})

	if f.interruptErr != nil {
		return turns.Result{}, f.interruptErr
	}
	if f.interruptResult != (turns.Result{}) {
		return f.interruptResult, nil
	}

	return turns.Result{
		TurnID: "turn-interrupted",
		Status: "interrupted",
	}, nil
}

func (f *fakeTurnExecutor) Review(_ context.Context, workspaceID string, threadID string) (turns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.reviewCalls = append(f.reviewCalls, fakeTurnCall{
		workspaceID: workspaceID,
		threadID:    threadID,
	})

	if f.reviewErr != nil {
		return turns.Result{}, f.reviewErr
	}
	if f.reviewResult != (turns.Result{}) {
		return f.reviewResult, nil
	}

	return turns.Result{
		TurnID: "review-turn-1",
		Status: "reviewing",
	}, nil
}

func (f *fakeTurnExecutor) startCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.startCalls)
}

func (f *fakeTurnExecutor) steerCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.steerCalls)
}

func (f *fakeTurnExecutor) interruptCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.interruptCalls)
}

func (f *fakeTurnExecutor) reviewCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.reviewCalls)
}

func expectHookFollowUpMetadata(
	t *testing.T,
	call fakeTurnCall,
	workspaceID string,
	threadID string,
	triggerMethod string,
	policyName string,
	hookRunID string,
) {
	t.Helper()

	metadata := call.options.ResponsesAPIClientMetadata
	if metadata.Source != "hook" {
		t.Fatalf("expected hook metadata source, got %#v", metadata.Source)
	}
	if metadata.Origin != "codex-server-web" {
		t.Fatalf("expected codex-server-web metadata origin, got %#v", metadata.Origin)
	}
	if metadata.WorkspaceID != workspaceID {
		t.Fatalf("expected hook metadata workspace id %q, got %#v", workspaceID, metadata.WorkspaceID)
	}
	if metadata.ThreadID != threadID {
		t.Fatalf("expected hook metadata thread id %q, got %#v", threadID, metadata.ThreadID)
	}
	if metadata.HookTriggerMethod != triggerMethod {
		t.Fatalf("expected hook trigger method %q, got %#v", triggerMethod, metadata.HookTriggerMethod)
	}
	if metadata.HookPolicyName != policyName {
		t.Fatalf("expected hook policy name %q, got %#v", policyName, metadata.HookPolicyName)
	}
	if metadata.HookRunID != hookRunID {
		t.Fatalf("expected hook run id %q, got %#v", hookRunID, metadata.HookRunID)
	}
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatal("condition not satisfied before timeout")
}

func findHookRun(runs []store.HookRun, eventName string, handlerKey string) (store.HookRun, bool) {
	for _, run := range runs {
		if run.EventName == eventName && run.HandlerKey == handlerKey {
			return run, true
		}
	}

	return store.HookRun{}, false
}

func containsHookEntry(entries []store.HookOutputEntry, text string) bool {
	for _, entry := range entries {
		if entry.Text == text {
			return true
		}
	}

	return false
}
