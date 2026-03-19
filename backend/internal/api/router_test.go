package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/auth"
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/execfs"
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

func newTestRouter(dataStore *store.MemoryStore) http.Handler {
	eventHub := events.NewHub()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", eventHub)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	catalogService := catalog.NewService(runtimeManager)
	turnService := turns.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub)

	return NewRouter(Dependencies{
		FrontendOrigin: "http://localhost:5173",
		Auth:           authService,
		Workspaces:     workspaceService,
		Threads:        threadService,
		Turns:          turnService,
		Approvals:      approvalsService,
		Catalog:        catalogService,
		ExecFS:         execfsService,
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
