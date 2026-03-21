import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  exportRemoteSkill,
  installPlugin,
  listApps,
  listCollaborationModes,
  listModels,
  listPlugins,
  listRemoteSkills,
  listSkills,
  readPlugin,
  uninstallPlugin,
} from '../features/catalog/api'
import { fuzzyFileSearch, uploadFeedback } from '../features/settings/api'
import { listWorkspaces } from '../features/workspaces/api'
import { SelectControl } from '../components/ui/SelectControl'
import { getErrorMessage } from '../lib/error-utils'
import { InlineNotice } from '../components/ui/InlineNotice'

type CatalogSectionItem = {
  id: string
  name: string
  description: string
  value?: string
  shellType?: string
}

type CatalogQueryData = {
  models: CatalogSectionItem[]
  skills: CatalogSectionItem[]
  remoteSkills: CatalogSectionItem[]
  apps: CatalogSectionItem[]
  plugins: CatalogSectionItem[]
  modes: CatalogSectionItem[]
}

export function CatalogPage() {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [modelShellTypeFilter, setModelShellTypeFilter] = useState('all')
  const [hazelnutId, setHazelnutId] = useState('')
  const [marketplacePath, setMarketplacePath] = useState('')
  const [pluginName, setPluginName] = useState('')
  const [pluginId, setPluginId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [feedbackClassification, setFeedbackClassification] = useState('bug')
  const [feedbackReason, setFeedbackReason] = useState('')
  const [includeLogs, setIncludeLogs] = useState(true)

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  useEffect(() => {
    if (!selectedWorkspaceId && workspacesQuery.data?.length) {
      setSelectedWorkspaceId(workspacesQuery.data[0].id)
    }
  }, [selectedWorkspaceId, workspacesQuery.data])

  const workspaceId = selectedWorkspaceId || workspacesQuery.data?.[0]?.id

  const catalogQuery = useQuery({
    queryKey: ['runtime-catalog', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const [models, skills, remoteSkills, apps, plugins, modes] = await Promise.all([
        listModels(workspaceId!),
        listSkills(workspaceId!),
        listRemoteSkills(workspaceId!, {
          enabled: false,
          hazelnutScope: 'example',
          productSurface: 'codex',
        }),
        listApps(workspaceId!),
        listPlugins(workspaceId!),
        listCollaborationModes(workspaceId!),
      ])

      return {
        models,
        skills,
        remoteSkills: remoteSkills.data,
        apps,
        plugins,
        modes,
      } satisfies CatalogQueryData
    },
  })

  const exportRemoteSkillMutation = useMutation({
    mutationFn: () => exportRemoteSkill(workspaceId!, { hazelnutId }),
  })
  const readPluginMutation = useMutation({
    mutationFn: () => readPlugin(workspaceId!, { marketplacePath, pluginName }),
  })
  const installPluginMutation = useMutation({
    mutationFn: () => installPlugin(workspaceId!, { marketplacePath, pluginName }),
  })
  const uninstallPluginMutation = useMutation({
    mutationFn: () => uninstallPlugin(workspaceId!, { pluginId }),
  })
  const searchMutation = useMutation({
    mutationFn: () => fuzzyFileSearch(workspaceId!, { query: searchQuery }),
  })
  const feedbackMutation = useMutation({
    mutationFn: () =>
      uploadFeedback(workspaceId!, {
        classification: feedbackClassification,
        includeLogs,
        reason: feedbackReason,
      }),
  })

  const workspaceName = useMemo(
    () => workspacesQuery.data?.find((workspace) => workspace.id === workspaceId)?.name ?? 'No workspace',
    [workspaceId, workspacesQuery.data],
  )
  const filteredModels = useMemo(() => {
    const models = catalogQuery.data?.models ?? []
    if (modelShellTypeFilter === 'all') {
      return models
    }
    return models.filter((item) => item.shellType === modelShellTypeFilter)
  }, [catalogQuery.data?.models, modelShellTypeFilter])
  const modelShellTypeOptions = useMemo(() => {
    const shellTypes = Array.from(
      new Set((catalogQuery.data?.models ?? []).map((item) => item.shellType).filter(Boolean)),
    ) as string[]

    return [
      { value: 'all', label: '全部模型', triggerLabel: '全部' },
      ...shellTypes.map((shellType) => ({
        value: shellType,
        label: formatShellTypeLabel(shellType),
        triggerLabel: formatShellTypeLabel(shellType),
      })),
    ]
  }, [catalogQuery.data?.models])
  const catalogSections = useMemo(
    () => [
      {
        title: 'Models',
        description: 'Execution models currently discoverable in the active runtime.',
        marker: 'MO',
        items: filteredModels,
      },
      {
        title: 'Installed Skills',
        description: 'Workspace-local skills already mounted into the runtime.',
        marker: 'SK',
        items: catalogQuery.data?.skills ?? [],
      },
      {
        title: 'Remote Skills',
        description: 'Remote skills available to export into the current workspace.',
        marker: 'RM',
        items: catalogQuery.data?.remoteSkills ?? [],
      },
      {
        title: 'Apps',
        description: 'Connected app surfaces and app-aware runtime capabilities.',
        marker: 'AP',
        items: catalogQuery.data?.apps ?? [],
      },
      {
        title: 'Plugins',
        description: 'Installed or discoverable plugins for this workspace runtime.',
        marker: 'PL',
        items: catalogQuery.data?.plugins ?? [],
      },
      {
        title: 'Modes',
        description: 'Available collaboration modes that shape the agent interaction model.',
        marker: 'MD',
        items: catalogQuery.data?.modes ?? [],
      },
    ],
    [catalogQuery.data, filteredModels],
  )
  const totalInventoryCount = catalogSections.reduce((count, section) => count + section.items.length, 0)

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">Runtime</div>
          <div className="mode-strip__title-row">
            <strong>Runtime Tools</strong>
          </div>
          <div className="mode-strip__description">
            Inspect runtime inventory and run export or plugin actions from a tighter control-surface layout.
          </div>
        </div>
        <div className="mode-strip__actions">
          <span className="meta-pill">{catalogQuery.data?.models.length ?? 0} models</span>
          <span className="meta-pill">{catalogQuery.data?.plugins.length ?? 0} plugins</span>
          <span className="meta-pill">{totalInventoryCount} total entries</span>
        </div>
      </header>

      {!workspaceId ? (
        <InlineNotice title="Workspace Required">
          Create a workspace first to inspect runtime data.
        </InlineNotice>
      ) : null}

      <div className="mode-layout">
        <aside className="mode-rail">
          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>Workspace Scope</h2>
                <p>Runtime queries and write actions are scoped to the selected workspace.</p>
              </div>
            </div>
            <label className="field">
              <span>Workspace</span>
              <SelectControl
                ariaLabel="Workspace"
                fullWidth
                onChange={setSelectedWorkspaceId}
                options={(workspacesQuery.data ?? []).map((workspace) => ({
                  value: workspace.id,
                  label: workspace.name,
                }))}
                value={workspaceId ?? ''}
              />
            </label>
            <div className="detail-list">
              <div className="detail-row">
                <span>Current Scope</span>
                <strong>{workspaceName}</strong>
              </div>
              <div className="detail-row">
                <span>Inventory Entries</span>
                <strong>{totalInventoryCount}</strong>
              </div>
              <div className="detail-row">
                <span>模型筛选</span>
                <strong>{modelShellTypeFilter === 'all' ? '全部' : formatShellTypeLabel(modelShellTypeFilter)}</strong>
              </div>
            </div>
          </section>

          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>Runtime Snapshot</h2>
                <p>Use the side rail to read the overall runtime shape before drilling into the inventory board.</p>
              </div>
            </div>
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>Models</span>
                <strong>{catalogQuery.data?.models.length ?? 0}</strong>
              </div>
              <div className="mode-metric">
                <span>Plugins</span>
                <strong>{catalogQuery.data?.plugins.length ?? 0}</strong>
              </div>
              <div className="mode-metric">
                <span>Modes</span>
                <strong>{catalogQuery.data?.modes.length ?? 0}</strong>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>Apps</span>
                <strong>{catalogQuery.data?.apps.length ?? 0}</strong>
              </div>
              <div className="detail-row">
                <span>Remote Skills</span>
                <strong>{catalogQuery.data?.remoteSkills.length ?? 0}</strong>
              </div>
            </div>
            <label className="field">
              <span>Model Shell Type</span>
              <SelectControl
                ariaLabel="Model shell type filter"
                fullWidth
                onChange={setModelShellTypeFilter}
                options={modelShellTypeOptions}
                value={modelShellTypeFilter}
              />
            </label>
          </section>
        </aside>

        <div className="mode-stage stack-screen">
          {catalogQuery.error ? (
            <InlineNotice
              details={getErrorMessage(catalogQuery.error)}
              dismissible
              noticeKey={`catalog-${catalogQuery.error instanceof Error ? catalogQuery.error.message : 'unknown'}`}
              onRetry={() => void catalogQuery.refetch()}
              title="Failed To Load Runtime Inventory"
              tone="error"
            >
              {getErrorMessage(catalogQuery.error)}
            </InlineNotice>
          ) : null}

          <div className="runtime-board">
            {catalogSections.map((section) => (
              <RuntimeSection
                description={section.description}
                items={section.items}
                key={section.title}
                loading={catalogQuery.isLoading}
                marker={section.marker}
                title={section.title}
              />
            ))}
          </div>

          <div className="mode-console-grid">
            <section className="mode-console">
              <div className="section-header">
                <div>
                  <h2>Remote Skill Export</h2>
                  <p>Export remote skills into the selected workspace from a dedicated runtime console.</p>
                </div>
              </div>
              <form
                className="form-stack"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  if (workspaceId && hazelnutId.trim()) {
                    exportRemoteSkillMutation.mutate()
                  }
                }}
              >
                <label className="field">
                  <span>Hazelnut ID</span>
                  <input onChange={(event) => setHazelnutId(event.target.value)} value={hazelnutId} />
                </label>
                <button className="ide-button" disabled={!workspaceId || !hazelnutId.trim()} type="submit">
                  {exportRemoteSkillMutation.isPending ? 'Exporting…' : 'Export Skill'}
                </button>
                {exportRemoteSkillMutation.data ? (
                  <pre className="code-block mode-console__output">{JSON.stringify(exportRemoteSkillMutation.data, null, 2)}</pre>
                ) : null}
              </form>
            </section>

            <section className="mode-console">
              <div className="section-header">
                <div>
                  <h2>Plugin Actions</h2>
                  <p>Read, install, and remove plugins without leaving the runtime surface.</p>
                </div>
              </div>
              <div className="stack-screen">
                <form
                  className="form-stack"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault()
                    if (workspaceId && marketplacePath.trim() && pluginName.trim()) {
                      readPluginMutation.mutate()
                    }
                  }}
                >
                  <label className="field">
                    <span>Marketplace Path</span>
                    <input onChange={(event) => setMarketplacePath(event.target.value)} value={marketplacePath} />
                  </label>
                  <label className="field">
                    <span>Plugin Name</span>
                    <input onChange={(event) => setPluginName(event.target.value)} value={pluginName} />
                  </label>
                  <div className="header-actions">
                    <button className="ide-button" disabled={!workspaceId || !marketplacePath.trim() || !pluginName.trim()} type="submit">
                      {readPluginMutation.isPending ? 'Reading…' : 'Read Plugin'}
                    </button>
                    <button
                      className="ide-button ide-button--secondary"
                      disabled={!workspaceId || !marketplacePath.trim() || !pluginName.trim()}
                      onClick={() => installPluginMutation.mutate()}
                      type="button"
                    >
                      {installPluginMutation.isPending ? 'Installing…' : 'Install'}
                    </button>
                  </div>
                </form>

                {readPluginMutation.data ? (
                  <pre className="code-block mode-console__output">{JSON.stringify(readPluginMutation.data, null, 2)}</pre>
                ) : null}
                {installPluginMutation.data ? (
                  <pre className="code-block mode-console__output">{JSON.stringify(installPluginMutation.data, null, 2)}</pre>
                ) : null}

                <form
                  className="form-stack form-stack--separated"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault()
                    if (workspaceId && pluginId.trim()) {
                      uninstallPluginMutation.mutate()
                    }
                  }}
                >
                  <label className="field">
                    <span>Plugin ID</span>
                    <input onChange={(event) => setPluginId(event.target.value)} value={pluginId} />
                  </label>
                  <button className="ide-button ide-button--secondary" disabled={!workspaceId || !pluginId.trim()} type="submit">
                    {uninstallPluginMutation.isPending ? 'Uninstalling…' : 'Uninstall'}
                  </button>
                  {uninstallPluginMutation.data ? (
                    <pre className="code-block mode-console__output">{JSON.stringify(uninstallPluginMutation.data, null, 2)}</pre>
                  ) : null}
                </form>
              </div>
            </section>

            <section className="mode-console">
              <div className="section-header">
                <div>
                  <h2>Workspace Utilities</h2>
                  <p>Run lightweight operational actions from runtime instead of burying them inside settings.</p>
                </div>
              </div>
              <div className="stack-screen">
                <form
                  className="form-stack"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault()
                    if (workspaceId && searchQuery.trim()) {
                      searchMutation.mutate()
                    }
                  }}
                >
                  <label className="field">
                    <span>Fuzzy Search Query</span>
                    <input onChange={(event) => setSearchQuery(event.target.value)} value={searchQuery} />
                  </label>
                  <button className="ide-button" disabled={!workspaceId || !searchQuery.trim()} type="submit">
                    Search Files
                  </button>
                  {searchMutation.data ? (
                    <pre className="code-block mode-console__output">{JSON.stringify(searchMutation.data.files, null, 2)}</pre>
                  ) : null}
                  {searchMutation.error ? (
                    <InlineNotice
                      details={getErrorMessage(searchMutation.error)}
                      dismissible
                      noticeKey={`catalog-search-${searchMutation.error instanceof Error ? searchMutation.error.message : 'unknown'}`}
                      onRetry={() => searchMutation.mutate()}
                      title="Search Failed"
                      tone="error"
                    >
                      {getErrorMessage(searchMutation.error)}
                    </InlineNotice>
                  ) : null}
                </form>

                <form
                  className="form-stack form-stack--separated"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault()
                    if (workspaceId) {
                      feedbackMutation.mutate()
                    }
                  }}
                >
                  <label className="field">
                    <span>Feedback Classification</span>
                    <input onChange={(event) => setFeedbackClassification(event.target.value)} value={feedbackClassification} />
                  </label>
                  <label className="field">
                    <span>Reason</span>
                    <textarea
                      className="ide-textarea"
                      onChange={(event) => setFeedbackReason(event.target.value)}
                      rows={4}
                      value={feedbackReason}
                    />
                  </label>
                  <label className="field field--inline">
                    <span>Include Logs</span>
                    <input checked={includeLogs} onChange={(event) => setIncludeLogs(event.target.checked)} type="checkbox" />
                  </label>
                  <button className="ide-button ide-button--secondary" disabled={!workspaceId} type="submit">
                    Upload Feedback
                  </button>
                  {feedbackMutation.data ? (
                    <pre className="code-block mode-console__output">{JSON.stringify(feedbackMutation.data, null, 2)}</pre>
                  ) : null}
                  {feedbackMutation.error ? (
                    <InlineNotice
                      details={getErrorMessage(feedbackMutation.error)}
                      dismissible
                      noticeKey={`catalog-feedback-${feedbackMutation.error instanceof Error ? feedbackMutation.error.message : 'unknown'}`}
                      onRetry={() => feedbackMutation.mutate()}
                      title="Feedback Upload Failed"
                      tone="error"
                    >
                      {getErrorMessage(feedbackMutation.error)}
                    </InlineNotice>
                  ) : null}
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  )
}

