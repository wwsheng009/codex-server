package store

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/diagnostics"
)

var (
	ErrWorkspaceNotFound                    = errors.New("workspace not found")
	ErrThreadNotFound                       = errors.New("thread not found")
	ErrApprovalNotFound                     = errors.New("approval not found")
	ErrAutomationNotFound                   = errors.New("automation not found")
	ErrAutomationTemplateNotFound           = errors.New("automation template not found")
	ErrAutomationRunNotFound                = errors.New("automation run not found")
	ErrNotificationNotFound                 = errors.New("notification not found")
	ErrNotificationSubscriptionNotFound     = errors.New("notification subscription not found")
	ErrNotificationEmailTargetNotFound      = errors.New("notification email target not found")
	ErrNotificationMailServerConfigNotFound = errors.New("notification mail server config not found")
	ErrNotificationDispatchNotFound         = errors.New("notification dispatch not found")
	ErrBotNotFound                          = errors.New("bot not found")
	ErrBotBindingNotFound                   = errors.New("bot binding not found")
	ErrThreadBotBindingNotFound             = errors.New("thread bot binding not found")
	ErrBotTriggerNotFound                   = errors.New("bot trigger not found")
	ErrBotConnectionNotFound                = errors.New("bot connection not found")
	ErrBotDeliveryTargetNotFound            = errors.New("bot delivery target not found")
	ErrWeChatAccountNotFound                = errors.New("wechat account not found")
	ErrBotConversationNotFound              = errors.New("bot conversation not found")
	ErrBotInboundDeliveryNotFound           = errors.New("bot inbound delivery not found")
	ErrBotOutboundDeliveryNotFound          = errors.New("bot outbound delivery not found")
)

const (
	commandSessionRetentionLimit      = 12
	commandSessionPinnedArchivedLimit = 24
	commandSessionCompletedTTL        = 24 * time.Hour
	botConnectionLogRetentionLimit    = 400
	workspaceEventRetentionLimit      = 2000
	persistentStoreFlushDebounce      = 250 * time.Millisecond
	threadProjectionCompressionMin    = 1024
	threadProjectionExternalizeMin    = 32 * 1024
	threadProjectionSidecarChunkSize  = 8
	threadProjectionSidecarVersion    = 1
)

type MemoryStore struct {
	mu                            sync.RWMutex
	path                          string
	flushCh                       chan struct{}
	flushStopCh                   chan struct{}
	flushCond                     *sync.Cond
	flushDirty                    bool
	flushQueued                   bool
	flushInProgress               bool
	flushClosed                   bool
	flushVersion                  uint64
	flushCompleted                uint64
	flushLastErr                  error
	flushWG                       sync.WaitGroup
	inspectionCache               MemoryInspection
	inspectionCacheValid          bool
	runtimePrefs                  RuntimePreferences
	workspaces                    map[string]Workspace
	commandSessions               map[string]map[string]CommandSessionSnapshot
	automations                   map[string]Automation
	templates                     map[string]AutomationTemplate
	runs                          map[string]AutomationRun
	notifications                 map[string]Notification
	notificationSubscriptions     map[string]NotificationSubscription
	notificationEmailTargets      map[string]NotificationEmailTarget
	notificationMailServerConfigs map[string]NotificationMailServerConfig
	notificationDispatches        map[string]NotificationDispatch
	turnPolicyDecisions           map[string]TurnPolicyDecision
	hookRuns                      map[string]HookRun
	bots                          map[string]Bot
	botBindings                   map[string]BotBinding
	threadBotBindings             map[string]ThreadBotBinding
	botTriggers                   map[string]BotTrigger
	botConnections                map[string]BotConnection
	botConnectionLogs             map[string][]BotConnectionLogEntry
	transientBotConnectionRuntime map[string]struct{}
	transientBotConnectionLogIDs  map[string]map[string]struct{}
	wechatAccounts                map[string]WeChatAccount
	botConversations              map[string]BotConversation
	botDeliveryTargets            map[string]BotDeliveryTarget
	botInbound                    map[string]BotInboundDelivery
	botInboundIndex               map[string]string
	botOutbound                   map[string]BotOutboundDelivery
	threads                       map[string]Thread
	pendingSessionStarts          map[string]string
	workspaceEventSeq             map[string]uint64
	workspaceEvents               map[string][]EventEnvelope
	projections                   map[string]threadProjectionRecord
	deleted                       map[string]DeletedThread
	approvals                     map[string]PendingApproval
}

var persistentStoreRegistry struct {
	mu     sync.Mutex
	stores map[string]*MemoryStore
}

type threadProjectionRecord struct {
	Projection      ThreadProjection
	TurnsRaw        json.RawMessage
	TurnsCompressed []byte
	TurnsPath       string
	TurnsRef        string
	TurnsManifest   *threadProjectionTurnsManifest
	Stats           threadProjectionStats
	StatsDirty      bool
	SnapshotBytes   int64
	SnapshotDirty   bool
}

type threadProjectionTurnsManifest struct {
	Version   int      `json:"version"`
	ChunkSize int      `json:"chunkSize"`
	ChunkRefs []string `json:"chunkRefs,omitempty"`
	TurnIDs   []string `json:"turnIds,omitempty"`
}

type storeSnapshot struct {
	RuntimePreferences            *RuntimePreferences            `json:"runtimePreferences,omitempty"`
	Workspaces                    []Workspace                    `json:"workspaces"`
	CommandSessions               []CommandSessionSnapshot       `json:"commandSessions,omitempty"`
	WorkspaceEvents               []storedWorkspaceEventLog      `json:"workspaceEvents,omitempty"`
	Automations                   []Automation                   `json:"automations,omitempty"`
	AutomationTemplates           []AutomationTemplate           `json:"automationTemplates,omitempty"`
	AutomationRuns                []AutomationRun                `json:"automationRuns,omitempty"`
	Notifications                 []Notification                 `json:"notifications,omitempty"`
	NotificationSubscriptions     []NotificationSubscription     `json:"notificationSubscriptions,omitempty"`
	NotificationEmailTargets      []NotificationEmailTarget      `json:"notificationEmailTargets,omitempty"`
	NotificationMailServerConfigs []NotificationMailServerConfig `json:"notificationMailServerConfigs,omitempty"`
	NotificationDispatches        []NotificationDispatch         `json:"notificationDispatches,omitempty"`
	TurnPolicyDecisions           []TurnPolicyDecision           `json:"turnPolicyDecisions,omitempty"`
	HookRuns                      []HookRun                      `json:"hookRuns,omitempty"`
	Bots                          []Bot                          `json:"bots,omitempty"`
	BotBindings                   []BotBinding                   `json:"botBindings,omitempty"`
	ThreadBotBindings             []ThreadBotBinding             `json:"threadBotBindings,omitempty"`
	BotTriggers                   []BotTrigger                   `json:"botTriggers,omitempty"`
	BotConnections                []BotConnection                `json:"botConnections,omitempty"`
	BotConnectionLogs             []BotConnectionLogEntry        `json:"botConnectionLogs,omitempty"`
	WeChatAccounts                []WeChatAccount                `json:"wechatAccounts,omitempty"`
	BotConversations              []BotConversation              `json:"botConversations,omitempty"`
	BotDeliveryTargets            []BotDeliveryTarget            `json:"botDeliveryTargets,omitempty"`
	BotInbound                    []BotInboundDelivery           `json:"botInbound,omitempty"`
	BotOutbound                   []BotOutboundDelivery          `json:"botOutbound,omitempty"`
	Threads                       []Thread                       `json:"threads"`
	ThreadProjections             []storedThreadProjection       `json:"threadProjections,omitempty"`
	DeletedThreads                []DeletedThread                `json:"deletedThreads,omitempty"`
}

type storedWorkspaceEventLog struct {
	WorkspaceID string          `json:"workspaceId"`
	NextSeq     uint64          `json:"nextSeq"`
	Events      []EventEnvelope `json:"events,omitempty"`
}

type storedThreadProjection struct {
	WorkspaceID      string                 `json:"workspaceId"`
	ThreadID         string                 `json:"threadId"`
	Cwd              string                 `json:"cwd,omitempty"`
	Preview          string                 `json:"preview,omitempty"`
	Path             string                 `json:"path,omitempty"`
	Source           string                 `json:"source,omitempty"`
	Status           string                 `json:"status,omitempty"`
	UpdatedAt        time.Time              `json:"updatedAt"`
	TokenUsage       *ThreadTokenUsage      `json:"tokenUsage,omitempty"`
	TurnCount        int                    `json:"turnCount,omitempty"`
	MessageCount     int                    `json:"messageCount,omitempty"`
	SnapshotComplete bool                   `json:"snapshotComplete,omitempty"`
	Stats            *threadProjectionStats `json:"stats,omitempty"`
	TurnsRef         string                 `json:"turnsRef,omitempty"`
	Turns            json.RawMessage        `json:"turns"`
}

func NewMemoryStore() *MemoryStore {
	store := &MemoryStore{
		workspaces:                    make(map[string]Workspace),
		commandSessions:               make(map[string]map[string]CommandSessionSnapshot),
		automations:                   make(map[string]Automation),
		templates:                     make(map[string]AutomationTemplate),
		runs:                          make(map[string]AutomationRun),
		notifications:                 make(map[string]Notification),
		notificationSubscriptions:     make(map[string]NotificationSubscription),
		notificationEmailTargets:      make(map[string]NotificationEmailTarget),
		notificationMailServerConfigs: make(map[string]NotificationMailServerConfig),
		notificationDispatches:        make(map[string]NotificationDispatch),
		turnPolicyDecisions:           make(map[string]TurnPolicyDecision),
		hookRuns:                      make(map[string]HookRun),
		bots:                          make(map[string]Bot),
		botBindings:                   make(map[string]BotBinding),
		threadBotBindings:             make(map[string]ThreadBotBinding),
		botTriggers:                   make(map[string]BotTrigger),
		botConnections:                make(map[string]BotConnection),
		botConnectionLogs:             make(map[string][]BotConnectionLogEntry),
		transientBotConnectionRuntime: make(map[string]struct{}),
		transientBotConnectionLogIDs:  make(map[string]map[string]struct{}),
		wechatAccounts:                make(map[string]WeChatAccount),
		botConversations:              make(map[string]BotConversation),
		botDeliveryTargets:            make(map[string]BotDeliveryTarget),
		botInbound:                    make(map[string]BotInboundDelivery),
		botInboundIndex:               make(map[string]string),
		botOutbound:                   make(map[string]BotOutboundDelivery),
		threads:                       make(map[string]Thread),
		pendingSessionStarts:          make(map[string]string),
		workspaceEventSeq:             make(map[string]uint64),
		workspaceEvents:               make(map[string][]EventEnvelope),
		projections:                   make(map[string]threadProjectionRecord),
		deleted:                       make(map[string]DeletedThread),
		approvals:                     make(map[string]PendingApproval),
	}

	store.flushCond = sync.NewCond(&store.mu)
	return store
}

func (s *MemoryStore) AppendWorkspaceEvent(event EventEnvelope) EventEnvelope {
	workspaceID := strings.TrimSpace(event.WorkspaceID)
	if workspaceID == "" {
		return event
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	nextSeq := s.workspaceEventSeq[workspaceID] + 1
	event.Seq = nextSeq
	event.Replay = false

	events := append(cloneEventEnvelopes(s.workspaceEvents[workspaceID]), event)
	if len(events) > workspaceEventRetentionLimit {
		events = append([]EventEnvelope(nil), events[len(events)-workspaceEventRetentionLimit:]...)
	}
	s.workspaceEvents[workspaceID] = events
	s.workspaceEventSeq[workspaceID] = nextSeq
	s.persistLocked()

	return event
}

func (s *MemoryStore) ListWorkspaceEventsAfter(workspaceID string, afterSeq uint64, limit int) []EventEnvelope {
	if limit <= 0 {
		limit = workspaceEventRetentionLimit
	}

	s.mu.RLock()
	events := cloneEventEnvelopes(s.workspaceEvents[workspaceID])
	s.mu.RUnlock()

	result := make([]EventEnvelope, 0, min(limit, len(events)))
	for _, event := range events {
		if event.Seq <= afterSeq {
			continue
		}

		cloned := event
		cloned.Replay = true
		result = append(result, cloned)
		if len(result) >= limit {
			break
		}
	}

	return result
}

func (s *MemoryStore) GetWorkspaceEventHeadSeq(workspaceID string) uint64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.workspaceEventSeq[workspaceID]
}

func (s *MemoryStore) ListCommandSessions(workspaceID string) []CommandSessionSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	workspaceSessions := s.commandSessions[workspaceID]
	if len(workspaceSessions) == 0 {
		return []CommandSessionSnapshot{}
	}

	items := make([]CommandSessionSnapshot, 0, len(workspaceSessions))
	for _, session := range workspaceSessions {
		items = append(items, session)
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) UpsertCommandSessionSnapshot(session CommandSessionSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspaceSessions := s.commandSessions[session.WorkspaceID]
	if workspaceSessions == nil {
		workspaceSessions = make(map[string]CommandSessionSnapshot)
		s.commandSessions[session.WorkspaceID] = workspaceSessions
	}

	workspaceSessions[session.ID] = session
	pruneCommandSessionsLocked(workspaceSessions)
	s.persistLocked()
}

func (s *MemoryStore) DeleteCommandSession(workspaceID string, processID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspaceSessions := s.commandSessions[workspaceID]
	if workspaceSessions == nil {
		return
	}

	delete(workspaceSessions, processID)
	if len(workspaceSessions) == 0 {
		delete(s.commandSessions, workspaceID)
	}

	s.persistLocked()
}

func (s *MemoryStore) SetCommandSessionPinned(
	workspaceID string,
	processID string,
	pinned bool,
) (CommandSessionSnapshot, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspaceSessions := s.commandSessions[workspaceID]
	if workspaceSessions == nil {
		return CommandSessionSnapshot{}, false
	}

	session, ok := workspaceSessions[processID]
	if !ok {
		return CommandSessionSnapshot{}, false
	}

	session.Pinned = pinned
	session.UpdatedAt = time.Now().UTC()
	workspaceSessions[processID] = session
	pruneCommandSessionsLocked(workspaceSessions)
	s.persistLocked()

	return session, true
}

func (s *MemoryStore) SetCommandSessionArchived(
	workspaceID string,
	processID string,
	archived bool,
) (CommandSessionSnapshot, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspaceSessions := s.commandSessions[workspaceID]
	if workspaceSessions == nil {
		return CommandSessionSnapshot{}, false
	}

	session, ok := workspaceSessions[processID]
	if !ok {
		return CommandSessionSnapshot{}, false
	}

	session.Archived = archived
	session.UpdatedAt = time.Now().UTC()
	workspaceSessions[processID] = session
	pruneCommandSessionsLocked(workspaceSessions)
	s.persistLocked()

	return session, true
}

func (s *MemoryStore) ClearCompletedCommandSessions(workspaceID string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspaceSessions := s.commandSessions[workspaceID]
	if workspaceSessions == nil {
		return []string{}
	}

	removed := make([]string, 0)
	for processID, session := range workspaceSessions {
		if session.Pinned || session.Archived {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(session.Status)) {
		case "running", "starting", "processing":
			continue
		default:
			delete(workspaceSessions, processID)
			removed = append(removed, processID)
		}
	}

	if len(workspaceSessions) == 0 {
		delete(s.commandSessions, workspaceID)
	}

	if len(removed) > 0 {
		s.persistLocked()
	}

	return removed
}

func (s *MemoryStore) MarkActiveCommandSessionsFailed(reason string) []CommandSessionSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	updated := make([]CommandSessionSnapshot, 0)
	for workspaceID, workspaceSessions := range s.commandSessions {
		for processID, session := range workspaceSessions {
			switch strings.ToLower(strings.TrimSpace(session.Status)) {
			case "running", "starting", "processing":
				session.Status = "failed"
				if session.Error == "" {
					session.Error = reason
				}
				session.UpdatedAt = now
				workspaceSessions[processID] = session
				updated = append(updated, session)
			}
		}
		if len(workspaceSessions) == 0 {
			delete(s.commandSessions, workspaceID)
		}
	}

	if len(updated) > 0 {
		s.persistLocked()
	}

	sort.Slice(updated, func(i int, j int) bool {
		return updated[i].UpdatedAt.After(updated[j].UpdatedAt)
	})

	return updated
}

func (s *MemoryStore) PruneExpiredCommandSessions(now time.Time) []CommandSessionSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	removed := make([]CommandSessionSnapshot, 0)
	for workspaceID, workspaceSessions := range s.commandSessions {
		for processID, session := range workspaceSessions {
			if session.Pinned || session.Archived {
				continue
			}
			if isCommandSessionActiveStatus(session.Status) {
				continue
			}
			if now.Sub(session.UpdatedAt) < commandSessionCompletedTTL {
				continue
			}

			removed = append(removed, session)
			delete(workspaceSessions, processID)
		}

		if len(workspaceSessions) == 0 {
			delete(s.commandSessions, workspaceID)
			continue
		}

		pruneCommandSessionsLocked(workspaceSessions)
	}

	if len(removed) > 0 {
		s.persistLocked()
	}

	return removed
}

func (s *MemoryStore) GetRuntimePreferences() RuntimePreferences {
	s.mu.RLock()
	defer s.mu.RUnlock()

	prefs := s.runtimePrefs
	prefs.OutboundProxyURL = strings.TrimSpace(prefs.OutboundProxyURL)
	if len(prefs.LocalShellModels) > 0 {
		prefs.LocalShellModels = append([]string(nil), prefs.LocalShellModels...)
	}
	if len(prefs.ModelShellTypeOverrides) > 0 {
		prefs.ModelShellTypeOverrides = cloneStringMap(prefs.ModelShellTypeOverrides)
	}
	if len(prefs.DefaultTurnSandboxPolicy) > 0 {
		prefs.DefaultTurnSandboxPolicy = cloneAnyMap(prefs.DefaultTurnSandboxPolicy)
	}
	if len(prefs.DefaultCommandSandboxPolicy) > 0 {
		prefs.DefaultCommandSandboxPolicy = cloneAnyMap(prefs.DefaultCommandSandboxPolicy)
	}
	prefs.TurnPolicyPostToolUseFailedValidationEnabled = cloneOptionalBool(prefs.TurnPolicyPostToolUseFailedValidationEnabled)
	prefs.TurnPolicyStopMissingSuccessfulVerificationEnabled = cloneOptionalBool(prefs.TurnPolicyStopMissingSuccessfulVerificationEnabled)
	prefs.TurnPolicyPostToolUsePrimaryAction = strings.TrimSpace(prefs.TurnPolicyPostToolUsePrimaryAction)
	prefs.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction = strings.TrimSpace(prefs.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction)
	prefs.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior = strings.TrimSpace(prefs.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior)
	prefs.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior = strings.TrimSpace(prefs.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior)
	prefs.TurnPolicyValidationCommandPrefixes = cloneStringSlice(prefs.TurnPolicyValidationCommandPrefixes)
	prefs.TurnPolicyFollowUpCooldownMs = cloneOptionalInt64(prefs.TurnPolicyFollowUpCooldownMs)
	prefs.TurnPolicyPostToolUseFollowUpCooldownMs = cloneOptionalInt64(prefs.TurnPolicyPostToolUseFollowUpCooldownMs)
	prefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs = cloneOptionalInt64(prefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	prefs.TurnPolicyAlertCoverageThresholdPercent = cloneOptionalInt(prefs.TurnPolicyAlertCoverageThresholdPercent)
	prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs = cloneOptionalInt64(prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	prefs.TurnPolicyAlertStopLatencyP95ThresholdMs = cloneOptionalInt64(prefs.TurnPolicyAlertStopLatencyP95ThresholdMs)
	prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent = cloneOptionalInt(prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent)
	prefs.TurnPolicyAlertSuppressedCodes = cloneStringSlice(prefs.TurnPolicyAlertSuppressedCodes)
	prefs.TurnPolicyAlertAcknowledgedCodes = cloneStringSlice(prefs.TurnPolicyAlertAcknowledgedCodes)
	prefs.TurnPolicyAlertSnoozedCodes = cloneStringSlice(prefs.TurnPolicyAlertSnoozedCodes)
	prefs.TurnPolicyAlertSnoozeUntil = cloneOptionalTime(prefs.TurnPolicyAlertSnoozeUntil)
	prefs.TurnPolicyAlertGovernanceHistory = cloneTurnPolicyAlertGovernanceHistory(prefs.TurnPolicyAlertGovernanceHistory)
	prefs.AllowRemoteAccess = cloneOptionalBool(prefs.AllowRemoteAccess)
	prefs.AllowLocalhostWithoutAccessToken = cloneOptionalBool(prefs.AllowLocalhostWithoutAccessToken)
	if len(prefs.AccessTokens) > 0 {
		prefs.AccessTokens = cloneAccessTokens(prefs.AccessTokens)
	}
	prefs.BackendThreadTraceEnabled = cloneOptionalBool(prefs.BackendThreadTraceEnabled)
	prefs.BackendThreadTraceWorkspaceID = strings.TrimSpace(prefs.BackendThreadTraceWorkspaceID)
	prefs.BackendThreadTraceThreadID = strings.TrimSpace(prefs.BackendThreadTraceThreadID)
	return prefs
}

func (s *MemoryStore) SetRuntimePreferences(prefs RuntimePreferences) RuntimePreferences {
	s.mu.Lock()
	defer s.mu.Unlock()

	prefs.ModelCatalogPath = strings.TrimSpace(prefs.ModelCatalogPath)
	prefs.OutboundProxyURL = strings.TrimSpace(prefs.OutboundProxyURL)
	prefs.DefaultTerminalShell = strings.TrimSpace(prefs.DefaultTerminalShell)
	if len(prefs.LocalShellModels) > 0 {
		prefs.LocalShellModels = append([]string(nil), prefs.LocalShellModels...)
	} else {
		prefs.LocalShellModels = nil
	}
	if len(prefs.ModelShellTypeOverrides) > 0 {
		prefs.ModelShellTypeOverrides = cloneStringMap(prefs.ModelShellTypeOverrides)
	} else {
		prefs.ModelShellTypeOverrides = nil
	}
	prefs.DefaultTurnApprovalPolicy = strings.TrimSpace(prefs.DefaultTurnApprovalPolicy)
	if len(prefs.DefaultTurnSandboxPolicy) > 0 {
		prefs.DefaultTurnSandboxPolicy = cloneAnyMap(prefs.DefaultTurnSandboxPolicy)
	} else {
		prefs.DefaultTurnSandboxPolicy = nil
	}
	if len(prefs.DefaultCommandSandboxPolicy) > 0 {
		prefs.DefaultCommandSandboxPolicy = cloneAnyMap(prefs.DefaultCommandSandboxPolicy)
	} else {
		prefs.DefaultCommandSandboxPolicy = nil
	}
	prefs.TurnPolicyPostToolUseFailedValidationEnabled = cloneOptionalBool(prefs.TurnPolicyPostToolUseFailedValidationEnabled)
	prefs.TurnPolicyStopMissingSuccessfulVerificationEnabled = cloneOptionalBool(prefs.TurnPolicyStopMissingSuccessfulVerificationEnabled)
	prefs.TurnPolicyPostToolUsePrimaryAction = strings.TrimSpace(prefs.TurnPolicyPostToolUsePrimaryAction)
	prefs.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction = strings.TrimSpace(prefs.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction)
	prefs.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior = strings.TrimSpace(prefs.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior)
	prefs.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior = strings.TrimSpace(prefs.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior)
	prefs.TurnPolicyValidationCommandPrefixes = cloneStringSlice(prefs.TurnPolicyValidationCommandPrefixes)
	prefs.TurnPolicyFollowUpCooldownMs = cloneOptionalInt64(prefs.TurnPolicyFollowUpCooldownMs)
	prefs.TurnPolicyPostToolUseFollowUpCooldownMs = cloneOptionalInt64(prefs.TurnPolicyPostToolUseFollowUpCooldownMs)
	prefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs = cloneOptionalInt64(prefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	prefs.TurnPolicyAlertCoverageThresholdPercent = cloneOptionalInt(prefs.TurnPolicyAlertCoverageThresholdPercent)
	prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs = cloneOptionalInt64(prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	prefs.TurnPolicyAlertStopLatencyP95ThresholdMs = cloneOptionalInt64(prefs.TurnPolicyAlertStopLatencyP95ThresholdMs)
	prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent = cloneOptionalInt(prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent)
	prefs.TurnPolicyAlertSuppressedCodes = cloneStringSlice(prefs.TurnPolicyAlertSuppressedCodes)
	prefs.TurnPolicyAlertAcknowledgedCodes = cloneStringSlice(prefs.TurnPolicyAlertAcknowledgedCodes)
	prefs.TurnPolicyAlertSnoozedCodes = cloneStringSlice(prefs.TurnPolicyAlertSnoozedCodes)
	prefs.TurnPolicyAlertSnoozeUntil = cloneOptionalTime(prefs.TurnPolicyAlertSnoozeUntil)
	prefs.TurnPolicyAlertGovernanceHistory = cloneTurnPolicyAlertGovernanceHistory(prefs.TurnPolicyAlertGovernanceHistory)
	prefs.AllowRemoteAccess = cloneOptionalBool(prefs.AllowRemoteAccess)
	prefs.AllowLocalhostWithoutAccessToken = cloneOptionalBool(prefs.AllowLocalhostWithoutAccessToken)
	if len(prefs.AccessTokens) > 0 {
		prefs.AccessTokens = cloneAccessTokens(prefs.AccessTokens)
	} else {
		prefs.AccessTokens = nil
	}
	prefs.BackendThreadTraceEnabled = cloneOptionalBool(prefs.BackendThreadTraceEnabled)
	prefs.BackendThreadTraceWorkspaceID = strings.TrimSpace(prefs.BackendThreadTraceWorkspaceID)
	prefs.BackendThreadTraceThreadID = strings.TrimSpace(prefs.BackendThreadTraceThreadID)
	prefs.UpdatedAt = time.Now().UTC()
	s.runtimePrefs = prefs
	s.persistLocked()

	return s.runtimePrefs
}

func cloneOptionalBool(value *bool) *bool {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func cloneOptionalInt(value *int) *int {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func cloneOptionalInt64(value *int64) *int64 {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func normalizePersistentStorePath(rawPath string) string {
	if strings.TrimSpace(rawPath) == "" {
		return ""
	}

	if absolutePath, err := filepath.Abs(rawPath); err == nil {
		return filepath.Clean(absolutePath)
	}
	return filepath.Clean(rawPath)
}

func registerPersistentStore(path string, store *MemoryStore) {
	if path == "" || store == nil {
		return
	}

	persistentStoreRegistry.mu.Lock()
	defer persistentStoreRegistry.mu.Unlock()

	if persistentStoreRegistry.stores == nil {
		persistentStoreRegistry.stores = make(map[string]*MemoryStore)
	}
	persistentStoreRegistry.stores[path] = store
}

func unregisterPersistentStore(path string, store *MemoryStore) {
	if path == "" || store == nil {
		return
	}

	persistentStoreRegistry.mu.Lock()
	defer persistentStoreRegistry.mu.Unlock()

	if persistentStoreRegistry.stores[path] == store {
		delete(persistentStoreRegistry.stores, path)
	}
}

func findPersistentStore(path string) *MemoryStore {
	if path == "" {
		return nil
	}

	persistentStoreRegistry.mu.Lock()
	defer persistentStoreRegistry.mu.Unlock()

	return persistentStoreRegistry.stores[path]
}

func (s *MemoryStore) startFlushWorker() {
	if s == nil || s.path == "" {
		return
	}

	s.mu.Lock()
	if s.flushCh != nil || s.flushClosed {
		s.mu.Unlock()
		return
	}
	s.flushCh = make(chan struct{}, 1)
	s.flushStopCh = make(chan struct{})
	s.flushWG.Add(1)
	if s.flushDirty {
		s.requestFlushLocked()
	}
	s.mu.Unlock()

	go s.flushWorker()
}

func NewPersistentStore(path string) (*MemoryStore, error) {
	normalizedPath := normalizePersistentStorePath(path)
	if existing := findPersistentStore(normalizedPath); existing != nil {
		if err := existing.Flush(); err != nil {
			return nil, err
		}
	}

	store := NewMemoryStore()
	store.path = normalizedPath

	if err := store.load(); err != nil {
		return nil, err
	}
	store.releaseTransientLoadMemory()
	store.startFlushWorker()
	registerPersistentStore(normalizedPath, store)

	return store, nil
}

func (s *MemoryStore) ListWorkspaces() []Workspace {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]Workspace, 0, len(s.workspaces))
	for _, workspace := range s.workspaces {
		items = append(items, workspace)
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) CreateWorkspace(name string, rootPath string) Workspace {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	workspace := Workspace{
		ID:            NewID("ws"),
		Name:          name,
		RootPath:      rootPath,
		RuntimeStatus: "ready",
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	s.workspaces[workspace.ID] = workspace
	s.persistLocked()
	return workspace
}

func (s *MemoryStore) GetWorkspace(id string) (Workspace, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	workspace, ok := s.workspaces[id]
	return workspace, ok
}

func (s *MemoryStore) SetWorkspaceName(workspaceID string, name string) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspace, ok := s.workspaces[workspaceID]
	if !ok {
		return Workspace{}, ErrWorkspaceNotFound
	}

	workspace.Name = name
	workspace.UpdatedAt = time.Now().UTC()
	s.workspaces[workspaceID] = workspace
	s.persistLocked()

	return workspace, nil
}

func (s *MemoryStore) SetWorkspaceRuntimeConfigChangedAt(workspaceID string, changedAt time.Time) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspace, ok := s.workspaces[workspaceID]
	if !ok {
		return Workspace{}, ErrWorkspaceNotFound
	}

	changedAt = changedAt.UTC()
	workspace.RuntimeConfigChangedAt = &changedAt
	workspace.UpdatedAt = time.Now().UTC()
	s.workspaces[workspaceID] = workspace
	s.persistLocked()

	return workspace, nil
}

func (s *MemoryStore) ListAutomations() []Automation {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]Automation, 0, len(s.automations))
	for _, automation := range s.automations {
		items = append(items, automation)
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) ListAutomationTemplates() []AutomationTemplate {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]AutomationTemplate, 0, len(s.templates))
	for _, template := range s.templates {
		items = append(items, template)
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) CreateAutomationTemplate(template AutomationTemplate) (AutomationTemplate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	template.ID = NewID("tpl")
	template.CreatedAt = now
	template.UpdatedAt = now
	s.templates[template.ID] = template
	s.persistLocked()

	return template, nil
}

func (s *MemoryStore) GetAutomationTemplate(templateID string) (AutomationTemplate, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	template, ok := s.templates[templateID]
	return template, ok
}

func (s *MemoryStore) UpdateAutomationTemplate(
	templateID string,
	updater func(AutomationTemplate) AutomationTemplate,
) (AutomationTemplate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	template, ok := s.templates[templateID]
	if !ok {
		return AutomationTemplate{}, ErrAutomationTemplateNotFound
	}

	next := updater(template)
	next.ID = template.ID
	next.CreatedAt = template.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	s.templates[templateID] = next
	s.persistLocked()

	return next, nil
}

func (s *MemoryStore) DeleteAutomationTemplate(templateID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.templates[templateID]; !ok {
		return ErrAutomationTemplateNotFound
	}

	delete(s.templates, templateID)
	s.persistLocked()
	return nil
}

func (s *MemoryStore) ListAutomationRuns(automationID string) []AutomationRun {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]AutomationRun, 0)
	for _, run := range s.runs {
		if automationID != "" && run.AutomationID != automationID {
			continue
		}
		items = append(items, cloneAutomationRun(run))
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].StartedAt.After(items[j].StartedAt)
	})

	return items
}

