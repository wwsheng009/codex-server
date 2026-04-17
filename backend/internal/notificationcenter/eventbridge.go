package notificationcenter

import (
	"fmt"
	"strings"

	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turncapture"
)

func normalizeEvent(event store.EventEnvelope, dataStore *store.MemoryStore) (normalizedEvent, bool) {
	workspaceID := strings.TrimSpace(event.WorkspaceID)
	if workspaceID == "" {
		return normalizedEvent{}, false
	}

	switch strings.TrimSpace(event.Method) {
	case "hook/completed":
		return normalizeHookCompletedEvent(event)
	case "turn/started", "turn/completed", "turn/failed", "turn/interrupted", "turn/canceled", "turn/cancelled":
		return normalizeTurnLifecycleEvent(event, dataStore)
	case "automation/run/completed":
		return normalizeAutomationCompletedEvent(event)
	case "automation/run/skipped":
		return normalizeAutomationSkippedEvent(event)
	case "automation/run/schedule_failed":
		return normalizeAutomationScheduleFailedEvent(event)
	case "notification/created":
		return normalizeNotificationCreatedEvent(event)
	case "bot/message/delivery_failed":
		return normalizeBotDeliveryFailedEvent(event)
	case "turn-policy/decision_recorded":
		return normalizeTurnPolicyDecisionEvent(event)
	default:
		return normalizedEvent{}, false
	}
}

func normalizeHookCompletedEvent(event store.EventEnvelope) (normalizedEvent, bool) {
	payload := asObject(event.Payload)
	run := asObject(payload["run"])
	runID := strings.TrimSpace(stringValue(run["id"]))
	if runID == "" {
		return normalizedEvent{}, false
	}
	decision := strings.TrimSpace(stringValue(run["decision"]))
	status := strings.TrimSpace(stringValue(run["status"]))
	reason := strings.TrimSpace(stringValue(run["reason"]))
	errorText := strings.TrimSpace(stringValue(run["error"]))
	toolName := strings.TrimSpace(stringValue(run["toolName"]))
	triggerMethod := strings.TrimSpace(stringValue(run["triggerMethod"]))

	topic := ""
	level := "info"
	title := ""
	message := ""
	switch {
	case strings.EqualFold(status, "failed"):
		topic = "hook.failed"
		level = "error"
		title = "Hook execution failed"
		message = firstNonEmpty(errorText, reason, "Hook execution failed")
	case strings.EqualFold(decision, "block"):
		topic = "hook.blocked"
		level = "warning"
		title = "Hook blocked a turn"
		message = firstNonEmpty(reason, "A hook blocked the current turn.")
	case strings.EqualFold(decision, "continueturn"):
		topic = "hook.continue_turn"
		level = "info"
		title = "Hook continued the turn"
		message = firstNonEmpty(reason, "A hook requested an additional turn.")
	default:
		return normalizedEvent{}, false
	}
	if toolName != "" && !strings.Contains(message, toolName) {
		message = strings.TrimSpace(toolName + ": " + message)
	}
	if triggerMethod != "" && !strings.Contains(message, triggerMethod) {
		message = strings.TrimSpace(message + " (" + triggerMethod + ")")
	}

	attributes := map[string]string{
		"workspaceId":   strings.TrimSpace(event.WorkspaceID),
		"threadId":      strings.TrimSpace(firstNonEmpty(stringValue(run["threadId"]), event.ThreadID)),
		"turnId":        strings.TrimSpace(firstNonEmpty(stringValue(run["turnId"]), event.TurnID)),
		"topic":         topic,
		"method":        strings.TrimSpace(event.Method),
		"sourceType":    "hook_run",
		"sourceRefType": "hook_run",
		"sourceRefId":   runID,
		"level":         level,
		"runId":         runID,
		"decision":      decision,
		"status":        status,
		"reason":        reason,
		"error":         errorText,
		"toolName":      toolName,
		"triggerMethod": triggerMethod,
	}
	return normalizedEvent{
		WorkspaceID:   strings.TrimSpace(event.WorkspaceID),
		ThreadID:      attributes["threadId"],
		TurnID:        attributes["turnId"],
		Method:        strings.TrimSpace(event.Method),
		Topic:         topic,
		SourceType:    "hook_run",
		SourceRefType: "hook_run",
		SourceRefID:   runID,
		EventKey:      eventKey(strings.TrimSpace(event.WorkspaceID), topic, "hook_run", runID),
		Level:         level,
		Title:         title,
		Message:       strings.TrimSpace(message),
		Attributes:    attributes,
	}, true
}

