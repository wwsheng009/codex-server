package feishutools

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"
)

const (
	sheetsMetaPathTemplate        = "/open-apis/sheets/v3/spreadsheets/%s"
	sheetsQueryPathTemplate       = "/open-apis/sheets/v3/spreadsheets/%s/sheets/query"
	sheetsValuesPathTemplate      = "/open-apis/sheets/v2/spreadsheets/%s/values"
	sheetsValuePathTemplate       = "/open-apis/sheets/v2/spreadsheets/%s/values/%s"
	sheetsAppendPathTemplate      = "/open-apis/sheets/v2/spreadsheets/%s/values_append"
	sheetsFindPathTemplate        = "/open-apis/sheets/v2/spreadsheets/%s/sheets/%s/find"
	sheetsCreatePath              = "/open-apis/sheets/v3/spreadsheets"
	wikiGetNodePath               = "/open-apis/wiki/v2/spaces/get_node"
	driveExportCreatePath         = "/open-apis/drive/v1/export_tasks"
	driveExportGetPathTemplate    = "/open-apis/drive/v1/export_tasks/%s"
	driveExportDownloadPathTmpl   = "/open-apis/drive/v1/export_tasks/file/%s/download"
	sheetsExportPollMaxRetries    = 20
	sheetsExportPollInterval      = 1 * time.Second
	sheetsDefaultReadMaxRows      = 500
	sheetsDefaultWriteMaxRows     = 5000
	sheetsDefaultWriteMaxCols     = 100
)

func (s *Service) runSheet(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "info":
		return s.runSheetInfo(ctx, workspaceID, config, params)
	case "read":
		return s.runSheetRead(ctx, workspaceID, config, params)
	case "write":
		return s.runSheetWrite(ctx, workspaceID, config, params)
	case "append":
		return s.runSheetAppend(ctx, workspaceID, config, params)
	case "find":
		return s.runSheetFind(ctx, workspaceID, config, params)
	case "create":
		return s.runSheetCreate(ctx, workspaceID, config, params)
	case "export":
		return s.runSheetExport(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_sheet", action))
	}
}

func (s *Service) runSheetInfo(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, sheetIDFromURL, principal, err := s.resolveSheetToken(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}

	sheetToken, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var meta struct {
		Spreadsheet map[string]any `json:"spreadsheet"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(sheetsMetaPathTemplate, url.PathEscape(token)), nil, sheetToken.AccessToken, nil, &meta); err != nil {
		return nil, err
	}

	var sheetList struct {
		Sheets []map[string]any `json:"sheets"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(sheetsQueryPathTemplate, url.PathEscape(token)), nil, sheetToken.AccessToken, nil, &sheetList); err != nil {
		return nil, err
	}

	return map[string]any{
		"spreadsheetToken": token,
		"sheetId":          sheetIDFromURL,
		"spreadsheet":      meta.Spreadsheet,
		"sheets":           sheetList.Sheets,
		"principal":        principal,
	}, nil
}

