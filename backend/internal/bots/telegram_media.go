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
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

const (
	telegramMediaCaptionLimitRunes = 1024
	telegramMediaGroupMaxItems     = 10
)

type telegramResolvedOutboundMedia struct {
	Kind        string
	LocalPath   string
	RemoteURL   string
	FileName    string
	ContentType string
}

type telegramMultipartFile struct {
	FieldName string
	FilePath  string
	FileName  string
}

func telegramMessagesContainMedia(messages []OutboundMessage) bool {
	for _, message := range messages {
		if len(message.Media) > 0 {
			return true
		}
	}
	return false
}

func validateTelegramOutboundMessages(messages []OutboundMessage) error {
	for messageIndex, message := range messages {
		for mediaIndex, media := range message.Media {
			if _, err := resolveTelegramOutboundMedia(media); err != nil {
				return fmt.Errorf(
					"%w: telegram outbound media validation failed for message %d item %d: %v",
					ErrInvalidInput,
					messageIndex+1,
					mediaIndex+1,
					err,
				)
			}
		}
	}
	return nil
}

func validateTelegramStreamingUpdateMessages(messages []OutboundMessage) error {
	if !telegramMessagesContainMedia(messages) {
		return nil
	}
	return fmt.Errorf(
		"%w: telegram streaming updates only support text until completion; send media attachments in the final completed reply",
		ErrInvalidInput,
	)
}

func (p *telegramProvider) sendMediaMessage(
	ctx context.Context,
	token string,
	chatID string,
	threadID string,
	caption string,
	media store.BotMessageMedia,
) (telegramSentMessage, error) {
	resolved, err := resolveTelegramOutboundMedia(media)
	if err != nil {
		return telegramSentMessage{}, err
	}

	method, field := telegramMediaEndpoint(resolved.Kind)

	var result telegramSentMessage
	if err := p.withDeliveryRetry(ctx, func(ctx context.Context) error {
		var response telegramAPIResponse[telegramSentMessage]
		if resolved.RemoteURL != "" {
			payload := map[string]any{
				"chat_id": chatID,
				field:     resolved.RemoteURL,
			}
			if caption != "" {
				payload["caption"] = caption
			}
			if parsedThreadID, ok := telegramSendMessageThreadID(threadID); ok {
				payload["message_thread_id"] = parsedThreadID
			}
			if err := p.callJSON(ctx, token, method, payload, &response); err != nil {
				return err
			}
		} else {
			fields := map[string]string{
				"chat_id": chatID,
			}
			if caption != "" {
				fields["caption"] = caption
			}
			if parsedThreadID, ok := telegramSendMessageThreadID(threadID); ok {
				fields["message_thread_id"] = strconv.FormatInt(parsedThreadID, 10)
			}
			if err := p.callMultipart(ctx, token, method, fields, field, resolved.LocalPath, resolved.FileName, &response); err != nil {
				return err
			}
		}
		result = response.Result
		return nil
	}); err != nil {
		return telegramSentMessage{}, err
	}

	return result, nil
}

