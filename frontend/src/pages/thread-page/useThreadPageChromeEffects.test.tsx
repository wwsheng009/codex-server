// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { i18n } from '../../i18n/runtime'
import type { ThreadTurn } from '../../types/api'
import type { ThreadPageChromeEffectsInput } from './threadPageEffectTypes'
import {
  latestThreadPlanAutoOpenSignal,
  useThreadPageChromeEffects,
} from './useThreadPageChromeEffects'

function buildPlanTurns(explanation: string, stepLabel = 'Wire plans panel'): ThreadTurn[] {
  return [
    {
      id: 'turn-1',
      status: 'inProgress',
      items: [
        {
          id: 'turn-plan-1',
          type: 'turnPlan',
          explanation,
          status: 'inProgress',
          steps: [
            {
              step: stepLabel,
              status: 'inProgress',
            },
          ],
        },
      ],
    },
  ]
}

function buildInput(
  overrides: Partial<ThreadPageChromeEffectsInput> = {},
): ThreadPageChromeEffectsInput {
  return {
    autoSyncIntervalMs: null,
    chromeState: {
      statusLabel: 'Idle',
      statusTone: 'neutral',
      syncLabel: 'Synced',
    },
    displayedTurns: [],
    isHeaderSyncBusy: false,
    isMobileViewport: false,
    isMobileWorkbenchOverlayOpen: false,
    isThreadProcessing: false,
    mobileThreadToolsOpen: false,
    resetMobileThreadChrome: vi.fn(),
    selectedThread: undefined,
    setIsInspectorExpanded: vi.fn(),
    setMobileThreadChrome: vi.fn(),
    setMobileThreadToolsOpen: vi.fn(),
    surfacePanelView: null,
    setSurfacePanelView: vi.fn(),
    setSyncClock: vi.fn(),
    streamState: 'closed',
    syncTitle: 'Last synced just now',
    ...overrides,
  }
}

describe('useThreadPageChromeEffects', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('derives an auto-open signal from the most recent turn plan entry', () => {
    expect(
      latestThreadPlanAutoOpenSignal([
        {
          id: 'turn-older',
          status: 'completed',
          items: [
            {
              id: 'turn-plan-older',
              type: 'turnPlan',
              explanation: 'Older plan',
              status: 'completed',
              steps: [{ step: 'Audit', status: 'completed' }],
            },
          ],
        },
        {
          id: 'turn-newer',
          status: 'inProgress',
          items: [
            {
              id: 'turn-plan-newer',
              type: 'turnPlan',
              explanation: 'Newer plan',
              status: 'inProgress',
              steps: [{ step: 'Ship panel', status: 'inProgress' }],
            },
          ],
        },
      ]),
    ).toBe('turn-newer:turn-plan-newer:inProgress:10:1:10')
  })

  it('auto-opens the plans panel when the selected thread already contains plan events', () => {
    const input = buildInput({
      displayedTurns: buildPlanTurns('Track plan state in a dedicated panel.'),
      selectedThread: {
        id: 'thread-1',
        name: 'Thread 1',
      },
    })

    renderHook((props: ThreadPageChromeEffectsInput) => useThreadPageChromeEffects(props), {
      initialProps: input,
    })

    expect(input.setIsInspectorExpanded).toHaveBeenCalledWith(false)
    expect(input.setSurfacePanelView).toHaveBeenCalledWith('plans')
  })

  it('does not reopen the same plan signal after the panel has already been auto-opened once', () => {
    const input = buildInput({
      displayedTurns: buildPlanTurns('Track plan state in a dedicated panel.'),
      selectedThread: {
        id: 'thread-1',
        name: 'Thread 1',
      },
    })

    const { rerender } = renderHook(
      (props: ThreadPageChromeEffectsInput) => useThreadPageChromeEffects(props),
      {
        initialProps: input,
      },
    )

    const setSurfacePanelView = input.setSurfacePanelView as ReturnType<typeof vi.fn>
    const setIsInspectorExpanded = input.setIsInspectorExpanded as ReturnType<typeof vi.fn>
    setSurfacePanelView.mockClear()
    setIsInspectorExpanded.mockClear()

    rerender({
      ...input,
      surfacePanelView: null,
    })

    expect(setSurfacePanelView).not.toHaveBeenCalledWith('plans')
    expect(setIsInspectorExpanded).not.toHaveBeenCalledWith(false)
  })

  it('reopens the plans panel when a newer plan update arrives for the same thread', () => {
    const setSurfacePanelView = vi.fn()
    const setIsInspectorExpanded = vi.fn()
    const baseInput = buildInput({
      displayedTurns: buildPlanTurns('Track plan state in a dedicated panel.'),
      selectedThread: {
        id: 'thread-1',
        name: 'Thread 1',
      },
      setIsInspectorExpanded,
      setSurfacePanelView,
    })

    const { rerender } = renderHook(
      (props: ThreadPageChromeEffectsInput) => useThreadPageChromeEffects(props),
      {
        initialProps: baseInput,
      },
    )

    setSurfacePanelView.mockClear()
    setIsInspectorExpanded.mockClear()

    rerender({
      ...baseInput,
      displayedTurns: buildPlanTurns(
        'Track plan state in a dedicated panel with the latest status.',
        'Verify reopen behavior',
      ),
      surfacePanelView: null,
    })

    expect(setIsInspectorExpanded).toHaveBeenCalledWith(false)
    expect(setSurfacePanelView).toHaveBeenCalledWith('plans')
  })
})
