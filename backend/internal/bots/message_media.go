package bots

import (
	"fmt"
	"path/filepath"
	"strings"

	"codex-server/backend/internal/store"
)

const (
	botMediaKindImage = "image"
	botMediaKindVideo = "video"
	botMediaKindFile  = "file"
	botMediaKindVoice = "voice"
)

func cloneBotMessageMediaList(media []store.BotMessageMedia) []store.BotMessageMedia {
	if len(media) == 0 {
		return nil
	}

	cloned := make([]store.BotMessageMedia, len(media))
	copy(cloned, media)
	return cloned
}

func equalBotMessageMediaList(left []store.BotMessageMedia, right []store.BotMessageMedia) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func cloneOutboundMessage(message OutboundMessage) OutboundMessage {
	next := message
	next.Media = cloneBotMessageMediaList(message.Media)
	return next
}

func outboundMessageHasContent(message OutboundMessage) bool {
	return strings.TrimSpace(message.Text) != "" || len(message.Media) > 0
}

func inboundMessageHasContent(message InboundMessage) bool {
	return strings.TrimSpace(message.Text) != "" || len(message.Media) > 0
}

func messageSummaryText(text string, media []store.BotMessageMedia) string {
	text = strings.TrimSpace(text)
	if len(media) == 0 {
		return text
	}

	lines := make([]string, 0, len(media)*4+1)
	if text != "" {
		lines = append(lines, text)
	}
	for _, item := range media {
		lines = append(lines, summarizeMediaItem(item))
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
}

func summarizeMediaItem(item store.BotMessageMedia) string {
	kind := strings.TrimSpace(item.Kind)
	if kind == "" {
		kind = botMediaKindFile
	}

	lines := []string{fmt.Sprintf("[WeChat %s attachment]", kind)}
	if fileName := strings.TrimSpace(item.FileName); fileName != "" {
		lines = append(lines, "file_name: "+fileName)
	} else if mediaPath := strings.TrimSpace(item.Path); mediaPath != "" {
		lines = append(lines, "file_name: "+filepath.Base(mediaPath))
	}
	if contentType := strings.TrimSpace(item.ContentType); contentType != "" {
		lines = append(lines, "content_type: "+contentType)
	}
	if mediaPath := strings.TrimSpace(item.Path); mediaPath != "" {
		lines = append(lines, "local_path: "+mediaPath)
	}
	if mediaURL := strings.TrimSpace(item.URL); mediaURL != "" {
		lines = append(lines, "source_url: "+mediaURL)
	}
	return strings.Join(lines, "\n")
}

func outboundReplyMessages(messages []OutboundMessage) []store.BotReplyMessage {
	if len(messages) == 0 {
		return nil
	}

	replyMessages := make([]store.BotReplyMessage, 0, len(messages))
	for _, message := range messages {
		if !outboundMessageHasContent(message) {
			continue
		}
		replyMessages = append(replyMessages, store.BotReplyMessage{
			Text:  strings.TrimSpace(message.Text),
			Media: cloneBotMessageMediaList(message.Media),
		})
	}
	return replyMessages
}

