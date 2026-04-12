package runtimeprefs

import (
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turnpolicies"
)

func TestRuntimePreferencesReadIncludesTurnPolicyAlertThresholdDefaults(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	result, err := service.Read()
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}

	if result.ConfiguredTurnPolicyAlertCoverageThresholdPercent != nil {
		t.Fatalf("expected no configured coverage threshold, got %#v", result.ConfiguredTurnPolicyAlertCoverageThresholdPercent)
	}
	if result.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled != nil {
		t.Fatalf("expected no configured post-tool-use policy override, got %#v", result.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled)
	}
	if result.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled != nil {
		t.Fatalf("expected no configured stop-missing-verify policy override, got %#v", result.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled)
	}
	if result.ConfiguredTurnPolicyPostToolUsePrimaryAction != "" {
		t.Fatalf("expected no configured post-tool-use primary action override, got %q", result.ConfiguredTurnPolicyPostToolUsePrimaryAction)
	}
	if result.ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction != "" {
		t.Fatalf("expected no configured stop-missing-verify primary action override, got %q", result.ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction)
	}
	if result.ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior != "" {
		t.Fatalf("expected no configured post-tool-use interrupt fallback override, got %q", result.ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior)
	}
	if result.ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != "" {
		t.Fatalf("expected no configured stop-missing-verify interrupt fallback override, got %q", result.ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior)
	}
	if result.ConfiguredTurnPolicyFollowUpCooldownMs != nil {
		t.Fatalf("expected no configured follow-up cooldown override, got %#v", result.ConfiguredTurnPolicyFollowUpCooldownMs)
	}
	if result.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs != nil {
		t.Fatalf("expected no configured post-tool-use follow-up cooldown override, got %#v", result.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs)
	}
	if result.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != nil {
		t.Fatalf("expected no configured stop-missing-verify follow-up cooldown override, got %#v", result.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	}
	if result.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs != nil {
		t.Fatalf("expected no configured post-tool-use latency threshold, got %#v", result.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	}
	if result.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs != nil {
		t.Fatalf("expected no configured stop latency threshold, got %#v", result.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs)
	}
	if result.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent != nil {
		t.Fatalf("expected no configured source success threshold, got %#v", result.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent)
	}
	if len(result.ConfiguredTurnPolicyAlertSuppressedCodes) != 0 {
		t.Fatalf("expected no configured suppressed alert codes, got %#v", result.ConfiguredTurnPolicyAlertSuppressedCodes)
	}
	if len(result.ConfiguredTurnPolicyAlertAcknowledgedCodes) != 0 {
		t.Fatalf("expected no configured acknowledged alert codes, got %#v", result.ConfiguredTurnPolicyAlertAcknowledgedCodes)
	}
	if len(result.ConfiguredTurnPolicyAlertSnoozedCodes) != 0 {
		t.Fatalf("expected no configured snoozed alert codes, got %#v", result.ConfiguredTurnPolicyAlertSnoozedCodes)
	}
	if result.ConfiguredTurnPolicyAlertSnoozeUntil != nil {
		t.Fatalf("expected no configured alert snooze until, got %#v", result.ConfiguredTurnPolicyAlertSnoozeUntil)
	}
	if result.ConfiguredTurnPolicyAlertSnoozeActive {
		t.Fatalf("expected no configured alert snooze to be active")
	}
	if result.ConfiguredTurnPolicyAlertSnoozeExpired {
		t.Fatalf("expected no configured alert snooze to be expired")
	}
	if result.DefaultTurnPolicyPostToolUseFailedValidationEnabled != turnpolicies.DefaultPostToolUseFailedValidationEnabled {
		t.Fatalf("unexpected default post-tool-use policy enabled %t", result.DefaultTurnPolicyPostToolUseFailedValidationEnabled)
	}
	if result.DefaultTurnPolicyStopMissingSuccessfulVerificationEnabled != turnpolicies.DefaultStopMissingSuccessfulVerificationEnabled {
		t.Fatalf("unexpected default stop-missing-verify policy enabled %t", result.DefaultTurnPolicyStopMissingSuccessfulVerificationEnabled)
	}
	if result.DefaultTurnPolicyPostToolUsePrimaryAction != turnpolicies.DefaultPostToolUsePrimaryAction {
		t.Fatalf("unexpected default post-tool-use primary action %q", result.DefaultTurnPolicyPostToolUsePrimaryAction)
	}
	if result.DefaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction != turnpolicies.DefaultStopMissingSuccessfulVerificationPrimaryAction {
		t.Fatalf("unexpected default stop-missing-verify primary action %q", result.DefaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction)
	}
	if result.DefaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior != turnpolicies.DefaultPostToolUseInterruptNoActiveTurnBehavior {
		t.Fatalf("unexpected default post-tool-use interrupt fallback %q", result.DefaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior)
	}
	if result.DefaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != turnpolicies.DefaultStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior {
		t.Fatalf("unexpected default stop-missing-verify interrupt fallback %q", result.DefaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior)
	}
	if result.DefaultTurnPolicyFollowUpCooldownMs != turnpolicies.DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected default follow-up cooldown %d", result.DefaultTurnPolicyFollowUpCooldownMs)
	}
	if result.DefaultTurnPolicyPostToolUseFollowUpCooldownMs != turnpolicies.DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected default post-tool-use follow-up cooldown %d", result.DefaultTurnPolicyPostToolUseFollowUpCooldownMs)
	}
	if result.DefaultTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != turnpolicies.DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected default stop-missing-verify follow-up cooldown %d", result.DefaultTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	}
	if result.DefaultTurnPolicyAlertCoverageThresholdPercent != turnpolicies.DefaultAlertCoverageThresholdPercent {
		t.Fatalf("unexpected default coverage threshold %d", result.DefaultTurnPolicyAlertCoverageThresholdPercent)
	}
	if result.DefaultTurnPolicyAlertPostToolUseLatencyP95ThresholdMs != turnpolicies.DefaultAlertPostToolUseLatencyP95ThresholdMs {
		t.Fatalf("unexpected default post-tool-use latency threshold %d", result.DefaultTurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	}
	if result.DefaultTurnPolicyAlertStopLatencyP95ThresholdMs != turnpolicies.DefaultAlertStopLatencyP95ThresholdMs {
		t.Fatalf("unexpected default stop latency threshold %d", result.DefaultTurnPolicyAlertStopLatencyP95ThresholdMs)
	}
	if result.DefaultTurnPolicyAlertSourceActionSuccessThresholdPercent != turnpolicies.DefaultAlertSourceActionSuccessThresholdPercent {
		t.Fatalf("unexpected default source success threshold %d", result.DefaultTurnPolicyAlertSourceActionSuccessThresholdPercent)
	}
	if len(result.DefaultTurnPolicyAlertSuppressedCodes) != 0 {
		t.Fatalf("expected no default suppressed alert codes, got %#v", result.DefaultTurnPolicyAlertSuppressedCodes)
	}
	if len(result.DefaultTurnPolicyAlertAcknowledgedCodes) != 0 {
		t.Fatalf("expected no default acknowledged alert codes, got %#v", result.DefaultTurnPolicyAlertAcknowledgedCodes)
	}
	if len(result.DefaultTurnPolicyAlertSnoozedCodes) != 0 {
		t.Fatalf("expected no default snoozed alert codes, got %#v", result.DefaultTurnPolicyAlertSnoozedCodes)
	}
	if result.DefaultTurnPolicyAlertSnoozeUntil != nil {
		t.Fatalf("expected no default alert snooze until, got %#v", result.DefaultTurnPolicyAlertSnoozeUntil)
	}
	if result.EffectiveTurnPolicyPostToolUseFailedValidationEnabled != turnpolicies.DefaultPostToolUseFailedValidationEnabled {
		t.Fatalf("unexpected effective post-tool-use policy enabled %t", result.EffectiveTurnPolicyPostToolUseFailedValidationEnabled)
	}
	if result.EffectiveTurnPolicyStopMissingSuccessfulVerificationEnabled != turnpolicies.DefaultStopMissingSuccessfulVerificationEnabled {
		t.Fatalf("unexpected effective stop-missing-verify policy enabled %t", result.EffectiveTurnPolicyStopMissingSuccessfulVerificationEnabled)
	}
	if result.EffectiveTurnPolicyPostToolUsePrimaryAction != turnpolicies.DefaultPostToolUsePrimaryAction {
		t.Fatalf("unexpected effective post-tool-use primary action %q", result.EffectiveTurnPolicyPostToolUsePrimaryAction)
	}
	if result.EffectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction != turnpolicies.DefaultStopMissingSuccessfulVerificationPrimaryAction {
		t.Fatalf("unexpected effective stop-missing-verify primary action %q", result.EffectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction)
	}
	if result.EffectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior != turnpolicies.DefaultPostToolUseInterruptNoActiveTurnBehavior {
		t.Fatalf("unexpected effective post-tool-use interrupt fallback %q", result.EffectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior)
	}
	if result.EffectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != turnpolicies.DefaultStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior {
		t.Fatalf("unexpected effective stop-missing-verify interrupt fallback %q", result.EffectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior)
	}
	if result.EffectiveTurnPolicyFollowUpCooldownMs != turnpolicies.DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected effective follow-up cooldown %d", result.EffectiveTurnPolicyFollowUpCooldownMs)
	}
	if result.EffectiveTurnPolicyPostToolUseFollowUpCooldownMs != turnpolicies.DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected effective post-tool-use follow-up cooldown %d", result.EffectiveTurnPolicyPostToolUseFollowUpCooldownMs)
	}
	if result.EffectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != turnpolicies.DefaultFollowUpCooldownMs {
		t.Fatalf("unexpected effective stop-missing-verify follow-up cooldown %d", result.EffectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	}
	if result.EffectiveTurnPolicyAlertCoverageThresholdPercent != turnpolicies.DefaultAlertCoverageThresholdPercent {
		t.Fatalf("unexpected effective coverage threshold %d", result.EffectiveTurnPolicyAlertCoverageThresholdPercent)
	}
	if result.EffectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs != turnpolicies.DefaultAlertPostToolUseLatencyP95ThresholdMs {
		t.Fatalf("unexpected effective post-tool-use latency threshold %d", result.EffectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	}
	if result.EffectiveTurnPolicyAlertStopLatencyP95ThresholdMs != turnpolicies.DefaultAlertStopLatencyP95ThresholdMs {
		t.Fatalf("unexpected effective stop latency threshold %d", result.EffectiveTurnPolicyAlertStopLatencyP95ThresholdMs)
	}
	if result.EffectiveTurnPolicyAlertSourceActionSuccessThresholdPercent != turnpolicies.DefaultAlertSourceActionSuccessThresholdPercent {
		t.Fatalf("unexpected effective source success threshold %d", result.EffectiveTurnPolicyAlertSourceActionSuccessThresholdPercent)
	}
	if len(result.EffectiveTurnPolicyAlertSuppressedCodes) != 0 {
		t.Fatalf("expected no effective suppressed alert codes, got %#v", result.EffectiveTurnPolicyAlertSuppressedCodes)
	}
	if len(result.EffectiveTurnPolicyAlertAcknowledgedCodes) != 0 {
		t.Fatalf("expected no effective acknowledged alert codes, got %#v", result.EffectiveTurnPolicyAlertAcknowledgedCodes)
	}
	if len(result.EffectiveTurnPolicyAlertSnoozedCodes) != 0 {
		t.Fatalf("expected no effective snoozed alert codes, got %#v", result.EffectiveTurnPolicyAlertSnoozedCodes)
	}
	if result.EffectiveTurnPolicyAlertSnoozeUntil != nil {
		t.Fatalf("expected no effective alert snooze until, got %#v", result.EffectiveTurnPolicyAlertSnoozeUntil)
	}
}

func TestRuntimePreferencesWritePersistsTurnPolicyAlertThresholds(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)
	snoozeUntil := time.Now().UTC().Add(24 * time.Hour).Round(time.Second)

	written, err := service.Write(WriteInput{
		TurnPolicyPostToolUseFailedValidationEnabled:                             boolPtr(false),
		TurnPolicyStopMissingSuccessfulVerificationEnabled:                       boolPtr(false),
		TurnPolicyPostToolUsePrimaryAction:                                       "interrupt",
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction:                 "steer",
		TurnPolicyPostToolUseInterruptNoActiveTurnBehavior:                       "followUp",
		TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: "skip",
		TurnPolicyFollowUpCooldownMs:                                             int64Ptr(45000),
		TurnPolicyPostToolUseFollowUpCooldownMs:                                  int64Ptr(0),
		TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:            int64Ptr(120000),
		TurnPolicyAlertCoverageThresholdPercent:                                  intPtr(65),
		TurnPolicyAlertPostToolUseLatencyP95ThresholdMs:                          int64Ptr(2400),
		TurnPolicyAlertStopLatencyP95ThresholdMs:                                 int64Ptr(3100),
		TurnPolicyAlertSourceActionSuccessThresholdPercent:                       intPtr(72),
		TurnPolicyAlertSuppressedCodes: []string{
			" duplicate_skips_detected ",
			"failed_actions_detected",
			"duplicate_skips_detected",
		},
		TurnPolicyAlertAcknowledgedCodes: []string{
			" audit_coverage_incomplete ",
			"cooldown_skips_detected",
			"audit_coverage_incomplete",
		},
		TurnPolicyAlertSnoozedCodes: []string{
			" cooldown_skips_detected ",
			"failed_actions_detected",
			"cooldown_skips_detected",
		},
		TurnPolicyAlertSnoozeUntil: &snoozeUntil,
	})
	if err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	if written.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled == nil || *written.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled {
		t.Fatalf("unexpected configured post-tool-use policy override %#v", written.ConfiguredTurnPolicyPostToolUseFailedValidationEnabled)
	}
	if written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled == nil || *written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled {
		t.Fatalf("unexpected configured stop-missing-verify policy override %#v", written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled)
	}
	if written.ConfiguredTurnPolicyPostToolUsePrimaryAction != "interrupt" {
		t.Fatalf("unexpected configured post-tool-use primary action %q", written.ConfiguredTurnPolicyPostToolUsePrimaryAction)
	}
	if written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction != "steer" {
		t.Fatalf("unexpected configured stop-missing-verify primary action %q", written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction)
	}
	if written.ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior != "followUp" {
		t.Fatalf("unexpected configured post-tool-use interrupt fallback %q", written.ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior)
	}
	if written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != "skip" {
		t.Fatalf("unexpected configured stop-missing-verify interrupt fallback %q", written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior)
	}
	if written.ConfiguredTurnPolicyFollowUpCooldownMs == nil || *written.ConfiguredTurnPolicyFollowUpCooldownMs != 45000 {
		t.Fatalf("unexpected configured follow-up cooldown %#v", written.ConfiguredTurnPolicyFollowUpCooldownMs)
	}
	if written.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs == nil || *written.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs != 0 {
		t.Fatalf("unexpected configured post-tool-use follow-up cooldown %#v", written.ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs)
	}
	if written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs == nil || *written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != 120000 {
		t.Fatalf("unexpected configured stop-missing-verify follow-up cooldown %#v", written.ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	}
	if written.ConfiguredTurnPolicyAlertCoverageThresholdPercent == nil || *written.ConfiguredTurnPolicyAlertCoverageThresholdPercent != 65 {
		t.Fatalf("unexpected configured coverage threshold %#v", written.ConfiguredTurnPolicyAlertCoverageThresholdPercent)
	}
	if written.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs == nil || *written.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs != 2400 {
		t.Fatalf("unexpected configured post-tool-use latency threshold %#v", written.ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	}
	if written.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs == nil || *written.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs != 3100 {
		t.Fatalf("unexpected configured stop latency threshold %#v", written.ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs)
	}
	if written.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent == nil || *written.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent != 72 {
		t.Fatalf("unexpected configured source success threshold %#v", written.ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent)
	}
	if len(written.ConfiguredTurnPolicyAlertSuppressedCodes) != 2 ||
		written.ConfiguredTurnPolicyAlertSuppressedCodes[0] != "duplicate_skips_detected" ||
		written.ConfiguredTurnPolicyAlertSuppressedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected configured suppressed alert codes %#v", written.ConfiguredTurnPolicyAlertSuppressedCodes)
	}
	if len(written.ConfiguredTurnPolicyAlertAcknowledgedCodes) != 2 ||
		written.ConfiguredTurnPolicyAlertAcknowledgedCodes[0] != "audit_coverage_incomplete" ||
		written.ConfiguredTurnPolicyAlertAcknowledgedCodes[1] != "cooldown_skips_detected" {
		t.Fatalf("unexpected configured acknowledged alert codes %#v", written.ConfiguredTurnPolicyAlertAcknowledgedCodes)
	}
	if len(written.ConfiguredTurnPolicyAlertSnoozedCodes) != 2 ||
		written.ConfiguredTurnPolicyAlertSnoozedCodes[0] != "cooldown_skips_detected" ||
		written.ConfiguredTurnPolicyAlertSnoozedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected configured snoozed alert codes %#v", written.ConfiguredTurnPolicyAlertSnoozedCodes)
	}
	expectedSnoozeUntil := snoozeUntil.UTC()
	if written.ConfiguredTurnPolicyAlertSnoozeUntil == nil || !written.ConfiguredTurnPolicyAlertSnoozeUntil.Equal(expectedSnoozeUntil) {
		t.Fatalf("unexpected configured alert snooze until %#v", written.ConfiguredTurnPolicyAlertSnoozeUntil)
	}
	if written.ConfiguredTurnPolicyAlertSnoozeUntil != nil && written.ConfiguredTurnPolicyAlertSnoozeUntil.Location() != time.UTC {
		t.Fatalf("expected configured alert snooze until to be UTC, got %#v", written.ConfiguredTurnPolicyAlertSnoozeUntil.Location())
	}
	if !written.ConfiguredTurnPolicyAlertSnoozeActive {
		t.Fatalf("expected configured alert snooze to be active")
	}
	if written.ConfiguredTurnPolicyAlertSnoozeExpired {
		t.Fatalf("expected configured alert snooze to not be expired")
	}
	if written.EffectiveTurnPolicyPostToolUseFailedValidationEnabled ||
		written.EffectiveTurnPolicyStopMissingSuccessfulVerificationEnabled ||
		written.EffectiveTurnPolicyPostToolUsePrimaryAction != "interrupt" ||
		written.EffectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction != "steer" ||
		written.EffectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior != "followUp" ||
		written.EffectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != "skip" ||
		written.EffectiveTurnPolicyFollowUpCooldownMs != 45000 ||
		written.EffectiveTurnPolicyPostToolUseFollowUpCooldownMs != 0 ||
		written.EffectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != 120000 ||
		written.EffectiveTurnPolicyAlertCoverageThresholdPercent != 65 ||
		written.EffectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs != 2400 ||
		written.EffectiveTurnPolicyAlertStopLatencyP95ThresholdMs != 3100 ||
		written.EffectiveTurnPolicyAlertSourceActionSuccessThresholdPercent != 72 {
		t.Fatalf("unexpected effective thresholds %#v", written)
	}
	if len(written.EffectiveTurnPolicyAlertSuppressedCodes) != 2 ||
		written.EffectiveTurnPolicyAlertSuppressedCodes[0] != "duplicate_skips_detected" ||
		written.EffectiveTurnPolicyAlertSuppressedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected effective suppressed alert codes %#v", written.EffectiveTurnPolicyAlertSuppressedCodes)
	}
	if len(written.EffectiveTurnPolicyAlertAcknowledgedCodes) != 2 ||
		written.EffectiveTurnPolicyAlertAcknowledgedCodes[0] != "audit_coverage_incomplete" ||
		written.EffectiveTurnPolicyAlertAcknowledgedCodes[1] != "cooldown_skips_detected" {
		t.Fatalf("unexpected effective acknowledged alert codes %#v", written.EffectiveTurnPolicyAlertAcknowledgedCodes)
	}
	if len(written.EffectiveTurnPolicyAlertSnoozedCodes) != 2 ||
		written.EffectiveTurnPolicyAlertSnoozedCodes[0] != "cooldown_skips_detected" ||
		written.EffectiveTurnPolicyAlertSnoozedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected effective snoozed alert codes %#v", written.EffectiveTurnPolicyAlertSnoozedCodes)
	}
	if written.EffectiveTurnPolicyAlertSnoozeUntil == nil || !written.EffectiveTurnPolicyAlertSnoozeUntil.Equal(expectedSnoozeUntil) {
		t.Fatalf("unexpected effective alert snooze until %#v", written.EffectiveTurnPolicyAlertSnoozeUntil)
	}

	stored := dataStore.GetRuntimePreferences()
	if stored.TurnPolicyPostToolUseFailedValidationEnabled == nil || *stored.TurnPolicyPostToolUseFailedValidationEnabled {
		t.Fatalf("unexpected stored post-tool-use policy override %#v", stored.TurnPolicyPostToolUseFailedValidationEnabled)
	}
	if stored.TurnPolicyStopMissingSuccessfulVerificationEnabled == nil || *stored.TurnPolicyStopMissingSuccessfulVerificationEnabled {
		t.Fatalf("unexpected stored stop-missing-verify policy override %#v", stored.TurnPolicyStopMissingSuccessfulVerificationEnabled)
	}
	if stored.TurnPolicyPostToolUsePrimaryAction != "interrupt" {
		t.Fatalf("unexpected stored post-tool-use primary action %q", stored.TurnPolicyPostToolUsePrimaryAction)
	}
	if stored.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction != "steer" {
		t.Fatalf("unexpected stored stop-missing-verify primary action %q", stored.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction)
	}
	if stored.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior != "followUp" {
		t.Fatalf("unexpected stored post-tool-use interrupt fallback %q", stored.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior)
	}
	if stored.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior != "skip" {
		t.Fatalf("unexpected stored stop-missing-verify interrupt fallback %q", stored.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior)
	}
	if stored.TurnPolicyFollowUpCooldownMs == nil || *stored.TurnPolicyFollowUpCooldownMs != 45000 {
		t.Fatalf("unexpected stored follow-up cooldown %#v", stored.TurnPolicyFollowUpCooldownMs)
	}
	if stored.TurnPolicyPostToolUseFollowUpCooldownMs == nil || *stored.TurnPolicyPostToolUseFollowUpCooldownMs != 0 {
		t.Fatalf("unexpected stored post-tool-use follow-up cooldown %#v", stored.TurnPolicyPostToolUseFollowUpCooldownMs)
	}
	if stored.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs == nil || *stored.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != 120000 {
		t.Fatalf("unexpected stored stop-missing-verify follow-up cooldown %#v", stored.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs)
	}
	if stored.TurnPolicyAlertCoverageThresholdPercent == nil || *stored.TurnPolicyAlertCoverageThresholdPercent != 65 {
		t.Fatalf("unexpected stored coverage threshold %#v", stored.TurnPolicyAlertCoverageThresholdPercent)
	}
	if stored.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs == nil || *stored.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs != 2400 {
		t.Fatalf("unexpected stored post-tool-use latency threshold %#v", stored.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs)
	}
	if stored.TurnPolicyAlertStopLatencyP95ThresholdMs == nil || *stored.TurnPolicyAlertStopLatencyP95ThresholdMs != 3100 {
		t.Fatalf("unexpected stored stop latency threshold %#v", stored.TurnPolicyAlertStopLatencyP95ThresholdMs)
	}
	if stored.TurnPolicyAlertSourceActionSuccessThresholdPercent == nil || *stored.TurnPolicyAlertSourceActionSuccessThresholdPercent != 72 {
		t.Fatalf("unexpected stored source success threshold %#v", stored.TurnPolicyAlertSourceActionSuccessThresholdPercent)
	}
	if len(stored.TurnPolicyAlertSuppressedCodes) != 2 ||
		stored.TurnPolicyAlertSuppressedCodes[0] != "duplicate_skips_detected" ||
		stored.TurnPolicyAlertSuppressedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected stored suppressed alert codes %#v", stored.TurnPolicyAlertSuppressedCodes)
	}
	if len(stored.TurnPolicyAlertAcknowledgedCodes) != 2 ||
		stored.TurnPolicyAlertAcknowledgedCodes[0] != "audit_coverage_incomplete" ||
		stored.TurnPolicyAlertAcknowledgedCodes[1] != "cooldown_skips_detected" {
		t.Fatalf("unexpected stored acknowledged alert codes %#v", stored.TurnPolicyAlertAcknowledgedCodes)
	}
	if len(stored.TurnPolicyAlertSnoozedCodes) != 2 ||
		stored.TurnPolicyAlertSnoozedCodes[0] != "cooldown_skips_detected" ||
		stored.TurnPolicyAlertSnoozedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected stored snoozed alert codes %#v", stored.TurnPolicyAlertSnoozedCodes)
	}
	if stored.TurnPolicyAlertSnoozeUntil == nil || !stored.TurnPolicyAlertSnoozeUntil.Equal(expectedSnoozeUntil) {
		t.Fatalf("unexpected stored alert snooze until %#v", stored.TurnPolicyAlertSnoozeUntil)
	}
	if stored.TurnPolicyAlertSnoozeUntil != nil && stored.TurnPolicyAlertSnoozeUntil.Location() != time.UTC {
		t.Fatalf("expected stored alert snooze until to be UTC, got %#v", stored.TurnPolicyAlertSnoozeUntil.Location())
	}
}

