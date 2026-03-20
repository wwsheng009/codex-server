package store

import (
	"fmt"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type Workspace struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	RootPath      string    `json:"rootPath"`
	RuntimeStatus string    `json:"runtimeStatus"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type Thread struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspaceId"`
	Cwd          string    `json:"cwd,omitempty"`
	Materialized bool      `json:"materialized,omitempty"`
	Name         string    `json:"name"`
	Status       string    `json:"status"`
	Archived     bool      `json:"archived"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ThreadTurn struct {
	ID     string           `json:"id"`
	Status string           `json:"status"`
	Items  []map[string]any `json:"items"`
	Error  any              `json:"error,omitempty"`
}

type ThreadDetail struct {
	Thread
	Cwd     string       `json:"cwd,omitempty"`
	Preview string       `json:"preview,omitempty"`
	Path    string       `json:"path,omitempty"`
	Source  string       `json:"source,omitempty"`
	Turns   []ThreadTurn `json:"turns"`
}

type PendingApproval struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	ThreadID    string    `json:"threadId"`
	Kind        string    `json:"kind"`
	Summary     string    `json:"summary"`
	Status      string    `json:"status"`
	Actions     []string  `json:"actions"`
	Details     any       `json:"details,omitempty"`
	RequestedAt time.Time `json:"requestedAt"`
}

type Account struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Status       string    `json:"status"`
	LastSyncedAt time.Time `json:"lastSyncedAt"`
}

type RateLimit struct {
	Name      string    `json:"name"`
	Limit     int       `json:"limit"`
	Remaining int       `json:"remaining"`
	ResetsAt  time.Time `json:"resetsAt"`
}

type CommandSession struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Command     string    `json:"command"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type EventEnvelope struct {
	WorkspaceID     string    `json:"workspaceId"`
	ThreadID        string    `json:"threadId,omitempty"`
	TurnID          string    `json:"turnId,omitempty"`
	Method          string    `json:"method"`
	Payload         any       `json:"payload"`
	ServerRequestID *string   `json:"serverRequestId"`
	TS              time.Time `json:"ts"`
}

var idCounter atomic.Uint64

func NewID(prefix string) string {
	return fmt.Sprintf("%s_%06d", prefix, idCounter.Add(1))
}

func SeedIDCounter(minValue uint64) {
	for {
		current := idCounter.Load()
		if current >= minValue {
			return
		}

		if idCounter.CompareAndSwap(current, minValue) {
			return
		}
	}
}

func NumericIDSuffix(id string) uint64 {
	separatorIndex := strings.LastIndex(id, "_")
	if separatorIndex < 0 || separatorIndex == len(id)-1 {
		return 0
	}

	value, err := strconv.ParseUint(id[separatorIndex+1:], 10, 64)
	if err != nil {
		return 0
	}

	return value
}
