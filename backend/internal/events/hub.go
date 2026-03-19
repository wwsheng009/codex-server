package events

import (
	"sync"

	"codex-server/backend/internal/store"
)

type Hub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan store.EventEnvelope]struct{}
}

func NewHub() *Hub {
	return &Hub{
		subscribers: make(map[string]map[chan store.EventEnvelope]struct{}),
	}
}

func (h *Hub) Subscribe(workspaceID string) (<-chan store.EventEnvelope, func()) {
	ch := make(chan store.EventEnvelope, 32)

	h.mu.Lock()
	if _, ok := h.subscribers[workspaceID]; !ok {
		h.subscribers[workspaceID] = make(map[chan store.EventEnvelope]struct{})
	}
	h.subscribers[workspaceID][ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()

		subscribers, ok := h.subscribers[workspaceID]
		if !ok {
			return
		}

		if _, ok := subscribers[ch]; ok {
			delete(subscribers, ch)
			close(ch)
		}

		if len(subscribers) == 0 {
			delete(h.subscribers, workspaceID)
		}
	}

	return ch, cancel
}

func (h *Hub) Publish(event store.EventEnvelope) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for subscriber := range h.subscribers[event.WorkspaceID] {
		select {
		case subscriber <- event:
		default:
		}
	}
}
