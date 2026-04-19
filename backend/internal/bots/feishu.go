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
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"codex-server/backend/internal/store"

	"github.com/gorilla/websocket"
)

const (
	feishuProviderName                                  = "feishu"
	feishuAppIDSetting                                  = "feishu_app_id"
	feishuAppSecretKey                                  = "feishu_app_secret"
	feishuDomainSetting                                 = "feishu_domain"
	feishuDeliveryModeSetting                           = "feishu_delivery_mode"
	feishuDeliveryModeWebSocket                         = "websocket"
	feishuDeliveryModeWebhook                           = "webhook"
	feishuGroupReplyAllSetting                          = "feishu_group_reply_all"
	feishuThreadIsolationSetting                        = "feishu_thread_isolation"
	feishuShareSessionInChannelSetting                  = "feishu_share_session_in_channel"
	feishuResolveMentionsSetting                        = "feishu_resolve_mentions"
	feishuEnableCardsSetting                            = "feishu_enable_cards"
	feishuStreamingPlainTextStrategySetting             = "feishu_streaming_plain_text_strategy"
	feishuBotOpenIDSetting                              = "bot_open_id"
	feishuBotDisplayNameSetting                         = "bot_display_name"
	feishuChatIDKey                                     = "feishu_chat_id"
	feishuMessageIDKey                                  = "feishu_message_id"
	feishuThreadIDKey                                   = "feishu_thread_id"
	feishuRootIDKey                                     = "feishu_root_id"
	feishuParentIDKey                                   = "feishu_parent_id"
	feishuChatTypeKey                                   = "feishu_chat_type"
	feishuUserOpenIDKey                                 = "feishu_user_open_id"
	feishuConversationIDKey                             = "feishu_conversation_id"
	feishuChatNameKey                                   = "feishu_chat_name"
	feishuEventTypeKey                                  = "feishu_event_type"
	feishuApprovalCodeKey                               = "feishu_approval_code"
	feishuApprovalIDKey                                 = "feishu_approval_id"
	feishuApprovalInstanceCodeKey                       = "feishu_approval_instance_code"
	feishuApprovalStatusKey                             = "feishu_approval_status"
	feishuApprovalVersionIDKey                          = "feishu_approval_version_id"
	feishuApprovalTimestampKey                          = "feishu_approval_timestamp"
	feishuApprovalEventUUIDKey                          = "feishu_approval_event_uuid"
	feishuApprovalOperateTimeKey                        = "feishu_approval_operate_time"
	feishuDefaultDomain                                 = "https://open.feishu.cn"
	feishuDefaultHTTPTimeout                            = 15 * time.Second
	feishuWSReadTimeout                                 = 90 * time.Second
	feishuPollingReconnectInitialDelay                  = time.Second
	feishuPollingReconnectMaxDelay                      = 15 * time.Second
	feishuReplyRetryAttempts                            = 2
	feishuReplyRetryBaseDelay                           = 500 * time.Millisecond
	feishuReplyRetryMaxDelay                            = 3 * time.Second
	feishuWSFrameMethodControl                    int32 = 0
	feishuWSFrameMethodData                       int32 = 1
	feishuWSHeaderType                                  = "type"
	feishuWSHeaderPing                                  = "ping"
	feishuWSHeaderPong                                  = "pong"
	feishuWSHeaderEvent                                 = "event"
	feishuWSHeaderBizRT                                 = "biz_rt"
	feishuAppAccessTokenEndpoint                        = "/open-apis/auth/v3/tenant_access_token/internal"
	feishuBotInfoEndpoint                               = "/open-apis/bot/v3/info"
	feishuWebsocketConnectEndpoint                      = "/callback/ws/endpoint"
	feishuTypingReactionEmojiType                       = "Typing"
	feishuStreamingPlainTextStrategyUpdateOnly          = "update_only"
	feishuStreamingPlainTextStrategySmartPreserve       = "smart_preserve"
	feishuStreamingPlainTextStrategyAppendDelta         = "append_delta"
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

type feishuMessageReactionResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		ReactionID string `json:"reaction_id"`
	} `json:"data"`
}

type feishuEventHeader struct {
	EventType       string `json:"event_type"`
	EventID         string `json:"event_id"`
	Token           string `json:"token"`
	AppID           string `json:"app_id"`
	TenantKey       string `json:"tenant_key"`
	EventCreateTime string `json:"event_create_time"`
}

type feishuEventEnvelope struct {
	Schema string            `json:"schema"`
	Type   string            `json:"type"`
	Header feishuEventHeader `json:"header"`
}

type feishuWebhookEnvelope struct {
	Type      string            `json:"type"`
	Token     string            `json:"token"`
	Challenge string            `json:"challenge"`
	Schema    string            `json:"schema"`
	Header    feishuEventHeader `json:"header"`
	Event     json.RawMessage   `json:"event"`
}

type feishuMessageEventEnvelope struct {
	Schema string             `json:"schema"`
	Header feishuEventHeader  `json:"header"`
	Event  feishuMessageEvent `json:"event"`
}

type feishuApprovalUpdatedEventEnvelope struct {
	Schema string            `json:"schema"`
	Header feishuEventHeader `json:"header"`
	Event  struct {
		Object feishuApprovalUpdatedEvent `json:"object"`
	} `json:"event"`
}

type feishuApprovalUpdatedEvent struct {
	ApprovalID       string              `json:"approval_id"`
	ApprovalCode     string              `json:"approval_code"`
	VersionID        string              `json:"version_id"`
	WidgetGroupType  int                 `json:"widget_group_type"`
	FormDefinitionID string              `json:"form_definition_id"`
	ProcessObj       string              `json:"process_obj"`
	Timestamp        feishuFlexibleValue `json:"timestamp"`
	Extra            string              `json:"extra"`
}

type feishuApprovalInstanceEnvelope struct {
	Timestamp string                      `json:"ts"`
	UUID      string                      `json:"uuid"`
	Token     string                      `json:"token"`
	Type      string                      `json:"type"`
	Event     feishuApprovalInstanceEvent `json:"event"`
}

