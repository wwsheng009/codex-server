import { i18n } from '../../i18n/runtime'

export const appearanceThemeOptions = [
  {
    value: 'system',
  },
  {
    value: 'light',
  },
  {
    value: 'dark',
  },
] as const

export const colorThemeOptions = [
  {
    value: 'cyan',
    swatches: ['#0891B2', '#22D3EE', '#ECFEFF', '#083344'],
  },
  {
    value: 'blue',
    swatches: ['#5271FF', '#8AA0FF', '#f6f2ee', '#fcfbfa'],
  },
  {
    value: 'slate',
    swatches: ['#5a7189', '#93a9bf', '#f3f6f8', '#f8fbfd'],
  },
  {
    value: 'amber',
    swatches: ['#c77d2a', '#efb36b', '#fbf4e9', '#fffaf2'],
  },
  {
    value: 'mint',
    swatches: ['#1f9d7a', '#6ccfb3', '#edf7f3', '#f7fcfa'],
  },
  {
    value: 'graphite',
    swatches: ['#1f9d68', '#63d29c', '#eef3f6', '#0d1117'],
  },
  {
    value: 'solarized',
    swatches: ['#2aa198', '#268bd2', '#fdf6e3', '#002b36'],
  },
] as const

export const threadSpacingOptions = [
  {
    value: 'tight',
  },
  {
    value: 'balanced',
  },
  {
    value: 'relaxed',
  },
] as const

export const messageSurfaceOptions = [
  {
    value: 'bare',
  },
  {
    value: 'soft',
  },
  {
    value: 'layered',
  },
] as const

export const userMessageEmphasisOptions = [
  {
    value: 'minimal',
  },
  {
    value: 'subtle',
  },
  {
    value: 'accented',
  },
] as const

export type AppearanceTheme = (typeof appearanceThemeOptions)[number]['value']
export type AccentTone = (typeof colorThemeOptions)[number]['value']
export type ThreadSpacing = (typeof threadSpacingOptions)[number]['value']
export type MessageSurface = (typeof messageSurfaceOptions)[number]['value']
export type UserMessageEmphasis = (typeof userMessageEmphasisOptions)[number]['value']
export type ResolvedAppearanceTheme = 'light' | 'dark'

export function resolveAppearanceTheme(
  theme: AppearanceTheme,
  prefersDark: boolean,
): ResolvedAppearanceTheme {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }

  return theme
}

export function getQuickToggleTheme(
  theme: AppearanceTheme,
  prefersDark: boolean,
): Exclude<AppearanceTheme, 'system'> {
  const resolvedTheme = resolveAppearanceTheme(theme, prefersDark)

  return resolvedTheme === 'dark' ? 'light' : 'dark'
}

export function getAppearanceThemeLabel(theme: AppearanceTheme): string {
  switch (theme) {
    case 'system':
      return i18n._({ id: 'System', message: 'System' })
    case 'light':
      return i18n._({ id: 'Light', message: 'Light' })
    case 'dark':
      return i18n._({ id: 'Dark', message: 'Dark' })
    default:
      return theme
  }
}

export function getAppearanceThemeDescription(theme: AppearanceTheme): string {
  switch (theme) {
    case 'system':
      return i18n._({
        id: 'Follow the operating system light or dark preference.',
        message: 'Follow the operating system light or dark preference.',
      })
    case 'light':
      return i18n._({
        id: 'Keep the shell bright with layered surfaces and soft contrast.',
        message: 'Keep the shell bright with layered surfaces and soft contrast.',
      })
    case 'dark':
      return i18n._({
        id: 'Shift the shell to a darker workbench for long sessions.',
        message: 'Shift the shell to a darker workbench for long sessions.',
      })
    default:
      return ''
  }
}

export function getColorThemeLabel(theme: AccentTone): string {
  switch (theme) {
    case 'cyan':
      return i18n._({ id: 'Cyan', message: 'Cyan' })
    case 'blue':
      return i18n._({ id: 'Cobalt', message: 'Cobalt' })
    case 'slate':
      return i18n._({ id: 'Slate', message: 'Slate' })
    case 'amber':
      return i18n._({ id: 'Amber', message: 'Amber' })
    case 'mint':
      return i18n._({ id: 'Mint', message: 'Mint' })
    case 'graphite':
      return i18n._({ id: 'Graphite', message: 'Graphite' })
    case 'solarized':
      return i18n._({ id: 'Solarized', message: 'Solarized' })
    default:
      return theme
  }
}

