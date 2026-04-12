package bots

import (
	"fmt"
	"strings"
	"testing"
)

func TestTailBotCommandOutputMarksLineTruncation(t *testing.T) {
	t.Parallel()

	lines := make([]string, 0, 30)
	for index := 1; index <= 30; index += 1 {
		lines = append(lines, fmt.Sprintf("line-%02d", index))
	}

	text := tailBotCommandOutput(strings.Join(lines, "\n"))
	if !strings.Contains(text, "Output (showing last 24 of 30 lines):") {
		t.Fatalf("expected truncation header, got %q", text)
	}
	if !strings.Contains(text, "...\nline-07") {
		t.Fatalf("expected explicit omitted-output marker, got %q", text)
	}
	if strings.Contains(text, lines[0]) {
		t.Fatalf("did not expect earliest line to be present after tail truncation, got %q", text)
	}
	if !strings.Contains(text, lines[len(lines)-1]) {
		t.Fatalf("expected latest line to be preserved, got %q", text)
	}
}

func TestRenderBotToolCallItemIncludesResultPreview(t *testing.T) {
	t.Parallel()

	text := renderBotVisibleItem(map[string]any{
		"id":     "tool-1",
		"type":   "dynamicToolCall",
		"tool":   "fetch_data",
		"status": "completed",
		"result": map[string]any{
			"ok": true,
		},
	})

	expected := `Tool Call: fetch_data · Completed · Result: {"ok":true}`
	if text != expected {
		t.Fatalf("unexpected tool call render %q", text)
	}
}

func TestRenderBotCommandExecutionItemSupportsSingleLineMode(t *testing.T) {
	t.Parallel()

	text := renderBotVisibleItemWithConfig(map[string]any{
		"id":               "command-1",
		"type":             "commandExecution",
		"command":          "go test ./...",
		"status":           "completed",
		"aggregatedOutput": "ok\nPASS",
	}, botTranscriptRenderConfig{
		CommandOutputMode: botCommandOutputModeSingleLine,
	})

	expected := "Command: go test ./... [Completed] · 2 output lines"
	if text != expected {
		t.Fatalf("unexpected single-line command render %q", text)
	}
}

func TestRenderBotCommandExecutionItemOmitsCommandInNoneMode(t *testing.T) {
	t.Parallel()

	text := renderBotVisibleItemWithConfig(map[string]any{
		"id":               "command-none-1",
		"type":             "commandExecution",
		"command":          "go test ./...",
		"status":           "completed",
		"aggregatedOutput": "line-1\nline-2",
	}, botTranscriptRenderConfig{
		CommandOutputMode: botCommandOutputModeNone,
	})

	if text != "" {
		t.Fatalf("expected empty render when command output mode is none, got %q", text)
	}
}

func TestRenderBotCommandExecutionItemSupportsFullMode(t *testing.T) {
	t.Parallel()

	text := renderBotVisibleItemWithConfig(map[string]any{
		"id":               "command-2",
		"type":             "commandExecution",
		"command":          "go test ./...",
		"aggregatedOutput": "line-1\nline-2\nline-3\nline-4",
	}, botTranscriptRenderConfig{
		CommandOutputMode: botCommandOutputModeFull,
	})

	expected := "Command: go test ./...\nOutput:\nline-1\nline-2\nline-3\nline-4"
	if text != expected {
		t.Fatalf("unexpected full command render %q", text)
	}
}

func TestRenderBotVisibleItemFallsBackToStructuredUnknownItem(t *testing.T) {
	t.Parallel()

	text := renderBotVisibleItem(map[string]any{
		"id":     "custom-1",
		"type":   "customStatus",
		"status": "failed",
		"error":  "permission denied",
		"details": map[string]any{
			"phase": "delivery",
		},
	})

	if !strings.Contains(text, "Custom Status:") {
		t.Fatalf("expected fallback title, got %q", text)
	}
	if !strings.Contains(text, "Status: Failed") {
		t.Fatalf("expected fallback status, got %q", text)
	}
	if !strings.Contains(text, "Error: permission denied") {
		t.Fatalf("expected fallback error preview, got %q", text)
	}
	if !strings.Contains(text, `Details: {"phase":"delivery"}`) {
		t.Fatalf("expected fallback details preview, got %q", text)
	}
}

func TestRenderBotHookRunItemBuildsReadableMessageWithoutPrecomputedSummary(t *testing.T) {
	t.Parallel()

	text := renderBotVisibleItem(map[string]any{
		"id":         "hook-run-1",
		"type":       "hookRun",
		"eventName":  "PostToolUse",
		"handlerKey": "builtin.turnpolicy.post-tool-use",
		"status":     "completed",
		"decision":   "continueTurn",
		"reason":     "validation_command_failed",
		"entries": []any{
			map[string]any{"text": "Queued follow-up validation"},
		},
	})

	expected := strings.Join([]string{
		"Event: Post-Tool Use",
		"Handler: builtin.turnpolicy.post-tool-use",
		"Status: Completed",
		"Decision: Continue Turn",
		"Reason: Validation command failed",
		"Feedback: Queued follow-up validation",
	}, "\n")
	if text != expected {
		t.Fatalf("unexpected hook run render %q", text)
	}
}

func TestRenderBotFileChangeItemMarksOmissions(t *testing.T) {
	t.Parallel()

	changes := make([]any, 0, 10)
	for index := 0; index < 10; index += 1 {
		changes = append(changes, map[string]any{
			"path": "backend/internal/bots/file_" + strings.Repeat("x", index+1) + ".go",
			"kind": map[string]any{"type": "update"},
		})
	}

	text := renderBotVisibleItem(map[string]any{
		"id":      "files-1",
		"type":    "fileChange",
		"changes": changes,
	})

	if !strings.Contains(text, "Files (showing 8 of 10):") {
		t.Fatalf("expected explicit file-change cap, got %q", text)
	}
	if !strings.Contains(text, "... 2 more file changes not shown") {
		t.Fatalf("expected omitted-file marker, got %q", text)
	}
}

func TestRenderBotTurnPlanItemIncludesStatuses(t *testing.T) {
	t.Parallel()

	text := renderBotVisibleItem(map[string]any{
		"id":          "turn-plan-1",
		"type":        "turnPlan",
		"explanation": "Stabilize the plan event pipeline",
		"steps": []any{
			map[string]any{
				"step":   "Inspect runtime events",
				"status": "completed",
			},
			map[string]any{
				"step":   "Render status badges",
				"status": "inProgress",
			},
		},
	})

	if !strings.Contains(text, "Plan Status:") {
		t.Fatalf("expected turn plan title, got %q", text)
	}
	if !strings.Contains(text, "Stabilize the plan event pipeline") {
		t.Fatalf("expected explanation, got %q", text)
	}
	if !strings.Contains(text, "1. [Completed] Inspect runtime events") {
		t.Fatalf("expected completed step, got %q", text)
	}
	if !strings.Contains(text, "2. [In Progress] Render status badges") {
		t.Fatalf("expected in-progress step, got %q", text)
	}
}
