package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/approvals"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
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

func TestServiceCreatesConnectionWithDebugRuntimeMode(t *testing.T) {
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
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	if connection.Settings[botRuntimeModeSetting] != botRuntimeModeDebug {
		t.Fatalf("expected debug runtime mode, got %#v", connection.Settings)
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

func TestHandleWebhookWeChatAddsAIAttachmentHintAndNormalizesReplyMedia(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-wechat-1",
			Messages: []OutboundMessage{
				{
					Text: "已收到。\n\n```wechat-attachments\nimage E:\\tmp\\wechat-photo.png\nfile https://example.com/report.pdf\n```",
				},
			},
		},
	}

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{backend},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "scripted_ai",
		Secrets: map[string]string{
			"bot_token": "wechat-token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-wechat-1",
		"messageId":"msg-wechat-1",
		"userId":"wechat-user-1",
		"username":"alice",
		"title":"Alice",
		"text":"请把图发我"
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
		if len(sent.Messages) != 1 {
			t.Fatalf("expected 1 normalized outbound message, got %#v", sent.Messages)
		}
		if got := sent.Messages[0].Text; got != "已收到。" {
			t.Fatalf("expected visible text to exclude attachment protocol, got %#v", sent.Messages[0])
		}
		if len(sent.Messages[0].Media) != 2 {
			t.Fatalf("expected 2 parsed media items, got %#v", sent.Messages[0].Media)
		}
		if got := sent.Messages[0].Media[0]; got.Kind != botMediaKindImage || got.Path != `E:\tmp\wechat-photo.png` || got.FileName != "wechat-photo.png" {
			t.Fatalf("expected first media item to be parsed image attachment, got %#v", got)
		}
		if got := sent.Messages[0].Media[1]; got.Kind != botMediaKindFile || got.URL != "https://example.com/report.pdf" {
			t.Fatalf("expected second media item to be parsed file url, got %#v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WeChat provider SendMessages call")
	}

	inbound := backend.lastInboundMessage()
	if !strings.Contains(inbound.Text, "请把图发我") {
		t.Fatalf("expected ai inbound text to preserve original user text, got %q", inbound.Text)
	}
	if strings.Count(inbound.Text, wechatAIOutboundMediaNote) != 1 {
		t.Fatalf("expected ai inbound text to include WeChat media note exactly once, got %q", inbound.Text)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conversations = service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 && strings.Contains(conversations[0].LastOutboundText, "[WeChat image attachment]") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	t.Fatalf("expected last outbound text to summarize normalized media, got %q", conversations[0].LastOutboundText)
}

func TestServiceUpdatesConnectionRuntimeMode(t *testing.T) {
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

	updated, err := service.UpdateConnectionRuntimeMode(workspace.ID, connection.ID, UpdateConnectionRuntimeModeInput{
		RuntimeMode: botRuntimeModeDebug,
	})
	if err != nil {
		t.Fatalf("UpdateConnectionRuntimeMode() error = %v", err)
	}

	if updated.Settings[botRuntimeModeSetting] != botRuntimeModeDebug {
		t.Fatalf("expected debug runtime mode after update, got %#v", updated.Settings)
	}
}

func TestHandleWebhookPersistsConversationProviderState(t *testing.T) {
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
		"conversationId":"chat-provider-1",
		"messageId":"msg-provider-1",
		"userId":"user-provider-1",
		"title":"Provider Chat",
		"text":"hello provider state",
		"providerData":{
			"wechat_context_token":"ctx-123",
			"wechat_session_id":"session-456"
		}
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
		if got := sent.Conversation.ProviderState["wechat_context_token"]; got != "ctx-123" {
			t.Fatalf("expected provider state context token ctx-123 during send, got %#v", sent.Conversation.ProviderState)
		}
		if got := sent.Conversation.ProviderState["wechat_session_id"]; got != "session-456" {
			t.Fatalf("expected provider state session id session-456 during send, got %#v", sent.Conversation.ProviderState)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for provider SendMessages call")
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %#v", conversations)
	}
	if got := conversations[0].ProviderState["wechat_context_token"]; got != "ctx-123" {
		t.Fatalf("expected persisted provider state context token ctx-123, got %#v", conversations[0].ProviderState)
	}
	if got := conversations[0].ProviderState["wechat_session_id"]; got != "session-456" {
		t.Fatalf("expected persisted provider state session id session-456, got %#v", conversations[0].ProviderState)
	}
}

func TestHandleWebhookNewThreadCommandStartsFreshWorkspaceThread(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		PollInterval:  5 * time.Millisecond,
		TurnTimeout:   time.Second,
		Providers:     []Provider{provider},
	})
	if backend, ok := service.aiBackends[defaultAIBackend].(*workspaceThreadAIBackend); ok {
		backend.turnSettleDelay = 5 * time.Millisecond
		backend.pollInterval = 5 * time.Millisecond
	}
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	sendWebhook := func(payload string) {
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

	expectSingleReply := func(expected string) {
		select {
		case sent := <-provider.sentCh:
			if len(sent.Messages) != 1 || sent.Messages[0].Text != expected {
				t.Fatalf("expected sent message %q, got %#v", expected, sent.Messages)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for sent message %q", expected)
		}
	}

	sendWebhook(`{"conversationId":"chat-1","messageId":"msg-1","userId":"user-1","username":"alice","title":"Alice","text":"hello"}`)
	expectSingleReply("reply: hello")

	sendWebhook(`{"conversationId":"chat-1","messageId":"msg-2","userId":"user-1","username":"alice","title":"Alice","text":"/newthread Incident 42"}`)
	expectSingleReply("Started a new workspace thread: thread-bot-2\nName: Bot Connection · Incident 42\nFuture messages in this chat will use the new thread.")

	sendWebhook(`{"conversationId":"chat-1","messageId":"msg-3","userId":"user-1","username":"alice","title":"Alice","text":"hello again"}`)
	expectSingleReply("reply: hello again")

	threadCalls := turnsExec.threadCalls()
	if len(threadCalls) != 2 {
		t.Fatalf("expected two AI turns, got %#v", threadCalls)
	}
	if threadCalls[0] != "thread-bot-1" || threadCalls[1] != "thread-bot-2" {
		t.Fatalf("expected AI turns to run on thread-bot-1 then thread-bot-2, got %#v", threadCalls)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %#v", conversations)
	}
	if conversations[0].ThreadID != "thread-bot-2" {
		t.Fatalf("expected current conversation thread to switch to thread-bot-2, got %#v", conversations[0])
	}
	if conversationContextVersion(conversations[0]) != 1 {
		t.Fatalf("expected conversation context version 1 after /newthread, got %#v", conversations[0].BackendState)
	}
}

func TestRecordConversationOutcomeIgnoresStaleReplyAfterNewThreadSwitch(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		ID:          "bot-1",
		WorkspaceID: workspace.ID,
		Provider:    "fakechat",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspace.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-1",
		ExternalChatID:         "chat-1",
		ThreadID:               "thread-old",
		BackendState:           conversationBackendStateWithVersion(map[string]string{"previous_response_id": "resp-old"}, 0),
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	updatedConversation, err := dataStore.UpdateBotConversation(workspace.ID, conversation.ID, func(current store.BotConversation) store.BotConversation {
		current.ThreadID = "thread-new"
		current.BackendState = conversationBackendStateWithVersion(nil, 1)
		return current
	})
	if err != nil {
		t.Fatalf("UpdateBotConversation() error = %v", err)
	}
	if updatedConversation.ThreadID != "thread-new" {
		t.Fatalf("expected current thread-new binding, got %#v", updatedConversation)
	}

	service.recordConversationOutcome(connection, conversation, AIResult{
		ThreadID: "thread-old",
		Messages: []OutboundMessage{{Text: "stale reply"}},
		BackendState: map[string]string{
			"previous_response_id": "resp-stale",
		},
	}, InboundMessage{
		MessageID: "msg-stale",
		Text:      "old in-flight message",
	}, "")

	storedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatal("expected bot conversation to remain persisted")
	}
	if storedConversation.ThreadID != "thread-new" {
		t.Fatalf("expected stale reply not to overwrite new thread binding, got %#v", storedConversation)
	}
	if conversationContextVersion(storedConversation) != 1 {
		t.Fatalf("expected context version 1 to be preserved, got %#v", storedConversation.BackendState)
	}
	if storedConversation.LastOutboundText != "" {
		t.Fatalf("expected stale reply not to overwrite last outbound text, got %#v", storedConversation)
	}
}

func TestHandleWebhookThreadCommandsShowListAndUseKnownThreads(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		PollInterval:  5 * time.Millisecond,
		TurnTimeout:   time.Second,
		Providers:     []Provider{provider},
	})
	if backend, ok := service.aiBackends[defaultAIBackend].(*workspaceThreadAIBackend); ok {
		backend.turnSettleDelay = 5 * time.Millisecond
		backend.pollInterval = 5 * time.Millisecond
	}
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	sendWebhook := func(payload string) {
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

	expectSingleReply := func(expected string) {
		select {
		case sent := <-provider.sentCh:
			if len(sent.Messages) != 1 || sent.Messages[0].Text != expected {
				t.Fatalf("expected sent message %q, got %#v", expected, sent.Messages)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for sent message %q", expected)
		}
	}

	sendWebhook(`{"conversationId":"chat-2","messageId":"msg-1","userId":"user-1","username":"alice","title":"Alice","text":"hello"}`)
	expectSingleReply("reply: hello")
	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 && conversations[0].ThreadID == "thread-bot-1" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected first thread binding to settle, got %#v", conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}

	sendWebhook(`{"conversationId":"chat-2","messageId":"msg-2","userId":"user-1","username":"alice","title":"Alice","text":"/newthread Incident 42"}`)
	expectSingleReply("Started a new workspace thread: thread-bot-2\nName: Bot Connection · Incident 42\nFuture messages in this chat will use the new thread.")

	sendWebhook(`{"conversationId":"chat-2","messageId":"msg-3","userId":"user-1","username":"alice","title":"Alice","text":"hello on second thread"}`)
	expectSingleReply("reply: hello on second thread")
	deadline = time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 {
			known := knownConversationThreadIDs(conversations[0])
			if len(known) == 2 && known[0] == "thread-bot-1" && known[1] == "thread-bot-2" {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected known thread history to settle, got %#v", service.ListConversations(workspace.ID, connection.ID))
		}
		time.Sleep(10 * time.Millisecond)
	}

	sendWebhook(`{"conversationId":"chat-2","messageId":"msg-4","userId":"user-1","username":"alice","title":"Alice","text":"/thread"}`)
	expectSingleReply("Current workspace thread: thread-bot-2\nName: Bot Connection · Incident 42\nPreview: reply: hello on second thread\nUpdated: 2026-03-28 12:02:30 UTC\nConversation context version: 1")

	sendWebhook(`{"conversationId":"chat-2","messageId":"msg-5","userId":"user-1","username":"alice","title":"Alice","text":"/thread list"}`)
	expectSingleReply("Known workspace threads (current first, then recent approvals/activity):\n1. thread-bot-2 (current) | Bot Connection · Incident 42 | reply: hello on second thread | updated 2026-03-28 12:02:30 UTC\n2. thread-bot-1 | Bot Connection · Alice | reply: hello | updated 2026-03-28 12:01:30 UTC")

	sendWebhook(`{"conversationId":"chat-2","messageId":"msg-6","userId":"user-1","username":"alice","title":"Alice","text":"/thread use 2"}`)
	expectSingleReply("Switched the current conversation to thread: thread-bot-1")

	sendWebhook(`{"conversationId":"chat-2","messageId":"msg-7","userId":"user-1","username":"alice","title":"Alice","text":"hello after switch back"}`)
	expectSingleReply("reply: hello after switch back")

	threadCalls := turnsExec.threadCalls()
	if len(threadCalls) != 3 {
		t.Fatalf("expected three AI turns, got %#v", threadCalls)
	}
	if threadCalls[0] != "thread-bot-1" || threadCalls[1] != "thread-bot-2" || threadCalls[2] != "thread-bot-1" {
		t.Fatalf("expected AI turns on thread-bot-1, thread-bot-2, then thread-bot-1, got %#v", threadCalls)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %#v", conversations)
	}
	if conversations[0].ThreadID != "thread-bot-1" {
		t.Fatalf("expected conversation to switch back to thread-bot-1, got %#v", conversations[0])
	}
	if conversationContextVersion(conversations[0]) != 2 {
		t.Fatalf("expected context version 2 after /newthread and /thread use, got %#v", conversations[0].BackendState)
	}
	if got := knownConversationThreadIDs(conversations[0]); len(got) != 2 || got[0] != "thread-bot-1" || got[1] != "thread-bot-2" {
		t.Fatalf("expected known threads [thread-bot-1 thread-bot-2], got %#v", got)
	}
}

func TestHandleWebhookThreadRenameAndArchiveCommands(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		PollInterval:  5 * time.Millisecond,
		TurnTimeout:   time.Second,
		Providers:     []Provider{provider},
	})
	if backend, ok := service.aiBackends[defaultAIBackend].(*workspaceThreadAIBackend); ok {
		backend.turnSettleDelay = 5 * time.Millisecond
		backend.pollInterval = 5 * time.Millisecond
	}
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	sendWebhook := func(payload string) {
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

	expectSingleReply := func(expected string) {
		select {
		case sent := <-provider.sentCh:
			if len(sent.Messages) != 1 || sent.Messages[0].Text != expected {
				t.Fatalf("expected sent message %q, got %#v", expected, sent.Messages)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for sent message %q", expected)
		}
	}

	sendWebhook(`{"conversationId":"chat-3","messageId":"msg-1","userId":"user-1","username":"alice","title":"Alice","text":"hello"}`)
	expectSingleReply("reply: hello")

	sendWebhook(`{"conversationId":"chat-3","messageId":"msg-2","userId":"user-1","username":"alice","title":"Alice","text":"/thread rename Release Review"}`)
	expectSingleReply("Renamed the current thread to: Release Review")

	sendWebhook(`{"conversationId":"chat-3","messageId":"msg-3","userId":"user-1","username":"alice","title":"Alice","text":"/thread archive"}`)
	expectSingleReply("Archived the current thread: thread-bot-1\nFuture messages in this chat will require /newthread or /thread use.")

	sendWebhook(`{"conversationId":"chat-3","messageId":"msg-4","userId":"user-1","username":"alice","title":"Alice","text":"/thread"}`)
	expectSingleReply("This conversation is not currently bound to a workspace thread.\nUse /newthread to start a new thread.\nUse /thread list archived to inspect 1 archived thread.")

	sendWebhook(`{"conversationId":"chat-3","messageId":"msg-5","userId":"user-1","username":"alice","title":"Alice","text":"/thread list"}`)
	expectSingleReply("Known workspace threads (current first, then recent approvals/activity):\n1. thread-bot-1 (archived) | Release Review | reply: hello | updated 2026-03-28 12:02:00 UTC")

	sendWebhook(`{"conversationId":"chat-3","messageId":"msg-6","userId":"user-1","username":"alice","title":"Alice","text":"/thread use 1"}`)
	expectSingleReply("The bot could not switch threads right now: thread \"thread-bot-1\" is archived; start a new thread or use an active thread instead")

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %#v", conversations)
	}
	if conversations[0].ThreadID != "" {
		t.Fatalf("expected archived current thread to unbind conversation, got %#v", conversations[0])
	}
	if conversationContextVersion(conversations[0]) != 1 {
		t.Fatalf("expected context version 1 after archive, got %#v", conversations[0].BackendState)
	}
	if got := knownConversationThreadIDs(conversations[0]); len(got) != 1 || got[0] != "thread-bot-1" {
		t.Fatalf("expected archived thread to remain in known history, got %#v", got)
	}

	detail, err := threadsExec.GetDetail(context.Background(), workspace.ID, "thread-bot-1")
	if err != nil {
		t.Fatalf("GetDetail(thread-bot-1) error = %v", err)
	}
	if !detail.Archived {
		t.Fatalf("expected thread-bot-1 to be archived, got %#v", detail.Thread)
	}
	if detail.Name != "Release Review" {
		t.Fatalf("expected renamed thread title to persist, got %#v", detail.Thread)
	}
}

