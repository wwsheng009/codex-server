import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  SettingRow,
  SettingsGroup,
  SettingsPageHeader,
} from '../../components/settings/SettingsPrimitives'
import { SettingsWorkspaceScopePanel } from '../../components/settings/SettingsWorkspaceScopePanel'
import { SelectControl } from '../../components/ui/SelectControl'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { StatusPill } from '../../components/ui/StatusPill'
import {
  accountQueryKey,
  cancelLoginAccount,
  getAccount,
  getRateLimits,
  loginAccount,
  rateLimitsQueryKey,
  logoutAccount,
  type CancelLoginAccountInput,
  type LoginAccountInput,
} from '../../features/account/api'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { formatLocaleDateTime, formatLocaleNumber, formatLocaleTime } from '../../i18n/format'
import { localeLabels, type AppLocale } from '../../i18n/config'
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'
import { Input } from '../../components/ui/Input'

export function GeneralSettingsPage() {
  const queryClient = useQueryClient()
  const { workspaceId, workspaceName } = useSettingsShellContext()
  const locale = useSettingsLocalStore((state) => state.locale)
  const setLocale = useSettingsLocalStore((state) => state.setLocale)
  const [apiKey, setApiKey] = useState('')
  const [loginId, setLoginId] = useState('')
  const resolvedWorkspaceId = workspaceId ?? ''
  const accountKey = accountQueryKey(resolvedWorkspaceId)
  const rateLimitsKey = rateLimitsQueryKey(resolvedWorkspaceId)

  const accountQuery = useQuery({
    queryKey: accountKey,
    queryFn: () => getAccount(resolvedWorkspaceId),
    enabled: Boolean(resolvedWorkspaceId),
  })
  const rateLimitsQuery = useQuery({
    queryKey: rateLimitsKey,
    queryFn: () => getRateLimits(resolvedWorkspaceId),
    enabled: Boolean(resolvedWorkspaceId),
  })

  const loginMutation = useMutation({
    mutationFn: (input: LoginAccountInput) =>
      loginAccount(resolvedWorkspaceId, input),
    onSuccess: async (result) => {
      setLoginId(result.loginId ?? '')
      setApiKey('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountKey }),
        queryClient.invalidateQueries({ queryKey: rateLimitsKey }),
      ])
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => logoutAccount(resolvedWorkspaceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountKey }),
        queryClient.invalidateQueries({ queryKey: rateLimitsKey }),
      ])
    },
  })

  const cancelLoginMutation = useMutation({
    mutationFn: () => cancelLoginAccount(resolvedWorkspaceId, { loginId } satisfies CancelLoginAccountInput),
  })

  useEffect(() => {
    setApiKey('')
    setLoginId('')
    loginMutation.reset()
    logoutMutation.reset()
    cancelLoginMutation.reset()
  }, [resolvedWorkspaceId])

  const accountStatus = accountQuery.isLoading ? 'loading' : accountQuery.data?.status ?? 'disconnected'
  const isAccountConnected =
    Boolean(accountQuery.data?.email) &&
    accountQuery.data?.status !== 'disconnected' &&
    accountQuery.data?.email !== 'not-connected'
  const accountLabel = isAccountConnected
    ? accountQuery.data?.email ?? ''
    : i18n._({
        id: 'No account connected',
        message: 'No account connected',
      })
  const lastSyncedLabel =
    isAccountConnected && accountQuery.data?.lastSyncedAt
      ? formatLocaleDateTime(accountQuery.data.lastSyncedAt)
      : i18n._({
          id: 'Not synced yet',
          message: 'Not synced yet',
        })
  const pendingLoginId = loginId || loginMutation.data?.loginId || ''
  const rateLimitCount = rateLimitsQuery.data?.length ?? 0
  const localeOptions = useMemo(
    () =>
      (Object.entries(localeLabels) as Array<[AppLocale, (typeof localeLabels)[AppLocale]]>).map(([value, labels]) => ({
        value,
        label: `${labels.nativeLabel} · ${labels.label}`,
        triggerLabel: labels.shortLabel,
      })),
    [],
  )
  const languageGroupDescription = i18n._({
    id: 'Set the primary locale for translated UI surfaces and locale-aware formatting.',
    message: 'Set the primary locale for translated UI surfaces and locale-aware formatting.',
  })
  const languageTitle = i18n._({
    id: 'Language',
    message: 'Language',
  })
  const interfaceLanguageDescription = i18n._({
    id: 'This selection controls translated shell copy and localized dates, times, and numbers.',
    message:
      'This selection controls translated shell copy and localized dates, times, and numbers.',
  })
  const interfaceLanguageTitle = i18n._({
    id: 'Interface language',
    message: 'Interface language',
  })
  const availableLanguagesLabel = i18n._({
    id: 'Available languages',
    message: 'Available languages',
  })

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description={i18n._({
          id: 'Manage account identity, sign-in methods, and current usage limits from one stable general settings page.',
          message:
            'Manage account identity, sign-in methods, and current usage limits from one stable general settings page.',
        })}
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <StatusPill status={accountStatus} />
            <span className="meta-pill">
              {i18n._({
                id: '{count} limits',
                message: '{count} limits',
                values: { count: formatLocaleNumber(rateLimitCount) },
              })}
            </span>
            <button
              className="ide-button ide-button--secondary"
              onClick={() =>
                void Promise.all([
                  queryClient.invalidateQueries({ queryKey: accountKey }),
                  queryClient.invalidateQueries({ queryKey: rateLimitsKey }),
                ])
              }
              disabled={!resolvedWorkspaceId}
              type="button"
            >
              {i18n._({ id: 'Refresh', message: 'Refresh' })}
            </button>
          </>
        }
        title={i18n._({ id: 'General', message: 'General' })}
      />

      <div className="settings-page__stack">
        <SettingsWorkspaceScopePanel
          description={i18n._({
            id: 'All account identity, authentication, and quota actions on this page apply only to the selected workspace runtime.',
            message:
              'All account identity, authentication, and quota actions on this page apply only to the selected workspace runtime.',
          })}
        />

        <SettingsGroup
          description={languageGroupDescription}
          meta={localeLabels[locale].nativeLabel}
          title={languageTitle}
        >
          <SettingRow
            description={interfaceLanguageDescription}
            title={interfaceLanguageTitle}
          >
            <div className="setting-row__actions">
              <SelectControl
                ariaLabel={interfaceLanguageTitle}
                fullWidth
                menuLabel={availableLanguagesLabel}
                onChange={(value) => setLocale(value as AppLocale)}
                options={localeOptions}
                value={locale}
              />
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Current account posture and session state.',
            message: 'Current account posture and session state.',
          })}
          meta={<StatusPill status={accountStatus} />}
          title={i18n._({ id: 'Account', message: 'Account' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Inspect the currently connected identity and the most recent account sync.',
              message: 'Inspect the currently connected identity and the most recent account sync.',
            })}
            title={i18n._({ id: 'Connected Account', message: 'Connected Account' })}
          >
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Identity', message: 'Identity' })}</span>
                <strong>{accountLabel}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Last Synced', message: 'Last Synced' })}</span>
                <strong>{lastSyncedLabel}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Login Flow', message: 'Login Flow' })}</span>
                <strong>
                  {pendingLoginId
                    ? i18n._({ id: 'Pending approval', message: 'Pending approval' })
                    : i18n._({ id: 'Idle', message: 'Idle' })}
                </strong>
              </div>
            </div>
            <div className="setting-row__actions">
              {isAccountConnected ? (
                <button
                  className="ide-button ide-button--secondary"
                  onClick={() => logoutMutation.mutate()}
                  disabled={!resolvedWorkspaceId}
                  type="button"
                >
                  {logoutMutation.isPending
                    ? i18n._({ id: 'Signing out…', message: 'Signing out…' })
                    : i18n._({ id: 'Logout', message: 'Logout' })}
                </button>
              ) : null}
            </div>
            {accountQuery.error ? (
              <InlineNotice
                details={getErrorMessage(accountQuery.error)}
                dismissible
                noticeKey={`account-read-${accountQuery.error instanceof Error ? accountQuery.error.message : 'unknown'}`}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: accountKey })}
                title={i18n._({ id: 'Failed To Read Account', message: 'Failed To Read Account' })}
                tone="error"
              >
                {getErrorMessage(accountQuery.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Choose a sign-in method that matches how this client should authenticate.',
            message: 'Choose a sign-in method that matches how this client should authenticate.',
          })}
          title={i18n._({ id: 'Login', message: 'Login' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Store a direct API key for runtime requests.',
              message: 'Store a direct API key for runtime requests.',
            })}
            title={i18n._({ id: 'API Key Login', message: 'API Key Login' })}
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
              <Input
                label={i18n._({ id: 'API Key', message: 'API Key' })}
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
                type="password"
                value={apiKey}
              />
              <div className="setting-row__actions">
                <button className="ide-button" disabled={!resolvedWorkspaceId || !apiKey.trim()} type="submit">
                  {loginMutation.isPending
                    ? i18n._({ id: 'Signing in…', message: 'Signing in…' })
                    : i18n._({ id: 'Login with API Key', message: 'Login with API Key' })}
                </button>
              </div>
            </form>
            {loginMutation.error ? (
              <InlineNotice
                details={getErrorMessage(loginMutation.error)}
                dismissible
                noticeKey={`login-${loginMutation.error instanceof Error ? loginMutation.error.message : 'unknown'}`}
                title={i18n._({ id: 'Login Failed', message: 'Login Failed' })}
                tone="error"
              >
                {getErrorMessage(loginMutation.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Open the browser-based ChatGPT flow and optionally cancel a pending login session.',
              message: 'Open the browser-based ChatGPT flow and optionally cancel a pending login session.',
            })}
            title={i18n._({ id: 'Browser Login', message: 'Browser Login' })}
          >
            <div className="setting-row__actions">
              <button
                className="ide-button ide-button--secondary"
                onClick={() => loginMutation.mutate({ type: 'chatgpt' })}
                disabled={!resolvedWorkspaceId}
                type="button"
              >
                {i18n._({
                  id: 'Continue with ChatGPT',
                  message: 'Continue with ChatGPT',
                })}
              </button>
              {pendingLoginId ? (
                <button
                  className="ide-button ide-button--secondary"
                  onClick={() => cancelLoginMutation.mutate()}
                  disabled={!resolvedWorkspaceId}
                  type="button"
                >
                  {cancelLoginMutation.isPending
                    ? i18n._({ id: 'Canceling…', message: 'Canceling…' })
                    : i18n._({
                        id: 'Cancel Pending Login',
                        message: 'Cancel Pending Login',
                      })}
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
              <div className="notice">
                {i18n._({
                  id: 'Start the browser flow to receive the authorization URL.',
                  message: 'Start the browser flow to receive the authorization URL.',
                })}
              </div>
            )}
            {loginMutation.data?.message ? <div className="notice">{loginMutation.data.message}</div> : null}
            {cancelLoginMutation.error ? (
              <InlineNotice
                details={getErrorMessage(cancelLoginMutation.error)}
                dismissible
                noticeKey={`cancel-login-${cancelLoginMutation.error instanceof Error ? cancelLoginMutation.error.message : 'unknown'}`}
                title={i18n._({ id: 'Cancel Login Failed', message: 'Cancel Login Failed' })}
                tone="error"
              >
                {getErrorMessage(cancelLoginMutation.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Current quota posture for the active account.',
            message: 'Current quota posture for the active account.',
          })}
          meta={formatLocaleNumber(rateLimitCount)}
          title={i18n._({ id: 'Usage', message: 'Usage' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Track how much quota remains before the next reset window.',
              message: 'Track how much quota remains before the next reset window.',
            })}
            title={i18n._({ id: 'Rate Limits', message: 'Rate Limits' })}
          >
            {rateLimitsQuery.isLoading ? (
              <div className="notice">
                {i18n._({ id: 'Loading rate limits…', message: 'Loading rate limits…' })}
              </div>
            ) : null}
            {rateLimitsQuery.error ? (
              <InlineNotice
                details={getErrorMessage(rateLimitsQuery.error)}
                dismissible
                noticeKey={`rate-limits-${rateLimitsQuery.error instanceof Error ? rateLimitsQuery.error.message : 'unknown'}`}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: rateLimitsKey })}
                title={i18n._({ id: 'Failed To Read Rate Limits', message: 'Failed To Read Rate Limits' })}
                tone="error"
              >
                {getErrorMessage(rateLimitsQuery.error)}
              </InlineNotice>
            ) : null}
            {!rateLimitsQuery.isLoading && !rateLimitCount ? (
              <div className="empty-state">
                {i18n._({
                  id: 'No rate limit data available.',
                  message: 'No rate limit data available.',
                })}
              </div>
            ) : null}
            <div className="resource-list resource-list--runtime">
              {rateLimitsQuery.data?.map((limit) => (
                <article className="resource-row" key={limit.name}>
                  <div className="resource-row__icon">RL</div>
                  <div className="resource-row__body">
                    <strong>{limit.name}</strong>
                    <p>
                      {i18n._({
                        id: '{remaining} / {limit} remaining · resets {time}',
                        message: '{remaining} / {limit} remaining · resets {time}',
                        values: {
                          remaining: formatLocaleNumber(limit.remaining),
                          limit: formatLocaleNumber(limit.limit),
                          time: formatLocaleTime(limit.resetsAt),
                        },
                      })}
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
