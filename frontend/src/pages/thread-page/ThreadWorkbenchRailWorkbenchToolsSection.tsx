import { Link } from 'react-router-dom'

import { DetailGroup } from '../../components/ui/DetailGroup'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { Select } from '../../components/ui/Input'
import { TextArea } from '../../components/ui/TextArea'
import { i18n } from '../../i18n/runtime'
import { Tooltip } from '../../components/ui/Tooltip'
import type { Bot, BotDeliveryTarget } from '../../types/api'
import type {
  ThreadWorkbenchRailInfoLabelProps,
  ThreadWorkbenchRailWorkbenchToolsSectionProps,
} from './threadWorkbenchRailTypes'

function InfoLabel({
  help,
  label,
}: ThreadWorkbenchRailInfoLabelProps) {
  if (!help) {
    return <span className="info-label">{label}</span>
  }

  return (
    <span className="info-label">
      <span>{label}</span>
      <Tooltip
        content={help}
        position="left"
        triggerLabel={i18n._({
          id: '{label} help',
          message: '{label} help',
          values: { label },
        })}
      >
        <span aria-hidden="true" className="info-label__help">
          ?
        </span>
      </Tooltip>
    </span>
  )
}

function formatBotLabel(bot: Bot, selectedThreadWorkspaceId?: string) {
  const label = bot.name?.trim() || bot.id
  if (!selectedThreadWorkspaceId || bot.workspaceId === selectedThreadWorkspaceId) {
    return label
  }
  return `${label} · ${bot.workspaceId}`
}

function formatDeliveryTargetLabel(target: BotDeliveryTarget) {
  return target.title?.trim() || target.routeKey?.trim() || target.targetType?.trim() || target.id
}

function isDeliveryTargetSendReady(target: BotDeliveryTarget) {
  return (
    target.status === 'active' &&
    (target.deliveryReadiness?.trim().toLowerCase() ?? 'ready') === 'ready'
  )
}

