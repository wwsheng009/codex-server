package bots

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

type wechatSlashCommand struct {
	kind string
	args string
}

func (s *Service) handleProviderCommand(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (bool, string, error) {
	switch normalizeProviderName(connection.Provider) {
	case wechatProviderName:
		return s.handleWeChatSlashCommand(ctx, provider, connection, conversation, inbound)
	default:
		return false, "", nil
	}
}

func (s *Service) handleWeChatSlashCommand(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (bool, string, error) {
	command, recognized, err := parseWeChatSlashCommand(normalizeInboundCommandText(connection, inbound.Text))
	if !recognized {
		return false, "", nil
	}

	if err != nil {
		text := wechatSlashCommandHelp(err.Error())
		return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	}

	switch command.kind {
	case "echo":
		startedAt := time.Now().UTC()
		timingText := renderWeChatSlashTiming(inbound, startedAt, time.Now().UTC())
		messages := make([]OutboundMessage, 0, 2)
		combinedParts := make([]string, 0, 2)
		if echoed := strings.TrimSpace(command.args); echoed != "" {
			messages = append(messages, OutboundMessage{Text: echoed})
			combinedParts = append(combinedParts, echoed)
		}
		messages = append(messages, OutboundMessage{Text: timingText})
		combinedParts = append(combinedParts, timingText)
		combinedText := strings.Join(combinedParts, "\n\n")
		return true, combinedText, provider.SendMessages(ctx, connection, conversation, messages)
	case "toggle_debug":
		nextMode := botRuntimeModeDebug
		text := "WeChat debug mode enabled for this bot connection."
		if connectionRuntimeMode(connection) == botRuntimeModeDebug {
			nextMode = botRuntimeModeNormal
			text = "WeChat debug mode disabled for this bot connection."
		}
		if _, err := s.UpdateConnectionRuntimeMode(connection.WorkspaceID, connection.ID, UpdateConnectionRuntimeModeInput{
			RuntimeMode: nextMode,
		}); err != nil {
			text = "The bot could not toggle debug mode right now: " + err.Error()
			return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
		}
		return true, text, provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: text}})
	default:
		return false, "", nil
	}
}

func parseWeChatSlashCommand(text string) (wechatSlashCommand, bool, error) {
	commandToken, remainder := splitBotCommandText(text)
	if commandToken == "" || !strings.HasPrefix(commandToken, "/") {
		return wechatSlashCommand{}, false, nil
	}

	switch normalizeBotCommandName(commandToken) {
	case "echo":
		return wechatSlashCommand{
			kind: "echo",
			args: strings.TrimSpace(remainder),
		}, true, nil
	case "toggle-debug":
		if strings.TrimSpace(remainder) != "" {
			return wechatSlashCommand{}, true, errors.New("usage: /toggle-debug")
		}
		return wechatSlashCommand{kind: "toggle_debug"}, true, nil
	default:
		return wechatSlashCommand{}, false, nil
	}
}

func wechatSlashCommandHelp(reason string) string {
	lines := []string{
		"WeChat slash commands:",
		"/echo <message>",
		"/toggle-debug",
	}
	if strings.TrimSpace(reason) != "" {
		lines = append([]string{"WeChat slash command error: " + strings.TrimSpace(reason)}, lines...)
	}
	return strings.Join(lines, "\n")
}

func renderWeChatSlashTiming(inbound InboundMessage, startedAt time.Time, now time.Time) string {
	lines := []string{"Channel timing"}

	if createdAt, ok := wechatInboundCreatedAt(inbound); ok {
		lines = append(lines, "Event time: "+createdAt.UTC().Format(time.RFC3339Nano))
		lines = append(lines, "Platform->backend: "+formatWeChatTimingDuration(now.Sub(createdAt)))
	} else {
		lines = append(lines, "Event time: N/A")
		lines = append(lines, "Platform->backend: N/A")
	}
	lines = append(lines, "Backend processing: "+formatWeChatTimingDuration(now.Sub(startedAt)))
	return strings.Join(lines, "\n")
}

func shouldAppendWeChatTimingMessage(connection store.BotConnection) bool {
	return resolveWeChatChannelTimingEnabled(connection)
}

func appendWeChatTimingMessage(
	connection store.BotConnection,
	inbound InboundMessage,
	startedAt time.Time,
	completedAt time.Time,
	messages []OutboundMessage,
) []OutboundMessage {
	if !shouldAppendWeChatTimingMessage(connection) || len(messages) == 0 {
		return messages
	}

	next := cloneOutboundMessages(messages)
	lastIndex := len(next) - 1
	timingText := renderWeChatSlashTiming(inbound, startedAt, completedAt)
	if strings.TrimSpace(next[lastIndex].Text) == "" {
		next[lastIndex].Text = timingText
		return next
	}

	next[lastIndex].Text = strings.TrimSpace(next[lastIndex].Text) + "\n\n" + timingText
	return next
}

func wechatInboundCreatedAt(inbound InboundMessage) (time.Time, bool) {
	raw := strings.TrimSpace(inbound.ProviderData[wechatCreatedAtMSKey])
	if raw == "" {
		return time.Time{}, false
	}
	millis, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	return time.UnixMilli(millis).UTC(), true
}

func formatWeChatTimingDuration(duration time.Duration) string {
	if duration < 0 {
		return "N/A"
	}
	if duration < time.Millisecond {
		return "<1ms"
	}
	rounded := duration.Round(time.Millisecond)
	if rounded <= 0 {
		rounded = time.Millisecond
	}
	return rounded.String()
}