func (p *telegramProvider) sendMediaGroup(
	ctx context.Context,
	token string,
	chatID string,
	threadID string,
	caption string,
	media []telegramResolvedOutboundMedia,
) ([]telegramSentMessage, error) {
	if len(media) < 2 {
		return nil, fmt.Errorf("%w: telegram media group requires at least 2 items", ErrInvalidInput)
	}
	if len(media) > telegramMediaGroupMaxItems {
		return nil, fmt.Errorf("%w: telegram media group supports at most %d items", ErrInvalidInput, telegramMediaGroupMaxItems)
	}

	mediaItems := make([]map[string]any, 0, len(media))
	files := make([]telegramMultipartFile, 0, len(media))
	for index, item := range media {
		mediaType := telegramMediaGroupType(item.Kind)
		if mediaType == "" {
			return nil, fmt.Errorf("%w: telegram media kind %q cannot be sent via media group", ErrInvalidInput, item.Kind)
		}

		mediaRef := strings.TrimSpace(item.RemoteURL)
		if mediaRef == "" {
			attachName := fmt.Sprintf("file%d", index)
			mediaRef = "attach://" + attachName
			files = append(files, telegramMultipartFile{
				FieldName: attachName,
				FilePath:  item.LocalPath,
				FileName:  item.FileName,
			})
		}

		entry := map[string]any{
			"type":  mediaType,
			"media": mediaRef,
		}
		if caption != "" && index == 0 {
			entry["caption"] = caption
		}
		mediaItems = append(mediaItems, entry)
	}

	var result []telegramSentMessage
	if err := p.withDeliveryRetry(ctx, func(ctx context.Context) error {
		var response telegramAPIResponse[[]telegramSentMessage]
		if len(files) == 0 {
			payload := map[string]any{
				"chat_id": chatID,
				"media":   mediaItems,
			}
			if parsedThreadID, ok := telegramSendMessageThreadID(threadID); ok {
				payload["message_thread_id"] = parsedThreadID
			}
			if err := p.callJSON(ctx, token, "sendMediaGroup", payload, &response); err != nil {
				return err
			}
		} else {
			mediaJSON, err := json.Marshal(mediaItems)
			if err != nil {
				return fmt.Errorf("marshal telegram sendMediaGroup media payload: %w", err)
			}
			fields := map[string]string{
				"chat_id": chatID,
				"media":   string(mediaJSON),
			}
			if parsedThreadID, ok := telegramSendMessageThreadID(threadID); ok {
				fields["message_thread_id"] = strconv.FormatInt(parsedThreadID, 10)
			}
			if err := p.callMultipartFiles(ctx, token, "sendMediaGroup", fields, files, &response); err != nil {
				return err
			}
		}
		result = append(result[:0], response.Result...)
		return nil
	}); err != nil {
		return nil, err
	}

	return result, nil
}

func (p *telegramProvider) callMultipart(
	ctx context.Context,
	token string,
	method string,
	fields map[string]string,
	fileField string,
	filePath string,
	fileName string,
	target any,
) error {
	return p.callMultipartFiles(ctx, token, method, fields, []telegramMultipartFile{{
		FieldName: fileField,
		FilePath:  filePath,
		FileName:  fileName,
	}}, target)
}