export function ThreadWorkbenchRailWorkbenchToolsSection({
  botSendBinding,
  botSendBindingPending,
  botSendBots,
  botSendDeliveryTargets,
  botSendErrorMessage,
  botSendLoading,
  botSendPending,
  botSendSelectedBotId,
  botSendSelectedDeliveryTargetId,
  botSendText,
  command,
  commandRunMode,
  isWorkbenchToolsExpanded,
  onBindThreadBotChannel,
  onChangeBotSendSelectedBotId,
  onChangeBotSendSelectedDeliveryTargetId,
  onChangeBotSendText,
  onChangeCommand,
  onChangeCommandRunMode,
  onDeleteThreadBotBinding,
  onSendBotMessage,
  onStartCommand,
  onToggleWorkbenchToolsExpanded,
  selectedThread,
  startCommandModeDisabled,
  startCommandPending,
}: ThreadWorkbenchRailWorkbenchToolsSectionProps) {
  const selectedBot =
    botSendBots.find((bot) => bot.id === botSendSelectedBotId) ?? null
  const selectedDeliveryTarget =
    botSendDeliveryTargets.find((target) => target.id === botSendSelectedDeliveryTargetId) ?? null
  const selectedDeliveryTargetReady = selectedDeliveryTarget
    ? isDeliveryTargetSendReady(selectedDeliveryTarget)
    : false
  const boundTarget =
    botSendBinding
      ? botSendDeliveryTargets.find((target) => target.id === botSendBinding.deliveryTargetId) ?? null
      : null
  const bindingMatchesCurrentSelection =
    Boolean(botSendBinding) &&
    botSendBinding?.botId === botSendSelectedBotId &&
    botSendBinding?.deliveryTargetId === botSendSelectedDeliveryTargetId
  const bindDisabled =
    !selectedThread ||
    botSendBindingPending ||
    !botSendSelectedBotId.trim() ||
    !botSendSelectedDeliveryTargetId.trim() ||
    !selectedDeliveryTargetReady
  const botSendDisabled =
    !selectedThread ||
    botSendPending ||
    !botSendSelectedBotId.trim() ||
    !botSendSelectedDeliveryTargetId.trim() ||
    !botSendText.trim() ||
    !selectedDeliveryTargetReady
  const botSendDisabledReason = !selectedThread
    ? i18n._({
        id: 'Select a thread to send a proactive bot message.',
        message: 'Select a thread to send a proactive bot message.',
      })
    : !botSendBots.length && !botSendLoading
      ? i18n._({
          id: 'No bots are available yet.',
          message: 'No bots are available yet.',
        })
      : botSendSelectedBotId && !botSendDeliveryTargets.length && !botSendLoading
        ? i18n._({
            id: 'The selected bot does not have any saved delivery targets yet.',
            message: 'The selected bot does not have any saved delivery targets yet.',
          })
        : selectedDeliveryTarget && !selectedDeliveryTargetReady
          ? selectedDeliveryTarget.deliveryReadinessMessage?.trim() ||
            i18n._({
              id: 'The selected delivery target is not ready for outbound sending.',
              message: 'The selected delivery target is not ready for outbound sending.',
            })
          : null

  return (
    <DetailGroup
      collapsible
      open={isWorkbenchToolsExpanded}
      onToggle={onToggleWorkbenchToolsExpanded}
      title={i18n._({
        id: 'Workbench tools',
        message: 'Workbench tools',
      })}
    >
      <div className="pane-section-content">
        <div className="pane-link-grid">
          <Link className="ide-button ide-button--secondary" style={{ flex: 1 }} to="/automations">
            {i18n._({
              id: 'Automations',
              message: 'Automations',
            })}
          </Link>
          <Link className="ide-button ide-button--secondary" style={{ flex: 1 }} to="/skills">
            {i18n._({
              id: 'Skills',
              message: 'Skills',
            })}
          </Link>
          <Link className="ide-button ide-button--secondary" style={{ flex: 1 }} to="/runtime">
            {i18n._({
              id: 'Runtime',
              message: 'Runtime',
            })}
          </Link>
        </div>
        <form className="form-stack" style={{ marginTop: 16 }} onSubmit={onStartCommand}>
          <div
            aria-label={i18n._({
              id: 'Command execution mode',
              message: 'Command execution mode',
            })}
            role="group"
          >
            <InfoLabel
              label={i18n._({
                id: 'Execution mode',
                message: 'Execution mode',
              })}
            />
            <div
              className="segmented-control"
              style={{ width: '100%', marginTop: 8, padding: 2 }}
            >
              <button
                aria-pressed={commandRunMode === 'command-exec'}
                className={
                  commandRunMode === 'command-exec'
                    ? 'segmented-control__item segmented-control__item--active'
                    : 'segmented-control__item'
                }
                onClick={() => onChangeCommandRunMode('command-exec')}
                style={{ flex: 1 }}
                type="button"
              >
                {i18n._({
                  id: 'command/exec',
                  message: 'command/exec',
                })}
              </button>
              <button
                aria-pressed={commandRunMode === 'thread-shell'}
                className={
                  commandRunMode === 'thread-shell'
                    ? 'segmented-control__item segmented-control__item--active'
                    : 'segmented-control__item'
                }
                disabled={!selectedThread}
                onClick={() => onChangeCommandRunMode('thread-shell')}
                style={{ flex: 1 }}
                type="button"
              >
                {i18n._({
                  id: 'thread/shellCommand',
                  message: 'thread/shellCommand',
                })}
              </button>
            </div>
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <InfoLabel
              label={
                commandRunMode === 'thread-shell'
                  ? i18n._({
                      id: 'Run shell command in thread',
                      message: 'Run shell command in thread',
                    })
                  : i18n._({
                      id: 'Run command',
                      message: 'Run command',
                    })
              }
            />
            <input
              className="field-input"
              onChange={(event) => onChangeCommand(event.target.value)}
              placeholder={
                commandRunMode === 'thread-shell'
                  ? 'node script.js'
                  : 'pnpm test --filter frontend'
              }
              value={command}
            />
          </label>
          <p className="config-inline-note" style={{ margin: '8px 0' }}>
            {commandRunMode === 'thread-shell'
              ? i18n._({
                  id: 'Runs a single shell command through thread/shellCommand. It is unsandboxed with full access and streams back into the thread, not the terminal dock.',
                  message:
                    'Runs a single shell command through thread/shellCommand. It is unsandboxed with full access and streams back into the thread, not the terminal dock.',
                })
              : i18n._({
                  id: 'Runs a standalone command/exec session using the configured command sandbox policy and attaches output to the terminal dock.',
                  message:
                    'Runs a standalone command/exec session using the configured command sandbox policy and attaches output to the terminal dock.',
                })}
          </p>
          <button
            className="ide-button ide-button--primary"
            disabled={!command.trim() || startCommandModeDisabled}
            style={{ width: '100%' }}
            type="submit"
          >
            {startCommandPending
              ? i18n._({
                  id: 'Starting…',
                  message: 'Starting…',
                })
              : commandRunMode === 'thread-shell'
                ? i18n._({
                    id: 'Run in thread',
                    message: 'Run in thread',
                  })
                : i18n._({
                    id: 'Run command',
                    message: 'Run command',
                  })}
          </button>
        </form>

        <form className="form-stack" style={{ marginTop: 16 }} onSubmit={onSendBotMessage}>
          <InfoLabel
            help={i18n._({
              id: 'Sends a proactive outbound message through an existing bot delivery target. The current thread is attached as origin metadata for later tracing.',
              message:
                'Sends a proactive outbound message through an existing bot delivery target. The current thread is attached as origin metadata for later tracing.',
            })}
            label={i18n._({
              id: 'Send To Bot',
              message: 'Send To Bot',
            })}
          />
          <p className="config-inline-note" style={{ margin: '8px 0 0' }}>
            {selectedThread
              ? botSendBinding
                ? i18n._({
                    id: 'Thread {threadName} is bound to {targetTitle}. New turn completions started from this page will auto-deliver their final assistant reply there, and manual sends below stay available as an override.',
                    message:
                      'Thread {threadName} is bound to {targetTitle}. New turn completions started from this page will auto-deliver their final assistant reply there, and manual sends below stay available as an override.',
                    values: {
                      threadName: selectedThread.name || selectedThread.id,
                      targetTitle:
                        boundTarget?.title?.trim() ||
                        botSendBinding.deliveryTargetTitle?.trim() ||
                        botSendBinding.deliveryTargetId,
                    },
                  })
                : i18n._({
                    id: 'No bot channel is bound to {threadName} yet. Pick an existing delivery target to enable automatic outbound sync for new turns, or use the manual send box below.',
                    message:
                      'No bot channel is bound to {threadName} yet. Pick an existing delivery target to enable automatic outbound sync for new turns, or use the manual send box below.',
                    values: { threadName: selectedThread.name || selectedThread.id },
                  })
              : i18n._({
                  id: 'Choose a thread first, then pick an existing bot delivery target.',
                  message: 'Choose a thread first, then pick an existing bot delivery target.',
                })}
          </p>

          {selectedThread && selectedBot && selectedBot.workspaceId !== selectedThread.workspaceId ? (
            <p className="config-inline-note" style={{ margin: '8px 0 0' }}>
              {i18n._({
                id: 'The selected bot is managed from workspace {workspaceId}. Binding and outbound sends will use that workspace while this thread remains the origin.',
                message:
                  'The selected bot is managed from workspace {workspaceId}. Binding and outbound sends will use that workspace while this thread remains the origin.',
                values: {
                  workspaceId: selectedBot.workspaceId,
                },
              })}
            </p>
          ) : null}

          {botSendBinding ? (
            <div className="config-inline-note" style={{ margin: '8px 0 0' }}>
              {i18n._({
                id: 'Current binding: {botName} -> {targetTitle} ({provider}, {status}).',
                message: 'Current binding: {botName} -> {targetTitle} ({provider}, {status}).',
                values: {
                  botName: botSendBinding.botName || botSendBinding.botId,
                  targetTitle:
                    boundTarget?.title?.trim() ||
                    botSendBinding.deliveryTargetTitle?.trim() ||
                    botSendBinding.deliveryTargetId,
                  provider: botSendBinding.provider,
                  status:
                    botSendBinding.deliveryReadiness?.trim() ||
                    botSendBinding.status,
                },
              })}
              {botSendBinding.deliveryReadinessMessage?.trim()
                ? ` ${botSendBinding.deliveryReadinessMessage.trim()}`
                : ''}
            </div>
          ) : null}

          {botSendErrorMessage ? (
            <InlineNotice
              noticeKey={`thread-page-bot-send-${botSendErrorMessage}`}
              title={i18n._({
                id: 'Bot Send Failed',
                message: 'Bot Send Failed',
              })}
              tone="error"
            >
              {botSendErrorMessage}
            </InlineNotice>
          ) : null}

          <Select
            disabled={!selectedThread || botSendPending || botSendLoading || !botSendBots.length}
            label={i18n._({
              id: 'Bot',
              message: 'Bot',
            })}
            onChange={(event) => onChangeBotSendSelectedBotId(event.target.value)}
            value={botSendSelectedBotId}
          >
            <option value="">
              {botSendLoading
                ? i18n._({
                    id: 'Loading bots…',
                    message: 'Loading bots…',
                  })
                : i18n._({
                    id: 'Select a bot',
                    message: 'Select a bot',
                  })}
            </option>
            {botSendBots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {formatBotLabel(bot, selectedThread?.workspaceId)}
                {bot.status !== 'active'
                  ? ` (${i18n._({
                      id: 'inactive',
                      message: 'inactive',
                    })})`
                  : ''}
              </option>
            ))}
          </Select>

          <Select
            disabled={
              !selectedThread ||
              botSendPending ||
              botSendLoading ||
              !botSendSelectedBotId ||
              !botSendDeliveryTargets.length
            }
            label={i18n._({
              id: 'Delivery target',
              message: 'Delivery target',
            })}
            onChange={(event) => onChangeBotSendSelectedDeliveryTargetId(event.target.value)}
            value={botSendSelectedDeliveryTargetId}
          >
            <option value="">
              {botSendLoading
                ? i18n._({
                    id: 'Loading delivery targets…',
                    message: 'Loading delivery targets…',
                  })
                : i18n._({
                    id: 'Select a delivery target',
                    message: 'Select a delivery target',
                  })}
            </option>
            {botSendDeliveryTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {formatDeliveryTargetLabel(target)}
                {` · ${target.provider}`}
                {!isDeliveryTargetSendReady(target)
                  ? ` (${target.deliveryReadiness?.trim() || target.status})`
                  : ''}
              </option>
            ))}
          </Select>

          <div className="pane-link-grid" style={{ marginTop: 4 }}>
            <button
              className="ide-button ide-button--secondary"
              disabled={bindDisabled || bindingMatchesCurrentSelection}
              onClick={onBindThreadBotChannel}
              style={{ flex: 1 }}
              type="button"
            >
              {botSendBindingPending
                ? i18n._({
                    id: 'Saving binding…',
                    message: 'Saving binding…',
                  })
                : bindingMatchesCurrentSelection
                  ? i18n._({
                      id: 'Channel Bound',
                      message: 'Channel Bound',
                    })
                  : i18n._({
                      id: 'Bind Channel',
                      message: 'Bind Channel',
                    })}
            </button>
            <button
              className="ide-button ide-button--secondary"
              disabled={!selectedThread || botSendBindingPending || !botSendBinding}
              onClick={onDeleteThreadBotBinding}
              style={{ flex: 1 }}
              type="button"
            >
              {i18n._({
                id: 'Unbind Channel',
                message: 'Unbind Channel',
              })}
            </button>
          </div>

          {!selectedThread ? null : bindDisabled && !botSendBinding ? (
            <p className="config-inline-note" style={{ margin: '0 0 8px' }}>
              {selectedDeliveryTarget && !selectedDeliveryTargetReady
                ? selectedDeliveryTarget.deliveryReadinessMessage?.trim() ||
                  i18n._({
                    id: 'The selected delivery target is not ready to be bound yet.',
                    message: 'The selected delivery target is not ready to be bound yet.',
                  })
                : i18n._({
                    id: 'Choose an active, ready delivery target before binding.',
                    message: 'Choose an active, ready delivery target before binding.',
                  })}
            </p>
          ) : null}

          <TextArea
            disabled={!selectedThread || botSendPending}
            label={i18n._({
              id: 'Message',
              message: 'Message',
            })}
            onChange={(event) => onChangeBotSendText(event.target.value)}
            placeholder={i18n._({
              id: 'Send a manual proactive update to the selected bot delivery target.',
              message: 'Send a manual proactive update to the selected bot delivery target.',
            })}
            rows={4}
            value={botSendText}
          />

          {botSendDisabledReason ? (
            <p className="config-inline-note" style={{ margin: '0 0 8px' }}>
              {botSendDisabledReason}
            </p>
          ) : null}

          <button
            className="ide-button ide-button--primary"
            disabled={botSendDisabled}
            style={{ width: '100%' }}
            type="submit"
          >
            {botSendPending
              ? i18n._({
                  id: 'Sending…',
                  message: 'Sending…',
                })
              : i18n._({
                  id: 'Send Override',
                  message: 'Send Override',
                })}
          </button>
        </form>
      </div>
    </DetailGroup>
  )
}
