package feishutools

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
)

// Feishu OpenAPI paths consumed by the phase-1 Docs tools. These are grouped
// in one place so scope/rate-limit review is straightforward.
const (
	docxDocumentsPath            = "/open-apis/docx/v1/documents"
	docxDocumentPathTemplate     = "/open-apis/docx/v1/documents/%s"
	docxRawContentPathTemplate   = "/open-apis/docx/v1/documents/%s/raw_content"
	docxConvertBlocksPath        = "/open-apis/docx/v1/documents/blocks/convert"
	docxBlockChildrenPathTmpl    = "/open-apis/docx/v1/documents/%s/blocks/%s/children"
	docxBlockChildrenDeleteTmpl  = "/open-apis/docx/v1/documents/%s/blocks/%s/children/batch_delete"
	docxBlockDescendantPathTmpl  = "/open-apis/docx/v1/documents/%s/blocks/%s/descendant"
	suiteSearchDocsObjectPath    = "/open-apis/suite/docs-api/search/object"
	defaultSearchObjectPageSize  = 20
	defaultSearchObjectMaxLimit  = 50
	defaultAppendBlockTextLength = 64 * 1024
	defaultDocChildrenPageSize   = 500
)

const (
	docSelectionTypeEllipsis = "selection_with_ellipsis"
	docSelectionTypeTitle    = "selection_by_title"
	docRewriteStrategy       = "raw_content_rewrite"
	docRewriteWarning        = "This mode rewrites the full raw content; review images, embeds, and other non-text blocks afterward."
	docEllipsisPlaceholder   = "<<<ELLIPSIS_LITERAL>>>"
)

var docHeadingPattern = regexp.MustCompile(`^(#{1,9})\s+(.*?)\s*$`)

type docContentRange struct {
	Start int
	End   int
}

type docSelection struct {
	Type   string
	Value  string
	Ranges []docContentRange
}

type docLine struct {
	Start   int
	End     int
	Content string
}

// runDocsFetch returns the raw markdown-like content of a Feishu document.
// It prefers the user access token (covers wiki nodes and docs shared with
// the user) and falls back to the tenant token so workspace-owned docs keep
// working without a per-user authorization.
func (s *Service) runDocsFetch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	documentID := strings.TrimSpace(stringParam(params, "documentId", "document_id"))
	if documentID == "" {
		return nil, toolInvalidInput("documentId is required")
	}

	query := url.Values{}
	if lang := strings.TrimSpace(stringParam(params, "lang")); lang != "" {
		query.Set("lang", lang)
	}

	// Prefer user token; fall back to tenant credentials for workspace docs.
	if token, err := s.gateway.UserToken(ctx, workspaceID, config); err == nil {
		content, err := s.fetchDocRawContent(ctx, token.AccessToken, documentID, query)
		if err == nil {
			return map[string]any{
				"documentId": documentID,
				"content":    content,
				"principal":  "user",
			}, nil
		}
		// Only fall through to tenant token when the failure is an
		// authorization/permission error; other failures should surface.
		if !isUserAuthError(err) {
			return nil, err
		}
	}

	tenant, err := s.gateway.TenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	content, err := s.fetchDocRawContent(ctx, tenant, documentID, query)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"documentId": documentID,
		"content":    content,
		"principal":  "tenant",
	}, nil
}

// runDocsCreate provisions a new empty Feishu document. Populating content is
// intentionally scoped to feishu_update_doc to keep the surface minimal while
// still being useful; callers can pipe the document id into an update call.
func (s *Service) runDocsCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	title := strings.TrimSpace(stringParam(params, "title"))
	if title == "" {
		return nil, toolInvalidInput("title is required")
	}

	payload := map[string]any{
		"title": title,
	}
	if folder := strings.TrimSpace(stringParam(params, "folderToken", "folder_token")); folder != "" {
		payload["folder_token"] = folder
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		Document struct {
			DocumentID string `json:"document_id"`
			RevisionID int64  `json:"revision_id"`
			Title      string `json:"title"`
		} `json:"document"`
	}
	if err := s.gateway.doJSON(ctx, "POST", docxDocumentsPath, nil, token.Token, payload, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"documentId": result.Document.DocumentID,
		"revisionId": result.Document.RevisionID,
		"title":      result.Document.Title,
		"principal":  token.Principal,
	}, nil
}

