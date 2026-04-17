package bots

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/store"

	"github.com/gorilla/websocket"
)

const (
	qqbotProviderName                    = "qqbot"
	qqbotAppIDSetting                    = "qqbot_app_id"
	qqbotSandboxSetting                  = "qqbot_sandbox"
	qqbotShareSessionInChannelSetting    = "qqbot_share_session_in_channel"
	qqbotMarkdownSupportSetting          = "qqbot_markdown_support"
	qqbotIntentsSetting                  = "qqbot_intents"
	qqbotGatewaySessionIDSetting         = "qqbot_gateway_session_id"
	qqbotGatewaySeqSetting               = "qqbot_gateway_seq"
	qqbotAppSecretKey                    = "qqbot_app_secret"
	qqbotMessageTypeKey                  = "qqbot_message_type"
	qqbotGroupOpenIDKey                  = "qqbot_group_openid"
	qqbotUserOpenIDKey                   = "qqbot_user_openid"
	qqbotEventMessageIDKey               = "qqbot_event_msg_id"
	qqbotMarkdownSupportProviderStateKey = "qqbot_markdown_support"
	qqbotDefaultGatewayIntent            = 1 << 25
	qqbotMessageTextLimitRunes           = 2000
	qqbotTokenRefreshMargin              = 5 * time.Minute
	qqbotGatewayHelloTimeout             = 15 * time.Second
	qqbotGatewayReadyTimeout             = 15 * time.Second
	qqbotGatewayReconnectBaseDelay       = time.Second
	qqbotGatewayReconnectMaxDelay        = 30 * time.Second
)

const (
	qqbotGatewayOpDispatch       = 0
	qqbotGatewayOpHeartbeat      = 1
	qqbotGatewayOpIdentify       = 2
	qqbotGatewayOpResume         = 6
	qqbotGatewayOpReconnect      = 7
	qqbotGatewayOpInvalidSession = 9
	qqbotGatewayOpHello          = 10
	qqbotGatewayOpHeartbeatACK   = 11
)

const (
	qqbotMessageTypeGroup = "group"
	qqbotMessageTypeC2C   = "c2c"
)

type qqbotProvider struct {
	clients httpClientSource

	tokenURL   string
	apiBaseURL string
	wsDialer   *websocket.Dialer
	now        func() time.Time
	sleep      func(context.Context, time.Duration) error

	tokenMu    sync.Mutex
	tokenCache map[string]qqbotTokenCacheEntry

	msgSeqMu sync.Mutex
	msgSeq   map[string]int
}

type qqbotTokenCacheEntry struct {
	accessToken string
	expiresAt   time.Time
}

type qqbotConfig struct {
	appID                 string
	appSecret             string
	sandbox               bool
	shareSessionInChannel bool
	markdownSupport       bool
	intents               int
}

type qqbotTokenResponse struct {
	AccessToken string          `json:"access_token"`
	ExpiresIn   json.RawMessage `json:"expires_in"`
}

type qqbotGatewayResponse struct {
	URL string `json:"url"`
}

type qqbotGatewayPayload struct {
	Op int             `json:"op"`
	D  json.RawMessage `json:"d,omitempty"`
	S  *int64          `json:"s,omitempty"`
	T  string          `json:"t,omitempty"`
}

type qqbotGatewayHelloData struct {
	HeartbeatInterval int `json:"heartbeat_interval"`
}

type qqbotGatewayReadyData struct {
	SessionID string `json:"session_id"`
}

type qqbotGatewayReadResult struct {
	payload qqbotGatewayPayload
	err     error
}

type qqbotGatewaySessionState struct {
	sessionID string
	lastSeq   int64
}

type qqbotGatewayReconnectError struct {
	clearSession bool
}

func (e *qqbotGatewayReconnectError) Error() string {
	if e == nil {
		return ""
	}
	return "qqbot gateway reconnect required"
}

type qqbotRequestError struct {
	method     string
	endpoint   string
	statusCode int
	status     string
	body       string
	cause      error
}

func (e *qqbotRequestError) Error() string {
	if e == nil {
		return ""
	}
	if e.cause != nil {
		return fmt.Sprintf("qqbot %s request failed: %v", e.method, e.cause)
	}

	detail := strings.TrimSpace(e.body)
	switch {
	case e.status != "" && detail != "":
		return fmt.Sprintf("qqbot %s returned %s: %s", e.method, e.status, detail)
	case e.status != "":
		return fmt.Sprintf("qqbot %s returned %s", e.method, e.status)
	case detail != "":
		return fmt.Sprintf("qqbot %s request failed: %s", e.method, detail)
	default:
		return fmt.Sprintf("qqbot %s request failed", e.method)
	}
}

