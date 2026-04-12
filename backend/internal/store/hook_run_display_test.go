package store

import "testing"

func TestFormatHookOutputEntryTextUsesReadableLabelsForStructuredValues(t *testing.T) {
	t.Parallel()

	if got := FormatHookOutputEntryText("sourcePath=.codex/hooks.json"); got != "Source Path: .codex/hooks.json" {
		t.Fatalf("expected readable source path label, got %q", got)
	}
	if got := FormatHookOutputEntryText("matched policy: broad-recursive-delete"); got != "Matched Policy: broad-recursive-delete" {
		t.Fatalf("expected readable matched policy label, got %q", got)
	}
}

func TestFormatHookRunFeedbackEntriesUsesReadableLabels(t *testing.T) {
	t.Parallel()

	got := FormatHookRunFeedbackEntries([]HookOutputEntry{
		{Kind: "feedback", Text: "command=go test ./...; status=failed; exitCode=1"},
		{Kind: "context", Text: "matched path: docs/governance.md"},
	}, 2)

	want := "Command: go test ./...; status=failed; exitCode=1 | Matched Path: docs/governance.md"
	if got != want {
		t.Fatalf("expected formatted feedback %q, got %q", want, got)
	}
}

func TestFormatHookRunReasonUsesDedicatedLabelsForMcpAndAuditReasons(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"mcp_elicitation_request_audited":                                 "MCP elicitation request audited",
		"protected_governance_file_mutation_observed_after_mcp_tool_call": "Protected governance file mutation observed after MCP tool call",
		"dynamic_tool_call_request_audited":                               "Dynamic tool call request audited",
		"config_mcp_server_reload_audited":                                "MCP server reload audited",
	}

	for input, want := range cases {
		if got := FormatHookRunReason(input); got != want {
			t.Fatalf("expected reason %q to format as %q, got %q", input, want, got)
		}
	}
}

func TestFormatHookRunToolLabelUsesReadableNames(t *testing.T) {
	t.Parallel()

	cases := []struct {
		toolName string
		toolKind string
		want     string
	}{
		{toolName: "command/exec", want: "Command Execution"},
		{toolKind: "commandExecution", want: "Command Execution"},
		{toolName: "filesystem/write_file", want: "Filesystem / Write File"},
		{toolName: "mcp/filesystem/exec_command", want: "MCP / Filesystem / Exec Command"},
	}

	for _, tc := range cases {
		if got := FormatHookRunToolLabel(tc.toolName, tc.toolKind); got != tc.want {
			t.Fatalf("expected tool label %q/%q to format as %q, got %q", tc.toolName, tc.toolKind, tc.want, got)
		}
	}
}

func TestFormatHookRunHandlerLabelUsesReadableNames(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"builtin.posttooluse.failed-validation-rescue":  "Failed Validation Rescue",
		"builtin.pretooluse.block-dangerous-command":    "Dangerous Command Guard",
		"builtin.httpmutation.audit-workspace-mutation": "Workspace Mutation Audit",
		"builtin.sessionstart.inject-project-context":   "Project Context Injection",
		"builtin.stop.require-successful-verification":  "Successful Verification Requirement",
	}

	for input, want := range cases {
		if got := FormatHookRunHandlerLabel(input); got != want {
			t.Fatalf("expected handler label %q to format as %q, got %q", input, want, got)
		}
	}
}

func TestFormatHookRunTriggerMethodLabelUsesReadableNames(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"item/completed":                        "Item Completed",
		"turn/start":                            "Turn Start",
		"mcpServer/elicitation/request":         "MCP Elicitation Request",
		"item/commandExecution/requestApproval": "Command Execution Approval Request",
		"fs/write":                              "Write File",
		"config/mcp-server/reload":              "MCP Server Reload",
		"hook/follow-up":                        "Hook Follow-up",
	}

	for input, want := range cases {
		if got := FormatHookRunTriggerMethodLabel(input); got != want {
			t.Fatalf("expected trigger method %q to format as %q, got %q", input, want, got)
		}
	}
}
