package jobsmcp

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/jobs"
	"codex-server/backend/internal/store"

	toml "github.com/pelletier/go-toml/v2"
)

var ErrInvalidInput = errors.New("invalid jobs mcp input")

const (
	defaultServerName          = "codex-jobs"
	managedMCPServersKey       = "mcp_servers"
	legacyManagedMCPServersKey = "mcpServers"
	workspaceConfigTomlPath    = ".codex/config.toml"
	mcpProtocolVersion         = "2025-03-26"
)

type Config struct {
	Enabled       bool     `json:"enabled"`
	ServerName    string   `json:"serverName"`
	MCPEndpoint   string   `json:"mcpEndpoint"`
	ToolAllowlist []string `json:"toolAllowlist"`
	UpdatedAt     string   `json:"updatedAt,omitempty"`
}

type RuntimeIntegration struct {
	Status        string `json:"status"`
	Mode          string `json:"mode,omitempty"`
	ServerName    string `json:"serverName,omitempty"`
	ServerURL     string `json:"serverUrl,omitempty"`
	Managed       bool   `json:"managed"`
	ThreadEnabled bool   `json:"threadEnabled"`
	Detail        string `json:"detail,omitempty"`
}

type ConfigResult struct {
	Config             Config              `json:"config"`
	RuntimeIntegration *RuntimeIntegration `json:"runtimeIntegration,omitempty"`
	Source             string              `json:"source,omitempty"`
	UpdatedAt          string              `json:"updatedAt,omitempty"`
	Warnings           []string            `json:"warnings,omitempty"`
	AvailableTools     []string            `json:"availableTools,omitempty"`
}

type ConfigInput struct {
	Enabled       bool
	ServerName    string
	ToolAllowlist []string
}

type Service struct {
	configfs       *configfs.Service
	jobs           *jobs.Service
	store          *store.MemoryStore
	runtimeBaseURL string
}

type mcpJSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpJSONRPCResponse struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      any              `json:"id,omitempty"`
	Result  any              `json:"result,omitempty"`
	Error   *mcpJSONRPCError `json:"error,omitempty"`
}

type mcpJSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpToolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

func NewService(configFS *configfs.Service, jobsService *jobs.Service, dataStore *store.MemoryStore) *Service {
	return &Service{
		configfs: configFS,
		jobs:     jobsService,
		store:    dataStore,
	}
}

func (s *Service) SetRuntimeBaseURL(runtimeBaseURL string) {
	if s == nil {
		return
	}
	s.runtimeBaseURL = strings.TrimSpace(runtimeBaseURL)
}

func (s *Service) ReadConfig(_ context.Context, workspaceID string) (ConfigResult, error) {
	config, stored := s.readStoredConfig(workspaceID)
	if !stored.UpdatedAt.IsZero() {
		config.UpdatedAt = stored.UpdatedAt.Format(time.RFC3339)
	}
	config.MCPEndpoint = s.resolvedManagedMCPEndpointFromToken(workspaceID, stored.ManagedMCPAuthToken)
	raw := s.readWorkspaceConfigFile(workspaceID)
	integration := buildRuntimeIntegration(raw, config)

	return ConfigResult{
		Config:             config,
		RuntimeIntegration: &integration,
		Source:             "workspace_jobs_mcp",
		UpdatedAt:          config.UpdatedAt,
		AvailableTools:     availableToolNames(),
	}, nil
}

