package bots

import (
	"regexp"
	"strings"

	"codex-server/backend/internal/store"
)

var (
	feishuAttachmentBlockPattern        = regexp.MustCompile("(?is)```feishu-attachments\\s*(.*?)```")
	feishuAttachmentHeadingBlockPattern = regexp.MustCompile(
		"(?is)(?:^|\\n)\\s*feishu-attachments\\s*:?\\s*\\n```(?:[\\w-]+)?\\s*\\n(.*?)```",
	)
)

const feishuAIOutboundMediaNote = "[Channel note: this conversation is on Feishu. To send media back to the user, append a final `feishu-attachments` fenced block with lines like `image <absolute-path-or-https-url>`, `file <absolute-path-or-https-url>`, or `voice <absolute-path-or-https-url>`. Feishu voice/audio messages require an Opus/Ogg file. Use absolute local paths only.]"

func normalizeFeishuReplyMessages(messages []OutboundMessage) []OutboundMessage {
	normalized := make([]OutboundMessage, 0, len(messages))
	for _, message := range messages {
		visibleText, parsedMedia := parseFeishuAttachmentProtocol(message.Text)
		combinedMedia := cloneBotMessageMediaList(message.Media)
		if len(parsedMedia) > 0 {
			combinedMedia = append(combinedMedia, parsedMedia...)
		}

		next := OutboundMessage{
			Text:  strings.TrimSpace(visibleText),
			Media: combinedMedia,
		}
		if !outboundMessageHasContent(next) {
			continue
		}
		normalized = append(normalized, next)
	}
	return normalized
}

func parseFeishuAttachmentProtocol(text string) (string, []store.BotMessageMedia) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	attachments := make([]store.BotMessageMedia, 0)

	text, blockAttachments := extractFeishuAttachmentBlocks(text, feishuAttachmentBlockPattern)
	attachments = append(attachments, blockAttachments...)

	text, headingBlockAttachments := extractFeishuAttachmentBlocks(text, feishuAttachmentHeadingBlockPattern)
	attachments = append(attachments, headingBlockAttachments...)

	text, headingLineAttachments := extractFeishuAttachmentHeadingLines(text)
	attachments = append(attachments, headingLineAttachments...)

	lines := strings.Split(text, "\n")
	visibleLines := make([]string, 0, len(lines))
	for _, line := range lines {
		if media, ok := parseFeishuAttachmentDirectiveLine(line); ok {
			attachments = append(attachments, media)
			continue
		}
		visibleLines = append(visibleLines, line)
	}

	visibleText := collapseBlankLines(strings.Join(visibleLines, "\n"))
	return visibleText, attachments
}

func extractFeishuAttachmentBlocks(text string, pattern *regexp.Regexp) (string, []store.BotMessageMedia) {
	if pattern == nil {
		return text, nil
	}

	matches := pattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return text, nil
	}

	attachments := make([]store.BotMessageMedia, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		attachments = append(attachments, parseFeishuAttachmentLines(match[1])...)
	}
	return pattern.ReplaceAllString(text, ""), attachments
}

func extractFeishuAttachmentHeadingLines(text string) (string, []store.BotMessageMedia) {
	lines := strings.Split(text, "\n")
	visibleLines := make([]string, 0, len(lines))
	attachments := make([]store.BotMessageMedia, 0)

	for index := 0; index < len(lines); index++ {
		line := lines[index]
		if !isFeishuAttachmentHeadingLine(line) {
			visibleLines = append(visibleLines, line)
			continue
		}

		blockLines := make([]string, 0)
		next := index + 1
		for ; next < len(lines); next++ {
			trimmed := strings.TrimSpace(lines[next])
			switch {
			case trimmed == "":
				if len(blockLines) > 0 {
					next++
				}
				goto consumeHeadingBlock
			case strings.HasPrefix(trimmed, "#"):
				blockLines = append(blockLines, lines[next])
			case isFeishuAttachmentBareSpecLine(trimmed):
				blockLines = append(blockLines, lines[next])
			default:
				goto consumeHeadingBlock
			}
		}

	consumeHeadingBlock:
		if len(blockLines) == 0 {
			visibleLines = append(visibleLines, line)
			continue
		}

		attachments = append(attachments, parseFeishuAttachmentLines(strings.Join(blockLines, "\n"))...)
		index = next - 1
	}

	return strings.Join(visibleLines, "\n"), attachments
}

func parseFeishuAttachmentLines(block string) []store.BotMessageMedia {
	lines := strings.Split(strings.ReplaceAll(block, "\r\n", "\n"), "\n")
	attachments := make([]store.BotMessageMedia, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if media, ok := parseFeishuAttachmentSpec(trimmed); ok {
			attachments = append(attachments, media)
		}
	}
	return attachments
}

func parseFeishuAttachmentDirectiveLine(line string) (store.BotMessageMedia, bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return store.BotMessageMedia{}, false
	}
	for _, prefix := range []string{"MEDIA:", "IMAGE:", "VIDEO:", "FILE:", "VOICE:", "AUDIO:"} {
		if strings.HasPrefix(strings.ToUpper(trimmed), prefix) {
			kind := strings.ToLower(strings.TrimSuffix(prefix, ":"))
			if kind == "media" {
				kind = ""
			}
			return buildFeishuAttachmentMedia(kind, strings.TrimSpace(trimmed[len(prefix):]))
		}
	}
	return store.BotMessageMedia{}, false
}

func isFeishuAttachmentHeadingLine(line string) bool {
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "feishu-attachments", "feishu-attachments:":
		return true
	default:
		return false
	}
}

func isFeishuAttachmentBareSpecLine(line string) bool {
	parts := strings.Fields(strings.TrimSpace(line))
	if len(parts) < 2 {
		return false
	}
	return isFeishuAttachmentKind(parts[0])
}

func parseFeishuAttachmentSpec(line string) (store.BotMessageMedia, bool) {
	parts := strings.Fields(strings.TrimSpace(line))
	if len(parts) < 2 {
		return store.BotMessageMedia{}, false
	}

	kind := strings.ToLower(strings.TrimSpace(parts[0]))
	location := strings.TrimSpace(strings.Join(parts[1:], " "))
	if isFeishuAttachmentKind(kind) {
		return buildFeishuAttachmentMedia(kind, location)
	}
	return buildFeishuAttachmentMedia("", strings.TrimSpace(line))
}

func buildFeishuAttachmentMedia(kind string, location string) (store.BotMessageMedia, bool) {
	location = strings.TrimSpace(location)
	if location == "" {
		return store.BotMessageMedia{}, false
	}

	media := store.BotMessageMedia{}
	switch normalizeFeishuAttachmentKind(kind) {
	case botMediaKindImage:
		media.Kind = botMediaKindImage
	case botMediaKindVideo:
		media.Kind = botMediaKindVideo
	case botMediaKindAudio:
		media.Kind = botMediaKindAudio
	case botMediaKindVoice:
		media.Kind = botMediaKindVoice
	default:
		media.Kind = botMediaKindFile
	}

	lower := strings.ToLower(location)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		media.URL = location
	} else {
		media.Path = location
	}
	return media, true
}

func normalizeFeishuAttachmentKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case botMediaKindImage:
		return botMediaKindImage
	case botMediaKindVideo:
		return botMediaKindVideo
	case botMediaKindAudio:
		return botMediaKindAudio
	case botMediaKindVoice:
		return botMediaKindVoice
	case botMediaKindFile:
		return botMediaKindFile
	default:
		return ""
	}
}

func isFeishuAttachmentKind(value string) bool {
	return normalizeFeishuAttachmentKind(value) != ""
}
