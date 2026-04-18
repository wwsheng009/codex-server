package feishutools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const (
	driveMetaBatchQueryPath      = "/open-apis/drive/v1/metas/batch_query"
	driveFileCopyPathTemplate    = "/open-apis/drive/v1/files/%s/copy"
	driveFileMovePathTemplate    = "/open-apis/drive/v1/files/%s/move"
	driveFileDeletePathTemplate  = "/open-apis/drive/v1/files/%s"
	driveFileDownloadPathTmpl    = "/open-apis/drive/v1/files/%s/download"
	driveFileUploadAllPath       = "/open-apis/drive/v1/files/upload_all"
	driveFileCommentsPathTmpl    = "/open-apis/drive/v1/files/%s/comments"
	driveFileCommentPathTmpl     = "/open-apis/drive/v1/files/%s/comments/%s"
	driveFileCommentRepliesTmpl  = "/open-apis/drive/v1/files/%s/comments/%s/replies"
	driveMediaUploadAllPath      = "/open-apis/drive/v1/medias/upload_all"
	driveMediaDownloadPathTmpl   = "/open-apis/drive/v1/medias/%s/download"
	boardWhiteboardDownloadTmpl  = "/open-apis/board/v1/whiteboards/%s/download_as_image"
	docxBlockBatchUpdateTmpl     = "/open-apis/docx/v1/documents/%s/blocks/batch_update"
	driveDefaultListPageSize     = 200
	driveMaxListPageSize         = 200
	driveDefaultDownloadMaxBytes = 10 * 1024 * 1024
	driveMaxMetaBatchDocs        = 50
	docMediaMaxFileSize          = 20 * 1024 * 1024
)

func (s *Service) runDriveFile(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "list":
		return s.runDriveFileList(ctx, workspaceID, config, params)
	case "get_meta":
		return s.runDriveFileGetMeta(ctx, workspaceID, config, params)
	case "copy":
		return s.runDriveFileCopy(ctx, workspaceID, config, params)
	case "move":
		return s.runDriveFileMove(ctx, workspaceID, config, params)
	case "delete":
		return s.runDriveFileDelete(ctx, workspaceID, config, params)
	case "upload":
		return s.runDriveFileUpload(ctx, workspaceID, config, params)
	case "download":
		return s.runDriveFileDownload(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_drive_file", action))
	}
}

func (s *Service) runDocComments(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "list":
		return s.runDocCommentsList(ctx, workspaceID, config, params)
	case "list_replies":
		return s.runDocCommentReplies(ctx, workspaceID, config, params)
	case "create":
		return s.runDocCommentsCreate(ctx, workspaceID, config, params)
	case "reply":
		return s.runDocCommentsReply(ctx, workspaceID, config, params)
	case "patch":
		return s.runDocCommentsPatch(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_doc_comments", action))
	}
}

func (s *Service) runDocMedia(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "download":
		return s.runDocMediaDownload(ctx, workspaceID, config, params)
	case "insert":
		return s.runDocMediaInsert(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_doc_media", action))
	}
}

func (s *Service) runDriveFileList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	query := url.Values{}
	if folderToken := strings.TrimSpace(stringParam(params, "folderToken", "folder_token", "parentNode", "parent_node")); folderToken != "" {
		query.Set("folder_token", folderToken)
	}
	pageSize := driveDefaultListPageSize
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		pageSize = value
	}
	if pageSize > driveMaxListPageSize {
		pageSize = driveMaxListPageSize
	}
	query.Set("page_size", fmt.Sprintf("%d", pageSize))
	if pageToken := strings.TrimSpace(stringParam(params, "pageToken", "page_token")); pageToken != "" {
		query.Set("page_token", pageToken)
	}
	if orderBy := strings.TrimSpace(stringParam(params, "orderBy", "order_by")); orderBy != "" {
		query.Set("order_by", orderBy)
	}
	if direction := strings.TrimSpace(stringParam(params, "direction")); direction != "" {
		query.Set("direction", direction)
	}

	var result struct {
		Files         []map[string]any `json:"files"`
		HasMore       bool             `json:"has_more"`
		NextPageToken string           `json:"next_page_token"`
	}
	if err := s.gateway.doJSON(ctx, "GET", driveFilesPath, query, access.AccessToken, nil, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"files":       result.Files,
		"hasMore":     result.HasMore,
		"pageSize":    pageSize,
		"pageToken":   result.NextPageToken,
		"principal":   "user",
		"folderToken": strings.TrimSpace(stringParam(params, "folderToken", "folder_token", "parentNode", "parent_node")),
	}, nil
}