type feishuApprovalInstanceEvent struct {
	AppID               string              `json:"app_id"`
	TenantKey           string              `json:"tenant_key"`
	Type                string              `json:"type"`
	ApprovalCode        string              `json:"approval_code"`
	InstanceCode        string              `json:"instance_code"`
	Status              string              `json:"status"`
	OperateTime         feishuFlexibleValue `json:"operate_time"`
	InstanceOperateTime feishuFlexibleValue `json:"instance_operate_time"`
	UUID                string              `json:"uuid"`
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
	ImageKey string `json:"image_key"`
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

type feishuStreamingReplySession struct {
	provider     *feishuProvider
	connection   store.BotConnection
	conversation store.BotConversation

	mu                       sync.Mutex
	sentMessages             []OutboundMessage
	streamMessageID          string
	streamPayload            *feishuSendPayload
	streamMessageText        string
	streamMessageKind        feishuStreamingTextKind
	plainTextStrategy        string
	plainTextCommittedPrefix string
}

type feishuStreamingTextKind string

const (
	feishuStreamingTextKindDefault        feishuStreamingTextKind = "default"
	feishuStreamingTextKindStatus         feishuStreamingTextKind = "status"
	feishuStreamingTextKindToolProgress   feishuStreamingTextKind = "tool_progress"
	feishuStreamingTextKindActionRequired feishuStreamingTextKind = "action_required"
)

type feishuTypingSession struct {
	provider   *feishuProvider
	domain     string
	token      string
	messageID  string
	reactionID string
}

type feishuFlexibleValue string

func (v *feishuFlexibleValue) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || strings.EqualFold(trimmed, "null") {
		*v = ""
		return nil
	}

	var stringValue string
	if err := json.Unmarshal(data, &stringValue); err == nil {
		*v = feishuFlexibleValue(strings.TrimSpace(stringValue))
		return nil
	}

	var number json.Number
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&number); err == nil {
		*v = feishuFlexibleValue(strings.TrimSpace(number.String()))
		return nil
	}

	return fmt.Errorf("decode feishu flexible value")
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
	settings[feishuStreamingPlainTextStrategySetting] = parseFeishuStreamingPlainTextStrategy(
		connection.Settings[feishuStreamingPlainTextStrategySetting],
		feishuStreamingPlainTextStrategyUpdateOnly,
	)
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
		text := strings.TrimSpace(message.Text)
		if text != "" {
			_, sendErr := p.sendFeishuTextMessage(
				ctx,
				connection,
				domain,
				token,
				chatID,
				replyMessageID,
				replyInThread,
				text,
				parseBoolSetting(connection.Settings[feishuEnableCardsSetting], false),
			)
			if sendErr != nil {
				if deliveredParts == 0 && isFeishuRetryableSendError(sendErr) {
					return markReplyDeliveryRetryable(sendErr)
				}
				return sendErr
			}
			deliveredParts += 1
		}

		for _, media := range message.Media {
			sendErr := p.sendMediaMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, media)
			if sendErr != nil {
				if deliveredParts == 0 && isFeishuRetryableSendError(sendErr) {
					return markReplyDeliveryRetryable(sendErr)
				}
				return sendErr
			}
			deliveredParts += 1
		}
	}

	return nil
}

