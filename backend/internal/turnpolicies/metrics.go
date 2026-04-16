package turnpolicies

import (
	"math"
	"sort"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

const metricsCoverageDefinition = "Coverage is measured only for turns that currently match implemented policy predicates: a failed validation command or a completed turn with file changes but no later successful validation command. A turn is covered when at least one persisted turn policy decision exists for that turn."
const metricsCoverageDefinitionKey = "turn-policy.metrics.coverage-definition"

const (
	DefaultAlertCoverageThresholdPercent                  = 100
	DefaultAlertPostToolUseLatencyP95ThresholdMs    int64 = 1000
	DefaultAlertStopLatencyP95ThresholdMs           int64 = 1000
	DefaultAlertSourceActionSuccessThresholdPercent       = 100
)

type MetricsAlertThresholds struct {
	CoverageThresholdPercent            int
	PostToolUseLatencyP95ThresholdMs    int64
	StopLatencyP95ThresholdMs           int64
	SourceActionSuccessThresholdPercent int
}

type MetricsConfigSummary struct {
	PostToolUseFailedValidationPolicyEnabled                       bool     `json:"postToolUseFailedValidationPolicyEnabled"`
	StopMissingSuccessfulVerificationPolicyEnabled                 bool     `json:"stopMissingSuccessfulVerificationPolicyEnabled"`
	PostToolUsePrimaryAction                                       string   `json:"postToolUsePrimaryAction"`
	StopMissingSuccessfulVerificationPrimaryAction                 string   `json:"stopMissingSuccessfulVerificationPrimaryAction"`
	PostToolUseInterruptNoActiveTurnBehavior                       string   `json:"postToolUseInterruptNoActiveTurnBehavior"`
	StopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior string   `json:"stopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"`
	ValidationCommandPrefixes                                      []string `json:"validationCommandPrefixes"`
	PostToolUseFollowUpCooldownMs                                  int64    `json:"postToolUseFollowUpCooldownMs"`
	StopMissingSuccessfulVerificationFollowUpCooldownMs            int64    `json:"stopMissingSuccessfulVerificationFollowUpCooldownMs"`
	FollowUpCooldownMs                                             int64    `json:"followUpCooldownMs"`
}

type MetricsSummary struct {
	WorkspaceID   string                      `json:"workspaceId"`
	ThreadID      string                      `json:"threadId,omitempty"`
	Source        string                      `json:"source,omitempty"`
	GeneratedAt   time.Time                   `json:"generatedAt"`
	Config        MetricsConfigSummary        `json:"config"`
	AlertPolicy   MetricsAlertPolicySummary   `json:"alertPolicy"`
	Alerts        []MetricsAlert              `json:"alerts"`
	History       MetricsHistorySummary       `json:"history"`
	RecentWindows MetricsRecentWindowsSummary `json:"recentWindows"`
	Decisions     MetricsDecisionSummary      `json:"decisions"`
	Sources       MetricsSourceBreakdown      `json:"sources"`
	Timings       MetricsTimingSummary        `json:"timings"`
	Turns         MetricsTurnSummary          `json:"turns"`
	Audit         MetricsAuditSummary         `json:"audit"`
}

type MetricsAlert struct {
	Code         string `json:"code"`
	Severity     string `json:"severity"`
	Title        string `json:"title"`
	Message      string `json:"message"`
	Rank         int    `json:"rank"`
	Acknowledged bool   `json:"acknowledged"`
	Source       string `json:"source,omitempty"`
	ActionStatus string `json:"actionStatus,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

type MetricsAlertPolicySummary struct {
	SuppressedCodes   []string   `json:"suppressedCodes"`
	SuppressedCount   int        `json:"suppressedCount"`
	AcknowledgedCodes []string   `json:"acknowledgedCodes"`
	AcknowledgedCount int        `json:"acknowledgedCount"`
	SnoozedCodes      []string   `json:"snoozedCodes"`
	SnoozedCount      int        `json:"snoozedCount"`
	SnoozeUntil       *time.Time `json:"snoozeUntil,omitempty"`
}

type MetricsHistorySummary struct {
	DailyLast7Days    []MetricsHistoryBucketSummary `json:"dailyLast7Days"`
	DailyLast30Days   []MetricsHistoryBucketSummary `json:"dailyLast30Days"`
	DailyLast90Days   []MetricsHistoryBucketSummary `json:"dailyLast90Days"`
	WeeklyLast12Weeks []MetricsHistoryBucketSummary `json:"weeklyLast12Weeks"`
}

type MetricsRecentWindowsSummary struct {
	LastHour    MetricsRecentWindowSummary `json:"lastHour"`
	Last24Hours MetricsRecentWindowSummary `json:"last24Hours"`
}

type MetricsHistoryBucketSummary = MetricsRecentWindowSummary

type MetricsRecentWindowSummary struct {
	Since       time.Time                          `json:"since"`
	Until       time.Time                          `json:"until"`
	AlertsCount int                                `json:"alertsCount"`
	Decisions   MetricsRecentWindowDecisionSummary `json:"decisions"`
	Timings     MetricsTimingSummary               `json:"timings"`
}

type MetricsRecentWindowDecisionSummary struct {
	Total             int     `json:"total"`
	ActionAttempts    int     `json:"actionAttempts"`
	ActionSucceeded   int     `json:"actionSucceeded"`
	ActionSuccessRate float64 `json:"actionSuccessRate"`
	Skipped           int     `json:"skipped"`
}

type MetricsDecisionSummary struct {
	Total              int                       `json:"total"`
	ActionAttempts     int                       `json:"actionAttempts"`
	ActionSucceeded    int                       `json:"actionSucceeded"`
	ActionSuccessRate  float64                   `json:"actionSuccessRate"`
	ActionStatusCounts MetricsActionStatusCounts `json:"actionStatusCounts"`
	ActionCounts       MetricsActionCounts       `json:"actionCounts"`
	PolicyCounts       MetricsPolicyCounts       `json:"policyCounts"`
	SkipReasonCounts   MetricsSkipReasonCounts   `json:"skipReasonCounts"`
}

type MetricsTimingSummary struct {
	PostToolUseDecisionLatency MetricsLatencyPercentiles `json:"postToolUseDecisionLatency"`
	StopDecisionLatency        MetricsLatencyPercentiles `json:"stopDecisionLatency"`
}

type MetricsSourceBreakdown struct {
	Interactive MetricsSourceSummary `json:"interactive"`
	Automation  MetricsSourceSummary `json:"automation"`
	Bot         MetricsSourceSummary `json:"bot"`
	Other       MetricsSourceSummary `json:"other"`
}

type MetricsSourceSummary struct {
	Total             int     `json:"total"`
	ActionAttempts    int     `json:"actionAttempts"`
	ActionSucceeded   int     `json:"actionSucceeded"`
	ActionSuccessRate float64 `json:"actionSuccessRate"`
	Skipped           int     `json:"skipped"`
}

type MetricsLatencyPercentiles struct {
	P50Ms int64 `json:"p50Ms"`
	P95Ms int64 `json:"p95Ms"`
}

type MetricsActionStatusCounts struct {
	Succeeded int `json:"succeeded"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped"`
	Other     int `json:"other"`
}

type MetricsActionCounts struct {
	Steer     int `json:"steer"`
	FollowUp  int `json:"followUp"`
	Interrupt int `json:"interrupt"`
	None      int `json:"none"`
	Other     int `json:"other"`
}

type MetricsPolicyCounts struct {
	FailedValidationCommand       int `json:"failedValidationCommand"`
	MissingSuccessfulVerification int `json:"missingSuccessfulVerification"`
	Other                         int `json:"other"`
}

type MetricsSkipReasonCounts struct {
	Total                  int `json:"total"`
	DuplicateFingerprint   int `json:"duplicateFingerprint"`
	FollowUpCooldownActive int `json:"followUpCooldownActive"`
	InterruptNoActiveTurn  int `json:"interruptNoActiveTurn"`
	Other                  int `json:"other"`
}

type MetricsTurnSummary struct {
	CompletedWithFileChange              int     `json:"completedWithFileChange"`
	MissingSuccessfulVerification        int     `json:"missingSuccessfulVerification"`
	MissingSuccessfulVerificationRate    float64 `json:"missingSuccessfulVerificationRate"`
	FailedValidationCommand              int     `json:"failedValidationCommand"`
	FailedValidationWithPolicyAction     int     `json:"failedValidationWithPolicyAction"`
	FailedValidationWithPolicyActionRate float64 `json:"failedValidationWithPolicyActionRate"`
}

type MetricsAuditSummary struct {
	CoveredTurns          int     `json:"coveredTurns"`
	EligibleTurns         int     `json:"eligibleTurns"`
	CoverageRate          float64 `json:"coverageRate"`
	CoverageDefinition    string  `json:"coverageDefinition"`
	CoverageDefinitionKey string  `json:"coverageDefinitionKey,omitempty"`
}

type turnAnalysis struct {
	threadID                      string
	turnID                        string
	hasCompletedFileChange        bool
	missingSuccessfulVerification bool
	hasFailedValidationCommand    bool
}

type turnDecisionFacts struct {
	hasAuditRecord                  bool
	hasFailedValidationPolicyAction bool
}

func (s *Service) Metrics(workspaceID string, threadID string, source string) (MetricsSummary, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	threadID = strings.TrimSpace(threadID)
	source = strings.TrimSpace(source)
	generatedAt := s.now()

	summary := MetricsSummary{
		WorkspaceID: workspaceID,
		ThreadID:    threadID,
		Source:      source,
		GeneratedAt: generatedAt,
		Config:      MetricsConfigSummary{},
		AlertPolicy: MetricsAlertPolicySummary{
			SuppressedCodes:   []string{},
			AcknowledgedCodes: []string{},
			SnoozedCodes:      []string{},
		},
		Alerts: []MetricsAlert{},
		History: MetricsHistorySummary{
			DailyLast7Days:    []MetricsHistoryBucketSummary{},
			DailyLast30Days:   []MetricsHistoryBucketSummary{},
			DailyLast90Days:   []MetricsHistoryBucketSummary{},
			WeeklyLast12Weeks: []MetricsHistoryBucketSummary{},
		},
		Audit: MetricsAuditSummary{
			CoverageDefinition:    metricsCoverageDefinition,
			CoverageDefinitionKey: metricsCoverageDefinitionKey,
		},
	}
	if s.store == nil {
		return summary, nil
	}
	if _, ok := s.store.GetWorkspace(workspaceID); !ok {
		return MetricsSummary{}, store.ErrWorkspaceNotFound
	}
	prefs := s.store.GetRuntimePreferences()
	runtimeConfig := ResolveRuntimeConfig(prefs)
	suppressedAlertCodes := ResolveAlertSuppressedCodes(prefs)
	acknowledgedAlertCodes := ResolveAlertAcknowledgedCodes(prefs)
	snoozedAlertCodes, snoozeUntil := ResolveAlertSnooze(prefs, generatedAt)
	summary.Config = MetricsConfigSummary{
		PostToolUseFailedValidationPolicyEnabled:                       runtimeConfig.PostToolUseFailedValidationEnabled,
		StopMissingSuccessfulVerificationPolicyEnabled:                 runtimeConfig.StopMissingVerificationEnabled,
		PostToolUsePrimaryAction:                                       runtimeConfig.PostToolUsePrimaryAction,
		StopMissingSuccessfulVerificationPrimaryAction:                 runtimeConfig.StopMissingVerificationPrimaryAction,
		PostToolUseInterruptNoActiveTurnBehavior:                       runtimeConfig.PostToolUseInterruptNoActiveTurnBehavior,
		StopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: runtimeConfig.StopMissingVerificationInterruptNoActiveTurnBehavior,
		ValidationCommandPrefixes:                                      cloneMetricsStringSlice(runtimeConfig.ValidationCommandPrefixes),
		PostToolUseFollowUpCooldownMs:                                  runtimeConfig.PostToolUseFollowUpCooldownMs,
		StopMissingSuccessfulVerificationFollowUpCooldownMs:            runtimeConfig.StopMissingVerificationFollowUpCooldownMs,
		FollowUpCooldownMs:                                             runtimeConfig.FollowUpCooldownMs,
	}
	summary.AlertPolicy.SuppressedCodes = cloneMetricsStringSlice(suppressedAlertCodes)
	summary.AlertPolicy.AcknowledgedCodes = cloneMetricsStringSlice(acknowledgedAlertCodes)
	summary.AlertPolicy.SnoozedCodes = cloneMetricsStringSlice(snoozedAlertCodes)
	summary.AlertPolicy.SnoozeUntil = cloneMetricsOptionalTime(snoozeUntil)

	decisions := filterMetricsDecisionsBySource(s.store.ListTurnPolicyDecisions(workspaceID, threadID), source)
	thresholds := ResolveMetricsAlertThresholds(prefs)
	summary.Decisions = aggregateDecisionSummary(decisions)
	summary.Sources = aggregateSourceBreakdown(decisions)
	summary.Timings = aggregateDecisionTimings(decisions)
	summary.RecentWindows = aggregateRecentWindows(
		generatedAt,
		decisions,
		thresholds,
		suppressedAlertCodes,
		snoozedAlertCodes,
	)
	summary.History = aggregateMetricsHistory(
		generatedAt,
		decisions,
		thresholds,
		suppressedAlertCodes,
		snoozedAlertCodes,
	)

	decisionFactsByTurn := aggregateDecisionFacts(decisions)
	turns := s.analyzeTurns(workspaceID, threadID, runtimeConfig.ValidationCommandPrefixes)
	summary.Turns, summary.Audit = aggregateTurnSummary(
		turns,
		decisionFactsByTurn,
		summary.Audit.CoverageDefinition,
		summary.Audit.CoverageDefinitionKey,
		runtimeConfig,
	)
	summary.Alerts, summary.AlertPolicy.SuppressedCount, summary.AlertPolicy.AcknowledgedCount, summary.AlertPolicy.SnoozedCount = applyMetricsAlertPolicies(
		buildMetricsAlerts(summary, thresholds),
		suppressedAlertCodes,
		acknowledgedAlertCodes,
		snoozedAlertCodes,
	)

	return summary, nil
}

func ResolveMetricsAlertThresholds(prefs store.RuntimePreferences) MetricsAlertThresholds {
	thresholds := MetricsAlertThresholds{
		CoverageThresholdPercent:            DefaultAlertCoverageThresholdPercent,
		PostToolUseLatencyP95ThresholdMs:    DefaultAlertPostToolUseLatencyP95ThresholdMs,
		StopLatencyP95ThresholdMs:           DefaultAlertStopLatencyP95ThresholdMs,
		SourceActionSuccessThresholdPercent: DefaultAlertSourceActionSuccessThresholdPercent,
	}

	if prefs.TurnPolicyAlertCoverageThresholdPercent != nil &&
		*prefs.TurnPolicyAlertCoverageThresholdPercent >= 0 &&
		*prefs.TurnPolicyAlertCoverageThresholdPercent <= 100 {
		thresholds.CoverageThresholdPercent = *prefs.TurnPolicyAlertCoverageThresholdPercent
	}
	if prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs != nil &&
		*prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs >= 0 {
		thresholds.PostToolUseLatencyP95ThresholdMs = *prefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs
	}
	if prefs.TurnPolicyAlertStopLatencyP95ThresholdMs != nil &&
		*prefs.TurnPolicyAlertStopLatencyP95ThresholdMs >= 0 {
		thresholds.StopLatencyP95ThresholdMs = *prefs.TurnPolicyAlertStopLatencyP95ThresholdMs
	}
	if prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent != nil &&
		*prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent >= 0 &&
		*prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent <= 100 {
		thresholds.SourceActionSuccessThresholdPercent = *prefs.TurnPolicyAlertSourceActionSuccessThresholdPercent
	}

	return thresholds
}

func ResolveAlertSuppressedCodes(prefs store.RuntimePreferences) []string {
	return normalizeMetricsStringSlice(prefs.TurnPolicyAlertSuppressedCodes)
}

func ResolveAlertAcknowledgedCodes(prefs store.RuntimePreferences) []string {
	return normalizeMetricsStringSlice(prefs.TurnPolicyAlertAcknowledgedCodes)
}

func ResolveAlertSnooze(prefs store.RuntimePreferences, now time.Time) ([]string, *time.Time) {
	snoozeUntil := cloneMetricsOptionalTime(prefs.TurnPolicyAlertSnoozeUntil)
	if snoozeUntil == nil || !now.Before(*snoozeUntil) {
		return []string{}, nil
	}

	return normalizeMetricsStringSlice(prefs.TurnPolicyAlertSnoozedCodes), snoozeUntil
}

func buildMetricsAlerts(summary MetricsSummary, thresholds MetricsAlertThresholds) []MetricsAlert {
	alerts := make([]MetricsAlert, 0, 8)
	coverageThreshold := float64(thresholds.CoverageThresholdPercent) / 100
	sourceActionSuccessThreshold := float64(thresholds.SourceActionSuccessThresholdPercent) / 100

	if summary.Audit.EligibleTurns > 0 && summary.Audit.CoverageRate < coverageThreshold {
		alerts = append(alerts, MetricsAlert{
			Code:     "audit_coverage_incomplete",
			Severity: "warning",
			Title:    "Audit coverage is incomplete",
			Message:  "Not every eligible turn has a persisted turn policy decision yet.",
		})
	}
	if summary.Decisions.ActionStatusCounts.Failed > 0 {
		alerts = append(alerts, MetricsAlert{
			Code:         "failed_actions_detected",
			Severity:     "warning",
			Title:        "Failed actions need attention",
			Message:      "One or more turn policy actions failed during execution.",
			ActionStatus: actionStatusFailed,
		})
	}
	if summary.Decisions.SkipReasonCounts.DuplicateFingerprint > 0 {
		alerts = append(alerts, MetricsAlert{
			Code:         "duplicate_skips_detected",
			Severity:     "info",
			Title:        "Duplicate skips are accumulating",
			Message:      "Duplicate fingerprints are suppressing repeated turn policy actions.",
			ActionStatus: actionStatusSkipped,
			Reason:       "duplicate_fingerprint",
		})
	}
	if summary.Decisions.SkipReasonCounts.FollowUpCooldownActive > 0 {
		alerts = append(alerts, MetricsAlert{
			Code:         "cooldown_skips_detected",
			Severity:     "info",
			Title:        "Cooldown skips are active",
			Message:      "Follow-up cooldown is suppressing repeated turn policy actions.",
			ActionStatus: actionStatusSkipped,
			Reason:       "follow_up_cooldown_active",
		})
	}
	if summary.Timings.PostToolUseDecisionLatency.P95Ms >= thresholds.PostToolUseLatencyP95ThresholdMs {
		alerts = append(alerts, MetricsAlert{
			Code:     "post_tool_use_latency_high",
			Severity: "warning",
			Title:    "Post-tool-use decision latency is high",
			Message:  "Post-tool-use policy decisions are taking longer than the current threshold.",
		})
	}
	if summary.Timings.StopDecisionLatency.P95Ms >= thresholds.StopLatencyP95ThresholdMs {
		alerts = append(alerts, MetricsAlert{
			Code:     "stop_latency_high",
			Severity: "warning",
			Title:    "Stop decision latency is high",
			Message:  "Stop policy decisions are taking longer than the current threshold.",
		})
	}

	appendSourceFailureAlert := func(code string, title string, message string, source string, sourceSummary MetricsSourceSummary) {
		if sourceSummary.ActionAttempts <= 0 || sourceSummary.ActionSuccessRate >= sourceActionSuccessThreshold {
			return
		}
		alerts = append(alerts, MetricsAlert{
			Code:         code,
			Severity:     "warning",
			Title:        title,
			Message:      message,
			Source:       source,
			ActionStatus: actionStatusFailed,
		})
	}

	appendSourceFailureAlert(
		"automation_action_success_below_target",
		"Automation actions are failing",
		"Automation-triggered turn policy actions are below the current success target.",
		"automation",
		summary.Sources.Automation,
	)
	appendSourceFailureAlert(
		"bot_action_success_below_target",
		"Bot actions are failing",
		"Bot-triggered turn policy actions are below the current success target.",
		"bot",
		summary.Sources.Bot,
	)

	sort.SliceStable(alerts, func(i int, j int) bool {
		if metricsAlertSeverityRank(alerts[i].Severity) != metricsAlertSeverityRank(alerts[j].Severity) {
			return metricsAlertSeverityRank(alerts[i].Severity) < metricsAlertSeverityRank(alerts[j].Severity)
		}
		return alerts[i].Code < alerts[j].Code
	})
	for index := range alerts {
		alerts[index].Rank = index + 1
	}

	return alerts
}

func applyMetricsAlertPolicies(
	alerts []MetricsAlert,
	suppressedCodes []string,
	acknowledgedCodes []string,
	snoozedCodes []string,
) ([]MetricsAlert, int, int, int) {
	if len(alerts) == 0 {
		return []MetricsAlert{}, 0, 0, 0
	}
	filtered := append([]MetricsAlert(nil), alerts...)
	suppressedCount := 0
	acknowledgedCount := 0
	snoozedCount := 0

	if len(suppressedCodes) > 0 {
		suppressedByCode := make(map[string]struct{}, len(suppressedCodes))
		for _, code := range suppressedCodes {
			suppressedByCode[code] = struct{}{}
		}

		remaining := make([]MetricsAlert, 0, len(filtered))
		for _, alert := range filtered {
			if _, ok := suppressedByCode[strings.TrimSpace(alert.Code)]; ok {
				suppressedCount++
				continue
			}
			remaining = append(remaining, alert)
		}
		filtered = remaining
	}

	if len(snoozedCodes) > 0 {
		snoozedByCode := make(map[string]struct{}, len(snoozedCodes))
		for _, code := range snoozedCodes {
			snoozedByCode[code] = struct{}{}
		}

		remaining := make([]MetricsAlert, 0, len(filtered))
		for _, alert := range filtered {
			if _, ok := snoozedByCode[strings.TrimSpace(alert.Code)]; ok {
				snoozedCount++
				continue
			}
			remaining = append(remaining, alert)
		}
		filtered = remaining
	}

	if len(acknowledgedCodes) > 0 {
		acknowledgedByCode := make(map[string]struct{}, len(acknowledgedCodes))
		for _, code := range acknowledgedCodes {
			acknowledgedByCode[code] = struct{}{}
		}
		for index := range filtered {
			if _, ok := acknowledgedByCode[strings.TrimSpace(filtered[index].Code)]; !ok {
				continue
			}
			filtered[index].Acknowledged = true
			acknowledgedCount++
		}
		if acknowledgedCount > 0 {
			reordered := make([]MetricsAlert, 0, len(filtered))
			for _, alert := range filtered {
				if !alert.Acknowledged {
					reordered = append(reordered, alert)
				}
			}
			for _, alert := range filtered {
				if alert.Acknowledged {
					reordered = append(reordered, alert)
				}
			}
			filtered = reordered
		}
	}

	for index := range filtered {
		filtered[index].Rank = index + 1
	}
	return filtered, suppressedCount, acknowledgedCount, snoozedCount
}

func metricsAlertSeverityRank(severity string) int {
	switch strings.TrimSpace(severity) {
	case "warning":
		return 0
	case "info":
		return 1
	default:
		return 2
	}
}

func filterMetricsDecisionsBySource(decisions []store.TurnPolicyDecision, source string) []store.TurnPolicyDecision {
	source = strings.TrimSpace(source)
	if source == "" {
		return decisions
	}

	filtered := decisions[:0]
	for _, decision := range decisions {
		if strings.TrimSpace(decision.Source) != source {
			continue
		}
		filtered = append(filtered, decision)
	}
	return filtered
}

func filterMetricsDecisionsByTime(decisions []store.TurnPolicyDecision, since time.Time, until time.Time) []store.TurnPolicyDecision {
	return filterMetricsDecisionsByTimeWindow(decisions, since, until, true)
}

func filterMetricsDecisionsByTimeWindow(decisions []store.TurnPolicyDecision, since time.Time, until time.Time, includeUntil bool) []store.TurnPolicyDecision {
	filtered := make([]store.TurnPolicyDecision, 0, len(decisions))
	for _, decision := range decisions {
		occurredAt := metricsDecisionOccurredAt(decision)
		if occurredAt.IsZero() {
			continue
		}
		if occurredAt.Before(since) {
			continue
		}
		if includeUntil {
			if occurredAt.After(until) {
				continue
			}
		} else if !occurredAt.Before(until) {
			continue
		}
		filtered = append(filtered, decision)
	}
	return filtered
}

func metricsDecisionOccurredAt(decision store.TurnPolicyDecision) time.Time {
	if !decision.CompletedAt.IsZero() {
		return decision.CompletedAt
	}
	if !decision.DecisionAt.IsZero() {
		return decision.DecisionAt
	}
	return decision.EvaluationStartedAt
}

func aggregateRecentWindows(
	now time.Time,
	decisions []store.TurnPolicyDecision,
	thresholds MetricsAlertThresholds,
	suppressedCodes []string,
	snoozedCodes []string,
) MetricsRecentWindowsSummary {
	return MetricsRecentWindowsSummary{
		LastHour:    aggregateRecentWindow(now.Add(-time.Hour), now, decisions, thresholds, suppressedCodes, snoozedCodes),
		Last24Hours: aggregateRecentWindow(now.Add(-24*time.Hour), now, decisions, thresholds, suppressedCodes, snoozedCodes),
	}
}

func aggregateMetricsHistory(
	now time.Time,
	decisions []store.TurnPolicyDecision,
	thresholds MetricsAlertThresholds,
	suppressedCodes []string,
	snoozedCodes []string,
) MetricsHistorySummary {
	if now.IsZero() {
		return MetricsHistorySummary{
			DailyLast7Days:    []MetricsHistoryBucketSummary{},
			DailyLast30Days:   []MetricsHistoryBucketSummary{},
			DailyLast90Days:   []MetricsHistoryBucketSummary{},
			WeeklyLast12Weeks: []MetricsHistoryBucketSummary{},
		}
	}

	return MetricsHistorySummary{
		DailyLast7Days: aggregateDailyMetricsHistory(
			now,
			decisions,
			thresholds,
			suppressedCodes,
			snoozedCodes,
			7,
		),
		DailyLast30Days: aggregateDailyMetricsHistory(
			now,
			decisions,
			thresholds,
			suppressedCodes,
			snoozedCodes,
			30,
		),
		DailyLast90Days: aggregateDailyMetricsHistory(
			now,
			decisions,
			thresholds,
			suppressedCodes,
			snoozedCodes,
			90,
		),
		WeeklyLast12Weeks: aggregateWeeklyMetricsHistory(
			now,
			decisions,
			thresholds,
			suppressedCodes,
			snoozedCodes,
			12,
		),
	}
}

func aggregateDailyMetricsHistory(
	now time.Time,
	decisions []store.TurnPolicyDecision,
	thresholds MetricsAlertThresholds,
	suppressedCodes []string,
	snoozedCodes []string,
	days int,
) []MetricsHistoryBucketSummary {
	if now.IsZero() || days <= 0 {
		return []MetricsHistoryBucketSummary{}
	}

	dayStart := metricsDayStart(now)
	return aggregateMetricsHistoryBuckets(
		now,
		decisions,
		thresholds,
		suppressedCodes,
		snoozedCodes,
		days,
		func(offset int) (time.Time, time.Time) {
			since := dayStart.AddDate(0, 0, -offset)
			return since, since.AddDate(0, 0, 1)
		},
	)
}

func aggregateWeeklyMetricsHistory(
	now time.Time,
	decisions []store.TurnPolicyDecision,
	thresholds MetricsAlertThresholds,
	suppressedCodes []string,
	snoozedCodes []string,
	weeks int,
) []MetricsHistoryBucketSummary {
	if now.IsZero() || weeks <= 0 {
		return []MetricsHistoryBucketSummary{}
	}

	weekStart := metricsWeekStart(now)
	return aggregateMetricsHistoryBuckets(
		now,
		decisions,
		thresholds,
		suppressedCodes,
		snoozedCodes,
		weeks,
		func(offset int) (time.Time, time.Time) {
			since := weekStart.AddDate(0, 0, -(offset * 7))
			return since, since.AddDate(0, 0, 7)
		},
	)
}

func aggregateMetricsHistoryBuckets(
	now time.Time,
	decisions []store.TurnPolicyDecision,
	thresholds MetricsAlertThresholds,
	suppressedCodes []string,
	snoozedCodes []string,
	count int,
	boundsForOffset func(offset int) (time.Time, time.Time),
) []MetricsHistoryBucketSummary {
	if now.IsZero() || count <= 0 {
		return []MetricsHistoryBucketSummary{}
	}

	buckets := make([]MetricsHistoryBucketSummary, 0, count)
	for offset := count - 1; offset >= 0; offset-- {
		since, until := boundsForOffset(offset)
		includeUntil := false
		if offset == 0 {
			until = now
			includeUntil = true
		}
		buckets = append(
			buckets,
			aggregateMetricsWindow(
				since,
				until,
				decisions,
				thresholds,
				suppressedCodes,
				snoozedCodes,
				includeUntil,
			),
		)
	}

	return buckets
}

func aggregateRecentWindow(
	since time.Time,
	until time.Time,
	decisions []store.TurnPolicyDecision,
	thresholds MetricsAlertThresholds,
	suppressedCodes []string,
	snoozedCodes []string,
) MetricsRecentWindowSummary {
	return aggregateMetricsWindow(
		since,
		until,
		decisions,
		thresholds,
		suppressedCodes,
		snoozedCodes,
		true,
	)
}

func aggregateMetricsWindow(
	since time.Time,
	until time.Time,
	decisions []store.TurnPolicyDecision,
	thresholds MetricsAlertThresholds,
	suppressedCodes []string,
	snoozedCodes []string,
	includeUntil bool,
) MetricsRecentWindowSummary {
	windowDecisions := filterMetricsDecisionsByTimeWindow(decisions, since, until, includeUntil)
	decisionSummary := aggregateDecisionSummary(windowDecisions)
	timings := aggregateDecisionTimings(windowDecisions)
	windowSummary := MetricsSummary{
		Decisions: decisionSummary,
		Sources:   aggregateSourceBreakdown(windowDecisions),
		Timings:   timings,
		Audit: MetricsAuditSummary{
			CoverageDefinition:    metricsCoverageDefinition,
			CoverageDefinitionKey: metricsCoverageDefinitionKey,
		},
	}
	filteredAlerts, _, _, _ := applyMetricsAlertPolicies(
		buildMetricsAlerts(windowSummary, thresholds),
		suppressedCodes,
		nil,
		snoozedCodes,
	)
	alertsCount := len(filteredAlerts)

	return MetricsRecentWindowSummary{
		Since:       since,
		Until:       until,
		AlertsCount: alertsCount,
		Decisions: MetricsRecentWindowDecisionSummary{
			Total:             decisionSummary.Total,
			ActionAttempts:    decisionSummary.ActionAttempts,
			ActionSucceeded:   decisionSummary.ActionSucceeded,
			ActionSuccessRate: decisionSummary.ActionSuccessRate,
			Skipped:           decisionSummary.ActionStatusCounts.Skipped,
		},
		Timings: timings,
	}
}

func metricsDayStart(at time.Time) time.Time {
	location := at.Location()
	if location == nil {
		location = time.UTC
	}
	local := at.In(location)
	year, month, day := local.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, location)
}

