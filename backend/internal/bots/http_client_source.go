package bots

import (
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/store"
)

type httpClientSource interface {
	Client(timeout time.Duration) *http.Client
}

type staticHTTPClientSource struct {
	client *http.Client
}

func (s staticHTTPClientSource) Client(timeout time.Duration) *http.Client {
	if s.client == nil {
		return &http.Client{Timeout: timeout}
	}

	cloned := *s.client
	if timeout > 0 && (cloned.Timeout == 0 || cloned.Timeout < timeout) {
		cloned.Timeout = timeout
	}
	return &cloned
}

type runtimeHTTPClientCacheKey struct {
	timeout  time.Duration
	proxyURL string
}

type runtimeHTTPClientSource struct {
	store           *store.MemoryStore
	defaultProxyURL string

	mu      sync.Mutex
	clients map[runtimeHTTPClientCacheKey]*http.Client
}

func newRuntimeHTTPClientSource(dataStore *store.MemoryStore, defaultProxyURL string) *runtimeHTTPClientSource {
	return &runtimeHTTPClientSource{
		store:           dataStore,
		defaultProxyURL: strings.TrimSpace(defaultProxyURL),
		clients:         make(map[runtimeHTTPClientCacheKey]*http.Client),
	}
}

func (s *runtimeHTTPClientSource) Client(timeout time.Duration) *http.Client {
	key := runtimeHTTPClientCacheKey{
		timeout:  timeout,
		proxyURL: s.effectiveProxyURL(),
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if client, ok := s.clients[key]; ok {
		return client
	}

	client := &http.Client{
		Timeout:   timeout,
		Transport: newProxyAwareTransport(key.proxyURL),
	}
	s.clients[key] = client
	return client
}

func (s *runtimeHTTPClientSource) effectiveProxyURL() string {
	if s.store != nil {
		if configured := strings.TrimSpace(s.store.GetRuntimePreferences().OutboundProxyURL); configured != "" {
			return configured
		}
	}

	return s.defaultProxyURL
}

func newProxyAwareTransport(proxyURL string) *http.Transport {
	transport := cloneDefaultHTTPTransport()
	trimmedProxyURL := strings.TrimSpace(proxyURL)
	if trimmedProxyURL == "" {
		transport.Proxy = http.ProxyFromEnvironment
		return transport
	}

	parsedProxyURL, err := url.Parse(trimmedProxyURL)
	if err != nil {
		transport.Proxy = http.ProxyFromEnvironment
		return transport
	}

	transport.Proxy = http.ProxyURL(parsedProxyURL)
	return transport
}

func cloneDefaultHTTPTransport() *http.Transport {
	if baseTransport, ok := http.DefaultTransport.(*http.Transport); ok {
		return baseTransport.Clone()
	}

	return &http.Transport{
		Proxy:             http.ProxyFromEnvironment,
		ForceAttemptHTTP2: true,
	}
}
