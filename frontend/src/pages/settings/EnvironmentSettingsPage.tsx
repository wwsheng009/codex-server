import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  SettingsGroup,
  SettingsJsonPreview,
  SettingRow,
  SettingsPageHeader,
  SettingsRecord,
} from '../../components/settings/SettingsPrimitives'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { StatusPill } from '../../components/ui/StatusPill'
import {
  buildShellEnvironmentDiagnosis,
  createCoreWindowsShellEnvironmentPolicy,
  createInheritAllShellEnvironmentPolicy,
} from '../../features/settings/shell-environment-diagnostics'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import { readConfig, readRuntimePreferences, writeConfigValue } from '../../features/settings/api'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { getWorkspaceRuntimeState, restartWorkspace } from '../../features/workspaces/api'
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'

export function EnvironmentSettingsPage() {
  const queryClient = useQueryClient()
  const {
    setSelectedWorkspaceId,
    workspaceId,
    workspaceName,
    workspaces,
    workspacesLoading,
    workspacesError,
  } = useSettingsShellContext()

  const healthyWorkspaces = useMemo(
    () => workspaces.filter((workspace) => ['ready', 'active', 'connected'].includes(workspace.runtimeStatus)).length,
    [workspaces],
  )
  const attentionWorkspaces = workspaces.length - healthyWorkspaces
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId),
    [workspaceId, workspaces],
  )

  const runtimePreferencesQuery = useQuery({
    queryKey: ['settings-runtime-preferences'],
    queryFn: readRuntimePreferences,
  })
  const selectedWorkspaceConfigQuery = useQuery({
    queryKey: ['environment-config', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readConfig(workspaceId!, { includeLayers: true }),
  })
  const workspaceRuntimeStateQuery = useQuery({
    queryKey: ['environment-runtime-state', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => getWorkspaceRuntimeState(workspaceId!),
  })
  const restartWorkspaceMutation = useMutation({
    mutationFn: (selectedId: string) => restartWorkspace(selectedId),
    onSuccess: async (_, selectedId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-config', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-runtime-state', selectedId] }),
      ])
    },
  })
  const applyShellEnvironmentPolicyPresetMutation = useMutation({
    mutationFn: async (preset: 'inherit-all' | 'core-windows') => {
      if (!workspaceId) {
        throw new Error('A workspace must be selected before applying a shell environment preset.')
      }

      const value =
        preset === 'core-windows'
          ? createCoreWindowsShellEnvironmentPolicy()
          : createInheritAllShellEnvironmentPolicy()

      await writeConfigValue(workspaceId, {
        keyPath: 'shell_environment_policy',
        mergeStrategy: 'upsert',
        value,
      })

      return restartWorkspace(workspaceId)
    },
    onSuccess: async (_, __) => {
      if (!workspaceId) {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-requirements', workspaceId] }),
      ])
    },
  })

  const shellEnvironmentPolicy = useMemo<Record<string, unknown> | null>(() => {
    const config = selectedWorkspaceConfigQuery.data?.config
    if (!config || typeof config !== 'object') {
      return null
    }

    const value = config['shell_environment_policy']
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }, [selectedWorkspaceConfigQuery.data?.config])

  const shellEnvironmentOrigins = useMemo(() => {
    const origins = selectedWorkspaceConfigQuery.data?.origins
    if (!origins || typeof origins !== 'object') {
      return null
    }

    const matchedEntries = Object.entries(origins).filter(([key]) =>
      key === 'shell_environment_policy' || key.startsWith('shell_environment_policy.'),
    )
    if (!matchedEntries.length) {
      return null
    }

    return Object.fromEntries(matchedEntries)
  }, [selectedWorkspaceConfigQuery.data?.origins])
  const shellEnvironmentDiagnosis = useMemo(
    () => buildShellEnvironmentDiagnosis(shellEnvironmentPolicy),
    [shellEnvironmentPolicy],
  )

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description={i18n._({
          id: 'Inspect the registered project roots and runtime posture for the current client environment.',
          message: 'Inspect the registered project roots and runtime posture for the current client environment.',
        })}
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">
              {i18n._({
                id: '{count} roots',
                message: '{count} roots',
                values: { count: workspaces.length },
              })}
            </span>
          </>
        }
        title={i18n._({ id: 'Environment', message: 'Environment' })}
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description={i18n._({
            id: 'Global environment snapshot across all registered workspaces.',
            message: 'Global environment snapshot across all registered workspaces.',
          })}
          title={i18n._({ id: 'Workspace Registry', message: 'Workspace Registry' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Review the current runtime footprint and health across all registered roots.',
              message: 'Review the current runtime footprint and health across all registered roots.',
            })}
            title={i18n._({ id: 'Summary', message: 'Summary' })}
          >
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>{i18n._({ id: 'Total', message: 'Total' })}</span>
                <strong>{workspaces.length}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Healthy', message: 'Healthy' })}</span>
                <strong>{healthyWorkspaces}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Attention', message: 'Attention' })}</span>
                <strong>{attentionWorkspaces}</strong>
              </div>
            </div>
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Each registered workspace acts as an environment root for threads, runtime tools, and settings-scoped actions.',
              message:
                'Each registered workspace acts as an environment root for threads, runtime tools, and settings-scoped actions.',
            })}
            title={i18n._({ id: 'Registered Roots', message: 'Registered Roots' })}
          >
            {workspacesLoading ? (
              <div className="notice">{i18n._({ id: 'Loading workspaces…', message: 'Loading workspaces…' })}</div>
            ) : null}
            {workspacesError ? (
              <InlineNotice
                dismissible
                noticeKey={`environment-workspaces-${workspacesError}`}
                title={i18n._({ id: 'Failed To Load Workspaces', message: 'Failed To Load Workspaces' })}
                tone="error"
              >
                {workspacesError}
              </InlineNotice>
            ) : null}
            {!workspacesLoading && !workspaces.length ? (
              <div className="empty-state">
                {i18n._({
                  id: 'No workspaces registered yet.',
                  message: 'No workspaces registered yet.',
                })}
              </div>
            ) : null}
            <div className="settings-record-list">
              {workspaces.map((workspace) => (
                <SettingsRecord
                  action={
                    <span className="meta-pill">
                      {i18n._({ id: 'Environment Root', message: 'Environment Root' })}
                    </span>
                  }
                  description={i18n._({
                    id: '{root} · updated {time}',
                    message: '{root} · updated {time}',
                    values: {
                      root: workspace.rootPath,
                      time: formatRelativeTimeShort(workspace.updatedAt),
                    },
                  })}
                  key={workspace.id}
                  marker="EN"
                  meta={
                    <>
                      <span className="meta-pill">{workspace.id.slice(0, 8)}</span>
                      <StatusPill status={workspace.runtimeStatus} />
                    </>
                  }
                  title={workspace.name}
                />
              ))}
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Inspect the effective app-server command and the shell environment policy currently resolved for the selected workspace.',
            message:
              'Inspect the effective app-server command and the shell environment policy currently resolved for the selected workspace.',
          })}
          title={i18n._({ id: 'Runtime Inspection', message: 'Runtime Inspection' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Switch the focused workspace to inspect its runtime-backed config and restart behavior.',
              message:
                'Switch the focused workspace to inspect its runtime-backed config and restart behavior.',
            })}
            title={i18n._({ id: 'Selected Workspace', message: 'Selected Workspace' })}
          >
            <div className="form-stack">
              <label className="field">
                <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
                <select
                  onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                  value={workspaceId ?? ''}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="header-actions">
                <span className="meta-pill">
                  {selectedWorkspace?.runtimeStatus ?? i18n._({ id: 'Unknown', message: 'Unknown' })}
                </span>
                <button
                  className="ide-button ide-button--secondary"
                  disabled={!workspaceId || restartWorkspaceMutation.isPending}
                  onClick={() => workspaceId && restartWorkspaceMutation.mutate(workspaceId)}
                  type="button"
                >
                  {restartWorkspaceMutation.isPending
                    ? i18n._({ id: 'Restarting…', message: 'Restarting…' })
                    : i18n._({ id: 'Restart Runtime', message: 'Restart Runtime' })}
                </button>
              </div>
              <p className="config-inline-note">
                {i18n._({
                  id: 'Changing shell_environment_policy affects new child processes. Restart the workspace runtime to force app-server to reload Codex config.',
                  message:
                    'Changing shell_environment_policy affects new child processes. Restart the workspace runtime to force app-server to reload Codex config.',
                })}
              </p>
              {workspaceRuntimeStateQuery.data ? (
                <SettingsJsonPreview
                  collapsible={false}
                  description={i18n._({
                    id: 'Observed runtime process state for the selected workspace.',
                    message: 'Observed runtime process state for the selected workspace.',
                  })}
                  title={i18n._({ id: 'Runtime State', message: 'Runtime State' })}
                  value={workspaceRuntimeStateQuery.data}
                />
              ) : null}
            </div>
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Global app-server launch command after codex-server runtime preference resolution.',
              message:
                'Global app-server launch command after codex-server runtime preference resolution.',
            })}
            title={i18n._({ id: 'Effective Command', message: 'Effective Command' })}
          >
            {runtimePreferencesQuery.data ? (
              <SettingsJsonPreview
                collapsible={false}
                description={i18n._({
                  id: 'This is the command codex-server will use when it starts or restarts a workspace runtime.',
                  message:
                    'This is the command codex-server will use when it starts or restarts a workspace runtime.',
                })}
                title={i18n._({ id: 'App-Server Command', message: 'App-Server Command' })}
                value={{ effectiveCommand: runtimePreferencesQuery.data.effectiveCommand }}
              />
            ) : (
              <div className="notice">{i18n._({ id: 'Loading runtime preferences…', message: 'Loading runtime preferences…' })}</div>
            )}
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Resolved shell_environment_policy from config/read for the currently selected workspace.',
              message:
                'Resolved shell_environment_policy from config/read for the currently selected workspace.',
            })}
            title={i18n._({ id: 'Shell Environment Policy', message: 'Shell Environment Policy' })}
          >
            <div className="form-stack">
              {selectedWorkspaceConfigQuery.isLoading ? (
                <div className="notice">{i18n._({ id: 'Loading workspace config…', message: 'Loading workspace config…' })}</div>
              ) : null}
              {selectedWorkspaceConfigQuery.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`environment-config-${workspaceId}`}
                  title={i18n._({ id: 'Failed To Load Runtime Config', message: 'Failed To Load Runtime Config' })}
                  tone="error"
                >
                  {getErrorMessage(selectedWorkspaceConfigQuery.error)}
                </InlineNotice>
              ) : null}
              <SettingsJsonPreview
                collapsible={false}
                description={i18n._({
                  id: 'Structured diagnosis derived from the currently resolved shell_environment_policy object.',
                  message:
                    'Structured diagnosis derived from the currently resolved shell_environment_policy object.',
                })}
                title={i18n._({ id: 'Diagnosis', message: 'Diagnosis' })}
                value={shellEnvironmentDiagnosis.summary}
              />
              {shellEnvironmentDiagnosis.warning ? (
                <InlineNotice
                  noticeKey={`shell-environment-warning-${workspaceId}-${shellEnvironmentDiagnosis.summary.inherit}`}
                  title={i18n._({ id: 'Potential Windows Execution Risk', message: 'Potential Windows Execution Risk' })}
                  tone="error"
                >
                  {shellEnvironmentDiagnosis.warning}
                </InlineNotice>
              ) : (
                <InlineNotice
                  noticeKey={`shell-environment-info-${workspaceId}-${shellEnvironmentDiagnosis.summary.inherit}`}
                  title={i18n._({ id: 'Environment Check', message: 'Environment Check' })}
                >
                  {shellEnvironmentDiagnosis.info}
                </InlineNotice>
              )}
              <div className="header-actions">
                <button
                  className="ide-button ide-button--secondary"
                  disabled={!workspaceId || applyShellEnvironmentPolicyPresetMutation.isPending}
                  onClick={() => applyShellEnvironmentPolicyPresetMutation.mutate('inherit-all')}
                  type="button"
                >
                  {applyShellEnvironmentPolicyPresetMutation.isPending
                    ? i18n._({ id: 'Applying…', message: 'Applying…' })
                    : i18n._({ id: 'Apply inherit=all + Restart', message: 'Apply inherit=all + Restart' })}
                </button>
                <button
                  className="ide-button ide-button--secondary"
                  disabled={!workspaceId || applyShellEnvironmentPolicyPresetMutation.isPending}
                  onClick={() => applyShellEnvironmentPolicyPresetMutation.mutate('core-windows')}
                  type="button"
                >
                  {applyShellEnvironmentPolicyPresetMutation.isPending
                    ? i18n._({ id: 'Applying…', message: 'Applying…' })
                    : i18n._({ id: 'Apply core+Windows + Restart', message: 'Apply core+Windows + Restart' })}
                </button>
              </div>
              {applyShellEnvironmentPolicyPresetMutation.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`shell-environment-preset-${workspaceId}`}
                  title={i18n._({ id: 'Preset Apply Failed', message: 'Preset Apply Failed' })}
                  tone="error"
                >
                  {getErrorMessage(applyShellEnvironmentPolicyPresetMutation.error)}
                </InlineNotice>
              ) : null}
              {shellEnvironmentPolicy ? (
                <SettingsJsonPreview
                  description={i18n._({
                    id: 'Effective shell_environment_policy returned by app-server config/read.',
                    message:
                      'Effective shell_environment_policy returned by app-server config/read.',
                  })}
                  title="shell_environment_policy"
                  value={shellEnvironmentPolicy}
                />
              ) : (
                <div className="empty-state">
                  {i18n._({
                    id: 'No shell_environment_policy key is currently present in the resolved config.',
                    message:
                      'No shell_environment_policy key is currently present in the resolved config.',
                  })}
                </div>
              )}
              {shellEnvironmentOrigins ? (
                <SettingsJsonPreview
                  description={i18n._({
                    id: 'Origin entries for shell_environment_policy and its nested keys.',
                    message:
                      'Origin entries for shell_environment_policy and its nested keys.',
                  })}
                  title={i18n._({ id: 'Origins', message: 'Origins' })}
                  value={shellEnvironmentOrigins}
                />
              ) : null}
              {selectedWorkspaceConfigQuery.data?.layers ? (
                <SettingsJsonPreview
                  description={i18n._({
                    id: 'Merged config layers returned by app-server for this workspace.',
                    message:
                      'Merged config layers returned by app-server for this workspace.',
                  })}
                  title={i18n._({ id: 'Layers', message: 'Layers' })}
                  value={selectedWorkspaceConfigQuery.data.layers}
                />
              ) : null}
            </div>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}