func metricsWeekStart(at time.Time) time.Time {
	dayStart := metricsDayStart(at)
	weekday := dayStart.Weekday()
	offset := (int(weekday) + 6) % 7
	return dayStart.AddDate(0, 0, -offset)
}

func normalizeMetricsStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	items := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
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

func cloneMetricsStringSlice(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string(nil), values...)
}

func cloneMetricsOptionalTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
}

func aggregateDecisionSummary(decisions []store.TurnPolicyDecision) MetricsDecisionSummary {
	summary := MetricsDecisionSummary{
		Total: len(decisions),
	}

	for _, decision := range decisions {
		action := strings.TrimSpace(decision.Action)
		actionStatus := strings.TrimSpace(decision.ActionStatus)

		if action != actionNone && actionStatus != actionStatusSkipped {
			summary.ActionAttempts++
			if actionStatus == actionStatusSucceeded {
				summary.ActionSucceeded++
			}
		}

		switch actionStatus {
		case actionStatusSucceeded:
			summary.ActionStatusCounts.Succeeded++
		case actionStatusFailed:
			summary.ActionStatusCounts.Failed++
		case actionStatusSkipped:
			summary.ActionStatusCounts.Skipped++
		default:
			summary.ActionStatusCounts.Other++
		}

		switch action {
		case actionSteer:
			summary.ActionCounts.Steer++
		case actionFollowUp:
			summary.ActionCounts.FollowUp++
		case actionInterrupt:
			summary.ActionCounts.Interrupt++
		case actionNone:
			summary.ActionCounts.None++
		default:
			summary.ActionCounts.Other++
		}

		switch strings.TrimSpace(decision.PolicyName) {
		case postToolUsePolicyName:
			summary.PolicyCounts.FailedValidationCommand++
		case stopMissingVerifyPolicy:
			summary.PolicyCounts.MissingSuccessfulVerification++
		default:
			summary.PolicyCounts.Other++
		}

		if actionStatus != actionStatusSkipped {
			continue
		}

		summary.SkipReasonCounts.Total++
		switch strings.TrimSpace(decision.Reason) {
		case "duplicate_fingerprint":
			summary.SkipReasonCounts.DuplicateFingerprint++
		case "follow_up_cooldown_active":
			summary.SkipReasonCounts.FollowUpCooldownActive++
		case reasonInterruptNoActiveTurn:
			summary.SkipReasonCounts.InterruptNoActiveTurn++
		default:
			summary.SkipReasonCounts.Other++
		}
	}

	summary.ActionSuccessRate = ratio(summary.ActionSucceeded, summary.ActionAttempts)

	return summary
}

