package store

import (
	"strings"
	"time"
)

const threadGovernanceTurnID = "thread-governance"

func applyThreadEventToProjection(projection *ThreadProjection, event EventEnvelope) bool {
	payload := asObject(event.Payload)
	changed := false

	if event.ServerRequestID != nil && *event.ServerRequestID != "" {
		switch event.Method {
		case "server/request/resolved":
			if updateProjectedServerRequestStatus(&projection.Turns, requestItemID(*event.ServerRequestID), "resolved", event.TS, stringValue(payload["method"]), "") {
				changed = true
			}
		case "server/request/expired":
			if updateProjectedServerRequestStatus(&projection.Turns, requestItemID(*event.ServerRequestID), "expired", event.TS, stringValue(payload["method"]), stringValue(payload["reason"])) {
				changed = true
			}
		default:
			if isProjectedServerRequestMethod(event.Method) {
				upsertProjectedServerRequest(&projection.Turns, event, payload)
				changed = true
			}
		}
	}

	switch event.Method {
	case "thread/status/changed":
		status := stringValue(asObject(payload["status"])["type"])
		if status != "" && projection.Status != status {
			projection.Status = status
			changed = true
		}
	case "turn/started", "turn/completed", "turn/failed", "turn/interrupted", "turn/canceled", "turn/cancelled":
		turn := asObject(payload["turn"])
		turnID := stringValue(turn["id"])
		if turnID == "" {
			turnID = event.TurnID
		}
		if turnID == "" {
			break
		}

		status := stringValue(turn["status"])
		if status == "" {
			if event.Method == "turn/completed" {
				status = "completed"
			} else if event.Method == "turn/failed" {
				status = "failed"
			} else if event.Method == "turn/interrupted" {
				status = "interrupted"
			} else if event.Method == "turn/canceled" || event.Method == "turn/cancelled" {
				status = "cancelled"
			} else {
				status = "inProgress"
			}
		}

		updateProjectedTurn(&projection.Turns, turnID, func(current *ThreadTurn) ThreadTurn {
			next := ThreadTurn{
				ID:     turnID,
				Status: status,
			}
			if current != nil {
				next.Items = cloneItems(current.Items)
				next.Error = current.Error
			}
			if len(next.Items) == 0 {
				next.Items = []map[string]any{}
			}

			if items := readTurnItems(turn["items"]); len(items) > 0 {
				next.Items = mergeProjectedTurnItemsPreserveCurrentOrder(next.Items, items)
			}
			next.Items = reconcileProjectedTurnPlanItemsForTerminalTurnStatus(next.Items, status)
			if hasOwn(turn, "error") {
				next.Error = turn["error"]
			}

			return next
		})
		changed = true
	case "item/started", "item/completed":
		item := asObject(payload["item"])
		turnID := stringValue(payload["turnId"])
		if turnID == "" {
			turnID = event.TurnID
		}
		itemID := stringValue(item["id"])
		if turnID == "" || itemID == "" {
			break
		}

		updateProjectedItem(&projection.Turns, turnID, itemID, func(current map[string]any) map[string]any {
			merged := mergeProjectedItem(current, item)
			if event.Method == "item/completed" && stringValue(merged["type"]) == "agentMessage" {
				delete(merged, "phase")
			}
			return merged
		})
		changed = true
	case "item/agentMessage/delta":
		turnID := stringValue(payload["turnId"])
		if turnID == "" {
			turnID = event.TurnID
		}
		itemID := stringValue(payload["itemId"])
		delta := stringValue(payload["delta"])
		if turnID == "" || itemID == "" || delta == "" {
			break
		}

		updateProjectedItem(&projection.Turns, turnID, itemID, func(current map[string]any) map[string]any {
			next := cloneItem(current)
			next["id"] = itemID
			next["type"] = "agentMessage"
			next["text"] = stringValue(next["text"]) + delta
			next["phase"] = "streaming"
			return next
		})
		changed = true
	case "item/plan/delta":
		turnID := stringValue(payload["turnId"])
		if turnID == "" {
			turnID = event.TurnID
		}
		itemID := stringValue(payload["itemId"])
		delta := stringValue(payload["delta"])
		if turnID == "" || itemID == "" || delta == "" {
			break
		}

		updateProjectedItem(&projection.Turns, turnID, itemID, func(current map[string]any) map[string]any {
			next := cloneItem(current)
			next["id"] = itemID
			next["type"] = "plan"
			next["text"] = stringValue(next["text"]) + delta
			return next
		})
		changed = true
	case "turn/plan/updated":
		turnID := stringValue(payload["turnId"])
		if turnID == "" {
			turnID = event.TurnID
		}
		if turnID == "" {
			break
		}

		updateProjectedItem(&projection.Turns, turnID, turnPlanItemID(turnID), func(current map[string]any) map[string]any {
			return mergeProjectedItem(current, projectedTurnPlanItem(turnID, payload))
		})
		changed = true
	case "item/reasoning/summaryTextDelta", "item/reasoning/textDelta":
		turnID := stringValue(payload["turnId"])
		if turnID == "" {
			turnID = event.TurnID
		}
		itemID := stringValue(payload["itemId"])
		delta := stringValue(payload["delta"])
		if turnID == "" || itemID == "" || delta == "" {
			break
		}

		updateProjectedItem(&projection.Turns, turnID, itemID, func(current map[string]any) map[string]any {
			next := cloneItem(current)
			next["id"] = itemID
			next["type"] = "reasoning"

			summary := stringSlice(next["summary"])
			content := stringSlice(next["content"])
			if event.Method == "item/reasoning/summaryTextDelta" {
				next["summary"] = appendStringAtIndex(summary, intValue(payload["summaryIndex"]), delta)
				next["content"] = content
				return next
			}

			next["summary"] = summary
			next["content"] = appendStringAtIndex(content, intValue(payload["contentIndex"]), delta)
			return next
		})
		changed = true
	case "item/commandExecution/outputDelta":
		turnID := stringValue(payload["turnId"])
		if turnID == "" {
			turnID = event.TurnID
		}
		itemID := stringValue(payload["itemId"])
		delta := stringValue(payload["delta"])
		if turnID == "" || itemID == "" || delta == "" {
			break
		}

		updateProjectedItem(&projection.Turns, turnID, itemID, func(current map[string]any) map[string]any {
			next := cloneItem(current)
			next["id"] = itemID
			next["type"] = "commandExecution"
			if stringValue(next["status"]) == "" {
				next["status"] = "inProgress"
			}
			return appendProjectedCommandExecutionOutput(next, delta)
		})
		changed = true
	case "hook/started", "hook/completed":
		run := asObject(payload["run"])
		turnID := hookRunProjectionTurnID(run, event)
		runID := stringValue(run["id"])
		if turnID == "" || runID == "" {
			break
		}

		updateProjectedItem(&projection.Turns, turnID, hookRunItemID(runID), func(current map[string]any) map[string]any {
			return mergeProjectedItem(current, projectedHookRunItem(run))
		})
		changed = true
	case "thread/tokenUsage/updated":
		if usage := parseThreadTokenUsage(payload["tokenUsage"]); usage != nil {
			projection.TokenUsage = usage
			changed = true
		}
	}

	if changed {
		projection.TurnCount = projectedConversationTurnCount(projection.Turns)
		projection.MessageCount = projectedMessageCount(projection.Turns)
		if projection.UpdatedAt.IsZero() || event.TS.After(projection.UpdatedAt) {
			projection.UpdatedAt = event.TS
		}
	}

	return changed
}

