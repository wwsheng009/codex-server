import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import {
  cloneWorkbenchThemeColors,
  copyThemeColorCustomizationPalette,
  createLegacyThemeColorCustomizations,
  createCustomThemeDefinition,
  createThemeColorCustomizations,
  hasThemeColorCustomizationOverrides,
  normalizeAccentTone,
  normalizeAppearanceTheme,
  normalizeMotionPreference,
  normalizeThemeColorCustomizations,
  resetThemeColorCustomization,
  withThemeColorCustomization,
  type AccentTone,
  type AppearanceTheme,
  type CustomThemeDefinition,
  type MessageSurface,
  type MotionPreference,
  type ResolvedAppearanceTheme,
  type ThemeColorCustomizations,
  type ThreadSpacing,
  type UserMessageEmphasis,
  type WorkbenchThemeColorField,
  type WorkbenchThemeColors,
} from './appearance'
import { sourceLocale, type AppLocale } from '../../i18n/config'

type DensityMode = 'comfortable' | 'compact'
type ResponseTone = 'balanced' | 'direct' | 'detailed'
export type TerminalRendererPreference = 'auto' | 'webgl' | 'dom'

type SettingsLocalValues = {
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

type SettingsLocalActions = {
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

type SettingsLocalState = SettingsLocalValues & SettingsLocalActions

type LegacyPersistedSettingsState = Partial<SettingsLocalValues> & {
  reduceMotion?: boolean
  accentColorLight?: string
  accentColorDark?: string
  backgroundColorLight?: string
  backgroundColorDark?: string
  foregroundColorLight?: string
  foregroundColorDark?: string
  themeColorCustomizations?: unknown
}

const legacyBlueLightColors: WorkbenchThemeColors = {
  accent: '#0969DA',
  background: '#FFFFFF',
  foreground: '#1F2328',
}

const legacyBlueDarkColors: WorkbenchThemeColors = {
  accent: '#6C87FF',
  background: '#121A24',
  foreground: '#D8E2EE',
}

function createCustomThemeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `custom-theme-${Math.random().toString(36).slice(2, 10)}`
}

function buildCustomThemeName(customThemes: CustomThemeDefinition[]) {
  let index = customThemes.length + 1

  while (customThemes.some((theme) => theme.name === `Custom Theme ${index}`)) {
    index += 1
  }

  return `Custom Theme ${index}`
}

function applyActiveCustomThemeToWorkingCopy(
  themeColorCustomizations: ThemeColorCustomizations,
  customThemes: CustomThemeDefinition[],
  activeCustomThemeId: string,
) {
  const activeCustomTheme =
    customThemes.find((theme) => theme.id === activeCustomThemeId) ?? customThemes[0]

  if (!activeCustomTheme) {
    return themeColorCustomizations
  }

  return {
    ...themeColorCustomizations,
    custom: cloneWorkbenchThemeColors(activeCustomTheme.colors),
  }
}

function resolvePersistedCustomThemes(
  state: LegacyPersistedSettingsState,
  themeColorCustomizations: ThemeColorCustomizations,
) {
  const persistedCustomThemes = Array.isArray(state.customThemes)
    ? state.customThemes.filter(
        (theme): theme is CustomThemeDefinition =>
          Boolean(
            theme &&
              typeof theme === 'object' &&
              typeof theme.id === 'string' &&
              typeof theme.name === 'string' &&
              theme.colors &&
              typeof theme.colors === 'object',
          ),
      )
    : []

  if (persistedCustomThemes.length > 0) {
    const customThemes = persistedCustomThemes.map((theme) =>
      createCustomThemeDefinition(theme.id, theme.name, theme.colors),
    )
    const activeCustomThemeId =
      typeof state.activeCustomThemeId === 'string' &&
      customThemes.some((theme) => theme.id === state.activeCustomThemeId)
        ? state.activeCustomThemeId
        : customThemes[0].id

    return {
      customThemes,
      activeCustomThemeId,
    }
  }

  const initialCustomTheme = createCustomThemeDefinition(
    createCustomThemeId(),
    'Custom Theme 1',
    themeColorCustomizations.custom,
  )

  return {
    customThemes: [initialCustomTheme],
    activeCustomThemeId: initialCustomTheme.id,
  }
}

function hasLegacyThemeCustomizationFields(state: LegacyPersistedSettingsState) {
  return [
    state.accentColorLight,
    state.accentColorDark,
    state.backgroundColorLight,
    state.backgroundColorDark,
    state.foregroundColorLight,
    state.foregroundColorDark,
  ].some((value) => typeof value === 'string' && value.length > 0)
}

function resolvePersistedThemeColorCustomizations(state: LegacyPersistedSettingsState) {
  if (state.themeColorCustomizations) {
    return normalizeThemeColorCustomizations(state.themeColorCustomizations)
  }

  if (!hasLegacyThemeCustomizationFields(state)) {
    return createThemeColorCustomizations()
  }

  return createLegacyThemeColorCustomizations({
    light: {
      accent: state.accentColorLight ?? legacyBlueLightColors.accent,
      background: state.backgroundColorLight ?? legacyBlueLightColors.background,
      foreground: state.foregroundColorLight ?? legacyBlueLightColors.foreground,
    },
    dark: {
      accent: state.accentColorDark ?? legacyBlueDarkColors.accent,
      background: state.backgroundColorDark ?? legacyBlueDarkColors.background,
      foreground: state.foregroundColorDark ?? legacyBlueDarkColors.foreground,
    },
  })
}

function normalizePersistedSettingsState(
  persistedState: LegacyPersistedSettingsState | undefined,
): Partial<SettingsLocalValues> {
  const state = persistedState ?? {}
  const {
    accentColorLight: _accentColorLight,
    accentColorDark: _accentColorDark,
    backgroundColorLight: _backgroundColorLight,
    backgroundColorDark: _backgroundColorDark,
    foregroundColorLight: _foregroundColorLight,
    foregroundColorDark: _foregroundColorDark,
    reduceMotion: _reduceMotion,
    themeColorCustomizations: _themeColorCustomizations,
    ...rest
  } = state
  const themeColorCustomizations = resolvePersistedThemeColorCustomizations(state)
  const { customThemes, activeCustomThemeId } = resolvePersistedCustomThemes(
    state,
    themeColorCustomizations,
  )
  const normalizedThemeColorCustomizations = applyActiveCustomThemeToWorkingCopy(
    themeColorCustomizations,
    customThemes,
    activeCustomThemeId,
  )

  return {
    ...rest,
    theme: normalizeAppearanceTheme(state.theme),
    motionPreference: normalizeMotionPreference(
      state.motionPreference ?? (state.reduceMotion === true ? 'reduce' : 'system'),
    ),
    accentTone: normalizeAccentTone(state.accentTone),
    themeColorCustomizations: normalizedThemeColorCustomizations,
    customThemes,
    activeCustomThemeId,
    useCustomColors:
      typeof state.useCustomColors === 'boolean'
        ? state.useCustomColors
        : hasThemeColorCustomizationOverrides(normalizedThemeColorCustomizations),
  }
}

export const useSettingsLocalStore = create<SettingsLocalState>()(
  persist(
    (set) => {
      const initialCustomTheme = createCustomThemeDefinition(createCustomThemeId(), 'Custom Theme 1')

      return {
        locale: sourceLocale,
        theme: 'system',
        density: 'comfortable',
        motionPreference: 'system',
        accentTone: 'blue',
        threadSpacing: 'tight',
        messageSurface: 'soft',
        userMessageEmphasis: 'minimal',
        responseTone: 'balanced',
        customInstructions: '',
        gitCommitTemplate: 'Summarize code changes, user-visible impact, and follow-up risks.',
        gitPullRequestTemplate: 'Problem\n\nSolution\n\nVerification\n',
        confirmGitActions: true,
        maxWorktrees: 4,
        autoPruneDays: 14,
        reuseBranches: true,
        themeColorCustomizations: {
          ...createThemeColorCustomizations(),
          custom: cloneWorkbenchThemeColors(initialCustomTheme.colors),
        },
        customThemes: [initialCustomTheme],
        activeCustomThemeId: initialCustomTheme.id,
        uiFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        codeFont: "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Segoe UI Mono', monospace",
        terminalFont: "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Segoe UI Mono', monospace",
        uiFontSize: 13,
        codeFontSize: 12,
        terminalFontSize: 13,
        terminalLineHeight: 1,
        terminalRenderer: 'auto',
        translucentSidebar: true,
        contrast: 45,
        usePointerCursor: false,
        useCustomColors: false,
        setLocale: (locale) => set({ locale }),
        setTheme: (theme) => set({ theme: normalizeAppearanceTheme(theme) }),
        setDensity: (density) => set({ density }),
        setMotionPreference: (motionPreference) =>
          set({ motionPreference: normalizeMotionPreference(motionPreference) }),
        setAccentTone: (accentTone) =>
          set((state) => {
          const nextAccentTone = normalizeAccentTone(accentTone)

          if (nextAccentTone !== 'custom') {
            return { accentTone: nextAccentTone }
          }

          const themeColorCustomizations = applyActiveCustomThemeToWorkingCopy(
            state.themeColorCustomizations,
            state.customThemes,
            state.activeCustomThemeId,
          )

          return {
            accentTone: nextAccentTone,
            themeColorCustomizations,
            useCustomColors: hasThemeColorCustomizationOverrides(themeColorCustomizations),
          }
          }),
        setThreadSpacing: (threadSpacing) => set({ threadSpacing }),
        setMessageSurface: (messageSurface) => set({ messageSurface }),
        setUserMessageEmphasis: (userMessageEmphasis) => set({ userMessageEmphasis }),
        setResponseTone: (responseTone) => set({ responseTone }),
        setCustomInstructions: (customInstructions) => set({ customInstructions }),
        setGitCommitTemplate: (gitCommitTemplate) => set({ gitCommitTemplate }),
        setGitPullRequestTemplate: (gitPullRequestTemplate) => set({ gitPullRequestTemplate }),
        setConfirmGitActions: (confirmGitActions) => set({ confirmGitActions }),
        setMaxWorktrees: (maxWorktrees) => set({ maxWorktrees }),
        setAutoPruneDays: (autoPruneDays) => set({ autoPruneDays }),
        setReuseBranches: (reuseBranches) => set({ reuseBranches }),
        setThemeColorCustomization: (accentTone, mode, field, value) =>
          set((state) => {
          let themeColorCustomizations = withThemeColorCustomization(
            state.themeColorCustomizations,
            accentTone,
            mode,
            field,
            value,
          )
          const customThemes =
            accentTone === 'custom'
              ? state.customThemes.map((theme) =>
                  theme.id === state.activeCustomThemeId
                    ? {
                        ...theme,
                        colors: {
                          ...theme.colors,
                          [mode]: {
                            ...theme.colors[mode],
                            [field]: value,
                          },
                        },
                      }
                    : theme,
                )
              : state.customThemes

          if (accentTone === 'custom') {
            themeColorCustomizations = applyActiveCustomThemeToWorkingCopy(
              themeColorCustomizations,
              customThemes,
              state.activeCustomThemeId,
            )
          }

          return {
            themeColorCustomizations,
            customThemes,
            useCustomColors: hasThemeColorCustomizationOverrides(themeColorCustomizations),
          }
          }),
      selectCustomTheme: (themeId) =>
        set((state) => {
          if (!state.customThemes.some((theme) => theme.id === themeId)) {
            return state
          }

          const themeColorCustomizations = applyActiveCustomThemeToWorkingCopy(
            state.themeColorCustomizations,
            state.customThemes,
            themeId,
          )

          return {
            accentTone: 'custom',
            activeCustomThemeId: themeId,
            themeColorCustomizations,
            useCustomColors: hasThemeColorCustomizationOverrides(themeColorCustomizations),
          }
        }),
      createCustomTheme: (name, sourceAccentTone = 'custom') => {
        const themeId = createCustomThemeId()

        set((state) => {
          const nextName = name?.trim() || buildCustomThemeName(state.customThemes)
          const sourceColors =
            sourceAccentTone === 'custom'
              ? state.themeColorCustomizations.custom
              : state.themeColorCustomizations[sourceAccentTone]
          const nextTheme = createCustomThemeDefinition(themeId, nextName, sourceColors)
          const customThemes = [...state.customThemes, nextTheme]
          const themeColorCustomizations = {
            ...state.themeColorCustomizations,
            custom: cloneWorkbenchThemeColors(nextTheme.colors),
          }

          return {
            accentTone: 'custom',
            customThemes,
            activeCustomThemeId: themeId,
            themeColorCustomizations,
            useCustomColors: hasThemeColorCustomizationOverrides(themeColorCustomizations),
          }
        })

        return themeId
      },
      renameCustomTheme: (themeId, name) =>
        set((state) => ({
          customThemes: state.customThemes.map((theme) =>
            theme.id === themeId
              ? {
                  ...theme,
                  name: name.trim() || theme.name,
                }
              : theme,
          ),
        })),
      deleteCustomTheme: (themeId) =>
        set((state) => {
          const remainingThemes = state.customThemes.filter((theme) => theme.id !== themeId)

          if (remainingThemes.length === 0) {
            const fallbackTheme = createCustomThemeDefinition(createCustomThemeId(), 'Custom Theme 1')
            const fallbackCustomizations = {
              ...state.themeColorCustomizations,
              custom: cloneWorkbenchThemeColors(fallbackTheme.colors),
            }

            return {
              accentTone: state.accentTone === 'custom' ? 'blue' : state.accentTone,
              customThemes: [fallbackTheme],
              activeCustomThemeId: fallbackTheme.id,
              themeColorCustomizations: fallbackCustomizations,
              useCustomColors: hasThemeColorCustomizationOverrides(fallbackCustomizations),
            }
          }

          const nextActiveCustomThemeId =
            state.activeCustomThemeId === themeId ? remainingThemes[0].id : state.activeCustomThemeId
          const themeColorCustomizations = applyActiveCustomThemeToWorkingCopy(
            state.themeColorCustomizations,
            remainingThemes,
            nextActiveCustomThemeId,
          )

          return {
            customThemes: remainingThemes,
            activeCustomThemeId: nextActiveCustomThemeId,
            themeColorCustomizations,
            useCustomColors: hasThemeColorCustomizationOverrides(themeColorCustomizations),
          }
        }),
      resetThemePaletteCustomization: (accentTone, mode) =>
        set((state) => {
          let themeColorCustomizations = resetThemeColorCustomization(
            state.themeColorCustomizations,
            accentTone,
            mode,
          )
          const customThemes =
            accentTone === 'custom'
              ? state.customThemes.map((theme) =>
                  theme.id === state.activeCustomThemeId
                    ? {
                        ...theme,
                        colors: mode
                          ? {
                              ...theme.colors,
                              [mode]: { ...themeColorCustomizations.custom[mode] },
                            }
                          : cloneWorkbenchThemeColors(themeColorCustomizations.custom),
                      }
                    : theme,
                )
              : state.customThemes

          if (accentTone === 'custom') {
            themeColorCustomizations = applyActiveCustomThemeToWorkingCopy(
              themeColorCustomizations,
              customThemes,
              state.activeCustomThemeId,
            )
          }

          return {
            themeColorCustomizations,
            customThemes,
            useCustomColors: hasThemeColorCustomizationOverrides(themeColorCustomizations),
          }
        }),
      copyThemePaletteCustomization: (sourceAccentTone, targetAccentTone) =>
        set((state) => {
          let themeColorCustomizations = copyThemeColorCustomizationPalette(
            state.themeColorCustomizations,
            sourceAccentTone,
            targetAccentTone,
          )
          const customThemes =
            targetAccentTone === 'custom'
              ? state.customThemes.map((theme) =>
                  theme.id === state.activeCustomThemeId
                    ? {
                        ...theme,
                        colors: cloneWorkbenchThemeColors(themeColorCustomizations.custom),
                      }
                    : theme,
                )
              : state.customThemes

          if (targetAccentTone === 'custom') {
            themeColorCustomizations = applyActiveCustomThemeToWorkingCopy(
              themeColorCustomizations,
              customThemes,
              state.activeCustomThemeId,
            )
          }

          return {
            themeColorCustomizations,
            customThemes,
            useCustomColors: hasThemeColorCustomizationOverrides(themeColorCustomizations),
          }
        }),
      setUiFont: (uiFont) => set({ uiFont }),
      setCodeFont: (codeFont) => set({ codeFont }),
      setTerminalFont: (terminalFont) => set({ terminalFont }),
      setUiFontSize: (uiFontSize) => set({ uiFontSize }),
      setCodeFontSize: (codeFontSize) => set({ codeFontSize }),
      setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
      setTerminalLineHeight: (terminalLineHeight) => set({ terminalLineHeight }),
      setTerminalRenderer: (terminalRenderer) => set({ terminalRenderer }),
      setTranslucentSidebar: (translucentSidebar) => set({ translucentSidebar }),
      setContrast: (contrast) => set({ contrast }),
      setUsePointerCursor: (usePointerCursor) => set({ usePointerCursor }),
        setUseCustomColors: (useCustomColors) => set({ useCustomColors }),
      }
    },
    {
      name: 'codex-server-settings-local-store',
      version: 4,
      migrate: (persistedState) => {
        return normalizePersistedSettingsState(persistedState as LegacyPersistedSettingsState)
      },
      merge: (persistedState, currentState) => {
        return {
          ...currentState,
          ...normalizePersistedSettingsState(persistedState as LegacyPersistedSettingsState),
        }
      },
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
)
