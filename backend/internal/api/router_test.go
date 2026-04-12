package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/accesscontrol"
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
	"codex-server/backend/internal/hooks"
	"codex-server/backend/internal/memorydiag"
	"codex-server/backend/internal/notifications"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/runtimeprefs"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/testutil/codexfake"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turnpolicies"
	"codex-server/backend/internal/turns"
	"codex-server/backend/internal/workspace"

	"github.com/go-chi/chi/v5"
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

func TestStopServerRouteRequestsShutdown(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	var shutdownReason string
	router := newTestRouterWithShutdown(dataStore, func(reason string) bool {
		shutdownReason = reason
		return true
	})

	request := httptest.NewRequest(http.MethodPost, "/__admin/stop", nil)
	request.Header.Set("X-Codex-Server-Action", "stop")
	request.RemoteAddr = "127.0.0.1:48321"

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from stop route, got %d", recorder.Code)
	}

	if shutdownReason != "http-stop" {
		t.Fatalf("expected shutdown reason %q, got %q", "http-stop", shutdownReason)
	}
}

func TestStopServerRouteRejectsNonLoopbackRequests(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	shutdownCalled := false
	router := newTestRouterWithShutdown(dataStore, func(reason string) bool {
		shutdownCalled = true
		return true
	})

	request := httptest.NewRequest(http.MethodPost, "/__admin/stop", nil)
	request.Header.Set("X-Codex-Server-Action", "stop")
	request.RemoteAddr = "192.168.1.20:48321"

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403 from stop route, got %d", recorder.Code)
	}

	if shutdownCalled {
		t.Fatal("expected shutdown callback not to be called for non-loopback request")
	}
}

func TestProtectedRoutesRequireAccessLoginWhenTokensConfigured(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	tokens, err := accesscontrol.ApplyTokenInputs(nil, []accesscontrol.TokenInput{
		{
			Label:     "Primary",
			Token:     "super-secret-token",
			Permanent: true,
		},
	}, time.Now().UTC())
	if err != nil {
		t.Fatalf("ApplyTokenInputs() error = %v", err)
	}
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		AccessTokens: tokens,
	})

	router := newTestRouter(dataStore)

	protectedRequest := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	protectedRequest.RemoteAddr = "192.168.1.20:41000"
	protectedRecorder := httptest.NewRecorder()
	router.ServeHTTP(protectedRecorder, protectedRequest)

	if protectedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 from protected route without session, got %d", protectedRecorder.Code)
	}

	var unauthorizedPayload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeResponseBody(t, protectedRecorder, &unauthorizedPayload)
	if unauthorizedPayload.Error.Code != "access_login_required" {
		t.Fatalf("expected access_login_required, got %q", unauthorizedPayload.Error.Code)
	}

	loginRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/access/login",
		strings.NewReader(`{"token":"super-secret-token"}`),
	)
	loginRequest.RemoteAddr = "192.168.1.20:41000"
	loginRequest.Header.Set("Content-Type", "application/json")
	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, loginRequest)

	if loginRecorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from access login, got %d", loginRecorder.Code)
	}

	cookies := loginRecorder.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected access login to set a session cookie")
	}

	authorizedRequest := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	authorizedRequest.RemoteAddr = "192.168.1.20:41000"
	authorizedRequest.AddCookie(cookies[0])
	authorizedRecorder := httptest.NewRecorder()
	router.ServeHTTP(authorizedRecorder, authorizedRequest)

	if authorizedRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 from protected route with session, got %d", authorizedRecorder.Code)
	}
}

func TestLoopbackRequestsCanBypassAccessLoginWhenConfigured(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	tokens, err := accesscontrol.ApplyTokenInputs(nil, []accesscontrol.TokenInput{
		{
			Label:     "Primary",
			Token:     "super-secret-token",
			Permanent: true,
		},
	}, time.Now().UTC())
	if err != nil {
		t.Fatalf("ApplyTokenInputs() error = %v", err)
	}
	enabled := true
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		AllowLocalhostWithoutAccessToken: &enabled,
		AccessTokens:                     tokens,
	})

	router := newTestRouter(dataStore)

	loopbackBootstrapRequest := httptest.NewRequest(http.MethodGet, "/api/access/bootstrap", nil)
	loopbackBootstrapRequest.RemoteAddr = "127.0.0.1:41000"
	loopbackBootstrapRecorder := httptest.NewRecorder()
	router.ServeHTTP(loopbackBootstrapRecorder, loopbackBootstrapRequest)

	if loopbackBootstrapRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 from loopback bootstrap with localhost bypass enabled, got %d", loopbackBootstrapRecorder.Code)
	}

	var loopbackBootstrapPayload struct {
		Data struct {
			Authenticated                    bool `json:"authenticated"`
			LoginRequired                    bool `json:"loginRequired"`
			AllowLocalhostWithoutAccessToken bool `json:"allowLocalhostWithoutAccessToken"`
		} `json:"data"`
	}
	decodeResponseBody(t, loopbackBootstrapRecorder, &loopbackBootstrapPayload)
	if !loopbackBootstrapPayload.Data.Authenticated || loopbackBootstrapPayload.Data.LoginRequired {
		t.Fatalf("expected loopback bootstrap to bypass login, got %#v", loopbackBootstrapPayload.Data)
	}
	if !loopbackBootstrapPayload.Data.AllowLocalhostWithoutAccessToken {
		t.Fatalf("expected loopback bootstrap to expose localhost bypass state, got %#v", loopbackBootstrapPayload.Data)
	}

	loopbackProtectedRequest := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	loopbackProtectedRequest.RemoteAddr = "127.0.0.1:41000"
	loopbackProtectedRecorder := httptest.NewRecorder()
	router.ServeHTTP(loopbackProtectedRecorder, loopbackProtectedRequest)

	if loopbackProtectedRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 from loopback protected route without session, got %d", loopbackProtectedRecorder.Code)
	}

	remoteProtectedRequest := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	remoteProtectedRequest.RemoteAddr = "192.168.1.20:41000"
	remoteProtectedRecorder := httptest.NewRecorder()
	router.ServeHTTP(remoteProtectedRecorder, remoteProtectedRequest)

	if remoteProtectedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 from remote protected route without session, got %d", remoteProtectedRecorder.Code)
	}

	var remoteUnauthorizedPayload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeResponseBody(t, remoteProtectedRecorder, &remoteUnauthorizedPayload)
	if remoteUnauthorizedPayload.Error.Code != "access_login_required" {
		t.Fatalf("expected access_login_required for remote request, got %q", remoteUnauthorizedPayload.Error.Code)
	}
}

func TestRemoteRequestsRequireLocalBootstrapWhenNoActiveTokensExist(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)

	loopbackRequest := httptest.NewRequest(http.MethodGet, "/api/access/bootstrap", nil)
	loopbackRequest.RemoteAddr = "127.0.0.1:41000"
	loopbackRecorder := httptest.NewRecorder()
	router.ServeHTTP(loopbackRecorder, loopbackRequest)

	if loopbackRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 from loopback bootstrap without tokens, got %d", loopbackRecorder.Code)
	}

	var loopbackPayload struct {
		Data struct {
			LoginRequired        bool `json:"loginRequired"`
			ConfiguredTokenCount int  `json:"configuredTokenCount"`
			ActiveTokenCount     int  `json:"activeTokenCount"`
		} `json:"data"`
	}
	decodeResponseBody(t, loopbackRecorder, &loopbackPayload)
	if loopbackPayload.Data.LoginRequired {
		t.Fatal("expected loopback bootstrap to remain unlocked without tokens")
	}
	if loopbackPayload.Data.ConfiguredTokenCount != 0 || loopbackPayload.Data.ActiveTokenCount != 0 {
		t.Fatalf("expected zero configured/active tokens, got %#v", loopbackPayload.Data)
	}

	remoteRequest := httptest.NewRequest(http.MethodGet, "/api/access/bootstrap", nil)
	remoteRequest.RemoteAddr = "192.168.1.20:48000"
	remoteRecorder := httptest.NewRecorder()
	router.ServeHTTP(remoteRecorder, remoteRequest)

	if remoteRecorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when remote bootstrap has no active tokens available, got %d", remoteRecorder.Code)
	}

	var remotePayload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeResponseBody(t, remoteRecorder, &remotePayload)
	if remotePayload.Error.Code != "remote_access_requires_active_token" {
		t.Fatalf("expected remote_access_requires_active_token, got %q", remotePayload.Error.Code)
	}
}

func TestRemoteAccessDisabledRejectsNonLoopbackRequests(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	disabled := false
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		AllowRemoteAccess: &disabled,
	})

	router := newTestRouter(dataStore)
	request := httptest.NewRequest(http.MethodGet, "/api/access/bootstrap", nil)
	request.RemoteAddr = "192.168.1.20:48000"

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when remote access is disabled, got %d", recorder.Code)
	}

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeResponseBody(t, recorder, &payload)
	if payload.Error.Code != "remote_access_disabled" {
		t.Fatalf("expected remote_access_disabled, got %q", payload.Error.Code)
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

func TestTurnPolicyDecisionRouteSupportsMultiConditionFiltersAndLimit(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	firstTS := time.Date(2026, time.April, 8, 14, 0, 0, 0, time.UTC)
	_, err = dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          "posttooluse/failed-validation-command",
		Fingerprint:         "fp-1",
		Verdict:             "steer",
		Action:              "steer",
		ActionStatus:        "succeeded",
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: firstTS,
		DecisionAt:          firstTS.Add(100 * time.Millisecond),
		CompletedAt:         firstTS.Add(200 * time.Millisecond),
	})
	if err != nil {
		t.Fatalf("CreateTurnPolicyDecision(first) error = %v", err)
	}
	secondTS := firstTS.Add(1 * time.Minute)
	second, err := dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          "stop/missing-successful-verification",
		Fingerprint:         "fp-2",
		Verdict:             "followUp",
		Action:              "followUp",
		ActionStatus:        "succeeded",
		Reason:              "file_changes_missing_successful_verification",
		Source:              "automation",
		EvaluationStartedAt: secondTS,
		DecisionAt:          secondTS.Add(100 * time.Millisecond),
		CompletedAt:         secondTS.Add(200 * time.Millisecond),
	})
	if err != nil {
		t.Fatalf("CreateTurnPolicyDecision(second) error = %v", err)
	}
	_, err = dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-2",
		TurnID:              "turn-3",
		TriggerMethod:       "item/completed",
		PolicyName:          "posttooluse/failed-validation-command",
		Fingerprint:         "fp-3",
		Verdict:             "steer",
		Action:              "steer",
		ActionStatus:        "succeeded",
		Reason:              "validation_command_failed",
		Source:              "bot",
		EvaluationStartedAt: secondTS.Add(1 * time.Minute),
		DecisionAt:          secondTS.Add(1*time.Minute + 100*time.Millisecond),
		CompletedAt:         secondTS.Add(1*time.Minute + 200*time.Millisecond),
	})
	if err != nil {
		t.Fatalf("CreateTurnPolicyDecision(third) error = %v", err)
	}

	router := newTestRouter(dataStore)

	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+
			"/turn-policy-decisions?threadId=%20thread-1%20&policyName=%20stop%2Fmissing-successful-verification%20"+
			"&action=%20followUp%20&actionStatus=%20succeeded%20&triggerMethod=%20turn%2Fcompleted%20&limit=1",
		"",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from turn policy decisions route, got %d", response.Code)
	}

	var payload struct {
		Data []struct {
			ID         string `json:"id"`
			ThreadID   string `json:"threadId"`
			PolicyName string `json:"policyName"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)
	if len(payload.Data) != 1 {
		t.Fatalf("expected 1 filtered decision, got %#v", payload.Data)
	}
	if payload.Data[0].ID != second.ID {
		t.Fatalf("expected filtered decision id %q, got %#v", second.ID, payload.Data)
	}
	if payload.Data[0].ThreadID != "thread-1" {
		t.Fatalf("expected thread filter to keep thread-1, got %#v", payload.Data[0])
	}
	if payload.Data[0].PolicyName != "stop/missing-successful-verification" {
		t.Fatalf("expected policy filter to keep stop policy, got %#v", payload.Data[0])
	}
}

func TestTurnPolicyDecisionRouteSupportsSourceFilter(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	base := time.Date(2026, time.April, 8, 15, 0, 0, 0, time.UTC)
	for index, source := range []string{"interactive", "automation", "bot"} {
		_, err = dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
			WorkspaceID:         workspace.ID,
			ThreadID:            fmt.Sprintf("thread-%d", index+1),
			TurnID:              fmt.Sprintf("turn-%d", index+1),
			TriggerMethod:       "item/completed",
			PolicyName:          "posttooluse/failed-validation-command",
			Fingerprint:         fmt.Sprintf("fp-%d", index+1),
			Verdict:             "steer",
			Action:              "steer",
			ActionStatus:        "succeeded",
			Reason:              "validation_command_failed",
			Source:              source,
			EvaluationStartedAt: base.Add(time.Duration(index) * time.Minute),
			DecisionAt:          base.Add(time.Duration(index)*time.Minute + 100*time.Millisecond),
			CompletedAt:         base.Add(time.Duration(index)*time.Minute + 200*time.Millisecond),
		})
		if err != nil {
			t.Fatalf("CreateTurnPolicyDecision(%s) error = %v", source, err)
		}
	}

	router := newTestRouter(dataStore)

	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-decisions?source=%20automation%20",
		"",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from turn policy decisions source filter route, got %d", response.Code)
	}

	var payload struct {
		Data []struct {
			Source string `json:"source"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)
	if len(payload.Data) != 1 {
		t.Fatalf("expected 1 source-filtered decision, got %#v", payload.Data)
	}
	if payload.Data[0].Source != "automation" {
		t.Fatalf("expected automation source, got %#v", payload.Data[0])
	}
}

