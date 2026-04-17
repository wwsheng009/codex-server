package notificationcenter

import (
	"context"
	"net/http"
	"testing"
	"time"

	"codex-server/backend/internal/bots"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/notifications"
	"codex-server/backend/internal/store"
)

func TestHookCompletedEventCreatesInAppNotification(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	notificationService := notifications.NewService(dataStore)
	service := NewService(dataStore, eventHub, notificationService, nil, Config{})
	service.Start(context.Background())

	_, err := service.CreateSubscription(workspace.ID, UpsertSubscriptionInput{
		Topic: "hook.blocked",
		Channels: []SubscriptionChannelInput{{
			Channel: ChannelInApp,
		}},
	})
	if err != nil {
		t.Fatalf("CreateSubscription() error = %v", err)
	}

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "hook/completed",
		Payload: map[string]any{
			"run": map[string]any{
				"id":            "hook-run-1",
				"threadId":      "thread-1",
				"turnId":        "turn-1",
				"decision":      "block",
				"status":        "completed",
				"reason":        "unsafe command detected",
				"toolName":      "shell",
				"triggerMethod": "turn/start",
			},
		},
		TS: time.Now().UTC(),
	})

	waitForNotificationCount(t, dataStore, 1)

	notificationsList := dataStore.ListNotifications()
	if len(notificationsList) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(notificationsList))
	}
	if notificationsList[0].Title != "Hook blocked a turn" {
		t.Fatalf("expected hook notification title, got %#v", notificationsList[0])
	}

	dispatches := dataStore.ListNotificationDispatches(workspace.ID, store.NotificationDispatchFilter{})
	if len(dispatches) != 1 {
		t.Fatalf("expected 1 dispatch, got %#v", dispatches)
	}
	if dispatches[0].Status != DispatchStatusDelivered || dispatches[0].NotificationID == "" {
		t.Fatalf("expected delivered in-app dispatch, got %#v", dispatches[0])
	}
}

func TestTurnCompletedEventCreatesInAppNotification(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	notificationService := notifications.NewService(dataStore)
	service := NewService(dataStore, eventHub, notificationService, nil, Config{})
	service.Start(context.Background())

	_, err := service.CreateSubscription(workspace.ID, UpsertSubscriptionInput{
		Topic: "turn.completed",
		Channels: []SubscriptionChannelInput{{
			Channel: ChannelInApp,
		}},
	})
	if err != nil {
		t.Fatalf("CreateSubscription() error = %v", err)
	}

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
			},
			"summary": "Agent replied successfully.",
		},
		TS: time.Now().UTC(),
	})

	waitForNotificationCount(t, dataStore, 1)

	notificationsList := dataStore.ListNotifications()
	if len(notificationsList) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(notificationsList))
	}
	if notificationsList[0].Title != "Turn completed" {
		t.Fatalf("expected turn completion title, got %#v", notificationsList[0])
	}

	dispatches := dataStore.ListNotificationDispatches(workspace.ID, store.NotificationDispatchFilter{})
	if len(dispatches) != 1 {
		t.Fatalf("expected 1 dispatch, got %#v", dispatches)
	}
	if dispatches[0].Topic != "turn.completed" || dispatches[0].Status != DispatchStatusDelivered {
		t.Fatalf("expected delivered turn.completed dispatch, got %#v", dispatches[0])
	}
}

