package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/auth"
	"codex-server/backend/internal/automations"
	"codex-server/backend/internal/bots"
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/execfs"
	"codex-server/backend/internal/feedback"
	"codex-server/backend/internal/notifications"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/runtimeprefs"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
	"codex-server/backend/internal/workspace"
)

func TestWorkspacePersistenceAcrossRouterRestart(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	firstRouter := newTestRouter(firstStore)
	createResponse := performJSONRequest(
		t,
		firstRouter,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Persistent Workspace","rootPath":"E:/projects/ai/codex-server"}`,
	)

	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	secondStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	secondRouter := newTestRouter(secondStore)
	listResponse := performJSONRequest(t, secondRouter, http.MethodGet, "/api/workspaces", "")

	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from list workspaces, got %d", listResponse.Code)
	}

	var listed struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	decodeResponseBody(t, listResponse, &listed)

	if len(listed.Data) != 1 {
		t.Fatalf("expected 1 persisted workspace, got %d", len(listed.Data))
	}

	if listed.Data[0].ID != created.Data.ID {
		t.Fatalf("expected persisted workspace id %q, got %q", created.Data.ID, listed.Data[0].ID)
	}
}

func TestExtendedFSRoutesValidateRequestBody(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	for _, path := range []string{
		"/api/workspaces/" + created.Data.ID + "/fs/read-directory",
		"/api/workspaces/" + created.Data.ID + "/fs/metadata",
		"/api/workspaces/" + created.Data.ID + "/fs/mkdir",
		"/api/workspaces/" + created.Data.ID + "/fs/remove",
		"/api/workspaces/" + created.Data.ID + "/fs/copy",
	} {
		response := performJSONRequest(t, router, http.MethodPost, path, `{`)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid body on %s, got %d", path, response.Code)
		}
	}
}

func TestDeleteWorkspaceRouteRemovesWorkspaceMetadata(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	dataStore.UpsertThread(store.Thread{
		ID:           "thr_test_delete_workspace",
		WorkspaceID:  created.Data.ID,
		Cwd:          "E:/projects/ai/codex-server",
		Materialized: true,
		Name:         "Delete Me",
		Status:       "idle",
	})

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/workspaces/"+created.Data.ID,
		"",
	)

	if deleteResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from delete workspace, got %d", deleteResponse.Code)
	}

	if _, ok := dataStore.GetWorkspace(created.Data.ID); ok {
		t.Fatal("expected workspace to be removed from store")
	}

	if threads := dataStore.ListThreads(created.Data.ID); len(threads) != 0 {
		t.Fatalf("expected workspace threads to be removed, got %d", len(threads))
	}
}

func TestRenameWorkspaceRouteUpdatesWorkspaceName(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	renameResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+created.Data.ID+"/name",
		`{"name":"Renamed Workspace"}`,
	)

	if renameResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from rename workspace, got %d", renameResponse.Code)
	}

	workspace, ok := dataStore.GetWorkspace(created.Data.ID)
	if !ok {
		t.Fatal("expected workspace to remain in store")
	}

	if workspace.Name != "Renamed Workspace" {
		t.Fatalf("expected workspace name to be updated, got %q", workspace.Name)
	}
}

func TestAutomationRoutesPersistRecords(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	workspaceResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var workspace struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, workspaceResponse, &workspace)

	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/automations",
		`{"title":"Daily Sync","description":"Summarize changes","prompt":"Summarize yesterday's git activity.","workspaceId":"`+workspace.Data.ID+`","schedule":"hourly","model":"gpt-5.4","reasoning":"medium"}`,
	)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create automation, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID            string `json:"id"`
			WorkspaceID   string `json:"workspaceId"`
			WorkspaceName string `json:"workspaceName"`
			Status        string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	if created.Data.WorkspaceID != workspace.Data.ID {
		t.Fatalf("expected automation workspaceId %q, got %q", workspace.Data.ID, created.Data.WorkspaceID)
	}
	if created.Data.WorkspaceName != "Workspace A" {
		t.Fatalf("expected automation workspaceName to be hydrated, got %q", created.Data.WorkspaceName)
	}
	if created.Data.Status != "active" {
		t.Fatalf("expected automation to start active, got %q", created.Data.Status)
	}

	listResponse := performJSONRequest(t, router, http.MethodGet, "/api/automations", "")
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from list automations, got %d", listResponse.Code)
	}

	var listed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, listResponse, &listed)
	if len(listed.Data) != 1 || listed.Data[0].ID != created.Data.ID {
		t.Fatalf("expected listed automation id %q, got %#v", created.Data.ID, listed.Data)
	}

	pauseResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/automations/"+created.Data.ID+"/pause",
		"",
	)
	if pauseResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from pause automation, got %d", pauseResponse.Code)
	}

	var paused struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, pauseResponse, &paused)
	if paused.Data.Status != "paused" {
		t.Fatalf("expected paused automation status, got %q", paused.Data.Status)
	}

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/automations/"+created.Data.ID,
		"",
	)
	if deleteResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from delete automation, got %d", deleteResponse.Code)
	}

	getResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/automations/"+created.Data.ID,
		"",
	)
	if getResponse.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after deleting automation, got %d", getResponse.Code)
	}
}

