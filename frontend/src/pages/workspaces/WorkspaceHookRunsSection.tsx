import { Link, useLocation } from "react-router-dom";

import { Input } from "../../components/ui/Input";
import { DetailGroup } from "../../components/ui/DetailGroup";
import { InlineNotice } from "../../components/ui/InlineNotice";
import { LoadingState } from "../../components/ui/LoadingState";
import {
  formatLocalizedDateTime,
  formatLocalizedStatusLabel,
  humanizeDisplayValue,
} from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import {
  activateGovernanceSettingsTab,
  GOVERNANCE_SETTINGS_PATH,
} from "../../features/settings/governanceNavigation";
import {
  formatHookRunHandlerLabel,
  formatHookRunFeedbackEntries,
  formatHookRunEventName,
  formatHookRunReason,
  formatHookRunTriggerMethodLabel,
  formatHookRunToolLabel,
  formatSessionStartSource,
} from "../../lib/hook-run-display";
import {
  buildWorkspaceRoute,
  buildWorkspaceThreadRoute,
} from "../../lib/thread-routes";
import type { HookRun, Workspace } from "../../types/api";
import type { WorkspaceHookRunFilters } from "./useWorkspaceHookRuns";

export type WorkspaceHookRunsSectionProps = {
  selectedWorkspace?: Workspace | null;
  hookRuns?: HookRun[] | null;
  hasAnyHookRuns?: boolean;
  filters: WorkspaceHookRunFilters;
  onChangeFilters: (filters: WorkspaceHookRunFilters) => void;
  onResetFilters: () => void;
  hookRunsError?: string | null;
  hookRunsLoading: boolean;
};

function hasVisibleFilters(filters: WorkspaceHookRunFilters) {
  return Boolean(
    filters.threadId?.trim() ||
      filters.eventName?.trim() ||
      filters.status?.trim() ||
      filters.handlerKey?.trim() ||
      filters.hookRunId?.trim(),
  );
}

function statusTone(value?: string | null) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (
    [
      "ready",
      "active",
      "connected",
      "completed",
      "success",
      "resolved",
      "succeeded",
    ].includes(normalized)
  ) {
    return "success";
  }

  if (
    [
      "running",
      "inprogress",
      "processing",
      "sending",
      "waiting",
      "starting",
      "streaming",
    ].includes(normalized)
  ) {
    return "info";
  }

  if (
    [
      "paused",
      "idle",
      "closed",
      "archived",
      "notloaded",
      "unknown",
      "nottracked",
      "skipped",
    ].includes(normalized)
  ) {
    return "warning";
  }

  if (
    ["error", "failed", "expired", "rejected", "denied"].includes(normalized)
  ) {
    return "danger";
  }

  return "neutral";
}

function HookStatusBadge({ value }: { value?: string | null }) {
  return (
    <span className={`detail-badge detail-badge--${statusTone(value)}`}>
      {formatLocalizedStatusLabel(value, "—")}
    </span>
  );
}

function formatDuration(durationMs?: number | null) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return "—";
  }

  return `${Math.round(durationMs)} ms`;
}

function formatHookFacet(value?: string | null) {
  return humanizeDisplayValue(value?.replaceAll("/", " / "), "—");
}

function formatStartedAt(run: HookRun) {
  return run.completedAt || run.startedAt || "";
}

