package servercmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	stopEndpointPath  = "/__admin/stop"
	healthzPath       = "/healthz"
	stopActionHeader  = "X-Codex-Server-Action"
	stopActionValue   = "stop"
	stopRequestTimout = 1500 * time.Millisecond
)

func stopServer(addr string) (stopOutcome, error) {
	port, err := extractListenPort(addr)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: stopRequestTimout}
	stopAttempts := make([]string, 0, 3)
	for _, endpoint := range buildLoopbackURLs(addr, stopEndpointPath) {
		request, err := http.NewRequest(http.MethodPost, endpoint, nil)
		if err != nil {
			stopAttempts = append(stopAttempts, fmt.Sprintf("%s: %v", endpoint, err))
			continue
		}
		request.Header.Set(stopActionHeader, stopActionValue)

		response, err := client.Do(request)
		if err != nil {
			stopAttempts = append(stopAttempts, fmt.Sprintf("%s: %v", endpoint, err))
			continue
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()

		switch response.StatusCode {
		case http.StatusAccepted, http.StatusConflict:
			return stopOutcomeRequested, nil
		default:
			stopAttempts = append(stopAttempts, fmt.Sprintf("%s: http %d", endpoint, response.StatusCode))
		}
	}

	identified, healthAttempts := identifyCodexBackend(client, addr)
	processIDs, processErr := listeningProcessIDs(port)
	if processErr == nil && len(processIDs) == 0 {
		return stopOutcomeAlreadyStopped, nil
	}

	if !identified {
		if processErr != nil {
			return "", fmt.Errorf(
				"failed to stop backend on port %s: graceful stop attempts failed (%s); /healthz did not confirm a codex-server backend (%s); listener check failed: %w",
				port,
				joinAttempts(stopAttempts),
				joinAttempts(healthAttempts),
				processErr,
			)
		}

		return "", fmt.Errorf(
			"failed to stop backend on port %s: graceful stop attempts failed (%s) and /healthz did not confirm a codex-server backend (%s)",
			port,
			joinAttempts(stopAttempts),
			joinAttempts(healthAttempts),
		)
	}

	if processErr != nil {
		return "", fmt.Errorf(
			"failed to stop backend on port %s: graceful stop attempts failed (%s); fallback listener check failed: %w",
			port,
			joinAttempts(stopAttempts),
			processErr,
		)
	}

	if err := killProcesses(processIDs); err != nil {
		return "", fmt.Errorf(
			"failed to stop backend on port %s: graceful stop attempts failed (%s); fallback termination failed: %w",
			port,
			joinAttempts(stopAttempts),
			err,
		)
	}

	return stopOutcomeRequested, nil
}

func identifyCodexBackend(client *http.Client, addr string) (bool, []string) {
	attempts := make([]string, 0, 3)
	for _, endpoint := range buildLoopbackURLs(addr, healthzPath) {
		response, err := client.Get(endpoint)
		if err != nil {
			attempts = append(attempts, fmt.Sprintf("%s: %v", endpoint, err))
			continue
		}

		var payload struct {
			Status string `json:"status"`
		}
		decodeErr := json.NewDecoder(response.Body).Decode(&payload)
		_ = response.Body.Close()

		if response.StatusCode == http.StatusOK && decodeErr == nil && strings.EqualFold(strings.TrimSpace(payload.Status), "ok") {
			return true, attempts
		}

		if decodeErr != nil {
			attempts = append(attempts, fmt.Sprintf("%s: http %d decode %v", endpoint, response.StatusCode, decodeErr))
			continue
		}
		attempts = append(attempts, fmt.Sprintf("%s: http %d status=%q", endpoint, response.StatusCode, payload.Status))
	}

	return false, attempts
}

func buildLoopbackURLs(addr string, path string) []string {
	port, err := extractListenPort(addr)
	if err != nil {
		return nil
	}

	hosts := []string{"127.0.0.1", "localhost", "::1"}
	seen := make(map[string]struct{}, len(hosts))
	urls := make([]string, 0, len(hosts))
	for _, host := range hosts {
		formattedHost := host
		if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
			formattedHost = "[" + host + "]"
		}

		value := "http://" + formattedHost + ":" + port + path
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		urls = append(urls, value)
	}

	return urls
}

