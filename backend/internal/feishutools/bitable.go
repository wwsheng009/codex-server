package feishutools

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

const (
	bitableAppsPath                    = "/open-apis/bitable/v1/apps"
	bitableAppPathTemplate             = "/open-apis/bitable/v1/apps/%s"
	bitableAppCopyPathTemplate         = "/open-apis/bitable/v1/apps/%s/copy"
	bitableTablesPathTemplate          = "/open-apis/bitable/v1/apps/%s/tables"
	bitableTablePathTemplate           = "/open-apis/bitable/v1/apps/%s/tables/%s"
	bitableTablesBatchCreatePathTmpl   = "/open-apis/bitable/v1/apps/%s/tables/batch_create"
	bitableFieldsPathTemplate          = "/open-apis/bitable/v1/apps/%s/tables/%s/fields"
	bitableFieldPathTemplate           = "/open-apis/bitable/v1/apps/%s/tables/%s/fields/%s"
	bitableRecordsPathTemplate         = "/open-apis/bitable/v1/apps/%s/tables/%s/records"
	bitableRecordPathTemplate          = "/open-apis/bitable/v1/apps/%s/tables/%s/records/%s"
	bitableRecordsSearchPathTemplate   = "/open-apis/bitable/v1/apps/%s/tables/%s/records/search"
	bitableRecordsBatchCreatePathTmpl  = "/open-apis/bitable/v1/apps/%s/tables/%s/records/batch_create"
	bitableRecordsBatchUpdatePathTmpl  = "/open-apis/bitable/v1/apps/%s/tables/%s/records/batch_update"
	bitableRecordsBatchDeletePathTmpl  = "/open-apis/bitable/v1/apps/%s/tables/%s/records/batch_delete"
	bitableViewsPathTemplate           = "/open-apis/bitable/v1/apps/%s/tables/%s/views"
	bitableViewPathTemplate            = "/open-apis/bitable/v1/apps/%s/tables/%s/views/%s"
	driveFilesPath                     = "/open-apis/drive/v1/files"
)

