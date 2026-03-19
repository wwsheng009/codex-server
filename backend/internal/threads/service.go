package threads

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store    *store.MemoryStore
	runtimes *runtime.Manager
}

func NewService(dataStore *store.MemoryStore, runtimeManager *runtime.Manager) *Service {
	return &Service{
		store:    dataStore,
		runtimes: runtimeManager,
	}
}

func (s *Service) List(ctx context.Context, workspaceID string) ([]store.Thread, error) {
	activeThreads, err := s.listByArchived(ctx, workspaceID, false)
	if err != nil {
		return nil, err
	}

	archivedThreads, err := s.listByArchived(ctx, workspaceID, true)
	if err != nil {
		return nil, err
	}

	items := append(activeThreads, archivedThreads...)
	items = mergeThreads(items, s.store.ListThreads(workspaceID))
	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items, nil
}

func (s *Service) Create(ctx context.Context, workspaceID string, name string) (store.Thread, error) {
	if strings.TrimSpace(name) == "" {
		return store.Thread{}, errors.New("thread name is required")
	}

	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/start", map[string]any{
		"approvalPolicy": "on-request",
		"cwd":            s.runtimes.RootPath(workspaceID),
		"sandbox":        "workspace-write",
	}, &response); err != nil {
		return store.Thread{}, err
	}

	threadID := stringValue(response.Thread["id"])
	if threadID == "" {
		return store.Thread{}, errors.New("thread/start returned empty thread id")
	}

	if _, err := s.Rename(ctx, workspaceID, threadID, name); err != nil {
		return store.Thread{}, err
	}

	thread, err := s.Get(ctx, workspaceID, threadID)
	if err != nil {
		return store.Thread{}, err
	}

	s.store.UpsertThread(thread)
	return thread, nil
}

func (s *Service) Get(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/read", map[string]any{
		"includeTurns": false,
		"threadId":     threadID,
	}, &response); err != nil {
		return store.Thread{}, err
	}

	thread := mapThread(workspaceID, response.Thread, isArchived(response.Thread))
	s.store.UpsertThread(thread)
	return thread, nil
}

func (s *Service) GetDetail(ctx context.Context, workspaceID string, threadID string) (store.ThreadDetail, error) {
	var response struct {
		Thread map[string]any `json:"thread"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "thread/read", map[string]any{
		"includeTurns": true,
		"threadId":     threadID,
	}, &response); err != nil {
		return store.ThreadDetail{}, err
	}

	thread := mapThread(workspaceID, response.Thread, isArchived(response.Thread))
	s.store.UpsertThread(thread)

	return store.ThreadDetail{
		Thread:  thread,
		Cwd:     stringValue(response.Thread["cwd"]),
		Preview: stringValue(response.Thread["preview"]),
		Path:    stringValue(response.Thread["path"]),
		Source:  stringValue(response.Thread["source"]),
		Turns:   mapTurns(response.Thread["turns"]),
	}, nil
}

func (s *Service) Resume(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
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
	s.store.UpsertThread(thread)
	return thread, nil
}

func (s *Service) Fork(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
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
	s.store.UpsertThread(thread)
	return thread, nil
}

func (s *Service) Archive(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
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
	s.store.UpsertThread(thread)
	return thread, nil
}

func (s *Service) Unarchive(ctx context.Context, workspaceID string, threadID string) (store.Thread, error) {
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
	s.store.UpsertThread(thread)
	return thread, nil
}

func (s *Service) Rename(ctx context.Context, workspaceID string, threadID string, name string) (store.Thread, error) {
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

	s.store.UpsertThread(thread)
	return thread, nil
}

func (s *Service) Rollback(ctx context.Context, workspaceID string, threadID string) error {
	return s.runtimes.Call(ctx, workspaceID, "thread/rollback", map[string]any{
		"numTurns": 1,
		"threadId": threadID,
	}, nil)
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
			s.store.UpsertThread(mapped)
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

func mapThread(workspaceID string, raw map[string]any, archived bool) store.Thread {
	return store.Thread{
		ID:          stringValue(raw["id"]),
		WorkspaceID: workspaceID,
		Name:        fallbackString(stringValue(raw["name"]), "Untitled Thread"),
		Status:      nestedType(raw["status"]),
		Archived:    archived,
		CreatedAt:   unixSeconds(raw["createdAt"]),
		UpdatedAt:   unixSeconds(raw["updatedAt"]),
	}
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

func normalizePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}

	path = strings.TrimPrefix(path, `\\?\`)
	path = filepath.Clean(path)

	return strings.ToLower(path)
}
