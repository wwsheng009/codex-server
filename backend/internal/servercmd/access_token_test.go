package servercmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
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

func TestParseAccessTokenListArgsRejectsPositionalArguments(t *testing.T) {
	t.Parallel()

	_, err := parseAccessTokenListArgs([]string{"unexpected"})
	if err == nil {
		t.Fatal("parseAccessTokenListArgs() error = nil, want validation error")
	}
}

func TestParseAccessTokenDeleteArgsRequiresTokenID(t *testing.T) {
	t.Parallel()

	_, err := parseAccessTokenDeleteArgs(nil)
	if err == nil {
		t.Fatal("parseAccessTokenDeleteArgs() error = nil, want validation error")
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

func TestMainAccessTokenAddHandlesPreexistingHigherTokenIDs(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
	})

	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		t.Fatal("checkCodexCLIFunc should not be called for access-token add")
		return codexDoctorReport{}, nil
	}

	probeID := store.NewID("probe")
	baseID := store.NumericIDSuffix(probeID) + 20
	now := time.Now().UTC().Add(-1 * time.Hour).Round(time.Second)
	storePath := filepath.Join(t.TempDir(), "metadata.json")

	metadata, err := json.Marshal(map[string]any{
		"runtimePreferences": map[string]any{
			"accessTokens": []map[string]any{
				{
					"id":           fmt.Sprintf("atk_%06d", baseID+1),
					"label":        "existing",
					"tokenHash":    "existing-hash",
					"tokenPreview": "cxs_...1234",
					"createdAt":    now,
					"updatedAt":    now,
				},
			},
		},
		"workspaces": []map[string]any{
			{
				"id":            fmt.Sprintf("ws_%06d", baseID),
				"name":          "Seed Workspace",
				"rootPath":      "E:/seed",
				"runtimeStatus": "ready",
				"createdAt":     now,
				"updatedAt":     now,
			},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(metadata) error = %v", err)
	}
	if err := os.WriteFile(storePath, metadata, 0o600); err != nil {
		t.Fatalf("os.WriteFile(%q) error = %v", storePath, err)
	}

	t.Setenv("CODEX_SERVER_STORE_PATH", storePath)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"access-token", "add", "--label", "new-cli-token"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Main(access-token add) exit code = %d, stderr = %q", exitCode, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("Main(access-token add) stderr = %q, want empty", stderr.String())
	}

	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}
	defer func() {
		_ = dataStore.Close()
	}()

	prefs := dataStore.GetRuntimePreferences()
	if len(prefs.AccessTokens) != 2 {
		t.Fatalf("persisted access token count = %d, want 2", len(prefs.AccessTokens))
	}
	if prefs.AccessTokens[1].ID == fmt.Sprintf("atk_%06d", baseID+1) {
		t.Fatalf("new access token reused existing id %q", prefs.AccessTokens[1].ID)
	}
}

func TestMainAccessTokenListDoesNotRequireDoctorAndShowsValidity(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
	})

	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		t.Fatal("checkCodexCLIFunc should not be called for access-token list")
		return codexDoctorReport{}, nil
	}

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	seedNow := time.Now().UTC()

	tokens, err := accesscontrol.ApplyTokenInputs(
		nil,
		[]accesscontrol.TokenInput{
			{
				Label:     "valid-token",
				Token:     "cxs_valid_token_1234567890",
				Permanent: true,
			},
			{
				Label:     "expired-token",
				Token:     "cxs_expired_token_1234567890",
				Permanent: true,
			},
		},
		seedNow,
	)
	if err != nil {
		t.Fatalf("accesscontrol.ApplyTokenInputs() error = %v", err)
	}
	expiredAt := seedNow.Add(-1 * time.Hour)
	tokens[1].ExpiresAt = &expiredAt
	tokens[1].UpdatedAt = seedNow.Add(-30 * time.Minute)

	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		AccessTokens: tokens,
	})
	if err := dataStore.Close(); err != nil {
		t.Fatalf("dataStore.Close() error = %v", err)
	}

	t.Setenv("CODEX_SERVER_STORE_PATH", storePath)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"server", "access-token", "list"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Main(server access-token list) exit code = %d, stderr = %q", exitCode, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("Main(server access-token list) stderr = %q, want empty", stderr.String())
	}

	output := stdout.String()
	if !strings.Contains(output, "access tokens") {
		t.Fatalf("Main(server access-token list) stdout = %q, want header", output)
	}
	if !strings.Contains(output, "valid-token") || !strings.Contains(output, "expired-token") {
		t.Fatalf("Main(server access-token list) stdout = %q, want token labels", output)
	}
	if !strings.Contains(output, "yes") || !strings.Contains(output, "no") {
		t.Fatalf("Main(server access-token list) stdout = %q, want validity markers", output)
	}
	if !strings.Contains(output, "active") || !strings.Contains(output, "expired") {
		t.Fatalf("Main(server access-token list) stdout = %q, want status markers", output)
	}
}