func (p *telegramProvider) callMultipartFiles(
	ctx context.Context,
	token string,
	method string,
	fields map[string]string,
	files []telegramMultipartFile,
	target any,
) error {
	endpoint, err := p.methodURL(token, method)
	if err != nil {
		return err
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if strings.TrimSpace(key) == "" || value == "" {
			continue
		}
		if err := writer.WriteField(key, value); err != nil {
			_ = writer.Close()
			return fmt.Errorf("write telegram %s multipart field %q: %w", method, key, err)
		}
	}
	for _, file := range files {
		handle, err := os.Open(file.FilePath)
		if err != nil {
			_ = writer.Close()
			return fmt.Errorf("open telegram %s upload file %q: %w", method, file.FilePath, err)
		}

		part, err := writer.CreateFormFile(file.FieldName, file.FileName)
		if err != nil {
			handle.Close()
			_ = writer.Close()
			return fmt.Errorf("create telegram %s multipart file part: %w", method, err)
		}
		if _, err := io.Copy(part, handle); err != nil {
			handle.Close()
			_ = writer.Close()
			return fmt.Errorf("copy telegram %s upload file data: %w", method, err)
		}
		if err := handle.Close(); err != nil {
			_ = writer.Close()
			return fmt.Errorf("close telegram %s upload file %q: %w", method, file.FilePath, err)
		}
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("close telegram %s multipart body: %w", method, err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return fmt.Errorf("build telegram %s multipart request: %w", method, err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())

	client := p.client(15 * time.Second)
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
		return fmt.Errorf("decode telegram %s multipart response: %w", method, err)
	}

	if apiErr := extractTelegramAPIError(method, target); apiErr != nil {
		return apiErr
	}
	return nil
}

func resolveTelegramOutboundMedia(media store.BotMessageMedia) (telegramResolvedOutboundMedia, error) {
	trimmedURL := strings.TrimSpace(media.URL)
	trimmedPath := strings.TrimSpace(media.Path)
	if trimmedURL == "" && trimmedPath == "" {
		return telegramResolvedOutboundMedia{}, fmt.Errorf("telegram media requires a remote url or absolute local path")
	}

	kind := normalizeTelegramMediaKind(media.Kind)
	inferredKind := inferTelegramMediaKindFromLocation(firstNonEmpty(trimmedURL, trimmedPath, strings.TrimSpace(media.FileName)))
	if kind == "" {
		kind = inferredKind
	}
	if kind == "" {
		kind = botMediaKindFile
	}

	if trimmedURL != "" {
		parsed, err := url.Parse(trimmedURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return telegramResolvedOutboundMedia{}, fmt.Errorf("telegram media url must be an absolute http(s) url: %s", trimmedURL)
		}
		switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
		case "http", "https":
		default:
			return telegramResolvedOutboundMedia{}, fmt.Errorf("telegram media url must use http or https: %s", trimmedURL)
		}
		return telegramResolvedOutboundMedia{
			Kind:      kind,
			RemoteURL: trimmedURL,
			FileName:  strings.TrimSpace(media.FileName),
		}, nil
	}

	resolvedPath := trimmedPath
	if strings.HasPrefix(strings.ToLower(resolvedPath), "file://") {
		parsed, err := url.Parse(resolvedPath)
		if err != nil {
			return telegramResolvedOutboundMedia{}, fmt.Errorf("invalid telegram media file url %q", resolvedPath)
		}
		resolvedPath = parsed.Host + parsed.Path
		if len(resolvedPath) >= 3 && resolvedPath[0] == '/' && resolvedPath[2] == ':' {
			resolvedPath = resolvedPath[1:]
		}
		resolvedPath = filepath.FromSlash(resolvedPath)
	}
	if !filepath.IsAbs(resolvedPath) {
		return telegramResolvedOutboundMedia{}, fmt.Errorf("telegram media file path must be absolute: %s", resolvedPath)
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return telegramResolvedOutboundMedia{}, fmt.Errorf("stat telegram media file %q: %w", resolvedPath, err)
	}
	if info.IsDir() {
		return telegramResolvedOutboundMedia{}, fmt.Errorf("telegram media file path must be a file: %s", resolvedPath)
	}

	contentType := detectTelegramContentType(resolvedPath, media.ContentType)
	if normalizeTelegramMediaKind(media.Kind) == "" {
		if inferredFromType := inferTelegramMediaKindFromContentType(contentType); inferredFromType != "" {
			kind = inferredFromType
		}
	}

	return telegramResolvedOutboundMedia{
		Kind:        kind,
		LocalPath:   resolvedPath,
		FileName:    firstNonEmpty(strings.TrimSpace(media.FileName), filepath.Base(resolvedPath)),
		ContentType: contentType,
	}, nil
}

func normalizeTelegramMediaKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case botMediaKindImage:
		return botMediaKindImage
	case botMediaKindVideo:
		return botMediaKindVideo
	case botMediaKindVoice:
		return botMediaKindVoice
	case botMediaKindFile:
		return botMediaKindFile
	default:
		return ""
	}
}

func inferTelegramMediaKindFromLocation(location string) string {
	lower := strings.ToLower(strings.TrimSpace(location))
	switch {
	case strings.HasSuffix(lower, ".png"),
		strings.HasSuffix(lower, ".jpg"),
		strings.HasSuffix(lower, ".jpeg"),
		strings.HasSuffix(lower, ".gif"),
		strings.HasSuffix(lower, ".webp"),
		strings.HasSuffix(lower, ".bmp"):
		return botMediaKindImage
	case strings.HasSuffix(lower, ".mp4"),
		strings.HasSuffix(lower, ".mov"),
		strings.HasSuffix(lower, ".webm"),
		strings.HasSuffix(lower, ".mkv"),
		strings.HasSuffix(lower, ".avi"),
		strings.HasSuffix(lower, ".m4v"):
		return botMediaKindVideo
	case strings.HasSuffix(lower, ".ogg"),
		strings.HasSuffix(lower, ".oga"),
		strings.HasSuffix(lower, ".opus"),
		strings.HasSuffix(lower, ".wav"),
		strings.HasSuffix(lower, ".mp3"),
		strings.HasSuffix(lower, ".m4a"):
		return botMediaKindVoice
	default:
		return botMediaKindFile
	}
}

