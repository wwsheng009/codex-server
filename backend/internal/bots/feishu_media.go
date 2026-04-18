package bots

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"codex-server/backend/internal/store"
)

type feishuResolvedOutboundMedia struct {
	Kind        string
	Data        []byte
	FileName    string
	ContentType string
}

type feishuUploadImageResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		ImageKey string `json:"image_key"`
	} `json:"data"`
}

type feishuUploadFileResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		FileKey string `json:"file_key"`
	} `json:"data"`
}

func (p *feishuProvider) sendMediaMessage(
	ctx context.Context,
	connection store.BotConnection,
	domain string,
	token string,
	chatID string,
	replyMessageID string,
	replyInThread bool,
	media store.BotMessageMedia,
) error {
	resolved, err := p.resolveOutboundMedia(ctx, media)
	if err != nil {
		return err
	}

	switch resolved.Kind {
	case botMediaKindImage:
		imageKey, err := p.uploadImage(ctx, domain, token, resolved)
		if err != nil {
			return err
		}
		content, marshalErr := json.Marshal(map[string]string{"image_key": imageKey})
		if marshalErr != nil {
			return fmt.Errorf("encode feishu image content: %w", marshalErr)
		}
		_, err = p.sendFeishuMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, feishuSendPayload{
			Content: string(content),
			MsgType: "image",
		})
		return err
	case botMediaKindVoice:
		fileKey, err := p.uploadAudio(ctx, domain, token, resolved)
		if err != nil {
			return err
		}
		content, marshalErr := json.Marshal(map[string]string{"file_key": fileKey})
		if marshalErr != nil {
			return fmt.Errorf("encode feishu audio content: %w", marshalErr)
		}
		_, err = p.sendFeishuMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, feishuSendPayload{
			Content: string(content),
			MsgType: "audio",
		})
		return err
	default:
		fileKey, err := p.uploadFile(ctx, domain, token, resolved)
		if err != nil {
			return err
		}
		content, marshalErr := json.Marshal(map[string]string{"file_key": fileKey})
		if marshalErr != nil {
			return fmt.Errorf("encode feishu file content: %w", marshalErr)
		}
		_, err = p.sendFeishuMessage(ctx, connection, domain, token, chatID, replyMessageID, replyInThread, feishuSendPayload{
			Content: string(content),
			MsgType: "file",
		})
		return err
	}
}