func TestHandleWebhookThreadListFiltersAndUnarchiveCommands(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		PollInterval:  5 * time.Millisecond,
		TurnTimeout:   time.Second,
		Providers:     []Provider{provider},
	})
	if backend, ok := service.aiBackends[defaultAIBackend].(*workspaceThreadAIBackend); ok {
		backend.turnSettleDelay = 5 * time.Millisecond
		backend.pollInterval = 5 * time.Millisecond
	}
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	sendWebhook := func(payload string) {
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

	expectSingleReply := func(expected string) {
		select {
		case sent := <-provider.sentCh:
			if len(sent.Messages) != 1 || sent.Messages[0].Text != expected {
				t.Fatalf("expected sent message %q, got %#v", expected, sent.Messages)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for sent message %q", expected)
		}
	}

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-1","userId":"user-1","username":"alice","title":"Alice","text":"hello"}`)
	expectSingleReply("reply: hello")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-2","userId":"user-1","username":"alice","title":"Alice","text":"/thread archive"}`)
	expectSingleReply("Archived the current thread: thread-bot-1\nFuture messages in this chat will require /newthread or /thread use.")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-3","userId":"user-1","username":"alice","title":"Alice","text":"/newthread Incident 84"}`)
	expectSingleReply("Started a new workspace thread: thread-bot-2\nName: Bot Connection · Incident 84\nFuture messages in this chat will use the new thread.")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-4","userId":"user-1","username":"alice","title":"Alice","text":"hello on second thread"}`)
	expectSingleReply("reply: hello on second thread")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-5","userId":"user-1","username":"alice","title":"Alice","text":"/thread list active"}`)
	expectSingleReply("Known active workspace threads (current first, then recent approvals/activity):\n1. thread-bot-2 (current) | Bot Connection · Incident 84 | reply: hello on second thread | updated 2026-03-28 12:02:30 UTC")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-6","userId":"user-1","username":"alice","title":"Alice","text":"/thread list archived"}`)
	expectSingleReply("Known archived workspace threads (recent approvals/activity first):\n1. thread-bot-1 (archived) | Bot Connection · Alice | reply: hello | updated 2026-03-28 12:01:45 UTC")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-7","userId":"user-1","username":"alice","title":"Alice","text":"/thread unarchive 1"}`)
	expectSingleReply("Unarchived thread: thread-bot-1\nUse /thread use thread-bot-1 to switch this conversation back.")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-8","userId":"user-1","username":"alice","title":"Alice","text":"/thread list archived"}`)
	expectSingleReply("No archived workspace threads are currently recorded for this conversation.")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-9","userId":"user-1","username":"alice","title":"Alice","text":"/thread use 2"}`)
	expectSingleReply("Switched the current conversation to thread: thread-bot-1")

	sendWebhook(`{"conversationId":"chat-4","messageId":"msg-10","userId":"user-1","username":"alice","title":"Alice","text":"hello after unarchive"}`)
	expectSingleReply("reply: hello after unarchive")

	threadCalls := turnsExec.threadCalls()
	if len(threadCalls) != 3 {
		t.Fatalf("expected three AI turns, got %#v", threadCalls)
	}
	if threadCalls[0] != "thread-bot-1" || threadCalls[1] != "thread-bot-2" || threadCalls[2] != "thread-bot-1" {
		t.Fatalf("expected AI turns on thread-bot-1, thread-bot-2, then thread-bot-1, got %#v", threadCalls)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %#v", conversations)
	}
	if conversations[0].ThreadID != "thread-bot-1" {
		t.Fatalf("expected conversation to switch back to thread-bot-1, got %#v", conversations[0])
	}
	if conversationContextVersion(conversations[0]) != 3 {
		t.Fatalf("expected context version 3 after archive, /newthread, and /thread use, got %#v", conversations[0].BackendState)
	}
	if got := knownConversationThreadIDs(conversations[0]); len(got) != 2 || got[0] != "thread-bot-1" || got[1] != "thread-bot-2" {
		t.Fatalf("expected known threads [thread-bot-1 thread-bot-2], got %#v", got)
	}

	detail, err := threadsExec.GetDetail(context.Background(), workspace.ID, "thread-bot-1")
	if err != nil {
		t.Fatalf("GetDetail(thread-bot-1) error = %v", err)
	}
	if detail.Archived {
		t.Fatalf("expected thread-bot-1 to be unarchived, got %#v", detail.Thread)
	}
}

func TestHandleWebhookThreadCommandsShowPendingApprovalCounts(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}
	approvalsSvc := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_thr1_a",
			WorkspaceID: workspace.ID,
			ThreadID:    "thread-bot-1",
			Kind:        "item/permissions/requestApproval",
			Summary:     "Approve edit",
			Status:      "pending",
			RequestedAt: time.Date(2026, time.March, 28, 12, 1, 40, 0, time.UTC),
		},
		{
			ID:          "req_thr1_b",
			WorkspaceID: workspace.ID,
			ThreadID:    "thread-bot-1",
			Kind:        "item/tool/requestUserInput",
			Summary:     "Need input",
			Status:      "pending",
			RequestedAt: time.Date(2026, time.March, 28, 12, 1, 50, 0, time.UTC),
		},
		{
			ID:          "req_thr2_a",
			WorkspaceID: workspace.ID,
			ThreadID:    "thread-bot-2",
			Kind:        "item/tool/call",
			Summary:     "Tool input required",
			Status:      "pending",
			RequestedAt: time.Date(2026, time.March, 28, 12, 2, 40, 0, time.UTC),
		},
	})

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		PollInterval:  5 * time.Millisecond,
		TurnTimeout:   time.Second,
		Approvals:     approvalsSvc,
		Providers:     []Provider{provider},
	})
	if backend, ok := service.aiBackends[defaultAIBackend].(*workspaceThreadAIBackend); ok {
		backend.turnSettleDelay = 5 * time.Millisecond
		backend.pollInterval = 5 * time.Millisecond
	}
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	sendWebhook := func(payload string) {
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

	expectSingleReply := func(expected string) {
		select {
		case sent := <-provider.sentCh:
			if len(sent.Messages) != 1 || sent.Messages[0].Text != expected {
				t.Fatalf("expected sent message %q, got %#v", expected, sent.Messages)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for sent message %q", expected)
		}
	}

	sendWebhook(`{"conversationId":"chat-5","messageId":"msg-1","userId":"user-1","username":"alice","title":"Alice","text":"hello"}`)
	expectSingleReply("reply: hello")

	sendWebhook(`{"conversationId":"chat-5","messageId":"msg-2","userId":"user-1","username":"alice","title":"Alice","text":"/newthread Review Queue"}`)
	expectSingleReply("Started a new workspace thread: thread-bot-2\nName: Bot Connection · Review Queue\nFuture messages in this chat will use the new thread.")

	sendWebhook(`{"conversationId":"chat-5","messageId":"msg-3","userId":"user-1","username":"alice","title":"Alice","text":"hello on second thread"}`)
	expectSingleReply("reply: hello on second thread")

	sendWebhook(`{"conversationId":"chat-5","messageId":"msg-4","userId":"user-1","username":"alice","title":"Alice","text":"/thread"}`)
	expectSingleReply("Current workspace thread: thread-bot-2\nName: Bot Connection · Review Queue\nPreview: reply: hello on second thread\nUpdated: 2026-03-28 12:02:30 UTC\nPending approval: 1 (Tool Response Request x1; latest: Tool input required; requested 2026-03-28 12:02:40 UTC; use /approvals)\nConversation context version: 1")

	sendWebhook(`{"conversationId":"chat-5","messageId":"msg-5","userId":"user-1","username":"alice","title":"Alice","text":"/thread list"}`)
	expectSingleReply("Known workspace threads (current first, then recent approvals/activity):\n1. thread-bot-2 (current) | Bot Connection · Review Queue | reply: hello on second thread | 1 pending approval: Tool Response Request x1; latest: Tool input required; requested 2026-03-28 12:02:40 UTC | updated 2026-03-28 12:02:30 UTC\n2. thread-bot-1 | Bot Connection · Alice | reply: hello | 2 pending approvals: Permissions Request x1, User Input Request x1; latest: Need input; requested 2026-03-28 12:01:50 UTC | updated 2026-03-28 12:01:30 UTC")
}

func TestBotConversationCommandHelpMentionsThreadListOrdering(t *testing.T) {
	t.Parallel()

	text := botConversationCommandHelp("")
	expected := strings.Join([]string{
		"Bot conversation commands:",
		"/newthread [title]",
		"/thread",
		"/thread list [active|archived|all]",
		"  lists current thread first, then recent approvals/activity",
		"/thread rename <title>",
		"/thread archive",
		"/thread unarchive <thread_id|index>",
		"/thread use <thread_id|index>",
	}, "\n")
	if text != expected {
		t.Fatalf("expected help text %q, got %q", expected, text)
	}
}

func TestRenderCurrentConversationThreadWithoutBindingSuggestsNextCommands(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	threadsExec := newFakeBotThreads()
	service := NewService(dataStore, threadsExec, nil, nil, Config{})

	thread1, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Thread One"})
	if err != nil {
		t.Fatalf("Create(thread1) error = %v", err)
	}
	thread2, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Thread Two"})
	if err != nil {
		t.Fatalf("Create(thread2) error = %v", err)
	}
	if _, err := threadsExec.Archive(context.Background(), workspace.ID, thread2.ID); err != nil {
		t.Fatalf("Archive(thread2) error = %v", err)
	}

	conversation := store.BotConversation{
		BackendState: conversationBackendStateWithKnownThreads(nil, []string{thread1.ID, thread2.ID}),
	}
	text := service.renderCurrentConversationThread(context.Background(), store.BotConnection{WorkspaceID: workspace.ID}, conversation)
	expected := "This conversation is not currently bound to a workspace thread.\nUse /newthread to start a new thread.\nUse /thread list active to inspect 1 known active thread.\nUse /thread list archived to inspect 1 archived thread."
	if text != expected {
		t.Fatalf("expected current thread guidance %q, got %q", expected, text)
	}
}

func TestRenderKnownConversationThreadsPrioritizesCurrentAndRecentApprovals(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	threadsExec := newFakeBotThreads()
	approvalsSvc := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_thr1_old",
			WorkspaceID: workspace.ID,
			ThreadID:    "thread-bot-1",
			Kind:        "item/permissions/requestApproval",
			Summary:     "Older approval",
			Status:      "pending",
			RequestedAt: time.Date(2026, time.March, 28, 12, 1, 10, 0, time.UTC),
		},
		{
			ID:          "req_thr2_new",
			WorkspaceID: workspace.ID,
			ThreadID:    "thread-bot-2",
			Kind:        "item/tool/call",
			Summary:     "Newest approval",
			Status:      "pending",
			RequestedAt: time.Date(2026, time.March, 28, 12, 2, 50, 0, time.UTC),
		},
	})

	service := NewService(dataStore, threadsExec, nil, nil, Config{
		Approvals: approvalsSvc,
	})

	createThread := func(name string) string {
		thread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: name})
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		return thread.ID
	}

	thread1 := createThread("Thread One")
	thread2 := createThread("Thread Two")
	thread3 := createThread("Thread Three")

	threadsExec.setCompletedTurn(thread1, store.ThreadTurn{
		ID:     "turn-1",
		Status: "completed",
		Items:  []map[string]any{{"id": "assistant-1", "type": "agentMessage", "text": "reply one"}},
	})
	threadsExec.setCompletedTurn(thread2, store.ThreadTurn{
		ID:     "turn-2",
		Status: "completed",
		Items:  []map[string]any{{"id": "assistant-2", "type": "agentMessage", "text": "reply two"}},
	})
	threadsExec.setCompletedTurn(thread3, store.ThreadTurn{
		ID:     "turn-3",
		Status: "completed",
		Items:  []map[string]any{{"id": "assistant-3", "type": "agentMessage", "text": "reply three"}},
	})

	connection := store.BotConnection{WorkspaceID: workspace.ID}
	conversation := store.BotConversation{
		ThreadID: thread3,
		BackendState: conversationBackendStateWithKnownThreads(nil, []string{
			thread1,
			thread2,
			thread3,
		}),
	}

	text := service.renderKnownConversationThreads(context.Background(), connection, conversation, "all")
	expected := "Known workspace threads (current first, then recent approvals/activity):\n1. thread-bot-3 (current) | Thread Three | reply three | updated 2026-03-28 12:03:30 UTC\n2. thread-bot-2 | Thread Two | reply two | 1 pending approval: Tool Response Request x1; latest: Newest approval; requested 2026-03-28 12:02:50 UTC | updated 2026-03-28 12:02:30 UTC\n3. thread-bot-1 | Thread One | reply one | 1 pending approval: Permissions Request x1; latest: Older approval; requested 2026-03-28 12:01:10 UTC | updated 2026-03-28 12:01:30 UTC"
	if text != expected {
		t.Fatalf("expected ordered thread list %q, got %q", expected, text)
	}
}