func TestAutomationRunAndNotificationRoutesReturnStoredData(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	automation, err := dataStore.CreateAutomation(store.Automation{
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

	run, err := dataStore.CreateAutomationRun(store.AutomationRun{
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
	if _, err := dataStore.AppendAutomationRunLog(run.ID, store.AutomationRunLogEntry{
		Level:   "info",
		Message: "Run started",
	}); err != nil {
		t.Fatalf("AppendAutomationRunLog() error = %v", err)
	}

	notification, err := dataStore.CreateNotification(store.Notification{
		WorkspaceID:     workspace.ID,
		WorkspaceName:   workspace.Name,
		AutomationID:    automation.ID,
		AutomationTitle: automation.Title,
		RunID:           run.ID,
		Kind:            "automation_run_completed",
		Title:           "Automation completed",
		Message:         "Daily Sync completed",
		Level:           "success",
	})
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	listRunsResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/automations/"+automation.ID+"/runs",
		"",
	)
	if listRunsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from automation runs route, got %d", listRunsResponse.Code)
	}

	var listedRuns struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, listRunsResponse, &listedRuns)
	if len(listedRuns.Data) != 1 || listedRuns.Data[0].ID != run.ID {
		t.Fatalf("expected listed run id %q, got %#v", run.ID, listedRuns.Data)
	}

	getRunResponse := performJSONRequest(t, router, http.MethodGet, "/api/automation-runs/"+run.ID, "")
	if getRunResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from automation run detail route, got %d", getRunResponse.Code)
	}

	var fetchedRun struct {
		Data struct {
			ID   string `json:"id"`
			Logs []struct {
				Message string `json:"message"`
			} `json:"logs"`
		} `json:"data"`
	}
	decodeResponseBody(t, getRunResponse, &fetchedRun)
	if fetchedRun.Data.ID != run.ID || len(fetchedRun.Data.Logs) != 1 {
		t.Fatalf("expected persisted run details, got %#v", fetchedRun.Data)
	}

	listNotificationsResponse := performJSONRequest(t, router, http.MethodGet, "/api/notifications", "")
	if listNotificationsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from notifications route, got %d", listNotificationsResponse.Code)
	}

	var listedNotifications struct {
		Data []struct {
			ID   string `json:"id"`
			Read bool   `json:"read"`
		} `json:"data"`
	}
	decodeResponseBody(t, listNotificationsResponse, &listedNotifications)
	if len(listedNotifications.Data) != 1 || listedNotifications.Data[0].ID != notification.ID {
		t.Fatalf("expected listed notification id %q, got %#v", notification.ID, listedNotifications.Data)
	}

	readNotificationResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/notifications/"+notification.ID+"/read",
		"",
	)
	if readNotificationResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from read notification route, got %d", readNotificationResponse.Code)
	}

	var readNotification struct {
		Data struct {
			Read bool `json:"read"`
		} `json:"data"`
	}
	decodeResponseBody(t, readNotificationResponse, &readNotification)
	if !readNotification.Data.Read {
		t.Fatal("expected notification to be marked read")
	}

	markAllResponse := performJSONRequest(t, router, http.MethodPost, "/api/notifications/read-all", "")
	if markAllResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from read-all notifications route, got %d", markAllResponse.Code)
	}

	deleteReadResponse := performJSONRequest(t, router, http.MethodDelete, "/api/notifications/read", "")
	if deleteReadResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from delete-read notifications route, got %d", deleteReadResponse.Code)
	}

	afterDeleteResponse := performJSONRequest(t, router, http.MethodGet, "/api/notifications", "")
	var afterDeleteNotifications struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, afterDeleteResponse, &afterDeleteNotifications)
	if len(afterDeleteNotifications.Data) != 0 {
		t.Fatalf("expected 0 notifications after delete, got %d", len(afterDeleteNotifications.Data))
	}
}

