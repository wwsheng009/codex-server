package feishutools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRunBitableAppCreate(t *testing.T) {
	t.Parallel()

	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != bitableAppsPath {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"app":{"app_token":"bas123","name":"CRM"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runBitableApp(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"name": "CRM",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if body["name"] != "CRM" {
		t.Fatalf("unexpected body: %#v", body)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunBitableRecordListUsesSearchEndpoint(t *testing.T) {
	t.Parallel()

	var gotQuery string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/bitable/v1/apps/app123/tables/tbl123/records/search" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		gotQuery = r.URL.RawQuery
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"record_id":"rec1"}],"total":1}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runBitableRecord(context.Background(), "ws", validUserConfig(), "list", map[string]any{
		"appToken": "app123",
		"tableId":  "tbl123",
		"pageSize": 50,
		"filter": map[string]any{
			"conjunction": "and",
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotQuery == "" {
		t.Fatalf("expected query to be set")
	}
	if gotBody["filter"] == nil {
		t.Fatalf("expected filter in request body: %#v", gotBody)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunBitableViewGet(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/bitable/v1/apps/app123/tables/tbl123/views/view123" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"view":{"view_id":"view123","view_name":"Board"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runBitableView(context.Background(), "ws", validUserConfig(), "get", map[string]any{
		"appToken": "app123",
		"tableId":  "tbl123",
		"viewId":   "view123",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestInvokeDispatchesNewTools(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/open-apis/bitable/v1/apps/app123":
			_, _ = w.Write([]byte(`{"code":0,"data":{"app":{"app_token":"app123"}}}`))
		case "/open-apis/sheets/v3/spreadsheets/sht123":
			_, _ = w.Write([]byte(`{"code":0,"data":{"spreadsheet":{"spreadsheet_token":"sht123"}}}`))
		case "/open-apis/sheets/v3/spreadsheets/sht123/sheets/query":
			_, _ = w.Write([]byte(`{"code":0,"data":{"sheets":[]}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	config := validUserConfig()

	res, err := service.runTool(context.Background(), "ws", config, "feishu_bitable_app", "get", map[string]any{"appToken": "app123"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", res)
	}

	res, err = service.runTool(context.Background(), "ws", config, "feishu_sheet", "info", map[string]any{"spreadsheetToken": "sht123"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res["spreadsheetToken"] != "sht123" {
		t.Fatalf("unexpected result: %#v", res)
	}
}