func (e *qqbotRequestError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

type qqbotGroupMessageEvent struct {
	ID               string                  `json:"id"`
	MsgID            string                  `json:"msg_id"`
	GroupOpenID      string                  `json:"group_openid"`
	Content          string                  `json:"content"`
	MessageReference *qqbotMessageReference  `json:"message_reference"`
	Author           qqbotGroupMessageAuthor `json:"author"`
}

type qqbotGroupMessageAuthor struct {
	MemberOpenID string `json:"member_openid"`
}

type qqbotC2CMessageEvent struct {
	ID               string                 `json:"id"`
	MsgID            string                 `json:"msg_id"`
	Content          string                 `json:"content"`
	MessageReference *qqbotMessageReference `json:"message_reference"`
	Author           qqbotC2CMessageAuthor  `json:"author"`
}

type qqbotC2CMessageAuthor struct {
	UserOpenID string `json:"user_openid"`
}

type qqbotMessageReference struct {
	MessageID         string              `json:"message_id"`
	Content           string              `json:"content,omitempty"`
	Title             string              `json:"title,omitempty"`
	Message           *qqbotQuotedMessage `json:"message,omitempty"`
	ReferencedMessage *qqbotQuotedMessage `json:"referenced_message,omitempty"`
	SourceMessage     *qqbotQuotedMessage `json:"source_message,omitempty"`
}

type qqbotQuotedMessage struct {
	Content string `json:"content,omitempty"`
	Title   string `json:"title,omitempty"`
}

func newQQBotProvider(client *http.Client) Provider {
	return newQQBotProviderWithClientSource(staticHTTPClientSource{client: client})
}

func newQQBotProviderWithClientSource(clients httpClientSource) Provider {
	if clients == nil {
		clients = staticHTTPClientSource{}
	}

	return &qqbotProvider{
		clients:    clients,
		tokenURL:   "https://bots.qq.com/app/getAppAccessToken",
		apiBaseURL: "https://api.sgroup.qq.com",
		wsDialer:   websocket.DefaultDialer,
		now:        func() time.Time { return time.Now().UTC() },
		sleep:      qqbotSleepWithContext,
	}
}

func (p *qqbotProvider) Name() string {
	return qqbotProviderName
}

func (p *qqbotProvider) Activate(
	ctx context.Context,
	connection store.BotConnection,
	_ string,
) (ActivationResult, error) {
	cfg, err := parseQQBotConfig(connection)
	if err != nil {
		return ActivationResult{}, err
	}

	if _, err := p.getAccessToken(ctx, cfg, false); err != nil {
		return ActivationResult{}, err
	}
	if _, err := p.getGatewayURL(ctx, cfg); err != nil {
		return ActivationResult{}, err
	}

	settings := qqbotCloneStringMap(connection.Settings)
	if settings == nil {
		settings = make(map[string]string)
	}
	settings[qqbotAppIDSetting] = cfg.appID
	settings[qqbotSandboxSetting] = strconv.FormatBool(cfg.sandbox)
	settings[qqbotShareSessionInChannelSetting] = strconv.FormatBool(cfg.shareSessionInChannel)
	settings[qqbotMarkdownSupportSetting] = strconv.FormatBool(cfg.markdownSupport)
	settings[qqbotIntentsSetting] = strconv.Itoa(cfg.intents)

	secrets := qqbotCloneStringMap(connection.Secrets)
	if secrets == nil {
		secrets = make(map[string]string)
	}
	secrets[qqbotAppSecretKey] = cfg.appSecret

	return ActivationResult{
		Settings: settings,
		Secrets:  secrets,
	}, nil
}

func (p *qqbotProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *qqbotProvider) ParseWebhook(*http.Request, store.BotConnection) ([]InboundMessage, error) {
	return nil, ErrWebhookIgnored
}

func (p *qqbotProvider) SupportsPolling(connection store.BotConnection) bool {
	_, err := parseQQBotConfig(connection)
	return err == nil
}

func (p *qqbotProvider) PollingOwnerKey(connection store.BotConnection) string {
	cfg, err := parseQQBotConfig(connection)
	if err != nil {
		return ""
	}
	return strings.Join([]string{
		qqbotProviderName,
		cfg.appID,
		strconv.FormatBool(cfg.sandbox),
	}, ":")
}

func (p *qqbotProvider) PollingConflictError(ownerConnectionID string) error {
	message := "qqbot gateway credentials are already claimed by another active connection"
	if owner := strings.TrimSpace(ownerConnectionID); owner != "" {
		message += " (" + owner + ")"
	}
	message += "; pause or delete the other connection before resuming this one"
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

func (p *qqbotProvider) RunPolling(
	ctx context.Context,
	connection store.BotConnection,
	handleMessage PollingMessageHandler,
	updateSettings PollingSettingsHandler,
	reportEvent PollingEventHandler,
) error {
	cfg, err := parseQQBotConfig(connection)
	if err != nil {
		return err
	}
	if handleMessage == nil {
		return fmt.Errorf("%w: qqbot polling handler is required", ErrInvalidInput)
	}

	state, err := p.restoreGatewaySessionState(connection)
	if err != nil {
		return err
	}

	retryDelay := qqbotGatewayReconnectBaseDelay
	for {
		err := p.runGatewaySession(ctx, connection, cfg, state, handleMessage, updateSettings, reportEvent)
		switch {
		case err == nil:
			return nil
		case errors.Is(err, context.Canceled):
			return err
		}

		var reconnectErr *qqbotGatewayReconnectError
		if errors.As(err, &reconnectErr) {
			if reconnectErr.clearSession {
				state = qqbotGatewaySessionState{}
				if err := p.persistGatewaySessionState(ctx, updateSettings, state); err != nil {
					return err
				}
			}
			if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
				EventType: "poll_idle",
				Message:   "QQ Bot gateway disconnected. Reconnecting.",
			}); err != nil {
				return err
			}
			if err := p.sleepFunc()(ctx, retryDelay); err != nil {
				return err
			}
			retryDelay = min(retryDelay*2, qqbotGatewayReconnectMaxDelay)
			continue
		}

		if isQQBotTransientPollingError(err) {
			if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
				EventType: "poll_idle",
				Message:   "QQ Bot gateway temporarily unavailable. Retrying.",
			}); err != nil {
				return err
			}
			if err := p.sleepFunc()(ctx, retryDelay); err != nil {
				return err
			}
			retryDelay = min(retryDelay*2, qqbotGatewayReconnectMaxDelay)
			continue
		}

		return err
	}
}

func (p *qqbotProvider) SendMessages(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	messages []OutboundMessage,
) error {
	cfg, err := parseQQBotConfig(connection)
	if err != nil {
		return err
	}

	target, err := resolveQQBotOutboundTarget(connection, conversation)
	if err != nil {
		return err
	}

	deliveredParts := 0
	usePassive := strings.TrimSpace(target.eventMsgID) != ""
	for _, message := range messages {
		if strings.TrimSpace(message.Text) == "" {
			// continue below for media-only messages
		} else {
			for _, chunk := range splitQQBotText(message.Text, qqbotMessageTextLimitRunes) {
				chunkUsePassive := usePassive
				err := p.sendTextMessage(ctx, cfg, target, chunk, chunkUsePassive)
				if err != nil && chunkUsePassive && shouldQQBotFallbackToProactive(err) {
					usePassive = false
					err = p.sendTextMessage(ctx, cfg, target, chunk, false)
				}
				if err != nil {
					return err
				}
				deliveredParts++
			}
		}

		for _, item := range message.Media {
			mediaUsePassive := usePassive
			err := p.sendMediaMessage(ctx, cfg, target, item, mediaUsePassive)
			if err != nil && mediaUsePassive && shouldQQBotFallbackToProactive(err) {
				usePassive = false
				err = p.sendMediaMessage(ctx, cfg, target, item, false)
			}
			if err != nil {
				return err
			}
			deliveredParts++
		}
	}

	if deliveredParts == 0 {
		return nil
	}
	return nil
}

