package bots

import (
	"strings"
	"testing"

	"codex-server/backend/internal/store"
)

func TestNormalizeTelegramReplyMessagesParsesAttachmentBlock(t *testing.T) {
	t.Parallel()

	connection := store.BotConnection{
		Provider: telegramProviderName,
	}
	messages := normalizeProviderReplyMessages(connection, []OutboundMessage{
		{
			Text: "视频已经准备好。\n\n```telegram-attachments\nvideo E:\\temp\\news_brief_output\\international_news_brief_2026-04-08.mp4\nfile https://example.com/report.pdf\n```",
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected one normalized telegram message, got %#v", messages)
	}
	if got := messages[0].Text; got != "视频已经准备好。" {
		t.Fatalf("expected visible text to exclude telegram attachment block, got %#v", messages[0])
	}
	if len(messages[0].Media) != 2 {
		t.Fatalf("expected two parsed telegram attachments, got %#v", messages[0].Media)
	}
	if got := messages[0].Media[0]; got.Kind != botMediaKindVideo || got.Path != `E:\temp\news_brief_output\international_news_brief_2026-04-08.mp4` || got.FileName != "international_news_brief_2026-04-08.mp4" {
		t.Fatalf("expected first telegram attachment to parse as local video, got %#v", got)
	}
	if got := messages[0].Media[1]; got.Kind != botMediaKindFile || got.URL != "https://example.com/report.pdf" {
		t.Fatalf("expected second telegram attachment to parse as remote file, got %#v", got)
	}
}

func TestNormalizeTelegramReplyMessagesSupportsHeadingPlusBareAttachmentLines(t *testing.T) {
	t.Parallel()

	connection := store.BotConnection{
		Provider: telegramProviderName,
	}
	messages := normalizeProviderReplyMessages(connection, []OutboundMessage{
		{
			Text: "我直接发视频。\n\ntelegram-attachments:\nvideo E:\\temp\\news_brief_output\\international_news_brief_2026-04-08.mp4\n\n需要的话我再补来源说明。",
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected one normalized telegram message, got %#v", messages)
	}
	expectedText := "我直接发视频。\n\n需要的话我再补来源说明。"
	if got := messages[0].Text; got != expectedText {
		t.Fatalf("expected heading+bare telegram attachment lines to be removed from visible text, got %#v", messages[0])
	}
	if len(messages[0].Media) != 1 {
		t.Fatalf("expected one parsed telegram attachment, got %#v", messages[0].Media)
	}
	if got := messages[0].Media[0]; got.Kind != botMediaKindVideo || got.Path != `E:\temp\news_brief_output\international_news_brief_2026-04-08.mp4` {
		t.Fatalf("expected bare telegram attachment line to parse as local video, got %#v", got)
	}
}

func TestPrepareInboundMessageForAITelegramAddsAttachmentHint(t *testing.T) {
	t.Parallel()

	prepared := prepareInboundMessageForAI(store.BotConnection{
		Provider: telegramProviderName,
	}, InboundMessage{
		Text: "把视频发给我",
		Media: []store.BotMessageMedia{
			{
				Kind:        botMediaKindImage,
				FileName:    "cover.jpg",
				ContentType: "image/jpeg",
			},
		},
	})

	if !strings.Contains(prepared.Text, "把视频发给我") {
		t.Fatalf("expected prepared telegram text to keep original text, got %q", prepared.Text)
	}
	if !strings.Contains(prepared.Text, "[Image attachment]") {
		t.Fatalf("expected prepared telegram text to include media summary, got %q", prepared.Text)
	}
	if strings.Count(prepared.Text, telegramAIOutboundMediaNote) != 1 {
		t.Fatalf("expected prepared telegram text to include telegram media note exactly once, got %q", prepared.Text)
	}
}
