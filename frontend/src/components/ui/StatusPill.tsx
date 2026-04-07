import { formatLocalizedStatusLabel } from '../../i18n/display'
import type { StatusPillProps } from './statusPillTypes'

export function StatusPill({ status }: StatusPillProps) {
  const tone = status.toLowerCase().replace(/[\s_]+/g, '-')
  const label = formatLocalizedStatusLabel(status)

  return <span className={`status-pill status-pill--${tone}`}>{label}</span>
}
