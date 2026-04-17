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
	"codex-server/backend/internal/events"
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

func TestServiceCreatesBotAndBotScopedConnectionWithoutRenamingBot(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	bot, err := service.CreateBot(workspace.ID, CreateBotInput{
		Name:        "Ops Bot",
		Description: "Primary support bot",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}

	connection, err := service.CreateConnectionForBot(context.Background(), workspace.ID, bot.ID, CreateConnectionInput{
		Provider:  "fakechat",
		Name:      "Telegram Endpoint",
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnectionForBot() error = %v", err)
	}

	if connection.BotID != bot.ID {
		t.Fatalf("expected connection bot id %q, got %#v", bot.ID, connection)
	}

	storedBot, ok := dataStore.GetBot(workspace.ID, bot.ID)
	if !ok {
		t.Fatal("expected bot to remain persisted")
	}
	if storedBot.Name != "Ops Bot" {
		t.Fatalf("expected bot name to stay %q, got %#v", "Ops Bot", storedBot)
	}
	if storedBot.DefaultBindingID == "" {
		t.Fatalf("expected default binding to be provisioned, got %#v", storedBot)
	}
	if bot.Scope != "workspace" || bot.SharingMode != "owner_only" {
		t.Fatalf("expected default workspace owner-only bot policy, got %#v", bot)
	}
}

func TestServiceCreatesBotWithGlobalSelectedWorkspaceSharing(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	ownerWorkspace := dataStore.CreateWorkspace("Owner Workspace", "E:/projects/owner")
	sharedWorkspace := dataStore.CreateWorkspace("Shared Workspace", "E:/projects/shared")
	dataStore.CreateWorkspace("Unshared Workspace", "E:/projects/unshared")

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	bot, err := service.CreateBot(ownerWorkspace.ID, CreateBotInput{
		Name:               "Global Ops Bot",
		Scope:              "global",
		SharingMode:        "selected_workspaces",
		SharedWorkspaceIDs: []string{sharedWorkspace.ID, ownerWorkspace.ID, sharedWorkspace.ID},
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}

	if bot.Scope != "global" || bot.SharingMode != "selected_workspaces" {
		t.Fatalf("expected global selected-workspace policy, got %#v", bot)
	}
	if len(bot.SharedWorkspaceIDs) != 1 || bot.SharedWorkspaceIDs[0] != sharedWorkspace.ID {
		t.Fatalf("expected normalized shared workspace ids, got %#v", bot.SharedWorkspaceIDs)
	}
}

func TestServiceUpdatesBotAccessPolicyAndMetadata(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	ownerWorkspace := dataStore.CreateWorkspace("Owner Workspace", "E:/projects/owner")
	sharedWorkspace := dataStore.CreateWorkspace("Shared Workspace", "E:/projects/shared")

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	bot, err := service.CreateBot(ownerWorkspace.ID, CreateBotInput{
		Name:        "Ops Bot",
		Description: "Initial description",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}

	updated, err := service.UpdateBot(ownerWorkspace.ID, bot.ID, UpdateBotInput{
		Name:               "Shared Ops Bot",
		Description:        "Shared across workspaces",
		Scope:              "global",
		SharingMode:        "selected_workspaces",
		SharedWorkspaceIDs: []string{sharedWorkspace.ID, ownerWorkspace.ID, sharedWorkspace.ID},
	})
	if err != nil {
		t.Fatalf("UpdateBot() error = %v", err)
	}

	if updated.Name != "Shared Ops Bot" || updated.Description != "Shared across workspaces" {
		t.Fatalf("expected updated metadata, got %#v", updated)
	}
	if updated.Scope != "global" || updated.SharingMode != "selected_workspaces" {
		t.Fatalf("expected updated access policy, got %#v", updated)
	}
	if len(updated.SharedWorkspaceIDs) != 1 || updated.SharedWorkspaceIDs[0] != sharedWorkspace.ID {
		t.Fatalf("expected normalized shared workspace ids, got %#v", updated.SharedWorkspaceIDs)
	}

	storedBot, ok := dataStore.GetBot(ownerWorkspace.ID, bot.ID)
	if !ok {
		t.Fatal("expected updated bot to remain persisted")
	}
	if storedBot.WorkspaceID != ownerWorkspace.ID {
		t.Fatalf("expected owner workspace to remain unchanged, got %#v", storedBot)
	}

	availableBots, err := service.ListAvailableBots(sharedWorkspace.ID)
	if err != nil {
		t.Fatalf("ListAvailableBots() error = %v", err)
	}
	if len(availableBots) != 1 || availableBots[0].ID != bot.ID {
		t.Fatalf("expected updated bot to become available to shared workspace, got %#v", availableBots)
	}
}

func TestServiceUpdateBotPreservesExistingSharingPolicyWhenFieldsOmitted(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	ownerWorkspace := dataStore.CreateWorkspace("Owner Workspace", "E:/projects/owner")
	sharedWorkspace := dataStore.CreateWorkspace("Shared Workspace", "E:/projects/shared")

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	bot, err := service.CreateBot(ownerWorkspace.ID, CreateBotInput{
		Name:               "Shared Bot",
		Scope:              "global",
		SharingMode:        "selected_workspaces",
		SharedWorkspaceIDs: []string{sharedWorkspace.ID},
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}

	updated, err := service.UpdateBot(ownerWorkspace.ID, bot.ID, UpdateBotInput{
		Name:        "Renamed Shared Bot",
		Description: "Updated description",
	})
	if err != nil {
		t.Fatalf("UpdateBot() error = %v", err)
	}

	if updated.Scope != "global" || updated.SharingMode != "selected_workspaces" {
		t.Fatalf("expected existing access policy to remain unchanged, got %#v", updated)
	}
	if len(updated.SharedWorkspaceIDs) != 1 || updated.SharedWorkspaceIDs[0] != sharedWorkspace.ID {
		t.Fatalf("expected shared workspace ids to remain unchanged, got %#v", updated.SharedWorkspaceIDs)
	}
}

func TestServiceListsAvailableBotsAndTargetsAcrossWorkspaces(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	ownerWorkspace := dataStore.CreateWorkspace("Owner Workspace", "E:/projects/owner")
	consumerWorkspace := dataStore.CreateWorkspace("Consumer Workspace", "E:/projects/consumer")
	otherWorkspace := dataStore.CreateWorkspace("Other Workspace", "E:/projects/other")

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	sharedBot, err := service.CreateBot(ownerWorkspace.ID, CreateBotInput{
		Name:               "Shared Bot",
		Scope:              "global",
		SharingMode:        "selected_workspaces",
		SharedWorkspaceIDs: []string{consumerWorkspace.ID},
	})
	if err != nil {
		t.Fatalf("CreateBot(shared) error = %v", err)
	}
	privateBot, err := service.CreateBot(ownerWorkspace.ID, CreateBotInput{
		Name: "Private Bot",
	})
	if err != nil {
		t.Fatalf("CreateBot(private) error = %v", err)
	}

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: ownerWorkspace.ID,
		BotID:       sharedBot.ID,
		Provider:    "fakechat",
		Name:        "Shared Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:  ownerWorkspace.ID,
		BotID:        sharedBot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "conversation",
		RouteKey:     "shared-route",
		Title:        "Shared Route",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	availableBots, err := service.ListAvailableBots(consumerWorkspace.ID)
	if err != nil {
		t.Fatalf("ListAvailableBots() error = %v", err)
	}
	if len(availableBots) != 1 || availableBots[0].ID != sharedBot.ID {
		t.Fatalf("expected only shared bot for consumer workspace, got %#v", availableBots)
	}

	availableTargets, err := service.ListAvailableDeliveryTargets(consumerWorkspace.ID, "")
	if err != nil {
		t.Fatalf("ListAvailableDeliveryTargets() error = %v", err)
	}
	if len(availableTargets) != 1 || availableTargets[0].ID != target.ID {
		t.Fatalf("expected shared delivery target for consumer workspace, got %#v", availableTargets)
	}

	otherBots, err := service.ListAvailableBots(otherWorkspace.ID)
	if err != nil {
		t.Fatalf("ListAvailableBots(other) error = %v", err)
	}
	for _, bot := range otherBots {
		if bot.ID == sharedBot.ID || bot.ID == privateBot.ID {
			t.Fatalf("expected no shared bots for other workspace, got %#v", otherBots)
		}
	}
}

func TestUpsertThreadBotBindingRejectsInaccessibleCrossWorkspaceBot(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	threadWorkspace := dataStore.CreateWorkspace("Thread Workspace", "E:/projects/thread")
	botWorkspace := dataStore.CreateWorkspace("Bot Workspace", "E:/projects/bot")

	dataStore.UpsertThread(store.Thread{
		ID:           "thr_inaccessible_bot",
		WorkspaceID:  threadWorkspace.ID,
		Cwd:          "E:/projects/thread",
		Materialized: true,
		Name:         "Thread",
		Status:       "idle",
	})

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	privateBot, err := service.CreateBot(botWorkspace.ID, CreateBotInput{
		Name: "Private Bot",
	})
	if err != nil {
		t.Fatalf("CreateBot() error = %v", err)
	}
	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: botWorkspace.ID,
		BotID:       privateBot.ID,
		Provider:    "fakechat",
		Name:        "Private Endpoint",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:  botWorkspace.ID,
		BotID:        privateBot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "conversation",
		RouteKey:     "private-route",
		Title:        "Private Route",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	_, err = service.UpsertThreadBotBinding(context.Background(), threadWorkspace.ID, "thr_inaccessible_bot", UpsertThreadBotBindingInput{
		BotWorkspaceID:   botWorkspace.ID,
		BotID:            privateBot.ID,
		DeliveryTargetID: target.ID,
	})
	if !errors.Is(err, store.ErrBotNotFound) {
		t.Fatalf("expected ErrBotNotFound for inaccessible bot, got %v", err)
	}
}

func TestUpsertDeliveryTargetForSessionBackedSession(t *testing.T) {
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
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspace.ID,
		BotID:                  connection.BotID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-1",
		ExternalChatID:         "chat-1",
		ExternalThreadID:       "topic-9",
		ExternalTitle:          "Ops Room",
		ThreadID:               "thr_chat-1",
		ProviderState: map[string]string{
			"source": "session",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		SessionID: conversation.ID,
		Labels:    []string{" ops ", "", "vip"},
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget() error = %v", err)
	}

	if target.EndpointID != connection.ID {
		t.Fatalf("expected endpoint id %q, got %#v", connection.ID, target)
	}
	if target.SessionID != conversation.ID {
		t.Fatalf("expected session id %q, got %#v", conversation.ID, target)
	}
	if target.TargetType != "session_backed" {
		t.Fatalf("expected session_backed target, got %#v", target)
	}
	if target.RouteType != "thread" || target.RouteKey != "conversation:chat-1:thread:topic-9" {
		t.Fatalf("expected canonical thread route, got %#v", target)
	}
	if len(target.Labels) != 2 || target.Labels[0] != "ops" || target.Labels[1] != "vip" {
		t.Fatalf("expected normalized labels, got %#v", target.Labels)
	}

	updated, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		SessionID: conversation.ID,
		Title:     "Updated Session Target",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget(update) error = %v", err)
	}
	if updated.ID != target.ID {
		t.Fatalf("expected upsert to reuse target id %q, got %#v", target.ID, updated)
	}
	if updated.Title != "Updated Session Target" {
		t.Fatalf("expected title update, got %#v", updated)
	}

	targets, err := service.ListDeliveryTargets(workspace.ID, connection.BotID)
	if err != nil {
		t.Fatalf("ListDeliveryTargets() error = %v", err)
	}
	if len(targets) != 1 {
		t.Fatalf("expected exactly 1 delivery target after upsert, got %#v", targets)
	}
}

func TestSendSessionOutboundMessagesCreatesDeliveredRecordAndIsIdempotent(t *testing.T) {
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

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspace.ID,
		BotID:                  connection.BotID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-proactive-1",
		ExternalChatID:         "chat-proactive-1",
		ExternalTitle:          "Alice",
		ThreadID:               "thr_chat-proactive-1",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	delivery, err := service.SendSessionOutboundMessages(context.Background(), workspace.ID, connection.BotID, conversation.ID, SendOutboundMessagesInput{
		SourceType:     "manual",
		IdempotencyKey: "manual:1",
		Messages: []store.BotReplyMessage{
			{Text: "Hello proactive"},
		},
	})
	if err != nil {
		t.Fatalf("SendSessionOutboundMessages() error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected connection id %q, got %#v", connection.ID, sent)
		}
		if sent.Conversation.ID != conversation.ID || sent.Conversation.ExternalChatID != "chat-proactive-1" {
			t.Fatalf("expected stored conversation route, got %#v", sent.Conversation)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "Hello proactive" {
			t.Fatalf("expected proactive message payload, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for proactive outbound send")
	}

	if delivery.Status != "delivered" || delivery.SessionID != conversation.ID || delivery.SourceType != "manual" {
		t.Fatalf("expected delivered outbound delivery view, got %#v", delivery)
	}

	deliveries := dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
		BotID:          connection.BotID,
		ConversationID: conversation.ID,
	})
	if len(deliveries) != 1 {
		t.Fatalf("expected one stored outbound delivery, got %#v", deliveries)
	}
	if deliveries[0].Status != "delivered" || deliveries[0].AttemptCount != 1 {
		t.Fatalf("expected delivered stored outbound delivery, got %#v", deliveries[0])
	}

	updatedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatal("expected updated conversation after proactive send")
	}
	if updatedConversation.LastOutboundText != "Hello proactive" ||
		updatedConversation.LastOutboundDeliveryStatus != "delivered" ||
		updatedConversation.LastOutboundDeliveryAttemptCount != 1 {
		t.Fatalf("expected conversation outbound summary to update, got %#v", updatedConversation)
	}

	redelivery, err := service.SendSessionOutboundMessages(context.Background(), workspace.ID, connection.BotID, conversation.ID, SendOutboundMessagesInput{
		SourceType:     "manual",
		IdempotencyKey: "manual:1",
		Messages: []store.BotReplyMessage{
			{Text: "Hello proactive"},
		},
	})
	if err != nil {
		t.Fatalf("SendSessionOutboundMessages(idempotent) error = %v", err)
	}
	if redelivery.ID != delivery.ID {
		t.Fatalf("expected idempotent send to return existing delivery %q, got %#v", delivery.ID, redelivery)
	}

	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected idempotent send to avoid duplicate provider call, got %#v", sent)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestSendDeliveryTargetOutboundMessagesUsesSyntheticRoute(t *testing.T) {
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

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_topic",
		RouteKey:   "chat:998877:thread:42",
		Title:      "Ops Topic",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget(route_backed) error = %v", err)
	}

	delivery, err := service.SendDeliveryTargetOutboundMessages(context.Background(), workspace.ID, connection.BotID, target.ID, SendOutboundMessagesInput{
		SourceType: "manual",
		Messages: []store.BotReplyMessage{
			{Text: "Topic hello"},
		},
	})
	if err != nil {
		t.Fatalf("SendDeliveryTargetOutboundMessages() error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		if sent.Conversation.ExternalChatID != "998877" {
			t.Fatalf("expected synthetic chat id 998877, got %#v", sent.Conversation)
		}
		if sent.Conversation.ExternalThreadID != "42" {
			t.Fatalf("expected synthetic thread id 42, got %#v", sent.Conversation)
		}
		if sent.Conversation.ExternalConversationID != "998877:thread:42" {
			t.Fatalf("expected canonical telegram conversation id, got %#v", sent.Conversation)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for route-backed outbound send")
	}

	if delivery.Status != "delivered" || delivery.SessionID != "" || delivery.DeliveryTargetID != target.ID {
		t.Fatalf("expected delivered route-backed delivery, got %#v", delivery)
	}
}

func TestNotificationTriggerDispatchesOutboundDeliveryExactlyOnce(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	eventHub := events.NewHub()
	provider := newFakeProvider()
	service := NewService(dataStore, nil, nil, eventHub, Config{
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

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_chat",
		RouteKey:   "chat:notify-1",
		Title:      "Notify Chat",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget() error = %v", err)
	}

	trigger, err := service.CreateTrigger(context.Background(), workspace.ID, connection.BotID, UpsertBotTriggerInput{
		DeliveryTargetID: target.ID,
		Filter: map[string]string{
			"kind":  "automation_run_completed",
			"level": "success",
		},
	})
	if err != nil {
		t.Fatalf("CreateTrigger() error = %v", err)
	}

	eventPayload := map[string]any{
		"notificationId": "ntf_001",
		"kind":           "automation_run_completed",
		"title":          "Automation completed",
		"message":        "Daily Sync completed successfully.",
		"level":          "success",
	}
	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		Method:      "notification/created",
		Payload:     eventPayload,
	})
	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		Method:      "notification/created",
		Payload:     eventPayload,
	})

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected connection id %q, got %#v", connection.ID, sent)
		}
		if sent.Conversation.ExternalChatID != "notify-1" {
			t.Fatalf("expected route-backed chat id notify-1, got %#v", sent.Conversation)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "Automation completed\nDaily Sync completed successfully." {
			t.Fatalf("expected notification payload text, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for notification trigger outbound send")
	}

	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected idempotent notification trigger to avoid duplicate send, got %#v", sent)
	case <-time.After(300 * time.Millisecond):
	}

	deliveries := dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
		BotID:         connection.BotID,
		SourceType:    "notification",
		SourceRefType: "notification",
		SourceRefID:   "ntf_001",
	})
	if len(deliveries) != 1 {
		t.Fatalf("expected exactly 1 notification outbound delivery, got %#v", deliveries)
	}
	if deliveries[0].TriggerID != trigger.ID ||
		deliveries[0].DeliveryTargetID != target.ID ||
		deliveries[0].Status != "delivered" ||
		deliveries[0].IdempotencyKey != "notification:ntf_001:trigger:"+trigger.ID {
		t.Fatalf("unexpected notification outbound delivery: %#v", deliveries[0])
	}
}

func TestThreadBoundTurnCompletionDispatchesOutboundDeliveryExactlyOnce(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	threadsExec := newFakeBotThreads()
	eventHub := events.NewHub()
	provider := newFakeProvider()
	service := NewService(dataStore, threadsExec, nil, eventHub, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
	})
	service.Start(context.Background())

	thread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Bound Thread"})
	if err != nil {
		t.Fatalf("Create(thread) error = %v", err)
	}
	dataStore.UpsertThread(thread)

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider: "fakechat",
		Name:     "Ops Endpoint",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_chat",
		RouteKey:   "chat:thread-bound",
		Title:      "Bound Chat",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget() error = %v", err)
	}

	binding, err := service.UpsertThreadBotBinding(context.Background(), workspace.ID, thread.ID, UpsertThreadBotBindingInput{
		BotID:            connection.BotID,
		DeliveryTargetID: target.ID,
	})
	if err != nil {
		t.Fatalf("UpsertThreadBotBinding() error = %v", err)
	}
	if binding.SessionID == "" {
		t.Fatal("expected thread binding to create a backing session")
	}
	conversation, ok := dataStore.GetBotConversation(workspace.ID, binding.SessionID)
	if !ok {
		t.Fatalf("expected backing session %q to be created", binding.SessionID)
	}
	if strings.TrimSpace(conversation.ThreadID) != thread.ID {
		t.Fatalf("expected backing session to bind thread %q, got %#v", thread.ID, conversation)
	}

	const turnID = "turn-thread-bound-1"
	threadsExec.setCompletedTurn(thread.ID, store.ThreadTurn{
		ID:     turnID,
		Status: "completed",
		Items: []map[string]any{
			{
				"id":   "assistant-thread-bound-1",
				"type": "agentMessage",
				"text": "Thread binding final reply",
			},
		},
	})

	if err := service.RegisterThreadBoundTurn(workspace.ID, thread.ID, turnID); err != nil {
		t.Fatalf("RegisterThreadBoundTurn() error = %v", err)
	}

	event := store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    thread.ID,
		TurnID:      turnID,
		Method:      "turn/completed",
	}
	eventHub.Publish(event)
	eventHub.Publish(event)

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected connection id %q, got %#v", connection.ID, sent)
		}
		if sent.Conversation.ExternalChatID != "thread-bound" ||
			sent.Conversation.ExternalConversationID != "thread-bound" {
			t.Fatalf("expected route-backed delivery conversation, got %#v", sent.Conversation)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "Thread binding final reply" {
			t.Fatalf("expected final assistant reply to be delivered, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for thread-bound outbound send")
	}

	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected duplicate turn/completed event to avoid duplicate send, got %#v", sent)
	case <-time.After(300 * time.Millisecond):
	}

	deliveries := dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
		BotID:         connection.BotID,
		SourceType:    "thread_binding",
		SourceRefType: "thread_turn",
		SourceRefID:   turnID,
	})
	if len(deliveries) != 1 {
		t.Fatalf("expected exactly 1 thread binding outbound delivery, got %#v", deliveries)
	}
	if deliveries[0].DeliveryTargetID != target.ID ||
		deliveries[0].OriginWorkspaceID != workspace.ID ||
		deliveries[0].OriginThreadID != thread.ID ||
		deliveries[0].OriginTurnID != turnID ||
		deliveries[0].Status != "delivered" ||
		deliveries[0].AttemptCount != 1 ||
		deliveries[0].IdempotencyKey != "thread-binding:"+binding.ID+":"+thread.ID+":"+turnID {
		t.Fatalf("unexpected thread binding outbound delivery: %#v", deliveries[0])
	}
	if len(deliveries[0].Messages) != 1 || deliveries[0].Messages[0].Text != "Thread binding final reply" {
		t.Fatalf("expected stored delivery payload to match reply, got %#v", deliveries[0].Messages)
	}
}