func (p *feishuProvider) StartTyping(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (TypingSession, error) {
	domain, token, _, replyMessageID, _, err := p.feishuSendContext(ctx, connection, conversation)
	if err != nil {
		return nil, err
	}
	replyMessageID = strings.TrimSpace(replyMessageID)
	if replyMessageID == "" {
		return nil, nil
	}

	reactionID, reactionErr := p.addFeishuTypingReaction(ctx, domain, token, replyMessageID)
	if reactionErr != nil {
		logBotDebug(ctx, connection, "feishu typing indicator start skipped",
			slog.String("messageId", replyMessageID),
			slog.String("error", reactionErr.Error()),
		)
		return nil, nil
	}
	reactionID = strings.TrimSpace(reactionID)
	if reactionID == "" {
		logBotDebug(ctx, connection, "feishu typing indicator start skipped",
			slog.String("messageId", replyMessageID),
			slog.String("error", "missing reaction id"),
		)
		return nil, nil
	}

	logBotDebug(ctx, connection, "feishu typing indicator started",
		slog.String("messageId", replyMessageID),
		slog.String("reactionId", reactionID),
	)
	return &feishuTypingSession{
		provider:   p,
		domain:     domain,
		token:      token,
		messageID:  replyMessageID,
		reactionID: reactionID,
	}, nil
}

func (p *feishuProvider) StartStreamingReply(
	_ context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (StreamingReplySession, error) {
	appID := strings.TrimSpace(connection.Settings[feishuAppIDSetting])
	if appID == "" {
		return nil, fmt.Errorf("%w: feishu app id is required", ErrInvalidInput)
	}
	appSecret := strings.TrimSpace(connection.Secrets[feishuAppSecretKey])
	if appSecret == "" {
		return nil, fmt.Errorf("%w: feishu app secret is required", ErrInvalidInput)
	}
	if _, err := p.providerDomain(connection); err != nil {
		return nil, err
	}
	chatID := firstNonEmpty(
		strings.TrimSpace(conversation.ExternalChatID),
		strings.TrimSpace(conversation.ProviderState[feishuChatIDKey]),
	)
	if chatID == "" {
		return nil, fmt.Errorf("%w: feishu external chat id is required", ErrInvalidInput)
	}

	return &feishuStreamingReplySession{
		provider:     p,
		connection:   connection,
		conversation: conversation,
		plainTextStrategy: parseFeishuStreamingPlainTextStrategy(
			connection.Settings[feishuStreamingPlainTextStrategySetting],
			feishuStreamingPlainTextStrategyUpdateOnly,
		),
	}, nil
}

func (s *feishuStreamingReplySession) Update(ctx context.Context, update StreamingUpdate) error {
	if s == nil || s.provider == nil {
		return nil
	}

	current := normalizeStreamingMessages(update)
	if len(current) == 0 {
		return nil
	}
	if s.shouldUseFeishuSmartPlainTextStrategy(current) {
		return s.handleFeishuSmartPlainTextUpdate(ctx, current[0].Text, false)
	}
	if s.shouldUseFeishuAppendDeltaPlainTextStrategy(current) {
		return s.handleFeishuAppendDeltaPlainTextUpdate(ctx, current[0].Text)
	}

	s.mu.Lock()
	toSend := nextFeishuStreamingUpdateMessages(s.sentMessages, current)
	if len(toSend) > 0 {
		s.sentMessages = append(cloneOutboundMessages(s.sentMessages), cloneOutboundMessages(toSend)...)
	}
	s.mu.Unlock()

	if len(toSend) == 0 {
		return nil
	}
	return s.sendOrUpdateStreamingMessages(ctx, toSend, false)
}

func (s *feishuStreamingReplySession) Complete(ctx context.Context, messages []OutboundMessage) error {
	if s == nil || s.provider == nil {
		return nil
	}

	finalMessages := cloneOutboundMessages(messages)
	if len(finalMessages) == 0 {
		return nil
	}
	if s.shouldUseFeishuSmartPlainTextStrategy(finalMessages) {
		return s.handleFeishuSmartPlainTextUpdate(ctx, finalMessages[0].Text, true)
	}
	if s.shouldUseFeishuAppendDeltaPlainTextStrategy(finalMessages) {
		return s.handleFeishuAppendDeltaPlainTextUpdate(ctx, finalMessages[0].Text)
	}
	finalMessages = s.trimCommittedFeishuPlainTextPrefix(finalMessages)
	if len(finalMessages) == 0 {
		return nil
	}

	s.mu.Lock()
	toSend := remainingFeishuStreamingMessages(s.sentMessages, finalMessages)
	if len(toSend) > 0 {
		s.sentMessages = append(cloneOutboundMessages(s.sentMessages), cloneOutboundMessages(toSend)...)
	}
	s.mu.Unlock()

	if len(toSend) == 0 {
		return nil
	}
	return s.sendOrUpdateStreamingMessages(ctx, toSend, true)
}

func (s *feishuStreamingReplySession) Fail(ctx context.Context, text string) error {
	if s == nil || s.provider == nil {
		return nil
	}

	text = strings.TrimSpace(text)
	if text == "" {
		text = defaultStreamingFailureText
	}
	return s.sendOrUpdateStreamingMessages(ctx, []OutboundMessage{{Text: text}}, true)
}

func (s *feishuStreamingReplySession) sendOrUpdateStreamingMessages(
	ctx context.Context,
	messages []OutboundMessage,
	final bool,
) error {
	if len(messages) == 0 {
		return nil
	}

	if single, ok := feishuSingleTextMessage(messages); ok {
		return s.sendOrUpdateStreamingSingleText(ctx, single, final)
	}

	return s.provider.SendMessages(ctx, s.connection, s.conversation, messages)
}

func (s *feishuStreamingReplySession) shouldUseFeishuSmartPlainTextStrategy(messages []OutboundMessage) bool {
	if s == nil || s.provider == nil || s.plainTextStrategy != feishuStreamingPlainTextStrategySmartPreserve {
		return false
	}
	text, ok := feishuSingleTextMessage(messages)
	if !ok {
		return false
	}
	return classifyFeishuStreamingText(text) == feishuStreamingTextKindDefault
}

func (s *feishuStreamingReplySession) shouldUseFeishuAppendDeltaPlainTextStrategy(messages []OutboundMessage) bool {
	if s == nil || s.provider == nil || s.plainTextStrategy != feishuStreamingPlainTextStrategyAppendDelta {
		return false
	}
	text, ok := feishuSingleTextMessage(messages)
	if !ok {
		return false
	}
	return classifyFeishuStreamingText(text) == feishuStreamingTextKindDefault
}

func (s *feishuStreamingReplySession) handleFeishuSmartPlainTextUpdate(
	ctx context.Context,
	text string,
	final bool,
) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	s.mu.Lock()
	committedPrefix := s.plainTextCommittedPrefix
	s.mu.Unlock()

	if committedPrefix != "" && !strings.HasPrefix(text, committedPrefix) {
		committedPrefix = ""
	}

	uncommitted := text
	if committedPrefix != "" {
		uncommitted = strings.TrimPrefix(text, committedPrefix)
	}
	if strings.TrimSpace(uncommitted) == "" {
		if final {
			s.mu.Lock()
			s.plainTextCommittedPrefix = text
			s.mu.Unlock()
		}
		return nil
	}

	if !final {
		boundary := findFeishuPlainTextCommitBoundary(uncommitted)
		if boundary <= 0 {
			return nil
		}
		committedChunk := uncommitted[:boundary]
		if err := s.provider.SendMessages(ctx, s.connection, s.conversation, []OutboundMessage{{
			Text: strings.TrimSpace(committedChunk),
		}}); err != nil {
			return err
		}
		s.mu.Lock()
		s.plainTextCommittedPrefix = committedPrefix + committedChunk
		s.mu.Unlock()
		return nil
	}

	if err := s.provider.SendMessages(ctx, s.connection, s.conversation, []OutboundMessage{{
		Text: strings.TrimSpace(uncommitted),
	}}); err != nil {
		return err
	}
	s.mu.Lock()
	s.plainTextCommittedPrefix = text
	s.mu.Unlock()
	return nil
}

func (s *feishuStreamingReplySession) handleFeishuAppendDeltaPlainTextUpdate(
	ctx context.Context,
	text string,
) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	s.mu.Lock()
	committedPrefix := s.plainTextCommittedPrefix
	s.mu.Unlock()

	uncommitted := text
	if committedPrefix != "" && strings.HasPrefix(text, committedPrefix) {
		uncommitted = strings.TrimPrefix(text, committedPrefix)
	}
	if strings.TrimSpace(uncommitted) == "" {
		s.mu.Lock()
		s.plainTextCommittedPrefix = text
		s.mu.Unlock()
		return nil
	}

	if err := s.provider.SendMessages(ctx, s.connection, s.conversation, []OutboundMessage{{
		Text: strings.TrimSpace(uncommitted),
	}}); err != nil {
		return err
	}
	s.mu.Lock()
	s.plainTextCommittedPrefix = text
	s.mu.Unlock()
	return nil
}

