package bots

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/store"
)

const (
	telegramProviderName          = "telegram"
	telegramDeliveryModeSetting   = "telegram_delivery_mode"
	telegramDeliveryModeWebhook   = "webhook"
	telegramDeliveryModePolling   = "polling"
	telegramUpdateOffsetSetting   = "telegram_update_offset"
	telegramLongPollTimeoutSecond = 50
	telegramTextLimitRunes        = 3900
	telegramDeliveryRetryAttempts = 4
	telegramDeliveryRetryBase     = 300 * time.Millisecond
	telegramDeliveryRetryMax      = 3 * time.Second
	telegramReplyRetryAttempts    = 2
)

type telegramProvider struct {
	clients                httpClientSource
	apiBaseURL             string
	deliveryRetryAttempts  int
	deliveryRetryBaseDelay time.Duration
	deliveryRetryMaxDelay  time.Duration
	sleep                  func(context.Context, time.Duration) error
}

type telegramAPIResponse[T any] struct {
	OK          bool                  `json:"ok"`
	Description string                `json:"description"`
	ErrorCode   int                   `json:"error_code"`
	Parameters  telegramAPIParameters `json:"parameters"`
	Result      T                     `json:"result"`
}

type telegramAPIParameters struct {
	RetryAfter int `json:"retry_after"`
}

type telegramBotInfo struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

type telegramSentMessage struct {
	MessageID int64 `json:"message_id"`
}

type telegramUpdate struct {
	UpdateID int64            `json:"update_id"`
	Message  *telegramMessage `json:"message"`
}

type telegramMessage struct {
	MessageID       int64               `json:"message_id"`
	MessageThreadID int64               `json:"message_thread_id"`
	MediaGroupID    string              `json:"media_group_id"`
	Text            string              `json:"text"`
	Caption         string              `json:"caption"`
	Photo           []telegramPhotoSize `json:"photo"`
	Video           *telegramVideo      `json:"video"`
	Document        *telegramDocument   `json:"document"`
	Voice           *telegramVoice      `json:"voice"`
	Audio           *telegramAudio      `json:"audio"`
	Chat            telegramChat        `json:"chat"`
	From            *telegramUser       `json:"from"`
}

type telegramChat struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

type telegramUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

type telegramStreamingReplySession struct {
	mu         sync.Mutex
	provider   *telegramProvider
	connection store.BotConnection
	token      string
	chatID     string
	threadID   string
	messageIDs []int64
	lastChunks []string
}

type telegramRequestError struct {
	method      string
	statusCode  int
	status      string
	description string
	retryAfter  time.Duration
	cause       error
}

type telegramPollingTransportDiagnosticError struct {
	cause    error
	proxyURL string
}

func (e *telegramRequestError) Error() string {
	if e == nil {
		return ""
	}
	if e.cause != nil {
		return fmt.Sprintf("telegram %s request failed: %v", e.method, e.cause)
	}

	detail := strings.TrimSpace(e.description)
	switch {
	case e.status != "" && detail != "":
		return fmt.Sprintf("telegram %s returned %s: %s", e.method, e.status, detail)
	case e.status != "":
		return fmt.Sprintf("telegram %s returned %s", e.method, e.status)
	case detail != "":
		return fmt.Sprintf("telegram %s api error: %s", e.method, detail)
	default:
		return fmt.Sprintf("telegram %s request failed", e.method)
	}
}

