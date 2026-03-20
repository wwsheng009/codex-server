package api

import "testing"

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
