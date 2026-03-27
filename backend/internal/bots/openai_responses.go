package bots

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

const openAIResponsesBackendName = "openai_responses"

type openAIResponsesBackend struct {
	clients httpClientSource
}

type openAIResponsesRequest struct {
	Model              string         `json:"model"`
	Input              string         `json:"input"`
	Instructions       string         `json:"instructions,omitempty"`
	PreviousResponseID string         `json:"previous_response_id,omitempty"`
	Store              *bool          `json:"store,omitempty"`
	Reasoning          map[string]any `json:"reasoning,omitempty"`
}

type openAIResponsesResponse struct {
	ID     string                      `json:"id"`
	Output []openAIResponsesOutputItem `json:"output"`
}

type openAIResponsesOutputItem struct {
	Type    string                       `json:"type"`
	Role    string                       `json:"role"`
	Content []openAIResponsesContentItem `json:"content"`
}

type openAIResponsesContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type openAIErrorResponse struct {
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error"`
}

func newOpenAIResponsesBackend(client *http.Client) AIBackend {
	return newOpenAIResponsesBackendWithClientSource(staticHTTPClientSource{client: client})
}

func newOpenAIResponsesBackendWithClientSource(clients httpClientSource) AIBackend {
	if clients == nil {
		clients = staticHTTPClientSource{}
	}

	return &openAIResponsesBackend{clients: clients}
}

func (b *openAIResponsesBackend) Name() string {
	return openAIResponsesBackendName
}

func (b *openAIResponsesBackend) ProcessMessage(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (AIResult, error) {
	apiKey := strings.TrimSpace(connection.Secrets["openai_api_key"])
	if apiKey == "" {
		return AIResult{}, fmt.Errorf("%w: openai_api_key is required", ErrInvalidInput)
	}

	model := strings.TrimSpace(connection.AIConfig["model"])
	if model == "" {
		return AIResult{}, fmt.Errorf("%w: openai_responses model is required", ErrInvalidInput)
	}

	requestPayload := openAIResponsesRequest{
		Model:        model,
		Input:        inbound.Text,
		Instructions: strings.TrimSpace(connection.AIConfig["instructions"]),
	}

	if previousResponseID := strings.TrimSpace(conversation.BackendState["previous_response_id"]); previousResponseID != "" {
		requestPayload.PreviousResponseID = previousResponseID
	}

	if effort := strings.TrimSpace(connection.AIConfig["reasoning_effort"]); effort != "" {
		requestPayload.Reasoning = map[string]any{
			"effort": effort,
		}
	}

	storeValue := true
	if rawStore := strings.TrimSpace(connection.AIConfig["store"]); rawStore != "" {
		parsed, err := strconv.ParseBool(rawStore)
		if err != nil {
			return AIResult{}, fmt.Errorf("%w: invalid openai_responses store value %q", ErrInvalidInput, rawStore)
		}
		storeValue = parsed
	}
	requestPayload.Store = &storeValue

	response, err := b.createResponse(ctx, connection, apiKey, requestPayload)
	if err != nil {
		return AIResult{}, err
	}

	text := strings.TrimSpace(extractOpenAIResponseText(response))
	if text == "" {
		return AIResult{}, fmt.Errorf("openai responses returned no assistant text")
	}

	result := AIResult{
		Messages: []OutboundMessage{
			{Text: text},
		},
	}
	if strings.TrimSpace(response.ID) != "" {
		result.BackendState = map[string]string{
			"previous_response_id": strings.TrimSpace(response.ID),
		}
	}

	return result, nil
}

func (b *openAIResponsesBackend) createResponse(
	ctx context.Context,
	connection store.BotConnection,
	apiKey string,
	payload openAIResponsesRequest,
) (openAIResponsesResponse, error) {
	endpoint := strings.TrimSpace(connection.Settings["openai_base_url"])
	if endpoint == "" {
		endpoint = strings.TrimSpace(connection.Secrets["openai_base_url"])
	}
	if endpoint == "" {
		endpoint = "https://api.openai.com/v1/responses"
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return openAIResponsesResponse{}, fmt.Errorf("encode openai responses payload: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return openAIResponsesResponse{}, fmt.Errorf("build openai responses request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	if organization := strings.TrimSpace(connection.Secrets["openai_organization"]); organization != "" {
		request.Header.Set("OpenAI-Organization", organization)
	}
	if project := strings.TrimSpace(connection.Secrets["openai_project"]); project != "" {
		request.Header.Set("OpenAI-Project", project)
	}

	httpResponse, err := b.client(30 * time.Second).Do(request)
	if err != nil {
		return openAIResponsesResponse{}, fmt.Errorf("openai responses request failed: %w", err)
	}
	defer httpResponse.Body.Close()

	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		var apiError openAIErrorResponse
		if err := json.Unmarshal(body, &apiError); err == nil && apiError.Error != nil {
			return openAIResponsesResponse{}, fmt.Errorf(
				"openai responses returned %s: %s",
				httpResponse.Status,
				firstNonEmpty(apiError.Error.Message, apiError.Error.Code, apiError.Error.Type),
			)
		}
		return openAIResponsesResponse{}, fmt.Errorf(
			"openai responses returned %s: %s",
			httpResponse.Status,
			strings.TrimSpace(string(body)),
		)
	}

	var response openAIResponsesResponse
	if err := json.NewDecoder(httpResponse.Body).Decode(&response); err != nil {
		return openAIResponsesResponse{}, fmt.Errorf("decode openai responses response: %w", err)
	}

	return response, nil
}

func extractOpenAIResponseText(response openAIResponsesResponse) string {
	parts := make([]string, 0)
	for _, item := range response.Output {
		for _, content := range item.Content {
			text := strings.TrimSpace(content.Text)
			if text == "" {
				continue
			}
			parts = append(parts, text)
		}
	}

	return strings.Join(parts, "\n\n")
}

func (b *openAIResponsesBackend) client(timeout time.Duration) *http.Client {
	if b.clients == nil {
		return staticHTTPClientSource{}.Client(timeout)
	}

	return b.clients.Client(timeout)
}