func TestCrossWorkspaceThreadBoundTurnCompletionDispatchesOutboundDeliveryExactlyOnce(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	threadWorkspace := dataStore.CreateWorkspace("Thread Workspace", "E:/projects/thread")
	botWorkspace := dataStore.CreateWorkspace("Bot Workspace", "E:/projects/bot")
	threadsExec := newFakeBotThreads()
	eventHub := events.NewHub()
	provider := newFakeProvider()
	service := NewService(dataStore, threadsExec, nil, eventHub, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
	})
	service.Start(context.Background())

	thread, err := threadsExec.Create(context.Background(), threadWorkspace.ID, threads.CreateInput{Name: "Cross Workspace Thread"})
	if err != nil {
		t.Fatalf("Create(thread) error = %v", err)
	}
	dataStore.UpsertThread(thread)

	connection, err := service.CreateConnection(context.Background(), botWorkspace.ID, CreateConnectionInput{
		Provider: "fakechat",
		Name:     "Ops Endpoint",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}
	if _, err := dataStore.UpdateBot(botWorkspace.ID, connection.BotID, func(current store.Bot) store.Bot {
		current.Scope = "global"
		current.SharingMode = "selected_workspaces"
		current.SharedWorkspaceIDs = []string{threadWorkspace.ID}
		return current
	}); err != nil {
		t.Fatalf("UpdateBot() error = %v", err)
	}

	target, err := service.UpsertDeliveryTarget(context.Background(), botWorkspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_chat",
		RouteKey:   "chat:thread-bound-cross-workspace",
		Title:      "Bound Chat",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget() error = %v", err)
	}

	binding, err := service.UpsertThreadBotBinding(context.Background(), threadWorkspace.ID, thread.ID, UpsertThreadBotBindingInput{
		BotWorkspaceID:   botWorkspace.ID,
		BotID:            connection.BotID,
		DeliveryTargetID: target.ID,
	})
	if err != nil {
		t.Fatalf("UpsertThreadBotBinding() error = %v", err)
	}
	if binding.BotWorkspaceID != botWorkspace.ID {
		t.Fatalf("expected bot workspace id %q, got %#v", botWorkspace.ID, binding)
	}
	if binding.SessionID == "" {
		t.Fatal("expected cross-workspace thread binding to create a backing session")
	}
	conversation, ok := dataStore.GetBotConversation(botWorkspace.ID, binding.SessionID)
	if !ok {
		t.Fatalf("expected backing session %q to be created in bot workspace", binding.SessionID)
	}
	if strings.TrimSpace(conversation.ThreadID) != thread.ID {
		t.Fatalf("expected backing session to bind thread %q, got %#v", thread.ID, conversation)
	}

	const turnID = "turn-thread-bound-cross-workspace-1"
	threadsExec.setCompletedTurn(thread.ID, store.ThreadTurn{
		ID:     turnID,
		Status: "completed",
		Items: []map[string]any{
			{
				"id":   "assistant-thread-bound-cross-workspace-1",
				"type": "agentMessage",
				"text": "Cross-workspace thread binding final reply",
			},
		},
	})

	if err := service.RegisterThreadBoundTurn(threadWorkspace.ID, thread.ID, turnID); err != nil {
		t.Fatalf("RegisterThreadBoundTurn() error = %v", err)
	}

	event := store.EventEnvelope{
		WorkspaceID: threadWorkspace.ID,
		ThreadID:    thread.ID,
		TurnID:      turnID,
		Method:      "turn/completed",
	}
	eventHub.Publish(event)
	eventHub.Publish(event)

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected connection id %q, got %#v", connection.ID, sent)
		}
		if sent.Conversation.ExternalChatID != "thread-bound-cross-workspace" ||
			sent.Conversation.ExternalConversationID != "thread-bound-cross-workspace" {
			t.Fatalf("expected route-backed delivery conversation, got %#v", sent.Conversation)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "Cross-workspace thread binding final reply" {
			t.Fatalf("expected final assistant reply to be delivered, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for cross-workspace thread-bound outbound send")
	}

	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected duplicate turn/completed event to avoid duplicate send, got %#v", sent)
	case <-time.After(300 * time.Millisecond):
	}

	deliveries := dataStore.ListBotOutboundDeliveries(botWorkspace.ID, store.BotOutboundDeliveryFilter{
		BotID:         connection.BotID,
		SourceType:    "thread_binding",
		SourceRefType: "thread_turn",
		SourceRefID:   turnID,
	})
	if len(deliveries) != 1 {
		t.Fatalf("expected exactly 1 cross-workspace thread binding outbound delivery, got %#v", deliveries)
	}
	if deliveries[0].DeliveryTargetID != target.ID ||
		deliveries[0].OriginWorkspaceID != threadWorkspace.ID ||
		deliveries[0].OriginThreadID != thread.ID ||
		deliveries[0].OriginTurnID != turnID ||
		deliveries[0].Status != "delivered" ||
		deliveries[0].AttemptCount != 1 ||
		deliveries[0].IdempotencyKey != "thread-binding:"+binding.ID+":"+thread.ID+":"+turnID {
		t.Fatalf("unexpected cross-workspace thread binding outbound delivery: %#v", deliveries[0])
	}
	if len(deliveries[0].Messages) != 1 || deliveries[0].Messages[0].Text != "Cross-workspace thread binding final reply" {
		t.Fatalf("expected stored delivery payload to match reply, got %#v", deliveries[0].Messages)
	}
}

func TestManagedTriggerCreatePersistsNotificationCenterSubscription(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	eventHub := events.NewHub()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}
	provider := newFakeProvider()

	botService := NewService(dataStore, threadsExec, turnsExec, eventHub, Config{
		PublicBaseURL:                     "https://bots.example.com",
		Providers:                         []Provider{provider},
		AIBackends:                        []AIBackend{fakeAIBackend{}},
		NotificationCenterManagedTriggers: true,
	})
	botService.Start(context.Background())

	connection, err := botService.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	target, err := botService.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_chat",
		RouteKey:   "chat:automation-1",
		Title:      "Automation Chat",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget() error = %v", err)
	}

	trigger, err := botService.CreateTrigger(context.Background(), workspace.ID, connection.BotID, UpsertBotTriggerInput{
		DeliveryTargetID: target.ID,
		Filter: map[string]string{
			"kind": "automation_run_completed",
		},
	})
	if err != nil {
		t.Fatalf("CreateTrigger() error = %v", err)
	}

	if !strings.HasPrefix(trigger.ID, "nc:") {
		t.Fatalf("expected managed trigger id, got %#v", trigger)
	}

	subscriptions := dataStore.ListNotificationSubscriptions(workspace.ID)
	if len(subscriptions) != 1 {
		t.Fatalf("expected 1 notification subscription, got %#v", subscriptions)
	}
	subscription := subscriptions[0]
	if subscription.Topic != "system.notification.created" || subscription.SourceType != "notification" {
		t.Fatalf("unexpected managed trigger subscription %#v", subscription)
	}
	if len(subscription.Channels) != 1 ||
		subscription.Channels[0].Channel != "bot" ||
		subscription.Channels[0].TargetRefID != target.ID {
		t.Fatalf("unexpected managed trigger channels %#v", subscription.Channels)
	}
	if subscription.Filter["kind"] != "automation_run_completed" {
		t.Fatalf("unexpected managed trigger filter %#v", subscription.Filter)
	}

	listed, err := botService.ListTriggers(workspace.ID, connection.BotID)
	if err != nil {
		t.Fatalf("ListTriggers() error = %v", err)
	}
	if len(listed) != 1 || listed[0].ID != trigger.ID || listed[0].DeliveryTargetID != target.ID {
		t.Fatalf("unexpected managed trigger list %#v", listed)
	}
}

func TestUpsertWeChatRouteBackedDeliveryTargetAllowsMissingContextAndStripsManagedProviderState(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "wechat-token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "wechat_session",
		RouteKey:   "user:wechat-user-1",
		Title:      "Alice",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-manual",
			"to_user_id":          "wechat-user-1",
			"external_chat_id":    "wechat-user-1",
			"custom_key":          "custom-value",
		},
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget(route_backed wechat) error = %v", err)
	}
	if target.DeliveryReadiness != deliveryTargetReadinessWaiting {
		t.Fatalf("expected waiting readiness without inbound context, got %#v", target)
	}
	if !strings.Contains(target.DeliveryReadinessMessage, "send a message first") {
		t.Fatalf("expected waiting readiness message, got %#v", target)
	}
	if got := target.ProviderState[wechatContextTokenKey]; got != "" {
		t.Fatalf("expected managed wechat context token to be stripped from target view, got %#v", target.ProviderState)
	}
	if got := target.ProviderState["custom_key"]; got != "custom-value" {
		t.Fatalf("expected custom provider state to be preserved, got %#v", target.ProviderState)
	}

	storedTarget, ok := dataStore.GetBotDeliveryTarget(workspace.ID, target.ID)
	if !ok {
		t.Fatal("expected route-backed delivery target to be stored")
	}
	if got := storedTarget.ProviderState[wechatContextTokenKey]; got != "" {
		t.Fatalf("expected stored target to strip managed wechat context token, got %#v", storedTarget.ProviderState)
	}
	if got := storedTarget.ProviderState["custom_key"]; got != "custom-value" {
		t.Fatalf("expected stored target custom provider state, got %#v", storedTarget.ProviderState)
	}

	_, err = service.SendDeliveryTargetOutboundMessages(context.Background(), workspace.ID, connection.BotID, target.ID, SendOutboundMessagesInput{
		SourceType: "manual",
		Messages: []store.BotReplyMessage{
			{Text: "Hello Alice"},
		},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput without inbound WeChat context, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "wait for the user to send a message first") {
		t.Fatalf("expected human-readable waiting-for-context error, got %v", err)
	}
}

func TestSendWeChatRouteBackedDeliveryTargetUsesLatestConversationContext(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "wechat-token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		BotID:                  connection.BotID,
		WorkspaceID:            workspace.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "wechat-user-1",
		ExternalChatID:         "wechat-user-1",
		ExternalUserID:         "wechat-user-1",
		ExternalTitle:          "Alice",
		ThreadID:               "thr-wechat-user-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-new",
			"conversation_extra":  "fresh",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:   workspace.ID,
		BotID:         connection.BotID,
		ConnectionID:  connection.ID,
		Provider:      connection.Provider,
		TargetType:    "route_backed",
		RouteType:     "wechat_session",
		RouteKey:      "user:wechat-user-1",
		Title:         "Alice Route",
		ProviderState: map[string]string{wechatContextTokenKey: "ctx-old", "target_extra": "keep-me"},
		Status:        "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	targets, err := service.ListDeliveryTargets(workspace.ID, connection.BotID)
	if err != nil {
		t.Fatalf("ListDeliveryTargets() error = %v", err)
	}
	var listedTarget DeliveryTargetView
	for _, candidate := range targets {
		if candidate.ID == target.ID {
			listedTarget = candidate
			break
		}
	}
	if listedTarget.ID == "" {
		t.Fatalf("expected target %s to appear in delivery target list", target.ID)
	}
	if listedTarget.DeliveryReadiness != deliveryTargetReadinessReady {
		t.Fatalf("expected ready delivery target after matching inbound conversation, got %#v", listedTarget)
	}
	if listedTarget.LastContextSeenAt == nil {
		t.Fatalf("expected lastContextSeenAt to be populated from matched conversation, got %#v", listedTarget)
	}
	if got := listedTarget.ProviderState[wechatContextTokenKey]; got != "" {
		t.Fatalf("expected delivery target view to hide managed wechat context token, got %#v", listedTarget.ProviderState)
	}
	if got := listedTarget.ProviderState["target_extra"]; got != "keep-me" {
		t.Fatalf("expected delivery target view to preserve custom provider state, got %#v", listedTarget.ProviderState)
	}

	_, err = service.SendDeliveryTargetOutboundMessages(context.Background(), workspace.ID, connection.BotID, target.ID, SendOutboundMessagesInput{
		SourceType: "manual",
		Messages: []store.BotReplyMessage{
			{Text: "Hello again"},
		},
	})
	if err != nil {
		t.Fatalf("SendDeliveryTargetOutboundMessages() error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		if got := sent.Conversation.ProviderState[wechatContextTokenKey]; got != "ctx-new" {
			t.Fatalf("expected outbound send to use latest conversation context token, got %#v", sent.Conversation.ProviderState)
		}
		if got := sent.Conversation.ProviderState["target_extra"]; got != "keep-me" {
			t.Fatalf("expected outbound send to retain target-specific provider state, got %#v", sent.Conversation.ProviderState)
		}
		if sent.Conversation.ThreadID != "thr-wechat-user-1" {
			t.Fatalf("expected outbound send to reuse matched conversation thread, got %#v", sent.Conversation)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for route-backed WeChat outbound send")
	}

	updatedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatalf("expected to reload bot conversation %s after outbound send", conversation.ID)
	}
	if updatedConversation.LastOutboundDeliveryStatus != "delivered" {
		t.Fatalf("expected matched conversation outbound status to be updated, got %#v", updatedConversation)
	}
}

func TestUpsertFeishuRouteBackedDeliveryTargetSupportsSessionlessPush(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newNamedFakeProvider(feishuProviderName)
	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  feishuProviderName,
		AIBackend: "fake_ai",
		Settings: map[string]string{
			feishuAppIDSetting:                 "cli_a1b2c3d4",
			feishuDeliveryModeSetting:          feishuDeliveryModeWebSocket,
			feishuBotOpenIDSetting:             "ou_bot_123",
			feishuBotDisplayNameSetting:        "Ops Bot",
			feishuThreadIsolationSetting:       "true",
			feishuGroupReplyAllSetting:         "false",
			feishuDomainSetting:                "https://open.feishu.cn",
			feishuChatNameKey:                  "Ops Channel",
			feishuConversationIDKey:            "chat:oc_chat_1:thread:om_thread_1",
			feishuShareSessionInChannelSetting: "false",
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "feishu_thread",
		RouteKey:   "chat:oc_chat_1:thread:om_thread_1",
		Title:      "Ops Thread",
		ProviderState: map[string]string{
			feishuChatIDKey:         "oc_chat_1",
			feishuThreadIDKey:       "om_thread_1",
			feishuUserOpenIDKey:     "ou_user_1",
			feishuConversationIDKey: "chat:oc_chat_1:thread:om_thread_1",
			"target_extra":          "keep-me",
		},
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget(feishu route_backed) error = %v", err)
	}
	if target.DeliveryReadiness != deliveryTargetReadinessReady {
		t.Fatalf("expected feishu route-backed target to be ready without inbound context, got %#v", target)
	}

	_, err = service.SendDeliveryTargetOutboundMessages(context.Background(), workspace.ID, connection.BotID, target.ID, SendOutboundMessagesInput{
		SourceType: "manual",
		Messages: []store.BotReplyMessage{
			{Text: "Hello Feishu"},
		},
	})
	if err != nil {
		t.Fatalf("SendDeliveryTargetOutboundMessages() error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		if sent.Conversation.ExternalChatID != "oc_chat_1" {
			t.Fatalf("expected synthetic feishu chat id oc_chat_1, got %#v", sent.Conversation)
		}
		if sent.Conversation.ExternalThreadID != "om_thread_1" {
			t.Fatalf("expected synthetic feishu thread id om_thread_1, got %#v", sent.Conversation)
		}
		if sent.Conversation.ProviderState["target_extra"] != "keep-me" {
			t.Fatalf("expected target provider state to be preserved, got %#v", sent.Conversation.ProviderState)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for feishu route-backed outbound send")
	}
}

func TestSendFeishuRouteBackedDeliveryTargetUsesLatestConversationContext(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newNamedFakeProvider(feishuProviderName)
	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  feishuProviderName,
		AIBackend: "fake_ai",
		Settings: map[string]string{
			feishuAppIDSetting:        "cli_a1b2c3d4",
			feishuDeliveryModeSetting: feishuDeliveryModeWebSocket,
			feishuBotOpenIDSetting:    "ou_bot_123",
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		BotID:                  connection.BotID,
		WorkspaceID:            workspace.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat:oc_chat_1:thread:om_thread_1",
		ExternalChatID:         "oc_chat_1",
		ExternalThreadID:       "om_thread_1",
		ExternalUserID:         "ou_user_1",
		ExternalTitle:          "Ops Thread",
		ThreadID:               "thr-feishu-1",
		ProviderState: map[string]string{
			feishuMessageIDKey:   "om_msg_latest",
			"conversation_extra": "fresh",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:   workspace.ID,
		BotID:         connection.BotID,
		ConnectionID:  connection.ID,
		Provider:      connection.Provider,
		TargetType:    "route_backed",
		RouteType:     "feishu_thread",
		RouteKey:      "chat:oc_chat_1:thread:om_thread_1",
		Title:         "Ops Thread Target",
		ProviderState: map[string]string{"target_extra": "keep-me"},
		Status:        "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	_, err = service.SendDeliveryTargetOutboundMessages(context.Background(), workspace.ID, connection.BotID, target.ID, SendOutboundMessagesInput{
		SourceType: "manual",
		Messages: []store.BotReplyMessage{
			{Text: "Hello again"},
		},
	})
	if err != nil {
		t.Fatalf("SendDeliveryTargetOutboundMessages() error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		if got := sent.Conversation.ProviderState[feishuMessageIDKey]; got != "om_msg_latest" {
			t.Fatalf("expected outbound send to reuse latest feishu message id, got %#v", sent.Conversation.ProviderState)
		}
		if got := sent.Conversation.ProviderState["target_extra"]; got != "keep-me" {
			t.Fatalf("expected outbound send to retain target-specific provider state, got %#v", sent.Conversation.ProviderState)
		}
		if sent.Conversation.ThreadID != "thr-feishu-1" {
			t.Fatalf("expected outbound send to reuse matched conversation thread, got %#v", sent.Conversation)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for route-backed Feishu outbound send")
	}

	updatedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatalf("expected to reload feishu bot conversation %s after outbound send", conversation.ID)
	}
	if updatedConversation.LastOutboundDeliveryStatus != "delivered" {
		t.Fatalf("expected feishu matched conversation outbound status to be updated, got %#v", updatedConversation)
	}
}

func TestSendQQBotRouteBackedDeliveryTargetUsesLatestConversationContext(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newNamedFakeProvider(qqbotProviderName)
	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  qqbotProviderName,
		AIBackend: "fake_ai",
		Settings: map[string]string{
			qqbotAppIDSetting: "102345678",
		},
		Secrets: map[string]string{
			qqbotAppSecretKey: "qqbot-secret-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		BotID:                  connection.BotID,
		WorkspaceID:            workspace.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "group:group-openid-1",
		ExternalChatID:         "group-openid-1",
		ExternalUserID:         "member-openid-1",
		ExternalTitle:          "Ops Group",
		ThreadID:               "thr-qqbot-1",
		ProviderState: map[string]string{
			qqbotMessageTypeKey:    qqbotMessageTypeGroup,
			qqbotGroupOpenIDKey:    "group-openid-1",
			qqbotUserOpenIDKey:     "member-openid-1",
			qqbotEventMessageIDKey: "evt-group-latest",
			"conversation_extra":   "fresh",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	target, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:   workspace.ID,
		BotID:         connection.BotID,
		ConnectionID:  connection.ID,
		Provider:      connection.Provider,
		TargetType:    "route_backed",
		RouteType:     "qqbot_group",
		RouteKey:      "group:group-openid-1",
		Title:         "Ops Group Target",
		ProviderState: map[string]string{"target_extra": "keep-me"},
		Status:        "active",
	})
	if err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	_, err = service.SendDeliveryTargetOutboundMessages(context.Background(), workspace.ID, connection.BotID, target.ID, SendOutboundMessagesInput{
		SourceType: "manual",
		Messages: []store.BotReplyMessage{
			{Text: "Hello QQ Bot"},
		},
	})
	if err != nil {
		t.Fatalf("SendDeliveryTargetOutboundMessages() error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		if got := sent.Conversation.ProviderState[qqbotEventMessageIDKey]; got != "evt-group-latest" {
			t.Fatalf("expected outbound send to reuse latest qqbot event msg id, got %#v", sent.Conversation.ProviderState)
		}
		if got := sent.Conversation.ProviderState["target_extra"]; got != "keep-me" {
			t.Fatalf("expected outbound send to retain target-specific provider state, got %#v", sent.Conversation.ProviderState)
		}
		if sent.Conversation.ThreadID != "thr-qqbot-1" {
			t.Fatalf("expected outbound send to reuse matched conversation thread, got %#v", sent.Conversation)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for route-backed QQ Bot outbound send")
	}

	updatedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatalf("expected to reload qqbot bot conversation %s after outbound send", conversation.ID)
	}
	if updatedConversation.LastOutboundDeliveryStatus != "delivered" {
		t.Fatalf("expected qqbot matched conversation outbound status to be updated, got %#v", updatedConversation)
	}
}

func TestDeliveryTargetReadinessFallsBackWhenConnectionPaused(t *testing.T) {
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
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspace.ID,
		BotID:                  connection.BotID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-readiness-1",
		ExternalChatID:         "chat-readiness-1",
		ExternalTitle:          "Alice",
		ThreadID:               "thr_chat-readiness-1",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		SessionID: conversation.ID,
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget() error = %v", err)
	}
	if target.DeliveryReadiness != deliveryTargetReadinessReady {
		t.Fatalf("expected active connection target to be ready, got %#v", target)
	}

	if _, err := service.PauseConnection(context.Background(), workspace.ID, connection.ID); err != nil {
		t.Fatalf("PauseConnection() error = %v", err)
	}

	targets, err := service.ListDeliveryTargets(workspace.ID, connection.BotID)
	if err != nil {
		t.Fatalf("ListDeliveryTargets(paused) error = %v", err)
	}

	var pausedTarget DeliveryTargetView
	for _, candidate := range targets {
		if candidate.ID == target.ID {
			pausedTarget = candidate
			break
		}
	}
	if pausedTarget.ID == "" {
		t.Fatalf("expected paused target %s to appear in delivery target list", target.ID)
	}
	if pausedTarget.DeliveryReadiness != deliveryTargetReadinessWaiting {
		t.Fatalf("expected paused connection target to become waiting, got %#v", pausedTarget)
	}
	if !strings.Contains(pausedTarget.DeliveryReadinessMessage, "Current provider is paused") {
		t.Fatalf("expected paused readiness message to mention provider pause, got %#v", pausedTarget)
	}

	if _, err := service.ResumeConnection(context.Background(), workspace.ID, connection.ID, ResumeConnectionInput{}); err != nil {
		t.Fatalf("ResumeConnection() error = %v", err)
	}

	targets, err = service.ListDeliveryTargets(workspace.ID, connection.BotID)
	if err != nil {
		t.Fatalf("ListDeliveryTargets(resumed) error = %v", err)
	}

	var resumedTarget DeliveryTargetView
	for _, candidate := range targets {
		if candidate.ID == target.ID {
			resumedTarget = candidate
			break
		}
	}
	if resumedTarget.ID == "" {
		t.Fatalf("expected resumed target %s to appear in delivery target list", target.ID)
	}
	if resumedTarget.DeliveryReadiness != deliveryTargetReadinessReady {
		t.Fatalf("expected resumed connection target to return to ready, got %#v", resumedTarget)
	}
}

