// @vitest-environment jsdom

import { StrictMode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { i18n } from '../../i18n/runtime'
import { ThreadTerminalLauncherViewport } from './ThreadTerminalViewport'

const testState = vi.hoisted(() => ({
  animationFrames: new Map<number, FrameRequestCallback>(),
  nextAnimationFrameId: 1,
  terminals: [] as Array<{ writes: string[] }>,
}))

vi.mock('../settings/local-store', () => ({
  useSettingsLocalStore: (
    selector: (state: {
      terminalFont: string
      terminalFontSize: number
      terminalLineHeight: number
      terminalRenderer: 'dom'
    }) => unknown,
  ) =>
    selector({
      terminalFont: "ui-monospace, 'Cascadia Mono', monospace",
      terminalFontSize: 13,
      terminalLineHeight: 1,
      terminalRenderer: 'dom',
    }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    dispose() {}
    fit() {}
  },
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    dispose() {}
    findNext() {
      return false
    }
    findPrevious() {
      return false
    }
  },
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    public cols = 80
    public rows = 24
    public options: Record<string, unknown>
    public writes: string[] = []

    constructor(options: Record<string, unknown>) {
      this.options = { ...options }
      testState.terminals.push(this)
    }

    attachCustomKeyEventHandler() {
      return true
    }

    clearSelection() {}

    clearTextureAtlas() {}

    dispose() {}

    focus() {}

    getSelection() {
      return ''
    }

    loadAddon() {}

    onData() {
      return { dispose() {} }
    }

    onSelectionChange() {
      return { dispose() {} }
    }

    open() {}

    paste() {}

    reset() {}

    write(value: string) {
      this.writes.push(value)
    }
  },
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

function queueAnimationFrame(callback: FrameRequestCallback) {
  const id = testState.nextAnimationFrameId
  testState.nextAnimationFrameId += 1
  testState.animationFrames.set(id, callback)
  return id
}

function cancelQueuedAnimationFrame(id: number) {
  testState.animationFrames.delete(id)
}

function flushAnimationFrames() {
  while (testState.animationFrames.size > 0) {
    const callbacks = [...testState.animationFrames.values()]
    testState.animationFrames.clear()

    for (const callback of callbacks) {
      callback(0)
    }
  }
}

describe('ThreadTerminalLauncherViewport', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  beforeEach(() => {
    testState.animationFrames.clear()
    testState.nextAnimationFrameId = 1
    testState.terminals.length = 0

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('requestAnimationFrame', queueAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelQueuedAnimationFrame)

    window.requestAnimationFrame = queueAnimationFrame
    window.cancelAnimationFrame = cancelQueuedAnimationFrame
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('writes the shell launcher banner only once on the initial StrictMode mount', () => {
    render(
      <StrictMode>
        <ThreadTerminalLauncherViewport
          history={[]}
          mode="shell"
          onRunCommand={() => undefined}
          onStartShell={() => undefined}
          pending={false}
          shellLabel="PowerShell"
          visible
        />
      </StrictMode>,
    )

    flushAnimationFrames()

    const latestTerminal = testState.terminals.at(-1)

    expect(latestTerminal).toBeDefined()
    expect(
      latestTerminal?.writes.filter((value) => value.includes('new PowerShell session')),
    ).toHaveLength(1)
  })
})