func normalizeAutomationCompletedEvent(event store.EventEnvelope) (normalizedEvent, bool) {
	payload := asObject(event.Payload)
	runID := strings.TrimSpace(stringValue(payload["runId"]))
	if runID == "" {
		return normalizedEvent{}, false
	}
	status := strings.TrimSpace(stringValue(payload["status"]))
	automationTitle := strings.TrimSpace(stringValue(payload["automationTitle"]))
	summary := strings.TrimSpace(stringValue(payload["summary"]))
	errorText := strings.TrimSpace(stringValue(payload["error"]))
	topic := "automation.completed"
	level := "success"
	title := "Automation completed"
	message := firstNonEmpty(summary, fmt.Sprintf("%s completed successfully.", firstNonEmpty(automationTitle, "Automation")))
	if !strings.EqualFold(status, "completed") {
		topic = "automation.failed"
		level = "error"
		title = "Automation failed"
		message = firstNonEmpty(errorText, fmt.Sprintf("%s failed.", firstNonEmpty(automationTitle, "Automation")))
	}
	attributes := map[string]string{
		"workspaceId":     strings.TrimSpace(event.WorkspaceID),
		"threadId":        strings.TrimSpace(firstNonEmpty(stringValue(payload["threadId"]), event.ThreadID)),
		"turnId":          strings.TrimSpace(firstNonEmpty(stringValue(payload["turnId"]), event.TurnID)),
		"topic":           topic,
		"method":          strings.TrimSpace(event.Method),
		"sourceType":      "automation_run",
		"sourceRefType":   "automation_run",
		"sourceRefId":     runID,
		"level":           level,
		"automationId":    strings.TrimSpace(stringValue(payload["automationId"])),
		"automationTitle": automationTitle,
		"runId":           runID,
		"status":          status,
		"summary":         summary,
		"error":           errorText,
	}
	return normalizedEvent{
		WorkspaceID:   strings.TrimSpace(event.WorkspaceID),
		ThreadID:      attributes["threadId"],
		TurnID:        attributes["turnId"],
		Method:        strings.TrimSpace(event.Method),
		Topic:         topic,
		SourceType:    "automation_run",
		SourceRefType: "automation_run",
		SourceRefID:   runID,
		EventKey:      eventKey(strings.TrimSpace(event.WorkspaceID), topic, "automation_run", runID),
		Level:         level,
		Title:         title,
		Message:       strings.TrimSpace(message),
		Attributes:    attributes,
	}, true
}