func aggregateSourceBreakdown(decisions []store.TurnPolicyDecision) MetricsSourceBreakdown {
	breakdown := MetricsSourceBreakdown{}

	for _, decision := range decisions {
		summary := sourceMetricsSummary(&breakdown, decision.Source)
		summary.Total++

		action := strings.TrimSpace(decision.Action)
		actionStatus := strings.TrimSpace(decision.ActionStatus)
		if action != actionNone && actionStatus != actionStatusSkipped {
			summary.ActionAttempts++
			if actionStatus == actionStatusSucceeded {
				summary.ActionSucceeded++
			}
		}
		if actionStatus == actionStatusSkipped {
			summary.Skipped++
		}
	}

	finalizeSourceMetricsSummary(&breakdown.Interactive)
	finalizeSourceMetricsSummary(&breakdown.Automation)
	finalizeSourceMetricsSummary(&breakdown.Bot)
	finalizeSourceMetricsSummary(&breakdown.Other)

	return breakdown
}

func sourceMetricsSummary(breakdown *MetricsSourceBreakdown, source string) *MetricsSourceSummary {
	switch strings.TrimSpace(source) {
	case "interactive":
		return &breakdown.Interactive
	case "automation":
		return &breakdown.Automation
	case "bot":
		return &breakdown.Bot
	default:
		return &breakdown.Other
	}
}

