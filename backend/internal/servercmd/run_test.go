package servercmd

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
