import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  SettingRow,
  SettingsGroup,
  SettingsPageHeader,
} from '../../components/settings/SettingsPrimitives'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { StatusPill } from '../../components/ui/StatusPill'
import {
  cancelLoginAccount,
  getAccount,
  getRateLimits,
  loginAccount,
  logoutAccount,
} from '../../features/account/api'
import { getErrorMessage } from '../../lib/error-utils'

export function GeneralSettingsPage() {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState('')
  const [loginId, setLoginId] = useState('')

  const accountQuery = useQuery({ queryKey: ['account'], queryFn: getAccount })
  const rateLimitsQuery = useQuery({ queryKey: ['rate-limits'], queryFn: getRateLimits })

  const loginMutation = useMutation({
    mutationFn: loginAccount,
    onSuccess: async (result) => {
      setLoginId(result.loginId ?? '')
      setApiKey('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account'] }),
        queryClient.invalidateQueries({ queryKey: ['rate-limits'] }),
      ])
    },
  })

  const logoutMutation = useMutation({
    mutationFn: logoutAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account'] }),
        queryClient.invalidateQueries({ queryKey: ['rate-limits'] }),
      ])
    },
  })

  const cancelLoginMutation = useMutation({
    mutationFn: () => cancelLoginAccount({ loginId }),
  })

  const accountLabel = accountQuery.data?.email ?? 'No account connected'
  const lastSyncedLabel = accountQuery.data?.lastSyncedAt
    ? formatDateTime(accountQuery.data.lastSyncedAt)
    : 'Not synced yet'
  const pendingLoginId = loginId || loginMutation.data?.loginId || ''
  const rateLimitCount = rateLimitsQuery.data?.length ?? 0
  const accountStatus = useMemo(() => {
    if (accountQuery.isLoading) return 'Loading'
    return accountQuery.data?.status ?? 'Signed out'
  }, [accountQuery.data?.status, accountQuery.isLoading])

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Manage account identity, sign-in methods, and current usage limits from one stable general settings page."
        meta={
          <>
            {accountQuery.data ? <StatusPill status={accountQuery.data.status} /> : null}
            <span className="meta-pill">{rateLimitCount} limits</span>
            <button
              className="ide-button ide-button--secondary"
              onClick={() =>
                void Promise.all([
                  queryClient.invalidateQueries({ queryKey: ['account'] }),
                  queryClient.invalidateQueries({ queryKey: ['rate-limits'] }),
                ])
              }
              type="button"
            >
              Refresh
            </button>
          </>
        }
        title="General"
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description="Current account posture and session state."
          meta={accountStatus}
          title="Account"
        >
          <SettingRow
            description="Inspect the currently connected identity and the most recent account sync."
            title="Connected Account"
          >
            <div className="detail-list">
              <div className="detail-row">
                <span>Identity</span>
                <strong>{accountLabel}</strong>
              </div>
              <div className="detail-row">
                <span>Last Synced</span>
                <strong>{lastSyncedLabel}</strong>
              </div>
              <div className="detail-row">
                <span>Login Flow</span>
                <strong>{pendingLoginId ? 'Pending approval' : 'Idle'}</strong>
              </div>
            </div>
            <div className="setting-row__actions">
              {accountQuery.data ? (
                <button
                  className="ide-button ide-button--secondary"
                  onClick={() => logoutMutation.mutate()}
                  type="button"
                >
                  {logoutMutation.isPending ? 'Signing out…' : 'Logout'}
                </button>
              ) : null}
            </div>
            {accountQuery.error ? (
              <InlineNotice
                details={getErrorMessage(accountQuery.error)}
                dismissible
                noticeKey={`account-read-${accountQuery.error instanceof Error ? accountQuery.error.message : 'unknown'}`}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: ['account'] })}
                title="Failed To Read Account"
                tone="error"
              >
                {getErrorMessage(accountQuery.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description="Choose a sign-in method that matches how this client should authenticate."
          title="Login"
        >
          <SettingRow
            description="Store a direct API key for runtime requests."
            title="API Key Login"
          >
            <form
              className="form-stack"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                if (apiKey.trim()) {
                  loginMutation.mutate({ type: 'apiKey', apiKey })
                }
              }}
            >
              <label className="field">
                <span>API Key</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-..."
                  type="password"
                  value={apiKey}
                />
              </label>
              <div className="setting-row__actions">
                <button className="ide-button" disabled={!apiKey.trim()} type="submit">
                  {loginMutation.isPending ? 'Signing in…' : 'Login with API Key'}
                </button>
              </div>
            </form>
            {loginMutation.error ? (
              <InlineNotice
                details={getErrorMessage(loginMutation.error)}
                dismissible
                noticeKey={`login-${loginMutation.error instanceof Error ? loginMutation.error.message : 'unknown'}`}
                title="Login Failed"
                tone="error"
              >
                {getErrorMessage(loginMutation.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>

          <SettingRow
            description="Open the browser-based ChatGPT flow and optionally cancel a pending login session."
            title="Browser Login"
          >
            <div className="setting-row__actions">
              <button
                className="ide-button ide-button--secondary"
                onClick={() => loginMutation.mutate({ type: 'chatgpt' })}
                type="button"
              >
                Continue with ChatGPT
              </button>
              {pendingLoginId ? (
                <button
                  className="ide-button ide-button--secondary"
                  onClick={() => cancelLoginMutation.mutate()}
                  type="button"
                >
                  {cancelLoginMutation.isPending ? 'Canceling…' : 'Cancel Pending Login'}
                </button>
              ) : null}
            </div>
            {loginMutation.data?.authUrl ? (
              <a
                className="settings-inline-link"
                href={loginMutation.data.authUrl}
                rel="noreferrer"
                target="_blank"
              >
                {loginMutation.data.authUrl}
              </a>
            ) : (
              <div className="notice">Start the browser flow to receive the authorization URL.</div>
            )}
            {loginMutation.data?.message ? <div className="notice">{loginMutation.data.message}</div> : null}
            {cancelLoginMutation.error ? (
              <InlineNotice
                details={getErrorMessage(cancelLoginMutation.error)}
                dismissible
                noticeKey={`cancel-login-${cancelLoginMutation.error instanceof Error ? cancelLoginMutation.error.message : 'unknown'}`}
                title="Cancel Login Failed"
                tone="error"
              >
                {getErrorMessage(cancelLoginMutation.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description="Current quota posture for the active account."
          meta={rateLimitCount}
          title="Usage"
        >
          <SettingRow
            description="Track how much quota remains before the next reset window."
            title="Rate Limits"
          >
            {rateLimitsQuery.isLoading ? <div className="notice">Loading rate limits…</div> : null}
            {rateLimitsQuery.error ? (
              <InlineNotice
                details={getErrorMessage(rateLimitsQuery.error)}
                dismissible
                noticeKey={`rate-limits-${rateLimitsQuery.error instanceof Error ? rateLimitsQuery.error.message : 'unknown'}`}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: ['rate-limits'] })}
                title="Failed To Read Rate Limits"
                tone="error"
              >
                {getErrorMessage(rateLimitsQuery.error)}
              </InlineNotice>
            ) : null}
            {!rateLimitsQuery.isLoading && !rateLimitCount ? (
              <div className="empty-state">No rate limit data available.</div>
            ) : null}
            <div className="resource-list resource-list--runtime">
              {rateLimitsQuery.data?.map((limit) => (
                <article className="resource-row" key={limit.name}>
                  <div className="resource-row__icon">RL</div>
                  <div className="resource-row__body">
                    <strong>{limit.name}</strong>
                    <p>
                      {limit.remaining} / {limit.limit} remaining · resets {formatTime(limit.resetsAt)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}
