package runtimeprefs

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"sort"
	"strings"
	"time"

	"codex-server/backend/internal/accesscontrol"
	appconfig "codex-server/backend/internal/config"
	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/hooks"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turnpolicies"
)

type Service struct {
	store                    *store.MemoryStore
	runtimes                 *runtime.Manager
	baseCommand              string
	defaultPrefs             appconfig.RuntimePreferences
	defaultTrace             diagnostics.ThreadTraceConfig
	defaultAllowRemoteAccess bool
}

type ReadResult struct {
	ConfiguredModelCatalogPath                                                         string                                 `json:"configuredModelCatalogPath"`
	ConfiguredDefaultShellType                                                         string                                 `json:"configuredDefaultShellType"`
	ConfiguredDefaultTerminalShell                                                     string                                 `json:"configuredDefaultTerminalShell"`
	SupportedTerminalShells                                                            []string                               `json:"supportedTerminalShells"`
	ConfiguredModelShellTypeOverrides                                                  map[string]string                      `json:"configuredModelShellTypeOverrides"`
	ConfiguredOutboundProxyURL                                                         string                                 `json:"configuredOutboundProxyUrl"`
	ConfiguredDefaultTurnApprovalPolicy                                                string                                 `json:"configuredDefaultTurnApprovalPolicy"`
	ConfiguredDefaultTurnSandboxPolicy                                                 map[string]any                         `json:"configuredDefaultTurnSandboxPolicy"`
	ConfiguredDefaultCommandSandboxPolicy                                              map[string]any                         `json:"configuredDefaultCommandSandboxPolicy"`
	ConfiguredHookSessionStartEnabled                                                  *bool                                  `json:"configuredHookSessionStartEnabled"`
	ConfiguredHookSessionStartContextPaths                                             []string                               `json:"configuredHookSessionStartContextPaths"`
	ConfiguredHookSessionStartMaxChars                                                 *int                                   `json:"configuredHookSessionStartMaxChars"`
	ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled                              *bool                                  `json:"configuredHookUserPromptSubmitBlockSecretPasteEnabled"`
	ConfiguredHookPreToolUseBlockDangerousCommandEnabled                               *bool                                  `json:"configuredHookPreToolUseBlockDangerousCommandEnabled"`
	ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths                         []string                               `json:"configuredHookPreToolUseAdditionalProtectedGovernancePaths"`
	ConfiguredTurnPolicyPostToolUseFailedValidationEnabled                             *bool                                  `json:"configuredTurnPolicyPostToolUseFailedValidationEnabled"`
	ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled                       *bool                                  `json:"configuredTurnPolicyStopMissingSuccessfulVerificationEnabled"`
	ConfiguredTurnPolicyPostToolUsePrimaryAction                                       string                                 `json:"configuredTurnPolicyPostToolUsePrimaryAction"`
	ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction                 string                                 `json:"configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction"`
	ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior                       string                                 `json:"configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior"`
	ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior string                                 `json:"configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"`
	ConfiguredTurnPolicyValidationCommandPrefixes                                      []string                               `json:"configuredTurnPolicyValidationCommandPrefixes"`
	ConfiguredTurnPolicyFollowUpCooldownMs                                             *int64                                 `json:"configuredTurnPolicyFollowUpCooldownMs"`
	ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs                                  *int64                                 `json:"configuredTurnPolicyPostToolUseFollowUpCooldownMs"`
	ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs            *int64                                 `json:"configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs"`
	ConfiguredTurnPolicyAlertCoverageThresholdPercent                                  *int                                   `json:"configuredTurnPolicyAlertCoverageThresholdPercent"`
	ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs                          *int64                                 `json:"configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs"`
	ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs                                 *int64                                 `json:"configuredTurnPolicyAlertStopLatencyP95ThresholdMs"`
	ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent                       *int                                   `json:"configuredTurnPolicyAlertSourceActionSuccessThresholdPercent"`
	ConfiguredTurnPolicyAlertSuppressedCodes                                           []string                               `json:"configuredTurnPolicyAlertSuppressedCodes"`
	ConfiguredTurnPolicyAlertAcknowledgedCodes                                         []string                               `json:"configuredTurnPolicyAlertAcknowledgedCodes"`
	ConfiguredTurnPolicyAlertSnoozedCodes                                              []string                               `json:"configuredTurnPolicyAlertSnoozedCodes"`
	ConfiguredTurnPolicyAlertSnoozeUntil                                               *time.Time                             `json:"configuredTurnPolicyAlertSnoozeUntil"`
	ConfiguredTurnPolicyAlertSnoozeActive                                              bool                                   `json:"configuredTurnPolicyAlertSnoozeActive"`
	ConfiguredTurnPolicyAlertSnoozeExpired                                             bool                                   `json:"configuredTurnPolicyAlertSnoozeExpired"`
	TurnPolicyAlertGovernanceHistory                                                   []store.TurnPolicyAlertGovernanceEvent `json:"turnPolicyAlertGovernanceHistory"`
	ConfiguredAllowRemoteAccess                                                        *bool                                  `json:"configuredAllowRemoteAccess"`
	ConfiguredAllowLocalhostWithoutAccessToken                                         *bool                                  `json:"configuredAllowLocalhostWithoutAccessToken"`
	ConfiguredAccessTokens                                                             []accesscontrol.TokenDescriptor        `json:"configuredAccessTokens"`
	ConfiguredBackendThreadTraceEnabled                                                *bool                                  `json:"configuredBackendThreadTraceEnabled"`
	ConfiguredBackendThreadTraceWorkspaceID                                            string                                 `json:"configuredBackendThreadTraceWorkspaceId"`
	ConfiguredBackendThreadTraceThreadID                                               string                                 `json:"configuredBackendThreadTraceThreadId"`
	DefaultModelCatalogPath                                                            string                                 `json:"defaultModelCatalogPath"`
	DefaultDefaultShellType                                                            string                                 `json:"defaultDefaultShellType"`
	DefaultDefaultTerminalShell                                                        string                                 `json:"defaultDefaultTerminalShell"`
	DefaultModelShellTypeOverrides                                                     map[string]string                      `json:"defaultModelShellTypeOverrides"`
	DefaultOutboundProxyURL                                                            string                                 `json:"defaultOutboundProxyUrl"`
	DefaultDefaultTurnApprovalPolicy                                                   string                                 `json:"defaultDefaultTurnApprovalPolicy"`
	DefaultDefaultTurnSandboxPolicy                                                    map[string]any                         `json:"defaultDefaultTurnSandboxPolicy"`
	DefaultDefaultCommandSandboxPolicy                                                 map[string]any                         `json:"defaultDefaultCommandSandboxPolicy"`
	DefaultHookSessionStartEnabled                                                     bool                                   `json:"defaultHookSessionStartEnabled"`
	DefaultHookSessionStartContextPaths                                                []string                               `json:"defaultHookSessionStartContextPaths"`
	DefaultHookSessionStartMaxChars                                                    int                                    `json:"defaultHookSessionStartMaxChars"`
	DefaultHookUserPromptSubmitBlockSecretPasteEnabled                                 bool                                   `json:"defaultHookUserPromptSubmitBlockSecretPasteEnabled"`
	DefaultHookPreToolUseBlockDangerousCommandEnabled                                  bool                                   `json:"defaultHookPreToolUseBlockDangerousCommandEnabled"`
	DefaultHookPreToolUseProtectedGovernancePaths                                      []string                               `json:"defaultHookPreToolUseProtectedGovernancePaths"`
	DefaultTurnPolicyPostToolUseFailedValidationEnabled                                bool                                   `json:"defaultTurnPolicyPostToolUseFailedValidationEnabled"`
	DefaultTurnPolicyStopMissingSuccessfulVerificationEnabled                          bool                                   `json:"defaultTurnPolicyStopMissingSuccessfulVerificationEnabled"`
	DefaultTurnPolicyPostToolUsePrimaryAction                                          string                                 `json:"defaultTurnPolicyPostToolUsePrimaryAction"`
	DefaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction                    string                                 `json:"defaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction"`
	DefaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior                          string                                 `json:"defaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior"`
	DefaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior    string                                 `json:"defaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"`
	DefaultTurnPolicyValidationCommandPrefixes                                         []string                               `json:"defaultTurnPolicyValidationCommandPrefixes"`
	DefaultTurnPolicyFollowUpCooldownMs                                                int64                                  `json:"defaultTurnPolicyFollowUpCooldownMs"`
	DefaultTurnPolicyPostToolUseFollowUpCooldownMs                                     int64                                  `json:"defaultTurnPolicyPostToolUseFollowUpCooldownMs"`
	DefaultTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs               int64                                  `json:"defaultTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs"`
	DefaultTurnPolicyAlertCoverageThresholdPercent                                     int                                    `json:"defaultTurnPolicyAlertCoverageThresholdPercent"`
	DefaultTurnPolicyAlertPostToolUseLatencyP95ThresholdMs                             int64                                  `json:"defaultTurnPolicyAlertPostToolUseLatencyP95ThresholdMs"`
	DefaultTurnPolicyAlertStopLatencyP95ThresholdMs                                    int64                                  `json:"defaultTurnPolicyAlertStopLatencyP95ThresholdMs"`
	DefaultTurnPolicyAlertSourceActionSuccessThresholdPercent                          int                                    `json:"defaultTurnPolicyAlertSourceActionSuccessThresholdPercent"`
	DefaultTurnPolicyAlertSuppressedCodes                                              []string                               `json:"defaultTurnPolicyAlertSuppressedCodes"`
	DefaultTurnPolicyAlertAcknowledgedCodes                                            []string                               `json:"defaultTurnPolicyAlertAcknowledgedCodes"`
	DefaultTurnPolicyAlertSnoozedCodes                                                 []string                               `json:"defaultTurnPolicyAlertSnoozedCodes"`
	DefaultTurnPolicyAlertSnoozeUntil                                                  *time.Time                             `json:"defaultTurnPolicyAlertSnoozeUntil"`
	DefaultAllowRemoteAccess                                                           bool                                   `json:"defaultAllowRemoteAccess"`
	DefaultAllowLocalhostWithoutAccessToken                                            bool                                   `json:"defaultAllowLocalhostWithoutAccessToken"`
	DefaultBackendThreadTraceEnabled                                                   bool                                   `json:"defaultBackendThreadTraceEnabled"`
	DefaultBackendThreadTraceWorkspaceID                                               string                                 `json:"defaultBackendThreadTraceWorkspaceId"`
	DefaultBackendThreadTraceThreadID                                                  string                                 `json:"defaultBackendThreadTraceThreadId"`
	EffectiveModelCatalogPath                                                          string                                 `json:"effectiveModelCatalogPath"`
	EffectiveDefaultShellType                                                          string                                 `json:"effectiveDefaultShellType"`
	EffectiveDefaultTerminalShell                                                      string                                 `json:"effectiveDefaultTerminalShell"`
	EffectiveModelShellTypeOverrides                                                   map[string]string                      `json:"effectiveModelShellTypeOverrides"`
	EffectiveOutboundProxyURL                                                          string                                 `json:"effectiveOutboundProxyUrl"`
	EffectiveDefaultTurnApprovalPolicy                                                 string                                 `json:"effectiveDefaultTurnApprovalPolicy"`
	EffectiveDefaultTurnSandboxPolicy                                                  map[string]any                         `json:"effectiveDefaultTurnSandboxPolicy"`
	EffectiveDefaultCommandSandboxPolicy                                               map[string]any                         `json:"effectiveDefaultCommandSandboxPolicy"`
	EffectiveHookSessionStartEnabled                                                   bool                                   `json:"effectiveHookSessionStartEnabled"`
	EffectiveHookSessionStartContextPaths                                              []string                               `json:"effectiveHookSessionStartContextPaths"`
	EffectiveHookSessionStartMaxChars                                                  int                                    `json:"effectiveHookSessionStartMaxChars"`
	EffectiveHookUserPromptSubmitBlockSecretPasteEnabled                               bool                                   `json:"effectiveHookUserPromptSubmitBlockSecretPasteEnabled"`
	EffectiveHookPreToolUseBlockDangerousCommandEnabled                                bool                                   `json:"effectiveHookPreToolUseBlockDangerousCommandEnabled"`
	EffectiveHookPreToolUseProtectedGovernancePaths                                    []string                               `json:"effectiveHookPreToolUseProtectedGovernancePaths"`
	EffectiveTurnPolicyPostToolUseFailedValidationEnabled                              bool                                   `json:"effectiveTurnPolicyPostToolUseFailedValidationEnabled"`
	EffectiveTurnPolicyStopMissingSuccessfulVerificationEnabled                        bool                                   `json:"effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled"`
	EffectiveTurnPolicyPostToolUsePrimaryAction                                        string                                 `json:"effectiveTurnPolicyPostToolUsePrimaryAction"`
	EffectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction                  string                                 `json:"effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction"`
	EffectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior                        string                                 `json:"effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior"`
	EffectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior  string                                 `json:"effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"`
	EffectiveTurnPolicyValidationCommandPrefixes                                       []string                               `json:"effectiveTurnPolicyValidationCommandPrefixes"`
	EffectiveTurnPolicyFollowUpCooldownMs                                              int64                                  `json:"effectiveTurnPolicyFollowUpCooldownMs"`
	EffectiveTurnPolicyPostToolUseFollowUpCooldownMs                                   int64                                  `json:"effectiveTurnPolicyPostToolUseFollowUpCooldownMs"`
	EffectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs             int64                                  `json:"effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs"`
	EffectiveTurnPolicyAlertCoverageThresholdPercent                                   int                                    `json:"effectiveTurnPolicyAlertCoverageThresholdPercent"`
	EffectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs                           int64                                  `json:"effectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs"`
	EffectiveTurnPolicyAlertStopLatencyP95ThresholdMs                                  int64                                  `json:"effectiveTurnPolicyAlertStopLatencyP95ThresholdMs"`
	EffectiveTurnPolicyAlertSourceActionSuccessThresholdPercent                        int                                    `json:"effectiveTurnPolicyAlertSourceActionSuccessThresholdPercent"`
	EffectiveTurnPolicyAlertSuppressedCodes                                            []string                               `json:"effectiveTurnPolicyAlertSuppressedCodes"`
	EffectiveTurnPolicyAlertAcknowledgedCodes                                          []string                               `json:"effectiveTurnPolicyAlertAcknowledgedCodes"`
	EffectiveTurnPolicyAlertSnoozedCodes                                               []string                               `json:"effectiveTurnPolicyAlertSnoozedCodes"`
	EffectiveTurnPolicyAlertSnoozeUntil                                                *time.Time                             `json:"effectiveTurnPolicyAlertSnoozeUntil"`
	EffectiveAllowRemoteAccess                                                         bool                                   `json:"effectiveAllowRemoteAccess"`
	EffectiveAllowLocalhostWithoutAccessToken                                          bool                                   `json:"effectiveAllowLocalhostWithoutAccessToken"`
	EffectiveBackendThreadTraceEnabled                                                 bool                                   `json:"effectiveBackendThreadTraceEnabled"`
	EffectiveBackendThreadTraceWorkspaceID                                             string                                 `json:"effectiveBackendThreadTraceWorkspaceId"`
	EffectiveBackendThreadTraceThreadID                                                string                                 `json:"effectiveBackendThreadTraceThreadId"`
	EffectiveCommand                                                                   string                                 `json:"effectiveCommand"`
}

