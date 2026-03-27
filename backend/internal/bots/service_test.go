package bots

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/approvals"
	appRuntime "codex-server/backend/internal/runtime"
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

func TestHandleWebhookSeparatesTelegramTopicsIntoDistinctConversations(t *testing.T) {
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

	requests := []string{
		`{
			"conversationId":"chat-group:thread:11",
			"externalChatId":"chat-group",
			"externalThreadId":"11",
			"messageId":"msg-topic-1",
			"userId":"user-1",
			"username":"alice",
			"title":"Ops Group",
			"text":"hello topic 11"
		}`,
		`{
			"conversationId":"chat-group:thread:22",
			"externalChatId":"chat-group",
			"externalThreadId":"22",
			"messageId":"msg-topic-2",
			"userId":"user-1",
			"username":"alice",
			"title":"Ops Group",
			"text":"hello topic 22"
		}`,
	}

	for _, payload := range requests {
		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(payload))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		if result.Accepted != 1 {
			t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
		}
	}

	for range requests {
		select {
		case <-provider.sentCh:
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for provider SendMessages call")
		}
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 2 {
		t.Fatalf("expected 2 bot conversations, got %#v", conversations)
	}

	threadIDs := make(map[string]string, 2)
	for _, conversation := range conversations {
		if conversation.ExternalChatID != "chat-group" {
			t.Fatalf("expected shared external chat id chat-group, got %#v", conversation)
		}
		threadIDs[conversation.ExternalThreadID] = conversation.ThreadID
	}
	if threadIDs["11"] != "thr_chat-group:thread:11" {
		t.Fatalf("expected topic 11 thread mapping, got %#v", threadIDs)
	}
	if threadIDs["22"] != "thr_chat-group:thread:22" {
		t.Fatalf("expected topic 22 thread mapping, got %#v", threadIDs)
	}
}

func TestServiceRunsPollingProvidersWithoutPublicBaseURL(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakePollingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{fakeAIBackend{}},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "pollchat",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			"delivery_mode": "polling",
		},
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected sent connection id %q, got %q", connection.ID, sent.ConnectionID)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello from polling" {
			t.Fatalf("expected polling ai reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for polling provider SendMessages call")
	}

	storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected polling connection to be persisted")
	}
	if storedConnection.Settings["poll_cursor"] != "1" {
		t.Fatalf("expected poll cursor to be persisted, got %#v", storedConnection.Settings)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastOutboundText != "reply: hello from polling" {
		t.Fatalf("expected polling reply to be persisted, got %q", conversations[0].LastOutboundText)
	}
}

func TestServiceStreamsReplyWhenProviderAndBackendSupportStreaming(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeStreamingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeStreamingAIBackend{}},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "streamchat",
		AIBackend: "stream_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-stream-1",
		"messageId":"msg-stream-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello streaming"
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
	case <-provider.completedCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for streaming completion")
	}

	provider.mu.Lock()
	updates := append([][]OutboundMessage(nil), provider.updates...)
	completedMessages := append([]OutboundMessage(nil), provider.completedMessages...)
	sendMessagesCalls := provider.sendMessagesCalls
	provider.mu.Unlock()

	if sendMessagesCalls != 0 {
		t.Fatalf("expected streaming provider to avoid SendMessages fallback, got %d calls", sendMessagesCalls)
	}
	if len(updates) != 3 {
		t.Fatalf("expected 2 streaming updates, got %#v", updates)
	}
	if len(updates[0]) != 1 || updates[0][0].Text != defaultStreamingPendingText {
		t.Fatalf("unexpected first streaming update %#v", updates[0])
	}
	if len(updates[1]) != 1 || updates[1][0].Text != "thinking..." {
		t.Fatalf("unexpected streaming updates %#v", updates)
	}
	if len(updates[2]) != 1 || updates[2][0].Text != "reply: hello streaming" {
		t.Fatalf("unexpected streaming updates %#v", updates)
	}
	if len(completedMessages) != 1 || completedMessages[0].Text != "final: hello streaming" {
		t.Fatalf("unexpected completed messages %#v", completedMessages)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].ThreadID != "thr_chat-stream-1" {
		t.Fatalf("expected conversation thread id thr_chat-stream-1, got %q", conversations[0].ThreadID)
	}
	if conversations[0].LastOutboundText != "final: hello streaming" {
		t.Fatalf("expected last outbound text to be persisted, got %q", conversations[0].LastOutboundText)
	}
}