func (e *telegramRequestError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func (e *telegramPollingTransportDiagnosticError) Error() string {
	if e == nil || e.cause == nil {
		return ""
	}
	return e.cause.Error()
}

func (e *telegramPollingTransportDiagnosticError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func (e *telegramPollingTransportDiagnosticError) PollingProxyURL() string {
	if e == nil {
		return ""
	}
	return strings.TrimSpace(e.proxyURL)
}

func newTelegramProvider(client *http.Client) Provider {
	return newTelegramProviderWithClientSource(staticHTTPClientSource{client: client})
}

func newTelegramProviderWithClientSource(clients httpClientSource) Provider {
	if clients == nil {
		clients = staticHTTPClientSource{}
	}

	return &telegramProvider{
		clients:                clients,
		apiBaseURL:             "https://api.telegram.org",
		deliveryRetryAttempts:  telegramDeliveryRetryAttempts,
		deliveryRetryBaseDelay: telegramDeliveryRetryBase,
		deliveryRetryMaxDelay:  telegramDeliveryRetryMax,
		sleep:                  sleepWithContext,
	}
}

func (p *telegramProvider) Name() string {
	return telegramProviderName
}

func (p *telegramProvider) Activate(
	ctx context.Context,
	connection store.BotConnection,
	publicBaseURL string,
) (ActivationResult, error) {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return ActivationResult{}, fmt.Errorf("%w: telegram bot_token is required", ErrInvalidInput)
	}

	mode, err := parseTelegramDeliveryMode(connection.Settings[telegramDeliveryModeSetting])
	if err != nil {
		return ActivationResult{}, err
	}

	info, err := p.getMe(ctx, token)
	if err != nil {
		return ActivationResult{}, err
	}

	settings := cloneStringMapLocal(connection.Settings)
	if settings == nil {
		settings = make(map[string]string)
	}
	settings[telegramDeliveryModeSetting] = mode
	settings["bot_id"] = strconv.FormatInt(info.ID, 10)
	settings["bot_display_name"] = strings.TrimSpace(info.FirstName)
	settings["bot_username"] = strings.TrimSpace(info.Username)

	secrets := cloneStringMapLocal(connection.Secrets)
	if secrets == nil {
		secrets = make(map[string]string)
	}

	switch mode {
	case telegramDeliveryModeWebhook:
		secret := strings.TrimSpace(connection.Secrets["webhook_secret"])
		if secret == "" {
			secret, err = randomHex(16)
			if err != nil {
				return ActivationResult{}, err
			}
		}
		webhookURL, err := buildWebhookURL(publicBaseURL, connection.ID)
		if err != nil {
			return ActivationResult{}, err
		}
		if err := p.setWebhook(ctx, token, webhookURL, secret); err != nil {
			return ActivationResult{}, err
		}
		settings["webhook_url"] = webhookURL
		delete(settings, telegramUpdateOffsetSetting)
		secrets["webhook_secret"] = secret
	case telegramDeliveryModePolling:
		if err := p.deleteWebhook(ctx, token); err != nil {
			return ActivationResult{}, err
		}
		delete(settings, "webhook_url")
	}

	return ActivationResult{
		Settings: settings,
		Secrets:  secrets,
	}, nil
}

func (p *telegramProvider) Deactivate(ctx context.Context, connection store.BotConnection) error {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return nil
	}

	return p.deleteWebhook(ctx, token)
}

func (p *telegramProvider) ParseWebhook(r *http.Request, connection store.BotConnection) ([]InboundMessage, error) {
	if telegramDeliveryMode(connection) == telegramDeliveryModePolling {
		return nil, ErrWebhookIgnored
	}

	expectedSecret := strings.TrimSpace(connection.Secrets["webhook_secret"])
	if expectedSecret != "" {
		actualSecret := strings.TrimSpace(r.Header.Get("X-Telegram-Bot-Api-Secret-Token"))
		if subtle.ConstantTimeCompare([]byte(actualSecret), []byte(expectedSecret)) != 1 {
			return nil, ErrWebhookUnauthorized
		}
	}

	defer r.Body.Close()

	var update telegramUpdate
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		return nil, fmt.Errorf("%w: decode telegram webhook: %s", ErrInvalidInput, err.Error())
	}

	message, err := p.inboundMessageFromTelegramUpdate(r.Context(), strings.TrimSpace(connection.Secrets["bot_token"]), update)
	if err != nil {
		return nil, err
	}

	return []InboundMessage{message}, nil
}

func (p *telegramProvider) SupportsPolling(connection store.BotConnection) bool {
	return telegramDeliveryMode(connection) == telegramDeliveryModePolling
}

func (p *telegramProvider) PollingOwnerKey(connection store.BotConnection) string {
	if telegramDeliveryMode(connection) != telegramDeliveryModePolling {
		return ""
	}
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return ""
	}
	return telegramProviderName + ":" + token
}

func (p *telegramProvider) PollingConflictError(ownerConnectionID string) error {
	return telegramPollingConflictError(ownerConnectionID)
}

