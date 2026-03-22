import { i18n } from '../../i18n/runtime'

type StatusPillProps = {
  status: string
}

export function StatusPill({ status }: StatusPillProps) {
  const tone = status.toLowerCase().replace(/\s+/g, '-')
  const label = formatStatusLabel(status)

  return <span className={`status-pill status-pill--${tone}`}>{label}</span>
}

function formatStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'ready':
      return i18n._({ id: 'Ready', message: 'Ready' })
    case 'active':
      return i18n._({ id: 'Active', message: 'Active' })
    case 'connected':
      return i18n._({ id: 'Connected', message: 'Connected' })
    case 'queued':
      return i18n._({ id: 'Queued', message: 'Queued' })
    case 'running':
      return i18n._({ id: 'Running', message: 'Running' })
    case 'paused':
      return i18n._({ id: 'Paused', message: 'Paused' })
    case 'failed':
      return i18n._({ id: 'Failed', message: 'Failed' })
    case 'completed':
      return i18n._({ id: 'Completed', message: 'Completed' })
    case 'cancelled':
      return i18n._({ id: 'Cancelled', message: 'Cancelled' })
    case 'archived':
      return i18n._({ id: 'Archived', message: 'Archived' })
    default:
      return status
  }
}
