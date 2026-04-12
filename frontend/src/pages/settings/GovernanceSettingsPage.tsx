import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  SettingsJsonPreview,
  SettingsPageHeader,
  SettingsRecord,
} from "../../components/settings/SettingsPrimitives";
import { SettingsWorkspaceScopePanel } from "../../components/settings/SettingsWorkspaceScopePanel";
import { CollapsiblePanel } from "../../components/ui/CollapsiblePanel";
import { InlineNotice } from "../../components/ui/InlineNotice";
import { Input } from "../../components/ui/Input";
import { SelectControl } from "../../components/ui/SelectControl";
import { Tabs, activateStoredTab } from "../../components/ui/Tabs";
import { TextArea } from "../../components/ui/TextArea";
import { Tooltip } from "../../components/ui/Tooltip";
import {
  readRuntimePreferences,
  writeRuntimePreferences,
  type WriteRuntimePreferencesInput,
} from "../../features/settings/api";
import { useSettingsShellContext } from "../../features/settings/shell-context";
import { getTurnPolicyMetrics } from "../../features/threads/api";
import { getWorkspaceHookConfiguration } from "../../features/workspaces/api";
import { formatLocalizedDateTime, formatLocalizedNumber } from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import { getErrorMessage } from "../../lib/error-utils";
import {
  DEFAULT_SESSION_START_TEMPLATE,
  renderSessionStartTemplatePreview,
} from "../../lib/session-start-template";
import type {
  RuntimePreferencesResult,
  WorkspaceHookConfigurationResult,
} from "../../types/api";
import { ThreadWorkbenchRailHookConfigurationSection } from "../thread-page/ThreadWorkbenchRailHookConfigurationSection";
import { WorkspaceHookConfigurationEditorSection } from "../workspaces/WorkspaceHookConfigurationEditorSection";
import { WorkspaceHookRunsSection } from "../workspaces/WorkspaceHookRunsSection";
import { WorkspaceTurnPolicyOverviewSection } from "../workspaces/WorkspaceTurnPolicyOverviewSection";
import { WorkspaceTurnPolicyRecentDecisionsSection } from "../workspaces/WorkspaceTurnPolicyRecentDecisionsSection";
import {
  useWorkspaceHookRuns,
  type WorkspaceHookRunFilters,
} from "../workspaces/useWorkspaceHookRuns";
import {
  useWorkspaceTurnPolicyRecentDecisions,
  type WorkspaceTurnPolicyDecisionFilters,
} from "../workspaces/useWorkspaceTurnPolicyRecentDecisions";
import {
  buildConfiguredRuntimePreferencesWritePayload,
  datetimeLocalInputToIsoString,
  formatHookPreToolUseAdditionalProtectedGovernancePathsInput,
  formatHookSessionStartContextPathsInput,
  formatHookSessionStartTemplateInput,
  formatTurnPolicyAlertAcknowledgedCodesInput,
  formatTurnPolicyAlertSnoozedCodesInput,
  formatTurnPolicyAlertSuppressedCodesInput,
  formatTurnPolicyInterruptNoActiveTurnBehaviorLabel,
  formatTurnPolicyPrimaryActionLabel,
  formatTurnPolicyValidationCommandPrefixesInput,
  isoStringToDatetimeLocalInput,
  normalizeTurnPolicyInterruptNoActiveTurnBehavior,
  normalizeTurnPolicyPrimaryAction,
  parseHookPreToolUseAdditionalProtectedGovernancePathsInput,
  parseHookSessionStartContextPathsInput,
  parseHookSessionStartTemplateInput,
  parseTurnPolicyAlertAcknowledgedCodesInput,
  parseTurnPolicyAlertSnoozedCodesInput,
  parseTurnPolicyAlertSuppressedCodesInput,
  parseTurnPolicyValidationCommandPrefixesInput,
} from "./configSettingsPageRuntimePreferences";
import { GOVERNANCE_SETTINGS_TAB_STORAGE_KEY } from "../../features/settings/governanceNavigation";
import "../../styles/settings-governance.css";

type TriStateValue = "inherit" | "enabled" | "disabled";
type RuntimeSectionKey = "hooks" | "execution" | "thresholds" | "alertGovernance";

function hasConfiguredValue(value: unknown) {
  return value !== undefined && value !== null;
}

function hasConfiguredString(value?: string | null) {
  return Boolean((value ?? "").trim());
}

function hasPathValues(values?: string[] | null) {
  return (values ?? []).some((value) => value.trim());
}

function formatTriStateValue(value?: boolean | null): TriStateValue {
  if (value === true) {
    return "enabled";
  }
  if (value === false) {
    return "disabled";
  }
  return "inherit";
}

function parseTriStateValue(value: TriStateValue): boolean | null {
  if (value === "enabled") {
    return true;
  }
  if (value === "disabled") {
    return false;
  }
  return null;
}

function stringifyOptionalNumberInput(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseOptionalThresholdNumberInput(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      i18n._({
        id: "{label} must be a non-negative number",
        message: "{label} must be a non-negative number",
        values: { label },
      }),
    );
  }

  return parsed;
}

function parseOptionalPositiveIntegerInput(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      i18n._({
        id: "{label} must be a positive integer",
        message: "{label} must be a positive integer",
        values: { label },
      }),
    );
  }

  return parsed;
}

function formatThresholdValue(value?: number | null, unit = "") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return i18n._({ id: "Inherit", message: "Inherit" });
  }

  return `${formatLocalizedNumber(value, "0")}${unit ? ` ${unit}` : ""}`;
}

function formatBooleanPreferenceValue(value?: boolean | null) {
  return value
    ? i18n._({ id: "Enabled", message: "Enabled" })
    : i18n._({ id: "Disabled", message: "Disabled" });
}

function formatRuntimeSourceLabel(isConfigured: boolean) {
  return isConfigured
    ? i18n._({ id: "Runtime override", message: "Runtime override" })
    : i18n._({ id: "Built-in default", message: "Built-in default" });
}

function getTriStateOptions() {
  return [
    {
      value: "inherit",
      label: i18n._({ id: "Inherit default", message: "Inherit default" }),
    },
    {
      value: "enabled",
      label: i18n._({ id: "Enabled", message: "Enabled" }),
    },
    {
      value: "disabled",
      label: i18n._({ id: "Disabled", message: "Disabled" }),
    },
  ];
}

function getPrimaryActionOptions() {
  return [
    {
      value: "inherit",
      label: i18n._({ id: "Inherit default", message: "Inherit default" }),
    },
    { value: "steer", label: i18n._({ id: "Steer", message: "Steer" }) },
    {
      value: "followUp",
      label: i18n._({ id: "Follow-up", message: "Follow-up" }),
    },
    {
      value: "interrupt",
      label: i18n._({ id: "Interrupt", message: "Interrupt" }),
    },
  ];
}

function getInterruptFallbackOptions() {
  return [
    {
      value: "inherit",
      label: i18n._({ id: "Inherit default", message: "Inherit default" }),
    },
    { value: "skip", label: i18n._({ id: "Skip", message: "Skip" }) },
    {
      value: "followUp",
      label: i18n._({ id: "Follow-up", message: "Follow-up" }),
    },
  ];
}

function formatListPreview(values?: string[] | null, emptyLabel?: string) {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (!normalized.length) {
    return emptyLabel ?? i18n._({ id: "Not configured", message: "Not configured" });
  }

  if (normalized.length <= 2) {
    return normalized.join(", ");
  }

  return i18n._({
    id: "{first}, {second}, +{rest} more",
    message: "{first}, {second}, +{rest} more",
    values: {
      first: normalized[0],
      second: normalized[1],
      rest: formatLocalizedNumber(normalized.length - 2, "0"),
    },
  });
}

function countRuntimeHookOverrides(configuration?: WorkspaceHookConfigurationResult | null) {
  return [
    hasConfiguredValue(configuration?.configuredHookSessionStartEnabled),
    hasPathValues(configuration?.configuredHookSessionStartContextPaths),
    hasConfiguredValue(configuration?.configuredHookSessionStartMaxChars),
    hasConfiguredString(configuration?.configuredHookSessionStartTemplate),
    hasConfiguredValue(
      configuration?.configuredHookUserPromptSubmitBlockSecretPasteEnabled,
    ),
    hasConfiguredValue(
      configuration?.configuredHookPreToolUseBlockDangerousCommandEnabled,
    ),
    hasPathValues(
      configuration?.configuredHookPreToolUseAdditionalProtectedGovernancePaths,
    ),
  ].filter(Boolean).length;
}

function countWorkspaceBaselineValues(configuration?: WorkspaceHookConfigurationResult | null) {
  return [
    hasConfiguredValue(configuration?.baselineHookSessionStartEnabled),
    hasPathValues(configuration?.baselineHookSessionStartContextPaths),
    hasConfiguredValue(configuration?.baselineHookSessionStartMaxChars),
    hasConfiguredString(configuration?.baselineHookSessionStartTemplate),
    hasConfiguredValue(
      configuration?.baselineHookUserPromptSubmitBlockSecretPasteEnabled,
    ),
    hasConfiguredValue(
      configuration?.baselineHookPreToolUseBlockDangerousCommandEnabled,
    ),
    hasPathValues(
      configuration?.baselineHookPreToolUseAdditionalProtectedGovernancePaths,
    ),
  ].filter(Boolean).length;
}

function countRuntimePolicyOverrides(result?: RuntimePreferencesResult | null) {
  return [
    hasConfiguredValue(result?.configuredTurnPolicyPostToolUseFailedValidationEnabled),
    hasConfiguredValue(
      result?.configuredTurnPolicyStopMissingSuccessfulVerificationEnabled,
    ),
    hasConfiguredValue(result?.configuredTurnPolicyFollowUpCooldownMs),
    hasConfiguredValue(result?.configuredTurnPolicyPostToolUseFollowUpCooldownMs),
    hasConfiguredValue(
      result?.configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs,
    ),
    hasConfiguredString(result?.configuredTurnPolicyPostToolUsePrimaryAction),
    hasConfiguredString(
      result?.configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
    ),
    hasConfiguredString(
      result?.configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
    ),
    hasConfiguredString(
      result?.configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
    ),
    hasPathValues(result?.configuredTurnPolicyValidationCommandPrefixes),
    hasConfiguredValue(result?.configuredTurnPolicyAlertCoverageThresholdPercent),
    hasConfiguredValue(
      result?.configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs,
    ),
    hasConfiguredValue(result?.configuredTurnPolicyAlertStopLatencyP95ThresholdMs),
    hasConfiguredValue(
      result?.configuredTurnPolicyAlertSourceActionSuccessThresholdPercent,
    ),
    hasPathValues(result?.configuredTurnPolicyAlertSuppressedCodes),
    hasPathValues(result?.configuredTurnPolicyAlertAcknowledgedCodes),
    hasPathValues(result?.configuredTurnPolicyAlertSnoozedCodes),
    hasConfiguredString(result?.configuredTurnPolicyAlertSnoozeUntil),
  ].filter(Boolean).length;
}

