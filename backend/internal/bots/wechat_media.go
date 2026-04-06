package bots

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"codex-server/backend/internal/store"
)

type wechatGetUploadURLResponse struct {
	wechatAPIResponse
	UploadParam      string `json:"upload_param"`
	ThumbUploadParam string `json:"thumb_upload_param"`
	UploadFullURL    string `json:"upload_full_url"`
}

type wechatUploadedMedia struct {
	Kind            string
	FilePath        string
	FileName        string
	ContentType     string
	PlaintextSize   int64
	CiphertextSize  int64
	DownloadParam   string
	AESKey          []byte
	UploadMediaType int
}

func normalizedWeChatCDNBaseURL(connection store.BotConnection) string {
	cdnBaseURL := strings.TrimSpace(connection.Settings[wechatCDNBaseURLSetting])
	if cdnBaseURL == "" {
		return wechatDefaultCDNBaseURL
	}
	return cdnBaseURL
}

func (p *wechatProvider) sendMediaMessage(
	ctx context.Context,
	baseURL string,
	cdnBaseURL string,
	token string,
	routeTag string,
	toUserID string,
	contextToken string,
	caption string,
	media store.BotMessageMedia,
) error {
	filePath, fileName, contentType, cleanup, err := p.resolveOutboundMediaFile(ctx, media)
	if err != nil {
		return err
	}
	if cleanup != nil {
		defer cleanup()
	}

	uploaded, err := p.uploadWeChatMedia(ctx, baseURL, cdnBaseURL, token, routeTag, toUserID, filePath, fileName, contentType, media.Kind)
	if err != nil {
		return err
	}

	if caption = strings.TrimSpace(caption); caption != "" {
		if err := p.sendTextMessage(ctx, baseURL, token, routeTag, toUserID, contextToken, caption); err != nil {
			return err
		}
	}

	item := buildWeChatOutboundMediaItem(uploaded)
	return p.sendMessageItem(ctx, baseURL, token, routeTag, toUserID, contextToken, item)
}

func (p *wechatProvider) sendMessageItem(
	ctx context.Context,
	baseURL string,
	token string,
	routeTag string,
	toUserID string,
	contextToken string,
	item wechatMessageItem,
) error {
	var response wechatAPIResponse
	return p.callJSON(ctx, p.client(wechatDefaultHTTPTimeout), baseURL, token, routeTag, http.MethodPost, "/ilink/bot/sendmessage", wechatSendMessageRequest{
		Msg: wechatOutboundMessage{
			FromUserID:   "",
			ToUserID:     strings.TrimSpace(toUserID),
			ClientID:     randomWeChatClientID(),
			MessageType:  wechatMessageTypeBot,
			MessageState: wechatMessageStateComplete,
			ItemList:     []wechatMessageItem{item},
			ContextToken: strings.TrimSpace(contextToken),
		},
		BaseInfo: wechatBaseInfo{
			ChannelVersion: wechatChannelVersion,
		},
	}, &response)
}

func buildWeChatOutboundMediaItem(uploaded wechatUploadedMedia) wechatMessageItem {
	// openclaw-weixin sends aes_key as base64(ascii-hex(aeskey)), not
	// base64(raw 16-byte key). File download fails on the receiver when the
	// encoding does not match that wire format.
	encodedKey := base64.StdEncoding.EncodeToString([]byte(hex.EncodeToString(uploaded.AESKey)))
	switch uploaded.Kind {
	case botMediaKindImage:
		return wechatMessageItem{
			Type: wechatItemTypeImage,
			ImageItem: &wechatImageItem{
				Media: &wechatCDNMedia{
					EncryptQueryParam: uploaded.DownloadParam,
					AESKey:            encodedKey,
					EncryptType:       1,
				},
				MidSize: uploaded.CiphertextSize,
			},
		}
	case botMediaKindVideo:
		return wechatMessageItem{
			Type: wechatItemTypeVideo,
			VideoItem: &wechatVideoItem{
				Media: &wechatCDNMedia{
					EncryptQueryParam: uploaded.DownloadParam,
					AESKey:            encodedKey,
					EncryptType:       1,
				},
				VideoSize: uploaded.CiphertextSize,
			},
		}
	default:
		return wechatMessageItem{
			Type: wechatItemTypeFile,
			FileItem: &wechatFileItem{
				Media: &wechatCDNMedia{
					EncryptQueryParam: uploaded.DownloadParam,
					AESKey:            encodedKey,
					EncryptType:       1,
				},
				FileName: uploaded.FileName,
				Len:      strconv.FormatInt(uploaded.PlaintextSize, 10),
			},
		}
	}
}

