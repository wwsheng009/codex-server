import { describe, expect, it } from "vitest";

import {
  buildConfiguredRuntimePreferencesWritePayload,
  buildDraftTurnPolicyAlertAcknowledgementPayload,
  buildConfiguredBackendThreadTracePayload,
  buildConfiguredTurnPolicyInterruptNoActiveTurnBehaviorPayload,
  buildConfiguredTurnPolicyPrimaryActionPayload,
  buildDraftBackendThreadTracePayload,
  buildDraftTurnPolicyInterruptNoActiveTurnBehaviorPayload,
  buildDraftTurnPolicyPrimaryActionPayload,
  buildDraftTurnPolicyValidationCommandPrefixesPayload,
  buildTurnPolicyAlertGovernancePayload,
  datetimeLocalInputToIsoString,
  formatHookPreToolUseAdditionalProtectedGovernancePathsInput,
  formatHookSessionStartContextPathsInput,
  formatTurnPolicyAlertAcknowledgedCodesInput,
  formatTurnPolicyAlertSnoozedCodesInput,
  formatTurnPolicyInterruptNoActiveTurnBehaviorLabel,
  formatTurnPolicyPrimaryActionLabel,
  formatTurnPolicyAlertSuppressedCodesInput,
  formatTurnPolicyValidationCommandPrefixesInput,
  isoStringToDatetimeLocalInput,
  mergeTurnPolicyAlertCodes,
  normalizeTurnPolicyInterruptNoActiveTurnBehavior,
  normalizeTurnPolicyPrimaryAction,
  parseHookPreToolUseAdditionalProtectedGovernancePathsInput,
  parseHookSessionStartContextPathsInput,
  parseTurnPolicyAlertAcknowledgedCodesInput,
  parseTurnPolicyAlertSuppressedCodesInput,
  parseTurnPolicyAlertSnoozedCodesInput,
  parseTurnPolicyValidationCommandPrefixesInput,
} from "./configSettingsPageRuntimePreferences";
import type { RuntimePreferencesResult } from "../../types/api";

