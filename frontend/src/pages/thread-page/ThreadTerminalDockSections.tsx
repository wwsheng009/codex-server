import { useQuery } from '@tanstack/react-query'
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { ResizeHandle } from '../../components/ui/RailControls'
import { ThreadTerminalBlock } from '../../components/thread/ThreadContent'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import { readRuntimePreferences } from '../../features/settings/api'
import { i18n } from '../../i18n/runtime'
import { COMMAND_SESSION_OUTPUT_LIMIT } from '../../stores/session-store'
import { useUIStore } from '../../stores/ui-store'
import { SelectControl, type SelectOption } from '../../components/ui/SelectControl'
import { ThreadTerminalToolbar } from './ThreadTerminalToolbar'
import type { TerminalDockPlacement } from '../../lib/layout-config'
import {
  TERMINAL_LAUNCHER_SCROLLBACK,
  TERMINAL_VIEWPORT_SCROLLBACK,
  type ThreadTerminalLauncherHandle,
  type ThreadTerminalViewportHandle,
} from './ThreadTerminalViewport'
import {
  TERMINAL_STRESS_HISTORY_LIMIT,
  TERMINAL_STRESS_HISTORY_STORAGE_KEY,
  compareTerminalStressRuns,
  createTerminalStressExport,
  parseTerminalStressHistory,
  serializeTerminalStressHistory,
  toCompletedTerminalStressRun,
  type CompletedTerminalStressRun,
  type TerminalStressComparisonMetric,
  type TerminalStressRun,
  type TerminalStressRunConfig,
} from './threadTerminalStressUtils'
import type { ThreadTerminalDockProps } from './threadTerminalDockTypes'

const ThreadTerminalViewport = lazy(async () =>
  import('./ThreadTerminalViewport').then((module) => ({
    default: module.ThreadTerminalViewport,
  })),
)

const ThreadTerminalLauncherViewport = lazy(async () =>
  import('./ThreadTerminalViewport').then((module) => ({
    default: module.ThreadTerminalLauncherViewport,
  })),
)

type TerminalLauncherMode = 'shell' | 'command'

export function formatCommandSessionStatus(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'starting':
      return i18n._({
        id: 'Starting',
        message: 'Starting',
      })
    case 'running':
    case 'processing':
      return i18n._({
        id: 'Processing',
        message: 'Processing',
      })
    case 'completed':
      return i18n._({
        id: 'Completed',
        message: 'Completed',
      })
    case 'failed':
    case 'error':
      return i18n._({
        id: 'Error',
        message: 'Error',
      })
    case 'idle':
    case '':
      return i18n._({
        id: 'Idle',
        message: 'Idle',
      })
    default:
      return value ?? ''
  }
}

function formatCommandSessionMode(value?: string) {
  switch ((value ?? '').toLowerCase()) {
    case 'shell':
      return i18n._({
        id: 'Shell session',
        message: 'Shell session',
      })
    case 'command':
      return i18n._({
        id: 'Command session',
        message: 'Command session',
      })
    default:
      return i18n._({
        id: 'Terminal session',
        message: 'Terminal session',
      })
  }
}

function formatShellDisplayName(shellPath?: string, fallback?: string) {
  const normalized = `${shellPath ?? ''} ${fallback ?? ''}`.toLowerCase()

  if (normalized.includes('pwsh') || normalized.includes('powershell')) {
    return i18n._({
      id: 'PowerShell',
      message: 'PowerShell',
    })
  }

  if (normalized.includes('cmd.exe') || normalized.includes('command prompt')) {
    return i18n._({
      id: 'Command Prompt',
      message: 'Command Prompt',
    })
  }

  if (isGitBashShell(normalized)) {
    return i18n._({
      id: 'Git Bash',
      message: 'Git Bash',
    })
  }

  if (isWslShimShell(normalized)) {
    return 'WSL'
  }

  if (normalized.includes('zsh')) {
    return 'zsh'
  }

  if (normalized.includes('bash')) {
    return 'bash'
  }

  if (normalized.includes('/bin/sh') || normalized.endsWith(' sh') || normalized === 'sh') {
    return 'sh'
  }

  return fallback || shellPath || i18n._({
    id: 'Shell',
    message: 'Shell',
  })
}

function isWindowsWorkspace(rootPath?: string) {
  if (!rootPath) {
    return false
  }

  return /^[a-z]:[\\/]/i.test(rootPath) || /^\\\\/.test(rootPath)
}

function isWindowsCommandSession(
  session: ThreadTerminalDockProps['selectedCommandSession'],
  rootPath?: string,
) {
  if (!session) {
    return isWindowsWorkspace(rootPath)
  }

  return isWindowsWorkspace(session.currentCwd) ||
    isWindowsWorkspace(session.initialCwd) ||
    isWindowsWorkspace(session.shellPath) ||
    isWindowsWorkspace(rootPath)
}

function formatDefaultShellLauncherName(rootPath?: string) {
  if (isWindowsWorkspace(rootPath)) {
    return i18n._({
      id: 'PowerShell',
      message: 'PowerShell',
    })
  }

  return i18n._({
    id: 'Shell',
    message: 'Shell',
  })
}

function formatTerminalShellLauncherName(rootPath?: string, shell?: string) {
  switch ((shell ?? '').trim().toLowerCase()) {
    case 'pwsh':
      return i18n._({
        id: 'PowerShell 7 (pwsh)',
        message: 'PowerShell 7 (pwsh)',
      })
    case 'powershell':
      return i18n._({
        id: 'Windows PowerShell',
        message: 'Windows PowerShell',
      })
    case 'cmd':
      return i18n._({
        id: 'Command Prompt',
        message: 'Command Prompt',
      })
    case 'wsl':
      return 'WSL'
    case 'git-bash':
      return i18n._({
        id: 'Git Bash',
        message: 'Git Bash',
      })
    case 'bash':
      return 'bash'
    case 'zsh':
      return 'zsh'
    case 'sh':
      return 'sh'
    default:
      return formatDefaultShellLauncherName(rootPath)
  }
}

function buildTerminalShellOptions(
  supportedShells: string[],
  currentShell?: string,
): SelectOption[] {
  const options: SelectOption[] = [
    {
      value: '',
      label: i18n._({
        id: 'Auto select shell',
        message: 'Auto select shell',
      }),
      triggerLabel: i18n._({ id: 'Auto', message: 'Auto' }),
    },
  ]

  for (const shell of supportedShells) {
    options.push({
      value: shell,
      label: formatTerminalShellLauncherName(undefined, shell),
      triggerLabel:
        shell === 'pwsh' || shell === 'cmd' || shell === 'wsl'
          ? shell.toUpperCase() === 'CMD'
            ? 'cmd'
            : shell === 'pwsh'
              ? 'pwsh'
              : 'WSL'
          : formatTerminalShellLauncherName(undefined, shell),
    })
  }

  const normalizedCurrentShell = (currentShell ?? '').trim().toLowerCase()
  if (
    normalizedCurrentShell &&
    !options.some((option) => option.value === normalizedCurrentShell)
  ) {
    options.push({
      value: normalizedCurrentShell,
      label: i18n._({
        id: '{shell} (saved, unavailable)',
        message: '{shell} (saved, unavailable)',
        values: {
          shell: formatTerminalShellLauncherName(undefined, normalizedCurrentShell),
        },
      }),
      triggerLabel: formatTerminalShellLauncherName(undefined, normalizedCurrentShell),
      disabled: true,
    })
  }

  return options
}

function formatCommandSessionTitle(
  session: ThreadTerminalDockProps['selectedCommandSession'],
) {
  if (!session) {
    return i18n._({
      id: 'Terminal',
      message: 'Terminal',
    })
  }

  if (session.mode === 'shell') {
    return formatShellDisplayName(session.shellPath, session.command)
  }

  return session.command || i18n._({
    id: 'Terminal',
    message: 'Terminal',
  })
}

function hasLimitedShellIntegration(
  session: ThreadTerminalDockProps['selectedCommandSession'],
) {
  if (!session || session.mode !== 'shell') {
    return false
  }

  const normalized = `${session.shellPath ?? ''} ${session.command ?? ''}`.toLowerCase()
  return normalized.includes('cmd.exe') ||
    normalized.includes('command prompt') ||
    isWslShimShell(normalized)
}