func TestServiceRejectsDuplicateTelegramPollingTokenOnCreate(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	provider := newFakeTelegramPollingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{fakeAIBackend{}},
	})

	first, err := service.CreateConnection(context.Background(), workspaceA.ID, CreateConnectionInput{
		Provider:  "telegram",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{
			"bot_token": "shared-telegram-token",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection(first) error = %v", err)
	}

	_, err = service.CreateConnection(context.Background(), workspaceB.ID, CreateConnectionInput{
		Provider:  "telegram",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{
			"bot_token": "shared-telegram-token",
		},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for duplicate telegram polling token, got %v", err)
	}
	if !strings.Contains(err.Error(), first.ID) {
		t.Fatalf("expected conflict error to mention first connection %q, got %v", first.ID, err)
	}
}

func TestServiceRejectsResumeWhenAnotherTelegramPollingConnectionOwnsToken(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeTelegramPollingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{fakeAIBackend{}},
	})

	first, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "telegram",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{
			"bot_token": "shared-telegram-token",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection(first) error = %v", err)
	}

	if _, err := service.PauseConnection(context.Background(), workspace.ID, first.ID); err != nil {
		t.Fatalf("PauseConnection(first) error = %v", err)
	}

	second, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "telegram",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{
			"bot_token": "shared-telegram-token",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection(second) error = %v", err)
	}

	_, err = service.ResumeConnection(context.Background(), workspace.ID, first.ID, ResumeConnectionInput{})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput when resuming duplicate telegram polling token, got %v", err)
	}
	if !strings.Contains(err.Error(), second.ID) {
		t.Fatalf("expected conflict error to mention active owner %q, got %v", second.ID, err)
	}
}

