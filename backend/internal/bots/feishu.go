package bots

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/store"

	"github.com/gorilla/websocket"
)

const (
	feishuProviderName                       = "feishu"
	feishuAppIDSetting                       = "feishu_app_id"
	feishuAppSecretKey                       = "feishu_app_secret"
	feishuDomainSetting                      = "feishu_domain"
	feishuDeliveryModeSetting                = "feishu_delivery_mode"
	feishuDeliveryModeWebSocket              = "websocket"
	feishuDeliveryModeWebhook                = "webhook"
	feishuGroupReplyAllSetting               = "feishu_group_reply_all"
	feishuThreadIsolationSetting             = "feishu_thread_isolation"
	feishuShareSessionInChannelSetting       = "feishu_share_session_in_channel"
	feishuResolveMentionsSetting             = "feishu_resolve_mentions"
	feishuEnableCardsSetting                 = "feishu_enable_cards"
	feishuBotOpenIDSetting                   = "bot_open_id"
	feishuBotDisplayNameSetting              = "bot_display_name"
	feishuChatIDKey                          = "feishu_chat_id"
	feishuMessageIDKey                       = "feishu_message_id"
	feishuThreadIDKey                        = "feishu_thread_id"
	feishuRootIDKey                          = "feishu_root_id"
	feishuParentIDKey                        = "feishu_parent_id"
	feishuChatTypeKey                        = "feishu_chat_type"
	feishuUserOpenIDKey                      = "feishu_user_open_id"
	feishuConversationIDKey                  = "feishu_conversation_id"
	feishuChatNameKey                        = "feishu_chat_name"
	feishuDefaultDomain                      = "https://open.feishu.cn"
	feishuDefaultHTTPTimeout                 = 15 * time.Second
	feishuWSReadTimeout                      = 90 * time.Second
	feishuPollingReconnectInitialDelay       = time.Second
	feishuPollingReconnectMaxDelay           = 15 * time.Second
	feishuReplyRetryAttempts                 = 2
	feishuReplyRetryBaseDelay                = 500 * time.Millisecond
	feishuReplyRetryMaxDelay                 = 3 * time.Second
	feishuWSFrameMethodControl         int32 = 0
	feishuWSFrameMethodData            int32 = 1
	feishuWSHeaderType                       = "type"
	feishuWSHeaderPing                       = "ping"
	feishuWSHeaderPong                       = "pong"
	feishuWSHeaderEvent                      = "event"
	feishuWSHeaderBizRT                      = "biz_rt"
	feishuAppAccessTokenEndpoint             = "/open-apis/auth/v3/tenant_access_token/internal"
	feishuBotInfoEndpoint                    = "/open-apis/bot/v3/info"
	feishuWebsocketConnectEndpoint           = "/callback/ws/endpoint"
)

type feishuProvider struct {
	clients httpClientSource
	domain  string
	sleep   func(context.Context, time.Duration) error
	now     func() time.Time
}

type feishuRequestError struct {
	operation  string
	statusCode int
	status     string
	apiCode    int
	apiMsg     string
	cause      error
}

type feishuTenantAccessTokenResponse struct {
	Code              int    `json:"code"`
	Msg               string `json:"msg"`
	TenantAccessToken string `json:"tenant_access_token"`
	AppAccessToken    string `json:"app_access_token"`
}

type feishuBotInfoResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Bot  struct {
		OpenID      string `json:"open_id"`
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
		AppName     string `json:"app_name"`
	} `json:"bot"`
	Data struct {
		OpenID      string `json:"open_id"`
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
		AppName     string `json:"app_name"`
	} `json:"data"`
}

type feishuWSEndpointResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		URL          string `json:"URL"`
		URLLower     string `json:"url"`
		ClientConfig struct {
			ReconnectCount    int `json:"ReconnectCount"`
			ReconnectInterval int `json:"ReconnectInterval"`
			ReconnectNonce    int `json:"ReconnectNonce"`
			PingInterval      int `json:"PingInterval"`
		} `json:"ClientConfig"`
	} `json:"data"`
}

type feishuSendMessageResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		MessageID string `json:"message_id"`
	} `json:"data"`
}

type feishuEventEnvelope struct {
	Schema string `json:"schema"`
	Header struct {
		EventType string `json:"event_type"`
	} `json:"header"`
	Event feishuMessageEvent `json:"event"`
}

type feishuWebhookEnvelope struct {
	Type      string `json:"type"`
	Token     string `json:"token"`
	Challenge string `json:"challenge"`
	Schema    string `json:"schema"`
	Header    struct {
		EventType string `json:"event_type"`
	} `json:"header"`
	Event feishuMessageEvent `json:"event"`
}

type feishuMessageEvent struct {
	Sender  feishuSender   `json:"sender"`
	Message feishuMessage  `json:"message"`
	Chat    feishuChatInfo `json:"chat"`
}

type feishuSender struct {
	SenderID   feishuOpenIDRef `json:"sender_id"`
	SenderType string          `json:"sender_type"`
	Name       string          `json:"name"`
	SenderName string          `json:"sender_name"`
}

type feishuOpenIDRef struct {
	OpenID string `json:"open_id"`
}

type feishuChatInfo struct {
	Name string `json:"name"`
}

type feishuMessage struct {
	MessageID   string          `json:"message_id"`
	RootID      string          `json:"root_id"`
	ParentID    string          `json:"parent_id"`
	ThreadID    string          `json:"thread_id"`
	ChatID      string          `json:"chat_id"`
	ChatType    string          `json:"chat_type"`
	MessageType string          `json:"message_type"`
	Content     string          `json:"content"`
	Mentions    []feishuMention `json:"mentions"`
}

type feishuMention struct {
	Key  string          `json:"key"`
	Name string          `json:"name"`
	ID   feishuOpenIDRef `json:"id"`
}

type feishuPostContent struct {
	Title   string                `json:"title"`
	Content [][]feishuPostElement `json:"content"`
}

