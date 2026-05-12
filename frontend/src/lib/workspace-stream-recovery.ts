export const WORKSPACE_STREAM_RECOVERY_REQUIRED_EVENT =
  'codex-server-workspace-stream-recovery-required'

export type WorkspaceStreamRecoveryReason =
  | 'replay-incomplete-stalled'
  | 'replay-retention-gap'

export type WorkspaceStreamRecoveryRequiredDetail = {
  workspaceId: string
  reason: WorkspaceStreamRecoveryReason
  afterSeq?: number | null
  currentSeq?: number | null
  expectedSeq?: number | null
  fromSeq?: number | null
  headSeq?: number | null
  limit?: number | null
  nextAfterSeq?: number | null
  oldestSeq?: number | null
  receivedSeq?: number | null
  replayed?: number | null
  threadId?: string | null
  toSeq?: number | null
  turnId?: string | null
}

export function dispatchWorkspaceStreamRecoveryRequired(
  detail: WorkspaceStreamRecoveryRequiredDetail,
) {
  if (
    typeof window === 'undefined' ||
    typeof window.dispatchEvent !== 'function' ||
    !isWorkspaceStreamRecoveryRequiredDetail(detail)
  ) {
    return false
  }

  window.dispatchEvent(createWorkspaceStreamRecoveryRequiredEvent(detail))
  return true
}

export function readWorkspaceStreamRecoveryRequiredDetail(
  event: Event,
): WorkspaceStreamRecoveryRequiredDetail | null {
  const detail = (event as CustomEvent<unknown>).detail
  return isWorkspaceStreamRecoveryRequiredDetail(detail) ? detail : null
}

function createWorkspaceStreamRecoveryRequiredEvent(
  detail: WorkspaceStreamRecoveryRequiredDetail,
) {
  if (typeof CustomEvent === 'function') {
    return new CustomEvent(WORKSPACE_STREAM_RECOVERY_REQUIRED_EVENT, {
      detail,
    })
  }

  const event = new Event(WORKSPACE_STREAM_RECOVERY_REQUIRED_EVENT)
  Object.defineProperty(event, 'detail', {
    configurable: true,
    enumerable: true,
    value: detail,
  })
  return event
}

function isWorkspaceStreamRecoveryRequiredDetail(
  value: unknown,
): value is WorkspaceStreamRecoveryRequiredDetail {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const detail = value as WorkspaceStreamRecoveryRequiredDetail
  return (
    typeof detail.workspaceId === 'string' &&
    detail.workspaceId.trim().length > 0 &&
    (detail.reason === 'replay-incomplete-stalled' ||
      detail.reason === 'replay-retention-gap')
  )
}