type WriteInput struct {
	ModelCatalogPath                                                         string                               `json:"modelCatalogPath"`
	DefaultShellType                                                         string                               `json:"defaultShellType"`
	DefaultTerminalShell                                                     string                               `json:"defaultTerminalShell"`
	ModelShellTypeOverrides                                                  map[string]string                    `json:"modelShellTypeOverrides"`
	OutboundProxyURL                                                         string                               `json:"outboundProxyUrl"`
	DefaultTurnApprovalPolicy                                                string                               `json:"defaultTurnApprovalPolicy"`
	DefaultTurnSandboxPolicy                                                 map[string]any                       `json:"defaultTurnSandboxPolicy"`
	DefaultCommandSandboxPolicy                                              map[string]any                       `json:"defaultCommandSandboxPolicy"`
	HookSessionStartEnabled                                                  *bool                                `json:"hookSessionStartEnabled"`
	HookSessionStartContextPaths                                             []string                             `json:"hookSessionStartContextPaths"`
	HookSessionStartMaxChars                                                 *int                                 `json:"hookSessionStartMaxChars"`
	HookUserPromptSubmitBlockSecretPasteEnabled                              *bool                                `json:"hookUserPromptSubmitBlockSecretPasteEnabled"`
	HookPreToolUseBlockDangerousCommandEnabled                               *bool                                `json:"hookPreToolUseBlockDangerousCommandEnabled"`
	HookPreToolUseAdditionalProtectedGovernancePaths                         []string                             `json:"hookPreToolUseAdditionalProtectedGovernancePaths"`
	TurnPolicyPostToolUseFailedValidationEnabled                             *bool                                `json:"turnPolicyPostToolUseFailedValidationEnabled"`
	TurnPolicyStopMissingSuccessfulVerificationEnabled                       *bool                                `json:"turnPolicyStopMissingSuccessfulVerificationEnabled"`
	TurnPolicyPostToolUsePrimaryAction                                       string                               `json:"turnPolicyPostToolUsePrimaryAction"`
	TurnPolicyStopMissingSuccessfulVerificationPrimaryAction                 string                               `json:"turnPolicyStopMissingSuccessfulVerificationPrimaryAction"`
	TurnPolicyPostToolUseInterruptNoActiveTurnBehavior                       string                               `json:"turnPolicyPostToolUseInterruptNoActiveTurnBehavior"`
	TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior string                               `json:"turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"`
	TurnPolicyValidationCommandPrefixes                                      []string                             `json:"turnPolicyValidationCommandPrefixes"`
	TurnPolicyFollowUpCooldownMs                                             *int64                               `json:"turnPolicyFollowUpCooldownMs"`
	TurnPolicyPostToolUseFollowUpCooldownMs                                  *int64                               `json:"turnPolicyPostToolUseFollowUpCooldownMs"`
	TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs            *int64                               `json:"turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs"`
	TurnPolicyAlertCoverageThresholdPercent                                  *int                                 `json:"turnPolicyAlertCoverageThresholdPercent"`
	TurnPolicyAlertPostToolUseLatencyP95ThresholdMs                          *int64                               `json:"turnPolicyAlertPostToolUseLatencyP95ThresholdMs"`
	TurnPolicyAlertStopLatencyP95ThresholdMs                                 *int64                               `json:"turnPolicyAlertStopLatencyP95ThresholdMs"`
	TurnPolicyAlertSourceActionSuccessThresholdPercent                       *int                                 `json:"turnPolicyAlertSourceActionSuccessThresholdPercent"`
	TurnPolicyAlertSuppressedCodes                                           []string                             `json:"turnPolicyAlertSuppressedCodes"`
	TurnPolicyAlertAcknowledgedCodes                                         []string                             `json:"turnPolicyAlertAcknowledgedCodes"`
	TurnPolicyAlertSnoozedCodes                                              []string                             `json:"turnPolicyAlertSnoozedCodes"`
	TurnPolicyAlertSnoozeUntil                                               *time.Time                           `json:"turnPolicyAlertSnoozeUntil"`
	TurnPolicyAlertGovernanceEvent                                           *TurnPolicyAlertGovernanceEventInput `json:"turnPolicyAlertGovernanceEvent"`
	AllowRemoteAccess                                                        *bool                                `json:"allowRemoteAccess"`
	AllowLocalhostWithoutAccessToken                                         *bool                                `json:"allowLocalhostWithoutAccessToken"`
	AccessTokens                                                             []accesscontrol.TokenInput           `json:"accessTokens"`
	BackendThreadTraceEnabled                                                *bool                                `json:"backendThreadTraceEnabled"`
	BackendThreadTraceWorkspaceID                                            string                               `json:"backendThreadTraceWorkspaceId"`
	BackendThreadTraceThreadID                                               string                               `json:"backendThreadTraceThreadId"`
}

