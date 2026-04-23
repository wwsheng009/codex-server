package buildinfo

import (
	"runtime/debug"
	"strings"
	"time"
)

const defaultVersion = "dev"

var (
	Version   = defaultVersion
	Commit    = ""
	BuildTime = ""

	readBuildInfo = debug.ReadBuildInfo
)

type Metadata struct {
	Version   string `json:"version"`
	Commit    string `json:"commit,omitempty"`
	BuildTime string `json:"buildTime,omitempty"`
}

func Current() Metadata {
	metadata := Metadata{
		Version:   normalizeVersion(Version),
		Commit:    strings.TrimSpace(Commit),
		BuildTime: normalizeTimestamp(BuildTime),
	}

	info, ok := readBuildInfo()
	if ok && info != nil {
		if metadata.Version == defaultVersion {
			if version := normalizeModuleVersion(info.Main.Version); version != "" {
				metadata.Version = version
			}
		}

		settings := buildSettings(info.Settings)
		if metadata.Commit == "" {
			metadata.Commit = strings.TrimSpace(settings["vcs.revision"])
		}
		if metadata.BuildTime == "" {
			metadata.BuildTime = normalizeTimestamp(settings["vcs.time"])
		}
	}

	if metadata.Version == "" {
		metadata.Version = defaultVersion
	}

	return metadata
}

func Summary() string {
	metadata := Current()
	parts := []string{metadata.Version}
	if metadata.Commit != "" {
		parts = append(parts, metadata.Commit)
	}
	if metadata.BuildTime != "" {
		parts = append(parts, metadata.BuildTime)
	}
	return strings.Join(parts, " ")
}

func normalizeVersion(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return defaultVersion
	}
	return trimmed
}

func normalizeModuleVersion(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "(devel)" {
		return ""
	}
	return trimmed
}

func normalizeTimestamp(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return trimmed
	}

	return parsed.UTC().Format(time.RFC3339)
}

func buildSettings(settings []debug.BuildSetting) map[string]string {
	if len(settings) == 0 {
		return map[string]string{}
	}

	values := make(map[string]string, len(settings))
	for _, setting := range settings {
		values[setting.Key] = setting.Value
	}
	return values
}
