import type {
  AccessTokenDescriptor,
  RuntimePreferencesResult,
} from "../../types/api";
import type {
  AccessTokenWriteInput,
  WriteRuntimePreferencesInput,
} from "../../features/settings/api";

export type RuntimePreferencesBackendThreadTraceDraft = {
  backendThreadTraceEnabled: boolean;
  backendThreadTraceWorkspaceId: string;
  backendThreadTraceThreadId: string;
};

export type RuntimePreferencesBackendThreadTraceInput = {
  backendThreadTraceEnabled?: boolean | null;
  backendThreadTraceWorkspaceId?: string;
  backendThreadTraceThreadId?: string;
};

export type TurnPolicyPrimaryAction = "steer" | "followUp" | "interrupt";
export type TurnPolicyInterruptNoActiveTurnBehavior = "skip" | "followUp";

export type RuntimePreferencesTurnPolicyPrimaryActionDraft = {
  turnPolicyPostToolUsePrimaryAction: TurnPolicyPrimaryAction;
  turnPolicyStopMissingSuccessfulVerificationPrimaryAction: TurnPolicyPrimaryAction;
};

export type RuntimePreferencesTurnPolicyPrimaryActionInput = {
  turnPolicyPostToolUsePrimaryAction?: string | null;
  turnPolicyStopMissingSuccessfulVerificationPrimaryAction?: string | null;
};

export type RuntimePreferencesTurnPolicyInterruptNoActiveTurnBehaviorDraft = {
  turnPolicyPostToolUseInterruptNoActiveTurnBehavior: TurnPolicyInterruptNoActiveTurnBehavior;
  turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior: TurnPolicyInterruptNoActiveTurnBehavior;
};

export type RuntimePreferencesTurnPolicyInterruptNoActiveTurnBehaviorInput = {
  turnPolicyPostToolUseInterruptNoActiveTurnBehavior?: string | null;
  turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior?:
    | string
    | null;
};

export type RuntimePreferencesTurnPolicyValidationCommandPrefixesInput = {
  turnPolicyValidationCommandPrefixes?: string[] | null;
};

export type RuntimePreferencesTurnPolicyAlertAcknowledgementInput = {
  turnPolicyAlertAcknowledgedCodes?: string[] | null;
};

export type TurnPolicyAlertGovernanceAction =
  | {
      type: "acknowledge";
      code: string;
      source?: string;
    }
  | {
      type: "clearAcknowledgement";
      code: string;
      source?: string;
    }
  | {
      type: "snooze24h";
      code: string;
      source?: string;
    }
  | {
      type: "clearSnooze";
      code: string;
      source?: string;
    };

const turnPolicyAlertSnooze24HoursMs = 24 * 60 * 60 * 1000;

function normalizeAlertCodes(values: string[]) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    items.push(trimmed);
  }

  return items;
}

export function mergeTurnPolicyAlertCodes(
  ...lists: Array<string[] | null | undefined>
) {
  const merged: string[] = [];

  for (const list of lists) {
    if (!Array.isArray(list) || list.length === 0) {
      continue;
    }

    merged.push(...list);
  }

  return normalizeAlertCodes(merged);
}

function cloneStringRecord(values?: Record<string, string> | null) {
  if (!values) {
    return {};
  }

  return { ...values };
}

function cloneUnknownRecord(values?: Record<string, unknown> | null) {
  if (!values) {
    return undefined;
  }

  return { ...values };
}

function trimStringValue(value?: string | null) {
  return (value ?? "").trim();
}

function buildConfiguredAccessTokenWriteInputs(
  values?: AccessTokenDescriptor[] | null,
): AccessTokenWriteInput[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  return values.map((value) => ({
    id: value.id,
    label: value.label ?? "",
    expiresAt: value.expiresAt ?? undefined,
    permanent: value.permanent,
  }));
}

function normalizeStoredAlertCodes(values?: string[] | null) {
  const normalized = mergeTurnPolicyAlertCodes(values);
  return normalized.length ? normalized : null;
}