func (p *wechatProvider) uploadWeChatMedia(
	ctx context.Context,
	baseURL string,
	cdnBaseURL string,
	token string,
	routeTag string,
	toUserID string,
	filePath string,
	fileName string,
	contentType string,
	declaredKind string,
) (wechatUploadedMedia, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return wechatUploadedMedia{}, fmt.Errorf("read wechat media file %q: %w", filePath, err)
	}

	kind, uploadMediaType, resolvedContentType := classifyWeChatOutboundMedia(filePath, contentType, declaredKind)
	fileKey, err := randomWeChatFileKey()
	if err != nil {
		return wechatUploadedMedia{}, fmt.Errorf("generate wechat media file key: %w", err)
	}
	aesKey := make([]byte, 16)
	if _, err := rand.Read(aesKey); err != nil {
		return wechatUploadedMedia{}, fmt.Errorf("generate wechat media aes key: %w", err)
	}

	ciphertext, err := encryptWeChatAESECB(data, aesKey)
	if err != nil {
		return wechatUploadedMedia{}, err
	}
	checksum := md5.Sum(data)

	var uploadResponse wechatGetUploadURLResponse
	if err := p.callJSON(ctx, p.client(wechatDefaultHTTPTimeout), baseURL, token, routeTag, http.MethodPost, "/ilink/bot/getuploadurl", map[string]any{
		"filekey":       fileKey,
		"media_type":    uploadMediaType,
		"to_user_id":    strings.TrimSpace(toUserID),
		"rawsize":       len(data),
		"rawfilemd5":    hex.EncodeToString(checksum[:]),
		"filesize":      len(ciphertext),
		"no_need_thumb": true,
		"aeskey":        hex.EncodeToString(aesKey),
		"base_info": wechatBaseInfo{
			ChannelVersion: wechatChannelVersion,
		},
	}, &uploadResponse); err != nil {
		return wechatUploadedMedia{}, err
	}

	downloadParam, err := p.uploadWeChatCiphertext(ctx, cdnBaseURL, uploadResponse, fileKey, ciphertext)
	if err != nil {
		return wechatUploadedMedia{}, err
	}

	return wechatUploadedMedia{
		Kind:            kind,
		FilePath:        filePath,
		FileName:        fileName,
		ContentType:     resolvedContentType,
		PlaintextSize:   int64(len(data)),
		CiphertextSize:  int64(len(ciphertext)),
		DownloadParam:   downloadParam,
		AESKey:          aesKey,
		UploadMediaType: uploadMediaType,
	}, nil
}

func (p *wechatProvider) uploadWeChatCiphertext(
	ctx context.Context,
	cdnBaseURL string,
	response wechatGetUploadURLResponse,
	fileKey string,
	ciphertext []byte,
) (string, error) {
	targetURL := strings.TrimSpace(response.UploadFullURL)
	if targetURL == "" {
		uploadParam := strings.TrimSpace(response.UploadParam)
		if uploadParam == "" {
			return "", fmt.Errorf("%w: wechat upload url response was incomplete", ErrInvalidInput)
		}
		targetURL = strings.TrimRight(strings.TrimSpace(cdnBaseURL), "/") +
			"/upload?encrypted_query_param=" + url.QueryEscape(uploadParam) +
			"&filekey=" + url.QueryEscape(strings.TrimSpace(fileKey))
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(ciphertext))
		if err != nil {
			return "", fmt.Errorf("build wechat media upload request: %w", err)
		}
		request.Header.Set("Content-Type", "application/octet-stream")

		httpResponse, err := p.client(wechatDefaultHTTPTimeout).Do(request)
		if err != nil {
			lastErr = fmt.Errorf("wechat media upload request failed: %w", err)
			continue
		}

		body, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		httpResponse.Body.Close()

		if httpResponse.StatusCode >= 400 && httpResponse.StatusCode < 500 {
			return "", fmt.Errorf("wechat media upload returned %s: %s", httpResponse.Status, strings.TrimSpace(string(body)))
		}
		if httpResponse.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("wechat media upload returned %s: %s", httpResponse.Status, strings.TrimSpace(string(body)))
			continue
		}

		downloadParam := strings.TrimSpace(httpResponse.Header.Get("x-encrypted-param"))
		if downloadParam == "" {
			lastErr = errors.New("wechat media upload response missing x-encrypted-param header")
			continue
		}
		return downloadParam, nil
	}

	if lastErr == nil {
		lastErr = errors.New("wechat media upload failed")
	}
	return "", lastErr
}

