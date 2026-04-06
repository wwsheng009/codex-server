package turncapture

import (
	"fmt"
	"strings"

	"codex-server/backend/internal/store"
)

type Result struct {
	ThreadID          string
	TurnID            string
	Status            string
	Terminal          bool
	AssistantText     string
	CommandOutput     string
	ReasoningText     string
	Summary           string
	Error             string
	SubagentThreadIDs []string
	SubagentTurnIDs   []string
}

func (r Result) Succeeded() bool {
	return strings.EqualFold(strings.TrimSpace(r.Status), "completed") && strings.TrimSpace(r.Error) == ""
}

func (r Result) FailureMessage() string {
	if text := strings.TrimSpace(r.Error); text != "" {
		return text
	}
	if !r.Terminal || r.Succeeded() {
		return ""
	}

	status := strings.TrimSpace(r.Status)
	if status == "" {
		return "turn ended without a successful status"
	}
	return "turn ended with status " + status
}

type Capture struct {
	threadID string
	turnID   string

	status          string
	errorText       string
	items           []map[string]any
	itemIndexByID   map[string]int
	subagentThreads map[string]struct{}
	subagentTurns   map[string]struct{}
}

func New(threadID string, turnID string) *Capture {
	return &Capture{
		threadID:        strings.TrimSpace(threadID),
		turnID:          strings.TrimSpace(turnID),
		itemIndexByID:   make(map[string]int),
		subagentThreads: make(map[string]struct{}),
		subagentTurns:   make(map[string]struct{}),
	}
}

func FromTurn(threadID string, turnID string, turn store.ThreadTurn) Result {
	capture := New(threadID, turnID)
	capture.ApplyTurn(turn)
	return capture.Result()
}

func (c *Capture) ApplyTurn(turn store.ThreadTurn) {
	if status := strings.TrimSpace(turn.Status); status != "" {
		c.status = status
	}
	if errorText := formatError(turn.Error); errorText != "" {
		c.errorText = errorText
	}
	for _, item := range turn.Items {
		c.mergeItem(item)
	}
}

func (c *Capture) ApplyEvent(event store.EventEnvelope) {
	if c.threadID != "" && strings.TrimSpace(event.ThreadID) != "" && !strings.EqualFold(strings.TrimSpace(event.ThreadID), c.threadID) {
		return
	}
	if c.turnID != "" && strings.TrimSpace(event.TurnID) != "" && !strings.EqualFold(strings.TrimSpace(event.TurnID), c.turnID) {
		return
	}

	payload := mapValue(event.Payload)
	switch strings.TrimSpace(event.Method) {
	case "turn/started", "turn/completed", "turn/failed", "turn/interrupted", "turn/canceled", "turn/cancelled":
		turn := mapValue(payload["turn"])
		if status := firstNonEmpty(stringValue(turn["status"]), statusFromMethod(event.Method)); status != "" {
			c.status = status
		}
		if errorText := formatError(turn["error"]); errorText != "" {
			c.errorText = errorText
		}
		for _, item := range itemsValue(turn["items"]) {
			c.mergeItem(item)
		}
	case "item/started", "item/completed":
		c.mergeItem(mapValue(payload["item"]))
	case "item/agentMessage/delta":
		item := c.ensureItem(strings.TrimSpace(stringValue(payload["itemId"])), "agentMessage")
		item["text"] = stringValue(item["text"]) + stringValue(payload["delta"])
	case "item/commandExecution/outputDelta":
		item := c.ensureItem(strings.TrimSpace(stringValue(payload["itemId"])), "commandExecution")
		item["aggregatedOutput"] = stringValue(item["aggregatedOutput"]) + stringValue(payload["delta"])
	case "item/reasoning/summaryTextDelta":
		item := c.ensureItem(strings.TrimSpace(stringValue(payload["itemId"])), "reasoning")
		item["summary"] = appendStringAtIndex(stringSlice(item["summary"]), intValue(payload["summaryIndex"]), stringValue(payload["delta"]))
	case "item/reasoning/textDelta":
		item := c.ensureItem(strings.TrimSpace(stringValue(payload["itemId"])), "reasoning")
		item["content"] = appendStringAtIndex(stringSlice(item["content"]), intValue(payload["contentIndex"]), stringValue(payload["delta"]))
	}
}

func (c *Capture) Result() Result {
	result := Result{
		ThreadID: c.threadID,
		TurnID:   c.turnID,
		Status:   strings.TrimSpace(c.status),
		Error:    strings.TrimSpace(c.errorText),
		Terminal: isTerminalStatus(c.status),
	}

	for itemIndex := len(c.items) - 1; itemIndex >= 0; itemIndex-- {
		item := c.items[itemIndex]
		itemType := strings.TrimSpace(stringValue(item["type"]))

		switch itemType {
		case "agentMessage":
			if result.AssistantText == "" {
				result.AssistantText = strings.TrimSpace(stringValue(item["text"]))
			}
		case "commandExecution":
			if result.CommandOutput == "" {
				result.CommandOutput = strings.TrimSpace(stringValue(item["aggregatedOutput"]))
			}
		case "reasoning":
			if result.ReasoningText == "" {
				result.ReasoningText = strings.TrimSpace(renderReasoning(item))
			}
		}

		collectSubagentIDs(c.subagentThreads, c.subagentTurns, item)
	}

	result.Summary = firstNonEmpty(result.AssistantText, result.CommandOutput, result.ReasoningText)
	result.SubagentThreadIDs = mapKeysSorted(c.subagentThreads)
	result.SubagentTurnIDs = mapKeysSorted(c.subagentTurns)
	return result
}

