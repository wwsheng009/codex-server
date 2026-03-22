package config

import (
	"fmt"
	"strings"
)

const (
	ApprovalPolicyUntrusted = "untrusted"
	ApprovalPolicyOnFailure = "on-failure"
	ApprovalPolicyOnRequest = "on-request"
	ApprovalPolicyNever     = "never"
)

func DefaultCommandSandboxPolicy() map[string]any {
	return map[string]any{
		"type": "dangerFullAccess",
	}
}

func NormalizeApprovalPolicy(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")

	switch normalized {
	case "", "default", "inherit":
		return "", nil
	case "untrusted":
		return ApprovalPolicyUntrusted, nil
	case "onfailure", "on-failure":
		return ApprovalPolicyOnFailure, nil
	case "onrequest", "on-request":
		return ApprovalPolicyOnRequest, nil
	case "never":
		return ApprovalPolicyNever, nil
	default:
		return "", fmt.Errorf("unsupported approval policy %q", value)
	}
}

func ApprovalPolicyJSONValue(value string) string {
	switch value {
	case ApprovalPolicyOnFailure:
		return "on-failure"
	case ApprovalPolicyOnRequest:
		return "on-request"
	case ApprovalPolicyUntrusted:
		return "untrusted"
	case ApprovalPolicyNever:
		return "never"
	default:
		return ""
	}
}

func SandboxModeFromSandboxPolicyMap(value map[string]any) string {
	if len(value) == 0 {
		return ""
	}

	rawType, _ := value["type"].(string)
	switch strings.TrimSpace(rawType) {
	case "readOnly":
		return "read-only"
	case "workspaceWrite":
		return "workspace-write"
	case "dangerFullAccess":
		return "danger-full-access"
	default:
		return ""
	}
}

func NormalizeSandboxPolicyMap(value map[string]any) (map[string]any, error) {
	if len(value) == 0 {
		return nil, nil
	}

	cloned := cloneJSONMap(value)
	rawType, _ := cloned["type"].(string)
	policyType, err := normalizeSandboxPolicyType(rawType)
	if err != nil {
		return nil, err
	}

	cloned["type"] = policyType

	switch policyType {
	case "externalSandbox":
		if rawNetworkAccess, ok := cloned["networkAccess"]; ok {
			networkAccess, err := normalizeExternalNetworkAccess(rawNetworkAccess)
			if err != nil {
				return nil, err
			}
			if networkAccess == "" {
				delete(cloned, "networkAccess")
			} else {
				cloned["networkAccess"] = networkAccess
			}
		}
	case "readOnly", "workspaceWrite":
		if rawNetworkAccess, ok := cloned["networkAccess"]; ok {
			if _, ok := rawNetworkAccess.(bool); !ok {
				return nil, fmt.Errorf("sandbox policy %q networkAccess must be a boolean", policyType)
			}
		}
	}

	return cloned, nil
}

func normalizeSandboxPolicyType(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "")
	normalized = strings.ReplaceAll(normalized, "-", "")

	switch normalized {
	case "dangerfullaccess":
		return "dangerFullAccess", nil
	case "externalsandbox":
		return "externalSandbox", nil
	case "readonly":
		return "readOnly", nil
	case "workspacewrite":
		return "workspaceWrite", nil
	default:
		return "", fmt.Errorf("unsupported sandbox policy type %q", value)
	}
}

func normalizeExternalNetworkAccess(value any) (string, error) {
	rawValue, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("externalSandbox networkAccess must be a string")
	}

	switch strings.ToLower(strings.TrimSpace(rawValue)) {
	case "", "restricted":
		return "restricted", nil
	case "enabled":
		return "enabled", nil
	default:
		return "", fmt.Errorf("unsupported externalSandbox networkAccess %q", rawValue)
	}
}

func cloneJSONMap(value map[string]any) map[string]any {
	if len(value) == 0 {
		return nil
	}

	cloned := make(map[string]any, len(value))
	for key, entry := range value {
		cloned[key] = cloneJSONValue(entry)
	}
	return cloned
}

func cloneJSONValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneJSONMap(typed)
	case []any:
		cloned := make([]any, len(typed))
		for index, entry := range typed {
			cloned[index] = cloneJSONValue(entry)
		}
		return cloned
	default:
		return typed
	}
}
