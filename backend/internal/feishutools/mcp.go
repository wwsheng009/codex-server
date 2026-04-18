package feishutools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const mcpProtocolVersion = "2025-03-26"

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
	Arguments map[string]any `json:"arguments"`
}

// HandleMCP implements a minimal streamable-HTTP MCP server over JSON-RPC.
// It is intentionally stateless: requests are served via POST and responses
// are returned as application/json without opening an SSE stream.
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
				"capabilities": map[string]any{
					"tools": map[string]any{
						"listChanged": false,
					},
				},
				"serverInfo": map[string]any{
					"name":    "codex-server-feishu-tools",
					"version": "1.0.0",
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
		config, err := s.readConfig(ctx, workspaceID)
		if err != nil {
			if request.ID == nil {
				return mcpJSONRPCResponse{}, false
			}
			return mcpErrorResponse(request.ID, -32000, err.Error()), true
		}
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
		name := strings.TrimSpace(params.Name)
		if name == "" {
			return mcpErrorResponse(request.ID, -32602, "tool name is required"), true
		}
		args := cloneMCPArguments(params.Arguments)
		action, _ := args["action"].(string)
		delete(args, "action")
		threadID, _ := args["_threadId"].(string)
		turnID, _ := args["_turnId"].(string)
		delete(args, "_threadId")
		delete(args, "_turnId")

		invokeCtx := ctx
		scope := invokeEventScopeFromContext(invokeCtx)
		if scope.ThreadID == "" && strings.TrimSpace(threadID) != "" {
			scope.ThreadID = strings.TrimSpace(threadID)
		}
		if scope.TurnID == "" && strings.TrimSpace(turnID) != "" {
			scope.TurnID = strings.TrimSpace(turnID)
		}
		invokeCtx = ContextWithInvokeEventScope(invokeCtx, scope.ThreadID, scope.TurnID)

		result, err := s.Invoke(invokeCtx, workspaceID, InvokeInput{
			ToolName: name,
			Action:   action,
			Params:   args,
		})
		if err != nil {
			return mcpErrorResponse(request.ID, -32602, err.Error()), true
		}

		structured := map[string]any{
			"toolName":    result.ToolName,
			"action":      result.Action,
			"status":      result.Status,
			"principal":   result.Principal,
			"startedAt":   result.StartedAt,
			"completedAt": result.CompletedAt,
			"durationMs":  result.DurationMs,
		}
		if result.Result != nil {
			structured["result"] = result.Result
		}
		if result.Error != nil {
			structured["error"] = result.Error
		}

		return mcpJSONRPCResponse{
			JSONRPC: "2.0",
			ID:      request.ID,
			Result: map[string]any{
				"content": []map[string]any{
					{
						"type": "text",
						"text": marshalMCPText(structured),
					},
				},
				"structuredContent": structured,
				"isError":           result.Status != "ok",
			},
		}, true
	default:
		if request.ID == nil {
			return mcpJSONRPCResponse{}, false
		}
		return mcpErrorResponse(request.ID, -32601, "method not found"), true
	}
}

func buildMCPTools(config Config) []map[string]any {
	names := make([]string, 0, len(toolDefinitions))
	for name := range toolDefinitions {
		if config.Enabled && toolEnabled(config, name) {
			names = append(names, name)
		}
	}
	sort.Strings(names)

	tools := make([]map[string]any, 0, len(names))
	for _, name := range names {
		definition := toolDefinitions[name]
		actions := mcpActionNames(definition.ActionKeys)
		description := strings.TrimSpace(definition.Description)
		if len(actions) > 1 {
			description = fmt.Sprintf("%s Supported actions: %s.", description, strings.Join(actions, ", "))
		}

		inputSchema := map[string]any{
			"type":                 "object",
			"additionalProperties": true,
		}
		if len(actions) > 0 {
			inputSchema["properties"] = map[string]any{
				"action": map[string]any{
					"type":        "string",
					"description": "Optional Feishu action selector when the tool exposes more than one action.",
				},
			}
		}

		tools = append(tools, map[string]any{
			"name":        definition.ToolName,
			"title":       definition.Title,
			"description": description,
			"inputSchema": inputSchema,
		})
	}

	return tools
}

func mcpActionNames(actionKeys []string) []string {
	set := make(map[string]struct{}, len(actionKeys))
	for _, actionKey := range actionKeys {
		parts := strings.Split(strings.TrimSpace(actionKey), ".")
		if len(parts) < 2 {
			continue
		}
		action := strings.TrimSpace(parts[len(parts)-1])
		if action == "" || action == "default" {
			continue
		}
		set[action] = struct{}{}
	}
	if len(set) == 0 {
		return nil
	}
	actions := make([]string, 0, len(set))
	for action := range set {
		actions = append(actions, action)
	}
	sort.Strings(actions)
	return actions
}

func cloneMCPArguments(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func mcpErrorResponse(id any, code int, message string) mcpJSONRPCResponse {
	return mcpJSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &mcpJSONRPCError{
			Code:    code,
			Message: strings.TrimSpace(message),
		},
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
		return fmt.Sprintf("%v", value)
	}
	return string(payload)
}
