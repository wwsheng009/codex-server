import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'

import {
  useSettingsLocalStore,
} from '../settings/local-store'
import type { TerminalRendererPreference } from '../settings/local-store-types'
import type { TerminalLauncherMode } from './threadTerminalDockTypes'
import type {
  TerminalPerformanceInfo,
  ThreadTerminalLauncherHandle,
  ThreadTerminalLauncherViewportProps,
  ThreadTerminalViewportHandle,
  ThreadTerminalViewportProps,
} from './threadTerminalViewportTypes'

const TERMINAL_THEME = {
  background: '#0c1117',
  cursor: '#4ec6ff',
  foreground: '#edf2f7',
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
} as const

const DEFAULT_TERMINAL_FONT_FAMILY =
  "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Segoe UI Mono', monospace"
const DEFAULT_TERMINAL_FONT_SIZE = 12
const TERMINAL_LINE_HEIGHT = 1

const WINDOWS_PTY_OPTIONS = {
  backend: 'conpty',
  buildNumber: 26200,
} as const

export const TERMINAL_VIEWPORT_SCROLLBACK = 5000
export const TERMINAL_LAUNCHER_SCROLLBACK = 100
const TERMINAL_WRITE_CHUNK_SIZE = 16_384

export const ThreadTerminalViewport = forwardRef<
  ThreadTerminalViewportHandle,
  ThreadTerminalViewportProps
