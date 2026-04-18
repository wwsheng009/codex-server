package bots

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"codex-server/backend/internal/store"
)

func (p *feishuProvider) extractInboundFeishuImage(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	raw string,
) ([]store.BotMessageMedia, error) {
	var payload struct {
		ImageKey string `json:"image_key"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, fmt.Errorf("%w: decode feishu image content: %s", ErrInvalidInput, err.Error())
	}
	if strings.TrimSpace(payload.ImageKey) == "" {
		return nil, ErrWebhookIgnored
	}
	media, err := p.downloadInboundFeishuImageByKey(ctx, connection, messageID, strings.TrimSpace(payload.ImageKey), "")
	if err != nil {
		return nil, err
	}
	return []store.BotMessageMedia{media}, nil
}

func (p *feishuProvider) extractInboundFeishuFile(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	raw string,
) ([]store.BotMessageMedia, error) {
	var payload struct {
		FileKey  string `json:"file_key"`
		FileName string `json:"file_name"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, fmt.Errorf("%w: decode feishu file content: %s", ErrInvalidInput, err.Error())
	}
	if strings.TrimSpace(payload.FileKey) == "" {
		return nil, ErrWebhookIgnored
	}
	media, err := p.downloadInboundFeishuFileByKey(ctx, connection, messageID, strings.TrimSpace(payload.FileKey), strings.TrimSpace(payload.FileName))
	if err != nil {
		return nil, err
	}
	return []store.BotMessageMedia{media}, nil
}