func (s *Service) runBitableApp(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	switch strings.TrimSpace(action) {
	case "", "create":
		name := strings.TrimSpace(stringParam(params, "name"))
		if name == "" {
			return nil, toolInvalidInput("name is required")
		}
		body := map[string]any{"name": name}
		if folder := strings.TrimSpace(stringParam(params, "folderToken", "folder_token")); folder != "" {
			body["folder_token"] = folder
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", bitableAppsPath, nil, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "get":
		appToken := strings.TrimSpace(stringParam(params, "appToken", "app_token"))
		if appToken == "" {
			return nil, toolInvalidInput("appToken is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(bitableAppPathTemplate, url.PathEscape(appToken)), nil, access.AccessToken, nil, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "list":
		query := url.Values{}
		if folder := strings.TrimSpace(stringParam(params, "folderToken", "folder_token")); folder != "" {
			query.Set("folder_token", folder)
		}
		copyQueryFields(query, params, []string{"page_size", "page_token"}, map[string]string{"pageSize": "page_size", "pageToken": "page_token"})
		var result struct {
			Files     []map[string]any `json:"files"`
			HasMore   bool             `json:"has_more"`
			PageToken string           `json:"page_token"`
		}
		if err := s.gateway.doJSON(ctx, "GET", driveFilesPath, query, access.AccessToken, nil, &result); err != nil {
			return nil, err
		}
		apps := make([]map[string]any, 0, len(result.Files))
		for _, file := range result.Files {
			if stringValue(file["type"]) == "bitable" {
				apps = append(apps, file)
			}
		}
		return map[string]any{"apps": apps, "hasMore": result.HasMore, "pageToken": result.PageToken, "principal": "user"}, nil
	case "patch":
		appToken := strings.TrimSpace(stringParam(params, "appToken", "app_token"))
		if appToken == "" {
			return nil, toolInvalidInput("appToken is required")
		}
		body := mapWithout(params, "appToken", "app_token")
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "PATCH", fmt.Sprintf(bitableAppPathTemplate, url.PathEscape(appToken)), nil, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "copy":
		appToken := strings.TrimSpace(stringParam(params, "appToken", "app_token"))
		name := strings.TrimSpace(stringParam(params, "name"))
		if appToken == "" || name == "" {
			return nil, toolInvalidInput("appToken and name are required")
		}
		body := map[string]any{"name": name}
		if folder := strings.TrimSpace(stringParam(params, "folderToken", "folder_token")); folder != "" {
			body["folder_token"] = folder
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableAppCopyPathTemplate, url.PathEscape(appToken)), nil, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_bitable_app", action))
	}
}

func (s *Service) runBitableTable(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	appToken := strings.TrimSpace(stringParam(params, "appToken", "app_token"))
	if appToken == "" {
		return nil, toolInvalidInput("appToken is required")
	}
	switch strings.TrimSpace(action) {
	case "", "create":
		table := firstDefined(params["table"], params["data"])
		if table == nil {
			table = mapWithout(params, "appToken", "app_token")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableTablesPathTemplate, url.PathEscape(appToken)), nil, access.AccessToken, map[string]any{"table": table}, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "list":
		query := url.Values{}
		copyQueryFields(query, params, []string{"page_size", "page_token"}, map[string]string{"pageSize": "page_size", "pageToken": "page_token"})
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(bitableTablesPathTemplate, url.PathEscape(appToken)), query, access.AccessToken, nil, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "patch":
		tableID := strings.TrimSpace(stringParam(params, "tableId", "table_id"))
		if tableID == "" {
			return nil, toolInvalidInput("tableId is required")
		}
		body := mapWithout(params, "appToken", "app_token", "tableId", "table_id")
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "PATCH", fmt.Sprintf(bitableTablePathTemplate, url.PathEscape(appToken), url.PathEscape(tableID)), nil, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "batch_create":
		tablesRaw := firstDefined(params["tables"], params["items"])
		if tablesRaw == nil {
			return nil, toolInvalidInput("tables is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableTablesBatchCreatePathTmpl, url.PathEscape(appToken)), nil, access.AccessToken, map[string]any{"tables": tablesRaw}, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_bitable_app_table", action))
	}
}

func (s *Service) runBitableField(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	appToken := strings.TrimSpace(stringParam(params, "appToken", "app_token"))
	tableID := strings.TrimSpace(stringParam(params, "tableId", "table_id"))
	if appToken == "" || tableID == "" {
		return nil, toolInvalidInput("appToken and tableId are required")
	}
	switch strings.TrimSpace(action) {
	case "", "create":
		body := mapWithout(params, "appToken", "app_token", "tableId", "table_id")
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableFieldsPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID)), nil, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "list":
		query := url.Values{}
		copyQueryFields(query, params, []string{"view_id", "page_size", "page_token"}, map[string]string{"viewId": "view_id", "pageSize": "page_size", "pageToken": "page_token"})
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(bitableFieldsPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID)), query, access.AccessToken, nil, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "update":
		fieldID := strings.TrimSpace(stringParam(params, "fieldId", "field_id"))
		if fieldID == "" {
			return nil, toolInvalidInput("fieldId is required")
		}
		body := mapWithout(params, "appToken", "app_token", "tableId", "table_id", "fieldId", "field_id")
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "PUT", fmt.Sprintf(bitableFieldPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID), url.PathEscape(fieldID)), nil, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "delete":
		fieldID := strings.TrimSpace(stringParam(params, "fieldId", "field_id"))
		if fieldID == "" {
			return nil, toolInvalidInput("fieldId is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "DELETE", fmt.Sprintf(bitableFieldPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID), url.PathEscape(fieldID)), nil, access.AccessToken, nil, &result); err != nil {
			return nil, err
		}
		if result == nil {
			result = map[string]any{"success": true}
		}
		result["principal"] = "user"
		return result, nil
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_bitable_app_table_field", action))
	}
}

