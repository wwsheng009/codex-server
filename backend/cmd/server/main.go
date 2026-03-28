package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
	"codex-server/backend/internal/notifications"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/runtimeprefs"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
	"codex-server/backend/internal/workspace"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		panic(err)
	}

	dataStore, err := store.NewPersistentStore(cfg.StorePath)
	if err != nil {
		panic(err)
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
		panic(err)
	}
	runtimeManager := runtime.NewManager(resolvedRuntime.Command, eventHub)
	runtimePrefsService := runtimeprefs.NewService(
		dataStore,
		runtimeManager,
		cfg.BaseCodexCommand,
		cfg.CodexModelCatalogJSON,
		cfg.CodexLocalShellModels,
		cfg.OutboundProxyURL,
		cfg.TraceThreadPipeline,
		cfg.TraceWorkspaceID,
		cfg.TraceThreadID,
	)
	runtimePrefsState, err := runtimePrefsService.Read()
	if err != nil {
		panic(err)
	}

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	turnService := turns.NewService(runtimeManager, dataStore)
	botService := bots.NewService(dataStore, threadService, turnService, eventHub, bots.Config{
		PublicBaseURL:    cfg.PublicBaseURL,
		OutboundProxyURL: cfg.OutboundProxyURL,
		MessageTimeout:   cfg.BotMessageTimeout,
		PollInterval:     cfg.BotPollInterval,
		TurnTimeout:      cfg.BotTurnTimeout,
	})
	automationService := automations.NewService(dataStore, threadService, turnService, eventHub)
	notificationsService := notifications.NewService(dataStore)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	catalogService := catalog.NewService(runtimeManager, runtimePrefsService)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub, dataStore)

	serviceCtx, serviceCancel := context.WithCancel(context.Background())
	defer serviceCancel()
	automationService.Start(serviceCtx)
	botService.Start(serviceCtx)

	if len(workspaceService.List()) == 0 {
		_, _ = workspaceService.Create("Demo Workspace", "E:/projects/ai/codex-server")
	}

	handler := api.NewRouter(api.Dependencies{
		FrontendOrigin:       cfg.FrontendOrigin,
		EnableRequestLogging: cfg.EnableRequestLogging,
		Auth:                 authService,
		Workspaces:           workspaceService,
		Bots:                 botService,
		Automations:          automationService,
		Notifications:        notificationsService,
		Threads:              threadService,
		Turns:                turnService,
		Approvals:            approvalsService,
		Catalog:              catalogService,
		ConfigFS:             configFSService,
		ExecFS:               execfsService,
		Feedback:             feedbackService,
		Events:               eventHub,
		RuntimePrefs:         runtimePrefsService,
	})

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	slog.SetDefault(logger)
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

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-errCh:
		logger.Error("backend server stopped unexpectedly", "error", err)
		os.Exit(1)
	case sig := <-signalCh:
		logger.Info("shutting down backend server", "signal", sig.String())
	}

	serviceCancel()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("backend shutdown failed", "error", err)
		os.Exit(1)
	}
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
