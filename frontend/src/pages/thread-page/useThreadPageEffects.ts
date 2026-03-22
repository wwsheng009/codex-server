import { useRef } from 'react'

import { useThreadPageChromeEffects } from './useThreadPageChromeEffects'
import { useThreadPageLifecycleEffects } from './useThreadPageLifecycleEffects'
import { useThreadPageRefreshEffects } from './useThreadPageRefreshEffects'
import type { ThreadPageEffectsInput } from './threadPageEffectTypes'

export function useThreadPageEffects(input: ThreadPageEffectsInput) {
  const threadDetailRefreshTimerRef = useRef<number | null>(null)

  useThreadPageLifecycleEffects(input)
  useThreadPageRefreshEffects({
    ...input,
    threadDetailRefreshTimerRef,
  })
  useThreadPageChromeEffects(input)
}
