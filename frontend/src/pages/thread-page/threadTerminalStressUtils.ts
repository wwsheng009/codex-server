import type { TerminalDockPlacement } from '../../lib/layout-config'

export const TERMINAL_STRESS_HISTORY_LIMIT = 12
export const TERMINAL_STRESS_HISTORY_STORAGE_KEY = 'codex-server-terminal-stress-history-v1'

export type TerminalStressRunStatus = 'waiting' | 'running' | 'completed'

export type TerminalStressRunConfig = {
  isFloating: boolean
  isWindowMaximized: boolean
  outputLimit: number
  placement: TerminalDockPlacement
  renderer: string
  scrollback: number
  terminalSize: string
  viewportPx: string
  workspacePx: string
}

export type TerminalStressRunMetrics = {
  peakChunk: number
  peakFlushRate: number
  peakOutput: number
  peakRate: number
}

export type TerminalStressRun = {
  command: string
  completedAt?: number
  config: TerminalStressRunConfig
  durationMs?: number
  id: string
  metrics: TerminalStressRunMetrics
  sessionId?: string
  startedAt: number
  status: TerminalStressRunStatus
}

export type CompletedTerminalStressRun = TerminalStressRun & {
  completedAt: number
  durationMs: number
  status: 'completed'
}

export type TerminalStressComparisonMetricKey =
  | 'peakRate'
  | 'peakFlushRate'
  | 'peakChunk'
  | 'peakOutput'
  | 'durationMs'

export type TerminalStressComparisonMetric = {
  baseline: number
  current: number
  delta: number
  deltaPercent: number | null
  key: TerminalStressComparisonMetricKey
  label: string
}

export type TerminalStressConfigChange = {
  baseline: string
  current: string
  key: keyof TerminalStressRunConfig
  label: string
}

export type TerminalStressComparison = {
  baselineId: string
  changedConfig: TerminalStressConfigChange[]
  currentId: string
  metrics: TerminalStressComparisonMetric[]
}

export function toCompletedTerminalStressRun(
  value: TerminalStressRun | null | undefined,
): CompletedTerminalStressRun | null {
  if (!value || value.status !== 'completed' || typeof value.completedAt !== 'number') {
    return null
  }

  return {
    ...value,
    completedAt: value.completedAt,
    durationMs:
      typeof value.durationMs === 'number'
        ? Math.max(0, value.durationMs)
        : Math.max(0, value.completedAt - value.startedAt),
    status: 'completed',
  }
}

export function compareTerminalStressRuns(
  current: CompletedTerminalStressRun,
  baseline: CompletedTerminalStressRun,
): TerminalStressComparison {
  return {
    baselineId: baseline.id,
    changedConfig: [
      buildConfigChange('renderer', 'renderer', current.config.renderer, baseline.config.renderer),
      buildConfigChange(
        'terminalSize',
        'terminal',
        current.config.terminalSize,
        baseline.config.terminalSize,
      ),
      buildConfigChange('viewportPx', 'viewport', current.config.viewportPx, baseline.config.viewportPx),
      buildConfigChange('workspacePx', 'dock', current.config.workspacePx, baseline.config.workspacePx),
      buildConfigChange('placement', 'placement', current.config.placement, baseline.config.placement),
      buildConfigChange('isFloating', 'floating', current.config.isFloating, baseline.config.isFloating),
      buildConfigChange(
        'isWindowMaximized',
        'maximized',
        current.config.isWindowMaximized,
        baseline.config.isWindowMaximized,
      ),
      buildConfigChange('scrollback', 'scrollback', current.config.scrollback, baseline.config.scrollback),
      buildConfigChange('outputLimit', 'output cap', current.config.outputLimit, baseline.config.outputLimit),
    ].filter((value): value is TerminalStressConfigChange => value !== null),
    currentId: current.id,
    metrics: [
      buildMetric('peakRate', 'peak rate', current.metrics.peakRate, baseline.metrics.peakRate),
      buildMetric(
        'peakFlushRate',
        'peak flush/s',
        current.metrics.peakFlushRate,
        baseline.metrics.peakFlushRate,
      ),
      buildMetric('peakChunk', 'peak chunk', current.metrics.peakChunk, baseline.metrics.peakChunk),
      buildMetric('peakOutput', 'peak output', current.metrics.peakOutput, baseline.metrics.peakOutput),
      buildMetric('durationMs', 'duration', current.durationMs, baseline.durationMs),
    ],
  }
}

export function createTerminalStressExport(input: {
  baseline?: CompletedTerminalStressRun | null
  comparison?: TerminalStressComparison | null
  latest: CompletedTerminalStressRun
}) {
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

function buildMetric(
  key: TerminalStressComparisonMetricKey,
  label: string,
  current: number,
  baseline: number,
): TerminalStressComparisonMetric {
  const delta = current - baseline

  return {
    baseline,
    current,
    delta,
    deltaPercent: baseline === 0 ? null : (delta / baseline) * 100,
    key,
    label,
  }
}

function buildConfigChange(
  key: keyof TerminalStressRunConfig,
  label: string,
  current: string | number | boolean,
  baseline: string | number | boolean,
): TerminalStressConfigChange | null {
  const currentValue = formatConfigValue(current)
  const baselineValue = formatConfigValue(baseline)

  if (currentValue === baselineValue) {
    return null
  }

  return {
    baseline: baselineValue,
    current: currentValue,
    key,
    label,
  }
}

function formatConfigValue(value: string | number | boolean) {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  return String(value)
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
