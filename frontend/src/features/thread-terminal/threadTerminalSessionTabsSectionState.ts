import type {
  BuildThreadTerminalSessionTabsSectionStateInput,
  ThreadTerminalSessionTabsSectionState
} from './threadTerminalDockStateTypes'

export function buildThreadTerminalSessionTabsSectionState({
  isLauncherOpen,
  onArchiveSession,
  onPinSession,
  onRemoveSession,
  placement,
  selectedCommandSession,
  sessions,
}: BuildThreadTerminalSessionTabsSectionStateInput): ThreadTerminalSessionTabsSectionState {
  return {
    isLauncherOpen,
    onArchiveSession,
    onPinSession,
    onRemoveSession,
    placement,
    selectedCommandSession,
    sessions,
  }
}