func TestSendSessionOutboundMessagesRejectsUnsupportedTelegramMedia(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{newTelegramProvider(nil)},
		AIBackends: []AIBackend{fakeAIBackend{}},
	})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    telegramProviderName,
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   "fake_ai",
		Secrets: map[string]string{
			"bot_token": "123:abc",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	connection, bot, _, err := service.ensureConnectionBotResources(connection)
	if err != nil {
		t.Fatalf("ensureConnectionBotResources() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspace.ID,
		BotID:                  bot.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-telegram-media-1",
		ExternalChatID:         "chat-telegram-media-1",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	_, err = service.SendSessionOutboundMessages(context.Background(), workspace.ID, bot.ID, conversation.ID, SendOutboundMessagesInput{
		SourceType: "manual",
		Messages: []store.BotReplyMessage{
			{
				Media: []store.BotMessageMedia{
					{Kind: botMediaKindImage, Path: "relative-image.png"},
				},
			},
		},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for invalid telegram media input, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "must be absolute") {
		t.Fatalf("expected absolute path validation error, got %v", err)
	}

	deliveries := dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
		BotID:          bot.ID,
		ConversationID: conversation.ID,
	})
	if len(deliveries) != 0 {
		t.Fatalf("expected proactive request to fail before persisting deliveries, got %#v", deliveries)
	}
}

func TestUpdateRouteBackedDeliveryTarget(t *testing.T) {
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

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_chat",
		RouteKey:   "chat:998877",
		Title:      "Ops Room",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget(route_backed) error = %v", err)
	}

	updated, err := service.UpdateDeliveryTarget(context.Background(), workspace.ID, connection.BotID, target.ID, UpsertDeliveryTargetInput{
		RouteType: "telegram_topic",
		RouteKey:  "chat:998877:thread:42",
		Title:     "Ops Topic",
		Status:    "paused",
	})
	if err != nil {
		t.Fatalf("UpdateDeliveryTarget() error = %v", err)
	}
	if updated.ID != target.ID ||
		updated.RouteType != "telegram_topic" ||
		updated.RouteKey != "chat:998877:thread:42" ||
		updated.Title != "Ops Topic" ||
		updated.Status != "paused" {
		t.Fatalf("unexpected updated delivery target view: %#v", updated)
	}

	storedTarget, ok := dataStore.GetBotDeliveryTarget(workspace.ID, target.ID)
	if !ok {
		t.Fatal("expected stored delivery target after update")
	}
	if storedTarget.RouteType != "telegram_topic" ||
		storedTarget.RouteKey != "chat:998877:thread:42" ||
		storedTarget.Title != "Ops Topic" ||
		storedTarget.Status != "paused" {
		t.Fatalf("unexpected stored delivery target after update: %#v", storedTarget)
	}
}

func TestDeleteRouteBackedDeliveryTarget(t *testing.T) {
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

	target, err := service.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_chat",
		RouteKey:   "chat:998877",
		Title:      "Ops Room",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget(route_backed) error = %v", err)
	}

	if err := service.DeleteDeliveryTarget(context.Background(), workspace.ID, connection.BotID, target.ID); err != nil {
		t.Fatalf("DeleteDeliveryTarget() error = %v", err)
	}

	if _, ok := dataStore.GetBotDeliveryTarget(workspace.ID, target.ID); ok {
		t.Fatal("expected delivery target to be removed from store")
	}

	if _, err := service.SendDeliveryTargetOutboundMessages(context.Background(), workspace.ID, connection.BotID, target.ID, SendOutboundMessagesInput{
		SourceType: "manual",
		Messages: []store.BotReplyMessage{
			{Text: "hello"},
		},
	}); !errors.Is(err, store.ErrBotDeliveryTargetNotFound) {
		t.Fatalf("expected send to fail with ErrBotDeliveryTargetNotFound, got %v", err)
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

func TestServiceCreatesWeChatConnectionFromConfirmedLoginSession(t *testing.T) {
	t.Parallel()

	serverURL := ""
	statusCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/get_bot_qrcode":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":                0,
				"errcode":            0,
				"errmsg":             "",
				"qrcode":             "qr-create-session-1",
				"qrcode_img_content": "weixin://qr/create-session-1",
			})
		case "/ilink/bot/get_qrcode_status":
			statusCalls += 1
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":           0,
				"errcode":       0,
				"errmsg":        "",
				"status":        wechatLoginStatusConfirmed,
				"bot_token":     "wechat-token-from-session",
				"ilink_bot_id":  "wechat-account-from-session",
				"baseurl":       serverURL,
				"ilink_user_id": "wechat-owner-from-session",
			})
		default:
			t.Fatalf("unexpected wechat auth path %s", r.URL.Path)
		}
	}))
	serverURL = server.URL
	defer server.Close()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")

	service := NewService(dataStore, nil, nil, nil, Config{
		HTTPClient: server.Client(),
		AIBackends: []AIBackend{fakeAIBackend{}},
	})

	login, err := service.StartWeChatLogin(context.Background(), workspace.ID, StartWeChatLoginInput{BaseURL: server.URL})
	if err != nil {
		t.Fatalf("StartWeChatLogin() error = %v", err)
	}

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "fake_ai",
		Settings: map[string]string{
			wechatDeliveryModeSetting:   wechatDeliveryModePolling,
			wechatBaseURLSetting:        "https://ignored.example.com",
			wechatRouteTagSetting:       "route-7",
			wechatLoginSessionIDSetting: login.LoginID,
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}
	if statusCalls != 1 {
		t.Fatalf("expected confirmed login session to be resolved once, got %d status calls", statusCalls)
	}

	stored, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected created connection to be persisted")
	}
	if got := stored.Settings[wechatBaseURLSetting]; got != server.URL {
		t.Fatalf("expected resolved wechat base url %q, got %q", server.URL, got)
	}
	if got := stored.Settings[wechatAccountIDSetting]; got != "wechat-account-from-session" {
		t.Fatalf("expected resolved wechat account id, got %#v", stored.Settings)
	}
	if got := stored.Settings[wechatOwnerUserIDSetting]; got != "wechat-owner-from-session" {
		t.Fatalf("expected resolved wechat owner user id, got %#v", stored.Settings)
	}
	if got := stored.Settings[wechatRouteTagSetting]; got != "route-7" {
		t.Fatalf("expected route tag to be preserved, got %#v", stored.Settings)
	}
	if _, exists := stored.Settings[wechatLoginSessionIDSetting]; exists {
		t.Fatalf("expected transient login session id to be removed from stored settings, got %#v", stored.Settings)
	}
	if got := stored.Secrets["bot_token"]; got != "wechat-token-from-session" {
		t.Fatalf("expected resolved wechat bot token, got %#v", stored.Secrets)
	}
}

func TestServiceCreatesWeChatConnectionFromSavedAccount(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")

	account, err := dataStore.UpsertWeChatAccount(store.WeChatAccount{
		WorkspaceID:     workspace.ID,
		BaseURL:         "https://wechat.saved.example.com",
		AccountID:       "wechat-account-saved-1",
		UserID:          "wechat-owner-saved-1",
		BotToken:        "wechat-token-saved-1",
		LastLoginID:     "login-saved-1",
		LastConfirmedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("UpsertWeChatAccount() error = %v", err)
	}

	service := NewService(dataStore, nil, nil, nil, Config{
		AIBackends: []AIBackend{fakeAIBackend{}},
	})

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "fake_ai",
		Settings: map[string]string{
			wechatDeliveryModeSetting:   wechatDeliveryModePolling,
			wechatSavedAccountIDSetting: account.ID,
			wechatRouteTagSetting:       "route-saved-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	stored, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected created connection to be persisted")
	}
	if got := stored.Settings[wechatBaseURLSetting]; got != "https://wechat.saved.example.com" {
		t.Fatalf("expected saved account base url to be applied, got %#v", stored.Settings)
	}
	if got := stored.Settings[wechatAccountIDSetting]; got != "wechat-account-saved-1" {
		t.Fatalf("expected saved account id to be applied, got %#v", stored.Settings)
	}
	if got := stored.Settings[wechatOwnerUserIDSetting]; got != "wechat-owner-saved-1" {
		t.Fatalf("expected saved account owner user id to be applied, got %#v", stored.Settings)
	}
	if _, exists := stored.Settings[wechatSavedAccountIDSetting]; exists {
		t.Fatalf("expected transient saved account id to be removed from connection settings, got %#v", stored.Settings)
	}
	if got := stored.Secrets["bot_token"]; got != "wechat-token-saved-1" {
		t.Fatalf("expected saved account bot token to be applied, got %#v", stored.Secrets)
	}
}

func TestServiceUpdatesWeChatAccountMetadataAndPreservesItOnReconfirm(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")

	account, err := dataStore.UpsertWeChatAccount(store.WeChatAccount{
		WorkspaceID:     workspace.ID,
		BaseURL:         "https://wechat.saved.example.com",
		AccountID:       "wechat-account-saved-1",
		UserID:          "wechat-owner-saved-1",
		BotToken:        "wechat-token-saved-1",
		LastLoginID:     "login-saved-1",
		LastConfirmedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("UpsertWeChatAccount() error = %v", err)
	}

	service := NewService(dataStore, nil, nil, nil, Config{
		AIBackends: []AIBackend{fakeAIBackend{}},
	})

	updated, err := service.UpdateWeChatAccount(workspace.ID, account.ID, UpdateWeChatAccountInput{
		Alias: "Support Primary",
		Note:  "Used by the support queue.",
	})
	if err != nil {
		t.Fatalf("UpdateWeChatAccount() error = %v", err)
	}
	if updated.Alias != "Support Primary" || updated.Note != "Used by the support queue." {
		t.Fatalf("expected updated metadata, got %#v", updated)
	}

	service.rememberConfirmedWeChatLogin(workspace.ID, WeChatLoginView{
		LoginID:         "login-saved-2",
		Status:          wechatLoginStatusConfirmed,
		BaseURL:         "https://wechat.saved.example.com",
		AccountID:       "wechat-account-saved-1",
		UserID:          "wechat-owner-saved-1",
		BotToken:        "wechat-token-saved-2",
		CredentialReady: true,
	})

	preserved, ok := dataStore.GetWeChatAccount(workspace.ID, account.ID)
	if !ok {
		t.Fatal("expected updated wechat account to remain in store")
	}
	if preserved.Alias != "Support Primary" || preserved.Note != "Used by the support queue." {
		t.Fatalf("expected alias and note to survive reconfirm, got %#v", preserved)
	}
	if preserved.BotToken != "wechat-token-saved-2" {
		t.Fatalf("expected reconfirm to refresh bot token, got %#v", preserved)
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

	deliveries := dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
		BotID:          connection.BotID,
		ConversationID: conversations[0].ID,
		SourceType:     "reply",
	})
	if len(deliveries) != 1 {
		t.Fatalf("expected 1 reply outbound delivery, got %#v", deliveries)
	}
	if deliveries[0].Status != "delivered" ||
		deliveries[0].SourceRefType != "inbound_delivery" ||
		strings.TrimSpace(deliveries[0].SourceRefID) == "" {
		t.Fatalf("expected delivered reply outbound delivery linked to inbound delivery, got %#v", deliveries[0])
	}
	if len(deliveries[0].Messages) != 1 || deliveries[0].Messages[0].Text != "reply: hello" {
		t.Fatalf("expected reply outbound delivery payload to match final reply, got %#v", deliveries[0].Messages)
	}
	if _, ok := dataStore.GetBotInboundDelivery(workspace.ID, deliveries[0].SourceRefID); !ok {
		t.Fatalf("expected outbound delivery source ref %q to resolve to inbound delivery", deliveries[0].SourceRefID)
	}
	target, ok := dataStore.GetBotDeliveryTarget(workspace.ID, deliveries[0].DeliveryTargetID)
	if !ok || target.ConversationID != conversations[0].ID {
		t.Fatalf("expected reply outbound delivery target to resolve back to conversation, got %#v", target)
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
		if len(conversations) == 1 && strings.Contains(conversations[0].LastOutboundText, "[Image attachment]") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	t.Fatalf("expected last outbound text to summarize normalized media, got %q", conversations[0].LastOutboundText)
}

func TestHandleWebhookTelegramAddsAIAttachmentHintAndNormalizesReplyMedia(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeTelegramWebhookProvider()
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-telegram-1",
			Messages: []OutboundMessage{
				{
					Text: "视频已经准备好。\n\n```telegram-attachments\nvideo E:\\temp\\news_brief_output\\international_news_brief_2026-04-08.mp4\n```",
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
		Provider:  telegramProviderName,
		AIBackend: "scripted_ai",
		Secrets: map[string]string{
			"bot_token": "telegram-token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-telegram-1",
		"messageId":"msg-telegram-1",
		"userId":"telegram-user-1",
		"username":"alice",
		"title":"Alice",
		"text":"把视频发给我"
	}`))
	request.Header.Set("X-Test-Secret", "fake-secret")

	result, err := service.HandleWebhook(request, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook() error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected 1 accepted inbound telegram message, got %d", result.Accepted)
	}

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 {
			t.Fatalf("expected 1 normalized telegram outbound message, got %#v", sent.Messages)
		}
		if got := sent.Messages[0].Text; got != "视频已经准备好。" {
			t.Fatalf("expected visible telegram text to exclude attachment protocol, got %#v", sent.Messages[0])
		}
		if len(sent.Messages[0].Media) != 1 {
			t.Fatalf("expected 1 parsed telegram media item, got %#v", sent.Messages[0].Media)
		}
		if got := sent.Messages[0].Media[0]; got.Kind != botMediaKindVideo || got.Path != `E:\temp\news_brief_output\international_news_brief_2026-04-08.mp4` || got.FileName != "international_news_brief_2026-04-08.mp4" {
			t.Fatalf("expected parsed telegram media item to be local video attachment, got %#v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for Telegram provider SendMessages call")
	}

	inbound := backend.lastInboundMessage()
	if !strings.Contains(inbound.Text, "把视频发给我") {
		t.Fatalf("expected telegram ai inbound text to preserve original user text, got %q", inbound.Text)
	}
	if strings.Count(inbound.Text, telegramAIOutboundMediaNote) != 1 {
		t.Fatalf("expected telegram ai inbound text to include telegram media note exactly once, got %q", inbound.Text)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conversations = service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 && strings.Contains(conversations[0].LastOutboundText, "[Video attachment]") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(conversations) != 1 {
		t.Fatalf("expected 1 telegram bot conversation, got %d", len(conversations))
	}
	t.Fatalf("expected telegram last outbound text to summarize normalized media, got %q", conversations[0].LastOutboundText)
}

func TestHandleWebhookWeChatEchoCommandBypassesAIAndReturnsTiming(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	backend := &countingAIBackend{}

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{backend},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "counting_ai",
		Secrets: map[string]string{
			"bot_token": "wechat-token-echo-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	createdAtMS := time.Now().Add(-1500 * time.Millisecond).UnixMilli()
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
		"conversationId":"chat-wechat-echo-1",
		"messageId":"msg-wechat-echo-1",
		"userId":"wechat-user-echo-1",
		"username":"alice",
		"title":"Alice",
		"text":"/echo ping from wechat",
		"providerData":{"wechat_created_at_ms":"%d"}
	}`, createdAtMS)))
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
		if len(sent.Messages) != 2 {
			t.Fatalf("expected /echo to send two outbound messages, got %#v", sent.Messages)
		}
		if got := sent.Messages[0].Text; got != "ping from wechat" {
			t.Fatalf("expected first /echo message to mirror the payload, got %#v", sent.Messages[0])
		}
		if got := sent.Messages[1].Text; !strings.Contains(got, "Channel timing") ||
			!strings.Contains(got, "Platform->backend:") ||
			!strings.Contains(got, "Backend processing:") {
			t.Fatalf("expected second /echo message to include timing summary, got %#v", sent.Messages[1])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WeChat /echo response")
	}

	if got := backend.callCount(); got != 0 {
		t.Fatalf("expected /echo to bypass AI execution, got %d backend calls", got)
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conversations = service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			strings.Contains(conversations[0].LastOutboundText, "ping from wechat") &&
			strings.Contains(conversations[0].LastOutboundText, "Channel timing") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	t.Fatalf("expected /echo result to be recorded on the conversation, got %q", conversations[0].LastOutboundText)
}

func TestHandleWebhookWeChatToggleDebugCommandUpdatesRuntimeMode(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	backend := &countingAIBackend{}

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{backend},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "counting_ai",
		Secrets: map[string]string{
			"bot_token": "wechat-token-debug-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	sendToggle := func(messageID string) {
		t.Helper()

		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
			"conversationId":"chat-wechat-debug-1",
			"messageId":"%s",
			"userId":"wechat-user-debug-1",
			"username":"alice",
			"title":"Alice",
			"text":"/toggle-debug"
		}`, messageID)))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		if result.Accepted != 1 {
			t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
		}
	}

	sendToggle("msg-wechat-debug-1")

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "WeChat debug mode enabled for this bot connection." {
			t.Fatalf("expected enable debug response, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WeChat /toggle-debug enable response")
	}

	stored, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected toggled connection to remain in store")
	}
	if got := stored.Settings[botRuntimeModeSetting]; got != botRuntimeModeDebug {
		t.Fatalf("expected runtime mode %q after first toggle, got %q", botRuntimeModeDebug, got)
	}

	sendToggle("msg-wechat-debug-2")

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "WeChat debug mode disabled for this bot connection." {
			t.Fatalf("expected disable debug response, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WeChat /toggle-debug disable response")
	}

	stored, ok = dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected toggled connection to remain in store")
	}
	if got := stored.Settings[botRuntimeModeSetting]; got != botRuntimeModeNormal {
		t.Fatalf("expected runtime mode %q after second toggle, got %q", botRuntimeModeNormal, got)
	}
	if got := backend.callCount(); got != 0 {
		t.Fatalf("expected /toggle-debug to bypass AI execution, got %d backend calls", got)
	}
}

func TestHandleWebhookWeChatDebugModeAppendsTimingToAIReply(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-wechat-debug-ai-1",
			Messages: []OutboundMessage{
				{Text: "reply: hello debug"},
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
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-debug-ai-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	createdAtMS := time.Now().Add(-1800 * time.Millisecond).UnixMilli()
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
		"conversationId":"chat-wechat-debug-ai-1",
		"messageId":"msg-wechat-debug-ai-1",
		"userId":"wechat-user-debug-ai-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello debug timing",
		"providerData":{"wechat_created_at_ms":"%d"}
	}`, createdAtMS)))
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
			t.Fatalf("expected debug AI reply to stay as one outbound message, got %#v", sent.Messages)
		}
		if got := sent.Messages[0].Text; !strings.Contains(got, "reply: hello debug") ||
			!strings.Contains(got, "Channel timing") ||
			!strings.Contains(got, "Platform->backend:") ||
			!strings.Contains(got, "Backend processing:") {
			t.Fatalf("expected debug AI reply to include timing summary, got %#v", sent.Messages[0])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WeChat debug AI reply")
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conversations = service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			strings.Contains(conversations[0].LastOutboundText, "reply: hello debug") &&
			strings.Contains(conversations[0].LastOutboundText, "Channel timing") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	t.Fatalf("expected debug AI reply preview to include timing summary, got %q", conversations[0].LastOutboundText)
}