// runDocsUpdate supports both the original `append_text` action and the
// Markdown-aware update actions.
func (s *Service) runDocsUpdate(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	if strings.TrimSpace(action) == "" {
		action = "append_text"
	}
	switch action {
	case "append_text":
		return s.runDocsAppendText(ctx, workspaceID, config, params)
	case "append", "append_markdown":
		return s.runDocsMarkdownUpdate(ctx, workspaceID, config, "append", params)
	case "overwrite":
		return s.runDocsMarkdownUpdate(ctx, workspaceID, config, "overwrite", params)
	case "replace_range", "replace_all", "insert_before", "insert_after", "delete_range":
		return s.runDocsTargetedUpdate(ctx, workspaceID, config, action, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q; supported: append_text, append, overwrite, replace_range, replace_all, insert_before, insert_after, delete_range", action))
	}
}

func (s *Service) runDocsAppendText(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	if config.SensitiveWriteGuard {
		// The append path is not sensitive, but leave the hook explicit so
		// future destructive actions can gate on the same flag.
		_ = config.SensitiveWriteGuard
	}

	documentID := strings.TrimSpace(stringParam(params, "documentId", "document_id"))
	if documentID == "" {
		return nil, toolInvalidInput("documentId is required")
	}
	blockID := strings.TrimSpace(stringParam(params, "blockId", "block_id"))
	if blockID == "" {
		// Feishu treats document_id as the root block id by default.
		blockID = documentID
	}

	lines, err := textLinesParam(params)
	if err != nil {
		return nil, err
	}
	if len(lines) == 0 {
		return nil, toolInvalidInput("content is required")
	}
	for _, line := range lines {
		if len(line) > defaultAppendBlockTextLength {
			return nil, toolInvalidInput(fmt.Sprintf("content line exceeds %d bytes", defaultAppendBlockTextLength))
		}
	}

	children := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		children = append(children, map[string]any{
			// block_type 2 == text block per docx v1 schema.
			"block_type": 2,
			"text": map[string]any{
				"elements": []map[string]any{
					{"text_run": map[string]any{"content": line}},
				},
				"style": map[string]any{},
			},
		})
	}

	payload := map[string]any{
		"children": children,
	}
	if indexValue, ok := intParam(params, "index"); ok {
		payload["index"] = indexValue
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		Children      []map[string]any `json:"children"`
		DocumentRevID int64            `json:"document_revision_id"`
		ClientToken   string           `json:"client_token"`
	}
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(docxBlockChildrenPathTmpl, url.PathEscape(documentID), url.PathEscape(blockID)), nil, token.Token, payload, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"documentId":         documentID,
		"blockId":            blockID,
		"mode":               "append_text",
		"appendedCount":      len(lines),
		"documentRevisionId": result.DocumentRevID,
		"clientToken":        result.ClientToken,
		"principal":          token.Principal,
	}, nil
}

