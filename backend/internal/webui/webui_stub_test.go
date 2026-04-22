//go:build !embed_frontend

package webui

import (
	"net/http"
	"strings"
	"testing"
)

func TestCurrentStatusInStubMode(t *testing.T) {
	t.Parallel()

	status := CurrentStatus()
	if status.Mode != ModeStub {
		t.Fatalf("expected mode %q, got %q", ModeStub, status.Mode)
	}
	if status.Enabled {
		t.Fatal("expected stub mode to be disabled")
	}
	if !strings.Contains(status.Reason, "embed_frontend") {
		t.Fatalf("expected reason to mention build tag, got %q", status.Reason)
	}
}

func TestNewHandlerInStubModeReturnsExplicitResponse(t *testing.T) {
	t.Parallel()

	recorder := performRequest(t, Handler(), http.MethodGet, "/")
	if recorder.Code != http.StatusNotImplemented {
		t.Fatalf("expected status %d, got %d", http.StatusNotImplemented, recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected no-store cache control, got %q", got)
	}
	if !strings.Contains(recorder.Body.String(), "embed_frontend") {
		t.Fatalf("expected body to mention build tag, got %q", recorder.Body.String())
	}
}

func TestNewHandlerRejectsUnsupportedMethods(t *testing.T) {
	t.Parallel()

	recorder := performRequest(t, Handler(), http.MethodPost, "/")
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}
}