>(function ThreadTerminalViewport(
  {
    className,
    content,
    interactive,
    onResize,
    onSelectionChange,
    onWriteData,
    sessionId,
    visible,
    windowsPty,
  },
  ref,
) {
  const terminalFont = useSettingsLocalStore((state) => state.terminalFont)
  const terminalFontSizeSetting = useSettingsLocalStore((state) => state.terminalFontSize)
  const terminalLineHeightSetting = useSettingsLocalStore((state) => state.terminalLineHeight)
  const terminalRenderer = useSettingsLocalStore((state) => state.terminalRenderer)
  const terminalFontFamily = resolveTerminalFontFamily(terminalFont)
  const terminalFontSize = resolveTerminalFontSize(terminalFontSizeSetting)
  const terminalLineHeight = resolveTerminalLineHeight(terminalLineHeightSetting)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const webglAddonRef = useRef<{ dispose: () => void } | null>(null)
  const latestContentRef = useRef('')
  const latestSessionIdRef = useRef<string | undefined>(undefined)
  const latestInteractiveRef = useRef(interactive)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onResizeRef = useRef(onResize)
  const onWriteDataRef = useRef(onWriteData)
  const flushCountRef = useRef(0)
  const lastChunkSizeRef = useRef(0)
  const writeSamplesRef = useRef<Array<{ size: number; ts: number }>>([])
  const queuedWriteRef = useRef('')
  const queuedWriteFrameRef = useRef<number | undefined>(undefined)
  const fitFrameRef = useRef<number | undefined>(undefined)
  const resizeTimerRef = useRef<number | undefined>(undefined)
  const lastResizeRef = useRef<
    { cols: number; rows: number; sessionId?: string } | undefined
  >(undefined)
  const clearQueuedWritesRef = useRef<() => void>(() => undefined)
  const enqueueWriteRef = useRef<
    (value: string, options?: { replace?: boolean }) => void
  >(() => undefined)
  const requestFitRef = useRef<() => void>(() => undefined)
  const scheduleResizeRef = useRef<() => void>(() => undefined)

  onResizeRef.current = onResize
  onSelectionChangeRef.current = onSelectionChange
  onWriteDataRef.current = onWriteData
  latestInteractiveRef.current = interactive

  useImperativeHandle(
    ref,
    () => ({
      clearViewport() {
        terminalRef.current?.clear()
      },
      copySelection() {
        return copyTerminalSelection(terminalRef.current)
      },
      getDimensionsInfo() {
        const terminal = terminalRef.current
        return terminal ? `${terminal.cols}x${terminal.rows}` : '0x0'
      },
      getPerformanceInfo() {
        return getTerminalPerformanceInfo(
          flushCountRef.current,
          lastChunkSizeRef.current,
          writeSamplesRef.current,
        )
      },
      getRendererInfo() {
        return webglAddonRef.current ? 'webgl' : 'dom'
      },
      findNext(query: string) {
        if (!query.trim()) {
          return false
        }

        return searchAddonRef.current?.findNext(query, {
          caseSensitive: false,
          incremental: false,
          regex: false,
        }) ?? false
      },
      findPrevious(query: string) {
        if (!query.trim()) {
          return false
        }

        return searchAddonRef.current?.findPrevious(query, {
          caseSensitive: false,
          incremental: false,
          regex: false,
        }) ?? false
      },
      fitViewport() {
        fitAddonRef.current?.fit()
        scheduleResizeRef.current()
      },
      focusViewport() {
        terminalRef.current?.focus()
      },
      pasteFromClipboard() {
        return pasteClipboardIntoTerminal(
          terminalRef.current,
          latestInteractiveRef.current && Boolean(latestSessionIdRef.current),
        )
      },
    }),
    [],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorInactiveStyle: 'bar',
      disableStdin: !latestInteractiveRef.current,
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
      lineHeight: terminalLineHeight,
      scrollback: TERMINAL_VIEWPORT_SCROLLBACK,
      theme: TERMINAL_THEME,
      ...(windowsPty ? { windowsPty: WINDOWS_PTY_OPTIONS } : {}),
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.open(host)
    void syncTerminalRenderer(terminal, webglAddonRef, terminalRenderer)
    terminal.attachCustomKeyEventHandler((event) => {
      if (shouldCopyTerminalSelection(event, terminal.getSelection())) {
        void copyTerminalSelection(terminal)
        return false
      }

      if (shouldPasteFromClipboardShortcut(event)) {
        void pasteClipboardIntoTerminal(
          terminal,
          latestInteractiveRef.current && Boolean(latestSessionIdRef.current),
        )
        return false
      }

      return true
    })
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    const dataDisposable = terminal.onData((data) => {
      if (!latestInteractiveRef.current || !latestSessionIdRef.current) {
        return
      }

      onWriteDataRef.current(data)
    })
    const selectionDisposable = terminal.onSelectionChange(() => {
      onSelectionChangeRef.current?.(Boolean(terminal.getSelection()))
    })

    clearQueuedWritesRef.current = () => {
      if (queuedWriteFrameRef.current !== undefined) {
        window.cancelAnimationFrame(queuedWriteFrameRef.current)
      }
      queuedWriteFrameRef.current = undefined
      queuedWriteRef.current = ''
    }

    requestFitRef.current = () => {
      if (fitFrameRef.current !== undefined) {
        return
      }

      fitFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameRef.current = undefined
        fitAddon.fit()
        scheduleResizeRef.current()
      })
    }

    enqueueWriteRef.current = (value, options) => {
      if (!value) {
        return
      }

      if (options?.replace) {
        queuedWriteRef.current = value
      } else {
        queuedWriteRef.current += value
      }

      if (queuedWriteFrameRef.current !== undefined) {
        return
      }

      const flushQueuedWrite = () => {
        queuedWriteFrameRef.current = undefined
        const nextChunk = queuedWriteRef.current.slice(0, TERMINAL_WRITE_CHUNK_SIZE)
        queuedWriteRef.current = queuedWriteRef.current.slice(nextChunk.length)
        if (!nextChunk) {
          return
        }

        terminal.write(nextChunk)
        recordTerminalWriteSample(flushCountRef, lastChunkSizeRef, writeSamplesRef, nextChunk.length)

        if (queuedWriteRef.current) {
          queuedWriteFrameRef.current = window.requestAnimationFrame(flushQueuedWrite)
        }
      }

      queuedWriteFrameRef.current = window.requestAnimationFrame(flushQueuedWrite)
    }

    function handleBrowserCopy(event: ClipboardEvent) {
      const selection = terminal.getSelection()
      if (!selection) {
        return
      }

      event.clipboardData?.setData('text/plain', selection)
      event.preventDefault()
      terminal.clearSelection()
    }

    function handleBrowserPaste(event: ClipboardEvent) {
      if (!latestInteractiveRef.current || !latestSessionIdRef.current) {
        return
      }

      const text = event.clipboardData?.getData('text/plain')
      if (!text) {
        return
      }

      event.preventDefault()
      terminal.paste(text)
    }

    scheduleResizeRef.current = () => {
      const currentTerminal = terminalRef.current
      const activeSessionId = latestSessionIdRef.current
      if (!currentTerminal || !activeSessionId) {
        return
      }

      const nextCols = currentTerminal.cols
      const nextRows = currentTerminal.rows
      const lastResize = lastResizeRef.current
      if (
        lastResize?.sessionId === activeSessionId &&
        lastResize.cols === nextCols &&
        lastResize.rows === nextRows
      ) {
        return
      }

      window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = window.setTimeout(() => {
        lastResizeRef.current = {
          cols: nextCols,
          rows: nextRows,
          sessionId: activeSessionId,
        }
        onResizeRef.current(nextCols, nextRows)
      }, 80)
    }

    const resizeObserver = new ResizeObserver(() => {
      requestFitRef.current()
    })

    resizeObserver.observe(host)
    requestFitRef.current()

    host.addEventListener('pointerdown', handleFocusTerminal)
    host.addEventListener('copy', handleBrowserCopy)
    host.addEventListener('paste', handleBrowserPaste)

    return () => {
      host.removeEventListener('pointerdown', handleFocusTerminal)
      host.removeEventListener('copy', handleBrowserCopy)
      host.removeEventListener('paste', handleBrowserPaste)
      clearQueuedWritesRef.current()
      if (fitFrameRef.current !== undefined) {
        window.cancelAnimationFrame(fitFrameRef.current)
      }
      fitFrameRef.current = undefined
      window.clearTimeout(resizeTimerRef.current)
      resizeObserver.disconnect()
      dataDisposable.dispose()
      selectionDisposable.dispose()
      fitAddon.dispose()
      searchAddon.dispose()
      webglAddonRef.current?.dispose()
      webglAddonRef.current = null
      terminal.dispose()
      fitAddonRef.current = null
      searchAddonRef.current = null
      terminalRef.current = null
      latestContentRef.current = ''
      latestSessionIdRef.current = undefined
      onSelectionChangeRef.current?.(false)
      clearQueuedWritesRef.current = () => undefined
      enqueueWriteRef.current = () => undefined
      requestFitRef.current = () => undefined
      scheduleResizeRef.current = () => undefined
    }
  }, [])

  useEffect(() => {
    applyTerminalTypographySettings(
      terminalRef.current,
      terminalFontFamily,
      terminalFontSize,
      terminalLineHeight,
    )
    requestFitRef.current()
  }, [terminalFontFamily, terminalFontSize, terminalLineHeight])

  useEffect(() => {
    void syncTerminalRenderer(terminalRef.current, webglAddonRef, terminalRenderer)
  }, [terminalRenderer])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.options.disableStdin = !interactive
  }, [interactive])

  useEffect(() => {
    if (!visible) {
      return
    }

    if (!interactive) {
      requestFitRef.current()
      return
    }

    requestAnimationFrame(() => {
      requestFitRef.current()
      terminalRef.current?.focus()
    })
  }, [interactive, visible])

  useEffect(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon) {
      return
    }

    const sessionChanged = latestSessionIdRef.current !== sessionId
    latestSessionIdRef.current = sessionId

    if (sessionChanged) {
      clearQueuedWritesRef.current()
      terminal.reset()
      terminal.options.disableStdin = !interactive
      latestContentRef.current = ''
      lastResizeRef.current = undefined
      onSelectionChangeRef.current?.(false)
      requestFitRef.current()
    }

    if (!content) {
      clearQueuedWritesRef.current()
      latestContentRef.current = ''
      onSelectionChangeRef.current?.(false)
      return
    }

    if (!sessionChanged && content.startsWith(latestContentRef.current)) {
      const delta = content.slice(latestContentRef.current.length)
      if (delta) {
        enqueueWriteRef.current(delta)
      }
    } else {
      clearQueuedWritesRef.current()
      terminal.reset()
      terminal.options.disableStdin = !interactive
      enqueueWriteRef.current(content, { replace: true })
    }

    latestContentRef.current = content
  }, [content, interactive, sessionId])

  function handleFocusTerminal() {
    if (!visible) {
      return
    }

    terminalRef.current?.focus()
  }

  return <div className={className} ref={hostRef} />
})

