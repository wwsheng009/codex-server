package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/bridge"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
)

var (
	ErrRuntimeNotConfigured  = errors.New("runtime is not configured")
	ErrServerRequestNotFound = errors.New("server request not found")
	ErrNoActiveTurn          = errors.New("no active turn")
)

const commandOutputBatchWindow = 16 * time.Millisecond

type State struct {
	WorkspaceID string     `json:"workspaceId"`
	Status      string     `json:"status"`
	Command     string     `json:"command"`
	RootPath    string     `json:"rootPath"`
	LastError   string     `json:"lastError,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type PendingServerRequest struct {
	RequestID   string
	WorkspaceID string
	ThreadID    string
	TurnID      string
	Method      string
	RawID       json.RawMessage
	Params      any
	RequestedAt time.Time
}

type Manager struct {
	mu       sync.RWMutex
	command  string
	events   *events.Hub
	runtimes map[string]*instance
	requests map[string]*PendingServerRequest
}

type instance struct {
	mu                      sync.RWMutex
	manager                 *Manager
	workspaceID             string
	rootPath                string
	client                  *bridge.Client
	expectClose             bool
	state                   State
	activeTurns             map[string]string
	commandOutputFlushTimer *time.Timer
	pendingCommandOutput    []pendingCommandOutputChunk
}

type pendingCommandOutputChunk struct {
	delta     []byte
	processID string
	stream    string
}

func NewManager(command string, eventHub *events.Hub) *Manager {
	return &Manager{
		command:  command,
		events:   eventHub,
		runtimes: make(map[string]*instance),
		requests: make(map[string]*PendingServerRequest),
	}
}

func (m *Manager) ApplyCommand(command string) {
	command = strings.TrimSpace(command)
	if command == "" {
		return
	}

	m.mu.Lock()
	m.command = command
	clients := make([]*bridge.Client, 0, len(m.runtimes))
	for _, runtime := range m.runtimes {
		runtime.mu.Lock()
		runtime.state.Command = command
		runtime.state.Status = "stopped"
		runtime.state.LastError = ""
		runtime.state.UpdatedAt = time.Now().UTC()
		runtime.activeTurns = make(map[string]string)
		if runtime.client != nil {
			runtime.expectClose = true
			clients = append(clients, runtime.client)
			runtime.client = nil
		}
		runtime.mu.Unlock()
	}
	m.mu.Unlock()

	for _, client := range clients {
		client.Close()
	}
}

func (m *Manager) Configure(workspaceID string, rootPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	runtime := m.getOrCreateLocked(workspaceID)
	runtime.rootPath = rootPath
	runtime.state.RootPath = rootPath
	runtime.state.UpdatedAt = time.Now().UTC()
	if runtime.state.Status == "" {
		runtime.state.Status = "stopped"
	}
}

func (m *Manager) RootPath(workspaceID string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	runtime, ok := m.runtimes[workspaceID]
	if !ok {
		return ""
	}

	runtime.mu.RLock()
	defer runtime.mu.RUnlock()

	return runtime.rootPath
}

func (m *Manager) State(workspaceID string) State {
	m.mu.RLock()
	runtime, ok := m.runtimes[workspaceID]
	m.mu.RUnlock()

	if !ok {
		return State{
			WorkspaceID: workspaceID,
			Status:      "unconfigured",
			Command:     m.command,
			UpdatedAt:   time.Now().UTC(),
		}
	}

	runtime.mu.RLock()
	defer runtime.mu.RUnlock()

	return runtime.state
}

func (m *Manager) EnsureStarted(ctx context.Context, workspaceID string) (State, error) {
	m.mu.RLock()
	runtime, ok := m.runtimes[workspaceID]
	m.mu.RUnlock()

	if !ok {
		return State{}, ErrRuntimeNotConfigured
	}

	return runtime.ensureStarted(ctx)
}

func (m *Manager) Call(ctx context.Context, workspaceID string, method string, params any, result any) error {
	m.mu.RLock()
	runtime, ok := m.runtimes[workspaceID]
	m.mu.RUnlock()
	if !ok {
		return ErrRuntimeNotConfigured
	}

	if _, err := runtime.ensureStarted(ctx); err != nil {
		return err
	}

	runtime.mu.RLock()
	client := runtime.client
	runtime.mu.RUnlock()

	if client == nil {
		return ErrRuntimeNotConfigured
	}

	return client.Call(ctx, method, params, result)
}

func (m *Manager) ListPendingRequests(workspaceID string) []PendingServerRequest {
	m.mu.RLock()
	defer m.mu.RUnlock()

	items := make([]PendingServerRequest, 0)
	for _, request := range m.requests {
		if request.WorkspaceID == workspaceID {
			items = append(items, *request)
		}
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].RequestedAt.After(items[j].RequestedAt)
	})

	return items
}

func (m *Manager) GetPendingRequest(requestID string) (PendingServerRequest, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	request, ok := m.requests[requestID]
	if !ok {
		return PendingServerRequest{}, false
	}

	return *request, true
}

func (m *Manager) Respond(ctx context.Context, requestID string, result any) (PendingServerRequest, error) {
	m.mu.RLock()
	request, ok := m.requests[requestID]
	if !ok {
		m.mu.RUnlock()
		return PendingServerRequest{}, ErrServerRequestNotFound
	}

	runtime := m.runtimes[request.WorkspaceID]
	m.mu.RUnlock()

	if runtime == nil {
		return PendingServerRequest{}, ErrRuntimeNotConfigured
	}

	if _, err := runtime.ensureStarted(ctx); err != nil {
		return PendingServerRequest{}, err
	}

	runtime.mu.RLock()
	client := runtime.client
	runtime.mu.RUnlock()
	if client == nil {
		return PendingServerRequest{}, ErrRuntimeNotConfigured
	}

	if err := client.Respond(request.RawID, result); err != nil {
		return PendingServerRequest{}, err
	}

	m.mu.Lock()
	delete(m.requests, requestID)
	m.mu.Unlock()

	m.events.Publish(store.EventEnvelope{
		WorkspaceID:     request.WorkspaceID,
		ThreadID:        request.ThreadID,
		TurnID:          request.TurnID,
		Method:          "server/request/resolved",
		Payload:         map[string]any{"method": request.Method},
		ServerRequestID: &requestID,
		TS:              time.Now().UTC(),
	})

	return *request, nil
}

func (m *Manager) ActiveTurnID(workspaceID string, threadID string) string {
	m.mu.RLock()
	runtime, ok := m.runtimes[workspaceID]
	m.mu.RUnlock()
	if !ok {
		return ""
	}

	runtime.mu.RLock()
	defer runtime.mu.RUnlock()

	return runtime.activeTurns[threadID]
}

func (m *Manager) RememberActiveTurn(workspaceID string, threadID string, turnID string) {
	m.mu.RLock()
	runtime, ok := m.runtimes[workspaceID]
	m.mu.RUnlock()
	if !ok {
		return
	}

	runtime.mu.Lock()
	defer runtime.mu.Unlock()

	if strings.TrimSpace(turnID) == "" {
		delete(runtime.activeTurns, threadID)
		return
	}

	runtime.activeTurns[threadID] = turnID
}

func (m *Manager) FirstWorkspaceID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	keys := make([]string, 0, len(m.runtimes))
	for workspaceID := range m.runtimes {
		keys = append(keys, workspaceID)
	}

	sort.Strings(keys)
	if len(keys) == 0 {
		return ""
	}

	return keys[0]
}

func (m *Manager) Remove(workspaceID string) {
	m.mu.Lock()
	runtime := m.runtimes[workspaceID]
	delete(m.runtimes, workspaceID)
	m.mu.Unlock()

	m.expireRequestsForWorkspace(workspaceID, "runtime_removed")

	if runtime == nil {
		return
	}

	runtime.mu.RLock()
	client := runtime.client
	runtime.mu.RUnlock()

	if client != nil {
		client.Close()
	}
}

func (m *Manager) getOrCreateLocked(workspaceID string) *instance {
	if runtime, ok := m.runtimes[workspaceID]; ok {
		return runtime
	}

	runtime := &instance{
		manager:     m,
		workspaceID: workspaceID,
		activeTurns: make(map[string]string),
		state: State{
			WorkspaceID: workspaceID,
			Status:      "stopped",
			Command:     m.command,
			UpdatedAt:   time.Now().UTC(),
		},
	}

	m.runtimes[workspaceID] = runtime
	return runtime
}

func (r *instance) ensureStarted(ctx context.Context) (State, error) {
	r.mu.RLock()
	if r.client != nil {
		state := r.state
		r.mu.RUnlock()
		return state, nil
	}
	rootPath := r.rootPath
	r.mu.RUnlock()

	if strings.TrimSpace(rootPath) == "" {
		return State{}, ErrRuntimeNotConfigured
	}

	r.mu.Lock()
	if r.client != nil {
		state := r.state
		r.mu.Unlock()
		return state, nil
	}

	r.state.Status = "starting"
	r.state.RootPath = rootPath
	r.state.UpdatedAt = time.Now().UTC()
	r.mu.Unlock()

	client, err := bridge.Start(ctx, bridge.Config{
		Command:         r.manager.command,
		Cwd:             rootPath,
		ClientName:      "codex-server",
		ClientVersion:   "0.1.0",
		ExperimentalAPI: true,
	}, r)
	if err != nil {
		r.mu.Lock()
		r.state.Status = "error"
		r.state.LastError = err.Error()
		r.state.UpdatedAt = time.Now().UTC()
		state := r.state
		r.mu.Unlock()
		return state, err
	}

	now := time.Now().UTC()

	r.mu.Lock()
	r.client = client
	r.state.Status = "ready"
	r.state.LastError = ""
	r.state.RootPath = rootPath
	r.state.StartedAt = &now
	r.state.UpdatedAt = now
	state := r.state
	r.mu.Unlock()

	return state, nil
}

func (r *instance) HandleNotification(method string, params json.RawMessage) {
	if method == "command/exec/outputDelta" && r.queueCommandOutputDelta(params) {
		return
	}

	r.flushPendingCommandOutput()

	payload := decodePayload(params)
	threadID, turnID := extractContext(payload)

	r.trackTurn(method, threadID, turnID)

	r.manager.events.Publish(store.EventEnvelope{
		WorkspaceID: r.workspaceID,
		ThreadID:    threadID,
		TurnID:      turnID,
		Method:      method,
		Payload:     payload,
		TS:          time.Now().UTC(),
	})
}

func (r *instance) HandleRequest(id json.RawMessage, method string, params json.RawMessage) {
	r.flushPendingCommandOutput()

	payload := decodePayload(params)
	threadID, turnID := extractContext(payload)

	requestID := store.NewID("req")
	request := &PendingServerRequest{
		RequestID:   requestID,
		WorkspaceID: r.workspaceID,
		ThreadID:    threadID,
		TurnID:      turnID,
		Method:      method,
		RawID:       id,
		Params:      payload,
		RequestedAt: time.Now().UTC(),
	}

	r.manager.mu.Lock()
	r.manager.requests[requestID] = request
	r.manager.mu.Unlock()

	r.manager.events.Publish(store.EventEnvelope{
		WorkspaceID:     r.workspaceID,
		ThreadID:        threadID,
		TurnID:          turnID,
		Method:          method,
		Payload:         payload,
		ServerRequestID: &requestID,
		TS:              request.RequestedAt,
	})
}

func (r *instance) HandleStderr(line string) {
	r.mu.Lock()
	r.state.LastError = line
	r.state.UpdatedAt = time.Now().UTC()
	r.mu.Unlock()
}

func (r *instance) HandleClosed(err error) {
	r.flushPendingCommandOutput()

	r.manager.expireRequestsForWorkspace(r.workspaceID, "runtime_closed")

	r.mu.Lock()
	expectClose := r.expectClose
	r.expectClose = false
	r.client = nil
	r.state.Status = "stopped"
	r.state.UpdatedAt = time.Now().UTC()
	if err != nil && !expectClose && !errors.Is(err, context.Canceled) {
		r.state.Status = "error"
		r.state.LastError = err.Error()
	} else if expectClose {
		r.state.LastError = ""
	}
	r.mu.Unlock()
}

func (r *instance) trackTurn(method string, threadID string, turnID string) {
	if threadID == "" {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	switch method {
	case "turn/started":
		if turnID != "" {
			r.activeTurns[threadID] = turnID
		}
	case "turn/completed":
		if currentTurnID, ok := r.activeTurns[threadID]; ok && (turnID == "" || currentTurnID == turnID) {
			delete(r.activeTurns, threadID)
		}
	}
}

func decodePayload(raw json.RawMessage) any {
	if len(raw) == 0 {
		return map[string]any{}
	}

	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return map[string]any{
			"raw": string(raw),
		}
	}

	return payload
}

func extractContext(payload any) (string, string) {
	object, ok := payload.(map[string]any)
	if !ok {
		return "", ""
	}

	threadID := stringValue(object["threadId"])
	turnID := stringValue(object["turnId"])

	if threadID == "" {
		threadID = nestedID(object["thread"])
	}

	if turnID == "" {
		turnID = nestedID(object["turn"])
	}

	return threadID, turnID
}

func nestedID(value any) string {
	object, ok := value.(map[string]any)
	if !ok {
		return ""
	}

	return stringValue(object["id"])
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func (r *instance) queueCommandOutputDelta(params json.RawMessage) bool {
	payloadAny := decodePayload(params)
	payload, ok := payloadAny.(map[string]any)
	if !ok {
		return false
	}

	processID := stringValue(payload["processId"])
	stream := stringValue(payload["stream"])
	deltaBase64 := stringValue(payload["deltaBase64"])
	if processID == "" || stream == "" || deltaBase64 == "" {
		return false
	}

	delta, err := base64.StdEncoding.DecodeString(strings.TrimSpace(deltaBase64))
	if err != nil {
		return false
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	chunkCount := len(r.pendingCommandOutput)
	if chunkCount > 0 {
		lastChunk := &r.pendingCommandOutput[chunkCount-1]
		if lastChunk.processID == processID && lastChunk.stream == stream {
			lastChunk.delta = append(lastChunk.delta, delta...)
		} else {
			r.pendingCommandOutput = append(r.pendingCommandOutput, pendingCommandOutputChunk{
				delta:     append([]byte(nil), delta...),
				processID: processID,
				stream:    stream,
			})
		}
	} else {
		r.pendingCommandOutput = append(r.pendingCommandOutput, pendingCommandOutputChunk{
			delta:     append([]byte(nil), delta...),
			processID: processID,
			stream:    stream,
		})
	}

	if r.commandOutputFlushTimer == nil {
		r.commandOutputFlushTimer = time.AfterFunc(commandOutputBatchWindow, func() {
			r.flushPendingCommandOutput()
		})
	}

	return true
}

func (r *instance) flushPendingCommandOutput() {
	r.mu.Lock()
	if r.commandOutputFlushTimer != nil {
		r.commandOutputFlushTimer.Stop()
		r.commandOutputFlushTimer = nil
	}
	if len(r.pendingCommandOutput) == 0 {
		r.mu.Unlock()
		return
	}

	chunks := append([]pendingCommandOutputChunk(nil), r.pendingCommandOutput...)
	r.pendingCommandOutput = nil
	r.mu.Unlock()

	now := time.Now().UTC()
	for _, chunk := range chunks {
		r.manager.events.Publish(store.EventEnvelope{
			WorkspaceID: r.workspaceID,
			Method:      "command/exec/outputDelta",
			Payload: map[string]any{
				"deltaBase64": base64.StdEncoding.EncodeToString(chunk.delta),
				"processId":   chunk.processID,
				"stream":      chunk.stream,
			},
			TS: now,
		})
	}
}

func (m *Manager) expireRequestsForWorkspace(workspaceID string, reason string) {
	m.mu.Lock()
	expired := make([]PendingServerRequest, 0)
	for requestID, request := range m.requests {
		if request.WorkspaceID != workspaceID {
			continue
		}

		expired = append(expired, *request)
		delete(m.requests, requestID)
	}
	m.mu.Unlock()

	for _, request := range expired {
		if m.events == nil {
			continue
		}
		requestID := request.RequestID
		m.events.Publish(store.EventEnvelope{
			WorkspaceID:     request.WorkspaceID,
			ThreadID:        request.ThreadID,
			TurnID:          request.TurnID,
			Method:          "server/request/expired",
			Payload:         map[string]any{"method": request.Method, "reason": reason},
			ServerRequestID: &requestID,
			TS:              time.Now().UTC(),
		})
	}
}
