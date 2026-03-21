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
