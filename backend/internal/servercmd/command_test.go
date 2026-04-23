package servercmd

import (
	"bytes"
	"errors"
	"net"
	"reflect"
	"strings"
	"testing"

	"codex-server/backend/internal/config"
)

func TestParseCommandDefaultsToStart(t *testing.T) {
	t.Parallel()

	command, err := parseCommand(nil)
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command.kind != commandKindServerStart {
		t.Fatalf("parseCommand() = %#v, want server start", command)
	}
}

func TestParseCommandRecognizesStart(t *testing.T) {
	t.Parallel()

	command, err := parseCommand([]string{"start"})
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command.kind != commandKindServerStart {
		t.Fatalf("parseCommand() = %#v, want server start", command)
	}
}

func TestParseCommandRecognizesStop(t *testing.T) {
	t.Parallel()

	command, err := parseCommand([]string{"stop"})
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command.kind != commandKindServerStop {
		t.Fatalf("parseCommand() = %#v, want server stop", command)
	}
}

func TestParseCommandRecognizesServerStart(t *testing.T) {
	t.Parallel()

	command, err := parseCommand([]string{"server", "start"})
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command.kind != commandKindServerStart {
		t.Fatalf("parseCommand() = %#v, want server start", command)
	}
}

func TestParseCommandRecognizesServerStop(t *testing.T) {
	t.Parallel()

	command, err := parseCommand([]string{"server", "stop"})
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command.kind != commandKindServerStop {
		t.Fatalf("parseCommand() = %#v, want server stop", command)
	}
}

func TestParseCommandRecognizesDoctor(t *testing.T) {
	t.Parallel()

	command, err := parseCommand([]string{"doctor"})
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command.kind != commandKindDoctor {
		t.Fatalf("parseCommand() = %#v, want doctor", command)
	}
}

func TestMainDoctorPrintsInstallHintWhenCodexMissing(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
	})

	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		return codexDoctorReport{}, &codexDoctorError{
			message:     "codex CLI was not found in PATH",
			installHint: codexInstallCommand,
		}
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"doctor"}, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Main(doctor) exit code = %d, want 1", exitCode)
	}
	if stdout.Len() != 0 {
		t.Fatalf("Main(doctor) stdout = %q, want empty", stdout.String())
	}
	if got := stderr.String(); !strings.Contains(got, codexInstallCommand) {
		t.Fatalf("Main(doctor) stderr = %q, want install hint", got)
	}
}

func TestMainServerStartRunsDoctorBeforeConfigAndServer(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	originalConfig := configFromEnvFunc
	originalRun := runServerFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
		configFromEnvFunc = originalConfig
		runServerFunc = originalRun
	})

	callOrder := make([]string, 0, 3)
	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		callOrder = append(callOrder, "doctor")
		return codexDoctorReport{
			ExecutablePath: "/usr/bin/codex",
			Version:        "codex 0.1.0",
		}, nil
	}
	configFromEnvFunc = func() (config.Config, error) {
		callOrder = append(callOrder, "config")
		return config.Config{}, nil
	}
	runServerFunc = func(config.Config) error {
		callOrder = append(callOrder, "run")
		return nil
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"server", "start"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Main(server start) exit code = %d, stderr = %q", exitCode, stderr.String())
	}
	if got := stdout.String(); got != "" {
		t.Fatalf("Main(server start) stdout = %q, want empty", got)
	}
	if got := stderr.String(); got != "" {
		t.Fatalf("Main(server start) stderr = %q, want empty", got)
	}

	wantOrder := []string{"doctor", "config", "run"}
	if !reflect.DeepEqual(callOrder, wantOrder) {
		t.Fatalf("call order = %#v, want %#v", callOrder, wantOrder)
	}
}

func TestMainServerStartStopsWhenDoctorFails(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	originalConfig := configFromEnvFunc
	originalRun := runServerFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
		configFromEnvFunc = originalConfig
		runServerFunc = originalRun
	})

	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		return codexDoctorReport{}, errors.New("codex not available")
	}
	configFromEnvFunc = func() (config.Config, error) {
		t.Fatal("configFromEnvFunc should not be called when doctor fails")
		return config.Config{}, nil
	}
	runServerFunc = func(config.Config) error {
		t.Fatal("runServerFunc should not be called when doctor fails")
		return nil
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"start"}, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Main(start) exit code = %d, want 1", exitCode)
	}
	if stdout.Len() != 0 {
		t.Fatalf("Main(start) stdout = %q, want empty", stdout.String())
	}
	if got := stderr.String(); !strings.Contains(got, "codex not available") {
		t.Fatalf("Main(start) stderr = %q, want doctor failure", got)
	}
}

func TestRunStopTreatsAlreadyStoppedAsSuccess(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen() error = %v", err)
	}
	addr := listener.Addr().String()
	if closeErr := listener.Close(); closeErr != nil {
		t.Fatalf("listener.Close() error = %v", closeErr)
	}

	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("SplitHostPort(%q) error = %v", addr, err)
	}
	if host == "" || port == "" {
		t.Fatalf("unexpected listen address %q", addr)
	}

	t.Setenv("CODEX_SERVER_ADDR", ":"+port)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"stop"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Main(stop) exit code = %d, stderr = %q", exitCode, stderr.String())
	}

	if got := stdout.String(); !strings.Contains(got, "already stopped") {
		t.Fatalf("Main(stop) stdout = %q, want already stopped message", got)
	}
	if stderr.Len() != 0 {
		t.Fatalf("Main(stop) stderr = %q, want empty", stderr.String())
	}
}

func TestExtractListenPortHandlesCommonForms(t *testing.T) {
	t.Parallel()

	testCases := map[string]string{
		":18080":          "18080",
		"18080":           "18080",
		"127.0.0.1:18080": "18080",
		"localhost:18080": "18080",
		"[::]:18080":      "18080",
	}

	for input, want := range testCases {
		got, err := extractListenPort(input)
		if err != nil {
			t.Fatalf("extractListenPort(%q) error = %v", input, err)
		}
		if got != want {
			t.Fatalf("extractListenPort(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestBuildLoopbackURLsUsesLoopbackHosts(t *testing.T) {
	t.Parallel()

	got := buildLoopbackURLs(":18080", stopEndpointPath)
	want := []string{
		"http://127.0.0.1:18080/__admin/stop",
		"http://localhost:18080/__admin/stop",
		"http://[::1]:18080/__admin/stop",
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("buildLoopbackURLs() = %#v, want %#v", got, want)
	}
}

func TestParseWindowsNetstatPIDsFiltersListeningPort(t *testing.T) {
	t.Parallel()

	output := `
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:18080          0.0.0.0:0              LISTENING       35732
  TCP    [::]:18080             [::]:0                 LISTENING       35732
  TCP    127.0.0.1:9229         0.0.0.0:0              LISTENING       41200
  TCP    127.0.0.1:18080        127.0.0.1:52311        ESTABLISHED     35732
`

	got := parseWindowsNetstatPIDs(output, "18080")
	want := []int{35732}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseWindowsNetstatPIDs() = %#v, want %#v", got, want)
	}
}
