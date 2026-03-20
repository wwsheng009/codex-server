package api

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

type originMatcher struct {
	allowAll        bool
	exactOrigins    map[string]struct{}
	loopbackSchemes map[string]struct{}
}

func newOriginMatcher(configuredOrigins string) *originMatcher {
	matcher := &originMatcher{
		exactOrigins:    make(map[string]struct{}),
		loopbackSchemes: make(map[string]struct{}),
	}

	for _, origin := range strings.Split(configuredOrigins, ",") {
		matcher.add(origin)
	}

	return matcher
}

func (m *originMatcher) AllowRequest(_ *http.Request, origin string) bool {
	return m.Allow(origin)
}

func (m *originMatcher) Allow(origin string) bool {
	normalized := normalizeOrigin(origin)
	if normalized == "" {
		return false
	}

	if m.allowAll {
		return true
	}

	if _, ok := m.exactOrigins[strings.ToLower(normalized)]; ok {
		return true
	}

	parsed, err := url.Parse(normalized)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}

	if _, ok := m.loopbackSchemes[strings.ToLower(parsed.Scheme)]; !ok {
		return false
	}

	return isLoopbackHost(parsed.Hostname())
}

func (m *originMatcher) add(origin string) {
	normalized := normalizeOrigin(origin)
	if normalized == "" {
		return
	}

	if normalized == "*" {
		m.allowAll = true
		return
	}

	m.exactOrigins[strings.ToLower(normalized)] = struct{}{}

	parsed, err := url.Parse(normalized)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return
	}

	if isLoopbackHost(parsed.Hostname()) {
		m.loopbackSchemes[strings.ToLower(parsed.Scheme)] = struct{}{}
	}
}

func normalizeOrigin(origin string) string {
	return strings.TrimRight(strings.TrimSpace(origin), "/")
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}

	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}
