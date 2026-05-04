import { type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { SelectControl } from '../components/ui/SelectControl'
import { StatusPill } from '../components/ui/StatusPill'
import { Switch } from '../components/ui/Switch'
import { TextArea } from '../components/ui/TextArea'
import { Tooltip } from '../components/ui/Tooltip'
import { formatLocalizedStatusLabel } from '../i18n/display'
import { i18n } from '../i18n/runtime'
import {
  FEISHU_STREAMING_PLAIN_TEXT_STRATEGY_APPEND_DELTA,
  FEISHU_STREAMING_PLAIN_TEXT_STRATEGY_SMART_PRESERVE,
  FEISHU_STREAMING_PLAIN_TEXT_STRATEGY_UPDATE_ONLY,
  formatBotTimestamp,
  formatWeChatAccountLabel,
  resolveBotCommandOutputMode,
  resolveBotProvider,
  resolveFeishuDeliveryMode,
  resolveFeishuStreamingPlainTextStrategy,
  type BotsPageDraft,
} from './botsPageUtils'
import type { Bot, WeChatAccount, Workspace } from '../types/api'

type SelectOption = {
  value: string
  label: string
  disabled?: boolean
  triggerLabel?: string
}

type BotsPageConnectionModalProps = {
  activeWeChatLoginCredentialReady: boolean
  aiBackendOptions: SelectOption[]
  collaborationOptions: SelectOption[]
  closeCreateModal: () => void
  commandOutputModeOptions: SelectOption[]
  connectionModalBot: Bot | null
  connectionModalBotId: string
  connectionModalWorkspace: Workspace | null
  createModalOpen: boolean
  feishuDeliveryModeOptions: SelectOption[]
  formErrorMessage: string
  handleDraftProviderChange: (nextValue: string) => void
  handleSubmitCreate: () => void
  handleWeChatCredentialSourceChange: (nextValue: string) => void
  isCreateOrUpdatePending: boolean
  isEditingConnection: boolean
  isSaveConnectionDisabled: boolean
  openWeChatAccountEditModal: (account: WeChatAccount) => void
  openWeChatLoginModal: () => void
  permissionPresetOptions: SelectOption[]
  providerOptions: SelectOption[]
  reasoningOptions: SelectOption[]
  savedWeChatAccounts: WeChatAccount[]
  setDeleteWeChatAccountTarget: (account: WeChatAccount | null) => void
  setDraft: Dispatch<SetStateAction<BotsPageDraft>>
  telegramDeliveryModeOptions: SelectOption[]
  draft: BotsPageDraft
  wechatAccountsErrorMessage: string
  wechatAccountsQueryIsLoading: boolean
}

function HelpTooltip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="info-label__help">?</span>
    </Tooltip>
  )
}

