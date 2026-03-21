package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/auth"
	"codex-server/backend/internal/automations"
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/execfs"
	"codex-server/backend/internal/feedback"
	"codex-server/backend/internal/notifications"
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
	Automations    *automations.Service
	Notifications  *notifications.Service
	Threads        *threads.Service
	Turns          *turns.Service
	Approvals      *approvals.Service
	Catalog        *catalog.Service
	ConfigFS       *configfs.Service
	ExecFS         *execfs.Service
	Feedback       *feedback.Service
	Events         *events.Hub
}

type Server struct {
	originMatcher *originMatcher
	auth          *auth.Service
	workspaces    *workspace.Service
	automations   *automations.Service
	notifications *notifications.Service
	threads       *threads.Service
	turns         *turns.Service
	approvals     *approvals.Service
	catalog       *catalog.Service
	configfs      *configfs.Service
	execfs        *execfs.Service
	feedback      *feedback.Service
	events        *events.Hub
}

func NewRouter(deps Dependencies) http.Handler {
	originMatcher := newOriginMatcher(deps.FrontendOrigin)

	server := &Server{
		originMatcher: originMatcher,
		auth:          deps.Auth,
		workspaces:    deps.Workspaces,
		automations:   deps.Automations,
		notifications: deps.Notifications,
		threads:       deps.Threads,
		turns:         deps.Turns,
		approvals:     deps.Approvals,
		catalog:       deps.Catalog,
		configfs:      deps.ConfigFS,
		execfs:        deps.ExecFS,
		feedback:      deps.Feedback,
		events:        deps.Events,
	}

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowOriginFunc:  originMatcher.AllowRequest,
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	router.Get("/healthz", server.handleHealth)
	router.Route("/api", func(r chi.Router) {
		r.Get("/account", server.handleGetAccount)
		r.Post("/account/login", server.handleLogin)
		r.Post("/account/login/cancel", server.handleCancelLogin)
		r.Post("/account/logout", server.handleLogout)
		r.Get("/account/rate-limits", server.handleGetRateLimits)

		r.Route("/automations", func(r chi.Router) {
			r.Get("/", server.handleListAutomations)
			r.Post("/", server.handleCreateAutomation)
			r.Get("/{automationId}", server.handleGetAutomation)
			r.Get("/{automationId}/runs", server.handleListAutomationRuns)
			r.Post("/{automationId}/pause", server.handlePauseAutomation)
			r.Post("/{automationId}/resume", server.handleResumeAutomation)
			r.Post("/{automationId}/fix", server.handleFixAutomation)
			r.Post("/{automationId}/run", server.handleRunAutomation)
			r.Delete("/{automationId}", server.handleDeleteAutomation)
		})
		r.Route("/automation-templates", func(r chi.Router) {
			r.Get("/", server.handleListAutomationTemplates)
			r.Post("/", server.handleCreateAutomationTemplate)
			r.Get("/{templateId}", server.handleGetAutomationTemplate)
			r.Post("/{templateId}", server.handleUpdateAutomationTemplate)
			r.Delete("/{templateId}", server.handleDeleteAutomationTemplate)
		})
		r.Get("/automation-runs/{runId}", server.handleGetAutomationRun)
		r.Get("/notifications", server.handleListNotifications)
		r.Post("/notifications/read-all", server.handleReadAllNotifications)
		r.Post("/notifications/{notificationId}/read", server.handleReadNotification)

		r.Route("/workspaces", func(r chi.Router) {
			r.Get("/", server.handleListWorkspaces)
			r.Post("/", server.handleCreateWorkspace)
			r.Get("/{workspaceId}", server.handleGetWorkspace)
			r.Post("/{workspaceId}/name", server.handleRenameWorkspace)
			r.Post("/{workspaceId}/restart", server.handleRestartWorkspace)
			r.Delete("/{workspaceId}", server.handleDeleteWorkspace)
			r.Get("/{workspaceId}/pending-approvals", server.handleListPendingApprovals)
			r.Get("/{workspaceId}/models", server.handleListModels)
			r.Get("/{workspaceId}/skills", server.handleListSkills)
			r.Post("/{workspaceId}/skills/remote/list", server.handleListRemoteSkills)
			r.Post("/{workspaceId}/skills/remote/export", server.handleExportRemoteSkill)
			r.Post("/{workspaceId}/skills/config/write", server.handleWriteSkillConfig)
			r.Get("/{workspaceId}/apps", server.handleListApps)
			r.Get("/{workspaceId}/plugins", server.handleListPlugins)
			r.Post("/{workspaceId}/plugins/read", server.handleReadPlugin)
			r.Post("/{workspaceId}/plugins/install", server.handleInstallPlugin)
			r.Post("/{workspaceId}/plugins/uninstall", server.handleUninstallPlugin)
			r.Post("/{workspaceId}/config/read", server.handleConfigRead)
			r.Post("/{workspaceId}/config/write", server.handleConfigWrite)
			r.Post("/{workspaceId}/config/batch-write", server.handleConfigBatchWrite)
			r.Get("/{workspaceId}/config/requirements", server.handleConfigRequirementsRead)
			r.Post("/{workspaceId}/config/mcp-server/reload", server.handleConfigMcpServerReload)
			r.Post("/{workspaceId}/external-agent/detect", server.handleExternalAgentConfigDetect)
			r.Post("/{workspaceId}/external-agent/import", server.handleExternalAgentConfigImport)
			r.Post("/{workspaceId}/search/files", server.handleFuzzyFileSearch)
			r.Post("/{workspaceId}/feedback/upload", server.handleFeedbackUpload)
			r.Post("/{workspaceId}/mcp/oauth/login", server.handleMcpOauthLogin)
			r.Get("/{workspaceId}/experimental-features", server.handleListExperimentalFeatures)
			r.Get("/{workspaceId}/mcp-server-status", server.handleListMcpServerStatus)
			r.Post("/{workspaceId}/windows-sandbox/setup-start", server.handleWindowsSandboxSetupStart)
			r.Get("/{workspaceId}/collaboration-modes", server.handleListCollaborationModes)
			r.Get("/{workspaceId}/stream", server.handleWorkspaceStream)

			r.Route("/{workspaceId}/threads", func(r chi.Router) {
				r.Get("/", server.handleListThreads)
				r.Get("/loaded", server.handleListLoadedThreads)
				r.Post("/", server.handleCreateThread)
				r.Get("/{threadId}", server.handleGetThread)
				r.Delete("/{threadId}", server.handleDeleteThread)
				r.Post("/{threadId}/resume", server.handleResumeThread)
				r.Post("/{threadId}/fork", server.handleForkThread)
				r.Post("/{threadId}/archive", server.handleArchiveThread)
				r.Post("/{threadId}/unarchive", server.handleUnarchiveThread)
				r.Post("/{threadId}/name", server.handleRenameThread)
				r.Post("/{threadId}/metadata", server.handleUpdateThreadMetadata)
				r.Post("/{threadId}/rollback", server.handleRollbackThread)
				r.Post("/{threadId}/compact", server.handleCompactThread)
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

func (s *Server) handleCancelLogin(w http.ResponseWriter, r *http.Request) {
	var request struct {
		LoginID string `json:"loginId"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.auth.CancelLogin(r.Context(), request.LoginID)
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

func (s *Server) handleRenameWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Name string `json:"name"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	workspace, err := s.workspaces.Rename(workspaceID, request.Name)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, workspace)
}

func (s *Server) handleRestartWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	workspace, err := s.workspaces.RestartRuntime(r.Context(), workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, workspace)
}

func (s *Server) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	if err := s.workspaces.Delete(r.Context(), workspaceID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleListAutomations(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.automations.List())
}

func (s *Server) handleCreateAutomation(w http.ResponseWriter, r *http.Request) {
	var request automations.CreateInput

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	automation, err := s.automations.Create(request)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, automation)
}

func (s *Server) handleGetAutomation(w http.ResponseWriter, r *http.Request) {
	automationID := chi.URLParam(r, "automationId")

	automation, err := s.automations.Get(automationID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, automation)
}

func (s *Server) handleListAutomationTemplates(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.automations.ListTemplates())
}

func (s *Server) handleCreateAutomationTemplate(w http.ResponseWriter, r *http.Request) {
	var request automations.TemplateInput

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	template, err := s.automations.CreateTemplate(request)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, template)
}

func (s *Server) handleGetAutomationTemplate(w http.ResponseWriter, r *http.Request) {
	template, err := s.automations.GetTemplate(chi.URLParam(r, "templateId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, template)
}

func (s *Server) handleUpdateAutomationTemplate(w http.ResponseWriter, r *http.Request) {
	var request automations.TemplateInput

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	template, err := s.automations.UpdateTemplate(chi.URLParam(r, "templateId"), request)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, template)
}

func (s *Server) handleDeleteAutomationTemplate(w http.ResponseWriter, r *http.Request) {
	if err := s.automations.DeleteTemplate(chi.URLParam(r, "templateId")); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleListAutomationRuns(w http.ResponseWriter, r *http.Request) {
	automationID := chi.URLParam(r, "automationId")
	if _, err := s.automations.Get(automationID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, s.automations.ListRuns(automationID))
}

func (s *Server) handleGetAutomationRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.automations.GetRun(chi.URLParam(r, "runId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, run)
}

func (s *Server) handlePauseAutomation(w http.ResponseWriter, r *http.Request) {
	s.handleAutomationMutation(w, r, s.automations.Pause)
}

func (s *Server) handleResumeAutomation(w http.ResponseWriter, r *http.Request) {
	s.handleAutomationMutation(w, r, s.automations.Resume)
}

func (s *Server) handleFixAutomation(w http.ResponseWriter, r *http.Request) {
	s.handleAutomationMutation(w, r, s.automations.Fix)
}

func (s *Server) handleRunAutomation(w http.ResponseWriter, r *http.Request) {
	run, err := s.automations.Trigger(r.Context(), chi.URLParam(r, "automationId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, run)
}

func (s *Server) handleDeleteAutomation(w http.ResponseWriter, r *http.Request) {
	automationID := chi.URLParam(r, "automationId")
	if err := s.automations.Delete(automationID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleListNotifications(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.notifications.List())
}

func (s *Server) handleReadNotification(w http.ResponseWriter, r *http.Request) {
	notification, err := s.notifications.MarkRead(chi.URLParam(r, "notificationId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, notification)
}

func (s *Server) handleReadAllNotifications(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.notifications.MarkAllRead())
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

func (s *Server) handleListLoadedThreads(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threads, err := s.threads.ListLoaded(r.Context(), workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, threads)
}

func (s *Server) handleCreateThread(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Name             string `json:"name"`
		Model            string `json:"model"`
		PermissionPreset string `json:"permissionPreset"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	thread, err := s.threads.Create(r.Context(), workspaceID, threads.CreateInput{
		Name:             request.Name,
		Model:            request.Model,
		PermissionPreset: request.PermissionPreset,
	})
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

func (s *Server) handleDeleteThread(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	if err := s.threads.Delete(r.Context(), workspaceID, threadID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
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

func (s *Server) handleUpdateThreadMetadata(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	var request struct {
		GitInfo map[string]any `json:"gitInfo"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	thread, err := s.threads.UpdateMetadata(r.Context(), workspaceID, threadID, request.GitInfo)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, thread)
}

func (s *Server) handleCompactThread(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	if err := s.threads.Compact(r.Context(), workspaceID, threadID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleStartTurn(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	var request struct {
		Input             string `json:"input"`
		Model             string `json:"model"`
		ReasoningEffort   string `json:"reasoningEffort"`
		PermissionPreset  string `json:"permissionPreset"`
		CollaborationMode string `json:"collaborationMode"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.turns.Start(r.Context(), workspaceID, threadID, request.Input, turns.StartOptions{
		Model:             request.Model,
		ReasoningEffort:   request.ReasoningEffort,
		PermissionPreset:  request.PermissionPreset,
		CollaborationMode: request.CollaborationMode,
	})
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

func (s *Server) handleListRemoteSkills(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Enabled        bool   `json:"enabled"`
		HazelnutScope  string `json:"hazelnutScope"`
		ProductSurface string `json:"productSurface"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.catalog.ListRemoteSkills(r.Context(), workspaceID, request.Enabled, request.HazelnutScope, request.ProductSurface)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleWriteSkillConfig(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Path    string `json:"path"`
		Enabled bool   `json:"enabled"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.catalog.WriteSkillConfig(r.Context(), workspaceID, request.Path, request.Enabled)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleExportRemoteSkill(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		HazelnutID string `json:"hazelnutId"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.catalog.ExportRemoteSkill(r.Context(), workspaceID, request.HazelnutID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
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

func (s *Server) handleConfigRead(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		IncludeLayers bool `json:"includeLayers"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.configfs.ReadConfig(r.Context(), workspaceID, request.IncludeLayers)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleConfigWrite(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		FilePath      string `json:"filePath"`
		KeyPath       string `json:"keyPath"`
		MergeStrategy string `json:"mergeStrategy"`
		Value         any    `json:"value"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.configfs.WriteConfigValue(r.Context(), workspaceID, request.FilePath, request.KeyPath, request.MergeStrategy, request.Value)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleConfigBatchWrite(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		FilePath         string           `json:"filePath"`
		Edits            []map[string]any `json:"edits"`
		ReloadUserConfig bool             `json:"reloadUserConfig"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.configfs.BatchWriteConfig(r.Context(), workspaceID, request.FilePath, request.Edits, request.ReloadUserConfig)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleFuzzyFileSearch(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Query string `json:"query"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.configfs.FuzzyFileSearch(r.Context(), workspaceID, request.Query)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFeedbackUpload(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Classification string   `json:"classification"`
		IncludeLogs    bool     `json:"includeLogs"`
		Reason         string   `json:"reason"`
		ThreadID       string   `json:"threadId"`
		ExtraLogFiles  []string `json:"extraLogFiles"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.feedback.Upload(r.Context(), workspaceID, request.Classification, request.IncludeLogs, request.Reason, request.ThreadID, request.ExtraLogFiles)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleMcpOauthLogin(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Name        string   `json:"name"`
		Scopes      []string `json:"scopes"`
		TimeoutSecs *int     `json:"timeoutSecs"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.auth.McpOauthLogin(r.Context(), workspaceID, request.Name, request.Scopes, request.TimeoutSecs)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleConfigRequirementsRead(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	result, err := s.configfs.ReadConfigRequirements(r.Context(), workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleConfigMcpServerReload(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	if err := s.configfs.ReloadMcpServers(r.Context(), workspaceID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleListExperimentalFeatures(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	result, err := s.catalog.ListExperimentalFeatures(r.Context(), workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleListMcpServerStatus(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	result, err := s.catalog.ListMcpServerStatus(r.Context(), workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleWindowsSandboxSetupStart(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		Mode string `json:"mode"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.configfs.StartWindowsSandboxSetup(r.Context(), workspaceID, request.Mode)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleExternalAgentConfigDetect(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		IncludeHome bool `json:"includeHome"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.configfs.DetectExternalAgentConfig(r.Context(), workspaceID, request.IncludeHome)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleExternalAgentConfigImport(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request struct {
		MigrationItems []map[string]any `json:"migrationItems"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	if err := s.configfs.ImportExternalAgentConfig(r.Context(), workspaceID, request.MigrationItems); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
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

func (s *Server) handleListCollaborationModes(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	result, err := s.catalog.CollaborationModes(r.Context(), workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
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
			return origin == "" || s.originMatcher.Allow(origin)
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

func (s *Server) handleAutomationMutation(w http.ResponseWriter, r *http.Request, mutate func(string) (store.Automation, error)) {
	automationID := chi.URLParam(r, "automationId")

	automation, err := mutate(automationID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, automation)
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
	case errors.Is(err, store.ErrAutomationNotFound):
		writeError(w, http.StatusNotFound, "automation_not_found", err.Error())
	case errors.Is(err, store.ErrAutomationTemplateNotFound):
		writeError(w, http.StatusNotFound, "automation_template_not_found", err.Error())
	case errors.Is(err, store.ErrAutomationRunNotFound):
		writeError(w, http.StatusNotFound, "automation_run_not_found", err.Error())
	case errors.Is(err, store.ErrNotificationNotFound):
		writeError(w, http.StatusNotFound, "notification_not_found", err.Error())
	case errors.Is(err, automations.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
	case errors.Is(err, automations.ErrImmutableTemplate):
		writeError(w, http.StatusConflict, "automation_template_immutable", err.Error())
	case errors.Is(err, automations.ErrAutomationAlreadyRunning):
		writeError(w, http.StatusConflict, "automation_already_running", err.Error())
	case errors.Is(err, automations.ErrExecutionUnavailable):
		writeError(w, http.StatusServiceUnavailable, "automation_execution_unavailable", err.Error())
	case errors.Is(err, auth.ErrInvalidLoginInput):
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
	case errors.Is(err, appRuntime.ErrRuntimeNotConfigured):
		writeError(w, http.StatusBadRequest, "runtime_not_configured", err.Error())
	case errors.Is(err, appRuntime.ErrServerRequestNotFound):
		writeError(w, http.StatusNotFound, "server_request_not_found", err.Error())
	case errors.Is(err, appRuntime.ErrNoActiveTurn):
		writeError(w, http.StatusConflict, "no_active_turn", err.Error())
	case isRequiresOpenAIAuthError(err):
		writeError(w, http.StatusUnauthorized, "requires_openai_auth", "OpenAI authentication is required. Reconnect the account or update the API key.")
	default:
		writeError(w, http.StatusBadGateway, "upstream_error", err.Error())
	}
}

func isRequiresOpenAIAuthError(err error) bool {
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	if message == "" {
		return false
	}

	if strings.Contains(message, "invalid_api_key") {
		return true
	}

	if strings.Contains(message, "authentication required") || strings.Contains(message, "requires openai auth") {
		return true
	}

	return strings.Contains(message, "401 unauthorized") &&
		(strings.Contains(message, "api key") || strings.Contains(message, "openai") || strings.Contains(message, "auth"))
}
