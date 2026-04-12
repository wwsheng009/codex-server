import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { InlineNotice } from "../../components/ui/InlineNotice";
import { Input } from "../../components/ui/Input";
import { SelectControl } from "../../components/ui/SelectControl";
import { TextArea } from "../../components/ui/TextArea";
import {
  activateGovernanceSettingsTab,
  GOVERNANCE_SETTINGS_PATH,
} from "../../features/settings/governanceNavigation";
import { writeWorkspaceHookConfiguration } from "../../features/workspaces/api";
import { i18n } from "../../i18n/runtime";
import {
  DEFAULT_SESSION_START_TEMPLATE,
  renderSessionStartTemplatePreview,
} from "../../lib/session-start-template";
import { getErrorMessage } from "../../lib/error-utils";
import type {
  Workspace,
  WorkspaceHookConfigurationResult,
} from "../../types/api";

type WorkspaceHookConfigurationEditorSectionProps = {
  selectedWorkspace?: Workspace;
  hookConfiguration?: WorkspaceHookConfigurationResult;
};

type TriStateValue = "inherit" | "enabled" | "disabled";

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
  switch (value) {
    case "enabled":
      return true;
    case "disabled":
      return false;
    default:
      return null;
  }
}

function normalizeContextPathsInput(value: string) {
  const segments = value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const segment of segments) {
    let normalized = segment.replaceAll("\\", "/");
    while (normalized.includes("//")) {
      normalized = normalized.replaceAll("//", "/");
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function formatContextPathsInput(values?: string[] | null) {
  return (values ?? []).join("\n");
}

function hasConfiguredOverride(value: unknown) {
  return value !== undefined && value !== null;
}

function hasPathValues(values?: string[] | null) {
  return (values ?? []).some((value) => value.trim());
}

function formatWorkspaceHookLoadStatusLabel(status?: string | null) {
  switch ((status ?? "").trim()) {
    case "loaded":
      return i18n._({ id: "Loaded", message: "Loaded" });
    case "error":
      return i18n._({ id: "Error", message: "Error" });
    case "missing":
    case "not_found":
      return i18n._({ id: "Not found", message: "Not found" });
    default:
      return status?.trim() || i18n._({ id: "Not found", message: "Not found" });
  }
}

export function WorkspaceHookConfigurationEditorSection({
  selectedWorkspace,
  hookConfiguration,
}: WorkspaceHookConfigurationEditorSectionProps) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [sessionStartEnabled, setSessionStartEnabled] =
    useState<TriStateValue>("inherit");
  const [sessionStartContextPaths, setSessionStartContextPaths] = useState("");
  const [sessionStartMaxChars, setSessionStartMaxChars] = useState("");
  const [sessionStartTemplate, setSessionStartTemplate] = useState("");
  const [secretPasteBlockEnabled, setSecretPasteBlockEnabled] =
    useState<TriStateValue>("inherit");
  const [dangerousCommandBlockEnabled, setDangerousCommandBlockEnabled] =
    useState<TriStateValue>("inherit");
  const [additionalProtectedGovernancePaths, setAdditionalProtectedGovernancePaths] =
    useState("");
  const runtimeOverrideCount = [
    hasConfiguredOverride(hookConfiguration?.configuredHookSessionStartEnabled),
    hasPathValues(hookConfiguration?.configuredHookSessionStartContextPaths),
    hasConfiguredOverride(hookConfiguration?.configuredHookSessionStartMaxChars),
    hasConfiguredOverride(hookConfiguration?.configuredHookSessionStartTemplate),
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
  const showGovernanceLink = !location.pathname.startsWith(
    GOVERNANCE_SETTINGS_PATH,
  );
  const sessionStartTemplatePreview = renderSessionStartTemplatePreview(
    sessionStartTemplate,
  );

  useEffect(() => {
    setSessionStartEnabled(
      formatTriStateValue(hookConfiguration?.baselineHookSessionStartEnabled),
    );
    setSessionStartContextPaths(
      formatContextPathsInput(
        hookConfiguration?.baselineHookSessionStartContextPaths,
      ),
    );
    setSessionStartMaxChars(
      typeof hookConfiguration?.baselineHookSessionStartMaxChars === "number"
        ? String(hookConfiguration.baselineHookSessionStartMaxChars)
        : "",
    );
    setSessionStartTemplate(
      hookConfiguration?.baselineHookSessionStartTemplate ?? "",
    );
    setSecretPasteBlockEnabled(
      formatTriStateValue(
        hookConfiguration?.baselineHookUserPromptSubmitBlockSecretPasteEnabled,
      ),
    );
    setDangerousCommandBlockEnabled(
      formatTriStateValue(
        hookConfiguration?.baselineHookPreToolUseBlockDangerousCommandEnabled,
      ),
    );
    setAdditionalProtectedGovernancePaths(
      formatContextPathsInput(
        hookConfiguration?.baselineHookPreToolUseAdditionalProtectedGovernancePaths,
      ),
    );
  }, [
    hookConfiguration?.baselineHookPreToolUseAdditionalProtectedGovernancePaths,
    hookConfiguration?.baselineHookPreToolUseBlockDangerousCommandEnabled,
    hookConfiguration?.baselineHookSessionStartContextPaths,
    hookConfiguration?.baselineHookSessionStartEnabled,
    hookConfiguration?.baselineHookSessionStartMaxChars,
    hookConfiguration?.baselineHookSessionStartTemplate,
    hookConfiguration?.baselineHookUserPromptSubmitBlockSecretPasteEnabled,
    selectedWorkspace?.id,
  ]);

  const writeMutation = useMutation({
    mutationFn: (resetAll: boolean) => {
      if (!selectedWorkspace) {
        throw new Error("workspace selection is required");
      }

      return writeWorkspaceHookConfiguration(
        selectedWorkspace.id,
        resetAll
          ? {}
          : {
              hookSessionStartEnabled:
                parseTriStateValue(sessionStartEnabled),
              hookSessionStartContextPaths: normalizeContextPathsInput(
                sessionStartContextPaths,
              ),
              hookSessionStartMaxChars: sessionStartMaxChars.trim()
                ? Number(sessionStartMaxChars)
                : null,
              hookSessionStartTemplate: sessionStartTemplate.trim() || null,
              hookUserPromptSubmitBlockSecretPasteEnabled: parseTriStateValue(
                secretPasteBlockEnabled,
              ),
              hookPreToolUseBlockDangerousCommandEnabled: parseTriStateValue(
                dangerousCommandBlockEnabled,
              ),
              hookPreToolUseAdditionalProtectedGovernancePaths:
                normalizeContextPathsInput(additionalProtectedGovernancePaths),
            },
      );
    },
    onSuccess: (result) => {
      if (!selectedWorkspace) {
        return;
      }

      queryClient.setQueryData(
        ["workspace-hook-configuration", selectedWorkspace.id],
        result.configuration,
      );
    },
  });

  if (!selectedWorkspace) {
    return null;
  }

  return (
    <form
      className="config-card"
      onSubmit={(event) => {
        event.preventDefault();
        writeMutation.mutate(false);
      }}
    >
      <div className="config-card__header">
        <strong>
          {i18n._({
            id: "Workspace Hook Baseline",
            message: "Workspace Hook Baseline",
          })}
        </strong>
        <div className="setting-row__actions">
          {showGovernanceLink ? (
            <Link
              className="ide-button ide-button--secondary ide-button--sm"
              onClick={() => activateGovernanceSettingsTab("workspace")}
              to={GOVERNANCE_SETTINGS_PATH}
            >
              {i18n._({
                id: "Open governance workspace",
                message: "Open governance workspace",
              })}
            </Link>
          ) : null}
          <button
            className="ide-button ide-button--secondary ide-button--sm"
            disabled={writeMutation.isPending}
            onClick={() => writeMutation.mutate(true)}
            type="button"
          >
            {i18n._({
              id: "Reset Workspace Baseline",
              message: "Reset Workspace Baseline",
            })}
          </button>
          <button className="ide-button ide-button--primary ide-button--sm" type="submit">
            {writeMutation.isPending
              ? i18n._({ id: "Saving…", message: "Saving…" })
              : i18n._({
                  id: "Save Workspace Baseline",
                  message: "Save Workspace Baseline",
                })}
          </button>
        </div>
      </div>

      <div className="form-stack">
        <p className="config-inline-note">
          {i18n._({
            id: "This editor writes only the workspace baseline to .codex/hooks.json in the current workspace.",
            message:
              "This editor writes only the workspace baseline to .codex/hooks.json in the current workspace.",
          })}
        </p>
        <p className="config-inline-note">
          {i18n._({
            id: "Runtime preferences are separate global overrides. Effective hook behavior is resolved from built-in defaults, workspace hooks.json first, CODEX_HOME/hooks.json fallback when needed, and any saved runtime overrides.",
            message:
              "Runtime preferences are separate global overrides. Effective hook behavior is resolved from built-in defaults, workspace hooks.json first, CODEX_HOME/hooks.json fallback when needed, and any saved runtime overrides.",
          })}
        </p>

        {runtimeOverrideCount > 0 ? (
          <InlineNotice
            noticeKey={`workspace-hook-editor-runtime-override-${runtimeOverrideCount}`}
            title={i18n._({
              id: "Runtime overrides are active",
              message: "Runtime overrides are active",
            })}
          >
            {i18n._({
              id: "{count} runtime override values are currently configured. Saving this form updates only workspace .codex/hooks.json and does not clear those overrides.",
              message:
                "{count} runtime override values are currently configured. Saving this form updates only workspace .codex/hooks.json and does not clear those overrides.",
              values: {
                count: runtimeOverrideCount,
              },
            })}
          </InlineNotice>
        ) : null}

        {hookConfiguration?.loadStatus === "error" &&
        hookConfiguration.loadError ? (
          <InlineNotice
            noticeKey={`workspace-hook-editor-invalid-${hookConfiguration.loadError}`}
            title={i18n._({
              id: "Existing hooks.json is invalid",
              message: "Existing hooks.json is invalid",
            })}
            tone="error"
          >
            {i18n._({
              id: "Saving this form will replace the invalid workspace hooks.json file.",
              message:
                "Saving this form will replace the invalid workspace hooks.json file.",
            })}{" "}
            {hookConfiguration.loadError}
          </InlineNotice>
        ) : null}

        {writeMutation.isSuccess ? (
          <InlineNotice
            noticeKey={`workspace-hook-editor-success-${writeMutation.data?.status ?? "saved"}`}
            title={i18n._({
              id: "Workspace hook baseline updated",
              message: "Workspace hook baseline updated",
            })}
          >
            {writeMutation.data?.status === "deleted"
              ? i18n._({
                  id: "Workspace hook baseline has been cleared and supported hooks.json files were removed.",
                  message:
                    "Workspace hook baseline has been cleared and supported hooks.json files were removed.",
                })
              : i18n._({
                  id: "Workspace hook baseline has been written to {path}.",
                  message:
                    "Workspace hook baseline has been written to {path}.",
                  values: {
                    path: writeMutation.data?.filePath ?? ".codex/hooks.json",
                  },
                })}
          </InlineNotice>
        ) : null}

        {writeMutation.isError ? (
          <InlineNotice
            noticeKey={`workspace-hook-editor-error-${getErrorMessage(writeMutation.error)}`}
            title={i18n._({
              id: "Failed to update workspace hook baseline",
              message: "Failed to update workspace hook baseline",
            })}
            tone="error"
          >
            {getErrorMessage(writeMutation.error)}
          </InlineNotice>
        ) : null}

        <div className="runtime-inline-meta runtime-inline-meta--dense">
          <div className="runtime-inline-meta__entry">
            <span>
              {i18n._({
                id: "Target file",
                message: "Target file",
              })}
            </span>
            <strong>{hookConfiguration?.loadedFromPath ?? `${selectedWorkspace.rootPath}\\.codex\\hooks.json`}</strong>
          </div>
          <div className="runtime-inline-meta__entry">
            <span>
              {i18n._({
                id: "Workspace status",
                message: "Workspace status",
              })}
            </span>
            <strong>
              {formatWorkspaceHookLoadStatusLabel(hookConfiguration?.loadStatus)}
            </strong>
          </div>
          <div className="runtime-inline-meta__entry">
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
                      count: runtimeOverrideCount,
                    },
                  })
                : i18n._({
                    id: "None",
                    message: "None",
                  })}
            </strong>
          </div>
        </div>

        <label className="field">
          <span>
            {i18n._({
              id: "SessionStart baseline",
              message: "SessionStart baseline",
            })}
          </span>
          <SelectControl
            ariaLabel={i18n._({
              id: "Select workspace session start baseline",
              message: "Select workspace session start baseline",
            })}
            fullWidth
            onChange={(value) => setSessionStartEnabled(value as TriStateValue)}
            options={[
              {
                value: "inherit",
                label: i18n._({
                  id: "Inherit default",
                  message: "Inherit default",
                }),
              },
              {
                value: "enabled",
                label: i18n._({
                  id: "Enabled",
                  message: "Enabled",
                }),
              },
              {
                value: "disabled",
                label: i18n._({
                  id: "Disabled",
                  message: "Disabled",
                }),
              },
            ]}
            value={sessionStartEnabled}
          />
        </label>

          <TextArea
            hint={i18n._({
              id: "One candidate path per line. This saves only workspace .codex/hooks.json. If runtime preferences define SessionStart context paths, those effective paths replace both workspace and CODEX_HOME baseline paths at runtime.",
              message:
                "One candidate path per line. This saves only workspace .codex/hooks.json. If runtime preferences define SessionStart context paths, those effective paths replace both workspace and CODEX_HOME baseline paths at runtime.",
            })}
          label={i18n._({
            id: "SessionStart context paths",
            message: "SessionStart context paths",
          })}
          onChange={(event) => setSessionStartContextPaths(event.target.value)}
          placeholder={i18n._({
            id: "SessionStart context paths placeholder",
            message: ".codex/SESSION_START.md\n.codex/session-start.md",
          })}
          rows={5}
          value={sessionStartContextPaths}
        />

        <Input
          hint={i18n._({
            id: "Leave blank to keep this workspace baseline unset. The effective SessionStart max chars can still come from a runtime override or the built-in default.",
            message:
              "Leave blank to keep this workspace baseline unset. The effective SessionStart max chars can still come from a runtime override or the built-in default.",
          })}
          label={i18n._({
            id: "SessionStart max chars",
            message: "SessionStart max chars",
          })}
          min={1}
          onChange={(event) => setSessionStartMaxChars(event.target.value)}
          type="number"
          value={sessionStartMaxChars}
        />

        <TextArea
          hint={i18n._({
            id: "Optional template for the final injected prompt. Use {{context}} and {{user_request}}. {{source_path_line}} inserts the full source line only when a file matched.",
            message:
              "Optional template for the final injected prompt. Use {{context}} and {{user_request}}. {{source_path_line}} inserts the full source line only when a file matched.",
          })}
          label={i18n._({
            id: "SessionStart template",
            message: "SessionStart template",
          })}
          onChange={(event) => setSessionStartTemplate(event.target.value)}
          placeholder={i18n._({
            id: "SessionStart template placeholder",
            message:
              "在处理当前请求前，请先遵循以下项目上下文与约定。\n{{source_path_line}}项目上下文摘录：\n{{context}}\n\n用户请求：\n{{user_request}}",
          })}
          rows={8}
          value={sessionStartTemplate}
        />

        <div className="setting-row__actions">
          <button
            className="ide-button ide-button--secondary ide-button--sm"
            onClick={() => setSessionStartTemplate(DEFAULT_SESSION_START_TEMPLATE)}
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

        <label className="field">
          <span>
            {i18n._({
              id: "Secret paste block baseline",
              message: "Secret paste block baseline",
            })}
          </span>
          <SelectControl
            ariaLabel={i18n._({
              id: "Select workspace secret paste baseline",
              message: "Select workspace secret paste baseline",
            })}
            fullWidth
            onChange={(value) =>
              setSecretPasteBlockEnabled(value as TriStateValue)
            }
            options={[
              {
                value: "inherit",
                label: i18n._({
                  id: "Inherit default",
                  message: "Inherit default",
                }),
              },
              {
                value: "enabled",
                label: i18n._({
                  id: "Enabled",
                  message: "Enabled",
                }),
              },
              {
                value: "disabled",
                label: i18n._({
                  id: "Disabled",
                  message: "Disabled",
                }),
              },
            ]}
            value={secretPasteBlockEnabled}
          />
        </label>

        <label className="field">
          <span>
            {i18n._({
              id: "Dangerous command block baseline",
              message: "Dangerous command block baseline",
            })}
          </span>
          <SelectControl
            ariaLabel={i18n._({
              id: "Select workspace dangerous command baseline",
              message: "Select workspace dangerous command baseline",
            })}
            fullWidth
            onChange={(value) =>
              setDangerousCommandBlockEnabled(value as TriStateValue)
            }
            options={[
              {
                value: "inherit",
                label: i18n._({
                  id: "Inherit default",
                  message: "Inherit default",
                }),
              },
              {
                value: "enabled",
                label: i18n._({
                  id: "Enabled",
                  message: "Enabled",
                }),
              },
              {
                value: "disabled",
                label: i18n._({
                  id: "Disabled",
                  message: "Disabled",
                }),
              },
            ]}
            value={dangerousCommandBlockEnabled}
          />
        </label>

        <TextArea
          hint={i18n._({
            id: "Optional workspace-level additions to the protected governance path set. Built-in protected paths stay enforced, and runtime preferences can add more effective paths on top.",
            message:
              "Optional workspace-level additions to the protected governance path set. Built-in protected paths stay enforced, and runtime preferences can add more effective paths on top.",
          })}
          label={i18n._({
            id: "Additional protected governance paths",
            message: "Additional protected governance paths",
          })}
          onChange={(event) =>
            setAdditionalProtectedGovernancePaths(event.target.value)
          }
          placeholder={i18n._({
            id: "Additional protected governance paths placeholder",
            message: "docs/governance.md\nops/release-policy.md",
          })}
          rows={4}
          value={additionalProtectedGovernancePaths}
        />
      </div>
    </form>
  );
}