func (s *feishuStreamingReplySession) trimCommittedFeishuPlainTextPrefix(messages []OutboundMessage) []OutboundMessage {
	if s == nil {
		return cloneOutboundMessages(messages)
	}
	s.mu.Lock()
	committedPrefix := s.plainTextCommittedPrefix
	s.mu.Unlock()
	if committedPrefix == "" || len(messages) == 0 {
		return cloneOutboundMessages(messages)
	}

	cloned := cloneOutboundMessages(messages)
	firstText := strings.TrimSpace(cloned[0].Text)
	if firstText == "" || !strings.HasPrefix(firstText, committedPrefix) {
		return cloned
	}

	cloned[0].Text = strings.TrimSpace(strings.TrimPrefix(firstText, committedPrefix))
	if outboundMessageHasContent(cloned[0]) {
		return cloned
	}
	if len(cloned) == 1 {
		return nil
	}
	return cloned[1:]
}

func (s *feishuStreamingReplySession) sendOrUpdateStreamingSingleText(
	ctx context.Context,
	text string,
	final bool,
) error {
	domain, token, chatID, replyMessageID, replyInThread, err := s.provider.feishuSendContext(ctx, s.connection, s.conversation)
	if err != nil {
		return err
	}
	text = strings.TrimSpace(text)
	textKind := classifyFeishuStreamingText(text)

	s.mu.Lock()
	streamMessageID := strings.TrimSpace(s.streamMessageID)
	lastText := strings.TrimSpace(s.streamMessageText)
	streamMessageKind := s.streamMessageKind
	s.mu.Unlock()

	if shouldStartNewFeishuStreamingMessage(streamMessageID != "", streamMessageKind, textKind, final) {
		return s.sendFreshStreamingSingleText(ctx, domain, token, chatID, replyMessageID, replyInThread, text, textKind)
	}

	payload := feishuBuildStreamingPayload(text)
	if streamMessageID != "" {
		if lastText == text {
			return nil
		}
		if err := s.provider.updateFeishuMessage(ctx, domain, token, streamMessageID, payload); err == nil {
			s.mu.Lock()
			s.streamPayload = &payload
			s.streamMessageText = text
			s.streamMessageKind = textKind
			s.mu.Unlock()
			return nil
		} else if isFeishuCardContentLimitError(err) {
			textPayload := feishuSendPayload{
				Content: feishuTextMessageContent(text),
				MsgType: "text",
			}
			if updateErr := s.provider.updateFeishuMessage(ctx, domain, token, streamMessageID, textPayload); updateErr == nil {
				s.mu.Lock()
				s.streamPayload = &textPayload
				s.streamMessageText = text
				s.streamMessageKind = textKind
				s.mu.Unlock()
				return nil
			}
		}
	}

	return s.sendFreshStreamingSingleText(ctx, domain, token, chatID, replyMessageID, replyInThread, text, textKind)
}

func (s *feishuStreamingReplySession) sendFreshStreamingSingleText(
	ctx context.Context,
	domain string,
	token string,
	chatID string,
	replyMessageID string,
	replyInThread bool,
	text string,
	textKind feishuStreamingTextKind,
) error {
	response, err := s.provider.sendFeishuStreamingTextMessage(
		ctx,
		s.connection,
		domain,
		token,
		chatID,
		replyMessageID,
		replyInThread,
		text,
	)
	if err != nil {
		return err
	}

	s.mu.Lock()
	if textKind == feishuStreamingTextKindActionRequired {
		s.streamMessageID = ""
		s.streamPayload = nil
		s.streamMessageText = ""
		s.streamMessageKind = ""
	} else {
		payload := feishuBuildStreamingPayload(text)
		s.streamMessageID = strings.TrimSpace(response.Data.MessageID)
		s.streamPayload = &payload
		s.streamMessageText = text
		s.streamMessageKind = textKind
	}
	s.mu.Unlock()
	return nil
}

func feishuSingleTextMessage(messages []OutboundMessage) (string, bool) {
	if len(messages) != 1 {
		return "", false
	}
	message := messages[0]
	if len(message.Media) > 0 {
		return "", false
	}
	text := strings.TrimSpace(message.Text)
	if text == "" {
		return "", false
	}
	return text, true
}

func nextFeishuStreamingUpdateMessages(sent []OutboundMessage, current []OutboundMessage) []OutboundMessage {
	if len(current) == 0 {
		return nil
	}

	toSend := make([]OutboundMessage, 0, len(current))
	commonPrefix := outboundMessageCommonPrefixLen(sent, current)
	start := len(sent)
	if commonPrefix < len(sent) {
		start = len(current)
	}
	if start < len(current)-1 {
		toSend = append(toSend, cloneOutboundMessages(current[start:len(current)-1])...)
	}

	tail := current[len(current)-1]
	if shouldEmitFeishuStreamingTail(tail) {
		if len(sent) == 0 || !equalOutboundMessage(sent[len(sent)-1], tail) {
			if len(toSend) == 0 || !equalOutboundMessage(toSend[len(toSend)-1], tail) {
				toSend = append(toSend, cloneOutboundMessage(tail))
			}
		}
	}

	return toSend
}

func remainingFeishuStreamingMessages(sent []OutboundMessage, final []OutboundMessage) []OutboundMessage {
	if len(final) == 0 {
		return nil
	}

	commonPrefix := outboundMessageCommonPrefixLen(sent, final)
	if commonPrefix >= len(final) {
		return nil
	}
	return cloneOutboundMessages(final[commonPrefix:])
}

func shouldEmitFeishuStreamingTail(message OutboundMessage) bool {
	text := strings.TrimSpace(message.Text)
	if text == "" || len(message.Media) > 0 {
		return false
	}
	return classifyFeishuStreamingText(text) != feishuStreamingTextKindDefault
}