func TestRuntimePreferencesReadExpiresTurnPolicyAlertSnooze(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	expiredAt := time.Date(2026, time.April, 8, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		TurnPolicyAlertSnoozedCodes: []string{
			" failed_actions_detected ",
			"cooldown_skips_detected",
			"failed_actions_detected",
		},
		TurnPolicyAlertSnoozeUntil: &expiredAt,
	})
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	result, err := service.Read()
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}

	expectedConfiguredUntil := expiredAt.UTC()
	if len(result.ConfiguredTurnPolicyAlertSnoozedCodes) != 2 ||
		result.ConfiguredTurnPolicyAlertSnoozedCodes[0] != "cooldown_skips_detected" ||
		result.ConfiguredTurnPolicyAlertSnoozedCodes[1] != "failed_actions_detected" {
		t.Fatalf("unexpected configured snoozed alert codes %#v", result.ConfiguredTurnPolicyAlertSnoozedCodes)
	}
	if result.ConfiguredTurnPolicyAlertSnoozeUntil == nil || !result.ConfiguredTurnPolicyAlertSnoozeUntil.Equal(expectedConfiguredUntil) {
		t.Fatalf("unexpected configured alert snooze until %#v", result.ConfiguredTurnPolicyAlertSnoozeUntil)
	}
	if result.ConfiguredTurnPolicyAlertSnoozeActive {
		t.Fatalf("expected expired configured alert snooze to be inactive")
	}
	if !result.ConfiguredTurnPolicyAlertSnoozeExpired {
		t.Fatalf("expected expired configured alert snooze to be marked expired")
	}
	if len(result.EffectiveTurnPolicyAlertSnoozedCodes) != 0 {
		t.Fatalf("expected expired snoozed alert codes to be ineffective, got %#v", result.EffectiveTurnPolicyAlertSnoozedCodes)
	}
	if result.EffectiveTurnPolicyAlertSnoozeUntil != nil {
		t.Fatalf("expected expired alert snooze until to be ineffective, got %#v", result.EffectiveTurnPolicyAlertSnoozeUntil)
	}
}

