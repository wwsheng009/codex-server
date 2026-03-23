import { Link } from 'react-router-dom'

import { CollapsiblePanel } from '../../components/ui/CollapsiblePanel'
import { i18n } from '../../i18n/runtime'
import type { ThreadWorkbenchRailProps } from './threadWorkbenchRailTypes'

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
}: Pick<
  ThreadWorkbenchRailProps,
  | 'command'
  | 'commandRunMode'
  | 'isWorkbenchToolsExpanded'
  | 'onChangeCommand'
  | 'onChangeCommandRunMode'
  | 'onStartCommand'
  | 'onToggleWorkbenchToolsExpanded'
  | 'selectedThread'
  | 'startCommandModeDisabled'
  | 'startCommandPending'
>) {
  return (
    <CollapsiblePanel
      className="pane-section--command"
      expanded={isWorkbenchToolsExpanded}
      onToggle={onToggleWorkbenchToolsExpanded}
      title={i18n._({
        id: 'Workbench tools',
        message: 'Workbench tools',
      })}
      description={i18n._({
        id: 'Global shortcuts and ad-hoc commands stay collapsed by default.',
        message: 'Global shortcuts and ad-hoc commands stay collapsed by default.',
      })}
    >
      <div className="pane-link-grid">
        <Link className="ide-button ide-button--secondary" to="/automations">
          {i18n._({
            id: 'Automations',
            message: 'Automations',
          })}
        </Link>
        <Link className="ide-button ide-button--secondary" to="/skills">
          {i18n._({
            id: 'Skills',
            message: 'Skills',
          })}
        </Link>
        <Link className="ide-button ide-button--secondary" to="/runtime">
          {i18n._({
            id: 'Runtime',
            message: 'Runtime',
          })}
        </Link>
      </div>
      <form className="form-stack" onSubmit={onStartCommand}>
        <div
          aria-label={i18n._({
            id: 'Command execution mode',
            message: 'Command execution mode',
          })}
          className="composer-control-group composer-control-group--active"
          role="group"
        >
          <span className="composer-control-group__label">
            {i18n._({
              id: 'Execution mode',
              message: 'Execution mode',
            })}
          </span>
          <div className="segmented-control composer-control-group__segmented">
            <button
              aria-pressed={commandRunMode === 'command-exec'}
              className={
                commandRunMode === 'command-exec'
                  ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                  : 'segmented-control__item composer-control-group__item'
              }
              onClick={() => onChangeCommandRunMode('command-exec')}
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
                  ? 'segmented-control__item segmented-control__item--active composer-control-group__item composer-control-group__item--danger'
                  : 'segmented-control__item composer-control-group__item composer-control-group__item--danger'
              }
              disabled={!selectedThread}
              onClick={() => onChangeCommandRunMode('thread-shell')}
              type="button"
            >
              {i18n._({
                id: 'thread/shellCommand',
                message: 'thread/shellCommand',
              })}
            </button>
          </div>
        </div>
        <label className="field">
          <span>
            {commandRunMode === 'thread-shell'
              ? i18n._({
                  id: 'Run shell command in thread',
                  message: 'Run shell command in thread',
                })
              : i18n._({
                  id: 'Run command',
                  message: 'Run command',
                })}
          </span>
          <input
            onChange={(event) => onChangeCommand(event.target.value)}
            placeholder={
              commandRunMode === 'thread-shell'
                ? 'node script.js'
                : 'pnpm test --filter frontend'
            }
            value={command}
          />
        </label>
        <p className="config-inline-note">
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
          className="ide-button"
          disabled={!command.trim() || startCommandModeDisabled}
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
    </CollapsiblePanel>
  )
}
