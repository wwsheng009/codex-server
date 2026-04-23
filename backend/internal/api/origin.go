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
	anyHostOrigins  map[string]struct{}
	loopbackSchemes map[string]struct{}
}

func newOriginMatcher(configuredOrigins string) *originMatcher {
	matcher := &originMatcher{
		exactOrigins:    make(map[string]struct{}),
		anyHostOrigins:  make(map[string]struct{}),
		loopbackSchemes: make(map[string]struct{}),
	}

	for _, origin := range strings.Split(configuredOrigins, ",") {
		matcher.add(origin)
	}

	return matcher
}

func (m *originMatcher) AllowRequest(r *http.Request, origin string) bool {
	return m.Allow(origin) || requestOriginMatchesBaseURL(r, origin)
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

	if _, ok := m.anyHostOrigins[anyHostOriginKey(parsed)]; ok {
		return true
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

	if isBindAllHost(parsed.Hostname()) {
		m.anyHostOrigins[anyHostOriginKey(parsed)] = struct{}{}
	}

	if isLoopbackHost(parsed.Hostname()) {
		m.loopbackSchemes[strings.ToLower(parsed.Scheme)] = struct{}{}
	}
}

func normalizeOrigin(origin string) string {
	return strings.TrimRight(strings.TrimSpace(origin), "/")
}

func requestOriginMatchesBaseURL(r *http.Request, origin string) bool {
	if r == nil {
		return false
	}

	normalizedOrigin := normalizeOrigin(origin)
	if normalizedOrigin == "" {
		return false
	}

	parsedOrigin, err := url.Parse(normalizedOrigin)
	if err != nil || parsedOrigin.Scheme == "" || parsedOrigin.Host == "" {
		return false
	}

	scheme := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}

	host := strings.TrimSpace(r.Host)
	if host == "" {
		return false
	}

	return strings.EqualFold(parsedOrigin.Scheme, scheme) && strings.EqualFold(parsedOrigin.Host, host)
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}

	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func isBindAllHost(host string) bool {
	trimmed := strings.Trim(host, "[]")
	return trimmed == "0.0.0.0" || trimmed == "::"
}

func anyHostOriginKey(parsed *url.URL) string {
	return strings.ToLower(parsed.Scheme) + "://" + effectiveOriginPort(parsed)
}

func effectiveOriginPort(parsed *url.URL) string {
	if port := parsed.Port(); port != "" {
		return port
	}

	switch strings.ToLower(parsed.Scheme) {
	case "https":
		return "443"
	default:
		return "80"
	}
}
