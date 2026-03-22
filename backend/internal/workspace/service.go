package workspace

import (
	"context"
	"errors"
	"strings"

	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	store    *store.MemoryStore
	runtimes *runtime.Manager
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

func (s *Service) RuntimeState(workspaceID string) (runtime.State, error) {
	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return runtime.State{}, store.ErrWorkspaceNotFound
	}

	state := s.runtimes.State(workspaceID)
	state.WorkspaceID = workspace.ID
	if strings.TrimSpace(state.RootPath) == "" {
		state.RootPath = workspace.RootPath
	}

	return state, nil
}

func (s *Service) Delete(_ context.Context, workspaceID string) error {
	if _, ok := s.store.GetWorkspace(workspaceID); !ok {
		return store.ErrWorkspaceNotFound
	}

	s.runtimes.Remove(workspaceID)
	return s.store.DeleteWorkspace(workspaceID)
}
