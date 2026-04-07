import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  installPlugin,
  listApps,
  listCollaborationModes,
  listModels,
  listPlugins,
  listSkills,
  readPlugin,
  uninstallPlugin,
} from '../features/catalog/api'
import { fuzzyFileSearch, uploadFeedback } from '../features/settings/api'
import { listWorkspaces } from '../features/workspaces/api'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { SelectControl } from '../components/ui/SelectControl'
import { Tabs, activateStoredTab } from '../components/ui/Tabs'
import { TextArea } from '../components/ui/TextArea'
import { Switch } from '../components/ui/Switch'
import { formatLocaleNumber } from '../i18n/format'
import { getActiveLocale, i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import { InlineNotice } from '../components/ui/InlineNotice'
import type {
  CatalogSectionItem,
  CatalogQueryData,
  RuntimeSectionProps,
} from './catalogPageTypes'

type RuntimeSectionData = {
  title: string
  description: string
  marker: string
  items: CatalogSectionItem[]
}

type RuntimeInventoryGroup = {
  id: string
  label: string
  description: string
  summary: string
  sections: RuntimeSectionData[]
  count: number
}

type RuntimeMetaChip = {
  label: string
  tone?: 'default' | 'good' | 'warn'
}

type RuntimeFact = {
  label: string
  value: string
  code?: boolean
}

type RuntimeInventoryGroupPanelProps = {
  title: string
  description: string
  query: string
  loading: boolean
  sections: RuntimeSectionData[]
  onInstallPlugin?: (item: CatalogSectionItem) => void
  onReadPlugin?: (item: CatalogSectionItem) => void
  onUninstallPlugin?: (item: CatalogSectionItem) => void
  pluginInstallPendingId?: string | null
  pluginReadPendingId?: string | null
  pluginUninstallPendingId?: string | null
}

type RuntimeActionConsoleTabsProps = {
  consoleStorageKey: string
  workspaceId?: string
  marketplacePath: string
  pluginName: string
  pluginId: string
  searchQuery: string
  feedbackClassification: string
  feedbackReason: string
  includeLogs: boolean
  onMarketplacePathChange: (value: string) => void
  onPluginNameChange: (value: string) => void
  onPluginIdChange: (value: string) => void
  onSearchQueryChange: (value: string) => void
  onFeedbackClassificationChange: (value: string) => void
  onFeedbackReasonChange: (value: string) => void
  onIncludeLogsChange: (value: boolean) => void
  readPluginMutation: {
    mutate: (input: { marketplacePath: string; pluginName: string }) => void
    isPending: boolean
    data?: unknown
  }
  installPluginMutation: {
    mutate: (input: { marketplacePath: string; pluginName: string }) => void
    isPending: boolean
    data?: unknown
  }
  uninstallPluginMutation: {
    mutate: (input: { pluginId: string }) => void
    isPending: boolean
    data?: unknown
  }
  searchMutation: {
    mutate: () => void
    data?: { files?: unknown }
    error?: unknown
  }
  feedbackMutation: {
    mutate: () => void
    data?: unknown
    error?: unknown
  }
}

const INVENTORY_TAB_STORAGE_KEY = 'runtime-catalog-inventory-tab'
const CONSOLE_TAB_STORAGE_KEY = 'runtime-catalog-console-tab'

export function CatalogPage() {
  const activeLocale = getActiveLocale()
  const queryClient = useQueryClient()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [modelShellTypeFilter, setModelShellTypeFilter] = useState('all')
  const [marketplacePath, setMarketplacePath] = useState('')
  const [pluginName, setPluginName] = useState('')
  const [pluginId, setPluginId] = useState('')
  const [inventoryQuery, setInventoryQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [feedbackClassification, setFeedbackClassification] = useState('bug')
  const [feedbackReason, setFeedbackReason] = useState('')
  const [includeLogs, setIncludeLogs] = useState(true)
  const deferredInventoryQuery = useDeferredValue(inventoryQuery)

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
      const [models, skills, apps, plugins, modes] = await Promise.all([
        listModels(workspaceId!),
        listSkills(workspaceId!),
        listApps(workspaceId!),
        listPlugins(workspaceId!),
        listCollaborationModes(workspaceId!),
      ])

      return {
        models,
        skills,
        apps,
        plugins: plugins.plugins,
        pluginRemoteSyncError: plugins.remoteSyncError ?? null,
        modes,
      } satisfies CatalogQueryData
    },
  })
  const readPluginMutation = useMutation({
    mutationFn: (input: { marketplacePath: string; pluginName: string }) =>
      readPlugin(workspaceId!, input),
  })
  const installPluginMutation = useMutation({
    mutationFn: (input: { marketplacePath: string; pluginName: string }) =>
      installPlugin(workspaceId!, input),
    onSuccess: async () => {
      if (!workspaceId) {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runtime-catalog', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['mcp-server-status', workspaceId] }),
      ])
    },
  })
  const uninstallPluginMutation = useMutation({
    mutationFn: (input: { pluginId: string }) => uninstallPlugin(workspaceId!, input),
    onSuccess: async () => {
      if (!workspaceId) {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runtime-catalog', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['mcp-server-status', workspaceId] }),
      ])
    },
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
  const normalizedInventoryQuery = deferredInventoryQuery.trim().toLowerCase()
  const catalogSections = useMemo<RuntimeSectionData[]>(
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
  const filteredCatalogSections = useMemo(
    () =>
      catalogSections.map((section) => ({
        ...section,
        items: filterCatalogItems(section.items, normalizedInventoryQuery),
      })),
    [catalogSections, normalizedInventoryQuery],
  )
  const catalogSectionMap = useMemo(
    () =>
      new Map(filteredCatalogSections.map((section) => [section.marker, section] as const)),
    [filteredCatalogSections],
  )
  const totalInventoryCount = useMemo(
    () => catalogSections.reduce((count, section) => count + section.items.length, 0),
    [catalogSections],
  )
  const visibleInventoryCount = useMemo(
    () => filteredCatalogSections.reduce((count, section) => count + section.items.length, 0),
    [filteredCatalogSections],
  )
  const inventoryGroups = useMemo<RuntimeInventoryGroup[]>(
    () => [
      {
        id: 'runtime-core',
        label: i18n._({ id: 'Core runtime', message: 'Core runtime' }),
        description: i18n._({
          id: 'Execution posture, shell behavior, and collaboration defaults.',
          message: 'Execution posture, shell behavior, and collaboration defaults.',
        }),
        summary: i18n._({
          id: 'Models and modes define how the runtime executes work.',
          message: 'Models and modes define how the runtime executes work.',
        }),
        sections: [catalogSectionMap.get('MO'), catalogSectionMap.get('MD')].filter(Boolean) as RuntimeSectionData[],
        count: sumCatalogSectionItems(catalogSectionMap.get('MO'), catalogSectionMap.get('MD')),
      },
      {
        id: 'runtime-capabilities',
        label: i18n._({ id: 'Skills and apps', message: 'Skills and apps' }),
        description: i18n._({
          id: 'Mounted skills and connected app surfaces.',
          message: 'Mounted skills and connected app surfaces.',
        }),
        summary: i18n._({
          id: 'Workspace abilities are easier to scan when they stay in one lane.',
          message: 'Workspace abilities are easier to scan when they stay in one lane.',
        }),
        sections: [catalogSectionMap.get('SK'), catalogSectionMap.get('AP')].filter(Boolean) as RuntimeSectionData[],
        count: sumCatalogSectionItems(catalogSectionMap.get('SK'), catalogSectionMap.get('AP')),
      },
      {
        id: 'runtime-extensions',
        label: i18n._({ id: 'Plugins and extensions', message: 'Plugins and extensions' }),
        description: i18n._({
          id: 'Installed or discoverable extension points for the active workspace.',
          message: 'Installed or discoverable extension points for the active workspace.',
        }),
        summary: i18n._({
          id: 'Marketplace-driven inventory deserves a dedicated extension board.',
          message: 'Marketplace-driven inventory deserves a dedicated extension board.',
        }),
        sections: [catalogSectionMap.get('PL')].filter(Boolean) as RuntimeSectionData[],
        count: sumCatalogSectionItems(catalogSectionMap.get('PL')),
      },
    ],
    [activeLocale, catalogSectionMap],
  )
  const coreInventoryCount = inventoryGroups[0]?.count ?? 0
  const capabilityInventoryCount = inventoryGroups[1]?.count ?? 0
  const extensionInventoryCount = inventoryGroups[2]?.count ?? 0

  function focusPluginActionTarget(item: CatalogSectionItem) {
    setMarketplacePath(item.marketplacePath ?? '')
    setPluginName(item.name)
    setPluginId(item.id)
  }

  function handleReadPluginItem(item: CatalogSectionItem) {
    if (!workspaceId || !item.marketplacePath) {
      return
    }

    focusPluginActionTarget(item)
    readPluginMutation.mutate({
      marketplacePath: item.marketplacePath,
      pluginName: item.name,
    })
  }

  function handleInstallPluginItem(item: CatalogSectionItem) {
    if (!workspaceId || !item.marketplacePath) {
      return
    }

    focusPluginActionTarget(item)
    installPluginMutation.mutate({
      marketplacePath: item.marketplacePath,
      pluginName: item.name,
    })
  }

  function handleUninstallPluginItem(item: CatalogSectionItem) {
    if (!workspaceId || !item.id) {
      return
    }

    focusPluginActionTarget(item)
    uninstallPluginMutation.mutate({
      pluginId: item.id,
    })
  }

  const pluginInstallPendingId = installPluginMutation.isPending
    ? `${marketplacePath}:${pluginName}`
    : null
  const pluginReadPendingId = readPluginMutation.isPending
    ? `${marketplacePath}:${pluginName}`
    : null
  const pluginUninstallPendingId = uninstallPluginMutation.isPending ? pluginId : null
  const inventoryTabItems = inventoryGroups.map((group) => ({
    id: group.id,
    label: group.label,
    badge: formatLocaleNumber(group.count),
    content: (
      <RuntimeInventoryGroupPanel
        description={group.description}
        loading={catalogQuery.isLoading}
        onInstallPlugin={handleInstallPluginItem}
        onReadPlugin={handleReadPluginItem}
        onUninstallPlugin={handleUninstallPluginItem}
        pluginInstallPendingId={pluginInstallPendingId}
        pluginReadPendingId={pluginReadPendingId}
        pluginUninstallPendingId={pluginUninstallPendingId}
        query={normalizedInventoryQuery}
        sections={group.sections}
        title={group.label}
      />
    ),
  }))

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
              id: 'Inspect runtime inventory and run plugin and workspace actions from a tighter control-surface layout.',
              message:
                'Inspect runtime inventory and run plugin and workspace actions from a tighter control-surface layout.',
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
            <Input
              label={i18n._({ id: 'Inventory search', message: 'Inventory search' })}
              onChange={(event) => setInventoryQuery(event.target.value)}
              placeholder={i18n._({
                id: 'Filter models, skills, apps, plugins…',
                message: 'Filter models, skills, apps, plugins…',
              })}
              value={inventoryQuery}
            />
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Current scope', message: 'Current scope' })}</span>
                <strong>{workspaceName}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Visible entries', message: 'Visible entries' })}</span>
                <strong>
                  {normalizedInventoryQuery
                    ? `${formatLocaleNumber(visibleInventoryCount)} / ${formatLocaleNumber(totalInventoryCount)}`
                    : formatLocaleNumber(totalInventoryCount)}
                </strong>
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
                <span>{i18n._({ id: 'Core', message: 'Core' })}</span>
                <strong>{formatLocaleNumber(coreInventoryCount)}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Skills and apps', message: 'Skills and apps' })}</span>
                <strong>{formatLocaleNumber(capabilityInventoryCount)}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Extensions', message: 'Extensions' })}</span>
                <strong>{formatLocaleNumber(extensionInventoryCount)}</strong>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Models', message: 'Models' })}</span>
                <strong>{formatLocaleNumber(catalogQuery.data?.models.length ?? 0)}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Apps', message: 'Apps' })}</span>
                <strong>{formatLocaleNumber(catalogQuery.data?.apps.length ?? 0)}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Plugins', message: 'Plugins' })}</span>
                <strong>{formatLocaleNumber(catalogQuery.data?.plugins.length ?? 0)}</strong>
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
          {catalogQuery.data?.pluginRemoteSyncError ? (
            <InlineNotice
              details={catalogQuery.data.pluginRemoteSyncError}
              dismissible
              noticeKey={`catalog-plugin-remote-sync-${catalogQuery.data.pluginRemoteSyncError}`}
              title={i18n._({
                id: 'Plugin sync warning',
                message: 'Plugin sync warning',
              })}
            >
              {i18n._({
                id: 'The runtime loaded plugin inventory, but remote curated sync reported an error. Local plugin data is still available below.',
                message:
                  'The runtime loaded plugin inventory, but remote curated sync reported an error. Local plugin data is still available below.',
              })}
            </InlineNotice>
          ) : null}

          <section className="mode-panel mode-panel--compact">
            <div className="mode-panel__body">
              <div className="section-header section-header--inline">
                <div>
                  <h2>{i18n._({ id: 'Inventory board', message: 'Inventory board' })}</h2>
                  <p>
                    {i18n._({
                      id: 'Start from grouped summaries, then drill into the active lane instead of scanning every inventory panel at once.',
                      message:
                        'Start from grouped summaries, then drill into the active lane instead of scanning every inventory panel at once.',
                    })}
                  </p>
                </div>
                <div className="section-header__meta">{formatLocaleNumber(visibleInventoryCount)}</div>
              </div>
              <div className="runtime-summary-grid">
                {inventoryGroups.map((group) => (
                  <button
                    className="runtime-summary-card"
                    key={group.id}
                    onClick={() => activateStoredTab(INVENTORY_TAB_STORAGE_KEY, group.id)}
                    type="button"
                  >
                    <span className="runtime-summary-card__eyebrow">{group.label}</span>
                    <strong>{formatLocaleNumber(group.count)}</strong>
                    <p>{group.summary}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="runtime-tabs-shell">
              <Tabs
                ariaLabel={i18n._({
                  id: 'Runtime inventory groups',
                  message: 'Runtime inventory groups',
                })}
                items={inventoryTabItems}
                storageKey={INVENTORY_TAB_STORAGE_KEY}
              />
            </div>
          </section>

          <RuntimeActionConsoleTabs
            consoleStorageKey={CONSOLE_TAB_STORAGE_KEY}
            feedbackClassification={feedbackClassification}
            feedbackMutation={feedbackMutation}
            feedbackReason={feedbackReason}
            includeLogs={includeLogs}
            installPluginMutation={installPluginMutation}
            marketplacePath={marketplacePath}
            onFeedbackClassificationChange={setFeedbackClassification}
            onFeedbackReasonChange={setFeedbackReason}
            onIncludeLogsChange={setIncludeLogs}
            onMarketplacePathChange={setMarketplacePath}
            onPluginIdChange={setPluginId}
            onPluginNameChange={setPluginName}
            onSearchQueryChange={setSearchQuery}
            pluginId={pluginId}
            pluginName={pluginName}
            readPluginMutation={readPluginMutation}
            searchMutation={searchMutation}
            searchQuery={searchQuery}
            uninstallPluginMutation={uninstallPluginMutation}
            workspaceId={workspaceId}
          />
        </div>
      </div>
    </section>
  )
}

function formatShellTypeLabel(value: string) {
  switch (value) {
    case 'local':
      return i18n._({ id: 'Local Shell', message: 'Local Shell' })
    case 'shell_command':
      return i18n._({ id: 'Shell Command', message: 'Shell Command' })
    case 'unified_exec':
      return i18n._({ id: 'Unified Execution', message: 'Unified Execution' })
    case 'default':
      return i18n._({ id: 'Default', message: 'Default' })
    case 'disabled':
      return i18n._({ id: 'Disabled', message: 'Disabled' })
    default:
      return value
  }
}

function normalizeCatalogToken(value?: string | null) {
  return (value ?? '')
    .trim()
    .replace(/[-\s]+/g, '_')
    .toUpperCase()
}

function formatCatalogFallbackLabel(value?: string | null) {
  const trimmed = (value ?? '').trim()
  if (!trimmed) {
    return i18n._({ id: 'Unknown', message: 'Unknown' })
  }

  return trimmed
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ')
}

function formatPluginSourceType(value?: string | null) {
  switch (normalizeCatalogToken(value)) {
    case 'LOCAL':
      return i18n._({ id: 'Local', message: 'Local' })
    case 'MARKETPLACE':
      return i18n._({ id: 'Marketplace', message: 'Marketplace' })
    case 'WORKSPACE':
      return i18n._({ id: 'Workspace', message: 'Workspace' })
    case 'BUILT_IN':
    case 'BUILTIN':
      return i18n._({ id: 'Built-in', message: 'Built-in' })
    case '':
      return i18n._({ id: 'Unknown', message: 'Unknown' })
    default:
      return formatCatalogFallbackLabel(value)
  }
}

function formatPluginSourceText(sourceType?: string | null, sourcePath?: string | null) {
  const trimmedPath = (sourcePath ?? '').trim()
  if (!trimmedPath) {
    return null
  }

  return `${formatPluginSourceType(sourceType)} ${trimmedPath}`
}

function sumCatalogSectionItems(...sections: Array<RuntimeSectionData | undefined>) {
  return sections.reduce((count, section) => count + (section?.items.length ?? 0), 0)
}

function filterCatalogItems(items: CatalogSectionItem[], query: string) {
  if (!query) {
    return items
  }

  return items.filter((item) =>
    [
      item.name,
      item.description,
      item.value,
      item.shellType,
      item.shellType ? formatShellTypeLabel(item.shellType) : null,
      item.marketplaceName,
      item.sourceType,
      item.sourceType ? formatPluginSourceType(item.sourceType) : null,
      item.sourcePath,
      item.category,
      item.category ? formatCatalogFallbackLabel(item.category) : null,
      item.authPolicy,
      item.authPolicy ? formatPluginPolicy(item.authPolicy) : null,
      item.installPolicy,
      item.installPolicy ? formatPluginPolicy(item.installPolicy) : null,
      item.capabilities?.join(' '),
      item.capabilities?.map((capability) => formatCatalogFallbackLabel(capability)).join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query),
  )
}

function RuntimeActionConsoleTabs({
  consoleStorageKey,
  workspaceId,
  marketplacePath,
  pluginName,
  pluginId,
  searchQuery,
  feedbackClassification,
  feedbackReason,
  includeLogs,
  onMarketplacePathChange,
  onPluginNameChange,
  onPluginIdChange,
  onSearchQueryChange,
  onFeedbackClassificationChange,
  onFeedbackReasonChange,
  onIncludeLogsChange,
  readPluginMutation,
  installPluginMutation,
  uninstallPluginMutation,
  searchMutation,
  feedbackMutation,
}: RuntimeActionConsoleTabsProps) {
  return (
    <section className="mode-panel mode-panel--compact">
      <div className="mode-panel__body">
        <div className="section-header section-header--inline">
          <div>
            <h2>{i18n._({ id: 'Action console', message: 'Action console' })}</h2>
            <p>
              {i18n._({
                id: 'Operational actions now live in their own tabbed console instead of competing with inventory cards for attention.',
                message:
                  'Operational actions now live in their own tabbed console instead of competing with inventory cards for attention.',
              })}
            </p>
          </div>
          <div className="section-header__meta">{i18n._({ id: '2 lanes', message: '2 lanes' })}</div>
        </div>
      </div>
      <div className="runtime-tabs-shell">
        <Tabs
          ariaLabel={i18n._({
            id: 'Runtime action groups',
            message: 'Runtime action groups',
          })}
          items={[
            {
              id: 'runtime-console-plugins',
              label: i18n._({ id: 'Plugins', message: 'Plugins' }),
              badge: '1',
              content: (
                <section className="runtime-console-panel">
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
                          readPluginMutation.mutate({
                            marketplacePath,
                            pluginName,
                          })
                        }
                      }}
                    >
                      <Input
                        label={i18n._({ id: 'Marketplace path', message: 'Marketplace path' })}
                        onChange={(event) => onMarketplacePathChange(event.target.value)}
                        value={marketplacePath}
                      />
                      <Input
                        label={i18n._({ id: 'Plugin name', message: 'Plugin name' })}
                        onChange={(event) => onPluginNameChange(event.target.value)}
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
                          onClick={() =>
                            installPluginMutation.mutate({
                              marketplacePath,
                              pluginName,
                            })
                          }
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
                      <pre className="code-block mode-console__output">
                        {JSON.stringify(readPluginMutation.data, null, 2)}
                      </pre>
                    ) : null}
                    {installPluginMutation.data ? (
                      <pre className="code-block mode-console__output">
                        {JSON.stringify(installPluginMutation.data, null, 2)}
                      </pre>
                    ) : null}

                    <form
                      className="form-stack form-stack--separated"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault()
                        if (workspaceId && pluginId.trim()) {
                          uninstallPluginMutation.mutate({
                            pluginId,
                          })
                        }
                      }}
                    >
                      <Input
                        label={i18n._({ id: 'Plugin ID', message: 'Plugin ID' })}
                        onChange={(event) => onPluginIdChange(event.target.value)}
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
                        <pre className="code-block mode-console__output">
                          {JSON.stringify(uninstallPluginMutation.data, null, 2)}
                        </pre>
                      ) : null}
                    </form>
                  </div>
                </section>
              ),
            },
            {
              id: 'runtime-console-workspace',
              label: i18n._({ id: 'Workspace utilities', message: 'Workspace utilities' }),
              badge: '2',
              content: (
                <section className="runtime-console-panel">
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
                        onChange={(event) => onSearchQueryChange(event.target.value)}
                        value={searchQuery}
                      />
                      <div className="setting-row__actions" style={{ marginTop: '10px' }}>
                        <button className="ide-button" disabled={!workspaceId || !searchQuery.trim()} type="submit">
                          {i18n._({ id: 'Search files', message: 'Search files' })}
                        </button>
                      </div>
                      {searchMutation.data ? (
                        <pre className="code-block mode-console__output">
                          {JSON.stringify(searchMutation.data.files ?? [], null, 2)}
                        </pre>
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
                        onChange={(event) => onFeedbackClassificationChange(event.target.value)}
                        value={feedbackClassification}
                      />
                      <TextArea
                        label={i18n._({ id: 'Reason', message: 'Reason' })}
                        onChange={(event) => onFeedbackReasonChange(event.target.value)}
                        rows={4}
                        value={feedbackReason}
                      />
                      <Switch
                        label={i18n._({ id: 'Include logs', message: 'Include logs' })}
                        checked={includeLogs}
                        onChange={(event) => onIncludeLogsChange(event.target.checked)}
                      />
                      <div className="setting-row__actions" style={{ marginTop: '10px' }}>
                        <button className="ide-button ide-button--secondary" disabled={!workspaceId} type="submit">
                          {i18n._({ id: 'Upload feedback', message: 'Upload feedback' })}
                        </button>
                      </div>
                      {feedbackMutation.data ? (
                        <pre className="code-block mode-console__output">
                          {JSON.stringify(feedbackMutation.data, null, 2)}
                        </pre>
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
              ),
            },
          ]}
          storageKey={consoleStorageKey}
        />
      </div>
    </section>
  )
}

