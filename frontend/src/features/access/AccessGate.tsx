import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { SelectControl } from '../../components/ui/SelectControl'
import { localeLabels } from '../../i18n/config'
import type { AppLocale } from '../../i18n/configTypes'
import { i18n } from '../../i18n/runtime'
import { ApiClientError, ACCESS_UNAUTHORIZED_EVENT } from '../../lib/api-client'
import { getErrorMessage } from '../../lib/error-utils'
import { loginAccess, readAccessBootstrap } from '../settings/api'
import { useSettingsLocalStore } from '../settings/local-store'
import type { ProvidersProps } from '../../app/providersTypes'

function AccessShellFrame({ children }: { children: ReactNode }) {
  return (
    <section className="screen screen--centered access-shell">
      <div className="access-shell__content">{children}</div>
    </section>
  )
}

function AccessCardHeader() {
  const locale = useSettingsLocalStore((state) => state.locale)
  const setLocale = useSettingsLocalStore((state) => state.setLocale)
  const interfaceLanguageTitle = i18n._({
    id: 'Interface language',
    message: 'Interface language',
  })
  const availableLanguagesLabel = i18n._({
    id: 'Available languages',
    message: 'Available languages',
  })

  return (
    <div className="access-card__header">
      <p className="access-card__eyebrow">
        {i18n._({ id: 'Access Control', message: 'Access Control' })}
      </p>
      <SelectControl
        ariaLabel={interfaceLanguageTitle}
        className="access-shell__language-select"
        menuLabel={availableLanguagesLabel}
        onChange={(value) => setLocale(value as AppLocale)}
        options={(Object.entries(localeLabels) as Array<[AppLocale, (typeof localeLabels)[AppLocale]]>).map(
          ([value, labels]) => ({
            value,
            label:
              labels.nativeLabel === labels.label
                ? labels.label
                : `${labels.nativeLabel} · ${labels.label}`,
            triggerLabel: labels.shortLabel,
          }),
        )}
        value={locale}
      />
    </div>
  )
}

