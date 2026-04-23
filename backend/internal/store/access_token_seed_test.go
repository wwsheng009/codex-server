package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewPersistentStoreSeedsIDCounterFromAccessTokenIDs(t *testing.T) {
	probeID := NewID("probe")
	baseID := NumericIDSuffix(probeID) + 20
	now := time.Now().UTC().Add(-1 * time.Hour).Round(time.Second)
	tokenID := fmt.Sprintf("atk_%06d", baseID+1)

	metadata, err := json.Marshal(map[string]any{
		"runtimePreferences": map[string]any{
			"accessTokens": []map[string]any{
				{
					"id":           tokenID,
					"label":        "seeded-token",
					"tokenHash":    "seeded-hash",
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

	storePath := filepath.Join(t.TempDir(), "metadata.json")
	if err := os.WriteFile(storePath, metadata, 0o600); err != nil {
		t.Fatalf("os.WriteFile(%q) error = %v", storePath, err)
	}

	dataStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore(%q) error = %v", storePath, err)
	}
	defer func() {
		_ = dataStore.Close()
	}()

	nextTokenID := NewID("atk")
	if nextTokenID == tokenID {
		t.Fatalf("NewID(atk) reused persisted access token id %q", nextTokenID)
	}
	if NumericIDSuffix(nextTokenID) <= NumericIDSuffix(tokenID) {
		t.Fatalf("NewID(atk) = %q, want suffix greater than persisted token id %q", nextTokenID, tokenID)
	}
}