type TurnPolicyAlertGovernanceEventInput struct {
	Action      string     `json:"action"`
	Source      string     `json:"source"`
	Codes       []string   `json:"codes"`
	SnoozeUntil *time.Time `json:"snoozeUntil"`
}

const maxTurnPolicyAlertGovernanceHistoryEntries = 20

func NewService(
	dataStore *store.MemoryStore,
	runtimeManager *runtime.Manager,
	baseCommand string,
	defaultModelCatalogPath string,
	defaultLocalShellModels []string,
	defaultOutboundProxyURL string,
	defaultAllowRemoteAccess bool,
	defaultThreadTraceEnabled bool,
	defaultThreadTraceWorkspaceID string,
	defaultThreadTraceThreadID string,
) *Service {
	return &Service{
		store:       dataStore,
		runtimes:    runtimeManager,
		baseCommand: baseCommand,
		defaultPrefs: appconfig.RuntimePreferences{
			ModelCatalogPath:            strings.TrimSpace(defaultModelCatalogPath),
			ModelShellTypeOverrides:     localShellModelsToOverrides(defaultLocalShellModels),
			OutboundProxyURL:            strings.TrimSpace(defaultOutboundProxyURL),
			DefaultCommandSandboxPolicy: appconfig.DefaultCommandSandboxPolicy(),
		},
		defaultTrace: diagnostics.ThreadTraceConfig{
			Enabled:     defaultThreadTraceEnabled,
			WorkspaceID: strings.TrimSpace(defaultThreadTraceWorkspaceID),
			ThreadID:    strings.TrimSpace(defaultThreadTraceThreadID),
		},
		defaultAllowRemoteAccess: defaultAllowRemoteAccess,
	}
}

func (s *Service) Read() (ReadResult, error) {
	configuredPrefs, err := normalizeConfiguredPreferences(s.store.GetRuntimePreferences())
	if err != nil {
		return ReadResult{}, err
	}
	effectivePrefs := s.mergeWithDefaults(configuredPrefs)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	return s.buildReadResult(configuredPrefs, resolved), nil
}

func (s *Service) Write(input WriteInput) (ReadResult, error) {
	currentStored := s.store.GetRuntimePreferences()
	defaultTurnApprovalPolicy, err := appconfig.NormalizeApprovalPolicy(strings.TrimSpace(input.DefaultTurnApprovalPolicy))
	if err != nil {
		return ReadResult{}, err
	}
	defaultTurnSandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(input.DefaultTurnSandboxPolicy)
	if err != nil {
		return ReadResult{}, err
	}
	defaultCommandSandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(input.DefaultCommandSandboxPolicy)
	if err != nil {
		return ReadResult{}, err
	}
	outboundProxyURL, err := appconfig.NormalizeOutboundProxyURL(input.OutboundProxyURL)
	if err != nil {
		return ReadResult{}, err
	}
	accessTokens, err := accesscontrol.ApplyTokenInputs(
		currentStored.AccessTokens,
		input.AccessTokens,
		time.Now().UTC(),
	)
	if err != nil {
		return ReadResult{}, err
	}
	currentConfigured, err := normalizeConfiguredPreferences(currentStored)
	if err != nil {
		return ReadResult{}, err
	}

	candidateConfigured := store.RuntimePreferences{
		ModelCatalogPath:                                                         strings.TrimSpace(input.ModelCatalogPath),
		DefaultShellType:                                                         strings.TrimSpace(input.DefaultShellType),
		DefaultTerminalShell:                                                     normalizeTerminalShellPreference(input.DefaultTerminalShell),
		ModelShellTypeOverrides:                                                  normalizeInputs(input.ModelShellTypeOverrides),
		OutboundProxyURL:                                                         outboundProxyURL,
		DefaultTurnApprovalPolicy:                                                defaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:                                                 defaultTurnSandboxPolicy,
		DefaultCommandSandboxPolicy:                                              defaultCommandSandboxPolicy,
		HookSessionStartEnabled:                                                  cloneOptionalBool(input.HookSessionStartEnabled),
		HookSessionStartContextPaths:                                             cloneStrings(input.HookSessionStartContextPaths),
		HookSessionStartMaxChars:                                                 cloneOptionalInt(input.HookSessionStartMaxChars),
		HookUserPromptSubmitBlockSecretPasteEnabled:                              cloneOptionalBool(input.HookUserPromptSubmitBlockSecretPasteEnabled),
		HookPreToolUseBlockDangerousCommandEnabled:                               cloneOptionalBool(input.HookPreToolUseBlockDangerousCommandEnabled),
		HookPreToolUseAdditionalProtectedGovernancePaths:                         cloneStrings(input.HookPreToolUseAdditionalProtectedGovernancePaths),
		TurnPolicyPostToolUseFailedValidationEnabled:                             cloneOptionalBool(input.TurnPolicyPostToolUseFailedValidationEnabled),
		TurnPolicyStopMissingSuccessfulVerificationEnabled:                       cloneOptionalBool(input.TurnPolicyStopMissingSuccessfulVerificationEnabled),
		TurnPolicyPostToolUsePrimaryAction:                                       strings.TrimSpace(input.TurnPolicyPostToolUsePrimaryAction),
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction:                 strings.TrimSpace(input.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction),
		TurnPolicyPostToolUseInterruptNoActiveTurnBehavior:                       strings.TrimSpace(input.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior),
		TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: strings.TrimSpace(input.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior),
		TurnPolicyValidationCommandPrefixes:                                      cloneStrings(input.TurnPolicyValidationCommandPrefixes),
		TurnPolicyFollowUpCooldownMs:                                             cloneOptionalInt64(input.TurnPolicyFollowUpCooldownMs),
		TurnPolicyPostToolUseFollowUpCooldownMs:                                  cloneOptionalInt64(input.TurnPolicyPostToolUseFollowUpCooldownMs),
		TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:            cloneOptionalInt64(input.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs),
		TurnPolicyAlertCoverageThresholdPercent:                                  cloneOptionalInt(input.TurnPolicyAlertCoverageThresholdPercent),
		TurnPolicyAlertPostToolUseLatencyP95ThresholdMs:                          cloneOptionalInt64(input.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs),
		TurnPolicyAlertStopLatencyP95ThresholdMs:                                 cloneOptionalInt64(input.TurnPolicyAlertStopLatencyP95ThresholdMs),
		TurnPolicyAlertSourceActionSuccessThresholdPercent:                       cloneOptionalInt(input.TurnPolicyAlertSourceActionSuccessThresholdPercent),
		TurnPolicyAlertSuppressedCodes:                                           cloneStrings(input.TurnPolicyAlertSuppressedCodes),
		TurnPolicyAlertAcknowledgedCodes:                                         cloneStrings(input.TurnPolicyAlertAcknowledgedCodes),
		TurnPolicyAlertSnoozedCodes:                                              cloneStrings(input.TurnPolicyAlertSnoozedCodes),
		TurnPolicyAlertSnoozeUntil:                                               cloneOptionalTime(input.TurnPolicyAlertSnoozeUntil),
		TurnPolicyAlertGovernanceHistory:                                         cloneTurnPolicyAlertGovernanceHistory(currentStored.TurnPolicyAlertGovernanceHistory),
		AllowRemoteAccess:                                                        cloneOptionalBool(input.AllowRemoteAccess),
		AllowLocalhostWithoutAccessToken:                                         cloneOptionalBool(input.AllowLocalhostWithoutAccessToken),
		AccessTokens:                                                             cloneAccessTokens(accessTokens),
		BackendThreadTraceEnabled:                                                cloneOptionalBool(input.BackendThreadTraceEnabled),
		BackendThreadTraceWorkspaceID:                                            strings.TrimSpace(input.BackendThreadTraceWorkspaceID),
		BackendThreadTraceThreadID:                                               strings.TrimSpace(input.BackendThreadTraceThreadID),
	}
	candidateConfigured, err = normalizeConfiguredPreferences(candidateConfigured)
	if err != nil {
		return ReadResult{}, err
	}
	if eventInput := normalizeOptionalTurnPolicyAlertGovernanceEventInput(input.TurnPolicyAlertGovernanceEvent); eventInput != nil &&
		turnPolicyAlertGovernanceChanged(currentConfigured, candidateConfigured) {
		candidateConfigured.TurnPolicyAlertGovernanceHistory = prependTurnPolicyAlertGovernanceEvent(
			candidateConfigured.TurnPolicyAlertGovernanceHistory,
			buildTurnPolicyAlertGovernanceEvent(*eventInput, time.Now().UTC()),
		)
	}
	effectivePrefs := s.mergeWithDefaults(candidateConfigured)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	s.store.SetRuntimePreferences(candidateConfigured)
	s.runtimes.ApplyCommand(resolved.Command)
	effectiveTrace := s.resolveThreadTraceConfig(candidateConfigured)
	diagnostics.ConfigureThreadTrace(
		effectiveTrace.Enabled,
		effectiveTrace.WorkspaceID,
		effectiveTrace.ThreadID,
	)

	return s.buildReadResult(candidateConfigured, resolved), nil
}

