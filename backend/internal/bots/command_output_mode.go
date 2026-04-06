package bots

import (
	"fmt"
	"strings"

	"codex-server/backend/internal/store"
)

const (
	botCommandOutputModeSetting    = "command_output_mode"
	botCommandOutputModeSingleLine = "single_line"
	botCommandOutputModeBrief      = "brief"
	botCommandOutputModeDetailed   = "detailed"
	botCommandOutputModeFull       = "full"
)

func normalizeBotCommandOutputMode(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", botCommandOutputModeBrief:
		return botCommandOutputModeBrief, nil
	case botCommandOutputModeSingleLine:
		return botCommandOutputModeSingleLine, nil
	case botCommandOutputModeDetailed:
		return botCommandOutputModeDetailed, nil
	case botCommandOutputModeFull:
		return botCommandOutputModeFull, nil
	default:
		return "", fmt.Errorf(
			"%w: bot command output mode must be single_line, brief, detailed, or full",
			ErrInvalidInput,
		)
	}
}

func connectionCommandOutputMode(connection store.BotConnection) string {
	mode, err := normalizeBotCommandOutputMode(connection.Settings[botCommandOutputModeSetting])
	if err != nil {
		return botCommandOutputModeBrief
	}
	return mode
}
