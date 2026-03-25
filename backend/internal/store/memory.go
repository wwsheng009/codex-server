package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrWorkspaceNotFound          = errors.New("workspace not found")
	ErrThreadNotFound             = errors.New("thread not found")
	ErrApprovalNotFound           = errors.New("approval not found")
	ErrAutomationNotFound         = errors.New("automation not found")
	ErrAutomationTemplateNotFound = errors.New("automation template not found")
	ErrAutomationRunNotFound      = errors.New("automation run not found")
	ErrNotificationNotFound       = errors.New("notification not found")
	ErrBotConnectionNotFound      = errors.New("bot connection not found")
	ErrBotConversationNotFound    = errors.New("bot conversation not found")
)

const (
	commandSessionRetentionLimit      = 12
	commandSessionPinnedArchivedLimit = 24
	commandSessionCompletedTTL        = 24 * time.Hour
)

type MemoryStore struct {
	mu               sync.RWMutex
	path             string
	runtimePrefs     RuntimePreferences
	workspaces       map[string]Workspace
	commandSessions  map[string]map[string]CommandSessionSnapshot
	automations      map[string]Automation
	templates        map[string]AutomationTemplate
	runs             map[string]AutomationRun
	notifications    map[string]Notification
	botConnections   map[string]BotConnection
	botConversations map[string]BotConversation
	threads          map[string]Thread
	projections      map[string]ThreadProjection
	deleted          map[string]DeletedThread
	approvals        map[string]PendingApproval
}

type storeSnapshot struct {
	RuntimePreferences  *RuntimePreferences      `json:"runtimePreferences,omitempty"`
	Workspaces          []Workspace              `json:"workspaces"`
	CommandSessions     []CommandSessionSnapshot `json:"commandSessions,omitempty"`
	Automations         []Automation             `json:"automations,omitempty"`
	AutomationTemplates []AutomationTemplate     `json:"automationTemplates,omitempty"`
	AutomationRuns      []AutomationRun          `json:"automationRuns,omitempty"`
	Notifications       []Notification           `json:"notifications,omitempty"`
	BotConnections      []BotConnection          `json:"botConnections,omitempty"`
	BotConversations    []BotConversation        `json:"botConversations,omitempty"`
	Threads             []Thread                 `json:"threads"`
	ThreadProjections   []ThreadProjection       `json:"threadProjections,omitempty"`
	DeletedThreads      []DeletedThread          `json:"deletedThreads,omitempty"`
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		workspaces:       make(map[string]Workspace),
		commandSessions:  make(map[string]map[string]CommandSessionSnapshot),
		automations:      make(map[string]Automation),
		templates:        make(map[string]AutomationTemplate),
		runs:             make(map[string]AutomationRun),
		notifications:    make(map[string]Notification),
		botConnections:   make(map[string]BotConnection),
		botConversations: make(map[string]BotConversation),
		threads:          make(map[string]Thread),
		projections:      make(map[string]ThreadProjection),
		deleted:          make(map[string]DeletedThread),
		approvals:        make(map[string]PendingApproval),
	}
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
	return prefs
}

func (s *MemoryStore) SetRuntimePreferences(prefs RuntimePreferences) RuntimePreferences {
	s.mu.Lock()
	defer s.mu.Unlock()

	prefs.ModelCatalogPath = strings.TrimSpace(prefs.ModelCatalogPath)
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
	prefs.UpdatedAt = time.Now().UTC()
	s.runtimePrefs = prefs
	s.persistLocked()

	return s.runtimePrefs
}

