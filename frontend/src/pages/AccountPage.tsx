import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { AccountLoginResult } from '../types/api'

import { StatusBadge } from '../components/ui/StatusBadge'
import { getAccount, getRateLimits, loginAccount, logoutAccount } from '../features/account/api'

export function AccountPage() {
  const queryClient = useQueryClient()
  const [apiKey, setAPIKey] = useState('')
  const [loginResult, setLoginResult] = useState<AccountLoginResult | null>(null)
  const [pollAccount, setPollAccount] = useState(false)

  const accountQuery = useQuery({
    queryKey: ['account'],
    queryFn: getAccount,
    refetchInterval: pollAccount ? 4_000 : false,
  })

  const rateLimitsQuery = useQuery({
    queryKey: ['rate-limits'],
    queryFn: getRateLimits,
  })

  const loginMutation = useMutation({
    mutationFn: loginAccount,
    onSuccess: async (result) => {
      setLoginResult(result)
      if (result.authUrl) {
        window.open(result.authUrl, '_blank', 'noopener,noreferrer')
        setPollAccount(true)
      }
      setAPIKey('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account'] }),
        queryClient.invalidateQueries({ queryKey: ['rate-limits'] }),
      ])
    },
  })

  const logoutMutation = useMutation({
    mutationFn: logoutAccount,
    onSuccess: async () => {
      setLoginResult(null)
      setPollAccount(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account'] }),
        queryClient.invalidateQueries({ queryKey: ['rate-limits'] }),
      ])
    },
  })

  const connected = accountQuery.data?.status === 'connected'

  useEffect(() => {
    if (connected) {
      setPollAccount(false)
    }
  }, [connected])

  useEffect(() => {
    if (!pollAccount) {
      return
    }

    const timer = window.setTimeout(() => setPollAccount(false), 60_000)
    return () => window.clearTimeout(timer)
  }, [pollAccount])

  const accountLabel = useMemo(() => {
    if (!accountQuery.data) {
      return 'Loading...'
    }

    if (accountQuery.data.email === 'apiKey') {
      return 'API Key'
    }

    return accountQuery.data.email
  }, [accountQuery.data])

  function handleAPIKeyLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    loginMutation.mutate({ type: 'apiKey', apiKey })
  }

  function handleRefresh() {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['account'] }),
      queryClient.invalidateQueries({ queryKey: ['rate-limits'] }),
    ])
  }

  return (
    <section className="page">
      <header className="page__header">
        <div>
          <p className="eyebrow">Identity & Limits</p>
          <h1>Account</h1>
          <p className="page__description">查看账号状态、登录会话和速率限制占用。</p>
        </div>
        <div className="page__actions">
          <button className="button button--secondary" onClick={handleRefresh} type="button">
            Refresh
          </button>
          {connected ? (
            <button className="button button--secondary" onClick={() => logoutMutation.mutate()} type="button">
              {logoutMutation.isPending ? 'Signing out...' : 'Logout'}
            </button>
          ) : null}
        </div>
      </header>

      <div className="workspace-grid">
        <div className="card">
          <div className="card__header">
            <h2>Current Account</h2>
            {accountQuery.data ? <StatusBadge status={accountQuery.data.status} /> : null}
          </div>

          {accountQuery.data ? (
            <div className="stack">
              <div>
                <span className="meta-label">Identity</span>
                <p>{accountLabel}</p>
              </div>
              <div>
                <span className="meta-label">Last Synced</span>
                <p>{new Date(accountQuery.data.lastSyncedAt).toLocaleString()}</p>
              </div>
              {loginResult?.message ? <p className="muted-text">{loginResult.message}</p> : null}
              {loginResult?.authUrl ? (
                <a className="inline-link" href={loginResult.authUrl} rel="noreferrer" target="_blank">
                  Open ChatGPT login page
                </a>
              ) : null}
            </div>
          ) : (
            <p>Loading account...</p>
          )}
        </div>

        <div className="card">
          <div className="card__header">
            <h2>Login</h2>
            <span>{connected ? 'Connected' : 'Required'}</span>
          </div>

          <div className="stack">
            <form className="stack" onSubmit={handleAPIKeyLogin}>
              <label className="field">
                <span>API Key</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setAPIKey(event.target.value)}
                  placeholder="sk-..."
                  type="password"
                  value={apiKey}
                />
              </label>
              <button className="button" disabled={loginMutation.isPending || !apiKey.trim()} type="submit">
                {loginMutation.isPending ? 'Signing in...' : 'Login with API Key'}
              </button>
            </form>

            <div className="divider" />

            <button
              className="button button--secondary"
              disabled={loginMutation.isPending}
              onClick={() => loginMutation.mutate({ type: 'chatgpt' })}
              type="button"
            >
              Continue with ChatGPT
            </button>

            {loginMutation.error ? <p className="error-text">{loginMutation.error.message}</p> : null}
            {pollAccount ? <p className="muted-text">Waiting for ChatGPT login to complete...</p> : null}
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <h2>Rate Limits</h2>
            <span>{rateLimitsQuery.data?.length ?? 0}</span>
          </div>
          <div className="stack">
            {rateLimitsQuery.data?.length ? (
              rateLimitsQuery.data.map((limit) => (
                <article className="limit-item" key={limit.name}>
                  <strong>{limit.name}</strong>
                  <p>
                    {limit.remaining} / {limit.limit} remaining
                  </p>
                  <small>Resets {new Date(limit.resetsAt).toLocaleTimeString()}</small>
                </article>
              ))
            ) : (
              <div className="empty-state">No rate limit data available for the current login state.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
