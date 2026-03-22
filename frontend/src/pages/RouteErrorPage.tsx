import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useRouteError } from 'react-router-dom'

import { i18n } from '../i18n/runtime'
import { describeRouteError } from '../lib/route-error'
import { WarningIcon } from '../components/ui/RailControls'

type RouteErrorPageProps = {
  chrome: 'fullscreen' | 'page' | 'panel'
  scopeLabel: string
  homeLabel: string
  homeTo: string
}

function RouteErrorPage({ chrome, scopeLabel, homeLabel, homeTo }: RouteErrorPageProps) {
  const error = useRouteError()
  const location = useLocation()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const focusRef = useRef<HTMLElement | null>(null)
  const description = describeRouteError(error)
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  useEffect(() => {
    focusRef.current?.focus()
  }, [])

  async function handleCopyDetails() {
    if (!description.details || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(description.details)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  function handleRetry() {
    window.location.reload()
  }

  const containerClass =
    chrome === 'fullscreen'
      ? 'screen screen--centered route-error route-error--fullscreen'
      : chrome === 'page'
        ? 'stack-screen route-error route-error--page'
        : 'route-error route-error--panel'

  return (
    <section className={containerClass}>
      <section
        aria-live="assertive"
        className={`mode-panel route-error__card route-error__card--${chrome}`}
        ref={focusRef}
        role="alert"
        tabIndex={-1}
      >
        <div className="route-error__hero">
          <div className="route-error__copy">
            <div className="route-error__headline">
              <div className="route-error__meta" role="presentation">
                <span className="route-error__pill route-error__pill--danger">
                  <WarningIcon />
                  {description.code}
                </span>
                <span className="route-error__pill">{scopeLabel}</span>                <span className="route-error__pill route-error__pill--route" title={location.pathname || '/'}>
                  {location.pathname || '/'}
                </span>
              </div>
              <h1>{description.title}</h1>
            </div>
          </div>
          <div className="route-error__actions">
            <button className="ide-button ide-button--sm" onClick={handleRetry} type="button">
              {i18n._({ id: 'Retry', message: 'Retry' })}
            </button>
            {description.details ? (
              <button className="ide-button ide-button--secondary ide-button--sm" onClick={() => void handleCopyDetails()} type="button">
                {copied
                  ? i18n._({ id: 'Copied', message: 'Copied' })
                  : i18n._({ id: 'Copy', message: 'Copy' })}
              </button>
            ) : null}
            {canGoBack ? (
              <button
                className="ide-button ide-button--secondary ide-button--sm"
                onClick={() => navigate(-1)}
                type="button"
              >
                {i18n._({ id: 'Back', message: 'Back' })}
              </button>
            ) : null}
            <Link className="ide-button ide-button--secondary ide-button--sm" to={homeTo}>
              {homeLabel}
            </Link>
          </div>
        </div>

        {description.details ? (
          <details className="route-error__debug" open>
            <summary>{i18n._({ id: 'Details', message: 'Details' })}</summary>
            <pre className="code-block">{description.details}</pre>
          </details>
        ) : null}
      </section>
    </section>
  )
}

export function RootRouteErrorPage() {
  return (
    <RouteErrorPage
      chrome="fullscreen"
      homeLabel={i18n._({ id: 'Workspaces', message: 'Workspaces' })}
      homeTo="/workspaces"
      scopeLabel={i18n._({ id: 'App shell', message: 'App shell' })}
    />
  )
}

export function AppContentRouteErrorPage() {
  return (
    <RouteErrorPage
      chrome="page"
      homeLabel={i18n._({ id: 'Workspaces', message: 'Workspaces' })}
      homeTo="/workspaces"
      scopeLabel={i18n._({ id: 'Workspace area', message: 'Workspace area' })}
    />
  )
}

export function SettingsRouteErrorPage() {
  return (
    <RouteErrorPage
      chrome="page"
      homeLabel={i18n._({ id: 'Workspaces', message: 'Workspaces' })}
      homeTo="/workspaces"
      scopeLabel={i18n._({ id: 'Settings shell', message: 'Settings shell' })}
    />
  )
}

export function SettingsContentRouteErrorPage() {
  return (
    <RouteErrorPage
      chrome="panel"
      homeLabel={i18n._({ id: 'Workspaces', message: 'Workspaces' })}
      homeTo="/workspaces"
      scopeLabel={i18n._({ id: 'Settings page', message: 'Settings page' })}
    />
  )
}
