package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/accesscontrol"
	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/auth"
	"codex-server/backend/internal/automations"
	"codex-server/backend/internal/bots"
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/execfs"
	"codex-server/backend/internal/feedback"
	"codex-server/backend/internal/notifications"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/runtimeprefs"
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
	FrontendOrigin       string
	EnableRequestLogging bool
	RequestShutdown      func(reason string) bool
	Auth                 *auth.Service
	Workspaces           *workspace.Service
	Bots                 *bots.Service
	Automations          *automations.Service
	Notifications        *notifications.Service
	Threads              *threads.Service
	Turns                *turns.Service
	Approvals            *approvals.Service
	Catalog              *catalog.Service
	ConfigFS             *configfs.Service
	ExecFS               *execfs.Service
	Feedback             *feedback.Service
	Events               *events.Hub
	RuntimePrefs         *runtimeprefs.Service
	AccessControl        *accesscontrol.Service
}

type Server struct {
	originMatcher   *originMatcher
	requestShutdown func(reason string) bool
	auth            *auth.Service
	workspaces      *workspace.Service
	bots            *bots.Service
	automations     *automations.Service
	notifications   *notifications.Service
	threads         *threads.Service
	turns           *turns.Service
	approvals       *approvals.Service
	catalog         *catalog.Service
	configfs        *configfs.Service
	execfs          *execfs.Service
	feedback        *feedback.Service
	events          *events.Hub
	runtimePrefs    *runtimeprefs.Service
	accessControl   *accesscontrol.Service
}