func TestHandleWebhookWeChatDebugModeAppendsStandaloneTimingWhenReplyHasMedia(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-wechat-debug-media-1",
			Messages: []OutboundMessage{
				{
					Text: "reply: hello debug media",
					Media: []store.BotMessageMedia{
						{
							Kind:     botMediaKindFile,
							Path:     "E:/tmp/debug-report.txt",
							FileName: "debug-report.txt",
						},
					},
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
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-debug-media-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	createdAtMS := time.Now().Add(-1800 * time.Millisecond).UnixMilli()
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
		"conversationId":"chat-wechat-debug-media-1",
		"messageId":"msg-wechat-debug-media-1",
		"userId":"wechat-user-debug-media-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello debug timing media",
		"providerData":{"wechat_created_at_ms":"%d"}
	}`, createdAtMS)))
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
		if len(sent.Messages) != 2 {
			t.Fatalf("expected media reply plus standalone timing message, got %#v", sent.Messages)
		}
		if got := sent.Messages[0]; !strings.Contains(got.Text, "reply: hello debug media") ||
			strings.Contains(got.Text, "Channel timing") ||
			len(got.Media) != 1 {
			t.Fatalf("expected first message to preserve media reply without timing footer, got %#v", got)
		}
		if got := sent.Messages[1]; len(got.Media) != 0 ||
			!strings.Contains(got.Text, "Channel timing") ||
			!strings.Contains(got.Text, "Platform->backend:") ||
			!strings.Contains(got.Text, "Backend processing:") {
			t.Fatalf("expected second message to be standalone timing text, got %#v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WeChat debug media AI reply")
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conversations = service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			strings.Contains(conversations[0].LastOutboundText, "reply: hello debug media") &&
			strings.Contains(conversations[0].LastOutboundText, "Channel timing") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	t.Fatalf("expected debug media reply preview to include reply summary and timing, got %q", conversations[0].LastOutboundText)
}

func TestHandleWebhookWeChatChannelTimingSettingDisablesTimingInDebugMode(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-wechat-debug-disabled-1",
			Messages: []OutboundMessage{
				{Text: "reply: hello debug disabled"},
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
		Settings: map[string]string{
			botRuntimeModeSetting:      botRuntimeModeDebug,
			wechatChannelTimingSetting: wechatChannelTimingDisabled,
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-debug-disabled-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	createdAtMS := time.Now().Add(-1800 * time.Millisecond).UnixMilli()
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
		"conversationId":"chat-wechat-debug-disabled-1",
		"messageId":"msg-wechat-debug-disabled-1",
		"userId":"wechat-user-debug-disabled-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello debug timing disabled",
		"providerData":{"wechat_created_at_ms":"%d"}
	}`, createdAtMS)))
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
			t.Fatalf("expected a single outbound message, got %#v", sent.Messages)
		}
		if strings.Contains(sent.Messages[0].Text, "Channel timing") {
			t.Fatalf("expected explicit disabled wechat timing to suppress Channel timing, got %#v", sent.Messages[0])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WeChat reply with disabled timing")
	}
}