func TestAutomationTemplateRoutesSupportCustomTemplates(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)

	listResponse := performJSONRequest(t, router, http.MethodGet, "/api/automation-templates", "")
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from list templates, got %d", listResponse.Code)
	}

	var listed struct {
		Data []struct {
			ID        string `json:"id"`
			IsBuiltIn bool   `json:"isBuiltIn"`
		} `json:"data"`
	}
	decodeResponseBody(t, listResponse, &listed)
	if len(listed.Data) == 0 || !listed.Data[0].IsBuiltIn {
		t.Fatalf("expected built-in templates, got %#v", listed.Data)
	}

	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/automation-templates",
		`{"category":"Custom","title":"Security Audit","description":"Review security posture","prompt":"Audit the repository for security issues."}`,
	)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create template, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			IsBuiltIn bool   `json:"isBuiltIn"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)
	if created.Data.ID == "" || created.Data.Title != "Security Audit" || created.Data.IsBuiltIn {
		t.Fatalf("expected created custom template, got %#v", created.Data)
	}

	updateResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/automation-templates/"+created.Data.ID,
		`{"category":"Security","title":"Security Audit Updated","description":"Updated","prompt":"Updated prompt"}`,
	)
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from update template, got %d", updateResponse.Code)
	}

	getResponse := performJSONRequest(t, router, http.MethodGet, "/api/automation-templates/"+created.Data.ID, "")
	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from get template, got %d", getResponse.Code)
	}

	var fetched struct {
		Data struct {
			Title    string `json:"title"`
			Category string `json:"category"`
		} `json:"data"`
	}
	decodeResponseBody(t, getResponse, &fetched)
	if fetched.Data.Title != "Security Audit Updated" || fetched.Data.Category != "Security" {
		t.Fatalf("expected updated template data, got %#v", fetched.Data)
	}

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/automation-templates/"+created.Data.ID,
		"",
	)
	if deleteResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from delete template, got %d", deleteResponse.Code)
	}
}

func TestAutomationTemplateRoutesRejectBuiltInMutation(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)

	updateResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/automation-templates/status-standup",
		`{"category":"Status Reports","title":"Changed","description":"Changed","prompt":"Changed"}`,
	)
	if updateResponse.Code != http.StatusConflict {
		t.Fatalf("expected 409 from built-in template update, got %d", updateResponse.Code)
	}
}

func TestBotConnectionRoutesAndWebhook(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", eventHub)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	botProvider := newRouterTestBotProvider()
	botService := bots.NewService(dataStore, threadService, turnService, eventHub, bots.Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []bots.Provider{botProvider},
		AIBackends:    []bots.AIBackend{routerTestAIBackend{}},
	})
	botService.Start(context.Background())

	router := NewRouter(Dependencies{
		FrontendOrigin: "http://localhost:15173",
		Auth:           auth.NewService(dataStore, runtimeManager),
		Workspaces:     workspace.NewService(dataStore, runtimeManager),
		Bots:           botService,
		Automations:    automations.NewService(dataStore, threadService, turnService, eventHub),
		Notifications:  notifications.NewService(dataStore),
		Threads:        threadService,
		Turns:          turnService,
		Approvals:      approvals.NewService(runtimeManager),
		Catalog:        catalog.NewService(runtimeManager),
		ConfigFS:       configfs.NewService(runtimeManager),
		ExecFS:         execfs.NewService(runtimeManager, eventHub, dataStore),
		Feedback:       feedback.NewService(runtimeManager),
		Events:         eventHub,
	})

	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bot-connections",
		`{"provider":"fakechat","name":"Support Bot","aiBackend":"fake_ai","secrets":{"bot_token":"token-1"}}`,
	)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create bot connection, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID         string   `json:"id"`
			SecretKeys []string `json:"secretKeys"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)
	if created.Data.ID == "" {
		t.Fatal("expected bot connection id")
	}
	if len(created.Data.SecretKeys) == 0 {
		t.Fatalf("expected secret keys to be returned, got %#v", created.Data.SecretKeys)
	}

	listResponse := performJSONRequest(t, router, http.MethodGet, "/api/workspaces/"+workspace.ID+"/bot-connections", "")
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from list bot connections, got %d", listResponse.Code)
	}

	updateRuntimeModeResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bot-connections/"+created.Data.ID+"/runtime-mode",
		`{"runtimeMode":"debug"}`,
	)
	if updateRuntimeModeResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from runtime mode update, got %d", updateRuntimeModeResponse.Code)
	}

	webhookRequest := httptest.NewRequest(
		http.MethodPost,
		"/hooks/bots/"+created.Data.ID,
		strings.NewReader(`{"conversationId":"chat-1","messageId":"msg-1","userId":"user-1","username":"alice","title":"Alice","text":"hello"}`),
	)
	webhookRequest.Header.Set("X-Test-Secret", "fake-secret")
	webhookRecorder := httptest.NewRecorder()
	router.ServeHTTP(webhookRecorder, webhookRequest)
	if webhookRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 from bot webhook, got %d", webhookRecorder.Code)
	}

	select {
	case payload := <-botProvider.sentCh:
		if len(payload.Messages) != 1 || payload.Messages[0].Text != "route reply: hello" {
			t.Fatalf("expected route ai reply to be forwarded, got %#v", payload.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for routed bot reply")
	}

	conversationsResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/bot-connections/"+created.Data.ID+"/conversations",
		"",
	)
	if conversationsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from bot conversations route, got %d", conversationsResponse.Code)
	}

	var conversations struct {
		Data []struct {
			ThreadID string `json:"threadId"`
		} `json:"data"`
	}
	decodeResponseBody(t, conversationsResponse, &conversations)
	if len(conversations.Data) != 1 || conversations.Data[0].ThreadID != "thr_route_chat-1" {
		t.Fatalf("expected persisted bot conversation thread mapping, got %#v", conversations.Data)
	}
}

