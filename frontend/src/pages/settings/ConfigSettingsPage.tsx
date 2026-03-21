import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
  SettingsJsonPreview,
  SettingsPageHeader,
} from '../../components/settings/SettingsPrimitives'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { SettingsWorkspaceScopePanel } from '../../components/settings/SettingsWorkspaceScopePanel'
import {
  detectExternalAgentConfig,
  importExternalAgentConfig,
  importRuntimeModelCatalogTemplate,
  readConfig,
  readConfigRequirements,
  readRuntimePreferences,
  writeConfigValue,
  writeRuntimePreferences,
} from '../../features/settings/api'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { getErrorMessage } from '../../lib/error-utils'
import { SelectControl } from '../../components/ui/SelectControl'
import { activateStoredTab, Tabs } from '../../components/ui/Tabs'
import { useUIStore } from '../../stores/ui-store'
import { ContextIcon, FeedIcon, RefreshIcon, SettingsIcon, SparkIcon, TerminalIcon } from '../../components/ui/RailControls'
import { Tooltip } from '../../components/ui/Tooltip'

export function ConfigSettingsPage() {
  const queryClient = useQueryClient()
  const { workspaceId, workspaceName } = useSettingsShellContext()
  const pushToast = useUIStore((state) => state.pushToast)
  const [configKeyPath, setConfigKeyPath] = useState('model')
  const [configValue, setConfigValue] = useState('"gpt-5.4"')
  const [modelCatalogPath, setModelCatalogPath] = useState('')
  const [defaultShellType, setDefaultShellType] = useState('')
  const [modelShellTypeOverridesInput, setModelShellTypeOverridesInput] = useState('{}')

  const configQuery = useQuery({
    queryKey: ['settings-config', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readConfig(workspaceId!, { includeLayers: true }),
  })
  const requirementsQuery = useQuery({
    queryKey: ['settings-requirements', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readConfigRequirements(workspaceId!),
  })
  const runtimePreferencesQuery = useQuery({
    queryKey: ['settings-runtime-preferences'],
    queryFn: readRuntimePreferences,
  })

  const writeConfigMutation = useMutation({
    mutationFn: () =>
      writeConfigValue(workspaceId!, {
        keyPath: configKeyPath,
        mergeStrategy: 'upsert',
        value: parseJsonInput(configValue),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] })
    },
  })
  const writeRuntimePreferencesMutation = useMutation({
    mutationFn: async () => {
      const overrides = parseShellOverridesInput(modelShellTypeOverridesInput)
      return writeRuntimePreferences({
        modelCatalogPath: modelCatalogPath.trim(),
        defaultShellType,
        modelShellTypeOverrides: overrides,
      })
    },
    onSuccess: async (result) => {
      setModelCatalogPath(result.configuredModelCatalogPath)
      setDefaultShellType(result.configuredDefaultShellType)
      setModelShellTypeOverridesInput(
        JSON.stringify(result.configuredModelShellTypeOverrides ?? {}, null, 2),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-runtime-preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['models'] }),
      ])
      pushToast({
        title: 'Runtime overrides applied',
        message: `Default shell type: ${result.effectiveDefaultShellType || 'catalog default'}; overrides: ${Object.keys(result.effectiveModelShellTypeOverrides ?? {}).length}.`,
        tone: 'success',
        actionLabel: 'Open Effective',
        onAction: () => {
          activateStoredTab('settings-config-main-tabs', 'runtime')
          activateStoredTab('settings-config-runtime-side-tabs', 'effective')
        },
      })
    },
  })

  const detectExternalMutation = useMutation({
    mutationFn: () => detectExternalAgentConfig(workspaceId!, { includeHome: true }),
    onSuccess: (result) => {
      pushToast({
        title: 'External config detected',
        message: `Found ${result.items?.length ?? 0} candidate item(s) for import review.`,
        tone: 'info',
        actionLabel: 'Open Detected',
        onAction: () => {
          activateStoredTab('settings-config-main-tabs', 'migration')
          activateStoredTab('settings-config-migration-side-tabs', 'detected')
        },
      })
    },
  })
  const importExternalMutation = useMutation({
    mutationFn: () =>
      importExternalAgentConfig(workspaceId!, {
        migrationItems: detectExternalMutation.data?.items ?? [],
      }),
    onSuccess: (result) => {
      pushToast({
        title: 'External agent state imported',
        message: `Imported ${detectExternalMutation.data?.items?.length ?? 0} item(s); backend status: ${result.status ?? 'accepted'}.`,
        tone: 'success',
      })
    },
  })
  const importModelCatalogMutation = useMutation({
    mutationFn: importRuntimeModelCatalogTemplate,
    onSuccess: async (result) => {
      setModelCatalogPath(result.configuredModelCatalogPath)
      setDefaultShellType(result.configuredDefaultShellType)
      setModelShellTypeOverridesInput(
        JSON.stringify(result.configuredModelShellTypeOverrides ?? {}, null, 2),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-runtime-preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['models'] }),
      ])
      pushToast({
        title: 'Model catalog imported',
        message: `Bound runtime catalog to ${result.configuredModelCatalogPath}.`,
        tone: 'success',
        actionLabel: 'Open Configured',
        onAction: () => {
          activateStoredTab('settings-config-main-tabs', 'runtime')
          activateStoredTab('settings-config-runtime-side-tabs', 'configured')
        },
      })
    },
  })

  useEffect(() => {
    if (!runtimePreferencesQuery.data) {
      return
    }

    setModelCatalogPath(runtimePreferencesQuery.data.configuredModelCatalogPath)
    setDefaultShellType(runtimePreferencesQuery.data.configuredDefaultShellType)
    setModelShellTypeOverridesInput(
      JSON.stringify(runtimePreferencesQuery.data.configuredModelShellTypeOverrides ?? {}, null, 2),
    )
  }, [runtimePreferencesQuery.data])

  const configLayerCount = Array.isArray(configQuery.data?.layers) ? configQuery.data.layers.length : 0
  const runtimeSummary = {
    catalogBound: Boolean(runtimePreferencesQuery.data?.effectiveModelCatalogPath),
    defaultShellType: runtimePreferencesQuery.data?.effectiveDefaultShellType || 'catalog default',
  }

  const configTabs = [
    {
      id: 'runtime',
      label: 'Runtime',
      icon: <SparkIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__header">
            <div className="config-workbench__header-main">
              <SettingsWorkspaceScopePanel />
            </div>
            <div className="config-workbench__header-status">
              <div className={`status-pill ${runtimeSummary.catalogBound ? 'status-pill--active' : 'status-pill--paused'}`}>
                Catalog: {runtimeSummary.catalogBound ? 'Attached' : 'Missing'}
              </div>
              <div className="status-pill">
                Shell: {runtimeSummary.defaultShellType}
              </div>
            </div>
          </div>

          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  writeRuntimePreferencesMutation.mutate()
                }}
              >
                <div className="config-card__header">
                  <strong>Shell Configuration</strong>
                  <button className="ide-button ide-button--primary ide-button--sm" type="submit">
                    {writeRuntimePreferencesMutation.isPending ? 'Applying…' : 'Apply Changes'}
                  </button>
                </div>

                <div className="form-stack">
                  <div className="field-group">
                    <label className="field">
                      <span>
                        Model Catalog Path
                        <FieldHint
                          label="Explain model catalog path"
                          text="Path to the full model catalog JSON file. codex-server uses this file as the source when it needs to rewrite shell_type metadata."
                        />
                      </span>
                      <div className="input-with-action">
                        <input
                          onChange={(event) => setModelCatalogPath(event.target.value)}
                          placeholder={runtimePreferencesQuery.data?.defaultModelCatalogPath || 'E:/path/to/models.json'}
                          value={modelCatalogPath}
                        />
                        <button
                          className="ide-button ide-button--secondary ide-button--sm"
                          onClick={() => importModelCatalogMutation.mutate()}
                          type="button"
                        >
                          Template
                        </button>
                      </div>
                    </label>
                  </div>

                  <div className="form-row">
                    <label className="field">
                      <span>
                        Default Shell Type
                        <FieldHint
                          label="Explain default shell type"
                          text="Applies one shell type to the catalog unless a model-specific override replaces it."
                        />
                      </span>
                      <SelectControl
                        ariaLabel="Default shell type"
                        fullWidth
                        onChange={setDefaultShellType}
                        options={shellTypeOptions}
                        value={defaultShellType}
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>
                      Model Shell Type Overrides (JSON)
                      <FieldHint
                        label="Explain model shell type overrides"
                        text="Optional JSON object for model-specific exceptions. Keys are model ids or slugs and values are shell types such as local, shell_command, unified_exec, default, or disabled."
                      />
                    </span>
                    <textarea
                      className="ide-textarea"
                      onChange={(event) => setModelShellTypeOverridesInput(event.target.value)}
                      placeholder="{}"
                      rows={5}
                      value={modelShellTypeOverridesInput}
                    />
                  </label>
                </div>
              </form>

              <details className="config-details-box">
                <summary className="config-details-box__summary">
                  <span>Strategy Guide</span>
                  <small>Which shell type should you choose?</small>
                </summary>
                <div className="config-helper-grid config-helper-grid--compact">
                  <article className="config-helper-card">
                    <strong>local</strong>
                    <p>Standard local execution.</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>unified_exec</strong>
                    <p>Streaming output + stdin.</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>shell_command</strong>
                    <p>Script string wrapper.</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>default</strong>
                    <p>Upstream catalog values.</p>
                  </article>
                </div>
              </details>

              {writeRuntimePreferencesMutation.error && (
                <InlineNotice
                  details={getErrorMessage(writeRuntimePreferencesMutation.error)}
                  dismissible
                  noticeKey="runtime-write-error"
                  title="Update Failed"
                  tone="error"
                >
                  {getErrorMessage(writeRuntimePreferencesMutation.error)}
                </InlineNotice>
              )}
            </div>

            <div className="config-workbench__side-panel">
              <div className="config-card config-card--muted">
                <div className="config-card__header">
                  <strong>Status & Inspection</strong>
                </div>
                {runtimePreferencesQuery.data ? (
                  <Tabs
                    ariaLabel="Runtime inspection tabs"
                    className="config-workbench__panel"
                    storageKey="settings-config-runtime-side-tabs"
                    items={[
                      {
                        id: 'effective',
                        label: 'Effective',
                        icon: <TerminalIcon />,
                        content: (
                          <SettingsJsonPreview
                            description="Current resolved runtime state."
                            title="Effective Values"
                            value={{
                              modelCatalogPath: runtimePreferencesQuery.data.effectiveModelCatalogPath,
                              defaultShellType: runtimePreferencesQuery.data.effectiveDefaultShellType,
                              modelShellTypeOverrides: runtimePreferencesQuery.data.effectiveModelShellTypeOverrides,
                              command: runtimePreferencesQuery.data.effectiveCommand,
                            }}
                          />
                        ),
                      },
                      {
                        id: 'configured',
                        label: 'Configured',
                        icon: <ContextIcon />,
                        content: (
                          <SettingsJsonPreview
                            description="Values saved in codex-server database."
                            title="Saved Values"
                            value={{
                              modelCatalogPath: runtimePreferencesQuery.data.configuredModelCatalogPath,
                              defaultShellType: runtimePreferencesQuery.data.configuredDefaultShellType,
                              modelShellTypeOverrides: runtimePreferencesQuery.data.configuredModelShellTypeOverrides,
                            }}
                          />
                        ),
                      },
                    ]}
                  />
                ) : (
                  <div className="notice">Loading runtime preferences…</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'advanced',
      label: 'Advanced',
      icon: <TerminalIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  if (workspaceId) {
                    writeConfigMutation.mutate()
                  }
                }}
              >
                <div className="config-card__header">
                  <strong>Direct JSON Write</strong>
                  <button className="ide-button ide-button--primary ide-button--sm" disabled={!workspaceId} type="submit">
                    {writeConfigMutation.isPending ? 'Writing…' : 'Write Key'}
                  </button>
                </div>
                <div className="form-stack">
                  <label className="field">
                    <span>Key Path</span>
                    <input onChange={(event) => setConfigKeyPath(event.target.value)} value={configKeyPath} />
                  </label>
                  <label className="field">
                    <span>Value (JSON)</span>
                    <textarea
                      className="ide-textarea"
                      onChange={(event) => setConfigValue(event.target.value)}
                      rows={4}
                      value={configValue}
                    />
                  </label>
                </div>
              </form>

              <div className="config-details-box">
                <div className="config-card__header">
                  <strong>Common Key Paths</strong>
                </div>
                <div className="config-helper-grid config-helper-grid--compact">
                  <div className="config-helper-card">
                    <code>model</code>
                    <small>Model identifier</small>
                  </div>
                  <div className="config-helper-card">
                    <code>sandbox_mode</code>
                    <small>local or container</small>
                  </div>
                  <div className="config-helper-card">
                    <code>approval_policy</code>
                    <small>Approval logic</small>
                  </div>
                </div>
              </div>

              {writeConfigMutation.error && (
                <InlineNotice
                  details={getErrorMessage(writeConfigMutation.error)}
                  dismissible
                  noticeKey="write-config-error"
                  title="Write Failed"
                  tone="error"
                >
                  {getErrorMessage(writeConfigMutation.error)}
                </InlineNotice>
              )}
            </div>

            <div className="config-workbench__side-panel">
              <div className="config-card config-card--muted">
                <div className="config-card__header">
                  <strong>Resolved Analysis</strong>
                </div>
                <Tabs
                  ariaLabel="Resolved analysis tabs"
                  className="config-workbench__panel"
                  storageKey="settings-config-advanced-side-tabs"
                  items={[
                    {
                      id: 'config',
                      label: 'Current Config',
                      icon: <ContextIcon />,
                      content: configQuery.isLoading ? (
                        <div className="notice">Loading configuration…</div>
                      ) : configQuery.data ? (
                        <SettingsJsonPreview
                          collapsible
                          defaultExpanded={false}
                          description="Final merged configuration including all layers."
                          title="Effective Config"
                          value={configQuery.data.config}
                        />
                      ) : (
                        <div className="empty-state">Configuration data is unavailable.</div>
                      ),
                    },
                    {
                      id: 'requirements',
                      label: 'Requirements',
                      icon: <FeedIcon />,
                      content: requirementsQuery.data ? (
                        <SettingsJsonPreview
                          collapsible
                          defaultExpanded={false}
                          description="Validation status and requirements."
                          title="Requirements"
                          value={requirementsQuery.data.requirements ?? null}
                        />
                      ) : (
                        <div className="empty-state">No requirements payload returned.</div>
                      ),
                    },
                  ]}
                />
                {configQuery.error && (
                  <InlineNotice
                    details={getErrorMessage(configQuery.error)}
                    onRetry={() => void queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] })}
                    title="Read Error"
                    tone="error"
                  >
                    {getErrorMessage(configQuery.error)}
                  </InlineNotice>
                )}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'migration',
      label: 'Migration',
      icon: <RefreshIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <div className="config-card">
                <div className="config-card__header">
                  <strong>Migration Console</strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      disabled={!workspaceId}
                      onClick={() => detectExternalMutation.mutate()}
                      type="button"
                    >
                      Scan
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={!workspaceId || importExternalMutation.isPending || !detectExternalMutation.data?.items?.length}
                      onClick={() => importExternalMutation.mutate()}
                      type="button"
                    >
                      Import
                    </button>
                  </div>
                </div>
                <p className="config-inline-note">
                  Search for and import state from external agents on this machine.
                </p>
              </div>

              <details className="config-details-box">
                <summary className="config-details-box__summary">
                  <span>Migration Workflow</span>
                  <small>How to safely migrate your state</small>
                </summary>
                <div className="config-helper-grid config-helper-grid--compact">
                  <article className="config-helper-card">
                    <strong>1. Scan</strong>
                    <p>Detect artifacts in home & local scopes.</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>2. Review</strong>
                    <p>Verify detected items in the side panel.</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>3. Import</strong>
                    <p>Merge items into active workspace.</p>
                  </article>
                </div>
              </details>

              {detectExternalMutation.error && (
                <InlineNotice
                  details={getErrorMessage(detectExternalMutation.error)}
                  onRetry={() => detectExternalMutation.mutate()}
                  title="Scan Failed"
                  tone="error"
                >
                  {getErrorMessage(detectExternalMutation.error)}
                </InlineNotice>
              )}
            </div>

            <div className="config-workbench__side-panel">
              <div className="config-card config-card--muted">
                <div className="config-card__header">
                  <strong>Detected State</strong>
                </div>
                <Tabs
                  ariaLabel="Migration inspection tabs"
                  className="config-workbench__panel"
                  storageKey="settings-config-migration-side-tabs"
                  items={[
                    {
                      id: 'workflow',
                      label: 'Workflow',
                      icon: <SettingsIcon />,
                      content: (
                        <div className="config-helper-grid config-helper-grid--compact">
                          <article className="config-helper-card">
                            <strong>1. Scan</strong>
                            <p>Discover candidate artifacts from local and home scopes.</p>
                          </article>
                          <article className="config-helper-card">
                            <strong>2. Review</strong>
                            <p>Inspect the detected payload before you import it.</p>
                          </article>
                          <article className="config-helper-card">
                            <strong>3. Import</strong>
                            <p>Apply the detected state into the active workspace.</p>
                          </article>
                        </div>
                      ),
                    },
                    {
                      id: 'detected',
                      label: 'Detected',
                      icon: <RefreshIcon />,
                      badge: detectExternalMutation.data?.items?.length ?? null,
                      content: detectExternalMutation.data ? (
                        <SettingsJsonPreview
                          collapsible
                          description="Candidate artifacts ready for migration."
                          title="Detected Items"
                          value={detectExternalMutation.data.items}
                        />
                      ) : (
                        <div className="empty-state">Run a scan to see migration items.</div>
                      ),
                    },
                  ]}
                />
                {importExternalMutation.error && (
                  <InlineNotice
                    details={getErrorMessage(importExternalMutation.error)}
                    title="Import Failed"
                    tone="error"
                  >
                    {getErrorMessage(importExternalMutation.error)}
                  </InlineNotice>
                )}
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ]

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Manage workspace-scoped runtime values, advanced JSON configurations, and environment migrations."
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">{configLayerCount} config layers</span>
          </>
        }
        title="Config"
      />

      <Tabs
        ariaLabel="Config navigation tabs"
        className="config-main-tabs"
        storageKey="settings-config-main-tabs"
        items={configTabs}
      />
    </section>
  )
}

function parseJsonInput(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const shellTypeOptions = [
  { value: '', label: 'Follow catalog defaults', triggerLabel: '默认' },
  { value: 'default', label: 'Default', triggerLabel: 'Default' },
  { value: 'local', label: 'LocalShell', triggerLabel: 'Local' },
  { value: 'shell_command', label: 'ShellCommand', triggerLabel: 'ShellCmd' },
  { value: 'unified_exec', label: 'UnifiedExec', triggerLabel: 'Unified' },
  { value: 'disabled', label: 'Disabled', triggerLabel: 'Off' },
]

function parseShellOverridesInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }

  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model Shell Type Overrides must be a JSON object')
  }

  const normalized: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') {
      throw new Error(`Model shell override for "${key}" must be a string`)
    }
    normalized[key] = rawValue
  }

  return normalized
}

function FieldHint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip content={text} position="top" triggerLabel={label}>
      <span aria-hidden="true" className="field-hint">
        ?
      </span>
    </Tooltip>
  )
}
