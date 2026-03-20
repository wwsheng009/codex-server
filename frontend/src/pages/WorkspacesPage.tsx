import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { InlineNotice } from '../components/ui/InlineNotice'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StatusPill } from '../components/ui/StatusPill'
import { formatRelativeTimeShort } from '../components/workspace/timeline-utils'
import { getErrorMessage } from '../lib/error-utils'
import { createWorkspace, deleteWorkspace, listWorkspaces } from '../features/workspaces/api'
import { useSessionStore } from '../stores/session-store'
import type { Workspace } from '../types/api'

export function WorkspacesPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [confirmingWorkspaceDelete, setConfirmingWorkspaceDelete] = useState<Workspace | null>(null)
  const removeWorkspaceFromSession = useSessionStore((state) => state.removeWorkspace)

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
    onSuccess: async () => {
      setName('')
      setRootPath('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads'] }),
      ])
    },
  })
  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => deleteWorkspace(workspaceId),
    onSuccess: async (_, workspaceId) => {
      removeWorkspaceFromSession(workspaceId)
      setConfirmingWorkspaceDelete(null)
      deleteWorkspaceMutation.reset()
      queryClient.removeQueries({ queryKey: ['workspace', workspaceId] })
      queryClient.removeQueries({ queryKey: ['threads', workspaceId] })
      queryClient.removeQueries({ queryKey: ['thread-detail', workspaceId] })
      queryClient.removeQueries({ queryKey: ['approvals', workspaceId] })
      queryClient.removeQueries({ queryKey: ['models', workspaceId] })
      queryClient.removeQueries({ queryKey: ['shell-threads', workspaceId] })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads'] }),
      ])
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

  function handleDeleteWorkspace(workspace: Workspace) {
    if (deleteWorkspaceMutation.isPending) {
      return
    }

    deleteWorkspaceMutation.reset()
    setConfirmingWorkspaceDelete(workspace)
  }

  function handleCloseDeleteWorkspaceDialog() {
    if (deleteWorkspaceMutation.isPending) {
      return
    }

    setConfirmingWorkspaceDelete(null)
    deleteWorkspaceMutation.reset()
  }

  function handleConfirmDeleteWorkspaceDialog() {
    if (!confirmingWorkspaceDelete || deleteWorkspaceMutation.isPending) {
      return
    }

    deleteWorkspaceMutation.mutate(confirmingWorkspaceDelete.id)
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
                <InlineNotice
                  details={getErrorMessage(createWorkspaceMutation.error)}
                  dismissible
                  noticeKey={`create-workspace-${createWorkspaceMutation.error instanceof Error ? createWorkspaceMutation.error.message : 'unknown'}`}
                  title="Failed To Create Workspace"
                  tone="error"
                >
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
              <InlineNotice
                details={getErrorMessage(workspacesQuery.error)}
                dismissible
                noticeKey={`load-workspaces-${workspacesQuery.error instanceof Error ? workspacesQuery.error.message : 'unknown'}`}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: ['workspaces'] })}
                title="Failed To Load Workspaces"
                tone="error"
              >
                {getErrorMessage(workspacesQuery.error)}
              </InlineNotice>
            ) : null}
            {!workspacesQuery.isLoading && !workspaces.length ? (
              <div className="empty-state">No workspaces yet. Create the first one from the rail.</div>
            ) : null}
            <div className="workspace-registry">
              {workspaces.map((workspace) => (
                <div className="workspace-registry__row" key={workspace.id}>
                  <Link className="workspace-registry__row-link" to={`/workspaces/${workspace.id}`}>
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
                  </Link>
                  <div className="workspace-registry__actions">
                    <Link className="workspace-registry__action-link" to={`/workspaces/${workspace.id}`}>
                      Open Surface
                    </Link>
                    <button
                      className="workspace-registry__remove"
                      disabled={deleteWorkspaceMutation.isPending}
                      onClick={() => handleDeleteWorkspace(workspace)}
                      type="button"
                    >
                      {deleteWorkspaceMutation.isPending && deleteWorkspaceMutation.variables === workspace.id
                        ? 'Removing…'
                        : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
      {confirmingWorkspaceDelete ? (
        <ConfirmDialog
          confirmLabel="Remove Workspace"
          description="This removes the workspace from the registry and clears its loaded thread list from the UI."
          error={deleteWorkspaceMutation.error ? getErrorMessage(deleteWorkspaceMutation.error) : null}
          isPending={deleteWorkspaceMutation.isPending}
          onClose={handleCloseDeleteWorkspaceDialog}
          onConfirm={handleConfirmDeleteWorkspaceDialog}
          subject={confirmingWorkspaceDelete.name}
          title="Remove Workspace?"
        />
      ) : null}
    </section>
  )
}
