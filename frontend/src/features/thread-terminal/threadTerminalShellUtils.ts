import type { SelectOption } from '../../components/ui/selectControlTypes'
import { i18n } from '../../i18n/runtime'
import type {
  ThreadTerminalShellDisplayNameInput,
  ThreadTerminalShellLauncherNameInput,
  ThreadTerminalShellOptionsInput,
} from './threadTerminalShellTypes'

export function formatShellDisplayName({
  fallback,
  shellPath,
}: ThreadTerminalShellDisplayNameInput) {
  const normalized = `${shellPath ?? ''} ${fallback ?? ''}`.toLowerCase()

  if (normalized.includes('pwsh') || normalized.includes('powershell')) {
    return i18n._({
      id: 'PowerShell',
      message: 'PowerShell',
    })
  }

  if (normalized.includes('cmd.exe') || normalized.includes('command prompt')) {
    return i18n._({
      id: 'Command Prompt',
      message: 'Command Prompt',
    })
  }

  if (isGitBashShell(normalized)) {
    return i18n._({
      id: 'Git Bash',
      message: 'Git Bash',
    })
  }

  if (isWslShimShell(normalized)) {
    return 'WSL'
  }

  if (normalized.includes('zsh')) {
    return 'zsh'
  }

  if (normalized.includes('bash')) {
    return 'bash'
  }

  if (normalized.includes('/bin/sh') || normalized.endsWith(' sh') || normalized === 'sh') {
    return 'sh'
  }

  return fallback || shellPath || i18n._({
    id: 'Shell',
    message: 'Shell',
  })
}

export function formatTerminalShellLauncherName({
  rootPath,
  shell,
}: ThreadTerminalShellLauncherNameInput) {
  switch ((shell ?? '').trim().toLowerCase()) {
    case 'pwsh':
      return i18n._({
        id: 'PowerShell 7 (pwsh)',
        message: 'PowerShell 7 (pwsh)',
      })
    case 'powershell':
      return i18n._({
        id: 'Windows PowerShell',
        message: 'Windows PowerShell',
      })
    case 'cmd':
      return i18n._({
        id: 'Command Prompt',
        message: 'Command Prompt',
      })
    case 'wsl':
      return 'WSL'
    case 'git-bash':
      return i18n._({
        id: 'Git Bash',
        message: 'Git Bash',
      })
    case 'bash':
      return 'bash'
    case 'zsh':
      return 'zsh'
    case 'sh':
      return 'sh'
    default:
      return formatDefaultShellLauncherName(rootPath)
  }
}

export function buildTerminalShellOptions(
  { currentShell, supportedShells }: ThreadTerminalShellOptionsInput,
): SelectOption[] {
  const options: SelectOption[] = [
    {
      value: '',
      label: i18n._({
        id: 'Auto select shell',
        message: 'Auto select shell',
      }),
      triggerLabel: i18n._({ id: 'Auto', message: 'Auto' }),
    },
  ]

  for (const shell of supportedShells) {
    options.push({
      value: shell,
      label: formatTerminalShellLauncherName({ shell }),
      triggerLabel:
        shell === 'pwsh' || shell === 'cmd' || shell === 'wsl'
          ? shell.toUpperCase() === 'CMD'
            ? 'cmd'
            : shell === 'pwsh'
              ? 'pwsh'
              : 'WSL'
          : formatTerminalShellLauncherName({ shell }),
    })
  }

  const normalizedCurrentShell = (currentShell ?? '').trim().toLowerCase()
  if (
    normalizedCurrentShell &&
    !options.some((option) => option.value === normalizedCurrentShell)
  ) {
    options.push({
      value: normalizedCurrentShell,
      label: i18n._({
        id: '{shell} (saved, unavailable)',
        message: '{shell} (saved, unavailable)',
        values: {
          shell: formatTerminalShellLauncherName({ shell: normalizedCurrentShell }),
        },
      }),
      triggerLabel: formatTerminalShellLauncherName({ shell: normalizedCurrentShell }),
      disabled: true,
    })
  }

  return options
}

export function isWindowsWorkspace(rootPath?: string) {
  if (!rootPath) {
    return false
  }

  return /^[a-z]:[\\/]/i.test(rootPath) || /^\\\\/.test(rootPath)
}

export function isWslShimShell(normalizedValue: string) {
  return normalizedValue.includes('wsl.exe') ||
    normalizedValue.includes('\\windows\\system32\\bash.exe') ||
    normalizedValue.includes('/windows/system32/bash.exe') ||
    normalizedValue === 'wsl' ||
    normalizedValue === 'bash.exe'
}

function formatDefaultShellLauncherName(rootPath?: string) {
  if (isWindowsWorkspace(rootPath)) {
    return i18n._({
      id: 'PowerShell',
      message: 'PowerShell',
    })
  }

  return i18n._({
    id: 'Shell',
    message: 'Shell',
  })
}

function isGitBashShell(normalizedValue: string) {
  return normalizedValue.includes('\\program files\\git\\') ||
    normalizedValue.includes('/program files/git/') ||
    normalizedValue.includes('git-bash.exe')
}