func TestServiceStartsOnlyOneTelegramPollerPerToken(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	provider := newFakeTelegramPollingProvider()

	olderCreatedAt := time.Now().Add(-2 * time.Hour).UTC()
	newerCreatedAt := olderCreatedAt.Add(10 * time.Minute)
	older := store.BotConnection{
		ID:          "bot-owner",
		WorkspaceID: workspaceA.ID,
		Provider:    "telegram",
		Name:        "Owner",
		Status:      "active",
		AIBackend:   "fake_ai",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{
			"bot_token": "shared-telegram-token",
		},
		CreatedAt: olderCreatedAt,
		UpdatedAt: olderCreatedAt,
	}
	newer := store.BotConnection{
		ID:          "bot-duplicate",
		WorkspaceID: workspaceB.ID,
		Provider:    "telegram",
		Name:        "Duplicate",
		Status:      "active",
		AIBackend:   "fake_ai",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{
			"bot_token": "shared-telegram-token",
		},
		CreatedAt: newerCreatedAt,
		UpdatedAt: newerCreatedAt,
	}
	if _, err := dataStore.CreateBotConnection(older); err != nil {
		t.Fatalf("CreateBotConnection(older) error = %v", err)
	}
	if _, err := dataStore.CreateBotConnection(newer); err != nil {
		t.Fatalf("CreateBotConnection(newer) error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{fakeAIBackend{}},
	})
	service.Start(ctx)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if provider.startedCount() == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if provider.startedCount() != 1 {
		t.Fatalf("expected exactly one telegram poller to start, got %d", provider.startedCount())
	}

	startedIDs := provider.startedConnectionIDs()
	if len(startedIDs) != 1 || startedIDs[0] != older.ID {
		t.Fatalf("expected older connection %q to own telegram polling token, got %#v", older.ID, startedIDs)
	}

	conflicted, ok := dataStore.GetBotConnection(workspaceB.ID, newer.ID)
	if !ok {
		t.Fatal("expected duplicate bot connection to remain persisted")
	}
	if !strings.Contains(conflicted.LastError, older.ID) {
		t.Fatalf("expected duplicate connection last error to mention owner %q, got %q", older.ID, conflicted.LastError)
	}
}

