package execfs

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	appconfig "codex-server/backend/internal/config"
	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

type Service struct {
	runtimes            *appRuntime.Manager
	events              *events.Hub
	store               *store.MemoryStore
	mu                  sync.RWMutex
	processes           map[string]string
	shellTrackers       map[string]*shellIntegrationTracker
	sessionsByWorkspace map[string]map[string]store.CommandSessionSnapshot
}

var ErrCommandSessionNotFound = errors.New("command session not found")
var ErrCommandStartModeInvalid = errors.New("command start mode is invalid")
var ErrCommandStartCommandRequired = errors.New("command is required")

const shellCommandActivationRetryDelay = 120 * time.Millisecond
const shellCommandActivationRetryLimit = 10

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

type StartCommandInput struct {
	Command string
	Mode    string
}

type shellIntegrationTracker struct {
	tail string
}

func NewService(runtimeManager *appRuntime.Manager, eventHub *events.Hub, dataStore *store.MemoryStore) *Service {
	service := &Service{
		runtimes:            runtimeManager,
		events:              eventHub,
		store:               dataStore,
		processes:           make(map[string]string),
		shellTrackers:       make(map[string]*shellIntegrationTracker),
		sessionsByWorkspace: make(map[string]map[string]store.CommandSessionSnapshot),
	}

	service.hydrateCommandSessions()

	if eventHub != nil {
		eventsCh, _ := eventHub.SubscribeAll()
		go service.consumeEvents(eventsCh)
	}

	return service
}

