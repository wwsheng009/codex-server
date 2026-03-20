package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

var (
	ErrWorkspaceNotFound = errors.New("workspace not found")
	ErrThreadNotFound    = errors.New("thread not found")
	ErrApprovalNotFound  = errors.New("approval not found")
)

type MemoryStore struct {
	mu          sync.RWMutex
	path        string
	workspaces  map[string]Workspace
	threads     map[string]Thread
	projections map[string]ThreadProjection
	deleted     map[string]DeletedThread
	approvals   map[string]PendingApproval
}

type storeSnapshot struct {
	Workspaces        []Workspace        `json:"workspaces"`
	Threads           []Thread           `json:"threads"`
	ThreadProjections []ThreadProjection `json:"threadProjections,omitempty"`
	DeletedThreads    []DeletedThread    `json:"deletedThreads,omitempty"`
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		workspaces:  make(map[string]Workspace),
		threads:     make(map[string]Thread),
		projections: make(map[string]ThreadProjection),
		deleted:     make(map[string]DeletedThread),
		approvals:   make(map[string]PendingApproval),
	}
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

	s.mu.Lock()
	defer s.mu.Unlock()

	var maxID uint64
	for _, workspace := range snapshot.Workspaces {
		s.workspaces[workspace.ID] = workspace
		if value := NumericIDSuffix(workspace.ID); value > maxID {
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
		Workspaces:        make([]Workspace, 0, len(s.workspaces)),
		Threads:           make([]Thread, 0, len(s.threads)),
		ThreadProjections: make([]ThreadProjection, 0, len(s.projections)),
		DeletedThreads:    make([]DeletedThread, 0, len(s.deleted)),
	}

	for _, workspace := range s.workspaces {
		snapshot.Workspaces = append(snapshot.Workspaces, workspace)
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
