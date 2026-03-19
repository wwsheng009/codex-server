package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/auth"
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/execfs"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
	"codex-server/backend/internal/workspace"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/gorilla/websocket"
)

type Dependencies struct {
	FrontendOrigin string
	Auth           *auth.Service
	Workspaces     *workspace.Service
	Threads        *threads.Service
	Turns          *turns.Service
	Approvals      *approvals.Service
	Catalog        *catalog.Service
	ExecFS         *execfs.Service
	Events         *events.Hub
}

type Server struct {
	frontendOrigin string
	auth           *auth.Service
	workspaces     *workspace.Service
	threads        *threads.Service
	turns          *turns.Service
	approvals      *approvals.Service
	catalog        *catalog.Service
	execfs         *execfs.Service
	events         *events.Hub
}

func NewRouter(deps Dependencies) http.Handler {
	server := &Server{
		frontendOrigin: deps.FrontendOrigin,
		auth:           deps.Auth,
		workspaces:     deps.Workspaces,
		threads:        deps.Threads,
		turns:          deps.Turns,
		approvals:      deps.Approvals,
		catalog:        deps.Catalog,
		execfs:         deps.ExecFS,
		events:         deps.Events,
	}

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{deps.FrontendOrigin},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	router.Get("/healthz", server.handleHealth)
	router.Route("/api", func(r chi.Router) {
		r.Get("/account", server.handleGetAccount)
		r.Post("/account/login", server.handleLogin)
		r.Post("/account/logout", server.handleLogout)
		r.Get("/account/rate-limits", server.handleGetRateLimits)

		r.Route("/workspaces", func(r chi.Router) {
			r.Get("/", server.handleListWorkspaces)
			r.Post("/", server.handleCreateWorkspace)
			r.Get("/{workspaceId}", server.handleGetWorkspace)
			r.Get("/{workspaceId}/pending-approvals", server.handleListPendingApprovals)
			r.Get("/{workspaceId}/models", server.handleListModels)
			r.Get("/{workspaceId}/skills", server.handleListSkills)
			r.Get("/{workspaceId}/apps", server.handleListApps)
			r.Get("/{workspaceId}/plugins", server.handleListPlugins)
			r.Post("/{workspaceId}/plugins/read", server.handleReadPlugin)
			r.Post("/{workspaceId}/plugins/install", server.handleInstallPlugin)
			r.Post("/{workspaceId}/plugins/uninstall", server.handleUninstallPlugin)
			r.Get("/{workspaceId}/collaboration-modes", server.handleListCollaborationModes)
			r.Get("/{workspaceId}/stream", server.handleWorkspaceStream)

			r.Route("/{workspaceId}/threads", func(r chi.Router) {
				r.Get("/", server.handleListThreads)
				r.Post("/", server.handleCreateThread)
				r.Get("/{threadId}", server.handleGetThread)
				r.Post("/{threadId}/resume", server.handleResumeThread)
				r.Post("/{threadId}/fork", server.handleForkThread)
				r.Post("/{threadId}/archive", server.handleArchiveThread)
				r.Post("/{threadId}/unarchive", server.handleUnarchiveThread)
				r.Post("/{threadId}/name", server.handleRenameThread)
				r.Post("/{threadId}/rollback", server.handleRollbackThread)
				r.Post("/{threadId}/turns", server.handleStartTurn)
				r.Post("/{threadId}/turns/steer", server.handleSteerTurn)
				r.Post("/{threadId}/turns/interrupt", server.handleInterruptTurn)
				r.Post("/{threadId}/review", server.handleReview)
			})

			r.Post("/{workspaceId}/commands", server.handleStartCommand)
			r.Post("/{workspaceId}/commands/{processId}/write", server.handleWriteCommand)
			r.Post("/{workspaceId}/commands/{processId}/resize", server.handleResizeCommand)
			r.Post("/{workspaceId}/commands/{processId}/terminate", server.handleTerminateCommand)
			r.Post("/{workspaceId}/fs/read", server.handleFSRead)
			r.Post("/{workspaceId}/fs/write", server.handleFSWrite)
			r.Post("/{workspaceId}/fs/read-directory", server.handleFSReadDirectory)
			r.Post("/{workspaceId}/fs/metadata", server.handleFSMetadata)
			r.Post("/{workspaceId}/fs/mkdir", server.handleFSMkdir)
			r.Post("/{workspaceId}/fs/remove", server.handleFSRemove)
			r.Post("/{workspaceId}/fs/copy", server.handleFSCopy)
		})

		r.Post("/server-requests/{requestId}/respond", server.handleRespondServerRequest)
	})

	return router
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
		"ts":     time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleGetAccount(w http.ResponseWriter, r *http.Request) {
	account, err := s.auth.CurrentAccount(r.Context())
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, account)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var request auth.LoginInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.auth.Login(r.Context(), request)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.auth.Logout(r.Context()); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleGetRateLimits(w http.ResponseWriter, r *http.Request) {
	limits, err := s.auth.RateLimits(r.Context())
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, limits)
}