func (p *feishuProvider) resolveOutboundMedia(ctx context.Context, media store.BotMessageMedia) (feishuResolvedOutboundMedia, error) {
	trimmedURL := strings.TrimSpace(media.URL)
	trimmedPath := strings.TrimSpace(media.Path)
	if trimmedURL == "" && trimmedPath == "" {
		return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: feishu media requires a remote url or absolute local path", ErrInvalidInput)
	}

	data := []byte(nil)
	fileName := strings.TrimSpace(media.FileName)
	contentType := trimHTTPContentType(media.ContentType)

	if trimmedURL != "" {
		parsed, err := url.Parse(trimmedURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: feishu media url must be an absolute http(s) url: %s", ErrInvalidInput, trimmedURL)
		}
		switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
		case "http", "https":
		default:
			return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: feishu media url must use http or https: %s", ErrInvalidInput, trimmedURL)
		}

		request, err := http.NewRequestWithContext(ctx, http.MethodGet, trimmedURL, nil)
		if err != nil {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: invalid feishu media url %q", ErrInvalidInput, trimmedURL)
		}
		response, err := p.client(feishuDefaultHTTPTimeout).Do(request)
		if err != nil {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("download feishu media url %q: %w", trimmedURL, err)
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: feishu media url %q returned %s", ErrInvalidInput, trimmedURL, response.Status)
		}

		data, err = io.ReadAll(response.Body)
		if err != nil {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("read feishu media url %q: %w", trimmedURL, err)
		}
		if contentType == "" {
			contentType = trimHTTPContentType(response.Header.Get("Content-Type"))
		}
		if fileName == "" {
			fileName = filepath.Base(parsed.Path)
		}
	} else {
		resolvedPath := trimmedPath
		if strings.HasPrefix(strings.ToLower(resolvedPath), "file://") {
			parsed, err := url.Parse(resolvedPath)
			if err != nil {
				return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: invalid feishu media file url %q", ErrInvalidInput, resolvedPath)
			}
			resolvedPath = parsed.Host + parsed.Path
			if len(resolvedPath) >= 3 && resolvedPath[0] == '/' && resolvedPath[2] == ':' {
				resolvedPath = resolvedPath[1:]
			}
			resolvedPath = filepath.FromSlash(resolvedPath)
		}
		if !filepath.IsAbs(resolvedPath) {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: feishu media file path must be absolute: %s", ErrInvalidInput, resolvedPath)
		}
		info, err := os.Stat(resolvedPath)
		if err != nil {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("stat feishu media file %q: %w", resolvedPath, err)
		}
		if info.IsDir() {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: feishu media file path must be a file: %s", ErrInvalidInput, resolvedPath)
		}

		data, err = os.ReadFile(resolvedPath)
		if err != nil {
			return feishuResolvedOutboundMedia{}, fmt.Errorf("read feishu media file %q: %w", resolvedPath, err)
		}
		if fileName == "" {
			fileName = filepath.Base(resolvedPath)
		}
	}

	if fileName == "" || fileName == "." || fileName == "/" {
		fileName = "attachment"
	}

	if contentType == "" {
		contentType = detectFeishuContentType(fileName, data)
	}

	explicitKind := strings.ToLower(strings.TrimSpace(media.Kind))
	if explicitKind == botMediaKindAudio || explicitKind == botMediaKindVoice {
		if !looksLikeFeishuAudioMessage(fileName, contentType) {
			converted, convertedName, convertedType, err := transcodeFeishuAudioToOpus(ctx, data, fileName)
			if err != nil {
				return feishuResolvedOutboundMedia{}, err
			}
			data = converted
			fileName = convertedName
			contentType = convertedType
		}
	}

	kind := normalizeFeishuOutboundMediaKind(media.Kind, fileName, contentType)
	if kind == botMediaKindImage && !looksLikeFeishuImage(fileName, contentType) {
		return feishuResolvedOutboundMedia{}, fmt.Errorf("%w: feishu image attachments must be image files", ErrInvalidInput)
	}

	return feishuResolvedOutboundMedia{
		Kind:        kind,
		Data:        data,
		FileName:    fileName,
		ContentType: contentType,
	}, nil
}

func normalizeFeishuOutboundMediaKind(kind string, fileName string, contentType string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case botMediaKindImage:
		return botMediaKindImage
	case botMediaKindAudio, botMediaKindVoice:
		if looksLikeFeishuAudioMessage(fileName, contentType) {
			return botMediaKindVoice
		}
		return botMediaKindFile
	case botMediaKindVideo, botMediaKindFile:
		return botMediaKindFile
	}
	if looksLikeFeishuImage(fileName, contentType) {
		return botMediaKindImage
	}
	if looksLikeFeishuAudioMessage(fileName, contentType) {
		return botMediaKindVoice
	}
	return botMediaKindFile
}

func looksLikeFeishuImage(fileName string, contentType string) bool {
	lowerType := strings.ToLower(strings.TrimSpace(contentType))
	if strings.HasPrefix(lowerType, "image/") {
		return true
	}
	lowerName := strings.ToLower(strings.TrimSpace(fileName))
	switch filepath.Ext(lowerName) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff":
		return true
	default:
		return false
	}
}

func looksLikeFeishuAudioMessage(fileName string, contentType string) bool {
	lowerType := strings.ToLower(strings.TrimSpace(contentType))
	if lowerType == "audio/ogg" || lowerType == "audio/opus" {
		return true
	}
	lowerName := strings.ToLower(strings.TrimSpace(fileName))
	switch filepath.Ext(lowerName) {
	case ".opus", ".ogg", ".oga":
		return true
	default:
		return false
	}
}

func detectFeishuContentType(fileName string, data []byte) string {
	if byExt := mime.TypeByExtension(strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))); byExt != "" {
		return trimHTTPContentType(byExt)
	}
	if len(data) == 0 {
		return "application/octet-stream"
	}
	sniff := data
	if len(sniff) > 512 {
		sniff = sniff[:512]
	}
	return trimHTTPContentType(http.DetectContentType(sniff))
}

func (p *feishuProvider) uploadImage(ctx context.Context, domain string, token string, media feishuResolvedOutboundMedia) (string, error) {
	response := feishuUploadImageResponse{}
	if err := p.callMultipart(
		ctx,
		domain,
		"/open-apis/im/v1/images",
		token,
		map[string]string{"image_type": "message"},
		"image",
		media.FileName,
		media.Data,
		&response,
	); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.Data.ImageKey) == "" {
		return "", fmt.Errorf("feishu upload image response did not include image_key")
	}
	return strings.TrimSpace(response.Data.ImageKey), nil
}