func TestRestartWorkspaceRouteIsWired(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	restartResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+created.Data.ID+"/restart",
		"",
	)

	if restartResponse.Code != http.StatusAccepted && restartResponse.Code != http.StatusBadGateway {
		t.Fatalf("expected restart workspace route to be wired, got %d", restartResponse.Code)
	}
}

func TestRuntimePreferencesRoutePersistsBackendThreadTrace(t *testing.T) {
	diagnostics.ConfigureThreadTrace(false, "", "")
	t.Cleanup(func() {
		diagnostics.ConfigureThreadTrace(false, "", "")
	})

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)

	writeResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/runtime/preferences",
		`{"backendThreadTraceEnabled":true,"backendThreadTraceWorkspaceId":" ws_trace ","backendThreadTraceThreadId":" thread_trace "}`,
	)
	if writeResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from runtime preferences write, got %d", writeResponse.Code)
	}

	var written struct {
		Data struct {
			ConfiguredBackendThreadTraceEnabled     *bool  `json:"configuredBackendThreadTraceEnabled"`
			ConfiguredBackendThreadTraceWorkspaceID string `json:"configuredBackendThreadTraceWorkspaceId"`
			ConfiguredBackendThreadTraceThreadID    string `json:"configuredBackendThreadTraceThreadId"`
			EffectiveBackendThreadTraceEnabled      bool   `json:"effectiveBackendThreadTraceEnabled"`
			EffectiveBackendThreadTraceWorkspaceID  string `json:"effectiveBackendThreadTraceWorkspaceId"`
			EffectiveBackendThreadTraceThreadID     string `json:"effectiveBackendThreadTraceThreadId"`
		} `json:"data"`
	}
	decodeResponseBody(t, writeResponse, &written)

	if written.Data.ConfiguredBackendThreadTraceEnabled == nil || !*written.Data.ConfiguredBackendThreadTraceEnabled {
		t.Fatalf("expected explicit backend trace enable flag, got %#v", written.Data.ConfiguredBackendThreadTraceEnabled)
	}
	if written.Data.EffectiveBackendThreadTraceWorkspaceID != "ws_trace" {
		t.Fatalf("unexpected effective workspace filter %q", written.Data.EffectiveBackendThreadTraceWorkspaceID)
	}
	if written.Data.EffectiveBackendThreadTraceThreadID != "thread_trace" {
		t.Fatalf("unexpected effective thread filter %q", written.Data.EffectiveBackendThreadTraceThreadID)
	}

	readResponse := performJSONRequest(t, router, http.MethodGet, "/api/runtime/preferences", "")
	if readResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from runtime preferences read, got %d", readResponse.Code)
	}

	var readBack struct {
		Data struct {
			ConfiguredBackendThreadTraceEnabled     *bool  `json:"configuredBackendThreadTraceEnabled"`
			ConfiguredBackendThreadTraceWorkspaceID string `json:"configuredBackendThreadTraceWorkspaceId"`
			ConfiguredBackendThreadTraceThreadID    string `json:"configuredBackendThreadTraceThreadId"`
		} `json:"data"`
	}
	decodeResponseBody(t, readResponse, &readBack)
	if readBack.Data.ConfiguredBackendThreadTraceEnabled == nil || !*readBack.Data.ConfiguredBackendThreadTraceEnabled {
		t.Fatalf("expected persisted backend trace enable flag, got %#v", readBack.Data.ConfiguredBackendThreadTraceEnabled)
	}
	if readBack.Data.ConfiguredBackendThreadTraceWorkspaceID != "ws_trace" {
		t.Fatalf("unexpected persisted workspace filter %q", readBack.Data.ConfiguredBackendThreadTraceWorkspaceID)
	}
	if readBack.Data.ConfiguredBackendThreadTraceThreadID != "thread_trace" {
		t.Fatalf("unexpected persisted thread filter %q", readBack.Data.ConfiguredBackendThreadTraceThreadID)
	}
}