export function BotsPageConnectionModal({
  activeWeChatLoginCredentialReady,
  aiBackendOptions,
  collaborationOptions,
  closeCreateModal,
  commandOutputModeOptions,
  connectionModalBot,
  connectionModalBotId,
  connectionModalWorkspace,
  createModalOpen,
  draft,
  feishuDeliveryModeOptions,
  formErrorMessage,
  handleDraftProviderChange,
  handleSubmitCreate,
  handleWeChatCredentialSourceChange,
  isCreateOrUpdatePending,
  isEditingConnection,
  isSaveConnectionDisabled,
  openWeChatAccountEditModal,
  openWeChatLoginModal,
  permissionPresetOptions,
  providerOptions,
  reasoningOptions,
  savedWeChatAccounts,
  setDeleteWeChatAccountTarget,
  setDraft,
  telegramDeliveryModeOptions,
  wechatAccountsErrorMessage,
  wechatAccountsQueryIsLoading,
}: BotsPageConnectionModalProps) {
  const draftProvider = resolveBotProvider(draft.provider) || 'telegram'
  const draftTelegramDeliveryMode = draft.telegramDeliveryMode.trim().toLowerCase() === 'polling' ? 'polling' : 'webhook'
  const draftFeishuDeliveryMode = resolveFeishuDeliveryMode(draft.feishuDeliveryMode)
  const draftWeChatCredentialSource =
    draft.wechatCredentialSource.trim().toLowerCase() === 'saved'
      ? 'saved'
      : draft.wechatCredentialSource.trim().toLowerCase() === 'qr'
        ? 'qr'
        : 'manual'
  const wechatCredentialSourceOptions: SelectOption[] = [
    {
      value: 'saved',
      label: i18n._({ id: 'Saved Account', message: 'Saved Account' }),
    },
    {
      value: 'manual',
      label: i18n._({ id: 'Manual Entry', message: 'Manual Entry' }),
    },
    {
      value: 'qr',
      label: i18n._({ id: 'QR Login', message: 'QR Login' }),
    },
  ]
  const savedWeChatAccountOptions: SelectOption[] = savedWeChatAccounts.map((account) => ({
    value: account.id,
    label: formatWeChatAccountLabel(account),
  }))
  const feishuStreamingPlainTextStrategyOptions: SelectOption[] = [
    {
      value: FEISHU_STREAMING_PLAIN_TEXT_STRATEGY_APPEND_DELTA,
      label: i18n._({ id: 'Send New Text (Default)', message: 'Send New Text (Default)' }),
    },
    {
      value: FEISHU_STREAMING_PLAIN_TEXT_STRATEGY_SMART_PRESERVE,
      label: i18n._({ id: 'Send Completed Chunks', message: 'Send Completed Chunks' }),
    },
    {
      value: FEISHU_STREAMING_PLAIN_TEXT_STRATEGY_UPDATE_ONLY,
      label: i18n._({ id: 'Update One Message', message: 'Update One Message' }),
    },
  ]
  const selectedSavedWeChatAccount =
    savedWeChatAccounts.find((account) => account.id === draft.wechatSavedAccountId.trim()) ?? null
  const hasDraftWeChatCredentialBundle =
    draft.wechatAccountId.trim().length > 0 &&
    draft.wechatUserId.trim().length > 0 &&
    draft.wechatBotToken.trim().length > 0
  const hasDraftConfirmedWeChatLoginSession =
    draft.wechatLoginSessionId.trim().length > 0 && draft.wechatLoginStatus.trim().toLowerCase() === 'confirmed'
  const wechatLoginEntryLabel = hasDraftWeChatCredentialBundle
    ? i18n._({ id: 'Replace Credentials', message: 'Replace Credentials' })
    : activeWeChatLoginCredentialReady
      ? i18n._({ id: 'Review Credentials', message: 'Review Credentials' })
      : draft.wechatLoginSessionId
        ? i18n._({ id: 'Continue QR Login', message: 'Continue QR Login' })
        : i18n._({ id: 'Start QR Login', message: 'Start QR Login' })
  const wechatDraftSessionIdLabel = draft.wechatLoginSessionId || i18n._({ id: 'Not started', message: 'Not started' })
  const wechatDraftSessionStatusLabel = draft.wechatLoginStatus
    ? formatLocalizedStatusLabel(draft.wechatLoginStatus)
    : i18n._({ id: 'Not started', message: 'Not started' })
  const wechatDraftPayloadLabel = draft.wechatQrCodeContent.trim()
    ? i18n._({ id: 'Ready', message: 'Ready' })
    : i18n._({ id: 'Not fetched', message: 'Not fetched' })
  const wechatDraftCredentialBundleLabel = hasDraftWeChatCredentialBundle
    ? i18n._({ id: 'Applied to form', message: 'Applied to form' })
    : hasDraftConfirmedWeChatLoginSession || activeWeChatLoginCredentialReady
      ? i18n._({ id: 'Ready to create', message: 'Ready to create' })
      : draft.wechatLoginSessionId
        ? i18n._({ id: 'Pending confirmation', message: 'Pending confirmation' })
        : i18n._({ id: 'Not loaded', message: 'Not loaded' })
  const wechatQrCredentialNotice = hasDraftWeChatCredentialBundle
    ? ''
    : hasDraftConfirmedWeChatLoginSession || activeWeChatLoginCredentialReady
      ? i18n._({
          id: 'The remote service has already confirmed this login. You can create the connection directly now, or reopen the QR dialog and click Use Credentials to copy the bundle into the form.',
          message:
            'The remote service has already confirmed this login. You can create the connection directly now, or reopen the QR dialog and click Use Credentials to copy the bundle into the form.',
        })
      : draft.wechatLoginSessionId
        ? i18n._({
            id: 'A QR login session is already in progress. Reopen the dialog to continue polling until the credential bundle is confirmed.',
            message:
              'A QR login session is already in progress. Reopen the dialog to continue polling until the credential bundle is confirmed.',
          })
        : i18n._({
            id: 'Start a QR login session to fetch the account ID, owner user ID, and bot token automatically from the remote WeChat service.',
            message:
              'Start a QR login session to fetch the account ID, owner user ID, and bot token automatically from the remote WeChat service.',
          })
  const createModalFooter = (
    <>
      <Button intent="secondary" onClick={closeCreateModal}>
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        disabled={isSaveConnectionDisabled}
        isLoading={isCreateOrUpdatePending}
        onClick={handleSubmitCreate}
      >
        {isEditingConnection
          ? i18n._({ id: 'Save Changes', message: 'Save Changes' })
          : i18n._({ id: 'Create Endpoint', message: 'Create Endpoint' })}
      </Button>
    </>
  )

  return (
    <>
      {createModalOpen ? (
        <Modal
          description={
            isEditingConnection
              ? i18n._({
                  id: 'Update the provider delivery settings, credentials, and AI backend binding for this existing endpoint.',
                  message:
                    'Update the provider delivery settings, credentials, and AI backend binding for this existing endpoint.',
                })
              : i18n._({
                  id: 'Create a provider endpoint under the selected bot, configure the provider-specific delivery settings, and bind it to an AI execution backend.',
                  message:
                    'Create a provider endpoint under the selected bot, configure the provider-specific delivery settings, and bind it to an AI execution backend.',
                })
          }
          footer={createModalFooter}
          onClose={closeCreateModal}
          title={
            isEditingConnection
              ? i18n._({ id: 'Edit Endpoint', message: 'Edit Endpoint' })
              : i18n._({ id: 'New Endpoint', message: 'New Endpoint' })
          }
        >
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmitCreate()
            }}
          >
            {formErrorMessage ? (
              <InlineNotice
                dismissible
                noticeKey={`${isEditingConnection ? 'edit' : 'create'}-bot-connection-${formErrorMessage}`}
                title={
                  isEditingConnection
                    ? i18n._({ id: 'Update Endpoint Failed', message: 'Update Endpoint Failed' })
                    : i18n._({ id: 'Create Endpoint Failed', message: 'Create Endpoint Failed' })
                }
                tone="error"
              >
                {formErrorMessage}
              </InlineNotice>
            ) : null}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <p className="config-inline-note" style={{ margin: 0 }}>
                {i18n._({
                  id: 'Outbound proxy is configured globally in Settings > Config > Runtime.',
                  message: 'Outbound proxy is configured globally in Settings > Config > Runtime.',
                })}
              </p>
              <Link to="/settings/config">
                {i18n._({ id: 'Open Settings', message: 'Open Settings' })}
              </Link>
            </div>

            <div className="form-row">
              <Input
                disabled
                label={i18n._({ id: 'Workspace', message: 'Workspace' })}
                value={connectionModalWorkspace?.name ?? draft.workspaceId}
              />
              <Input
                disabled
                label={i18n._({ id: 'Bot', message: 'Bot' })}
                value={connectionModalBot?.name ?? connectionModalBotId}
              />
            </div>

            <label className="field">
              <span>{i18n._({ id: 'Provider', message: 'Provider' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Provider', message: 'Provider' })}
                disabled={isEditingConnection}
                fullWidth
                onChange={handleDraftProviderChange}
                options={providerOptions}
                value={draft.provider}
              />
            </label>

            <div className="form-row">
              {draftProvider === 'telegram' ? (
                <label className="field">
                  <span>{i18n._({ id: 'Telegram Delivery Mode', message: 'Telegram Delivery Mode' })}</span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Telegram Delivery Mode', message: 'Telegram Delivery Mode' })}
                    fullWidth
                    onChange={(nextValue) => setDraft((current) => ({ ...current, telegramDeliveryMode: nextValue }))}
                    options={telegramDeliveryModeOptions}
                    value={draft.telegramDeliveryMode}
                  />
                </label>
              ) : draftProvider === 'wechat' ? (
                <Input
                  disabled
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'WeChat Delivery Mode', message: 'WeChat Delivery Mode' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'WeChat currently uses polling-only intake in this phase.',
                          message: 'WeChat currently uses polling-only intake in this phase.',
                        })}
                      />
                    </div>
                  }
                  value={i18n._({ id: 'Long Polling only', message: 'Long Polling only' })}
                />
              ) : draftProvider === 'feishu' ? (
                <label className="field">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {i18n._({ id: 'Feishu Delivery Mode', message: 'Feishu Delivery Mode' })}
                    <HelpTooltip
                      content={i18n._({
                        id: 'Select WebSocket for a persistent runtime connection, or Webhook for callback delivery and verification.',
                        message: 'Select WebSocket for a persistent runtime connection, or Webhook for callback delivery and verification.',
                      })}
                    />
                  </span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Feishu Delivery Mode', message: 'Feishu Delivery Mode' })}
                    fullWidth
                    onChange={(nextValue) => setDraft((current) => ({ ...current, feishuDeliveryMode: nextValue }))}
                    options={feishuDeliveryModeOptions}
                    value={draftFeishuDeliveryMode}
                  />
                </label>
              ) : (
                <Input
                  disabled
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'QQ Bot Delivery Mode', message: 'QQ Bot Delivery Mode' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'QQ Bot currently uses the official Gateway WebSocket connection in this phase.',
                          message: 'QQ Bot currently uses the official Gateway WebSocket connection in this phase.',
                        })}
                      />
                    </div>
                  }
                  value={i18n._({ id: 'Gateway WebSocket only', message: 'Gateway WebSocket only' })}
                />
              )}
              <label className="field">
                <span>{i18n._({ id: 'AI Backend', message: 'AI Backend' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'AI Backend', message: 'AI Backend' })}
                  fullWidth
                  onChange={(nextValue) => setDraft((current) => ({ ...current, aiBackend: nextValue }))}
                  options={aiBackendOptions}
                  value={draft.aiBackend}
                />
              </label>
            </div>

            <div className="form-row">
              <Input
                label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {i18n._({ id: 'Endpoint Name', message: 'Endpoint Name' })}
                    <HelpTooltip
                      content={i18n._({
                        id: 'Optional. Defaults to a provider-specific endpoint name.',
                        message: 'Optional. Defaults to a provider-specific endpoint name.',
                      })}
                    />
                  </div>
                }
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={i18n._({ id: 'Support Bot', message: 'Support Bot' })}
                value={draft.name}
              />
            </div>

            <Switch
              checked={draft.runtimeMode === 'debug'}
              label={
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {i18n._({ id: 'Enable Backend Debug Mode', message: 'Enable Backend Debug Mode' })}
                  <HelpTooltip
                    content={i18n._({
                      id: 'Debug mode records detailed backend logs for this bot connection, including inbound processing, AI execution, and provider delivery steps.',
                      message:
                        'Debug mode records detailed backend logs for this bot connection, including inbound processing, AI execution, and provider delivery steps.',
                    })}
                  />
                </div>
              }
              onChange={(event) =>
                setDraft((current) => ({ ...current, runtimeMode: event.target.checked ? 'debug' : 'normal' }))
              }
            />

            <label className="field">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}</span>
                <HelpTooltip
                  content={
                    <>
                      {i18n._({
                        id: 'No Command Output omits command items entirely.',
                        message: 'No Command Output omits command items entirely.',
                      })}{' '}
                      {i18n._({
                        id: 'Controls how command items are summarized in bot replies. Brief keeps the command excerpt within about 3-5 lines and is the default.',
                        message:
                          'Controls how command items are summarized in bot replies. Brief keeps the command excerpt within about 3-5 lines and is the default.',
                      })}
                    </>
                  }
                />
              </div>
              <SelectControl
                ariaLabel={i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}
                fullWidth
                onChange={(nextValue) => setDraft((current) => ({ ...current, commandOutputMode: nextValue }))}
                options={commandOutputModeOptions}
                value={resolveBotCommandOutputMode(draft.commandOutputMode)}
              />
            </label>

            {draftProvider === 'telegram' ? (
              <>
                {draftTelegramDeliveryMode === 'webhook' ? (
                  <Input
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'Public Base URL', message: 'Public Base URL' })}
                        <HelpTooltip
                          content={i18n._({
                            id: 'Required unless the backend already provides CODEX_SERVER_PUBLIC_BASE_URL.',
                            message: 'Required unless the backend already provides CODEX_SERVER_PUBLIC_BASE_URL.',
                          })}
                        />
                      </div>
                    }
                    onChange={(event) => setDraft((current) => ({ ...current, publicBaseUrl: event.target.value }))}
                    placeholder="https://bots.example.com"
                    value={draft.publicBaseUrl}
                  />
                ) : null}

                <Input
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'Telegram Bot Token', message: 'Telegram Bot Token' })}
                      {isEditingConnection && (
                        <HelpTooltip
                          content={i18n._({
                            id: 'Leave blank to keep the current Telegram bot token. Enter a new token only when rotating credentials.',
                            message:
                              'Leave blank to keep the current Telegram bot token. Enter a new token only when rotating credentials.',
                          })}
                        />
                      )}
                    </div>
                  }
                  onChange={(event) => setDraft((current) => ({ ...current, telegramBotToken: event.target.value }))}
                  placeholder={i18n._({ id: '123456:ABCDEF...', message: '123456:ABCDEF...' })}
                  type="password"
                  value={draft.telegramBotToken}
                />
              </>
            ) : draftProvider === 'wechat' ? (
              <>
                <div className="form-row">
                  <Input
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'WeChat Base URL', message: 'WeChat Base URL' })}
                        <HelpTooltip
                          content={i18n._({
                            id: 'Required. Use the iLink channel base URL for this WeChat account.',
                            message: 'Required. Use the iLink channel base URL for this WeChat account.',
                          })}
                        />
                      </div>
                    }
                    onChange={(event) => setDraft((current) => ({ ...current, wechatBaseUrl: event.target.value }))}
                    placeholder="https://wechat.example.com"
                    value={draft.wechatBaseUrl}
                  />
                  <label className="field">
                    <span>{i18n._({ id: 'Credential Source', message: 'Credential Source' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Credential Source', message: 'Credential Source' })}
                      fullWidth
                      onChange={handleWeChatCredentialSourceChange}
                      options={wechatCredentialSourceOptions}
                      value={draftWeChatCredentialSource}
                    />
                  </label>
                </div>

                <Input
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'WeChat Route Tag', message: 'WeChat Route Tag' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Optional. Adds the SKRouteTag header for WeChat API requests when your iLink deployment requires route pinning.',
                          message:
                            'Optional. Adds the SKRouteTag header for WeChat API requests when your iLink deployment requires route pinning.',
                        })}
                      />
                    </div>
                  }
                  onChange={(event) => setDraft((current) => ({ ...current, wechatRouteTag: event.target.value }))}
                  placeholder={i18n._({ id: 'route-tag-1', message: 'route-tag-1' })}
                  value={draft.wechatRouteTag}
                />

                <Switch
                  checked={draft.wechatChannelTimingEnabled}
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({
                        id: 'Append WeChat Channel Timing',
                        message: 'Append WeChat Channel Timing',
                      })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Append the WeChat Channel timing block to final replies. This is independent from backend debug mode and defaults to disabled for new connections.',
                          message:
                            'Append the WeChat Channel timing block to final replies. This is independent from backend debug mode and defaults to disabled for new connections.',
                        })}
                      />
                    </div>
                  }
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, wechatChannelTimingEnabled: event.target.checked }))
                  }
                />

                {draftWeChatCredentialSource === 'saved' ? (
                  <>
                    <label className="field">
                      <span>{i18n._({ id: 'Saved WeChat Account', message: 'Saved WeChat Account' })}</span>
                      <SelectControl
                        ariaLabel={i18n._({ id: 'Saved WeChat Account', message: 'Saved WeChat Account' })}
                        fullWidth
                        onChange={(nextValue) =>
                          setDraft((current) => ({
                            ...current,
                            wechatBaseUrl:
                              savedWeChatAccounts.find((account) => account.id === nextValue)?.baseUrl ?? current.wechatBaseUrl,
                            wechatSavedAccountId: nextValue,
                          }))
                        }
                        options={savedWeChatAccountOptions}
                        value={draft.wechatSavedAccountId}
                      />
                    </label>

                    {wechatAccountsErrorMessage ? (
                      <InlineNotice
                        dismissible={false}
                        noticeKey={`wechat-accounts-error-${wechatAccountsErrorMessage}`}
                        title={i18n._({ id: 'Saved Account Lookup Failed', message: 'Saved Account Lookup Failed' })}
                      >
                        {wechatAccountsErrorMessage}
                      </InlineNotice>
                    ) : null}

                    {wechatAccountsQueryIsLoading ? (
                      <div className="notice">
                        {i18n._({ id: 'Loading saved WeChat accounts...', message: 'Loading saved WeChat accounts...' })}
                      </div>
                    ) : !savedWeChatAccounts.length ? (
                      <InlineNotice
                        dismissible={false}
                        noticeKey="wechat-saved-accounts-empty"
                        title={i18n._({ id: 'No Saved Accounts Yet', message: 'No Saved Accounts Yet' })}
                      >
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <p style={{ margin: 0 }}>
                            {i18n._({
                              id: 'Complete one WeChat QR login first. Confirmed accounts are saved automatically.',
                              message:
                                'Complete one WeChat QR login first. Confirmed accounts are saved automatically.',
                            })}
                          </p>
                          <Link to="/settings/wechat-accounts">
                            {i18n._({
                              id: 'Manage saved WeChat accounts in Settings.',
                              message: 'Manage saved WeChat accounts in Settings.',
                            })}
                          </Link>
                        </div>
                      </InlineNotice>
                    ) : selectedSavedWeChatAccount ? (
                      <>
                        <div
                          style={{
                            alignItems: 'center',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '8px',
                            justifyContent: 'space-between',
                          }}
                        >
                          <strong>{i18n._({ id: 'Saved Account Detail', message: 'Saved Account Detail' })}</strong>
                          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            <Button intent="ghost" onClick={() => openWeChatAccountEditModal(selectedSavedWeChatAccount)} type="button">
                              {i18n._({ id: 'Edit Details', message: 'Edit Details' })}
                            </Button>
                            <Button
                              className="ide-button--ghost-danger"
                              intent="ghost"
                              onClick={() => setDeleteWeChatAccountTarget(selectedSavedWeChatAccount)}
                              type="button"
                            >
                              {i18n._({ id: 'Delete Saved Account', message: 'Delete Saved Account' })}
                            </Button>
                          </div>
                        </div>
                        <div className="detail-list">
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Label', message: 'Label' })}</span>
                            <strong>{formatWeChatAccountLabel(selectedSavedWeChatAccount)}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Alias', message: 'Alias' })}</span>
                            <strong>{selectedSavedWeChatAccount.alias?.trim() || i18n._({ id: 'none', message: 'none' })}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Account ID', message: 'Account ID' })}</span>
                            <strong>{selectedSavedWeChatAccount.accountId}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Owner User ID', message: 'Owner User ID' })}</span>
                            <strong>{selectedSavedWeChatAccount.userId}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Resolved Base URL', message: 'Resolved Base URL' })}</span>
                            <strong>{selectedSavedWeChatAccount.baseUrl}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Last Confirmed', message: 'Last Confirmed' })}</span>
                            <strong>{formatBotTimestamp(selectedSavedWeChatAccount.lastConfirmedAt)}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Notes', message: 'Notes' })}</span>
                            <strong>{selectedSavedWeChatAccount.note?.trim() || i18n._({ id: 'none', message: 'none' })}</strong>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </>
                ) : draftWeChatCredentialSource === 'manual' ? (
                  <>
                    <div className="form-row">
                      <Input
                        label={i18n._({ id: 'WeChat Account ID', message: 'WeChat Account ID' })}
                        onChange={(event) => setDraft((current) => ({ ...current, wechatAccountId: event.target.value }))}
                        placeholder={i18n._({ id: 'wechat-account-1', message: 'wechat-account-1' })}
                        value={draft.wechatAccountId}
                      />
                      <Input
                        label={
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {i18n._({ id: 'WeChat Owner User ID', message: 'WeChat Owner User ID' })}
                            <HelpTooltip
                              content={i18n._({
                                id: 'Required. This maps to wechat_owner_user_id on the backend.',
                                message: 'Required. This maps to wechat_owner_user_id on the backend.',
                              })}
                            />
                          </div>
                        }
                        onChange={(event) => setDraft((current) => ({ ...current, wechatUserId: event.target.value }))}
                        placeholder={i18n._({ id: 'wechat-owner-1', message: 'wechat-owner-1' })}
                        value={draft.wechatUserId}
                      />
                    </div>

                    <Input
                      label={
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {i18n._({ id: 'WeChat Bot Token', message: 'WeChat Bot Token' })}
                          <HelpTooltip
                            content={
                              isEditingConnection
                                ? i18n._({
                                    id: 'Leave blank to keep the current WeChat bot token. Enter a new token only when rotating credentials.',
                                    message:
                                      'Leave blank to keep the current WeChat bot token. Enter a new token only when rotating credentials.',
                                  })
                                : i18n._({
                                    id: 'Enter the bot token issued by the WeChat iLink backend for this account.',
                                    message: 'Enter the bot token issued by the WeChat iLink backend for this account.',
                                  })
                            }
                          />
                        </div>
                      }
                      onChange={(event) => setDraft((current) => ({ ...current, wechatBotToken: event.target.value }))}
                      placeholder={i18n._({ id: 'wechat-token-1', message: 'wechat-token-1' })}
                      type="password"
                      value={draft.wechatBotToken}
                    />
                  </>
                ) : (
                  <>
                    <section className="mode-panel">
                      <div
                        style={{
                          alignItems: 'start',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '16px',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'grid', gap: '6px' }}>
                          <strong>{i18n._({ id: 'WeChat QR Login', message: 'WeChat QR Login' })}</strong>
                          <span>
                            {i18n._({
                              id: 'Fetch the WeChat credential bundle from the remote iLink service, then apply it back into this form without manual secret entry.',
                              message:
                                'Fetch the WeChat credential bundle from the remote iLink service, then apply it back into this form without manual secret entry.',
                            })}
                          </span>
                        </div>
                        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {draft.wechatLoginStatus ? <StatusPill status={draft.wechatLoginStatus} /> : null}
                          <Button intent="secondary" onClick={openWeChatLoginModal} type="button">
                            {wechatLoginEntryLabel}
                          </Button>
                        </div>
                      </div>

                      <div className="detail-list" style={{ marginTop: '16px' }}>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Login Session', message: 'Login Session' })}</span>
                          <strong>{wechatDraftSessionIdLabel}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Session Status', message: 'Session Status' })}</span>
                          <strong>{wechatDraftSessionStatusLabel}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'QR Payload', message: 'QR Payload' })}</span>
                          <strong>{wechatDraftPayloadLabel}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Credential Bundle', message: 'Credential Bundle' })}</span>
                          <strong>{wechatDraftCredentialBundleLabel}</strong>
                        </div>
                      </div>
                    </section>

                    {!hasDraftWeChatCredentialBundle ? (
                      <InlineNotice
                        dismissible={false}
                        noticeKey={`wechat-qr-credential-${draft.wechatLoginSessionId || 'idle'}-${draft.wechatLoginStatus || 'none'}`}
                        title={
                          hasDraftConfirmedWeChatLoginSession
                            ? i18n._({ id: 'QR Session Ready', message: 'QR Session Ready' })
                            : i18n._({ id: 'QR Credentials Required', message: 'QR Credentials Required' })
                        }
                      >
                        {wechatQrCredentialNotice}
                      </InlineNotice>
                    ) : (
                      <>
                        <div className="form-row">
                          <Input
                            hint={i18n._({
                              id: 'Applied from the confirmed QR login session. Switch back to Manual Entry if you need to override it manually.',
                              message:
                                'Applied from the confirmed QR login session. Switch back to Manual Entry if you need to override it manually.',
                            })}
                            label={i18n._({ id: 'WeChat Account ID', message: 'WeChat Account ID' })}
                            readOnly
                            value={draft.wechatAccountId}
                          />
                          <Input
                            hint={i18n._({
                              id: 'Read-only while QR Login is selected.',
                              message: 'Read-only while QR Login is selected.',
                            })}
                            label={i18n._({ id: 'WeChat Owner User ID', message: 'WeChat Owner User ID' })}
                            readOnly
                            value={draft.wechatUserId}
                          />
                        </div>

                        <Input
                          hint={i18n._({
                            id: 'Stored in the form and submitted on create. Start a new QR login if you need to rotate it.',
                            message:
                              'Stored in the form and submitted on create. Start a new QR login if you need to rotate it.',
                          })}
                          label={i18n._({ id: 'WeChat Bot Token', message: 'WeChat Bot Token' })}
                          readOnly
                          type="password"
                          value={draft.wechatBotToken}
                        />
                      </>
                    )}
                  </>
                )}
              </>
            ) : draftProvider === 'feishu' ? (
              <>
                {draftFeishuDeliveryMode === 'webhook' ? (
                  <Input
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'Public Base URL', message: 'Public Base URL' })}
                        <HelpTooltip
                          content={i18n._({
                            id: 'Required unless the backend already provides CODEX_SERVER_PUBLIC_BASE_URL.',
                            message: 'Required unless the backend already provides CODEX_SERVER_PUBLIC_BASE_URL.',
                          })}
                        />
                      </div>
                    }
                    onChange={(event) => setDraft((current) => ({ ...current, publicBaseUrl: event.target.value }))}
                    placeholder="https://bots.example.com"
                    value={draft.publicBaseUrl}
                  />
                ) : null}

                <div className="form-row">
                  <Input
                    label={i18n._({ id: 'Feishu App ID', message: 'Feishu App ID' })}
                    onChange={(event) => setDraft((current) => ({ ...current, feishuAppId: event.target.value }))}
                    placeholder={i18n._({ id: 'cli_a1b2c3d4e5f6', message: 'cli_a1b2c3d4e5f6' })}
                    value={draft.feishuAppId}
                  />
                  <Input
                    hint={
                      isEditingConnection
                        ? i18n._({
                            id: 'Leave blank to keep the current Feishu App Secret. Enter a new secret only when rotating credentials.',
                            message:
                              'Leave blank to keep the current Feishu App Secret. Enter a new secret only when rotating credentials.',
                          })
                        : i18n._({
                            id: 'Required. Enter the App Secret issued for this Feishu bot.',
                            message: 'Required. Enter the App Secret issued for this Feishu bot.',
                          })
                    }
                    label={i18n._({ id: 'Feishu App Secret', message: 'Feishu App Secret' })}
                    onChange={(event) => setDraft((current) => ({ ...current, feishuAppSecret: event.target.value }))}
                    placeholder={i18n._({ id: 'cli_secret_xxx', message: 'cli_secret_xxx' })}
                    type="password"
                    value={draft.feishuAppSecret}
                  />
                </div>

                <Input
                  hint={i18n._({
                    id: 'Optional. Leave blank to use the default https://open.feishu.cn endpoint.',
                    message: 'Optional. Leave blank to use the default https://open.feishu.cn endpoint.',
                  })}
                  label={i18n._({ id: 'Feishu Domain', message: 'Feishu Domain' })}
                  onChange={(event) => setDraft((current) => ({ ...current, feishuDomain: event.target.value }))}
                  placeholder="https://open.feishu.cn"
                  value={draft.feishuDomain}
                />

                <label className="field">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{i18n._({ id: 'Streaming Plain Text', message: 'Streaming Plain Text' })}</span>
                    <HelpTooltip
                      content={i18n._({
                        id: 'Default: Send New Text sends each newly appended plain-text segment as a separate Feishu reply, while plans and tool progress continue updating one message. Send Completed Chunks keeps finished text blocks as separate replies. Update One Message keeps the chat shorter, but only the latest plain-text snapshot remains visible.',
                        message:
                          'Default: Send New Text sends each newly appended plain-text segment as a separate Feishu reply, while plans and tool progress continue updating one message. Send Completed Chunks keeps finished text blocks as separate replies. Update One Message keeps the chat shorter, but only the latest plain-text snapshot remains visible.',
                      })}
                    />
                  </div>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Streaming Plain Text', message: 'Streaming Plain Text' })}
                    fullWidth
                    onChange={(nextValue) =>
                      setDraft((current) => ({ ...current, feishuStreamingPlainTextStrategy: nextValue }))
                    }
                    options={feishuStreamingPlainTextStrategyOptions}
                    value={resolveFeishuStreamingPlainTextStrategy(draft.feishuStreamingPlainTextStrategy)}
                  />
                </label>

                <Switch
                  checked={draft.feishuEnableCards}
                  label={i18n._({ id: 'Interactive Card', message: 'Interactive Card' })}
                  onChange={(event) => setDraft((current) => ({ ...current, feishuEnableCards: event.target.checked }))}
                />

                <Switch
                  checked={draft.feishuGroupReplyAll}
                  label={i18n._({ id: 'Group Reply All', message: 'Group Reply All' })}
                  onChange={(event) => setDraft((current) => ({ ...current, feishuGroupReplyAll: event.target.checked }))}
                />

                <Switch
                  checked={draft.feishuThreadIsolation}
                  label={i18n._({ id: 'Thread Isolation', message: 'Thread Isolation' })}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, feishuThreadIsolation: event.target.checked }))
                  }
                />

                <Switch
                  checked={draft.feishuShareSessionInChannel}
                  label={i18n._({ id: 'Share Session In Channel', message: 'Share Session In Channel' })}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, feishuShareSessionInChannel: event.target.checked }))
                  }
                />
              </>
            ) : (
              <>
                <div className="form-row">
                  <Input
                    label={i18n._({ id: 'QQ Bot App ID', message: 'QQ Bot App ID' })}
                    onChange={(event) => setDraft((current) => ({ ...current, qqbotAppId: event.target.value }))}
                    placeholder={i18n._({ id: '102345678', message: '102345678' })}
                    value={draft.qqbotAppId}
                  />
                  <Input
                    hint={
                      isEditingConnection
                        ? i18n._({
                            id: 'Leave blank to keep the current QQ Bot App Secret. Enter a new secret only when rotating credentials.',
                            message:
                              'Leave blank to keep the current QQ Bot App Secret. Enter a new secret only when rotating credentials.',
                          })
                        : i18n._({
                            id: 'Required. Enter the App Secret issued for this QQ Bot.',
                            message: 'Required. Enter the App Secret issued for this QQ Bot.',
                          })
                    }
                    label={i18n._({ id: 'QQ Bot App Secret', message: 'QQ Bot App Secret' })}
                    onChange={(event) => setDraft((current) => ({ ...current, qqbotAppSecret: event.target.value }))}
                    placeholder={i18n._({ id: 'qqbot-secret-1', message: 'qqbot-secret-1' })}
                    type="password"
                    value={draft.qqbotAppSecret}
                  />
                </div>

                <Input
                  hint={i18n._({
                    id: 'Optional. Provide custom Gateway intents only when the backend should override the recommended default set.',
                    message:
                      'Optional. Provide custom Gateway intents only when the backend should override the recommended default set.',
                  })}
                  label={i18n._({ id: 'QQ Bot Intents', message: 'QQ Bot Intents' })}
                  onChange={(event) => setDraft((current) => ({ ...current, qqbotIntents: event.target.value }))}
                  placeholder={i18n._({
                    id: 'PUBLIC_GUILD_MESSAGES,GUILD_MESSAGES,DIRECT_MESSAGE',
                    message: 'PUBLIC_GUILD_MESSAGES,GUILD_MESSAGES,DIRECT_MESSAGE',
                  })}
                  value={draft.qqbotIntents}
                />

                <Switch
                  checked={draft.qqbotSandbox}
                  label={i18n._({ id: 'Sandbox', message: 'Sandbox' })}
                  onChange={(event) => setDraft((current) => ({ ...current, qqbotSandbox: event.target.checked }))}
                />

                <Switch
                  checked={draft.qqbotShareSessionInChannel}
                  label={i18n._({ id: 'Share Session In Channel', message: 'Share Session In Channel' })}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, qqbotShareSessionInChannel: event.target.checked }))
                  }
                />

                <Switch
                  checked={draft.qqbotMarkdownSupport}
                  label={i18n._({ id: 'Markdown Support', message: 'Markdown Support' })}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, qqbotMarkdownSupport: event.target.checked }))
                  }
                />
              </>
            )}

            {draft.aiBackend === 'workspace_thread' ? (
              <>
                <div className="form-row">
                  <Input
                    label={i18n._({ id: 'Workspace Model', message: 'Workspace Model' })}
                    onChange={(event) => setDraft((current) => ({ ...current, workspaceModel: event.target.value }))}
                    placeholder="gpt-5.4"
                    value={draft.workspaceModel}
                  />
                  <label className="field">
                    <span>{i18n._({ id: 'Reasoning Effort', message: 'Reasoning Effort' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Reasoning Effort', message: 'Reasoning Effort' })}
                      fullWidth
                      onChange={(nextValue) => setDraft((current) => ({ ...current, workspaceReasoning: nextValue }))}
                      options={reasoningOptions}
                      value={draft.workspaceReasoning}
                    />
                  </label>
                </div>

                <label className="field">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {i18n._({ id: 'Permission Preset', message: 'Permission Preset' })}
                    <HelpTooltip
                      content={i18n._({
                        id: 'Matches the workspace composer permission preset. Full access sends approvalPolicy=never and a danger-full-access sandbox to app-server so bot turns can avoid interactive approval prompts.',
                        message:
                          'Matches the workspace composer permission preset. Full access sends approvalPolicy=never and a danger-full-access sandbox to app-server so bot turns can avoid interactive approval prompts.',
                      })}
                    />
                  </span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Permission Preset', message: 'Permission Preset' })}
                    fullWidth
                    onChange={(nextValue) =>
                      setDraft((current) => ({ ...current, workspacePermissionPreset: nextValue }))
                    }
                    options={permissionPresetOptions}
                    value={draft.workspacePermissionPreset}
                  />
                </label>

                {draft.workspacePermissionPreset === 'full-access' ? (
                  <InlineNotice
                    dismissible={false}
                    noticeKey="bot-workspace-thread-full-access"
                    title={i18n._({ id: 'Full Access Enabled', message: 'Full Access Enabled' })}
                  >
                    {i18n._({
                      id: 'New bot threads and turns will request full access from app-server with approval prompts disabled. Use this only for trusted bot workflows.',
                      message:
                        'New bot threads and turns will request full access from app-server with approval prompts disabled. Use this only for trusted bot workflows.',
                    })}
                  </InlineNotice>
                ) : null}

                <label className="field">
                  <span>{i18n._({ id: 'Collaboration Mode', message: 'Collaboration Mode' })}</span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Collaboration Mode', message: 'Collaboration Mode' })}
                    fullWidth
                    onChange={(nextValue) =>
                      setDraft((current) => ({ ...current, workspaceCollaborationMode: nextValue }))
                    }
                    options={collaborationOptions}
                    value={draft.workspaceCollaborationMode}
                  />
                </label>
              </>
            ) : (
              <>
                <div className="form-row">
                  <Input
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'OpenAI API Key', message: 'OpenAI API Key' })}
                        {isEditingConnection && (
                          <HelpTooltip
                            content={i18n._({
                              id: 'Leave blank to keep the current OpenAI API key. Enter a new key only when rotating credentials.',
                              message:
                                'Leave blank to keep the current OpenAI API key. Enter a new key only when rotating credentials.',
                            })}
                          />
                        )}
                      </div>
                    }
                    onChange={(event) => setDraft((current) => ({ ...current, openAIApiKey: event.target.value }))}
                    placeholder={i18n._({ id: 'sk-...', message: 'sk-...' })}
                    type="password"
                    value={draft.openAIApiKey}
                  />
                  <Input
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'OpenAI Base URL', message: 'OpenAI Base URL' })}
                        <HelpTooltip
                          content={i18n._({
                            id: 'Optional. Defaults to the standard Responses API endpoint.',
                            message: 'Optional. Defaults to the standard Responses API endpoint.',
                          })}
                        />
                      </div>
                    }
                    onChange={(event) => setDraft((current) => ({ ...current, openAIBaseUrl: event.target.value }))}
                    placeholder="https://api.openai.com/v1/responses"
                    value={draft.openAIBaseUrl}
                  />
                </div>

                <div className="form-row">
                  <Input
                    label={i18n._({ id: 'OpenAI Model', message: 'OpenAI Model' })}
                    onChange={(event) => setDraft((current) => ({ ...current, openAIModel: event.target.value }))}
                    placeholder="gpt-5.4"
                    value={draft.openAIModel}
                  />
                  <label className="field">
                    <span>{i18n._({ id: 'Reasoning Effort', message: 'Reasoning Effort' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Reasoning Effort', message: 'Reasoning Effort' })}
                      fullWidth
                      onChange={(nextValue) => setDraft((current) => ({ ...current, openAIReasoning: nextValue }))}
                      options={reasoningOptions}
                      value={draft.openAIReasoning}
                    />
                  </label>
                </div>

                <TextArea
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'Instructions', message: 'Instructions' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Optional system instructions for the Responses backend.',
                          message: 'Optional system instructions for the Responses backend.',
                        })}
                      />
                    </div>
                  }
                  onChange={(event) => setDraft((current) => ({ ...current, openAIInstructions: event.target.value }))}
                  rows={5}
                  value={draft.openAIInstructions}
                />

                <Switch
                  checked={draft.openAIStore}
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'Store OpenAI Response State', message: 'Store OpenAI Response State' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Persist conversation state in the OpenAI Responses API when supported.',
                          message: 'Persist conversation state in the OpenAI Responses API when supported.',
                        })}
                      />
                    </div>
                  }
                  onChange={(event) => setDraft((current) => ({ ...current, openAIStore: event.target.checked }))}
                />
              </>
            )}
          </form>
        </Modal>
      ) : null}
    </>
  )
}
