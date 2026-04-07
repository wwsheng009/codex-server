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

func TestNormalizeWeChatReplyMessagesTreatsRemoteHormuzMapsAsImageAttachments(t *testing.T) {
	t.Parallel()

	connection := store.BotConnection{
		Provider: wechatProviderName,
	}
	messages := normalizeProviderReplyMessages(connection, []OutboundMessage{
		{
			Text: "直接发两张图。\n\n```wechat-attachments\nimage https://upload.wikimedia.org/wikipedia/commons/6/60/Strait_of_Hormuz.jpg\nimage https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Strait_of_Hormuz-svg-en.svg/1280px-Strait_of_Hormuz-svg-en.svg.png\n```",
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected one normalized message, got %#v", messages)
	}
	if got := messages[0].Text; got != "直接发两张图。" {
		t.Fatalf("expected visible text to exclude attachment block, got %#v", messages[0])
	}
	if len(messages[0].Media) != 2 {
		t.Fatalf("expected two parsed image attachments, got %#v", messages[0].Media)
	}
	if got := messages[0].Media[0]; got.Kind != botMediaKindImage || got.URL != "https://upload.wikimedia.org/wikipedia/commons/6/60/Strait_of_Hormuz.jpg" {
		t.Fatalf("expected first Hormuz map url to stay an image attachment, got %#v", got)
	}
	if got := messages[0].Media[1]; got.Kind != botMediaKindImage || got.URL != "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Strait_of_Hormuz-svg-en.svg/1280px-Strait_of_Hormuz-svg-en.svg.png" {
		t.Fatalf("expected second Hormuz map url to stay an image attachment, got %#v", got)
	}
}

func TestNormalizeWeChatReplyMessagesSupportsHeadingPlusTextFenceAttachmentBlock(t *testing.T) {
	t.Parallel()

	connection := store.BotConnection{
		Provider: wechatProviderName,
	}
	messages := normalizeProviderReplyMessages(connection, []OutboundMessage{
		{
			Text: "直接发你两张可看的霍尔木兹海峡图片，一张地图，一张高清版地图预览。\n\nwechat-attachments\n```text\nimage https://upload.wikimedia.org/wikipedia/commons/6/60/Strait_of_Hormuz.jpg\nimage https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Strait_of_Hormuz-svg-en.svg/1280px-Strait_of_Hormuz-svg-en.svg.png\n```\n\n如果你还要，我可以继续给你补：\n- 卫星图\n- 带航运通道标注的图\n- 中文标注版地图",
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected one normalized message, got %#v", messages)
	}
	expectedText := "直接发你两张可看的霍尔木兹海峡图片，一张地图，一张高清版地图预览。\n\n如果你还要，我可以继续给你补：\n- 卫星图\n- 带航运通道标注的图\n- 中文标注版地图"
	if got := messages[0].Text; got != expectedText {
		t.Fatalf("expected heading+fence attachment block to be removed from visible text, got %#v", messages[0])
	}
	if len(messages[0].Media) != 2 {
		t.Fatalf("expected two parsed image attachments from heading+fence form, got %#v", messages[0].Media)
	}
	if got := messages[0].Media[0]; got.Kind != botMediaKindImage || got.URL != "https://upload.wikimedia.org/wikipedia/commons/6/60/Strait_of_Hormuz.jpg" {
		t.Fatalf("expected first image attachment to parse from heading+fence form, got %#v", got)
	}
	if got := messages[0].Media[1]; got.Kind != botMediaKindImage || got.URL != "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Strait_of_Hormuz-svg-en.svg/1280px-Strait_of_Hormuz-svg-en.svg.png" {
		t.Fatalf("expected second image attachment to parse from heading+fence form, got %#v", got)
	}
}

func TestNormalizeWeChatReplyMessagesSupportsHeadingPlusBareAttachmentLines(t *testing.T) {
	t.Parallel()

	connection := store.BotConnection{
		Provider: wechatProviderName,
	}
	messages := normalizeProviderReplyMessages(connection, []OutboundMessage{
		{
			Text: "直接发你图片。\n\nwechat-attachments:\nimage E:\\tmp\\strait_of_hormuz_map.png\nimage https://upload.wikimedia.org/wikipedia/commons/6/60/Strait_of_Hormuz.jpg\n\n如果你还要，我可以继续补卫星图。",
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected one normalized message, got %#v", messages)
	}
	expectedText := "直接发你图片。\n\n如果你还要，我可以继续补卫星图。"
	if got := messages[0].Text; got != expectedText {
		t.Fatalf("expected heading+bare attachment lines to be removed from visible text, got %#v", messages[0])
	}
	if len(messages[0].Media) != 2 {
		t.Fatalf("expected two parsed attachments from heading+bare form, got %#v", messages[0].Media)
	}
	if got := messages[0].Media[0]; got.Kind != botMediaKindImage || got.Path != "E:\\tmp\\strait_of_hormuz_map.png" {
		t.Fatalf("expected first bare attachment line to parse as local image, got %#v", got)
	}
	if got := messages[0].Media[1]; got.Kind != botMediaKindImage || got.URL != "https://upload.wikimedia.org/wikipedia/commons/6/60/Strait_of_Hormuz.jpg" {
		t.Fatalf("expected second bare attachment line to parse as remote image, got %#v", got)
	}
}

func TestNormalizeWeChatReplyMessagesDoesNotTreatBareAttachmentLinesWithoutHeadingAsAttachments(t *testing.T) {
	t.Parallel()

	connection := store.BotConnection{
		Provider: wechatProviderName,
	}
	messages := normalizeProviderReplyMessages(connection, []OutboundMessage{
		{
			Text: "下面是示例格式，不要真的发附件：\nimage https://example.com/demo.png",
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected one normalized message, got %#v", messages)
	}
	if got := messages[0].Text; got != "下面是示例格式，不要真的发附件：\nimage https://example.com/demo.png" {
		t.Fatalf("expected bare image line without heading to stay visible, got %#v", messages[0])
	}
	if len(messages[0].Media) != 0 {
		t.Fatalf("expected no parsed media without heading, got %#v", messages[0].Media)
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
