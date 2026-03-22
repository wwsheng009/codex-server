import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { InlineNotice } from '../components/ui/InlineNotice'
import { listRemoteSkills, listSkills } from '../features/catalog/api'
import { listWorkspaces } from '../features/workspaces/api'
import { SelectControl } from '../components/ui/SelectControl'
import { getErrorMessage } from '../lib/error-utils'

type SkillCardItem = {
  id: string
  name: string
  description: string
}

export function SkillsPage() {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

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

  const localSkillsQuery = useQuery({
    queryKey: ['skills-page-local', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => listSkills(workspaceId!),
  })

  const remoteSkillsQuery = useQuery({
    queryKey: ['skills-page-remote', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const result = await listRemoteSkills(workspaceId!, {
        enabled: false,
        hazelnutScope: 'example',
        productSurface: 'codex',
      })
      return result.data
    },
  })

  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const localSkills = useMemo(
    () => filterByQuery(localSkillsQuery.data ?? [], normalizedQuery),
    [localSkillsQuery.data, normalizedQuery],
  )
  const remoteSkills = useMemo(
    () => filterByQuery(remoteSkillsQuery.data ?? [], normalizedQuery),
    [normalizedQuery, remoteSkillsQuery.data],
  )
  const workspaceName = useMemo(
    () => workspacesQuery.data?.find((workspace) => workspace.id === workspaceId)?.name ?? 'No workspace',
    [workspaceId, workspacesQuery.data],
  )
  const filteredCount = localSkills.length + remoteSkills.length
  const workspacesError = workspacesQuery.error ? getErrorMessage(workspacesQuery.error) : null
  const localSkillsError = localSkillsQuery.error ? getErrorMessage(localSkillsQuery.error) : null
  const remoteSkillsError = remoteSkillsQuery.error ? getErrorMessage(remoteSkillsQuery.error) : null

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">Skills</div>
          <div className="mode-strip__title-row">
            <strong>Skill Catalog</strong>
          </div>
          <div className="mode-strip__description">
            Browse installed and remote skills for the active workspace from one tighter directory surface.
          </div>
        </div>
        <div className="mode-strip__actions">
          <span className="meta-pill">{localSkillsQuery.data?.length ?? 0} installed</span>
          <span className="meta-pill">{remoteSkillsQuery.data?.length ?? 0} remote</span>
          <span className="meta-pill">{filteredCount} visible</span>
        </div>
      </header>

      <div className="mode-layout">
        <aside className="mode-rail">
          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>Workspace Scope</h2>
                <p>Skill discovery stays bound to the active runtime root.</p>
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
            <label className="field">
              <span>Search</span>
              <input onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" value={query} />
            </label>
            <div className="detail-list">
              <div className="detail-row">
                <span>Current Scope</span>
                <strong>{workspaceName}</strong>
              </div>
              <div className="detail-row">
                <span>Query</span>
                <strong>{normalizedQuery || 'all skills'}</strong>
              </div>
            </div>
          </section>

          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>Directory Posture</h2>
                <p>Installed and remote entries are kept in the same explorer-style scan path.</p>
              </div>
            </div>
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>Installed</span>
                <strong>{localSkillsQuery.data?.length ?? 0}</strong>
              </div>
              <div className="mode-metric">
                <span>Remote</span>
                <strong>{remoteSkillsQuery.data?.length ?? 0}</strong>
              </div>
              <div className="mode-metric">
                <span>Visible</span>
                <strong>{filteredCount}</strong>
              </div>
            </div>
          </section>
        </aside>

        <div className="mode-stage stack-screen">
          {workspacesError ? (
            <InlineNotice
              dismissible
              noticeKey={`skills-workspaces-${workspacesError}`}
              onRetry={() => void workspacesQuery.refetch()}
              title="Failed To Load Workspaces"
              tone="error"
            >
              {workspacesError}
            </InlineNotice>
          ) : null}
          {!workspacesQuery.isLoading && !workspacesError && !workspaceId ? (
            <div className="empty-state">Create a workspace first to browse installed and remote skills.</div>
          ) : null}
          <DirectorySection
            description="Installed skills already available in the selected workspace runtime."
            emptyMessage="No installed skills available."
            errorMessage={localSkillsError}
            items={localSkills}
            loading={localSkillsQuery.isLoading}
            marker="IN"
            onRetry={() => void localSkillsQuery.refetch()}
            sourceLabel="Installed"
            titleError="Failed To Load Installed Skills"
            title="Installed Skills"
          />
          <DirectorySection
            description="Remote skills that can be inspected or brought into the current workspace later."
            emptyMessage="No remote skills available."
            errorMessage={remoteSkillsError}
            items={remoteSkills}
            loading={remoteSkillsQuery.isLoading}
            marker="RM"
            onRetry={() => void remoteSkillsQuery.refetch()}
            sourceLabel="Remote"
            titleError="Failed To Load Remote Skills"
            title="Remote Skills"
          />
        </div>
      </div>
    </section>
  )
}

function DirectorySection({
  title,
  description,
  items,
  loading,
  marker,
  sourceLabel,
  emptyMessage,
  errorMessage,
  onRetry,
  titleError,
}: {
  title: string
  description: string
  items: SkillCardItem[]
  loading: boolean
  marker: string
  sourceLabel: string
  emptyMessage: string
  errorMessage?: string | null
  onRetry?: () => void
  titleError: string
}) {
  return (
    <section className="mode-panel mode-panel--flush">
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
      {errorMessage ? (
        <InlineNotice
          dismissible
          noticeKey={`${title}-${errorMessage}`}
          onRetry={onRetry}
          title={titleError}
          tone="error"
        >
          {errorMessage}
        </InlineNotice>
      ) : null}
      {!loading && !errorMessage && !items.length ? <div className="empty-state">{emptyMessage}</div> : null}
      <div className="directory-list">
        {items.map((item) => (
          <article className="directory-item" key={item.id}>
            <div className="directory-item__icon">{marker}</div>
            <div className="directory-item__body">
              <strong>{item.name}</strong>
              <p>{item.description || 'No description provided.'}</p>
            </div>
            <div className="directory-item__meta">
              <span className="meta-pill">{sourceLabel}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function filterByQuery<T extends SkillCardItem>(items: T[], query: string) {
  if (!query) return items
  return items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query))
}