func TestInterruptTurnRouteIsIdempotentWithoutActiveTurn(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	interruptResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+created.Data.ID+"/threads/thread-idle/turns/interrupt",
		"",
	)

	if interruptResponse.Code != http.StatusAccepted {
		t.Fatalf("expected idempotent interrupt to return 202, got %d", interruptResponse.Code)
	}

	var payload struct {
		Data struct {
			TurnID string `json:"turnId"`
			Status string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, interruptResponse, &payload)

	if payload.Data.Status != "interrupted" {
		t.Fatalf("expected interrupted status, got %#v", payload.Data.Status)
	}
	if payload.Data.TurnID != "" {
		t.Fatalf("expected empty turn id for idle interrupt, got %#v", payload.Data.TurnID)
	}
}

func TestDeleteThreadRouteMarksThreadDeleted(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	threadID := "thr_test_delete_thread"
	dataStore.UpsertThread(store.Thread{
		ID:           threadID,
		WorkspaceID:  created.Data.ID,
		Cwd:          "E:/projects/ai/codex-server",
		Materialized: true,
		Name:         "Delete Thread",
		Status:       "idle",
	})

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/workspaces/"+created.Data.ID+"/threads/"+threadID,
		"",
	)

	if deleteResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from delete thread, got %d", deleteResponse.Code)
	}

	if _, ok := dataStore.GetThread(created.Data.ID, threadID); ok {
		t.Fatal("expected thread cache entry to be removed")
	}

	if !dataStore.IsThreadDeleted(created.Data.ID, threadID) {
		t.Fatal("expected thread to be marked deleted")
	}
}

func TestPluginRoutesValidateRequestBody(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	for _, path := range []string{
		"/api/workspaces/" + created.Data.ID + "/plugins/read",
		"/api/workspaces/" + created.Data.ID + "/plugins/install",
		"/api/workspaces/" + created.Data.ID + "/plugins/uninstall",
	} {
		response := performJSONRequest(t, router, http.MethodPost, path, `{`)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid body on %s, got %d", path, response.Code)
		}
	}
}

