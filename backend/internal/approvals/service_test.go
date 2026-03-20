package approvals

import "testing"

func TestDynamicToolContentItemsAcceptsTextAndImage(t *testing.T) {
	t.Parallel()

	items := dynamicToolContentItems("accept", map[string]any{
		"text":     "hello",
		"imageUrl": "https://example.com/image.png",
	})

	if len(items) != 2 {
		t.Fatalf("expected 2 content items, got %d", len(items))
	}
}

func TestApprovalActionsForChatgptTokenRefreshOnlyAccept(t *testing.T) {
	t.Parallel()

	actions := approvalActions("account/chatgptAuthTokens/refresh")
	if len(actions) != 1 || actions[0] != "accept" {
		t.Fatalf("expected accept-only actions, got %#v", actions)
	}
}

func TestApprovalResponseChatgptTokenRefreshRequiresTokens(t *testing.T) {
	t.Parallel()

	_, err := approvalResponse("account/chatgptAuthTokens/refresh", ResponseInput{
		Action:  "accept",
		Content: map[string]any{},
	}, map[string]any{"reason": "unauthorized"})
	if err == nil {
		t.Fatal("expected error when token refresh content is incomplete")
	}
}
