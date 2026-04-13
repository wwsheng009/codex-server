package events

import (
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/store"
)

const (
	subscriberOutputBufferSize = 128
	subscriberQueueSoftLimit   = 128
	subscriberQueueHardLimit   = 512
)

var nextSubscriberID atomic.Uint64

type Hub struct {
	mu                sync.RWMutex
	subscribers       map[string]map[*subscriber]struct{}
	globalSubscribers map[*subscriber]struct{}
	dataStore         interface {
		ApplyThreadEvent(store.EventEnvelope)
		AppendWorkspaceEvent(store.EventEnvelope) store.EventEnvelope
		ListWorkspaceEventsAfter(string, uint64, int) []store.EventEnvelope
		GetWorkspaceEventHeadSeq(string) uint64
	}
}

type subscriber struct {
	id                          uint64
	scope                       string
	role                        string
	source                      string
	out                         chan store.EventEnvelope
	notify                      chan struct{}
	done                        chan struct{}
	mu                          sync.Mutex
	queue                       []store.EventEnvelope
	closed                      bool
	queuedCount                 int
	mergedCount                 int
	softDroppedCount            int
	hardDroppedCount            int
	hardEvictedCount            int
	coalescedCommandOutputBytes int
	coalescedByMethod           map[string]int
	lastQueuedAt                time.Time
	lastMergedAt                time.Time
	droppedCount                int
	lastDroppedAt               time.Time
	lastDequeuedAt              time.Time
	lastMethod                  string
	lastSeq                     uint64
}

type subscriberBackpressureResult struct {
	dropped bool
	merged  bool
}

type subscriberCoalesceResult struct {
	merged bool
	method string
	bytes  int
}

type HubSnapshot struct {
	CapturedAt                       time.Time              `json:"capturedAt"`
	WorkspaceCount                   int                    `json:"workspaceCount"`
	WorkspaceSubscriberCount         int                    `json:"workspaceSubscriberCount"`
	GlobalSubscriberCount            int                    `json:"globalSubscriberCount"`
	TotalSubscriberCount             int                    `json:"totalSubscriberCount"`
	TotalBufferedEventCount          int                    `json:"totalBufferedEventCount"`
	TotalDroppedCount                int                    `json:"totalDroppedCount"`
	TotalSoftDroppedCount            int                    `json:"totalSoftDroppedCount"`
	TotalHardDroppedCount            int                    `json:"totalHardDroppedCount"`
	TotalHardEvictedCount            int                    `json:"totalHardEvictedCount"`
	TotalMergedCount                 int                    `json:"totalMergedCount"`
	TotalCoalescedCommandOutputBytes int                    `json:"totalCoalescedCommandOutputBytes"`
	TotalCoalescedByMethod           map[string]int         `json:"totalCoalescedByMethod,omitempty"`
	Workspaces                       []WorkspaceHubSnapshot `json:"workspaces"`
	GlobalSubscribers                []SubscriberSnapshot   `json:"globalSubscribers"`
}

type WorkspaceHubSnapshot struct {
	WorkspaceID     string               `json:"workspaceId"`
	SubscriberCount int                  `json:"subscriberCount"`
	HeadSeq         uint64               `json:"headSeq,omitempty"`
	Subscribers     []SubscriberSnapshot `json:"subscribers"`
}

type SubscriberSnapshot struct {
	ID                          uint64         `json:"id"`
	Scope                       string         `json:"scope,omitempty"`
	Role                        string         `json:"role,omitempty"`
	Source                      string         `json:"source,omitempty"`
	Closed                      bool           `json:"closed"`
	QueueLen                    int            `json:"queueLen"`
	OutputBufferLen             int            `json:"outputBufferLen"`
	OutputBufferCap             int            `json:"outputBufferCap"`
	QueuedCount                 int            `json:"queuedCount"`
	DroppedCount                int            `json:"droppedCount"`
	SoftDroppedCount            int            `json:"softDroppedCount"`
	HardDroppedCount            int            `json:"hardDroppedCount"`
	HardEvictedCount            int            `json:"hardEvictedCount"`
	MergedCount                 int            `json:"mergedCount"`
	CoalescedCommandOutputBytes int            `json:"coalescedCommandOutputBytes"`
	CoalescedByMethod           map[string]int `json:"coalescedByMethod,omitempty"`
	LastQueuedAt                *time.Time     `json:"lastQueuedAt,omitempty"`
	LastMergedAt                *time.Time     `json:"lastMergedAt,omitempty"`
	LastDroppedAt               *time.Time     `json:"lastDroppedAt,omitempty"`
	LastDequeuedAt              *time.Time     `json:"lastDequeuedAt,omitempty"`
	LastMethod                  string         `json:"lastMethod,omitempty"`
	LastSeq                     uint64         `json:"lastSeq,omitempty"`
}

