import { i18n } from '../../i18n/runtime'
import { RefreshIcon } from './RailControls'

type LoadingStateProps = {
  message?: string
  fill?: boolean
}

export function LoadingState({ message, fill = true }: LoadingStateProps) {
  const resolvedMessage = message ?? i18n._({ id: 'Loading…', message: 'Loading…' })

  return (
    <div className={`loading-state ${fill ? 'loading-state--fill' : ''}`}>
      <div className="loading-state__content">
        <span className="loading-state__spinner">
          <RefreshIcon />
        </span>
        <span className="loading-state__message">{resolvedMessage}</span>
      </div>
    </div>
  )
}
