package runtime

import (
	"sort"
	"strings"
	"sync"
)

type serverRequestRegistry struct {
	mu          sync.RWMutex
	byID        map[string]PendingServerRequest
	byWorkspace map[string]map[string]struct{}
}

func newServerRequestRegistry() *serverRequestRegistry {
	return &serverRequestRegistry{
		byID:        make(map[string]PendingServerRequest),
		byWorkspace: make(map[string]map[string]struct{}),
	}
}

func (r *serverRequestRegistry) Register(request PendingServerRequest) PendingServerRequest {
	requestID := strings.TrimSpace(request.RequestID)
	if requestID == "" {
		return request
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.byID[requestID] = request
	workspaceRequests := r.byWorkspace[request.WorkspaceID]
	if workspaceRequests == nil {
		workspaceRequests = make(map[string]struct{})
		r.byWorkspace[request.WorkspaceID] = workspaceRequests
	}
	workspaceRequests[requestID] = struct{}{}

	return request
}

func (r *serverRequestRegistry) Get(requestID string) (PendingServerRequest, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	request, ok := r.byID[strings.TrimSpace(requestID)]
	return request, ok
}

func (r *serverRequestRegistry) Resolve(requestID string) (PendingServerRequest, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	requestID = strings.TrimSpace(requestID)
	request, ok := r.byID[requestID]
	if !ok {
		return PendingServerRequest{}, false
	}

	delete(r.byID, requestID)
	if workspaceRequests := r.byWorkspace[request.WorkspaceID]; workspaceRequests != nil {
		delete(workspaceRequests, requestID)
		if len(workspaceRequests) == 0 {
			delete(r.byWorkspace, request.WorkspaceID)
		}
	}

	return request, true
}

func (r *serverRequestRegistry) ListByWorkspace(workspaceID string) []PendingServerRequest {
	r.mu.RLock()
	defer r.mu.RUnlock()

	workspaceRequests := r.byWorkspace[workspaceID]
	items := make([]PendingServerRequest, 0, len(workspaceRequests))
	for requestID := range workspaceRequests {
		request, ok := r.byID[requestID]
		if ok {
			items = append(items, request)
		}
	}

	sortPendingServerRequests(items)
	return items
}

func (r *serverRequestRegistry) ExpireWorkspace(workspaceID string) []PendingServerRequest {
	r.mu.Lock()
	defer r.mu.Unlock()

	workspaceRequests := r.byWorkspace[workspaceID]
	if len(workspaceRequests) == 0 {
		return nil
	}

	expired := make([]PendingServerRequest, 0, len(workspaceRequests))
	for requestID := range workspaceRequests {
		request, ok := r.byID[requestID]
		if !ok {
			continue
		}

		expired = append(expired, request)
		delete(r.byID, requestID)
	}

	delete(r.byWorkspace, workspaceID)
	sortPendingServerRequests(expired)
	return expired
}

func sortPendingServerRequests(items []PendingServerRequest) {
	sort.Slice(items, func(i int, j int) bool {
		if items[i].RequestedAt.Equal(items[j].RequestedAt) {
			return items[i].RequestID < items[j].RequestID
		}
		return items[i].RequestedAt.After(items[j].RequestedAt)
	})
}
