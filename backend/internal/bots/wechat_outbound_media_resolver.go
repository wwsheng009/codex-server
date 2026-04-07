package bots

import (
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
)

const (
	wechatRemoteMediaResolveMaxDepth = 3
	wechatRemoteMediaFetchLimit      = 100 * 1024 * 1024
)

var (
	wechatHTMLTagPattern          = regexp.MustCompile(`(?is)<(meta|source|video|a|iframe)\b[^>]*>`)
	wechatHTMLAttributePattern    = regexp.MustCompile("(?is)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))")
	wechatStructuredURLPattern    = regexp.MustCompile(`(?is)"(contentUrl|embedUrl|videoUrl|video_url|streamUrl|stream_url|streamHlsUrl|stream_hls_url|playbackUrl|playback_url|playerUrl|player_url|iframeUrl|iframe_url|manifestUrl|manifest_url|url|src)"\s*:\s*"((?:\\.|[^"])*)"`)
	wechatDirectMediaURLPattern   = regexp.MustCompile(`(?i)https?:\/\/[^"'<>\\s]+?\.(?:mp4|mov|m4v|webm|avi|mkv|jpg|jpeg|png|gif|webp|bmp|pdf)(?:\?[^"'<>\\s]*)?`)
	wechatHTMLDocTypePattern      = regexp.MustCompile(`(?is)<!doctype\s+html`)
	wechatHTMLBodyMarkerPattern   = regexp.MustCompile(`(?is)<(?:html|head|body|meta|title|script|video|source|iframe)\b`)
	wechatStructuredJSONURLMarker = regexp.MustCompile(`(?is)"(?:contentUrl|embedUrl|videoUrl|video_url|streamUrl|stream_url|streamHlsUrl|stream_hls_url|playbackUrl|playback_url|playerUrl|player_url|iframeUrl|iframe_url|manifestUrl|manifest_url|url|src)"\s*:`)
)

type wechatFetchedRemoteResource struct {
	data        []byte
	contentType string
	finalURL    string
}

type wechatRemoteMediaCandidate struct {
	url          string
	kind         string
	fileNameHint string
}

func (p *wechatProvider) resolveRemoteOutboundMediaFile(
	ctx context.Context,
	rawURL string,
	fileNameHint string,
	declaredKind string,
) (string, string, func(), error) {
	visited := make(map[string]struct{})
	return p.resolveRemoteOutboundMediaFileRecursive(
		ctx,
		strings.TrimSpace(rawURL),
		strings.TrimSpace(fileNameHint),
		normalizeWeChatMediaKind(declaredKind),
		0,
		visited,
	)
}