func (p *qqbotProvider) runGatewaySession(
	ctx context.Context,
	connection store.BotConnection,
	cfg qqbotConfig,
	state qqbotGatewaySessionState,
	handleMessage PollingMessageHandler,
	updateSettings PollingSettingsHandler,
	reportEvent PollingEventHandler,
) error {
	gatewayURL, err := p.getGatewayURL(ctx, cfg)
	if err != nil {
		return err
	}

	conn, _, err := p.dialer().DialContext(ctx, gatewayURL, nil)
	if err != nil {
		return &qqbotGatewayReconnectError{}
	}
	defer conn.Close()

	helloPayload, err := p.readGatewayPayloadWithDeadline(conn, qqbotGatewayHelloTimeout)
	if err != nil {
		return &qqbotGatewayReconnectError{}
	}
	if helloPayload.Op != qqbotGatewayOpHello {
		return &qqbotGatewayReconnectError{}
	}

	var hello qqbotGatewayHelloData
	if err := json.Unmarshal(helloPayload.D, &hello); err != nil {
		return &qqbotGatewayReconnectError{}
	}
	if hello.HeartbeatInterval <= 0 {
		return &qqbotGatewayReconnectError{}
	}

	if strings.TrimSpace(state.sessionID) != "" && state.lastSeq > 0 {
		if err := p.sendResume(ctx, conn, cfg, state); err != nil {
			return &qqbotGatewayReconnectError{}
		}
	} else {
		if err := p.sendIdentify(ctx, conn, cfg); err != nil {
			return &qqbotGatewayReconnectError{}
		}
	}

	handshakeState, err := p.waitForGatewayReady(ctx, conn, state)
	if err != nil {
		return err
	}
	state = handshakeState
	if err := p.persistGatewaySessionState(ctx, updateSettings, state); err != nil {
		return err
	}
	if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
		EventType: "poll_success",
		Message:   "QQ Bot gateway connected successfully.",
	}); err != nil {
		return err
	}

	reads := make(chan qqbotGatewayReadResult, 1)
	go func() {
		for {
			var payload qqbotGatewayPayload
			if err := conn.ReadJSON(&payload); err != nil {
				reads <- qqbotGatewayReadResult{err: err}
				return
			}
			reads <- qqbotGatewayReadResult{payload: payload}
		}
	}()

	ticker := time.NewTicker(time.Duration(hello.HeartbeatInterval) * time.Millisecond)
	defer ticker.Stop()

	heartbeatAcked := true
	writeMu := &sync.Mutex{}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if !heartbeatAcked {
				return &qqbotGatewayReconnectError{}
			}
			heartbeatAcked = false
			if err := p.sendHeartbeat(conn, writeMu, state.lastSeq); err != nil {
				return &qqbotGatewayReconnectError{}
			}
		case result := <-reads:
			if result.err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				return &qqbotGatewayReconnectError{}
			}

			payload := result.payload
			if payload.S != nil {
				state.lastSeq = *payload.S
			}

			switch payload.Op {
			case qqbotGatewayOpDispatch:
				switch strings.TrimSpace(payload.T) {
				case "READY":
					var ready qqbotGatewayReadyData
					if err := json.Unmarshal(payload.D, &ready); err != nil {
						return &qqbotGatewayReconnectError{}
					}
					state.sessionID = strings.TrimSpace(ready.SessionID)
					if err := p.persistGatewaySessionState(ctx, updateSettings, state); err != nil {
						return err
					}
				case "RESUMED":
					if err := p.persistGatewaySessionState(ctx, updateSettings, state); err != nil {
						return err
					}
					if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
						EventType: "poll_success",
						Message:   "QQ Bot gateway session resumed successfully.",
					}); err != nil {
						return err
					}
				default:
					message, err := p.inboundMessageFromGatewayEvent(connection, payload.T, payload.D)
					switch {
					case errors.Is(err, ErrWebhookIgnored):
						if err := p.persistGatewaySessionState(ctx, updateSettings, state); err != nil {
							return err
						}
						if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
							EventType:      "poll_idle",
							Message:        "QQ Bot gateway event ignored.",
							ReceivedCount:  1,
							ProcessedCount: 0,
							IgnoredCount:   1,
						}); err != nil {
							return err
						}
						continue
					case err != nil:
						return err
					}
					if err := p.persistGatewaySessionState(ctx, updateSettings, state); err != nil {
						return err
					}
					if err := handleMessage(ctx, message); err != nil {
						return err
					}
					if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
						EventType:      "poll_success",
						Message:        "QQ Bot gateway event processed successfully.",
						ReceivedCount:  1,
						ProcessedCount: 1,
						IgnoredCount:   0,
					}); err != nil {
						return err
					}
				}
			case qqbotGatewayOpHeartbeat:
				if err := p.sendHeartbeat(conn, writeMu, state.lastSeq); err != nil {
					return &qqbotGatewayReconnectError{}
				}
			case qqbotGatewayOpHeartbeatACK:
				heartbeatAcked = true
			case qqbotGatewayOpReconnect:
				return &qqbotGatewayReconnectError{}
			case qqbotGatewayOpInvalidSession:
				var resumable bool
				_ = json.Unmarshal(payload.D, &resumable)
				return &qqbotGatewayReconnectError{clearSession: !resumable}
			}
		}
	}
}

func (p *qqbotProvider) waitForGatewayReady(
	_ context.Context,
	conn *websocket.Conn,
	state qqbotGatewaySessionState,
) (qqbotGatewaySessionState, error) {
	deadline := p.now().Add(qqbotGatewayReadyTimeout)
	if err := conn.SetReadDeadline(deadline); err != nil {
		return state, &qqbotGatewayReconnectError{}
	}
	defer conn.SetReadDeadline(time.Time{})

	for {
		var payload qqbotGatewayPayload
		if err := conn.ReadJSON(&payload); err != nil {
			return state, &qqbotGatewayReconnectError{}
		}
		if payload.S != nil {
			state.lastSeq = *payload.S
		}
		if payload.Op != qqbotGatewayOpDispatch {
			if payload.Op == qqbotGatewayOpInvalidSession {
				var resumable bool
				_ = json.Unmarshal(payload.D, &resumable)
				return state, &qqbotGatewayReconnectError{clearSession: !resumable}
			}
			continue
		}

		switch strings.TrimSpace(payload.T) {
		case "READY":
			var ready qqbotGatewayReadyData
			if err := json.Unmarshal(payload.D, &ready); err != nil {
				return state, &qqbotGatewayReconnectError{}
			}
			state.sessionID = strings.TrimSpace(ready.SessionID)
			return state, nil
		case "RESUMED":
			return state, nil
		}
	}
}