func TestServiceRejectsDuplicateWeChatPollingConnectionByAccountID(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	provider := newFakeWeChatPollingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{fakeAIBackend{}},
	})

	first, err := service.CreateConnection(context.Background(), workspaceA.ID, CreateConnectionInput{
		Provider:  "wechat",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      "https://wechat.example.com",
			wechatAccountIDSetting:    "wechat-account-1",
			wechatOwnerUserIDSetting:  "wechat-owner-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection(first) error = %v", err)
	}

	_, err = service.CreateConnection(context.Background(), workspaceB.ID, CreateConnectionInput{
		Provider:  "wechat",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      "https://wechat.example.com",
			wechatAccountIDSetting:    "wechat-account-1",
			wechatOwnerUserIDSetting:  "wechat-owner-2",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-2",
		},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for duplicate wechat polling ownership, got %v", err)
	}
	if !strings.Contains(err.Error(), first.ID) {
		t.Fatalf("expected conflict error to mention first connection %q, got %v", first.ID, err)
	}
}

func TestServiceStartsOnlyOneWeChatPollerPerAccountID(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	provider := newFakeWeChatPollingProvider()

	olderCreatedAt := time.Now().Add(-2 * time.Hour).UTC()
	newerCreatedAt := olderCreatedAt.Add(10 * time.Minute)
	older := store.BotConnection{
		ID:          "bot-wechat-owner",
		WorkspaceID: workspaceA.ID,
		Provider:    "wechat",
		Name:        "Owner",
		Status:      "active",
		AIBackend:   "fake_ai",
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      "https://wechat.example.com",
			wechatAccountIDSetting:    "wechat-account-owner",
			wechatOwnerUserIDSetting:  "wechat-owner-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-owner",
		},
		CreatedAt: olderCreatedAt,
		UpdatedAt: olderCreatedAt,
	}
	newer := store.BotConnection{
		ID:          "bot-wechat-duplicate",
		WorkspaceID: workspaceB.ID,
		Provider:    "wechat",
		Name:        "Duplicate",
		Status:      "active",
		AIBackend:   "fake_ai",
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      "https://wechat.example.com",
			wechatAccountIDSetting:    "wechat-account-owner",
			wechatOwnerUserIDSetting:  "wechat-owner-2",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-duplicate",
		},
		CreatedAt: newerCreatedAt,
		UpdatedAt: newerCreatedAt,
	}
	if _, err := dataStore.CreateBotConnection(older); err != nil {
		t.Fatalf("CreateBotConnection(older) error = %v", err)
	}
	if _, err := dataStore.CreateBotConnection(newer); err != nil {
		t.Fatalf("CreateBotConnection(newer) error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{fakeAIBackend{}},
	})
	service.Start(ctx)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if provider.startedCount() == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if provider.startedCount() != 1 {
		t.Fatalf("expected exactly one wechat poller to start, got %d", provider.startedCount())
	}

	startedIDs := provider.startedConnectionIDs()
	if len(startedIDs) != 1 || startedIDs[0] != older.ID {
		t.Fatalf("expected older connection %q to own wechat polling account, got %#v", older.ID, startedIDs)
	}

	conflicted, ok := dataStore.GetBotConnection(workspaceB.ID, newer.ID)
	if !ok {
		t.Fatal("expected duplicate wechat connection to remain persisted")
	}
	if !strings.Contains(conflicted.LastError, older.ID) {
		t.Fatalf("expected duplicate connection last error to mention owner %q, got %q", older.ID, conflicted.LastError)
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

	deadline := time.Now().Add(2 * time.Second)
	var conversations []store.BotConversation
	threadIDs := make(map[string]string, 2)
	for {
		conversations = service.ListConversations(workspace.ID, connection.ID)
		threadIDs = map[string]string{}
		for _, conversation := range conversations {
			if conversation.ExternalChatID != "chat-group" {
				t.Fatalf("expected shared external chat id chat-group, got %#v", conversation)
			}
			threadIDs[conversation.ExternalThreadID] = conversation.ThreadID
		}
		if len(conversations) == 2 &&
			threadIDs["11"] == "thr_chat-group:thread:11" &&
			threadIDs["22"] == "thr_chat-group:thread:22" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected topic conversations to settle, got conversations=%#v threadIDs=%#v", conversations, threadIDs)
		}
		time.Sleep(10 * time.Millisecond)
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
	deadline := time.Now().Add(2 * time.Second)
	for {
		storedConnection, ok = dataStore.GetBotConnection(workspace.ID, connection.ID)
		if !ok {
			t.Fatal("expected polling connection to remain persisted")
		}
		if storedConnection.LastPollAt != nil &&
			storedConnection.LastPollStatus == "success" &&
			strings.Contains(storedConnection.LastPollMessage, "Received 1 message") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected polling runtime state to be recorded, got %#v", storedConnection)
		}
		time.Sleep(10 * time.Millisecond)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastOutboundText != "reply: hello from polling" {
		t.Fatalf("expected polling reply to be persisted, got %q", conversations[0].LastOutboundText)
	}

	logs, err := service.ListConnectionLogs(workspace.ID, connection.ID)
	if err != nil {
		t.Fatalf("ListConnectionLogs() error = %v", err)
	}
	foundStarted := false
	foundSuccess := false
	for _, entry := range logs {
		switch {
		case entry.EventType == "poller_started" && strings.Contains(entry.Message, "polling worker started"):
			foundStarted = true
		case entry.EventType == "poll_success" && strings.Contains(entry.Message, "Received 1 message"):
			foundSuccess = true
		}
	}
	if !foundStarted || !foundSuccess {
		t.Fatalf("expected polling logs to include start and success entries, got %#v", logs)
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

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			conversations[0].ThreadID == "thr_chat-stream-1" &&
			conversations[0].LastOutboundText == "final: hello streaming" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected streaming conversation state to settle, got %#v", conversations)
		}
		time.Sleep(10 * time.Millisecond)
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

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 && conversations[0].LastInboundMessageID == "msg-recover-1" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected recovered inbound message id to be persisted, got %#v", conversations)
		}
		time.Sleep(10 * time.Millisecond)
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

