package threads

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"codex-server/backend/internal/bridge"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store    *store.MemoryStore
	runtimes *runtime.Manager
}

type CreateInput struct {
	Name             string
	Model            string
	PermissionPreset string
}

func NewService(dataStore *store.MemoryStore, runtimeManager *runtime.Manager) *Service {
	return &Service{
		store:    dataStore,
		runtimes: runtimeManager,
	}
}

func (s *Service) List(ctx context.Context, workspaceID string) ([]store.Thread, error) {
	rootPath := normalizePath(s.runtimes.RootPath(workspaceID))
	activeThreads, err := s.listByArchived(ctx, workspaceID, false)
	if err != nil {
		return nil, err
	}

	archivedThreads, err := s.listByArchived(ctx, workspaceID, true)
	if err != nil {
		return nil, err
	}

	items := append(activeThreads, archivedThreads...)
	items = mergeThreads(items, filterStoredThreads(s.store.ListThreads(workspaceID), rootPath))
	items = filterDeletedThreads(items, workspaceID, s.store)
	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items, nil
}

func (s *Service) Create(ctx context.Context, workspaceID string, input CreateInput) (store.Thread, error) {
	if strings.TrimSpace(input.Name) == "" {
		return store.Thread{}, errors.New("thread name is required")
	}

	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/start", buildThreadStartPayload(s.runtimes.RootPath(workspaceID), input), &response); err != nil {
		return store.Thread{}, err
	}

	threadID := stringValue(response.Thread["id"])
	if threadID == "" {
		return store.Thread{}, errors.New("thread/start returned empty thread id")
	}

	if _, err := s.Rename(ctx, workspaceID, threadID, input.Name); err != nil {
		return store.Thread{}, err
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}

	return thread, nil
}

func buildThreadStartPayload(rootPath string, input CreateInput) map[string]any {
	payload := map[string]any{
		"approvalPolicy": "on-request",
		"cwd":            rootPath,
		"sandbox":        "workspace-write",
	}

	if model := strings.TrimSpace(input.Model); model != "" {
		payload["model"] = model
	}

	switch normalizePermissionPreset(input.PermissionPreset) {
	case "full-access":
		payload["approvalPolicy"] = "never"
		payload["sandbox"] = "danger-full-access"
	}

	return payload
}

func normalizePermissionPreset(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "full-access":
		return "full-access"
	default:
		return "default"
	}
}

func (s *Service) Get(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	threadData, err := s.readThread(ctx, workspaceID, threadID, false)
	if err != nil {
		return store.Thread{}, err
	}
	if !threadBelongsToWorkspace(threadData, normalizePath(s.runtimes.RootPath(workspaceID))) {
		return store.Thread{}, store.ErrThreadNotFound
	}

	thread := mapThread(workspaceID, threadData, isArchived(threadData))
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) GetDetail(ctx context.Context, workspaceID string, threadID string) (store.ThreadDetail, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.ThreadDetail{}, err
	}

	threadData, err := s.readThread(ctx, workspaceID, threadID, true)
	if err != nil {
		if !isThreadTurnsUnavailableBeforeFirstUserMessage(err) {
			return store.ThreadDetail{}, err
		}

		threadData, err = s.readThread(ctx, workspaceID, threadID, false)
		if err != nil {
			return store.ThreadDetail{}, err
		}
	}
	if !threadBelongsToWorkspace(threadData, normalizePath(s.runtimes.RootPath(workspaceID))) {
		return store.ThreadDetail{}, store.ErrThreadNotFound
	}

	thread := mapThread(workspaceID, threadData, isArchived(threadData))
	s.cacheThread(thread)

	turns := mapTurns(threadData["turns"])
	if turns == nil {
		turns = []store.ThreadTurn{}
	}

	detail := store.ThreadDetail{
		Thread:     thread,
		Cwd:        stringValue(threadData["cwd"]),
		Preview:    stringValue(threadData["preview"]),
		Path:       stringValue(threadData["path"]),
		Source:     stringValue(threadData["source"]),
		TokenUsage: mapThreadTokenUsage(threadData["tokenUsage"]),
		Turns:      turns,
	}

	return applyStoredProjection(detail, s.store, s.runtimes, workspaceID, threadID), nil
}

func (s *Service) readThread(ctx context.Context, workspaceID string, threadID string, includeTurns bool) (map[string]any, error) {
	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/read", map[string]any{
		"includeTurns": includeTurns,
		"threadId":     threadID,
	}, &response); err != nil {
		return nil, err
	}

	return response.Thread, nil
}