func (p *telegramProvider) RunPolling(
	ctx context.Context,
	connection store.BotConnection,
	handleMessage PollingMessageHandler,
	updateSettings PollingSettingsHandler,
	reportEvent PollingEventHandler,
) error {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return fmt.Errorf("%w: telegram bot_token is required", ErrInvalidInput)
	}

	offset, err := parseTelegramUpdateOffset(connection.Settings[telegramUpdateOffsetSetting])
	if err != nil {
		return err
	}

	for {
		updates, err := p.getUpdates(ctx, token, offset)
		if err != nil {
			return err
		}
		processedCount := 0
		ignoredCount := 0
		if len(updates) == 0 {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
				EventType: "poll_idle",
				Message:   "Poll completed successfully. No new updates.",
			}); err != nil {
				return err
			}
			continue
		}

		for _, update := range updates {
			nextOffset := update.UpdateID + 1
			message, err := p.inboundMessageFromTelegramUpdate(ctx, token, update)
			switch {
			case errors.Is(err, ErrWebhookIgnored):
				ignoredCount += 1
				if err := updateSettings(ctx, map[string]string{
					telegramUpdateOffsetSetting: strconv.FormatInt(nextOffset, 10),
				}); err != nil {
					return err
				}
				offset = nextOffset
				continue
			case err != nil:
				return err
			}

			if err := handleMessage(ctx, message); err != nil {
				return err
			}
			processedCount += 1
			if err := updateSettings(ctx, map[string]string{
				telegramUpdateOffsetSetting: strconv.FormatInt(nextOffset, 10),
			}); err != nil {
				return err
			}
			offset = nextOffset
		}

		message := fmt.Sprintf(
			"Poll completed successfully. Received %d update(s), processed %d, ignored %d.",
			len(updates),
			processedCount,
			ignoredCount,
		)
		eventType := "poll_success"
		if processedCount == 0 {
			eventType = "poll_idle"
		}
		if err := emitPollingEvent(ctx, reportEvent, PollingEvent{
			EventType:      eventType,
			Message:        message,
			ReceivedCount:  len(updates),
			ProcessedCount: processedCount,
			IgnoredCount:   ignoredCount,
		}); err != nil {
			return err
		}
	}
}

func (p *telegramProvider) SendMessages(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	messages []OutboundMessage,
) error {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return fmt.Errorf("%w: telegram bot_token is required", ErrInvalidInput)
	}

	chatID := strings.TrimSpace(conversation.ExternalChatID)
	if chatID == "" {
		return fmt.Errorf("%w: telegram external chat id is required", ErrInvalidInput)
	}
	if err := validateTelegramOutboundMessages(messages); err != nil {
		return err
	}
	threadID := strings.TrimSpace(conversation.ExternalThreadID)
	logBotDebug(ctx, connection, "telegram send messages requested",
		slog.String("externalChatId", chatID),
		slog.String("externalThreadId", threadID),
		slog.Int("messageCount", len(messages)),
		slog.Any("messages", debugOutboundMessages(messages)),
	)

	sentParts := 0
	sendTextChunks := func(logMessage string, text string) error {
		chunks := splitTelegramText(text, telegramTextLimitRunes)
		for index, chunk := range chunks {
			logBotDebug(ctx, connection, logMessage,
				slog.String("externalChatId", chatID),
				slog.String("externalThreadId", threadID),
				slog.Int("chunkIndex", index),
				slog.Int("chunkLength", len([]rune(chunk))),
				slog.String("chunkPreview", debugTextPreview(chunk)),
			)
			if _, err := p.sendTextMessage(ctx, token, chatID, threadID, chunk); err != nil {
				if sentParts == 0 {
					return markReplyDeliveryRetryable(err)
				}
				return err
			}
			sentParts += 1
		}
		return nil
	}
	for _, message := range messages {
		if len(message.Media) == 0 {
			if strings.TrimSpace(message.Text) == "" {
				continue
			}
			if err := sendTextChunks("telegram sending chunk", message.Text); err != nil {
				return err
			}
			continue
		}

		if len(message.Media) > 1 {
			resolvedMedia, err := resolveTelegramOutboundMediaList(message.Media)
			if err != nil {
				if sentParts == 0 {
					return markReplyDeliveryRetryable(err)
				}
				return err
			}
			groupBatches := telegramMediaGroupBatches(resolvedMedia)
			if len(groupBatches) > 0 {
				caption := telegramCaptionForMediaGroup(message)
				if caption == "" && strings.TrimSpace(message.Text) != "" {
					if err := sendTextChunks("telegram sending chunk before media group", message.Text); err != nil {
						return err
					}
				}

				for batchIndex, batch := range groupBatches {
					currentCaption := ""
					if batchIndex == 0 {
						currentCaption = caption
					}
					logBotDebug(ctx, connection, "telegram sending media group",
						slog.String("externalChatId", chatID),
						slog.String("externalThreadId", threadID),
						slog.Int("batchIndex", batchIndex),
						slog.Int("mediaCount", len(batch)),
						slog.Bool("hasCaption", currentCaption != ""),
					)
					sent, err := p.sendMediaGroup(ctx, token, chatID, threadID, currentCaption, batch)
					if err != nil {
						if sentParts == 0 {
							return markReplyDeliveryRetryable(err)
						}
						return err
					}
					if len(sent) == 0 {
						sentParts += 1
						continue
					}
					sentParts += len(sent)
				}
				continue
			}
		}

		caption := telegramCaptionForMessage(message)
		if caption == "" && strings.TrimSpace(message.Text) != "" {
			if err := sendTextChunks("telegram sending chunk before media", message.Text); err != nil {
				return err
			}
		}

		for mediaIndex, media := range message.Media {
			currentCaption := ""
			if mediaIndex == 0 {
				currentCaption = caption
			}
			logBotDebug(ctx, connection, "telegram sending media",
				slog.String("externalChatId", chatID),
				slog.String("externalThreadId", threadID),
				slog.Int("mediaIndex", mediaIndex),
				slog.String("mediaKind", strings.TrimSpace(media.Kind)),
				slog.String("mediaPath", strings.TrimSpace(media.Path)),
				slog.String("mediaURL", strings.TrimSpace(media.URL)),
				slog.Bool("hasCaption", currentCaption != ""),
			)
			if _, err := p.sendMediaMessage(ctx, token, chatID, threadID, currentCaption, media); err != nil {
				if sentParts == 0 {
					return markReplyDeliveryRetryable(err)
				}
				return err
			}
			sentParts += 1
		}
	}

	return nil
}

