import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import { buildThreadPageWorkbenchStatus } from './buildThreadPageWorkbenchStatus'

describe('buildThreadPageWorkbenchStatus', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('maps completed mobile status to a completed label', () => {
    const result = buildThreadPageWorkbenchStatus({
      activeCommandCount: 0,
      commandSessionCount: 0,
      composerStatusInfo: null,
      displayedTurnsLength: 1,
      isInspectorExpanded: false,
      isMobileViewport: true,
      isTerminalDockExpanded: false,
      isTerminalDockResizing: false,
      isTerminalDockVisible: false,
      isTerminalWindowDragging: false,
      isTerminalWindowMaximized: false,
      isTerminalWindowResizing: false,
      isThreadPinnedToLatest: true,
      mobileStatus: 'completed',
      selectedThread: undefined,
      selectedThreadEvents: [],
      selectedThreadId: 'thread-1',
      streamState: 'open',
      surfacePanelView: null,
      syncLabel: 'Live',
      terminalDockPlacement: 'bottom',
      workspaceEvents: [],
    })

    expect(result.chromeState.statusLabel).toBe('Completed')
    expect(result.chromeState.statusTone).toBe('completed')
  })
})