type feishuPostElement struct {
	Tag      string `json:"tag"`
	Text     string `json:"text"`
	Language string `json:"language"`
	Href     string `json:"href"`
}

type feishuWSHeader struct {
	Key   string
	Value string
}

type feishuWSFrame struct {
	SeqID           uint64
	LogID           uint64
	Service         int32
	Method          int32
	Headers         []feishuWSHeader
	PayloadEncoding string
	PayloadType     string
	Payload         []byte
	LogIDNew        string
}

func (e *feishuRequestError) Error() string {
	if e == nil {
		return ""
	}
	if e.cause != nil {
		return fmt.Sprintf("feishu %s request failed: %v", e.operation, e.cause)
	}
	if e.status != "" && e.apiMsg != "" {
		return fmt.Sprintf("feishu %s returned %s: %s", e.operation, e.status, e.apiMsg)
	}
	if e.status != "" {
		return fmt.Sprintf("feishu %s returned %s", e.operation, e.status)
	}
	if e.apiCode != 0 || e.apiMsg != "" {
		if e.apiMsg != "" {
			return fmt.Sprintf("feishu %s api error (%d): %s", e.operation, e.apiCode, e.apiMsg)
		}
		return fmt.Sprintf("feishu %s api error (%d)", e.operation, e.apiCode)
	}
	return fmt.Sprintf("feishu %s request failed", e.operation)
}

func (e *feishuRequestError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func newFeishuProvider(client *http.Client) Provider {
	return newFeishuProviderWithClientSource(staticHTTPClientSource{client: client})
}

func newFeishuProviderWithClientSource(clients httpClientSource) Provider {
	if clients == nil {
		clients = staticHTTPClientSource{}
	}
	return &feishuProvider{
		clients: clients,
		domain:  feishuDefaultDomain,
		sleep:   sleepWithContext,
		now:     time.Now,
	}
}

func (p *feishuProvider) Name() string {
	return feishuProviderName
}

func (p *feishuProvider) Activate(
	ctx context.Context,
	connection store.BotConnection,
	publicBaseURL string,
) (ActivationResult, error) {
	appID := strings.TrimSpace(connection.Settings[feishuAppIDSetting])
	if appID == "" {
		return ActivationResult{}, fmt.Errorf("%w: feishu app id is required", ErrInvalidInput)
	}
	appSecret := strings.TrimSpace(connection.Secrets[feishuAppSecretKey])
	if appSecret == "" {
		return ActivationResult{}, fmt.Errorf("%w: feishu app secret is required", ErrInvalidInput)
	}
	domain, err := p.providerDomain(connection)
	if err != nil {
		return ActivationResult{}, err
	}
	mode, err := parseFeishuDeliveryMode(connection.Settings[feishuDeliveryModeSetting])
	if err != nil {
		return ActivationResult{}, err
	}

	token, err := p.tenantAccessToken(ctx, domain, appID, appSecret)
	if err != nil {
		return ActivationResult{}, err
	}
	info, err := p.botInfo(ctx, domain, token)
	if err != nil {
		return ActivationResult{}, err
	}

	settings := cloneStringMapLocal(connection.Settings)
	if settings == nil {
		settings = make(map[string]string)
	}
	settings[feishuAppIDSetting] = appID
	settings[feishuDomainSetting] = domain
	settings[feishuDeliveryModeSetting] = mode
	settings[feishuBotOpenIDSetting] = info.openID()
	settings[feishuBotDisplayNameSetting] = info.displayName()
	settings[feishuEnableCardsSetting] = strconv.FormatBool(parseBoolSetting(connection.Settings[feishuEnableCardsSetting], false))
	switch mode {
	case feishuDeliveryModeWebhook:
		webhookURL, err := buildWebhookURL(publicBaseURL, connection.ID)
		if err != nil {
			return ActivationResult{}, err
		}
		settings["webhook_url"] = webhookURL
	default:
		delete(settings, "webhook_url")
	}

	return ActivationResult{
		Settings: settings,
		Secrets:  cloneStringMapLocal(connection.Secrets),
	}, nil
}

func (p *feishuProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *feishuProvider) ParseWebhook(r *http.Request, connection store.BotConnection) ([]InboundMessage, error) {
	_, messages, err := p.ParseWebhookResult(r, connection)
	return messages, err
}

func (p *feishuProvider) ParseWebhookResult(
	r *http.Request,
	connection store.BotConnection,
) (WebhookResult, []InboundMessage, error) {
	mode, err := parseFeishuDeliveryMode(connection.Settings[feishuDeliveryModeSetting])
	if err != nil {
		return WebhookResult{}, nil, err
	}
	if mode != feishuDeliveryModeWebhook {
		return WebhookResult{}, nil, ErrWebhookIgnored
	}
	if r == nil {
		return WebhookResult{}, nil, fmt.Errorf("%w: feishu webhook request is required", ErrInvalidInput)
	}
	defer r.Body.Close()

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return WebhookResult{}, nil, fmt.Errorf("%w: read feishu webhook body: %s", ErrInvalidInput, err.Error())
	}

	if challenge, ok, err := parseFeishuWebhookChallenge(body); err != nil {
		return WebhookResult{}, nil, err
	} else if ok {
		return WebhookResult{
			StatusCode: http.StatusOK,
			Body: map[string]string{
				"challenge": challenge,
			},
		}, nil, nil
	}

	message, err := p.parseFeishuEventPayload(body, connection)
	if err != nil {
		return WebhookResult{}, nil, err
	}
	return WebhookResult{}, []InboundMessage{message}, nil
}

func (p *feishuProvider) SupportsPolling(connection store.BotConnection) bool {
	mode, err := parseFeishuDeliveryMode(connection.Settings[feishuDeliveryModeSetting])
	return err == nil && mode == feishuDeliveryModeWebSocket
}