func TestServiceRecoversStoredWeChatReplyMediaWithoutRerunningAI(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	initialProvider := newFakeWeChatProvider()
	initialProvider.pushSendError(errors.New("transient delivery outage"))
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-wechat-recover-1",
			Messages: []OutboundMessage{
				{
					Text: "这里是文件\nMEDIA: E:\\tmp\\handoff.pdf",
				},
			},
		},
	}

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{initialProvider},
		AIBackends:    []AIBackend{backend},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "scripted_ai",
		Secrets: map[string]string{
			"bot_token": "wechat-token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-wechat-recover-1",
		"messageId":"msg-wechat-recover-1",
		"userId":"wechat-user-1",
		"username":"alice",
		"title":"Alice",
		"text":"把文件发回来"
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

	recoveryProvider := newFakeWeChatProvider()
	recoveryService := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{recoveryProvider},
		AIBackends:    []AIBackend{backend},
	})
	recoveryService.Start(context.Background())

	select {
	case sent := <-recoveryProvider.sentCh:
		if len(sent.Messages) != 1 {
			t.Fatalf("expected 1 recovered outbound message, got %#v", sent.Messages)
		}
		if got := sent.Messages[0].Text; got != "这里是文件" {
			t.Fatalf("expected recovered visible text to exclude MEDIA directive, got %#v", sent.Messages[0])
		}
		if len(sent.Messages[0].Media) != 1 {
			t.Fatalf("expected recovered message to include 1 media item, got %#v", sent.Messages[0])
		}
		if got := sent.Messages[0].Media[0]; got.Kind != botMediaKindFile || got.Path != `E:\tmp\handoff.pdf` || got.FileName != "handoff.pdf" {
			t.Fatalf("expected recovered media item to preserve parsed file attachment, got %#v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for stored WeChat reply recovery on start")
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected ai backend to run once across WeChat reply recovery, got %d calls", backend.callCount())
	}
}