function parseStoredIsoDate(value?: string | null) {
  const trimmed = trimStringValue(value);
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function normalizeGovernanceCode(code: string) {
  const normalized = code.trim();
  if (!normalized) {
    throw new Error("alert code is required");
  }
  return normalized;
}

function parseTurnPolicyAlertCodesInput(value: string) {
  const entries = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!entries.length) {
    return null;
  }

  return normalizeAlertCodes(entries);
}

function formatTurnPolicyAlertCodesInput(values?: string[] | null) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }

  return mergeTurnPolicyAlertCodes(values).join("\n");
}

function normalizeValidationCommandPrefixes(values: string[]) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push(normalized);
  }

  return items;
}

function parseValidationCommandPrefixesInput(value: string) {
  const entries = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!entries.length) {
    return null;
  }

  return normalizeValidationCommandPrefixes(entries);
}

function formatValidationCommandPrefixesInput(values?: string[] | null) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }

  return normalizeValidationCommandPrefixes(values).join("\n");
}

function normalizeHookRelativePaths(values?: string[] | null) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values) {
    let normalized = value.trim().replaceAll("\\", "/");
    while (normalized.includes("//")) {
      normalized = normalized.replaceAll("//", "/");
    }
    normalized = normalized.replace(/^\.\/+/, "");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(normalized);
  }

  return items.length ? items : null;
}

function normalizeSessionStartContextPaths(values?: string[] | null) {
  return normalizeHookRelativePaths(values);
}

export function parseHookSessionStartContextPathsInput(value: string) {
  const entries = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!entries.length) {
    return null;
  }

  return normalizeSessionStartContextPaths(entries);
}

export function formatHookSessionStartContextPathsInput(
  values?: string[] | null,
) {
  const normalized = normalizeSessionStartContextPaths(values);
  if (!normalized?.length) {
    return "";
  }

  return normalized.join("\n");
}

function normalizeHookPreToolUseAdditionalProtectedGovernancePaths(
  values?: string[] | null,
) {
  return normalizeHookRelativePaths(values);
}

export function parseHookPreToolUseAdditionalProtectedGovernancePathsInput(
  value: string,
) {
  const entries = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!entries.length) {
    return null;
  }

  return normalizeHookPreToolUseAdditionalProtectedGovernancePaths(entries);
}

export function formatHookPreToolUseAdditionalProtectedGovernancePathsInput(
  values?: string[] | null,
) {
  const normalized =
    normalizeHookPreToolUseAdditionalProtectedGovernancePaths(values);
  if (!normalized?.length) {
    return "";
  }

  return normalized.join("\n");
}

export function normalizeTurnPolicyPrimaryAction(
  value?: string | null,
): TurnPolicyPrimaryAction | "" {
  switch ((value ?? "").trim()) {
    case "steer":
      return "steer";
    case "followUp":
      return "followUp";
    case "interrupt":
      return "interrupt";
    default:
      return "";
  }
}

export function formatTurnPolicyPrimaryActionLabel(value?: string | null) {
  switch (normalizeTurnPolicyPrimaryAction(value)) {
    case "steer":
      return "Steer";
    case "followUp":
      return "Follow-up";
    case "interrupt":
      return "Interrupt";
    default:
      return "\u2014";
  }
}

export function normalizeTurnPolicyInterruptNoActiveTurnBehavior(
  value?: string | null,
): TurnPolicyInterruptNoActiveTurnBehavior | "" {
  switch ((value ?? "").trim()) {
    case "skip":
      return "skip";
    case "followUp":
      return "followUp";
    default:
      return "";
  }
}

export function formatTurnPolicyInterruptNoActiveTurnBehaviorLabel(
  value?: string | null,
) {
  switch (normalizeTurnPolicyInterruptNoActiveTurnBehavior(value)) {
    case "skip":
      return "Skip";
    case "followUp":
      return "Follow-up";
    default:
      return "\u2014";
  }
}