func (s *Service) StartCommand(ctx context.Context, workspaceID string, input StartCommandInput) (store.CommandSession, error) {
	spec, err := resolveCommandStartSpec(input)
	if err != nil {
		return store.CommandSession{}, err
	}
	rootPath := s.runtimes.RootPath(workspaceID)

	processID := store.NewID("proc")
	session := store.CommandSession{
		ID:          processID,
		WorkspaceID: workspaceID,
		Command:     spec.displayCommand,
		Mode:        spec.mode,
		ShellPath:   spec.shellPath,
		InitialCwd:  rootPath,
		CurrentCwd:  rootPath,
		ShellState:  initialShellStateForMode(spec.mode),
		Status:      "running",
		CreatedAt:   time.Now().UTC(),
	}

	s.mu.Lock()
	s.processes[processID] = workspaceID
	s.shellTrackers[processID] = &shellIntegrationTracker{}
	s.upsertCommandSessionSnapshotLocked(store.CommandSessionSnapshot{
		CommandSession: session,
		CombinedOutput: "",
		Stdout:         "",
		Stderr:         "",
		UpdatedAt:      session.CreatedAt,
	})
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

		err := s.runtimes.Call(
			context.Background(),
			workspaceID,
			"command/exec",
			buildCommandExecParams(spec, rootPath, processID, s.commandSandboxPolicy()),
			&response,
		)
		if err != nil {
			s.mu.Lock()
			delete(s.processes, processID)
			delete(s.shellTrackers, processID)
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
		delete(s.shellTrackers, processID)
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

	return s.callCommandProcessWithRetry(ctx, workspaceID, processID, "command/exec/write", map[string]any{
		"deltaBase64": encoded,
		"processId":   processID,
	}, nil)
}

func (s *Service) ListCommandSessions(workspaceID string) []store.CommandSessionSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	workspaceSessions := s.sessionsByWorkspace[workspaceID]
	if len(workspaceSessions) == 0 {
		return []store.CommandSessionSnapshot{}
	}

	items := make([]store.CommandSessionSnapshot, 0, len(workspaceSessions))
	for _, session := range workspaceSessions {
		items = append(items, session)
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items
}

func (s *Service) CloseCommandSession(ctx context.Context, workspaceID string, processID string) error {
	if strings.TrimSpace(workspaceID) == "" {
		return errors.New("workspaceId is required")
	}
	if strings.TrimSpace(processID) == "" {
		return errors.New("processId is required")
	}

	s.mu.RLock()
	workspaceSessions := s.sessionsByWorkspace[workspaceID]
	session, ok := workspaceSessions[processID]
	activeWorkspaceID, active := s.processes[processID]
	s.mu.RUnlock()

	if !ok {
		return ErrCommandSessionNotFound
	}

	if active && activeWorkspaceID == workspaceID && isCommandSessionActive(session.Status) {
		if err := s.callCommandProcessWithRetry(ctx, workspaceID, processID, "command/exec/terminate", map[string]any{
			"processId": processID,
		}, nil); err != nil && !errors.Is(err, appRuntime.ErrRuntimeNotConfigured) {
			return err
		}
	}

	s.mu.Lock()
	s.removeCommandSessionSnapshotLocked(workspaceID, processID)
	s.mu.Unlock()

	s.publishCommandSessionRemoved(workspaceID, processID)
	return nil
}

func (s *Service) SetCommandSessionPinned(
	workspaceID string,
	processID string,
	pinned bool,
) error {
	if strings.TrimSpace(workspaceID) == "" {
		return errors.New("workspaceId is required")
	}
	if strings.TrimSpace(processID) == "" {
		return errors.New("processId is required")
	}

	s.mu.Lock()
	workspaceSessions := s.sessionsByWorkspace[workspaceID]
	session, ok := workspaceSessions[processID]
	if !ok {
		s.mu.Unlock()
		return ErrCommandSessionNotFound
	}

	session.Pinned = pinned
	session.UpdatedAt = time.Now().UTC()
	workspaceSessions[processID] = session
	if s.store != nil {
		s.store.UpsertCommandSessionSnapshot(session)
	}
	s.mu.Unlock()

	s.publishCommandSessionPinned(workspaceID, processID, pinned)
	return nil
}

func (s *Service) SetCommandSessionArchived(
	workspaceID string,
	processID string,
	archived bool,
) error {
	if strings.TrimSpace(workspaceID) == "" {
		return errors.New("workspaceId is required")
	}
	if strings.TrimSpace(processID) == "" {
		return errors.New("processId is required")
	}

	s.mu.Lock()
	workspaceSessions := s.sessionsByWorkspace[workspaceID]
	session, ok := workspaceSessions[processID]
	if !ok {
		s.mu.Unlock()
		return ErrCommandSessionNotFound
	}

	session.Archived = archived
	session.UpdatedAt = time.Now().UTC()
	workspaceSessions[processID] = session
	if s.store != nil {
		s.store.UpsertCommandSessionSnapshot(session)
	}
	s.mu.Unlock()

	s.publishCommandSessionArchived(workspaceID, processID, archived)
	return nil
}

func (s *Service) ClearCompletedCommandSessions(workspaceID string) []string {
	s.mu.Lock()
	workspaceSessions := s.sessionsByWorkspace[workspaceID]
	if len(workspaceSessions) == 0 {
		s.mu.Unlock()
		return []string{}
	}

	removedProcessIDs := make([]string, 0)
	for processID, session := range workspaceSessions {
		if isCommandSessionActive(session.Status) {
			continue
		}

		delete(s.processes, processID)
		delete(s.shellTrackers, processID)
		delete(workspaceSessions, processID)
		removedProcessIDs = append(removedProcessIDs, processID)
	}
	if len(workspaceSessions) == 0 {
		delete(s.sessionsByWorkspace, workspaceID)
	}
	s.mu.Unlock()

	if s.store != nil && len(removedProcessIDs) > 0 {
		s.store.ClearCompletedCommandSessions(workspaceID)
	}

	for _, processID := range removedProcessIDs {
		s.publishCommandSessionRemoved(workspaceID, processID)
	}

	return removedProcessIDs
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

	return s.callCommandProcessWithRetry(ctx, workspaceID, processID, "command/exec/resize", map[string]any{
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

	return s.callCommandProcessWithRetry(ctx, workspaceID, processID, "command/exec/terminate", map[string]any{
		"processId": processID,
	}, nil)
}

func (s *Service) callCommandProcessWithRetry(
	ctx context.Context,
	workspaceID string,
	processID string,
	method string,
	params any,
	result any,
) error {
	var lastErr error

	for attempt := 0; attempt < shellCommandActivationRetryLimit; attempt++ {
		err := s.runtimes.Call(ctx, workspaceID, method, params, result)
		if err == nil {
			return nil
		}

		lastErr = err
		if !s.shouldRetryCommandProcessCall(processID, err) {
			return err
		}

		timer := time.NewTimer(shellCommandActivationRetryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}

	return lastErr
}

func (s *Service) shouldRetryCommandProcessCall(processID string, err error) bool {
	if !isTransientInactiveCommandProcessError(err) {
		return false
	}

	session, ok := s.commandSessionByProcess(processID)
	if !ok {
		return false
	}

	if !strings.EqualFold(strings.TrimSpace(session.Mode), "shell") {
		return false
	}

	switch strings.ToLower(strings.TrimSpace(session.ShellState)) {
	case "", "starting":
		return true
	default:
		return false
	}
}

func (s *Service) commandSessionByProcess(processID string) (store.CommandSessionSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	workspaceID, ok := s.processes[processID]
	if !ok {
		return store.CommandSessionSnapshot{}, false
	}

	session, ok := s.sessionsByWorkspace[workspaceID][processID]
	return session, ok
}

func isTransientInactiveCommandProcessError(err error) bool {
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	if message == "" {
		return false
	}

	return strings.Contains(message, "no active command/exec") ||
		strings.Contains(message, "is no longer running")
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

func (s *Service) consumeEvents(eventsCh <-chan store.EventEnvelope) {
	for event := range eventsCh {
		switch event.Method {
		case "command/exec/outputDelta":
			s.applyCommandOutputDelta(event)
		case "command/exec/completed":
			s.applyCommandCompleted(event)
		}
	}
}

func (s *Service) applyCommandOutputDelta(event store.EventEnvelope) {
	payload, ok := event.Payload.(map[string]any)
	if !ok {
		return
	}

	processID, ok := payload["processId"]
	if !ok {
		return
	}

	deltaBase64, ok := payload["deltaBase64"]
	if !ok {
		return
	}

	stream, ok := payload["stream"]
	if !ok {
		return
	}

	delta, err := base64.StdEncoding.DecodeString(strings.TrimSpace(asString(deltaBase64)))
	if err != nil {
		return
	}

	s.mu.Lock()
	processIDString := asString(processID)
	workspaceSessions := s.sessionsByWorkspace[event.WorkspaceID]
	if workspaceSessions == nil {
		s.mu.Unlock()
		return
	}

	current, exists := workspaceSessions[processIDString]
	if !exists {
		s.mu.Unlock()
		return
	}

	decodedDelta := string(delta)
	switch asString(stream) {
	case "stderr":
		current.Stderr = trimOutput(current.Stderr + decodedDelta)
	default:
		current.Stdout = trimOutput(current.Stdout + decodedDelta)
	}
	current.CombinedOutput = trimOutput(current.CombinedOutput + decodedDelta)
	eventsToPublish := s.applyShellIntegrationDeltaLocked(event.WorkspaceID, processIDString, decodedDelta, &current)
	current.UpdatedAt = event.TS
	workspaceSessions[current.ID] = current
	s.mu.Unlock()

	s.publishShellIntegrationEvents(eventsToPublish)
}

func (s *Service) applyCommandCompleted(event store.EventEnvelope) {
	payload, ok := event.Payload.(map[string]any)
	if !ok {
		return
	}

	processID := asString(payload["processId"])
	if processID == "" {
		return
	}

	s.mu.Lock()
	workspaceSessions := s.sessionsByWorkspace[event.WorkspaceID]
	if workspaceSessions == nil {
		s.mu.Unlock()
		return
	}

	current, exists := workspaceSessions[processID]
	if !exists {
		s.mu.Unlock()
		return
	}

	stdout := asString(payload["stdout"])
	stderr := asString(payload["stderr"])
	errorMessage := asString(payload["error"])
	stdoutCompletionDelta := completionOutputDelta(current.Stdout, stdout)
	stderrCompletionDelta := completionOutputDelta(current.Stderr, stderr)
	if stdoutCompletionDelta != "" {
		current.Stdout = trimOutput(current.Stdout + stdoutCompletionDelta)
	}
	if stderrCompletionDelta != "" {
		current.Stderr = trimOutput(current.Stderr + stderrCompletionDelta)
	}
	completionDelta := stdoutCompletionDelta + stderrCompletionDelta
	current.CombinedOutput = trimOutput(current.CombinedOutput + completionDelta)
	eventsToPublish := s.applyShellIntegrationDeltaLocked(
		event.WorkspaceID,
		processID,
		completionDelta,
		&current,
	)
	current.Status = commandCompletionStatus(payload, errorMessage)
	current.Error = errorMessage
	if exitCode, ok := asInt(payload["exitCode"]); ok {
		current.ExitCode = &exitCode
	}
	current.UpdatedAt = event.TS
	workspaceSessions[processID] = current
	if s.store != nil {
		s.store.UpsertCommandSessionSnapshot(current)
	}

	delete(s.processes, processID)
	delete(s.shellTrackers, processID)
	s.mu.Unlock()

	s.publishShellIntegrationEvents(eventsToPublish)
}

func (s *Service) upsertCommandSessionSnapshotLocked(session store.CommandSessionSnapshot) {
	workspaceSessions := s.sessionsByWorkspace[session.WorkspaceID]
	if workspaceSessions == nil {
		workspaceSessions = make(map[string]store.CommandSessionSnapshot)
		s.sessionsByWorkspace[session.WorkspaceID] = workspaceSessions
	}

	workspaceSessions[session.ID] = session

	if s.store != nil {
		s.store.UpsertCommandSessionSnapshot(session)
	}
}

func (s *Service) removeCommandSessionSnapshotLocked(workspaceID string, processID string) {
	delete(s.processes, processID)
	delete(s.shellTrackers, processID)

	workspaceSessions := s.sessionsByWorkspace[workspaceID]
	if workspaceSessions == nil {
		return
	}

	delete(workspaceSessions, processID)
	if len(workspaceSessions) == 0 {
		delete(s.sessionsByWorkspace, workspaceID)
	}

	if s.store != nil {
		s.store.DeleteCommandSession(workspaceID, processID)
	}
}

func (s *Service) publishCommandSessionRemoved(workspaceID string, processID string) {
	if s.events == nil {
		return
	}

	s.events.Publish(store.EventEnvelope{
		WorkspaceID: workspaceID,
		Method:      "command/exec/removed",
		Payload: map[string]any{
			"processId": processID,
		},
		TS: time.Now().UTC(),
	})
}

func (s *Service) publishCommandSessionPinned(workspaceID string, processID string, pinned bool) {
	if s.events == nil {
		return
	}

	s.events.Publish(store.EventEnvelope{
		WorkspaceID: workspaceID,
		Method:      "command/exec/pinned",
		Payload: map[string]any{
			"pinned":    pinned,
			"processId": processID,
		},
		TS: time.Now().UTC(),
	})
}

func (s *Service) publishCommandSessionArchived(
	workspaceID string,
	processID string,
	archived bool,
) {
	if s.events == nil {
		return
	}

	s.events.Publish(store.EventEnvelope{
		WorkspaceID: workspaceID,
		Method:      "command/exec/archived",
		Payload: map[string]any{
			"archived":  archived,
			"processId": processID,
		},
		TS: time.Now().UTC(),
	})
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func asInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}

func commandCompletionStatus(payload map[string]any, errorMessage string) string {
	if status := asString(payload["status"]); status != "" {
		return status
	}
	if errorMessage != "" {
		return "failed"
	}
	return "completed"
}

func isCommandSessionActive(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "running", "starting", "processing":
		return true
	default:
		return false
	}
}

func (s *Service) hydrateCommandSessions() {
	if s.store == nil {
		return
	}

	s.store.PruneExpiredCommandSessions(time.Now().UTC())
	s.store.MarkActiveCommandSessionsFailed("backend restarted")

	for _, workspace := range s.store.ListWorkspaces() {
		sessions := s.store.ListCommandSessions(workspace.ID)
		if len(sessions) == 0 {
			continue
		}

		workspaceSessions := make(map[string]store.CommandSessionSnapshot, len(sessions))
		for _, session := range sessions {
			workspaceSessions[session.ID] = session
		}
		s.sessionsByWorkspace[workspace.ID] = workspaceSessions
	}
}

func trimOutput(value string, limit ...int) string {
	maxLength := 256000
	if len(limit) > 0 && limit[0] > 0 {
		maxLength = limit[0]
	}
	if len(value) <= maxLength {
		return value
	}
	return value[len(value)-maxLength:]
}

func completionOutputDelta(current string, final string) string {
	if final == "" {
		return ""
	}
	if current == "" {
		return final
	}
	if strings.HasPrefix(final, current) {
		return final[len(current):]
	}
	if strings.HasSuffix(current, final) || strings.HasSuffix(final, current) {
		return ""
	}
	if embeddedIndex := strings.LastIndex(final, current); embeddedIndex >= 0 {
		return final[embeddedIndex+len(current):]
	}

	maxOverlap := len(current)
	if len(final) < maxOverlap {
		maxOverlap = len(final)
	}

	for overlap := maxOverlap; overlap > 0; overlap-- {
		if strings.HasSuffix(current, final[:overlap]) {
			return final[overlap:]
		}
	}

	return final
}

func shellCommandArgs(command string) []string {
	if stdruntime.GOOS == "windows" {
		return []string{"cmd.exe", "/c", command}
	}

	return []string{"sh", "-lc", command}
}

type commandStartSpec struct {
	commandArgs    []string
	displayCommand string
	mode           string
	shellPath      string
}

func resolveCommandStartSpec(input StartCommandInput) (commandStartSpec, error) {
	switch normalizeCommandStartMode(input.Mode) {
	case "shell":
		return defaultShellStartSpec(), nil
	case "command":
		command := strings.TrimSpace(input.Command)
		if command == "" {
			return commandStartSpec{}, ErrCommandStartCommandRequired
		}
		return commandStartSpec{
			commandArgs:    shellCommandArgs(command),
			displayCommand: command,
			mode:           "command",
			shellPath:      wrappedCommandShellPath(),
		}, nil
	default:
		return commandStartSpec{}, ErrCommandStartModeInvalid
	}
}

func normalizeCommandStartMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "command", "oneshot", "one-shot":
		return "command"
	case "shell":
		return "shell"
	default:
		return "invalid"
	}
}

func defaultShellStartSpec() commandStartSpec {
	shellPath := defaultShellPath()
	displayName := filepath.Base(shellPath)
	if displayName == "." || displayName == string(filepath.Separator) || displayName == "" {
		displayName = shellPath
	}
	commandArgs := integratedShellCommandArgs(shellPath)

	return commandStartSpec{
		commandArgs:    commandArgs,
		displayCommand: displayName,
		mode:           "shell",
		shellPath:      shellPath,
	}
}

func defaultShellPath() string {
	if stdruntime.GOOS == "windows" {
		return preferredWindowsShellPath()
	}

	for _, candidate := range []string{
		strings.TrimSpace(os.Getenv("SHELL")),
		"/bin/bash",
		"/usr/bin/bash",
		"/bin/zsh",
		"/bin/sh",
		"sh",
	} {
		if candidate == "" {
			continue
		}
		if filepath.IsAbs(candidate) {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				return candidate
			}
			continue
		}
		if resolved, err := exec.LookPath(candidate); err == nil && strings.TrimSpace(resolved) != "" {
			return resolved
		}
	}

	return "sh"
}

func preferredWindowsShellPath() string {
	return resolvePreferredWindowsShellPath(exec.LookPath, strings.TrimSpace(os.Getenv("ComSpec")))
}

func resolvePreferredWindowsShellPath(
	lookPath func(string) (string, error),
	comSpec string,
) string {
	for _, candidate := range []string{"pwsh.exe", "pwsh", "powershell.exe", "powershell"} {
		if resolved, err := lookPath(candidate); err == nil && strings.TrimSpace(resolved) != "" {
			return resolved
		}
	}

	if comSpec != "" {
		return comSpec
	}

	if resolved, err := lookPath("cmd.exe"); err == nil && strings.TrimSpace(resolved) != "" {
		return resolved
	}

	return "cmd.exe"
}

func wrappedCommandShellPath() string {
	if stdruntime.GOOS == "windows" {
		return "cmd.exe"
	}

	return "sh"
}

func integratedShellCommandArgs(shellPath string) []string {
	if args, err := buildIntegratedShellCommandArgs(shellPath); err == nil && len(args) > 0 {
		return args
	}

	return []string{shellPath}
}

func buildIntegratedShellCommandArgs(shellPath string) ([]string, error) {
	baseName := strings.ToLower(filepath.Base(shellPath))

	switch {
	case strings.Contains(baseName, "bash"):
		rcPath, err := ensureShellIntegrationAsset("bash-integration.sh", bashShellIntegrationScript())
		if err != nil {
			return nil, err
		}
		return []string{shellPath, "--rcfile", rcPath, "-i"}, nil
	case strings.Contains(baseName, "zsh"):
		zshHomeDir, err := ensureZshIntegrationHome()
		if err != nil {
			return nil, err
		}
		return []string{
			"sh",
			"-lc",
			fmt.Sprintf(
				"ZDOTDIR=%s exec %s -i",
				unixShellQuote(zshHomeDir),
				unixShellQuote(shellPath),
			),
		}, nil
	case strings.Contains(baseName, "pwsh"), strings.Contains(baseName, "powershell"):
		scriptPath, err := ensureShellIntegrationAsset(
			"powershell-integration.ps1",
			powerShellIntegrationScript(),
		)
		if err != nil {
			return nil, err
		}
		return []string{
			shellPath,
			"-NoLogo",
			"-NoExit",
			"-NoProfile",
			"-Command",
			fmt.Sprintf(". '%s'", strings.ReplaceAll(scriptPath, "'", "''")),
		}, nil
	case strings.Contains(baseName, "cmd"):
		scriptPath, err := ensureShellIntegrationAsset("cmd-integration.cmd", cmdShellIntegrationScript())
		if err != nil {
			return nil, err
		}
		return []string{shellPath, "/Q", "/K", scriptPath}, nil
	default:
		return nil, errors.New("shell integration wrapper is not available for this shell")
	}
}

func ensureShellIntegrationAsset(fileName string, content string) (string, error) {
	assetDir := filepath.Join(os.TempDir(), "codex-server", "shell-integration")
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		return "", err
	}

	assetPath := filepath.Join(assetDir, fileName)
	existingContent, err := os.ReadFile(assetPath)
	switch {
	case err == nil && string(existingContent) == content:
		return assetPath, nil
	case err != nil && !errors.Is(err, os.ErrNotExist):
		return "", err
	}

	if err := os.WriteFile(assetPath, []byte(content), 0o644); err != nil {
		return "", err
	}

	return assetPath, nil
}