func NewHub() *Hub {
	return &Hub{
		subscribers:       make(map[string]map[*subscriber]struct{}),
		globalSubscribers: make(map[*subscriber]struct{}),
	}
}

func (h *Hub) AttachStore(dataStore interface {
	ApplyThreadEvent(store.EventEnvelope)
	AppendWorkspaceEvent(store.EventEnvelope) store.EventEnvelope
	ListWorkspaceEventsAfter(string, uint64, int) []store.EventEnvelope
	GetWorkspaceEventHeadSeq(string) uint64
}) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.dataStore = dataStore
}

func (h *Hub) Subscribe(workspaceID string) (<-chan store.EventEnvelope, func()) {
	return h.SubscribeWithSource(workspaceID, "events.subscribe", "workspace-subscriber")
}

func (h *Hub) SubscribeWithSource(workspaceID string, source string, role string) (<-chan store.EventEnvelope, func()) {
	sub := newSubscriber("workspace", source, role)

	h.mu.Lock()
	if _, ok := h.subscribers[workspaceID]; !ok {
		h.subscribers[workspaceID] = make(map[*subscriber]struct{})
	}
	h.subscribers[workspaceID][sub] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()

		subscribers, ok := h.subscribers[workspaceID]
		if !ok {
			sub.close()
			return
		}

		if _, ok := subscribers[sub]; ok {
			delete(subscribers, sub)
			sub.close()
		}

		if len(subscribers) == 0 {
			delete(h.subscribers, workspaceID)
		}
	}

	return sub.out, cancel
}

func (h *Hub) SubscribeAll() (<-chan store.EventEnvelope, func()) {
	return h.SubscribeAllWithSource("events.subscribe_all", "global-subscriber")
}

func (h *Hub) SubscribeAllWithSource(source string, role string) (<-chan store.EventEnvelope, func()) {
	sub := newSubscriber("global", source, role)

	h.mu.Lock()
	h.globalSubscribers[sub] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()

		if _, ok := h.globalSubscribers[sub]; ok {
			delete(h.globalSubscribers, sub)
			sub.close()
		}
	}

	return sub.out, cancel
}

func (h *Hub) Publish(event store.EventEnvelope) {
	h.mu.RLock()
	dataStore := h.dataStore
	workspaceSubscribers := make([]*subscriber, 0, len(h.subscribers[event.WorkspaceID]))
	for sub := range h.subscribers[event.WorkspaceID] {
		workspaceSubscribers = append(workspaceSubscribers, sub)
	}
	globalSubscribers := make([]*subscriber, 0, len(h.globalSubscribers))
	for sub := range h.globalSubscribers {
		globalSubscribers = append(globalSubscribers, sub)
	}
	h.mu.RUnlock()
	if diagnostics.ShouldLogEventTrace("event hub publishing thread event", event.Method) {
		diagnostics.LogTrace(
			event.WorkspaceID,
			event.ThreadID,
			"event hub publishing thread event",
			append(
				diagnostics.EventTraceAttrs(event.Method, event.TurnID, event.Payload),
				"workspaceSubscriberCount",
				len(workspaceSubscribers),
				"globalSubscriberCount",
				len(globalSubscribers),
				"storeAttached",
				dataStore != nil,
			)...,
		)
	}

	if dataStore != nil && shouldSequenceWorkspaceEvent(event) {
		event = dataStore.AppendWorkspaceEvent(event)
	}

	workspaceDrops := 0
	for _, sub := range workspaceSubscribers {
		if result := sub.enqueue(event); result.dropped {
			workspaceDrops += 1
		}
	}

	globalDrops := 0
	for _, sub := range globalSubscribers {
		if result := sub.enqueue(event); result.dropped {
			globalDrops += 1
		}
	}

	if dataStore != nil {
		dataStore.ApplyThreadEvent(event)
	}

	if workspaceDrops == 0 && globalDrops == 0 {
		return
	}

	diagnostics.LogTrace(
		event.WorkspaceID,
		event.ThreadID,
		"event hub subscriber backpressure detected",
		append(
			diagnostics.EventTraceAttrs(event.Method, event.TurnID, event.Payload),
			"workspaceDroppedSubscriberCount",
			workspaceDrops,
			"globalDroppedSubscriberCount",
			globalDrops,
		)...,
	)
}