func shouldPersistThreadProjectionEvent(method string) bool {
	switch method {
	case "item/agentMessage/delta",
		"item/plan/delta",
		"item/reasoning/summaryTextDelta",
		"item/reasoning/textDelta",
		"item/commandExecution/outputDelta":
		return false
	default:
		return true
	}
}

func projectedMessageCount(turns []ThreadTurn) int {
	count := 0
	for _, turn := range turns {
		for _, item := range turn.Items {
			switch stringValue(item["type"]) {
			case "userMessage", "agentMessage":
				count += 1
			}
		}
	}

	return count
}

func updateProjectedTurn(turns *[]ThreadTurn, turnID string, build func(current *ThreadTurn) ThreadTurn) {
	for index, turn := range *turns {
		if turn.ID != turnID {
			continue
		}

		next := build(&turn)
		(*turns)[index] = next
		return
	}

	nextTurn := build(nil)
	if isSyntheticGovernanceTurnID(turnID) {
		*turns = append([]ThreadTurn{nextTurn}, *turns...)
		return
	}

	*turns = append(*turns, nextTurn)
}

func updateProjectedItem(
	turns *[]ThreadTurn,
	turnID string,
	itemID string,
	build func(current map[string]any) map[string]any,
) {
	updateProjectedTurn(turns, turnID, func(current *ThreadTurn) ThreadTurn {
		next := ThreadTurn{
			ID:     turnID,
			Status: "inProgress",
			Items:  []map[string]any{},
		}
		if current != nil {
			next = ThreadTurn{
				ID:     current.ID,
				Status: current.Status,
				Items:  cloneItems(current.Items),
				Error:  current.Error,
			}
			if next.Status == "" {
				next.Status = "inProgress"
			}
		}

		for index, item := range next.Items {
			if stringValue(item["id"]) != itemID {
				continue
			}

			next.Items[index] = build(item)
			return next
		}

		next.Items = insertProjectedItem(next.Items, build(nil))
		return next
	})
}

