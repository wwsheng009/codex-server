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
import { Input } from '../components/ui/Input'
import { SelectControl } from '../components/ui/SelectControl'
import { TextArea } from '../components/ui/TextArea'
import { Switch } from '../components/ui/Switch'
import { getActiveLocale, i18n } from '../i18n/runtime'
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

type RuntimeSectionProps = {
  title: string
  description: string
  items: CatalogSectionItem[]
  loading: boolean
  marker: string
}

export function CatalogPage() {
  const activeLocale = getActiveLocale()
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
    () =>
      workspacesQuery.data?.find((workspace) => workspace.id === workspaceId)?.name ??
      i18n._({
        id: 'No workspace',
        message: 'No workspace',
      }),
    [activeLocale, workspaceId, workspacesQuery.data],
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
      {
        value: 'all',
        label: i18n._({ id: 'All models', message: 'All models' }),
        triggerLabel: i18n._({ id: 'All', message: 'All' }),
      },
      ...shellTypes.map((shellType) => ({
        value: shellType,
        label: formatShellTypeLabel(shellType),
        triggerLabel: formatShellTypeLabel(shellType),
      })),
    ]
  }, [activeLocale, catalogQuery.data?.models])
  const catalogSections = useMemo(
    () => [
      {
        title: i18n._({ id: 'Models', message: 'Models' }),
        description: i18n._({
          id: 'Execution models currently discoverable in the active runtime.',
          message: 'Execution models currently discoverable in the active runtime.',
        }),
        marker: 'MO',
        items: filteredModels,
      },
      {
        title: i18n._({ id: 'Installed skills', message: 'Installed skills' }),
        description: i18n._({
          id: 'Workspace-local skills already mounted into the runtime.',
          message: 'Workspace-local skills already mounted into the runtime.',
        }),
        marker: 'SK',
        items: catalogQuery.data?.skills ?? [],
      },
      {
        title: i18n._({ id: 'Remote skills', message: 'Remote skills' }),
        description: i18n._({
          id: 'Remote skills available to export into the current workspace.',
          message: 'Remote skills available to export into the current workspace.',
        }),
        marker: 'RM',
        items: catalogQuery.data?.remoteSkills ?? [],
      },
      {
        title: i18n._({ id: 'Apps', message: 'Apps' }),
        description: i18n._({
          id: 'Connected app surfaces and app-aware runtime capabilities.',
          message: 'Connected app surfaces and app-aware runtime capabilities.',
        }),
        marker: 'AP',
        items: catalogQuery.data?.apps ?? [],
      },
      {
        title: i18n._({ id: 'Plugins', message: 'Plugins' }),
        description: i18n._({
          id: 'Installed or discoverable plugins for this workspace runtime.',
          message: 'Installed or discoverable plugins for this workspace runtime.',
        }),
        marker: 'PL',
        items: catalogQuery.data?.plugins ?? [],
      },
      {
        title: i18n._({ id: 'Modes', message: 'Modes' }),
        description: i18n._({
          id: 'Available collaboration modes that shape the agent interaction model.',
          message: 'Available collaboration modes that shape the agent interaction model.',
        }),
        marker: 'MD',
        items: catalogQuery.data?.modes ?? [],
      },
    ],
    [activeLocale, catalogQuery.data, filteredModels],
  )
  const totalInventoryCount = catalogSections.reduce((count, section) => count + section.items.length, 0)

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">
            {i18n._({ id: 'Runtime', message: 'Runtime' })}
          </div>
          <div className="mode-strip__title-row">
            <strong>{i18n._({ id: 'Runtime tools', message: 'Runtime tools' })}</strong>
          </div>
          <div className="mode-strip__description">
            {i18n._({
              id: 'Inspect runtime inventory and run export or plugin actions from a tighter control-surface layout.',
              message:
                'Inspect runtime inventory and run export or plugin actions from a tighter control-surface layout.',
            })}
          </div>
        </div>
        <div className="mode-strip__actions">
          <span className="meta-pill">
            {i18n._({
              id: '{count} models',
              message: '{count} models',
              values: { count: catalogQuery.data?.models.length ?? 0 },
            })}
          </span>
          <span className="meta-pill">
            {i18n._({
              id: '{count} plugins',
              message: '{count} plugins',
              values: { count: catalogQuery.data?.plugins.length ?? 0 },
            })}
          </span>
          <span className="meta-pill">
            {i18n._({
              id: '{count} total entries',
              message: '{count} total entries',
              values: { count: totalInventoryCount },
            })}
          </span>
        </div>
      </header>

      {!workspaceId ? (
        <InlineNotice
          title={i18n._({
            id: 'Workspace required',
            message: 'Workspace required',
          })}
        >
          {i18n._({
            id: 'Create a workspace first to inspect runtime data.',
            message: 'Create a workspace first to inspect runtime data.',
          })}
        </InlineNotice>
      ) : null}

      <div className="mode-layout">
        <aside className="mode-rail">
          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>{i18n._({ id: 'Workspace scope', message: 'Workspace scope' })}</h2>
                <p>
                  {i18n._({
                    id: 'Runtime queries and write actions are scoped to the selected workspace.',
                    message: 'Runtime queries and write actions are scoped to the selected workspace.',
                  })}
                </p>
              </div>
            </div>
            <label className="field">
              <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Workspace', message: 'Workspace' })}
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
                <span>{i18n._({ id: 'Current scope', message: 'Current scope' })}</span>
                <strong>{workspaceName}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Inventory entries', message: 'Inventory entries' })}</span>
                <strong>{totalInventoryCount}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Model filter', message: 'Model filter' })}</span>
                <strong>
                  {modelShellTypeFilter === 'all'
                    ? i18n._({ id: 'All', message: 'All' })
                    : formatShellTypeLabel(modelShellTypeFilter)}
                </strong>
              </div>
            </div>
          </section>

          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>{i18n._({ id: 'Runtime snapshot', message: 'Runtime snapshot' })}</h2>
                <p>
                  {i18n._({
                    id: 'Use the side rail to read the overall runtime shape before drilling into the inventory board.',
                    message:
                      'Use the side rail to read the overall runtime shape before drilling into the inventory board.',
                  })}
                </p>
              </div>
            </div>
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>{i18n._({ id: 'Models', message: 'Models' })}</span>
                <strong>{catalogQuery.data?.models.length ?? 0}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Plugins', message: 'Plugins' })}</span>
                <strong>{catalogQuery.data?.plugins.length ?? 0}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Modes', message: 'Modes' })}</span>
                <strong>{catalogQuery.data?.modes.length ?? 0}</strong>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Apps', message: 'Apps' })}</span>
                <strong>{catalogQuery.data?.apps.length ?? 0}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Remote skills', message: 'Remote skills' })}</span>
                <strong>{catalogQuery.data?.remoteSkills.length ?? 0}</strong>
              </div>
            </div>
            <label className="field">
              <span>{i18n._({ id: 'Model shell type', message: 'Model shell type' })}</span>
              <SelectControl
                ariaLabel={i18n._({
                  id: 'Model shell type filter',
                  message: 'Model shell type filter',
                })}
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
              title={i18n._({
                id: 'Failed to load runtime inventory',
                message: 'Failed to load runtime inventory',
              })}
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
                  <h2>{i18n._({ id: 'Remote skill export', message: 'Remote skill export' })}</h2>
                  <p>
                    {i18n._({
                      id: 'Export remote skills into the selected workspace from a dedicated runtime console.',
                      message:
                        'Export remote skills into the selected workspace from a dedicated runtime console.',
                    })}
                  </p>
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
              <Input
                label={i18n._({ id: 'Hazelnut ID', message: 'Hazelnut ID' })}
                onChange={(event) => setHazelnutId(event.target.value)}
                value={hazelnutId}
              />
              <div className="setting-row__actions" style={{ marginTop: '10px' }}>
                <button className="ide-button" disabled={!workspaceId || !hazelnutId.trim()} type="submit">
                  {exportRemoteSkillMutation.isPending
                    ? i18n._({
                        id: 'Exporting…',
                        message: 'Exporting…',
                      })
                    : i18n._({
                        id: 'Export skill',
                        message: 'Export skill',
                      })}
                </button>
              </div>
                {exportRemoteSkillMutation.data ? (
                  <pre className="code-block mode-console__output">{JSON.stringify(exportRemoteSkillMutation.data, null, 2)}</pre>
                ) : null}
              </form>
            </section>

            <section className="mode-console">
              <div className="section-header">
                <div>
                  <h2>{i18n._({ id: 'Plugin actions', message: 'Plugin actions' })}</h2>
                  <p>
                    {i18n._({
                      id: 'Read, install, and remove plugins without leaving the runtime surface.',
                      message: 'Read, install, and remove plugins without leaving the runtime surface.',
                    })}
                  </p>
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
                  <Input
                    label={i18n._({ id: 'Marketplace path', message: 'Marketplace path' })}
                    onChange={(event) => setMarketplacePath(event.target.value)}
                    value={marketplacePath}
                  />
                  <Input
                    label={i18n._({ id: 'Plugin name', message: 'Plugin name' })}
                    onChange={(event) => setPluginName(event.target.value)}
                    value={pluginName}
                  />
                  <div className="header-actions" style={{ marginTop: '10px' }}>
                    <button className="ide-button" disabled={!workspaceId || !marketplacePath.trim() || !pluginName.trim()} type="submit">
                      {readPluginMutation.isPending
                        ? i18n._({
                            id: 'Reading…',
                            message: 'Reading…',
                          })
                        : i18n._({
                            id: 'Read plugin',
                            message: 'Read plugin',
                          })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary"
                      disabled={!workspaceId || !marketplacePath.trim() || !pluginName.trim()}
                      onClick={() => installPluginMutation.mutate()}
                      type="button"
                    >
                      {installPluginMutation.isPending
                        ? i18n._({
                            id: 'Installing…',
                            message: 'Installing…',
                          })
                        : i18n._({
                            id: 'Install',
                            message: 'Install',
                          })}
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
                  <Input
                    label={i18n._({ id: 'Plugin ID', message: 'Plugin ID' })}
                    onChange={(event) => setPluginId(event.target.value)}
                    value={pluginId}
                  />
                  <div className="setting-row__actions" style={{ marginTop: '10px' }}>
                    <button className="ide-button ide-button--secondary" disabled={!workspaceId || !pluginId.trim()} type="submit">
                      {uninstallPluginMutation.isPending
                        ? i18n._({
                            id: 'Uninstalling…',
                            message: 'Uninstalling…',
                          })
                        : i18n._({
                            id: 'Uninstall',
                            message: 'Uninstall',
                          })}
                    </button>
                  </div>
                  {uninstallPluginMutation.data ? (
                    <pre className="code-block mode-console__output">{JSON.stringify(uninstallPluginMutation.data, null, 2)}</pre>
                  ) : null}
                </form>
              </div>
            </section>

            <section className="mode-console">
              <div className="section-header">
                <div>
                  <h2>{i18n._({ id: 'Workspace utilities', message: 'Workspace utilities' })}</h2>
                  <p>
                    {i18n._({
                      id: 'Run lightweight operational actions from runtime instead of burying them inside settings.',
                      message:
                        'Run lightweight operational actions from runtime instead of burying them inside settings.',
                    })}
                  </p>
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
                  <Input
                    label={i18n._({ id: 'Fuzzy search query', message: 'Fuzzy search query' })}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    value={searchQuery}
                  />
                  <div className="setting-row__actions" style={{ marginTop: '10px' }}>
                    <button className="ide-button" disabled={!workspaceId || !searchQuery.trim()} type="submit">
                      {i18n._({ id: 'Search files', message: 'Search files' })}
                    </button>
                  </div>
                  {searchMutation.data ? (
                    <pre className="code-block mode-console__output">{JSON.stringify(searchMutation.data.files, null, 2)}</pre>
                  ) : null}
                  {searchMutation.error ? (
                    <InlineNotice
                      details={getErrorMessage(searchMutation.error)}
                      dismissible
                      noticeKey={`catalog-search-${searchMutation.error instanceof Error ? searchMutation.error.message : 'unknown'}`}
                      onRetry={() => searchMutation.mutate()}
                      title={i18n._({
                        id: 'Search failed',
                        message: 'Search failed',
                      })}
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
                  <Input
                    label={i18n._({
                      id: 'Feedback classification',
                      message: 'Feedback classification',
                    })}
                    onChange={(event) => setFeedbackClassification(event.target.value)}
                    value={feedbackClassification}
                  />
                  <TextArea
                    label={i18n._({ id: 'Reason', message: 'Reason' })}
                    onChange={(event) => setFeedbackReason(event.target.value)}
                    rows={4}
                    value={feedbackReason}
                  />
                  <Switch
                    label={i18n._({ id: 'Include logs', message: 'Include logs' })}
                    checked={includeLogs}
                    onChange={(event) => setIncludeLogs(event.target.checked)}
                  />
                  <div className="setting-row__actions" style={{ marginTop: '10px' }}>
                    <button className="ide-button ide-button--secondary" disabled={!workspaceId} type="submit">
                      {i18n._({ id: 'Upload feedback', message: 'Upload feedback' })}
                    </button>
                  </div>
                  {feedbackMutation.data ? (
                    <pre className="code-block mode-console__output">{JSON.stringify(feedbackMutation.data, null, 2)}</pre>
                  ) : null}
                  {feedbackMutation.error ? (
                    <InlineNotice
                      details={getErrorMessage(feedbackMutation.error)}
                      dismissible
                      noticeKey={`catalog-feedback-${feedbackMutation.error instanceof Error ? feedbackMutation.error.message : 'unknown'}`}
                      onRetry={() => feedbackMutation.mutate()}
                      title={i18n._({
                        id: 'Feedback upload failed',
                        message: 'Feedback upload failed',
                      })}
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
      return i18n._({ id: 'Default', message: 'Default' })
    case 'disabled':
      return i18n._({ id: 'Disabled', message: 'Disabled' })
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
}: RuntimeSectionProps) {
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
      {loading ? (
        <div className="notice">{i18n._({ id: 'Loading…', message: 'Loading…' })}</div>
      ) : null}
      {!loading && !items.length ? (
        <div className="empty-state">
          {i18n._({
            id: 'No entries available.',
            message: 'No entries available.',
          })}
        </div>
      ) : null}
      <div className="runtime-list">
        {items.map((item) => (
          <article className="runtime-item" key={item.id}>
            <div className="runtime-item__icon">{marker}</div>
            <div className="runtime-item__body">
              <strong>{item.name}</strong>
              {item.value && item.value !== item.name ? <p><code>{item.value}</code></p> : null}
              {item.shellType ? (
                <p>
                  <code>
                    {i18n._({ id: 'Shell type', message: 'Shell type' })}: {item.shellType}
                  </code>
                </p>
              ) : null}
              <p>
                {item.description ||
                  i18n._({
                    id: 'No description provided.',
                    message: 'No description provided.',
                  })}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