func finalizeSourceMetricsSummary(summary *MetricsSourceSummary) {
	summary.ActionSuccessRate = ratio(summary.ActionSucceeded, summary.ActionAttempts)
}

func aggregateDecisionTimings(decisions []store.TurnPolicyDecision) MetricsTimingSummary {
	var postToolUseLatencies []int64
	var stopLatencies []int64

	for _, decision := range decisions {
		latencyMs := decision.DecisionAt.Sub(decision.EvaluationStartedAt).Milliseconds()
		if latencyMs < 0 {
			latencyMs = 0
		}

		switch strings.TrimSpace(decision.TriggerMethod) {
		case "item/completed":
			postToolUseLatencies = append(postToolUseLatencies, latencyMs)
		case "turn/completed":
			stopLatencies = append(stopLatencies, latencyMs)
		}
	}

	return MetricsTimingSummary{
		PostToolUseDecisionLatency: aggregateLatencyPercentiles(postToolUseLatencies),
		StopDecisionLatency:        aggregateLatencyPercentiles(stopLatencies),
	}
}

func aggregateLatencyPercentiles(latencies []int64) MetricsLatencyPercentiles {
	if len(latencies) == 0 {
		return MetricsLatencyPercentiles{}
	}

	values := append([]int64(nil), latencies...)
	sort.Slice(values, func(i int, j int) bool {
		return values[i] < values[j]
	})

	return MetricsLatencyPercentiles{
		P50Ms: percentileValue(values, 0.50),
		P95Ms: percentileValue(values, 0.95),
	}
}