func ensureZshIntegrationHome() (string, error) {
	assetDir := filepath.Join(os.TempDir(), "codex-server", "shell-integration", "zsh")
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		return "", err
	}

	rcPath := filepath.Join(assetDir, ".zshrc")
	content := zshShellIntegrationScript()
	existingContent, err := os.ReadFile(rcPath)
	switch {
	case err == nil && string(existingContent) == content:
		return assetDir, nil
	case err != nil && !errors.Is(err, os.ErrNotExist):
		return "", err
	}

	if err := os.WriteFile(rcPath, []byte(content), 0o644); err != nil {
		return "", err
	}

	return assetDir, nil
}

func bashShellIntegrationScript() string {
	return `# codex-server shell integration for bash
if [ -f "$HOME/.bashrc" ]; then
  . "$HOME/.bashrc"
fi

__codex_server_prompt_hook() {
  local exit_code="$?"
  printf '\033]133;D;%s\007' "$exit_code"
  printf '\033]133;A\007'
  printf '\033]9;9;%s\007' "$PWD"
}

case "${PROMPT_COMMAND:-}" in
  *__codex_server_prompt_hook*) ;;
  "")
    PROMPT_COMMAND="__codex_server_prompt_hook"
    ;;
  *)
    PROMPT_COMMAND="__codex_server_prompt_hook;${PROMPT_COMMAND}"
    ;;
esac

case "${PS0-}" in
  *$'\033]133;C\007'*) ;;
  *)
    PS0=$'\033]133;C\007'"${PS0-}"
    ;;
esac
`
}

