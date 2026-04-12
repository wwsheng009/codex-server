package store

import (
	"sort"
	"strings"
	"time"
)

func (s *MemoryStore) ListTurnPolicyDecisions(workspaceID string, threadID string) []TurnPolicyDecision {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]TurnPolicyDecision, 0)
	filterWorkspaceID := strings.TrimSpace(workspaceID)
	filterThreadID := strings.TrimSpace(threadID)
	for _, decision := range s.turnPolicyDecisions {
		if filterWorkspaceID != "" && decision.WorkspaceID != filterWorkspaceID {
			continue
		}
		if filterThreadID != "" && decision.ThreadID != filterThreadID {
			continue
		}
		items = append(items, cloneTurnPolicyDecision(decision))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].CompletedAt.Equal(items[j].CompletedAt) {
			return items[i].ID > items[j].ID
		}
		return items[i].CompletedAt.After(items[j].CompletedAt)
	})

	return items
}

func (s *MemoryStore) GetTurnPolicyDecisionByFingerprint(
	workspaceID string,
	threadID string,
	fingerprint string,
) (TurnPolicyDecision, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	filterWorkspaceID := strings.TrimSpace(workspaceID)
	filterThreadID := strings.TrimSpace(threadID)
	filterFingerprint := strings.TrimSpace(fingerprint)
	if filterWorkspaceID == "" || filterThreadID == "" || filterFingerprint == "" {
		return TurnPolicyDecision{}, false
	}

	var newest TurnPolicyDecision
	found := false
	for _, decision := range s.turnPolicyDecisions {
		if decision.WorkspaceID != filterWorkspaceID ||
			decision.ThreadID != filterThreadID ||
			decision.Fingerprint != filterFingerprint {
			continue
		}
		if !found || decision.CompletedAt.After(newest.CompletedAt) ||
			(decision.CompletedAt.Equal(newest.CompletedAt) && decision.ID > newest.ID) {
			newest = cloneTurnPolicyDecision(decision)
			found = true
		}
	}

	return newest, found
}

func (s *MemoryStore) CreateTurnPolicyDecision(decision TurnPolicyDecision) (TurnPolicyDecision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[decision.WorkspaceID]; !ok {
		return TurnPolicyDecision{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(decision.ID) == "" {
		decision.ID = NewID("tpd")
	}
	decision.WorkspaceID = strings.TrimSpace(decision.WorkspaceID)
	decision.ThreadID = strings.TrimSpace(decision.ThreadID)
	decision.TurnID = strings.TrimSpace(decision.TurnID)
	decision.ItemID = strings.TrimSpace(decision.ItemID)
	decision.TriggerMethod = strings.TrimSpace(decision.TriggerMethod)
	decision.PolicyName = strings.TrimSpace(decision.PolicyName)
	decision.Fingerprint = strings.TrimSpace(decision.Fingerprint)
	decision.Verdict = strings.TrimSpace(decision.Verdict)
	decision.Action = strings.TrimSpace(decision.Action)
	decision.ActionStatus = strings.TrimSpace(decision.ActionStatus)
	decision.ActionTurnID = strings.TrimSpace(decision.ActionTurnID)
	decision.Reason = strings.TrimSpace(decision.Reason)
	decision.EvidenceSummary = strings.TrimSpace(decision.EvidenceSummary)
	decision.Source = strings.TrimSpace(decision.Source)
	decision.Error = strings.TrimSpace(decision.Error)
	if decision.EvaluationStartedAt.IsZero() {
		decision.EvaluationStartedAt = now
	}
	if decision.DecisionAt.IsZero() {
		decision.DecisionAt = decision.EvaluationStartedAt
	}
	if decision.CompletedAt.IsZero() {
		decision.CompletedAt = decision.DecisionAt
	}

	s.turnPolicyDecisions[decision.ID] = decision
	s.persistLocked()

	return cloneTurnPolicyDecision(decision), nil
}

func cloneTurnPolicyDecision(decision TurnPolicyDecision) TurnPolicyDecision {
	return decision
}
