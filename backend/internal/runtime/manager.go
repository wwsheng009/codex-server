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
	"unicode/utf8"

	"codex-server/backend/internal/bridge"
	appconfig "codex-server/backend/internal/config"
	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
)

var (
	ErrRuntimeNotConfigured  = errors.New("runtime is not configured")
	ErrServerRequestNotFound = errors.New("server request not found")
	ErrNoActiveTurn          = errors.New("no active turn")
)

const commandOutputBatchWindow = 16 * time.Millisecond
const commandOutputMaxChunkBytes = 16 * 1024

type State struct {
	WorkspaceID                     string     `json:"workspaceId"`
	Status                          string     `json:"status"`
	Command                         string     `json:"command"`
	RootPath                        string     `json:"rootPath"`
	LastError                       string     `json:"lastError,omitempty"`
	LastErrorCategory               string     `json:"lastErrorCategory,omitempty"`
	LastErrorRecoveryAction         string     `json:"lastErrorRecoveryAction,omitempty"`
	LastErrorRetryable              bool       `json:"lastErrorRetryable"`
	LastErrorRequiresRuntimeRecycle bool       `json:"lastErrorRequiresRuntimeRecycle"`
	RecentStderr                    []string   `json:"recentStderr,omitempty"`
	StartedAt                       *time.Time `json:"startedAt,omitempty"`
	UpdatedAt                       time.Time  `json:"updatedAt"`
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

type ServerRequestInput struct {
	WorkspaceID string
	ThreadID    string
	TurnID      string
	Method      string
	Params      any
}

type ServerRequestInterception struct {
	Handled  bool
	Response any
}

type ServerRequestInterceptor interface {
	InterceptServerRequest(ctx context.Context, input ServerRequestInput) (ServerRequestInterception, error)
}

type Manager struct {
	mu           sync.RWMutex
	launchConfig appconfig.RuntimeLaunchConfig
	events       *events.Hub
	runtimes     map[string]*instance
	requests     *serverRequestRegistry

	requestInterceptor ServerRequestInterceptor
}

type instance struct {
	mu                      sync.RWMutex
	manager                 *Manager
	workspaceID             string
	rootPath                string
	client                  *bridge.Client
	expectClose             bool
	state                   State
	stderrBuffer            *stderrRingBuffer
	activeTurns             map[string]string
	interruptingTurns       map[string]string
	lastTerminalTurns       map[string]string
	commandOutputFlushTimer *time.Timer
	pendingCommandOutputLen int
	pendingCommandOutput    []pendingCommandOutputChunk
}

type pendingCommandOutputChunk struct {
	delta     []byte
	processID string
	stream    string
}

func NewManager(command string, eventHub *events.Hub) *Manager {
	return NewManagerWithLaunchConfig(appconfig.RuntimeLaunchConfig{
		BaseCommand: command,
		Command:     command,
	}, eventHub)
}

func NewManagerWithLaunchConfig(launchConfig appconfig.RuntimeLaunchConfig, eventHub *events.Hub) *Manager {
	launchConfig = appconfig.NormalizeRuntimeLaunchConfig(launchConfig)
	return &Manager{
		launchConfig: launchConfig,
		events:       eventHub,
		runtimes:     make(map[string]*instance),
		requests:     newServerRequestRegistry(),
	}
}

func (m *Manager) SetServerRequestInterceptor(interceptor ServerRequestInterceptor) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.requestInterceptor = interceptor
}

func (m *Manager) ApplyCommand(command string) {
	m.ApplyLaunchConfig(appconfig.RuntimeLaunchConfig{
		BaseCommand: command,
		Command:     command,
	})
}