func normalizeTurnLifecycleEvent(event store.EventEnvelope, dataStore *store.MemoryStore) (normalizedEvent, bool) {
	payload := asObject(event.Payload)
	turn := asObject(payload["turn"])
	turnID := strings.TrimSpace(firstNonEmpty(stringValue(turn["id"]), event.TurnID))
	if turnID == "" {
		return normalizedEvent{}, false
	}

	threadID := strings.TrimSpace(firstNonEmpty(stringValue(payload["threadId"]), event.ThreadID))
	status := strings.TrimSpace(
		firstNonEmpty(
			stringValue(turn["status"]),
			turnLifecycleStatusForMethod(strings.TrimSpace(event.Method)),
		),
	)
	summary := strings.TrimSpace(firstNonEmpty(stringValue(payload["summary"]), stringValue(turn["summary"])))
	reason := strings.TrimSpace(firstNonEmpty(stringValue(payload["reason"]), stringValue(turn["reason"])))
	errorText := strings.TrimSpace(firstNonEmpty(stringValue(payload["error"]), stringValue(turn["error"])))
	topic := turnLifecycleTopicForStatus(status)
	level, title, fallbackMessage := turnLifecyclePresentation(status, turnID)
	lastAgentMessage, lastTurnText := extractTurnLifecycleContent(event, threadID, turnID, summary)
	if (lastAgentMessage == "" || lastTurnText == "") && dataStore != nil {
		projectedAgentMessage, projectedTurnText := extractProjectedTurnLifecycleContent(
			dataStore,
			strings.TrimSpace(event.WorkspaceID),
			threadID,
			turnID,
			summary,
		)
		lastAgentMessage = firstNonEmpty(lastAgentMessage, projectedAgentMessage)
		lastTurnText = firstNonEmpty(lastTurnText, projectedTurnText)
	}
	lastAgentMessagePreview := previewTurnLifecycleText(lastAgentMessage)
	lastTurnTextPreview := previewTurnLifecycleText(lastTurnText)

	message := firstNonEmpty(errorText, summary, lastTurnTextPreview, reason, fallbackMessage)
	if threadID != "" && !strings.Contains(message, threadID) {
		message = fmt.Sprintf("Thread %s · %s", threadID, message)
	}

	attributes := map[string]string{
		"workspaceId":             strings.TrimSpace(event.WorkspaceID),
		"threadId":                threadID,
		"turnId":                  turnID,
		"topic":                   topic,
		"method":                  strings.TrimSpace(event.Method),
		"sourceType":              "turn",
		"sourceRefType":           "turn",
		"sourceRefId":             turnID,
		"level":                   level,
		"status":                  status,
		"summary":                 summary,
		"reason":                  reason,
		"error":                   errorText,
		"lastAgentMessage":        lastAgentMessage,
		"lastAgentMessagePreview": lastAgentMessagePreview,
		"lastTurnText":            lastTurnText,
		"lastTurnTextPreview":     lastTurnTextPreview,
	}
	return normalizedEvent{
		WorkspaceID:   strings.TrimSpace(event.WorkspaceID),
		ThreadID:      threadID,
		TurnID:        turnID,
		Method:        strings.TrimSpace(event.Method),
		Topic:         topic,
		SourceType:    "turn",
		SourceRefType: "turn",
		SourceRefID:   turnID,
		EventKey:      eventKey(strings.TrimSpace(event.WorkspaceID), topic, "turn", turnID),
		Level:         level,
		Title:         title,
		Message:       strings.TrimSpace(message),
		Attributes:    attributes,
	}, true
}

func turnLifecycleStatusForMethod(method string) string {
	switch strings.TrimSpace(method) {
	case "turn/started":
		return "started"
	case "turn/completed":
		return "completed"
	case "turn/failed":
		return "failed"
	case "turn/interrupted":
		return "interrupted"
	case "turn/canceled", "turn/cancelled":
		return "cancelled"
	default:
		return ""
	}
}

func turnLifecycleTopicForStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "started", "inprogress":
		return "turn.started"
	case "completed":
		return "turn.completed"
	case "failed":
		return "turn.failed"
	case "interrupted":
		return "turn.interrupted"
	case "canceled", "cancelled":
		return "turn.cancelled"
	default:
		return "turn.completed"
	}
}

func turnLifecyclePresentation(status string, turnID string) (string, string, string) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "started", "inprogress":
		return "info", "Turn started", fmt.Sprintf("Turn %s started.", turnID)
	case "failed":
		return "error", "Turn failed", fmt.Sprintf("Turn %s failed.", turnID)
	case "interrupted":
		return "warning", "Turn interrupted", fmt.Sprintf("Turn %s was interrupted.", turnID)
	case "canceled", "cancelled":
		return "warning", "Turn cancelled", fmt.Sprintf("Turn %s was cancelled.", turnID)
	default:
		return "info", "Turn completed", fmt.Sprintf("Turn %s completed.", turnID)
	}
}

func extractTurnLifecycleContent(event store.EventEnvelope, threadID string, turnID string, summary string) (string, string) {
	capture := turncapture.New(threadID, turnID)
	capture.ApplyEvent(event)
	result := capture.Result()
	lastAgentMessage := strings.TrimSpace(result.AssistantText)
	lastTurnText := strings.TrimSpace(firstNonEmpty(result.Summary, lastAgentMessage, summary))
	return lastAgentMessage, lastTurnText
}