func (s *Service) runDriveFileGetMeta(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	requestDocs, err := driveRequestDocsParam(params)
	if err != nil {
		return nil, err
	}
	if len(requestDocs) == 0 {
		return nil, toolInvalidInput("request_docs is required")
	}
	if len(requestDocs) > driveMaxMetaBatchDocs {
		return nil, toolInvalidInput(fmt.Sprintf("request_docs exceeds %d items", driveMaxMetaBatchDocs))
	}

	var result struct {
		Metas []map[string]any `json:"metas"`
	}
	if err := s.gateway.doJSON(ctx, "POST", driveMetaBatchQueryPath, nil, access.AccessToken, map[string]any{
		"request_docs": requestDocs,
	}, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"metas":       result.Metas,
		"count":       len(result.Metas),
		"principal":   "user",
		"requestDocs": requestDocs,
	}, nil
}

func (s *Service) runDriveFileCopy(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	fileToken := strings.TrimSpace(stringParam(params, "fileToken", "file_token"))
	if fileToken == "" {
		return nil, toolInvalidInput("fileToken is required")
	}
	name := strings.TrimSpace(stringParam(params, "name"))
	if name == "" {
		return nil, toolInvalidInput("name is required")
	}
	docType := strings.TrimSpace(stringParam(params, "type", "docType", "doc_type"))
	if docType == "" {
		return nil, toolInvalidInput("type is required")
	}

	body := map[string]any{
		"name": name,
		"type": docType,
	}
	if folderToken := strings.TrimSpace(stringParam(params, "folderToken", "folder_token", "parentNode", "parent_node")); folderToken != "" {
		body["folder_token"] = folderToken
	}

	var result struct {
		File map[string]any `json:"file"`
	}
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(driveFileCopyPathTemplate, url.PathEscape(fileToken)), nil, access.AccessToken, body, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"sourceFileToken": fileToken,
		"file":            result.File,
		"principal":       "user",
	}, nil
}

func (s *Service) runDriveFileDownload(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	fileToken := strings.TrimSpace(stringParam(params, "fileToken", "file_token"))
	if fileToken == "" {
		return nil, toolInvalidInput("fileToken is required")
	}

	maxBytes := driveDefaultDownloadMaxBytes
	if value, ok := intParam(params, "maxBytes", "max_bytes"); ok && value > 0 {
		maxBytes = value
	}
	if maxBytes > driveDefaultDownloadMaxBytes {
		maxBytes = driveDefaultDownloadMaxBytes
	}

	download, err := s.gateway.downloadResource(ctx, fmt.Sprintf(driveFileDownloadPathTmpl, url.PathEscape(fileToken)), nil, access.AccessToken, maxBytes)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"fileToken":   fileToken,
		"contentType": download.ContentType,
		"sizeBytes":   download.SizeBytes,
		"truncated":   download.Truncated,
		"bodyBase64":  base64.StdEncoding.EncodeToString(download.Bytes),
		"principal":   "user",
	}, nil
}