func classifyFeishuStreamingText(text string) feishuStreamingTextKind {
	text = strings.TrimSpace(text)
	switch {
	case looksLikeFeishuActionRequiredText(text):
		return feishuStreamingTextKindActionRequired
	case looksLikeFeishuStatusText(text):
		return feishuStreamingTextKindStatus
	case looksLikeFeishuToolProgressText(text):
		return feishuStreamingTextKindToolProgress
	default:
		return feishuStreamingTextKindDefault
	}
}

func findFeishuPlainTextCommitBoundary(text string) int {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	if strings.TrimSpace(text) == "" {
		return 0
	}

	if boundary := lastFeishuPlainTextBlankLineBoundary(text); boundary > 0 {
		return boundary
	}
	if boundary := lastFeishuPlainTextSentenceBoundary(text); boundary > 0 &&
		utf8.RuneCountInString(strings.TrimSpace(text[:boundary])) >= 160 {
		return boundary
	}
	if boundary := lastFeishuPlainTextLineBoundary(text); boundary > 0 &&
		utf8.RuneCountInString(strings.TrimSpace(text[:boundary])) >= 240 {
		return boundary
	}
	return 0
}

func lastFeishuPlainTextBlankLineBoundary(text string) int {
	index := strings.LastIndex(text, "\n\n")
	if index < 0 {
		return 0
	}
	boundary := index + len("\n\n")
	if strings.TrimSpace(text[:boundary]) == "" {
		return 0
	}
	return boundary
}

func lastFeishuPlainTextLineBoundary(text string) int {
	index := strings.LastIndex(text, "\n")
	if index < 0 {
		return 0
	}
	boundary := index + 1
	if boundary >= len(text) || strings.TrimSpace(text[:boundary]) == "" {
		return 0
	}
	return boundary
}

func lastFeishuPlainTextSentenceBoundary(text string) int {
	boundary := 0
	for index, char := range text {
		if !isFeishuSentenceBoundaryRune(char) {
			continue
		}
		next := index + utf8.RuneLen(char)
		if next >= len(text) {
			boundary = next
			continue
		}
		nextRune, _ := utf8.DecodeRuneInString(text[next:])
		if unicode.IsSpace(nextRune) {
			boundary = next
		}
	}
	return boundary
}

func isFeishuSentenceBoundaryRune(char rune) bool {
	switch char {
	case '.', '!', '?', '。', '！', '？':
		return true
	default:
		return false
	}
}

func looksLikeFeishuActionRequiredText(text string) bool {
	text = strings.TrimSpace(text)
	return strings.Contains(text, "Request ID:") ||
		strings.HasPrefix(text, "Command Approval:") ||
		strings.Contains(text, "/approve ") ||
		strings.Contains(text, "/decline ")
}

func looksLikeFeishuToolProgressText(text string) bool {
	text = strings.TrimSpace(text)
	return strings.HasPrefix(text, "Feishu Sheet ·") ||
		strings.HasPrefix(text, "Feishu Base ·") ||
		strings.HasPrefix(text, "Feishu Tool:")
}

func looksLikeFeishuStatusText(text string) bool {
	text = strings.TrimSpace(text)
	return strings.HasPrefix(text, "Plan:\n") || strings.HasPrefix(text, "Plan Status:")
}

func shouldStartNewFeishuStreamingMessage(
	hasActiveMessage bool,
	activeKind feishuStreamingTextKind,
	nextKind feishuStreamingTextKind,
	final bool,
) bool {
	if nextKind == feishuStreamingTextKindActionRequired {
		return true
	}
	if !hasActiveMessage {
		return false
	}
	if final && activeKind != feishuStreamingTextKindDefault {
		return true
	}
	if activeKind != nextKind && (activeKind != feishuStreamingTextKindDefault || nextKind != feishuStreamingTextKindDefault) {
		return true
	}
	return false
}

func outboundMessageCommonPrefixLen(left []OutboundMessage, right []OutboundMessage) int {
	limit := len(left)
	if len(right) < limit {
		limit = len(right)
	}
	for index := 0; index < limit; index++ {
		if !equalOutboundMessage(left[index], right[index]) {
			return index
		}
	}
	return limit
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

	switch strings.TrimSpace(envelope.Header.EventType) {
	case "im.message.receive_v1":
		var messageEnvelope feishuMessageEventEnvelope
		if err := json.Unmarshal(payload, &messageEnvelope); err != nil {
			return InboundMessage{}, fmt.Errorf("%w: decode feishu message event: %s", ErrInvalidInput, err.Error())
		}
		return p.inboundMessageFromFeishuEvent(connection, messageEnvelope)
	case "approval.approval.updated_v4":
		var approvalEnvelope feishuApprovalUpdatedEventEnvelope
		if err := json.Unmarshal(payload, &approvalEnvelope); err != nil {
			return InboundMessage{}, fmt.Errorf("%w: decode feishu approval updated event: %s", ErrInvalidInput, err.Error())
		}
		return inboundMessageFromFeishuApprovalUpdatedEvent(approvalEnvelope), nil
	}

	if strings.EqualFold(strings.TrimSpace(envelope.Type), "event_callback") {
		var approvalInstanceEnvelope feishuApprovalInstanceEnvelope
		if err := json.Unmarshal(payload, &approvalInstanceEnvelope); err != nil {
			return InboundMessage{}, fmt.Errorf("%w: decode feishu approval callback: %s", ErrInvalidInput, err.Error())
		}
		if strings.TrimSpace(approvalInstanceEnvelope.Event.Type) == "approval_instance" {
			return inboundMessageFromFeishuApprovalInstanceEvent(approvalInstanceEnvelope), nil
		}
	}

	return InboundMessage{}, ErrWebhookIgnored
}

