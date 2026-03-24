import { Link } from 'react-router-dom'

import { DetailGroup } from '../../components/ui/DetailGroup'
import { i18n } from '../../i18n/runtime'
import { Tooltip } from '../../components/ui/Tooltip'
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

export function ThreadWorkbenchRailWorkbenchToolsSection({
  command,
  commandRunMode,
  isWorkbenchToolsExpanded,
  onChangeCommand,
  onChangeCommandRunMode,
  onStartCommand,
  onToggleWorkbenchToolsExpanded,
  selectedThread,
  startCommandModeDisabled,
  startCommandPending,
}: ThreadWorkbenchRailWorkbenchToolsSectionProps) {
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
      </div>
    </DetailGroup>
  )
}