func (p *qqbotProvider) sendIdentify(
	ctx context.Context,
	conn *websocket.Conn,
	cfg qqbotConfig,
) error {
	token, err := p.getAccessToken(ctx, cfg, false)
	if err != nil {
		return err
	}
	return conn.WriteJSON(map[string]any{
		"op": qqbotGatewayOpIdentify,
		"d": map[string]any{
			"token":   "QQBot " + token,
			"intents": cfg.intents,
			"shard":   [2]int{0, 1},
		},
	})
}

func (p *qqbotProvider) sendResume(
	ctx context.Context,
	conn *websocket.Conn,
	cfg qqbotConfig,
	state qqbotGatewaySessionState,
) error {
	token, err := p.getAccessToken(ctx, cfg, false)
	if err != nil {
		return err
	}
	return conn.WriteJSON(map[string]any{
		"op": qqbotGatewayOpResume,
		"d": map[string]any{
			"token":      "QQBot " + token,
			"session_id": state.sessionID,
			"seq":        state.lastSeq,
		},
	})
}

func (p *qqbotProvider) sendHeartbeat(
	conn *websocket.Conn,
	writeMu *sync.Mutex,
	seq int64,
) error {
	payload := qqbotGatewayPayload{
		Op: qqbotGatewayOpHeartbeat,
		D:  json.RawMessage("null"),
	}
	if seq > 0 {
		data, err := json.Marshal(seq)
		if err != nil {
			return err
		}
		payload.D = data
	}

	writeMu.Lock()
	defer writeMu.Unlock()
	return conn.WriteJSON(payload)
}

func (p *qqbotProvider) readGatewayPayloadWithDeadline(
	conn *websocket.Conn,
	timeout time.Duration,
) (qqbotGatewayPayload, error) {
	if timeout > 0 {
		if err := conn.SetReadDeadline(p.now().Add(timeout)); err != nil {
			return qqbotGatewayPayload{}, err
		}
		defer conn.SetReadDeadline(time.Time{})
	}

	var payload qqbotGatewayPayload
	if err := conn.ReadJSON(&payload); err != nil {
		return qqbotGatewayPayload{}, err
	}
	return payload, nil
}

func (p *qqbotProvider) inboundMessageFromGatewayEvent(
	connection store.BotConnection,
	eventType string,
	data json.RawMessage,
) (InboundMessage, error) {
	cfg, err := parseQQBotConfig(connection)
	if err != nil {
		return InboundMessage{}, err
	}

	switch strings.TrimSpace(eventType) {
	case "GROUP_AT_MESSAGE_CREATE":
		var event qqbotGroupMessageEvent
		if err := json.Unmarshal(data, &event); err != nil {
			return InboundMessage{}, fmt.Errorf("%w: decode qqbot group event: %s", ErrInvalidInput, err.Error())
		}
		return qqbotInboundMessageFromGroupEvent(cfg, event)
	case "C2C_MESSAGE_CREATE":
		var event qqbotC2CMessageEvent
		if err := json.Unmarshal(data, &event); err != nil {
			return InboundMessage{}, fmt.Errorf("%w: decode qqbot c2c event: %s", ErrInvalidInput, err.Error())
		}
		return qqbotInboundMessageFromC2CEvent(cfg, event)
	default:
		return InboundMessage{}, ErrWebhookIgnored
	}
}

func qqbotInboundMessageFromGroupEvent(cfg qqbotConfig, event qqbotGroupMessageEvent) (InboundMessage, error) {
	messageID := qqbotFirstNonEmpty(strings.TrimSpace(event.ID), strings.TrimSpace(event.MsgID))
	groupOpenID := strings.TrimSpace(event.GroupOpenID)
	memberOpenID := strings.TrimSpace(event.Author.MemberOpenID)
	if messageID == "" || groupOpenID == "" || memberOpenID == "" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	text := qqbotNormalizeInboundText(qqbotStripLeadingMention(event.Content), event.MessageReference)
	if strings.TrimSpace(text) == "" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	return InboundMessage{
		ConversationID: qqbotConversationID(qqbotMessageTypeGroup, groupOpenID, memberOpenID, cfg.shareSessionInChannel),
		ExternalChatID: groupOpenID,
		MessageID:      messageID,
		UserID:         memberOpenID,
		Username:       memberOpenID,
		Title:          groupOpenID,
		Text:           text,
		ProviderData: map[string]string{
			qqbotMessageTypeKey:                  qqbotMessageTypeGroup,
			qqbotGroupOpenIDKey:                  groupOpenID,
			qqbotUserOpenIDKey:                   memberOpenID,
			qqbotEventMessageIDKey:               messageID,
			qqbotMarkdownSupportProviderStateKey: strconv.FormatBool(cfg.markdownSupport),
		},
	}, nil
}

func qqbotInboundMessageFromC2CEvent(_ qqbotConfig, event qqbotC2CMessageEvent) (InboundMessage, error) {
	messageID := qqbotFirstNonEmpty(strings.TrimSpace(event.ID), strings.TrimSpace(event.MsgID))
	userOpenID := strings.TrimSpace(event.Author.UserOpenID)
	if messageID == "" || userOpenID == "" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	text := qqbotNormalizeInboundText(event.Content, event.MessageReference)
	if strings.TrimSpace(text) == "" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	return InboundMessage{
		ConversationID: qqbotConversationID(qqbotMessageTypeC2C, "", userOpenID, false),
		ExternalChatID: userOpenID,
		MessageID:      messageID,
		UserID:         userOpenID,
		Username:       userOpenID,
		Title:          userOpenID,
		Text:           text,
		ProviderData: map[string]string{
			qqbotMessageTypeKey:    qqbotMessageTypeC2C,
			qqbotUserOpenIDKey:     userOpenID,
			qqbotEventMessageIDKey: messageID,
		},
	}, nil
}