function formatShellTypeLabel(value: string) {
  switch (value) {
    case 'local':
      return 'LocalShell'
    case 'shell_command':
      return 'ShellCommand'
    case 'unified_exec':
      return 'UnifiedExec'
    case 'default':
      return 'Default'
    case 'disabled':
      return 'Disabled'
    default:
      return value
  }
}

function RuntimeSection({
  title,
  description,
  items,
  loading,
  marker,
}: {
  title: string
  description: string
  items: CatalogSectionItem[]
  loading: boolean
  marker: string
}) {
  return (
    <section className="mode-panel mode-panel--flush mode-panel--compact">
      <div className="mode-panel__body">
        <div className="section-header section-header--inline">
          <div>
            <h2>{title}</h2>
          </div>
          <div className="section-header__meta">{items.length}</div>
        </div>
        <p className="mode-panel__description">{description}</p>
      </div>
      {loading ? <div className="notice">Loading…</div> : null}
      {!loading && !items.length ? <div className="empty-state">No entries available.</div> : null}
      <div className="runtime-list">
        {items.map((item) => (
          <article className="runtime-item" key={item.id}>
            <div className="runtime-item__icon">{marker}</div>
            <div className="runtime-item__body">
              <strong>{item.name}</strong>
              {item.value && item.value !== item.name ? <p><code>{item.value}</code></p> : null}
              {item.shellType ? <p><code>shellType: {item.shellType}</code></p> : null}
              <p>{item.description || 'No description provided.'}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