func TestServiceSendsFailureReplyWhenAIBackendFails(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{failingAIBackend{}},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: "failing_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-fail-1",
		"messageId":"msg-fail-1",
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
		if len(sent.Messages) != 1 || sent.Messages[0].Text != failureReplyText(appRuntime.ErrRuntimeNotConfigured) {
			t.Fatalf("expected failure reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for provider SendMessages call")
	}

	storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected bot connection to be persisted")
	}
	if !strings.Contains(storedConnection.LastError, appRuntime.ErrRuntimeNotConfigured.Error()) {
		t.Fatalf("expected last error to mention runtime configuration, got %q", storedConnection.LastError)
	}
}

func TestServiceRetriesFailedInboundMessageWhenWebhookRedeliversSameMessage(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	provider.pushSendError(errors.New("transient telegram outage"))
	provider.pushSendError(errors.New("transient telegram outage"))

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

	requestBody := `{
		"conversationId":"chat-retry-1",
		"messageId":"msg-retry-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello"
	}`

	firstRequest := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(requestBody))
	firstRequest.Header.Set("X-Test-Secret", "fake-secret")

	result, err := service.HandleWebhook(firstRequest, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook(first) error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected first webhook to accept 1 message, got %d", result.Accepted)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
		if ok && strings.Contains(storedConnection.LastError, "transient telegram outage") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	secondRequest := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(requestBody))
	secondRequest.Header.Set("X-Test-Secret", "fake-secret")

	result, err = service.HandleWebhook(secondRequest, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook(second) error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected second webhook to re-accept the failed message, got %d", result.Accepted)
	}

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello" {
			t.Fatalf("expected retried ai reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for provider SendMessages call after retry")
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastInboundMessageID != "msg-retry-1" {
		t.Fatalf("expected last inbound message id to be persisted after successful retry, got %q", conversations[0].LastInboundMessageID)
	}
}

func TestServiceRecoversPendingInboundDeliveriesOnStart(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

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

	delivery, shouldEnqueue, err := dataStore.UpsertBotInboundDelivery(store.BotInboundDelivery{
		WorkspaceID:    workspace.ID,
		ConnectionID:   connection.ID,
		Provider:       connection.Provider,
		ExternalChatID: "chat-recover-1",
		MessageID:      "msg-recover-1",
		UserID:         "user-1",
		Username:       "alice",
		Title:          "Alice",
		Text:           "hello after restart",
	})
	if err != nil {
		t.Fatalf("UpsertBotInboundDelivery() error = %v", err)
	}
	if !shouldEnqueue {
		t.Fatal("expected pending inbound delivery to be queued for recovery")
	}
	if _, claimed, err := dataStore.ClaimBotInboundDelivery(workspace.ID, delivery.ID); err != nil || !claimed {
		t.Fatalf("ClaimBotInboundDelivery() = %v, claimed=%v", err, claimed)
	}

	service.Start(context.Background())

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello after restart" {
			t.Fatalf("expected recovered ai reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for recovered provider SendMessages call")
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 recovered bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastInboundMessageID != "msg-recover-1" {
		t.Fatalf("expected recovered inbound message id to be persisted, got %q", conversations[0].LastInboundMessageID)
	}
}

