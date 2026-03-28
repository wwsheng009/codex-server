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

func TestPollingApprovalCommandsBypassBlockedConversationWorker(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeScriptedPollingProvider([]InboundMessage{
		{
			ConversationID: "chat-poll-ctrl",
			MessageID:      "msg-poll-ctrl-1",
			UserID:         "user-1",
			Username:       "alice",
			Title:          "Alice",
			Text:           "hello from polling control",
		},
		{
			ConversationID: "chat-poll-ctrl",
			MessageID:      "msg-poll-ctrl-2",
			UserID:         "user-1",
			Username:       "alice",
			Title:          "Alice",
			Text:           "/approve@demo_bot req_poll_ctrl_1",
		},
	})
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_poll_ctrl_1",
			WorkspaceID: workspace.ID,
			ThreadID:    "thr_chat-poll-ctrl",
			Kind:        "item/commandExecution/requestApproval",
			Summary:     "go test ./...",
			Status:      "pending",
			Actions:     []string{"accept", "decline", "cancel"},
			RequestedAt: time.Now().UTC(),
		},
	})
	blockingBackend := newBlockingAIBackend()

	service := NewService(dataStore, nil, nil, nil, Config{
		Approvals:  approvalService,
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{blockingBackend},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "pollscript",
		AIBackend: "blocking_ai",
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
	case <-blockingBackend.started:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for blocking ai backend to start")
	}

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected control reply for connection %q, got %q", connection.ID, sent.ConnectionID)
		}
		if len(sent.Messages) != 1 ||
			!strings.Contains(sent.Messages[0].Text, "req_poll_ctrl_1") ||
			!strings.Contains(sent.Messages[0].Text, "was approved") {
			t.Fatalf("expected approval confirmation before blocked ai reply, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for polling approval confirmation")
	}

	call := approvalService.lastCall()
	if call.requestID != "req_poll_ctrl_1" {
		t.Fatalf("expected approval request id req_poll_ctrl_1, got %#v", call)
	}
	if call.input.Action != "accept" {
		t.Fatalf("expected approval action accept, got %#v", call.input)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
		if ok && storedConnection.Settings["poll_cursor"] == "2" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected polling connection to be persisted")
	}
	if storedConnection.Settings["poll_cursor"] != "2" {
		t.Fatalf("expected poll cursor 2 after scripted polling updates, got %#v", storedConnection.Settings)
	}

	close(blockingBackend.release)

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected ai reply for connection %q, got %q", connection.ID, sent.ConnectionID)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello from polling control" {
			t.Fatalf("expected blocked ai reply after release, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for released polling ai reply")
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

func TestServiceRetriesStoredStreamingReplyWithoutRerunningAI(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeStreamingProvider()
	provider.pushCompleteError(errors.New("telegram complete failed"))
	backend := &countingStreamingAIBackend{}

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{backend},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "streamchat",
		AIBackend: "counting_stream_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	requestBody := `{
		"conversationId":"chat-stream-retry-1",
		"messageId":"msg-stream-retry-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello streaming retry"
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
		if ok && strings.Contains(storedConnection.LastError, "telegram complete failed") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation after initial streaming failure, got %d", len(conversations))
	}
	if conversations[0].LastOutboundText != "final: hello streaming retry" {
		t.Fatalf("expected final reply to be recorded despite delivery failure, got %q", conversations[0].LastOutboundText)
	}

	provider.mu.Lock()
	failTexts := append([]string(nil), provider.failTexts...)
	provider.mu.Unlock()
	if len(failTexts) != 0 {
		t.Fatalf("did not expect streaming failure fallback after successful ai reply, got %#v", failTexts)
	}

	secondRequest := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(requestBody))
	secondRequest.Header.Set("X-Test-Secret", "fake-secret")

	result, err = service.HandleWebhook(secondRequest, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook(second) error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected second webhook to re-accept the failed delivery, got %d", result.Accepted)
	}

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "final: hello streaming retry" {
			t.Fatalf("expected stored final reply to be redelivered, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for stored streaming reply redelivery")
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected ai backend to run once, got %d calls", backend.callCount())
	}
}