func TestRuntimePreferencesWriteRejectsInvalidTurnPolicyAlertThresholds(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	_, err := service.Write(WriteInput{
		TurnPolicyFollowUpCooldownMs: int64Ptr(-1),
	})
	if err == nil || !strings.Contains(err.Error(), "follow-up cooldown") {
		t.Fatalf("expected follow-up cooldown validation error, got %v", err)
	}

	_, err = service.Write(WriteInput{
		TurnPolicyPostToolUseFollowUpCooldownMs: int64Ptr(-1),
	})
	if err == nil || !strings.Contains(err.Error(), "post-tool-use follow-up cooldown") {
		t.Fatalf("expected post-tool-use follow-up cooldown validation error, got %v", err)
	}

	_, err = service.Write(WriteInput{
		TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: int64Ptr(-1),
	})
	if err == nil || !strings.Contains(err.Error(), "stop-missing-successful-verification follow-up cooldown") {
		t.Fatalf("expected stop-missing-verify follow-up cooldown validation error, got %v", err)
	}

	_, err = service.Write(WriteInput{
		TurnPolicyAlertCoverageThresholdPercent: intPtr(101),
	})
	if err == nil || !strings.Contains(err.Error(), "coverage threshold") {
		t.Fatalf("expected coverage threshold validation error, got %v", err)
	}

	_, err = service.Write(WriteInput{
		TurnPolicyAlertPostToolUseLatencyP95ThresholdMs: int64Ptr(-1),
	})
	if err == nil || !strings.Contains(err.Error(), "post-tool-use latency") {
		t.Fatalf("expected post-tool-use latency validation error, got %v", err)
	}

	_, err = service.Write(WriteInput{
		TurnPolicyPostToolUsePrimaryAction: "noop",
	})
	if err == nil || !strings.Contains(err.Error(), "post-tool-use primary action") {
		t.Fatalf("expected post-tool-use primary action validation error, got %v", err)
	}

	_, err = service.Write(WriteInput{
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction: "noop",
	})
	if err == nil || !strings.Contains(err.Error(), "stop-missing-successful-verification primary action") {
		t.Fatalf("expected stop-missing-verify primary action validation error, got %v", err)
	}

	_, err = service.Write(WriteInput{
		TurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "steer",
	})
	if err == nil || !strings.Contains(err.Error(), "post-tool-use interrupt no-active-turn behavior") {
		t.Fatalf("expected post-tool-use interrupt fallback validation error, got %v", err)
	}

	_, err = service.Write(WriteInput{
		TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: "interrupt",
	})
	if err == nil || !strings.Contains(err.Error(), "stop-missing-successful-verification interrupt no-active-turn behavior") {
		t.Fatalf("expected stop-missing-verify interrupt fallback validation error, got %v", err)
	}
}