func (s *Service) runDocsMarkdownUpdate(ctx context.Context, workspaceID string, config Config, mode string, params map[string]any) (map[string]any, error) {
	documentID := strings.TrimSpace(stringParam(params, "documentId", "document_id"))
	if documentID == "" {
		return nil, toolInvalidInput("documentId is required")
	}
	blockID := strings.TrimSpace(stringParam(params, "blockId", "block_id"))
	if blockID == "" {
		blockID = documentID
	}

	markdown, hasMarkdown := markdownParam(params)
	if mode != "overwrite" && (!hasMarkdown || strings.TrimSpace(markdown) == "") {
		return nil, toolInvalidInput("markdown is required")
	}
	if strings.TrimSpace(markdown) == "" {
		markdown = ""
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var converted *convertedDocxBlocks
	if markdown != "" {
		converted, err = s.convertMarkdownToBlocks(ctx, token.Token, markdown)
		if err != nil {
			return nil, err
		}
	}

	var clearedCount int
	var deleteClientToken string
	var deleteRevisionID int64
	if mode == "overwrite" {
		clearedCount, deleteRevisionID, deleteClientToken, err = s.deleteAllDocChildren(ctx, token.Token, documentID, blockID)
		if err != nil {
			return nil, err
		}
	}

	var createResult struct {
		Children           []map[string]any `json:"children"`
		DocumentRevisionId int64            `json:"document_revision_id"`
		ClientToken        string           `json:"client_token"`
	}
	if converted != nil && len(converted.FirstLevelBlockIDs) > 0 {
		payload := map[string]any{
			"children_id": converted.FirstLevelBlockIDs,
			"descendants": converted.Blocks,
		}
		if indexValue, ok := intParam(params, "index"); ok {
			payload["index"] = indexValue
		}
		if err := s.gateway.doJSON(
			ctx,
			"POST",
			fmt.Sprintf(docxBlockDescendantPathTmpl, url.PathEscape(documentID), url.PathEscape(blockID)),
			nil,
			token.Token,
			payload,
			&createResult,
		); err != nil {
			return nil, err
		}
	}

	documentRevisionID := createResult.DocumentRevisionId
	if documentRevisionID == 0 {
		documentRevisionID = deleteRevisionID
	}
	clientToken := createResult.ClientToken
	if clientToken == "" {
		clientToken = deleteClientToken
	}

	result := map[string]any{
		"documentId":         documentID,
		"blockId":            blockID,
		"mode":               mode,
		"principal":          token.Principal,
		"clearedCount":       clearedCount,
		"documentRevisionId": documentRevisionID,
		"clientToken":        clientToken,
	}
	if converted != nil {
		result["blockCount"] = len(converted.Blocks)
		result["insertedCount"] = len(converted.FirstLevelBlockIDs)
		if len(converted.BlockIDToImageURLs) > 0 {
			result["imageMappingCount"] = len(converted.BlockIDToImageURLs)
		}
	} else {
		result["blockCount"] = 0
		result["insertedCount"] = 0
	}
	return result, nil
}

func (s *Service) runDocsTargetedUpdate(ctx context.Context, workspaceID string, config Config, mode string, params map[string]any) (map[string]any, error) {
	documentID := strings.TrimSpace(stringParam(params, "documentId", "document_id"))
	if documentID == "" {
		return nil, toolInvalidInput("documentId is required")
	}
	blockID := strings.TrimSpace(stringParam(params, "blockId", "block_id"))
	if blockID != "" && blockID != documentID {
		return nil, toolInvalidInput("targeted edit modes only support the document root block")
	}

	markdown, hasMarkdown := markdownParam(params)
	switch mode {
	case "replace_range", "insert_before", "insert_after":
		if !hasMarkdown || strings.TrimSpace(markdown) == "" {
			return nil, toolInvalidInput("markdown is required")
		}
	case "replace_all":
		if !hasMarkdown {
			markdown = ""
		}
	case "delete_range":
		markdown = ""
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	content, err := s.fetchDocRawContent(ctx, token.Token, documentID, nil)
	if err != nil {
		return nil, err
	}

	selection, err := resolveDocSelection(content, params)
	if err != nil {
		return nil, err
	}
	if len(selection.Ranges) == 0 {
		return nil, toolInvalidInput("selection did not match document content")
	}
	if mode != "replace_all" && len(selection.Ranges) != 1 {
		return nil, toolInvalidInput("selection matched multiple ranges; refine the selection")
	}

	updatedContent, replaceCount, err := rewriteDocContent(content, selection.Ranges, mode, markdown)
	if err != nil {
		return nil, err
	}

	overwriteParams := map[string]any{
		"documentId": documentID,
		"blockId":    documentID,
		"markdown":   updatedContent,
	}
	overwriteResult, err := s.runDocsMarkdownUpdate(ctx, workspaceID, config, "overwrite", overwriteParams)
	if err != nil {
		return nil, err
	}

	overwriteResult["mode"] = mode
	overwriteResult["strategy"] = docRewriteStrategy
	overwriteResult["selectionType"] = selection.Type
	overwriteResult["warning"] = docRewriteWarning
	if mode == "replace_all" {
		overwriteResult["replaceCount"] = replaceCount
	}
	return overwriteResult, nil
}

// runDocsSearch queries the Feishu suite docs search endpoint. This path
// requires the `search:docs:read` user scope and therefore fails fast if the
// workspace has not completed the OAuth flow.
func (s *Service) runDocsSearch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	query := strings.TrimSpace(stringParam(params, "query", "q"))
	if query == "" {
		return nil, toolInvalidInput("query is required")
	}

	count := defaultSearchObjectPageSize
	if value, ok := intParam(params, "count", "pageSize", "limit"); ok {
		count = value
	}
	if count <= 0 {
		count = defaultSearchObjectPageSize
	}
	if count > defaultSearchObjectMaxLimit {
		count = defaultSearchObjectMaxLimit
	}

	offset := 0
	if value, ok := intParam(params, "offset"); ok && value >= 0 {
		offset = value
	}

	payload := map[string]any{
		"search_key": query,
		"count":      count,
		"offset":     offset,
	}
	if docsTypes := stringSliceParam(params, "docsTypes", "docs_types"); len(docsTypes) > 0 {
		payload["docs_types"] = docsTypes
	}
	if ownerIds := stringSliceParam(params, "ownerIds", "owner_ids"); len(ownerIds) > 0 {
		payload["owner_ids"] = ownerIds
	}
	if chatIds := stringSliceParam(params, "chatIds", "chat_ids"); len(chatIds) > 0 {
		payload["chat_ids"] = chatIds
	}

	user, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		HasMore bool             `json:"has_more"`
		Total   int              `json:"total"`
		Tokens  []map[string]any `json:"tokens"`
		Items   []map[string]any `json:"docs_entities"`
	}
	if err := s.gateway.doJSON(ctx, "POST", suiteSearchDocsObjectPath, nil, user.AccessToken, payload, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"query":   query,
		"count":   count,
		"offset":  offset,
		"hasMore": result.HasMore,
		"total":   result.Total,
		"tokens":  result.Tokens,
		"items":   result.Items,
	}, nil
}