func extractProjectedTurnLifecycleContent(
	dataStore *store.MemoryStore,
	workspaceID string,
	threadID string,
	turnID string,
	summary string,
) (string, string) {
	workspaceID = strings.TrimSpace(workspaceID)
	threadID = strings.TrimSpace(threadID)
	turnID = strings.TrimSpace(turnID)
	if workspaceID == "" || threadID == "" || turnID == "" {
		return "", ""
	}

	projection, ok := dataStore.GetThreadProjection(workspaceID, threadID)
	if !ok {
		return "", ""
	}

	for _, turn := range projection.Turns {
		if !strings.EqualFold(strings.TrimSpace(turn.ID), turnID) {
			continue
		}
		result := turncapture.FromTurn(threadID, turnID, turn)
		lastAgentMessage := strings.TrimSpace(result.AssistantText)
		lastTurnText := strings.TrimSpace(firstNonEmpty(result.Summary, lastAgentMessage, summary))
		return lastAgentMessage, lastTurnText
	}

	return "", ""
}

func previewTurnLifecycleText(value string) string {
	text := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if text == "" {
		return ""
	}
	text = strings.Join(strings.Fields(text), " ")

	runes := []rune(text)
	if len(runes) <= 180 {
		return text
	}

	return strings.TrimSpace(string(runes[:180])) + "..."
}

func normalizeAutomationSkippedEvent(event store.EventEnvelope) (normalizedEvent, bool) {
	payload := asObject(event.Payload)
	automationID := strings.TrimSpace(stringValue(payload["automationId"]))
	if automationID == "" {
		return normalizedEvent{}, false
	}
	automationTitle := strings.TrimSpace(stringValue(payload["automationTitle"]))
	message := strings.TrimSpace(stringValue(payload["message"]))
	attributes := map[string]string{
		"workspaceId":     strings.TrimSpace(event.WorkspaceID),
		"threadId":        strings.TrimSpace(firstNonEmpty(stringValue(payload["threadId"]), event.ThreadID)),
		"turnId":          strings.TrimSpace(firstNonEmpty(stringValue(payload["turnId"]), event.TurnID)),
		"topic":           "automation.skipped",
		"method":          strings.TrimSpace(event.Method),
		"sourceType":      "automation",
		"sourceRefType":   "automation",
		"sourceRefId":     automationID,
		"level":           "warning",
		"automationId":    automationID,
		"automationTitle": automationTitle,
		"message":         message,
	}
	return normalizedEvent{
		WorkspaceID:   strings.TrimSpace(event.WorkspaceID),
		ThreadID:      attributes["threadId"],
		TurnID:        attributes["turnId"],
		Method:        strings.TrimSpace(event.Method),
		Topic:         "automation.skipped",
		SourceType:    "automation",
		SourceRefType: "automation",
		SourceRefID:   automationID,
		EventKey:      eventKey(strings.TrimSpace(event.WorkspaceID), "automation.skipped", "automation", automationID),
		Level:         "warning",
		Title:         "Automation skipped",
		Message:       firstNonEmpty(message, fmt.Sprintf("%s was skipped.", firstNonEmpty(automationTitle, "Automation"))),
		Attributes:    attributes,
	}, true
}