func TestTurnPolicyDecisionRouteSupportsReasonFilter(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	base := time.Date(2026, time.April, 8, 15, 30, 0, 0, time.UTC)
	for index, reason := range []string{"duplicate_fingerprint", "follow_up_cooldown_active"} {
		_, err = dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
			WorkspaceID:         workspace.ID,
			ThreadID:            fmt.Sprintf("thread-%d", index+1),
			TurnID:              fmt.Sprintf("turn-%d", index+1),
			TriggerMethod:       "turn/completed",
			PolicyName:          "stop/missing-successful-verification",
			Fingerprint:         fmt.Sprintf("fp-reason-%d", index+1),
			Verdict:             "followUp",
			Action:              "none",
			ActionStatus:        "skipped",
			Reason:              reason,
			Source:              "interactive",
			EvaluationStartedAt: base.Add(time.Duration(index) * time.Minute),
			DecisionAt:          base.Add(time.Duration(index)*time.Minute + 100*time.Millisecond),
			CompletedAt:         base.Add(time.Duration(index)*time.Minute + 200*time.Millisecond),
		})
		if err != nil {
			t.Fatalf("CreateTurnPolicyDecision(%s) error = %v", reason, err)
		}
	}

	router := newTestRouter(dataStore)

	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-decisions?reason=%20duplicate_fingerprint%20",
		"",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from turn policy decisions reason filter route, got %d", response.Code)
	}

	var payload struct {
		Data []struct {
			Reason string `json:"reason"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)
	if len(payload.Data) != 1 {
		t.Fatalf("expected 1 reason-filtered decision, got %#v", payload.Data)
	}
	if payload.Data[0].Reason != "duplicate_fingerprint" {
		t.Fatalf("expected duplicate_fingerprint reason, got %#v", payload.Data[0])
	}
}

func TestTurnPolicyDecisionRouteReturnsEmptyArrayWhenFiltersDoNotMatch(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	_, err = dataStore.CreateTurnPolicyDecision(store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          "posttooluse/failed-validation-command",
		Fingerprint:         "fp-1",
		Verdict:             "steer",
		Action:              "steer",
		ActionStatus:        "succeeded",
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: time.Date(2026, time.April, 8, 16, 0, 0, 0, time.UTC),
		DecisionAt:          time.Date(2026, time.April, 8, 16, 0, 0, 0, time.UTC).Add(100 * time.Millisecond),
		CompletedAt:         time.Date(2026, time.April, 8, 16, 0, 0, 0, time.UTC).Add(200 * time.Millisecond),
	})
	if err != nil {
		t.Fatalf("CreateTurnPolicyDecision() error = %v", err)
	}

	router := newTestRouter(dataStore)

	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-decisions?action=followUp&source=bot",
		"",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from unmatched turn policy decisions route, got %d", response.Code)
	}

	var payload struct {
		Data []struct{} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)
	if len(payload.Data) != 0 {
		t.Fatalf("expected no filtered decisions, got %#v", payload.Data)
	}
}

func TestTurnPolicyDecisionRouteRejectsInvalidLimit(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	router := newTestRouter(dataStore)

	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-decisions?limit=abc",
		"",
	)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 from invalid limit route, got %d", response.Code)
	}
}

func TestTurnPolicyMetricsRouteReturnsWorkspaceSummaryAndSupportsThreadFilter(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedRouterMetricsThreadProjection(dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				routerCommandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				routerFileChangeItem("patch-1", "backend/internal/turnpolicies/service.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
		{
			ID:     "turn-3",
			Status: "completed",
			Items: []map[string]any{
				routerFileChangeItem("patch-2", "backend/internal/api/router.go"),
				routerCommandExecutionItem("cmd-2", "go test ./internal/api", "completed", 0),
			},
		},
	})
	seedRouterMetricsThreadProjection(dataStore, workspace.ID, "thread-2", []store.ThreadTurn{
		{
			ID:     "turn-4",
			Status: "completed",
			Items: []map[string]any{
				routerFileChangeItem("patch-3", "backend/internal/store/memory.go"),
				{"id": "msg-2", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Second)
	mustCreateRouterMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          "posttooluse/failed-validation-command",
		Fingerprint:         "fp-1",
		Verdict:             "steer",
		Action:              "steer",
		ActionStatus:        "succeeded",
		Reason:              "validation_command_failed",
		Source:              "interactive",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(100 * time.Millisecond),
		CompletedAt:         base.Add(200 * time.Millisecond),
	})
	mustCreateRouterMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          "posttooluse/failed-validation-command",
		Fingerprint:         "fp-1",
		Verdict:             "steer",
		Action:              "none",
		ActionStatus:        "skipped",
		Reason:              "duplicate_fingerprint",
		Source:              "interactive",
		EvaluationStartedAt: base.Add(1 * time.Minute),
		DecisionAt:          base.Add(1*time.Minute + 250*time.Millisecond),
		CompletedAt:         base.Add(1*time.Minute + 350*time.Millisecond),
	})
	mustCreateRouterMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          "stop/missing-successful-verification",
		Fingerprint:         "fp-2",
		Verdict:             "followUp",
		Action:              "followUp",
		ActionStatus:        "succeeded",
		Reason:              "file_changes_missing_successful_verification",
		Source:              "automation",
		EvaluationStartedAt: base.Add(2 * time.Minute),
		DecisionAt:          base.Add(2*time.Minute + 300*time.Millisecond),
		CompletedAt:         base.Add(2*time.Minute + 400*time.Millisecond),
	})
	mustCreateRouterMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-2",
		TriggerMethod:       "turn/completed",
		PolicyName:          "stop/missing-successful-verification",
		Fingerprint:         "fp-3",
		Verdict:             "followUp",
		Action:              "none",
		ActionStatus:        "skipped",
		Reason:              "follow_up_cooldown_active",
		Source:              "bot",
		EvaluationStartedAt: base.Add(3 * time.Minute),
		DecisionAt:          base.Add(3*time.Minute + 500*time.Millisecond),
		CompletedAt:         base.Add(3*time.Minute + 600*time.Millisecond),
	})
	mustCreateRouterMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-2",
		TurnID:              "turn-4",
		TriggerMethod:       "turn/completed",
		PolicyName:          "stop/missing-successful-verification",
		Fingerprint:         "fp-4",
		Verdict:             "followUp",
		Action:              "followUp",
		ActionStatus:        "succeeded",
		Reason:              "file_changes_missing_successful_verification",
		Source:              "",
		EvaluationStartedAt: base.Add(4 * time.Minute),
		DecisionAt:          base.Add(4*time.Minute + 900*time.Millisecond),
		CompletedAt:         base.Add(4*time.Minute + 1000*time.Millisecond),
	})

	router := newTestRouter(dataStore)

	workspaceResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-metrics",
		"",
	)
	if workspaceResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from workspace turn policy metrics route, got %d", workspaceResponse.Code)
	}

	var workspacePayload struct {
		Data struct {
			WorkspaceID string `json:"workspaceId"`
			ThreadID    string `json:"threadId"`
			Source      string `json:"source"`
			AlertPolicy struct {
				SuppressedCodes []string `json:"suppressedCodes"`
				SuppressedCount int      `json:"suppressedCount"`
			} `json:"alertPolicy"`
			Alerts []struct {
				Code string `json:"code"`
				Rank int    `json:"rank"`
			} `json:"alerts"`
			RecentWindows struct {
				LastHour struct {
					AlertsCount int `json:"alertsCount"`
					Decisions   struct {
						Total             int     `json:"total"`
						ActionAttempts    int     `json:"actionAttempts"`
						ActionSucceeded   int     `json:"actionSucceeded"`
						ActionSuccessRate float64 `json:"actionSuccessRate"`
						Skipped           int     `json:"skipped"`
					} `json:"decisions"`
					Timings struct {
						PostToolUseDecisionLatency struct {
							P95Ms int64 `json:"p95Ms"`
						} `json:"postToolUseDecisionLatency"`
						StopDecisionLatency struct {
							P95Ms int64 `json:"p95Ms"`
						} `json:"stopDecisionLatency"`
					} `json:"timings"`
				} `json:"lastHour"`
				Last24Hours struct {
					AlertsCount int `json:"alertsCount"`
					Decisions   struct {
						Total int `json:"total"`
					} `json:"decisions"`
				} `json:"last24Hours"`
			} `json:"recentWindows"`
			Decisions struct {
				Total              int     `json:"total"`
				ActionAttempts     int     `json:"actionAttempts"`
				ActionSucceeded    int     `json:"actionSucceeded"`
				ActionSuccessRate  float64 `json:"actionSuccessRate"`
				ActionStatusCounts struct {
					Succeeded int `json:"succeeded"`
					Skipped   int `json:"skipped"`
				} `json:"actionStatusCounts"`
				ActionCounts struct {
					Steer    int `json:"steer"`
					FollowUp int `json:"followUp"`
					None     int `json:"none"`
				} `json:"actionCounts"`
				SkipReasonCounts struct {
					Total                  int `json:"total"`
					DuplicateFingerprint   int `json:"duplicateFingerprint"`
					FollowUpCooldownActive int `json:"followUpCooldownActive"`
				} `json:"skipReasonCounts"`
			} `json:"decisions"`
			Sources struct {
				Interactive struct {
					Total             int     `json:"total"`
					ActionAttempts    int     `json:"actionAttempts"`
					ActionSucceeded   int     `json:"actionSucceeded"`
					ActionSuccessRate float64 `json:"actionSuccessRate"`
					Skipped           int     `json:"skipped"`
				} `json:"interactive"`
				Automation struct {
					Total             int     `json:"total"`
					ActionAttempts    int     `json:"actionAttempts"`
					ActionSucceeded   int     `json:"actionSucceeded"`
					ActionSuccessRate float64 `json:"actionSuccessRate"`
					Skipped           int     `json:"skipped"`
				} `json:"automation"`
				Bot struct {
					Total             int     `json:"total"`
					ActionAttempts    int     `json:"actionAttempts"`
					ActionSucceeded   int     `json:"actionSucceeded"`
					ActionSuccessRate float64 `json:"actionSuccessRate"`
					Skipped           int     `json:"skipped"`
				} `json:"bot"`
				Other struct {
					Total             int     `json:"total"`
					ActionAttempts    int     `json:"actionAttempts"`
					ActionSucceeded   int     `json:"actionSucceeded"`
					ActionSuccessRate float64 `json:"actionSuccessRate"`
					Skipped           int     `json:"skipped"`
				} `json:"other"`
			} `json:"sources"`
			Timings struct {
				PostToolUseDecisionLatency struct {
					P50Ms int64 `json:"p50Ms"`
					P95Ms int64 `json:"p95Ms"`
				} `json:"postToolUseDecisionLatency"`
				StopDecisionLatency struct {
					P50Ms int64 `json:"p50Ms"`
					P95Ms int64 `json:"p95Ms"`
				} `json:"stopDecisionLatency"`
			} `json:"timings"`
			Turns struct {
				CompletedWithFileChange              int     `json:"completedWithFileChange"`
				MissingSuccessfulVerification        int     `json:"missingSuccessfulVerification"`
				MissingSuccessfulVerificationRate    float64 `json:"missingSuccessfulVerificationRate"`
				FailedValidationCommand              int     `json:"failedValidationCommand"`
				FailedValidationWithPolicyAction     int     `json:"failedValidationWithPolicyAction"`
				FailedValidationWithPolicyActionRate float64 `json:"failedValidationWithPolicyActionRate"`
			} `json:"turns"`
			Audit struct {
				CoveredTurns  int     `json:"coveredTurns"`
				EligibleTurns int     `json:"eligibleTurns"`
				CoverageRate  float64 `json:"coverageRate"`
			} `json:"audit"`
		} `json:"data"`
	}
	decodeResponseBody(t, workspaceResponse, &workspacePayload)

	if workspacePayload.Data.WorkspaceID != workspace.ID ||
		workspacePayload.Data.ThreadID != "" ||
		workspacePayload.Data.Source != "" {
		t.Fatalf("unexpected workspace metrics scope %#v", workspacePayload.Data)
	}
	if len(workspacePayload.Data.AlertPolicy.SuppressedCodes) != 0 ||
		workspacePayload.Data.AlertPolicy.SuppressedCount != 0 {
		t.Fatalf("unexpected workspace alert policy %#v", workspacePayload.Data.AlertPolicy)
	}
	if workspacePayload.Data.Decisions.Total != 5 ||
		workspacePayload.Data.Decisions.ActionStatusCounts.Succeeded != 3 ||
		workspacePayload.Data.Decisions.ActionStatusCounts.Skipped != 2 {
		t.Fatalf("unexpected workspace decision summary %#v", workspacePayload.Data.Decisions)
	}
	if workspacePayload.Data.Decisions.ActionCounts.Steer != 1 ||
		workspacePayload.Data.Decisions.ActionCounts.FollowUp != 2 ||
		workspacePayload.Data.Decisions.ActionCounts.None != 2 {
		t.Fatalf("unexpected workspace action counts %#v", workspacePayload.Data.Decisions.ActionCounts)
	}
	if workspacePayload.Data.Decisions.ActionAttempts != 3 ||
		workspacePayload.Data.Decisions.ActionSucceeded != 3 ||
		workspacePayload.Data.Decisions.ActionSuccessRate != 1 {
		t.Fatalf("unexpected workspace action attempt metrics %#v", workspacePayload.Data.Decisions)
	}
	if workspacePayload.Data.Decisions.SkipReasonCounts.Total != 2 ||
		workspacePayload.Data.Decisions.SkipReasonCounts.DuplicateFingerprint != 1 ||
		workspacePayload.Data.Decisions.SkipReasonCounts.FollowUpCooldownActive != 1 {
		t.Fatalf("unexpected workspace skip counts %#v", workspacePayload.Data.Decisions.SkipReasonCounts)
	}
	if len(workspacePayload.Data.Alerts) != 2 ||
		workspacePayload.Data.Alerts[0].Code != "cooldown_skips_detected" ||
		workspacePayload.Data.Alerts[0].Rank != 1 ||
		workspacePayload.Data.Alerts[1].Code != "duplicate_skips_detected" ||
		workspacePayload.Data.Alerts[1].Rank != 2 {
		t.Fatalf("unexpected workspace alerts %#v", workspacePayload.Data.Alerts)
	}
	if workspacePayload.Data.RecentWindows.LastHour.Decisions.Total != 5 ||
		workspacePayload.Data.RecentWindows.LastHour.Decisions.ActionAttempts != 3 ||
		workspacePayload.Data.RecentWindows.LastHour.Decisions.ActionSucceeded != 3 ||
		workspacePayload.Data.RecentWindows.LastHour.Decisions.ActionSuccessRate != 1 ||
		workspacePayload.Data.RecentWindows.LastHour.Decisions.Skipped != 2 ||
		workspacePayload.Data.RecentWindows.LastHour.AlertsCount != 2 ||
		workspacePayload.Data.RecentWindows.LastHour.Timings.PostToolUseDecisionLatency.P95Ms != 250 ||
		workspacePayload.Data.RecentWindows.LastHour.Timings.StopDecisionLatency.P95Ms != 900 {
		t.Fatalf("unexpected workspace recent windows %#v", workspacePayload.Data.RecentWindows)
	}
	if workspacePayload.Data.RecentWindows.Last24Hours.Decisions.Total != 5 ||
		workspacePayload.Data.RecentWindows.Last24Hours.AlertsCount != 2 {
		t.Fatalf("unexpected workspace 24h recent window %#v", workspacePayload.Data.RecentWindows.Last24Hours)
	}
	if workspacePayload.Data.Sources.Interactive.Total != 2 ||
		workspacePayload.Data.Sources.Interactive.ActionAttempts != 1 ||
		workspacePayload.Data.Sources.Interactive.ActionSucceeded != 1 ||
		workspacePayload.Data.Sources.Interactive.ActionSuccessRate != 1 ||
		workspacePayload.Data.Sources.Interactive.Skipped != 1 {
		t.Fatalf("unexpected interactive source summary %#v", workspacePayload.Data.Sources.Interactive)
	}
	if workspacePayload.Data.Sources.Automation.Total != 1 ||
		workspacePayload.Data.Sources.Automation.ActionAttempts != 1 ||
		workspacePayload.Data.Sources.Automation.ActionSucceeded != 1 ||
		workspacePayload.Data.Sources.Automation.ActionSuccessRate != 1 ||
		workspacePayload.Data.Sources.Automation.Skipped != 0 {
		t.Fatalf("unexpected automation source summary %#v", workspacePayload.Data.Sources.Automation)
	}
	if workspacePayload.Data.Sources.Bot.Total != 1 ||
		workspacePayload.Data.Sources.Bot.ActionAttempts != 0 ||
		workspacePayload.Data.Sources.Bot.ActionSucceeded != 0 ||
		workspacePayload.Data.Sources.Bot.ActionSuccessRate != 0 ||
		workspacePayload.Data.Sources.Bot.Skipped != 1 {
		t.Fatalf("unexpected bot source summary %#v", workspacePayload.Data.Sources.Bot)
	}
	if workspacePayload.Data.Sources.Other.Total != 1 ||
		workspacePayload.Data.Sources.Other.ActionAttempts != 1 ||
		workspacePayload.Data.Sources.Other.ActionSucceeded != 1 ||
		workspacePayload.Data.Sources.Other.ActionSuccessRate != 1 ||
		workspacePayload.Data.Sources.Other.Skipped != 0 {
		t.Fatalf("unexpected other source summary %#v", workspacePayload.Data.Sources.Other)
	}
	if workspacePayload.Data.Timings.PostToolUseDecisionLatency.P50Ms != 100 ||
		workspacePayload.Data.Timings.PostToolUseDecisionLatency.P95Ms != 250 ||
		workspacePayload.Data.Timings.StopDecisionLatency.P50Ms != 500 ||
		workspacePayload.Data.Timings.StopDecisionLatency.P95Ms != 900 {
		t.Fatalf("unexpected workspace timing summary %#v", workspacePayload.Data.Timings)
	}
	if workspacePayload.Data.Turns.CompletedWithFileChange != 3 ||
		workspacePayload.Data.Turns.MissingSuccessfulVerification != 2 ||
		workspacePayload.Data.Turns.MissingSuccessfulVerificationRate != 0.6667 ||
		workspacePayload.Data.Turns.FailedValidationCommand != 1 ||
		workspacePayload.Data.Turns.FailedValidationWithPolicyAction != 1 ||
		workspacePayload.Data.Turns.FailedValidationWithPolicyActionRate != 1 {
		t.Fatalf("unexpected workspace turn summary %#v", workspacePayload.Data.Turns)
	}
	if workspacePayload.Data.Audit.CoveredTurns != 3 ||
		workspacePayload.Data.Audit.EligibleTurns != 3 ||
		workspacePayload.Data.Audit.CoverageRate != 1 {
		t.Fatalf("unexpected workspace audit summary %#v", workspacePayload.Data.Audit)
	}

	threadResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-metrics?threadId=thread-1",
		"",
	)
	if threadResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from filtered turn policy metrics route, got %d", threadResponse.Code)
	}

	var threadPayload struct {
		Data struct {
			ThreadID string `json:"threadId"`
			Source   string `json:"source"`
			Alerts   []struct {
				Code string `json:"code"`
			} `json:"alerts"`
			Decisions struct {
				Total             int     `json:"total"`
				ActionAttempts    int     `json:"actionAttempts"`
				ActionSucceeded   int     `json:"actionSucceeded"`
				ActionSuccessRate float64 `json:"actionSuccessRate"`
			} `json:"decisions"`
			Sources struct {
				Interactive struct {
					Total             int     `json:"total"`
					ActionAttempts    int     `json:"actionAttempts"`
					ActionSucceeded   int     `json:"actionSucceeded"`
					ActionSuccessRate float64 `json:"actionSuccessRate"`
					Skipped           int     `json:"skipped"`
				} `json:"interactive"`
				Automation struct {
					Total int `json:"total"`
				} `json:"automation"`
				Bot struct {
					Total int `json:"total"`
				} `json:"bot"`
				Other struct {
					Total int `json:"total"`
				} `json:"other"`
			} `json:"sources"`
			Timings struct {
				PostToolUseDecisionLatency struct {
					P50Ms int64 `json:"p50Ms"`
					P95Ms int64 `json:"p95Ms"`
				} `json:"postToolUseDecisionLatency"`
				StopDecisionLatency struct {
					P50Ms int64 `json:"p50Ms"`
					P95Ms int64 `json:"p95Ms"`
				} `json:"stopDecisionLatency"`
			} `json:"timings"`
			Turns struct {
				CompletedWithFileChange           int     `json:"completedWithFileChange"`
				MissingSuccessfulVerification     int     `json:"missingSuccessfulVerification"`
				FailedValidationCommand           int     `json:"failedValidationCommand"`
				FailedValidationWithPolicyAction  int     `json:"failedValidationWithPolicyAction"`
				MissingSuccessfulVerificationRate float64 `json:"missingSuccessfulVerificationRate"`
			} `json:"turns"`
			Audit struct {
				CoveredTurns  int     `json:"coveredTurns"`
				EligibleTurns int     `json:"eligibleTurns"`
				CoverageRate  float64 `json:"coverageRate"`
			} `json:"audit"`
		} `json:"data"`
	}
	decodeResponseBody(t, threadResponse, &threadPayload)

	if threadPayload.Data.ThreadID != "thread-1" || threadPayload.Data.Source != "" {
		t.Fatalf("expected thread filter to be echoed, got %#v", threadPayload.Data)
	}
	if threadPayload.Data.Decisions.Total != 4 ||
		threadPayload.Data.Decisions.ActionAttempts != 2 ||
		threadPayload.Data.Decisions.ActionSucceeded != 2 ||
		threadPayload.Data.Decisions.ActionSuccessRate != 1 {
		t.Fatalf("expected 4 filtered decisions, got %#v", threadPayload.Data.Decisions)
	}
	if threadPayload.Data.Sources.Interactive.Total != 2 ||
		threadPayload.Data.Sources.Interactive.ActionAttempts != 1 ||
		threadPayload.Data.Sources.Interactive.ActionSucceeded != 1 ||
		threadPayload.Data.Sources.Interactive.ActionSuccessRate != 1 ||
		threadPayload.Data.Sources.Interactive.Skipped != 1 {
		t.Fatalf("unexpected filtered interactive source summary %#v", threadPayload.Data.Sources.Interactive)
	}
	if threadPayload.Data.Sources.Automation.Total != 1 ||
		threadPayload.Data.Sources.Bot.Total != 1 ||
		threadPayload.Data.Sources.Other.Total != 0 {
		t.Fatalf("unexpected filtered source buckets %#v", threadPayload.Data.Sources)
	}
	if len(threadPayload.Data.Alerts) != 2 ||
		threadPayload.Data.Alerts[0].Code != "cooldown_skips_detected" ||
		threadPayload.Data.Alerts[1].Code != "duplicate_skips_detected" {
		t.Fatalf("unexpected thread alerts %#v", threadPayload.Data.Alerts)
	}
	if threadPayload.Data.Timings.PostToolUseDecisionLatency.P50Ms != 100 ||
		threadPayload.Data.Timings.PostToolUseDecisionLatency.P95Ms != 250 ||
		threadPayload.Data.Timings.StopDecisionLatency.P50Ms != 300 ||
		threadPayload.Data.Timings.StopDecisionLatency.P95Ms != 500 {
		t.Fatalf("unexpected filtered timing summary %#v", threadPayload.Data.Timings)
	}
	if threadPayload.Data.Turns.CompletedWithFileChange != 2 ||
		threadPayload.Data.Turns.MissingSuccessfulVerification != 1 ||
		threadPayload.Data.Turns.MissingSuccessfulVerificationRate != 0.5 ||
		threadPayload.Data.Turns.FailedValidationCommand != 1 ||
		threadPayload.Data.Turns.FailedValidationWithPolicyAction != 1 {
		t.Fatalf("unexpected filtered turn summary %#v", threadPayload.Data.Turns)
	}
	if threadPayload.Data.Audit.CoveredTurns != 2 ||
		threadPayload.Data.Audit.EligibleTurns != 2 ||
		threadPayload.Data.Audit.CoverageRate != 1 {
		t.Fatalf("unexpected filtered audit summary %#v", threadPayload.Data.Audit)
	}

	sourceResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-metrics?source=%20automation%20",
		"",
	)
	if sourceResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from source-filtered turn policy metrics route, got %d", sourceResponse.Code)
	}

	var sourcePayload struct {
		Data struct {
			ThreadID string `json:"threadId"`
			Source   string `json:"source"`
			Alerts   []struct {
				Code string `json:"code"`
			} `json:"alerts"`
			Decisions struct {
				Total             int     `json:"total"`
				ActionAttempts    int     `json:"actionAttempts"`
				ActionSucceeded   int     `json:"actionSucceeded"`
				ActionSuccessRate float64 `json:"actionSuccessRate"`
			} `json:"decisions"`
			Sources struct {
				Interactive struct {
					Total int `json:"total"`
				} `json:"interactive"`
				Automation struct {
					Total             int     `json:"total"`
					ActionAttempts    int     `json:"actionAttempts"`
					ActionSucceeded   int     `json:"actionSucceeded"`
					ActionSuccessRate float64 `json:"actionSuccessRate"`
					Skipped           int     `json:"skipped"`
				} `json:"automation"`
				Bot struct {
					Total int `json:"total"`
				} `json:"bot"`
				Other struct {
					Total int `json:"total"`
				} `json:"other"`
			} `json:"sources"`
			Timings struct {
				PostToolUseDecisionLatency struct {
					P50Ms int64 `json:"p50Ms"`
					P95Ms int64 `json:"p95Ms"`
				} `json:"postToolUseDecisionLatency"`
				StopDecisionLatency struct {
					P50Ms int64 `json:"p50Ms"`
					P95Ms int64 `json:"p95Ms"`
				} `json:"stopDecisionLatency"`
			} `json:"timings"`
			Audit struct {
				CoveredTurns  int     `json:"coveredTurns"`
				EligibleTurns int     `json:"eligibleTurns"`
				CoverageRate  float64 `json:"coverageRate"`
			} `json:"audit"`
		} `json:"data"`
	}
	decodeResponseBody(t, sourceResponse, &sourcePayload)

	if sourcePayload.Data.ThreadID != "" || sourcePayload.Data.Source != "automation" {
		t.Fatalf("expected source filter to be echoed, got %#v", sourcePayload.Data)
	}
	if sourcePayload.Data.Decisions.Total != 1 ||
		sourcePayload.Data.Decisions.ActionAttempts != 1 ||
		sourcePayload.Data.Decisions.ActionSucceeded != 1 ||
		sourcePayload.Data.Decisions.ActionSuccessRate != 1 {
		t.Fatalf("unexpected source-filtered decision summary %#v", sourcePayload.Data.Decisions)
	}
	if sourcePayload.Data.Sources.Automation.Total != 1 ||
		sourcePayload.Data.Sources.Automation.ActionAttempts != 1 ||
		sourcePayload.Data.Sources.Automation.ActionSucceeded != 1 ||
		sourcePayload.Data.Sources.Automation.ActionSuccessRate != 1 ||
		sourcePayload.Data.Sources.Automation.Skipped != 0 {
		t.Fatalf("unexpected source-filtered automation summary %#v", sourcePayload.Data.Sources.Automation)
	}
	if sourcePayload.Data.Sources.Interactive.Total != 0 ||
		sourcePayload.Data.Sources.Bot.Total != 0 ||
		sourcePayload.Data.Sources.Other.Total != 0 {
		t.Fatalf("expected non-selected source buckets to be empty, got %#v", sourcePayload.Data.Sources)
	}
	if len(sourcePayload.Data.Alerts) != 1 ||
		sourcePayload.Data.Alerts[0].Code != "audit_coverage_incomplete" {
		t.Fatalf("unexpected source-filtered alerts %#v", sourcePayload.Data.Alerts)
	}
	if sourcePayload.Data.Timings.PostToolUseDecisionLatency.P50Ms != 0 ||
		sourcePayload.Data.Timings.PostToolUseDecisionLatency.P95Ms != 0 ||
		sourcePayload.Data.Timings.StopDecisionLatency.P50Ms != 300 ||
		sourcePayload.Data.Timings.StopDecisionLatency.P95Ms != 300 {
		t.Fatalf("unexpected source-filtered timing summary %#v", sourcePayload.Data.Timings)
	}
	if sourcePayload.Data.Audit.CoveredTurns != 1 ||
		sourcePayload.Data.Audit.EligibleTurns != 3 ||
		sourcePayload.Data.Audit.CoverageRate != 0.3333 {
		t.Fatalf("unexpected source-filtered audit summary %#v", sourcePayload.Data.Audit)
	}
}

func TestTurnPolicyMetricsRouteReturnsAlertMetadata(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedRouterMetricsThreadProjection(dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				routerCommandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				routerFileChangeItem("patch-1", "backend/internal/api/router.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 19, 30, 0, 0, time.UTC)
	mustCreateRouterMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          "posttooluse/failed-validation-command",
		Fingerprint:         "fp-automation-failed",
		Verdict:             "followUp",
		Action:              "followUp",
		ActionStatus:        "failed",
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(1500 * time.Millisecond),
		CompletedAt:         base.Add(1600 * time.Millisecond),
	})
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyAlertSuppressedCodes: []string{
			" post_tool_use_latency_high ",
			"post_tool_use_latency_high",
		},
	})

	router := newTestRouter(dataStore)

	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-metrics?source=%20automation%20",
		"",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from automation alert metrics route, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			Source      string `json:"source"`
			AlertPolicy struct {
				SuppressedCodes []string `json:"suppressedCodes"`
				SuppressedCount int      `json:"suppressedCount"`
			} `json:"alertPolicy"`
			Alerts []struct {
				Code         string `json:"code"`
				Rank         int    `json:"rank"`
				Severity     string `json:"severity"`
				Source       string `json:"source"`
				ActionStatus string `json:"actionStatus"`
			} `json:"alerts"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Data.Source != "automation" {
		t.Fatalf("expected source filter to echo automation, got %#v", payload.Data)
	}
	if len(payload.Data.AlertPolicy.SuppressedCodes) != 1 ||
		payload.Data.AlertPolicy.SuppressedCodes[0] != "post_tool_use_latency_high" ||
		payload.Data.AlertPolicy.SuppressedCount != 1 {
		t.Fatalf("unexpected alert policy payload %#v", payload.Data.AlertPolicy)
	}
	expectedCodes := map[string]bool{
		"audit_coverage_incomplete":              true,
		"automation_action_success_below_target": true,
		"failed_actions_detected":                true,
	}
	if len(payload.Data.Alerts) != len(expectedCodes) {
		t.Fatalf("unexpected alert payload %#v", payload.Data.Alerts)
	}
	for _, alert := range payload.Data.Alerts {
		if !expectedCodes[alert.Code] {
			t.Fatalf("unexpected alert code %#v", payload.Data.Alerts)
		}
		if alert.Code == "automation_action_success_below_target" &&
			(alert.Severity != "warning" || alert.Source != "automation" || alert.ActionStatus != "failed") {
			t.Fatalf("unexpected automation alert metadata %#v", alert)
		}
	}
	for index, alert := range payload.Data.Alerts {
		if alert.Rank != index+1 {
			t.Fatalf("expected sequential alert ranks, got %#v", payload.Data.Alerts)
		}
	}
}

func TestTurnPolicyMetricsRouteHonorsRuntimePreferenceThresholds(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	seedRouterMetricsThreadProjection(dataStore, workspace.ID, "thread-1", []store.ThreadTurn{
		{
			ID:     "turn-1",
			Status: "completed",
			Items: []map[string]any{
				routerCommandExecutionItem("cmd-1", "go test ./...", "failed", 1),
			},
		},
		{
			ID:     "turn-2",
			Status: "completed",
			Items: []map[string]any{
				routerFileChangeItem("patch-1", "backend/internal/api/router.go"),
				{"id": "msg-1", "type": "agentMessage", "status": "completed"},
			},
		},
	})

	base := time.Date(2026, time.April, 8, 19, 45, 0, 0, time.UTC)
	mustCreateRouterMetricsDecision(t, dataStore, store.TurnPolicyDecision{
		WorkspaceID:         workspace.ID,
		ThreadID:            "thread-1",
		TurnID:              "turn-1",
		TriggerMethod:       "item/completed",
		PolicyName:          "posttooluse/failed-validation-command",
		Fingerprint:         "fp-automation-failed",
		Verdict:             "followUp",
		Action:              "followUp",
		ActionStatus:        "failed",
		Reason:              "validation_command_failed",
		Source:              "automation",
		EvaluationStartedAt: base,
		DecisionAt:          base.Add(1500 * time.Millisecond),
		CompletedAt:         base.Add(1600 * time.Millisecond),
	})

	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyAlertCoverageThresholdPercent:            routerIntPtr(0),
		TurnPolicyAlertPostToolUseLatencyP95ThresholdMs:    routerInt64Ptr(1600),
		TurnPolicyAlertSourceActionSuccessThresholdPercent: routerIntPtr(0),
	})

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/turn-policy-metrics?source=%20automation%20",
		"",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from automation alert metrics route, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			Alerts []struct {
				Code string `json:"code"`
			} `json:"alerts"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)

	if len(payload.Data.Alerts) != 1 || payload.Data.Alerts[0].Code != "failed_actions_detected" {
		t.Fatalf("expected only failed action alert after threshold overrides, got %#v", payload.Data.Alerts)
	}
}

func TestTurnPolicyMetricsRouteEchoesSourceWhenServiceUnavailable(t *testing.T) {
	t.Parallel()

	server := &Server{}
	router := chi.NewRouter()
	router.Get("/api/workspaces/{workspaceId}/turn-policy-metrics", server.handleGetTurnPolicyMetrics)

	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/ws-test/turn-policy-metrics?threadId=%20thread-9%20&source=%20bot%20",
		"",
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from nil-service turn policy metrics route, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			WorkspaceID string     `json:"workspaceId"`
			ThreadID    string     `json:"threadId"`
			Source      string     `json:"source"`
			Alerts      []struct{} `json:"alerts"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Data.WorkspaceID != "ws-test" ||
		payload.Data.ThreadID != "thread-9" ||
		payload.Data.Source != "bot" {
		t.Fatalf("expected nil-service metrics scope to echo filters, got %#v", payload.Data)
	}
	if len(payload.Data.Alerts) != 0 {
		t.Fatalf("expected nil-service metrics alerts to be empty, got %#v", payload.Data.Alerts)
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

	updateConnectionResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bot-connections/"+created.Data.ID,
		`{"provider":"fakechat","name":"Support Bot v2","aiBackend":"fake_ai","aiConfig":{"model":"gpt-5.4-mini"},"settings":{"runtime_mode":"debug","command_output_mode":"full"}}`,
	)
	if updateConnectionResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from bot connection update, got %d", updateConnectionResponse.Code)
	}

	var updatedConnection struct {
		Data struct {
			Name       string            `json:"name"`
			AIConfig   map[string]string `json:"aiConfig"`
			Settings   map[string]string `json:"settings"`
			SecretKeys []string          `json:"secretKeys"`
		} `json:"data"`
	}
	decodeResponseBody(t, updateConnectionResponse, &updatedConnection)
	if updatedConnection.Data.Name != "Support Bot v2" {
		t.Fatalf("expected updated connection name, got %#v", updatedConnection.Data)
	}
	if updatedConnection.Data.AIConfig["model"] != "gpt-5.4-mini" {
		t.Fatalf("expected updated ai config, got %#v", updatedConnection.Data.AIConfig)
	}
	if updatedConnection.Data.Settings["runtime_mode"] != "debug" || updatedConnection.Data.Settings["command_output_mode"] != "full" {
		t.Fatalf("expected updated connection settings, got %#v", updatedConnection.Data.Settings)
	}
	if len(updatedConnection.Data.SecretKeys) == 0 {
		t.Fatalf("expected secret keys to be preserved after update, got %#v", updatedConnection.Data.SecretKeys)
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

	updateCommandOutputModeResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bot-connections/"+created.Data.ID+"/command-output-mode",
		`{"commandOutputMode":"single_line"}`,
	)
	if updateCommandOutputModeResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from command output mode update, got %d", updateCommandOutputModeResponse.Code)
	}

	webhookRequest := httptest.NewRequest(
		http.MethodPost,
		"/hooks/bots/"+created.Data.ID,
		strings.NewReader(`{"conversationId":"chat-1","messageId":"msg-1","userId":"user-1","username":"alice","title":"Alice","text":"hello"}`),
	)
	webhookRequest.RemoteAddr = "127.0.0.1:41000"
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