func (s *Service) runBitableRecord(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	appToken := strings.TrimSpace(stringParam(params, "appToken", "app_token"))
	tableID := strings.TrimSpace(stringParam(params, "tableId", "table_id"))
	if appToken == "" || tableID == "" {
		return nil, toolInvalidInput("appToken and tableId are required")
	}
	query := url.Values{}
	if userIDType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type")); userIDType != "" {
		query.Set("user_id_type", userIDType)
	}
	switch strings.TrimSpace(action) {
	case "", "create":
		fields := firstDefined(params["fields"], params["record"])
		if fields == nil {
			return nil, toolInvalidInput("fields is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableRecordsPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID)), query, access.AccessToken, map[string]any{"fields": fields}, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "list":
		copyQueryFields(query, params, []string{"page_size", "page_token"}, map[string]string{"pageSize": "page_size", "pageToken": "page_token"})
		body := mapWithout(params, "appToken", "app_token", "tableId", "table_id", "pageSize", "page_size", "pageToken", "page_token", "userIdType", "user_id_type")
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableRecordsSearchPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID)), query, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "update":
		recordID := strings.TrimSpace(stringParam(params, "recordId", "record_id"))
		fields := params["fields"]
		if recordID == "" || fields == nil {
			return nil, toolInvalidInput("recordId and fields are required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "PUT", fmt.Sprintf(bitableRecordPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID), url.PathEscape(recordID)), query, access.AccessToken, map[string]any{"fields": fields}, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "delete":
		recordID := strings.TrimSpace(stringParam(params, "recordId", "record_id"))
		if recordID == "" {
			return nil, toolInvalidInput("recordId is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "DELETE", fmt.Sprintf(bitableRecordPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID), url.PathEscape(recordID)), query, access.AccessToken, nil, &result); err != nil {
			return nil, err
		}
		if result == nil {
			result = map[string]any{"success": true}
		}
		result["principal"] = "user"
		return result, nil
	case "batch_create":
		records := params["records"]
		if records == nil {
			return nil, toolInvalidInput("records is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableRecordsBatchCreatePathTmpl, url.PathEscape(appToken), url.PathEscape(tableID)), query, access.AccessToken, map[string]any{"records": records}, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "batch_update":
		records := params["records"]
		if records == nil {
			return nil, toolInvalidInput("records is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableRecordsBatchUpdatePathTmpl, url.PathEscape(appToken), url.PathEscape(tableID)), query, access.AccessToken, map[string]any{"records": records}, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "batch_delete":
		recordIDs := firstDefined(params["recordIds"], params["record_ids"], params["records"])
		if recordIDs == nil {
			return nil, toolInvalidInput("recordIds is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableRecordsBatchDeletePathTmpl, url.PathEscape(appToken), url.PathEscape(tableID)), query, access.AccessToken, map[string]any{"records": recordIDs}, &result); err != nil {
			return nil, err
		}
		if result == nil {
			result = map[string]any{"success": true}
		}
		result["principal"] = "user"
		return result, nil
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_bitable_app_table_record", action))
	}
}

func (s *Service) runBitableView(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}
	appToken := strings.TrimSpace(stringParam(params, "appToken", "app_token"))
	tableID := strings.TrimSpace(stringParam(params, "tableId", "table_id"))
	if appToken == "" || tableID == "" {
		return nil, toolInvalidInput("appToken and tableId are required")
	}
	switch strings.TrimSpace(action) {
	case "", "create":
		body := mapWithout(params, "appToken", "app_token", "tableId", "table_id")
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(bitableViewsPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID)), nil, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "get":
		viewID := strings.TrimSpace(stringParam(params, "viewId", "view_id"))
		if viewID == "" {
			return nil, toolInvalidInput("viewId is required")
		}
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(bitableViewPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID), url.PathEscape(viewID)), nil, access.AccessToken, nil, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "list":
		query := url.Values{}
		copyQueryFields(query, params, []string{"page_size", "page_token"}, map[string]string{"pageSize": "page_size", "pageToken": "page_token"})
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(bitableViewsPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID)), query, access.AccessToken, nil, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	case "patch":
		viewID := strings.TrimSpace(stringParam(params, "viewId", "view_id"))
		if viewID == "" {
			return nil, toolInvalidInput("viewId is required")
		}
		body := mapWithout(params, "appToken", "app_token", "tableId", "table_id", "viewId", "view_id")
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "PATCH", fmt.Sprintf(bitableViewPathTemplate, url.PathEscape(appToken), url.PathEscape(tableID), url.PathEscape(viewID)), nil, access.AccessToken, body, &result); err != nil {
			return nil, err
		}
		result["principal"] = "user"
		return result, nil
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_bitable_app_table_view", action))
	}
}
