export type AutomationTemplate = {
  id: string
  category: string
  title: string
  description: string
  prompt: string
}

export type AutomationRecord = {
  id: string
  title: string
  description: string
  prompt: string
  workspaceId: string
  workspaceName: string
  schedule: string
  scheduleLabel: string
  model: string
  reasoning: string
  status: 'active' | 'paused'
  nextRun: string
  lastRun: string | null
  createdAt: string
  updatedAt: string
}

type AutomationDraft = {
  title: string
  description: string
  prompt: string
  workspaceId: string
  workspaceName: string
  schedule: string
  model: string
  reasoning: string
}

const STORAGE_KEY = 'codex-server:automations:v2'

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'status-standup',
    category: 'Status Reports',
    title: "Summarize Yesterday's Git Activity",
    description: 'Generate a concise standup-ready summary of recent code movement and risk.',
    prompt: "Summarize yesterday's git activity for standup and highlight any release risk.",
  },
  {
    id: 'status-weekly',
    category: 'Status Reports',
    title: 'Weekly PR and Incident Summary',
    description: 'Synthesize recent PRs, incidents, rollouts, and reviews into a weekly update.',
    prompt: "Synthesize this week's PRs, incidents, rollouts, and reviews into a weekly update.",
  },
  {
    id: 'release-notes',
    category: 'Release Prep',
    title: 'Draft Release Notes',
    description: 'Create release notes from merged PRs and include links where possible.',
    prompt: 'Draft release notes from merged PRs and include relevant links where available.',
  },
  {
    id: 'release-verify',
    category: 'Release Prep',
    title: 'Pre-Tag Verification',
    description: 'Verify changelog, migrations, feature flags, and tests before tagging.',
    prompt: 'Before tagging, verify changelog, migrations, feature flags, and tests.',
  },
  {
    id: 'repo-maintenance',
    category: 'Repo Maintenance',
    title: 'Dependency Drift Check',
    description: 'Scan outdated dependencies and propose safe upgrades with minimal changes.',
    prompt: 'Scan outdated dependencies and propose safe upgrades with minimal changes.',
  },
]

export function listAutomations(): AutomationRecord[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isAutomationRecord) : []
  } catch {
    return []
  }
}

export function getAutomationRecord(automationId: string) {
  return listAutomations().find((item) => item.id === automationId)
}

export function createAutomationRecord(draft: AutomationDraft) {
  const now = new Date().toISOString()
  const record: AutomationRecord = {
    id: crypto.randomUUID(),
    title: draft.title,
    description: draft.description,
    prompt: draft.prompt,
    workspaceId: draft.workspaceId,
    workspaceName: draft.workspaceName,
    schedule: draft.schedule,
    scheduleLabel: scheduleLabel(draft.schedule),
    model: draft.model,
    reasoning: draft.reasoning,
    status: 'active',
    nextRun: nextRunLabel(draft.schedule),
    lastRun: null,
    createdAt: now,
    updatedAt: now,
  }

  const next = [record, ...listAutomations()]
  saveAutomations(next)
  return record
}

export function updateAutomationRecord(
  automationId: string,
  updater: (record: AutomationRecord) => AutomationRecord,
) {
  const next = listAutomations().map((record) => {
    if (record.id !== automationId) {
      return record
    }

    return {
      ...updater(record),
      updatedAt: new Date().toISOString(),
    }
  })

  saveAutomations(next)
  return next.find((record) => record.id === automationId) ?? null
}

export function deleteAutomationRecord(automationId: string) {
  saveAutomations(listAutomations().filter((record) => record.id !== automationId))
}

function saveAutomations(records: AutomationRecord[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

function scheduleLabel(schedule: string) {
  switch (schedule) {
    case 'hourly':
      return 'Every hour'
    case 'daily-0800':
      return 'Daily at 08:00'
    case 'daily-1800':
      return 'Daily at 18:00'
    default:
      return schedule
  }
}

function nextRunLabel(schedule: string) {
  switch (schedule) {
    case 'hourly':
      return 'Today at next hour'
    case 'daily-0800':
      return 'Tomorrow at 08:00'
    case 'daily-1800':
      return 'Today at 18:00'
    default:
      return 'Scheduled'
  }
}

function isAutomationRecord(value: unknown): value is AutomationRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.title === 'string'
}
