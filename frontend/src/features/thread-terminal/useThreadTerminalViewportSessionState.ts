import type {
  ThreadTerminalSessionSelectionInput,
  ThreadTerminalViewportSessionState
} from './threadTerminalInteractionStateTypes'
import { useThreadTerminalSessionListState } from './useThreadTerminalSessionListState'
import { useThreadTerminalViewportHandlesState } from './useThreadTerminalViewportHandlesState'

export function useThreadTerminalViewportSessionState({
  commandSessions,
  onSelectSession,
  selectedCommandSession,
}: ThreadTerminalSessionSelectionInput): ThreadTerminalViewportSessionState {
  const sessionList = useThreadTerminalSessionListState({
    commandSessions,
    onSelectSession,
    selectedCommandSession,
  })

  const viewportHandles = useThreadTerminalViewportHandlesState({
    activeSessionId: sessionList.activeSessionId,
    selectedCommandSession,
  })

  return {
    activeSessionId: sessionList.activeSessionId,
    refs: viewportHandles.refs,
    selectSession: sessionList.selectSession,
    sessions: sessionList.sessions,
    viewportSession: viewportHandles.viewportSession,
  }
}