func (p *feishuProvider) PollingOwnerKey(connection store.BotConnection) string {
	if !p.SupportsPolling(connection) {
		return ""
	}
	appID := strings.TrimSpace(connection.Settings[feishuAppIDSetting])
	if appID == "" {
		return ""
	}
	domain, err := p.providerDomain(connection)
	if err != nil {
		return ""
	}
	return feishuProviderName + ":" + domain + ":" + appID
}

func (p *feishuProvider) PollingConflictError(ownerConnectionID string) error {
	message := "feishu websocket credentials are already claimed by another active polling connection"
	if owner := strings.TrimSpace(ownerConnectionID); owner != "" {
		message += " (" + owner + ")"
	}
	message += "; pause or delete the other connection before resuming this one"
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

func (p *feishuProvider) RunPolling(
	ctx context.Context,
	connection store.BotConnection,
	handleMessage PollingMessageHandler,
	updateSettings PollingSettingsHandler,
	reportEvent PollingEventHandler,
) error {
	appID := strings.TrimSpace(connection.Settings[feishuAppIDSetting])
	if appID == "" {
		return fmt.Errorf("%w: feishu app id is required", ErrInvalidInput)
	}
	appSecret := strings.TrimSpace(connection.Secrets[feishuAppSecretKey])
	if appSecret == "" {
		return fmt.Errorf("%w: feishu app secret is required", ErrInvalidInput)
	}
	domain, err := p.providerDomain(connection)
	if err != nil {
		return err
	}

	if updateSettings != nil {
		_ = updateSettings(ctx, map[string]string{
			feishuDeliveryModeSetting: feishuDeliveryModeWebSocket,
			feishuDomainSetting:       domain,
		})
	}

	delay := feishuPollingReconnectInitialDelay
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		endpoint, err := p.websocketEndpoint(ctx, domain, appID, appSecret)
		if err != nil {
			if errors.Is(err, ErrInvalidInput) {
				return err
			}
			if emitErr := emitPollingEvent(ctx, reportEvent, PollingEvent{
				EventType: "poll_error",
				Message:   "Feishu WebSocket endpoint request failed: " + strings.TrimSpace(err.Error()),
			}); emitErr != nil {
				return emitErr
			}
			if err := p.sleepFunc()(ctx, delay); err != nil {
				return err
			}
			delay = nextFeishuReconnectDelay(delay)
			continue
		}

		if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
			EventType: "poll_success",
			Message:   "Feishu WebSocket connected.",
		}); err != nil {
			return err
		}

		if err := p.runFeishuWebSocketSession(ctx, endpoint, connection, handleMessage, reportEvent); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if emitErr := emitPollingEvent(ctx, reportEvent, PollingEvent{
				EventType: "poll_error",
				Message:   "Feishu WebSocket disconnected: " + strings.TrimSpace(err.Error()),
			}); emitErr != nil {
				return emitErr
			}
			if err := p.sleepFunc()(ctx, delay); err != nil {
				return err
			}
			delay = nextFeishuReconnectDelay(delay)
			continue
		}

		delay = feishuPollingReconnectInitialDelay
	}
}

func (p *feishuProvider) SendMessages(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	messages []OutboundMessage,
) error {
	appID := strings.TrimSpace(connection.Settings[feishuAppIDSetting])
	if appID == "" {
		return fmt.Errorf("%w: feishu app id is required", ErrInvalidInput)
	}
	appSecret := strings.TrimSpace(connection.Secrets[feishuAppSecretKey])
	if appSecret == "" {
		return fmt.Errorf("%w: feishu app secret is required", ErrInvalidInput)
	}
	domain, err := p.providerDomain(connection)
	if err != nil {
		return err
	}

	chatID := firstNonEmpty(strings.TrimSpace(conversation.ExternalChatID), strings.TrimSpace(conversation.ProviderState[feishuChatIDKey]))
	if chatID == "" {
		return fmt.Errorf("%w: feishu external chat id is required", ErrInvalidInput)
	}

	token, err := p.tenantAccessToken(ctx, domain, appID, appSecret)
	if err != nil {
		return err
	}

	replyMessageID := strings.TrimSpace(conversation.ProviderState[feishuMessageIDKey])
	replyInThread := shouldFeishuReplyInThread(connection, conversation)
	deliveredParts := 0

	logBotDebug(ctx, connection, "feishu send messages requested",
		slog.String("externalChatId", chatID),
		slog.String("replyMessageId", replyMessageID),
		slog.Bool("replyInThread", replyInThread),
		slog.Int("messageCount", len(messages)),
		slog.Any("messages", debugOutboundMessages(messages)),
	)

	for _, message := range messages {
		text := messageSummaryText(message.Text, message.Media)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}

		payload := feishuBuildSendPayload(text, parseBoolSetting(connection.Settings[feishuEnableCardsSetting], false))
		sendErr := p.sendFeishuMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, payload)
		if sendErr != nil {
			if deliveredParts == 0 && isFeishuRetryableSendError(sendErr) {
				return markReplyDeliveryRetryable(sendErr)
			}
			return sendErr
		}
		deliveredParts += 1
	}

	return nil
}

func (p *feishuProvider) ReplyDeliveryRetryDecision(err error, attempt int) (bool, time.Duration) {
	if attempt >= feishuReplyRetryAttempts || !isReplyDeliveryRetryable(err) {
		return false, 0
	}
	underlying := unwrapReplyDeliveryRetryable(err)
	if !isFeishuRetryableSendError(underlying) {
		return false, 0
	}
	return true, feishuReplyRetryBackoff(attempt)
}

func feishuReplyRetryBackoff(attempt int) time.Duration {
	delay := feishuReplyRetryBaseDelay
	for step := 1; step < attempt; step++ {
		delay *= 2
		if delay >= feishuReplyRetryMaxDelay {
			return feishuReplyRetryMaxDelay
		}
	}
	if delay > feishuReplyRetryMaxDelay {
		return feishuReplyRetryMaxDelay
	}
	return delay
}