func zshShellIntegrationScript() string {
	return `# codex-server shell integration for zsh
if [ -f "$HOME/.zshrc" ]; then
  . "$HOME/.zshrc"
fi

autoload -Uz add-zsh-hook

__codex_server_precmd() {
  local exit_code="$?"
  printf '\033]133;D;%s\007' "$exit_code"
  printf '\033]133;A\007'
  printf '\033]9;9;%s\007' "$PWD"
}

__codex_server_preexec() {
  printf '\033]133;C\007'
}

add-zsh-hook precmd __codex_server_precmd
add-zsh-hook preexec __codex_server_preexec
`
}

func powerShellIntegrationScript() string {
	return `$script:__codexServerOriginalPrompt = $null
$existingPrompt = Get-Command prompt -CommandType Function -ErrorAction SilentlyContinue
if ($existingPrompt) {
  $script:__codexServerOriginalPrompt = $existingPrompt.ScriptBlock
}

function global:__CodexServerEmitPromptReady {
  $esc = [char]27
  $bel = [char]7
  $exitCode =
    if ($global:LASTEXITCODE -is [int]) {
      $global:LASTEXITCODE
    } elseif ($?) {
      0
    } else {
      1
    }

  [Console]::Write(("{0}]133;D;{1}{2}" -f $esc, $exitCode, $bel))
  [Console]::Write(("{0}]133;A{1}" -f $esc, $bel))
  [Console]::Write(("{0}]9;9;{1}{2}" -f $esc, (Get-Location).Path, $bel))
}

function global:prompt {
  __CodexServerEmitPromptReady

  if ($script:__codexServerOriginalPrompt) {
    & $script:__codexServerOriginalPrompt
  } else {
    "PS $((Get-Location).Path)$('>' * ($nestedPromptLevel + 1)) "
  }
}
`
}

