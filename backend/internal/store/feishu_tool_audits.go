package store

import (
	"sort"
	"strings"
	"time"
)

const feishuToolAuditRetentionLimit = 500

func (s *MemoryStore) ListFeishuToolAuditRecords(workspaceID string, filter FeishuToolAuditFilter) []FeishuToolAuditRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	filterWorkspaceID := strings.TrimSpace(workspaceID)
	filterToolName := strings.TrimSpace(filter.ToolName)
	filterResult := strings.TrimSpace(filter.Result)

	items := make([]FeishuToolAuditRecord, 0)
	for _, record := range s.feishuToolAudits {
		if filterWorkspaceID != "" && record.WorkspaceID != filterWorkspaceID {
			continue
		}
		if filterToolName != "" && record.ToolName != filterToolName {
			continue
		}
		if filterResult != "" && record.Result != filterResult {
			continue
		}
		items = append(items, cloneFeishuToolAuditRecord(record))
	}

	sort.Slice(items, func(i int, j int) bool {
		switch {
		case items[i].CompletedAt.Equal(items[j].CompletedAt):
			return items[i].ID > items[j].ID
		default:
			return items[i].CompletedAt.After(items[j].CompletedAt)
		}
	})

	if filter.Limit > 0 && len(items) > filter.Limit {
		items = append([]FeishuToolAuditRecord(nil), items[:filter.Limit]...)
	}

	return items
}

func (s *MemoryStore) CreateFeishuToolAuditRecord(record FeishuToolAuditRecord) (FeishuToolAuditRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspaceID := strings.TrimSpace(record.WorkspaceID)
	if _, ok := s.workspaces[workspaceID]; !ok {
		return FeishuToolAuditRecord{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(record.ID) == "" {
		record.ID = NewID("fta")
	}
	record.WorkspaceID = workspaceID
	record.ThreadID = strings.TrimSpace(record.ThreadID)
	record.TurnID = strings.TrimSpace(record.TurnID)
	record.InvocationID = strings.TrimSpace(record.InvocationID)
	record.ToolName = strings.TrimSpace(record.ToolName)
	record.Action = strings.TrimSpace(record.Action)
	record.ActionKey = strings.TrimSpace(record.ActionKey)
	record.PrincipalType = strings.TrimSpace(record.PrincipalType)
	record.PrincipalID = strings.TrimSpace(record.PrincipalID)
	record.Result = strings.TrimSpace(record.Result)
	record.ErrorCode = strings.TrimSpace(record.ErrorCode)
	record.ErrorMessage = strings.TrimSpace(record.ErrorMessage)
	if record.StartedAt.IsZero() {
		record.StartedAt = now
	}
	if record.CompletedAt.IsZero() {
		record.CompletedAt = record.StartedAt
	}

	s.feishuToolAudits[record.ID] = record
	s.trimFeishuToolAuditsLocked(workspaceID)
	s.persistLocked()

	return cloneFeishuToolAuditRecord(record), nil
}

func (s *MemoryStore) trimFeishuToolAuditsLocked(workspaceID string) {
	if len(s.feishuToolAudits) <= feishuToolAuditRetentionLimit {
		return
	}

	records := make([]FeishuToolAuditRecord, 0)
	for _, record := range s.feishuToolAudits {
		if record.WorkspaceID != workspaceID {
			continue
		}
		records = append(records, record)
	}
	if len(records) <= feishuToolAuditRetentionLimit {
		return
	}

	sort.Slice(records, func(i int, j int) bool {
		switch {
		case records[i].CompletedAt.Equal(records[j].CompletedAt):
			return records[i].ID < records[j].ID
		default:
			return records[i].CompletedAt.Before(records[j].CompletedAt)
		}
	})

	excess := len(records) - feishuToolAuditRetentionLimit
	for index := 0; index < excess; index++ {
		delete(s.feishuToolAudits, records[index].ID)
	}
}

func cloneFeishuToolAuditRecord(record FeishuToolAuditRecord) FeishuToolAuditRecord {
	return record
}