func (p *feishuProvider) sleepFunc() func(context.Context, time.Duration) error {
	if p != nil && p.sleep != nil {
		return p.sleep
	}
	return sleepWithContext
}

func (p *feishuProvider) providerDomain(connection store.BotConnection) (string, error) {
	return normalizedFeishuDomain(firstNonEmpty(connection.Settings[feishuDomainSetting], p.domain))
}

func (p *feishuProvider) client(timeout time.Duration) *http.Client {
	if p.clients == nil {
		return staticHTTPClientSource{}.Client(timeout)
	}
	return p.clients.Client(timeout)
}

func (p *feishuProvider) tenantAccessToken(ctx context.Context, domain, appID, appSecret string) (string, error) {
	response := feishuTenantAccessTokenResponse{}
	if err := p.callJSON(ctx, http.MethodPost, domain, feishuAppAccessTokenEndpoint, "", map[string]string{
		"app_id":     strings.TrimSpace(appID),
		"app_secret": strings.TrimSpace(appSecret),
	}, &response); err != nil {
		return "", err
	}
	token := firstNonEmpty(
		strings.TrimSpace(response.TenantAccessToken),
		strings.TrimSpace(response.AppAccessToken),
	)
	if token == "" {
		return "", fmt.Errorf("feishu tenant access token response did not include a token")
	}
	return token, nil
}

func (p *feishuProvider) botInfo(ctx context.Context, domain, token string) (feishuBotInfoResponse, error) {
	response := feishuBotInfoResponse{}
	if err := p.callJSON(ctx, http.MethodGet, domain, feishuBotInfoEndpoint, token, nil, &response); err != nil {
		return feishuBotInfoResponse{}, err
	}
	if response.openID() == "" {
		return feishuBotInfoResponse{}, fmt.Errorf("feishu bot info response did not include bot open id")
	}
	return response, nil
}

func (p *feishuProvider) websocketEndpoint(ctx context.Context, domain, appID, appSecret string) (string, error) {
	response := feishuWSEndpointResponse{}
	if err := p.callJSON(ctx, http.MethodPost, domain, feishuWebsocketConnectEndpoint, "", map[string]string{
		"AppID":     strings.TrimSpace(appID),
		"AppSecret": strings.TrimSpace(appSecret),
	}, &response); err != nil {
		return "", err
	}
	endpoint := firstNonEmpty(
		strings.TrimSpace(response.Data.URL),
		strings.TrimSpace(response.Data.URLLower),
	)
	if endpoint == "" {
		return "", fmt.Errorf("feishu websocket endpoint response did not include a url")
	}
	return endpoint, nil
}

func (p *feishuProvider) runFeishuWebSocketSession(
	ctx context.Context,
	endpoint string,
	connection store.BotConnection,
	handleMessage PollingMessageHandler,
	reportEvent PollingEventHandler,
) error {
	conn, _, err := p.websocketDialer().DialContext(ctx, endpoint, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(p.nowFunc().Add(feishuWSReadTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(p.nowFunc().Add(feishuWSReadTimeout))
	})

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()
	defer close(done)

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		messageType, frameData, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
		_ = conn.SetReadDeadline(p.nowFunc().Add(feishuWSReadTimeout))

		if messageType != websocket.BinaryMessage {
			continue
		}
		if err := p.handleFeishuFrame(ctx, conn, connection, handleMessage, reportEvent, frameData); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
	}
}

func (p *feishuProvider) handleFeishuFrame(
	ctx context.Context,
	conn *websocket.Conn,
	connection store.BotConnection,
	handleMessage PollingMessageHandler,
	reportEvent PollingEventHandler,
	frameData []byte,
) error {
	frame, err := parseFeishuFrame(frameData)
	if err != nil {
		return err
	}

	frameType := strings.ToLower(strings.TrimSpace(frame.headerValue(feishuWSHeaderType)))
	switch frameType {
	case feishuWSHeaderPing:
		return writeFeishuFrame(conn, feishuPongFrame(frame))

	case "", feishuWSHeaderEvent:
		inbound, parseErr := p.parseFeishuEventPayload(frame.Payload, connection)
		ackErr := writeFeishuFrame(conn, feishuAckFrame(frame, p.nowFunc()))
		switch {
		case errors.Is(parseErr, ErrWebhookIgnored):
			if ackErr != nil {
				return ackErr
			}
			return emitPollingEvent(ctx, reportEvent, PollingEvent{
				EventType:      "poll_idle",
				Message:        "Feishu event ignored.",
				ReceivedCount:  1,
				ProcessedCount: 0,
				IgnoredCount:   1,
			})
		case parseErr != nil:
			if ackErr != nil {
				return errors.Join(parseErr, ackErr)
			}
			return parseErr
		}

		if err := handleMessage(ctx, inbound); err != nil {
			return err
		}
		if ackErr != nil {
			return ackErr
		}
		return emitPollingEvent(ctx, reportEvent, PollingEvent{
			EventType:      "poll_success",
			Message:        "Feishu event processed successfully.",
			ReceivedCount:  1,
			ProcessedCount: 1,
			IgnoredCount:   0,
		})
	}

	if frame.Method == feishuWSFrameMethodData {
		return writeFeishuFrame(conn, feishuAckFrame(frame, p.nowFunc()))
	}
	return nil
}

func (p *feishuProvider) parseFeishuEventPayload(payload []byte, connection store.BotConnection) (InboundMessage, error) {
	var envelope feishuEventEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return InboundMessage{}, fmt.Errorf("%w: decode feishu event: %s", ErrInvalidInput, err.Error())
	}

	if strings.TrimSpace(envelope.Header.EventType) != "im.message.receive_v1" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	return p.inboundMessageFromFeishuEvent(connection, envelope)
}