func TestServiceReclaimsIdleConversationWorkers(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})
	service.workerIdleTimeout = 40 * time.Millisecond
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

	sendWebhook := func(messageID string, text string) {
		t.Helper()

		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
			"conversationId":"chat-idle-1",
			"messageId":"`+messageID+`",
			"userId":"user-1",
			"username":"alice",
			"title":"Alice",
			"text":"`+text+`"
		}`))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		if result.Accepted != 1 {
			t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
		}
	}

	sendWebhook("msg-idle-1", "hello idle worker")

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello idle worker" {
			t.Fatalf("expected first ai reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for first provider SendMessages call")
	}

	if err := waitForWorkerCount(service, 0, time.Second); err != nil {
		t.Fatalf("expected idle worker to be reclaimed: %v", err)
	}

	sendWebhook("msg-idle-2", "hello after reclaim")

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello after reclaim" {
			t.Fatalf("expected recreated worker ai reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for second provider SendMessages call")
	}

	if err := waitForWorkerCount(service, 0, time.Second); err != nil {
		t.Fatalf("expected recreated idle worker to be reclaimed again: %v", err)
	}
}

func TestHandleWebhookApprovalCommandsBypassBlockedConversationWorker(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_123",
			WorkspaceID: workspace.ID,
			ThreadID:    "thr_chat-1",
			Kind:        "item/commandExecution/requestApproval",
			Summary:     "go test ./...",
			Status:      "pending",
			Actions:     []string{"accept", "decline", "cancel"},
			RequestedAt: time.Now().UTC(),
		},
	})
	blockingBackend := newBlockingAIBackend()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Approvals:     approvalService,
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{blockingBackend},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: "blocking_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	sendWebhook := func(text string, messageID string) {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
			"conversationId":"chat-1",
			"messageId":"`+messageID+`",
			"userId":"user-1",
			"username":"alice",
			"title":"Alice",
			"text":"`+text+`"
		}`))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		if result.Accepted != 1 {
			t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
		}
	}

	sendWebhook("hello", "msg-block-1")

	select {
	case <-blockingBackend.started:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for blocking ai backend to start")
	}

	sendWebhook("/approvals", "msg-block-2")

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 {
			t.Fatalf("expected one approval command response, got %#v", sent.Messages)
		}
		if !strings.Contains(sent.Messages[0].Text, "Pending approvals:") ||
			!strings.Contains(sent.Messages[0].Text, "req_123") ||
			!strings.Contains(sent.Messages[0].Text, "/approve req_123") ||
			!strings.Contains(sent.Messages[0].Text, "/decline req_123") ||
			!strings.Contains(sent.Messages[0].Text, "/cancel req_123") {
			t.Fatalf("expected pending approvals response, got %#v", sent.Messages[0])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for approval command response")
	}

	close(blockingBackend.release)

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello" {
			t.Fatalf("expected blocked ai reply after release, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for released ai reply")
	}
}

func TestHandleWebhookApproveCommandRespondsToPendingApproval(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_approve_1",
			WorkspaceID: workspace.ID,
			ThreadID:    "thr_chat-approve",
			Kind:        "item/commandExecution/requestApproval",
			Summary:     "go test ./...",
			Status:      "pending",
			Actions:     []string{"accept", "decline", "cancel"},
			RequestedAt: time.Now().UTC(),
		},
	})

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Approvals:     approvalService,
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
		"conversationId":"chat-approve",
		"messageId":"msg-approve-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"/approve req_approve_1"
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
		if len(sent.Messages) != 1 ||
			!strings.Contains(sent.Messages[0].Text, "req_approve_1") ||
			!strings.Contains(sent.Messages[0].Text, "was approved") {
			t.Fatalf("expected approval confirmation message, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for approval confirmation message")
	}

	call := approvalService.lastCall()
	if call.requestID != "req_approve_1" {
		t.Fatalf("expected approval request id req_approve_1, got %#v", call)
	}
	if call.input.Action != "accept" {
		t.Fatalf("expected approval action accept, got %#v", call.input)
	}
}

