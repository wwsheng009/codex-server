package api

import (
	"net/http"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestFeishuToolsAuditsRouteReturnsFilteredResults(t *testing.T) {
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID: workspace.ID,
		Enabled:     true,
		AppID:       "cli_app_123",
		AppSecret:   "secret",
		OauthMode:   "user_oauth",
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	baseTime := time.Date(2026, 4, 19, 10, 0, 0, 0, time.UTC)
	for _, record := range []store.FeishuToolAuditRecord{
		{
			ID:           "fta-1",
			WorkspaceID:  workspace.ID,
			ToolName:     "feishu_oauth",
			Action:       "status",
			Result:       "success",
			CompletedAt:  baseTime.Add(1 * time.Minute),
			StartedAt:    baseTime,
			InvocationID: "invoke-1",
		},
		{
			ID:           "fta-2",
			WorkspaceID:  workspace.ID,
			ToolName:     "feishu_oauth",
			Action:       "login",
			Result:       "failure",
			CompletedAt:  baseTime.Add(2 * time.Minute),
			StartedAt:    baseTime.Add(1 * time.Minute),
			InvocationID: "invoke-2",
		},
		{
			ID:           "fta-3",
			WorkspaceID:  workspace.ID,
			ToolName:     "feishu_im_bot_image",
			Action:       "default",
			Result:       "success",
			CompletedAt:  baseTime.Add(3 * time.Minute),
			StartedAt:    baseTime.Add(2 * time.Minute),
			InvocationID: "invoke-3",
		},
	} {
		if _, err := dataStore.CreateFeishuToolAuditRecord(record); err != nil {
			t.Fatalf("CreateFeishuToolAuditRecord() error = %v", err)
		}
	}

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/feishu-tools/audits?toolName=feishu_oauth&result=failure&limit=1",
		"",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			Items []struct {
				ID         string `json:"id"`
				ToolName   string `json:"toolName"`
				Action     string `json:"action"`
				Result     string `json:"result"`
				Invocation string `json:"invocationId"`
			} `json:"items"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)

	if len(payload.Data.Items) != 1 {
		t.Fatalf("expected one filtered audit item, got %#v", payload.Data.Items)
	}
	item := payload.Data.Items[0]
	if item.ID != "fta-2" || item.ToolName != "feishu_oauth" || item.Result != "failure" || item.Invocation != "invoke-2" {
		t.Fatalf("unexpected audit route payload: %#v", item)
	}
}

func TestFeishuToolsAuditsRouteRejectsInvalidLimit(t *testing.T) {
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	router := newTestRouter(dataStore)

	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/feishu-tools/audits?limit=-1",
		"",
	)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}
