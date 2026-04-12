import { Link, useLocation } from "react-router-dom";

import { SelectControl } from "../../components/ui/SelectControl";
import { DetailGroup } from "../../components/ui/DetailGroup";
import { InlineNotice } from "../../components/ui/InlineNotice";
import { LoadingState } from "../../components/ui/LoadingState";
import {
  formatLocalizedDateTime,
  formatLocalizedStatusLabel,
} from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import {
  activateGovernanceSettingsTab,
  GOVERNANCE_SETTINGS_PATH,
} from "../../features/settings/governanceNavigation";
import {
  buildWorkspaceHookRunsRoute,
  buildWorkspaceRoute,
  buildWorkspaceThreadRoute,
} from "../../lib/thread-routes";
import {
  formatTurnPolicyDecisionAction,
  formatTurnPolicyGovernanceLayer,
  formatTurnPolicyDecisionPolicyName,
  formatTurnPolicyDecisionReason,
  formatTurnPolicyDecisionSource,
  formatTurnPolicyDecisionTriggerMethod,
} from "../../lib/turn-policy-display";
import type { TurnPolicyDecision, Workspace } from "../../types/api";
import type { WorkspaceTurnPolicyDecisionFilters } from "./useWorkspaceTurnPolicyRecentDecisions";

export type WorkspaceTurnPolicyRecentDecisionsSectionProps = {
  selectedWorkspace?: Workspace | null;
  turnPolicyDecisions?: TurnPolicyDecision[] | null;
  hasAnyDecisions?: boolean;
  filters: WorkspaceTurnPolicyDecisionFilters;
  onChangeFilters: (filters: WorkspaceTurnPolicyDecisionFilters) => void;
  onResetFilters: () => void;
  threadScopeId?: string;
  turnPolicyDecisionsError?: string | null;
  turnPolicyDecisionsLoading: boolean;
};

const policyOptions = [
  { value: "", label: "All policies" },
  {
    value: "posttooluse/failed-validation-command",
    label: "Failed validation command",
  },
  {
    value: "stop/missing-successful-verification",
    label: "Missing successful verification",
  },
];

const actionOptions = [
  { value: "", label: "All actions" },
  { value: "steer", label: "Steer" },
  { value: "followUp", label: "Follow-up" },
  { value: "interrupt", label: "Interrupt" },
  { value: "none", label: "None" },
];