func percentileValue(sortedValues []int64, percentile float64) int64 {
	if len(sortedValues) == 0 {
		return 0
	}

	index := int(math.Ceil(float64(len(sortedValues))*percentile)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sortedValues) {
		index = len(sortedValues) - 1
	}
	return sortedValues[index]
}

func aggregateDecisionFacts(decisions []store.TurnPolicyDecision) map[string]turnDecisionFacts {
	factsByTurn := make(map[string]turnDecisionFacts, len(decisions))

	for _, decision := range decisions {
		key := metricsTurnKey(decision.ThreadID, decision.TurnID)
		if key == "" {
			continue
		}

		facts := factsByTurn[key]
		switch strings.TrimSpace(decision.PolicyName) {
		case postToolUsePolicyName, stopMissingVerifyPolicy:
			facts.hasAuditRecord = true
		}
		if strings.TrimSpace(decision.PolicyName) == postToolUsePolicyName &&
			strings.TrimSpace(decision.Action) != actionNone &&
			strings.TrimSpace(decision.ActionStatus) != actionStatusSkipped {
			facts.hasFailedValidationPolicyAction = true
		}
		factsByTurn[key] = facts
	}

	return factsByTurn
}

func aggregateTurnSummary(
	turns []turnAnalysis,
	decisionFactsByTurn map[string]turnDecisionFacts,
	coverageDefinition string,
	coverageDefinitionKey string,
	runtimeConfig RuntimeConfig,
) (MetricsTurnSummary, MetricsAuditSummary) {
	summary := MetricsTurnSummary{}
	audit := MetricsAuditSummary{
		CoverageDefinition:    coverageDefinition,
		CoverageDefinitionKey: coverageDefinitionKey,
	}

	for _, turn := range turns {
		if turn.hasCompletedFileChange {
			summary.CompletedWithFileChange++
		}
		if turn.missingSuccessfulVerification {
			summary.MissingSuccessfulVerification++
		}
		if turn.hasFailedValidationCommand {
			summary.FailedValidationCommand++
		}

		key := metricsTurnKey(turn.threadID, turn.turnID)
		facts := decisionFactsByTurn[key]
		if turn.hasFailedValidationCommand && facts.hasFailedValidationPolicyAction {
			summary.FailedValidationWithPolicyAction++
		}

		isCoverageEligible :=
			(turn.missingSuccessfulVerification && runtimeConfig.StopMissingVerificationEnabled) ||
				(turn.hasFailedValidationCommand && runtimeConfig.PostToolUseFailedValidationEnabled)
		if !isCoverageEligible {
			continue
		}
		audit.EligibleTurns++
		if facts.hasAuditRecord {
			audit.CoveredTurns++
		}
	}

	summary.MissingSuccessfulVerificationRate = ratio(summary.MissingSuccessfulVerification, summary.CompletedWithFileChange)
	summary.FailedValidationWithPolicyActionRate = ratio(summary.FailedValidationWithPolicyAction, summary.FailedValidationCommand)
	audit.CoverageRate = ratio(audit.CoveredTurns, audit.EligibleTurns)

	return summary, audit
}