func (p *feishuProvider) uploadFile(ctx context.Context, domain string, token string, media feishuResolvedOutboundMedia) (string, error) {
	response := feishuUploadFileResponse{}
	if err := p.callMultipart(
		ctx,
		domain,
		"/open-apis/im/v1/files",
		token,
		map[string]string{
			"file_type": detectFeishuFileType(media.ContentType, media.FileName),
			"file_name": media.FileName,
		},
		"file",
		media.FileName,
		media.Data,
		&response,
	); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.Data.FileKey) == "" {
		return "", fmt.Errorf("feishu upload file response did not include file_key")
	}
	return strings.TrimSpace(response.Data.FileKey), nil
}

func (p *feishuProvider) uploadAudio(ctx context.Context, domain string, token string, media feishuResolvedOutboundMedia) (string, error) {
	if !looksLikeFeishuAudioMessage(media.FileName, media.ContentType) {
		return "", fmt.Errorf("%w: feishu voice/audio attachments must be Opus or Ogg files", ErrInvalidInput)
	}

	response := feishuUploadFileResponse{}
	if err := p.callMultipart(
		ctx,
		domain,
		"/open-apis/im/v1/files",
		token,
		map[string]string{
			"file_type": "opus",
			"file_name": firstNonEmpty(strings.TrimSpace(media.FileName), "tts_audio.opus"),
		},
		"file",
		firstNonEmpty(strings.TrimSpace(media.FileName), "tts_audio.opus"),
		media.Data,
		&response,
	); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.Data.FileKey) == "" {
		return "", fmt.Errorf("feishu upload audio response did not include file_key")
	}
	return strings.TrimSpace(response.Data.FileKey), nil
}

func detectFeishuFileType(contentType string, fileName string) string {
	name := strings.ToLower(strings.TrimSpace(fileName))
	switch {
	case contentType == "application/pdf" || strings.HasSuffix(name, ".pdf"):
		return "pdf"
	case strings.HasSuffix(name, ".doc") || strings.HasSuffix(name, ".docx"):
		return "doc"
	case strings.HasSuffix(name, ".xls") || strings.HasSuffix(name, ".xlsx") || strings.HasSuffix(name, ".csv"):
		return "xls"
	case strings.HasSuffix(name, ".ppt") || strings.HasSuffix(name, ".pptx"):
		return "ppt"
	case contentType == "video/mp4" || strings.HasSuffix(name, ".mp4"):
		return "mp4"
	case contentType == "audio/ogg" || contentType == "audio/opus" || strings.HasSuffix(name, ".opus"):
		return "opus"
	default:
		return "stream"
	}
}

func (p *feishuProvider) callMultipart(
	ctx context.Context,
	domain string,
	requestPath string,
	bearerToken string,
	fields map[string]string,
	fileField string,
	fileName string,
	fileData []byte,
	target any,
) error {
	endpoint, err := buildFeishuURL(domain, requestPath)
	if err != nil {
		return err
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		if err := writer.WriteField(key, value); err != nil {
			_ = writer.Close()
			return fmt.Errorf("write feishu %s multipart field %q: %w", requestPath, key, err)
		}
	}
	part, err := writer.CreateFormFile(fileField, fileName)
	if err != nil {
		_ = writer.Close()
		return fmt.Errorf("create feishu %s multipart file part: %w", requestPath, err)
	}
	if _, err := io.Copy(part, bytes.NewReader(fileData)); err != nil {
		_ = writer.Close()
		return fmt.Errorf("copy feishu %s multipart file data: %w", requestPath, err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("close feishu %s multipart body: %w", requestPath, err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return fmt.Errorf("build feishu %s multipart request: %w", requestPath, err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
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
		return fmt.Errorf("decode feishu %s multipart response: %w", requestPath, err)
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

func (r feishuUploadImageResponse) responseCode() int       { return r.Code }
func (r feishuUploadImageResponse) responseMessage() string { return r.Msg }
func (r feishuUploadFileResponse) responseCode() int        { return r.Code }
func (r feishuUploadFileResponse) responseMessage() string  { return r.Msg }
