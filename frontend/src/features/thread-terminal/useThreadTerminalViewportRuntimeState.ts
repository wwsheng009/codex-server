import type {
  ThreadTerminalViewportRuntimeState,
  ThreadTerminalViewportRuntimeStateInput
} from './threadTerminalInteractionStateTypes'

export function useThreadTerminalViewportRuntimeState({
  getActiveViewportDimensionsInfo,
  getActiveViewportPerformanceInfo,
  getActiveViewportRendererInfo,
  getLauncherDimensionsInfo,
  getLauncherPerformanceInfo,
  getLauncherRendererInfo,
  isLauncherOpen,
  selectedCommandSession,
}: ThreadTerminalViewportRuntimeStateInput): ThreadTerminalViewportRuntimeState {
  const activeRenderableSession = !isLauncherOpen ? selectedCommandSession : undefined
  const activeRendererInfo = isLauncherOpen
    ? getLauncherRendererInfo()
    : activeRenderableSession?.archived
      ? 'static'
      : getActiveViewportRendererInfo()
  const activeDimensionsInfo = isLauncherOpen
    ? getLauncherDimensionsInfo()
    : getActiveViewportDimensionsInfo()
  const activePerformanceInfo = isLauncherOpen
    ? getLauncherPerformanceInfo()
    : getActiveViewportPerformanceInfo()
  const shouldUsePlainTextViewport = Boolean(activeRenderableSession?.archived)

  return {
    activeDimensionsInfo,
    activePerformanceInfo,
    activeRenderableSession,
    activeRendererInfo,
    shouldUsePlainTextViewport,
  }
}
