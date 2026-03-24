import type { ThreadTerminalWorkspaceInput } from './threadTerminalDockTypes'
import type {
  ThreadTerminalWorkspaceState
} from './threadTerminalDockStateTypes'
import { buildThreadTerminalConsoleSectionState } from './threadTerminalConsoleSectionState'
import { buildThreadTerminalDockWorkspaceState } from './threadTerminalDockWorkspaceState'
import { buildThreadTerminalSessionTabsSectionState } from './threadTerminalSessionTabsSectionState'
import { useThreadTerminalDebugPanelState } from './useThreadTerminalDebugPanelState'
import { useThreadTerminalInteractionState } from './useThreadTerminalInteractionState'
import { useThreadTerminalStressState } from './useThreadTerminalStressState'

export function useThreadTerminalWorkspaceState(
  props: ThreadTerminalWorkspaceInput,
): ThreadTerminalWorkspaceState {
  const interaction = useThreadTerminalInteractionState({
    commandSessions: props.commandSessions,
    onSelectSession: props.onSelectSession,
    onStartCommandLine: props.onStartCommandLine,
    onStartShellSession: props.onStartShellSession,
    rootPath: props.rootPath,
    selectedCommandSession: props.selectedCommandSession,
    startCommandPending: props.startCommandPending,
  })

  const stress = useThreadTerminalStressState({
    activeDimensionsInfo: interaction.activeDimensionsInfo,
    activePerformanceInfo: interaction.activePerformanceInfo,
    activeRenderableSession: interaction.activeRenderableSession,
    activeRendererInfo: interaction.activeRendererInfo,
    isFloating: props.isFloating,
    isLauncherOpen: interaction.launcher.isOpen,
    isWindowMaximized: props.isWindowMaximized,
    onOpenLauncher: interaction.launcher.open,
    onStartLauncherCommand: interaction.launcher.startCommand,
    placement: props.placement,
    rootPath: props.rootPath,
    selectedCommandSession: props.selectedCommandSession,
    viewportStackRef: interaction.refs.viewportStackRef,
    workspaceRef: interaction.refs.workspaceRef,
  })

  const debugPanel = useThreadTerminalDebugPanelState({
    activeDimensionsInfo: interaction.activeDimensionsInfo,
    activePerformanceInfo: interaction.activePerformanceInfo,
    activeRendererInfo: interaction.activeRendererInfo,
    isInteractive: interaction.sessions.isInteractive,
    isLauncherOpen: interaction.launcher.isOpen,
    launcherMode: interaction.launcher.mode,
    selectedCommandSession: props.selectedCommandSession,
    startCommandPending: props.startCommandPending,
    stressState: stress,
  })

  const sessionTabsSection = buildThreadTerminalSessionTabsSectionState({
    isLauncherOpen: interaction.launcher.isOpen,
    onArchiveSession: props.onToggleArchivedSession,
    onPinSession: props.onTogglePinnedSession,
    onRemoveSession: props.onRemoveSession,
    placement: props.placement,
    selectedCommandSession: props.selectedCommandSession,
    sessions: interaction.sessions,
  })

  const consoleSection = buildThreadTerminalConsoleSectionState({
    commandSessionsCount: props.commandSessions.length,
    debugPanel,
    launcher: interaction.launcher,
    onClearCompletedSessions: props.onClearCompletedSessions,
    onResizeTerminal: props.onResizeTerminal,
    onStopSession: props.onTerminateSelectedSession,
    onToggleArchivedSession: props.onToggleArchivedSession,
    onTogglePinnedSession: props.onTogglePinnedSession,
    onWriteTerminalData: props.onWriteTerminalData,
    refs: interaction.refs,
    rootPath: props.rootPath,
    search: interaction.search,
    selectedCommandSession: props.selectedCommandSession,
    sessions: interaction.sessions,
    startCommandPending: props.startCommandPending,
    terminateDisabled: props.terminateDisabled,
    viewport: interaction.viewport,
  })

  return buildThreadTerminalDockWorkspaceState({
    consoleSection,
    layout: {
      isFloating: props.isFloating,
      isWindowMaximized: props.isWindowMaximized,
      onResizeStart: props.onResizeStart,
      onWindowResizeStart: props.onWindowResizeStart,
      placement: props.placement,
    },
    sessionTabsSection,
    workspaceRef: interaction.refs.workspaceRef,
  })
}