func NewRouter(deps Dependencies) http.Handler {
	originMatcher := newOriginMatcher(deps.FrontendOrigin)

	server := &Server{
		originMatcher:   originMatcher,
		requestShutdown: deps.RequestShutdown,
		auth:            deps.Auth,
		workspaces:      deps.Workspaces,
		bots:            deps.Bots,
		automations:     deps.Automations,
		notifications:   deps.Notifications,
		threads:         deps.Threads,
		turns:           deps.Turns,
		approvals:       deps.Approvals,
		catalog:         deps.Catalog,
		configfs:        deps.ConfigFS,
		execfs:          deps.ExecFS,
		feedback:        deps.Feedback,
		events:          deps.Events,
		runtimePrefs:    deps.RuntimePrefs,
		accessControl:   deps.AccessControl,
	}

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(server.captureOriginalRemoteAddr)
	router.Use(middleware.RealIP)
	if deps.EnableRequestLogging {
		router.Use(middleware.Logger)
	}
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowOriginFunc:  originMatcher.AllowRequest,
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	router.Use(server.requireRemoteAccess)

	router.Get("/healthz", server.handleHealth)
	router.Post("/__admin/stop", server.handleStopServer)
	router.Post("/hooks/bots/{connectionId}", server.handleBotWebhook)
	router.Route("/api", func(r chi.Router) {
		r.Get("/access/bootstrap", server.handleAccessBootstrap)
		r.Post("/access/login", server.handleAccessLogin)
		r.Post("/access/logout", server.handleAccessLogout)

		r.Group(func(r chi.Router) {
			r.Use(server.requireProtectedAccess)
			r.Get("/runtime/preferences", server.handleReadRuntimePreferences)
			r.Post("/runtime/preferences", server.handleWriteRuntimePreferences)
			r.Post("/runtime/preferences/import-model-catalog", server.handleImportRuntimeModelCatalog)

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
			r.Delete("/notifications/read", server.handleDeleteReadNotifications)

			r.Route("/workspaces", func(r chi.Router) {
				r.Get("/", server.handleListWorkspaces)
				r.Post("/", server.handleCreateWorkspace)
				r.Get("/{workspaceId}", server.handleGetWorkspace)
				r.Get("/{workspaceId}/account", server.handleGetAccount)
				r.Post("/{workspaceId}/account/login", server.handleLogin)
				r.Post("/{workspaceId}/account/login/cancel", server.handleCancelLogin)
				r.Post("/{workspaceId}/account/logout", server.handleLogout)
				r.Get("/{workspaceId}/account/rate-limits", server.handleGetRateLimits)
				r.Get("/{workspaceId}/runtime-state", server.handleGetWorkspaceRuntimeState)
				r.Post("/{workspaceId}/name", server.handleRenameWorkspace)
				r.Post("/{workspaceId}/restart", server.handleRestartWorkspace)
				r.Delete("/{workspaceId}", server.handleDeleteWorkspace)
				r.Get("/{workspaceId}/pending-approvals", server.handleListPendingApprovals)
				r.Get("/{workspaceId}/models", server.handleListModels)
				r.Get("/{workspaceId}/skills", server.handleListSkills)
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
				r.Route("/{workspaceId}/bot-connections", func(r chi.Router) {
					r.Get("/", server.handleListBotConnections)
					r.Post("/", server.handleCreateBotConnection)
					r.Get("/{connectionId}", server.handleGetBotConnection)
					r.Post("/{connectionId}", server.handleUpdateBotConnection)
					r.Get("/{connectionId}/logs", server.handleListBotConnectionLogs)
					r.Post("/{connectionId}/runtime-mode", server.handleUpdateBotConnectionRuntimeMode)
					r.Post("/{connectionId}/command-output-mode", server.handleUpdateBotConnectionCommandOutputMode)
					r.Post("/{connectionId}/wechat-channel-timing", server.handleUpdateBotConnectionWeChatChannelTiming)
					r.Post("/{connectionId}/pause", server.handlePauseBotConnection)
					r.Post("/{connectionId}/resume", server.handleResumeBotConnection)
					r.Delete("/{connectionId}", server.handleDeleteBotConnection)
					r.Route("/{connectionId}/conversations", func(r chi.Router) {
						r.Get("/", server.handleListBotConnectionConversations)
						r.Post("/{conversationId}/binding", server.handleUpdateBotConversationBinding)
						r.Post("/{conversationId}/binding/clear", server.handleClearBotConversationBinding)
						r.Post("/{conversationId}/replay-failed-reply", server.handleReplayBotConversationFailedReply)
					})
				})
				r.Get("/{workspaceId}/bot-conversations", server.handleListBotConversations)
				r.Get("/{workspaceId}/bot-providers/wechat/accounts", server.handleListWeChatAccounts)
				r.Patch("/{workspaceId}/bot-providers/wechat/accounts/{accountId}", server.handleUpdateWeChatAccount)
				r.Delete("/{workspaceId}/bot-providers/wechat/accounts/{accountId}", server.handleDeleteWeChatAccount)
				r.Post("/{workspaceId}/bot-providers/wechat/login/start", server.handleStartWeChatLogin)
				r.Get("/{workspaceId}/bot-providers/wechat/login/{loginId}", server.handleGetWeChatLogin)
				r.Delete("/{workspaceId}/bot-providers/wechat/login/{loginId}", server.handleDeleteWeChatLogin)

				r.Route("/{workspaceId}/threads", func(r chi.Router) {
					r.Get("/", server.handleListThreads)
					r.Get("/loaded", server.handleListLoadedThreads)
					r.Post("/", server.handleCreateThread)
					r.Get("/{threadId}", server.handleGetThread)
					r.Get("/{threadId}/turns/{turnId}", server.handleGetThreadTurn)
					r.Get("/{threadId}/turns/{turnId}/items/{itemId}", server.handleGetThreadTurnItem)
					r.Get("/{threadId}/turns/{turnId}/items/{itemId}/output", server.handleGetThreadTurnItemOutput)
					r.Delete("/{threadId}", server.handleDeleteThread)
					r.Post("/{threadId}/resume", server.handleResumeThread)
					r.Post("/{threadId}/fork", server.handleForkThread)
					r.Post("/{threadId}/archive", server.handleArchiveThread)
					r.Post("/{threadId}/unarchive", server.handleUnarchiveThread)
					r.Post("/{threadId}/name", server.handleRenameThread)
					r.Post("/{threadId}/metadata", server.handleUpdateThreadMetadata)
					r.Post("/{threadId}/rollback", server.handleRollbackThread)
					r.Post("/{threadId}/compact", server.handleCompactThread)
					r.Post("/{threadId}/shell-command", server.handleThreadShellCommand)
					r.Post("/{threadId}/turns", server.handleStartTurn)
					r.Post("/{threadId}/turns/steer", server.handleSteerTurn)
					r.Post("/{threadId}/turns/interrupt", server.handleInterruptTurn)
					r.Post("/{threadId}/review", server.handleReview)
				})

				r.Get("/{workspaceId}/commands", server.handleListCommandSessions)
				r.Delete("/{workspaceId}/commands/completed", server.handleClearCompletedCommandSessions)
				r.Post("/{workspaceId}/commands", server.handleStartCommand)
				r.Post("/{workspaceId}/commands/{processId}/archive", server.handleArchiveCommandSession)
				r.Post("/{workspaceId}/commands/{processId}/pin", server.handlePinCommandSession)
				r.Post("/{workspaceId}/commands/{processId}/unarchive", server.handleUnarchiveCommandSession)
				r.Post("/{workspaceId}/commands/{processId}/unpin", server.handleUnpinCommandSession)
				r.Delete("/{workspaceId}/commands/{processId}", server.handleCloseCommandSession)
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
	})

	return router
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
		"ts":     time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleStopServer(w http.ResponseWriter, r *http.Request) {
	if s.requestShutdown == nil {
		writeError(w, http.StatusNotFound, "not_found", "server shutdown endpoint is unavailable")
		return
	}

	if strings.TrimSpace(r.Header.Get("X-Codex-Server-Action")) != "stop" {
		writeError(w, http.StatusBadRequest, "bad_request", "missing stop action header")
		return
	}

	if !accesscontrol.IsLoopbackRemoteAddr(originalRemoteAddrFromRequest(r)) {
		writeError(w, http.StatusForbidden, "forbidden", "server shutdown is only available from loopback addresses")
		return
	}

	if !s.requestShutdown("http-stop") {
		writeError(w, http.StatusConflict, "shutdown_in_progress", "backend shutdown is already in progress")
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleGetAccount(w http.ResponseWriter, r *http.Request) {
	account, err := s.auth.CurrentAccount(r.Context(), chi.URLParam(r, "workspaceId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, account)
}

func (s *Server) handleReadRuntimePreferences(w http.ResponseWriter, _ *http.Request) {
	result, err := s.runtimePrefs.Read()
	if err != nil {
		writeError(w, http.StatusBadRequest, "runtime_preferences_invalid", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleWriteRuntimePreferences(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ModelCatalogPath                 string                     `json:"modelCatalogPath"`
		DefaultShellType                 string                     `json:"defaultShellType"`
		DefaultTerminalShell             string                     `json:"defaultTerminalShell"`
		ModelShellTypeOverrides          map[string]string          `json:"modelShellTypeOverrides"`
		OutboundProxyURL                 string                     `json:"outboundProxyUrl"`
		DefaultTurnApprovalPolicy        string                     `json:"defaultTurnApprovalPolicy"`
		DefaultTurnSandboxPolicy         map[string]any             `json:"defaultTurnSandboxPolicy"`
		DefaultCommandSandboxPolicy      map[string]any             `json:"defaultCommandSandboxPolicy"`
		AllowRemoteAccess                *bool                      `json:"allowRemoteAccess"`
		AllowLocalhostWithoutAccessToken *bool                      `json:"allowLocalhostWithoutAccessToken"`
		AccessTokens                     []accesscontrol.TokenInput `json:"accessTokens"`
		BackendThreadTraceEnabled        *bool                      `json:"backendThreadTraceEnabled"`
		BackendThreadTraceWorkspaceID    string                     `json:"backendThreadTraceWorkspaceId"`
		BackendThreadTraceThreadID       string                     `json:"backendThreadTraceThreadId"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.runtimePrefs.Write(runtimeprefs.WriteInput{
		ModelCatalogPath:                 request.ModelCatalogPath,
		DefaultShellType:                 request.DefaultShellType,
		DefaultTerminalShell:             request.DefaultTerminalShell,
		ModelShellTypeOverrides:          request.ModelShellTypeOverrides,
		OutboundProxyURL:                 request.OutboundProxyURL,
		DefaultTurnApprovalPolicy:        request.DefaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:         request.DefaultTurnSandboxPolicy,
		DefaultCommandSandboxPolicy:      request.DefaultCommandSandboxPolicy,
		AllowRemoteAccess:                request.AllowRemoteAccess,
		AllowLocalhostWithoutAccessToken: request.AllowLocalhostWithoutAccessToken,
		AccessTokens:                     request.AccessTokens,
		BackendThreadTraceEnabled:        request.BackendThreadTraceEnabled,
		BackendThreadTraceWorkspaceID:    request.BackendThreadTraceWorkspaceID,
		BackendThreadTraceThreadID:       request.BackendThreadTraceThreadID,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "runtime_preferences_invalid", err.Error())
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleImportRuntimeModelCatalog(w http.ResponseWriter, _ *http.Request) {
	result, err := s.runtimePrefs.ImportModelCatalogTemplate()
	if err != nil {
		writeError(w, http.StatusBadRequest, "runtime_preferences_invalid", err.Error())
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var request auth.LoginInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.auth.Login(r.Context(), chi.URLParam(r, "workspaceId"), request)
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

	result, err := s.auth.CancelLogin(r.Context(), chi.URLParam(r, "workspaceId"), request.LoginID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.auth.Logout(r.Context(), chi.URLParam(r, "workspaceId")); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleGetRateLimits(w http.ResponseWriter, r *http.Request) {
	limits, err := s.auth.RateLimits(r.Context(), chi.URLParam(r, "workspaceId"))
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

func (s *Server) handleGetWorkspaceRuntimeState(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	state, err := s.workspaces.RuntimeState(workspaceID)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, state)
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

func (s *Server) handleDeleteReadNotifications(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.notifications.DeleteRead())
}

func (s *Server) handleListBotConnections(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.bots.ListConnections(chi.URLParam(r, "workspaceId")))
}

func (s *Server) handleCreateBotConnection(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	var request bots.CreateConnectionInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	connection, err := s.bots.CreateConnection(r.Context(), workspaceID, request)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, connection)
}

func (s *Server) handleGetBotConnection(w http.ResponseWriter, r *http.Request) {
	connection, err := s.bots.GetConnection(chi.URLParam(r, "workspaceId"), chi.URLParam(r, "connectionId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, connection)
}

func (s *Server) handleUpdateBotConnection(w http.ResponseWriter, r *http.Request) {
	var request bots.UpdateConnectionInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	connection, err := s.bots.UpdateConnection(
		r.Context(),
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "connectionId"),
		request,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, connection)
}

func (s *Server) handleListBotConnectionLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := s.bots.ListConnectionLogs(chi.URLParam(r, "workspaceId"), chi.URLParam(r, "connectionId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, logs)
}

func (s *Server) handleUpdateBotConnectionRuntimeMode(w http.ResponseWriter, r *http.Request) {
	var request bots.UpdateConnectionRuntimeModeInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	connection, err := s.bots.UpdateConnectionRuntimeMode(
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "connectionId"),
		request,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, connection)
}

func (s *Server) handleUpdateBotConnectionCommandOutputMode(w http.ResponseWriter, r *http.Request) {
	var request bots.UpdateConnectionCommandOutputModeInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	connection, err := s.bots.UpdateConnectionCommandOutputMode(
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "connectionId"),
		request,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, connection)
}

func (s *Server) handleUpdateBotConnectionWeChatChannelTiming(w http.ResponseWriter, r *http.Request) {
	var request bots.UpdateWeChatChannelTimingInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	connection, err := s.bots.UpdateWeChatChannelTiming(
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "connectionId"),
		request,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, connection)
}

func (s *Server) handlePauseBotConnection(w http.ResponseWriter, r *http.Request) {
	connection, err := s.bots.PauseConnection(r.Context(), chi.URLParam(r, "workspaceId"), chi.URLParam(r, "connectionId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, connection)
}

func (s *Server) handleResumeBotConnection(w http.ResponseWriter, r *http.Request) {
	var request bots.ResumeConnectionInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	connection, err := s.bots.ResumeConnection(
		r.Context(),
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "connectionId"),
		request,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, connection)
}

func (s *Server) handleDeleteBotConnection(w http.ResponseWriter, r *http.Request) {
	if err := s.bots.DeleteConnection(r.Context(), chi.URLParam(r, "workspaceId"), chi.URLParam(r, "connectionId")); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleListBotConversations(w http.ResponseWriter, r *http.Request) {
	writeJSON(
		w,
		http.StatusOK,
		s.bots.ListConversationViews(chi.URLParam(r, "workspaceId"), strings.TrimSpace(r.URL.Query().Get("connectionId"))),
	)
}

func (s *Server) handleListBotConnectionConversations(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.bots.ListConversationViews(chi.URLParam(r, "workspaceId"), chi.URLParam(r, "connectionId")))
}

func (s *Server) handleUpdateBotConversationBinding(w http.ResponseWriter, r *http.Request) {
	var request bots.UpdateConversationBindingInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	conversation, err := s.bots.UpdateConversationBinding(
		r.Context(),
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "connectionId"),
		chi.URLParam(r, "conversationId"),
		request,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, conversation)
}

func (s *Server) handleClearBotConversationBinding(w http.ResponseWriter, r *http.Request) {
	conversation, err := s.bots.ClearConversationBinding(
		r.Context(),
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "connectionId"),
		chi.URLParam(r, "conversationId"),
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, conversation)
}

func (s *Server) handleReplayBotConversationFailedReply(w http.ResponseWriter, r *http.Request) {
	conversation, err := s.bots.ReplayLatestFailedReply(
		r.Context(),
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "connectionId"),
		chi.URLParam(r, "conversationId"),
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, conversation)
}

func (s *Server) handleStartWeChatLogin(w http.ResponseWriter, r *http.Request) {
	var request bots.StartWeChatLoginInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.bots.StartWeChatLogin(r.Context(), chi.URLParam(r, "workspaceId"), request)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleListWeChatAccounts(w http.ResponseWriter, r *http.Request) {
	result, err := s.bots.ListWeChatAccounts(chi.URLParam(r, "workspaceId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleUpdateWeChatAccount(w http.ResponseWriter, r *http.Request) {
	var request bots.UpdateWeChatAccountInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	result, err := s.bots.UpdateWeChatAccount(
		chi.URLParam(r, "workspaceId"),
		chi.URLParam(r, "accountId"),
		request,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleDeleteWeChatAccount(w http.ResponseWriter, r *http.Request) {
	if err := s.bots.DeleteWeChatAccount(chi.URLParam(r, "workspaceId"), chi.URLParam(r, "accountId")); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleGetWeChatLogin(w http.ResponseWriter, r *http.Request) {
	result, err := s.bots.GetWeChatLogin(r.Context(), chi.URLParam(r, "workspaceId"), chi.URLParam(r, "loginId"))
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleDeleteWeChatLogin(w http.ResponseWriter, r *http.Request) {
	if err := s.bots.DeleteWeChatLogin(chi.URLParam(r, "workspaceId"), chi.URLParam(r, "loginId")); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleBotWebhook(w http.ResponseWriter, r *http.Request) {
	result, err := s.bots.HandleWebhook(r, chi.URLParam(r, "connectionId"))
	if err != nil {
		switch {
		case errors.Is(err, bots.ErrWebhookIgnored):
			writeJSON(w, http.StatusOK, map[string]any{
				"accepted": 0,
				"status":   "ignored",
			})
		case errors.Is(err, bots.ErrWebhookUnauthorized):
			writeError(w, http.StatusUnauthorized, "bot_webhook_unauthorized", err.Error())
		default:
			s.writeStoreError(w, err)
		}
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleListThreads(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")

	query := r.URL.Query()
	if len(query) > 0 {
		limit, err := parseOptionalPositiveIntQuery(query.Get("limit"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "invalid limit query")
			return
		}

		archived, err := parseOptionalBoolQuery(query.Get("archived"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "invalid archived query")
			return
		}
		preferCached, err := parseOptionalBoolQuery(query.Get("preferCached"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "invalid preferCached query")
			return
		}

		sortKey := strings.TrimSpace(query.Get("sortKey"))
		if sortKey != "" && sortKey != "created_at" && sortKey != "updated_at" {
			writeError(w, http.StatusBadRequest, "bad_request", "invalid sortKey query")
			return
		}

		page, err := s.threads.ListPage(r.Context(), workspaceID, threads.ListPageInput{
			Archived:     archived,
			Cursor:       strings.TrimSpace(query.Get("cursor")),
			Limit:        limit,
			SortKey:      sortKey,
			PreferCached: preferCached != nil && *preferCached,
		})
		if err != nil {
			s.writeStoreError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, page)
		return
	}

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
	beforeTurnID := strings.TrimSpace(r.URL.Query().Get("beforeTurnId"))
	contentMode := strings.TrimSpace(r.URL.Query().Get("contentMode"))
	turnLimit := 0
	if value := strings.TrimSpace(r.URL.Query().Get("turnLimit")); value != "" {
		parsedLimit, err := strconv.Atoi(value)
		if err != nil || parsedLimit < 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "invalid turnLimit query")
			return
		}
		turnLimit = parsedLimit
	}

	thread, err := s.threads.GetDetailWindow(
		r.Context(),
		workspaceID,
		threadID,
		turnLimit,
		beforeTurnID,
		contentMode,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, thread)
}

func (s *Server) handleGetThreadTurn(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")
	turnID := chi.URLParam(r, "turnId")
	contentMode := strings.TrimSpace(r.URL.Query().Get("contentMode"))

	turn, err := s.threads.GetTurn(
		r.Context(),
		workspaceID,
		threadID,
		turnID,
		contentMode,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, turn)
}

func (s *Server) handleGetThreadTurnItem(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")
	turnID := chi.URLParam(r, "turnId")
	itemID := chi.URLParam(r, "itemId")
	contentMode := strings.TrimSpace(r.URL.Query().Get("contentMode"))

	item, err := s.threads.GetTurnItem(
		r.Context(),
		workspaceID,
		threadID,
		turnID,
		itemID,
		contentMode,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleGetThreadTurnItemOutput(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")
	turnID := chi.URLParam(r, "turnId")
	itemID := chi.URLParam(r, "itemId")
	outputMode := strings.TrimSpace(r.URL.Query().Get("outputMode"))
	beforeLine := 0
	if value := strings.TrimSpace(r.URL.Query().Get("beforeLine")); value != "" {
		parsedValue, err := strconv.Atoi(value)
		if err != nil || parsedValue < 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "invalid beforeLine query")
			return
		}
		beforeLine = parsedValue
	}
	tailLines := 0
	if value := strings.TrimSpace(r.URL.Query().Get("tailLines")); value != "" {
		parsedValue, err := strconv.Atoi(value)
		if err != nil || parsedValue < 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "invalid tailLines query")
			return
		}
		tailLines = parsedValue
	}

	output, err := s.threads.GetTurnItemOutput(
		r.Context(),
		workspaceID,
		threadID,
		turnID,
		itemID,
		outputMode,
		tailLines,
		beforeLine,
	)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, output)
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

func (s *Server) handleThreadShellCommand(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	threadID := chi.URLParam(r, "threadId")

	var request struct {
		Command string `json:"command"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	if err := s.threads.ShellCommand(r.Context(), workspaceID, threadID, request.Command); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func parseOptionalPositiveIntQuery(value string) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}

	parsedValue, err := strconv.Atoi(value)
	if err != nil || parsedValue < 0 {
		return 0, errors.New("invalid integer query")
	}

	return parsedValue, nil
}

func parseOptionalBoolQuery(value string) (*bool, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}

	parsedValue, err := strconv.ParseBool(value)
	if err != nil {
		return nil, err
	}

	return &parsedValue, nil
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
		Mode    string `json:"mode"`
		Shell   string `json:"shell"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}

	session, err := s.execfs.StartCommand(r.Context(), workspaceID, execfs.StartCommandInput{
		Command: request.Command,
		Mode:    request.Mode,
		Shell:   request.Shell,
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, session)
}

func (s *Server) handleListCommandSessions(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	writeJSON(w, http.StatusOK, s.execfs.ListCommandSessionsForClient(workspaceID))
}

func (s *Server) handleClearCompletedCommandSessions(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	removed := s.execfs.ClearCompletedCommandSessions(workspaceID)
	writeJSON(w, http.StatusOK, map[string]any{
		"removedProcessIds": removed,
		"status":            "accepted",
	})
}

func (s *Server) handleCloseCommandSession(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	processID := chi.URLParam(r, "processId")
	if err := s.execfs.CloseCommandSession(r.Context(), workspaceID, processID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handlePinCommandSession(w http.ResponseWriter, r *http.Request) {
	s.handleSetCommandSessionPinned(w, r, true)
}

func (s *Server) handleArchiveCommandSession(w http.ResponseWriter, r *http.Request) {
	s.handleSetCommandSessionArchived(w, r, true)
}

func (s *Server) handleUnpinCommandSession(w http.ResponseWriter, r *http.Request) {
	s.handleSetCommandSessionPinned(w, r, false)
}

func (s *Server) handleUnarchiveCommandSession(w http.ResponseWriter, r *http.Request) {
	s.handleSetCommandSessionArchived(w, r, false)
}

func (s *Server) handleSetCommandSessionPinned(
	w http.ResponseWriter,
	r *http.Request,
	pinned bool,
) {
	workspaceID := chi.URLParam(r, "workspaceId")
	processID := chi.URLParam(r, "processId")
	if err := s.execfs.SetCommandSessionPinned(workspaceID, processID, pinned); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"pinned": pinned,
		"status": "accepted",
	})
}

func (s *Server) handleSetCommandSessionArchived(
	w http.ResponseWriter,
	r *http.Request,
	archived bool,
) {
	workspaceID := chi.URLParam(r, "workspaceId")
	processID := chi.URLParam(r, "processId")
	if err := s.execfs.SetCommandSessionArchived(workspaceID, processID, archived); err != nil {
		s.writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"archived": archived,
		"status":   "accepted",
	})
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
	if matchedKey := configfs.MatchingRuntimeSensitiveConfigPrefix(request.KeyPath); matchedKey != "" {
		result.RuntimeReloadRequired = true
		result.MatchedRuntimeSensitiveKey = matchedKey
		if _, markErr := s.workspaces.MarkRuntimeConfigChanged(workspaceID); markErr != nil {
			s.writeStoreError(w, markErr)
			return
		}
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
	if matchedKeys := configfs.MatchingRuntimeSensitiveConfigPrefixes(request.Edits); len(matchedKeys) > 0 {
		result.RuntimeReloadRequired = true
		result.MatchedRuntimeSensitiveKey = matchedKeys[0]
		if _, markErr := s.workspaces.MarkRuntimeConfigChanged(workspaceID); markErr != nil {
			s.writeStoreError(w, markErr)
			return
		}
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

	commandResumeCursors := parseCommandSessionResumeCursors(
		r.URL.Query().Get("commandResumeState"),
	)

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
	diagnostics.LogWorkspaceTrace(
		workspaceID,
		"workspace stream connected",
		"remoteAddr",
		r.RemoteAddr,
	)

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
		diagnostics.LogWorkspaceTrace(workspaceID, "workspace stream bootstrap write failed", "method", "workspace/connected", "error", err)
		return
	}

	if err := conn.WriteJSON(store.EventEnvelope{
		WorkspaceID: workspaceID,
		Method:      "command/exec/stateSnapshot",
		Payload: map[string]any{
			"sessions": s.execfs.ListCommandSessionStateSnapshots(workspaceID),
		},
		ServerRequestID: nil,
		TS:              time.Now().UTC(),
	}); err != nil {
		diagnostics.LogWorkspaceTrace(workspaceID, "workspace stream bootstrap write failed", "method", "command/exec/stateSnapshot", "error", err)
		return
	}

	for _, event := range s.execfs.BuildCommandSessionResumeEvents(workspaceID, commandResumeCursors) {
		if err := conn.WriteJSON(event); err != nil {
			diagnostics.LogWorkspaceTrace(workspaceID, "workspace stream bootstrap write failed", "method", event.Method, "error", err)
			return
		}
	}

	if err := conn.WriteJSON(store.EventEnvelope{
		WorkspaceID: workspaceID,
		Method:      "approvals/snapshot",
		Payload: map[string]any{
			"approvals": s.approvals.List(workspaceID),
		},
		ServerRequestID: nil,
		TS:              time.Now().UTC(),
	}); err != nil {
		diagnostics.LogWorkspaceTrace(workspaceID, "workspace stream bootstrap write failed", "method", "approvals/snapshot", "error", err)
		return
	}

	for {
		select {
		case <-r.Context().Done():
			diagnostics.LogWorkspaceTrace(workspaceID, "workspace stream closed by request context")
			return
		case event, ok := <-eventsCh:
			if !ok {
				diagnostics.LogWorkspaceTrace(workspaceID, "workspace stream closed because subscription ended")
				return
			}

			if diagnostics.ShouldLogEventTrace("workspace stream sending event", event.Method) {
				diagnostics.LogTrace(
					workspaceID,
					event.ThreadID,
					"workspace stream sending event",
					diagnostics.EventTraceAttrs(event.Method, event.TurnID, event.Payload)...,
				)
			}
			if err := conn.WriteJSON(event); err != nil {
				diagnostics.LogTrace(
					workspaceID,
					event.ThreadID,
					"workspace stream write failed",
					append(
						diagnostics.EventTraceAttrs(event.Method, event.TurnID, event.Payload),
						"error",
						err,
					)...,
				)
				return
			}
		}
	}
}

func parseCommandSessionResumeCursors(raw string) []execfs.CommandSessionResumeCursor {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	decoded, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return nil
	}

	var payload struct {
		Sessions []execfs.CommandSessionResumeCursor `json:"sessions"`
	}
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return nil
	}

	const maxResumeSessions = 16
	if len(payload.Sessions) > maxResumeSessions {
		payload.Sessions = payload.Sessions[:maxResumeSessions]
	}

	for index := range payload.Sessions {
		if len(payload.Sessions[index].OutputTail) > 1024 {
			payload.Sessions[index].OutputTail =
				payload.Sessions[index].OutputTail[len(payload.Sessions[index].OutputTail)-1024:]
		}
		if payload.Sessions[index].OutputLength < 0 {
			payload.Sessions[index].OutputLength = 0
		}
	}

	return payload.Sessions
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
	case errors.Is(err, store.ErrBotConnectionNotFound):
		writeError(w, http.StatusNotFound, "bot_connection_not_found", err.Error())
	case errors.Is(err, store.ErrWeChatAccountNotFound):
		writeError(w, http.StatusNotFound, "wechat_account_not_found", err.Error())
	case errors.Is(err, store.ErrBotConversationNotFound):
		writeError(w, http.StatusNotFound, "bot_conversation_not_found", err.Error())
	case errors.Is(err, store.ErrBotInboundDeliveryNotFound):
		writeError(w, http.StatusNotFound, "bot_inbound_delivery_not_found", err.Error())
	case errors.Is(err, bots.ErrWeChatLoginNotFound):
		writeError(w, http.StatusNotFound, "wechat_login_not_found", err.Error())
	case errors.Is(err, execfs.ErrCommandSessionNotFound):
		writeError(w, http.StatusNotFound, "command_session_not_found", err.Error())
	case errors.Is(err, execfs.ErrCommandStartCommandRequired), errors.Is(err, execfs.ErrCommandStartModeInvalid):
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
	case errors.Is(err, automations.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
	case errors.Is(err, bots.ErrInvalidInput), errors.Is(err, bots.ErrPublicBaseURLMissing):
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
	case errors.Is(err, bots.ErrProviderNotSupported), errors.Is(err, bots.ErrAIBackendUnsupported):
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