func classifyWeChatOutboundMedia(filePath string, contentType string, declaredKind string) (string, int, string) {
	kind := normalizeWeChatMediaKind(declaredKind)
	contentType = detectWeChatContentType(filePath, contentType)
	if kind == "" {
		switch {
		case strings.HasPrefix(contentType, "image/"):
			kind = botMediaKindImage
		case strings.HasPrefix(contentType, "video/"):
			kind = botMediaKindVideo
		default:
			kind = botMediaKindFile
		}
	}

	switch kind {
	case botMediaKindImage:
		return kind, wechatUploadMediaTypeImage, contentType
	case botMediaKindVideo:
		return kind, wechatUploadMediaTypeVideo, contentType
	default:
		return botMediaKindFile, wechatUploadMediaTypeFile, contentType
	}
}

func normalizeWeChatMediaKind(value string) string {
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

func detectWeChatContentType(filePath string, declared string) string {
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

func (p *wechatProvider) resolveOutboundMediaFile(ctx context.Context, media store.BotMessageMedia) (string, string, string, func(), error) {
	if mediaURL := strings.TrimSpace(media.URL); mediaURL != "" {
		filePath, contentType, cleanup, err := p.downloadRemoteWeChatMedia(ctx, mediaURL, media.FileName)
		if err != nil {
			return "", "", "", nil, err
		}
		return filePath, filepath.Base(filePath), contentType, cleanup, nil
	}

	mediaPath := strings.TrimSpace(media.Path)
	if mediaPath == "" {
		return "", "", "", nil, fmt.Errorf("%w: wechat media message requires a local path or remote url", ErrInvalidInput)
	}
	if strings.HasPrefix(strings.ToLower(mediaPath), "file://") {
		parsed, err := url.Parse(mediaPath)
		if err != nil {
			return "", "", "", nil, fmt.Errorf("%w: invalid wechat media file url %q", ErrInvalidInput, mediaPath)
		}
		mediaPath = filepath.FromSlash(parsed.Path)
	}
	if !filepath.IsAbs(mediaPath) {
		return "", "", "", nil, fmt.Errorf("%w: wechat media file path must be absolute: %s", ErrInvalidInput, mediaPath)
	}
	info, err := os.Stat(mediaPath)
	if err != nil {
		return "", "", "", nil, fmt.Errorf("stat wechat media file %q: %w", mediaPath, err)
	}
	if info.IsDir() {
		return "", "", "", nil, fmt.Errorf("%w: wechat media file path must be a file: %s", ErrInvalidInput, mediaPath)
	}
	contentType := detectWeChatContentType(mediaPath, media.ContentType)
	return mediaPath, firstNonEmpty(strings.TrimSpace(media.FileName), filepath.Base(mediaPath)), contentType, nil, nil
}

func (p *wechatProvider) downloadRemoteWeChatMedia(ctx context.Context, rawURL string, fileNameHint string) (string, string, func(), error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", "", nil, fmt.Errorf("build remote media request: %w", err)
	}

	httpResponse, err := p.client(wechatDefaultHTTPTimeout).Do(request)
	if err != nil {
		return "", "", nil, fmt.Errorf("download remote media %q: %w", rawURL, err)
	}
	defer httpResponse.Body.Close()

	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		return "", "", nil, fmt.Errorf("download remote media returned %s: %s", httpResponse.Status, strings.TrimSpace(string(body)))
	}

	data, err := io.ReadAll(io.LimitReader(httpResponse.Body, 100*1024*1024))
	if err != nil {
		return "", "", nil, fmt.Errorf("read remote media body: %w", err)
	}

	contentType := strings.ToLower(strings.TrimSpace(httpResponse.Header.Get("Content-Type")))
	filePath, cleanup, err := persistWeChatTempMedia(data, contentType, firstNonEmpty(strings.TrimSpace(fileNameHint), filepath.Base(rawURL)), "outbound")
	if err != nil {
		return "", "", nil, err
	}
	return filePath, contentType, cleanup, nil
}