func NewPersistentStore(path string) (*MemoryStore, error) {
	store := NewMemoryStore()
	store.path = path

	if err := store.load(); err != nil {
		return nil, err
	}

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
	next.WorkspaceID = connection.WorkspaceID
	next.CreatedAt = connection.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.AIConfig = cloneStringMap(next.AIConfig)
	next.Settings = cloneStringMap(next.Settings)
	next.Secrets = cloneStringMap(next.Secrets)

	s.botConnections[connectionID] = next
	s.persistLocked()

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
	for conversationID, conversation := range s.botConversations {
		if conversation.ConnectionID == connectionID && conversation.WorkspaceID == workspaceID {
			delete(s.botConversations, conversationID)
		}
	}

	s.persistLocked()
	return nil
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

func (s *MemoryStore) FindBotConversationByExternalChat(
	workspaceID string,
	connectionID string,
	externalChatID string,
) (BotConversation, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, conversation := range s.botConversations {
		if conversation.WorkspaceID != workspaceID ||
			conversation.ConnectionID != connectionID ||
			conversation.ExternalChatID != externalChatID {
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
	conversation.BackendState = cloneStringMap(conversation.BackendState)

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
	next.WorkspaceID = conversation.WorkspaceID
	next.ConnectionID = conversation.ConnectionID
	next.Provider = conversation.Provider
	next.ExternalChatID = conversation.ExternalChatID
	next.CreatedAt = conversation.CreatedAt
	next.UpdatedAt = time.Now().UTC()
	next.BackendState = cloneStringMap(next.BackendState)

	s.botConversations[conversationID] = next
	s.persistLocked()

	return cloneBotConversation(next), nil
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
	defer s.mu.RUnlock()

	projection, ok := s.projections[threadProjectionKey(workspaceID, threadID)]
	return projection, ok
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
		Turns:            cloneThreadTurns(detail.Turns),
	}
	current := s.projections[threadProjectionKey(detail.WorkspaceID, detail.ID)]
	if threadProjectionSnapshotEqual(current, projection) {
		return
	}
	s.projections[threadProjectionKey(detail.WorkspaceID, detail.ID)] = projection
	s.persistLocked()
}

func (s *MemoryStore) ApplyThreadEvent(event EventEnvelope) {
	if event.ThreadID == "" {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	key := threadProjectionKey(event.WorkspaceID, event.ThreadID)
	projection := s.projections[key]
	if projection.ThreadID == "" {
		projection = ThreadProjection{
			WorkspaceID:  event.WorkspaceID,
			ThreadID:     event.ThreadID,
			TurnCount:    0,
			MessageCount: 0,
			Turns:        []ThreadTurn{},
		}
	}

	if !applyThreadEventToProjection(&projection, event) {
		return
	}

	s.projections[key] = projection
	s.persistLocked()
}

func (s *MemoryStore) RemoveThread(workspaceID string, threadID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	thread, ok := s.threads[threadID]
	if !ok || thread.WorkspaceID != workspaceID {
		return
	}

	delete(s.threads, threadID)
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
	delete(s.projections, threadProjectionKey(workspaceID, threadID))
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
	for connectionID, connection := range s.botConnections {
		if connection.WorkspaceID == workspaceID {
			delete(s.botConnections, connectionID)
		}
	}
	for conversationID, conversation := range s.botConversations {
		if conversation.WorkspaceID == workspaceID {
			delete(s.botConversations, conversationID)
		}
	}
	delete(s.commandSessions, workspaceID)

	for threadID, thread := range s.threads {
		if thread.WorkspaceID == workspaceID {
			delete(s.threads, threadID)
		}
	}
	for key, projection := range s.projections {
		if projection.WorkspaceID == workspaceID {
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

func (s *MemoryStore) load() error {
	if s.path == "" {
		return nil
	}

	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}

	var snapshot storeSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return err
	}

	if snapshot.RuntimePreferences != nil {
		s.runtimePrefs = *snapshot.RuntimePreferences
		if len(s.runtimePrefs.LocalShellModels) > 0 {
			s.runtimePrefs.LocalShellModels = append([]string(nil), s.runtimePrefs.LocalShellModels...)
		}
		if len(s.runtimePrefs.ModelShellTypeOverrides) > 0 {
			s.runtimePrefs.ModelShellTypeOverrides = cloneStringMap(s.runtimePrefs.ModelShellTypeOverrides)
		}
		if len(s.runtimePrefs.DefaultTurnSandboxPolicy) > 0 {
			s.runtimePrefs.DefaultTurnSandboxPolicy = cloneAnyMap(s.runtimePrefs.DefaultTurnSandboxPolicy)
		}
		if len(s.runtimePrefs.DefaultCommandSandboxPolicy) > 0 {
			s.runtimePrefs.DefaultCommandSandboxPolicy = cloneAnyMap(s.runtimePrefs.DefaultCommandSandboxPolicy)
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var maxID uint64
	for _, workspace := range snapshot.Workspaces {
		s.workspaces[workspace.ID] = workspace
		if value := NumericIDSuffix(workspace.ID); value > maxID {
			maxID = value
		}
	}
	for _, session := range snapshot.CommandSessions {
		workspaceSessions := s.commandSessions[session.WorkspaceID]
		if workspaceSessions == nil {
			workspaceSessions = make(map[string]CommandSessionSnapshot)
			s.commandSessions[session.WorkspaceID] = workspaceSessions
		}
		workspaceSessions[session.ID] = session
		if value := NumericIDSuffix(session.ID); value > maxID {
			maxID = value
		}
	}
	prunedCommandSessions := false
	for _, workspaceSessions := range s.commandSessions {
		beforeCount := len(workspaceSessions)
		pruneCommandSessionsLocked(workspaceSessions)
		if len(workspaceSessions) != beforeCount {
			prunedCommandSessions = true
		}
	}

	for _, automation := range snapshot.Automations {
		s.automations[automation.ID] = automation
		if value := NumericIDSuffix(automation.ID); value > maxID {
			maxID = value
		}
	}
	for _, template := range snapshot.AutomationTemplates {
		s.templates[template.ID] = template
		if value := NumericIDSuffix(template.ID); value > maxID {
			maxID = value
		}
	}
	for _, run := range snapshot.AutomationRuns {
		s.runs[run.ID] = cloneAutomationRun(run)
		if value := NumericIDSuffix(run.ID); value > maxID {
			maxID = value
		}
		for _, entry := range run.Logs {
			if value := NumericIDSuffix(entry.ID); value > maxID {
				maxID = value
			}
		}
	}
	for _, notification := range snapshot.Notifications {
		s.notifications[notification.ID] = notification
		if value := NumericIDSuffix(notification.ID); value > maxID {
			maxID = value
		}
	}
	for _, connection := range snapshot.BotConnections {
		s.botConnections[connection.ID] = cloneBotConnection(connection)
		if value := NumericIDSuffix(connection.ID); value > maxID {
			maxID = value
		}
	}
	for _, conversation := range snapshot.BotConversations {
		s.botConversations[conversation.ID] = cloneBotConversation(conversation)
		if value := NumericIDSuffix(conversation.ID); value > maxID {
			maxID = value
		}
	}

	for _, thread := range snapshot.Threads {
		s.threads[thread.ID] = thread
		if value := NumericIDSuffix(thread.ID); value > maxID {
			maxID = value
		}
	}
	for _, projection := range snapshot.ThreadProjections {
		s.projections[threadProjectionKey(projection.WorkspaceID, projection.ThreadID)] = projection
	}

	for _, deletedThread := range snapshot.DeletedThreads {
		s.deleted[deletedThreadKey(deletedThread.WorkspaceID, deletedThread.ThreadID)] = deletedThread
	}

	SeedIDCounter(maxID)
	if prunedCommandSessions {
		s.persistLocked()
	}
	return nil
}

func (s *MemoryStore) persistLocked() {
	if s.path == "" {
		return
	}

	snapshot := storeSnapshot{
		Workspaces:          make([]Workspace, 0, len(s.workspaces)),
		CommandSessions:     make([]CommandSessionSnapshot, 0),
		Automations:         make([]Automation, 0, len(s.automations)),
		AutomationTemplates: make([]AutomationTemplate, 0, len(s.templates)),
		AutomationRuns:      make([]AutomationRun, 0, len(s.runs)),
		Notifications:       make([]Notification, 0, len(s.notifications)),
		BotConnections:      make([]BotConnection, 0, len(s.botConnections)),
		BotConversations:    make([]BotConversation, 0, len(s.botConversations)),
		Threads:             make([]Thread, 0, len(s.threads)),
		ThreadProjections:   make([]ThreadProjection, 0, len(s.projections)),
		DeletedThreads:      make([]DeletedThread, 0, len(s.deleted)),
	}

	if s.runtimePrefs.ModelCatalogPath != "" ||
		len(s.runtimePrefs.LocalShellModels) > 0 ||
		s.runtimePrefs.DefaultShellType != "" ||
		s.runtimePrefs.DefaultTerminalShell != "" ||
		len(s.runtimePrefs.ModelShellTypeOverrides) > 0 ||
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
	for _, connection := range s.botConnections {
		snapshot.BotConnections = append(snapshot.BotConnections, cloneBotConnection(connection))
	}
	for _, conversation := range s.botConversations {
		snapshot.BotConversations = append(snapshot.BotConversations, cloneBotConversation(conversation))
	}
	for _, thread := range s.threads {
		snapshot.Threads = append(snapshot.Threads, thread)
	}
	for _, projection := range s.projections {
		snapshot.ThreadProjections = append(snapshot.ThreadProjections, projection)
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
	sort.Slice(snapshot.BotConnections, func(i int, j int) bool {
		return snapshot.BotConnections[i].ID < snapshot.BotConnections[j].ID
	})
	sort.Slice(snapshot.BotConversations, func(i int, j int) bool {
		return snapshot.BotConversations[i].ID < snapshot.BotConversations[j].ID
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
		return
	}

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return
	}

	_ = os.WriteFile(s.path, data, 0o644)
}

func deletedThreadKey(workspaceID string, threadID string) string {
	return workspaceID + "\x00" + threadID
}

func threadProjectionKey(workspaceID string, threadID string) string {
	return workspaceID + "\x00" + threadID
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
	return next
}

func cloneBotConversation(conversation BotConversation) BotConversation {
	next := conversation
	if len(conversation.BackendState) > 0 {
		next.BackendState = cloneStringMap(conversation.BackendState)
	} else {
		next.BackendState = nil
	}
	return next
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

func threadProjectionSnapshotEqual(left ThreadProjection, right ThreadProjection) bool {
	return left.WorkspaceID == right.WorkspaceID &&
		left.ThreadID == right.ThreadID &&
		left.Cwd == right.Cwd &&
		left.Preview == right.Preview &&
		left.Path == right.Path &&
		left.Source == right.Source &&
		left.Status == right.Status &&
		left.UpdatedAt.Equal(right.UpdatedAt) &&
		left.TurnCount == right.TurnCount &&
		left.MessageCount == right.MessageCount &&
		left.SnapshotComplete == right.SnapshotComplete &&
		reflect.DeepEqual(left.TokenUsage, right.TokenUsage) &&
		reflect.DeepEqual(left.Turns, right.Turns)
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
