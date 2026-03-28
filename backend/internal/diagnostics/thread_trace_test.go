package diagnostics

import "testing"

func TestThreadTraceFilters(t *testing.T) {
	t.Cleanup(func() {
		ConfigureThreadTrace(false, "", "")
	})

	ConfigureThreadTrace(true, "ws-1", "thread-1")

	if !WorkspaceTraceEnabled("ws-1") {
		t.Fatal("expected workspace trace to match configured workspace")
	}
	if WorkspaceTraceEnabled("ws-2") {
		t.Fatal("did not expect workspace trace to match another workspace")
	}
	if !ThreadTraceEnabled("ws-1", "thread-1") {
		t.Fatal("expected thread trace to match configured thread")
	}
	if ThreadTraceEnabled("ws-1", "thread-2") {
		t.Fatal("did not expect thread trace to match another thread")
	}
	if ThreadTraceEnabled("ws-2", "thread-1") {
		t.Fatal("did not expect thread trace to match another workspace")
	}
}

func TestThreadTraceAllowsWorkspaceWideTracingWithoutThreadFilter(t *testing.T) {
	t.Cleanup(func() {
		ConfigureThreadTrace(false, "", "")
	})

	ConfigureThreadTrace(true, "ws-1", "")

	if !ThreadTraceEnabled("ws-1", "thread-a") {
		t.Fatal("expected thread trace to allow any thread within the configured workspace")
	}
	if ThreadTraceEnabled("ws-2", "thread-a") {
		t.Fatal("did not expect thread trace to allow another workspace")
	}
}

func TestTurnStartTraceAttrsSummarizesPayload(t *testing.T) {
	attrs := TurnStartTraceAttrs(map[string]any{
		"threadId":       "thread-1",
		"model":          "gpt-5",
		"effort":         "high",
		"approvalPolicy": "never",
		"sandboxPolicy": map[string]any{
			"type": "dangerFullAccess",
		},
		"collaborationMode": map[string]any{
			"mode": "plan",
		},
		"input": []any{
			map[string]any{
				"type": "text",
				"text": "hello",
			},
		},
	})

	got := map[string]any{}
	for index := 0; index+1 < len(attrs); index += 2 {
		key, _ := attrs[index].(string)
		got[key] = attrs[index+1]
	}

	if got["requestThreadId"] != "thread-1" {
		t.Fatalf("requestThreadId = %#v", got["requestThreadId"])
	}
	if got["model"] != "gpt-5" {
		t.Fatalf("model = %#v", got["model"])
	}
	if got["effort"] != "high" {
		t.Fatalf("effort = %#v", got["effort"])
	}
	if got["approvalPolicy"] != "never" {
		t.Fatalf("approvalPolicy = %#v", got["approvalPolicy"])
	}
	if got["sandboxType"] != "dangerFullAccess" {
		t.Fatalf("sandboxType = %#v", got["sandboxType"])
	}
	if got["hasCollaborationMode"] != true {
		t.Fatalf("hasCollaborationMode = %#v", got["hasCollaborationMode"])
	}
	if got["inputCount"] != 1 {
		t.Fatalf("inputCount = %#v", got["inputCount"])
	}
	if got["inputTextLength"] != 5 {
		t.Fatalf("inputTextLength = %#v", got["inputTextLength"])
	}
}
