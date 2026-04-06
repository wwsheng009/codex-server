package bots

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/store"
)

const (
	wechatProviderName          = "wechat"
	wechatDeliveryModeSetting   = "wechat_delivery_mode"
	wechatDeliveryModePolling   = "polling"
	wechatBaseURLSetting        = "wechat_base_url"
	wechatCDNBaseURLSetting     = "wechat_cdn_base_url"
	wechatRouteTagSetting       = "wechat_route_tag"
	wechatLoginSessionIDSetting = "wechat_login_session_id"
	wechatSavedAccountIDSetting = "wechat_saved_account_id"
	wechatAccountIDSetting      = "wechat_account_id"
	wechatOwnerUserIDSetting    = "wechat_owner_user_id"
	wechatSyncBufSetting        = "wechat_sync_buf"
	wechatContextTokenKey       = "wechat_context_token"
	wechatSessionIDKey          = "wechat_session_id"
	wechatSenderNameKey         = "wechat_sender_name"
	wechatCreatedAtMSKey        = "wechat_created_at_ms"
	wechatAppIDHeader           = "bot"
	wechatChannelVersion        = "0.3.0"
	wechatDefaultHTTPTimeout    = 15 * time.Second
	wechatConfigHTTPTimeout     = 10 * time.Second
	wechatTypingKeepaliveDelay  = 5 * time.Second
	wechatTypingConfigTTL       = 24 * time.Hour
	wechatDefaultCDNBaseURL     = "https://novac2c.cdn.weixin.qq.com/c2c"
	wechatLongPollTimeoutBuf    = 5 * time.Second
	wechatMessageTypeUser       = 1
	wechatMessageTypeBot        = 2
	wechatMessageStateComplete  = 2
	wechatTypingStatusTyping    = 1
	wechatTypingStatusCancel    = 2
	wechatItemTypeText          = 1
	wechatItemTypeImage         = 2
	wechatItemTypeVoice         = 3
	wechatItemTypeFile          = 4
	wechatItemTypeVideo         = 5
	wechatUploadMediaTypeImage  = 1
	wechatUploadMediaTypeVideo  = 2
	wechatUploadMediaTypeFile   = 3
	wechatSessionExpiredErrCode = -14
)

var (
	wechatClientVersionHeader    = strconv.FormatUint(uint64(buildWeChatClientVersion(wechatChannelVersion)), 10)
	wechatDefaultLongPollTimeout = 35 * time.Second
	wechatSessionPauseDuration   = time.Hour
)

type wechatProvider struct {
	clients httpClientSource

	typingMu    sync.Mutex
	typingCache map[string]wechatTypingConfigCacheEntry

	sessionMu          sync.Mutex
	sessionPausedUntil map[string]time.Time
}

type wechatAPIResponse struct {
	Ret     int    `json:"ret"`
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
}

type wechatGetUpdatesResponse struct {
	wechatAPIResponse
	Msgs          []wechatMessage `json:"msgs"`
	GetUpdatesBuf string          `json:"get_updates_buf"`
	LongPollMS    int             `json:"longpolling_timeout_ms"`
}

type wechatGetConfigResponse struct {
	wechatAPIResponse
	TypingTicket string `json:"typing_ticket"`
}

type wechatTypingConfigCacheEntry struct {
	typingTicket string
	expiresAt    time.Time
}

type wechatFlexibleString string

type wechatMessage struct {
	FromUserID   string               `json:"from_user_id"`
	ToUserID     string               `json:"to_user_id"`
	ClientID     string               `json:"client_id"`
	SessionID    string               `json:"session_id"`
	MessageType  int                  `json:"message_type"`
	MessageState int                  `json:"message_state"`
	ItemList     []wechatMessageItem  `json:"item_list"`
	ContextToken string               `json:"context_token"`
	CreateTimeMS wechatFlexibleString `json:"create_time_ms"`
}

type wechatMessageItem struct {
	Type      int                     `json:"type"`
	TextItem  *wechatTextItem         `json:"text_item"`
	ImageItem *wechatImageItem        `json:"image_item"`
	VoiceItem *wechatVoiceItem        `json:"voice_item"`
	FileItem  *wechatFileItem         `json:"file_item"`
	VideoItem *wechatVideoItem        `json:"video_item"`
	RefMsg    *wechatReferenceMessage `json:"ref_msg"`
}

type wechatTextItem struct {
	Text   string                  `json:"text"`
	RefMsg *wechatReferenceMessage `json:"ref_msg"`
}

type wechatCDNMedia struct {
	EncryptQueryParam string `json:"encrypt_query_param"`
	AESKey            string `json:"aes_key"`
	EncryptType       int    `json:"encrypt_type"`
	FullURL           string `json:"full_url"`
}

type wechatImageItem struct {
	Media      *wechatCDNMedia `json:"media"`
	ThumbMedia *wechatCDNMedia `json:"thumb_media"`
	AESKeyHex  string          `json:"aeskey"`
	URL        string          `json:"url"`
	MidSize    int64           `json:"mid_size"`
}

