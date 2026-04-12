package bots

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

const (
	telegramMediaGroupIDProviderDataKey         = "telegram_media_group_id"
	telegramMediaGroupMessageIDsProviderDataKey = "telegram_media_group_message_ids"
	telegramMediaGroupLateBatchProviderDataKey  = "telegram_media_group_late_batch"
	telegramMediaFileIDProviderDataKey          = "telegram_media_file_id"
	telegramMediaKindProviderDataKey            = "telegram_media_kind"
)

type telegramPhotoSize struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	FileSize     int    `json:"file_size"`
}

type telegramVideo struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	FileName     string `json:"file_name"`
	MimeType     string `json:"mime_type"`
	FileSize     int    `json:"file_size"`
}

type telegramDocument struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	FileName     string `json:"file_name"`
	MimeType     string `json:"mime_type"`
	FileSize     int    `json:"file_size"`
}

type telegramVoice struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	MimeType     string `json:"mime_type"`
	FileSize     int    `json:"file_size"`
}

type telegramAudio struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	FileName     string `json:"file_name"`
	MimeType     string `json:"mime_type"`
	FileSize     int    `json:"file_size"`
}

type telegramFile struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	FilePath     string `json:"file_path"`
	FileSize     int    `json:"file_size"`
}

type telegramInboundMediaReference struct {
	Kind         string
	FileID       string
	FileUniqueID string
	FileName     string
	ContentType  string
}