func TestConfigAndSearchRoutesValidateRequestBody(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces",
		`{"name":"Workspace A","rootPath":"E:/projects/ai/codex-server"}`,
	)

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	for _, path := range []string{
		"/api/workspaces/" + created.Data.ID + "/account/login",
		"/api/workspaces/" + created.Data.ID + "/account/login/cancel",
		"/api/workspaces/" + created.Data.ID + "/config/read",
		"/api/workspaces/" + created.Data.ID + "/config/write",
		"/api/workspaces/" + created.Data.ID + "/config/batch-write",
		"/api/workspaces/" + created.Data.ID + "/external-agent/detect",
		"/api/workspaces/" + created.Data.ID + "/external-agent/import",
		"/api/workspaces/" + created.Data.ID + "/skills/config/write",
		"/api/workspaces/" + created.Data.ID + "/search/files",
		"/api/workspaces/" + created.Data.ID + "/feedback/upload",
		"/api/workspaces/" + created.Data.ID + "/mcp/oauth/login",
		"/api/workspaces/" + created.Data.ID + "/windows-sandbox/setup-start",
	} {
		response := performJSONRequest(t, router, http.MethodPost, path, `{`)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid body on %s, got %d", path, response.Code)
		}
	}

	for _, path := range []string{
		"/api/workspaces/" + created.Data.ID + "/skills/remote/list",
		"/api/workspaces/" + created.Data.ID + "/skills/remote/export",
	} {
		response := performJSONRequest(t, router, http.MethodPost, path, `{}`)
		if response.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for removed route %s, got %d", path, response.Code)
		}
	}

	reloadResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+created.Data.ID+"/config/mcp-server/reload",
		"",
	)
	if reloadResponse.Code != http.StatusAccepted && reloadResponse.Code != http.StatusBadGateway {
		t.Fatalf("expected config MCP reload route to be wired, got %d", reloadResponse.Code)
	}

	requirementsResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+created.Data.ID+"/config/requirements",
		"",
	)
	if requirementsResponse.Code != http.StatusBadGateway && requirementsResponse.Code != http.StatusOK {
		t.Fatalf("expected config requirements route to be wired, got %d", requirementsResponse.Code)
	}

	for _, path := range []string{
		"/api/workspaces/" + created.Data.ID + "/experimental-features",
		"/api/workspaces/" + created.Data.ID + "/mcp-server-status",
		"/api/workspaces/" + created.Data.ID + "/threads/loaded",
	} {
		response := performJSONRequest(t, router, http.MethodGet, path, "")
		if response.Code != http.StatusBadGateway && response.Code != http.StatusOK {
			t.Fatalf("expected GET route %s to be wired, got %d", path, response.Code)
		}
	}
}

func TestCORSAllowsLoopbackFrontendPortFallback(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	request := httptest.NewRequest(http.MethodOptions, "/api/workspaces", nil)
	request.Header.Set("Origin", "http://localhost:15174")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	request.Header.Set("Access-Control-Request-Headers", "Content-Type")

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:15174" {
		t.Fatalf("expected Access-Control-Allow-Origin header to echo localhost:15174, got %q", got)
	}

	if got := recorder.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("expected Access-Control-Allow-Credentials=true, got %q", got)
	}
}

func TestCORSAllowsBindAllFrontendOriginFallback(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", eventHub)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	botService := bots.NewService(dataStore, threadService, turnService, eventHub, bots.Config{})

	router := NewRouter(Dependencies{
		FrontendOrigin: "http://0.0.0.0:15173",
		Auth:           auth.NewService(dataStore, runtimeManager),
		Workspaces:     workspace.NewService(dataStore, runtimeManager),
		Bots:           botService,
		Automations:    automations.NewService(dataStore, threadService, turnService, eventHub),
		Notifications:  notifications.NewService(dataStore),
		Threads:        threadService,
		Turns:          turnService,
		Approvals:      approvals.NewService(runtimeManager),
		Catalog:        catalog.NewService(runtimeManager),
		ConfigFS:       configfs.NewService(runtimeManager),
		ExecFS:         execfs.NewService(runtimeManager, eventHub, dataStore),
		Feedback:       feedback.NewService(runtimeManager),
		Events:         eventHub,
	})

	request := httptest.NewRequest(http.MethodOptions, "/api/workspaces", nil)
	request.Header.Set("Origin", "http://192.168.1.20:15173")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	request.Header.Set("Access-Control-Request-Headers", "Content-Type")

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "http://192.168.1.20:15173" {
		t.Fatalf("expected Access-Control-Allow-Origin header to echo LAN origin, got %q", got)
	}
}

