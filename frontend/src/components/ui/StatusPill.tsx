import { i18n } from '../../i18n/runtime'
import type { StatusPillProps } from './statusPillTypes'

export function StatusPill({ status }: StatusPillProps) {
  const tone = status.toLowerCase().replace(/\s+/g, '-')
  const label = formatStatusLabel(status)

  return <span className={`status-pill status-pill--${tone}`}>{label}</span>
}

function formatStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'loading':
      return i18n._({ id: 'Loading', message: 'Loading' })
    case 'idle':
      return i18n._({ id: 'Idle', message: 'Idle' })
    case 'ready':
      return i18n._({ id: 'Ready', message: 'Ready' })
    case 'active':
      return i18n._({ id: 'Active', message: 'Active' })
    case 'connected':
      return i18n._({ id: 'Connected', message: 'Connected' })
    case 'disconnected':
      return i18n._({ id: 'Signed out', message: 'Signed out' })
    case 'requiresopenaiauth':
      return i18n._({ id: 'Authentication required', message: 'Authentication required' })
    case 'submitted':
      return i18n._({ id: 'Submitted', message: 'Submitted' })
    case 'pending':
      return i18n._({ id: 'Pending', message: 'Pending' })
    case 'queued':
      return i18n._({ id: 'Queued', message: 'Queued' })
    case 'restarting':
      return i18n._({ id: 'Restarting', message: 'Restarting' })
    case 'running':
      return i18n._({ id: 'Running', message: 'Running' })
    case 'paused':
      return i18n._({ id: 'Paused', message: 'Paused' })
    case 'failed':
      return i18n._({ id: 'Failed', message: 'Failed' })
    case 'error':
      return i18n._({ id: 'Error', message: 'Error' })
    case 'completed':
      return i18n._({ id: 'Completed', message: 'Completed' })
    case 'cancelled':
      return i18n._({ id: 'Cancelled', message: 'Cancelled' })
    case 'archived':
      return i18n._({ id: 'Archived', message: 'Archived' })
    case 'stopped':
      return i18n._({ id: 'Stopped', message: 'Stopped' })
    case 'unconfigured':
      return i18n._({ id: 'Unconfigured', message: 'Unconfigured' })
    default:
      return status
  }
}