func (p *telegramProvider) ReplyDeliveryRetryDecision(err error, attempt int) (bool, time.Duration) {
	if attempt >= telegramReplyRetryAttempts || !isReplyDeliveryRetryable(err) {
		return false, 0
	}
	return p.deliveryRetryDecision(unwrapReplyDeliveryRetryable(err), attempt)
}

func (p *telegramProvider) StartStreamingReply(
	_ context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
) (StreamingReplySession, error) {
	token := strings.TrimSpace(connection.Secrets["bot_token"])
	if token == "" {
		return nil, fmt.Errorf("%w: telegram bot_token is required", ErrInvalidInput)
	}

	chatID := strings.TrimSpace(conversation.ExternalChatID)
	if chatID == "" {
		return nil, fmt.Errorf("%w: telegram external chat id is required", ErrInvalidInput)
	}

	return &telegramStreamingReplySession{
		provider:   p,
		connection: connection,
		token:      token,
		chatID:     chatID,
		threadID:   strings.TrimSpace(conversation.ExternalThreadID),
	}, nil
}

func (p *telegramProvider) getMe(ctx context.Context, token string) (telegramBotInfo, error) {
	var response telegramAPIResponse[telegramBotInfo]
	if err := p.callJSON(ctx, token, "getMe", nil, &response); err != nil {
		return telegramBotInfo{}, err
	}

	return response.Result, nil
}

func (p *telegramProvider) getUpdates(ctx context.Context, token string, offset int64) ([]telegramUpdate, error) {
	var response telegramAPIResponse[[]telegramUpdate]

	payload := map[string]any{
		"allowed_updates": []string{"message"},
		"timeout":         telegramLongPollTimeoutSecond,
	}
	if offset > 0 {
		payload["offset"] = offset
	}

	if err := p.withDeliveryRetry(ctx, func(ctx context.Context) error {
		return p.callJSONWithClient(ctx, p.pollingClient(), token, "getUpdates", payload, &response)
	}); err != nil {
		return nil, wrapTelegramPollingTransportError(err, p.pollingProxyURL())
	}

	return response.Result, nil
}

func (p *telegramProvider) setWebhook(ctx context.Context, token string, webhookURL string, secret string) error {
	var response telegramAPIResponse[bool]
	return p.callJSON(ctx, token, "setWebhook", map[string]any{
		"url":          webhookURL,
		"secret_token": secret,
	}, &response)
}

func (p *telegramProvider) deleteWebhook(ctx context.Context, token string) error {
	var response telegramAPIResponse[bool]
	return p.callJSON(ctx, token, "deleteWebhook", map[string]any{
		"drop_pending_updates": false,
	}, &response)
}

func (p *telegramProvider) callJSON(
	ctx context.Context,
	token string,
	method string,
	payload any,
	target any,
) error {
	return p.callJSONWithClient(ctx, p.client(15*time.Second), token, method, payload, target)
}

