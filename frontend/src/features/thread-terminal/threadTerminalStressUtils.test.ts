import { describe, expect, it } from 'vitest'

import {
  compareTerminalStressRuns,
  type CompletedTerminalStressRun,
} from './threadTerminalStressDomain'
import {
  createTerminalStressExport,
  parseTerminalStressHistory,
  serializeTerminalStressHistory,
} from './threadTerminalStressStorage'

function buildCompletedRun(
  overrides: Partial<CompletedTerminalStressRun> = {},
): CompletedTerminalStressRun {
  return {
    command: 'powershell -NoLogo -NoProfile -Command "stress"',
    completedAt: 11_000,
    config: {
      isFloating: false,
      isWindowMaximized: false,
      outputLimit: 128_000,
      placement: 'bottom',
      renderer: 'webgl',
      scrollback: 5_000,
      terminalSize: '160x40',
      viewportPx: '1200x420px',
      workspacePx: '1280x540px',
    },
    durationMs: 10_000,
    id: 'stress-1',
    metrics: {
      peakChunk: 12_000,
      peakFlushRate: 24,
      peakOutput: 128_000,
      peakRate: 96_000,
    },
    sessionId: 'proc_123',
    startedAt: 1_000,
    status: 'completed',
    ...overrides,
  }
}

describe('threadTerminalStressUtils', () => {
  it('compares metric deltas and changed config values', () => {
    const baseline = buildCompletedRun({
      config: {
        isFloating: false,
        isWindowMaximized: false,
        outputLimit: 128_000,
        placement: 'right',
        renderer: 'dom',
        scrollback: 5_000,
        terminalSize: '140x34',
        viewportPx: '980x360px',
        workspacePx: '1120x480px',
      },
      id: 'stress-0',
      metrics: {
        peakChunk: 8_000,
        peakFlushRate: 36,
        peakOutput: 96_000,
        peakRate: 64_000,
      },
    })
    const current = buildCompletedRun()

    const comparison = compareTerminalStressRuns(current, baseline)

    expect(comparison.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseline: 64_000,
          current: 96_000,
          delta: 32_000,
          key: 'peakRate',
        }),
        expect.objectContaining({
          baseline: 36,
          current: 24,
          delta: -12,
          key: 'peakFlushRate',
        }),
        expect.objectContaining({
          baseline: 10_000,
          current: 10_000,
          delta: 0,
          key: 'durationMs',
        }),
      ]),
    )
    expect(comparison.changedConfig).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseline: 'dom',
          current: 'webgl',
          key: 'renderer',
        }),
        expect.objectContaining({
          baseline: 'right',
          current: 'bottom',
          key: 'placement',
        }),
      ]),
    )
  })

  it('round-trips valid stored history and ignores invalid entries', () => {
    const history = [
      buildCompletedRun(),
      buildCompletedRun({
        completedAt: 22_000,
        durationMs: 9_500,
        id: 'stress-2',
        startedAt: 12_500,
      }),
    ]
    const raw = JSON.stringify([
      history[0],
      {
        id: 'broken',
        startedAt: 'nope',
      },
      history[1],
    ])

    const parsed = parseTerminalStressHistory(raw)

    expect(parsed).toEqual(history)
    expect(parseTerminalStressHistory(serializeTerminalStressHistory(history))).toEqual(history)
  })

  it('builds an export payload that includes latest run and comparison details', () => {
    const latest = buildCompletedRun()
    const baseline = buildCompletedRun({
      id: 'stress-0',
      metrics: {
        peakChunk: 6_000,
        peakFlushRate: 30,
        peakOutput: 80_000,
        peakRate: 60_000,
      },
    })
    const comparison = compareTerminalStressRuns(latest, baseline)

    const payload = createTerminalStressExport({
      baseline,
      comparison,
      latest,
    })

    expect(payload.kind).toBe('terminal-stress-summary')
    expect(payload.version).toBe(1)
    expect(payload.latest.config.scrollback).toBe(5_000)
    expect(payload.baseline?.id).toBe('stress-0')
    expect(payload.comparison?.metrics[0]?.key).toBe('peakRate')
  })
})