func (s *Service) WriteConfig(ctx context.Context, workspaceID string, input ConfigInput) (ConfigResult, error) {
	if s.store == nil {
		return ConfigResult{}, fmt.Errorf("%w: workspace store is unavailable", ErrInvalidInput)
	}
	normalized := normalizeConfigInput(input)
	current, _ := s.store.GetJobMCPConfig(workspaceID)
	persisted := store.JobMCPConfig{
		WorkspaceID:         strings.TrimSpace(workspaceID),
		Enabled:             normalized.Enabled,
		ServerName:          normalized.ServerName,
		ManagedMCPAuthToken: current.ManagedMCPAuthToken,
		ToolAllowlist:       append([]string(nil), normalized.ToolAllowlist...),
		UpdatedAt:           time.Now().UTC(),
	}
	if persisted.ManagedMCPAuthToken == "" {
		token, err := generateAuthToken()
		if err != nil {
			return ConfigResult{}, fmt.Errorf("generate jobs mcp auth token: %w", err)
		}
		persisted.ManagedMCPAuthToken = token
	}
	if _, err := s.store.SetJobMCPConfig(persisted); err != nil {
		return ConfigResult{}, err
	}

	config := Config{
		Enabled:       normalized.Enabled,
		ServerName:    normalized.ServerName,
		ToolAllowlist: append([]string(nil), normalized.ToolAllowlist...),
		UpdatedAt:     persisted.UpdatedAt.Format(time.RFC3339),
		MCPEndpoint:   s.resolvedManagedMCPEndpointFromToken(workspaceID, persisted.ManagedMCPAuthToken),
	}

	rawConfig := s.readWorkspaceConfigFile(workspaceID)
	managedServers, integration := buildManagedMcpServers(rawConfig, config)
	if previousServerName := strings.TrimSpace(current.ServerName); previousServerName != "" && previousServerName != config.ServerName {
		delete(managedServers, previousServerName)
	}
	warnings := make([]string, 0)
	if err := s.writeWorkspaceManagedMcpServers(workspaceID, managedServers); err != nil {
		integration.Status = "sync_failed"
		integration.ThreadEnabled = false
		integration.Detail = "Managed Jobs MCP config could not be written into workspace .codex/config.toml."
		warnings = append(warnings, "Failed to synchronize mcp_servers."+config.ServerName+": "+err.Error())
	} else if s.configfs != nil {
		if err := s.configfs.ReloadMcpServers(ctx, workspaceID); err != nil {
			integration.Status = "reload_failed"
			integration.ThreadEnabled = false
			integration.Detail = "Managed Jobs MCP config was saved, but MCP reload failed."
			warnings = append(warnings, "Failed to reload MCP servers: "+err.Error())
		}
	}

	return ConfigResult{
		Config:             config,
		RuntimeIntegration: &integration,
		Source:             "workspace_jobs_mcp",
		UpdatedAt:          config.UpdatedAt,
		Warnings:           warnings,
		AvailableTools:     availableToolNames(),
	}, nil
}

func (s *Service) ValidateManagedMCPToken(workspaceID string, token string) bool {
	if s == nil || s.store == nil {
		return false
	}
	config, ok := s.store.GetJobMCPConfig(workspaceID)
	if !ok {
		return false
	}
	expected := strings.TrimSpace(config.ManagedMCPAuthToken)
	return expected != "" && subtle.ConstantTimeCompare([]byte(expected), []byte(strings.TrimSpace(token))) == 1
}

func (s *Service) HandleMCP(ctx context.Context, workspaceID string, payload []byte) ([]byte, bool) {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 {
		return marshalMCPResponse(mcpErrorResponse(nil, -32700, "parse error")), true
	}

	if trimmed[0] == '[' {
		var requests []mcpJSONRPCRequest
		if err := json.Unmarshal(trimmed, &requests); err != nil {
			return marshalMCPResponse(mcpErrorResponse(nil, -32700, "parse error")), true
		}
		if len(requests) == 0 {
			return marshalMCPResponse(mcpErrorResponse(nil, -32600, "invalid request")), true
		}

		responses := make([]mcpJSONRPCResponse, 0, len(requests))
		for _, request := range requests {
			response, ok := s.handleMCPRequest(ctx, workspaceID, request)
			if ok {
				responses = append(responses, response)
			}
		}
		if len(responses) == 0 {
			return nil, false
		}
		return marshalMCPResponse(responses), true
	}

	var request mcpJSONRPCRequest
	if err := json.Unmarshal(trimmed, &request); err != nil {
		return marshalMCPResponse(mcpErrorResponse(nil, -32700, "parse error")), true
	}
	response, ok := s.handleMCPRequest(ctx, workspaceID, request)
	if !ok {
		return nil, false
	}
	return marshalMCPResponse(response), true
}