func TestHandleWebhookAnswerCommandBuildsQuestionAnswers(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_answer_1",
			WorkspaceID: workspace.ID,
			ThreadID:    "thr_chat-answer",
			Kind:        "item/tool/requestUserInput",
			Summary:     "1 question awaiting user input",
			Status:      "pending",
			Actions:     []string{"accept", "decline", "cancel"},
			Details: map[string]any{
				"questions": []any{
					map[string]any{"id": "environment", "question": "Which environment?"},
				},
			},
			RequestedAt: time.Now().UTC(),
		},
	})

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Approvals:     approvalService,
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
		"conversationId":"chat-answer",
		"messageId":"msg-answer-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"/answer req_answer_1 production"
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
		if len(sent.Messages) != 1 ||
			!strings.Contains(sent.Messages[0].Text, "req_answer_1") ||
			!strings.Contains(sent.Messages[0].Text, "was approved") {
			t.Fatalf("expected answer confirmation message, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for answer confirmation message")
	}

	call := approvalService.lastCall()
	if call.requestID != "req_answer_1" {
		t.Fatalf("expected answer request id req_answer_1, got %#v", call)
	}
	if call.input.Action != "accept" {
		t.Fatalf("expected answer action accept, got %#v", call.input)
	}
	if got := call.input.Answers["environment"]; len(got) != 1 || got[0] != "production" {
		t.Fatalf("expected single-question answer to map to environment, got %#v", call.input.Answers)
	}
}

func TestRenderPendingApprovalsForBotAuthRefreshUsesWorkspaceOnlyHint(t *testing.T) {
	t.Parallel()

	text := renderPendingApprovalsForBot([]store.PendingApproval{
		{
			ID:      "req_auth_1",
			Kind:    "account/chatgptAuthTokens/refresh",
			Summary: "Refresh ChatGPT auth tokens",
		},
	}, "")

	if !strings.Contains(text, "req_auth_1") {
		t.Fatalf("expected request id in pending approvals text, got %q", text)
	}
	if !strings.Contains(text, "workspace UI instead") {
		t.Fatalf("expected workspace-only hint, got %q", text)
	}
	if strings.Contains(text, "/approve req_auth_1") {
		t.Fatalf("did not expect Telegram approval command for auth refresh, got %q", text)
	}
}

type fakeProvider struct {
	mu     sync.Mutex
	sentCh chan fakeSentPayload
	errors []error
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
	p.mu.Lock()
	if len(p.errors) > 0 {
		err := p.errors[0]
		p.errors = append([]error(nil), p.errors[1:]...)
		p.mu.Unlock()
		return err
	}
	p.mu.Unlock()

	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Messages:     append([]OutboundMessage(nil), messages...),
	}
	return nil
}

func (p *fakeProvider) pushSendError(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.errors = append(p.errors, err)
}

func waitForWorkerCount(service *Service, expected int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		service.mu.Lock()
		count := len(service.workers)
		service.mu.Unlock()

		if count == expected {
			return nil
		}
		if time.Now().After(deadline) {
			return errors.New("timed out waiting for worker count")
		}
		time.Sleep(10 * time.Millisecond)
	}
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

type failingAIBackend struct{}

func (failingAIBackend) Name() string {
	return "failing_ai"
}

func (failingAIBackend) ProcessMessage(context.Context, store.BotConnection, store.BotConversation, InboundMessage) (AIResult, error) {
	return AIResult{}, appRuntime.ErrRuntimeNotConfigured
}