func (s *MemoryStore) ListActiveAutomationRuns() []AutomationRun {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]AutomationRun, 0)
	for _, run := range s.runs {
		switch run.Status {
		case "queued", "running":
			items = append(items, cloneAutomationRun(run))
		}
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].StartedAt.After(items[j].StartedAt)
	})

	return items
}

func (s *MemoryStore) CreateAutomationRun(run AutomationRun) (AutomationRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	automation, ok := s.automations[run.AutomationID]
	if !ok {
		return AutomationRun{}, ErrAutomationNotFound
	}
	if _, ok := s.workspaces[run.WorkspaceID]; !ok {
		return AutomationRun{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	run.ID = NewID("run")
	if run.StartedAt.IsZero() {
		run.StartedAt = now
	}
	if run.AutomationTitle == "" {
		run.AutomationTitle = automation.Title
	}
	if run.WorkspaceName == "" {
		run.WorkspaceName = automation.WorkspaceName
	}
	if run.Logs == nil {
		run.Logs = []AutomationRunLogEntry{}
	}

	s.runs[run.ID] = cloneAutomationRun(run)
	s.persistLocked()

	return cloneAutomationRun(run), nil
}

func (s *MemoryStore) GetAutomationRun(runID string) (AutomationRun, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	run, ok := s.runs[runID]
	if !ok {
		return AutomationRun{}, false
	}

	return cloneAutomationRun(run), true
}

func (s *MemoryStore) UpdateAutomationRun(runID string, updater func(AutomationRun) AutomationRun) (AutomationRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[runID]
	if !ok {
		return AutomationRun{}, ErrAutomationRunNotFound
	}

	next := updater(cloneAutomationRun(run))
	next.ID = run.ID
	if next.StartedAt.IsZero() {
		next.StartedAt = run.StartedAt
	}
	s.runs[runID] = cloneAutomationRun(next)
	s.persistLocked()

	return cloneAutomationRun(next), nil
}

func (s *MemoryStore) AppendAutomationRunLog(runID string, entry AutomationRunLogEntry) (AutomationRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[runID]
	if !ok {
		return AutomationRun{}, ErrAutomationRunNotFound
	}

	if entry.ID == "" {
		entry.ID = NewID("log")
	}
	if entry.TS.IsZero() {
		entry.TS = time.Now().UTC()
	}

	run.Logs = append(run.Logs, entry)
	s.runs[runID] = cloneAutomationRun(run)
	s.persistLocked()

	return cloneAutomationRun(run), nil
}

func (s *MemoryStore) ListNotifications() []Notification {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]Notification, 0, len(s.notifications))
	for _, notification := range s.notifications {
		items = append(items, notification)
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})

	return items
}