// bearerChoice packs a token value with the principal label used in invoke
// responses ("user" or "tenant"). It keeps call sites unambiguous about which
// credential ended up carrying the call.
type bearerChoice struct {
	Token     string
	Principal string
}

func (s *Service) userOrTenantToken(ctx context.Context, workspaceID string, config Config) (bearerChoice, error) {
	if user, err := s.gateway.UserToken(ctx, workspaceID, config); err == nil {
		return bearerChoice{Token: user.AccessToken, Principal: "user"}, nil
	} else if !isUserAuthError(err) {
		return bearerChoice{}, err
	}
	tenant, err := s.gateway.TenantToken(ctx, workspaceID, config)
	if err != nil {
		return bearerChoice{}, err
	}
	return bearerChoice{Token: tenant, Principal: "tenant"}, nil
}

func isUserAuthError(err error) bool {
	var gerr *gatewayError
	if !errors.As(err, &gerr) {
		return false
	}
	switch gerr.Code {
	case "user_oauth_required", "user_oauth_expired", "user_oauth_refresh_failed", "user_oauth_persist_failed":
		return true
	}
	return false
}

func toolInvalidInput(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

func rawStringParam(params map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		value, ok := params[key]
		if !ok {
			continue
		}
		typed, ok := value.(string)
		if !ok {
			return "", false
		}
		return typed, true
	}
	return "", false
}

func stringParam(params map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := params[key]; ok {
			text := stringValue(value)
			if text != "" {
				return text
			}
		}
	}
	return ""
}