func TestListAccessTokenJSONOutputIncludesValidFlag(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "metadata.json")
	seedNow := time.Now().UTC()

	tokens, err := accesscontrol.ApplyTokenInputs(
		nil,
		[]accesscontrol.TokenInput{
			{
				Label:     "json-token",
				Token:     "cxs_json_token_1234567890",
				Permanent: true,
			},
		},
		seedNow,
	)
	if err != nil {
		t.Fatalf("accesscontrol.ApplyTokenInputs() error = %v", err)
	}

	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		AccessTokens: tokens,
	})
	if err := dataStore.Close(); err != nil {
		t.Fatalf("dataStore.Close() error = %v", err)
	}

	var stdout bytes.Buffer
	if err := listAccessTokens(accessTokenListOptions{
		StorePath: storePath,
		JSON:      true,
	}, &stdout); err != nil {
		t.Fatalf("listAccessTokens(JSON) error = %v", err)
	}

	var payload accessTokenListResult
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal(access token list output) error = %v", err)
	}
	if payload.Count != 1 || payload.ValidCount != 1 {
		t.Fatalf("payload counts = %#v, want count=1 validCount=1", payload)
	}
	if len(payload.Tokens) != 1 {
		t.Fatalf("len(payload.Tokens) = %d, want 1", len(payload.Tokens))
	}
	if !payload.Tokens[0].Valid {
		t.Fatalf("payload.Tokens[0].Valid = false, want true")
	}
	if payload.Tokens[0].Status != "active" {
		t.Fatalf("payload.Tokens[0].Status = %q, want %q", payload.Tokens[0].Status, "active")
	}
	if payload.StorePath == "" {
		t.Fatal("payload.StorePath = empty, want resolved path")
	}
}

func TestMainAccessTokenDeleteDoesNotRequireDoctorAndRemovesToken(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
	})

	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		t.Fatal("checkCodexCLIFunc should not be called for access-token delete")
		return codexDoctorReport{}, nil
	}

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	seedNow := time.Now().UTC()

	tokens, err := accesscontrol.ApplyTokenInputs(
		nil,
		[]accesscontrol.TokenInput{
			{
				Label:     "keep-token",
				Token:     "cxs_keep_token_1234567890",
				Permanent: true,
			},
			{
				Label:     "delete-token",
				Token:     "cxs_delete_token_1234567890",
				Permanent: true,
			},
		},
		seedNow,
	)
	if err != nil {
		t.Fatalf("accesscontrol.ApplyTokenInputs() error = %v", err)
	}

	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		AccessTokens: tokens,
	})
	if err := dataStore.Close(); err != nil {
		t.Fatalf("dataStore.Close() error = %v", err)
	}

	deleteID := tokenIDByLabel(tokens, "delete-token")
	if deleteID == "" {
		t.Fatal("delete token id = empty, want seeded token id")
	}

	t.Setenv("CODEX_SERVER_STORE_PATH", storePath)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"access-token", "delete", deleteID}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("Main(access-token delete) exit code = %d, stderr = %q", exitCode, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("Main(access-token delete) stderr = %q, want empty", stderr.String())
	}

	output := stdout.String()
	if !strings.Contains(output, "access token deleted") {
		t.Fatalf("Main(access-token delete) stdout = %q, want deletion header", output)
	}
	if !strings.Contains(output, deleteID) {
		t.Fatalf("Main(access-token delete) stdout = %q, want deleted token id", output)
	}

	reloadedStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(reloaded) error = %v", err)
	}
	defer func() {
		_ = reloadedStore.Close()
	}()

	prefs := reloadedStore.GetRuntimePreferences()
	if len(prefs.AccessTokens) != 1 {
		t.Fatalf("persisted access token count = %d, want 1", len(prefs.AccessTokens))
	}
	if prefs.AccessTokens[0].Label != "keep-token" {
		t.Fatalf("remaining label = %q, want %q", prefs.AccessTokens[0].Label, "keep-token")
	}
	if prefs.AccessTokens[0].ID == deleteID {
		t.Fatalf("remaining token reused deleted id %q", deleteID)
	}
}

