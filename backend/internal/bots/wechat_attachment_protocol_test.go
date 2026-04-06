package bots

import (
	"testing"

	"codex-server/backend/internal/store"
)

func TestNormalizeWeChatReplyMessagesStripsMarkdownAndKeepsAttachments(t *testing.T) {
	t.Parallel()

	connection := store.BotConnection{
		Provider: wechatProviderName,
	}
	messages := normalizeProviderReplyMessages(connection, []OutboundMessage{
		{
			Text: "Here is **bold** and `code`.\n> quoted line\n```go\nfmt.Println(1)\n```\n| Name | Value |\n| ---- | ----- |\n| foo | bar |\nMEDIA: https://example.com/output.png",
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected one normalized message, got %#v", messages)
	}

	expectedText := "Here is bold and code.\nquoted line\nfmt.Println(1)\nName\tValue\nfoo\tbar"
	if got := messages[0].Text; got != expectedText {
		t.Fatalf("expected normalized markdown text %q, got %q", expectedText, got)
	}
	if len(messages[0].Media) != 1 {
		t.Fatalf("expected one parsed outbound media item, got %#v", messages[0].Media)
	}
	if got := messages[0].Media[0].URL; got != "https://example.com/output.png" {
		t.Fatalf("expected parsed media url https://example.com/output.png, got %#v", messages[0].Media)
	}
	if got := messages[0].Media[0].Kind; got != botMediaKindImage {
		t.Fatalf("expected parsed media kind image, got %#v", messages[0].Media)
	}
}

func TestFilterWeChatMarkdownTextRemovesRulesAndLinks(t *testing.T) {
	t.Parallel()

	input := "##### Title\n---\nVisit [docs](https://example.com/docs) and ~~old~~ text."
	expected := "Title\nVisit docs and old text."
	if got := filterWeChatMarkdownText(input); got != expected {
		t.Fatalf("expected filtered markdown %q, got %q", expected, got)
	}
}
