package servercmd

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/accesscontrol"
	"codex-server/backend/internal/store"
)

func TestParseAccessTokenAddArgsRejectsTTLAndExpiryCombination(t *testing.T) {
	t.Parallel()

	_, err := parseAccessTokenAddArgs([]string{
		"--ttl", "1h",
		"--expires-at", "2026-05-01T00:00:00Z",
	})
	if err == nil {
		t.Fatal("parseAccessTokenAddArgs() error = nil, want validation error")
	}
}

func TestParseAccessTokenAddArgsRejectsJSONAndQuietCombination(t *testing.T) {
	t.Parallel()

	_, err := parseAccessTokenAddArgs([]string{
		"--json",
		"--quiet",
	})
	if err == nil {
		t.Fatal("parseAccessTokenAddArgs() error = nil, want validation error")
	}
}

func TestMainAccessTokenAddDoesNotRequireDoctorAndPersistsToken(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
	})

	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		t.Fatal("checkCodexCLIFunc should not be called for access-token add")
		return codexDoctorReport{}, nil
	}

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	t.Setenv("CODEX_SERVER_STORE_PATH", storePath)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"access-token", "add", "--label", "cli-test", "--ttl", "2h"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Main(access-token add) exit code = %d, stderr = %q", exitCode, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("Main(access-token add) stderr = %q, want empty", stderr.String())
	}

	rawToken := outputLineValue(stdout.String(), "token:")
	if rawToken == "" {
		t.Fatalf("Main(access-token add) stdout = %q, want token line", stdout.String())
	}

	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}
	defer func() {
		_ = dataStore.Close()
	}()

	prefs := dataStore.GetRuntimePreferences()
	if len(prefs.AccessTokens) != 1 {
		t.Fatalf("persisted access token count = %d, want 1", len(prefs.AccessTokens))
	}
	if prefs.AccessTokens[0].Label != "cli-test" {
		t.Fatalf("persisted label = %q, want %q", prefs.AccessTokens[0].Label, "cli-test")
	}
	if prefs.AccessTokens[0].ExpiresAt == nil {
		t.Fatal("persisted token expiry = nil, want ttl-backed expiry")
	}
	if _, ok := accesscontrol.MatchActiveToken(rawToken, prefs.AccessTokens, time.Now().UTC()); !ok {
		t.Fatal("persisted token does not match generated raw token")
	}
}

func TestMainAccessTokenAddQuietOutputsOnlyToken(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
	})

	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		t.Fatal("checkCodexCLIFunc should not be called for access-token add --quiet")
		return codexDoctorReport{}, nil
	}

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	t.Setenv("CODEX_SERVER_STORE_PATH", storePath)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"access-token", "add", "--quiet"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Main(access-token add --quiet) exit code = %d, stderr = %q", exitCode, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("Main(access-token add --quiet) stderr = %q, want empty", stderr.String())
	}

	output := strings.TrimSpace(stdout.String())
	if !strings.HasPrefix(output, "cxs_") {
		t.Fatalf("Main(access-token add --quiet) stdout = %q, want raw token only", output)
	}
	if strings.Contains(output, "\n") {
		t.Fatalf("Main(access-token add --quiet) stdout = %q, want single-line token output", output)
	}
}

func TestAddAccessTokenPreservesExistingPreferencesAndTokens(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "metadata.json")

	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}

	existingTokens, err := accesscontrol.ApplyTokenInputs(
		nil,
		[]accesscontrol.TokenInput{{
			Label:     "existing",
			Token:     "cxs_existing_token_1234567890",
			Permanent: true,
		}},
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("accesscontrol.ApplyTokenInputs(existing) error = %v", err)
	}

	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		OutboundProxyURL: "http://127.0.0.1:7890",
		AccessTokens:     existingTokens,
	})
	if err := dataStore.Close(); err != nil {
		t.Fatalf("dataStore.Close() error = %v", err)
	}

	var stdout bytes.Buffer
	if err := addAccessToken(accessTokenAddOptions{
		Label:     "new-token",
		StorePath: storePath,
	}, &stdout); err != nil {
		t.Fatalf("addAccessToken() error = %v", err)
	}

	reloadedStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(reloaded) error = %v", err)
	}
	defer func() {
		_ = reloadedStore.Close()
	}()

	prefs := reloadedStore.GetRuntimePreferences()
	if prefs.OutboundProxyURL != "http://127.0.0.1:7890" {
		t.Fatalf("persisted outbound proxy = %q, want preserved value", prefs.OutboundProxyURL)
	}
	if len(prefs.AccessTokens) != 2 {
		t.Fatalf("persisted access token count = %d, want 2", len(prefs.AccessTokens))
	}

	labels := []string{prefs.AccessTokens[0].Label, prefs.AccessTokens[1].Label}
	if !(containsString(labels, "existing") && containsString(labels, "new-token")) {
		t.Fatalf("persisted labels = %#v, want existing and new-token", labels)
	}
}

func TestAddAccessTokenJSONOutput(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "metadata.json")

	var stdout bytes.Buffer
	if err := addAccessToken(accessTokenAddOptions{
		Label:     "json-token",
		StorePath: storePath,
		JSON:      true,
	}, &stdout); err != nil {
		t.Fatalf("addAccessToken(JSON) error = %v", err)
	}

	var payload accessTokenAddResult
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal(access token output) error = %v", err)
	}
	if payload.Label != "json-token" {
		t.Fatalf("payload.Label = %q, want %q", payload.Label, "json-token")
	}
	if !strings.HasPrefix(payload.Token, "cxs_") {
		t.Fatalf("payload.Token = %q, want generated raw token", payload.Token)
	}
	if payload.LoginEndpoint != "/api/access/login" {
		t.Fatalf("payload.LoginEndpoint = %q, want %q", payload.LoginEndpoint, "/api/access/login")
	}
	if payload.StorePath == "" {
		t.Fatal("payload.StorePath = empty, want resolved path")
	}
}

func outputLineValue(output string, prefix string) string {
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
	}
	return ""
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
