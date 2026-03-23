package store

import (
	"fmt"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type Workspace struct {
	ID                     string     `json:"id"`
	Name                   string     `json:"name"`
	RootPath               string     `json:"rootPath"`
	RuntimeStatus          string     `json:"runtimeStatus"`
	RuntimeConfigChangedAt *time.Time `json:"runtimeConfigChangedAt,omitempty"`
	CreatedAt              time.Time  `json:"createdAt"`
	UpdatedAt              time.Time  `json:"updatedAt"`
}

type RuntimePreferences struct {
	ModelCatalogPath            string            `json:"modelCatalogPath"`
	LocalShellModels            []string          `json:"localShellModels,omitempty"`
	DefaultShellType            string            `json:"defaultShellType,omitempty"`
	DefaultTerminalShell        string            `json:"defaultTerminalShell,omitempty"`
	ModelShellTypeOverrides     map[string]string `json:"modelShellTypeOverrides,omitempty"`
	DefaultTurnApprovalPolicy   string            `json:"defaultTurnApprovalPolicy,omitempty"`
	DefaultTurnSandboxPolicy    map[string]any    `json:"defaultTurnSandboxPolicy,omitempty"`
	DefaultCommandSandboxPolicy map[string]any    `json:"defaultCommandSandboxPolicy,omitempty"`
	UpdatedAt                   time.Time         `json:"updatedAt,omitempty"`
}

type Automation struct {
	ID            string     `json:"id"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Prompt        string     `json:"prompt"`
	WorkspaceID   string     `json:"workspaceId"`
	WorkspaceName string     `json:"workspaceName"`
	ThreadID      string     `json:"threadId,omitempty"`
	Schedule      string     `json:"schedule"`
	ScheduleLabel string     `json:"scheduleLabel"`
	Model         string     `json:"model"`
	Reasoning     string     `json:"reasoning"`
	Status        string     `json:"status"`
	NextRun       string     `json:"nextRun"`
	NextRunAt     *time.Time `json:"nextRunAt,omitempty"`
	LastRun       *time.Time `json:"lastRun"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type AutomationTemplate struct {
	ID          string    `json:"id"`
	Category    string    `json:"category"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Prompt      string    `json:"prompt"`
	IsBuiltIn   bool      `json:"isBuiltIn"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type AutomationRunLogEntry struct {
	ID        string    `json:"id"`
	TS        time.Time `json:"ts"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	EventType string    `json:"eventType,omitempty"`
}

type AutomationRun struct {
	ID              string                  `json:"id"`
	AutomationID    string                  `json:"automationId"`
	AutomationTitle string                  `json:"automationTitle"`
	WorkspaceID     string                  `json:"workspaceId"`
	WorkspaceName   string                  `json:"workspaceName"`
	ThreadID        string                  `json:"threadId,omitempty"`
	TurnID          string                  `json:"turnId,omitempty"`
	Trigger         string                  `json:"trigger"`
	Status          string                  `json:"status"`
	Summary         string                  `json:"summary,omitempty"`
	Error           string                  `json:"error,omitempty"`
	StartedAt       time.Time               `json:"startedAt"`
	FinishedAt      *time.Time              `json:"finishedAt,omitempty"`
	Logs            []AutomationRunLogEntry `json:"logs"`
}

type Notification struct {
	ID              string     `json:"id"`
	WorkspaceID     string     `json:"workspaceId"`
	WorkspaceName   string     `json:"workspaceName"`
	AutomationID    string     `json:"automationId,omitempty"`
	AutomationTitle string     `json:"automationTitle,omitempty"`
	RunID           string     `json:"runId,omitempty"`
	Kind            string     `json:"kind"`
	Title           string     `json:"title"`
	Message         string     `json:"message"`
	Level           string     `json:"level"`
	Read            bool       `json:"read"`
	CreatedAt       time.Time  `json:"createdAt"`
	ReadAt          *time.Time `json:"readAt,omitempty"`
}

type Thread struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspaceId"`
	Cwd          string    `json:"cwd,omitempty"`
	Materialized bool      `json:"materialized,omitempty"`
	Name         string    `json:"name"`
	Status       string    `json:"status"`
	Archived     bool      `json:"archived"`
	TurnCount    int       `json:"turnCount,omitempty"`
	MessageCount int       `json:"messageCount,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type DeletedThread struct {
	WorkspaceID string    `json:"workspaceId"`
	ThreadID    string    `json:"threadId"`
	DeletedAt   time.Time `json:"deletedAt"`
}

type ThreadTurn struct {
	ID     string           `json:"id"`
	Status string           `json:"status"`
	Items  []map[string]any `json:"items"`
	Error  any              `json:"error,omitempty"`
}

type TokenUsageBreakdown struct {
	CachedInputTokens     int64 `json:"cachedInputTokens"`
	InputTokens           int64 `json:"inputTokens"`
	OutputTokens          int64 `json:"outputTokens"`
	ReasoningOutputTokens int64 `json:"reasoningOutputTokens"`
	TotalTokens           int64 `json:"totalTokens"`
}

type ThreadTokenUsage struct {
	Last               TokenUsageBreakdown `json:"last"`
	Total              TokenUsageBreakdown `json:"total"`
	ModelContextWindow *int64              `json:"modelContextWindow,omitempty"`
}

type ThreadDetail struct {
	Thread
	Cwd          string            `json:"cwd,omitempty"`
	Preview      string            `json:"preview,omitempty"`
	Path         string            `json:"path,omitempty"`
	Source       string            `json:"source,omitempty"`
	TokenUsage   *ThreadTokenUsage `json:"tokenUsage,omitempty"`
	TurnCount    int               `json:"turnCount"`
	MessageCount int               `json:"messageCount,omitempty"`
	HasMoreTurns bool              `json:"hasMoreTurns,omitempty"`
	Turns        []ThreadTurn      `json:"turns"`
}

type ThreadProjection struct {
	WorkspaceID      string            `json:"workspaceId"`
	ThreadID         string            `json:"threadId"`
	Cwd              string            `json:"cwd,omitempty"`
	Preview          string            `json:"preview,omitempty"`
	Path             string            `json:"path,omitempty"`
	Source           string            `json:"source,omitempty"`
	Status           string            `json:"status,omitempty"`
	UpdatedAt        time.Time         `json:"updatedAt"`
	TokenUsage       *ThreadTokenUsage `json:"tokenUsage,omitempty"`
	TurnCount        int               `json:"turnCount,omitempty"`
	MessageCount     int               `json:"messageCount,omitempty"`
	SnapshotComplete bool              `json:"snapshotComplete,omitempty"`
	Turns            []ThreadTurn      `json:"turns"`
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
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspaceId"`
	Command      string    `json:"command"`
	Mode         string    `json:"mode,omitempty"`
	ShellPath    string    `json:"shellPath,omitempty"`
	InitialCwd   string    `json:"initialCwd,omitempty"`
	CurrentCwd   string    `json:"currentCwd,omitempty"`
	ShellState   string    `json:"shellState,omitempty"`
	LastExitCode *int      `json:"lastExitCode,omitempty"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

type CommandSessionSnapshot struct {
	CommandSession
	Archived       bool      `json:"archived,omitempty"`
	CombinedOutput string    `json:"combinedOutput"`
	Stdout         string    `json:"stdout"`
	Stderr         string    `json:"stderr"`
	ExitCode       *int      `json:"exitCode,omitempty"`
	Error          string    `json:"error,omitempty"`
	Pinned         bool      `json:"pinned,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
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
