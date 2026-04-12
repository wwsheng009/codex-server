package store

import (
	"sort"
	"strings"
	"time"
)

func (s *MemoryStore) ListHookRuns(workspaceID string, threadID string) []HookRun {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]HookRun, 0)
	filterWorkspaceID := strings.TrimSpace(workspaceID)
	filterThreadID := strings.TrimSpace(threadID)
	for _, run := range s.hookRuns {
		if filterWorkspaceID != "" && run.WorkspaceID != filterWorkspaceID {
			continue
		}
		if filterThreadID != "" && run.ThreadID != filterThreadID {
			continue
		}
		items = append(items, cloneHookRun(run))
	}

	sort.Slice(items, func(i int, j int) bool {
		left := hookRunSortTime(items[i])
		right := hookRunSortTime(items[j])
		switch {
		case left.Equal(right):
			return items[i].ID > items[j].ID
		default:
			return left.After(right)
		}
	})

	return items
}

func (s *MemoryStore) UpsertHookRun(run HookRun) (HookRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[run.WorkspaceID]; !ok {
		return HookRun{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(run.ID) == "" {
		run.ID = NewID("hook")
	}
	run.WorkspaceID = strings.TrimSpace(run.WorkspaceID)
	run.ThreadID = strings.TrimSpace(run.ThreadID)
	run.TurnID = strings.TrimSpace(run.TurnID)
	run.ItemID = strings.TrimSpace(run.ItemID)
	run.EventName = strings.TrimSpace(run.EventName)
	run.HandlerKey = strings.TrimSpace(run.HandlerKey)
	run.HandlerType = strings.TrimSpace(run.HandlerType)
	run.Provider = strings.TrimSpace(run.Provider)
	run.ExecutionMode = strings.TrimSpace(run.ExecutionMode)
	run.Scope = strings.TrimSpace(run.Scope)
	run.TriggerMethod = strings.TrimSpace(run.TriggerMethod)
	run.SessionStartSource = strings.TrimSpace(run.SessionStartSource)
	run.ToolKind = strings.TrimSpace(run.ToolKind)
	run.ToolName = strings.TrimSpace(run.ToolName)
	run.Status = strings.TrimSpace(run.Status)
	run.Decision = strings.TrimSpace(run.Decision)
	run.Reason = strings.TrimSpace(run.Reason)
	run.Fingerprint = strings.TrimSpace(run.Fingerprint)
	run.AdditionalContext = strings.TrimSpace(run.AdditionalContext)
	run.UpdatedInput = cloneAnyValue(run.UpdatedInput)
	run.Entries = cloneHookOutputEntries(run.Entries)
	run.Source = strings.TrimSpace(run.Source)
	run.Error = strings.TrimSpace(run.Error)
	if run.StartedAt.IsZero() {
		run.StartedAt = now
	}
	run.CompletedAt = cloneOptionalTime(run.CompletedAt)
	run.DurationMs = cloneOptionalInt64(run.DurationMs)

	s.hookRuns[run.ID] = run
	s.persistLocked()

	return cloneHookRun(run), nil
}

func cloneHookRun(run HookRun) HookRun {
	run.UpdatedInput = cloneAnyValue(run.UpdatedInput)
	run.Entries = cloneHookOutputEntries(run.Entries)
	run.CompletedAt = cloneOptionalTime(run.CompletedAt)
	run.DurationMs = cloneOptionalInt64(run.DurationMs)
	return run
}

func cloneHookOutputEntries(entries []HookOutputEntry) []HookOutputEntry {
	if len(entries) == 0 {
		return nil
	}

	cloned := make([]HookOutputEntry, len(entries))
	copy(cloned, entries)
	return cloned
}

func hookRunSortTime(run HookRun) time.Time {
	if run.CompletedAt != nil && !run.CompletedAt.IsZero() {
		return *run.CompletedAt
	}
	return run.StartedAt
}