func inferTelegramMediaKindFromContentType(contentType string) string {
	lower := strings.ToLower(strings.TrimSpace(contentType))
	switch {
	case strings.HasPrefix(lower, "image/"):
		return botMediaKindImage
	case strings.HasPrefix(lower, "video/"):
		return botMediaKindVideo
	case strings.HasPrefix(lower, "audio/"):
		return botMediaKindVoice
	default:
		return ""
	}
}

func detectTelegramContentType(filePath string, declared string) string {
	if declared = strings.TrimSpace(declared); declared != "" {
		if index := strings.Index(declared, ";"); index >= 0 {
			declared = declared[:index]
		}
		return strings.ToLower(strings.TrimSpace(declared))
	}
	if byExt := mime.TypeByExtension(strings.ToLower(filepath.Ext(filePath))); byExt != "" {
		if index := strings.Index(byExt, ";"); index >= 0 {
			byExt = byExt[:index]
		}
		return strings.ToLower(strings.TrimSpace(byExt))
	}

	handle, err := os.Open(filePath)
	if err != nil {
		return "application/octet-stream"
	}
	defer handle.Close()

	buffer := make([]byte, 512)
	size, _ := io.ReadFull(handle, buffer)
	return strings.ToLower(strings.TrimSpace(http.DetectContentType(buffer[:size])))
}

func telegramMediaEndpoint(kind string) (string, string) {
	switch normalizeTelegramMediaKind(kind) {
	case botMediaKindImage:
		return "sendPhoto", "photo"
	case botMediaKindVideo:
		return "sendVideo", "video"
	case botMediaKindVoice:
		return "sendVoice", "voice"
	default:
		return "sendDocument", "document"
	}
}

func telegramMediaGroupType(kind string) string {
	switch normalizeTelegramMediaKind(kind) {
	case botMediaKindImage:
		return "photo"
	case botMediaKindVideo:
		return "video"
	case botMediaKindFile:
		return "document"
	default:
		return ""
	}
}

func resolveTelegramOutboundMediaList(media []store.BotMessageMedia) ([]telegramResolvedOutboundMedia, error) {
	if len(media) == 0 {
		return nil, nil
	}

	resolved := make([]telegramResolvedOutboundMedia, 0, len(media))
	for _, item := range media {
		next, err := resolveTelegramOutboundMedia(item)
		if err != nil {
			return nil, err
		}
		resolved = append(resolved, next)
	}
	return resolved, nil
}

func telegramMediaGroupBatches(media []telegramResolvedOutboundMedia) [][]telegramResolvedOutboundMedia {
	if len(media) < 2 {
		return nil
	}

	hasDocument := false
	hasPhotoOrVideo := false
	for _, item := range media {
		switch telegramMediaGroupType(item.Kind) {
		case "photo", "video":
			if hasDocument {
				return nil
			}
			hasPhotoOrVideo = true
		case "document":
			if hasPhotoOrVideo {
				return nil
			}
			hasDocument = true
		default:
			return nil
		}
	}

	batches := make([][]telegramResolvedOutboundMedia, 0, (len(media)+telegramMediaGroupMaxItems-1)/telegramMediaGroupMaxItems)
	remaining := media
	for len(remaining) > 0 {
		size := telegramMediaGroupMaxItems
		if len(remaining) < size {
			size = len(remaining)
		}
		if len(remaining)-size == 1 && size > 2 {
			size--
		}
		batch := append([]telegramResolvedOutboundMedia(nil), remaining[:size]...)
		batches = append(batches, batch)
		remaining = remaining[size:]
	}
	return batches
}

func telegramCaptionForMessage(message OutboundMessage) string {
	if len(message.Media) != 1 {
		return ""
	}
	return telegramCaptionText(message.Text)
}

func telegramCaptionForMediaGroup(message OutboundMessage) string {
	if len(message.Media) < 2 {
		return ""
	}
	return telegramCaptionText(message.Text)
}

func telegramCaptionText(text string) string {
	if strings.TrimSpace(text) == "" {
		return ""
	}
	if len([]rune(text)) > telegramMediaCaptionLimitRunes {
		return ""
	}
	return text
}