export function WorkspaceHookRunsSection({
  selectedWorkspace,
  hookRuns,
  hasAnyHookRuns = false,
  filters,
  onChangeFilters,
  onResetFilters,
  hookRunsError,
  hookRunsLoading,
}: WorkspaceHookRunsSectionProps) {
  const location = useLocation();
  const runs = hookRuns ?? [];
  const filteredView = hasVisibleFilters(filters);
  const showGovernanceLink = !location.pathname.startsWith(
    GOVERNANCE_SETTINGS_PATH,
  );

  return (
    <DetailGroup
      title={i18n._({
        id: "Workspace Hook Runs",
        message: "Workspace Hook Runs",
      })}
    >
      {hookRunsLoading ? (
        <div className="pane-section-content">
          <LoadingState
            fill={false}
            message={i18n._({
              id: "Loading workspace hook runs…",
              message: "Loading workspace hook runs…",
            })}
          />
        </div>
      ) : hookRunsError ? (
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`workspace-hook-runs-${hookRunsError}`}
            title={i18n._({
              id: "Workspace hook runs unavailable",
              message: "Workspace hook runs unavailable",
            })}
            tone="error"
          >
            {hookRunsError}
          </InlineNotice>
        </div>
      ) : !selectedWorkspace ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: "Select a workspace to inspect governance hook runs.",
              message: "Select a workspace to inspect governance hook runs.",
            })}
          </p>
        </div>
      ) : (
        <>
          {showGovernanceLink ? (
            <div className="pane-section-content" style={{ padding: "0 0 12px" }}>
              <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
                {i18n._({
                  id: "Need the broader governance trail? Open governance activity to inspect these hook runs next to policy decisions and effective hook settings.",
                  message:
                    "Need the broader governance trail? Open governance activity to inspect these hook runs next to policy decisions and effective hook settings.",
                })}
              </p>
              <Link
                className="ide-button ide-button--secondary ide-button--sm"
                onClick={() => activateGovernanceSettingsTab("activity")}
                to={GOVERNANCE_SETTINGS_PATH}
              >
                {i18n._({
                  id: "Open governance activity",
                  message: "Open governance activity",
                })}
              </Link>
            </div>
          ) : null}
          <div className="pane-section-content" style={{ padding: "0 0 12px" }}>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              <label className="field">
                <span>
                  {i18n._({
                    id: "Hook run ID filter",
                    message: "Hook Run ID",
                  })}
                </span>
                <Input
                  onChange={(event) =>
                    onChangeFilters({
                      ...filters,
                      hookRunId: event.target.value,
                    })
                  }
                  placeholder={i18n._({
                    id: "Filter by hook run ID",
                    message: "Filter by hook run ID",
                  })}
                  value={filters.hookRunId ?? ""}
                />
              </label>
              <label className="field">
                <span>
                  {i18n._({
                    id: "Hook thread filter",
                    message: "Thread ID",
                  })}
                </span>
                <Input
                  onChange={(event) =>
                    onChangeFilters({
                      ...filters,
                      threadId: event.target.value,
                    })
                  }
                  placeholder={i18n._({
                    id: "Filter by thread ID",
                    message: "Filter by thread ID",
                  })}
                  value={filters.threadId ?? ""}
                />
              </label>
              <label className="field">
                <span>
                  {i18n._({
                    id: "Hook event filter",
                    message: "Event",
                  })}
                </span>
                <Input
                  onChange={(event) =>
                    onChangeFilters({
                      ...filters,
                      eventName: event.target.value,
                    })
                  }
                  placeholder={i18n._({
                    id: "Filter by event name",
                    message: "Filter by event name",
                  })}
                  value={filters.eventName ?? ""}
                />
              </label>
              <label className="field">
                <span>
                  {i18n._({
                    id: "Hook status filter",
                    message: "Status",
                  })}
                </span>
                <Input
                  onChange={(event) =>
                    onChangeFilters({
                      ...filters,
                      status: event.target.value,
                    })
                  }
                  placeholder={i18n._({
                    id: "Filter by status",
                    message: "Filter by status",
                  })}
                  value={filters.status ?? ""}
                />
              </label>
              <label className="field">
                <span>
                  {i18n._({
                    id: "Hook handler filter",
                    message: "Handler",
                  })}
                </span>
                <Input
                  onChange={(event) =>
                    onChangeFilters({
                      ...filters,
                      handlerKey: event.target.value,
                    })
                  }
                  placeholder={i18n._({
                    id: "Filter by handler key",
                    message: "Filter by handler key",
                  })}
                  value={filters.handlerKey ?? ""}
                />
              </label>
            </div>

            <div
              style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                paddingTop: 12,
              }}
            >
              <button
                className="ide-button ide-button--secondary ide-button--sm"
                onClick={onResetFilters}
                type="button"
              >
                {i18n._({
                  id: "Reset hook run filters",
                  message: "Reset filters",
                })}
              </button>
            </div>
          </div>

          {!runs.length ? (
            <div className="pane-section-content">
              <p className="config-inline-note" style={{ margin: 0 }}>
                {filteredView && hasAnyHookRuns
                  ? i18n._({
                      id: "No hook runs match the current filters.",
                      message: "No hook runs match the current filters.",
                    })
                  : i18n._({
                      id: "No governance hook runs recorded for this workspace yet.",
                      message:
                        "No governance hook runs recorded for this workspace yet.",
                    })}
              </p>
              <Link
                className="ide-button ide-button--secondary ide-button--sm"
                to={buildWorkspaceRoute(selectedWorkspace.id)}
              >
                {i18n._({
                  id: "Open workspace from hook runs",
                  message: "Open workspace",
                })}
              </Link>
            </div>
          ) : (
            <>
              <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                {filteredView
                  ? i18n._({
                      id: "Showing workspace hook runs narrowed by the current filters.",
                      message:
                        "Showing workspace hook runs narrowed by the current filters.",
                    })
                  : i18n._({
                      id: "Showing recent governance hook runs across all threads in this workspace.",
                      message:
                        "Showing recent governance hook runs across all threads in this workspace.",
                    })}
              </p>

              {runs.map((run, index) => {
                const feedback = formatHookRunFeedbackEntries(run.entries);
                const toolLabel = formatHookRunToolLabel(run.toolName, run.toolKind);

                return (
                  <div
                    key={run.id}
                    style={{
                      borderTop:
                        index > 0 ? "1px solid var(--border-subtle)" : "none",
                      paddingTop: index > 0 ? 12 : 0,
                    }}
                  >
                    <div className="detail-row detail-row--emphasis">
                      <span>
                        {i18n._({
                          id: "Hook run ID label",
                          message: "Hook Run",
                        })}
                      </span>
                      <strong title={run.id}>{run.id || "—"}</strong>
                    </div>
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Hook run event label",
                          message: "Event",
                        })}
                      </span>
                      <strong title={run.eventName}>
                        {formatHookRunEventName(run.eventName)}
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Hook run handler label",
                          message: "Handler",
                        })}
                      </span>
                      <strong title={run.handlerKey}>
                        {formatHookRunHandlerLabel(run.handlerKey) || "—"}
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Hook run status label",
                          message: "Status",
                        })}
                      </span>
                      <strong>
                        <HookStatusBadge value={run.status} />
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Hook run decision label",
                          message: "Decision",
                        })}
                      </span>
                      <strong>{formatHookFacet(run.decision)}</strong>
                    </div>
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Hook run trigger label",
                          message: "Trigger",
                        })}
                      </span>
                      <strong title={run.triggerMethod}>
                        {formatHookRunTriggerMethodLabel(run.triggerMethod) || "—"}
                      </strong>
                    </div>
                    {run.sessionStartSource?.trim() ? (
                      <div className="detail-row">
                        <span>
                          {i18n._({
                            id: "Hook run session start source label",
                            message: "Session Start Source",
                          })}
                        </span>
                        <strong>
                          {formatSessionStartSource(run.sessionStartSource)}
                        </strong>
                      </div>
                    ) : null}
                    {run.threadId?.trim() ? (
                      <div className="detail-row">
                        <span>
                          {i18n._({
                            id: "Hook run thread label",
                            message: "Thread",
                          })}
                        </span>
                        <strong title={run.threadId}>{run.threadId.trim()}</strong>
                      </div>
                    ) : null}
                    {toolLabel ? (
                      <div className="detail-row">
                        <span>
                          {i18n._({
                            id: "Hook run tool label",
                            message: "Tool",
                          })}
                        </span>
                        <strong title={run.toolName?.trim() || run.toolKind?.trim() || toolLabel}>
                          {toolLabel}
                        </strong>
                      </div>
                    ) : null}
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Hook run created label",
                          message: "Created",
                        })}
                      </span>
                      <strong>
                        {formatLocalizedDateTime(formatStartedAt(run), "—")}
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Hook run duration label",
                          message: "Duration",
                        })}
                      </span>
                      <strong>{formatDuration(run.durationMs)}</strong>
                    </div>
                    {run.reason?.trim() ? (
                      <div className="detail-row">
                        <span>
                          {i18n._({
                            id: "Hook run reason label",
                            message: "Reason",
                          })}
                        </span>
                        <strong title={run.reason}>
                          {formatHookRunReason(run.reason)}
                        </strong>
                      </div>
                    ) : null}
                    {feedback ? (
                      <div className="detail-row">
                        <span>
                          {i18n._({
                            id: "Hook run feedback label",
                            message: "Feedback",
                          })}
                        </span>
                        <strong title={feedback}>{feedback}</strong>
                      </div>
                    ) : null}
                    {run.additionalContext?.trim() ? (
                      <div className="detail-row">
                        <span>
                          {i18n._({
                            id: "Hook run context label",
                            message: "Context",
                          })}
                        </span>
                        <strong title={run.additionalContext}>
                          {run.additionalContext.trim()}
                        </strong>
                      </div>
                    ) : null}
                    {run.error?.trim() ? (
                      <div className="detail-row">
                        <span>
                          {i18n._({
                            id: "Hook run error label",
                            message: "Error",
                          })}
                        </span>
                        <strong>{run.error.trim()}</strong>
                      </div>
                    ) : null}
                    {run.threadId?.trim() ? (
                      <div style={{ paddingTop: 8 }}>
                        <Link
                          className="ide-button ide-button--secondary ide-button--sm"
                          to={buildWorkspaceThreadRoute(
                            run.workspaceId || selectedWorkspace.id,
                            run.threadId,
                          )}
                        >
                          {i18n._({
                            id: "Open hook run thread",
                            message: "Open thread",
                          })}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}

          <div className="pane-section-content" style={{ padding: "12px 0 0" }}>
            <Link
              className="ide-button ide-button--secondary ide-button--sm"
              to={buildWorkspaceRoute(selectedWorkspace.id)}
            >
              {i18n._({
                id: "Open workspace after hook runs",
                message: "Open workspace",
              })}
            </Link>
          </div>
        </>
      )}
    </DetailGroup>
  );
}