func (s *MemoryStore) CreateNotification(notification Notification) (Notification, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[notification.WorkspaceID]; !ok {
		return Notification{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	notification.ID = NewID("ntf")
	if notification.CreatedAt.IsZero() {
		notification.CreatedAt = now
	}
	s.notifications[notification.ID] = notification
	s.persistLocked()

	return notification, nil
}

func (s *MemoryStore) MarkNotificationRead(notificationID string) (Notification, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	notification, ok := s.notifications[notificationID]
	if !ok {
		return Notification{}, ErrNotificationNotFound
	}
	if notification.Read {
		return notification, nil
	}

	now := time.Now().UTC()
	notification.Read = true
	notification.ReadAt = &now
	s.notifications[notificationID] = notification
	s.persistLocked()

	return notification, nil
}

func (s *MemoryStore) MarkAllNotificationsRead() []Notification {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	updated := make([]Notification, 0)
	for id, notification := range s.notifications {
		if notification.Read {
			continue
		}

		notification.Read = true
		notification.ReadAt = &now
		s.notifications[id] = notification
		updated = append(updated, notification)
	}

	if len(updated) > 0 {
		s.persistLocked()
	}

	sort.Slice(updated, func(i int, j int) bool {
		return updated[i].CreatedAt.After(updated[j].CreatedAt)
	})

	return updated
}

func (s *MemoryStore) DeleteReadNotifications() []Notification {
	s.mu.Lock()
	defer s.mu.Unlock()

	deleted := make([]Notification, 0)
	for id, notification := range s.notifications {
		if notification.Read {
			deleted = append(deleted, notification)
			delete(s.notifications, id)
		}
	}

	if len(deleted) > 0 {
		s.persistLocked()
	}

	sort.Slice(deleted, func(i int, j int) bool {
		return deleted[i].CreatedAt.After(deleted[j].CreatedAt)
	})

	return deleted
}

func (s *MemoryStore) ListNotificationSubscriptions(workspaceID string) []NotificationSubscription {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]NotificationSubscription, 0)
	for _, subscription := range s.notificationSubscriptions {
		if subscription.WorkspaceID != workspaceID {
			continue
		}
		items = append(items, cloneNotificationSubscription(subscription))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) GetNotificationSubscription(workspaceID string, subscriptionID string) (NotificationSubscription, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	subscription, ok := s.notificationSubscriptions[subscriptionID]
	if !ok || subscription.WorkspaceID != workspaceID {
		return NotificationSubscription{}, false
	}

	return cloneNotificationSubscription(subscription), true
}

func (s *MemoryStore) CreateNotificationSubscription(subscription NotificationSubscription) (NotificationSubscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[subscription.WorkspaceID]; !ok {
		return NotificationSubscription{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(subscription.ID) == "" {
		subscription.ID = NewID("nsub")
	}
	if subscription.CreatedAt.IsZero() {
		subscription.CreatedAt = now
	}
	subscription.UpdatedAt = now
	subscription.Topic = strings.TrimSpace(subscription.Topic)
	subscription.SourceType = strings.TrimSpace(subscription.SourceType)
	subscription.Filter = normalizeStringMap(subscription.Filter)
	subscription.Channels = cloneNotificationChannelBindings(subscription.Channels)
	s.notificationSubscriptions[subscription.ID] = cloneNotificationSubscription(subscription)
	s.persistLocked()

	return cloneNotificationSubscription(subscription), nil
}

func (s *MemoryStore) UpdateNotificationSubscription(
	workspaceID string,
	subscriptionID string,
	updater func(NotificationSubscription) NotificationSubscription,
) (NotificationSubscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	subscription, ok := s.notificationSubscriptions[subscriptionID]
	if !ok || subscription.WorkspaceID != workspaceID {
		return NotificationSubscription{}, ErrNotificationSubscriptionNotFound
	}

	next := updater(cloneNotificationSubscription(subscription))
	next.ID = subscription.ID
	next.WorkspaceID = subscription.WorkspaceID
	next.CreatedAt = subscription.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.Topic = strings.TrimSpace(next.Topic)
	next.SourceType = strings.TrimSpace(next.SourceType)
	next.Filter = normalizeStringMap(next.Filter)
	next.Channels = cloneNotificationChannelBindings(next.Channels)
	s.notificationSubscriptions[subscriptionID] = cloneNotificationSubscription(next)
	s.persistLocked()

	return cloneNotificationSubscription(next), nil
}

func (s *MemoryStore) DeleteNotificationSubscription(workspaceID string, subscriptionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	subscription, ok := s.notificationSubscriptions[subscriptionID]
	if !ok || subscription.WorkspaceID != workspaceID {
		return ErrNotificationSubscriptionNotFound
	}

	delete(s.notificationSubscriptions, subscription.ID)
	s.persistLocked()
	return nil
}

func (s *MemoryStore) ListNotificationEmailTargets(workspaceID string) []NotificationEmailTarget {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]NotificationEmailTarget, 0)
	for _, target := range s.notificationEmailTargets {
		if target.WorkspaceID != workspaceID {
			continue
		}
		items = append(items, cloneNotificationEmailTarget(target))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) GetNotificationEmailTarget(workspaceID string, targetID string) (NotificationEmailTarget, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	target, ok := s.notificationEmailTargets[targetID]
	if !ok || target.WorkspaceID != workspaceID {
		return NotificationEmailTarget{}, false
	}

	return cloneNotificationEmailTarget(target), true
}

func (s *MemoryStore) CreateNotificationEmailTarget(target NotificationEmailTarget) (NotificationEmailTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[target.WorkspaceID]; !ok {
		return NotificationEmailTarget{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(target.ID) == "" {
		target.ID = NewID("net")
	}
	if target.CreatedAt.IsZero() {
		target.CreatedAt = now
	}
	target.UpdatedAt = now
	target.Name = strings.TrimSpace(target.Name)
	target.Emails = normalizeStringSlice(target.Emails)
	target.SubjectTemplate = strings.TrimSpace(target.SubjectTemplate)
	target.BodyTemplate = strings.TrimSpace(target.BodyTemplate)
	s.notificationEmailTargets[target.ID] = cloneNotificationEmailTarget(target)
	s.persistLocked()

	return cloneNotificationEmailTarget(target), nil
}

func (s *MemoryStore) UpdateNotificationEmailTarget(
	workspaceID string,
	targetID string,
	updater func(NotificationEmailTarget) NotificationEmailTarget,
) (NotificationEmailTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	target, ok := s.notificationEmailTargets[targetID]
	if !ok || target.WorkspaceID != workspaceID {
		return NotificationEmailTarget{}, ErrNotificationEmailTargetNotFound
	}

	next := updater(cloneNotificationEmailTarget(target))
	next.ID = target.ID
	next.WorkspaceID = target.WorkspaceID
	next.CreatedAt = target.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.Name = strings.TrimSpace(next.Name)
	next.Emails = normalizeStringSlice(next.Emails)
	next.SubjectTemplate = strings.TrimSpace(next.SubjectTemplate)
	next.BodyTemplate = strings.TrimSpace(next.BodyTemplate)
	s.notificationEmailTargets[targetID] = cloneNotificationEmailTarget(next)
	s.persistLocked()

	return cloneNotificationEmailTarget(next), nil
}

func (s *MemoryStore) GetNotificationMailServerConfig(workspaceID string) (NotificationMailServerConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	config, ok := s.notificationMailServerConfigs[workspaceID]
	if !ok {
		return NotificationMailServerConfig{}, false
	}

	return cloneNotificationMailServerConfig(config), true
}

func (s *MemoryStore) UpsertNotificationMailServerConfig(
	config NotificationMailServerConfig,
) (NotificationMailServerConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspaceID := strings.TrimSpace(config.WorkspaceID)
	if _, ok := s.workspaces[workspaceID]; !ok {
		return NotificationMailServerConfig{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	existing, hasExisting := s.notificationMailServerConfigs[workspaceID]
	if hasExisting {
		config.CreatedAt = existing.CreatedAt
	} else if config.CreatedAt.IsZero() {
		config.CreatedAt = now
	}

	config.WorkspaceID = workspaceID
	config.Host = strings.TrimSpace(config.Host)
	config.Username = strings.TrimSpace(config.Username)
	config.PasswordSet = config.Password != ""
	config.From = strings.TrimSpace(config.From)
	if config.Port < 0 {
		config.Port = 0
	}
	config.UpdatedAt = now

	s.notificationMailServerConfigs[workspaceID] = cloneNotificationMailServerConfig(config)
	s.persistLocked()

	return cloneNotificationMailServerConfig(config), nil
}

func (s *MemoryStore) ListNotificationDispatches(workspaceID string, filter NotificationDispatchFilter) []NotificationDispatch {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]NotificationDispatch, 0)
	for _, dispatch := range s.notificationDispatches {
		if dispatch.WorkspaceID != workspaceID {
			continue
		}
		if filter.SubscriptionID != "" && strings.TrimSpace(dispatch.SubscriptionID) != strings.TrimSpace(filter.SubscriptionID) {
			continue
		}
		if filter.Topic != "" && strings.TrimSpace(dispatch.Topic) != strings.TrimSpace(filter.Topic) {
			continue
		}
		if filter.Channel != "" && strings.TrimSpace(dispatch.Channel) != strings.TrimSpace(filter.Channel) {
			continue
		}
		if filter.Status != "" && strings.TrimSpace(dispatch.Status) != strings.TrimSpace(filter.Status) {
			continue
		}
		if filter.TargetRefType != "" && strings.TrimSpace(dispatch.TargetRefType) != strings.TrimSpace(filter.TargetRefType) {
			continue
		}
		if filter.TargetRefID != "" && strings.TrimSpace(dispatch.TargetRefID) != strings.TrimSpace(filter.TargetRefID) {
			continue
		}
		if filter.SourceRefType != "" && strings.TrimSpace(dispatch.SourceRefType) != strings.TrimSpace(filter.SourceRefType) {
			continue
		}
		if filter.SourceRefID != "" && strings.TrimSpace(dispatch.SourceRefID) != strings.TrimSpace(filter.SourceRefID) {
			continue
		}
		if filter.EventKey != "" && strings.TrimSpace(dispatch.EventKey) != strings.TrimSpace(filter.EventKey) {
			continue
		}
		items = append(items, cloneNotificationDispatch(dispatch))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})

	return items
}

func (s *MemoryStore) GetNotificationDispatch(workspaceID string, dispatchID string) (NotificationDispatch, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	dispatch, ok := s.notificationDispatches[dispatchID]
	if !ok || dispatch.WorkspaceID != workspaceID {
		return NotificationDispatch{}, false
	}

	return cloneNotificationDispatch(dispatch), true
}

func (s *MemoryStore) FindNotificationDispatchByDedupKey(workspaceID string, dedupKey string) (NotificationDispatch, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, dispatch := range s.notificationDispatches {
		if dispatch.WorkspaceID != workspaceID {
			continue
		}
		if strings.TrimSpace(dispatch.DedupKey) != strings.TrimSpace(dedupKey) {
			continue
		}
		return cloneNotificationDispatch(dispatch), true
	}

	return NotificationDispatch{}, false
}

func (s *MemoryStore) CreateNotificationDispatch(dispatch NotificationDispatch) (NotificationDispatch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[dispatch.WorkspaceID]; !ok {
		return NotificationDispatch{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(dispatch.ID) == "" {
		dispatch.ID = NewID("ndp")
	}
	if dispatch.CreatedAt.IsZero() {
		dispatch.CreatedAt = now
	}
	dispatch.UpdatedAt = now
	dispatch.EventKey = strings.TrimSpace(dispatch.EventKey)
	dispatch.DedupKey = strings.TrimSpace(dispatch.DedupKey)
	dispatch.Topic = strings.TrimSpace(dispatch.Topic)
	dispatch.SourceType = strings.TrimSpace(dispatch.SourceType)
	dispatch.SourceRefType = strings.TrimSpace(dispatch.SourceRefType)
	dispatch.SourceRefID = strings.TrimSpace(dispatch.SourceRefID)
	dispatch.Channel = strings.TrimSpace(dispatch.Channel)
	dispatch.TargetRefType = strings.TrimSpace(dispatch.TargetRefType)
	dispatch.TargetRefID = strings.TrimSpace(dispatch.TargetRefID)
	dispatch.Title = strings.TrimSpace(dispatch.Title)
	dispatch.Message = strings.TrimSpace(dispatch.Message)
	dispatch.Level = strings.TrimSpace(dispatch.Level)
	dispatch.SubscriptionID = strings.TrimSpace(dispatch.SubscriptionID)
	dispatch.Error = strings.TrimSpace(dispatch.Error)
	dispatch.NotificationID = strings.TrimSpace(dispatch.NotificationID)
	dispatch.BotOutboundDeliveryID = strings.TrimSpace(dispatch.BotOutboundDeliveryID)
	s.notificationDispatches[dispatch.ID] = cloneNotificationDispatch(dispatch)
	s.persistLocked()

	return cloneNotificationDispatch(dispatch), nil
}

func (s *MemoryStore) UpdateNotificationDispatch(
	workspaceID string,
	dispatchID string,
	updater func(NotificationDispatch) NotificationDispatch,
) (NotificationDispatch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dispatch, ok := s.notificationDispatches[dispatchID]
	if !ok || dispatch.WorkspaceID != workspaceID {
		return NotificationDispatch{}, ErrNotificationDispatchNotFound
	}

	next := updater(cloneNotificationDispatch(dispatch))
	next.ID = dispatch.ID
	next.WorkspaceID = dispatch.WorkspaceID
	next.CreatedAt = dispatch.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.EventKey = strings.TrimSpace(next.EventKey)
	next.DedupKey = strings.TrimSpace(next.DedupKey)
	next.Topic = strings.TrimSpace(next.Topic)
	next.SourceType = strings.TrimSpace(next.SourceType)
	next.SourceRefType = strings.TrimSpace(next.SourceRefType)
	next.SourceRefID = strings.TrimSpace(next.SourceRefID)
	next.Channel = strings.TrimSpace(next.Channel)
	next.TargetRefType = strings.TrimSpace(next.TargetRefType)
	next.TargetRefID = strings.TrimSpace(next.TargetRefID)
	next.Title = strings.TrimSpace(next.Title)
	next.Message = strings.TrimSpace(next.Message)
	next.Level = strings.TrimSpace(next.Level)
	next.SubscriptionID = strings.TrimSpace(next.SubscriptionID)
	next.Error = strings.TrimSpace(next.Error)
	next.NotificationID = strings.TrimSpace(next.NotificationID)
	next.BotOutboundDeliveryID = strings.TrimSpace(next.BotOutboundDeliveryID)
	s.notificationDispatches[dispatchID] = cloneNotificationDispatch(next)
	s.persistLocked()

	return cloneNotificationDispatch(next), nil
}

func (s *MemoryStore) ListBots(workspaceID string) []Bot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]Bot, 0)
	for _, bot := range s.bots {
		if bot.WorkspaceID != workspaceID {
			continue
		}
		items = append(items, cloneBot(bot))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) GetBot(workspaceID string, botID string) (Bot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	bot, ok := s.bots[botID]
	if !ok || bot.WorkspaceID != workspaceID {
		return Bot{}, false
	}

	return cloneBot(bot), true
}

func (s *MemoryStore) CreateBot(bot Bot) (Bot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[bot.WorkspaceID]; !ok {
		return Bot{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(bot.ID) == "" {
		bot.ID = NewID("botr")
	}
	if bot.CreatedAt.IsZero() {
		bot.CreatedAt = now
	}
	if bot.UpdatedAt.IsZero() {
		bot.UpdatedAt = now
	}
	bot.WorkspaceID = strings.TrimSpace(bot.WorkspaceID)
	bot.Scope = strings.TrimSpace(bot.Scope)
	bot.SharingMode = strings.TrimSpace(bot.SharingMode)
	bot.SharedWorkspaceIDs = normalizeStringSlice(bot.SharedWorkspaceIDs)
	bot.Name = strings.TrimSpace(bot.Name)
	bot.Description = strings.TrimSpace(bot.Description)
	bot.Status = strings.TrimSpace(bot.Status)
	bot.DefaultBindingID = strings.TrimSpace(bot.DefaultBindingID)

	s.bots[bot.ID] = bot
	s.persistLocked()

	return cloneBot(bot), nil
}

func (s *MemoryStore) UpdateBot(workspaceID string, botID string, updater func(Bot) Bot) (Bot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.bots[botID]
	if !ok || bot.WorkspaceID != workspaceID {
		return Bot{}, ErrBotNotFound
	}

	next := updater(cloneBot(bot))
	next.ID = bot.ID
	next.WorkspaceID = bot.WorkspaceID
	next.CreatedAt = bot.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.Scope = strings.TrimSpace(next.Scope)
	next.SharingMode = strings.TrimSpace(next.SharingMode)
	next.SharedWorkspaceIDs = normalizeStringSlice(next.SharedWorkspaceIDs)
	next.Name = strings.TrimSpace(next.Name)
	next.Description = strings.TrimSpace(next.Description)
	next.Status = strings.TrimSpace(next.Status)
	next.DefaultBindingID = strings.TrimSpace(next.DefaultBindingID)

	s.bots[botID] = next
	s.persistLocked()

	return cloneBot(next), nil
}

func (s *MemoryStore) DeleteBot(workspaceID string, botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.bots[botID]
	if !ok || bot.WorkspaceID != workspaceID {
		return ErrBotNotFound
	}

	delete(s.bots, botID)
	targetIDs := make(map[string]struct{})
	for bindingID, binding := range s.botBindings {
		if binding.WorkspaceID == workspaceID && binding.BotID == botID {
			delete(s.botBindings, bindingID)
		}
	}
	for triggerID, trigger := range s.botTriggers {
		if trigger.WorkspaceID == workspaceID && trigger.BotID == botID {
			delete(s.botTriggers, triggerID)
		}
	}
	for connectionID, connection := range s.botConnections {
		if connection.WorkspaceID == workspaceID && connection.BotID == botID {
			connection.BotID = ""
			s.botConnections[connectionID] = cloneBotConnection(connection)
		}
	}
	for conversationID, conversation := range s.botConversations {
		if conversation.WorkspaceID == workspaceID && conversation.BotID == botID {
			conversation.BotID = ""
			conversation.BindingID = ""
			s.botConversations[conversationID] = cloneBotConversation(conversation)
		}
	}
	for targetID, target := range s.botDeliveryTargets {
		if target.WorkspaceID == workspaceID && target.BotID == botID {
			targetIDs[targetID] = struct{}{}
			delete(s.botDeliveryTargets, targetID)
		}
	}
	deleteThreadBotBindingsForTargetIDs(s.threadBotBindings, workspaceID, targetIDs)
	for deliveryID, delivery := range s.botOutbound {
		if delivery.WorkspaceID == workspaceID && delivery.BotID == botID {
			delete(s.botOutbound, deliveryID)
		}
	}

	s.persistLocked()
	return nil
}

func (s *MemoryStore) ListBotBindings(workspaceID string, botID string) []BotBinding {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]BotBinding, 0)
	for _, binding := range s.botBindings {
		if binding.WorkspaceID != workspaceID {
			continue
		}
		if strings.TrimSpace(botID) != "" && binding.BotID != botID {
			continue
		}
		items = append(items, cloneBotBinding(binding))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) GetBotBinding(workspaceID string, bindingID string) (BotBinding, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	binding, ok := s.botBindings[bindingID]
	if !ok || binding.WorkspaceID != workspaceID {
		return BotBinding{}, false
	}

	return cloneBotBinding(binding), true
}

func (s *MemoryStore) CreateBotBinding(binding BotBinding) (BotBinding, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[binding.WorkspaceID]; !ok {
		return BotBinding{}, ErrWorkspaceNotFound
	}
	bot, ok := s.bots[binding.BotID]
	if !ok || bot.WorkspaceID != binding.WorkspaceID {
		return BotBinding{}, ErrBotNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(binding.ID) == "" {
		binding.ID = NewID("bbd")
	}
	if binding.CreatedAt.IsZero() {
		binding.CreatedAt = now
	}
	if binding.UpdatedAt.IsZero() {
		binding.UpdatedAt = now
	}
	binding.WorkspaceID = strings.TrimSpace(binding.WorkspaceID)
	binding.BotID = strings.TrimSpace(binding.BotID)
	binding.Name = strings.TrimSpace(binding.Name)
	binding.BindingMode = strings.TrimSpace(binding.BindingMode)
	binding.TargetWorkspaceID = strings.TrimSpace(binding.TargetWorkspaceID)
	binding.TargetThreadID = strings.TrimSpace(binding.TargetThreadID)
	binding.AIBackend = strings.TrimSpace(binding.AIBackend)
	binding.AIConfig = cloneStringMap(binding.AIConfig)

	s.botBindings[binding.ID] = binding
	s.persistLocked()

	return cloneBotBinding(binding), nil
}

func (s *MemoryStore) UpdateBotBinding(workspaceID string, bindingID string, updater func(BotBinding) BotBinding) (BotBinding, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	binding, ok := s.botBindings[bindingID]
	if !ok || binding.WorkspaceID != workspaceID {
		return BotBinding{}, ErrBotBindingNotFound
	}

	next := updater(cloneBotBinding(binding))
	next.ID = binding.ID
	next.WorkspaceID = binding.WorkspaceID
	next.BotID = binding.BotID
	next.CreatedAt = binding.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.Name = strings.TrimSpace(next.Name)
	next.BindingMode = strings.TrimSpace(next.BindingMode)
	next.TargetWorkspaceID = strings.TrimSpace(next.TargetWorkspaceID)
	next.TargetThreadID = strings.TrimSpace(next.TargetThreadID)
	next.AIBackend = strings.TrimSpace(next.AIBackend)
	next.AIConfig = cloneStringMap(next.AIConfig)

	s.botBindings[bindingID] = next
	s.persistLocked()

	return cloneBotBinding(next), nil
}

func (s *MemoryStore) DeleteBotBinding(workspaceID string, bindingID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	binding, ok := s.botBindings[bindingID]
	if !ok || binding.WorkspaceID != workspaceID {
		return ErrBotBindingNotFound
	}

	delete(s.botBindings, bindingID)
	for botID, bot := range s.bots {
		if bot.WorkspaceID == workspaceID && bot.DefaultBindingID == bindingID {
			bot.DefaultBindingID = ""
			s.bots[botID] = cloneBot(bot)
		}
	}
	for conversationID, conversation := range s.botConversations {
		if conversation.WorkspaceID == workspaceID && conversation.BindingID == bindingID {
			conversation.BindingID = ""
			s.botConversations[conversationID] = cloneBotConversation(conversation)
		}
	}

	s.persistLocked()
	return nil
}

func threadBotBindingKey(workspaceID string, threadID string) string {
	return strings.TrimSpace(workspaceID) + ":" + strings.TrimSpace(threadID)
}

func normalizeThreadBotBindingBotWorkspaceID(binding ThreadBotBinding) string {
	return firstNonEmpty(strings.TrimSpace(binding.BotWorkspaceID), strings.TrimSpace(binding.WorkspaceID))
}

func deleteThreadBotBindingsForTargetIDs(
	items map[string]ThreadBotBinding,
	workspaceID string,
	targetIDs map[string]struct{},
) {
	if len(targetIDs) == 0 {
		return
	}
	for key, binding := range items {
		if normalizeThreadBotBindingBotWorkspaceID(binding) != strings.TrimSpace(workspaceID) {
			continue
		}
		if _, ok := targetIDs[strings.TrimSpace(binding.DeliveryTargetID)]; !ok {
			continue
		}
		delete(items, key)
	}
}

func (s *MemoryStore) GetThreadBotBinding(workspaceID string, threadID string) (ThreadBotBinding, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	binding, ok := s.threadBotBindings[threadBotBindingKey(workspaceID, threadID)]
	if !ok || binding.WorkspaceID != workspaceID || binding.ThreadID != threadID {
		return ThreadBotBinding{}, false
	}

	return cloneThreadBotBinding(binding), true
}

func (s *MemoryStore) ListThreadBotBindings(workspaceID string) []ThreadBotBinding {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]ThreadBotBinding, 0)
	for _, binding := range s.threadBotBindings {
		if binding.WorkspaceID != workspaceID {
			continue
		}
		items = append(items, cloneThreadBotBinding(binding))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) UpsertThreadBotBinding(binding ThreadBotBinding) (ThreadBotBinding, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[binding.WorkspaceID]; !ok {
		return ThreadBotBinding{}, ErrWorkspaceNotFound
	}
	thread, ok := s.threads[binding.ThreadID]
	if !ok || thread.WorkspaceID != binding.WorkspaceID {
		return ThreadBotBinding{}, ErrThreadNotFound
	}
	key := threadBotBindingKey(binding.WorkspaceID, binding.ThreadID)
	current, exists := s.threadBotBindings[key]
	binding.BotWorkspaceID = firstNonEmpty(
		strings.TrimSpace(binding.BotWorkspaceID),
		normalizeThreadBotBindingBotWorkspaceID(current),
		strings.TrimSpace(binding.WorkspaceID),
	)
	if _, ok := s.workspaces[binding.BotWorkspaceID]; !ok {
		return ThreadBotBinding{}, ErrWorkspaceNotFound
	}
	bot, ok := s.bots[binding.BotID]
	if !ok || bot.WorkspaceID != binding.BotWorkspaceID {
		return ThreadBotBinding{}, ErrBotNotFound
	}
	target, ok := s.botDeliveryTargets[binding.DeliveryTargetID]
	if !ok || target.WorkspaceID != binding.BotWorkspaceID || strings.TrimSpace(target.BotID) != strings.TrimSpace(bot.ID) {
		return ThreadBotBinding{}, ErrBotDeliveryTargetNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(binding.ID) == "" {
		if exists {
			binding.ID = current.ID
		} else {
			binding.ID = NewID("tbb")
		}
	}
	if exists {
		binding.CreatedAt = current.CreatedAt
	} else if binding.CreatedAt.IsZero() {
		binding.CreatedAt = now
	}
	binding.UpdatedAt = now
	binding.WorkspaceID = strings.TrimSpace(binding.WorkspaceID)
	binding.ThreadID = strings.TrimSpace(binding.ThreadID)
	binding.BotWorkspaceID = strings.TrimSpace(binding.BotWorkspaceID)
	binding.BotID = strings.TrimSpace(binding.BotID)
	binding.DeliveryTargetID = strings.TrimSpace(binding.DeliveryTargetID)

	s.threadBotBindings[key] = binding
	s.persistLocked()

	return cloneThreadBotBinding(binding), nil
}

func (s *MemoryStore) DeleteThreadBotBinding(workspaceID string, threadID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := threadBotBindingKey(workspaceID, threadID)
	binding, ok := s.threadBotBindings[key]
	if !ok || binding.WorkspaceID != workspaceID || binding.ThreadID != threadID {
		return ErrThreadBotBindingNotFound
	}

	delete(s.threadBotBindings, key)
	s.persistLocked()
	return nil
}

func (s *MemoryStore) ListBotTriggers(workspaceID string, filter BotTriggerFilter) []BotTrigger {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]BotTrigger, 0)
	filterBotID := strings.TrimSpace(filter.BotID)
	filterType := strings.TrimSpace(filter.Type)
	filterTargetID := strings.TrimSpace(filter.DeliveryTargetID)
	for _, trigger := range s.botTriggers {
		if trigger.WorkspaceID != workspaceID {
			continue
		}
		if filterBotID != "" && strings.TrimSpace(trigger.BotID) != filterBotID {
			continue
		}
		if filterType != "" && strings.TrimSpace(trigger.Type) != filterType {
			continue
		}
		if filterTargetID != "" && strings.TrimSpace(trigger.DeliveryTargetID) != filterTargetID {
			continue
		}
		if filter.Enabled != nil && trigger.Enabled != *filter.Enabled {
			continue
		}
		items = append(items, cloneBotTrigger(trigger))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) GetBotTrigger(workspaceID string, triggerID string) (BotTrigger, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	trigger, ok := s.botTriggers[triggerID]
	if !ok || trigger.WorkspaceID != workspaceID {
		return BotTrigger{}, false
	}

	return cloneBotTrigger(trigger), true
}

func (s *MemoryStore) CreateBotTrigger(trigger BotTrigger) (BotTrigger, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[trigger.WorkspaceID]; !ok {
		return BotTrigger{}, ErrWorkspaceNotFound
	}
	bot, ok := s.bots[trigger.BotID]
	if !ok || bot.WorkspaceID != trigger.WorkspaceID {
		return BotTrigger{}, ErrBotNotFound
	}
	target, ok := s.botDeliveryTargets[trigger.DeliveryTargetID]
	if !ok || target.WorkspaceID != trigger.WorkspaceID || strings.TrimSpace(target.BotID) != strings.TrimSpace(bot.ID) {
		return BotTrigger{}, ErrBotDeliveryTargetNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(trigger.ID) == "" {
		trigger.ID = NewID("btg")
	}
	if trigger.CreatedAt.IsZero() {
		trigger.CreatedAt = now
	}
	if trigger.UpdatedAt.IsZero() {
		trigger.UpdatedAt = now
	}
	trigger.WorkspaceID = strings.TrimSpace(trigger.WorkspaceID)
	trigger.BotID = strings.TrimSpace(trigger.BotID)
	trigger.Type = strings.TrimSpace(trigger.Type)
	trigger.DeliveryTargetID = strings.TrimSpace(trigger.DeliveryTargetID)
	trigger.Filter = cloneStringMap(trigger.Filter)

	s.botTriggers[trigger.ID] = trigger
	s.persistLocked()

	return cloneBotTrigger(trigger), nil
}

func (s *MemoryStore) UpdateBotTrigger(
	workspaceID string,
	triggerID string,
	updater func(BotTrigger) BotTrigger,
) (BotTrigger, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	trigger, ok := s.botTriggers[triggerID]
	if !ok || trigger.WorkspaceID != workspaceID {
		return BotTrigger{}, ErrBotTriggerNotFound
	}

	next := updater(cloneBotTrigger(trigger))
	next.ID = trigger.ID
	next.WorkspaceID = trigger.WorkspaceID
	next.BotID = trigger.BotID
	next.Type = trigger.Type
	next.CreatedAt = trigger.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.DeliveryTargetID = strings.TrimSpace(next.DeliveryTargetID)
	next.Filter = cloneStringMap(next.Filter)
	if strings.TrimSpace(next.DeliveryTargetID) == "" {
		next.DeliveryTargetID = trigger.DeliveryTargetID
	}

	target, ok := s.botDeliveryTargets[next.DeliveryTargetID]
	if !ok || target.WorkspaceID != trigger.WorkspaceID || strings.TrimSpace(target.BotID) != strings.TrimSpace(trigger.BotID) {
		return BotTrigger{}, ErrBotDeliveryTargetNotFound
	}

	s.botTriggers[triggerID] = next
	s.persistLocked()

	return cloneBotTrigger(next), nil
}

func (s *MemoryStore) DeleteBotTrigger(workspaceID string, triggerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	trigger, ok := s.botTriggers[triggerID]
	if !ok || trigger.WorkspaceID != workspaceID {
		return ErrBotTriggerNotFound
	}

	delete(s.botTriggers, trigger.ID)
	s.persistLocked()
	return nil
}

func (s *MemoryStore) ListBotConnections(workspaceID string) []BotConnection {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]BotConnection, 0)
	for _, connection := range s.botConnections {
		if connection.WorkspaceID != workspaceID {
			continue
		}
		items = append(items, cloneBotConnection(connection))
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) ListBotConnectionLogs(workspaceID string, connectionID string) []BotConnectionLogEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	connection, ok := s.botConnections[connectionID]
	if !ok || connection.WorkspaceID != workspaceID {
		return []BotConnectionLogEntry{}
	}

	items := append([]BotConnectionLogEntry(nil), s.botConnectionLogs[connectionID]...)
	sort.Slice(items, func(i int, j int) bool {
		return items[i].TS.After(items[j].TS)
	})
	return items
}

func (s *MemoryStore) ListWeChatAccounts(workspaceID string) []WeChatAccount {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]WeChatAccount, 0)
	for _, account := range s.wechatAccounts {
		if account.WorkspaceID != workspaceID {
			continue
		}
		items = append(items, cloneWeChatAccount(account))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	return items
}

func (s *MemoryStore) GetWeChatAccount(workspaceID string, accountID string) (WeChatAccount, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	account, ok := s.wechatAccounts[accountID]
	if !ok || account.WorkspaceID != workspaceID {
		return WeChatAccount{}, false
	}
	return cloneWeChatAccount(account), true
}

func (s *MemoryStore) DeleteWeChatAccount(workspaceID string, accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	account, ok := s.wechatAccounts[accountID]
	if !ok || account.WorkspaceID != workspaceID {
		return ErrWeChatAccountNotFound
	}

	delete(s.wechatAccounts, accountID)
	s.persistLocked()
	return nil
}

func (s *MemoryStore) UpdateWeChatAccount(workspaceID string, accountID string, mutate func(WeChatAccount) WeChatAccount) (WeChatAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	account, ok := s.wechatAccounts[accountID]
	if !ok || account.WorkspaceID != workspaceID {
		return WeChatAccount{}, ErrWeChatAccountNotFound
	}

	updated := mutate(cloneWeChatAccount(account))
	updated.ID = account.ID
	updated.WorkspaceID = account.WorkspaceID
	updated.BaseURL = account.BaseURL
	updated.AccountID = account.AccountID
	updated.UserID = account.UserID
	if strings.TrimSpace(updated.BotToken) == "" {
		updated.BotToken = account.BotToken
	}
	updated.LastLoginID = strings.TrimSpace(updated.LastLoginID)
	if updated.LastLoginID == "" {
		updated.LastLoginID = account.LastLoginID
	}
	if updated.LastConfirmedAt.IsZero() {
		updated.LastConfirmedAt = account.LastConfirmedAt
	}
	if updated.CreatedAt.IsZero() {
		updated.CreatedAt = account.CreatedAt
	}
	updated.Alias = strings.TrimSpace(updated.Alias)
	updated.Note = strings.TrimSpace(updated.Note)
	updated.UpdatedAt = time.Now().UTC()

	s.wechatAccounts[accountID] = cloneWeChatAccount(updated)
	s.persistLocked()
	return cloneWeChatAccount(updated), nil
}

func (s *MemoryStore) UpsertWeChatAccount(account WeChatAccount) (WeChatAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[account.WorkspaceID]; !ok {
		return WeChatAccount{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	account.WorkspaceID = strings.TrimSpace(account.WorkspaceID)
	account.Alias = strings.TrimSpace(account.Alias)
	account.Note = strings.TrimSpace(account.Note)
	account.BaseURL = strings.TrimSpace(account.BaseURL)
	account.AccountID = strings.TrimSpace(account.AccountID)
	account.UserID = strings.TrimSpace(account.UserID)
	account.BotToken = strings.TrimSpace(account.BotToken)
	account.LastLoginID = strings.TrimSpace(account.LastLoginID)

	existing, found := WeChatAccount{}, false
	if account.ID != "" {
		candidate, ok := s.wechatAccounts[account.ID]
		if ok && candidate.WorkspaceID == account.WorkspaceID {
			existing = candidate
			found = true
		}
	}
	if !found && account.AccountID != "" {
		for _, candidate := range s.wechatAccounts {
			if candidate.WorkspaceID != account.WorkspaceID {
				continue
			}
			if strings.EqualFold(strings.TrimSpace(candidate.AccountID), account.AccountID) {
				existing = candidate
				found = true
				break
			}
		}
	}

	if found {
		account.ID = existing.ID
		if account.CreatedAt.IsZero() {
			account.CreatedAt = existing.CreatedAt
		}
		if account.BaseURL == "" {
			account.BaseURL = existing.BaseURL
		}
		if account.AccountID == "" {
			account.AccountID = existing.AccountID
		}
		if account.UserID == "" {
			account.UserID = existing.UserID
		}
		if account.BotToken == "" {
			account.BotToken = existing.BotToken
		}
		if account.LastLoginID == "" {
			account.LastLoginID = existing.LastLoginID
		}
		if account.Alias == "" {
			account.Alias = existing.Alias
		}
		if account.Note == "" {
			account.Note = existing.Note
		}
		if account.LastConfirmedAt.IsZero() {
			account.LastConfirmedAt = existing.LastConfirmedAt
		}
	} else {
		if strings.TrimSpace(account.ID) == "" {
			account.ID = NewID("wca")
		}
		if account.CreatedAt.IsZero() {
			account.CreatedAt = now
		}
		if account.LastConfirmedAt.IsZero() {
			account.LastConfirmedAt = now
		}
	}

	account.UpdatedAt = now
	s.wechatAccounts[account.ID] = cloneWeChatAccount(account)
	s.persistLocked()
	return cloneWeChatAccount(account), nil
}

func (s *MemoryStore) CreateBotConnection(connection BotConnection) (BotConnection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[connection.WorkspaceID]; !ok {
		return BotConnection{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(connection.ID) == "" {
		connection.ID = NewID("bot")
	}
	if connection.CreatedAt.IsZero() {
		connection.CreatedAt = now
	}
	if connection.UpdatedAt.IsZero() {
		connection.UpdatedAt = now
	}
	connection.AIConfig = cloneStringMap(connection.AIConfig)
	connection.Settings = cloneStringMap(connection.Settings)
	connection.Secrets = cloneStringMap(connection.Secrets)
	connection.BotID = strings.TrimSpace(connection.BotID)
	if connection.BotID != "" {
		bot, ok := s.bots[connection.BotID]
		if !ok || bot.WorkspaceID != connection.WorkspaceID {
			return BotConnection{}, ErrBotNotFound
		}
	}

	s.botConnections[connection.ID] = connection
	s.persistLocked()

	return cloneBotConnection(connection), nil
}

func (s *MemoryStore) GetBotConnection(workspaceID string, connectionID string) (BotConnection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	connection, ok := s.botConnections[connectionID]
	if !ok || connection.WorkspaceID != workspaceID {
		return BotConnection{}, false
	}

	return cloneBotConnection(connection), true
}

func (s *MemoryStore) FindBotConnection(connectionID string) (BotConnection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	connection, ok := s.botConnections[connectionID]
	if !ok {
		return BotConnection{}, false
	}

	return cloneBotConnection(connection), true
}

func (s *MemoryStore) UpdateBotConnection(
	workspaceID string,
	connectionID string,
	updater func(BotConnection) BotConnection,
) (BotConnection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	connection, ok := s.botConnections[connectionID]
	if !ok || connection.WorkspaceID != workspaceID {
		return BotConnection{}, ErrBotConnectionNotFound
	}

	next := updater(cloneBotConnection(connection))
	next.ID = connection.ID
	next.BotID = firstNonEmpty(strings.TrimSpace(next.BotID), strings.TrimSpace(connection.BotID))
	next.WorkspaceID = connection.WorkspaceID
	next.CreatedAt = connection.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.AIConfig = cloneStringMap(next.AIConfig)
	next.Settings = cloneStringMap(next.Settings)
	next.Secrets = cloneStringMap(next.Secrets)
	if next.BotID != "" {
		bot, ok := s.bots[next.BotID]
		if !ok || bot.WorkspaceID != next.WorkspaceID {
			return BotConnection{}, ErrBotNotFound
		}
	}

	s.botConnections[connectionID] = next
	s.persistLocked()

	return cloneBotConnection(next), nil
}

func (s *MemoryStore) UpdateBotConnectionRuntimeState(
	workspaceID string,
	connectionID string,
	updater func(BotConnection) BotConnection,
) (BotConnection, error) {
	return s.updateBotConnectionRuntimeState(workspaceID, connectionID, true, updater)
}

func (s *MemoryStore) UpdateBotConnectionRuntimeStateTransient(
	workspaceID string,
	connectionID string,
	updater func(BotConnection) BotConnection,
) (BotConnection, error) {
	return s.updateBotConnectionRuntimeState(workspaceID, connectionID, false, updater)
}

func (s *MemoryStore) updateBotConnectionRuntimeState(
	workspaceID string,
	connectionID string,
	persist bool,
	updater func(BotConnection) BotConnection,
) (BotConnection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	connection, ok := s.botConnections[connectionID]
	if !ok || connection.WorkspaceID != workspaceID {
		return BotConnection{}, ErrBotConnectionNotFound
	}
	if !persist {
		if err := s.flushPendingPersistenceLocked(); err != nil {
			return BotConnection{}, err
		}
	}

	next := updater(cloneBotConnection(connection))
	next.ID = connection.ID
	next.BotID = firstNonEmpty(strings.TrimSpace(next.BotID), strings.TrimSpace(connection.BotID))
	next.WorkspaceID = connection.WorkspaceID
	next.CreatedAt = connection.CreatedAt
	next.UpdatedAt = connection.UpdatedAt
	next.AIConfig = cloneStringMap(next.AIConfig)
	next.Settings = cloneStringMap(next.Settings)
	next.Secrets = cloneStringMap(next.Secrets)
	if next.BotID != "" {
		bot, ok := s.bots[next.BotID]
		if !ok || bot.WorkspaceID != next.WorkspaceID {
			return BotConnection{}, ErrBotNotFound
		}
	}

	s.botConnections[connectionID] = next
	if persist {
		delete(s.transientBotConnectionRuntime, connectionID)
		s.persistLocked()
	} else {
		s.transientBotConnectionRuntime[connectionID] = struct{}{}
		s.invalidateMemoryInspectionLocked()
	}

	return cloneBotConnection(next), nil
}

func (s *MemoryStore) DeleteBotConnection(workspaceID string, connectionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	connection, ok := s.botConnections[connectionID]
	if !ok || connection.WorkspaceID != workspaceID {
		return ErrBotConnectionNotFound
	}

	delete(s.botConnections, connectionID)
	delete(s.botConnectionLogs, connectionID)
	delete(s.transientBotConnectionRuntime, connectionID)
	delete(s.transientBotConnectionLogIDs, connectionID)
	targetIDs := make(map[string]struct{})
	for conversationID, conversation := range s.botConversations {
		if conversation.ConnectionID == connectionID && conversation.WorkspaceID == workspaceID {
			delete(s.botConversations, conversationID)
		}
	}
	for targetID, target := range s.botDeliveryTargets {
		if target.WorkspaceID == workspaceID && target.ConnectionID == connectionID {
			targetIDs[targetID] = struct{}{}
			for triggerID, trigger := range s.botTriggers {
				if trigger.WorkspaceID == workspaceID && strings.TrimSpace(trigger.DeliveryTargetID) == strings.TrimSpace(targetID) {
					delete(s.botTriggers, triggerID)
				}
			}
			delete(s.botDeliveryTargets, targetID)
		}
	}
	deleteThreadBotBindingsForTargetIDs(s.threadBotBindings, workspaceID, targetIDs)
	for deliveryID, delivery := range s.botOutbound {
		if delivery.WorkspaceID == workspaceID && delivery.ConnectionID == connectionID {
			delete(s.botOutbound, deliveryID)
		}
	}

	s.persistLocked()
	return nil
}

func (s *MemoryStore) AppendBotConnectionLog(
	workspaceID string,
	connectionID string,
	entry BotConnectionLogEntry,
) (BotConnectionLogEntry, error) {
	return s.appendBotConnectionLog(workspaceID, connectionID, entry, true)
}

func (s *MemoryStore) AppendBotConnectionLogTransient(
	workspaceID string,
	connectionID string,
	entry BotConnectionLogEntry,
) (BotConnectionLogEntry, error) {
	return s.appendBotConnectionLog(workspaceID, connectionID, entry, false)
}

func (s *MemoryStore) appendBotConnectionLog(
	workspaceID string,
	connectionID string,
	entry BotConnectionLogEntry,
	persist bool,
) (BotConnectionLogEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	connection, ok := s.botConnections[connectionID]
	if !ok || connection.WorkspaceID != workspaceID {
		return BotConnectionLogEntry{}, ErrBotConnectionNotFound
	}
	if !persist {
		if err := s.flushPendingPersistenceLocked(); err != nil {
			return BotConnectionLogEntry{}, err
		}
	}

	if entry.ID == "" {
		entry.ID = NewID("blog")
	}
	if entry.TS.IsZero() {
		entry.TS = time.Now().UTC()
	}
	entry.WorkspaceID = workspaceID
	entry.ConnectionID = connectionID
	entry.Level = strings.TrimSpace(entry.Level)
	entry.EventType = strings.TrimSpace(entry.EventType)
	entry.Message = strings.TrimSpace(entry.Message)

	logs := append(s.botConnectionLogs[connectionID], entry)
	if len(logs) > botConnectionLogRetentionLimit {
		logs = append([]BotConnectionLogEntry(nil), logs[len(logs)-botConnectionLogRetentionLimit:]...)
	}
	s.botConnectionLogs[connectionID] = logs
	if persist {
		if transientIDs, ok := s.transientBotConnectionLogIDs[connectionID]; ok {
			delete(transientIDs, entry.ID)
			if len(transientIDs) == 0 {
				delete(s.transientBotConnectionLogIDs, connectionID)
			}
		}
		s.persistLocked()
	} else {
		transientIDs := s.transientBotConnectionLogIDs[connectionID]
		if transientIDs == nil {
			transientIDs = make(map[string]struct{})
			s.transientBotConnectionLogIDs[connectionID] = transientIDs
		}
		transientIDs[entry.ID] = struct{}{}
		s.invalidateMemoryInspectionLocked()
	}

	return entry, nil
}

func (s *MemoryStore) ListBotConversations(workspaceID string, connectionID string) []BotConversation {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]BotConversation, 0)
	for _, conversation := range s.botConversations {
		if conversation.WorkspaceID != workspaceID {
			continue
		}
		if connectionID != "" && conversation.ConnectionID != connectionID {
			continue
		}
		items = append(items, cloneBotConversation(conversation))
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) GetBotConversation(workspaceID string, conversationID string) (BotConversation, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	conversation, ok := s.botConversations[conversationID]
	if !ok || conversation.WorkspaceID != workspaceID {
		return BotConversation{}, false
	}

	return cloneBotConversation(conversation), true
}

func (s *MemoryStore) FindBotConversationByExternalConversation(
	workspaceID string,
	connectionID string,
	externalConversationID string,
) (BotConversation, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	targetConversationID := strings.TrimSpace(externalConversationID)
	for _, conversation := range s.botConversations {
		if conversation.WorkspaceID != workspaceID ||
			conversation.ConnectionID != connectionID ||
			effectiveBotConversationExternalConversationID(conversation) != targetConversationID {
			continue
		}
		return cloneBotConversation(conversation), true
	}

	return BotConversation{}, false
}

func (s *MemoryStore) CreateBotConversation(conversation BotConversation) (BotConversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[conversation.WorkspaceID]; !ok {
		return BotConversation{}, ErrWorkspaceNotFound
	}
	connection, ok := s.botConnections[conversation.ConnectionID]
	if !ok || connection.WorkspaceID != conversation.WorkspaceID {
		return BotConversation{}, ErrBotConnectionNotFound
	}

	now := time.Now().UTC()
	if strings.TrimSpace(conversation.ID) == "" {
		conversation.ID = NewID("bcn")
	}
	if conversation.CreatedAt.IsZero() {
		conversation.CreatedAt = now
	}
	if conversation.UpdatedAt.IsZero() {
		conversation.UpdatedAt = now
	}
	conversation = normalizeBotConversationExternalRouting(conversation)
	conversation.BotID = firstNonEmpty(strings.TrimSpace(conversation.BotID), strings.TrimSpace(connection.BotID))
	conversation.BindingID = strings.TrimSpace(conversation.BindingID)
	if conversation.BindingID != "" {
		binding, ok := s.botBindings[conversation.BindingID]
		if !ok || binding.WorkspaceID != conversation.WorkspaceID || (conversation.BotID != "" && binding.BotID != conversation.BotID) {
			return BotConversation{}, ErrBotBindingNotFound
		}
	}
	conversation.BackendState = cloneStringMap(conversation.BackendState)
	conversation.ProviderState = cloneStringMap(conversation.ProviderState)

	s.botConversations[conversation.ID] = conversation
	s.persistLocked()

	return cloneBotConversation(conversation), nil
}

func (s *MemoryStore) UpdateBotConversation(
	workspaceID string,
	conversationID string,
	updater func(BotConversation) BotConversation,
) (BotConversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	conversation, ok := s.botConversations[conversationID]
	if !ok || conversation.WorkspaceID != workspaceID {
		return BotConversation{}, ErrBotConversationNotFound
	}

	next := updater(cloneBotConversation(conversation))
	next.ID = conversation.ID
	next.BotID = firstNonEmpty(strings.TrimSpace(next.BotID), strings.TrimSpace(conversation.BotID))
	next.BindingID = strings.TrimSpace(next.BindingID)
	next.WorkspaceID = conversation.WorkspaceID
	next.ConnectionID = conversation.ConnectionID
	next.Provider = conversation.Provider
	next.ExternalConversationID = effectiveBotConversationExternalConversationID(conversation)
	next.ExternalChatID = firstNonEmpty(strings.TrimSpace(conversation.ExternalChatID), next.ExternalConversationID)
	next.ExternalThreadID = strings.TrimSpace(conversation.ExternalThreadID)
	next.CreatedAt = conversation.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.BackendState = cloneStringMap(next.BackendState)
	next.ProviderState = cloneStringMap(next.ProviderState)
	if next.BindingID != "" {
		binding, ok := s.botBindings[next.BindingID]
		if !ok || binding.WorkspaceID != next.WorkspaceID || (next.BotID != "" && binding.BotID != next.BotID) {
			return BotConversation{}, ErrBotBindingNotFound
		}
	}

	s.botConversations[conversationID] = next
	s.persistLocked()

	return cloneBotConversation(next), nil
}

func (s *MemoryStore) ListBotDeliveryTargets(workspaceID string, botID string) []BotDeliveryTarget {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]BotDeliveryTarget, 0)
	for _, target := range s.botDeliveryTargets {
		if target.WorkspaceID != workspaceID {
			continue
		}
		if strings.TrimSpace(botID) != "" && target.BotID != botID {
			continue
		}
		items = append(items, cloneBotDeliveryTarget(target))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) GetBotDeliveryTarget(workspaceID string, targetID string) (BotDeliveryTarget, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	target, ok := s.botDeliveryTargets[targetID]
	if !ok || target.WorkspaceID != workspaceID {
		return BotDeliveryTarget{}, false
	}

	return cloneBotDeliveryTarget(target), true
}

func (s *MemoryStore) GetBotDeliveryTargetByID(targetID string) (BotDeliveryTarget, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	target, ok := s.botDeliveryTargets[targetID]
	if !ok {
		return BotDeliveryTarget{}, false
	}

	return cloneBotDeliveryTarget(target), true
}

func (s *MemoryStore) FindBotDeliveryTargetByConversation(workspaceID string, conversationID string) (BotDeliveryTarget, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	targetConversationID := strings.TrimSpace(conversationID)
	if targetConversationID == "" {
		return BotDeliveryTarget{}, false
	}

	var best BotDeliveryTarget
	found := false
	for _, target := range s.botDeliveryTargets {
		if target.WorkspaceID != workspaceID || strings.TrimSpace(target.ConversationID) != targetConversationID {
			continue
		}
		if !found || target.UpdatedAt.After(best.UpdatedAt) || (target.UpdatedAt.Equal(best.UpdatedAt) && target.ID < best.ID) {
			best = cloneBotDeliveryTarget(target)
			found = true
		}
	}

	return best, found
}

func (s *MemoryStore) CreateBotDeliveryTarget(target BotDeliveryTarget) (BotDeliveryTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[target.WorkspaceID]; !ok {
		return BotDeliveryTarget{}, ErrWorkspaceNotFound
	}
	bot, ok := s.bots[target.BotID]
	if !ok || bot.WorkspaceID != target.WorkspaceID {
		return BotDeliveryTarget{}, ErrBotNotFound
	}
	connection, ok := s.botConnections[target.ConnectionID]
	if !ok || connection.WorkspaceID != target.WorkspaceID || strings.TrimSpace(connection.BotID) != strings.TrimSpace(bot.ID) {
		return BotDeliveryTarget{}, ErrBotConnectionNotFound
	}
	if conversationID := strings.TrimSpace(target.ConversationID); conversationID != "" {
		conversation, ok := s.botConversations[conversationID]
		if !ok || conversation.WorkspaceID != target.WorkspaceID || conversation.ConnectionID != connection.ID {
			return BotDeliveryTarget{}, ErrBotConversationNotFound
		}
		if strings.TrimSpace(conversation.BotID) != "" && strings.TrimSpace(conversation.BotID) != strings.TrimSpace(bot.ID) {
			return BotDeliveryTarget{}, ErrBotConversationNotFound
		}
	}

	now := time.Now().UTC()
	if strings.TrimSpace(target.ID) == "" {
		target.ID = NewID("bdt")
	}
	if target.CreatedAt.IsZero() {
		target.CreatedAt = now
	}
	if target.UpdatedAt.IsZero() {
		target.UpdatedAt = now
	}
	target.WorkspaceID = strings.TrimSpace(target.WorkspaceID)
	target.BotID = strings.TrimSpace(target.BotID)
	target.ConnectionID = strings.TrimSpace(target.ConnectionID)
	target.ConversationID = strings.TrimSpace(target.ConversationID)
	target.Provider = firstNonEmpty(strings.TrimSpace(target.Provider), strings.TrimSpace(connection.Provider))
	target.TargetType = strings.TrimSpace(target.TargetType)
	target.RouteType = strings.TrimSpace(target.RouteType)
	target.RouteKey = strings.TrimSpace(target.RouteKey)
	target.Title = strings.TrimSpace(target.Title)
	target.Labels = normalizeStringSlice(target.Labels)
	target.Capabilities = normalizeStringSlice(target.Capabilities)
	target.ProviderState = cloneStringMap(target.ProviderState)
	target.Status = firstNonEmpty(strings.TrimSpace(target.Status), "active")
	target.LastVerifiedAt = cloneOptionalTime(target.LastVerifiedAt)

	s.botDeliveryTargets[target.ID] = target
	s.persistLocked()

	return cloneBotDeliveryTarget(target), nil
}

func (s *MemoryStore) UpdateBotDeliveryTarget(
	workspaceID string,
	targetID string,
	updater func(BotDeliveryTarget) BotDeliveryTarget,
) (BotDeliveryTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	target, ok := s.botDeliveryTargets[targetID]
	if !ok || target.WorkspaceID != workspaceID {
		return BotDeliveryTarget{}, ErrBotDeliveryTargetNotFound
	}

	next := updater(cloneBotDeliveryTarget(target))
	next.ID = target.ID
	next.WorkspaceID = target.WorkspaceID
	next.BotID = target.BotID
	next.ConnectionID = target.ConnectionID
	next.ConversationID = target.ConversationID
	next.CreatedAt = target.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.Provider = firstNonEmpty(strings.TrimSpace(next.Provider), strings.TrimSpace(target.Provider))
	next.TargetType = firstNonEmpty(strings.TrimSpace(next.TargetType), strings.TrimSpace(target.TargetType))
	next.RouteType = strings.TrimSpace(next.RouteType)
	next.RouteKey = strings.TrimSpace(next.RouteKey)
	next.Title = strings.TrimSpace(next.Title)
	next.Labels = normalizeStringSlice(next.Labels)
	next.Capabilities = normalizeStringSlice(next.Capabilities)
	next.ProviderState = cloneStringMap(next.ProviderState)
	next.Status = firstNonEmpty(strings.TrimSpace(next.Status), strings.TrimSpace(target.Status), "active")
	next.LastVerifiedAt = cloneOptionalTime(next.LastVerifiedAt)

	s.botDeliveryTargets[targetID] = next
	s.persistLocked()

	return cloneBotDeliveryTarget(next), nil
}

func (s *MemoryStore) DeleteBotDeliveryTarget(workspaceID string, targetID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	target, ok := s.botDeliveryTargets[targetID]
	if !ok || target.WorkspaceID != workspaceID {
		return ErrBotDeliveryTargetNotFound
	}

	delete(s.botDeliveryTargets, targetID)
	for triggerID, trigger := range s.botTriggers {
		if trigger.WorkspaceID == workspaceID && strings.TrimSpace(trigger.DeliveryTargetID) == strings.TrimSpace(targetID) {
			delete(s.botTriggers, triggerID)
		}
	}
	deleteThreadBotBindingsForTargetIDs(s.threadBotBindings, workspaceID, map[string]struct{}{
		strings.TrimSpace(targetID): {},
	})
	s.persistLocked()
	return nil
}

func (s *MemoryStore) ListBotOutboundDeliveries(workspaceID string, filter BotOutboundDeliveryFilter) []BotOutboundDelivery {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]BotOutboundDelivery, 0)
	filterBotID := strings.TrimSpace(filter.BotID)
	filterConnectionID := strings.TrimSpace(filter.ConnectionID)
	filterConversationID := strings.TrimSpace(filter.ConversationID)
	filterTargetID := strings.TrimSpace(filter.DeliveryTargetID)
	filterSourceType := strings.TrimSpace(filter.SourceType)
	filterSourceRefType := strings.TrimSpace(filter.SourceRefType)
	filterSourceRefID := strings.TrimSpace(filter.SourceRefID)
	filterStatus := strings.TrimSpace(filter.Status)
	for _, delivery := range s.botOutbound {
		if delivery.WorkspaceID != workspaceID {
			continue
		}
		if filterBotID != "" && delivery.BotID != filterBotID {
			continue
		}
		if filterConnectionID != "" && delivery.ConnectionID != filterConnectionID {
			continue
		}
		if filterConversationID != "" && strings.TrimSpace(delivery.ConversationID) != filterConversationID {
			continue
		}
		if filterTargetID != "" && strings.TrimSpace(delivery.DeliveryTargetID) != filterTargetID {
			continue
		}
		if filterSourceType != "" && strings.TrimSpace(delivery.SourceType) != filterSourceType {
			continue
		}
		if filterSourceRefType != "" && strings.TrimSpace(delivery.SourceRefType) != filterSourceRefType {
			continue
		}
		if filterSourceRefID != "" && strings.TrimSpace(delivery.SourceRefID) != filterSourceRefID {
			continue
		}
		if filterStatus != "" && strings.TrimSpace(delivery.Status) != filterStatus {
			continue
		}
		items = append(items, cloneBotOutboundDelivery(delivery))
	}

	sort.Slice(items, func(i int, j int) bool {
		switch {
		case items[i].CreatedAt.After(items[j].CreatedAt):
			return true
		case items[i].CreatedAt.Before(items[j].CreatedAt):
			return false
		default:
			return items[i].ID > items[j].ID
		}
	})

	return items
}

func (s *MemoryStore) GetBotOutboundDelivery(workspaceID string, deliveryID string) (BotOutboundDelivery, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	delivery, ok := s.botOutbound[deliveryID]
	if !ok || delivery.WorkspaceID != workspaceID {
		return BotOutboundDelivery{}, false
	}

	return cloneBotOutboundDelivery(delivery), true
}

func (s *MemoryStore) CreateBotOutboundDelivery(delivery BotOutboundDelivery) (BotOutboundDelivery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[delivery.WorkspaceID]; !ok {
		return BotOutboundDelivery{}, ErrWorkspaceNotFound
	}
	bot, ok := s.bots[delivery.BotID]
	if !ok || bot.WorkspaceID != delivery.WorkspaceID {
		return BotOutboundDelivery{}, ErrBotNotFound
	}
	connection, ok := s.botConnections[delivery.ConnectionID]
	if !ok || connection.WorkspaceID != delivery.WorkspaceID || strings.TrimSpace(connection.BotID) != strings.TrimSpace(bot.ID) {
		return BotOutboundDelivery{}, ErrBotConnectionNotFound
	}
	if conversationID := strings.TrimSpace(delivery.ConversationID); conversationID != "" {
		conversation, ok := s.botConversations[conversationID]
		if !ok || conversation.WorkspaceID != delivery.WorkspaceID || conversation.ConnectionID != connection.ID {
			return BotOutboundDelivery{}, ErrBotConversationNotFound
		}
		if strings.TrimSpace(conversation.BotID) != "" && strings.TrimSpace(conversation.BotID) != strings.TrimSpace(bot.ID) {
			return BotOutboundDelivery{}, ErrBotConversationNotFound
		}
	}
	if targetID := strings.TrimSpace(delivery.DeliveryTargetID); targetID != "" {
		target, ok := s.botDeliveryTargets[targetID]
		if !ok || target.WorkspaceID != delivery.WorkspaceID || target.BotID != delivery.BotID {
			return BotOutboundDelivery{}, ErrBotDeliveryTargetNotFound
		}
		if target.ConnectionID != connection.ID {
			return BotOutboundDelivery{}, ErrBotDeliveryTargetNotFound
		}
	}

	now := time.Now().UTC()
	if strings.TrimSpace(delivery.ID) == "" {
		delivery.ID = NewID("bod")
	}
	if delivery.CreatedAt.IsZero() {
		delivery.CreatedAt = now
	}
	if delivery.UpdatedAt.IsZero() {
		delivery.UpdatedAt = now
	}
	delivery.WorkspaceID = strings.TrimSpace(delivery.WorkspaceID)
	delivery.BotID = strings.TrimSpace(delivery.BotID)
	delivery.ConnectionID = strings.TrimSpace(delivery.ConnectionID)
	delivery.ConversationID = strings.TrimSpace(delivery.ConversationID)
	delivery.DeliveryTargetID = strings.TrimSpace(delivery.DeliveryTargetID)
	delivery.RunID = strings.TrimSpace(delivery.RunID)
	delivery.TriggerID = strings.TrimSpace(delivery.TriggerID)
	delivery.SourceType = strings.TrimSpace(delivery.SourceType)
	delivery.SourceRefType = strings.TrimSpace(delivery.SourceRefType)
	delivery.SourceRefID = strings.TrimSpace(delivery.SourceRefID)
	delivery.OriginWorkspaceID = strings.TrimSpace(delivery.OriginWorkspaceID)
	delivery.OriginThreadID = strings.TrimSpace(delivery.OriginThreadID)
	delivery.OriginTurnID = strings.TrimSpace(delivery.OriginTurnID)
	delivery.Messages = cloneBotReplyMessages(delivery.Messages)
	delivery.Status = firstNonEmpty(strings.TrimSpace(delivery.Status), "queued")
	delivery.IdempotencyKey = strings.TrimSpace(delivery.IdempotencyKey)
	delivery.ProviderMessageIDs = normalizeStringSlice(delivery.ProviderMessageIDs)
	delivery.LastError = strings.TrimSpace(delivery.LastError)
	delivery.DeliveredAt = cloneOptionalTime(delivery.DeliveredAt)

	s.botOutbound[delivery.ID] = delivery
	s.persistLocked()

	return cloneBotOutboundDelivery(delivery), nil
}

func (s *MemoryStore) UpdateBotOutboundDelivery(
	workspaceID string,
	deliveryID string,
	updater func(BotOutboundDelivery) BotOutboundDelivery,
) (BotOutboundDelivery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delivery, ok := s.botOutbound[deliveryID]
	if !ok || delivery.WorkspaceID != workspaceID {
		return BotOutboundDelivery{}, ErrBotOutboundDeliveryNotFound
	}

	next := updater(cloneBotOutboundDelivery(delivery))
	next.ID = delivery.ID
	next.WorkspaceID = delivery.WorkspaceID
	next.BotID = delivery.BotID
	next.ConnectionID = delivery.ConnectionID
	next.ConversationID = delivery.ConversationID
	next.DeliveryTargetID = delivery.DeliveryTargetID
	next.RunID = delivery.RunID
	next.TriggerID = delivery.TriggerID
	next.SourceType = delivery.SourceType
	next.SourceRefType = delivery.SourceRefType
	next.SourceRefID = delivery.SourceRefID
	next.OriginWorkspaceID = delivery.OriginWorkspaceID
	next.OriginThreadID = delivery.OriginThreadID
	next.OriginTurnID = delivery.OriginTurnID
	next.Messages = cloneBotReplyMessages(next.Messages)
	next.CreatedAt = delivery.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.Status = firstNonEmpty(strings.TrimSpace(next.Status), strings.TrimSpace(delivery.Status), "queued")
	next.IdempotencyKey = delivery.IdempotencyKey
	next.ProviderMessageIDs = normalizeStringSlice(next.ProviderMessageIDs)
	next.LastError = strings.TrimSpace(next.LastError)
	next.DeliveredAt = cloneOptionalTime(next.DeliveredAt)

	s.botOutbound[deliveryID] = next
	s.persistLocked()

	return cloneBotOutboundDelivery(next), nil
}

func (s *MemoryStore) UpsertBotInboundDelivery(delivery BotInboundDelivery) (BotInboundDelivery, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[delivery.WorkspaceID]; !ok {
		return BotInboundDelivery{}, false, ErrWorkspaceNotFound
	}
	connection, ok := s.botConnections[delivery.ConnectionID]
	if !ok || connection.WorkspaceID != delivery.WorkspaceID {
		return BotInboundDelivery{}, false, ErrBotConnectionNotFound
	}

	now := time.Now().UTC()
	delivery = normalizeBotInboundExternalRouting(delivery)
	lookupKey := botInboundLookupKey(
		delivery.WorkspaceID,
		delivery.ConnectionID,
		effectiveBotInboundExternalConversationID(delivery),
		strings.TrimSpace(delivery.MessageID),
	)
	if existingID, ok := s.botInboundIndex[lookupKey]; ok {
		existing := s.botInbound[existingID]
		switch strings.TrimSpace(existing.Status) {
		case "completed", "received", "processing":
			return cloneBotInboundDelivery(existing), false, nil
		case "failed":
			if botInboundDeliveryHasSavedReply(existing) {
				return cloneBotInboundDelivery(existing), false, nil
			}
			existing.Provider = delivery.Provider
			existing.ExternalConversationID = effectiveBotInboundExternalConversationID(delivery)
			existing.ExternalChatID = firstNonEmpty(strings.TrimSpace(delivery.ExternalChatID), existing.ExternalConversationID)
			existing.ExternalThreadID = strings.TrimSpace(delivery.ExternalThreadID)
			existing.UserID = delivery.UserID
			existing.Username = delivery.Username
			existing.Title = delivery.Title
			existing.Text = delivery.Text
			existing.Media = cloneBotMessageMediaList(delivery.Media)
			existing.ProviderData = cloneStringMap(delivery.ProviderData)
			existing.Status = "received"
			existing.LastError = ""
			existing.UpdatedAt = now
			s.botInbound[existing.ID] = existing
			s.persistLocked()
			return cloneBotInboundDelivery(existing), true, nil
		}
	}

	if strings.TrimSpace(delivery.ID) == "" {
		delivery.ID = NewID("bid")
	}
	if strings.TrimSpace(delivery.Provider) == "" {
		delivery.Provider = connection.Provider
	}
	delivery.Status = "received"
	delivery.LastError = ""
	delivery.AttemptCount = 0
	delivery.Media = cloneBotMessageMediaList(delivery.Media)
	delivery.ProviderData = cloneStringMap(delivery.ProviderData)
	if delivery.CreatedAt.IsZero() {
		delivery.CreatedAt = now
	}
	delivery.UpdatedAt = now

	s.botInbound[delivery.ID] = delivery
	s.botInboundIndex[lookupKey] = delivery.ID
	s.persistLocked()

	return cloneBotInboundDelivery(delivery), true, nil
}

func (s *MemoryStore) ClaimBotInboundDelivery(workspaceID string, deliveryID string) (BotInboundDelivery, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delivery, ok := s.botInbound[deliveryID]
	if !ok || delivery.WorkspaceID != workspaceID {
		return BotInboundDelivery{}, false, ErrBotInboundDeliveryNotFound
	}
	if strings.TrimSpace(delivery.Status) == "completed" || strings.TrimSpace(delivery.Status) == "processing" {
		return cloneBotInboundDelivery(delivery), false, nil
	}

	delivery.Status = "processing"
	delivery.AttemptCount += 1
	delivery.LastError = ""
	delivery.UpdatedAt = time.Now().UTC()
	s.botInbound[deliveryID] = delivery
	s.persistLocked()

	return cloneBotInboundDelivery(delivery), true, nil
}

func (s *MemoryStore) GetBotInboundDelivery(workspaceID string, deliveryID string) (BotInboundDelivery, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	delivery, ok := s.botInbound[deliveryID]
	if !ok || delivery.WorkspaceID != workspaceID {
		return BotInboundDelivery{}, false
	}
	return cloneBotInboundDelivery(delivery), true
}

func (s *MemoryStore) CompleteBotInboundDelivery(workspaceID string, deliveryID string) (BotInboundDelivery, error) {
	return s.updateBotInboundDelivery(workspaceID, deliveryID, func(current BotInboundDelivery) BotInboundDelivery {
		current.Status = "completed"
		current.LastError = ""
		return current
	})
}

func (s *MemoryStore) SaveBotInboundDeliveryReply(
	workspaceID string,
	deliveryID string,
	threadID string,
	replyMessages []BotReplyMessage,
) (BotInboundDelivery, error) {
	return s.updateBotInboundDelivery(workspaceID, deliveryID, func(current BotInboundDelivery) BotInboundDelivery {
		current.ReplyThreadID = strings.TrimSpace(threadID)
		current.ReplyMessages = cloneBotReplyMessages(replyMessages)
		return current
	})
}

func (s *MemoryStore) RecordBotInboundDeliveryReplyDelivery(
	workspaceID string,
	deliveryID string,
	status string,
	attemptCount int,
	lastError string,
	deliveredAt *time.Time,
) (BotInboundDelivery, error) {
	return s.updateBotInboundDelivery(workspaceID, deliveryID, func(current BotInboundDelivery) BotInboundDelivery {
		current.ReplyDeliveryStatus = strings.TrimSpace(status)
		current.ReplyDeliveryAttemptCount = attemptCount
		current.ReplyDeliveryLastError = strings.TrimSpace(lastError)
		current.ReplyDeliveredAt = cloneOptionalTime(deliveredAt)
		return current
	})
}

func (s *MemoryStore) FailBotInboundDelivery(workspaceID string, deliveryID string, lastError string) (BotInboundDelivery, error) {
	return s.updateBotInboundDelivery(workspaceID, deliveryID, func(current BotInboundDelivery) BotInboundDelivery {
		current.Status = "failed"
		current.LastError = strings.TrimSpace(lastError)
		return current
	})
}

func (s *MemoryStore) PrepareBotInboundDeliveriesForRecovery(
	workspaceID string,
	connectionID string,
) ([]BotInboundDelivery, []BotInboundDelivery) {
	s.mu.Lock()
	defer s.mu.Unlock()

	items := make([]BotInboundDelivery, 0)
	suppressed := make([]BotInboundDelivery, 0)
	changed := false
	for id, delivery := range s.botInbound {
		if strings.TrimSpace(workspaceID) != "" && delivery.WorkspaceID != strings.TrimSpace(workspaceID) {
			continue
		}
		if strings.TrimSpace(connectionID) != "" && delivery.ConnectionID != strings.TrimSpace(connectionID) {
			continue
		}
		switch strings.TrimSpace(delivery.Status) {
		case "processing":
			delivery.Status = "received"
			delivery.UpdatedAt = time.Now().UTC()
			s.botInbound[id] = delivery
			changed = true
			items = append(items, cloneBotInboundDelivery(delivery))
		case "failed":
			if botInboundDeliveryHasSavedReply(delivery) {
				// Do not automatically replay failed saved replies on restart.
				// Providers like WeChat and Telegram send multi-part replies sequentially,
				// so a failure may happen after some user-visible messages already landed.
				// Re-queueing those deliveries on startup duplicates old content.
				suppressed = append(suppressed, cloneBotInboundDelivery(delivery))
				continue
			}
			delivery.Status = "received"
			delivery.UpdatedAt = time.Now().UTC()
			s.botInbound[id] = delivery
			changed = true
			items = append(items, cloneBotInboundDelivery(delivery))
		case "received":
			items = append(items, cloneBotInboundDelivery(delivery))
		}
	}

	if changed {
		s.persistLocked()
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
	sort.Slice(suppressed, func(i int, j int) bool {
		if suppressed[i].CreatedAt.Equal(suppressed[j].CreatedAt) {
			return suppressed[i].ID < suppressed[j].ID
		}
		return suppressed[i].CreatedAt.Before(suppressed[j].CreatedAt)
	})

	return items, suppressed
}

func (s *MemoryStore) FindLatestFailedBotInboundDeliveryWithSavedReply(
	workspaceID string,
	connectionID string,
	externalConversationID string,
	excludeDeliveryID string,
) (BotInboundDelivery, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	targetConversationID := strings.TrimSpace(externalConversationID)
	excludedID := strings.TrimSpace(excludeDeliveryID)
	var latest BotInboundDelivery
	found := false

	for _, delivery := range s.botInbound {
		if delivery.WorkspaceID != workspaceID || delivery.ConnectionID != connectionID {
			continue
		}
		if excludedID != "" && delivery.ID == excludedID {
			continue
		}
		if strings.TrimSpace(delivery.Status) != "failed" || !botInboundDeliveryHasSavedReply(delivery) {
			continue
		}
		if effectiveBotInboundExternalConversationID(delivery) != targetConversationID {
			continue
		}
		if !found || botInboundDeliverySortsAfter(delivery, latest) {
			latest = cloneBotInboundDelivery(delivery)
			found = true
		}
	}

	return latest, found
}

func (s *MemoryStore) updateBotInboundDelivery(
	workspaceID string,
	deliveryID string,
	updater func(BotInboundDelivery) BotInboundDelivery,
) (BotInboundDelivery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delivery, ok := s.botInbound[deliveryID]
	if !ok || delivery.WorkspaceID != workspaceID {
		return BotInboundDelivery{}, ErrBotInboundDeliveryNotFound
	}

	next := updater(cloneBotInboundDelivery(delivery))
	next.ID = delivery.ID
	next.WorkspaceID = delivery.WorkspaceID
	next.ConnectionID = delivery.ConnectionID
	next.Provider = delivery.Provider
	next.ExternalConversationID = effectiveBotInboundExternalConversationID(delivery)
	next.ExternalChatID = firstNonEmpty(strings.TrimSpace(delivery.ExternalChatID), next.ExternalConversationID)
	next.ExternalThreadID = strings.TrimSpace(delivery.ExternalThreadID)
	next.MessageID = delivery.MessageID
	next.CreatedAt = delivery.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.Media = cloneBotMessageMediaList(next.Media)
	next.ProviderData = cloneStringMap(next.ProviderData)

	s.botInbound[deliveryID] = next
	s.persistLocked()
	return cloneBotInboundDelivery(next), nil
}

func botInboundLookupKey(workspaceID string, connectionID string, externalChatID string, messageID string) string {
	trimmedMessageID := strings.TrimSpace(messageID)
	if trimmedMessageID == "" {
		return NewID("bidk")
	}
	return strings.TrimSpace(workspaceID) + "\x00" +
		strings.TrimSpace(connectionID) + "\x00" +
		strings.TrimSpace(externalChatID) + "\x00" +
		trimmedMessageID
}

func (s *MemoryStore) CreateAutomation(automation Automation) (Automation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[automation.WorkspaceID]; !ok {
		return Automation{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	automation.ID = NewID("aut")
	automation.CreatedAt = now
	automation.UpdatedAt = now

	s.automations[automation.ID] = automation
	s.persistLocked()

	return automation, nil
}

func (s *MemoryStore) GetAutomation(automationID string) (Automation, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	automation, ok := s.automations[automationID]
	return automation, ok
}

func (s *MemoryStore) UpdateAutomation(
	automationID string,
	updater func(Automation) Automation,
) (Automation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	automation, ok := s.automations[automationID]
	if !ok {
		return Automation{}, ErrAutomationNotFound
	}

	next := updater(automation)
	next.ID = automation.ID
	next.CreatedAt = automation.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	s.automations[automationID] = next
	s.persistLocked()

	return next, nil
}

func (s *MemoryStore) DeleteAutomation(automationID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.automations[automationID]; !ok {
		return ErrAutomationNotFound
	}

	delete(s.automations, automationID)
	for runID, run := range s.runs {
		if run.AutomationID == automationID {
			delete(s.runs, runID)
		}
	}
	for notificationID, notification := range s.notifications {
		if notification.AutomationID == automationID {
			delete(s.notifications, notificationID)
		}
	}
	s.persistLocked()
	return nil
}

func (s *MemoryStore) ListThreads(workspaceID string) []Thread {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]Thread, 0)
	for _, thread := range s.threads {
		if thread.WorkspaceID == workspaceID {
			items = append(items, thread)
		}
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) CreateThread(workspaceID string, name string) (Thread, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspace, ok := s.workspaces[workspaceID]
	if !ok {
		return Thread{}, ErrWorkspaceNotFound
	}

	now := time.Now().UTC()
	thread := Thread{
		ID:          NewID("thr"),
		WorkspaceID: workspaceID,
		Name:        name,
		Status:      "idle",
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.threads[thread.ID] = thread
	workspace.UpdatedAt = now
	s.workspaces[workspaceID] = workspace
	s.persistLocked()

	return thread, nil
}

func (s *MemoryStore) GetThread(workspaceID string, threadID string) (Thread, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, deleted := s.deleted[deletedThreadKey(workspaceID, threadID)]; deleted {
		return Thread{}, false
	}

	thread, ok := s.threads[threadID]
	if !ok || thread.WorkspaceID != workspaceID {
		return Thread{}, false
	}

	return thread, true
}

func (s *MemoryStore) SetThreadSessionStartSource(workspaceID string, threadID string, source string, pending bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	normalizedSource := strings.TrimSpace(source)
	pendingKey := pendingSessionStartKey(workspaceID, threadID)
	if normalizedSource == "" {
		delete(s.pendingSessionStarts, pendingKey)
		return
	}

	if thread, ok := s.threads[threadID]; ok && thread.WorkspaceID == workspaceID {
		thread.SessionStartSource = normalizedSource
		s.threads[threadID] = thread
		s.persistLocked()
	}

	if pending {
		s.pendingSessionStarts[pendingKey] = normalizedSource
		return
	}
	delete(s.pendingSessionStarts, pendingKey)
}

func (s *MemoryStore) PendingThreadSessionStartSource(workspaceID string, threadID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return strings.TrimSpace(s.pendingSessionStarts[pendingSessionStartKey(workspaceID, threadID)])
}

func (s *MemoryStore) ClearPendingThreadSessionStartSource(workspaceID string, threadID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.pendingSessionStarts, pendingSessionStartKey(workspaceID, threadID))
}

func (s *MemoryStore) SetThreadStatus(workspaceID string, threadID string, status string) (Thread, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	thread, ok := s.threads[threadID]
	if !ok || thread.WorkspaceID != workspaceID {
		return Thread{}, ErrThreadNotFound
	}

	thread.Status = status
	thread.UpdatedAt = time.Now().UTC()
	s.threads[threadID] = thread
	s.persistLocked()

	return thread, nil
}

func (s *MemoryStore) SetThreadName(workspaceID string, threadID string, name string) (Thread, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	thread, ok := s.threads[threadID]
	if !ok || thread.WorkspaceID != workspaceID {
		return Thread{}, ErrThreadNotFound
	}

	thread.Name = name
	thread.UpdatedAt = time.Now().UTC()
	s.threads[threadID] = thread
	s.persistLocked()

	return thread, nil
}

func (s *MemoryStore) SetThreadArchived(workspaceID string, threadID string, archived bool) (Thread, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	thread, ok := s.threads[threadID]
	if !ok || thread.WorkspaceID != workspaceID {
		return Thread{}, ErrThreadNotFound
	}

	thread.Archived = archived
	thread.UpdatedAt = time.Now().UTC()
	s.threads[threadID] = thread
	s.persistLocked()

	return thread, nil
}

func (s *MemoryStore) UpsertThread(thread Thread) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, deleted := s.deleted[deletedThreadKey(thread.WorkspaceID, thread.ID)]; deleted {
		delete(s.threads, thread.ID)
		delete(s.projections, threadProjectionKey(thread.WorkspaceID, thread.ID))
		s.persistLocked()
		return
	}

	s.threads[thread.ID] = thread
	if workspace, ok := s.workspaces[thread.WorkspaceID]; ok && thread.UpdatedAt.After(workspace.UpdatedAt) {
		workspace.UpdatedAt = thread.UpdatedAt
		s.workspaces[thread.WorkspaceID] = workspace
	}
	s.persistLocked()
}

func (s *MemoryStore) GetThreadProjection(workspaceID string, threadID string) (ThreadProjection, bool) {
	s.mu.RLock()
	record, ok := s.projections[threadProjectionKey(workspaceID, threadID)]
	s.mu.RUnlock()
	if !ok {
		return ThreadProjection{}, false
	}

	return materializeThreadProjectionRecord(record), true
}

func (s *MemoryStore) GetThreadProjectionWindow(
	workspaceID string,
	threadID string,
	turnLimit int,
	beforeTurnID string,
) (ThreadProjectionWindow, bool) {
	s.mu.RLock()
	record, ok := s.projections[threadProjectionKey(workspaceID, threadID)]
	s.mu.RUnlock()
	if !ok {
		return ThreadProjectionWindow{}, false
	}

	return materializeThreadProjectionWindow(record, turnLimit, beforeTurnID), true
}

func (s *MemoryStore) GetThreadProjectionSummary(workspaceID string, threadID string) (ThreadProjection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	record, ok := s.projections[threadProjectionKey(workspaceID, threadID)]
	if !ok {
		return ThreadProjection{}, false
	}

	return cloneThreadProjectionMetadata(record.Projection), true
}

func (s *MemoryStore) ListThreadProjections(workspaceID string, threadID string) []ThreadProjection {
	s.mu.RLock()
	filterWorkspaceID := strings.TrimSpace(workspaceID)
	filterThreadID := strings.TrimSpace(threadID)
	records := make([]threadProjectionRecord, 0)
	for _, projection := range s.projections {
		if filterWorkspaceID != "" && projection.Projection.WorkspaceID != filterWorkspaceID {
			continue
		}
		if filterThreadID != "" && projection.Projection.ThreadID != filterThreadID {
			continue
		}
		records = append(records, projection)
	}
	s.mu.RUnlock()

	items := make([]ThreadProjection, 0, len(records))
	for _, record := range records {
		items = append(items, materializeThreadProjectionRecord(record))
	}

	sort.Slice(items, func(i int, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ThreadID > items[j].ThreadID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *MemoryStore) UpsertThreadProjectionSnapshot(detail ThreadDetail) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, deleted := s.deleted[deletedThreadKey(detail.WorkspaceID, detail.ID)]; deleted {
		delete(s.projections, threadProjectionKey(detail.WorkspaceID, detail.ID))
		s.persistLocked()
		return
	}

	projection := ThreadProjection{
		WorkspaceID:      detail.WorkspaceID,
		ThreadID:         detail.ID,
		Cwd:              detail.Cwd,
		Preview:          detail.Preview,
		Path:             detail.Path,
		Source:           detail.Source,
		Status:           detail.Status,
		UpdatedAt:        detail.UpdatedAt,
		TokenUsage:       cloneThreadTokenUsage(detail.TokenUsage),
		TurnCount:        detail.TurnCount,
		MessageCount:     detail.MessageCount,
		SnapshotComplete: true,
		Turns:            compactProjectedThreadTurns(detail.Turns),
	}
	if projection.TurnCount == 0 && len(projection.Turns) > 0 {
		projection.TurnCount = projectedConversationTurnCount(projection.Turns)
	}
	if projection.MessageCount == 0 && len(projection.Turns) > 0 {
		projection.MessageCount = projectedMessageCount(projection.Turns)
	}
	record := newColdThreadProjectionRecord(projection)
	current := s.projections[threadProjectionKey(detail.WorkspaceID, detail.ID)]
	if threadProjectionSnapshotEqual(current, record) {
		return
	}
	s.projections[threadProjectionKey(detail.WorkspaceID, detail.ID)] = record
	s.persistLocked()
}

func (s *MemoryStore) ApplyThreadEvent(event EventEnvelope) {
	if event.ThreadID == "" {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	key := threadProjectionKey(event.WorkspaceID, event.ThreadID)
	record := s.projections[key]
	projection := record.Projection
	if projection.ThreadID == "" {
		projection = ThreadProjection{
			WorkspaceID:  event.WorkspaceID,
			ThreadID:     event.ThreadID,
			TurnCount:    0,
			MessageCount: 0,
			Turns:        []ThreadTurn{},
		}
		record = threadProjectionRecord{Projection: projection}
	} else if projection.Turns == nil {
		projection.Turns = decodeThreadProjectionTurns(threadProjectionRecordTurnsRaw(record))
		record.TurnsRaw = nil
		record.TurnsCompressed = nil
	}
	beforeStatus := projection.Status
	beforeTurnCount := len(projection.Turns)
	beforeMessageCount := projection.MessageCount

	if !applyThreadEventToProjection(&projection, event) {
		if diagnostics.ShouldLogEventTrace("thread projection ignored event", event.Method) {
			diagnostics.LogThreadTrace(
				event.WorkspaceID,
				event.ThreadID,
				"thread projection ignored event",
				diagnostics.EventTraceAttrs(event.Method, event.TurnID, event.Payload)...,
			)
		}
		return
	}

	record.Projection = projection
	record.StatsDirty = true
	record.SnapshotDirty = true
	s.projections[key] = record
	s.invalidateMemoryInspectionLocked()
	if diagnostics.ShouldLogEventTrace("thread projection updated", event.Method) {
		diagnostics.LogThreadTrace(
			event.WorkspaceID,
			event.ThreadID,
			"thread projection updated",
			append(
				diagnostics.EventTraceAttrs(event.Method, event.TurnID, event.Payload),
				"statusBefore",
				beforeStatus,
				"statusAfter",
				projection.Status,
				"turnCountBefore",
				beforeTurnCount,
				"turnCountAfter",
				len(projection.Turns),
				"messageCountBefore",
				beforeMessageCount,
				"messageCountAfter",
				projection.MessageCount,
				"snapshotComplete",
				projection.SnapshotComplete,
			)...,
		)
	}
	// Delta events can arrive at very high frequency while a turn is streaming.
	// Keep the in-memory projection hot, but avoid rewriting the full store file
	// for every incremental chunk. A later lifecycle event or snapshot refresh
	// will persist the settled state.
	if shouldPersistThreadProjectionEvent(event.Method) {
		s.persistLocked()
	}
}

func (s *MemoryStore) RemoveThread(workspaceID string, threadID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	thread, ok := s.threads[threadID]
	if !ok || thread.WorkspaceID != workspaceID {
		return
	}

	delete(s.threads, threadID)
	delete(s.pendingSessionStarts, pendingSessionStartKey(workspaceID, threadID))
	delete(s.projections, threadProjectionKey(workspaceID, threadID))
	s.persistLocked()
}

func (s *MemoryStore) DeleteThread(workspaceID string, threadID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspace, ok := s.workspaces[workspaceID]
	if !ok {
		return ErrWorkspaceNotFound
	}

	key := deletedThreadKey(workspaceID, threadID)
	if _, deleted := s.deleted[key]; deleted {
		return ErrThreadNotFound
	}

	if thread, ok := s.threads[threadID]; ok && thread.WorkspaceID != workspaceID {
		return ErrThreadNotFound
	}

	now := time.Now().UTC()
	s.deleted[key] = DeletedThread{
		WorkspaceID: workspaceID,
		ThreadID:    threadID,
		DeletedAt:   now,
	}
	delete(s.threads, threadID)
	delete(s.pendingSessionStarts, pendingSessionStartKey(workspaceID, threadID))
	delete(s.projections, threadProjectionKey(workspaceID, threadID))
	delete(s.threadBotBindings, threadBotBindingKey(workspaceID, threadID))
	for hookRunID, hookRun := range s.hookRuns {
		if hookRun.WorkspaceID == workspaceID && hookRun.ThreadID == threadID {
			delete(s.hookRuns, hookRunID)
		}
	}
	workspace.UpdatedAt = now
	s.workspaces[workspaceID] = workspace
	s.persistLocked()

	return nil
}

func (s *MemoryStore) IsThreadDeleted(workspaceID string, threadID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	_, ok := s.deleted[deletedThreadKey(workspaceID, threadID)]
	return ok
}

func (s *MemoryStore) DeleteWorkspace(workspaceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaces[workspaceID]; !ok {
		return ErrWorkspaceNotFound
	}

	delete(s.workspaces, workspaceID)

	for automationID, automation := range s.automations {
		if automation.WorkspaceID == workspaceID {
			delete(s.automations, automationID)
		}
	}
	for runID, run := range s.runs {
		if run.WorkspaceID == workspaceID {
			delete(s.runs, runID)
		}
	}
	for notificationID, notification := range s.notifications {
		if notification.WorkspaceID == workspaceID {
			delete(s.notifications, notificationID)
		}
	}
	for subscriptionID, subscription := range s.notificationSubscriptions {
		if subscription.WorkspaceID == workspaceID {
			delete(s.notificationSubscriptions, subscriptionID)
		}
	}
	for targetID, target := range s.notificationEmailTargets {
		if target.WorkspaceID == workspaceID {
			delete(s.notificationEmailTargets, targetID)
		}
	}
	delete(s.notificationMailServerConfigs, workspaceID)
	for dispatchID, dispatch := range s.notificationDispatches {
		if dispatch.WorkspaceID == workspaceID {
			delete(s.notificationDispatches, dispatchID)
		}
	}
	for botID, bot := range s.bots {
		if bot.WorkspaceID == workspaceID {
			delete(s.bots, botID)
		}
	}
	for bindingID, binding := range s.botBindings {
		if binding.WorkspaceID == workspaceID {
			delete(s.botBindings, bindingID)
		}
	}
	for key, binding := range s.threadBotBindings {
		if binding.WorkspaceID == workspaceID || normalizeThreadBotBindingBotWorkspaceID(binding) == workspaceID {
			delete(s.threadBotBindings, key)
		}
	}
	for triggerID, trigger := range s.botTriggers {
		if trigger.WorkspaceID == workspaceID {
			delete(s.botTriggers, triggerID)
		}
	}
	for connectionID, connection := range s.botConnections {
		if connection.WorkspaceID == workspaceID {
			delete(s.botConnections, connectionID)
			delete(s.botConnectionLogs, connectionID)
		}
	}
	for conversationID, conversation := range s.botConversations {
		if conversation.WorkspaceID == workspaceID {
			delete(s.botConversations, conversationID)
		}
	}
	for targetID, target := range s.botDeliveryTargets {
		if target.WorkspaceID == workspaceID {
			delete(s.botDeliveryTargets, targetID)
		}
	}
	for deliveryID, delivery := range s.botOutbound {
		if delivery.WorkspaceID == workspaceID {
			delete(s.botOutbound, deliveryID)
		}
	}
	for decisionID, decision := range s.turnPolicyDecisions {
		if decision.WorkspaceID == workspaceID {
			delete(s.turnPolicyDecisions, decisionID)
		}
	}
	for hookRunID, hookRun := range s.hookRuns {
		if hookRun.WorkspaceID == workspaceID {
			delete(s.hookRuns, hookRunID)
		}
	}
	delete(s.commandSessions, workspaceID)
	delete(s.workspaceEventSeq, workspaceID)
	delete(s.workspaceEvents, workspaceID)

	for threadID, thread := range s.threads {
		if thread.WorkspaceID == workspaceID {
			delete(s.threads, threadID)
		}
	}
	for key, projection := range s.projections {
		if projection.Projection.WorkspaceID == workspaceID {
			delete(s.projections, key)
		}
	}

	for key, deletedThread := range s.deleted {
		if deletedThread.WorkspaceID == workspaceID {
			delete(s.deleted, key)
		}
	}

	for approvalID, approval := range s.approvals {
		if approval.WorkspaceID == workspaceID {
			delete(s.approvals, approvalID)
		}
	}

	s.persistLocked()
	return nil
}

func (s *MemoryStore) CreatePendingApproval(workspaceID string, threadID string, kind string, summary string) PendingApproval {
	s.mu.Lock()
	defer s.mu.Unlock()

	approval := PendingApproval{
		ID:          NewID("req"),
		WorkspaceID: workspaceID,
		ThreadID:    threadID,
		Kind:        kind,
		Summary:     summary,
		Status:      "pending",
		RequestedAt: time.Now().UTC(),
	}

	s.approvals[approval.ID] = approval
	return approval
}

func (s *MemoryStore) ListPendingApprovals(workspaceID string) []PendingApproval {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]PendingApproval, 0)
	for _, approval := range s.approvals {
		if approval.WorkspaceID == workspaceID && approval.Status == "pending" {
			items = append(items, approval)
		}
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].RequestedAt.After(items[j].RequestedAt)
	})

	return items
}

func (s *MemoryStore) GetPendingApproval(requestID string) (PendingApproval, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	approval, ok := s.approvals[requestID]
	return approval, ok
}

func (s *MemoryStore) SetApprovalStatus(requestID string, status string) (PendingApproval, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	approval, ok := s.approvals[requestID]
	if !ok {
		return PendingApproval{}, ErrApprovalNotFound
	}

	approval.Status = status
	s.approvals[requestID] = approval

	return approval, nil
}

func (s *MemoryStore) requestFlushLocked() {
	if s.path == "" || s.flushClosed || s.flushCh == nil || s.flushQueued {
		return
	}

	s.flushQueued = true
	select {
	case s.flushCh <- struct{}{}:
	default:
	}
}

func (s *MemoryStore) flushWorker() {
	defer s.flushWG.Done()

	for {
		select {
		case <-s.flushStopCh:
			return
		case <-s.flushCh:
		}

		timer := time.NewTimer(persistentStoreFlushDebounce)
	debounceLoop:
		for {
			select {
			case <-s.flushStopCh:
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				return
			case <-s.flushCh:
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(persistentStoreFlushDebounce)
			case <-timer.C:
				break debounceLoop
			}
		}

		s.mu.Lock()
		if s.flushClosed {
			s.flushQueued = false
			s.flushCond.Broadcast()
			s.mu.Unlock()
			return
		}
		if !s.flushDirty {
			s.flushQueued = false
			s.flushCond.Broadcast()
			s.mu.Unlock()
			continue
		}

		s.flushInProgress = true
		err := s.persistNowLocked()
		s.flushInProgress = false
		s.flushLastErr = err
		if err == nil {
			s.flushDirty = false
			s.flushCompleted = s.flushVersion
		}
		s.flushQueued = false
		s.flushCond.Broadcast()
		s.mu.Unlock()
	}
}

func (s *MemoryStore) Flush() error {
	if s == nil || s.path == "" {
		return nil
	}

	s.mu.Lock()
	targetVersion := s.flushVersion
	if !s.flushDirty && !s.flushInProgress && s.flushCompleted >= targetVersion {
		err := s.flushLastErr
		s.mu.Unlock()
		return err
	}

	s.requestFlushLocked()
	for {
		if !s.flushDirty && !s.flushInProgress && s.flushCompleted >= targetVersion {
			err := s.flushLastErr
			s.mu.Unlock()
			return err
		}
		if s.flushLastErr != nil && !s.flushQueued && !s.flushInProgress && s.flushCompleted < targetVersion {
			err := s.flushLastErr
			s.mu.Unlock()
			return err
		}
		if s.flushDirty && !s.flushQueued && !s.flushInProgress {
			s.requestFlushLocked()
		}
		s.flushCond.Wait()
	}
}

func (s *MemoryStore) flushPendingPersistenceLocked() error {
	if s == nil || s.path == "" {
		return nil
	}

	for s.flushInProgress {
		s.flushCond.Wait()
	}

	if !s.flushDirty {
		return s.flushLastErr
	}

	s.flushInProgress = true
	err := s.persistNowLocked()
	s.flushInProgress = false
	s.flushLastErr = err
	if err == nil {
		s.flushDirty = false
		s.flushCompleted = s.flushVersion
	}
	s.flushCond.Broadcast()
	return err
}

func (s *MemoryStore) Close() error {
	if s == nil {
		return nil
	}

	if err := s.Flush(); err != nil {
		return err
	}

	s.mu.Lock()
	if s.path == "" || s.flushClosed {
		s.mu.Unlock()
		unregisterPersistentStore(s.path, s)
		return nil
	}
	s.flushClosed = true
	close(s.flushStopCh)
	s.flushCond.Broadcast()
	s.mu.Unlock()

	s.flushWG.Wait()
	unregisterPersistentStore(s.path, s)
	return nil
}

func (s *MemoryStore) load() error {
	if s.path == "" {
		return nil
	}

	file, err := os.Open(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	rootToken, err := decoder.Token()
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err != nil {
		return err
	}
	if rootToken == nil {
		return nil
	}

	rootDelim, ok := rootToken.(json.Delim)
	if !ok || rootDelim != '{' {
		return errors.New("store metadata root must be object")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var maxID uint64
	storeMutatedDuringLoad := false
	pendingConnectionLogs := make([]BotConnectionLogEntry, 0)

	for decoder.More() {
		fieldToken, err := decoder.Token()
		if err != nil {
			return err
		}

		fieldName, ok := fieldToken.(string)
		if !ok {
			return errors.New("store metadata object field must be string")
		}

		switch fieldName {
		case "runtimePreferences":
			var prefs *RuntimePreferences
			if err := decoder.Decode(&prefs); err != nil {
				return err
			}
			if prefs != nil {
				s.runtimePrefs = normalizeLoadedRuntimePreferences(*prefs)
			}
		case "workspaces":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var workspace Workspace
				if err := decoder.Decode(&workspace); err != nil {
					return err
				}
				s.workspaces[workspace.ID] = workspace
				updateLoadedMaxID(&maxID, workspace.ID)
				return nil
			}); err != nil {
				return err
			}
		case "commandSessions":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var session CommandSessionSnapshot
				if err := decoder.Decode(&session); err != nil {
					return err
				}
				workspaceSessions := s.commandSessions[session.WorkspaceID]
				if workspaceSessions == nil {
					workspaceSessions = make(map[string]CommandSessionSnapshot)
					s.commandSessions[session.WorkspaceID] = workspaceSessions
				}
				workspaceSessions[session.ID] = session
				updateLoadedMaxID(&maxID, session.ID)
				return nil
			}); err != nil {
				return err
			}
		case "workspaceEvents":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var log storedWorkspaceEventLog
				if err := decoder.Decode(&log); err != nil {
					return err
				}

				workspaceID := strings.TrimSpace(log.WorkspaceID)
				if workspaceID == "" {
					return nil
				}

				events := cloneEventEnvelopes(log.Events)
				var maxSeq uint64
				for index := range events {
					events[index].Replay = false
					if events[index].Seq > maxSeq {
						maxSeq = events[index].Seq
					}
				}
				sort.Slice(events, func(i int, j int) bool {
					return events[i].Seq < events[j].Seq
				})
				if len(events) > workspaceEventRetentionLimit {
					events = append([]EventEnvelope(nil), events[len(events)-workspaceEventRetentionLimit:]...)
				}

				s.workspaceEvents[workspaceID] = events
				headSeq := maxSeq
				if log.NextSeq > 0 && log.NextSeq-1 > headSeq {
					headSeq = log.NextSeq - 1
				}
				s.workspaceEventSeq[workspaceID] = headSeq
				return nil
			}); err != nil {
				return err
			}
		case "automations":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var automation Automation
				if err := decoder.Decode(&automation); err != nil {
					return err
				}
				s.automations[automation.ID] = automation
				updateLoadedMaxID(&maxID, automation.ID)
				return nil
			}); err != nil {
				return err
			}
		case "automationTemplates":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var template AutomationTemplate
				if err := decoder.Decode(&template); err != nil {
					return err
				}
				s.templates[template.ID] = template
				updateLoadedMaxID(&maxID, template.ID)
				return nil
			}); err != nil {
				return err
			}
		case "automationRuns":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var run AutomationRun
				if err := decoder.Decode(&run); err != nil {
					return err
				}
				s.runs[run.ID] = cloneAutomationRun(run)
				updateLoadedMaxID(&maxID, run.ID)
				for _, entry := range run.Logs {
					updateLoadedMaxID(&maxID, entry.ID)
				}
				return nil
			}); err != nil {
				return err
			}
		case "notifications":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var notification Notification
				if err := decoder.Decode(&notification); err != nil {
					return err
				}
				s.notifications[notification.ID] = notification
				updateLoadedMaxID(&maxID, notification.ID)
				return nil
			}); err != nil {
				return err
			}
		case "notificationSubscriptions":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var subscription NotificationSubscription
				if err := decoder.Decode(&subscription); err != nil {
					return err
				}
				s.notificationSubscriptions[subscription.ID] = cloneNotificationSubscription(subscription)
				updateLoadedMaxID(&maxID, subscription.ID)
				return nil
			}); err != nil {
				return err
			}
		case "notificationEmailTargets":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var target NotificationEmailTarget
				if err := decoder.Decode(&target); err != nil {
					return err
				}
				s.notificationEmailTargets[target.ID] = cloneNotificationEmailTarget(target)
				updateLoadedMaxID(&maxID, target.ID)
				return nil
			}); err != nil {
				return err
			}
		case "notificationMailServerConfigs":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var config NotificationMailServerConfig
				if err := decoder.Decode(&config); err != nil {
					return err
				}
				s.notificationMailServerConfigs[config.WorkspaceID] = cloneNotificationMailServerConfig(config)
				return nil
			}); err != nil {
				return err
			}
		case "notificationDispatches":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var dispatch NotificationDispatch
				if err := decoder.Decode(&dispatch); err != nil {
					return err
				}
				s.notificationDispatches[dispatch.ID] = cloneNotificationDispatch(dispatch)
				updateLoadedMaxID(&maxID, dispatch.ID)
				return nil
			}); err != nil {
				return err
			}
		case "turnPolicyDecisions":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var decision TurnPolicyDecision
				if err := decoder.Decode(&decision); err != nil {
					return err
				}
				s.turnPolicyDecisions[decision.ID] = cloneTurnPolicyDecision(decision)
				updateLoadedMaxID(&maxID, decision.ID)
				return nil
			}); err != nil {
				return err
			}
		case "hookRuns":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var run HookRun
				if err := decoder.Decode(&run); err != nil {
					return err
				}
				s.hookRuns[run.ID] = cloneHookRun(run)
				updateLoadedMaxID(&maxID, run.ID)
				return nil
			}); err != nil {
				return err
			}
		case "bots":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var bot Bot
				if err := decoder.Decode(&bot); err != nil {
					return err
				}
				s.bots[bot.ID] = cloneBot(bot)
				updateLoadedMaxID(&maxID, bot.ID)
				return nil
			}); err != nil {
				return err
			}
		case "botBindings":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var binding BotBinding
				if err := decoder.Decode(&binding); err != nil {
					return err
				}
				s.botBindings[binding.ID] = cloneBotBinding(binding)
				updateLoadedMaxID(&maxID, binding.ID)
				return nil
			}); err != nil {
				return err
			}
		case "threadBotBindings":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var binding ThreadBotBinding
				if err := decoder.Decode(&binding); err != nil {
					return err
				}
				s.threadBotBindings[threadBotBindingKey(binding.WorkspaceID, binding.ThreadID)] = cloneThreadBotBinding(binding)
				updateLoadedMaxID(&maxID, binding.ID)
				return nil
			}); err != nil {
				return err
			}
		case "botTriggers":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var trigger BotTrigger
				if err := decoder.Decode(&trigger); err != nil {
					return err
				}
				s.botTriggers[trigger.ID] = cloneBotTrigger(trigger)
				updateLoadedMaxID(&maxID, trigger.ID)
				return nil
			}); err != nil {
				return err
			}
		case "botConnections":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var connection BotConnection
				if err := decoder.Decode(&connection); err != nil {
					return err
				}
				s.botConnections[connection.ID] = cloneBotConnection(connection)
				updateLoadedMaxID(&maxID, connection.ID)
				return nil
			}); err != nil {
				return err
			}
		case "botConnectionLogs":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var entry BotConnectionLogEntry
				if err := decoder.Decode(&entry); err != nil {
					return err
				}
				pendingConnectionLogs = append(pendingConnectionLogs, entry)
				updateLoadedMaxID(&maxID, entry.ID)
				return nil
			}); err != nil {
				return err
			}
		case "wechatAccounts":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var account WeChatAccount
				if err := decoder.Decode(&account); err != nil {
					return err
				}
				s.wechatAccounts[account.ID] = cloneWeChatAccount(account)
				updateLoadedMaxID(&maxID, account.ID)
				return nil
			}); err != nil {
				return err
			}
		case "botConversations":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var conversation BotConversation
				if err := decoder.Decode(&conversation); err != nil {
					return err
				}
				s.botConversations[conversation.ID] = cloneBotConversation(conversation)
				updateLoadedMaxID(&maxID, conversation.ID)
				return nil
			}); err != nil {
				return err
			}
		case "botDeliveryTargets":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var target BotDeliveryTarget
				if err := decoder.Decode(&target); err != nil {
					return err
				}
				s.botDeliveryTargets[target.ID] = cloneBotDeliveryTarget(target)
				updateLoadedMaxID(&maxID, target.ID)
				return nil
			}); err != nil {
				return err
			}
		case "botInbound":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var delivery BotInboundDelivery
				if err := decoder.Decode(&delivery); err != nil {
					return err
				}
				s.botInbound[delivery.ID] = cloneBotInboundDelivery(delivery)
				s.botInboundIndex[botInboundLookupKey(
					delivery.WorkspaceID,
					delivery.ConnectionID,
					effectiveBotInboundExternalConversationID(delivery),
					delivery.MessageID,
				)] = delivery.ID
				updateLoadedMaxID(&maxID, delivery.ID)
				return nil
			}); err != nil {
				return err
			}
		case "botOutbound":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var delivery BotOutboundDelivery
				if err := decoder.Decode(&delivery); err != nil {
					return err
				}
				s.botOutbound[delivery.ID] = cloneBotOutboundDelivery(delivery)
				updateLoadedMaxID(&maxID, delivery.ID)
				return nil
			}); err != nil {
				return err
			}
		case "threads":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var thread Thread
				if err := decoder.Decode(&thread); err != nil {
					return err
				}
				s.threads[thread.ID] = thread
				updateLoadedMaxID(&maxID, thread.ID)
				return nil
			}); err != nil {
				return err
			}
		case "threadProjections":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var projection storedThreadProjection
				if err := decoder.Decode(&projection); err != nil {
					return err
				}
				compactedProjection, mutated := normalizeStoredThreadProjection(s.path, projection)
				if mutated {
					storeMutatedDuringLoad = true
				}
				s.projections[threadProjectionKey(compactedProjection.Projection.WorkspaceID, compactedProjection.Projection.ThreadID)] = compactedProjection
				return nil
			}); err != nil {
				return err
			}
		case "deletedThreads":
			if err := decodeJSONArray(decoder, func(decoder *json.Decoder) error {
				var deletedThread DeletedThread
				if err := decoder.Decode(&deletedThread); err != nil {
					return err
				}
				s.deleted[deletedThreadKey(deletedThread.WorkspaceID, deletedThread.ThreadID)] = deletedThread
				return nil
			}); err != nil {
				return err
			}
		default:
			if err := discardJSONValue(decoder); err != nil {
				return err
			}
		}
	}

	endToken, err := decoder.Token()
	if err != nil {
		return err
	}
	endDelim, ok := endToken.(json.Delim)
	if !ok || endDelim != '}' {
		return errors.New("store metadata root must terminate with object end")
	}

	for _, workspaceSessions := range s.commandSessions {
		beforeCount := len(workspaceSessions)
		pruneCommandSessionsLocked(workspaceSessions)
		if len(workspaceSessions) != beforeCount {
			storeMutatedDuringLoad = true
		}
	}

	for _, entry := range pendingConnectionLogs {
		connection, ok := s.botConnections[entry.ConnectionID]
		if !ok || connection.WorkspaceID != entry.WorkspaceID {
			continue
		}
		s.botConnectionLogs[entry.ConnectionID] = append(s.botConnectionLogs[entry.ConnectionID], entry)
	}

	if migrateBotTopologyLocked(s) {
		storeMutatedDuringLoad = true
	}

	SeedIDCounter(maxID)
	if storeMutatedDuringLoad {
		s.persistLocked()
	}
	return nil
}

