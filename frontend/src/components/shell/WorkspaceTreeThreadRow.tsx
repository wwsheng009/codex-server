import type { RefObject } from 'react'

import { MoreActionsIcon } from '../ui/RailControls'
import { formatRelativeTimeShort } from '../workspace/timeline-utils'
import { i18n } from '../../i18n/runtime'
import { useSessionStore, type ThreadActivitySummary } from '../../stores/session-store'
import type { Thread } from '../../types/api'

const RUNNING_THREAD_EVENT_METHODS = new Set([
  'turn/started',
  'item/started',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
])
const STOPPED_THREAD_EVENT_METHODS = new Set([
  'turn/completed',
  'thread/closed',
  'thread/archived',
  'thread/unarchived',
])

type WorkspaceTreeThreadRowProps = {
  activeThreadId?: string
  deleteInProgress: boolean
  isMenuOpen: boolean
  isRenameOrDeletePending: boolean
  isSelectedWorkspaceRoute: boolean
  menuRef?: RefObject<HTMLDivElement | null>
  onDeleteThread: () => void
  onOpenThread: () => void
  onRenameThread: () => void
  onToggleMenu: () => void
  thread: Thread
}

export function WorkspaceTreeThreadRow({
  activeThreadId,
  deleteInProgress,
  isMenuOpen,
  isRenameOrDeletePending,
  isSelectedWorkspaceRoute,
  menuRef,
  onDeleteThread,
  onOpenThread,
  onRenameThread,
  onToggleMenu,
  thread,
}: WorkspaceTreeThreadRowProps) {
  const activity = useSessionStore((state) => state.threadActivityByThread[thread.id])
  const running = threadIsRunning(thread, activity)
  const activityTs = activity?.latestEventTs || thread.updatedAt
  const activityTone = running
    ? isSelectedWorkspaceRoute && activeThreadId === thread.id
      ? 'foreground'
      : 'background'
    : null

  return (
    <div
      className={
        activeThreadId === thread.id
          ? 'workspace-tree__thread-row workspace-tree__thread-row--active'
          : 'workspace-tree__thread-row'
      }
    >
      <button
        className={
          activeThreadId === thread.id
            ? 'workspace-tree__thread workspace-tree__thread--active'
            : 'workspace-tree__thread'
        }
        onClick={onOpenThread}
        title={thread.name}
        type="button"
      >
        <span className="workspace-tree__thread-time">{formatRelativeTimeShort(activityTs)}</span>
        <span className="workspace-tree__thread-title-shell">
          {activityTone ? (
            <span
              aria-hidden="true"
              className={
                activityTone === 'foreground'
                  ? 'workspace-tree__thread-activity workspace-tree__thread-activity--foreground'
                  : 'workspace-tree__thread-activity workspace-tree__thread-activity--background'
              }
            />
          ) : null}
          <span className="workspace-tree__thread-title">{thread.name}</span>
        </span>
      </button>
      <div
        className={
          isMenuOpen
            ? 'workspace-tree__thread-actions workspace-tree__thread-actions--visible'
            : 'workspace-tree__thread-actions'
        }
        ref={isMenuOpen ? menuRef : undefined}
      >
        <button
          aria-expanded={isMenuOpen}
          aria-label={i18n._({
            id: 'Open actions for {name}',
            message: 'Open actions for {name}',
            values: { name: thread.name },
          })}
          className={
            isMenuOpen
              ? 'workspace-tree__menu-trigger workspace-tree__menu-trigger--active'
              : 'workspace-tree__menu-trigger'
          }
          onClick={(event) => {
            event.stopPropagation()
            onToggleMenu()
          }}
          type="button"
        >
          <MoreActionsIcon />
        </button>
        {isMenuOpen ? (
          <div className="workspace-tree__menu" role="menu">
            <button
              className="workspace-tree__menu-item"
              disabled={isRenameOrDeletePending}
              onClick={onRenameThread}
              type="button"
            >
              {i18n._({ id: 'Rename', message: 'Rename' })}
            </button>
            <button
              className="workspace-tree__menu-item workspace-tree__menu-item--danger"
              disabled={isRenameOrDeletePending}
              onClick={onDeleteThread}
              type="button"
            >
              {deleteInProgress
                ? i18n._({ id: 'Deleting…', message: 'Deleting…' })
                : i18n._({ id: 'Delete', message: 'Delete' })}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function threadIsRunning(thread: Thread, activity?: ThreadActivitySummary) {
  if (activity) {
    if (statusIsInterruptible(activity.latestStatus)) {
      return true
    }

    if (STOPPED_THREAD_EVENT_METHODS.has(activity.latestEventMethod)) {
      return false
    }

    if (RUNNING_THREAD_EVENT_METHODS.has(activity.latestEventMethod)) {
      return true
    }
  }

  return statusIsInterruptible(thread.status)
}

function statusIsInterruptible(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  return ['running', 'processing', 'sending', 'waiting', 'inprogress', 'started'].includes(
    normalized,
  )
}
