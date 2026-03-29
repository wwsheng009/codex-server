package logging

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Config struct {
	LogPath string
}

type Runtime struct {
	Logger    *slog.Logger
	closeFile func() error
	closeOnce sync.Once
	closeErr  error
}

func Configure(cfg Config) (*Runtime, error) {
	writer := io.Writer(os.Stdout)
	closeFile := func() error { return nil }

	logPath := strings.TrimSpace(cfg.LogPath)
	if logPath != "" {
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
			return nil, err
		}

		file, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, err
		}
		writer = io.MultiWriter(os.Stdout, file)
		closeFile = file.Close
	}

	logger := slog.New(slog.NewTextHandler(writer, nil))
	slog.SetDefault(logger)

	return &Runtime{
		Logger:    logger,
		closeFile: closeFile,
	}, nil
}

func (r *Runtime) Close() error {
	if r == nil || r.closeFile == nil {
		return nil
	}
	r.closeOnce.Do(func() {
		r.closeErr = r.closeFile()
	})
	return r.closeErr
}