func normalizeLoadedRuntimePreferences(prefs RuntimePreferences) RuntimePreferences {
	prefs.ModelCatalogPath = strings.TrimSpace(prefs.ModelCatalogPath)
	prefs.OutboundProxyURL = strings.TrimSpace(prefs.OutboundProxyURL)
	prefs.DefaultTerminalShell = strings.TrimSpace(prefs.DefaultTerminalShell)
	if len(prefs.LocalShellModels) > 0 {
		prefs.LocalShellModels = append([]string(nil), prefs.LocalShellModels...)
	} else {
		prefs.LocalShellModels = nil
	}
	if len(prefs.ModelShellTypeOverrides) > 0 {
		prefs.ModelShellTypeOverrides = cloneStringMap(prefs.ModelShellTypeOverrides)
	} else {
		prefs.ModelShellTypeOverrides = nil
	}
	prefs.DefaultTurnApprovalPolicy = strings.TrimSpace(prefs.DefaultTurnApprovalPolicy)
	if len(prefs.DefaultTurnSandboxPolicy) > 0 {
		prefs.DefaultTurnSandboxPolicy = cloneAnyMap(prefs.DefaultTurnSandboxPolicy)
	} else {
		prefs.DefaultTurnSandboxPolicy = nil
	}
	if len(prefs.DefaultCommandSandboxPolicy) > 0 {
		prefs.DefaultCommandSandboxPolicy = cloneAnyMap(prefs.DefaultCommandSandboxPolicy)
	} else {
		prefs.DefaultCommandSandboxPolicy = nil
	}
	prefs.TurnPolicyValidationCommandPrefixes = cloneStringSlice(prefs.TurnPolicyValidationCommandPrefixes)
	prefs.TurnPolicyAlertCoverageThresholdPercent = cloneOptionalInt(prefs.TurnPolicyAlertCoverageThresholdPercent)
	prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs = cloneOptionalInt64(prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	prefs.TurnPolicyAlertStopLatencyP95ThresholdMs = cloneOptionalInt64(prefs.TurnPolicyAlertStopLatencyP95ThresholdMs)
	prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent = cloneOptionalInt(prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent)
	prefs.TurnPolicyAlertSuppressedCodes = cloneStringSlice(prefs.TurnPolicyAlertSuppressedCodes)
	prefs.TurnPolicyAlertAcknowledgedCodes = cloneStringSlice(prefs.TurnPolicyAlertAcknowledgedCodes)
	prefs.TurnPolicyAlertSnoozedCodes = cloneStringSlice(prefs.TurnPolicyAlertSnoozedCodes)
	prefs.TurnPolicyAlertSnoozeUntil = cloneOptionalTime(prefs.TurnPolicyAlertSnoozeUntil)
	prefs.TurnPolicyAlertGovernanceHistory = cloneTurnPolicyAlertGovernanceHistory(prefs.TurnPolicyAlertGovernanceHistory)
	prefs.AllowRemoteAccess = cloneOptionalBool(prefs.AllowRemoteAccess)
	prefs.AllowLocalhostWithoutAccessToken = cloneOptionalBool(prefs.AllowLocalhostWithoutAccessToken)
	if len(prefs.AccessTokens) > 0 {
		prefs.AccessTokens = cloneAccessTokens(prefs.AccessTokens)
	} else {
		prefs.AccessTokens = nil
	}
	prefs.BackendThreadTraceEnabled = cloneOptionalBool(prefs.BackendThreadTraceEnabled)
	prefs.BackendThreadTraceWorkspaceID = strings.TrimSpace(prefs.BackendThreadTraceWorkspaceID)
	prefs.BackendThreadTraceThreadID = strings.TrimSpace(prefs.BackendThreadTraceThreadID)
	return prefs
}

func decodeJSONArray(decoder *json.Decoder, consume func(*json.Decoder) error) error {
	startToken, err := decoder.Token()
	if err != nil {
		return err
	}
	if startToken == nil {
		return nil
	}

	startDelim, ok := startToken.(json.Delim)
	if !ok || startDelim != '[' {
		return errors.New("store metadata array field must be array or null")
	}

	for decoder.More() {
		if err := consume(decoder); err != nil {
			return err
		}
	}

	endToken, err := decoder.Token()
	if err != nil {
		return err
	}

	endDelim, ok := endToken.(json.Delim)
	if !ok || endDelim != ']' {
		return errors.New("store metadata array field must terminate with array end")
	}
	return nil
}

func discardJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}

	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}

	switch delim {
	case '{':
		for decoder.More() {
			if _, err := decoder.Token(); err != nil {
				return err
			}
			if err := discardJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	case '[':
		for decoder.More() {
			if err := discardJSONValue(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	default:
		return nil
	}
}

func updateLoadedMaxID(maxID *uint64, id string) {
	if value := NumericIDSuffix(id); value > *maxID {
		*maxID = value
	}
}

func (s *MemoryStore) persistLocked() {
	s.invalidateMemoryInspectionLocked()
	if s.path == "" {
		return
	}
	s.flushDirty = true
	s.flushVersion++
	s.requestFlushLocked()
}

func (s *MemoryStore) persistNowLocked() error {
	if s.path == "" {
		return nil
	}

	snapshot := storeSnapshot{
		Workspaces:                make([]Workspace, 0, len(s.workspaces)),
		CommandSessions:           make([]CommandSessionSnapshot, 0),
		WorkspaceEvents:           make([]storedWorkspaceEventLog, 0, len(s.workspaceEvents)),
		Automations:               make([]Automation, 0, len(s.automations)),
		AutomationTemplates:       make([]AutomationTemplate, 0, len(s.templates)),
		AutomationRuns:            make([]AutomationRun, 0, len(s.runs)),
		Notifications:             make([]Notification, 0, len(s.notifications)),
		NotificationSubscriptions: make([]NotificationSubscription, 0, len(s.notificationSubscriptions)),
		NotificationEmailTargets:  make([]NotificationEmailTarget, 0, len(s.notificationEmailTargets)),
		NotificationDispatches:    make([]NotificationDispatch, 0, len(s.notificationDispatches)),
		TurnPolicyDecisions:       make([]TurnPolicyDecision, 0, len(s.turnPolicyDecisions)),
		HookRuns:                  make([]HookRun, 0, len(s.hookRuns)),
		Bots:                      make([]Bot, 0, len(s.bots)),
		BotBindings:               make([]BotBinding, 0, len(s.botBindings)),
		ThreadBotBindings:         make([]ThreadBotBinding, 0, len(s.threadBotBindings)),
		BotTriggers:               make([]BotTrigger, 0, len(s.botTriggers)),
		BotConnections:            make([]BotConnection, 0, len(s.botConnections)),
		BotConnectionLogs:         make([]BotConnectionLogEntry, 0),
		WeChatAccounts:            make([]WeChatAccount, 0, len(s.wechatAccounts)),
		BotConversations:          make([]BotConversation, 0, len(s.botConversations)),
		BotDeliveryTargets:        make([]BotDeliveryTarget, 0, len(s.botDeliveryTargets)),
		BotInbound:                make([]BotInboundDelivery, 0, len(s.botInbound)),
		BotOutbound:               make([]BotOutboundDelivery, 0, len(s.botOutbound)),
		Threads:                   make([]Thread, 0, len(s.threads)),
		ThreadProjections:         make([]storedThreadProjection, 0, len(s.projections)),
		DeletedThreads:            make([]DeletedThread, 0, len(s.deleted)),
	}

	if s.runtimePrefs.ModelCatalogPath != "" ||
		len(s.runtimePrefs.LocalShellModels) > 0 ||
		s.runtimePrefs.DefaultShellType != "" ||
		s.runtimePrefs.DefaultTerminalShell != "" ||
		len(s.runtimePrefs.ModelShellTypeOverrides) > 0 ||
		s.runtimePrefs.AllowRemoteAccess != nil ||
		s.runtimePrefs.AllowLocalhostWithoutAccessToken != nil ||
		len(s.runtimePrefs.AccessTokens) > 0 ||
		s.runtimePrefs.DefaultTurnApprovalPolicy != "" ||
		len(s.runtimePrefs.DefaultTurnSandboxPolicy) > 0 ||
		len(s.runtimePrefs.DefaultCommandSandboxPolicy) > 0 {
		prefs := s.runtimePrefs
		if len(prefs.LocalShellModels) > 0 {
			prefs.LocalShellModels = append([]string(nil), prefs.LocalShellModels...)
		}
		if len(prefs.ModelShellTypeOverrides) > 0 {
			prefs.ModelShellTypeOverrides = cloneStringMap(prefs.ModelShellTypeOverrides)
		}
		if len(prefs.DefaultTurnSandboxPolicy) > 0 {
			prefs.DefaultTurnSandboxPolicy = cloneAnyMap(prefs.DefaultTurnSandboxPolicy)
		}
		if len(prefs.DefaultCommandSandboxPolicy) > 0 {
			prefs.DefaultCommandSandboxPolicy = cloneAnyMap(prefs.DefaultCommandSandboxPolicy)
		}
		prefs.AllowRemoteAccess = cloneOptionalBool(prefs.AllowRemoteAccess)
		prefs.AllowLocalhostWithoutAccessToken = cloneOptionalBool(prefs.AllowLocalhostWithoutAccessToken)
		if len(prefs.AccessTokens) > 0 {
			prefs.AccessTokens = cloneAccessTokens(prefs.AccessTokens)
		}
		snapshot.RuntimePreferences = &prefs
	}

	for _, workspace := range s.workspaces {
		snapshot.Workspaces = append(snapshot.Workspaces, workspace)
	}
	for _, workspaceSessions := range s.commandSessions {
		for _, session := range workspaceSessions {
			snapshot.CommandSessions = append(snapshot.CommandSessions, session)
		}
	}
	for workspaceID, events := range s.workspaceEvents {
		snapshot.WorkspaceEvents = append(snapshot.WorkspaceEvents, storedWorkspaceEventLog{
			WorkspaceID: workspaceID,
			NextSeq:     s.workspaceEventSeq[workspaceID] + 1,
			Events:      cloneEventEnvelopes(events),
		})
	}
	for _, automation := range s.automations {
		snapshot.Automations = append(snapshot.Automations, automation)
	}
	for _, template := range s.templates {
		snapshot.AutomationTemplates = append(snapshot.AutomationTemplates, template)
	}
	for _, run := range s.runs {
		snapshot.AutomationRuns = append(snapshot.AutomationRuns, cloneAutomationRun(run))
	}
	for _, notification := range s.notifications {
		snapshot.Notifications = append(snapshot.Notifications, notification)
	}
	for _, subscription := range s.notificationSubscriptions {
		snapshot.NotificationSubscriptions = append(snapshot.NotificationSubscriptions, cloneNotificationSubscription(subscription))
	}
	for _, target := range s.notificationEmailTargets {
		snapshot.NotificationEmailTargets = append(snapshot.NotificationEmailTargets, cloneNotificationEmailTarget(target))
	}
	for _, config := range s.notificationMailServerConfigs {
		snapshot.NotificationMailServerConfigs = append(
			snapshot.NotificationMailServerConfigs,
			cloneNotificationMailServerConfig(config),
		)
	}
	for _, dispatch := range s.notificationDispatches {
		snapshot.NotificationDispatches = append(snapshot.NotificationDispatches, cloneNotificationDispatch(dispatch))
	}
	for _, decision := range s.turnPolicyDecisions {
		snapshot.TurnPolicyDecisions = append(snapshot.TurnPolicyDecisions, cloneTurnPolicyDecision(decision))
	}
	for _, run := range s.hookRuns {
		snapshot.HookRuns = append(snapshot.HookRuns, cloneHookRun(run))
	}
	for _, bot := range s.bots {
		snapshot.Bots = append(snapshot.Bots, cloneBot(bot))
	}
	for _, binding := range s.botBindings {
		snapshot.BotBindings = append(snapshot.BotBindings, cloneBotBinding(binding))
	}
	for _, binding := range s.threadBotBindings {
		snapshot.ThreadBotBindings = append(snapshot.ThreadBotBindings, cloneThreadBotBinding(binding))
	}
	for _, trigger := range s.botTriggers {
		snapshot.BotTriggers = append(snapshot.BotTriggers, cloneBotTrigger(trigger))
	}
	for connectionID, connection := range s.botConnections {
		_, stripRuntime := s.transientBotConnectionRuntime[connectionID]
		snapshot.BotConnections = append(snapshot.BotConnections, clonePersistedBotConnection(connection, stripRuntime))
	}
	for connectionID, logs := range s.botConnectionLogs {
		transientIDs := s.transientBotConnectionLogIDs[connectionID]
		for _, entry := range logs {
			if _, transient := transientIDs[entry.ID]; transient {
				continue
			}
			snapshot.BotConnectionLogs = append(snapshot.BotConnectionLogs, entry)
		}
	}
	for _, account := range s.wechatAccounts {
		snapshot.WeChatAccounts = append(snapshot.WeChatAccounts, cloneWeChatAccount(account))
	}
	for _, conversation := range s.botConversations {
		snapshot.BotConversations = append(snapshot.BotConversations, cloneBotConversation(conversation))
	}
	for _, target := range s.botDeliveryTargets {
		snapshot.BotDeliveryTargets = append(snapshot.BotDeliveryTargets, cloneBotDeliveryTarget(target))
	}
	for _, delivery := range s.botInbound {
		snapshot.BotInbound = append(snapshot.BotInbound, cloneBotInboundDelivery(delivery))
	}
	for _, delivery := range s.botOutbound {
		snapshot.BotOutbound = append(snapshot.BotOutbound, cloneBotOutboundDelivery(delivery))
	}
	for _, thread := range s.threads {
		snapshot.Threads = append(snapshot.Threads, thread)
	}
	projectionUpdates := make(map[string]threadProjectionRecord, len(s.projections))
	activeProjectionSidecars := make(map[string]struct{}, len(s.projections))
	for key, projection := range s.projections {
		storedProjection, updatedRecord, activeTurnsPaths := s.prepareStoredThreadProjectionSnapshotForPersist(projection)
		snapshot.ThreadProjections = append(snapshot.ThreadProjections, storedProjection)
		projectionUpdates[key] = updatedRecord
		for _, activeTurnsPath := range activeTurnsPaths {
			if activeTurnsPath == "" {
				continue
			}
			activeProjectionSidecars[activeTurnsPath] = struct{}{}
		}
	}
	for _, deletedThread := range s.deleted {
		snapshot.DeletedThreads = append(snapshot.DeletedThreads, deletedThread)
	}

	sort.Slice(snapshot.Workspaces, func(i int, j int) bool {
		return snapshot.Workspaces[i].ID < snapshot.Workspaces[j].ID
	})
	sort.Slice(snapshot.CommandSessions, func(i int, j int) bool {
		if snapshot.CommandSessions[i].WorkspaceID == snapshot.CommandSessions[j].WorkspaceID {
			return snapshot.CommandSessions[i].ID < snapshot.CommandSessions[j].ID
		}
		return snapshot.CommandSessions[i].WorkspaceID < snapshot.CommandSessions[j].WorkspaceID
	})
	sort.Slice(snapshot.WorkspaceEvents, func(i int, j int) bool {
		return snapshot.WorkspaceEvents[i].WorkspaceID < snapshot.WorkspaceEvents[j].WorkspaceID
	})
	sort.Slice(snapshot.Automations, func(i int, j int) bool {
		return snapshot.Automations[i].ID < snapshot.Automations[j].ID
	})
	sort.Slice(snapshot.AutomationTemplates, func(i int, j int) bool {
		return snapshot.AutomationTemplates[i].ID < snapshot.AutomationTemplates[j].ID
	})
	sort.Slice(snapshot.AutomationRuns, func(i int, j int) bool {
		return snapshot.AutomationRuns[i].ID < snapshot.AutomationRuns[j].ID
	})
	sort.Slice(snapshot.Notifications, func(i int, j int) bool {
		return snapshot.Notifications[i].ID < snapshot.Notifications[j].ID
	})
	sort.Slice(snapshot.NotificationSubscriptions, func(i int, j int) bool {
		return snapshot.NotificationSubscriptions[i].ID < snapshot.NotificationSubscriptions[j].ID
	})
	sort.Slice(snapshot.NotificationEmailTargets, func(i int, j int) bool {
		return snapshot.NotificationEmailTargets[i].ID < snapshot.NotificationEmailTargets[j].ID
	})
	sort.Slice(snapshot.NotificationDispatches, func(i int, j int) bool {
		return snapshot.NotificationDispatches[i].ID < snapshot.NotificationDispatches[j].ID
	})
	sort.Slice(snapshot.TurnPolicyDecisions, func(i int, j int) bool {
		return snapshot.TurnPolicyDecisions[i].ID < snapshot.TurnPolicyDecisions[j].ID
	})
	sort.Slice(snapshot.HookRuns, func(i int, j int) bool {
		return snapshot.HookRuns[i].ID < snapshot.HookRuns[j].ID
	})
	sort.Slice(snapshot.Bots, func(i int, j int) bool {
		return snapshot.Bots[i].ID < snapshot.Bots[j].ID
	})
	sort.Slice(snapshot.BotBindings, func(i int, j int) bool {
		return snapshot.BotBindings[i].ID < snapshot.BotBindings[j].ID
	})
	sort.Slice(snapshot.ThreadBotBindings, func(i int, j int) bool {
		return snapshot.ThreadBotBindings[i].ID < snapshot.ThreadBotBindings[j].ID
	})
	sort.Slice(snapshot.BotTriggers, func(i int, j int) bool {
		return snapshot.BotTriggers[i].ID < snapshot.BotTriggers[j].ID
	})
	sort.Slice(snapshot.BotConnections, func(i int, j int) bool {
		return snapshot.BotConnections[i].ID < snapshot.BotConnections[j].ID
	})
	sort.Slice(snapshot.BotConnectionLogs, func(i int, j int) bool {
		if snapshot.BotConnectionLogs[i].WorkspaceID == snapshot.BotConnectionLogs[j].WorkspaceID {
			if snapshot.BotConnectionLogs[i].ConnectionID == snapshot.BotConnectionLogs[j].ConnectionID {
				if snapshot.BotConnectionLogs[i].TS.Equal(snapshot.BotConnectionLogs[j].TS) {
					return snapshot.BotConnectionLogs[i].ID < snapshot.BotConnectionLogs[j].ID
				}
				return snapshot.BotConnectionLogs[i].TS.Before(snapshot.BotConnectionLogs[j].TS)
			}
			return snapshot.BotConnectionLogs[i].ConnectionID < snapshot.BotConnectionLogs[j].ConnectionID
		}
		return snapshot.BotConnectionLogs[i].WorkspaceID < snapshot.BotConnectionLogs[j].WorkspaceID
	})
	sort.Slice(snapshot.WeChatAccounts, func(i int, j int) bool {
		return snapshot.WeChatAccounts[i].ID < snapshot.WeChatAccounts[j].ID
	})
	sort.Slice(snapshot.BotConversations, func(i int, j int) bool {
		return snapshot.BotConversations[i].ID < snapshot.BotConversations[j].ID
	})
	sort.Slice(snapshot.BotDeliveryTargets, func(i int, j int) bool {
		return snapshot.BotDeliveryTargets[i].ID < snapshot.BotDeliveryTargets[j].ID
	})
	sort.Slice(snapshot.BotInbound, func(i int, j int) bool {
		return snapshot.BotInbound[i].ID < snapshot.BotInbound[j].ID
	})
	sort.Slice(snapshot.BotOutbound, func(i int, j int) bool {
		return snapshot.BotOutbound[i].ID < snapshot.BotOutbound[j].ID
	})
	sort.Slice(snapshot.Threads, func(i int, j int) bool {
		return snapshot.Threads[i].ID < snapshot.Threads[j].ID
	})
	sort.Slice(snapshot.ThreadProjections, func(i int, j int) bool {
		if snapshot.ThreadProjections[i].WorkspaceID == snapshot.ThreadProjections[j].WorkspaceID {
			return snapshot.ThreadProjections[i].ThreadID < snapshot.ThreadProjections[j].ThreadID
		}

		return snapshot.ThreadProjections[i].WorkspaceID < snapshot.ThreadProjections[j].WorkspaceID
	})
	sort.Slice(snapshot.DeletedThreads, func(i int, j int) bool {
		if snapshot.DeletedThreads[i].WorkspaceID == snapshot.DeletedThreads[j].WorkspaceID {
			return snapshot.DeletedThreads[i].ThreadID < snapshot.DeletedThreads[j].ThreadID
		}
		return snapshot.DeletedThreads[i].WorkspaceID < snapshot.DeletedThreads[j].WorkspaceID
	})

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(s.path, data, 0o644); err != nil {
		return err
	}

	for key, record := range projectionUpdates {
		s.projections[key] = record
	}
	s.cleanupThreadProjectionSidecars(activeProjectionSidecars)
	return nil
}

func deletedThreadKey(workspaceID string, threadID string) string {
	return workspaceID + "\x00" + threadID
}

func pendingSessionStartKey(workspaceID string, threadID string) string {
	return workspaceID + "\x00" + threadID
}

func threadProjectionKey(workspaceID string, threadID string) string {
	return workspaceID + "\x00" + threadID
}

func cloneThreadProjectionMetadata(projection ThreadProjection) ThreadProjection {
	return ThreadProjection{
		WorkspaceID:      projection.WorkspaceID,
		ThreadID:         projection.ThreadID,
		Cwd:              projection.Cwd,
		Preview:          projection.Preview,
		Path:             projection.Path,
		Source:           projection.Source,
		Status:           projection.Status,
		UpdatedAt:        projection.UpdatedAt,
		TokenUsage:       cloneThreadTokenUsage(projection.TokenUsage),
		TurnCount:        projection.TurnCount,
		MessageCount:     projection.MessageCount,
		SnapshotComplete: projection.SnapshotComplete,
	}
}

func cloneEventEnvelopes(events []EventEnvelope) []EventEnvelope {
	if len(events) == 0 {
		return nil
	}

	cloned := make([]EventEnvelope, len(events))
	copy(cloned, events)
	return cloned
}

func materializeThreadProjectionRecord(record threadProjectionRecord) ThreadProjection {
	projection := cloneThreadProjectionMetadata(record.Projection)
	if record.Projection.Turns != nil {
		projection.Turns = cloneThreadTurns(record.Projection.Turns)
		return projection
	}

	projection.Turns = decodeThreadProjectionTurns(threadProjectionRecordTurnsRaw(record))
	return projection
}

func materializeThreadProjectionWindow(
	record threadProjectionRecord,
	turnLimit int,
	beforeTurnID string,
) ThreadProjectionWindow {
	readSource := threadProjectionStorageKind(record)
	projection := cloneThreadProjectionMetadata(record.Projection)
	if turnLimit <= 0 {
		if record.Projection.Turns != nil {
			projection.Turns = cloneThreadTurns(record.Projection.Turns)
		} else {
			projection.Turns = decodeThreadProjectionTurns(threadProjectionRecordTurnsRaw(record))
		}
		return ThreadProjectionWindow{
			Projection:      projection,
			HasMore:         false,
			BeforeTurnFound: beforeTurnID == "" || threadTurnsContainID(projection.Turns, beforeTurnID),
			ReadSource:      readSource,
			ScannedTurns:    len(projection.Turns),
		}
	}

	if record.Projection.Turns != nil {
		turns, hasMore, beforeFound, scannedTurns := sliceThreadTurnsWindow(record.Projection.Turns, turnLimit, beforeTurnID)
		projection.Turns = cloneThreadTurns(turns)
		return ThreadProjectionWindow{
			Projection:      projection,
			HasMore:         hasMore,
			BeforeTurnFound: beforeFound,
			ReadSource:      readSource,
			ScannedTurns:    scannedTurns,
		}
	}

	turns, hasMore, beforeFound, scannedTurns := decodeThreadProjectionTurnsWindow(record, turnLimit, beforeTurnID)
	projection.Turns = turns
	return ThreadProjectionWindow{
		Projection:      projection,
		HasMore:         hasMore,
		BeforeTurnFound: beforeFound,
		ReadSource:      readSource,
		ScannedTurns:    scannedTurns,
	}
}

func threadProjectionStorageKind(record threadProjectionRecord) string {
	switch {
	case record.Projection.Turns != nil:
		return "hot"
	case record.TurnsManifest != nil:
		return "sidecar_chunked"
	case record.TurnsPath != "":
		return "sidecar"
	case len(record.TurnsCompressed) > 0:
		return "compressed"
	case len(normalizeThreadProjectionRawJSON(record.TurnsRaw)) > 0:
		return "raw"
	default:
		return "empty"
	}
}

func newColdThreadProjectionRecord(projection ThreadProjection) threadProjectionRecord {
	compactedTurns := compactProjectedThreadTurns(projection.Turns)
	turnCount, messageCount, stats := summarizeThreadProjectionTurns(compactedTurns)
	nextProjection := cloneThreadProjectionMetadata(projection)
	nextProjection.TurnCount = turnCount
	nextProjection.MessageCount = messageCount
	turnsRaw, turnsCompressed := packThreadProjectionTurns(encodeThreadProjectionTurns(compactedTurns))
	record := threadProjectionRecord{
		Projection:      nextProjection,
		TurnsRaw:        turnsRaw,
		TurnsCompressed: turnsCompressed,
		Stats:           stats,
	}
	record.SnapshotBytes = encodedJSONSize(buildStoredThreadProjectionSnapshotFromRecord(record))
	return record
}

func normalizeStoredThreadProjection(storePath string, projection storedThreadProjection) (threadProjectionRecord, bool) {
	record := threadProjectionRecord{
		Projection: ThreadProjection{
			WorkspaceID:      projection.WorkspaceID,
			ThreadID:         projection.ThreadID,
			Cwd:              projection.Cwd,
			Preview:          projection.Preview,
			Path:             projection.Path,
			Source:           projection.Source,
			Status:           projection.Status,
			UpdatedAt:        projection.UpdatedAt,
			TokenUsage:       cloneThreadTokenUsage(projection.TokenUsage),
			TurnCount:        projection.TurnCount,
			MessageCount:     projection.MessageCount,
			SnapshotComplete: projection.SnapshotComplete,
		},
		Stats: normalizeThreadProjectionStats(projection.Stats),
	}
	if ref := strings.TrimSpace(projection.TurnsRef); ref != "" {
		record.TurnsRef = ref
		record.TurnsPath = threadProjectionTurnsAbsolutePath(storePath, ref)
		mutated := false
		if manifest, ok := readThreadProjectionTurnsManifest(record.TurnsPath); ok {
			record.TurnsManifest = manifest
		} else {
			mutated = true
		}
		if record.Projection.TurnCount == 0 || threadProjectionStatsIsZero(record.Stats) {
			refreshed, ok := refreshThreadProjectionRecordStats(record)
			if ok {
				if record.Projection.TurnCount != refreshed.Projection.TurnCount ||
					record.Projection.MessageCount != refreshed.Projection.MessageCount ||
					!threadProjectionStatsEqual(record.Stats, refreshed.Stats) {
					mutated = true
				}
				record = refreshed
			}
		}
		record.SnapshotBytes = encodedJSONSize(buildStoredThreadProjectionSnapshotFromRecord(record))
		return record, mutated
	}

	compactedTurns := compactProjectedThreadTurns(decodeThreadProjectionTurns(projection.Turns))
	encodedTurns := encodeThreadProjectionTurns(compactedTurns)
	turnCount, messageCount, stats := summarizeThreadProjectionTurns(compactedTurns)
	turnsRaw, turnsCompressed := packThreadProjectionTurns(encodedTurns)
	record.TurnsRaw = turnsRaw
	record.TurnsCompressed = turnsCompressed
	record.Projection.TurnCount = turnCount
	record.Projection.MessageCount = messageCount
	record.Stats = stats
	record.SnapshotBytes = encodedJSONSize(buildStoredThreadProjectionSnapshotFromRecord(record))
	return record,
		!bytes.Equal(normalizeThreadProjectionRawJSON(projection.Turns), encodedTurns) ||
			shouldExternalizeThreadProjectionTurns(encodedTurns) ||
			projection.TurnCount != turnCount ||
			projection.MessageCount != messageCount ||
			!threadProjectionStatsEqual(normalizeThreadProjectionStats(projection.Stats), stats)
}

func buildStoredThreadProjectionSnapshotFromRecord(record threadProjectionRecord) storedThreadProjection {
	snapshot := storedThreadProjection{
		WorkspaceID:      record.Projection.WorkspaceID,
		ThreadID:         record.Projection.ThreadID,
		Cwd:              record.Projection.Cwd,
		Preview:          record.Projection.Preview,
		Path:             record.Projection.Path,
		Source:           record.Projection.Source,
		Status:           record.Projection.Status,
		UpdatedAt:        record.Projection.UpdatedAt,
		TokenUsage:       cloneThreadTokenUsage(record.Projection.TokenUsage),
		TurnCount:        record.Projection.TurnCount,
		MessageCount:     record.Projection.MessageCount,
		SnapshotComplete: record.Projection.SnapshotComplete,
		Stats:            cloneThreadProjectionStatsPtr(record.Stats),
	}
	if ref := strings.TrimSpace(record.TurnsRef); ref != "" &&
		record.Projection.Turns == nil &&
		len(record.TurnsRaw) == 0 &&
		len(record.TurnsCompressed) == 0 {
		snapshot.TurnsRef = ref
		return snapshot
	}
	snapshot.Turns = threadProjectionRecordTurnsRaw(record)
	return snapshot
}

func (s *MemoryStore) buildStoredThreadProjectionSnapshot(record threadProjectionRecord) storedThreadProjection {
	return buildStoredThreadProjectionSnapshotFromRecord(record)
}

func (s *MemoryStore) prepareStoredThreadProjectionSnapshotForPersist(
	record threadProjectionRecord,
) (storedThreadProjection, threadProjectionRecord, []string) {
	record, _ = refreshThreadProjectionRecordStats(record)
	if ref := s.threadProjectionRecordTurnsRef(record); ref != "" &&
		record.Projection.Turns == nil &&
		len(record.TurnsRaw) == 0 &&
		len(record.TurnsCompressed) == 0 &&
		record.TurnsManifest != nil {
		snapshot := s.buildStoredThreadProjectionSnapshot(record)
		record.SnapshotBytes = encodedJSONSize(snapshot)
		record.SnapshotDirty = false
		return snapshot, record, threadProjectionActiveSidecarPaths(record)
	}

	rawTurns := threadProjectionRecordTurnsRaw(record)
	if shouldExternalizeThreadProjectionTurns(rawTurns) {
		turnsPath := s.threadProjectionTurnsAbsolutePath(record.Projection.WorkspaceID, record.Projection.ThreadID)
		manifest, activeTurnsPaths, err := writeThreadProjectionTurnsSidecar(turnsPath, rawTurns)
		if err == nil {
			updatedRecord := threadProjectionRecord{
				Projection:    cloneThreadProjectionMetadata(record.Projection),
				TurnsPath:     turnsPath,
				TurnsRef:      s.threadProjectionRelativePath(turnsPath),
				TurnsManifest: manifest,
				Stats:         cloneThreadProjectionStats(record.Stats),
			}
			snapshot := s.buildStoredThreadProjectionSnapshot(updatedRecord)
			updatedRecord.SnapshotBytes = encodedJSONSize(snapshot)
			return snapshot, updatedRecord, activeTurnsPaths
		}
	}

	updatedRecord := threadProjectionRecord{
		Projection: cloneThreadProjectionMetadata(record.Projection),
		Stats:      cloneThreadProjectionStats(record.Stats),
	}
	updatedRecord.TurnsRaw, updatedRecord.TurnsCompressed = packThreadProjectionTurns(rawTurns)
	snapshot := s.buildStoredThreadProjectionSnapshot(updatedRecord)
	updatedRecord.SnapshotBytes = encodedJSONSize(snapshot)
	return snapshot, updatedRecord, nil
}

func threadProjectionRecordTurnsRaw(record threadProjectionRecord) json.RawMessage {
	if record.Projection.Turns != nil {
		return encodeThreadProjectionTurns(record.Projection.Turns)
	}
	if record.TurnsManifest != nil {
		return readThreadProjectionTurnsSidecar(record.TurnsPath, record.TurnsManifest)
	}
	if len(record.TurnsCompressed) > 0 {
		return unpackThreadProjectionTurns(record.TurnsCompressed)
	}
	if record.TurnsPath != "" {
		return readThreadProjectionTurnsSidecar(record.TurnsPath, nil)
	}
	return normalizeThreadProjectionRawJSON(record.TurnsRaw)
}

func refreshThreadProjectionRecordStats(record threadProjectionRecord) (threadProjectionRecord, bool) {
	if record.Projection.Turns == nil && !record.StatsDirty && !threadProjectionStatsIsZero(record.Stats) &&
		record.Projection.TurnCount > 0 {
		return record, false
	}

	turnCount, messageCount, stats, err := summarizeThreadProjectionRecord(record)
	if err != nil {
		return record, false
	}

	changed := record.Projection.TurnCount != turnCount ||
		record.Projection.MessageCount != messageCount ||
		record.StatsDirty ||
		!threadProjectionStatsEqual(record.Stats, stats)
	record.Projection.TurnCount = turnCount
	record.Projection.MessageCount = messageCount
	record.Stats = stats
	record.StatsDirty = false
	return record, changed
}

func shouldExternalizeThreadProjectionTurns(raw json.RawMessage) bool {
	normalized := normalizeThreadProjectionRawJSON(raw)
	return len(normalized) >= threadProjectionExternalizeMin && !bytes.Equal(normalized, []byte("[]"))
}

func writeThreadProjectionTurnsSidecar(
	turnsPath string,
	raw json.RawMessage,
) (*threadProjectionTurnsManifest, []string, error) {
	if turnsPath == "" {
		return nil, nil, errors.New("thread projection turns path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(turnsPath), 0o755); err != nil {
		return nil, nil, err
	}

	turns := decodeThreadProjectionTurns(raw)
	chunkSize := threadProjectionSidecarChunkSize
	if chunkSize <= 0 {
		chunkSize = len(turns)
	}
	if chunkSize <= 0 {
		chunkSize = 1
	}

	manifest := &threadProjectionTurnsManifest{
		Version:   threadProjectionSidecarVersion,
		ChunkSize: chunkSize,
		ChunkRefs: make([]string, 0, threadProjectionChunkCapacity(len(turns), chunkSize)),
		TurnIDs:   make([]string, 0, len(turns)),
	}
	activePaths := []string{turnsPath}
	for start := 0; start < len(turns); start += chunkSize {
		end := start + chunkSize
		if end > len(turns) {
			end = len(turns)
		}
		chunkIndex := len(manifest.ChunkRefs)
		chunkPath := threadProjectionTurnsChunkPath(turnsPath, chunkIndex)
		if err := os.MkdirAll(filepath.Dir(chunkPath), 0o755); err != nil {
			return nil, nil, err
		}
		if err := writeThreadProjectionSidecarPayload(chunkPath, encodeThreadProjectionTurns(turns[start:end])); err != nil {
			return nil, nil, err
		}
		manifest.ChunkRefs = append(manifest.ChunkRefs, threadProjectionTurnsChunkRelativeRef(turnsPath, chunkPath))
		activePaths = append(activePaths, chunkPath)
		for _, turn := range turns[start:end] {
			manifest.TurnIDs = append(manifest.TurnIDs, turn.ID)
		}
	}

	if err := writeThreadProjectionSidecarPayload(turnsPath, mustMarshalJSON(manifest)); err != nil {
		return nil, nil, err
	}
	return manifest, activePaths, nil
}

func threadProjectionChunkCapacity(turnCount int, chunkSize int) int {
	if turnCount <= 0 || chunkSize <= 0 {
		return 1
	}
	capacity := (turnCount + chunkSize - 1) / chunkSize
	if capacity <= 0 {
		return 1
	}
	return capacity
}

func mustMarshalJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		return []byte("{}")
	}
	return data
}

func writeThreadProjectionSidecarPayload(filePath string, raw []byte) error {
	file, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := gzip.NewWriter(file)
	if _, err := writer.Write(normalizeThreadProjectionRawJSON(raw)); err != nil {
		_ = writer.Close()
		return err
	}
	return writer.Close()
}

func readThreadProjectionTurnsManifest(turnsPath string) (*threadProjectionTurnsManifest, bool) {
	data, err := readThreadProjectionSidecarPayload(turnsPath)
	if err != nil {
		return nil, false
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, false
	}

	var manifest threadProjectionTurnsManifest
	if err := json.Unmarshal(trimmed, &manifest); err != nil {
		return nil, false
	}
	if manifest.Version != threadProjectionSidecarVersion || manifest.ChunkSize <= 0 {
		return nil, false
	}
	if len(manifest.ChunkRefs) == 0 {
		if len(manifest.TurnIDs) == 0 {
			return &manifest, true
		}
		return nil, false
	}
	if len(manifest.TurnIDs) == 0 || len(manifest.TurnIDs) > len(manifest.ChunkRefs)*manifest.ChunkSize {
		return nil, false
	}
	return &manifest, true
}

func readThreadProjectionTurnsSidecar(
	turnsPath string,
	manifest *threadProjectionTurnsManifest,
) json.RawMessage {
	if manifest != nil {
		turns := make([]ThreadTurn, 0, len(manifest.TurnIDs))
		for _, chunkRef := range manifest.ChunkRefs {
			turns = append(turns, readThreadProjectionTurnsChunk(turnsPath, chunkRef)...)
		}
		return encodeThreadProjectionTurns(turns)
	}

	data, err := readThreadProjectionSidecarPayload(turnsPath)
	if err != nil {
		return json.RawMessage("[]")
	}
	return append(json.RawMessage(nil), normalizeThreadProjectionRawJSON(data)...)
}

func readThreadProjectionSidecarPayload(turnsPath string) ([]byte, error) {
	data, err := os.ReadFile(turnsPath)
	if err != nil {
		return nil, err
	}

	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return append([]byte(nil), normalizeThreadProjectionRawJSON(data)...), nil
	}
	defer reader.Close()

	raw, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	return append([]byte(nil), normalizeThreadProjectionRawJSON(raw)...), nil
}