func (p *feishuProvider) inboundMessageFromFeishuEvent(
	connection store.BotConnection,
	envelope feishuMessageEventEnvelope,
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
	var media []store.BotMessageMedia
	var err error
	switch strings.TrimSpace(message.MessageType) {
	case "text":
		text, err = extractFeishuTextContent(message.Content, message.Mentions, botOpenID)
	case "image":
		media, err = p.extractInboundFeishuImage(context.Background(), connection, messageID, message.Content)
	case "audio":
		media, err = p.extractInboundFeishuAudio(context.Background(), connection, messageID, message.Content)
	case "file":
		media, err = p.extractInboundFeishuFile(context.Background(), connection, messageID, message.Content)
	case "post":
		text, media, err = p.extractFeishuPostText(context.Background(), connection, messageID, message.Content, message.Mentions, botOpenID)
	default:
		return InboundMessage{}, ErrWebhookIgnored
	}
	if err != nil {
		return InboundMessage{}, err
	}
	if strings.TrimSpace(text) == "" && len(media) == 0 {
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
		Media:            media,
		ProviderData:     providerData,
	}, nil
}

func inboundMessageFromFeishuApprovalUpdatedEvent(envelope feishuApprovalUpdatedEventEnvelope) InboundMessage {
	eventType := strings.TrimSpace(envelope.Header.EventType)
	object := envelope.Event.Object
	approvalCode := strings.TrimSpace(object.ApprovalCode)
	approvalID := strings.TrimSpace(object.ApprovalID)
	versionID := strings.TrimSpace(object.VersionID)
	timestamp := strings.TrimSpace(string(object.Timestamp))
	formDefinitionID := strings.TrimSpace(object.FormDefinitionID)
	messageID := firstNonEmpty(
		strings.TrimSpace(envelope.Header.EventID),
		firstNonEmpty(versionID, approvalID, approvalCode)+"@"+timestamp,
	)

	lines := make([]string, 0, 6)
	lines = append(lines, "Feishu approval definition updated")
	if approvalCode != "" {
		lines = append(lines, "Approval Code: "+approvalCode)
	}
	if approvalID != "" {
		lines = append(lines, "Approval ID: "+approvalID)
	}
	if versionID != "" {
		lines = append(lines, "Version ID: "+versionID)
	}
	if timestamp != "" {
		lines = append(lines, "Timestamp: "+timestamp)
	}
	if formDefinitionID != "" {
		lines = append(lines, "Form Definition ID: "+formDefinitionID)
	}

	return InboundMessage{
		ConversationID:   feishuApprovalDefinitionConversationID(approvalCode, approvalID),
		ExternalChatID:   feishuApprovalDefinitionChatID(approvalCode),
		ExternalThreadID: firstNonEmpty(approvalID, versionID),
		MessageID:        messageID,
		UserID:           firstNonEmpty(strings.TrimSpace(envelope.Header.AppID), "approval.approval.updated_v4"),
		Username:         "Feishu Approval",
		Title:            firstNonEmpty(strings.TrimSpace("Feishu Approval "+approvalCode), "Feishu Approval Definition"),
		Text:             strings.TrimSpace(strings.Join(lines, "\n")),
		ProviderData: map[string]string{
			feishuEventTypeKey:         eventType,
			feishuApprovalCodeKey:      approvalCode,
			feishuApprovalIDKey:        approvalID,
			feishuApprovalVersionIDKey: versionID,
			feishuApprovalTimestampKey: timestamp,
		},
	}
}

func inboundMessageFromFeishuApprovalInstanceEvent(envelope feishuApprovalInstanceEnvelope) InboundMessage {
	event := envelope.Event
	eventType := strings.TrimSpace(event.Type)
	approvalCode := strings.TrimSpace(event.ApprovalCode)
	instanceCode := strings.TrimSpace(event.InstanceCode)
	status := strings.TrimSpace(event.Status)
	operateTime := strings.TrimSpace(string(event.OperateTime))
	instanceOperateTime := strings.TrimSpace(string(event.InstanceOperateTime))
	eventUUID := firstNonEmpty(strings.TrimSpace(event.UUID), strings.TrimSpace(envelope.UUID))
	messageID := firstNonEmpty(eventUUID, instanceCode+"@"+operateTime)

	lines := make([]string, 0, 7)
	lines = append(lines, "Feishu approval instance status changed")
	if approvalCode != "" {
		lines = append(lines, "Approval Code: "+approvalCode)
	}
	if instanceCode != "" {
		lines = append(lines, "Instance Code: "+instanceCode)
	}
	if status != "" {
		lines = append(lines, "Status: "+status)
	}
	if operateTime != "" {
		lines = append(lines, "Operate Time: "+operateTime)
	}
	if instanceOperateTime != "" && instanceOperateTime != operateTime {
		lines = append(lines, "Instance Operate Time: "+instanceOperateTime)
	}
	if eventUUID != "" {
		lines = append(lines, "Event UUID: "+eventUUID)
	}

	return InboundMessage{
		ConversationID:   feishuApprovalInstanceConversationID(approvalCode, instanceCode),
		ExternalChatID:   feishuApprovalInstanceChatID(approvalCode),
		ExternalThreadID: instanceCode,
		MessageID:        messageID,
		UserID:           firstNonEmpty(strings.TrimSpace(event.AppID), "approval_instance"),
		Username:         "Feishu Approval",
		Title:            firstNonEmpty(strings.TrimSpace("Feishu Approval "+approvalCode), "Feishu Approval Instance"),
		Text:             strings.TrimSpace(strings.Join(lines, "\n")),
		ProviderData: map[string]string{
			feishuEventTypeKey:            eventType,
			feishuApprovalCodeKey:         approvalCode,
			feishuApprovalInstanceCodeKey: instanceCode,
			feishuApprovalStatusKey:       status,
			feishuApprovalEventUUIDKey:    eventUUID,
			feishuApprovalOperateTimeKey:  operateTime,
		},
	}
}

func feishuApprovalDefinitionConversationID(approvalCode string, approvalID string) string {
	base := firstNonEmpty(strings.TrimSpace(approvalCode), strings.TrimSpace(approvalID), "unknown")
	return "approval-definition:" + base
}

func feishuApprovalDefinitionChatID(approvalCode string) string {
	base := firstNonEmpty(strings.TrimSpace(approvalCode), "approval-definition")
	return "approval-definition:" + base
}

