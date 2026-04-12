import { i18n } from '../../i18n/runtime'

export function getSettingsSections() {
  return [
    {
      id: 'general',
      to: '/settings/general',
      label: i18n._({ id: 'General', message: 'General' }),
      caption: 'Account, login, and usage limits.',
    },
    {
      id: 'appearance',
      to: '/settings/appearance',
      label: i18n._({ id: 'Appearance', message: 'Appearance' }),
      caption: 'Theme presets, thread reading controls, density, and motion preferences.',
    },
    {
      id: 'governance',
      to: '/settings/governance',
      label: i18n._({ id: 'Governance', message: 'Governance' }),
      caption: 'Turn hooks, turn policy, workspace baseline, and audit activity.',
    },
    {
      id: 'config',
      to: '/settings/config',
      label: i18n._({ id: 'Config', message: 'Config' }),
      caption: 'Workspace scope and runtime configuration.',
    },
    {
      id: 'personalization',
      to: '/settings/personalization',
      label: i18n._({ id: 'Personalization', message: 'Personalization' }),
      caption: 'Response style and custom instructions.',
    },
    {
      id: 'mcp',
      to: '/settings/mcp',
      label: i18n._({ id: 'MCP Servers', message: 'MCP Servers' }),
      caption: 'Server authorization and integration setup.',
    },
    {
      id: 'git',
      to: '/settings/git',
      label: i18n._({ id: 'Git', message: 'Git' }),
      caption: 'Commit and pull request guidance.',
    },
    {
      id: 'environment',
      to: '/settings/environment',
      label: i18n._({ id: 'Environment', message: 'Environment' }),
      caption: 'Workspace roots and runtime environment.',
    },
    {
      id: 'worktrees',
      to: '/settings/worktrees',
      label: i18n._({ id: 'Worktrees', message: 'Worktrees' }),
      caption: 'Retention policy and root overview.',
    },
    {
      id: 'archived',
      to: '/settings/archived-threads',
      label: i18n._({ id: 'Archived Threads', message: 'Archived Threads' }),
      caption: 'Review and restore archived work.',
    },
  ] as const
}

export type SettingsSection = ReturnType<typeof getSettingsSections>[number]
