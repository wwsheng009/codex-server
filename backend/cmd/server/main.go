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
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/config"
	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/execfs"
	"codex-server/backend/internal/feedback"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
	"codex-server/backend/internal/workspace"
)

func main() {
	cfg := config.FromEnv()

	dataStore, err := store.NewPersistentStore(cfg.StorePath)
	if err != nil {
		panic(err)
	}
	eventHub := events.NewHub()
	runtimeManager := runtime.NewManager(cfg.CodexCommand, eventHub)

	authService := auth.NewService(dataStore, runtimeManager)
	approvalsService := approvals.NewService(runtimeManager)
	workspaceService := workspace.NewService(dataStore, runtimeManager)
	threadService := threads.NewService(dataStore, runtimeManager)
	catalogService := catalog.NewService(runtimeManager)
	configFSService := configfs.NewService(runtimeManager)
	feedbackService := feedback.NewService(runtimeManager)
	turnService := turns.NewService(runtimeManager)
	execfsService := execfs.NewService(runtimeManager, eventHub)

	if len(workspaceService.List()) == 0 {
		_, _ = workspaceService.Create("Demo Workspace", "E:/projects/ai/codex-server")
	}

	handler := api.NewRouter(api.Dependencies{
		FrontendOrigin: cfg.FrontendOrigin,
		Auth:           authService,
		Workspaces:     workspaceService,
		Threads:        threadService,
		Turns:          turnService,
		Approvals:      approvalsService,
		Catalog:        catalogService,
		ConfigFS:       configFSService,
		ExecFS:         execfsService,
		Feedback:       feedbackService,
		Events:         eventHub,
	})

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	logger.Info("starting codex-server backend", "addr", cfg.Addr)

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

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("backend shutdown failed", "error", err)
		os.Exit(1)
	}
}
