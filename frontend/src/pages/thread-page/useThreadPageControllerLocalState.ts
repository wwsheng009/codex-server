import { useRef, useState } from 'react'

import { type ContextCompactionFeedback } from './threadPageComposerShared'
import type { CommandRunMode } from './threadPageActionTypes'

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
  const [syncClock, setSyncClock] = useState(() => Date.now())
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)

  return {
    approvalAnswers,
    approvalErrors,
    command,
    commandRunMode,
    composerInputRef,
    contextCompactionFeedback,
    selectedProcessId,
    setApprovalAnswers,
    setApprovalErrors,
    setCommand,
    setCommandRunMode,
    setContextCompactionFeedback,
    setSelectedProcessId,
    setStdinValue,
    setSyncClock,
    stdinValue,
    syncClock,
  }
}