export function buildDraftTurnPolicyPrimaryActionPayload(
  draft: RuntimePreferencesTurnPolicyPrimaryActionDraft,
  input?: RuntimePreferencesTurnPolicyPrimaryActionInput,
) {
  const includePostToolUsePrimaryAction =
    input &&
    Object.prototype.hasOwnProperty.call(
      input,
      "turnPolicyPostToolUsePrimaryAction",
    );
  const includeStopMissingSuccessfulVerificationPrimaryAction =
    input &&
    Object.prototype.hasOwnProperty.call(
      input,
      "turnPolicyStopMissingSuccessfulVerificationPrimaryAction",
    );

  return {
    turnPolicyPostToolUsePrimaryAction:
      normalizeTurnPolicyPrimaryAction(
        includePostToolUsePrimaryAction
          ? input?.turnPolicyPostToolUsePrimaryAction
          : draft.turnPolicyPostToolUsePrimaryAction,
      ) || "",
    turnPolicyStopMissingSuccessfulVerificationPrimaryAction:
      normalizeTurnPolicyPrimaryAction(
        includeStopMissingSuccessfulVerificationPrimaryAction
          ? input?.turnPolicyStopMissingSuccessfulVerificationPrimaryAction
          : draft.turnPolicyStopMissingSuccessfulVerificationPrimaryAction,
      ) || "",
  };
}

export function buildConfiguredTurnPolicyPrimaryActionPayload(
  result?: Pick<
    RuntimePreferencesResult,
    | "configuredTurnPolicyPostToolUsePrimaryAction"
    | "configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction"
  > | null,
) {
  return {
    turnPolicyPostToolUsePrimaryAction:
      normalizeTurnPolicyPrimaryAction(
        result?.configuredTurnPolicyPostToolUsePrimaryAction,
      ) || "",
    turnPolicyStopMissingSuccessfulVerificationPrimaryAction:
      normalizeTurnPolicyPrimaryAction(
        result?.configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
      ) || "",
  };
}

export function buildDraftTurnPolicyInterruptNoActiveTurnBehaviorPayload(
  draft: RuntimePreferencesTurnPolicyInterruptNoActiveTurnBehaviorDraft,
  input?: RuntimePreferencesTurnPolicyInterruptNoActiveTurnBehaviorInput,
) {
  const includePostToolUseInterruptNoActiveTurnBehavior =
    input &&
    Object.prototype.hasOwnProperty.call(
      input,
      "turnPolicyPostToolUseInterruptNoActiveTurnBehavior",
    );
  const includeStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior =
    input &&
    Object.prototype.hasOwnProperty.call(
      input,
      "turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior",
    );

  return {
    turnPolicyPostToolUseInterruptNoActiveTurnBehavior:
      normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        includePostToolUseInterruptNoActiveTurnBehavior
          ? input?.turnPolicyPostToolUseInterruptNoActiveTurnBehavior
          : draft.turnPolicyPostToolUseInterruptNoActiveTurnBehavior,
      ) || "",
    turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        includeStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior
          ? input?.turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior
          : draft.turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
      ) || "",
  };
}

export function buildConfiguredTurnPolicyInterruptNoActiveTurnBehaviorPayload(
  result?: Pick<
    RuntimePreferencesResult,
    | "configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior"
    | "configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior"
  > | null,
) {
  return {
    turnPolicyPostToolUseInterruptNoActiveTurnBehavior:
      normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        result?.configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
      ) || "",
    turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        result?.configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
      ) || "",
  };
}

export function buildDraftTurnPolicyValidationCommandPrefixesPayload(
  draftValue: string,
  input?: RuntimePreferencesTurnPolicyValidationCommandPrefixesInput,
) {
  const includeValidationCommandPrefixes =
    input &&
    Object.prototype.hasOwnProperty.call(
      input,
      "turnPolicyValidationCommandPrefixes",
    );

  return {
    turnPolicyValidationCommandPrefixes: includeValidationCommandPrefixes
      ? (input?.turnPolicyValidationCommandPrefixes ?? null)
      : parseValidationCommandPrefixesInput(draftValue),
  };
}

