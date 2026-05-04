import { Button } from '../ui/Button'
import { InlineNotice } from '../ui/InlineNotice'
import { Input } from '../ui/Input'
import { StatusPill } from '../ui/StatusPill'
import { Switch } from '../ui/Switch'
import { Tooltip } from '../ui/Tooltip'
import { i18n } from '../../i18n/runtime'
import { formatBotBackendLabel, formatBotTimestamp, formatWeChatAccountLabel } from '../../pages/botsPageUtils'
import type { BotConnection, WeChatAccount } from '../../types/api'
import type { ReactNode } from 'react'

type WeChatAccountsSectionProps = {
  errorMessage: string
  filteredWeChatAccounts: WeChatAccount[]
  isLoading: boolean
  onChangeSearch: (value: string) => void
  onChangeShowUnusedOnly: (checked: boolean) => void
  onDeleteAccount: (account: WeChatAccount) => void
  onOpenConnection: (connection: BotConnection) => void
  onOpenConnectionLogs: (connection: BotConnection) => void
  onRetry: () => void
  weChatAccountConnectionCounts: Map<string, number>
  weChatAccountConnections: Map<string, BotConnection[]>
  totalWeChatAccounts: number
  searchValue: string
  showUnusedOnly: boolean
}

function HelpTooltip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="info-label__help">?</span>
    </Tooltip>
  )
}

export function WeChatAccountsSection({
  errorMessage,
  filteredWeChatAccounts,
  isLoading,
  onChangeSearch,
  onChangeShowUnusedOnly,
  onDeleteAccount,
  onOpenConnection,
  onOpenConnectionLogs,
  onRetry,
  weChatAccountConnectionCounts,
  weChatAccountConnections,
  totalWeChatAccounts,
  searchValue,
  showUnusedOnly,
}: WeChatAccountsSectionProps) {
  return (
    <div className="form-stack">
      <Input
        label={i18n._({ id: 'Search Saved Accounts', message: 'Search Saved Accounts' })}
        onChange={(event) => onChangeSearch(event.target.value)}
        placeholder={i18n._({ id: 'Support, acct_123, wechat.example.com', message: 'Support, acct_123, wechat.example.com' })}
        value={searchValue}
      />

      <Switch
        checked={showUnusedOnly}
        label={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {i18n._({ id: 'Only Show Unbound Accounts', message: 'Only Show Unbound Accounts' })}
            <HelpTooltip
              content={i18n._({
                id: 'Show only saved WeChat accounts that are not currently linked to any visible bot connection.',
                message: 'Show only saved WeChat accounts that are not currently linked to any visible bot connection.',
              })}
            />
          </div>
        }
        onChange={(event) => onChangeShowUnusedOnly(event.target.checked)}
      />

      {errorMessage ? (
        <InlineNotice
          dismissible
          noticeKey={`saved-wechat-accounts-${errorMessage}`}
          onRetry={onRetry}
          title={i18n._({
            id: 'Failed To Load Saved WeChat Accounts',
            message: 'Failed To Load Saved WeChat Accounts',
          })}
          tone="error"
        >
          {errorMessage}
        </InlineNotice>
      ) : null}

      {isLoading ? (
        <div className="notice">
          {i18n._({ id: 'Loading saved WeChat accounts...', message: 'Loading saved WeChat accounts...' })}
        </div>
      ) : null}

      {!isLoading && totalWeChatAccounts === 0 ? (
        <div className="empty-state">
          {i18n._({
            id: 'No saved WeChat accounts yet. Complete one confirmed QR login to save an account for reuse.',
            message: 'No saved WeChat accounts yet. Complete one confirmed QR login to save an account for reuse.',
          })}
        </div>
      ) : null}

      {!isLoading && totalWeChatAccounts > 0 && !filteredWeChatAccounts.length ? (
        <div className="empty-state">
          {i18n._({
            id: 'No saved WeChat accounts match the current filters.',
            message: 'No saved WeChat accounts match the current filters.',
          })}
        </div>
      ) : null}

      {filteredWeChatAccounts.length ? (
        <div className="directory-list">
          {filteredWeChatAccounts.map((account) => {
            const linkedConnections = weChatAccountConnections.get(account.id) ?? []
            const connectionCount = weChatAccountConnectionCounts.get(account.id) ?? 0
            return (
              <article className="directory-item" key={account.id}>
                <div className="directory-item__icon">{i18n._({ id: 'WX', message: 'WX' })}</div>
                <div className="directory-item__body">
                  <strong>{formatWeChatAccountLabel(account)}</strong>
                  {account.alias?.trim() ? (
                    <p>
                      {i18n._({ id: 'Alias', message: 'Alias' })}: {account.alias}
                    </p>
                  ) : null}
                  <p>
                    {i18n._({ id: 'Base URL', message: 'Base URL' })}: {account.baseUrl}
                  </p>
                  <p>
                    {i18n._({ id: 'Last Confirmed', message: 'Last Confirmed' })}:{' '}
                    {formatBotTimestamp(account.lastConfirmedAt)}
                  </p>
                  {account.note?.trim() ? <p>{account.note}</p> : null}
                  {linkedConnections.length ? (
                    <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
                      <strong>{i18n._({ id: 'Linked Connections', message: 'Linked Connections' })}</strong>
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {linkedConnections.map((connection) => (
                          <div
                            key={connection.id}
                            style={{
                              alignItems: 'center',
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '8px',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div style={{ display: 'grid', gap: '4px' }}>
                              <strong dir="auto">{connection.name}</strong>
                              <span>
                                {formatBotBackendLabel(connection.aiBackend)} | {formatBotTimestamp(connection.updatedAt)}
                              </span>
                            </div>
                            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              <StatusPill status={connection.status} />
                              <Button intent="secondary" onClick={() => onOpenConnection(connection)} size="sm" type="button">
                                {i18n._({ id: 'Open in Bots', message: 'Open in Bots' })}
                              </Button>
                              <Button intent="ghost" onClick={() => onOpenConnectionLogs(connection)} size="sm" type="button">
                                {i18n._({ id: 'Logs', message: 'Logs' })}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p>
                      {i18n._({
                        id: 'Not used by any bot connection yet.',
                        message: 'Not used by any bot connection yet.',
                      })}
                    </p>
                  )}
                </div>
                <div
                  className="directory-item__meta"
                  style={{ alignItems: 'end', display: 'grid', gap: '8px', justifyItems: 'end' }}
                >
                  <span className="meta-pill">
                    {i18n._({ id: 'Connections', message: 'Connections' })}: {connectionCount}
                  </span>
                  <span className="meta-pill">{formatBotTimestamp(account.updatedAt)}</span>
                  <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    <Button intent="ghost" onClick={() => onDeleteAccount(account)} type="button">
                      {i18n._({ id: 'Delete', message: 'Delete' })}
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