func (s *Server) handleListWorkspaces(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.workspaces.List())
}

func (s *Server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Name     string `json:"name"`
		RootPath string `json:"rootPath"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	workspace, err := s.workspaces.Create(request.Name, request.RootPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, workspace)
}

func (s *Server) handleGetWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	workspace, err := s.workspaces.EnsureRuntime(r.Context(), workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, workspace)
}

func (s *Server) handleListThreads(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threads, err := s.threads.List(r.Context(), workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, threads)
}

func (s *Server) handleCreateThread(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Name string `json:"name"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	thread, err := s.threads.Create(r.Context(), workspaceID, request.Name)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, thread)
}

func (s *Server) handleGetThread(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	thread, err := s.threads.GetDetail(r.Context(), workspaceID, threadID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, thread)
}

func (s *Server) handleResumeThread(w http.ResponseWriter, r *http.Request) {
	s.handleThreadMutation(w, r, s.threads.Resume)
}

func (s *Server) handleForkThread(w http.ResponseWriter, r *http.Request) {
	s.handleThreadMutation(w, r, s.threads.Fork)
}

func (s *Server) handleArchiveThread(w http.ResponseWriter, r *http.Request) {
	s.handleThreadMutation(w, r, s.threads.Archive)
}

func (s *Server) handleUnarchiveThread(w http.ResponseWriter, r *http.Request) {
	s.handleThreadMutation(w, r, s.threads.Unarchive)
}

