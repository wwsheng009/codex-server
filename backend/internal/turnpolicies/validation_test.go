package turnpolicies

import (
	"reflect"
	"testing"
)

func TestIsValidationCommandUsesDefaultPrefixes(t *testing.T) {
	t.Parallel()

	if !isValidationCommand("go test ./...", nil) {
		t.Fatal("expected default validation prefixes to match go test")
	}
	if isValidationCommand("npm run check -- --strict", nil) {
		t.Fatal("expected custom command to stay unmatched before configuration")
	}
}

func TestNormalizeValidationCommandPrefixes(t *testing.T) {
	t.Parallel()

	prefixes := NormalizeValidationCommandPrefixes([]string{
		" npm run check ",
		"NPM RUN CHECK",
		"pnpm lint",
		"",
	})
	want := []string{"npm run check", "pnpm lint"}
	if !reflect.DeepEqual(prefixes, want) {
		t.Fatalf("expected normalized prefixes %#v, got %#v", want, prefixes)
	}
	if !isValidationCommand("npm run check -- --strict", prefixes) {
		t.Fatal("expected configured validation prefixes to match custom command")
	}
	if isValidationCommand("npm run build", prefixes) {
		t.Fatal("expected unrelated command to stay unmatched")
	}
}