func intParam(params map[string]any, keys ...string) (int, bool) {
	for _, key := range keys {
		raw, ok := params[key]
		if !ok {
			continue
		}
		switch typed := raw.(type) {
		case int:
			return typed, true
		case int32:
			return int(typed), true
		case int64:
			return int(typed), true
		case float32:
			return int(typed), true
		case float64:
			return int(typed), true
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				continue
			}
			var parsed int
			if _, err := fmt.Sscanf(trimmed, "%d", &parsed); err == nil {
				return parsed, true
			}
		}
	}
	return 0, false
}

func boolParam(params map[string]any, keys ...string) (bool, bool) {
	for _, key := range keys {
		raw, ok := params[key]
		if !ok {
			continue
		}
		switch typed := raw.(type) {
		case bool:
			return typed, true
		case string:
			switch strings.ToLower(strings.TrimSpace(typed)) {
			case "true", "1", "yes", "y":
				return true, true
			case "false", "0", "no", "n":
				return false, true
			}
		case float64:
			return typed != 0, true
		case int:
			return typed != 0, true
		case int64:
			return typed != 0, true
		}
	}
	return false, false
}

func stringSliceParam(params map[string]any, keys ...string) []string {
	for _, key := range keys {
		if value, ok := params[key]; ok {
			items := stringSliceValue(value)
			if len(items) > 0 {
				return items
			}
		}
	}
	return nil
}

// textLinesParam normalizes the various shapes callers can pass for a
// multi-line content parameter: a single string, a list of strings, or a
// list of objects with a "text" key.
func textLinesParam(params map[string]any) ([]string, error) {
	raw, ok := params["content"]
	if !ok {
		raw = params["text"]
	}
	if raw == nil {
		return nil, nil
	}
	switch typed := raw.(type) {
	case string:
		lines := splitLines(typed)
		return lines, nil
	case []string:
		return append([]string(nil), typed...), nil
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			text := stringValue(item)
			if text != "" {
				out = append(out, text)
			}
		}
		return out, nil
	default:
		return nil, toolInvalidInput("content must be a string or array of strings")
	}
}

func markdownParam(params map[string]any) (string, bool) {
	return rawStringParam(params, "markdown", "content", "text")
}

type convertedDocxBlocks struct {
	FirstLevelBlockIDs []string         `json:"first_level_block_ids"`
	Blocks             []map[string]any `json:"blocks"`
	BlockIDToImageURLs []map[string]any `json:"block_id_to_image_urls"`
}