func (p *wechatProvider) resolveRemoteOutboundMediaFileRecursive(
	ctx context.Context,
	rawURL string,
	fileNameHint string,
	declaredKind string,
	depth int,
	visited map[string]struct{},
) (string, string, func(), error) {
	if depth > wechatRemoteMediaResolveMaxDepth {
		return "", "", nil, fmt.Errorf("%w: exceeded wechat remote media resolution depth for %q", ErrInvalidInput, rawURL)
	}

	normalizedURL := strings.TrimSpace(rawURL)
	if normalizedURL == "" {
		return "", "", nil, fmt.Errorf("%w: wechat remote media url is required", ErrInvalidInput)
	}
	if _, ok := visited[normalizedURL]; ok {
		return "", "", nil, fmt.Errorf("%w: detected recursive wechat remote media url %q", ErrInvalidInput, normalizedURL)
	}
	visited[normalizedURL] = struct{}{}

	resource, err := p.fetchRemoteWeChatResource(ctx, normalizedURL)
	if err != nil {
		return "", "", nil, err
	}

	if !isWeChatStructuredDocument(resource.contentType, resource.data) {
		if shouldAttemptWeChatRemoteVideoTranscode(resource.finalURL, resource.contentType, declaredKind) {
			resolvedFileNameHint := firstNonEmpty(
				strings.TrimSpace(fileNameHint),
				fileNameFromURL(resource.finalURL),
				fileNameFromURL(normalizedURL),
				"video.mp4",
			)
			filePath, contentType, cleanup, err := transcodeWeChatRemoteVideoToMP4(ctx, resource.finalURL, resolvedFileNameHint)
			if err != nil {
				return "", "", nil, fmt.Errorf(
					"%w: wechat resolved remote video %q requires transcoding before upload, but transcoding failed: %v",
					ErrInvalidInput,
					resource.finalURL,
					err,
				)
			}
			return filePath, contentType, cleanup, nil
		}
		if err := validateResolvedWeChatRemoteMedia(resource.finalURL, resource.contentType, declaredKind); err != nil {
			return "", "", nil, err
		}
		resolvedFileNameHint := firstNonEmpty(
			strings.TrimSpace(fileNameHint),
			fileNameFromURL(resource.finalURL),
			fileNameFromURL(normalizedURL),
		)
		filePath, cleanup, err := persistWeChatTempMedia(
			resource.data,
			resource.contentType,
			resolvedFileNameHint,
			"outbound",
		)
		if err != nil {
			return "", "", nil, err
		}
		return filePath, resource.contentType, cleanup, nil
	}

	candidates := extractWeChatRemoteMediaCandidates(resource.data, resource.finalURL, declaredKind)
	if len(candidates) == 0 {
		return "", "", nil, fmt.Errorf(
			"%w: wechat remote media url %q resolved to a structured page but no downloadable media url was found",
			ErrInvalidInput,
			normalizedURL,
		)
	}

	var lastErr error
	for _, candidate := range candidates {
		candidateKind := normalizeWeChatMediaKind(candidate.kind)
		if candidateKind == "" {
			candidateKind = declaredKind
		}
		filePath, contentType, cleanup, err := p.resolveRemoteOutboundMediaFileRecursive(
			ctx,
			candidate.url,
			firstNonEmpty(strings.TrimSpace(candidate.fileNameHint), strings.TrimSpace(fileNameHint)),
			candidateKind,
			depth+1,
			visited,
		)
		if err == nil {
			return filePath, contentType, cleanup, nil
		}
		lastErr = err
	}

	if lastErr != nil {
		return "", "", nil, fmt.Errorf(
			"%w: wechat remote media url %q resolved to a structured page, but all extracted media candidates failed: %v",
			ErrInvalidInput,
			normalizedURL,
			lastErr,
		)
	}
	return "", "", nil, fmt.Errorf("%w: unable to resolve wechat remote media url %q", ErrInvalidInput, normalizedURL)
}

func (p *wechatProvider) fetchRemoteWeChatResource(ctx context.Context, rawURL string) (wechatFetchedRemoteResource, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return wechatFetchedRemoteResource{}, fmt.Errorf("build remote media request: %w", err)
	}

	httpResponse, err := p.client(wechatDefaultHTTPTimeout).Do(request)
	if err != nil {
		return wechatFetchedRemoteResource{}, fmt.Errorf("download remote media %q: %w", rawURL, err)
	}
	defer httpResponse.Body.Close()

	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		return wechatFetchedRemoteResource{}, fmt.Errorf(
			"download remote media returned %s: %s",
			httpResponse.Status,
			strings.TrimSpace(string(body)),
		)
	}

	data, err := io.ReadAll(io.LimitReader(httpResponse.Body, wechatRemoteMediaFetchLimit))
	if err != nil {
		return wechatFetchedRemoteResource{}, fmt.Errorf("read remote media body: %w", err)
	}

	finalURL := strings.TrimSpace(rawURL)
	if httpResponse.Request != nil && httpResponse.Request.URL != nil {
		finalURL = httpResponse.Request.URL.String()
	}
	return wechatFetchedRemoteResource{
		data:        data,
		contentType: strings.ToLower(strings.TrimSpace(httpResponse.Header.Get("Content-Type"))),
		finalURL:    finalURL,
	}, nil
}

func isWeChatStructuredDocument(contentType string, data []byte) bool {
	lowerContentType := strings.ToLower(strings.TrimSpace(contentType))
	snippet := strings.TrimSpace(string(data))
	if len(snippet) > 4096 {
		snippet = snippet[:4096]
	}
	lowerSnippet := strings.ToLower(snippet)

	switch {
	case strings.Contains(lowerContentType, "text/html"),
		strings.Contains(lowerContentType, "application/xhtml+xml"):
		return true
	case strings.Contains(lowerContentType, "application/json"):
		return wechatStructuredJSONURLMarker.MatchString(snippet)
	}

	if wechatHTMLDocTypePattern.MatchString(lowerSnippet) || wechatHTMLBodyMarkerPattern.MatchString(lowerSnippet) {
		return true
	}
	if strings.HasPrefix(lowerSnippet, "{") || strings.HasPrefix(lowerSnippet, "[") {
		return wechatStructuredJSONURLMarker.MatchString(snippet)
	}
	return false
}

