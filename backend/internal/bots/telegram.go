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
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

const telegramProviderName = "telegram"

type telegramProvider struct {
	client     *http.Client
	apiBaseURL string
}

type telegramAPIResponse[T any] struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
	Result      T      `json:"result"`
}

type telegramBotInfo struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

type telegramUpdate struct {
	Message *telegramMessage `json:"message"`
}

type telegramMessage struct {
	MessageID int64         `json:"message_id"`
	Text      string        `json:"text"`
	Chat      telegramChat  `json:"chat"`
	From      *telegramUser `json:"from"`
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

func newTelegramProvider(client *http.Client) Provider {
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}

	return &telegramProvider{
		client:     client,
		apiBaseURL: "https://api.telegram.org",
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

	webhookURL, err := buildWebhookURL(publicBaseURL, connection.ID)
	if err != nil {
		return ActivationResult{}, err
	}

	secret := strings.TrimSpace(connection.Secrets["webhook_secret"])
	if secret == "" {
		secret, err = randomHex(16)
		if err != nil {
			return ActivationResult{}, err
		}
	}

	info, err := p.getMe(ctx, token)
	if err != nil {
		return ActivationResult{}, err
	}
	if err := p.setWebhook(ctx, token, webhookURL, secret); err != nil {
		return ActivationResult{}, err
	}

	settings := cloneStringMapLocal(connection.Settings)
	if settings == nil {
		settings = make(map[string]string)
	}
	settings["bot_id"] = strconv.FormatInt(info.ID, 10)
	settings["bot_display_name"] = strings.TrimSpace(info.FirstName)
	settings["bot_username"] = strings.TrimSpace(info.Username)
	settings["webhook_url"] = webhookURL

	secrets := cloneStringMapLocal(connection.Secrets)
	if secrets == nil {
		secrets = make(map[string]string)
	}
	secrets["webhook_secret"] = secret

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

	var response telegramAPIResponse[bool]
	return p.callJSON(ctx, token, "deleteWebhook", map[string]any{
		"drop_pending_updates": false,
	}, &response)
}

func (p *telegramProvider) ParseWebhook(r *http.Request, connection store.BotConnection) ([]InboundMessage, error) {
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
	if update.Message == nil {
		return nil, ErrWebhookIgnored
	}
	if update.Message.From != nil && update.Message.From.IsBot {
		return nil, ErrWebhookIgnored
	}

	text := strings.TrimSpace(update.Message.Text)
	if text == "" {
		return nil, ErrWebhookIgnored
	}

	username := ""
	userID := ""
	if update.Message.From != nil {
		userID = strconv.FormatInt(update.Message.From.ID, 10)
		username = firstNonEmpty(
			strings.TrimSpace(update.Message.From.Username),
			joinName(update.Message.From.FirstName, update.Message.From.LastName),
		)
	}

	title := firstNonEmpty(
		strings.TrimSpace(update.Message.Chat.Title),
		strings.TrimSpace(update.Message.Chat.Username),
		joinName(update.Message.Chat.FirstName, update.Message.Chat.LastName),
		username,
	)

	return []InboundMessage{
		{
			ConversationID: strconv.FormatInt(update.Message.Chat.ID, 10),
			MessageID:      strconv.FormatInt(update.Message.MessageID, 10),
			UserID:         userID,
			Username:       username,
			Title:          title,
			Text:           text,
		},
	}, nil
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

	for _, message := range messages {
		for _, chunk := range splitTelegramText(message.Text, 3900) {
			if strings.TrimSpace(chunk) == "" {
				continue
			}

			var response telegramAPIResponse[map[string]any]
			if err := p.callJSON(ctx, token, "sendMessage", map[string]any{
				"chat_id": chatID,
				"text":    chunk,
			}, &response); err != nil {
				return err
			}
		}
	}

	return nil
}

func (p *telegramProvider) getMe(ctx context.Context, token string) (telegramBotInfo, error) {
	var response telegramAPIResponse[telegramBotInfo]
	if err := p.callJSON(ctx, token, "getMe", nil, &response); err != nil {
		return telegramBotInfo{}, err
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

func (p *telegramProvider) callJSON(
	ctx context.Context,
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

	response, err := p.client.Do(request)
	if err != nil {
		return fmt.Errorf("telegram %s request failed: %w", method, err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("telegram %s returned %s: %s", method, response.Status, strings.TrimSpace(string(content)))
	}

	if target == nil {
		return nil
	}

	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode telegram %s response: %w", method, err)
	}

	if apiErr := extractTelegramAPIError(target); apiErr != "" {
		return errors.New(apiErr)
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

func extractTelegramAPIError(target any) string {
	switch typed := target.(type) {
	case *telegramAPIResponse[telegramBotInfo]:
		if !typed.OK {
			return firstNonEmpty(strings.TrimSpace(typed.Description), "telegram api request failed")
		}
	case *telegramAPIResponse[bool]:
		if !typed.OK {
			return firstNonEmpty(strings.TrimSpace(typed.Description), "telegram api request failed")
		}
	case *telegramAPIResponse[map[string]any]:
		if !typed.OK {
			return firstNonEmpty(strings.TrimSpace(typed.Description), "telegram api request failed")
		}
	}

	return ""
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

func splitTelegramText(value string, maxRunes int) []string {
	text := strings.TrimSpace(value)
	if text == "" {
		return nil
	}
	if maxRunes <= 0 {
		return []string{text}
	}

	runes := []rune(text)
	if len(runes) <= maxRunes {
		return []string{text}
	}

	chunks := make([]string, 0, (len(runes)+maxRunes-1)/maxRunes)
	for len(runes) > 0 {
		size := maxRunes
		if len(runes) < size {
			size = len(runes)
		}

		chunk := strings.TrimSpace(string(runes[:size]))
		if chunk != "" {
			chunks = append(chunks, chunk)
		}
		runes = runes[size:]
	}

	return chunks
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
