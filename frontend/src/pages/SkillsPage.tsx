import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { InlineNotice } from '../components/ui/InlineNotice'
import { Input } from '../components/ui/Input'
import { listSkills } from '../features/catalog/api'
import { listWorkspaces } from '../features/workspaces/api'
import { SelectControl } from '../components/ui/SelectControl'
import { formatLocaleNumber } from '../i18n/format'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import type { DirectorySectionProps, SkillCardItem } from './skillsPageTypes'

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

  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const localSkills = useMemo(
    () => filterByQuery(localSkillsQuery.data ?? [], normalizedQuery),
    [localSkillsQuery.data, normalizedQuery],
  )
  const workspaceName =
    workspacesQuery.data?.find((workspace) => workspace.id === workspaceId)?.name ??
    i18n._({
      id: 'No workspace',
      message: 'No workspace',
    })
  const filteredCount = localSkills.length
  const workspacesError = workspacesQuery.error ? getErrorMessage(workspacesQuery.error) : null
  const localSkillsError = localSkillsQuery.error ? getErrorMessage(localSkillsQuery.error) : null

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">{i18n._({ id: 'Skills', message: 'Skills' })}</div>
          <div className="mode-strip__title-row">
            <strong>{i18n._({ id: 'Skill Catalog', message: 'Skill Catalog' })}</strong>
          </div>
          <div className="mode-strip__description">
            {i18n._({
              id: 'Browse installed skills for the active workspace from one tighter directory surface.',
              message:
                'Browse installed skills for the active workspace from one tighter directory surface.',
            })}
          </div>
        </div>
        <div className="mode-strip__actions">
          <span className="meta-pill">
            {i18n._({
              id: '{count} installed',
              message: '{count} installed',
              values: { count: formatLocaleNumber(localSkillsQuery.data?.length ?? 0) },
            })}
          </span>
          <span className="meta-pill">
            {i18n._({
              id: '{count} visible',
              message: '{count} visible',
              values: { count: formatLocaleNumber(filteredCount) },
            })}
          </span>
        </div>
      </header>

      <div className="mode-layout">
        <aside className="mode-rail">
          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>{i18n._({ id: 'Workspace Scope', message: 'Workspace Scope' })}</h2>
                <p>
                  {i18n._({
                    id: 'Skill discovery stays bound to the active runtime root.',
                    message: 'Skill discovery stays bound to the active runtime root.',
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
              label={i18n._({ id: 'Search', message: 'Search' })}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={i18n._({ id: 'Search skills', message: 'Search skills' })}
              value={query}
            />
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Current Scope', message: 'Current Scope' })}</span>
                <strong>{workspaceName}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Query', message: 'Query' })}</span>
                <strong>
                  {normalizedQuery ||
                    i18n._({
                      id: 'all skills',
                      message: 'all skills',
                    })}
                </strong>
              </div>
            </div>
          </section>

          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>{i18n._({ id: 'Directory Posture', message: 'Directory Posture' })}</h2>
                <p>
                  {i18n._({
                    id: 'Installed entries stay anchored to the active runtime root.',
                    message: 'Installed entries stay anchored to the active runtime root.',
                  })}
                </p>
              </div>
            </div>
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>{i18n._({ id: 'Installed', message: 'Installed' })}</span>
                <strong>{formatLocaleNumber(localSkillsQuery.data?.length ?? 0)}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Visible', message: 'Visible' })}</span>
                <strong>{formatLocaleNumber(filteredCount)}</strong>
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
              title={i18n._({
                id: 'Failed To Load Workspaces',
                message: 'Failed To Load Workspaces',
              })}
              tone="error"
            >
              {workspacesError}
            </InlineNotice>
          ) : null}
          {!workspacesQuery.isLoading && !workspacesError && !workspaceId ? (
            <div className="empty-state">
              {i18n._({
                id: 'Create a workspace first to browse installed skills.',
                message: 'Create a workspace first to browse installed skills.',
              })}
            </div>
          ) : null}
          <DirectorySection
            description={i18n._({
              id: 'Installed skills already available in the selected workspace runtime.',
              message: 'Installed skills already available in the selected workspace runtime.',
            })}
            emptyMessage={i18n._({
              id: 'No installed skills available.',
              message: 'No installed skills available.',
            })}
            errorMessage={localSkillsError}
            items={localSkills}
            loading={localSkillsQuery.isLoading}
            marker="IN"
            onRetry={() => void localSkillsQuery.refetch()}
            sourceLabel={i18n._({ id: 'Installed', message: 'Installed' })}
            titleError={i18n._({
              id: 'Failed To Load Installed Skills',
              message: 'Failed To Load Installed Skills',
            })}
            title={i18n._({ id: 'Installed Skills', message: 'Installed Skills' })}
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
}: DirectorySectionProps) {
  return (
    <section className="mode-panel mode-panel--flush">
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
              <p>
                {item.description ||
                  i18n._({
                    id: 'No description provided.',
                    message: 'No description provided.',
                  })}
              </p>
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