export function buildConfiguredRuntimePreferencesWritePayload(
  result?: RuntimePreferencesResult | null,
): WriteRuntimePreferencesInput {
  return {
    modelCatalogPath: trimStringValue(result?.configuredModelCatalogPath),
    defaultShellType: trimStringValue(result?.configuredDefaultShellType),
    defaultTerminalShell: trimStringValue(
      result?.configuredDefaultTerminalShell,
    ),
    modelShellTypeOverrides: cloneStringRecord(
      result?.configuredModelShellTypeOverrides,
    ),
    outboundProxyUrl: trimStringValue(result?.configuredOutboundProxyUrl),
    hookSessionStartEnabled:
      result?.configuredHookSessionStartEnabled ?? null,
    hookSessionStartContextPaths: normalizeSessionStartContextPaths(
      result?.configuredHookSessionStartContextPaths,
    ),
    hookSessionStartMaxChars:
      result?.configuredHookSessionStartMaxChars ?? null,
    hookUserPromptSubmitBlockSecretPasteEnabled:
      result?.configuredHookUserPromptSubmitBlockSecretPasteEnabled ?? null,
    hookPreToolUseBlockDangerousCommandEnabled:
      result?.configuredHookPreToolUseBlockDangerousCommandEnabled ?? null,
    hookPreToolUseAdditionalProtectedGovernancePaths:
      normalizeHookPreToolUseAdditionalProtectedGovernancePaths(
        result?.configuredHookPreToolUseAdditionalProtectedGovernancePaths,
      ),
    turnPolicyPostToolUseFailedValidationEnabled:
      result?.configuredTurnPolicyPostToolUseFailedValidationEnabled ?? null,
    turnPolicyStopMissingSuccessfulVerificationEnabled:
      result?.configuredTurnPolicyStopMissingSuccessfulVerificationEnabled ??
      null,
    turnPolicyFollowUpCooldownMs:
      result?.configuredTurnPolicyFollowUpCooldownMs ?? null,
    turnPolicyPostToolUseFollowUpCooldownMs:
      result?.configuredTurnPolicyPostToolUseFollowUpCooldownMs ?? null,
    turnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:
      result?.configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs ??
      null,
    turnPolicyPostToolUsePrimaryAction:
      normalizeTurnPolicyPrimaryAction(
        result?.configuredTurnPolicyPostToolUsePrimaryAction,
      ) || "",
    turnPolicyStopMissingSuccessfulVerificationPrimaryAction:
      normalizeTurnPolicyPrimaryAction(
        result?.configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction,
      ) || "",
    turnPolicyPostToolUseInterruptNoActiveTurnBehavior:
      normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        result?.configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior,
      ) || "",
    turnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      normalizeTurnPolicyInterruptNoActiveTurnBehavior(
        result?.configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
      ) || "",
    turnPolicyValidationCommandPrefixes: parseValidationCommandPrefixesInput(
      formatValidationCommandPrefixesInput(
        result?.configuredTurnPolicyValidationCommandPrefixes,
      ),
    ),
    turnPolicyAlertCoverageThresholdPercent:
      result?.configuredTurnPolicyAlertCoverageThresholdPercent ?? null,
    turnPolicyAlertPostToolUseLatencyP95ThresholdMs:
      result?.configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs ?? null,
    turnPolicyAlertStopLatencyP95ThresholdMs:
      result?.configuredTurnPolicyAlertStopLatencyP95ThresholdMs ?? null,
    turnPolicyAlertSourceActionSuccessThresholdPercent:
      result?.configuredTurnPolicyAlertSourceActionSuccessThresholdPercent ??
      null,
    turnPolicyAlertSuppressedCodes: normalizeStoredAlertCodes(
      result?.configuredTurnPolicyAlertSuppressedCodes,
    ),
    turnPolicyAlertAcknowledgedCodes: normalizeStoredAlertCodes(
      result?.configuredTurnPolicyAlertAcknowledgedCodes,
    ),
    turnPolicyAlertSnoozedCodes: normalizeStoredAlertCodes(
      result?.configuredTurnPolicyAlertSnoozedCodes,
    ),
    turnPolicyAlertSnoozeUntil:
      trimStringValue(result?.configuredTurnPolicyAlertSnoozeUntil) || null,
    defaultTurnApprovalPolicy: trimStringValue(
      result?.configuredDefaultTurnApprovalPolicy,
    ),
    defaultTurnSandboxPolicy: cloneUnknownRecord(
      result?.configuredDefaultTurnSandboxPolicy,
    ),
    defaultCommandSandboxPolicy: cloneUnknownRecord(
      result?.configuredDefaultCommandSandboxPolicy,
    ),
    allowRemoteAccess: result?.configuredAllowRemoteAccess ?? null,
    allowLocalhostWithoutAccessToken:
      result?.configuredAllowLocalhostWithoutAccessToken ?? null,
    accessTokens: buildConfiguredAccessTokenWriteInputs(
      result?.configuredAccessTokens,
    ),
    backendThreadTraceEnabled:
      result?.configuredBackendThreadTraceEnabled ?? null,
    backendThreadTraceWorkspaceId: trimStringValue(
      result?.configuredBackendThreadTraceWorkspaceId,
    ),
    backendThreadTraceThreadId: trimStringValue(
      result?.configuredBackendThreadTraceThreadId,
    ),
  };
}