function isGitBashShell(normalizedValue: string) {
  return normalizedValue.includes('\\program files\\git\\') ||
    normalizedValue.includes('/program files/git/') ||
    normalizedValue.includes('git-bash.exe')
}

function isWslShimShell(normalizedValue: string) {
  return normalizedValue.includes('wsl.exe') ||
    normalizedValue.includes('\\windows\\system32\\bash.exe') ||
    normalizedValue.includes('/windows/system32/bash.exe') ||
    normalizedValue === 'wsl' ||
    normalizedValue === 'bash.exe'
}

function formatShellSessionActivity(value?: string) {
  switch ((value ?? '').toLowerCase()) {
    case 'prompt':
      return i18n._({
        id: 'Prompt ready',
        message: 'Prompt ready',
      })
    case 'running':
      return i18n._({
        id: 'Running command',
        message: 'Running command',
      })
    case 'starting':
      return i18n._({
        id: 'Starting shell',
        message: 'Starting shell',
      })
    default:
      return ''
  }
}

const isTerminalDebugEnabled = import.meta.env.DEV
const terminalStressTestDurationMs = 10_000

type DebugTone = 'neutral' | 'warn' | 'danger' | 'good'

function parseDimensionsInfo(value: string) {
  const [colsRaw, rowsRaw] = value.split('x')
  const cols = Number(colsRaw)
  const rows = Number(rowsRaw)

  return {
    cols: Number.isFinite(cols) ? cols : 0,
    rows: Number.isFinite(rows) ? rows : 0,
  }
}

function getRendererDebugTone(
  renderer: string,
  rate: number,
  outputLength: number,
): DebugTone {
  if (renderer === 'webgl' || renderer === 'static') {
    return 'good'
  }

  if (rate > 32_000 || outputLength > 64_000) {
    return 'warn'
  }

  return 'neutral'
}

function getSizeDebugTone(value: string): DebugTone {
  const { cols, rows } = parseDimensionsInfo(value)

  if (cols > 280 || rows > 90) {
    return 'danger'
  }

  if (cols > 220 || rows > 70) {
    return 'warn'
  }

  return 'neutral'
}

function getOutputDebugTone(outputLength: number): DebugTone {
  if (outputLength > 112_000) {
    return 'danger'
  }

  if (outputLength > 64_000) {
    return 'warn'
  }

  return 'neutral'
}

function getRateDebugTone(rate: number): DebugTone {
  if (rate > 96_000) {
    return 'danger'
  }

  if (rate > 32_000) {
    return 'warn'
  }

  return 'neutral'
}

function getFlushRateDebugTone(flushesPerSecond: number): DebugTone {
  if (flushesPerSecond > 120) {
    return 'danger'
  }

  if (flushesPerSecond > 45) {
    return 'warn'
  }

  return 'neutral'
}

function getChunkDebugTone(lastChunkSize: number): DebugTone {
  if (lastChunkSize > 32_000) {
    return 'danger'
  }

  if (lastChunkSize > 8_000) {
    return 'warn'
  }

  return 'neutral'
}

function getReplayAppendDebugTone(replayAppendCount: number): DebugTone {
  if (replayAppendCount > 0) {
    return 'good'
  }

  return 'neutral'
}

function getReplayReplaceDebugTone(replayReplaceCount: number): DebugTone {
  if (replayReplaceCount > 0) {
    return 'warn'
  }

  return 'good'
}

function buildTerminalDebugSuggestions(input: {
  dimensionsInfo: string
  outputLength: number
  rate: number
  renderer: string
}) {
  const suggestions: string[] = []
  const { cols, rows } = parseDimensionsInfo(input.dimensionsInfo)

  if (input.renderer === 'dom' && input.rate > 32_000) {
    suggestions.push('High output rate on DOM renderer. Check whether WebGL failed to initialize.')
  }

  if (cols > 220 || rows > 70) {
    suggestions.push('Terminal viewport is very large. Reduce floating window size or exit maximize.')
  }

  if (input.outputLength > 64_000) {
    suggestions.push('Session output is large. Archive or close older sessions to reduce memory pressure.')
  }

  if (input.rate > 96_000) {
    suggestions.push('Output throughput is extremely high. Consider limiting command verbosity or batching logs.')
  }

  return suggestions
}

function buildTerminalStressCommand(rootPath?: string) {
  if (isWindowsWorkspace(rootPath)) {
    return 'powershell -NoLogo -NoProfile -Command "1..2000 | ForEach-Object { Write-Output (\\\"load-test line $_ \\\" + (\\\"x\\\" * 120)) }"'
  }

  return `python - <<'PY'
for i in range(2000):
    print(f"load-test line {i} " + ("x" * 120))
PY`
}

function formatStressMetric(value: number) {
  return Math.round(value).toLocaleString()
}

function formatStressDuration(durationMs?: number) {
  if (typeof durationMs !== 'number') {
    return 'n/a'
  }

  return `${(durationMs / 1000).toFixed(1)}s`
}