func readThreadProjectionTurnsChunk(turnsPath string, chunkRef string) []ThreadTurn {
	chunkPath := threadProjectionTurnsChunkAbsolutePath(turnsPath, chunkRef)
	if chunkPath == "" {
		return []ThreadTurn{}
	}
	data, err := readThreadProjectionSidecarPayload(chunkPath)
	if err != nil {
		return []ThreadTurn{}
	}
	return decodeThreadProjectionTurns(data)
}

func threadProjectionActiveSidecarPaths(record threadProjectionRecord) []string {
	if record.TurnsPath == "" {
		return nil
	}
	paths := []string{record.TurnsPath}
	if record.TurnsManifest == nil {
		return paths
	}
	for _, chunkRef := range record.TurnsManifest.ChunkRefs {
		chunkPath := threadProjectionTurnsChunkAbsolutePath(record.TurnsPath, chunkRef)
		if chunkPath != "" {
			paths = append(paths, chunkPath)
		}
	}
	return paths
}

func (s *MemoryStore) threadProjectionTurnsRoot() string {
	if strings.TrimSpace(s.path) == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(s.path), "thread-projections")
}

func (s *MemoryStore) threadProjectionTurnsAbsolutePath(workspaceID string, threadID string) string {
	ref := threadProjectionTurnsRelativeRef(workspaceID, threadID)
	if ref == "" {
		return ""
	}
	return threadProjectionTurnsAbsolutePath(s.path, ref)
}