func TestTurnCompletedTemplateCanRenderLastTurnContent(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	notificationService := notifications.NewService(dataStore)
	service := NewService(dataStore, eventHub, notificationService, nil, Config{})
	service.Start(context.Background())

	enabled := true
	_, err := service.CreateSubscription(workspace.ID, UpsertSubscriptionInput{
		Topic:   "turn.completed",
		Enabled: &enabled,
		Channels: []SubscriptionChannelInput{{
			Channel:       ChannelInApp,
			TitleTemplate: "Turn output",
			BodyTemplate:  "{{lastAgentMessage}}",
		}},
	})
	if err != nil {
		t.Fatalf("CreateSubscription() error = %v", err)
	}

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items": []map[string]any{
					{
						"id":   "agent-1",
						"type": "agentMessage",
						"text": "draft reply",
					},
					{
						"id":               "command-1",
						"type":             "commandExecution",
						"aggregatedOutput": "command output",
					},
					{
						"id":   "agent-2",
						"type": "agentMessage",
						"text": "final assistant reply",
					},
				},
			},
		},
		TS: time.Now().UTC(),
	})

	waitForNotificationCount(t, dataStore, 1)

	notificationsList := dataStore.ListNotifications()
	if len(notificationsList) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(notificationsList))
	}
	if notificationsList[0].Title != "Turn output" {
		t.Fatalf("expected title rendered from template, got %#v", notificationsList[0])
	}
	if notificationsList[0].Message != "final assistant reply" {
		t.Fatalf("expected last agent message rendered from template, got %#v", notificationsList[0])
	}

	dispatches := dataStore.ListNotificationDispatches(workspace.ID, store.NotificationDispatchFilter{})
	if len(dispatches) != 1 {
		t.Fatalf("expected 1 dispatch, got %#v", dispatches)
	}
	if dispatches[0].Message != "final assistant reply" {
		t.Fatalf("expected dispatch message to render last agent message, got %#v", dispatches[0])
	}
}

func TestTurnCompletedTemplateCanRenderProjectedTurnContentWhenTerminalEventOmitsItems(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	notificationService := notifications.NewService(dataStore)
	service := NewService(dataStore, eventHub, notificationService, nil, Config{})
	service.Start(context.Background())

	enabled := true
	_, err := service.CreateSubscription(workspace.ID, UpsertSubscriptionInput{
		Topic:   "turn.completed",
		Enabled: &enabled,
		Channels: []SubscriptionChannelInput{{
			Channel:       ChannelInApp,
			TitleTemplate: "Turn output",
			BodyTemplate:  "{{lastAgentMessage}}",
		}},
	})
	if err != nil {
		t.Fatalf("CreateSubscription() error = %v", err)
	}

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/started",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "inProgress",
				"items":  []map[string]any{},
			},
		},
		TS: time.Now().UTC(),
	})

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/started",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":   "agent-1",
				"type": "agentMessage",
				"text": "",
			},
		},
		TS: time.Now().UTC(),
	})

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/agentMessage/delta",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"itemId":   "agent-1",
			"delta":    "final assistant reply",
		},
		TS: time.Now().UTC(),
	})

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":   "agent-1",
				"type": "agentMessage",
				"text": "final assistant reply",
			},
		},
		TS: time.Now().UTC(),
	})

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "turn/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turn": map[string]any{
				"id":     "turn-1",
				"status": "completed",
				"items":  []map[string]any{},
			},
		},
		TS: time.Now().UTC(),
	})

	waitForNotificationCount(t, dataStore, 1)

	notificationsList := dataStore.ListNotifications()
	if len(notificationsList) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(notificationsList))
	}
	if notificationsList[0].Title != "Turn output" {
		t.Fatalf("expected title rendered from template, got %#v", notificationsList[0])
	}
	if notificationsList[0].Message != "final assistant reply" {
		t.Fatalf("expected projected last agent message rendered from template, got %#v", notificationsList[0])
	}

	dispatches := dataStore.ListNotificationDispatches(workspace.ID, store.NotificationDispatchFilter{})
	if len(dispatches) != 1 {
		t.Fatalf("expected 1 dispatch, got %#v", dispatches)
	}
	if dispatches[0].Message != "final assistant reply" {
		t.Fatalf("expected dispatch message to render projected last agent message, got %#v", dispatches[0])
	}
}

