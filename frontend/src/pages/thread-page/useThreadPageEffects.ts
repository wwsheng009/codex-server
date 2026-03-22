import { useRef } from 'react'

import { useThreadPageChromeEffects } from './useThreadPageChromeEffects'
import { useThreadPageLifecycleEffects } from './useThreadPageLifecycleEffects'
import { useThreadPageRefreshEffects } from './useThreadPageRefreshEffects'
import type { ThreadPageEffectsInput } from './threadPageEffectTypes'

export function useThreadPageEffects(input: ThreadPageEffectsInput) {
  const threadListRefreshTimerRef = useRef<number | null>(null)
  const threadDetailRefreshTimerRef = useRef<number | null>(null)

  useThreadPageLifecycleEffects(input)
  useThreadPageRefreshEffects({
    ...input,
    threadListRefreshTimerRef,
    threadDetailRefreshTimerRef,
  })
  useThreadPageChromeEffects(input)
}