type wechatVoiceItem struct {
	Media      *wechatCDNMedia `json:"media"`
	Text       string          `json:"text"`
	EncodeType int             `json:"encode_type"`
}

type wechatFileItem struct {
	Media    *wechatCDNMedia `json:"media"`
	FileName string          `json:"file_name"`
	Len      string          `json:"len"`
}

type wechatVideoItem struct {
	Media      *wechatCDNMedia `json:"media"`
	ThumbMedia *wechatCDNMedia `json:"thumb_media"`
	VideoSize  int64           `json:"video_size"`
}

type wechatReferenceMessage struct {
	Text        string             `json:"text"`
	Title       string             `json:"title"`
	MessageItem *wechatMessageItem `json:"message_item"`
}

type wechatSendMessageRequest struct {
	Msg      wechatOutboundMessage `json:"msg"`
	BaseInfo wechatBaseInfo        `json:"base_info"`
}

type wechatOutboundMessage struct {
	FromUserID   string              `json:"from_user_id"`
	ToUserID     string              `json:"to_user_id"`
	ClientID     string              `json:"client_id"`
	MessageType  int                 `json:"message_type"`
	MessageState int                 `json:"message_state"`
	ItemList     []wechatMessageItem `json:"item_list"`
	ContextToken string              `json:"context_token"`
}

type wechatBaseInfo struct {
	ChannelVersion string `json:"channel_version"`
}

type wechatRequestError struct {
	method      string
	statusCode  int
	status      string
	description string
	cause       error
}

func (e *wechatRequestError) Error() string {
	if e == nil {
		return ""
	}
	if e.cause != nil {
		return fmt.Sprintf("wechat %s request failed: %v", e.method, e.cause)
	}

	detail := strings.TrimSpace(e.description)
	switch {
	case e.status != "" && detail != "":
		return fmt.Sprintf("wechat %s returned %s: %s", e.method, e.status, detail)
	case e.status != "":
		return fmt.Sprintf("wechat %s returned %s", e.method, e.status)
	case detail != "":
		return fmt.Sprintf("wechat %s api error: %s", e.method, detail)
	default:
		return fmt.Sprintf("wechat %s request failed", e.method)
	}
}

func (e *wechatRequestError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func (v *wechatFlexibleString) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	switch trimmed {
	case "", "null":
		*v = ""
		return nil
	}

	if strings.HasPrefix(trimmed, `"`) {
		var value string
		if err := json.Unmarshal(data, &value); err != nil {
			return err
		}
		*v = wechatFlexibleString(value)
		return nil
	}

	*v = wechatFlexibleString(trimmed)
	return nil
}

func (v wechatFlexibleString) String() string {
	return string(v)
}

func newWeChatProvider(client *http.Client) Provider {
	return newWeChatProviderWithClientSource(staticHTTPClientSource{client: client})
}

func newWeChatProviderWithClientSource(clients httpClientSource) Provider {
	if clients == nil {
		clients = staticHTTPClientSource{}
	}
	return &wechatProvider{
		clients:            clients,
		sessionPausedUntil: make(map[string]time.Time),
	}
}

func (p *wechatProvider) Name() string {
	return wechatProviderName
}

func (p *wechatProvider) Activate(_ context.Context, connection store.BotConnection, _ string) (ActivationResult, error) {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return ActivationResult{}, fmt.Errorf("%w: wechat bot_token is required", ErrInvalidInput)
	}

	mode, err := parseWeChatDeliveryMode(connection.Settings[wechatDeliveryModeSetting])
	if err != nil {
		return ActivationResult{}, err
	}

	baseURL := strings.TrimSpace(connection.Settings[wechatBaseURLSetting])
	if baseURL == "" {
		return ActivationResult{}, fmt.Errorf("%w: wechat base url is required", ErrInvalidInput)
	}
	if _, err := parseWeChatBaseURL(baseURL); err != nil {
		return ActivationResult{}, err
	}

	accountID := strings.TrimSpace(connection.Settings[wechatAccountIDSetting])
	if accountID == "" {
		return ActivationResult{}, fmt.Errorf("%w: wechat account id is required", ErrInvalidInput)
	}

	ownerUserID := strings.TrimSpace(connection.Settings[wechatOwnerUserIDSetting])
	if ownerUserID == "" {
		return ActivationResult{}, fmt.Errorf("%w: wechat owner user id is required", ErrInvalidInput)
	}
	cdnBaseURL := strings.TrimSpace(connection.Settings[wechatCDNBaseURLSetting])
	if cdnBaseURL == "" {
		cdnBaseURL = wechatDefaultCDNBaseURL
	}
	if _, err := parseWeChatBaseURL(cdnBaseURL); err != nil {
		return ActivationResult{}, fmt.Errorf("%w: wechat cdn base url must be absolute", ErrInvalidInput)
	}

	settings := cloneStringMapLocal(connection.Settings)
	if settings == nil {
		settings = make(map[string]string)
	}
	settings[wechatDeliveryModeSetting] = mode
	settings[wechatBaseURLSetting] = baseURL
	settings[wechatCDNBaseURLSetting] = cdnBaseURL
	if routeTag := strings.TrimSpace(connection.Settings[wechatRouteTagSetting]); routeTag != "" {
		settings[wechatRouteTagSetting] = routeTag
	}
	settings[wechatAccountIDSetting] = accountID
	settings[wechatOwnerUserIDSetting] = ownerUserID

	return ActivationResult{
		Settings: settings,
		Secrets:  cloneStringMapLocal(connection.Secrets),
	}, nil
}

