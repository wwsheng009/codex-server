package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOriginMatcherAllowsLoopbackPortFallbacks(t *testing.T) {
	t.Parallel()

	matcher := newOriginMatcher("http://localhost:15173")

	for _, origin := range []string{
		"http://localhost:15173",
		"http://localhost:15174",
		"http://127.0.0.1:4173",
	} {
		if !matcher.Allow(origin) {
			t.Fatalf("expected origin %q to be allowed", origin)
		}
	}

	for _, origin := range []string{
		"https://localhost:15174",
		"http://example.com",
	} {
		if matcher.Allow(origin) {
			t.Fatalf("expected origin %q to be rejected", origin)
		}
	}
}

func TestOriginMatcherAllowsBindAllHostPortFallbacks(t *testing.T) {
	t.Parallel()

	matcher := newOriginMatcher("http://0.0.0.0:15173")

	for _, origin := range []string{
		"http://localhost:15173",
		"http://127.0.0.1:15173",
		"http://192.168.1.20:15173",
		"http://my-laptop:15173",
	} {
		if !matcher.Allow(origin) {
			t.Fatalf("expected origin %q to be allowed", origin)
		}
	}

	for _, origin := range []string{
		"https://192.168.1.20:15173",
		"http://192.168.1.20:4173",
	} {
		if matcher.Allow(origin) {
			t.Fatalf("expected origin %q to be rejected", origin)
		}
	}
}

func TestOriginMatcherAllowRequestAllowsSameOriginRequestBaseURL(t *testing.T) {
	t.Parallel()

	matcher := newOriginMatcher("")
	request := httptest.NewRequest(http.MethodGet, "http://localhost:18080/api/workspaces/ws-1/stream", nil)
	request.Header.Set("Origin", "http://localhost:18080")

	if !matcher.AllowRequest(request, "http://localhost:18080") {
		t.Fatal("expected same-origin request base URL to be allowed")
	}
}