func TestHandleWebhookWeChatChannelTimingSettingEnablesTimingWithoutDebugMode(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-wechat-normal-enabled-1",
			Messages: []OutboundMessage{
				{Text: "reply: hello timing enabled"},
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
		Settings: map[string]string{
			botRuntimeModeSetting:      botRuntimeModeNormal,
			wechatChannelTimingSetting: wechatChannelTimingEnabled,
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-normal-enabled-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	createdAtMS := time.Now().Add(-1800 * time.Millisecond).UnixMilli()
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
		"conversationId":"chat-wechat-normal-enabled-1",
		"messageId":"msg-wechat-normal-enabled-1",
		"userId":"wechat-user-normal-enabled-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello normal timing enabled",
		"providerData":{"wechat_created_at_ms":"%d"}
	}`, createdAtMS)))
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
			t.Fatalf("expected a single outbound message, got %#v", sent.Messages)
		}
		if got := sent.Messages[0].Text; !strings.Contains(got, "reply: hello timing enabled") ||
			!strings.Contains(got, "Channel timing") ||
			!strings.Contains(got, "Platform->backend:") ||
			!strings.Contains(got, "Backend processing:") {
			t.Fatalf("expected explicit enabled wechat timing to append Channel timing, got %#v", sent.Messages[0])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WeChat reply with enabled timing")
	}
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

func TestServiceUpdatesConnectionAndPreservesExistingSecrets(t *testing.T) {
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

	updated, err := service.UpdateConnection(context.Background(), workspace.ID, connection.ID, UpdateConnectionInput{
		Provider:  "fakechat",
		Name:      "Support Bot v2",
		AIBackend: "fake_ai",
		AIConfig: map[string]string{
			"model": "gpt-5.4-mini",
		},
		Settings: map[string]string{
			botRuntimeModeSetting:       botRuntimeModeDebug,
			botCommandOutputModeSetting: botCommandOutputModeFull,
		},
	})
	if err != nil {
		t.Fatalf("UpdateConnection() error = %v", err)
	}

	if updated.Name != "Support Bot v2" {
		t.Fatalf("expected updated connection name, got %#v", updated)
	}
	if updated.Settings[botRuntimeModeSetting] != botRuntimeModeDebug {
		t.Fatalf("expected debug runtime mode after update, got %#v", updated.Settings)
	}
	if updated.Settings[botCommandOutputModeSetting] != botCommandOutputModeFull {
		t.Fatalf("expected full command output mode after update, got %#v", updated.Settings)
	}
	if updated.AIConfig["model"] != "gpt-5.4-mini" {
		t.Fatalf("expected updated ai config, got %#v", updated.AIConfig)
	}

	stored, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected updated connection in store")
	}
	if stored.Secrets["bot_token"] != "token-123" {
		t.Fatalf("expected existing bot_token secret to be preserved, got %#v", stored.Secrets)
	}
}

func TestServiceUpdatesConnectionCommandOutputMode(t *testing.T) {
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

	updated, err := service.UpdateConnectionCommandOutputMode(workspace.ID, connection.ID, UpdateConnectionCommandOutputModeInput{
		CommandOutputMode: botCommandOutputModeNone,
	})
	if err != nil {
		t.Fatalf("UpdateConnectionCommandOutputMode() error = %v", err)
	}

	if updated.Settings[botCommandOutputModeSetting] != botCommandOutputModeNone {
		t.Fatalf("expected none command output mode after update, got %#v", updated.Settings)
	}
}

func TestServiceUpdatesWeChatChannelTimingSetting(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeWeChatProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		Name:      "WeChat Support",
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "wechat-token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	updated, err := service.UpdateWeChatChannelTiming(workspace.ID, connection.ID, UpdateWeChatChannelTimingInput{
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("UpdateWeChatChannelTiming() error = %v", err)
	}

	if updated.Settings[wechatChannelTimingSetting] != wechatChannelTimingEnabled {
		t.Fatalf("expected enabled wechat channel timing after update, got %#v", updated.Settings)
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

func TestHandleWebhookThreadCommandsFollowCrossWorkspaceBinding(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
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

	connection, err := service.CreateConnection(context.Background(), workspaceA.ID, CreateConnectionInput{
		Provider:  "fakechat",
		Name:      "Support Bot",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-cross-workspace-commands",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	targetThread, err := threadsExec.Create(context.Background(), workspaceB.ID, threads.CreateInput{Name: "Cross Workspace Bound Thread"})
	if err != nil {
		t.Fatalf("Create(targetThread) error = %v", err)
	}
	if _, err := service.UpdateBotDefaultBinding(context.Background(), workspaceA.ID, connection.BotID, UpdateBotDefaultBindingInput{
		BindingMode:       "fixed_thread",
		TargetWorkspaceID: workspaceB.ID,
		TargetThreadID:    targetThread.ID,
	}); err != nil {
		t.Fatalf("UpdateBotDefaultBinding() error = %v", err)
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

	sendWebhook(`{"conversationId":"chat-cross-command-1","messageId":"msg-1","userId":"user-1","username":"alice","title":"Alice","text":"hello cross workspace"}`)
	expectSingleReply("reply: hello cross workspace")

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspaceA.ID, connection.ID)
		if len(conversations) == 1 && conversations[0].ThreadID == targetThread.ID {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected cross-workspace bound thread to settle, got %#v", conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}

	sendWebhook(`{"conversationId":"chat-cross-command-1","messageId":"msg-2","userId":"user-1","username":"alice","title":"Alice","text":"/newthread Incident 42"}`)
	expectSingleReply(fmt.Sprintf(
		"Started a new workspace thread: %s/thread-bot-2\nName: Support Bot · Incident 42\nFuture messages in this chat will use the new thread.",
		workspaceB.ID,
	))

	sendWebhook(`{"conversationId":"chat-cross-command-1","messageId":"msg-3","userId":"user-1","username":"alice","title":"Alice","text":"hello on second cross workspace thread"}`)
	expectSingleReply("reply: hello on second cross workspace thread")

	sendWebhook(`{"conversationId":"chat-cross-command-1","messageId":"msg-4","userId":"user-1","username":"alice","title":"Alice","text":"/thread list"}`)
	expectSingleReply(fmt.Sprintf(
		"Known workspace threads (current first, then recent approvals/activity):\n1. %s/thread-bot-2 (current) | Support Bot · Incident 42 | reply: hello on second cross workspace thread | updated 2026-03-28 12:02:30 UTC\n2. %s/%s | Cross Workspace Bound Thread | reply: hello cross workspace | updated 2026-03-28 12:01:30 UTC",
		workspaceB.ID,
		workspaceB.ID,
		targetThread.ID,
	))

	sendWebhook(`{"conversationId":"chat-cross-command-1","messageId":"msg-5","userId":"user-1","username":"alice","title":"Alice","text":"/thread use 2"}`)
	expectSingleReply(fmt.Sprintf("Switched the current conversation to thread: %s/%s", workspaceB.ID, targetThread.ID))

	sendWebhook(`{"conversationId":"chat-cross-command-1","messageId":"msg-6","userId":"user-1","username":"alice","title":"Alice","text":"hello after cross workspace switch back"}`)
	expectSingleReply("reply: hello after cross workspace switch back")

	workspaceCalls := turnsExec.workspaceCalls()
	if len(workspaceCalls) != 3 {
		t.Fatalf("expected three AI turns, got %#v", workspaceCalls)
	}
	for _, workspaceID := range workspaceCalls {
		if workspaceID != workspaceB.ID {
			t.Fatalf("expected all AI turns to run in workspace %q, got %#v", workspaceB.ID, workspaceCalls)
		}
	}

	threadCalls := turnsExec.threadCalls()
	if len(threadCalls) != 3 {
		t.Fatalf("expected three AI turns, got %#v", threadCalls)
	}
	if threadCalls[0] != targetThread.ID || threadCalls[1] != "thread-bot-2" || threadCalls[2] != targetThread.ID {
		t.Fatalf("expected AI turns on %q, thread-bot-2, then %q, got %#v", targetThread.ID, targetThread.ID, threadCalls)
	}

	conversations := service.ListConversationViews(workspaceA.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %#v", conversations)
	}
	if conversations[0].ThreadID != targetThread.ID {
		t.Fatalf("expected conversation to switch back to %q, got %#v", targetThread.ID, conversations[0])
	}
	if strings.TrimSpace(conversations[0].BindingID) == "" {
		t.Fatalf("expected command flow to persist a session binding, got %#v", conversations[0])
	}

	storedBinding, ok := dataStore.GetBotBinding(workspaceA.ID, conversations[0].BindingID)
	if !ok {
		t.Fatalf("expected stored session binding %q", conversations[0].BindingID)
	}
	if storedBinding.TargetWorkspaceID != workspaceB.ID || storedBinding.TargetThreadID != targetThread.ID {
		t.Fatalf("expected stored session binding to target %q/%q, got %#v", workspaceB.ID, targetThread.ID, storedBinding)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspaceA.ID, conversations[0].ID)
	if !ok {
		t.Fatalf("expected stored conversation %q", conversations[0].ID)
	}
	knownRefs := knownConversationThreadRefs(storedConversation)
	if len(knownRefs) != 2 {
		t.Fatalf("expected two known thread refs, got %#v", knownRefs)
	}
	if knownRefs[0].WorkspaceID != workspaceB.ID || knownRefs[0].ThreadID != targetThread.ID {
		t.Fatalf("expected first known thread ref to target %q/%q, got %#v", workspaceB.ID, targetThread.ID, knownRefs[0])
	}
	if knownRefs[1].WorkspaceID != workspaceB.ID || knownRefs[1].ThreadID != "thread-bot-2" {
		t.Fatalf("expected second known thread ref to target %q/thread-bot-2, got %#v", workspaceB.ID, knownRefs[1])
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

func TestUpdateConversationBindingSwitchesExistingThread(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	threadsExec := newFakeBotThreads()
	service := NewService(dataStore, threadsExec, nil, nil, Config{})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "telegram",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
		AIConfig: map[string]string{
			"model": "gpt-5.4",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	firstThread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Thread One"})
	if err != nil {
		t.Fatalf("Create(firstThread) error = %v", err)
	}
	secondThread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Thread Two"})
	if err != nil {
		t.Fatalf("Create(secondThread) error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:  workspace.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		ThreadID:     firstThread.ID,
		BackendState: conversationBackendStateWithVersion(
			conversationBackendStateWithKnownThreads(nil, []string{firstThread.ID}),
			0,
		),
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	updated, err := service.UpdateConversationBinding(context.Background(), workspace.ID, connection.ID, conversation.ID, UpdateConversationBindingInput{
		ThreadID: secondThread.ID,
	})
	if err != nil {
		t.Fatalf("UpdateConversationBinding() error = %v", err)
	}
	if updated.ThreadID != secondThread.ID {
		t.Fatalf("expected updated thread id %q, got %#v", secondThread.ID, updated)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatal("expected updated conversation to be persisted")
	}
	if storedConversation.ThreadID != secondThread.ID {
		t.Fatalf("expected stored thread id %q, got %#v", secondThread.ID, storedConversation)
	}
	if conversationContextVersion(storedConversation) != 1 {
		t.Fatalf("expected context version 1 after thread switch, got %#v", storedConversation.BackendState)
	}

	knownThreadIDs := knownConversationThreadIDs(storedConversation)
	if len(knownThreadIDs) != 2 || knownThreadIDs[0] != firstThread.ID || knownThreadIDs[1] != secondThread.ID {
		t.Fatalf("expected known thread list to preserve both bindings, got %#v", knownThreadIDs)
	}
}

func TestUpdateConversationBindingCreatesAndBindsNewThread(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	threadsExec := newFakeBotThreads()
	service := NewService(dataStore, threadsExec, nil, nil, Config{})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "telegram",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
		AIConfig: map[string]string{
			"model": "gpt-5.4",
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
		ExternalUsername:       "alice",
		ExternalTitle:          "Alice",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	updated, err := service.UpdateConversationBinding(context.Background(), workspace.ID, connection.ID, conversation.ID, UpdateConversationBindingInput{
		CreateThread: true,
		Title:        "VIP Queue",
	})
	if err != nil {
		t.Fatalf("UpdateConversationBinding(createThread) error = %v", err)
	}
	if updated.ThreadID == "" {
		t.Fatalf("expected new thread id to be returned, got %#v", updated)
	}

	detail, err := threadsExec.GetDetail(context.Background(), workspace.ID, updated.ThreadID)
	if err != nil {
		t.Fatalf("GetDetail(newThread) error = %v", err)
	}
	if detail.Name != "Support Bot · VIP Queue" {
		t.Fatalf("expected created thread name to use requested title, got %#v", detail)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatal("expected updated conversation to be persisted")
	}
	if storedConversation.ThreadID != updated.ThreadID {
		t.Fatalf("expected stored thread id %q, got %#v", updated.ThreadID, storedConversation)
	}
	if conversationContextVersion(storedConversation) != 1 {
		t.Fatalf("expected context version 1 after new thread binding, got %#v", storedConversation.BackendState)
	}
}

func TestClearConversationBindingRemovesCurrentThread(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	threadsExec := newFakeBotThreads()
	service := NewService(dataStore, threadsExec, nil, nil, Config{})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "telegram",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	thread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Thread One"})
	if err != nil {
		t.Fatalf("Create(thread) error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:  workspace.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		ThreadID:     thread.ID,
		BackendState: conversationBackendStateWithVersion(
			conversationBackendStateWithKnownThreads(nil, []string{thread.ID}),
			0,
		),
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	updated, err := service.ClearConversationBinding(context.Background(), workspace.ID, connection.ID, conversation.ID)
	if err != nil {
		t.Fatalf("ClearConversationBinding() error = %v", err)
	}
	if updated.ThreadID != "" {
		t.Fatalf("expected thread binding to be cleared, got %#v", updated)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatal("expected updated conversation to be persisted")
	}
	if storedConversation.ThreadID != "" {
		t.Fatalf("expected stored thread binding to be cleared, got %#v", storedConversation)
	}
	if conversationContextVersion(storedConversation) != 1 {
		t.Fatalf("expected context version 1 after clearing binding, got %#v", storedConversation.BackendState)
	}

	knownThreadIDs := knownConversationThreadIDs(storedConversation)
	if len(knownThreadIDs) != 1 || knownThreadIDs[0] != thread.ID {
		t.Fatalf("expected cleared binding to keep thread in history, got %#v", knownThreadIDs)
	}
}

func TestClearConversationBindingMarksNextThreadStartAsClear(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	threadsExec := newFakeBotThreads()
	service := NewService(dataStore, threadsExec, nil, nil, Config{})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "telegram",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	thread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Thread One"})
	if err != nil {
		t.Fatalf("Create(thread) error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:  workspace.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		ThreadID:     thread.ID,
		BackendState: conversationBackendStateWithVersion(
			conversationBackendStateWithKnownThreads(nil, []string{thread.ID}),
			0,
		),
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	if _, err := service.ClearConversationBinding(context.Background(), workspace.ID, connection.ID, conversation.ID); err != nil {
		t.Fatalf("ClearConversationBinding() error = %v", err)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatal("expected updated conversation to be persisted")
	}
	if got := pendingConversationSessionStartSource(storedConversation.BackendState); got != threads.ThreadStartSourceClear {
		t.Fatalf("expected next thread start source clear after binding clear, got %#v", got)
	}
}

func TestUpdateConversationBindingCreateThreadUsesClearSessionStartSourceAfterClear(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	threadsExec := newFakeBotThreads()
	service := NewService(dataStore, threadsExec, nil, nil, Config{})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "telegram",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
		AIConfig: map[string]string{
			"model": "gpt-5.4",
		},
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	thread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Thread One"})
	if err != nil {
		t.Fatalf("Create(thread) error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:  workspace.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		ThreadID:     thread.ID,
		BackendState: conversationBackendStateWithVersion(
			conversationBackendStateWithKnownThreads(nil, []string{thread.ID}),
			0,
		),
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	if _, err := service.ClearConversationBinding(context.Background(), workspace.ID, connection.ID, conversation.ID); err != nil {
		t.Fatalf("ClearConversationBinding() error = %v", err)
	}

	updated, err := service.UpdateConversationBinding(context.Background(), workspace.ID, connection.ID, conversation.ID, UpdateConversationBindingInput{
		CreateThread: true,
		Title:        "Fresh Queue",
	})
	if err != nil {
		t.Fatalf("UpdateConversationBinding(createThread) error = %v", err)
	}
	if updated.ThreadID == "" {
		t.Fatalf("expected new thread id to be returned, got %#v", updated)
	}
	if got := threadsExec.lastCreateInput.SessionStartSource; got != threads.ThreadStartSourceClear {
		t.Fatalf("expected created thread to use clear session start source, got %#v", got)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspace.ID, conversation.ID)
	if !ok {
		t.Fatal("expected updated conversation to be persisted")
	}
	if got := pendingConversationSessionStartSource(storedConversation.BackendState); got != "" {
		t.Fatalf("expected clear session start source marker to be consumed after new thread creation, got %#v", got)
	}
}

func TestUpdateConversationBindingSwitchesExistingThreadAcrossWorkspaces(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	threadsExec := newFakeBotThreads()
	service := NewService(dataStore, threadsExec, nil, nil, Config{})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspaceA.ID,
		Provider:    "telegram",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	targetThread, err := threadsExec.Create(context.Background(), workspaceB.ID, threads.CreateInput{Name: "Workspace B Thread"})
	if err != nil {
		t.Fatalf("Create(targetThread) error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:  workspaceA.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	updated, err := service.UpdateConversationBinding(context.Background(), workspaceA.ID, connection.ID, conversation.ID, UpdateConversationBindingInput{
		ThreadID:          targetThread.ID,
		TargetWorkspaceID: workspaceB.ID,
	})
	if err != nil {
		t.Fatalf("UpdateConversationBinding() error = %v", err)
	}
	if updated.ThreadID != targetThread.ID {
		t.Fatalf("expected updated thread id %q, got %#v", targetThread.ID, updated)
	}
	if updated.ResolvedTargetWorkspaceID != workspaceB.ID {
		t.Fatalf("expected resolved target workspace %q, got %#v", workspaceB.ID, updated)
	}
	if updated.ResolvedTargetThreadID != targetThread.ID {
		t.Fatalf("expected resolved target thread %q, got %#v", targetThread.ID, updated)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspaceA.ID, conversation.ID)
	if !ok {
		t.Fatal("expected updated conversation to be persisted")
	}
	if strings.TrimSpace(storedConversation.BindingID) == "" {
		t.Fatalf("expected conversation binding id to be persisted, got %#v", storedConversation)
	}

	storedBinding, ok := dataStore.GetBotBinding(workspaceA.ID, storedConversation.BindingID)
	if !ok {
		t.Fatalf("expected stored session binding %q", storedConversation.BindingID)
	}
	if storedBinding.TargetWorkspaceID != workspaceB.ID || storedBinding.TargetThreadID != targetThread.ID {
		t.Fatalf("expected cross-workspace binding target, got %#v", storedBinding)
	}
}

func TestUpdateConversationBindingCreatesAndBindsNewThreadAcrossWorkspaces(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	threadsExec := newFakeBotThreads()
	service := NewService(dataStore, threadsExec, nil, nil, Config{})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspaceA.ID,
		Provider:    "telegram",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspaceA.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-cross-1",
		ExternalChatID:         "chat-cross-1",
		ExternalUsername:       "alice",
		ExternalTitle:          "Alice",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	updated, err := service.UpdateConversationBinding(context.Background(), workspaceA.ID, connection.ID, conversation.ID, UpdateConversationBindingInput{
		CreateThread:      true,
		Title:             "VIP Queue",
		TargetWorkspaceID: workspaceB.ID,
	})
	if err != nil {
		t.Fatalf("UpdateConversationBinding(createThread) error = %v", err)
	}
	if updated.ThreadID == "" {
		t.Fatalf("expected new cross-workspace thread id to be returned, got %#v", updated)
	}
	if updated.ResolvedTargetWorkspaceID != workspaceB.ID {
		t.Fatalf("expected resolved target workspace %q, got %#v", workspaceB.ID, updated)
	}

	detail, err := threadsExec.GetDetail(context.Background(), workspaceB.ID, updated.ThreadID)
	if err != nil {
		t.Fatalf("GetDetail(newThread) error = %v", err)
	}
	if detail.Thread.WorkspaceID != workspaceB.ID {
		t.Fatalf("expected created thread workspace %q, got %#v", workspaceB.ID, detail.Thread)
	}
	if detail.Name != "Support Bot · VIP Queue" {
		t.Fatalf("expected created thread name to use requested title, got %#v", detail)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspaceA.ID, conversation.ID)
	if !ok {
		t.Fatal("expected updated conversation to be persisted")
	}
	storedBinding, ok := dataStore.GetBotBinding(workspaceA.ID, storedConversation.BindingID)
	if !ok {
		t.Fatalf("expected stored session binding %q", storedConversation.BindingID)
	}
	if storedBinding.TargetWorkspaceID != workspaceB.ID || storedBinding.TargetThreadID != updated.ThreadID {
		t.Fatalf("expected stored binding to target new cross-workspace thread, got %#v", storedBinding)
	}
}

func TestHandleWebhookAppliesDefaultFixedThreadBindingAtRuntime(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		Name:      "Support Bot",
		AIBackend: defaultAIBackend,
		AIConfig: map[string]string{
			"model": "gpt-5.4",
		},
		Secrets: map[string]string{
			"bot_token": "token-runtime-binding",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	targetThread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Bound Thread"})
	if err != nil {
		t.Fatalf("Create(targetThread) error = %v", err)
	}

	updatedBinding, err := service.UpdateBotDefaultBinding(context.Background(), workspace.ID, connection.BotID, UpdateBotDefaultBindingInput{
		BindingMode:    "fixed_thread",
		TargetThreadID: targetThread.ID,
	})
	if err != nil {
		t.Fatalf("UpdateBotDefaultBinding() error = %v", err)
	}
	if updatedBinding.TargetThreadID != targetThread.ID {
		t.Fatalf("expected default binding target thread %q, got %#v", targetThread.ID, updatedBinding)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-binding-runtime-1",
		"messageId":"msg-binding-runtime-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello binding runtime"
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
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello binding runtime" {
			t.Fatalf("unexpected provider reply payload %#v", sent)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for provider reply")
	}

	if calls := turnsExec.threadCalls(); len(calls) != 1 || calls[0] != targetThread.ID {
		t.Fatalf("expected turn to start on bound thread %q, got %#v", targetThread.ID, calls)
	}
	if workspaces := turnsExec.workspaceCalls(); len(workspaces) != 1 || workspaces[0] != workspace.ID {
		t.Fatalf("expected turn to stay in source workspace %q, got %#v", workspace.ID, workspaces)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			conversations[0].ThreadID == targetThread.ID &&
			conversations[0].LastOutboundText == "reply: hello binding runtime" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected conversation to settle on bound thread %q, got %#v", targetThread.ID, conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHandleWebhookPrefersConversationBindingOverDefaultBindingAtRuntime(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "fakechat",
		Name:      "Support Bot",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-binding-priority",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	defaultThread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Default Thread"})
	if err != nil {
		t.Fatalf("Create(defaultThread) error = %v", err)
	}
	sessionThread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Session Thread"})
	if err != nil {
		t.Fatalf("Create(sessionThread) error = %v", err)
	}

	if _, err := service.UpdateBotDefaultBinding(context.Background(), workspace.ID, connection.BotID, UpdateBotDefaultBindingInput{
		BindingMode:    "fixed_thread",
		TargetThreadID: defaultThread.ID,
	}); err != nil {
		t.Fatalf("UpdateBotDefaultBinding() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		BotID:                  connection.BotID,
		WorkspaceID:            workspace.ID,
		ConnectionID:           connection.ID,
		Provider:               connection.Provider,
		ExternalConversationID: "chat-binding-priority-1",
		ExternalChatID:         "chat-binding-priority-1",
		ExternalUserID:         "user-1",
		ExternalUsername:       "alice",
		ExternalTitle:          "Alice",
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	updatedConversation, err := service.UpdateConversationBinding(context.Background(), workspace.ID, connection.ID, conversation.ID, UpdateConversationBindingInput{
		ThreadID: sessionThread.ID,
	})
	if err != nil {
		t.Fatalf("UpdateConversationBinding() error = %v", err)
	}
	if updatedConversation.ThreadID != sessionThread.ID {
		t.Fatalf("expected session binding thread %q, got %#v", sessionThread.ID, updatedConversation)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-binding-priority-1",
		"messageId":"msg-binding-priority-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello binding priority"
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
	case <-provider.sentCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for provider reply")
	}

	if calls := turnsExec.threadCalls(); len(calls) != 1 || calls[0] != sessionThread.ID {
		t.Fatalf("expected session binding to win over default thread %q, got %#v", sessionThread.ID, calls)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			conversations[0].ThreadID == sessionThread.ID &&
			strings.TrimSpace(conversations[0].BindingID) != "" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected conversation to keep session binding on thread %q, got %#v", sessionThread.ID, conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHandleWebhookAppliesCrossWorkspaceDefaultBindingAtRuntime(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspaceA.ID, CreateConnectionInput{
		Provider:  "fakechat",
		Name:      "Support Bot",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-cross-workspace",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	targetThread, err := threadsExec.Create(context.Background(), workspaceB.ID, threads.CreateInput{Name: "Cross Workspace Thread"})
	if err != nil {
		t.Fatalf("Create(targetThread) error = %v", err)
	}

	updatedBinding, err := service.UpdateBotDefaultBinding(context.Background(), workspaceA.ID, connection.BotID, UpdateBotDefaultBindingInput{
		BindingMode:       "fixed_thread",
		TargetWorkspaceID: workspaceB.ID,
		TargetThreadID:    targetThread.ID,
	})
	if err != nil {
		t.Fatalf("UpdateBotDefaultBinding() error = %v", err)
	}
	if updatedBinding.TargetWorkspaceID != workspaceB.ID {
		t.Fatalf("expected default binding target workspace %q, got %#v", workspaceB.ID, updatedBinding)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-cross-workspace-1",
		"messageId":"msg-cross-workspace-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello cross workspace"
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
	case <-provider.sentCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for provider reply")
	}

	if calls := turnsExec.threadCalls(); len(calls) != 1 || calls[0] != targetThread.ID {
		t.Fatalf("expected turn to start on cross-workspace thread %q, got %#v", targetThread.ID, calls)
	}
	if workspaces := turnsExec.workspaceCalls(); len(workspaces) != 1 || workspaces[0] != workspaceB.ID {
		t.Fatalf("expected turn workspace %q, got %#v", workspaceB.ID, workspaces)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversationViews(workspaceA.ID, connection.ID)
		if len(conversations) == 1 && conversations[0].ThreadID == targetThread.ID {
			if conversations[0].WorkspaceID != workspaceA.ID {
				t.Fatalf("expected provider conversation to remain in workspace %q, got %#v", workspaceA.ID, conversations[0])
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected conversation to settle on cross-workspace thread %q, got %#v", targetThread.ID, conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestResolveConversationExecutionContextUsesKnownThreadWorkspaceForLegacyWorkspaceAutoThreadConversation(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	workspaceC := dataStore.CreateWorkspace("Workspace C", "E:/projects/c")
	service := NewService(dataStore, nil, nil, nil, Config{})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspaceA.ID,
		Provider:    "telegram",
		Name:        "Support Bot",
		Status:      "active",
		AIBackend:   defaultAIBackend,
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	connection, bot, defaultBinding, err := service.ensureConnectionBotResources(connection)
	if err != nil {
		t.Fatalf("ensureConnectionBotResources() error = %v", err)
	}
	if _, err := dataStore.UpdateBotBinding(workspaceA.ID, defaultBinding.ID, func(current store.BotBinding) store.BotBinding {
		current.BindingMode = "workspace_auto_thread"
		current.TargetWorkspaceID = workspaceC.ID
		current.TargetThreadID = ""
		return current
	}); err != nil {
		t.Fatalf("UpdateBotBinding() error = %v", err)
	}

	conversation, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:  workspaceA.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		ThreadID:     "thread-legacy-b",
		BackendState: conversationBackendStateWithKnownThreadRefs(nil, []botThreadRef{
			{WorkspaceID: workspaceB.ID, ThreadID: "thread-legacy-b"},
		}),
	})
	if err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}

	executionConnection, executionConversation := service.resolveConversationExecutionContext(connection, conversation)
	if executionConnection.WorkspaceID != workspaceB.ID {
		t.Fatalf("expected execution workspace %q, got %#v", workspaceB.ID, executionConnection)
	}
	if executionConversation.ThreadID != "thread-legacy-b" {
		t.Fatalf("expected execution thread thread-legacy-b, got %#v", executionConversation)
	}

	conversations := service.ListConversationViews(workspaceA.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %#v", conversations)
	}
	if conversations[0].ResolvedTargetWorkspaceID != workspaceB.ID {
		t.Fatalf("expected resolved target workspace %q, got %#v", workspaceB.ID, conversations[0])
	}
	if conversations[0].ResolvedTargetThreadID != "thread-legacy-b" {
		t.Fatalf("expected resolved target thread thread-legacy-b, got %#v", conversations[0])
	}
}

func TestHandleWebhookKeepsExistingCrossWorkspaceAutoThreadAfterDefaultBindingRetarget(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	workspaceC := dataStore.CreateWorkspace("Workspace C", "E:/projects/c")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspaceA.ID, CreateConnectionInput{
		Provider:  "fakechat",
		Name:      "Support Bot",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-auto-thread-retarget",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	if _, err := service.UpdateBotDefaultBinding(context.Background(), workspaceA.ID, connection.BotID, UpdateBotDefaultBindingInput{
		BindingMode:       "workspace_auto_thread",
		TargetWorkspaceID: workspaceB.ID,
	}); err != nil {
		t.Fatalf("UpdateBotDefaultBinding(workspaceB) error = %v", err)
	}

	sendWebhook := func(messageID string, text string) {
		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
			"conversationId":"chat-auto-thread-retarget-1",
			"messageId":"%s",
			"userId":"user-1",
			"username":"alice",
			"title":"Alice",
			"text":"%s"
		}`, messageID, text)))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		if result.Accepted != 1 {
			t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
		}
	}
	expectReply := func(expected string) {
		select {
		case sent := <-provider.sentCh:
			if len(sent.Messages) != 1 || sent.Messages[0].Text != expected {
				t.Fatalf("expected sent message %q, got %#v", expected, sent.Messages)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for sent message %q", expected)
		}
	}

	sendWebhook("msg-1", "hello auto thread")
	expectReply("reply: hello auto thread")

	firstThreadID := ""
	conversationID := ""
	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversationViews(workspaceA.ID, connection.ID)
		if len(conversations) == 1 && conversations[0].ThreadID != "" {
			firstThreadID = conversations[0].ThreadID
			conversationID = conversations[0].ID
			if conversations[0].ResolvedTargetWorkspaceID != workspaceB.ID {
				t.Fatalf("expected first resolved workspace %q, got %#v", workspaceB.ID, conversations[0])
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected auto-thread conversation to settle in workspace %q, got %#v", workspaceB.ID, conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}

	storedConversation, ok := dataStore.GetBotConversation(workspaceA.ID, conversationID)
	if !ok {
		t.Fatalf("expected stored conversation %q", conversationID)
	}
	currentRef := currentConversationThreadRefFromState(storedConversation.BackendState, workspaceA.ID)
	if currentRef.WorkspaceID != workspaceB.ID || currentRef.ThreadID != firstThreadID {
		t.Fatalf("expected stored current thread ref %q/%q, got %#v", workspaceB.ID, firstThreadID, currentRef)
	}

	if _, err := service.UpdateBotDefaultBinding(context.Background(), workspaceA.ID, connection.BotID, UpdateBotDefaultBindingInput{
		BindingMode:       "workspace_auto_thread",
		TargetWorkspaceID: workspaceC.ID,
	}); err != nil {
		t.Fatalf("UpdateBotDefaultBinding(workspaceC) error = %v", err)
	}

	sendWebhook("msg-2", "hello after retarget")
	expectReply("reply: hello after retarget")

	deadline = time.Now().Add(2 * time.Second)
	for {
		threadCalls := turnsExec.threadCalls()
		workspaceCalls := turnsExec.workspaceCalls()
		conversations := service.ListConversationViews(workspaceA.ID, connection.ID)
		if len(threadCalls) == 2 && len(workspaceCalls) == 2 && len(conversations) == 1 {
			if workspaceCalls[0] != workspaceB.ID || workspaceCalls[1] != workspaceB.ID {
				t.Fatalf("expected both AI turns to stay in workspace %q, got %#v", workspaceB.ID, workspaceCalls)
			}
			if threadCalls[0] != firstThreadID || threadCalls[1] != firstThreadID {
				t.Fatalf("expected both AI turns to stay on thread %q, got %#v", firstThreadID, threadCalls)
			}
			if conversations[0].ResolvedTargetWorkspaceID != workspaceB.ID || conversations[0].ResolvedTargetThreadID != firstThreadID {
				t.Fatalf("expected conversation view to stay on %q/%q, got %#v", workspaceB.ID, firstThreadID, conversations[0])
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected retargeted auto-thread conversation to stay on %q/%q, threadCalls=%#v workspaceCalls=%#v conversations=%#v", workspaceB.ID, firstThreadID, threadCalls, workspaceCalls, conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHandleWebhookStreamingAppliesDefaultFixedThreadBindingAtRuntime(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeStreamingProvider()
	threadsExec := newFakeBotThreads()
	turnsExec := &fakeBotTurns{threads: threadsExec}

	service := NewService(dataStore, threadsExec, turnsExec, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "streamchat",
		Name:      "Support Bot",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-stream-binding",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	targetThread, err := threadsExec.Create(context.Background(), workspace.ID, threads.CreateInput{Name: "Streaming Bound Thread"})
	if err != nil {
		t.Fatalf("Create(targetThread) error = %v", err)
	}

	if _, err := service.UpdateBotDefaultBinding(context.Background(), workspace.ID, connection.BotID, UpdateBotDefaultBindingInput{
		BindingMode:    "fixed_thread",
		TargetThreadID: targetThread.ID,
	}); err != nil {
		t.Fatalf("UpdateBotDefaultBinding() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-stream-binding-1",
		"messageId":"msg-stream-binding-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello streaming binding"
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
	sendMessagesCalls := provider.sendMessagesCalls
	completedMessages := append([]OutboundMessage(nil), provider.completedMessages...)
	provider.mu.Unlock()

	if sendMessagesCalls != 0 {
		t.Fatalf("expected streaming provider to avoid SendMessages fallback, got %d calls", sendMessagesCalls)
	}
	if len(completedMessages) != 1 || completedMessages[0].Text != "reply: hello streaming binding" {
		t.Fatalf("unexpected completed streaming messages %#v", completedMessages)
	}
	if calls := turnsExec.threadCalls(); len(calls) != 1 || calls[0] != targetThread.ID {
		t.Fatalf("expected streaming turn to use bound thread %q, got %#v", targetThread.ID, calls)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			conversations[0].ThreadID == targetThread.ID &&
			conversations[0].LastOutboundText == "reply: hello streaming binding" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected streaming conversation to settle on bound thread %q, got %#v", targetThread.ID, conversations)
		}
		time.Sleep(10 * time.Millisecond)
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

func TestServiceUpdateConnectionRestartsActiveWeChatPoller(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatPollingProvider()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{fakeAIBackend{}},
	})
	service.Start(ctx)

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  "wechat",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      "https://wechat.example.com",
			wechatAccountIDSetting:    "wechat-account-update",
			wechatOwnerUserIDSetting:  "wechat-owner-update",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-update",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if provider.startedCount() == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if provider.startedCount() != 1 {
		t.Fatalf("expected initial wechat poller to start once, got %d", provider.startedCount())
	}

	updated, err := service.UpdateConnection(context.Background(), workspace.ID, connection.ID, UpdateConnectionInput{
		Provider:  "wechat",
		Name:      "WeChat Bot Updated",
		AIBackend: "fake_ai",
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      "https://wechat.example.com",
			wechatAccountIDSetting:    "wechat-account-update",
			wechatOwnerUserIDSetting:  "wechat-owner-update",
			wechatRouteTagSetting:     "route-tag-updated",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token-update",
		},
	})
	if err != nil {
		t.Fatalf("UpdateConnection() error = %v", err)
	}
	if updated.Name != "WeChat Bot Updated" {
		t.Fatalf("expected updated connection name, got %#v", updated)
	}

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if provider.startedCount() == 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if provider.startedCount() != 2 {
		t.Fatalf("expected active wechat poller to restart after update, got %d starts", provider.startedCount())
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

func TestHandleWebhookAggregatesTelegramMediaGroupsIntoSingleInboundDelivery(t *testing.T) {
	t.Parallel()

	groupID := "group-album-1"
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeTelegramWebhookProvider()
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-album-1",
			Messages: []OutboundMessage{
				{Text: "album reply"},
			},
		},
	}

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{backend},
	})
	service.telegramMediaGroupQuiet = 30 * time.Millisecond
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  telegramProviderName,
		AIBackend: "scripted_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	send := func(message InboundMessage) WebhookResult {
		payload, err := json.Marshal(message)
		if err != nil {
			t.Fatalf("json.Marshal() error = %v", err)
		}
		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(string(payload)))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		return result
	}

	firstResult := send(InboundMessage{
		ConversationID: "chat-album-1",
		ExternalChatID: "chat-album-1",
		MessageID:      "101",
		UserID:         "user-1",
		Username:       "alice",
		Title:          "Alice",
		Text:           "album caption",
		Media: []store.BotMessageMedia{
			{
				Kind:        botMediaKindImage,
				Path:        "C:/tmp/album-1.jpg",
				FileName:    "album-1.jpg",
				ContentType: "image/jpeg",
			},
		},
		ProviderData: map[string]string{
			telegramMediaGroupIDProviderDataKey: groupID,
			telegramMediaKindProviderDataKey:    botMediaKindImage,
			telegramMediaFileIDProviderDataKey:  "file-101",
		},
	})
	if firstResult.Accepted != 1 {
		t.Fatalf("expected first media-group item to be accepted into buffer, got %d", firstResult.Accepted)
	}

	secondResult := send(InboundMessage{
		ConversationID: "chat-album-1",
		ExternalChatID: "chat-album-1",
		MessageID:      "102",
		UserID:         "user-1",
		Username:       "alice",
		Title:          "Alice",
		Media: []store.BotMessageMedia{
			{
				Kind:        botMediaKindImage,
				Path:        "C:/tmp/album-2.jpg",
				FileName:    "album-2.jpg",
				ContentType: "image/jpeg",
			},
		},
		ProviderData: map[string]string{
			telegramMediaGroupIDProviderDataKey: groupID,
			telegramMediaKindProviderDataKey:    botMediaKindImage,
			telegramMediaFileIDProviderDataKey:  "file-102",
		},
	})
	if secondResult.Accepted != 0 {
		t.Fatalf("expected subsequent media-group item to merge into existing buffer, got %d", secondResult.Accepted)
	}

	select {
	case sent := <-provider.sentCh:
		if sent.ConnectionID != connection.ID {
			t.Fatalf("expected sent connection id %q, got %q", connection.ID, sent.ConnectionID)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "album reply" {
			t.Fatalf("expected aggregated ai reply to be forwarded, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for aggregated Telegram reply")
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected ai backend to run once for Telegram media group, got %d calls", backend.callCount())
	}

	inbound := backend.lastInboundMessage()
	if !strings.HasPrefix(inbound.MessageID, "telegram-media-group:group-album-1:2:") {
		t.Fatalf("expected synthetic media-group message id, got %#v", inbound)
	}
	if !strings.Contains(inbound.Text, "album caption") {
		t.Fatalf("expected AI-bound inbound text to retain caption, got %#v", inbound)
	}
	if !strings.Contains(inbound.Text, "[Image attachment]") {
		t.Fatalf("expected AI-bound inbound text to include media summary, got %#v", inbound)
	}
	if len(inbound.Media) != 2 {
		t.Fatalf("expected 2 media items after aggregation, got %#v", inbound.Media)
	}
	if inbound.ProviderData[telegramMediaGroupIDProviderDataKey] != "group-album-1" {
		t.Fatalf("expected media_group_id to be preserved, got %#v", inbound.ProviderData)
	}
	if inbound.ProviderData[telegramMediaGroupMessageIDsProviderDataKey] != "101,102" {
		t.Fatalf("expected aggregated message ids to be preserved, got %#v", inbound.ProviderData)
	}
	if _, ok := inbound.ProviderData[telegramMediaFileIDProviderDataKey]; ok {
		t.Fatalf("did not expect single-item file_id provider data on aggregated album, got %#v", inbound.ProviderData)
	}
	if _, ok := inbound.ProviderData[telegramMediaKindProviderDataKey]; ok {
		t.Fatalf("did not expect single-item media kind provider data on aggregated album, got %#v", inbound.ProviderData)
	}

	deadline := time.Now().Add(2 * time.Second)
	var outboundDeliveries []store.BotOutboundDelivery
	for time.Now().Before(deadline) {
		outboundDeliveries = dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
			BotID:          connection.BotID,
			ConversationID: "",
			SourceType:     "reply",
		})
		if len(outboundDeliveries) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(outboundDeliveries) != 1 {
		t.Fatalf("expected 1 outbound reply delivery after aggregation, got %#v", outboundDeliveries)
	}

	inboundDelivery, ok := dataStore.GetBotInboundDelivery(workspace.ID, outboundDeliveries[0].SourceRefID)
	if !ok {
		t.Fatalf("expected outbound delivery source ref %q to resolve to inbound delivery", outboundDeliveries[0].SourceRefID)
	}
	if !strings.HasPrefix(inboundDelivery.MessageID, "telegram-media-group:group-album-1:2:") {
		t.Fatalf("expected stored inbound delivery to use synthetic album id, got %#v", inboundDelivery)
	}
	if inboundDelivery.Text != "album caption" {
		t.Fatalf("expected stored inbound delivery to keep raw caption text, got %#v", inboundDelivery)
	}
	if len(inboundDelivery.Media) != 2 {
		t.Fatalf("expected stored inbound delivery to include aggregated media, got %#v", inboundDelivery.Media)
	}
	if inboundDelivery.ProviderData[telegramMediaGroupMessageIDsProviderDataKey] != "101,102" {
		t.Fatalf("expected stored inbound delivery to keep grouped message ids, got %#v", inboundDelivery.ProviderData)
	}
}

func TestHandleWebhookProcessesLateTelegramMediaGroupItemsAsFollowUpBatch(t *testing.T) {
	t.Parallel()

	groupID := "group-album-late-1"
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeTelegramWebhookProvider()
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-album-late-1",
			Messages: []OutboundMessage{
				{Text: "album reply"},
			},
		},
	}

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{backend},
	})
	service.telegramMediaGroupQuiet = 30 * time.Millisecond
	service.telegramMediaGroupSeenTTL = 500 * time.Millisecond
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  telegramProviderName,
		AIBackend: "scripted_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	send := func(message InboundMessage) WebhookResult {
		payload, err := json.Marshal(message)
		if err != nil {
			t.Fatalf("json.Marshal() error = %v", err)
		}
		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(string(payload)))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		return result
	}

	baseMessage := func(messageID string, fileName string) InboundMessage {
		return InboundMessage{
			ConversationID: "chat-album-late-1",
			ExternalChatID: "chat-album-late-1",
			MessageID:      messageID,
			UserID:         "user-1",
			Username:       "alice",
			Title:          "Alice",
			Media: []store.BotMessageMedia{
				{
					Kind:        botMediaKindImage,
					Path:        "C:/tmp/" + fileName,
					FileName:    fileName,
					ContentType: "image/jpeg",
				},
			},
			ProviderData: map[string]string{
				telegramMediaGroupIDProviderDataKey: groupID,
				telegramMediaKindProviderDataKey:    botMediaKindImage,
			},
		}
	}

	first := baseMessage("101", "late-album-1.jpg")
	first.Text = "late album caption"
	if result := send(first); result.Accepted != 1 {
		t.Fatalf("expected first album item to enter buffer, got %d", result.Accepted)
	}

	if result := send(baseMessage("102", "late-album-2.jpg")); result.Accepted != 0 {
		t.Fatalf("expected second album item to merge into buffer, got %d", result.Accepted)
	}

	select {
	case <-provider.sentCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for first album batch reply")
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected initial album batch to trigger one AI call, got %d", backend.callCount())
	}

	if result := send(baseMessage("103", "late-album-3.jpg")); result.Accepted != 1 {
		t.Fatalf("expected late album item to open a follow-up buffer, got %d", result.Accepted)
	}
	if result := send(baseMessage("101", "late-album-1.jpg")); result.Accepted != 0 {
		t.Fatalf("expected duplicate old album item to be suppressed after flush, got %d", result.Accepted)
	}

	select {
	case <-provider.sentCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for late album follow-up reply")
	}

	if backend.callCount() != 2 {
		t.Fatalf("expected late Telegram album item to trigger a second AI call, got %d", backend.callCount())
	}

	inbounds := backend.inboundMessages()
	if len(inbounds) != 2 {
		t.Fatalf("expected 2 AI inbound calls, got %#v", inbounds)
	}
	if inbounds[0].MessageID == inbounds[1].MessageID {
		t.Fatalf("expected follow-up batch to use a different synthetic message id, got %#v", inbounds)
	}
	if !strings.HasPrefix(inbounds[0].MessageID, "telegram-media-group:"+groupID+":2:") {
		t.Fatalf("expected first batch to encode 2 grouped items, got %#v", inbounds[0])
	}
	if !strings.HasPrefix(inbounds[1].MessageID, "telegram-media-group:"+groupID+":1:") {
		t.Fatalf("expected late batch to encode 1 grouped item, got %#v", inbounds[1])
	}
	if inbounds[1].ProviderData[telegramMediaGroupLateBatchProviderDataKey] != "true" {
		t.Fatalf("expected late batch marker on follow-up Telegram album message, got %#v", inbounds[1].ProviderData)
	}
	if inbounds[1].ProviderData[telegramMediaGroupMessageIDsProviderDataKey] != "103" {
		t.Fatalf("expected late batch to carry only the late item id, got %#v", inbounds[1].ProviderData)
	}

	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected duplicate old album item not to trigger a third reply, got %#v", sent)
	case <-time.After(300 * time.Millisecond):
	}

	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"telegram_media_group_split_detected",
		[]string{groupID, "late items", "follow-up batch"},
	)
}

