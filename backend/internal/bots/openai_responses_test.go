package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"codex-server/backend/internal/store"
)

func TestOpenAIResponsesBackendUsesPreviousResponseIDAndParsesText(t *testing.T) {
	t.Parallel()

	var requestPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Fatalf("expected bearer token header, got %q", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&requestPayload); err != nil {
			t.Fatalf("decode request payload error = %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "resp_123",
			"output": []map[string]any{
				{
					"type": "message",
					"role": "assistant",
					"content": []map[string]any{
						{"type": "output_text", "text": "hello from responses"},
					},
				},
			},
		})
	}))
	defer server.Close()

	backend := newOpenAIResponsesBackend(server.Client())
	result, err := backend.ProcessMessage(context.Background(), store.BotConnection{
		AIConfig: map[string]string{
			"model":        "gpt-5.4-mini",
			"instructions": "be concise",
			"store":        "true",
		},
		Secrets: map[string]string{
			"openai_api_key": "sk-test",
			"openai_base_url": server.URL,
		},
	}, store.BotConversation{
		BackendState: map[string]string{
			"previous_response_id": "resp_prev",
		},
	}, InboundMessage{
		Text: "hi",
	})
	if err != nil {
		t.Fatalf("ProcessMessage() error = %v", err)
	}

	if got := requestPayload["previous_response_id"]; got != "resp_prev" {
		t.Fatalf("expected previous_response_id resp_prev, got %#v", got)
	}
	if len(result.Messages) != 1 || result.Messages[0].Text != "hello from responses" {
		t.Fatalf("expected parsed assistant text, got %#v", result.Messages)
	}
	if got := result.BackendState["previous_response_id"]; got != "resp_123" {
		t.Fatalf("expected returned response id resp_123, got %q", got)
	}
}