func (p *wechatProvider) Deactivate(context.Context, store.BotConnection) error {
	return nil
}

func (p *wechatProvider) ParseWebhook(*http.Request, store.BotConnection) ([]InboundMessage, error) {
	return nil, ErrWebhookIgnored
}

func (p *wechatProvider) SupportsPolling(connection store.BotConnection) bool {
	mode, err := parseWeChatDeliveryMode(connection.Settings[wechatDeliveryModeSetting])
	return err == nil && mode == wechatDeliveryModePolling
}

func (p *wechatProvider) PollingOwnerKey(connection store.BotConnection) string {
	mode, err := parseWeChatDeliveryMode(connection.Settings[wechatDeliveryModeSetting])
	if err != nil || mode != wechatDeliveryModePolling {
		return ""
	}

	accountID := strings.TrimSpace(connection.Settings[wechatAccountIDSetting])
	if accountID != "" {
		return wechatProviderName + ":" + accountID
	}

	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return ""
	}
	return wechatProviderName + ":" + token
}

func (p *wechatProvider) PollingConflictError(ownerConnectionID string) error {
	message := "wechat polling credentials are already claimed by another active polling connection"
	if owner := strings.TrimSpace(ownerConnectionID); owner != "" {
		message += " (" + owner + ")"
	}
	message += "; pause or delete the other polling connection before resuming this one"
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

func (p *wechatProvider) RunPolling(
	ctx context.Context,
	connection store.BotConnection,
	handleMessage PollingMessageHandler,
	updateSettings PollingSettingsHandler,
	reportEvent PollingEventHandler,
) error {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return fmt.Errorf("%w: wechat bot_token is required", ErrInvalidInput)
	}

	baseURL := strings.TrimSpace(connection.Settings[wechatBaseURLSetting])
	if _, err := parseWeChatBaseURL(baseURL); err != nil {
		return err
	}
	cdnBaseURL := normalizedWeChatCDNBaseURL(connection)
	routeTag := wechatRouteTag(connection)

	syncBuf := strings.TrimSpace(connection.Settings[wechatSyncBufSetting])
	pollTimeout := wechatDefaultLongPollTimeout
	for {
		if err := waitForWeChatSessionPause(ctx, p.remainingSessionPause(connection)); err != nil {
			return err
		}

		response, err := p.getUpdates(ctx, baseURL, token, routeTag, syncBuf, pollTimeout)
		if err != nil {
			return err
		}
		if response.LongPollMS > 0 {
			pollTimeout = time.Duration(response.LongPollMS) * time.Millisecond
		}
		if err := wechatAPIError("/ilink/bot/getupdates", response.wechatAPIResponse); err != nil {
			if response.ErrCode == wechatSessionExpiredErrCode {
				if err := waitForWeChatSessionPause(ctx, p.pauseSession(connection)); err != nil {
					return err
				}
				continue
			}
			return err
		}

		if nextSyncBuf := strings.TrimSpace(response.GetUpdatesBuf); nextSyncBuf != "" && nextSyncBuf != syncBuf {
			if err := updateSettings(ctx, map[string]string{wechatSyncBufSetting: nextSyncBuf}); err != nil {
				return err
			}
			syncBuf = nextSyncBuf
		}

		if len(response.Msgs) == 0 {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
				EventType: "poll_idle",
				Message:   "Poll completed successfully. No new messages.",
			}); err != nil {
				return err
			}
			continue
		}

		processedCount := 0
		ignoredCount := 0
		for _, message := range response.Msgs {
			inbound, err := p.inboundMessageFromWeChat(ctx, cdnBaseURL, message)
			switch {
			case errors.Is(err, ErrWebhookIgnored):
				ignoredCount += 1
				continue
			case err != nil:
				return err
			}

			if err := handleMessage(ctx, inbound); err != nil {
				return err
			}
			processedCount += 1
		}

		eventType := "poll_success"
		if processedCount == 0 {
			eventType = "poll_idle"
		}
		if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
			EventType:      eventType,
			Message:        fmt.Sprintf("Poll completed successfully. Received %d message(s), processed %d, ignored %d.", len(response.Msgs), processedCount, ignoredCount),
			ReceivedCount:  len(response.Msgs),
			ProcessedCount: processedCount,
			IgnoredCount:   ignoredCount,
		}); err != nil {
			return err
		}
	}
}