func (s *Service) handleMCPRequest(ctx context.Context, workspaceID string, request mcpJSONRPCRequest) (mcpJSONRPCResponse, bool) {
	if strings.TrimSpace(request.JSONRPC) != "2.0" || strings.TrimSpace(request.Method) == "" {
		if request.ID == nil {
			return mcpJSONRPCResponse{}, false
		}
		return mcpErrorResponse(request.ID, -32600, "invalid request"), true
	}

	switch request.Method {
	case "initialize":
		return mcpJSONRPCResponse{
			JSONRPC: "2.0",
			ID:      request.ID,
			Result: map[string]any{
				"protocolVersion": mcpProtocolVersion,
				"serverInfo": map[string]any{
					"name":    "codex-server-jobs",
					"version": "1.0.0",
				},
				"capabilities": map[string]any{
					"tools": map[string]any{
						"listChanged": false,
					},
				},
			},
		}, request.ID != nil
	case "notifications/initialized":
		if request.ID == nil {
			return mcpJSONRPCResponse{}, false
		}
		return mcpJSONRPCResponse{JSONRPC: "2.0", ID: request.ID, Result: map[string]any{}}, true
	case "ping":
		if request.ID == nil {
			return mcpJSONRPCResponse{}, false
		}
		return mcpJSONRPCResponse{JSONRPC: "2.0", ID: request.ID, Result: map[string]any{}}, true
	case "tools/list":
		config, _ := s.readStoredConfig(workspaceID)
		if request.ID == nil {
			return mcpJSONRPCResponse{}, false
		}
		return mcpJSONRPCResponse{
			JSONRPC: "2.0",
			ID:      request.ID,
			Result: map[string]any{
				"tools": buildMCPTools(config),
			},
		}, true
	case "tools/call":
		if request.ID == nil {
			return mcpJSONRPCResponse{}, false
		}
		var params mcpToolCallParams
		if len(request.Params) > 0 {
			if err := json.Unmarshal(request.Params, &params); err != nil {
				return mcpErrorResponse(request.ID, -32602, "invalid params"), true
			}
		}
		if strings.TrimSpace(params.Name) == "" {
			return mcpErrorResponse(request.ID, -32602, "tool name is required"), true
		}
		result, err := s.executeToolCall(ctx, workspaceID, params.Name, params.Arguments)
		if err != nil {
			return mcpErrorResponse(request.ID, -32000, err.Error()), true
		}
		return mcpJSONRPCResponse{
			JSONRPC: "2.0",
			ID:      request.ID,
			Result: map[string]any{
				"content": []map[string]any{
					{
						"type": "text",
						"text": marshalMCPText(result),
					},
				},
				"structuredContent": result,
				"isError":           false,
			},
		}, true
	default:
		if request.ID == nil {
			return mcpJSONRPCResponse{}, false
		}
		return mcpErrorResponse(request.ID, -32601, "method not found"), true
	}
}

