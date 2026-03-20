package api

import (
	"errors"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/auth"
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/execfs"
	"codex-server/backend/internal/feedback"
	"codex-server/backend/internal/runtime"
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
		"/api/account/login/cancel",
		"/api/workspaces/" + created.Data.ID + "/config/read",
		"/api/workspaces/" + created.Data.ID + "/config/write",
		"/api/workspaces/" + created.Data.ID + "/config/batch-write",
		"/api/workspaces/" + created.Data.ID + "/external-agent/detect",
		"/api/workspaces/" + created.Data.ID + "/external-agent/import",
		"/api/workspaces/" + created.Data.ID + "/skills/remote/list",
		"/api/workspaces/" + created.Data.ID + "/skills/remote/export",
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
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", eventHub)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	catalogService := catalog.NewService(runtimeManager)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	turnService := turns.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub)

	return NewRouter(Dependencies{
		FrontendOrigin: "http://localhost:15173",
		Auth:           authService,
		Workspaces:     workspaceService,
		Threads:        threadService,
		Turns:          turnService,
		Approvals:      approvalsService,
		Catalog:        catalogService,
		ConfigFS:       configFSService,
		ExecFS:         execfsService,
		Feedback:       feedbackService,
		Events:         eventHub,
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
