type StatusPillProps = {
  status: string
}

export function StatusPill({ status }: StatusPillProps) {
  const tone = status.toLowerCase().replace(/\s+/g, '-')

  return <span className={`status-pill status-pill--${tone}`}>{status}</span>
}