func (s *Service) executeToolCall(ctx context.Context, workspaceID string, toolName string, arguments map[string]any) (map[string]any, error) {
	if s.jobs == nil {
		return nil, errors.New("jobs service is unavailable")
	}
	switch strings.TrimSpace(toolName) {
	case "jobs_list":
		items := make([]store.BackgroundJob, 0)
		for _, job := range s.jobs.List() {
			if job.WorkspaceID == workspaceID {
				items = append(items, job)
			}
		}
		return map[string]any{"jobs": items}, nil
	case "job_executors_list":
		return map[string]any{"executors": s.jobs.ListExecutors()}, nil
	case "jobs_get":
		jobID := readString(arguments, "jobId")
		job, err := s.jobs.Get(jobID)
		if err != nil {
			return nil, err
		}
		if job.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobNotFound
		}
		return map[string]any{"job": job}, nil
	case "jobs_create":
		job, err := s.jobs.Create(jobs.CreateInput{
			SourceType:   readString(arguments, "sourceType"),
			SourceRefID:  readString(arguments, "sourceRefId"),
			Name:         readString(arguments, "name"),
			Description:  readString(arguments, "description"),
			WorkspaceID:  workspaceID,
			ExecutorKind: readString(arguments, "executorKind"),
			Schedule:     readString(arguments, "schedule"),
			Payload:      readObject(arguments, "payload"),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"job": job}, nil
	case "jobs_update":
		jobID := readString(arguments, "jobId")
		job, err := s.jobs.Get(jobID)
		if err != nil {
			return nil, err
		}
		if job.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobNotFound
		}
		updated, err := s.jobs.Update(jobID, jobs.UpdateInput{
			SourceType:   fallbackString(readString(arguments, "sourceType"), job.SourceType),
			SourceRefID:  fallbackString(readString(arguments, "sourceRefId"), job.SourceRefID),
			Name:         fallbackString(readString(arguments, "name"), job.Name),
			Description:  fallbackString(readString(arguments, "description"), job.Description),
			ExecutorKind: fallbackString(readString(arguments, "executorKind"), job.ExecutorKind),
			Schedule:     fallbackString(readString(arguments, "schedule"), job.Schedule),
			Payload:      fallbackObject(readObject(arguments, "payload"), job.Payload),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"job": updated}, nil
	case "jobs_pause":
		jobID := readString(arguments, "jobId")
		job, err := s.jobs.Pause(jobID)
		if err != nil {
			return nil, err
		}
		if job.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobNotFound
		}
		return map[string]any{"job": job}, nil
	case "jobs_resume":
		jobID := readString(arguments, "jobId")
		job, err := s.jobs.Resume(jobID)
		if err != nil {
			return nil, err
		}
		if job.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobNotFound
		}
		return map[string]any{"job": job}, nil
	case "jobs_run":
		jobID := readString(arguments, "jobId")
		job, err := s.jobs.Get(jobID)
		if err != nil {
			return nil, err
		}
		if job.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobNotFound
		}
		run, err := s.jobs.Trigger(ctx, jobID, fallbackString(readString(arguments, "trigger"), "mcp"))
		if err != nil {
			return nil, err
		}
		return map[string]any{"run": run}, nil
	case "jobs_delete":
		jobID := readString(arguments, "jobId")
		job, err := s.jobs.Get(jobID)
		if err != nil {
			return nil, err
		}
		if job.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobNotFound
		}
		if err := s.jobs.Delete(jobID); err != nil {
			return nil, err
		}
		return map[string]any{"deleted": true, "jobId": jobID}, nil
	case "job_runs_list":
		jobID := readString(arguments, "jobId")
		job, err := s.jobs.Get(jobID)
		if err != nil {
			return nil, err
		}
		if job.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobNotFound
		}
		return map[string]any{"runs": s.jobs.ListRuns(jobID)}, nil
	case "job_run_retry":
		runID := readString(arguments, "runId")
		run, err := s.jobs.GetRun(runID)
		if err != nil {
			return nil, err
		}
		if run.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobRunNotFound
		}
		retried, err := s.jobs.RetryRun(ctx, runID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"run": retried}, nil
	case "job_run_cancel":
		runID := readString(arguments, "runId")
		run, err := s.jobs.GetRun(runID)
		if err != nil {
			return nil, err
		}
		if run.WorkspaceID != workspaceID {
			return nil, store.ErrBackgroundJobRunNotFound
		}
		canceled, err := s.jobs.CancelRun(runID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"run": canceled}, nil
	default:
		return nil, fmt.Errorf("unsupported tool: %s", toolName)
	}
}

func (s *Service) readStoredConfig(workspaceID string) (Config, store.JobMCPConfig) {
	defaults := Config{
		Enabled:       false,
		ServerName:    defaultServerName,
		ToolAllowlist: nil,
	}
	if s == nil || s.store == nil {
		return defaults, store.JobMCPConfig{}
	}
	stored, ok := s.store.GetJobMCPConfig(workspaceID)
	if !ok {
		return defaults, store.JobMCPConfig{}
	}
	config := Config{
		Enabled:       stored.Enabled,
		ServerName:    fallbackString(stored.ServerName, defaultServerName),
		ToolAllowlist: append([]string(nil), stored.ToolAllowlist...),
		UpdatedAt:     stored.UpdatedAt.Format(time.RFC3339),
	}
	return config, stored
}