func (p *telegramProvider) callJSONWithClient(
	ctx context.Context,
	client *http.Client,
	token string,
	method string,
	payload any,
	target any,
) error {
	endpoint, err := p.methodURL(token, method)
	if err != nil {
		return err
	}

	var body io.Reader
	requestMethod := http.MethodGet
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode telegram %s payload: %w", method, err)
		}
		body = bytes.NewReader(data)
		requestMethod = http.MethodPost
	}

	request, err := http.NewRequestWithContext(ctx, requestMethod, endpoint, body)
	if err != nil {
		return fmt.Errorf("build telegram %s request: %w", method, err)
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	if client == nil {
		client = p.client(15 * time.Second)
	}

	response, err := client.Do(request)
	if err != nil {
		return &telegramRequestError{
			method: method,
			cause:  err,
		}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return telegramErrorFromHTTP(method, response.StatusCode, response.Status, response.Header, content)
	}

	if target == nil {
		return nil
	}

	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode telegram %s response: %w", method, err)
	}

	if apiErr := extractTelegramAPIError(method, target); apiErr != nil {
		return apiErr
	}

	return nil
}

func (p *telegramProvider) methodURL(token string, method string) (string, error) {
	base, err := url.Parse(strings.TrimRight(p.apiBaseURL, "/"))
	if err != nil {
		return "", fmt.Errorf("invalid telegram api base url: %w", err)
	}

	base.Path = strings.TrimRight(base.Path, "/") + "/bot" + token + "/" + method
	return base.String(), nil
}

func (p *telegramProvider) client(timeout time.Duration) *http.Client {
	if p.clients == nil {
		return staticHTTPClientSource{}.Client(timeout)
	}

	return p.clients.Client(timeout)
}

func (p *telegramProvider) pollingClient() *http.Client {
	minTimeout := (telegramLongPollTimeoutSecond + 10) * time.Second
	return p.client(minTimeout)
}

func (p *telegramProvider) pollingProxyURL() string {
	if p == nil || p.clients == nil {
		return ""
	}

	proxyAware, ok := p.clients.(proxyAwareHTTPClientSource)
	if !ok {
		return ""
	}

	return strings.TrimSpace(proxyAware.EffectiveProxyURL())
}

func (p *telegramProvider) withDeliveryRetry(
	ctx context.Context,
	operation func(context.Context) error,
) error {
	attempts := p.deliveryRetryAttempts
	if attempts < 1 {
		attempts = 1
	}

	for attempt := 1; attempt <= attempts; attempt++ {
		err := operation(ctx)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil || attempt >= attempts {
			return err
		}

		retry, delay := p.deliveryRetryDecision(err, attempt)
		if !retry {
			return err
		}
		if err := p.sleepFunc()(ctx, delay); err != nil {
			return err
		}
	}

	return nil
}

func (p *telegramProvider) sleepFunc() func(context.Context, time.Duration) error {
	if p != nil && p.sleep != nil {
		return p.sleep
	}
	return sleepWithContext
}

func (p *telegramProvider) deliveryRetryDecision(err error, attempt int) (bool, time.Duration) {
	var requestErr *telegramRequestError
	if errors.As(err, &requestErr) {
		if requestErr.retryAfter > 0 {
			return true, requestErr.retryAfter
		}
		if requestErr.statusCode == http.StatusTooManyRequests {
			return true, p.deliveryRetryBackoff(attempt)
		}
		if requestErr.statusCode >= http.StatusInternalServerError {
			return true, p.deliveryRetryBackoff(attempt)
		}
		if requestErr.cause != nil && isTransientTelegramTransportError(requestErr.cause) {
			return true, p.deliveryRetryBackoff(attempt)
		}
		return false, 0
	}

	if isTransientTelegramTransportError(err) {
		return true, p.deliveryRetryBackoff(attempt)
	}

	return false, 0
}

func (p *telegramProvider) deliveryRetryBackoff(attempt int) time.Duration {
	delay := p.deliveryRetryBaseDelay
	if delay <= 0 {
		delay = telegramDeliveryRetryBase
	}

	for step := 1; step < attempt; step++ {
		if delay > (1 << 62) {
			break
		}
		delay *= 2
	}

	maxDelay := p.deliveryRetryMaxDelay
	if maxDelay <= 0 {
		maxDelay = telegramDeliveryRetryMax
	}
	if delay > maxDelay {
		return maxDelay
	}

	return delay
}