func (p *feishuProvider) inboundMessageFromFeishuEvent(
	connection store.BotConnection,
	envelope feishuEventEnvelope,
) (InboundMessage, error) {
	message := envelope.Event.Message
	sender := envelope.Event.Sender

	if strings.EqualFold(strings.TrimSpace(sender.SenderType), "app") {
		return InboundMessage{}, ErrWebhookIgnored
	}

	chatID := strings.TrimSpace(message.ChatID)
	userID := strings.TrimSpace(sender.SenderID.OpenID)
	messageID := strings.TrimSpace(message.MessageID)
	if chatID == "" || userID == "" || messageID == "" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	chatType := strings.TrimSpace(message.ChatType)
	botOpenID := strings.TrimSpace(connection.Settings[feishuBotOpenIDSetting])
	groupReplyAll := parseBoolSetting(connection.Settings[feishuGroupReplyAllSetting], false)
	if strings.EqualFold(chatType, "group") && !groupReplyAll && botOpenID != "" &&
		!isFeishuBotMentioned(message.Mentions, botOpenID) {
		return InboundMessage{}, ErrWebhookIgnored
	}

	var text string
	var err error
	switch strings.TrimSpace(message.MessageType) {
	case "text":
		text, err = extractFeishuTextContent(message.Content, message.Mentions, botOpenID)
	case "post":
		text, err = extractFeishuPostText(message.Content, message.Mentions, botOpenID)
	default:
		return InboundMessage{}, ErrWebhookIgnored
	}
	if err != nil {
		return InboundMessage{}, err
	}
	if text == "" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	threadIsolation := parseBoolSetting(connection.Settings[feishuThreadIsolationSetting], false)
	shareSessionInChannel := parseBoolSetting(connection.Settings[feishuShareSessionInChannelSetting], false)
	conversationID := feishuConversationKey(
		chatType,
		chatID,
		userID,
		firstNonEmpty(strings.TrimSpace(message.RootID), strings.TrimSpace(message.ThreadID)),
		messageID,
		threadIsolation,
		shareSessionInChannel,
	)
	externalThreadID := firstNonEmpty(strings.TrimSpace(message.RootID), strings.TrimSpace(message.ThreadID))
	title := firstNonEmpty(strings.TrimSpace(envelope.Event.Chat.Name), chatID)
	username := firstNonEmpty(strings.TrimSpace(sender.Name), strings.TrimSpace(sender.SenderName), userID)

	providerData := map[string]string{
		feishuChatIDKey:         chatID,
		feishuMessageIDKey:      messageID,
		feishuThreadIDKey:       strings.TrimSpace(message.ThreadID),
		feishuRootIDKey:         strings.TrimSpace(message.RootID),
		feishuParentIDKey:       strings.TrimSpace(message.ParentID),
		feishuChatTypeKey:       chatType,
		feishuUserOpenIDKey:     userID,
		feishuConversationIDKey: conversationID,
	}
	if title != "" {
		providerData[feishuChatNameKey] = title
	}

	return InboundMessage{
		ConversationID:   conversationID,
		ExternalChatID:   chatID,
		ExternalThreadID: externalThreadID,
		MessageID:        messageID,
		UserID:           userID,
		Username:         username,
		Title:            title,
		Text:             text,
		ProviderData:     providerData,
	}, nil
}

func feishuConversationKey(
	chatType string,
	chatID string,
	userID string,
	rootID string,
	messageID string,
	threadIsolation bool,
	shareSessionInChannel bool,
) string {
	chatID = strings.TrimSpace(chatID)
	userID = strings.TrimSpace(userID)
	if strings.EqualFold(strings.TrimSpace(chatType), "group") {
		if threadIsolation {
			rootID = firstNonEmpty(strings.TrimSpace(rootID), strings.TrimSpace(messageID))
			if rootID != "" {
				return "chat:" + chatID + ":root:" + rootID
			}
		}
		if shareSessionInChannel {
			return "chat:" + chatID
		}
	}
	if chatID == "" {
		return ""
	}
	if userID == "" {
		return "chat:" + chatID
	}
	return "chat:" + chatID + ":user:" + userID
}

func extractFeishuTextContent(raw string, mentions []feishuMention, botOpenID string) (string, error) {
	var payload struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return "", fmt.Errorf("%w: decode feishu text content: %s", ErrInvalidInput, err.Error())
	}
	text := stripFeishuMentions(payload.Text, mentions, botOpenID)
	text = html.UnescapeString(strings.TrimSpace(text))
	return text, nil
}

func extractFeishuPostText(raw string, mentions []feishuMention, botOpenID string) (string, error) {
	var flat feishuPostContent
	if err := json.Unmarshal([]byte(raw), &flat); err == nil && len(flat.Content) > 0 {
		return feishuPostText(flat, mentions, botOpenID), nil
	}

	var languageMap map[string]feishuPostContent
	if err := json.Unmarshal([]byte(raw), &languageMap); err != nil {
		return "", fmt.Errorf("%w: decode feishu post content: %s", ErrInvalidInput, err.Error())
	}
	for _, content := range languageMap {
		return feishuPostText(content, mentions, botOpenID), nil
	}
	return "", nil
}

func feishuPostText(content feishuPostContent, mentions []feishuMention, botOpenID string) string {
	lines := make([]string, 0, len(content.Content)+1)
	if title := strings.TrimSpace(content.Title); title != "" {
		lines = append(lines, title)
	}
	for _, row := range content.Content {
		parts := make([]string, 0, len(row))
		for _, item := range row {
			switch strings.TrimSpace(item.Tag) {
			case "text", "a", "code_block":
				if text := strings.TrimSpace(item.Text); text != "" {
					parts = append(parts, text)
				}
			}
		}
		if len(parts) > 0 {
			lines = append(lines, strings.Join(parts, " "))
		}
	}
	text := stripFeishuMentions(strings.Join(lines, "\n"), mentions, botOpenID)
	return html.UnescapeString(strings.TrimSpace(text))
}

func isFeishuBotMentioned(mentions []feishuMention, botOpenID string) bool {
	botOpenID = strings.TrimSpace(botOpenID)
	if botOpenID == "" {
		return false
	}
	for _, mention := range mentions {
		if strings.TrimSpace(mention.ID.OpenID) == botOpenID {
			return true
		}
	}
	return false
}

