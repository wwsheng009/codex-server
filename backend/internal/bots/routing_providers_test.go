package bots

import (
	"testing"

	"codex-server/backend/internal/store"
)

func TestDeliveryRouteFromConversationSupportsFeishu(t *testing.T) {
	connection := store.BotConnection{Provider: "feishu"}
	conversation := store.BotConversation{
		ExternalChatID:   "oc_chat_123",
		ExternalThreadID: "om_thread_456",
	}

	routeType, routeKey := deliveryRouteFromConversation(connection, conversation)
	if routeType != "feishu_thread" {
		t.Fatalf("expected feishu_thread route type, got %q", routeType)
	}
	if routeKey != "chat:oc_chat_123:thread:om_thread_456" {
		t.Fatalf("expected feishu thread route key, got %q", routeKey)
	}
}

func TestDeliveryRouteFromConversationSupportsQQBot(t *testing.T) {
	connection := store.BotConnection{Provider: "qqbot"}
	conversation := store.BotConversation{
		ExternalChatID: "group_openid_123",
		ProviderState: map[string]string{
			"qqbot_message_type": "group",
		},
	}

	routeType, routeKey := deliveryRouteFromConversation(connection, conversation)
	if routeType != "qqbot_group" {
		t.Fatalf("expected qqbot_group route type, got %q", routeType)
	}
	if routeKey != "group:group_openid_123" {
		t.Fatalf("expected qqbot group route key, got %q", routeKey)
	}

	conversation = store.BotConversation{
		ExternalChatID: "user_openid_456",
		ExternalUserID: "user_openid_456",
		ProviderState: map[string]string{
			"qqbot_message_type": "c2c",
		},
	}
	routeType, routeKey = deliveryRouteFromConversation(connection, conversation)
	if routeType != "qqbot_c2c" {
		t.Fatalf("expected qqbot_c2c route type, got %q", routeType)
	}
	if routeKey != "user:user_openid_456" {
		t.Fatalf("expected qqbot c2c route key, got %q", routeKey)
	}
}

func TestBuildSyntheticConversationForFeishuTarget(t *testing.T) {
	connection := store.BotConnection{Provider: "feishu"}
	target := store.BotDeliveryTarget{
		BotID:        "bot_1",
		WorkspaceID:  "ws_1",
		ConnectionID: "conn_1",
		Provider:     "feishu",
		RouteType:    "feishu_thread",
		RouteKey:     "chat:oc_chat_123:thread:om_thread_456",
		ProviderState: map[string]string{
			"feishu_user_open_id": "ou_user_789",
		},
	}

	conversation, err := buildSyntheticConversationForTarget(connection, target)
	if err != nil {
		t.Fatalf("buildSyntheticConversationForTarget() error = %v", err)
	}
	if conversation.ExternalChatID != "oc_chat_123" {
		t.Fatalf("expected chat id oc_chat_123, got %q", conversation.ExternalChatID)
	}
	if conversation.ExternalThreadID != "om_thread_456" {
		t.Fatalf("expected thread id om_thread_456, got %q", conversation.ExternalThreadID)
	}
	if conversation.ExternalUserID != "ou_user_789" {
		t.Fatalf("expected user id ou_user_789, got %q", conversation.ExternalUserID)
	}
}

func TestBuildSyntheticConversationForQQBotTarget(t *testing.T) {
	connection := store.BotConnection{Provider: "qqbot"}
	target := store.BotDeliveryTarget{
		BotID:        "bot_1",
		WorkspaceID:  "ws_1",
		ConnectionID: "conn_1",
		Provider:     "qqbot",
		RouteType:    "qqbot_c2c",
		RouteKey:     "user:user_openid_456",
	}

	conversation, err := buildSyntheticConversationForTarget(connection, target)
	if err != nil {
		t.Fatalf("buildSyntheticConversationForTarget() error = %v", err)
	}
	if conversation.ExternalChatID != "user_openid_456" {
		t.Fatalf("expected chat id user_openid_456, got %q", conversation.ExternalChatID)
	}
	if conversation.ExternalConversationID != "user:user_openid_456" {
		t.Fatalf("expected conversation id user:user_openid_456, got %q", conversation.ExternalConversationID)
	}
	if conversation.ProviderState["qqbot_message_type"] != "c2c" {
		t.Fatalf("expected qqbot message type c2c, got %#v", conversation.ProviderState)
	}
}
