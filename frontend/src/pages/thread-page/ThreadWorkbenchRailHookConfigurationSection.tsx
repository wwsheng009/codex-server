import { Link } from "react-router-dom";

import { DetailGroup } from "../../components/ui/DetailGroup";
import { InlineNotice } from "../../components/ui/InlineNotice";
import { LoadingState } from "../../components/ui/LoadingState";
import { formatLocalizedNumber } from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import {
  activateGovernanceSettingsTab,
  GOVERNANCE_SETTINGS_PATH,
} from "../../features/settings/governanceNavigation";
import type { ThreadWorkbenchRailHookConfigurationSectionProps } from "./threadWorkbenchRailTypes";

function hasConfiguredOverride(value: unknown) {
  return value !== undefined && value !== null;
}

function hasPathValues(values?: string[] | null) {
  return (values ?? []).some((value) => value.trim());
}

function formatBooleanState(value?: boolean | null) {
  return value
    ? i18n._({
        id: "Enabled",
        message: "Enabled",
      })
    : i18n._({
        id: "Disabled",
        message: "Disabled",
      });
}

function formatSourceState(source?: string | null) {
  switch ((source ?? "").trim()) {
    case "runtime":
      return i18n._({
        id: "Runtime override",
        message: "Runtime override",
      });
    case "workspace":
      return i18n._({
        id: "Workspace baseline",
        message: "Workspace baseline",
      });
    default:
      return i18n._({
        id: "Built-in default",
        message: "Built-in default",
      });
  }
}

function formatPathSummary(paths?: string[] | null) {
  const normalized = (paths ?? []).map((value) => value.trim()).filter(Boolean);
  const count = normalized.length;
  const countLabel = i18n._({
    id: "{count} paths",
    message: "{count} paths",
    values: {
      count: formatLocalizedNumber(count, "0"),
    },
  });

  if (!count) {
    return countLabel;
  }

  const preview = normalized.slice(0, 2).join(", ");
  if (count <= 2) {
    return `${countLabel} · ${preview}`;
  }

  return i18n._({
    id: "{countLabel} · {preview}, +{remaining} more",
    message: "{countLabel} · {preview}, +{remaining} more",
    values: {
      countLabel,
      preview,
      remaining: formatLocalizedNumber(count - 2, "0"),
    },
  });
}

function formatMaxChars(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "—";
  }

  return i18n._({
    id: "{count} chars",
    message: "{count} chars",
    values: {
      count: formatLocalizedNumber(value, "0"),
    },
  });
}

function formatRowValue(value: string, source?: string | null) {
  return `${value} · ${formatSourceState(source)}`;
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function formatConfigPathPreview(path?: string | null, workspaceRootPath?: string | null) {
  const normalizedPath = normalizePath((path ?? "").trim());
  if (!normalizedPath) {
    return "";
  }

  const normalizedRoot = normalizePath((workspaceRootPath ?? "").trim()).replace(/\/+$/, "");
  if (
    normalizedRoot &&
    normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)
  ) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath;
}

function formatWorkspaceFileState(
  loadStatus?: string | null,
  loadedFromPath?: string | null,
  searchedPaths?: string[] | null,
  workspaceRootPath?: string | null,
) {
  const status = (loadStatus ?? "").trim();
  const searchedPreview = (searchedPaths ?? [])
    .map((value) => formatConfigPathPreview(value, workspaceRootPath))
    .filter(Boolean)
    .join(", ");
  const loadedPreview = formatConfigPathPreview(loadedFromPath, workspaceRootPath);

  if (status === "loaded") {
    return `${i18n._({
      id: "Loaded",
      message: "Loaded",
    })} · ${loadedPreview || "hooks.json"}`;
  }

  if (status === "error") {
    return `${i18n._({
      id: "Error",
      message: "Error",
    })} · ${loadedPreview || searchedPreview || "hooks.json"}`;
  }

  return `${i18n._({
    id: "Not found",
    message: "Not found",
  })} · ${searchedPreview || ".codex/hooks.json, hooks.json"}`;
}