func insertProjectedItem(items []map[string]any, item map[string]any) []map[string]any {
	if len(items) == 0 {
		return append(items, item)
	}

	if stringValue(item["type"]) == "hookRun" {
		relatedItemID := stringValue(item["itemId"])
		if relatedItemID != "" {
			for index, existing := range items {
				if stringValue(existing["id"]) != relatedItemID {
					continue
				}

				next := append([]map[string]any{}, items[:index+1]...)
				next = append(next, item)
				next = append(next, items[index+1:]...)
				return next
			}
		}
	}

	return append(items, item)
}

func upsertProjectedServerRequest(turns *[]ThreadTurn, event EventEnvelope, payload map[string]any) {
	if event.ServerRequestID == nil || *event.ServerRequestID == "" {
		return
	}

	turnID := stringValue(payload["turnId"])
	if turnID == "" {
		turnID = event.TurnID
	}
	if turnID == "" {
		return
	}

	requestID := *event.ServerRequestID
	itemID := requestItemID(requestID)

	updateProjectedItem(turns, turnID, itemID, func(current map[string]any) map[string]any {
		next := cloneItem(current)
		next["id"] = itemID
		next["type"] = "serverRequest"
		next["requestId"] = requestID
		next["requestKind"] = event.Method
		next["status"] = "pending"
		next["details"] = cloneItem(payload)
		next["requestedAt"] = event.TS.Format(time.RFC3339)
		return next
	})
}

func updateProjectedServerRequestStatus(
	turns *[]ThreadTurn,
	itemID string,
	status string,
	ts time.Time,
	method string,
	reason string,
) bool {
	for turnIndex, turn := range *turns {
		for itemIndex, item := range turn.Items {
			if stringValue(item["id"]) != itemID {
				continue
			}

			next := cloneItem(item)
			next["status"] = status
			if status == "expired" {
				next["expiredAt"] = ts.Format(time.RFC3339)
				if reason != "" {
					next["expireReason"] = reason
				}
			} else {
				next["resolvedAt"] = ts.Format(time.RFC3339)
			}
			if method != "" && stringValue(next["requestKind"]) == "" {
				next["requestKind"] = method
			}
			(*turns)[turnIndex].Items[itemIndex] = next
			return true
		}
	}

	return false
}

func isProjectedServerRequestMethod(method string) bool {
	switch method {
	case "item/commandExecution/requestApproval",
		"execCommandApproval",
		"item/fileChange/requestApproval",
		"applyPatchApproval",
		"item/tool/requestUserInput",
		"item/permissions/requestApproval",
		"mcpServer/elicitation/request",
		"item/tool/call",
		"account/chatgptAuthTokens/refresh":
		return true
	default:
		return false
	}
}

func requestItemID(requestID string) string {
	return "server-request-" + requestID
}

func hookRunProjectionTurnID(run map[string]any, event EventEnvelope) string {
	turnID := stringValue(run["turnId"])
	if turnID == "" {
		turnID = event.TurnID
	}
	if turnID != "" {
		return turnID
	}

	if stringValue(run["threadId"]) != "" || event.ThreadID != "" {
		return threadGovernanceTurnID
	}
	return ""
}

func hookRunItemID(runID string) string {
	return "hook-run-" + runID
}

func turnPlanItemID(turnID string) string {
	return "turn-plan-" + turnID
}

func projectedTurnPlanItem(turnID string, payload map[string]any) map[string]any {
	steps := turnPlanSteps(payload["plan"])
	item := map[string]any{
		"id":     turnPlanItemID(turnID),
		"type":   "turnPlan",
		"steps":  steps,
		"status": turnPlanStatus(steps),
	}
	if hasOwn(payload, "explanation") {
		item["explanation"] = stringValue(payload["explanation"])
	}
	return item
}