func (p *wechatProvider) SendMessages(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	messages []OutboundMessage,
) error {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return fmt.Errorf("%w: wechat bot_token is required", ErrInvalidInput)
	}
	if err := p.assertSessionActive(connection); err != nil {
		return err
	}

	baseURL := strings.TrimSpace(connection.Settings[wechatBaseURLSetting])
	if _, err := parseWeChatBaseURL(baseURL); err != nil {
		return err
	}
	cdnBaseURL := normalizedWeChatCDNBaseURL(connection)
	routeTag := wechatRouteTag(connection)

	toUserID := strings.TrimSpace(conversation.ExternalChatID)
	if toUserID == "" {
		return fmt.Errorf("%w: wechat external chat id is required", ErrInvalidInput)
	}

	contextToken := strings.TrimSpace(conversation.ProviderState[wechatContextTokenKey])
	if contextToken == "" {
		return fmt.Errorf("%w: wechat context token is required before sending replies", ErrInvalidInput)
	}

	for _, message := range messages {
		text := strings.TrimSpace(message.Text)
		if len(message.Media) == 0 {
			if text == "" {
				continue
			}
			if err := p.sendTextMessage(ctx, baseURL, token, routeTag, toUserID, contextToken, text); err != nil {
				return err
			}
			continue
		}

		for index, media := range message.Media {
			caption := ""
			if index == 0 {
				caption = text
			}
			if err := p.sendMediaMessage(ctx, baseURL, cdnBaseURL, token, routeTag, toUserID, contextToken, caption, media); err != nil {
				return err
			}
		}
	}

	return nil
}

func (p *wechatProvider) StartStreamingReply(
	_ context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (StreamingReplySession, error) {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return nil, fmt.Errorf("%w: wechat bot_token is required", ErrInvalidInput)
	}
	if err := p.assertSessionActive(connection); err != nil {
		return nil, err
	}

	baseURL := strings.TrimSpace(connection.Settings[wechatBaseURLSetting])
	if _, err := parseWeChatBaseURL(baseURL); err != nil {
		return nil, err
	}

	toUserID := strings.TrimSpace(conversation.ExternalChatID)
	if toUserID == "" {
		return nil, fmt.Errorf("%w: wechat external chat id is required", ErrInvalidInput)
	}

	contextToken := strings.TrimSpace(conversation.ProviderState[wechatContextTokenKey])
	if contextToken == "" {
		return nil, fmt.Errorf("%w: wechat context token is required before sending replies", ErrInvalidInput)
	}

	return &wechatStreamingReplySession{
		provider:     p,
		connection:   connection,
		conversation: conversation,
	}, nil
}

type wechatStreamingReplySession struct {
	provider     *wechatProvider
	connection   store.BotConnection
	conversation store.BotConversation

	mu            sync.Mutex
	sentMessages  []OutboundMessage
	streamStopped bool
}

func (s *wechatStreamingReplySession) Update(ctx context.Context, update StreamingUpdate) error {
	if s == nil || s.provider == nil {
		return nil
	}

	current := normalizeStreamingMessages(update)
	if len(current) == 0 {
		return nil
	}

	s.mu.Lock()
	if s.streamStopped {
		s.mu.Unlock()
		return nil
	}

	toSend, canContinue := nextWeChatStreamingCommittedMessages(s.sentMessages, current)
	if !canContinue {
		s.streamStopped = true
		s.mu.Unlock()
		return nil
	}
	s.sentMessages = append(cloneOutboundMessages(s.sentMessages), cloneOutboundMessages(toSend)...)
	s.mu.Unlock()

	if len(toSend) == 0 {
		return nil
	}
	return s.provider.SendMessages(ctx, s.connection, s.conversation, toSend)
}

func (s *wechatStreamingReplySession) Complete(ctx context.Context, messages []OutboundMessage) error {
	if s == nil || s.provider == nil {
		return nil
	}

	finalMessages := cloneOutboundMessages(messages)
	if len(finalMessages) == 0 {
		return nil
	}

	s.mu.Lock()
	toSend, ok := remainingWeChatStreamingMessages(s.sentMessages, finalMessages)
	if ok {
		s.sentMessages = cloneOutboundMessages(finalMessages)
	}
	s.mu.Unlock()

	if !ok || len(toSend) == 0 {
		return nil
	}
	return s.provider.SendMessages(ctx, s.connection, s.conversation, toSend)
}

func (s *wechatStreamingReplySession) Fail(ctx context.Context, text string) error {
	if s == nil || s.provider == nil {
		return nil
	}

	text = strings.TrimSpace(text)
	if text == "" {
		text = defaultStreamingFailureText
	}
	return s.provider.SendMessages(ctx, s.connection, s.conversation, []OutboundMessage{{Text: text}})
}