export const ThreadTerminalLauncherViewport = forwardRef<
  ThreadTerminalLauncherHandle,
  ThreadTerminalLauncherViewportProps
>(function ThreadTerminalLauncherViewport(
  {
    className,
    history,
    mode,
    onClose,
    onRunCommand,
    onSelectionChange,
    onStartShell,
    pending,
    shellLabel,
    visible,
  },
  ref,
) {
  const terminalFont = useSettingsLocalStore((state) => state.terminalFont)
  const terminalFontSizeSetting = useSettingsLocalStore((state) => state.terminalFontSize)
  const terminalLineHeightSetting = useSettingsLocalStore((state) => state.terminalLineHeight)
  const terminalRenderer = useSettingsLocalStore((state) => state.terminalRenderer)
  const terminalFontFamily = resolveTerminalFontFamily(terminalFont)
  const terminalFontSize = resolveTerminalFontSize(terminalFontSizeSetting)
  const terminalLineHeight = resolveTerminalLineHeight(terminalLineHeightSetting)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<{ dispose: () => void } | null>(null)
  const fitFrameRef = useRef<number | undefined>(undefined)
  const modeRef = useRef<TerminalLauncherMode>(mode)
  const pendingRef = useRef(pending)
  const historyRef = useRef(history)
  const currentInputRef = useRef('')
  const flushCountRef = useRef(0)
  const historyIndexRef = useRef<number>(-1)
  const lastChunkSizeRef = useRef(0)
  const awaitingRunRef = useRef(false)
  const onStartShellRef = useRef(onStartShell)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onRunCommandRef = useRef(onRunCommand)
  const writeSamplesRef = useRef<Array<{ size: number; ts: number }>>([])

  modeRef.current = mode
  pendingRef.current = pending
  historyRef.current = history
  onStartShellRef.current = onStartShell
  onSelectionChangeRef.current = onSelectionChange
  onRunCommandRef.current = onRunCommand

  useImperativeHandle(
    ref,
    () => ({
      clearLauncher() {
        resetLauncher()
      },
      copySelection() {
        return copyTerminalSelection(terminalRef.current)
      },
      fitLauncher() {
        fitAddonRef.current?.fit()
      },
      focusLauncher() {
        terminalRef.current?.focus()
      },
      getDimensionsInfo() {
        const terminal = terminalRef.current
        return terminal ? `${terminal.cols}x${terminal.rows}` : '0x0'
      },
      getPerformanceInfo() {
        return getTerminalPerformanceInfo(
          flushCountRef.current,
          lastChunkSizeRef.current,
          writeSamplesRef.current,
        )
      },
      getRendererInfo() {
        return webglAddonRef.current ? 'webgl' : 'dom'
      },
      pasteFromClipboard() {
        return pasteClipboardIntoLauncher()
      },
    }),
    [],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      disableStdin: false,
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
      lineHeight: terminalLineHeight,
      scrollback: TERMINAL_LAUNCHER_SCROLLBACK,
      theme: TERMINAL_THEME,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    void syncTerminalRenderer(terminal, webglAddonRef, terminalRenderer)
    terminal.attachCustomKeyEventHandler((event) => {
      if (shouldCopyTerminalSelection(event, terminal.getSelection())) {
        void copyTerminalSelection(terminal)
        return false
      }

      if (shouldPasteFromClipboardShortcut(event)) {
        void pasteClipboardIntoLauncher()
        return false
      }

      return true
    })
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    function requestFit() {
      if (fitFrameRef.current !== undefined) {
        return
      }

      fitFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameRef.current = undefined
        fitAddon.fit()
      })
    }

    const dataDisposable = terminal.onData((data) => {
      handleLauncherInput(data)
    })
    const selectionDisposable = terminal.onSelectionChange(() => {
      onSelectionChangeRef.current?.(Boolean(terminal.getSelection()))
    })

    function handleBrowserCopy(event: ClipboardEvent) {
      const selection = terminal.getSelection()
      if (!selection) {
        return
      }

      event.clipboardData?.setData('text/plain', selection)
      event.preventDefault()
      terminal.clearSelection()
    }

    function handleBrowserPaste(event: ClipboardEvent) {
      const text = event.clipboardData?.getData('text/plain')
      if (!text) {
        return
      }

      event.preventDefault()
      applyLauncherPasteText(text)
    }

    requestFit()
    window.requestAnimationFrame(() => {
      resetLauncher()
    })

    host.addEventListener('pointerdown', handleFocusLauncher)
    host.addEventListener('copy', handleBrowserCopy)
    host.addEventListener('paste', handleBrowserPaste)

    return () => {
      host.removeEventListener('pointerdown', handleFocusLauncher)
      host.removeEventListener('copy', handleBrowserCopy)
      host.removeEventListener('paste', handleBrowserPaste)
      dataDisposable.dispose()
      selectionDisposable.dispose()
      if (fitFrameRef.current !== undefined) {
        window.cancelAnimationFrame(fitFrameRef.current)
      }
      fitAddon.dispose()
      webglAddonRef.current?.dispose()
      webglAddonRef.current = null
      terminal.dispose()
      fitAddonRef.current = null
      terminalRef.current = null
      onSelectionChangeRef.current?.(false)
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    applyTerminalTypographySettings(
      terminal,
      terminalFontFamily,
      terminalFontSize,
      terminalLineHeight,
    )
    fitAddonRef.current?.fit()
  }, [terminalFontFamily, terminalFontSize, terminalLineHeight])

  useEffect(() => {
    void syncTerminalRenderer(terminalRef.current, webglAddonRef, terminalRenderer)
  }, [terminalRenderer])

  useEffect(() => {
    if (!visible) {
      return
    }

    requestAnimationFrame(() => {
      fitAddonRef.current?.fit()
      terminalRef.current?.focus()
      if (!awaitingRunRef.current) {
        writePrompt()
      }
    })
  }, [visible])

  useEffect(() => {
    if (!visible) {
      return
    }

    resetLauncher()
  }, [mode, shellLabel, visible])

  useEffect(() => {
    if (pendingRef.current || !awaitingRunRef.current || pending) {
      return
    }

    awaitingRunRef.current = false
    writePrompt(true)
  }, [pending])

  function handleFocusLauncher() {
    if (!visible) {
      return
    }

    terminalRef.current?.focus()
  }

  function writeLauncherOutput(value: string) {
    const terminal = terminalRef.current
    if (!terminal || !value) {
      return
    }

    terminal.write(value)
    recordTerminalWriteSample(flushCountRef, lastChunkSizeRef, writeSamplesRef, value.length)
  }

  async function pasteClipboardIntoLauncher() {
    if (modeRef.current !== 'command') {
      return false
    }

    const text = await readTextFromClipboard()
    if (!text) {
      return false
    }

    applyLauncherPasteText(text)
    return true
  }

  function resetLauncher() {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.reset()
    currentInputRef.current = ''
    historyIndexRef.current = -1
    awaitingRunRef.current = false
    onSelectionChangeRef.current?.(false)

    if (modeRef.current === 'shell') {
      writeLauncherOutput(
        `\x1b[90mnew ${shellLabel ?? 'shell'} session  enter start  ctrl/cmd+k command launcher  esc back\x1b[0m\r\n`,
      )
    } else {
      writeLauncherOutput(
        '\x1b[90mrun one-shot command  enter run  up/down history  esc back\x1b[0m\r\n',
      )
    }

    writePrompt(true)
  }

  function applyLauncherPasteText(value: string) {
    if (pendingRef.current || modeRef.current !== 'command') {
      return
    }

    const sanitized = sanitizeLauncherPasteText(value)
    if (!sanitized) {
      return
    }

    currentInputRef.current += sanitized
    writePrompt()
  }

  function writePrompt(forceNewLine = false) {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const prompt =
      modeRef.current === 'shell'
        ? `[enter] start ${shellLabel ?? 'shell'}`
        : `$ ${sanitizeLauncherText(currentInputRef.current)}`
    writeLauncherOutput(`${forceNewLine ? '' : '\r'}\x1b[2K\r${prompt}`)
  }

  function handleLauncherInput(data: string) {
    const terminal = terminalRef.current
    if (!terminal || pendingRef.current) {
      return
    }

    switch (data) {
      case '\r': {
        if (modeRef.current === 'shell') {
          writeLauncherOutput('\r\n')
          awaitingRunRef.current = true
          onStartShellRef.current()
          return
        }

        const command = currentInputRef.current.trim()
        writeLauncherOutput('\r\n')
        historyIndexRef.current = -1

        if (!command) {
          writePrompt()
          return
        }

        awaitingRunRef.current = true
        onRunCommandRef.current(command)
        currentInputRef.current = ''
        return
      }
      case '\x7f': {
        if (modeRef.current !== 'command') {
          return
        }

        currentInputRef.current = currentInputRef.current.slice(0, -1)
        writePrompt()
        return
      }
      case '\x1b[A': {
        if (modeRef.current !== 'command') {
          return
        }

        const nextCommand = resolveHistoryCommand(-1)
        if (nextCommand !== null) {
          currentInputRef.current = nextCommand
          writePrompt()
        }
        return
      }
      case '\x1b[B': {
        if (modeRef.current !== 'command') {
          return
        }

        const nextCommand = resolveHistoryCommand(1)
        if (nextCommand !== null) {
          currentInputRef.current = nextCommand
          writePrompt()
        }
        return
      }
      case '\x0c': {
        resetLauncher()
        return
      }
      case '\x1b': {
        if (onClose) {
          onClose()
        }
        return
      }
      default: {
        if (modeRef.current !== 'command' || !isPrintableInput(data)) {
          return
        }

        currentInputRef.current += sanitizeLauncherText(data)
        writePrompt()
      }
    }
  }

  function resolveHistoryCommand(step: -1 | 1) {
    const terminalHistory = historyRef.current
    if (!terminalHistory.length) {
      return null
    }

    if (step === -1) {
      const nextIndex =
        historyIndexRef.current < 0
          ? terminalHistory.length - 1
          : Math.max(0, historyIndexRef.current - 1)
      historyIndexRef.current = nextIndex
      return terminalHistory[nextIndex] ?? ''
    }

    if (historyIndexRef.current < 0) {
      return currentInputRef.current
    }

    const nextIndex = historyIndexRef.current + 1
    if (nextIndex >= terminalHistory.length) {
      historyIndexRef.current = -1
      return ''
    }

    historyIndexRef.current = nextIndex
    return terminalHistory[nextIndex] ?? ''
  }

  return <div className={className} ref={hostRef} />
})

