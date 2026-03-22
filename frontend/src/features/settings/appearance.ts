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

export const builtinColorThemeOptions = [
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

export const colorThemeOptions = [
  ...builtinColorThemeOptions,
  {
    value: 'custom',
    swatches: ['#7C6A58', '#D3B79A', '#FAF6F1', '#18120F'],
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
export type BuiltinAccentTone = (typeof builtinColorThemeOptions)[number]['value']
export type AccentTone = (typeof colorThemeOptions)[number]['value']
export type ThreadSpacing = (typeof threadSpacingOptions)[number]['value']
export type MessageSurface = (typeof messageSurfaceOptions)[number]['value']
export type UserMessageEmphasis = (typeof userMessageEmphasisOptions)[number]['value']
export type ResolvedAppearanceTheme = 'light' | 'dark'
export type WorkbenchThemeColorField = 'accent' | 'background' | 'foreground'
export type WorkbenchThemeColors = Record<WorkbenchThemeColorField, string>
export type ThemeColorCustomizations = Record<
  AccentTone,
  Record<ResolvedAppearanceTheme, WorkbenchThemeColors>
>
export type CustomThemeDefinition = {
  id: string
  name: string
  colors: Record<ResolvedAppearanceTheme, WorkbenchThemeColors>
}

export const appearanceColorDefaults = {
  cyan: {
    light: { accent: '#0891B2', background: '#F0FDFA', foreground: '#303744' },
    dark: { accent: '#22D3EE', background: '#0E4455', foreground: '#D8E2EE' },
  },
  blue: {
    light: { accent: '#5271FF', background: '#FCFBFA', foreground: '#303744' },
    dark: { accent: '#6C87FF', background: '#121A24', foreground: '#D8E2EE' },
  },
  slate: {
    light: { accent: '#5A7189', background: '#F8FBFD', foreground: '#303744' },
    dark: { accent: '#84A3C0', background: '#121A23', foreground: '#D8E2EE' },
  },
  amber: {
    light: { accent: '#C77D2A', background: '#FFFAF2', foreground: '#303744' },
    dark: { accent: '#F0A958', background: '#1B1510', foreground: '#D8E2EE' },
  },
  mint: {
    light: { accent: '#1F9D7A', background: '#F7FCFA', foreground: '#303744' },
    dark: { accent: '#4EC7A0', background: '#0D1B17', foreground: '#D8E2EE' },
  },
  graphite: {
    light: { accent: '#1F9D68', background: '#F7FAFC', foreground: '#303744' },
    dark: { accent: '#2FBF71', background: '#11161D', foreground: '#D0D7DE' },
  },
  solarized: {
    light: { accent: '#2AA198', background: '#FDF6E3', foreground: '#586E75' },
    dark: { accent: '#2AA198', background: '#002B36', foreground: '#93A1A1' },
  },
  custom: {
    light: { accent: '#7C6A58', background: '#FAF6F1', foreground: '#362E29' },
    dark: { accent: '#D3B79A', background: '#18120F', foreground: '#F1E7DD' },
  },
} as const satisfies ThemeColorCustomizations

type PartialThemeColorCustomizations = Partial<
  Record<AccentTone, Partial<Record<ResolvedAppearanceTheme, Partial<WorkbenchThemeColors>>>>
>

export function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return appearanceThemeOptions.some((option) => option.value === value)
}

export function normalizeAppearanceTheme(value: unknown): AppearanceTheme {
  return isAppearanceTheme(value) ? value : 'system'
}

export function isAccentTone(value: unknown): value is AccentTone {
  return colorThemeOptions.some((option) => option.value === value)
}

export function normalizeAccentTone(value: unknown): AccentTone {
  return isAccentTone(value) ? value : 'blue'
}

export function getThemeColorCustomizationPalette(
  customizations: ThemeColorCustomizations | PartialThemeColorCustomizations,
  theme: unknown,
): Record<ResolvedAppearanceTheme, WorkbenchThemeColors> {
  const normalizedTheme = normalizeAccentTone(theme)
  const palette = customizations[normalizedTheme]

  return {
    light: {
      ...appearanceColorDefaults[normalizedTheme].light,
      ...(palette?.light ?? {}),
    },
    dark: {
      ...appearanceColorDefaults[normalizedTheme].dark,
      ...(palette?.dark ?? {}),
    },
  }
}

export function getThemeColorCustomization(
  customizations: ThemeColorCustomizations | PartialThemeColorCustomizations,
  theme: unknown,
  resolvedTheme: ResolvedAppearanceTheme,
): WorkbenchThemeColors {
  return getThemeColorCustomizationPalette(customizations, theme)[resolvedTheme]
}

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
    case 'custom':
      return i18n._({ id: 'Custom', message: 'Custom' })
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
    case 'custom':
      return i18n._({
        id: 'Your editable palette.',
        message: 'Your editable palette.',
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

export function getAppearanceColorDefaults(
  theme: AccentTone,
  resolvedTheme: ResolvedAppearanceTheme,
): WorkbenchThemeColors {
  return appearanceColorDefaults[normalizeAccentTone(theme)][resolvedTheme]
}

export function cloneWorkbenchThemeColors(
  colors: Record<ResolvedAppearanceTheme, WorkbenchThemeColors>,
): Record<ResolvedAppearanceTheme, WorkbenchThemeColors> {
  return {
    light: { ...colors.light },
    dark: { ...colors.dark },
  }
}

export function isBuiltInColorTheme(theme: AccentTone): theme is BuiltinAccentTone {
  return theme !== 'custom'
}

export function areWorkbenchThemeColorsEqual(
  left: WorkbenchThemeColors,
  right: WorkbenchThemeColors,
) {
  return (
    left.accent === right.accent &&
    left.background === right.background &&
    left.foreground === right.foreground
  )
}

export function createThemeColorCustomizations(
  seed?: PartialThemeColorCustomizations,
): ThemeColorCustomizations {
  return colorThemeOptions.reduce<ThemeColorCustomizations>((customizations, option) => {
    customizations[option.value] = {
      light: {
        ...appearanceColorDefaults[option.value].light,
        ...(seed?.[option.value]?.light ?? {}),
      },
      dark: {
        ...appearanceColorDefaults[option.value].dark,
        ...(seed?.[option.value]?.dark ?? {}),
      },
    }

    return customizations
  }, {} as ThemeColorCustomizations)
}

export function createLegacyThemeColorCustomizations(colors: Record<ResolvedAppearanceTheme, WorkbenchThemeColors>) {
  return colorThemeOptions.reduce<ThemeColorCustomizations>((customizations, option) => {
    customizations[option.value] = {
      light: { ...colors.light },
      dark: { ...colors.dark },
    }

    return customizations
  }, {} as ThemeColorCustomizations)
}

export function normalizeThemeColorCustomizations(
  value: unknown,
): ThemeColorCustomizations {
  if (!value || typeof value !== 'object') {
    return createThemeColorCustomizations()
  }

  return createThemeColorCustomizations(value as PartialThemeColorCustomizations)
}

export function getColorThemeSwatches(
  theme: AccentTone,
  customizations: ThemeColorCustomizations,
) {
  return getWorkbenchThemeSwatches(getThemeColorCustomizationPalette(customizations, theme))
}

export function getWorkbenchThemeSwatches(
  colors: Record<ResolvedAppearanceTheme, WorkbenchThemeColors>,
) {
  return [
    colors.light.accent,
    colors.dark.accent,
    colors.light.background,
    colors.dark.background,
  ]
}

export function hasThemeColorCustomizationOverrides(
  customizations: ThemeColorCustomizations,
) {
  return colorThemeOptions.some((option) => {
    const theme = option.value
    const themeColors = getThemeColorCustomizationPalette(customizations, theme)

    return (
      !areWorkbenchThemeColorsEqual(themeColors.light, appearanceColorDefaults[theme].light) ||
      !areWorkbenchThemeColorsEqual(themeColors.dark, appearanceColorDefaults[theme].dark)
    )
  })
}

export function withThemeColorCustomization(
  customizations: ThemeColorCustomizations,
  theme: AccentTone,
  mode: ResolvedAppearanceTheme,
  field: WorkbenchThemeColorField,
  value: string,
): ThemeColorCustomizations {
  const themeColors = getThemeColorCustomizationPalette(customizations, theme)

  return {
    ...customizations,
    [theme]: {
      ...themeColors,
      [mode]: {
        ...themeColors[mode],
        [field]: value,
      },
    },
  }
}

export function resetThemeColorCustomization(
  customizations: ThemeColorCustomizations,
  theme: AccentTone,
  mode?: ResolvedAppearanceTheme,
): ThemeColorCustomizations {
  const themeColors = getThemeColorCustomizationPalette(customizations, theme)

  if (mode) {
    return {
      ...customizations,
      [theme]: {
        ...themeColors,
        [mode]: { ...appearanceColorDefaults[theme][mode] },
      },
    }
  }

  return {
    ...customizations,
    [theme]: {
      light: { ...appearanceColorDefaults[theme].light },
      dark: { ...appearanceColorDefaults[theme].dark },
    },
  }
}

export function copyThemeColorCustomizationPalette(
  customizations: ThemeColorCustomizations,
  sourceTheme: AccentTone,
  targetTheme: AccentTone,
): ThemeColorCustomizations {
  const sourceThemeColors = getThemeColorCustomizationPalette(customizations, sourceTheme)

  return {
    ...customizations,
    [targetTheme]: {
      light: { ...sourceThemeColors.light },
      dark: { ...sourceThemeColors.dark },
    },
  }
}

export function createCustomThemeDefinition(
  id: string,
  name: string,
  colors?: Record<ResolvedAppearanceTheme, WorkbenchThemeColors>,
): CustomThemeDefinition {
  return {
    id,
    name,
    colors: cloneWorkbenchThemeColors(colors ?? appearanceColorDefaults.custom),
  }
}
