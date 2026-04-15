import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import {
  ConfigHelperCard,
  SettingsJsonPreview,
  SettingsPageHeader,
} from "../../components/settings/SettingsPrimitives";
import { SettingsJsonDiffPreview } from "../../components/settings/SettingsJsonDiffPreview";
import type { SettingsSummaryItem } from "../../components/settings/settingsWorkspaceScopePanelTypes";
import { InlineNotice } from "../../components/ui/InlineNotice";
import {
  createBlankAccessTokenDraft,
  createGeneratedAccessTokenDraft,
  shouldShowFirstAccessTokenGuide,
} from "../../features/access/tokenDrafts";
import { SettingsWorkspaceScopePanel } from "../../components/settings/SettingsWorkspaceScopePanel";
import {
  type AccessTokenWriteInput,
  batchWriteConfig,
  detectExternalAgentConfig,
  importExternalAgentConfig,
  importRuntimeModelCatalogTemplate,
  logoutAccess,
  readConfig,
  readConfigRequirements,
  readRuntimePreferences,
  writeConfigValue,
  writeRuntimePreferences,
} from "../../features/settings/api";
import {
  type ConfigScenarioMatch,
  getAdvancedConfigScenarios,
  getBestMatchingConfigScenario,
  getConfigScenarioMatch,
  getConfigScenarioDiff,
} from "../../features/settings/config-scenarios";
import {
  getSuggestedConfigTemplate,
  getRuntimeSensitiveConfigItem,
  isRuntimeSensitiveConfigKey,
  runtimeSensitiveConfigItems,
} from "../../features/settings/runtime-sensitive-config";
import { useSettingsShellContext } from "../../features/settings/shell-context";
import { Input } from "../../components/ui/Input";
import { Switch } from "../../components/ui/Switch";
import { TextArea } from "../../components/ui/TextArea";
import { formatLocalizedStatusLabel } from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import { formatLocaleDateTime } from "../../i18n/format";
import { getErrorMessage } from "../../lib/error-utils";
import {
  describeNotificationRealtimeDiagnosticsChangeDetails,
  formatNotificationRealtimeDiagnosticsChangeTrigger,
  formatRealtimeNotificationWorkspaceReason,
} from "../../features/notifications/notificationStreamUtils";
import { useNotificationRealtimeDiagnostics } from "../../features/notifications/useNotificationRealtimeDiagnostics";
import {
  readFrontendRuntimeMode,
  writeFrontendRuntimeMode,
} from "../../lib/frontend-runtime-mode";
import {
  buildConfiguredRuntimePreferencesWritePayload,
  buildDraftTurnPolicyAlertAcknowledgementPayload,
  buildConfiguredBackendThreadTracePayload,
  buildDraftBackendThreadTracePayload,
  buildDraftTurnPolicyInterruptNoActiveTurnBehaviorPayload,
  buildDraftTurnPolicyPrimaryActionPayload,
  buildDraftTurnPolicyValidationCommandPrefixesPayload,
  formatHookPreToolUseAdditionalProtectedGovernancePathsInput,
  formatHookSessionStartContextPathsInput,
  formatTurnPolicyAlertAcknowledgedCodesInput,
  datetimeLocalInputToIsoString,
  formatTurnPolicyAlertSnoozedCodesInput,
  formatTurnPolicyAlertSuppressedCodesInput,
  formatTurnPolicyValidationCommandPrefixesInput,
  isoStringToDatetimeLocalInput,
  normalizeTurnPolicyInterruptNoActiveTurnBehavior,
  normalizeTurnPolicyPrimaryAction,
  parseHookPreToolUseAdditionalProtectedGovernancePathsInput,
  parseHookSessionStartContextPathsInput,
  parseTurnPolicyAlertSuppressedCodesInput,
  parseTurnPolicyAlertSnoozedCodesInput,
  type TurnPolicyInterruptNoActiveTurnBehavior,
} from "./configSettingsPageRuntimePreferences";
import { SelectControl } from "../../components/ui/SelectControl";
import type { SelectOption } from "../../components/ui/selectControlTypes";
import { activateStoredTab, Tabs } from "../../components/ui/Tabs";
import { useUIStore } from "../../stores/ui-store";
import {
  ContextIcon,
  FeedIcon,
  RefreshIcon,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
} from "../../components/ui/RailControls";
import {
  getWorkspaceRuntimeState,
  restartWorkspace,
} from "../../features/workspaces/api";
import { RuntimeRecoveryNoticeContent } from "../../features/workspaces/RuntimeRecoveryNoticeContent";
import { RuntimeRecoveryActionGroup } from "../../features/workspaces/RuntimeRecoveryActionGroup";
import { buildWorkspaceRuntimeRecoverySummary } from "../../features/workspaces/runtimeRecovery";
import type { RuntimePreferencesResult } from "../../types/api";