func turnPlanSteps(value any) []map[string]any {
	rawItems, ok := value.([]any)
	if !ok || len(rawItems) == 0 {
		return []map[string]any{}
	}

	items := make([]map[string]any, 0, len(rawItems))
	for _, rawItem := range rawItems {
		entry := asObject(rawItem)
		step := strings.TrimSpace(stringValue(entry["step"]))
		if step == "" {
			continue
		}

		item := map[string]any{
			"step": step,
		}
		if status := strings.TrimSpace(stringValue(entry["status"])); status != "" {
			item["status"] = status
		}
		items = append(items, item)
	}

	return items
}

func turnPlanStatus(steps []map[string]any) string {
	if len(steps) == 0 {
		return ""
	}

	allCompleted := true
	for _, step := range steps {
		switch strings.TrimSpace(stringValue(step["status"])) {
		case "completed":
			continue
		case "inProgress":
			return "inProgress"
		default:
			allCompleted = false
		}
	}

	if allCompleted {
		return "completed"
	}
	return "pending"
}

func reconcileProjectedTurnPlanItemsForTerminalTurnStatus(items []map[string]any, turnStatus string) []map[string]any {
	if len(items) == 0 || !isProjectedTerminalTurnStatus(turnStatus) {
		return items
	}

	changed := false
	nextItems := make([]map[string]any, len(items))
	for index, item := range items {
		nextItems[index] = cloneItem(item)
		if stringValue(nextItems[index]["type"]) != "turnPlan" {
			continue
		}

		currentStatus := strings.TrimSpace(stringValue(nextItems[index]["status"]))
		switch currentStatus {
		case "", "inProgress", "pending":
			nextItems[index]["status"] = turnStatus
			changed = true
		}
	}

	if !changed {
		return items
	}

	return nextItems
}

func isProjectedTerminalTurnStatus(value string) bool {
	switch strings.TrimSpace(value) {
	case "completed", "failed", "interrupted", "cancelled", "canceled":
		return true
	default:
		return false
	}
}

func projectedHookRunItem(run map[string]any) map[string]any {
	item := map[string]any{
		"id":                 hookRunItemID(stringValue(run["id"])),
		"type":               "hookRun",
		"hookRunId":          stringValue(run["id"]),
		"itemId":             stringValue(run["itemId"]),
		"eventName":          stringValue(run["eventName"]),
		"handlerKey":         stringValue(run["handlerKey"]),
		"triggerMethod":      stringValue(run["triggerMethod"]),
		"sessionStartSource": stringValue(run["sessionStartSource"]),
		"toolKind":           stringValue(run["toolKind"]),
		"toolName":           stringValue(run["toolName"]),
		"status":             stringValue(run["status"]),
		"decision":           stringValue(run["decision"]),
		"reason":             stringValue(run["reason"]),
		"source":             stringValue(run["source"]),
		"message":            hookRunMessage(run),
	}
	if errorValue := stringValue(run["error"]); errorValue != "" {
		item["error"] = errorValue
	}
	if completedAt := stringValue(run["completedAt"]); completedAt != "" {
		item["completedAt"] = completedAt
	}
	if durationMs := intValue(run["durationMs"]); durationMs > 0 {
		item["durationMs"] = durationMs
	}
	return item
}

func hookRunMessage(run map[string]any) string {
	entries := hookRunEntries(run["entries"])

	return FormatHookRunMessage(HookRunDisplayFields{
		EventName:          stringValue(run["eventName"]),
		HandlerKey:         stringValue(run["handlerKey"]),
		TriggerMethod:      stringValue(run["triggerMethod"]),
		Status:             stringValue(run["status"]),
		Decision:           stringValue(run["decision"]),
		ToolName:           stringValue(run["toolName"]),
		ToolKind:           stringValue(run["toolKind"]),
		Reason:             stringValue(run["reason"]),
		Feedback:           FormatHookRunFeedbackEntries(entries, 2),
		SessionStartSource: stringValue(run["sessionStartSource"]),
	})
}

func hookRunEntries(value any) []HookOutputEntry {
	rawEntries, ok := value.([]any)
	if !ok || len(rawEntries) == 0 {
		return nil
	}

	entries := make([]HookOutputEntry, 0, len(rawEntries))
	for _, rawEntry := range rawEntries {
		entry := asObject(rawEntry)
		text := strings.TrimSpace(stringValue(asObject(rawEntry)["text"]))
		if text == "" {
			continue
		}
		entries = append(entries, HookOutputEntry{
			Kind: strings.TrimSpace(stringValue(entry["kind"])),
			Text: text,
		})
	}

	return entries
}

