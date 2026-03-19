package execfs

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	stdruntime "runtime"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	runtimes  *appRuntime.Manager
	events    *events.Hub
	mu        sync.RWMutex
	processes map[string]string
}

type FileResult struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type DirectoryEntry struct {
	FileName    string `json:"fileName"`
	IsDirectory bool   `json:"isDirectory"`
	IsFile      bool   `json:"isFile"`
}

type DirectoryResult struct {
	Path    string           `json:"path"`
	Entries []DirectoryEntry `json:"entries"`
}

type MetadataResult struct {
	Path         string `json:"path"`
	CreatedAtMs  int64  `json:"createdAtMs"`
	ModifiedAtMs int64  `json:"modifiedAtMs"`
	IsDirectory  bool   `json:"isDirectory"`
	IsFile       bool   `json:"isFile"`
}

type PathResult struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

type CopyResult struct {
	SourcePath      string `json:"sourcePath"`
	DestinationPath string `json:"destinationPath"`
	Status          string `json:"status"`
}

func NewService(runtimeManager *appRuntime.Manager, eventHub *events.Hub) *Service {
	return &Service{
		runtimes:  runtimeManager,
		events:    eventHub,
		processes: make(map[string]string),
	}
}

func (s *Service) StartCommand(ctx context.Context, workspaceID string, command string) (store.CommandSession, error) {
	if strings.TrimSpace(command) == "" {
		return store.CommandSession{}, errors.New("command is required")
	}

	processID := store.NewID("proc")
	session := store.CommandSession{
		ID:          processID,
		WorkspaceID: workspaceID,
		Command:     command,
		Status:      "running",
		CreatedAt:   time.Now().UTC(),
	}

	s.mu.Lock()
	s.processes[processID] = workspaceID
	s.mu.Unlock()

	s.events.Publish(store.EventEnvelope{
		WorkspaceID: workspaceID,
		Method:      "command/exec/started",
		Payload:     session,
		TS:          time.Now().UTC(),
	})

	go func() {
		var response struct {
			ExitCode int    `json:"exitCode"`
			Stdout   string `json:"stdout"`
			Stderr   string `json:"stderr"`
		}

		err := s.runtimes.Call(context.Background(), workspaceID, "command/exec", map[string]any{
			"command":            shellCommandArgs(command),
			"cwd":                s.runtimes.RootPath(workspaceID),
			"processId":          processID,
			"sandboxPolicy":      commandSandboxPolicy(),
			"streamStdin":        true,
			"streamStdoutStderr": true,
			"tty":                true,
		}, &response)
		if err != nil {
			s.mu.Lock()
			delete(s.processes, processID)
			s.mu.Unlock()
			s.events.Publish(store.EventEnvelope{
				WorkspaceID: workspaceID,
				Method:      "command/exec/completed",
				Payload: map[string]any{
					"error":     err.Error(),
					"processId": processID,
					"status":    "failed",
				},
				TS: time.Now().UTC(),
			})
			return
		}

		s.mu.Lock()
		delete(s.processes, processID)
		s.mu.Unlock()

		s.events.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			Method:      "command/exec/completed",
			Payload: map[string]any{
				"exitCode":  response.ExitCode,
				"processId": processID,
				"status":    "completed",
				"stderr":    response.Stderr,
				"stdout":    response.Stdout,
			},
			TS: time.Now().UTC(),
		})
	}()

	return session, nil
}

func (s *Service) Write(ctx context.Context, processID string, input string) error {
	if strings.TrimSpace(processID) == "" {
		return errors.New("processId is required")
	}

	encoded := base64.StdEncoding.EncodeToString([]byte(input))
	workspaceID, ok := s.workspaceIDByProcess(processID)
	if !ok {
		return appRuntime.ErrRuntimeNotConfigured
	}

	return s.runtimes.Call(ctx, workspaceID, "command/exec/write", map[string]any{
		"deltaBase64": encoded,
		"processId":   processID,
	}, nil)
}

func (s *Service) Resize(ctx context.Context, processID string, cols int, rows int) error {
	if strings.TrimSpace(processID) == "" {
		return errors.New("processId is required")
	}

	if cols <= 0 || rows <= 0 {
		return errors.New("terminal cols and rows must be positive")
	}

	workspaceID, ok := s.workspaceIDByProcess(processID)
	if !ok {
		return appRuntime.ErrRuntimeNotConfigured
	}

	return s.runtimes.Call(ctx, workspaceID, "command/exec/resize", map[string]any{
		"processId": processID,
		"size": map[string]any{
			"cols": cols,
			"rows": rows,
		},
	}, nil)
}

func (s *Service) Terminate(ctx context.Context, processID string) error {
	if strings.TrimSpace(processID) == "" {
		return errors.New("processId is required")
	}

	workspaceID, ok := s.workspaceIDByProcess(processID)
	if !ok {
		return appRuntime.ErrRuntimeNotConfigured
	}

	return s.runtimes.Call(ctx, workspaceID, "command/exec/terminate", map[string]any{
		"processId": processID,
	}, nil)
}