func (h *Hub) Replay(workspaceID string, afterSeq uint64, limit int) []store.EventEnvelope {
	h.mu.RLock()
	dataStore := h.dataStore
	h.mu.RUnlock()

	if dataStore == nil {
		return nil
	}

	return dataStore.ListWorkspaceEventsAfter(workspaceID, afterSeq, limit)
}

func (h *Hub) Snapshot() HubSnapshot {
	h.mu.RLock()
	dataStore := h.dataStore
	workspaceIDs := make([]string, 0, len(h.subscribers))
	workspaceSubscribers := make(map[string][]*subscriber, len(h.subscribers))
	totalWorkspaceSubscribers := 0
	for workspaceID, subscribers := range h.subscribers {
		workspaceIDs = append(workspaceIDs, workspaceID)
		copied := make([]*subscriber, 0, len(subscribers))
		for sub := range subscribers {
			copied = append(copied, sub)
		}
		workspaceSubscribers[workspaceID] = copied
		totalWorkspaceSubscribers += len(copied)
	}
	globalSubscribers := make([]*subscriber, 0, len(h.globalSubscribers))
	for sub := range h.globalSubscribers {
		globalSubscribers = append(globalSubscribers, sub)
	}
	h.mu.RUnlock()

	slices.Sort(workspaceIDs)
	sortSubscribersByID(globalSubscribers)

	snapshot := HubSnapshot{
		CapturedAt:               time.Now().UTC(),
		WorkspaceCount:           len(workspaceIDs),
		WorkspaceSubscriberCount: totalWorkspaceSubscribers,
		GlobalSubscriberCount:    len(globalSubscribers),
		TotalSubscriberCount:     totalWorkspaceSubscribers + len(globalSubscribers),
		TotalCoalescedByMethod:   make(map[string]int),
		Workspaces:               make([]WorkspaceHubSnapshot, 0, len(workspaceIDs)),
		GlobalSubscribers:        make([]SubscriberSnapshot, 0, len(globalSubscribers)),
	}

	for _, sub := range globalSubscribers {
		subSnapshot := sub.snapshot()
		snapshot.GlobalSubscribers = append(snapshot.GlobalSubscribers, subSnapshot)
		snapshot.TotalBufferedEventCount += subSnapshot.QueueLen + subSnapshot.OutputBufferLen
		snapshot.TotalDroppedCount += subSnapshot.DroppedCount
		snapshot.TotalSoftDroppedCount += subSnapshot.SoftDroppedCount
		snapshot.TotalHardDroppedCount += subSnapshot.HardDroppedCount
		snapshot.TotalHardEvictedCount += subSnapshot.HardEvictedCount
		snapshot.TotalMergedCount += subSnapshot.MergedCount
		snapshot.TotalCoalescedCommandOutputBytes += subSnapshot.CoalescedCommandOutputBytes
		mergeMethodCounts(snapshot.TotalCoalescedByMethod, subSnapshot.CoalescedByMethod)
	}

	for _, workspaceID := range workspaceIDs {
		subs := workspaceSubscribers[workspaceID]
		sortSubscribersByID(subs)
		workspaceSnapshot := WorkspaceHubSnapshot{
			WorkspaceID:     workspaceID,
			SubscriberCount: len(subs),
			Subscribers:     make([]SubscriberSnapshot, 0, len(subs)),
		}
		if dataStore != nil {
			workspaceSnapshot.HeadSeq = dataStore.GetWorkspaceEventHeadSeq(workspaceID)
		}

		for _, sub := range subs {
			subSnapshot := sub.snapshot()
			workspaceSnapshot.Subscribers = append(workspaceSnapshot.Subscribers, subSnapshot)
			snapshot.TotalBufferedEventCount += subSnapshot.QueueLen + subSnapshot.OutputBufferLen
			snapshot.TotalDroppedCount += subSnapshot.DroppedCount
			snapshot.TotalSoftDroppedCount += subSnapshot.SoftDroppedCount
			snapshot.TotalHardDroppedCount += subSnapshot.HardDroppedCount
			snapshot.TotalHardEvictedCount += subSnapshot.HardEvictedCount
			snapshot.TotalMergedCount += subSnapshot.MergedCount
			snapshot.TotalCoalescedCommandOutputBytes += subSnapshot.CoalescedCommandOutputBytes
			mergeMethodCounts(snapshot.TotalCoalescedByMethod, subSnapshot.CoalescedByMethod)
		}

		snapshot.Workspaces = append(snapshot.Workspaces, workspaceSnapshot)
	}

	return snapshot
}

