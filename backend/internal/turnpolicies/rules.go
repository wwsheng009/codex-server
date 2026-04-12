package turnpolicies

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"math"
	"strings"

	"codex-server/backend/internal/store"
)

const (
	hookHandlerKeyFailedValidation = "builtin.posttooluse.failed-validation-rescue"
	hookHandlerKeyMissingVerify    = "builtin.stop.require-successful-verification"
)

func evaluateFailedValidationCommand(event store.EventEnvelope, validationCommandPrefixes []string) (decisionRequest, bool) {
	payload := asObject(event.Payload)
	item := asObject(payload["item"])
	if stringValue(item["type"]) != "commandExecution" {
		return decisionRequest{}, false
	}

	command := strings.TrimSpace(stringValue(item["command"]))
	if !isValidationCommand(command, validationCommandPrefixes) || !isFailedCommandExecution(item) {
		return decisionRequest{}, false
	}

	itemID := strings.TrimSpace(stringValue(item["id"]))
	turnID := firstNonEmpty(strings.TrimSpace(stringValue(payload["turnId"])), strings.TrimSpace(event.TurnID))
	exitCode, hasExitCode := intValue(item["exitCode"])
	evidenceSummary := buildCommandEvidenceSummary(command, item, 1_000)
	evidenceFingerprint := command + "|" + stringValue(item["status"]) + "|" + normalizedExitCode(hasExitCode, exitCode) + "|" + outputTail(stringValue(item["aggregatedOutput"]), 240)

	return decisionRequest{
		itemID:          itemID,
		turnID:          turnID,
		triggerMethod:   "item/completed",
		policyName:      postToolUsePolicyName,
		verdict:         actionSteer,
		action:          actionSteer,
		reason:          "validation_command_failed",
		evidenceSummary: evidenceSummary,
		fingerprint:     fingerprintFor(event.ThreadID, turnID, itemID, postToolUsePolicyName, evidenceFingerprint),
		hookHandlerKey:  hookHandlerKeyFailedValidation,
		hookFingerprint: fingerprintFor(event.ThreadID, turnID, itemID, hookHandlerKeyFailedValidation, evidenceFingerprint),
		prompt:          failedValidationPrompt(command, hasExitCode, exitCode, outputTail(stringValue(item["aggregatedOutput"]), 600)),
	}, true
}

func evaluateMissingVerificationTurn(event store.EventEnvelope, validationCommandPrefixes []string) (decisionRequest, bool) {
	payload := asObject(event.Payload)
	turn := asObject(payload["turn"])
	turnID := firstNonEmpty(strings.TrimSpace(stringValue(turn["id"])), strings.TrimSpace(event.TurnID))
	items := itemList(turn["items"])
	if len(items) == 0 {
		return decisionRequest{}, false
	}

	lastFileChangeIndex := -1
	changePaths := make([]string, 0)
	for index, item := range items {
		if stringValue(item["type"]) != "fileChange" || stringValue(item["status"]) != "completed" {
			continue
		}
		lastFileChangeIndex = index
		changePaths = append(changePaths, fileChangePaths(item)...)
	}
	if lastFileChangeIndex < 0 {
		return decisionRequest{}, false
	}

	for _, item := range items[lastFileChangeIndex+1:] {
		if stringValue(item["type"]) != "commandExecution" {
			continue
		}
		command := strings.TrimSpace(stringValue(item["command"]))
		if isValidationCommand(command, validationCommandPrefixes) && isSuccessfulValidationCommand(item) {
			return decisionRequest{}, false
		}
	}

	evidencePaths := summarizePaths(changePaths, 5)
	evidenceSummary := "file changes completed without a later successful validation command"
	if len(evidencePaths) > 0 {
		evidenceSummary = evidenceSummary + ": " + strings.Join(evidencePaths, ", ")
	}

	return decisionRequest{
		turnID:          turnID,
		triggerMethod:   "turn/completed",
		policyName:      stopMissingVerifyPolicy,
		verdict:         actionFollowUp,
		action:          actionFollowUp,
		reason:          "file_changes_missing_successful_verification",
		evidenceSummary: evidenceSummary,
		fingerprint:     fingerprintFor(event.ThreadID, turnID, "", stopMissingVerifyPolicy, strings.Join(evidencePaths, "|")),
		hookHandlerKey:  hookHandlerKeyMissingVerify,
		hookFingerprint: fingerprintFor(event.ThreadID, turnID, "", hookHandlerKeyMissingVerify, strings.Join(evidencePaths, "|")),
		prompt:          missingVerificationPrompt(evidencePaths),
	}, true
}