func normalizeAutomationScheduleFailedEvent(event store.EventEnvelope) (normalizedEvent, bool) {
	payload := asObject(event.Payload)
	automationID := strings.TrimSpace(stringValue(payload["automationId"]))
	if automationID == "" {
		return normalizedEvent{}, false
	}
	automationTitle := strings.TrimSpace(stringValue(payload["automationTitle"]))
	errorText := strings.TrimSpace(stringValue(payload["error"]))
	attributes := map[string]string{
		"workspaceId":     strings.TrimSpace(event.WorkspaceID),
		"threadId":        strings.TrimSpace(firstNonEmpty(stringValue(payload["threadId"]), event.ThreadID)),
		"turnId":          strings.TrimSpace(firstNonEmpty(stringValue(payload["turnId"]), event.TurnID)),
		"topic":           "automation.failed",
		"method":          strings.TrimSpace(event.Method),
		"sourceType":      "automation",
		"sourceRefType":   "automation",
		"sourceRefId":     automationID,
		"level":           "error",
		"automationId":    automationID,
		"automationTitle": automationTitle,
		"error":           errorText,
	}
	return normalizedEvent{
		WorkspaceID:   strings.TrimSpace(event.WorkspaceID),
		ThreadID:      attributes["threadId"],
		TurnID:        attributes["turnId"],
		Method:        strings.TrimSpace(event.Method),
		Topic:         "automation.failed",
		SourceType:    "automation",
		SourceRefType: "automation",
		SourceRefID:   automationID,
		EventKey:      eventKey(strings.TrimSpace(event.WorkspaceID), "automation.failed", "automation", automationID+":schedule_failed"),
		Level:         "error",
		Title:         "Automation scheduling failed",
		Message:       firstNonEmpty(errorText, fmt.Sprintf("%s scheduling failed.", firstNonEmpty(automationTitle, "Automation"))),
		Attributes:    attributes,
	}, true
}

func normalizeNotificationCreatedEvent(event store.EventEnvelope) (normalizedEvent, bool) {
	payload := asObject(event.Payload)
	notificationID := strings.TrimSpace(stringValue(payload["notificationId"]))
	if notificationID == "" {
		return normalizedEvent{}, false
	}
	title := strings.TrimSpace(stringValue(payload["title"]))
	message := strings.TrimSpace(stringValue(payload["message"]))
	level := firstNonEmpty(strings.TrimSpace(stringValue(payload["level"])), "info")
	attributes := map[string]string{
		"workspaceId":       strings.TrimSpace(event.WorkspaceID),
		"threadId":          strings.TrimSpace(event.ThreadID),
		"turnId":            strings.TrimSpace(event.TurnID),
		"topic":             "system.notification.created",
		"method":            strings.TrimSpace(event.Method),
		"sourceType":        "notification",
		"sourceRefType":     "notification",
		"sourceRefId":       notificationID,
		"level":             level,
		"notificationId":    notificationID,
		"kind":              strings.TrimSpace(stringValue(payload["kind"])),
		"title":             title,
		"message":           message,
		"botConnectionId":   strings.TrimSpace(stringValue(payload["botConnectionId"])),
		"botConnectionName": strings.TrimSpace(stringValue(payload["botConnectionName"])),
		"automationId":      strings.TrimSpace(stringValue(payload["automationId"])),
		"runId":             strings.TrimSpace(stringValue(payload["runId"])),
		"read":              strings.TrimSpace(stringValue(payload["read"])),
	}
	return normalizedEvent{
		WorkspaceID:   strings.TrimSpace(event.WorkspaceID),
		ThreadID:      strings.TrimSpace(event.ThreadID),
		TurnID:        strings.TrimSpace(event.TurnID),
		Method:        strings.TrimSpace(event.Method),
		Topic:         "system.notification.created",
		SourceType:    "notification",
		SourceRefType: "notification",
		SourceRefID:   notificationID,
		EventKey:      eventKey(strings.TrimSpace(event.WorkspaceID), "system.notification.created", "notification", notificationID),
		Level:         level,
		Title:         title,
		Message:       message,
		Attributes:    attributes,
	}, true
}

