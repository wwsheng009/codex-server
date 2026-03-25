import type { QueryClient } from '@tanstack/react-query'
import type { MutableRefObject } from 'react'
import type { NavigateFunction } from 'react-router-dom'

import type { MobileThreadChromeInput } from '../../stores/ui-store-types'
import type { ServerEvent } from '../../types/api'
import type { ContextCompactionFeedback } from './threadPageComposerShared'

export type ThreadPageEffectsQueryClient = {
  invalidateQueries: QueryClient['invalidateQueries']
  setQueryData: QueryClient['setQueryData']
}

export type ThreadPageQueryRefreshRequest = {
  delayMs?: number
  loadedThreads?: boolean
  threads?: boolean
}

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
  queryClient: ThreadPageEffectsQueryClient
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
  setMobileThreadChrome: (input: MobileThreadChromeInput) => void
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

export type ThreadPageLifecycleEffectsInput = {
  activePendingTurn:
    | {
        turnId?: string
        submittedAt: string
        phase: 'sending' | 'waiting'
      }
    | null
  clearPendingTurn: (threadId: string) => void
  currentThreads: Array<{ id: string }>
  latestThreadDetailId?: string
  liveThreadTurns?: Array<{ id: string }>
  navigate: NavigateFunction
  routeThreadId?: string
  selectedThreadId?: string
  setSelectedThread: (workspaceId: string, threadId?: string) => void
  setSelectedWorkspace: (workspaceId: string) => void
  workspaceId: string
}

export type ThreadPageRefreshEffectsInput = {
  activePendingTurn:
    | {
        turnId?: string
        submittedAt: string
        phase: 'sending' | 'waiting'
      }
    | null
  contextCompactionFeedback: ContextCompactionFeedback | null
  isDocumentVisible: boolean
  isThreadPinnedToLatest: boolean
  isThreadViewportInteracting: boolean
  queryClient: ThreadPageEffectsQueryClient
  selectedThreadEvents: Array<{ method: string; ts: string }>
  selectedThreadId?: string
  setContextCompactionFeedback: (
    value:
      | ContextCompactionFeedback
      | ((current: ContextCompactionFeedback | null) => ContextCompactionFeedback | null),
  ) => void
  streamState: string
  threadListRefreshTimerRef: MutableRefObject<number | null>
  threadDetailRefreshTimerRef: MutableRefObject<number | null>
  workspaceActivityEvents: ServerEvent[]
  workspaceId: string
}

export type ThreadPageChromeEffectsInput = {
  autoSyncIntervalMs: number | null
  chromeState: {
    statusLabel: string
    statusTone: string
    syncLabel: string
  }
  isHeaderSyncBusy: boolean
  isMobileViewport: boolean
  isMobileWorkbenchOverlayOpen: boolean
  isThreadProcessing: boolean
  mobileThreadToolsOpen: boolean
  resetMobileThreadChrome: () => void
  selectedThread?: { id: string; name: string }
  setIsInspectorExpanded: (value: boolean) => void
  setMobileThreadChrome: (input: MobileThreadChromeInput) => void
  setMobileThreadToolsOpen: (value: boolean) => void
  setSurfacePanelView: (value: 'approvals' | 'feed' | null) => void
  setSyncClock: (value: number) => void
  streamState: string
  syncTitle: string
}
