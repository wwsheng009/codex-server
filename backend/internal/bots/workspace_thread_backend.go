package bots

import (
	"context"
	"fmt"
	"strings"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
)

const (
	defaultThreadPollInterval  = 1500 * time.Millisecond
	defaultThreadTurnTimeout   = 2 * time.Minute
	defaultStreamFlushInterval = 400 * time.Millisecond
	defaultTurnSettleDelay     = 600 * time.Millisecond
)

type workspaceThreadAIBackend struct {
	threads             threadExecutor
	turns               turnExecutor
	events              *events.Hub
	pollInterval        time.Duration
	turnTimeout         time.Duration
	streamFlushInterval time.Duration
	turnSettleDelay     time.Duration
}

func newWorkspaceThreadAIBackend(
	threadService threadExecutor,
	turnService turnExecutor,
	eventHub *events.Hub,
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
		threads:             threadService,
		turns:               turnService,
		events:              eventHub,
		pollInterval:        pollInterval,
		turnTimeout:         turnTimeout,
		streamFlushInterval: defaultStreamFlushInterval,
		turnSettleDelay:     defaultTurnSettleDelay,
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
	return b.processMessage(ctx, connection, conversation, inbound, nil)
}

func (b *workspaceThreadAIBackend) ProcessMessageStream(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
	handle StreamingUpdateHandler,
) (AIResult, error) {
	if handle == nil || b.events == nil {
		return b.ProcessMessage(ctx, connection, conversation, inbound)
	}

	return b.processMessage(ctx, connection, conversation, inbound, handle)
}

func (b *workspaceThreadAIBackend) processMessage(
	ctx context.Context,
	connection store.BotConnection,
	conversation store.BotConversation,
	inbound InboundMessage,
	handle StreamingUpdateHandler,
) (AIResult, error) {
	threadID, err := b.ensureThread(ctx, connection, conversation, inbound)
	if err != nil {
		return AIResult{}, err
	}

	var eventCh <-chan store.EventEnvelope
	cancelEvents := func() {}
	if handle != nil && b.events != nil {
		eventCh, cancelEvents = b.events.Subscribe(connection.WorkspaceID)
	}
	defer cancelEvents()

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

	var turn store.ThreadTurn
	if handle != nil && eventCh != nil {
		turn, err = b.waitForTurnStream(turnCtx, connection.WorkspaceID, threadID, result.TurnID, eventCh, handle)
	} else {
		turn, err = b.waitForTurn(turnCtx, connection.WorkspaceID, threadID, result.TurnID)
	}
	if err != nil {
		return AIResult{}, err
	}

	if errMessage := formatTurnError(turn.Error); errMessage != "" {
		return AIResult{}, fmt.Errorf("ai turn failed: %s", errMessage)
	}

	messages := collectBotVisibleMessages(turn)
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

	var settleTimer *time.Timer
	var settleCh <-chan time.Time
	defer stopTimer(settleTimer)

	for {
		detail, err := b.threads.GetDetail(ctx, workspaceID, threadID)
		if err == nil {
			if turn, ok := findThreadTurn(detail, turnID); ok {
				if strings.EqualFold(strings.TrimSpace(turn.Status), "completed") {
					if settleCh == nil {
						resetTimer(&settleTimer, &settleCh, b.turnSettleDelay)
					}
				}
			}
		}

		select {
		case <-ctx.Done():
			return store.ThreadTurn{}, ctx.Err()
		case <-settleCh:
			if turn, ok := b.lookupCompletedTurn(ctx, workspaceID, threadID, turnID); ok {
				return turn, nil
			}
			settleCh = nil
			settleTimer = nil
		case <-ticker.C:
		}
	}
}

