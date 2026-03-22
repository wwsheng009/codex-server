import type { MutableRefObject } from 'react'

import type { ContextCompactionFeedback } from './threadPageComposerShared'

export type ThreadPageEffectsInput = {
  activePendingTurn:
    | {
        turnId?: string
        submittedAt: string
        phase: 'sending' | 'waiting'
      }
    | null
  autoSyncIntervalMs: number | null
  clearPendingTurn: (threadId: string) => void
  contextCompactionFeedback: ContextCompactionFeedback | null
  currentThreads: Array<{ id: string }>
  isHeaderSyncBusy: boolean
  isMobileViewport: boolean
  isMobileWorkbenchOverlayOpen: boolean
  isThreadProcessing: boolean
  latestThreadDetailId?: string
  liveThreadTurns?: Array<{ id: string }>
  mobileThreadToolsOpen: boolean
  queryClient: {
    invalidateQueries: (input: { queryKey: unknown[] }) => Promise<unknown>
  }
  resetMobileThreadChrome: () => void
  selectedThread?: { id: string; name: string }
  selectedThreadEvents: Array<{ method: string; ts: string }>
  selectedThreadId?: string
  setContextCompactionFeedback: (
    value:
      | ContextCompactionFeedback
      | ((current: ContextCompactionFeedback | null) => ContextCompactionFeedback | null),
  ) => void
  setIsInspectorExpanded: (value: boolean) => void
  setMobileThreadChrome: (input: {
    visible: boolean
    title: string
    statusLabel: string
    statusTone: string
    syncLabel: string
    syncTitle: string
    activityVisible: boolean
    activityRunning: boolean
    refreshBusy: boolean
  }) => void
  setMobileThreadToolsOpen: (value: boolean) => void
  setSelectedThread: (workspaceId: string, threadId?: string) => void
  setSelectedWorkspace: (workspaceId: string) => void
  setSurfacePanelView: (value: 'approvals' | 'feed' | null) => void
  setSyncClock: (value: number) => void
  streamState: string
  syncTitle: string
  workspaceActivityEvents: Array<{ method: string; serverRequestId?: string | null }>
  workspaceId: string
  chromeState: {
    statusLabel: string
    statusTone: string
    syncLabel: string
  }
}

export type ThreadPageLifecycleEffectsInput = Pick<
  ThreadPageEffectsInput,
  | 'activePendingTurn'
  | 'clearPendingTurn'
  | 'currentThreads'
  | 'latestThreadDetailId'
  | 'liveThreadTurns'
  | 'selectedThreadId'
  | 'setSelectedThread'
  | 'setSelectedWorkspace'
  | 'workspaceId'
>

export type ThreadPageRefreshEffectsInput = Pick<
  ThreadPageEffectsInput,
  | 'contextCompactionFeedback'
  | 'queryClient'
  | 'selectedThreadEvents'
  | 'selectedThreadId'
  | 'setContextCompactionFeedback'
  | 'workspaceActivityEvents'
  | 'workspaceId'
> & {
  threadDetailRefreshTimerRef: MutableRefObject<number | null>
}

export type ThreadPageChromeEffectsInput = Pick<
  ThreadPageEffectsInput,
  | 'autoSyncIntervalMs'
  | 'chromeState'
  | 'isHeaderSyncBusy'
  | 'isMobileViewport'
  | 'isMobileWorkbenchOverlayOpen'
  | 'isThreadProcessing'
  | 'mobileThreadToolsOpen'
  | 'resetMobileThreadChrome'
  | 'selectedThread'
  | 'setIsInspectorExpanded'
  | 'setMobileThreadChrome'
  | 'setMobileThreadToolsOpen'
  | 'setSurfacePanelView'
  | 'setSyncClock'
  | 'streamState'
  | 'syncTitle'
>
