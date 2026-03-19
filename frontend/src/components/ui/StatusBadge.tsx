type StatusBadgeProps = {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const tone = status.toLowerCase().replace(/\s+/g, '-')

  return <span className={`status-badge status-badge--${tone}`}>{status}</span>
}