func cmdShellIntegrationScript() string {
	return `@echo off
for /F "delims=" %%A in ('"prompt $E & for %%B in (1) do rem"') do set "ESC=%%A"
prompt %ESC%]133;A%ESC%\%ESC%]9;9;$P%ESC%\$P$G
`
}

func unixShellQuote(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `'"'"'`) + `'`
}

type shellIntegrationEvent struct {
	exitCode    *int
	kind        string
	processID   string
	shellState  string
	value       string
	workspaceID string
}

func initialShellStateForMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "shell") {
		return "starting"
	}

	return ""
}

func buildCommandExecParams(
	spec commandStartSpec,
	rootPath string,
	processID string,
	sandboxPolicy map[string]any,
) map[string]any {
	params := map[string]any{
		"command":            spec.commandArgs,
		"cwd":                rootPath,
		"processId":          processID,
		"sandboxPolicy":      sandboxPolicy,
		"streamStdin":        true,
		"streamStdoutStderr": true,
		"tty":                true,
	}

	if spec.mode == "shell" {
		params["disableTimeout"] = true
	}

	return params
}

func (s *Service) applyShellIntegrationDeltaLocked(
	workspaceID string,
	processID string,
	delta string,
	session *store.CommandSessionSnapshot,
) []shellIntegrationEvent {
	if strings.TrimSpace(delta) == "" || session == nil {
		return nil
	}

	tracker := s.shellTrackers[processID]
	if tracker == nil {
		tracker = &shellIntegrationTracker{}
		s.shellTrackers[processID] = tracker
	}

	buffer := tracker.tail + delta
	events := make([]shellIntegrationEvent, 0)
	searchStart := 0
	tail := ""

	for searchStart < len(buffer) {
		oscStart := strings.Index(buffer[searchStart:], "\x1b]")
		if oscStart < 0 {
			break
		}

		oscStart += searchStart
		oscContentStart := oscStart + 2
		oscEnd, terminatorLength := findOscTerminator(buffer, oscContentStart)
		if oscEnd < 0 {
			tail = buffer[oscStart:]
			break
		}

		s.parseOscSequenceLocked(
			buffer[oscContentStart:oscEnd],
			workspaceID,
			processID,
			session,
			&events,
		)
		searchStart = oscEnd + terminatorLength
	}

	if len(tail) > 512 {
		tail = tail[len(tail)-512:]
	}
	tracker.tail = tail

	return events
}