func TestBotCreationAndBotScopedConnectionRoutes(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
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

	createBotResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bots",
		`{"name":"Ops Bot","description":"Primary support bot"}`,
	)
	if createBotResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create bot, got %d", createBotResponse.Code)
	}

	var createdBot struct {
		Data struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Description string `json:"description"`
		} `json:"data"`
	}
	decodeResponseBody(t, createBotResponse, &createdBot)
	if createdBot.Data.ID == "" || createdBot.Data.Name != "Ops Bot" || createdBot.Data.Description != "Primary support bot" {
		t.Fatalf("unexpected created bot payload: %#v", createdBot.Data)
	}

	createEndpointResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bots/"+createdBot.Data.ID+"/connections",
		`{"provider":"fakechat","name":"Telegram Endpoint","aiBackend":"fake_ai","secrets":{"bot_token":"token-1"}}`,
	)
	if createEndpointResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create bot-scoped connection, got %d", createEndpointResponse.Code)
	}

	var createdEndpoint struct {
		Data struct {
			ID         string   `json:"id"`
			BotID      string   `json:"botId"`
			Name       string   `json:"name"`
			SecretKeys []string `json:"secretKeys"`
		} `json:"data"`
	}
	decodeResponseBody(t, createEndpointResponse, &createdEndpoint)
	if createdEndpoint.Data.ID == "" ||
		createdEndpoint.Data.BotID != createdBot.Data.ID ||
		createdEndpoint.Data.Name != "Telegram Endpoint" ||
		len(createdEndpoint.Data.SecretKeys) == 0 {
		t.Fatalf("unexpected created endpoint payload: %#v", createdEndpoint.Data)
	}

	listBotsResponse := performJSONRequest(t, router, http.MethodGet, "/api/workspaces/"+workspace.ID+"/bots", "")
	if listBotsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from list bots, got %d", listBotsResponse.Code)
	}

	var listedBots struct {
		Data []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			EndpointCount int    `json:"endpointCount"`
		} `json:"data"`
	}
	decodeResponseBody(t, listBotsResponse, &listedBots)
	if len(listedBots.Data) != 1 ||
		listedBots.Data[0].ID != createdBot.Data.ID ||
		listedBots.Data[0].Name != "Ops Bot" ||
		listedBots.Data[0].EndpointCount != 1 {
		t.Fatalf("unexpected listed bots payload: %#v", listedBots.Data)
	}
}

func TestGlobalBotRoutesAggregateAcrossWorkspaces(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/ai/codex-server")

	connectionA, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspaceA.ID,
		Provider:    "telegram",
		Name:        "Alpha Bot",
		Status:      "active",
		AIBackend:   "workspace_thread",
		Secrets:     map[string]string{"bot_token": "token-a"},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection(workspaceA) error = %v", err)
	}
	connectionB, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspaceB.ID,
		Provider:    "wechat",
		Name:        "Bravo Bot",
		Status:      "paused",
		AIBackend:   "workspace_thread",
		Settings: map[string]string{
			"wechat_base_url":      "https://wechat.example.com",
			"wechat_account_id":    "acct-b",
			"wechat_owner_user_id": "user-b",
		},
		Secrets: map[string]string{"bot_token": "token-b"},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection(workspaceB) error = %v", err)
	}
	if _, err := dataStore.AppendBotConnectionLog(workspaceB.ID, connectionB.ID, store.BotConnectionLogEntry{
		Level:     "warning",
		EventType: "poll_failed",
		Message:   "polling failed",
	}); err != nil {
		t.Fatalf("AppendBotConnectionLog() error = %v", err)
	}
	if _, err := dataStore.UpsertWeChatAccount(store.WeChatAccount{
		WorkspaceID: workspaceA.ID,
		BaseURL:     "https://wechat-a.example.com",
		AccountID:   "acct-a",
		UserID:      "user-a",
		BotToken:    "token-a",
		Alias:       "Alpha Account",
	}); err != nil {
		t.Fatalf("UpsertWeChatAccount(workspaceA) error = %v", err)
	}
	if _, err := dataStore.UpsertWeChatAccount(store.WeChatAccount{
		WorkspaceID: workspaceB.ID,
		BaseURL:     "https://wechat-b.example.com",
		AccountID:   "acct-b",
		UserID:      "user-b",
		BotToken:    "token-b",
		Alias:       "Bravo Account",
	}); err != nil {
		t.Fatalf("UpsertWeChatAccount(workspaceB) error = %v", err)
	}

	listConnectionsResponse := performJSONRequest(t, router, http.MethodGet, "/api/bot-connections", "")
	if listConnectionsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from global bot connections route, got %d", listConnectionsResponse.Code)
	}

	var listedConnections struct {
		Data []struct {
			ID          string `json:"id"`
			WorkspaceID string `json:"workspaceId"`
		} `json:"data"`
	}
	decodeResponseBody(t, listConnectionsResponse, &listedConnections)
	if len(listedConnections.Data) != 2 {
		t.Fatalf("expected 2 global bot connections, got %#v", listedConnections.Data)
	}
	hasWorkspaceAConnection := false
	hasWorkspaceBConnection := false
	for _, item := range listedConnections.Data {
		if item.ID == connectionA.ID && item.WorkspaceID == workspaceA.ID {
			hasWorkspaceAConnection = true
		}
		if item.ID == connectionB.ID && item.WorkspaceID == workspaceB.ID {
			hasWorkspaceBConnection = true
		}
	}
	if !hasWorkspaceAConnection {
		t.Fatalf("expected workspace A connection in global list, got %#v", listedConnections.Data)
	}
	if !hasWorkspaceBConnection {
		t.Fatalf("expected workspace B connection in global list, got %#v", listedConnections.Data)
	}

	listBotsResponse := performJSONRequest(t, router, http.MethodGet, "/api/bots", "")
	if listBotsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from global bots route, got %d", listBotsResponse.Code)
	}

	var listedBots struct {
		Data []struct {
			ID          string `json:"id"`
			WorkspaceID string `json:"workspaceId"`
			Name        string `json:"name"`
		} `json:"data"`
	}
	decodeResponseBody(t, listBotsResponse, &listedBots)
	if len(listedBots.Data) != 2 {
		t.Fatalf("expected 2 global bots, got %#v", listedBots.Data)
	}
	hasWorkspaceABot := false
	hasWorkspaceBBot := false
	for _, item := range listedBots.Data {
		if item.WorkspaceID == workspaceA.ID && item.Name == "Alpha Bot" {
			hasWorkspaceABot = true
		}
		if item.WorkspaceID == workspaceB.ID && item.Name == "Bravo Bot" {
			hasWorkspaceBBot = true
		}
	}
	if !hasWorkspaceABot {
		t.Fatalf("expected workspace A bot in global list, got %#v", listedBots.Data)
	}
	if !hasWorkspaceBBot {
		t.Fatalf("expected workspace B bot in global list, got %#v", listedBots.Data)
	}

	getConnectionResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/bot-connections/"+connectionB.ID,
		"",
	)
	if getConnectionResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from global bot connection detail route, got %d", getConnectionResponse.Code)
	}

	var connectionDetail struct {
		Data struct {
			ID          string `json:"id"`
			WorkspaceID string `json:"workspaceId"`
			Name        string `json:"name"`
		} `json:"data"`
	}
	decodeResponseBody(t, getConnectionResponse, &connectionDetail)
	if connectionDetail.Data.ID != connectionB.ID || connectionDetail.Data.WorkspaceID != workspaceB.ID {
		t.Fatalf("unexpected global bot connection detail %#v", connectionDetail.Data)
	}

	listLogsResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/bot-connections/"+connectionB.ID+"/logs",
		"",
	)
	if listLogsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from global bot logs route, got %d", listLogsResponse.Code)
	}

	var listedLogs struct {
		Data []struct {
			ConnectionID string `json:"connectionId"`
			Message      string `json:"message"`
		} `json:"data"`
	}
	decodeResponseBody(t, listLogsResponse, &listedLogs)
	if len(listedLogs.Data) != 1 || listedLogs.Data[0].ConnectionID != connectionB.ID || listedLogs.Data[0].Message != "polling failed" {
		t.Fatalf("unexpected global bot logs payload %#v", listedLogs.Data)
	}

	listAccountsResponse := performJSONRequest(t, router, http.MethodGet, "/api/bot-providers/wechat/accounts", "")
	if listAccountsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from global wechat accounts route, got %d", listAccountsResponse.Code)
	}

	var listedAccounts struct {
		Data []struct {
			WorkspaceID string `json:"workspaceId"`
			AccountID   string `json:"accountId"`
		} `json:"data"`
	}
	decodeResponseBody(t, listAccountsResponse, &listedAccounts)
	if len(listedAccounts.Data) != 2 {
		t.Fatalf("expected 2 global wechat accounts, got %#v", listedAccounts.Data)
	}
	hasWorkspaceAAccount := false
	hasWorkspaceBAccount := false
	for _, item := range listedAccounts.Data {
		if item.WorkspaceID == workspaceA.ID && item.AccountID == "acct-a" {
			hasWorkspaceAAccount = true
		}
		if item.WorkspaceID == workspaceB.ID && item.AccountID == "acct-b" {
			hasWorkspaceBAccount = true
		}
	}
	if !hasWorkspaceAAccount {
		t.Fatalf("expected workspace A wechat account in global list, got %#v", listedAccounts.Data)
	}
	if !hasWorkspaceBAccount {
		t.Fatalf("expected workspace B wechat account in global list, got %#v", listedAccounts.Data)
	}
}

func TestBotConversationReplayFailedReplyRoute(t *testing.T) {
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
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:                      workspace.ID,
		ConnectionID:                     created.Data.ID,
		Provider:                         "fakechat",
		ExternalConversationID:           "chat-replay-route-1",
		ExternalChatID:                   "chat-replay-route-1",
		ExternalUserID:                   "user-1",
		ExternalUsername:                 "alice",
		ExternalTitle:                    "Alice",
		ThreadID:                         "thr_route_chat-replay-route-1",
		LastInboundMessageID:             "msg-replay-route-1",
		LastInboundText:                  "hello route replay",
		LastOutboundText:                 "route reply: hello route replay",
		LastOutboundDeliveryStatus:       "failed",
		LastOutboundDeliveryError:        "upstream timeout",
		LastOutboundDeliveryAttemptCount: 2,
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	delivery, accepted, err := dataStore.UpsertBotInboundDelivery(store.BotInboundDelivery{
		WorkspaceID:            workspace.ID,
		ConnectionID:           created.Data.ID,
		Provider:               "fakechat",
		ExternalConversationID: "chat-replay-route-1",
		ExternalChatID:         "chat-replay-route-1",
		MessageID:              "msg-replay-route-1",
		UserID:                 "user-1",
		Username:               "alice",
		Title:                  "Alice",
		Text:                   "hello route replay",
	})
	if err != nil {
		t.Fatalf("UpsertBotInboundDelivery() error = %v", err)
	}
	if !accepted {
		t.Fatal("expected failed replay fixture delivery to be accepted")
	}
	if _, err := dataStore.SaveBotInboundDeliveryReply(
		workspace.ID,
		delivery.ID,
		"thr_route_chat-replay-route-1",
		[]store.BotReplyMessage{{Text: "route reply: hello route replay"}},
	); err != nil {
		t.Fatalf("SaveBotInboundDeliveryReply() error = %v", err)
	}
	if _, err := dataStore.RecordBotInboundDeliveryReplyDelivery(
		workspace.ID,
		delivery.ID,
		"failed",
		2,
		"upstream timeout",
		nil,
	); err != nil {
		t.Fatalf("RecordBotInboundDeliveryReplyDelivery() error = %v", err)
	}
	if _, err := dataStore.FailBotInboundDelivery(workspace.ID, delivery.ID, "upstream timeout"); err != nil {
		t.Fatalf("FailBotInboundDelivery() error = %v", err)
	}

	replayResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bot-connections/"+created.Data.ID+"/conversations/"+conversation.ID+"/replay-failed-reply",
		"",
	)
	if replayResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from replay failed reply route, got %d", replayResponse.Code)
	}

	select {
	case payload := <-botProvider.sentCh:
		if len(payload.Messages) != 1 || payload.Messages[0].Text != "route reply: hello route replay" {
			t.Fatalf("expected replay route to send saved reply, got %#v", payload.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for replayed route bot reply")
	}

	var replayedConversation struct {
		Data struct {
			LastOutboundDeliveryStatus       string `json:"lastOutboundDeliveryStatus"`
			LastOutboundDeliveryAttemptCount int    `json:"lastOutboundDeliveryAttemptCount"`
		} `json:"data"`
	}
	decodeResponseBody(t, replayResponse, &replayedConversation)
	if replayedConversation.Data.LastOutboundDeliveryStatus != "delivered" {
		t.Fatalf("expected delivered conversation from replay route, got %#v", replayedConversation.Data)
	}
	if replayedConversation.Data.LastOutboundDeliveryAttemptCount != 3 {
		t.Fatalf("expected cumulative attempt count 3 from replay route, got %#v", replayedConversation.Data)
	}
}

func TestBotDeliveryTargetAndOutboundDeliveryRoutes(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	router := newTestRouter(dataStore)

	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	bot, err := dataStore.CreateBot(store.Bot{
		WorkspaceID: workspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspace.ID,
		BotID:                  bot.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-1",
		ExternalChatID:         "chat-1",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:    workspace.ID,
		BotID:          bot.ID,
		ConnectionID:   connection.ID,
		ConversationID: conversation.ID,
		Provider:       connection.Provider,
		TargetType:     "session_backed",
		RouteType:      "telegram_chat",
		RouteKey:       "chat:1",
		Title:          "Primary Target",
		Capabilities:   []string{"supportsProactivePush"},
		Status:         "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}
	delivery, err := dataStore.CreateBotOutboundDelivery(store.BotOutboundDelivery{
		WorkspaceID:      workspace.ID,
		BotID:            bot.ID,
		ConnectionID:     connection.ID,
		ConversationID:   conversation.ID,
		DeliveryTargetID: target.ID,
		SourceType:       "manual",
		SourceRefType:    "thread_turn",
		SourceRefID:      "turn_001",
		Messages: []store.BotReplyMessage{
			{Text: "Hello"},
		},
		Status: "queued",
		ProviderMessageIDs: []string{
			"provider-msg-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotOutboundDelivery() error = %v", err)
	}

	targetsResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/bots/"+bot.ID+"/delivery-targets",
		"",
	)
	if targetsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from delivery target route, got %d", targetsResponse.Code)
	}

	var listedTargets struct {
		Data []struct {
			ID         string `json:"id"`
			EndpointID string `json:"endpointId"`
			SessionID  string `json:"sessionId"`
			RouteKey   string `json:"routeKey"`
			TargetType string `json:"targetType"`
		} `json:"data"`
	}
	decodeResponseBody(t, targetsResponse, &listedTargets)
	if len(listedTargets.Data) != 1 {
		t.Fatalf("expected 1 delivery target, got %#v", listedTargets.Data)
	}
	if listedTargets.Data[0].ID != target.ID ||
		listedTargets.Data[0].EndpointID != connection.ID ||
		listedTargets.Data[0].SessionID != conversation.ID ||
		listedTargets.Data[0].RouteKey != "chat:1" ||
		listedTargets.Data[0].TargetType != "session_backed" {
		t.Fatalf("unexpected delivery target payload: %#v", listedTargets.Data[0])
	}

	deliveriesResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/bots/"+bot.ID+"/outbound-deliveries",
		"",
	)
	if deliveriesResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from outbound deliveries route, got %d", deliveriesResponse.Code)
	}

	var listedDeliveries struct {
		Data []struct {
			ID               string `json:"id"`
			EndpointID       string `json:"endpointId"`
			SessionID        string `json:"sessionId"`
			DeliveryTargetID string `json:"deliveryTargetId"`
			SourceType       string `json:"sourceType"`
			Status           string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, deliveriesResponse, &listedDeliveries)
	if len(listedDeliveries.Data) != 1 {
		t.Fatalf("expected 1 outbound delivery, got %#v", listedDeliveries.Data)
	}
	if listedDeliveries.Data[0].ID != delivery.ID ||
		listedDeliveries.Data[0].EndpointID != connection.ID ||
		listedDeliveries.Data[0].SessionID != conversation.ID ||
		listedDeliveries.Data[0].DeliveryTargetID != target.ID ||
		listedDeliveries.Data[0].SourceType != "manual" ||
		listedDeliveries.Data[0].Status != "queued" {
		t.Fatalf("unexpected outbound delivery payload: %#v", listedDeliveries.Data[0])
	}

	deliveryResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/bots/"+bot.ID+"/outbound-deliveries/"+delivery.ID,
		"",
	)
	if deliveryResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from outbound delivery detail route, got %d", deliveryResponse.Code)
	}

	var fetchedDelivery struct {
		Data struct {
			ID                 string   `json:"id"`
			DeliveryTargetID   string   `json:"deliveryTargetId"`
			EndpointID         string   `json:"endpointId"`
			ProviderMessageIDs []string `json:"providerMessageIds"`
		} `json:"data"`
	}
	decodeResponseBody(t, deliveryResponse, &fetchedDelivery)
	if fetchedDelivery.Data.ID != delivery.ID ||
		fetchedDelivery.Data.DeliveryTargetID != target.ID ||
		fetchedDelivery.Data.EndpointID != connection.ID ||
		len(fetchedDelivery.Data.ProviderMessageIDs) != 1 ||
		fetchedDelivery.Data.ProviderMessageIDs[0] != "provider-msg-1" {
		t.Fatalf("unexpected outbound delivery detail payload: %#v", fetchedDelivery.Data)
	}
}