func nextWeChatStreamingCommittedMessages(sent []OutboundMessage, current []OutboundMessage) ([]OutboundMessage, bool) {
	if len(current) <= 1 {
		return nil, true
	}

	commitEnd := len(current) - 1
	if commitEnd <= len(sent) {
		return nil, hasOutboundMessagePrefix(current, sent)
	}
	if !hasOutboundMessagePrefix(current, sent) {
		return nil, false
	}

	return cloneOutboundMessages(current[len(sent):commitEnd]), true
}

func remainingWeChatStreamingMessages(sent []OutboundMessage, final []OutboundMessage) ([]OutboundMessage, bool) {
	if len(final) == 0 {
		return nil, true
	}
	if len(sent) == 0 {
		return cloneOutboundMessages(final), true
	}
	if !hasOutboundMessagePrefix(final, sent) {
		return nil, false
	}
	if len(final) <= len(sent) {
		return nil, true
	}
	return cloneOutboundMessages(final[len(sent):]), true
}

func hasOutboundMessagePrefix(messages []OutboundMessage, prefix []OutboundMessage) bool {
	if len(prefix) > len(messages) {
		return false
	}
	for index := range prefix {
		if !equalOutboundMessage(messages[index], prefix[index]) {
			return false
		}
	}
	return true
}

func equalOutboundMessage(left OutboundMessage, right OutboundMessage) bool {
	return strings.TrimSpace(left.Text) == strings.TrimSpace(right.Text) &&
		equalBotMessageMediaList(left.Media, right.Media)
}

func (p *wechatProvider) StartTyping(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (TypingSession, error) {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return nil, fmt.Errorf("%w: wechat bot_token is required", ErrInvalidInput)
	}
	if err := p.assertSessionActive(connection); err != nil {
		return nil, err
	}

	baseURL := strings.TrimSpace(connection.Settings[wechatBaseURLSetting])
	if _, err := parseWeChatBaseURL(baseURL); err != nil {
		return nil, err
	}

	toUserID := strings.TrimSpace(conversation.ExternalChatID)
	if toUserID == "" {
		return nil, fmt.Errorf("%w: wechat external chat id is required before typing", ErrInvalidInput)
	}

	contextToken := strings.TrimSpace(conversation.ProviderState[wechatContextTokenKey])
	if contextToken == "" {
		return nil, fmt.Errorf("%w: wechat context token is required before typing", ErrInvalidInput)
	}
	routeTag := wechatRouteTag(connection)

	typingTicket, err := p.getTypingTicket(ctx, connection, baseURL, token, routeTag, toUserID, contextToken)
	if err != nil {
		return nil, err
	}
	if typingTicket == "" {
		return nil, nil
	}

	if err := p.sendTyping(ctx, baseURL, token, routeTag, toUserID, typingTicket, wechatTypingStatusTyping); err != nil {
		return nil, err
	}

	sessionCtx, cancel := context.WithCancel(context.Background())
	session := &wechatTypingSession{
		provider:     p,
		baseURL:      baseURL,
		token:        token,
		routeTag:     routeTag,
		toUserID:     toUserID,
		typingTicket: typingTicket,
		cancel:       cancel,
		done:         make(chan struct{}),
	}
	go session.keepalive(sessionCtx)
	return session, nil
}

type wechatTypingSession struct {
	provider     *wechatProvider
	baseURL      string
	token        string
	routeTag     string
	toUserID     string
	typingTicket string
	cancel       context.CancelFunc
	done         chan struct{}
	stopOnce     sync.Once
}

func (s *wechatTypingSession) Stop(ctx context.Context) error {
	if s == nil {
		return nil
	}

	var stopErr error
	s.stopOnce.Do(func() {
		if s.cancel != nil {
			s.cancel()
		}
		if s.done != nil {
			<-s.done
		}
		stopErr = s.provider.sendTyping(ctx, s.baseURL, s.token, s.routeTag, s.toUserID, s.typingTicket, wechatTypingStatusCancel)
	})
	return stopErr
}

func (s *wechatTypingSession) keepalive(ctx context.Context) {
	ticker := time.NewTicker(wechatTypingKeepaliveDelay)
	defer ticker.Stop()
	defer close(s.done)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			requestCtx, cancel := context.WithTimeout(context.Background(), wechatConfigHTTPTimeout)
			_ = s.provider.sendTyping(requestCtx, s.baseURL, s.token, s.routeTag, s.toUserID, s.typingTicket, wechatTypingStatusTyping)
			cancel()
		}
	}
}

func (p *wechatProvider) getTypingTicket(
	ctx context.Context,
	connection store.BotConnection,
	baseURL string,
	token string,
	routeTag string,
	toUserID string,
	contextToken string,
) (string, error) {
	cacheKey := p.typingCacheKey(connection, baseURL, toUserID)

	p.typingMu.Lock()
	if entry, ok := p.typingCache[cacheKey]; ok && strings.TrimSpace(entry.typingTicket) != "" && time.Now().Before(entry.expiresAt) {
		p.typingMu.Unlock()
		return entry.typingTicket, nil
	}
	p.typingMu.Unlock()

	response, err := p.getConfig(ctx, baseURL, token, routeTag, toUserID, contextToken)
	if err != nil {
		return "", err
	}

	typingTicket := strings.TrimSpace(response.TypingTicket)
	if typingTicket == "" {
		return "", nil
	}

	p.typingMu.Lock()
	if p.typingCache == nil {
		p.typingCache = make(map[string]wechatTypingConfigCacheEntry)
	}
	p.typingCache[cacheKey] = wechatTypingConfigCacheEntry{
		typingTicket: typingTicket,
		expiresAt:    time.Now().Add(wechatTypingConfigTTL),
	}
	p.typingMu.Unlock()

	return typingTicket, nil
}

