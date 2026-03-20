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
	})

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
	})

	if payload["effort"] != "medium" {
		t.Fatalf("expected invalid reasoning effort to fall back to medium, got %#v", payload["effort"])
	}
}