type blockingAIBackend struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func newBlockingAIBackend() *blockingAIBackend {
	return &blockingAIBackend{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (*blockingAIBackend) Name() string {
	return "blocking_ai"
}

func (b *blockingAIBackend) ProcessMessage(_ context.Context, _ store.BotConnection, _ store.BotConversation, inbound InboundMessage) (AIResult, error) {
	b.once.Do(func() {
		close(b.started)
	})
	<-b.release
	return AIResult{
		ThreadID: "thr_" + inbound.ConversationID,
		Messages: []OutboundMessage{{Text: "reply: " + inbound.Text}},
	}, nil
}

type fakeApprovalService struct {
	mu    sync.Mutex
	items []store.PendingApproval
	calls []fakeApprovalCall
}

type fakeApprovalCall struct {
	requestID string
	input     approvals.ResponseInput
}

func newFakeApprovalService(items []store.PendingApproval) *fakeApprovalService {
	return &fakeApprovalService{
		items: append([]store.PendingApproval(nil), items...),
	}
}

func (s *fakeApprovalService) List(workspaceID string) []store.PendingApproval {
	s.mu.Lock()
	defer s.mu.Unlock()

	items := make([]store.PendingApproval, 0, len(s.items))
	for _, item := range s.items {
		if item.WorkspaceID == workspaceID {
			items = append(items, item)
		}
	}
	return items
}

func (s *fakeApprovalService) Respond(_ context.Context, requestID string, input approvals.ResponseInput) (store.PendingApproval, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.calls = append(s.calls, fakeApprovalCall{
		requestID: requestID,
		input:     input,
	})

	for index, item := range s.items {
		if item.ID != requestID {
			continue
		}
		s.items = append(append([]store.PendingApproval(nil), s.items[:index]...), s.items[index+1:]...)
		return item, nil
	}

	return store.PendingApproval{}, errors.New("approval not found")
}

func (s *fakeApprovalService) lastCall() fakeApprovalCall {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.calls) == 0 {
		return fakeApprovalCall{}
	}
	return s.calls[len(s.calls)-1]
}

type fakePollingProvider struct {
	mu        sync.Mutex
	delivered map[string]bool
	sentCh    chan fakeSentPayload
}

func newFakePollingProvider() *fakePollingProvider {
	return &fakePollingProvider{
		delivered: make(map[string]bool),
		sentCh:    make(chan fakeSentPayload, 8),
	}
}

func (p *fakePollingProvider) Name() string {
	return "pollchat"
}

func (p *fakePollingProvider) Activate(_ context.Context, connection store.BotConnection, _ string) (ActivationResult, error) {
	mode := strings.ToLower(strings.TrimSpace(connection.Settings["delivery_mode"]))
	if mode == "" {
		mode = "polling"
	}
	return ActivationResult{
		Settings: map[string]string{
			"delivery_mode": mode,
		},
	}, nil
}

func (p *fakePollingProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakePollingProvider) ParseWebhook(*http.Request, store.BotConnection) ([]InboundMessage, error) {
	return nil, ErrWebhookIgnored
}

func (p *fakePollingProvider) SendMessages(_ context.Context, connection store.BotConnection, _ store.BotConversation, messages []OutboundMessage) error {
	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Messages:     append([]OutboundMessage(nil), messages...),
	}
	return nil
}

func (p *fakePollingProvider) SupportsPolling(connection store.BotConnection) bool {
	return strings.EqualFold(strings.TrimSpace(connection.Settings["delivery_mode"]), "polling")
}

func (p *fakePollingProvider) RunPolling(
	ctx context.Context,
	connection store.BotConnection,
	handleMessage PollingMessageHandler,
	updateSettings PollingSettingsHandler,
) error {
	p.mu.Lock()
	delivered := p.delivered[connection.ID]
	if !delivered {
		p.delivered[connection.ID] = true
	}
	p.mu.Unlock()

	if !delivered {
		if err := handleMessage(ctx, InboundMessage{
			ConversationID: "chat-poll-1",
			MessageID:      "msg-poll-1",
			UserID:         "user-poll-1",
			Username:       "alice",
			Title:          "Alice",
			Text:           "hello from polling",
		}); err != nil {
			return err
		}
		if err := updateSettings(ctx, map[string]string{"poll_cursor": "1"}); err != nil {
			return err
		}
	}

	<-ctx.Done()
	return ctx.Err()
}

