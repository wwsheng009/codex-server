package buildinfo

import (
	"runtime/debug"
	"testing"
)

func TestCurrentPrefersInjectedMetadata(t *testing.T) {
	originalVersion := Version
	originalCommit := Commit
	originalBuildTime := BuildTime
	originalReadBuildInfo := readBuildInfo
	t.Cleanup(func() {
		Version = originalVersion
		Commit = originalCommit
		BuildTime = originalBuildTime
		readBuildInfo = originalReadBuildInfo
	})

	Version = "v1.2.3"
	Commit = "abc123"
	BuildTime = "2026-04-23T08:00:00+08:00"
	readBuildInfo = func() (*debug.BuildInfo, bool) {
		return &debug.BuildInfo{
			Main: debug.Module{
				Version: "v9.9.9",
			},
			Settings: []debug.BuildSetting{
				{Key: "vcs.revision", Value: "def456"},
				{Key: "vcs.time", Value: "2026-04-01T00:00:00Z"},
			},
		}, true
	}

	metadata := Current()
	if metadata.Version != "v1.2.3" {
		t.Fatalf("version = %q, want %q", metadata.Version, "v1.2.3")
	}
	if metadata.Commit != "abc123" {
		t.Fatalf("commit = %q, want %q", metadata.Commit, "abc123")
	}
	if metadata.BuildTime != "2026-04-23T00:00:00Z" {
		t.Fatalf("buildTime = %q, want %q", metadata.BuildTime, "2026-04-23T00:00:00Z")
	}
}

func TestCurrentFallsBackToGoBuildInfo(t *testing.T) {
	originalVersion := Version
	originalCommit := Commit
	originalBuildTime := BuildTime
	originalReadBuildInfo := readBuildInfo
	t.Cleanup(func() {
		Version = originalVersion
		Commit = originalCommit
		BuildTime = originalBuildTime
		readBuildInfo = originalReadBuildInfo
	})

	Version = ""
	Commit = ""
	BuildTime = ""
	readBuildInfo = func() (*debug.BuildInfo, bool) {
		return &debug.BuildInfo{
			Main: debug.Module{
				Version: "v2.0.0",
			},
			Settings: []debug.BuildSetting{
				{Key: "vcs.revision", Value: "abcdef1234567890"},
				{Key: "vcs.time", Value: "2026-04-23T04:00:00-04:00"},
			},
		}, true
	}

	metadata := Current()
	if metadata.Version != "v2.0.0" {
		t.Fatalf("version = %q, want %q", metadata.Version, "v2.0.0")
	}
	if metadata.Commit != "abcdef1234567890" {
		t.Fatalf("commit = %q, want %q", metadata.Commit, "abcdef1234567890")
	}
	if metadata.BuildTime != "2026-04-23T08:00:00Z" {
		t.Fatalf("buildTime = %q, want %q", metadata.BuildTime, "2026-04-23T08:00:00Z")
	}
}
