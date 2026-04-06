package bots

import (
	"regexp"
	"strings"
)

var (
	wechatMarkdownImagePattern            = regexp.MustCompile(`!\[[^\]]*]\([^)\n]*\)`)
	wechatMarkdownLinkPattern             = regexp.MustCompile(`\[(.*?)\]\([^)\n]*\)`)
	wechatMarkdownInlineCodePattern       = regexp.MustCompile("`([^`\\n]+)`")
	wechatMarkdownStrikePattern           = regexp.MustCompile(`~~([^~\n]+)~~`)
	wechatMarkdownTripleStarPattern       = regexp.MustCompile(`\*\*\*([^*\n]+)\*\*\*`)
	wechatMarkdownTripleUnderscorePattern = regexp.MustCompile(`___([^_\n]+)___`)
	wechatMarkdownBoldPattern             = regexp.MustCompile(`\*\*([^*\n]+)\*\*`)
	wechatMarkdownUnderlineBoldPattern    = regexp.MustCompile(`__([^_\n]+)__`)
	wechatMarkdownItalicPattern           = regexp.MustCompile(`\*([^*\n]+)\*`)
	wechatMarkdownUnderlineItalicPattern  = regexp.MustCompile(`_([^_\n]+)_`)
	wechatMarkdownHeadingPattern          = regexp.MustCompile(`^\s{0,3}#{1,6}\s+`)
	wechatMarkdownQuotePattern            = regexp.MustCompile(`^\s*>\s?`)
	wechatMarkdownRulePattern             = regexp.MustCompile(`^\s*([*\-_]\s*){3,}\s*$`)
)

func filterWeChatMarkdownText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	if strings.TrimSpace(value) == "" {
		return ""
	}

	lines := strings.Split(value, "\n")
	filtered := make([]string, 0, len(lines))
	inFence := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inFence = !inFence
			continue
		}

		if inFence {
			filtered = append(filtered, strings.TrimRight(line, " \t"))
			continue
		}
		if wechatMarkdownRulePattern.MatchString(line) {
			continue
		}

		line = wechatMarkdownQuotePattern.ReplaceAllString(line, "")
		line = wechatMarkdownHeadingPattern.ReplaceAllString(line, "")
		if row, ok := filterWeChatMarkdownTableRow(line); ok {
			if row != "" {
				filtered = append(filtered, row)
			}
			continue
		}
		filtered = append(filtered, filterWeChatMarkdownInline(line))
	}

	return collapseBlankLines(strings.Join(filtered, "\n"))
}

func filterWeChatMarkdownTableRow(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "|") {
		return "", false
	}
	if strings.Contains(trimmed, "-") && strings.Trim(trimmed, "|:- ") == "" {
		return "", true
	}

	parts := strings.Split(trimmed, "|")
	cells := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		cells = append(cells, filterWeChatMarkdownInline(part))
	}
	if len(cells) == 0 {
		return "", true
	}
	return strings.Join(cells, "\t"), true
}

func filterWeChatMarkdownInline(line string) string {
	line = wechatMarkdownImagePattern.ReplaceAllString(line, "")
	line = wechatMarkdownLinkPattern.ReplaceAllString(line, "$1")

	replacers := []*regexp.Regexp{
		wechatMarkdownInlineCodePattern,
		wechatMarkdownStrikePattern,
		wechatMarkdownTripleStarPattern,
		wechatMarkdownTripleUnderscorePattern,
		wechatMarkdownBoldPattern,
		wechatMarkdownUnderlineBoldPattern,
		wechatMarkdownItalicPattern,
		wechatMarkdownUnderlineItalicPattern,
	}
	for _, pattern := range replacers {
		for {
			next := pattern.ReplaceAllString(line, "$1")
			if next == line {
				break
			}
			line = next
		}
	}

	line = strings.ReplaceAll(line, "**", "")
	line = strings.ReplaceAll(line, "__", "")
	line = strings.ReplaceAll(line, "~~", "")
	return strings.TrimRight(line, " \t")
}