func shouldSequenceWorkspaceEvent(event store.EventEnvelope) bool {
	switch event.Method {
	case "workspace/connected", "command/exec/stateSnapshot", "approvals/snapshot":
		return false
	default:
		return event.WorkspaceID != ""
	}
}

func newSubscriber(scope string, source string, role string) *subscriber {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		scope = "workspace"
	}
	source = strings.TrimSpace(source)
	role = strings.TrimSpace(role)
	sub := &subscriber{
		id:                nextSubscriberID.Add(1),
		scope:             scope,
		role:              role,
		source:            source,
		out:               make(chan store.EventEnvelope, subscriberOutputBufferSize),
		notify:            make(chan struct{}, 1),
		done:              make(chan struct{}),
		queue:             make([]store.EventEnvelope, 0, subscriberQueueSoftLimit),
		coalescedByMethod: make(map[string]int),
	}
	go sub.run()
	return sub
}

func (s *subscriber) run() {
	defer close(s.out)

	for {
		select {
		case <-s.done:
			return
		case <-s.notify:
		}

		for {
			event, ok := s.pop()
			if !ok {
				break
			}

			select {
			case <-s.done:
				return
			case s.out <- event:
			}
		}
	}
}

func (s *subscriber) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	close(s.done)
	s.queue = nil
	s.mu.Unlock()
}

func (s *subscriber) pop() (store.EventEnvelope, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.queue) == 0 {
		return store.EventEnvelope{}, false
	}

	event := s.queue[0]
	s.queue = append([]store.EventEnvelope(nil), s.queue[1:]...)
	s.lastDequeuedAt = time.Now().UTC()
	return event, true
}

func (s *subscriber) enqueue(event store.EventEnvelope) subscriberBackpressureResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return subscriberBackpressureResult{dropped: true}
	}

	if result := s.tryCoalesceLocked(event); result.merged {
		s.recordMergedLocked(event, result)
		s.recordEnqueueLocked(event)
		return subscriberBackpressureResult{merged: true}
	}

	if len(s.queue) >= subscriberQueueSoftLimit && isDroppableEvent(event.Method) {
		s.markDroppedLocked(dropReasonSoft)
		return subscriberBackpressureResult{dropped: true}
	}

	if len(s.queue) >= subscriberQueueHardLimit {
		droppedIndex := firstDroppableQueuedEventIndex(s.queue)
		if droppedIndex >= 0 {
			s.queue = append(s.queue[:droppedIndex], s.queue[droppedIndex+1:]...)
			s.markDroppedLocked(dropReasonHardEvicted)
		} else {
			s.markDroppedLocked(dropReasonHard)
			return subscriberBackpressureResult{dropped: true}
		}
	}

	s.queue = append(s.queue, event)
	s.recordEnqueueLocked(event)
	select {
	case s.notify <- struct{}{}:
	default:
	}
	return subscriberBackpressureResult{}
}

func (s *subscriber) tryCoalesceLocked(event store.EventEnvelope) subscriberCoalesceResult {
	switch event.Method {
	case "command/exec/outputDelta":
		return coalesceCommandOutputDeltaLocked(s.queue, event)
	case "thread/tokenUsage/updated":
		return coalesceThreadTokenUsageLocked(s.queue, event)
	default:
		return subscriberCoalesceResult{}
	}
}

type subscriberDropReason string

const (
	dropReasonSoft        subscriberDropReason = "soft"
	dropReasonHard        subscriberDropReason = "hard"
	dropReasonHardEvicted subscriberDropReason = "hard-evicted"
)

func (s *subscriber) markDroppedLocked(reason subscriberDropReason) {
	s.droppedCount += 1
	s.lastDroppedAt = time.Now().UTC()
	switch reason {
	case dropReasonSoft:
		s.softDroppedCount += 1
	case dropReasonHard:
		s.hardDroppedCount += 1
	case dropReasonHardEvicted:
		s.hardEvictedCount += 1
	}
}