func extractWeChatRemoteMediaCandidates(body []byte, pageURL string, declaredKind string) []wechatRemoteMediaCandidate {
	htmlText := string(body)
	normalizedDeclaredKind := normalizeWeChatMediaKind(declaredKind)
	candidates := make([]wechatRemoteMediaCandidate, 0, 8)
	seen := make(map[string]struct{})

	appendCandidate := func(rawURL string, candidateKind string, structured bool) {
		normalizedCandidateKind := normalizeWeChatMediaKind(candidateKind)
		for _, resolvedURL := range expandWeChatRemoteMediaCandidateURLs(pageURL, rawURL) {
			resolvedKind := normalizedCandidateKind
			if resolvedKind == "" {
				resolvedKind = inferWeChatMediaKindFromLocation(resolvedURL)
			}
			if !shouldUseWeChatMediaCandidate(normalizedDeclaredKind, resolvedKind, resolvedURL, structured) {
				continue
			}
			if _, ok := seen[resolvedURL]; ok {
				continue
			}
			seen[resolvedURL] = struct{}{}
			candidates = append(candidates, wechatRemoteMediaCandidate{
				url:          resolvedURL,
				kind:         resolvedKind,
				fileNameHint: fileNameFromURL(resolvedURL),
			})
		}
	}

	for _, match := range wechatHTMLTagPattern.FindAllStringSubmatch(htmlText, -1) {
		if len(match) < 2 {
			continue
		}
		tagName := strings.ToLower(strings.TrimSpace(match[1]))
		attributes := parseWeChatHTMLAttributes(match[0])

		switch tagName {
		case "meta":
			key := strings.ToLower(firstNonEmpty(
				attributes["property"],
				attributes["name"],
				attributes["itemprop"],
			))
			content := firstNonEmpty(attributes["content"], attributes["value"])
			switch {
			case isWeChatVideoMetaKey(key):
				appendCandidate(content, botMediaKindVideo, true)
			case isWeChatImageMetaKey(key):
				appendCandidate(content, botMediaKindImage, true)
			case isWeChatStructuredMediaKey(key):
				appendCandidate(content, normalizedDeclaredKind, true)
			}
		case "source", "video":
			appendCandidate(
				firstNonEmpty(attributes["src"], attributes["data-src"], attributes["href"]),
				normalizedDeclaredKind,
				true,
			)
		case "a":
			href := firstNonEmpty(attributes["href"], attributes["data-href"])
			if looksLikeWeChatDirectMediaURL(href) {
				appendCandidate(href, inferWeChatMediaKindFromLocation(href), false)
			}
		case "iframe":
			appendCandidate(
				firstNonEmpty(attributes["src"], attributes["data-src"], attributes["data-href"]),
				normalizedDeclaredKind,
				true,
			)
		}
	}

	for _, match := range wechatStructuredURLPattern.FindAllStringSubmatch(htmlText, -1) {
		if len(match) < 3 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(match[1]))
		value := decodeWeChatJSONLikeString(match[2])
		switch {
		case strings.Contains(key, "video"),
			strings.Contains(key, "stream"),
			strings.Contains(key, "playback"),
			strings.Contains(key, "manifest"):
			appendCandidate(value, botMediaKindVideo, true)
		case strings.Contains(key, "contenturl"),
			strings.Contains(key, "player"),
			strings.Contains(key, "iframe"),
			strings.Contains(key, "embedurl"):
			appendCandidate(value, normalizedDeclaredKind, true)
		default:
			appendCandidate(value, normalizedDeclaredKind, true)
		}
	}

	for _, match := range wechatDirectMediaURLPattern.FindAllString(htmlText, -1) {
		appendCandidate(match, inferWeChatMediaKindFromLocation(match), false)
	}

	return candidates
}

