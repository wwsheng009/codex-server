import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { formatLocalizedStatusLabel, formatStreamStateLabel } from '../../i18n/display'
import { formatLocaleNumber, formatLocaleTime } from '../../i18n/format'
import { i18n } from '../../i18n/runtime'
import {
  ContextIcon,
  FeedIcon,
  FolderClosedIcon,
  RefreshIcon,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
  ToolsIcon,
} from '../../components/ui/RailControls'
import type { RateLimit } from '../../types/api'
import type {
  BuildComposerAutocompleteSectionsInput,
  BuildComposerStatusInfoInput,
  BuildSyncStatusDisplayInput,
  ComposerAutocompleteItem,
  ComposerAutocompleteSection,
  ComposerCommandDefinition,
  ComposerCollaborationMode,
  ComposerOptionGlyphProps,
  ComposerPermissionPreset,
  ComposerPreferences,
  ComposerReasoningEffort,
  ComposerReviewShortcutDefinition,
  ComposerStatusDetailRow,
  ComposerStatusIndicatorProps,
  ComposerStatusInfo,
  ContextUsageIndicatorProps,
  NormalizedMcpServerState,
} from './threadPageComposerSharedTypes'
export type {
  BuildComposerAutocompleteSectionsInput,
  BuildComposerStatusInfoInput,
  BuildSyncStatusDisplayInput,
  ComposerAssistPanel,
  ComposerAutocompleteFileEntry,
  ComposerAutocompleteItem,
  ComposerAutocompleteSection,
  ComposerCommandAction,
  ComposerCommandDefinition,
  ComposerCommandId,
  ComposerCommandMenu,
  ComposerCollaborationMode,
  ComposerMcpPanelProps,
  ComposerOptionGlyphProps,
  ComposerOptionIcon,
  ComposerPermissionPreset,
  ComposerPersonalizationPanelProps,
  ComposerPreferences,
  ComposerReasoningEffort,
  ComposerStatusDetailRow,
  ComposerStatusIndicatorProps,
  ComposerStatusInfo,
  ComposerStatusTone,
  ComposerStatusPanelProps,
  ComposerWorktreePanelProps,
  ContextCompactionFeedback,
  ContextUsageIndicatorProps,
  ModelOption,
  NormalizedMcpServerState,
} from './threadPageComposerSharedTypes'

const COMPOSER_PREFERENCES_STORAGE_PREFIX = 'codex-server:composer-preferences:'

export const FALLBACK_MODEL_OPTIONS = ['gpt-5.4', 'gpt-5.3-codex']

export const DEFAULT_COMPOSER_PREFERENCES: ComposerPreferences = {
  permissionPreset: 'default',
  model: '',
  reasoningEffort: 'medium',
  collaborationMode: 'default',
}

function getFeedbackPrompt() {
  return i18n._({
    id: 'Please help me draft a product feedback report with a summary, reproduction steps, expected result, actual result, and impact scope:',
    message:
      'Please help me draft a product feedback report with a summary, reproduction steps, expected result, actual result, and impact scope:',
  })
}

function getReviewShortcuts(): ComposerReviewShortcutDefinition[] {
  return [
    {
      id: 'review-base',
      title: i18n._({
        id: 'Review against base branch',
        message: 'Review against base branch',
      }),
      description: i18n._({
        id: 'Review the current branch diff relative to the base branch.',
        message: 'Review the current branch diff relative to the base branch.',
      }),
      prompt: i18n._({
        id: 'Please review the code changes against the current base branch, prioritizing bugs, regressions, risks, and missing tests.',
        message:
          'Please review the code changes against the current base branch, prioritizing bugs, regressions, risks, and missing tests.',
      }),
    },
    {
      id: 'review-uncommitted',
      title: i18n._({
        id: 'Review uncommitted changes',
        message: 'Review uncommitted changes',
      }),
      description: i18n._({
        id: 'Review local modifications in the current workspace that have not been committed yet.',
        message: 'Review local modifications in the current workspace that have not been committed yet.',
      }),
      prompt: i18n._({
        id: 'Please review the current uncommitted local changes, prioritizing bugs, regressions, risks, and missing tests.',
        message:
          'Please review the current uncommitted local changes, prioritizing bugs, regressions, risks, and missing tests.',
      }),
    },
  ]
}

