import { MoreActionsIcon } from '../ui/RailControls'
import { formatRelativeTimeShort } from '../workspace/timeline-utils'
import { formatLocalizedStatusLabel } from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import { useSessionStore } from '../../stores/session-store'
import type { ThreadActivitySummary } from '../../stores/session-store-types'
import type { Thread } from '../../types/api'
import type { WorkspaceTreeThreadRowProps } from './workspaceTreeThreadRowTypes'

const RUNNING_THREAD_EVENT_METHODS = new Set([
  'turn/started',
  'item/started',
  'turn/plan/updated',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
])
const STREAMING_THREAD_STATUSES = new Set(['streaming', 'responding'])
const APPROVAL_THREAD_STATUSES = new Set(['reviewing'])
const WAITING_THREAD_STATUSES = new Set(['waiting', 'pending'])
const PROCESSING_THREAD_STATUSES = new Set([
  'running',
  'processing',
  'inprogress',
  'started',
  'starting',
])
const SENDING_THREAD_STATUSES = new Set(['sending'])
const SUCCESS_THREAD_STATUSES = new Set(['completed', 'success', 'resolved'])
const ERROR_THREAD_STATUSES = new Set([
  'failed',
  'error',
  'systemerror',
  'denied',
  'rejected',
  'expired',
  'cancelled',
  'canceled',
  'stopped',
  'interrupted',
])

type ThreadIndicatorKind =
  | 'approval'
  | 'archived'
  | 'error'
  | 'idle'
  | 'processing'
  | 'sending'
  | 'streaming'
  | 'success'
  | 'waiting'

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
  const threadIndicator = resolveThreadIndicator(thread, activity)
  const running =
    threadIndicator.kind === 'approval' ||
    threadIndicator.kind === 'streaming' ||
    threadIndicator.kind === 'processing' ||
    threadIndicator.kind === 'sending' ||
    threadIndicator.kind === 'waiting'
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
        <span className="workspace-tree__thread-time-meta">
          <span className="workspace-tree__thread-time">{formatRelativeTimeShort(activityTs)}</span>
          <span className="workspace-tree__thread-status-text">{threadIndicator.label}</span>
        </span>
        <span className="workspace-tree__thread-title-shell">
          <span
            aria-hidden="true"
            className={
              activityTone === 'foreground'
                ? `workspace-tree__thread-status-icon workspace-tree__thread-status-icon--${threadIndicator.kind} workspace-tree__thread-status-icon--foreground`
                : activityTone === 'background'
                  ? `workspace-tree__thread-status-icon workspace-tree__thread-status-icon--${threadIndicator.kind} workspace-tree__thread-status-icon--background`
                  : `workspace-tree__thread-status-icon workspace-tree__thread-status-icon--${threadIndicator.kind}`
            }
            title={threadIndicator.label}
          >
            <ThreadStatusIcon kind={threadIndicator.kind} />
          </span>
          <span className="workspace-tree__thread-title" dir="auto">
            {thread.name}
          </span>
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

function normalizeThreadStatusValue(value?: string) {
  return (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
}

function resolveThreadIndicator(thread: Thread, activity?: ThreadActivitySummary) {
  const normalizedStatus = normalizeThreadStatusValue(activity?.latestStatus || thread.status)
  let kind: ThreadIndicatorKind

  if (thread.archived || normalizedStatus === 'archived') {
    kind = 'archived'
  } else if (STREAMING_THREAD_STATUSES.has(normalizedStatus)) {
    kind = 'streaming'
  } else if (APPROVAL_THREAD_STATUSES.has(normalizedStatus)) {
    kind = 'approval'
  } else if (SENDING_THREAD_STATUSES.has(normalizedStatus)) {
    kind = 'sending'
  } else if (WAITING_THREAD_STATUSES.has(normalizedStatus)) {
    kind = 'waiting'
  } else if (PROCESSING_THREAD_STATUSES.has(normalizedStatus)) {
    kind = 'processing'
  } else if (SUCCESS_THREAD_STATUSES.has(normalizedStatus)) {
    kind = 'success'
  } else if (ERROR_THREAD_STATUSES.has(normalizedStatus)) {
    kind = 'error'
  } else if (activity && RUNNING_THREAD_EVENT_METHODS.has(activity.latestEventMethod)) {
    kind = 'processing'
  } else {
    kind = 'idle'
  }

  return {
    kind,
    label: labelForThreadIndicatorKind(kind),
  }
}

function labelForThreadIndicatorKind(kind: ThreadIndicatorKind) {
  switch (kind) {
    case 'approval':
      return i18n._({ id: 'Awaiting approval', message: 'Awaiting approval' })
    case 'streaming':
      return i18n._({ id: 'Streaming', message: 'Streaming' })
    case 'sending':
      return i18n._({ id: 'Sending', message: 'Sending' })
    case 'waiting':
      return i18n._({ id: 'Waiting', message: 'Waiting' })
    case 'processing':
      return i18n._({ id: 'Processing', message: 'Processing' })
    case 'success':
      return i18n._({ id: 'Completed', message: 'Completed' })
    case 'error':
      return i18n._({ id: 'Error', message: 'Error' })
    case 'archived':
      return i18n._({ id: 'Archived', message: 'Archived' })
    case 'idle':
    default:
      return formatLocalizedStatusLabel('idle')
  }
}

function ThreadStatusIcon({ kind }: { kind: ThreadIndicatorKind }) {
  switch (kind) {
    case 'approval':
    case 'streaming':
    case 'processing':
    case 'sending':
    case 'waiting':
      return <ActiveThreadDotIcon />
    case 'success':
      return (
        <svg fill="none" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="5.3" stroke="currentColor" strokeWidth="1.3" />
          <path d="m5.4 8.2 1.8 1.8 3.5-3.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </svg>
      )
    case 'error':
      return (
        <svg fill="none" viewBox="0 0 16 16">
          <path d="M8 2.2 13.2 12H2.8L8 2.2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" />
          <path d="M8 5.7v2.8M8 10.8h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
        </svg>
      )
    case 'archived':
      return (
        <svg fill="none" viewBox="0 0 16 16">
          <rect height="8.8" rx="1.8" stroke="currentColor" strokeWidth="1.3" width="10.8" x="2.6" y="3.4" />
          <path d="M5.3 6.2h5.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
        </svg>
      )
    case 'idle':
    default:
      return (
        <svg fill="none" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="8" fill="currentColor" r="1.1" />
        </svg>
      )
  }
}

function ActiveThreadDotIcon() {
  return (
    <svg fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" fill="currentColor" r="3.1" />
      <circle cx="8" cy="8" opacity="0.35" r="5.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