func parseWeChatHTMLAttributes(tag string) map[string]string {
	matches := wechatHTMLAttributePattern.FindAllStringSubmatch(tag, -1)
	if len(matches) == 0 {
		return nil
	}

	attributes := make(map[string]string, len(matches))
	for _, match := range matches {
		if len(match) < 5 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(match[1]))
		value := firstNonEmpty(match[2], match[3], match[4])
		value = html.UnescapeString(strings.Trim(strings.TrimSpace(value), "\"'"))
		if key != "" && value != "" {
			attributes[key] = value
		}
	}
	return attributes
}

func decodeWeChatJSONLikeString(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if decoded, err := strconv.Unquote(`"` + value + `"`); err == nil {
		value = decoded
	}
	return html.UnescapeString(strings.Trim(strings.TrimSpace(value), "\"'"))
}

func resolveWeChatRemoteMediaURL(baseURL string, rawURL string) string {
	rawURL = html.UnescapeString(strings.Trim(strings.TrimSpace(rawURL), "\"'"))
	if rawURL == "" {
		return ""
	}

	if strings.HasPrefix(rawURL, "//") {
		if base, err := url.Parse(strings.TrimSpace(baseURL)); err == nil && strings.TrimSpace(base.Scheme) != "" {
			return base.Scheme + ":" + rawURL
		}
		return "https:" + rawURL
	}

	if parsed, err := url.Parse(rawURL); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		return parsed.String()
	}

	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || base == nil {
		return ""
	}
	ref, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

func expandWeChatRemoteMediaCandidateURLs(baseURL string, rawURL string) []string {
	resolvedURL := resolveWeChatRemoteMediaURL(baseURL, rawURL)
	if resolvedURL == "" {
		return nil
	}

	candidates := []string{resolvedURL}
	seen := map[string]struct{}{
		resolvedURL: {},
	}
	for _, rewritten := range rewriteKnownWeChatMediaCandidateURLs(resolvedURL) {
		if rewritten == "" {
			continue
		}
		if _, ok := seen[rewritten]; ok {
			continue
		}
		seen[rewritten] = struct{}{}
		candidates = append(candidates, rewritten)
	}
	return candidates
}

func rewriteKnownWeChatMediaCandidateURLs(rawURL string) []string {
	videoID := extractWeChatDailymotionVideoID(rawURL)
	if videoID == "" {
		return nil
	}
	return []string{"https://www.dailymotion.com/video/" + videoID}
}

func extractWeChatDailymotionVideoID(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed == nil {
		return ""
	}

	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if !looksLikeWeChatDailymotionHost(host) {
		return ""
	}

	if value := normalizeWeChatRemoteVideoID(parsed.Query().Get("video")); value != "" {
		return value
	}

	segments := strings.Split(strings.Trim(strings.TrimSpace(parsed.Path), "/"), "/")
	for index := 0; index < len(segments); index++ {
		if segments[index] != "video" {
			continue
		}
		if index+1 < len(segments) {
			if value := normalizeWeChatRemoteVideoID(segments[index+1]); value != "" {
				return value
			}
		}
	}

	if len(segments) > 0 && strings.EqualFold(host, "dai.ly") {
		return normalizeWeChatRemoteVideoID(segments[len(segments)-1])
	}

	return ""
}

func looksLikeWeChatDailymotionHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "dai.ly" || strings.HasSuffix(host, ".dailymotion.com") || host == "dailymotion.com"
}

func normalizeWeChatRemoteVideoID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9':
			continue
		default:
			return ""
		}
	}
	return value
}

func shouldUseWeChatMediaCandidate(declaredKind string, candidateKind string, resolvedURL string, structured bool) bool {
	declaredKind = normalizeWeChatMediaKind(declaredKind)
	candidateKind = normalizeWeChatMediaKind(candidateKind)
	if candidateKind == "" {
		candidateKind = inferWeChatMediaKindFromLocation(resolvedURL)
	}

	switch declaredKind {
	case botMediaKindVideo:
		return candidateKind == botMediaKindVideo || structured
	case botMediaKindImage:
		return candidateKind == botMediaKindImage || structured
	case botMediaKindFile, "":
		return true
	default:
		return candidateKind == declaredKind || structured
	}
}

func looksLikeWeChatDirectMediaURL(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	return wechatDirectMediaURLPattern.MatchString(value)
}

