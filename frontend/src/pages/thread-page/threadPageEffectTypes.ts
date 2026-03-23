import type { QueryClient } from '@tanstack/react-query'
import type { MutableRefObject } from 'react'
import type { NavigateFunction } from 'react-router-dom'

import type { ServerEvent } from '../../types/api'
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
  isDocumentVisible: boolean
  isMobileViewport: boolean
  isMobileWorkbenchOverlayOpen: boolean
  isThreadPinnedToLatest: boolean
  isThreadProcessing: boolean
  isThreadViewportInteracting: boolean
  latestThreadDetailId?: string
  liveThreadTurns?: Array<{ id: string }>
  mobileThreadToolsOpen: boolean
  navigate: NavigateFunction
  queryClient: Pick<QueryClient, 'invalidateQueries' | 'setQueryData'>
  resetMobileThreadChrome: () => void
  routeThreadId?: string
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
  workspaceActivityEvents: ServerEvent[]
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
  | 'navigate'
  | 'routeThreadId'
  | 'selectedThreadId'
  | 'setSelectedThread'
  | 'setSelectedWorkspace'
  | 'workspaceId'
>

export type ThreadPageRefreshEffectsInput = Pick<
  ThreadPageEffectsInput,
  | 'activePendingTurn'
  | 'contextCompactionFeedback'
  | 'isDocumentVisible'
  | 'streamState'
  | 'queryClient'
  | 'selectedThreadEvents'
  | 'selectedThreadId'
  | 'setContextCompactionFeedback'
  | 'workspaceActivityEvents'
  | 'workspaceId'
  | 'isThreadPinnedToLatest'
  | 'isThreadViewportInteracting'
> & {
  threadListRefreshTimerRef: MutableRefObject<number | null>
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
