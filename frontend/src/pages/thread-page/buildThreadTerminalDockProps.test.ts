import { describe, expect, it, vi } from 'vitest'

import { buildThreadTerminalDockProps } from './buildThreadTerminalDockProps'
import type { BuildThreadTerminalDockPropsInput } from './threadPageLayoutPropTypes'

describe('buildThreadTerminalDockProps', () => {
  it('opens the launcher when showing an empty terminal dock', () => {
    const onShowTerminalDock = vi.fn()
    const onStartTerminalShellSession = vi.fn()
    const setIsTerminalDockExpanded = vi.fn()

    const input: BuildThreadTerminalDockPropsInput = {
      activeCommandCount: 0,
      commandSessions: [],
      isMobileViewport: false,
      isTerminalDockExpanded: false,
      isTerminalDockVisible: false,
      isTerminalWindowMaximized: false,
      onChangePlacement: vi.fn(),
      onClearCompletedSessions: vi.fn(),
      onHideTerminalDock: vi.fn(),
      onRemoveSession: vi.fn(),
      onResetTerminalWindowBounds: vi.fn(),
      onResizeStart: vi.fn(),
      onResizeTerminal: vi.fn(),
      onSelectSession: vi.fn(),
      onShowTerminalDock,
      onStartTerminalCommandLine: vi.fn(),
      onStartTerminalShellSession,
      onStartTerminalWindowDrag: vi.fn(),
      onStartTerminalWindowResize: vi.fn(),
      onTerminateSelectedSession: vi.fn(),
      onToggleArchivedSession: vi.fn(),
      onTogglePinnedSession: vi.fn(),
      onToggleTerminalWindowMaximized: vi.fn(),
      onWriteTerminalData: vi.fn(),
      placement: 'bottom',
      rootPath: 'E:/workspace',
      selectedCommandSession: undefined,
      setIsTerminalDockExpanded,
      startTerminalCommandPending: false,
      terminalDockClassName: 'terminal-dock',
      terminalWindowBounds: {
        height: 400,
        width: 800,
        x: 20,
        y: 20,
      },
      terminateDisabled: true,
    }
    const props = buildThreadTerminalDockProps(input)

    props?.onShow()

    expect(onShowTerminalDock).toHaveBeenCalledTimes(1)
    expect(setIsTerminalDockExpanded).toHaveBeenCalledWith(true)
    expect(onStartTerminalShellSession).not.toHaveBeenCalled()
  })

  it('does not auto-start a shell while a terminal session is already starting', () => {
    const onStartTerminalShellSession = vi.fn()

    const input: BuildThreadTerminalDockPropsInput = {
      activeCommandCount: 0,
      commandSessions: [],
      isMobileViewport: false,
      isTerminalDockExpanded: false,
      isTerminalDockVisible: false,
      isTerminalWindowMaximized: false,
      onChangePlacement: vi.fn(),
      onClearCompletedSessions: vi.fn(),
      onHideTerminalDock: vi.fn(),
      onRemoveSession: vi.fn(),
      onResetTerminalWindowBounds: vi.fn(),
      onResizeStart: vi.fn(),
      onResizeTerminal: vi.fn(),
      onSelectSession: vi.fn(),
      onShowTerminalDock: vi.fn(),
      onStartTerminalCommandLine: vi.fn(),
      onStartTerminalShellSession,
      onStartTerminalWindowDrag: vi.fn(),
      onStartTerminalWindowResize: vi.fn(),
      onTerminateSelectedSession: vi.fn(),
      onToggleArchivedSession: vi.fn(),
      onTogglePinnedSession: vi.fn(),
      onToggleTerminalWindowMaximized: vi.fn(),
      onWriteTerminalData: vi.fn(),
      placement: 'bottom',
      rootPath: 'E:/workspace',
      selectedCommandSession: undefined,
      setIsTerminalDockExpanded: vi.fn(),
      startTerminalCommandPending: true,
      terminalDockClassName: 'terminal-dock',
      terminalWindowBounds: {
        height: 400,
        width: 800,
        x: 20,
        y: 20,
      },
      terminateDisabled: true,
    }
    const props = buildThreadTerminalDockProps(input)

    props?.onShow()

    expect(onStartTerminalShellSession).not.toHaveBeenCalled()
  })
})