func projectedConversationTurnCount(turns []ThreadTurn) int {
	count := 0
	for _, turn := range turns {
		if isSyntheticGovernanceTurnID(turn.ID) {
			continue
		}
		count += 1
	}
	return count
}

func isSyntheticGovernanceTurnID(turnID string) bool {
	return strings.TrimSpace(turnID) == threadGovernanceTurnID
}

func mergeProjectedItem(current map[string]any, incoming map[string]any) map[string]any {
	if current == nil {
		return cloneItem(incoming)
	}

	merged := cloneItem(current)
	for key, value := range incoming {
		merged[key] = value
	}

	if stringValue(incoming["type"]) == "agentMessage" && stringValue(incoming["text"]) == "" && stringValue(current["text"]) != "" {
		merged["text"] = current["text"]
	}
	if stringValue(incoming["type"]) == "plan" && stringValue(incoming["text"]) == "" && stringValue(current["text"]) != "" {
		merged["text"] = current["text"]
	}
	if stringValue(incoming["type"]) == "commandExecution" &&
		stringValue(incoming["aggregatedOutput"]) == "" &&
		stringValue(current["aggregatedOutput"]) != "" {
		merged["aggregatedOutput"] = current["aggregatedOutput"]
	}
	if stringValue(incoming["type"]) == "reasoning" {
		if len(stringSlice(incoming["summary"])) == 0 && len(stringSlice(current["summary"])) > 0 {
			merged["summary"] = current["summary"]
		}
		if len(stringSlice(incoming["content"])) == 0 && len(stringSlice(current["content"])) > 0 {
			merged["content"] = current["content"]
		}
	}

	if stringValue(merged["type"]) == "commandExecution" {
		return compactProjectedCommandExecutionItem(merged)
	}

	return merged
}

func mergeProjectedTurnItemsPreserveCurrentOrder(base []map[string]any, overlay []map[string]any) []map[string]any {
	if len(overlay) == 0 {
		return cloneItems(base)
	}

	nextItems := cloneItems(base)
	for _, projectedItem := range overlay {
		projectedID := stringValue(projectedItem["id"])
		if projectedID == "" {
			nextItems = append(nextItems, cloneItem(projectedItem))
			continue
		}

		index := -1
		for itemIndex, item := range nextItems {
			if stringValue(item["id"]) == projectedID {
				index = itemIndex
				break
			}
		}

		semanticMatch := false
		if index < 0 {
			index = findEquivalentProjectedTurnItemIndex(nextItems, projectedItem)
			semanticMatch = index >= 0
		}

		if index < 0 {
			nextItems = append(nextItems, cloneItem(projectedItem))
			continue
		}

		merged := mergeProjectedItem(nextItems[index], projectedItem)
		if semanticMatch {
			merged["id"] = chooseCanonicalProjectedTurnItemID(
				stringValue(nextItems[index]["id"]),
				projectedID,
			)
		}
		nextItems[index] = merged
	}

	return nextItems
}

func findEquivalentProjectedTurnItemIndex(items []map[string]any, candidate map[string]any) int {
	candidateType := stringValue(candidate["type"])
	if candidateType == "" {
		return -1
	}

	candidateText := projectedTurnItemSemanticText(candidate)
	matchingTypeIndices := make([]int, 0, len(items))

	for index, item := range items {
		if stringValue(item["type"]) != candidateType {
			continue
		}

		matchingTypeIndices = append(matchingTypeIndices, index)
		if candidateText != "" && projectedTurnItemSemanticText(item) == candidateText {
			return index
		}
	}

	switch candidateType {
	case "userMessage", "agentMessage", "reasoning":
		if len(matchingTypeIndices) == 1 {
			return matchingTypeIndices[0]
		}
	}

	return -1
}

func projectedTurnItemSemanticText(item map[string]any) string {
	switch stringValue(item["type"]) {
	case "userMessage":
		return normalizeProjectedTurnItemText(userMessageProjectedContentText(item))
	case "agentMessage", "plan":
		return normalizeProjectedTurnItemText(stringValue(item["text"]))
	case "reasoning":
		return normalizeProjectedTurnItemText(
			strings.Join(stringSlice(item["summary"]), "\n") + "\n" + strings.Join(stringSlice(item["content"]), "\n"),
		)
	default:
		return ""
	}
}

