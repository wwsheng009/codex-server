package bots

import (
	"fmt"
	"strings"

	"codex-server/backend/internal/store"
)

const (
	wechatChannelTimingSetting  = "wechat_channel_timing"
	wechatChannelTimingEnabled  = "enabled"
	wechatChannelTimingDisabled = "disabled"
)

func normalizeWeChatChannelTimingSetting(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "inherit", "default":
		return "", nil
	case wechatChannelTimingEnabled:
		return wechatChannelTimingEnabled, nil
	case wechatChannelTimingDisabled:
		return wechatChannelTimingDisabled, nil
	default:
		return "", fmt.Errorf("%w: wechat channel timing must be enabled or disabled", ErrInvalidInput)
	}
}

func resolveWeChatChannelTimingEnabled(connection store.BotConnection) bool {
	if normalizeProviderName(connection.Provider) != wechatProviderName {
		return false
	}

	setting, err := normalizeWeChatChannelTimingSetting(connection.Settings[wechatChannelTimingSetting])
	if err == nil {
		switch setting {
		case wechatChannelTimingEnabled:
			return true
		case wechatChannelTimingDisabled:
			return false
		}
	}

	return connectionRuntimeMode(connection) == botRuntimeModeDebug
}