func (s *Service) analyzeTurns(workspaceID string, threadID string, validationCommandPrefixes []string) []turnAnalysis {
	projections := s.store.ListThreadProjections(workspaceID, threadID)
	if len(projections) == 0 {
		return nil
	}

	turns := make([]turnAnalysis, 0)
	for _, projection := range projections {
		for _, turn := range projection.Turns {
			analysis, ok := analyzeCompletedTurn(projection.ThreadID, turn, validationCommandPrefixes)
			if !ok {
				continue
			}
			turns = append(turns, analysis)
		}
	}

	return turns
}

func analyzeCompletedTurn(threadID string, turn store.ThreadTurn, validationCommandPrefixes []string) (turnAnalysis, bool) {
	if strings.TrimSpace(turn.Status) != "completed" {
		return turnAnalysis{}, false
	}

	analysis := turnAnalysis{
		threadID: threadID,
		turnID:   strings.TrimSpace(turn.ID),
	}
	lastCompletedFileChangeIndex := -1

	for index, item := range turn.Items {
		itemType := stringValue(item["type"])
		switch itemType {
		case "fileChange":
			if stringValue(item["status"]) == "completed" {
				analysis.hasCompletedFileChange = true
				lastCompletedFileChangeIndex = index
			}
		case "commandExecution":
			command := strings.TrimSpace(stringValue(item["command"]))
			if isValidationCommand(command, validationCommandPrefixes) && isFailedCommandExecution(item) {
				analysis.hasFailedValidationCommand = true
			}
		}
	}

	if lastCompletedFileChangeIndex < 0 {
		return analysis, true
	}

	for _, item := range turn.Items[lastCompletedFileChangeIndex+1:] {
		if stringValue(item["type"]) != "commandExecution" {
			continue
		}
		command := strings.TrimSpace(stringValue(item["command"]))
		if isValidationCommand(command, validationCommandPrefixes) && isSuccessfulValidationCommand(item) {
			return analysis, true
		}
	}

	analysis.missingSuccessfulVerification = true
	return analysis, true
}

func metricsTurnKey(threadID string, turnID string) string {
	threadID = strings.TrimSpace(threadID)
	turnID = strings.TrimSpace(turnID)
	if threadID == "" || turnID == "" {
		return ""
	}
	return threadID + "\x00" + turnID
}

func ratio(numerator int, denominator int) float64 {
	if denominator <= 0 || numerator <= 0 {
		return 0
	}
	return math.Round((float64(numerator)/float64(denominator))*10000) / 10000
}
