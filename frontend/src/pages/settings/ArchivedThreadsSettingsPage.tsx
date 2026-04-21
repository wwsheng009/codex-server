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
import { formatLocalizedDateTime, formatLocalizedStatusLabel } from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'
import type { UnarchiveThreadMutationInput } from './archivedThreadsSettingsPageTypes'

const EMPTY_THREAD_LIST: Awaited<ReturnType<typeof listThreads>> = []

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
          (threadQueries[index]?.data ?? EMPTY_THREAD_LIST)
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
    mutationFn: ({ workspaceId, threadId }: UnarchiveThreadMutationInput) =>
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
        description={i18n._({
          id: 'Review archived threads across all workspaces and restore them without leaving the settings center.',
          message:
            'Review archived threads across all workspaces and restore them without leaving the settings center.',
        })}
        meta={
          <span className="meta-pill">
            {i18n._({
              id: '{count} archived',
              message: '{count} archived',
              values: { count: archivedThreads.length },
            })}
          </span>
        }
        title={i18n._({ id: 'Archived Threads', message: 'Archived Threads' })}
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description={i18n._({
            id: 'Archived thread inventory across all registered workspaces.',
            message: 'Archived thread inventory across all registered workspaces.',
          })}
          title={i18n._({ id: 'Archive Registry', message: 'Archive Registry' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Use this page to inspect archived work and restore it when it should return to the main thread registry.',
              message:
                'Use this page to inspect archived work and restore it when it should return to the main thread registry.',
            })}
            title={i18n._({ id: 'Archived Items', message: 'Archived Items' })}
          >
            {isLoading ? (
              <div className="notice">
                {i18n._({
                  id: 'Loading archived threads…',
                  message: 'Loading archived threads…',
                })}
              </div>
            ) : null}
            {firstError ? (
              <InlineNotice
                dismissible
                noticeKey={`archived-load-${firstError}`}
                title={i18n._({
                  id: 'Failed To Load Archived Threads',
                  message: 'Failed To Load Archived Threads',
                })}
                tone="error"
              >
                {firstError}
              </InlineNotice>
            ) : null}
            {!isLoading && !archivedThreads.length ? (
              <div className="empty-state">
                {i18n._({
                  id: 'No archived threads found.',
                  message: 'No archived threads found.',
                })}
              </div>
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
                      {unarchiveMutation.isPending
                        ? i18n._({ id: 'Restoring…', message: 'Restoring…' })
                        : i18n._({ id: 'Unarchive', message: 'Unarchive' })}
                    </button>
                  }
                  description={i18n._({
                    id: '{workspace} · updated {time}',
                    message: '{workspace} · updated {time}',
                    values: {
                      workspace: thread.workspaceName,
                      time: formatLocalizedDateTime(thread.updatedAt),
                    },
                  })}
                  key={thread.id}
                  marker="AR"
                  meta={<span className="meta-pill">{formatLocalizedStatusLabel(thread.status)}</span>}
                  title={thread.name}
                />
              ))}
            </div>
            {unarchiveMutation.error ? (
              <InlineNotice
                dismissible
                noticeKey={`archived-unarchive-${unarchiveMutation.error instanceof Error ? unarchiveMutation.error.message : 'unknown'}`}
                title={i18n._({ id: 'Unarchive Failed', message: 'Unarchive Failed' })}
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
