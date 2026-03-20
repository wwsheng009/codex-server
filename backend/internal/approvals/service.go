package approvals

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	runtimes *runtime.Manager
}

type ResponseInput struct {
	Action  string              `json:"action"`
	Answers map[string][]string `json:"answers"`
	Content any                 `json:"content"`
}

func NewService(runtimeManager *runtime.Manager) *Service {
	return &Service{
		runtimes: runtimeManager,
	}
}

func (s *Service) List(workspaceID string) []store.PendingApproval {
	requests := s.runtimes.ListPendingRequests(workspaceID)
	items := make([]store.PendingApproval, 0, len(requests))

	for _, request := range requests {
		items = append(items, store.PendingApproval{
			ID:          request.RequestID,
			WorkspaceID: request.WorkspaceID,
			ThreadID:    request.ThreadID,
			Kind:        request.Method,
			Summary:     summarizeRequest(request.Method, request.Params),
			Status:      "pending",
			Actions:     approvalActions(request.Method),
			Details:     request.Params,
			RequestedAt: request.RequestedAt,
		})
	}

	return items
}

func (s *Service) Respond(ctx context.Context, requestID string, input ResponseInput) (store.PendingApproval, error) {
	if strings.TrimSpace(input.Action) == "" {
		return store.PendingApproval{}, errors.New("approval action is required")
	}

	request, ok := s.runtimes.GetPendingRequest(requestID)
	if !ok {
		return store.PendingApproval{}, runtime.ErrServerRequestNotFound
	}

	responsePayload, err := approvalResponse(request.Method, input, request.Params)
	if err != nil {
		return store.PendingApproval{}, err
	}

	resolved, err := s.runtimes.Respond(ctx, requestID, responsePayload)
	if err != nil {
		return store.PendingApproval{}, err
	}

	return store.PendingApproval{
		ID:          resolved.RequestID,
		WorkspaceID: resolved.WorkspaceID,
		ThreadID:    resolved.ThreadID,
		Kind:        resolved.Method,
		Summary:     summarizeRequest(resolved.Method, resolved.Params),
		Status:      input.Action,
		Actions:     approvalActions(resolved.Method),
		Details:     resolved.Params,
		RequestedAt: resolved.RequestedAt,
	}, nil
}

func summarizeRequest(method string, params any) string {
	object, ok := params.(map[string]any)
	if !ok {
		return method
	}

	switch method {
	case "item/commandExecution/requestApproval", "execCommandApproval":
		if command := stringValue(object["command"]); command != "" {
			return command
		}
	case "item/fileChange/requestApproval", "applyPatchApproval":
		if path := stringValue(object["path"]); path != "" {
			return path
		}
		if changes, ok := object["changes"].([]any); ok {
			return fmt.Sprintf("%d file change(s)", len(changes))
		}
	case "item/tool/requestUserInput":
		if questions, ok := object["questions"].([]any); ok {
			return fmt.Sprintf("%d question(s) awaiting user input", len(questions))
		}
	case "item/permissions/requestApproval":
		return "Additional permissions requested"
	case "mcpServer/elicitation/request":
		if message := stringValue(object["message"]); message != "" {
			return message
		}
		if serverName := stringValue(object["serverName"]); serverName != "" {
			return "MCP input requested by " + serverName
		}
	case "item/tool/call":
		if tool := stringValue(object["tool"]); tool != "" {
			return "Dynamic tool call: " + tool
		}
	case "account/chatgptAuthTokens/refresh":
		if reason := stringValue(object["reason"]); reason != "" {
			return "Refresh ChatGPT auth tokens: " + reason
		}
		return "Refresh ChatGPT auth tokens"
	}

	if reason := stringValue(object["reason"]); reason != "" {
		return reason
	}

	return method
}

