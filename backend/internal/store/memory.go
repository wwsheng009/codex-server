package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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
)

type MemoryStore struct {
	mu            sync.RWMutex
	path          string
	runtimePrefs  RuntimePreferences
	workspaces    map[string]Workspace
	automations   map[string]Automation
	templates     map[string]AutomationTemplate
	runs          map[string]AutomationRun
	notifications map[string]Notification
	threads       map[string]Thread
	projections   map[string]ThreadProjection
	deleted       map[string]DeletedThread
	approvals     map[string]PendingApproval
}

type storeSnapshot struct {
	RuntimePreferences  *RuntimePreferences  `json:"runtimePreferences,omitempty"`
	Workspaces          []Workspace          `json:"workspaces"`
	Automations         []Automation         `json:"automations,omitempty"`
	AutomationTemplates []AutomationTemplate `json:"automationTemplates,omitempty"`
	AutomationRuns      []AutomationRun      `json:"automationRuns,omitempty"`
	Notifications       []Notification       `json:"notifications,omitempty"`
	Threads             []Thread             `json:"threads"`
	ThreadProjections   []ThreadProjection   `json:"threadProjections,omitempty"`
	DeletedThreads      []DeletedThread      `json:"deletedThreads,omitempty"`
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		workspaces:    make(map[string]Workspace),
		automations:   make(map[string]Automation),
		templates:     make(map[string]AutomationTemplate),
		runs:          make(map[string]AutomationRun),
		notifications: make(map[string]Notification),
		threads:       make(map[string]Thread),
		projections:   make(map[string]ThreadProjection),
		deleted:       make(map[string]DeletedThread),
		approvals:     make(map[string]PendingApproval),
	}
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
	return prefs
}

func (s *MemoryStore) SetRuntimePreferences(prefs RuntimePreferences) RuntimePreferences {
	s.mu.Lock()
	defer s.mu.Unlock()

	prefs.ModelCatalogPath = strings.TrimSpace(prefs.ModelCatalogPath)
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
			WorkspaceID: event.WorkspaceID,
			ThreadID:    event.ThreadID,
			Turns:       []ThreadTurn{},
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
	return nil
}

func (s *MemoryStore) persistLocked() {
	if s.path == "" {
		return
	}

	snapshot := storeSnapshot{
		Workspaces:          make([]Workspace, 0, len(s.workspaces)),
		Automations:         make([]Automation, 0, len(s.automations)),
		AutomationTemplates: make([]AutomationTemplate, 0, len(s.templates)),
		AutomationRuns:      make([]AutomationRun, 0, len(s.runs)),
		Notifications:       make([]Notification, 0, len(s.notifications)),
		Threads:             make([]Thread, 0, len(s.threads)),
		ThreadProjections:   make([]ThreadProjection, 0, len(s.projections)),
		DeletedThreads:      make([]DeletedThread, 0, len(s.deleted)),
	}

	if s.runtimePrefs.ModelCatalogPath != "" ||
		len(s.runtimePrefs.LocalShellModels) > 0 ||
		s.runtimePrefs.DefaultShellType != "" ||
		len(s.runtimePrefs.ModelShellTypeOverrides) > 0 {
		prefs := s.runtimePrefs
		if len(prefs.LocalShellModels) > 0 {
			prefs.LocalShellModels = append([]string(nil), prefs.LocalShellModels...)
		}
		if len(prefs.ModelShellTypeOverrides) > 0 {
			prefs.ModelShellTypeOverrides = cloneStringMap(prefs.ModelShellTypeOverrides)
		}
		snapshot.RuntimePreferences = &prefs
	}

	for _, workspace := range s.workspaces {
		snapshot.Workspaces = append(snapshot.Workspaces, workspace)
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