export function AccessGate({ children }: ProvidersProps) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')

  const bootstrapQuery = useQuery({
    queryKey: ['access-bootstrap'],
    queryFn: readAccessBootstrap,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiClientError &&
        (error.code === 'remote_access_disabled' ||
          error.code === 'remote_access_requires_active_token')
      ) {
        return false
      }
      return failureCount < 1
    },
  })

  const loginMutation = useMutation({
    mutationFn: () => loginAccess(token),
    onSuccess: async () => {
      setToken('')
      await queryClient.invalidateQueries({ queryKey: ['access-bootstrap'] })
    },
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const handleUnauthorized = () => {
      void queryClient.invalidateQueries({ queryKey: ['access-bootstrap'] })
    }

    window.addEventListener(ACCESS_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => {
      window.removeEventListener(ACCESS_UNAUTHORIZED_EVENT, handleUnauthorized)
    }
  }, [queryClient])

  if (bootstrapQuery.isLoading) {
    return (
      <AccessShellFrame>
        <div className="access-card access-card--loading">
          <AccessCardHeader />
          <h1 className="access-card__title">
            {i18n._({ id: 'Checking backend access…', message: 'Checking backend access…' })}
          </h1>
          <p className="access-card__copy">
            {i18n._({
              id: 'The browser is verifying whether this codex-server instance requires an access token.',
              message:
                'The browser is verifying whether this codex-server instance requires an access token.',
            })}
          </p>
        </div>
      </AccessShellFrame>
    )
  }

  if (bootstrapQuery.error) {
    const isRemoteDisabled =
      bootstrapQuery.error instanceof ApiClientError &&
      bootstrapQuery.error.code === 'remote_access_disabled'
    const requiresLocalTokenSetup =
      bootstrapQuery.error instanceof ApiClientError &&
      bootstrapQuery.error.code === 'remote_access_requires_active_token'

    return (
      <AccessShellFrame>
        <div className="access-card">
          <AccessCardHeader />
          <h1 className="access-card__title">
            {isRemoteDisabled
              ? i18n._({
                  id: 'Remote access is blocked',
                  message: 'Remote access is blocked',
                })
              : requiresLocalTokenSetup
                ? i18n._({
                    id: 'Remote access needs local token setup',
                    message: 'Remote access needs local token setup',
                  })
              : i18n._({
                  id: 'Backend access check failed',
                  message: 'Backend access check failed',
                })}
          </h1>
          <p className="access-card__copy">
            {isRemoteDisabled
              ? i18n._({
                  id: 'This backend currently only accepts localhost requests. If you need LAN access, enable remote access in the backend access settings on the local machine first.',
                  message:
                    'This backend currently only accepts localhost requests. If you need LAN access, enable remote access in the backend access settings on the local machine first.',
                })
              : requiresLocalTokenSetup
                ? i18n._({
                    id: 'This backend only allows remote clients after a local administrator creates at least one active access token from localhost, 127.0.0.1, or ::1.',
                    message:
                      'This backend only allows remote clients after a local administrator creates at least one active access token from localhost, 127.0.0.1, or ::1.',
                  })
              : getErrorMessage(bootstrapQuery.error)}
          </p>
          {!isRemoteDisabled && !requiresLocalTokenSetup ? (
            <div className="access-card__actions">
              <Button
                intent="secondary"
                onClick={() => {
                  void bootstrapQuery.refetch()
                }}
              >
                {i18n._({ id: 'Retry', message: 'Retry' })}
              </Button>
            </div>
          ) : null}
        </div>
      </AccessShellFrame>
    )
  }

  const bootstrap = bootstrapQuery.data
  if (!bootstrap) {
    return null
  }

  if (!bootstrap.loginRequired || bootstrap.authenticated) {
    return <>{children}</>
  }

  const isWaitingForLocalTokenSetup = bootstrap.activeTokenCount === 0

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    loginMutation.mutate()
  }

  return (
    <AccessShellFrame>
      <form className="access-card" onSubmit={handleSubmit}>
        <AccessCardHeader />
        <h1 className="access-card__title">
          {i18n._({
            id: 'Sign in with access token',
            message: 'Sign in with access token',
          })}
        </h1>

        {isWaitingForLocalTokenSetup ? (
          <InlineNotice
            onRetry={() => {
              void bootstrapQuery.refetch()
            }}
            title={i18n._({
              id: 'Token setup needed',
              message: 'Token setup needed',
            })}
            tone="info"
          >
            {i18n._({
              id: 'This backend only allows remote clients after a local administrator creates at least one active access token from localhost, 127.0.0.1, or ::1.',
              message:
                'This backend only allows remote clients after a local administrator creates at least one active access token from localhost, 127.0.0.1, or ::1.',
            })}
          </InlineNotice>
        ) : null}

        {bootstrap.allowLocalhostWithoutAccessToken ? (
          <InlineNotice
            title={i18n._({
              id: 'Localhost can open directly',
              message: 'Localhost can open directly',
            })}
            tone="info"
          >
            {i18n._({
              id: 'This server currently lets localhost, 127.0.0.1, and ::1 open the UI without token login. This remote client still needs a valid access token.',
              message:
                'This server currently lets localhost, 127.0.0.1, and ::1 open the UI without token login. This remote client still needs a valid access token.',
            })}
          </InlineNotice>
        ) : null}

        {!bootstrap.allowRemoteAccess ? (
          <div className="access-card__meta">
            <span className="meta-pill meta-pill--warning">
              {i18n._({
                id: 'localhost only',
                message: 'localhost only',
              })}
            </span>
          </div>
        ) : null}

        <Input
          aria-label={i18n._({ id: 'Access Token', message: 'Access Token' })}
          autoComplete="current-password"
          onChange={(event) => setToken(event.target.value)}
          placeholder={i18n._({
            id: 'Paste access token',
            message: 'Paste access token',
          })}
          type="password"
          value={token}
        />

        {loginMutation.error ? (
          <InlineNotice
            details={getErrorMessage(loginMutation.error)}
            title={i18n._({ id: 'Login Failed', message: 'Login Failed' })}
            tone="error"
          >
            {getErrorMessage(loginMutation.error)}
          </InlineNotice>
        ) : null}

        <div className="access-card__actions access-card__actions--centered">
          <Button
            isLoading={loginMutation.isPending}
            type="submit"
          >
            {i18n._({ id: 'Enter Workspace', message: 'Enter Workspace' })}
          </Button>
        </div>
      </form>
    </AccessShellFrame>
  )
}