func userMessageProjectedContentText(item map[string]any) string {
	rawContent, ok := item["content"].([]any)
	if !ok || len(rawContent) == 0 {
		return ""
	}

	lines := make([]string, 0, len(rawContent))
	for _, rawEntry := range rawContent {
		entry := asObject(rawEntry)
		text := strings.TrimSpace(stringValue(entry["text"]))
		if text != "" {
			lines = append(lines, text)
		}
	}

	return strings.Join(lines, "\n")
}

func normalizeProjectedTurnItemText(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
}

func chooseCanonicalProjectedTurnItemID(baseID string, overlayID string) string {
	if baseID == "" {
		return overlayID
	}
	if overlayID == "" {
		return baseID
	}

	baseTemporary := isTemporaryProjectedTurnItemID(baseID)
	overlayTemporary := isTemporaryProjectedTurnItemID(overlayID)
	switch {
	case baseTemporary && !overlayTemporary:
		return overlayID
	case !baseTemporary && overlayTemporary:
		return baseID
	default:
		return baseID
	}
}

func isTemporaryProjectedTurnItemID(value string) bool {
	if !strings.HasPrefix(value, "item-") {
		return false
	}

	for _, r := range value[len("item-"):] {
		if r < '0' || r > '9' {
			return false
		}
	}

	return len(value) > len("item-")
}

func parseThreadTokenUsage(value any) *ThreadTokenUsage {
	object := asObject(value)
	if len(object) == 0 {
		return nil
	}

	total := asObject(object["total"])
	if len(total) == 0 {
		return nil
	}

	last := asObject(object["last"])
	usage := &ThreadTokenUsage{
		Last: TokenUsageBreakdown{
			CachedInputTokens:     int64Value(last["cachedInputTokens"]),
			InputTokens:           int64Value(last["inputTokens"]),
			OutputTokens:          int64Value(last["outputTokens"]),
			ReasoningOutputTokens: int64Value(last["reasoningOutputTokens"]),
			TotalTokens:           int64Value(last["totalTokens"]),
		},
		Total: TokenUsageBreakdown{
			CachedInputTokens:     int64Value(total["cachedInputTokens"]),
			InputTokens:           int64Value(total["inputTokens"]),
			OutputTokens:          int64Value(total["outputTokens"]),
			ReasoningOutputTokens: int64Value(total["reasoningOutputTokens"]),
			TotalTokens:           int64Value(total["totalTokens"]),
		},
	}

	if window := int64Value(object["modelContextWindow"]); window > 0 {
		usage.ModelContextWindow = &window
	}

	return usage
}

func readTurnItems(value any) []map[string]any {
	rawItems, ok := value.([]any)
	if !ok || len(rawItems) == 0 {
		return nil
	}

	items := make([]map[string]any, 0, len(rawItems))
	for _, rawItem := range rawItems {
		item := asObject(rawItem)
		if len(item) == 0 {
			continue
		}
		items = append(items, cloneItem(item))
	}

	return items
}

func appendStringAtIndex(items []string, index int, delta string) []string {
	target := index
	if target < 0 {
		target = 0
	}

	next := append([]string{}, items...)
	for len(next) <= target {
		next = append(next, "")
	}

	next[target] += delta
	return next
}

func stringSlice(value any) []string {
	rawItems, ok := value.([]any)
	if ok {
		items := make([]string, 0, len(rawItems))
		for _, raw := range rawItems {
			if item, ok := raw.(string); ok {
				items = append(items, item)
			}
		}
		return items
	}

	if typed, ok := value.([]string); ok {
		return append([]string{}, typed...)
	}

	return []string{}
}

func cloneItems(items []map[string]any) []map[string]any {
	if len(items) == 0 {
		return []map[string]any{}
	}

	cloned := make([]map[string]any, 0, len(items))
	for _, item := range items {
		cloned = append(cloned, cloneItem(item))
	}
	return cloned
}

func cloneItem(item map[string]any) map[string]any {
	if item == nil {
		return map[string]any{}
	}

	cloned := make(map[string]any, len(item))
	for key, value := range item {
		cloned[key] = value
	}
	return cloned
}

func asObject(value any) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}

	return object
}

func hasOwn(value map[string]any, key string) bool {
	_, ok := value[key]
	return ok
}

func stringValue(value any) string {
	typed, ok := value.(string)
	if !ok {
		return ""
	}
	return typed
}

func intValue(value any) int {
	return int(int64Value(value))
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}
