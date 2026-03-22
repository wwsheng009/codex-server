import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type {
  AccentTone,
  AppearanceTheme,
  MessageSurface,
  ThreadSpacing,
  UserMessageEmphasis,
} from './appearance'
import { sourceLocale, type AppLocale } from '../../i18n/config'

type DensityMode = 'comfortable' | 'compact'
type ResponseTone = 'balanced' | 'direct' | 'detailed'

type SettingsLocalState = {
  locale: AppLocale
  theme: AppearanceTheme
  density: DensityMode
  reduceMotion: boolean
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
  // New Theme Customization Fields
  accentColorLight: string
  accentColorDark: string
  backgroundColorLight: string
  backgroundColorDark: string
  foregroundColorLight: string
  foregroundColorDark: string
  uiFont: string
  codeFont: string
  uiFontSize: number
  codeFontSize: number
  translucentSidebar: boolean
  contrast: number
  usePointerCursor: boolean
  useCustomColors: boolean
  setLocale: (locale: AppLocale) => void
  setTheme: (theme: AppearanceTheme) => void
  setDensity: (density: DensityMode) => void
  setReduceMotion: (reduceMotion: boolean) => void
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
  // New Theme Customization Setters
  setAccentColorLight: (color: string) => void
  setAccentColorDark: (color: string) => void
  setBackgroundColorLight: (color: string) => void
  setBackgroundColorDark: (color: string) => void
  setForegroundColorLight: (color: string) => void
  setForegroundColorDark: (color: string) => void
  setUiFont: (font: string) => void
  setCodeFont: (font: string) => void
  setUiFontSize: (size: number) => void
  setCodeFontSize: (size: number) => void
  setTranslucentSidebar: (enabled: boolean) => void
  setContrast: (value: number) => void
  setUsePointerCursor: (enabled: boolean) => void
  setUseCustomColors: (enabled: boolean) => void
}

export const useSettingsLocalStore = create<SettingsLocalState>()(
  persist(
    (set) => ({
      locale: sourceLocale,
      theme: 'system',
      density: 'comfortable',
      reduceMotion: false,
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
      // Initial Theme Customization Values
      accentColorLight: '#0969DA',
      accentColorDark: '#6C87FF',
      backgroundColorLight: '#FFFFFF',
      backgroundColorDark: '#121a24',
      foregroundColorLight: '#1F2328',
      foregroundColorDark: '#d8e2ee',
      uiFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      codeFont: "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Segoe UI Mono', monospace",
      uiFontSize: 13,
      codeFontSize: 12,
      translucentSidebar: true,
      contrast: 45,
      usePointerCursor: false,
      useCustomColors: false,
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      setDensity: (density) => set({ density }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setAccentTone: (accentTone) => set({ accentTone }),
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
      // New Theme Customization Setters Implementation
      setAccentColorLight: (accentColorLight) => set({ accentColorLight, useCustomColors: true }),
      setAccentColorDark: (accentColorDark) => set({ accentColorDark, useCustomColors: true }),
      setBackgroundColorLight: (backgroundColorLight) => set({ backgroundColorLight, useCustomColors: true }),
      setBackgroundColorDark: (backgroundColorDark) => set({ backgroundColorDark, useCustomColors: true }),
      setForegroundColorLight: (foregroundColorLight) => set({ foregroundColorLight, useCustomColors: true }),
      setForegroundColorDark: (foregroundColorDark) => set({ foregroundColorDark, useCustomColors: true }),
      setUiFont: (uiFont) => set({ uiFont }),
      setCodeFont: (codeFont) => set({ codeFont }),
      setUiFontSize: (uiFontSize) => set({ uiFontSize }),
      setCodeFontSize: (codeFontSize) => set({ codeFontSize }),
      setTranslucentSidebar: (translucentSidebar) => set({ translucentSidebar }),
      setContrast: (contrast) => set({ contrast }),
      setUsePointerCursor: (usePointerCursor) => set({ usePointerCursor }),
      setUseCustomColors: (useCustomColors) => set({ useCustomColors }),
    }),
    {
      name: 'codex-server-settings-local-store',
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
)