type qqbotOutboundTarget struct {
	messageType     string
	groupOpenID     string
	userOpenID      string
	eventMsgID      string
	markdownSupport bool
}

func resolveQQBotOutboundTarget(
	connection store.BotConnection,
	conversation store.BotConversation,
) (qqbotOutboundTarget, error) {
	providerState := conversation.ProviderState
	messageType := strings.TrimSpace(providerState[qqbotMessageTypeKey])
	groupOpenID := strings.TrimSpace(providerState[qqbotGroupOpenIDKey])
	userOpenID := strings.TrimSpace(providerState[qqbotUserOpenIDKey])
	if messageType == "" {
		switch {
		case groupOpenID != "":
			messageType = qqbotMessageTypeGroup
		case userOpenID != "":
			messageType = qqbotMessageTypeC2C
		case strings.TrimSpace(conversation.ExternalUserID) != "" &&
			strings.TrimSpace(conversation.ExternalChatID) != "" &&
			strings.TrimSpace(conversation.ExternalUserID) != strings.TrimSpace(conversation.ExternalChatID):
			messageType = qqbotMessageTypeGroup
		default:
			messageType = qqbotMessageTypeC2C
		}
	}

	if messageType == qqbotMessageTypeGroup {
		groupOpenID = qqbotFirstNonEmpty(groupOpenID, strings.TrimSpace(conversation.ExternalChatID))
		userOpenID = qqbotFirstNonEmpty(userOpenID, strings.TrimSpace(conversation.ExternalUserID))
		if groupOpenID == "" {
			return qqbotOutboundTarget{}, fmt.Errorf("%w: qqbot group openid is required", ErrInvalidInput)
		}
	} else {
		userOpenID = qqbotFirstNonEmpty(userOpenID, strings.TrimSpace(conversation.ExternalChatID), strings.TrimSpace(conversation.ExternalUserID))
		if userOpenID == "" {
			return qqbotOutboundTarget{}, fmt.Errorf("%w: qqbot user openid is required", ErrInvalidInput)
		}
		messageType = qqbotMessageTypeC2C
	}

	markdownSupport := false
	if value := strings.TrimSpace(providerState[qqbotMarkdownSupportProviderStateKey]); value != "" {
		parsed, err := parseQQBotBool(value)
		if err != nil {
			return qqbotOutboundTarget{}, err
		}
		markdownSupport = parsed
	} else if value := strings.TrimSpace(connection.Settings[qqbotMarkdownSupportSetting]); value != "" {
		parsed, err := parseQQBotBool(value)
		if err != nil {
			return qqbotOutboundTarget{}, err
		}
		markdownSupport = parsed
	}

	return qqbotOutboundTarget{
		messageType:     messageType,
		groupOpenID:     groupOpenID,
		userOpenID:      userOpenID,
		eventMsgID:      strings.TrimSpace(providerState[qqbotEventMessageIDKey]),
		markdownSupport: markdownSupport,
	}, nil
}

func (p *qqbotProvider) sendTextMessage(
	ctx context.Context,
	cfg qqbotConfig,
	target qqbotOutboundTarget,
	text string,
	usePassive bool,
) error {
	endpoint, err := p.messageEndpoint(cfg, target)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"content":  text,
		"msg_type": 0,
	}
	if target.markdownSupport {
		payload = map[string]any{
			"markdown": map[string]any{
				"content": text,
			},
			"msg_type": 2,
		}
	}
	if usePassive && strings.TrimSpace(target.eventMsgID) != "" {
		payload["msg_id"] = target.eventMsgID
		payload["msg_seq"] = p.nextMsgSeq(target.eventMsgID)
	}

	var response map[string]any
	if err := p.apiRequestJSON(ctx, cfg, http.MethodPost, endpoint, payload, &response, false); err != nil {
		return err
	}
	return nil
}

func (p *qqbotProvider) sendMediaMessage(
	ctx context.Context,
	cfg qqbotConfig,
	target qqbotOutboundTarget,
	media store.BotMessageMedia,
	usePassive bool,
) error {
	fileInfo, err := p.uploadRichMedia(ctx, cfg, target, media)
	if err != nil {
		return err
	}

	endpoint, err := p.messageEndpoint(cfg, target)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"msg_type": 7,
		"media": map[string]any{
			"file_info": fileInfo,
		},
	}
	if usePassive && strings.TrimSpace(target.eventMsgID) != "" {
		payload["msg_id"] = target.eventMsgID
		payload["msg_seq"] = p.nextMsgSeq(target.eventMsgID)
	}

	var response map[string]any
	if err := p.apiRequestJSON(ctx, cfg, http.MethodPost, endpoint, payload, &response, false); err != nil {
		return err
	}
	return nil
}

func (p *qqbotProvider) uploadRichMedia(
	ctx context.Context,
	cfg qqbotConfig,
	target qqbotOutboundTarget,
	media store.BotMessageMedia,
) (string, error) {
	data, _, contentType, err := p.resolveOutboundMedia(ctx, media)
	if err != nil {
		return "", err
	}
	fileType := qqbotMediaFileType(media, contentType)
	endpoint, err := p.mediaUploadEndpoint(cfg, target)
	if err != nil {
		return "", err
	}

	payload := map[string]any{
		"file_type":    fileType,
		"file_data":    base64.StdEncoding.EncodeToString(data),
		"srv_send_msg": false,
	}
	var response struct {
		FileInfo string `json:"file_info"`
	}
	if err := p.apiRequestJSON(ctx, cfg, http.MethodPost, endpoint, payload, &response, false); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.FileInfo) == "" {
		return "", fmt.Errorf("%w: qqbot upload rich media returned empty file_info", ErrInvalidInput)
	}
	return strings.TrimSpace(response.FileInfo), nil
}

