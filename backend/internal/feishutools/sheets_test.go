package feishutools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunSheetInfoLoadsSpreadsheetAndSheets(t *testing.T) {
	t.Parallel()

	var hits []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/open-apis/sheets/v3/spreadsheets/sht123":
			_, _ = w.Write([]byte(`{"code":0,"data":{"spreadsheet":{"spreadsheet_token":"sht123","title":"Roadmap"}}}`))
		case "/open-apis/sheets/v3/spreadsheets/sht123/sheets/query":
			_, _ = w.Write([]byte(`{"code":0,"data":{"sheets":[{"sheet_id":"sheetA","title":"Sheet1"}]}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runSheet(context.Background(), "ws", validUserConfig(), "info", map[string]any{"spreadsheetToken": "sht123"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["spreadsheetToken"] != "sht123" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(hits) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(hits))
	}
}

func TestRunSheetReadUsesResolvedRange(t *testing.T) {
	t.Parallel()

	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/open-apis/sheets/v3/spreadsheets/sht123/sheets/query":
			_, _ = w.Write([]byte(`{"code":0,"data":{"sheets":[{"sheet_id":"sheetA"}]}}`))
		case "/open-apis/sheets/v2/spreadsheets/sht123/values/sheetA":
			_, _ = w.Write([]byte(`{"code":0,"data":{"valueRange":{"range":"sheetA","values":[["A","B"],["1","2"]]}}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runSheet(context.Background(), "ws", validUserConfig(), "read", map[string]any{"spreadsheetToken": "sht123"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotPath != "/open-apis/sheets/v2/spreadsheets/sht123/values/sheetA" {
		t.Fatalf("unexpected path %q", gotPath)
	}
	values, _ := result["values"].([][]any)
	if len(values) != 2 {
		t.Fatalf("unexpected values: %#v", result)
	}
}

func TestRunSheetCreateWritesInitialRows(t *testing.T) {
	t.Parallel()

	var writeBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case sheetsCreatePath:
			_, _ = w.Write([]byte(`{"code":0,"data":{"spreadsheet":{"spreadsheet_token":"sht123","title":"Plan"}}}`))
		case "/open-apis/sheets/v3/spreadsheets/sht123/sheets/query":
			_, _ = w.Write([]byte(`{"code":0,"data":{"sheets":[{"sheet_id":"sheetA"}]}}`))
		case "/open-apis/sheets/v2/spreadsheets/sht123/values":
			if err := json.NewDecoder(r.Body).Decode(&writeBody); err != nil {
				t.Fatalf("decode write body: %v", err)
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"updatedCells":6}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runSheet(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"title":   "Plan",
		"headers": []string{"Name", "Status"},
		"data": []any{
			[]any{"Task1", "Open"},
			[]any{"Task2", "Done"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["spreadsheetToken"] != "sht123" {
		t.Fatalf("unexpected result: %#v", result)
	}
	valueRange := writeBody["valueRange"].(map[string]any)
	if valueRange["range"] != "sheetA!A1:B3" {
		t.Fatalf("unexpected write body: %#v", writeBody)
	}
}

func TestParseSheetURL(t *testing.T) {
	t.Parallel()

	parsed, err := parseSheetURL("https://example.feishu.cn/sheets/sht123?sheet=sheetA")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if parsed.Token != "sht123" || parsed.SheetID != "sheetA" {
		t.Fatalf("unexpected parsed value: %#v", parsed)
	}
}

func TestRunSheetExportPollsTicket(t *testing.T) {
	t.Parallel()

	var ticketCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == driveExportCreatePath:
			_, _ = w.Write([]byte(`{"code":0,"data":{"ticket":"tk_1"}}`))
		case r.URL.Path == "/open-apis/drive/v1/export_tasks/tk_1":
			ticketCalls++
			if ticketCalls == 1 {
				_, _ = w.Write([]byte(`{"code":0,"data":{"result":{"job_status":1}}}`))
				return
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"result":{"job_status":0,"file_token":"file_1","file_name":"sheet.xlsx"}}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runSheet(context.Background(), "ws", validUserConfig(), "export", map[string]any{
		"spreadsheetToken": "sht123",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["ticket"] != "tk_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if ticketCalls < 2 {
		t.Fatalf("expected polling, got %d calls", ticketCalls)
	}
	if !strings.Contains(stringValue(result["principal"]), "user") {
		t.Fatalf("unexpected principal: %#v", result["principal"])
	}
}
