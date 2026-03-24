import type { TerminalDockPlacement } from '../../lib/layout-config'
import type {
  CompletedTerminalStressRun,
  TerminalStressRunConfig,
  TerminalStressRunMetrics,
} from './threadTerminalStressDomain'
import type {
  ThreadTerminalStressExportInput
} from './threadTerminalStressStateTypes'

export const TERMINAL_STRESS_HISTORY_LIMIT = 12
export const TERMINAL_STRESS_HISTORY_STORAGE_KEY = 'codex-server-terminal-stress-history-v1'

export function createTerminalStressExport(input: ThreadTerminalStressExportInput) {
  return {
    baseline: input.baseline ?? null,
    comparison: input.comparison ?? null,
    exportedAt: new Date().toISOString(),
    kind: 'terminal-stress-summary',
    latest: input.latest,
    version: 1,
  }
}

export function parseTerminalStressHistory(
  value: string | null | undefined,
): CompletedTerminalStressRun[] {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map(normalizeCompletedTerminalStressRun)
      .filter((entry): entry is CompletedTerminalStressRun => entry !== null)
      .slice(0, TERMINAL_STRESS_HISTORY_LIMIT)
  } catch {
    return []
  }
}

export function serializeTerminalStressHistory(history: CompletedTerminalStressRun[]) {
  return JSON.stringify(history.slice(0, TERMINAL_STRESS_HISTORY_LIMIT), null, 2)
}

function normalizeCompletedTerminalStressRun(value: unknown): CompletedTerminalStressRun | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  const config = normalizeTerminalStressConfig(record.config)
  const metrics = normalizeTerminalStressMetrics(record.metrics)

  if (
    !config ||
    !metrics ||
    typeof record.command !== 'string' ||
    typeof record.id !== 'string' ||
    typeof record.startedAt !== 'number' ||
    typeof record.completedAt !== 'number'
  ) {
    return null
  }

  return {
    command: record.command,
    completedAt: record.completedAt,
    config,
    durationMs:
      typeof record.durationMs === 'number'
        ? Math.max(0, record.durationMs)
        : Math.max(0, record.completedAt - record.startedAt),
    id: record.id,
    metrics,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    startedAt: record.startedAt,
    status: 'completed',
  }
}

function normalizeTerminalStressConfig(value: unknown): TerminalStressRunConfig | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const config = value as Record<string, unknown>

  if (
    typeof config.isFloating !== 'boolean' ||
    typeof config.isWindowMaximized !== 'boolean' ||
    typeof config.outputLimit !== 'number' ||
    typeof config.renderer !== 'string' ||
    typeof config.scrollback !== 'number' ||
    typeof config.terminalSize !== 'string' ||
    typeof config.viewportPx !== 'string' ||
    typeof config.workspacePx !== 'string' ||
    !isTerminalDockPlacement(config.placement)
  ) {
    return null
  }

  return {
    isFloating: config.isFloating,
    isWindowMaximized: config.isWindowMaximized,
    outputLimit: config.outputLimit,
    placement: config.placement,
    renderer: config.renderer,
    scrollback: config.scrollback,
    terminalSize: config.terminalSize,
    viewportPx: config.viewportPx,
    workspacePx: config.workspacePx,
  }
}

function normalizeTerminalStressMetrics(value: unknown): TerminalStressRunMetrics | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const metrics = value as Record<string, unknown>

  if (
    typeof metrics.peakChunk !== 'number' ||
    typeof metrics.peakFlushRate !== 'number' ||
    typeof metrics.peakOutput !== 'number' ||
    typeof metrics.peakRate !== 'number'
  ) {
    return null
  }

  return {
    peakChunk: metrics.peakChunk,
    peakFlushRate: metrics.peakFlushRate,
    peakOutput: metrics.peakOutput,
    peakRate: metrics.peakRate,
  }
}

function isTerminalDockPlacement(value: unknown): value is TerminalDockPlacement {
  return value === 'bottom' || value === 'right' || value === 'floating'
}