function HelpBadge({
  content,
  label,
}: {
  content: string;
  label: string;
}) {
  return (
    <Tooltip content={content} triggerLabel={label}>
      <span className="governance-help-badge" aria-hidden="true">
        ?
      </span>
    </Tooltip>
  );
}

function SummaryCard({
  label,
  value,
  meta,
  tone = "default",
}: {
  label: string;
  value: string;
  meta: string;
  tone?: "default" | "active" | "warning" | "danger";
}) {
  return (
    <article className={`governance-summary-card governance-summary-card--${tone}`}>
      <span className="governance-summary-card__label">{label}</span>
      <strong className="governance-summary-card__value">{value}</strong>
      <span className="governance-summary-card__meta">{meta}</span>
    </article>
  );
}

export function GovernanceSettingsPage() {
  const queryClient = useQueryClient();
  const { workspaceId, workspaceName, workspaces } = useSettingsShellContext();
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const triStateOptions = getTriStateOptions();
  const primaryActionOptions = getPrimaryActionOptions();
  const interruptFallbackOptions = getInterruptFallbackOptions();

  const runtimePreferencesQuery = useQuery({
    queryKey: ["settings-runtime-preferences"],
    queryFn: readRuntimePreferences,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const hookConfigurationQuery = useQuery({
    queryKey: ["workspace-hook-configuration", workspaceId],
    queryFn: () => getWorkspaceHookConfiguration(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const turnPolicyMetricsQuery = useQuery({
    queryKey: ["turn-policy-metrics", workspaceId, "", "settings-governance"],
    queryFn: () => getTurnPolicyMetrics(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const automationSourceMetricsQuery = useQuery({
    queryKey: ["turn-policy-metrics", workspaceId, "automation", "settings-governance"],
    queryFn: () =>
      getTurnPolicyMetrics(workspaceId ?? "", {
        source: "automation",
      }),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const botSourceMetricsQuery = useQuery({
    queryKey: ["turn-policy-metrics", workspaceId, "bot", "settings-governance"],
    queryFn: () =>
      getTurnPolicyMetrics(workspaceId ?? "", {
        source: "bot",
      }),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const runtimePreferences = runtimePreferencesQuery.data;
  const hookConfiguration = hookConfigurationQuery.data;
  const turnPolicyMetrics = turnPolicyMetricsQuery.data;
  const runtimePreferencesError = runtimePreferencesQuery.error
    ? getErrorMessage(runtimePreferencesQuery.error)
    : null;
  const hookConfigurationError = hookConfigurationQuery.error
    ? getErrorMessage(hookConfigurationQuery.error)
    : null;
  const turnPolicyMetricsError = turnPolicyMetricsQuery.error
    ? getErrorMessage(turnPolicyMetricsQuery.error)
    : null;
  const turnPolicySourceHealth = workspaceId
    ? {
        automation: automationSourceMetricsQuery.data,
        bot: botSourceMetricsQuery.data,
        loading:
          automationSourceMetricsQuery.isLoading || botSourceMetricsQuery.isLoading,
        error: automationSourceMetricsQuery.error
          ? getErrorMessage(automationSourceMetricsQuery.error)
          : botSourceMetricsQuery.error
            ? getErrorMessage(botSourceMetricsQuery.error)
            : null,
      }
    : undefined;

  const [decisionFilters, setDecisionFilters] =
    useState<WorkspaceTurnPolicyDecisionFilters>({});
  const [hookRunFilters, setHookRunFilters] = useState<WorkspaceHookRunFilters>({});
  const workspaceDecisions = useWorkspaceTurnPolicyRecentDecisions({
    selectedWorkspaceId: workspaceId ?? "",
    filters: decisionFilters,
    limit: 10,
  });
  const workspaceHookRuns = useWorkspaceHookRuns({
    selectedWorkspaceId: workspaceId ?? "",
    filters: hookRunFilters,
    limit: 12,
  });

  useEffect(() => {
    setDecisionFilters({});
    setHookRunFilters({});
  }, [workspaceId]);

  const [hookSessionStartEnabled, setHookSessionStartEnabled] =
    useState<TriStateValue>("inherit");
  const [hookSessionStartContextPaths, setHookSessionStartContextPaths] =
    useState("");
  const [hookSessionStartMaxChars, setHookSessionStartMaxChars] = useState("");
  const [hookSessionStartTemplate, setHookSessionStartTemplate] = useState("");
  const [hookSecretPasteBlockEnabled, setHookSecretPasteBlockEnabled] =
    useState<TriStateValue>("inherit");
  const [hookDangerousCommandBlockEnabled, setHookDangerousCommandBlockEnabled] =
    useState<TriStateValue>("inherit");
  const [hookProtectedGovernancePaths, setHookProtectedGovernancePaths] =
    useState("");

  const [turnPolicyPostToolUseEnabled, setTurnPolicyPostToolUseEnabled] =
    useState<TriStateValue>("inherit");
  const [
    turnPolicyStopMissingVerificationEnabled,
    setTurnPolicyStopMissingVerificationEnabled,
  ] = useState<TriStateValue>("inherit");
  const [turnPolicyFollowUpCooldownMs, setTurnPolicyFollowUpCooldownMs] =
    useState("");
  const [
    turnPolicyPostToolUseFollowUpCooldownMs,
    setTurnPolicyPostToolUseFollowUpCooldownMs,
  ] = useState("");
  const [
    turnPolicyStopMissingVerificationFollowUpCooldownMs,
    setTurnPolicyStopMissingVerificationFollowUpCooldownMs,
  ] = useState("");
  const [
    turnPolicyPostToolUsePrimaryAction,
    setTurnPolicyPostToolUsePrimaryAction,
  ] = useState("inherit");
  const [
    turnPolicyStopMissingVerificationPrimaryAction,
    setTurnPolicyStopMissingVerificationPrimaryAction,
  ] = useState("inherit");
  const [
    turnPolicyPostToolUseInterruptBehavior,
    setTurnPolicyPostToolUseInterruptBehavior,
  ] = useState("inherit");
  const [
    turnPolicyStopMissingVerificationInterruptBehavior,
    setTurnPolicyStopMissingVerificationInterruptBehavior,
  ] = useState("inherit");
  const [
    turnPolicyValidationCommandPrefixes,
    setTurnPolicyValidationCommandPrefixes,
  ] = useState("");

  const [
    turnPolicyAlertCoverageThresholdPercent,
    setTurnPolicyAlertCoverageThresholdPercent,
  ] = useState("");
  const [
    turnPolicyAlertPostToolUseLatencyP95ThresholdMs,
    setTurnPolicyAlertPostToolUseLatencyP95ThresholdMs,
  ] = useState("");
  const [
    turnPolicyAlertStopLatencyP95ThresholdMs,
    setTurnPolicyAlertStopLatencyP95ThresholdMs,
  ] = useState("");
  const [
    turnPolicyAlertSourceActionSuccessThresholdPercent,
    setTurnPolicyAlertSourceActionSuccessThresholdPercent,
  ] = useState("");

  const [turnPolicyAlertSuppressedCodes, setTurnPolicyAlertSuppressedCodes] =
    useState("");
  const [
    turnPolicyAlertAcknowledgedCodes,
    setTurnPolicyAlertAcknowledgedCodes,
  ] = useState("");
  const [turnPolicyAlertSnoozedCodes, setTurnPolicyAlertSnoozedCodes] =
    useState("");
  const [turnPolicyAlertSnoozeUntil, setTurnPolicyAlertSnoozeUntil] =
    useState("");

  const [sectionErrors, setSectionErrors] = useState<
    Record<RuntimeSectionKey, string | null>
  >({
    hooks: null,
    execution: null,
    thresholds: null,
    alertGovernance: null,
  });

  useEffect(() => {
    setHookSessionStartEnabled(
      formatTriStateValue(runtimePreferences?.configuredHookSessionStartEnabled),
    );
    setHookSessionStartContextPaths(
      formatHookSessionStartContextPathsInput(
        runtimePreferences?.configuredHookSessionStartContextPaths,
      ),
    );
    setHookSessionStartMaxChars(
      stringifyOptionalNumberInput(runtimePreferences?.configuredHookSessionStartMaxChars),
    );
    setHookSessionStartTemplate(
      formatHookSessionStartTemplateInput(
        runtimePreferences?.configuredHookSessionStartTemplate,
      ),
    );
    setHookSecretPasteBlockEnabled(
      formatTriStateValue(
        runtimePreferences?.configuredHookUserPromptSubmitBlockSecretPasteEnabled,
      ),
    );
    setHookDangerousCommandBlockEnabled(
      formatTriStateValue(
        runtimePreferences?.configuredHookPreToolUseBlockDangerousCommandEnabled,
      ),
    );
    setHookProtectedGovernancePaths(
      formatHookPreToolUseAdditionalProtectedGovernancePathsInput(
        runtimePreferences?.configuredHookPreToolUseAdditionalProtectedGovernancePaths,
      ),
    );

    setTurnPolicyPostToolUseEnabled(
      formatTriStateValue(
        runtimePreferences?.configuredTurnPolicyPostToolUseFailedValidationEnabled,
      ),
    );
    setTurnPolicyStopMissingVerificationEnabled(
      formatTriStateValue(
        runtimePreferences?.configuredTurnPolicyStopMissingSuccessfulVerificationEnabled,
      ),
    );
    setTurnPolicyFollowUpCooldownMs(
      stringifyOptionalNumberInput(
        runtimePreferences?.configuredTurnPolicyFollowUpCooldownMs,
      ),
    );
    setTurnPolicyPostToolUseFollowUpCooldownMs(
      stringifyOptionalNumberInput(
        runtimePreferences?.configuredTurnPolicyPostToolUseFollowUpCooldownMs,
      ),
    );
    setTurnPolicyStopMissingVerificationFollowUpCooldownMs(
      stringifyOptionalNumberInput(
        runtimePreferences?.configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs,
      ),
    );
    setTurnPolicyPostToolUsePrimaryAction(
      normalizeTurnPolicyPrimaryAction(
        runtimePreferences?.configuredTurnPolicyPostToolUsePrimaryAction,
      ) || "inherit",
    );
    setTurnPolicyStopMissingVerificationPrimaryAction(
      normalizeTurnPolicyPrimaryAction(
        runtimePreferences?.configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
      ) || "inherit",
    );
    setTurnPolicyPostToolUseInterruptBehavior(
      normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        runtimePreferences?.configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
      ) || "inherit",
    );
    setTurnPolicyStopMissingVerificationInterruptBehavior(
      normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        runtimePreferences?.configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
      ) || "inherit",
    );
    setTurnPolicyValidationCommandPrefixes(
      formatTurnPolicyValidationCommandPrefixesInput(
        runtimePreferences?.configuredTurnPolicyValidationCommandPrefixes,
      ),
    );

    setTurnPolicyAlertCoverageThresholdPercent(
      stringifyOptionalNumberInput(
        runtimePreferences?.configuredTurnPolicyAlertCoverageThresholdPercent,
      ),
    );
    setTurnPolicyAlertPostToolUseLatencyP95ThresholdMs(
      stringifyOptionalNumberInput(
        runtimePreferences?.configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs,
      ),
    );
    setTurnPolicyAlertStopLatencyP95ThresholdMs(
      stringifyOptionalNumberInput(
        runtimePreferences?.configuredTurnPolicyAlertStopLatencyP95ThresholdMs,
      ),
    );
    setTurnPolicyAlertSourceActionSuccessThresholdPercent(
      stringifyOptionalNumberInput(
        runtimePreferences?.configuredTurnPolicyAlertSourceActionSuccessThresholdPercent,
      ),
    );

    setTurnPolicyAlertSuppressedCodes(
      formatTurnPolicyAlertSuppressedCodesInput(
        runtimePreferences?.configuredTurnPolicyAlertSuppressedCodes,
      ),
    );
    setTurnPolicyAlertAcknowledgedCodes(
      formatTurnPolicyAlertAcknowledgedCodesInput(
        runtimePreferences?.configuredTurnPolicyAlertAcknowledgedCodes,
      ),
    );
    setTurnPolicyAlertSnoozedCodes(
      formatTurnPolicyAlertSnoozedCodesInput(
        runtimePreferences?.configuredTurnPolicyAlertSnoozedCodes,
      ),
    );
    setTurnPolicyAlertSnoozeUntil(
      isoStringToDatetimeLocalInput(
        runtimePreferences?.configuredTurnPolicyAlertSnoozeUntil,
      ),
    );
  }, [runtimePreferences]);

  const runtimePreferencesMutation = useMutation({
    mutationFn: ({
      payload,
    }: {
      panel: RuntimeSectionKey;
      payload: WriteRuntimePreferencesInput;
    }) => writeRuntimePreferences(payload),
    onSuccess: async (result) => {
      queryClient.setQueryData(["settings-runtime-preferences"], result);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["settings-runtime-preferences"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["workspace-hook-configuration"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["turn-policy-metrics"],
        }),
      ]);
    },
  });

  function clearSectionError(panel: RuntimeSectionKey) {
    setSectionErrors((current) => ({
      ...current,
      [panel]: null,
    }));
  }

  function failSection(panel: RuntimeSectionKey, error: unknown) {
    runtimePreferencesMutation.reset();
    setSectionErrors((current) => ({
      ...current,
      [panel]: getErrorMessage(error),
    }));
  }

  function submitRuntimeSection(
    panel: RuntimeSectionKey,
    overrides: Partial<WriteRuntimePreferencesInput>,
  ) {
    if (!runtimePreferences) {
      failSection(
        panel,
        new Error(
          i18n._({
            id: "Runtime preferences are still loading",
            message: "Runtime preferences are still loading",
          }),
        ),
      );
      return;
    }

    clearSectionError(panel);
    runtimePreferencesMutation.mutate({
      panel,
      payload: {
        ...buildConfiguredRuntimePreferencesWritePayload(runtimePreferences),
        ...overrides,
      },
    });
  }

  function saveHooksRuntimeOverrides() {
    try {
      submitRuntimeSection("hooks", {
        hookSessionStartEnabled: parseTriStateValue(hookSessionStartEnabled),
        hookSessionStartContextPaths:
          parseHookSessionStartContextPathsInput(hookSessionStartContextPaths),
        hookSessionStartMaxChars: parseOptionalPositiveIntegerInput(
          hookSessionStartMaxChars,
          i18n._({ id: "SessionStart max chars", message: "SessionStart max chars" }),
        ),
        hookSessionStartTemplate:
          parseHookSessionStartTemplateInput(hookSessionStartTemplate),
        hookUserPromptSubmitBlockSecretPasteEnabled: parseTriStateValue(
          hookSecretPasteBlockEnabled,
        ),
        hookPreToolUseBlockDangerousCommandEnabled: parseTriStateValue(
          hookDangerousCommandBlockEnabled,
        ),
        hookPreToolUseAdditionalProtectedGovernancePaths:
          parseHookPreToolUseAdditionalProtectedGovernancePathsInput(
            hookProtectedGovernancePaths,
          ),
      });
    } catch (error) {
      failSection("hooks", error);
    }
  }

  function resetHooksRuntimeOverrides() {
    submitRuntimeSection("hooks", {
      hookSessionStartEnabled: null,
      hookSessionStartContextPaths: null,
      hookSessionStartMaxChars: null,
      hookSessionStartTemplate: null,
      hookUserPromptSubmitBlockSecretPasteEnabled: null,
      hookPreToolUseBlockDangerousCommandEnabled: null,
      hookPreToolUseAdditionalProtectedGovernancePaths: null,
    });
  }

  function saveTurnPolicyExecutionControls() {
    try {
      submitRuntimeSection("execution", {
        turnPolicyPostToolUseFailedValidationEnabled: parseTriStateValue(
          turnPolicyPostToolUseEnabled,
        ),
        turnPolicyStopMissingSuccessfulVerificationEnabled: parseTriStateValue(
          turnPolicyStopMissingVerificationEnabled,
        ),
        turnPolicyFollowUpCooldownMs: parseOptionalPositiveIntegerInput(
          turnPolicyFollowUpCooldownMs,
          i18n._({ id: "Follow-up cooldown", message: "Follow-up cooldown" }),
        ),
        turnPolicyPostToolUseFollowUpCooldownMs: parseOptionalPositiveIntegerInput(
          turnPolicyPostToolUseFollowUpCooldownMs,
          i18n._({
            id: "Post-tool-use follow-up cooldown",
            message: "Post-tool-use follow-up cooldown",
          }),
        ),
        turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:
          parseOptionalPositiveIntegerInput(
            turnPolicyStopMissingVerificationFollowUpCooldownMs,
            i18n._({
              id: "Missing verification follow-up cooldown",
              message: "Missing verification follow-up cooldown",
            }),
          ),
        turnPolicyPostToolUsePrimaryAction:
          turnPolicyPostToolUsePrimaryAction === "inherit"
            ? ""
            : turnPolicyPostToolUsePrimaryAction,
        turnPolicyStopMissingSuccessfulVerificationPrimaryAction:
          turnPolicyStopMissingVerificationPrimaryAction === "inherit"
            ? ""
            : turnPolicyStopMissingVerificationPrimaryAction,
        turnPolicyPostToolUseInterruptNoActiveTurnBehavior:
          turnPolicyPostToolUseInterruptBehavior === "inherit"
            ? ""
            : turnPolicyPostToolUseInterruptBehavior,
        turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
          turnPolicyStopMissingVerificationInterruptBehavior === "inherit"
            ? ""
            : turnPolicyStopMissingVerificationInterruptBehavior,
        turnPolicyValidationCommandPrefixes:
          parseTurnPolicyValidationCommandPrefixesInput(
            turnPolicyValidationCommandPrefixes,
          ),
      });
    } catch (error) {
      failSection("execution", error);
    }
  }

  function resetTurnPolicyExecutionControls() {
    submitRuntimeSection("execution", {
      turnPolicyPostToolUseFailedValidationEnabled: null,
      turnPolicyStopMissingSuccessfulVerificationEnabled: null,
      turnPolicyFollowUpCooldownMs: null,
      turnPolicyPostToolUseFollowUpCooldownMs: null,
      turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: null,
      turnPolicyPostToolUsePrimaryAction: "",
      turnPolicyStopMissingSuccessfulVerificationPrimaryAction: "",
      turnPolicyPostToolUseInterruptNoActiveTurnBehavior: "",
      turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: "",
      turnPolicyValidationCommandPrefixes: null,
    });
  }

  function saveAlertThresholds() {
    try {
      submitRuntimeSection("thresholds", {
        turnPolicyAlertCoverageThresholdPercent: parseOptionalThresholdNumberInput(
          turnPolicyAlertCoverageThresholdPercent,
          i18n._({
            id: "Coverage threshold percent",
            message: "Coverage threshold percent",
          }),
        ),
        turnPolicyAlertPostToolUseLatencyP95ThresholdMs:
          parseOptionalThresholdNumberInput(
            turnPolicyAlertPostToolUseLatencyP95ThresholdMs,
            i18n._({
              id: "Post-tool-use latency P95 threshold",
              message: "Post-tool-use latency P95 threshold",
            }),
          ),
        turnPolicyAlertStopLatencyP95ThresholdMs: parseOptionalThresholdNumberInput(
          turnPolicyAlertStopLatencyP95ThresholdMs,
          i18n._({
            id: "Stop latency P95 threshold",
            message: "Stop latency P95 threshold",
          }),
        ),
        turnPolicyAlertSourceActionSuccessThresholdPercent:
          parseOptionalThresholdNumberInput(
            turnPolicyAlertSourceActionSuccessThresholdPercent,
            i18n._({
              id: "Source action success threshold percent",
              message: "Source action success threshold percent",
            }),
          ),
      });
    } catch (error) {
      failSection("thresholds", error);
    }
  }

  function resetAlertThresholds() {
    submitRuntimeSection("thresholds", {
      turnPolicyAlertCoverageThresholdPercent: null,
      turnPolicyAlertPostToolUseLatencyP95ThresholdMs: null,
      turnPolicyAlertStopLatencyP95ThresholdMs: null,
      turnPolicyAlertSourceActionSuccessThresholdPercent: null,
    });
  }

  function saveAlertGovernanceLists() {
    try {
      submitRuntimeSection("alertGovernance", {
        turnPolicyAlertSuppressedCodes: parseTurnPolicyAlertSuppressedCodesInput(
          turnPolicyAlertSuppressedCodes,
        ),
        turnPolicyAlertAcknowledgedCodes:
          parseTurnPolicyAlertAcknowledgedCodesInput(
            turnPolicyAlertAcknowledgedCodes,
          ),
        turnPolicyAlertSnoozedCodes: parseTurnPolicyAlertSnoozedCodesInput(
          turnPolicyAlertSnoozedCodes,
        ),
        turnPolicyAlertSnoozeUntil: datetimeLocalInputToIsoString(
          turnPolicyAlertSnoozeUntil,
        ),
      });
    } catch (error) {
      failSection("alertGovernance", error);
    }
  }

  function resetAlertGovernanceLists() {
    submitRuntimeSection("alertGovernance", {
      turnPolicyAlertSuppressedCodes: null,
      turnPolicyAlertAcknowledgedCodes: null,
      turnPolicyAlertSnoozedCodes: null,
      turnPolicyAlertSnoozeUntil: null,
    });
  }

  function renderSectionNotices(
    panel: RuntimeSectionKey,
    successTitle: string,
    successMessage: string,
  ) {
    const mutationPanel = runtimePreferencesMutation.variables?.panel;

    return (
      <>
        {sectionErrors[panel] ? (
          <InlineNotice
            noticeKey={`governance-section-${panel}-validation-${sectionErrors[panel]}`}
            title={i18n._({
              id: "Validation failed",
              message: "Validation failed",
            })}
            tone="error"
          >
            {sectionErrors[panel]}
          </InlineNotice>
        ) : null}
        {runtimePreferencesMutation.isError && mutationPanel === panel ? (
          <InlineNotice
            noticeKey={`governance-section-${panel}-error-${getErrorMessage(runtimePreferencesMutation.error)}`}
            title={i18n._({
              id: "Failed to save governance settings",
              message: "Failed to save governance settings",
            })}
            tone="error"
          >
            {getErrorMessage(runtimePreferencesMutation.error)}
          </InlineNotice>
        ) : null}
        {runtimePreferencesMutation.isSuccess && mutationPanel === panel ? (
          <InlineNotice
            noticeKey={`governance-section-${panel}-success`}
            title={successTitle}
          >
            {successMessage}
          </InlineNotice>
        ) : null}
      </>
    );
  }

  const runtimeHookOverrideCount = countRuntimeHookOverrides(hookConfiguration);
  const workspaceBaselineCount = countWorkspaceBaselineValues(hookConfiguration);
  const runtimePolicyOverrideCount = countRuntimePolicyOverrides(runtimePreferences);
  const turnPolicyAlertCount = turnPolicyMetrics?.alerts?.length ?? 0;
  const runtimeDisabled =
    runtimePreferencesQuery.isLoading || runtimePreferencesMutation.isPending;
  const sessionStartTemplatePreview = renderSessionStartTemplatePreview(
    hookSessionStartTemplate,
  );
  const effectiveSnapshot = {
    workspace: {
      id: workspaceId ?? "",
      name: workspaceName,
    },
    hooks: {
      runtimeOverrides: runtimeHookOverrideCount,
      baselineValues: workspaceBaselineCount,
      effective: {
        sessionStartEnabled: hookConfiguration?.effectiveHookSessionStartEnabled,
        sessionStartContextPaths:
          hookConfiguration?.effectiveHookSessionStartContextPaths,
        sessionStartMaxChars: hookConfiguration?.effectiveHookSessionStartMaxChars,
        sessionStartTemplate: hookConfiguration?.effectiveHookSessionStartTemplate,
        secretPasteBlock:
          hookConfiguration?.effectiveHookUserPromptSubmitBlockSecretPasteEnabled,
        dangerousCommandBlock:
          hookConfiguration?.effectiveHookPreToolUseBlockDangerousCommandEnabled,
        protectedGovernancePaths:
          hookConfiguration?.effectiveHookPreToolUseProtectedGovernancePaths,
      },
    },
    turnPolicy: {
      runtimeOverrides: runtimePolicyOverrideCount,
      alerts: turnPolicyAlertCount,
      effective: {
        postToolUseEnabled:
          runtimePreferences?.effectiveTurnPolicyPostToolUseFailedValidationEnabled,
        stopMissingVerificationEnabled:
          runtimePreferences?.effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled,
        followUpCooldownMs:
          runtimePreferences?.effectiveTurnPolicyFollowUpCooldownMs,
        postToolUseFollowUpCooldownMs:
          runtimePreferences?.effectiveTurnPolicyPostToolUseFollowUpCooldownMs,
        stopMissingVerificationFollowUpCooldownMs:
          runtimePreferences?.effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs,
        postToolUsePrimaryAction:
          runtimePreferences?.effectiveTurnPolicyPostToolUsePrimaryAction,
        stopMissingVerificationPrimaryAction:
          runtimePreferences?.effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
        postToolUseInterruptBehavior:
          runtimePreferences?.effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
        stopMissingVerificationInterruptBehavior:
          runtimePreferences?.effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
        validationCommandPrefixes:
          runtimePreferences?.effectiveTurnPolicyValidationCommandPrefixes,
        alertCoverageThresholdPercent:
          runtimePreferences?.effectiveTurnPolicyAlertCoverageThresholdPercent,
        alertPostToolUseLatencyP95ThresholdMs:
          runtimePreferences?.effectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs,
        alertStopLatencyP95ThresholdMs:
          runtimePreferences?.effectiveTurnPolicyAlertStopLatencyP95ThresholdMs,
        alertSourceActionSuccessThresholdPercent:
          runtimePreferences?.effectiveTurnPolicyAlertSourceActionSuccessThresholdPercent,
      },
    },
  };

  const headerMeta = (
    <div className="governance-header-meta">
      <span className="governance-header-pill governance-header-pill--active">
        {i18n._({
          id: "{count} runtime overrides",
          message: "{count} runtime overrides",
          values: {
            count: formatLocalizedNumber(
              runtimeHookOverrideCount + runtimePolicyOverrideCount,
              "0",
            ),
          },
        })}
      </span>
      <span className="governance-header-pill">
        {i18n._({
          id: "{count} workspace baseline values",
          message: "{count} workspace baseline values",
          values: {
            count: formatLocalizedNumber(workspaceBaselineCount, "0"),
          },
        })}
      </span>
      <span
        className={
          turnPolicyAlertCount > 0
            ? "governance-header-pill governance-header-pill--warning"
            : "governance-header-pill"
        }
      >
        {i18n._({
          id: "{count} active alerts",
          message: "{count} active alerts",
          values: {
            count: formatLocalizedNumber(turnPolicyAlertCount, "0"),
          },
        })}
      </span>
    </div>
  );

  const tabs = [
    {
      id: "overview",
      label: i18n._({ id: "Overview", message: "Overview" }),
      content: (
        <div className="governance-tab-stack">
          <div className="governance-summary-grid">
            <SummaryCard
              label={i18n._({
                id: "Hook Runtime Overrides",
                message: "Hook Runtime Overrides",
              })}
              meta={i18n._({
                id: "Global runtime values that replace workspace defaults.",
                message: "Global runtime values that replace workspace defaults.",
              })}
              tone={runtimeHookOverrideCount > 0 ? "active" : "default"}
              value={i18n._({
                id: "{count} active",
                message: "{count} active",
                values: {
                  count: formatLocalizedNumber(runtimeHookOverrideCount, "0"),
                },
              })}
            />
            <SummaryCard
              label={i18n._({
                id: "Workspace Baseline",
                message: "Workspace Baseline",
              })}
              meta={i18n._({
                id: "Values load from workspace hooks.json first and fall back to CODEX_HOME/hooks.json when no workspace file exists.",
                message:
                  "Values load from workspace hooks.json first and fall back to CODEX_HOME/hooks.json when no workspace file exists.",
              })}
              tone={workspaceBaselineCount > 0 ? "active" : "default"}
              value={i18n._({
                id: "{count} configured",
                message: "{count} configured",
                values: {
                  count: formatLocalizedNumber(workspaceBaselineCount, "0"),
                },
              })}
            />
            <SummaryCard
              label={i18n._({
                id: "Turn Policy Overrides",
                message: "Turn Policy Overrides",
              })}
              meta={i18n._({
                id: "Runtime rescue, cooldown, and alert thresholds.",
                message: "Runtime rescue, cooldown, and alert thresholds.",
              })}
              tone={runtimePolicyOverrideCount > 0 ? "active" : "default"}
              value={i18n._({
                id: "{count} active",
                message: "{count} active",
                values: {
                  count: formatLocalizedNumber(runtimePolicyOverrideCount, "0"),
                },
              })}
            />
            <SummaryCard
              label={i18n._({
                id: "Policy Alerts",
                message: "Policy Alerts",
              })}
              meta={i18n._({
                id: "Current turn-policy alerts generated from workspace metrics.",
                message:
                  "Current turn-policy alerts generated from workspace metrics.",
              })}
              tone={turnPolicyAlertCount > 0 ? "warning" : "default"}
              value={i18n._({
                id: "{count} open",
                message: "{count} open",
                values: {
                  count: formatLocalizedNumber(turnPolicyAlertCount, "0"),
                },
              })}
            />
          </div>

          <CollapsiblePanel
            defaultExpanded
            description={i18n._({
              id: "Keep runtime overrides, workspace baseline, and activity streams visible without flattening them into a single long form.",
              message:
                "Keep runtime overrides, workspace baseline, and activity streams visible without flattening them into a single long form.",
            })}
            title={
              <span className="governance-panel-title">
                {i18n._({
                  id: "Operating Model",
                  message: "Operating Model",
                })}
                <HelpBadge
                  content={i18n._({
                    id: "Hooks and turn policy do not share the same storage layer. Hook baseline reads workspace hooks.json first, falls back to CODEX_HOME/hooks.json when needed, and still keeps runtime overrides separate.",
                    message:
                      "Hooks and turn policy do not share the same storage layer. Hook baseline reads workspace hooks.json first, falls back to CODEX_HOME/hooks.json when needed, and still keeps runtime overrides separate.",
                  })}
                  label={i18n._({
                    id: "Explain governance operating model",
                    message: "Explain governance operating model",
                  })}
                />
              </span>
            }
          >
            <div className="governance-record-stack">
              <SettingsRecord
                action={
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    onClick={() =>
                      activateStoredTab(
                        GOVERNANCE_SETTINGS_TAB_STORAGE_KEY,
                        "runtime",
                      )
                    }
                    type="button"
                  >
                    {i18n._({
                      id: "Open runtime controls",
                      message: "Open runtime controls",
                    })}
                  </button>
                }
                description={i18n._({
                  id: "Runtime overrides are global and currently drive effective hook and turn-policy behavior.",
                  message:
                    "Runtime overrides are global and currently drive effective hook and turn-policy behavior.",
                })}
                marker="R"
                meta={i18n._({
                  id: "{count} values overridden",
                  message: "{count} values overridden",
                  values: {
                    count: formatLocalizedNumber(
                      runtimeHookOverrideCount + runtimePolicyOverrideCount,
                      "0",
                    ),
                  },
                })}
                title={i18n._({
                  id: "Runtime overrides",
                  message: "Runtime overrides",
                })}
              />
              <SettingsRecord
                action={
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    onClick={() =>
                      activateStoredTab(
                        GOVERNANCE_SETTINGS_TAB_STORAGE_KEY,
                        "workspace",
                      )
                    }
                    type="button"
                  >
                    {i18n._({
                      id: "Open workspace baseline",
                      message: "Open workspace baseline",
                    })}
                  </button>
                }
                description={i18n._({
                  id: "Workspace baseline reads workspace hooks.json first, falls back to CODEX_HOME/hooks.json when needed, and writes only workspace .codex/hooks.json.",
                  message:
                    "Workspace baseline reads workspace hooks.json first, falls back to CODEX_HOME/hooks.json when needed, and writes only workspace .codex/hooks.json.",
                })}
                marker="W"
                meta={hookConfiguration?.loadedFromPath ?? ".codex/hooks.json"}
                title={i18n._({
                  id: "Workspace baseline",
                  message: "Workspace baseline",
                })}
              />
              <SettingsRecord
                action={
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    onClick={() =>
                      activateStoredTab(
                        GOVERNANCE_SETTINGS_TAB_STORAGE_KEY,
                        "activity",
                      )
                    }
                    type="button"
                  >
                    {i18n._({
                      id: "Open activity",
                      message: "Open activity",
                    })}
                  </button>
                }
                description={i18n._({
                  id: "Policy decisions and hook runs remain queryable from the same page, with filters and drill-down kept below in dedicated panels.",
                  message:
                    "Policy decisions and hook runs remain queryable from the same page, with filters and drill-down kept below in dedicated panels.",
                })}
                marker="A"
                meta={i18n._({
                  id: "{decisions} decisions · {runs} hook runs",
                  message: "{decisions} decisions · {runs} hook runs",
                  values: {
                    decisions: formatLocalizedNumber(
                      turnPolicyMetrics?.decisions.total ?? 0,
                      "0",
                    ),
                    runs: formatLocalizedNumber(
                      workspaceHookRuns.hookRuns.length,
                      "0",
                    ),
                  },
                })}
                title={i18n._({
                  id: "Observability",
                  message: "Observability",
                })}
              />
            </div>
          </CollapsiblePanel>

          <div className="governance-two-column">
            <CollapsiblePanel
              className="governance-panel-fill"
              defaultExpanded
              description={i18n._({
                id: "Effective hook state already merges built-in defaults, workspace baseline, and runtime overrides.",
                message:
                  "Effective hook state already merges built-in defaults, workspace baseline, and runtime overrides.",
              })}
              title={i18n._({
                id: "Effective Hook Configuration",
                message: "Effective Hook Configuration",
              })}
            >
              <ThreadWorkbenchRailHookConfigurationSection
                hookConfiguration={hookConfiguration}
                hookConfigurationError={hookConfigurationError}
                hookConfigurationLoading={hookConfigurationQuery.isLoading}
              />
            </CollapsiblePanel>

            <CollapsiblePanel
              className="governance-panel-fill"
              defaultExpanded
              description={i18n._({
                id: "This panel summarizes the effective rescue controls and alert thresholds currently active at runtime.",
                message:
                  "This panel summarizes the effective rescue controls and alert thresholds currently active at runtime.",
              })}
              title={
                <span className="governance-panel-title">
                  {i18n._({
                    id: "Effective Turn Policy",
                    message: "Effective Turn Policy",
                  })}
                  <HelpBadge
                    content={i18n._({
                      id: "Turn policy values here come from runtime preferences only. If a value is not configured, the built-in default is active.",
                      message:
                        "Turn policy values here come from runtime preferences only. If a value is not configured, the built-in default is active.",
                    })}
                    label={i18n._({
                      id: "Explain effective turn policy",
                      message: "Explain effective turn policy",
                    })}
                  />
                </span>
              }
            >
              {runtimePreferencesError ? (
                <InlineNotice
                  noticeKey={`governance-effective-turn-policy-${runtimePreferencesError}`}
                  title={i18n._({
                    id: "Runtime preferences unavailable",
                    message: "Runtime preferences unavailable",
                  })}
                  tone="error"
                >
                  {runtimePreferencesError}
                </InlineNotice>
              ) : (
                <div className="governance-detail-list">
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Post-tool-use rescue",
                        message: "Post-tool-use rescue",
                      })}
                    </span>
                    <strong>
                      {formatBooleanPreferenceValue(
                        runtimePreferences?.effectiveTurnPolicyPostToolUseFailedValidationEnabled,
                      )}{" "}
                      ·{" "}
                      {formatRuntimeSourceLabel(
                        hasConfiguredValue(
                          runtimePreferences?.configuredTurnPolicyPostToolUseFailedValidationEnabled,
                        ),
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Missing verification rescue",
                        message: "Missing verification rescue",
                      })}
                    </span>
                    <strong>
                      {formatBooleanPreferenceValue(
                        runtimePreferences?.effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled,
                      )}{" "}
                      ·{" "}
                      {formatRuntimeSourceLabel(
                        hasConfiguredValue(
                          runtimePreferences?.configuredTurnPolicyStopMissingSuccessfulVerificationEnabled,
                        ),
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Primary actions",
                        message: "Primary actions",
                      })}
                    </span>
                    <strong>
                      {formatTurnPolicyPrimaryActionLabel(
                        runtimePreferences?.effectiveTurnPolicyPostToolUsePrimaryAction,
                      )}{" "}
                      /{" "}
                      {formatTurnPolicyPrimaryActionLabel(
                        runtimePreferences?.effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Interrupt fallback",
                        message: "Interrupt fallback",
                      })}
                    </span>
                    <strong>
                      {formatTurnPolicyInterruptNoActiveTurnBehaviorLabel(
                        runtimePreferences?.effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
                      )}{" "}
                      /{" "}
                      {formatTurnPolicyInterruptNoActiveTurnBehaviorLabel(
                        runtimePreferences?.effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Cooldowns",
                        message: "Cooldowns",
                      })}
                    </span>
                    <strong>
                      {formatThresholdValue(
                        runtimePreferences?.effectiveTurnPolicyFollowUpCooldownMs,
                        "ms",
                      )}{" "}
                      /{" "}
                      {formatThresholdValue(
                        runtimePreferences?.effectiveTurnPolicyPostToolUseFollowUpCooldownMs,
                        "ms",
                      )}{" "}
                      /{" "}
                      {formatThresholdValue(
                        runtimePreferences?.effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs,
                        "ms",
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Validation commands",
                        message: "Validation commands",
                      })}
                    </span>
                    <strong
                      title={(
                        runtimePreferences?.effectiveTurnPolicyValidationCommandPrefixes ?? []
                      ).join("\n")}
                    >
                      {formatListPreview(
                        runtimePreferences?.effectiveTurnPolicyValidationCommandPrefixes,
                        i18n._({
                          id: "Built-in defaults",
                          message: "Built-in defaults",
                        }),
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Coverage alert threshold",
                        message: "Coverage alert threshold",
                      })}
                    </span>
                    <strong>
                      {formatThresholdValue(
                        runtimePreferences?.effectiveTurnPolicyAlertCoverageThresholdPercent,
                        "%",
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Latency thresholds",
                        message: "Latency thresholds",
                      })}
                    </span>
                    <strong>
                      {formatThresholdValue(
                        runtimePreferences?.effectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs,
                        "ms",
                      )}{" "}
                      /{" "}
                      {formatThresholdValue(
                        runtimePreferences?.effectiveTurnPolicyAlertStopLatencyP95ThresholdMs,
                        "ms",
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Source action threshold",
                        message: "Source action threshold",
                      })}
                    </span>
                    <strong>
                      {formatThresholdValue(
                        runtimePreferences?.effectiveTurnPolicyAlertSourceActionSuccessThresholdPercent,
                        "%",
                      )}
                    </strong>
                  </div>
                  <div className="governance-detail-row">
                    <span>
                      {i18n._({
                        id: "Alert governance",
                        message: "Alert governance",
                      })}
                    </span>
                    <strong>
                      {i18n._({
                        id: "{suppressed} suppressed · {acknowledged} acknowledged · {snoozed} snoozed",
                        message:
                          "{suppressed} suppressed · {acknowledged} acknowledged · {snoozed} snoozed",
                        values: {
                          suppressed: formatLocalizedNumber(
                            runtimePreferences?.effectiveTurnPolicyAlertSuppressedCodes
                              ?.length ?? 0,
                            "0",
                          ),
                          acknowledged: formatLocalizedNumber(
                            runtimePreferences?.effectiveTurnPolicyAlertAcknowledgedCodes
                              ?.length ?? 0,
                            "0",
                          ),
                          snoozed: formatLocalizedNumber(
                            runtimePreferences?.effectiveTurnPolicyAlertSnoozedCodes
                              ?.length ?? 0,
                            "0",
                          ),
                        },
                      })}
                    </strong>
                  </div>
                  {runtimePreferences?.effectiveTurnPolicyAlertSnoozeUntil ? (
                    <p className="config-inline-note" style={{ margin: "8px 0 0" }}>
                      {i18n._({
                        id: "Snooze until {timestamp}.",
                        message: "Snooze until {timestamp}.",
                        values: {
                          timestamp: formatLocalizedDateTime(
                            runtimePreferences.effectiveTurnPolicyAlertSnoozeUntil,
                            "—",
                          ),
                        },
                      })}
                    </p>
                  ) : null}
                </div>
              )}
            </CollapsiblePanel>
          </div>

          <CollapsiblePanel
            defaultExpanded={false}
            description={i18n._({
              id: "A condensed JSON snapshot can be useful when comparing effective state with backend responses or tests.",
              message:
                "A condensed JSON snapshot can be useful when comparing effective state with backend responses or tests.",
            })}
            title={i18n._({
              id: "Effective Snapshot",
              message: "Effective Snapshot",
            })}
          >
            <SettingsJsonPreview
              defaultExpanded={false}
              description={i18n._({
                id: "Current effective governance values for the selected workspace context.",
                message:
                  "Current effective governance values for the selected workspace context.",
              })}
              title={i18n._({
                id: "Governance snapshot",
                message: "Governance snapshot",
              })}
              value={effectiveSnapshot}
            />
          </CollapsiblePanel>
        </div>
      ),
    },
    {
      id: "runtime",
      label: i18n._({ id: "Runtime Controls", message: "Runtime Controls" }),
      badge:
        runtimeHookOverrideCount + runtimePolicyOverrideCount > 0
          ? String(runtimeHookOverrideCount + runtimePolicyOverrideCount)
          : undefined,
      content: (
        <div className="governance-tab-stack">
          {runtimePreferencesError ? (
            <InlineNotice
              noticeKey={`governance-runtime-query-${runtimePreferencesError}`}
              title={i18n._({
                id: "Runtime preferences unavailable",
                message: "Runtime preferences unavailable",
              })}
              tone="error"
            >
              {runtimePreferencesError}
            </InlineNotice>
          ) : null}

          <CollapsiblePanel
            defaultExpanded
            description={i18n._({
              id: "Override hook-related runtime behavior without editing workspace files.",
              message:
                "Override hook-related runtime behavior without editing workspace files.",
            })}
            title={i18n._({
              id: "Hook Runtime Overrides",
              message: "Hook Runtime Overrides",
            })}
          >
            <div className="config-card governance-runtime-card">
              <div className="config-card__header">
                <strong>
                  {i18n._({
                    id: "Hook Runtime Overrides",
                    message: "Hook Runtime Overrides",
                  })}
                </strong>
                <div className="setting-row__actions">
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    disabled={runtimeDisabled}
                    onClick={resetHooksRuntimeOverrides}
                    type="button"
                  >
                    {i18n._({
                      id: "Reset hooks",
                      message: "Reset hooks",
                    })}
                  </button>
                  <button
                    className="ide-button ide-button--primary ide-button--sm"
                    disabled={runtimeDisabled}
                    onClick={saveHooksRuntimeOverrides}
                    type="button"
                  >
                    {runtimePreferencesMutation.isPending &&
                    runtimePreferencesMutation.variables?.panel === "hooks"
                      ? i18n._({ id: "Saving…", message: "Saving…" })
                      : i18n._({
                          id: "Save hooks",
                          message: "Save hooks",
                        })}
                  </button>
                </div>
              </div>

              <div className="form-stack">
                <p className="config-inline-note">
                  {i18n._({
                    id: "These values are global runtime overrides. They take precedence over built-in defaults and workspace baseline when configured.",
                    message:
                      "These values are global runtime overrides. They take precedence over built-in defaults and workspace baseline when configured.",
                  })}
                </p>
                {renderSectionNotices(
                  "hooks",
                  i18n._({
                    id: "Hook runtime overrides updated",
                    message: "Hook runtime overrides updated",
                  }),
                  i18n._({
                    id: "Effective hook behavior has been refreshed from the saved runtime preferences.",
                    message:
                      "Effective hook behavior has been refreshed from the saved runtime preferences.",
                  }),
                )}
                <div className="governance-form-grid">
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "SessionStart override",
                        message: "SessionStart override",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select SessionStart runtime override",
                        message: "Select SessionStart runtime override",
                      })}
                      fullWidth
                      onChange={(value) =>
                        setHookSessionStartEnabled(value as TriStateValue)
                      }
                      options={triStateOptions}
                      value={hookSessionStartEnabled}
                    />
                  </label>
                  <Input
                    hint={i18n._({
                      id: "Leave blank to stop overriding the max-char limit.",
                      message:
                        "Leave blank to stop overriding the max-char limit.",
                    })}
                    label={i18n._({
                      id: "SessionStart max chars",
                      message: "SessionStart max chars",
                    })}
                    min={1}
                    onChange={(event) =>
                      setHookSessionStartMaxChars(event.target.value)
                    }
                    type="number"
                    value={hookSessionStartMaxChars}
                  />
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "Secret paste block override",
                        message: "Secret paste block override",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select secret paste block runtime override",
                        message: "Select secret paste block runtime override",
                      })}
                      fullWidth
                      onChange={(value) =>
                        setHookSecretPasteBlockEnabled(value as TriStateValue)
                      }
                      options={triStateOptions}
                      value={hookSecretPasteBlockEnabled}
                    />
                  </label>
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "Dangerous command block override",
                        message: "Dangerous command block override",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select dangerous command block runtime override",
                        message:
                          "Select dangerous command block runtime override",
                      })}
                      fullWidth
                      onChange={(value) =>
                        setHookDangerousCommandBlockEnabled(
                          value as TriStateValue,
                        )
                      }
                      options={triStateOptions}
                      value={hookDangerousCommandBlockEnabled}
                    />
                  </label>
                </div>

	                <TextArea
	                  hint={i18n._({
	                    id: "One path per line. When configured, these replace workspace baseline SessionStart context paths at runtime.",
	                    message:
	                      "One path per line. When configured, these replace workspace baseline SessionStart context paths at runtime.",
	                  })}
	                  label={i18n._({
	                    id: "SessionStart context paths",
	                    message: "SessionStart context paths",
	                  })}
	                  onChange={(event) =>
	                    setHookSessionStartContextPaths(event.target.value)
	                  }
	                  placeholder={i18n._({
	                    id: "SessionStart context paths placeholder",
	                    message: ".codex/SESSION_START.md\n.codex/session-start.md",
	                  })}
	                  rows={5}
	                  value={hookSessionStartContextPaths}
	                />

	                <TextArea
	                  hint={i18n._({
	                    id: "Leave blank to stop overriding the template. Use {{context}} and {{user_request}}. {{source_path_line}} expands to the full source line only when a file matched.",
	                    message:
	                      "Leave blank to stop overriding the template. Use {{context}} and {{user_request}}. {{source_path_line}} expands to the full source line only when a file matched.",
	                  })}
	                  label={i18n._({
	                    id: "SessionStart template override",
	                    message: "SessionStart template override",
	                  })}
	                  onChange={(event) =>
	                    setHookSessionStartTemplate(event.target.value)
	                  }
	                  placeholder={i18n._({
	                    id: "SessionStart template override placeholder",
	                    message:
	                      "在处理当前请求前，请先遵循以下项目上下文与约定。\n{{source_path_line}}项目上下文摘录：\n{{context}}\n\n用户请求：\n{{user_request}}",
	                  })}
	                  rows={8}
	                  value={hookSessionStartTemplate}
	                />

	                <div className="setting-row__actions">
	                  <button
	                    className="ide-button ide-button--secondary ide-button--sm"
	                    onClick={() =>
	                      setHookSessionStartTemplate(DEFAULT_SESSION_START_TEMPLATE)
	                    }
	                    type="button"
	                  >
	                    {i18n._({
	                      id: "Load default template",
	                      message: "Load default template",
	                    })}
	                  </button>
	                </div>

	                <p className="config-inline-note">
	                  {i18n._({
	                    id: "Supported placeholders: {{context}}, {{user_request}}, {{source_path_line}}, and {{source_path}}.",
	                    message:
	                      "Supported placeholders: {{context}}, {{user_request}}, {{source_path_line}}, and {{source_path}}.",
	                  })}
	                </p>

	                <div className="settings-subsection settings-output-card">
	                  <div className="settings-subsection__header">
	                    <div className="settings-output-card__title-block">
	                      <strong>
	                        {i18n._({
	                          id: "SessionStart template preview",
	                          message: "SessionStart template preview",
	                        })}
	                      </strong>
	                      <p>
	                        {i18n._({
	                          id: "Preview uses sample context and request values. A blank field falls back to the built-in default template preview.",
	                          message:
	                            "Preview uses sample context and request values. A blank field falls back to the built-in default template preview.",
	                        })}
	                      </p>
	                    </div>
	                  </div>
	                  <pre className="code-block">{sessionStartTemplatePreview}</pre>
	                </div>

	                <TextArea
	                  hint={i18n._({
	                    id: "Additional protected paths merged into the effective governance path set.",
	                    message:
	                      "Additional protected paths merged into the effective governance path set.",
	                  })}
	                  label={i18n._({
	                    id: "Additional protected governance paths",
	                    message: "Additional protected governance paths",
	                  })}
	                  onChange={(event) =>
	                    setHookProtectedGovernancePaths(event.target.value)
	                  }
	                  placeholder={i18n._({
	                    id: "Additional protected governance paths placeholder",
	                    message: "docs/governance.md\nops/release-policy.md",
	                  })}
	                  rows={4}
	                  value={hookProtectedGovernancePaths}
	                />
              </div>
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            defaultExpanded
            description={i18n._({
              id: "Control rescue behavior, cooldowns, primary actions, and validation prefixes for turn policy.",
              message:
                "Control rescue behavior, cooldowns, primary actions, and validation prefixes for turn policy.",
            })}
            title={i18n._({
              id: "Turn Policy Execution Controls",
              message: "Turn Policy Execution Controls",
            })}
          >
            <div className="config-card governance-runtime-card">
              <div className="config-card__header">
                <strong>
                  {i18n._({
                    id: "Turn Policy Execution Controls",
                    message: "Turn Policy Execution Controls",
                  })}
                </strong>
                <div className="setting-row__actions">
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    disabled={runtimeDisabled}
                    onClick={resetTurnPolicyExecutionControls}
                    type="button"
                  >
                    {i18n._({
                      id: "Reset execution",
                      message: "Reset execution",
                    })}
                  </button>
                  <button
                    className="ide-button ide-button--primary ide-button--sm"
                    disabled={runtimeDisabled}
                    onClick={saveTurnPolicyExecutionControls}
                    type="button"
                  >
                    {runtimePreferencesMutation.isPending &&
                    runtimePreferencesMutation.variables?.panel === "execution"
                      ? i18n._({ id: "Saving…", message: "Saving…" })
                      : i18n._({
                          id: "Save execution",
                          message: "Save execution",
                        })}
                  </button>
                </div>
              </div>

              <div className="form-stack">
                {renderSectionNotices(
                  "execution",
                  i18n._({
                    id: "Turn policy execution updated",
                    message: "Turn policy execution updated",
                  }),
                  i18n._({
                    id: "Turn policy rescue controls now use the saved runtime preferences.",
                    message:
                      "Turn policy rescue controls now use the saved runtime preferences.",
                  }),
                )}

                <div className="governance-form-grid">
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "Post-tool-use failed validation",
                        message: "Post-tool-use failed validation",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select post-tool-use policy override",
                        message: "Select post-tool-use policy override",
                      })}
                      fullWidth
                      onChange={(value) =>
                        setTurnPolicyPostToolUseEnabled(value as TriStateValue)
                      }
                      options={triStateOptions}
                      value={turnPolicyPostToolUseEnabled}
                    />
                  </label>
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "Missing successful verification",
                        message: "Missing successful verification",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select missing verification policy override",
                        message: "Select missing verification policy override",
                      })}
                      fullWidth
                      onChange={(value) =>
                        setTurnPolicyStopMissingVerificationEnabled(
                          value as TriStateValue,
                        )
                      }
                      options={triStateOptions}
                      value={turnPolicyStopMissingVerificationEnabled}
                    />
                  </label>
                  <Input
                    label={i18n._({
                      id: "Follow-up cooldown (ms)",
                      message: "Follow-up cooldown (ms)",
                    })}
                    min={1}
                    onChange={(event) =>
                      setTurnPolicyFollowUpCooldownMs(event.target.value)
                    }
                    type="number"
                    value={turnPolicyFollowUpCooldownMs}
                  />
                  <Input
                    label={i18n._({
                      id: "Post-tool-use follow-up cooldown (ms)",
                      message: "Post-tool-use follow-up cooldown (ms)",
                    })}
                    min={1}
                    onChange={(event) =>
                      setTurnPolicyPostToolUseFollowUpCooldownMs(
                        event.target.value,
                      )
                    }
                    type="number"
                    value={turnPolicyPostToolUseFollowUpCooldownMs}
                  />
                  <Input
                    label={i18n._({
                      id: "Missing verification follow-up cooldown (ms)",
                      message: "Missing verification follow-up cooldown (ms)",
                    })}
                    min={1}
                    onChange={(event) =>
                      setTurnPolicyStopMissingVerificationFollowUpCooldownMs(
                        event.target.value,
                      )
                    }
                    type="number"
                    value={turnPolicyStopMissingVerificationFollowUpCooldownMs}
                  />
                </div>

                <div className="governance-form-grid">
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "Post-tool-use primary action",
                        message: "Post-tool-use primary action",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select post-tool-use primary action",
                        message: "Select post-tool-use primary action",
                      })}
                      fullWidth
                      onChange={setTurnPolicyPostToolUsePrimaryAction}
                      options={primaryActionOptions}
                      value={turnPolicyPostToolUsePrimaryAction}
                    />
                  </label>
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "Missing verification primary action",
                        message: "Missing verification primary action",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select missing verification primary action",
                        message: "Select missing verification primary action",
                      })}
                      fullWidth
                      onChange={setTurnPolicyStopMissingVerificationPrimaryAction}
                      options={primaryActionOptions}
                      value={turnPolicyStopMissingVerificationPrimaryAction}
                    />
                  </label>
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "Post-tool-use interrupt fallback",
                        message: "Post-tool-use interrupt fallback",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select post-tool-use interrupt fallback",
                        message: "Select post-tool-use interrupt fallback",
                      })}
                      fullWidth
                      onChange={setTurnPolicyPostToolUseInterruptBehavior}
                      options={interruptFallbackOptions}
                      value={turnPolicyPostToolUseInterruptBehavior}
                    />
                  </label>
                  <label className="field">
                    <span>
                      {i18n._({
                        id: "Missing verification interrupt fallback",
                        message: "Missing verification interrupt fallback",
                      })}
                    </span>
                    <SelectControl
                      ariaLabel={i18n._({
                        id: "Select missing verification interrupt fallback",
                        message: "Select missing verification interrupt fallback",
                      })}
                      fullWidth
                      onChange={setTurnPolicyStopMissingVerificationInterruptBehavior}
                      options={interruptFallbackOptions}
                      value={turnPolicyStopMissingVerificationInterruptBehavior}
                    />
                  </label>
                </div>

                <TextArea
                  hint={i18n._({
                    id: "One prefix per line. Leave blank to remove runtime overrides and fall back to built-in validation command prefixes.",
                    message:
                      "One prefix per line. Leave blank to remove runtime overrides and fall back to built-in validation command prefixes.",
                  })}
                  label={i18n._({
                    id: "Validation command prefixes",
                    message: "Validation command prefixes",
                  })}
                  onChange={(event) =>
                    setTurnPolicyValidationCommandPrefixes(event.target.value)
                  }
                  placeholder={i18n._({
                    id: "Validation command prefixes placeholder",
                    message: "npm test\npytest",
                  })}
                  rows={4}
                  value={turnPolicyValidationCommandPrefixes}
                />
              </div>
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            defaultExpanded={false}
            description={i18n._({
              id: "Tune alert thresholds used by workspace turn-policy metrics.",
              message:
                "Tune alert thresholds used by workspace turn-policy metrics.",
            })}
            title={i18n._({
              id: "Alert Thresholds",
              message: "Alert Thresholds",
            })}
          >
            <div className="config-card governance-runtime-card">
              <div className="config-card__header">
                <strong>
                  {i18n._({
                    id: "Alert Thresholds",
                    message: "Alert Thresholds",
                  })}
                </strong>
                <div className="setting-row__actions">
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    disabled={runtimeDisabled}
                    onClick={resetAlertThresholds}
                    type="button"
                  >
                    {i18n._({
                      id: "Reset thresholds",
                      message: "Reset thresholds",
                    })}
                  </button>
                  <button
                    className="ide-button ide-button--primary ide-button--sm"
                    disabled={runtimeDisabled}
                    onClick={saveAlertThresholds}
                    type="button"
                  >
                    {runtimePreferencesMutation.isPending &&
                    runtimePreferencesMutation.variables?.panel === "thresholds"
                      ? i18n._({ id: "Saving…", message: "Saving…" })
                      : i18n._({
                          id: "Save thresholds",
                          message: "Save thresholds",
                        })}
                  </button>
                </div>
              </div>

              <div className="form-stack">
                {renderSectionNotices(
                  "thresholds",
                  i18n._({
                    id: "Alert thresholds updated",
                    message: "Alert thresholds updated",
                  }),
                  i18n._({
                    id: "Threshold-driven policy alerts now use the saved runtime preferences.",
                    message:
                      "Threshold-driven policy alerts now use the saved runtime preferences.",
                  }),
                )}
                <div className="governance-form-grid">
                  <Input
                    label={i18n._({
                      id: "Coverage threshold (%)",
                      message: "Coverage threshold (%)",
                    })}
                    min={0}
                    onChange={(event) =>
                      setTurnPolicyAlertCoverageThresholdPercent(
                        event.target.value,
                      )
                    }
                    type="number"
                    value={turnPolicyAlertCoverageThresholdPercent}
                  />
                  <Input
                    label={i18n._({
                      id: "Post-tool-use latency P95 (ms)",
                      message: "Post-tool-use latency P95 (ms)",
                    })}
                    min={0}
                    onChange={(event) =>
                      setTurnPolicyAlertPostToolUseLatencyP95ThresholdMs(
                        event.target.value,
                      )
                    }
                    type="number"
                    value={turnPolicyAlertPostToolUseLatencyP95ThresholdMs}
                  />
                  <Input
                    label={i18n._({
                      id: "Stop latency P95 (ms)",
                      message: "Stop latency P95 (ms)",
                    })}
                    min={0}
                    onChange={(event) =>
                      setTurnPolicyAlertStopLatencyP95ThresholdMs(
                        event.target.value,
                      )
                    }
                    type="number"
                    value={turnPolicyAlertStopLatencyP95ThresholdMs}
                  />
                  <Input
                    label={i18n._({
                      id: "Source action success threshold (%)",
                      message: "Source action success threshold (%)",
                    })}
                    min={0}
                    onChange={(event) =>
                      setTurnPolicyAlertSourceActionSuccessThresholdPercent(
                        event.target.value,
                      )
                    }
                    type="number"
                    value={turnPolicyAlertSourceActionSuccessThresholdPercent}
                  />
                </div>
              </div>
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            defaultExpanded={false}
            description={i18n._({
              id: "Manage long-lived alert suppression, acknowledgement, and snooze state from the same governance page.",
              message:
                "Manage long-lived alert suppression, acknowledgement, and snooze state from the same governance page.",
            })}
            title={i18n._({
              id: "Alert Governance Lists",
              message: "Alert Governance Lists",
            })}
          >
            <div className="config-card governance-runtime-card">
              <div className="config-card__header">
                <strong>
                  {i18n._({
                    id: "Alert Governance Lists",
                    message: "Alert Governance Lists",
                  })}
                </strong>
                <div className="setting-row__actions">
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    disabled={runtimeDisabled}
                    onClick={resetAlertGovernanceLists}
                    type="button"
                  >
                    {i18n._({
                      id: "Reset alert lists",
                      message: "Reset alert lists",
                    })}
                  </button>
                  <button
                    className="ide-button ide-button--primary ide-button--sm"
                    disabled={runtimeDisabled}
                    onClick={saveAlertGovernanceLists}
                    type="button"
                  >
                    {runtimePreferencesMutation.isPending &&
                    runtimePreferencesMutation.variables?.panel ===
                      "alertGovernance"
                      ? i18n._({ id: "Saving…", message: "Saving…" })
                      : i18n._({
                          id: "Save alert lists",
                          message: "Save alert lists",
                        })}
                  </button>
                </div>
              </div>

              <div className="form-stack">
                {renderSectionNotices(
                  "alertGovernance",
                  i18n._({
                    id: "Alert governance lists updated",
                    message: "Alert governance lists updated",
                  }),
                  i18n._({
                    id: "Suppression, acknowledgement, and snooze state has been refreshed from runtime preferences.",
                    message:
                      "Suppression, acknowledgement, and snooze state has been refreshed from runtime preferences.",
                  }),
                )}
                <TextArea
                  hint={i18n._({
                    id: "One alert code per line.",
                    message: "One alert code per line.",
                  })}
                  label={i18n._({
                    id: "Suppressed alert codes",
                    message: "Suppressed alert codes",
                  })}
                  onChange={(event) =>
                    setTurnPolicyAlertSuppressedCodes(event.target.value)
                  }
                  placeholder={i18n._({
                    id: "Suppressed alert codes placeholder",
                    message: "coverage_low\naction_success_low",
                  })}
                  rows={4}
                  value={turnPolicyAlertSuppressedCodes}
                />
                <TextArea
                  hint={i18n._({
                    id: "One alert code per line.",
                    message: "One alert code per line.",
                  })}
                  label={i18n._({
                    id: "Acknowledged alert codes",
                    message: "Acknowledged alert codes",
                  })}
                  onChange={(event) =>
                    setTurnPolicyAlertAcknowledgedCodes(event.target.value)
                  }
                  placeholder={i18n._({
                    id: "Acknowledged alert codes placeholder",
                    message: "stop_latency_high",
                  })}
                  rows={4}
                  value={turnPolicyAlertAcknowledgedCodes}
                />
                <TextArea
                  hint={i18n._({
                    id: "One alert code per line.",
                    message: "One alert code per line.",
                  })}
                  label={i18n._({
                    id: "Snoozed alert codes",
                    message: "Snoozed alert codes",
                  })}
                  onChange={(event) =>
                    setTurnPolicyAlertSnoozedCodes(event.target.value)
                  }
                  placeholder={i18n._({
                    id: "Snoozed alert codes placeholder",
                    message: "bot_action_success_low",
                  })}
                  rows={4}
                  value={turnPolicyAlertSnoozedCodes}
                />
                <Input
                  hint={i18n._({
                    id: "Optional shared snooze-until timestamp for current snoozed codes.",
                    message:
                      "Optional shared snooze-until timestamp for current snoozed codes.",
                  })}
                  label={i18n._({
                    id: "Snooze until",
                    message: "Snooze until",
                  })}
                  onChange={(event) =>
                    setTurnPolicyAlertSnoozeUntil(event.target.value)
                  }
                  type="datetime-local"
                  value={turnPolicyAlertSnoozeUntil}
                />
              </div>
            </div>
          </CollapsiblePanel>
        </div>
      ),
    },
    {
      id: "workspace",
      label: i18n._({
        id: "Workspace Baseline",
        message: "Workspace Baseline",
      }),
      badge: workspaceBaselineCount > 0 ? String(workspaceBaselineCount) : undefined,
      content: (
        <div className="governance-two-column">
          <CollapsiblePanel
            className="governance-panel-fill"
            defaultExpanded
            description={i18n._({
              id: "Edit the workspace-level hook baseline written to .codex/hooks.json.",
              message:
                "Edit the workspace-level hook baseline written to .codex/hooks.json.",
            })}
            title={i18n._({
              id: "Workspace Hook Baseline Editor",
              message: "Workspace Hook Baseline Editor",
            })}
          >
            {selectedWorkspace ? (
              <WorkspaceHookConfigurationEditorSection
                hookConfiguration={hookConfiguration}
                selectedWorkspace={selectedWorkspace}
              />
            ) : (
              <p className="config-inline-note" style={{ margin: 0 }}>
                {i18n._({
                  id: "Select a workspace to edit the hook baseline.",
                  message: "Select a workspace to edit the hook baseline.",
                })}
              </p>
            )}
          </CollapsiblePanel>

          <div className="governance-tab-stack">
            <CollapsiblePanel
              className="governance-panel-fill"
              defaultExpanded
              description={i18n._({
                id: "Compare effective hook behavior against the workspace file and runtime override layers.",
                message:
                  "Compare effective hook behavior against the workspace file and runtime override layers.",
              })}
              title={i18n._({
                id: "Effective Hook Resolution",
                message: "Effective Hook Resolution",
              })}
            >
              <ThreadWorkbenchRailHookConfigurationSection
                hookConfiguration={hookConfiguration}
                hookConfigurationError={hookConfigurationError}
                hookConfigurationLoading={hookConfigurationQuery.isLoading}
              />
            </CollapsiblePanel>

            <CollapsiblePanel
              className="governance-panel-fill"
              defaultExpanded={false}
              description={i18n._({
                id: "Keep the difference between runtime override and workspace baseline visible while editing.",
                message:
                  "Keep the difference between runtime override and workspace baseline visible while editing.",
              })}
              title={i18n._({
                id: "Baseline Editing Guidance",
                message: "Baseline Editing Guidance",
              })}
            >
              <div className="governance-record-stack">
                <SettingsRecord
                  description={i18n._({
                    id: "Use this panel when the selected workspace should carry default hook behavior in source control.",
                    message:
                      "Use this panel when the selected workspace should carry default hook behavior in source control.",
                  })}
                  marker="1"
                  title={i18n._({
                    id: "Workspace-scoped",
                    message: "Workspace-scoped",
                  })}
                />
                <SettingsRecord
                  description={i18n._({
                    id: "Runtime overrides still win over the baseline. If effective values do not match the file, check Runtime Controls first.",
                    message:
                      "Runtime overrides still win over the baseline. If effective values do not match the file, check Runtime Controls first.",
                  })}
                  marker="2"
                  title={i18n._({
                    id: "Override-aware",
                    message: "Override-aware",
                  })}
                />
                <SettingsRecord
                  description={i18n._({
                    id: "This baseline affects hook configuration only. Turn policy remains runtime-managed.",
                    message:
                      "This baseline affects hook configuration only. Turn policy remains runtime-managed.",
                  })}
                  marker="3"
                  title={i18n._({
                    id: "Not a policy store",
                    message: "Not a policy store",
                  })}
                />
              </div>
            </CollapsiblePanel>
          </div>
        </div>
      ),
    },
    {
      id: "activity",
      label: i18n._({ id: "Activity", message: "Activity" }),
      badge:
        turnPolicyMetrics?.decisions.total || workspaceHookRuns.hookRuns.length
          ? String(
              (turnPolicyMetrics?.decisions.total ?? 0) +
                workspaceHookRuns.hookRuns.length,
            )
          : undefined,
      content: (
        <div className="governance-tab-stack">
          <CollapsiblePanel
            defaultExpanded
            description={i18n._({
              id: "Turn-policy rescue health, alerts, source focus, and automation or bot drill-down all remain available here.",
              message:
                "Turn-policy rescue health, alerts, source focus, and automation or bot drill-down all remain available here.",
            })}
            title={i18n._({
              id: "Policy Overview",
              message: "Policy Overview",
            })}
          >
            <WorkspaceTurnPolicyOverviewSection
              onDrillDown={(filters) => setDecisionFilters(filters)}
              selectedWorkspace={selectedWorkspace}
              turnPolicyMetrics={turnPolicyMetrics}
              turnPolicyMetricsError={turnPolicyMetricsError}
              turnPolicyMetricsLoading={turnPolicyMetricsQuery.isLoading}
              turnPolicySourceHealth={turnPolicySourceHealth}
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            defaultExpanded
            description={i18n._({
              id: "Recent automatic policy decisions stay filterable from the same page.",
              message:
                "Recent automatic policy decisions stay filterable from the same page.",
            })}
            title={i18n._({
              id: "Recent Policy Decisions",
              message: "Recent Policy Decisions",
            })}
          >
            <WorkspaceTurnPolicyRecentDecisionsSection
              filters={decisionFilters}
              hasAnyDecisions={workspaceDecisions.hasAnyDecisions}
              onChangeFilters={setDecisionFilters}
              onResetFilters={() => setDecisionFilters({})}
              selectedWorkspace={selectedWorkspace}
              turnPolicyDecisions={workspaceDecisions.turnPolicyDecisions}
              turnPolicyDecisionsError={workspaceDecisions.turnPolicyDecisionsError}
              turnPolicyDecisionsLoading={
                workspaceDecisions.turnPolicyDecisionsLoading
              }
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            defaultExpanded
            description={i18n._({
              id: "Hook runs remain visible with their own filters, status, and linked thread navigation.",
              message:
                "Hook runs remain visible with their own filters, status, and linked thread navigation.",
            })}
            title={i18n._({
              id: "Hook Runs",
              message: "Hook Runs",
            })}
          >
            <WorkspaceHookRunsSection
              filters={hookRunFilters}
              hasAnyHookRuns={workspaceHookRuns.hasAnyHookRuns}
              hookRuns={workspaceHookRuns.hookRuns}
              hookRunsError={workspaceHookRuns.hookRunsError}
              hookRunsLoading={workspaceHookRuns.hookRunsLoading}
              onChangeFilters={setHookRunFilters}
              onResetFilters={() => setHookRunFilters({})}
              selectedWorkspace={selectedWorkspace}
            />
          </CollapsiblePanel>
        </div>
      ),
    },
  ];

  return (
    <section className="settings-page settings-page--governance" role="main">
      <SettingsPageHeader
        description={i18n._({
          id: "Unify turn hooks and turn policy into a single governance cockpit while preserving the difference between runtime overrides, workspace baseline, and activity audits.",
          message:
            "Unify turn hooks and turn policy into a single governance cockpit while preserving the difference between runtime overrides, workspace baseline, and activity audits.",
        })}
        meta={headerMeta}
        title={i18n._({
          id: "Governance",
          message: "Governance",
        })}
      />

      <div className="settings-page__stack">
        <div className="governance-hero">
          <SettingsWorkspaceScopePanel
            description={i18n._({
              id: "Choose the workspace whose baseline and audit streams should be shown on this governance page.",
              message:
                "Choose the workspace whose baseline and audit streams should be shown on this governance page.",
            })}
            extraSummaryItems={[
              {
                label: i18n._({ id: "Hook runtime", message: "Hook runtime" }),
                tone: runtimeHookOverrideCount > 0 ? "active" : "paused",
                value:
                  runtimeHookOverrideCount > 0
                    ? i18n._({
                        id: "{count} active",
                        message: "{count} active",
                        values: {
                          count: formatLocalizedNumber(runtimeHookOverrideCount, "0"),
                        },
                      })
                    : i18n._({ id: "Default", message: "Default" }),
              },
              {
                label: i18n._({ id: "Baseline", message: "Baseline" }),
                tone:
                  hookConfiguration?.loadStatus === "error"
                    ? "error"
                    : hookConfiguration?.loadStatus === "loaded"
                      ? "active"
                      : "paused",
                value:
                  hookConfiguration?.loadStatus === "error"
                    ? i18n._({ id: "Error", message: "Error" })
                    : hookConfiguration?.loadStatus === "loaded"
                      ? i18n._({ id: "Loaded", message: "Loaded" })
                      : i18n._({ id: "Missing", message: "Missing" }),
              },
              {
                label: i18n._({ id: "Alerts", message: "Alerts" }),
                tone: turnPolicyAlertCount > 0 ? "error" : "active",
                value: formatLocalizedNumber(turnPolicyAlertCount, "0"),
              },
            ]}
            title={i18n._({
              id: "Governance Scope",
              message: "Governance Scope",
            })}
          />

          <section className="config-card governance-quick-menu">
            <div className="config-card__header">
              <strong>
                {i18n._({
                  id: "Quick Navigation",
                  message: "Quick Navigation",
                })}
              </strong>
              <div className="setting-row__actions">
                {selectedWorkspace ? (
                  <Link
                    className="ide-button ide-button--secondary ide-button--sm"
                    to={`/workspaces/${selectedWorkspace.id}`}
                  >
                    {i18n._({
                      id: "Open workspace",
                      message: "Open workspace",
                    })}
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="governance-quick-menu__grid">
              <button
                className="governance-quick-menu__item"
                onClick={() =>
                  activateStoredTab(
                    GOVERNANCE_SETTINGS_TAB_STORAGE_KEY,
                    "overview",
                  )
                }
                type="button"
              >
                <strong>
                  {i18n._({ id: "Overview", message: "Overview" })}
                </strong>
                <span>
                  {i18n._({
                    id: "Inspect effective state and source layering.",
                    message: "Inspect effective state and source layering.",
                  })}
                </span>
              </button>
              <button
                className="governance-quick-menu__item"
                onClick={() =>
                  activateStoredTab(
                    GOVERNANCE_SETTINGS_TAB_STORAGE_KEY,
                    "runtime",
                  )
                }
                type="button"
              >
                <strong>
                  {i18n._({
                    id: "Runtime Controls",
                    message: "Runtime Controls",
                  })}
                </strong>
                <span>
                  {i18n._({
                    id: "Edit global overrides with collapsible sections.",
                    message: "Edit global overrides with collapsible sections.",
                  })}
                </span>
              </button>
              <button
                className="governance-quick-menu__item"
                onClick={() =>
                  activateStoredTab(
                    GOVERNANCE_SETTINGS_TAB_STORAGE_KEY,
                    "workspace",
                  )
                }
                type="button"
              >
                <strong>
                  {i18n._({
                    id: "Workspace Baseline",
                    message: "Workspace Baseline",
                  })}
                </strong>
                <span>
                  {i18n._({
                    id: "Edit .codex/hooks.json without leaving settings.",
                    message: "Edit .codex/hooks.json without leaving settings.",
                  })}
                </span>
              </button>
              <button
                className="governance-quick-menu__item"
                onClick={() =>
                  activateStoredTab(
                    GOVERNANCE_SETTINGS_TAB_STORAGE_KEY,
                    "activity",
                  )
                }
                type="button"
              >
                <strong>
                  {i18n._({ id: "Activity", message: "Activity" })}
                </strong>
                <span>
                  {i18n._({
                    id: "Review policy decisions and hook runs together.",
                    message: "Review policy decisions and hook runs together.",
                  })}
                </span>
              </button>
            </div>
            <div className="governance-quick-menu__links">
              <Link className="ide-button ide-button--secondary ide-button--sm" to="/workspaces/turn-policy/history">
                {i18n._({
                  id: "Metrics history",
                  message: "Metrics history",
                })}
              </Link>
              <Link className="ide-button ide-button--secondary ide-button--sm" to="/workspaces/turn-policy/compare">
                {i18n._({
                  id: "Compare sources",
                  message: "Compare sources",
                })}
              </Link>
            </div>
          </section>
        </div>

        <Tabs
          ariaLabel={i18n._({
            id: "Governance sections",
            message: "Governance sections",
          })}
          items={tabs}
          storageKey={GOVERNANCE_SETTINGS_TAB_STORAGE_KEY}
        />
      </div>
    </section>
  );
}
