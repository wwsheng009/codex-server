package bots

import (
	"regexp"
	"strings"

	"codex-server/backend/internal/store"
)

var (
	telegramAttachmentBlockPattern        = regexp.MustCompile("(?is)```telegram-attachments\\s*(.*?)```")
	telegramAttachmentHeadingBlockPattern = regexp.MustCompile(
		"(?is)(?:^|\\n)\\s*telegram-attachments\\s*:?\\s*\\n```(?:[\\w-]+)?\\s*\\n(.*?)```",
	)
)

const telegramAIOutboundMediaNote = "[Channel note: this conversation is on Telegram. To send media back to the user, append a final `telegram-attachments` fenced block with lines like `image <absolute-path-or-https-url>`, `video <absolute-path-or-https-url>`, `file <absolute-path-or-https-url>`, or `voice <absolute-path-or-https-url>`. Use absolute local paths only. Do not send Markdown file links when you intend Telegram to upload the media.]"

func normalizeTelegramReplyMessages(messages []OutboundMessage) []OutboundMessage {
	normalized := make([]OutboundMessage, 0, len(messages))
	for _, message := range messages {
		visibleText, parsedMedia := parseTelegramAttachmentProtocol(message.Text)
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

func parseTelegramAttachmentProtocol(text string) (string, []store.BotMessageMedia) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	attachments := make([]store.BotMessageMedia, 0)

	text, blockAttachments := extractTelegramAttachmentBlocks(text, telegramAttachmentBlockPattern)
	attachments = append(attachments, blockAttachments...)

	text, headingBlockAttachments := extractTelegramAttachmentBlocks(text, telegramAttachmentHeadingBlockPattern)
	attachments = append(attachments, headingBlockAttachments...)

	text, headingLineAttachments := extractTelegramAttachmentHeadingLines(text)
	attachments = append(attachments, headingLineAttachments...)

	lines := strings.Split(text, "\n")
	visibleLines := make([]string, 0, len(lines))
	for _, line := range lines {
		if media, ok := parseTelegramAttachmentDirectiveLine(line); ok {
			attachments = append(attachments, media)
			continue
		}
		visibleLines = append(visibleLines, line)
	}

	visibleText := collapseBlankLines(strings.Join(visibleLines, "\n"))
	return visibleText, attachments
}

func extractTelegramAttachmentBlocks(text string, pattern *regexp.Regexp) (string, []store.BotMessageMedia) {
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
		attachments = append(attachments, parseTelegramAttachmentLines(match[1])...)
	}
	return pattern.ReplaceAllString(text, ""), attachments
}

func extractTelegramAttachmentHeadingLines(text string) (string, []store.BotMessageMedia) {
	lines := strings.Split(text, "\n")
	visibleLines := make([]string, 0, len(lines))
	attachments := make([]store.BotMessageMedia, 0)

	for index := 0; index < len(lines); index++ {
		line := lines[index]
		if !isTelegramAttachmentHeadingLine(line) {
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
			case isTelegramAttachmentBareSpecLine(trimmed):
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

		attachments = append(attachments, parseTelegramAttachmentLines(strings.Join(blockLines, "\n"))...)
		index = next - 1
	}

	return strings.Join(visibleLines, "\n"), attachments
}

func parseTelegramAttachmentLines(block string) []store.BotMessageMedia {
	lines := strings.Split(strings.ReplaceAll(block, "\r\n", "\n"), "\n")
	attachments := make([]store.BotMessageMedia, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if media, ok := parseTelegramAttachmentSpec(trimmed); ok {
			attachments = append(attachments, media)
		}
	}
	return attachments
}

func parseTelegramAttachmentDirectiveLine(line string) (store.BotMessageMedia, bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return store.BotMessageMedia{}, false
	}

	for _, prefix := range []string{"MEDIA:", "IMAGE:", "VIDEO:", "FILE:", "VOICE:"} {
		if strings.HasPrefix(strings.ToUpper(trimmed), prefix) {
			kind := strings.ToLower(strings.TrimSuffix(prefix, ":"))
			if kind == "media" {
				kind = ""
			}
			return buildTelegramAttachmentMedia(kind, strings.TrimSpace(trimmed[len(prefix):]))
		}
	}

	return store.BotMessageMedia{}, false
}

func isTelegramAttachmentHeadingLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	switch strings.ToLower(trimmed) {
	case "telegram-attachments", "telegram-attachments:":
		return true
	default:
		return false
	}
}

func isTelegramAttachmentBareSpecLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}

	parts := strings.Fields(trimmed)
	if len(parts) == 0 {
		return false
	}

	return isTelegramAttachmentKind(parts[0])
}

func parseTelegramAttachmentSpec(line string) (store.BotMessageMedia, bool) {
	parts := strings.Fields(line)
	if len(parts) == 0 {
		return store.BotMessageMedia{}, false
	}

	kind := strings.ToLower(strings.TrimSpace(parts[0]))
	if isTelegramAttachmentKind(kind) {
		location := strings.TrimSpace(line[len(parts[0]):])
		return buildTelegramAttachmentMedia(kind, location)
	}

	return buildTelegramAttachmentMedia("", line)
}

func buildTelegramAttachmentMedia(kind string, location string) (store.BotMessageMedia, bool) {
	location = strings.Trim(strings.TrimSpace(location), "\"'")
	if location == "" {
		return store.BotMessageMedia{}, false
	}

	kind = normalizeTelegramMediaKind(kind)
	if kind == "" {
		kind = inferTelegramMediaKindFromLocation(location)
	}

	media := store.BotMessageMedia{
		Kind: kind,
	}
	if isRemoteTelegramMediaURL(location) {
		media.URL = location
	} else {
		media.Path = location
		media.FileName = filepathBaseSafe(location)
	}
	return media, true
}

func isRemoteTelegramMediaURL(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://")
}

func isTelegramAttachmentKind(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "media", botMediaKindImage, botMediaKindVideo, botMediaKindFile, botMediaKindVoice:
		return true
	default:
		return false
	}
}
