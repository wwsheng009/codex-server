package bots

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"codex-server/backend/internal/store"
)

const (
	botRuntimeModeSetting = "runtime_mode"
	botRuntimeModeNormal  = "normal"
	botRuntimeModeDebug   = "debug"
	debugTextPreviewLimit = 240
)

type botDebugContextKey string

const botDebugTraceContextKey botDebugContextKey = "bot_debug_trace"

type botDebugTrace struct {
	TraceID    string
	DeliveryID string
}

func normalizeBotRuntimeMode(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", botRuntimeModeNormal:
		return botRuntimeModeNormal, nil
	case botRuntimeModeDebug:
		return botRuntimeModeDebug, nil
	default:
		return "", fmt.Errorf("%w: bot runtime mode must be normal or debug", ErrInvalidInput)
	}
}

func connectionRuntimeMode(connection store.BotConnection) string {
	mode, err := normalizeBotRuntimeMode(connection.Settings[botRuntimeModeSetting])
	if err != nil {
		return botRuntimeModeNormal
	}
	return mode
}

func isDebugBotConnection(connection store.BotConnection) bool {
	return connectionRuntimeMode(connection) == botRuntimeModeDebug
}

func normalizeBotConnectionSettings(settings map[string]string) (map[string]string, error) {
	if len(settings) == 0 {
		return nil, nil
	}

	normalized := cloneStringMapLocal(settings)
	mode, err := normalizeBotRuntimeMode(normalized[botRuntimeModeSetting])
	if err != nil {
		return nil, err
	}
	normalized[botRuntimeModeSetting] = mode
	return normalized, nil
}

func withBotDebugTrace(ctx context.Context, connectionID string, deliveryID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}

	traceID := strings.TrimSpace(deliveryID)
	if traceID == "" {
		traceID = strings.TrimSpace(connectionID)
	}
	if traceID == "" {
		return ctx
	}

	return context.WithValue(ctx, botDebugTraceContextKey, botDebugTrace{
		TraceID:    traceID,
		DeliveryID: strings.TrimSpace(deliveryID),
	})
}

func botDebugTraceFromContext(ctx context.Context) (botDebugTrace, bool) {
	if ctx == nil {
		return botDebugTrace{}, false
	}

	trace, ok := ctx.Value(botDebugTraceContextKey).(botDebugTrace)
	if !ok || strings.TrimSpace(trace.TraceID) == "" {
		return botDebugTrace{}, false
	}
	return trace, true
}

func logBotDebug(ctx context.Context, connection store.BotConnection, message string, attrs ...slog.Attr) {
	if !isDebugBotConnection(connection) {
		return
	}

	baseAttrs := []slog.Attr{
		slog.String("workspaceId", connection.WorkspaceID),
		slog.String("connectionId", connection.ID),
		slog.String("provider", connection.Provider),
		slog.String("runtimeMode", connectionRuntimeMode(connection)),
	}
	if trace, ok := botDebugTraceFromContext(ctx); ok {
		baseAttrs = append(baseAttrs, slog.String("traceId", trace.TraceID))
		if trace.DeliveryID != "" {
			baseAttrs = append(baseAttrs, slog.String("deliveryId", trace.DeliveryID))
		}
	}
	baseAttrs = append(baseAttrs, attrs...)
	slog.Default().LogAttrs(nil, slog.LevelInfo, "bot debug: "+message, baseAttrs...)
}

func debugTextPreview(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	runes := []rune(value)
	if len(runes) <= debugTextPreviewLimit {
		return value
	}
	return string(runes[:debugTextPreviewLimit]) + fmt.Sprintf(" ... [truncated, %d more chars]", len(runes)-debugTextPreviewLimit)
}

func debugOutboundMessages(messages []OutboundMessage) []map[string]any {
	if len(messages) == 0 {
		return nil
	}

	items := make([]map[string]any, 0, len(messages))
	for index, message := range messages {
		entry := map[string]any{
			"index":   index,
			"length":  len([]rune(message.Text)),
			"preview": debugTextPreview(message.Text),
		}
		if len(message.Media) > 0 {
			media := make([]map[string]any, 0, len(message.Media))
			for _, item := range message.Media {
				media = append(media, map[string]any{
					"kind":        strings.TrimSpace(item.Kind),
					"path":        strings.TrimSpace(item.Path),
					"url":         strings.TrimSpace(item.URL),
					"fileName":    strings.TrimSpace(item.FileName),
					"contentType": strings.TrimSpace(item.ContentType),
				})
			}
			entry["media"] = media
		}
		items = append(items, entry)
	}
	return items
}

func debugEventAttrs(event store.EventEnvelope) []slog.Attr {
	attrs := []slog.Attr{
		slog.String("method", strings.TrimSpace(event.Method)),
		slog.String("threadId", strings.TrimSpace(event.ThreadID)),
		slog.String("turnId", strings.TrimSpace(event.TurnID)),
	}
	if event.ServerRequestID != nil {
		attrs = append(attrs, slog.String("serverRequestId", strings.TrimSpace(*event.ServerRequestID)))
	}
	return attrs
}