func (p *wechatProvider) extractInboundMedia(ctx context.Context, cdnBaseURL string, items []wechatMessageItem) []store.BotMessageMedia {
	if len(items) == 0 {
		return nil
	}

	media := make([]store.BotMessageMedia, 0)
	for _, item := range items {
		media = append(media, p.extractInboundMediaItem(ctx, cdnBaseURL, item))
	}

	filtered := make([]store.BotMessageMedia, 0, len(media))
	for _, item := range media {
		if item == (store.BotMessageMedia{}) {
			continue
		}
		filtered = append(filtered, item)
	}
	if len(filtered) > 0 {
		return filtered
	}

	if referenced, ok := findReferencedInboundWeChatMediaItem(items); ok {
		fallback := p.extractInboundMediaItem(ctx, cdnBaseURL, referenced)
		if fallback != (store.BotMessageMedia{}) {
			return []store.BotMessageMedia{fallback}
		}
	}
	return filtered
}

func (p *wechatProvider) extractInboundMediaItem(ctx context.Context, cdnBaseURL string, item wechatMessageItem) store.BotMessageMedia {
	switch item.Type {
	case wechatItemTypeImage:
		if item.ImageItem == nil {
			return store.BotMessageMedia{}
		}
		return p.extractInboundImage(ctx, cdnBaseURL, item.ImageItem)
	case wechatItemTypeVoice:
		if item.VoiceItem == nil {
			return store.BotMessageMedia{}
		}
		return p.extractInboundVoice(ctx, cdnBaseURL, item.VoiceItem)
	case wechatItemTypeFile:
		if item.FileItem == nil {
			return store.BotMessageMedia{}
		}
		return p.extractInboundFile(ctx, cdnBaseURL, item.FileItem)
	case wechatItemTypeVideo:
		if item.VideoItem == nil {
			return store.BotMessageMedia{}
		}
		return p.extractInboundVideo(ctx, cdnBaseURL, item.VideoItem)
	default:
		return store.BotMessageMedia{}
	}
}

func findReferencedInboundWeChatMediaItem(items []wechatMessageItem) (wechatMessageItem, bool) {
	if len(items) == 0 {
		return wechatMessageItem{}, false
	}

	for _, itemType := range []int{wechatItemTypeImage, wechatItemTypeVideo, wechatItemTypeFile, wechatItemTypeVoice} {
		for _, item := range items {
			if referenced, ok := referencedInboundWeChatMediaItem(item); ok && referenced.Type == itemType {
				return referenced, true
			}
		}
	}
	return wechatMessageItem{}, false
}

func referencedInboundWeChatMediaItem(item wechatMessageItem) (wechatMessageItem, bool) {
	candidates := []*wechatReferenceMessage{
		item.RefMsg,
	}
	if item.TextItem != nil {
		candidates = append(candidates, item.TextItem.RefMsg)
	}

	for _, reference := range candidates {
		if reference == nil || reference.MessageItem == nil {
			continue
		}
		switch reference.MessageItem.Type {
		case wechatItemTypeImage, wechatItemTypeVideo, wechatItemTypeFile, wechatItemTypeVoice:
			return *reference.MessageItem, true
		}
	}
	return wechatMessageItem{}, false
}

func (p *wechatProvider) extractInboundImage(ctx context.Context, cdnBaseURL string, item *wechatImageItem) store.BotMessageMedia {
	media := store.BotMessageMedia{
		Kind:        botMediaKindImage,
		ContentType: "image/*",
	}
	if item == nil {
		return media
	}
	if strings.TrimSpace(item.URL) != "" {
		media.URL = strings.TrimSpace(item.URL)
	}
	key, _ := parseInboundWeChatAESKey(item.AESKeyHex, item.Media)
	if data, contentType, err := p.downloadInboundWeChatMedia(ctx, cdnBaseURL, item.Media, key); err == nil {
		media.ContentType = firstNonEmpty(contentType, media.ContentType)
		if filePath, _, err := persistWeChatTempMedia(data, media.ContentType, "", "inbound"); err == nil {
			media.Path = filePath
			media.FileName = filepath.Base(filePath)
		}
	}
	return media
}

func (p *wechatProvider) extractInboundVoice(ctx context.Context, cdnBaseURL string, item *wechatVoiceItem) store.BotMessageMedia {
	media := store.BotMessageMedia{
		Kind:        botMediaKindVoice,
		ContentType: "audio/silk",
	}
	if item == nil {
		return media
	}
	key, _ := parseInboundWeChatAESKey("", item.Media)
	if data, contentType, err := p.downloadInboundWeChatMedia(ctx, cdnBaseURL, item.Media, key); err == nil {
		media.ContentType = firstNonEmpty(contentType, media.ContentType)
		if filePath, _, err := persistWeChatTempMedia(data, media.ContentType, "voice.silk", "inbound"); err == nil {
			media.Path = filePath
			media.FileName = filepath.Base(filePath)
			if wavPath, err := p.tryTranscodeInboundWeChatVoice(ctx, filePath); err == nil {
				_ = os.Remove(filePath)
				media.ContentType = "audio/wav"
				media.Path = wavPath
				media.FileName = filepath.Base(wavPath)
			}
		}
	}
	return media
}