func (p *wechatProvider) typingCacheKey(connection store.BotConnection, baseURL string, toUserID string) string {
	return strings.Join([]string{
		strings.TrimSpace(baseURL),
		strings.TrimSpace(connection.Settings[wechatAccountIDSetting]),
		strings.TrimSpace(toUserID),
	}, "\n")
}

func (p *wechatProvider) getUpdates(ctx context.Context, baseURL string, token string, routeTag string, syncBuf string, timeout time.Duration) (wechatGetUpdatesResponse, error) {
	var response wechatGetUpdatesResponse
	err := p.callJSON(ctx, p.client(timeout+wechatLongPollTimeoutBuf), baseURL, token, routeTag, http.MethodPost, "/ilink/bot/getupdates", map[string]any{
		"get_updates_buf": strings.TrimSpace(syncBuf),
		"base_info": wechatBaseInfo{
			ChannelVersion: wechatChannelVersion,
		},
	}, &response)
	if err != nil {
		return wechatGetUpdatesResponse{}, err
	}
	return response, nil
}

func (p *wechatProvider) getConfig(
	ctx context.Context,
	baseURL string,
	token string,
	routeTag string,
	toUserID string,
	contextToken string,
) (wechatGetConfigResponse, error) {
	var response wechatGetConfigResponse
	err := p.callJSON(ctx, p.client(wechatConfigHTTPTimeout), baseURL, token, routeTag, http.MethodPost, "/ilink/bot/getconfig", map[string]any{
		"ilink_user_id": strings.TrimSpace(toUserID),
		"context_token": strings.TrimSpace(contextToken),
		"base_info": wechatBaseInfo{
			ChannelVersion: wechatChannelVersion,
		},
	}, &response)
	if err != nil {
		return wechatGetConfigResponse{}, err
	}
	return response, nil
}

func (p *wechatProvider) sendTyping(
	ctx context.Context,
	baseURL string,
	token string,
	routeTag string,
	toUserID string,
	typingTicket string,
	status int,
) error {
	var response wechatAPIResponse
	return p.callJSON(ctx, p.client(wechatConfigHTTPTimeout), baseURL, token, routeTag, http.MethodPost, "/ilink/bot/sendtyping", map[string]any{
		"ilink_user_id": strings.TrimSpace(toUserID),
		"typing_ticket": strings.TrimSpace(typingTicket),
		"status":        status,
		"base_info": wechatBaseInfo{
			ChannelVersion: wechatChannelVersion,
		},
	}, &response)
}

func (p *wechatProvider) sendTextMessage(
	ctx context.Context,
	baseURL string,
	token string,
	routeTag string,
	toUserID string,
	contextToken string,
	text string,
) error {
	var response wechatAPIResponse
	return p.callJSON(ctx, p.client(wechatDefaultHTTPTimeout), baseURL, token, routeTag, http.MethodPost, "/ilink/bot/sendmessage", wechatSendMessageRequest{
		Msg: wechatOutboundMessage{
			FromUserID:   "",
			ToUserID:     strings.TrimSpace(toUserID),
			ClientID:     randomWeChatClientID(),
			MessageType:  wechatMessageTypeBot,
			MessageState: wechatMessageStateComplete,
			ItemList: []wechatMessageItem{
				{
					Type: wechatItemTypeText,
					TextItem: &wechatTextItem{
						Text: text,
					},
				},
			},
			ContextToken: strings.TrimSpace(contextToken),
		},
		BaseInfo: wechatBaseInfo{
			ChannelVersion: wechatChannelVersion,
		},
	}, &response)
}

func (p *wechatProvider) inboundMessageFromWeChat(ctx context.Context, cdnBaseURL string, message wechatMessage) (InboundMessage, error) {
	if message.MessageType != wechatMessageTypeUser {
		return InboundMessage{}, ErrWebhookIgnored
	}

	text := extractWeChatText(message.ItemList)
	media := p.extractInboundMedia(ctx, cdnBaseURL, message.ItemList)
	summaryText := messageSummaryText(text, media)
	if strings.TrimSpace(summaryText) == "" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	fromUserID := strings.TrimSpace(message.FromUserID)
	if fromUserID == "" {
		return InboundMessage{}, ErrWebhookIgnored
	}

	title := firstNonEmpty(strings.TrimSpace(message.SessionID), fromUserID)
	return InboundMessage{
		ConversationID: fromUserID,
		ExternalChatID: fromUserID,
		MessageID:      stableWeChatMessageID(message),
		UserID:         fromUserID,
		Title:          title,
		Text:           summaryText,
		Media:          media,
		ProviderData: map[string]string{
			wechatContextTokenKey: strings.TrimSpace(message.ContextToken),
			wechatSessionIDKey:    strings.TrimSpace(message.SessionID),
			wechatCreatedAtMSKey:  strings.TrimSpace(message.CreateTimeMS.String()),
		},
	}, nil
}

