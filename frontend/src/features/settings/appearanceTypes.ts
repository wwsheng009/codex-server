import {
  appearanceThemeOptions,
  builtinColorThemeOptions,
  colorThemeOptions,
  messageSurfaceOptions,
  motionPreferenceOptions,
  threadSpacingOptions,
  userMessageEmphasisOptions,
} from './appearance'

export type AppearanceTheme = (typeof appearanceThemeOptions)[number]['value']
export type MotionPreference = (typeof motionPreferenceOptions)[number]['value']
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
export type PartialThemeColorCustomizations = Partial<
  Record<AccentTone, Partial<Record<ResolvedAppearanceTheme, Partial<WorkbenchThemeColors>>>>
>