func stripFeishuMentions(text string, mentions []feishuMention, botOpenID string) string {
	if len(mentions) == 0 {
		return strings.TrimSpace(text)
	}
	for _, mention := range mentions {
		key := strings.TrimSpace(mention.Key)
		if key == "" {
			continue
		}
		if botOpenID != "" && strings.TrimSpace(mention.ID.OpenID) == strings.TrimSpace(botOpenID) {
			text = strings.ReplaceAll(text, key, "")
			continue
		}
		if name := strings.TrimSpace(mention.Name); name != "" {
			text = strings.ReplaceAll(text, key, "@"+name)
			continue
		}
		text = strings.ReplaceAll(text, key, "")
	}
	return strings.TrimSpace(text)
}

func shouldFeishuReplyInThread(connection store.BotConnection, conversation store.BotConversation) bool {
	if !parseBoolSetting(connection.Settings[feishuThreadIsolationSetting], false) {
		return false
	}
	if strings.TrimSpace(conversation.ProviderState[feishuRootIDKey]) != "" {
		return true
	}
	if strings.Contains(strings.TrimSpace(conversation.ExternalConversationID), ":root:") {
		return true
	}
	return false
}

func parseFeishuWebhookChallenge(payload []byte) (string, bool, error) {
	var envelope feishuWebhookEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return "", false, fmt.Errorf("%w: decode feishu webhook: %s", ErrInvalidInput, err.Error())
	}
	if strings.EqualFold(strings.TrimSpace(envelope.Type), "url_verification") {
		challenge := strings.TrimSpace(envelope.Challenge)
		if challenge == "" {
			return "", false, fmt.Errorf("%w: feishu webhook challenge is required", ErrInvalidInput)
		}
		return challenge, true, nil
	}
	return "", false, nil
}

type feishuSendPayload struct {
	Content string
	MsgType string
}

func feishuBuildSendPayload(text string, useCard bool) feishuSendPayload {
	text = strings.TrimSpace(text)
	if useCard {
		return feishuSendPayload{
			Content: buildFeishuCardJSON(text),
			MsgType: "interactive",
		}
	}
	return feishuSendPayload{
		Content: feishuTextMessageContent(text),
		MsgType: "text",
	}
}

func buildFeishuCardJSON(content string) string {
	card := map[string]any{
		"schema": "2.0",
		"config": map[string]any{
			"wide_screen_mode": true,
		},
		"body": map[string]any{
			"elements": []map[string]any{
				{
					"tag":     "markdown",
					"content": strings.TrimSpace(content),
				},
			},
		},
	}
	data, _ := json.Marshal(card)
	return string(data)
}

func (p *feishuProvider) sendFeishuMessage(
	ctx context.Context,
	connection store.BotConnection,
	domain string,
	token string,
	chatID string,
	replyMessageID string,
	replyInThread bool,
	payload feishuSendPayload,
) error {
	if replyMessageID != "" {
		sendErr := p.sendFeishuReply(ctx, domain, token, replyMessageID, payload, replyInThread)
		if sendErr != nil && shouldFeishuFallbackToCreate(sendErr) {
			logBotDebug(ctx, connection, "feishu reply failed; falling back to chat send",
				slog.String("replyMessageId", replyMessageID),
				slog.String("error", sendErr.Error()),
			)
			sendErr = p.sendFeishuCreate(ctx, domain, token, chatID, payload)
		}
		return sendErr
	}
	return p.sendFeishuCreate(ctx, domain, token, chatID, payload)
}

func (p *feishuProvider) sendFeishuReply(
	ctx context.Context,
	domain string,
	token string,
	messageID string,
	payload feishuSendPayload,
	replyInThread bool,
) error {
	response := feishuSendMessageResponse{}
	body := map[string]any{
		"content":  payload.Content,
		"msg_type": payload.MsgType,
	}
	if replyInThread {
		body["reply_in_thread"] = true
	}
	return p.callJSON(ctx, http.MethodPost, domain, "/open-apis/im/v1/messages/"+url.PathEscape(strings.TrimSpace(messageID))+"/reply", token, body, &response)
}

func (p *feishuProvider) sendFeishuCreate(
	ctx context.Context,
	domain string,
	token string,
	chatID string,
	payload feishuSendPayload,
) error {
	response := feishuSendMessageResponse{}
	return p.callJSON(ctx, http.MethodPost, domain, "/open-apis/im/v1/messages?receive_id_type=chat_id", token, map[string]any{
		"receive_id": strings.TrimSpace(chatID),
		"content":    payload.Content,
		"msg_type":   payload.MsgType,
	}, &response)
}

func feishuTextMessageContent(text string) string {
	content, _ := json.Marshal(map[string]string{"text": strings.TrimSpace(text)})
	return string(content)
}

func (p *feishuProvider) callJSON(
	ctx context.Context,
	method string,
	domain string,
	requestPath string,
	bearerToken string,
	payload any,
	target any,
) error {
	endpoint, err := buildFeishuURL(domain, requestPath)
	if err != nil {
		return err
	}

	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode feishu %s payload: %w", requestPath, err)
		}
		body = bytes.NewReader(data)
	}

	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return fmt.Errorf("build feishu %s request: %w", requestPath, err)
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(bearerToken) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(bearerToken))
	}

	response, err := p.client(feishuDefaultHTTPTimeout).Do(request)
	if err != nil {
		return &feishuRequestError{operation: requestPath, cause: err}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		return feishuRequestErrorFromHTTP(requestPath, response.StatusCode, response.Status, content)
	}

	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode feishu %s response: %w", requestPath, err)
	}
	if coded, ok := target.(interface {
		responseCode() int
		responseMessage() string
	}); ok && coded.responseCode() != 0 {
		return &feishuRequestError{
			operation: requestPath,
			apiCode:   coded.responseCode(),
			apiMsg:    strings.TrimSpace(coded.responseMessage()),
		}
	}
	return nil
}