func TestWriteStoreErrorMapsAuthenticationFailures(t *testing.T) {
	t.Parallel()

	server := &Server{}
	recorder := httptest.NewRecorder()

	server.writeStoreError(
		recorder,
		errors.New(`json-rpc error -32000: unexpected status 401 Unauthorized: {"code":"INVALID_API_KEY","message":"API Key invalid"}`),
	)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for authentication failure, got %d", recorder.Code)
	}

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeResponseBody(t, recorder, &payload)

	if payload.Error.Code != "requires_openai_auth" {
		t.Fatalf("expected requires_openai_auth error code, got %q", payload.Error.Code)
	}
}

func newTestRouter(dataStore *store.MemoryStore) http.Handler {
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", eventHub)
	runtimePrefsService := runtimeprefs.NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		false,
		"",
		"",
	)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	botService := bots.NewService(dataStore, threadService, turnService, eventHub, bots.Config{})
	automationService := automations.NewService(dataStore, threadService, turnService, eventHub)
	notificationsService := notifications.NewService(dataStore)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub, dataStore)

	return NewRouter(Dependencies{
		FrontendOrigin: "http://localhost:15173",
		Auth:           authService,
		Workspaces:     workspaceService,
		Bots:           botService,
		Automations:    automationService,
		Notifications:  notificationsService,
		Threads:        threadService,
		Turns:          turnService,
		Approvals:      approvalsService,
		Catalog:        catalog.NewService(runtimeManager, runtimePrefsService),
		ConfigFS:       configFSService,
		ExecFS:         execfsService,
		Feedback:       feedbackService,
		Events:         eventHub,
		RuntimePrefs:   runtimePrefsService,
	})
}

func performJSONRequest(t *testing.T, handler http.Handler, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func decodeResponseBody(t *testing.T, recorder *httptest.ResponseRecorder, target any) {
	t.Helper()

	if err := json.NewDecoder(recorder.Body).Decode(target); err != nil {
		t.Fatalf("decode response body error = %v", err)
	}
}

type routerTestBotProvider struct {
	sentCh chan routerTestBotSentPayload
}

type routerTestBotSentPayload struct {
	Messages []bots.OutboundMessage
}

func newRouterTestBotProvider() *routerTestBotProvider {
	return &routerTestBotProvider{
		sentCh: make(chan routerTestBotSentPayload, 8),
	}
}

func (p *routerTestBotProvider) Name() string {
	return "fakechat"
}

func (p *routerTestBotProvider) Activate(_ context.Context, connection store.BotConnection, publicBaseURL string) (bots.ActivationResult, error) {
	return bots.ActivationResult{
		Settings: map[string]string{
			"webhook_url": strings.TrimRight(publicBaseURL, "/") + "/hooks/bots/" + connection.ID,
		},
		Secrets: map[string]string{
			"webhook_secret": "fake-secret",
		},
	}, nil
}

func (p *routerTestBotProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *routerTestBotProvider) ParseWebhook(r *http.Request, _ store.BotConnection) ([]bots.InboundMessage, error) {
	if strings.TrimSpace(r.Header.Get("X-Test-Secret")) != "fake-secret" {
		return nil, bots.ErrWebhookUnauthorized
	}

	var payload bots.InboundMessage
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		return nil, err
	}

	return []bots.InboundMessage{payload}, nil
}

func (p *routerTestBotProvider) SendMessages(_ context.Context, _ store.BotConnection, _ store.BotConversation, messages []bots.OutboundMessage) error {
	p.sentCh <- routerTestBotSentPayload{
		Messages: append([]bots.OutboundMessage(nil), messages...),
	}
	return nil
}

type routerTestAIBackend struct{}

func (routerTestAIBackend) Name() string {
	return "fake_ai"
}

func (routerTestAIBackend) ProcessMessage(_ context.Context, _ store.BotConnection, _ store.BotConversation, inbound bots.InboundMessage) (bots.AIResult, error) {
	return bots.AIResult{
		ThreadID: "thr_route_" + inbound.ConversationID,
		Messages: []bots.OutboundMessage{
			{Text: "route reply: " + inbound.Text},
		},
	}, nil
}