func (s *Server) handleRenameThread(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	var request struct {
		Name string `json:"name"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	thread, err := s.threads.Rename(r.Context(), workspaceID, threadID, request.Name)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, thread)
}

func (s *Server) handleRollbackThread(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	if err := s.threads.Rollback(r.Context(), workspaceID, threadID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleStartTurn(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	var request struct {
		Input string `json:"input"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.turns.Start(r.Context(), workspaceID, threadID, request.Input)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleSteerTurn(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	var request struct {
		Input string `json:"input"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.turns.Steer(r.Context(), workspaceID, threadID, request.Input)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleInterruptTurn(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	result, err := s.turns.Interrupt(r.Context(), workspaceID, threadID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleReview(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	result, err := s.turns.Review(r.Context(), workspaceID, threadID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleListPendingApprovals(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	writeJSON(w, http.StatusOK, s.approvals.List(workspaceID))
}

func (s *Server) handleRespondServerRequest(w http.ResponseWriter, r *http.Request) {
	requestID := chi.URLParam(r, "requestId")

	var request struct {
		Action  string              `json:"action"`
		Answers map[string][]string `json:"answers"`
		Content any                 `json:"content"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	approval, err := s.approvals.Respond(r.Context(), requestID, approvals.ResponseInput{
		Action:  request.Action,
		Answers: request.Answers,
		Content: request.Content,
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, approval)
}

func (s *Server) handleStartCommand(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Command string `json:"command"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	session, err := s.execfs.StartCommand(r.Context(), workspaceID, request.Command)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, session)
}

func (s *Server) handleWriteCommand(w http.ResponseWriter, r *http.Request) {
	processID := chi.URLParam(r, "processId")

	var request struct {
		Input string `json:"input"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	if err := s.execfs.Write(r.Context(), processID, request.Input); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleResizeCommand(w http.ResponseWriter, r *http.Request) {
	processID := chi.URLParam(r, "processId")

	var request struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	if err := s.execfs.Resize(r.Context(), processID, request.Cols, request.Rows); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleTerminateCommand(w http.ResponseWriter, r *http.Request) {
	processID := chi.URLParam(r, "processId")
	if err := s.execfs.Terminate(r.Context(), processID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleFSRead(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Path string `json:"path"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.execfs.ReadFile(r.Context(), workspaceID, request.Path)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFSWrite(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.execfs.WriteFile(r.Context(), workspaceID, request.Path, request.Content)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleFSReadDirectory(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Path string `json:"path"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.execfs.ReadDirectory(r.Context(), workspaceID, request.Path)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFSMetadata(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Path string `json:"path"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.execfs.GetMetadata(r.Context(), workspaceID, request.Path)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFSMkdir(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Path      string `json:"path"`
		Recursive bool   `json:"recursive"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.execfs.CreateDirectory(r.Context(), workspaceID, request.Path, request.Recursive)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleFSRemove(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Path      string `json:"path"`
		Recursive bool   `json:"recursive"`
		Force     bool   `json:"force"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.execfs.RemovePath(r.Context(), workspaceID, request.Path, request.Recursive, request.Force)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleFSCopy(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		SourcePath      string `json:"sourcePath"`
		DestinationPath string `json:"destinationPath"`
		Recursive       bool   `json:"recursive"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.execfs.CopyPath(r.Context(), workspaceID, request.SourcePath, request.DestinationPath, request.Recursive)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleListModels(w http.ResponseWriter, r *http.Request) {
	items, err := s.catalog.Models(r.Context(), chi.URLParam(r, "workspaceId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleListSkills(w http.ResponseWriter, r *http.Request) {
	items, err := s.catalog.Skills(r.Context(), chi.URLParam(r, "workspaceId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleListApps(w http.ResponseWriter, r *http.Request) {
	items, err := s.catalog.Apps(r.Context(), chi.URLParam(r, "workspaceId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleListPlugins(w http.ResponseWriter, r *http.Request) {
	items, err := s.catalog.Plugins(r.Context(), chi.URLParam(r, "workspaceId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleReadPlugin(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		MarketplacePath string `json:"marketplacePath"`
		PluginName      string `json:"pluginName"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.catalog.ReadPlugin(r.Context(), workspaceID, request.MarketplacePath, request.PluginName)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleInstallPlugin(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		MarketplacePath string `json:"marketplacePath"`
		PluginName      string `json:"pluginName"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.catalog.InstallPlugin(r.Context(), workspaceID, request.MarketplacePath, request.PluginName)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleUninstallPlugin(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		PluginID string `json:"pluginId"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	if err := s.catalog.UninstallPlugin(r.Context(), workspaceID, request.PluginID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleListCollaborationModes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.catalog.CollaborationModes())
}

func (s *Server) handleWorkspaceStream(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	if !s.workspaceExists(workspaceID) {
		writeError(w, http.StatusNotFound, "workspace_not_found", "workspace was not found")
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			return origin == "" || strings.EqualFold(origin, s.frontendOrigin)
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	eventsCh, cancel := s.events.Subscribe(workspaceID)
	defer cancel()

	if err := conn.WriteJSON(store.EventEnvelope{
		WorkspaceID: workspaceID,
		Method:      "workspace/connected",
		Payload: map[string]string{
			"status": "connected",
		},
		ServerRequestID: nil,
		TS:              time.Now().UTC(),
	}); err != nil {
		return
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-eventsCh:
			if !ok {
				return
			}

			if err := conn.WriteJSON(event); err != nil {
				return
			}
		}
	}
}

func (s *Server) handleThreadMutation(w http.ResponseWriter, r *http.Request, mutate func(context.Context, string, string) (store.Thread, error)) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	thread, err := mutate(r.Context(), workspaceID, threadID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, thread)
}

func (s *Server) workspaceExists(workspaceID string) bool {
	_, ok := s.workspaces.Get(workspaceID)
	return ok
}

func (s *Server) writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrWorkspaceNotFound):
		writeError(w, http.StatusNotFound, "workspace_not_found", err.Error())
	case errors.Is(err, store.ErrThreadNotFound):
		writeError(w, http.StatusNotFound, "thread_not_found", err.Error())
	case errors.Is(err, store.ErrApprovalNotFound):
		writeError(w, http.StatusNotFound, "approval_not_found", err.Error())
	case errors.Is(err, auth.ErrInvalidLoginInput):
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
	case errors.Is(err, appRuntime.ErrRuntimeNotConfigured):
		writeError(w, http.StatusBadRequest, "runtime_not_configured", err.Error())
	case errors.Is(err, appRuntime.ErrServerRequestNotFound):
		writeError(w, http.StatusNotFound, "server_request_not_found", err.Error())
	case errors.Is(err, appRuntime.ErrNoActiveTurn):
		writeError(w, http.StatusConflict, "no_active_turn", err.Error())
	default:
		writeError(w, http.StatusBadGateway, "upstream_error", err.Error())
	}
}