func TestBotTriggerRoutes(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	router := newTestRouter(dataStore)

	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	bot, err := dataStore.CreateBot(store.Bot{
		WorkspaceID: workspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:  workspace.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "telegram_chat",
		RouteKey:     "chat:notify-1",
		Title:        "Notify Chat",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bots/"+bot.ID+"/triggers",
		fmt.Sprintf(`{
			"type":"notification",
			"deliveryTargetId":%q,
			"filter":{"kind":"automation_run_completed","level":"success"},
			"enabled":true
		}`, target.ID),
	)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from create trigger route, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID               string            `json:"id"`
			Type             string            `json:"type"`
			DeliveryTargetID string            `json:"deliveryTargetId"`
			Filter           map[string]string `json:"filter"`
			Enabled          bool              `json:"enabled"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)
	if created.Data.ID == "" ||
		created.Data.Type != "notification" ||
		created.Data.DeliveryTargetID != target.ID ||
		created.Data.Filter["kind"] != "automation_run_completed" ||
		!created.Data.Enabled {
		t.Fatalf("unexpected created trigger payload: %#v", created.Data)
	}

	listResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/bots/"+bot.ID+"/triggers",
		"",
	)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from list triggers route, got %d", listResponse.Code)
	}

	var listed struct {
		Data []struct {
			ID      string            `json:"id"`
			Enabled bool              `json:"enabled"`
			Filter  map[string]string `json:"filter"`
		} `json:"data"`
	}
	decodeResponseBody(t, listResponse, &listed)
	if len(listed.Data) != 1 || listed.Data[0].ID != created.Data.ID {
		t.Fatalf("expected 1 listed trigger, got %#v", listed.Data)
	}

	updateResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bots/"+bot.ID+"/triggers/"+created.Data.ID,
		`{
			"filter":{"kind":"automation_run_failed"},
			"enabled":false
		}`,
	)
	if updateResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from update trigger route, got %d", updateResponse.Code)
	}

	var updated struct {
		Data struct {
			ID      string            `json:"id"`
			Enabled bool              `json:"enabled"`
			Filter  map[string]string `json:"filter"`
		} `json:"data"`
	}
	decodeResponseBody(t, updateResponse, &updated)
	if updated.Data.ID != created.Data.ID || updated.Data.Enabled || updated.Data.Filter["kind"] != "automation_run_failed" {
		t.Fatalf("unexpected updated trigger payload: %#v", updated.Data)
	}

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/workspaces/"+workspace.ID+"/bots/"+bot.ID+"/triggers/"+created.Data.ID,
		"",
	)
	if deleteResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from delete trigger route, got %d", deleteResponse.Code)
	}

	if _, ok := dataStore.GetBotTrigger(workspace.ID, created.Data.ID); ok {
		t.Fatalf("expected trigger %s to be removed after delete route", created.Data.ID)
	}
}

func TestBotDeliveryTargetCreateAndSendOutboundRoutes(t *testing.T) {
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

	workspaceRecord := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bot-connections",
		`{"provider":"fakechat","name":"Support Bot","aiBackend":"fake_ai","secrets":{"bot_token":"token-1"}}`,
	)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create bot connection, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID    string `json:"id"`
			BotID string `json:"botId"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspaceRecord.ID,
		BotID:                  created.Data.BotID,
		ConnectionID:           created.Data.ID,
		Provider:               "fakechat",
		ExternalConversationID: "chat-proactive-route-1",
		ExternalChatID:         "chat-proactive-route-1",
		ExternalTitle:          "Alice",
		ThreadID:               "thr_chat-proactive-route-1",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	targetResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bots/"+created.Data.BotID+"/delivery-targets",
		fmt.Sprintf(`{"sessionId":"%s","targetType":"session_backed"}`, conversation.ID),
	)
	if targetResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from upsert delivery target route, got %d", targetResponse.Code)
	}

	var targetPayload struct {
		Data struct {
			ID         string `json:"id"`
			EndpointID string `json:"endpointId"`
			SessionID  string `json:"sessionId"`
			TargetType string `json:"targetType"`
		} `json:"data"`
	}
	decodeResponseBody(t, targetResponse, &targetPayload)
	if targetPayload.Data.EndpointID != created.Data.ID ||
		targetPayload.Data.SessionID != conversation.ID ||
		targetPayload.Data.TargetType != "session_backed" {
		t.Fatalf("unexpected delivery target route payload: %#v", targetPayload.Data)
	}

	sendResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bots/"+created.Data.BotID+"/sessions/"+conversation.ID+"/outbound-messages",
		`{"sourceType":"manual","idempotencyKey":"manual-route-1","messages":[{"text":"route proactive hello"}]}`,
	)
	if sendResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from session outbound route, got %d", sendResponse.Code)
	}

	select {
	case payload := <-botProvider.sentCh:
		if len(payload.Messages) != 1 || payload.Messages[0].Text != "route proactive hello" {
			t.Fatalf("expected proactive route payload, got %#v", payload.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for proactive route send")
	}

	var deliveryPayload struct {
		Data struct {
			ID               string `json:"id"`
			SessionID        string `json:"sessionId"`
			DeliveryTargetID string `json:"deliveryTargetId"`
			Status           string `json:"status"`
			SourceType       string `json:"sourceType"`
		} `json:"data"`
	}
	decodeResponseBody(t, sendResponse, &deliveryPayload)
	if deliveryPayload.Data.SessionID != conversation.ID ||
		deliveryPayload.Data.DeliveryTargetID != targetPayload.Data.ID ||
		deliveryPayload.Data.Status != "delivered" ||
		deliveryPayload.Data.SourceType != "manual" {
		t.Fatalf("unexpected outbound delivery response payload: %#v", deliveryPayload.Data)
	}

	sendByTargetResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bots/"+created.Data.BotID+"/delivery-targets/"+targetPayload.Data.ID+"/outbound-messages",
		`{"sourceType":"manual","messages":[{"text":"route proactive by target"}]}`,
	)
	if sendByTargetResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from target outbound route, got %d", sendByTargetResponse.Code)
	}

	select {
	case payload := <-botProvider.sentCh:
		if len(payload.Messages) != 1 || payload.Messages[0].Text != "route proactive by target" {
			t.Fatalf("expected proactive target route payload, got %#v", payload.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for target proactive route send")
	}
}

func TestBotDeliveryTargetUpdateAndDeleteRoutes(t *testing.T) {
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

	workspaceRecord := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bot-connections",
		`{"provider":"fakechat","name":"Support Bot","aiBackend":"fake_ai","secrets":{"bot_token":"token-1"}}`,
	)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create bot connection, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID    string `json:"id"`
			BotID string `json:"botId"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)

	targetResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bots/"+created.Data.BotID+"/delivery-targets",
		fmt.Sprintf(`{"endpointId":"%s","targetType":"route_backed","routeType":"telegram_chat","routeKey":"chat:998877","title":"Ops Room"}`, created.Data.ID),
	)
	if targetResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from create route-backed target, got %d", targetResponse.Code)
	}

	var targetPayload struct {
		Data struct {
			ID        string `json:"id"`
			RouteType string `json:"routeType"`
			RouteKey  string `json:"routeKey"`
			Status    string `json:"status"`
			Title     string `json:"title"`
		} `json:"data"`
	}
	decodeResponseBody(t, targetResponse, &targetPayload)

	updateResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bots/"+created.Data.BotID+"/delivery-targets/"+targetPayload.Data.ID,
		`{"routeType":"telegram_topic","routeKey":"chat:998877:thread:42","title":"Ops Topic","status":"paused"}`,
	)
	if updateResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from update route-backed target, got %d", updateResponse.Code)
	}

	var updatedPayload struct {
		Data struct {
			ID        string `json:"id"`
			RouteType string `json:"routeType"`
			RouteKey  string `json:"routeKey"`
			Status    string `json:"status"`
			Title     string `json:"title"`
		} `json:"data"`
	}
	decodeResponseBody(t, updateResponse, &updatedPayload)
	if updatedPayload.Data.ID != targetPayload.Data.ID ||
		updatedPayload.Data.RouteType != "telegram_topic" ||
		updatedPayload.Data.RouteKey != "chat:998877:thread:42" ||
		updatedPayload.Data.Status != "paused" ||
		updatedPayload.Data.Title != "Ops Topic" {
		t.Fatalf("unexpected updated route-backed target payload: %#v", updatedPayload.Data)
	}

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/workspaces/"+workspaceRecord.ID+"/bots/"+created.Data.BotID+"/delivery-targets/"+targetPayload.Data.ID,
		"",
	)
	if deleteResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from delete route-backed target, got %d", deleteResponse.Code)
	}

	var deletePayload struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, deleteResponse, &deletePayload)
	if deletePayload.Data.Status != "accepted" {
		t.Fatalf("unexpected delete route-backed target response: %#v", deletePayload.Data)
	}

	sendAfterDeleteResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bots/"+created.Data.BotID+"/delivery-targets/"+targetPayload.Data.ID+"/outbound-messages",
		`{"sourceType":"manual","messages":[{"text":"should fail"}]}`,
	)
	if sendAfterDeleteResponse.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when sending through deleted delivery target, got %d", sendAfterDeleteResponse.Code)
	}
}

func TestWeChatLoginRoutesStartPollAndDelete(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	var wechatServer *httptest.Server
	wechatServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/get_bot_qrcode":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":                0,
				"errcode":            0,
				"errmsg":             "",
				"qrcode":             "route-qr-1",
				"qrcode_img_content": "weixin://qr/route-qr-1",
			})
		case "/ilink/bot/get_qrcode_status":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":           0,
				"errcode":       0,
				"errmsg":        "",
				"status":        "confirmed",
				"bot_token":     "route-wechat-token",
				"ilink_bot_id":  "route-account-id",
				"baseurl":       wechatServer.URL,
				"ilink_user_id": "route-owner-id",
			})
		default:
			t.Fatalf("unexpected wechat auth path %s", r.URL.Path)
		}
	}))
	defer wechatServer.Close()

	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", eventHub)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	botService := bots.NewService(dataStore, threadService, turnService, eventHub, bots.Config{
		HTTPClient: wechatServer.Client(),
	})

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

	startResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/bot-providers/wechat/login/start",
		`{"baseUrl":"`+wechatServer.URL+`"}`,
	)
	if startResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from start wechat login, got %d", startResponse.Code)
	}

	var started struct {
		Data bots.WeChatLoginView `json:"data"`
	}
	decodeResponseBody(t, startResponse, &started)
	if started.Data.LoginID == "" || started.Data.QRCodeContent == "" {
		t.Fatalf("expected login id and qr code content, got %#v", started.Data)
	}

	statusResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/bot-providers/wechat/login/"+started.Data.LoginID,
		"",
	)
	if statusResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from get wechat login, got %d", statusResponse.Code)
	}

	var status struct {
		Data bots.WeChatLoginView `json:"data"`
	}
	decodeResponseBody(t, statusResponse, &status)
	if status.Data.Status != "confirmed" || !status.Data.CredentialReady {
		t.Fatalf("expected confirmed credential bundle, got %#v", status.Data)
	}
	if status.Data.BotToken != "route-wechat-token" || status.Data.AccountID != "route-account-id" || status.Data.UserID != "route-owner-id" {
		t.Fatalf("expected confirmed credential details, got %#v", status.Data)
	}

	accountsResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/bot-providers/wechat/accounts",
		"",
	)
	if accountsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from list wechat accounts, got %d", accountsResponse.Code)
	}

	var accounts struct {
		Data []bots.WeChatAccountView `json:"data"`
	}
	decodeResponseBody(t, accountsResponse, &accounts)
	if len(accounts.Data) != 1 {
		t.Fatalf("expected one saved wechat account after confirmed login, got %#v", accounts.Data)
	}
	if accounts.Data[0].AccountID != "route-account-id" || accounts.Data[0].UserID != "route-owner-id" || accounts.Data[0].BaseURL != wechatServer.URL {
		t.Fatalf("expected saved wechat account details, got %#v", accounts.Data[0])
	}

	updateSavedAccountResponse := performJSONRequest(
		t,
		router,
		http.MethodPatch,
		"/api/workspaces/"+workspace.ID+"/bot-providers/wechat/accounts/"+accounts.Data[0].ID,
		`{"alias":"Support Queue","note":"Primary handoff account."}`,
	)
	if updateSavedAccountResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from update wechat account, got %d", updateSavedAccountResponse.Code)
	}

	var updatedAccount struct {
		Data bots.WeChatAccountView `json:"data"`
	}
	decodeResponseBody(t, updateSavedAccountResponse, &updatedAccount)
	if updatedAccount.Data.Alias != "Support Queue" || updatedAccount.Data.Note != "Primary handoff account." {
		t.Fatalf("expected saved wechat account metadata to update, got %#v", updatedAccount.Data)
	}

	deleteSavedAccountResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/workspaces/"+workspace.ID+"/bot-providers/wechat/accounts/"+accounts.Data[0].ID,
		"",
	)
	if deleteSavedAccountResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from delete wechat account, got %d", deleteSavedAccountResponse.Code)
	}

	accountsResponse = performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/bot-providers/wechat/accounts",
		"",
	)
	if accountsResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from list wechat accounts after delete, got %d", accountsResponse.Code)
	}
	decodeResponseBody(t, accountsResponse, &accounts)
	if len(accounts.Data) != 0 {
		t.Fatalf("expected saved wechat account list to be empty after delete, got %#v", accounts.Data)
	}

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/workspaces/"+workspace.ID+"/bot-providers/wechat/login/"+started.Data.LoginID,
		"",
	)
	if deleteResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from delete wechat login, got %d", deleteResponse.Code)
	}
}

func TestBotConnectionRouteUpdatesWeChatChannelTiming(t *testing.T) {
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
	botProvider := newRouterTestNamedBotProvider("wechat")
	botService := bots.NewService(dataStore, threadService, turnService, eventHub, bots.Config{
		Providers:  []bots.Provider{botProvider},
		AIBackends: []bots.AIBackend{routerTestAIBackend{}},
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

	workspaceRecord := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bot-connections",
		`{"provider":"wechat","name":"WeChat Support","aiBackend":"fake_ai","settings":{"wechat_base_url":"https://wechat.example.com","wechat_account_id":"account-1","wechat_owner_user_id":"owner-1"},"secrets":{"bot_token":"token-1"}}`,
	)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create wechat bot connection, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)
	if created.Data.ID == "" {
		t.Fatal("expected wechat bot connection id")
	}

	updateResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bot-connections/"+created.Data.ID+"/wechat-channel-timing",
		`{"enabled":true}`,
	)
	if updateResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from wechat channel timing update, got %d", updateResponse.Code)
	}

	var updated struct {
		Data struct {
			Settings map[string]string `json:"settings"`
		} `json:"data"`
	}
	decodeResponseBody(t, updateResponse, &updated)
	if updated.Data.Settings["wechat_channel_timing"] != "enabled" {
		t.Fatalf("expected enabled wechat channel timing setting in route response, got %#v", updated.Data.Settings)
	}
}

func TestBotConnectionRouteUpdatesCommandOutputMode(t *testing.T) {
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
	botProvider := newRouterTestNamedBotProvider("telegram")
	botService := bots.NewService(dataStore, threadService, turnService, eventHub, bots.Config{
		Providers:  []bots.Provider{botProvider},
		AIBackends: []bots.AIBackend{routerTestAIBackend{}},
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

	workspaceRecord := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")

	createResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bot-connections",
		`{"provider":"telegram","name":"Telegram Support","aiBackend":"fake_ai","secrets":{"bot_token":"token-1"}}`,
	)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create telegram bot connection, got %d", createResponse.Code)
	}

	var created struct {
		Data struct {
			ID           string   `json:"id"`
			Capabilities []string `json:"capabilities"`
		} `json:"data"`
	}
	decodeResponseBody(t, createResponse, &created)
	if created.Data.ID == "" {
		t.Fatal("expected telegram bot connection id")
	}
	if !containsString(created.Data.Capabilities, "supportsMediaOutbound") ||
		!containsString(created.Data.Capabilities, "supportsMediaGroup") ||
		!containsString(created.Data.Capabilities, "supportsLocalMediaPathSource") ||
		!containsString(created.Data.Capabilities, "supportsSessionlessPush") {
		t.Fatalf("expected telegram connection capabilities in create response, got %#v", created.Data.Capabilities)
	}

	updateResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bot-connections/"+created.Data.ID+"/command-output-mode",
		`{"commandOutputMode":"none"}`,
	)
	if updateResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from command output mode update, got %d", updateResponse.Code)
	}

	var updated struct {
		Data struct {
			Settings map[string]string `json:"settings"`
		} `json:"data"`
	}
	decodeResponseBody(t, updateResponse, &updated)
	if updated.Data.Settings["command_output_mode"] != "none" {
		t.Fatalf("expected none command output mode in route response, got %#v", updated.Data.Settings)
	}
}

func TestBotSessionOutboundMessagesRouteReturnsTelegramMediaValidationCode(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	router := newTestRouter(dataStore)

	workspaceRecord := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	bot, err := dataStore.CreateBot(store.Bot{
		WorkspaceID: workspaceRecord.ID,
		Name:        "Telegram Support",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspaceRecord.ID,
		BotID:       bot.ID,
		Provider:    "telegram",
		Name:        "Telegram Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
		Secrets: map[string]string{
			"bot_token": "token-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspaceRecord.ID,
		BotID:                  bot.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-1",
		ExternalChatID:         "12345",
		ThreadID:               "thr_telegram_chat_1",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	sendResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/bots/"+bot.ID+"/sessions/"+conversation.ID+"/outbound-messages",
		`{"sourceType":"manual","messages":[{"media":[{"path":"relative/file.png","kind":"image"}]}]}`,
	)
	if sendResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 from invalid telegram outbound media route, got %d", sendResponse.Code)
	}

	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decodeResponseBody(t, sendResponse, &payload)
	if payload.Error.Code != "telegram_media_path_must_be_absolute" {
		t.Fatalf("expected telegram_media_path_must_be_absolute error code, got %#v", payload.Error)
	}
	if !strings.Contains(strings.ToLower(payload.Error.Message), "telegram media file path must be absolute") {
		t.Fatalf("expected relative path validation message, got %q", payload.Error.Message)
	}

	deliveries := dataStore.ListBotOutboundDeliveries(workspaceRecord.ID, store.BotOutboundDeliveryFilter{BotID: bot.ID})
	if len(deliveries) != 0 {
		t.Fatalf("expected no outbound deliveries to be persisted on validation failure, got %#v", deliveries)
	}
}

func TestThreadBotBindingRoutesSupportBindGetAndDelete(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	router := newTestRouter(dataStore)

	workspaceRecord := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	thread := store.Thread{
		ID:           "thr_thread_binding",
		WorkspaceID:  workspaceRecord.ID,
		Cwd:          "E:/projects/ai/codex-server",
		Materialized: true,
		Name:         "Release Thread",
		Status:       "idle",
	}
	dataStore.UpsertThread(thread)
	bot, err := dataStore.CreateBot(store.Bot{
		WorkspaceID: workspaceRecord.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspaceRecord.ID,
		BotID:       bot.ID,
		Provider:    "fakechat",
		Name:        "Ops Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:  workspaceRecord.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "conversation",
		RouteKey:     "conversation-1",
		Title:        "Customer Channel",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	upsertResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspaceRecord.ID+"/threads/"+thread.ID+"/bot-channel-binding",
		fmt.Sprintf(`{"botId":%q,"deliveryTargetId":%q}`, bot.ID, target.ID),
	)
	if upsertResponse.Code != http.StatusAccepted {
		t.Fatalf(
			"expected 202 from thread bot binding upsert, got %d with body %s",
			upsertResponse.Code,
			upsertResponse.Body.String(),
		)
	}

	var upserted struct {
		Data struct {
			ThreadID         string `json:"threadId"`
			BotID            string `json:"botId"`
			DeliveryTargetID string `json:"deliveryTargetId"`
			BotName          string `json:"botName"`
			EndpointID       string `json:"endpointId"`
			SessionID        string `json:"sessionId"`
			Status           string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, upsertResponse, &upserted)
	if upserted.Data.ThreadID != thread.ID {
		t.Fatalf("expected thread id %q, got %q", thread.ID, upserted.Data.ThreadID)
	}
	if upserted.Data.BotID != bot.ID {
		t.Fatalf("expected bot id %q, got %q", bot.ID, upserted.Data.BotID)
	}
	if upserted.Data.DeliveryTargetID != target.ID {
		t.Fatalf("expected delivery target id %q, got %q", target.ID, upserted.Data.DeliveryTargetID)
	}
	if upserted.Data.BotName != bot.Name {
		t.Fatalf("expected bot name %q, got %q", bot.Name, upserted.Data.BotName)
	}
	if upserted.Data.EndpointID != connection.ID {
		t.Fatalf("expected endpoint id %q, got %q", connection.ID, upserted.Data.EndpointID)
	}
	if upserted.Data.SessionID == "" {
		t.Fatal("expected binding response to resolve a backing session id")
	}
	if upserted.Data.Status != "active" {
		t.Fatalf("expected active binding status, got %q", upserted.Data.Status)
	}

	binding, ok := dataStore.GetThreadBotBinding(workspaceRecord.ID, thread.ID)
	if !ok {
		t.Fatal("expected thread bot binding to be stored")
	}
	if binding.BotID != bot.ID || binding.DeliveryTargetID != target.ID {
		t.Fatalf("unexpected stored thread binding %#v", binding)
	}

	conversation, conversationOK := dataStore.GetBotConversation(workspaceRecord.ID, upserted.Data.SessionID)
	if !conversationOK {
		t.Fatalf("expected synthetic conversation %q to be created", upserted.Data.SessionID)
	}
	if strings.TrimSpace(conversation.ThreadID) != thread.ID {
		t.Fatalf("expected bound conversation thread %q, got %q", thread.ID, conversation.ThreadID)
	}
	if strings.TrimSpace(conversation.BindingID) == "" {
		t.Fatal("expected bound conversation to have a session binding")
	}

	getResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspaceRecord.ID+"/threads/"+thread.ID+"/bot-channel-binding",
		"",
	)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from thread bot binding get, got %d", getResponse.Code)
	}

	var fetched struct {
		Data struct {
			ID               string `json:"id"`
			DeliveryTargetID string `json:"deliveryTargetId"`
			SessionID        string `json:"sessionId"`
		} `json:"data"`
	}
	decodeResponseBody(t, getResponse, &fetched)
	if fetched.Data.ID != binding.ID {
		t.Fatalf("expected fetched binding id %q, got %q", binding.ID, fetched.Data.ID)
	}
	if fetched.Data.DeliveryTargetID != target.ID {
		t.Fatalf("expected fetched target id %q, got %q", target.ID, fetched.Data.DeliveryTargetID)
	}
	if fetched.Data.SessionID != upserted.Data.SessionID {
		t.Fatalf("expected fetched session id %q, got %q", upserted.Data.SessionID, fetched.Data.SessionID)
	}

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/workspaces/"+workspaceRecord.ID+"/threads/"+thread.ID+"/bot-channel-binding",
		"",
	)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from thread bot binding delete, got %d", deleteResponse.Code)
	}
	if _, ok := dataStore.GetThreadBotBinding(workspaceRecord.ID, thread.ID); ok {
		t.Fatal("expected thread bot binding to be removed")
	}

	notFoundResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspaceRecord.ID+"/threads/"+thread.ID+"/bot-channel-binding",
		"",
	)
	if notFoundResponse.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after deleting thread bot binding, got %d", notFoundResponse.Code)
	}
}

func TestThreadBotBindingRoutesSupportCrossWorkspaceBindGetAndDelete(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	router := newTestRouter(dataStore)

	threadWorkspace := dataStore.CreateWorkspace("Thread Workspace", "E:/projects/thread")
	botWorkspace := dataStore.CreateWorkspace("Bot Workspace", "E:/projects/bot")
	thread := store.Thread{
		ID:           "thr_thread_binding_cross_workspace",
		WorkspaceID:  threadWorkspace.ID,
		Cwd:          "E:/projects/thread",
		Materialized: true,
		Name:         "Release Thread",
		Status:       "idle",
	}
	dataStore.UpsertThread(thread)
	bot, err := dataStore.CreateBot(store.Bot{
		WorkspaceID: botWorkspace.ID,
		Name:        "Ops Bot",
		Status:      "active",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: botWorkspace.ID,
		BotID:       bot.ID,
		Provider:    "fakechat",
		Name:        "Ops Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:  botWorkspace.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "conversation",
		RouteKey:     "conversation-cross-workspace-1",
		Title:        "Customer Channel",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	upsertResponse := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+threadWorkspace.ID+"/threads/"+thread.ID+"/bot-channel-binding",
		fmt.Sprintf(`{"botWorkspaceId":%q,"botId":%q,"deliveryTargetId":%q}`, botWorkspace.ID, bot.ID, target.ID),
	)
	if upsertResponse.Code != http.StatusAccepted {
		t.Fatalf(
			"expected 202 from cross-workspace thread bot binding upsert, got %d with body %s",
			upsertResponse.Code,
			upsertResponse.Body.String(),
		)
	}

	var upserted struct {
		Data struct {
			ThreadID         string `json:"threadId"`
			BotWorkspaceID   string `json:"botWorkspaceId"`
			BotID            string `json:"botId"`
			DeliveryTargetID string `json:"deliveryTargetId"`
			SessionID        string `json:"sessionId"`
			Status           string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, upsertResponse, &upserted)
	if upserted.Data.ThreadID != thread.ID {
		t.Fatalf("expected thread id %q, got %q", thread.ID, upserted.Data.ThreadID)
	}
	if upserted.Data.BotWorkspaceID != botWorkspace.ID {
		t.Fatalf("expected bot workspace id %q, got %q", botWorkspace.ID, upserted.Data.BotWorkspaceID)
	}
	if upserted.Data.BotID != bot.ID {
		t.Fatalf("expected bot id %q, got %q", bot.ID, upserted.Data.BotID)
	}
	if upserted.Data.DeliveryTargetID != target.ID {
		t.Fatalf("expected delivery target id %q, got %q", target.ID, upserted.Data.DeliveryTargetID)
	}
	if upserted.Data.SessionID == "" {
		t.Fatal("expected binding response to resolve a backing session id")
	}
	if upserted.Data.Status != "active" {
		t.Fatalf("expected active binding status, got %q", upserted.Data.Status)
	}

	binding, ok := dataStore.GetThreadBotBinding(threadWorkspace.ID, thread.ID)
	if !ok {
		t.Fatal("expected cross-workspace thread bot binding to be stored")
	}
	if binding.BotWorkspaceID != botWorkspace.ID || binding.BotID != bot.ID || binding.DeliveryTargetID != target.ID {
		t.Fatalf("unexpected stored cross-workspace thread binding %#v", binding)
	}

	conversation, conversationOK := dataStore.GetBotConversation(botWorkspace.ID, upserted.Data.SessionID)
	if !conversationOK {
		t.Fatalf("expected synthetic conversation %q to be created in bot workspace", upserted.Data.SessionID)
	}
	if strings.TrimSpace(conversation.ThreadID) != thread.ID {
		t.Fatalf("expected bound conversation thread %q, got %q", thread.ID, conversation.ThreadID)
	}
	if strings.TrimSpace(conversation.BindingID) == "" {
		t.Fatal("expected bound conversation to have a session binding")
	}

	getResponse := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+threadWorkspace.ID+"/threads/"+thread.ID+"/bot-channel-binding",
		"",
	)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from cross-workspace thread bot binding get, got %d", getResponse.Code)
	}

	var fetched struct {
		Data struct {
			ID             string `json:"id"`
			BotWorkspaceID string `json:"botWorkspaceId"`
			SessionID      string `json:"sessionId"`
		} `json:"data"`
	}
	decodeResponseBody(t, getResponse, &fetched)
	if fetched.Data.ID != binding.ID {
		t.Fatalf("expected fetched binding id %q, got %q", binding.ID, fetched.Data.ID)
	}
	if fetched.Data.BotWorkspaceID != botWorkspace.ID {
		t.Fatalf("expected fetched bot workspace id %q, got %q", botWorkspace.ID, fetched.Data.BotWorkspaceID)
	}
	if fetched.Data.SessionID != upserted.Data.SessionID {
		t.Fatalf("expected fetched session id %q, got %q", upserted.Data.SessionID, fetched.Data.SessionID)
	}

	deleteResponse := performJSONRequest(
		t,
		router,
		http.MethodDelete,
		"/api/workspaces/"+threadWorkspace.ID+"/threads/"+thread.ID+"/bot-channel-binding",
		"",
	)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from cross-workspace thread bot binding delete, got %d", deleteResponse.Code)
	}
	if _, ok := dataStore.GetThreadBotBinding(threadWorkspace.ID, thread.ID); ok {
		t.Fatal("expected cross-workspace thread bot binding to be removed")
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

func TestRuntimePreferencesRoutePersistsHookGovernanceConfig(t *testing.T) {
	t.Parallel()

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
		`{"hookSessionStartEnabled":false,"hookSessionStartContextPaths":[" docs/session-start.md ","README.md","docs\\session-start.md"],"hookSessionStartMaxChars":512,"hookUserPromptSubmitBlockSecretPasteEnabled":false,"hookPreToolUseBlockDangerousCommandEnabled":false,"hookPreToolUseAdditionalProtectedGovernancePaths":[" docs\\governance.md ","runtime/policy.md","./runtime/policy.md"]}`,
	)
	if writeResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from runtime preferences write, got %d", writeResponse.Code)
	}

	var written struct {
		Data struct {
			ConfiguredHookSessionStartEnabled                          *bool    `json:"configuredHookSessionStartEnabled"`
			ConfiguredHookSessionStartContextPaths                     []string `json:"configuredHookSessionStartContextPaths"`
			ConfiguredHookSessionStartMaxChars                         *int     `json:"configuredHookSessionStartMaxChars"`
			ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled      *bool    `json:"configuredHookUserPromptSubmitBlockSecretPasteEnabled"`
			ConfiguredHookPreToolUseBlockDangerousCommandEnabled       *bool    `json:"configuredHookPreToolUseBlockDangerousCommandEnabled"`
			ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths []string `json:"configuredHookPreToolUseAdditionalProtectedGovernancePaths"`
			EffectiveHookSessionStartEnabled                           bool     `json:"effectiveHookSessionStartEnabled"`
			EffectiveHookSessionStartContextPaths                      []string `json:"effectiveHookSessionStartContextPaths"`
			EffectiveHookSessionStartMaxChars                          int      `json:"effectiveHookSessionStartMaxChars"`
			EffectiveHookUserPromptSubmitBlockSecretPasteEnabled       bool     `json:"effectiveHookUserPromptSubmitBlockSecretPasteEnabled"`
			EffectiveHookPreToolUseBlockDangerousCommandEnabled        bool     `json:"effectiveHookPreToolUseBlockDangerousCommandEnabled"`
			EffectiveHookPreToolUseProtectedGovernancePaths            []string `json:"effectiveHookPreToolUseProtectedGovernancePaths"`
		} `json:"data"`
	}
	decodeResponseBody(t, writeResponse, &written)

	wantPaths := []string{"docs/session-start.md", "README.md"}
	if written.Data.ConfiguredHookSessionStartEnabled == nil || *written.Data.ConfiguredHookSessionStartEnabled {
		t.Fatalf("unexpected configured session-start enabled %#v", written.Data.ConfiguredHookSessionStartEnabled)
	}
	if written.Data.ConfiguredHookSessionStartMaxChars == nil || *written.Data.ConfiguredHookSessionStartMaxChars != 512 {
		t.Fatalf("unexpected configured session-start max chars %#v", written.Data.ConfiguredHookSessionStartMaxChars)
	}
	if written.Data.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled == nil || *written.Data.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("unexpected configured secret-block override %#v", written.Data.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if written.Data.ConfiguredHookPreToolUseBlockDangerousCommandEnabled == nil || *written.Data.ConfiguredHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("unexpected configured dangerous-command override %#v", written.Data.ConfiguredHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !reflect.DeepEqual(written.Data.ConfiguredHookSessionStartContextPaths, wantPaths) {
		t.Fatalf("unexpected configured session-start context paths %#v", written.Data.ConfiguredHookSessionStartContextPaths)
	}
	if !reflect.DeepEqual(
		written.Data.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		[]string{"docs/governance.md", "runtime/policy.md"},
	) {
		t.Fatalf(
			"unexpected configured protected governance paths %#v",
			written.Data.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}
	if written.Data.EffectiveHookSessionStartEnabled {
		t.Fatalf("expected effective session-start to be disabled")
	}
	if written.Data.EffectiveHookSessionStartMaxChars != 512 {
		t.Fatalf("unexpected effective session-start max chars %d", written.Data.EffectiveHookSessionStartMaxChars)
	}
	if written.Data.EffectiveHookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("expected effective secret-block to be disabled")
	}
	if written.Data.EffectiveHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("expected effective dangerous-command block to be disabled")
	}
	if !containsString(written.Data.EffectiveHookPreToolUseProtectedGovernancePaths, "docs/governance.md") {
		t.Fatalf(
			"expected effective protected governance paths to include docs/governance.md, got %#v",
			written.Data.EffectiveHookPreToolUseProtectedGovernancePaths,
		)
	}
	if !containsString(written.Data.EffectiveHookPreToolUseProtectedGovernancePaths, "runtime/policy.md") {
		t.Fatalf(
			"expected effective protected governance paths to include runtime/policy.md, got %#v",
			written.Data.EffectiveHookPreToolUseProtectedGovernancePaths,
		)
	}
	if !reflect.DeepEqual(written.Data.EffectiveHookSessionStartContextPaths, wantPaths) {
		t.Fatalf("unexpected effective session-start context paths %#v", written.Data.EffectiveHookSessionStartContextPaths)
	}

	readResponse := performJSONRequest(t, router, http.MethodGet, "/api/runtime/preferences", "")
	if readResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from runtime preferences read, got %d", readResponse.Code)
	}

	var readBack struct {
		Data struct {
			ConfiguredHookSessionStartEnabled                          *bool    `json:"configuredHookSessionStartEnabled"`
			ConfiguredHookSessionStartContextPaths                     []string `json:"configuredHookSessionStartContextPaths"`
			ConfiguredHookSessionStartMaxChars                         *int     `json:"configuredHookSessionStartMaxChars"`
			ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths []string `json:"configuredHookPreToolUseAdditionalProtectedGovernancePaths"`
		} `json:"data"`
	}
	decodeResponseBody(t, readResponse, &readBack)
	if readBack.Data.ConfiguredHookSessionStartEnabled == nil || *readBack.Data.ConfiguredHookSessionStartEnabled {
		t.Fatalf("unexpected persisted session-start enabled %#v", readBack.Data.ConfiguredHookSessionStartEnabled)
	}
	if readBack.Data.ConfiguredHookSessionStartMaxChars == nil || *readBack.Data.ConfiguredHookSessionStartMaxChars != 512 {
		t.Fatalf("unexpected persisted session-start max chars %#v", readBack.Data.ConfiguredHookSessionStartMaxChars)
	}
	if !reflect.DeepEqual(readBack.Data.ConfiguredHookSessionStartContextPaths, wantPaths) {
		t.Fatalf("unexpected persisted session-start context paths %#v", readBack.Data.ConfiguredHookSessionStartContextPaths)
	}
	if !reflect.DeepEqual(
		readBack.Data.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		[]string{"docs/governance.md", "runtime/policy.md"},
	) {
		t.Fatalf(
			"unexpected persisted protected governance paths %#v",
			readBack.Data.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}
}

func TestRuntimePreferencesRoutePersistsLocalhostBypassSetting(t *testing.T) {
	t.Parallel()

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
		`{"allowLocalhostWithoutAccessToken":true}`,
	)
	if writeResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from runtime preferences write, got %d", writeResponse.Code)
	}

	var written struct {
		Data struct {
			ConfiguredAllowLocalhostWithoutAccessToken *bool `json:"configuredAllowLocalhostWithoutAccessToken"`
			EffectiveAllowLocalhostWithoutAccessToken  bool  `json:"effectiveAllowLocalhostWithoutAccessToken"`
		} `json:"data"`
	}
	decodeResponseBody(t, writeResponse, &written)

	if written.Data.ConfiguredAllowLocalhostWithoutAccessToken == nil || !*written.Data.ConfiguredAllowLocalhostWithoutAccessToken {
		t.Fatalf("expected explicit localhost bypass enable flag, got %#v", written.Data.ConfiguredAllowLocalhostWithoutAccessToken)
	}
	if !written.Data.EffectiveAllowLocalhostWithoutAccessToken {
		t.Fatal("expected effective localhost bypass to be enabled")
	}

	readResponse := performJSONRequest(t, router, http.MethodGet, "/api/runtime/preferences", "")
	if readResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from runtime preferences read, got %d", readResponse.Code)
	}

	var readBack struct {
		Data struct {
			ConfiguredAllowLocalhostWithoutAccessToken *bool `json:"configuredAllowLocalhostWithoutAccessToken"`
		} `json:"data"`
	}
	decodeResponseBody(t, readResponse, &readBack)
	if readBack.Data.ConfiguredAllowLocalhostWithoutAccessToken == nil || !*readBack.Data.ConfiguredAllowLocalhostWithoutAccessToken {
		t.Fatalf("expected persisted localhost bypass enable flag, got %#v", readBack.Data.ConfiguredAllowLocalhostWithoutAccessToken)
	}
}

func TestRuntimePreferencesRoutePersistsTurnPolicyAlertThresholds(t *testing.T) {
	t.Parallel()

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
		`{"turnPolicyPostToolUseFailedValidationEnabled":false,"turnPolicyStopMissingSuccessfulVerificationEnabled":false,"turnPolicyFollowUpCooldownMs":45000,"turnPolicyPostToolUseFollowUpCooldownMs":0,"turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs":120000,"turnPolicyAlertCoverageThresholdPercent":65,"turnPolicyAlertPostToolUseLatencyP95ThresholdMs":2400,"turnPolicyAlertStopLatencyP95ThresholdMs":3100,"turnPolicyAlertSourceActionSuccessThresholdPercent":72}`,
	)
	if writeResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from runtime preferences write, got %d", writeResponse.Code)
	}

	var written struct {
		Data struct {
			ConfiguredTurnPolicyPostToolUseFailedValidationEnabled                  *bool  `json:"configuredTurnPolicyPostToolUseFailedValidationEnabled"`
			ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled            *bool  `json:"configuredTurnPolicyStopMissingSuccessfulVerificationEnabled"`
			ConfiguredTurnPolicyFollowUpCooldownMs                                  *int64 `json:"configuredTurnPolicyFollowUpCooldownMs"`
			ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs                       *int64 `json:"configuredTurnPolicyPostToolUseFollowUpCooldownMs"`
			ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs *int64 `json:"configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs"`
			ConfiguredTurnPolicyAlertCoverageThresholdPercent                       *int   `json:"configuredTurnPolicyAlertCoverageThresholdPercent"`
			ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs               *int64 `json:"configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs"`
			ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs                      *int64 `json:"configuredTurnPolicyAlertStopLatencyP95ThresholdMs"`
			ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent            *int   `json:"configuredTurnPolicyAlertSourceActionSuccessThresholdPercent"`
			EffectiveTurnPolicyPostToolUseFailedValidationEnabled                   bool   `json:"effectiveTurnPolicyPostToolUseFailedValidationEnabled"`
			EffectiveTurnPolicyStopMissingSuccessfulVerificationEnabled             bool   `json:"effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled"`
			EffectiveTurnPolicyFollowUpCooldownMs                                   int64  `json:"effectiveTurnPolicyFollowUpCooldownMs"`
			EffectiveTurnPolicyPostToolUseFollowUpCooldownMs                        int64  `json:"effectiveTurnPolicyPostToolUseFollowUpCooldownMs"`
			EffectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs  int64  `json:"effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs"`
			EffectiveTurnPolicyAlertCoverageThresholdPercent                        int    `json:"effectiveTurnPolicyAlertCoverageThresholdPercent"`
			EffectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs                int64  `json:"effectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs"`
			EffectiveTurnPolicyAlertStopLatencyP95ThresholdMs                       int64  `json:"effectiveTurnPolicyAlertStopLatencyP95ThresholdMs"`
			EffectiveTurnPolicyAlertSourceActionSuccessThresholdPercent             int    `json:"effectiveTurnPolicyAlertSourceActionSuccessThresholdPercent"`
		} `json:"data"`
	}
	decodeResponseBody(t, writeResponse, &written)

	if written.Data.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled == nil || *written.Data.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled {
		t.Fatalf("unexpected configured post-tool-use policy override %#v", written.Data.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled)
	}
	if written.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled == nil || *written.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled {
		t.Fatalf("unexpected configured stop-missing-verify policy override %#v", written.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled)
	}
	if written.Data.ConfiguredTurnPolicyFollowUpCooldownMs == nil || *written.Data.ConfiguredTurnPolicyFollowUpCooldownMs != 45000 {
		t.Fatalf("unexpected configured follow-up cooldown %#v", written.Data.ConfiguredTurnPolicyFollowUpCooldownMs)
	}
	if written.Data.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs == nil || *written.Data.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs != 0 {
		t.Fatalf("unexpected configured post-tool-use follow-up cooldown %#v", written.Data.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs)
	}
	if written.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs == nil || *written.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != 120000 {
		t.Fatalf("unexpected configured stop-missing-verify follow-up cooldown %#v", written.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	}
	if written.Data.ConfiguredTurnPolicyAlertCoverageThresholdPercent == nil || *written.Data.ConfiguredTurnPolicyAlertCoverageThresholdPercent != 65 {
		t.Fatalf("unexpected configured coverage threshold %#v", written.Data.ConfiguredTurnPolicyAlertCoverageThresholdPercent)
	}
	if written.Data.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs == nil || *written.Data.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs != 2400 {
		t.Fatalf("unexpected configured post-tool-use latency threshold %#v", written.Data.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	}
	if written.Data.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs == nil || *written.Data.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs != 3100 {
		t.Fatalf("unexpected configured stop latency threshold %#v", written.Data.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs)
	}
	if written.Data.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent == nil || *written.Data.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent != 72 {
		t.Fatalf("unexpected configured source success threshold %#v", written.Data.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent)
	}
	if written.Data.EffectiveTurnPolicyPostToolUseFailedValidationEnabled ||
		written.Data.EffectiveTurnPolicyStopMissingSuccessfulVerificationEnabled ||
		written.Data.EffectiveTurnPolicyFollowUpCooldownMs != 45000 ||
		written.Data.EffectiveTurnPolicyPostToolUseFollowUpCooldownMs != 0 ||
		written.Data.EffectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != 120000 ||
		written.Data.EffectiveTurnPolicyAlertCoverageThresholdPercent != 65 ||
		written.Data.EffectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs != 2400 ||
		written.Data.EffectiveTurnPolicyAlertStopLatencyP95ThresholdMs != 3100 ||
		written.Data.EffectiveTurnPolicyAlertSourceActionSuccessThresholdPercent != 72 {
		t.Fatalf("unexpected effective thresholds %#v", written.Data)
	}

	readResponse := performJSONRequest(t, router, http.MethodGet, "/api/runtime/preferences", "")
	if readResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from runtime preferences read, got %d", readResponse.Code)
	}

	var readBack struct {
		Data struct {
			ConfiguredTurnPolicyPostToolUseFailedValidationEnabled                  *bool  `json:"configuredTurnPolicyPostToolUseFailedValidationEnabled"`
			ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled            *bool  `json:"configuredTurnPolicyStopMissingSuccessfulVerificationEnabled"`
			ConfiguredTurnPolicyFollowUpCooldownMs                                  *int64 `json:"configuredTurnPolicyFollowUpCooldownMs"`
			ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs                       *int64 `json:"configuredTurnPolicyPostToolUseFollowUpCooldownMs"`
			ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs *int64 `json:"configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs"`
			ConfiguredTurnPolicyAlertCoverageThresholdPercent                       *int   `json:"configuredTurnPolicyAlertCoverageThresholdPercent"`
			ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs               *int64 `json:"configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs"`
			ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs                      *int64 `json:"configuredTurnPolicyAlertStopLatencyP95ThresholdMs"`
			ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent            *int   `json:"configuredTurnPolicyAlertSourceActionSuccessThresholdPercent"`
		} `json:"data"`
	}
	decodeResponseBody(t, readResponse, &readBack)

	if readBack.Data.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled == nil || *readBack.Data.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled {
		t.Fatalf("unexpected persisted post-tool-use policy override %#v", readBack.Data.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled)
	}
	if readBack.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled == nil || *readBack.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled {
		t.Fatalf("unexpected persisted stop-missing-verify policy override %#v", readBack.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled)
	}
	if readBack.Data.ConfiguredTurnPolicyFollowUpCooldownMs == nil || *readBack.Data.ConfiguredTurnPolicyFollowUpCooldownMs != 45000 {
		t.Fatalf("unexpected persisted follow-up cooldown %#v", readBack.Data.ConfiguredTurnPolicyFollowUpCooldownMs)
	}
	if readBack.Data.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs == nil || *readBack.Data.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs != 0 {
		t.Fatalf("unexpected persisted post-tool-use follow-up cooldown %#v", readBack.Data.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs)
	}
	if readBack.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs == nil || *readBack.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != 120000 {
		t.Fatalf("unexpected persisted stop-missing-verify follow-up cooldown %#v", readBack.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	}
	if readBack.Data.ConfiguredTurnPolicyAlertCoverageThresholdPercent == nil || *readBack.Data.ConfiguredTurnPolicyAlertCoverageThresholdPercent != 65 {
		t.Fatalf("unexpected persisted coverage threshold %#v", readBack.Data.ConfiguredTurnPolicyAlertCoverageThresholdPercent)
	}
	if readBack.Data.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs == nil || *readBack.Data.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs != 2400 {
		t.Fatalf("unexpected persisted post-tool-use latency threshold %#v", readBack.Data.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	}
	if readBack.Data.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs == nil || *readBack.Data.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs != 3100 {
		t.Fatalf("unexpected persisted stop latency threshold %#v", readBack.Data.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs)
	}
	if readBack.Data.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent == nil || *readBack.Data.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent != 72 {
		t.Fatalf("unexpected persisted source success threshold %#v", readBack.Data.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent)
	}
}

func TestRuntimePreferencesRoutePersistsInterruptFallbackBehavior(t *testing.T) {
	t.Parallel()

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
		`{"turnPolicyPostToolUsePrimaryAction":"interrupt","turnPolicyPostToolUseInterruptNoActiveTurnBehavior":"followUp","turnPolicyStopMissingSuccessfulVerificationPrimaryAction":"interrupt","turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior":"skip"}`,
	)
	if writeResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from runtime preferences write, got %d", writeResponse.Code)
	}

	var written struct {
		Data struct {
			ConfiguredTurnPolicyPostToolUsePrimaryAction                                       string `json:"configuredTurnPolicyPostToolUsePrimaryAction"`
			ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior                       string `json:"configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior"`
			ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction                 string `json:"configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction"`
			ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior string `json:"configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"`
			EffectiveTurnPolicyPostToolUsePrimaryAction                                        string `json:"effectiveTurnPolicyPostToolUsePrimaryAction"`
			EffectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior                        string `json:"effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior"`
			EffectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction                  string `json:"effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction"`
			EffectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior  string `json:"effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"`
		} `json:"data"`
	}
	decodeResponseBody(t, writeResponse, &written)

	if written.Data.ConfiguredTurnPolicyPostToolUsePrimaryAction != "interrupt" ||
		written.Data.ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior != "followUp" ||
		written.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction != "interrupt" ||
		written.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != "skip" {
		t.Fatalf("unexpected configured interrupt fallback payload %#v", written.Data)
	}
	if written.Data.EffectiveTurnPolicyPostToolUsePrimaryAction != "interrupt" ||
		written.Data.EffectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior != "followUp" ||
		written.Data.EffectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction != "interrupt" ||
		written.Data.EffectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != "skip" {
		t.Fatalf("unexpected effective interrupt fallback payload %#v", written.Data)
	}

	readResponse := performJSONRequest(t, router, http.MethodGet, "/api/runtime/preferences", "")
	if readResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from runtime preferences read, got %d", readResponse.Code)
	}

	var readBack struct {
		Data struct {
			ConfiguredTurnPolicyPostToolUsePrimaryAction                                       string `json:"configuredTurnPolicyPostToolUsePrimaryAction"`
			ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior                       string `json:"configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior"`
			ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction                 string `json:"configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction"`
			ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior string `json:"configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"`
		} `json:"data"`
	}
	decodeResponseBody(t, readResponse, &readBack)

	if readBack.Data.ConfiguredTurnPolicyPostToolUsePrimaryAction != "interrupt" ||
		readBack.Data.ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior != "followUp" ||
		readBack.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction != "interrupt" ||
		readBack.Data.ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != "skip" {
		t.Fatalf("unexpected persisted interrupt fallback payload %#v", readBack.Data)
	}
}

func TestRuntimePreferencesRouteRecordsTurnPolicyAlertGovernanceHistory(t *testing.T) {
	t.Parallel()

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
		`{"turnPolicyAlertAcknowledgedCodes":["failed_actions_detected"],"turnPolicyAlertGovernanceEvent":{"action":"acknowledge","source":"workspace-overview","codes":["failed_actions_detected"]}}`,
	)
	if writeResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from runtime preferences write, got %d", writeResponse.Code)
	}

	var written struct {
		Data struct {
			TurnPolicyAlertGovernanceHistory []struct {
				ID        string     `json:"id"`
				Action    string     `json:"action"`
				Source    string     `json:"source"`
				Codes     []string   `json:"codes"`
				CreatedAt *time.Time `json:"createdAt"`
			} `json:"turnPolicyAlertGovernanceHistory"`
		} `json:"data"`
	}
	decodeResponseBody(t, writeResponse, &written)
	if len(written.Data.TurnPolicyAlertGovernanceHistory) != 1 {
		t.Fatalf("expected 1 governance event, got %#v", written.Data.TurnPolicyAlertGovernanceHistory)
	}
	event := written.Data.TurnPolicyAlertGovernanceHistory[0]
	if event.Action != "acknowledge" || event.Source != "workspace-overview" {
		t.Fatalf("unexpected governance event %#v", event)
	}
	if len(event.Codes) != 1 || event.Codes[0] != "failed_actions_detected" {
		t.Fatalf("unexpected governance event codes %#v", event)
	}
	if event.ID == "" || event.CreatedAt == nil || event.CreatedAt.IsZero() {
		t.Fatalf("expected governance event metadata to be populated, got %#v", event)
	}

	readResponse := performJSONRequest(t, router, http.MethodGet, "/api/runtime/preferences", "")
	if readResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from runtime preferences read, got %d", readResponse.Code)
	}

	var readBack struct {
		Data struct {
			TurnPolicyAlertGovernanceHistory []struct {
				Action string `json:"action"`
				Source string `json:"source"`
			} `json:"turnPolicyAlertGovernanceHistory"`
		} `json:"data"`
	}
	decodeResponseBody(t, readResponse, &readBack)
	if len(readBack.Data.TurnPolicyAlertGovernanceHistory) != 1 {
		t.Fatalf("expected persisted governance event, got %#v", readBack.Data.TurnPolicyAlertGovernanceHistory)
	}
	if readBack.Data.TurnPolicyAlertGovernanceHistory[0].Action != "acknowledge" ||
		readBack.Data.TurnPolicyAlertGovernanceHistory[0].Source != "workspace-overview" {
		t.Fatalf("unexpected persisted governance history %#v", readBack.Data.TurnPolicyAlertGovernanceHistory)
	}
}

func TestRuntimeMemoryRouteReportsThreadProjectionHotspots(t *testing.T) {
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

	seedRouterMetricsThreadProjection(dataStore, created.Data.ID, "thr_memory_hotspot", []store.ThreadTurn{
		{
			ID:     "turn_hotspot",
			Status: "completed",
			Items: []map[string]any{
				map[string]any{
					"id":               "cmd_hotspot",
					"type":             "commandExecution",
					"status":           "completed",
					"command":          "go test ./...",
					"aggregatedOutput": strings.Repeat("command-output-line\n", 128),
				},
				map[string]any{
					"id":     "msg_hotspot",
					"type":   "agentMessage",
					"status": "completed",
					"text":   "done",
				},
			},
		},
	})

	response := performJSONRequest(t, router, http.MethodGet, "/api/runtime/memory?top=2&gc=true", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from runtime memory route, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			ForceGC  bool     `json:"forceGc"`
			Findings []string `json:"findings"`
			Store    struct {
				SerializedBytes struct {
					ThreadProjections int64 `json:"threadProjections"`
				} `json:"serializedBytes"`
				Threads struct {
					ProjectionCount int `json:"projectionCount"`
					ItemTypes       []struct {
						Type       string `json:"type"`
						Count      int    `json:"count"`
						TotalBytes int64  `json:"totalBytes"`
					} `json:"itemTypes"`
					Largest []struct {
						ThreadID  string `json:"threadId"`
						JSONBytes int64  `json:"jsonBytes"`
					} `json:"largest"`
				} `json:"threads"`
			} `json:"store"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)

	if !payload.Data.ForceGC {
		t.Fatal("expected forceGc flag to round-trip from query")
	}
	if payload.Data.Store.SerializedBytes.ThreadProjections <= 0 {
		t.Fatalf("expected thread projection bytes to be reported, got %#v", payload.Data.Store.SerializedBytes.ThreadProjections)
	}
	if payload.Data.Store.Threads.ProjectionCount != 1 {
		t.Fatalf("expected one projected thread, got %#v", payload.Data.Store.Threads.ProjectionCount)
	}
	if len(payload.Data.Store.Threads.Largest) != 1 || payload.Data.Store.Threads.Largest[0].ThreadID != "thr_memory_hotspot" {
		t.Fatalf("expected hotspot thread to be reported, got %#v", payload.Data.Store.Threads.Largest)
	}
	if len(payload.Data.Store.Threads.ItemTypes) == 0 || payload.Data.Store.Threads.ItemTypes[0].Type != "commandExecution" {
		t.Fatalf("expected commandExecution to dominate item type stats, got %#v", payload.Data.Store.Threads.ItemTypes)
	}
	if len(payload.Data.Findings) == 0 {
		t.Fatal("expected findings to explain the main memory hotspots")
	}
}

