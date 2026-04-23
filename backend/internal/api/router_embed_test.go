//go:build embed_frontend

package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"codex-server/backend/internal/store"
)

func TestEmbeddedRouterServesIndexAtRoot(t *testing.T) {
	t.Parallel()

	recorder := performEmbeddedRouterRequest(t, "/", http.MethodGet)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Fatalf("expected html content type, got %q", got)
	}
	body := recorder.Body.String()
	if !strings.Contains(strings.ToLower(body), "<html") {
		t.Fatalf("expected html document, got %q", body)
	}
	if !strings.Contains(body, "id=\"root\"") {
		t.Fatalf("expected application root element, got %q", body)
	}
}

func TestEmbeddedRouterServesIndexAtRootForRemoteRequestWithoutTokens(t *testing.T) {
	t.Parallel()

	recorder := performEmbeddedRouterRequestFromRemoteAddr(t, "/", http.MethodGet, "192.168.1.20:41000")
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Fatalf("expected html content type, got %q", got)
	}
}

func TestEmbeddedRouterFallsBackForSPARoutes(t *testing.T) {
	t.Parallel()

	rootRecorder := performEmbeddedRouterRequest(t, "/", http.MethodGet)
	spaRecorder := performEmbeddedRouterRequest(t, "/workspaces/demo/threads/thread-1", http.MethodGet)
	if spaRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, spaRecorder.Code)
	}
	if spaRecorder.Body.String() != rootRecorder.Body.String() {
		t.Fatal("expected SPA route to fall back to the same index document as root")
	}
}

func TestEmbeddedRouterReturns404ForMissingStaticAssets(t *testing.T) {
	t.Parallel()

	recorder := performEmbeddedRouterRequest(t, "/assets/missing-file.js", http.MethodGet)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, recorder.Code)
	}
}

func TestEmbeddedRouterDoesNotInterceptAPIRoutes(t *testing.T) {
	t.Parallel()

	recorder := performEmbeddedRouterRequest(t, "/healthz", http.MethodGet)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Fatalf("expected json content type, got %q", got)
	}
	if body := recorder.Body.String(); strings.Contains(strings.ToLower(body), "<html") {
		t.Fatalf("expected api route to stay on json handler, got html body %q", body)
	}
}

func performEmbeddedRouterRequest(t *testing.T, target string, method string) *httptest.ResponseRecorder {
	t.Helper()

	return performEmbeddedRouterRequestFromRemoteAddr(t, target, method, "127.0.0.1:41000")
}

func performEmbeddedRouterRequestFromRemoteAddr(
	t *testing.T,
	target string,
	method string,
	remoteAddr string,
) *httptest.ResponseRecorder {
	t.Helper()

	router := newTestRouter(store.NewMemoryStore())
	request := httptest.NewRequest(method, target, nil)
	request.RemoteAddr = remoteAddr
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}
