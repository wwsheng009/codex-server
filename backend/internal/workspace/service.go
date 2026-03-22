package workspace

import (
	"context"
	"errors"
	"strings"
	"time"

	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store    *store.MemoryStore
	runtimes *runtime.Manager
}

type RuntimeStateResult struct {
	WorkspaceID            string     `json:"workspaceId"`
	Status                 string     `json:"status"`
	Command                string     `json:"command"`
	RootPath               string     `json:"rootPath"`
	LastError              string     `json:"lastError,omitempty"`
	StartedAt              *time.Time `json:"startedAt,omitempty"`
	UpdatedAt              time.Time  `json:"updatedAt"`
	RuntimeConfigChangedAt *time.Time `json:"runtimeConfigChangedAt,omitempty"`
	ConfigLoadStatus       string     `json:"configLoadStatus"`
	RestartRequired        bool       `json:"restartRequired"`
}

func NewService(dataStore *store.MemoryStore, runtimeManager *runtime.Manager) *Service {
	service := &Service{
		store:    dataStore,
		runtimes: runtimeManager,
	}

	for _, workspace := range dataStore.ListWorkspaces() {
		runtimeManager.Configure(workspace.ID, workspace.RootPath)
	}

	return service
}

func (s *Service) List() []store.Workspace {
	items := s.store.ListWorkspaces()
	for index := range items {
		items[index].RuntimeStatus = s.runtimes.State(items[index].ID).Status
	}

	return items
}

func (s *Service) Create(name string, rootPath string) (store.Workspace, error) {
	if strings.TrimSpace(name) == "" {
		return store.Workspace{}, errors.New("workspace name is required")
	}

	if strings.TrimSpace(rootPath) == "" {
		return store.Workspace{}, errors.New("workspace rootPath is required")
	}

	workspace := s.store.CreateWorkspace(name, rootPath)
	s.runtimes.Configure(workspace.ID, rootPath)
	workspace.RuntimeStatus = s.runtimes.State(workspace.ID).Status

	return workspace, nil
}

func (s *Service) Get(workspaceID string) (store.Workspace, bool) {
	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return store.Workspace{}, false
	}

	workspace.RuntimeStatus = s.runtimes.State(workspace.ID).Status
	return workspace, true
}

func (s *Service) EnsureRuntime(ctx context.Context, workspaceID string) (store.Workspace, error) {
	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return store.Workspace{}, store.ErrWorkspaceNotFound
	}

	if _, err := s.runtimes.EnsureStarted(ctx, workspaceID); err != nil {
		return store.Workspace{}, err
	}

	workspace.RuntimeStatus = s.runtimes.State(workspaceID).Status
	return workspace, nil
}

func (s *Service) Rename(workspaceID string, name string) (store.Workspace, error) {
	if strings.TrimSpace(name) == "" {
		return store.Workspace{}, errors.New("workspace name is required")
	}

	workspace, err := s.store.SetWorkspaceName(workspaceID, strings.TrimSpace(name))
	if err != nil {
		return store.Workspace{}, err
	}

	workspace.RuntimeStatus = s.runtimes.State(workspaceID).Status
	return workspace, nil
}

func (s *Service) RestartRuntime(ctx context.Context, workspaceID string) (store.Workspace, error) {
	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return store.Workspace{}, store.ErrWorkspaceNotFound
	}

	s.runtimes.Remove(workspaceID)
	s.runtimes.Configure(workspaceID, workspace.RootPath)

	if _, err := s.runtimes.EnsureStarted(ctx, workspaceID); err != nil {
		return store.Workspace{}, err
	}

	workspace.RuntimeStatus = s.runtimes.State(workspaceID).Status
	return workspace, nil
}

func (s *Service) RuntimeState(workspaceID string) (RuntimeStateResult, error) {
	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return RuntimeStateResult{}, store.ErrWorkspaceNotFound
	}

	state := s.runtimes.State(workspaceID)
	if strings.TrimSpace(state.RootPath) == "" {
		state.RootPath = workspace.RootPath
	}

	configLoadStatus, restartRequired := runtimeConfigLoadState(state.StartedAt, workspace.RuntimeConfigChangedAt)
	return RuntimeStateResult{
		WorkspaceID:            workspace.ID,
		Status:                 state.Status,
		Command:                state.Command,
		RootPath:               state.RootPath,
		LastError:              state.LastError,
		StartedAt:              state.StartedAt,
		UpdatedAt:              state.UpdatedAt,
		RuntimeConfigChangedAt: workspace.RuntimeConfigChangedAt,
		ConfigLoadStatus:       configLoadStatus,
		RestartRequired:        restartRequired,
	}, nil
}

func (s *Service) MarkRuntimeConfigChanged(workspaceID string) (store.Workspace, error) {
	return s.store.SetWorkspaceRuntimeConfigChangedAt(workspaceID, time.Now().UTC())
}

func runtimeConfigLoadState(startedAt *time.Time, changedAt *time.Time) (string, bool) {
	if changedAt == nil {
		return "not-tracked", false
	}
	if startedAt == nil {
		return "restart-required", true
	}
	if startedAt.Before(*changedAt) {
		return "restart-required", true
	}
	return "loaded", false
}

func (s *Service) Delete(_ context.Context, workspaceID string) error {
	if _, ok := s.store.GetWorkspace(workspaceID); !ok {
		return store.ErrWorkspaceNotFound
	}

	s.runtimes.Remove(workspaceID)
	return s.store.DeleteWorkspace(workspaceID)
}