func (p *qqbotProvider) resolveOutboundMedia(
	ctx context.Context,
	media store.BotMessageMedia,
) ([]byte, string, string, error) {
	if mediaURL := strings.TrimSpace(media.URL); mediaURL != "" {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
		if err != nil {
			return nil, "", "", fmt.Errorf("%w: invalid qqbot media url %q", ErrInvalidInput, mediaURL)
		}
		response, err := p.client(15 * time.Second).Do(request)
		if err != nil {
			return nil, "", "", fmt.Errorf("download qqbot media url %q: %w", mediaURL, err)
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, "", "", fmt.Errorf("%w: qqbot media url %q returned %s", ErrInvalidInput, mediaURL, response.Status)
		}
		data, err := io.ReadAll(response.Body)
		if err != nil {
			return nil, "", "", fmt.Errorf("read qqbot media url %q: %w", mediaURL, err)
		}
		contentType := strings.TrimSpace(media.ContentType)
		if contentType == "" {
			contentType = strings.TrimSpace(response.Header.Get("Content-Type"))
		}
		if contentType == "" && len(data) > 0 {
			contentType = http.DetectContentType(data)
		}
		fileName := strings.TrimSpace(media.FileName)
		if fileName == "" {
			if parsed, err := url.Parse(mediaURL); err == nil {
				fileName = filepath.Base(parsed.Path)
			}
		}
		if fileName == "" || fileName == "." || fileName == "/" {
			fileName = "attachment"
		}
		return data, fileName, contentType, nil
	}

	mediaPath := strings.TrimSpace(media.Path)
	if mediaPath == "" {
		return nil, "", "", fmt.Errorf("%w: qqbot media message requires a local path or remote url", ErrInvalidInput)
	}
	if strings.HasPrefix(strings.ToLower(mediaPath), "file://") {
		parsed, err := url.Parse(mediaPath)
		if err != nil {
			return nil, "", "", fmt.Errorf("%w: invalid qqbot media file url %q", ErrInvalidInput, mediaPath)
		}
		mediaPath = filepath.FromSlash(parsed.Path)
	}
	if !filepath.IsAbs(mediaPath) {
		return nil, "", "", fmt.Errorf("%w: qqbot media file path must be absolute: %s", ErrInvalidInput, mediaPath)
	}
	info, err := os.Stat(mediaPath)
	if err != nil {
		return nil, "", "", fmt.Errorf("stat qqbot media file %q: %w", mediaPath, err)
	}
	if info.IsDir() {
		return nil, "", "", fmt.Errorf("%w: qqbot media file path must be a file: %s", ErrInvalidInput, mediaPath)
	}
	data, err := os.ReadFile(mediaPath)
	if err != nil {
		return nil, "", "", fmt.Errorf("read qqbot media file %q: %w", mediaPath, err)
	}
	contentType := strings.TrimSpace(media.ContentType)
	if contentType == "" && len(data) > 0 {
		contentType = http.DetectContentType(data)
	}
	fileName := firstNonEmpty(strings.TrimSpace(media.FileName), filepath.Base(mediaPath))
	return data, fileName, contentType, nil
}

func qqbotMediaFileType(media store.BotMessageMedia, contentType string) int {
	switch strings.ToLower(strings.TrimSpace(media.Kind)) {
	case botMediaKindImage:
		return 1
	case botMediaKindVideo:
		return 2
	case botMediaKindAudio, botMediaKindVoice:
		return 3
	case "", botMediaKindFile:
		lowerContentType := strings.ToLower(strings.TrimSpace(contentType))
		switch {
		case strings.HasPrefix(lowerContentType, "image/"):
			return 1
		case strings.HasPrefix(lowerContentType, "video/"):
			return 2
		case strings.HasPrefix(lowerContentType, "audio/"):
			return 3
		default:
			return 4
		}
	default:
		return 4
	}
}

func (p *qqbotProvider) mediaUploadEndpoint(cfg qqbotConfig, target qqbotOutboundTarget) (string, error) {
	base, err := url.Parse(strings.TrimRight(p.apiBaseURLForConfig(cfg), "/"))
	if err != nil {
		return "", fmt.Errorf("invalid qqbot api base url: %w", err)
	}

	switch target.messageType {
	case qqbotMessageTypeGroup:
		base.Path = strings.TrimRight(base.Path, "/") + "/v2/groups/" + url.PathEscape(target.groupOpenID) + "/files"
	case qqbotMessageTypeC2C:
		base.Path = strings.TrimRight(base.Path, "/") + "/v2/users/" + url.PathEscape(target.userOpenID) + "/files"
	default:
		return "", fmt.Errorf("%w: unsupported qqbot message type %q", ErrInvalidInput, target.messageType)
	}
	return base.String(), nil
}

func (p *qqbotProvider) messageEndpoint(cfg qqbotConfig, target qqbotOutboundTarget) (string, error) {
	base, err := url.Parse(strings.TrimRight(p.apiBaseURLForConfig(cfg), "/"))
	if err != nil {
		return "", fmt.Errorf("invalid qqbot api base url: %w", err)
	}

	switch target.messageType {
	case qqbotMessageTypeGroup:
		base.Path = strings.TrimRight(base.Path, "/") + "/v2/groups/" + url.PathEscape(target.groupOpenID) + "/messages"
	case qqbotMessageTypeC2C:
		base.Path = strings.TrimRight(base.Path, "/") + "/v2/users/" + url.PathEscape(target.userOpenID) + "/messages"
	default:
		return "", fmt.Errorf("%w: unsupported qqbot message type %q", ErrInvalidInput, target.messageType)
	}
	return base.String(), nil
}

func (p *qqbotProvider) getGatewayURL(ctx context.Context, cfg qqbotConfig) (string, error) {
	base, err := url.Parse(strings.TrimRight(p.apiBaseURLForConfig(cfg), "/"))
	if err != nil {
		return "", fmt.Errorf("invalid qqbot api base url: %w", err)
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/gateway/bot"

	var response qqbotGatewayResponse
	if err := p.apiRequestJSON(ctx, cfg, http.MethodGet, base.String(), nil, &response, false); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.URL) == "" {
		return "", fmt.Errorf("%w: qqbot gateway url is missing", ErrInvalidInput)
	}
	return strings.TrimSpace(response.URL), nil
}

