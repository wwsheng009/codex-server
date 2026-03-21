import type { Automation } from '../../types/api'

export type AutomationRecord = Automation

export type AutomationTemplate = {
  id: string
  category: string
  title: string
  description: string
  prompt: string
}
const TEMPLATES_STORAGE_KEY = 'codex-server:templates:v2'

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

export function listTemplates(): AutomationTemplate[] {
  if (typeof window === 'undefined') {
    return AUTOMATION_TEMPLATES
  }

  try {
    const raw = window.localStorage.getItem(TEMPLATES_STORAGE_KEY)
    const custom = raw ? (JSON.parse(raw) as AutomationTemplate[]) : []
    return [...AUTOMATION_TEMPLATES, ...custom]
  } catch {
    return AUTOMATION_TEMPLATES
  }
}

export function createCustomTemplate(draft: Omit<AutomationTemplate, 'id'>) {
  const templates = listTemplates().filter(t => !AUTOMATION_TEMPLATES.some(staticT => staticT.id === t.id))
  const newTemplate: AutomationTemplate = {
    ...draft,
    id: `custom-${crypto.randomUUID()}`,
  }
  const next = [...templates, newTemplate]
  window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(next))
  return newTemplate
}

export function updateCustomTemplate(id: string, draft: Omit<AutomationTemplate, 'id'>) {
  const templates = listTemplates().filter(t => !AUTOMATION_TEMPLATES.some(staticT => staticT.id === t.id))
  const next = templates.map(t => {
    if (t.id === id) {
      return { ...draft, id }
    }
    return t
  })
  window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(next))
}

export function deleteCustomTemplate(id: string) {
  const templates = listTemplates().filter(t => !AUTOMATION_TEMPLATES.some(staticT => staticT.id === t.id))
  const next = templates.filter(t => t.id !== id)
  window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(next))
}
