package turnpolicies

import (
	"sort"
	"strings"

	"codex-server/backend/internal/store"
)

var defaultValidationCommandPrefixes = []string{
	"go test",
	"cargo test",
	"cargo clippy",
	"pytest",
	"npm test",
	"pnpm test",
	"yarn test",
	"vitest",
	"jest",
	"just test",
	"bazel test",
	"ruff check",
	"eslint",
	"tsc",
}

func DefaultValidationCommandPrefixes() []string {
	return append([]string(nil), defaultValidationCommandPrefixes...)
}

func NormalizeValidationCommandPrefixes(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	items := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.ToLower(strings.TrimSpace(value))
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		items = append(items, trimmed)
	}
	if len(items) == 0 {
		return nil
	}

	sort.Strings(items)
	return items
}

func ResolveValidationCommandPrefixes(prefs store.RuntimePreferences) []string {
	configured := NormalizeValidationCommandPrefixes(prefs.TurnPolicyValidationCommandPrefixes)
	if len(configured) > 0 {
		return configured
	}
	return DefaultValidationCommandPrefixes()
}

func isValidationCommand(command string, validationCommandPrefixes []string) bool {
	normalized := strings.ToLower(strings.TrimSpace(command))
	if normalized == "" {
		return false
	}

	prefixes := NormalizeValidationCommandPrefixes(validationCommandPrefixes)
	if len(prefixes) == 0 {
		prefixes = DefaultValidationCommandPrefixes()
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}

	return false
}