func (p *wechatProvider) tryTranscodeInboundWeChatVoice(ctx context.Context, silkPath string) (string, error) {
	transcodeCtx := ctx
	cancel := func() {}
	if transcodeCtx == nil {
		transcodeCtx = context.Background()
	}
	if _, hasDeadline := transcodeCtx.Deadline(); !hasDeadline {
		transcodeCtx, cancel = context.WithTimeout(transcodeCtx, wechatVoiceTranscodeTimeout)
	}
	defer cancel()

	return transcodeWeChatVoiceToWAV(transcodeCtx, silkPath)
}

func (p *wechatProvider) extractInboundFile(ctx context.Context, cdnBaseURL string, item *wechatFileItem) store.BotMessageMedia {
	media := store.BotMessageMedia{
		Kind: botMediaKindFile,
	}
	if item == nil {
		return media
	}
	media.FileName = strings.TrimSpace(item.FileName)
	key, _ := parseInboundWeChatAESKey("", item.Media)
	if data, contentType, err := p.downloadInboundWeChatMedia(ctx, cdnBaseURL, item.Media, key); err == nil {
		media.ContentType = contentType
		if filePath, _, err := persistWeChatTempMedia(data, media.ContentType, media.FileName, "inbound"); err == nil {
			media.Path = filePath
			if media.FileName == "" {
				media.FileName = filepath.Base(filePath)
			}
		}
	}
	return media
}

func (p *wechatProvider) extractInboundVideo(ctx context.Context, cdnBaseURL string, item *wechatVideoItem) store.BotMessageMedia {
	media := store.BotMessageMedia{
		Kind:        botMediaKindVideo,
		ContentType: "video/mp4",
	}
	if item == nil {
		return media
	}
	key, _ := parseInboundWeChatAESKey("", item.Media)
	if data, contentType, err := p.downloadInboundWeChatMedia(ctx, cdnBaseURL, item.Media, key); err == nil {
		media.ContentType = firstNonEmpty(contentType, media.ContentType)
		if filePath, _, err := persistWeChatTempMedia(data, media.ContentType, "video.mp4", "inbound"); err == nil {
			media.Path = filePath
			media.FileName = filepath.Base(filePath)
		}
	}
	return media
}

func (p *wechatProvider) downloadInboundWeChatMedia(
	ctx context.Context,
	cdnBaseURL string,
	media *wechatCDNMedia,
	key []byte,
) ([]byte, string, error) {
	if media == nil {
		return nil, "", errors.New("wechat media reference is missing")
	}
	targetURL := strings.TrimSpace(media.FullURL)
	if targetURL == "" {
		encryptedQueryParam := strings.TrimSpace(media.EncryptQueryParam)
		if encryptedQueryParam == "" {
			return nil, "", errors.New("wechat media download reference is incomplete")
		}
		targetURL = strings.TrimRight(strings.TrimSpace(cdnBaseURL), "/") + "/download?encrypted_query_param=" + url.QueryEscape(encryptedQueryParam)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("build wechat media download request: %w", err)
	}

	httpResponse, err := p.client(wechatDefaultHTTPTimeout).Do(request)
	if err != nil {
		return nil, "", fmt.Errorf("wechat media download request failed: %w", err)
	}
	defer httpResponse.Body.Close()

	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		return nil, "", fmt.Errorf("wechat media download returned %s: %s", httpResponse.Status, strings.TrimSpace(string(body)))
	}

	data, err := io.ReadAll(io.LimitReader(httpResponse.Body, 100*1024*1024))
	if err != nil {
		return nil, "", fmt.Errorf("read wechat media download body: %w", err)
	}
	contentType := strings.ToLower(strings.TrimSpace(httpResponse.Header.Get("Content-Type")))
	if len(key) == 0 {
		return data, contentType, nil
	}

	plaintext, err := decryptWeChatAESECB(data, key)
	if err != nil {
		return nil, "", err
	}
	return plaintext, contentType, nil
}