func normalizeConfigInput(input ConfigInput) ConfigInput {
	serverName := strings.TrimSpace(input.ServerName)
	if serverName == "" {
		serverName = defaultServerName
	}
	return ConfigInput{
		Enabled:       input.Enabled,
		ServerName:    serverName,
		ToolAllowlist: normalizeTools(input.ToolAllowlist),
	}
}

func normalizeTools(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(availableToolNames()))
	for _, name := range availableToolNames() {
		allowed[name] = struct{}{}
	}
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := allowed[value]; !ok {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	sort.Strings(normalized)
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func (s *Service) resolvedManagedMCPEndpointFromToken(workspaceID string, authToken string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(s.runtimeBaseURL), "/")
	authToken = strings.TrimSpace(authToken)
	if baseURL == "" || authToken == "" {
		return ""
	}
	return fmt.Sprintf("%s/api/jobs-mcp/%s?token=%s", baseURL, url.PathEscape(strings.TrimSpace(workspaceID)), url.QueryEscape(authToken))
}

func (s *Service) readWorkspaceConfigFile(workspaceID string) map[string]any {
	configPath, err := s.workspaceConfigPath(workspaceID)
	if err != nil {
		return map[string]any{}
	}
	content, err := os.ReadFile(configPath)
	if err != nil {
		return map[string]any{}
	}
	data := make(map[string]any)
	if err := toml.Unmarshal(content, &data); err != nil {
		return map[string]any{}
	}
	return data
}

func (s *Service) writeWorkspaceManagedMcpServers(workspaceID string, managedServers map[string]any) error {
	configPath, err := s.workspaceConfigPath(workspaceID)
	if err != nil {
		return err
	}
	data := make(map[string]any)
	if content, readErr := os.ReadFile(configPath); readErr == nil {
		if err := toml.Unmarshal(content, &data); err != nil {
			return fmt.Errorf("parse workspace config: %w", err)
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return fmt.Errorf("read workspace config: %w", readErr)
	}
	delete(data, legacyManagedMCPServersKey)
	if len(managedServers) == 0 {
		delete(data, managedMCPServersKey)
	} else {
		data[managedMCPServersKey] = managedServers
	}
	encoded, err := toml.Marshal(data)
	if err != nil {
		return fmt.Errorf("encode workspace config: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return fmt.Errorf("create workspace config directory: %w", err)
	}
	if err := os.WriteFile(configPath, encoded, 0o644); err != nil {
		return fmt.Errorf("write workspace config: %w", err)
	}
	return nil
}

func (s *Service) workspaceConfigPath(workspaceID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return "", fmt.Errorf("%w: workspace id is required", ErrInvalidInput)
	}
	if s.store == nil {
		return "", fmt.Errorf("%w: workspace store is unavailable", ErrInvalidInput)
	}
	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return "", fmt.Errorf("%w: workspace %q was not found", ErrInvalidInput, workspaceID)
	}
	rootPath := strings.TrimSpace(workspace.RootPath)
	if rootPath == "" {
		return "", fmt.Errorf("%w: workspace root path is required", ErrInvalidInput)
	}
	return filepath.Join(rootPath, filepath.FromSlash(workspaceConfigTomlPath)), nil
}

func buildManagedMcpServers(raw map[string]any, config Config) (map[string]any, RuntimeIntegration) {
	servers := cloneObjectMap(runtimeMcpServersValue(raw))
	delete(servers, config.ServerName)
	integration := buildRuntimeIntegration(raw, config)
	if !config.Enabled || strings.TrimSpace(config.MCPEndpoint) == "" {
		return servers, integration
	}
	servers[config.ServerName] = managedMcpServerEntry(config)
	integration.Status = "configured"
	integration.ThreadEnabled = true
	integration.Detail = "Threads use the managed workspace Jobs MCP server " + config.ServerName + "."
	return servers, integration
}

