import { useEffect, useState } from 'react'

import { i18n } from '../../i18n/runtime'
import { useUIStore } from '../../stores/ui-store'
import {
  compareTerminalStressRuns,
  toCompletedTerminalStressRun,
  type CompletedTerminalStressRun,
} from './threadTerminalStressDomain'
import {
  TERMINAL_STRESS_HISTORY_LIMIT,
  TERMINAL_STRESS_HISTORY_STORAGE_KEY,
  createTerminalStressExport,
  parseTerminalStressHistory,
  serializeTerminalStressHistory,
} from './threadTerminalStressStorage'
import {
  isTerminalDebugEnabled,
} from './threadTerminalDebugUtils'
import { downloadJsonFile } from './threadTerminalStressHelpers'
import type {
  ThreadTerminalStressHistoryState,
  ThreadTerminalStressHistoryStateInput
} from './threadTerminalStressStateTypes'

export function useThreadTerminalStressHistoryState({
  setStressRun,
  stressRun,
}: ThreadTerminalStressHistoryStateInput): ThreadTerminalStressHistoryState {
  const [stressHistory, setStressHistory] = useState<CompletedTerminalStressRun[]>([])
  const [stressCompareTargetId, setStressCompareTargetId] = useState('')
  const [stressCompareBaselineId, setStressCompareBaselineId] = useState('')

  const pushToast = useUIStore((state) => state.pushToast)

  const completedCurrentStressRun = toCompletedTerminalStressRun(stressRun)
  const stressRecords =
    completedCurrentStressRun && stressHistory[0]?.id !== completedCurrentStressRun.id
      ? [completedCurrentStressRun, ...stressHistory].slice(0, TERMINAL_STRESS_HISTORY_LIMIT)
      : stressHistory
  const latestCompletedStressRun = stressRecords[0] ?? null
  const selectedStressCompareTarget =
    stressRecords.find((record) => record.id === stressCompareTargetId) ?? latestCompletedStressRun
  const selectedStressCompareBaseline =
    stressRecords.find(
      (record) =>
        record.id === stressCompareBaselineId &&
        record.id !== selectedStressCompareTarget?.id,
    ) ??
    stressRecords.find((record) => record.id !== selectedStressCompareTarget?.id) ??
    null
  const stressComparison =
    selectedStressCompareTarget && selectedStressCompareBaseline
      ? compareTerminalStressRuns(selectedStressCompareTarget, selectedStressCompareBaseline)
      : null
  const displayedStressRun = stressRun ?? latestCompletedStressRun

  function handleExportStressSummary() {
    if (!latestCompletedStressRun) {
      return
    }

    try {
      downloadJsonFile(
        `terminal-stress-${new Date(latestCompletedStressRun.startedAt)
          .toISOString()
          .replace(/[:.]/g, '-')}.json`,
        createTerminalStressExport({
          baseline:
            selectedStressCompareTarget?.id === latestCompletedStressRun.id
              ? selectedStressCompareBaseline
              : null,
          comparison:
            selectedStressCompareTarget?.id === latestCompletedStressRun.id
              ? stressComparison
              : null,
          latest: latestCompletedStressRun,
        }),
      )
      pushToast({
        message: i18n._({
          id: 'The latest terminal stress summary was downloaded as JSON.',
          message: 'The latest terminal stress summary was downloaded as JSON.',
        }),
        title: i18n._({
          id: 'Stress summary exported',
          message: 'Stress summary exported',
        }),
        tone: 'success',
      })
    } catch {
      pushToast({
        message: i18n._({
          id: 'The browser could not export the latest terminal stress summary.',
          message: 'The browser could not export the latest terminal stress summary.',
        }),
        title: i18n._({
          id: 'Stress summary export failed',
          message: 'Stress summary export failed',
        }),
        tone: 'error',
      })
    }
  }

  function handleClearStressSummary() {
    setStressRun(null)
    setStressHistory([])
    setStressCompareBaselineId('')
    setStressCompareTargetId('')
  }

  useEffect(() => {
    if (!isTerminalDebugEnabled || typeof window === 'undefined') {
      return
    }

    setStressHistory(
      parseTerminalStressHistory(
        window.localStorage.getItem(TERMINAL_STRESS_HISTORY_STORAGE_KEY),
      ),
    )
  }, [])

  useEffect(() => {
    if (!isTerminalDebugEnabled || typeof window === 'undefined') {
      return
    }

    if (!stressHistory.length) {
      window.localStorage.removeItem(TERMINAL_STRESS_HISTORY_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(
      TERMINAL_STRESS_HISTORY_STORAGE_KEY,
      serializeTerminalStressHistory(stressHistory),
    )
  }, [stressHistory])

  useEffect(() => {
    const nextCompletedStressRun = toCompletedTerminalStressRun(stressRun)
    if (!nextCompletedStressRun) {
      return
    }

    setStressHistory((current) => {
      if (current.some((entry) => entry.id === nextCompletedStressRun.id)) {
        return current
      }

      return [nextCompletedStressRun, ...current].slice(0, TERMINAL_STRESS_HISTORY_LIMIT)
    })
    setStressCompareBaselineId('')
    setStressCompareTargetId('')
  }, [stressRun])

  return {
    clearStressSummary: handleClearStressSummary,
    displayedStressRun,
    exportStressSummary: handleExportStressSummary,
    latestCompletedStressRun,
    selectStressCompareBaseline: setStressCompareBaselineId,
    selectStressCompareTarget: setStressCompareTargetId,
    selectedStressCompareBaseline,
    selectedStressCompareTarget,
    stressComparison,
    stressRecords,
  }
}
