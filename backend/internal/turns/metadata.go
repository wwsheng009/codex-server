package turns

import "strings"

const (
	responsesAPIClientMetadataOrigin = "codex-server-web"

	responsesAPIClientMetadataKeySource            = "source"
	responsesAPIClientMetadataKeyOrigin            = "origin"
	responsesAPIClientMetadataKeyWorkspaceID       = "workspaceId"
	responsesAPIClientMetadataKeyThreadID          = "threadId"
	responsesAPIClientMetadataKeyBotConnectionID   = "botConnectionId"
	responsesAPIClientMetadataKeyBotDeliveryID     = "botDeliveryId"
	responsesAPIClientMetadataKeyBotSourceType     = "botSourceType"
	responsesAPIClientMetadataKeyAutomationID      = "automationId"
	responsesAPIClientMetadataKeyAutomationRunID   = "automationRunId"
	responsesAPIClientMetadataKeyAutomationTrigger = "automationTrigger"
	responsesAPIClientMetadataKeyServerTraceID     = "serverTraceId"
	responsesAPIClientMetadataKeyHookTriggerMethod = "hookTriggerMethod"
	responsesAPIClientMetadataKeyHookPolicyName    = "hookPolicyName"
	responsesAPIClientMetadataKeyHookRunID         = "hookRunId"
	responsesAPIClientMetadataKeyTurnPolicyTrigger = "turnPolicyTriggerMethod"
	responsesAPIClientMetadataKeyTurnPolicyName    = "turnPolicyName"
)

type StartMetadata struct {
	Source            string
	Origin            string
	WorkspaceID       string
	ThreadID          string
	BotConnectionID   string
	BotDeliveryID     string
	BotSourceType     string
	AutomationID      string
	AutomationRunID   string
	AutomationTrigger string
	ServerTraceID     string
	HookTriggerMethod string
	HookPolicyName    string
	HookRunID         string
	TurnPolicyTrigger string
	TurnPolicyName    string
}

func InteractiveStartMetadata(workspaceID string, threadID string) StartMetadata {
	return StartMetadata{
		Source:      "interactive",
		Origin:      responsesAPIClientMetadataOrigin,
		WorkspaceID: workspaceID,
		ThreadID:    threadID,
	}
}

func BotStartMetadata(
	workspaceID string,
	threadID string,
	connectionID string,
	deliveryID string,
	sourceType string,
	serverTraceID string,
) StartMetadata {
	return StartMetadata{
		Source:          "bot",
		Origin:          responsesAPIClientMetadataOrigin,
		WorkspaceID:     workspaceID,
		ThreadID:        threadID,
		BotConnectionID: connectionID,
		BotDeliveryID:   deliveryID,
		BotSourceType:   sourceType,
		ServerTraceID:   serverTraceID,
	}
}

func AutomationStartMetadata(
	workspaceID string,
	threadID string,
	automationID string,
	runID string,
	trigger string,
) StartMetadata {
	return StartMetadata{
		Source:            "automation",
		Origin:            responsesAPIClientMetadataOrigin,
		WorkspaceID:       workspaceID,
		ThreadID:          threadID,
		AutomationID:      automationID,
		AutomationRunID:   runID,
		AutomationTrigger: trigger,
	}
}

func HookFollowUpStartMetadata(
	workspaceID string,
	threadID string,
	triggerMethod string,
	policyName string,
	hookRunID string,
) StartMetadata {
	return StartMetadata{
		Source:            "hook",
		Origin:            responsesAPIClientMetadataOrigin,
		WorkspaceID:       workspaceID,
		ThreadID:          threadID,
		HookTriggerMethod: triggerMethod,
		HookPolicyName:    policyName,
		HookRunID:         hookRunID,
	}
}

func TurnPolicyFollowUpStartMetadata(
	workspaceID string,
	threadID string,
	triggerMethod string,
	policyName string,
) StartMetadata {
	return StartMetadata{
		Source:            "turn-policy",
		Origin:            responsesAPIClientMetadataOrigin,
		WorkspaceID:       workspaceID,
		ThreadID:          threadID,
		TurnPolicyTrigger: triggerMethod,
		TurnPolicyName:    policyName,
	}
}

func buildResponsesAPIClientMetadata(metadata StartMetadata) map[string]any {
	payload := map[string]any{}

	putStringMetadata(payload, responsesAPIClientMetadataKeySource, metadata.Source)
	putStringMetadata(payload, responsesAPIClientMetadataKeyOrigin, metadata.Origin)
	putStringMetadata(payload, responsesAPIClientMetadataKeyWorkspaceID, metadata.WorkspaceID)
	putStringMetadata(payload, responsesAPIClientMetadataKeyThreadID, metadata.ThreadID)
	putStringMetadata(payload, responsesAPIClientMetadataKeyBotConnectionID, metadata.BotConnectionID)
	putStringMetadata(payload, responsesAPIClientMetadataKeyBotDeliveryID, metadata.BotDeliveryID)
	putStringMetadata(payload, responsesAPIClientMetadataKeyBotSourceType, metadata.BotSourceType)
	putStringMetadata(payload, responsesAPIClientMetadataKeyAutomationID, metadata.AutomationID)
	putStringMetadata(payload, responsesAPIClientMetadataKeyAutomationRunID, metadata.AutomationRunID)
	putStringMetadata(payload, responsesAPIClientMetadataKeyAutomationTrigger, metadata.AutomationTrigger)
	putStringMetadata(payload, responsesAPIClientMetadataKeyServerTraceID, metadata.ServerTraceID)
	putStringMetadata(payload, responsesAPIClientMetadataKeyHookTriggerMethod, metadata.HookTriggerMethod)
	putStringMetadata(payload, responsesAPIClientMetadataKeyHookPolicyName, metadata.HookPolicyName)
	putStringMetadata(payload, responsesAPIClientMetadataKeyHookRunID, metadata.HookRunID)
	putStringMetadata(payload, responsesAPIClientMetadataKeyTurnPolicyTrigger, metadata.TurnPolicyTrigger)
	putStringMetadata(payload, responsesAPIClientMetadataKeyTurnPolicyName, metadata.TurnPolicyName)

	if len(payload) == 0 {
		return nil
	}

	return payload
}

func putStringMetadata(payload map[string]any, key string, value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}

	payload[key] = trimmed
}