func findOscTerminator(buffer string, start int) (int, int) {
	belIndex := strings.Index(buffer[start:], "\x07")
	stIndex := strings.Index(buffer[start:], "\x1b\\")

	switch {
	case belIndex < 0 && stIndex < 0:
		return -1, 0
	case belIndex >= 0 && (stIndex < 0 || belIndex < stIndex):
		return start + belIndex, 1
	default:
		return start + stIndex, 2
	}
}

func (s *Service) parseOscSequenceLocked(
	content string,
	workspaceID string,
	processID string,
	session *store.CommandSessionSnapshot,
	events *[]shellIntegrationEvent,
) {
	switch {
	case strings.HasPrefix(content, "133;"):
		s.applyOsc133SequenceLocked(content, workspaceID, processID, session, events)
	case strings.HasPrefix(content, "7;"):
		s.applyShellCwdUpdateLocked(
			workspaceID,
			processID,
			session,
			extractTerminalCurrentCwd("\x1b]"+content+"\x07", session.CurrentCwd),
			events,
		)
	case strings.HasPrefix(content, "1337;CurrentDir="):
		s.applyShellCwdUpdateLocked(
			workspaceID,
			processID,
			session,
			normalizeShellCwd(strings.TrimPrefix(content, "1337;CurrentDir=")),
			events,
		)
	case strings.HasPrefix(content, "9;9;"):
		s.applyShellCwdUpdateLocked(
			workspaceID,
			processID,
			session,
			normalizeShellCwd(strings.TrimPrefix(content, "9;9;")),
			events,
		)
	}
}