func approvalResponse(method string, input ResponseInput, params any) (any, error) {
	switch method {
	case "item/commandExecution/requestApproval":
		return map[string]any{"decision": approvalDecision(input.Action, "accept", "acceptForSession", "decline", "cancel")}, nil
	case "item/fileChange/requestApproval":
		return map[string]any{"decision": approvalDecision(input.Action, "accept", "acceptForSession", "decline", "cancel")}, nil
	case "applyPatchApproval", "execCommandApproval":
		return map[string]any{"decision": approvalDecision(input.Action, "approved", "approved_for_session", "denied", "abort")}, nil
	case "item/permissions/requestApproval":
		if input.Action == "accept" {
			object, _ := params.(map[string]any)
			return map[string]any{
				"permissions": object["permissions"],
				"scope":       "turn",
			}, nil
		}

		return map[string]any{
			"permissions": map[string]any{},
			"scope":       "turn",
		}, nil
	case "item/tool/requestUserInput":
		if input.Action != "accept" {
			return map[string]any{
				"answers": map[string]any{},
			}, nil
		}

		return map[string]any{
			"answers": questionAnswers(input.Answers),
		}, nil
	case "mcpServer/elicitation/request":
		return map[string]any{
			"action":  input.Action,
			"content": input.Content,
		}, nil
	case "item/tool/call":
		return map[string]any{
			"contentItems": dynamicToolContentItems(input.Action, input.Content),
			"success":      input.Action == "accept",
		}, nil
	case "account/chatgptAuthTokens/refresh":
		if input.Action != "accept" {
			return nil, errors.New("chatgpt auth token refresh requires accept")
		}

		content, ok := input.Content.(map[string]any)
		if !ok {
			return nil, errors.New("token refresh content is required")
		}

		accessToken := stringValue(content["accessToken"])
		accountID := stringValue(content["chatgptAccountId"])
		if accessToken == "" || accountID == "" {
			return nil, errors.New("accessToken and chatgptAccountId are required")
		}

		response := map[string]any{
			"accessToken":      accessToken,
			"chatgptAccountId": accountID,
		}
		if planType := stringValue(content["chatgptPlanType"]); planType != "" {
			response["chatgptPlanType"] = planType
		}

		return response, nil
	default:
		return nil, fmt.Errorf("unsupported approval method: %s", method)
	}
}

func approvalActions(method string) []string {
	switch method {
	case "account/chatgptAuthTokens/refresh":
		return []string{"accept"}
	case "item/tool/requestUserInput", "mcpServer/elicitation/request":
		return []string{"accept", "decline", "cancel"}
	case "item/permissions/requestApproval":
		return []string{"accept", "decline"}
	default:
		return []string{"accept", "decline", "cancel"}
	}
}

func questionAnswers(input map[string][]string) map[string]any {
	answers := make(map[string]any, len(input))
	for key, values := range input {
		answers[key] = map[string]any{
			"answers": values,
		}
	}

	return answers
}

func dynamicToolContentItems(action string, content any) []map[string]any {
	if action != "accept" {
		return []map[string]any{}
	}

	switch typed := content.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return []map[string]any{}
		}
		return []map[string]any{{
			"type": "inputText",
			"text": typed,
		}}
	case map[string]any:
		items := make([]map[string]any, 0, 2)
		if text := stringValue(typed["text"]); text != "" {
			items = append(items, map[string]any{
				"type": "inputText",
				"text": text,
			})
		}
		if imageURL := stringValue(typed["imageUrl"]); imageURL != "" {
			items = append(items, map[string]any{
				"type":     "inputImage",
				"imageUrl": imageURL,
			})
		}
		if len(items) > 0 {
			return items
		}
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, entry := range typed {
			switch item := entry.(type) {
			case string:
				if strings.TrimSpace(item) == "" {
					continue
				}
				items = append(items, map[string]any{
					"type": "inputText",
					"text": item,
				})
			case map[string]any:
				items = append(items, dynamicToolContentItems("accept", item)...)
			}
		}
		if len(items) > 0 {
			return items
		}
	}

	if content == nil {
		return []map[string]any{}
	}

	data, err := json.Marshal(content)
	if err != nil {
		return []map[string]any{}
	}

	return []map[string]any{{
		"type": "inputText",
		"text": string(data),
	}}
}

func approvalDecision(action string, accept string, acceptForSession string, decline string, cancel string) string {
	switch action {
	case "accept":
		return accept
	case "accept_for_session":
		return acceptForSession
	case "cancel":
		return cancel
	default:
		return decline
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}
