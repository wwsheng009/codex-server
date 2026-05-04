import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { SettingsGroup, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import { SettingsWorkspaceScopePanel } from '../../components/settings/SettingsWorkspaceScopePanel'
import { WeChatAccountsSection } from '../../components/settings/WeChatAccountsSection'
import { deleteWeChatAccount, listBotConnections, listWeChatAccounts } from '../../features/bots/api'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { getErrorMessage } from '../../lib/error-utils'
import { i18n } from '../../i18n/runtime'
import { countWeChatConnectionsForAccount, listWeChatConnectionsForAccount, matchesWeChatAccountSearch } from '../botsPageUtils'

export function WeChatAccountsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { workspaceId } = useSettingsShellContext()
  const workspaceKey = workspaceId?.trim() ?? ''
  const [searchValue, setSearchValue] = useState('')
  const [showUnusedOnly, setShowUnusedOnly] = useState(false)

  const weChatAccountsQuery = useQuery({
    queryKey: ['wechat-accounts', workspaceKey],
    queryFn: () => listWeChatAccounts(workspaceKey),
    enabled: workspaceKey.length > 0,
    refetchInterval: 10000,
  })

  const botConnectionsQuery = useQuery({
    queryKey: ['bot-connections', workspaceKey],
    queryFn: () => listBotConnections(workspaceKey),
    enabled: workspaceKey.length > 0,
    refetchInterval: 10000,
  })

  const savedWeChatAccounts = weChatAccountsQuery.data ?? []
  const botConnections = botConnectionsQuery.data ?? []

  const weChatAccountConnections = useMemo(
    () =>
      new Map(
        savedWeChatAccounts.map((account) => [account.id, listWeChatConnectionsForAccount(botConnections, account)]),
      ),
    [botConnections, savedWeChatAccounts],
  )

  const weChatAccountConnectionCounts = useMemo(
    () =>
      new Map(
        savedWeChatAccounts.map((account) => [
          account.id,
          weChatAccountConnections.get(account.id)?.length ?? countWeChatConnectionsForAccount(botConnections, account),
        ]),
      ),
    [botConnections, savedWeChatAccounts, weChatAccountConnections],
  )

  const filteredWeChatAccounts = useMemo(
    () =>
      savedWeChatAccounts.filter((account) => {
        if (!matchesWeChatAccountSearch(account, searchValue)) {
          return false
        }
        if (!showUnusedOnly) {
          return true
        }
        return (weChatAccountConnections.get(account.id) ?? []).length === 0
      }),
    [savedWeChatAccounts, searchValue, showUnusedOnly, weChatAccountConnections],
  )

  const deleteMutation = useMutation({
    mutationFn: ({ accountId, workspaceId }: { accountId: string; workspaceId: string }) =>
      deleteWeChatAccount(workspaceId, accountId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wechat-accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
      ])
    },
  })

  const errorMessage =
    getErrorMessage(weChatAccountsQuery.error) || getErrorMessage(botConnectionsQuery.error) || ''

  function openConnection(connectionId: string, botId?: string, targetWorkspaceId?: string) {
    const nextSearch = new URLSearchParams()
    if (targetWorkspaceId?.trim()) {
      nextSearch.set('workspaceId', targetWorkspaceId.trim())
    }
    if (botId?.trim()) {
      nextSearch.set('botId', botId.trim())
    }
    if (connectionId.trim()) {
      nextSearch.set('connectionId', connectionId.trim())
    }
    navigate({
      pathname: '/bots',
      search: nextSearch.toString() ? `?${nextSearch.toString()}` : '',
    })
  }

  function openConnectionLogs(connection: { id: string }) {
    const logsPath = ['/bots', workspaceKey, connection.id, 'logs'].join('/')
    navigate({
      pathname: logsPath,
    })
  }

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description={i18n._({
          id: 'Review saved WeChat QR logins for the selected workspace and inspect which bot connections reuse them. Bot creation flows still consume the saved accounts here.',
          message:
            'Review saved WeChat QR logins for the selected workspace and inspect which bot connections reuse them. Bot creation flows still consume the saved accounts here.',
        })}
        meta={
          <span className="meta-pill">
            {i18n._({
              id: '{count} saved',
              message: '{count} saved',
              values: { count: savedWeChatAccounts.length },
            })}
          </span>
        }
        title={i18n._({ id: 'WeChat Accounts', message: 'WeChat Accounts' })}
      />

      <div className="settings-page__stack">
        <SettingsWorkspaceScopePanel
          description={i18n._({
            id: 'Saved WeChat accounts are workspace-owned. Narrow the registry when auditing a single workspace.',
            message: 'Saved WeChat accounts are workspace-owned. Narrow the registry when auditing a single workspace.',
          })}
          extraSummaryItems={[
            {
              label: i18n._({ id: 'Saved Accounts', message: 'Saved Accounts' }),
              value: savedWeChatAccounts.length,
            },
          ]}
          title={i18n._({ id: 'Workspace Scope', message: 'Workspace Scope' })}
        />

        <SettingsGroup
          description={i18n._({
            id: 'Browse reusable WeChat login records and the bot connections that still reference them.',
            message: 'Browse reusable WeChat login records and the bot connections that still reference them.',
          })}
          title={i18n._({ id: 'Saved WeChat Accounts', message: 'Saved WeChat Accounts' })}
          meta={
            <span className="meta-pill">
              {i18n._({
                id: '{count} visible',
                message: '{count} visible',
                values: { count: filteredWeChatAccounts.length },
              })}
            </span>
          }
        >
          <WeChatAccountsSection
            errorMessage={errorMessage}
            filteredWeChatAccounts={filteredWeChatAccounts}
            isLoading={weChatAccountsQuery.isLoading || botConnectionsQuery.isLoading}
            onChangeSearch={setSearchValue}
            onChangeShowUnusedOnly={setShowUnusedOnly}
            onDeleteAccount={(account) =>
              deleteMutation.mutate({ accountId: account.id, workspaceId: account.workspaceId })
            }
            onOpenConnection={(connection) => openConnection(connection.id, connection.botId, workspaceKey)}
            onOpenConnectionLogs={(connection) => openConnectionLogs(connection)}
            onRetry={() => void weChatAccountsQuery.refetch()}
            searchValue={searchValue}
            showUnusedOnly={showUnusedOnly}
            totalWeChatAccounts={savedWeChatAccounts.length}
            weChatAccountConnectionCounts={weChatAccountConnectionCounts}
            weChatAccountConnections={weChatAccountConnections}
          />
        </SettingsGroup>
      </div>
    </section>
  )
}