func TestExecuteAIReplyStartsWeChatTypingForNonStreamingReplies(t *testing.T) {
	t.Parallel()

	service := &Service{}
	provider := newFakeWeChatProvider()
	backend := newBlockingAIBackend()
	connection := store.BotConnection{
		ID:       "bot-wechat-typing-1",
		Provider: wechatProviderName,
	}
	conversation := store.BotConversation{
		ID:             "conv-wechat-typing-1",
		ExternalChatID: "wechat-user-typing-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-typing-1",
		},
	}
	inbound := InboundMessage{
		ConversationID: "chat-wechat-typing-1",
		Text:           "hello typing",
	}

	type result struct {
		reply AIResult
		err   error
	}
	resultCh := make(chan result, 1)
	go func() {
		reply, _, _, err := service.executeAIReply(context.Background(), provider, backend, connection, conversation, inbound)
		resultCh <- result{reply: reply, err: err}
	}()

	select {
	case <-provider.typingStartedCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for wechat typing to start")
	}

	select {
	case <-backend.started:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for blocking ai backend to start")
	}

	provider.mu.Lock()
	if provider.typingStarts != 1 {
		provider.mu.Unlock()
		t.Fatalf("expected one typing start before backend release, got %d", provider.typingStarts)
	}
	provider.mu.Unlock()

	close(backend.release)

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || !strings.HasPrefix(sent.Messages[0].Text, "reply: hello typing") {
			t.Fatalf("expected final WeChat reply to be sent after typing, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for final WeChat reply send")
	}

	select {
	case <-provider.typingStoppedCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for wechat typing to stop")
	}

	select {
	case got := <-resultCh:
		if got.err != nil {
			t.Fatalf("executeAIReply() error = %v", got.err)
		}
		if got.reply.ThreadID != "thr_chat-wechat-typing-1" {
			t.Fatalf("expected reply thread thr_chat-wechat-typing-1, got %#v", got.reply)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for executeAIReply completion")
	}

	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.typingStops != 1 {
		t.Fatalf("expected one typing stop, got %d", provider.typingStops)
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
		if len(sent.Messages) != 1 || !strings.Contains(sent.Messages[0].Text, "reply: hello") {
			t.Fatalf("expected blocked ai reply after release, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for released ai reply")
	}
}

func TestQuotedWeChatApprovalCommandsBypassBlockedConversationWorker(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_quoted_wechat_1",
			WorkspaceID: workspace.ID,
			ThreadID:    "thr_chat-quoted-wechat",
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
		Provider:  wechatProviderName,
		AIBackend: "blocking_ai",
		Secrets: map[string]string{
			"bot_token": "wechat-token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	sendWebhook := func(text string, messageID string) {
		t.Helper()

		payload, err := json.Marshal(map[string]string{
			"conversationId": "chat-quoted-wechat",
			"messageId":      messageID,
			"userId":         "wechat-user-1",
			"username":       "alice",
			"title":          "Alice",
			"text":           text,
		})
		if err != nil {
			t.Fatalf("json.Marshal() error = %v", err)
		}

		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(string(payload)))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		if result.Accepted != 1 {
			t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
		}
	}

	sendWebhook("hello", "msg-quoted-wechat-1")

	select {
	case <-blockingBackend.started:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for blocking ai backend to start")
	}

	sendWebhook("Quoted: previous message\n/approvals", "msg-quoted-wechat-2")

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 {
			t.Fatalf("expected one quoted WeChat approval response, got %#v", sent.Messages)
		}
		if !strings.Contains(sent.Messages[0].Text, "Pending approvals:") ||
			!strings.Contains(sent.Messages[0].Text, "req_quoted_wechat_1") ||
			!strings.Contains(sent.Messages[0].Text, "/approve req_quoted_wechat_1") {
			t.Fatalf("expected quoted WeChat approval response, got %#v", sent.Messages[0])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for quoted WeChat approval command response")
	}

	close(blockingBackend.release)

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || !strings.Contains(sent.Messages[0].Text, "reply: hello") {
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
	Conversation store.BotConversation
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

func (p *fakeProvider) SendMessages(_ context.Context, connection store.BotConnection, conversation store.BotConversation, messages []OutboundMessage) error {
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
		Conversation: conversation,
		Messages:     append([]OutboundMessage(nil), messages...),
	}
	return nil
}

func (p *fakeProvider) pushSendError(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.errors = append(p.errors, err)
}

type fakeWeChatProvider struct {
	mu              sync.Mutex
	sentCh          chan fakeSentPayload
	errors          []error
	typingStarts    int
	typingStops     int
	typingStartedCh chan struct{}
	typingStoppedCh chan struct{}
}

func newFakeWeChatProvider() *fakeWeChatProvider {
	return &fakeWeChatProvider{
		sentCh:          make(chan fakeSentPayload, 8),
		typingStartedCh: make(chan struct{}, 2),
		typingStoppedCh: make(chan struct{}, 2),
	}
}

func (p *fakeWeChatProvider) Name() string {
	return wechatProviderName
}

func (p *fakeWeChatProvider) Activate(_ context.Context, connection store.BotConnection, publicBaseURL string) (ActivationResult, error) {
	return ActivationResult{
		Settings: map[string]string{
			"webhook_url": strings.TrimRight(publicBaseURL, "/") + "/hooks/bots/" + connection.ID,
		},
		Secrets: map[string]string{
			"webhook_secret": "fake-secret",
		},
	}, nil
}

func (p *fakeWeChatProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakeWeChatProvider) ParseWebhook(r *http.Request, _ store.BotConnection) ([]InboundMessage, error) {
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

func (p *fakeWeChatProvider) SendMessages(_ context.Context, connection store.BotConnection, conversation store.BotConversation, messages []OutboundMessage) error {
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
		Conversation: conversation,
		Messages:     append([]OutboundMessage(nil), messages...),
	}
	return nil
}

func (p *fakeWeChatProvider) StartTyping(
	_ context.Context,
	_ store.BotConnection,
	_ store.BotConversation,
) (TypingSession, error) {
	p.mu.Lock()
	p.typingStarts += 1
	p.mu.Unlock()

	select {
	case p.typingStartedCh <- struct{}{}:
	default:
	}

	return &fakeWeChatTypingSession{provider: p}, nil
}

func (p *fakeWeChatProvider) pushSendError(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.errors = append(p.errors, err)
}

type fakeWeChatTypingSession struct {
	provider *fakeWeChatProvider
	once     sync.Once
}

func (s *fakeWeChatTypingSession) Stop(context.Context) error {
	if s == nil || s.provider == nil {
		return nil
	}

	s.once.Do(func() {
		s.provider.mu.Lock()
		s.provider.typingStops += 1
		s.provider.mu.Unlock()
		select {
		case s.provider.typingStoppedCh <- struct{}{}:
		default:
		}
	})
	return nil
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

type fakeTelegramPollingProvider struct {
	mu         sync.Mutex
	startedIDs []string
}

func newFakeTelegramPollingProvider() *fakeTelegramPollingProvider {
	return &fakeTelegramPollingProvider{}
}

func (p *fakeTelegramPollingProvider) Name() string {
	return telegramProviderName
}

func (p *fakeTelegramPollingProvider) Activate(_ context.Context, connection store.BotConnection, _ string) (ActivationResult, error) {
	return ActivationResult{
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryMode(connection),
		},
	}, nil
}

func (p *fakeTelegramPollingProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakeTelegramPollingProvider) ParseWebhook(*http.Request, store.BotConnection) ([]InboundMessage, error) {
	return nil, ErrWebhookIgnored
}

func (p *fakeTelegramPollingProvider) SendMessages(context.Context, store.BotConnection, store.BotConversation, []OutboundMessage) error {
	return nil
}

func (p *fakeTelegramPollingProvider) SupportsPolling(connection store.BotConnection) bool {
	return telegramDeliveryMode(connection) == telegramDeliveryModePolling
}

func (p *fakeTelegramPollingProvider) PollingOwnerKey(connection store.BotConnection) string {
	if telegramDeliveryMode(connection) != telegramDeliveryModePolling {
		return ""
	}
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return ""
	}
	return telegramProviderName + ":" + token
}

func (p *fakeTelegramPollingProvider) PollingConflictError(ownerConnectionID string) error {
	return telegramPollingConflictError(ownerConnectionID)
}

func (p *fakeTelegramPollingProvider) RunPolling(
	ctx context.Context,
	connection store.BotConnection,
	_ PollingMessageHandler,
	_ PollingSettingsHandler,
	_ PollingEventHandler,
) error {
	p.mu.Lock()
	p.startedIDs = append(p.startedIDs, connection.ID)
	p.mu.Unlock()

	<-ctx.Done()
	return ctx.Err()
}

func (p *fakeTelegramPollingProvider) startedCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.startedIDs)
}

func (p *fakeTelegramPollingProvider) startedConnectionIDs() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.startedIDs...)
}

type fakeWeChatPollingProvider struct {
	mu         sync.Mutex
	startedIDs []string
}

func newFakeWeChatPollingProvider() *fakeWeChatPollingProvider {
	return &fakeWeChatPollingProvider{}
}

func (p *fakeWeChatPollingProvider) Name() string {
	return wechatProviderName
}

func (p *fakeWeChatPollingProvider) Activate(_ context.Context, connection store.BotConnection, _ string) (ActivationResult, error) {
	settings := cloneStringMapLocal(connection.Settings)
	if settings == nil {
		settings = make(map[string]string)
	}
	settings[wechatDeliveryModeSetting] = wechatDeliveryModePolling
	return ActivationResult{Settings: settings}, nil
}

func (p *fakeWeChatPollingProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakeWeChatPollingProvider) ParseWebhook(*http.Request, store.BotConnection) ([]InboundMessage, error) {
	return nil, ErrWebhookIgnored
}

func (p *fakeWeChatPollingProvider) SendMessages(context.Context, store.BotConnection, store.BotConversation, []OutboundMessage) error {
	return nil
}

func (p *fakeWeChatPollingProvider) SupportsPolling(connection store.BotConnection) bool {
	mode, err := parseWeChatDeliveryMode(connection.Settings[wechatDeliveryModeSetting])
	return err == nil && mode == wechatDeliveryModePolling
}

func (p *fakeWeChatPollingProvider) PollingOwnerKey(connection store.BotConnection) string {
	mode, err := parseWeChatDeliveryMode(connection.Settings[wechatDeliveryModeSetting])
	if err != nil || mode != wechatDeliveryModePolling {
		return ""
	}
	accountID := strings.TrimSpace(connection.Settings[wechatAccountIDSetting])
	if accountID != "" {
		return wechatProviderName + ":" + accountID
	}
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return ""
	}
	return wechatProviderName + ":" + token
}

func (p *fakeWeChatPollingProvider) PollingConflictError(ownerConnectionID string) error {
	return (&wechatProvider{}).PollingConflictError(ownerConnectionID)
}