func (p *feishuProvider) extractInboundFeishuAudio(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	raw string,
) ([]store.BotMessageMedia, error) {
	var payload struct {
		FileKey string `json:"file_key"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, fmt.Errorf("%w: decode feishu audio content: %s", ErrInvalidInput, err.Error())
	}
	if strings.TrimSpace(payload.FileKey) == "" {
		return nil, ErrWebhookIgnored
	}
	media, err := p.downloadInboundFeishuAudioByKey(ctx, connection, messageID, strings.TrimSpace(payload.FileKey))
	if err != nil {
		return nil, err
	}
	return []store.BotMessageMedia{media}, nil
}

func (p *feishuProvider) downloadInboundFeishuImageByKey(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	imageKey string,
	fileNameHint string,
) (store.BotMessageMedia, error) {
	data, contentType, _, err := p.downloadMessageResource(ctx, connection, messageID, imageKey, "image")
	if err != nil {
		return store.BotMessageMedia{}, err
	}
	contentType = trimHTTPContentType(contentType)
	if contentType == "" {
		contentType = detectFeishuContentType(fileNameHint, data)
	}
	filePath, _, err := persistFeishuTempMedia(data, contentType, firstNonEmpty(strings.TrimSpace(fileNameHint), "image"), "inbound")
	if err != nil {
		return store.BotMessageMedia{}, err
	}
	return store.BotMessageMedia{
		Kind:        botMediaKindImage,
		Path:        filePath,
		FileName:    filepath.Base(filePath),
		ContentType: contentType,
	}, nil
}

func (p *feishuProvider) downloadInboundFeishuFileByKey(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	fileKey string,
	fileNameHint string,
) (store.BotMessageMedia, error) {
	data, contentType, headerFileName, err := p.downloadMessageResource(ctx, connection, messageID, fileKey, "file")
	if err != nil {
		return store.BotMessageMedia{}, err
	}
	fileName := firstNonEmpty(strings.TrimSpace(fileNameHint), strings.TrimSpace(headerFileName), "attachment")
	contentType = trimHTTPContentType(contentType)
	if contentType == "" {
		contentType = detectFeishuContentType(fileName, data)
	}
	filePath, _, err := persistFeishuTempMedia(data, contentType, fileName, "inbound")
	if err != nil {
		return store.BotMessageMedia{}, err
	}
	return store.BotMessageMedia{
		Kind:        botMediaKindFile,
		Path:        filePath,
		FileName:    fileName,
		ContentType: contentType,
	}, nil
}

func (p *feishuProvider) downloadInboundFeishuAudioByKey(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	fileKey string,
) (store.BotMessageMedia, error) {
	data, contentType, headerFileName, err := p.downloadMessageResource(ctx, connection, messageID, fileKey, "file")
	if err != nil {
		return store.BotMessageMedia{}, err
	}
	fileName := firstNonEmpty(strings.TrimSpace(headerFileName), "voice.ogg")
	contentType = trimHTTPContentType(contentType)
	if contentType == "" {
		contentType = "audio/ogg"
	}
	filePath, _, err := persistFeishuTempMedia(data, contentType, fileName, "inbound")
	if err != nil {
		return store.BotMessageMedia{}, err
	}
	return store.BotMessageMedia{
		Kind:        botMediaKindVoice,
		Path:        filePath,
		FileName:    filepath.Base(filePath),
		ContentType: contentType,
	}, nil
}

func (p *feishuProvider) downloadMessageResource(
	ctx context.Context,
	connection store.BotConnection,
	messageID string,
	fileKey string,
	resourceType string,
) ([]byte, string, string, error) {
	appID := strings.TrimSpace(connection.Settings[feishuAppIDSetting])
	if appID == "" {
		return nil, "", "", fmt.Errorf("%w: feishu app id is required", ErrInvalidInput)
	}
	appSecret := strings.TrimSpace(connection.Secrets[feishuAppSecretKey])
	if appSecret == "" {
		return nil, "", "", fmt.Errorf("%w: feishu app secret is required", ErrInvalidInput)
	}
	domain, err := p.providerDomain(connection)
	if err != nil {
		return nil, "", "", err
	}
	token, err := p.tenantAccessToken(ctx, domain, appID, appSecret)
	if err != nil {
		return nil, "", "", err
	}

	requestPath := "/open-apis/im/v1/messages/" + url.PathEscape(strings.TrimSpace(messageID)) + "/resources/" + url.PathEscape(strings.TrimSpace(fileKey)) + "?type=" + url.QueryEscape(strings.TrimSpace(resourceType))
	endpoint, err := buildFeishuURL(domain, requestPath)
	if err != nil {
		return nil, "", "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", "", fmt.Errorf("build feishu %s request: %w", requestPath, err)
	}
	request.Header.Set("Authorization", "Bearer "+token)

	response, err := p.client(feishuDefaultHTTPTimeout).Do(request)
	if err != nil {
		return nil, "", "", &feishuRequestError{operation: requestPath, cause: err}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		content, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		return nil, "", "", feishuRequestErrorFromHTTP(requestPath, response.StatusCode, response.Status, content)
	}

	data, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, "", "", fmt.Errorf("read feishu %s response body: %w", requestPath, err)
	}
	return data, response.Header.Get("Content-Type"), parseFeishuContentDispositionFileName(response.Header.Get("Content-Disposition")), nil
}

func persistFeishuTempMedia(data []byte, contentType string, fileNameHint string, direction string) (string, func(), error) {
	dir := filepath.Join(os.TempDir(), "codex-server", "feishu", "media", strings.TrimSpace(direction))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, fmt.Errorf("create feishu media temp dir: %w", err)
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
		baseName = "feishu-media-" + randomPart + ext
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
		return "", nil, fmt.Errorf("write feishu media temp file: %w", err)
	}

	cleanup := func() {
		_ = os.Remove(filePath)
	}
	return filePath, cleanup, nil
}

func parseFeishuContentDispositionFileName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	_, params, err := mime.ParseMediaType(trimmed)
	if err != nil {
		return ""
	}
	if fileName := strings.TrimSpace(params["filename"]); fileName != "" {
		return filepath.Base(fileName)
	}
	if fileName := strings.TrimSpace(params["filename*"]); fileName != "" {
		return filepath.Base(fileName)
	}
	return ""
}