func (b *workspaceThreadAIBackend) waitForTurnStream(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnID string,
	eventCh <-chan store.EventEnvelope,
	handle StreamingUpdateHandler,
) (store.ThreadTurn, error) {
	streamTicker := time.NewTicker(b.streamFlushInterval)
	defer streamTicker.Stop()

	pollTicker := time.NewTicker(b.pollInterval)
	defer pollTicker.Stop()

	stream := botVisibleItemStream{}
	var settleTimer *time.Timer
	var settleCh <-chan time.Time
	defer stopTimer(settleTimer)

	for {
		select {
		case <-ctx.Done():
			return store.ThreadTurn{}, ctx.Err()
		case <-settleCh:
			if turn, ok := b.lookupCompletedTurn(ctx, workspaceID, threadID, turnID); ok {
				turn.Items = stream.reorderCompletedTurnItems(turn.Items)
				if err := stream.Flush(ctx, handle); err != nil {
					return store.ThreadTurn{}, err
				}
				return turn, nil
			}
			settleCh = nil
			settleTimer = nil
		case <-streamTicker.C:
			if err := stream.Flush(ctx, handle); err != nil {
				return store.ThreadTurn{}, err
			}
		case <-pollTicker.C:
			if turn, ok := b.lookupCompletedTurn(ctx, workspaceID, threadID, turnID); ok {
				_ = turn
				if settleCh == nil {
					resetTimer(&settleTimer, &settleCh, b.turnSettleDelay)
				}
			}
		case event, ok := <-eventCh:
			if !ok {
				eventCh = nil
				continue
			}
			if !matchesTurnEvent(event, threadID, turnID) {
				continue
			}

			flushImmediately := false
			switch event.Method {
			case "item/agentMessage/delta":
				payload := objectValue(event.Payload)
				stream.AddTextDelta(strings.TrimSpace(stringValue(payload["itemId"])), "agentMessage", stringValue(payload["delta"]))
				flushImmediately = len(stream.lastEmitted) == 0
			case "item/plan/delta":
				payload := objectValue(event.Payload)
				stream.AddTextDelta(strings.TrimSpace(stringValue(payload["itemId"])), "plan", stringValue(payload["delta"]))
				flushImmediately = len(stream.lastEmitted) == 0
			case "item/commandExecution/outputDelta":
				payload := objectValue(event.Payload)
				stream.AddOutputDelta(strings.TrimSpace(stringValue(payload["itemId"])), stringValue(payload["delta"]))
				flushImmediately = len(stream.lastEmitted) == 0
			case "item/started", "item/completed":
				payload := objectValue(event.Payload)
				item := objectValue(payload["item"])
				stream.MergeItem(item)
				flushImmediately = len(stream.lastEmitted) == 0
			case "server/request/resolved", "server/request/expired":
				if stream.ApplyServerRequestEvent(event) {
					flushImmediately = len(stream.lastEmitted) == 0
				}
			case "turn/completed":
				resetTimer(&settleTimer, &settleCh, b.turnSettleDelay)
			default:
				if isBotVisibleServerRequestEvent(event) && stream.ApplyServerRequestEvent(event) {
					flushImmediately = len(stream.lastEmitted) == 0
				}
			}

			if stream.dirty && settleCh != nil {
				resetTimer(&settleTimer, &settleCh, b.turnSettleDelay)
			}
			if flushImmediately {
				if err := stream.Flush(ctx, handle); err != nil {
					return store.ThreadTurn{}, err
				}
			}
		}
	}
}

