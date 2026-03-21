import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useRouteError } from 'react-router-dom'

import { describeRouteError } from '../lib/route-error'

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
        <div className="route-error__topline">
          <p className="page-header__eyebrow">Route Recovery</p>
          <span className="route-error__pill route-error__pill--danger">{description.code}</span>
          <span className="route-error__pill">{scopeLabel}</span>
        </div>

        <div className="route-error__hero">
          <div aria-hidden="true" className="route-error__signal">
            <span />
          </div>
          <div className="route-error__copy">
            <h1>{description.title}</h1>
            <p>{description.message}</p>
          </div>
        </div>

        <div className="route-error__actions">
          <button className="ide-button" onClick={handleRetry} type="button">
            Try again
          </button>
          {canGoBack ? (
            <button
              className="ide-button ide-button--secondary"
              onClick={() => navigate(-1)}
              type="button"
            >
              Go back
            </button>
          ) : null}
          <Link className="ide-button ide-button--secondary" to={homeTo}>
            {homeLabel}
          </Link>
        </div>

        <div className="route-error__facts" role="presentation">
          <section className="route-error__fact">
            <span>Failed route</span>
            <strong>{location.pathname || '/'}</strong>
          </section>
          <section className="route-error__fact">
            <span>Next step</span>
            <strong>{description.recovery}</strong>
          </section>
        </div>

        {description.details ? (
          <details className="route-error__debug">
            <summary>Technical details</summary>
            <div className="route-error__debug-actions">
              <button className="notice__tool" onClick={() => void handleCopyDetails()} type="button">
                {copied ? 'Copied' : 'Copy details'}
              </button>
            </div>
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
      homeLabel="Back to Workspaces"
      homeTo="/workspaces"
      scopeLabel="App shell"
    />
  )
}

export function AppContentRouteErrorPage() {
  return (
    <RouteErrorPage
      chrome="page"
      homeLabel="Back to Workspaces"
      homeTo="/workspaces"
      scopeLabel="Workspace area"
    />
  )
}

export function SettingsRouteErrorPage() {
  return (
    <RouteErrorPage
      chrome="page"
      homeLabel="Back to Workspaces"
      homeTo="/workspaces"
      scopeLabel="Settings shell"
    />
  )
}

export function SettingsContentRouteErrorPage() {
  return (
    <RouteErrorPage
      chrome="panel"
      homeLabel="Back to Workspaces"
      homeTo="/workspaces"
      scopeLabel="Settings page"
    />
  )
}
