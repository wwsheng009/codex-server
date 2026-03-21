export const appearanceThemeOptions = [
  {
    value: 'system',
    label: 'System',
    description: 'Follow the operating system light or dark preference.',
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Keep the shell bright with layered surfaces and soft contrast.',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Shift the shell to a darker workbench for long sessions.',
  },
] as const

export const colorThemeOptions = [
  {
    value: 'blue',
    label: 'Cobalt',
    description: 'Neutral shell with a crisp blue accent.',
    swatches: ['#5271FF', '#8AA0FF', '#f6f2ee', '#fcfbfa'],
  },
  {
    value: 'slate',
    label: 'Slate',
    description: 'Cool gray surfaces with restrained contrast.',
    swatches: ['#5a7189', '#93a9bf', '#f3f6f8', '#f8fbfd'],
  },
  {
    value: 'amber',
    label: 'Amber',
    description: 'Warmer sand surfaces with editorial highlights.',
    swatches: ['#c77d2a', '#efb36b', '#fbf4e9', '#fffaf2'],
  },
  {
    value: 'mint',
    label: 'Mint',
    description: 'Fresh green-cyan accents with softer panels.',
    swatches: ['#1f9d7a', '#6ccfb3', '#edf7f3', '#f7fcfa'],
  },
  {
    value: 'graphite',
    label: 'Graphite',
    description: 'Coding-focused graphite surfaces with terminal-green accents.',
    swatches: ['#1f9d68', '#63d29c', '#eef3f6', '#0d1117'],
  },
  {
    value: 'solarized',
    label: 'Solarized',
    description: 'Classic Solarized tones that adapt cleanly to light and dark workbenches.',
    swatches: ['#2aa198', '#268bd2', '#fdf6e3', '#002b36'],
  },
] as const

export const threadSpacingOptions = [
  {
    value: 'tight',
    label: 'Tight',
    description: 'Compress the stream slightly for faster scanning in longer threads.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Keep a little more breathing room between turns.',
  },
  {
    value: 'relaxed',
    label: 'Relaxed',
    description: 'Open the rhythm up when you want a calmer reading pace.',
  },
] as const

export const messageSurfaceOptions = [
  {
    value: 'bare',
    label: 'Bare',
    description: 'Almost no container treatment. The text carries nearly all the weight.',
  },
  {
    value: 'soft',
    label: 'Soft',
    description: 'A quiet message background that separates turns without feeling card-heavy.',
  },
  {
    value: 'layered',
    label: 'Layered',
    description: 'Use slightly more padding and surface so message groupings read more clearly.',
  },
] as const

export const userMessageEmphasisOptions = [
  {
    value: 'minimal',
    label: 'Minimal',
    description: 'User messages stay only faintly tinted so both sides read almost the same.',
  },
  {
    value: 'subtle',
    label: 'Subtle',
    description: 'Add a light hint of accent to help your prompts stand out without shouting.',
  },
  {
    value: 'accented',
    label: 'Accented',
    description: 'Use a clearer tint when you want to find your own prompts quickly.',
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
  return appearanceThemeOptions.find((option) => option.value === theme)?.label ?? theme
}

export function getColorThemeLabel(theme: AccentTone): string {
  return colorThemeOptions.find((option) => option.value === theme)?.label ?? theme
}

export function getThreadSpacingLabel(spacing: ThreadSpacing): string {
  return threadSpacingOptions.find((option) => option.value === spacing)?.label ?? spacing
}

export function getMessageSurfaceLabel(surface: MessageSurface): string {
  return messageSurfaceOptions.find((option) => option.value === surface)?.label ?? surface
}

export function getUserMessageEmphasisLabel(emphasis: UserMessageEmphasis): string {
  return userMessageEmphasisOptions.find((option) => option.value === emphasis)?.label ?? emphasis
}

export function getAppearancePaletteLabel(
  theme: AccentTone,
  resolvedTheme: ResolvedAppearanceTheme,
): string {
  return `${getColorThemeLabel(theme)} ${resolvedTheme === 'dark' ? 'Dark' : 'Light'}`
}