function isPrintableInput(value: string) {
  if (!value) {
    return false
  }

  return !value.includes('\x1b') && !value.includes('\r') && !value.includes('\n')
}

function sanitizeLauncherText(value: string) {
  return value.replace(/[\r\n\x1b]/g, '')
}

function sanitizeLauncherPasteText(value: string) {
  return value.replace(/\r\n?/g, ' ').replace(/\n/g, ' ').replace(/\x1b/g, '')
}

function resolveTerminalFontFamily(value?: string) {
  const trimmed = value?.trim()
  return trimmed || DEFAULT_TERMINAL_FONT_FAMILY
}

function resolveTerminalFontSize(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_FONT_SIZE
  }

  return Math.max(10, value)
}

function resolveTerminalLineHeight(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return TERMINAL_LINE_HEIGHT
  }

  return Math.min(2, Math.max(1, value))
}

function applyTerminalTypographySettings(
  terminal: Terminal | null,
  fontFamily: string,
  fontSize: number,
  lineHeight: number,
) {
  if (!terminal) {
    return
  }

  const fontFamilyChanged = terminal.options.fontFamily !== fontFamily
  const fontSizeChanged = terminal.options.fontSize !== fontSize
  const lineHeightChanged = terminal.options.lineHeight !== lineHeight
  if (!fontFamilyChanged && !fontSizeChanged && !lineHeightChanged) {
    return
  }

  terminal.options.fontFamily = fontFamily
  terminal.options.fontSize = fontSize
  terminal.options.lineHeight = lineHeight
  if (fontFamilyChanged || fontSizeChanged) {
    terminal.clearTextureAtlas()
  }
}

