package notificationcenter

import (
	"context"
	"fmt"
	"strings"
	"time"

	"codex-server/backend/internal/bots"
	"codex-server/backend/internal/store"
)

func (s *Service) deliverInApp(_ context.Context, plan dispatchPlan) (store.NotificationDispatch, error) {
	workspace, ok := s.store.GetWorkspace(plan.Event.WorkspaceID)
	if !ok {
		return store.NotificationDispatch{}, store.ErrWorkspaceNotFound
	}

	notification, err := s.notifications.Create(store.Notification{
		WorkspaceID:   workspace.ID,
		WorkspaceName: workspace.Name,
		Kind:          notificationKindFromTopic(plan.Event.Topic),
		Title:         strings.TrimSpace(plan.Title),
		Message:       strings.TrimSpace(plan.Message),
		Level:         strings.TrimSpace(plan.Event.Level),
	})
	if err != nil {
		return store.NotificationDispatch{}, err
	}

	return store.NotificationDispatch{NotificationID: notification.ID}, nil
}

func (s *Service) deliverBot(ctx context.Context, plan dispatchPlan) (store.NotificationDispatch, error) {
	targetID := strings.TrimSpace(plan.Binding.TargetRefID)
	target, ok := s.store.GetBotDeliveryTargetByID(targetID)
	if !ok {
		return store.NotificationDispatch{}, store.ErrBotDeliveryTargetNotFound
	}

	messageText := composeBotMessage(plan.Title, plan.Message)
	if messageText == "" {
		return store.NotificationDispatch{}, fmt.Errorf("%w: empty bot message", ErrInvalidInput)
	}

	delivery, err := s.bots.SendDeliveryTargetOutboundMessages(ctx, target.WorkspaceID, target.BotID, target.ID, bots.SendOutboundMessagesInput{
		TriggerID:         strings.TrimSpace(plan.LegacyTriggerID),
		SourceType:        "notification_center",
		SourceRefType:     strings.TrimSpace(plan.Event.SourceRefType),
		SourceRefID:       strings.TrimSpace(plan.Event.SourceRefID),
		OriginWorkspaceID: strings.TrimSpace(plan.Event.WorkspaceID),
		OriginThreadID:    strings.TrimSpace(plan.Event.ThreadID),
		OriginTurnID:      strings.TrimSpace(plan.Event.TurnID),
		IdempotencyKey:    dispatchDedupKey(plan),
		Messages:          []store.BotReplyMessage{{Text: messageText}},
	})
	if err != nil {
		return store.NotificationDispatch{}, err
	}

	return store.NotificationDispatch{BotOutboundDeliveryID: delivery.ID}, nil
}

func (s *Service) deliverEmail(ctx context.Context, plan dispatchPlan) (store.NotificationDispatch, error) {
	if s.emailSender == nil {
		return store.NotificationDispatch{}, ErrEmailDeliveryUnavailable
	}

	targetID := strings.TrimSpace(plan.Binding.TargetRefID)
	target, ok := s.store.GetNotificationEmailTarget(plan.Event.WorkspaceID, targetID)
	if !ok {
		return store.NotificationDispatch{}, store.ErrNotificationEmailTargetNotFound
	}
	if !target.Enabled || len(target.Emails) == 0 {
		return store.NotificationDispatch{}, fmt.Errorf("%w: email target is disabled or empty", ErrInvalidInput)
	}

	subject := renderTemplate(plan.Binding.TitleTemplate, plan.Event, target.SubjectTemplate)
	if subject == "" {
		subject = strings.TrimSpace(plan.Title)
	}
	body := renderTemplate(plan.Binding.BodyTemplate, plan.Event, target.BodyTemplate)
	if body == "" {
		body = composeBotMessage(plan.Title, plan.Message)
	}
	if strings.TrimSpace(body) == "" {
		return store.NotificationDispatch{}, fmt.Errorf("%w: empty email body", ErrInvalidInput)
	}

	message := EmailMessage{
		WorkspaceID: plan.Event.WorkspaceID,
		TargetID:    target.ID,
		Name:        target.Name,
		To:          append([]string(nil), target.Emails...),
		Subject:     subject,
		Body:        body,
	}
	if err := s.emailSender.Send(ctx, message); err != nil {
		return store.NotificationDispatch{}, err
	}

	return store.NotificationDispatch{}, nil
}

func (s *Service) markDispatchDelivered(workspaceID string, dispatchID string, outcome store.NotificationDispatch) (store.NotificationDispatch, error) {
	now := s.now()
	return s.store.UpdateNotificationDispatch(workspaceID, dispatchID, func(current store.NotificationDispatch) store.NotificationDispatch {
		current.Status = DispatchStatusDelivered
		current.Error = ""
		current.DeliveredAt = timePointer(now)
		if strings.TrimSpace(outcome.NotificationID) != "" {
			current.NotificationID = strings.TrimSpace(outcome.NotificationID)
		}
		if strings.TrimSpace(outcome.BotOutboundDeliveryID) != "" {
			current.BotOutboundDeliveryID = strings.TrimSpace(outcome.BotOutboundDeliveryID)
		}
		return current
	})
}

func (s *Service) markDispatchFailed(workspaceID string, dispatchID string, dispatchErr error) (store.NotificationDispatch, error) {
	return s.store.UpdateNotificationDispatch(workspaceID, dispatchID, func(current store.NotificationDispatch) store.NotificationDispatch {
		current.Status = DispatchStatusFailed
		current.Error = strings.TrimSpace(errorText(dispatchErr))
		return current
	})
}

func notificationKindFromTopic(topic string) string {
	trimmed := strings.TrimSpace(topic)
	if trimmed == "" {
		return "notification_center"
	}
	replacer := strings.NewReplacer(".", "_", "/", "_")
	return "notification_center_" + replacer.Replace(trimmed)
}

func timePointer(value time.Time) *time.Time {
	next := value.UTC()
	return &next
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