function RuntimeInventoryGroupPanel({
  title,
  description,
  query,
  loading,
  sections,
  onInstallPlugin,
  onReadPlugin,
  onUninstallPlugin,
  pluginInstallPendingId,
  pluginReadPendingId,
  pluginUninstallPendingId,
}: RuntimeInventoryGroupPanelProps) {
  const visibleSections = query ? sections.filter((section) => section.items.length > 0) : sections
  const visibleCount = visibleSections.reduce((count, section) => count + section.items.length, 0)

  return (
    <div className="runtime-group-panel">
      <div className="runtime-group-panel__intro">
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
        {query ? (
          <span className="meta-pill">
            {i18n._({
              id: 'Filter: {query}',
              message: 'Filter: {query}',
              values: { query },
            })}
          </span>
        ) : null}
      </div>
      {loading ? <div className="notice">{i18n._({ id: 'Loading…', message: 'Loading…' })}</div> : null}
      {!loading && !visibleCount ? (
        <div className="empty-state">
          {query
            ? i18n._({
                id: 'No matching entries in this lane.',
                message: 'No matching entries in this lane.',
              })
            : i18n._({
                id: 'No entries available.',
                message: 'No entries available.',
              })}
        </div>
      ) : null}
      {!loading && visibleCount ? (
        <div className="runtime-stack">
          {visibleSections.map((section) => (
            <RuntimeSection
              description={section.description}
              items={section.items}
              key={section.title}
              loading={false}
              marker={section.marker}
              onInstallPlugin={section.marker === 'PL' ? onInstallPlugin : undefined}
              onReadPlugin={section.marker === 'PL' ? onReadPlugin : undefined}
              onUninstallPlugin={section.marker === 'PL' ? onUninstallPlugin : undefined}
              pluginInstallPendingId={pluginInstallPendingId}
              pluginReadPendingId={pluginReadPendingId}
              pluginUninstallPendingId={pluginUninstallPendingId}
              title={section.title}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RuntimeSection({
  title,
  description,
  items,
  loading,
  marker,
  onInstallPlugin,
  onReadPlugin,
  onUninstallPlugin,
  pluginInstallPendingId,
  pluginReadPendingId,
  pluginUninstallPendingId,
}: RuntimeSectionProps) {
  return (
    <section className="mode-panel mode-panel--flush mode-panel--compact runtime-section-panel">
      <div className="mode-panel__body">
        <div className="section-header section-header--inline">
          <div>
            <h2>{title}</h2>
          </div>
          <div className="section-header__meta">{formatLocaleNumber(items.length)}</div>
        </div>
        <p className="mode-panel__description">{description}</p>
      </div>
      {loading ? <div className="notice">{i18n._({ id: 'Loading…', message: 'Loading…' })}</div> : null}
      {!loading && !items.length ? (
        <div className="empty-state">
          {i18n._({
            id: 'No entries available.',
            message: 'No entries available.',
          })}
        </div>
      ) : null}
      <div className="runtime-list">
        {items.map((item) => {
          if (marker === 'MO') {
            return <RuntimeModelItem item={item} key={item.id} marker={marker} />
          }
          if (marker === 'PL') {
            return (
              <RuntimePluginItem
                item={item}
                key={item.id}
                marker={marker}
                onInstallPlugin={onInstallPlugin}
                onReadPlugin={onReadPlugin}
                onUninstallPlugin={onUninstallPlugin}
                pluginInstallPendingId={pluginInstallPendingId}
                pluginReadPendingId={pluginReadPendingId}
                pluginUninstallPendingId={pluginUninstallPendingId}
              />
            )
          }

          const metaChips = buildRuntimeMetaChips(item)
          const facts = buildRuntimeFacts(item)

          return (
            <article className="runtime-item" key={item.id}>
              <div className="runtime-item__icon">{marker}</div>
              <div className="runtime-item__body">
                <div className="runtime-item__header">
                  <div className="runtime-item__title-row">
                    <strong>{item.name}</strong>
                    {metaChips.length ? (
                      <div className="runtime-item__chips">
                        {metaChips.map((chip) => (
                          <span
                            className={`runtime-chip runtime-chip--${chip.tone ?? 'default'}`}
                            key={`${item.id}-${chip.label}`}
                          >
                            {chip.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <p>
                  {item.description ||
                    i18n._({
                      id: 'No description provided.',
                      message: 'No description provided.',
                    })}
                </p>
                {facts.length ? (
                  <div className="runtime-item__fact-grid">
                    {facts.map((fact) => (
                      <div className="runtime-item__fact" key={`${item.id}-${fact.label}`}>
                        <span>{fact.label}</span>
                        {fact.code ? <code>{fact.value}</code> : <strong>{fact.value}</strong>}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function RuntimeModelItem({
  item,
  marker,
}: {
  item: CatalogSectionItem
  marker: string
}) {
  const modelId = item.value && item.value !== item.name ? item.value : null
  const shellTypeLabel = item.shellType ? formatShellTypeLabel(item.shellType) : null

  return (
    <article className="runtime-item runtime-item--model">
      <div className="runtime-item__icon">{marker}</div>
      <div className="runtime-item__body runtime-item__body--compact">
        <div className="runtime-item__compact-head">
          <div className="runtime-item__compact-main">
            <strong>{item.name}</strong>
            <p className="runtime-item__summary">
              {item.description ||
                i18n._({
                  id: 'No description provided.',
                  message: 'No description provided.',
                })}
            </p>
          </div>
          {shellTypeLabel || modelId ? (
            <div className="runtime-item__compact-meta">
              {shellTypeLabel ? <span className="runtime-chip">{shellTypeLabel}</span> : null}
              {modelId ? <code className="runtime-inline-code">{modelId}</code> : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function RuntimePluginItem({
  item,
  marker,
  onInstallPlugin,
  onReadPlugin,
  onUninstallPlugin,
  pluginInstallPendingId,
  pluginReadPendingId,
  pluginUninstallPendingId,
}: {
  item: CatalogSectionItem
  marker: string
  onInstallPlugin?: (item: CatalogSectionItem) => void
  onReadPlugin?: (item: CatalogSectionItem) => void
  onUninstallPlugin?: (item: CatalogSectionItem) => void
  pluginInstallPendingId?: string | null
  pluginReadPendingId?: string | null
  pluginUninstallPendingId?: string | null
}) {
  const metaChips = buildRuntimeMetaChips(item)
  const sourceText = formatPluginSourceText(item.sourceType, item.sourcePath)

  return (
    <article className="runtime-item runtime-item--plugin">
      <div className="runtime-item__icon">{marker}</div>
      <div className="runtime-item__plugin-stack">
        <div className="runtime-item__plugin-title-row">
          <strong>{item.name}</strong>
          {metaChips.length ? (
            <div className="runtime-item__chips">
              {metaChips.map((chip) => (
                <span
                  className={`runtime-chip runtime-chip--${chip.tone ?? 'default'}`}
                  key={`${item.id}-${chip.label}`}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <p className="runtime-item__summary runtime-item__summary--clamped">
          {item.description ||
            i18n._({
              id: 'No description provided.',
              message: 'No description provided.',
            })}
        </p>

        <div className="runtime-inline-meta runtime-inline-meta--dense">
          {item.marketplaceName ? (
            <span className="runtime-inline-meta__entry">
              <span>{i18n._({ id: 'Marketplace', message: 'Marketplace' })}</span>
              <strong>{item.marketplaceName}</strong>
            </span>
          ) : null}
          {item.installPolicy ? (
            <span className="runtime-inline-meta__entry">
              <span>{i18n._({ id: 'Install policy', message: 'Install policy' })}</span>
              <strong>{formatPluginPolicy(item.installPolicy)}</strong>
            </span>
          ) : null}
          {item.authPolicy ? (
            <span className="runtime-inline-meta__entry">
              <span>{i18n._({ id: 'Auth policy', message: 'Auth policy' })}</span>
              <strong>{formatPluginPolicy(item.authPolicy)}</strong>
            </span>
          ) : null}
          {item.capabilities?.map((capability) => (
            <span className="runtime-chip runtime-chip--compact" key={`${item.id}-cap-${capability}`}>
              {formatCatalogFallbackLabel(capability)}
            </span>
          ))}
          {sourceText ? (
            <code
              className="runtime-inline-code runtime-inline-code--ellipsis"
              title={sourceText}
            >
              {sourceText}
            </code>
          ) : null}
        </div>
      </div>
      <div className="runtime-item__plugin-actions">
        <Button
          disabled={!item.marketplacePath}
          intent="ghost"
          isLoading={pluginReadPendingId === `${item.marketplacePath ?? ''}:${item.name}`}
          onClick={() => onReadPlugin?.(item)}
          size="sm"
        >
          {i18n._({ id: 'Read', message: 'Read' })}
        </Button>
        {!item.installed ? (
          <Button
            disabled={!item.marketplacePath}
            intent="secondary"
            isLoading={pluginInstallPendingId === `${item.marketplacePath ?? ''}:${item.name}`}
            onClick={() => onInstallPlugin?.(item)}
            size="sm"
          >
            {i18n._({ id: 'Install', message: 'Install' })}
          </Button>
        ) : (
          <Button
            intent="ghost"
            isLoading={pluginUninstallPendingId === item.id}
            onClick={() => onUninstallPlugin?.(item)}
            size="sm"
          >
            {i18n._({ id: 'Uninstall', message: 'Uninstall' })}
          </Button>
        )}
      </div>
    </article>
  )
}

function buildRuntimeMetaChips(item: CatalogSectionItem) {
  const chips = [] as RuntimeMetaChip[]

  if (typeof item.installed === 'boolean') {
    chips.push({
      label: item.installed
        ? i18n._({ id: 'Installed', message: 'Installed' })
        : i18n._({ id: 'Available', message: 'Available' }),
      tone: item.installed ? 'good' : 'default',
    })
  }
  if (typeof item.enabled === 'boolean') {
    chips.push({
      label: item.enabled
        ? i18n._({ id: 'Enabled', message: 'Enabled' })
        : i18n._({ id: 'Disabled', message: 'Disabled' }),
      tone: item.enabled ? 'good' : 'warn',
    })
  }
  if (item.category) {
    chips.push({ label: formatCatalogFallbackLabel(item.category) })
  } else if (item.shellType) {
    chips.push({ label: formatShellTypeLabel(item.shellType) })
  }

  return chips
}

function buildRuntimeFacts(item: CatalogSectionItem) {
  const facts = [] as RuntimeFact[]

  if (item.value && item.value !== item.name) {
    facts.push({
      label: i18n._({ id: 'Value', message: 'Value' }),
      value: item.value,
      code: true,
    })
  }
  if (item.shellType) {
    facts.push({
      label: i18n._({ id: 'Shell type', message: 'Shell type' }),
      value: formatShellTypeLabel(item.shellType),
    })
  }
  if (item.marketplaceName) {
    facts.push({
      label: i18n._({ id: 'Marketplace', message: 'Marketplace' }),
      value: item.marketplaceName,
    })
  }
  if (item.installPolicy) {
    facts.push({
      label: i18n._({ id: 'Install policy', message: 'Install policy' }),
      value: formatPluginPolicy(item.installPolicy),
    })
  }
  if (item.authPolicy) {
    facts.push({
      label: i18n._({ id: 'Auth policy', message: 'Auth policy' }),
      value: formatPluginPolicy(item.authPolicy),
    })
  }
  if (item.capabilities?.length) {
    facts.push({
      label: i18n._({ id: 'Capabilities', message: 'Capabilities' }),
      value: item.capabilities.map((capability) => formatCatalogFallbackLabel(capability)).join(', '),
    })
  }
  const sourceText = formatPluginSourceText(item.sourceType, item.sourcePath)
  if (sourceText) {
    facts.push({
      label: i18n._({ id: 'Source', message: 'Source' }),
      value: sourceText,
      code: true,
    })
  }

  return facts
}

function formatPluginPolicy(value: string) {
  switch (normalizeCatalogToken(value)) {
    case 'AVAILABLE':
      return i18n._({ id: 'Available', message: 'Available' })
    case 'ALLOWED':
      return i18n._({ id: 'Allowed', message: 'Allowed' })
    case 'ENABLED':
      return i18n._({ id: 'Enabled', message: 'Enabled' })
    case 'DISABLED':
      return i18n._({ id: 'Disabled', message: 'Disabled' })
    case 'INSTALLED':
      return i18n._({ id: 'Installed', message: 'Installed' })
    case 'ON_REQUEST':
      return i18n._({ id: 'On Request', message: 'On Request' })
    case 'ON_INSTALL':
      return i18n._({ id: 'On Install', message: 'On Install' })
    case 'REQUIRED':
      return i18n._({ id: 'Required', message: 'Required' })
    default:
      return formatCatalogFallbackLabel(value)
  }
}