function shouldCopyTerminalSelection(event: KeyboardEvent, selection: string) {
  if (!selection) {
    return false
  }

  const key = event.key.toLowerCase()

  if (event.metaKey && !event.ctrlKey && !event.altKey && key === 'c') {
    return true
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    if (key === 'insert') {
      return true
    }

    if (key === 'c') {
      return true
    }
  }

  return false
}

function shouldPasteFromClipboardShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase()

  if (event.metaKey && !event.ctrlKey && !event.altKey && key === 'v') {
    return true
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && key === 'v') {
    return true
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && key === 'insert') {
    return true
  }

  return false
}

async function copyTerminalSelection(terminal: Terminal | null) {
  const selection = terminal?.getSelection()
  if (!selection) {
    return false
  }

  const copied = await writeTextToClipboard(selection)
  if (copied) {
    terminal?.clearSelection()
  }

  return copied
}

async function pasteClipboardIntoTerminal(terminal: Terminal | null, enabled: boolean) {
  if (!terminal || !enabled) {
    return false
  }

  const text = await readTextFromClipboard()
  if (!text) {
    return false
  }

  terminal.paste(text)
  return true
}

async function readTextFromClipboard() {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return ''
  }

  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

async function writeTextToClipboard(value: string) {
  if (!value) {
    return false
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall back to a DOM-based copy path.
    }
  }

  if (typeof document === 'undefined') {
    return false
  }

  const textArea = document.createElement('textarea')
  textArea.value = value
  textArea.setAttribute('readonly', 'true')
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  textArea.style.pointerEvents = 'none'
  document.body.appendChild(textArea)
  textArea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textArea.remove()
  }
}

