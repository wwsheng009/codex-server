package config

import "testing"

func TestNormalizeApprovalPolicyAcceptsCommonValues(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"":           "",
		"inherit":    "",
		"untrusted":  ApprovalPolicyUntrusted,
		"on-request": ApprovalPolicyOnRequest,
		"onRequest":  ApprovalPolicyOnRequest,
		"on-failure": ApprovalPolicyOnFailure,
		"onFailure":  ApprovalPolicyOnFailure,
		"never":      ApprovalPolicyNever,
	}

	for input, want := range tests {
		got, err := NormalizeApprovalPolicy(input)
		if err != nil {
			t.Fatalf("NormalizeApprovalPolicy(%q) error = %v", input, err)
		}
		if got != want {
			t.Fatalf("NormalizeApprovalPolicy(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestNormalizeApprovalPolicyRejectsUnknownValue(t *testing.T) {
	t.Parallel()

	if _, err := NormalizeApprovalPolicy("always"); err == nil {
		t.Fatal("expected unknown approval policy to be rejected")
	}
}

func TestNormalizeSandboxPolicyMapCanonicalizesCommonPolicies(t *testing.T) {
	t.Parallel()

	policy, err := NormalizeSandboxPolicyMap(map[string]any{
		"type":          "EXTERNAL_SANDBOX",
		"networkAccess": "Enabled",
	})
	if err != nil {
		t.Fatalf("NormalizeSandboxPolicyMap() error = %v", err)
	}

	if got := policy["type"]; got != "externalSandbox" {
		t.Fatalf("expected canonical type, got %#v", got)
	}
	if got := policy["networkAccess"]; got != "enabled" {
		t.Fatalf("expected canonical networkAccess, got %#v", got)
	}
}

func TestNormalizeSandboxPolicyMapRejectsInvalidExternalNetworkAccess(t *testing.T) {
	t.Parallel()

	if _, err := NormalizeSandboxPolicyMap(map[string]any{
		"type":          "externalSandbox",
		"networkAccess": true,
	}); err == nil {
		t.Fatal("expected invalid external sandbox networkAccess to be rejected")
	}
}

func TestSandboxModeFromSandboxPolicyMapMapsSupportedModes(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"readOnly":         "read-only",
		"workspaceWrite":   "workspace-write",
		"dangerFullAccess": "danger-full-access",
	}

	for policyType, want := range tests {
		got := SandboxModeFromSandboxPolicyMap(map[string]any{"type": policyType})
		if got != want {
			t.Fatalf("SandboxModeFromSandboxPolicyMap(%q) = %q, want %q", policyType, got, want)
		}
	}
}

func TestSandboxModeFromSandboxPolicyMapSkipsExternalSandbox(t *testing.T) {
	t.Parallel()

	if got := SandboxModeFromSandboxPolicyMap(map[string]any{"type": "externalSandbox"}); got != "" {
		t.Fatalf("expected external sandbox to have no thread/start sandbox mode, got %q", got)
	}
}