func failedValidationPrompt(command string, hasExitCode bool, exitCode int, output string) string {
	var builder strings.Builder
	builder.WriteString("刚刚的验证命令失败了，请不要结束这条线程。\n")
	builder.WriteString("失败命令：")
	builder.WriteString(command)
	builder.WriteString("\n")
	if hasExitCode {
		builder.WriteString("退出码：")
		builder.WriteString(fmt.Sprintf("%d", exitCode))
		builder.WriteString("\n")
	}
	if trimmed := strings.TrimSpace(output); trimmed != "" {
		builder.WriteString("输出片段：\n")
		builder.WriteString(trimmed)
		builder.WriteString("\n")
	}
	builder.WriteString("请先分析失败原因，修复相关问题，并重新运行必要的验证或测试命令。只有在验证通过后再给出最终结论。")
	return builder.String()
}

func missingVerificationPrompt(paths []string) string {
	var builder strings.Builder
	builder.WriteString("上一轮已经修改了文件，但还没有看到成功的验证结果，请继续这条线程。\n")
	if len(paths) > 0 {
		builder.WriteString("涉及文件：")
		builder.WriteString(strings.Join(paths, ", "))
		builder.WriteString("\n")
	}
	builder.WriteString("请检查刚才的改动，运行与这些改动相关的验证或测试命令；如果验证失败，先修复再重试。只有在验证完成后再给出最终结论。")
	return builder.String()
}

func buildCommandEvidenceSummary(command string, item map[string]any, maxOutput int) string {
	var builder strings.Builder
	builder.WriteString("command=")
	builder.WriteString(command)
	if status := strings.TrimSpace(stringValue(item["status"])); status != "" {
		builder.WriteString("; status=")
		builder.WriteString(status)
	}
	if exitCode, ok := intValue(item["exitCode"]); ok {
		builder.WriteString("; exitCode=")
		builder.WriteString(fmt.Sprintf("%d", exitCode))
	}
	if output := strings.TrimSpace(outputTail(stringValue(item["aggregatedOutput"]), maxOutput)); output != "" {
		builder.WriteString("; output=")
		builder.WriteString(output)
	}
	return builder.String()
}

func fileChangePaths(item map[string]any) []string {
	changes, ok := item["changes"].([]any)
	if !ok || len(changes) == 0 {
		return nil
	}

	paths := make([]string, 0, len(changes))
	for _, change := range changes {
		path := strings.TrimSpace(stringValue(asObject(change)["path"]))
		if path == "" {
			continue
		}
		paths = append(paths, path)
	}
	return paths
}

func summarizePaths(paths []string, limit int) []string {
	if len(paths) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(paths))
	items := make([]string, 0, len(paths))
	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		items = append(items, trimmed)
		if limit > 0 && len(items) >= limit {
			break
		}
	}
	return items
}

func isFailedCommandExecution(item map[string]any) bool {
	status := strings.TrimSpace(stringValue(item["status"]))
	if status == "failed" {
		return true
	}
	if exitCode, ok := intValue(item["exitCode"]); ok && exitCode != 0 {
		return true
	}
	return false
}

func isSuccessfulValidationCommand(item map[string]any) bool {
	if strings.TrimSpace(stringValue(item["status"])) != "completed" {
		return false
	}
	if exitCode, ok := intValue(item["exitCode"]); ok && exitCode != 0 {
		return false
	}
	return true
}

func fingerprintFor(threadID string, turnID string, itemID string, policyName string, evidence string) string {
	sum := sha1.Sum([]byte(threadID + "\x00" + turnID + "\x00" + itemID + "\x00" + policyName + "\x00" + evidence))
	return hex.EncodeToString(sum[:])
}

func outputTail(value string, maxChars int) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || maxChars <= 0 {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) <= maxChars {
		return trimmed
	}
	return string(runes[len(runes)-maxChars:])
}

func normalizedExitCode(hasExitCode bool, exitCode int) string {
	if !hasExitCode {
		return ""
	}
	return fmt.Sprintf("%d", exitCode)
}

func asObject(value any) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return object
}

func itemList(value any) []map[string]any {
	rawItems, ok := value.([]any)
	if !ok {
		return nil
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, item := range rawItems {
		items = append(items, asObject(item))
	}
	return items
}

func stringValue(value any) string {
	typed, ok := value.(string)
	if !ok {
		return ""
	}
	return typed
}

func intValue(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case float64:
		if math.Trunc(typed) != typed {
			return 0, false
		}
		return int(typed), true
	default:
		return 0, false
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
