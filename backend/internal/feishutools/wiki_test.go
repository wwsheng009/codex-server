package feishutools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunWikiSpaceListUsesUserToken(t *testing.T) {
	t.Parallel()

	var gotAuth string
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotQuery = r.URL.RawQuery
		if r.URL.Path != wikiSpacesPath {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"space_id":"space_1","name":"Knowledge"}],"has_more":true,"page_token":"next_1"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runWikiSpace(context.Background(), "ws", validUserConfig(), "list", map[string]any{
		"pageSize":  100,
		"pageToken": "cursor_1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotAuth != "Bearer u-access" {
		t.Fatalf("unexpected auth header %q", gotAuth)
	}
	if !strings.Contains(gotQuery, "page_size=50") || !strings.Contains(gotQuery, "page_token=cursor_1") {
		t.Fatalf("unexpected query %q", gotQuery)
	}
	if result["pageSize"] != 50 || result["pageToken"] != "next_1" || result["hasMore"] != true {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunWikiSpaceGetFetchesSpace(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/wiki/v2/spaces/space_1" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"space":{"space_id":"space_1","name":"Space One"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runWikiSpace(context.Background(), "ws", validUserConfig(), "get", map[string]any{"spaceId": "space_1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	space, _ := result["space"].(map[string]any)
	if space["space_id"] != "space_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunWikiSpaceCreateSendsOptionalFields(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != wikiSpacesPath {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"space":{"space_id":"space_new","name":"New Space"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runWikiSpace(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"name":        "New Space",
		"description": "Shared docs",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["name"] != "New Space" || received["description"] != "Shared docs" {
		t.Fatalf("unexpected request body: %#v", received)
	}
	if result["principal"] != "user" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunWikiSpaceNodeListUsesAliases(t *testing.T) {
	t.Parallel()

	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		if r.URL.Path != "/open-apis/wiki/v2/spaces/space_1/nodes" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"node_token":"node_1"}],"has_more":false,"page_token":""}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runWikiSpaceNode(context.Background(), "ws", validUserConfig(), "list", map[string]any{
		"spaceId":         "space_1",
		"parentNodeToken": "parent_1",
		"pageSize":        20,
		"pageToken":       "cursor_1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(gotQuery, "parent_node_token=parent_1") || !strings.Contains(gotQuery, "page_size=20") {
		t.Fatalf("unexpected query %q", gotQuery)
	}
	if result["spaceId"] != "space_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunWikiSpaceNodeGetDefaultsObjTypeWiki(t *testing.T) {
	t.Parallel()

	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		if r.URL.Path != wikiGetNodePath {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"node":{"node_token":"wiki_1","obj_token":"docx_1","obj_type":"docx"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runWikiSpaceNode(context.Background(), "ws", validUserConfig(), "get", map[string]any{
		"token": "wiki_1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(gotQuery, "obj_type=wiki") || !strings.Contains(gotQuery, "token=wiki_1") {
		t.Fatalf("unexpected query %q", gotQuery)
	}
	if result["objType"] != "wiki" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunWikiSpaceNodeCreateSendsSnakeCaseBody(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/wiki/v2/spaces/space_1/nodes" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"node":{"node_token":"node_new","title":"Spec"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runWikiSpaceNode(context.Background(), "ws", validUserConfig(), "create", map[string]any{
		"spaceId":         "space_1",
		"objType":         "docx",
		"nodeType":        "origin",
		"parentNodeToken": "parent_1",
		"title":           "Spec",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["obj_type"] != "docx" || received["node_type"] != "origin" || received["parent_node_token"] != "parent_1" {
		t.Fatalf("unexpected request body: %#v", received)
	}
	if result["spaceId"] != "space_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunWikiSpaceNodeMoveSendsTargetParent(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/wiki/v2/spaces/space_1/nodes/node_1/move" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"node":{"node_token":"node_1","parent_node_token":"parent_2"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runWikiSpaceNode(context.Background(), "ws", validUserConfig(), "move", map[string]any{
		"spaceId":           "space_1",
		"nodeToken":         "node_1",
		"targetParentToken": "parent_2",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["target_parent_token"] != "parent_2" {
		t.Fatalf("unexpected request body: %#v", received)
	}
	if result["nodeToken"] != "node_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunWikiSpaceNodeCopySendsTargetFields(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open-apis/wiki/v2/spaces/space_1/nodes/node_1/copy" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"node":{"node_token":"node_copy","space_id":"space_2"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runWikiSpaceNode(context.Background(), "ws", validUserConfig(), "copy", map[string]any{
		"spaceId":           "space_1",
		"nodeToken":         "node_1",
		"targetSpaceId":     "space_2",
		"targetParentToken": "parent_2",
		"title":             "Copied Node",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["target_space_id"] != "space_2" || received["target_parent_token"] != "parent_2" || received["title"] != "Copied Node" {
		t.Fatalf("unexpected request body: %#v", received)
	}
	node, _ := result["node"].(map[string]any)
	if node["node_token"] != "node_copy" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunWikiSpaceNodeRejectsUnsupportedAction(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runWikiSpaceNode(context.Background(), "ws", validUserConfig(), "archive", map[string]any{})
	if err == nil {
		t.Fatalf("expected unsupported action error")
	}
	if !strings.Contains(err.Error(), "unsupported action") {
		t.Fatalf("unexpected error: %v", err)
	}
}
