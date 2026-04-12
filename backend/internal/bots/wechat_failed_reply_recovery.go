package bots

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

func (s *Service) handleWeChatFailedReplyReplayIntent(
	ctx context.Context,
	provider Provider,
	connection store.BotConnection,
	conversation store.BotConversation,
	currentDelivery store.BotInboundDelivery,
	inbound InboundMessage,
) (bool, error) {
	if !shouldReplayFailedWeChatReply(connection, conversation, inbound) {
		return false, nil
	}

	failedDelivery, ok := s.store.FindLatestFailedBotInboundDeliveryWithSavedReply(
		connection.WorkspaceID,
		connection.ID,
		firstNonEmpty(strings.TrimSpace(inbound.ConversationID), strings.TrimSpace(inbound.ExternalChatID)),
		currentDelivery.ID,
	)
	if !ok {
		return false, nil
	}

	reply, ok := aiResultFromDelivery(failedDelivery)
	if !ok {
		return false, nil
	}
	reply = normalizeProviderAIResult(connection, reply)

	logBotDebug(ctx, connection, "replaying failed wechat reply after user retry intent",
		slog.String("conversationStoreId", conversation.ID),
		slog.String("failedDeliveryId", failedDelivery.ID),
		slog.String("failedMessageId", strings.TrimSpace(failedDelivery.MessageID)),
		slog.String("retryMessageId", strings.TrimSpace(inbound.MessageID)),
		slog.String("replyThreadId", strings.TrimSpace(reply.ThreadID)),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
	)

	attemptCount, err := s.sendReplyWithOutboundDelivery(
		ctx,
		provider,
		connection,
		conversation,
		&currentDelivery,
		&failedDelivery,
		&inbound,
		reply,
		"failed reply replay",
	)
	if err != nil {
		return true, s.finalizeWeChatFailedReplyReplayFailure(
			ctx,
			connection,
			conversation,
			currentDelivery,
			inbound,
			failedDelivery,
			reply,
			err,
		)
	}

	if err := s.completeInboundDeliveryWithReply(ctx, connection, conversation, currentDelivery, inbound, reply, attemptCount); err != nil {
		return true, err
	}

	if err := s.markReplayedFailedDeliveryRecovered(connection, failedDelivery, attemptCount); err != nil {
		s.appendConnectionLog(
			connection.WorkspaceID,
			connection.ID,
			"warning",
			"reply_delivery_replay_reconcile_failed",
			fmt.Sprintf(
				"Failed to reconcile recovered delivery %s after retry request %s: %s",
				failedDelivery.ID,
				firstNonEmpty(strings.TrimSpace(inbound.MessageID), "unknown"),
				failureReplyDetail(err),
			),
		)
	}

	s.appendConnectionLog(
		connection.WorkspaceID,
		connection.ID,
		"success",
		"reply_delivery_replayed",
		fmt.Sprintf(
			"Replayed failed delivery %s for original message %s after retry request %s.",
			failedDelivery.ID,
			firstNonEmpty(strings.TrimSpace(failedDelivery.MessageID), "unknown"),
			firstNonEmpty(strings.TrimSpace(inbound.MessageID), "unknown"),
		),
	)
	s.setConnectionLastError(connection.WorkspaceID, connection.ID, "")

	return true, nil
}

func shouldReplayFailedWeChatReply(
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
) bool {
	if normalizeProviderName(connection.Provider) != wechatProviderName {
		return false
	}
	if len(inbound.Media) > 0 {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(conversation.LastOutboundDeliveryStatus), botReplyDeliveryStatusFailed) {
		return false
	}
	if strings.TrimSpace(inbound.ProviderData[wechatContextTokenKey]) == "" {
		return false
	}
	return isWeChatFailedReplyReplayIntent(normalizeInboundCommandText(connection, inbound.Text))
}

func isWeChatFailedReplyReplayIntent(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n")))
	if normalized == "" {
		return false
	}
	if len([]rune(normalized)) > 24 {
		return false
	}

	normalized = strings.Trim(normalized, " \t\n\r。.!！？?，,、；;：:")
	collapsed := strings.Join(strings.Fields(normalized), "")
	switch collapsed {
	case "继续", "继续发", "继续发送", "重发", "重新发", "重新发送", "再发一次", "再发一遍", "再试一次", "retry", "resend":
		return true
	}

	for _, prefix := range []string{"再发一次", "再发一遍", "重发", "重新发", "重新发送"} {
		if strings.HasPrefix(collapsed, prefix) {
			return true
		}
	}
	return false
}

