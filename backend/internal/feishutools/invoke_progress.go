package feishutools

import (
	"context"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/store"
)

const feishuInvokeProgressEventMethod = "feishuTools/invoke/progress"

type invokeEventScopeContextKey struct{}

type invokeEventScope struct {
	ThreadID string
	TurnID   string
}

type InvokeProgressEvent struct {
	Sequence int            `json:"sequence"`
	State    string         `json:"state"`
	Message  string         `json:"message,omitempty"`
	TS       string         `json:"ts"`
	Detail   map[string]any `json:"detail,omitempty"`
}

type invokeEventPublisher interface {
	Publish(store.EventEnvelope)
}

type invokeProgressContextKey struct{}

type invokeTracker struct {
	publisher    invokeEventPublisher
	workspaceID  string
	invocationID string
	toolName     string
	action       string
	threadID     string
	turnID       string
	startedAt    time.Time

	mu     sync.Mutex
	events []InvokeProgressEvent
}

func contextWithInvokeTracker(ctx context.Context, tracker *invokeTracker) context.Context {
	if ctx == nil || tracker == nil {
		return ctx
	}
	return context.WithValue(ctx, invokeProgressContextKey{}, tracker)
}

func invokeTrackerFromContext(ctx context.Context) *invokeTracker {
	if ctx == nil {
		return nil
	}
	tracker, _ := ctx.Value(invokeProgressContextKey{}).(*invokeTracker)
	return tracker
}

// ContextWithInvokeEventScope carries thread-scoped metadata so Feishu tool
// progress events can be associated with the active turn when the caller has
// that context available.
func ContextWithInvokeEventScope(ctx context.Context, threadID string, turnID string) context.Context {
	if ctx == nil {
		return nil
	}
	scope := invokeEventScope{
		ThreadID: strings.TrimSpace(threadID),
		TurnID:   strings.TrimSpace(turnID),
	}
	if scope.ThreadID == "" && scope.TurnID == "" {
		return ctx
	}
	return context.WithValue(ctx, invokeEventScopeContextKey{}, scope)
}

func invokeEventScopeFromContext(ctx context.Context) invokeEventScope {
	if ctx == nil {
		return invokeEventScope{}
	}
	scope, _ := ctx.Value(invokeEventScopeContextKey{}).(invokeEventScope)
	scope.ThreadID = strings.TrimSpace(scope.ThreadID)
	scope.TurnID = strings.TrimSpace(scope.TurnID)
	return scope
}

func emitInvokeProgress(ctx context.Context, state string, message string, detail map[string]any) {
	tracker := invokeTrackerFromContext(ctx)
	if tracker == nil {
		return
	}
	tracker.Record(state, message, detail)
}

func (s *Service) newInvokeTracker(ctx context.Context, workspaceID string, invocationID string, toolName string, action string, startedAt time.Time) *invokeTracker {
	if s == nil {
		return nil
	}
	scope := invokeEventScopeFromContext(ctx)
	return &invokeTracker{
		publisher:    s.events,
		workspaceID:  strings.TrimSpace(workspaceID),
		invocationID: strings.TrimSpace(invocationID),
		toolName:     strings.TrimSpace(toolName),
		action:       strings.TrimSpace(action),
		threadID:     scope.ThreadID,
		turnID:       scope.TurnID,
		startedAt:    startedAt.UTC(),
		events:       make([]InvokeProgressEvent, 0, 8),
	}
}

