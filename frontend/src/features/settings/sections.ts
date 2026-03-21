export const settingsSections = [
  {
    id: 'general',
    to: '/settings/general',
    label: 'General',
    caption: 'Account, login, and usage limits.',
  },
  {
    id: 'appearance',
    to: '/settings/appearance',
    label: 'Appearance',
    caption: 'Theme presets, thread reading controls, density, and motion preferences.',
  },
  {
    id: 'config',
    to: '/settings/config',
    label: 'Config',
    caption: 'Workspace scope and runtime configuration.',
  },
  {
    id: 'personalization',
    to: '/settings/personalization',
    label: 'Personalization',
    caption: 'Response style and custom instructions.',
  },
  {
    id: 'mcp',
    to: '/settings/mcp',
    label: 'MCP Servers',
    caption: 'Server authorization and integration setup.',
  },
  {
    id: 'git',
    to: '/settings/git',
    label: 'Git',
    caption: 'Commit and pull request guidance.',
  },
  {
    id: 'environment',
    to: '/settings/environment',
    label: 'Environment',
    caption: 'Workspace roots and runtime environment.',
  },
  {
    id: 'worktrees',
    to: '/settings/worktrees',
    label: 'Worktrees',
    caption: 'Retention policy and root overview.',
  },
  {
    id: 'archived',
    to: '/settings/archived-threads',
    label: 'Archived Threads',
    caption: 'Review and restore archived work.',
  },
] as const

export type SettingsSection = (typeof settingsSections)[number]