func (p *fakeWeChatPollingProvider) RunPolling(
	ctx context.Context,
	connection store.BotConnection,
	_ PollingMessageHandler,
	_ PollingSettingsHandler,
	_ PollingEventHandler,
) error {
	p.mu.Lock()
	p.startedIDs = append(p.startedIDs, connection.ID)
	p.mu.Unlock()

	<-ctx.Done()
	return ctx.Err()
}

func (p *fakeWeChatPollingProvider) startedCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.startedIDs)
}

func (p *fakeWeChatPollingProvider) startedConnectionIDs() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.startedIDs...)
}

type fakeBotThreads struct {
	mu      sync.Mutex
	nextID  int
	details map[string]store.ThreadDetail
}

func newFakeBotThreads() *fakeBotThreads {
	return &fakeBotThreads{
		details: make(map[string]store.ThreadDetail),
	}
}

func (f *fakeBotThreads) Create(_ context.Context, workspaceID string, input threads.CreateInput) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.nextID += 1
	threadID := fmt.Sprintf("thread-bot-%d", f.nextID)
	now := time.Date(2026, time.March, 28, 12, f.nextID, 0, 0, time.UTC)
	thread := store.Thread{
		ID:          threadID,
		WorkspaceID: workspaceID,
		Name:        input.Name,
		Status:      "idle",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	f.details[threadID] = store.ThreadDetail{
		Thread: thread,
		Turns:  []store.ThreadTurn{},
	}
	return thread, nil
}

func (f *fakeBotThreads) GetDetail(_ context.Context, _ string, threadID string) (store.ThreadDetail, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok {
		return store.ThreadDetail{}, store.ErrThreadNotFound
	}
	return cloneThreadDetailForTest(detail), nil
}

func (f *fakeBotThreads) GetTurn(_ context.Context, _ string, threadID string, turnID string, _ string) (store.ThreadTurn, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok {
		return store.ThreadTurn{}, store.ErrThreadNotFound
	}
	for _, turn := range detail.Turns {
		if turn.ID == turnID {
			return cloneThreadDetailForTest(store.ThreadDetail{Turns: []store.ThreadTurn{turn}}).Turns[0], nil
		}
	}
	return store.ThreadTurn{}, store.ErrThreadNotFound
}

func (f *fakeBotThreads) Rename(_ context.Context, _ string, threadID string, name string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok {
		return store.Thread{}, store.ErrThreadNotFound
	}
	detail.Thread.Name = strings.TrimSpace(name)
	detail.Thread.UpdatedAt = detail.Thread.UpdatedAt.Add(15 * time.Second)
	f.details[threadID] = detail
	return detail.Thread, nil
}

func (f *fakeBotThreads) Archive(_ context.Context, _ string, threadID string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok {
		return store.Thread{}, store.ErrThreadNotFound
	}
	detail.Thread.Archived = true
	detail.Thread.UpdatedAt = detail.Thread.UpdatedAt.Add(15 * time.Second)
	f.details[threadID] = detail
	return detail.Thread, nil
}

func (f *fakeBotThreads) Unarchive(_ context.Context, _ string, threadID string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok {
		return store.Thread{}, store.ErrThreadNotFound
	}
	detail.Thread.Archived = false
	detail.Thread.UpdatedAt = detail.Thread.UpdatedAt.Add(15 * time.Second)
	f.details[threadID] = detail
	return detail.Thread, nil
}

func (f *fakeBotThreads) setCompletedTurn(threadID string, turn store.ThreadTurn) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail := f.details[threadID]
	replaced := false
	for index, existing := range detail.Turns {
		if existing.ID == turn.ID {
			detail.Turns[index] = turn
			replaced = true
			break
		}
	}
	if !replaced {
		detail.Turns = append(detail.Turns, turn)
	}
	for _, item := range turn.Items {
		if strings.TrimSpace(stringValue(item["type"])) != "agentMessage" {
			continue
		}
		if text := strings.TrimSpace(stringValue(item["text"])); text != "" {
			detail.Preview = text
			break
		}
	}
	detail.Thread.UpdatedAt = detail.Thread.UpdatedAt.Add(30 * time.Second)
	f.details[threadID] = detail
}

type fakeBotTurns struct {
	mu      sync.Mutex
	threads *fakeBotThreads
	calls   []string
}

func (f *fakeBotTurns) Start(_ context.Context, _ string, threadID string, input string, _ turns.StartOptions) (turns.Result, error) {
	f.mu.Lock()
	callIndex := len(f.calls) + 1
	f.calls = append(f.calls, threadID)
	f.mu.Unlock()

	turnID := fmt.Sprintf("turn-bot-%d", callIndex)
	f.threads.setCompletedTurn(threadID, store.ThreadTurn{
		ID:     turnID,
		Status: "completed",
		Items: []map[string]any{
			{
				"id":   "assistant-" + turnID,
				"type": "agentMessage",
				"text": "reply: " + input,
			},
		},
	})
	return turns.Result{
		TurnID: turnID,
		Status: "completed",
	}, nil
}

func (f *fakeBotTurns) threadCalls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
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

type scriptedAIBackend struct {
	mu          sync.Mutex
	calls       int
	lastInbound InboundMessage
	result      AIResult
	err         error
}

func (*scriptedAIBackend) Name() string {
	return "scripted_ai"
}

func (b *scriptedAIBackend) ProcessMessage(_ context.Context, _ store.BotConnection, _ store.BotConversation, inbound InboundMessage) (AIResult, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.calls += 1
	b.lastInbound = cloneInboundMessageForTest(inbound)
	if b.err != nil {
		return AIResult{}, b.err
	}
	return cloneAIResultForTest(b.result), nil
}

func (b *scriptedAIBackend) callCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.calls
}

func (b *scriptedAIBackend) lastInboundMessage() InboundMessage {
	b.mu.Lock()
	defer b.mu.Unlock()
	return cloneInboundMessageForTest(b.lastInbound)
}

func cloneInboundMessageForTest(message InboundMessage) InboundMessage {
	next := message
	next.Media = cloneBotMessageMediaList(message.Media)
	next.ProviderData = cloneStringMapLocal(message.ProviderData)
	return next
}

func cloneAIResultForTest(result AIResult) AIResult {
	next := result
	next.Messages = cloneOutboundMessages(result.Messages)
	next.BackendState = cloneStringMapLocal(result.BackendState)
	return next
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

func (p *fakePollingProvider) SendMessages(_ context.Context, connection store.BotConnection, conversation store.BotConversation, messages []OutboundMessage) error {
	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Conversation: conversation,
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
	reportEvent PollingEventHandler,
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
		if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
			EventType:      "poll_success",
			Message:        "Poll completed successfully. Received 1 message and updated the cursor.",
			ReceivedCount:  1,
			ProcessedCount: 1,
		}); err != nil {
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

func (p *fakeScriptedPollingProvider) SendMessages(_ context.Context, connection store.BotConnection, conversation store.BotConversation, messages []OutboundMessage) error {
	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Conversation: conversation,
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
	reportEvent PollingEventHandler,
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
		if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
			EventType:      "poll_success",
			Message:        fmt.Sprintf("Poll completed successfully. Received %d scripted message(s).", len(messages)),
			ReceivedCount:  len(messages),
			ProcessedCount: len(messages),
		}); err != nil {
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

func (p *fakeStreamingProvider) SendMessages(_ context.Context, connection store.BotConnection, conversation store.BotConversation, messages []OutboundMessage) error {
	p.mu.Lock()
	p.sendMessagesCalls += 1
	p.mu.Unlock()
	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Conversation: conversation,
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
