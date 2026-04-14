import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { i18n } from '../../i18n/runtime'
import type { WorkspaceRuntimeRecoverySummary } from './runtimeRecovery'

type RuntimeRecoveryActionGroupProps = {
  summary: WorkspaceRuntimeRecoverySummary
  configSettingsPath?: string
  environmentSettingsPath?: string
  onRestartAndRetry?: () => void
  onRestartRuntime?: () => void
  onRetry?: () => void
  restartAndRetryPending?: boolean
  restartRuntimePending?: boolean
  retryPending?: boolean
}

const ACTION_CLASS_NAME = 'ide-button ide-button--secondary ide-button--sm'

export function RuntimeRecoveryActionGroup({
  summary,
  configSettingsPath,
  environmentSettingsPath,
  onRestartAndRetry,
  onRestartRuntime,
  onRetry,
  restartAndRetryPending,
  restartRuntimePending,
  retryPending,
}: RuntimeRecoveryActionGroupProps) {
  let action: ReactNode = null

  switch (summary.actionKind) {
    case 'fix-config':
      action = configSettingsPath ? (
        <Link className={ACTION_CLASS_NAME} to={configSettingsPath}>
          {i18n._({
            id: 'Open Config Settings',
            message: 'Open Config Settings',
          })}
        </Link>
      ) : null
      break
    case 'restart-and-retry':
      action = onRestartAndRetry ? (
        <button
          className={ACTION_CLASS_NAME}
          disabled={Boolean(restartAndRetryPending || restartRuntimePending)}
          onClick={onRestartAndRetry}
          type="button"
        >
          {restartAndRetryPending
            ? i18n._({
                id: 'Restarting…',
                message: 'Restarting…',
              })
            : i18n._({
                id: 'Restart and Retry',
                message: 'Restart and Retry',
              })}
        </button>
      ) : onRestartRuntime ? (
        <button
          className={ACTION_CLASS_NAME}
          disabled={Boolean(restartAndRetryPending || restartRuntimePending)}
          onClick={onRestartRuntime}
          type="button"
        >
          {restartRuntimePending
            ? i18n._({
                id: 'Restarting…',
                message: 'Restarting…',
              })
            : i18n._({
                id: 'Restart Runtime',
                message: 'Restart Runtime',
              })}
        </button>
      ) : null
      break
    case 'retry':
      action = onRetry ? (
        <button
          className={ACTION_CLASS_NAME}
          disabled={Boolean(retryPending)}
          onClick={onRetry}
          type="button"
        >
          {retryPending
            ? i18n._({
                id: 'Retrying…',
                message: 'Retrying…',
              })
            : i18n._({
                id: 'Retry',
                message: 'Retry',
              })}
        </button>
      ) : null
      break
    case 'inspect':
    default:
      action = environmentSettingsPath ? (
        <Link className={ACTION_CLASS_NAME} to={environmentSettingsPath}>
          {i18n._({
            id: 'Open Runtime Inspection',
            message: 'Open Runtime Inspection',
          })}
        </Link>
      ) : null
      break
  }

  if (!action) {
    return null
  }

  return <div className="header-actions">{action}</div>
}
