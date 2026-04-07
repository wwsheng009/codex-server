package bots

import (
	"regexp"
	"strings"

	"codex-server/backend/internal/store"
)

var (
	wechatAttachmentBlockPattern        = regexp.MustCompile("(?is)```wechat-attachments\\s*(.*?)```")
	wechatAttachmentHeadingBlockPattern = regexp.MustCompile(
		"(?is)(?:^|\\n)\\s*wechat-attachments\\s*:?\\s*\\n```(?:[\\w-]+)?\\s*\\n(.*?)```",
	)
)

const wechatAIOutboundMediaNote = "[Channel note: this conversation is on WeChat. To send media back to the user, append a final `wechat-attachments` fenced block with lines like `image <absolute-path-or-https-url>`, `video <absolute-path-or-https-url>`, or `file <absolute-path-or-https-url>`. Use absolute local paths only.]"

func prepareInboundMessageForAI(connection store.BotConnection, inbound InboundMessage) InboundMessage {
	next := inbound
	next.Media = cloneBotMessageMediaList(inbound.Media)

	if normalizeProviderName(connection.Provider) != wechatProviderName {
		return next
	}

	baseText := strings.TrimSpace(next.Text)
	if baseText == "" {
		baseText = messageSummaryText("", next.Media)
	}
	if baseText == "" {
		baseText = wechatAIOutboundMediaNote
	} else {
		baseText += "\n\n" + wechatAIOutboundMediaNote
	}
	next.Text = strings.TrimSpace(baseText)
	return next
}

func normalizeProviderReplyMessages(connection store.BotConnection, messages []OutboundMessage) []OutboundMessage {
	if len(messages) == 0 {
		return nil
	}

	switch normalizeProviderName(connection.Provider) {
	case wechatProviderName:
		return normalizeWeChatReplyMessages(messages)
	default:
		return cloneOutboundMessages(messages)
	}
}

func normalizeWeChatReplyMessages(messages []OutboundMessage) []OutboundMessage {
	normalized := make([]OutboundMessage, 0, len(messages))
	for _, message := range messages {
		visibleText, parsedMedia := parseWeChatAttachmentProtocol(message.Text)
		visibleText = filterWeChatMarkdownText(visibleText)
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

func parseWeChatAttachmentProtocol(text string) (string, []store.BotMessageMedia) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	attachments := make([]store.BotMessageMedia, 0)

	text, blockAttachments := extractWeChatAttachmentBlocks(text, wechatAttachmentBlockPattern)
	attachments = append(attachments, blockAttachments...)

	text, headingBlockAttachments := extractWeChatAttachmentBlocks(text, wechatAttachmentHeadingBlockPattern)
	attachments = append(attachments, headingBlockAttachments...)

	text, headingLineAttachments := extractWeChatAttachmentHeadingLines(text)
	attachments = append(attachments, headingLineAttachments...)

	lines := strings.Split(text, "\n")
	visibleLines := make([]string, 0, len(lines))
	for _, line := range lines {
		if media, ok := parseWeChatAttachmentDirectiveLine(line); ok {
			attachments = append(attachments, media)
			continue
		}
		visibleLines = append(visibleLines, line)
	}

	visibleText := collapseBlankLines(strings.Join(visibleLines, "\n"))
	return visibleText, attachments
}

func extractWeChatAttachmentBlocks(text string, pattern *regexp.Regexp) (string, []store.BotMessageMedia) {
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
		attachments = append(attachments, parseWeChatAttachmentLines(match[1])...)
	}
	return pattern.ReplaceAllString(text, ""), attachments
}

func extractWeChatAttachmentHeadingLines(text string) (string, []store.BotMessageMedia) {
	lines := strings.Split(text, "\n")
	visibleLines := make([]string, 0, len(lines))
	attachments := make([]store.BotMessageMedia, 0)

	for index := 0; index < len(lines); index++ {
		line := lines[index]
		if !isWeChatAttachmentHeadingLine(line) {
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
			case isWeChatAttachmentBareSpecLine(trimmed):
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

		attachments = append(attachments, parseWeChatAttachmentLines(strings.Join(blockLines, "\n"))...)
		index = next - 1
	}

	return strings.Join(visibleLines, "\n"), attachments
}

func parseWeChatAttachmentLines(block string) []store.BotMessageMedia {
	lines := strings.Split(strings.ReplaceAll(block, "\r\n", "\n"), "\n")
	attachments := make([]store.BotMessageMedia, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if media, ok := parseWeChatAttachmentSpec(trimmed); ok {
			attachments = append(attachments, media)
		}
	}
	return attachments
}

func parseWeChatAttachmentDirectiveLine(line string) (store.BotMessageMedia, bool) {
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
			return buildWeChatAttachmentMedia(kind, strings.TrimSpace(trimmed[len(prefix):]))
		}
	}

	return store.BotMessageMedia{}, false
}

func isWeChatAttachmentHeadingLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	switch strings.ToLower(trimmed) {
	case "wechat-attachments", "wechat-attachments:":
		return true
	default:
		return false
	}
}

func isWeChatAttachmentBareSpecLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}

	parts := strings.Fields(trimmed)
	if len(parts) == 0 {
		return false
	}

	return isWeChatAttachmentKind(parts[0])
}

func parseWeChatAttachmentSpec(line string) (store.BotMessageMedia, bool) {
	parts := strings.Fields(line)
	if len(parts) == 0 {
		return store.BotMessageMedia{}, false
	}

	kind := strings.ToLower(strings.TrimSpace(parts[0]))
	if isWeChatAttachmentKind(kind) {
		location := strings.TrimSpace(line[len(parts[0]):])
		return buildWeChatAttachmentMedia(kind, location)
	}

	return buildWeChatAttachmentMedia("", line)
}

func buildWeChatAttachmentMedia(kind string, location string) (store.BotMessageMedia, bool) {
	location = strings.Trim(strings.TrimSpace(location), "\"'")
	if location == "" {
		return store.BotMessageMedia{}, false
	}

	kind = normalizeWeChatMediaKind(kind)
	if kind == botMediaKindVoice {
		kind = botMediaKindFile
	}
	if kind == "" {
		kind = inferWeChatMediaKindFromLocation(location)
	}

	media := store.BotMessageMedia{
		Kind: kind,
	}
	if isRemoteWeChatMediaURL(location) {
		media.URL = location
	} else {
		media.Path = location
		media.FileName = filepathBaseSafe(location)
	}
	return media, true
}

func inferWeChatMediaKindFromLocation(location string) string {
	lower := strings.ToLower(strings.TrimSpace(location))
	switch {
	case strings.HasSuffix(lower, ".png"),
		strings.HasSuffix(lower, ".jpg"),
		strings.HasSuffix(lower, ".jpeg"),
		strings.HasSuffix(lower, ".gif"),
		strings.HasSuffix(lower, ".webp"),
		strings.HasSuffix(lower, ".bmp"):
		return botMediaKindImage
	case strings.HasSuffix(lower, ".mp4"),
		strings.HasSuffix(lower, ".mov"),
		strings.HasSuffix(lower, ".webm"),
		strings.HasSuffix(lower, ".mkv"),
		strings.HasSuffix(lower, ".avi"):
		return botMediaKindVideo
	default:
		return botMediaKindFile
	}
}

func isRemoteWeChatMediaURL(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://")
}

func isWeChatAttachmentKind(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "media", botMediaKindImage, botMediaKindVideo, botMediaKindFile, botMediaKindVoice:
		return true
	default:
		return false
	}
}

func collapseBlankLines(value string) string {
	lines := strings.Split(value, "\n")
	normalized := make([]string, 0, len(lines))
	previousBlank := false
	for _, line := range lines {
		trimmed := strings.TrimRight(line, " \t")
		if strings.TrimSpace(trimmed) == "" {
			if previousBlank {
				continue
			}
			previousBlank = true
			normalized = append(normalized, "")
			continue
		}
		previousBlank = false
		normalized = append(normalized, trimmed)
	}
	return strings.TrimSpace(strings.Join(normalized, "\n"))
}

func filepathBaseSafe(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(strings.TrimPrefix(value, "file://"), "FILE://")
	if value == "" {
		return ""
	}
	value = strings.Split(value, "?")[0]
	value = strings.Split(value, "#")[0]
	value = strings.ReplaceAll(value, "\\", "/")
	parts := strings.Split(value, "/")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[len(parts)-1])
}