func (s *Service) finalizeWeChatFailedReplyReplayFailure(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	currentDelivery store.BotInboundDelivery,
	inbound InboundMessage,
	failedDelivery store.BotInboundDelivery,
	reply AIResult,
	deliveryErr error,
) error {
	attemptCount := replyDeliveryAttemptCount(deliveryErr)
	if attemptCount <= 0 {
		attemptCount = 1
	}
	deliveryMessage := strings.TrimSpace(deliveryErr.Error())
	updatedConversation := s.recordConversationReplyOutcome(
		connection,
		conversation,
		reply,
		inbound,
		"",
		conversationReplyDeliveryState{
			status:       botReplyDeliveryStatusFailed,
			attemptCount: attemptCount,
			lastError:    deliveryMessage,
		},
	)

	recordErr := error(nil)
	if _, err := s.store.RecordBotInboundDeliveryReplyDelivery(
		connection.WorkspaceID,
		currentDelivery.ID,
		botReplyDeliveryStatusFailed,
		attemptCount,
		deliveryMessage,
		nil,
	); err != nil {
		recordErr = err
	}
	completeErr := error(nil)
	if _, err := s.store.CompleteBotInboundDelivery(connection.WorkspaceID, currentDelivery.ID); err != nil {
		completeErr = err
	}
	candidateErr := s.markReplayedFailedDeliveryFailed(connection, failedDelivery, attemptCount, deliveryMessage)

	s.appendConnectionLog(
		connection.WorkspaceID,
		connection.ID,
		"error",
		"reply_delivery_replay_failed",
		fmt.Sprintf(
			"Retry request %s could not replay failed delivery %s for original message %s: %s",
			firstNonEmpty(strings.TrimSpace(inbound.MessageID), "unknown"),
			failedDelivery.ID,
			firstNonEmpty(strings.TrimSpace(failedDelivery.MessageID), "unknown"),
			failureReplyDetail(deliveryErr),
		),
	)
	s.publish(connection.WorkspaceID, updatedConversation.ThreadID, "bot/message/delivery_failed", map[string]any{
		"connectionId":         connection.ID,
		"conversationId":       updatedConversation.ID,
		"threadId":             updatedConversation.ThreadID,
		"messageCount":         len(reply.Messages),
		"deliveryStatus":       botReplyDeliveryStatusFailed,
		"attemptCount":         attemptCount,
		"error":                deliveryMessage,
		"replayedDeliveryId":   failedDelivery.ID,
		"replayTriggerMessage": firstNonEmpty(strings.TrimSpace(inbound.MessageID), "unknown"),
	})
	s.setConnectionLastError(connection.WorkspaceID, connection.ID, deliveryMessage)
	logBotDebug(ctx, connection, "failed wechat reply replay after user retry intent",
		slog.String("conversationStoreId", updatedConversation.ID),
		slog.String("failedDeliveryId", failedDelivery.ID),
		slog.String("retryMessageId", strings.TrimSpace(inbound.MessageID)),
		slog.Int("messageCount", len(reply.Messages)),
		slog.Int("attemptCount", attemptCount),
		slog.Any("messages", debugOutboundMessages(reply.Messages)),
		slog.String("error", deliveryMessage),
	)

	return errors.Join(recordErr, completeErr, candidateErr)
}

func (s *Service) markReplayedFailedDeliveryRecovered(
	connection store.BotConnection,
	failedDelivery store.BotInboundDelivery,
	attemptCount int,
) error {
	deliveredAt := time.Now().UTC()
	totalAttempts := failedDelivery.ReplyDeliveryAttemptCount
	if totalAttempts < 0 {
		totalAttempts = 0
	}
	totalAttempts += maxInt(attemptCount, 1)

	recorded, err := s.store.RecordBotInboundDeliveryReplyDelivery(
		connection.WorkspaceID,
		failedDelivery.ID,
		botReplyDeliveryStatusDelivered,
		totalAttempts,
		"",
		&deliveredAt,
	)
	if err != nil {
		return err
	}
	if strings.TrimSpace(recorded.Status) == "completed" {
		return nil
	}
	_, err = s.store.CompleteBotInboundDelivery(connection.WorkspaceID, failedDelivery.ID)
	return err
}

func (s *Service) markReplayedFailedDeliveryFailed(
	connection store.BotConnection,
	failedDelivery store.BotInboundDelivery,
	attemptCount int,
	lastError string,
) error {
	totalAttempts := failedDelivery.ReplyDeliveryAttemptCount
	if totalAttempts < 0 {
		totalAttempts = 0
	}
	totalAttempts += maxInt(attemptCount, 1)

	recordErr := error(nil)
	if _, err := s.store.RecordBotInboundDeliveryReplyDelivery(
		connection.WorkspaceID,
		failedDelivery.ID,
		botReplyDeliveryStatusFailed,
		totalAttempts,
		lastError,
		nil,
	); err != nil {
		recordErr = err
	}
	_, failErr := s.store.FailBotInboundDelivery(connection.WorkspaceID, failedDelivery.ID, lastError)
	return errors.Join(recordErr, failErr)
}
