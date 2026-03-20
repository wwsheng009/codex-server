import {
  getAppearanceThemeLabel,
  getQuickToggleTheme,
  resolveAppearanceTheme,
} from '../../features/settings/appearance'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSystemAppearancePreferences } from '../../features/settings/useSystemAppearancePreferences'

const menuItems = ['File', 'Edit', 'View', 'Window', 'Help']

type AppMenuBarProps = {
  mobileNavOpen?: boolean
  onOpenSidebar?: () => void
  showMobileNavButton?: boolean
}

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

export function AppMenuBar({
  mobileNavOpen = false,
  onOpenSidebar,
  showMobileNavButton = false,
}: AppMenuBarProps) {
  const theme = useSettingsLocalStore((state) => state.theme)
  const setTheme = useSettingsLocalStore((state) => state.setTheme)
  const { prefersDark } = useSystemAppearancePreferences()

  const resolvedTheme = resolveAppearanceTheme(theme, prefersDark)
  const nextTheme = getQuickToggleTheme(theme, prefersDark)
  const currentThemeLabel =
    theme === 'system'
      ? `System (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})`
      : getAppearanceThemeLabel(theme)
  const nextThemeLabel = getAppearanceThemeLabel(nextTheme)

  return (
    <header className="web-ide__menubar">
      <div className="web-ide__menuitems">
        {showMobileNavButton ? (
          <button
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
            className="web-ide__mobile-nav-button"
            onClick={onOpenSidebar}
            type="button"
          >
            <MenuIcon />
          </button>
        ) : null}
        <span className="web-ide__menu-dot" />
        {showMobileNavButton ? <span className="web-ide__mobile-title">codex-server</span> : null}
        {menuItems.map((item) => (
          <button className="web-ide__menuitem" key={item} type="button">
            {item}
          </button>
        ))}
      </div>

      <div className="web-ide__status">
        <div className="web-ide__usage">
          <span className="web-ide__usage-positive">+2,959</span>
          <span className="web-ide__usage-negative">-529</span>
        </div>
        <button
          aria-label={`Current theme ${currentThemeLabel}. Switch to ${nextThemeLabel}.`}
          className={theme === 'system' ? 'web-ide__theme-toggle web-ide__theme-toggle--system' : 'web-ide__theme-toggle'}
          onClick={() => setTheme(nextTheme)}
          title={`Current theme ${currentThemeLabel}. Switch to ${nextThemeLabel}.`}
          type="button"
        >
          <span className="web-ide__theme-toggle-icon">
            {resolvedTheme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </span>
          {theme === 'system' ? <span aria-hidden="true" className="web-ide__theme-toggle-badge" /> : null}
        </button>
      </div>
    </header>
  )
}
