package catalog

import "testing"

func TestMapPluginListResponseFlattensMarketplacePlugins(t *testing.T) {
	result := mapPluginListResponse(pluginListResponse{
		Marketplaces: []map[string]any{
			{
				"name": "Official",
				"path": "/plugins/official",
				"plugins": []any{
					map[string]any{
						"id":            "plugin.alpha",
						"name":          "Alpha",
						"installed":     true,
						"enabled":       true,
						"authPolicy":    "ON_INSTALL",
						"installPolicy": "AVAILABLE",
						"source": map[string]any{
							"type": "local",
							"path": "/plugins/official/alpha",
						},
						"interface": map[string]any{
							"brandColor":   "#00AAFF",
							"capabilities": []any{"chat", "search"},
							"category":     "productivity",
						},
					},
				},
			},
		},
		RemoteSyncError: "remote sync failed",
	})

	if got := len(result.Plugins); got != 1 {
		t.Fatalf("expected 1 plugin item, got %d", got)
	}

	plugin := result.Plugins[0]
	if plugin.ID != "plugin.alpha" {
		t.Fatalf("expected plugin ID to be preserved, got %q", plugin.ID)
	}
	if plugin.MarketplaceName != "Official" {
		t.Fatalf("expected marketplace name to be preserved, got %q", plugin.MarketplaceName)
	}
	if plugin.SourceType != "local" {
		t.Fatalf("expected source type to be preserved, got %q", plugin.SourceType)
	}
	if plugin.SourcePath != "/plugins/official/alpha" {
		t.Fatalf("expected source path to be preserved, got %q", plugin.SourcePath)
	}
	if !plugin.Installed || !plugin.Enabled {
		t.Fatalf("expected installed/enabled flags to be true, got installed=%v enabled=%v", plugin.Installed, plugin.Enabled)
	}
	if plugin.AuthPolicy != "ON_INSTALL" {
		t.Fatalf("expected auth policy to be preserved, got %q", plugin.AuthPolicy)
	}
	if plugin.InstallPolicy != "AVAILABLE" {
		t.Fatalf("expected install policy to be preserved, got %q", plugin.InstallPolicy)
	}
	if plugin.Category != "productivity" {
		t.Fatalf("expected category to be preserved, got %q", plugin.Category)
	}
	if len(plugin.Capabilities) != 2 {
		t.Fatalf("expected capabilities to be preserved, got %#v", plugin.Capabilities)
	}
	if plugin.Description == "" {
		t.Fatal("expected description to be derived from plugin metadata")
	}
	if result.RemoteSyncError != "remote sync failed" {
		t.Fatalf("expected remote sync error to be preserved, got %q", result.RemoteSyncError)
	}
}
