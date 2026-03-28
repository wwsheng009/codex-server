package bots

import (
	"context"
	"testing"
)

func TestWithBotDebugTraceStoresTraceMetadata(t *testing.T) {
	t.Parallel()

	ctx := withBotDebugTrace(context.Background(), "bot_123", "bid_456")
	trace, ok := botDebugTraceFromContext(ctx)
	if !ok {
		t.Fatal("expected trace metadata in context")
	}
	if trace.TraceID != "bid_456" {
		t.Fatalf("expected trace id bid_456, got %#v", trace)
	}
	if trace.DeliveryID != "bid_456" {
		t.Fatalf("expected delivery id bid_456, got %#v", trace)
	}
}

func TestWithBotDebugTraceFallsBackToConnectionID(t *testing.T) {
	t.Parallel()

	ctx := withBotDebugTrace(context.Background(), "bot_123", "")
	trace, ok := botDebugTraceFromContext(ctx)
	if !ok {
		t.Fatal("expected trace metadata in context")
	}
	if trace.TraceID != "bot_123" {
		t.Fatalf("expected trace id bot_123, got %#v", trace)
	}
	if trace.DeliveryID != "" {
		t.Fatalf("expected empty delivery id, got %#v", trace)
	}
}