func TestServiceStreamsDetailedFailureReplyWhenStreamingBackendFails(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeStreamingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{failingStreamingAIBackend{err: errors.New("workspace thread crashed while applying patch")}},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "streamchat",
		AIBackend: "failing_stream_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-stream-fail-1",
		"messageId":"msg-stream-fail-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello streaming failure"
	}`))
	request.Header.Set("X-Test-Secret", "fake-secret")

	result, err := service.HandleWebhook(request, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook() error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
	}

	deadline := time.Now().Add(2 * time.Second)
	var failTexts []string
	for time.Now().Before(deadline) {
		provider.mu.Lock()
		failTexts = append([]string(nil), provider.failTexts...)
		provider.mu.Unlock()
		if len(failTexts) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(failTexts) == 0 {
		t.Fatal("timed out waiting for streaming failure text")
	}
	if !strings.Contains(failTexts[0], "Technical details:") {
		t.Fatalf("expected detailed streaming failure text, got %q", failTexts[0])
	}
	if !strings.Contains(failTexts[0], "workspace thread crashed while applying patch") {
		t.Fatalf("expected underlying streaming error in failure text, got %q", failTexts[0])
	}
}

func TestServiceStreamsWorkspaceTurnFailureSummaryWhenStreamingBackendFails(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeStreamingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends: []AIBackend{failingStreamingAIBackend{err: &workspaceTurnTerminalError{
			Backend: "workspace_thread",
			Status:  "failed",
			Detail:  "permission denied",
		}}},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "streamchat",
		AIBackend: "failing_stream_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-stream-fail-2",
		"messageId":"msg-stream-fail-2",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello workspace failure"
	}`))
	request.Header.Set("X-Test-Secret", "fake-secret")

	result, err := service.HandleWebhook(request, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook() error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
	}

	deadline := time.Now().Add(2 * time.Second)
	var failTexts []string
	for time.Now().Before(deadline) {
		provider.mu.Lock()
		failTexts = append([]string(nil), provider.failTexts...)
		provider.mu.Unlock()
		if len(failTexts) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(failTexts) == 0 {
		t.Fatal("timed out waiting for streaming failure text")
	}
	if !strings.Contains(failTexts[0], "The workspace turn failed before producing a final bot reply.") {
		t.Fatalf("expected workspace turn failure summary, got %q", failTexts[0])
	}
	if !strings.Contains(failTexts[0], "permission denied") {
		t.Fatalf("expected workspace turn failure detail, got %q", failTexts[0])
	}
}

func TestFailureReplyTextClassifiesGenericAIBackendErrors(t *testing.T) {
	t.Parallel()

	text := failureReplyText(wrapAIBackendError("openai_responses", errors.New("rate limit exceeded")))

	if !strings.Contains(text, "The OpenAI responses AI backend failed while processing your message.") {
		t.Fatalf("expected AI backend summary, got %q", text)
	}
	if !strings.Contains(text, "rate limit exceeded") {
		t.Fatalf("expected technical detail in failure text, got %q", text)
	}
}

func TestFailureReplyTextClassifiesMissingBotVisibleReply(t *testing.T) {
	t.Parallel()

	text := failureReplyText(&botVisibleReplyMissingError{Backend: "workspace_thread"})

	if !strings.Contains(text, "The AI backend finished, but it did not produce any bot-visible reply.") {
		t.Fatalf("expected no-reply summary, got %q", text)
	}
	if !strings.Contains(text, "workspace thread AI backend returned no bot-visible reply") {
		t.Fatalf("expected no-reply detail, got %q", text)
	}
}

func TestFailureReplyTextIncludesFallbackDetailWhenErrorIsNil(t *testing.T) {
	t.Parallel()

	text := failureReplyText(nil)

	if !strings.Contains(text, "The bot failed, but the backend did not record a structured error.") {
		t.Fatalf("expected nil-error summary, got %q", text)
	}
	if !strings.Contains(text, "Technical details: no error object was provided by the bot backend") {
		t.Fatalf("expected nil-error detail, got %q", text)
	}
}

func TestFailureReplyTextIncludesFallbackDetailWhenErrorMessageIsBlank(t *testing.T) {
	t.Parallel()

	text := failureReplyText(errors.New(""))

	if !strings.Contains(text, "The bot could not process your message right now. Please try again later.") {
		t.Fatalf("expected generic fallback summary, got %q", text)
	}
	if !strings.Contains(text, "Technical details: the bot backend returned an empty error message") {
		t.Fatalf("expected blank-error detail, got %q", text)
	}
}

func TestFailureReplyTextClassifiesDeadlineExceededWithoutTimeoutWording(t *testing.T) {
	t.Parallel()

	text := failureReplyText(context.DeadlineExceeded)

	if !strings.Contains(text, "The bot backend stopped before finishing your message. Please try again.") {
		t.Fatalf("expected stopped-before-finishing summary, got %q", text)
	}
	if strings.Contains(strings.ToLower(text), "timed out") {
		t.Fatalf("did not expect timeout wording, got %q", text)
	}
	if !strings.Contains(strings.ToLower(text), "deadline exceeded") {
		t.Fatalf("expected technical detail to preserve deadline information, got %q", text)
	}
}