func threadProjectionTurnsAbsolutePath(storePath string, ref string) string {
	if strings.TrimSpace(storePath) == "" || strings.TrimSpace(ref) == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(storePath), "thread-projections", filepath.FromSlash(ref))
}

func threadProjectionTurnsRelativeRef(workspaceID string, threadID string) string {
	workspaceSegment := sanitizeThreadProjectionPathSegment(workspaceID)
	if workspaceSegment == "" {
		workspaceSegment = "workspace"
	}
	sum := sha256.Sum256([]byte(threadProjectionKey(workspaceID, threadID)))
	return path.Join(workspaceSegment, hex.EncodeToString(sum[:])+".json.gz")
}

func threadProjectionTurnsChunkRoot(turnsPath string) string {
	if strings.HasSuffix(turnsPath, ".json.gz") {
		return strings.TrimSuffix(turnsPath, ".json.gz") + ".chunks"
	}
	return turnsPath + ".chunks"
}

func threadProjectionTurnsChunkPath(turnsPath string, chunkIndex int) string {
	if turnsPath == "" {
		return ""
	}
	return filepath.Join(threadProjectionTurnsChunkRoot(turnsPath), fmt.Sprintf("%04d.json.gz", chunkIndex))
}

func threadProjectionTurnsChunkRelativeRef(turnsPath string, chunkPath string) string {
	if turnsPath == "" || chunkPath == "" {
		return ""
	}
	relative, err := filepath.Rel(filepath.Dir(turnsPath), chunkPath)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(relative)
}