func (b *workspaceThreadAIBackend) lookupCompletedTurn(
	ctx context.Context,
	workspaceID string,
	threadID string,
	turnID string,
) (store.ThreadTurn, bool) {
	detail, err := b.threads.GetDetail(ctx, workspaceID, threadID)
	if err != nil {
		return store.ThreadTurn{}, false
	}

	turn, ok := findThreadTurn(detail, turnID)
	if !ok {
		return store.ThreadTurn{}, false
	}
	if !strings.EqualFold(strings.TrimSpace(turn.Status), "completed") {
		return store.ThreadTurn{}, false
	}

	return turn, true
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

func collectBotVisibleMessages(turn store.ThreadTurn) []OutboundMessage {
	items := make([]OutboundMessage, 0)
	for _, item := range turn.Items {
		if !isBotVisibleItemType(strings.TrimSpace(stringValue(item["type"]))) {
			continue
		}
		text := renderBotVisibleItem(item)
		if strings.TrimSpace(text) == "" {
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

func objectValue(value any) map[string]any {
	object, _ := value.(map[string]any)
	if object == nil {
		return map[string]any{}
	}
	return object
}

func matchesTurnEvent(event store.EventEnvelope, threadID string, turnID string) bool {
	if strings.TrimSpace(event.ThreadID) != "" && strings.TrimSpace(event.ThreadID) != strings.TrimSpace(threadID) {
		return false
	}

	eventTurnID := strings.TrimSpace(event.TurnID)
	if eventTurnID == "" {
		payload := objectValue(event.Payload)
		eventTurnID = firstNonEmpty(
			strings.TrimSpace(stringValue(payload["turnId"])),
			nestedObjectID(payload["turn"]),
		)
	}

	return eventTurnID == strings.TrimSpace(turnID)
}

func nestedObjectID(value any) string {
	object := objectValue(value)
	return strings.TrimSpace(stringValue(object["id"]))
}

type botVisibleItemStream struct {
	order       []string
	items       map[string]*botVisibleItemState
	lastEmitted []OutboundMessage
	dirty       bool
}

type botVisibleItemState struct {
	ItemType         string
	Text             string
	ReasoningSummary []string
	ReasoningContent []string
	Command          string
	AggregatedOutput string
	Raw              map[string]any
}

func (s *botVisibleItemStream) AddTextDelta(itemID string, itemType string, delta string) {
	if strings.TrimSpace(itemID) == "" || delta == "" {
		return
	}

	item := s.ensureItem(itemID, itemType)
	item.Text += delta
	item.Raw["text"] = item.Text
	s.dirty = true
}

func (s *botVisibleItemStream) AddReasoningDelta(itemID string, field string, index int, delta string) {
	if strings.TrimSpace(itemID) == "" || delta == "" {
		return
	}

	item := s.ensureItem(itemID, "reasoning")
	switch field {
	case "summary":
		item.ReasoningSummary = appendStringAtIndex(item.ReasoningSummary, index, delta)
		item.Raw["summary"] = stringArrayToAnySlice(item.ReasoningSummary)
	case "content":
		item.ReasoningContent = appendStringAtIndex(item.ReasoningContent, index, delta)
		item.Raw["content"] = stringArrayToAnySlice(item.ReasoningContent)
	default:
		return
	}
	s.dirty = true
}

func (s *botVisibleItemStream) AddOutputDelta(itemID string, delta string) {
	if strings.TrimSpace(itemID) == "" || delta == "" {
		return
	}

	item := s.ensureItem(itemID, "commandExecution")
	item.AggregatedOutput += delta
	item.Raw["aggregatedOutput"] = item.AggregatedOutput
	s.dirty = true
}

func (s *botVisibleItemStream) MergeItem(item map[string]any) {
	itemID := strings.TrimSpace(stringValue(item["id"]))
	itemType := strings.TrimSpace(stringValue(item["type"]))
	if itemID == "" || !isBotVisibleItemType(itemType) {
		return
	}

	target := s.ensureItem(itemID, itemType)
	target.Raw = mergeBotItemMap(target.Raw, item)
	switch itemType {
	case "agentMessage", "plan":
		text := stringValue(item["text"])
		if text != "" && target.Text != text {
			target.Text = text
			s.dirty = true
		}
	case "reasoning":
		summary := stringSliceValue(item["summary"])
		content := stringSliceValue(item["content"])
		if !equalStringSlices(target.ReasoningSummary, summary) && len(summary) > 0 {
			target.ReasoningSummary = summary
			s.dirty = true
		}
		if !equalStringSlices(target.ReasoningContent, content) && len(content) > 0 {
			target.ReasoningContent = content
			s.dirty = true
		}
	case "commandExecution":
		command := stringValue(item["command"])
		output := stringValue(item["aggregatedOutput"])
		if command != "" && target.Command != command {
			target.Command = command
			s.dirty = true
		}
		if output != "" && target.AggregatedOutput != output {
			target.AggregatedOutput = output
			s.dirty = true
		}
	}
}

func (s *botVisibleItemStream) ApplyServerRequestEvent(event store.EventEnvelope) bool {
	if !isBotVisibleServerRequestEvent(event) {
		return false
	}

	requestID := ""
	if event.ServerRequestID != nil {
		requestID = strings.TrimSpace(*event.ServerRequestID)
	}
	if requestID == "" {
		return false
	}

	itemID := "server-request-" + requestID
	target := s.ensureItem(itemID, "serverRequest")
	if target.Raw == nil {
		target.Raw = map[string]any{}
	}
	target.Raw["id"] = itemID
	target.Raw["type"] = "serverRequest"
	target.Raw["requestId"] = requestID

	payload := objectValue(event.Payload)
	switch event.Method {
	case "server/request/resolved":
		target.Raw["status"] = "resolved"
		if method := strings.TrimSpace(stringValue(payload["method"])); method != "" && stringValue(target.Raw["requestKind"]) == "" {
			target.Raw["requestKind"] = method
		}
	case "server/request/expired":
		target.Raw["status"] = "expired"
		if method := strings.TrimSpace(stringValue(payload["method"])); method != "" && stringValue(target.Raw["requestKind"]) == "" {
			target.Raw["requestKind"] = method
		}
		if reason := strings.TrimSpace(stringValue(payload["reason"])); reason != "" {
			target.Raw["expireReason"] = reason
		}
	default:
		target.Raw["status"] = firstNonEmpty(strings.TrimSpace(stringValue(target.Raw["status"])), "pending")
		target.Raw["requestKind"] = event.Method
		target.Raw["details"] = mergeBotItemMap(objectValue(target.Raw["details"]), payload)
	}

	s.dirty = true
	return true
}

func (s *botVisibleItemStream) Flush(ctx context.Context, handle StreamingUpdateHandler) error {
	if handle == nil || !s.dirty {
		return nil
	}

	messages := s.messages()
	s.dirty = false
	if len(messages) == 0 || equalOutboundMessages(messages, s.lastEmitted) {
		return nil
	}

	s.lastEmitted = cloneOutboundMessages(messages)
	return handle(ctx, StreamingUpdate{Messages: messages})
}

func (s *botVisibleItemStream) messages() []OutboundMessage {
	if len(s.order) == 0 {
		return nil
	}

	messages := make([]OutboundMessage, 0, len(s.order))
	for _, itemID := range s.order {
		item := s.items[itemID]
		if item == nil || !isBotVisibleItemType(strings.TrimSpace(item.ItemType)) {
			continue
		}
		text := strings.TrimSpace(renderBotVisibleItemState(item))
		if text == "" {
			continue
		}
		messages = append(messages, OutboundMessage{Text: text})
	}

	return messages
}

func (s *botVisibleItemStream) reorderCompletedTurnItems(items []map[string]any) []map[string]any {
	if len(items) == 0 || len(s.order) == 0 {
		return cloneBotVisibleItems(items)
	}

	ordered := make([]map[string]any, 0, len(items))
	used := make(map[int]struct{}, len(items))

	for _, itemID := range s.order {
		for index, item := range items {
			if _, ok := used[index]; ok {
				continue
			}
			if strings.TrimSpace(stringValue(item["id"])) != itemID {
				continue
			}
			ordered = append(ordered, mergeBotItemMap(nil, item))
			used[index] = struct{}{}
			break
		}
	}

	for index, item := range items {
		if _, ok := used[index]; ok {
			continue
		}
		ordered = append(ordered, mergeBotItemMap(nil, item))
	}

	return ordered
}

func (s *botVisibleItemStream) ensureItem(itemID string, itemType string) *botVisibleItemState {
	if s.items == nil {
		s.items = make(map[string]*botVisibleItemState)
	}

	if item, ok := s.items[itemID]; ok {
		if strings.TrimSpace(itemType) != "" && item.ItemType == "" {
			item.ItemType = itemType
		}
		if item.Raw == nil {
			item.Raw = map[string]any{
				"id":   itemID,
				"type": item.ItemType,
			}
		}
		return item
	}

	s.order = append(s.order, itemID)
	item := &botVisibleItemState{
		ItemType: itemType,
		Raw: map[string]any{
			"id":   itemID,
			"type": itemType,
		},
	}
	s.items[itemID] = item
	return item
}

func renderBotVisibleItemState(item *botVisibleItemState) string {
	if item == nil {
		return ""
	}

	renderItem := mergeBotItemMap(nil, item.Raw)
	renderItem["type"] = firstNonEmpty(strings.TrimSpace(item.ItemType), stringValue(renderItem["type"]))
	if item.Text != "" {
		renderItem["text"] = item.Text
	}
	if len(item.ReasoningSummary) > 0 {
		renderItem["summary"] = stringArrayToAnySlice(item.ReasoningSummary)
	}
	if len(item.ReasoningContent) > 0 {
		renderItem["content"] = stringArrayToAnySlice(item.ReasoningContent)
	}
	if item.Command != "" {
		renderItem["command"] = item.Command
	}
	if item.AggregatedOutput != "" {
		renderItem["aggregatedOutput"] = item.AggregatedOutput
	}
	return renderBotVisibleItem(renderItem)
}

func isBotVisibleItemType(itemType string) bool {
	switch strings.TrimSpace(itemType) {
	case "agentMessage", "plan", "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall", "serverRequest":
		return true
	default:
		return false
	}
}

func stringSliceValue(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		items := make([]string, 0, len(typed))
		for _, raw := range typed {
			text := strings.TrimSpace(stringValue(raw))
			if text == "" {
				continue
			}
			items = append(items, text)
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

	next := append([]string(nil), items...)
	for len(next) <= index {
		next = append(next, "")
	}
	next[index] += delta
	return next
}

func equalStringSlices(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func equalOutboundMessages(left []OutboundMessage, right []OutboundMessage) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].Text != right[index].Text {
			return false
		}
	}
	return true
}

func cloneOutboundMessages(messages []OutboundMessage) []OutboundMessage {
	if len(messages) == 0 {
		return nil
	}

	cloned := make([]OutboundMessage, len(messages))
	copy(cloned, messages)
	return cloned
}

func cloneBotVisibleItems(items []map[string]any) []map[string]any {
	if len(items) == 0 {
		return nil
	}

	cloned := make([]map[string]any, 0, len(items))
	for _, item := range items {
		cloned = append(cloned, mergeBotItemMap(nil, item))
	}
	return cloned
}

func stringArrayToAnySlice(items []string) []any {
	if len(items) == 0 {
		return nil
	}

	values := make([]any, 0, len(items))
	for _, item := range items {
		values = append(values, item)
	}
	return values
}

func mergeBotItemMap(base map[string]any, overlay map[string]any) map[string]any {
	next := make(map[string]any, len(base)+len(overlay))
	for key, value := range base {
		next[key] = value
	}
	for key, value := range overlay {
		next[key] = value
	}
	return next
}

func isBotVisibleServerRequestEvent(event store.EventEnvelope) bool {
	if event.ServerRequestID == nil || strings.TrimSpace(*event.ServerRequestID) == "" {
		return false
	}

	switch event.Method {
	case "server/request/resolved", "server/request/expired":
		return true
	default:
		return isBotVisibleServerRequestMethod(event.Method)
	}
}

func isBotVisibleServerRequestMethod(method string) bool {
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

func resetTimer(timer **time.Timer, timerCh *<-chan time.Time, delay time.Duration) {
	if delay <= 0 {
		return
	}

	if *timer == nil {
		*timer = time.NewTimer(delay)
		*timerCh = (*timer).C
		return
	}

	stopTimer(*timer)
	(*timer).Reset(delay)
	*timerCh = (*timer).C
}

func stopTimer(timer *time.Timer) {
	if timer == nil {
		return
	}
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
}