type fakeStreamingProvider struct {
	mu                sync.Mutex
	updates           [][]OutboundMessage
	completedMessages []OutboundMessage
	sendMessagesCalls int
	completedCh       chan struct{}
}

func newFakeStreamingProvider() *fakeStreamingProvider {
	return &fakeStreamingProvider{
		completedCh: make(chan struct{}, 1),
	}
}

func (p *fakeStreamingProvider) Name() string {
	return "streamchat"
}

func (p *fakeStreamingProvider) Activate(_ context.Context, connection store.BotConnection, publicBaseURL string) (ActivationResult, error) {
	return ActivationResult{
		Settings: map[string]string{
			"webhook_url": strings.TrimRight(publicBaseURL, "/") + "/hooks/bots/" + connection.ID,
		},
		Secrets: map[string]string{
			"webhook_secret": "fake-secret",
		},
	}, nil
}

func (p *fakeStreamingProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakeStreamingProvider) ParseWebhook(r *http.Request, _ store.BotConnection) ([]InboundMessage, error) {
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

func (p *fakeStreamingProvider) SendMessages(_ context.Context, _ store.BotConnection, _ store.BotConversation, _ []OutboundMessage) error {
	p.mu.Lock()
	p.sendMessagesCalls += 1
	p.mu.Unlock()
	return nil
}

func (p *fakeStreamingProvider) StartStreamingReply(
	_ context.Context,
	_ store.BotConnection,
	_ store.BotConversation,
) (StreamingReplySession, error) {
	return &fakeStreamingReplySession{provider: p}, nil
}

type fakeStreamingReplySession struct {
	provider *fakeStreamingProvider
}

func (s *fakeStreamingReplySession) Update(_ context.Context, update StreamingUpdate) error {
	s.provider.mu.Lock()
	s.provider.updates = append(s.provider.updates, normalizeStreamingMessages(update))
	s.provider.mu.Unlock()
	return nil
}

func (s *fakeStreamingReplySession) Complete(_ context.Context, messages []OutboundMessage) error {
	s.provider.mu.Lock()
	s.provider.completedMessages = append([]OutboundMessage(nil), messages...)
	s.provider.mu.Unlock()

	select {
	case s.provider.completedCh <- struct{}{}:
	default:
	}
	return nil
}

func (s *fakeStreamingReplySession) Fail(context.Context, string) error {
	return nil
}

type fakeStreamingAIBackend struct{}

func (fakeStreamingAIBackend) Name() string {
	return "stream_ai"
}

func (fakeStreamingAIBackend) ProcessMessage(
	_ context.Context,
	_ store.BotConnection,
	_ store.BotConversation,
	inbound InboundMessage,
) (AIResult, error) {
	return AIResult{
		ThreadID: "thr_" + inbound.ConversationID,
		Messages: []OutboundMessage{
			{Text: "final: " + inbound.Text},
		},
	}, nil
}

func (fakeStreamingAIBackend) ProcessMessageStream(
	ctx context.Context,
	_ store.BotConnection,
	_ store.BotConversation,
	inbound InboundMessage,
	handle StreamingUpdateHandler,
) (AIResult, error) {
	if err := handle(ctx, StreamingUpdate{Messages: []OutboundMessage{{Text: "thinking..."}}}); err != nil {
		return AIResult{}, err
	}
	if err := handle(ctx, StreamingUpdate{Messages: []OutboundMessage{{Text: "reply: " + inbound.Text}}}); err != nil {
		return AIResult{}, err
	}

	return AIResult{
		ThreadID: "thr_" + inbound.ConversationID,
		Messages: []OutboundMessage{
			{Text: "final: " + inbound.Text},
		},
	}, nil
}