func normalizeBotDeliveryFailedEvent(event store.EventEnvelope) (normalizedEvent, bool) {
	payload := asObject(event.Payload)
	sourceID := firstNonEmpty(
		strings.TrimSpace(stringValue(payload["deliveryId"])),
		strings.TrimSpace(stringValue(payload["messageId"])),
		strings.TrimSpace(stringValue(payload["conversationId"])),
		strings.TrimSpace(stringValue(payload["connectionId"])),
	)
	if sourceID == "" {
		return normalizedEvent{}, false
	}
	errorText := strings.TrimSpace(stringValue(payload["error"]))
	attributes := map[string]string{
		"workspaceId":    strings.TrimSpace(event.WorkspaceID),
		"threadId":       strings.TrimSpace(firstNonEmpty(stringValue(payload["threadId"]), event.ThreadID)),
		"turnId":         strings.TrimSpace(firstNonEmpty(stringValue(payload["turnId"]), event.TurnID)),
		"topic":          "bot.delivery.failed",
		"method":         strings.TrimSpace(event.Method),
		"sourceType":     "bot_delivery",
		"sourceRefType":  "bot_delivery",
		"sourceRefId":    sourceID,
		"level":          "error",
		"connectionId":   strings.TrimSpace(stringValue(payload["connectionId"])),
		"conversationId": strings.TrimSpace(stringValue(payload["conversationId"])),
		"deliveryId":     strings.TrimSpace(stringValue(payload["deliveryId"])),
		"messageId":      strings.TrimSpace(stringValue(payload["messageId"])),
		"attemptCount":   strings.TrimSpace(stringValue(payload["attemptCount"])),
		"error":          errorText,
	}
	return normalizedEvent{
		WorkspaceID:   strings.TrimSpace(event.WorkspaceID),
		ThreadID:      attributes["threadId"],
		TurnID:        attributes["turnId"],
		Method:        strings.TrimSpace(event.Method),
		Topic:         "bot.delivery.failed",
		SourceType:    "bot_delivery",
		SourceRefType: "bot_delivery",
		SourceRefID:   sourceID,
		EventKey:      eventKey(strings.TrimSpace(event.WorkspaceID), "bot.delivery.failed", "bot_delivery", sourceID),
		Level:         "error",
		Title:         "Bot delivery failed",
		Message:       firstNonEmpty(errorText, "A bot delivery failed."),
		Attributes:    attributes,
	}, true
}

func normalizeTurnPolicyDecisionEvent(event store.EventEnvelope) (normalizedEvent, bool) {
	payload := asObject(event.Payload)
	decisionID := strings.TrimSpace(stringValue(payload["decisionId"]))
	if decisionID == "" {
		return normalizedEvent{}, false
	}
	actionStatus := strings.TrimSpace(stringValue(payload["actionStatus"]))
	if !strings.EqualFold(actionStatus, "failed") {
		return normalizedEvent{}, false
	}
	policyName := strings.TrimSpace(stringValue(payload["policyName"]))
	reason := strings.TrimSpace(stringValue(payload["reason"]))
	attributes := map[string]string{
		"workspaceId":   strings.TrimSpace(event.WorkspaceID),
		"threadId":      strings.TrimSpace(firstNonEmpty(stringValue(payload["threadId"]), event.ThreadID)),
		"turnId":        strings.TrimSpace(firstNonEmpty(stringValue(payload["turnId"]), event.TurnID)),
		"topic":         "turn_policy.failed_action",
		"method":        strings.TrimSpace(event.Method),
		"sourceType":    "turn_policy_decision",
		"sourceRefType": "turn_policy_decision",
		"sourceRefId":   decisionID,
		"level":         "error",
		"decisionId":    decisionID,
		"policyName":    policyName,
		"action":        strings.TrimSpace(stringValue(payload["action"])),
		"actionStatus":  actionStatus,
		"reason":        reason,
	}
	return normalizedEvent{
		WorkspaceID:   strings.TrimSpace(event.WorkspaceID),
		ThreadID:      attributes["threadId"],
		TurnID:        attributes["turnId"],
		Method:        strings.TrimSpace(event.Method),
		Topic:         "turn_policy.failed_action",
		SourceType:    "turn_policy_decision",
		SourceRefType: "turn_policy_decision",
		SourceRefID:   decisionID,
		EventKey:      eventKey(strings.TrimSpace(event.WorkspaceID), "turn_policy.failed_action", "turn_policy_decision", decisionID),
		Level:         "error",
		Title:         "Turn policy action failed",
		Message:       firstNonEmpty(reason, policyName),
		Attributes:    attributes,
	}, true
}

func eventKey(workspaceID string, topic string, sourceType string, sourceRefID string) string {
	return strings.TrimSpace(workspaceID) + "|" + strings.TrimSpace(topic) + "|" + strings.TrimSpace(sourceType) + "|" + strings.TrimSpace(sourceRefID)
}

func asObject(value any) map[string]any {
	object, _ := value.(map[string]any)
	if len(object) == 0 {
		return nil
	}
	return object
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