func TestNewServiceDefaultsToNoMessageTimeout(t *testing.T) {
	t.Parallel()

	service := NewService(store.NewMemoryStore(), nil, nil, nil, Config{})
	if service.messageTimeout != 0 {
		t.Fatalf("expected no default bot message timeout, got %v", service.messageTimeout)
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
		expected := failureReplyText(wrapAIBackendError("failing_ai", appRuntime.ErrRuntimeNotConfigured))
		if len(sent.Messages) != 1 || sent.Messages[0].Text != expected {
			t.Fatalf("expected failure reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for provider SendMessages call")
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
		if ok && strings.Contains(storedConnection.LastError, appRuntime.ErrRuntimeNotConfigured.Error()) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected bot connection to be persisted")
	}
	t.Fatalf("expected last error to mention runtime configuration, got %q", storedConnection.LastError)
}

func TestServiceRetriesFailedInboundMessageWhenWebhookRedeliversSameMessage(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
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

func TestServiceRecoversStoredReplyDeliveryOnStartWithoutRerunningAI(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	initialProvider := newFakeProvider()
	initialProvider.pushSendError(errors.New("transient delivery outage"))
	backend := &countingAIBackend{}

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{initialProvider},
		AIBackends:    []AIBackend{backend},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: "counting_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-recover-reply-1",
		"messageId":"msg-recover-reply-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello after delivery failure"
	}`))
	request.Header.Set("X-Test-Secret", "fake-secret")

	result, err := service.HandleWebhook(request, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook() error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
		if ok && strings.Contains(storedConnection.LastError, "transient delivery outage") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	recoveryProvider := newFakeProvider()
	recoveryService := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{recoveryProvider},
		AIBackends:    []AIBackend{backend},
	})
	recoveryService.Start(context.Background())

	select {
	case sent := <-recoveryProvider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello after delivery failure" {
			t.Fatalf("expected stored reply to be resent on start, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for stored reply recovery on start")
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected ai backend to run once across restart recovery, got %d calls", backend.callCount())
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

func TestHandleWebhookApprovalListCommandSupportsTelegramBotMentions(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_list_mention_1",
			WorkspaceID: workspace.ID,
			ThreadID:    "thr_chat-list-mention",
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
		"conversationId":"chat-list-mention",
		"messageId":"msg-list-mention-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"/approvals@demo_bot"
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
			!strings.Contains(sent.Messages[0].Text, "Pending approvals:") ||
			!strings.Contains(sent.Messages[0].Text, "req_list_mention_1") {
			t.Fatalf("expected approvals list message, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for approvals list response")
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

func TestHandleWebhookApproveCommandSupportsTelegramBotMentions(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_mention_1",
			WorkspaceID: workspace.ID,
			ThreadID:    "thr_chat-mention",
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
		"conversationId":"chat-mention",
		"messageId":"msg-mention-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"/approve@demo_bot req_mention_1"
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
			!strings.Contains(sent.Messages[0].Text, "req_mention_1") ||
			!strings.Contains(sent.Messages[0].Text, "was approved") {
			t.Fatalf("expected approval confirmation message, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for approval confirmation message")
	}

	call := approvalService.lastCall()
	if call.requestID != "req_mention_1" {
		t.Fatalf("expected approval request id req_mention_1, got %#v", call)
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

func TestHandleWebhookAnswerCommandSupportsTelegramBotMentions(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_answer_mention_1",
			WorkspaceID: workspace.ID,
			ThreadID:    "thr_chat-answer-mention",
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
		"conversationId":"chat-answer-mention",
		"messageId":"msg-answer-mention-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"/answer@demo_bot req_answer_mention_1 production"
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
			!strings.Contains(sent.Messages[0].Text, "req_answer_mention_1") ||
			!strings.Contains(sent.Messages[0].Text, "was approved") {
			t.Fatalf("expected answer confirmation message, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for answer confirmation message")
	}

	call := approvalService.lastCall()
	if call.requestID != "req_answer_mention_1" {
		t.Fatalf("expected answer request id req_answer_mention_1, got %#v", call)
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

type countingAIBackend struct {
	mu    sync.Mutex
	calls int
}

func (*countingAIBackend) Name() string {
	return "counting_ai"
}

func (b *countingAIBackend) ProcessMessage(_ context.Context, _ store.BotConnection, _ store.BotConversation, inbound InboundMessage) (AIResult, error) {
	b.mu.Lock()
	b.calls += 1
	b.mu.Unlock()

	return AIResult{
		ThreadID: "thr_" + inbound.ConversationID,
		Messages: []OutboundMessage{
			{Text: "reply: " + inbound.Text},
		},
	}, nil
}

func (b *countingAIBackend) callCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.calls
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

type fakeScriptedPollingProvider struct {
	mu        sync.Mutex
	delivered map[string]bool
	messages  []InboundMessage
	sentCh    chan fakeSentPayload
}

func newFakeScriptedPollingProvider(messages []InboundMessage) *fakeScriptedPollingProvider {
	return &fakeScriptedPollingProvider{
		delivered: make(map[string]bool),
		messages:  append([]InboundMessage(nil), messages...),
		sentCh:    make(chan fakeSentPayload, 8),
	}
}

func (p *fakeScriptedPollingProvider) Name() string {
	return "pollscript"
}

func (p *fakeScriptedPollingProvider) Activate(_ context.Context, connection store.BotConnection, _ string) (ActivationResult, error) {
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

func (p *fakeScriptedPollingProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakeScriptedPollingProvider) ParseWebhook(*http.Request, store.BotConnection) ([]InboundMessage, error) {
	return nil, ErrWebhookIgnored
}

func (p *fakeScriptedPollingProvider) SendMessages(_ context.Context, connection store.BotConnection, _ store.BotConversation, messages []OutboundMessage) error {
	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Messages:     append([]OutboundMessage(nil), messages...),
	}
	return nil
}

func (p *fakeScriptedPollingProvider) SupportsPolling(connection store.BotConnection) bool {
	return strings.EqualFold(strings.TrimSpace(connection.Settings["delivery_mode"]), "polling")
}

func (p *fakeScriptedPollingProvider) RunPolling(
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
	messages := append([]InboundMessage(nil), p.messages...)
	p.mu.Unlock()

	if !delivered {
		for index, message := range messages {
			if err := handleMessage(ctx, message); err != nil {
				return err
			}
			if err := updateSettings(ctx, map[string]string{
				"poll_cursor": intToString(index + 1),
			}); err != nil {
				return err
			}
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
	sentCh            chan fakeSentPayload
	completedCh       chan struct{}
	completeErrors    []error
	failTexts         []string
}

func newFakeStreamingProvider() *fakeStreamingProvider {
	return &fakeStreamingProvider{
		sentCh:      make(chan fakeSentPayload, 8),
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

func (p *fakeStreamingProvider) SendMessages(_ context.Context, connection store.BotConnection, _ store.BotConversation, messages []OutboundMessage) error {
	p.mu.Lock()
	p.sendMessagesCalls += 1
	p.mu.Unlock()
	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Messages:     append([]OutboundMessage(nil), messages...),
	}
	return nil
}

func (p *fakeStreamingProvider) pushCompleteError(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.completeErrors = append(p.completeErrors, err)
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
	var completeErr error
	if len(s.provider.completeErrors) > 0 {
		completeErr = s.provider.completeErrors[0]
		s.provider.completeErrors = append([]error(nil), s.provider.completeErrors[1:]...)
	}
	s.provider.mu.Unlock()

	if completeErr != nil {
		return completeErr
	}

	select {
	case s.provider.completedCh <- struct{}{}:
	default:
	}
	return nil
}

func (s *fakeStreamingReplySession) Fail(_ context.Context, text string) error {
	s.provider.mu.Lock()
	s.provider.failTexts = append(s.provider.failTexts, text)
	s.provider.mu.Unlock()
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

type countingStreamingAIBackend struct {
	mu    sync.Mutex
	calls int
}

func (*countingStreamingAIBackend) Name() string {
	return "counting_stream_ai"
}

func (b *countingStreamingAIBackend) ProcessMessage(
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

func (b *countingStreamingAIBackend) ProcessMessageStream(
	ctx context.Context,
	_ store.BotConnection,
	_ store.BotConversation,
	inbound InboundMessage,
	handle StreamingUpdateHandler,
) (AIResult, error) {
	b.mu.Lock()
	b.calls += 1
	b.mu.Unlock()

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

func (b *countingStreamingAIBackend) callCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.calls
}

type failingStreamingAIBackend struct {
	err error
}

func (failingStreamingAIBackend) Name() string {
	return "failing_stream_ai"
}

func (f failingStreamingAIBackend) ProcessMessage(
	_ context.Context,
	_ store.BotConnection,
	_ store.BotConversation,
	_ InboundMessage,
) (AIResult, error) {
	return AIResult{}, f.err
}

func (f failingStreamingAIBackend) ProcessMessageStream(
	_ context.Context,
	_ store.BotConnection,
	_ store.BotConversation,
	_ InboundMessage,
	_ StreamingUpdateHandler,
) (AIResult, error) {
	return AIResult{}, f.err
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