func feishuApprovalInstanceConversationID(approvalCode string, instanceCode string) string {
	baseCode := firstNonEmpty(strings.TrimSpace(approvalCode), "unknown")
	baseInstance := firstNonEmpty(strings.TrimSpace(instanceCode), "instance")
	return "approval:" + baseCode + ":instance:" + baseInstance
}

func feishuApprovalInstanceChatID(approvalCode string) string {
	base := firstNonEmpty(strings.TrimSpace(approvalCode), "approval")
	return "approval:" + base
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

func (p *feishuProvider) extractFeishuPostText(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	raw string,
	mentions []feishuMention,
	botOpenID string,
) (string, []store.BotMessageMedia, error) {
	var flat feishuPostContent
	if err := json.Unmarshal([]byte(raw), &flat); err == nil && len(flat.Content) > 0 {
		return p.feishuPostText(ctx, connection, messageID, flat, mentions, botOpenID)
	}

	var languageMap map[string]feishuPostContent
	if err := json.Unmarshal([]byte(raw), &languageMap); err != nil {
		return "", nil, fmt.Errorf("%w: decode feishu post content: %s", ErrInvalidInput, err.Error())
	}
	for _, content := range languageMap {
		return p.feishuPostText(ctx, connection, messageID, content, mentions, botOpenID)
	}
	return "", nil, nil
}

func (p *feishuProvider) feishuPostText(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	content feishuPostContent,
	mentions []feishuMention,
	botOpenID string,
) (string, []store.BotMessageMedia, error) {
	lines := make([]string, 0, len(content.Content)+1)
	media := make([]store.BotMessageMedia, 0)
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
			case "img":
				if strings.TrimSpace(item.ImageKey) == "" {
					continue
				}
				imageMedia, err := p.downloadInboundFeishuImageByKey(ctx, connection, messageID, strings.TrimSpace(item.ImageKey), "")
				if err != nil {
					return "", nil, err
				}
				media = append(media, imageMedia)
			}
		}
		if len(parts) > 0 {
			lines = append(lines, strings.Join(parts, " "))
		}
	}
	text := stripFeishuMentions(strings.Join(lines, "\n"), mentions, botOpenID)
	return html.UnescapeString(strings.TrimSpace(text)), media, nil
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

func feishuBuildStreamingPayload(text string) feishuSendPayload {
	return feishuSendPayload{
		Content: buildFeishuUpdatableCardJSON(text),
		MsgType: "interactive",
	}
}

func (p *feishuProvider) sendFeishuTextMessage(
	ctx context.Context,
	connection store.BotConnection,
	domain string,
	token string,
	chatID string,
	replyMessageID string,
	replyInThread bool,
	text string,
	useCard bool,
) (feishuSendMessageResponse, error) {
	payload := feishuBuildSendPayload(text, useCard)
	response, err := p.sendFeishuMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, payload)
	if err == nil || !useCard || !isFeishuCardContentLimitError(err) {
		return response, err
	}
	return p.sendFeishuMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, feishuSendPayload{
		Content: feishuTextMessageContent(text),
		MsgType: "text",
	})
}

func (p *feishuProvider) sendFeishuStreamingTextMessage(
	ctx context.Context,
	connection store.BotConnection,
	domain string,
	token string,
	chatID string,
	replyMessageID string,
	replyInThread bool,
	text string,
) (feishuSendMessageResponse, error) {
	payload := feishuBuildStreamingPayload(text)
	response, err := p.sendFeishuMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, payload)
	if err == nil || !isFeishuCardContentLimitError(err) {
		return response, err
	}
	return p.sendFeishuMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, feishuSendPayload{
		Content: feishuTextMessageContent(text),
		MsgType: "text",
	})
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
					"content": sanitizeFeishuCardMarkdown(content),
				},
			},
		},
	}
	data, _ := json.Marshal(card)
	return string(data)
}

func buildFeishuUpdatableCardJSON(content string) string {
	card := map[string]any{
		"schema": "2.0",
		"config": map[string]any{
			"wide_screen_mode": true,
			"update_multi":     true,
		},
		"body": map[string]any{
			"elements": []map[string]any{
				{
					"tag":     "markdown",
					"content": sanitizeFeishuCardMarkdown(content),
				},
			},
		},
	}
	data, _ := json.Marshal(card)
	return string(data)
}

func sanitizeFeishuCardMarkdown(content string) string {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}

	lines := strings.Split(content, "\n")
	sanitized := make([]string, 0, len(lines))
	inFence := false
	for index := 0; index < len(lines); index++ {
		line := strings.TrimRight(lines[index], " \t")
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inFence = !inFence
			sanitized = append(sanitized, line)
			continue
		}
		if inFence || !isFeishuMarkdownTableStart(lines, index) {
			sanitized = append(sanitized, line)
			continue
		}

		tableLines := []string{
			strings.TrimRight(lines[index], " \t"),
			strings.TrimRight(lines[index+1], " \t"),
		}
		index += 2
		for index < len(lines) && isFeishuMarkdownTableRow(lines[index]) {
			tableLines = append(tableLines, strings.TrimRight(lines[index], " \t"))
			index++
		}
		index--

		sanitized = append(sanitized, "```text", strings.Join(tableLines, "\n"), "```")
	}
	return strings.TrimSpace(strings.Join(sanitized, "\n"))
}

func isFeishuMarkdownTableStart(lines []string, index int) bool {
	return index+1 < len(lines) &&
		isFeishuMarkdownTableRow(lines[index]) &&
		isFeishuMarkdownTableSeparator(lines[index+1])
}

func isFeishuMarkdownTableRow(line string) bool {
	trimmed := strings.TrimSpace(line)
	return strings.HasPrefix(trimmed, "|") &&
		strings.HasSuffix(trimmed, "|") &&
		strings.Count(trimmed, "|") >= 2
}

func isFeishuMarkdownTableSeparator(line string) bool {
	if !isFeishuMarkdownTableRow(line) {
		return false
	}
	parts := strings.Split(strings.TrimSpace(line), "|")
	cellCount := 0
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		if strings.Trim(trimmed, "-: ") != "" {
			return false
		}
		cellCount++
	}
	return cellCount > 0
}