func TestMainAccessTokenDeleteFailsWhenTokenIsMissing(t *testing.T) {
	originalCheck := checkCodexCLIFunc
	t.Cleanup(func() {
		checkCodexCLIFunc = originalCheck
	})

	checkCodexCLIFunc = func() (codexDoctorReport, error) {
		t.Fatal("checkCodexCLIFunc should not be called for access-token delete")
		return codexDoctorReport{}, nil
	}

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}
	if err := dataStore.Close(); err != nil {
		t.Fatalf("dataStore.Close() error = %v", err)
	}

	t.Setenv("CODEX_SERVER_STORE_PATH", storePath)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := Main([]string{"access-token", "delete", "atk_999999"}, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("Main(access-token delete missing) exit code = %d, want 1", exitCode)
	}
	if stdout.Len() != 0 {
		t.Fatalf("Main(access-token delete missing) stdout = %q, want empty", stdout.String())
	}
	if got := stderr.String(); !strings.Contains(got, `access token "atk_999999" was not found`) {
		t.Fatalf("Main(access-token delete missing) stderr = %q, want not-found error", got)
	}
}

func TestDeleteAccessTokenJSONOutput(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "metadata.json")
	seedNow := time.Now().UTC()

	tokens, err := accesscontrol.ApplyTokenInputs(
		nil,
		[]accesscontrol.TokenInput{
			{
				Label:     "json-delete-token",
				Token:     "cxs_json_delete_token_1234567890",
				Permanent: true,
			},
		},
		seedNow,
	)
	if err != nil {
		t.Fatalf("accesscontrol.ApplyTokenInputs() error = %v", err)
	}

	dataStore, err := store.NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("store.NewPersistentStore(%q) error = %v", storePath, err)
	}
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		AccessTokens: tokens,
	})
	if err := dataStore.Close(); err != nil {
		t.Fatalf("dataStore.Close() error = %v", err)
	}

	deleteID := tokenIDByLabel(tokens, "json-delete-token")
	if deleteID == "" {
		t.Fatal("delete token id = empty, want seeded token id")
	}

	var stdout bytes.Buffer
	if err := deleteAccessToken(accessTokenDeleteOptions{
		ID:        deleteID,
		StorePath: storePath,
		JSON:      true,
	}, &stdout); err != nil {
		t.Fatalf("deleteAccessToken(JSON) error = %v", err)
	}

	var payload accessTokenDeleteResult
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal(access token delete output) error = %v", err)
	}
	if payload.ID != deleteID {
		t.Fatalf("payload.ID = %q, want %q", payload.ID, deleteID)
	}
	if payload.Label != "json-delete-token" {
		t.Fatalf("payload.Label = %q, want %q", payload.Label, "json-delete-token")
	}
	if !payload.Valid {
		t.Fatal("payload.Valid = false, want true")
	}
	if payload.Status != "active" {
		t.Fatalf("payload.Status = %q, want %q", payload.Status, "active")
	}
	if payload.RemainingCount != 0 {
		t.Fatalf("payload.RemainingCount = %d, want 0", payload.RemainingCount)
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

func tokenIDByLabel(tokens []store.AccessToken, label string) string {
	for _, token := range tokens {
		if token.Label == label {
			return token.ID
		}
	}
	return ""
}