function recordTerminalWriteSample(
  flushCountRef: { current: number },
  lastChunkSizeRef: { current: number },
  writeSamplesRef: { current: Array<{ size: number; ts: number }> },
  size: number,
) {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()

  flushCountRef.current += 1
  lastChunkSizeRef.current = size
  writeSamplesRef.current.push({ size, ts: now })
  pruneTerminalWriteSamples(writeSamplesRef.current, now)
}

function pruneTerminalWriteSamples(samples: Array<{ size: number; ts: number }>, now: number) {
  const windowStart = now - 1000
  let firstValidIndex = 0

  while (firstValidIndex < samples.length && samples[firstValidIndex].ts < windowStart) {
    firstValidIndex += 1
  }

  if (firstValidIndex > 0) {
    samples.splice(0, firstValidIndex)
  }
}

function getTerminalPerformanceInfo(
  flushCount: number,
  lastChunkSize: number,
  samples: Array<{ size: number; ts: number }>,
): TerminalPerformanceInfo {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  pruneTerminalWriteSamples(samples, now)

  return {
    bytesPerSecond: samples.reduce((total, sample) => total + sample.size, 0),
    flushCount,
    flushesPerSecond: samples.length,
    lastChunkSize,
  }
}

async function syncTerminalRenderer(
  terminal: Terminal | null,
  webglAddonRef: { current: { dispose: () => void } | null },
  rendererPreference: TerminalRendererPreference,
) {
  if (!terminal || typeof window === 'undefined') {
    return
  }

  if (rendererPreference === 'dom') {
    webglAddonRef.current?.dispose()
    webglAddonRef.current = null
    return
  }

  if (webglAddonRef.current) {
    return
  }

  try {
    const module = await import('@xterm/addon-webgl')
    const addon = new module.WebglAddon()
    terminal.loadAddon(addon)
    webglAddonRef.current = addon
  } catch {
    webglAddonRef.current = null
  }
}