func (p *feishuProvider) feishuSendContext(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (domain string, token string, chatID string, replyMessageID string, replyInThread bool, err error) {
	appID := strings.TrimSpace(connection.Settings[feishuAppIDSetting])
	if appID == "" {
		err = fmt.Errorf("%w: feishu app id is required", ErrInvalidInput)
		return
	}
	appSecret := strings.TrimSpace(connection.Secrets[feishuAppSecretKey])
	if appSecret == "" {
		err = fmt.Errorf("%w: feishu app secret is required", ErrInvalidInput)
		return
	}
	domain, err = p.providerDomain(connection)
	if err != nil {
		return
	}
	chatID = firstNonEmpty(strings.TrimSpace(conversation.ExternalChatID), strings.TrimSpace(conversation.ProviderState[feishuChatIDKey]))
	if chatID == "" {
		err = fmt.Errorf("%w: feishu external chat id is required", ErrInvalidInput)
		return
	}
	token, err = p.tenantAccessToken(ctx, domain, appID, appSecret)
	if err != nil {
		return
	}
	replyMessageID = strings.TrimSpace(conversation.ProviderState[feishuMessageIDKey])
	replyInThread = shouldFeishuReplyInThread(connection, conversation)
	return
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
) (feishuSendMessageResponse, error) {
	if replyMessageID != "" {
		response, sendErr := p.sendFeishuReply(ctx, domain, token, replyMessageID, payload, replyInThread)
		if sendErr != nil && shouldFeishuFallbackToCreate(sendErr) {
			logBotDebug(ctx, connection, "feishu reply failed; falling back to chat send",
				slog.String("replyMessageId", replyMessageID),
				slog.String("error", sendErr.Error()),
			)
			response, sendErr = p.sendFeishuCreate(ctx, domain, token, chatID, payload)
		}
		return response, sendErr
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
) (feishuSendMessageResponse, error) {
	response := feishuSendMessageResponse{}
	body := map[string]any{
		"content":  payload.Content,
		"msg_type": payload.MsgType,
	}
	if replyInThread {
		body["reply_in_thread"] = true
	}
	err := p.callJSON(ctx, http.MethodPost, domain, "/open-apis/im/v1/messages/"+url.PathEscape(strings.TrimSpace(messageID))+"/reply", token, body, &response)
	return response, err
}

func (p *feishuProvider) sendFeishuCreate(
	ctx context.Context,
	domain string,
	token string,
	chatID string,
	payload feishuSendPayload,
) (feishuSendMessageResponse, error) {
	response := feishuSendMessageResponse{}
	err := p.callJSON(ctx, http.MethodPost, domain, "/open-apis/im/v1/messages?receive_id_type=chat_id", token, map[string]any{
		"receive_id": strings.TrimSpace(chatID),
		"content":    payload.Content,
		"msg_type":   payload.MsgType,
	}, &response)
	return response, err
}

func (p *feishuProvider) addFeishuTypingReaction(
	ctx context.Context,
	domain string,
	token string,
	messageID string,
) (string, error) {
	response := feishuMessageReactionResponse{}
	err := p.callJSON(
		ctx,
		http.MethodPost,
		domain,
		"/open-apis/im/v1/messages/"+url.PathEscape(strings.TrimSpace(messageID))+"/reactions",
		token,
		map[string]any{
			"reaction_type": map[string]any{
				"emoji_type": feishuTypingReactionEmojiType,
			},
		},
		&response,
	)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(response.Data.ReactionID), nil
}

func (p *feishuProvider) removeFeishuTypingReaction(
	ctx context.Context,
	domain string,
	token string,
	messageID string,
	reactionID string,
) error {
	return p.callJSON(
		ctx,
		http.MethodDelete,
		domain,
		"/open-apis/im/v1/messages/"+url.PathEscape(strings.TrimSpace(messageID))+"/reactions/"+url.PathEscape(strings.TrimSpace(reactionID)),
		token,
		nil,
		&feishuMessageReactionResponse{},
	)
}

func (s *feishuTypingSession) Stop(ctx context.Context) error {
	if s == nil || s.provider == nil || strings.TrimSpace(s.reactionID) == "" {
		return nil
	}
	if err := s.provider.removeFeishuTypingReaction(ctx, s.domain, s.token, s.messageID, s.reactionID); err != nil {
		return err
	}
	return nil
}

func (p *feishuProvider) updateFeishuMessage(
	ctx context.Context,
	domain string,
	token string,
	messageID string,
	payload feishuSendPayload,
) error {
	body := map[string]any{
		"content": payload.Content,
	}
	method := http.MethodPatch
	requestPath := "/open-apis/im/v1/messages/" + url.PathEscape(strings.TrimSpace(messageID))
	if payload.MsgType != "interactive" {
		method = http.MethodPut
		body["msg_type"] = payload.MsgType
	}
	return p.callJSON(ctx, method, domain, requestPath, token, body, &feishuSendMessageResponse{})
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

func parseFeishuStreamingPlainTextStrategy(value string, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case feishuStreamingPlainTextStrategyUpdateOnly:
		return feishuStreamingPlainTextStrategyUpdateOnly
	case feishuStreamingPlainTextStrategySmartPreserve:
		return feishuStreamingPlainTextStrategySmartPreserve
	case feishuStreamingPlainTextStrategyAppendDelta:
		return feishuStreamingPlainTextStrategyAppendDelta
	default:
		return fallback
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

func isFeishuCardContentLimitError(err error) bool {
	var requestErr *feishuRequestError
	if !errors.As(err, &requestErr) || requestErr == nil || requestErr.cause != nil {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(requestErr.apiMsg))
	return strings.Contains(message, "failed to create card content") ||
		strings.Contains(message, "card table number over limit")
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
func (r feishuMessageReactionResponse) responseCode() int         { return r.Code }
func (r feishuMessageReactionResponse) responseMessage() string   { return r.Msg }

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