func buildRuntimeIntegration(raw map[string]any, config Config) RuntimeIntegration {
	integration := RuntimeIntegration{
		Status:     "disabled",
		Mode:       "workspace_mcp",
		ServerName: config.ServerName,
		ServerURL:  strings.TrimSpace(config.MCPEndpoint),
		Managed:    true,
	}
	currentServers := runtimeMcpServersValue(raw)
	currentEntry, hasManagedServer := currentServers[config.ServerName]
	if !config.Enabled {
		if hasManagedServer {
			integration.Status = "sync_required"
			integration.Detail = "Jobs MCP is disabled, but the managed MCP server is still present in workspace .codex/config.toml."
			return integration
		}
		integration.Detail = "Jobs MCP is disabled for this workspace."
		return integration
	}
	if strings.TrimSpace(config.MCPEndpoint) == "" {
		integration.Status = "missing_endpoint"
		integration.Detail = "Managed Jobs MCP endpoint is unavailable."
		return integration
	}
	expectedEntry := managedMcpServerEntry(config)
	if !hasManagedServer || !reflect.DeepEqual(currentEntry, expectedEntry) {
		integration.Status = "sync_required"
		integration.Detail = "Save Jobs MCP config to sync workspace .codex/config.toml."
		return integration
	}
	integration.Status = "configured"
	integration.ThreadEnabled = true
	integration.Detail = "Threads use the managed workspace Jobs MCP server " + config.ServerName + "."
	return integration
}

func managedMcpServerEntry(config Config) map[string]any {
	entry := map[string]any{
		"url":     strings.TrimSpace(config.MCPEndpoint),
		"enabled": true,
	}
	enabledTools, disabledTools := managedMcpToolFilters(config)
	entry["enabled_tools"] = enabledTools
	entry["disabled_tools"] = disabledTools
	return entry
}

func managedMcpToolFilters(config Config) ([]string, []string) {
	allTools := availableToolNames()
	if len(config.ToolAllowlist) == 0 {
		return allTools, []string{}
	}
	allowedSet := make(map[string]struct{}, len(config.ToolAllowlist))
	for _, tool := range config.ToolAllowlist {
		allowedSet[strings.TrimSpace(tool)] = struct{}{}
	}
	enabled := make([]string, 0, len(allTools))
	disabled := make([]string, 0, len(allTools))
	for _, tool := range allTools {
		if _, ok := allowedSet[tool]; ok {
			enabled = append(enabled, tool)
		} else {
			disabled = append(disabled, tool)
		}
	}
	return enabled, disabled
}

func runtimeMcpServersValue(raw map[string]any) map[string]any {
	servers := objectMapValue(raw[managedMCPServersKey])
	if len(servers) > 0 {
		return servers
	}
	return objectMapValue(raw[legacyManagedMCPServersKey])
}

func objectMapValue(value any) map[string]any {
	record, ok := value.(map[string]any)
	if !ok || len(record) == 0 {
		return map[string]any{}
	}
	return cloneObjectMap(record)
}

func cloneObjectMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = cloneAny(value)
	}
	return cloned
}

func cloneAny(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneObjectMap(typed)
	case []any:
		next := make([]any, len(typed))
		for index := range typed {
			next[index] = cloneAny(typed[index])
		}
		return next
	default:
		return typed
	}
}

func availableToolNames() []string {
	return []string{
		"job_executors_list",
		"job_run_cancel",
		"job_run_retry",
		"job_runs_list",
		"jobs_create",
		"jobs_delete",
		"jobs_get",
		"jobs_list",
		"jobs_pause",
		"jobs_resume",
		"jobs_run",
		"jobs_update",
	}
}

