import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import {
  SettingRow,
  SettingsGroup,
  SettingsJsonPreview,
  SettingsPageHeader,
} from '../../components/settings/SettingsPrimitives'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { SettingsWorkspaceScopePanel } from '../../components/settings/SettingsWorkspaceScopePanel'
import { mcpOauthLogin } from '../../features/settings/api'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'

export function McpSettingsPage() {
  const { workspaceId, workspaceName } = useSettingsShellContext()
  const [serverName, setServerName] = useState('')
  const [scopes, setScopes] = useState('')
  const [timeoutSecs, setTimeoutSecs] = useState('60')

  const mcpOauthMutation = useMutation({
    mutationFn: () =>
      mcpOauthLogin(workspaceId!, {
        name: serverName,
        scopes: parseCsv(scopes),
        timeoutSecs: parseOptionalInt(timeoutSecs),
      }),
  })

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description={i18n._({
          id: 'Start workspace-scoped MCP authorization flows and keep server onboarding isolated from the rest of the settings surface.',
          message:
            'Start workspace-scoped MCP authorization flows and keep server onboarding isolated from the rest of the settings surface.',
        })}
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">{i18n._({ id: 'OAuth', message: 'OAuth' })}</span>
          </>
        }
        title={i18n._({ id: 'MCP Servers', message: 'MCP Servers' })}
      />

      <div className="settings-page__stack">
        <SettingsWorkspaceScopePanel />

        <SettingsGroup
          description={i18n._({
            id: 'Authorize an MCP server against the selected workspace context.',
            message: 'Authorize an MCP server against the selected workspace context.',
          })}
          title={i18n._({ id: 'Server Authorization', message: 'Server Authorization' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Provide the server name, requested scopes, and timeout window for the OAuth handshake.',
              message:
                'Provide the server name, requested scopes, and timeout window for the OAuth handshake.',
            })}
            title={i18n._({ id: 'Start OAuth Login', message: 'Start OAuth Login' })}
          >
            <form
              className="form-stack"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                if (workspaceId && serverName.trim()) {
                  mcpOauthMutation.mutate()
                }
              }}
            >
              <label className="field">
                <span>{i18n._({ id: 'Server Name', message: 'Server Name' })}</span>
                <input onChange={(event) => setServerName(event.target.value)} value={serverName} />
              </label>
              <label className="field">
                <span>{i18n._({ id: 'Scopes', message: 'Scopes' })}</span>
                <input onChange={(event) => setScopes(event.target.value)} value={scopes} />
              </label>
              <label className="field">
                <span>{i18n._({ id: 'Timeout Seconds', message: 'Timeout Seconds' })}</span>
                <input onChange={(event) => setTimeoutSecs(event.target.value)} value={timeoutSecs} />
              </label>
              <div className="setting-row__actions">
                <button className="ide-button" disabled={!workspaceId || !serverName.trim()} type="submit">
                  {mcpOauthMutation.isPending
                    ? i18n._({ id: 'Starting…', message: 'Starting…' })
                    : i18n._({ id: 'Start MCP OAuth', message: 'Start MCP OAuth' })}
                </button>
              </div>
            </form>
            {mcpOauthMutation.data ? (
              <SettingsJsonPreview
                description={i18n._({
                  id: 'Authorization details returned for the MCP server login.',
                  message: 'Authorization details returned for the MCP server login.',
                })}
                title={i18n._({ id: 'OAuth Result', message: 'OAuth Result' })}
                value={mcpOauthMutation.data}
              />
            ) : null}
            {mcpOauthMutation.error ? (
              <InlineNotice
                dismissible
                noticeKey={`mcp-oauth-${mcpOauthMutation.error instanceof Error ? mcpOauthMutation.error.message : 'unknown'}`}
                title={i18n._({ id: 'MCP OAuth Failed', message: 'MCP OAuth Failed' })}
                tone="error"
              >
                {getErrorMessage(mcpOauthMutation.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}

function parseCsv(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseOptionalInt(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}
