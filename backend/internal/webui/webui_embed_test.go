//go:build embed_frontend

package webui

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
	"testing"
)

func TestCurrentStatusInEmbedMode(t *testing.T) {
	t.Parallel()

	status := CurrentStatus()
	if status.Mode != ModeEmbedded {
		t.Fatalf("expected mode %q, got %q", ModeEmbedded, status.Mode)
	}
	if !status.Enabled {
		t.Fatalf("expected embedded mode to be enabled, reason = %q", status.Reason)
	}
}

func TestEmbeddedHandlerServesIndexAtRoot(t *testing.T) {
	t.Parallel()

	recorder := performRequest(t, Handler(), http.MethodGet, "/")
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("expected no-cache cache control, got %q", got)
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

func TestEmbeddedHandlerFallsBackToIndexForSPARoutes(t *testing.T) {
	t.Parallel()

	rootRecorder := performRequest(t, Handler(), http.MethodGet, "/")
	spaRecorder := performRequest(t, Handler(), http.MethodGet, "/workspaces/demo/threads/thread-1")
	if spaRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, spaRecorder.Code)
	}
	if spaRecorder.Body.String() != rootRecorder.Body.String() {
		t.Fatal("expected SPA route to fall back to the same index document as root")
	}
}

func TestEmbeddedHandlerReturns404ForMissingStaticAssets(t *testing.T) {
	t.Parallel()

	recorder := performRequest(t, Handler(), http.MethodGet, "/assets/missing-file.js")
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, recorder.Code)
	}
}

func TestEmbeddedHandlerDoesNotFallbackForAssetsDirectoryRequests(t *testing.T) {
	t.Parallel()

	recorder := performRequest(t, Handler(), http.MethodGet, "/assets")
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, recorder.Code)
	}
}

func TestEmbeddedHandlerServesAssetWithHeaders(t *testing.T) {
	t.Parallel()

	assets, err := bundleFS()
	if err != nil {
		t.Fatalf("bundleFS() error = %v", err)
	}

	entries, err := fs.ReadDir(assets, "assets")
	if err != nil {
		t.Fatalf("ReadDir(assets) error = %v", err)
	}

	assetName := ""
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(path.Ext(entry.Name()))
		if ext == ".js" || ext == ".css" {
			assetName = entry.Name()
			break
		}
	}

	if assetName == "" {
		t.Fatal("expected at least one embedded js or css asset")
	}

	recorder := performRequest(t, Handler(), http.MethodGet, "/assets/"+assetName)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("expected immutable asset cache control, got %q", got)
	}
	if got := recorder.Header().Get("Content-Type"); got == "" {
		t.Fatal("expected content type to be set")
	}
}