func TestRuntimePreferencesWriteRecordsTurnPolicyAlertGovernanceHistory(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)
	snoozeUntil := time.Date(2026, time.April, 10, 12, 0, 0, 0, time.UTC)

	written, err := service.Write(WriteInput{
		TurnPolicyAlertAcknowledgedCodes: []string{" failed_actions_detected "},
		TurnPolicyAlertGovernanceEvent: &TurnPolicyAlertGovernanceEventInput{
			Action: "acknowledge",
			Source: "workspace-overview",
			Codes:  []string{" failed_actions_detected "},
		},
	})
	if err != nil {
		t.Fatalf("Write() acknowledge error = %v", err)
	}
	if len(written.TurnPolicyAlertGovernanceHistory) != 1 {
		t.Fatalf("expected 1 governance event after acknowledge, got %#v", written.TurnPolicyAlertGovernanceHistory)
	}
	first := written.TurnPolicyAlertGovernanceHistory[0]
	if first.Action != "acknowledge" || first.Source != "workspace-overview" {
		t.Fatalf("unexpected first governance event %#v", first)
	}
	if len(first.Codes) != 1 || first.Codes[0] != "failed_actions_detected" {
		t.Fatalf("unexpected first governance event codes %#v", first)
	}
	if first.SnoozeUntil != nil {
		t.Fatalf("expected acknowledge event to omit snooze until, got %#v", first)
	}
	if first.ID == "" || first.CreatedAt.IsZero() {
		t.Fatalf("expected acknowledge event metadata to be populated, got %#v", first)
	}

	written, err = service.Write(WriteInput{
		TurnPolicyAlertAcknowledgedCodes: []string{"failed_actions_detected"},
		TurnPolicyAlertSnoozedCodes:      []string{"cooldown_skips_detected"},
		TurnPolicyAlertSnoozeUntil:       &snoozeUntil,
		TurnPolicyAlertGovernanceEvent: &TurnPolicyAlertGovernanceEventInput{
			Action:      "snooze24h",
			Source:      "thread-metrics",
			Codes:       []string{"cooldown_skips_detected"},
			SnoozeUntil: &snoozeUntil,
		},
	})
	if err != nil {
		t.Fatalf("Write() snooze error = %v", err)
	}
	if len(written.TurnPolicyAlertGovernanceHistory) != 2 {
		t.Fatalf("expected 2 governance events after snooze, got %#v", written.TurnPolicyAlertGovernanceHistory)
	}
	latest := written.TurnPolicyAlertGovernanceHistory[0]
	previous := written.TurnPolicyAlertGovernanceHistory[1]
	if latest.Action != "snooze24h" || latest.Source != "thread-metrics" {
		t.Fatalf("unexpected latest governance event %#v", latest)
	}
	if latest.SnoozeUntil == nil || !latest.SnoozeUntil.Equal(snoozeUntil) {
		t.Fatalf("expected snooze event to carry snooze until %v, got %#v", snoozeUntil, latest)
	}
	if previous.Action != "acknowledge" {
		t.Fatalf("expected newest-first ordering, got %#v", written.TurnPolicyAlertGovernanceHistory)
	}
}