func TestPollingAggregatesTelegramMediaGroupsIntoSingleInboundDelivery(t *testing.T) {
	t.Parallel()

	groupID := "group-poll-1"
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeTelegramScriptedPollingProvider([]InboundMessage{
		{
			ConversationID: "chat-poll-album-1",
			ExternalChatID: "chat-poll-album-1",
			MessageID:      "201",
			UserID:         "user-1",
			Username:       "alice",
			Title:          "Alice",
			Text:           "polling album",
			Media: []store.BotMessageMedia{
				{
					Kind:        botMediaKindImage,
					Path:        "C:/tmp/poll-album-1.jpg",
					FileName:    "poll-album-1.jpg",
					ContentType: "image/jpeg",
				},
			},
			ProviderData: map[string]string{
				telegramMediaGroupIDProviderDataKey: groupID,
			},
		},
		{
			ConversationID: "chat-poll-album-1",
			ExternalChatID: "chat-poll-album-1",
			MessageID:      "202",
			UserID:         "user-1",
			Username:       "alice",
			Title:          "Alice",
			Media: []store.BotMessageMedia{
				{
					Kind:        botMediaKindImage,
					Path:        "C:/tmp/poll-album-2.jpg",
					FileName:    "poll-album-2.jpg",
					ContentType: "image/jpeg",
				},
			},
			ProviderData: map[string]string{
				telegramMediaGroupIDProviderDataKey: groupID,
			},
		},
	})
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-poll-album-1",
			Messages: []OutboundMessage{
				{Text: "poll album reply"},
			},
		},
	}

	service := NewService(dataStore, nil, nil, nil, Config{
		Providers:  []Provider{provider},
		AIBackends: []AIBackend{backend},
	})
	service.telegramMediaGroupQuiet = 30 * time.Millisecond
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  telegramProviderName,
		AIBackend: "scripted_ai",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
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
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "poll album reply" {
			t.Fatalf("expected polling aggregated ai reply, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for polling aggregated Telegram reply")
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected polling ai backend to run once for Telegram media group, got %d calls", backend.callCount())
	}

	inbound := backend.lastInboundMessage()
	if !strings.HasPrefix(inbound.MessageID, "telegram-media-group:group-poll-1:2:") {
		t.Fatalf("expected synthetic polling media-group message id, got %#v", inbound)
	}
	if len(inbound.Media) != 2 {
		t.Fatalf("expected polling media group to aggregate 2 media items, got %#v", inbound.Media)
	}
	if inbound.ProviderData[telegramMediaGroupMessageIDsProviderDataKey] != "201,202" {
		t.Fatalf("expected polling grouped message ids to be preserved, got %#v", inbound.ProviderData)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
		if ok && storedConnection.Settings[telegramUpdateOffsetSetting] == "2" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected polling cursor to advance after aggregated media group")
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

func TestPauseResumeConnectionSyncsHealthStateAndLogs(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakePollingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeAIBackend{}},
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

	deadline := time.Now().Add(2 * time.Second)
	for {
		storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
		if !ok {
			t.Fatal("expected polling connection to remain persisted")
		}
		if storedConnection.LastPollAt != nil && storedConnection.LastPollStatus == "success" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected initial polling success state, got %#v", storedConnection)
		}
		time.Sleep(10 * time.Millisecond)
	}

	paused, err := service.PauseConnection(context.Background(), workspace.ID, connection.ID)
	if err != nil {
		t.Fatalf("PauseConnection() error = %v", err)
	}
	if paused.Status != "paused" || paused.LastPollStatus != "paused" {
		t.Fatalf("expected paused connection view to expose paused health state, got %#v", paused)
	}
	if !strings.Contains(paused.LastPollMessage, "participate in routing again") {
		t.Fatalf("expected paused connection message to explain routing suspension, got %#v", paused)
	}

	storedPaused, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected paused connection to remain persisted")
	}
	if storedPaused.LastPollAt == nil ||
		storedPaused.LastPollStatus != "paused" ||
		!strings.Contains(storedPaused.LastPollMessage, "participate in routing again") {
		t.Fatalf("expected paused connection runtime fields to be persisted, got %#v", storedPaused)
	}

	logs, err := service.ListConnectionLogs(workspace.ID, connection.ID)
	if err != nil {
		t.Fatalf("ListConnectionLogs(paused) error = %v", err)
	}
	foundPausedLog := false
	for _, entry := range logs {
		if entry.EventType == "connection_paused" && strings.Contains(entry.Message, "Provider paused") {
			foundPausedLog = true
			break
		}
	}
	if !foundPausedLog {
		t.Fatalf("expected connection_paused log entry, got %#v", logs)
	}

	resumed, err := service.ResumeConnection(context.Background(), workspace.ID, connection.ID, ResumeConnectionInput{})
	if err != nil {
		t.Fatalf("ResumeConnection() error = %v", err)
	}
	if resumed.Status != "active" || resumed.LastPollStatus != "starting" {
		t.Fatalf("expected resumed connection view to expose starting health state, got %#v", resumed)
	}
	if !strings.Contains(resumed.LastPollMessage, "Waiting for the next health update") {
		t.Fatalf("expected resumed connection message to mention health refresh, got %#v", resumed)
	}

	storedResumed, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatal("expected resumed connection to remain persisted")
	}
	if storedResumed.LastPollAt == nil ||
		storedResumed.LastPollStatus != "starting" ||
		!strings.Contains(storedResumed.LastPollMessage, "Waiting for the next health update") {
		t.Fatalf("expected resumed connection runtime fields to be persisted, got %#v", storedResumed)
	}

	logs, err = service.ListConnectionLogs(workspace.ID, connection.ID)
	if err != nil {
		t.Fatalf("ListConnectionLogs(resumed) error = %v", err)
	}
	foundResumedLog := false
	for _, entry := range logs {
		if entry.EventType == "connection_resumed" && strings.Contains(entry.Message, "Provider resumed") {
			foundResumedLog = true
			break
		}
	}
	if !foundResumedLog {
		t.Fatalf("expected connection_resumed log entry, got %#v", logs)
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
	var conversations []store.BotConversation
	for {
		conversations = service.ListConversations(workspace.ID, connection.ID)
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

	var outboundDeliveries []store.BotOutboundDelivery
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		outboundDeliveries = dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
			BotID:          connection.BotID,
			ConversationID: conversations[0].ID,
			SourceType:     "reply",
		})
		if len(outboundDeliveries) == 1 && outboundDeliveries[0].Status == "delivered" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(outboundDeliveries) != 1 {
		t.Fatalf("expected a single streaming reply outbound delivery, got %#v", outboundDeliveries)
	}
	if outboundDeliveries[0].Status != "delivered" ||
		outboundDeliveries[0].SourceRefType != "inbound_delivery" ||
		strings.TrimSpace(outboundDeliveries[0].SourceRefID) == "" {
		t.Fatalf("expected delivered streaming reply outbound delivery linked to inbound delivery, got %#v", outboundDeliveries[0])
	}
	if len(outboundDeliveries[0].Messages) != 1 || outboundDeliveries[0].Messages[0].Text != "final: hello streaming" {
		t.Fatalf("expected streaming reply outbound delivery to persist final reply payload, got %#v", outboundDeliveries[0].Messages)
	}
	if _, ok := dataStore.GetBotInboundDelivery(workspace.ID, outboundDeliveries[0].SourceRefID); !ok {
		t.Fatalf("expected streaming outbound delivery source ref %q to resolve to inbound delivery", outboundDeliveries[0].SourceRefID)
	}
}

