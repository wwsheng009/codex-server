import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  SettingsGroup,
  SettingRow,
  SettingsPageHeader,
  SettingsRecord,
} from '../../components/settings/SettingsPrimitives'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { listThreads, unarchiveThread } from '../../features/threads/api'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { getErrorMessage } from '../../lib/error-utils'

export function ArchivedThreadsSettingsPage() {
  const queryClient = useQueryClient()
  const { workspaces } = useSettingsShellContext()

  const threadQueries = useQueries({
    queries: workspaces.map((workspace) => ({
      queryKey: ['settings-archived-threads', workspace.id],
      queryFn: () => listThreads(workspace.id),
      enabled: Boolean(workspaces.length),
    })),
  })

  const archivedThreads = useMemo(
    () =>
      workspaces
        .flatMap((workspace, index) =>
          (threadQueries[index]?.data ?? [])
            .filter((thread) => thread.archived)
            .map((thread) => ({
              ...thread,
              workspaceName: workspace.name,
            })),
        )
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [threadQueries, workspaces],
  )

  const unarchiveMutation = useMutation({
    mutationFn: ({ workspaceId, threadId }: { workspaceId: string; threadId: string }) =>
      unarchiveThread(workspaceId, threadId),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-archived-threads', variables.workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', variables.workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads', variables.workspaceId] }),
      ])
    },
  })

  const isLoading = threadQueries.some((query) => query.isLoading)
  const firstErrorQuery = threadQueries.find((query) => query.error)?.error
  const firstError = firstErrorQuery ? getErrorMessage(firstErrorQuery) : null

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Review archived threads across all workspaces and restore them without leaving the settings center."
        meta={<span className="meta-pill">{archivedThreads.length} archived</span>}
        title="Archived Threads"
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description="Archived thread inventory across all registered workspaces."
          title="Archive Registry"
        >
          <SettingRow
            description="Use this page to inspect archived work and restore it when it should return to the main thread registry."
            title="Archived Items"
          >
            {isLoading ? <div className="notice">Loading archived threads…</div> : null}
            {firstError ? (
              <InlineNotice
                dismissible
                noticeKey={`archived-load-${firstError}`}
                title="Failed To Load Archived Threads"
                tone="error"
              >
                {firstError}
              </InlineNotice>
            ) : null}
            {!isLoading && !archivedThreads.length ? (
              <div className="empty-state">No archived threads found.</div>
            ) : null}
            <div className="settings-record-list">
              {archivedThreads.map((thread) => (
                <SettingsRecord
                  action={
                    <button
                      className="ide-button ide-button--secondary"
                      onClick={() => unarchiveMutation.mutate({ workspaceId: thread.workspaceId, threadId: thread.id })}
                      type="button"
                    >
                      {unarchiveMutation.isPending ? 'Restoring…' : 'Unarchive'}
                    </button>
                  }
                  description={`${thread.workspaceName} · updated ${formatDateTime(thread.updatedAt)}`}
                  key={thread.id}
                  marker="AR"
                  meta={<span className="meta-pill">{thread.status}</span>}
                  title={thread.name}
                />
              ))}
            </div>
            {unarchiveMutation.error ? (
              <InlineNotice
                dismissible
                noticeKey={`archived-unarchive-${unarchiveMutation.error instanceof Error ? unarchiveMutation.error.message : 'unknown'}`}
                title="Unarchive Failed"
                tone="error"
              >
                {getErrorMessage(unarchiveMutation.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}
