package main

import (
	"codex-server/backend/internal/servercmd"
	"os"
)

func main() {
	os.Exit(servercmd.Main(os.Args[1:], os.Stdout, os.Stderr))
}