export function buildComposerCommandDefinitions(
  collaborationMode: ComposerCollaborationMode,
): ComposerCommandDefinition[] {
  return [
    {
      id: 'mcp',
      title: 'MCP',
      description: i18n._({
        id: 'Show MCP server status',
        message: 'Show MCP server status',
      }),
      keywords: ['mcp', 'server', 'oauth', 'status'],
      icon: 'mcp',
      action: { kind: 'panel', panel: 'mcp' },
    },
    {
      id: 'personalization',
      title: i18n._({
        id: 'Personalization',
        message: 'Personalization',
      }),
      description: i18n._({
        id: 'Inspect local response preferences and custom instructions',
        message: 'Inspect local response preferences and custom instructions',
      }),
      keywords: ['personalization', 'preferences', 'tone', 'instructions'],
      icon: 'personalization',
      action: { kind: 'panel', panel: 'personalization' },
    },
    {
      id: 'review',
      title: i18n._({
        id: 'Code Review',
        message: 'Code Review',
      }),
      description: i18n._({
        id: 'Open review shortcuts',
        message: 'Open review shortcuts',
      }),
      keywords: ['review', 'code review'],
      icon: 'review',
      action: { kind: 'submenu', menu: 'review' },
    },
    {
      id: 'feedback',
      title: i18n._({
        id: 'Feedback',
        message: 'Feedback',
      }),
      description: i18n._({
        id: 'Insert a product feedback prompt',
        message: 'Insert a product feedback prompt',
      }),
      keywords: ['feedback', 'bug report'],
      icon: 'feedback',
      action: { kind: 'prompt', prompt: getFeedbackPrompt() },
    },
    {
      id: 'worktree',
      title: i18n._({
        id: 'Worktree',
        message: 'Worktree',
      }),
      description: i18n._({
        id: 'Inspect current worktree policy and settings entry points',
        message: 'Inspect current worktree policy and settings entry points',
      }),
      keywords: ['worktree', 'branch'],
      icon: 'worktree',
      action: { kind: 'panel', panel: 'worktree' },
    },
    {
      id: 'status',
      title: i18n._({
        id: 'Status',
        message: 'Status',
      }),
      description: i18n._({
        id: 'Show thread ID, context usage, and quota status',
        message: 'Show thread ID, context usage, and quota status',
      }),
      keywords: ['status', 'quota', 'context', 'thread'],
      icon: 'status',
      action: { kind: 'panel', panel: 'status' },
    },
    {
      id: 'plan',
      title: i18n._({
        id: 'Plan Mode',
        message: 'Plan Mode',
      }),
      description:
        collaborationMode === 'plan'
          ? i18n._({
              id: 'Turn off plan mode',
              message: 'Turn off plan mode',
            })
          : i18n._({
              id: 'Turn on plan mode',
              message: 'Turn on plan mode',
            }),
      keywords: ['plan', 'planning', 'plan mode'],
      icon: 'plan',
      action: { kind: 'toggle-plan' },
    },
  ]
}

export function normalizePermissionPreset(value: string): ComposerPermissionPreset {
  return value === 'full-access' ? 'full-access' : 'default'
}

export function normalizeReasoningEffort(value: string): ComposerReasoningEffort {
  switch (value) {
    case 'low':
    case 'high':
    case 'xhigh':
      return value
    default:
      return 'medium'
  }
}

export function normalizeCollaborationMode(value: string): ComposerCollaborationMode {
  return value === 'plan' ? 'plan' : 'default'
}

export function readComposerPreferences(workspaceId: string): ComposerPreferences {
  if (!workspaceId || typeof window === 'undefined') {
    return DEFAULT_COMPOSER_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(`${COMPOSER_PREFERENCES_STORAGE_PREFIX}${workspaceId}`)
    if (!raw) {
      return DEFAULT_COMPOSER_PREFERENCES
    }

    const parsed = JSON.parse(raw) as Partial<ComposerPreferences>
    return {
      permissionPreset: normalizePermissionPreset(String(parsed.permissionPreset ?? 'default')),
      model: typeof parsed.model === 'string' ? parsed.model : '',
      reasoningEffort: normalizeReasoningEffort(String(parsed.reasoningEffort ?? 'medium')),
      collaborationMode: normalizeCollaborationMode(String(parsed.collaborationMode ?? 'default')),
    }
  } catch {
    return DEFAULT_COMPOSER_PREFERENCES
  }
}

export function writeComposerPreferences(workspaceId: string, preferences: ComposerPreferences) {
  if (!workspaceId || typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      `${COMPOSER_PREFERENCES_STORAGE_PREFIX}${workspaceId}`,
      JSON.stringify(preferences),
    )
  } catch {
    // Ignore browser storage failures.
  }
}

function matchesComposerQuery(query: string, values: string[]) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return true
  }

  return values.some((value) => value.toLowerCase().includes(normalizedQuery))
}