func (m *Manager) ApplyLaunchConfig(launchConfig appconfig.RuntimeLaunchConfig) {
	launchConfig = appconfig.NormalizeRuntimeLaunchConfig(launchConfig)
	if launchConfig.Command == "" {
		return
	}

	m.mu.Lock()
	m.launchConfig = launchConfig
	clients := make([]*bridge.Client, 0, len(m.runtimes))
	for _, runtime := range m.runtimes {
		runtime.mu.Lock()
		runtime.state.Command = launchConfig.Command
		runtime.state.Status = "stopped"
		runtime.state.LastError = ""
		runtime.state.RecentStderr = nil
		if runtime.stderrBuffer != nil {
			runtime.stderrBuffer.Reset()
		}
		runtime.state.UpdatedAt = time.Now().UTC()
		runtime.activeTurns = make(map[string]string)
		runtime.interruptingTurns = make(map[string]string)
		runtime.lastTerminalTurns = make(map[string]string)
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
			Command:     m.launchConfig.Command,
			UpdatedAt:   time.Now().UTC(),
		}
	}

	runtime.mu.RLock()
	defer runtime.mu.RUnlock()

	return cloneRuntimeState(runtime.state)
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
	return m.requests.ListByWorkspace(workspaceID)
}

func (m *Manager) GetPendingRequest(requestID string) (PendingServerRequest, bool) {
	return m.requests.Get(requestID)
}

func (m *Manager) Respond(ctx context.Context, requestID string, result any) (PendingServerRequest, error) {
	request, ok := m.requests.Get(requestID)
	if !ok {
		return PendingServerRequest{}, ErrServerRequestNotFound
	}

	m.mu.RLock()
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

	resolved, ok := m.requests.Resolve(requestID)
	if !ok {
		return request, nil
	}

	m.publish(store.EventEnvelope{
		WorkspaceID:     resolved.WorkspaceID,
		ThreadID:        resolved.ThreadID,
		TurnID:          resolved.TurnID,
		Method:          "server/request/resolved",
		Payload:         map[string]any{"method": resolved.Method},
		ServerRequestID: &requestID,
		TS:              time.Now().UTC(),
	})

	return resolved, nil
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
		delete(runtime.interruptingTurns, threadID)
		diagnostics.LogThreadTrace(workspaceID, threadID, "runtime active turn cleared")
		return
	}

	if runtime.lastTerminalTurns[threadID] == turnID {
		diagnostics.LogThreadTrace(
			workspaceID,
			threadID,
			"runtime active turn remember skipped for terminal turn",
			"turnId",
			turnID,
		)
		return
	}

	runtime.activeTurns[threadID] = turnID
	delete(runtime.interruptingTurns, threadID)
	delete(runtime.lastTerminalTurns, threadID)
	diagnostics.LogThreadTrace(workspaceID, threadID, "runtime active turn remembered", "turnId", turnID)
}

func (m *Manager) BeginInterrupt(workspaceID string, threadID string) string {
	m.mu.RLock()
	runtime, ok := m.runtimes[workspaceID]
	m.mu.RUnlock()
	if !ok {
		return ""
	}

	runtime.mu.Lock()
	defer runtime.mu.Unlock()

	if interruptingTurnID := runtime.interruptingTurns[threadID]; strings.TrimSpace(interruptingTurnID) != "" {
		diagnostics.LogThreadTrace(
			workspaceID,
			threadID,
			"runtime interrupt already in progress",
			"turnId",
			interruptingTurnID,
		)
		return ""
	}

	turnID := strings.TrimSpace(runtime.activeTurns[threadID])
	if turnID == "" {
		return ""
	}

	delete(runtime.activeTurns, threadID)
	runtime.interruptingTurns[threadID] = turnID
	diagnostics.LogThreadTrace(workspaceID, threadID, "runtime interrupt begun", "turnId", turnID)
	return turnID
}

func (m *Manager) FinishInterrupt(workspaceID string, threadID string, turnID string) {
	m.mu.RLock()
	runtime, ok := m.runtimes[workspaceID]
	m.mu.RUnlock()
	if !ok {
		return
	}

	runtime.mu.Lock()
	defer runtime.mu.Unlock()

	interruptingTurnID := strings.TrimSpace(runtime.interruptingTurns[threadID])
	if interruptingTurnID == "" {
		return
	}
	if turnID != "" && interruptingTurnID != turnID {
		return
	}

	delete(runtime.interruptingTurns, threadID)
	diagnostics.LogThreadTrace(workspaceID, threadID, "runtime interrupt finished", "turnId", interruptingTurnID)
}