func (s *Service) ImportModelCatalogTemplate() (ReadResult, error) {
	sourcePath, targetPath, err := resolveManagedModelCatalogTemplatePaths()
	if err != nil {
		return ReadResult{}, err
	}

	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return ReadResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return ReadResult{}, err
	}
	if err := os.WriteFile(targetPath, content, 0o644); err != nil {
		return ReadResult{}, err
	}

	currentConfigured, err := normalizeConfiguredPreferences(s.store.GetRuntimePreferences())
	if err != nil {
		return ReadResult{}, err
	}
	candidateConfigured := store.RuntimePreferences{
		ModelCatalogPath:                                         targetPath,
		LocalShellModels:                                         cloneStrings(currentConfigured.LocalShellModels),
		DefaultShellType:                                         currentConfigured.DefaultShellType,
		DefaultTerminalShell:                                     currentConfigured.DefaultTerminalShell,
		ModelShellTypeOverrides:                                  cloneStringMap(currentConfigured.ModelShellTypeOverrides),
		OutboundProxyURL:                                         currentConfigured.OutboundProxyURL,
		DefaultTurnApprovalPolicy:                                currentConfigured.DefaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:                                 cloneAnyMap(currentConfigured.DefaultTurnSandboxPolicy),
		DefaultCommandSandboxPolicy:                              cloneAnyMap(currentConfigured.DefaultCommandSandboxPolicy),
		HookSessionStartEnabled:                                  cloneOptionalBool(currentConfigured.HookSessionStartEnabled),
		HookSessionStartContextPaths:                             cloneStrings(currentConfigured.HookSessionStartContextPaths),
		HookSessionStartMaxChars:                                 cloneOptionalInt(currentConfigured.HookSessionStartMaxChars),
		HookUserPromptSubmitBlockSecretPasteEnabled:              cloneOptionalBool(currentConfigured.HookUserPromptSubmitBlockSecretPasteEnabled),
		HookPreToolUseBlockDangerousCommandEnabled:               cloneOptionalBool(currentConfigured.HookPreToolUseBlockDangerousCommandEnabled),
		HookPreToolUseAdditionalProtectedGovernancePaths:         cloneStrings(currentConfigured.HookPreToolUseAdditionalProtectedGovernancePaths),
		TurnPolicyPostToolUseFailedValidationEnabled:             cloneOptionalBool(currentConfigured.TurnPolicyPostToolUseFailedValidationEnabled),
		TurnPolicyStopMissingSuccessfulVerificationEnabled:       cloneOptionalBool(currentConfigured.TurnPolicyStopMissingSuccessfulVerificationEnabled),
		TurnPolicyPostToolUsePrimaryAction:                       currentConfigured.TurnPolicyPostToolUsePrimaryAction,
		TurnPolicyStopMissingSuccessfulVerificationPrimaryAction: currentConfigured.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
		TurnPolicyPostToolUseInterruptNoActiveTurnBehavior:       currentConfigured.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
		TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: currentConfigured.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
		TurnPolicyValidationCommandPrefixes:                                      cloneStrings(currentConfigured.TurnPolicyValidationCommandPrefixes),
		TurnPolicyFollowUpCooldownMs:                                             cloneOptionalInt64(currentConfigured.TurnPolicyFollowUpCooldownMs),
		TurnPolicyPostToolUseFollowUpCooldownMs:                                  cloneOptionalInt64(currentConfigured.TurnPolicyPostToolUseFollowUpCooldownMs),
		TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:            cloneOptionalInt64(currentConfigured.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs),
		TurnPolicyAlertCoverageThresholdPercent:                                  cloneOptionalInt(currentConfigured.TurnPolicyAlertCoverageThresholdPercent),
		TurnPolicyAlertPostToolUseLatencyP95ThresholdMs:                          cloneOptionalInt64(currentConfigured.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs),
		TurnPolicyAlertStopLatencyP95ThresholdMs:                                 cloneOptionalInt64(currentConfigured.TurnPolicyAlertStopLatencyP95ThresholdMs),
		TurnPolicyAlertSourceActionSuccessThresholdPercent:                       cloneOptionalInt(currentConfigured.TurnPolicyAlertSourceActionSuccessThresholdPercent),
		TurnPolicyAlertSuppressedCodes:                                           cloneStrings(currentConfigured.TurnPolicyAlertSuppressedCodes),
		TurnPolicyAlertAcknowledgedCodes:                                         cloneStrings(currentConfigured.TurnPolicyAlertAcknowledgedCodes),
		TurnPolicyAlertSnoozedCodes:                                              cloneStrings(currentConfigured.TurnPolicyAlertSnoozedCodes),
		TurnPolicyAlertSnoozeUntil:                                               cloneOptionalTime(currentConfigured.TurnPolicyAlertSnoozeUntil),
		TurnPolicyAlertGovernanceHistory:                                         cloneTurnPolicyAlertGovernanceHistory(currentConfigured.TurnPolicyAlertGovernanceHistory),
		AllowRemoteAccess:                                                        cloneOptionalBool(currentConfigured.AllowRemoteAccess),
		AllowLocalhostWithoutAccessToken:                                         cloneOptionalBool(currentConfigured.AllowLocalhostWithoutAccessToken),
		AccessTokens:                                                             cloneAccessTokens(currentConfigured.AccessTokens),
		BackendThreadTraceEnabled:                                                cloneOptionalBool(currentConfigured.BackendThreadTraceEnabled),
		BackendThreadTraceWorkspaceID:                                            strings.TrimSpace(currentConfigured.BackendThreadTraceWorkspaceID),
		BackendThreadTraceThreadID:                                               strings.TrimSpace(currentConfigured.BackendThreadTraceThreadID),
	}
	effectivePrefs := s.mergeWithDefaults(candidateConfigured)
	resolved, err := appconfig.ResolveCodexRuntime(s.baseCommand, effectivePrefs)
	if err != nil {
		return ReadResult{}, err
	}

	s.store.SetRuntimePreferences(candidateConfigured)
	s.runtimes.ApplyCommand(resolved.Command)
	effectiveTrace := s.resolveThreadTraceConfig(candidateConfigured)
	diagnostics.ConfigureThreadTrace(
		effectiveTrace.Enabled,
		effectiveTrace.WorkspaceID,
		effectiveTrace.ThreadID,
	)

	return s.buildReadResult(candidateConfigured, resolved), nil
}

func (s *Service) mergeWithDefaults(configured store.RuntimePreferences) appconfig.RuntimePreferences {
	merged := appconfig.RuntimePreferences{
		ModelCatalogPath:            configured.ModelCatalogPath,
		LocalShellModels:            cloneStrings(configured.LocalShellModels),
		DefaultShellType:            configured.DefaultShellType,
		ModelShellTypeOverrides:     cloneStringMap(configured.ModelShellTypeOverrides),
		OutboundProxyURL:            configured.OutboundProxyURL,
		DefaultTurnApprovalPolicy:   configured.DefaultTurnApprovalPolicy,
		DefaultTurnSandboxPolicy:    cloneAnyMap(configured.DefaultTurnSandboxPolicy),
		DefaultCommandSandboxPolicy: cloneAnyMap(configured.DefaultCommandSandboxPolicy),
	}
	if merged.ModelCatalogPath == "" {
		merged.ModelCatalogPath = s.defaultPrefs.ModelCatalogPath
	}
	if merged.DefaultShellType == "" {
		merged.DefaultShellType = s.defaultPrefs.DefaultShellType
	}
	if len(merged.ModelShellTypeOverrides) == 0 {
		merged.ModelShellTypeOverrides = cloneStringMap(s.defaultPrefs.ModelShellTypeOverrides)
	} else {
		for key, value := range localShellModelsToOverrides(merged.LocalShellModels) {
			if _, ok := merged.ModelShellTypeOverrides[key]; !ok {
				merged.ModelShellTypeOverrides[key] = value
			}
		}
		for key, value := range s.defaultPrefs.ModelShellTypeOverrides {
			if _, ok := merged.ModelShellTypeOverrides[key]; !ok {
				merged.ModelShellTypeOverrides[key] = value
			}
		}
	}
	if merged.OutboundProxyURL == "" {
		merged.OutboundProxyURL = s.defaultPrefs.OutboundProxyURL
	}
	if merged.DefaultTurnApprovalPolicy == "" {
		merged.DefaultTurnApprovalPolicy = s.defaultPrefs.DefaultTurnApprovalPolicy
	}
	if len(merged.DefaultTurnSandboxPolicy) == 0 {
		merged.DefaultTurnSandboxPolicy = cloneAnyMap(s.defaultPrefs.DefaultTurnSandboxPolicy)
	}
	if len(merged.DefaultCommandSandboxPolicy) == 0 {
		merged.DefaultCommandSandboxPolicy = cloneAnyMap(s.defaultPrefs.DefaultCommandSandboxPolicy)
	}
	return merged
}

