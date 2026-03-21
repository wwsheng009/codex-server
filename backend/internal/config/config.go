package config

import "os"

type Config struct {
	Addr           string
	FrontendOrigin string
	CodexCommand   string
	StorePath      string
}

func FromEnv() Config {
	return Config{
		Addr:           getEnv("CODEX_SERVER_ADDR", ":18080"),
		FrontendOrigin: getEnv("CODEX_FRONTEND_ORIGIN", "http://0.0.0.0:15173"),
		CodexCommand:   getEnv("CODEX_APP_SERVER_COMMAND", "codex app-server --listen stdio://"),
		StorePath:      getEnv("CODEX_SERVER_STORE_PATH", "data/metadata.json"),
	}
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}