const actionStatusOptions = [
  { value: "", label: "All statuses" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
];

const sourceOptions = [
  { value: "", label: "All sources" },
  { value: "interactive", label: "Interactive" },
  { value: "automation", label: "Automation" },
  { value: "bot", label: "Bot" },
];

const reasonOptions = [
  { value: "", label: "All reasons" },
  { value: "duplicate_fingerprint", label: "Duplicate fingerprint" },
  { value: "follow_up_cooldown_active", label: "Follow-up cooldown active" },
  {
    value: "interrupt_no_active_turn",
    label: "Interrupt found no active turn",
  },
];

function hasVisibleFilters(
  filters: WorkspaceTurnPolicyDecisionFilters,
  threadScopeId?: string,
) {
  return Boolean(
    filters.policyName?.trim() ||
    filters.action?.trim() ||
    filters.actionStatus?.trim() ||
    filters.source?.trim() ||
    filters.reason?.trim() ||
    threadScopeId?.trim(),
  );
}

function formatDecisionCreatedAt(decision: TurnPolicyDecision) {
  return (
    decision.completedAt ||
    decision.decisionAt ||
    decision.evaluationStartedAt ||
    ""
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

function DecisionStatusBadge({ value }: { value?: string | null }) {
  return (
    <span className={`detail-badge detail-badge--${statusTone(value)}`}>
      {formatLocalizedStatusLabel(value, "—")}
    </span>
  );
}

export function WorkspaceTurnPolicyRecentDecisionsSection({
  selectedWorkspace,
  turnPolicyDecisions,
  hasAnyDecisions = false,
  filters,
  onChangeFilters,
  onResetFilters,
  threadScopeId,
  turnPolicyDecisionsError,
  turnPolicyDecisionsLoading,
}: WorkspaceTurnPolicyRecentDecisionsSectionProps) {
  const location = useLocation();
  const decisions = turnPolicyDecisions ?? [];
  const filteredView = hasVisibleFilters(filters, threadScopeId);
  const showGovernanceLink = !location.pathname.startsWith(
    GOVERNANCE_SETTINGS_PATH,
  );

  return (
    <DetailGroup
      title={i18n._({
        id: "Workspace Recent Policy Decisions",
        message: "Workspace Recent Policy Decisions",
      })}
    >
      {turnPolicyDecisionsLoading ? (
        <div className="pane-section-content">
          <LoadingState
            fill={false}
            message={i18n._({
              id: "Loading workspace policy decisions…",
              message: "Loading workspace policy decisions…",
            })}
          />
        </div>
      ) : turnPolicyDecisionsError ? (
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`workspace-policy-decisions-${turnPolicyDecisionsError}`}
            title={i18n._({
              id: "Workspace policy decisions unavailable",
              message: "Workspace policy decisions unavailable",
            })}
            tone="error"
          >
            {turnPolicyDecisionsError}
          </InlineNotice>
        </div>
      ) : !selectedWorkspace ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: "Select a workspace to inspect recent automatic policy decisions.",
              message:
                "Select a workspace to inspect recent automatic policy decisions.",
            })}
          </p>
        </div>
      ) : (
        <>
          {showGovernanceLink ? (
            <div className="pane-section-content" style={{ padding: "0 0 12px" }}>
              <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
                {i18n._({
                  id: "Open governance activity to compare these recent policy decisions with hook runs, workspace baseline, and runtime overrides in one place.",
                  message:
                    "Open governance activity to compare these recent policy decisions with hook runs, workspace baseline, and runtime overrides in one place.",
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
                  {i18n._({ id: "Policy filter", message: "Policy" })}
                </span>
                <SelectControl
                  ariaLabel={i18n._({
                    id: "Filter workspace decisions by policy",
                    message: "Filter workspace decisions by policy",
                  })}
                  fullWidth
                  onChange={(policyName) =>
                    onChangeFilters({ ...filters, policyName })
                  }
                  options={policyOptions}
                  value={filters.policyName ?? ""}
                />
              </label>
              <label className="field">
                <span>
                  {i18n._({ id: "Action filter", message: "Action" })}
                </span>
                <SelectControl
                  ariaLabel={i18n._({
                    id: "Filter workspace decisions by action",
                    message: "Filter workspace decisions by action",
                  })}
                  fullWidth
                  onChange={(action) => onChangeFilters({ ...filters, action })}
                  options={actionOptions}
                  value={filters.action ?? ""}
                />
              </label>
              <label className="field">
                <span>
                  {i18n._({ id: "Status filter", message: "Status" })}
                </span>
                <SelectControl
                  ariaLabel={i18n._({
                    id: "Filter workspace decisions by status",
                    message: "Filter workspace decisions by status",
                  })}
                  fullWidth
                  onChange={(actionStatus) =>
                    onChangeFilters({ ...filters, actionStatus })
                  }
                  options={actionStatusOptions}
                  value={filters.actionStatus ?? ""}
                />
              </label>
              <label className="field">
                <span>
                  {i18n._({ id: "Source filter", message: "Source" })}
                </span>
                <SelectControl
                  ariaLabel={i18n._({
                    id: "Filter workspace decisions by source",
                    message: "Filter workspace decisions by source",
                  })}
                  fullWidth
                  onChange={(source) => onChangeFilters({ ...filters, source })}
                  options={sourceOptions}
                  value={filters.source ?? ""}
                />
              </label>
              <label className="field">
                <span>
                  {i18n._({ id: "Reason filter", message: "Reason" })}
                </span>
                <SelectControl
                  ariaLabel={i18n._({
                    id: "Filter workspace decisions by reason",
                    message: "Filter workspace decisions by reason",
                  })}
                  fullWidth
                  onChange={(reason) => onChangeFilters({ ...filters, reason })}
                  options={reasonOptions}
                  value={filters.reason ?? ""}
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
              {threadScopeId ? (
                <span className="config-inline-note" style={{ margin: 0 }}>
                  {i18n._({
                    id: "Scoped to thread {threadId}.",
                    message: "Scoped to thread {threadId}.",
                    values: { threadId: threadScopeId },
                  })}
                </span>
              ) : null}
              <button
                className="ide-button ide-button--secondary ide-button--sm"
                onClick={onResetFilters}
                type="button"
              >
                {i18n._({
                  id: "Reset filters",
                  message: "Reset filters",
                })}
              </button>
            </div>
          </div>

          {!decisions.length ? (
            <div className="pane-section-content">
              <p className="config-inline-note" style={{ margin: 0 }}>
                {filteredView && hasAnyDecisions
                  ? i18n._({
                      id: "No policy decisions match the current filters.",
                      message: "No policy decisions match the current filters.",
                    })
                  : i18n._({
                      id: "No automatic policy decisions recorded for this workspace yet.",
                      message:
                        "No automatic policy decisions recorded for this workspace yet.",
                    })}
              </p>
              <Link
                className="ide-button ide-button--secondary ide-button--sm"
                to={buildWorkspaceRoute(selectedWorkspace.id)}
              >
                {i18n._({
                  id: "Open workspace",
                  message: "Open workspace",
                })}
              </Link>
            </div>
          ) : (
            <>
              <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                {threadScopeId
                  ? i18n._({
                      id: "Showing policy decisions for the scoped thread in this workspace.",
                      message:
                        "Showing policy decisions for the scoped thread in this workspace.",
                    })
                  : i18n._({
                      id: "Showing recent policy decisions across all threads in this workspace.",
                      message:
                        "Showing recent policy decisions across all threads in this workspace.",
                    })}
              </p>

              {decisions.map((decision, index) => (
                <div
                  key={decision.id}
                  style={{
                    borderTop:
                      index > 0 ? "1px solid var(--border-subtle)" : "none",
                    paddingTop: index > 0 ? 12 : 0,
                  }}
                >
                  <div className="detail-row detail-row--emphasis">
                    <span>
                      {i18n._({
                        id: "Policy",
                        message: "Policy",
                      })}
                    </span>
                    <strong title={decision.policyName}>
                      {formatTurnPolicyDecisionPolicyName(decision.policyName)}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>
                      {i18n._({
                        id: "Action",
                        message: "Action",
                      })}
                    </span>
                    <strong title={decision.action}>
                      {formatTurnPolicyDecisionAction(decision.action)}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>
                      {i18n._({
                        id: "Status",
                        message: "Status",
                      })}
                    </span>
                    <strong>
                      <DecisionStatusBadge value={decision.actionStatus} />
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>
                      {i18n._({
                        id: "Thread",
                        message: "Thread",
                      })}
                    </span>
                    <strong title={decision.threadId}>
                      {decision.threadId || "—"}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>
                      {i18n._({
                        id: "Source",
                        message: "Source",
                      })}
                    </span>
                    <strong title={decision.source}>
                      {formatTurnPolicyDecisionSource(decision.source)}
                    </strong>
                  </div>
                  {decision.governanceLayer?.trim() ? (
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Origin",
                          message: "Origin",
                        })}
                      </span>
                      <strong>
                        {formatTurnPolicyGovernanceLayer(
                          decision.governanceLayer,
                        )}
                      </strong>
                    </div>
                  ) : null}
                  <div className="detail-row">
                    <span>
                      {i18n._({
                        id: "Trigger",
                        message: "Trigger",
                      })}
                    </span>
                    <strong title={decision.triggerMethod}>
                      {formatTurnPolicyDecisionTriggerMethod(
                        decision.triggerMethod,
                      )}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>
                      {i18n._({
                        id: "Created",
                        message: "Created",
                      })}
                    </span>
                    <strong>
                      {formatLocalizedDateTime(
                        formatDecisionCreatedAt(decision),
                        "—",
                      )}
                    </strong>
                  </div>
                  {decision.reason?.trim() ? (
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Reason",
                          message: "Reason",
                        })}
                      </span>
                      <strong title={decision.reason.trim()}>
                        {formatTurnPolicyDecisionReason(decision.reason)}
                      </strong>
                    </div>
                  ) : null}
                  {decision.evidenceSummary?.trim() ? (
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Evidence",
                          message: "Evidence",
                        })}
                      </span>
                      <strong>{decision.evidenceSummary.trim()}</strong>
                    </div>
                  ) : null}
                  {decision.hookRunId?.trim() ? (
                    <div className="detail-row">
                      <span>
                        {i18n._({
                          id: "Hook Run",
                          message: "Hook Run",
                        })}
                      </span>
                      <strong title={decision.hookRunId.trim()}>
                        {decision.hookRunId.trim()}
                      </strong>
                    </div>
                  ) : null}
                  {decision.threadId ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 8 }}>
                      {decision.hookRunId?.trim() ? (
                        <Link
                          className="ide-button ide-button--secondary ide-button--sm"
                          to={buildWorkspaceHookRunsRoute(
                            decision.workspaceId || selectedWorkspace.id,
                            {
                              hookRunId: decision.hookRunId.trim(),
                              hookRunsThreadId: decision.threadId,
                            },
                          )}
                        >
                          {i18n._({
                            id: "View linked hook run",
                            message: "View linked hook run",
                          })}
                        </Link>
                      ) : null}
                      <Link
                        className="ide-button ide-button--secondary ide-button--sm"
                        to={buildWorkspaceThreadRoute(
                          decision.workspaceId || selectedWorkspace.id,
                          decision.threadId,
                        )}
                      >
                        {i18n._({
                          id: "Open thread",
                          message: "Open thread",
                        })}
                      </Link>
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          )}

          <div className="pane-section-content" style={{ padding: "12px 0 0" }}>
            <Link
              className="ide-button ide-button--secondary ide-button--sm"
              to={buildWorkspaceRoute(selectedWorkspace.id)}
            >
              {i18n._({
                id: "Open workspace",
                message: "Open workspace",
              })}
            </Link>
          </div>
        </>
      )}
    </DetailGroup>
  );
}