func (s *Service) convertMarkdownToBlocks(ctx context.Context, token string, markdown string) (*convertedDocxBlocks, error) {
	var result convertedDocxBlocks
	if err := s.gateway.doJSON(ctx, "POST", docxConvertBlocksPath, nil, token, map[string]any{
		"content_type": "markdown",
		"content":      markdown,
	}, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *Service) fetchDocRawContent(ctx context.Context, token string, documentID string, query url.Values) (string, error) {
	var result struct {
		Content string `json:"content"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(docxRawContentPathTemplate, url.PathEscape(documentID)), query, token, nil, &result); err != nil {
		return "", err
	}
	return result.Content, nil
}

func (s *Service) deleteAllDocChildren(ctx context.Context, token string, documentID string, blockID string) (int, int64, string, error) {
	totalDeleted := 0
	var lastRevisionID int64
	var lastClientToken string

	for {
		var children struct {
			Items []map[string]any `json:"items"`
		}
		query := url.Values{}
		query.Set("page_size", fmt.Sprintf("%d", defaultDocChildrenPageSize))
		if err := s.gateway.doJSON(
			ctx,
			"GET",
			fmt.Sprintf(docxBlockChildrenPathTmpl, url.PathEscape(documentID), url.PathEscape(blockID)),
			query,
			token,
			nil,
			&children,
		); err != nil {
			return 0, 0, "", err
		}
		if len(children.Items) == 0 {
			return totalDeleted, lastRevisionID, lastClientToken, nil
		}

		var deleted struct {
			DocumentRevisionId int64  `json:"document_revision_id"`
			ClientToken        string `json:"client_token"`
		}
		if err := s.gateway.doJSON(
			ctx,
			"DELETE",
			fmt.Sprintf(docxBlockChildrenDeleteTmpl, url.PathEscape(documentID), url.PathEscape(blockID)),
			nil,
			token,
			map[string]any{
				"start_index": 0,
				"end_index":   len(children.Items),
			},
			&deleted,
		); err != nil {
			return 0, 0, "", err
		}
		totalDeleted += len(children.Items)
		lastRevisionID = deleted.DocumentRevisionId
		lastClientToken = deleted.ClientToken
	}
}

func splitLines(value string) []string {
	trimmed := strings.TrimRight(value, "\r\n")
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, "\n")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		out = append(out, strings.TrimRight(part, "\r"))
	}
	return out
}

func resolveDocSelection(content string, params map[string]any) (docSelection, error) {
	selectionWithEllipsis, hasEllipsis := rawStringParam(params, "selection_with_ellipsis", "selectionWithEllipsis")
	selectionByTitle, hasTitle := rawStringParam(params, "selection_by_title", "selectionByTitle")
	if hasEllipsis == hasTitle {
		return docSelection{}, toolInvalidInput("exactly one of selection_with_ellipsis or selection_by_title is required")
	}
	if hasEllipsis {
		ranges, err := findSelectionWithEllipsisRanges(content, selectionWithEllipsis)
		if err != nil {
			return docSelection{}, err
		}
		return docSelection{Type: docSelectionTypeEllipsis, Value: selectionWithEllipsis, Ranges: ranges}, nil
	}
	ranges, err := findSelectionByTitleRanges(content, selectionByTitle)
	if err != nil {
		return docSelection{}, err
	}
	return docSelection{Type: docSelectionTypeTitle, Value: selectionByTitle, Ranges: ranges}, nil
}

func rewriteDocContent(content string, ranges []docContentRange, mode string, markdown string) (string, int, error) {
	if len(ranges) == 0 {
		return "", 0, toolInvalidInput("selection did not match document content")
	}
	sortedRanges := append([]docContentRange(nil), ranges...)
	slices.SortFunc(sortedRanges, func(a, b docContentRange) int {
		if a.Start != b.Start {
			return a.Start - b.Start
		}
		return a.End - b.End
	})

	switch mode {
	case "replace_range":
		r := sortedRanges[0]
		return content[:r.Start] + markdown + content[r.End:], 1, nil
	case "replace_all":
		var builder strings.Builder
		cursor := 0
		for _, r := range sortedRanges {
			if r.Start < cursor {
				return "", 0, toolInvalidInput("selection produced overlapping ranges")
			}
			builder.WriteString(content[cursor:r.Start])
			builder.WriteString(markdown)
			cursor = r.End
		}
		builder.WriteString(content[cursor:])
		return builder.String(), len(sortedRanges), nil
	case "insert_before":
		r := sortedRanges[0]
		return content[:r.Start] + markdown + content[r.Start:], 1, nil
	case "insert_after":
		r := sortedRanges[0]
		return content[:r.End] + markdown + content[r.End:], 1, nil
	case "delete_range":
		r := sortedRanges[0]
		return content[:r.Start] + content[r.End:], 1, nil
	default:
		return "", 0, toolInvalidInput(fmt.Sprintf("unsupported targeted update mode %q", mode))
	}
}

func findSelectionWithEllipsisRanges(content string, selection string) ([]docContentRange, error) {
	if strings.TrimSpace(selection) == "" {
		return nil, toolInvalidInput("selection_with_ellipsis is required")
	}
	normalized, wildcard := parseEllipsisSelection(selection)
	if !wildcard {
		return findExactStringRanges(content, normalized), nil
	}
	parts := strings.SplitN(normalized, docEllipsisPlaceholder, 2)
	if len(parts) != 2 {
		return nil, toolInvalidInput("selection_with_ellipsis is invalid")
	}
	startToken := parts[0]
	endToken := parts[1]
	if startToken == "" || endToken == "" {
		return nil, toolInvalidInput("selection_with_ellipsis must include text on both sides of ...")
	}

	var ranges []docContentRange
	searchFrom := 0
	for searchFrom < len(content) {
		startIndex := strings.Index(content[searchFrom:], startToken)
		if startIndex < 0 {
			break
		}
		startIndex += searchFrom
		endSearchStart := startIndex + len(startToken)
		endOffset := strings.Index(content[endSearchStart:], endToken)
		if endOffset < 0 {
			break
		}
		endIndex := endSearchStart + endOffset + len(endToken)
		ranges = append(ranges, docContentRange{Start: startIndex, End: endIndex})
		searchFrom = endIndex
	}
	return ranges, nil
}

func parseEllipsisSelection(selection string) (string, bool) {
	escaped := strings.ReplaceAll(selection, `\.`+`\.`+`\.`, docEllipsisPlaceholder)
	if strings.Contains(escaped, "...") {
		parts := strings.SplitN(escaped, "...", 2)
		return strings.ReplaceAll(parts[0], docEllipsisPlaceholder, "...") + docEllipsisPlaceholder + strings.ReplaceAll(parts[1], docEllipsisPlaceholder, "..."), true
	}
	return strings.ReplaceAll(escaped, docEllipsisPlaceholder, "..."), false
}

func findExactStringRanges(content string, target string) []docContentRange {
	if target == "" {
		return nil
	}
	var ranges []docContentRange
	searchFrom := 0
	for searchFrom <= len(content)-len(target) {
		index := strings.Index(content[searchFrom:], target)
		if index < 0 {
			break
		}
		index += searchFrom
		ranges = append(ranges, docContentRange{Start: index, End: index + len(target)})
		searchFrom = index + len(target)
	}
	return ranges
}

func findSelectionByTitleRanges(content string, selection string) ([]docContentRange, error) {
	trimmedSelection := strings.TrimSpace(selection)
	if trimmedSelection == "" {
		return nil, toolInvalidInput("selection_by_title is required")
	}

	requiredLevel := 0
	titleText := trimmedSelection
	if matches := docHeadingPattern.FindStringSubmatch(trimmedSelection); matches != nil {
		requiredLevel = len(matches[1])
		titleText = strings.TrimSpace(matches[2])
	}
	if titleText == "" {
		return nil, toolInvalidInput("selection_by_title is invalid")
	}

	lines := splitDocLines(content)
	var ranges []docContentRange
	for idx, line := range lines {
		matches := docHeadingPattern.FindStringSubmatch(line.Content)
		if matches == nil {
			continue
		}
		level := len(matches[1])
		if requiredLevel != 0 && level != requiredLevel {
			continue
		}
		if strings.TrimSpace(matches[2]) != titleText {
			continue
		}

		end := len(content)
		for next := idx + 1; next < len(lines); next++ {
			nextMatches := docHeadingPattern.FindStringSubmatch(lines[next].Content)
			if nextMatches == nil {
				continue
			}
			if len(nextMatches[1]) <= level {
				end = lines[next].Start
				break
			}
		}
		ranges = append(ranges, docContentRange{Start: line.Start, End: end})
	}
	return ranges, nil
}

func splitDocLines(content string) []docLine {
	if content == "" {
		return nil
	}
	lines := make([]docLine, 0, strings.Count(content, "\n")+1)
	lineStart := 0
	for lineStart < len(content) {
		lineEnd := strings.IndexByte(content[lineStart:], '\n')
		if lineEnd < 0 {
			lineEnd = len(content)
		} else {
			lineEnd += lineStart + 1
		}
		rawLine := content[lineStart:lineEnd]
		normalized := strings.TrimSuffix(rawLine, "\n")
		normalized = strings.TrimSuffix(normalized, "\r")
		lines = append(lines, docLine{
			Start:   lineStart,
			End:     lineEnd,
			Content: normalized,
		})
		lineStart = lineEnd
	}
	return lines
}
