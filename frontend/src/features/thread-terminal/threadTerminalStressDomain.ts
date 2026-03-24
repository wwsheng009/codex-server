import type { TerminalDockPlacement } from '../../lib/layout-config'

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
      buildConfigChange(
        'viewportPx',
        'viewport',
        current.config.viewportPx,
        baseline.config.viewportPx,
      ),
      buildConfigChange(
        'workspacePx',
        'dock',
        current.config.workspacePx,
        baseline.config.workspacePx,
      ),
      buildConfigChange(
        'placement',
        'placement',
        current.config.placement,
        baseline.config.placement,
      ),
      buildConfigChange(
        'isFloating',
        'floating',
        current.config.isFloating,
        baseline.config.isFloating,
      ),
      buildConfigChange(
        'isWindowMaximized',
        'maximized',
        current.config.isWindowMaximized,
        baseline.config.isWindowMaximized,
      ),
      buildConfigChange(
        'scrollback',
        'scrollback',
        current.config.scrollback,
        baseline.config.scrollback,
      ),
      buildConfigChange(
        'outputLimit',
        'output cap',
        current.config.outputLimit,
        baseline.config.outputLimit,
      ),
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
      buildMetric(
        'peakChunk',
        'peak chunk',
        current.metrics.peakChunk,
        baseline.metrics.peakChunk,
      ),
      buildMetric(
        'peakOutput',
        'peak output',
        current.metrics.peakOutput,
        baseline.metrics.peakOutput,
      ),
      buildMetric('durationMs', 'duration', current.durationMs, baseline.durationMs),
    ],
  }
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
