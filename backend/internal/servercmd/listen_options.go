package servercmd

import (
	"flag"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
)

type serverAddressOptions struct {
	Addr string
	Host string
	Port string
}

func (options serverAddressOptions) hasOverride() bool {
	return strings.TrimSpace(options.Addr) != "" ||
		strings.TrimSpace(options.Host) != "" ||
		strings.TrimSpace(options.Port) != ""
}

func parseServerAddressArgs(commandName string, args []string, allowHost bool) (serverAddressOptions, error) {
	var options serverAddressOptions

	flags := flag.NewFlagSet(commandName, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.Addr, "addr", "", "listen address override")
	flags.StringVar(&options.Addr, "a", "", "listen address override")
	if allowHost {
		flags.StringVar(&options.Host, "host", "", "listen host override")
	}
	flags.StringVar(&options.Port, "port", "", "listen port override")
	flags.StringVar(&options.Port, "p", "", "listen port override")

	if err := flags.Parse(args); err != nil {
		return serverAddressOptions{}, err
	}
	if flags.NArg() > 0 {
		return serverAddressOptions{}, fmt.Errorf("%s does not accept positional arguments", commandName)
	}

	return normalizeServerAddressOptions(options)
}

func normalizeServerAddressOptions(options serverAddressOptions) (serverAddressOptions, error) {
	options.Addr = strings.TrimSpace(options.Addr)
	options.Host = strings.TrimSpace(options.Host)
	options.Port = strings.TrimSpace(options.Port)

	if options.Addr != "" {
		normalizedAddr, err := normalizeListenAddr(options.Addr)
		if err != nil {
			return serverAddressOptions{}, err
		}
		options.Addr = normalizedAddr
	}
	if options.Host != "" {
		host, err := normalizeListenHost(options.Host)
		if err != nil {
			return serverAddressOptions{}, err
		}
		options.Host = host
	}
	if options.Port != "" {
		port, err := normalizeTCPPort("--port", options.Port)
		if err != nil {
			return serverAddressOptions{}, err
		}
		options.Port = port
	}

	return options, nil
}

func applyServerAddressOptions(baseAddr string, options serverAddressOptions) (string, error) {
	normalizedOptions, err := normalizeServerAddressOptions(options)
	if err != nil {
		return "", err
	}
	options = normalizedOptions

	addr := strings.TrimSpace(baseAddr)
	if options.Addr != "" {
		addr = options.Addr
	}
	if addr == "" {
		addr = defaultServerAddr
	}

	host, port, err := splitListenAddr(addr)
	if err != nil {
		return "", err
	}
	if options.Host != "" {
		host = options.Host
	}
	if options.Port != "" {
		port = options.Port
	}

	return joinListenAddr(host, port), nil
}

func normalizeListenAddr(addr string) (string, error) {
	host, port, err := splitListenAddr(addr)
	if err != nil {
		return "", err
	}
	return joinListenAddr(host, port), nil
}

func splitListenAddr(addr string) (string, string, error) {
	trimmed := strings.TrimSpace(addr)
	if trimmed == "" {
		return "", "", fmt.Errorf("server listen address is empty")
	}
	if strings.Contains(trimmed, "://") {
		return "", "", fmt.Errorf("server listen address %q must not include a URL scheme", addr)
	}

	if strings.HasPrefix(trimmed, ":") {
		port, err := normalizeTCPPort("listen address port", strings.TrimPrefix(trimmed, ":"))
		if err != nil {
			return "", "", err
		}
		return "", port, nil
	}

	if isNumericPort(trimmed) {
		port, err := normalizeTCPPort("listen address port", trimmed)
		if err != nil {
			return "", "", err
		}
		return "", port, nil
	}

	host, port, err := net.SplitHostPort(trimmed)
	if err != nil {
		return "", "", fmt.Errorf("invalid server listen address %q: use :<port>, <host>:<port>, or [<ipv6>]:<port>", addr)
	}
	host, err = normalizeListenHost(host)
	if err != nil {
		return "", "", err
	}
	port, err = normalizeTCPPort("listen address port", port)
	if err != nil {
		return "", "", err
	}
	return host, port, nil
}

func normalizeListenHost(host string) (string, error) {
	trimmed := strings.TrimSpace(host)
	if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
		trimmed = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(trimmed, "["), "]"))
	}
	if trimmed == "" {
		return "", fmt.Errorf("listen host must not be empty")
	}
	if strings.Contains(trimmed, "://") || strings.ContainsAny(trimmed, `/\`) {
		return "", fmt.Errorf("invalid listen host %q", host)
	}
	return trimmed, nil
}

func normalizeTCPPort(label string, value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if !isNumericPort(trimmed) {
		return "", fmt.Errorf("invalid %s value %q: must be a numeric TCP port", label, value)
	}

	port, err := strconv.Atoi(trimmed)
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("invalid %s value %q: must be between 1 and 65535", label, value)
	}
	return strconv.Itoa(port), nil
}

func joinListenAddr(host string, port string) string {
	if strings.TrimSpace(host) == "" {
		return ":" + port
	}
	return net.JoinHostPort(host, port)
}