function formatStressDelta(metric: TerminalStressComparisonMetric) {
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

function formatStressComparisonMetricValue(
  metric: Pick<TerminalStressComparisonMetric, 'key'>,
  value: number,
) {
  if (metric.key === 'durationMs') {
    return formatStressDuration(value)
  }

  if (metric.key === 'peakRate') {
    return `${formatStressMetric(value)}/s`
  }

  return formatStressMetric(value)
}

function getStressDeltaTone(metric: TerminalStressComparisonMetric) {
  if (metric.delta > 0) {
    return 'positive'
  }

  if (metric.delta < 0) {
    return 'negative'
  }

  return 'neutral'
}

function formatElementPixelSize(element: HTMLElement | null) {
  if (!element) {
    return '0x0px'
  }

  const rect = element.getBoundingClientRect()
  return `${Math.round(rect.width)}x${Math.round(rect.height)}px`
}

function downloadJsonFile(filename: string, value: unknown) {
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

function formatStressRunLabel(run: CompletedTerminalStressRun) {
  return `${new Date(run.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })} · ${run.config.renderer} · ${run.config.terminalSize}`
}

function canCommandSessionInteract(
  session: ThreadTerminalDockProps['selectedCommandSession'],
) {
  if (!session) {
    return false
  }

  if (!['running', 'starting'].includes(session.status)) {
    return false
  }

  if (session.mode !== 'shell') {
    return true
  }

  if (hasLimitedShellIntegration(session)) {
    return session.status === 'running'
  }

  const shellState = (session.shellState ?? '').toLowerCase()
  return shellState === 'prompt' || shellState === 'running'
}

function getCommandSessionTone(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'starting':
    case 'running':
    case 'processing':
      return 'running'
    case 'completed':
      return 'success'
    case 'failed':
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

export function ThreadTerminalDockBar({
  activeCommandCount,
  commandSessions,
  isExpanded,
  isFloating,
  isVisible,
  isWindowMaximized,
  onChangePlacement,
  onDragStart,
  onHide,
  onResetFloatingBounds,
  onToggleExpanded,
  onToggleWindowMaximized,
  placement,
}: Pick<
  ThreadTerminalDockProps,
  | 'activeCommandCount'
  | 'commandSessions'
  | 'isExpanded'
  | 'isFloating'
  | 'isVisible'
  | 'isWindowMaximized'
  | 'onChangePlacement'
  | 'onDragStart'
  | 'onHide'
  | 'onResetFloatingBounds'
  | 'onToggleExpanded'
  | 'onToggleWindowMaximized'
  | 'placement'
>) {
  return (
    <div className="terminal-dock__bar">
      <div className="terminal-dock__bar-copy">
        {isFloating ? (
          <button
            aria-label={i18n._({
              id: 'Move terminal window',
              message: 'Move terminal window',
            })}
            className="terminal-dock__drag-handle"
            disabled={isWindowMaximized}
            onPointerDown={onDragStart}
            title={i18n._({
              id: 'Move terminal window',
              message: 'Move terminal window',
            })}
            type="button"
          >
            <GripToolIcon />
          </button>
        ) : null}
        <h2>{i18n._({ id: 'Terminal', message: 'Terminal' })}</h2>
        {commandSessions.length ? (
          <span>
            {i18n._({
              id: '{sessions} sessions · {active} active',
              message: '{sessions} sessions · {active} active',
              values: {
                active: activeCommandCount,
                sessions: commandSessions.length,
              },
            })}
          </span>
        ) : null}
      </div>
      <div className="terminal-dock__bar-meta">
        {isFloating ? (
          <div className="terminal-dock__bar-group">
            <button
              className="terminal-dock__window-action"
              onClick={onToggleWindowMaximized}
              type="button"
            >
              {isWindowMaximized
                ? i18n._({
                    id: 'Restore',
                    message: 'Restore',
                  })
                : i18n._({
                    id: 'Maximize',
                    message: 'Maximize',
                  })}
            </button>
            <button
              className="terminal-dock__window-action"
              onClick={onResetFloatingBounds}
              type="button"
            >
              {i18n._({
                id: 'Center',
                message: 'Center',
              })}
            </button>
          </div>
        ) : null}
        <div className="terminal-dock__bar-group terminal-dock__bar-group--primary">
          <ThreadTerminalPlacementSwitch
            onChangePlacement={onChangePlacement}
            placement={placement}
          />
          <button
            aria-expanded={isExpanded}
            className="terminal-dock__collapse"
            onClick={onToggleExpanded}
            type="button"
          >
            {isExpanded
              ? i18n._({
                  id: 'Collapse',
                  message: 'Collapse',
                })
              : i18n._({
                  id: 'Expand',
                  message: 'Expand',
                })}
          </button>
          {isVisible ? (
            <button className="terminal-dock__toggle" onClick={onHide} type="button">
              {i18n._({
                id: 'Hide',
                message: 'Hide',
              })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function ThreadTerminalDockWorkspace({
  commandSessions,
  isFloating,
  isWindowMaximized,
  onClearCompletedSessions,
  onRemoveSession,
  onResizeStart,
  onResizeTerminal,
  onSelectSession,
  onStartShellSession,
  onStartCommandLine,
  onTerminateSelectedSession,
  onToggleArchivedSession,
  onTogglePinnedSession,
  onWindowResizeStart,
  onWriteTerminalData,
  placement,
  rootPath,
  selectedCommandSession,
  startCommandPending,
  terminateDisabled,
}: Pick<
  ThreadTerminalDockProps,
  | 'commandSessions'
  | 'isFloating'
  | 'isVisible'
  | 'isWindowMaximized'
  | 'onClearCompletedSessions'
  | 'onRemoveSession'
  | 'onResizeStart'
  | 'onResizeTerminal'
  | 'onSelectSession'
  | 'onStartShellSession'
  | 'onStartCommandLine'
  | 'onTerminateSelectedSession'
  | 'onToggleArchivedSession'
  | 'onTogglePinnedSession'
  | 'onWindowResizeStart'
  | 'onWriteTerminalData'
  | 'placement'
  | 'rootPath'
  | 'selectedCommandSession'
  | 'startCommandPending'
  | 'terminateDisabled'
>) {
  const [isLauncherOpen, setIsLauncherOpen] = useState(commandSessions.length === 0)
  const [launcherMode, setLauncherMode] = useState<TerminalLauncherMode>(() =>
    commandSessions.length === 0 ? 'shell' : 'command',
  )
  const [suppressAutoShellLauncher, setSuppressAutoShellLauncher] = useState(false)
  const [showArchivedSessions, setShowArchivedSessions] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [launcherHistory, setLauncherHistory] = useState<string[]>([])
  const [launcherShell, setLauncherShell] = useState('')
  const [launcherHasSelection, setLauncherHasSelection] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFeedback, setSearchFeedback] = useState<'idle' | 'not-found'>('idle')
  const [sessionSelectionById, setSessionSelectionById] = useState<Record<string, boolean>>({})
  const [stressRun, setStressRun] = useState<TerminalStressRun | null>(null)
  const [stressHistory, setStressHistory] = useState<CompletedTerminalStressRun[]>([])
  const [stressCompareTargetId, setStressCompareTargetId] = useState('')
  const [stressCompareBaselineId, setStressCompareBaselineId] = useState('')

  const pushToast = useUIStore((state) => state.pushToast)
  const runtimePreferencesQuery = useQuery({
    queryKey: ['settings-runtime-preferences'],
    queryFn: readRuntimePreferences,
    staleTime: 30_000,
  })
  const launcherRef = useRef<ThreadTerminalLauncherHandle | null>(null)
  const viewportRefs = useRef<Record<string, ThreadTerminalViewportHandle | null>>({})
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const viewportStackRef = useRef<HTMLDivElement | null>(null)

  const activeSessions = commandSessions.filter((session) => !session.archived)
  const archivedSessions = commandSessions.filter((session) => session.archived)
  const visibleSessions = showArchivedSessions ? archivedSessions : activeSessions
  const hasFinishedSessions = activeSessions.some(
    (session) => !['running', 'starting'].includes(session.status),
  )
  const isInteractive = canCommandSessionInteract(selectedCommandSession)
  const selectedSessionHasLimitedIntegration = hasLimitedShellIntegration(selectedCommandSession)
  const terminalShellOptions = useMemo(
    () =>
      buildTerminalShellOptions(
        runtimePreferencesQuery.data?.supportedTerminalShells ?? [],
        launcherShell,
      ),
    [launcherShell, runtimePreferencesQuery.data?.supportedTerminalShells],
  )
  const defaultShellLauncherName = formatTerminalShellLauncherName(rootPath, launcherShell)
  const newShellSessionTitle = i18n._({
    id: 'New {shellName} session',
    message: 'New {shellName} session',
    values: { shellName: defaultShellLauncherName },
  })

  useEffect(() => {
    const configuredShell = (runtimePreferencesQuery.data?.configuredDefaultTerminalShell ?? '').trim()
    if (!configuredShell) {
      return
    }

    setLauncherShell((current) => current || configuredShell)
  }, [runtimePreferencesQuery.data?.configuredDefaultTerminalShell])

  useEffect(() => {
    if (!activeSessions.length && !archivedSessions.length) {
      if (suppressAutoShellLauncher) {
        return
      }

      setIsLauncherOpen(true)
      setLauncherMode('shell')
      return
    }

    if (selectedCommandSession?.id && !startCommandPending) {
      setIsLauncherOpen(false)
      setSuppressAutoShellLauncher(false)
    }
  }, [
    activeSessions.length,
    archivedSessions.length,
    selectedCommandSession?.id,
    startCommandPending,
    suppressAutoShellLauncher,
  ])

  useEffect(() => {
    if (
      suppressAutoShellLauncher &&
      !startCommandPending &&
      !activeSessions.length &&
      !archivedSessions.length
    ) {
      setSuppressAutoShellLauncher(false)
      setIsLauncherOpen(true)
      setLauncherMode('shell')
    }
  }, [
    activeSessions.length,
    archivedSessions.length,
    startCommandPending,
    suppressAutoShellLauncher,
  ])

  useEffect(() => {
    if (selectedCommandSession?.archived) {
      setShowArchivedSessions(true)
    }
  }, [selectedCommandSession?.archived])

  useEffect(() => {
    if (!commandSessions.length) {
      setSessionSelectionById({})
      return
    }

    const nextIds = new Set(commandSessions.map((session) => session.id))
    setSessionSelectionById((current) => {
      const nextEntries = Object.entries(current).filter(([sessionId]) => nextIds.has(sessionId))
      if (nextEntries.length === Object.keys(current).length) {
        return current
      }

      return Object.fromEntries(nextEntries)
    })
  }, [commandSessions])

  useEffect(() => {
    if (isLauncherOpen) {
      setIsSearchOpen(false)
      setSearchQuery('')
      setSearchFeedback('idle')
    }
  }, [isLauncherOpen])

  useEffect(() => {
    if (isLauncherOpen) {
      requestAnimationFrame(() => launcherRef.current?.focusLauncher())
      return
    }

    const activeViewport = selectedCommandSession?.id
      ? viewportRefs.current[selectedCommandSession.id]
      : null
    requestAnimationFrame(() => activeViewport?.focusViewport())
  }, [isLauncherOpen, selectedCommandSession?.id])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const modifier = event.ctrlKey || event.metaKey
      if (!modifier) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === 'k') {
        event.preventDefault()
        setLauncherMode('command')
        setIsLauncherOpen(true)
        return
      }

      if (key === 'f' && !isLauncherOpen && selectedCommandSession?.id) {
        event.preventDefault()
        setIsSearchOpen(true)
        requestAnimationFrame(() => {
          const searchInput = document.querySelector<HTMLInputElement>(
            '.terminal-dock__search input',
          )
          searchInput?.focus()
          searchInput?.select()
        })
        return
      }

      if (key === 'l') {
        event.preventDefault()
        if (isLauncherOpen) {
          launcherRef.current?.clearLauncher()
        } else {
          getActiveViewport(selectedCommandSession?.id, viewportRefs.current)?.clearViewport()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isLauncherOpen, selectedCommandSession?.id])

  function handleSelectSession(processId: string) {
    onSelectSession(processId)
    setIsLauncherOpen(false)
  }

  function handleOpenLauncher(mode: TerminalLauncherMode) {
    setLauncherMode(mode)
    setIsLauncherOpen(true)
  }

  function handleCloseLauncher() {
    if (!commandSessions.length) {
      return
    }

    setIsLauncherOpen(false)
  }

  function handleStartLauncherCommand(commandLine: string) {
    const nextCommand = commandLine.trim()
    if (!nextCommand) {
      return
    }

    setLauncherHistory((current) => {
      const nextHistory = [nextCommand, ...current.filter((entry) => entry !== nextCommand)]
      return nextHistory.slice(0, 24)
    })
    onStartCommandLine(nextCommand)
  }

  function handleStartShellSessionDirect() {
    setLauncherMode('shell')
    setIsSearchOpen(false)
    setSuppressAutoShellLauncher(false)
    setIsLauncherOpen(true)
  }

  function handleStartShellFromLauncher() {
    onStartShellSession(launcherShell || undefined)
  }

  function handleFitViewport() {
    if (isLauncherOpen) {
      launcherRef.current?.fitLauncher()
      return
    }

    getActiveViewport(selectedCommandSession?.id, viewportRefs.current)?.fitViewport()
  }

  function handleFocusViewport() {
    if (isLauncherOpen) {
      launcherRef.current?.focusLauncher()
      return
    }

    getActiveViewport(selectedCommandSession?.id, viewportRefs.current)?.focusViewport()
  }

  function handleClearViewport() {
    if (isLauncherOpen) {
      launcherRef.current?.clearLauncher()
      return
    }

    getActiveViewport(selectedCommandSession?.id, viewportRefs.current)?.clearViewport()
  }

  function handleCopySelection() {
    if (isLauncherOpen) {
      void launcherRef.current?.copySelection()
      return
    }

    void getActiveViewport(selectedCommandSession?.id, viewportRefs.current)?.copySelection()
  }

  function handlePasteClipboard() {
    if (isLauncherOpen) {
      void launcherRef.current?.pasteFromClipboard()
      return
    }

    void getActiveViewport(selectedCommandSession?.id, viewportRefs.current)?.pasteFromClipboard()
  }

  function handleLauncherSelectionChange(hasSelection: boolean) {
    setLauncherHasSelection(hasSelection)
  }

  function handleSessionSelectionChange(sessionId: string, hasSelection: boolean) {
    setSessionSelectionById((current) => {
      if (current[sessionId] === hasSelection) {
        return current
      }

      return {
        ...current,
        [sessionId]: hasSelection,
      }
    })
  }

  function buildStressConfigSnapshot(
    renderer = activeRendererInfo,
    terminalSize = activeDimensionsInfo,
  ): TerminalStressRunConfig {
    return {
      isFloating,
      isWindowMaximized,
      outputLimit: COMMAND_SESSION_OUTPUT_LIMIT,
      placement,
      renderer,
      scrollback: isLauncherOpen ? TERMINAL_LAUNCHER_SCROLLBACK : TERMINAL_VIEWPORT_SCROLLBACK,
      terminalSize,
      viewportPx: formatElementPixelSize(viewportStackRef.current),
      workspacePx: formatElementPixelSize(workspaceRef.current),
    }
  }

  const hasSelectedSessionSelection = selectedCommandSession?.id
    ? Boolean(sessionSelectionById[selectedCommandSession.id])
    : false
  const activeRenderableSession = !isLauncherOpen ? selectedCommandSession : undefined
  const activeRendererInfo = activeRenderableSession?.archived
    ? 'static'
    : isLauncherOpen
      ? launcherRef.current?.getRendererInfo() ?? 'pending'
      : activeRenderableSession?.id
        ? viewportRefs.current[activeRenderableSession.id]?.getRendererInfo() ?? 'pending'
        : 'none'
  const activeDimensionsInfo = isLauncherOpen
    ? launcherRef.current?.getDimensionsInfo() ?? '0x0'
    : activeRenderableSession?.id
      ? viewportRefs.current[activeRenderableSession.id]?.getDimensionsInfo() ?? '0x0'
      : '0x0'
  const activePerformanceInfo = isLauncherOpen
    ? launcherRef.current?.getPerformanceInfo() ?? {
        bytesPerSecond: 0,
        flushCount: 0,
        flushesPerSecond: 0,
        lastChunkSize: 0,
      }
    : activeRenderableSession?.id
      ? viewportRefs.current[activeRenderableSession.id]?.getPerformanceInfo() ?? {
          bytesPerSecond: 0,
          flushCount: 0,
          flushesPerSecond: 0,
          lastChunkSize: 0,
        }
      : { bytesPerSecond: 0, flushCount: 0, flushesPerSecond: 0, lastChunkSize: 0 }
  const shouldUsePlainTextViewport = Boolean(activeRenderableSession?.archived)
  const debugSuggestions = buildTerminalDebugSuggestions({
    dimensionsInfo: activeDimensionsInfo,
    outputLength: selectedCommandSession?.combinedOutput?.length ?? 0,
    rate: activePerformanceInfo.bytesPerSecond,
    renderer: activeRendererInfo,
  })
  const completedCurrentStressRun = toCompletedTerminalStressRun(stressRun)
  const stressRecords =
    completedCurrentStressRun && stressHistory[0]?.id !== completedCurrentStressRun.id
      ? [completedCurrentStressRun, ...stressHistory].slice(0, TERMINAL_STRESS_HISTORY_LIMIT)
      : stressHistory
  const latestCompletedStressRun = stressRecords[0] ?? null
  const selectedStressCompareTarget =
    stressRecords.find((record) => record.id === stressCompareTargetId) ?? latestCompletedStressRun
  const selectedStressCompareBaseline =
    stressRecords.find(
      (record) =>
        record.id === stressCompareBaselineId &&
        record.id !== selectedStressCompareTarget?.id,
    ) ??
    stressRecords.find((record) => record.id !== selectedStressCompareTarget?.id) ??
    null
  const stressComparison =
    selectedStressCompareTarget && selectedStressCompareBaseline
      ? compareTerminalStressRuns(selectedStressCompareTarget, selectedStressCompareBaseline)
      : null
  const displayedStressRun = stressRun ?? latestCompletedStressRun
  const isStressTestActive = stressRun?.status === 'waiting' || stressRun?.status === 'running'

  function handleSearchNext() {
    const found = getActiveViewport(selectedCommandSession?.id, viewportRefs.current)?.findNext(
      searchQuery,
    )
    setSearchFeedback(found ? 'idle' : 'not-found')
  }

  function handleSearchPrevious() {
    const found = getActiveViewport(selectedCommandSession?.id, viewportRefs.current)?.findPrevious(
      searchQuery,
    )
    setSearchFeedback(found ? 'idle' : 'not-found')
  }

  function handleRunStressCommand() {
    const command = buildTerminalStressCommand(rootPath)
    const startedAt = Date.now()
    setStressRun({
      command,
      config: buildStressConfigSnapshot(),
      id: `terminal-stress-${startedAt}`,
      metrics: {
        peakChunk: 0,
        peakFlushRate: 0,
        peakOutput: 0,
        peakRate: 0,
      },
      startedAt,
      status: 'waiting',
    })
    handleOpenLauncher('command')
    handleStartLauncherCommand(command)
  }

  function handleExportStressSummary() {
    if (!latestCompletedStressRun) {
      return
    }

    try {
      downloadJsonFile(
        `terminal-stress-${new Date(latestCompletedStressRun.startedAt)
          .toISOString()
          .replace(/[:.]/g, '-')}.json`,
        createTerminalStressExport({
          baseline:
            selectedStressCompareTarget?.id === latestCompletedStressRun.id
              ? selectedStressCompareBaseline
              : null,
          comparison:
            selectedStressCompareTarget?.id === latestCompletedStressRun.id
              ? stressComparison
              : null,
          latest: latestCompletedStressRun,
        }),
      )
      pushToast({
        message: i18n._({
          id: 'The latest terminal stress summary was downloaded as JSON.',
          message: 'The latest terminal stress summary was downloaded as JSON.',
        }),
        title: i18n._({
          id: 'Stress summary exported',
          message: 'Stress summary exported',
        }),
        tone: 'success',
      })
    } catch {
      pushToast({
        message: i18n._({
          id: 'The browser could not export the latest terminal stress summary.',
          message: 'The browser could not export the latest terminal stress summary.',
        }),
        title: i18n._({
          id: 'Stress summary export failed',
          message: 'Stress summary export failed',
        }),
        tone: 'error',
      })
    }
  }

  function handleClearStressSummary() {
    setStressRun(null)
    setStressHistory([])
    setStressCompareBaselineId('')
    setStressCompareTargetId('')
  }

  useEffect(() => {
    if (!isTerminalDebugEnabled || typeof window === 'undefined') {
      return
    }

    setStressHistory(
      parseTerminalStressHistory(
        window.localStorage.getItem(TERMINAL_STRESS_HISTORY_STORAGE_KEY),
      ),
    )
  }, [])

  useEffect(() => {
    if (!isTerminalDebugEnabled || typeof window === 'undefined') {
      return
    }

    if (!stressHistory.length) {
      window.localStorage.removeItem(TERMINAL_STRESS_HISTORY_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(
      TERMINAL_STRESS_HISTORY_STORAGE_KEY,
      serializeTerminalStressHistory(stressHistory),
    )
  }, [stressHistory])

  useEffect(() => {
    const nextCompletedStressRun = toCompletedTerminalStressRun(stressRun)
    if (!nextCompletedStressRun) {
      return
    }

    setStressHistory((current) => {
      if (current.some((entry) => entry.id === nextCompletedStressRun.id)) {
        return current
      }

      return [nextCompletedStressRun, ...current].slice(0, TERMINAL_STRESS_HISTORY_LIMIT)
    })
    setStressCompareBaselineId('')
    setStressCompareTargetId('')
  }, [stressRun])

  useEffect(() => {
    if (
      !stressRun ||
      stressRun.status !== 'waiting' ||
      !selectedCommandSession?.id ||
      selectedCommandSession.command !== stressRun.command
    ) {
      return
    }

    setStressRun((current) =>
      current && current.status === 'waiting'
        ? {
            ...current,
            config: buildStressConfigSnapshot(),
            sessionId: selectedCommandSession.id,
            status: 'running',
          }
        : current,
    )
  }, [
    activeDimensionsInfo,
    activeRendererInfo,
    isFloating,
    isLauncherOpen,
    isWindowMaximized,
    placement,
    selectedCommandSession?.command,
    selectedCommandSession?.id,
    stressRun,
  ])

  useEffect(() => {
    if (
      !stressRun ||
      stressRun.status !== 'running' ||
      !stressRun.sessionId ||
      activeRenderableSession?.id !== stressRun.sessionId
    ) {
      return
    }

    const now = Date.now()
    const nextPeakChunk = Math.max(stressRun.metrics.peakChunk, activePerformanceInfo.lastChunkSize)
    const nextPeakFlushRate = Math.max(
      stressRun.metrics.peakFlushRate,
      activePerformanceInfo.flushesPerSecond,
    )
    const nextPeakOutput = Math.max(
      stressRun.metrics.peakOutput,
      activeRenderableSession.combinedOutput?.length ?? 0,
    )
    const nextPeakRate = Math.max(stressRun.metrics.peakRate, activePerformanceInfo.bytesPerSecond)
    const nextRenderer =
      stressRun.config.renderer === 'pending' ? activeRendererInfo : stressRun.config.renderer
    const nextSize =
      activeDimensionsInfo !== '0x0' ? activeDimensionsInfo : stressRun.config.terminalSize
    const nextConfig = buildStressConfigSnapshot(nextRenderer, nextSize)
    const shouldComplete =
      now - stressRun.startedAt >= terminalStressTestDurationMs ||
      ['completed', 'failed', 'error'].includes(activeRenderableSession.status)

    if (
      nextPeakChunk === stressRun.metrics.peakChunk &&
      nextPeakFlushRate === stressRun.metrics.peakFlushRate &&
      nextPeakOutput === stressRun.metrics.peakOutput &&
      nextPeakRate === stressRun.metrics.peakRate &&
      nextRenderer === stressRun.config.renderer &&
      nextSize === stressRun.config.terminalSize &&
      nextConfig.viewportPx === stressRun.config.viewportPx &&
      nextConfig.workspacePx === stressRun.config.workspacePx &&
      !shouldComplete
    ) {
      return
    }

    setStressRun((current) => {
      if (!current || current.sessionId !== stressRun.sessionId) {
        return current
      }

      return {
        ...current,
        completedAt: shouldComplete ? now : current.completedAt,
        config: nextConfig,
        durationMs: shouldComplete ? Math.max(0, now - current.startedAt) : current.durationMs,
        metrics: {
          peakChunk: nextPeakChunk,
          peakFlushRate: nextPeakFlushRate,
          peakOutput: nextPeakOutput,
          peakRate: nextPeakRate,
        },
        status: shouldComplete ? 'completed' : current.status,
      }
    })
  }, [
    activeDimensionsInfo,
    activePerformanceInfo.bytesPerSecond,
    activePerformanceInfo.flushesPerSecond,
    activePerformanceInfo.lastChunkSize,
    activeRenderableSession,
    activeRendererInfo,
    isFloating,
    isLauncherOpen,
    isWindowMaximized,
    placement,
    stressRun,
  ])

  return (
    <>
      {placement === 'bottom' ? (
        <ResizeHandle
          aria-label={i18n._({
            id: 'Resize terminal dock',
            message: 'Resize terminal dock',
          })}
          axis="vertical"
          className="terminal-dock__resize-handle"
          onPointerDown={onResizeStart}
        />
      ) : null}
      <div className="terminal-dock__workspace" ref={workspaceRef}>
        <div className="terminal-dock__body">
          {visibleSessions.length ? (
            <div
              className={
                placement === 'right'
                  ? 'terminal-dock__tabs terminal-dock__tabs--stacked'
                  : 'terminal-dock__tabs'
              }
            >
              {visibleSessions.map((session) => (
                <ThreadTerminalSessionTab
                  archived={Boolean(session.archived)}
                  command={session.command}
                  isActive={session.id === selectedCommandSession?.id && !isLauncherOpen}
                  key={session.id}
                  onArchiveSession={onToggleArchivedSession}
                  onPinSession={onTogglePinnedSession}
                  onRemoveSession={onRemoveSession}
                  onSelectSession={handleSelectSession}
                  pinned={Boolean(session.pinned)}
                  sessionId={session.id}
                  status={session.status}
                  title={formatCommandSessionTitle(session)}
                  updatedAt={session.updatedAt}
                />
              ))}
            </div>
          ) : null}
          {archivedSessions.length ? (
            <div className="terminal-dock__archive-toggle-row">
              <button
                className="terminal-dock__meta-action"
                onClick={() => setShowArchivedSessions((current) => !current)}
                type="button"
              >
                {showArchivedSessions
                  ? i18n._({
                      id: 'Hide archived ({count})',
                      message: 'Hide archived ({count})',
                      values: { count: archivedSessions.length },
                    })
                  : i18n._({
                      id: 'Show archived ({count})',
                      message: 'Show archived ({count})',
                      values: { count: archivedSessions.length },
                    })}
              </button>
            </div>
          ) : null}

          <div className="terminal-dock__console-shell">
            <div className="terminal-dock__console">
              <div className="terminal-dock__console-header">
                <div className="terminal-dock__console-title">
                  <div className="terminal-dock__console-title-row">
                    <span
                      className={`terminal-dock__status-dot terminal-dock__status-dot--${
                        isLauncherOpen
                          ? 'idle'
                          : getCommandSessionTone(selectedCommandSession?.status)
                      }`}
                    />
                    <strong>
                      {isLauncherOpen
                        ? launcherMode === 'shell'
                          ? newShellSessionTitle
                          : i18n._({
                              id: 'Run one-shot command',
                              message: 'Run one-shot command',
                            })
                        : formatCommandSessionTitle(selectedCommandSession)}
                    </strong>
                  </div>
                  <span>
                    {isLauncherOpen
                      ? launcherMode === 'shell'
                        ? i18n._({
                            id: 'Persistent PTY {shellName}. Enter starts it, Ctrl/Cmd+K switches to one-shot commands, Esc goes back.',
                            message:
                              'Persistent PTY {shellName}. Enter starts it, Ctrl/Cmd+K switches to one-shot commands, Esc goes back.',
                            values: { shellName: defaultShellLauncherName },
                          })
                        : i18n._({
                            id: 'One-shot command session. Enter runs, Up/Down reuses history, Esc goes back.',
                            message:
                              'One-shot command session. Enter runs, Up/Down reuses history, Esc goes back.',
                          })
                      : `${formatCommandSessionMode(selectedCommandSession?.mode)} · ${formatCommandSessionStatus(selectedCommandSession?.status)}${
                          selectedCommandSession?.mode === 'shell'
                            ? ` · ${formatShellDisplayName(
                                selectedCommandSession?.shellPath,
                                selectedCommandSession?.command,
                              )}`
                            : ''
                        }${
                          selectedCommandSession?.mode === 'shell' &&
                          formatShellSessionActivity(selectedCommandSession.shellState)
                            ? ` · ${formatShellSessionActivity(selectedCommandSession.shellState)}`
                            : ''
                        }${
                          selectedCommandSession?.mode === 'shell' &&
                          typeof selectedCommandSession?.lastExitCode === 'number'
                            ? ` · ${i18n._({
                                id: 'last exit {exitCode}',
                                message: 'last exit {exitCode}',
                                values: { exitCode: selectedCommandSession.lastExitCode },
                              })}`
                            : ''
                        }${
                          selectedCommandSession?.updatedAt
                            ? ` · ${formatRelativeTimeShort(selectedCommandSession.updatedAt)}`
                            : ''
                        }${
                          typeof selectedCommandSession?.exitCode === 'number'
                            ? ` · ${i18n._({
                                id: 'exit {exitCode}',
                                message: 'exit {exitCode}',
                                values: { exitCode: selectedCommandSession.exitCode },
                              })}`
                            : ''
                        }`}
                  </span>
                </div>
                <ThreadTerminalToolbar
                  canArchiveSelectedSession={!isLauncherOpen && Boolean(selectedCommandSession?.id)}
                  canCopy={isLauncherOpen ? launcherHasSelection : hasSelectedSessionSelection}
                  canPaste={isLauncherOpen ? launcherMode === 'command' : isInteractive}
                  canPinSelectedSession={!isLauncherOpen && Boolean(selectedCommandSession?.id)}
                  commandSessionsCount={commandSessions.length}
                  isLauncherOpen={isLauncherOpen}
                  launcherMode={launcherMode}
                  isSelectedSessionArchived={Boolean(selectedCommandSession?.archived)}
                  isSelectedSessionPinned={Boolean(selectedCommandSession?.pinned)}
                  shellLauncherControl={
                    isLauncherOpen && launcherMode === 'shell' ? (
                      <div className="terminal-dock__toolbar-shell-select">
                        <SelectControl
                          ariaLabel={i18n._({
                            id: 'Terminal launcher shell',
                            message: 'Terminal launcher shell',
                          })}
                          className="terminal-dock__toolbar-select"
                          onChange={setLauncherShell}
                          options={terminalShellOptions}
                          value={launcherShell}
                        />
                      </div>
                    ) : undefined
                  }
                  shellActionLabel={defaultShellLauncherName}
                  shellActionTitle={newShellSessionTitle}
                  onArchiveSelectedSession={() => {
                    if (selectedCommandSession?.id) {
                      onToggleArchivedSession(selectedCommandSession.id)
                    }
                  }}
                  onBackToSession={handleCloseLauncher}
                  onClearViewport={handleClearViewport}
                  onCopySelection={handleCopySelection}
                  onFitViewport={handleFitViewport}
                  onFocusViewport={handleFocusViewport}
                  onOpenCommandLauncher={() => handleOpenLauncher('command')}
                  onPasteClipboard={handlePasteClipboard}
                  onSearchTerminal={() => setIsSearchOpen((current) => !current)}
                  onStartShellSession={handleStartShellSessionDirect}
                  onStopSession={onTerminateSelectedSession}
                  startSessionPending={startCommandPending}
                  onTogglePinSelectedSession={() => {
                    if (selectedCommandSession?.id) {
                      onTogglePinnedSession(selectedCommandSession.id)
                    }
                  }}
                  searchDisabled={isLauncherOpen || !selectedCommandSession?.id}
                  terminateDisabled={terminateDisabled}
                />
              </div>

              {isSearchOpen && !isLauncherOpen ? (
                <form
                  className="terminal-dock__search"
                  onSubmit={(event) => {
                    event.preventDefault()
                    handleSearchNext()
                  }}
                >
                  <input
                    onChange={(event) => {
                      setSearchQuery(event.target.value)
                      setSearchFeedback('idle')
                    }}
                    placeholder={i18n._({
                      id: 'Search terminal output',
                      message: 'Search terminal output',
                    })}
                    value={searchQuery}
                  />
                  <button className="terminal-dock__search-button" type="submit">
                    {i18n._({
                      id: 'Next',
                      message: 'Next',
                    })}
                  </button>
                  <button
                    className="terminal-dock__search-button"
                    onClick={handleSearchPrevious}
                    type="button"
                  >
                    {i18n._({
                      id: 'Prev',
                      message: 'Prev',
                    })}
                  </button>
                  <button
                    className="terminal-dock__search-button"
                    onClick={() => {
                      setIsSearchOpen(false)
                      setSearchQuery('')
                      setSearchFeedback('idle')
                    }}
                    type="button"
                  >
                    {i18n._({
                      id: 'Close',
                      message: 'Close',
                    })}
                  </button>
                  {searchFeedback === 'not-found' ? (
                    <span className="terminal-dock__search-feedback">
                      {i18n._({
                        id: 'No match',
                        message: 'No match',
                      })}
                    </span>
                  ) : null}
                </form>
              ) : null}

              <div className="terminal-dock__meta">
                {!isLauncherOpen && selectedCommandSession?.id ? (
                  <code>{selectedCommandSession.id}</code>
                ) : null}
                {!isLauncherOpen && selectedCommandSession?.shellPath ? (
                  <code>{selectedCommandSession.shellPath}</code>
                ) : null}
                {!isLauncherOpen &&
                (selectedCommandSession?.currentCwd || selectedCommandSession?.initialCwd) ? (
                  <code>{selectedCommandSession.currentCwd || selectedCommandSession.initialCwd}</code>
                ) : rootPath ? (
                  <code>{rootPath}</code>
                ) : null}
                {hasFinishedSessions ? (
                  <button
                    className="terminal-dock__meta-action"
                    onClick={onClearCompletedSessions}
                    type="button"
                  >
                    {i18n._({
                      id: 'Clear finished',
                      message: 'Clear finished',
                    })}
                  </button>
                ) : null}
              </div>
              {isTerminalDebugEnabled ? (
                <>
                  <div className="terminal-dock__debug">
                    <span
                      className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getRendererDebugTone(
                        activeRendererInfo,
                        activePerformanceInfo.bytesPerSecond,
                        selectedCommandSession?.combinedOutput?.length ?? 0,
                      )}`}
                    >
                      {`renderer:${activeRendererInfo}`}
                    </span>
                    <span
                      className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getSizeDebugTone(
                        activeDimensionsInfo,
                      )}`}
                    >
                      {`size:${activeDimensionsInfo}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`session:${selectedCommandSession?.id ?? 'none'}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`mode:${selectedCommandSession?.mode ?? launcherMode}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`launcher:${isLauncherOpen ? launcherMode : 'none'}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`interactive:${isInteractive ? 'yes' : 'no'}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`status:${selectedCommandSession?.status ?? 'none'}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`shellState:${selectedCommandSession?.shellState ?? 'n/a'}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`archived:${selectedCommandSession?.archived ? 'yes' : 'no'}`}
                    </span>
                    <span
                      className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getOutputDebugTone(
                        selectedCommandSession?.combinedOutput?.length ?? 0,
                      )}`}
                    >
                      {`output:${selectedCommandSession?.combinedOutput?.length ?? 0}`}
                    </span>
                    <span
                      className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getReplayAppendDebugTone(
                        selectedCommandSession?.replayAppendCount ?? 0,
                      )}`}
                    >
                      {`replay+:${selectedCommandSession?.replayAppendCount ?? 0}`}
                    </span>
                    <span
                      className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getReplayReplaceDebugTone(
                        selectedCommandSession?.replayReplaceCount ?? 0,
                      )}`}
                    >
                      {`replace:${selectedCommandSession?.replayReplaceCount ?? 0}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`resumeB:${selectedCommandSession?.replayByteCount ?? 0}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`reason:${selectedCommandSession?.lastReplayReason ?? 'n/a'}`}
                    </span>
                    <span className="terminal-dock__debug-chip terminal-dock__debug-chip--neutral">
                      {`flush:${activePerformanceInfo.flushCount}`}
                    </span>
                    <span
                      className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getFlushRateDebugTone(
                        activePerformanceInfo.flushesPerSecond,
                      )}`}
                    >
                      {`flush/s:${activePerformanceInfo.flushesPerSecond}`}
                    </span>
                    <span
                      className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getChunkDebugTone(
                        activePerformanceInfo.lastChunkSize,
                      )}`}
                    >
                      {`chunk:${activePerformanceInfo.lastChunkSize}`}
                    </span>
                    <span
                      className={`terminal-dock__debug-chip terminal-dock__debug-chip--${getRateDebugTone(
                        activePerformanceInfo.bytesPerSecond,
                      )}`}
                    >
                      {`rate:${activePerformanceInfo.bytesPerSecond}/s`}
                    </span>
                  </div>
                  {debugSuggestions.length || !isLauncherOpen || displayedStressRun || stressRecords.length ? (
                    <div className="terminal-dock__debug-suggestions">
                      <div className="terminal-dock__debug-actions">
                        {!isLauncherOpen ? (
                          <button
                            className="terminal-dock__debug-action"
                            disabled={startCommandPending || isStressTestActive}
                            onClick={handleRunStressCommand}
                            type="button"
                          >
                            {isStressTestActive
                              ? i18n._({
                                  id: 'Stress test running…',
                                  message: 'Stress test running…',
                                })
                              : i18n._({
                                  id: 'Run stress test',
                                  message: 'Run stress test',
                                })}
                          </button>
                        ) : null}
                        {latestCompletedStressRun ? (
                          <button
                            className="terminal-dock__debug-action terminal-dock__debug-action--secondary"
                            onClick={handleExportStressSummary}
                            type="button"
                          >
                            {i18n._({
                              id: 'Export latest JSON',
                              message: 'Export latest JSON',
                            })}
                          </button>
                        ) : null}
                        {displayedStressRun || stressRecords.length ? (
                          <button
                            className="terminal-dock__debug-action terminal-dock__debug-action--secondary"
                            onClick={handleClearStressSummary}
                            type="button"
                          >
                            {i18n._({
                              id: 'Clear summary',
                              message: 'Clear summary',
                            })}
                          </button>
                        ) : null}
                      </div>
                      {debugSuggestions.map((suggestion) => (
                        <span className="terminal-dock__debug-suggestion" key={suggestion}>
                          {suggestion}
                        </span>
                      ))}
                      {displayedStressRun ? (
                        <div className="terminal-dock__debug-summary">
                          <strong>
                            {displayedStressRun.status === 'completed'
                              ? i18n._({
                                  id: 'Stress test summary',
                                  message: 'Stress test summary',
                                })
                              : i18n._({
                                  id: 'Stress test running',
                                  message: 'Stress test running',
                                })}
                          </strong>
                          <div className="terminal-dock__debug-summary-grid">
                            <span>{`session:${displayedStressRun.sessionId ?? 'pending'}`}</span>
                            <span>{`renderer:${displayedStressRun.config.renderer}`}</span>
                            <span>{`terminal:${displayedStressRun.config.terminalSize}`}</span>
                            <span>{`viewport:${displayedStressRun.config.viewportPx}`}</span>
                            <span>{`dock:${displayedStressRun.config.workspacePx}`}</span>
                            <span>{`placement:${displayedStressRun.config.placement}`}</span>
                            <span>{`floating:${displayedStressRun.config.isFloating ? 'yes' : 'no'}`}</span>
                            <span>{`maximized:${displayedStressRun.config.isWindowMaximized ? 'yes' : 'no'}`}</span>
                            <span>{`scrollback:${formatStressMetric(displayedStressRun.config.scrollback)}`}</span>
                            <span>{`output cap:${formatStressMetric(displayedStressRun.config.outputLimit)}`}</span>
                            <span>{`duration:${formatStressDuration(displayedStressRun.durationMs)}`}</span>
                            <span>{`peak rate:${formatStressMetric(displayedStressRun.metrics.peakRate)}/s`}</span>
                            <span>{`peak flush/s:${formatStressMetric(displayedStressRun.metrics.peakFlushRate)}`}</span>
                            <span>{`peak chunk:${formatStressMetric(displayedStressRun.metrics.peakChunk)}`}</span>
                            <span>{`peak output:${formatStressMetric(displayedStressRun.metrics.peakOutput)}`}</span>
                          </div>
                        </div>
                      ) : null}
                      {stressRecords.length > 1 && selectedStressCompareTarget && selectedStressCompareBaseline ? (
                        <>
                          <div className="terminal-dock__debug-compare-controls">
                            <label className="terminal-dock__debug-select">
                              <span>
                                {i18n._({
                                  id: 'Compare run',
                                  message: 'Compare run',
                                })}
                              </span>
                              <select
                                onChange={(event) => setStressCompareTargetId(event.target.value)}
                                value={selectedStressCompareTarget.id}
                              >
                                {stressRecords.map((record) => (
                                  <option key={record.id} value={record.id}>
                                    {formatStressRunLabel(record)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="terminal-dock__debug-select">
                              <span>
                                {i18n._({
                                  id: 'Against',
                                  message: 'Against',
                                })}
                              </span>
                              <select
                                onChange={(event) => setStressCompareBaselineId(event.target.value)}
                                value={selectedStressCompareBaseline.id}
                              >
                                {stressRecords
                                  .filter((record) => record.id !== selectedStressCompareTarget.id)
                                  .map((record) => (
                                    <option key={record.id} value={record.id}>
                                      {formatStressRunLabel(record)}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          </div>
                          {stressComparison ? (
                            <div className="terminal-dock__debug-summary">
                              <strong>
                                {i18n._({
                                  id: 'Stress test comparison',
                                  message: 'Stress test comparison',
                                })}
                              </strong>
                              <div className="terminal-dock__debug-summary-grid">
                                <span>{`current:${formatStressRunLabel(selectedStressCompareTarget)}`}</span>
                                <span>{`baseline:${formatStressRunLabel(selectedStressCompareBaseline)}`}</span>
                                {stressComparison.metrics.map((metric) => (
                                  <span
                                    className={`terminal-dock__debug-summary-chip terminal-dock__debug-summary-chip--${getStressDeltaTone(
                                      metric,
                                    )}`}
                                    key={metric.key}
                                  >
                                    {`${metric.label}:${formatStressComparisonMetricValue(
                                      metric,
                                      metric.current,
                                    )} vs ${formatStressComparisonMetricValue(
                                      metric,
                                      metric.baseline,
                                    )} (${formatStressDelta(metric)})`}
                                  </span>
                                ))}
                                {stressComparison.changedConfig.map((change) => (
                                  <span
                                    className="terminal-dock__debug-summary-chip terminal-dock__debug-summary-chip--accent"
                                    key={change.key}
                                  >
                                    {`${change.label}:${change.baseline} -> ${change.current}`}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="terminal-dock__viewport-stack" ref={viewportStackRef}>
                <Suspense
                  fallback={
                    <div className="terminal-dock__output terminal-dock__output--loading">
                      {i18n._({
                        id: 'Loading terminal…',
                        message: 'Loading terminal…',
                      })}
                    </div>
                  }
                >
                  <ThreadTerminalLauncherViewport
                    className={
                      isLauncherOpen
                        ? 'terminal-dock__output terminal-dock__output--active terminal-dock__output--launcher'
                        : 'terminal-dock__output terminal-dock__output--hidden terminal-dock__output--launcher'
                    }
                    history={launcherHistory}
                    mode={launcherMode}
                    onClose={commandSessions.length ? handleCloseLauncher : undefined}
                    onSelectionChange={handleLauncherSelectionChange}
                    onStartShell={handleStartShellFromLauncher}
                    onRunCommand={handleStartLauncherCommand}
                    pending={startCommandPending}
                    ref={launcherRef}
                    shellLabel={defaultShellLauncherName}
                    visible={isLauncherOpen}
                  />
                  {activeRenderableSession ? (
                    shouldUsePlainTextViewport ? (
                      <div className="terminal-dock__output terminal-dock__output--active terminal-dock__output--static">
                        <ThreadTerminalBlock
                          className="terminal-dock__static-output"
                          content={activeRenderableSession.combinedOutput ?? ''}
                        />
                      </div>
                    ) : (
                      <ThreadTerminalViewport
                        className="terminal-dock__output terminal-dock__output--active"
                        content={activeRenderableSession.combinedOutput ?? ''}
                        interactive={canCommandSessionInteract(activeRenderableSession)}
                        key={activeRenderableSession.id}
                        onSelectionChange={(hasSelection) =>
                          handleSessionSelectionChange(activeRenderableSession.id, hasSelection)
                        }
                        onResize={onResizeTerminal}
                        onWriteData={onWriteTerminalData}
                        ref={(instance) => {
                          if (instance) {
                            viewportRefs.current[activeRenderableSession.id] = instance
                            return
                          }

                          delete viewportRefs.current[activeRenderableSession.id]
                        }}
                        sessionId={activeRenderableSession.id}
                        visible
                        windowsPty={isWindowsCommandSession(activeRenderableSession, rootPath)}
                      />
                    )
                  ) : null}
                </Suspense>
              </div>

              <div className="terminal-dock__input">
                <span className="terminal-dock__hint">
                  {isLauncherOpen
                    ? startCommandPending
                      ? i18n._({
                          id: 'Starting terminal session…',
                          message: 'Starting terminal session…',
                        })
                      : launcherMode === 'shell'
                        ? i18n._({
                            id: 'New {shellName} starts a long-lived PTY session. It stays open until the shell exits or you stop it.',
                            message:
                              'New {shellName} starts a long-lived PTY session. It stays open until the shell exits or you stop it.',
                            values: { shellName: defaultShellLauncherName },
                          })
                        : i18n._({
                            id: 'Run command starts a standalone process session. Use Up/Down to reuse command history.',
                          message:
                            'Run command starts a standalone process session. Use Up/Down to reuse command history.',
                        })
                    : selectedSessionHasLimitedIntegration
                      ? i18n._({
                          id: 'This shell is attached with basic prompt and cwd integration only. PowerShell provides richer command state tracking.',
                          message:
                            'This shell is attached with basic prompt and cwd integration only. PowerShell provides richer command state tracking.',
                        })
                    : isInteractive
                      ? i18n._({
                          id: 'Keyboard input is attached to the active terminal session. Use Ctrl/Cmd+F to search. Shell integration status is tracked live.',
                          message:
                            'Keyboard input is attached to the active terminal session. Use Ctrl/Cmd+F to search. Shell integration status is tracked live.',
                        })
                      : i18n._({
                          id: 'This terminal session is read-only because the process has already exited.',
                          message:
                            'This terminal session is read-only because the process has already exited.',
                        })}
                </span>
              </div>
            </div>
          </div>
        </div>
        {isFloating && !isWindowMaximized ? (
          <button
            aria-label={i18n._({
              id: 'Resize terminal window',
              message: 'Resize terminal window',
            })}
            className="terminal-dock__window-resize"
            onPointerDown={onWindowResizeStart}
            title={i18n._({
              id: 'Resize terminal window',
              message: 'Resize terminal window',
            })}
            type="button"
          >
            <CornerResizeToolIcon />
          </button>
        ) : null}
      </div>
    </>
  )
}

const ThreadTerminalSessionTab = memo(function ThreadTerminalSessionTab({
  archived,
  command,
  isActive,
  onArchiveSession,
  onPinSession,
  onRemoveSession,
  onSelectSession,
  pinned,
  sessionId,
  status,
  title,
  updatedAt,
}: {
  archived: boolean
  command: string
  isActive: boolean
  onArchiveSession: (processId: string) => void
  onPinSession: (processId: string) => void
  onRemoveSession: (processId: string) => void
  onSelectSession: (processId: string) => void
  pinned: boolean
  sessionId: string
  status: string
  title: string
  updatedAt?: string
}) {
  return (
    <div className={isActive ? 'terminal-dock__tab terminal-dock__tab--active' : 'terminal-dock__tab'}>
      <button
        className="terminal-dock__tab-select"
        onClick={() => onSelectSession(sessionId)}
        type="button"
      >
        <div className="terminal-dock__tab-row">
          <span
            className={`terminal-dock__status-dot terminal-dock__status-dot--${getCommandSessionTone(
              status,
            )}`}
          />
          <strong>{title}</strong>
        </div>
        <span>
          {formatCommandSessionStatus(status)}
          {updatedAt ? ` · ${formatRelativeTimeShort(updatedAt)}` : ''}
        </span>
      </button>
      <button
        aria-label={
          pinned
            ? i18n._({
                id: 'Unpin {command}',
                message: 'Unpin {command}',
                values: { command },
              })
            : i18n._({
                id: 'Pin {command}',
                message: 'Pin {command}',
                values: { command },
              })
        }
        className={pinned ? 'terminal-dock__tab-pin terminal-dock__tab-pin--active' : 'terminal-dock__tab-pin'}
        onClick={() => onPinSession(sessionId)}
        type="button"
      >
        <PinToolIcon />
      </button>
      <button
        aria-label={
          archived
            ? i18n._({
                id: 'Unarchive {command}',
                message: 'Unarchive {command}',
                values: { command },
              })
            : i18n._({
                id: 'Archive {command}',
                message: 'Archive {command}',
                values: { command },
              })
        }
        className={
          archived ? 'terminal-dock__tab-archive terminal-dock__tab-archive--active' : 'terminal-dock__tab-archive'
        }
        onClick={() => onArchiveSession(sessionId)}
        type="button"
      >
        <ArchiveToolIcon />
      </button>
      <button
        aria-label={i18n._({
          id: 'Close {command}',
          message: 'Close {command}',
          values: { command },
        })}
        className="terminal-dock__tab-close"
        onClick={() => onRemoveSession(sessionId)}
        type="button"
      >
        ×
      </button>
    </div>
  )
})

function getActiveViewport(
  sessionId: string | undefined,
  viewportRefs: Record<string, ThreadTerminalViewportHandle | null>,
) {
  if (!sessionId) {
    return null
  }

  return viewportRefs[sessionId] ?? null
}

function ThreadTerminalPlacementSwitch({
  onChangePlacement,
  placement,
}: {
  onChangePlacement: (value: TerminalDockPlacement) => void
  placement: TerminalDockPlacement
}) {
  return (
    <div
      aria-label={i18n._({
        id: 'Terminal position',
        message: 'Terminal position',
      })}
      className="terminal-dock__placement"
      role="group"
    >
      <button
        aria-pressed={placement === 'bottom'}
        className={
          placement === 'bottom'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('bottom')}
        type="button"
      >
        {i18n._({
          id: 'Bottom',
          message: 'Bottom',
        })}
      </button>
      <button
        aria-pressed={placement === 'right'}
        className={
          placement === 'right'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('right')}
        type="button"
      >
        {i18n._({
          id: 'Right',
          message: 'Right',
        })}
      </button>
      <button
        aria-pressed={placement === 'floating'}
        className={
          placement === 'floating'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('floating')}
        type="button"
      >
        {i18n._({
          id: 'Float',
          message: 'Float',
        })}
      </button>
    </div>
  )
}

function GripToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M8.5 7.5h7M8.5 12h7M8.5 16.5h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function CornerResizeToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M8 16h8M12 12h4M16 8h0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path d="M7 17 17 7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  )
}

function PinToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M9 4.5h6l-1.2 4.2 2.7 2.5v1.3h-4.2V19.5l-.8.8-.8-.8V12.5H6.5v-1.3l2.7-2.5L9 4.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function ArchiveToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M5 7.5h14v10.2A1.8 1.8 0 0 1 17.2 19.5H6.8A1.8 1.8 0 0 1 5 17.7V7.5Zm1-3h12l1.2 3H4.8L6 4.5Zm4.5 6h3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}
