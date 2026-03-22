package configfs

import "strings"

var runtimeSensitiveConfigPrefixes = []string{
	"approval_policy",
	"sandbox_mode",
	"sandbox_workspace_write",
	"shell_environment_policy",
	"model",
	"model_provider",
	"model_reasoning_effort",
	"model_reasoning_summary",
	"model_verbosity",
	"service_tier",
}

func ConfigWriteRequiresRuntimeReload(keyPath string) bool {
	return MatchingRuntimeSensitiveConfigPrefix(keyPath) != ""
}

func MatchingRuntimeSensitiveConfigPrefix(keyPath string) string {
	normalized := strings.TrimSpace(keyPath)
	if normalized == "" {
		return ""
	}

	for _, prefix := range runtimeSensitiveConfigPrefixes {
		if normalized == prefix || strings.HasPrefix(normalized, prefix+".") {
			return prefix
		}
	}

	return ""
}

func ConfigBatchWriteRequiresRuntimeReload(edits []map[string]any) bool {
	for _, edit := range edits {
		keyPath, _ := edit["keyPath"].(string)
		if ConfigWriteRequiresRuntimeReload(keyPath) {
			return true
		}
	}
	return false
}

func MatchingRuntimeSensitiveConfigPrefixes(edits []map[string]any) []string {
	seen := make(map[string]struct{})
	matches := make([]string, 0)

	for _, edit := range edits {
		keyPath, _ := edit["keyPath"].(string)
		prefix := MatchingRuntimeSensitiveConfigPrefix(keyPath)
		if prefix == "" {
			continue
		}
		if _, ok := seen[prefix]; ok {
			continue
		}
		seen[prefix] = struct{}{}
		matches = append(matches, prefix)
	}

	return matches
}