type AccessTokenDraft = {
  id?: string;
  label: string;
  token: string;
  tokenPreview?: string;
  expiresAt: string;
  permanent: boolean;
  revealToken: boolean;
  status?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type RuntimePreferencesMutationInput = {
  modelCatalogPath?: string;
  defaultShellType?: string;
  defaultTerminalShell?: string;
  modelShellTypeOverrides?: Record<string, string>;
  outboundProxyUrl?: string;
  hookSessionStartEnabled?: boolean | null;
  hookSessionStartContextPaths?: string[] | null;
  hookSessionStartMaxChars?: number | null;
  hookUserPromptSubmitBlockSecretPasteEnabled?: boolean | null;
  hookPreToolUseBlockDangerousCommandEnabled?: boolean | null;
  hookPreToolUseAdditionalProtectedGovernancePaths?: string[] | null;
  turnPolicyPostToolUseFailedValidationEnabled?: boolean | null;
  turnPolicyStopMissingSuccessfulVerificationEnabled?: boolean | null;
  turnPolicyFollowUpCooldownMs?: number | null;
  turnPolicyPostToolUseFollowUpCooldownMs?: number | null;
  turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs?: number | null;
  turnPolicyPostToolUsePrimaryAction?: string | null;
  turnPolicyStopMissingSuccessfulVerificationPrimaryAction?: string | null;
  turnPolicyPostToolUseInterruptNoActiveTurnBehavior?: string | null;
  turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior?:
    | string
    | null;
  turnPolicyValidationCommandPrefixes?: string[] | null;
  turnPolicyAlertCoverageThresholdPercent?: number | null;
  turnPolicyAlertPostToolUseLatencyP95ThresholdMs?: number | null;
  turnPolicyAlertStopLatencyP95ThresholdMs?: number | null;
  turnPolicyAlertSourceActionSuccessThresholdPercent?: number | null;
  turnPolicyAlertSuppressedCodes?: string[] | null;
  turnPolicyAlertAcknowledgedCodes?: string[] | null;
  turnPolicyAlertSnoozedCodes?: string[] | null;
  turnPolicyAlertSnoozeUntil?: string | null;
  defaultTurnApprovalPolicy?: string;
  defaultTurnSandboxPolicy?: Record<string, unknown>;
  defaultCommandSandboxPolicy?: Record<string, unknown>;
  allowRemoteAccess?: boolean | null;
  allowLocalhostWithoutAccessToken?: boolean | null;
  accessTokens?: AccessTokenWriteInput[];
  backendThreadTraceEnabled?: boolean | null;
  backendThreadTraceWorkspaceId?: string;
  backendThreadTraceThreadId?: string;
};

type RuntimePreferencesMutationRequest = {
  input?: RuntimePreferencesMutationInput;
  backendThreadTraceSource?: "draft" | "configured";
};

type ConfigDetailsSummaryProps = {
  title: string;
  description: string;
};

type TurnPolicyRuntimePreferencesResult = RuntimePreferencesResult & {
  configuredTurnPolicyPostToolUseFollowUpCooldownMs?: number | null;
  configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs?:
    | number
    | null;
  configuredTurnPolicyAlertSnoozeActive?: boolean;
  configuredTurnPolicyAlertSnoozeExpired?: boolean;
  effectiveTurnPolicyPostToolUseFollowUpCooldownMs?: number;
  effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs?: number;
};

export function ConfigSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspaceId, workspaceName } = useSettingsShellContext();
  const pushToast = useUIStore((state) => state.pushToast);
  const {
    activeWorkspaceId: notificationDiagnosticsActiveWorkspaceId,
    diagnosticsHistory: notificationDiagnosticsHistory,
    diagnosticsLastChangedAt: notificationDiagnosticsLastChangedAt,
    liveWorkspaceDiagnostics: notificationRealtimeDiagnostics,
    notificationsQuery: notificationDiagnosticsQuery,
    workspaceNameById: notificationDiagnosticsWorkspaceNameById,
  } = useNotificationRealtimeDiagnostics();
  const [configKeyPath, setConfigKeyPath] = useState("model");
  const [configValue, setConfigValue] = useState('"gpt-5.4"');
  const [modelCatalogPath, setModelCatalogPath] = useState("");
  const [defaultShellType, setDefaultShellType] = useState("");
  const [defaultTerminalShell, setDefaultTerminalShell] = useState("");
  const [modelShellTypeOverridesInput, setModelShellTypeOverridesInput] =
    useState("{}");
  const [outboundProxyUrl, setOutboundProxyUrl] = useState("");
  const [hookSessionStartEnabled, setHookSessionStartEnabled] = useState(true);
  const [hookSessionStartContextPathsInput, setHookSessionStartContextPathsInput] =
    useState("");
  const [hookSessionStartMaxCharsInput, setHookSessionStartMaxCharsInput] =
    useState("");
  const [
    hookUserPromptSubmitBlockSecretPasteEnabled,
    setHookUserPromptSubmitBlockSecretPasteEnabled,
  ] = useState(true);
  const [
    hookPreToolUseBlockDangerousCommandEnabled,
    setHookPreToolUseBlockDangerousCommandEnabled,
  ] = useState(true);
  const [
    hookPreToolUseAdditionalProtectedGovernancePathsInput,
    setHookPreToolUseAdditionalProtectedGovernancePathsInput,
  ] = useState("");
  const [
    turnPolicyPostToolUseFailedValidationEnabled,
    setTurnPolicyPostToolUseFailedValidationEnabled,
  ] = useState(true);
  const [
    turnPolicyStopMissingSuccessfulVerificationEnabled,
    setTurnPolicyStopMissingSuccessfulVerificationEnabled,
  ] = useState(true);
  const [
    turnPolicyFollowUpCooldownMsInput,
    setTurnPolicyFollowUpCooldownMsInput,
  ] = useState("");
  const [
    turnPolicyPostToolUseFollowUpCooldownMsInput,
    setTurnPolicyPostToolUseFollowUpCooldownMsInput,
  ] = useState("");
  const [
    turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMsInput,
    setTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMsInput,
  ] = useState("");
  const [
    turnPolicyPostToolUsePrimaryAction,
    setTurnPolicyPostToolUsePrimaryAction,
  ] = useState<"steer" | "followUp" | "interrupt">("steer");
  const [
    turnPolicyStopMissingSuccessfulVerificationPrimaryAction,
    setTurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
  ] = useState<"steer" | "followUp" | "interrupt">("followUp");
  const [
    turnPolicyPostToolUseInterruptNoActiveTurnBehavior,
    setTurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
  ] = useState<TurnPolicyInterruptNoActiveTurnBehavior>("skip");
  const [
    turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
    setTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
  ] = useState<TurnPolicyInterruptNoActiveTurnBehavior>("skip");
  const [
    turnPolicyValidationCommandPrefixesInput,
    setTurnPolicyValidationCommandPrefixesInput,
  ] = useState("");
  const [
    turnPolicyAlertCoverageThresholdPercentInput,
    setTurnPolicyAlertCoverageThresholdPercentInput,
  ] = useState("");
  const [
    turnPolicyAlertPostToolUseLatencyP95ThresholdMsInput,
    setTurnPolicyAlertPostToolUseLatencyP95ThresholdMsInput,
  ] = useState("");
  const [
    turnPolicyAlertStopLatencyP95ThresholdMsInput,
    setTurnPolicyAlertStopLatencyP95ThresholdMsInput,
  ] = useState("");
  const [
    turnPolicyAlertSourceActionSuccessThresholdPercentInput,
    setTurnPolicyAlertSourceActionSuccessThresholdPercentInput,
  ] = useState("");
  const [
    turnPolicyAlertSuppressedCodesInput,
    setTurnPolicyAlertSuppressedCodesInput,
  ] = useState("");
  const [
    turnPolicyAlertAcknowledgedCodesInput,
    setTurnPolicyAlertAcknowledgedCodesInput,
  ] = useState("");
  const [
    turnPolicyAlertSnoozedCodesInput,
    setTurnPolicyAlertSnoozedCodesInput,
  ] = useState("");
  const [turnPolicyAlertSnoozeUntilInput, setTurnPolicyAlertSnoozeUntilInput] =
    useState("");
  const [defaultTurnApprovalPolicy, setDefaultTurnApprovalPolicy] =
    useState("");
  const [defaultTurnSandboxPolicyInput, setDefaultTurnSandboxPolicyInput] =
    useState("");
  const [
    defaultCommandSandboxPolicyInput,
    setDefaultCommandSandboxPolicyInput,
  ] = useState("");
  const [allowRemoteAccess, setAllowRemoteAccess] = useState(true);
  const [
    allowLocalhostWithoutAccessToken,
    setAllowLocalhostWithoutAccessToken,
  ] = useState(false);
  const [accessTokenDrafts, setAccessTokenDrafts] = useState<
    AccessTokenDraft[]
  >([]);
  const accessTokenInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [shellEnvironmentPolicyInput, setShellEnvironmentPolicyInput] =
    useState("");
  const [frontendRuntimeMode, setFrontendRuntimeMode] = useState(() =>
    readFrontendRuntimeMode(),
  );
  const [backendThreadTraceEnabled, setBackendThreadTraceEnabled] =
    useState(false);
  const [backendThreadTraceWorkspaceId, setBackendThreadTraceWorkspaceId] =
    useState("");
  const [backendThreadTraceThreadId, setBackendThreadTraceThreadId] =
    useState("");

  const [savedBackendThreadTraceEnabled, setSavedBackendThreadTraceEnabled] =
    useState<boolean | null>(null);
  const [
    savedBackendThreadTraceWorkspaceId,
    setSavedBackendThreadTraceWorkspaceId,
  ] = useState("");
  const [savedBackendThreadTraceThreadId, setSavedBackendThreadTraceThreadId] =
    useState("");

  const configQuery = useQuery({
    queryKey: ["settings-config", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readConfig(workspaceId!, { includeLayers: true }),
  });
  const requirementsQuery = useQuery({
    queryKey: ["settings-requirements", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readConfigRequirements(workspaceId!),
  });
  const runtimePreferencesQuery = useQuery({
    queryKey: ["settings-runtime-preferences"],
    queryFn: readRuntimePreferences,
  });
  const workspaceRuntimeStateQuery = useQuery({
    queryKey: ["environment-runtime-state", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => getWorkspaceRuntimeState(workspaceId!),
  });
  const runtimeRecoverySummary = useMemo(
    () => buildWorkspaceRuntimeRecoverySummary(workspaceRuntimeStateQuery.data),
    [workspaceRuntimeStateQuery.data],
  );
  const directWriteRuntimeSensitiveItem =
    getRuntimeSensitiveConfigItem(configKeyPath);
  const suggestedConfigTemplate = getSuggestedConfigTemplate(configKeyPath);
  const advancedConfigScenarios = getAdvancedConfigScenarios();
  const advancedScenarioMatches = useMemo(
    () =>
      advancedConfigScenarios.map((scenario) =>
        getConfigScenarioMatch(configQuery.data?.config, scenario),
      ),
    [advancedConfigScenarios, configQuery.data?.config],
  );
  const bestMatchingAdvancedScenario = useMemo(
    () =>
      getBestMatchingConfigScenario(
        configQuery.data?.config,
        advancedConfigScenarios,
      ),
    [advancedConfigScenarios, configQuery.data?.config],
  );
  function buildRuntimePreferencesPayload(
    input?: RuntimePreferencesMutationInput,
    backendThreadTraceSource: "draft" | "configured" = "draft",
  ) {
    const includeHookSessionStartEnabled =
      input &&
      Object.prototype.hasOwnProperty.call(input, "hookSessionStartEnabled");
    const includeHookSessionStartContextPaths =
      input &&
      Object.prototype.hasOwnProperty.call(
        input,
        "hookSessionStartContextPaths",
      );
    const includeHookSessionStartMaxChars =
      input &&
      Object.prototype.hasOwnProperty.call(input, "hookSessionStartMaxChars");
    const includeHookUserPromptSubmitBlockSecretPasteEnabled =
      input &&
      Object.prototype.hasOwnProperty.call(
        input,
        "hookUserPromptSubmitBlockSecretPasteEnabled",
      );
    const includeHookPreToolUseBlockDangerousCommandEnabled =
      input &&
      Object.prototype.hasOwnProperty.call(
        input,
        "hookPreToolUseBlockDangerousCommandEnabled",
      );
    const includeHookPreToolUseAdditionalProtectedGovernancePaths =
      input &&
      Object.prototype.hasOwnProperty.call(
        input,
        "hookPreToolUseAdditionalProtectedGovernancePaths",
      );
    const includeTurnPolicyAlertSnoozedCodes =
      input &&
      Object.prototype.hasOwnProperty.call(
        input,
        "turnPolicyAlertSnoozedCodes",
      );
    const includeTurnPolicyAlertSnoozeUntil =
      input &&
      Object.prototype.hasOwnProperty.call(input, "turnPolicyAlertSnoozeUntil");
    const turnPolicyPrimaryActionPayload =
      buildDraftTurnPolicyPrimaryActionPayload(
        {
          turnPolicyPostToolUsePrimaryAction,
          turnPolicyStopMissingSuccessfulVerificationPrimaryAction,
        },
        input,
      );
    const turnPolicyInterruptNoActiveTurnBehaviorPayload =
      buildDraftTurnPolicyInterruptNoActiveTurnBehaviorPayload(
        {
          turnPolicyPostToolUseInterruptNoActiveTurnBehavior,
          turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
        },
        input,
      );
    const turnPolicyValidationCommandPrefixesPayload =
      buildDraftTurnPolicyValidationCommandPrefixesPayload(
        turnPolicyValidationCommandPrefixesInput,
        input,
      );
    const configuredPayload = buildConfiguredRuntimePreferencesWritePayload(
      runtimePreferencesQuery.data,
    );
    const basePayload = {
      ...configuredPayload,
      modelCatalogPath: (input?.modelCatalogPath ?? modelCatalogPath).trim(),
      defaultShellType: input?.defaultShellType ?? defaultShellType,
      defaultTerminalShell: input?.defaultTerminalShell ?? defaultTerminalShell,
      modelShellTypeOverrides:
        input?.modelShellTypeOverrides ??
        parseShellOverridesInput(modelShellTypeOverridesInput),
      outboundProxyUrl: (input?.outboundProxyUrl ?? outboundProxyUrl).trim(),
      hookSessionStartEnabled: includeHookSessionStartEnabled
        ? (input?.hookSessionStartEnabled ?? null)
        : hookSessionStartEnabled,
      hookSessionStartContextPaths: includeHookSessionStartContextPaths
        ? (input?.hookSessionStartContextPaths ?? null)
        : parseHookSessionStartContextPathsInput(
            hookSessionStartContextPathsInput,
          ),
      hookSessionStartMaxChars: includeHookSessionStartMaxChars
        ? (input?.hookSessionStartMaxChars ?? null)
        : parseOptionalPositiveIntegerInput(
            hookSessionStartMaxCharsInput,
            i18n._({
              id: "Session-start Max Chars",
              message: "Session-start Max Chars",
            }),
          ),
      hookUserPromptSubmitBlockSecretPasteEnabled:
        includeHookUserPromptSubmitBlockSecretPasteEnabled
          ? (input?.hookUserPromptSubmitBlockSecretPasteEnabled ?? null)
          : hookUserPromptSubmitBlockSecretPasteEnabled,
      hookPreToolUseBlockDangerousCommandEnabled:
        includeHookPreToolUseBlockDangerousCommandEnabled
          ? (input?.hookPreToolUseBlockDangerousCommandEnabled ?? null)
          : hookPreToolUseBlockDangerousCommandEnabled,
      hookPreToolUseAdditionalProtectedGovernancePaths:
        includeHookPreToolUseAdditionalProtectedGovernancePaths
          ? (input?.hookPreToolUseAdditionalProtectedGovernancePaths ?? null)
          : parseHookPreToolUseAdditionalProtectedGovernancePathsInput(
              hookPreToolUseAdditionalProtectedGovernancePathsInput,
            ),
      turnPolicyPostToolUseFailedValidationEnabled:
        input?.turnPolicyPostToolUseFailedValidationEnabled ??
        turnPolicyPostToolUseFailedValidationEnabled,
      turnPolicyStopMissingSuccessfulVerificationEnabled:
        input?.turnPolicyStopMissingSuccessfulVerificationEnabled ??
        turnPolicyStopMissingSuccessfulVerificationEnabled,
      turnPolicyFollowUpCooldownMs:
        input?.turnPolicyFollowUpCooldownMs ??
        parseOptionalThresholdNumberInput(
          turnPolicyFollowUpCooldownMsInput,
          i18n._({
            id: "Follow-up Cooldown (ms)",
            message: "Follow-up Cooldown (ms)",
          }),
        ),
      turnPolicyPostToolUseFollowUpCooldownMs:
        input?.turnPolicyPostToolUseFollowUpCooldownMs ??
        parseOptionalThresholdNumberInput(
          turnPolicyPostToolUseFollowUpCooldownMsInput,
          i18n._({
            id: "Post-tool-use Follow-up Cooldown (ms)",
            message: "Post-tool-use Follow-up Cooldown (ms)",
          }),
        ),
      turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:
        input?.turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs ??
        parseOptionalThresholdNumberInput(
          turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMsInput,
          i18n._({
            id: "Missing Verify Follow-up Cooldown (ms)",
            message: "Missing Verify Follow-up Cooldown (ms)",
          }),
        ),
      ...turnPolicyPrimaryActionPayload,
      ...turnPolicyInterruptNoActiveTurnBehaviorPayload,
      ...turnPolicyValidationCommandPrefixesPayload,
      turnPolicyAlertCoverageThresholdPercent:
        input?.turnPolicyAlertCoverageThresholdPercent ??
        parseOptionalThresholdNumberInput(
          turnPolicyAlertCoverageThresholdPercentInput,
          i18n._({
            id: "Coverage Threshold (%)",
            message: "Coverage Threshold (%)",
          }),
        ),
      turnPolicyAlertPostToolUseLatencyP95ThresholdMs:
        input?.turnPolicyAlertPostToolUseLatencyP95ThresholdMs ??
        parseOptionalThresholdNumberInput(
          turnPolicyAlertPostToolUseLatencyP95ThresholdMsInput,
          i18n._({
            id: "Post-tool-use P95 Threshold (ms)",
            message: "Post-tool-use P95 Threshold (ms)",
          }),
        ),
      turnPolicyAlertStopLatencyP95ThresholdMs:
        input?.turnPolicyAlertStopLatencyP95ThresholdMs ??
        parseOptionalThresholdNumberInput(
          turnPolicyAlertStopLatencyP95ThresholdMsInput,
          i18n._({
            id: "Stop P95 Threshold (ms)",
            message: "Stop P95 Threshold (ms)",
          }),
        ),
      turnPolicyAlertSourceActionSuccessThresholdPercent:
        input?.turnPolicyAlertSourceActionSuccessThresholdPercent ??
        parseOptionalThresholdNumberInput(
          turnPolicyAlertSourceActionSuccessThresholdPercentInput,
          i18n._({
            id: "Source Action Success Threshold (%)",
            message: "Source Action Success Threshold (%)",
          }),
        ),
      turnPolicyAlertSuppressedCodes:
        input?.turnPolicyAlertSuppressedCodes ??
        parseTurnPolicyAlertSuppressedCodesInput(
          turnPolicyAlertSuppressedCodesInput,
        ),
      ...buildDraftTurnPolicyAlertAcknowledgementPayload(
        turnPolicyAlertAcknowledgedCodesInput,
        input,
      ),
    };
    const turnPolicyAlertSnoozedCodes = includeTurnPolicyAlertSnoozedCodes
      ? (input?.turnPolicyAlertSnoozedCodes ?? null)
      : parseTurnPolicyAlertSnoozedCodesInput(turnPolicyAlertSnoozedCodesInput);
    const turnPolicyAlertSnoozeUntil = includeTurnPolicyAlertSnoozeUntil
      ? (input?.turnPolicyAlertSnoozeUntil ?? null)
      : datetimeLocalInputToIsoString(turnPolicyAlertSnoozeUntilInput);
    const hasTurnPolicyAlertSnooze =
      Array.isArray(turnPolicyAlertSnoozedCodes) &&
      turnPolicyAlertSnoozedCodes.length > 0 &&
      Boolean(turnPolicyAlertSnoozeUntil);
    const payload = {
      ...basePayload,
      turnPolicyAlertSnoozedCodes: hasTurnPolicyAlertSnooze
        ? turnPolicyAlertSnoozedCodes
        : null,
      turnPolicyAlertSnoozeUntil: hasTurnPolicyAlertSnooze
        ? turnPolicyAlertSnoozeUntil
        : null,
      defaultTurnApprovalPolicy:
        input?.defaultTurnApprovalPolicy ?? defaultTurnApprovalPolicy,
      defaultTurnSandboxPolicy:
        input?.defaultTurnSandboxPolicy ??
        parseSandboxPolicyInput(defaultTurnSandboxPolicyInput),
      defaultCommandSandboxPolicy:
        input?.defaultCommandSandboxPolicy ??
        parseSandboxPolicyInput(defaultCommandSandboxPolicyInput),
      allowRemoteAccess: input?.allowRemoteAccess ?? allowRemoteAccess,
      allowLocalhostWithoutAccessToken:
        input?.allowLocalhostWithoutAccessToken ??
        allowLocalhostWithoutAccessToken,
      accessTokens:
        input?.accessTokens ?? buildAccessTokenPayload(accessTokenDrafts),
    };

    const backendThreadTracePayload =
      backendThreadTraceSource === "configured"
        ? buildConfiguredBackendThreadTracePayload({
            configuredBackendThreadTraceEnabled: savedBackendThreadTraceEnabled,
            configuredBackendThreadTraceWorkspaceId:
              savedBackendThreadTraceWorkspaceId,
            configuredBackendThreadTraceThreadId:
              savedBackendThreadTraceThreadId,
          })
        : buildDraftBackendThreadTracePayload(
            {
              backendThreadTraceEnabled,
              backendThreadTraceWorkspaceId,
              backendThreadTraceThreadId,
            },
            input,
          );

    return {
      ...payload,
      ...backendThreadTracePayload,
    };
  }

  function syncRuntimePreferencesForm(result: RuntimePreferencesResult) {
    setModelCatalogPath(result.configuredModelCatalogPath);
    setDefaultShellType(result.configuredDefaultShellType);
    setDefaultTerminalShell(result.configuredDefaultTerminalShell);
    setModelShellTypeOverridesInput(
      JSON.stringify(result.configuredModelShellTypeOverrides ?? {}, null, 2),
    );
    setOutboundProxyUrl(result.configuredOutboundProxyUrl ?? "");
    setHookSessionStartEnabled(
      result.configuredHookSessionStartEnabled ??
        result.effectiveHookSessionStartEnabled ??
        result.defaultHookSessionStartEnabled ??
        true,
    );
    setHookSessionStartContextPathsInput(
      formatHookSessionStartContextPathsInput(
        result.configuredHookSessionStartContextPaths,
      ),
    );
    setHookSessionStartMaxCharsInput(
      stringifyOptionalNumberInput(result.configuredHookSessionStartMaxChars),
    );
    setHookUserPromptSubmitBlockSecretPasteEnabled(
      result.configuredHookUserPromptSubmitBlockSecretPasteEnabled ??
        result.effectiveHookUserPromptSubmitBlockSecretPasteEnabled ??
        result.defaultHookUserPromptSubmitBlockSecretPasteEnabled ??
        true,
    );
    setHookPreToolUseBlockDangerousCommandEnabled(
      result.configuredHookPreToolUseBlockDangerousCommandEnabled ??
        result.effectiveHookPreToolUseBlockDangerousCommandEnabled ??
        result.defaultHookPreToolUseBlockDangerousCommandEnabled ??
        true,
    );
    setHookPreToolUseAdditionalProtectedGovernancePathsInput(
      formatHookPreToolUseAdditionalProtectedGovernancePathsInput(
        result.configuredHookPreToolUseAdditionalProtectedGovernancePaths,
      ),
    );
    setTurnPolicyPostToolUseFailedValidationEnabled(
      result.configuredTurnPolicyPostToolUseFailedValidationEnabled ??
        result.effectiveTurnPolicyPostToolUseFailedValidationEnabled ??
        result.defaultTurnPolicyPostToolUseFailedValidationEnabled,
    );
    setTurnPolicyStopMissingSuccessfulVerificationEnabled(
      result.configuredTurnPolicyStopMissingSuccessfulVerificationEnabled ??
        result.effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled ??
        result.defaultTurnPolicyStopMissingSuccessfulVerificationEnabled,
    );
    setTurnPolicyFollowUpCooldownMsInput(
      stringifyOptionalNumberInput(
        result.configuredTurnPolicyFollowUpCooldownMs,
      ),
    );
    setTurnPolicyPostToolUseFollowUpCooldownMsInput(
      stringifyOptionalNumberInput(
        (result as TurnPolicyRuntimePreferencesResult)
          .configuredTurnPolicyPostToolUseFollowUpCooldownMs,
      ),
    );
    setTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMsInput(
      stringifyOptionalNumberInput(
        (result as TurnPolicyRuntimePreferencesResult)
          .configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs,
      ),
    );
    setTurnPolicyPostToolUsePrimaryAction(
      (normalizeTurnPolicyPrimaryAction(
        result.configuredTurnPolicyPostToolUsePrimaryAction ||
          result.effectiveTurnPolicyPostToolUsePrimaryAction ||
          result.defaultTurnPolicyPostToolUsePrimaryAction,
      ) || "steer") as "steer" | "followUp" | "interrupt",
    );
    setTurnPolicyStopMissingSuccessfulVerificationPrimaryAction(
      (normalizeTurnPolicyPrimaryAction(
        result.configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction ||
          result.effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction ||
          result.defaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
      ) || "followUp") as "steer" | "followUp" | "interrupt",
    );
    setTurnPolicyPostToolUseInterruptNoActiveTurnBehavior(
      (normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        result.configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior ||
          result.effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior ||
          result.defaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
      ) || "skip") as TurnPolicyInterruptNoActiveTurnBehavior,
    );
    setTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior(
      (normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        result.configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior ||
          result.effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior ||
          result.defaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
      ) || "skip") as TurnPolicyInterruptNoActiveTurnBehavior,
    );
    setTurnPolicyValidationCommandPrefixesInput(
      formatTurnPolicyValidationCommandPrefixesInput(
        result.configuredTurnPolicyValidationCommandPrefixes,
      ),
    );
    setTurnPolicyAlertCoverageThresholdPercentInput(
      stringifyOptionalNumberInput(
        result.configuredTurnPolicyAlertCoverageThresholdPercent,
      ),
    );
    setTurnPolicyAlertPostToolUseLatencyP95ThresholdMsInput(
      stringifyOptionalNumberInput(
        result.configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs,
      ),
    );
    setTurnPolicyAlertStopLatencyP95ThresholdMsInput(
      stringifyOptionalNumberInput(
        result.configuredTurnPolicyAlertStopLatencyP95ThresholdMs,
      ),
    );
    setTurnPolicyAlertSourceActionSuccessThresholdPercentInput(
      stringifyOptionalNumberInput(
        result.configuredTurnPolicyAlertSourceActionSuccessThresholdPercent,
      ),
    );
    setTurnPolicyAlertSuppressedCodesInput(
      formatTurnPolicyAlertSuppressedCodesInput(
        result.configuredTurnPolicyAlertSuppressedCodes,
      ),
    );
    setTurnPolicyAlertAcknowledgedCodesInput(
      formatTurnPolicyAlertAcknowledgedCodesInput(
        result.configuredTurnPolicyAlertAcknowledgedCodes,
      ),
    );
    setTurnPolicyAlertSnoozedCodesInput(
      formatTurnPolicyAlertSnoozedCodesInput(
        result.configuredTurnPolicyAlertSnoozedCodes,
      ),
    );
    setTurnPolicyAlertSnoozeUntilInput(
      isoStringToDatetimeLocalInput(
        result.configuredTurnPolicyAlertSnoozeUntil,
      ),
    );
    setDefaultTurnApprovalPolicy(
      result.configuredDefaultTurnApprovalPolicy ?? "",
    );
    setDefaultTurnSandboxPolicyInput(
      stringifyJsonInput(result.configuredDefaultTurnSandboxPolicy),
    );
    setDefaultCommandSandboxPolicyInput(
      stringifyJsonInput(result.configuredDefaultCommandSandboxPolicy),
    );
    setAllowRemoteAccess(
      result.configuredAllowRemoteAccess ??
        result.effectiveAllowRemoteAccess ??
        result.defaultAllowRemoteAccess,
    );
    setAllowLocalhostWithoutAccessToken(
      result.configuredAllowLocalhostWithoutAccessToken ??
        result.effectiveAllowLocalhostWithoutAccessToken ??
        result.defaultAllowLocalhostWithoutAccessToken,
    );
    setAccessTokenDrafts(buildAccessTokenDrafts(result));
    setBackendThreadTraceEnabled(
      result.configuredBackendThreadTraceEnabled ??
        result.effectiveBackendThreadTraceEnabled ??
        false,
    );
    setBackendThreadTraceWorkspaceId(
      result.configuredBackendThreadTraceWorkspaceId ||
        result.effectiveBackendThreadTraceWorkspaceId ||
        "",
    );
    setBackendThreadTraceThreadId(
      result.configuredBackendThreadTraceThreadId ||
        result.effectiveBackendThreadTraceThreadId ||
        "",
    );
    setSavedBackendThreadTraceEnabled(
      result.configuredBackendThreadTraceEnabled ?? null,
    );
    setSavedBackendThreadTraceWorkspaceId(
      result.configuredBackendThreadTraceWorkspaceId ?? "",
    );
    setSavedBackendThreadTraceThreadId(
      result.configuredBackendThreadTraceThreadId ?? "",
    );
  }

  const restartRuntimeMutation = useMutation({
    mutationFn: () => restartWorkspace(workspaceId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["settings-shell-workspaces"],
        }),
        queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] }),
        queryClient.invalidateQueries({
          queryKey: ["settings-config", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["environment-runtime-state", workspaceId],
        }),
      ]);
      pushToast({
        title: i18n._({
          id: "Runtime restarted",
          message: "Runtime restarted",
        }),
        message: i18n._({
          id: "The selected workspace runtime has been restarted and will reload tracked config from app-server startup.",
          message:
            "The selected workspace runtime has been restarted and will reload tracked config from app-server startup.",
        }),
        tone: "success",
      });
    },
  });

  const writeConfigMutation = useMutation({
    mutationFn: () =>
      writeConfigValue(workspaceId!, {
        keyPath: configKeyPath,
        mergeStrategy: "upsert",
        value: parseJsonInput(configValue),
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["settings-config", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["settings-shell-workspaces"],
        }),
        queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] }),
        queryClient.invalidateQueries({
          queryKey: ["environment-runtime-state", workspaceId],
        }),
      ]);
      const runtimeSensitiveItem = result.matchedRuntimeSensitiveKey
        ? getRuntimeSensitiveConfigItem(result.matchedRuntimeSensitiveKey)
        : null;
      pushToast({
        title: result.runtimeReloadRequired
          ? i18n._({
              id: "Config saved, restart recommended",
              message: "Config saved, restart recommended",
            })
          : i18n._({
              id: "Config key saved",
              message: "Config key saved",
            }),
        message: result.runtimeReloadRequired
          ? i18n._({
              id: "Key path {keyPath} matched runtime-sensitive prefix {matchedKey}. The backend marked this write as requiring runtime reload before the live app-server process is guaranteed to reflect the new value.",
              message:
                "Key path {keyPath} matched runtime-sensitive prefix {matchedKey}. The backend marked this write as requiring runtime reload before the live app-server process is guaranteed to reflect the new value.",
              values: {
                keyPath: configKeyPath,
                matchedKey:
                  result.matchedRuntimeSensitiveKey ??
                  runtimeSensitiveItem?.keyPath ??
                  i18n._({ id: "Unknown", message: "Unknown" }),
              },
            })
          : i18n._({
              id: "The config value was written successfully.",
              message: "The config value was written successfully.",
            }),
        tone: result.runtimeReloadRequired ? "info" : "success",
        actionLabel: result.runtimeReloadRequired
          ? i18n._({ id: "Restart Runtime", message: "Restart Runtime" })
          : undefined,
        onAction: result.runtimeReloadRequired
          ? () => {
              if (!workspaceId || restartRuntimeMutation.isPending) {
                return;
              }
              restartRuntimeMutation.mutate();
            }
          : undefined,
      });
    },
  });
  const writeShellEnvironmentPolicyMutation = useMutation({
    mutationFn: () =>
      writeConfigValue(workspaceId!, {
        keyPath: "shell_environment_policy",
        mergeStrategy: "upsert",
        value: parseShellEnvironmentPolicyInput(shellEnvironmentPolicyInput),
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["settings-config", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["settings-shell-workspaces"],
        }),
        queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] }),
        queryClient.invalidateQueries({
          queryKey: ["environment-runtime-state", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["settings-requirements", workspaceId],
        }),
      ]);
      pushToast({
        title: i18n._({
          id: "Shell environment policy updated",
          message: "Shell environment policy updated",
        }),
        message: i18n._({
          id: "User config now contains an explicit shell_environment_policy override.",
          message:
            "User config now contains an explicit shell_environment_policy override.",
        }),
        tone: "success",
        actionLabel: result.runtimeReloadRequired
          ? i18n._({ id: "Restart Runtime", message: "Restart Runtime" })
          : undefined,
        onAction: result.runtimeReloadRequired
          ? () => {
              if (!workspaceId || restartRuntimeMutation.isPending) {
                return;
              }
              restartRuntimeMutation.mutate();
            }
          : undefined,
      });
    },
  });
  const applyConfigScenarioMutation = useMutation({
    mutationFn: async (scenarioId: string) => {
      const scenario = advancedConfigScenarios.find(
        (item) => item.id === scenarioId,
      );
      if (!scenario || !workspaceId) {
        throw new Error(i18n._({ id: 'Scenario or workspace is unavailable.', message: 'Scenario or workspace is unavailable.' }));
      }

      await batchWriteConfig(workspaceId, {
        edits: scenario.edits.map((edit) => ({
          keyPath: edit.keyPath,
          mergeStrategy: "upsert",
          value: edit.value,
        })),
        reloadUserConfig: true,
      });

      return restartWorkspace(workspaceId);
    },
    onSuccess: async (_, scenarioId) => {
      const scenario = advancedConfigScenarios.find(
        (item) => item.id === scenarioId,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["settings-config", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["settings-requirements", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["settings-shell-workspaces"],
        }),
        queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] }),
        queryClient.invalidateQueries({
          queryKey: ["environment-runtime-state", workspaceId],
        }),
      ]);
      pushToast({
        title: i18n._({
          id: "Scenario applied and runtime restarted",
          message: "Scenario applied and runtime restarted",
        }),
        message:
          scenario?.title ??
          i18n._({
            id: "The selected config scenario was applied and the workspace runtime restarted.",
            message:
              "The selected config scenario was applied and the workspace runtime restarted.",
          }),
        tone: "success",
      });
    },
  });
  const writeRuntimePreferencesMutation = useMutation({
    mutationFn: async (request?: RuntimePreferencesMutationRequest) =>
      writeRuntimePreferences(
        buildRuntimePreferencesPayload(
          request?.input,
          request?.backendThreadTraceSource ?? "draft",
        ),
      ),
    onSuccess: async (result) => {
      syncRuntimePreferencesForm(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-bootstrap"] }),
        queryClient.invalidateQueries({
          queryKey: ["settings-runtime-preferences"],
        }),
        queryClient.invalidateQueries({ queryKey: ["runtime-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
      ]);
      const shellLabel = formatShellTypeLabel(result.effectiveDefaultShellType);
      const terminalLabel = formatTerminalShellLabel(
        result.effectiveDefaultTerminalShell,
      );
      pushToast({
        title: i18n._({
          id: "Runtime overrides applied",
          message: "Runtime overrides applied",
        }),
        message: i18n._({
          id: "Access: {access}; local: {local}; remote: {remote}; shell: {shell}; terminal: {terminal}; turn sandbox: {turnSandbox}; command sandbox: {commandSandbox}; backend trace: {backendTrace}.",
          message:
            "Access: {access}; local: {local}; remote: {remote}; shell: {shell}; terminal: {terminal}; turn sandbox: {turnSandbox}; command sandbox: {commandSandbox}; backend trace: {backendTrace}.",
          values: {
            access:
              (result.configuredAccessTokens ?? []).filter(
                (token) => token.status === "active",
              ).length > 0
                ? i18n._({
                    id: "{count} active token(s)",
                    message: "{count} active token(s)",
                    values: {
                      count: (result.configuredAccessTokens ?? []).filter(
                        (token) => token.status === "active",
                      ).length,
                    },
                  })
                : i18n._({ id: "Open", message: "Open" }),
            local: formatLocalAccessPolicyLabel(
              result.effectiveAllowLocalhostWithoutAccessToken,
            ),
            remote: result.effectiveAllowRemoteAccess
              ? i18n._({ id: "Allowed", message: "Allowed" })
              : i18n._({ id: "Localhost Only", message: "Localhost Only" }),
            shell: shellLabel,
            terminal: terminalLabel,
            turnSandbox: formatSandboxPolicyLabel(
              result.effectiveDefaultTurnSandboxPolicy,
            ),
            commandSandbox: formatSandboxPolicyLabel(
              result.effectiveDefaultCommandSandboxPolicy,
            ),
            backendTrace: formatBackendThreadTraceSummary(
              result.effectiveBackendThreadTraceEnabled,
              result.effectiveBackendThreadTraceWorkspaceId,
              result.effectiveBackendThreadTraceThreadId,
            ),
          },
        }),
        tone: "success",
        actionLabel: i18n._({
          id: "Open Effective",
          message: "Open Effective",
        }),
        onAction: () => {
          activateStoredTab("settings-config-main-tabs", "runtime");
          activateStoredTab("settings-config-runtime-side-tabs", "effective");
        },
      });
    },
  });
  const logoutAccessMutation = useMutation({
    mutationFn: logoutAccess,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["access-bootstrap"] });
      pushToast({
        title: i18n._({
          id: "Browser session cleared",
          message: "Browser session cleared",
        }),
        message: i18n._({
          id: "The current browser access session was removed. If access control is enabled, the login page will appear on the next protected request.",
          message:
            "The current browser access session was removed. If access control is enabled, the login page will appear on the next protected request.",
        }),
        tone: "success",
      });
    },
  });
  const configuredAccessTokenCount =
    runtimePreferencesQuery.data?.configuredAccessTokens?.length ?? 0;
  const showFirstAccessTokenGuide =
    runtimePreferencesQuery.isSuccess &&
    shouldShowFirstAccessTokenGuide({
      configuredTokenCount: configuredAccessTokenCount,
      draftCount: accessTokenDrafts.length,
    });
  const hasAccessTokenProtectionDraft =
    buildAccessTokenPayload(accessTokenDrafts).length > 0;
  const accessPolicyPreview = {
    local: formatLocalAccessPreviewLabel(
      allowLocalhostWithoutAccessToken,
      hasAccessTokenProtectionDraft,
    ),
    remote: formatRemoteAccessPreviewLabel(
      allowRemoteAccess,
      hasAccessTokenProtectionDraft,
    ),
  };
  function addAccessTokenDraft() {
    setAccessTokenDrafts((current) => [
      ...current,
      { ...createBlankAccessTokenDraft() },
    ]);
  }

  function generateAccessTokenDraft(index?: number) {
    try {
      const generatedDraft = createGeneratedAccessTokenDraft();
      setAccessTokenDrafts((current) => {
        if (typeof index !== "number") {
          return [...current, { ...generatedDraft }];
        }

        return current.map((entry, tokenIndex) =>
          tokenIndex === index
            ? {
                ...entry,
                token: generatedDraft.token,
                revealToken: true,
              }
            : entry,
        );
      });
      void notifyGeneratedAccessToken(generatedDraft.token);
    } catch (error) {
      pushToast({
        title: i18n._({
          id: "Token generation failed",
          message: "Token generation failed",
        }),
        message: getErrorMessage(error),
        tone: "error",
      });
    }
  }

  async function notifyGeneratedAccessToken(token: string) {
    const copied = await copyTextToClipboard(token);
    pushToast({
      title: i18n._({
        id: "Access token generated",
        message: "Access token generated",
      }),
      message: copied
        ? i18n._({
            id: "A new access token draft was generated and copied to your clipboard. Store it before you save because only a masked preview remains afterwards.",
            message:
              "A new access token draft was generated and copied to your clipboard. Store it before you save because only a masked preview remains afterwards.",
          })
        : i18n._({
            id: "A new access token draft was generated. Copy it from the form before you save because only a masked preview remains afterwards.",
            message:
              "A new access token draft was generated. Copy it from the form before you save because only a masked preview remains afterwards.",
          }),
      tone: copied ? "success" : "warning",
    });
  }

  function revealAndSelectAccessToken(index: number) {
    setAccessTokenDrafts((current) =>
      current.map((entry, tokenIndex) =>
        tokenIndex === index
          ? {
              ...entry,
              revealToken: true,
            }
          : entry,
      ),
    );

    queueMicrotask(() => {
      requestAnimationFrame(() => {
        const input = accessTokenInputRefs.current[index];
        input?.focus();
        input?.select();
      });
    });
  }

  async function handleCopyAccessToken(token: string, index: number) {
    const copied = await copyTextToClipboard(token);
    if (copied) {
      pushToast({
        title: i18n._({
          id: "Access token copied",
          message: "Access token copied",
        }),
        message: i18n._({
          id: "Store the raw token now. After you save, this page keeps only a masked preview.",
          message:
            "Store the raw token now. After you save, this page keeps only a masked preview.",
        }),
        tone: "success",
      });
      return;
    }

    revealAndSelectAccessToken(index);
    pushToast({
      title: i18n._({
        id: "Clipboard copy unavailable",
        message: "Clipboard copy unavailable",
      }),
      message: i18n._({
        id: "The token was revealed and selected in the form. Press Ctrl+C or Command+C to copy it before saving.",
        message:
          "The token was revealed and selected in the form. Press Ctrl+C or Command+C to copy it before saving.",
      }),
      tone: "warning",
    });
  }

  function submitRuntimePreferences(
    input?: RuntimePreferencesMutationInput,
    options?: {
      backendThreadTraceSource?: "draft" | "configured";
    },
  ) {
    writeRuntimePreferencesMutation.mutate({
      input,
      backendThreadTraceSource: options?.backendThreadTraceSource ?? "draft",
    });
  }

  const detectExternalMutation = useMutation({
    mutationFn: () =>
      detectExternalAgentConfig(workspaceId!, { includeHome: true }),
    onSuccess: (result) => {
      pushToast({
        title: i18n._({
          id: "External config detected",
          message: "External config detected",
        }),
        message: i18n._({
          id: "Found {count} candidate item(s) for import review.",
          message: "Found {count} candidate item(s) for import review.",
          values: { count: result.items?.length ?? 0 },
        }),
        tone: "info",
        actionLabel: i18n._({
          id: "Open Detected",
          message: "Open Detected",
        }),
        onAction: () => {
          activateStoredTab("settings-config-main-tabs", "migration");
          activateStoredTab("settings-config-migration-side-tabs", "detected");
        },
      });
    },
  });
  const importExternalMutation = useMutation({
    mutationFn: () =>
      importExternalAgentConfig(workspaceId!, {
        migrationItems: detectExternalMutation.data?.items ?? [],
      }),
    onSuccess: (result) => {
      pushToast({
        title: i18n._({
          id: "External agent state imported",
          message: "External agent state imported",
        }),
        message: i18n._({
          id: "Imported {count} item(s); backend status: {status}.",
          message: "Imported {count} item(s); backend status: {status}.",
          values: {
            count: detectExternalMutation.data?.items?.length ?? 0,
            status:
              result.status ??
              i18n._({
                id: "Accepted",
                message: "Accepted",
              }),
          },
        }),
        tone: "success",
      });
    },
  });
  const importModelCatalogMutation = useMutation({
    mutationFn: importRuntimeModelCatalogTemplate,
    onSuccess: async (result) => {
      syncRuntimePreferencesForm(result);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["settings-runtime-preferences"],
        }),
        queryClient.invalidateQueries({ queryKey: ["runtime-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
      ]);
      pushToast({
        title: i18n._({
          id: "Model catalog imported",
          message: "Model catalog imported",
        }),
        message: i18n._({
          id: "Bound runtime catalog to {path}.",
          message: "Bound runtime catalog to {path}.",
          values: { path: result.configuredModelCatalogPath },
        }),
        tone: "success",
        actionLabel: i18n._({
          id: "Open Configured",
          message: "Open Configured",
        }),
        onAction: () => {
          activateStoredTab("settings-config-main-tabs", "runtime");
          activateStoredTab("settings-config-runtime-side-tabs", "configured");
        },
      });
    },
  });

  useEffect(() => {
    if (!runtimePreferencesQuery.data) {
      return;
    }

    syncRuntimePreferencesForm(runtimePreferencesQuery.data);
  }, [runtimePreferencesQuery.data]);

  useEffect(() => {
    if (!configQuery.data) {
      return;
    }

    setShellEnvironmentPolicyInput(
      stringifyJsonInput(configQuery.data.config?.["shell_environment_policy"]),
    );
  }, [configQuery.data]);

  const configLayerCount = Array.isArray(configQuery.data?.layers)
    ? configQuery.data.layers.length
    : 0;
  const shellTypeOptions = getShellTypeOptions();
  const terminalShellOptions = getTerminalShellOptions(
    runtimePreferencesQuery.data?.supportedTerminalShells ?? [],
    defaultTerminalShell,
  );
  const approvalPolicyOptions = getApprovalPolicyOptions();
  const directWriteRequiresRestart = isRuntimeSensitiveConfigKey(configKeyPath);
  const backendThreadTraceOverrideActive = Boolean(
    runtimePreferencesQuery.data &&
    ((runtimePreferencesQuery.data.configuredBackendThreadTraceEnabled !==
      null &&
      runtimePreferencesQuery.data.configuredBackendThreadTraceEnabled !==
        undefined) ||
      runtimePreferencesQuery.data.configuredBackendThreadTraceWorkspaceId ||
      runtimePreferencesQuery.data.configuredBackendThreadTraceThreadId),
  );
  const runtimeSummary = {
    catalogBound: Boolean(
      runtimePreferencesQuery.data?.effectiveModelCatalogPath,
    ),
    accessControl:
      (runtimePreferencesQuery.data?.configuredAccessTokens ?? []).filter(
        (token) => token.status === "active",
      ).length > 0
        ? i18n._({
            id: "{count} active token(s)",
            message: "{count} active token(s)",
            values: {
              count: (
                runtimePreferencesQuery.data?.configuredAccessTokens ?? []
              ).filter((token) => token.status === "active").length,
            },
          })
        : i18n._({ id: "Open", message: "Open" }),
    localAccess: formatLocalAccessPolicyLabel(
      runtimePreferencesQuery.data?.effectiveAllowLocalhostWithoutAccessToken ??
        false,
    ),
    remoteAccess: runtimePreferencesQuery.data?.effectiveAllowRemoteAccess
      ? i18n._({ id: "Allowed", message: "Allowed" })
      : i18n._({ id: "Localhost Only", message: "Localhost Only" }),
    defaultShellType: formatShellTypeLabel(
      runtimePreferencesQuery.data?.effectiveDefaultShellType,
    ),
    defaultTerminalShell: formatTerminalShellLabel(
      runtimePreferencesQuery.data?.effectiveDefaultTerminalShell,
    ),
    outboundProxy:
      runtimePreferencesQuery.data?.effectiveOutboundProxyUrl ||
      i18n._({
        id: "System env fallback",
        message: "System env fallback",
      }),
    turnApprovalPolicy: formatApprovalPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultTurnApprovalPolicy,
    ),
    turnSandboxPolicy: formatSandboxPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultTurnSandboxPolicy,
    ),
    commandSandboxPolicy: formatSandboxPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultCommandSandboxPolicy,
    ),
    backendThreadTrace: formatBackendThreadTraceSummary(
      runtimePreferencesQuery.data?.effectiveBackendThreadTraceEnabled ?? false,
      runtimePreferencesQuery.data?.effectiveBackendThreadTraceWorkspaceId,
      runtimePreferencesQuery.data?.effectiveBackendThreadTraceThreadId,
    ),
    configLoadStatus: formatLocalizedStatusLabel(
      workspaceRuntimeStateQuery.data?.configLoadStatus,
    ),
    restartRequired: workspaceRuntimeStateQuery.data?.restartRequired ?? false,
  };

  const runtimeSummaryItems: SettingsSummaryItem[] = [
    {
      label: i18n._({ id: "Access", message: "Access" }),
      value: runtimeSummary.accessControl,
      tone:
        (runtimePreferencesQuery.data?.configuredAccessTokens ?? []).filter(
          (token) => token.status === "active",
        ).length > 0
          ? "active"
          : "paused",
    },
    {
      label: i18n._({ id: "Local", message: "Local" }),
      value: runtimeSummary.localAccess,
      tone: runtimePreferencesQuery.data
        ?.effectiveAllowLocalhostWithoutAccessToken
        ? "active"
        : "paused",
    },
    {
      label: i18n._({ id: "Remote", message: "Remote" }),
      value: runtimeSummary.remoteAccess,
      tone: runtimePreferencesQuery.data?.effectiveAllowRemoteAccess
        ? "active"
        : "paused",
    },
    {
      label: i18n._({ id: "Catalog", message: "Catalog" }),
      value: runtimeSummary.catalogBound
        ? i18n._({ id: "Attached", message: "Attached" })
        : i18n._({ id: "Missing", message: "Missing" }),
      tone: runtimeSummary.catalogBound ? "active" : "paused",
    },
    {
      label: i18n._({ id: "Shell", message: "Shell" }),
      value: runtimeSummary.defaultShellType,
    },
    {
      label: i18n._({ id: "Terminal", message: "Terminal" }),
      value: runtimeSummary.defaultTerminalShell,
    },
    {
      label: i18n._({ id: "Proxy", message: "Proxy" }),
      value: runtimeSummary.outboundProxy,
    },
    {
      label: i18n._({ id: "Turn", message: "Turn" }),
      value: runtimeSummary.turnSandboxPolicy,
    },
    {
      label: i18n._({ id: "Command", message: "Command" }),
      value: runtimeSummary.commandSandboxPolicy,
    },
    {
      label: i18n._({ id: "Approval", message: "Approval" }),
      value: runtimeSummary.turnApprovalPolicy,
    },
    {
      label: i18n._({ id: "Trace", message: "Trace" }),
      value: runtimeSummary.backendThreadTrace,
      tone: runtimePreferencesQuery.data?.effectiveBackendThreadTraceEnabled
        ? "active"
        : "paused",
    },
    {
      label: i18n._({ id: "Config", message: "Config" }),
      value: formatLocalizedStatusLabel(runtimeSummary.configLoadStatus),
      tone: runtimeSummary.restartRequired ? "paused" : "active",
    },
  ];

  function applyExecutionPreset(
    preset: "danger-full-access" | "external-sandbox" | "inherit",
  ) {
    switch (preset) {
      case "danger-full-access":
        setDefaultTurnApprovalPolicy("never");
        setDefaultTurnSandboxPolicyInput(
          JSON.stringify({ type: "dangerFullAccess" }, null, 2),
        );
        setDefaultCommandSandboxPolicyInput(
          JSON.stringify({ type: "dangerFullAccess" }, null, 2),
        );
        break;
      case "external-sandbox":
        setDefaultTurnApprovalPolicy("");
        setDefaultTurnSandboxPolicyInput(
          JSON.stringify(
            { type: "externalSandbox", networkAccess: "enabled" },
            null,
            2,
          ),
        );
        setDefaultCommandSandboxPolicyInput(
          JSON.stringify(
            { type: "externalSandbox", networkAccess: "enabled" },
            null,
            2,
          ),
        );
        break;
      default:
        setDefaultTurnApprovalPolicy("");
        setDefaultTurnSandboxPolicyInput("");
        setDefaultCommandSandboxPolicyInput("");
        break;
    }
  }

  function applyShellEnvironmentPolicyPreset(
    preset: "inherit-all" | "inherit-core-windows" | "clear",
  ) {
    switch (preset) {
      case "inherit-all":
        setShellEnvironmentPolicyInput(
          JSON.stringify(
            {
              inherit: "all",
            },
            null,
            2,
          ),
        );
        break;
      case "inherit-core-windows":
        setShellEnvironmentPolicyInput(
          JSON.stringify(
            {
              inherit: "core",
              set: {
                PATHEXT:
                  ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
                SystemRoot: "C:\\Windows",
                ComSpec: "C:\\Windows\\System32\\cmd.exe",
              },
            },
            null,
            2,
          ),
        );
        break;
      default:
        setShellEnvironmentPolicyInput("");
        break;
    }
  }

  const scenarioPresetDefaultTabId =
    bestMatchingAdvancedScenario?.scenario.id ??
    advancedScenarioMatches[0]?.scenario.id;
  const scenarioPresetTabItems = advancedScenarioMatches.map((match) => ({
    id: match.scenario.id,
    label: match.scenario.title,
    badge: `${match.matchedEditCount}/${match.totalEditCount}`,
    content: (
      <div className="config-card config-card--muted config-scenario-panel">
        <div className="config-card__header config-scenario-panel__header">
          <div className="config-scenario-panel__heading">
            <strong>{match.scenario.title}</strong>
            <p className="config-inline-note">{match.scenario.description}</p>
          </div>
          <span className={getScenarioMatchStatusClassName(match)}>
            {getScenarioMatchStatusLabel(match)}
          </span>
        </div>
        <p className="config-inline-note">
          {match.exact
            ? i18n._({ id: "Exact match", message: "Exact match" })
            : i18n._({
                id: "{matched}/{total} edits matched",
                message: "{matched}/{total} edits matched",
                values: {
                  matched: match.matchedEditCount,
                  total: match.totalEditCount,
                },
              })}
        </p>
        <SettingsJsonPreview
          collapsible={false}
          description={i18n._({
            id: "Edits that will be written before runtime restart.",
            message: "Edits that will be written before runtime restart.",
          })}
          title={i18n._({ id: "Scenario Edits", message: "Scenario Edits" })}
          value={match.scenario.edits}
        />
        <SettingsJsonDiffPreview
          description={i18n._({
            id: "Only keys whose values differ from the current config will change.",
            message:
              "Only keys whose values differ from the current config will change.",
          })}
          entries={getConfigScenarioDiff(
            configQuery.data?.config,
            match.scenario,
          )}
          title={i18n._({ id: "Scenario Diff", message: "Scenario Diff" })}
        />
        <div className="setting-row__actions config-scenario-panel__actions">
          <button
            className="ide-button ide-button--secondary ide-button--sm"
            disabled={!workspaceId || applyConfigScenarioMutation.isPending}
            onClick={() =>
              applyConfigScenarioMutation.mutate(match.scenario.id)
            }
            type="button"
          >
            {applyConfigScenarioMutation.isPending
              ? i18n._({ id: "Applying…", message: "Applying…" })
              : i18n._({ id: "Apply & Restart", message: "Apply & Restart" })}
          </button>
        </div>
      </div>
    ),
  }));

  const configTabs = [
    {
      id: "runtime",
      label: i18n._({ id: "Runtime", message: "Runtime" }),
      icon: <SparkIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__header">
            <div className="config-workbench__header-main">
              <SettingsWorkspaceScopePanel
                extraSummaryItems={runtimeSummaryItems}
              />
            </div>
          </div>

          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <div className="config-card">
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Runtime Actions",
                      message: "Runtime Actions",
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={
                        !workspaceId || restartRuntimeMutation.isPending
                      }
                      onClick={() => restartRuntimeMutation.mutate()}
                      type="button"
                    >
                      {restartRuntimeMutation.isPending
                        ? i18n._({ id: "Restarting…", message: "Restarting…" })
                        : i18n._({
                            id: "Restart Runtime",
                            message: "Restart Runtime",
                          })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => navigate("/settings/environment")}
                      type="button"
                    >
                      {i18n._({
                        id: "Open Runtime Inspection",
                        message: "Open Runtime Inspection",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={
                        !workspaceId ||
                        applyConfigScenarioMutation.isPending ||
                        !bestMatchingAdvancedScenario
                      }
                      onClick={() =>
                        bestMatchingAdvancedScenario &&
                        applyConfigScenarioMutation.mutate(
                          bestMatchingAdvancedScenario.scenario.id,
                        )
                      }
                      type="button"
                    >
                      {applyConfigScenarioMutation.isPending
                        ? i18n._({ id: "Applying…", message: "Applying…" })
                        : i18n._({
                            id: "Apply Nearest Scenario",
                            message: "Apply Nearest Scenario",
                          })}
                    </button>
                  </div>
                </div>
                <div className="form-stack">
                  <p className="config-inline-note">
                    {bestMatchingAdvancedScenario
                      ? i18n._({
                          id: "Nearest built-in scenario: {title} ({matched}/{total} edits matched).",
                          message:
                            "Nearest built-in scenario: {title} ({matched}/{total} edits matched).",
                          values: {
                            title: bestMatchingAdvancedScenario.scenario.title,
                            matched:
                              bestMatchingAdvancedScenario.matchedEditCount,
                            total: bestMatchingAdvancedScenario.totalEditCount,
                          },
                        })
                      : i18n._({
                          id: "No built-in scenario currently matches the active config closely enough.",
                          message:
                            "No built-in scenario currently matches the active config closely enough.",
                        })}
                  </p>
                  {workspaceRuntimeStateQuery.data ? (
                    <InlineNotice
                      noticeKey={`config-runtime-load-status-${workspaceId}-${workspaceRuntimeStateQuery.data.configLoadStatus}`}
                      title={i18n._({
                        id: "Config Load Status: {status}",
                        message: "Config Load Status: {status}",
                        values: {
                          status: formatLocalizedStatusLabel(
                            workspaceRuntimeStateQuery.data.configLoadStatus,
                          ),
                        },
                      })}
                      tone={
                        workspaceRuntimeStateQuery.data.restartRequired
                          ? "error"
                          : "info"
                      }
                    >
                      {workspaceRuntimeStateQuery.data.restartRequired
                        ? i18n._({
                            id: "Restart required: the tracked runtime-affecting config changed after the current runtime started.",
                            message:
                              "Restart required: the tracked runtime-affecting config changed after the current runtime started.",
                          })
                        : i18n._({
                            id: "Runtime is aligned with the last tracked runtime-affecting config change, or no tracked change exists.",
                            message:
                              "Runtime is aligned with the last tracked runtime-affecting config change, or no tracked change exists.",
                          })}
                    </InlineNotice>
                  ) : null}
                </div>
              </div>

              <section className="mode-panel">
                <div className="section-header">
                  <div>
                    <h2>
                      {i18n._({
                        id: "Frontend Runtime Mode",
                        message: "Frontend Runtime Mode",
                      })}
                    </h2>
                    <p>
                      {i18n._({
                        id: "Controls browser-side diagnostics only. Debug mode prints workspace stream events and live thread output composition details into the developer console.",
                        message:
                          "Controls browser-side diagnostics only. Debug mode prints workspace stream events and live thread output composition details into the developer console.",
                      })}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={frontendRuntimeMode === "debug"}
                  hint={i18n._({
                    id: "When enabled, the browser console records websocket events, batched deltas, and live thread state reconciliation for debugging.",
                    message:
                      "When enabled, the browser console records websocket events, batched deltas, and live thread state reconciliation for debugging.",
                  })}
                  label={i18n._({
                    id: "Enable Frontend Debug Mode",
                    message: "Enable Frontend Debug Mode",
                  })}
                  onChange={(event) => {
                    const nextMode = event.target.checked ? "debug" : "normal";
                    setFrontendRuntimeMode(nextMode);
                    writeFrontendRuntimeMode(nextMode);
                  }}
                />

                {frontendRuntimeMode === "debug" ? (
                  <div className="config-card config-card--muted config-notification-diagnostics">
                    <div className="config-card__header">
                      <strong>
                        {i18n._({
                          id: "Notification Realtime Diagnostics",
                          message: "Notification Realtime Diagnostics",
                        })}
                      </strong>
                      <div className="setting-row__actions">
                        <span className="meta-pill meta-pill--warning">
                          {i18n._({
                            id: "{count} workspaces live",
                            message: "{count} workspaces live",
                            values: {
                              count: notificationRealtimeDiagnostics.length,
                            },
                          })}
                        </span>
                        {notificationDiagnosticsActiveWorkspaceId ? (
                          <span className="meta-pill">
                            {notificationDiagnosticsActiveWorkspaceId}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="config-inline-note">
                      {i18n._({
                        id: "Mirrors the browser-side NotificationCenter subscription logic for this session. It reflects current route context, unread notifications, and recent bot replay suppression alerts.",
                        message:
                          "Mirrors the browser-side NotificationCenter subscription logic for this session. It reflects current route context, unread notifications, and recent bot replay suppression alerts.",
                      })}
                    </p>
                    <p className="config-inline-note">
                      {notificationDiagnosticsActiveWorkspaceId
                        ? i18n._({
                            id: "Current live active workspace candidate: {workspaceId}. Settings scope may differ if you switched workspaces inside Settings without changing the main app selection.",
                            message:
                              "Current live active workspace candidate: {workspaceId}. Settings scope may differ if you switched workspaces inside Settings without changing the main app selection.",
                            values: {
                              workspaceId:
                                notificationDiagnosticsActiveWorkspaceId,
                            },
                          })
                        : i18n._({
                            id: "No active workspace candidate is currently selected from the main app route context.",
                            message:
                              "No active workspace candidate is currently selected from the main app route context.",
                          })}
                    </p>
                    <p className="config-inline-note">
                      {notificationDiagnosticsLastChangedAt
                        ? i18n._({
                            id: "Last diagnostics change in this browser session: {timestamp}",
                            message:
                              "Last diagnostics change in this browser session: {timestamp}",
                            values: {
                              timestamp: formatLocaleDateTime(
                                notificationDiagnosticsLastChangedAt,
                              ),
                            },
                          })
                        : i18n._({
                            id: "No realtime subscription change has been recorded yet in this browser session.",
                            message:
                              "No realtime subscription change has been recorded yet in this browser session.",
                          })}
                    </p>

                    {notificationDiagnosticsQuery.error ? (
                      <InlineNotice
                        dismissible
                        noticeKey={`config-notification-diagnostics-${getErrorMessage(notificationDiagnosticsQuery.error)}`}
                        title={i18n._({
                          id: "Notification Diagnostics Failed",
                          message: "Notification Diagnostics Failed",
                        })}
                        tone="error"
                      >
                        {getErrorMessage(notificationDiagnosticsQuery.error)}
                      </InlineNotice>
                    ) : null}

                    <div className="config-notification-diagnostics__list">
                      {notificationRealtimeDiagnostics.length ? (
                        notificationRealtimeDiagnostics.map((subscription) => (
                          <div
                            className="config-notification-diagnostics__item"
                            key={subscription.workspaceId}
                          >
                            <div className="config-notification-diagnostics__item-header">
                              <strong>
                                {notificationDiagnosticsWorkspaceNameById[
                                  subscription.workspaceId
                                ] || subscription.workspaceId}
                              </strong>
                              <span className="config-notification-diagnostics__item-id">
                                {subscription.workspaceId}
                              </span>
                            </div>
                            <div className="config-notification-diagnostics__reasons">
                              {subscription.reasonCodes.map((reasonCode) => (
                                <span
                                  className="meta-pill"
                                  key={`${subscription.workspaceId}-${reasonCode}`}
                                >
                                  {formatRealtimeNotificationWorkspaceReason(
                                    reasonCode,
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))
                      ) : notificationDiagnosticsQuery.isLoading ? (
                        <div className="notice">
                          {i18n._({
                            id: "Loading notification realtime diagnostics…",
                            message:
                              "Loading notification realtime diagnostics…",
                          })}
                        </div>
                      ) : (
                        <div className="notice">
                          {i18n._({
                            id: "No live workspace subscriptions are currently required.",
                            message:
                              "No live workspace subscriptions are currently required.",
                          })}
                        </div>
                      )}
                    </div>

                    <div className="config-notification-diagnostics__history">
                      <strong>
                        {i18n._({
                          id: "Recent Realtime Subscription Changes",
                          message: "Recent Realtime Subscription Changes",
                        })}
                      </strong>
                      {notificationDiagnosticsHistory.length ? (
                        notificationDiagnosticsHistory.map((entry) => {
                          const changeDetailLines =
                            describeNotificationRealtimeDiagnosticsChangeDetails(
                              entry.changeDetails,
                              notificationDiagnosticsWorkspaceNameById,
                            );

                          return (
                            <div
                              className="config-notification-diagnostics__history-item"
                              key={`${entry.changedAt}-${entry.signature}`}
                            >
                              <div className="config-notification-diagnostics__history-item-header">
                                <span>
                                  {formatLocaleDateTime(entry.changedAt)}
                                </span>
                                <span className="meta-pill">
                                  {i18n._({
                                    id: "{count} workspaces",
                                    message: "{count} workspaces",
                                    values: {
                                      count: entry.subscriptions.length,
                                    },
                                  })}
                                </span>
                              </div>
                              <div className="config-notification-diagnostics__reasons">
                                {entry.changeTriggerCodes.map((triggerCode) => (
                                  <span
                                    className="meta-pill"
                                    key={`${entry.signature}-${triggerCode}`}
                                  >
                                    {formatNotificationRealtimeDiagnosticsChangeTrigger(
                                      triggerCode,
                                    )}
                                  </span>
                                ))}
                              </div>
                              <div className="config-inline-note">
                                {entry.activeWorkspaceId
                                  ? i18n._({
                                      id: "Active workspace candidate: {workspaceId}",
                                      message:
                                        "Active workspace candidate: {workspaceId}",
                                      values: {
                                        workspaceId: entry.activeWorkspaceId,
                                      },
                                    })
                                  : i18n._({
                                      id: "No active workspace candidate",
                                      message: "No active workspace candidate",
                                    })}
                              </div>
                              <div className="config-inline-note">
                                {entry.routePath
                                  ? i18n._({
                                      id: "Route context: {routePath}",
                                      message: "Route context: {routePath}",
                                      values: { routePath: entry.routePath },
                                    })
                                  : i18n._({
                                      id: "No route context recorded",
                                      message: "No route context recorded",
                                    })}
                              </div>
                              {changeDetailLines.map((detailLine) => (
                                <div
                                  className="config-inline-note"
                                  key={`${entry.signature}-${detailLine}`}
                                >
                                  {detailLine}
                                </div>
                              ))}
                              <div className="config-inline-note">
                                {entry.subscriptions.length
                                  ? entry.subscriptions
                                      .map(
                                        (subscription) =>
                                          notificationDiagnosticsWorkspaceNameById[
                                            subscription.workspaceId
                                          ] || subscription.workspaceId,
                                      )
                                      .join(", ")
                                  : i18n._({
                                      id: "No live workspaces",
                                      message: "No live workspaces",
                                    })}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="notice">
                          {i18n._({
                            id: "No realtime subscription changes recorded yet.",
                            message:
                              "No realtime subscription changes recorded yet.",
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="config-inline-note">
                    {i18n._({
                      id: "Enable Frontend Debug Mode to inspect notification realtime workspace subscriptions and the reasons each workspace stays live.",
                      message:
                        "Enable Frontend Debug Mode to inspect notification realtime workspace subscriptions and the reasons each workspace stays live.",
                    })}
                  </p>
                )}
              </section>

              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  submitRuntimePreferences({
                    backendThreadTraceEnabled,
                    backendThreadTraceWorkspaceId,
                    backendThreadTraceThreadId,
                  });
                }}
              >
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Backend Thread Trace",
                      message: "Backend Thread Trace",
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={writeRuntimePreferencesMutation.isPending}
                      onClick={() =>
                        submitRuntimePreferences({
                          backendThreadTraceEnabled: null,
                          backendThreadTraceWorkspaceId: "",
                          backendThreadTraceThreadId: "",
                        })
                      }
                      type="button"
                    >
                      {i18n._({
                        id: "Reset To Env Defaults",
                        message: "Reset To Env Defaults",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      type="submit"
                    >
                      {writeRuntimePreferencesMutation.isPending
                        ? i18n._({ id: "Applying…", message: "Applying…" })
                        : i18n._({
                            id: "Apply Trace Settings",
                            message: "Apply Trace Settings",
                          })}
                    </button>
                  </div>
                </div>

                <div className="form-stack">
                  <p className="config-inline-note">
                    {i18n._({
                      id: "Controls backend-side thread pipeline logging. When enabled, codex-server prints turn/start, runtime notifications, hub publish, projection, and websocket delivery checkpoints to the backend stdout immediately without restarting the backend process.",
                      message:
                        "Controls backend-side thread pipeline logging. When enabled, codex-server prints turn/start, runtime notifications, hub publish, projection, and websocket delivery checkpoints to the backend stdout immediately without restarting the backend process.",
                    })}
                  </p>

                  <Switch
                    checked={backendThreadTraceEnabled}
                    hint={i18n._({
                      id: "Use this together with frontend debug mode to compare websocket arrival, live state reconciliation, and backend thread pipeline logs for the same turn.",
                      message:
                        "Use this together with frontend debug mode to compare websocket arrival, live state reconciliation, and backend thread pipeline logs for the same turn.",
                    })}
                    label={i18n._({
                      id: "Enable Backend Thread Trace",
                      message: "Enable Backend Thread Trace",
                    })}
                    onChange={(event) =>
                      setBackendThreadTraceEnabled(event.target.checked)
                    }
                  />

                  <div
                    className="form-row"
                    style={{ gridTemplateColumns: "1fr 1fr" }}
                  >
                    <Input
                      hint={i18n._({
                        id: "Leave blank to trace all workspaces. Use the current workspace id to limit noise while reproducing a thread rendering issue.",
                        message:
                          "Leave blank to trace all workspaces. Use the current workspace id to limit noise while reproducing a thread rendering issue.",
                      })}
                      label={i18n._({
                        id: "Workspace Filter",
                        message: "Workspace Filter",
                      })}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setBackendThreadTraceWorkspaceId(event.target.value)
                      }
                      placeholder={
                        workspaceId ??
                        i18n._({
                          id: "All Workspaces",
                          message: "All Workspaces",
                        })
                      }
                      value={backendThreadTraceWorkspaceId}
                    />

                    <Input
                      hint={i18n._({
                        id: "Optional thread id filter. Leave blank to trace every thread inside the selected workspace scope.",
                        message:
                          "Optional thread id filter. Leave blank to trace every thread inside the selected workspace scope.",
                      })}
                      label={i18n._({
                        id: "Thread Filter",
                        message: "Thread Filter",
                      })}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setBackendThreadTraceThreadId(event.target.value)
                      }
                      placeholder="019d33ed-7caf-7510-8af7-23f34f3a83c3"
                      value={backendThreadTraceThreadId}
                    />
                  </div>

                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={!workspaceId}
                      onClick={() =>
                        setBackendThreadTraceWorkspaceId(workspaceId ?? "")
                      }
                      type="button"
                    >
                      {i18n._({
                        id: "Use Current Workspace",
                        message: "Use Current Workspace",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => setBackendThreadTraceThreadId("")}
                      type="button"
                    >
                      {i18n._({
                        id: "Clear Thread Filter",
                        message: "Clear Thread Filter",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => setBackendThreadTraceWorkspaceId("")}
                      type="button"
                    >
                      {i18n._({
                        id: "Clear Workspace Filter",
                        message: "Clear Workspace Filter",
                      })}
                    </button>
                  </div>

                  <p className="config-inline-note">
                    {backendThreadTraceOverrideActive
                      ? i18n._({
                          id: "Saved trace override is active. Reset to env defaults if you want codex-server to follow CODEX_TRACE_THREAD_PIPELINE / CODEX_TRACE_WORKSPACE_ID / CODEX_TRACE_THREAD_ID again.",
                          message:
                            "Saved trace override is active. Reset to env defaults if you want codex-server to follow CODEX_TRACE_THREAD_PIPELINE / CODEX_TRACE_WORKSPACE_ID / CODEX_TRACE_THREAD_ID again.",
                        })
                      : i18n._({
                          id: "No saved trace override is active. Effective values currently follow backend environment defaults.",
                          message:
                            "No saved trace override is active. Effective values currently follow backend environment defaults.",
                        })}
                  </p>
                </div>
              </form>

              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  submitRuntimePreferences(undefined, {
                    backendThreadTraceSource: "configured",
                  });
                }}
              >
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Access Control",
                      message: "Access Control",
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={addAccessTokenDraft}
                      type="button"
                    >
                      {i18n._({ id: "Add Token", message: "Add Token" })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={logoutAccessMutation.isPending}
                      onClick={() => logoutAccessMutation.mutate()}
                      type="button"
                    >
                      {logoutAccessMutation.isPending
                        ? i18n._({ id: "Clearing…", message: "Clearing…" })
                        : i18n._({
                            id: "Clear Browser Session",
                            message: "Clear Browser Session",
                          })}
                    </button>
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      type="submit"
                    >
                      {writeRuntimePreferencesMutation.isPending
                        ? i18n._({ id: "Saving…", message: "Saving…" })
                        : i18n._({
                            id: "Save Access Controls",
                            message: "Save Access Controls",
                          })}
                    </button>
                  </div>
                </div>

                <div className="form-stack">
                  <div className="runtime-inline-meta runtime-inline-meta--dense">
                    <div className="runtime-inline-meta__entry">
                      <span>{i18n._({ id: "Local", message: "Local" })}</span>
                      <strong>{accessPolicyPreview.local}</strong>
                    </div>
                    <div className="runtime-inline-meta__entry">
                      <span>{i18n._({ id: "Remote", message: "Remote" })}</span>
                      <strong>{accessPolicyPreview.remote}</strong>
                    </div>
                  </div>

                  <p className="config-inline-note">
                    {i18n._({
                      id: "When at least one active access token exists, non-loopback clients must complete token login before protected API routes are served. Local loopback requests can optionally bypass that requirement with the switch below.",
                      message:
                        "When at least one active access token exists, non-loopback clients must complete token login before protected API routes are served. Local loopback requests can optionally bypass that requirement with the switch below.",
                    })}
                  </p>

                  <Switch
                    checked={allowLocalhostWithoutAccessToken}
                    hint={i18n._({
                      id: "When enabled, browsers and tools on this machine using localhost, 127.0.0.1, or ::1 skip the token login screen. Non-loopback clients still follow the remote access setting and active-token checks.",
                      message:
                        "When enabled, browsers and tools on this machine using localhost, 127.0.0.1, or ::1 skip the token login screen. Non-loopback clients still follow the remote access setting and active-token checks.",
                    })}
                    label={i18n._({
                      id: "Allow Localhost Without Token",
                      message: "Allow Localhost Without Token",
                    })}
                    onChange={(event) =>
                      setAllowLocalhostWithoutAccessToken(event.target.checked)
                    }
                  />

                  <Switch
                    checked={allowRemoteAccess}
                    hint={i18n._({
                      id: "When disabled, codex-server only accepts localhost requests. LAN addresses, public IPs, and custom hostnames are rejected even before token login.",
                      message:
                        "When disabled, codex-server only accepts localhost requests. LAN addresses, public IPs, and custom hostnames are rejected even before token login.",
                    })}
                    label={i18n._({
                      id: "Allow Remote Access",
                      message: "Allow Remote Access",
                    })}
                    onChange={(event) =>
                      setAllowRemoteAccess(event.target.checked)
                    }
                  />

                  {accessTokenDrafts.length === 0 ? (
                    <div className="config-card config-card--muted">
                      <div className="form-stack">
                        <p className="config-inline-note">
                          {showFirstAccessTokenGuide
                            ? i18n._({
                                id: "No access tokens are configured yet. Generate a starter token to turn on the login gate without manually inventing a secret first.",
                                message:
                                  "No access tokens are configured yet. Generate a starter token to turn on the login gate without manually inventing a secret first.",
                              })
                            : i18n._({
                                id: "No access tokens are configured. In this state the UI remains open on localhost, but non-loopback clients stay blocked until you save at least one active token.",
                                message:
                                  "No access tokens are configured. In this state the UI remains open on localhost, but non-loopback clients stay blocked until you save at least one active token.",
                              })}
                        </p>

                        {showFirstAccessTokenGuide ? (
                          <>
                            <p className="config-inline-note">
                              {i18n._({
                                id: "Generated token values are only shown while you edit them. Copy the raw value into a password manager before you save because the settings page only keeps a masked preview afterwards.",
                                message:
                                  "Generated token values are only shown while you edit them. Copy the raw value into a password manager before you save because the settings page only keeps a masked preview afterwards.",
                              })}
                            </p>
                            <div className="setting-row__actions">
                              <button
                                className="ide-button ide-button--primary ide-button--sm"
                                onClick={() => generateAccessTokenDraft()}
                                type="button"
                              >
                                {i18n._({
                                  id: "Generate Starter Token",
                                  message: "Generate Starter Token",
                                })}
                              </button>
                              <button
                                className="ide-button ide-button--secondary ide-button--sm"
                                onClick={addAccessTokenDraft}
                                type="button"
                              >
                                {i18n._({
                                  id: "Add Manually Instead",
                                  message: "Add Manually Instead",
                                })}
                              </button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {accessTokenDrafts.map((draft, index) => (
                    <div
                      className="config-card config-card--muted"
                      key={draft.id ?? `access-token-${index}`}
                    >
                      <div className="config-card__header">
                        <div>
                          <strong>
                            {draft.label?.trim() ||
                              i18n._({
                                id: "Token {index}",
                                message: "Token {index}",
                                values: { index: index + 1 },
                              })}
                          </strong>
                        </div>
                        <div className="setting-row__actions">
                          {draft.status ? (
                            <span
                              className={
                                draft.status === "active"
                                  ? "runtime-chip runtime-chip--good"
                                  : "runtime-chip runtime-chip--warn"
                              }
                            >
                              {formatLocalizedStatusLabel(draft.status)}
                            </span>
                          ) : null}
                          <button
                            className="ide-button ide-button--ghost ide-button--ghost-danger ide-button--sm"
                            onClick={() =>
                              setAccessTokenDrafts((current) =>
                                current.filter(
                                  (_, tokenIndex) => tokenIndex !== index,
                                ),
                              )
                            }
                            type="button"
                          >
                            {i18n._({ id: "Remove", message: "Remove" })}
                          </button>
                        </div>
                      </div>

                      <div className="form-stack">
                        {draft.tokenPreview ? (
                          <div className="runtime-inline-meta runtime-inline-meta--dense">
                            <div className="runtime-inline-meta__entry">
                              <span>
                                {i18n._({ id: "Preview", message: "Preview" })}
                              </span>
                              <strong>{draft.tokenPreview}</strong>
                            </div>
                            {draft.updatedAt ? (
                              <div className="runtime-inline-meta__entry">
                                <span>
                                  {i18n._({
                                    id: "Updated",
                                    message: "Updated",
                                  })}
                                </span>
                                <strong>
                                  {formatLocaleDateTime(draft.updatedAt)}
                                </strong>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {draft.id &&
                        draft.tokenPreview &&
                        !draft.token.trim() ? (
                          <InlineNotice
                            title={i18n._({
                              id: "Saved tokens cannot be copied again",
                              message: "Saved tokens cannot be copied again",
                            })}
                          >
                            {i18n._({
                              id: "After you save, this page keeps only a masked preview and the backend stores only the token hash. To issue it again, generate a replacement token and copy it before saving.",
                              message:
                                "After you save, this page keeps only a masked preview and the backend stores only the token hash. To issue it again, generate a replacement token and copy it before saving.",
                            })}
                          </InlineNotice>
                        ) : null}

                        <div
                          className="form-row"
                          style={{ gridTemplateColumns: "1fr 1fr" }}
                        >
                          <Input
                            label={i18n._({ id: "Label", message: "Label" })}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setAccessTokenDrafts((current) =>
                                current.map((entry, tokenIndex) =>
                                  tokenIndex === index
                                    ? { ...entry, label: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder={i18n._({
                              id: "Admin laptop",
                              message: "Admin laptop",
                            })}
                            value={draft.label}
                          />

                          <Input
                            hint={
                              draft.id
                                ? i18n._({
                                    id: "Leave blank to keep the current token value. Enter a new value to rotate it.",
                                    message:
                                      "Leave blank to keep the current token value. Enter a new value to rotate it.",
                                  })
                                : i18n._({
                                    id: "Required when creating a new token.",
                                    message:
                                      "Required when creating a new token.",
                                  })
                            }
                            label={i18n._({
                              id: "Token Value",
                              message: "Token Value",
                            })}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setAccessTokenDrafts((current) =>
                                current.map((entry, tokenIndex) =>
                                  tokenIndex === index
                                    ? { ...entry, token: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder={i18n._({
                              id: "Paste new token",
                              message: "Paste new token",
                            })}
                            ref={(node) => {
                              accessTokenInputRefs.current[index] = node;
                            }}
                            type={draft.revealToken ? "text" : "password"}
                            value={draft.token}
                          />
                        </div>

                        <div className="setting-row__actions">
                          <button
                            className="ide-button ide-button--secondary ide-button--sm"
                            onClick={() => generateAccessTokenDraft(index)}
                            type="button"
                          >
                            {draft.token.trim()
                              ? i18n._({
                                  id: "Regenerate Token",
                                  message: "Regenerate Token",
                                })
                              : draft.id
                                ? i18n._({
                                    id: "Generate Replacement",
                                    message: "Generate Replacement",
                                  })
                                : i18n._({
                                    id: "Generate Secure Token",
                                    message: "Generate Secure Token",
                                  })}
                          </button>
                          {draft.token.trim() ? (
                            <button
                              className="ide-button ide-button--secondary ide-button--sm"
                              onClick={() =>
                                setAccessTokenDrafts((current) =>
                                  current.map((entry, tokenIndex) =>
                                    tokenIndex === index
                                      ? {
                                          ...entry,
                                          revealToken: !entry.revealToken,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                              type="button"
                            >
                              {draft.revealToken
                                ? i18n._({
                                    id: "Hide Token",
                                    message: "Hide Token",
                                  })
                                : i18n._({
                                    id: "Show Token",
                                    message: "Show Token",
                                  })}
                            </button>
                          ) : null}
                        </div>

                        {draft.token.trim() ? (
                          <InlineNotice
                            action={
                              <button
                                className="ide-button ide-button--secondary ide-button--sm"
                                onClick={() =>
                                  void handleCopyAccessToken(draft.token, index)
                                }
                                type="button"
                              >
                                {i18n._({
                                  id: "Copy Token",
                                  message: "Copy Token",
                                })}
                              </button>
                            }
                            title={i18n._({
                              id: "Store this token now",
                              message: "Store this token now",
                            })}
                          >
                            {i18n._({
                              id: "Access token values are only shown while you are editing them. After you save, this page keeps only a masked preview, so copy the raw value before saving.",
                              message:
                                "Access token values are only shown while you are editing them. After you save, this page keeps only a masked preview, so copy the raw value before saving.",
                            })}
                          </InlineNotice>
                        ) : null}

                        <Switch
                          checked={draft.permanent}
                          hint={i18n._({
                            id: "Disable this to enforce an expiry time. Once expired, the token no longer grants frontend access.",
                            message:
                              "Disable this to enforce an expiry time. Once expired, the token no longer grants frontend access.",
                          })}
                          label={i18n._({
                            id: "Permanent Token",
                            message: "Permanent Token",
                          })}
                          onChange={(event) =>
                            setAccessTokenDrafts((current) =>
                              current.map((entry, tokenIndex) =>
                                tokenIndex === index
                                  ? {
                                      ...entry,
                                      permanent: event.target.checked,
                                      expiresAt: event.target.checked
                                        ? ""
                                        : entry.expiresAt,
                                    }
                                  : entry,
                              ),
                            )
                          }
                        />

                        {!draft.permanent ? (
                          <Input
                            label={i18n._({
                              id: "Expires At",
                              message: "Expires At",
                            })}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setAccessTokenDrafts((current) =>
                                current.map((entry, tokenIndex) =>
                                  tokenIndex === index
                                    ? {
                                        ...entry,
                                        expiresAt: event.target.value,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            type="datetime-local"
                            value={draft.expiresAt}
                          />
                        ) : null}

                        {draft.createdAt ? (
                          <p className="config-inline-note">
                            {i18n._({
                              id: "Created: {createdAt}",
                              message: "Created: {createdAt}",
                              values: {
                                createdAt: formatLocaleDateTime(
                                  draft.createdAt,
                                ),
                              },
                            })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </form>

              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  submitRuntimePreferences(undefined, {
                    backendThreadTraceSource: "configured",
                  });
                }}
              >
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Shell & Execution Configuration",
                      message: "Shell & Execution Configuration",
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={writeRuntimePreferencesMutation.isPending}
                      onClick={() =>
                        submitRuntimePreferences(
                          {
                            defaultShellType: "",
                            defaultTerminalShell: "",
                            modelShellTypeOverrides: {},
                          },
                          {
                            backendThreadTraceSource: "configured",
                          },
                        )
                      }
                      type="button"
                    >
                      {i18n._({
                        id: "Reset Shell Overrides",
                        message: "Reset Shell Overrides",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={writeRuntimePreferencesMutation.isPending}
                      onClick={() =>
                        submitRuntimePreferences(
                          {
                            outboundProxyUrl: "",
                          },
                          {
                            backendThreadTraceSource: "configured",
                          },
                        )
                      }
                      type="button"
                    >
                      {i18n._({
                        id: "Reset Proxy",
                        message: "Reset Proxy",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={writeRuntimePreferencesMutation.isPending}
                      onClick={() =>
                        submitRuntimePreferences(
                          {
                            defaultTurnApprovalPolicy: "",
                            defaultTurnSandboxPolicy: {},
                            defaultCommandSandboxPolicy: {},
                          },
                          {
                            backendThreadTraceSource: "configured",
                          },
                        )
                      }
                      type="button"
                    >
                      {i18n._({
                        id: "Reset Execution Defaults",
                        message: "Reset Execution Defaults",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      type="submit"
                    >
                      {writeRuntimePreferencesMutation.isPending
                        ? i18n._({ id: "Applying…", message: "Applying…" })
                        : i18n._({
                            id: "Apply Changes",
                            message: "Apply Changes",
                          })}
                    </button>
                  </div>
                </div>

                <div className="form-stack">
                  <p className="config-inline-note">
                    {i18n._({
                      id: "Path to the full model catalog JSON file. codex-server uses this file as the source when it needs to rewrite shell_type metadata.",
                      message:
                        "Path to the full model catalog JSON file. codex-server uses this file as the source when it needs to rewrite shell_type metadata.",
                    })}
                  </p>

                  <div
                    className="form-row"
                    style={{ gridTemplateColumns: "1fr 200px 220px" }}
                  >
                    <div className="field-group">
                      <div className="input-with-action">
                        <Input
                          label={i18n._({
                            id: "Catalog Path",
                            message: "Catalog Path",
                          })}
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            setModelCatalogPath(event.target.value)
                          }
                          placeholder={
                            runtimePreferencesQuery.data
                              ?.defaultModelCatalogPath ||
                            "E:/path/to/models.json"
                          }
                          value={modelCatalogPath}
                        />
                        <div className="input-action-floating">
                          <button
                            className="ide-button ide-button--secondary ide-button--sm"
                            onClick={() => importModelCatalogMutation.mutate()}
                            type="button"
                            title={i18n._({
                              id: "Load template",
                              message: "Load template",
                            })}
                          >
                            {i18n._({ id: "Template", message: "Template" })}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="field">
                      <label className="field-label">
                        {i18n._({ id: "Shell Type", message: "Shell Type" })}
                      </label>
                      <SelectControl
                        ariaLabel={i18n._({
                          id: "Default shell type",
                          message: "Default shell type",
                        })}
                        fullWidth
                        onChange={setDefaultShellType}
                        options={shellTypeOptions}
                        value={defaultShellType}
                      />
                    </div>

                    <div className="field">
                      <label className="field-label">
                        {i18n._({
                          id: "Terminal Shell",
                          message: "Terminal Shell",
                        })}
                      </label>
                      <SelectControl
                        ariaLabel={i18n._({
                          id: "Default terminal shell",
                          message: "Default terminal shell",
                        })}
                        fullWidth
                        onChange={setDefaultTerminalShell}
                        options={terminalShellOptions}
                        value={defaultTerminalShell}
                      />
                    </div>
                  </div>

                  <p className="config-inline-note">
                    {i18n._({
                      id: "Choose which backend shell opens when you start a terminal session. Availability depends on the backend machine and PATH.",
                      message:
                        "Choose which backend shell opens when you start a terminal session. Availability depends on the backend machine and PATH.",
                    })}
                  </p>

                  <Input
                    hint={i18n._({
                      id: "Optional global outbound proxy for Telegram and OpenAI requests. Supports http://127.0.0.1:7890 and socks5://127.0.0.1:1080. Leave blank to fall back to CODEX_SERVER_OUTBOUND_PROXY and then standard HTTP_PROXY/HTTPS_PROXY/ALL_PROXY handling. Proxy credentials embedded in the URL are stored in local codex-server metadata.",
                      message:
                        "Optional global outbound proxy for Telegram and OpenAI requests. Supports http://127.0.0.1:7890 and socks5://127.0.0.1:1080. Leave blank to fall back to CODEX_SERVER_OUTBOUND_PROXY and then standard HTTP_PROXY/HTTPS_PROXY/ALL_PROXY handling. Proxy credentials embedded in the URL are stored in local codex-server metadata.",
                    })}
                    label={i18n._({
                      id: "Outbound Proxy URL",
                      message: "Outbound Proxy URL",
                    })}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setOutboundProxyUrl(event.target.value)
                    }
                    placeholder={
                      runtimePreferencesQuery.data?.defaultOutboundProxyUrl ||
                      "http://127.0.0.1:7890"
                    }
                    value={outboundProxyUrl}
                  />

                  <p className="config-inline-note">
                    {i18n._({
                      id: "Default policies for automated turns and manual command execution. Leave blank to follow runtime defaults.",
                      message:
                        "Default policies for automated turns and manual command execution. Leave blank to follow runtime defaults.",
                    })}
                  </p>

                  <div
                    className="form-row"
                    style={{ gridTemplateColumns: "1fr 1fr" }}
                  >
                    <div className="field">
                      <label className="field-label">
                        {i18n._({
                          id: "Approval Policy",
                          message: "Approval Policy",
                        })}
                      </label>
                      <SelectControl
                        ariaLabel={i18n._({
                          id: "Default turn approval policy",
                          message: "Default turn approval policy",
                        })}
                        fullWidth
                        onChange={setDefaultTurnApprovalPolicy}
                        options={approvalPolicyOptions}
                        value={defaultTurnApprovalPolicy}
                      />
                    </div>
                  </div>

                  <div
                    className="form-row"
                    style={{ gridTemplateColumns: "1fr 1fr" }}
                  >
                    <TextArea
                      label={i18n._({
                        id: "Turn Sandbox (JSON)",
                        message: "Turn Sandbox (JSON)",
                      })}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        setDefaultTurnSandboxPolicyInput(event.target.value)
                      }
                      placeholder='{"type":"dangerFullAccess"}'
                      rows={4}
                      value={defaultTurnSandboxPolicyInput}
                    />

                    <TextArea
                      label={i18n._({
                        id: "Command Sandbox (JSON)",
                        message: "Command Sandbox (JSON)",
                      })}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        setDefaultCommandSandboxPolicyInput(event.target.value)
                      }
                      placeholder='{"type":"dangerFullAccess"}'
                      rows={4}
                      value={defaultCommandSandboxPolicyInput}
                    />
                  </div>

                  <TextArea
                    label={i18n._({
                      id: "Model Shell Type Overrides (JSON)",
                      message: "Model Shell Type Overrides (JSON)",
                    })}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setModelShellTypeOverridesInput(event.target.value)
                    }
                    placeholder="{}"
                    rows={4}
                    value={modelShellTypeOverridesInput}
                  />
                </div>
              </form>

              <div className="config-card">
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Status & Inspection",
                      message: "Status & Inspection",
                    })}
                  </strong>
                </div>
                {runtimePreferencesQuery.data ? (
                  <Tabs
                    ariaLabel={i18n._({
                      id: "Runtime inspection tabs",
                      message: "Runtime inspection tabs",
                    })}
                    className="config-workbench__panel"
                    storageKey="settings-config-runtime-side-tabs"
                    items={[
                      {
                        id: "effective",
                        label: i18n._({
                          id: "Effective",
                          message: "Effective",
                        }),
                        icon: <TerminalIcon />,
                        content: (
                          <SettingsJsonPreview
                            description={i18n._({
                              id: "Current resolved runtime state.",
                              message: "Current resolved runtime state.",
                            })}
                            title={i18n._({
                              id: "Effective Values",
                              message: "Effective Values",
                            })}
                            value={{
                              modelCatalogPath:
                                runtimePreferencesQuery.data
                                  .effectiveModelCatalogPath,
                              defaultShellType:
                                runtimePreferencesQuery.data
                                  .effectiveDefaultShellType,
                              defaultTerminalShell:
                                runtimePreferencesQuery.data
                                  .effectiveDefaultTerminalShell,
                              modelShellTypeOverrides:
                                runtimePreferencesQuery.data
                                  .effectiveModelShellTypeOverrides,
                              outboundProxyUrl:
                                runtimePreferencesQuery.data
                                  .effectiveOutboundProxyUrl,
                              defaultTurnApprovalPolicy:
                                runtimePreferencesQuery.data
                                  .effectiveDefaultTurnApprovalPolicy,
                              defaultTurnSandboxPolicy:
                                runtimePreferencesQuery.data
                                  .effectiveDefaultTurnSandboxPolicy,
                              defaultCommandSandboxPolicy:
                                runtimePreferencesQuery.data
                                  .effectiveDefaultCommandSandboxPolicy,
                              allowRemoteAccess:
                                runtimePreferencesQuery.data
                                  .effectiveAllowRemoteAccess,
                              allowLocalhostWithoutAccessToken:
                                runtimePreferencesQuery.data
                                  .effectiveAllowLocalhostWithoutAccessToken,
                              accessTokens:
                                runtimePreferencesQuery.data
                                  .configuredAccessTokens,
                              backendThreadTrace: {
                                enabled:
                                  runtimePreferencesQuery.data
                                    .effectiveBackendThreadTraceEnabled,
                                workspaceId:
                                  runtimePreferencesQuery.data
                                    .effectiveBackendThreadTraceWorkspaceId,
                                threadId:
                                  runtimePreferencesQuery.data
                                    .effectiveBackendThreadTraceThreadId,
                              },
                              command:
                                runtimePreferencesQuery.data.effectiveCommand,
                            }}
                          />
                        ),
                      },
                      {
                        id: "configured",
                        label: i18n._({
                          id: "Configured",
                          message: "Configured",
                        }),
                        icon: <ContextIcon />,
                        content: (
                          <SettingsJsonPreview
                            description={i18n._({
                              id: "Values saved in codex-server database.",
                              message: "Values saved in codex-server database.",
                            })}
                            title={i18n._({
                              id: "Saved Values",
                              message: "Saved Values",
                            })}
                            value={{
                              modelCatalogPath:
                                runtimePreferencesQuery.data
                                  .configuredModelCatalogPath,
                              defaultShellType:
                                runtimePreferencesQuery.data
                                  .configuredDefaultShellType,
                              defaultTerminalShell:
                                runtimePreferencesQuery.data
                                  .configuredDefaultTerminalShell,
                              modelShellTypeOverrides:
                                runtimePreferencesQuery.data
                                  .configuredModelShellTypeOverrides,
                              outboundProxyUrl:
                                runtimePreferencesQuery.data
                                  .configuredOutboundProxyUrl,
                              defaultTurnApprovalPolicy:
                                runtimePreferencesQuery.data
                                  .configuredDefaultTurnApprovalPolicy,
                              defaultTurnSandboxPolicy:
                                runtimePreferencesQuery.data
                                  .configuredDefaultTurnSandboxPolicy,
                              defaultCommandSandboxPolicy:
                                runtimePreferencesQuery.data
                                  .configuredDefaultCommandSandboxPolicy,
                              allowRemoteAccess:
                                runtimePreferencesQuery.data
                                  .configuredAllowRemoteAccess,
                              allowLocalhostWithoutAccessToken:
                                runtimePreferencesQuery.data
                                  .configuredAllowLocalhostWithoutAccessToken,
                              accessTokens:
                                runtimePreferencesQuery.data
                                  .configuredAccessTokens,
                              backendThreadTrace: {
                                enabled:
                                  runtimePreferencesQuery.data
                                    .configuredBackendThreadTraceEnabled,
                                workspaceId:
                                  runtimePreferencesQuery.data
                                    .configuredBackendThreadTraceWorkspaceId,
                                threadId:
                                  runtimePreferencesQuery.data
                                    .configuredBackendThreadTraceThreadId,
                              },
                            }}
                          />
                        ),
                      },
                      {
                        id: "runtime-state",
                        label: i18n._({
                          id: "Runtime State",
                          message: "Runtime State",
                        }),
                        icon: <RefreshIcon />,
                        content: workspaceRuntimeStateQuery.isLoading ? (
                          <div className="notice">
                            {i18n._({
                              id: "Loading runtime state…",
                              message: "Loading runtime state…",
                            })}
                          </div>
                        ) : workspaceRuntimeStateQuery.data ? (
                          <div className="form-stack">
                            <div className="mode-metrics">
                              <div className="mode-metric">
                                <span>
                                  {i18n._({ id: "Status", message: "Status" })}
                                </span>
                                <strong>
                                  {formatLocalizedStatusLabel(
                                    workspaceRuntimeStateQuery.data.status,
                                  )}
                                </strong>
                              </div>
                              <div className="mode-metric">
                                <span>
                                  {i18n._({
                                    id: "Config Load",
                                    message: "Config Load",
                                  })}
                                </span>
                                <strong>
                                  {formatLocalizedStatusLabel(
                                    workspaceRuntimeStateQuery.data
                                      .configLoadStatus,
                                  )}
                                </strong>
                              </div>
                              <div className="mode-metric">
                                <span>
                                  {i18n._({
                                    id: "Restart Required",
                                    message: "Restart Required",
                                  })}
                                </span>
                                <strong>
                                  {workspaceRuntimeStateQuery.data
                                    .restartRequired
                                    ? i18n._({ id: "Yes", message: "Yes" })
                                    : i18n._({ id: "No", message: "No" })}
                                </strong>
                              </div>
                            </div>
                            {runtimeRecoverySummary ? (
                              <InlineNotice
                                action={RuntimeRecoveryActionGroup({
                                  configSettingsPath: "/settings/config",
                                  environmentSettingsPath:
                                    "/settings/environment",
                                  onRestartRuntime: workspaceId
                                    ? () => restartRuntimeMutation.mutate()
                                    : undefined,
                                  restartRuntimePending:
                                    restartRuntimeMutation.isPending,
                                  summary: runtimeRecoverySummary,
                                })}
                                details={runtimeRecoverySummary.details}
                                noticeKey={`runtime-recovery-${workspaceId}-${workspaceRuntimeStateQuery.data.updatedAt}-${workspaceRuntimeStateQuery.data.lastErrorCategory ?? ""}-${workspaceRuntimeStateQuery.data.lastErrorRecoveryAction ?? ""}-${workspaceRuntimeStateQuery.data.lastError ?? ""}`}
                                title={runtimeRecoverySummary.title}
                                tone={runtimeRecoverySummary.tone}
                              >
                                <RuntimeRecoveryNoticeContent summary={runtimeRecoverySummary} />
                              </InlineNotice>
                            ) : null}
                            {runtimeRecoverySummary ? (
                              <div className="config-helper-grid config-helper-grid--compact">
                                <ConfigHelperCard
                                  description={runtimeRecoverySummary.actionSummary}
                                  title={i18n._({
                                    id: "Next Step",
                                    message: "Next Step",
                                  })}
                                />
                                <ConfigHelperCard
                                  description={
                                    runtimeRecoverySummary.categoryLabel
                                  }
                                  title={i18n._({
                                    id: "Error Category",
                                    message: "Error Category",
                                  })}
                                />
                                <ConfigHelperCard
                                  description={
                                    runtimeRecoverySummary.recoveryActionLabel
                                  }
                                  title={i18n._({
                                    id: "Recovery Action",
                                    message: "Recovery Action",
                                  })}
                                />
                                <ConfigHelperCard
                                  description={
                                    runtimeRecoverySummary.retryableLabel
                                  }
                                  title={i18n._({
                                    id: "Retryable",
                                    message: "Retryable",
                                  })}
                                />
                                <ConfigHelperCard
                                  description={
                                    runtimeRecoverySummary.recycleLabel
                                  }
                                  title={i18n._({
                                    id: "Needs Recycle",
                                    message: "Needs Recycle",
                                  })}
                                />
                              </div>
                            ) : null}
                            <div className="config-helper-grid config-helper-grid--compact">
                              <ConfigHelperCard
                                description={
                                  workspaceRuntimeStateQuery.data.startedAt
                                    ? formatLocaleDateTime(
                                        workspaceRuntimeStateQuery.data
                                          .startedAt,
                                      )
                                    : i18n._({
                                        id: "Not started",
                                        message: "Not started",
                                      })
                                }
                                title={i18n._({
                                  id: "Started",
                                  message: "Started",
                                })}
                              />
                              <ConfigHelperCard
                                description={formatLocaleDateTime(
                                  workspaceRuntimeStateQuery.data.updatedAt,
                                )}
                                title={i18n._({
                                  id: "Updated",
                                  message: "Updated",
                                })}
                              />
                              <ConfigHelperCard
                                description={
                                  workspaceRuntimeStateQuery.data.command || "—"
                                }
                                title={i18n._({
                                  id: "Command",
                                  message: "Command",
                                })}
                              />
                            </div>
                            <SettingsJsonPreview
                              description={i18n._({
                                id: "Observed runtime process state and config load status for the selected workspace.",
                                message:
                                  "Observed runtime process state and config load status for the selected workspace.",
                              })}
                              title={i18n._({
                                id: "Runtime Process State",
                                message: "Runtime Process State",
                              })}
                              value={workspaceRuntimeStateQuery.data}
                            />
                          </div>
                        ) : (
                          <div className="empty-state">
                            {i18n._({
                              id: "Runtime state is unavailable for the selected workspace.",
                              message:
                                "Runtime state is unavailable for the selected workspace.",
                            })}
                          </div>
                        ),
                      },
                    ]}
                  />
                ) : (
                  <div className="notice">
                    {i18n._({
                      id: "Loading runtime preferences…",
                      message: "Loading runtime preferences…",
                    })}
                  </div>
                )}
              </div>

              <details className="config-details-box">
                <ConfigDetailsSummary
                  description={i18n._({
                    id: "Which shell type should you choose?",
                    message: "Which shell type should you choose?",
                  })}
                  title={i18n._({
                    id: "Strategy Guide",
                    message: "Strategy Guide",
                  })}
                />
                <div className="config-details-box__content">
                  <div className="config-helper-grid config-helper-grid--compact">
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Standard local execution.",
                        message: "Standard local execution.",
                      })}
                      title={formatShellTypeLabel("local")}
                    />
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Streaming output + stdin.",
                        message: "Streaming output + stdin.",
                      })}
                      title={formatShellTypeLabel("unified_exec")}
                    />
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Script string wrapper.",
                        message: "Script string wrapper.",
                      })}
                      title={formatShellTypeLabel("shell_command")}
                    />
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Upstream catalog values.",
                        message: "Upstream catalog values.",
                      })}
                      title={formatShellTypeLabel("default")}
                    />
                  </div>
                </div>
              </details>

              <details className="config-details-box">
                <ConfigDetailsSummary
                  description={i18n._({
                    id: "`sandboxPolicy` controls sandboxing, not `shell_type`",
                    message:
                      "`sandboxPolicy` controls sandboxing, not `shell_type`",
                  })}
                  title={i18n._({
                    id: "Execution Guide",
                    message: "Execution Guide",
                  })}
                />
                <div className="config-details-box__content">
                  <div className="config-helper-grid config-helper-grid--compact">
                    <ConfigHelperCard
                      description='{"type":"dangerFullAccess"}'
                      title={formatSandboxPolicyLabel({
                        type: "dangerFullAccess",
                      })}
                    />
                    <ConfigHelperCard
                      description='{"type":"externalSandbox","networkAccess":"enabled"}'
                      title={formatSandboxPolicyLabel({
                        type: "externalSandbox",
                      })}
                    />
                    <ConfigHelperCard
                      description='{"type":"workspaceWrite","networkAccess":true}'
                      title={formatSandboxPolicyLabel({
                        type: "workspaceWrite",
                      })}
                    />
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Use `never` together with `dangerFullAccess` when you want a fully unsandboxed, no-approval turn.",
                        message:
                          "Use `never` together with `dangerFullAccess` when you want a fully unsandboxed, no-approval turn.",
                      })}
                      title={i18n._({ id: "Approval", message: "Approval" })}
                    />
                  </div>
                  <div
                    className="setting-row__actions"
                    style={{ marginTop: 12 }}
                  >
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => applyExecutionPreset("danger-full-access")}
                      type="button"
                    >
                      {i18n._({
                        id: "Load DangerFullAccess",
                        message: "Load DangerFullAccess",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => applyExecutionPreset("external-sandbox")}
                      type="button"
                    >
                      {i18n._({
                        id: "Load ExternalSandbox",
                        message: "Load ExternalSandbox",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => applyExecutionPreset("inherit")}
                      type="button"
                    >
                      {i18n._({
                        id: "Clear Execution Preset",
                        message: "Clear Execution Preset",
                      })}
                    </button>
                  </div>
                </div>
              </details>

              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  if (workspaceId) {
                    writeShellEnvironmentPolicyMutation.mutate();
                  }
                }}
              >
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Shell Environment Policy",
                      message: "Shell Environment Policy",
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() =>
                        applyShellEnvironmentPolicyPreset("inherit-all")
                      }
                      type="button"
                    >
                      {i18n._({
                        id: "Load inherit=all",
                        message: "Load inherit=all",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() =>
                        applyShellEnvironmentPolicyPreset(
                          "inherit-core-windows",
                        )
                      }
                      type="button"
                    >
                      {i18n._({
                        id: "Load core+Windows",
                        message: "Load core+Windows",
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => applyShellEnvironmentPolicyPreset("clear")}
                      type="button"
                    >
                      {i18n._({ id: "Clear", message: "Clear" })}
                    </button>
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      disabled={!workspaceId}
                      type="submit"
                    >
                      {writeShellEnvironmentPolicyMutation.isPending
                        ? i18n._({ id: "Saving…", message: "Saving…" })
                        : i18n._({ id: "Save Policy", message: "Save Policy" })}
                    </button>
                  </div>
                </div>
                <div className="form-stack">
                  <p className="config-inline-note">
                    {i18n._({
                      id: "`codex-server` does not override `shell_environment_policy` when launching app-server. This writes the Codex config value directly, so it affects `shell`, `unified_exec`, `command/exec`, and `thread/shellCommand`.",
                      message:
                        "`codex-server` does not override `shell_environment_policy` when launching app-server. This writes the Codex config value directly, so it affects `shell`, `unified_exec`, `command/exec`, and `thread/shellCommand`.",
                    })}
                  </p>
                  <p className="config-inline-note">
                    {i18n._({
                      id: 'On Windows, `inherit = "core"` can break command resolution unless you also restore variables like `PATHEXT`, `SystemRoot`, and `ComSpec`.',
                      message:
                        'On Windows, `inherit = "core"` can break command resolution unless you also restore variables like `PATHEXT`, `SystemRoot`, and `ComSpec`.',
                    })}
                  </p>
                  <TextArea
                    label={i18n._({
                      id: "Policy (JSON)",
                      message: "Policy (JSON)",
                    })}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setShellEnvironmentPolicyInput(event.target.value)
                    }
                    placeholder='{"inherit":"all"}'
                    rows={8}
                    value={shellEnvironmentPolicyInput}
                  />
                </div>
              </form>

              {writeShellEnvironmentPolicyMutation.error && (
                <InlineNotice
                  details={getErrorMessage(
                    writeShellEnvironmentPolicyMutation.error,
                  )}
                  dismissible
                  noticeKey="shell-environment-policy-write-error"
                  title={i18n._({
                    id: "Shell Environment Policy Update Failed",
                    message: "Shell Environment Policy Update Failed",
                  })}
                  tone="error"
                >
                  {getErrorMessage(writeShellEnvironmentPolicyMutation.error)}
                </InlineNotice>
              )}

              {writeRuntimePreferencesMutation.error && (
                <InlineNotice
                  details={getErrorMessage(
                    writeRuntimePreferencesMutation.error,
                  )}
                  dismissible
                  noticeKey="runtime-write-error"
                  title={i18n._({
                    id: "Update Failed",
                    message: "Update Failed",
                  })}
                  tone="error"
                >
                  {getErrorMessage(writeRuntimePreferencesMutation.error)}
                </InlineNotice>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "advanced",
      label: i18n._({ id: "Advanced", message: "Advanced" }),
      icon: <TerminalIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  if (workspaceId) {
                    writeConfigMutation.mutate();
                  }
                }}
              >
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Direct JSON Write",
                      message: "Direct JSON Write",
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={
                        !workspaceId || restartRuntimeMutation.isPending
                      }
                      onClick={() => restartRuntimeMutation.mutate()}
                      type="button"
                    >
                      {restartRuntimeMutation.isPending
                        ? i18n._({ id: "Restarting…", message: "Restarting…" })
                        : i18n._({
                            id: "Restart Runtime",
                            message: "Restart Runtime",
                          })}
                    </button>
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      disabled={!workspaceId}
                      type="submit"
                    >
                      {writeConfigMutation.isPending
                        ? i18n._({ id: "Writing…", message: "Writing…" })
                        : i18n._({ id: "Write Key", message: "Write Key" })}
                    </button>
                  </div>
                </div>
                <div className="form-stack">
                  <Input
                    label={i18n._({ id: "Key Path", message: "Key Path" })}
                    onChange={(event) => setConfigKeyPath(event.target.value)}
                    value={configKeyPath}
                  />
                  {suggestedConfigTemplate ? (
                    <div className="config-card config-card--muted">
                      <div className="config-card__header">
                        <strong>{suggestedConfigTemplate.title}</strong>
                        <button
                          className="ide-button ide-button--secondary ide-button--sm"
                          onClick={() =>
                            setConfigValue(
                              JSON.stringify(
                                suggestedConfigTemplate.value,
                                null,
                                2,
                              ),
                            )
                          }
                          type="button"
                        >
                          {i18n._({
                            id: "Load Example",
                            message: "Load Example",
                          })}
                        </button>
                      </div>
                      <p className="config-inline-note">
                        {suggestedConfigTemplate.description}
                      </p>
                      <SettingsJsonPreview
                        collapsible={false}
                        description={i18n._({
                          id: "Suggested JSON payload for the current key path.",
                          message:
                            "Suggested JSON payload for the current key path.",
                        })}
                        title={i18n._({
                          id: "Suggested Template",
                          message: "Suggested Template",
                        })}
                        value={suggestedConfigTemplate.value}
                      />
                    </div>
                  ) : null}
                  {directWriteRequiresRestart ? (
                    <InlineNotice
                      noticeKey={`runtime-sensitive-key-${configKeyPath}`}
                      title={i18n._({
                        id: "Runtime Restart Likely Required",
                        message: "Runtime Restart Likely Required",
                      })}
                    >
                      {directWriteRuntimeSensitiveItem
                        ? i18n._({
                            id: "Key path {keyPath} matches runtime-sensitive prefix {matchedKey}. {description} Saving it will mark the workspace runtime as potentially stale until restart.",
                            message:
                              "Key path {keyPath} matches runtime-sensitive prefix {matchedKey}. {description} Saving it will mark the workspace runtime as potentially stale until restart.",
                            values: {
                              keyPath: configKeyPath,
                              matchedKey:
                                directWriteRuntimeSensitiveItem.keyPath,
                              description:
                                directWriteRuntimeSensitiveItem.description,
                            },
                          })
                        : null}
                    </InlineNotice>
                  ) : null}
                  <TextArea
                    label={i18n._({
                      id: "Value (JSON)",
                      message: "Value (JSON)",
                    })}
                    onChange={(event) => setConfigValue(event.target.value)}
                    rows={4}
                    value={configValue}
                  />
                </div>

                <div
                  className="config-details-box"
                  style={{ marginTop: "20px" }}
                >
                  <div className="config-card__header">
                    <strong>
                      {i18n._({
                        id: "Current Config Analysis",
                        message: "Current Config Analysis",
                      })}
                    </strong>
                  </div>
                  {configQuery.isLoading ? (
                    <div className="notice">
                      {i18n._({
                        id: "Loading configuration…",
                        message: "Loading configuration…",
                      })}
                    </div>
                  ) : configQuery.data ? (
                    <SettingsJsonPreview
                      collapsible
                      defaultExpanded={false}
                      description={i18n._({
                        id: "Final merged configuration including all layers.",
                        message:
                          "Final merged configuration including all layers.",
                      })}
                      title={i18n._({
                        id: "Effective Config",
                        message: "Effective Config",
                      })}
                      value={configQuery.data.config}
                    />
                  ) : (
                    <div className="empty-state">
                      {i18n._({
                        id: "Configuration data is unavailable.",
                        message: "Configuration data is unavailable.",
                      })}
                    </div>
                  )}
                </div>
              </form>

              <div className="config-details-box">
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Write Categories",
                      message: "Write Categories",
                    })}
                  </strong>
                </div>
                <div className="form-stack">
                  <p className="config-inline-note">
                    {i18n._({
                      id: "Runtime-sensitive keys typically require a runtime restart after write. Immediate/UI keys usually take effect without restarting the app-server process.",
                      message:
                        "Runtime-sensitive keys typically require a runtime restart after write. Immediate/UI keys usually take effect without restarting the app-server process.",
                    })}
                  </p>
                  <div className="config-helper-grid config-helper-grid--compact">
                    {runtimeSensitiveConfigItems.slice(0, 6).map((item) => (
                      <ConfigHelperCard
                        description={item.description}
                        key={item.keyPath}
                        title={item.keyPath}
                      />
                    ))}
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Example of a non-runtime-sensitive key path. This type of config does not usually require runtime restart.",
                        message:
                          "Example of a non-runtime-sensitive key path. This type of config does not usually require runtime restart.",
                      })}
                      title="ui.theme"
                    />
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Another non-runtime-sensitive example for local UI or product behavior toggles.",
                        message:
                          "Another non-runtime-sensitive example for local UI or product behavior toggles.",
                      })}
                      title="notifications.enabled"
                    />
                  </div>
                </div>
              </div>

              <div className="config-details-box">
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Scenario Presets & Requirements",
                      message: "Scenario Presets & Requirements",
                    })}
                  </strong>
                </div>
                <p className="config-inline-note">
                  {bestMatchingAdvancedScenario
                    ? i18n._({
                        id: 'Current config is closest to scenario "{title}" ({matched}/{total} edits matched).',
                        message:
                          'Current config is closest to scenario "{title}" ({matched}/{total} edits matched).',
                        values: {
                          title: bestMatchingAdvancedScenario.scenario.title,
                          matched:
                            bestMatchingAdvancedScenario.matchedEditCount,
                          total: bestMatchingAdvancedScenario.totalEditCount,
                        },
                      })
                    : i18n._({
                        id: "Current config does not closely match any built-in scenario preset.",
                        message:
                          "Current config does not closely match any built-in scenario preset.",
                      })}
                </p>
                <Tabs
                  ariaLabel={i18n._({
                    id: "Scenario preset and requirement tabs",
                    message: "Scenario preset and requirement tabs",
                  })}
                  className="config-scenario-tabs"
                  defaultValue={scenarioPresetDefaultTabId}
                  items={[
                    ...scenarioPresetTabItems,
                    {
                      id: "requirements",
                      label: i18n._({
                        id: "Requirements",
                        message: "Requirements",
                      }),
                      icon: <FeedIcon />,
                      content: (
                        <div className="config-card config-card--muted config-scenario-panel">
                          <div className="config-card__header">
                            <strong>
                              {i18n._({
                                id: "Runtime Requirements",
                                message: "Runtime Requirements",
                              })}
                            </strong>
                          </div>
                          {requirementsQuery.data ? (
                            <SettingsJsonPreview
                              collapsible={false}
                              description={i18n._({
                                id: "Validation status and requirements.",
                                message: "Validation status and requirements.",
                              })}
                              title={i18n._({
                                id: "Requirements",
                                message: "Requirements",
                              })}
                              value={
                                requirementsQuery.data.requirements ?? null
                              }
                            />
                          ) : (
                            <div className="empty-state">
                              {i18n._({
                                id: "No requirements payload returned.",
                                message: "No requirements payload returned.",
                              })}
                            </div>
                          )}
                        </div>
                      ),
                    },
                  ]}
                  storageKey="settings-config-advanced-scenario-tabs"
                />
              </div>

              {writeConfigMutation.error && (
                <InlineNotice
                  details={getErrorMessage(writeConfigMutation.error)}
                  dismissible
                  noticeKey="write-config-error"
                  title={i18n._({
                    id: "Write Failed",
                    message: "Write Failed",
                  })}
                  tone="error"
                >
                  {getErrorMessage(writeConfigMutation.error)}
                </InlineNotice>
              )}
              {applyConfigScenarioMutation.error && (
                <InlineNotice
                  details={getErrorMessage(applyConfigScenarioMutation.error)}
                  dismissible
                  noticeKey="apply-config-scenario-error"
                  title={i18n._({
                    id: "Scenario Apply Failed",
                    message: "Scenario Apply Failed",
                  })}
                  tone="error"
                >
                  {getErrorMessage(applyConfigScenarioMutation.error)}
                </InlineNotice>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "migration",
      label: i18n._({ id: "Migration", message: "Migration" }),
      icon: <RefreshIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <div className="config-card">
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Migration Console",
                      message: "Migration Console",
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      disabled={!workspaceId}
                      onClick={() => detectExternalMutation.mutate()}
                      type="button"
                    >
                      {i18n._({ id: "Scan", message: "Scan" })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={
                        !workspaceId ||
                        importExternalMutation.isPending ||
                        !detectExternalMutation.data?.items?.length
                      }
                      onClick={() => importExternalMutation.mutate()}
                      type="button"
                    >
                      {i18n._({ id: "Import", message: "Import" })}
                    </button>
                  </div>
                </div>
                <p className="config-inline-note">
                  {i18n._({
                    id: "Search for and import state from external agents on this machine.",
                    message:
                      "Search for and import state from external agents on this machine.",
                  })}
                </p>
              </div>

              <div className="config-card">
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: "Detected State & Workflow",
                      message: "Detected State & Workflow",
                    })}
                  </strong>
                </div>
                <Tabs
                  ariaLabel={i18n._({
                    id: "Migration inspection tabs",
                    message: "Migration inspection tabs",
                  })}
                  className="config-workbench__panel"
                  storageKey="settings-config-migration-side-tabs"
                  items={[
                    {
                      id: "detected",
                      label: i18n._({ id: "Detected", message: "Detected" }),
                      icon: <RefreshIcon />,
                      badge: detectExternalMutation.data?.items?.length ?? null,
                      content: detectExternalMutation.data ? (
                        <SettingsJsonPreview
                          collapsible
                          description={i18n._({
                            id: "Candidate artifacts ready for migration.",
                            message: "Candidate artifacts ready for migration.",
                          })}
                          title={i18n._({
                            id: "Detected Items",
                            message: "Detected Items",
                          })}
                          value={detectExternalMutation.data.items}
                        />
                      ) : (
                        <div className="empty-state">
                          {i18n._({
                            id: "Run a scan to see migration items.",
                            message: "Run a scan to see migration items.",
                          })}
                        </div>
                      ),
                    },
                    {
                      id: "workflow",
                      label: i18n._({ id: "Workflow", message: "Workflow" }),
                      icon: <SettingsIcon />,
                      content: (
                        <div className="config-helper-grid config-helper-grid--compact">
                          <ConfigHelperCard
                            description={i18n._({
                              id: "Discover candidate artifacts from local and home scopes.",
                              message:
                                "Discover candidate artifacts from local and home scopes.",
                            })}
                            title={i18n._({
                              id: "1. Scan",
                              message: "1. Scan",
                            })}
                          />
                          <ConfigHelperCard
                            description={i18n._({
                              id: "Inspect the detected payload before you import it.",
                              message:
                                "Inspect the detected payload before you import it.",
                            })}
                            title={i18n._({
                              id: "2. Review",
                              message: "2. Review",
                            })}
                          />
                          <ConfigHelperCard
                            description={i18n._({
                              id: "Apply the detected state into the active workspace.",
                              message:
                                "Apply the detected state into the active workspace.",
                            })}
                            title={i18n._({
                              id: "3. Import",
                              message: "3. Import",
                            })}
                          />
                        </div>
                      ),
                    },
                  ]}
                />
              </div>

              <details className="config-details-box">
                <ConfigDetailsSummary
                  description={i18n._({
                    id: "How to safely migrate your state",
                    message: "How to safely migrate your state",
                  })}
                  title={i18n._({
                    id: "Migration Workflow",
                    message: "Migration Workflow",
                  })}
                />
                <div className="config-details-box__content">
                  <div className="config-helper-grid config-helper-grid--compact">
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Detect artifacts in home & local scopes.",
                        message: "Detect artifacts in home & local scopes.",
                      })}
                      title={i18n._({ id: "1. Scan", message: "1. Scan" })}
                    />
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Verify detected items in the side panel.",
                        message: "Verify detected items in the side panel.",
                      })}
                      title={i18n._({ id: "2. Review", message: "2. Review" })}
                    />
                    <ConfigHelperCard
                      description={i18n._({
                        id: "Merge items into active workspace.",
                        message: "Merge items into active workspace.",
                      })}
                      title={i18n._({ id: "3. Import", message: "3. Import" })}
                    />
                  </div>
                </div>
              </details>

              {detectExternalMutation.error && (
                <InlineNotice
                  details={getErrorMessage(detectExternalMutation.error)}
                  onRetry={() => detectExternalMutation.mutate()}
                  title={i18n._({ id: "Scan Failed", message: "Scan Failed" })}
                  tone="error"
                >
                  {getErrorMessage(detectExternalMutation.error)}
                </InlineNotice>
              )}
              {importExternalMutation.error && (
                <InlineNotice
                  details={getErrorMessage(importExternalMutation.error)}
                  title={i18n._({
                    id: "Import Failed",
                    message: "Import Failed",
                  })}
                  tone="error"
                >
                  {getErrorMessage(importExternalMutation.error)}
                </InlineNotice>
              )}
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description={i18n._({
          id: "Manage workspace-scoped runtime values, advanced JSON configurations, and environment migrations.",
          message:
            "Manage workspace-scoped runtime values, advanced JSON configurations, and environment migrations.",
        })}
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">
              {i18n._({
                id: "{count} config layers",
                message: "{count} config layers",
                values: { count: configLayerCount },
              })}
            </span>
          </>
        }
        title={i18n._({ id: "Config", message: "Config" })}
      />

      <Tabs
        ariaLabel={i18n._({
          id: "Config navigation tabs",
          message: "Config navigation tabs",
        })}
        className="config-main-tabs"
        storageKey="settings-config-main-tabs"
        items={configTabs}
      />
    </section>
  );
}

function getScenarioMatchStatusClassName(match: ConfigScenarioMatch) {
  if (match.exact) {
    return "status-pill status-pill--active";
  }

  if (match.matchedEditCount > 0) {
    return "status-pill status-pill--paused";
  }

  return "status-pill";
}

function getScenarioMatchStatusLabel(match: ConfigScenarioMatch) {
  if (match.exact) {
    return i18n._({ id: "Exact", message: "Exact" });
  }

  if (match.matchedEditCount > 0) {
    return i18n._({ id: "Partial", message: "Partial" });
  }

  return i18n._({ id: "No match", message: "No match" });
}

function ConfigDetailsSummary({
  title,
  description,
}: ConfigDetailsSummaryProps) {
  return (
    <summary className="config-details-box__summary">
      <span className="config-details-box__summary-copy">
        <span className="config-details-box__summary-title">{title}</span>
        <small className="config-details-box__summary-description">
          {description}
        </small>
      </span>
      <span aria-hidden="true" className="config-details-box__summary-action">
        <span className="config-details-box__summary-state config-details-box__summary-state--collapsed">
          {i18n._({ id: "Expand", message: "Expand" })}
        </span>
        <span className="config-details-box__summary-state config-details-box__summary-state--expanded">
          {i18n._({ id: "Collapse", message: "Collapse" })}
        </span>
        <svg
          className="config-details-box__summary-chevron"
          fill="none"
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
          width="14"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </span>
    </summary>
  );
}

function buildAccessTokenDrafts(
  result: RuntimePreferencesResult,
): AccessTokenDraft[] {
  return (result.configuredAccessTokens ?? []).map((token) => ({
    id: token.id,
    label: token.label ?? "",
    token: "",
    tokenPreview: token.tokenPreview,
    expiresAt: token.permanent ? "" : toDateTimeLocalValue(token.expiresAt),
    permanent: token.permanent,
    revealToken: false,
    status: token.status,
    createdAt: token.createdAt ?? null,
    updatedAt: token.updatedAt ?? null,
  }));
}

function buildAccessTokenPayload(
  drafts: AccessTokenDraft[],
): AccessTokenWriteInput[] {
  return drafts.reduce<AccessTokenWriteInput[]>((items, draft) => {
    const hasMeaningfulValue =
      Boolean(draft.id) ||
      Boolean(draft.label.trim()) ||
      Boolean(draft.token.trim()) ||
      Boolean(draft.expiresAt.trim());

    if (!hasMeaningfulValue) {
      return items;
    }

    items.push({
      id: draft.id,
      label: draft.label.trim(),
      token: draft.token.trim(),
      expiresAt: draft.permanent
        ? undefined
        : toISOStringFromLocalDateTime(draft.expiresAt),
      permanent: draft.permanent,
    });
    return items;
  }, []);
}

function toDateTimeLocalValue(value?: string | null) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toISOStringFromLocalDateTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      i18n._({
        id: "Access token expiry must be a valid date and time",
        message: "Access token expiry must be a valid date and time",
      }),
    );
  }

  return parsed.toISOString();
}

async function copyTextToClipboard(value: string) {
  if (!value.trim()) {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy copy path below.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function parseJsonInput(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getShellTypeOptions() {
  return [
    {
      value: "",
      label: i18n._({
        id: "Follow catalog defaults",
        message: "Follow catalog defaults",
      }),
      triggerLabel: i18n._({ id: "Default", message: "Default" }),
    },
    {
      value: "default",
      label: i18n._({ id: "Default", message: "Default" }),
      triggerLabel: i18n._({ id: "Default", message: "Default" }),
    },
    {
      value: "local",
      label: i18n._({ id: "Local Shell", message: "Local Shell" }),
      triggerLabel: i18n._({ id: "Local", message: "Local" }),
    },
    {
      value: "shell_command",
      label: i18n._({ id: "Shell Command", message: "Shell Command" }),
      triggerLabel: i18n._({ id: "Shell Cmd", message: "Shell Cmd" }),
    },
    {
      value: "unified_exec",
      label: i18n._({ id: "Unified Execution", message: "Unified Execution" }),
      triggerLabel: i18n._({ id: "Unified", message: "Unified" }),
    },
    {
      value: "disabled",
      label: i18n._({ id: "Disabled", message: "Disabled" }),
      triggerLabel: i18n._({ id: "Off", message: "Off" }),
    },
  ];
}

function getTerminalShellOptions(
  supportedValues: string[],
  currentValue?: string,
): SelectOption[] {
  const options: SelectOption[] = [
    {
      value: "",
      label: i18n._({
        id: "Follow backend automatic shell selection",
        message: "Follow backend automatic shell selection",
      }),
      triggerLabel: i18n._({ id: "Auto", message: "Auto" }),
    },
  ];

  for (const value of supportedValues) {
    options.push(createTerminalShellOption(value));
  }

  const normalizedCurrentValue = (currentValue ?? "").trim().toLowerCase();
  if (
    normalizedCurrentValue &&
    !options.some((option) => option.value === normalizedCurrentValue)
  ) {
    options.push({
      ...createTerminalShellOption(normalizedCurrentValue),
      label: i18n._({
        id: "{shell} (currently saved, unavailable)",
        message: "{shell} (currently saved, unavailable)",
        values: {
          shell: formatTerminalShellLabel(normalizedCurrentValue),
        },
      }),
      disabled: true,
    });
  }

  return options;
}

function createTerminalShellOption(value: string) {
  switch (value) {
    case "pwsh":
      return {
        value,
        label: i18n._({
          id: "PowerShell 7 (pwsh)",
          message: "PowerShell 7 (pwsh)",
        }),
        triggerLabel: "pwsh",
      };
    case "powershell":
      return {
        value,
        label: i18n._({
          id: "Windows PowerShell",
          message: "Windows PowerShell",
        }),
        triggerLabel: i18n._({ id: "PowerShell", message: "PowerShell" }),
      };
    case "cmd":
      return {
        value,
        label: i18n._({
          id: "Command Prompt",
          message: "Command Prompt",
        }),
        triggerLabel: "cmd",
      };
    case "wsl":
      return {
        value,
        label: i18n._({ id: "WSL", message: "WSL" }),
        triggerLabel: i18n._({ id: "WSL", message: "WSL" }),
      };
    case "git-bash":
      return {
        value,
        label: i18n._({
          id: "Git Bash",
          message: "Git Bash",
        }),
        triggerLabel: i18n._({
          id: "Git Bash",
          message: "Git Bash",
        }),
      };
    case "bash":
      return {
        value,
        label: i18n._({ id: "bash", message: "bash" }),
        triggerLabel: i18n._({ id: "bash", message: "bash" }),
      };
    case "zsh":
      return {
        value,
        label: i18n._({ id: "zsh", message: "zsh" }),
        triggerLabel: i18n._({ id: "zsh", message: "zsh" }),
      };
    case "sh":
      return {
        value,
        label: i18n._({ id: "sh", message: "sh" }),
        triggerLabel: i18n._({ id: "sh", message: "sh" }),
      };
    default:
      return {
        value,
        label: formatTerminalShellLabel(value),
        triggerLabel: value,
      };
  }
}

function getApprovalPolicyOptions() {
  return [
    {
      value: "",
      label: i18n._({
        id: "Follow runtime default",
        message: "Follow runtime default",
      }),
      triggerLabel: i18n._({ id: "Default", message: "Default" }),
    },
    {
      value: "untrusted",
      label: i18n._({ id: "Untrusted", message: "Untrusted" }),
      triggerLabel: i18n._({ id: "Untrusted", message: "Untrusted" }),
    },
    {
      value: "on-failure",
      label: i18n._({ id: "On Failure", message: "On Failure" }),
      triggerLabel: i18n._({ id: "Failure", message: "Failure" }),
    },
    {
      value: "on-request",
      label: i18n._({ id: "On Request", message: "On Request" }),
      triggerLabel: i18n._({ id: "Request", message: "Request" }),
    },
    {
      value: "never",
      label: i18n._({ id: "Never", message: "Never" }),
      triggerLabel: i18n._({ id: "Never", message: "Never" }),
    },
  ];
}

function parseShellOverridesInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      i18n._({
        id: "Model Shell Type Overrides must be a JSON object",
        message: "Model Shell Type Overrides must be a JSON object",
      }),
    );
  }

  const normalized: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== "string") {
      throw new Error(
        i18n._({
          id: 'Model shell override for "{key}" must be a string',
          message: 'Model shell override for "{key}" must be a string',
          values: { key },
        }),
      );
    }
    normalized[key] = rawValue;
  }

  return normalized;
}

function parseSandboxPolicyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      i18n._({
        id: "Sandbox Policy must be a JSON object",
        message: "Sandbox Policy must be a JSON object",
      }),
    );
  }

  return parsed as Record<string, unknown>;
}

function parseShellEnvironmentPolicyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      i18n._({
        id: "shell_environment_policy must be a JSON object",
        message: "shell_environment_policy must be a JSON object",
      }),
    );
  }

  return parsed as Record<string, unknown>;
}

function stringifyJsonInput(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function stringifyOptionalNumberInput(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
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

function formatShellTypeLabel(value?: string | null) {
  const normalized = (value ?? "").trim();
  switch (normalized) {
    case "local":
      return i18n._({ id: "Local Shell", message: "Local Shell" });
    case "unified_exec":
      return i18n._({ id: "Unified Execution", message: "Unified Execution" });
    case "shell_command":
      return i18n._({ id: "Shell Command", message: "Shell Command" });
    case "disabled":
      return i18n._({ id: "Disabled", message: "Disabled" });
    case "default":
      return i18n._({ id: "Default", message: "Default" });
    case "":
      return i18n._({ id: "catalog default", message: "catalog default" });
    default:
      return normalized;
  }
}

function formatApprovalPolicyLabel(value?: string | null) {
  switch ((value ?? "").trim()) {
    case "untrusted":
      return i18n._({ id: "Untrusted", message: "Untrusted" });
    case "on-failure":
      return i18n._({ id: "On Failure", message: "On Failure" });
    case "on-request":
      return i18n._({ id: "On Request", message: "On Request" });
    case "never":
      return i18n._({ id: "Never", message: "Never" });
    default:
      return i18n._({ id: "Inherit", message: "Inherit" });
  }
}

function formatLocalAccessPreviewLabel(
  allowLocalhostWithoutAccessToken?: boolean | null,
  hasAccessTokenProtection?: boolean,
) {
  if (!hasAccessTokenProtection) {
    return i18n._({
      id: "open access",
      message: "open access",
    });
  }

  return allowLocalhostWithoutAccessToken
    ? i18n._({
        id: "no login",
        message: "no login",
      })
    : i18n._({
        id: "needs token",
        message: "needs token",
      });
}

function formatRemoteAccessPreviewLabel(
  allowRemoteAccess?: boolean | null,
  hasAccessTokenProtection?: boolean,
) {
  if (!allowRemoteAccess) {
    return i18n._({ id: "Localhost Only", message: "Localhost Only" });
  }

  if (!hasAccessTokenProtection) {
    return i18n._({
      id: "Token setup needed",
      message: "Token setup needed",
    });
  }

  return i18n._({ id: "Allowed", message: "Allowed" });
}

function formatLocalAccessPolicyLabel(value?: boolean | null) {
  return value
    ? i18n._({
        id: "Bypass token login",
        message: "Bypass token login",
      })
    : i18n._({
        id: "Token login required",
        message: "Token login required",
      });
}

function formatSandboxPolicyLabel(value?: Record<string, unknown> | null) {
  if (!value || typeof value !== "object") {
    return i18n._({ id: "Inherit", message: "Inherit" });
  }

  const rawType = typeof value.type === "string" ? value.type : "";
  if (!rawType) {
    return i18n._({ id: "Inherit", message: "Inherit" });
  }

  const typeLabels: Record<string, string> = {
    dangerFullAccess: i18n._({
      id: "Danger Full Access",
      message: "Danger Full Access",
    }),
    externalSandbox: i18n._({
      id: "External Sandbox",
      message: "External Sandbox",
    }),
    workspaceWrite: i18n._({
      id: "Workspace Write",
      message: "Workspace Write",
    }),
    readOnly: i18n._({ id: "Read Only", message: "Read Only" }),
  };

  const typeLabel = typeLabels[rawType] || rawType;

  if (
    rawType === "externalSandbox" &&
    typeof value.networkAccess === "string"
  ) {
    const networkLabel =
      value.networkAccess === "enabled"
        ? i18n._({ id: "Enabled", message: "Enabled" })
        : i18n._({ id: "Disabled", message: "Disabled" });
    return i18n._({
      id: "{type}:{networkAccess}",
      message: "{type}:{networkAccess}",
      values: { type: typeLabel, networkAccess: networkLabel },
    });
  }

  if (
    (rawType === "workspaceWrite" || rawType === "readOnly") &&
    typeof value.networkAccess === "boolean"
  ) {
    return i18n._({
      id: "{type}:{mode}",
      message: "{type}:{mode}",
      values: {
        type: typeLabel,
        mode: value.networkAccess
          ? i18n._({ id: "Network", message: "Network" })
          : i18n._({ id: "Offline", message: "Offline" }),
      },
    });
  }

  return typeLabel;
}

function formatBackendThreadTraceSummary(
  enabled?: boolean | null,
  workspaceId?: string | null,
  threadId?: string | null,
) {
  if (!enabled) {
    return i18n._({ id: "Off", message: "Off" });
  }

  const trimmedWorkspaceId = (workspaceId ?? "").trim();
  const trimmedThreadId = (threadId ?? "").trim();

  if (trimmedWorkspaceId && trimmedThreadId) {
    return i18n._({
      id: "workspace {workspaceId} / thread {threadId}",
      message: "workspace {workspaceId} / thread {threadId}",
      values: {
        workspaceId: trimmedWorkspaceId,
        threadId: trimmedThreadId,
      },
    });
  }

  if (trimmedWorkspaceId) {
    return i18n._({
      id: "workspace {workspaceId}",
      message: "workspace {workspaceId}",
      values: { workspaceId: trimmedWorkspaceId },
    });
  }

  if (trimmedThreadId) {
    return i18n._({
      id: "thread {threadId}",
      message: "thread {threadId}",
      values: { threadId: trimmedThreadId },
    });
  }

  return i18n._({ id: "All Workspaces", message: "All Workspaces" });
}

function formatTerminalShellLabel(value?: string | null) {
  switch ((value ?? "").trim()) {
    case "pwsh":
      return i18n._({
        id: "PowerShell 7 (pwsh)",
        message: "PowerShell 7 (pwsh)",
      });
    case "powershell":
      return i18n._({
        id: "Windows PowerShell",
        message: "Windows PowerShell",
      });
    case "cmd":
      return i18n._({
        id: "Command Prompt",
        message: "Command Prompt",
      });
    case "wsl":
      return "WSL";
    case "git-bash":
      return i18n._({
        id: "Git Bash",
        message: "Git Bash",
      });
    case "bash":
      return "bash";
    case "zsh":
      return "zsh";
    case "sh":
      return "sh";
    default:
      return i18n._({ id: "Auto", message: "Auto" });
  }
}