func threadProjectionTurnsChunkAbsolutePath(turnsPath string, chunkRef string) string {
	if turnsPath == "" || strings.TrimSpace(chunkRef) == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(turnsPath), filepath.FromSlash(chunkRef))
}

func sanitizeThreadProjectionPathSegment(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	var builder strings.Builder
	builder.Grow(len(value))
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			builder.WriteRune(r)
		default:
			builder.WriteByte('_')
		}
	}
	return builder.String()
}

func (s *MemoryStore) threadProjectionRecordTurnsRef(record threadProjectionRecord) string {
	if ref := strings.TrimSpace(record.TurnsRef); ref != "" {
		return ref
	}
	if record.TurnsPath == "" {
		return ""
	}

	root := s.threadProjectionTurnsRoot()
	if root == "" {
		return ""
	}
	relative, err := filepath.Rel(root, record.TurnsPath)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(relative)
}

func (s *MemoryStore) threadProjectionRelativePath(turnsPath string) string {
	if strings.TrimSpace(turnsPath) == "" {
		return ""
	}
	root := s.threadProjectionTurnsRoot()
	if root == "" {
		return ""
	}
	relative, err := filepath.Rel(root, turnsPath)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(relative)
}

func (s *MemoryStore) cleanupThreadProjectionSidecars(active map[string]struct{}) {
	root := s.threadProjectionTurnsRoot()
	if root == "" {
		return
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return
	}

	_ = filepath.WalkDir(root, func(entryPath string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if _, ok := active[entryPath]; ok {
			return nil
		}
		_ = os.Remove(entryPath)
		return nil
	})
	pruneEmptyDirectories(root)
}

func pruneEmptyDirectories(root string) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		childPath := filepath.Join(root, entry.Name())
		pruneEmptyDirectories(childPath)
	}
	remaining, err := os.ReadDir(root)
	if err != nil || len(remaining) > 0 {
		return
	}
	_ = os.Remove(root)
}

func packThreadProjectionTurns(raw json.RawMessage) (json.RawMessage, []byte) {
	normalized := normalizeThreadProjectionRawJSON(raw)
	if len(normalized) < threadProjectionCompressionMin || bytes.Equal(normalized, []byte("[]")) {
		return append(json.RawMessage(nil), normalized...), nil
	}

	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(normalized); err != nil {
		_ = writer.Close()
		return append(json.RawMessage(nil), normalized...), nil
	}
	if err := writer.Close(); err != nil {
		return append(json.RawMessage(nil), normalized...), nil
	}

	if compressed.Len() >= len(normalized) {
		return append(json.RawMessage(nil), normalized...), nil
	}
	return nil, append([]byte(nil), compressed.Bytes()...)
}

func unpackThreadProjectionTurns(compressed []byte) json.RawMessage {
	if len(compressed) == 0 {
		return json.RawMessage("[]")
	}

	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return json.RawMessage("[]")
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return json.RawMessage("[]")
	}
	return append(json.RawMessage(nil), normalizeThreadProjectionRawJSON(json.RawMessage(data))...)
}

func encodeThreadProjectionTurns(turns []ThreadTurn) json.RawMessage {
	if len(turns) == 0 {
		return json.RawMessage("[]")
	}

	data, err := json.Marshal(turns)
	if err != nil {
		return json.RawMessage("[]")
	}
	return json.RawMessage(data)
}

func decodeThreadProjectionTurns(raw json.RawMessage) []ThreadTurn {
	normalized := normalizeThreadProjectionRawJSON(raw)
	if bytes.Equal(normalized, []byte("[]")) {
		return []ThreadTurn{}
	}

	var turns []ThreadTurn
	if err := json.Unmarshal(normalized, &turns); err != nil {
		return []ThreadTurn{}
	}
	if turns == nil {
		return []ThreadTurn{}
	}
	return turns
}