func (p *telegramProvider) inboundMessageFromTelegramUpdate(
	ctx context.Context,
	token string,
	update telegramUpdate,
) (InboundMessage, error) {
	if update.Message == nil {
		return InboundMessage{}, ErrWebhookIgnored
	}
	if update.Message.From != nil && update.Message.From.IsBot {
		return InboundMessage{}, ErrWebhookIgnored
	}

	media, providerData := p.extractInboundTelegramMedia(ctx, token, update.Message)
	text := firstNonEmpty(strings.TrimSpace(update.Message.Text), strings.TrimSpace(update.Message.Caption))
	if strings.TrimSpace(text) == "" && len(media) == 0 {
		return InboundMessage{}, ErrWebhookIgnored
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
	chatID := strconv.FormatInt(update.Message.Chat.ID, 10)
	threadID := telegramThreadID(update.Message.MessageThreadID)

	return InboundMessage{
		ConversationID:   telegramConversationID(chatID, threadID),
		ExternalChatID:   chatID,
		ExternalThreadID: threadID,
		MessageID:        strconv.FormatInt(update.Message.MessageID, 10),
		UserID:           userID,
		Username:         username,
		Title:            title,
		Text:             text,
		Media:            media,
		ProviderData:     providerData,
	}, nil
}

func (p *telegramProvider) extractInboundTelegramMedia(
	ctx context.Context,
	token string,
	message *telegramMessage,
) ([]store.BotMessageMedia, map[string]string) {
	if message == nil {
		return nil, nil
	}

	reference, ok := telegramInboundMediaReferenceFromMessage(message)
	if !ok {
		if groupID := strings.TrimSpace(message.MediaGroupID); groupID != "" {
			return nil, map[string]string{
				telegramMediaGroupIDProviderDataKey: groupID,
			}
		}
		return nil, nil
	}

	media := store.BotMessageMedia{
		Kind:        reference.Kind,
		FileName:    strings.TrimSpace(reference.FileName),
		ContentType: strings.TrimSpace(reference.ContentType),
	}

	if token != "" && reference.FileID != "" {
		if data, fileName, contentType, err := p.downloadInboundTelegramMedia(ctx, token, reference); err == nil && len(data) > 0 {
			if contentType != "" {
				media.ContentType = contentType
			}
			if fileName != "" {
				media.FileName = fileName
			}
			if filePath, _, err := persistTelegramTempMedia(data, media.ContentType, media.FileName, "inbound"); err == nil {
				media.Path = filePath
				if media.FileName == "" {
					media.FileName = filepath.Base(filePath)
				}
			}
		}
	}

	providerData := map[string]string{
		telegramMediaKindProviderDataKey: reference.Kind,
	}
	if fileID := strings.TrimSpace(reference.FileID); fileID != "" {
		providerData[telegramMediaFileIDProviderDataKey] = fileID
	}
	if groupID := strings.TrimSpace(message.MediaGroupID); groupID != "" {
		providerData[telegramMediaGroupIDProviderDataKey] = groupID
	}

	return []store.BotMessageMedia{media}, providerData
}

func telegramInboundMediaReferenceFromMessage(message *telegramMessage) (telegramInboundMediaReference, bool) {
	if message == nil {
		return telegramInboundMediaReference{}, false
	}

	if len(message.Photo) > 0 {
		photo := telegramLargestPhoto(message.Photo)
		return telegramInboundMediaReference{
			Kind:         botMediaKindImage,
			FileID:       strings.TrimSpace(photo.FileID),
			FileUniqueID: strings.TrimSpace(photo.FileUniqueID),
			ContentType:  "image/jpeg",
		}, strings.TrimSpace(photo.FileID) != ""
	}
	if message.Video != nil && strings.TrimSpace(message.Video.FileID) != "" {
		return telegramInboundMediaReference{
			Kind:         botMediaKindVideo,
			FileID:       strings.TrimSpace(message.Video.FileID),
			FileUniqueID: strings.TrimSpace(message.Video.FileUniqueID),
			FileName:     strings.TrimSpace(message.Video.FileName),
			ContentType:  strings.TrimSpace(message.Video.MimeType),
		}, true
	}
	if message.Document != nil && strings.TrimSpace(message.Document.FileID) != "" {
		return telegramInboundMediaReference{
			Kind:         botMediaKindFile,
			FileID:       strings.TrimSpace(message.Document.FileID),
			FileUniqueID: strings.TrimSpace(message.Document.FileUniqueID),
			FileName:     strings.TrimSpace(message.Document.FileName),
			ContentType:  strings.TrimSpace(message.Document.MimeType),
		}, true
	}
	if message.Voice != nil && strings.TrimSpace(message.Voice.FileID) != "" {
		return telegramInboundMediaReference{
			Kind:         botMediaKindVoice,
			FileID:       strings.TrimSpace(message.Voice.FileID),
			FileUniqueID: strings.TrimSpace(message.Voice.FileUniqueID),
			FileName:     "voice.ogg",
			ContentType:  firstNonEmpty(strings.TrimSpace(message.Voice.MimeType), "audio/ogg"),
		}, true
	}
	if message.Audio != nil && strings.TrimSpace(message.Audio.FileID) != "" {
		return telegramInboundMediaReference{
			Kind:         botMediaKindAudio,
			FileID:       strings.TrimSpace(message.Audio.FileID),
			FileUniqueID: strings.TrimSpace(message.Audio.FileUniqueID),
			FileName:     strings.TrimSpace(message.Audio.FileName),
			ContentType:  strings.TrimSpace(message.Audio.MimeType),
		}, true
	}
	return telegramInboundMediaReference{}, false
}

func telegramLargestPhoto(items []telegramPhotoSize) telegramPhotoSize {
	if len(items) == 0 {
		return telegramPhotoSize{}
	}

	best := items[0]
	bestScore := best.Width*best.Height + best.FileSize
	for _, candidate := range items[1:] {
		score := candidate.Width*candidate.Height + candidate.FileSize
		if score > bestScore {
			best = candidate
			bestScore = score
		}
	}
	return best
}

func (p *telegramProvider) downloadInboundTelegramMedia(
	ctx context.Context,
	token string,
	reference telegramInboundMediaReference,
) ([]byte, string, string, error) {
	file, err := p.getFile(ctx, token, reference.FileID)
	if err != nil {
		return nil, "", "", err
	}
	if strings.TrimSpace(file.FilePath) == "" {
		return nil, "", "", fmt.Errorf("telegram getFile returned an empty file_path for %s", reference.FileID)
	}

	data, contentType, err := p.downloadTelegramFileContent(ctx, token, file.FilePath)
	if err != nil {
		return nil, "", "", err
	}
	fileName := firstNonEmpty(
		strings.TrimSpace(reference.FileName),
		filepath.Base(strings.TrimSpace(file.FilePath)),
	)
	contentType = firstNonEmpty(strings.TrimSpace(contentType), strings.TrimSpace(reference.ContentType))
	if contentType == "" {
		if byExt := mime.TypeByExtension(strings.ToLower(filepath.Ext(fileName))); byExt != "" {
			contentType = trimHTTPContentType(byExt)
		}
	}
	return data, fileName, contentType, nil
}

func (p *telegramProvider) getFile(ctx context.Context, token string, fileID string) (telegramFile, error) {
	var response telegramAPIResponse[telegramFile]
	if err := p.callJSON(ctx, token, "getFile", map[string]any{"file_id": strings.TrimSpace(fileID)}, &response); err != nil {
		return telegramFile{}, err
	}
	return response.Result, nil
}

func (p *telegramProvider) downloadTelegramFileContent(
	ctx context.Context,
	token string,
	filePath string,
) ([]byte, string, error) {
	targetURL, err := p.fileURL(token, filePath)
	if err != nil {
		return nil, "", err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("build telegram file download request: %w", err)
	}
	response, err := p.client(30 * time.Second).Do(request)
	if err != nil {
		return nil, "", fmt.Errorf("download telegram file %q: %w", filePath, err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return nil, "", telegramErrorFromHTTP("downloadFile", response.StatusCode, response.Status, response.Header, content)
	}

	data, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, "", fmt.Errorf("read telegram file %q: %w", filePath, err)
	}
	return data, trimHTTPContentType(response.Header.Get("Content-Type")), nil
}

func (p *telegramProvider) fileURL(token string, filePath string) (string, error) {
	base, err := url.Parse(strings.TrimRight(p.apiBaseURL, "/"))
	if err != nil {
		return "", fmt.Errorf("invalid telegram api base url: %w", err)
	}

	base.Path = strings.TrimRight(base.Path, "/") + "/file/bot" + token + "/" + strings.TrimLeft(filePath, "/")
	base.RawQuery = ""
	base.Fragment = ""
	return base.String(), nil
}

func persistTelegramTempMedia(data []byte, contentType string, fileNameHint string, direction string) (string, func(), error) {
	dir := filepath.Join(os.TempDir(), "codex-server", "telegram", "media", strings.TrimSpace(direction))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, fmt.Errorf("create telegram media temp dir: %w", err)
	}

	ext := filepath.Ext(strings.TrimSpace(fileNameHint))
	if ext == "" && contentType != "" {
		if extensions, err := mime.ExtensionsByType(contentType); err == nil && len(extensions) > 0 {
			ext = extensions[0]
		}
	}
	if ext == "" {
		ext = ".bin"
	}

	baseName := strings.TrimSpace(fileNameHint)
	if baseName == "" {
		randomPart, err := randomHex(16)
		if err != nil {
			return "", nil, err
		}
		baseName = "telegram-media-" + randomPart + ext
	} else {
		baseName = filepath.Base(baseName)
		if filepath.Ext(baseName) == "" {
			baseName += ext
		}
	}

	filePath := filepath.Join(dir, baseName)
	if _, err := os.Stat(filePath); err == nil {
		randomPart, randomErr := randomHex(16)
		if randomErr != nil {
			return "", nil, randomErr
		}
		filePath = filepath.Join(dir, strings.TrimSuffix(baseName, filepath.Ext(baseName))+"-"+randomPart+filepath.Ext(baseName))
	}

	if err := os.WriteFile(filePath, data, 0o600); err != nil {
		return "", nil, fmt.Errorf("write telegram media temp file: %w", err)
	}

	cleanup := func() {
		_ = os.Remove(filePath)
	}
	return filePath, cleanup, nil
}

func trimHTTPContentType(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if separator := strings.Index(trimmed, ";"); separator >= 0 {
		trimmed = trimmed[:separator]
	}
	return strings.TrimSpace(trimmed)
}
