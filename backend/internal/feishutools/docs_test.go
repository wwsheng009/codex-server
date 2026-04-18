package feishutools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newTestService(t *testing.T, domain string) *Service {
	t.Helper()
	service := NewService(nil, nil, nil, nil)
	service.gateway = newGateway(service, nil).WithDomain(domain)
	return service
}

func validUserConfig() Config {
	now := time.Now().UTC()
	return Config{
		Enabled:      true,
		AppID:        "cli_app",
		AppSecret:    "secret",
		AppSecretSet: true,
		OauthMode:    OauthModeUserAuth,
		UserToken: OauthTokenSnapshot{
			AccessToken:          "u-access",
			RefreshToken:         "u-refresh",
			AccessTokenExpiresAt: now.Add(1 * time.Hour),
			Scopes:               []string{"docx:document:readonly"},
			OpenID:               "ou_1",
		},
	}
}

type docsRewriteServerState struct {
	rawContent         string
	childrenBefore     int
	convertPayloads    []map[string]any
	descendantPayloads []map[string]any
	convertCalls       int
	deleteCalls        int
	listCalls          int
	descendantCalls    int
}

func newDocsRewriteServer(t *testing.T, state *docsRewriteServerState) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/doc-1/raw_content"):
			_, _ = w.Write([]byte(`{"code":0,"data":{"content":` + strconvQuote(state.rawContent) + `}}`))
		case r.URL.Path == docxConvertBlocksPath:
			state.convertCalls++
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode convert body: %v", err)
			}
			state.convertPayloads = append(state.convertPayloads, payload)
			_, _ = w.Write([]byte(`{"code":0,"data":{"first_level_block_ids":["tmp_root"],"blocks":[{"block_id":"tmp_root","block_type":2}]}}`))
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/children" && r.Method == http.MethodGet:
			state.listCalls++
			if state.childrenBefore > 0 && state.listCalls == 1 {
				_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"block_id":"old-1"}],"has_more":false}}`))
				return
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"items":[],"has_more":false}}`))
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/children/batch_delete":
			state.deleteCalls++
			_, _ = w.Write([]byte(`{"code":0,"data":{"document_revision_id":31,"client_token":"ct-delete"}}`))
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/descendant":
			state.descendantCalls++
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode descendant body: %v", err)
			}
			state.descendantPayloads = append(state.descendantPayloads, payload)
			_, _ = w.Write([]byte(`{"code":0,"data":{"children":[{"block_id":"new-1"}],"document_revision_id":32,"client_token":"ct-desc"}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
}

func strconvQuote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func TestRunDocsFetchUsesUserToken(t *testing.T) {
	t.Parallel()

	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if !strings.HasSuffix(r.URL.Path, "/doc-1/raw_content") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"msg":"ok","data":{"content":"# Hello\nWorld"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsFetch(context.Background(), "ws", validUserConfig(), map[string]any{"documentId": "doc-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotAuth != "Bearer u-access" {
		t.Fatalf("expected user token bearer, got %q", gotAuth)
	}
	if content, _ := result["content"].(string); !strings.HasPrefix(content, "# Hello") {
		t.Fatalf("unexpected content: %#v", result)
	}
	if principal, _ := result["principal"].(string); principal != "user" {
		t.Fatalf("expected user principal, got %q", principal)
	}
}

func TestRunDocsFetchFallsBackToTenantTokenOnAuthError(t *testing.T) {
	t.Parallel()

	var tenantCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case openAPITenantTokenPath:
			tenantCalls++
			_, _ = w.Write([]byte(`{"code":0,"tenant_access_token":"t-123","expire":3600}`))
		default:
			if r.Header.Get("Authorization") == "Bearer u-access" {
				// Simulate Feishu rejecting the user token (e.g. scope missing).
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"code":99991668,"msg":"permission denied"}`))
				return
			}
			if r.Header.Get("Authorization") != "Bearer t-123" {
				t.Errorf("unexpected auth header %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"content":"Fallback"}}`))
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	config := validUserConfig()
	// The first user-token call returns a non-auth error from Feishu which is
	// not classified as a gateway-layer user_oauth_* error; make sure the
	// docs implementation does not fall back in that case.
	_, err := service.runDocsFetch(context.Background(), "ws", config, map[string]any{"documentId": "doc-1"})
	if err == nil {
		t.Fatalf("expected error to surface from user token call")
	}
	if tenantCalls != 0 {
		t.Fatalf("expected tenant token path not to be exercised, got %d calls", tenantCalls)
	}

	// Now drop user token entirely so the gateway reports user_oauth_required
	// and the fallback kicks in.
	config.UserToken = OauthTokenSnapshot{}
	result, err := service.runDocsFetch(context.Background(), "ws", config, map[string]any{"documentId": "doc-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if principal, _ := result["principal"].(string); principal != "tenant" {
		t.Fatalf("expected tenant principal, got %q", principal)
	}
	if tenantCalls != 1 {
		t.Fatalf("expected one tenant token request, got %d", tenantCalls)
	}
}

func TestRunDocsCreateSendsTitle(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != docxDocumentsPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"document":{"document_id":"doc-new","revision_id":1,"title":"Hello"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsCreate(context.Background(), "ws", validUserConfig(), map[string]any{
		"title":       "Hello",
		"folderToken": "fld_1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["title"] != "Hello" {
		t.Fatalf("unexpected request body: %#v", received)
	}
	if received["folder_token"] != "fld_1" {
		t.Fatalf("expected folder_token to be forwarded: %#v", received)
	}
	if id, _ := result["documentId"].(string); id != "doc-new" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocsUpdateAppendsTextBlocks(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/blocks/doc-1/children") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"children":[],"document_revision_id":7,"client_token":"ct"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "append_text", map[string]any{
		"documentId": "doc-1",
		"content":    "Line 1\nLine 2",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	children, _ := received["children"].([]any)
	if len(children) != 2 {
		t.Fatalf("expected 2 children blocks, got %d", len(children))
	}
	if count, _ := result["appendedCount"].(int); count != 2 {
		// JSON numbers decoded into map[string]any become float64; accept either.
		if countF, _ := result["appendedCount"].(float64); countF != 2 {
			t.Fatalf("unexpected appendedCount: %#v", result["appendedCount"])
		}
	}
}

func TestRunDocsUpdateAppendMarkdownConvertsThenCreatesDescendants(t *testing.T) {
	t.Parallel()

	var convertReceived map[string]any
	var descendantReceived map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == docxConvertBlocksPath:
			if err := json.NewDecoder(r.Body).Decode(&convertReceived); err != nil {
				t.Errorf("decode convert body: %v", err)
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"first_level_block_ids":["tmp_h1","tmp_p1"],"blocks":[{"block_id":"tmp_h1","block_type":3},{"block_id":"tmp_p1","block_type":2}],"block_id_to_image_urls":[]}}`))
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/descendant":
			if err := json.NewDecoder(r.Body).Decode(&descendantReceived); err != nil {
				t.Errorf("decode descendant body: %v", err)
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"children":[{"block_id":"b1"},{"block_id":"b2"}],"document_revision_id":9,"client_token":"ct-append"}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "append", map[string]any{
		"documentId": "doc-1",
		"markdown":   "## Title\n\nBody",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if convertReceived["content_type"] != "markdown" || convertReceived["content"] != "## Title\n\nBody" {
		t.Fatalf("unexpected convert payload: %#v", convertReceived)
	}
	if ids, _ := descendantReceived["children_id"].([]any); len(ids) != 2 {
		t.Fatalf("unexpected descendant payload: %#v", descendantReceived)
	}
	if result["mode"] != "append" || result["insertedCount"] != 2 || result["blockCount"] != 2 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocsUpdateOverwriteClearsThenCreatesDescendants(t *testing.T) {
	t.Parallel()

	var deleteReceived map[string]any
	var deleteCalls int
	var descendantReceived map[string]any
	var listCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == docxConvertBlocksPath:
			_, _ = w.Write([]byte(`{"code":0,"data":{"first_level_block_ids":["tmp_root"],"blocks":[{"block_id":"tmp_root","block_type":2}]}}`))
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/children" && r.Method == http.MethodGet:
			listCalls++
			if listCalls == 1 {
				_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"block_id":"old-1"},{"block_id":"old-2"}],"has_more":false}}`))
				return
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"items":[],"has_more":false}}`))
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/children/batch_delete":
			deleteCalls++
			if err := json.NewDecoder(r.Body).Decode(&deleteReceived); err != nil {
				t.Errorf("decode delete body: %v", err)
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"document_revision_id":10,"client_token":"ct-delete"}}`))
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/descendant":
			if err := json.NewDecoder(r.Body).Decode(&descendantReceived); err != nil {
				t.Errorf("decode descendant body: %v", err)
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"children":[{"block_id":"new-1"}],"document_revision_id":11,"client_token":"ct-overwrite"}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "overwrite", map[string]any{
		"documentId": "doc-1",
		"markdown":   "# New Doc",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if deleteCalls != 1 {
		t.Fatalf("expected one delete call, got %d", deleteCalls)
	}
	if deleteReceived["start_index"] != float64(0) || deleteReceived["end_index"] != float64(2) {
		t.Fatalf("unexpected delete payload: %#v", deleteReceived)
	}
	if ids, _ := descendantReceived["children_id"].([]any); len(ids) != 1 {
		t.Fatalf("unexpected descendant payload: %#v", descendantReceived)
	}
	if result["mode"] != "overwrite" || result["clearedCount"] != 2 || result["documentRevisionId"] != int64(11) {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocsUpdateOverwriteAllowsEmptyMarkdownForClear(t *testing.T) {
	t.Parallel()

	var deleteCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/children" && r.Method == http.MethodGet:
			if deleteCalls == 0 {
				_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"block_id":"old-1"}],"has_more":false}}`))
				return
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"items":[],"has_more":false}}`))
		case r.URL.Path == "/open-apis/docx/v1/documents/doc-1/blocks/doc-1/children/batch_delete":
			deleteCalls++
			_, _ = w.Write([]byte(`{"code":0,"data":{"document_revision_id":12,"client_token":"ct-clear"}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "overwrite", map[string]any{
		"documentId": "doc-1",
		"markdown":   "",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if deleteCalls != 1 {
		t.Fatalf("expected delete call, got %d", deleteCalls)
	}
	if result["insertedCount"] != 0 || result["clearedCount"] != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocsUpdateReplaceRangeExactMatch(t *testing.T) {
	t.Parallel()

	state := &docsRewriteServerState{
		rawContent:     "# Title\n\nAlpha old text.\n\n## Tail\n\nDone.\n",
		childrenBefore: 1,
	}
	server := newDocsRewriteServer(t, state)
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "replace_range", map[string]any{
		"documentId":              "doc-1",
		"selection_with_ellipsis": "Alpha old text.",
		"markdown":                "Alpha new text.",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state.convertCalls != 1 || len(state.convertPayloads) != 1 {
		t.Fatalf("expected one convert call, got %#v", state)
	}
	if state.convertPayloads[0]["content"] != "# Title\n\nAlpha new text.\n\n## Tail\n\nDone.\n" {
		t.Fatalf("unexpected rewritten markdown: %#v", state.convertPayloads[0])
	}
	if result["mode"] != "replace_range" || result["selectionType"] != docSelectionTypeEllipsis || result["strategy"] != docRewriteStrategy {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocsUpdateReplaceRangeRejectsAmbiguousSelection(t *testing.T) {
	t.Parallel()

	state := &docsRewriteServerState{
		rawContent: "repeat\n\nrepeat\n",
	}
	server := newDocsRewriteServer(t, state)
	defer server.Close()

	service := newTestService(t, server.URL)
	_, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "replace_range", map[string]any{
		"documentId":              "doc-1",
		"selection_with_ellipsis": "repeat",
		"markdown":                "updated",
	})
	if err == nil {
		t.Fatalf("expected ambiguous selection error")
	}
	if !strings.Contains(err.Error(), "multiple ranges") {
		t.Fatalf("unexpected error: %v", err)
	}
	if state.convertCalls != 0 || state.descendantCalls != 0 {
		t.Fatalf("targeted rewrite should stop before overwrite: %#v", state)
	}
}

func TestRunDocsUpdateReplaceRangeByTitle(t *testing.T) {
	t.Parallel()

	state := &docsRewriteServerState{
		rawContent:     "# Title\n\n## Details\n\nOld section.\n\n### Child\n\nChild text.\n\n## Tail\n\nDone.\n",
		childrenBefore: 1,
	}
	server := newDocsRewriteServer(t, state)
	defer server.Close()

	service := newTestService(t, server.URL)
	_, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "replace_range", map[string]any{
		"documentId":         "doc-1",
		"selection_by_title": "## Details",
		"markdown":           "## Details\n\nNew section.\n",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state.convertPayloads[0]["content"] != "# Title\n\n## Details\n\nNew section.\n## Tail\n\nDone.\n" {
		t.Fatalf("unexpected rewritten markdown: %#v", state.convertPayloads[0])
	}
}

func TestRunDocsUpdateReplaceAllReturnsReplaceCount(t *testing.T) {
	t.Parallel()

	state := &docsRewriteServerState{
		rawContent:     "Alpha\n\nAlpha\n\nBeta\n",
		childrenBefore: 1,
	}
	server := newDocsRewriteServer(t, state)
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "replace_all", map[string]any{
		"documentId":              "doc-1",
		"selection_with_ellipsis": "Alpha",
		"markdown":                "Gamma",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state.convertPayloads[0]["content"] != "Gamma\n\nGamma\n\nBeta\n" {
		t.Fatalf("unexpected rewritten markdown: %#v", state.convertPayloads[0])
	}
	if result["replaceCount"] != 2 {
		t.Fatalf("unexpected replaceCount: %#v", result["replaceCount"])
	}
}

func TestRunDocsUpdateInsertBefore(t *testing.T) {
	t.Parallel()

	state := &docsRewriteServerState{
		rawContent:     "# Title\n\n## Tail\n\nDone.\n",
		childrenBefore: 1,
	}
	server := newDocsRewriteServer(t, state)
	defer server.Close()

	service := newTestService(t, server.URL)
	_, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "insert_before", map[string]any{
		"documentId":              "doc-1",
		"selection_with_ellipsis": "## Tail",
		"markdown":                "> Notice\n\n",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state.convertPayloads[0]["content"] != "# Title\n\n> Notice\n\n## Tail\n\nDone.\n" {
		t.Fatalf("unexpected rewritten markdown: %#v", state.convertPayloads[0])
	}
}

func TestRunDocsUpdateInsertAfter(t *testing.T) {
	t.Parallel()

	state := &docsRewriteServerState{
		rawContent:     "# Title\n\n## Tail\n\nDone.\n",
		childrenBefore: 1,
	}
	server := newDocsRewriteServer(t, state)
	defer server.Close()

	service := newTestService(t, server.URL)
	_, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "insert_after", map[string]any{
		"documentId":              "doc-1",
		"selection_with_ellipsis": "## Tail",
		"markdown":                "\n> Follow-up",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state.convertPayloads[0]["content"] != "# Title\n\n## Tail\n> Follow-up\n\nDone.\n" {
		t.Fatalf("unexpected rewritten markdown: %#v", state.convertPayloads[0])
	}
}

func TestRunDocsUpdateDeleteRangeWithoutMarkdown(t *testing.T) {
	t.Parallel()

	state := &docsRewriteServerState{
		rawContent:     "# Title\n\n## Remove\n\nDrop me.\n\n## Tail\n\nDone.\n",
		childrenBefore: 1,
	}
	server := newDocsRewriteServer(t, state)
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "delete_range", map[string]any{
		"documentId":         "doc-1",
		"selection_by_title": "## Remove",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state.convertPayloads[0]["content"] != "# Title\n\n## Tail\n\nDone.\n" {
		t.Fatalf("unexpected rewritten markdown: %#v", state.convertPayloads[0])
	}
	if result["mode"] != "delete_range" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocsUpdateRejectsMissingSelectionMatch(t *testing.T) {
	t.Parallel()

	state := &docsRewriteServerState{
		rawContent: "# Title\n\nBody\n",
	}
	server := newDocsRewriteServer(t, state)
	defer server.Close()

	service := newTestService(t, server.URL)
	_, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "replace_range", map[string]any{
		"documentId":              "doc-1",
		"selection_with_ellipsis": "missing",
		"markdown":                "updated",
	})
	if err == nil {
		t.Fatalf("expected no-match error")
	}
	if !strings.Contains(err.Error(), "did not match") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunDocsUpdateRejectsMissingMarkdownForTargetedInsert(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "insert_before", map[string]any{
		"documentId":              "doc-1",
		"selection_with_ellipsis": "Body",
	})
	if err == nil {
		t.Fatalf("expected markdown validation error")
	}
	if !strings.Contains(err.Error(), "markdown is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunDocsUpdateRejectsUnsupportedAction(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runDocsUpdate(context.Background(), "ws", validUserConfig(), "unknown_action", map[string]any{
		"documentId": "doc-1",
		"content":    "ignored",
	})
	if err == nil {
		t.Fatalf("expected error for unsupported action")
	}
	if !strings.Contains(err.Error(), "unsupported action") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestRunDocsSearchSendsQueryAndRequiresUserToken(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != suiteSearchDocsObjectPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"has_more":false,"total":1,"docs_entities":[{"docs_token":"t"}]}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocsSearch(context.Background(), "ws", validUserConfig(), map[string]any{
		"query": "budget",
		"count": 10,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["search_key"] != "budget" {
		t.Fatalf("unexpected request body: %#v", received)
	}
	if items, _ := result["items"].([]map[string]any); len(items) != 1 {
		t.Fatalf("unexpected items: %#v", result["items"])
	}

	// Without a user token the search must fail fast.
	config := validUserConfig()
	config.UserToken = OauthTokenSnapshot{}
	_, err = service.runDocsSearch(context.Background(), "ws", config, map[string]any{"query": "x"})
	if err == nil {
		t.Fatalf("expected user_oauth_required error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok || gerr.Code != "user_oauth_required" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestInvokeValidatesToolNameAndAllowlist(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")

	// Unknown tool name is rejected.
	if _, err := service.Invoke(context.Background(), "ws", InvokeInput{ToolName: "does_not_exist"}); err == nil {
		t.Fatalf("expected error for unknown tool")
	}
}

func TestRunDriveFileListUsesUserToken(t *testing.T) {
	t.Parallel()

	var gotAuth string
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotQuery = r.URL.RawQuery
		if r.URL.Path != driveFilesPath {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"files":[{"token":"fld_1","name":"Folder"}],"has_more":true,"next_page_token":"next-1"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDriveFile(context.Background(), "ws", validUserConfig(), "list", map[string]any{
		"folderToken": "folder_123",
		"pageSize":    10,
		"orderBy":     "EditedTime",
		"direction":   "DESC",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotAuth != "Bearer u-access" {
		t.Fatalf("expected user bearer, got %q", gotAuth)
	}
	if !strings.Contains(gotQuery, "folder_token=folder_123") || !strings.Contains(gotQuery, "page_size=10") {
		t.Fatalf("unexpected query: %q", gotQuery)
	}
	if result["pageToken"] != "next-1" || result["hasMore"] != true {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDriveFileGetMetaBatchQuery(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != driveMetaBatchQueryPath {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"metas":[{"doc_token":"docxcn_1","title":"Roadmap"}]}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDriveFile(context.Background(), "ws", validUserConfig(), "get_meta", map[string]any{
		"request_docs": []any{
			map[string]any{"doc_token": "docxcn_1", "doc_type": "docx"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	requestDocs, _ := received["request_docs"].([]any)
	if len(requestDocs) != 1 {
		t.Fatalf("unexpected request body: %#v", received)
	}
	if result["count"] != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDriveFileCopyUsesFolderAlias(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/drive/v1/files/file_123/copy" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"file":{"token":"file_456","name":"Copy"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDriveFile(context.Background(), "ws", validUserConfig(), "copy", map[string]any{
		"fileToken":  "file_123",
		"name":       "Copy",
		"type":       "docx",
		"parentNode": "folder_456",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["folder_token"] != "folder_456" || received["type"] != "docx" {
		t.Fatalf("unexpected copy body: %#v", received)
	}
	file, _ := result["file"].(map[string]any)
	if file["token"] != "file_456" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDriveFileDownloadReturnsBase64Body(t *testing.T) {
	t.Parallel()

	payload := []byte("hello drive")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/drive/v1/files/file_123/download" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDriveFile(context.Background(), "ws", validUserConfig(), "download", map[string]any{
		"fileToken": "file_123",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["contentType"] != "application/pdf" {
		t.Fatalf("unexpected content type: %#v", result)
	}
	if result["bodyBase64"] != "aGVsbG8gZHJpdmU=" {
		t.Fatalf("unexpected bodyBase64: %#v", result["bodyBase64"])
	}
}

func TestRunDriveFileMoveReturnsSuccessPayload(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/drive/v1/files/file_123/move" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"task_id":"task_1"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDriveFile(context.Background(), "ws", validUserConfig(), "move", map[string]any{
		"fileToken":   "file_123",
		"type":        "docx",
		"folderToken": "folder_1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["folder_token"] != "folder_1" {
		t.Fatalf("unexpected move body: %#v", received)
	}
	if result["task_id"] != "task_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDriveFileDeleteUsesTypeQuery(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/drive/v1/files/file_123" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("type"); got != "docx" {
			t.Fatalf("unexpected type query %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"task_id":"task_2"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDriveFile(context.Background(), "ws", validUserConfig(), "delete", map[string]any{
		"fileToken": "file_123",
		"type":      "docx",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["task_id"] != "task_2" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDriveFileUploadUsesMultipartUploadAll(t *testing.T) {
	t.Parallel()

	tmpFile, err := os.CreateTemp(t.TempDir(), "drive-upload-*.txt")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	defer tmpFile.Close()
	if _, err := tmpFile.WriteString("drive upload"); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != driveFileUploadAllPath {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if !strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
			t.Fatalf("expected multipart upload, got %q", r.Header.Get("Content-Type"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"file_token":"upload_1"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDriveFile(context.Background(), "ws", validUserConfig(), "upload", map[string]any{
		"filePath":    tmpFile.Name(),
		"folderToken": "folder_1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["fileToken"] != "upload_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDriveFileRejectsUnsupportedAction(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runDriveFile(context.Background(), "ws", validUserConfig(), "archive", map[string]any{})
	if err == nil {
		t.Fatalf("expected unsupported action error")
	}
	if !strings.Contains(err.Error(), "unsupported action") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunDocCommentsListUsesDriveCommentPath(t *testing.T) {
	t.Parallel()

	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if r.URL.Path != "/open-apis/drive/v1/files/doc_123/comments" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("file_type"); got != "docx" {
			t.Fatalf("unexpected file_type %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"comment_id":"c_1"}],"has_more":false}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocComments(context.Background(), "ws", validUserConfig(), "list", map[string]any{
		"fileToken": "doc_123",
		"fileType":  "docx",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotAuth != "Bearer u-access" {
		t.Fatalf("unexpected auth header %q", gotAuth)
	}
	items, _ := result["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocCommentsReplyFallsBackToReplyElements(t *testing.T) {
	t.Parallel()

	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if r.URL.Path != "/open-apis/drive/v1/files/doc_123/comments/c_1/replies" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		if callCount == 1 {
			_, _ = w.Write([]byte(`{"code":99991668,"msg":"try alternate payload"}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"reply_id":"r_1"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocComments(context.Background(), "ws", validUserConfig(), "reply", map[string]any{
		"fileToken": "doc_123",
		"fileType":  "docx",
		"commentId": "c_1",
		"content":   "hello",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if callCount != 2 || result["reply_id"] != "r_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocMediaDownloadReturnsBase64Body(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/drive/v1/medias/media_123/download" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("pngdata"))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocMedia(context.Background(), "ws", validUserConfig(), "download", map[string]any{
		"resourceToken": "media_123",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["bodyBase64"] != "cG5nZGF0YQ==" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunDocMediaInsertCreatesUploadsAndPatchesBlock(t *testing.T) {
	t.Parallel()

	tmpFile, err := os.CreateTemp(t.TempDir(), "doc-media-*.txt")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	defer tmpFile.Close()
	if _, err := tmpFile.WriteString("hello media"); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	var createCalled bool
	var uploadCalled bool
	var patchCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/open-apis/docx/v1/documents/doc_1/blocks/doc_1/children":
			createCalled = true
			_, _ = w.Write([]byte(`{"code":0,"data":{"children":[{"block_id":"blk_1"}]}}`))
		case driveMediaUploadAllPath:
			uploadCalled = true
			_, _ = w.Write([]byte(`{"code":0,"data":{"file_token":"media_1"}}`))
		case "/open-apis/docx/v1/documents/doc_1/blocks/batch_update":
			patchCalled = true
			_, _ = w.Write([]byte(`{"code":0,"data":{"ok":true}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runDocMedia(context.Background(), "ws", validUserConfig(), "insert", map[string]any{
		"documentId": "doc_1",
		"filePath":   tmpFile.Name(),
		"type":       "file",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !createCalled || !uploadCalled || !patchCalled {
		t.Fatalf("expected full insert flow, got create=%v upload=%v patch=%v", createCalled, uploadCalled, patchCalled)
	}
	if result["fileToken"] != "media_1" || result["blockId"] != "blk_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}
