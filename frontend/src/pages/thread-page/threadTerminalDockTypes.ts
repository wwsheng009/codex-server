import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { CommandRuntimeSession } from '../../stores/session-store'

export type ThreadTerminalDockProps = {
  activeCommandCount: number
  className: string
  commandSessions: CommandRuntimeSession[]
  isExpanded: boolean
  onChangeStdinValue: (value: string) => void
  onClearCompletedSessions: () => void
  onRemoveSession: (processId: string) => void
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onSelectSession: (processId: string) => void
  onSubmitStdin: (event: FormEvent<HTMLFormElement>) => void
  onTerminateSelectedSession: () => void
  onToggleExpanded: () => void
  selectedCommandSession?: CommandRuntimeSession
  stdinValue: string
  terminateDisabled: boolean
}
