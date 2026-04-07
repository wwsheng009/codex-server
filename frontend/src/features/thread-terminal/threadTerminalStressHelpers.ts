import type {
  CompletedTerminalStressRun,
  TerminalStressComparisonMetric,
  TerminalStressComparisonMetricKey,
} from './threadTerminalStressDomain'
import { formatLocalizedNumber, formatLocalizedTime } from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import { isWindowsWorkspace } from './threadTerminalShellUtils'

export const terminalStressTestDurationMs = 10_000

export function buildTerminalStressCommand(rootPath?: string) {
  if (isWindowsWorkspace(rootPath)) {
    return 'powershell -NoLogo -NoProfile -Command "1..2000 | ForEach-Object { Write-Output (\\\"load-test line $_ \\\" + (\\\"x\\\" * 120)) }"'
  }

  return `python - <<'PY'
for i in range(2000):
    print(f"load-test line {i} " + ("x" * 120))
PY`
}

export function formatStressMetric(value: number) {
  return formatLocalizedNumber(Math.round(value), '0')
}

export function formatStressDuration(durationMs?: number) {
  if (typeof durationMs !== 'number') {
    return i18n._({ id: 'n/a', message: 'n/a' })
  }

  return `${(durationMs / 1000).toFixed(1)}s`
}

export function formatStressDelta(metric: TerminalStressComparisonMetric) {
  if (metric.delta === 0) {
    return '0'
  }

  const sign = metric.delta > 0 ? '+' : '-'
  const absoluteValue =
    metric.key === 'durationMs'
      ? formatStressDuration(Math.abs(metric.delta))
      : formatStressMetric(Math.abs(metric.delta))

  if (metric.deltaPercent === null) {
    return `${sign}${absoluteValue}`
  }

  return `${sign}${absoluteValue} (${sign}${Math.abs(metric.deltaPercent).toFixed(1)}%)`
}

export function formatStressComparisonMetricValue(
  metricKey: TerminalStressComparisonMetricKey,
  value: number,
) {
  if (metricKey === 'durationMs') {
    return formatStressDuration(value)
  }

  if (metricKey === 'peakRate') {
    return `${formatStressMetric(value)}/s`
  }

  return formatStressMetric(value)
}

export function getStressDeltaTone(metric: TerminalStressComparisonMetric) {
  if (metric.delta > 0) {
    return 'positive'
  }

  if (metric.delta < 0) {
    return 'negative'
  }

  return 'neutral'
}

export function formatElementPixelSize(element: HTMLElement | null) {
  if (!element) {
    return '0x0px'
  }

  const rect = element.getBoundingClientRect()
  return `${Math.round(rect.width)}x${Math.round(rect.height)}px`
}

export function downloadJsonFile(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  })
  const objectUrl = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl)
  }, 0)
}

export function formatStressRunLabel(run: CompletedTerminalStressRun) {
  return `${formatLocalizedTime(run.startedAt)} · ${run.config.renderer} · ${run.config.terminalSize}`
}
