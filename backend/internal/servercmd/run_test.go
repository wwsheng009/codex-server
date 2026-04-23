package servercmd

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/config"
	"codex-server/backend/internal/store"
)

func TestIdentifyCodexBackendRecognizesEnvelopedHealthzResponse(t *testing.T) {
	t.Parallel()

	server := newLoopbackTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != healthzPath {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"status":"ok","ts":"2026-04-09T12:38:02Z"}}`))
	}))
	defer server.Close()

	client := &http.Client{Timeout: time.Second}
	identified, attempts := identifyCodexBackend(client, server.URL)
	if !identified {
		t.Fatalf("identifyCodexBackend() = false, want true; attempts = %#v", attempts)
	}
}

func TestClassifyListenFailureRecognizesExistingBackend(t *testing.T) {
	t.Parallel()

	server := newLoopbackTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != healthzPath {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"status":"ok","ts":"2026-04-09T12:38:02Z"}}`))
	}))
	defer server.Close()

	addr := strings.TrimPrefix(server.URL, "http://")
	listener, err := net.Listen("tcp", addr)
	if err == nil {
		_ = listener.Close()
		t.Fatalf("net.Listen(%q) unexpectedly succeeded", addr)
	}

	identified, attempts := classifyListenFailure(server.URL, err)
	if !identified {
		t.Fatalf("classifyListenFailure() = false, want true; attempts = %#v; err = %v", attempts, err)
	}
}

func TestResolveFrontendOriginForServing(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name           string
		frontendOrigin string
		publicBaseURL  string
		embedded       bool
		want           string
	}{
		{
			name:           "development mode preserves configured origin",
			frontendOrigin: "http://0.0.0.0:15173",
			publicBaseURL:  "https://app.example.com",
			embedded:       false,
			want:           "http://0.0.0.0:15173",
		},
		{
			name:           "embedded mode drops default dev origin without public base URL",
			frontendOrigin: "http://0.0.0.0:15173",
			embedded:       true,
			want:           "",
		},
		{
			name:           "embedded mode rewrites default dev origin to public base URL",
			frontendOrigin: "http://localhost:15173",
			publicBaseURL:  "https://app.example.com",
			embedded:       true,
			want:           "https://app.example.com",
		},
		{
			name:           "embedded mode keeps explicit custom frontend origin",
			frontendOrigin: "https://ui.example.com",
			publicBaseURL:  "https://app.example.com",
			embedded:       true,
			want:           "https://ui.example.com",
		},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := resolveFrontendOriginForServing(tc.frontendOrigin, tc.publicBaseURL, tc.embedded)
			if got != tc.want {
				t.Fatalf("resolveFrontendOriginForServing() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRunServerLeavesWorkspaceRegistryEmptyOnFirstStart(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "metadata.json")
	addr := reserveLoopbackAddr(t)
	baseURL := "http://" + addr

	cfg := config.Config{
		Addr:              addr,
		FrontendOrigin:    "http://127.0.0.1:15173",
		BaseCodexCommand:  "codex app-server --listen stdio://",
		CodexCommand:      "codex app-server --listen stdio://",
		LogPath:           filepath.Join(t.TempDir(), "backend-runtime.log"),
		AllowRemoteAccess: true,
		StorePath:         storePath,
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- runServer(cfg)
	}()

	client := &http.Client{Timeout: time.Second}
	waitForServerReady(t, client, baseURL+healthzPath)

	workspacesRequest, err := http.NewRequest(http.MethodGet, baseURL+"/api/workspaces", nil)
	if err != nil {
		t.Fatalf("http.NewRequest(workspaces) error = %v", err)
	}
	workspacesResponse, err := client.Do(workspacesRequest)
	if err != nil {
		t.Fatalf("GET /api/workspaces error = %v", err)
	}
	defer workspacesResponse.Body.Close()

	if workspacesResponse.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/workspaces status = %d, want %d", workspacesResponse.StatusCode, http.StatusOK)
	}

	var listPayload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(workspacesResponse.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode workspaces response error = %v", err)
	}
	if len(listPayload.Data) != 0 {
		t.Fatalf("expected no seeded workspaces on first start, got %d", len(listPayload.Data))
	}

	stopRequest, err := http.NewRequest(http.MethodPost, baseURL+stopEndpointPath, nil)
	if err != nil {
		t.Fatalf("http.NewRequest(stop) error = %v", err)
	}
	stopRequest.Header.Set("X-Codex-Server-Action", "stop")

	stopResponse, err := client.Do(stopRequest)
	if err != nil {
		t.Fatalf("POST %s error = %v", stopEndpointPath, err)
	}
	defer stopResponse.Body.Close()

	if stopResponse.StatusCode != http.StatusAccepted {
		t.Fatalf("POST %s status = %d, want %d", stopEndpointPath, stopResponse.StatusCode, http.StatusAccepted)
	}

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("runServer() error = %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("runServer() did not shut down in time")
	}

	reloadedStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}
	defer func() {
		_ = reloadedStore.Close()
	}()

	if got := len(reloadedStore.ListWorkspaces()); got != 0 {
		t.Fatalf("expected persisted workspace registry to remain empty, got %d entries", got)
	}
}

func newLoopbackTestServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}

	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	return server
}

func reserveLoopbackAddr(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("listener.Close() error = %v", err)
	}
	return addr
}

func waitForServerReady(t *testing.T, client *http.Client, url string) {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		response, err := client.Get(url)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	t.Fatalf("server did not become ready at %s", url)
}
