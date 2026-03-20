import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { InlineNotice } from '../components/ui/InlineNotice'
import { StatusPill } from '../components/ui/StatusPill'
import { getErrorMessage } from '../lib/error-utils'
import { formatRelativeTimeShort } from '../components/workspace/renderers'
import { createWorkspace, listWorkspaces } from '../features/workspaces/api'

export function WorkspacesPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })
  const workspaces = useMemo(
    () =>
      [...(workspacesQuery.data ?? [])].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [workspacesQuery.data],
  )
  const healthyWorkspaces = workspaces.filter((workspace) =>
    ['ready', 'active', 'connected'].includes(workspace.runtimeStatus),
  ).length
  const attentionWorkspaces = workspaces.length - healthyWorkspaces
  const distinctRoots = new Set(workspaces.map((workspace) => workspace.rootPath)).size

  const createWorkspaceMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: () => {
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !rootPath.trim()) {
      return
    }

    createWorkspaceMutation.mutate({
      name: name.trim(),
      rootPath: rootPath.trim(),
    })
  }

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">Workspace</div>
          <div className="mode-strip__title-row">
            <strong>Workbench</strong>
          </div>
          <div className="mode-strip__description">
            Register runtime roots, inspect workspace health, and jump straight into the rebuilt thread work surface.
          </div>
        </div>
        <div className="mode-strip__actions">
          <span className="meta-pill">{workspaces.length} workspaces</span>
          <span className="meta-pill">{healthyWorkspaces} healthy</span>
          <span className="meta-pill">{attentionWorkspaces} attention</span>
        </div>
      </header>

      <div className="mode-layout mode-layout--wide">
        <aside className="mode-rail">
          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>Create Workspace</h2>
                <p>Register a runtime root and drop it directly into the web IDE shell.</p>
              </div>
            </div>
            <form className="form-stack" onSubmit={handleSubmit}>
              <label className="field">
                <span>Name</span>
                <input onChange={(event) => setName(event.target.value)} placeholder="ai-gateway" value={name} />
              </label>
              <label className="field">
                <span>Root Path</span>
                <input
                  onChange={(event) => setRootPath(event.target.value)}
                  placeholder="E:/projects or /Users/you/projects"
                  value={rootPath}
                />
              </label>
              <button className="ide-button" disabled={!name.trim() || !rootPath.trim()} type="submit">
                {createWorkspaceMutation.isPending ? 'Creating…' : 'Create Workspace'}
              </button>
              {createWorkspaceMutation.error ? (
                <InlineNotice title="Failed To Create Workspace" tone="error">
                  {getErrorMessage(createWorkspaceMutation.error)}
                </InlineNotice>
              ) : null}
            </form>
          </section>

          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>Workbench Posture</h2>
                <p>Keep the registry tight and watch for roots that need runtime attention.</p>
              </div>
            </div>
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>Total</span>
                <strong>{workspaces.length}</strong>
              </div>
              <div className="mode-metric">
                <span>Healthy</span>
                <strong>{healthyWorkspaces}</strong>
              </div>
              <div className="mode-metric">
                <span>Roots</span>
                <strong>{distinctRoots}</strong>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>Newest Activity</span>
                <strong>{workspaces[0]?.updatedAt ? formatRelativeTimeShort(workspaces[0].updatedAt) : '—'}</strong>
              </div>
              <div className="detail-row">
                <span>Registry Mode</span>
                <strong>Workspace explorer</strong>
              </div>
            </div>
          </section>
        </aside>

        <section className="mode-stage">
          <section className="mode-panel mode-panel--flush">
            <div className="mode-panel__body">
              <div className="section-header section-header--inline">
                <div>
                  <h2>Workspace Registry</h2>
                  <p>Each workspace becomes the context root for threads, runtime tools, and automations.</p>
                </div>
                <div className="section-header__meta">{workspaces.length}</div>
              </div>
              <div className="mode-metrics">
                <div className="mode-metric">
                  <span>Healthy</span>
                  <strong>{healthyWorkspaces}</strong>
                </div>
                <div className="mode-metric">
                  <span>Attention</span>
                  <strong>{attentionWorkspaces}</strong>
                </div>
                <div className="mode-metric">
                  <span>Distinct Roots</span>
                  <strong>{distinctRoots}</strong>
                </div>
              </div>
            </div>

            {workspacesQuery.isLoading ? <div className="notice">Loading workspaces…</div> : null}
            {workspacesQuery.error ? (
              <InlineNotice title="Failed To Load Workspaces" tone="error">
                {getErrorMessage(workspacesQuery.error)}
              </InlineNotice>
            ) : null}
            {!workspacesQuery.isLoading && !workspaces.length ? (
              <div className="empty-state">No workspaces yet. Create the first one from the rail.</div>
            ) : null}

            <div className="workspace-registry">
              {workspaces.map((workspace) => (
                <Link className="workspace-registry__row" key={workspace.id} to={`/workspaces/${workspace.id}`}>
                  <div className="workspace-registry__main">
                    <div className="workspace-registry__title-row">
                      <strong>{workspace.name}</strong>
                      <StatusPill status={workspace.runtimeStatus} />
                    </div>
                    <p>{workspace.rootPath}</p>
                  </div>
                  <div className="workspace-registry__meta">
                    <span>ID</span>
                    <strong>{workspace.id.slice(0, 8)}</strong>
                  </div>
                  <div className="workspace-registry__meta">
                    <span>Updated</span>
                    <strong>{formatRelativeTimeShort(workspace.updatedAt)}</strong>
                  </div>
                  <div className="workspace-registry__action">Open Surface</div>
                </Link>
              ))}
            </div>
          </section>
        </section>
      </div>
    </section>
  )
}