func (s *Service) applyOsc133SequenceLocked(
	content string,
	workspaceID string,
	processID string,
	session *store.CommandSessionSnapshot,
	events *[]shellIntegrationEvent,
) {
	parts := strings.Split(content, ";")
	if len(parts) < 2 {
		return
	}

	switch strings.TrimSpace(parts[1]) {
	case "A":
		session.ShellState = "prompt"
		*events = append(*events, shellIntegrationEvent{
			kind:        "prompt",
			processID:   processID,
			shellState:  session.ShellState,
			workspaceID: workspaceID,
		})
	case "C":
		session.ShellState = "running"
		*events = append(*events, shellIntegrationEvent{
			kind:        "commandStarted",
			processID:   processID,
			shellState:  session.ShellState,
			workspaceID: workspaceID,
		})
	case "D":
		session.ShellState = "prompt"
		var exitCodePtr *int
		if len(parts) >= 3 {
			if parsedExitCode, err := strconv.Atoi(strings.TrimSpace(parts[2])); err == nil {
				exitCode := parsedExitCode
				exitCodePtr = &exitCode
			}
		}
		session.LastExitCode = cloneIntPointer(exitCodePtr)
		*events = append(*events, shellIntegrationEvent{
			exitCode:    cloneIntPointer(exitCodePtr),
			kind:        "commandFinished",
			processID:   processID,
			shellState:  session.ShellState,
			workspaceID: workspaceID,
		})
	}
}