func isWeChatVideoMetaKey(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "og:video",
		"og:video:url",
		"og:video:secure_url",
		"twitter:player:stream",
		"video",
		"video:url",
		"video:secure_url":
		return true
	default:
		return false
	}
}

func isWeChatImageMetaKey(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "og:image",
		"og:image:url",
		"og:image:secure_url",
		"twitter:image",
		"image",
		"image:url":
		return true
	default:
		return false
	}
}

func isWeChatStructuredMediaKey(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "contenturl", "embedurl", "url", "src":
		return true
	default:
		return false
	}
}

func fileNameFromURL(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	base := strings.TrimSpace(path.Base(parsed.Path))
	switch base {
	case "", ".", "/":
		return ""
	default:
		return base
	}
}

func validateResolvedWeChatRemoteMedia(rawURL string, contentType string, declaredKind string) error {
	declaredKind = normalizeWeChatMediaKind(declaredKind)
	contentType = strings.ToLower(strings.TrimSpace(contentType))

	switch declaredKind {
	case botMediaKindVideo:
		if shouldAttemptWeChatRemoteVideoTranscode(rawURL, contentType, declaredKind) {
			return fmt.Errorf(
				"%w: wechat resolved remote video %q is a streaming playlist (%s), not a directly uploadable video file",
				ErrInvalidInput,
				rawURL,
				firstNonEmpty(contentType, "unknown content type"),
			)
		}
		if strings.HasPrefix(contentType, "video/") || looksLikeDirectVideoFileURL(rawURL) {
			return nil
		}
		return fmt.Errorf(
			"%w: wechat resolved remote video %q is not a directly uploadable video file (content-type %q)",
			ErrInvalidInput,
			rawURL,
			firstNonEmpty(contentType, "unknown"),
		)
	case botMediaKindImage:
		if strings.HasPrefix(contentType, "image/") || looksLikeDirectImageFileURL(rawURL) {
			return nil
		}
		return fmt.Errorf(
			"%w: wechat resolved remote image %q is not a directly uploadable image file (content-type %q)",
			ErrInvalidInput,
			rawURL,
			firstNonEmpty(contentType, "unknown"),
		)
	default:
		return nil
	}
}

func shouldAttemptWeChatRemoteVideoTranscode(rawURL string, contentType string, declaredKind string) bool {
	if normalizeWeChatMediaKind(declaredKind) != botMediaKindVideo {
		return false
	}
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	switch {
	case strings.Contains(contentType, "mpegurl"),
		strings.Contains(contentType, "dash+xml"),
		looksLikeStreamingPlaylistURL(rawURL):
		return true
	default:
		return false
	}
}

func looksLikeDirectVideoFileURL(value string) bool {
	switch {
	case wechatURLPathHasExtension(value, ".mp4"),
		wechatURLPathHasExtension(value, ".mov"),
		wechatURLPathHasExtension(value, ".m4v"),
		wechatURLPathHasExtension(value, ".webm"),
		wechatURLPathHasExtension(value, ".mkv"),
		wechatURLPathHasExtension(value, ".avi"):
		return true
	default:
		return false
	}
}

func looksLikeDirectImageFileURL(value string) bool {
	switch {
	case wechatURLPathHasExtension(value, ".png"),
		wechatURLPathHasExtension(value, ".jpg"),
		wechatURLPathHasExtension(value, ".jpeg"),
		wechatURLPathHasExtension(value, ".gif"),
		wechatURLPathHasExtension(value, ".webp"),
		wechatURLPathHasExtension(value, ".bmp"):
		return true
	default:
		return false
	}
}

func looksLikeStreamingPlaylistURL(value string) bool {
	switch {
	case wechatURLPathHasExtension(value, ".m3u8"),
		wechatURLPathHasExtension(value, ".mpd"):
		return true
	default:
		return false
	}
}

func wechatURLPathHasExtension(rawURL string, extension string) bool {
	extension = strings.ToLower(strings.TrimSpace(extension))
	if extension == "" {
		return false
	}

	pathValue := strings.ToLower(strings.TrimSpace(rawURL))
	if parsed, err := url.Parse(strings.TrimSpace(rawURL)); err == nil && parsed != nil {
		pathValue = strings.ToLower(strings.TrimSpace(parsed.Path))
	}
	return strings.HasSuffix(pathValue, extension)
}
