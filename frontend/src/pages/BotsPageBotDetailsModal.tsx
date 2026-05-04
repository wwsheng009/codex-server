import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { StatusPill } from '../components/ui/StatusPill'
import { i18n } from '../i18n/runtime'
import { buildWorkspaceThreadRoute } from '../lib/thread-routes'
import {
  formatBotBackendLabel,
  formatBotDefaultBindingModeLabel,
  formatBotProviderLabel,
  formatBotScopeLabel,
  formatBotSharingModeLabel,
  formatBotTimestamp,
  formatBotWorkspacePermissionPresetLabel,
  formatBotSharedWorkspaceSummary,
  isBotWorkspacePermissionPresetFullAccess,
  resolveBotDefaultBindingMode,
  summarizeBotConnectionCapabilities,
  summarizeBotMap,
} from './botsPageUtils'
import type { Bot, BotConnection, Workspace } from '../types/api'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type BotsPageBotDetailsModalProps = {
  bot: Bot | null
  connections: BotConnection[]
  onClose: () => void
  workspaceById: Map<string, Workspace>
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SummarySection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="settings-subsection settings-output-card">
      <div className="settings-subsection__header">
        <strong>{title}</strong>
      </div>
      <div className="detail-list">{children}</div>
    </section>
  )
}