func parseInboundWeChatAESKey(hexValue string, media *wechatCDNMedia) ([]byte, error) {
	if trimmed := strings.TrimSpace(hexValue); trimmed != "" {
		return hex.DecodeString(trimmed)
	}
	if media == nil || strings.TrimSpace(media.AESKey) == "" {
		return nil, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(media.AESKey))
	if err != nil {
		return nil, fmt.Errorf("decode wechat media aes key: %w", err)
	}
	if len(decoded) == 16 {
		return decoded, nil
	}
	if len(decoded) == 32 && isASCIIHex(decoded) {
		return hex.DecodeString(string(decoded))
	}
	return nil, fmt.Errorf("unexpected wechat media aes key length %d", len(decoded))
}

func isASCIIHex(value []byte) bool {
	if len(value) == 0 {
		return false
	}
	for _, ch := range value {
		switch {
		case ch >= '0' && ch <= '9':
		case ch >= 'a' && ch <= 'f':
		case ch >= 'A' && ch <= 'F':
		default:
			return false
		}
	}
	return true
}

func persistWeChatTempMedia(data []byte, contentType string, fileNameHint string, direction string) (string, func(), error) {
	dir := filepath.Join(os.TempDir(), "codex-server", "wechat", "media", strings.TrimSpace(direction))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, fmt.Errorf("create wechat media temp dir: %w", err)
	}

	ext := filepath.Ext(strings.TrimSpace(fileNameHint))
	if ext == "" && contentType != "" {
		if extensions, err := mime.ExtensionsByType(contentType); err == nil && len(extensions) > 0 {
			ext = extensions[0]
		}
	}
	if ext == "" {
		switch {
		case strings.HasPrefix(contentType, "image/"):
			ext = ".bin"
		case strings.HasPrefix(contentType, "video/"):
			ext = ".bin"
		default:
			ext = ".bin"
		}
	}

	baseName := strings.TrimSpace(fileNameHint)
	if baseName == "" {
		randomPart, err := randomWeChatFileKey()
		if err != nil {
			return "", nil, err
		}
		baseName = "wechat-media-" + randomPart + ext
	} else {
		baseName = filepath.Base(baseName)
		if filepath.Ext(baseName) == "" {
			baseName += ext
		}
	}

	filePath := filepath.Join(dir, baseName)
	if _, err := os.Stat(filePath); err == nil {
		randomPart, randomErr := randomWeChatFileKey()
		if randomErr != nil {
			return "", nil, randomErr
		}
		filePath = filepath.Join(dir, strings.TrimSuffix(baseName, filepath.Ext(baseName))+"-"+randomPart+filepath.Ext(baseName))
	}

	if err := os.WriteFile(filePath, data, 0o600); err != nil {
		return "", nil, fmt.Errorf("write wechat media temp file: %w", err)
	}

	cleanup := func() {
		_ = os.Remove(filePath)
	}
	return filePath, cleanup, nil
}

func randomWeChatFileKey() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func encryptWeChatAESECB(plaintext []byte, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create wechat aes cipher: %w", err)
	}
	blockSize := block.BlockSize()
	padding := blockSize - (len(plaintext) % blockSize)
	if padding == 0 {
		padding = blockSize
	}
	padded := append(append([]byte(nil), plaintext...), bytes.Repeat([]byte{byte(padding)}, padding)...)
	ciphertext := make([]byte, len(padded))
	for offset := 0; offset < len(padded); offset += blockSize {
		block.Encrypt(ciphertext[offset:offset+blockSize], padded[offset:offset+blockSize])
	}
	return ciphertext, nil
}

func decryptWeChatAESECB(ciphertext []byte, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create wechat aes cipher: %w", err)
	}
	blockSize := block.BlockSize()
	if len(ciphertext) == 0 || len(ciphertext)%blockSize != 0 {
		return nil, errors.New("wechat ciphertext size is invalid for AES-ECB")
	}

	plaintext := make([]byte, len(ciphertext))
	for offset := 0; offset < len(ciphertext); offset += blockSize {
		block.Decrypt(plaintext[offset:offset+blockSize], ciphertext[offset:offset+blockSize])
	}

	padding := int(plaintext[len(plaintext)-1])
	if padding <= 0 || padding > blockSize || padding > len(plaintext) {
		return nil, errors.New("wechat ciphertext padding is invalid")
	}
	for _, value := range plaintext[len(plaintext)-padding:] {
		if int(value) != padding {
			return nil, errors.New("wechat ciphertext padding is invalid")
		}
	}
	return plaintext[:len(plaintext)-padding], nil
}