func (s *Service) ListLoaded(ctx context.Context, workspaceID string) ([]string, error) {
	var response struct {
		Data []string `json:"data"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/loaded/list", map[string]any{
		"limit": 200,
	}, &response); err != nil {
		return nil, err
	}

	return response.Data, nil
}

func (s *Service) UpdateMetadata(ctx context.Context, workspaceID string, threadID string, gitInfo map[string]any) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	var response struct {
		Thread map[string]any `json:"thread"`
	}

	params := map[string]any{
		"threadId": threadID,
	}
	if len(gitInfo) > 0 {
		params["gitInfo"] = gitInfo
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/metadata/update", params, &response); err != nil {
		return store.Thread{}, err
	}

	thread := mapThread(workspaceID, response.Thread, isArchived(response.Thread))
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Compact(ctx context.Context, workspaceID string, threadID string) error {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return err
	}

	return s.runtimes.Call(ctx, workspaceID, "thread/compact/start", map[string]any{
		"threadId": threadID,
	}, nil)
}

func (s *Service) Resume(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/resume", map[string]any{
		"cwd":      s.runtimes.RootPath(workspaceID),
		"threadId": threadID,
	}, &response); err != nil {
		return store.Thread{}, err
	}

	thread := mapThread(workspaceID, response.Thread, isArchived(response.Thread))
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Fork(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/fork", map[string]any{
		"cwd":      s.runtimes.RootPath(workspaceID),
		"threadId": threadID,
	}, &response); err != nil {
		return store.Thread{}, err
	}

	thread := mapThread(workspaceID, response.Thread, false)
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Archive(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/archive", map[string]any{
		"threadId": threadID,
	}, nil); err != nil {
		return store.Thread{}, err
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}

	thread.Archived = true
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Unarchive(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/unarchive", map[string]any{
		"threadId": threadID,
	}, nil); err != nil {
		return store.Thread{}, err
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}

	thread.Archived = false
	s.cacheThread(thread)
	return thread, nil
}

func (s *Service) Rename(ctx context.Context, workspaceID string, threadID string, name string) (store.Thread, error) {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return store.Thread{}, err
	}

	if strings.TrimSpace(name) == "" {
		return store.Thread{}, errors.New("thread name is required")
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/name/set", map[string]any{
		"name":     name,
		"threadId": threadID,
	}, nil); err != nil {
		return store.Thread{}, err
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}

	return thread, nil
}

func (s *Service) Rollback(ctx context.Context, workspaceID string, threadID string) error {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return err
	}

	return s.runtimes.Call(ctx, workspaceID, "thread/rollback", map[string]any{
		"numTurns": 1,
		"threadId": threadID,
	}, nil)
}

func (s *Service) Delete(ctx context.Context, workspaceID string, threadID string) error {
	if err := s.ensureThreadNotDeleted(workspaceID, threadID); err != nil {
		return err
	}

	if _, ok := s.store.GetWorkspace(workspaceID); !ok {
		return store.ErrWorkspaceNotFound
	}

	if _, ok := s.store.GetThread(workspaceID, threadID); !ok {
		if _, err := s.Get(ctx, workspaceID, threadID); err != nil {
			return err
		}
	}

	state := s.runtimes.State(workspaceID).Status
	if state == "ready" || state == "active" || state == "connected" {
		var response struct {
			Status string `json:"status"`
		}
		_ = s.runtimes.Call(ctx, workspaceID, "thread/unsubscribe", map[string]any{
			"threadId": threadID,
		}, &response)
	}

	return s.store.DeleteThread(workspaceID, threadID)
}

func (s *Service) listByArchived(ctx context.Context, workspaceID string, archived bool) ([]store.Thread, error) {
	rootPath := normalizePath(s.runtimes.RootPath(workspaceID))
	cursor := ""
	items := make([]store.Thread, 0)

	for page := 0; page < 20; page++ {
		var response struct {
			Data       []map[string]any `json:"data"`
			NextCursor *string          `json:"nextCursor"`
		}

		params := map[string]any{
			"archived": archived,
			"limit":    200,
		}
		if cursor != "" {
			params["cursor"] = cursor
		}

		if err := s.runtimes.Call(ctx, workspaceID, "thread/list", params, &response); err != nil {
			return nil, err
		}

		for _, thread := range response.Data {
			if !threadBelongsToWorkspace(thread, rootPath) {
				continue
			}

			mapped := mapThread(workspaceID, thread, archived)
			if s.store.IsThreadDeleted(workspaceID, mapped.ID) {
				continue
			}
			s.cacheThread(mapped)
			items = append(items, mapped)
		}

		if response.NextCursor == nil || strings.TrimSpace(*response.NextCursor) == "" {
			break
		}

		cursor = *response.NextCursor
	}

	return items, nil
}

func mergeThreads(primary []store.Thread, secondary []store.Thread) []store.Thread {
	byID := make(map[string]store.Thread, len(primary)+len(secondary))
	for _, thread := range secondary {
		byID[thread.ID] = thread
	}
	for _, thread := range primary {
		byID[thread.ID] = thread
	}

	items := make([]store.Thread, 0, len(byID))
	for _, thread := range byID {
		items = append(items, thread)
	}

	return items
}

func filterStoredThreads(items []store.Thread, workspaceRoot string) []store.Thread {
	filtered := make([]store.Thread, 0, len(items))
	for _, thread := range items {
		if storedThreadBelongsToWorkspace(thread, workspaceRoot) && thread.Materialized {
			filtered = append(filtered, thread)
		}
	}

	return filtered
}

func filterDeletedThreads(items []store.Thread, workspaceID string, dataStore *store.MemoryStore) []store.Thread {
	filtered := make([]store.Thread, 0, len(items))
	for _, thread := range items {
		if dataStore.IsThreadDeleted(workspaceID, thread.ID) {
			continue
		}
		filtered = append(filtered, thread)
	}

	return filtered
}

func mapTurns(value any) []store.ThreadTurn {
	rawTurns, ok := value.([]any)
	if !ok {
		return nil
	}

	turns := make([]store.ThreadTurn, 0, len(rawTurns))
	for _, rawTurn := range rawTurns {
		turnObject, ok := rawTurn.(map[string]any)
		if !ok {
			continue
		}

		items := make([]map[string]any, 0)
		if rawItems, ok := turnObject["items"].([]any); ok {
			for _, rawItem := range rawItems {
				if item, ok := rawItem.(map[string]any); ok {
					items = append(items, item)
				}
			}
		}

		turns = append(turns, store.ThreadTurn{
			ID:     stringValue(turnObject["id"]),
			Status: stringValue(turnObject["status"]),
			Items:  items,
			Error:  turnObject["error"],
		})
	}

	return turns
}

func mapThreadTokenUsage(value any) *store.ThreadTokenUsage {
	rawUsage, ok := value.(map[string]any)
	if !ok {
		return nil
	}

	total, ok := rawUsage["total"].(map[string]any)
	if !ok {
		return nil
	}

	last, _ := rawUsage["last"].(map[string]any)
	if last == nil {
		last = map[string]any{}
	}

	usage := &store.ThreadTokenUsage{
		Last: store.TokenUsageBreakdown{
			CachedInputTokens:     int64Value(last["cachedInputTokens"]),
			InputTokens:           int64Value(last["inputTokens"]),
			OutputTokens:          int64Value(last["outputTokens"]),
			ReasoningOutputTokens: int64Value(last["reasoningOutputTokens"]),
			TotalTokens:           int64Value(last["totalTokens"]),
		},
		Total: store.TokenUsageBreakdown{
			CachedInputTokens:     int64Value(total["cachedInputTokens"]),
			InputTokens:           int64Value(total["inputTokens"]),
			OutputTokens:          int64Value(total["outputTokens"]),
			ReasoningOutputTokens: int64Value(total["reasoningOutputTokens"]),
			TotalTokens:           int64Value(total["totalTokens"]),
		},
	}

	if modelContextWindow := int64Value(rawUsage["modelContextWindow"]); modelContextWindow > 0 {
		usage.ModelContextWindow = &modelContextWindow
	}

	return usage
}

func applyStoredProjection(
	detail store.ThreadDetail,
	dataStore *store.MemoryStore,
	runtimes *runtime.Manager,
	workspaceID string,
	threadID string,
) store.ThreadDetail {
	projection, ok := dataStore.GetThreadProjection(workspaceID, threadID)
	if !ok {
		return detail
	}

	if projection.Status != "" {
		detail.Status = projection.Status
	}
	if projection.TokenUsage != nil {
		detail.TokenUsage = projection.TokenUsage
	}
	if projection.UpdatedAt.After(detail.UpdatedAt) {
		detail.UpdatedAt = projection.UpdatedAt
	}
	detail.Turns = mergeProjectedTurns(detail.Turns, projection.Turns)
	detail.Turns = reconcileServerRequestStatuses(detail.Turns, runtimes)

	return detail
}

func mergeProjectedTurns(base []store.ThreadTurn, overlay []store.ThreadTurn) []store.ThreadTurn {
	if len(overlay) == 0 {
		return base
	}

	nextTurns := append([]store.ThreadTurn{}, base...)
	for _, projectedTurn := range overlay {
		index := -1
		for turnIndex, turn := range nextTurns {
			if turn.ID == projectedTurn.ID {
				index = turnIndex
				break
			}
		}

		if index < 0 {
			nextTurns = append(nextTurns, cloneThreadTurn(projectedTurn))
			continue
		}

		nextTurns[index] = mergeProjectedTurn(nextTurns[index], projectedTurn)
	}

	return nextTurns
}

func mergeProjectedTurn(base store.ThreadTurn, overlay store.ThreadTurn) store.ThreadTurn {
	next := cloneThreadTurn(base)
	if overlay.Status != "" {
		next.Status = overlay.Status
	}
	if overlay.Error != nil {
		next.Error = overlay.Error
	}
	next.Items = mergeProjectedItems(next.Items, overlay.Items)
	return next
}

func mergeProjectedItems(base []map[string]any, overlay []map[string]any) []map[string]any {
	if len(overlay) == 0 {
		return cloneItems(base)
	}

	nextItems := cloneItems(base)
	for _, projectedItem := range overlay {
		itemID := stringValue(projectedItem["id"])
		if itemID == "" {
			nextItems = append(nextItems, cloneItem(projectedItem))
			continue
		}

		index := -1
		for itemIndex, item := range nextItems {
			if stringValue(item["id"]) == itemID {
				index = itemIndex
				break
			}
		}

		if index < 0 {
			nextItems = append(nextItems, cloneItem(projectedItem))
			continue
		}

		nextItems[index] = mergeProjectedItem(nextItems[index], projectedItem)
	}

	return nextItems
}

func mergeProjectedItem(base map[string]any, overlay map[string]any) map[string]any {
	next := cloneItem(base)
	for key, value := range overlay {
		next[key] = value
	}

	if stringValue(overlay["type"]) == "agentMessage" && stringValue(overlay["text"]) == "" && stringValue(base["text"]) != "" {
		next["text"] = base["text"]
	}
	if stringValue(overlay["type"]) == "plan" && stringValue(overlay["text"]) == "" && stringValue(base["text"]) != "" {
		next["text"] = base["text"]
	}
	if stringValue(overlay["type"]) == "commandExecution" &&
		stringValue(overlay["aggregatedOutput"]) == "" &&
		stringValue(base["aggregatedOutput"]) != "" {
		next["aggregatedOutput"] = base["aggregatedOutput"]
	}

	return next
}

func reconcileServerRequestStatuses(
	turns []store.ThreadTurn,
	runtimes *runtime.Manager,
) []store.ThreadTurn {
	if len(turns) == 0 {
		return turns
	}

	nextTurns := append([]store.ThreadTurn{}, turns...)
	for turnIndex, turn := range nextTurns {
		nextItems := cloneItems(turn.Items)
		changed := false

		for itemIndex, item := range nextItems {
			if stringValue(item["type"]) != "serverRequest" {
				continue
			}
			if stringValue(item["status"]) != "pending" {
				continue
			}

			requestID := stringValue(item["requestId"])
			if requestID == "" {
				continue
			}
			if _, ok := runtimes.GetPendingRequest(requestID); ok {
				continue
			}

			nextItems[itemIndex]["status"] = "expired"
			if stringValue(nextItems[itemIndex]["expireReason"]) == "" {
				nextItems[itemIndex]["expireReason"] = "request_unavailable"
			}
			changed = true
		}

		if changed {
			nextTurns[turnIndex].Items = nextItems
		}
	}

	return nextTurns
}

func cloneThreadTurn(turn store.ThreadTurn) store.ThreadTurn {
	return store.ThreadTurn{
		ID:     turn.ID,
		Status: turn.Status,
		Items:  cloneItems(turn.Items),
		Error:  turn.Error,
	}
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

func mapThread(workspaceID string, raw map[string]any, archived bool) store.Thread {
	return store.Thread{
		ID:           stringValue(raw["id"]),
		WorkspaceID:  workspaceID,
		Cwd:          stringValue(raw["cwd"]),
		Materialized: threadIsMaterialized(raw),
		Name:         threadDisplayName(raw),
		Status:       nestedType(raw["status"]),
		Archived:     archived,
		CreatedAt:    unixSeconds(raw["createdAt"]),
		UpdatedAt:    unixSeconds(raw["updatedAt"]),
	}
}

func threadDisplayName(raw map[string]any) string {
	if name := strings.TrimSpace(stringValue(raw["name"])); name != "" {
		return name
	}

	preview := strings.TrimSpace(stringValue(raw["preview"]))
	if preview == "" {
		return "Untitled Thread"
	}

	preview = strings.ReplaceAll(preview, "\r\n", "\n")
	preview = strings.ReplaceAll(preview, "\r", "\n")

	firstLine := preview
	if newline := strings.Index(firstLine, "\n"); newline >= 0 {
		firstLine = firstLine[:newline]
	}

	firstLine = strings.TrimSpace(firstLine)
	if firstLine == "" {
		return "Untitled Thread"
	}

	const maxRunes = 80
	runes := []rune(firstLine)
	if len(runes) <= maxRunes {
		return firstLine
	}

	return strings.TrimSpace(string(runes[:maxRunes])) + "..."
}

func isArchived(raw map[string]any) bool {
	if archived, ok := raw["archived"].(bool); ok {
		return archived
	}

	return false
}

func nestedType(value any) string {
	object, ok := value.(map[string]any)
	if !ok {
		return "idle"
	}

	status := stringValue(object["type"])
	if status == "" {
		return "idle"
	}

	return status
}

func unixSeconds(value any) time.Time {
	switch typed := value.(type) {
	case float64:
		return time.Unix(int64(typed), 0).UTC()
	case int64:
		return time.Unix(typed, 0).UTC()
	case int:
		return time.Unix(int64(typed), 0).UTC()
	default:
		return time.Time{}
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
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

func fallbackString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}

	return value
}

func threadBelongsToWorkspace(raw map[string]any, workspaceRoot string) bool {
	threadCwd := normalizePath(stringValue(raw["cwd"]))
	if workspaceRoot == "" || threadCwd == "" {
		return false
	}

	return threadCwd == workspaceRoot || strings.HasPrefix(threadCwd, workspaceRoot+string(filepath.Separator))
}

func storedThreadBelongsToWorkspace(thread store.Thread, workspaceRoot string) bool {
	threadCwd := normalizePath(thread.Cwd)
	if workspaceRoot == "" || threadCwd == "" {
		return false
	}

	return threadCwd == workspaceRoot || strings.HasPrefix(threadCwd, workspaceRoot+string(filepath.Separator))
}

func normalizePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}

	path = strings.TrimPrefix(path, `\\?\`)
	path = filepath.Clean(path)

	return strings.ToLower(path)
}

func (s *Service) cacheThread(thread store.Thread) {
	if s.store.IsThreadDeleted(thread.WorkspaceID, thread.ID) {
		s.store.RemoveThread(thread.WorkspaceID, thread.ID)
		return
	}

	if !thread.Materialized {
		s.store.RemoveThread(thread.WorkspaceID, thread.ID)
		return
	}

	s.store.UpsertThread(thread)
}

func (s *Service) ensureThreadNotDeleted(workspaceID string, threadID string) error {
	if s.store.IsThreadDeleted(workspaceID, threadID) {
		return store.ErrThreadNotFound
	}

	return nil
}

func threadIsMaterialized(raw map[string]any) bool {
	if strings.TrimSpace(stringValue(raw["path"])) != "" {
		return true
	}

	if strings.TrimSpace(stringValue(raw["preview"])) != "" {
		return true
	}

	rawTurns, ok := raw["turns"].([]any)
	return ok && len(rawTurns) > 0
}

func isThreadTurnsUnavailableBeforeFirstUserMessage(err error) bool {
	var rpcErr *bridge.RPCError
	if !errors.As(err, &rpcErr) {
		return false
	}

	if rpcErr.Code != -32600 {
		return false
	}

	message := strings.ToLower(strings.TrimSpace(rpcErr.Message))
	return strings.Contains(message, "not materialized yet") &&
		strings.Contains(message, "before first user message")
}