export function BotsPageBotDetailsModal({
  bot,
  connections,
  onClose,
  workspaceById,
}: BotsPageBotDetailsModalProps) {
  if (!bot) {
    return null
  }

  const primaryConnection = connections.find((connection) => connection.status === 'active') ?? connections[0] ?? null
  const workspaceName = workspaceById.get(bot.workspaceId)?.name ?? bot.workspaceId
  const defaultBindingMode = resolveBotDefaultBindingMode(bot.defaultBindingMode, primaryConnection?.aiBackend)
  const defaultBindingModeLabel = formatBotDefaultBindingModeLabel(bot.defaultBindingMode, primaryConnection?.aiBackend)
  const defaultTargetWorkspaceId =
    bot.defaultTargetWorkspaceId?.trim() || bot.workspaceId
  const defaultTargetWorkspaceName = workspaceById.get(defaultTargetWorkspaceId)?.name ?? defaultTargetWorkspaceId
  const defaultTargetThreadId = bot.defaultTargetThreadId?.trim() ?? ''
  const sharedWorkspaceSummary = formatBotSharedWorkspaceSummary(bot, workspaceById)
  const activeConnectionCount = connections.filter((connection) => connection.status === 'active').length

  return (
    <Modal
      description={i18n._({
        id: '{botName} | {workspaceName}',
        message: '{botName} | {workspaceName}',
        values: {
          botName: bot.name,
          workspaceName,
        },
      })}
      footer={
        <Button intent="secondary" onClick={onClose} type="button">
          {i18n._({ id: 'Close', message: 'Close' })}
        </Button>
      }
      maxWidth="min(1120px, 100%)"
      onClose={onClose}
      title={i18n._({ id: 'Bot Details', message: 'Bot Details' })}
    >
      <div className="form-stack">
        <SummarySection title={i18n._({ id: 'Bot Summary', message: 'Bot Summary' })}>
          <SummaryRow label={i18n._({ id: 'Bot ID', message: 'Bot ID' })} value={<strong dir="auto">{bot.id}</strong>} />
          <SummaryRow label={i18n._({ id: 'Workspace', message: 'Workspace' })} value={workspaceName} />
          <SummaryRow
            label={i18n._({ id: 'Status', message: 'Status' })}
            value={<StatusPill status={bot.status} />}
          />
          <SummaryRow label={i18n._({ id: 'Scope', message: 'Scope' })} value={formatBotScopeLabel(bot.scope)} />
          <SummaryRow
            label={i18n._({ id: 'Sharing', message: 'Sharing' })}
            value={formatBotSharingModeLabel(bot.sharingMode)}
          />
          <SummaryRow
            label={i18n._({ id: 'Shared Workspaces', message: 'Shared Workspaces' })}
            value={sharedWorkspaceSummary}
          />
          <SummaryRow label={i18n._({ id: 'Connections', message: 'Connections' })} value={connections.length} />
          <SummaryRow
            label={i18n._({ id: 'Active Connections', message: 'Active Connections' })}
            value={activeConnectionCount}
          />
          <SummaryRow label={i18n._({ id: 'Conversations', message: 'Conversations' })} value={bot.conversationCount} />
          <SummaryRow
            label={i18n._({ id: 'Default Binding', message: 'Default Binding' })}
            value={defaultBindingModeLabel}
          />
          <SummaryRow
            label={i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}
            value={defaultTargetWorkspaceName}
          />
          <SummaryRow
            label={i18n._({ id: 'Binding Target', message: 'Binding Target' })}
            value={
              defaultBindingMode === 'fixed_thread' && defaultTargetThreadId ? (
                <Link to={buildWorkspaceThreadRoute(defaultTargetWorkspaceId, defaultTargetThreadId)}>
                  {defaultTargetWorkspaceId !== bot.workspaceId
                    ? `${defaultTargetWorkspaceName} / ${defaultTargetThreadId}`
                    : defaultTargetThreadId}
                </Link>
              ) : defaultBindingMode === 'stateless' ? (
                i18n._({ id: 'Stateless', message: 'Stateless' })
              ) : defaultBindingMode === 'workspace_auto_thread' ? (
                i18n._({ id: 'Workspace Auto Thread', message: 'Workspace Auto Thread' })
              ) : (
                i18n._({
                  id: 'Resolve from conversation context',
                  message: 'Resolve from conversation context',
                })
              )
            }
          />
          <SummaryRow
            label={i18n._({ id: 'Description', message: 'Description' })}
            value={bot.description?.trim() || i18n._({ id: 'none', message: 'none' })}
          />
          <SummaryRow label={i18n._({ id: 'Updated', message: 'Updated' })} value={formatBotTimestamp(bot.updatedAt)} />
        </SummarySection>

        {primaryConnection ? (
          <SummarySection title={i18n._({ id: 'Primary Endpoint', message: 'Primary Endpoint' })}>
            <SummaryRow
              label={i18n._({ id: 'Endpoint Name', message: 'Endpoint Name' })}
              value={<strong dir="auto">{primaryConnection.name}</strong>}
            />
            <SummaryRow
              label={i18n._({ id: 'Provider', message: 'Provider' })}
              value={formatBotProviderLabel(primaryConnection.provider)}
            />
            <SummaryRow
              label={i18n._({ id: 'Backend', message: 'Backend' })}
              value={formatBotBackendLabel(primaryConnection.aiBackend)}
            />
            <SummaryRow
              label={i18n._({ id: 'Endpoint Status', message: 'Endpoint Status' })}
              value={<StatusPill status={primaryConnection.status} />}
            />
            <SummaryRow
              label={i18n._({ id: 'Capabilities', message: 'Capabilities' })}
              value={summarizeBotConnectionCapabilities(primaryConnection.capabilities)}
            />
            <SummaryRow
              label={i18n._({ id: 'Provider Settings', message: 'Provider Settings' })}
              value={summarizeBotMap(primaryConnection.settings)}
            />
            <SummaryRow
              label={i18n._({ id: 'AI Config', message: 'AI Config' })}
              value={summarizeBotMap(primaryConnection.aiConfig)}
            />
            {primaryConnection.aiBackend === 'workspace_thread' &&
            isBotWorkspacePermissionPresetFullAccess(primaryConnection.aiConfig?.permission_preset) ? (
              <SummaryRow
                label={i18n._({ id: 'Permission Preset', message: 'Permission Preset' })}
                value={formatBotWorkspacePermissionPresetLabel(primaryConnection.aiConfig?.permission_preset)}
              />
            ) : null}
            <SummaryRow label={i18n._({ id: 'Updated', message: 'Updated' })} value={formatBotTimestamp(primaryConnection.updatedAt)} />
          </SummarySection>
        ) : null}
      </div>
    </Modal>
  )
}
