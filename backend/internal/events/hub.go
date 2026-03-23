package events

import (
	"sync"

	"codex-server/backend/internal/store"
)

type Hub struct {
	mu                sync.RWMutex
	subscribers       map[string]map[chan store.EventEnvelope]struct{}
	globalSubscribers map[chan store.EventEnvelope]struct{}
	dataStore         interface {
		ApplyThreadEvent(store.EventEnvelope)
	}
}

func NewHub() *Hub {
	return &Hub{
		subscribers:       make(map[string]map[chan store.EventEnvelope]struct{}),
		globalSubscribers: make(map[chan store.EventEnvelope]struct{}),
	}
}

func (h *Hub) AttachStore(dataStore interface {
	ApplyThreadEvent(store.EventEnvelope)
}) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.dataStore = dataStore
}

func (h *Hub) Subscribe(workspaceID string) (<-chan store.EventEnvelope, func()) {
	ch := make(chan store.EventEnvelope, 128)

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

func (h *Hub) SubscribeAll() (<-chan store.EventEnvelope, func()) {
	ch := make(chan store.EventEnvelope, 128)

	h.mu.Lock()
	h.globalSubscribers[ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()

		if _, ok := h.globalSubscribers[ch]; ok {
			delete(h.globalSubscribers, ch)
			close(ch)
		}
	}

	return ch, cancel
}

func (h *Hub) Publish(event store.EventEnvelope) {
	h.mu.RLock()
	dataStore := h.dataStore
	workspaceSubscribers := make([]chan store.EventEnvelope, 0, len(h.subscribers[event.WorkspaceID]))
	for subscriber := range h.subscribers[event.WorkspaceID] {
		workspaceSubscribers = append(workspaceSubscribers, subscriber)
	}
	globalSubscribers := make([]chan store.EventEnvelope, 0, len(h.globalSubscribers))
	for subscriber := range h.globalSubscribers {
		globalSubscribers = append(globalSubscribers, subscriber)
	}
	h.mu.RUnlock()

	overflowedWorkspaceSubscribers := make([]chan store.EventEnvelope, 0)
	for _, subscriber := range workspaceSubscribers {
		select {
		case subscriber <- event:
		default:
			overflowedWorkspaceSubscribers = append(overflowedWorkspaceSubscribers, subscriber)
		}
	}

	for _, subscriber := range globalSubscribers {
		select {
		case subscriber <- event:
		default:
		}
	}

	if dataStore != nil {
		dataStore.ApplyThreadEvent(event)
	}

	if len(overflowedWorkspaceSubscribers) == 0 {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	workspaceScopedSubscribers := h.subscribers[event.WorkspaceID]
	for _, subscriber := range overflowedWorkspaceSubscribers {
		if _, ok := workspaceScopedSubscribers[subscriber]; !ok {
			continue
		}

		delete(workspaceScopedSubscribers, subscriber)
		close(subscriber)
	}

	if len(workspaceScopedSubscribers) == 0 {
		delete(h.subscribers, event.WorkspaceID)
	}
}
