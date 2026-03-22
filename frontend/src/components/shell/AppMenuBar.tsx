import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'

import {
  getAppearancePaletteLabel,
  getAppearanceThemeDescription,
  getColorThemeDescription,
  getColorThemeLabel,
  appearanceThemeOptions,
  colorThemeOptions,
  resolveAppearanceTheme,
} from '../../features/settings/appearance'
import type { AccentTone, AppearanceTheme } from '../../features/settings/appearance'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSystemAppearancePreferences } from '../../features/settings/useSystemAppearancePreferences'
import { useSessionStore } from '../../stores/session-store'
import { useUIStore } from '../../stores/ui-store'
import { i18n } from '../../i18n/runtime'
import { RefreshIcon, RailIconButton, ToolsIcon } from '../ui/RailControls'
import { NotificationCenter } from './NotificationCenter'
import type { CSSProperties } from 'react'

const menuItems = ['File', 'Edit', 'View', 'Window', 'Help'] as const

type AppMenuBarProps = {
  commandPaletteShortcutLabel: string
  mobileNavOpen?: boolean
  onOpenCommandPalette: () => void
  onOpenSidebar?: () => void
  showMobileNavButton?: boolean
}

type MenuPosition = {
  top: number
  left: number
  width: number
  transformOrigin: string
}

const colorThemeStyleByValue = colorThemeOptions.reduce(
  (styles, option) => {
    const accent = option.swatches[0]

    styles[option.value] = {
      ['--appearance-theme-accent' as string]: accent,
      ['--appearance-theme-accent-soft' as string]: `color-mix(in srgb, ${accent} 14%, transparent)`,
      ['--appearance-theme-border' as string]: `color-mix(in srgb, ${accent} 34%, transparent)`,
    }

    return styles
  },
  {} as Record<AccentTone, CSSProperties>,
)

function MenuIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M4 5.5h12M4 10h12M4 14.5h12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="9" cy="9" r="4.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12.6 12.6 3.2 3.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <rect
        height="10"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.45"
        width="13"
        x="3.5"
        y="4"
      />
      <path
        d="M7.1 16h5.8M10 14v2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.45"
      />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2.25v2.1M10 15.65v2.1M4.52 4.52l1.48 1.48M14 14l1.48 1.48M2.25 10h2.1M15.65 10h2.1M4.52 15.48L6 14M14 6l1.48-1.48"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M12.72 2.85a7.2 7.2 0 1 0 4.43 12.53A7.95 7.95 0 0 1 12.72 2.85Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function CaretIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="m4.5 6.5 3.5 3.8 3.5-3.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function ThemeModeGlyph({
  theme,
  resolvedTheme,
}: {
  theme: AppearanceTheme
  resolvedTheme: 'light' | 'dark'
}) {
  if (theme === 'system') {
    return <MonitorIcon />
  }

  return resolvedTheme === 'dark' ? <MoonIcon /> : <SunIcon />
}

function getAppearanceModeShortLabel(theme: AppearanceTheme) {
  switch (theme) {
    case 'system':
      return i18n._({
        id: 'Auto',
        message: 'Auto',
      })
    case 'light':
      return i18n._({
        id: 'Light',
        message: 'Light',
      })
    case 'dark':
      return i18n._({
        id: 'Dark',
        message: 'Dark',
      })
    default:
      return theme
  }
}

function getAppearanceModeLabel(theme: AppearanceTheme) {
  switch (theme) {
    case 'system':
      return i18n._({
        id: 'System',
        message: 'System',
      })
    case 'light':
      return i18n._({
        id: 'Light',
        message: 'Light',
      })
    case 'dark':
      return i18n._({
        id: 'Dark',
        message: 'Dark',
      })
    default:
      return theme
  }
}

function getResolvedThemeLabel(resolvedTheme: 'light' | 'dark') {
  return resolvedTheme === 'dark'
    ? i18n._({
        id: 'Dark',
        message: 'Dark',
      })
    : i18n._({
        id: 'Light',
        message: 'Light',
      })
}

function getMenuItemLabel(item: (typeof menuItems)[number]) {
  switch (item) {
    case 'File':
      return i18n._({
        id: 'File',
        message: 'File',
      })
    case 'Edit':
      return i18n._({
        id: 'Edit',
        message: 'Edit',
      })
    case 'View':
      return i18n._({
        id: 'View',
        message: 'View',
      })
    case 'Window':
      return i18n._({
        id: 'Window',
        message: 'Window',
      })
    case 'Help':
      return i18n._({
        id: 'Help',
        message: 'Help',
      })
    default:
      return item
  }
}

