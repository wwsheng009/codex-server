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
	kind                     commandKind
	serverStartOptions       serverAddressOptions
	serverStopOptions        serverAddressOptions
	accessTokenAddOptions    accessTokenAddOptions
	accessTokenDeleteOptions accessTokenDeleteOptions
	accessTokenListOptions   accessTokenListOptions
}

const (
	stopOutcomeRequested      stopOutcome = "requested"
	stopOutcomeAlreadyStopped stopOutcome = "already_stopped"

	commandKindServerStart       commandKind = "server_start"
	commandKindServerStop        commandKind = "server_stop"
	commandKindDoctor            commandKind = "doctor"
	commandKindAccessTokenAdd    commandKind = "access_token_add"
	commandKindAccessTokenDelete commandKind = "access_token_delete"
	commandKindAccessTokenList   commandKind = "access_token_list"
	commandKindHelp              commandKind = "help"
)

var (
	configFromEnvFunc     = config.FromEnv
	runServerFunc         = runServer
	stopServerFunc        = stopServer
	checkCodexCLIFunc     = checkCodexCLI
	addAccessTokenFunc    = addAccessToken
	deleteAccessTokenFunc = deleteAccessToken
	listAccessTokensFunc  = listAccessTokens
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
	case commandKindAccessTokenAdd:
		if err := addAccessTokenFunc(command.accessTokenAddOptions, stdout); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case commandKindAccessTokenDelete:
		if err := deleteAccessTokenFunc(command.accessTokenDeleteOptions, stdout); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case commandKindAccessTokenList:
		if err := listAccessTokensFunc(command.accessTokenListOptions, stdout); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case commandKindServerStop:
		addr := serverAddrFromEnv()
		if command.serverStopOptions.hasOverride() {
			resolvedAddr, err := applyServerAddressOptions(addr, command.serverStopOptions)
			if err != nil {
				fmt.Fprintln(stderr, err)
				return 1
			}
			addr = resolvedAddr
		}
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
		if command.serverStartOptions.hasOverride() {
			resolvedAddr, err := applyServerAddressOptions(cfg.Addr, command.serverStartOptions)
			if err != nil {
				fmt.Fprintln(stderr, err)
				return 1
			}
			cfg.Addr = resolvedAddr
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
	if isHelpArgs(args) {
		return parsedCommand{kind: commandKindHelp}, nil
	}
	if strings.HasPrefix(strings.TrimSpace(args[0]), "-") {
		options, err := parseServerAddressArgs("server start", args, true)
		if err != nil {
			return parsedCommand{}, err
		}
		return parsedCommand{
			kind:               commandKindServerStart,
			serverStartOptions: options,
		}, nil
	}

	command := normalizeCommandToken(args[0])
	switch command {
	case "", "start":
		if isHelpArgs(args[1:]) {
			return parsedCommand{kind: commandKindHelp}, nil
		}
		options, err := parseServerAddressArgs("start", args[1:], true)
		if err != nil {
			return parsedCommand{}, err
		}
		return parsedCommand{
			kind:               commandKindServerStart,
			serverStartOptions: options,
		}, nil
	case "stop":
		if isHelpArgs(args[1:]) {
			return parsedCommand{kind: commandKindHelp}, nil
		}
		options, err := parseServerAddressArgs("stop", args[1:], false)
		if err != nil {
			return parsedCommand{}, err
		}
		return parsedCommand{
			kind:              commandKindServerStop,
			serverStopOptions: options,
		}, nil
	case "doctor":
		if len(args) > 1 {
			return parsedCommand{}, fmt.Errorf("doctor does not accept additional arguments")
		}
		return parsedCommand{kind: commandKindDoctor}, nil
	case "access-token", "token":
		if len(args) == 1 {
			return parsedCommand{}, fmt.Errorf("%s requires a subcommand", args[0])
		}
		subcommand := normalizeCommandToken(args[1])
		switch subcommand {
		case "add", "create":
			options, err := parseAccessTokenAddArgs(args[2:])
			if err != nil {
				return parsedCommand{}, err
			}
			return parsedCommand{
				kind:                  commandKindAccessTokenAdd,
				accessTokenAddOptions: options,
			}, nil
		case "delete", "remove", "rm":
			options, err := parseAccessTokenDeleteArgs(args[2:])
			if err != nil {
				return parsedCommand{}, err
			}
			return parsedCommand{
				kind:                     commandKindAccessTokenDelete,
				accessTokenDeleteOptions: options,
			}, nil
		case "list", "ls":
			options, err := parseAccessTokenListArgs(args[2:])
			if err != nil {
				return parsedCommand{}, err
			}
			return parsedCommand{
				kind:                   commandKindAccessTokenList,
				accessTokenListOptions: options,
			}, nil
		case "help", "-h", "--help":
			if len(args) > 2 {
				return parsedCommand{}, fmt.Errorf("%s help does not accept additional arguments", args[0])
			}
			return parsedCommand{kind: commandKindHelp}, nil
		default:
			return parsedCommand{}, fmt.Errorf("unknown %s subcommand %q", args[0], args[1])
		}
	case "server":
		if len(args) == 1 {
			return parsedCommand{kind: commandKindServerStart}, nil
		}
		if strings.HasPrefix(strings.TrimSpace(args[1]), "-") {
			if isHelpArgs(args[1:]) {
				return parsedCommand{kind: commandKindHelp}, nil
			}
			options, err := parseServerAddressArgs("server start", args[1:], true)
			if err != nil {
				return parsedCommand{}, err
			}
			return parsedCommand{
				kind:               commandKindServerStart,
				serverStartOptions: options,
			}, nil
		}
		subcommand := normalizeCommandToken(args[1])
		switch subcommand {
		case "", "start":
			if isHelpArgs(args[2:]) {
				return parsedCommand{kind: commandKindHelp}, nil
			}
			options, err := parseServerAddressArgs("server start", args[2:], true)
			if err != nil {
				return parsedCommand{}, err
			}
			return parsedCommand{
				kind:               commandKindServerStart,
				serverStartOptions: options,
			}, nil
		case "stop":
			if isHelpArgs(args[2:]) {
				return parsedCommand{kind: commandKindHelp}, nil
			}
			options, err := parseServerAddressArgs("server stop", args[2:], false)
			if err != nil {
				return parsedCommand{}, err
			}
			return parsedCommand{
				kind:              commandKindServerStop,
				serverStopOptions: options,
			}, nil
		case "doctor":
			if len(args) > 2 {
				return parsedCommand{}, fmt.Errorf("server doctor does not accept additional arguments")
			}
			return parsedCommand{kind: commandKindDoctor}, nil
		case "access-token", "token":
			if len(args) < 3 {
				return parsedCommand{}, fmt.Errorf("server %s requires a subcommand", args[1])
			}
			tokenSubcommand := normalizeCommandToken(args[2])
			switch tokenSubcommand {
			case "add", "create":
				options, err := parseAccessTokenAddArgs(args[3:])
				if err != nil {
					return parsedCommand{}, err
				}
				return parsedCommand{
					kind:                  commandKindAccessTokenAdd,
					accessTokenAddOptions: options,
				}, nil
			case "delete", "remove", "rm":
				options, err := parseAccessTokenDeleteArgs(args[3:])
				if err != nil {
					return parsedCommand{}, err
				}
				return parsedCommand{
					kind:                     commandKindAccessTokenDelete,
					accessTokenDeleteOptions: options,
				}, nil
			case "list", "ls":
				options, err := parseAccessTokenListArgs(args[3:])
				if err != nil {
					return parsedCommand{}, err
				}
				return parsedCommand{
					kind:                   commandKindAccessTokenList,
					accessTokenListOptions: options,
				}, nil
			case "help", "-h", "--help":
				if len(args) > 3 {
					return parsedCommand{}, fmt.Errorf("server %s help does not accept additional arguments", args[1])
				}
				return parsedCommand{kind: commandKindHelp}, nil
			default:
				return parsedCommand{}, fmt.Errorf("unknown server %s subcommand %q", args[1], args[2])
			}
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
	fmt.Fprintln(w, "  main.exe server start [--addr <addr>] [--host <host>] [--port <port>]")
	fmt.Fprintln(w, "  main.exe server stop [--addr <addr>] [--port <port>]")
	fmt.Fprintln(w, "  main.exe doctor")
	fmt.Fprintln(w, "  main.exe access-token add [--label <name>] [--ttl <duration> | --expires-at <rfc3339>] [--store-path <path>] [--json | --quiet]")
	fmt.Fprintln(w, "  main.exe access-token delete <id> [--store-path <path>] [--json]")
	fmt.Fprintln(w, "  main.exe access-token list [--store-path <path>] [--json]")
	fmt.Fprintln(w, "  main.exe start [--addr <addr>] [--host <host>] [--port <port>]")
	fmt.Fprintln(w, "  main.exe stop [--addr <addr>] [--port <port>]")
	fmt.Fprintln(w, "  main.exe help")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Start/stop address options:")
	fmt.Fprintln(w, "  --port, -p <port>  Override the listen port, for example 19999.")
	fmt.Fprintln(w, "  --host <host>      Override the listen host for start, for example 127.0.0.1 or 0.0.0.0.")
	fmt.Fprintln(w, "  --addr, -a <addr>  Override the full listen address, for example :19999 or 127.0.0.1:19999.")
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

func isHelpArgs(args []string) bool {
	if len(args) != 1 {
		return false
	}
	switch normalizeCommandToken(args[0]) {
	case "help", "-h", "--help":
		return true
	default:
		return false
	}
}