func TestTurnLifecycleEventsCreateInAppNotification(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name          string
		topic         string
		method        string
		payload       map[string]any
		expectedTitle string
	}{
		{
			name:   "started",
			topic:  "turn.started",
			method: "turn/started",
			payload: map[string]any{
				"threadId": "thread-1",
				"turn": map[string]any{
					"id":     "turn-1",
					"status": "inProgress",
				},
			},
			expectedTitle: "Turn started",
		},
		{
			name:   "failed",
			topic:  "turn.failed",
			method: "turn/failed",
			payload: map[string]any{
				"threadId": "thread-1",
				"turn": map[string]any{
					"id":     "turn-1",
					"status": "failed",
					"error":  "runtime failure",
				},
			},
			expectedTitle: "Turn failed",
		},
		{
			name:   "interrupted",
			topic:  "turn.interrupted",
			method: "turn/interrupted",
			payload: map[string]any{
				"threadId": "thread-1",
				"turn": map[string]any{
					"id":     "turn-1",
					"status": "interrupted",
				},
			},
			expectedTitle: "Turn interrupted",
		},
		{
			name:   "cancelled",
			topic:  "turn.cancelled",
			method: "turn/cancelled",
			payload: map[string]any{
				"threadId": "thread-1",
				"turn": map[string]any{
					"id":     "turn-1",
					"status": "cancelled",
				},
			},
			expectedTitle: "Turn cancelled",
		},
		{
			name:   "canceled alias",
			topic:  "turn.cancelled",
			method: "turn/canceled",
			payload: map[string]any{
				"threadId": "thread-1",
				"turn": map[string]any{
					"id":     "turn-1",
					"status": "canceled",
				},
			},
			expectedTitle: "Turn cancelled",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			dataStore := store.NewMemoryStore()
			workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
			eventHub := events.NewHub()
			eventHub.AttachStore(dataStore)
			notificationService := notifications.NewService(dataStore)
			service := NewService(dataStore, eventHub, notificationService, nil, Config{})
			service.Start(context.Background())

			_, err := service.CreateSubscription(workspace.ID, UpsertSubscriptionInput{
				Topic: testCase.topic,
				Channels: []SubscriptionChannelInput{{
					Channel: ChannelInApp,
				}},
			})
			if err != nil {
				t.Fatalf("CreateSubscription() error = %v", err)
			}

			eventHub.Publish(store.EventEnvelope{
				WorkspaceID: workspace.ID,
				ThreadID:    "thread-1",
				TurnID:      "turn-1",
				Method:      testCase.method,
				Payload:     testCase.payload,
				TS:          time.Now().UTC(),
			})

			waitForNotificationCount(t, dataStore, 1)

			notificationsList := dataStore.ListNotifications()
			if len(notificationsList) != 1 {
				t.Fatalf("expected 1 notification, got %d", len(notificationsList))
			}
			if notificationsList[0].Title != testCase.expectedTitle {
				t.Fatalf("expected notification title %q, got %#v", testCase.expectedTitle, notificationsList[0])
			}

			dispatches := dataStore.ListNotificationDispatches(workspace.ID, store.NotificationDispatchFilter{})
			if len(dispatches) != 1 {
				t.Fatalf("expected 1 dispatch, got %#v", dispatches)
			}
			if dispatches[0].Topic != testCase.topic || dispatches[0].Status != DispatchStatusDelivered {
				t.Fatalf("expected delivered %s dispatch, got %#v", testCase.topic, dispatches[0])
			}
		})
	}
}

