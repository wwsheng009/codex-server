import { i18n } from '../../i18n/runtime'

export function getSettingsSections() {
  return [
    {
      id: 'general',
      to: '/settings/general',
      label: i18n._({ id: 'General', message: 'General' }),
      caption: i18n._({ id: 'settings.general.caption', message: 'Account, login, and usage limits.' }),
    },
    {
      id: 'appearance',
      to: '/settings/appearance',
      label: i18n._({ id: 'Appearance', message: 'Appearance' }),
      caption: i18n._({ id: 'settings.appearance.caption', message: 'Theme presets, thread reading controls, density, and motion preferences.' }),
    },
    {
      id: 'governance',
      to: '/settings/governance',
      label: i18n._({ id: 'Governance', message: 'Governance' }),
      caption: i18n._({ id: 'settings.governance.caption', message: 'Turn hooks, turn policy, workspace baseline, and audit activity.' }),
    },
    {
      id: 'config',
      to: '/settings/config',
      label: i18n._({ id: 'Config', message: 'Config' }),
      caption: i18n._({ id: 'settings.config.caption', message: 'Workspace scope and runtime configuration.' }),
    },
    {
      id: 'personalization',
      to: '/settings/personalization',
      label: i18n._({ id: 'Personalization', message: 'Personalization' }),
      caption: i18n._({ id: 'settings.personalization.caption', message: 'Response style and custom instructions.' }),
    },
    {
      id: 'mcp',
      to: '/settings/mcp',
      label: i18n._({ id: 'MCP Servers', message: 'MCP Servers' }),
      caption: i18n._({ id: 'settings.mcp.caption', message: 'Server authorization and integration setup.' }),
    },
    {
      id: 'git',
      to: '/settings/git',
      label: i18n._({ id: 'Git', message: 'Git' }),
      caption: i18n._({ id: 'settings.git.caption', message: 'Commit and pull request guidance.' }),
    },
    {
      id: 'environment',
      to: '/settings/environment',
      label: i18n._({ id: 'Environment', message: 'Environment' }),
      caption: i18n._({ id: 'settings.environment.caption', message: 'Workspace roots and runtime environment.' }),
    },
    {
      id: 'worktrees',
      to: '/settings/worktrees',
      label: i18n._({ id: 'Worktrees', message: 'Worktrees' }),
      caption: i18n._({ id: 'settings.worktrees.caption', message: 'Retention policy and root overview.' }),
    },
    {
      id: 'archived',
      to: '/settings/archived-threads',
      label: i18n._({ id: 'Archived Threads', message: 'Archived Threads' }),
      caption: i18n._({ id: 'settings.archived.caption', message: 'Review and restore archived work.' }),
    },
  ] as const
}

export type SettingsSection = ReturnType<typeof getSettingsSections>[number]
