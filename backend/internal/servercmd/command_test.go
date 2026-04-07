package servercmd

import (
	"bytes"
	"net"
	"reflect"
	"strings"
	"testing"
)

func TestParseCommandDefaultsToStart(t *testing.T) {
	t.Parallel()

	command, err := parseCommand(nil)
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command != "start" {
		t.Fatalf("parseCommand() = %q, want %q", command, "start")
	}
}

func TestParseCommandRecognizesStart(t *testing.T) {
	t.Parallel()

	command, err := parseCommand([]string{"start"})
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command != "start" {
		t.Fatalf("parseCommand() = %q, want %q", command, "start")
	}
}

func TestParseCommandRecognizesStop(t *testing.T) {
	t.Parallel()

	command, err := parseCommand([]string{"stop"})
	if err != nil {
		t.Fatalf("parseCommand() error = %v", err)
	}
	if command != "stop" {
		t.Fatalf("parseCommand() = %q, want %q", command, "stop")
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
