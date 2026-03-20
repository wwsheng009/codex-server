package store

import "time"

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
	case "turn/started", "turn/completed":
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
				next.Items = items
			}
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
			next["aggregatedOutput"] = stringValue(next["aggregatedOutput"]) + delta
			return next
		})
		changed = true
	case "thread/tokenUsage/updated":
		if usage := parseThreadTokenUsage(payload["tokenUsage"]); usage != nil {
			projection.TokenUsage = usage
			changed = true
		}
	}

	if changed {
		if projection.UpdatedAt.IsZero() || event.TS.After(projection.UpdatedAt) {
			projection.UpdatedAt = event.TS
		}
	}

	return changed
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

	*turns = append(*turns, build(nil))
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

		next.Items = append(next.Items, build(nil))
		return next
	})
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

	return merged
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