export function buildTurnPolicyAlertGovernancePayload(
  result: RuntimePreferencesResult | null | undefined,
  action: TurnPolicyAlertGovernanceAction,
  now = new Date(),
): WriteRuntimePreferencesInput {
  const payload = buildConfiguredRuntimePreferencesWritePayload(result);
  const code = normalizeGovernanceCode(action.code);
  const source = trimStringValue(action.source);

  if (action.type === "acknowledge") {
    const nextCodes = mergeTurnPolicyAlertCodes(
      payload.turnPolicyAlertAcknowledgedCodes,
      [code],
    );
    return {
      ...payload,
      turnPolicyAlertAcknowledgedCodes: nextCodes.length ? nextCodes : null,
      turnPolicyAlertGovernanceEvent: {
        action: "acknowledge",
        source,
        codes: [code],
      },
    };
  }

  if (action.type === "clearAcknowledgement") {
    const nextCodes = (payload.turnPolicyAlertAcknowledgedCodes ?? []).filter(
      (value) => value !== code,
    );
    return {
      ...payload,
      turnPolicyAlertAcknowledgedCodes: nextCodes.length ? nextCodes : null,
      turnPolicyAlertGovernanceEvent: {
        action: "clear_acknowledgement",
        source,
        codes: [code],
      },
    };
  }

  if (action.type === "clearSnooze") {
    const nextCodes = (payload.turnPolicyAlertSnoozedCodes ?? []).filter(
      (value) => value !== code,
    );
    return {
      ...payload,
      turnPolicyAlertSnoozedCodes: nextCodes.length ? nextCodes : null,
      turnPolicyAlertSnoozeUntil: nextCodes.length
        ? (payload.turnPolicyAlertSnoozeUntil ?? null)
        : null,
      turnPolicyAlertGovernanceEvent: {
        action: "clear_snooze",
        source,
        codes: [code],
        snoozeUntil: null,
      },
    };
  }

  const nextCodes = mergeTurnPolicyAlertCodes(
    payload.turnPolicyAlertSnoozedCodes,
    [code],
  );
  const existingUntil = parseStoredIsoDate(payload.turnPolicyAlertSnoozeUntil);
  const minimumUntilMs = now.getTime() + turnPolicyAlertSnooze24HoursMs;
  const nextUntilMs = Math.max(existingUntil?.getTime() ?? 0, minimumUntilMs);
  const nextSnoozeUntil = new Date(nextUntilMs).toISOString();

  return {
    ...payload,
    turnPolicyAlertSnoozedCodes: nextCodes.length ? nextCodes : null,
    turnPolicyAlertSnoozeUntil: nextSnoozeUntil,
    turnPolicyAlertGovernanceEvent: {
      action: "snooze_24h",
      source,
      codes: [code],
      snoozeUntil: nextSnoozeUntil,
    },
  };
}

export function parseTurnPolicyAlertSuppressedCodesInput(value: string) {
  return parseTurnPolicyAlertCodesInput(value);
}

export function parseTurnPolicyValidationCommandPrefixesInput(value: string) {
  return parseValidationCommandPrefixesInput(value);
}

export function formatTurnPolicyValidationCommandPrefixesInput(
  values?: string[] | null,
) {
  return formatValidationCommandPrefixesInput(values);
}