func TestRuntimeMemoryHeapProfileRouteReturnsProfile(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	router := newTestRouter(dataStore)
	response := performJSONRequest(t, router, http.MethodGet, "/api/runtime/memory/heap?debug=1&gc=true", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from runtime memory heap route, got %d", response.Code)
	}

	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/plain") {
		t.Fatalf("expected text/plain heap profile response, got %q", got)
	}
	if got := response.Header().Get("Content-Disposition"); !strings.Contains(got, "codex-server-heap.txt") {
		t.Fatalf("expected heap profile attachment header, got %q", got)
	}
	if response.Body.Len() == 0 {
		t.Fatal("expected heap profile body to be non-empty")
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

	waitForCondition(t, func() bool {
		runs := dataStore.ListHookRuns(created.Data.ID, "thread-idle")
		run, ok := findHookRunByEventAndHandler(runs, "TurnInterrupt", "builtin.turninterrupt.audit-thread-interrupt")
		return ok && run.Status == "completed"
	})

	runs := dataStore.ListHookRuns(created.Data.ID, "thread-idle")
	run, ok := findHookRunByEventAndHandler(runs, "TurnInterrupt", "builtin.turninterrupt.audit-thread-interrupt")
	if !ok {
		t.Fatalf("expected dedicated interrupt hook run, got %#v", runs)
	}
	if run.TriggerMethod != "turn/interrupt" || run.ToolName != "turn/interrupt" {
		t.Fatalf("unexpected interrupt hook metadata %#v", run)
	}
	if run.Reason != "interrupt_no_active_turn" || !strings.Contains(run.AdditionalContext, "activeTurn=false") {
		t.Fatalf("unexpected interrupt hook audit outcome %#v", run)
	}
	if run.ItemID == "" {
		t.Fatalf("expected interrupt hook run to carry request id, got %#v", run)
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
	request.RemoteAddr = "127.0.0.1:41000"
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

func TestStartTurnBlocksSecretLikePrompt(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	now := time.Date(2026, time.April, 10, 9, 0, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          `E:\projects\ai\codex-server`,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads/thread-1/turns",
		`{"input":"请直接使用这个 key: sk-proj-abcDEF1234567890xyzUVW9876543210"} `,
	)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when user prompt contains a secret, got %d", response.Code)
	}

	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Error.Code != "userprompt_blocked" {
		t.Fatalf("expected userprompt_blocked error code, got %#v", payload.Error)
	}
	if !strings.Contains(payload.Error.Message, "remove the secret") {
		t.Fatalf("expected secret-removal guidance, got %#v", payload.Error)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].EventName != "UserPromptSubmit" || runs[0].HandlerKey != "builtin.userpromptsubmit.block-secret-paste" {
		t.Fatalf("expected user prompt hook run, got %#v", runs[0])
	}
}

func TestStartTurnRecordsSessionStartHookRunForFirstTurn(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	now := time.Date(2026, time.April, 10, 9, 2, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-session-start",
		WorkspaceID:  workspace.ID,
		Cwd:          `E:\projects\ai\codex-server`,
		Materialized: true,
		Name:         "Thread Session Start",
		Status:       "idle",
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads/thread-session-start/turns",
		`{"input":"请继续完善 hooks 机制"}`,
	)

	if response.Code == http.StatusBadRequest {
		t.Fatalf("expected start turn request to pass request validation, got %d", response.Code)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-session-start")
	if len(runs) == 0 {
		t.Fatalf("expected session-start hook run to be recorded before turn/start, got %#v", runs)
	}
	sessionRun, ok := findHookRunByEventAndHandler(runs, "SessionStart", "builtin.sessionstart.inject-project-context")
	if !ok {
		t.Fatalf("expected session-start hook run, got %#v", runs)
	}
	if !strings.Contains(sessionRun.AdditionalContext, "基于 `Go + React + Vite + codex app-server` 的 Web 版 Codex 应用。") {
		t.Fatalf("expected session-start hook to persist project context excerpt, got %#v", sessionRun)
	}
	startRun, ok := findHookRunByEventAndHandler(runs, "TurnStart", "builtin.turnstart.audit-thread-turn-start")
	if !ok {
		t.Fatalf("expected dedicated turn-start hook run, got %#v", runs)
	}
	if startRun.TriggerMethod != "turn/start" || startRun.ToolName != "turn/start" {
		t.Fatalf("unexpected turn-start hook metadata %#v", startRun)
	}
	if _, ok := findHookRunByEventAndHandler(runs, "HttpMutation", "builtin.httpmutation.audit-workspace-mutation"); ok {
		t.Fatalf("expected turn/start hooks path to avoid legacy HttpMutation audit, got %#v", runs)
	}
}

func TestStartTurnRouteSendsResponsesAPIClientMetadata(t *testing.T) {
	t.Parallel()

	session := codexfake.NewSession(t, "TestCodexFakeHelperProcess")

	dataStore := store.NewMemoryStore()
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimeManager := runtime.NewManager(session.Command, eventHub)
	runtimePrefsService := runtimeprefs.NewService(
		dataStore,
		runtimeManager,
		session.Command,
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	hookService := hooks.NewService(dataStore, turnService, eventHub)
	botService := bots.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "bot/webhook", "thread"),
		eventHub,
		bots.Config{},
	)
	automationService := automations.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "automation/run", "thread"),
		eventHub,
	)
	turnPolicyService := turnpolicies.NewService(dataStore, turnService, eventHub)
	turnPolicyService.SetHooksPrimary(true)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub, dataStore)
	memoryDiagService := memorydiag.NewService(dataStore)
	accessControlService := accesscontrol.NewService(dataStore, true)
	runtimeManager.SetServerRequestInterceptor(hookService)

	router := NewRouter(Dependencies{
		FrontendOrigin:    "http://localhost:15173",
		Auth:              authService,
		Workspaces:        workspaceService,
		Bots:              botService,
		Automations:       automationService,
		Notifications:     notifications.NewService(dataStore),
		Hooks:             hookService,
		TurnPolicies:      turnPolicyService,
		Threads:           threadService,
		Turns:             turnService,
		Approvals:         approvalsService,
		Catalog:           catalog.NewService(runtimeManager, runtimePrefsService),
		ConfigFS:          configFSService,
		ExecFS:            execfsService,
		Feedback:          feedbackService,
		Events:            eventHub,
		RuntimePrefs:      runtimePrefsService,
		MemoryDiagnostics: memoryDiagService,
		AccessControl:     accessControlService,
	})

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	runtimeManager.Configure(workspace.ID, `E:\projects\ai\codex-server`)
	now := time.Date(2026, time.April, 11, 4, 0, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-1",
		WorkspaceID:  workspace.ID,
		Cwd:          `E:\projects\ai\codex-server`,
		Materialized: true,
		Name:         "Thread 1",
		Status:       "idle",
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads/thread-1/turns",
		`{"input":"Inspect the repo"}`,
	)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from start turn route, got %d", response.Code)
	}

	state := codexfake.ReadState(t, session.StateFile)
	metadata, ok := state.LastTurn["responsesapiClientMetadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected responsesapiClientMetadata in route turn/start payload, got %#v", state.LastTurn["responsesapiClientMetadata"])
	}
	if metadata["source"] != "interactive" {
		t.Fatalf("expected interactive metadata source, got %#v", metadata["source"])
	}
	if metadata["origin"] != "codex-server-web" {
		t.Fatalf("expected codex-server-web metadata origin, got %#v", metadata["origin"])
	}
	if metadata["workspaceId"] != workspace.ID {
		t.Fatalf("expected workspaceId %q, got %#v", workspace.ID, metadata["workspaceId"])
	}
	if metadata["threadId"] != "thread-1" {
		t.Fatalf("expected threadId thread-1, got %#v", metadata["threadId"])
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	startRun, ok := findHookRunByEventAndHandler(runs, "TurnStart", "builtin.turnstart.audit-thread-turn-start")
	if !ok {
		t.Fatalf("expected dedicated turn-start hook run, got %#v", runs)
	}
	if startRun.TriggerMethod != "turn/start" || startRun.ToolName != "turn/start" {
		t.Fatalf("unexpected turn-start hook metadata %#v", startRun)
	}
	if startRun.Reason != "turn_start_audited" || startRun.TurnID != "turn-test-1" {
		t.Fatalf("unexpected turn-start hook audit outcome %#v", startRun)
	}
	if startRun.ItemID == "" {
		t.Fatalf("expected dedicated turn-start hook run to carry request id, got %#v", startRun)
	}
	if _, ok := findHookRunByEventAndHandler(runs, "HttpMutation", "builtin.httpmutation.audit-workspace-mutation"); ok {
		t.Fatalf("expected turn/start hooks path to avoid legacy HttpMutation audit, got %#v", runs)
	}
}

