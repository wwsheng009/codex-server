package jobsmcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"codex-server/backend/internal/automations"
	"codex-server/backend/internal/jobs"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
)

func TestHandleMCPInitializeAndList(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, newTestJobsService(dataStore), dataStore)

	initializeResponse, ok := service.HandleMCP(context.Background(), workspace.ID, []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`))
	if !ok || !strings.Contains(string(initializeResponse), `"protocolVersion":"2025-03-26"`) {
		t.Fatalf("unexpected initialize response %s", string(initializeResponse))
	}

	var initializeEnvelope map[string]any
	if err := json.Unmarshal(initializeResponse, &initializeEnvelope); err != nil {
		t.Fatalf("expected initialize response to be valid json, got %s (%v)", string(initializeResponse), err)
	}
	initializeResult, _ := initializeEnvelope["result"].(map[string]any)
	capabilities, _ := initializeResult["capabilities"].(map[string]any)
	toolsCapabilities, _ := capabilities["tools"].(map[string]any)
	if listChanged, _ := toolsCapabilities["listChanged"].(bool); listChanged {
		t.Fatalf("expected initialize response to advertise stable tools list, got %#v", initializeEnvelope)
	}

	listResponse, ok := service.HandleMCP(context.Background(), workspace.ID, []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`))
	if !ok || !strings.Contains(string(listResponse), `"name":"jobs_list"`) {
		t.Fatalf("unexpected tools/list response %s", string(listResponse))
	}

	var listEnvelope map[string]any
	if err := json.Unmarshal(listResponse, &listEnvelope); err != nil {
		t.Fatalf("expected tools/list response to be valid json, got %s (%v)", string(listResponse), err)
	}
	listResult, _ := listEnvelope["result"].(map[string]any)
	tools, _ := listResult["tools"].([]any)
	if len(tools) == 0 {
		t.Fatalf("expected tools/list to return tools, got %#v", listEnvelope)
	}
	firstTool, _ := tools[0].(map[string]any)
	inputSchema, _ := firstTool["inputSchema"].(map[string]any)
	if inputSchema["type"] != "object" {
		t.Fatalf("expected no-arg tools to include an object inputSchema, got %#v", firstTool)
	}
}

func TestHandleMCPSupportsBatchRequests(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, newTestJobsService(dataStore), dataStore)

	payload := []byte(`[{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}},{"jsonrpc":"2.0","method":"notifications/initialized"}]`)
	response, ok := service.HandleMCP(context.Background(), workspace.ID, payload)
	if !ok {
		t.Fatal("expected batch request to produce a response")
	}

	var items []mcpJSONRPCResponse
	if err := json.Unmarshal(response, &items); err != nil {
		t.Fatalf("expected batch response array, got %s (%v)", string(response), err)
	}
	if len(items) != 1 || items[0].ID != float64(1) {
		t.Fatalf("unexpected batch response %#v", items)
	}
}

func TestHandleMCPLifecycleMethodsReturnEmptyResult(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, newTestJobsService(dataStore), dataStore)

	for _, payload := range []string{
		`{"jsonrpc":"2.0","id":1,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":2,"method":"notifications/initialized"}`,
	} {
		response, ok := service.HandleMCP(context.Background(), workspace.ID, []byte(payload))
		if !ok {
			t.Fatalf("expected response for payload %s", payload)
		}
		if !strings.Contains(string(response), `"result":{}`) {
			t.Fatalf("unexpected lifecycle response %s", string(response))
		}
	}
}

func TestHandleMCPJobExecutorsListReturnsStructuredMetadata(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, newTestJobsService(dataStore), dataStore)

	response, ok := service.HandleMCP(
		context.Background(),
		workspace.ID,
		[]byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"job_executors_list","arguments":{}}}`),
	)
	if !ok {
		t.Fatal("expected tools/call response")
	}

	var envelope map[string]any
	if err := json.Unmarshal(response, &envelope); err != nil {
		t.Fatalf("expected valid tools/call response json, got %s (%v)", string(response), err)
	}

	result, _ := envelope["result"].(map[string]any)
	content, _ := result["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("expected one tool result content item, got %#v", envelope)
	}
	item, _ := content[0].(map[string]any)
	text, _ := item["text"].(string)

	var toolResult struct {
		Executors []jobs.ExecutorDefinition `json:"executors"`
	}
	if err := json.Unmarshal([]byte(text), &toolResult); err != nil {
		t.Fatalf("expected tool result text to contain json payload, got %q (%v)", text, err)
	}

	if len(toolResult.Executors) == 0 {
		t.Fatal("expected executors from MCP tool result")
	}

	var promptDefinition *jobs.ExecutorDefinition
	for index := range toolResult.Executors {
		if toolResult.Executors[index].Kind == "prompt_run" {
			promptDefinition = &toolResult.Executors[index]
			break
		}
	}
	if promptDefinition == nil || promptDefinition.Form == nil {
		t.Fatalf("expected prompt_run metadata in MCP tool result, got %#v", toolResult.Executors)
	}

	threadNameField := findMCPExecutorFormField(promptDefinition.Form.Fields, "threadName")
	if threadNameField == nil || !threadNameField.Advanced || threadNameField.Group != "execution" {
		t.Fatalf("expected prompt_run advanced execution metadata, got %#v", threadNameField)
	}
	modelField := findMCPExecutorFormField(promptDefinition.Form.Fields, "model")
	if modelField == nil || modelField.DataSource == nil || modelField.DataSource.Kind != "workspace_models" {
		t.Fatalf("expected prompt_run datasource metadata in MCP tool result, got %#v", modelField)
	}
}

func findMCPExecutorFormField(fields []jobs.ExecutorFormField, purpose string) *jobs.ExecutorFormField {
	for index := range fields {
		if fields[index].Purpose == purpose {
			return &fields[index]
		}
	}
	return nil
}

func newTestJobsService(dataStore *store.MemoryStore) *jobs.Service {
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", nil)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	automationService := automations.NewService(dataStore, threadService, turnService, nil)
	jobService := jobs.NewService(dataStore, nil)
	jobService.RegisterRunner(automations.NewJobRunner(automationService))
	jobService.RegisterRunner(jobs.NewPromptRunRunner(threadService, turnService, dataStore))
	jobService.RegisterRunner(jobs.NewShellScriptRunner(runtimeManager, dataStore))
	return jobService
}