describe("configSettingsPageRuntimePreferences", () => {
  it("preserves configured trace overrides when another settings card saves", () => {
    expect(
      buildConfiguredBackendThreadTracePayload({
        configuredBackendThreadTraceEnabled: true,
        configuredBackendThreadTraceWorkspaceId: " ws-configured ",
        configuredBackendThreadTraceThreadId: " thread-configured ",
      }),
    ).toEqual({
      backendThreadTraceEnabled: true,
      backendThreadTraceWorkspaceId: "ws-configured",
      backendThreadTraceThreadId: "thread-configured",
    });
  });

  it("does not materialize env-default trace values into a new explicit override", () => {
    expect(
      buildConfiguredBackendThreadTracePayload({
        configuredBackendThreadTraceEnabled: null,
        configuredBackendThreadTraceWorkspaceId: "",
        configuredBackendThreadTraceThreadId: "",
      }),
    ).toEqual({
      backendThreadTraceEnabled: null,
      backendThreadTraceWorkspaceId: "",
      backendThreadTraceThreadId: "",
    });
  });

  it("uses trace draft values for trace form saves and respects explicit reset input", () => {
    const draft = {
      backendThreadTraceEnabled: true,
      backendThreadTraceWorkspaceId: " ws-draft ",
      backendThreadTraceThreadId: " thread-draft ",
    };

    expect(buildDraftBackendThreadTracePayload(draft)).toEqual({
      backendThreadTraceEnabled: true,
      backendThreadTraceWorkspaceId: "ws-draft",
      backendThreadTraceThreadId: "thread-draft",
    });

    expect(
      buildDraftBackendThreadTracePayload(draft, {
        backendThreadTraceEnabled: null,
        backendThreadTraceWorkspaceId: "",
        backendThreadTraceThreadId: "",
      }),
    ).toEqual({
      backendThreadTraceEnabled: null,
      backendThreadTraceWorkspaceId: "",
      backendThreadTraceThreadId: "",
    });
  });

  it("parses suppressed alert codes from comma or newline separated input", () => {
    expect(
      parseTurnPolicyAlertSuppressedCodesInput(
        " duplicate_skips_detected,\nautomation_action_success_below_target \n duplicate_skips_detected ",
      ),
    ).toEqual([
      "duplicate_skips_detected",
      "automation_action_success_below_target",
    ]);
  });

  it("returns null for blank suppressed alert input", () => {
    expect(parseTurnPolicyAlertSuppressedCodesInput(" \n , ")).toBeNull();
  });

  it("formats suppressed alert codes as newline separated text", () => {
    expect(
      formatTurnPolicyAlertSuppressedCodesInput([
        " duplicate_skips_detected ",
        "automation_action_success_below_target",
        "duplicate_skips_detected",
      ]),
    ).toBe("duplicate_skips_detected\nautomation_action_success_below_target");
    expect(formatTurnPolicyAlertSuppressedCodesInput([])).toBe("");
    expect(formatTurnPolicyAlertSuppressedCodesInput(null)).toBe("");
  });

  it("parses and formats snoozed alert codes with the same normalization rules", () => {
    expect(
      parseTurnPolicyAlertSnoozedCodesInput(
        " duplicate_skips_detected,\nfollow_up_cooldown_active \n duplicate_skips_detected ",
      ),
    ).toEqual(["duplicate_skips_detected", "follow_up_cooldown_active"]);
    expect(parseTurnPolicyAlertSnoozedCodesInput(" \n , ")).toBeNull();
    expect(
      formatTurnPolicyAlertSnoozedCodesInput([
        " duplicate_skips_detected ",
        "follow_up_cooldown_active",
        "duplicate_skips_detected",
      ]),
    ).toBe("duplicate_skips_detected\nfollow_up_cooldown_active");
    expect(formatTurnPolicyAlertSnoozedCodesInput([])).toBe("");
  });

  it("parses and formats acknowledged alert codes with the same normalization rules", () => {
    expect(
      parseTurnPolicyAlertAcknowledgedCodesInput(
        " duplicate_skips_detected,\nautomation_action_success_below_target \n duplicate_skips_detected ",
      ),
    ).toEqual([
      "duplicate_skips_detected",
      "automation_action_success_below_target",
    ]);
    expect(parseTurnPolicyAlertAcknowledgedCodesInput(" \n , ")).toBeNull();
    expect(
      formatTurnPolicyAlertAcknowledgedCodesInput([
        " duplicate_skips_detected ",
        "automation_action_success_below_target",
        "duplicate_skips_detected",
      ]),
    ).toBe("duplicate_skips_detected\nautomation_action_success_below_target");
    expect(formatTurnPolicyAlertAcknowledgedCodesInput([])).toBe("");
  });

  it("builds acknowledgement payloads from draft input and supports explicit reset", () => {
    expect(
      buildDraftTurnPolicyAlertAcknowledgementPayload(
        " duplicate_skips_detected,\nautomation_action_success_below_target ",
      ),
    ).toEqual({
      turnPolicyAlertAcknowledgedCodes: [
        "duplicate_skips_detected",
        "automation_action_success_below_target",
      ],
    });

    expect(
      buildDraftTurnPolicyAlertAcknowledgementPayload(
        "duplicate_skips_detected",
        {
          turnPolicyAlertAcknowledgedCodes: null,
        },
      ),
    ).toEqual({
      turnPolicyAlertAcknowledgedCodes: null,
    });
  });

  it("merges alert code lists with trim, dedupe, and stable ordering", () => {
    expect(
      mergeTurnPolicyAlertCodes(
        [" duplicate_skips_detected ", "cooldown_skips_detected"],
        null,
        ["cooldown_skips_detected", " failed_actions_detected "],
        undefined,
      ),
    ).toEqual([
      "duplicate_skips_detected",
      "cooldown_skips_detected",
      "failed_actions_detected",
    ]);
  });

  it("returns an empty list when merged alert code inputs are blank", () => {
    expect(mergeTurnPolicyAlertCodes()).toEqual([]);
    expect(mergeTurnPolicyAlertCodes(null, undefined, [])).toEqual([]);
    expect(mergeTurnPolicyAlertCodes([" ", ""])).toEqual([]);
  });

  it("converts datetime-local values to ISO strings and back", () => {
    const localInstant = new Date(2026, 3, 9, 14, 35, 0, 0);
    const iso = localInstant.toISOString();

    expect(isoStringToDatetimeLocalInput(iso)).toBe("2026-04-09T14:35");
    expect(datetimeLocalInputToIsoString("2026-04-09T14:35")).toBe(iso);
  });

  it("returns blank values for invalid or empty snooze datetimes", () => {
    expect(isoStringToDatetimeLocalInput("")).toBe("");
    expect(isoStringToDatetimeLocalInput("not-a-date")).toBe("");
    expect(datetimeLocalInputToIsoString("")).toBeNull();
    expect(datetimeLocalInputToIsoString("not-a-date")).toBeNull();
  });

  it("parses and formats session-start context paths with trim, slash normalization, and dedupe", () => {
    expect(
      parseHookSessionStartContextPathsInput(
        " .codex\\SESSION_START.md \nREADME.md\n.codex/SESSION_START.md \n ",
      ),
    ).toEqual([".codex/SESSION_START.md", "README.md"]);
    expect(parseHookSessionStartContextPathsInput(" \n ")).toBeNull();
    expect(
      formatHookSessionStartContextPathsInput([
        " .codex\\SESSION_START.md ",
        "README.md",
        ".codex/SESSION_START.md",
      ]),
    ).toBe(".codex/SESSION_START.md\nREADME.md");
    expect(formatHookSessionStartContextPathsInput([])).toBe("");
  });

  it("parses and formats additional protected governance paths with trim, slash normalization, and dedupe", () => {
    expect(
      parseHookPreToolUseAdditionalProtectedGovernancePathsInput(
        " docs\\\\governance.md \n./ops//release-policy.md\nOPS/release-policy.md \n ",
      ),
    ).toEqual(["docs/governance.md", "ops/release-policy.md"]);
    expect(
      parseHookPreToolUseAdditionalProtectedGovernancePathsInput(" \n "),
    ).toBeNull();
    expect(
      formatHookPreToolUseAdditionalProtectedGovernancePathsInput([
        " docs\\\\governance.md ",
        "./ops//release-policy.md",
        "ops/release-policy.md",
      ]),
    ).toBe("docs/governance.md\nops/release-policy.md");
    expect(formatHookPreToolUseAdditionalProtectedGovernancePathsInput([])).toBe(
      "",
    );
  });

  it("normalizes and formats turn policy primary actions", () => {
    expect(normalizeTurnPolicyPrimaryAction(" steer ")).toBe("steer");
    expect(normalizeTurnPolicyPrimaryAction("followUp")).toBe("followUp");
    expect(normalizeTurnPolicyPrimaryAction(" interrupt ")).toBe("interrupt");
    expect(normalizeTurnPolicyPrimaryAction("invalid")).toBe("");
    expect(formatTurnPolicyPrimaryActionLabel("steer")).toBe("Steer");
    expect(formatTurnPolicyPrimaryActionLabel("followUp")).toBe("Follow-up");
    expect(formatTurnPolicyPrimaryActionLabel("interrupt")).toBe("Interrupt");
    expect(formatTurnPolicyPrimaryActionLabel("invalid")).toBe("—");
  });

  it("normalizes and formats interrupt no-active-turn behaviors", () => {
    expect(normalizeTurnPolicyInterruptNoActiveTurnBehavior(" skip ")).toBe(
      "skip",
    );
    expect(normalizeTurnPolicyInterruptNoActiveTurnBehavior("followUp")).toBe(
      "followUp",
    );
    expect(normalizeTurnPolicyInterruptNoActiveTurnBehavior("interrupt")).toBe(
      "",
    );
    expect(formatTurnPolicyInterruptNoActiveTurnBehaviorLabel("skip")).toBe(
      "Skip",
    );
    expect(formatTurnPolicyInterruptNoActiveTurnBehaviorLabel("followUp")).toBe(
      "Follow-up",
    );
    expect(formatTurnPolicyInterruptNoActiveTurnBehaviorLabel("invalid")).toBe(
      "—",
    );
  });

  it("parses and formats validation command prefixes with lowercase trim and dedupe", () => {
    expect(
      parseTurnPolicyValidationCommandPrefixesInput(
        " go test ./... ,\nNPM RUN CHECK \n go test ./... ",
      ),
    ).toEqual(["go test ./...", "npm run check"]);
    expect(parseTurnPolicyValidationCommandPrefixesInput(" \n , ")).toBeNull();
    expect(
      formatTurnPolicyValidationCommandPrefixesInput([
        " Go Test ./... ",
        "npm run check",
        "go test ./...",
      ]),
    ).toBe("go test ./...\nnpm run check");
    expect(formatTurnPolicyValidationCommandPrefixesInput([])).toBe("");
  });

  it("builds validation command prefix payloads with explicit reset support", () => {
    expect(
      buildDraftTurnPolicyValidationCommandPrefixesPayload(
        " go test ./... ,\nNPM RUN CHECK ",
      ),
    ).toEqual({
      turnPolicyValidationCommandPrefixes: ["go test ./...", "npm run check"],
    });

    expect(
      buildDraftTurnPolicyValidationCommandPrefixesPayload(
        "go test ./...",
        {
          turnPolicyValidationCommandPrefixes: null,
        },
      ),
    ).toEqual({
      turnPolicyValidationCommandPrefixes: null,
    });
  });

  it("builds turn policy primary action payloads with explicit reset support", () => {
    const draft = {
      turnPolicyPostToolUsePrimaryAction: "steer" as const,
      turnPolicyStopMissingSuccessfulVerificationPrimaryAction:
        "followUp" as const,
    };

    expect(buildDraftTurnPolicyPrimaryActionPayload(draft)).toEqual({
      turnPolicyPostToolUsePrimaryAction: "steer",
      turnPolicyStopMissingSuccessfulVerificationPrimaryAction: "followUp",
    });

    expect(
      buildDraftTurnPolicyPrimaryActionPayload(draft, {
        turnPolicyPostToolUsePrimaryAction: "interrupt",
        turnPolicyStopMissingSuccessfulVerificationPrimaryAction: null,
      }),
    ).toEqual({
      turnPolicyPostToolUsePrimaryAction: "interrupt",
      turnPolicyStopMissingSuccessfulVerificationPrimaryAction: "",
    });
  });

  it("reads configured turn policy primary action overrides without materializing defaults", () => {
    expect(
      buildConfiguredTurnPolicyPrimaryActionPayload({
        configuredTurnPolicyPostToolUsePrimaryAction: "interrupt",
        configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:
          "followUp",
      }),
    ).toEqual({
      turnPolicyPostToolUsePrimaryAction: "interrupt",
      turnPolicyStopMissingSuccessfulVerificationPrimaryAction: "followUp",
    });

    expect(
      buildConfiguredTurnPolicyPrimaryActionPayload({
        configuredTurnPolicyPostToolUsePrimaryAction: "",
        configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction: "",
      }),
    ).toEqual({
      turnPolicyPostToolUsePrimaryAction: "",
      turnPolicyStopMissingSuccessfulVerificationPrimaryAction: "",
    });
  });

  it("builds interrupt no-active-turn behavior payloads with explicit reset support", () => {
    const draft = {
      turnPolicyPostToolUseInterruptNoActiveTurnBehavior: "skip" as const,
      turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
        "followUp" as const,
    };

    expect(
      buildDraftTurnPolicyInterruptNoActiveTurnBehaviorPayload(draft),
    ).toEqual({
      turnPolicyPostToolUseInterruptNoActiveTurnBehavior: "skip",
      turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
        "followUp",
    });

    expect(
      buildDraftTurnPolicyInterruptNoActiveTurnBehaviorPayload(draft, {
        turnPolicyPostToolUseInterruptNoActiveTurnBehavior: "followUp",
        turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
          null,
      }),
    ).toEqual({
      turnPolicyPostToolUseInterruptNoActiveTurnBehavior: "followUp",
      turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
        "",
    });
  });

  it("reads configured interrupt no-active-turn behavior overrides without materializing defaults", () => {
    expect(
      buildConfiguredTurnPolicyInterruptNoActiveTurnBehaviorPayload({
        configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior:
          "followUp",
        configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
          "skip",
      }),
    ).toEqual({
      turnPolicyPostToolUseInterruptNoActiveTurnBehavior: "followUp",
      turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
        "skip",
    });

    expect(
      buildConfiguredTurnPolicyInterruptNoActiveTurnBehaviorPayload({
        configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "",
        configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
          "",
      }),
    ).toEqual({
      turnPolicyPostToolUseInterruptNoActiveTurnBehavior: "",
      turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
        "",
    });
  });

  it("accepts configured snooze lifecycle flags on runtime preferences results", () => {
    const result: Pick<
      RuntimePreferencesResult,
      | "configuredTurnPolicyAlertSnoozeActive"
      | "configuredTurnPolicyAlertSnoozeExpired"
    > = {
      configuredTurnPolicyAlertSnoozeActive: false,
      configuredTurnPolicyAlertSnoozeExpired: true,
    };

    expect(result.configuredTurnPolicyAlertSnoozeActive).toBe(false);
    expect(result.configuredTurnPolicyAlertSnoozeExpired).toBe(true);
  });

  it("builds a safe full runtime preferences payload from configured values", () => {
    const result = {
      configuredModelCatalogPath: " C:/models/catalog.json ",
      configuredDefaultShellType: "powershell",
      configuredDefaultTerminalShell: "pwsh",
      configuredModelShellTypeOverrides: { "gpt-5": "bash" },
      configuredOutboundProxyUrl: " http://proxy.local ",
      configuredHookSessionStartEnabled: false,
      configuredHookSessionStartContextPaths: [
        " docs\\session-start.md ",
        "README.md",
        "docs/session-start.md",
      ],
      configuredHookSessionStartMaxChars: 512,
      configuredHookUserPromptSubmitBlockSecretPasteEnabled: false,
      configuredHookPreToolUseBlockDangerousCommandEnabled: true,
      configuredHookPreToolUseAdditionalProtectedGovernancePaths: [
        " docs\\\\governance.md ",
        "./ops//release-policy.md",
        "ops/release-policy.md",
      ],
      configuredTurnPolicyPostToolUseFailedValidationEnabled: false,
      configuredTurnPolicyStopMissingSuccessfulVerificationEnabled: true,
      configuredTurnPolicyFollowUpCooldownMs: 45000,
      configuredTurnPolicyPostToolUseFollowUpCooldownMs: 15000,
      configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: 90000,
      configuredTurnPolicyPostToolUsePrimaryAction: "interrupt",
      configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:
        "followUp",
      configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "followUp",
      configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
        "skip",
      configuredTurnPolicyValidationCommandPrefixes: [
        " Go Test ./... ",
        "npm run check",
        "go test ./...",
      ],
      configuredTurnPolicyAlertCoverageThresholdPercent: 75,
      configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: 2000,
      configuredTurnPolicyAlertStopLatencyP95ThresholdMs: 3000,
      configuredTurnPolicyAlertSourceActionSuccessThresholdPercent: 60,
      configuredTurnPolicyAlertSuppressedCodes: [
        " duplicate_skips_detected ",
        "duplicate_skips_detected",
      ],
      configuredTurnPolicyAlertAcknowledgedCodes: ["cooldown_skips_detected"],
      configuredTurnPolicyAlertSnoozedCodes: ["failed_actions_detected"],
      configuredTurnPolicyAlertSnoozeUntil: "2026-04-10T12:00:00.000Z",
      configuredDefaultTurnApprovalPolicy: "always",
      configuredDefaultTurnSandboxPolicy: { mode: "workspace-write" },
      configuredDefaultCommandSandboxPolicy: { mode: "danger-full-access" },
      configuredAllowRemoteAccess: true,
      configuredAllowLocalhostWithoutAccessToken: false,
      configuredAccessTokens: [
        {
          id: "atk-1",
          label: "Ops token",
          tokenPreview: "sk-***",
          permanent: false,
          status: "active",
          expiresAt: "2026-05-01T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      configuredBackendThreadTraceEnabled: true,
      configuredBackendThreadTraceWorkspaceId: " ws-1 ",
      configuredBackendThreadTraceThreadId: " thread-1 ",
    } as unknown as RuntimePreferencesResult;

    expect(buildConfiguredRuntimePreferencesWritePayload(result)).toEqual({
      modelCatalogPath: "C:/models/catalog.json",
      defaultShellType: "powershell",
      defaultTerminalShell: "pwsh",
      modelShellTypeOverrides: { "gpt-5": "bash" },
      outboundProxyUrl: "http://proxy.local",
      hookSessionStartEnabled: false,
      hookSessionStartContextPaths: ["docs/session-start.md", "README.md"],
      hookSessionStartMaxChars: 512,
      hookSessionStartTemplate: null,
      hookUserPromptSubmitBlockSecretPasteEnabled: false,
      hookPreToolUseBlockDangerousCommandEnabled: true,
      hookPreToolUseAdditionalProtectedGovernancePaths: [
        "docs/governance.md",
        "ops/release-policy.md",
      ],
      turnPolicyPostToolUseFailedValidationEnabled: false,
      turnPolicyStopMissingSuccessfulVerificationEnabled: true,
      turnPolicyFollowUpCooldownMs: 45000,
      turnPolicyPostToolUseFollowUpCooldownMs: 15000,
      turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: 90000,
      turnPolicyPostToolUsePrimaryAction: "interrupt",
      turnPolicyStopMissingSuccessfulVerificationPrimaryAction: "followUp",
      turnPolicyPostToolUseInterruptNoActiveTurnBehavior: "followUp",
      turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
        "skip",
      turnPolicyValidationCommandPrefixes: [
        "go test ./...",
        "npm run check",
      ],
      turnPolicyAlertCoverageThresholdPercent: 75,
      turnPolicyAlertPostToolUseLatencyP95ThresholdMs: 2000,
      turnPolicyAlertStopLatencyP95ThresholdMs: 3000,
      turnPolicyAlertSourceActionSuccessThresholdPercent: 60,
      turnPolicyAlertSuppressedCodes: ["duplicate_skips_detected"],
      turnPolicyAlertAcknowledgedCodes: ["cooldown_skips_detected"],
      turnPolicyAlertSnoozedCodes: ["failed_actions_detected"],
      turnPolicyAlertSnoozeUntil: "2026-04-10T12:00:00.000Z",
      defaultTurnApprovalPolicy: "always",
      defaultTurnSandboxPolicy: { mode: "workspace-write" },
      defaultCommandSandboxPolicy: { mode: "danger-full-access" },
      allowRemoteAccess: true,
      allowLocalhostWithoutAccessToken: false,
      accessTokens: [
        {
          id: "atk-1",
          label: "Ops token",
          expiresAt: "2026-05-01T00:00:00.000Z",
          permanent: false,
        },
      ],
      backendThreadTraceEnabled: true,
      backendThreadTraceWorkspaceId: "ws-1",
      backendThreadTraceThreadId: "thread-1",
    });
  });

  it("builds governance payloads without dropping configured access tokens", () => {
    const result = {
      configuredModelCatalogPath: "",
      configuredDefaultShellType: "",
      configuredDefaultTerminalShell: "",
      configuredModelShellTypeOverrides: {},
      configuredOutboundProxyUrl: "",
      configuredTurnPolicyAlertAcknowledgedCodes: ["duplicate_skips_detected"],
      configuredTurnPolicyAlertSnoozedCodes: ["failed_actions_detected"],
      configuredTurnPolicyAlertSnoozeUntil: "2026-04-10T12:00:00.000Z",
      configuredAccessTokens: [
        {
          id: "atk-1",
          label: "Ops token",
          tokenPreview: "sk-***",
          permanent: true,
          status: "active",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      configuredDefaultTurnApprovalPolicy: "",
      configuredBackendThreadTraceWorkspaceId: "",
      configuredBackendThreadTraceThreadId: "",
      supportedTerminalShells: [],
      configuredAccessTokensCount: undefined,
    } as unknown as RuntimePreferencesResult;

    expect(
      buildTurnPolicyAlertGovernancePayload(result, {
        type: "acknowledge",
        code: "cooldown_skips_detected",
        source: "workspace-overview",
      }),
    ).toMatchObject({
      turnPolicyAlertAcknowledgedCodes: [
        "duplicate_skips_detected",
        "cooldown_skips_detected",
      ],
      turnPolicyAlertGovernanceEvent: {
        action: "acknowledge",
        source: "workspace-overview",
        codes: ["cooldown_skips_detected"],
      },
      accessTokens: [
        {
          id: "atk-1",
          label: "Ops token",
          permanent: true,
        },
      ],
    });
  });

  it("extends snooze until by 24 hours without shortening an existing longer snooze", () => {
    const result = {
      configuredModelCatalogPath: "",
      configuredDefaultShellType: "",
      configuredDefaultTerminalShell: "",
      configuredModelShellTypeOverrides: {},
      configuredOutboundProxyUrl: "",
      configuredTurnPolicyAlertSnoozedCodes: ["duplicate_skips_detected"],
      configuredTurnPolicyAlertSnoozeUntil: "2026-04-12T00:00:00.000Z",
      configuredAccessTokens: [],
      configuredDefaultTurnApprovalPolicy: "",
      configuredBackendThreadTraceWorkspaceId: "",
      configuredBackendThreadTraceThreadId: "",
    } as unknown as RuntimePreferencesResult;

    const now = new Date("2026-04-09T12:00:00.000Z");
    expect(
      buildTurnPolicyAlertGovernancePayload(
        result,
        {
          type: "snooze24h",
          code: "failed_actions_detected",
          source: "thread-metrics",
        },
        now,
      ),
    ).toMatchObject({
      turnPolicyAlertSnoozedCodes: [
        "duplicate_skips_detected",
        "failed_actions_detected",
      ],
      turnPolicyAlertSnoozeUntil: "2026-04-12T00:00:00.000Z",
      turnPolicyAlertGovernanceEvent: {
        action: "snooze_24h",
        source: "thread-metrics",
        codes: ["failed_actions_detected"],
        snoozeUntil: "2026-04-12T00:00:00.000Z",
      },
    });
  });

  it("clears snooze until when the last snoozed code is removed", () => {
    const result = {
      configuredModelCatalogPath: "",
      configuredDefaultShellType: "",
      configuredDefaultTerminalShell: "",
      configuredModelShellTypeOverrides: {},
      configuredOutboundProxyUrl: "",
      configuredTurnPolicyAlertSnoozedCodes: ["failed_actions_detected"],
      configuredTurnPolicyAlertSnoozeUntil: "2026-04-10T12:00:00.000Z",
      configuredAccessTokens: [],
      configuredDefaultTurnApprovalPolicy: "",
      configuredBackendThreadTraceWorkspaceId: "",
      configuredBackendThreadTraceThreadId: "",
    } as unknown as RuntimePreferencesResult;

    expect(
      buildTurnPolicyAlertGovernancePayload(result, {
        type: "clearSnooze",
        code: "failed_actions_detected",
        source: "workspace-compare",
      }),
    ).toMatchObject({
      turnPolicyAlertSnoozedCodes: null,
      turnPolicyAlertSnoozeUntil: null,
      turnPolicyAlertGovernanceEvent: {
        action: "clear_snooze",
        source: "workspace-compare",
        codes: ["failed_actions_detected"],
      },
    });
  });
});