export function formatTurnPolicyAlertSuppressedCodesInput(
  values?: string[] | null,
) {
  return formatTurnPolicyAlertCodesInput(values);
}

export function parseTurnPolicyAlertAcknowledgedCodesInput(value: string) {
  return parseTurnPolicyAlertCodesInput(value);
}

export function formatTurnPolicyAlertAcknowledgedCodesInput(
  values?: string[] | null,
) {
  return formatTurnPolicyAlertCodesInput(values);
}

export function parseTurnPolicyAlertSnoozedCodesInput(value: string) {
  return parseTurnPolicyAlertCodesInput(value);
}

export function formatTurnPolicyAlertSnoozedCodesInput(
  values?: string[] | null,
) {
  return formatTurnPolicyAlertCodesInput(values);
}

function padDateTimeLocalPart(value: number) {
  return String(value).padStart(2, "0");
}

export function datetimeLocalInputToIsoString(value?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function isoStringToDatetimeLocalInput(value?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return [
    parsed.getFullYear(),
    padDateTimeLocalPart(parsed.getMonth() + 1),
    padDateTimeLocalPart(parsed.getDate()),
  ]
    .join("-")
    .concat(
      "T",
      [
        padDateTimeLocalPart(parsed.getHours()),
        padDateTimeLocalPart(parsed.getMinutes()),
      ].join(":"),
    );
}

export function buildDraftTurnPolicyAlertAcknowledgementPayload(
  draftInput: string,
  input?: RuntimePreferencesTurnPolicyAlertAcknowledgementInput,
) {
  const includeTurnPolicyAlertAcknowledgedCodes =
    input &&
    Object.prototype.hasOwnProperty.call(
      input,
      "turnPolicyAlertAcknowledgedCodes",
    );

  return {
    turnPolicyAlertAcknowledgedCodes: includeTurnPolicyAlertAcknowledgedCodes
      ? (input?.turnPolicyAlertAcknowledgedCodes ?? null)
      : parseTurnPolicyAlertAcknowledgedCodesInput(draftInput),
  };
}

export function buildDraftBackendThreadTracePayload(
  draft: RuntimePreferencesBackendThreadTraceDraft,
  input?: RuntimePreferencesBackendThreadTraceInput,
) {
  const includeBackendThreadTraceEnabled =
    input &&
    Object.prototype.hasOwnProperty.call(input, "backendThreadTraceEnabled");
  const includeBackendThreadTraceWorkspaceId =
    input &&
    Object.prototype.hasOwnProperty.call(
      input,
      "backendThreadTraceWorkspaceId",
    );
  const includeBackendThreadTraceThreadId =
    input &&
    Object.prototype.hasOwnProperty.call(input, "backendThreadTraceThreadId");

  return {
    backendThreadTraceEnabled: includeBackendThreadTraceEnabled
      ? (input?.backendThreadTraceEnabled ?? null)
      : draft.backendThreadTraceEnabled,
    backendThreadTraceWorkspaceId:
      (includeBackendThreadTraceWorkspaceId
        ? input?.backendThreadTraceWorkspaceId
        : draft.backendThreadTraceWorkspaceId
      )?.trim() ?? "",
    backendThreadTraceThreadId:
      (includeBackendThreadTraceThreadId
        ? input?.backendThreadTraceThreadId
        : draft.backendThreadTraceThreadId
      )?.trim() ?? "",
  };
}

export function buildConfiguredBackendThreadTracePayload(
  result?: Pick<
    RuntimePreferencesResult,
    | "configuredBackendThreadTraceEnabled"
    | "configuredBackendThreadTraceWorkspaceId"
    | "configuredBackendThreadTraceThreadId"
  > | null,
) {
  return {
    backendThreadTraceEnabled:
      result?.configuredBackendThreadTraceEnabled ?? null,
    backendThreadTraceWorkspaceId: (
      result?.configuredBackendThreadTraceWorkspaceId ?? ""
    ).trim(),
    backendThreadTraceThreadId: (
      result?.configuredBackendThreadTraceThreadId ?? ""
    ).trim(),
  };
}