func (c *Capture) ensureItem(itemID string, itemType string) map[string]any {
	itemID = strings.TrimSpace(itemID)
	if itemID != "" {
		if index, ok := c.itemIndexByID[itemID]; ok {
			item := c.items[index]
			if strings.TrimSpace(stringValue(item["type"])) == "" && strings.TrimSpace(itemType) != "" {
				item["type"] = itemType
			}
			return item
		}
	}

	item := map[string]any{}
	if itemID != "" {
		item["id"] = itemID
	}
	if strings.TrimSpace(itemType) != "" {
		item["type"] = itemType
	}
	c.items = append(c.items, item)
	if itemID != "" {
		c.itemIndexByID[itemID] = len(c.items) - 1
	}
	return item
}

func (c *Capture) mergeItem(incoming map[string]any) {
	if len(incoming) == 0 {
		return
	}

	itemID := strings.TrimSpace(stringValue(incoming["id"]))
	itemType := strings.TrimSpace(stringValue(incoming["type"]))
	target := c.ensureItem(itemID, itemType)
	for key, value := range incoming {
		if value == nil {
			continue
		}
		target[key] = cloneValue(value)
	}

	if itemType == "agentMessage" && strings.TrimSpace(stringValue(incoming["text"])) == "" {
		if existing := strings.TrimSpace(stringValue(target["text"])); existing != "" {
			target["text"] = existing
		}
	}
	if itemType == "commandExecution" && strings.TrimSpace(stringValue(incoming["aggregatedOutput"])) == "" {
		if existing := strings.TrimSpace(stringValue(target["aggregatedOutput"])); existing != "" {
			target["aggregatedOutput"] = existing
		}
	}
	if itemType == "reasoning" {
		if summary := stringSlice(incoming["summary"]); len(summary) == 0 {
			if existing := stringSlice(target["summary"]); len(existing) > 0 {
				target["summary"] = existing
			}
		}
		if content := stringSlice(incoming["content"]); len(content) == 0 {
			if existing := stringSlice(target["content"]); len(existing) > 0 {
				target["content"] = existing
			}
		}
	}
}

func collectSubagentIDs(threadIDs map[string]struct{}, turnIDs map[string]struct{}, item map[string]any) {
	for _, key := range []string{"subagentThreadId", "threadId", "childThreadId"} {
		if value := strings.TrimSpace(stringValue(item[key])); value != "" {
			threadIDs[value] = struct{}{}
		}
	}
	for _, key := range []string{"subagentTurnId", "turnId", "childTurnId"} {
		if value := strings.TrimSpace(stringValue(item[key])); value != "" {
			turnIDs[value] = struct{}{}
		}
	}

	thread := mapValue(item["thread"])
	if value := strings.TrimSpace(stringValue(thread["id"])); value != "" {
		threadIDs[value] = struct{}{}
	}
	turn := mapValue(item["turn"])
	if value := strings.TrimSpace(stringValue(turn["id"])); value != "" {
		turnIDs[value] = struct{}{}
	}
}

func renderReasoning(item map[string]any) string {
	parts := make([]string, 0, 2)
	if text := strings.Join(stringSlice(item["summary"]), "\n"); strings.TrimSpace(text) != "" {
		parts = append(parts, strings.TrimSpace(text))
	}
	if text := strings.Join(stringSlice(item["content"]), "\n"); strings.TrimSpace(text) != "" {
		parts = append(parts, strings.TrimSpace(text))
	}
	if len(parts) == 0 {
		return strings.TrimSpace(stringValue(item["text"]))
	}
	return strings.Join(parts, "\n\n")
}

func formatError(value any) string {
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

func cloneValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		cloned := make(map[string]any, len(typed))
		for key, inner := range typed {
			cloned[key] = cloneValue(inner)
		}
		return cloned
	case []map[string]any:
		cloned := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			cloned = append(cloned, mapValue(cloneValue(item)))
		}
		return cloned
	case []any:
		cloned := make([]any, 0, len(typed))
		for _, item := range typed {
			cloned = append(cloned, cloneValue(item))
		}
		return cloned
	default:
		return typed
	}
}

func itemsValue(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if object := mapValue(item); len(object) > 0 {
				items = append(items, object)
			}
		}
		return items
	default:
		return nil
	}
}

func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(stringValue(item)); text != "" {
				items = append(items, text)
			}
		}
		return items
	default:
		return nil
	}
}

func appendStringAtIndex(items []string, index int, delta string) []string {
	if index < 0 {
		index = 0
	}
	for len(items) <= index {
		items = append(items, "")
	}
	items[index] += delta
	return items
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func mapValue(value any) map[string]any {
	object, _ := value.(map[string]any)
	if object == nil {
		return map[string]any{}
	}
	return object
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func isTerminalStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "failed", "interrupted", "canceled", "cancelled":
		return true
	default:
		return false
	}
}

func statusFromMethod(method string) string {
	switch strings.ToLower(strings.TrimSpace(method)) {
	case "turn/completed":
		return "completed"
	case "turn/failed":
		return "failed"
	case "turn/interrupted":
		return "interrupted"
	case "turn/canceled", "turn/cancelled":
		return "canceled"
	default:
		return ""
	}
}

func mapKeysSorted(items map[string]struct{}) []string {
	if len(items) == 0 {
		return nil
	}

	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}