func extractWeChatText(items []wechatMessageItem) string {
	if len(items) == 0 {
		return ""
	}

	lines := make([]string, 0, len(items)*2)
	for _, item := range items {
		if quote := extractWeChatQuotedText(item); quote != "" {
			lines = append(lines, "Quoted: "+quote)
		}

		switch item.Type {
		case wechatItemTypeText:
			if item.TextItem != nil && strings.TrimSpace(item.TextItem.Text) != "" {
				lines = append(lines, strings.TrimSpace(item.TextItem.Text))
			}
		case wechatItemTypeVoice:
			if item.VoiceItem != nil && strings.TrimSpace(item.VoiceItem.Text) != "" {
				lines = append(lines, strings.TrimSpace(item.VoiceItem.Text))
			}
		}
	}

	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func extractWeChatQuotedText(item wechatMessageItem) string {
	if item.RefMsg != nil && strings.TrimSpace(item.RefMsg.Text) != "" {
		return strings.TrimSpace(item.RefMsg.Text)
	}
	if item.RefMsg != nil && item.RefMsg.MessageItem != nil {
		if quoted := extractWeChatText([]wechatMessageItem{*item.RefMsg.MessageItem}); quoted != "" {
			if title := strings.TrimSpace(item.RefMsg.Title); title != "" {
				return title + " | " + quoted
			}
			return quoted
		}
		if title := strings.TrimSpace(item.RefMsg.Title); title != "" {
			return title
		}
	}
	if item.TextItem != nil && item.TextItem.RefMsg != nil && strings.TrimSpace(item.TextItem.RefMsg.Text) != "" {
		return strings.TrimSpace(item.TextItem.RefMsg.Text)
	}
	if item.TextItem != nil && item.TextItem.RefMsg != nil && item.TextItem.RefMsg.MessageItem != nil {
		if quoted := extractWeChatText([]wechatMessageItem{*item.TextItem.RefMsg.MessageItem}); quoted != "" {
			if title := strings.TrimSpace(item.TextItem.RefMsg.Title); title != "" {
				return title + " | " + quoted
			}
			return quoted
		}
		if title := strings.TrimSpace(item.TextItem.RefMsg.Title); title != "" {
			return title
		}
	}
	return ""
}

func stableWeChatMessageID(message wechatMessage) string {
	parts := []string{
		strings.TrimSpace(message.FromUserID),
		strings.TrimSpace(message.ClientID),
		strings.TrimSpace(message.CreateTimeMS.String()),
		strings.TrimSpace(message.ContextToken),
	}
	joined := strings.Join(parts, "\x00")
	if strings.TrimSpace(strings.ReplaceAll(joined, "\x00", "")) == "" {
		return ""
	}

	sum := sha1.Sum([]byte(joined))
	return "wechat:" + hex.EncodeToString(sum[:])
}

func parseWeChatDeliveryMode(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", wechatDeliveryModePolling:
		return wechatDeliveryModePolling, nil
	default:
		return "", fmt.Errorf("%w: wechat delivery mode must be polling", ErrInvalidInput)
	}
}

func parseWeChatBaseURL(value string) (*url.URL, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, fmt.Errorf("%w: wechat base url is required", ErrInvalidInput)
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("%w: wechat base url must be absolute", ErrInvalidInput)
	}
	return parsed, nil
}

func buildWeChatClientVersion(version string) uint32 {
	parts := strings.Split(strings.TrimSpace(version), ".")
	values := [3]uint64{}
	for index := 0; index < len(values) && index < len(parts); index++ {
		parsed, err := strconv.ParseUint(strings.TrimSpace(parts[index]), 10, 8)
		if err != nil {
			continue
		}
		values[index] = parsed
	}
	return uint32((values[0]&0xff)<<16 | (values[1]&0xff)<<8 | (values[2] & 0xff))
}

func applyWeChatCommonHeaders(headers http.Header, routeTag string) {
	if headers == nil {
		return
	}
	headers.Set("iLink-App-Id", wechatAppIDHeader)
	headers.Set("iLink-App-ClientVersion", wechatClientVersionHeader)
	headers.Set("X-WECHAT-UIN", randomWeChatUIN())
	if routeTag = strings.TrimSpace(routeTag); routeTag != "" {
		headers.Set("SKRouteTag", routeTag)
	}
}