func extractListenPort(addr string) (string, error) {
	trimmed := strings.TrimSpace(addr)
	if trimmed == "" {
		return "", errors.New("server listen address is empty")
	}

	if strings.Contains(trimmed, "://") {
		parsed, err := url.Parse(trimmed)
		if err != nil {
			return "", fmt.Errorf("invalid server listen address %q: %w", addr, err)
		}
		trimmed = parsed.Host
	}

	if strings.HasPrefix(trimmed, ":") {
		port := strings.TrimPrefix(trimmed, ":")
		if isNumericPort(port) {
			return port, nil
		}
	}

	if isNumericPort(trimmed) {
		return trimmed, nil
	}

	if _, port, err := net.SplitHostPort(trimmed); err == nil && isNumericPort(port) {
		return port, nil
	}

	lastColon := strings.LastIndex(trimmed, ":")
	if lastColon >= 0 {
		port := trimmed[lastColon+1:]
		if isNumericPort(port) {
			return port, nil
		}
	}

	return "", fmt.Errorf("unable to determine listen port from %q", addr)
}

func isNumericPort(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func killProcesses(processIDs []int) error {
	if len(processIDs) == 0 {
		return errors.New("no listening process was found")
	}

	for _, processID := range processIDs {
		process, err := os.FindProcess(processID)
		if err != nil {
			return fmt.Errorf("locate process %d: %w", processID, err)
		}
		if err := process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return fmt.Errorf("terminate process %d: %w", processID, err)
		}
	}

	return nil
}

func listeningProcessIDs(port string) ([]int, error) {
	switch runtime.GOOS {
	case "windows":
		return windowsListeningProcessIDs(port)
	default:
		return unixListeningProcessIDs(port)
	}
}

func windowsListeningProcessIDs(port string) ([]int, error) {
	output, err := exec.Command("netstat", "-ano", "-p", "tcp").Output()
	if err != nil {
		return nil, fmt.Errorf("query netstat listeners: %w", err)
	}
	return parseWindowsNetstatPIDs(string(output), port), nil
}

func parseWindowsNetstatPIDs(output string, port string) []int {
	lines := strings.Split(output, "\n")
	seen := make(map[int]struct{})
	processIDs := make([]int, 0, 2)

	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		if !strings.HasPrefix(strings.ToUpper(fields[0]), "TCP") {
			continue
		}
		if !strings.EqualFold(fields[3], "LISTENING") {
			continue
		}
		if !strings.HasSuffix(fields[1], ":"+port) {
			continue
		}

		processID, err := strconv.Atoi(fields[4])
		if err != nil {
			continue
		}
		if _, ok := seen[processID]; ok {
			continue
		}
		seen[processID] = struct{}{}
		processIDs = append(processIDs, processID)
	}

	return processIDs
}

func unixListeningProcessIDs(port string) ([]int, error) {
	output, err := exec.Command("lsof", "-nP", "-iTCP:"+port, "-sTCP:LISTEN", "-t").CombinedOutput()
	if err != nil {
		var missing *exec.Error
		if errors.As(err, &missing) {
			return nil, fmt.Errorf("automatic stop fallback requires lsof on %s", runtime.GOOS)
		}
		if exitErr, ok := err.(*exec.ExitError); ok && strings.TrimSpace(string(output)) == "" {
			_ = exitErr
			return nil, nil
		}
		return nil, fmt.Errorf("query lsof listeners: %w", err)
	}

	return parsePIDLines(string(output)), nil
}

func parsePIDLines(output string) []int {
	lines := strings.Split(output, "\n")
	processIDs := make([]int, 0, len(lines))
	seen := make(map[int]struct{}, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		processID, err := strconv.Atoi(trimmed)
		if err != nil {
			continue
		}
		if _, ok := seen[processID]; ok {
			continue
		}
		seen[processID] = struct{}{}
		processIDs = append(processIDs, processID)
	}
	return processIDs
}

func joinAttempts(items []string) string {
	if len(items) == 0 {
		return "no attempts recorded"
	}
	return strings.Join(items, "; ")
}