func (s *subscriber) recordMergedLocked(event store.EventEnvelope, result subscriberCoalesceResult) {
	s.mergedCount += 1
	s.lastMergedAt = time.Now().UTC()
	s.incrementCoalescedMethodLocked(result.method)
	if event.Method == "command/exec/outputDelta" {
		s.coalescedCommandOutputBytes += result.bytes
	}
}

func (s *subscriber) incrementCoalescedMethodLocked(method string) {
	trimmed := strings.TrimSpace(method)
	if trimmed == "" {
		return
	}
	if s.coalescedByMethod == nil {
		s.coalescedByMethod = make(map[string]int)
	}
	s.coalescedByMethod[trimmed] += 1
}

func (s *subscriber) recordEnqueueLocked(event store.EventEnvelope) {
	s.queuedCount += 1
	s.lastQueuedAt = time.Now().UTC()
	s.lastMethod = event.Method
	if event.Seq > s.lastSeq {
		s.lastSeq = event.Seq
	}
}

func (s *subscriber) snapshot() SubscriberSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	snapshot := SubscriberSnapshot{
		ID:                          s.id,
		Scope:                       s.scope,
		Role:                        s.role,
		Source:                      s.source,
		Closed:                      s.closed,
		QueueLen:                    len(s.queue),
		OutputBufferLen:             len(s.out),
		OutputBufferCap:             cap(s.out),
		QueuedCount:                 s.queuedCount,
		DroppedCount:                s.droppedCount,
		SoftDroppedCount:            s.softDroppedCount,
		HardDroppedCount:            s.hardDroppedCount,
		HardEvictedCount:            s.hardEvictedCount,
		MergedCount:                 s.mergedCount,
		CoalescedCommandOutputBytes: s.coalescedCommandOutputBytes,
		LastMethod:                  s.lastMethod,
		LastSeq:                     s.lastSeq,
	}
	if len(s.coalescedByMethod) > 0 {
		snapshot.CoalescedByMethod = cloneStringIntMap(s.coalescedByMethod)
	}
	if !s.lastQueuedAt.IsZero() {
		ts := s.lastQueuedAt
		snapshot.LastQueuedAt = &ts
	}
	if !s.lastMergedAt.IsZero() {
		ts := s.lastMergedAt
		snapshot.LastMergedAt = &ts
	}
	if !s.lastDroppedAt.IsZero() {
		ts := s.lastDroppedAt
		snapshot.LastDroppedAt = &ts
	}
	if !s.lastDequeuedAt.IsZero() {
		ts := s.lastDequeuedAt
		snapshot.LastDequeuedAt = &ts
	}
	return snapshot
}

func mergeMethodCounts(target map[string]int, source map[string]int) {
	if len(source) == 0 {
		return
	}
	for method, count := range source {
		if strings.TrimSpace(method) == "" || count == 0 {
			continue
		}
		target[method] += count
	}
}

