import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { i18n } from '../../i18n/runtime'
import { ApiClientError, ACCESS_UNAUTHORIZED_EVENT } from '../../lib/api-client'
import { getErrorMessage } from '../../lib/error-utils'
import { loginAccess, readAccessBootstrap } from '../settings/api'
import type { ProvidersProps } from '../../app/providersTypes'

export function AccessGate({ children }: ProvidersProps) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')

  const bootstrapQuery = useQuery({
    queryKey: ['access-bootstrap'],
    queryFn: readAccessBootstrap,
    retry: (failureCount, error) => {
      if (error instanceof ApiClientError && error.code === 'remote_access_disabled') {
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
      <section className="screen screen--centered access-shell">
        <div className="access-card access-card--loading">
          <p className="access-card__eyebrow">
            {i18n._({ id: 'Access Control', message: 'Access Control' })}
          </p>
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
      </section>
    )
  }

  if (bootstrapQuery.error) {
    const isRemoteDisabled =
      bootstrapQuery.error instanceof ApiClientError &&
      bootstrapQuery.error.code === 'remote_access_disabled'

    return (
      <section className="screen screen--centered access-shell">
        <div className="access-card">
          <p className="access-card__eyebrow">
            {i18n._({ id: 'Access Control', message: 'Access Control' })}
          </p>
          <h1 className="access-card__title">
            {isRemoteDisabled
              ? i18n._({
                  id: 'Remote access is blocked',
                  message: 'Remote access is blocked',
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
              : getErrorMessage(bootstrapQuery.error)}
          </p>
          {!isRemoteDisabled ? (
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
      </section>
    )
  }

  const bootstrap = bootstrapQuery.data
  if (!bootstrap) {
    return null
  }

  if (!bootstrap.loginRequired || bootstrap.authenticated) {
    return <>{children}</>
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    loginMutation.mutate()
  }

  return (
    <section className="screen screen--centered access-shell">
      <form className="access-card" onSubmit={handleSubmit}>
        <p className="access-card__eyebrow">
          {i18n._({ id: 'Access Control', message: 'Access Control' })}
        </p>
        <h1 className="access-card__title">
          {i18n._({
            id: 'Sign in with access token',
            message: 'Sign in with access token',
          })}
        </h1>
        <p className="access-card__copy">
          {i18n._({
            id: 'This codex-server backend is protected. Enter a valid access token before opening the workspace UI.',
            message:
              'This codex-server backend is protected. Enter a valid access token before opening the workspace UI.',
          })}
        </p>

        <div className="access-card__meta">
          <span className="meta-pill">
            {i18n._({
              id: '{count} active token(s)',
              message: '{count} active token(s)',
              values: { count: bootstrap.activeTokenCount },
            })}
          </span>
          {!bootstrap.allowRemoteAccess ? (
            <span className="meta-pill meta-pill--warning">
              {i18n._({
                id: 'localhost only',
                message: 'localhost only',
              })}
            </span>
          ) : null}
        </div>

        <Input
          autoComplete="current-password"
          hint={i18n._({
            id: 'The token is sent to the backend once for validation. The browser then keeps an HttpOnly session cookie.',
            message:
              'The token is sent to the backend once for validation. The browser then keeps an HttpOnly session cookie.',
          })}
          label={i18n._({ id: 'Access Token', message: 'Access Token' })}
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

        <div className="access-card__actions">
          <Button
            isLoading={loginMutation.isPending}
            type="submit"
          >
            {i18n._({ id: 'Enter Workspace', message: 'Enter Workspace' })}
          </Button>
        </div>
      </form>
    </section>
  )
}
