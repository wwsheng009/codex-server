package servercmd

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	goruntime "runtime"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"codex-server/backend/internal/accesscontrol"
	"codex-server/backend/internal/api"
	"codex-server/backend/internal/approvals"
	"codex-server/backend/internal/auth"
	"codex-server/backend/internal/automations"
	"codex-server/backend/internal/bots"
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/config"
	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/execfs"
	"codex-server/backend/internal/feedback"
	"codex-server/backend/internal/hooks"
	"codex-server/backend/internal/logging"
	"codex-server/backend/internal/memorydiag"
	"codex-server/backend/internal/notifications"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/runtimeprefs"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turnpolicies"
	"codex-server/backend/internal/turns"
	"codex-server/backend/internal/workspace"
)

func runServer(cfg config.Config) error {
	logRuntime, err := logging.Configure(logging.Config{
		LogPath: cfg.LogPath,
	})
	if err != nil {
		return err
	}
	defer func() {
		_ = logRuntime.Close()
	}()
	logger := logRuntime.Logger

	dataStore, err := store.NewPersistentStore(cfg.StorePath)
	if err != nil {
		return err
	}
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	runtimePrefsStore := dataStore.GetRuntimePreferences()
	resolvedRuntime, err := config.ResolveCodexRuntime(cfg.BaseCodexCommand, config.RuntimePreferences{
		ModelCatalogPath: fallbackRuntimePreference(
			runtimePrefsStore.ModelCatalogPath,
			cfg.CodexModelCatalogJSON,
		),
		LocalShellModels: fallbackRuntimePreferenceSlice(
			runtimePrefsStore.LocalShellModels,
			cfg.CodexLocalShellModels,
		),
	})
	if err != nil {
		return err
	}
	runtimeManager := runtime.NewManager(resolvedRuntime.Command, eventHub)
	runtimePrefsService := runtimeprefs.NewService(
		dataStore,
		runtimeManager,
		cfg.BaseCodexCommand,
		cfg.CodexModelCatalogJSON,
		cfg.CodexLocalShellModels,
		cfg.OutboundProxyURL,
		cfg.AllowRemoteAccess,
		cfg.TraceThreadPipeline,
		cfg.TraceWorkspaceID,
		cfg.TraceThreadID,
	)
	runtimePrefsState, err := runtimePrefsService.Read()
	if err != nil {
		return err
	}

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	hookService := hooks.NewService(dataStore, turnService, eventHub)
	botService := bots.NewService(dataStore, threadService, hooks.NewGovernedTurnStarter(hookService, "bot/webhook", "thread"), eventHub, bots.Config{
		PublicBaseURL:    cfg.PublicBaseURL,
		OutboundProxyURL: cfg.OutboundProxyURL,
		MessageTimeout:   cfg.BotMessageTimeout,
		PollInterval:     cfg.BotPollInterval,
		TurnTimeout:      cfg.BotTurnTimeout,
	})
	automationService := automations.NewService(
		dataStore,
		threadService,
		hooks.NewGovernedTurnStarter(hookService, "automation/run", "thread"),
		eventHub,
	)
	turnPolicyService := turnpolicies.NewService(dataStore, turnService, eventHub)
	runtimeManager.SetServerRequestInterceptor(hookService)
	notificationsService := notifications.NewService(dataStore)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	catalogService := catalog.NewService(runtimeManager, runtimePrefsService)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub, dataStore)
	memoryDiagService := memorydiag.NewService(dataStore)
	accessControlService := accesscontrol.NewService(dataStore, cfg.AllowRemoteAccess)

	serviceCtx, serviceCancel := context.WithCancel(context.Background())
	defer serviceCancel()
	automationService.Start(serviceCtx)
	botService.Start(serviceCtx)
	turnPolicyService.SetHooksPrimary(true)
	hookService.Start(serviceCtx)
	turnPolicyService.Start(serviceCtx)

	if len(workspaceService.List()) == 0 {
		_, _ = workspaceService.Create("Demo Workspace", "E:/projects/ai/codex-server")
	}

	shutdownRequestCh := make(chan string, 1)
	handler := api.NewRouter(api.Dependencies{
		FrontendOrigin:       cfg.FrontendOrigin,
		EnableRequestLogging: cfg.EnableRequestLogging,
		RequestShutdown: func(reason string) bool {
			select {
			case shutdownRequestCh <- reason:
				return true
			default:
				return false
			}
		},
		Auth:              authService,
		Workspaces:        workspaceService,
		Bots:              botService,
		Automations:       automationService,
		Notifications:     notificationsService,
		Hooks:             hookService,
		TurnPolicies:      turnPolicyService,
		Threads:           threadService,
		Turns:             turnService,
		Approvals:         approvalsService,
		Catalog:           catalogService,
		ConfigFS:          configFSService,
		ExecFS:            execfsService,
		Feedback:          feedbackService,
		Events:            eventHub,
		RuntimePrefs:      runtimePrefsService,
		MemoryDiagnostics: memoryDiagService,
		AccessControl:     accessControlService,
	})

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	diagnostics.ConfigureThreadTrace(
		runtimePrefsState.EffectiveBackendThreadTraceEnabled,
		runtimePrefsState.EffectiveBackendThreadTraceWorkspaceID,
		runtimePrefsState.EffectiveBackendThreadTraceThreadID,
	)
	logger.Info("starting codex-server backend", "addr", cfg.Addr)
	if runtimePrefsState.EffectiveBackendThreadTraceEnabled {
		logger.Info(
			"thread pipeline trace logging enabled",
			"workspaceId",
			runtimePrefsState.EffectiveBackendThreadTraceWorkspaceID,
			"threadId",
			runtimePrefsState.EffectiveBackendThreadTraceThreadID,
		)
	}

	errCh := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()
	go func() {
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()

		select {
		case <-serviceCtx.Done():
			return
		case <-timer.C:
		}

		goruntime.GC()
		debug.FreeOSMemory()
	}()

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signalCh)

	select {
	case err := <-errCh:
		if alreadyRunning, attempts := classifyListenFailure(cfg.Addr, err); alreadyRunning {
			logger.Info("codex-server backend already running", "addr", cfg.Addr)
			return nil
		} else if isAddrInUseError(err) {
			logger.Error(
				"backend listen address is already in use",
				"addr",
				cfg.Addr,
				"error",
				err,
				"healthzAttempts",
				joinAttempts(attempts),
			)
			return err
		}
		logger.Error("backend server stopped unexpectedly", "error", err)
		return err
	case sig := <-signalCh:
		logger.Info("shutting down backend server", "signal", sig.String())
	case reason := <-shutdownRequestCh:
		logger.Info("shutting down backend server", "trigger", reason)
	}

	serviceCancel()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("backend shutdown failed", "error", err)
		return err
	}

	return nil
}

func fallbackRuntimePreference(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func fallbackRuntimePreferenceSlice(value []string, fallback []string) []string {
	if len(value) > 0 {
		return append([]string(nil), value...)
	}
	return append([]string(nil), fallback...)
}

func classifyListenFailure(addr string, err error) (bool, []string) {
	if !isAddrInUseError(err) {
		return false, nil
	}

	client := &http.Client{Timeout: stopRequestTimout}
	return identifyCodexBackend(client, addr)
}

func isAddrInUseError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, syscall.EADDRINUSE) {
		return true
	}

	message := strings.ToLower(err.Error())
	return strings.Contains(message, "address already in use") ||
		strings.Contains(message, "only one usage of each socket address")
}
