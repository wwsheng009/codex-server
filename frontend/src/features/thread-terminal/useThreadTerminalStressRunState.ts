import { useEffect, useState } from 'react'

import { COMMAND_SESSION_OUTPUT_LIMIT } from '../../stores/session-store'
import {
  TERMINAL_LAUNCHER_SCROLLBACK,
  TERMINAL_VIEWPORT_SCROLLBACK,
} from './ThreadTerminalViewport'
import type {
  TerminalStressRun,
  TerminalStressRunConfig,
} from './threadTerminalStressDomain'
import {
  buildTerminalDebugSuggestions,
} from './threadTerminalDebugUtils'
import {
  buildTerminalStressCommand,
  formatElementPixelSize,
  terminalStressTestDurationMs,
} from './threadTerminalStressHelpers'
import type {
  ThreadTerminalStressRunInput,
  ThreadTerminalStressRunState
} from './threadTerminalStressStateTypes'

export function useThreadTerminalStressRunState({
  activeDimensionsInfo,
  activePerformanceInfo,
  activeRenderableSession,
  activeRendererInfo,
  isFloating,
  isLauncherOpen,
  isWindowMaximized,
  onOpenLauncher,
  onStartLauncherCommand,
  placement,
  rootPath,
  selectedCommandSession,
  viewportStackRef,
  workspaceRef,
}: ThreadTerminalStressRunInput): ThreadTerminalStressRunState {
  const [stressRun, setStressRun] = useState<TerminalStressRun | null>(null)

  const activeSessionId = selectedCommandSession?.id
  const debugSuggestions = buildTerminalDebugSuggestions({
    dimensionsInfo: activeDimensionsInfo,
    outputLength: selectedCommandSession?.combinedOutput?.length ?? 0,
    rate: activePerformanceInfo.bytesPerSecond,
    renderer: activeRendererInfo,
  })
  const isStressTestActive = stressRun?.status === 'waiting' || stressRun?.status === 'running'

  function buildStressConfigSnapshot(
    renderer = activeRendererInfo,
    terminalSize = activeDimensionsInfo,
  ): TerminalStressRunConfig {
    return {
      isFloating,
      isWindowMaximized,
      outputLimit: COMMAND_SESSION_OUTPUT_LIMIT,
      placement,
      renderer,
      scrollback: isLauncherOpen ? TERMINAL_LAUNCHER_SCROLLBACK : TERMINAL_VIEWPORT_SCROLLBACK,
      terminalSize,
      viewportPx: formatElementPixelSize(viewportStackRef.current),
      workspacePx: formatElementPixelSize(workspaceRef.current),
    }
  }

  function handleRunStressCommand() {
    const command = buildTerminalStressCommand(rootPath)
    const startedAt = Date.now()
    setStressRun({
      command,
      config: buildStressConfigSnapshot(),
      id: `terminal-stress-${startedAt}`,
      metrics: {
        peakChunk: 0,
        peakFlushRate: 0,
        peakOutput: 0,
        peakRate: 0,
      },
      startedAt,
      status: 'waiting',
    })
    onOpenLauncher('command')
    onStartLauncherCommand(command)
  }

  useEffect(() => {
    if (
      !stressRun ||
      stressRun.status !== 'waiting' ||
      !activeSessionId ||
      selectedCommandSession?.command !== stressRun.command
    ) {
      return
    }

    setStressRun((current) =>
      current && current.status === 'waiting'
        ? {
            ...current,
            config: buildStressConfigSnapshot(),
            sessionId: activeSessionId,
            status: 'running',
          }
        : current,
    )
  }, [
    activeDimensionsInfo,
    activeRendererInfo,
    activeSessionId,
    isFloating,
    isLauncherOpen,
    isWindowMaximized,
    placement,
    selectedCommandSession?.command,
    stressRun,
  ])

  useEffect(() => {
    if (
      !stressRun ||
      stressRun.status !== 'running' ||
      !stressRun.sessionId ||
      activeRenderableSession?.id !== stressRun.sessionId
    ) {
      return
    }

    const now = Date.now()
    const nextPeakChunk = Math.max(stressRun.metrics.peakChunk, activePerformanceInfo.lastChunkSize)
    const nextPeakFlushRate = Math.max(
      stressRun.metrics.peakFlushRate,
      activePerformanceInfo.flushesPerSecond,
    )
    const nextPeakOutput = Math.max(
      stressRun.metrics.peakOutput,
      activeRenderableSession.combinedOutput?.length ?? 0,
    )
    const nextPeakRate = Math.max(stressRun.metrics.peakRate, activePerformanceInfo.bytesPerSecond)
    const nextRenderer =
      stressRun.config.renderer === 'pending' ? activeRendererInfo : stressRun.config.renderer
    const nextSize =
      activeDimensionsInfo !== '0x0' ? activeDimensionsInfo : stressRun.config.terminalSize
    const nextConfig = buildStressConfigSnapshot(nextRenderer, nextSize)
    const shouldComplete =
      now - stressRun.startedAt >= terminalStressTestDurationMs ||
      ['completed', 'failed', 'error'].includes(activeRenderableSession.status)

    if (
      nextPeakChunk === stressRun.metrics.peakChunk &&
      nextPeakFlushRate === stressRun.metrics.peakFlushRate &&
      nextPeakOutput === stressRun.metrics.peakOutput &&
      nextPeakRate === stressRun.metrics.peakRate &&
      nextRenderer === stressRun.config.renderer &&
      nextSize === stressRun.config.terminalSize &&
      nextConfig.viewportPx === stressRun.config.viewportPx &&
      nextConfig.workspacePx === stressRun.config.workspacePx &&
      !shouldComplete
    ) {
      return
    }

    setStressRun((current) => {
      if (!current || current.sessionId !== stressRun.sessionId) {
        return current
      }

      return {
        ...current,
        completedAt: shouldComplete ? now : current.completedAt,
        config: nextConfig,
        durationMs: shouldComplete ? Math.max(0, now - current.startedAt) : current.durationMs,
        metrics: {
          peakChunk: nextPeakChunk,
          peakFlushRate: nextPeakFlushRate,
          peakOutput: nextPeakOutput,
          peakRate: nextPeakRate,
        },
        status: shouldComplete ? 'completed' : current.status,
      }
    })
  }, [
    activeDimensionsInfo,
    activePerformanceInfo.bytesPerSecond,
    activePerformanceInfo.flushesPerSecond,
    activePerformanceInfo.lastChunkSize,
    activeRenderableSession,
    activeRendererInfo,
    isFloating,
    isLauncherOpen,
    isWindowMaximized,
    placement,
    stressRun,
  ])

  return {
    debugSuggestions,
    isStressTestActive,
    runStressCommand: handleRunStressCommand,
    setStressRun,
    stressRun,
  }
}
