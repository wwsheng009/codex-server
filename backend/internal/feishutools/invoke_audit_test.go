package feishutools

import (
	"context"
	"testing"

	"codex-server/backend/internal/store"
)

func TestInvokePersistsSuccessAuditAndAuditsCanFilter(t *testing.T) {
	service, _, workspace := newOauthToolTestService(t, oauthToolTestConfig())

	ctx := ContextWithInvokeEventScope(context.Background(), "thread-1", "turn-1")
	result, err := service.Invoke(ctx, workspace.ID, InvokeInput{
		ToolName:     "feishu_oauth",
		Action:       "status",
		InvocationID: "invoke-1",
	})
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if result.Status != "ok" {
		t.Fatalf("expected ok invoke result, got %#v", result)
	}
	if result.Principal != "user" {
		t.Fatalf("expected user principal, got %#v", result)
	}

	audits, err := service.Audits(context.Background(), workspace.ID, AuditQuery{
		ToolName: "feishu_oauth",
		Result:   "success",
		Limit:    1,
	})
	if err != nil {
		t.Fatalf("Audits() error = %v", err)
	}
	if len(audits.Items) != 1 {
		t.Fatalf("expected one audit record, got %#v", audits.Items)
	}
	record := audits.Items[0]
	if record.ThreadID != "thread-1" || record.TurnID != "turn-1" {
		t.Fatalf("expected thread and turn ids to be persisted, got %#v", record)
	}
	if record.InvocationID != "invoke-1" || record.ActionKey != "feishu_oauth.status" {
		t.Fatalf("unexpected audit record identifiers: %#v", record)
	}
	if record.PrincipalType != "user" || record.PrincipalID != "ou_123" {
		t.Fatalf("unexpected principal fields: %#v", record)
	}
	if record.Result != "success" || record.ErrorCode != "" || record.ErrorMessage != "" {
		t.Fatalf("unexpected success audit payload: %#v", record)
	}
}

func TestInvokePersistsFailureAuditForOauthLogin(t *testing.T) {
	config := oauthToolTestConfig()
	config.ToolAllowlist = []string{"feishu_oauth"}

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	config.WorkspaceID = workspace.ID
	if _, err := dataStore.SetFeishuToolsConfig(config); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	service := NewService(nil, nil, nil, dataStore)
	result, err := service.Invoke(context.Background(), workspace.ID, InvokeInput{
		ToolName:     "feishu_oauth",
		Action:       "login",
		InvocationID: "invoke-2",
	})
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if result.Status != "error" || result.Error == nil {
		t.Fatalf("expected structured error result, got %#v", result)
	}

	audits, err := service.Audits(context.Background(), workspace.ID, AuditQuery{Result: "failure"})
	if err != nil {
		t.Fatalf("Audits() error = %v", err)
	}
	if len(audits.Items) != 1 {
		t.Fatalf("expected one failure audit record, got %#v", audits.Items)
	}
	record := audits.Items[0]
	if record.ActionKey != "feishu_oauth.login" {
		t.Fatalf("unexpected audit action key: %#v", record)
	}
	if record.Result != "failure" {
		t.Fatalf("expected failure audit result, got %#v", record)
	}
	if record.PrincipalType != "user" || record.PrincipalID != "ou_123" {
		t.Fatalf("expected oauth login failure to remain user-scoped, got %#v", record)
	}
	if record.ErrorCode != "internal_error" || record.ErrorMessage == "" {
		t.Fatalf("expected persisted error payload, got %#v", record)
	}
}
