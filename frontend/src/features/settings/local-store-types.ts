import type { AppLocale } from '../../i18n/configTypes'
import type {
  AccentTone,
  AppearanceTheme,
  CustomThemeDefinition,
  MessageSurface,
  MotionPreference,
  ResolvedAppearanceTheme,
  ThemeColorCustomizations,
  ThreadSpacing,
  UserMessageEmphasis,
  WorkbenchThemeColorField,
  WorkbenchThemeColors,
} from './appearanceTypes'

export type DensityMode = 'comfortable' | 'compact'
export type ResponseTone = 'balanced' | 'direct' | 'detailed'
export type TerminalRendererPreference = 'auto' | 'webgl' | 'dom'

export type SettingsLocalValues = {
  locale: AppLocale
  theme: AppearanceTheme
  density: DensityMode
  motionPreference: MotionPreference
  accentTone: AccentTone
  threadSpacing: ThreadSpacing
  messageSurface: MessageSurface
  userMessageEmphasis: UserMessageEmphasis
  responseTone: ResponseTone
  customInstructions: string
  gitCommitTemplate: string
  gitPullRequestTemplate: string
  confirmGitActions: boolean
  maxWorktrees: number
  autoPruneDays: number
  reuseBranches: boolean
  themeColorCustomizations: ThemeColorCustomizations
  customThemes: CustomThemeDefinition[]
  activeCustomThemeId: string
  uiFont: string
  codeFont: string
  terminalFont: string
  uiFontSize: number
  codeFontSize: number
  terminalFontSize: number
  terminalLineHeight: number
  terminalRenderer: TerminalRendererPreference
  translucentSidebar: boolean
  contrast: number
  usePointerCursor: boolean
  useCustomColors: boolean
}

export type SettingsLocalActions = {
  setLocale: (locale: AppLocale) => void
  setTheme: (theme: AppearanceTheme) => void
  setDensity: (density: DensityMode) => void
  setMotionPreference: (motionPreference: MotionPreference) => void
  setAccentTone: (accentTone: AccentTone) => void
  setThreadSpacing: (threadSpacing: ThreadSpacing) => void
  setMessageSurface: (messageSurface: MessageSurface) => void
  setUserMessageEmphasis: (userMessageEmphasis: UserMessageEmphasis) => void
  setResponseTone: (responseTone: ResponseTone) => void
  setCustomInstructions: (customInstructions: string) => void
  setGitCommitTemplate: (gitCommitTemplate: string) => void
  setGitPullRequestTemplate: (gitPullRequestTemplate: string) => void
  setConfirmGitActions: (confirmGitActions: boolean) => void
  setMaxWorktrees: (maxWorktrees: number) => void
  setAutoPruneDays: (autoPruneDays: number) => void
  setReuseBranches: (reuseBranches: boolean) => void
  setThemeColorCustomization: (
    accentTone: AccentTone,
    mode: ResolvedAppearanceTheme,
    field: WorkbenchThemeColorField,
    value: string,
  ) => void
  selectCustomTheme: (themeId: string) => void
  createCustomTheme: (name?: string, sourceAccentTone?: AccentTone) => string
  renameCustomTheme: (themeId: string, name: string) => void
  deleteCustomTheme: (themeId: string) => void
  resetThemePaletteCustomization: (accentTone: AccentTone, mode?: ResolvedAppearanceTheme) => void
  copyThemePaletteCustomization: (sourceAccentTone: AccentTone, targetAccentTone: AccentTone) => void
  setUiFont: (font: string) => void
  setCodeFont: (font: string) => void
  setTerminalFont: (font: string) => void
  setUiFontSize: (size: number) => void
  setCodeFontSize: (size: number) => void
  setTerminalFontSize: (size: number) => void
  setTerminalLineHeight: (value: number) => void
  setTerminalRenderer: (value: TerminalRendererPreference) => void
  setTranslucentSidebar: (enabled: boolean) => void
  setContrast: (value: number) => void
  setUsePointerCursor: (enabled: boolean) => void
  setUseCustomColors: (enabled: boolean) => void
}

export type SettingsLocalState = SettingsLocalValues & SettingsLocalActions

export type LegacyPersistedSettingsState = Partial<SettingsLocalValues> & {
  reduceMotion?: boolean
  accentColorLight?: string
  accentColorDark?: string
  backgroundColorLight?: string
  backgroundColorDark?: string
  foregroundColorLight?: string
  foregroundColorDark?: string
  themeColorCustomizations?: unknown
}

export type LegacyWorkbenchThemePair = {
  dark: WorkbenchThemeColors
  light: WorkbenchThemeColors
}
