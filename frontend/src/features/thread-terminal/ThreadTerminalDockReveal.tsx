import { i18n } from '../../i18n/runtime'
import type {
  ThreadTerminalDockRevealState
} from './threadTerminalDockStateTypes'

export function ThreadTerminalDockReveal({
  className,
  onShow,
}: ThreadTerminalDockRevealState) {
  return (
    <button className={className} onClick={onShow} type="button">
      {i18n._({
        id: 'Show terminal',
        message: 'Show terminal',
      })}
    </button>
  )
}
