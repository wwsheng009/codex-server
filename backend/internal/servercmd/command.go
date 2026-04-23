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

type commandKind string

type parsedCommand struct {
	kind commandKind
}

const (
	stopOutcomeRequested      stopOutcome = "requested"
	stopOutcomeAlreadyStopped stopOutcome = "already_stopped"

	commandKindServerStart commandKind = "server_start"
	commandKindServerStop  commandKind = "server_stop"
	commandKindDoctor      commandKind = "doctor"
	commandKindHelp        commandKind = "help"
)

var (
	configFromEnvFunc = config.FromEnv
	runServerFunc     = runServer
	stopServerFunc    = stopServer
	checkCodexCLIFunc = checkCodexCLI
)

func Main(args []string, stdout io.Writer, stderr io.Writer) int {
	command, err := parseCommand(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		writeUsage(stderr)
		return 2
	}

	switch command.kind {
	case commandKindHelp:
		writeUsage(stdout)
		return 0
	case commandKindDoctor:
		report, err := checkCodexCLIFunc()
		if err != nil {
			writeDoctorFailure(stderr, report, err)
			return 1
		}
		writeDoctorSuccess(stdout, report)
		return 0
	case commandKindServerStop:
		addr := serverAddrFromEnv()
		outcome, err := stopServerFunc(addr)
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
		report, err := checkCodexCLIFunc()
		if err != nil {
			writeDoctorFailure(stderr, report, err)
			return 1
		}

		cfg, err := configFromEnvFunc()
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := runServerFunc(cfg); err != nil {
			return 1
		}
		return 0
	}
}

func parseCommand(args []string) (parsedCommand, error) {
	if len(args) == 0 {
		return parsedCommand{kind: commandKindServerStart}, nil
	}

	command := normalizeCommandToken(args[0])
	switch command {
	case "", "start":
		if len(args) > 1 {
			return parsedCommand{}, fmt.Errorf("start does not accept additional arguments")
		}
		return parsedCommand{kind: commandKindServerStart}, nil
	case "stop":
		if len(args) > 1 {
			return parsedCommand{}, fmt.Errorf("stop does not accept additional arguments")
		}
		return parsedCommand{kind: commandKindServerStop}, nil
	case "doctor":
		if len(args) > 1 {
			return parsedCommand{}, fmt.Errorf("doctor does not accept additional arguments")
		}
		return parsedCommand{kind: commandKindDoctor}, nil
	case "server":
		if len(args) == 1 {
			return parsedCommand{kind: commandKindServerStart}, nil
		}
		subcommand := normalizeCommandToken(args[1])
		switch subcommand {
		case "", "start":
			if len(args) > 2 {
				return parsedCommand{}, fmt.Errorf("server start does not accept additional arguments")
			}
			return parsedCommand{kind: commandKindServerStart}, nil
		case "stop":
			if len(args) > 2 {
				return parsedCommand{}, fmt.Errorf("server stop does not accept additional arguments")
			}
			return parsedCommand{kind: commandKindServerStop}, nil
		case "doctor":
			if len(args) > 2 {
				return parsedCommand{}, fmt.Errorf("server doctor does not accept additional arguments")
			}
			return parsedCommand{kind: commandKindDoctor}, nil
		case "help", "-h", "--help":
			if len(args) > 2 {
				return parsedCommand{}, fmt.Errorf("server help does not accept additional arguments")
			}
			return parsedCommand{kind: commandKindHelp}, nil
		default:
			return parsedCommand{}, fmt.Errorf("unknown server subcommand %q", args[1])
		}
	case "help", "-h", "--help":
		if len(args) > 1 {
			return parsedCommand{}, fmt.Errorf("help does not accept additional arguments")
		}
		return parsedCommand{kind: commandKindHelp}, nil
	default:
		return parsedCommand{}, fmt.Errorf("unknown command %q", args[0])
	}
}

func writeUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  main.exe server start")
	fmt.Fprintln(w, "  main.exe server stop")
	fmt.Fprintln(w, "  main.exe doctor")
	fmt.Fprintln(w, "  main.exe start")
	fmt.Fprintln(w, "  main.exe stop")
	fmt.Fprintln(w, "  main.exe help")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Legacy start/stop commands remain available for compatibility.")
	fmt.Fprintln(w, "If no command is provided, the backend starts normally.")
}

func serverAddrFromEnv() string {
	addr := strings.TrimSpace(os.Getenv("CODEX_SERVER_ADDR"))
	if addr == "" {
		return defaultServerAddr
	}
	return addr
}

func normalizeCommandToken(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