func extractTelegramAPIError(method string, target any) error {
	switch typed := target.(type) {
	case *telegramAPIResponse[telegramBotInfo]:
		if !typed.OK {
			return telegramErrorFromAPI(method, typed.ErrorCode, typed.Description, typed.Parameters)
		}
	case *telegramAPIResponse[bool]:
		if !typed.OK {
			return telegramErrorFromAPI(method, typed.ErrorCode, typed.Description, typed.Parameters)
		}
	case *telegramAPIResponse[map[string]any]:
		if !typed.OK {
			return telegramErrorFromAPI(method, typed.ErrorCode, typed.Description, typed.Parameters)
		}
	case *telegramAPIResponse[telegramSentMessage]:
		if !typed.OK {
			return telegramErrorFromAPI(method, typed.ErrorCode, typed.Description, typed.Parameters)
		}
	case *telegramAPIResponse[telegramFile]:
		if !typed.OK {
			return telegramErrorFromAPI(method, typed.ErrorCode, typed.Description, typed.Parameters)
		}
	case *telegramAPIResponse[[]telegramUpdate]:
		if !typed.OK {
			return telegramErrorFromAPI(method, typed.ErrorCode, typed.Description, typed.Parameters)
		}
	}

	return nil
}

func telegramErrorFromHTTP(
	method string,
	statusCode int,
	status string,
	headers http.Header,
	content []byte,
) error {
	description := strings.TrimSpace(string(content))
	retryAfter := parseTelegramRetryAfterHeader(headers.Get("Retry-After"))

	var envelope telegramAPIResponse[json.RawMessage]
	if err := json.Unmarshal(content, &envelope); err == nil {
		description = firstNonEmpty(strings.TrimSpace(envelope.Description), description)
		if envelope.Parameters.RetryAfter > 0 {
			retryAfter = time.Duration(envelope.Parameters.RetryAfter) * time.Second
		}
	}

	return &telegramRequestError{
		method:      method,
		statusCode:  statusCode,
		status:      status,
		description: description,
		retryAfter:  retryAfter,
	}
}

func telegramErrorFromAPI(
	method string,
	errorCode int,
	description string,
	parameters telegramAPIParameters,
) error {
	return &telegramRequestError{
		method:      method,
		statusCode:  errorCode,
		status:      "api error",
		description: firstNonEmpty(strings.TrimSpace(description), "telegram api request failed"),
		retryAfter:  time.Duration(parameters.RetryAfter) * time.Second,
	}
}

func parseTelegramRetryAfterHeader(value string) time.Duration {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	if seconds, err := strconv.Atoi(trimmed); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}

	if retryAt, err := http.ParseTime(trimmed); err == nil {
		delay := time.Until(retryAt)
		if delay > 0 {
			return delay
		}
	}

	return 0
}

func isTransientTelegramTransportError(err error) bool {
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

	return false
}

func wrapTelegramPollingTransportError(err error, proxyURL string) error {
	if err == nil {
		return nil
	}

	trimmedProxyURL := strings.TrimSpace(proxyURL)
	if trimmedProxyURL == "" {
		return err
	}

	var existing interface{ PollingProxyURL() string }
	if errors.As(err, &existing) && strings.TrimSpace(existing.PollingProxyURL()) != "" {
		return err
	}

	return &telegramPollingTransportDiagnosticError{
		cause:    err,
		proxyURL: trimmedProxyURL,
	}
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func buildWebhookURL(publicBaseURL string, connectionID string) (string, error) {
	trimmed := strings.TrimSpace(publicBaseURL)
	if trimmed == "" {
		return "", ErrPublicBaseURLMissing
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("%w: public base url must be absolute", ErrInvalidInput)
	}

	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/hooks/bots/" + connectionID
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func parseTelegramDeliveryMode(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", telegramDeliveryModeWebhook:
		return telegramDeliveryModeWebhook, nil
	case telegramDeliveryModePolling:
		return telegramDeliveryModePolling, nil
	default:
		return "", fmt.Errorf("%w: telegram delivery mode must be webhook or polling", ErrInvalidInput)
	}
}

func telegramDeliveryMode(connection store.BotConnection) string {
	mode, err := parseTelegramDeliveryMode(connection.Settings[telegramDeliveryModeSetting])
	if err != nil {
		return telegramDeliveryModeWebhook
	}
	return mode
}

func parseTelegramUpdateOffset(value string) (int64, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, nil
	}

	offset, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || offset < 0 {
		return 0, fmt.Errorf("%w: telegram update offset must be a non-negative integer", ErrInvalidInput)
	}
	return offset, nil
}