func TestServiceAppendsTimingToWeChatStreamingReplyInDebugMode(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatStreamingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeStreamingAIBackend{}},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "stream_ai",
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
		Secrets: map[string]string{
			"bot_token": "wechat-stream-debug-token-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	createdAtMS := time.Now().Add(-2 * time.Second).UnixMilli()
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
		"conversationId":"chat-wechat-stream-debug-1",
		"messageId":"msg-wechat-stream-debug-1",
		"userId":"wechat-user-stream-debug-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello streaming debug",
		"providerData":{"wechat_created_at_ms":"%d"}
	}`, createdAtMS)))
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
		t.Fatal("timed out waiting for WeChat streaming completion")
	}

	provider.mu.Lock()
	updates := append([][]OutboundMessage(nil), provider.updates...)
	completedMessages := append([]OutboundMessage(nil), provider.completedMessages...)
	sendMessagesCalls := provider.sendMessagesCalls
	provider.mu.Unlock()

	if sendMessagesCalls != 0 {
		t.Fatalf("expected WeChat streaming reply to avoid SendMessages fallback, got %d calls", sendMessagesCalls)
	}
	if len(updates) != 3 {
		t.Fatalf("expected 3 streaming updates including pending state, got %#v", updates)
	}
	if len(updates[2]) != 1 ||
		!strings.Contains(updates[2][0].Text, "reply: hello streaming debug") ||
		strings.Contains(updates[2][0].Text, "Channel timing") {
		t.Fatalf("expected incremental updates to stay unchanged, got %#v", updates)
	}
	if len(completedMessages) != 1 {
		t.Fatalf("expected a single completed WeChat streaming message, got %#v", completedMessages)
	}
	if got := completedMessages[0].Text; !strings.Contains(got, "final: hello streaming debug") ||
		!strings.Contains(got, "Channel timing") ||
		!strings.Contains(got, "Platform->backend:") ||
		!strings.Contains(got, "Backend processing:") {
		t.Fatalf("expected completed WeChat streaming reply to include timing summary, got %#v", completedMessages[0])
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			conversations[0].ThreadID == "thr_chat-wechat-stream-debug-1" &&
			strings.Contains(conversations[0].LastOutboundText, "final: hello streaming debug") &&
			strings.Contains(conversations[0].LastOutboundText, "Channel timing") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected WeChat streaming debug conversation state to settle, got %#v", conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestServiceAppendsStandaloneTimingToWeChatStreamingReplyWhenFinalMessageHasMedia(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatStreamingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeStreamingMediaAIBackend{}},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
		Provider:  wechatProviderName,
		AIBackend: "stream_media_ai",
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
		Secrets: map[string]string{
			"bot_token": "wechat-stream-debug-media-token-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	createdAtMS := time.Now().Add(-2 * time.Second).UnixMilli()
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(fmt.Sprintf(`{
		"conversationId":"chat-wechat-stream-debug-media-1",
		"messageId":"msg-wechat-stream-debug-media-1",
		"userId":"wechat-user-stream-debug-media-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello streaming debug media",
		"providerData":{"wechat_created_at_ms":"%d"}
	}`, createdAtMS)))
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
		t.Fatal("timed out waiting for WeChat streaming media completion")
	}

	provider.mu.Lock()
	updates := append([][]OutboundMessage(nil), provider.updates...)
	completedMessages := append([]OutboundMessage(nil), provider.completedMessages...)
	sendMessagesCalls := provider.sendMessagesCalls
	provider.mu.Unlock()

	if sendMessagesCalls != 0 {
		t.Fatalf("expected WeChat streaming media reply to avoid SendMessages fallback, got %d calls", sendMessagesCalls)
	}
	if len(updates) != 3 {
		t.Fatalf("expected 3 streaming updates including pending state, got %#v", updates)
	}
	if len(updates[2]) != 1 ||
		!strings.Contains(updates[2][0].Text, "reply: hello streaming debug media") ||
		strings.Contains(updates[2][0].Text, "Channel timing") {
		t.Fatalf("expected incremental updates to stay unchanged for media reply, got %#v", updates)
	}
	if len(completedMessages) != 2 {
		t.Fatalf("expected media reply plus standalone timing on completion, got %#v", completedMessages)
	}
	if got := completedMessages[0]; !strings.Contains(got.Text, "final: hello streaming debug media") ||
		strings.Contains(got.Text, "Channel timing") ||
		len(got.Media) != 1 {
		t.Fatalf("expected first completed message to preserve media reply without timing footer, got %#v", got)
	}
	if got := completedMessages[1]; len(got.Media) != 0 ||
		!strings.Contains(got.Text, "Channel timing") ||
		!strings.Contains(got.Text, "Platform->backend:") ||
		!strings.Contains(got.Text, "Backend processing:") {
		t.Fatalf("expected second completed message to be standalone timing text, got %#v", got)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		conversations := service.ListConversations(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			conversations[0].ThreadID == "thr_chat-wechat-stream-debug-media-1" &&
			strings.Contains(conversations[0].LastOutboundText, "final: hello streaming debug media") &&
			strings.Contains(conversations[0].LastOutboundText, "Channel timing") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected WeChat streaming media debug conversation state to settle, got %#v", conversations)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestServiceDoesNotRetryStoredStreamingReplyWhenWebhookRedeliversSameMessage(t *testing.T) {
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
	if result.Accepted != 0 {
		t.Fatalf("expected duplicate failed delivery with saved reply to be ignored, got %d accepted", result.Accepted)
	}

	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected stored streaming reply not to be redelivered, got %#v", sent.Messages)
	case <-time.After(300 * time.Millisecond):
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected ai backend to run once, got %d calls", backend.callCount())
	}

	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"duplicate_delivery_suppressed",
		[]string{"msg-stream-retry-1", "saved reply snapshot"},
	)

	assertNotificationContains(
		t,
		dataStore.ListNotifications(),
		"bot_duplicate_delivery_suppressed",
		connection.ID,
		[]string{"msg-stream-retry-1", "saved reply snapshot"},
	)

	thirdRequest := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(requestBody))
	thirdRequest.Header.Set("X-Test-Secret", "fake-secret")

	result, err = service.HandleWebhook(thirdRequest, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook(third) error = %v", err)
	}
	if result.Accepted != 0 {
		t.Fatalf("expected repeated duplicate delivery to stay ignored, got %d accepted", result.Accepted)
	}
	if count := countNotificationsByKindAndConnection(dataStore.ListNotifications(), "bot_duplicate_delivery_suppressed", connection.ID); count != 1 {
		t.Fatalf("expected duplicate suppression notifications to be deduplicated, got %d", count)
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

func TestServiceRetriesReplyDeliveryAndMarksConversationDelivered(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	provider.setReplyDeliveryMaxAttempts(2)
	provider.pushSendError(markReplyDeliveryRetryable(errors.New("transient send outage")))

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
		"conversationId":"chat-delivery-retry-1",
		"messageId":"msg-delivery-retry-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello retry"
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
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello retry" {
			t.Fatalf("expected retried reply to be delivered, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for retried provider send")
	}

	conversations := service.ListConversationViews(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastOutboundDeliveryStatus != botReplyDeliveryStatusDelivered {
		t.Fatalf("expected delivered conversation status, got %#v", conversations[0])
	}
	if conversations[0].LastOutboundDeliveryAttemptCount != 2 {
		t.Fatalf("expected attempt count 2, got %#v", conversations[0])
	}
	if conversations[0].LastOutboundDeliveryError != "" {
		t.Fatalf("expected empty delivery error after recovery, got %#v", conversations[0])
	}
	if conversations[0].LastOutboundDeliveredAt == nil {
		t.Fatalf("expected delivered timestamp to be set, got %#v", conversations[0])
	}

	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"reply_delivery_retry",
		[]string{"attempt 1", "transient send outage"},
	)
	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"reply_delivery_recovered",
		[]string{"after 2 attempts"},
	)

	if count := countNotificationsByKindAndConnection(dataStore.ListNotifications(), "bot_reply_delivery_failed", connection.ID); count != 0 {
		t.Fatalf("expected no reply delivery failure notification after successful retry, got %d", count)
	}
}

func TestServiceExposesRetryingReplyDeliveryStateWhileWaitingForRetry(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	provider.setReplyDeliveryMaxAttempts(2)
	provider.setReplyDeliveryRetryDelay(150 * time.Millisecond)
	provider.pushSendError(markReplyDeliveryRetryable(errors.New("transient send outage")))

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
		"conversationId":"chat-delivery-retrying-1",
		"messageId":"msg-delivery-retrying-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello retrying"
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
		conversations := service.ListConversationViews(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			conversations[0].LastOutboundDeliveryStatus == botReplyDeliveryStatusRetrying {
			if conversations[0].LastOutboundDeliveryAttemptCount != 2 {
				t.Fatalf("expected retrying state to show next attempt 2, got %#v", conversations[0])
			}
			if !strings.Contains(conversations[0].LastOutboundDeliveryError, "transient send outage") {
				t.Fatalf("expected retrying state to preserve latest error, got %#v", conversations[0])
			}
			goto waitDelivered
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("timed out waiting for retrying reply delivery state")

waitDelivered:
	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello retrying" {
			t.Fatalf("expected retried message after retrying state, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for final retried provider send")
	}
}

func TestServicePublishesReplyDeliveryFailureToClientStateAndLogs(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	provider.setReplyDeliveryMaxAttempts(2)
	provider.pushSendError(markReplyDeliveryRetryable(errors.New("transient send outage")))
	provider.pushSendError(markReplyDeliveryRetryable(errors.New("context expired on retry")))

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
		"conversationId":"chat-delivery-fail-1",
		"messageId":"msg-delivery-fail-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello fail"
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
		if ok && strings.Contains(storedConnection.LastError, "context expired on retry") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	conversations := service.ListConversationViews(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastOutboundDeliveryStatus != botReplyDeliveryStatusFailed {
		t.Fatalf("expected failed conversation delivery status, got %#v", conversations[0])
	}
	if conversations[0].LastOutboundDeliveryAttemptCount != 2 {
		t.Fatalf("expected failed attempt count 2, got %#v", conversations[0])
	}
	if !strings.Contains(conversations[0].LastOutboundDeliveryError, "context expired on retry") {
		t.Fatalf("expected failed delivery error to be persisted, got %#v", conversations[0])
	}

	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"reply_delivery_retry",
		[]string{"attempt 1", "transient send outage"},
	)
	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"reply_delivery_failed",
		[]string{"msg-delivery-fail-1", "context expired on retry"},
	)
	assertNotificationContains(
		t,
		dataStore.ListNotifications(),
		"bot_reply_delivery_failed",
		connection.ID,
		[]string{"msg-delivery-fail-1", "context expired on retry"},
	)
}

func TestServiceDoesNotRetryStoredReplyWhenWebhookRedeliversSameMessage(t *testing.T) {
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
	if result.Accepted != 0 {
		t.Fatalf("expected duplicate failed message with saved reply to be ignored, got %d accepted", result.Accepted)
	}

	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected stored reply not to be retried on duplicate delivery, got %#v", sent.Messages)
	case <-time.After(300 * time.Millisecond):
	}

	conversations := service.ListConversations(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastInboundMessageID != "msg-retry-1" {
		t.Fatalf("expected last inbound message id to be persisted after successful retry, got %q", conversations[0].LastInboundMessageID)
	}

	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"duplicate_delivery_suppressed",
		[]string{"msg-retry-1", "saved reply snapshot"},
	)

	assertNotificationContains(
		t,
		dataStore.ListNotifications(),
		"bot_duplicate_delivery_suppressed",
		connection.ID,
		[]string{"msg-retry-1", "saved reply snapshot"},
	)
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

func TestServiceDoesNotReplayStoredReplyDeliveryOnStart(t *testing.T) {
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
		t.Fatalf("expected failed stored reply not to be replayed on start, got %#v", sent.Messages)
	case <-time.After(300 * time.Millisecond):
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected ai backend not to rerun across restart, got %d calls", backend.callCount())
	}

	assertConnectionLogContainsEvent(
		t,
		recoveryService,
		workspace.ID,
		connection.ID,
		"recovery_replay_suppressed",
		[]string{"msg-recover-reply-1", "saved reply snapshot"},
	)

	assertNotificationContains(
		t,
		dataStore.ListNotifications(),
		"bot_recovery_replay_suppressed",
		connection.ID,
		[]string{"msg-recover-reply-1"},
	)

	secondRecoveryService := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeProvider()},
		AIBackends:    []AIBackend{backend},
	})
	secondRecoveryService.Start(context.Background())

	if count := countNotificationsByKindAndConnection(dataStore.ListNotifications(), "bot_recovery_replay_suppressed", connection.ID); count != 1 {
		t.Fatalf("expected recovery suppression notifications to be deduplicated, got %d", count)
	}
}

func TestServiceDoesNotReplayStoredWeChatReplyMediaOnStart(t *testing.T) {
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
		t.Fatalf("expected failed stored WeChat reply not to be replayed on start, got %#v", sent.Messages)
	case <-time.After(300 * time.Millisecond):
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected ai backend not to rerun across restart, got %d calls", backend.callCount())
	}

	assertConnectionLogContainsEvent(
		t,
		recoveryService,
		workspace.ID,
		connection.ID,
		"recovery_replay_suppressed",
		[]string{"msg-wechat-recover-1", "saved reply snapshot"},
	)

	assertNotificationContains(
		t,
		dataStore.ListNotifications(),
		"bot_recovery_replay_suppressed",
		connection.ID,
		[]string{"msg-wechat-recover-1"},
	)
}

func TestServiceReplaysFailedWeChatReplyAfterRetryIntentWithoutRerunningAI(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeWeChatProvider()
	provider.pushSendError(errors.New("wechat sendmessage text failed: session expired"))
	backend := &scriptedAIBackend{
		result: AIResult{
			ThreadID: "thr_chat-wechat-retry-1",
			Messages: []OutboundMessage{
				{Text: "这是上一次已经生成好的回复"},
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

	firstRequest := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-wechat-retry-1",
		"externalChatId":"chat-wechat-retry-1",
		"messageId":"msg-wechat-retry-1",
		"userId":"wechat-user-1",
		"username":"alice",
		"title":"Alice",
		"text":"把上一个结果发给我",
		"providerData":{"wechat_context_token":"ctx-old"}
	}`))
	firstRequest.Header.Set("X-Test-Secret", "fake-secret")

	result, err := service.HandleWebhook(firstRequest, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook(first) error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected first webhook to accept 1 message, got %d", result.Accepted)
	}

	deadline := time.Now().Add(2 * time.Second)
	var failedDelivery store.BotInboundDelivery
	for time.Now().Before(deadline) {
		candidate, ok := dataStore.FindLatestFailedBotInboundDeliveryWithSavedReply(
			workspace.ID,
			connection.ID,
			"chat-wechat-retry-1",
			"",
		)
		if ok {
			failedDelivery = candidate
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if failedDelivery.ID == "" {
		t.Fatal("expected original failed wechat delivery with saved reply to be persisted")
	}

	secondRequest := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
		"conversationId":"chat-wechat-retry-1",
		"externalChatId":"chat-wechat-retry-1",
		"messageId":"msg-wechat-retry-2",
		"userId":"wechat-user-1",
		"username":"alice",
		"title":"Alice",
		"text":"再发一次",
		"providerData":{"wechat_context_token":"ctx-new"}
	}`))
	secondRequest.Header.Set("X-Test-Secret", "fake-secret")

	result, err = service.HandleWebhook(secondRequest, connection.ID)
	if err != nil {
		t.Fatalf("HandleWebhook(second) error = %v", err)
	}
	if result.Accepted != 1 {
		t.Fatalf("expected retry webhook to accept 1 message, got %d", result.Accepted)
	}

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "这是上一次已经生成好的回复" {
			t.Fatalf("expected retry intent to replay saved reply, got %#v", sent.Messages)
		}
		if got := sent.Conversation.ProviderState[wechatContextTokenKey]; got != "ctx-new" {
			t.Fatalf("expected replay to use refreshed wechat context token, got %#v", sent.Conversation.ProviderState)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for replayed wechat reply")
	}

	if backend.callCount() != 1 {
		t.Fatalf("expected ai backend not to rerun on wechat retry intent, got %d calls", backend.callCount())
	}
	if got := backend.lastInboundMessage().MessageID; got != "msg-wechat-retry-1" {
		t.Fatalf("expected ai backend to keep the original inbound message, got %#v", backend.lastInboundMessage())
	}

	deadline = time.Now().Add(2 * time.Second)
	var conversations []ConversationView
	for time.Now().Before(deadline) {
		conversations = service.ListConversationViews(workspace.ID, connection.ID)
		if len(conversations) == 1 &&
			conversations[0].LastInboundMessageID == "msg-wechat-retry-2" &&
			conversations[0].LastOutboundDeliveryStatus == botReplyDeliveryStatusDelivered &&
			conversations[0].LastOutboundText == "这是上一次已经生成好的回复" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastInboundMessageID != "msg-wechat-retry-2" {
		t.Fatalf("expected retry intent message id to become latest inbound, got %#v", conversations[0])
	}
	if conversations[0].LastOutboundDeliveryStatus != botReplyDeliveryStatusDelivered {
		t.Fatalf("expected delivered conversation status after replay, got %#v", conversations[0])
	}
	if conversations[0].LastOutboundText != "这是上一次已经生成好的回复" {
		t.Fatalf("expected replayed reply to become last outbound text, got %#v", conversations[0])
	}
	target, ok := dataStore.FindBotDeliveryTargetByConversation(workspace.ID, conversations[0].ID)
	if !ok {
		t.Fatalf("expected wechat reply flow to ensure a session-backed delivery target for conversation %s", conversations[0].ID)
	}
	if target.TargetType != "session_backed" || target.RouteType != "wechat_session" {
		t.Fatalf("expected wechat reply target to be session-backed wechat session, got %#v", target)
	}
	if got := target.ProviderState[wechatContextTokenKey]; got != "ctx-new" {
		t.Fatalf("expected wechat delivery target provider state to refresh context token ctx-new, got %#v", target.ProviderState)
	}

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		storedFailedDelivery, ok := dataStore.GetBotInboundDelivery(workspace.ID, failedDelivery.ID)
		if ok &&
			storedFailedDelivery.Status == "completed" &&
			storedFailedDelivery.ReplyDeliveryStatus == botReplyDeliveryStatusDelivered {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	storedFailedDelivery, ok := dataStore.GetBotInboundDelivery(workspace.ID, failedDelivery.ID)
	if !ok {
		t.Fatalf("expected to reload original failed delivery %s", failedDelivery.ID)
	}
	if storedFailedDelivery.Status != "completed" {
		t.Fatalf("expected original failed delivery to be marked completed after replay, got %#v", storedFailedDelivery)
	}
	if storedFailedDelivery.ReplyDeliveryStatus != botReplyDeliveryStatusDelivered {
		t.Fatalf("expected original failed delivery reply status delivered after replay, got %#v", storedFailedDelivery)
	}

	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"reply_delivery_replayed",
		[]string{"msg-wechat-retry-1", "msg-wechat-retry-2"},
	)
}

func TestReplayLatestFailedReplyReplaysSavedDeliveryAndAccumulatesAttempts(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeProvider()
	provider.setReplyDeliveryMaxAttempts(2)
	provider.pushSendError(markReplyDeliveryRetryable(errors.New("transient send outage")))
	provider.pushSendError(markReplyDeliveryRetryable(errors.New("context expired on retry")))

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
		"conversationId":"chat-manual-replay-1",
		"messageId":"msg-manual-replay-1",
		"userId":"user-1",
		"username":"alice",
		"title":"Alice",
		"text":"hello manual replay"
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
	var failedDelivery store.BotInboundDelivery
	for time.Now().Before(deadline) {
		candidate, ok := dataStore.FindLatestFailedBotInboundDeliveryWithSavedReply(
			workspace.ID,
			connection.ID,
			"chat-manual-replay-1",
			"",
		)
		if ok && candidate.ReplyDeliveryAttemptCount == 2 {
			failedDelivery = candidate
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if failedDelivery.ID == "" {
		t.Fatal("expected failed delivery with saved reply before manual replay")
	}

	conversations := service.ListConversationViews(workspace.ID, connection.ID)
	if len(conversations) != 1 {
		t.Fatalf("expected 1 bot conversation, got %d", len(conversations))
	}
	if conversations[0].LastOutboundDeliveryStatus != botReplyDeliveryStatusFailed {
		t.Fatalf("expected failed conversation before manual replay, got %#v", conversations[0])
	}
	initialOutboundDeliveries := dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
		BotID:         connection.BotID,
		SourceType:    "reply",
		SourceRefType: "inbound_delivery",
		SourceRefID:   failedDelivery.ID,
	})
	if len(initialOutboundDeliveries) != 1 || initialOutboundDeliveries[0].Status != "failed" {
		t.Fatalf("expected initial failed reply outbound delivery before manual replay, got %#v", initialOutboundDeliveries)
	}

	replayedConversation, err := service.ReplayLatestFailedReply(
		context.Background(),
		workspace.ID,
		connection.ID,
		conversations[0].ID,
	)
	if err != nil {
		t.Fatalf("ReplayLatestFailedReply() error = %v", err)
	}

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "reply: hello manual replay" {
			t.Fatalf("expected manual replay to send saved reply, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for manual replay send")
	}

	if replayedConversation.LastOutboundDeliveryStatus != botReplyDeliveryStatusDelivered {
		t.Fatalf("expected delivered conversation after manual replay, got %#v", replayedConversation)
	}
	if replayedConversation.LastOutboundDeliveryAttemptCount != 3 {
		t.Fatalf("expected cumulative attempt count 3 after manual replay, got %#v", replayedConversation)
	}

	storedFailedDelivery, ok := dataStore.GetBotInboundDelivery(workspace.ID, failedDelivery.ID)
	if !ok {
		t.Fatalf("expected to reload failed delivery %s", failedDelivery.ID)
	}
	if storedFailedDelivery.Status != "completed" {
		t.Fatalf("expected manual replay to complete failed delivery, got %#v", storedFailedDelivery)
	}
	if storedFailedDelivery.ReplyDeliveryStatus != botReplyDeliveryStatusDelivered {
		t.Fatalf("expected manual replay to mark failed delivery delivered, got %#v", storedFailedDelivery)
	}
	if storedFailedDelivery.ReplyDeliveryAttemptCount != 3 {
		t.Fatalf("expected failed delivery attempt count to accumulate to 3, got %#v", storedFailedDelivery)
	}

	replayedOutboundDeliveries := dataStore.ListBotOutboundDeliveries(workspace.ID, store.BotOutboundDeliveryFilter{
		BotID:         connection.BotID,
		SourceType:    "reply",
		SourceRefType: "inbound_delivery",
		SourceRefID:   failedDelivery.ID,
	})
	if len(replayedOutboundDeliveries) != 2 {
		t.Fatalf("expected manual replay to append a second reply outbound delivery, got %#v", replayedOutboundDeliveries)
	}
	if replayedOutboundDeliveries[0].Status != "delivered" ||
		replayedOutboundDeliveries[0].SourceRefType != "inbound_delivery" ||
		replayedOutboundDeliveries[0].SourceRefID != failedDelivery.ID {
		t.Fatalf("expected latest reply outbound delivery to be delivered and linked to failed inbound, got %#v", replayedOutboundDeliveries[0])
	}
	if replayedOutboundDeliveries[0].ID == initialOutboundDeliveries[0].ID {
		t.Fatalf("expected manual replay to create a new outbound delivery record, got %#v", replayedOutboundDeliveries)
	}

	storedConnection, ok := dataStore.GetBotConnection(workspace.ID, connection.ID)
	if !ok {
		t.Fatalf("expected to reload connection %s", connection.ID)
	}
	if strings.TrimSpace(storedConnection.LastError) != "" {
		t.Fatalf("expected manual replay success to clear connection last error, got %#v", storedConnection)
	}

	assertConnectionLogContainsEvent(
		t,
		service,
		workspace.ID,
		connection.ID,
		"reply_delivery_replayed",
		[]string{"msg-manual-replay-1"},
	)
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
		reply, _, _, _, err := service.executeAIReply(context.Background(), provider, backend, connection, conversation, inbound, nil)
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

func TestHandleWebhookApprovalCommandsFollowCrossWorkspaceBinding(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspaceA := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	workspaceB := dataStore.CreateWorkspace("Workspace B", "E:/projects/b")
	provider := newFakeProvider()
	threadsExec := newFakeBotThreads()
	approvalService := newFakeApprovalService([]store.PendingApproval{
		{
			ID:          "req_cross_1",
			WorkspaceID: workspaceB.ID,
			ThreadID:    "thread-bot-1",
			Kind:        "item/tool/call",
			Summary:     "Need remote input",
			Status:      "pending",
			Actions:     []string{"accept", "decline", "cancel"},
			RequestedAt: time.Now().UTC(),
		},
		{
			ID:          "req_source_1",
			WorkspaceID: workspaceA.ID,
			ThreadID:    "thread-a-unrelated",
			Kind:        "item/commandExecution/requestApproval",
			Summary:     "go test ./...",
			Status:      "pending",
			Actions:     []string{"accept", "decline", "cancel"},
			RequestedAt: time.Now().Add(-time.Minute).UTC(),
		},
	})

	service := NewService(dataStore, threadsExec, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Approvals:     approvalService,
		Providers:     []Provider{provider},
	})
	service.Start(context.Background())

	connection, err := service.CreateConnection(context.Background(), workspaceA.ID, CreateConnectionInput{
		Provider:  "fakechat",
		Name:      "Support Bot",
		AIBackend: defaultAIBackend,
		Secrets: map[string]string{
			"bot_token": "token-approval-cross-workspace",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	targetThread, err := threadsExec.Create(context.Background(), workspaceB.ID, threads.CreateInput{Name: "Cross Workspace Approval Thread"})
	if err != nil {
		t.Fatalf("Create(targetThread) error = %v", err)
	}
	if targetThread.ID != "thread-bot-1" {
		t.Fatalf("expected first cross-workspace thread id thread-bot-1, got %#v", targetThread)
	}

	if _, err := service.UpdateBotDefaultBinding(context.Background(), workspaceA.ID, connection.BotID, UpdateBotDefaultBindingInput{
		BindingMode:       "fixed_thread",
		TargetWorkspaceID: workspaceB.ID,
		TargetThreadID:    targetThread.ID,
	}); err != nil {
		t.Fatalf("UpdateBotDefaultBinding() error = %v", err)
	}

	sendWebhook := func(text string, messageID string) {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
			"conversationId":"chat-approval-cross-1",
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

	sendWebhook("/approvals", "msg-approval-cross-1")

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 {
			t.Fatalf("expected one approvals list message, got %#v", sent.Messages)
		}
		if !strings.Contains(sent.Messages[0].Text, "Pending approvals:") ||
			!strings.Contains(sent.Messages[0].Text, "req_cross_1") ||
			!strings.Contains(sent.Messages[0].Text, "thread="+workspaceB.ID+"/"+targetThread.ID) {
			t.Fatalf("expected cross-workspace approval listing, got %#v", sent.Messages[0])
		}
		if strings.Contains(sent.Messages[0].Text, "req_source_1") {
			t.Fatalf("did not expect source-workspace approval to leak into cross-workspace conversation view, got %#v", sent.Messages[0])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for approvals list response")
	}

	sendWebhook("/approve req_cross_1", "msg-approval-cross-2")

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 ||
			!strings.Contains(sent.Messages[0].Text, "req_cross_1") ||
			!strings.Contains(sent.Messages[0].Text, "was approved") {
			t.Fatalf("expected cross-workspace approval confirmation, got %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for cross-workspace approval confirmation")
	}

	call := approvalService.lastCall()
	if call.requestID != "req_cross_1" {
		t.Fatalf("expected cross-workspace approval request id req_cross_1, got %#v", call)
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
	mu                       sync.Mutex
	sentCh                   chan fakeSentPayload
	errors                   []error
	replyDeliveryMaxAttempts int
	replyDeliveryRetryDelay  time.Duration
	providerName             string
}

type fakeSentPayload struct {
	ConnectionID string
	Conversation store.BotConversation
	Messages     []OutboundMessage
}

func newFakeProvider() *fakeProvider {
	return &fakeProvider{
		sentCh:                   make(chan fakeSentPayload, 8),
		replyDeliveryMaxAttempts: 1,
		providerName:             "fakechat",
	}
}

func newNamedFakeProvider(name string) *fakeProvider {
	provider := newFakeProvider()
	provider.providerName = strings.TrimSpace(name)
	if provider.providerName == "" {
		provider.providerName = "fakechat"
	}
	return provider
}

func (p *fakeProvider) Name() string {
	return firstNonEmpty(strings.TrimSpace(p.providerName), "fakechat")
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

func (p *fakeProvider) ReplyDeliveryRetryDecision(err error, attempt int) (bool, time.Duration) {
	p.mu.Lock()
	maxAttempts := p.replyDeliveryMaxAttempts
	delay := p.replyDeliveryRetryDelay
	p.mu.Unlock()
	if maxAttempts <= 1 || attempt >= maxAttempts || !isReplyDeliveryRetryable(err) {
		return false, 0
	}
	return true, delay
}

func (p *fakeProvider) setReplyDeliveryMaxAttempts(maxAttempts int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.replyDeliveryMaxAttempts = maxAttempts
}

func (p *fakeProvider) setReplyDeliveryRetryDelay(delay time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.replyDeliveryRetryDelay = delay
}

type fakeTelegramWebhookProvider struct {
	mu     sync.Mutex
	sentCh chan fakeSentPayload
	errors []error
}

func newFakeTelegramWebhookProvider() *fakeTelegramWebhookProvider {
	return &fakeTelegramWebhookProvider{
		sentCh: make(chan fakeSentPayload, 8),
	}
}

func (p *fakeTelegramWebhookProvider) Name() string {
	return telegramProviderName
}

func (p *fakeTelegramWebhookProvider) Activate(_ context.Context, connection store.BotConnection, publicBaseURL string) (ActivationResult, error) {
	return ActivationResult{
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryMode(connection),
			"webhook_url":               strings.TrimRight(publicBaseURL, "/") + "/hooks/bots/" + connection.ID,
		},
		Secrets: map[string]string{
			"webhook_secret": "fake-secret",
		},
	}, nil
}

func (p *fakeTelegramWebhookProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakeTelegramWebhookProvider) ParseWebhook(r *http.Request, _ store.BotConnection) ([]InboundMessage, error) {
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

func (p *fakeTelegramWebhookProvider) SendMessages(_ context.Context, connection store.BotConnection, conversation store.BotConversation, messages []OutboundMessage) error {
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

type fakeWeChatProvider struct {
	mu                       sync.Mutex
	sentCh                   chan fakeSentPayload
	errors                   []error
	replyDeliveryMaxAttempts int
	typingStarts             int
	typingStops              int
	typingStartedCh          chan struct{}
	typingStoppedCh          chan struct{}
}

func newFakeWeChatProvider() *fakeWeChatProvider {
	return &fakeWeChatProvider{
		sentCh:                   make(chan fakeSentPayload, 8),
		replyDeliveryMaxAttempts: 1,
		typingStartedCh:          make(chan struct{}, 2),
		typingStoppedCh:          make(chan struct{}, 2),
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

func (p *fakeWeChatProvider) ReplyDeliveryRetryDecision(err error, attempt int) (bool, time.Duration) {
	p.mu.Lock()
	maxAttempts := p.replyDeliveryMaxAttempts
	p.mu.Unlock()
	if maxAttempts <= 1 || attempt >= maxAttempts || !isReplyDeliveryRetryable(err) {
		return false, 0
	}
	return true, 0
}

func (p *fakeWeChatProvider) setReplyDeliveryMaxAttempts(maxAttempts int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.replyDeliveryMaxAttempts = maxAttempts
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

type fakeTelegramScriptedPollingProvider struct {
	mu        sync.Mutex
	delivered map[string]bool
	messages  []InboundMessage
	sentCh    chan fakeSentPayload
}

func newFakeTelegramScriptedPollingProvider(messages []InboundMessage) *fakeTelegramScriptedPollingProvider {
	return &fakeTelegramScriptedPollingProvider{
		delivered: make(map[string]bool),
		messages:  append([]InboundMessage(nil), messages...),
		sentCh:    make(chan fakeSentPayload, 8),
	}
}

func (p *fakeTelegramScriptedPollingProvider) Name() string {
	return telegramProviderName
}

func (p *fakeTelegramScriptedPollingProvider) Activate(_ context.Context, connection store.BotConnection, _ string) (ActivationResult, error) {
	return ActivationResult{
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryMode(connection),
		},
	}, nil
}

func (p *fakeTelegramScriptedPollingProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *fakeTelegramScriptedPollingProvider) ParseWebhook(*http.Request, store.BotConnection) ([]InboundMessage, error) {
	return nil, ErrWebhookIgnored
}

func (p *fakeTelegramScriptedPollingProvider) SendMessages(_ context.Context, connection store.BotConnection, conversation store.BotConversation, messages []OutboundMessage) error {
	p.sentCh <- fakeSentPayload{
		ConnectionID: connection.ID,
		Conversation: conversation,
		Messages:     append([]OutboundMessage(nil), messages...),
	}
	return nil
}

func (p *fakeTelegramScriptedPollingProvider) SupportsPolling(connection store.BotConnection) bool {
	return telegramDeliveryMode(connection) == telegramDeliveryModePolling
}

func (p *fakeTelegramScriptedPollingProvider) PollingOwnerKey(connection store.BotConnection) string {
	if telegramDeliveryMode(connection) != telegramDeliveryModePolling {
		return ""
	}
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return ""
	}
	return telegramProviderName + ":" + token
}

func (p *fakeTelegramScriptedPollingProvider) PollingConflictError(ownerConnectionID string) error {
	return telegramPollingConflictError(ownerConnectionID)
}

func (p *fakeTelegramScriptedPollingProvider) RunPolling(
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
				telegramUpdateOffsetSetting: intToString(index + 1),
			}); err != nil {
				return err
			}
		}
		if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
			EventType:      "poll_success",
			Message:        fmt.Sprintf("Poll completed successfully. Received %d scripted Telegram message(s).", len(messages)),
			ReceivedCount:  len(messages),
			ProcessedCount: len(messages),
		}); err != nil {
			return err
		}
	}

	<-ctx.Done()
	return ctx.Err()
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
	mu              sync.Mutex
	nextID          int
	details         map[string]store.ThreadDetail
	lastCreateInput threads.CreateInput
}

func newFakeBotThreads() *fakeBotThreads {
	return &fakeBotThreads{
		details: make(map[string]store.ThreadDetail),
	}
}

func (f *fakeBotThreads) Create(_ context.Context, workspaceID string, input threads.CreateInput) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.lastCreateInput = input
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

func (f *fakeBotThreads) GetDetail(_ context.Context, workspaceID string, threadID string) (store.ThreadDetail, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok || detail.Thread.WorkspaceID != workspaceID {
		return store.ThreadDetail{}, store.ErrThreadNotFound
	}
	return cloneThreadDetailForTest(detail), nil
}

func (f *fakeBotThreads) GetTurn(_ context.Context, workspaceID string, threadID string, turnID string, _ string) (store.ThreadTurn, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok || detail.Thread.WorkspaceID != workspaceID {
		return store.ThreadTurn{}, store.ErrThreadNotFound
	}
	for _, turn := range detail.Turns {
		if turn.ID == turnID {
			return cloneThreadDetailForTest(store.ThreadDetail{Turns: []store.ThreadTurn{turn}}).Turns[0], nil
		}
	}
	return store.ThreadTurn{}, store.ErrThreadNotFound
}

func (f *fakeBotThreads) Rename(_ context.Context, workspaceID string, threadID string, name string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok || detail.Thread.WorkspaceID != workspaceID {
		return store.Thread{}, store.ErrThreadNotFound
	}
	detail.Thread.Name = strings.TrimSpace(name)
	detail.Thread.UpdatedAt = detail.Thread.UpdatedAt.Add(15 * time.Second)
	f.details[threadID] = detail
	return detail.Thread, nil
}

func (f *fakeBotThreads) Archive(_ context.Context, workspaceID string, threadID string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok || detail.Thread.WorkspaceID != workspaceID {
		return store.Thread{}, store.ErrThreadNotFound
	}
	detail.Thread.Archived = true
	detail.Thread.UpdatedAt = detail.Thread.UpdatedAt.Add(15 * time.Second)
	f.details[threadID] = detail
	return detail.Thread, nil
}

func (f *fakeBotThreads) Unarchive(_ context.Context, workspaceID string, threadID string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	detail, ok := f.details[threadID]
	if !ok || detail.Thread.WorkspaceID != workspaceID {
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
	mu         sync.Mutex
	threads    *fakeBotThreads
	calls      []string
	workspaces []string
}

func (f *fakeBotTurns) Start(_ context.Context, workspaceID string, threadID string, input string, _ turns.StartOptions) (turns.Result, error) {
	f.mu.Lock()
	callIndex := len(f.calls) + 1
	f.calls = append(f.calls, threadID)
	f.workspaces = append(f.workspaces, workspaceID)
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

func (f *fakeBotTurns) workspaceCalls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.workspaces...)
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
	inbounds    []InboundMessage
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
	b.inbounds = append(b.inbounds, cloneInboundMessageForTest(inbound))
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

func (b *scriptedAIBackend) inboundMessages() []InboundMessage {
	b.mu.Lock()
	defer b.mu.Unlock()

	items := make([]InboundMessage, 0, len(b.inbounds))
	for _, inbound := range b.inbounds {
		items = append(items, cloneInboundMessageForTest(inbound))
	}
	return items
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
	providerName      string
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
	return newNamedFakeStreamingProvider("streamchat")
}

func newFakeWeChatStreamingProvider() *fakeStreamingProvider {
	return newNamedFakeStreamingProvider(wechatProviderName)
}

func newNamedFakeStreamingProvider(providerName string) *fakeStreamingProvider {
	return &fakeStreamingProvider{
		providerName: providerName,
		sentCh:       make(chan fakeSentPayload, 8),
		completedCh:  make(chan struct{}, 1),
	}
}

func (p *fakeStreamingProvider) Name() string {
	if strings.TrimSpace(p.providerName) == "" {
		return "streamchat"
	}
	return p.providerName
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

type fakeStreamingMediaAIBackend struct{}

func (fakeStreamingMediaAIBackend) Name() string {
	return "stream_media_ai"
}

func (fakeStreamingMediaAIBackend) ProcessMessage(
	_ context.Context,
	_ store.BotConnection,
	_ store.BotConversation,
	inbound InboundMessage,
) (AIResult, error) {
	return AIResult{
		ThreadID: "thr_" + inbound.ConversationID,
		Messages: []OutboundMessage{
			{
				Text: "final: " + inbound.Text,
				Media: []store.BotMessageMedia{
					{
						Kind:     botMediaKindFile,
						Path:     "E:/tmp/stream-debug-report.txt",
						FileName: "stream-debug-report.txt",
					},
				},
			},
		},
	}, nil
}

func (fakeStreamingMediaAIBackend) ProcessMessageStream(
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
			{
				Text: "final: " + inbound.Text,
				Media: []store.BotMessageMedia{
					{
						Kind:     botMediaKindFile,
						Path:     "E:/tmp/stream-debug-report.txt",
						FileName: "stream-debug-report.txt",
					},
				},
			},
		},
	}, nil
}

func assertConnectionLogContainsEvent(
	t *testing.T,
	service *Service,
	workspaceID string,
	connectionID string,
	eventType string,
	messageParts []string,
) {
	t.Helper()

	logs, err := service.ListConnectionLogs(workspaceID, connectionID)
	if err != nil {
		t.Fatalf("ListConnectionLogs() error = %v", err)
	}

	for _, entry := range logs {
		if entry.EventType != eventType {
			continue
		}

		matched := true
		for _, part := range messageParts {
			if !strings.Contains(entry.Message, part) {
				matched = false
				break
			}
		}
		if matched {
			return
		}
	}

	t.Fatalf("expected bot connection logs to contain event %q with message parts %#v, got %#v", eventType, messageParts, logs)
}

func assertNotificationContains(
	t *testing.T,
	notifications []store.Notification,
	kind string,
	connectionID string,
	messageParts []string,
) {
	t.Helper()

	for _, notification := range notifications {
		if notification.Kind != kind {
			continue
		}
		if notification.BotConnectionID != connectionID {
			continue
		}

		matched := true
		for _, part := range messageParts {
			if !strings.Contains(notification.Message, part) {
				matched = false
				break
			}
		}
		if matched {
			return
		}
	}

	t.Fatalf(
		"expected notifications to contain kind %q for connection %q with message parts %#v, got %#v",
		kind,
		connectionID,
		messageParts,
		notifications,
	)
}

func countNotificationsByKindAndConnection(
	notifications []store.Notification,
	kind string,
	connectionID string,
) int {
	count := 0
	for _, notification := range notifications {
		if notification.Kind == kind && notification.BotConnectionID == connectionID {
			count += 1
		}
	}
	return count
}

func TestListConnectionRecipientCandidatesAggregatesSavedTargetsAndReadiness(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{newFakeWeChatProvider()},
		AIBackends:    []AIBackend{fakeAIBackend{}},
	})

	connection, err := dataStore.CreateBotConnection(store.BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    wechatProviderName,
		Name:        "WeChat Support",
		Status:      "active",
		AIBackend:   "workspace_thread",
	})
	if err != nil {
		t.Fatalf("CreateBotConnection() error = %v", err)
	}
	connection, bot, _, err := service.ensureConnectionBotResources(connection)
	if err != nil {
		t.Fatalf("ensureConnectionBotResources() error = %v", err)
	}
	if _, err := dataStore.CreateBotConversation(store.BotConversation{
		WorkspaceID:            workspace.ID,
		BotID:                  bot.ID,
		ConnectionID:           connection.ID,
		Provider:               wechatProviderName,
		ExternalConversationID: "wxid_alice_2",
		ExternalChatID:         "wxid_alice_2",
		ExternalUserID:         "wxid_alice_2",
		ExternalTitle:          "Alice Two",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-alice-2",
		},
	}); err != nil {
		t.Fatalf("CreateBotConversation() error = %v", err)
	}
	if _, err := dataStore.CreateBotDeliveryTarget(store.BotDeliveryTarget{
		WorkspaceID:  workspace.ID,
		BotID:        bot.ID,
		ConnectionID: connection.ID,
		Provider:     connection.Provider,
		TargetType:   "route_backed",
		RouteType:    "wechat_session",
		RouteKey:     "user:wxid_bob_2",
		Title:        "Bob Two",
		Status:       "active",
	}); err != nil {
		t.Fatalf("CreateBotDeliveryTarget() error = %v", err)
	}

	candidates, err := service.ListConnectionRecipientCandidates(workspace.ID, connection.ID)
	if err != nil {
		t.Fatalf("ListConnectionRecipientCandidates() error = %v", err)
	}
	if len(candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %#v", candidates)
	}

	if candidates[0].Source != "saved_target" ||
		candidates[0].RouteType != "wechat_session" ||
		candidates[0].RouteKey != "user:wxid_bob_2" ||
		candidates[0].ChatID != "wxid_bob_2" ||
		candidates[0].Title != "Bob Two" ||
		candidates[0].DeliveryReadiness != deliveryTargetReadinessWaiting ||
		!strings.Contains(candidates[0].DeliveryReadinessMessage, "send a message first") {
		t.Fatalf("unexpected saved target candidate %#v", candidates[0])
	}
	if candidates[1].Source != "conversation" ||
		candidates[1].RouteKey != "user:wxid_alice_2" ||
		candidates[1].ChatID != "wxid_alice_2" ||
		candidates[1].Title != "Alice Two" ||
		candidates[1].DeliveryReadiness != deliveryTargetReadinessReady {
		t.Fatalf("unexpected conversation candidate %#v", candidates[1])
	}
}