func normalizeInputs(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	items := make(map[string]string, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		trimmedValue := strings.TrimSpace(value)
		if trimmedKey == "" || trimmedValue == "" {
			continue
		}
		items[trimmedKey] = trimmedValue
	}
	if len(items) == 0 {
		return nil
	}
	return items
}

func normalizeConfiguredPreferences(input store.RuntimePreferences) (store.RuntimePreferences, error) {
	defaultTurnApprovalPolicy, err := appconfig.NormalizeApprovalPolicy(input.DefaultTurnApprovalPolicy)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	defaultTurnSandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(input.DefaultTurnSandboxPolicy)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	defaultCommandSandboxPolicy, err := appconfig.NormalizeSandboxPolicyMap(input.DefaultCommandSandboxPolicy)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	outboundProxyURL, err := appconfig.NormalizeOutboundProxyURL(input.OutboundProxyURL)
	if err != nil {
		return store.RuntimePreferences{}, err
	}

	input.DefaultTurnApprovalPolicy = defaultTurnApprovalPolicy
	input.DefaultTerminalShell = normalizeTerminalShellPreference(input.DefaultTerminalShell)
	input.OutboundProxyURL = outboundProxyURL
	input.DefaultTurnSandboxPolicy = defaultTurnSandboxPolicy
	input.DefaultCommandSandboxPolicy = defaultCommandSandboxPolicy
	input.HookSessionStartEnabled = cloneOptionalBool(input.HookSessionStartEnabled)
	input.HookSessionStartContextPaths = hooks.NormalizeSessionStartContextPaths(input.HookSessionStartContextPaths)
	input.HookSessionStartMaxChars, err = normalizeOptionalPositiveInt(
		input.HookSessionStartMaxChars,
		"hook session-start max chars",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.HookUserPromptSubmitBlockSecretPasteEnabled = cloneOptionalBool(input.HookUserPromptSubmitBlockSecretPasteEnabled)
	input.HookPreToolUseBlockDangerousCommandEnabled = cloneOptionalBool(input.HookPreToolUseBlockDangerousCommandEnabled)
	input.HookPreToolUseAdditionalProtectedGovernancePaths = hooks.NormalizeProtectedGovernancePaths(
		input.HookPreToolUseAdditionalProtectedGovernancePaths,
	)
	input.TurnPolicyPostToolUseFailedValidationEnabled = cloneOptionalBool(input.TurnPolicyPostToolUseFailedValidationEnabled)
	input.TurnPolicyStopMissingSuccessfulVerificationEnabled = cloneOptionalBool(input.TurnPolicyStopMissingSuccessfulVerificationEnabled)
	input.TurnPolicyPostToolUsePrimaryAction, err = normalizeOptionalTurnPolicyPrimaryAction(
		input.TurnPolicyPostToolUsePrimaryAction,
		"turn policy post-tool-use primary action",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction, err = normalizeOptionalTurnPolicyPrimaryAction(
		input.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
		"turn policy stop-missing-successful-verification primary action",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior, err = normalizeOptionalTurnPolicyInterruptNoActiveTurnBehavior(
		input.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
		"turn policy post-tool-use interrupt no-active-turn behavior",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior, err = normalizeOptionalTurnPolicyInterruptNoActiveTurnBehavior(
		input.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
		"turn policy stop-missing-successful-verification interrupt no-active-turn behavior",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyValidationCommandPrefixes = turnpolicies.NormalizeValidationCommandPrefixes(input.TurnPolicyValidationCommandPrefixes)
	input.TurnPolicyFollowUpCooldownMs, err = normalizeOptionalNonNegativeInt64(
		input.TurnPolicyFollowUpCooldownMs,
		"turn policy follow-up cooldown ms",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyPostToolUseFollowUpCooldownMs, err = normalizeOptionalNonNegativeInt64(
		input.TurnPolicyPostToolUseFollowUpCooldownMs,
		"turn policy post-tool-use follow-up cooldown ms",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs, err = normalizeOptionalNonNegativeInt64(
		input.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs,
		"turn policy stop-missing-successful-verification follow-up cooldown ms",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyAlertCoverageThresholdPercent, err = normalizeOptionalPercent(
		input.TurnPolicyAlertCoverageThresholdPercent,
		"turn policy alert coverage threshold percent",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs, err = normalizeOptionalNonNegativeInt64(
		input.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs,
		"turn policy alert post-tool-use latency p95 threshold ms",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyAlertStopLatencyP95ThresholdMs, err = normalizeOptionalNonNegativeInt64(
		input.TurnPolicyAlertStopLatencyP95ThresholdMs,
		"turn policy alert stop latency p95 threshold ms",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyAlertSourceActionSuccessThresholdPercent, err = normalizeOptionalPercent(
		input.TurnPolicyAlertSourceActionSuccessThresholdPercent,
		"turn policy alert source action success threshold percent",
	)
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.TurnPolicyAlertSuppressedCodes = normalizeStringList(input.TurnPolicyAlertSuppressedCodes)
	input.TurnPolicyAlertAcknowledgedCodes = normalizeStringList(input.TurnPolicyAlertAcknowledgedCodes)
	input.TurnPolicyAlertSnoozedCodes = normalizeStringList(input.TurnPolicyAlertSnoozedCodes)
	input.TurnPolicyAlertSnoozeUntil = normalizeOptionalUTC(input.TurnPolicyAlertSnoozeUntil)
	input.TurnPolicyAlertGovernanceHistory = normalizeTurnPolicyAlertGovernanceHistory(input.TurnPolicyAlertGovernanceHistory)
	input.AllowRemoteAccess = cloneOptionalBool(input.AllowRemoteAccess)
	input.AllowLocalhostWithoutAccessToken = cloneOptionalBool(input.AllowLocalhostWithoutAccessToken)
	normalizedTokens, err := accesscontrol.NormalizeConfiguredTokens(input.AccessTokens, time.Now().UTC())
	if err != nil {
		return store.RuntimePreferences{}, err
	}
	input.AccessTokens = cloneAccessTokens(normalizedTokens)
	input.BackendThreadTraceEnabled = cloneOptionalBool(input.BackendThreadTraceEnabled)
	input.BackendThreadTraceWorkspaceID = strings.TrimSpace(input.BackendThreadTraceWorkspaceID)
	input.BackendThreadTraceThreadID = strings.TrimSpace(input.BackendThreadTraceThreadID)
	return input, nil
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	return append([]string(nil), values...)
}

func cloneStringsOrEmpty(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string(nil), values...)
}

func normalizeStringList(values []string) []string {
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

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func cloneAnyMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = cloneAnyValue(value)
	}
	return cloned
}

func cloneAnyValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneAnyMap(typed)
	case []any:
		cloned := make([]any, len(typed))
		for index, entry := range typed {
			cloned[index] = cloneAnyValue(entry)
		}
		return cloned
	default:
		return typed
	}
}

func cloneAccessTokens(values []store.AccessToken) []store.AccessToken {
	if len(values) == 0 {
		return nil
	}

	cloned := make([]store.AccessToken, len(values))
	for index, token := range values {
		next := token
		if token.ExpiresAt != nil {
			expiresAt := token.ExpiresAt.UTC()
			next.ExpiresAt = &expiresAt
		}
		cloned[index] = next
	}
	return cloned
}

func cloneOptionalBool(value *bool) *bool {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func cloneOptionalInt(value *int) *int {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func cloneOptionalInt64(value *int64) *int64 {
	if value == nil {
		return nil
	}

	cloned := *value
	return &cloned
}

func cloneOptionalTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
}

func normalizeOptionalPercent(value *int, fieldName string) (*int, error) {
	if value == nil {
		return nil, nil
	}
	if *value < 0 || *value > 100 {
		return nil, errors.New(fieldName + " must be between 0 and 100")
	}
	return cloneOptionalInt(value), nil
}

func normalizeOptionalNonNegativeInt64(value *int64, fieldName string) (*int64, error) {
	if value == nil {
		return nil, nil
	}
	if *value < 0 {
		return nil, errors.New(fieldName + " must be greater than or equal to 0")
	}
	return cloneOptionalInt64(value), nil
}

func normalizeOptionalPositiveInt(value *int, fieldName string) (*int, error) {
	if value == nil {
		return nil, nil
	}
	if *value <= 0 {
		return nil, errors.New(fieldName + " must be greater than 0")
	}
	return cloneOptionalInt(value), nil
}

func normalizeOptionalUTC(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
}

func normalizeOptionalTurnPolicyPrimaryAction(value string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(value)
	switch trimmed {
	case "", "steer", "followUp", "interrupt":
		return trimmed, nil
	default:
		return "", errors.New(fieldName + " must be one of: steer, followUp, interrupt")
	}
}

func normalizeOptionalTurnPolicyInterruptNoActiveTurnBehavior(value string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(value)
	switch trimmed {
	case "", "skip", "followUp":
		return trimmed, nil
	default:
		return "", errors.New(fieldName + " must be one of: skip, followUp")
	}
}

func (s *Service) resolveThreadTraceConfig(configured store.RuntimePreferences) diagnostics.ThreadTraceConfig {
	hasOverride :=
		configured.BackendThreadTraceEnabled != nil ||
			strings.TrimSpace(configured.BackendThreadTraceWorkspaceID) != "" ||
			strings.TrimSpace(configured.BackendThreadTraceThreadID) != ""
	if !hasOverride {
		return s.defaultTrace
	}

	enabled := s.defaultTrace.Enabled
	if configured.BackendThreadTraceEnabled != nil {
		enabled = *configured.BackendThreadTraceEnabled
	}

	return diagnostics.ThreadTraceConfig{
		Enabled:     enabled,
		WorkspaceID: strings.TrimSpace(configured.BackendThreadTraceWorkspaceID),
		ThreadID:    strings.TrimSpace(configured.BackendThreadTraceThreadID),
	}
}

func (s *Service) buildReadResult(
	configuredPrefs store.RuntimePreferences,
	resolved appconfig.ResolvedRuntime,
) ReadResult {
	now := time.Now().UTC()
	effectiveTrace := s.resolveThreadTraceConfig(configuredPrefs)
	alertThresholds := turnpolicies.ResolveMetricsAlertThresholds(configuredPrefs)
	suppressedAlertCodes := turnpolicies.ResolveAlertSuppressedCodes(configuredPrefs)
	acknowledgedAlertCodes := turnpolicies.ResolveAlertAcknowledgedCodes(configuredPrefs)
	activeSnoozedCodes, activeSnoozeUntil := turnpolicies.ResolveAlertSnooze(configuredPrefs, now)
	configuredSnoozeActive, configuredSnoozeExpired := resolveConfiguredTurnPolicyAlertSnoozeState(
		configuredPrefs,
		now,
	)
	hookRuntimeConfig := hooks.ResolveRuntimeConfig(configuredPrefs)
	runtimeConfig := turnpolicies.ResolveRuntimeConfig(configuredPrefs)
	effectiveAllowRemoteAccess := s.defaultAllowRemoteAccess
	if configuredPrefs.AllowRemoteAccess != nil {
		effectiveAllowRemoteAccess = *configuredPrefs.AllowRemoteAccess
	}
	effectiveAllowLocalhostWithoutAccessToken := accesscontrol.DefaultAllowLocalhostWithoutAccessToken
	if configuredPrefs.AllowLocalhostWithoutAccessToken != nil {
		effectiveAllowLocalhostWithoutAccessToken = *configuredPrefs.AllowLocalhostWithoutAccessToken
	}

	return ReadResult{
		ConfiguredModelCatalogPath:                                                         configuredPrefs.ModelCatalogPath,
		ConfiguredDefaultShellType:                                                         configuredPrefs.DefaultShellType,
		ConfiguredDefaultTerminalShell:                                                     configuredPrefs.DefaultTerminalShell,
		SupportedTerminalShells:                                                            detectSupportedTerminalShells(),
		ConfiguredModelShellTypeOverrides:                                                  cloneStringMap(configuredPrefs.ModelShellTypeOverrides),
		ConfiguredOutboundProxyURL:                                                         configuredPrefs.OutboundProxyURL,
		ConfiguredDefaultTurnApprovalPolicy:                                                configuredPrefs.DefaultTurnApprovalPolicy,
		ConfiguredDefaultTurnSandboxPolicy:                                                 cloneAnyMap(configuredPrefs.DefaultTurnSandboxPolicy),
		ConfiguredDefaultCommandSandboxPolicy:                                              cloneAnyMap(configuredPrefs.DefaultCommandSandboxPolicy),
		ConfiguredHookSessionStartEnabled:                                                  cloneOptionalBool(configuredPrefs.HookSessionStartEnabled),
		ConfiguredHookSessionStartContextPaths:                                             cloneStringsOrEmpty(configuredPrefs.HookSessionStartContextPaths),
		ConfiguredHookSessionStartMaxChars:                                                 cloneOptionalInt(configuredPrefs.HookSessionStartMaxChars),
		ConfiguredHookUserPromptSubmitBlockSecretPasteEnabled:                              cloneOptionalBool(configuredPrefs.HookUserPromptSubmitBlockSecretPasteEnabled),
		ConfiguredHookPreToolUseBlockDangerousCommandEnabled:                               cloneOptionalBool(configuredPrefs.HookPreToolUseBlockDangerousCommandEnabled),
		ConfiguredHookPreToolUseAdditionalProtectedGovernancePaths:                         cloneStringsOrEmpty(configuredPrefs.HookPreToolUseAdditionalProtectedGovernancePaths),
		ConfiguredTurnPolicyPostToolUseFailedValidationEnabled:                             cloneOptionalBool(configuredPrefs.TurnPolicyPostToolUseFailedValidationEnabled),
		ConfiguredTurnPolicyStopMissingSuccessfulVerificationEnabled:                       cloneOptionalBool(configuredPrefs.TurnPolicyStopMissingSuccessfulVerificationEnabled),
		ConfiguredTurnPolicyPostToolUsePrimaryAction:                                       strings.TrimSpace(configuredPrefs.TurnPolicyPostToolUsePrimaryAction),
		ConfiguredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:                 strings.TrimSpace(configuredPrefs.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction),
		ConfiguredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior:                       strings.TrimSpace(configuredPrefs.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior),
		ConfiguredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: strings.TrimSpace(configuredPrefs.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior),
		ConfiguredTurnPolicyValidationCommandPrefixes:                                      cloneStringsOrEmpty(configuredPrefs.TurnPolicyValidationCommandPrefixes),
		ConfiguredTurnPolicyFollowUpCooldownMs:                                             cloneOptionalInt64(configuredPrefs.TurnPolicyFollowUpCooldownMs),
		ConfiguredTurnPolicyPostToolUseFollowUpCooldownMs:                                  cloneOptionalInt64(configuredPrefs.TurnPolicyPostToolUseFollowUpCooldownMs),
		ConfiguredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:            cloneOptionalInt64(configuredPrefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs),
		ConfiguredTurnPolicyAlertCoverageThresholdPercent:                                  cloneOptionalInt(configuredPrefs.TurnPolicyAlertCoverageThresholdPercent),
		ConfiguredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs:                          cloneOptionalInt64(configuredPrefs.TurnPolicyAlertPostToolUseLatencyP95ThresholdMs),
		ConfiguredTurnPolicyAlertStopLatencyP95ThresholdMs:                                 cloneOptionalInt64(configuredPrefs.TurnPolicyAlertStopLatencyP95ThresholdMs),
		ConfiguredTurnPolicyAlertSourceActionSuccessThresholdPercent:                       cloneOptionalInt(configuredPrefs.TurnPolicyAlertSourceActionSuccessThresholdPercent),
		ConfiguredTurnPolicyAlertSuppressedCodes:                                           cloneStringsOrEmpty(configuredPrefs.TurnPolicyAlertSuppressedCodes),
		ConfiguredTurnPolicyAlertAcknowledgedCodes:                                         cloneStringsOrEmpty(configuredPrefs.TurnPolicyAlertAcknowledgedCodes),
		ConfiguredTurnPolicyAlertSnoozedCodes:                                              cloneStringsOrEmpty(configuredPrefs.TurnPolicyAlertSnoozedCodes),
		ConfiguredTurnPolicyAlertSnoozeUntil:                                               cloneOptionalTime(configuredPrefs.TurnPolicyAlertSnoozeUntil),
		ConfiguredTurnPolicyAlertSnoozeActive:                                              configuredSnoozeActive,
		ConfiguredTurnPolicyAlertSnoozeExpired:                                             configuredSnoozeExpired,
		TurnPolicyAlertGovernanceHistory:                                                   cloneTurnPolicyAlertGovernanceHistory(configuredPrefs.TurnPolicyAlertGovernanceHistory),
		ConfiguredAllowRemoteAccess:                                                        cloneOptionalBool(configuredPrefs.AllowRemoteAccess),
		ConfiguredAllowLocalhostWithoutAccessToken:                                         cloneOptionalBool(configuredPrefs.AllowLocalhostWithoutAccessToken),
		ConfiguredAccessTokens:                                                             accesscontrol.DescribeTokens(configuredPrefs.AccessTokens, now),
		ConfiguredBackendThreadTraceEnabled:                                                cloneOptionalBool(configuredPrefs.BackendThreadTraceEnabled),
		ConfiguredBackendThreadTraceWorkspaceID:                                            strings.TrimSpace(configuredPrefs.BackendThreadTraceWorkspaceID),
		ConfiguredBackendThreadTraceThreadID:                                               strings.TrimSpace(configuredPrefs.BackendThreadTraceThreadID),
		DefaultModelCatalogPath:                                                            s.defaultPrefs.ModelCatalogPath,
		DefaultDefaultShellType:                                                            s.defaultPrefs.DefaultShellType,
		DefaultDefaultTerminalShell:                                                        "auto",
		DefaultModelShellTypeOverrides:                                                     cloneStringMap(s.defaultPrefs.ModelShellTypeOverrides),
		DefaultOutboundProxyURL:                                                            s.defaultPrefs.OutboundProxyURL,
		DefaultDefaultTurnApprovalPolicy:                                                   s.defaultPrefs.DefaultTurnApprovalPolicy,
		DefaultDefaultTurnSandboxPolicy:                                                    cloneAnyMap(s.defaultPrefs.DefaultTurnSandboxPolicy),
		DefaultDefaultCommandSandboxPolicy:                                                 cloneAnyMap(s.defaultPrefs.DefaultCommandSandboxPolicy),
		DefaultHookSessionStartEnabled:                                                     hooks.DefaultSessionStartEnabled,
		DefaultHookSessionStartContextPaths:                                                hooks.DefaultSessionStartContextPaths(),
		DefaultHookSessionStartMaxChars:                                                    hooks.DefaultSessionStartMaxChars,
		DefaultHookUserPromptSubmitBlockSecretPasteEnabled:                                 hooks.DefaultUserPromptSecretBlockEnabled,
		DefaultHookPreToolUseBlockDangerousCommandEnabled:                                  hooks.DefaultPreToolUseDangerousCommandBlockEnabled,
		DefaultHookPreToolUseProtectedGovernancePaths:                                      hooks.DefaultProtectedGovernancePaths(),
		DefaultTurnPolicyPostToolUseFailedValidationEnabled:                                turnpolicies.DefaultPostToolUseFailedValidationEnabled,
		DefaultTurnPolicyStopMissingSuccessfulVerificationEnabled:                          turnpolicies.DefaultStopMissingSuccessfulVerificationEnabled,
		DefaultTurnPolicyPostToolUsePrimaryAction:                                          turnpolicies.DefaultPostToolUsePrimaryAction,
		DefaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:                    turnpolicies.DefaultStopMissingSuccessfulVerificationPrimaryAction,
		DefaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior:                          turnpolicies.DefaultPostToolUseInterruptNoActiveTurnBehavior,
		DefaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:    turnpolicies.DefaultStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
		DefaultTurnPolicyValidationCommandPrefixes:                                         turnpolicies.DefaultValidationCommandPrefixes(),
		DefaultTurnPolicyFollowUpCooldownMs:                                                turnpolicies.DefaultFollowUpCooldownMs,
		DefaultTurnPolicyPostToolUseFollowUpCooldownMs:                                     turnpolicies.DefaultFollowUpCooldownMs,
		DefaultTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:               turnpolicies.DefaultFollowUpCooldownMs,
		DefaultTurnPolicyAlertCoverageThresholdPercent:                                     turnpolicies.DefaultAlertCoverageThresholdPercent,
		DefaultTurnPolicyAlertPostToolUseLatencyP95ThresholdMs:                             turnpolicies.DefaultAlertPostToolUseLatencyP95ThresholdMs,
		DefaultTurnPolicyAlertStopLatencyP95ThresholdMs:                                    turnpolicies.DefaultAlertStopLatencyP95ThresholdMs,
		DefaultTurnPolicyAlertSourceActionSuccessThresholdPercent:                          turnpolicies.DefaultAlertSourceActionSuccessThresholdPercent,
		DefaultTurnPolicyAlertSuppressedCodes:                                              []string{},
		DefaultTurnPolicyAlertAcknowledgedCodes:                                            []string{},
		DefaultTurnPolicyAlertSnoozedCodes:                                                 []string{},
		DefaultTurnPolicyAlertSnoozeUntil:                                                  nil,
		DefaultAllowRemoteAccess:                                                           s.defaultAllowRemoteAccess,
		DefaultAllowLocalhostWithoutAccessToken:                                            accesscontrol.DefaultAllowLocalhostWithoutAccessToken,
		DefaultBackendThreadTraceEnabled:                                                   s.defaultTrace.Enabled,
		DefaultBackendThreadTraceWorkspaceID:                                               s.defaultTrace.WorkspaceID,
		DefaultBackendThreadTraceThreadID:                                                  s.defaultTrace.ThreadID,
		EffectiveModelCatalogPath:                                                          resolved.EffectiveModelCatalogPath,
		EffectiveDefaultShellType:                                                          resolved.Preferences.DefaultShellType,
		EffectiveDefaultTerminalShell:                                                      effectiveTerminalShellPreference(configuredPrefs.DefaultTerminalShell),
		EffectiveModelShellTypeOverrides:                                                   cloneStringMap(resolved.Preferences.ModelShellTypeOverrides),
		EffectiveOutboundProxyURL:                                                          resolved.Preferences.OutboundProxyURL,
		EffectiveDefaultTurnApprovalPolicy:                                                 resolved.Preferences.DefaultTurnApprovalPolicy,
		EffectiveDefaultTurnSandboxPolicy:                                                  cloneAnyMap(resolved.Preferences.DefaultTurnSandboxPolicy),
		EffectiveDefaultCommandSandboxPolicy:                                               cloneAnyMap(resolved.Preferences.DefaultCommandSandboxPolicy),
		EffectiveHookSessionStartEnabled:                                                   hookRuntimeConfig.SessionStartEnabled,
		EffectiveHookSessionStartContextPaths:                                              cloneStringsOrEmpty(hookRuntimeConfig.SessionStartContextPaths),
		EffectiveHookSessionStartMaxChars:                                                  hookRuntimeConfig.SessionStartMaxChars,
		EffectiveHookUserPromptSubmitBlockSecretPasteEnabled:                               hookRuntimeConfig.UserPromptSecretBlockEnabled,
		EffectiveHookPreToolUseBlockDangerousCommandEnabled:                                hookRuntimeConfig.PreToolUseDangerousCommandBlockEnabled,
		EffectiveHookPreToolUseProtectedGovernancePaths:                                    cloneStringsOrEmpty(hookRuntimeConfig.PreToolUseProtectedGovernancePaths),
		EffectiveTurnPolicyPostToolUseFailedValidationEnabled:                              runtimeConfig.PostToolUseFailedValidationEnabled,
		EffectiveTurnPolicyStopMissingSuccessfulVerificationEnabled:                        runtimeConfig.StopMissingVerificationEnabled,
		EffectiveTurnPolicyPostToolUsePrimaryAction:                                        runtimeConfig.PostToolUsePrimaryAction,
		EffectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:                  runtimeConfig.StopMissingVerificationPrimaryAction,
		EffectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior:                        runtimeConfig.PostToolUseInterruptNoActiveTurnBehavior,
		EffectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:  runtimeConfig.StopMissingVerificationInterruptNoActiveTurnBehavior,
		EffectiveTurnPolicyValidationCommandPrefixes:                                       cloneStringsOrEmpty(runtimeConfig.ValidationCommandPrefixes),
		EffectiveTurnPolicyFollowUpCooldownMs:                                              runtimeConfig.FollowUpCooldownMs,
		EffectiveTurnPolicyPostToolUseFollowUpCooldownMs:                                   runtimeConfig.PostToolUseFollowUpCooldownMs,
		EffectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:             runtimeConfig.StopMissingVerificationFollowUpCooldownMs,
		EffectiveTurnPolicyAlertCoverageThresholdPercent:                                   alertThresholds.CoverageThresholdPercent,
		EffectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs:                           alertThresholds.PostToolUseLatencyP95ThresholdMs,
		EffectiveTurnPolicyAlertStopLatencyP95ThresholdMs:                                  alertThresholds.StopLatencyP95ThresholdMs,
		EffectiveTurnPolicyAlertSourceActionSuccessThresholdPercent:                        alertThresholds.SourceActionSuccessThresholdPercent,
		EffectiveTurnPolicyAlertSuppressedCodes:                                            cloneStringsOrEmpty(suppressedAlertCodes),
		EffectiveTurnPolicyAlertAcknowledgedCodes:                                          cloneStringsOrEmpty(acknowledgedAlertCodes),
		EffectiveTurnPolicyAlertSnoozedCodes:                                               cloneStringsOrEmpty(activeSnoozedCodes),
		EffectiveTurnPolicyAlertSnoozeUntil:                                                cloneOptionalTime(activeSnoozeUntil),
		EffectiveAllowRemoteAccess:                                                         effectiveAllowRemoteAccess,
		EffectiveAllowLocalhostWithoutAccessToken:                                          effectiveAllowLocalhostWithoutAccessToken,
		EffectiveBackendThreadTraceEnabled:                                                 effectiveTrace.Enabled,
		EffectiveBackendThreadTraceWorkspaceID:                                             effectiveTrace.WorkspaceID,
		EffectiveBackendThreadTraceThreadID:                                                effectiveTrace.ThreadID,
		EffectiveCommand:                                                                   resolved.Command,
	}
}

func resolveConfiguredTurnPolicyAlertSnoozeState(
	configuredPrefs store.RuntimePreferences,
	now time.Time,
) (bool, bool) {
	snoozedCodes := normalizeConfiguredTurnPolicyAlertCodes(
		configuredPrefs.TurnPolicyAlertSnoozedCodes,
	)
	snoozeUntil := cloneOptionalTime(configuredPrefs.TurnPolicyAlertSnoozeUntil)
	if len(snoozedCodes) == 0 || snoozeUntil == nil {
		return false, false
	}
	if now.Before(*snoozeUntil) {
		return true, false
	}
	return false, true
}

func normalizeOptionalTurnPolicyAlertGovernanceEventInput(
	input *TurnPolicyAlertGovernanceEventInput,
) *TurnPolicyAlertGovernanceEventInput {
	if input == nil {
		return nil
	}

	action := strings.TrimSpace(input.Action)
	if action == "" {
		return nil
	}

	return &TurnPolicyAlertGovernanceEventInput{
		Action:      action,
		Source:      strings.TrimSpace(input.Source),
		Codes:       normalizeConfiguredTurnPolicyAlertCodes(input.Codes),
		SnoozeUntil: cloneOptionalTime(input.SnoozeUntil),
	}
}

func turnPolicyAlertGovernanceChanged(
	before store.RuntimePreferences,
	after store.RuntimePreferences,
) bool {
	if !stringSlicesEqual(before.TurnPolicyAlertSuppressedCodes, after.TurnPolicyAlertSuppressedCodes) {
		return true
	}
	if !stringSlicesEqual(before.TurnPolicyAlertAcknowledgedCodes, after.TurnPolicyAlertAcknowledgedCodes) {
		return true
	}
	if !stringSlicesEqual(before.TurnPolicyAlertSnoozedCodes, after.TurnPolicyAlertSnoozedCodes) {
		return true
	}
	return !optionalTimesEqual(before.TurnPolicyAlertSnoozeUntil, after.TurnPolicyAlertSnoozeUntil)
}

func buildTurnPolicyAlertGovernanceEvent(
	input TurnPolicyAlertGovernanceEventInput,
	now time.Time,
) store.TurnPolicyAlertGovernanceEvent {
	createdAt := now.UTC()
	return store.TurnPolicyAlertGovernanceEvent{
		ID:          fmt.Sprintf("tpage_%d", createdAt.UnixNano()),
		Action:      strings.TrimSpace(input.Action),
		Source:      strings.TrimSpace(input.Source),
		Codes:       normalizeConfiguredTurnPolicyAlertCodes(input.Codes),
		SnoozeUntil: cloneOptionalTime(input.SnoozeUntil),
		CreatedAt:   createdAt,
	}
}

func prependTurnPolicyAlertGovernanceEvent(
	history []store.TurnPolicyAlertGovernanceEvent,
	event store.TurnPolicyAlertGovernanceEvent,
) []store.TurnPolicyAlertGovernanceEvent {
	next := make([]store.TurnPolicyAlertGovernanceEvent, 0, minInt(maxTurnPolicyAlertGovernanceHistoryEntries, len(history)+1))
	next = append(next, cloneTurnPolicyAlertGovernanceEvent(event))
	for _, existing := range history {
		if len(next) >= maxTurnPolicyAlertGovernanceHistoryEntries {
			break
		}
		next = append(next, cloneTurnPolicyAlertGovernanceEvent(existing))
	}
	return next
}

func normalizeTurnPolicyAlertGovernanceHistory(
	values []store.TurnPolicyAlertGovernanceEvent,
) []store.TurnPolicyAlertGovernanceEvent {
	if len(values) == 0 {
		return nil
	}

	normalized := make([]store.TurnPolicyAlertGovernanceEvent, 0, minInt(len(values), maxTurnPolicyAlertGovernanceHistoryEntries))
	for _, value := range values {
		action := strings.TrimSpace(value.Action)
		if action == "" {
			continue
		}

		next := store.TurnPolicyAlertGovernanceEvent{
			ID:          strings.TrimSpace(value.ID),
			Action:      action,
			Source:      strings.TrimSpace(value.Source),
			Codes:       normalizeConfiguredTurnPolicyAlertCodes(value.Codes),
			SnoozeUntil: cloneOptionalTime(value.SnoozeUntil),
			CreatedAt:   value.CreatedAt.UTC(),
		}
		normalized = append(normalized, next)
		if len(normalized) >= maxTurnPolicyAlertGovernanceHistoryEntries {
			break
		}
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func cloneTurnPolicyAlertGovernanceHistory(
	values []store.TurnPolicyAlertGovernanceEvent,
) []store.TurnPolicyAlertGovernanceEvent {
	if len(values) == 0 {
		return nil
	}

	cloned := make([]store.TurnPolicyAlertGovernanceEvent, len(values))
	for index, value := range values {
		cloned[index] = cloneTurnPolicyAlertGovernanceEvent(value)
	}
	return cloned
}

func cloneTurnPolicyAlertGovernanceEvent(
	value store.TurnPolicyAlertGovernanceEvent,
) store.TurnPolicyAlertGovernanceEvent {
	next := value
	next.ID = strings.TrimSpace(value.ID)
	next.Action = strings.TrimSpace(value.Action)
	next.Source = strings.TrimSpace(value.Source)
	next.Codes = normalizeConfiguredTurnPolicyAlertCodes(value.Codes)
	next.SnoozeUntil = cloneOptionalTime(value.SnoozeUntil)
	next.CreatedAt = value.CreatedAt.UTC()
	return next
}

func stringSlicesEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func optionalTimesEqual(left *time.Time, right *time.Time) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.Equal(*right)
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func normalizeConfiguredTurnPolicyAlertCodes(values []string) []string {
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
	return items
}

func detectSupportedTerminalShells() []string {
	items := make([]string, 0, 8)
	seen := make(map[string]struct{}, 8)

	add := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		if _, ok := seen[trimmed]; ok {
			return
		}
		seen[trimmed] = struct{}{}
		items = append(items, trimmed)
	}

	if stdruntime.GOOS == "windows" {
		if shellExists("pwsh.exe", "pwsh") {
			add("pwsh")
		}
		if shellExists("powershell.exe", "powershell") {
			add("powershell")
		}
		if strings.TrimSpace(os.Getenv("ComSpec")) != "" || shellExists("cmd.exe") {
			add("cmd")
		}
		if shellExists("wsl.exe", "wsl") {
			add("wsl")
		}
		if gitBashPath, ok := resolvePreferredGitBashPath(exec.LookPath); ok && strings.TrimSpace(gitBashPath) != "" {
			add("git-bash")
		}
	}

	if stdruntime.GOOS != "windows" && shellExists("bash", "/bin/bash", "/usr/bin/bash") {
		add("bash")
	}
	if shellExists("zsh", "/bin/zsh", "/usr/bin/zsh") {
		add("zsh")
	}
	if shellExists("sh", "/bin/sh", "/usr/bin/sh") {
		add("sh")
	}

	return items
}

func shellExists(candidates ...string) bool {
	for _, candidate := range candidates {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}

		if filepath.IsAbs(trimmed) {
			if info, err := os.Stat(trimmed); err == nil && !info.IsDir() {
				return true
			}
			continue
		}

		if resolved, err := exec.LookPath(trimmed); err == nil && strings.TrimSpace(resolved) != "" {
			return true
		}
	}

	return false
}

func resolvePreferredGitBashPath(lookPath func(string) (string, error)) (string, bool) {
	if gitPath, err := lookPath("git.exe"); err == nil && strings.TrimSpace(gitPath) != "" {
		gitRoot := filepath.Clean(filepath.Join(filepath.Dir(gitPath), ".."))
		for _, candidate := range []string{
			filepath.Join(gitRoot, "bin", "bash.exe"),
			filepath.Join(gitRoot, "git-bash.exe"),
			filepath.Join(gitRoot, "usr", "bin", "bash.exe"),
		} {
			if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
				return candidate, true
			}
		}
	}

	for _, candidate := range []string{
		`C:\Program Files\Git\bin\bash.exe`,
		`C:\Program Files\Git\git-bash.exe`,
		`C:\Program Files\Git\usr\bin\bash.exe`,
	} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
	}

	return "", false
}

func normalizeTerminalShellPreference(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "auto":
		return ""
	case "pwsh", "powershell", "cmd", "bash", "zsh", "sh":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func effectiveTerminalShellPreference(value string) string {
	normalized := normalizeTerminalShellPreference(value)
	if normalized == "" {
		return "auto"
	}

	return normalized
}

func resolveManagedModelCatalogTemplatePaths() (string, string, error) {
	workingDir, err := os.Getwd()
	if err != nil {
		return "", "", err
	}

	candidates := []string{
		filepath.Clean(workingDir),
		filepath.Clean(filepath.Dir(workingDir)),
	}

	for _, root := range candidates {
		sourcePath := filepath.Join(root, "config", "model-catalog.json")
		info, err := os.Stat(sourcePath)
		if err == nil && !info.IsDir() {
			targetPath := filepath.Join(root, "config", "runtime-model-catalog.json")
			return sourcePath, targetPath, nil
		}
	}

	return "", "", errors.New("bundled model catalog template not found at config/model-catalog.json")
}

func localShellModelsToOverrides(values []string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	overrides := make(map[string]string, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		overrides[trimmed] = "local"
	}
	if len(overrides) == 0 {
		return nil
	}
	return overrides
}