func (s *Service) runDriveFileMove(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	fileToken := strings.TrimSpace(stringParam(params, "fileToken", "file_token"))
	if fileToken == "" {
		return nil, toolInvalidInput("fileToken is required")
	}
	docType := strings.TrimSpace(stringParam(params, "type", "docType", "doc_type"))
	if docType == "" {
		return nil, toolInvalidInput("type is required")
	}
	folderToken := strings.TrimSpace(stringParam(params, "folderToken", "folder_token", "parentNode", "parent_node"))
	if folderToken == "" {
		return nil, toolInvalidInput("folderToken is required")
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(driveFileMovePathTemplate, url.PathEscape(fileToken)), nil, access.AccessToken, map[string]any{
		"type":         docType,
		"folder_token": folderToken,
	}, &result); err != nil {
		return nil, err
	}
	result["fileToken"] = fileToken
	result["targetFolderToken"] = folderToken
	result["principal"] = "user"
	return result, nil
}

func (s *Service) runDriveFileDelete(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	fileToken := strings.TrimSpace(stringParam(params, "fileToken", "file_token"))
	if fileToken == "" {
		return nil, toolInvalidInput("fileToken is required")
	}
	docType := strings.TrimSpace(stringParam(params, "type", "docType", "doc_type"))
	if docType == "" {
		return nil, toolInvalidInput("type is required")
	}
	query := url.Values{}
	query.Set("type", docType)
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "DELETE", fmt.Sprintf(driveFileDeletePathTemplate, url.PathEscape(fileToken)), query, access.AccessToken, nil, &result); err != nil {
		return nil, err
	}
	if result == nil {
		result = map[string]any{"success": true}
	}
	result["fileToken"] = fileToken
	result["principal"] = "user"
	return result, nil
}

func (s *Service) runDriveFileUpload(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	filePath := strings.TrimSpace(stringParam(params, "filePath", "file_path"))
	if filePath == "" {
		return nil, toolInvalidInput("filePath is required")
	}
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	folderToken := strings.TrimSpace(stringParam(params, "folderToken", "folder_token", "parentNode", "parent_node"))
	if folderToken == "" {
		return nil, toolInvalidInput("folderToken is required")
	}
	fileToken, err := s.uploadDriveFile(ctx, access.AccessToken, folderToken, filePath, fileInfo.Size())
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"fileToken":   fileToken,
		"fileName":    filepath.Base(filePath),
		"sizeBytes":   fileInfo.Size(),
		"folderToken": folderToken,
		"principal":   "user",
	}, nil
}