func TestRuntimePreferencesWriteSkipsGovernanceHistoryWithoutMetadataOrChange(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", events.NewHub())
	service := NewService(
		dataStore,
		runtimeManager,
		"codex app-server --listen stdio://",
		"",
		nil,
		"",
		true,
		false,
		"",
		"",
	)

	written, err := service.Write(WriteInput{
		TurnPolicyAlertAcknowledgedCodes: []string{"failed_actions_detected"},
	})
	if err != nil {
		t.Fatalf("Write() without metadata error = %v", err)
	}
	if len(written.TurnPolicyAlertGovernanceHistory) != 0 {
		t.Fatalf("expected no governance history without metadata, got %#v", written.TurnPolicyAlertGovernanceHistory)
	}

	written, err = service.Write(WriteInput{
		TurnPolicyAlertAcknowledgedCodes: []string{"failed_actions_detected"},
		TurnPolicyAlertGovernanceEvent: &TurnPolicyAlertGovernanceEventInput{
			Action: "acknowledge",
			Source: "workspace-overview",
			Codes:  []string{"failed_actions_detected"},
		},
	})
	if err != nil {
		t.Fatalf("Write() with unchanged metadata error = %v", err)
	}
	if len(written.TurnPolicyAlertGovernanceHistory) != 0 {
		t.Fatalf("expected unchanged governance state not to record history, got %#v", written.TurnPolicyAlertGovernanceHistory)
	}
}

func intPtr(value int) *int {
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

func int64Ptr(value int64) *int64 {
	return &value
}
