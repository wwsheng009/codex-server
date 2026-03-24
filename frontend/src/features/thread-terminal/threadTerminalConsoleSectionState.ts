import type {
  BuildThreadTerminalConsoleSectionStateInput,
  ThreadTerminalConsoleSectionState
} from './threadTerminalConsoleStateTypes'
import { buildThreadTerminalConsoleHeaderState } from './threadTerminalConsoleHeaderState'
import { buildThreadTerminalConsoleHintState } from './threadTerminalConsoleHintState'
import { buildThreadTerminalConsoleMetaState } from './threadTerminalConsoleMetaState'
import { buildThreadTerminalSearchBarState } from './threadTerminalSearchBarState'
import { buildThreadTerminalViewportStackState } from './threadTerminalViewportStackState'

export function buildThreadTerminalConsoleSectionState({
  commandSessionsCount,
  debugPanel,
  launcher,
  onClearCompletedSessions,
  onResizeTerminal,
  onStopSession,
  onToggleArchivedSession,
  onTogglePinnedSession,
  onWriteTerminalData,
  refs,
  rootPath,
  search,
  selectedCommandSession,
  sessions,
  startCommandPending,
  terminateDisabled,
  viewport,
}: BuildThreadTerminalConsoleSectionStateInput): ThreadTerminalConsoleSectionState {
  return {
    debugPanel,
    header: buildThreadTerminalConsoleHeaderState({
      commandSessionsCount,
      launcher,
      onStopSession,
      onToggleArchivedSession,
      onTogglePinnedSession,
      search,
      selectedCommandSession,
      sessions,
      startCommandPending,
      terminateDisabled,
      viewport,
    }),
    hint: buildThreadTerminalConsoleHintState({
      launcher,
      sessions,
      startCommandPending,
    }),
    meta: buildThreadTerminalConsoleMetaState({
      launcher,
      onClearCompletedSessions,
      rootPath,
      selectedCommandSession,
      sessions,
    }),
    searchBar: buildThreadTerminalSearchBarState({
      launcher,
      search,
    }),
    viewportStack: buildThreadTerminalViewportStackState({
      commandSessionsCount,
      launcher,
      onResizeTerminal,
      onWriteTerminalData,
      refs,
      rootPath,
      sessions,
      startCommandPending,
    }),
  }
}