func (s *Service) runDocCommentsList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, fileToken, fileType, query, err := s.resolveDocCommentTarget(ctx, workspaceID, config, params, false)
	if err != nil {
		return nil, err
	}
	copyQueryFields(query, params, []string{"page_token", "user_id_type"}, map[string]string{"pageToken": "page_token", "userIdType": "user_id_type"})
	if value, ok := boolParam(params, "isWhole", "is_whole"); ok {
		query.Set("is_whole", fmt.Sprintf("%t", value))
	}
	if value, ok := boolParam(params, "isSolved", "is_solved"); ok {
		query.Set("is_solved", fmt.Sprintf("%t", value))
	}
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(driveFileCommentsPathTmpl, url.PathEscape(fileToken)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["fileToken"] = fileToken
	result["fileType"] = fileType
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runDocCommentReplies(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, fileToken, fileType, query, err := s.resolveDocCommentTarget(ctx, workspaceID, config, params, false)
	if err != nil {
		return nil, err
	}
	commentID := strings.TrimSpace(stringParam(params, "commentId", "comment_id"))
	if commentID == "" {
		return nil, toolInvalidInput("commentId is required")
	}
	query.Set("file_type", fileType)
	copyQueryFields(query, params, []string{"page_token", "user_id_type"}, map[string]string{"pageToken": "page_token", "userIdType": "user_id_type"})
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(driveFileCommentRepliesTmpl, url.PathEscape(fileToken), url.PathEscape(commentID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["fileToken"] = fileToken
	result["fileType"] = fileType
	result["commentId"] = commentID
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runDocCommentsCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, fileToken, fileType, query, err := s.resolveDocCommentTarget(ctx, workspaceID, config, params, false)
	if err != nil {
		return nil, err
	}
	elements, err := docCommentElementsParam(params)
	if err != nil {
		return nil, err
	}
	if len(elements) == 0 {
		return nil, toolInvalidInput("content or elements is required")
	}
	query.Set("file_type", fileType)
	body := map[string]any{
		"reply_list": map[string]any{
			"replies": []map[string]any{
				{"content": map[string]any{"elements": elements}},
			},
		},
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(driveFileCommentsPathTmpl, url.PathEscape(fileToken)), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["fileToken"] = fileToken
	result["fileType"] = fileType
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runDocCommentsReply(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, fileToken, fileType, query, err := s.resolveDocCommentTarget(ctx, workspaceID, config, params, false)
	if err != nil {
		return nil, err
	}
	commentID := strings.TrimSpace(stringParam(params, "commentId", "comment_id"))
	if commentID == "" {
		return nil, toolInvalidInput("commentId is required")
	}
	elements, err := docCommentElementsParam(params)
	if err != nil {
		return nil, err
	}
	if len(elements) == 0 {
		return nil, toolInvalidInput("content or elements is required")
	}
	query.Set("file_type", fileType)
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(driveFileCommentRepliesTmpl, url.PathEscape(fileToken), url.PathEscape(commentID)), query, token.Token, map[string]any{
		"content": map[string]any{"elements": elements},
	}, &result); err != nil {
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(driveFileCommentRepliesTmpl, url.PathEscape(fileToken), url.PathEscape(commentID)), query, token.Token, map[string]any{
			"reply_elements": elements,
		}, &result); err != nil {
			return nil, err
		}
	}
	result["fileToken"] = fileToken
	result["fileType"] = fileType
	result["commentId"] = commentID
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runDocCommentsPatch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, fileToken, fileType, query, err := s.resolveDocCommentTarget(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	commentID := strings.TrimSpace(stringParam(params, "commentId", "comment_id"))
	if commentID == "" {
		return nil, toolInvalidInput("commentId is required")
	}
	isSolved, ok := boolParam(params, "isSolvedValue", "is_solved_value", "isSolved", "is_solved")
	if !ok {
		return nil, toolInvalidInput("isSolvedValue is required")
	}
	query.Set("file_type", fileType)
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "PATCH", fmt.Sprintf(driveFileCommentPathTmpl, url.PathEscape(fileToken), url.PathEscape(commentID)), query, token.Token, map[string]any{
		"is_solved": isSolved,
	}, &result); err != nil {
		return nil, err
	}
	result["fileToken"] = fileToken
	result["fileType"] = fileType
	result["commentId"] = commentID
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runDocMediaDownload(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	resourceToken := strings.TrimSpace(stringParam(params, "resourceToken", "resource_token"))
	if resourceToken == "" {
		return nil, toolInvalidInput("resourceToken is required")
	}
	resourceType := firstNonEmpty(strings.TrimSpace(stringParam(params, "resourceType", "resource_type")), "media")
	path := fmt.Sprintf(driveMediaDownloadPathTmpl, url.PathEscape(resourceToken))
	if resourceType == "whiteboard" {
		path = fmt.Sprintf(boardWhiteboardDownloadTmpl, url.PathEscape(resourceToken))
	}
	maxBytes := driveDefaultDownloadMaxBytes
	if value, ok := intParam(params, "maxBytes", "max_bytes"); ok && value > 0 {
		maxBytes = value
	}
	download, err := s.gateway.downloadResource(ctx, path, nil, access.AccessToken, maxBytes)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"resourceToken": resourceToken,
		"resourceType":  resourceType,
		"contentType":   download.ContentType,
		"sizeBytes":     download.SizeBytes,
		"truncated":     download.Truncated,
		"bodyBase64":    base64.StdEncoding.EncodeToString(download.Bytes),
		"principal":     "user",
	}, nil
}

func (s *Service) runDocMediaInsert(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	documentID := strings.TrimSpace(stringParam(params, "documentId", "document_id", "docId", "doc_id"))
	if documentID == "" {
		documentID = extractDocID(stringParam(params, "url"))
	}
	if documentID == "" {
		return nil, toolInvalidInput("documentId or url is required")
	}
	filePath := strings.TrimSpace(stringParam(params, "filePath", "file_path"))
	if filePath == "" {
		return nil, toolInvalidInput("filePath is required")
	}
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	if fileInfo.Size() > docMediaMaxFileSize {
		return nil, toolInvalidInput(fmt.Sprintf("file exceeds %d bytes", docMediaMaxFileSize))
	}
	mediaType := firstNonEmpty(strings.TrimSpace(stringParam(params, "type")), "image")
	blockType := 27
	parentType := "docx_image"
	replaceKey := "replace_image"
	if mediaType == "file" {
		blockType = 23
		parentType = "docx_file"
		replaceKey = "replace_file"
	}
	var created struct {
		Children []map[string]any `json:"children"`
	}
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(docxBlockChildrenPathTmpl, url.PathEscape(documentID), url.PathEscape(documentID)), nil, access.AccessToken, map[string]any{
		"children": []map[string]any{{"block_type": blockType}},
	}, &created); err != nil {
		return nil, err
	}
	blockID := firstBlockID(created.Children)
	if blockID == "" {
		return nil, &gatewayError{Code: "upstream_invalid_response", Message: "Feishu did not return a block id for the inserted media placeholder"}
	}
	fileToken, err := s.uploadDocMedia(ctx, access.AccessToken, documentID, blockID, parentType, filePath)
	if err != nil {
		return nil, err
	}
	request := map[string]any{"block_id": blockID}
	request[replaceKey] = map[string]any{"token": fileToken}
	var updated map[string]any
	if err := s.gateway.doJSON(ctx, "PATCH", fmt.Sprintf(docxBlockBatchUpdateTmpl, url.PathEscape(documentID)), nil, access.AccessToken, map[string]any{
		"requests": []map[string]any{request},
	}, &updated); err != nil {
		return nil, err
	}
	return map[string]any{
		"documentId": documentID,
		"blockId":    blockID,
		"fileToken":  fileToken,
		"type":       mediaType,
		"principal":  "user",
	}, nil
}

func driveRequestDocsParam(params map[string]any) ([]map[string]any, error) {
	raw := firstDefined(params["request_docs"], params["requestDocs"])
	if raw == nil {
		docToken := strings.TrimSpace(stringParam(params, "docToken", "doc_token", "fileToken", "file_token"))
		docType := strings.TrimSpace(stringParam(params, "docType", "doc_type", "type"))
		if docToken == "" && docType == "" {
			return nil, nil
		}
		if docToken == "" || docType == "" {
			return nil, toolInvalidInput("docToken and docType are required when request_docs is not provided")
		}
		return []map[string]any{{"doc_token": docToken, "doc_type": docType}}, nil
	}

	items, ok := raw.([]any)
	if !ok {
		return nil, toolInvalidInput("request_docs must be an array")
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		doc, ok := item.(map[string]any)
		if !ok {
			return nil, toolInvalidInput("request_docs entries must be objects")
		}
		docToken := strings.TrimSpace(stringParam(doc, "doc_token", "docToken"))
		docType := strings.TrimSpace(stringParam(doc, "doc_type", "docType"))
		if docToken == "" || docType == "" {
			return nil, toolInvalidInput("request_docs entries require doc_token and doc_type")
		}
		result = append(result, map[string]any{
			"doc_token": docToken,
			"doc_type":  docType,
		})
	}
	return result, nil
}

func (s *Service) resolveDocCommentTarget(ctx context.Context, workspaceID string, config Config, params map[string]any, userOnly bool) (bearerChoice, string, string, url.Values, error) {
	var token bearerChoice
	var err error
	if userOnly {
		user, userErr := s.gateway.UserToken(ctx, workspaceID, config)
		if userErr != nil {
			return bearerChoice{}, "", "", nil, userErr
		}
		token = bearerChoice{Token: user.AccessToken, Principal: "user"}
	} else {
		token, err = s.userOrTenantToken(ctx, workspaceID, config)
		if err != nil {
			return bearerChoice{}, "", "", nil, err
		}
	}
	fileToken := strings.TrimSpace(stringParam(params, "fileToken", "file_token"))
	fileType := firstNonEmpty(strings.TrimSpace(stringParam(params, "fileType", "file_type")), "docx")
	if fileToken == "" {
		return bearerChoice{}, "", "", nil, toolInvalidInput("fileToken is required")
	}
	if fileType == "wiki" {
		resolvedToken, resolvedType, resolveErr := s.resolveWikiDriveTarget(ctx, token.Token, fileToken)
		if resolveErr != nil {
			return bearerChoice{}, "", "", nil, resolveErr
		}
		fileToken = resolvedToken
		fileType = resolvedType
	}
	query := url.Values{}
	query.Set("file_type", fileType)
	if userIDType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type")); userIDType != "" {
		query.Set("user_id_type", userIDType)
	}
	return token, fileToken, fileType, query, nil
}

func (s *Service) resolveWikiDriveTarget(ctx context.Context, bearer string, wikiToken string) (string, string, error) {
	query := url.Values{}
	query.Set("token", wikiToken)
	query.Set("obj_type", "wiki")
	var node struct {
		Node map[string]any `json:"node"`
	}
	if err := s.gateway.doJSON(ctx, "GET", wikiGetNodePath, query, bearer, nil, &node); err != nil {
		return "", "", err
	}
	objToken := strings.TrimSpace(stringValue(node.Node["obj_token"]))
	objType := strings.TrimSpace(stringValue(node.Node["obj_type"]))
	if objToken == "" || objType == "" {
		return "", "", &gatewayError{Code: "invalid_drive_target", Message: "Wiki token did not resolve to a Drive document target"}
	}
	return objToken, objType, nil
}

func docCommentElementsParam(params map[string]any) ([]map[string]any, error) {
	if content := strings.TrimSpace(stringParam(params, "content", "text")); content != "" {
		return []map[string]any{{"type": "text_run", "text_run": map[string]any{"text": content}}}, nil
	}
	raw := params["elements"]
	if raw == nil {
		return nil, nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, toolInvalidInput("elements must be an array")
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, toolInvalidInput("elements entries must be objects")
		}
		switch strings.TrimSpace(stringParam(entry, "type")) {
		case "", "text":
			text := strings.TrimSpace(stringParam(entry, "text"))
			if text == "" {
				return nil, toolInvalidInput("text comment element requires text")
			}
			result = append(result, map[string]any{"type": "text_run", "text_run": map[string]any{"text": text}})
		case "mention":
			openID := strings.TrimSpace(stringParam(entry, "open_id", "openId", "user_id", "userId"))
			if openID == "" {
				return nil, toolInvalidInput("mention comment element requires open_id")
			}
			result = append(result, map[string]any{"type": "person", "person": map[string]any{"user_id": openID}})
		case "link":
			linkURL := strings.TrimSpace(stringParam(entry, "url"))
			if linkURL == "" {
				return nil, toolInvalidInput("link comment element requires url")
			}
			result = append(result, map[string]any{"type": "docs_link", "docs_link": map[string]any{"url": linkURL}})
		default:
			return nil, toolInvalidInput("unsupported comment element type")
		}
	}
	return result, nil
}