export function getColorThemeDescription(theme: AccentTone): string {
  switch (theme) {
    case 'cyan':
      return i18n._({ id: 'Crisp oceanic surfaces.', message: 'Crisp oceanic surfaces.' })
    case 'blue':
      return i18n._({ id: 'Neutral blue accents.', message: 'Neutral blue accents.' })
    case 'slate':
      return i18n._({ id: 'Cool gray surfaces.', message: 'Cool gray surfaces.' })
    case 'amber':
      return i18n._({ id: 'Warm sand highlights.', message: 'Warm sand highlights.' })
    case 'mint':
      return i18n._({ id: 'Fresh green accents.', message: 'Fresh green accents.' })
    case 'graphite':
      return i18n._({
        id: 'Terminal-green coding surfaces.',
        message: 'Terminal-green coding surfaces.',
      })
    case 'solarized':
      return i18n._({
        id: 'Classic solarized workbench.',
        message: 'Classic solarized workbench.',
      })
    default:
      return ''
  }
}

export function getThreadSpacingLabel(spacing: ThreadSpacing): string {
  switch (spacing) {
    case 'tight':
      return i18n._({ id: 'Tight', message: 'Tight' })
    case 'balanced':
      return i18n._({ id: 'Balanced', message: 'Balanced' })
    case 'relaxed':
      return i18n._({ id: 'Relaxed', message: 'Relaxed' })
    default:
      return spacing
  }
}

export function getThreadSpacingDescription(spacing: ThreadSpacing): string {
  switch (spacing) {
    case 'tight':
      return i18n._({
        id: 'Compress the stream slightly for faster scanning in longer threads.',
        message: 'Compress the stream slightly for faster scanning in longer threads.',
      })
    case 'balanced':
      return i18n._({
        id: 'Keep a little more breathing room between turns.',
        message: 'Keep a little more breathing room between turns.',
      })
    case 'relaxed':
      return i18n._({
        id: 'Open the rhythm up when you want a calmer reading pace.',
        message: 'Open the rhythm up when you want a calmer reading pace.',
      })
    default:
      return ''
  }
}

export function getMessageSurfaceLabel(surface: MessageSurface): string {
  switch (surface) {
    case 'bare':
      return i18n._({ id: 'Bare', message: 'Bare' })
    case 'soft':
      return i18n._({ id: 'Soft', message: 'Soft' })
    case 'layered':
      return i18n._({ id: 'Layered', message: 'Layered' })
    default:
      return surface
  }
}

export function getMessageSurfaceDescription(surface: MessageSurface): string {
  switch (surface) {
    case 'bare':
      return i18n._({
        id: 'Almost no container treatment. The text carries nearly all the weight.',
        message: 'Almost no container treatment. The text carries nearly all the weight.',
      })
    case 'soft':
      return i18n._({
        id: 'A quiet message background that separates turns without feeling card-heavy.',
        message: 'A quiet message background that separates turns without feeling card-heavy.',
      })
    case 'layered':
      return i18n._({
        id: 'Use slightly more padding and surface so message groupings read more clearly.',
        message: 'Use slightly more padding and surface so message groupings read more clearly.',
      })
    default:
      return ''
  }
}

export function getUserMessageEmphasisLabel(emphasis: UserMessageEmphasis): string {
  switch (emphasis) {
    case 'minimal':
      return i18n._({ id: 'Minimal', message: 'Minimal' })
    case 'subtle':
      return i18n._({ id: 'Subtle', message: 'Subtle' })
    case 'accented':
      return i18n._({ id: 'Accented', message: 'Accented' })
    default:
      return emphasis
  }
}

export function getUserMessageEmphasisDescription(emphasis: UserMessageEmphasis): string {
  switch (emphasis) {
    case 'minimal':
      return i18n._({
        id: 'User messages stay only faintly tinted so both sides read almost the same.',
        message: 'User messages stay only faintly tinted so both sides read almost the same.',
      })
    case 'subtle':
      return i18n._({
        id: 'Add a light hint of accent to help your prompts stand out without shouting.',
        message: 'Add a light hint of accent to help your prompts stand out without shouting.',
      })
    case 'accented':
      return i18n._({
        id: 'Use a clearer tint when you want to find your own prompts quickly.',
        message: 'Use a clearer tint when you want to find your own prompts quickly.',
      })
    default:
      return ''
  }
}

export function getAppearancePaletteLabel(
  theme: AccentTone,
  resolvedTheme: ResolvedAppearanceTheme,
): string {
  return `${getColorThemeLabel(theme)} ${resolvedTheme === 'dark' ? i18n._({ id: 'Dark', message: 'Dark' }) : i18n._({ id: 'Light', message: 'Light' })}`
}