func (p *qqbotProvider) apiRequestJSON(
	ctx context.Context,
	cfg qqbotConfig,
	method string,
	endpoint string,
	payload any,
	target any,
	forceRefresh bool,
) error {
	token, err := p.getAccessToken(ctx, cfg, forceRefresh)
	if err != nil {
		return err
	}

	err = p.doQQBotJSONRequest(ctx, method, endpoint, token, payload, target)
	var requestErr *qqbotRequestError
	if errors.As(err, &requestErr) && requestErr.statusCode == http.StatusUnauthorized && !forceRefresh {
		return p.apiRequestJSON(ctx, cfg, method, endpoint, payload, target, true)
	}
	return err
}

func (p *qqbotProvider) doQQBotJSONRequest(
	ctx context.Context,
	method string,
	endpoint string,
	token string,
	payload any,
	target any,
) error {
	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode qqbot %s payload: %w", method, err)
		}
		body = bytes.NewReader(data)
	}

	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return fmt.Errorf("build qqbot %s request: %w", method, err)
	}
	request.Header.Set("Authorization", "QQBot "+strings.TrimSpace(token))
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := p.client(15 * time.Second).Do(request)
	if err != nil {
		return &qqbotRequestError{
			method:   method,
			endpoint: endpoint,
			cause:    err,
		}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return &qqbotRequestError{
			method:     method,
			endpoint:   endpoint,
			statusCode: response.StatusCode,
			status:     response.Status,
			body:       strings.TrimSpace(string(content)),
		}
	}

	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode qqbot %s response: %w", method, err)
	}
	return nil
}

func (p *qqbotProvider) getAccessToken(
	ctx context.Context,
	cfg qqbotConfig,
	forceRefresh bool,
) (string, error) {
	cacheKey := qqbotTokenCacheKey(cfg)

	p.tokenMu.Lock()
	defer p.tokenMu.Unlock()

	if !forceRefresh {
		if entry, ok := p.tokenCache[cacheKey]; ok && strings.TrimSpace(entry.accessToken) != "" &&
			p.now().Before(entry.expiresAt.Add(-qqbotTokenRefreshMargin)) {
			return entry.accessToken, nil
		}
	}

	payload := map[string]string{
		"appId":        cfg.appID,
		"clientSecret": cfg.appSecret,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode qqbot token request: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("build qqbot token request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := p.client(15 * time.Second).Do(request)
	if err != nil {
		return "", &qqbotRequestError{
			method: http.MethodPost,
			cause:  err,
		}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return "", &qqbotRequestError{
			method:     http.MethodPost,
			statusCode: response.StatusCode,
			status:     response.Status,
			body:       strings.TrimSpace(string(content)),
		}
	}

	var tokenResponse qqbotTokenResponse
	if err := json.NewDecoder(response.Body).Decode(&tokenResponse); err != nil {
		return "", fmt.Errorf("decode qqbot token response: %w", err)
	}
	accessToken := strings.TrimSpace(tokenResponse.AccessToken)
	if accessToken == "" {
		return "", fmt.Errorf("%w: qqbot access token is missing", ErrInvalidInput)
	}

	expiresIn, err := parseQQBotExpiresIn(tokenResponse.ExpiresIn)
	if err != nil {
		return "", err
	}
	if expiresIn <= 0 {
		expiresIn = 7200
	}

	if p.tokenCache == nil {
		p.tokenCache = make(map[string]qqbotTokenCacheEntry)
	}
	p.tokenCache[cacheKey] = qqbotTokenCacheEntry{
		accessToken: accessToken,
		expiresAt:   p.now().Add(time.Duration(expiresIn) * time.Second),
	}
	return accessToken, nil
}

func qqbotTokenCacheKey(cfg qqbotConfig) string {
	return strings.Join([]string{
		cfg.appID,
		cfg.appSecret,
	}, "\n")
}

func (p *qqbotProvider) client(timeout time.Duration) *http.Client {
	if p.clients == nil {
		return staticHTTPClientSource{}.Client(timeout)
	}
	return p.clients.Client(timeout)
}

func (p *qqbotProvider) dialer() *websocket.Dialer {
	if p != nil && p.wsDialer != nil {
		return p.wsDialer
	}
	return websocket.DefaultDialer
}

func (p *qqbotProvider) sleepFunc() func(context.Context, time.Duration) error {
	if p != nil && p.sleep != nil {
		return p.sleep
	}
	return qqbotSleepWithContext
}

func (p *qqbotProvider) apiBaseURLForConfig(cfg qqbotConfig) string {
	if cfg.sandbox {
		return "https://sandbox.api.sgroup.qq.com"
	}
	return p.apiBaseURL
}

func (p *qqbotProvider) nextMsgSeq(messageID string) int {
	trimmed := strings.TrimSpace(messageID)
	if trimmed == "" {
		return 0
	}

	p.msgSeqMu.Lock()
	defer p.msgSeqMu.Unlock()

	if p.msgSeq == nil {
		p.msgSeq = make(map[string]int)
	}
	p.msgSeq[trimmed]++
	return p.msgSeq[trimmed]
}

func (p *qqbotProvider) restoreGatewaySessionState(connection store.BotConnection) (qqbotGatewaySessionState, error) {
	state := qqbotGatewaySessionState{
		sessionID: strings.TrimSpace(connection.Settings[qqbotGatewaySessionIDSetting]),
	}
	seqValue := strings.TrimSpace(connection.Settings[qqbotGatewaySeqSetting])
	if seqValue == "" {
		return state, nil
	}
	parsed, err := strconv.ParseInt(seqValue, 10, 64)
	if err != nil || parsed < 0 {
		return qqbotGatewaySessionState{}, fmt.Errorf("%w: qqbot gateway seq must be a non-negative integer", ErrInvalidInput)
	}
	state.lastSeq = parsed
	return state, nil
}

func (p *qqbotProvider) persistGatewaySessionState(
	ctx context.Context,
	updateSettings PollingSettingsHandler,
	state qqbotGatewaySessionState,
) error {
	if updateSettings == nil {
		return nil
	}
	settings := map[string]string{
		qqbotGatewaySessionIDSetting: strings.TrimSpace(state.sessionID),
		qqbotGatewaySeqSetting:       strconv.FormatInt(state.lastSeq, 10),
	}
	return updateSettings(ctx, settings)
}

func parseQQBotConfig(connection store.BotConnection) (qqbotConfig, error) {
	appID := strings.TrimSpace(connection.Settings[qqbotAppIDSetting])
	if appID == "" {
		return qqbotConfig{}, fmt.Errorf("%w: qqbot app id is required", ErrInvalidInput)
	}
	appSecret := strings.TrimSpace(connection.Secrets[qqbotAppSecretKey])
	if appSecret == "" {
		return qqbotConfig{}, fmt.Errorf("%w: qqbot app secret is required", ErrInvalidInput)
	}

	sandbox, err := parseQQBotOptionalBool(connection.Settings[qqbotSandboxSetting], false)
	if err != nil {
		return qqbotConfig{}, fmt.Errorf("%w: invalid qqbot sandbox setting", ErrInvalidInput)
	}
	shareSessionInChannel, err := parseQQBotOptionalBool(connection.Settings[qqbotShareSessionInChannelSetting], false)
	if err != nil {
		return qqbotConfig{}, fmt.Errorf("%w: invalid qqbot shared session setting", ErrInvalidInput)
	}
	markdownSupport, err := parseQQBotOptionalBool(connection.Settings[qqbotMarkdownSupportSetting], false)
	if err != nil {
		return qqbotConfig{}, fmt.Errorf("%w: invalid qqbot markdown support setting", ErrInvalidInput)
	}
	intents, err := parseQQBotIntents(connection.Settings[qqbotIntentsSetting])
	if err != nil {
		return qqbotConfig{}, err
	}

	return qqbotConfig{
		appID:                 appID,
		appSecret:             appSecret,
		sandbox:               sandbox,
		shareSessionInChannel: shareSessionInChannel,
		markdownSupport:       markdownSupport,
		intents:               intents,
	}, nil
}

func parseQQBotOptionalBool(value string, defaultValue bool) (bool, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return defaultValue, nil
	}
	return parseQQBotBool(trimmed)
}

func parseQQBotBool(value string) (bool, error) {
	parsed, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return false, err
	}
	return parsed, nil
}