func decodeThreadProjectionTurnsWindow(
	record threadProjectionRecord,
	turnLimit int,
	beforeTurnID string,
) ([]ThreadTurn, bool, bool, int) {
	if record.TurnsManifest != nil {
		return decodeThreadProjectionTurnsChunkedWindow(record, turnLimit, beforeTurnID)
	}

	reader, err := threadProjectionTurnsReadCloser(record)
	if err != nil {
		return []ThreadTurn{}, false, beforeTurnID == "", 0
	}
	defer reader.Close()

	decoder := json.NewDecoder(reader)
	startToken, err := decoder.Token()
	if err != nil {
		return []ThreadTurn{}, false, beforeTurnID == "", 0
	}
	startDelim, ok := startToken.(json.Delim)
	if !ok || startDelim != '[' {
		return []ThreadTurn{}, false, beforeTurnID == "", 0
	}

	window := make([]ThreadTurn, 0, turnLimit)
	totalAccepted := 0
	scannedTurns := 0
	beforeFound := beforeTurnID == ""
	for decoder.More() {
		var turn ThreadTurn
		if err := decoder.Decode(&turn); err != nil {
			return []ThreadTurn{}, false, beforeTurnID == "", scannedTurns
		}
		scannedTurns += 1
		if beforeTurnID != "" && turn.ID == beforeTurnID {
			beforeFound = true
			break
		}
		totalAccepted++
		if len(window) < turnLimit {
			window = append(window, turn)
			continue
		}
		copy(window, window[1:])
		window[len(window)-1] = turn
	}

	return cloneThreadTurns(window), totalAccepted > len(window), beforeFound, scannedTurns
}

func decodeThreadProjectionTurnsChunkedWindow(
	record threadProjectionRecord,
	turnLimit int,
	beforeTurnID string,
) ([]ThreadTurn, bool, bool, int) {
	manifest := record.TurnsManifest
	if manifest == nil {
		return []ThreadTurn{}, false, beforeTurnID == "", 0
	}
	if turnLimit <= 0 {
		turns := decodeThreadProjectionTurns(readThreadProjectionTurnsSidecar(record.TurnsPath, manifest))
		return turns, false, beforeTurnID == "" || threadTurnsContainID(turns, beforeTurnID), len(turns)
	}

	endExclusive := len(manifest.TurnIDs)
	beforeFound := beforeTurnID == ""
	if beforeTurnID != "" {
		endExclusive = -1
		for index := len(manifest.TurnIDs) - 1; index >= 0; index-- {
			if manifest.TurnIDs[index] == beforeTurnID {
				endExclusive = index
				beforeFound = true
				break
			}
		}
		if endExclusive < 0 {
			return []ThreadTurn{}, false, false, 0
		}
	}

	startInclusive := endExclusive - turnLimit
	if startInclusive < 0 {
		startInclusive = 0
	}
	if endExclusive < startInclusive {
		endExclusive = startInclusive
	}
	if endExclusive == 0 {
		return []ThreadTurn{}, false, beforeFound, 0
	}

	chunkSize := manifest.ChunkSize
	if chunkSize <= 0 {
		chunkSize = threadProjectionSidecarChunkSize
	}
	if chunkSize <= 0 {
		chunkSize = len(manifest.TurnIDs)
	}
	if chunkSize <= 0 {
		chunkSize = 1
	}

	chunkStart := startInclusive / chunkSize
	chunkEnd := (endExclusive - 1) / chunkSize
	if chunkStart < 0 {
		chunkStart = 0
	}
	if chunkEnd >= len(manifest.ChunkRefs) {
		chunkEnd = len(manifest.ChunkRefs) - 1
	}
	window := make([]ThreadTurn, 0, endExclusive-startInclusive)
	scannedTurns := 0
	for chunkIndex := chunkStart; chunkIndex <= chunkEnd; chunkIndex++ {
		if chunkIndex < 0 || chunkIndex >= len(manifest.ChunkRefs) {
			continue
		}
		chunkTurns := readThreadProjectionTurnsChunk(record.TurnsPath, manifest.ChunkRefs[chunkIndex])
		scannedTurns += len(chunkTurns)
		chunkStartInclusive := chunkIndex * chunkSize
		localStart := startInclusive - chunkStartInclusive
		if localStart < 0 {
			localStart = 0
		}
		localEnd := endExclusive - chunkStartInclusive
		if localEnd > len(chunkTurns) {
			localEnd = len(chunkTurns)
		}
		if localEnd < localStart {
			localEnd = localStart
		}
		if localStart >= len(chunkTurns) || localStart == localEnd {
			continue
		}
		window = append(window, chunkTurns[localStart:localEnd]...)
	}

	return cloneThreadTurns(window), startInclusive > 0, beforeFound, scannedTurns
}

func threadProjectionTurnsReadCloser(record threadProjectionRecord) (io.ReadCloser, error) {
	switch {
	case len(record.TurnsCompressed) > 0:
		reader, err := gzip.NewReader(bytes.NewReader(record.TurnsCompressed))
		if err != nil {
			return nil, err
		}
		return reader, nil
	case record.TurnsPath != "":
		file, err := os.Open(record.TurnsPath)
		if err != nil {
			return nil, err
		}
		reader, err := gzip.NewReader(file)
		if err != nil {
			_, _ = file.Seek(0, io.SeekStart)
			return &threadProjectionTurnsReadCloserImpl{Reader: file, closers: []io.Closer{file}}, nil
		}
		return &threadProjectionTurnsReadCloserImpl{Reader: reader, closers: []io.Closer{reader, file}}, nil
	default:
		return io.NopCloser(bytes.NewReader(normalizeThreadProjectionRawJSON(record.TurnsRaw))), nil
	}
}

type threadProjectionTurnsReadCloserImpl struct {
	io.Reader
	closers []io.Closer
}

func (r *threadProjectionTurnsReadCloserImpl) Close() error {
	var firstErr error
	for _, closer := range r.closers {
		if err := closer.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func sliceThreadTurnsWindow(turns []ThreadTurn, turnLimit int, beforeTurnID string) ([]ThreadTurn, bool, bool, int) {
	if turnLimit <= 0 {
		return cloneThreadTurns(turns), false, beforeTurnID == "" || threadTurnsContainID(turns, beforeTurnID), len(turns)
	}

	endIndex := len(turns)
	beforeFound := beforeTurnID == ""
	scannedTurns := len(turns)
	if beforeTurnID != "" {
		for index, turn := range turns {
			if turn.ID == beforeTurnID {
				endIndex = index
				beforeFound = true
				scannedTurns = index + 1
				break
			}
		}
	}

	if endIndex < 0 {
		endIndex = 0
	}
	if endIndex > len(turns) {
		endIndex = len(turns)
	}

	startIndex := endIndex - turnLimit
	if startIndex < 0 {
		startIndex = 0
	}

	return turns[startIndex:endIndex], startIndex > 0, beforeFound, scannedTurns
}

func threadTurnsContainID(turns []ThreadTurn, turnID string) bool {
	if strings.TrimSpace(turnID) == "" {
		return true
	}
	for _, turn := range turns {
		if turn.ID == turnID {
			return true
		}
	}
	return false
}

func normalizeThreadProjectionRawJSON(raw json.RawMessage) json.RawMessage {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return json.RawMessage("[]")
	}
	return trimmed
}

func (s *MemoryStore) releaseTransientLoadMemory() {
	if s.path == "" {
		return
	}

	s.mu.RLock()
	shouldRelease := len(s.projections) > 0 ||
		len(s.commandSessions) > 0 ||
		len(s.botConnectionLogs) > 0 ||
		len(s.botInbound) > 0 ||
		len(s.botOutbound) > 0
	s.mu.RUnlock()
	if !shouldRelease {
		return
	}

	runtime.GC()
	debug.FreeOSMemory()
}

func cloneAutomationRun(run AutomationRun) AutomationRun {
	next := run
	if len(run.Logs) > 0 {
		next.Logs = append([]AutomationRunLogEntry{}, run.Logs...)
	} else {
		next.Logs = []AutomationRunLogEntry{}
	}
	return next
}

func cloneBot(bot Bot) Bot {
	next := bot
	next.Scope = strings.TrimSpace(bot.Scope)
	next.SharingMode = strings.TrimSpace(bot.SharingMode)
	next.SharedWorkspaceIDs = cloneStringSlice(bot.SharedWorkspaceIDs)
	return next
}

func cloneBotBinding(binding BotBinding) BotBinding {
	next := binding
	if len(binding.AIConfig) > 0 {
		next.AIConfig = cloneStringMap(binding.AIConfig)
	} else {
		next.AIConfig = nil
	}
	return next
}

func cloneThreadBotBinding(binding ThreadBotBinding) ThreadBotBinding {
	next := binding
	next.BotWorkspaceID = normalizeThreadBotBindingBotWorkspaceID(binding)
	return next
}

func cloneNotificationChannelBinding(binding NotificationChannelBinding) NotificationChannelBinding {
	next := binding
	next.Channel = strings.TrimSpace(binding.Channel)
	next.TargetRefType = strings.TrimSpace(binding.TargetRefType)
	next.TargetRefID = strings.TrimSpace(binding.TargetRefID)
	next.TitleTemplate = strings.TrimSpace(binding.TitleTemplate)
	next.BodyTemplate = strings.TrimSpace(binding.BodyTemplate)
	if len(binding.Settings) > 0 {
		next.Settings = cloneStringMap(binding.Settings)
	} else {
		next.Settings = nil
	}
	return next
}

func cloneNotificationChannelBindings(bindings []NotificationChannelBinding) []NotificationChannelBinding {
	if len(bindings) == 0 {
		return nil
	}

	cloned := make([]NotificationChannelBinding, 0, len(bindings))
	for _, binding := range bindings {
		if strings.TrimSpace(binding.Channel) == "" || strings.TrimSpace(binding.TargetRefType) == "" {
			continue
		}
		cloned = append(cloned, cloneNotificationChannelBinding(binding))
	}
	if len(cloned) == 0 {
		return nil
	}
	return cloned
}

func cloneNotificationSubscription(subscription NotificationSubscription) NotificationSubscription {
	next := subscription
	next.Topic = strings.TrimSpace(subscription.Topic)
	next.SourceType = strings.TrimSpace(subscription.SourceType)
	if len(subscription.Filter) > 0 {
		next.Filter = cloneStringMap(subscription.Filter)
	} else {
		next.Filter = nil
	}
	next.Channels = cloneNotificationChannelBindings(subscription.Channels)
	return next
}

func cloneNotificationEmailTarget(target NotificationEmailTarget) NotificationEmailTarget {
	next := target
	next.Name = strings.TrimSpace(target.Name)
	next.Emails = cloneStringSlice(target.Emails)
	next.SubjectTemplate = strings.TrimSpace(target.SubjectTemplate)
	next.BodyTemplate = strings.TrimSpace(target.BodyTemplate)
	return next
}

func cloneNotificationMailServerConfig(config NotificationMailServerConfig) NotificationMailServerConfig {
	next := config
	next.WorkspaceID = strings.TrimSpace(config.WorkspaceID)
	next.Host = strings.TrimSpace(config.Host)
	next.Username = strings.TrimSpace(config.Username)
	next.Password = config.Password
	next.PasswordSet = next.Password != ""
	next.From = strings.TrimSpace(config.From)
	if next.Port < 0 {
		next.Port = 0
	}
	return next
}

func cloneNotificationDispatch(dispatch NotificationDispatch) NotificationDispatch {
	next := dispatch
	next.SubscriptionID = strings.TrimSpace(dispatch.SubscriptionID)
	next.EventKey = strings.TrimSpace(dispatch.EventKey)
	next.DedupKey = strings.TrimSpace(dispatch.DedupKey)
	next.Topic = strings.TrimSpace(dispatch.Topic)
	next.SourceType = strings.TrimSpace(dispatch.SourceType)
	next.SourceRefType = strings.TrimSpace(dispatch.SourceRefType)
	next.SourceRefID = strings.TrimSpace(dispatch.SourceRefID)
	next.Channel = strings.TrimSpace(dispatch.Channel)
	next.TargetRefType = strings.TrimSpace(dispatch.TargetRefType)
	next.TargetRefID = strings.TrimSpace(dispatch.TargetRefID)
	next.Title = strings.TrimSpace(dispatch.Title)
	next.Message = strings.TrimSpace(dispatch.Message)
	next.Level = strings.TrimSpace(dispatch.Level)
	next.Status = strings.TrimSpace(dispatch.Status)
	next.Error = strings.TrimSpace(dispatch.Error)
	next.NotificationID = strings.TrimSpace(dispatch.NotificationID)
	next.BotOutboundDeliveryID = strings.TrimSpace(dispatch.BotOutboundDeliveryID)
	next.DeliveredAt = cloneOptionalTime(dispatch.DeliveredAt)
	return next
}

func cloneBotTrigger(trigger BotTrigger) BotTrigger {
	next := trigger
	if len(trigger.Filter) > 0 {
		next.Filter = cloneStringMap(trigger.Filter)
	} else {
		next.Filter = nil
	}
	return next
}

func cloneBotConnection(connection BotConnection) BotConnection {
	next := connection
	if len(connection.AIConfig) > 0 {
		next.AIConfig = cloneStringMap(connection.AIConfig)
	} else {
		next.AIConfig = nil
	}
	if len(connection.Settings) > 0 {
		next.Settings = cloneStringMap(connection.Settings)
	} else {
		next.Settings = nil
	}
	if len(connection.Secrets) > 0 {
		next.Secrets = cloneStringMap(connection.Secrets)
	} else {
		next.Secrets = nil
	}
	next.LastPollAt = cloneOptionalTime(connection.LastPollAt)
	return next
}

func clonePersistedBotConnection(connection BotConnection, stripRuntime bool) BotConnection {
	next := cloneBotConnection(connection)
	if stripRuntime {
		next.LastError = ""
		next.LastPollAt = nil
		next.LastPollStatus = ""
		next.LastPollMessage = ""
		next.LastPollMessageKey = ""
		next.LastPollMessageParams = nil
	}
	return next
}

func migrateBotTopologyLocked(s *MemoryStore) bool {
	changed := false

	for connectionID, connection := range s.botConnections {
		botID := strings.TrimSpace(connection.BotID)
		if botID == "" {
			botID = NewID("botr")
		}
		bot, ok := s.bots[botID]
		if !ok {
			now := connection.CreatedAt
			if now.IsZero() {
				now = time.Now().UTC()
			}
			bot = Bot{
				ID:          botID,
				WorkspaceID: connection.WorkspaceID,
				Name:        firstNonEmpty(strings.TrimSpace(connection.Name), "Bot"),
				Status:      firstNonEmpty(strings.TrimSpace(connection.Status), "active"),
				CreatedAt:   now,
				UpdatedAt:   connection.UpdatedAt,
			}
			if bot.UpdatedAt.IsZero() {
				bot.UpdatedAt = now
			}
			s.bots[botID] = bot
			connection.BotID = botID
			s.botConnections[connectionID] = cloneBotConnection(connection)
			changed = true
		}

		defaultBindingID := strings.TrimSpace(bot.DefaultBindingID)
		if defaultBindingID == "" {
			defaultBindingID = NewID("bbd")
		}
		binding, ok := s.botBindings[defaultBindingID]
		if !ok {
			now := bot.CreatedAt
			if now.IsZero() {
				now = time.Now().UTC()
			}
			binding = BotBinding{
				ID:                defaultBindingID,
				WorkspaceID:       bot.WorkspaceID,
				BotID:             bot.ID,
				Name:              "Default Binding",
				BindingMode:       defaultBindingModeForBackend(connection.AIBackend),
				TargetWorkspaceID: connection.WorkspaceID,
				AIBackend:         strings.TrimSpace(connection.AIBackend),
				AIConfig:          cloneStringMap(connection.AIConfig),
				CreatedAt:         now,
				UpdatedAt:         firstNonEmptyTime(bot.UpdatedAt, now),
			}
			s.botBindings[defaultBindingID] = binding
			changed = true
		}
		if strings.TrimSpace(bot.DefaultBindingID) != defaultBindingID {
			bot.DefaultBindingID = defaultBindingID
			s.bots[bot.ID] = cloneBot(bot)
			changed = true
		}
	}

	for conversationID, conversation := range s.botConversations {
		connection, ok := s.botConnections[conversation.ConnectionID]
		if !ok {
			continue
		}
		if strings.TrimSpace(conversation.BotID) != strings.TrimSpace(connection.BotID) {
			conversation.BotID = strings.TrimSpace(connection.BotID)
			s.botConversations[conversationID] = cloneBotConversation(conversation)
			changed = true
		}
	}

	return changed
}

func cloneWeChatAccount(account WeChatAccount) WeChatAccount {
	return account
}

func cloneBotConversation(conversation BotConversation) BotConversation {
	next := conversation
	if len(conversation.BackendState) > 0 {
		next.BackendState = cloneStringMap(conversation.BackendState)
	} else {
		next.BackendState = nil
	}
	if len(conversation.ProviderState) > 0 {
		next.ProviderState = cloneStringMap(conversation.ProviderState)
	} else {
		next.ProviderState = nil
	}
	next.LastOutboundDeliveredAt = cloneOptionalTime(conversation.LastOutboundDeliveredAt)
	return next
}

func cloneBotDeliveryTarget(target BotDeliveryTarget) BotDeliveryTarget {
	next := target
	next.Labels = cloneStringSlice(target.Labels)
	next.Capabilities = cloneStringSlice(target.Capabilities)
	if len(target.ProviderState) > 0 {
		next.ProviderState = cloneStringMap(target.ProviderState)
	} else {
		next.ProviderState = nil
	}
	next.LastVerifiedAt = cloneOptionalTime(target.LastVerifiedAt)
	return next
}

func cloneBotInboundDelivery(delivery BotInboundDelivery) BotInboundDelivery {
	next := delivery
	next.Media = cloneBotMessageMediaList(delivery.Media)
	if len(delivery.ProviderData) > 0 {
		next.ProviderData = cloneStringMap(delivery.ProviderData)
	} else {
		next.ProviderData = nil
	}
	next.ReplyMessages = cloneBotReplyMessages(delivery.ReplyMessages)
	next.ReplyTexts = cloneStringSlice(delivery.ReplyTexts)
	next.ReplyDeliveredAt = cloneOptionalTime(delivery.ReplyDeliveredAt)
	return next
}

func cloneBotOutboundDelivery(delivery BotOutboundDelivery) BotOutboundDelivery {
	next := delivery
	next.Messages = cloneBotReplyMessages(delivery.Messages)
	next.ProviderMessageIDs = cloneStringSlice(delivery.ProviderMessageIDs)
	next.DeliveredAt = cloneOptionalTime(delivery.DeliveredAt)
	return next
}

func botInboundDeliveryHasSavedReply(delivery BotInboundDelivery) bool {
	return len(delivery.ReplyMessages) > 0 || len(delivery.ReplyTexts) > 0
}

func cloneBotReplyMessages(messages []BotReplyMessage) []BotReplyMessage {
	if len(messages) == 0 {
		return nil
	}

	cloned := make([]BotReplyMessage, 0, len(messages))
	for _, message := range messages {
		next := message
		next.Media = cloneBotMessageMediaList(message.Media)
		cloned = append(cloned, next)
	}
	return cloned
}

func cloneBotMessageMediaList(media []BotMessageMedia) []BotMessageMedia {
	if len(media) == 0 {
		return nil
	}

	cloned := make([]BotMessageMedia, len(media))
	copy(cloned, media)
	return cloned
}

func normalizeBotConversationExternalRouting(conversation BotConversation) BotConversation {
	conversation.ExternalConversationID = strings.TrimSpace(conversation.ExternalConversationID)
	conversation.ExternalChatID = strings.TrimSpace(conversation.ExternalChatID)
	conversation.ExternalThreadID = strings.TrimSpace(conversation.ExternalThreadID)

	if conversation.ExternalConversationID == "" {
		conversation.ExternalConversationID = conversation.ExternalChatID
	}
	if conversation.ExternalChatID == "" {
		conversation.ExternalChatID = conversation.ExternalConversationID
	}

	return conversation
}

func effectiveBotConversationExternalConversationID(conversation BotConversation) string {
	return firstNonEmpty(
		strings.TrimSpace(conversation.ExternalConversationID),
		strings.TrimSpace(conversation.ExternalChatID),
	)
}

func normalizeBotInboundExternalRouting(delivery BotInboundDelivery) BotInboundDelivery {
	delivery.ExternalConversationID = strings.TrimSpace(delivery.ExternalConversationID)
	delivery.ExternalChatID = strings.TrimSpace(delivery.ExternalChatID)
	delivery.ExternalThreadID = strings.TrimSpace(delivery.ExternalThreadID)

	if delivery.ExternalConversationID == "" {
		delivery.ExternalConversationID = delivery.ExternalChatID
	}
	if delivery.ExternalChatID == "" {
		delivery.ExternalChatID = delivery.ExternalConversationID
	}

	return delivery
}

func effectiveBotInboundExternalConversationID(delivery BotInboundDelivery) string {
	return firstNonEmpty(
		strings.TrimSpace(delivery.ExternalConversationID),
		strings.TrimSpace(delivery.ExternalChatID),
	)
}

func defaultBindingModeForBackend(aiBackend string) string {
	if strings.EqualFold(strings.TrimSpace(aiBackend), "openai_responses") {
		return "stateless"
	}
	return "workspace_auto_thread"
}

func firstNonEmptyTime(value time.Time, fallback time.Time) time.Time {
	if value.IsZero() {
		return fallback
	}
	return value
}

func botInboundDeliverySortsAfter(left BotInboundDelivery, right BotInboundDelivery) bool {
	switch {
	case left.UpdatedAt.After(right.UpdatedAt):
		return true
	case left.UpdatedAt.Before(right.UpdatedAt):
		return false
	case left.CreatedAt.After(right.CreatedAt):
		return true
	case left.CreatedAt.Before(right.CreatedAt):
		return false
	default:
		return left.ID > right.ID
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func cloneThreadTokenUsage(usage *ThreadTokenUsage) *ThreadTokenUsage {
	if usage == nil {
		return nil
	}

	cloned := *usage
	if usage.ModelContextWindow != nil {
		value := *usage.ModelContextWindow
		cloned.ModelContextWindow = &value
	}
	return &cloned
}

func cloneOptionalTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
}

func cloneAccessTokens(values []AccessToken) []AccessToken {
	if len(values) == 0 {
		return nil
	}

	cloned := make([]AccessToken, len(values))
	for index, token := range values {
		next := token
		next.ExpiresAt = cloneOptionalTime(token.ExpiresAt)
		cloned[index] = next
	}
	return cloned
}

func cloneTurnPolicyAlertGovernanceHistory(values []TurnPolicyAlertGovernanceEvent) []TurnPolicyAlertGovernanceEvent {
	if len(values) == 0 {
		return nil
	}

	cloned := make([]TurnPolicyAlertGovernanceEvent, len(values))
	for index, event := range values {
		next := event
		next.Codes = cloneStringSlice(event.Codes)
		next.SnoozeUntil = cloneOptionalTime(event.SnoozeUntil)
		next.CreatedAt = event.CreatedAt.UTC()
		cloned[index] = next
	}
	return cloned
}

func cloneThreadTurns(turns []ThreadTurn) []ThreadTurn {
	if len(turns) == 0 {
		return []ThreadTurn{}
	}

	cloned := make([]ThreadTurn, 0, len(turns))
	for _, turn := range turns {
		cloned = append(cloned, ThreadTurn{
			ID:     turn.ID,
			Status: turn.Status,
			Items:  cloneItems(turn.Items),
			Error:  turn.Error,
		})
	}
	return cloned
}

func threadProjectionSnapshotEqual(left threadProjectionRecord, right threadProjectionRecord) bool {
	return left.Projection.WorkspaceID == right.Projection.WorkspaceID &&
		left.Projection.ThreadID == right.Projection.ThreadID &&
		left.Projection.Cwd == right.Projection.Cwd &&
		left.Projection.Preview == right.Projection.Preview &&
		left.Projection.Path == right.Projection.Path &&
		left.Projection.Source == right.Projection.Source &&
		left.Projection.Status == right.Projection.Status &&
		left.Projection.UpdatedAt.Equal(right.Projection.UpdatedAt) &&
		left.Projection.TurnCount == right.Projection.TurnCount &&
		left.Projection.MessageCount == right.Projection.MessageCount &&
		left.Projection.SnapshotComplete == right.Projection.SnapshotComplete &&
		reflect.DeepEqual(left.Projection.TokenUsage, right.Projection.TokenUsage) &&
		threadProjectionStatsEqual(left.Stats, right.Stats) &&
		bytes.Equal(threadProjectionRecordTurnsRaw(left), threadProjectionRecordTurnsRaw(right))
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func cloneStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func normalizeStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func normalizeStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	normalized := make(map[string]string)
	keys := make([]string, 0, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		trimmedValue := strings.TrimSpace(value)
		if trimmedKey == "" || trimmedValue == "" {
			continue
		}
		if _, exists := normalized[trimmedKey]; exists {
			continue
		}
		normalized[trimmedKey] = trimmedValue
		keys = append(keys, trimmedKey)
	}
	if len(normalized) == 0 {
		return nil
	}

	sort.Strings(keys)
	ordered := make(map[string]string, len(keys))
	for _, key := range keys {
		ordered[key] = normalized[key]
	}
	return ordered
}

func cloneAnyMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = cloneAnyValue(value)
	}
	return cloned
}

func cloneAnyValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneAnyMap(typed)
	case []any:
		cloned := make([]any, len(typed))
		for index, entry := range typed {
			cloned[index] = cloneAnyValue(entry)
		}
		return cloned
	default:
		return typed
	}
}

func pruneCommandSessionsLocked(workspaceSessions map[string]CommandSessionSnapshot) {
	type sessionEntry struct {
		processID string
		session   CommandSessionSnapshot
	}

	regularItems := make([]sessionEntry, 0, len(workspaceSessions))
	protectedItems := make([]sessionEntry, 0, len(workspaceSessions))
	for processID, session := range workspaceSessions {
		if isCommandSessionActiveStatus(session.Status) {
			continue
		}

		entry := sessionEntry{
			processID: processID,
			session:   session,
		}
		if session.Pinned || session.Archived {
			protectedItems = append(protectedItems, entry)
			continue
		}

		regularItems = append(regularItems, entry)
	}

	if len(regularItems) > commandSessionRetentionLimit {
		sort.Slice(regularItems, func(i int, j int) bool {
			return regularItems[i].session.UpdatedAt.After(regularItems[j].session.UpdatedAt)
		})

		for _, item := range regularItems[commandSessionRetentionLimit:] {
			delete(workspaceSessions, item.processID)
		}
	}

	if len(protectedItems) > commandSessionPinnedArchivedLimit {
		sort.Slice(protectedItems, func(i int, j int) bool {
			return protectedItems[i].session.UpdatedAt.After(protectedItems[j].session.UpdatedAt)
		})

		for _, item := range protectedItems[commandSessionPinnedArchivedLimit:] {
			delete(workspaceSessions, item.processID)
		}
	}
}

func isCommandSessionActiveStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "running", "starting", "processing":
		return true
	default:
		return false
	}
}
