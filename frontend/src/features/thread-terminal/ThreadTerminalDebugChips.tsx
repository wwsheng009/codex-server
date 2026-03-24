import {
  getChunkDebugTone,
  getFlushRateDebugTone,
  getOutputDebugTone,
  getRateDebugTone,
  getRendererDebugTone,
  getReplayAppendDebugTone,
  getReplayReplaceDebugTone,
  getSizeDebugTone,
} from './threadTerminalDebugUtils'
import type {
  ThreadTerminalDebugChipsState
} from './threadTerminalStressStateTypes'

export function ThreadTerminalDebugChips({
  activeDimensionsInfo,
  activePerformanceInfo,
  activeRendererInfo,
  isInteractive,
  isLauncherOpen,
  launcherMode,
  selectedCommandSession,
}: ThreadTerminalDebugChipsState) {
  return (
    <div className="terminal-dock__debug">
      <span
        className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getRendererDebugTone({
          outputLength: selectedCommandSession?.combinedOutput?.length ?? 0,
          rate: activePerformanceInfo.bytesPerSecond,
          renderer: activeRendererInfo,
        })}`}
      >
        {`renderer:${activeRendererInfo}`}
      </span>
      <span
        className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getSizeDebugTone(
          activeDimensionsInfo,
        )}`}
      >
        {`size:${activeDimensionsInfo}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`session:${selectedCommandSession?.id ?? 'none'}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`mode:${selectedCommandSession?.mode ?? launcherMode}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`launcher:${isLauncherOpen ? launcherMode : 'none'}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`interactive:${isInteractive ? 'yes' : 'no'}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`status:${selectedCommandSession?.status ?? 'none'}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`shellState:${selectedCommandSession?.shellState ?? 'n/a'}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`archived:${selectedCommandSession?.archived ? 'yes' : 'no'}`}
      </span>
      <span
        className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getOutputDebugTone(
          selectedCommandSession?.combinedOutput?.length ?? 0,
        )}`}
      >
        {`output:${selectedCommandSession?.combinedOutput?.length ?? 0}`}
      </span>
      <span
        className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getReplayAppendDebugTone(
          selectedCommandSession?.replayAppendCount ?? 0,
        )}`}
      >
        {`replay+:${selectedCommandSession?.replayAppendCount ?? 0}`}
      </span>
      <span
        className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getReplayReplaceDebugTone(
          selectedCommandSession?.replayReplaceCount ?? 0,
        )}`}
      >
        {`replace:${selectedCommandSession?.replayReplaceCount ?? 0}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`resumeB:${selectedCommandSession?.replayByteCount ?? 0}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`reason:${selectedCommandSession?.lastReplayReason ?? 'n/a'}`}
      </span>
      <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
        {`flush:${activePerformanceInfo.flushCount}`}
      </span>
      <span
        className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getFlushRateDebugTone(
          activePerformanceInfo.flushesPerSecond,
        )}`}
      >
        {`flush/s:${activePerformanceInfo.flushesPerSecond}`}
      </span>
      <span
        className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getChunkDebugTone(
          activePerformanceInfo.lastChunkSize,
        )}`}
      >
        {`chunk:${activePerformanceInfo.lastChunkSize}`}
      </span>
      <span
        className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getRateDebugTone(
          activePerformanceInfo.bytesPerSecond,
        )}`}
      >
        {`rate:${activePerformanceInfo.bytesPerSecond}/s`}
      </span>
    </div>
  )
}