func parseQQBotIntents(value string) (int, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return qqbotDefaultGatewayIntent, nil
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%w: qqbot intents must be a positive integer", ErrInvalidInput)
	}
	return parsed, nil
}

func parseQQBotExpiresIn(raw json.RawMessage) (int, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return 0, nil
	}
	if strings.HasPrefix(trimmed, `"`) {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return 0, fmt.Errorf("%w: invalid qqbot expires_in value", ErrInvalidInput)
		}
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return 0, fmt.Errorf("%w: invalid qqbot expires_in value", ErrInvalidInput)
		}
		return parsed, nil
	}

	var numeric int
	if err := json.Unmarshal(raw, &numeric); err == nil {
		return numeric, nil
	}
	var floatValue float64
	if err := json.Unmarshal(raw, &floatValue); err == nil {
		return int(floatValue), nil
	}
	return 0, fmt.Errorf("%w: invalid qqbot expires_in value", ErrInvalidInput)
}

func qqbotConversationID(messageType string, groupOpenID string, userOpenID string, shareSessionInChannel bool) string {
	switch strings.TrimSpace(messageType) {
	case qqbotMessageTypeGroup:
		groupOpenID = strings.TrimSpace(groupOpenID)
		userOpenID = strings.TrimSpace(userOpenID)
		if shareSessionInChannel || userOpenID == "" {
			return "group:" + groupOpenID
		}
		return "group:" + groupOpenID + ":user:" + userOpenID
	default:
		return "user:" + strings.TrimSpace(userOpenID)
	}
}

func qqbotNormalizeInboundText(content string, ref *qqbotMessageReference) string {
	content = strings.TrimSpace(content)
	quoted := strings.TrimSpace(extractQQBotQuotedText(ref))
	if quoted == "" {
		return content
	}
	if content == "" {
		return "Quoted: " + quoted
	}
	return "Quoted: " + quoted + "\n" + content
}

func extractQQBotQuotedText(ref *qqbotMessageReference) string {
	if ref == nil {
		return ""
	}
	for _, value := range []string{
		strings.TrimSpace(ref.Content),
		qqbotQuotedMessageText(ref.Message),
		qqbotQuotedMessageText(ref.ReferencedMessage),
		qqbotQuotedMessageText(ref.SourceMessage),
		strings.TrimSpace(ref.Title),
	} {
		if value != "" {
			return value
		}
	}
	return ""
}

func qqbotQuotedMessageText(message *qqbotQuotedMessage) string {
	if message == nil {
		return ""
	}
	if content := strings.TrimSpace(message.Content); content != "" {
		return content
	}
	return strings.TrimSpace(message.Title)
}

func qqbotStripLeadingMention(content string) string {
	trimmed := strings.TrimSpace(content)
	for strings.HasPrefix(trimmed, "<@") {
		index := strings.Index(trimmed, ">")
		if index < 0 {
			break
		}
		trimmed = strings.TrimSpace(trimmed[index+1:])
	}
	return trimmed
}

func splitQQBotText(value string, maxRunes int) []string {
	if value == "" {
		return nil
	}
	if maxRunes <= 0 {
		return []string{value}
	}
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return []string{value}
	}

	chunks := make([]string, 0, (len(runes)+maxRunes-1)/maxRunes)
	for len(runes) > 0 {
		size := min(maxRunes, len(runes))
		chunks = append(chunks, string(runes[:size]))
		runes = runes[size:]
	}
	return chunks
}

func shouldQQBotFallbackToProactive(err error) bool {
	var requestErr *qqbotRequestError
	if !errors.As(err, &requestErr) {
		return false
	}
	if requestErr.statusCode == http.StatusUnauthorized || requestErr.statusCode == http.StatusTooManyRequests {
		return false
	}
	return requestErr.statusCode >= http.StatusBadRequest && requestErr.statusCode < http.StatusInternalServerError
}

func qqbotMessagesContainMedia(messages []OutboundMessage) bool {
	for _, message := range messages {
		if len(message.Media) > 0 {
			return true
		}
	}
	return false
}

func qqbotCloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func qqbotFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func qqbotSleepWithContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func isQQBotTransientPollingError(err error) bool {
	var requestErr *qqbotRequestError
	if errors.As(err, &requestErr) {
		return requestErr.cause != nil || requestErr.statusCode >= http.StatusInternalServerError || requestErr.statusCode == http.StatusTooManyRequests
	}
	return false
}