func feishuRequestErrorFromHTTP(operation string, statusCode int, status string, content []byte) error {
	errValue := &feishuRequestError{
		operation:  operation,
		statusCode: statusCode,
		status:     status,
		apiMsg:     strings.TrimSpace(string(content)),
	}
	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if json.Unmarshal(content, &payload) == nil {
		errValue.apiCode = payload.Code
		errValue.apiMsg = firstNonEmpty(strings.TrimSpace(payload.Msg), errValue.apiMsg)
	}
	return errValue
}

func buildFeishuURL(domain string, requestPath string) (string, error) {
	base, err := url.Parse(strings.TrimSpace(domain))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", fmt.Errorf("%w: feishu domain must be absolute", ErrInvalidInput)
	}
	relative, err := url.Parse(strings.TrimSpace(requestPath))
	if err != nil {
		return "", fmt.Errorf("invalid feishu request path %q: %w", requestPath, err)
	}
	return base.ResolveReference(relative).String(), nil
}

func normalizedFeishuDomain(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		trimmed = feishuDefaultDomain
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("%w: feishu domain must be absolute", ErrInvalidInput)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func parseFeishuDeliveryMode(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", feishuDeliveryModeWebSocket:
		return feishuDeliveryModeWebSocket, nil
	case feishuDeliveryModeWebhook:
		return feishuDeliveryModeWebhook, nil
	default:
		return "", fmt.Errorf("%w: feishu delivery mode must be websocket or webhook", ErrInvalidInput)
	}
}

func parseBoolSetting(value string, fallback bool) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(trimmed)
	if err == nil {
		return parsed
	}
	switch strings.ToLower(trimmed) {
	case "1", "yes", "y", "on":
		return true
	case "0", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

func nextFeishuReconnectDelay(current time.Duration) time.Duration {
	if current <= 0 {
		return feishuPollingReconnectInitialDelay
	}
	next := current * 2
	if next > feishuPollingReconnectMaxDelay {
		return feishuPollingReconnectMaxDelay
	}
	return next
}

func shouldFeishuFallbackToCreate(err error) bool {
	var requestErr *feishuRequestError
	if !errors.As(err, &requestErr) {
		return false
	}
	if requestErr.cause != nil {
		return false
	}
	if requestErr.statusCode == http.StatusUnauthorized || requestErr.statusCode == http.StatusForbidden {
		return false
	}
	return true
}

func isFeishuRetryableSendError(err error) bool {
	if err == nil {
		return false
	}
	var requestErr *feishuRequestError
	if errors.As(err, &requestErr) {
		if requestErr.cause != nil {
			return isTransientFeishuTransportError(requestErr.cause)
		}
		return requestErr.statusCode >= http.StatusInternalServerError
	}
	return isTransientFeishuTransportError(err)
}

func isTransientFeishuTransportError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	return websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseInternalServerErr)
}

func (p *feishuProvider) websocketDialer() *websocket.Dialer {
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = feishuDefaultHTTPTimeout
	if proxyAware, ok := p.clients.(proxyAwareHTTPClientSource); ok {
		if proxyURL := strings.TrimSpace(proxyAware.EffectiveProxyURL()); proxyURL != "" {
			if parsed, err := url.Parse(proxyURL); err == nil {
				dialer.Proxy = http.ProxyURL(parsed)
			}
		}
	}
	return &dialer
}

func (p *feishuProvider) nowFunc() time.Time {
	if p != nil && p.now != nil {
		return p.now()
	}
	return time.Now()
}

func (r feishuTenantAccessTokenResponse) responseCode() int       { return r.Code }
func (r feishuTenantAccessTokenResponse) responseMessage() string { return r.Msg }
func (r feishuBotInfoResponse) responseCode() int                 { return r.Code }
func (r feishuBotInfoResponse) responseMessage() string           { return r.Msg }
func (r feishuWSEndpointResponse) responseCode() int              { return r.Code }
func (r feishuWSEndpointResponse) responseMessage() string        { return r.Msg }
func (r feishuSendMessageResponse) responseCode() int             { return r.Code }
func (r feishuSendMessageResponse) responseMessage() string       { return r.Msg }

func (r feishuBotInfoResponse) openID() string {
	return firstNonEmpty(strings.TrimSpace(r.Bot.OpenID), strings.TrimSpace(r.Data.OpenID))
}

func (r feishuBotInfoResponse) displayName() string {
	return firstNonEmpty(
		strings.TrimSpace(r.Bot.Name),
		strings.TrimSpace(r.Bot.DisplayName),
		strings.TrimSpace(r.Bot.AppName),
		strings.TrimSpace(r.Data.Name),
		strings.TrimSpace(r.Data.DisplayName),
		strings.TrimSpace(r.Data.AppName),
		r.openID(),
	)
}

func (f feishuWSFrame) headerValue(key string) string {
	key = strings.TrimSpace(key)
	for _, header := range f.Headers {
		if strings.EqualFold(strings.TrimSpace(header.Key), key) {
			return strings.TrimSpace(header.Value)
		}
	}
	return ""
}

func feishuAckFrame(frame feishuWSFrame, now time.Time) feishuWSFrame {
	headers := make([]feishuWSHeader, 0, len(frame.Headers)+1)
	for _, header := range frame.Headers {
		if strings.EqualFold(strings.TrimSpace(header.Key), feishuWSHeaderBizRT) {
			continue
		}
		headers = append(headers, header)
	}
	headers = append(headers, feishuWSHeader{
		Key:   feishuWSHeaderBizRT,
		Value: strconv.FormatInt(now.UnixMilli(), 10),
	})
	return feishuWSFrame{
		SeqID:           frame.SeqID,
		LogID:           frame.LogID,
		Service:         frame.Service,
		Method:          frame.Method,
		Headers:         headers,
		PayloadEncoding: "json",
		PayloadType:     "string",
		Payload:         []byte(`{"code":200}`),
		LogIDNew:        frame.LogIDNew,
	}
}