export function buildComposerAutocompleteSections(input: BuildComposerAutocompleteSectionsInput) {
  const { commands, commandMenu, files, mode, query, skills } = input
  const sections: ComposerAutocompleteSection[] = []
  const reviewShortcuts = getReviewShortcuts()
  const searchLabel = i18n._({
    id: 'Search',
    message: 'Search',
  })
  const skillsLabel = i18n._({
    id: 'Skills',
    message: 'Skills',
  })
  const filesLabel = i18n._({
    id: 'Files',
    message: 'Files',
  })

  if (mode === 'command' && commandMenu === 'review') {
    const items = reviewShortcuts.filter((shortcut) =>
      matchesComposerQuery(query, [shortcut.title, shortcut.description, shortcut.prompt]),
    ).map<ComposerAutocompleteItem>((shortcut) => ({
      kind: 'review',
      id: shortcut.id,
      title: shortcut.title,
      description: shortcut.description,
      icon: 'review',
      prompt: shortcut.prompt,
      section: 'commands',
    }))

    sections.push({ id: 'commands', label: searchLabel, items })
    return sections
  }

  if (mode === 'command') {
    const commandItems = commands
      .filter((command) =>
        matchesComposerQuery(query, [command.title, command.description, ...command.keywords]),
      )
      .map<ComposerAutocompleteItem>((command) => ({
        kind: 'command',
        id: command.id,
        title: command.title,
        description: command.description,
        icon: command.icon,
        action: command.action,
        section: 'commands',
      }))

    if (commandItems.length) {
      sections.push({ id: 'commands', label: searchLabel, items: commandItems })
    }
  }

  const skillItems = skills
    .filter((skill) => matchesComposerQuery(query, [skill.name, skill.description]))
    .slice(0, 6)
    .map<ComposerAutocompleteItem>((skill) => ({
      kind: 'skill',
      id: skill.id,
      title: skill.name,
      description:
        skill.description ||
        i18n._({
          id: 'Insert this skill token into the composer',
          message: 'Insert this skill token into the composer',
        }),
      meta: skill.id,
      icon: 'skill',
      insertion: `$${skill.name} `,
      section: 'skills',
    }))

  if (skillItems.length && (mode === 'command' || mode === 'skill')) {
    sections.push({ id: 'skills', label: skillsLabel, items: skillItems })
  }

  if (mode === 'mention') {
    const fileItems = files.map<ComposerAutocompleteItem>((file) => ({
      kind: 'file',
      id: file.path,
      title: file.name,
      description: file.directory || file.path,
      meta: file.path,
      icon: 'file',
      insertion: `@${file.path} `,
      section: 'files',
    }))

    if (fileItems.length) {
      sections.push({ id: 'files', label: filesLabel, items: fileItems })
    }
  }

  return sections
}

export function composerSectionLabel(id: ComposerAutocompleteItem['section']) {
  switch (id) {
    case 'files':
      return i18n._({
        id: 'Files',
        message: 'Files',
      })
    case 'skills':
      return i18n._({
        id: 'Skills',
        message: 'Skills',
      })
    default:
      return i18n._({
        id: 'Search',
        message: 'Search',
      })
  }
}

