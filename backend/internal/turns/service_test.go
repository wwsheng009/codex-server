package turns

import (
	"testing"

	"codex-server/backend/internal/bridge"
)

func TestIsThreadResumeRequiredForNotLoaded(t *testing.T) {
	t.Parallel()

	err := &bridge.RPCError{
		Code:    -32600,
		Message: "thread not loaded: 019d0aa6-3c5a-7142-9820-8e8eb7bbbd36",
	}

	if !isThreadResumeRequired(err) {
		t.Fatal("expected thread-not-loaded error to be recognized")
	}
}

func TestIsThreadResumeRequiredForNotFound(t *testing.T) {
	t.Parallel()

	err := &bridge.RPCError{
		Code:    -32600,
		Message: "thread not found: 019d0b0a-da4d-72a0-bb67-ee081fa7e03e",
	}

	if !isThreadResumeRequired(err) {
		t.Fatal("expected thread-not-found error to be recognized")
	}
}

func TestIsThreadResumeRequiredRejectsOtherErrors(t *testing.T) {
	t.Parallel()

	err := &bridge.RPCError{
		Code:    -32600,
		Message: "thread/read failed",
	}

	if isThreadResumeRequired(err) {
		t.Fatal("expected unrelated RPC error to be ignored")
	}
}

func TestBuildTurnStartPayloadUsesSelectedOverrides(t *testing.T) {
	t.Parallel()

	payload := buildTurnStartPayload("thread-1", "Inspect the repo", StartOptions{
		Model:            "gpt-5.4",
		ReasoningEffort:  "xhigh",
		PermissionPreset: "full-access",
	}, nil)

	if payload["threadId"] != "thread-1" {
		t.Fatalf("expected thread id to be forwarded, got %#v", payload["threadId"])
	}
	if payload["model"] != "gpt-5.4" {
		t.Fatalf("expected model override, got %#v", payload["model"])
	}
	if payload["effort"] != "xhigh" {
		t.Fatalf("expected reasoning effort override, got %#v", payload["effort"])
	}
	if payload["approvalPolicy"] != "never" {
		t.Fatalf("expected full-access approval policy, got %#v", payload["approvalPolicy"])
	}

	sandboxPolicy, ok := payload["sandboxPolicy"].(map[string]any)
	if !ok {
		t.Fatalf("expected sandbox policy override map, got %#v", payload["sandboxPolicy"])
	}
	if sandboxPolicy["type"] != "dangerFullAccess" {
		t.Fatalf("expected danger-full-access sandbox policy, got %#v", sandboxPolicy["type"])
	}
}

func TestBuildTurnStartPayloadNormalizesReasoningEffort(t *testing.T) {
	t.Parallel()

	payload := buildTurnStartPayload("thread-1", "Inspect the repo", StartOptions{
		ReasoningEffort: "invalid",
	}, nil)

	if payload["effort"] != "medium" {
		t.Fatalf("expected invalid reasoning effort to fall back to medium, got %#v", payload["effort"])
	}
}

func TestBuildCollaborationModePayloadUsesPresetDefaults(t *testing.T) {
	t.Parallel()

	reasoningEffort := "high"
	payload, err := buildCollaborationModePayload("plan", StartOptions{}, collaborationModePreset{
		Mode:            "plan",
		Model:           "gpt-5.4",
		ReasoningEffort: &reasoningEffort,
	})
	if err != nil {
		t.Fatalf("expected collaboration mode payload, got error %v", err)
	}

	if payload["mode"] != "plan" {
		t.Fatalf("expected plan mode, got %#v", payload["mode"])
	}

	settings, ok := payload["settings"].(map[string]any)
	if !ok {
		t.Fatalf("expected settings map, got %#v", payload["settings"])
	}
	if settings["model"] != "gpt-5.4" {
		t.Fatalf("expected preset model, got %#v", settings["model"])
	}
	if settings["reasoning_effort"] != "high" {
		t.Fatalf("expected preset reasoning effort, got %#v", settings["reasoning_effort"])
	}
	if value, ok := settings["developer_instructions"]; !ok || value != nil {
		t.Fatalf("expected developer instructions to be explicit nil, got %#v", settings["developer_instructions"])
	}
}

func TestBuildCollaborationModePayloadPrefersExplicitOverrides(t *testing.T) {
	t.Parallel()

	payload, err := buildCollaborationModePayload("plan", StartOptions{
		Model:           "gpt-5.3-codex",
		ReasoningEffort: "low",
	}, collaborationModePreset{
		Mode:  "plan",
		Model: "gpt-5.4",
	})
	if err != nil {
		t.Fatalf("expected collaboration mode payload, got error %v", err)
	}

	settings := payload["settings"].(map[string]any)
	if settings["model"] != "gpt-5.3-codex" {
		t.Fatalf("expected explicit model override, got %#v", settings["model"])
	}
	if settings["reasoning_effort"] != "low" {
		t.Fatalf("expected explicit reasoning effort override, got %#v", settings["reasoning_effort"])
	}
}