export function ThreadWorkbenchRailHookConfigurationSection({
  hookConfiguration,
  hookConfigurationError,
  hookConfigurationLoading,
}: ThreadWorkbenchRailHookConfigurationSectionProps) {
  const runtimeOverrideCount = [
    hasConfiguredOverride(hookConfiguration?.configuredHookSessionStartEnabled),
    hasPathValues(hookConfiguration?.configuredHookSessionStartContextPaths),
    hasConfiguredOverride(hookConfiguration?.configuredHookSessionStartMaxChars),
    hasConfiguredOverride(
      hookConfiguration?.configuredHookUserPromptSubmitBlockSecretPasteEnabled,
    ),
    hasConfiguredOverride(
      hookConfiguration?.configuredHookPreToolUseBlockDangerousCommandEnabled,
    ),
    hasPathValues(
      hookConfiguration?.configuredHookPreToolUseAdditionalProtectedGovernancePaths,
    ),
  ].filter(Boolean).length;
  const workspaceBaselineCount = [
    hasConfiguredOverride(hookConfiguration?.baselineHookSessionStartEnabled),
    hasPathValues(hookConfiguration?.baselineHookSessionStartContextPaths),
    hasConfiguredOverride(hookConfiguration?.baselineHookSessionStartMaxChars),
    hasConfiguredOverride(
      hookConfiguration?.baselineHookUserPromptSubmitBlockSecretPasteEnabled,
    ),
    hasConfiguredOverride(
      hookConfiguration?.baselineHookPreToolUseBlockDangerousCommandEnabled,
    ),
    hasPathValues(
      hookConfiguration?.baselineHookPreToolUseAdditionalProtectedGovernancePaths,
    ),
  ].filter(Boolean).length;

  return (
    <DetailGroup
      title={i18n._({
        id: "Hook Configuration",
        message: "Hook Configuration",
      })}
    >
      {hookConfigurationLoading ? (
        <div className="pane-section-content">
          <LoadingState
            fill={false}
            message={i18n._({
              id: "Loading hook configuration…",
              message: "Loading hook configuration…",
            })}
          />
        </div>
      ) : hookConfigurationError ? (
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`thread-hook-configuration-${hookConfigurationError}`}
            title={i18n._({
              id: "Hook configuration unavailable",
              message: "Hook configuration unavailable",
            })}
            tone="error"
          >
            {hookConfigurationError}
          </InlineNotice>
        </div>
      ) : !hookConfiguration ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: "Workspace hook configuration has not been loaded yet.",
              message: "Workspace hook configuration has not been loaded yet.",
            })}
          </p>
        </div>
      ) : (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
            {i18n._({
              id: "Workspace baseline loads from hooks.json, runtime overrides come from Settings, and the rows below show the final effective result used by the hook engine.",
              message:
                "Workspace baseline loads from hooks.json, runtime overrides come from Settings, and the rows below show the final effective result used by the hook engine.",
            })}
          </p>
          <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
            {i18n._({
              id: "Each effective row includes a source label so you can tell whether that value currently comes from the built-in default, the workspace baseline, or a runtime override.",
              message:
                "Each effective row includes a source label so you can tell whether that value currently comes from the built-in default, the workspace baseline, or a runtime override.",
            })}
          </p>

          {runtimeOverrideCount > 0 ? (
            <InlineNotice
              noticeKey={`thread-hook-configuration-runtime-override-${runtimeOverrideCount}`}
              title={i18n._({
                id: "Runtime overrides currently change effective hook behavior",
                message:
                  "Runtime overrides currently change effective hook behavior",
              })}
            >
              {i18n._({
                id: "{count} runtime override values are active. Editing hooks.json alone will not remove them.",
                message:
                  "{count} runtime override values are active. Editing hooks.json alone will not remove them.",
                values: {
                  count: formatLocalizedNumber(runtimeOverrideCount, "0"),
                },
              })}
            </InlineNotice>
          ) : null}

          <div className="detail-row detail-row--emphasis">
            <span>
              {i18n._({
                id: "Workspace file",
                message: "Workspace file",
              })}
            </span>
            <strong
              title={
                hookConfiguration.loadedFromPath ||
                (hookConfiguration.searchedPaths ?? []).join("\n")
              }
            >
              {formatWorkspaceFileState(
                hookConfiguration.loadStatus,
                hookConfiguration.loadedFromPath,
                hookConfiguration.searchedPaths,
                hookConfiguration.workspaceRootPath,
              )}
            </strong>
          </div>

          {hookConfiguration.loadStatus === "error" && hookConfiguration.loadError ? (
            <InlineNotice
              noticeKey={`thread-hook-configuration-load-error-${hookConfiguration.loadError}`}
              title={i18n._({
                id: "Workspace hooks.json is invalid",
                message: "Workspace hooks.json is invalid",
              })}
              tone="error"
            >
              {hookConfiguration.loadError}
            </InlineNotice>
          ) : null}

          <div className="detail-row">
            <span>
              {i18n._({
                id: "Workspace baseline",
                message: "Workspace baseline",
              })}
            </span>
            <strong>
              {workspaceBaselineCount > 0
                ? i18n._({
                    id: "{count} active",
                    message: "{count} active",
                    values: {
                      count: formatLocalizedNumber(workspaceBaselineCount, "0"),
                    },
                  })
                : i18n._({
                    id: "Not configured",
                    message: "Not configured",
                  })}
            </strong>
          </div>

          <div className="detail-row">
            <span>
              {i18n._({
                id: "Runtime overrides",
                message: "Runtime overrides",
              })}
            </span>
            <strong>
              {runtimeOverrideCount > 0
                ? i18n._({
                    id: "{count} active",
                    message: "{count} active",
                    values: {
                      count: formatLocalizedNumber(runtimeOverrideCount, "0"),
                    },
                  })
                : i18n._({
                    id: "None",
                    message: "None",
                  })}
            </strong>
          </div>

          <div className="detail-row">
            <span>
              {i18n._({
                id: "SessionStart",
                message: "SessionStart",
              })}
            </span>
            <strong>
              {formatRowValue(
                formatBooleanState(hookConfiguration.effectiveHookSessionStartEnabled),
                hookConfiguration.effectiveHookSessionStartEnabledSource,
              )}
            </strong>
          </div>

          <div className="detail-row">
            <span>
              {i18n._({
                id: "Context paths",
                message: "Context paths",
              })}
            </span>
            <strong
              title={(hookConfiguration.effectiveHookSessionStartContextPaths ?? []).join(
                "\n",
              )}
            >
              {formatRowValue(
                formatPathSummary(
                  hookConfiguration.effectiveHookSessionStartContextPaths,
                ),
                hookConfiguration.effectiveHookSessionStartContextPathsSource,
              )}
            </strong>
          </div>

          <div className="detail-row">
            <span>
              {i18n._({
                id: "Max chars",
                message: "Max chars",
              })}
            </span>
            <strong>
              {formatRowValue(
                formatMaxChars(hookConfiguration.effectiveHookSessionStartMaxChars),
                hookConfiguration.effectiveHookSessionStartMaxCharsSource,
              )}
            </strong>
          </div>

          <div className="detail-row">
            <span>
              {i18n._({
                id: "Secret paste block",
                message: "Secret paste block",
              })}
            </span>
            <strong>
              {formatRowValue(
                formatBooleanState(
                  hookConfiguration.effectiveHookUserPromptSubmitBlockSecretPasteEnabled,
                ),
                hookConfiguration.effectiveHookUserPromptSubmitBlockSecretPasteSource,
              )}
            </strong>
          </div>

          <div className="detail-row">
            <span>
              {i18n._({
                id: "Dangerous command block",
                message: "Dangerous command block",
              })}
            </span>
            <strong>
              {formatRowValue(
                formatBooleanState(
                  hookConfiguration.effectiveHookPreToolUseBlockDangerousCommandEnabled,
                ),
                hookConfiguration.effectiveHookPreToolUseDangerousCommandBlockSource,
              )}
            </strong>
          </div>

          <div className="detail-row">
            <span>
              {i18n._({
                id: "Protected governance paths",
                message: "Protected governance paths",
              })}
            </span>
            <strong
              title={(
                hookConfiguration.effectiveHookPreToolUseProtectedGovernancePaths ?? []
              ).join("\n")}
            >
              {formatRowValue(
                formatPathSummary(
                  hookConfiguration.effectiveHookPreToolUseProtectedGovernancePaths,
                ),
                hookConfiguration.effectiveHookPreToolUseProtectedGovernancePathsSource,
              )}
            </strong>
          </div>

          <div style={{ paddingTop: 12 }}>
            <Link
              className="ide-button ide-button--secondary ide-button--sm"
              onClick={() => activateGovernanceSettingsTab("overview")}
              to={GOVERNANCE_SETTINGS_PATH}
            >
              {i18n._({
                id: "Open governance settings",
                message: "Open governance settings",
              })}
            </Link>
          </div>
        </div>
      )}
    </DetailGroup>
  );
}
