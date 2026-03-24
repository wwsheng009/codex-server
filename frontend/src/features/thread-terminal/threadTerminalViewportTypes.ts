import type { TerminalLauncherMode } from './threadTerminalDockTypes'

export type TerminalPerformanceInfo = {
  bytesPerSecond: number
  flushCount: number
  flushesPerSecond: number
  lastChunkSize: number
}

export type ThreadTerminalViewportHandle = {
  clearViewport: () => void
  copySelection: () => Promise<boolean>
  findNext: (query: string) => boolean
  findPrevious: (query: string) => boolean
  fitViewport: () => void
  focusViewport: () => void
  getDimensionsInfo: () => string
  getPerformanceInfo: () => TerminalPerformanceInfo
  getRendererInfo: () => string
  pasteFromClipboard: () => Promise<boolean>
}

export type ThreadTerminalLauncherHandle = {
  clearLauncher: () => void
  copySelection: () => Promise<boolean>
  fitLauncher: () => void
  focusLauncher: () => void
  getDimensionsInfo: () => string
  getPerformanceInfo: () => TerminalPerformanceInfo
  getRendererInfo: () => string
  pasteFromClipboard: () => Promise<boolean>
}

export type ThreadTerminalActiveViewportInput = {
  sessionId?: string
  viewportRefs: Record<string, ThreadTerminalViewportHandle | null>
}

export type ThreadTerminalViewportProps = {
  className?: string
  content: string
  interactive: boolean
  onResize: (cols: number, rows: number) => void
  onSelectionChange?: (hasSelection: boolean) => void
  onWriteData: (input: string) => void
  sessionId?: string
  visible: boolean
  windowsPty?: boolean
}

export type ThreadTerminalLauncherViewportProps = {
  className?: string
  history: string[]
  mode: TerminalLauncherMode
  onClose?: () => void
  onRunCommand: (command: string) => void
  onSelectionChange?: (hasSelection: boolean) => void
  onStartShell: () => void
  pending: boolean
  shellLabel?: string
  visible: boolean
}
