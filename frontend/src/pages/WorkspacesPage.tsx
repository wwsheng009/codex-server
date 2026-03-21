import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { InlineNotice } from '../components/ui/InlineNotice'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StatusPill } from '../components/ui/StatusPill'
import { formatRelativeTimeShort } from '../components/workspace/timeline-utils'
import { getErrorMessage } from '../lib/error-utils'
import { createWorkspace, deleteWorkspace, listWorkspaces, restartWorkspace } from '../features/workspaces/api'
import { useSessionStore } from '../stores/session-store'
import { useUIStore } from '../stores/ui-store'
import type { Workspace } from '../types/api'

export function WorkspacesPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [confirmingWorkspaceDelete, setConfirmingWorkspaceDelete] = useState<Workspace | null>(null)
  const removeWorkspaceFromSession = useSessionStore((state) => state.removeWorkspace)
  const workspaceRestartStateById = useUIStore((state) => state.workspaceRestartStateById)
  const markWorkspaceRestarting = useUIStore((state) => state.markWorkspaceRestarting)
  const markWorkspaceRestarted = useUIStore((state) => state.markWorkspaceRestarted)
  const clearWorkspaceRestartState = useUIStore((state) => state.clearWorkspaceRestartState)

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
  const restartWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => restartWorkspace(workspaceId),
    onMutate: (workspaceId) => {
      markWorkspaceRestarting(workspaceId)
    },
    onSuccess: (workspace) => {
      markWorkspaceRestarted(workspace.id)
    },
    onError: (_, workspaceId) => {
      clearWorkspaceRestartState(workspaceId)
    },
    onSettled: async (_, __, workspaceId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
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
    if (deleteWorkspaceMutation.isPending || restartWorkspaceMutation.isPending) {
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
            Register runtime roots, inspect workspace health, and manage your local development environments.
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
            <div className="mode-metric">
              <span>Total</span>
              <strong>{workspaces.length}</strong>
            </div>
            <div className="mode-metric">
              <span>Healthy</span>
              <strong>{healthyWorkspaces}</strong>
            </div>
          </div>
          <button className="ide-button" onClick={() => (document.getElementById('workspace-name-input') as HTMLInputElement)?.focus()} type="button">
            New Workspace
          </button>
        </div>
      </header>

      <div className="mode-layout mode-layout--wide">
        <aside className="mode-rail">
          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>Create Workspace</h2>
                <p>Register a runtime root to start building threads and automations.</p>
              </div>
            </div>
            <form className="form-stack" onSubmit={handleSubmit}>
              <label className="field">
                <span>Name</span>
                <input id="workspace-name-input" onChange={(event) => setName(event.target.value)} placeholder="ai-gateway" value={name} />
              </label>
              <label className="field">
                <span>Root Path</span>
                <input
                  onChange={(event) => setRootPath(event.target.value)}
                  placeholder="E:/projects/my-app"
                  value={rootPath}
                />
              </label>
              <button className="ide-button" disabled={!name.trim() || !rootPath.trim() || createWorkspaceMutation.isPending} type="submit">
                {createWorkspaceMutation.isPending ? 'Creating…' : 'Register Workspace'}
              </button>
              {createWorkspaceMutation.error ? (
                <InlineNotice
                  details={getErrorMessage(createWorkspaceMutation.error)}
                  dismissible
                  noticeKey={`create-workspace-${createWorkspaceMutation.error instanceof Error ? createWorkspaceMutation.error.message : 'unknown'}`}
                  title="Setup Failed"
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
                <p>Status summary of your registered development roots.</p>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>Distinct Roots</span>
                <strong>{distinctRoots}</strong>
              </div>
              <div className="detail-row">
                <span>Last Activity</span>
                <strong>{workspaces[0]?.updatedAt ? formatRelativeTimeShort(workspaces[0].updatedAt) : '—'}</strong>
              </div>
            </div>
          </section>
        </aside>

        <section className="mode-stage">
          <div className="stack-screen">
            {workspaces.filter(w => ['ready', 'active', 'connected'].includes(w.runtimeStatus)).length > 0 && (
              <section className="content-section">
                <div className="section-header">
                  <div>
                    <h2>Running Workspaces</h2>
                    <p>Active runtimes available for immediate interaction.</p>
                  </div>
                </div>
                <div className="workspace-grid">
                  {workspaces
                    .filter(w => ['ready', 'active', 'connected'].includes(w.runtimeStatus))
                    .slice(0, 4)
                    .map((workspace) => (
                      <div className="workspace-card" key={workspace.id}>
                        <div className="workspace-card__header">
                          <StatusPill status={workspace.runtimeStatus} />
                          <span className="meta-label">{formatRelativeTimeShort(workspace.updatedAt)}</span>
                        </div>
                        <div className="workspace-card__body">
                          <strong>{workspace.name}</strong>
                          <p>{workspace.rootPath}</p>
                        </div>
                        <div className="workspace-card__footer">
                          <Link className="ide-button ide-button--secondary" to={`/workspaces/${workspace.id}`}>
                            Open
                          </Link>
                          <button
                            className="ide-button ide-button--secondary"
                            onClick={() => restartWorkspaceMutation.mutate(workspace.id)}
                            type="button"
                          >
                            Restart
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            )}

            <section className="content-section">
              <div className="section-header">
                <div>
                  <h2>All Workspaces</h2>
                  <p>Comprehensive registry of all configured development environments.</p>
                </div>
                <div className="section-header__meta">{workspaces.length}</div>
              </div>

              {workspacesQuery.isLoading ? <div className="notice">Loading registry…</div> : null}
              
              <div className="workspace-compact-list">
                {workspaces.map((workspace) => {
                  const restartPhase = workspaceRestartStateById[workspace.id]
                  const visualStatus = restartPhase === 'restarting' ? 'restarting' : workspace.runtimeStatus

                  return (
                    <div className="workspace-compact-row" key={workspace.id}>
                      <Link className="workspace-compact-row__main" to={`/workspaces/${workspace.id}`}>
                        <div className="workspace-compact-row__title">
                          <strong>{workspace.name}</strong>
                          <span className="meta-label">ID: {workspace.id.slice(0, 8)}</span>
                        </div>
                        <p>{workspace.rootPath}</p>
                      </Link>
                      <div className="workspace-compact-row__actions">
                        <StatusPill status={visualStatus} />
                        <div className="divider-v" />
                        <button
                          className="icon-button-text"
                          disabled={restartPhase === 'restarting'}
                          onClick={() => restartWorkspaceMutation.mutate(workspace.id)}
                          type="button"
                        >
                          {restartPhase === 'restarting' ? '...' : 'Restart'}
                        </button>
                        <button
                          className="icon-button-text icon-button-text--danger"
                          onClick={() => handleDeleteWorkspace(workspace)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
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
