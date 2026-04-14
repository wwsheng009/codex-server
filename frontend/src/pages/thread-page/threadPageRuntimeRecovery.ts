import type { WorkspaceRuntimeState } from '../../types/api'

export type ThreadPageRecoverableRuntimeActionKind =
  | 'restart-and-retry'
  | 'retry'

export function getRecoverableRuntimeActionKind(
  state: WorkspaceRuntimeState | null | undefined,
): ThreadPageRecoverableRuntimeActionKind | null {
  if (!state) {
    return null
  }

  const recoveryAction = (state.lastErrorRecoveryAction ?? '').trim()

  if (
    recoveryAction === 'retry-after-restart' ||
    Boolean(state.lastErrorRequiresRuntimeRecycle)
  ) {
    return 'restart-and-retry'
  }

  if (recoveryAction === 'retry') {
    return 'retry'
  }

  return null
}
