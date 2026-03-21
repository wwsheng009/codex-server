import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type {
  AccentTone,
  AppearanceTheme,
  MessageSurface,
  ThreadSpacing,
  UserMessageEmphasis,
} from './appearance'

type DensityMode = 'comfortable' | 'compact'
type ResponseTone = 'balanced' | 'direct' | 'detailed'

type SettingsLocalState = {
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
}

export const useSettingsLocalStore = create<SettingsLocalState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'codex-server-settings-local-store',
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
)
