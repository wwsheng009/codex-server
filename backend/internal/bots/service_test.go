package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestServiceCreatesConnectionAndSanitizesSecrets(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		Name:      "Support Bot",
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	if connection.Provider != "fakechat" {
		t.Fatalf("expected provider fakechat, got %q", connection.Provider)
	}
	if len(connection.SecretKeys) != 2 {
		t.Fatalf("expected bot_token and webhook_secret secret keys, got %#v", connection.SecretKeys)
	}
	if _, ok := dataStore.GetBotConnection(workspace.ID, connection.ID); !ok {
		t.Fatal("expected bot connection to be persisted")
	}
}

func TestHandleWebhookCreatesConversationAndSendsReply(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-1",
		"messageId":"msg-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello"
	}`))
	request.Header.Set("X-Test-Secret", "fake-secret")

	result, err := service.HandleWebhook(request, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook() error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
	}

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected sent connection id %q, got %q", connection.ID, sent.ConnectionID)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello" {
			t.Fatalf("expected ai reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for provider SendMessages call")
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].ThreadID != "thr_chat-1" {
		t.Fatalf("expected conversation thread id thr_chat-1, got %q", conversations[0].ThreadID)
	}
	if conversations[0].LastOutboundText != "reply: hello" {
		t.Fatalf("expected last outbound text to be persisted, got %q", conversations[0].LastOutboundText)
	}

	duplicateRequest := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-1",
		"messageId":"msg-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello"
	}`))
	duplicateRequest.Header.Set("X-Test-Secret", "fake-secret")

	if _, err := service.HandleWebhook(duplicateRequest, connection.ID); err != nil {
		t.Fatalf("HandleWebhook(duplicate) error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected duplicate inbound message to be ignored, got %#v", sent)
	case <-time.After(300 * time.Millisecond):
	}
}

type fakeProvider struct {
	mu     sync.Mutex
	sentCh chan fakeSentPayload
}

type fakeSentPayload struct {
	ConnectionID string
	Messages     []OutboundMessage
}

func newFakeProvider() *fakeProvider {
	return &fakeProvider{
		sentCh: make(chan fakeSentPayload, 8),
	}
}

func (p *fakeProvider) Name() string {
	return "fakechat"
}

func (p *fakeProvider) Activate(_ context.Context, connection store.BotConnection, publicBaseURL string) (ActivationResult, error) {
	return ActivationResult{
		Settings: map[string]string{
			"webhook_url": strings.TrimRight(publicBaseURL, "/") + "/hooks/bots/" + connection.ID,
		},
		Secrets: map[string]string{
			"webhook_secret": "fake-secret",
		},
	}, nil
}

func (p *fakeProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakeProvider) ParseWebhook(r *http.Request, _ store.BotConnection) ([]InboundMessage, error) {
	if strings.TrimSpace(r.Header.Get("X-Test-Secret")) != "fake-secret" {
		return nil, ErrWebhookUnauthorized
	}

	defer r.Body.Close()

	var payload InboundMessage
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		return nil, err
	}

	return []InboundMessage{payload}, nil
}

func (p *fakeProvider) SendMessages(_ context.Context, connection store.BotConnection, _ store.BotConversation, messages []OutboundMessage) error {
	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Messages:     append([]OutboundMessage(nil), messages...),
	}
	return nil
}

type fakeAIBackend struct{}

func (fakeAIBackend) Name() string {
	return "fake_ai"
}

func (fakeAIBackend) ProcessMessage(_ context.Context, _ store.BotConnection, _ store.BotConversation, inbound InboundMessage) (AIResult, error) {
	return AIResult{
		ThreadID: "thr_" + inbound.ConversationID,
		Messages: []OutboundMessage{
			{Text: "reply: " + inbound.Text},
		},
	}, nil
}