func TestLegacyNotificationCreatedTriggerDispatchesBotOnce(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	provider := newNotificationCenterFakeProvider()
	botService := bots.NewService(dataStore, nil, nil, eventHub, bots.Config{
		PublicBaseURL:                     "https://bots.example.com",
		Providers:                         []bots.Provider{provider},
		AIBackends:                        []bots.AIBackend{notificationCenterFakeAIBackend{}},
		NotificationCenterManagedTriggers: true,
	})
	notificationService := notifications.NewService(dataStore)
	service := NewService(dataStore, eventHub, notificationService, botService, Config{})
	service.Start(context.Background())

	connection, err := botService.CreateConnection(context.Background(), workspace.ID, bots.CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "token-123",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	target, err := botService.UpsertDeliveryTarget(context.Background(), workspace.ID, connection.BotID, bots.UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_topic",
		RouteKey:   "chat:998877:thread:42",
		Title:      "Ops Topic",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget() error = %v", err)
	}

	_, err = botService.CreateTrigger(context.Background(), workspace.ID, connection.BotID, bots.UpsertBotTriggerInput{
		Type:             "notification",
		DeliveryTargetID: target.ID,
		Filter: map[string]string{
			"kind": "automation_run_failed",
		},
	})
	if err != nil {
		t.Fatalf("CreateTrigger() error = %v", err)
	}

	event := store.EventEnvelope{
		WorkspaceID: workspace.ID,
		Method:      "notification/created",
		Payload: map[string]any{
			"notificationId": "ntf-1",
			"kind":           "automation_run_failed",
			"title":          "Automation failed",
			"message":        "Daily summary failed",
			"level":          "error",
		},
		TS: time.Now().UTC(),
	}
	et := time.Now().UTC()
	_ = et
	eventHub.Publish(event)

	select {
	case sent := <-provider.sentCh:
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "Automation failed\nDaily summary failed" {
			t.Fatalf("unexpected bot payload %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for legacy bot trigger delivery")
	}

	eventHub.Publish(event)
	select {
	case sent := <-provider.sentCh:
		t.Fatalf("expected dedupe to suppress second send, got %#v", sent)
	case <-time.After(300 * time.Millisecond):
	}

	dispatches := dataStore.ListNotificationDispatches(workspace.ID, store.NotificationDispatchFilter{})
	if len(dispatches) != 1 {
		t.Fatalf("expected 1 dispatch, got %#v", dispatches)
	}
	if dispatches[0].Status != DispatchStatusDelivered || dispatches[0].BotOutboundDeliveryID == "" {
		t.Fatalf("expected delivered bot dispatch, got %#v", dispatches[0])
	}
}

func TestSubscriptionCanDispatchBotToTargetOwnedByAnotherWorkspace(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	sourceWorkspace := dataStore.CreateWorkspace("Source Workspace", "E:/projects/ai/codex-server")
	botWorkspace := dataStore.CreateWorkspace("Bot Workspace", "E:/projects/ai/codex-server")
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	provider := newNotificationCenterFakeProvider()
	botService := bots.NewService(dataStore, nil, nil, eventHub, bots.Config{
		PublicBaseURL:                     "https://bots.example.com",
		Providers:                         []bots.Provider{provider},
		AIBackends:                        []bots.AIBackend{notificationCenterFakeAIBackend{}},
		NotificationCenterManagedTriggers: true,
	})
	notificationService := notifications.NewService(dataStore)
	service := NewService(dataStore, eventHub, notificationService, botService, Config{})
	service.Start(context.Background())

	connection, err := botService.CreateConnection(context.Background(), botWorkspace.ID, bots.CreateConnectionInput{
		Provider:  "fakechat",
		AIBackend: "fake_ai",
		Secrets: map[string]string{
			"bot_token": "token-456",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection() error = %v", err)
	}

	target, err := botService.UpsertDeliveryTarget(context.Background(), botWorkspace.ID, connection.BotID, bots.UpsertDeliveryTargetInput{
		EndpointID: connection.ID,
		TargetType: "route_backed",
		RouteType:  "telegram_topic",
		RouteKey:   "chat:112233:thread:7",
		Title:      "Shared Ops Topic",
	})
	if err != nil {
		t.Fatalf("UpsertDeliveryTarget() error = %v", err)
	}

	_, err = service.CreateSubscription(sourceWorkspace.ID, UpsertSubscriptionInput{
		Topic: "hook.blocked",
		Channels: []SubscriptionChannelInput{{
			Channel:       ChannelBot,
			TargetRefType: TargetRefTypeBotDeliveryTarget,
			TargetRefID:   target.ID,
		}},
	})
	if err != nil {
		t.Fatalf("CreateSubscription() error = %v", err)
	}

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: sourceWorkspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "hook/completed",
		Payload: map[string]any{
			"run": map[string]any{
				"id":            "hook-run-cross-1",
				"threadId":      "thread-1",
				"turnId":        "turn-1",
				"decision":      "block",
				"status":        "completed",
				"reason":        "shared bot rule",
				"toolName":      "shell",
				"triggerMethod": "turn/start",
			},
		},
		TS: time.Now().UTC(),
	})

	select {
	case sent := <-provider.sentCh:
		if sent.Connection.WorkspaceID != botWorkspace.ID {
			t.Fatalf("expected bot delivery to use owner workspace %q, got %#v", botWorkspace.ID, sent.Connection)
		}
		if len(sent.Messages) != 1 || sent.Messages[0].Text != "Hook blocked a turn\nshell: shared bot rule (turn/start)" {
			t.Fatalf("unexpected bot payload %#v", sent.Messages)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for cross-workspace bot delivery")
	}

	dispatches := dataStore.ListNotificationDispatches(sourceWorkspace.ID, store.NotificationDispatchFilter{})
	waitForDispatchStatus(t, dataStore, sourceWorkspace.ID, DispatchStatusDelivered)

	dispatches = dataStore.ListNotificationDispatches(sourceWorkspace.ID, store.NotificationDispatchFilter{})
	if len(dispatches) != 1 || dispatches[0].BotOutboundDeliveryID == "" {
		t.Fatalf("expected delivered dispatch, got %#v", dispatches)
	}
}

type notificationCenterFakeProvider struct {
	sentCh chan notificationCenterSentMessage
}

type notificationCenterSentMessage struct {
	Connection   store.BotConnection
	Conversation store.BotConversation
	Messages     []bots.OutboundMessage
}

func newNotificationCenterFakeProvider() *notificationCenterFakeProvider {
	return &notificationCenterFakeProvider{sentCh: make(chan notificationCenterSentMessage, 4)}
}

func (p *notificationCenterFakeProvider) Name() string {
	return "fakechat"
}

func (p *notificationCenterFakeProvider) Activate(ctx context.Context, connection store.BotConnection, publicBaseURL string) (bots.ActivationResult, error) {
	return bots.ActivationResult{Settings: map[string]string{"public_base_url": publicBaseURL}}, nil
}

func (p *notificationCenterFakeProvider) Deactivate(ctx context.Context, connection store.BotConnection) error {
	return nil
}

func (p *notificationCenterFakeProvider) ParseWebhook(r *http.Request, connection store.BotConnection) ([]bots.InboundMessage, error) {
	return nil, bots.ErrWebhookIgnored
}

func (p *notificationCenterFakeProvider) SendMessages(ctx context.Context, connection store.BotConnection, conversation store.BotConversation, messages []bots.OutboundMessage) error {
	copied := make([]bots.OutboundMessage, len(messages))
	copy(copied, messages)
	p.sentCh <- notificationCenterSentMessage{Connection: connection, Conversation: conversation, Messages: copied}
	return nil
}

type notificationCenterFakeAIBackend struct{}

func (notificationCenterFakeAIBackend) Name() string {
	return "fake_ai"
}

func (notificationCenterFakeAIBackend) ProcessMessage(ctx context.Context, connection store.BotConnection, conversation store.BotConversation, inbound bots.InboundMessage) (bots.AIResult, error) {
	return bots.AIResult{}, nil
}

func waitForNotificationCount(t *testing.T, dataStore *store.MemoryStore, expected int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(dataStore.ListNotifications()) == expected {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d notifications, got %#v", expected, dataStore.ListNotifications())
}

func waitForDispatchStatus(
	t *testing.T,
	dataStore *store.MemoryStore,
	workspaceID string,
	expectedStatus string,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		dispatches := dataStore.ListNotificationDispatches(workspaceID, store.NotificationDispatchFilter{})
		if len(dispatches) == 1 && dispatches[0].Status == expectedStatus {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf(
		"timed out waiting for dispatch status %q, got %#v",
		expectedStatus,
		dataStore.ListNotificationDispatches(workspaceID, store.NotificationDispatchFilter{}),
	)
}