func feishuPongFrame(frame feishuWSFrame) feishuWSFrame {
	return feishuWSFrame{
		SeqID:    frame.SeqID,
		LogID:    frame.LogID,
		Service:  frame.Service,
		Method:   feishuWSFrameMethodControl,
		Headers:  []feishuWSHeader{{Key: feishuWSHeaderType, Value: feishuWSHeaderPong}},
		LogIDNew: frame.LogIDNew,
	}
}

func writeFeishuFrame(conn *websocket.Conn, frame feishuWSFrame) error {
	if conn == nil {
		return nil
	}
	data, err := marshalFeishuFrame(frame)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.BinaryMessage, data)
}

func marshalFeishuFrame(frame feishuWSFrame) ([]byte, error) {
	buffer := make([]byte, 0, len(frame.Payload)+128)
	buffer = appendProtoVarintField(buffer, 1, frame.SeqID)
	buffer = appendProtoVarintField(buffer, 2, frame.LogID)
	buffer = appendProtoVarintField(buffer, 3, uint64(frame.Service))
	buffer = appendProtoVarintField(buffer, 4, uint64(frame.Method))
	for _, header := range frame.Headers {
		headerBytes := make([]byte, 0, len(header.Key)+len(header.Value)+8)
		headerBytes = appendProtoBytesField(headerBytes, 1, []byte(header.Key))
		headerBytes = appendProtoBytesField(headerBytes, 2, []byte(header.Value))
		buffer = appendProtoBytesField(buffer, 5, headerBytes)
	}
	if frame.PayloadEncoding != "" {
		buffer = appendProtoBytesField(buffer, 6, []byte(frame.PayloadEncoding))
	}
	if frame.PayloadType != "" {
		buffer = appendProtoBytesField(buffer, 7, []byte(frame.PayloadType))
	}
	if len(frame.Payload) > 0 {
		buffer = appendProtoBytesField(buffer, 8, frame.Payload)
	}
	if frame.LogIDNew != "" {
		buffer = appendProtoBytesField(buffer, 9, []byte(frame.LogIDNew))
	}
	return buffer, nil
}

func parseFeishuFrame(data []byte) (feishuWSFrame, error) {
	frame := feishuWSFrame{}
	for len(data) > 0 {
		tag, rest, err := readProtoUvarint(data)
		if err != nil {
			return feishuWSFrame{}, err
		}
		data = rest
		fieldNumber := int(tag >> 3)
		wireType := int(tag & 0x7)
		switch wireType {
		case 0:
			value, next, err := readProtoUvarint(data)
			if err != nil {
				return feishuWSFrame{}, err
			}
			switch fieldNumber {
			case 1:
				frame.SeqID = value
			case 2:
				frame.LogID = value
			case 3:
				frame.Service = int32(value)
			case 4:
				frame.Method = int32(value)
			}
			data = next
		case 2:
			value, next, err := readProtoBytes(data)
			if err != nil {
				return feishuWSFrame{}, err
			}
			switch fieldNumber {
			case 5:
				header, err := parseFeishuFrameHeader(value)
				if err != nil {
					return feishuWSFrame{}, err
				}
				frame.Headers = append(frame.Headers, header)
			case 6:
				frame.PayloadEncoding = string(value)
			case 7:
				frame.PayloadType = string(value)
			case 8:
				frame.Payload = append([]byte(nil), value...)
			case 9:
				frame.LogIDNew = string(value)
			}
			data = next
		default:
			return feishuWSFrame{}, fmt.Errorf("unsupported feishu protobuf wire type %d", wireType)
		}
	}
	return frame, nil
}

func parseFeishuFrameHeader(data []byte) (feishuWSHeader, error) {
	header := feishuWSHeader{}
	for len(data) > 0 {
		tag, rest, err := readProtoUvarint(data)
		if err != nil {
			return feishuWSHeader{}, err
		}
		data = rest
		fieldNumber := int(tag >> 3)
		wireType := int(tag & 0x7)
		if wireType != 2 {
			return feishuWSHeader{}, fmt.Errorf("unsupported feishu header wire type %d", wireType)
		}
		value, next, err := readProtoBytes(data)
		if err != nil {
			return feishuWSHeader{}, err
		}
		switch fieldNumber {
		case 1:
			header.Key = string(value)
		case 2:
			header.Value = string(value)
		}
		data = next
	}
	return header, nil
}

func appendProtoVarintField(buffer []byte, fieldNumber int, value uint64) []byte {
	buffer = appendProtoUvarint(buffer, uint64(fieldNumber<<3))
	return appendProtoUvarint(buffer, value)
}

func appendProtoBytesField(buffer []byte, fieldNumber int, value []byte) []byte {
	buffer = appendProtoUvarint(buffer, uint64(fieldNumber<<3|2))
	buffer = appendProtoUvarint(buffer, uint64(len(value)))
	return append(buffer, value...)
}

func appendProtoUvarint(buffer []byte, value uint64) []byte {
	for value >= 0x80 {
		buffer = append(buffer, byte(value)|0x80)
		value >>= 7
	}
	return append(buffer, byte(value))
}

func readProtoUvarint(data []byte) (uint64, []byte, error) {
	var (
		value uint64
		shift uint
	)
	for index, item := range data {
		value |= uint64(item&0x7f) << shift
		if item < 0x80 {
			return value, data[index+1:], nil
		}
		shift += 7
		if shift > 63 {
			return 0, nil, fmt.Errorf("invalid feishu protobuf varint")
		}
	}
	return 0, nil, io.ErrUnexpectedEOF
}

func readProtoBytes(data []byte) ([]byte, []byte, error) {
	length, rest, err := readProtoUvarint(data)
	if err != nil {
		return nil, nil, err
	}
	if uint64(len(rest)) < length {
		return nil, nil, io.ErrUnexpectedEOF
	}
	return rest[:length], rest[length:], nil
}