func cloneStringIntMap(source map[string]int) map[string]int {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[string]int, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func sortSubscribersByID(subscribers []*subscriber) {
	slices.SortFunc(subscribers, func(left *subscriber, right *subscriber) int {
		switch {
		case left == nil && right == nil:
			return 0
		case left == nil:
			return -1
		case right == nil:
			return 1
		case left.id < right.id:
			return -1
		case left.id > right.id:
			return 1
		default:
			return 0
		}
	})
}

func firstDroppableQueuedEventIndex(events []store.EventEnvelope) int {
	for index, event := range events {
		if isDroppableEvent(event.Method) {
			return index
		}
	}
	return -1
}

func isDroppableEvent(method string) bool {
	trimmed := strings.TrimSpace(method)
	if trimmed == "" {
		return false
	}

	if strings.HasSuffix(trimmed, "Delta") || strings.HasSuffix(trimmed, "/delta") {
		return true
	}

	switch trimmed {
	case "command/exec/outputDelta",
		"thread/tokenUsage/updated":
		return true
	default:
		return false
	}
}

func coalesceCommandOutputDeltaLocked(queue []store.EventEnvelope, incoming store.EventEnvelope) subscriberCoalesceResult {
	processID := payloadStringField(incoming.Payload, "processId")
	stream := payloadStringField(incoming.Payload, "stream")
	if processID == "" || stream == "" {
		return subscriberCoalesceResult{}
	}
	if payloadBoolField(incoming.Payload, "replace") || payloadBoolField(incoming.Payload, "replay") {
		return subscriberCoalesceResult{}
	}

	deltaText, hasDeltaText := payloadTextField(incoming.Payload, "deltaText")
	deltaBase64, hasDeltaBase64 := payloadTextField(incoming.Payload, "deltaBase64")
	if !hasDeltaText && !hasDeltaBase64 {
		return subscriberCoalesceResult{}
	}

	for index := len(queue) - 1; index >= 0; index-- {
		current := queue[index]
		if current.Method != incoming.Method || current.WorkspaceID != incoming.WorkspaceID {
			continue
		}
		if current.ThreadID != incoming.ThreadID || current.TurnID != incoming.TurnID {
			continue
		}
		if payloadStringField(current.Payload, "processId") != processID ||
			payloadStringField(current.Payload, "stream") != stream {
			continue
		}
		if payloadBoolField(current.Payload, "replace") || payloadBoolField(current.Payload, "replay") {
			continue
		}

		currentDeltaText, currentHasDeltaText := payloadTextField(current.Payload, "deltaText")
		currentDeltaBase64, currentHasDeltaBase64 := payloadTextField(current.Payload, "deltaBase64")
		if hasDeltaText != currentHasDeltaText || hasDeltaBase64 != currentHasDeltaBase64 {
			return subscriberCoalesceResult{}
		}

		payload, ok := clonePayloadMap(current.Payload)
		if !ok {
			return subscriberCoalesceResult{}
		}
		if hasDeltaText {
			payload["deltaText"] = currentDeltaText + deltaText
		}
		if hasDeltaBase64 {
			payload["deltaBase64"] = currentDeltaBase64 + deltaBase64
		}
		if replayBytes, ok := payloadIntField(current.Payload, "replayBytes"); ok {
			if incomingReplayBytes, ok := payloadIntField(incoming.Payload, "replayBytes"); ok {
				payload["replayBytes"] = replayBytes + incomingReplayBytes
			}
		}
		queue[index].Payload = payload
		queue[index].TS = incoming.TS
		if incoming.Seq > queue[index].Seq {
			queue[index].Seq = incoming.Seq
		}
		queue[index].Replay = queue[index].Replay || incoming.Replay
		return subscriberCoalesceResult{
			merged: true,
			method: incoming.Method,
			bytes:  len(deltaText) + len(deltaBase64),
		}
	}

	return subscriberCoalesceResult{}
}

func coalesceThreadTokenUsageLocked(queue []store.EventEnvelope, incoming store.EventEnvelope) subscriberCoalesceResult {
	for index := len(queue) - 1; index >= 0; index-- {
		current := queue[index]
		if current.Method != incoming.Method || current.WorkspaceID != incoming.WorkspaceID {
			continue
		}
		if current.ThreadID != incoming.ThreadID {
			continue
		}

		queue[index] = incoming
		return subscriberCoalesceResult{
			merged: true,
			method: incoming.Method,
		}
	}

	return subscriberCoalesceResult{}
}

func clonePayloadMap(payload any) (map[string]any, bool) {
	source, ok := payload.(map[string]any)
	if !ok {
		return nil, false
	}

	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned, true
}

func payloadStringField(payload any, key string) string {
	source, ok := payload.(map[string]any)
	if !ok {
		return ""
	}
	value, ok := source[key].(string)
	if !ok {
		return ""
	}
	return value
}

func payloadTextField(payload any, key string) (string, bool) {
	source, ok := payload.(map[string]any)
	if !ok {
		return "", false
	}
	value, ok := source[key]
	if !ok || value == nil {
		return "", false
	}
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	return text, true
}

func payloadBoolField(payload any, key string) bool {
	source, ok := payload.(map[string]any)
	if !ok {
		return false
	}
	value, ok := source[key].(bool)
	if !ok {
		return false
	}
	return value
}

func payloadIntField(payload any, key string) (int, bool) {
	source, ok := payload.(map[string]any)
	if !ok {
		return 0, false
	}

	switch value := source[key].(type) {
	case int:
		return value, true
	case int32:
		return int(value), true
	case int64:
		return int(value), true
	case float64:
		return int(value), true
	default:
		return 0, false
	}
}