func (m *Manager) RestoreInterruptedTurn(workspaceID string, threadID string, turnID string) {
	turnID = strings.TrimSpace(turnID)
	if turnID == "" {
		return
	}

	m.mu.RLock()
	runtime, ok := m.runtimes[workspaceID]
	m.mu.RUnlock()
	if !ok {
		return
	}

	runtime.mu.Lock()
	defer runtime.mu.Unlock()

	if runtime.interruptingTurns[threadID] != turnID {
		return
	}
	delete(runtime.interruptingTurns, threadID)
	if runtime.lastTerminalTurns[threadID] == turnID {
		return
	}
	if strings.TrimSpace(runtime.activeTurns[threadID]) != "" {
		return
	}

	runtime.activeTurns[threadID] = turnID
	diagnostics.LogThreadTrace(workspaceID, threadID, "runtime interrupted turn restored", "turnId", turnID)
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

func (m *Manager) Recycle(workspaceID string) {
	rootPath := m.RootPath(workspaceID)
	m.Remove(workspaceID)
	if strings.TrimSpace(rootPath) == "" {
		return
	}

	m.Configure(workspaceID, rootPath)
}

func (m *Manager) getOrCreateLocked(workspaceID string) *instance {
	if runtime, ok := m.runtimes[workspaceID]; ok {
		return runtime
	}

	runtime := &instance{
		manager:           m,
		workspaceID:       workspaceID,
		stderrBuffer:      newStderrRingBuffer(runtimeStderrRingBufferCapacity),
		activeTurns:       make(map[string]string),
		interruptingTurns: make(map[string]string),
		lastTerminalTurns: make(map[string]string),
		state: State{
			WorkspaceID: workspaceID,
			Status:      "stopped",
			Command:     m.launchConfig.Command,
			UpdatedAt:   time.Now().UTC(),
		},
	}

	m.runtimes[workspaceID] = runtime
	return runtime
}

func (r *instance) ensureStarted(ctx context.Context) (State, error) {
	r.mu.RLock()
	if r.client != nil {
		state := cloneRuntimeState(r.state)
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
		state := cloneRuntimeState(r.state)
		r.mu.Unlock()
		return state, nil
	}

	if r.stderrBuffer != nil {
		r.stderrBuffer.Reset()
	}
	r.state.Status = "starting"
	r.state.RootPath = rootPath
	r.clearRuntimeErrorStateLocked()
	r.state.UpdatedAt = time.Now().UTC()
	r.mu.Unlock()
	diagnostics.LogWorkspaceTrace(
		r.workspaceID,
		"runtime ensure-start requested",
		"rootPath",
		rootPath,
		"command",
		diagnostics.TruncateString(r.manager.launchConfig.Command, 240),
	)

	client, err := bridge.Start(ctx, bridge.Config{
		LaunchConfig:    r.manager.launchConfig,
		Cwd:             rootPath,
		ClientName:      "codex-server",
		ClientVersion:   "0.1.0",
		ExperimentalAPI: true,
	}, r)
	if err != nil {
		r.mu.Lock()
		r.state.Status = "error"
		r.applyRuntimeFailureLocked(err)
		r.state.UpdatedAt = time.Now().UTC()
		state := cloneRuntimeState(r.state)
		r.mu.Unlock()
		diagnostics.LogWorkspaceTrace(r.workspaceID, "runtime ensure-start failed", "error", err)
		return state, err
	}

	now := time.Now().UTC()

	r.mu.Lock()
	r.client = client
	r.state.Status = "ready"
	r.clearRuntimeErrorStateLocked()
	r.state.RootPath = rootPath
	r.state.StartedAt = &now
	r.state.RecentStderr = r.stderrSnapshotLocked()
	r.state.UpdatedAt = now
	state := cloneRuntimeState(r.state)
	r.mu.Unlock()
	diagnostics.LogWorkspaceTrace(
		r.workspaceID,
		"runtime ready",
		"rootPath",
		rootPath,
		"startedAt",
		now.Format(time.RFC3339),
	)

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
	if diagnostics.ShouldLogEventTrace("runtime notification received", method) {
		diagnostics.LogTrace(
			r.workspaceID,
			threadID,
			"runtime notification received",
			diagnostics.EventTraceAttrs(method, turnID, payload)...,
		)
	}

	r.manager.publish(store.EventEnvelope{
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

	if r.interceptServerRequest(id, method, payload, threadID, turnID) {
		return
	}

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

	registered := r.manager.requests.Register(*request)
	diagnostics.LogTrace(
		r.workspaceID,
		threadID,
		"runtime request received",
		append(
			diagnostics.EventTraceAttrs(method, turnID, payload),
			"requestId",
			requestID,
		)...,
	)

	r.manager.publish(store.EventEnvelope{
		WorkspaceID:     r.workspaceID,
		ThreadID:        threadID,
		TurnID:          turnID,
		Method:          method,
		Payload:         payload,
		ServerRequestID: &requestID,
		TS:              registered.RequestedAt,
	})
}

func (r *instance) interceptServerRequest(
	id json.RawMessage,
	method string,
	payload any,
	threadID string,
	turnID string,
) bool {
	r.manager.mu.RLock()
	interceptor := r.manager.requestInterceptor
	r.manager.mu.RUnlock()
	if interceptor == nil {
		return false
	}

	decision, err := interceptor.InterceptServerRequest(context.Background(), ServerRequestInput{
		WorkspaceID: r.workspaceID,
		ThreadID:    threadID,
		TurnID:      turnID,
		Method:      method,
		Params:      payload,
	})
	if err != nil {
		diagnostics.LogTrace(
			r.workspaceID,
			threadID,
			"runtime request interception failed",
			append(
				diagnostics.EventTraceAttrs(method, turnID, payload),
				"error",
				err,
			)...,
		)
		return false
	}
	if !decision.Handled {
		return false
	}

	r.mu.RLock()
	client := r.client
	r.mu.RUnlock()
	if client == nil {
		diagnostics.LogTrace(
			r.workspaceID,
			threadID,
			"runtime request intercepted without active client",
			diagnostics.EventTraceAttrs(method, turnID, payload)...,
		)
		return true
	}

	if err := client.Respond(id, decision.Response); err != nil {
		diagnostics.LogTrace(
			r.workspaceID,
			threadID,
			"runtime request interception response failed",
			append(
				diagnostics.EventTraceAttrs(method, turnID, payload),
				"error",
				err,
			)...,
		)
		return true
	}

	diagnostics.LogTrace(
		r.workspaceID,
		threadID,
		"runtime request intercepted",
		diagnostics.EventTraceAttrs(method, turnID, payload)...,
	)
	return true
}

func (r *instance) HandleStderr(line string) {
	r.mu.Lock()
	if r.stderrBuffer != nil {
		r.stderrBuffer.Append(line)
	}
	r.state.RecentStderr = r.stderrSnapshotLocked()
	r.state.LastError = truncateRuntimeStderrText(strings.TrimSpace(line), runtimeStderrSummaryMaxChars)
	r.state.LastErrorCategory = ""
	r.state.LastErrorRecoveryAction = ""
	r.state.LastErrorRetryable = false
	r.state.LastErrorRequiresRuntimeRecycle = false
	r.state.UpdatedAt = time.Now().UTC()
	r.mu.Unlock()
	diagnostics.LogWorkspaceTrace(
		r.workspaceID,
		"runtime stderr",
		"line",
		diagnostics.TruncateString(line, 300),
	)
}

func (r *instance) HandleClosed(err error) {
	r.flushPendingCommandOutput()

	r.manager.expireRequestsForWorkspace(r.workspaceID, "runtime_closed")

	r.mu.Lock()
	expectClose := r.expectClose
	wasRunning := r.client != nil || r.state.Status == "ready" || r.state.Status == "starting"
	activeTurns := mapsCloneStringString(r.activeTurns)
	interruptingTurns := mapsCloneStringString(r.interruptingTurns)
	r.expectClose = false
	r.client = nil
	r.state.Status = "stopped"
	r.state.UpdatedAt = time.Now().UTC()
	r.activeTurns = make(map[string]string)
	r.interruptingTurns = make(map[string]string)
	r.lastTerminalTurns = make(map[string]string)
	if !expectClose && !errors.Is(err, context.Canceled) && wasRunning {
		r.state.Status = "error"
		if err == nil {
			err = errors.New("app-server closed unexpectedly")
		}
		r.applyRuntimeFailureLocked(err)
	} else if expectClose {
		r.clearRuntimeErrorStateLocked()
		if r.stderrBuffer != nil {
			r.stderrBuffer.Reset()
		}
	}
	r.mu.Unlock()

	if !expectClose && !errors.Is(err, context.Canceled) && wasRunning {
		r.publishSyntheticTerminalEventsOnUnexpectedClose(activeTurns, interruptingTurns)
	}
	diagnostics.LogWorkspaceTrace(
		r.workspaceID,
		"runtime closed",
		"expectedClose",
		expectClose,
		"error",
		err,
	)
}

func (r *instance) publishSyntheticTerminalEventsOnUnexpectedClose(
	activeTurns map[string]string,
	interruptingTurns map[string]string,
) {
	now := time.Now().UTC()
	threadIDs := make(map[string]struct{})
	for threadID := range activeTurns {
		if strings.TrimSpace(threadID) != "" {
			threadIDs[threadID] = struct{}{}
		}
	}
	for threadID := range interruptingTurns {
		if strings.TrimSpace(threadID) != "" {
			threadIDs[threadID] = struct{}{}
		}
	}

	for threadID := range threadIDs {
		turnID := firstNonEmptyString(activeTurns[threadID], interruptingTurns[threadID])
		if turnID != "" {
			r.manager.publish(store.EventEnvelope{
				WorkspaceID: r.workspaceID,
				ThreadID:    threadID,
				TurnID:      turnID,
				Method:      "turn/interrupted",
				Payload: map[string]any{
					"threadId": threadID,
					"turn": map[string]any{
						"id":     turnID,
						"status": "interrupted",
					},
				},
				TS: now,
			})
		}

		r.manager.publish(store.EventEnvelope{
			WorkspaceID: r.workspaceID,
			ThreadID:    threadID,
			Method:      "thread/status/changed",
			Payload: map[string]any{
				"threadId": threadID,
				"status": map[string]any{
					"type": "systemError",
				},
			},
			TS: now,
		})
	}
}

func mapsCloneStringString(input map[string]string) map[string]string {
	if len(input) == 0 {
		return map[string]string{}
	}

	result := make(map[string]string, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
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
			delete(r.interruptingTurns, threadID)
			delete(r.lastTerminalTurns, threadID)
		}
	case "turn/completed", "turn/failed", "turn/interrupted", "turn/canceled", "turn/cancelled":
		currentTurnID := strings.TrimSpace(r.activeTurns[threadID])
		interruptingTurnID := strings.TrimSpace(r.interruptingTurns[threadID])
		if currentTurnID != "" && (turnID == "" || currentTurnID == turnID) {
			delete(r.activeTurns, threadID)
		}
		if interruptingTurnID != "" && (turnID == "" || interruptingTurnID == turnID) {
			delete(r.interruptingTurns, threadID)
		}
		if terminalTurnID := firstNonEmptyString(turnID, interruptingTurnID, currentTurnID); terminalTurnID != "" {
			r.lastTerminalTurns[threadID] = terminalTurnID
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

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
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
	r.pendingCommandOutputLen += len(delta)

	if r.commandOutputFlushTimer == nil {
		r.commandOutputFlushTimer = time.AfterFunc(commandOutputBatchWindow, func() {
			r.flushPendingCommandOutput()
		})
	}

	shouldFlushImmediately := r.pendingCommandOutputLen >= commandOutputMaxChunkBytes
	if shouldFlushImmediately && r.commandOutputFlushTimer != nil {
		r.commandOutputFlushTimer.Stop()
		r.commandOutputFlushTimer = nil
	}
	if diagnostics.ShouldLogEventTrace("runtime command output delta queued", "command/exec/outputDelta") {
		diagnostics.LogWorkspaceTrace(
			r.workspaceID,
			"runtime command output delta queued",
			"method",
			"command/exec/outputDelta",
			"processId",
			processID,
			"stream",
			stream,
			"deltaLen",
			len(delta),
			"pendingBytes",
			r.pendingCommandOutputLen,
			"flushImmediately",
			shouldFlushImmediately,
		)
	}
	r.mu.Unlock()

	if shouldFlushImmediately {
		r.flushPendingCommandOutput()
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
	r.pendingCommandOutputLen = 0
	r.pendingCommandOutput = nil
	r.mu.Unlock()
	diagnostics.LogWorkspaceTrace(
		r.workspaceID,
		"runtime command output delta flushed",
		"chunkCount",
		len(chunks),
	)

	now := time.Now().UTC()
	for _, chunk := range chunks {
		for _, outputChunk := range splitCommandOutputDelta(chunk.delta, commandOutputMaxChunkBytes) {
			r.manager.publish(store.EventEnvelope{
				WorkspaceID: r.workspaceID,
				Method:      "command/exec/outputDelta",
				Payload:     buildCommandOutputDeltaPayload(chunk.processID, chunk.stream, outputChunk),
				TS:          now,
			})
		}
	}
}

func buildCommandOutputDeltaPayload(processID string, stream string, delta []byte) map[string]any {
	payload := map[string]any{
		"processId": processID,
		"stream":    stream,
	}

	if utf8.Valid(delta) {
		payload["deltaText"] = string(delta)
		return payload
	}

	payload["deltaBase64"] = base64.StdEncoding.EncodeToString(delta)
	return payload
}

func splitCommandOutputDelta(delta []byte, maxChunkBytes int) [][]byte {
	if len(delta) == 0 {
		return nil
	}
	if maxChunkBytes <= 0 || len(delta) <= maxChunkBytes {
		return [][]byte{delta}
	}

	chunks := make([][]byte, 0, (len(delta)+maxChunkBytes-1)/maxChunkBytes)
	for len(delta) > 0 {
		if len(delta) <= maxChunkBytes {
			chunks = append(chunks, delta)
			break
		}

		chunkEnd := maxChunkBytes
		for chunkEnd > 0 && !utf8.Valid(delta[:chunkEnd]) {
			chunkEnd -= 1
		}
		if chunkEnd == 0 {
			chunkEnd = maxChunkBytes
		}

		chunks = append(chunks, delta[:chunkEnd])
		delta = delta[chunkEnd:]
	}

	return chunks
}

func (m *Manager) expireRequestsForWorkspace(workspaceID string, reason string) {
	expired := m.requests.ExpireWorkspace(workspaceID)

	for _, request := range expired {
		if m.events == nil {
			continue
		}
		requestID := request.RequestID
		m.publish(store.EventEnvelope{
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

func (m *Manager) publish(event store.EventEnvelope) {
	if m.events == nil {
		return
	}
	m.events.Publish(event)
}

func (r *instance) stderrSnapshotLocked() []string {
	if r.stderrBuffer == nil {
		return nil
	}
	return r.stderrBuffer.Snapshot()
}

func (r *instance) clearRuntimeErrorStateLocked() {
	r.state.LastError = ""
	r.state.LastErrorCategory = ""
	r.state.LastErrorRecoveryAction = ""
	r.state.LastErrorRetryable = false
	r.state.LastErrorRequiresRuntimeRecycle = false
	r.state.RecentStderr = nil
}

func (r *instance) applyRuntimeFailureLocked(err error) {
	r.state.RecentStderr = r.stderrSnapshotLocked()
	r.state.LastError = summarizeRuntimeFailure(err, r.state.RecentStderr)
	classification := classifyRuntimeFailure(err, r.state.RecentStderr)
	r.state.LastErrorCategory = classification.Category
	r.state.LastErrorRecoveryAction = classification.RecoveryAction
	r.state.LastErrorRetryable = classification.Retryable
	r.state.LastErrorRequiresRuntimeRecycle = classification.RequiresRuntimeRecycle
}

type runtimeErrorClassification struct {
	Category               string
	RecoveryAction         string
	Retryable              bool
	RequiresRuntimeRecycle bool
}

func classifyRuntimeFailure(err error, stderrLines []string) runtimeErrorClassification {
	if err == nil {
		return runtimeErrorClassification{}
	}
	if errors.Is(err, context.Canceled) {
		return runtimeErrorClassification{
			Category:       "canceled",
			RecoveryAction: "none",
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return runtimeErrorClassification{
			Category:       "timeout",
			RecoveryAction: "retry",
			Retryable:      true,
		}
	}

	text := strings.ToLower(strings.TrimSpace(summarizeRuntimeFailure(err, stderrLines)))
	switch {
	case containsAnyRuntimeFailureText(text,
		"not recognized as an internal or external command",
		"executable file not found",
		"command not found",
		"no such file or directory",
		"the system cannot find the file specified",
		"cannot find the file specified",
		"failed to resolve runtime command",
	):
		return runtimeErrorClassification{
			Category:       "configuration",
			RecoveryAction: "fix-launch-config",
		}
	case containsAnyRuntimeFailureText(text,
		"read app-server stdout",
		"read app-server stderr",
		"broken pipe",
		"connection reset",
		"app-server bridge closed",
	):
		return runtimeErrorClassification{
			Category:               "transport",
			RecoveryAction:         "retry-after-restart",
			Retryable:              true,
			RequiresRuntimeRecycle: true,
		}
	case isRuntimeExitError(err),
		containsAnyRuntimeFailureText(text,
			"exit status",
			"runtime exited unexpectedly",
			"process exited",
		):
		return runtimeErrorClassification{
			Category:               "process_exit",
			RecoveryAction:         "retry-after-restart",
			Retryable:              true,
			RequiresRuntimeRecycle: true,
		}
	default:
		return runtimeErrorClassification{
			Category:               "runtime",
			RecoveryAction:         "retry-after-restart",
			Retryable:              true,
			RequiresRuntimeRecycle: true,
		}
	}
}

func containsAnyRuntimeFailureText(text string, patterns ...string) bool {
	for _, pattern := range patterns {
		pattern = strings.ToLower(strings.TrimSpace(pattern))
		if pattern == "" {
			continue
		}
		if strings.Contains(text, pattern) {
			return true
		}
	}
	return false
}

func isRuntimeExitError(err error) bool {
	type exitCodeProvider interface {
		ExitCode() int
	}

	var exitErr exitCodeProvider
	return errors.As(err, &exitErr)
}

func summarizeRuntimeFailure(err error, stderrLines []string) string {
	parts := make([]string, 0, 2)
	if err != nil {
		errText := strings.TrimSpace(err.Error())
		if errText != "" {
			parts = append(parts, errText)
		}
	}

	stderrSummary := summarizeRuntimeStderr(stderrLines)
	if stderrSummary != "" {
		if len(parts) == 0 {
			parts = append(parts, stderrSummary)
		} else if parts[0] != stderrSummary {
			parts = append(parts, "stderr: "+stderrSummary)
		}
	}

	return strings.Join(parts, " | ")
}

func cloneRuntimeState(state State) State {
	if len(state.RecentStderr) > 0 {
		state.RecentStderr = append([]string(nil), state.RecentStderr...)
	}
	return state
}
