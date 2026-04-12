package auth

import (
	"encoding/json"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestNormalizeRateLimitSnapshotsMergesRootAndByLimitID(t *testing.T) {
	response := rateLimitReadResponse{
		RateLimits: mustMarshalJSON(t, map[string]any{
			"limitId":   "codex",
			"limitName": "Codex",
			"primary": map[string]any{
				"usedPercent":        42.0,
				"windowDurationMins": int64(60),
				"resetsAt":           int64(1735693200),
			},
			"secondary": map[string]any{
				"usedPercent":        5.0,
				"windowDurationMins": int64(1440),
				"resetsAt":           int64(1735779600),
			},
			"credits": map[string]any{
				"hasCredits": true,
				"unlimited":  false,
				"balance":    "17.5",
			},
			"planType": "pro",
		}),
		RateLimitsByLimitID: map[string]json.RawMessage{
			"codex": mustMarshalJSON(t, map[string]any{
				"limitId": "codex",
				"primary": map[string]any{
					"usedPercent":        42.0,
					"windowDurationMins": int64(60),
					"resetsAt":           int64(1735693200),
				},
				"secondary": map[string]any{
					"usedPercent":        5.0,
					"windowDurationMins": int64(1440),
					"resetsAt":           int64(1735779600),
				},
			}),
			"codex_other": mustMarshalJSON(t, map[string]any{
				"primary": map[string]any{
					"usedPercent":        88.0,
					"windowDurationMins": int64(30),
					"resetsAt":           int64(1735696800),
				},
			}),
		},
	}

	snapshots, err := normalizeRateLimitSnapshots(response)
	if err != nil {
		t.Fatalf("normalizeRateLimitSnapshots() error = %v", err)
	}

	if len(snapshots) != 2 {
		t.Fatalf("expected 2 normalized snapshots, got %d", len(snapshots))
	}

	root := snapshots[0]
	if root.LimitID != "codex" {
		t.Fatalf("expected root limit id codex, got %q", root.LimitID)
	}
	if root.LimitName != "Codex" {
		t.Fatalf("expected root limit name Codex, got %q", root.LimitName)
	}
	if root.Primary == nil || root.Secondary == nil {
		t.Fatalf("expected root snapshot to keep both primary and secondary windows")
	}
	if root.Credits == nil || !root.Credits.HasCredits || root.Credits.Balance != "17.5" {
		t.Fatalf("expected root credits to be preserved, got %#v", root.Credits)
	}
	if root.PlanType != "pro" {
		t.Fatalf("expected root planType pro, got %q", root.PlanType)
	}

	other := snapshots[1]
	if other.LimitID != "codex_other" {
		t.Fatalf("expected secondary limit id codex_other, got %q", other.LimitID)
	}
	if other.LimitName != "codex_other" {
		t.Fatalf("expected secondary limit name to default from map key, got %q", other.LimitName)
	}
	if other.Primary == nil {
		t.Fatalf("expected secondary limit to keep its primary window")
	}
	if other.Credits == nil || !other.Credits.HasCredits || other.Credits.Balance != "17.5" {
		t.Fatalf("expected secondary limit to inherit credits, got %#v", other.Credits)
	}
	if other.PlanType != "pro" {
		t.Fatalf("expected secondary limit to inherit planType, got %q", other.PlanType)
	}
}

func TestMapNormalizedRateLimitSnapshotsToStoreKeepsSnapshotShape(t *testing.T) {
	primaryReset := time.Unix(1735693200, 0).UTC()
	secondaryReset := time.Unix(1735779600, 0).UTC()
	otherReset := time.Unix(1735696800, 0).UTC()
	primaryWindowMins := int64(60)
	secondaryWindowMins := int64(1440)
	otherWindowMins := int64(30)

	items := mapNormalizedRateLimitSnapshotsToStore([]normalizedRateLimitSnapshot{
		{
			LimitID:   "codex",
			LimitName: "Codex",
			Primary: &normalizedRateLimitWindow{
				UsedPercent:        42,
				WindowDurationMins: &primaryWindowMins,
				ResetsAt:           &primaryReset,
			},
			Secondary: &normalizedRateLimitWindow{
				UsedPercent:        5,
				WindowDurationMins: &secondaryWindowMins,
				ResetsAt:           &secondaryReset,
			},
			Credits: &normalizedCreditsSnapshot{
				HasCredits: true,
				Balance:    "17.5",
			},
			PlanType: "pro",
		},
		{
			LimitID:   "codex_other",
			LimitName: "codex_other",
			Primary: &normalizedRateLimitWindow{
				UsedPercent:        88,
				WindowDurationMins: &otherWindowMins,
				ResetsAt:           &otherReset,
			},
			PlanType: "pro",
		},
	})

	if len(items) != 2 {
		t.Fatalf("expected 2 snapshot rows, got %d", len(items))
	}

	if items[0].LimitID != "codex" || items[0].LimitName != "Codex" {
		t.Fatalf("unexpected first snapshot identity: %#v", items[0])
	}
	assertRateLimitWindow(t, items[0].Primary, 42, primaryWindowMins, primaryReset)
	assertRateLimitWindow(t, items[0].Secondary, 5, secondaryWindowMins, secondaryReset)
	if items[0].Credits == nil || !items[0].Credits.HasCredits || items[0].Credits.Balance != "17.5" {
		t.Fatalf("expected credits to be preserved, got %#v", items[0].Credits)
	}
	if items[0].PlanType != "pro" {
		t.Fatalf("expected planType pro, got %q", items[0].PlanType)
	}

	if items[1].LimitID != "codex_other" || items[1].LimitName != "codex_other" {
		t.Fatalf("unexpected second snapshot identity: %#v", items[1])
	}
	assertRateLimitWindow(t, items[1].Primary, 88, otherWindowMins, otherReset)
	if items[1].Secondary != nil {
		t.Fatalf("expected second snapshot secondary window to be nil, got %#v", items[1].Secondary)
	}
}

func TestDecodeRateLimitItemsFromResponseSupportsLegacyArray(t *testing.T) {
	response := rateLimitReadResponse{
		RateLimits: mustMarshalJSON(t, []map[string]any{
			{
				"name":      "legacy",
				"limit":     200,
				"remaining": 150,
				"resetsAt":  "2026-04-12T10:00:00Z",
			},
		}),
	}

	items, err := decodeRateLimitItemsFromResponse(response)
	if err != nil {
		t.Fatalf("decodeRateLimitItemsFromResponse() error = %v", err)
	}

	if len(items) != 1 {
		t.Fatalf("expected 1 legacy item, got %d", len(items))
	}

	if items[0].LimitName != "legacy" {
		t.Fatalf("expected legacy limitName, got %q", items[0].LimitName)
	}
	expectedReset := time.Date(2026, 4, 12, 10, 0, 0, 0, time.UTC)
	assertRateLimitWindow(t, items[0].Primary, 25, 0, expectedReset)
}

func mustMarshalJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()

	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	return data
}

func assertRateLimitWindow(t *testing.T, window *store.RateLimitWindow, expectedUsedPercent int, expectedWindowDurationMins int64, expectedReset time.Time) {
	t.Helper()

	if window == nil {
		t.Fatal("expected rate-limit window to be present")
	}
	if window.UsedPercent != expectedUsedPercent {
		t.Fatalf("expected usedPercent %d, got %d", expectedUsedPercent, window.UsedPercent)
	}
	if expectedWindowDurationMins == 0 {
		if window.WindowDurationMins != nil {
			t.Fatalf("expected windowDurationMins to be nil, got %#v", window.WindowDurationMins)
		}
	} else {
		if window.WindowDurationMins == nil || *window.WindowDurationMins != expectedWindowDurationMins {
			t.Fatalf(
				"expected windowDurationMins %d, got %#v",
				expectedWindowDurationMins,
				window.WindowDurationMins,
			)
		}
	}
	if window.ResetsAt == nil || !window.ResetsAt.Equal(expectedReset) {
		t.Fatalf("expected resetsAt %s, got %#v", expectedReset.Format(time.RFC3339), window.ResetsAt)
	}
}