func (s *Service) runSheetRead(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, sheetIDFromURL, principal, err := s.resolveSheetToken(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	targetRange, err := s.resolveSheetRange(ctx, workspaceID, config, token, stringParam(params, "range"), firstNonEmpty(strings.TrimSpace(stringParam(params, "sheetId", "sheet_id")), sheetIDFromURL))
	if err != nil {
		return nil, err
	}

	query := url.Values{}
	query.Set("valueRenderOption", firstNonEmpty(strings.TrimSpace(stringParam(params, "valueRenderOption", "value_render_option")), "ToString"))
	query.Set("dateTimeRenderOption", firstNonEmpty(strings.TrimSpace(stringParam(params, "dateTimeRenderOption", "date_time_render_option")), "FormattedString"))

	var result struct {
		ValueRange struct {
			Range  string  `json:"range"`
			Values [][]any `json:"values"`
		} `json:"valueRange"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(sheetsValuePathTemplate, url.PathEscape(token), url.PathEscape(targetRange)), query, access.AccessToken, nil, &result); err != nil {
		return nil, err
	}

	values, truncated, totalRows := truncateSheetValues(result.ValueRange.Values, sheetsDefaultReadMaxRows)
	return map[string]any{
		"spreadsheetToken": token,
		"range":            result.ValueRange.Range,
		"values":           values,
		"truncated":        truncated,
		"totalRows":        totalRows,
		"principal":        principal,
	}, nil
}

func (s *Service) runSheetWrite(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	return s.runSheetWriteLike(ctx, workspaceID, config, params, "write")
}

func (s *Service) runSheetAppend(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	return s.runSheetWriteLike(ctx, workspaceID, config, params, "append")
}

func (s *Service) runSheetWriteLike(ctx context.Context, workspaceID string, config Config, params map[string]any, mode string) (map[string]any, error) {
	token, sheetIDFromURL, principal, err := s.resolveSheetToken(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	values, err := matrixParam(params, "values", "data")
	if err != nil {
		return nil, err
	}
	if len(values) == 0 {
		return nil, toolInvalidInput("values is required")
	}
	if len(values) > sheetsDefaultWriteMaxRows {
		return nil, toolInvalidInput(fmt.Sprintf("values exceeds %d rows", sheetsDefaultWriteMaxRows))
	}
	for _, row := range values {
		if len(row) > sheetsDefaultWriteMaxCols {
			return nil, toolInvalidInput(fmt.Sprintf("row exceeds %d columns", sheetsDefaultWriteMaxCols))
		}
	}

	targetRange, err := s.resolveSheetRange(ctx, workspaceID, config, token, stringParam(params, "range"), firstNonEmpty(strings.TrimSpace(stringParam(params, "sheetId", "sheet_id")), sheetIDFromURL))
	if err != nil {
		return nil, err
	}

	payload := map[string]any{
		"valueRange": map[string]any{
			"range":  targetRange,
			"values": values,
		},
	}

	if mode == "write" {
		var result map[string]any
		if err := s.gateway.doJSON(ctx, "PUT", fmt.Sprintf(sheetsValuesPathTemplate, url.PathEscape(token)), nil, access.AccessToken, payload, &result); err != nil {
			return nil, err
		}
		result["spreadsheetToken"] = token
		result["range"] = targetRange
		result["principal"] = principal
		return result, nil
	}

	var result struct {
		TableRange string         `json:"tableRange"`
		Updates    map[string]any `json:"updates"`
	}
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(sheetsAppendPathTemplate, url.PathEscape(token)), nil, access.AccessToken, payload, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"spreadsheetToken": token,
		"range":            targetRange,
		"tableRange":       result.TableRange,
		"updates":          result.Updates,
		"principal":        principal,
	}, nil
}

func (s *Service) runSheetFind(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, _, principal, err := s.resolveSheetToken(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	sheetID := strings.TrimSpace(stringParam(params, "sheetId", "sheet_id"))
	if sheetID == "" {
		return nil, toolInvalidInput("sheetId is required for find")
	}
	findText := strings.TrimSpace(stringParam(params, "find", "query", "keyword"))
	if findText == "" {
		return nil, toolInvalidInput("find is required")
	}

	findCondition := map[string]any{
		"range": sheetID,
	}
	if cellRange := strings.TrimSpace(stringParam(params, "range")); cellRange != "" {
		findCondition["range"] = sheetID + "!" + cellRange
	}
	if value, ok := boolParam(params, "matchCase", "match_case"); ok {
		findCondition["match_case"] = !value
	}
	if value, ok := boolParam(params, "matchEntireCell", "match_entire_cell"); ok {
		findCondition["match_entire_cell"] = value
	}
	if value, ok := boolParam(params, "searchByRegex", "search_by_regex"); ok {
		findCondition["search_by_regex"] = value
	}
	if value, ok := boolParam(params, "includeFormulas", "include_formulas"); ok {
		findCondition["include_formulas"] = value
	}

	var result struct {
		FindResult map[string]any `json:"find_result"`
	}
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(sheetsFindPathTemplate, url.PathEscape(token), url.PathEscape(sheetID)), nil, access.AccessToken, map[string]any{
		"find":           findText,
		"find_condition": findCondition,
	}, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"spreadsheetToken": token,
		"sheetId":          sheetID,
		"find":             findText,
		"result":           result.FindResult,
		"principal":        principal,
	}, nil
}

func (s *Service) runSheetCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	title := strings.TrimSpace(stringParam(params, "title"))
	if title == "" {
		return nil, toolInvalidInput("title is required")
	}
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	body := map[string]any{"title": title}
	if folderToken := strings.TrimSpace(stringParam(params, "folderToken", "folder_token")); folderToken != "" {
		body["folder_token"] = folderToken
	}

	var created struct {
		Spreadsheet map[string]any `json:"spreadsheet"`
	}
	if err := s.gateway.doJSON(ctx, "POST", sheetsCreatePath, nil, access.AccessToken, body, &created); err != nil {
		return nil, err
	}

	token := stringValue(created.Spreadsheet["spreadsheet_token"])
	result := map[string]any{
		"spreadsheet": created.Spreadsheet,
		"principal":   "user",
	}
	if token != "" {
		result["spreadsheetToken"] = token
	}

	headers := stringSliceParam(params, "headers")
	rows, _ := matrixParam(params, "data", "values")
	if len(headers) > 0 || len(rows) > 0 {
		allRows := make([][]any, 0, len(rows)+1)
		if len(headers) > 0 {
			headerRow := make([]any, 0, len(headers))
			for _, item := range headers {
				headerRow = append(headerRow, item)
			}
			allRows = append(allRows, headerRow)
		}
		allRows = append(allRows, rows...)
		if token != "" && len(allRows) > 0 {
			sheetID, rangeErr := s.resolveSheetRange(ctx, workspaceID, config, token, "", "")
			if rangeErr == nil && sheetID != "" {
				writeRange := sheetID + "!A1:" + colLetter(maxColumns(allRows)) + fmt.Sprintf("%d", len(allRows))
				_, writeErr := s.runSheetWriteLike(ctx, workspaceID, config, map[string]any{
					"spreadsheetToken": token,
					"range":            writeRange,
					"values":           allRows,
				}, "write")
				if writeErr != nil {
					result["warning"] = writeErr.Error()
				}
			}
		}
	}

	return result, nil
}

func (s *Service) runSheetExport(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, _, _, err := s.resolveSheetToken(ctx, workspaceID, config, params)
	if err != nil {
		return nil, err
	}
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	fileExtension := firstNonEmpty(strings.TrimSpace(stringParam(params, "fileExtension", "file_extension")), "xlsx")
	if fileExtension != "xlsx" && fileExtension != "csv" {
		return nil, toolInvalidInput("fileExtension must be xlsx or csv")
	}
	sheetID := strings.TrimSpace(stringParam(params, "sheetId", "sheet_id"))
	if fileExtension == "csv" && sheetID == "" {
		return nil, toolInvalidInput("sheetId is required when exporting csv")
	}

	var created struct {
		Ticket string `json:"ticket"`
	}
	if err := s.gateway.doJSON(ctx, "POST", driveExportCreatePath, nil, access.AccessToken, map[string]any{
		"file_extension": fileExtension,
		"token":          token,
		"type":           "sheet",
		"sub_id":         sheetID,
	}, &created); err != nil {
		return nil, err
	}
	if created.Ticket == "" {
		return nil, &gatewayError{Code: "export_failed", Message: "Feishu export task did not return a ticket"}
	}

	var latest struct {
		Result map[string]any `json:"result"`
	}
	for i := 0; i < sheetsExportPollMaxRetries; i++ {
		query := url.Values{}
		query.Set("token", token)
		if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(driveExportGetPathTemplate, url.PathEscape(created.Ticket)), query, access.AccessToken, nil, &latest); err != nil {
			return nil, err
		}
		status, _ := latest.Result["job_status"].(float64)
		if int(status) == 0 {
			break
		}
		if int(status) >= 3 {
			return nil, &gatewayError{Code: "export_failed", Message: firstNonEmpty(stringValue(latest.Result["job_error_msg"]), "Feishu export task failed")}
		}
		if i < sheetsExportPollMaxRetries-1 {
			time.Sleep(sheetsExportPollInterval)
		}
	}

	fileToken := stringValue(latest.Result["file_token"])
	result := map[string]any{
		"spreadsheetToken": token,
		"ticket":           created.Ticket,
		"result":           latest.Result,
		"principal":        "user",
	}
	if fileToken == "" {
		return result, nil
	}

	if value, ok := boolParam(params, "download", "includeFile"); ok && value {
		download, err := s.gateway.downloadResource(ctx, fmt.Sprintf(driveExportDownloadPathTmpl, url.PathEscape(fileToken)), nil, access.AccessToken, 10*1024*1024)
		if err != nil {
			return nil, err
		}
		result["file"] = map[string]any{
			"fileToken":   fileToken,
			"contentType": download.ContentType,
			"sizeBytes":   download.SizeBytes,
			"bodyBase64":  base64.StdEncoding.EncodeToString(download.Bytes),
			"fileName":    path.Base(firstNonEmpty(stringValue(latest.Result["file_name"]), fileToken+"."+fileExtension)),
		}
	}
	return result, nil
}

func (s *Service) resolveSheetToken(ctx context.Context, workspaceID string, config Config, params map[string]any) (string, string, string, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return "", "", "", err
	}
	token := strings.TrimSpace(stringParam(params, "spreadsheetToken", "spreadsheet_token"))
	sheetID := strings.TrimSpace(stringParam(params, "sheetId", "sheet_id"))
	if token == "" {
		rawURL := strings.TrimSpace(stringParam(params, "url"))
		if rawURL == "" {
			return "", "", "", toolInvalidInput("spreadsheetToken or url is required")
		}
		parsed, parseErr := parseSheetURL(rawURL)
		if parseErr != nil {
			return "", "", "", toolInvalidInput(parseErr.Error())
		}
		token = parsed.Token
		if sheetID == "" {
			sheetID = parsed.SheetID
		}
	}
	if strings.HasPrefix(token, "wik") {
		query := url.Values{}
		query.Set("token", token)
		query.Set("obj_type", "wiki")
		var node struct {
			Node map[string]any `json:"node"`
		}
		if err := s.gateway.doJSON(ctx, "GET", wikiGetNodePath, query, access.AccessToken, nil, &node); err != nil {
			return "", "", "", err
		}
		resolved := strings.TrimSpace(stringValue(node.Node["obj_token"]))
		if resolved == "" {
			return "", "", "", &gatewayError{Code: "invalid_sheet_token", Message: "Wiki node did not resolve to a spreadsheet token"}
		}
		token = resolved
	}
	return token, sheetID, "user", nil
}

func (s *Service) resolveSheetRange(ctx context.Context, workspaceID string, config Config, spreadsheetToken string, explicitRange string, sheetID string) (string, error) {
	if trimmed := strings.TrimSpace(explicitRange); trimmed != "" {
		return trimmed, nil
	}
	if trimmed := strings.TrimSpace(sheetID); trimmed != "" {
		return trimmed, nil
	}
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return "", err
	}
	var result struct {
		Sheets []map[string]any `json:"sheets"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(sheetsQueryPathTemplate, url.PathEscape(spreadsheetToken)), nil, access.AccessToken, nil, &result); err != nil {
		return "", err
	}
	if len(result.Sheets) == 0 {
		return "", toolInvalidInput("spreadsheet has no worksheets")
	}
	firstSheet := strings.TrimSpace(stringValue(result.Sheets[0]["sheet_id"]))
	if firstSheet == "" {
		return "", toolInvalidInput("spreadsheet has no worksheet id")
	}
	return firstSheet, nil
}

type parsedSheetURL struct {
	Token   string
	SheetID string
}

func parseSheetURL(raw string) (parsedSheetURL, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return parsedSheetURL{}, fmt.Errorf("invalid sheet url")
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 2 || (parts[0] != "sheets" && parts[0] != "wiki") {
		return parsedSheetURL{}, fmt.Errorf("invalid sheet url")
	}
	return parsedSheetURL{
		Token:   parts[1],
		SheetID: parsed.Query().Get("sheet"),
	}, nil
}

func truncateSheetValues(values [][]any, maxRows int) ([][]any, bool, int) {
	totalRows := len(values)
	if len(values) <= maxRows {
		return values, false, totalRows
	}
	return values[:maxRows], true, totalRows
}

func matrixParam(params map[string]any, keys ...string) ([][]any, error) {
	for _, key := range keys {
		raw, ok := params[key]
		if !ok || raw == nil {
			continue
		}
		switch typed := raw.(type) {
		case [][]any:
			return typed, nil
		case []any:
			rows := make([][]any, 0, len(typed))
			for _, row := range typed {
				switch rowTyped := row.(type) {
				case []any:
					rows = append(rows, rowTyped)
				case []string:
					items := make([]any, 0, len(rowTyped))
					for _, item := range rowTyped {
						items = append(items, item)
					}
					rows = append(rows, items)
				default:
					return nil, toolInvalidInput("values must be a matrix")
				}
			}
			return rows, nil
		}
		return nil, toolInvalidInput("values must be a matrix")
	}
	return nil, nil
}

func maxColumns(rows [][]any) int {
	max := 1
	for _, row := range rows {
		if len(row) > max {
			max = len(row)
		}
	}
	return max
}

func colLetter(n int) string {
	if n <= 0 {
		return "A"
	}
	result := ""
	for n > 0 {
		n--
		result = string(rune('A'+(n%26))) + result
		n /= 26
	}
	return result
}
