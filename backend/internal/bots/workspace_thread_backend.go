package bots

import (
	"context"
	"fmt"
	"strings"
	"time"

	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
)

const (
	defaultThreadPollInterval = 1500 * time.Millisecond
	defaultThreadTurnTimeout  = 2 * time.Minute
)

type workspaceThreadAIBackend struct {
	threads      threadExecutor
	turns        turnExecutor
	pollInterval time.Duration
	turnTimeout  time.Duration
}

func newWorkspaceThreadAIBackend(
	threadService threadExecutor,
	turnService turnExecutor,
	pollInterval time.Duration,
	turnTimeout time.Duration,
) AIBackend {
	if pollInterval <= 0 {
		pollInterval = defaultThreadPollInterval
	}
	if turnTimeout <= 0 {
		turnTimeout = defaultThreadTurnTimeout
	}

	return &workspaceThreadAIBackend{
		threads:      threadService,
		turns:        turnService,
		pollInterval: pollInterval,
		turnTimeout:  turnTimeout,
	}
}

func (b *workspaceThreadAIBackend) Name() string {
	return defaultAIBackend
}

func (b *workspaceThreadAIBackend) ProcessMessage(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (AIResult, error) {
	threadID, err := b.ensureThread(ctx, connection, conversation, inbound)
	if err != nil {
		return AIResult{}, err
	}

	result, err := b.turns.Start(ctx, connection.WorkspaceID, threadID, inbound.Text, turns.StartOptions{
		Model:             strings.TrimSpace(connection.AIConfig["model"]),
		ReasoningEffort:   strings.TrimSpace(connection.AIConfig["reasoning_effort"]),
		PermissionPreset:  strings.TrimSpace(connection.AIConfig["permission_preset"]),
		CollaborationMode: strings.TrimSpace(connection.AIConfig["collaboration_mode"]),
	})
	if err != nil {
		return AIResult{}, err
	}

	turnCtx, cancel := context.WithTimeout(ctx, b.turnTimeout)
	defer cancel()

	turn, err := b.waitForTurn(turnCtx, connection.WorkspaceID, threadID, result.TurnID)
	if err != nil {
		return AIResult{}, err
	}

	if errMessage := formatTurnError(turn.Error); errMessage != "" {
		return AIResult{}, fmt.Errorf("ai turn failed: %s", errMessage)
	}

	messages := collectAgentMessages(turn)
	if len(messages) == 0 {
		return AIResult{}, fmt.Errorf("ai backend %s returned no reply", b.Name())
	}

	return AIResult{
		ThreadID: threadID,
		Messages: messages,
	}, nil
}

func (b *workspaceThreadAIBackend) ensureThread(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) (string, error) {
	if strings.TrimSpace(conversation.ThreadID) != "" {
		if _, err := b.threads.GetDetail(ctx, connection.WorkspaceID, conversation.ThreadID); err == nil {
			return conversation.ThreadID, nil
		}
	}

	thread, err := b.threads.Create(ctx, connection.WorkspaceID, threads.CreateInput{
		Name:  buildThreadName(connection, inbound),
		Model: strings.TrimSpace(connection.AIConfig["model"]),
	})
	if err != nil {
		return "", err
	}

	return thread.ID, nil
}

func (b *workspaceThreadAIBackend) waitForTurn(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnID string,
) (store.ThreadTurn, error) {
	ticker := time.NewTicker(b.pollInterval)
	defer ticker.Stop()

	for {
		detail, err := b.threads.GetDetail(ctx, workspaceID, threadID)
		if err == nil {
			if turn, ok := findThreadTurn(detail, turnID); ok {
				if strings.EqualFold(strings.TrimSpace(turn.Status), "completed") {
					return turn, nil
				}
			}
		}

		select {
		case <-ctx.Done():
			return store.ThreadTurn{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func buildThreadName(connection store.BotConnection, inbound InboundMessage) string {
	base := strings.TrimSpace(connection.Name)
	if base == "" {
		base = strings.Title(strings.TrimSpace(connection.Provider)) + " Bot"
	}

	target := firstNonEmpty(strings.TrimSpace(inbound.Title), strings.TrimSpace(inbound.Username), strings.TrimSpace(inbound.ConversationID))
	if target == "" {
		return base
	}

	name := base + " · " + target
	runes := []rune(name)
	if len(runes) > 96 {
		return strings.TrimSpace(string(runes[:96])) + "..."
	}
	return name
}

func findThreadTurn(detail store.ThreadDetail, turnID string) (store.ThreadTurn, bool) {
	for _, turn := range detail.Turns {
		if turn.ID == turnID {
			return turn, true
		}
	}

	return store.ThreadTurn{}, false
}

func collectAgentMessages(turn store.ThreadTurn) []OutboundMessage {
	items := make([]OutboundMessage, 0)
	for _, item := range turn.Items {
		if stringValue(item["type"]) != "agentMessage" {
			continue
		}
		text := strings.TrimSpace(stringValue(item["text"]))
		if text == "" {
			continue
		}
		items = append(items, OutboundMessage{Text: text})
	}
	return items
}

func formatTurnError(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case map[string]any:
		if message := strings.TrimSpace(stringValue(typed["message"])); message != "" {
			return message
		}
		if code := strings.TrimSpace(stringValue(typed["code"])); code != "" {
			return code
		}
	}

	return strings.TrimSpace(fmt.Sprintf("%v", value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}
