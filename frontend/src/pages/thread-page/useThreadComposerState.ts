import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'

import {
  buildComposerAutocompleteKey,
  getComposerAutocompleteMatch,
  replaceComposerAutocompleteToken,
} from '../../lib/composer-autocomplete'
import {
  DEFAULT_COMPOSER_PREFERENCES,
  buildComposerCommandDefinitions,
  readComposerPreferences,
  writeComposerPreferences,
  type ComposerAssistPanel,
  type ComposerCommandMenu,
  type ComposerPreferences,
} from './threadPageComposerShared'
import type { ThreadPageRecoverableCommandOperation } from './threadPageActionTypes'
import type { ThreadPageRuntimeRecoveryExecutionNotice } from './threadPageRecoveryExecution'
import type { InsertComposerTextInput } from './threadComposerActionTypes'

export type UseThreadComposerStateInput = {
  composerInputRef: RefObject<HTMLTextAreaElement | null>
  selectedThreadId?: string
  supportsPlanMode: boolean
  workspaceId: string
}

export function useThreadComposerState({
  composerInputRef,
  selectedThreadId,
  supportsPlanMode,
  workspaceId,
}: UseThreadComposerStateInput) {
  const [message, setMessage] = useState('')
  const [composerCaret, setComposerCaret] = useState(0)
  const [activeComposerPanel, setActiveComposerPanel] = useState<ComposerAssistPanel | null>(null)
  const [composerCommandMenu, setComposerCommandMenu] = useState<ComposerCommandMenu>('root')
  const [composerAutocompleteIndex, setComposerAutocompleteIndex] = useState(0)
  const [dismissedComposerAutocompleteKey, setDismissedComposerAutocompleteKey] = useState<string | null>(null)
  const [composerPreferences, setComposerPreferences] = useState<ComposerPreferences>(
    DEFAULT_COMPOSER_PREFERENCES,
  )
  const [sendError, setSendError] = useState<string | null>(null)
  const [recoverableSendInput, setRecoverableSendInput] = useState<string | null>(null)
  const [recoverableCommandOperation, setRecoverableCommandOperation] =
    useState<ThreadPageRecoverableCommandOperation | null>(null)
  const [isRestartAndRetryPending, setIsRestartAndRetryPending] = useState(false)
  const [runtimeRecoveryExecutionNotice, setRuntimeRecoveryExecutionNotice] =
    useState<ThreadPageRuntimeRecoveryExecutionNotice | null>(null)
  const [authRecoveryRequestedAt, setAuthRecoveryRequestedAt] = useState<number | null>(null)

  const activeComposerMatch = useMemo(
    () => getComposerAutocompleteMatch(message, composerCaret),
    [composerCaret, message],
  )
  const activeComposerAutocompleteKey = buildComposerAutocompleteKey(activeComposerMatch)
  const deferredComposerQuery = useDeferredValue(activeComposerMatch?.query ?? '')
  const normalizedDeferredComposerQuery = deferredComposerQuery.trim()
  const composerCommandDefinitions = useMemo(
    () => buildComposerCommandDefinitions(composerPreferences.collaborationMode),
    [composerPreferences.collaborationMode],
  )
  const isMentionAutocompleteOpen =
    activeComposerMatch?.mode === 'mention' &&
    activeComposerAutocompleteKey !== dismissedComposerAutocompleteKey
  const isSkillAutocompleteOpen =
    activeComposerMatch?.mode === 'skill' &&
    activeComposerAutocompleteKey !== dismissedComposerAutocompleteKey
  const isCommandAutocompleteOpen =
    ((activeComposerMatch?.mode === 'command' &&
      activeComposerAutocompleteKey !== dismissedComposerAutocompleteKey) ||
      composerCommandMenu === 'review')

  useEffect(() => {
    setComposerPreferences(readComposerPreferences(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    writeComposerPreferences(workspaceId, composerPreferences)
  }, [composerPreferences, workspaceId])

  useEffect(() => {
    if (!supportsPlanMode && composerPreferences.collaborationMode === 'plan') {
      setComposerPreferences((current) => ({
        ...current,
        collaborationMode: 'default',
      }))
    }
  }, [composerPreferences.collaborationMode, supportsPlanMode])

  useEffect(() => {
    setActiveComposerPanel(null)
    setComposerCommandMenu('root')
    setComposerAutocompleteIndex(0)
    setDismissedComposerAutocompleteKey(null)
    setRecoverableSendInput(null)
    setRecoverableCommandOperation(null)
    setIsRestartAndRetryPending(false)
    setRuntimeRecoveryExecutionNotice(null)
    setAuthRecoveryRequestedAt(null)
  }, [selectedThreadId, workspaceId])

  useEffect(() => {
    setComposerAutocompleteIndex(0)
  }, [activeComposerAutocompleteKey, composerCommandMenu])

  function focusComposerAt(nextCaret: number) {
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus()
      composerInputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function applyComposerMessage(nextValue: string, nextCaret: number) {
    setMessage(nextValue)
    setComposerCaret(nextCaret)
    setSendError(null)
    setDismissedComposerAutocompleteKey(null)
    focusComposerAt(nextCaret)
  }

  function clearComposerTriggerToken() {
    if (!activeComposerMatch) {
      return { value: message, caret: composerCaret }
    }

    return replaceComposerAutocompleteToken(message, activeComposerMatch, '')
  }

  function insertComposerText(input: InsertComposerTextInput) {
    const { replacement, replaceActiveToken = false } = input
    if (replaceActiveToken && activeComposerMatch) {
      return replaceComposerAutocompleteToken(message, activeComposerMatch, replacement)
    }

    return {
      value: `${message.slice(0, composerCaret)}${replacement}${message.slice(composerCaret)}`,
      caret: composerCaret + replacement.length,
    }
  }

  function dismissComposerAutocomplete() {
    setComposerCommandMenu('root')
    if (activeComposerAutocompleteKey) {
      setDismissedComposerAutocompleteKey(activeComposerAutocompleteKey)
    }
  }

  return {
    activeComposerMatch,
    activeComposerPanel,
    composerAutocompleteIndex,
    composerCaret,
    composerCommandDefinitions,
    composerCommandMenu,
    composerPreferences,
    activeComposerAutocompleteKey,
    applyComposerMessage,
    authRecoveryRequestedAt,
    clearComposerTriggerToken,
    dismissComposerAutocomplete,
    insertComposerText,
    isCommandAutocompleteOpen,
    isMentionAutocompleteOpen,
    isSkillAutocompleteOpen,
    message,
    normalizedDeferredComposerQuery,
    recoverableCommandOperation,
    recoverableSendInput,
    runtimeRecoveryExecutionNotice,
    sendError,
    focusComposerAt,
    isRestartAndRetryPending,
    setActiveComposerPanel,
    setAuthRecoveryRequestedAt,
    setComposerAutocompleteIndex,
    setComposerCaret,
    setComposerCommandMenu,
    setComposerPreferences,
    setDismissedComposerAutocompleteKey,
    setRecoverableCommandOperation,
    setIsRestartAndRetryPending,
    setRuntimeRecoveryExecutionNotice,
    setMessage,
    setRecoverableSendInput,
    setSendError,
  }
}
