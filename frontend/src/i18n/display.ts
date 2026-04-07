import { formatLocaleDateTime, formatLocaleNumber, formatLocaleTime } from './format'
import { i18n } from './runtime'

type DisplayDateInput = string | number | Date | null | undefined

function trimDisplayValue(value?: string | number | Date | null) {
  return String(value ?? '').trim()
}

function normalizeDisplayValue(value?: string | null) {
  return trimDisplayValue(value).toLowerCase().replace(/[\s_-]+/g, '')
}

export function humanizeDisplayValue(
  value?: string | null,
  fallback = i18n._({ id: 'Unknown', message: 'Unknown' }),
) {
  const raw = trimDisplayValue(value)
  if (!raw) {
    return fallback
  }

  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function formatLocalizedStatusLabel(
  value?: string | null,
  fallback = i18n._({ id: 'Unknown', message: 'Unknown' }),
) {
  switch (normalizeDisplayValue(value)) {
    case '':
      return fallback
    case 'loading':
      return i18n._({ id: 'Loading', message: 'Loading' })
    case 'idle':
      return i18n._({ id: 'Idle', message: 'Idle' })
    case 'ready':
      return i18n._({ id: 'Ready', message: 'Ready' })
    case 'active':
      return i18n._({ id: 'Active', message: 'Active' })
    case 'success':
      return i18n._({ id: 'Success', message: 'Success' })
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
    case 'info':
      return i18n._({ id: 'Info', message: 'Info' })
    case 'warning':
      return i18n._({ id: 'Warning', message: 'Warning' })
    case 'restarting':
      return i18n._({ id: 'Restarting', message: 'Restarting' })
    case 'restarted':
      return i18n._({ id: 'Restarted', message: 'Restarted' })
    case 'restartrequired':
      return i18n._({ id: 'Restart Required', message: 'Restart Required' })
    case 'running':
      return i18n._({ id: 'Running', message: 'Running' })
    case 'connecting':
      return i18n._({ id: 'Connecting', message: 'Connecting' })
    case 'loaded':
      return i18n._({ id: 'Loaded', message: 'Loaded' })
    case 'initial':
      return i18n._({ id: 'initial', message: 'initial' })
    case 'inprogress':
      return i18n._({ id: 'In progress', message: 'In progress' })
    case 'processing':
      return i18n._({ id: 'Processing', message: 'Processing' })
    case 'sending':
      return i18n._({ id: 'Sending', message: 'Sending' })
    case 'waiting':
      return i18n._({ id: 'Waiting', message: 'Waiting' })
    case 'starting':
      return i18n._({ id: 'Starting', message: 'Starting' })
    case 'streaming':
      return i18n._({ id: 'Streaming', message: 'Streaming' })
    case 'paused':
      return i18n._({ id: 'Paused', message: 'Paused' })
    case 'closed':
      return i18n._({ id: 'Closed', message: 'Closed' })
    case 'failed':
      return i18n._({ id: 'Failed', message: 'Failed' })
    case 'error':
    case 'systemerror':
      return i18n._({ id: 'Error', message: 'Error' })
    case 'completed':
      return i18n._({ id: 'Completed', message: 'Completed' })
    case 'cancelled':
    case 'canceled':
      return i18n._({ id: 'Cancelled', message: 'Cancelled' })
    case 'archived':
      return i18n._({ id: 'Archived', message: 'Archived' })
    case 'stopped':
    case 'interrupted':
      return i18n._({ id: 'Stopped', message: 'Stopped' })
    case 'unconfigured':
      return i18n._({ id: 'Unconfigured', message: 'Unconfigured' })
    case 'open':
      return i18n._({ id: 'Open', message: 'Open' })
    case 'resolved':
      return i18n._({ id: 'Resolved', message: 'Resolved' })
    case 'reviewing':
      return i18n._({ id: 'Awaiting approval', message: 'Awaiting approval' })
    case 'notloaded':
      return i18n._({ id: 'Not loaded', message: 'Not loaded' })
    case 'nottracked':
      return i18n._({ id: 'Not tracked', message: 'Not tracked' })
    case 'unknown':
      return i18n._({ id: 'Unknown', message: 'Unknown' })
    case 'rejected':
      return i18n._({ id: 'Rejected', message: 'Rejected' })
    case 'denied':
      return i18n._({ id: 'Denied', message: 'Denied' })
    case 'expired':
      return i18n._({ id: 'Expired', message: 'Expired' })
    case 'confirmed':
      return i18n._({ id: 'Confirmed', message: 'Confirmed' })
    case 'debug':
      return i18n._({ id: 'Debug', message: 'Debug' })
    case 'normal':
      return i18n._({ id: 'Normal', message: 'Normal' })
    case 'wait':
      return i18n._({ id: 'Waiting for scan', message: 'Waiting for scan' })
    case 'scaned':
    case 'scanned':
      return i18n._({ id: 'Scanned', message: 'Scanned' })
    default:
      return humanizeDisplayValue(value, fallback)
  }
}

export function formatStreamStateLabel(
  value?: string | null,
  fallback = i18n._({ id: 'Not connected', message: 'Not connected' }),
) {
  switch (normalizeDisplayValue(value)) {
    case 'open':
      return i18n._({ id: 'Live', message: 'Live' })
    case 'connecting':
      return i18n._({ id: 'Connecting', message: 'Connecting' })
    case 'closed':
      return i18n._({ id: 'Disconnected', message: 'Disconnected' })
    case 'error':
      return i18n._({ id: 'Connection error', message: 'Connection error' })
    default:
      return trimDisplayValue(value) ? formatLocalizedStatusLabel(value, fallback) : fallback
  }
}

export function formatResponseToneLabel(
  value?: string | null,
  fallback = i18n._({ id: 'Balanced', message: 'Balanced' }),
) {
  switch (normalizeDisplayValue(value)) {
    case 'balanced':
      return i18n._({ id: 'Balanced', message: 'Balanced' })
    case 'direct':
      return i18n._({ id: 'Direct', message: 'Direct' })
    case 'detailed':
      return i18n._({ id: 'Detailed', message: 'Detailed' })
    default:
      return trimDisplayValue(value) ? humanizeDisplayValue(value, fallback) : fallback
  }
}

export function formatShellEnvironmentInheritLabel(value?: string | null, fallback = '-') {
  switch (trimDisplayValue(value).toLowerCase()) {
    case 'all':
      return i18n._({ id: 'All', message: 'All' })
    case 'core':
      return i18n._({ id: 'Core', message: 'Core' })
    case 'none':
      return i18n._({ id: 'None', message: 'None' })
    case 'not-explicit':
      return i18n._({ id: 'Not explicit', message: 'Not explicit' })
    case 'inherit':
      return i18n._({ id: 'Inherit', message: 'Inherit' })
    default:
      return trimDisplayValue(value) || fallback
  }
}

export function formatWindowsCommandResolutionLabel(value?: string | null, fallback = '-') {
  switch (trimDisplayValue(value).toLowerCase()) {
    case 'at-risk':
      return i18n._({ id: 'At risk', message: 'At risk' })
    case 'patched':
      return i18n._({ id: 'Patched', message: 'Patched' })
    case 'normal':
      return i18n._({ id: 'Normal', message: 'Normal' })
    case 'unknown':
      return i18n._({ id: 'Unknown', message: 'Unknown' })
    default:
      return trimDisplayValue(value) || fallback
  }
}

function parseDisplayDate(value: DisplayDateInput) {
  if (value instanceof Date) {
    return new Date(value.getTime())
  }

  if (typeof value === 'number') {
    return new Date(value)
  }

  const raw = trimDisplayValue(value)
  if (!raw) {
    return null
  }

  return new Date(raw)
}

export function formatLocalizedDateTime(value: DisplayDateInput, fallback = '-') {
  const parsed = parseDisplayDate(value)
  if (!parsed) {
    return fallback
  }

  if (Number.isNaN(parsed.getTime())) {
    return trimDisplayValue(value)
  }

  return formatLocaleDateTime(parsed.toISOString())
}

export function formatLocalizedTime(value: DisplayDateInput, fallback = '-') {
  const parsed = parseDisplayDate(value)
  if (!parsed) {
    return fallback
  }

  if (Number.isNaN(parsed.getTime())) {
    return trimDisplayValue(value)
  }

  return formatLocaleTime(parsed.toISOString())
}

export function formatLocalizedNumber(value?: number | null, fallback = '-') {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return formatLocaleNumber(value)
}