func TestCreateThreadRejectsInvalidSessionStartSource(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	response := performJSONRequest(
		t,
		newTestRouter(dataStore),
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads",
		`{"sessionStartSource":"invalid"}`,
	)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 from create thread route, got %d", response.Code)
	}

	var payload struct {
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decodeResponseBody(t, response, &payload)
	if payload.Error == nil {
		t.Fatalf("expected error payload, got %#v", payload)
	}
	if payload.Error.Code != "bad_request" || payload.Error.Message != "invalid sessionStartSource" {
		t.Fatalf("unexpected create thread validation error %#v", payload.Error)
	}
}

func TestCreateThreadRouteSendsSessionStartSource(t *testing.T) {
	t.Parallel()

	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"thread/read": {
				Result: map[string]any{
					"thread": map[string]any{
						"id":      "thread-test-1",
						"cwd":     `E:\projects\ai\codex-server`,
						"path":    `E:\projects\ai\codex-server\.codex\threads\thread-test-1.json`,
						"preview": "New thread",
					},
				},
			},
		},
	})

	dataStore := store.NewMemoryStore()
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimeManager := runtime.NewManager(session.Command, eventHub)
	runtimePrefsService := runtimeprefs.NewService(
		dataStore,
		runtimeManager,
		session.Command,
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	hookService := hooks.NewService(dataStore, turnService, eventHub)
	botService := bots.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "bot/webhook", "thread"),
		eventHub,
		bots.Config{},
	)
	automationService := automations.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "automation/run", "thread"),
		eventHub,
	)
	turnPolicyService := turnpolicies.NewService(dataStore, turnService, eventHub)
	turnPolicyService.SetHooksPrimary(true)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub, dataStore)
	memoryDiagService := memorydiag.NewService(dataStore)
	accessControlService := accesscontrol.NewService(dataStore, true)
	runtimeManager.SetServerRequestInterceptor(hookService)

	router := NewRouter(Dependencies{
		FrontendOrigin:    "http://localhost:15173",
		Auth:              authService,
		Workspaces:        workspaceService,
		Bots:              botService,
		Automations:       automationService,
		Notifications:     notifications.NewService(dataStore),
		Hooks:             hookService,
		TurnPolicies:      turnPolicyService,
		Threads:           threadService,
		Turns:             turnService,
		Approvals:         approvalsService,
		Catalog:           catalog.NewService(runtimeManager, runtimePrefsService),
		ConfigFS:          configFSService,
		ExecFS:            execfsService,
		Feedback:          feedbackService,
		Events:            eventHub,
		RuntimePrefs:      runtimePrefsService,
		MemoryDiagnostics: memoryDiagService,
		AccessControl:     accessControlService,
	})

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	runtimeManager.Configure(workspace.ID, `E:\projects\ai\codex-server`)

	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads",
		`{"sessionStartSource":"clear"}`,
	)
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create thread route, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			ID           string `json:"id"`
			WorkspaceID  string `json:"workspaceId"`
			Materialized bool   `json:"materialized"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)
	if payload.Data.ID != "thread-test-1" {
		t.Fatalf("expected created thread id thread-test-1, got %#v", payload.Data)
	}
	if payload.Data.WorkspaceID != workspace.ID {
		t.Fatalf("expected workspaceId %q, got %#v", workspace.ID, payload.Data.WorkspaceID)
	}
	if !payload.Data.Materialized {
		t.Fatalf("expected created thread to be materialized, got %#v", payload.Data)
	}

	state := codexfake.ReadState(t, session.StateFile)
	if state.LastThread["sessionStartSource"] != threads.ThreadStartSourceClear {
		t.Fatalf("expected thread/start payload to include sessionStartSource clear, got %#v", state.LastThread)
	}
}

func TestReviewRoutePublishesDedicatedHookRun(t *testing.T) {
	t.Parallel()

	session := codexfake.NewSession(t, "TestCodexFakeHelperProcess")

	dataStore := store.NewMemoryStore()
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimeManager := runtime.NewManager(session.Command, eventHub)
	runtimePrefsService := runtimeprefs.NewService(
		dataStore,
		runtimeManager,
		session.Command,
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	hookService := hooks.NewService(dataStore, turnService, eventHub)
	botService := bots.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "bot/webhook", "thread"),
		eventHub,
		bots.Config{},
	)
	automationService := automations.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "automation/run", "thread"),
		eventHub,
	)
	turnPolicyService := turnpolicies.NewService(dataStore, turnService, eventHub)
	turnPolicyService.SetHooksPrimary(true)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub, dataStore)
	memoryDiagService := memorydiag.NewService(dataStore)
	accessControlService := accesscontrol.NewService(dataStore, true)
	runtimeManager.SetServerRequestInterceptor(hookService)

	router := NewRouter(Dependencies{
		FrontendOrigin:    "http://localhost:15173",
		Auth:              authService,
		Workspaces:        workspaceService,
		Bots:              botService,
		Automations:       automationService,
		Notifications:     notifications.NewService(dataStore),
		Hooks:             hookService,
		TurnPolicies:      turnPolicyService,
		Threads:           threadService,
		Turns:             turnService,
		Approvals:         approvalsService,
		Catalog:           catalog.NewService(runtimeManager, runtimePrefsService),
		ConfigFS:          configFSService,
		ExecFS:            execfsService,
		Feedback:          feedbackService,
		Events:            eventHub,
		RuntimePrefs:      runtimePrefsService,
		MemoryDiagnostics: memoryDiagService,
		AccessControl:     accessControlService,
	})

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	runtimeManager.Configure(workspace.ID, `E:\projects\ai\codex-server`)
	now := time.Date(2026, time.April, 11, 4, 10, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-review",
		WorkspaceID:  workspace.ID,
		Cwd:          `E:\projects\ai\codex-server`,
		Materialized: true,
		Name:         "Thread Review",
		Status:       "idle",
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads/thread-review/review",
		"",
	)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from review route, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			TurnID string `json:"turnId"`
			Status string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)
	if payload.Data.Status != "reviewing" || payload.Data.TurnID != "review-turn-1" {
		t.Fatalf("unexpected review route payload %#v", payload.Data)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-review")
	run, ok := findHookRunByEventAndHandler(runs, "ReviewStart", "builtin.reviewstart.audit-thread-review-start")
	if !ok {
		t.Fatalf("expected dedicated review hook run, got %#v", runs)
	}
	if run.TriggerMethod != "review/start" || run.ToolName != "review/start" {
		t.Fatalf("unexpected review hook metadata %#v", run)
	}
	if run.Reason != "review_start_audited" || run.TurnID != "review-turn-1" {
		t.Fatalf("unexpected review hook audit outcome %#v", run)
	}
	if !strings.Contains(run.AdditionalContext, "target=uncommittedChanges") {
		t.Fatalf("expected review hook context to preserve review target, got %#v", run)
	}

	state := codexfake.ReadState(t, session.StateFile)
	if state.LastReview["threadId"] != "thread-review" {
		t.Fatalf("expected review request to target thread-review, got %#v", state.LastReview)
	}
}

func TestFSWriteBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/fs/write",
		`{"path":".codex/hooks.json","content":"{}"}`,
	)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when fs/write targets protected governance file, got %d", response.Code)
	}

	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Error.Code != "pretool_blocked" {
		t.Fatalf("expected pretool_blocked error code, got %#v", payload.Error)
	}
	if !strings.Contains(payload.Error.Message, "hook-configuration API or editor") {
		t.Fatalf("expected governance-file guidance, got %#v", payload.Error)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].EventName != "PreToolUse" || runs[0].HandlerKey != "builtin.pretooluse.block-protected-governance-file-mutation" {
		t.Fatalf("expected protected governance file hook run, got %#v", runs[0])
	}
	if runs[0].ToolName != "fs/writeFile" {
		t.Fatalf("expected fs/writeFile tool name, got %#v", runs[0])
	}
}

func TestFSWriteBlocksProtectedSessionGovernanceDocumentMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/fs/write",
		`{"path":"AGENTS.md","content":"# rules"}`,
	)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when fs/write targets protected session governance document, got %d", response.Code)
	}

	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Error.Code != "pretool_blocked" {
		t.Fatalf("expected pretool_blocked error code, got %#v", payload.Error)
	}
	if !strings.Contains(payload.Error.Message, "session governance documents") {
		t.Fatalf("expected session governance guidance, got %#v", payload.Error)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].ToolName != "fs/writeFile" || runs[0].Reason != "protected_governance_file_mutation_blocked" {
		t.Fatalf("expected protected fs/write hook run, got %#v", runs[0])
	}
}

func TestFSMkdirBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/fs/mkdir",
		`{"path":".codex/hooks.json","recursive":true}`,
	)

	assertPreToolBlockedResponse(t, response, "hook-configuration API or editor")
	assertSinglePreToolHookRun(t, dataStore, workspace.ID, "", "fs/mkdir", "fs/mkdir", "protected_governance_file_mutation_blocked")
}

func TestFSRemoveBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/fs/remove",
		`{"path":".codex/hooks.json","recursive":false,"force":true}`,
	)

	assertPreToolBlockedResponse(t, response, "hook-configuration API or editor")
	assertSinglePreToolHookRun(t, dataStore, workspace.ID, "", "fs/remove", "fs/remove", "protected_governance_file_mutation_blocked")
}

func TestFSCopyBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/fs/copy",
		`{"sourcePath":"README.md","destinationPath":".codex/hooks.json","recursive":false}`,
	)

	assertPreToolBlockedResponse(t, response, "hook-configuration API or editor")
	assertSinglePreToolHookRun(t, dataStore, workspace.ID, "", "fs/copy", "fs/copy", "protected_governance_file_mutation_blocked")
}

func TestStartCommandBlocksDangerousCommand(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/commands",
		`{"command":"Remove-Item -Recurse -Force .\\*","mode":"background","shell":"powershell"}`,
	)

	assertPreToolBlockedResponse(t, response, "")
	assertSinglePreToolHookRun(t, dataStore, workspace.ID, "", "command/exec", "command/exec", "dangerous_command_blocked")
}

func TestThreadShellCommandBlocksDangerousCommand(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads/thread-1/shell-command",
		`{"command":"Remove-Item -Recurse -Force .\\*"}`,
	)

	assertPreToolBlockedResponse(t, response, "")
	assertSinglePreToolHookRun(t, dataStore, workspace.ID, "thread-1", "thread/shellCommand", "thread/shellCommand", "dangerous_command_blocked")
}

func TestConfigWriteBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/config/write",
		`{"filePath":"hooks.json","keyPath":"sessionStart.enabled","value":false}`,
	)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when config/write targets protected governance file, got %d", response.Code)
	}

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Error.Code != "pretool_blocked" {
		t.Fatalf("expected pretool_blocked error code, got %#v", payload.Error)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].ToolName != "config/value/write" || runs[0].TriggerMethod != "config/write" {
		t.Fatalf("expected config/value/write hook run, got %#v", runs[0])
	}
}

func TestConfigBatchWriteBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/config/batch-write",
		`{"filePath":".codex/hooks.json","edits":[{"keyPath":"preToolUse.blockDangerousCommandEnabled","value":false}]}`,
	)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when config/batch-write targets protected governance file, got %d", response.Code)
	}

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Error.Code != "pretool_blocked" {
		t.Fatalf("expected pretool_blocked error code, got %#v", payload.Error)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].ToolName != "config/batchWrite" || runs[0].TriggerMethod != "config/batch-write" {
		t.Fatalf("expected config/batchWrite hook run, got %#v", runs[0])
	}
}

func TestWriteSkillConfigBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/skills/config/write",
		`{"path":".codex/hooks.json","enabled":true}`,
	)

	assertPreToolBlockedResponse(t, response, "hook-configuration API or editor")
	assertSinglePreToolHookRun(
		t,
		dataStore,
		workspace.ID,
		"",
		"skills/config/write",
		"skills/config/write",
		"protected_governance_file_mutation_blocked",
	)
}

func TestExternalAgentImportBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/external-agent/import",
		`{"migrationItems":[{"path":".codex/hooks.json","kind":"copy"}]}`,
	)

	assertPreToolBlockedResponse(t, response, "hook-configuration API or editor")
	assertSinglePreToolHookRun(
		t,
		dataStore,
		workspace.ID,
		"",
		"external-agent/import",
		"external-agent/import",
		"protected_governance_file_mutation_blocked",
	)
}

func TestInstallPluginBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/plugins/install",
		`{"marketplacePath":".codex/hooks.json","pluginName":"demo-plugin"}`,
	)

	assertPreToolBlockedResponse(t, response, "hook-configuration API or editor")
	assertSinglePreToolHookRun(
		t,
		dataStore,
		workspace.ID,
		"",
		"plugins/install",
		"plugins/install",
		"protected_governance_file_mutation_blocked",
	)
}

func TestUninstallPluginBlocksProtectedGovernanceFileMutation(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/plugins/uninstall",
		`{"pluginId":".codex/hooks.json"}`,
	)

	assertPreToolBlockedResponse(t, response, "hook-configuration API or editor")
	assertSinglePreToolHookRun(
		t,
		dataStore,
		workspace.ID,
		"",
		"plugins/uninstall",
		"plugins/uninstall",
		"protected_governance_file_mutation_blocked",
	)
}

func TestConfigMcpServerReloadPublishesHTTPMutationAudit(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/config/mcp-server/reload",
		"",
	)

	if response.Code != http.StatusAccepted && response.Code != http.StatusBadGateway && response.Code != http.StatusBadRequest {
		t.Fatalf("expected wired reload response, got %d", response.Code)
	}

	waitForCondition(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "")
		run, ok := findHookRunByEventAndHandler(runs, "HttpMutation", "builtin.httpmutation.audit-workspace-mutation")
		return ok && run.Status == "completed"
	})

	runs := dataStore.ListHookRuns(workspace.ID, "")
	run, ok := findHookRunByEventAndHandler(runs, "HttpMutation", "builtin.httpmutation.audit-workspace-mutation")
	if !ok {
		t.Fatalf("expected HTTP mutation hook run, got %#v", runs)
	}
	if run.TriggerMethod != "config/mcp-server/reload" || run.ToolName != "config/mcp-server/reload" {
		t.Fatalf("unexpected reload HTTP mutation hook run %#v", run)
	}
	if run.Reason != "config_mcp_server_reload_audited" || run.ThreadID != "" || run.Scope != "workspace" {
		t.Fatalf("unexpected reload HTTP mutation hook metadata %#v", run)
	}
	if run.ItemID == "" {
		t.Fatalf("expected reload HTTP mutation hook run to carry request id, got %#v", run)
	}
}

func TestWindowsSandboxSetupStartPublishesHTTPMutationAudit(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/windows-sandbox/setup-start",
		`{"mode":"bootstrap"}`,
	)

	if response.Code != http.StatusAccepted && response.Code != http.StatusBadGateway && response.Code != http.StatusBadRequest {
		t.Fatalf("expected wired setup-start response, got %d", response.Code)
	}

	waitForCondition(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "")
		run, ok := findHookRunByEventAndHandler(runs, "HttpMutation", "builtin.httpmutation.audit-workspace-mutation")
		return ok && run.Status == "completed"
	})

	runs := dataStore.ListHookRuns(workspace.ID, "")
	run, ok := findHookRunByEventAndHandler(runs, "HttpMutation", "builtin.httpmutation.audit-workspace-mutation")
	if !ok {
		t.Fatalf("expected HTTP mutation hook run, got %#v", runs)
	}
	if run.TriggerMethod != "windows-sandbox/setup-start" || run.ToolName != "windows-sandbox/setup-start" {
		t.Fatalf("unexpected setup-start HTTP mutation hook run %#v", run)
	}
	if run.Reason != "windows_sandbox_setup_start_audited" || !strings.Contains(run.AdditionalContext, "mode=bootstrap") {
		t.Fatalf("unexpected setup-start HTTP mutation hook metadata %#v", run)
	}
	if run.ItemID == "" {
		t.Fatalf("expected setup-start HTTP mutation hook run to carry request id, got %#v", run)
	}
}

func TestWorkspaceHookConfigurationRouteReturnsBaselineConfiguredAndEffectiveValues(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	configPath := filepath.Join(rootDir, ".codex", "hooks.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(
		configPath,
		[]byte(`{
  "sessionStart": {
    "enabled": false,
    "contextPaths": [" docs\\\\session-start.md "],
    "maxChars": 1600
  },
  "preToolUse": {
    "blockDangerousCommandEnabled": false,
    "additionalProtectedGovernancePaths": [" docs\\\\governance.md "]
  }
}`),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	dataStore := store.NewMemoryStore()
	sessionStartEnabled := true
	userPromptBlockEnabled := false
	runtimeProtectedGovernancePaths := []string{" runtime/governance.md "}
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		HookSessionStartEnabled:                          &sessionStartEnabled,
		HookUserPromptSubmitBlockSecretPasteEnabled:      &userPromptBlockEnabled,
		HookPreToolUseAdditionalProtectedGovernancePaths: runtimeProtectedGovernancePaths,
	})
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/hook-configuration",
		"",
	)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from hook configuration route, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			LoadStatus                                                 string   `json:"loadStatus"`
			LoadedFromPath                                             string   `json:"loadedFromPath"`
			SearchedPaths                                              []string `json:"searchedPaths"`
			BaselineHookSessionStartEnabled                            *bool    `json:"baselineHookSessionStartEnabled"`
			BaselineHookSessionStartContextPaths                       []string `json:"baselineHookSessionStartContextPaths"`
			BaselineHookPreToolUseBlockDangerousCommandEnabled         *bool    `json:"baselineHookPreToolUseBlockDangerousCommandEnabled"`
			BaselineHookPreToolUseAdditionalProtectedGovernancePaths   []string `json:"baselineHookPreToolUseAdditionalProtectedGovernancePaths"`
			ConfiguredHookSessionStartEnabled                          *bool    `json:"configuredHookSessionStartEnabled"`
			ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled      *bool    `json:"configuredHookUserPromptSubmitBlockSecretPasteEnabled"`
			ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths []string `json:"configuredHookPreToolUseAdditionalProtectedGovernancePaths"`
			EffectiveHookSessionStartEnabled                           bool     `json:"effectiveHookSessionStartEnabled"`
			EffectiveHookSessionStartContextPaths                      []string `json:"effectiveHookSessionStartContextPaths"`
			EffectiveHookSessionStartMaxChars                          int      `json:"effectiveHookSessionStartMaxChars"`
			EffectiveHookUserPromptSubmitBlockSecretPasteEnabled       bool     `json:"effectiveHookUserPromptSubmitBlockSecretPasteEnabled"`
			EffectiveHookPreToolUseBlockDangerousCommandEnabled        bool     `json:"effectiveHookPreToolUseBlockDangerousCommandEnabled"`
			EffectiveHookPreToolUseProtectedGovernancePaths            []string `json:"effectiveHookPreToolUseProtectedGovernancePaths"`
			EffectiveHookSessionStartEnabledSource                     string   `json:"effectiveHookSessionStartEnabledSource"`
			EffectiveHookSessionStartContextPathsSource                string   `json:"effectiveHookSessionStartContextPathsSource"`
			EffectiveHookUserPromptSubmitBlockSecretPasteSource        string   `json:"effectiveHookUserPromptSubmitBlockSecretPasteSource"`
			EffectiveHookPreToolUseDangerousCommandBlockSource         string   `json:"effectiveHookPreToolUseDangerousCommandBlockSource"`
			EffectiveHookPreToolUseProtectedGovernancePathsSource      string   `json:"effectiveHookPreToolUseProtectedGovernancePathsSource"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Data.LoadStatus != hooks.WorkspaceConfigLoadStatusLoaded {
		t.Fatalf("expected loaded status, got %#v", payload.Data.LoadStatus)
	}
	if payload.Data.LoadedFromPath != configPath {
		t.Fatalf("expected loaded path %q, got %q", configPath, payload.Data.LoadedFromPath)
	}
	if len(payload.Data.SearchedPaths) != 2 {
		t.Fatalf("expected searched paths to include primary and fallback, got %#v", payload.Data.SearchedPaths)
	}
	if payload.Data.BaselineHookSessionStartEnabled == nil || *payload.Data.BaselineHookSessionStartEnabled {
		t.Fatalf("unexpected baseline session-start enabled %#v", payload.Data.BaselineHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(payload.Data.BaselineHookSessionStartContextPaths, []string{"docs/session-start.md"}) {
		t.Fatalf("unexpected baseline context paths %#v", payload.Data.BaselineHookSessionStartContextPaths)
	}
	if payload.Data.BaselineHookPreToolUseBlockDangerousCommandEnabled == nil || *payload.Data.BaselineHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("unexpected baseline pre-tool flag %#v", payload.Data.BaselineHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !reflect.DeepEqual(payload.Data.BaselineHookPreToolUseAdditionalProtectedGovernancePaths, []string{"docs/governance.md"}) {
		t.Fatalf("unexpected baseline protected governance paths %#v", payload.Data.BaselineHookPreToolUseAdditionalProtectedGovernancePaths)
	}
	if payload.Data.ConfiguredHookSessionStartEnabled == nil || !*payload.Data.ConfiguredHookSessionStartEnabled {
		t.Fatalf("unexpected configured session-start flag %#v", payload.Data.ConfiguredHookSessionStartEnabled)
	}
	if payload.Data.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled == nil || *payload.Data.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("unexpected configured user-prompt flag %#v", payload.Data.ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if !reflect.DeepEqual(
		payload.Data.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		[]string{"runtime/governance.md"},
	) {
		t.Fatalf(
			"unexpected configured protected governance paths %#v",
			payload.Data.ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths,
		)
	}
	if !payload.Data.EffectiveHookSessionStartEnabled {
		t.Fatalf("expected runtime override to enable session-start, got %#v", payload.Data.EffectiveHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(payload.Data.EffectiveHookSessionStartContextPaths, []string{"docs/session-start.md"}) {
		t.Fatalf("unexpected effective context paths %#v", payload.Data.EffectiveHookSessionStartContextPaths)
	}
	if payload.Data.EffectiveHookSessionStartMaxChars != 1600 {
		t.Fatalf("expected workspace baseline max chars 1600, got %d", payload.Data.EffectiveHookSessionStartMaxChars)
	}
	if payload.Data.EffectiveHookUserPromptSubmitBlockSecretPasteEnabled {
		t.Fatalf("expected runtime override to disable user-prompt block, got %#v", payload.Data.EffectiveHookUserPromptSubmitBlockSecretPasteEnabled)
	}
	if payload.Data.EffectiveHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("expected workspace baseline to disable pre-tool block, got %#v", payload.Data.EffectiveHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !containsString(payload.Data.EffectiveHookPreToolUseProtectedGovernancePaths, "docs/governance.md") {
		t.Fatalf("expected effective protected governance paths to include docs/governance.md, got %#v", payload.Data.EffectiveHookPreToolUseProtectedGovernancePaths)
	}
	if !containsString(payload.Data.EffectiveHookPreToolUseProtectedGovernancePaths, "runtime/governance.md") {
		t.Fatalf("expected effective protected governance paths to include runtime/governance.md, got %#v", payload.Data.EffectiveHookPreToolUseProtectedGovernancePaths)
	}
	if payload.Data.EffectiveHookSessionStartEnabledSource != hooks.ConfigSourceRuntime {
		t.Fatalf("expected runtime source for session-start enabled, got %q", payload.Data.EffectiveHookSessionStartEnabledSource)
	}
	if payload.Data.EffectiveHookSessionStartContextPathsSource != hooks.ConfigSourceWorkspace {
		t.Fatalf("expected workspace source for context paths, got %q", payload.Data.EffectiveHookSessionStartContextPathsSource)
	}
	if payload.Data.EffectiveHookUserPromptSubmitBlockSecretPasteSource != hooks.ConfigSourceRuntime {
		t.Fatalf("expected runtime source for user-prompt block, got %q", payload.Data.EffectiveHookUserPromptSubmitBlockSecretPasteSource)
	}
	if payload.Data.EffectiveHookPreToolUseDangerousCommandBlockSource != hooks.ConfigSourceWorkspace {
		t.Fatalf("expected workspace source for pre-tool block, got %q", payload.Data.EffectiveHookPreToolUseDangerousCommandBlockSource)
	}
	if payload.Data.EffectiveHookPreToolUseProtectedGovernancePathsSource != hooks.ConfigSourceRuntime {
		t.Fatalf("expected runtime source for protected governance paths, got %q", payload.Data.EffectiveHookPreToolUseProtectedGovernancePathsSource)
	}
}

func TestWorkspaceHookConfigurationWriteRoutePersistsCanonicalHooksFile(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootDir)

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/hook-configuration",
		`{
      "hookSessionStartEnabled": false,
      "hookSessionStartContextPaths": [" docs\\\\session-start.md ", "README.md"],
      "hookSessionStartMaxChars": 600,
      "hookPreToolUseBlockDangerousCommandEnabled": false,
      "hookPreToolUseAdditionalProtectedGovernancePaths": [" docs\\\\governance.md "]
    }`,
	)

	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from hook configuration write route, got %d", response.Code)
	}

	primaryPath := filepath.Join(rootDir, ".codex", "hooks.json")
	content, err := os.ReadFile(primaryPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", primaryPath, err)
	}
	if !strings.Contains(string(content), `"contextPaths": [`) {
		t.Fatalf("expected persisted hooks file to include context paths, got %q", string(content))
	}
	if !strings.Contains(string(content), `"blockDangerousCommandEnabled": false`) {
		t.Fatalf("expected persisted hooks file to include pre-tool baseline, got %q", string(content))
	}
	if !strings.Contains(string(content), `"additionalProtectedGovernancePaths": [`) {
		t.Fatalf("expected persisted hooks file to include additional protected governance paths, got %q", string(content))
	}

	var payload struct {
		Data struct {
			Status        string `json:"status"`
			FilePath      string `json:"filePath"`
			Configuration struct {
				LoadStatus                                          string   `json:"loadStatus"`
				LoadedFromPath                                      string   `json:"loadedFromPath"`
				EffectiveHookSessionStartEnabled                    bool     `json:"effectiveHookSessionStartEnabled"`
				EffectiveHookSessionStartContextPaths               []string `json:"effectiveHookSessionStartContextPaths"`
				EffectiveHookSessionStartMaxChars                   int      `json:"effectiveHookSessionStartMaxChars"`
				EffectiveHookPreToolUseBlockDangerousCommandEnabled bool     `json:"effectiveHookPreToolUseBlockDangerousCommandEnabled"`
				EffectiveHookPreToolUseProtectedGovernancePaths     []string `json:"effectiveHookPreToolUseProtectedGovernancePaths"`
				EffectiveHookSessionStartEnabledSource              string   `json:"effectiveHookSessionStartEnabledSource"`
			} `json:"configuration"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Data.Status != "written" {
		t.Fatalf("expected written status, got %#v", payload.Data.Status)
	}
	if payload.Data.FilePath != primaryPath {
		t.Fatalf("expected file path %q, got %q", primaryPath, payload.Data.FilePath)
	}
	if payload.Data.Configuration.LoadStatus != hooks.WorkspaceConfigLoadStatusLoaded {
		t.Fatalf("expected loaded config status, got %#v", payload.Data.Configuration.LoadStatus)
	}
	if payload.Data.Configuration.LoadedFromPath != primaryPath {
		t.Fatalf("expected loaded path %q, got %q", primaryPath, payload.Data.Configuration.LoadedFromPath)
	}
	if payload.Data.Configuration.EffectiveHookSessionStartEnabled {
		t.Fatalf("expected session-start baseline to disable effective setting, got %#v", payload.Data.Configuration.EffectiveHookSessionStartEnabled)
	}
	if !reflect.DeepEqual(payload.Data.Configuration.EffectiveHookSessionStartContextPaths, []string{"docs/session-start.md", "README.md"}) {
		t.Fatalf("unexpected effective context paths %#v", payload.Data.Configuration.EffectiveHookSessionStartContextPaths)
	}
	if payload.Data.Configuration.EffectiveHookSessionStartMaxChars != 600 {
		t.Fatalf("expected effective max chars 600, got %d", payload.Data.Configuration.EffectiveHookSessionStartMaxChars)
	}
	if payload.Data.Configuration.EffectiveHookPreToolUseBlockDangerousCommandEnabled {
		t.Fatalf("expected pre-tool baseline to disable effective setting, got %#v", payload.Data.Configuration.EffectiveHookPreToolUseBlockDangerousCommandEnabled)
	}
	if !containsString(payload.Data.Configuration.EffectiveHookPreToolUseProtectedGovernancePaths, "docs/governance.md") {
		t.Fatalf("expected effective protected governance paths to include docs/governance.md, got %#v", payload.Data.Configuration.EffectiveHookPreToolUseProtectedGovernancePaths)
	}
	if payload.Data.Configuration.EffectiveHookSessionStartEnabledSource != hooks.ConfigSourceWorkspace {
		t.Fatalf("expected workspace source, got %q", payload.Data.Configuration.EffectiveHookSessionStartEnabledSource)
	}
}

func TestSteerRoutePublishesDedicatedHookRun(t *testing.T) {
	t.Parallel()

	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"turn/steer": {
				Result: map[string]any{
					"turnId": "turn-steered-1",
				},
			},
		},
	})

	dataStore := store.NewMemoryStore()
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimeManager := runtime.NewManager(session.Command, eventHub)
	runtimePrefsService := runtimeprefs.NewService(
		dataStore,
		runtimeManager,
		session.Command,
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	hookService := hooks.NewService(dataStore, turnService, eventHub)
	botService := bots.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "bot/webhook", "thread"),
		eventHub,
		bots.Config{},
	)
	automationService := automations.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "automation/run", "thread"),
		eventHub,
	)
	turnPolicyService := turnpolicies.NewService(dataStore, turnService, eventHub)
	turnPolicyService.SetHooksPrimary(true)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub, dataStore)
	memoryDiagService := memorydiag.NewService(dataStore)
	accessControlService := accesscontrol.NewService(dataStore, true)
	runtimeManager.SetServerRequestInterceptor(hookService)

	router := NewRouter(Dependencies{
		FrontendOrigin:    "http://localhost:15173",
		Auth:              authService,
		Workspaces:        workspaceService,
		Bots:              botService,
		Automations:       automationService,
		Notifications:     notifications.NewService(dataStore),
		Hooks:             hookService,
		TurnPolicies:      turnPolicyService,
		Threads:           threadService,
		Turns:             turnService,
		Approvals:         approvalsService,
		Catalog:           catalog.NewService(runtimeManager, runtimePrefsService),
		ConfigFS:          configFSService,
		ExecFS:            execfsService,
		Feedback:          feedbackService,
		Events:            eventHub,
		RuntimePrefs:      runtimePrefsService,
		MemoryDiagnostics: memoryDiagService,
		AccessControl:     accessControlService,
	})

	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	runtimeManager.Configure(workspace.ID, `E:\projects\ai\codex-server`)
	runtimeManager.RememberActiveTurn(workspace.ID, "thread-steer", "turn-active-1")
	now := time.Date(2026, time.April, 11, 6, 15, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-steer",
		WorkspaceID:  workspace.ID,
		Cwd:          `E:\projects\ai\codex-server`,
		Materialized: true,
		Name:         "Thread Steer",
		Status:       "running",
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads/thread-steer/turns/steer",
		`{"input":"请继续推进 hooks 审计迁移"}`,
	)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from steer route, got %d", response.Code)
	}

	var payload struct {
		Data struct {
			TurnID string `json:"turnId"`
			Status string `json:"status"`
		} `json:"data"`
	}
	decodeResponseBody(t, response, &payload)
	if payload.Data.Status != "steered" || payload.Data.TurnID != "turn-steered-1" {
		t.Fatalf("unexpected steer route payload %#v", payload.Data)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-steer")
	run, ok := findHookRunByEventAndHandler(runs, "TurnSteer", "builtin.turnsteer.audit-thread-turn-steer")
	if !ok {
		t.Fatalf("expected dedicated steer hook run, got %#v", runs)
	}
	if run.TriggerMethod != "turn/steer" || run.ToolName != "turn/steer" {
		t.Fatalf("unexpected steer hook metadata %#v", run)
	}
	if run.Reason != "turn_steer_audited" || run.TurnID != "turn-steered-1" {
		t.Fatalf("unexpected steer hook audit outcome %#v", run)
	}
	if run.ItemID == "" {
		t.Fatalf("expected dedicated steer hook run to carry request id, got %#v", run)
	}
	if _, ok := findHookRunByEventAndHandler(runs, "HttpMutation", "builtin.httpmutation.audit-workspace-mutation"); ok {
		t.Fatalf("expected steer hooks path to avoid legacy HttpMutation audit, got %#v", runs)
	}

	state := codexfake.ReadState(t, session.StateFile)
	steerRecorded := false
	for _, message := range state.Received {
		if message.Method == "turn/steer" {
			steerRecorded = true
			break
		}
	}
	if !steerRecorded {
		t.Fatalf("expected runtime to receive turn/steer request, got %#v", state.Received)
	}
}

func TestSteerRoutePersistsNoActiveTurnAudit(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	now := time.Date(2026, time.April, 10, 9, 8, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-steer-idle",
		WorkspaceID:  workspace.ID,
		Cwd:          `E:\projects\ai\codex-server`,
		Materialized: true,
		Name:         "Thread Steer Idle",
		Status:       "idle",
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads/thread-steer-idle/turns/steer",
		`{"input":"请继续推进"}`,
	)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected 409 when steer route has no active turn, got %d", response.Code)
	}

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeResponseBody(t, response, &payload)
	if payload.Error.Code != "no_active_turn" {
		t.Fatalf("expected no_active_turn error code, got %#v", payload.Error)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-steer-idle")
	run, ok := findHookRunByEventAndHandler(runs, "TurnSteer", "builtin.turnsteer.audit-thread-turn-steer")
	if !ok {
		t.Fatalf("expected dedicated steer hook run for no-active-turn path, got %#v", runs)
	}
	if run.Status != "failed" || run.Reason != "steer_no_active_turn" {
		t.Fatalf("unexpected no-active-turn steer hook run %#v", run)
	}
	if !strings.Contains(run.AdditionalContext, "activeTurn=false") {
		t.Fatalf("expected no-active-turn steer context to record idle outcome, got %#v", run)
	}
	if run.ItemID == "" {
		t.Fatalf("expected no-active-turn steer hook run to carry request id, got %#v", run)
	}
	if _, ok := findHookRunByEventAndHandler(runs, "HttpMutation", "builtin.httpmutation.audit-workspace-mutation"); ok {
		t.Fatalf("expected no-active-turn steer hooks path to avoid legacy HttpMutation audit, got %#v", runs)
	}
}

func TestSteerTurnBlocksSecretLikePrompt(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	now := time.Date(2026, time.April, 10, 9, 5, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:           "thread-2",
		WorkspaceID:  workspace.ID,
		Cwd:          `E:\projects\ai\codex-server`,
		Materialized: true,
		Name:         "Thread 2",
		Status:       "idle",
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodPost,
		"/api/workspaces/"+workspace.ID+"/threads/thread-2/turns/steer",
		`{"input":"Authorization: Bearer github_pat_abcDEF1234567890abcDEF1234567890"} `,
	)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when steer prompt contains a secret, got %d", response.Code)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-2")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].TriggerMethod != "turn/steer" || runs[0].Reason != "secret_like_input_blocked" {
		t.Fatalf("expected steer-triggered user prompt hook run, got %#v", runs[0])
	}
}

func newTestRouter(dataStore *store.MemoryStore) http.Handler {
	return newTestRouterWithShutdown(dataStore, nil)
}

func newTestRouterWithShutdown(dataStore *store.MemoryStore, requestShutdown func(reason string) bool) http.Handler {
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
		true,
		false,
		"",
		"",
	)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	hookService := hooks.NewService(dataStore, turnService, eventHub)
	hookService.Start(context.Background())
	botService := bots.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "bot/webhook", "thread"),
		eventHub,
		bots.Config{},
	)
	automationService := automations.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "automation/run", "thread"),
		eventHub,
	)
	notificationsService := notifications.NewService(dataStore)
	runtimeManager.SetServerRequestInterceptor(hookService)
	turnPolicyService := turnpolicies.NewService(dataStore, turnService, eventHub)
	turnPolicyService.SetHooksPrimary(true)
	turnPolicyService.Start(context.Background())
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub, dataStore)
	memoryDiagService := memorydiag.NewService(dataStore)
	accessControlService := accesscontrol.NewService(dataStore, true)

	return NewRouter(Dependencies{
		FrontendOrigin:    "http://localhost:15173",
		RequestShutdown:   requestShutdown,
		Auth:              authService,
		Workspaces:        workspaceService,
		Bots:              botService,
		Automations:       automationService,
		Notifications:     notificationsService,
		Hooks:             hookService,
		TurnPolicies:      turnPolicyService,
		Threads:           threadService,
		Turns:             turnService,
		Approvals:         approvalsService,
		Catalog:           catalog.NewService(runtimeManager, runtimePrefsService),
		ConfigFS:          configFSService,
		ExecFS:            execfsService,
		Feedback:          feedbackService,
		Events:            eventHub,
		RuntimePrefs:      runtimePrefsService,
		MemoryDiagnostics: memoryDiagService,
		AccessControl:     accessControlService,
	})
}

func performJSONRequest(t *testing.T, handler http.Handler, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:41000"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func assertPreToolBlockedResponse(t *testing.T, response *httptest.ResponseRecorder, messageContains string) {
	t.Helper()

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when pre-tool hook blocks the request, got %d", response.Code)
	}

	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decodeResponseBody(t, response, &payload)

	if payload.Error.Code != "pretool_blocked" {
		t.Fatalf("expected pretool_blocked error code, got %#v", payload.Error)
	}
	if messageContains != "" && !strings.Contains(payload.Error.Message, messageContains) {
		t.Fatalf("expected error message to contain %q, got %#v", messageContains, payload.Error)
	}
}

func assertSinglePreToolHookRun(
	t *testing.T,
	dataStore *store.MemoryStore,
	workspaceID string,
	threadID string,
	toolName string,
	triggerMethod string,
	reason string,
) {
	t.Helper()

	runs := dataStore.ListHookRuns(workspaceID, threadID)
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].EventName != "PreToolUse" {
		t.Fatalf("expected pre-tool hook run, got %#v", runs[0])
	}
	if runs[0].ToolName != toolName || runs[0].TriggerMethod != triggerMethod || runs[0].Reason != reason {
		t.Fatalf("unexpected hook run metadata %#v", runs[0])
	}
}

func decodeResponseBody(t *testing.T, recorder *httptest.ResponseRecorder, target any) {
	t.Helper()

	if err := json.NewDecoder(recorder.Body).Decode(target); err != nil {
		t.Fatalf("decode response body error = %v", err)
	}
}

func waitForCondition(t *testing.T, condition func() bool) {
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

func findHookRunByEventAndHandler(runs []store.HookRun, eventName string, handlerKey string) (store.HookRun, bool) {
	zero := store.HookRun{}
	for _, run := range runs {
		if run.EventName == eventName && run.HandlerKey == handlerKey {
			return run, true
		}
	}
	return zero, false
}

func seedRouterMetricsThreadProjection(
	dataStore *store.MemoryStore,
	workspaceID string,
	threadID string,
	turns []store.ThreadTurn,
) {
	now := time.Date(2026, time.April, 8, 17, 30, 0, 0, time.UTC)
	dataStore.UpsertThread(store.Thread{
		ID:          threadID,
		WorkspaceID: workspaceID,
		Cwd:         `E:\projects\ai\codex-server`,
		Name:        threadID,
		Status:      "idle",
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread: store.Thread{
			ID:          threadID,
			WorkspaceID: workspaceID,
			Cwd:         `E:\projects\ai\codex-server`,
			Name:        threadID,
			Status:      "idle",
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		Cwd:          `E:\projects\ai\codex-server`,
		Source:       "interactive",
		TurnCount:    len(turns),
		MessageCount: len(turns),
		Turns:        turns,
	})
}

func mustCreateRouterMetricsDecision(t *testing.T, dataStore *store.MemoryStore, decision store.TurnPolicyDecision) {
	t.Helper()

	if _, err := dataStore.CreateTurnPolicyDecision(decision); err != nil {
		t.Fatalf("CreateTurnPolicyDecision() error = %v", err)
	}
}

func routerFileChangeItem(id string, path string) map[string]any {
	return map[string]any{
		"id":     id,
		"type":   "fileChange",
		"status": "completed",
		"changes": []any{
			map[string]any{
				"kind": "update",
				"path": path,
			},
		},
	}
}

func routerCommandExecutionItem(id string, command string, status string, exitCode int) map[string]any {
	return map[string]any{
		"id":       id,
		"type":     "commandExecution",
		"command":  command,
		"status":   status,
		"exitCode": exitCode,
	}
}

type routerTestBotProvider struct {
	name   string
	sentCh chan routerTestBotSentPayload
}

type routerTestBotSentPayload struct {
	Messages []bots.OutboundMessage
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == strings.TrimSpace(target) {
			return true
		}
	}
	return false
}

func newRouterTestBotProvider() *routerTestBotProvider {
	return &routerTestBotProvider{
		name:   "fakechat",
		sentCh: make(chan routerTestBotSentPayload, 8),
	}
}

func newRouterTestNamedBotProvider(name string) *routerTestBotProvider {
	return &routerTestBotProvider{
		name:   name,
		sentCh: make(chan routerTestBotSentPayload, 8),
	}
}

func (p *routerTestBotProvider) Name() string {
	return p.name
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

func routerIntPtr(value int) *int {
	return &value
}

func routerInt64Ptr(value int64) *int64 {
	return &value
}