func randomWeChatUIN() string {
	buffer := make([]byte, 4)
	if _, err := rand.Read(buffer); err != nil {
		return base64.StdEncoding.EncodeToString([]byte(strconv.FormatInt(time.Now().UnixNano(), 10)))
	}

	value := binary.BigEndian.Uint32(buffer)
	return base64.StdEncoding.EncodeToString([]byte(strconv.FormatUint(uint64(value), 10)))
}

func randomWeChatClientID() string {
	buffer := make([]byte, 8)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("wechat:%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("wechat:%d-%s", time.Now().UnixMilli(), hex.EncodeToString(buffer))
}

func wechatRouteTag(connection store.BotConnection) string {
	return strings.TrimSpace(connection.Settings[wechatRouteTagSetting])
}

func wechatSessionGuardKey(connection store.BotConnection) string {
	baseURL := strings.TrimSpace(connection.Settings[wechatBaseURLSetting])
	accountID := strings.TrimSpace(connection.Settings[wechatAccountIDSetting])
	if accountID == "" {
		accountID = strings.TrimSpace(connection.ID)
	}
	return strings.Join([]string{baseURL, accountID}, "\n")
}

func (p *wechatProvider) remainingSessionPause(connection store.BotConnection) time.Duration {
	if p == nil {
		return 0
	}

	key := wechatSessionGuardKey(connection)
	if key == "\n" {
		return 0
	}

	p.sessionMu.Lock()
	defer p.sessionMu.Unlock()

	until, ok := p.sessionPausedUntil[key]
	if !ok {
		return 0
	}

	remaining := time.Until(until)
	if remaining <= 0 {
		delete(p.sessionPausedUntil, key)
		return 0
	}
	return remaining
}

func (p *wechatProvider) pauseSession(connection store.BotConnection) time.Duration {
	if p == nil {
		return 0
	}

	key := wechatSessionGuardKey(connection)
	if key == "\n" {
		return 0
	}

	until := time.Now().Add(wechatSessionPauseDuration)
	p.sessionMu.Lock()
	if p.sessionPausedUntil == nil {
		p.sessionPausedUntil = make(map[string]time.Time)
	}
	p.sessionPausedUntil[key] = until
	p.sessionMu.Unlock()
	return time.Until(until)
}

func (p *wechatProvider) assertSessionActive(connection store.BotConnection) error {
	remaining := p.remainingSessionPause(connection)
	if remaining <= 0 {
		return nil
	}

	rounded := remaining.Round(time.Second)
	if rounded <= 0 {
		rounded = remaining
	}
	return fmt.Errorf("%w: wechat session is temporarily paused for %s after upstream returned errcode=%d", ErrInvalidInput, rounded, wechatSessionExpiredErrCode)
}

func waitForWeChatSessionPause(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return nil
	}

	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func wechatAPIError(path string, response wechatAPIResponse) error {
	if response.Ret == 0 && response.ErrCode == 0 {
		return nil
	}
	return &wechatRequestError{
		method:      path,
		statusCode:  response.ErrCode,
		status:      "api error",
		description: firstNonEmpty(strings.TrimSpace(response.ErrMsg), "wechat api request failed"),
	}
}

func (p *wechatProvider) client(timeout time.Duration) *http.Client {
	if p.clients == nil {
		return staticHTTPClientSource{}.Client(timeout)
	}
	return p.clients.Client(timeout)
}

func (p *wechatProvider) callJSON(
	ctx context.Context,
	client *http.Client,
	baseURL string,
	token string,
	routeTag string,
	method string,
	path string,
	payload any,
	target any,
) error {
	endpoint, err := buildWeChatURL(baseURL, path)
	if err != nil {
		return err
	}

	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode wechat %s payload: %w", path, err)
		}
		body = bytes.NewReader(data)
	}

	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return fmt.Errorf("build wechat %s request: %w", path, err)
	}
	request.Header.Set("AuthorizationType", "ilink_bot_token")
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	applyWeChatCommonHeaders(request.Header, routeTag)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	if client == nil {
		client = p.client(wechatDefaultHTTPTimeout)
	}

	response, err := client.Do(request)
	if err != nil {
		return &wechatRequestError{
			method: path,
			cause:  err,
		}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return &wechatRequestError{
			method:      path,
			statusCode:  response.StatusCode,
			status:      response.Status,
			description: strings.TrimSpace(string(content)),
		}
	}

	if target == nil {
		return nil
	}

	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode wechat %s response: %w", path, err)
	}

	switch typed := target.(type) {
	case *wechatAPIResponse:
		return wechatAPIError(path, *typed)
	case *wechatGetUploadURLResponse:
		return wechatAPIError(path, typed.wechatAPIResponse)
	case *wechatGetConfigResponse:
		return wechatAPIError(path, typed.wechatAPIResponse)
	}

	return nil
}

func buildWeChatURL(baseURL string, path string) (string, error) {
	parsed, err := parseWeChatBaseURL(baseURL)
	if err != nil {
		return "", err
	}

	parsed.Path = strings.TrimRight(parsed.Path, "/") + path
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}