function AppearanceMenu({ compact = false }: { compact?: boolean }) {
  const theme = useSettingsLocalStore((state) => state.theme)
  const accentTone = useSettingsLocalStore((state) => state.accentTone)
  const setTheme = useSettingsLocalStore((state) => state.setTheme)
  const setAccentTone = useSettingsLocalStore((state) => state.setAccentTone)
  const { prefersDark } = useSystemAppearancePreferences()
  const resolvedTheme = resolveAppearanceTheme(theme, prefersDark)
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const dialogId = useId()
  const activeColorTheme = useMemo(
    () => colorThemeOptions.find((option) => option.value === accentTone) ?? colorThemeOptions[0],
    [accentTone],
  )

  useEffect(() => {
    if (!isOpen || !menuPosition) {
      return
    }

    popoverRef.current?.focus()
  }, [isOpen, menuPosition])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) {
        return
      }

      const rect = trigger.getBoundingClientRect()
      const viewportPadding = 12
      const menuGap = 4
      const width = Math.min(
        Math.max(rect.width, compact ? 276 : 318),
        window.innerWidth - viewportPadding * 2,
      )
      const estimatedHeight = compact ? 412 : 400
      const menuHeight = popoverRef.current?.offsetHeight ?? estimatedHeight
      const openAbove =
        rect.bottom + menuGap + menuHeight > window.innerHeight - viewportPadding &&
        rect.top > window.innerHeight - rect.bottom
      const top = openAbove
        ? Math.max(viewportPadding, rect.top - menuHeight - menuGap)
        : Math.min(rect.bottom + menuGap, window.innerHeight - viewportPadding - menuHeight)
      const left = Math.max(
        viewportPadding,
        Math.min(rect.right - width, window.innerWidth - viewportPadding - width),
      )

      setMenuPosition({
        top,
        left,
        width,
        transformOrigin: openAbove ? 'bottom right' : 'top right',
      })
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    const frameId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [compact, isOpen])

  const currentModeLabel =
    theme === 'system'
      ? `${getAppearanceModeShortLabel(theme)} · ${getResolvedThemeLabel(resolvedTheme)}`
      : getAppearanceModeLabel(theme)
  const triggerClassName = compact
    ? 'web-ide__appearance-trigger web-ide__appearance-trigger--mobile'
    : 'web-ide__appearance-trigger'
  const activeThemeStyle = colorThemeStyleByValue[activeColorTheme.value]
  const activeColorThemeLabel = getColorThemeLabel(activeColorTheme.value)
  const appearancePaletteLabel = getAppearancePaletteLabel(activeColorTheme.value, resolvedTheme)

  const popover =
    isOpen && menuPosition
      ? createPortal(
          <div
            aria-label={i18n._({
              id: 'Appearance',
              message: 'Appearance',
            })}
            className="web-ide__appearance-popover"
            id={dialogId}
            ref={popoverRef}
            role="dialog"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
              transformOrigin: menuPosition.transformOrigin,
            }}
            tabIndex={-1}
          >
            <div className="web-ide__appearance-popover-header">
              <strong>{appearancePaletteLabel}</strong>
              <span>
                {i18n._({
                  id: 'Color theme and mode stay synced with Appearance settings.',
                  message: 'Color theme and mode stay synced with Appearance settings.',
                })}
              </span>
            </div>

            <section className="web-ide__appearance-section" aria-labelledby={`${dialogId}-mode`}>
              <div className="web-ide__appearance-section-heading">
                <span id={`${dialogId}-mode`}>
                  {i18n._({
                    id: 'Theme mode',
                    message: 'Theme mode',
                  })}
                </span>
                <span>{currentModeLabel}</span>
              </div>
              <div
                aria-label={i18n._({
                  id: 'Theme mode',
                  message: 'Theme mode',
                })}
                className="web-ide__appearance-mode-group"
                role="group"
              >
                {appearanceThemeOptions.map((option) => {
                  const isActive = theme === option.value
                  const optionClassName = isActive
                    ? 'web-ide__appearance-mode-button web-ide__appearance-mode-button--active'
                    : 'web-ide__appearance-mode-button'

                  return (
                    <button
                      aria-pressed={isActive}
                      className={optionClassName}
                      key={option.value}
                      onClick={() => setTheme(option.value)}
                      title={getAppearanceThemeDescription(option.value)}
                      type="button"
                    >
                      <span className="web-ide__appearance-mode-icon" aria-hidden="true">
                        <ThemeModeGlyph
                          resolvedTheme={option.value === 'dark' ? 'dark' : 'light'}
                          theme={option.value}
                        />
                      </span>
                      <span>{getAppearanceModeShortLabel(option.value)}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="web-ide__appearance-section" aria-labelledby={`${dialogId}-color`}>
              <div className="web-ide__appearance-section-heading">
                <span id={`${dialogId}-color`}>
                  {i18n._({
                    id: 'Color theme',
                    message: 'Color theme',
                  })}
                </span>
                <span>{activeColorThemeLabel}</span>
              </div>
              <div className="web-ide__appearance-theme-list">
                {colorThemeOptions.map((option) => {
                  const isActive = accentTone === option.value
                  const optionClassName = isActive
                    ? 'web-ide__appearance-theme-option web-ide__appearance-theme-option--active'
                    : 'web-ide__appearance-theme-option'

                  return (
                    <button
                      aria-pressed={isActive}
                      className={optionClassName}
                      key={option.value}
                      onClick={() => setAccentTone(option.value)}
                      style={colorThemeStyleByValue[option.value]}
                      title={getColorThemeDescription(option.value)}
                      type="button"
                    >
                      <span className="web-ide__appearance-theme-palette" aria-hidden="true">
                        {option.swatches.slice(0, 4).map((swatch) => (
                          <span
                            className="web-ide__appearance-theme-dot"
                            key={swatch}
                            style={{ background: swatch }}
                          />
                        ))}
                      </span>
                      <span className="web-ide__appearance-theme-copy">
                        <strong>{getColorThemeLabel(option.value)}</strong>
                      </span>
                      <span
                        aria-hidden="true"
                        className={
                          isActive
                            ? 'web-ide__appearance-theme-state web-ide__appearance-theme-state--active'
                            : 'web-ide__appearance-theme-state'
                        }
                      />
                    </button>
                  )
                })}
              </div>
            </section>
          </div>,
          document.body,
        )
      : null

  return (
    <div className="web-ide__appearance" ref={rootRef}>
      <button
        aria-controls={dialogId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={i18n._({
          id: 'Appearance menu. {colorTheme}. {mode}.',
          message: 'Appearance menu. {colorTheme}. {mode}.',
          values: {
            colorTheme: activeColorThemeLabel,
            mode: currentModeLabel,
          },
        })}
        className={triggerClassName}
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        style={activeThemeStyle}
        title={`${activeColorThemeLabel} · ${currentModeLabel}`}
        type="button"
      >
        <span className="web-ide__appearance-trigger-palette" aria-hidden="true">
          {activeColorTheme.swatches.slice(0, compact ? 2 : 3).map((swatch) => (
            <span className="web-ide__appearance-trigger-dot" key={swatch} style={{ background: swatch }} />
          ))}
        </span>
        <span className="web-ide__appearance-trigger-copy">
          <span className="web-ide__appearance-trigger-label">
            {compact
              ? i18n._({
                  id: 'Theme',
                  message: 'Theme',
                })
              : i18n._({
                  id: 'Appearance',
                  message: 'Appearance',
                })}
          </span>
          <span className="web-ide__appearance-trigger-value">{activeColorThemeLabel}</span>
        </span>
        <span className="web-ide__appearance-trigger-mode" aria-hidden="true">
          <ThemeModeGlyph resolvedTheme={resolvedTheme} theme={theme} />
        </span>
        <span className="web-ide__appearance-trigger-caret" aria-hidden="true">
          <CaretIcon />
        </span>
      </button>
      {popover}
    </div>
  )
}

export function AppMenuBar({
  commandPaletteShortcutLabel,
  mobileNavOpen = false,
  onOpenCommandPalette,
  onOpenSidebar,
  showMobileNavButton = false,
}: AppMenuBarProps) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const openCommandPaletteLabel = i18n._({
    id: 'Open command palette',
    message: 'Open command palette',
  })
  const commandPaletteLabel = i18n._({
    id: 'Command Palette',
    message: 'Command Palette',
  })
  const syncThreadNowLabel = i18n._({
    id: 'Sync thread now',
    message: 'Sync thread now',
  })
  const threadRunningLabel = i18n._({
    id: 'Thread running',
    message: 'Thread running',
  })
  const threadIdleLabel = i18n._({
    id: 'Thread idle',
    message: 'Thread idle',
  })
  const threadToolsLabel = i18n._({
    id: 'Thread tools',
    message: 'Thread tools',
  })
  const commandTriggerLabel = showMobileNavButton
    ? i18n._({ id: 'Search', message: 'Search' })
    : i18n._({ id: 'Command', message: 'Command' })
  const mobileThreadChromeVisible = useUIStore((state) => state.mobileThreadChromeVisible)
  const mobileThreadTitle = useUIStore((state) => state.mobileThreadTitle)
  const mobileThreadStatusLabel = useUIStore((state) => state.mobileThreadStatusLabel)
  const mobileThreadStatusTone = useUIStore((state) => state.mobileThreadStatusTone)
  const mobileThreadSyncLabel = useUIStore((state) => state.mobileThreadSyncLabel)
  const mobileThreadSyncTitle = useUIStore((state) => state.mobileThreadSyncTitle)
  const mobileThreadActivityVisible = useUIStore((state) => state.mobileThreadActivityVisible)
  const mobileThreadActivityRunning = useUIStore((state) => state.mobileThreadActivityRunning)
  const mobileThreadRefreshBusy = useUIStore((state) => state.mobileThreadRefreshBusy)
  const mobileThreadToolsOpen = useUIStore((state) => state.mobileThreadToolsOpen)
  const setMobileThreadToolsOpen = useUIStore((state) => state.setMobileThreadToolsOpen)
  const threadRouteMatch = location.pathname.match(/^\/workspaces\/([^/]+)$/)
  const workspaceId = threadRouteMatch?.[1] ?? ''
  const isThreadRoute = Boolean(workspaceId)
  const shouldShowThreadChrome = isThreadRoute && mobileThreadChromeVisible
  const selectedThreadId = useSessionStore((state) =>
    workspaceId ? state.selectedThreadIdByWorkspace[workspaceId] : undefined,
  )

  async function handleRefreshThreadChrome() {
    if (!workspaceId) {
      return
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
      selectedThreadId
        ? queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
    ])
  }

  return (
    <header className="web-ide__menubar">
      <div className="web-ide__menuitems">
        {showMobileNavButton ? (
          <button
            aria-expanded={mobileNavOpen}
            aria-label={
              mobileNavOpen
                ? i18n._({
                    id: 'Close navigation',
                    message: 'Close navigation',
                  })
                : i18n._({
                    id: 'Open navigation',
                    message: 'Open navigation',
                  })
            }
            className="web-ide__mobile-nav-button"
            onClick={onOpenSidebar}
            type="button"
          >
            <MenuIcon />
          </button>
        ) : null}
        <span className="web-ide__menu-dot" />
        {showMobileNavButton ? (
          <span
            className={
              shouldShowThreadChrome
                ? 'web-ide__mobile-title web-ide__mobile-title--thread'
                : 'web-ide__mobile-title'
            }
            title={shouldShowThreadChrome && mobileThreadTitle ? mobileThreadTitle : 'codex-server'}
          >
            {shouldShowThreadChrome && mobileThreadTitle ? mobileThreadTitle : 'codex-server'}
          </span>
        ) : null}
        {menuItems.map((item) => (
          <button className="web-ide__menuitem" key={item} type="button">
            {getMenuItemLabel(item)}
          </button>
        ))}
      </div>

      {!showMobileNavButton && shouldShowThreadChrome ? (
        <div className="web-ide__thread-titlebar">
          <div className="web-ide__thread-titlebar-copy">
            <strong title={mobileThreadTitle}>{mobileThreadTitle}</strong>
          </div>
          <div className="web-ide__thread-titlebar-meta">
            {mobileThreadSyncLabel ? (
              <span
                className="meta-pill web-ide__thread-sync-pill"
                title={mobileThreadSyncTitle || mobileThreadSyncLabel}
              >
                {mobileThreadSyncLabel}
              </span>
            ) : null}
            <button
              aria-label={syncThreadNowLabel}
              className={
                mobileThreadRefreshBusy
                  ? 'web-ide__thread-refresh-button web-ide__thread-refresh-button--spinning'
                  : 'web-ide__thread-refresh-button'
              }
              disabled={mobileThreadRefreshBusy}
              onClick={() => void handleRefreshThreadChrome()}
              title={syncThreadNowLabel}
              type="button"
            >
              <RefreshIcon />
            </button>
            <span className={`status-pill status-pill--${mobileThreadStatusTone} web-ide__thread-status-pill`}>
              {mobileThreadStatusLabel}
            </span>
            {mobileThreadActivityVisible ? (
              <span
                className="web-ide__thread-activity-status"
                title={mobileThreadActivityRunning ? threadRunningLabel : threadIdleLabel}
              >
                <span
                  aria-hidden="true"
                  className={
                    mobileThreadActivityRunning
                      ? 'web-ide__thread-activity-dot web-ide__thread-activity-dot--running'
                      : 'web-ide__thread-activity-dot web-ide__thread-activity-dot--idle'
                  }
                />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="web-ide__status">
        {showMobileNavButton && shouldShowThreadChrome ? (
          <div className="web-ide__thread-tools">
            {mobileThreadSyncLabel ? (
              <span
                className="meta-pill web-ide__thread-sync-pill"
                title={mobileThreadSyncTitle || mobileThreadSyncLabel}
              >
                {mobileThreadSyncLabel}
              </span>
            ) : null}
            <button
              aria-label={syncThreadNowLabel}
              className={
                mobileThreadRefreshBusy
                  ? 'web-ide__thread-refresh-button web-ide__thread-refresh-button--spinning'
                  : 'web-ide__thread-refresh-button'
              }
              disabled={mobileThreadRefreshBusy}
              onClick={() => void handleRefreshThreadChrome()}
              title={syncThreadNowLabel}
              type="button"
            >
              <RefreshIcon />
            </button>
            <span className={`status-pill status-pill--${mobileThreadStatusTone} web-ide__thread-status-pill`}>
              {mobileThreadStatusLabel}
            </span>
            <RailIconButton
              aria-label={
                mobileThreadToolsOpen
                  ? i18n._({
                      id: 'Close thread tools',
                      message: 'Close thread tools',
                    })
                  : i18n._({
                      id: 'Open thread tools',
                      message: 'Open thread tools',
                    })
              }
              className={
                mobileThreadToolsOpen
                  ? 'web-ide__thread-tools-button web-ide__thread-tools-button--active'
                  : 'web-ide__thread-tools-button'
              }
              onClick={() => setMobileThreadToolsOpen(!mobileThreadToolsOpen)}
              title={threadToolsLabel}
              >
                <ToolsIcon />
              </RailIconButton>
            {mobileThreadActivityVisible ? (
              <span
                className="web-ide__thread-activity-status"
                title={mobileThreadActivityRunning ? threadRunningLabel : threadIdleLabel}
              >
                <span
                  aria-hidden="true"
                  className={
                    mobileThreadActivityRunning
                      ? 'web-ide__thread-activity-dot web-ide__thread-activity-dot--running'
                      : 'web-ide__thread-activity-dot web-ide__thread-activity-dot--idle'
                  }
                />
              </span>
            ) : null}
          </div>
        ) : null}
        {!shouldShowThreadChrome ? (
          <div className="web-ide__usage">
          <span className="web-ide__usage-positive">+2,959</span>
          <span className="web-ide__usage-negative">-529</span>
          </div>
        ) : null}
        <button
          aria-label={`${openCommandPaletteLabel} (${commandPaletteShortcutLabel})`}
          className={
            showMobileNavButton
              ? 'web-ide__command-trigger web-ide__command-trigger--mobile'
              : 'web-ide__command-trigger'
          }
          onClick={onOpenCommandPalette}
          title={`${commandPaletteLabel} (${commandPaletteShortcutLabel})`}
          type="button"
        >
          <span className="web-ide__command-trigger-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <span className="web-ide__command-trigger-copy">
            <span className="web-ide__command-trigger-label">{commandTriggerLabel}</span>
            {!showMobileNavButton ? (
              <span className="web-ide__command-trigger-hint">{commandPaletteShortcutLabel}</span>
            ) : null}
          </span>
        </button>
        <NotificationCenter compact={showMobileNavButton} />
        <AppearanceMenu compact={showMobileNavButton} />
      </div>
    </header>
  )
}