func telegramPollingConflictError(ownerConnectionID string) error {
	message := "telegram polling token is already claimed by another active polling connection"
	if owner := strings.TrimSpace(ownerConnectionID); owner != "" {
		message += " (" + owner + ")"
	}
	message += "; pause or delete the other polling connection, or switch one connection to webhook mode"
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

func telegramConversationID(chatID string, threadID string) string {
	trimmedChatID := strings.TrimSpace(chatID)
	trimmedThreadID := strings.TrimSpace(threadID)
	if trimmedThreadID == "" {
		return trimmedChatID
	}
	return trimmedChatID + ":thread:" + trimmedThreadID
}

func telegramThreadID(messageThreadID int64) string {
	if messageThreadID <= 0 {
		return ""
	}
	return strconv.FormatInt(messageThreadID, 10)
}

func splitTelegramText(value string, maxRunes int) []string {
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
		size := maxRunes
		if len(runes) < size {
			size = len(runes)
		}

		chunk := string(runes[:size])
		chunks = append(chunks, chunk)
		runes = runes[size:]
	}

	return chunks
}

func telegramMessageChunks(messages []OutboundMessage, maxRunes int) []string {
	chunks := make([]string, 0)
	for _, message := range messages {
		chunks = append(chunks, splitTelegramText(message.Text, maxRunes)...)
	}
	return chunks
}

func (p *telegramProvider) sendTextMessage(
	ctx context.Context,
	token string,
	chatID string,
	threadID string,
	text string,
) (telegramSentMessage, error) {
	var result telegramSentMessage
	if err := p.withDeliveryRetry(ctx, func(ctx context.Context) error {
		var response telegramAPIResponse[telegramSentMessage]
		payload := map[string]any{
			"chat_id": chatID,
			"text":    text,
		}
		if parsedThreadID, ok := telegramSendMessageThreadID(threadID); ok {
			payload["message_thread_id"] = parsedThreadID
		}
		if err := p.callJSON(ctx, token, "sendMessage", payload, &response); err != nil {
			return err
		}
		result = response.Result
		return nil
	}); err != nil {
		return telegramSentMessage{}, err
	}

	return result, nil
}

func telegramSendMessageThreadID(threadID string) (int64, bool) {
	trimmed := strings.TrimSpace(threadID)
	if trimmed == "" {
		return 0, false
	}

	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || parsed <= 0 {
		return 0, false
	}

	return parsed, true
}

func (p *telegramProvider) editTextMessage(
	ctx context.Context,
	token string,
	chatID string,
	messageID int64,
	text string,
) error {
	return p.withDeliveryRetry(ctx, func(ctx context.Context) error {
		var response telegramAPIResponse[telegramSentMessage]
		return p.callJSON(ctx, token, "editMessageText", map[string]any{
			"chat_id":    chatID,
			"message_id": messageID,
			"text":       text,
		}, &response)
	})
}

func (p *telegramProvider) deleteTextMessage(
	ctx context.Context,
	token string,
	chatID string,
	messageID int64,
) error {
	return p.withDeliveryRetry(ctx, func(ctx context.Context) error {
		var response telegramAPIResponse[bool]
		return p.callJSON(ctx, token, "deleteMessage", map[string]any{
			"chat_id":    chatID,
			"message_id": messageID,
		}, &response)
	})
}

func (s *telegramStreamingReplySession) Update(ctx context.Context, update StreamingUpdate) error {
	return s.reconcile(ctx, normalizeStreamingMessages(update), false)
}

func (s *telegramStreamingReplySession) Complete(ctx context.Context, messages []OutboundMessage) error {
	return s.reconcile(ctx, messages, true)
}

func (s *telegramStreamingReplySession) Fail(ctx context.Context, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		text = defaultStreamingFailureText
	}

	return s.reconcile(ctx, []OutboundMessage{{Text: text}}, true)
}