function stringRecordField(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberRecordField(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (normalized !== '') {
      const parsed = Number(normalized)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

function booleanRecordField(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function objectRecordField(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function formatRateLimitPercent(value: number | null) {
  if (value === null) {
    return i18n._({
      id: 'Usage unavailable',
      message: 'Usage unavailable',
    })
  }

  const roundedValue = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : Math.round(value * 10) / 10

  return i18n._({
    id: '{percent}% used',
    message: '{percent}% used',
    values: {
      percent: formatLocaleNumber(roundedValue),
    },
  })
}

export function formatShortTime(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return i18n._({
      id: 'Unknown',
      message: 'Unknown',
    })
  }

  return formatLocaleTime(new Date(timestamp).toISOString())
}

export function truncateInlineText(value: string, maxLength = 120) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`
}

export type RateLimitWindowSummary = {
  key: string
  label: string
  usedPercent: number | null
  resetsAt: string | null
  windowDurationMins: number | null
}

export type RateLimitSummary = {
  key: string
  title: string
  subtitle: string
  windows: RateLimitWindowSummary[]
  creditsSummary: string | null
  planType: string | null
  nextResetAt: string | null
}

function getRateLimitRecord(limit: RateLimit) {
  return limit as unknown as Record<string, unknown>
}

export function getRateLimitDisplayName(limit: RateLimit) {
  const record = getRateLimitRecord(limit)

  return (
    stringRecordField(record.limitName) ||
    stringRecordField(record.name) ||
    stringRecordField(record.limitId) ||
    i18n._({
      id: 'Rate limit',
      message: 'Rate limit',
    })
  )
}

function getRateLimitPrimaryFallbackWindow(limit: RateLimit): RateLimitWindowSummary | null {
  const record = getRateLimitRecord(limit)
  const limitValue = numberRecordField(record.limit)
  const remainingValue = numberRecordField(record.remaining)
  const resetsAt = stringRecordField(record.resetsAt) || null

  if (limitValue === null && remainingValue === null && !resetsAt) {
    return null
  }

  let usedPercent: number | null = null
  if (limitValue !== null && limitValue > 0 && remainingValue !== null) {
    usedPercent = ((limitValue - remainingValue) / limitValue) * 100
  }

  return {
    key: 'legacy',
    label: i18n._({
      id: 'Usage',
      message: 'Usage',
    }),
    usedPercent,
    resetsAt,
    windowDurationMins: null,
  }
}

function getRateLimitWindow(limit: RateLimit, windowKey: 'primary' | 'secondary'): RateLimitWindowSummary | null {
  const record = getRateLimitRecord(limit)
  const windowRecord = objectRecordField(record[windowKey])
  if (!windowRecord) {
    return null
  }

  const usedPercent = numberRecordField(windowRecord.usedPercent)
  const resetsAt = stringRecordField(windowRecord.resetsAt) || null
  const windowDurationMins = numberRecordField(windowRecord.windowDurationMins)
  if (usedPercent === null && !resetsAt && windowDurationMins === null) {
    return null
  }

  return {
    key: windowKey,
    label:
      windowKey === 'primary'
        ? i18n._({
            id: 'Primary',
            message: 'Primary',
          })
        : i18n._({
            id: 'Secondary',
            message: 'Secondary',
          }),
    usedPercent,
    resetsAt,
    windowDurationMins,
  }
}

export function getRateLimitWindows(limit: RateLimit): RateLimitWindowSummary[] {
  const primaryWindow = getRateLimitWindow(limit, 'primary')
  const secondaryWindow = getRateLimitWindow(limit, 'secondary')
  const windows = [primaryWindow, secondaryWindow].filter((window): window is RateLimitWindowSummary => window !== null)
  if (windows.length > 0) {
    return windows
  }

  const legacyWindow = getRateLimitPrimaryFallbackWindow(limit)
  return legacyWindow ? [legacyWindow] : []
}

export function getRateLimitCreditsSummary(limit: RateLimit) {
  const record = getRateLimitRecord(limit)
  const creditsRecord = objectRecordField(record.credits)
  if (!creditsRecord) {
    return null
  }

  const unlimited = booleanRecordField(creditsRecord.unlimited)
  const hasCredits = booleanRecordField(creditsRecord.hasCredits)
  const balanceText = stringRecordField(creditsRecord.balance)
  const balance = numberRecordField(creditsRecord.balance)

  if (unlimited) {
    return i18n._({
      id: 'Unlimited credits',
      message: 'Unlimited credits',
    })
  }

  if (balance !== null) {
    return i18n._({
      id: '{balance} credits balance',
      message: '{balance} credits balance',
      values: {
        balance: formatLocaleNumber(balance),
      },
    })
  }

  if (balanceText) {
    return i18n._({
      id: '{balance} credits balance',
      message: '{balance} credits balance',
      values: {
        balance: balanceText,
      },
    })
  }

  if (hasCredits === false) {
    return i18n._({
      id: 'No credits',
      message: 'No credits',
    })
  }

  if (hasCredits === true) {
    return i18n._({
      id: 'Credits available',
      message: 'Credits available',
    })
  }

  return null
}

export function getRateLimitPlanType(limit: RateLimit) {
  const record = getRateLimitRecord(limit)
  const planType = stringRecordField(record.planType)
  return planType || null
}

function getNextResetAt(windows: RateLimitWindowSummary[]) {
  let earliestTimestamp: number | null = null
  let earliestValue: string | null = null

  for (const window of windows) {
    if (!window.resetsAt) {
      continue
    }

    const timestamp = Date.parse(window.resetsAt)
    if (Number.isNaN(timestamp)) {
      if (!earliestValue) {
        earliestValue = window.resetsAt
      }
      continue
    }

    if (earliestTimestamp === null || timestamp < earliestTimestamp) {
      earliestTimestamp = timestamp
      earliestValue = window.resetsAt
    }
  }

  return earliestValue
}

export function summarizeRateLimit(limit: RateLimit): RateLimitSummary {
  const title = getRateLimitDisplayName(limit)
  const record = getRateLimitRecord(limit)
  const key =
    stringRecordField(record.limitId) ||
    stringRecordField(record.limitName) ||
    stringRecordField(record.name) ||
    title
  const windows = getRateLimitWindows(limit)
  const creditsSummary = getRateLimitCreditsSummary(limit)
  const planType = getRateLimitPlanType(limit)
  const subtitleParts = windows.map((window) =>
    i18n._({
      id: '{label} {usage}',
      message: '{label} {usage}',
      values: {
        label: window.label,
        usage: formatRateLimitPercent(window.usedPercent),
      },
    }),
  )

  if (creditsSummary) {
    subtitleParts.push(creditsSummary)
  }

  if (planType) {
    subtitleParts.push(
      i18n._({
        id: 'Plan {planType}',
        message: 'Plan {planType}',
        values: {
          planType,
        },
      }),
    )
  }

  return {
    key,
    title,
    subtitle:
      subtitleParts.join(' · ') ||
      i18n._({
        id: 'No usage snapshot available',
        message: 'No usage snapshot available',
      }),
    windows,
    creditsSummary,
    planType,
    nextResetAt: getNextResetAt(windows),
  }
}

export function getRateLimitsNextResetAt(rateLimits: RateLimit[] | undefined) {
  if (!rateLimits?.length) {
    return null
  }

  let earliestTimestamp: number | null = null
  let earliestValue: string | null = null

  for (const rateLimit of rateLimits) {
    const nextResetAt = summarizeRateLimit(rateLimit).nextResetAt
    if (!nextResetAt) {
      continue
    }

    const timestamp = Date.parse(nextResetAt)
    if (Number.isNaN(timestamp)) {
      if (!earliestValue) {
        earliestValue = nextResetAt
      }
      continue
    }

    if (earliestTimestamp === null || timestamp < earliestTimestamp) {
      earliestTimestamp = timestamp
      earliestValue = nextResetAt
    }
  }

  return earliestValue
}

export function describeRateLimits(rateLimits: RateLimit[] | undefined) {
  if (!rateLimits?.length) {
    return i18n._({
      id: 'Unavailable',
      message: 'Unavailable',
    })
  }

  const summaries = rateLimits.slice(0, 2).map((limit) => {
    const summary = summarizeRateLimit(limit)
    const compactParts = summary.windows.map((window) =>
      i18n._({
        id: '{label} {usage}',
        message: '{label} {usage}',
        values: {
          label: window.label,
          usage:
            window.usedPercent === null
              ? i18n._({
                  id: 'n/a',
                  message: 'n/a',
                })
              : `${formatLocaleNumber(
                  Math.abs(window.usedPercent - Math.round(window.usedPercent)) < 0.05
                    ? Math.round(window.usedPercent)
                    : Math.round(window.usedPercent * 10) / 10,
                )}%`,
        },
      }),
    )

    if (summary.creditsSummary) {
      compactParts.push(summary.creditsSummary)
    }

    if (summary.planType) {
      compactParts.push(summary.planType)
    }

    return `${truncateInlineText(summary.title, 24)}: ${
      compactParts.join(', ') ||
      i18n._({
        id: 'No snapshot',
        message: 'No snapshot',
      })
    }`
  })

  if (rateLimits.length > 2) {
    summaries.push(
      i18n._({
        id: '+{count} more buckets',
        message: '+{count} more buckets',
        values: {
          count: formatLocaleNumber(rateLimits.length - 2),
        },
      }),
    )
  }

  return summaries.join(' · ')
}

export function normalizeMcpServerState(entry: Record<string, unknown>): NormalizedMcpServerState {
  const name =
    stringRecordField(entry.name) ||
    stringRecordField(entry.serverName) ||
    stringRecordField(entry.id) ||
    i18n._({
      id: 'Unnamed server',
      message: 'Unnamed server',
    })
  const status =
    stringRecordField(entry.status) ||
    stringRecordField(entry.authStatus) ||
    stringRecordField(entry.state) ||
    'unknown'
  const detail =
    stringRecordField(entry.message) ||
    stringRecordField(entry.description) ||
    stringRecordField(entry.detail)

  return { name, status, detail }
}

export function ComposerCloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

function ComposerFileIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M7 4.5h6l4 4v11a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 19.5V6A1.5 1.5 0 0 1 7.5 4.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M13 4.5V9h4.5"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

export function ComposerOptionGlyph({ icon }: ComposerOptionGlyphProps) {
  switch (icon) {
    case 'mcp':
      return <TerminalIcon />
    case 'personalization':
      return <SettingsIcon />
    case 'review':
      return <ToolsIcon />
    case 'feedback':
      return <FeedIcon />
    case 'worktree':
      return <FolderClosedIcon />
    case 'status':
      return <ContextIcon />
    case 'plan':
      return <RefreshIcon />
    case 'skill':
      return <SparkIcon />
    case 'file':
    default:
      return <ComposerFileIcon />
  }
}

export function statusIsInterruptible(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  return ['running', 'processing', 'sending', 'waiting', 'inprogress', 'started'].includes(normalized)
}

export function compactStatusTone(value?: string) {
  return (value ?? 'idle').toLowerCase().replace(/\s+/g, '-')
}

export function compactStatusLabel(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'running':
    case 'processing':
    case 'sending':
    case 'waiting':
    case 'inprogress':
    case 'started':
      return i18n._({
        id: 'Processing',
        message: 'Processing',
      })
    case 'connected':
    case 'ready':
    case 'open':
    case 'active':
      return i18n._({
        id: 'Online',
        message: 'Online',
      })
    case 'archived':
      return i18n._({
        id: 'Archived',
        message: 'Archived',
      })
    case 'failed':
    case 'error':
    case 'systemerror':
      return i18n._({
        id: 'Error',
        message: 'Error',
      })
    default:
      return i18n._({
        id: 'Idle',
        message: 'Idle',
      })
  }
}

function normalizeStatusValue(value?: string) {
  return (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
}

function formatStatusValueLabel(value?: string) {
  const normalized = normalizeStatusValue(value)

  if (normalized === 'reviewing') {
    return i18n._({
      id: 'Awaiting approval',
      message: 'Awaiting approval',
    })
  }

  return formatLocalizedStatusLabel(value)
}

function readStatusReason(value: unknown): string {
  if (!value) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (value instanceof Error) {
    return value.message.trim()
  }

  if (typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  const directKeys = ['message', 'error', 'detail', 'reason', 'summary']
  for (const key of directKeys) {
    const next = record[key]
    if (typeof next === 'string' && next.trim() !== '') {
      return next.trim()
    }
  }

  for (const key of directKeys) {
    const next = record[key]
    const nested = readStatusReason(next)
    if (nested) {
      return nested
    }
  }

  return ''
}

function describeStreamState(value: string) {
  return formatStreamStateLabel(value)
}

export function buildComposerStatusInfo(input: BuildComposerStatusInfoInput) {
  const rawThreadStatus = input.rawThreadStatus ?? ''
  const latestTurnStatus = input.latestTurnStatus ?? ''
  const rawNormalized = normalizeStatusValue(rawThreadStatus)
  const latestTurnNormalized = normalizeStatusValue(latestTurnStatus)
  const latestTurnErrorMessage = readStatusReason(input.latestTurnError)
  const sendErrorMessage = input.sendError?.trim() ?? ''
  const detailRows: ComposerStatusDetailRow[] = [
    {
      label: i18n._({
        id: 'Thread loaded',
        message: 'Thread loaded',
      }),
      value:
        input.isThreadLoaded === null
          ? i18n._({
              id: 'Unknown',
              message: 'Unknown',
            })
          : input.isThreadLoaded
            ? i18n._({
                id: 'Loaded',
                message: 'Loaded',
              })
            : i18n._({
                id: 'Not loaded',
                message: 'Not loaded',
              }),
    },
    {
      label: i18n._({
        id: 'Live connection',
        message: 'Live connection',
      }),
      value: describeStreamState(input.streamState),
    },
    {
      label: i18n._({
        id: 'Raw thread status',
        message: 'Raw thread status',
      }),
      value: formatStatusValueLabel(rawThreadStatus),
    },
  ]

  if (latestTurnStatus) {
    detailRows.push({
      label: i18n._({
        id: 'Latest turn status',
        message: 'Latest turn status',
      }),
      value: formatStatusValueLabel(latestTurnStatus),
    })
  }
  if (latestTurnErrorMessage) {
    detailRows.push({
      label: i18n._({
        id: 'Latest error',
        message: 'Latest error',
      }),
      value: latestTurnErrorMessage,
    })
  }
  if (sendErrorMessage) {
    detailRows.push({
      label: i18n._({
        id: 'Send error',
        message: 'Send error',
      }),
      value: sendErrorMessage,
    })
  }
  if (input.approvalSummary) {
    detailRows.push({
      label: i18n._({
        id: 'Approval status',
        message: 'Approval status',
      }),
      value: input.approvalSummary,
    })
  }

  if (input.requiresOpenAIAuth) {
    return {
      label: i18n._({
        id: 'Authentication error',
        message: 'Authentication error',
      }),
      tone: 'error',
      summary: i18n._({
        id: 'OpenAI authentication expired. This thread cannot continue until access is restored.',
        message: 'OpenAI authentication expired. This thread cannot continue until access is restored.',
      }),
      detailRows,
      noticeTitle: i18n._({
        id: 'Thread authentication error',
        message: 'Thread authentication error',
      }),
      noticeMessage: i18n._({
        id: 'OpenAI authentication expired. This thread cannot continue until access is restored.',
        message: 'OpenAI authentication expired. This thread cannot continue until access is restored.',
      }),
    } satisfies ComposerStatusInfo
  }

  if (input.isApprovalDialogOpen) {
    return {
      label: i18n._({
        id: 'Awaiting approval',
        message: 'Awaiting approval',
      }),
      tone: 'warning',
      summary: input.approvalSummary
        ? i18n._({
            id: 'This thread is waiting for approval: {approvalSummary}',
            message: 'This thread is waiting for approval: {approvalSummary}',
            values: { approvalSummary: input.approvalSummary },
          })
        : i18n._({
            id: 'This thread is waiting for approval and will not continue until a decision is made.',
            message: 'This thread is waiting for approval and will not continue until a decision is made.',
          }),
      detailRows,
    } satisfies ComposerStatusInfo
  }

  if (input.isWaitingForThreadData || input.isThreadInterruptible) {
    return {
      label: i18n._({
        id: 'Processing',
        message: 'Processing',
      }),
      tone: 'active',
      summary:
        input.pendingPhase === 'sending'
          ? i18n._({
              id: 'The message was submitted and the runtime is creating a turn.',
              message: 'The message was submitted and the runtime is creating a turn.',
            })
          : i18n._({
              id: 'The thread is running or waiting for the current turn to finish.',
              message: 'The thread is running or waiting for the current turn to finish.',
            }),
      detailRows,
    } satisfies ComposerStatusInfo
  }

  if (latestTurnErrorMessage) {
    return {
      label: i18n._({
        id: 'Error',
        message: 'Error',
      }),
      tone: 'error',
      summary: latestTurnErrorMessage,
      detailRows,
      noticeTitle: i18n._({
        id: 'Thread runtime error',
        message: 'Thread runtime error',
      }),
      noticeMessage: latestTurnErrorMessage,
    } satisfies ComposerStatusInfo
  }

  if (sendErrorMessage) {
    return {
      label: i18n._({
        id: 'Error',
        message: 'Error',
      }),
      tone: 'error',
      summary: sendErrorMessage,
      detailRows,
      noticeTitle: i18n._({
        id: 'Thread send error',
        message: 'Thread send error',
      }),
      noticeMessage: sendErrorMessage,
    } satisfies ComposerStatusInfo
  }

  if (rawNormalized === 'systemerror') {
    if (
      !latestTurnErrorMessage &&
      input.isThreadLoaded !== false &&
      latestTurnNormalized !== 'error' &&
      latestTurnNormalized !== 'failed'
    ) {
      return null
    }

    return {
      label: i18n._({
        id: 'Error',
        message: 'Error',
      }),
      tone: 'error',
      summary:
        input.isThreadLoaded === false
          ? i18n._({
              id: 'The runtime marked this thread as systemError while the thread was not loaded.',
              message: 'The runtime marked this thread as systemError while the thread was not loaded.',
            })
          : i18n._({
              id: 'The runtime marked this thread as systemError without returning a more specific error.',
              message: 'The runtime marked this thread as systemError without returning a more specific error.',
            }),
      detailRows,
      noticeTitle: i18n._({
        id: 'Thread runtime error',
        message: 'Thread runtime error',
      }),
      noticeMessage:
        input.isThreadLoaded === false
          ? i18n._({
              id: 'The runtime marked this thread as systemError while the thread was not loaded.',
              message: 'The runtime marked this thread as systemError while the thread was not loaded.',
            })
          : i18n._({
              id: 'The runtime marked this thread as systemError without returning a more specific error.',
              message: 'The runtime marked this thread as systemError without returning a more specific error.',
            }),
    } satisfies ComposerStatusInfo
  }

  if (rawNormalized === 'archived') {
    return {
      label: i18n._({
        id: 'Archived',
        message: 'Archived',
      }),
      tone: 'warning',
      summary: i18n._({
        id: 'This thread is archived.',
        message: 'This thread is archived.',
      }),
      detailRows,
    } satisfies ComposerStatusInfo
  }

  if (rawNormalized === 'interrupted') {
    return {
      label: i18n._({
        id: 'Stopped',
        message: 'Stopped',
      }),
      tone: 'warning',
      summary: i18n._({
        id: 'Thread execution was interrupted.',
        message: 'Thread execution was interrupted.',
      }),
      detailRows,
    } satisfies ComposerStatusInfo
  }

  return null
}

export function formatSyncCountdown(lastSyncAtMs: number, intervalMs: number, nowMs: number) {
  if (!lastSyncAtMs || !intervalMs) {
    return i18n._({
      id: 'soon',
      message: 'soon',
    })
  }

  const remainingMs = Math.max(0, lastSyncAtMs + intervalMs - nowMs)
  if (remainingMs < 1_000) {
    return i18n._({
      id: 'soon',
      message: 'soon',
    })
  }

  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (!minutes) {
    return `${totalSeconds}s`
  }

  return `${minutes}m ${seconds}s`
}

export function buildSyncStatusDisplay(input: BuildSyncStatusDisplayInput) {
  if (input.isHeaderSyncBusy) {
    return {
      syncLabel: i18n._({
        id: 'Syncing',
        message: 'Syncing',
      }),
      syncTitle: i18n._({
        id: 'Syncing…',
        message: 'Syncing…',
      }),
    }
  }

  if (input.autoSyncIntervalMs) {
    const countdown = formatSyncCountdown(
      input.lastAutoSyncAtMs,
      input.autoSyncIntervalMs,
      input.nowMs,
    )

    return {
      syncLabel: countdown,
      syncTitle: i18n._({
        id: 'Next sync {time}',
        message: 'Next sync {time}',
        values: { time: countdown },
      }),
    }
  }

  if (input.streamState === 'open') {
    const liveLabel = i18n._({
      id: 'Live',
      message: 'Live',
    })

    return {
      syncLabel: liveLabel,
      syncTitle: liveLabel,
    }
  }

  return {
    syncLabel: i18n._({
      id: 'Manual',
      message: 'Manual',
    }),
    syncTitle: i18n._({
      id: 'Manual sync',
      message: 'Manual sync',
    }),
  }
}

export function ContextUsageIndicator({
  compactDisabledReason,
  compactFeedback,
  compactPending,
  contextWindow,
  onCompact,
  percent,
  totalTokens,
  usage,
}: ContextUsageIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const usagePercent = percent ?? 0
  const tone =
    percent === null
      ? 'idle'
      : usagePercent >= 85
        ? 'critical'
        : usagePercent >= 65
          ? 'warning'
          : 'healthy'

  const label = percent === null ? '--' : `${usagePercent}%`
  const title =
    percent === null
      ? i18n._({
          id: 'Context usage is not available until the runtime reports token usage.',
          message: 'Context usage is not available until the runtime reports token usage.',
        })
      : i18n._({
          id: 'Context usage {usagePercent}% ({totalTokens} / {contextWindow} tokens)',
          message: 'Context usage {usagePercent}% ({totalTokens} / {contextWindow} tokens)',
          values: {
            usagePercent,
            totalTokens: formatLocaleNumber(totalTokens),
            contextWindow: formatLocaleNumber(contextWindow),
          },
        })
  const totalBreakdown = usage?.total
  const lastBreakdown = usage?.last
  const compactButtonLabel = compactPending
    ? i18n._({
        id: 'Starting',
        message: 'Starting',
      })
    : compactFeedback?.phase === 'requested'
      ? i18n._({
          id: 'Queued',
          message: 'Queued',
        })
      : compactFeedback?.phase === 'failed'
        ? i18n._({
            id: 'Retry',
            message: 'Retry',
          })
        : i18n._({
            id: 'Compact',
            message: 'Compact',
          })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div
      ref={containerRef}
      className={
        isOpen
          ? `composer-context-usage composer-context-usage--${tone} composer-context-usage--open`
          : `composer-context-usage composer-context-usage--${tone}`
      }
      style={{ ['--context-usage-percent' as string]: `${usagePercent}%` } as CSSProperties}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={title}
        className="composer-context-usage__summary"
        onClick={() => setIsOpen((current) => !current)}
        title={title}
        type="button"
      >
        <span aria-hidden="true" className="composer-context-usage__ring" />
        <span aria-hidden="true" className="composer-context-usage__core" />
        <span className="composer-context-usage__value">{label}</span>
      </button>
      {isOpen ? (
        <div className="composer-context-usage__popover" role="dialog">
          <div className="composer-context-usage__header">
            <strong>
              {i18n._({
                id: 'Context',
                message: 'Context',
              })}
            </strong>
            <span className={`composer-context-usage__pill composer-context-usage__pill--${tone}`}>
              {label}
            </span>
          </div>
          {percent === null ? (
            <p className="composer-context-usage__empty">
              {i18n._({
                id: 'No usage data',
                message: 'No usage data',
              })}
            </p>
          ) : (
            <div className="composer-context-usage__metric-grid">
              <div className="composer-context-usage__metric">
                <span>
                  {i18n._({
                    id: 'Total',
                    message: 'Total',
                  })}
                </span>
                <strong>{formatLocaleNumber(totalTokens)}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>
                  {i18n._({
                    id: 'Window',
                    message: 'Window',
                  })}
                </span>
                <strong>{formatLocaleNumber(contextWindow)}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>
                  {i18n._({
                    id: 'Input',
                    message: 'Input',
                  })}
                </span>
                <strong>{formatLocaleNumber(totalBreakdown?.inputTokens ?? 0)}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>
                  {i18n._({
                    id: 'Output',
                    message: 'Output',
                  })}
                </span>
                <strong>{formatLocaleNumber(totalBreakdown?.outputTokens ?? 0)}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>
                  {i18n._({
                    id: 'Reasoning',
                    message: 'Reasoning',
                  })}
                </span>
                <strong>{formatLocaleNumber(totalBreakdown?.reasoningOutputTokens ?? 0)}</strong>
              </div>
              <div className="composer-context-usage__metric">
                <span>
                  {i18n._({
                    id: 'Last Turn',
                    message: 'Last Turn',
                  })}
                </span>
                <strong>{formatLocaleNumber(lastBreakdown?.totalTokens ?? 0)}</strong>
              </div>
            </div>
          )}
          <div className="composer-context-usage__action">
            {compactFeedback ? (
              <span
                aria-live="polite"
                className={
                  compactFeedback.phase === 'failed'
                    ? 'composer-context-usage__status composer-context-usage__status--error'
                    : compactFeedback.phase === 'completed'
                      ? 'composer-context-usage__status composer-context-usage__status--success'
                      : 'composer-context-usage__status composer-context-usage__status--pending'
                }
                role="status"
              >
                {compactFeedback.title}
              </span>
            ) : null}
            <button
              className="ide-button ide-button--secondary composer-context-usage__compact-button"
              disabled={
                Boolean(compactDisabledReason) ||
                compactPending ||
                compactFeedback?.phase === 'requested'
              }
              onClick={onCompact}
              title={
                compactDisabledReason ??
                i18n._({
                  id: 'Compact older thread context',
                  message: 'Compact older thread context',
                })
              }
              type="button"
            >
              <span aria-hidden="true" className="composer-context-usage__compact-icon">
                <SparkIcon />
              </span>
              <span>{compactButtonLabel}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ComposerStatusIndicator({ info }: ComposerStatusIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ bottom: number; right: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) {
        return
      }

      const rect = trigger.getBoundingClientRect()
      const viewportPadding = 12
      const estimatedWidth = 320
      const bottom = Math.max(viewportPadding, window.innerHeight - rect.top + 8)
      const right = Math.max(viewportPadding, window.innerWidth - rect.right)
      const maxRight = Math.max(viewportPadding, window.innerWidth - viewportPadding - estimatedWidth)

      setPosition({
        bottom,
        right: Math.max(viewportPadding, Math.min(right, maxRight)),
      })
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (containerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    const frameId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const popover =
    isOpen && position
      ? createPortal(
          <div
            className="composer-thread-status__popover"
            role="dialog"
            ref={popoverRef}
            style={{ bottom: `${position.bottom}px`, right: `${position.right}px` }}
          >
            <div className="composer-thread-status__popover-header">
              <strong>{info.label}</strong>
              <span>{info.summary}</span>
            </div>
            <div className="composer-thread-status__popover-grid">
              {info.detailRows.map((row) => (
                <div className="composer-thread-status__popover-row" key={`${row.label}-${row.value}`}>
                  <span>{row.label}</span>
                  <strong title={row.value}>{row.value}</strong>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div
      className={
        isOpen
          ? `composer-thread-status composer-thread-status--${info.tone} composer-thread-status--open`
          : `composer-thread-status composer-thread-status--${info.tone}`
      }
      ref={containerRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${info.label}: ${info.summary}`}
        className="composer-thread-status__trigger"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        title={info.summary}
        type="button"
      >
        <span className="composer-thread-status__dot" />
        <span className="composer-thread-status__label">{info.label}</span>
      </button>
      {popover}
    </div>
  )
}