func (t *invokeTracker) Record(state string, message string, detail map[string]any) {
	if t == nil {
		return
	}

	trimmedState := strings.TrimSpace(state)
	if trimmedState == "" {
		trimmedState = "running"
	}
	trimmedMessage := strings.TrimSpace(message)

	event := InvokeProgressEvent{
		State:   trimmedState,
		Message: trimmedMessage,
		TS:      time.Now().UTC().Format(time.RFC3339),
		Detail:  cloneInvokeProgressDetail(detail),
	}

	t.mu.Lock()
	event.Sequence = len(t.events) + 1
	t.events = append(t.events, event)
	t.mu.Unlock()

	if t.publisher == nil || t.workspaceID == "" {
		return
	}

	payload := map[string]any{
		"invocationId": t.invocationID,
		"toolName":     t.toolName,
		"action":       t.action,
		"sequence":     event.Sequence,
		"state":        event.State,
		"message":      event.Message,
		"startedAt":    t.startedAt.Format(time.RFC3339),
		"ts":           event.TS,
		"final":        event.State == "success" || event.State == "error",
	}
	if len(event.Detail) > 0 {
		payload["detail"] = cloneInvokeProgressDetail(event.Detail)
	}
	if t.threadID != "" {
		payload["threadId"] = t.threadID
	}
	if t.turnID != "" {
		payload["turnId"] = t.turnID
	}

	t.publisher.Publish(store.EventEnvelope{
		WorkspaceID: t.workspaceID,
		ThreadID:    t.threadID,
		TurnID:      t.turnID,
		Method:      feishuInvokeProgressEventMethod,
		Payload:     payload,
		TS:          time.Now().UTC(),
	})
}

func (t *invokeTracker) Snapshot() []InvokeProgressEvent {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	if len(t.events) == 0 {
		return nil
	}
	cloned := make([]InvokeProgressEvent, 0, len(t.events))
	for _, event := range t.events {
		cloned = append(cloned, InvokeProgressEvent{
			Sequence: event.Sequence,
			State:    event.State,
			Message:  event.Message,
			TS:       event.TS,
			Detail:   cloneInvokeProgressDetail(event.Detail),
		})
	}
	return cloned
}

func cloneInvokeProgressDetail(detail map[string]any) map[string]any {
	if len(detail) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(detail))
	for key, value := range detail {
		cloned[key] = value
	}
	return cloned
}

func defaultInvokeProgressState(tool string, actionKey string) string {
	definition, ok := toolDefinitions[strings.TrimSpace(tool)]
	if ok && strings.EqualFold(strings.TrimSpace(definition.RiskLevel), "read") {
		return "running"
	}

	normalized := strings.ToLower(strings.TrimSpace(actionKey))
	switch {
	case strings.HasSuffix(normalized, ".list"),
		strings.HasSuffix(normalized, ".get"),
		strings.HasSuffix(normalized, ".search"),
		strings.HasSuffix(normalized, ".find"),
		strings.HasSuffix(normalized, ".read"),
		strings.HasSuffix(normalized, ".info"),
		strings.HasSuffix(normalized, ".primary"),
		strings.HasSuffix(normalized, ".instances"),
		strings.HasSuffix(normalized, ".instance_view"):
		return "running"
	default:
		return "writing"
	}
}

func buildInvokeCompletionDetail(result map[string]any, durationMs int64) map[string]any {
	detail := map[string]any{
		"durationMs": durationMs,
	}
	if len(result) == 0 {
		return detail
	}
	if principal := strings.TrimSpace(stringValue(result["principal"])); principal != "" {
		detail["principal"] = principal
	}
	if token := strings.TrimSpace(stringValue(result["spreadsheetToken"])); token != "" {
		detail["spreadsheetToken"] = token
	}
	if ticket := strings.TrimSpace(stringValue(result["ticket"])); ticket != "" {
		detail["ticket"] = ticket
	}
	if tableRange := strings.TrimSpace(stringValue(result["tableRange"])); tableRange != "" {
		detail["tableRange"] = tableRange
	}
	if updatedCells, ok := numberValue(result["updatedCells"]); ok {
		detail["updatedCells"] = updatedCells
	}
	if updatedRows, ok := numberValue(result["updatedRows"]); ok {
		detail["updatedRows"] = updatedRows
	}
	if updates, ok := result["updates"].(map[string]any); ok {
		if updatedCells, ok := numberValue(updates["updatedCells"]); ok {
			detail["updatedCells"] = updatedCells
		}
		if updatedRows, ok := numberValue(updates["updatedRows"]); ok {
			detail["updatedRows"] = updatedRows
		}
	}
	return detail
}

func numberValue(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int32:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	default:
		return 0, false
	}
}