func buildMCPTools(config Config) []map[string]any {
	enabledTools, _ := managedMcpToolFilters(config)
	enabledSet := make(map[string]struct{}, len(enabledTools))
	for _, name := range enabledTools {
		enabledSet[name] = struct{}{}
	}
	all := []map[string]any{
		toolDef("jobs_list", "List background jobs in the current workspace.", emptyObjectSchema()),
		toolDef("jobs_get", "Get one background job by id.", requiredObjectSchema(map[string]any{"jobId": stringSchema("Background job identifier.")}, "jobId")),
		toolDef("jobs_create", "Create a background job in the current workspace.", requiredObjectSchema(map[string]any{
			"name":         stringSchema("Job name."),
			"description":  stringSchema("Optional description."),
			"executorKind": stringSchema("Executor kind."),
			"schedule":     stringSchema("Schedule expression."),
			"sourceType":   stringSchema("Optional source type."),
			"sourceRefId":  stringSchema("Optional source reference id."),
			"payload":      map[string]any{"type": "object"},
		}, "name", "executorKind")),
		toolDef("jobs_update", "Update a background job.", requiredObjectSchema(map[string]any{
			"jobId":        stringSchema("Background job identifier."),
			"name":         stringSchema("Job name."),
			"description":  stringSchema("Optional description."),
			"executorKind": stringSchema("Executor kind."),
			"schedule":     stringSchema("Schedule expression."),
			"sourceType":   stringSchema("Optional source type."),
			"sourceRefId":  stringSchema("Optional source reference id."),
			"payload":      map[string]any{"type": "object"},
		}, "jobId")),
		toolDef("jobs_pause", "Pause a background job.", requiredObjectSchema(map[string]any{"jobId": stringSchema("Background job identifier.")}, "jobId")),
		toolDef("jobs_resume", "Resume a background job.", requiredObjectSchema(map[string]any{"jobId": stringSchema("Background job identifier.")}, "jobId")),
		toolDef("jobs_run", "Run a background job now.", requiredObjectSchema(map[string]any{
			"jobId":   stringSchema("Background job identifier."),
			"trigger": stringSchema("Optional trigger label."),
		}, "jobId")),
		toolDef("jobs_delete", "Delete a background job.", requiredObjectSchema(map[string]any{"jobId": stringSchema("Background job identifier.")}, "jobId")),
		toolDef("job_runs_list", "List runs for a background job.", requiredObjectSchema(map[string]any{"jobId": stringSchema("Background job identifier.")}, "jobId")),
		toolDef("job_run_retry", "Retry a job run.", requiredObjectSchema(map[string]any{"runId": stringSchema("Background job run identifier.")}, "runId")),
		toolDef("job_run_cancel", "Cancel a queued or running job run.", requiredObjectSchema(map[string]any{"runId": stringSchema("Background job run identifier.")}, "runId")),
		toolDef("job_executors_list", "List available job executors.", emptyObjectSchema()),
	}
	filtered := make([]map[string]any, 0, len(all))
	for _, tool := range all {
		if _, ok := enabledSet[tool["name"].(string)]; ok {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

func toolDef(name string, description string, inputSchema map[string]any) map[string]any {
	tool := map[string]any{
		"name":        name,
		"description": description,
		"inputSchema": inputSchema,
	}
	return tool
}

func stringSchema(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}

func emptyObjectSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"properties":           map[string]any{},
		"additionalProperties": false,
	}
}

func requiredObjectSchema(properties map[string]any, required ...string) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func readString(values map[string]any, key string) string {
	if len(values) == 0 {
		return ""
	}
	value, ok := values[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func readObject(values map[string]any, key string) map[string]any {
	if len(values) == 0 {
		return nil
	}
	value, ok := values[key]
	if !ok {
		return nil
	}
	record, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return cloneObjectMap(record)
}

func fallbackString(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(fallback)
}

func fallbackObject(value map[string]any, fallback map[string]any) map[string]any {
	if len(value) > 0 {
		return value
	}
	return cloneObjectMap(fallback)
}

func mcpErrorResponse(id any, code int, message string) mcpJSONRPCResponse {
	return mcpJSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &mcpJSONRPCError{Code: code, Message: message},
	}
}

func marshalMCPResponse(value any) []byte {
	payload, err := json.Marshal(value)
	if err != nil {
		fallback, _ := json.Marshal(mcpErrorResponse(nil, -32603, "internal error"))
		return fallback
	}
	return payload
}

func marshalMCPText(value any) string {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func generateAuthToken() (string, error) {
	buffer := make([]byte, 24)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}