func extractDocID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if parsed, err := url.Parse(trimmed); err == nil {
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		for index, part := range parts {
			if part == "docx" && index+1 < len(parts) {
				return parts[index+1]
			}
		}
	}
	return trimmed
}

func firstBlockID(children []map[string]any) string {
	if len(children) == 0 {
		return ""
	}
	if blockID := strings.TrimSpace(stringValue(children[0]["block_id"])); blockID != "" {
		return blockID
	}
	if nested, ok := children[0]["children"].([]any); ok && len(nested) > 0 {
		if value, ok := nested[0].(string); ok {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (s *Service) uploadDocMedia(ctx context.Context, bearer string, documentID string, blockID string, parentType string, filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("file_name", filepath.Base(filePath))
	_ = writer.WriteField("parent_type", parentType)
	_ = writer.WriteField("parent_node", blockID)
	_ = writer.WriteField("size", fmt.Sprintf("%d", fileStatSize(file)))
	_ = writer.WriteField("extra", fmt.Sprintf(`{"drive_route_token":"%s"}`, documentID))
	part, err := writer.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	request, err := http.NewRequestWithContext(ctx, "POST", s.gateway.domain+driveMediaUploadAllPath, &body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := s.gateway.httpClient.Do(request)
	if err != nil {
		return "", &gatewayError{Code: "upstream_unreachable", Message: "Cannot reach Feishu OpenAPI", Hint: err.Error()}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return "", err
	}
	var envelope struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", &gatewayError{Code: "upstream_invalid_response", Message: "Feishu media upload response was not valid JSON", Hint: previewResponseBody(raw)}
	}
	if envelope.Code != 0 {
		return "", &gatewayError{Code: feishuErrorCode(envelope.Code), Message: fallbackErrorMessage(envelope.Msg, "Feishu media upload failed"), Status: response.StatusCode}
	}
	var result map[string]any
	if len(envelope.Data) > 0 && string(envelope.Data) != "null" {
		if err := json.Unmarshal(envelope.Data, &result); err != nil {
			return "", &gatewayError{Code: "upstream_invalid_response", Message: "Feishu media upload payload could not be decoded", Hint: err.Error()}
		}
	}
	fileToken := strings.TrimSpace(stringValue(result["file_token"]))
	if fileToken == "" {
		return "", &gatewayError{Code: "upstream_invalid_response", Message: "Feishu media upload did not return file_token"}
	}
	return fileToken, nil
}

func (s *Service) uploadDriveFile(ctx context.Context, bearer string, folderToken string, filePath string, sizeBytes int64) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("file_name", filepath.Base(filePath))
	_ = writer.WriteField("parent_type", "explorer")
	_ = writer.WriteField("parent_node", folderToken)
	_ = writer.WriteField("size", fmt.Sprintf("%d", sizeBytes))
	part, err := writer.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	request, err := http.NewRequestWithContext(ctx, "POST", s.gateway.domain+driveFileUploadAllPath, &body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := s.gateway.httpClient.Do(request)
	if err != nil {
		return "", &gatewayError{Code: "upstream_unreachable", Message: "Cannot reach Feishu OpenAPI", Hint: err.Error()}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return "", err
	}
	var envelope struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", &gatewayError{Code: "upstream_invalid_response", Message: "Feishu file upload response was not valid JSON", Hint: previewResponseBody(raw)}
	}
	if envelope.Code != 0 {
		return "", &gatewayError{Code: feishuErrorCode(envelope.Code), Message: fallbackErrorMessage(envelope.Msg, "Feishu file upload failed"), Status: response.StatusCode}
	}
	var result map[string]any
	if len(envelope.Data) > 0 && string(envelope.Data) != "null" {
		if err := json.Unmarshal(envelope.Data, &result); err != nil {
			return "", &gatewayError{Code: "upstream_invalid_response", Message: "Feishu file upload payload could not be decoded", Hint: err.Error()}
		}
	}
	fileToken := strings.TrimSpace(stringValue(result["file_token"]))
	if fileToken == "" {
		return "", &gatewayError{Code: "upstream_invalid_response", Message: "Feishu file upload did not return file_token"}
	}
	return fileToken, nil
}

func fileStatSize(file *os.File) int64 {
	info, err := file.Stat()
	if err != nil {
		return 0
	}
	return info.Size()
}