func (s *Service) ReadFile(ctx context.Context, workspaceID string, path string) (FileResult, error) {
	resolvedPath, err := s.resolveWorkspacePath(workspaceID, path)
	if err != nil {
		return FileResult{}, err
	}

	var response struct {
		DataBase64 string `json:"dataBase64"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "fs/readFile", map[string]any{
		"path": resolvedPath,
	}, &response); err != nil {
		return FileResult{}, err
	}

	content, err := base64.StdEncoding.DecodeString(response.DataBase64)
	if err != nil {
		return FileResult{}, err
	}

	return FileResult{
		Path:    resolvedPath,
		Content: string(content),
	}, nil
}

func (s *Service) WriteFile(ctx context.Context, workspaceID string, path string, content string) (FileResult, error) {
	resolvedPath, err := s.resolveWorkspacePath(workspaceID, path)
	if err != nil {
		return FileResult{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "fs/writeFile", map[string]any{
		"dataBase64": base64.StdEncoding.EncodeToString([]byte(content)),
		"path":       resolvedPath,
	}, nil); err != nil {
		return FileResult{}, err
	}

	return FileResult{
		Path:    resolvedPath,
		Content: content,
	}, nil
}

func (s *Service) ReadDirectory(ctx context.Context, workspaceID string, path string) (DirectoryResult, error) {
	resolvedPath, err := s.resolveWorkspacePath(workspaceID, path)
	if err != nil {
		return DirectoryResult{}, err
	}

	var response struct {
		Entries []DirectoryEntry `json:"entries"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "fs/readDirectory", map[string]any{
		"path": resolvedPath,
	}, &response); err != nil {
		return DirectoryResult{}, err
	}

	return DirectoryResult{
		Path:    resolvedPath,
		Entries: response.Entries,
	}, nil
}

func (s *Service) GetMetadata(ctx context.Context, workspaceID string, path string) (MetadataResult, error) {
	resolvedPath, err := s.resolveWorkspacePath(workspaceID, path)
	if err != nil {
		return MetadataResult{}, err
	}

	var response struct {
		CreatedAtMs  int64 `json:"createdAtMs"`
		IsDirectory  bool  `json:"isDirectory"`
		IsFile       bool  `json:"isFile"`
		ModifiedAtMs int64 `json:"modifiedAtMs"`
	}

	if err := s.runtimes.Call(ctx, workspaceID, "fs/getMetadata", map[string]any{
		"path": resolvedPath,
	}, &response); err != nil {
		return MetadataResult{}, err
	}

	return MetadataResult{
		Path:         resolvedPath,
		CreatedAtMs:  response.CreatedAtMs,
		ModifiedAtMs: response.ModifiedAtMs,
		IsDirectory:  response.IsDirectory,
		IsFile:       response.IsFile,
	}, nil
}

func (s *Service) CreateDirectory(ctx context.Context, workspaceID string, path string, recursive bool) (PathResult, error) {
	resolvedPath, err := s.resolveWorkspacePath(workspaceID, path)
	if err != nil {
		return PathResult{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "fs/createDirectory", map[string]any{
		"path":      resolvedPath,
		"recursive": recursive,
	}, nil); err != nil {
		return PathResult{}, err
	}

	return PathResult{
		Path:   resolvedPath,
		Status: "created",
	}, nil
}

func (s *Service) RemovePath(ctx context.Context, workspaceID string, path string, recursive bool, force bool) (PathResult, error) {
	resolvedPath, err := s.resolveWorkspacePath(workspaceID, path)
	if err != nil {
		return PathResult{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "fs/remove", map[string]any{
		"force":     force,
		"path":      resolvedPath,
		"recursive": recursive,
	}, nil); err != nil {
		return PathResult{}, err
	}

	return PathResult{
		Path:   resolvedPath,
		Status: "removed",
	}, nil
}

func (s *Service) CopyPath(ctx context.Context, workspaceID string, sourcePath string, destinationPath string, recursive bool) (CopyResult, error) {
	resolvedSourcePath, err := s.resolveWorkspacePath(workspaceID, sourcePath)
	if err != nil {
		return CopyResult{}, err
	}

	resolvedDestinationPath, err := s.resolveWorkspacePath(workspaceID, destinationPath)
	if err != nil {
		return CopyResult{}, err
	}

	if err := s.runtimes.Call(ctx, workspaceID, "fs/copy", map[string]any{
		"destinationPath": resolvedDestinationPath,
		"recursive":       recursive,
		"sourcePath":      resolvedSourcePath,
	}, nil); err != nil {
		return CopyResult{}, err
	}

	return CopyResult{
		SourcePath:      resolvedSourcePath,
		DestinationPath: resolvedDestinationPath,
		Status:          "copied",
	}, nil
}

func (s *Service) resolveWorkspacePath(workspaceID string, input string) (string, error) {
	if strings.TrimSpace(input) == "" {
		return "", errors.New("path is required")
	}

	root := s.runtimes.RootPath(workspaceID)
	if root == "" {
		return "", appRuntime.ErrRuntimeNotConfigured
	}

	path := input
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}

	path = filepath.Clean(path)
	relativePath, err := filepath.Rel(root, path)
	if err != nil {
		return "", err
	}

	if relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes workspace root")
	}

	return path, nil
}

func (s *Service) workspaceIDByProcess(processID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	workspaceID, ok := s.processes[processID]
	return workspaceID, ok
}

func shellCommandArgs(command string) []string {
	if stdruntime.GOOS == "windows" {
		return []string{"cmd.exe", "/c", command}
	}

	return []string{"sh", "-lc", command}
}

func commandSandboxPolicy() map[string]any {
	return map[string]any{
		"type": "dangerFullAccess",
	}
}