func (s *telegramStreamingReplySession) reconcile(
	ctx context.Context,
	messages []OutboundMessage,
	shrink bool,
) error {
	if !shrink {
		if err := validateTelegramStreamingUpdateMessages(messages); err != nil {
			return err
		}
	}
	if shrink && telegramMessagesContainMedia(messages) {
		return s.completeWithMedia(ctx, messages)
	}
	if err := validateTelegramOutboundMessages(messages); err != nil {
		return err
	}
	chunks := telegramMessageChunks(messages, telegramTextLimitRunes)
	logBotDebug(ctx, s.connection, "telegram reconcile streaming reply",
		slog.String("externalChatId", s.chatID),
		slog.String("externalThreadId", s.threadID),
		slog.Int("messageCount", len(messages)),
		slog.Int("chunkCount", len(chunks)),
		slog.Bool("shrink", shrink),
		slog.Any("messages", debugOutboundMessages(messages)),
	)

	s.mu.Lock()
	defer s.mu.Unlock()

	for index, chunk := range chunks {
		if index < len(s.messageIDs) {
			if index < len(s.lastChunks) && chunk == s.lastChunks[index] {
				continue
			}
			logBotDebug(ctx, s.connection, "telegram editing streamed chunk",
				slog.String("externalChatId", s.chatID),
				slog.String("externalThreadId", s.threadID),
				slog.Int("chunkIndex", index),
				slog.Int64("messageId", s.messageIDs[index]),
				slog.Int("chunkLength", len([]rune(chunk))),
				slog.String("chunkPreview", debugTextPreview(chunk)),
			)
			if err := s.provider.editTextMessage(ctx, s.token, s.chatID, s.messageIDs[index], chunk); err != nil && !isTelegramMessageNotModified(err) {
				return err
			}
			s.lastChunks[index] = chunk
			continue
		}

		logBotDebug(ctx, s.connection, "telegram sending streamed chunk",
			slog.String("externalChatId", s.chatID),
			slog.String("externalThreadId", s.threadID),
			slog.Int("chunkIndex", index),
			slog.Int("chunkLength", len([]rune(chunk))),
			slog.String("chunkPreview", debugTextPreview(chunk)),
		)
		sent, err := s.provider.sendTextMessage(ctx, s.token, s.chatID, s.threadID, chunk)
		if err != nil {
			return err
		}
		s.messageIDs = append(s.messageIDs, sent.MessageID)
		s.lastChunks = append(s.lastChunks, chunk)
	}

	if !shrink || len(s.messageIDs) <= len(chunks) {
		return nil
	}

	for index := len(s.messageIDs) - 1; index >= len(chunks); index-- {
		logBotDebug(ctx, s.connection, "telegram deleting extra streamed chunk",
			slog.String("externalChatId", s.chatID),
			slog.String("externalThreadId", s.threadID),
			slog.Int("chunkIndex", index),
			slog.Int64("messageId", s.messageIDs[index]),
		)
		if err := s.provider.deleteTextMessage(ctx, s.token, s.chatID, s.messageIDs[index]); err != nil {
			return err
		}
	}

	s.messageIDs = append([]int64(nil), s.messageIDs[:len(chunks)]...)
	s.lastChunks = append([]string(nil), s.lastChunks[:len(chunks)]...)
	return nil
}

func (s *telegramStreamingReplySession) completeWithMedia(ctx context.Context, messages []OutboundMessage) error {
	if err := validateTelegramOutboundMessages(messages); err != nil {
		return err
	}

	logBotDebug(ctx, s.connection, "telegram completing streamed reply with media",
		slog.String("externalChatId", s.chatID),
		slog.String("externalThreadId", s.threadID),
		slog.Int("messageCount", len(messages)),
		slog.Any("messages", debugOutboundMessages(messages)),
	)

	s.mu.Lock()
	defer s.mu.Unlock()

	for index := len(s.messageIDs) - 1; index >= 0; index-- {
		logBotDebug(ctx, s.connection, "telegram deleting streamed chunk before final media send",
			slog.String("externalChatId", s.chatID),
			slog.String("externalThreadId", s.threadID),
			slog.Int("chunkIndex", index),
			slog.Int64("messageId", s.messageIDs[index]),
		)
		if err := s.provider.deleteTextMessage(ctx, s.token, s.chatID, s.messageIDs[index]); err != nil {
			return err
		}
	}
	s.messageIDs = nil
	s.lastChunks = nil

	return s.provider.SendMessages(ctx, s.connection, store.BotConversation{
		ExternalChatID:   s.chatID,
		ExternalThreadID: s.threadID,
	}, messages)
}

func isTelegramMessageNotModified(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(strings.TrimSpace(err.Error())), "message is not modified")
}

func cloneStringMapLocal(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func joinName(values ...string) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		parts = append(parts, value)
	}
	return strings.Join(parts, " ")
}

func randomHex(byteLength int) (string, error) {
	if byteLength <= 0 {
		byteLength = 16
	}

	buffer := make([]byte, byteLength)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate secret: %w", err)
	}

	return hex.EncodeToString(buffer), nil
}
