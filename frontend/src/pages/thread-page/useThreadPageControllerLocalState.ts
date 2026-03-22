import { useRef, useState } from 'react'

import type { ThreadTurn } from '../../types/api'
import { type ContextCompactionFeedback } from './threadPageComposerShared'
import type { CommandRunMode } from './threadPageActionTypes'

export const DEFAULT_THREAD_TURN_WINDOW_SIZE = 80
export const THREAD_TURN_WINDOW_INCREMENT = 80

export function useThreadPageControllerLocalState() {
  const [contextCompactionFeedback, setContextCompactionFeedback] =
    useState<ContextCompactionFeedback | null>(null)
  const [command, setCommand] = useState('git status')
  const [commandRunMode, setCommandRunMode] = useState<CommandRunMode>('command-exec')
  const [stdinValue, setStdinValue] = useState('')
  const [selectedProcessId, setSelectedProcessId] = useState<string>()
  const [approvalAnswers, setApprovalAnswers] =
    useState<Record<string, Record<string, string>>>({})
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({})
  const [threadTurnWindowSize, setThreadTurnWindowSize] = useState(
    DEFAULT_THREAD_TURN_WINDOW_SIZE,
  )
  const [historicalTurns, setHistoricalTurns] = useState<ThreadTurn[]>([])
  const [hasMoreHistoricalTurnsBefore, setHasMoreHistoricalTurnsBefore] =
    useState<boolean | null>(null)
  const [isLoadingOlderTurns, setIsLoadingOlderTurns] = useState(false)
  const [syncClock, setSyncClock] = useState(() => Date.now())
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)

  return {
    approvalAnswers,
    approvalErrors,
    command,
    commandRunMode,
    composerInputRef,
    contextCompactionFeedback,
    hasMoreHistoricalTurnsBefore,
    historicalTurns,
    isLoadingOlderTurns,
    selectedProcessId,
    setApprovalAnswers,
    setApprovalErrors,
    setCommand,
    setCommandRunMode,
    setContextCompactionFeedback,
    setHasMoreHistoricalTurnsBefore,
    setHistoricalTurns,
    setIsLoadingOlderTurns,
    setSelectedProcessId,
    setStdinValue,
    setThreadTurnWindowSize,
    setSyncClock,
    stdinValue,
    syncClock,
    threadTurnWindowSize,
  }
}