func (s *Service) applyShellCwdUpdateLocked(
	workspaceID string,
	processID string,
	session *store.CommandSessionSnapshot,
	nextCwd string,
	events *[]shellIntegrationEvent,
) {
	if strings.TrimSpace(nextCwd) == "" || session.CurrentCwd == nextCwd {
		return
	}

	session.CurrentCwd = nextCwd
	*events = append(*events, shellIntegrationEvent{
		kind:        "cwdChanged",
		processID:   processID,
		value:       nextCwd,
		workspaceID: workspaceID,
	})
}

func (s *Service) publishShellIntegrationEvents(events []shellIntegrationEvent) {
	if s.events == nil || len(events) == 0 {
		return
	}

	now := time.Now().UTC()
	for _, event := range events {
		payload := map[string]any{
			"processId": event.processID,
		}
		method := ""

		switch event.kind {
		case "prompt":
			method = "command/exec/prompt"
			payload["shellState"] = event.shellState
		case "commandStarted":
			method = "command/exec/commandStarted"
			payload["shellState"] = event.shellState
		case "commandFinished":
			method = "command/exec/commandFinished"
			payload["shellState"] = event.shellState
			if event.exitCode != nil {
				payload["exitCode"] = *event.exitCode
			}
		case "cwdChanged":
			method = "command/exec/cwdChanged"
			payload["currentCwd"] = event.value
		default:
			continue
		}

		s.events.Publish(store.EventEnvelope{
			WorkspaceID: event.workspaceID,
			Method:      method,
			Payload:     payload,
			TS:          now,
		})
	}
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func extractTerminalCurrentCwd(output string, fallback string) string {
	const marker = "\x1b]7;"

	index := strings.LastIndex(output, marker)
	if index < 0 {
		return fallback
	}

	payload := output[index+len(marker):]
	end := strings.Index(payload, "\x07")
	if stIndex := strings.Index(payload, "\x1b\\"); stIndex >= 0 && (end < 0 || stIndex < end) {
		end = stIndex
	}
	if end < 0 {
		return fallback
	}

	cwd, ok := parseTerminalCwdPayload(payload[:end])
	if !ok {
		return fallback
	}

	return cwd
}

func parseTerminalCwdPayload(value string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "file" {
		return "", false
	}

	decodedPath, err := url.PathUnescape(parsed.Path)
	if err != nil || strings.TrimSpace(decodedPath) == "" {
		return "", false
	}

	if stdruntime.GOOS == "windows" {
		if parsed.Host != "" && parsed.Host != "localhost" {
			uncPath := filepath.Clean(`\\` + parsed.Host + filepath.FromSlash(decodedPath))
			return uncPath, true
		}

		normalized := filepath.FromSlash(decodedPath)
		if len(normalized) >= 3 && normalized[0] == filepath.Separator && normalized[2] == ':' {
			normalized = normalized[1:]
		}
		return filepath.Clean(normalized), true
	}

	return filepath.Clean(filepath.FromSlash(decodedPath)), true
}

func normalizeShellCwd(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	if strings.HasPrefix(strings.ToLower(trimmed), "file://") {
		parsed, ok := parseTerminalCwdPayload(trimmed)
		if ok {
			return parsed
		}
	}

	normalized := filepath.FromSlash(trimmed)
	if stdruntime.GOOS == "windows" {
		if len(normalized) >= 3 && normalized[0] == filepath.Separator && normalized[2] == ':' {
			normalized = normalized[1:]
		}
	}

	return filepath.Clean(normalized)
}

func (s *Service) commandSandboxPolicy() map[string]any {
	if s.store == nil {
		return appconfig.DefaultCommandSandboxPolicy()
	}

	prefs := s.store.GetRuntimePreferences()
	sandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(prefs.DefaultCommandSandboxPolicy)
	if err != nil || len(sandboxPolicy) == 0 {
		return appconfig.DefaultCommandSandboxPolicy()
	}

	return sandboxPolicy
}
