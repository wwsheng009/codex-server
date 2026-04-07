package servercmd

import (
	"fmt"
	"io"
	"os"
	"strings"

	"codex-server/backend/internal/config"
)

const defaultServerAddr = ":18080"

type stopOutcome string

const (
	stopOutcomeRequested      stopOutcome = "requested"
	stopOutcomeAlreadyStopped stopOutcome = "already_stopped"
)

func Main(args []string, stdout io.Writer, stderr io.Writer) int {
	command, err := parseCommand(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		writeUsage(stderr)
		return 2
	}

	switch command {
	case "help":
		writeUsage(stdout)
		return 0
	case "stop":
		addr := serverAddrFromEnv()
		outcome, err := stopServer(addr)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		switch outcome {
		case stopOutcomeAlreadyStopped:
			fmt.Fprintf(stdout, "codex-server backend is already stopped on %s\n", addr)
		default:
			fmt.Fprintf(stdout, "requested codex-server backend shutdown on %s\n", addr)
		}
		return 0
	default:
		cfg, err := config.FromEnv()
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := runServer(cfg); err != nil {
			return 1
		}
		return 0
	}
}

func parseCommand(args []string) (string, error) {
	if len(args) == 0 {
		return "start", nil
	}

	command := strings.ToLower(strings.TrimSpace(args[0]))
	switch command {
	case "", "start":
		if len(args) > 1 {
			return "", fmt.Errorf("start does not accept additional arguments")
		}
		return "start", nil
	case "stop":
		if len(args) > 1 {
			return "", fmt.Errorf("stop does not accept additional arguments")
		}
		return "stop", nil
	case "help", "-h", "--help":
		if len(args) > 1 {
			return "", fmt.Errorf("help does not accept additional arguments")
		}
		return "help", nil
	default:
		return "", fmt.Errorf("unknown command %q", args[0])
	}
}

func writeUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  main.exe start")
	fmt.Fprintln(w, "  main.exe stop")
	fmt.Fprintln(w, "  main.exe help")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "If no command is provided, the backend starts normally.")
}

func serverAddrFromEnv() string {
	addr := strings.TrimSpace(os.Getenv("CODEX_SERVER_ADDR"))
	if addr == "" {
		return defaultServerAddr
	}
	return addr
}
